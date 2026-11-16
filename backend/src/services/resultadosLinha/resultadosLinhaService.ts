import { getPrismaClient } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { ACESSO_TOTAL } from "../acesso/acesso.js";
import { auditar } from "../auditoriaService.js";
import { codigoQueVale, ehCentroDeObra } from "../classificacao/centrosObra.js";
import { manualNoSinalDoBalancete, VOLUMES_DA_DRE } from "../dre/apuracaoUnidades.js";
import { avaliarExpressao, codigosDaExpressao } from "../dre/expressao.js";
import { mesesDoExercicio, montar, type LinhaEstrutura } from "../relatorios/resultadosService.js";
import { valeNoMes } from "../volumes/vigenciasRateio.js";
import { alocar, fracoesDaTarefa, numeroDaObra, ROTULO_DO_NIVEL, semLinha, type Nivel, type Passo } from "./alocacaoNasLinhas.js";
import { linhasDoNegocio, pesosDaBase, receitaDoMes, volumeDaLinhaDRE, volumesDoMes, type Base, type ItemDaReceita, type LinhaDoNegocio, type Volume } from "./basesDasLinhas.js";
import { basesDoRateio, dividirPelasObras, pesosDasObras, ratearEntreObras, SEM_OBRA, somarNaObra, type BaseDaObra, type ValoresDasObras } from "./divisaoEntreObras.js";

/**
 * Os Resultados por Linha (26/10/2026, pedido do Adão): a DRE de cada linha de produto e de obra, da receita à Margem de
 * Contribuição. A etapa Linhas da apuração da competência, depois da DRE, parte da DRE apurada de cada unidade (Matriz,
 * Filial e Serviços), a divide entre as linhas dela e grava o resultado (ResultadoLinha), que fica congelado com o
 * fechamento. Resultados Empresariais (as abas Linhas e Rateios das Linhas) e a etapa Linhas do mês leem o gravado. A
 * divisão:
 *
 * - a receita (bruta e líquida, por natureza), pela Receita Prévia das linhas;
 * - os custos e as despesas variáveis de venda, lançamento a lançamento: a composição gravada de cada valor (os pares
 *   diretos de balde e filial e os rateios com o percentual da unidade) diz quais lançamentos o formaram, e cada parte vai
 *   às linhas pela ordem da Alocação nas Linhas — a tarefa das requisições e das notas fiscais, a regra do centro, a obra
 *   (os centros de obra), os percentuais por linha do rateio fixo (26/10/2026: a parte de rateio de uma chave com
 *   percentual fixo, pelo destino dela), a regra do rateio e o volume da unidade; o que nenhum passo leva fica Sem Linha;
 * - os volumes (as linhas P e S), pelas listas, na regra da aba Totais.
 *
 * A soma das linhas de cada unidade é a DRE da unidade (a Conferência). A parte de cada custo que veio dos centros de obra
 * é direta nas obras; o resto é o rateio da linha, que a etapa também divide entre as obras dela (03/11/2026, o Realizado
 * por Obra: `divisaoEntreObras.ts`), e as obras de cada linha somam a linha.
 */

const Decimal = Prisma.Decimal;
const n = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();
const prefixo = (codigo: string) => codigo.split(".")[0];
const NOME_DA_UNIDADE: Record<number, string> = { 1: "Matriz", 2: "Filial", 3: "Serviços" };
/** As chaves de rateio (os lançamentos manuais delas entram como rateio, como na apuração). */
const CHAVES_DE_RATEIO = new Set(["PROJETO", "PRODUCAO", "METALURGIA", "ARMADURA", "ACOMPANHAMENTO"]);
/** Os itens da DRE dos Resultados por Linha: os volumes, as receitas, os custos e as despesas variáveis de venda. */
const ITENS = new Set(["P", "S", "ROB", "ROL", "CPP", "CSM", "CSC", "DVV"]);
const SECOES = new Set(["PS", "P", "S"]);
const CUSTOS = new Set(["CPP", "CSM", "CSC", "DVV"]);
/** A aba Rateios das Linhas: só os custos (e os volumes, a base). */
const DOS_RATEIOS = new Set(["PS", "P", "S", "CPP", "CSM", "CSC", "CPV", "DVV"]);
/** A natureza da Receita Prévia de cada item da receita (pela sigla: RBPF, RLPF…). */
export const NATUREZA_DA_RECEITA: Record<string, string> = {
  RBPF: "PRE_FABRICADO", RLPF: "PRE_FABRICADO", RBF: "FRETE", RLF: "FRETE", RBM: "MONTAGEM", RLM: "MONTAGEM",
  RBC: "COMPLEMENTAR", RLC: "COMPLEMENTAR", RBDI: "DEVOLUCOES_INVENTARIOS", RLDI: "DEVOLUCOES_INVENTARIOS",
};
const MC = "MC.MARGEM_DE_CONTRIBUICAO_MC";

export type LinhaDRE = LinhaEstrutura & { expressao: string | null; unidades: number[] };
type Par = { balde: string; filial?: number };
type OrigemContabil = { linhaId: string; pares?: Par[]; baldes?: string[]; fator?: string };
type Composicao = { origem?: { contabil?: OrigemContabil; contabilPar?: OrigemContabil }; rateios?: Array<{ chave: string; destino?: string; percentual: string; linhaId?: string; competenciaId?: string }> };
/**
 * Um grupo de lançamentos (os contábeis e os manuais) com o mesmo contexto: a linha da DRE, o balde, a filial, o centro e a
 * conta — e, nos manuais de rateio com os percentuais de outra competência (30/10/2026), ela.
 */
/**
 * `codigoCentro`: o centro do balancete (o RM), que acha as tarefas das requisições e das notas fiscais; `codigoDaObra`: o
 * centro que vale (13/11/2026: o corrigido pela contestação, pela reclassificação por fornecedor ou o destino da
 * redistribuição), que diz se o custo é direto de uma obra.
 */
type Fonte = { linhaDREId: string; balde: string; filial: number; rateio: boolean; rateioDe: string | null; centroCustoId: string | null; codigoCentro: string | null; codigoDaObra: string | null; reduzido: string | null; valor: number };
type Regra = { origem: string; centroCustoId: string | null; balde: string | null; destino: string; linhaId: string | null; base: string | null };
type DadosDoMes = { volumes: Volume[]; receita: ItemDaReceita[] };

export async function estruturaDaDRE(): Promise<LinhaDRE[]> {
  const ls = await getPrismaClient().linhaDRE.findMany({
    where: { ativo: true },
    orderBy: { ordem: "asc" },
    select: { id: true, codigo: true, tipo: true, grupo: true, grupoSigla: true, atribuicaoSigla: true, descricao: true, expressao: true, unidades: { select: { unidadeNegocio: { select: { codigo: true } } } } },
  });
  return ls.map(({ unidades, ...l }) => ({ ...l, unidades: unidades.map((u) => u.unidadeNegocio.codigo) }));
}

/** As linhas da DRE da tabela: os itens do escopo, as seções dos volumes e os totais feitos só deles (até a MC). */
export function escopo(est: LinhaDRE[], prefixos: Set<string>) {
  const s = new Set(est.filter((l) => (l.tipo === "ITEM" && prefixos.has(prefixo(l.codigo)) && ITENS.has(prefixo(l.codigo))) || (l.tipo === "SECAO" && SECOES.has(prefixo(l.codigo)) && prefixos.has(prefixo(l.codigo)))).map((l) => l.codigo));
  for (let mudou = true; mudou; ) {
    mudou = false;
    for (const l of est) {
      if (s.has(l.codigo) || l.tipo === "ITEM" || l.tipo === "SECAO" || !l.expressao || !prefixos.has(prefixo(l.codigo))) continue;
      if (codigosDaExpressao(l.expressao).every((c) => s.has(c))) {
        s.add(l.codigo);
        mudou = true;
      }
    }
  }
  return s;
}

/** Os lançamentos do mês, contábeis e manuais (fora do balde RN), agrupados pelo contexto, no sinal do balancete. */
async function fontesDoMes(competenciaId: string): Promise<Fonte[]> {
  const prisma = getPrismaClient();
  const [diretos, partes, manuais] = await Promise.all([
    prisma.lancamentoContabil.findMany({
      where: { competenciaId, redistribuicaoId: null, linhaDREId: { not: null } },
      select: { linhaDREId: true, balde: true, filial: true, alocacao: true, valorMovimento: true, centroCustoId: true, codigoCentroCusto: true, centroCusto: { select: { codigoRM: true } }, contaResultado: { select: { reduzido: true } } },
    }),
    // Os redistribuídos (13/11/2026) pelas partes: o centro (e o código dele) de cada destino.
    prisma.lancamentoRedistribuido.findMany({
      where: { competenciaId },
      select: { linhaDREId: true, balde: true, filial: true, alocacao: true, valorMovimento: true, centroCustoId: true, centroCusto: { select: { codigoRM: true } }, lancamentoContabil: { select: { codigoCentroCusto: true, contaResultado: { select: { reduzido: true } } } } },
    }),
    prisma.lancamentoManual.findMany({
      where: { competenciaId, linhaDREId: { not: null } },
      select: {
        linhaDREId: true,
        balde: true,
        filial: true,
        valor: true,
        competenciaMovimentoId: true,
        centroCustoId: true,
        centroCusto: { select: { codigoRM: true } },
        contaResultado: { select: { reduzido: true } },
        linhaDRE: { select: { grupoSigla: true } },
      },
    }),
  ]);
  const grupos = new Map<string, Fonte>();
  const somar = (f: Omit<Fonte, "valor">, v: number) => {
    const k = [f.linhaDREId, f.balde, f.filial, f.rateio ? 1 : 0, f.rateioDe ?? "", f.centroCustoId ?? "", f.codigoCentro ?? "", f.codigoDaObra ?? "", f.reduzido ?? ""].join("|");
    const g = grupos.get(k);
    if (g) g.valor += v;
    else grupos.set(k, { ...f, valor: v });
  };
  const contabeis = [
    ...diretos.map(({ centroCusto, ...l }) => ({ ...l, codigoDaObra: codigoQueVale({ ...l, centroCusto }) })),
    ...partes.map(({ centroCusto, lancamentoContabil, ...p }) => ({ ...p, codigoCentroCusto: lancamentoContabil.codigoCentroCusto, codigoDaObra: centroCusto.codigoRM, contaResultado: lancamentoContabil.contaResultado })),
  ];
  for (const l of contabeis) {
    somar(
      { linhaDREId: l.linhaDREId!, balde: l.balde ?? "", filial: l.filial, rateio: l.alocacao === "RATEIO", rateioDe: null, centroCustoId: l.centroCustoId, codigoCentro: l.codigoCentroCusto, codigoDaObra: l.codigoDaObra, reduzido: l.contaResultado.reduzido },
      Number(l.valorMovimento),
    );
  }
  for (const m of manuais) {
    if (n(m.balde) === "RN") continue;
    const rateio = CHAVES_DE_RATEIO.has(m.balde ?? "");
    somar(
      {
        linhaDREId: m.linhaDREId!,
        balde: m.balde ?? "",
        filial: m.filial,
        rateio,
        rateioDe: rateio && m.competenciaMovimentoId !== competenciaId ? m.competenciaMovimentoId : null,
        centroCustoId: m.centroCustoId,
        codigoCentro: m.centroCusto?.codigoRM ?? null,
        codigoDaObra: m.centroCusto?.codigoRM ?? null,
        reduzido: m.contaResultado?.reduzido ?? null,
      },
      Number(manualNoSinalDoBalancete(m.linhaDRE!.grupoSigla, m.valor)),
    );
  }
  return [...grupos.values()];
}

const tarefaNormalizada = (t: string | null | undefined) => (t ?? "").trim().replace(/\s+/g, " ").toUpperCase();
const chaveDoDocumento = (reduzido: string | null, centro: string | null, filial: number | null) => `${reduzido ?? ""}|${centro ?? ""}|${filial ?? ""}`;

/** As requisições e as notas fiscais do mês, por conta, centro e filial: o valor de cada linha (pela tarefa) e o sem tarefa. */
async function documentosDoMes(competenciaId: string) {
  const prisma = getPrismaClient();
  const sel = { filial: true, codigoCentroCusto: true, contaContabil: true, nomeTarefa: true, valorTotal: true } as const;
  const [requisicoes, notas, correspondencias] = await Promise.all([
    prisma.requisicaoItem.findMany({ where: { competenciaId }, select: sel }),
    prisma.notaFiscalItem.findMany({ where: { competenciaId }, select: sel }),
    prisma.correspondenciaTarefa.findMany({ select: { filial: true, tarefa: true, linhaId: true } }),
  ]);
  const linhaDaTarefa = (filial: number | null, tarefa: string | null) => {
    const t = tarefaNormalizada(tarefa);
    if (!t) return null;
    return (
      correspondencias.find((c) => c.filial !== null && c.filial === filial && tarefaNormalizada(c.tarefa) === t) ?? correspondencias.find((c) => c.filial === null && tarefaNormalizada(c.tarefa) === t)
    )?.linhaId ?? null;
  };
  const porChave = new Map<string, { porLinha: Map<string, number>; sem: number }>();
  for (const d of [...requisicoes, ...notas]) {
    const k = chaveDoDocumento(d.contaContabil, d.codigoCentroCusto, d.filial);
    const g = porChave.get(k) ?? { porLinha: new Map<string, number>(), sem: 0 };
    const linhaId = linhaDaTarefa(d.filial, d.nomeTarefa);
    if (linhaId) g.porLinha.set(linhaId, (g.porLinha.get(linhaId) ?? 0) + Number(d.valorTotal));
    else g.sem += Number(d.valorTotal);
    porChave.set(k, g);
  }
  return { porChave, requisicoes: requisicoes.length, notas: notas.length };
}

/** O resultado de um mês: o valor de cada linha (e da Sem Linha de cada unidade) em cada item, e a parte direta nas obras. */
type ResultadoDoMes = {
  valores: Map<string, Map<string, number>>;
  naObra: Map<string, Map<string, number>>;
  /** O valor de cada obra em cada linha e item (03/11/2026): o direto e a parte do rateio da linha. */
  obras: ValoresDasObras;
  niveis: Map<number, Map<Nivel, number>>;
  mcDaDRE: Map<number, number>;
  avisos: string[];
  documentos: { requisicoes: number; notas: number };
};

/**
 * As obras do Realizado por Obra (03/11/2026) para o rateio das linhas: a do centro de obra pelo número; a da Receita Prévia
 * pelo código (ou pelo número); as genéricas, que ficam fora da base do rateio.
 */
export function obrasDoRateio(obras: Array<{ id: string; codigo: string; generica: boolean }>) {
  const obraDoNumero = new Map<string, { id: string; codigo: string }>();
  for (const o of obras) if (!obraDoNumero.has(numeroDaObra(o.codigo))) obraDoNumero.set(numeroDaObra(o.codigo), o);
  const obraPorCodigo = new Map(obras.map((o) => [o.codigo.trim().toUpperCase(), o.id]));
  const obraDaReceita = (codigo: string | null) =>
    !codigo ? SEM_OBRA : (obraPorCodigo.get(codigo.trim().toUpperCase()) ?? obraDoNumero.get(numeroDaObra(codigo))?.id ?? SEM_OBRA);
  return { obraDoNumero, obraDaReceita, genericas: new Set(obras.filter((o) => o.generica).map((o) => o.id)) };
}

async function calcularMes(
  competencia: { id: string; ano: number; mes: number },
  linhas: LinhaDoNegocio[],
  est: LinhaDRE[],
  dadosDoMes: DadosDoMes,
  dadosDoAno: DadosDoMes,
): Promise<ResultadoDoMes> {
  const prisma = getPrismaClient();
  const [fontes, documentos, unidades, regras, obras, fixas] = await Promise.all([
    fontesDoMes(competencia.id),
    documentosDoMes(competencia.id),
    prisma.resultadoApurado.findMany({
      where: { competenciaId: competencia.id, centroCustoId: null, unidadeNegocio: { codigo: { in: [1, 2, 3] } } },
      select: { valor: true, composicao: true, linhaDRE: { select: { codigo: true, tipo: true } }, unidadeNegocio: { select: { codigo: true } } },
    }),
    prisma.alocacaoLinha.findMany({ select: { origem: true, centroCustoId: true, balde: true, destino: true, linhaId: true, base: true, vigenciaInicio: true, vigenciaFim: true } }),
    prisma.obra.findMany({ select: { id: true, codigo: true, generica: true } }),
    // Os percentuais por linha dos rateios fixos (26/10/2026).
    prisma.regraRateio.findMany({
      where: { percentualFixo: { not: null }, linhas: { some: {} } },
      select: { chave: true, destino: true, vigenciaInicio: true, vigenciaFim: true, linhas: { select: { linhaId: true, percentual: true } } },
    }),
  ]);
  const vigentes = regras.filter((r) => valeNoMes({ inicio: r.vigenciaInicio, fim: r.vigenciaFim }, competencia.ano, competencia.mes));
  const regraDoCentro = new Map<string, Regra>(vigentes.filter((r) => r.origem === "CENTRO" && r.centroCustoId).map((r) => [r.centroCustoId!, r]));
  const regraDoBalde = new Map<string, Regra>(vigentes.filter((r) => r.origem === "RATEIO" && r.balde).map((r) => [r.balde!, r]));
  // A parte de rateio de uma chave com percentual fixo no mês vai às linhas pelos percentuais por linha do destino dela
  // (chave|destino → linha → fração), no lugar da regra do rateio.
  const fixoDoDestino = new Map(
    fixas
      .filter((r) => valeNoMes({ inicio: r.vigenciaInicio, fim: r.vigenciaFim }, competencia.ano, competencia.mes))
      .map((r) => [`${r.chave}|${r.destino}`, new Map(r.linhas.map((l) => [l.linhaId, Number(l.percentual)]))]),
  );
  const { obraDoNumero, obraDaReceita, genericas } = obrasDoRateio(obras);

  const fontesDaLinha = new Map<string, Fonte[]>();
  const doBalancete = new Map<string, number>();
  for (const f of fontes) {
    fontesDaLinha.set(f.linhaDREId, [...(fontesDaLinha.get(f.linhaDREId) ?? []), f]);
    const k = chaveDoDocumento(f.reduzido, f.codigoCentro, f.filial);
    doBalancete.set(k, (doBalancete.get(k) ?? 0) + f.valor);
  }
  const fracoes = new Map<string, Map<string, number>>();
  for (const [k, g] of documentos.porChave) fracoes.set(k, fracoesDaTarefa(doBalancete.get(k) ?? 0, g.porLinha, g.sem));

  const linhasDa = (u: number) => new Set(linhas.filter((l) => l.unidade === u).map((l) => l.id));
  const porUnidade = new Map([1, 2, 3].map((u) => [u, linhasDa(u)]));
  const r: ResultadoDoMes = { valores: new Map(), naObra: new Map(), obras: new Map(), niveis: new Map(), mcDaDRE: new Map(), avisos: [], documentos: { requisicoes: documentos.requisicoes, notas: documentos.notas } };
  const somar = (alvo: Map<string, Map<string, number>>, linha: string, codigo: string, v: number) => {
    const m = alvo.get(linha) ?? new Map<string, number>();
    m.set(codigo, (m.get(codigo) ?? 0) + v);
    alvo.set(linha, m);
  };
  const registrar = (u: number, codigo: string, partes: Array<{ linhaId: string; nivel: Nivel; valor: number }>, naObra: boolean) => {
    for (const p of partes) {
      somar(r.valores, p.linhaId, codigo, p.valor);
      if (naObra) somar(r.naObra, p.linhaId, codigo, p.valor);
      const niv = r.niveis.get(u) ?? new Map<Nivel, number>();
      niv.set(p.nivel, (niv.get(p.nivel) ?? 0) + p.valor);
      r.niveis.set(u, niv);
    }
  };

  const umaLinha = (u: number, linhaId: string | null) => (linhaId && porUnidade.get(u)!.has(linhaId) ? new Map([[linhaId, 1]]) : null);
  const pelaRegra = (u: number, regra: Regra | undefined) =>
    !regra ? null : regra.destino === "LINHA" ? umaLinha(u, regra.linhaId) : pesosDaBase(regra.base as Base, u, dadosDoMes);
  const baseDaUnidade = (u: number): Base => (u === 3 ? "DIAS_ACOMPANHAMENTO" : "M3_PRODUZIDO");
  /** A obra do centro de obra: a produção (ou os acompanhamentos, ou a receita nas despesas variáveis de venda) da obra no mês; sem ela, no ano. */
  const pelaObra = (u: number, f: Fonte | null, grupo: string) => {
    if (!f?.codigoDaObra || !ehCentroDeObra(f.codigoDaObra)) return null;
    const obra = obraDoNumero.get(numeroDaObra(f.codigoDaObra));
    if (!obra) return null;
    const base: Base = grupo === "DVV" ? "RECEITA" : baseDaUnidade(u);
    const montagem = (dados: DadosDoMes) => {
      const m = new Map<string, number>();
      for (const v of dados.volumes) if (v.total === "MONTAGEM" && v.obraId === obra.id) m.set(v.linhaId, (m.get(v.linhaId) ?? 0) + v.quantidade);
      return m;
    };
    for (const dados of [dadosDoMes, dadosDoAno]) {
      const p = pesosDaBase(base, u, dados, obra);
      if (p.size) return p;
      if (u === 3 && base === "DIAS_ACOMPANHAMENTO") {
        const m = montagem(dados);
        if (m.size) return m;
      }
    }
    return null;
  };

  const linhaDRE = new Map(est.map((l) => [l.codigo, l]));
  for (const row of unidades) {
    const u = row.unidadeNegocio!.codigo;
    const codigo = row.linhaDRE.codigo;
    const V = Number(row.valor);
    if (codigo === MC) r.mcDaDRE.set(u, V);
    if (row.linhaDRE.tipo !== "ITEM") continue;
    const grupo = prefixo(codigo);

    if (grupo === "ROB" || grupo === "ROL") {
      // A receita: pela Receita Prévia das linhas, na natureza da conta (bruta ou líquida).
      const natureza = NATUREZA_DA_RECEITA[codigo.split(".")[1]];
      const pesos = new Map<string, number>();
      for (const i of dadosDoMes.receita) {
        if (i.unidade !== u || i.natureza !== natureza) continue;
        const k = i.linhaId ?? semLinha(u);
        pesos.set(k, (pesos.get(k) ?? 0) + (grupo === "ROL" ? i.liquida : i.bruta));
      }
      // A receita sem linha na Receita Prévia (ou a conta sem itens no mês, como as devoluções contábeis) segue a receita
      // bruta das linhas da unidade; sem nenhuma, fica Sem Linha.
      const pelaReceita = (valor: number) => alocar(valor, new Map(), [{ nivel: "UNIDADE", pesos: () => pesosDaBase("RECEITA", u, dadosDoMes) }], semLinha(u));
      const soma = [...pesos.values()].reduce((s, v) => s + v, 0);
      const partes =
        Math.abs(soma) < 0.005
          ? Math.abs(V) >= 0.005
            ? pelaReceita(V)
            : []
          : [...pesos].flatMap(([linhaId, p]) => (linhaId === semLinha(u) ? pelaReceita((V * p) / soma) : [{ linhaId, nivel: "RECEITA" as Nivel, valor: (V * p) / soma }]));
      registrar(u, codigo, partes, false);
      // Nas obras (03/11/2026), a receita de cada linha pela da obra na Receita Prévia: a da natureza da conta ou, na parte
      // que seguiu a receita bruta da unidade, a receita bruta da obra na linha.
      for (const p of partes) {
        const daObra = new Map<string, number>();
        for (const i of dadosDoMes.receita) {
          if (i.unidade !== u || i.linhaId !== p.linhaId) continue;
          if (p.nivel === "RECEITA" ? i.natureza !== natureza : p.nivel !== "UNIDADE" || i.natureza === "DEVOLUCOES_INVENTARIOS") continue;
          const k = obraDaReceita(i.obraCodigo);
          daObra.set(k, (daObra.get(k) ?? 0) + (p.nivel === "RECEITA" && grupo === "ROL" ? i.liquida : i.bruta));
        }
        for (const [obra, v] of dividirPelasObras(p.valor, daObra)) somarNaObra(r.obras, p.linhaId, obra, codigo, v, true);
      }
      const sem = partes.filter((p) => p.nivel === "SEM_LINHA").reduce((s, p) => s + p.valor, 0);
      if (Math.abs(sem) >= 1) r.avisos.push(`${NOME_DA_UNIDADE[u]}: ${linhaDRE.get(codigo)?.descricao ?? codigo} de ${sem.toFixed(2)} sem linha na Receita Prévia e sem receita na unidade: ficou Sem Linha.`);
      continue;
    }
    if (!CUSTOS.has(grupo)) continue;

    // Os custos: os lançamentos que formaram o valor da unidade (os diretos e os rateios, pela composição gravada).
    const comp = row.composicao as Composicao | null;
    const partes: Array<{ f: Fonte | null; a: number; destino?: string }> = [];
    const casa = (o: OrigemContabil, f: Fonte) => (o.pares ? o.pares.some((p) => p.balde === f.balde && (p.filial === undefined || p.filial === f.filial)) : o.baldes ? o.baldes.includes(f.balde) : true);
    for (const o of [comp?.origem?.contabil, comp?.origem?.contabilPar]) {
      if (!o) continue;
      const fator = o.fator ? Number(o.fator) : 1;
      for (const f of fontesDaLinha.get(o.linhaId) ?? []) if (!f.rateio && casa(o, f)) partes.push({ f, a: fator * f.valor });
    }
    for (const x of comp?.rateios ?? []) {
      const linhaId = x.linhaId ?? comp?.origem?.contabil?.linhaId;
      const p = Number(x.percentual);
      for (const f of linhaId ? (fontesDaLinha.get(linhaId) ?? []) : []) if (f.rateio && f.balde === x.chave && f.rateioDe === (x.competenciaId ?? null)) partes.push({ f, a: p * f.valor, destino: x.destino });
    }
    const refeito = partes.reduce((s, p) => s + p.a, 0);
    if (Math.abs(V - refeito) >= 0.01) {
      partes.push({ f: null, a: V - refeito });
      if (Math.abs(V - refeito) >= 1)
        r.avisos.push(`${NOME_DA_UNIDADE[u]}: ${linhaDRE.get(codigo)?.descricao ?? codigo} — a DRE (${V.toFixed(2)}) difere dos lançamentos (${refeito.toFixed(2)}); a diferença foi pelo volume da unidade.`);
    }
    for (const { f, a, destino } of partes) {
      if (Math.abs(a) < 1e-9) continue;
      const tarefa = new Map([...(f ? (fracoes.get(chaveDoDocumento(f.reduzido, f.codigoCentro, f.filial)) ?? new Map<string, number>()) : new Map<string, number>())].filter(([l]) => porUnidade.get(u)!.has(l)));
      // O rateio fixo com os percentuais por linha (26/10/2026): só as linhas da unidade.
      const fixo = f?.rateio && destino ? fixoDoDestino.get(`${f.balde}|${destino}`) : undefined;
      const passos: Passo[] = [
        { nivel: "CENTRO", pesos: () => (f?.centroCustoId ? pelaRegra(u, regraDoCentro.get(f.centroCustoId)) : null) },
        { nivel: "OBRA", pesos: () => pelaObra(u, f, grupo) },
        { nivel: "FIXO", pesos: () => (fixo ? new Map([...fixo].filter(([l, p]) => p > 0 && porUnidade.get(u)!.has(l))) : null) },
        { nivel: "RATEIO", pesos: () => (f ? pelaRegra(u, regraDoBalde.get(f.balde)) : null) },
        { nivel: "UNIDADE", pesos: () => pesosDaBase(baseDaUnidade(u), u, dadosDoMes) },
      ];
      // A obra pelo centro que vale (13/11/2026): o movimento que saiu da obra (contestação, reclassificação por fornecedor ou
      // redistribuição) não é mais direto nela.
      const doCentroDeObra = !!f?.codigoDaObra && ehCentroDeObra(f.codigoDaObra);
      const alocado = alocar(a, tarefa, passos, semLinha(u));
      registrar(u, codigo, alocado, doCentroDeObra);
      // O lançamento do centro de obra é direto na obra (03/11/2026), em cada linha a que foi.
      if (doCentroDeObra) {
        const obra = obraDoNumero.get(numeroDaObra(f!.codigoDaObra!))?.id ?? SEM_OBRA;
        for (const p of alocado) somarNaObra(r.obras, p.linhaId, obra, codigo, p.valor, true);
      }
    }
  }

  // Os volumes de cada linha (as linhas P e S da DRE), pelas listas.
  for (const u of [1, 2, 3]) {
    for (const l of est) {
      if (l.tipo !== "ITEM" || !l.unidades.includes(u) || (prefixo(l.codigo) !== "P" && prefixo(l.codigo) !== "S")) continue;
      const totais = VOLUMES_DA_DRE[u]?.[n(l.descricao)] ?? [];
      for (const [linhaId, v] of volumeDaLinhaDRE(totais, dadosDoMes.volumes)) if (porUnidade.get(u)!.has(linhaId)) somar(r.valores, linhaId, l.codigo, v);
      // E os de cada obra (03/11/2026).
      for (const v of dadosDoMes.volumes) if (totais.includes(v.total) && porUnidade.get(u)!.has(v.linhaId)) somarNaObra(r.obras, v.linhaId, v.obraId ?? SEM_OBRA, l.codigo, v.quantidade, true);
    }
  }

  // O rateio de cada linha entre as obras dela (03/11/2026): os custos que não vieram dos centros de obra, pelas bases da
  // etapa Linhas (no mês e, sem elas, no exercício até ele); o que nenhuma base leva, e o da Sem Linha, fica Sem Obra.
  const linhaPorId = new Map(linhas.map((l) => [l.id, l]));
  const cache = new Map<string, Map<string, number>>();
  const pesos = (base: BaseDaObra, linhaId: string, doAno: boolean) => {
    const k = `${base}|${linhaId}|${doAno ? 1 : 0}`;
    if (!cache.has(k)) cache.set(k, pesosDasObras(base, linhaId, doAno ? dadosDoAno : dadosDoMes, genericas, obraDaReceita));
    return cache.get(k)!;
  };
  for (const [chave, itens] of r.valores) {
    const linha = linhaPorId.get(chave);
    for (const [codigo, v] of itens) {
      const grupo = prefixo(codigo);
      if (!CUSTOS.has(grupo)) continue;
      const rateado = v - (r.naObra.get(chave)?.get(codigo) ?? 0);
      if (Math.abs(rateado) < 1e-9) continue;
      const bases = linha ? basesDoRateio(grupo, linha.unidade, linha.codigo) : [];
      const divisao = ratearEntreObras(rateado, [...bases.map((b) => () => pesos(b, chave, false)), ...bases.map((b) => () => pesos(b, chave, true))]);
      for (const [obra, x] of divisao) somarNaObra(r.obras, chave, obra, codigo, x, false);
    }
  }
  return r;
}

/** Os totais da linha (as subtotais e os totais do escopo), pelas expressões da DRE; só os que têm algum item com valor. */
export function comTotais(itens: Map<string, number>, est: LinhaDRE[], noEscopo: Set<string>) {
  const valores = new Map(itens);
  const porCodigo = new Map(est.map((l) => [l.codigo, l]));
  const avaliar = (codigo: string, pilha = new Set<string>()): number | undefined => {
    if (valores.has(codigo)) return valores.get(codigo);
    const l = porCodigo.get(codigo);
    if (!l || l.tipo === "ITEM" || l.tipo === "SECAO" || !l.expressao || !noEscopo.has(codigo) || pilha.has(codigo)) return undefined;
    pilha.add(codigo);
    let algum = false;
    const v = Number(
      avaliarExpressao(l.expressao, (c) => {
        const x = avaliar(c, pilha);
        if (x !== undefined) algum = true;
        return new Decimal(x ?? 0);
      }),
    );
    if (!algum) return undefined;
    valores.set(codigo, v);
    return v;
  };
  for (const l of est) if (noEscopo.has(l.codigo)) avaliar(l.codigo);
  return valores;
}


const arredonda = (x: number) => Math.round(x * 100) / 100;
/** O valor em reais nos avisos das obras ("R$ 27.420,46"). */
const reais = (x: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(x);
const rotulo = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;
/** O mês no rótulo das colunas, como nos Resultados Empresariais ("SET/26"). */
const MESES_CURTOS = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const ROL = "RO.RECEITA_OPERACIONAL_LIQUIDA_ROL";
/** As linhas da DRE das abas Linhas (da receita à Margem de Contribuição) e Rateios das Linhas (os custos, sobre os volumes). */
export const DO_RESULTADO = new Set([...ITENS, ...SECOES, "RO", "IRB", "CPV", "MB", "MC"]);

export class RegraLinhasError extends Error {
  constructor(
    readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

/** O resumo da etapa Linhas gravado na competência (Competencia.apuracaoLinhas), com as unidades pelo código. */
export type ApuracaoLinhas = {
  gravadaEm: string;
  /** De que passo da Alocação nas Linhas veio cada valor, por unidade. */
  niveis: Record<string, Partial<Record<Nivel, number>>>;
  /** A Margem de Contribuição da DRE apurada de cada unidade (a Conferência). */
  mcDaDRE: Record<string, number>;
  documentos: { requisicoes: number; notas: number };
  avisos: string[];
  /**
   * As obras (03/11/2026, o Realizado por Obra): quando foram gravadas, quantas, o que ficou Sem Obra nos custos e os avisos.
   * Sem elas, a competência foi apurada (ou gravada) antes.
   */
  obras?: { gravadasEm: string; obras: number; semObra: number; avisos: string[] };
};

/** Os valores gravados de uma competência: por chave da linha (o id, ou a Sem Linha da unidade) e por código da DRE. */
type Gravado = { valores: Map<string, Map<string, number>>; naObra: Map<string, Map<string, number>> };

async function gravados(competenciaIds: string[], linhaId?: string): Promise<Map<string, Gravado>> {
  const rows = await getPrismaClient().resultadoLinha.findMany({
    where: { competenciaId: { in: competenciaIds }, ...(linhaId ? { linhaId } : {}) },
    select: { competenciaId: true, unidade: true, linhaId: true, valor: true, naObra: true, linhaDRE: { select: { codigo: true } } },
  });
  const r = new Map<string, Gravado>(competenciaIds.map((id) => [id, { valores: new Map(), naObra: new Map() }]));
  for (const x of rows) {
    const g = r.get(x.competenciaId)!;
    const chave = x.linhaId ?? semLinha(x.unidade);
    for (const [alvo, v] of [
      [g.valores, Number(x.valor)],
      [g.naObra, Number(x.naObra)],
    ] as const) {
      const m = alvo.get(chave) ?? new Map<string, number>();
      m.set(x.linhaDRE.codigo, (m.get(x.linhaDRE.codigo) ?? 0) + v);
      alvo.set(chave, m);
    }
  }
  return r;
}

/** Os itens de uma linha num mês, no escopo e com os totais; `rateado`: nos custos, só a parte que não veio dos centros de obra. */
function itensDaLinha(g: Gravado, chave: string, est: LinhaDRE[], s: Set<string>, rateado = false) {
  const obra = g.naObra.get(chave) ?? new Map<string, number>();
  const itens = new Map<string, number>();
  for (const [codigo, v] of g.valores.get(chave) ?? []) {
    if (!s.has(codigo)) continue;
    itens.set(codigo, arredonda(rateado && CUSTOS.has(prefixo(codigo)) ? v - (obra.get(codigo) ?? 0) : v));
  }
  return comTotais(itens, est, s);
}

/**
 * As competências fechadas do exercício até o mês. Só as que têm as linhas gravadas contam como apuradas; as fechadas
 * antes da etapa Linhas (26/10/2026) e ainda sem a gravação vão em `semLinhas`.
 */
/**
 * Os meses das abas: as competências fechadas do exercício até `ate` (Resultados Empresariais) ou, com `soOMes`
 * (27/10/2026: a etapa Linhas do Fechamento Mensal), só a competência `ate`, em qualquer situação, com as linhas da
 * última apuração.
 */
async function periodo(ano: number, ate?: number, soOMes = false) {
  if (soOMes && ate) {
    const c = await getPrismaClient().competencia.findUnique({ where: { ano_mes: { ano, mes: ate } }, select: { id: true, apuracaoLinhas: true } });
    if (!c) throw new RegraLinhasError(404, `A competência ${rotulo(ano, ate)} não existe.`);
    const gravada = c.apuracaoLinhas !== null;
    const rotuloDoMes = `${MESES_CURTOS[ate - 1]}/${String(ano).slice(2)}`;
    return { ultimo: ate, meses: [{ mes: ate, rotulo: rotuloDoMes, apurado: gravada, competenciaId: gravada ? c.id : null }], semLinhas: gravada ? [] : [rotuloDoMes] };
  }
  const { ultimo, meses } = await mesesDoExercicio(ano, ate, true);
  const ids = meses.flatMap((m) => (m.competenciaId ? [m.competenciaId] : []));
  const comps = await getPrismaClient().competencia.findMany({ where: { id: { in: ids } }, select: { id: true, apuracaoLinhas: true } });
  const comLinhas = new Set(comps.filter((c) => c.apuracaoLinhas !== null).map((c) => c.id));
  const gravada = (id: string | null) => id !== null && comLinhas.has(id);
  return {
    ultimo,
    meses: meses.map((m) => ({ mes: m.mes, rotulo: m.rotulo, apurado: gravada(m.competenciaId), competenciaId: gravada(m.competenciaId) ? m.competenciaId : null })),
    semLinhas: meses.filter((m) => m.competenciaId !== null && !gravada(m.competenciaId)).map((m) => m.rotulo),
  };
}

const descricaoDaLinha = (l: LinhaDoNegocio) => ({ id: l.id, codigo: l.codigo, nome: l.nome, unidade: l.unidade, nomeUnidade: NOME_DA_UNIDADE[l.unidade], ativo: l.ativo });

export const resultadosLinhaService = {
  /**
   * A etapa Linhas da apuração (26/10/2026): divide a DRE apurada de cada unidade entre as linhas dela e grava o valor de
   * cada linha em cada item (ResultadoLinha), com o resumo na competência (os passos, os documentos e os avisos). A obra
   * sem produção no mês usa a do exercício até ele.
   */
  async apurar(competenciaId: string, soObras = false) {
    const prisma = getPrismaClient();
    const c = await prisma.competencia.findUniqueOrThrow({ where: { id: competenciaId }, select: { id: true, ano: true, mes: true, apuracaoLinhas: true } });
    const [linhas, est, codigos, doAno] = await Promise.all([
      linhasDoNegocio(),
      estruturaDaDRE(),
      prisma.linhaDRE.findMany({ select: { id: true, codigo: true } }),
      prisma.competencia.findMany({ where: { ano: c.ano, mes: { lte: c.mes } }, select: { id: true }, orderBy: { mes: "asc" } }),
    ]);
    const dadosDoAno: DadosDoMes = { volumes: [], receita: [] };
    let dadosDoMes: DadosDoMes = { volumes: [], receita: [] };
    for (const x of doAno) {
      const d = { volumes: await volumesDoMes(x.id, linhas), receita: await receitaDoMes(x.id, linhas) };
      dadosDoAno.volumes.push(...d.volumes);
      dadosDoAno.receita.push(...d.receita);
      if (x.id === c.id) dadosDoMes = d;
    }
    const r = await calcularMes(c, linhas, est, dadosDoMes, dadosDoAno);

    const idDoCodigo = new Map(codigos.map((l) => [l.codigo, l.id]));
    const unidadeDa = new Map(linhas.map((l) => [l.id, l.unidade]));
    const rows: Prisma.ResultadoLinhaCreateManyInput[] = [];
    for (const [chave, itens] of r.valores) {
      const sem = chave.startsWith("SEM_LINHA|");
      const unidade = sem ? Number(chave.split("|")[1]) : unidadeDa.get(chave);
      if (!unidade) continue;
      for (const [codigo, valor] of itens) {
        const naObra = r.naObra.get(chave)?.get(codigo) ?? 0;
        const linhaDREId = idDoCodigo.get(codigo);
        if (!linhaDREId || (Math.abs(valor) < 1e-9 && Math.abs(naObra) < 1e-9)) continue;
        rows.push({ competenciaId: c.id, unidade, linhaId: sem ? null : chave, linhaDREId, valor: new Decimal(valor), naObra: new Decimal(naObra) });
      }
    }
    // As obras de cada linha (03/11/2026, o Realizado por Obra).
    const obras: Prisma.ResultadoObraCreateManyInput[] = [];
    // Os custos Sem Obra: os diretos (de centros de obra sem a obra no cadastro) e os do rateio (sem base).
    const semObra = { direto: 0, rateio: 0 };
    for (const [chave, porObra] of r.obras) {
      const sem = chave.startsWith("SEM_LINHA|");
      const unidade = sem ? Number(chave.split("|")[1]) : unidadeDa.get(chave);
      if (!unidade) continue;
      for (const [obra, itens] of porObra) {
        for (const [codigo, { valor, direto }] of itens) {
          const linhaDREId = idDoCodigo.get(codigo);
          if (!linhaDREId || Math.abs(valor) < 1e-9) continue;
          if (obra === SEM_OBRA && CUSTOS.has(prefixo(codigo))) {
            semObra.direto += direto;
            semObra.rateio += valor - direto;
          }
          obras.push({ competenciaId: c.id, unidade, linhaId: sem ? null : chave, obraId: obra === SEM_OBRA ? null : obra, linhaDREId, valor: new Decimal(valor), direto: new Decimal(direto) });
        }
      }
    }
    const avisosDasObras: string[] = [];
    if (Math.abs(semObra.direto) >= 1) avisosDasObras.push(`${reais(semObra.direto)} dos custos de centros de obra sem a obra no cadastro ficaram Sem Obra.`);
    if (Math.abs(semObra.rateio) >= 1)
      avisosDasObras.push(`${reais(semObra.rateio)} do rateio ficaram Sem Obra: o da Sem Linha e o das linhas sem base (volume ou receita das obras vendidas) no mês e no exercício.`);
    const anterior = c.apuracaoLinhas as ApuracaoLinhas | null;
    if (soObras) {
      // As linhas gravadas antes ficam: as obras saem do cálculo de hoje, e a diferença para elas vira aviso.
      const gravadas = await prisma.resultadoLinha.findMany({ where: { competenciaId: c.id }, select: { unidade: true, linhaId: true, valor: true, linhaDRE: { select: { codigo: true } } } });
      const codigoDoId = new Map(codigos.map((l) => [l.id, l.codigo]));
      const deHoje = new Map(rows.map((x) => [`${x.linhaId ?? semLinha(x.unidade)}|${codigoDoId.get(x.linhaDREId)}`, Number(x.valor)]));
      let maior = 0;
      for (const g of gravadas) {
        const k = `${g.linhaId ?? semLinha(g.unidade)}|${g.linhaDRE.codigo}`;
        maior = Math.max(maior, Math.abs(Number(g.valor) - (deHoje.get(k) ?? 0)));
        deHoje.delete(k);
      }
      for (const v of deHoje.values()) maior = Math.max(maior, Math.abs(v));
      if (maior >= 1) avisosDasObras.push(`As obras saíram dos cadastros de hoje e diferem das linhas gravadas em até ${reais(maior)} num item.`);
    }
    const resumoDasObras = {
      gravadasEm: new Date().toISOString(),
      obras: new Set(obras.map((x) => x.obraId).filter(Boolean)).size,
      semObra: arredonda(semObra.direto + semObra.rateio),
      avisos: avisosDasObras,
    };
    const resumo: ApuracaoLinhas =
      soObras && anterior
        ? { ...anterior, obras: resumoDasObras }
        : {
            gravadaEm: new Date().toISOString(),
            niveis: Object.fromEntries([...r.niveis].map(([u, m]) => [String(u), Object.fromEntries(m)])),
            mcDaDRE: Object.fromEntries([...r.mcDaDRE].map(([u, v]) => [String(u), v])),
            documentos: r.documentos,
            avisos: r.avisos,
            obras: resumoDasObras,
          };
    // Em lotes: cada registro leva até oito parâmetros, e o PostgreSQL aceita até 65 535 por comando.
    const emLotes = <T,>(xs: T[], criar: (lote: T[]) => Prisma.PrismaPromise<unknown>) => Array.from({ length: Math.ceil(xs.length / 5000) }, (_, i) => criar(xs.slice(i * 5000, (i + 1) * 5000)));
    await prisma.$transaction([
      ...(soObras ? [] : [prisma.resultadoLinha.deleteMany({ where: { competenciaId: c.id } }), ...emLotes(rows, (data) => prisma.resultadoLinha.createMany({ data }))]),
      prisma.resultadoObra.deleteMany({ where: { competenciaId: c.id } }),
      ...emLotes(obras, (data) => prisma.resultadoObra.createMany({ data })),
      prisma.competencia.update({ where: { id: c.id }, data: { apuracaoLinhas: resumo as unknown as Prisma.InputJsonValue } }),
    ]);
    const semLinhaNosCustos = [...r.valores].filter(([k]) => k.startsWith("SEM_LINHA|")).reduce((s, [, m]) => s + [...m].filter(([cod]) => CUSTOS.has(prefixo(cod)) || prefixo(cod) === "ROB").reduce((t, [, v]) => t + v, 0), 0);
    return { registros: rows.length, linhas: new Set(rows.map((x) => x.linhaId).filter(Boolean)).size, semLinha: arredonda(semLinhaNosCustos), avisos: r.avisos, obras: resumoDasObras };
  },

  /**
   * As linhas das unidades pedidas, para a lista das abas Linhas e Rateios das Linhas dos Resultados Empresariais: as ativas
   * e as inativas com valor nas competências fechadas do exercício até o mês.
   */
  async listar(ano: number, ate: number | undefined, unidades: number[], soOMes = false) {
    const p = await periodo(ano, ate, soOMes);
    const ids = p.meses.flatMap((m) => (m.competenciaId ? [m.competenciaId] : []));
    const comValor = new Set(
      (await getPrismaClient().resultadoLinha.groupBy({ by: ["linhaId"], where: { competenciaId: { in: ids }, linhaId: { not: null }, valor: { not: 0 } } })).map((x) => x.linhaId),
    );
    const linhas = (await linhasDoNegocio()).filter((l) => unidades.includes(l.unidade) && (l.ativo || comValor.has(l.id)));
    return { ano, ate: p.ultimo, linhas: linhas.map(descricaoDaLinha), semLinhas: p.semLinhas };
  },

  /**
   * A DRE de uma linha mês a mês, da receita à Margem de Contribuição (a aba Linhas), ou só os custos dela que não vieram
   * dos centros de obra, sobre os volumes (`rateios`: a aba Rateios das Linhas, o que os Resultados por Obra levam às obras).
   */
  async linha(ano: number, ate: number | undefined, linhaId: string, rateios: boolean, unidades: number[], soOMes = false) {
    const l = (await linhasDoNegocio()).find((x) => x.id === linhaId && unidades.includes(x.unidade));
    if (!l) throw new RegraLinhasError(404, "A linha não existe ou não é de uma unidade que o seu perfil lê.");
    const [p, est] = await Promise.all([periodo(ano, ate, soOMes), estruturaDaDRE()]);
    const g = await gravados(p.meses.flatMap((m) => (m.competenciaId ? [m.competenciaId] : [])), l.id);
    const s = escopo(est, rateios ? DOS_RATEIOS : DO_RESULTADO);
    const valores = p.meses.map((m) => (m.competenciaId ? itensDaLinha(g.get(m.competenciaId)!, l.id, est, s, rateios) : new Map<string, number>()));
    return {
      ano,
      ate: p.ultimo,
      meses: p.meses.map(({ mes, rotulo, apurado }) => ({ mes, rotulo, apurado })),
      linhas: montar(est.filter((x) => s.has(x.codigo)), l.unidade as 1 | 2 | 3, p.meses.map((m) => m.apurado), valores, valores, ACESSO_TOTAL).map((x) => ({ ...x, podeDetalhar: false })),
      linha: descricaoDaLinha(l),
      semLinhas: p.semLinhas,
    };
  },

  /**
   * A etapa Linhas do Fechamento Mensal: a conferência do mês gravado — a Margem de Contribuição da DRE de cada unidade
   * contra a soma das linhas, a Sem Linha, de que passo veio cada valor, os documentos e os avisos — e a receita líquida e
   * a margem de cada linha.
   */
  async doMes(ano: number, mes: number) {
    const prisma = getPrismaClient();
    const c = await prisma.competencia.findUnique({ where: { ano_mes: { ano, mes } }, select: { id: true, status: true, apuradaEm: true, apuracaoLinhas: true } });
    if (!c) throw new RegraLinhasError(404, `A competência ${rotulo(ano, mes)} não existe.`);
    const resumo = c.apuracaoLinhas as ApuracaoLinhas | null;
    // A competência fechada sem as linhas, ou com elas e sem as obras (03/11/2026), grava aqui o que falta.
    const situacao = {
      status: c.status,
      apurada: c.apuradaEm !== null,
      gravadaEm: resumo?.gravadaEm ?? null,
      obrasGravadasEm: resumo?.obras?.gravadasEm ?? null,
      podeGravar: c.status === "FECHADA" && !resumo?.obras,
    };
    if (!resumo) return { situacao, unidades: [], niveis: [], documentos: null, avisos: [], obras: null, linhas: [] };
    const [linhas, est, g] = await Promise.all([linhasDoNegocio(), estruturaDaDRE(), gravados([c.id])]);
    const gravado = g.get(c.id)!;
    const s = escopo(est, DO_RESULTADO);
    const totais = new Map([...gravado.valores.keys()].map((k) => [k, itensDaLinha(gravado, k, est, s)]));
    const soma = (xs: number[]) => arredonda(xs.reduce((a, b) => a + b, 0));
    return {
      situacao,
      unidades: [1, 2, 3].map((u) => ({
        unidade: u,
        nome: NOME_DA_UNIDADE[u],
        mcDaDRE: arredonda(resumo.mcDaDRE[u] ?? 0),
        mcDasLinhas: soma([...linhas.filter((l) => l.unidade === u).map((l) => l.id), semLinha(u)].map((k) => totais.get(k)?.get(MC) ?? 0)),
        semLinha: soma([...(gravado.valores.get(semLinha(u)) ?? [])].filter(([cod]) => CUSTOS.has(prefixo(cod)) || prefixo(cod) === "ROB").map(([, v]) => v)),
      })),
      niveis: (Object.keys(ROTULO_DO_NIVEL) as Nivel[])
        .map((nivel) => ({ nivel, rotulo: ROTULO_DO_NIVEL[nivel], porUnidade: [1, 2, 3].map((u) => arredonda(resumo.niveis[u]?.[nivel] ?? 0)) }))
        .filter((x) => x.porUnidade.some((v) => Math.abs(v) >= 0.005)),
      documentos: resumo.documentos,
      avisos: resumo.avisos,
      obras: resumo.obras ?? null,
      linhas: linhas
        .filter((l) => l.ativo || totais.has(l.id))
        .map((l) => ({ ...descricaoDaLinha(l), receitaLiquida: totais.get(l.id)?.get(ROL) ?? null, mc: totais.get(l.id)?.get(MC) ?? null })),
    };
  },

  /**
   * Grava as linhas e as obras de uma competência fechada antes da etapa Linhas (26/10/2026), com a Alocação nas Linhas e as
   * tarefas de hoje; na fechada com as linhas e sem as obras (03/11/2026, o Realizado por Obra), só as obras, com as linhas
   * gravadas como estão. Uma vez só: depois, mudam como o resto do mês, reabrindo e reapurando.
   */
  async gravarFechada(ano: number, mes: number, usuarioId: string) {
    const c = await getPrismaClient().competencia.findUnique({ where: { ano_mes: { ano, mes } }, select: { id: true, status: true, apuracaoLinhas: true } });
    if (!c) throw new RegraLinhasError(404, `A competência ${rotulo(ano, mes)} não existe.`);
    if (c.status !== "FECHADA") throw new RegraLinhasError(409, `A competência ${rotulo(ano, mes)} está aberta: as linhas dela são gravadas na apuração.`);
    const anterior = c.apuracaoLinhas as ApuracaoLinhas | null;
    if (anterior?.obras) throw new RegraLinhasError(409, `As linhas e as obras de ${rotulo(ano, mes)} já estão gravadas: para refazê-las, reabra a competência e apure de novo.`);
    const soObras = anterior !== null;
    const r = await this.apurar(c.id, soObras);
    await auditar({
      usuarioId,
      acao: "APURACAO",
      entidade: "competencia",
      entidadeId: c.id,
      metadados: {
        competencia: rotulo(ano, mes),
        resultado: soObras ? "obras gravadas na competência fechada" : "linhas e obras gravadas na competência fechada",
        etapas: ["linhas"],
        ...(soObras ? {} : { registros: r.registros, semLinha: r.semLinha }),
        obras: r.obras.obras,
        semObra: r.obras.semObra,
      },
    });
    return this.doMes(ano, mes);
  },
};
