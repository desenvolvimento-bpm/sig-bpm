import { createHash } from "node:crypto";

import { getPrismaClient } from "../../config/prisma.js";
import type { LinhaEstrutura } from "../dre/apuracaoUnidades.js";
import { estrutura as estruturaDRE } from "../dre/dreService.js";
import { percentuaisPelasRegras, regrasDeRateio } from "../volumes/vigenciaDosRateios.js";
import { alocarCentros, gruposDoCenario, type GrupoDoCenario, type Percentuais } from "./centrosCenario.js";
import { C, calcularPremissas, calcularTabela, linhasDaTabela, linhasDoCadastro, VENDAS_DA_UNIDADE, type LinhaDoCadastro, type UnidadePremissa } from "./premissasCenario.js";
import { basesDosProjetos, ondeEstaoOsProjetos } from "./projetosCenario.js";

/**
 * As Verificações das Premissas dos cenários analíticos (20/11/2026, pedido do Adão): as inconsistências nos valores digitados ou
 * importados, cada uma ligada à aba dela (a linha ou o centro de custo, quando há), que pedem a correção ou o De Acordo de quem
 * alterou os valores por último (o Histórico). Com alguma pendente, a versão do cenário não se congela.
 *
 * - Matriz, Filial e Serviços: os valores por unidade (receitas, impostos, custos, kg) em meses sem volume, que não geram
 *   resultado; e o volume sem a Receita Bruta Média.
 * - Quadro de Lotação: os colaboradores sem salário, o salário sem colaboradores, a linha PJ sem aumento no ano e o salário por
 *   colaborador que cai sem mudar os colaboradores.
 * - Centros de Custo: os salários de um tipo de colaborador que não variam quando a quantidade varia (no grupo), o grupo com
 *   colaboradores no Quadro de Lotação e sem Remunerações ou sem Gastos Gerais (GGD, GGI ou GGC) no mês (mesmo dia, pedido do
 *   Adão) e os valores que o rateio do grupo não leva a nenhuma unidade (a chave sem base no mês, a conta sem destino).
 *
 * O cálculo é puro (`verificar`): recebe os dados do cenário e devolve as verificações, com a assinatura dos valores envolvidos
 * (o De Acordo vale enquanto ela não muda) e onde procurar no Histórico quem os alterou (`responsavelDa`).
 */

export type TipoDeVerificacao =
  | "VALORES_SEM_VOLUME"
  | "VOLUME_SEM_RECEITA"
  | "COLABORADORES_SEM_SALARIO"
  | "SALARIO_SEM_COLABORADORES"
  | "PJ_SEM_AUMENTO"
  | "SALARIO_QUE_CAI"
  | "SALARIOS_SEM_VARIACAO"
  | "QUADRO_SEM_REMUNERACOES"
  | "QUADRO_SEM_GASTOS_GERAIS"
  | "VALORES_FORA_DA_DRE";

export const TITULO_DA_VERIFICACAO: Record<TipoDeVerificacao, string> = {
  VALORES_SEM_VOLUME: "Valores sem Volume",
  VOLUME_SEM_RECEITA: "Volume sem Receita",
  COLABORADORES_SEM_SALARIO: "Colaboradores sem Salário",
  SALARIO_SEM_COLABORADORES: "Salário sem Colaboradores",
  PJ_SEM_AUMENTO: "PJ sem Aumento no Ano",
  SALARIO_QUE_CAI: "Salário que Cai",
  SALARIOS_SEM_VARIACAO: "Salários que Não Variam com os Colaboradores",
  QUADRO_SEM_REMUNERACOES: "Quadro de Lotação sem Remunerações",
  QUADRO_SEM_GASTOS_GERAIS: "Quadro de Lotação sem Gastos Gerais",
  VALORES_FORA_DA_DRE: "Valores Fora da DRE",
};

/** As abas das Premissas (as chaves da tela). */
export type AbaDaVerificacao = "1" | "2" | "3" | "quadro" | "centros";
export const ROTULO_DA_ABA: Record<AbaDaVerificacao, string> = { 1: "Matriz", 2: "Filial", 3: "Serviços", quadro: "Quadro de Lotação", centros: "Centros de Custo" };

/** Onde procurar no Histórico quem alterou os valores de uma verificação. */
export type OrigemDaVerificacao =
  | { tipo: "PREMISSAS"; unidade: number; venda: string; chaves: string[] }
  | { tipo: "QUADRO"; linhas: string[] }
  | { tipo: "CENTROS"; grupo: string; contas: string[] };

export type Verificacao = {
  /** A chave estável da verificação (o De Acordo fica nela). */
  chave: string;
  tipo: TipoDeVerificacao;
  aba: AbaDaVerificacao;
  /** O grupo de centros (Quadro de Lotação e Centros de Custo): o recorte e o grupo que a aba abre. */
  grupo: string | null;
  /** A linha ou o centro de custo (o que a aba mostra). */
  alvo: string;
  /** A venda (Global ou Mercantil) nas abas das unidades. */
  venda: string | null;
  descricao: string;
  meses: number[];
  /** O resumo dos valores envolvidos: mudou, o De Acordo deixa de valer. */
  assinatura: string;
  origem: OrigemDaVerificacao;
};

/** Uma linha do Quadro de Lotação do cenário, com o centro, a função e os meses. */
export type LinhaDoQuadroVerificada = {
  id: string;
  vinculo: "CLT" | "PJ" | "APRENDIZ" | "ESTAGIARIO";
  funcao: string;
  unidade: string;
  centroCustoId: string;
  /** O código e o nome do centro (o que a aba mostra). */
  centro: string;
  meses: Array<{ mes: number; colaboradores: number; salario: number }>;
};

export type DadosDasVerificacoes = {
  ano: number;
  est: LinhaEstrutura[];
  linhas: LinhaDoCadastro[];
  premissas: Array<{ unidade: number; venda: string; chave: string; mes: number; valor: number }>;
  grupos: GrupoDoCenario[];
  centros: Array<{ grupo: string; codigo: string; mes: number; valor: number }>;
  percentuais: Percentuais[];
  quadro: LinhaDoQuadroVerificada[];
};

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
/** Os meses em texto, com as sequências juntas: "Jan a Abr, Jun e Dez". */
export function textoDosMeses(meses: number[]) {
  const ordem = [...new Set(meses)].sort((a, b) => a - b);
  const partes: string[] = [];
  for (let i = 0; i < ordem.length; ) {
    let j = i;
    while (j + 1 < ordem.length && ordem[j + 1] === ordem[j] + 1) j++;
    if (j - i >= 2) partes.push(`${MESES[ordem[i] - 1]} a ${MESES[ordem[j] - 1]}`);
    else partes.push(...ordem.slice(i, j + 1).map((m) => MESES[m - 1]));
    i = j + 1;
  }
  return partes.length > 1 ? `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}` : (partes[0] ?? "");
}
const nMeses = (n: number) => `${n} ${n === 1 ? "mês" : "meses"}`;
const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const assinar = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 24);
const quase = (a: number, b: number, tol = 0.005) => Math.abs(a - b) <= tol;
const MESES_DO_ANO = Array.from({ length: 12 }, (_, k) => k + 1);

const VINCULO: Record<LinhaDoQuadroVerificada["vinculo"], string> = { CLT: "CLT", PJ: "PJ", APRENDIZ: "Aprendiz", ESTAGIARIO: "Estagiário" };
const TIPO_NO_GRUPO: Record<LinhaDoQuadroVerificada["vinculo"], string> = { CLT: "CLT", PJ: "PJ", APRENDIZ: "Aprendizes", ESTAGIARIO: "Estagiários" };
/** As chaves de rateio (os baldes que se rateiam), como em centrosCenario. */
const CHAVES_DE_RATEIO: Record<string, string> = { PRODUCAO: "Produção", PROJETO: "Projeto", METALURGIA: "Metalurgia", ARMADURA: "Armadura", ACOMPANHAMENTO: "Acompanhamento" };

/** As premissas por unidade de uma linha que dependem do volume (as receitas, os impostos, os custos, o kg e o volume por pista). */
const dependeDoVolume = (chave: string) => !/^(DEMANDA|EXPEDICAO|ACOMPANHAMENTO|DIAS_UTEIS)(:|$)/.test(chave);

/**
 * Os dados das verificações de um cenário analítico: a estrutura da DRE, as linhas, as premissas, os grupos de centros (a cópia do
 * cenário) e os valores deles, os percentuais dos rateios (como no cálculo: as bases das premissas, a Liberação de Projetos e as
 * regras de rateio do mês) e o Quadro de Lotação.
 */
export async function dadosDasVerificacoes(c: { id: string; ano: number }): Promise<DadosDasVerificacoes> {
  const prisma = getPrismaClient();
  const [est, linhas, gravadas, grupos, centros, projetos, regras, quadro] = await Promise.all([
    estruturaDRE(),
    linhasDoCadastro(),
    prisma.cenarioPremissa.findMany({ where: { cenarioId: c.id }, select: { unidade: true, venda: true, chave: true, mes: true, valor: true } }),
    gruposDoCenario(c.id),
    prisma.cenarioCentro.findMany({ where: { cenarioId: c.id, mes: { gte: 1, lte: 12 } }, select: { grupo: true, mes: true, valor: true, linhaDRE: { select: { codigo: true } } } }),
    prisma.cenarioIndicador.findMany({ where: ondeEstaoOsProjetos(c.id), select: { nome: true, mes: true, valor: true } }),
    regrasDeRateio(),
    prisma.cenarioLotacao.findMany({
      where: { cenarioId: c.id },
      orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }],
      select: {
        id: true,
        vinculo: true,
        centroCustoId: true,
        funcao: { select: { nome: true } },
        unidadeNegocio: { select: { nome: true } },
        centroCusto: { select: { codigoRM: true, nomeRM: true } },
        meses: { select: { mes: true, colaboradores: true, salarioBruto: true, adicional: true } },
      },
    }),
  ]);
  const { bases } = calcularPremissas(est, linhas, c.ano, gravadas);
  for (const [chave, lista] of basesDosProjetos(projetos)) bases.set(chave, lista);
  return {
    ano: c.ano,
    est,
    linhas,
    premissas: gravadas.filter((p) => p.mes >= 1 && p.mes <= 12).map((p) => ({ ...p, valor: Number(p.valor) })),
    grupos,
    centros: centros.map((x) => ({ grupo: x.grupo, codigo: x.linhaDRE.codigo, mes: x.mes, valor: Number(x.valor) })),
    percentuais: percentuaisPelasRegras(regras, c.ano, bases),
    quadro: quadro.map((l) => ({
      id: l.id,
      vinculo: l.vinculo,
      funcao: l.funcao.nome,
      unidade: l.unidadeNegocio.nome,
      centroCustoId: l.centroCustoId,
      centro: [l.centroCusto.codigoRM, l.centroCusto.nomeRM].filter(Boolean).join(" - "),
      // O salário pago (o bruto e a insalubridade ou periculosidade), por colaborador.
      meses: l.meses.map((m) => ({ mes: m.mes, colaboradores: Number(m.colaboradores), salario: Number(m.salarioBruto) + Number(m.adicional) })),
    })),
  };
}

/** As verificações de um cenário (puro). */
export function verificar(d: DadosDasVerificacoes): Verificacao[] {
  return [...verificarUnidades(d), ...verificarQuadro(d), ...verificarCentros(d)];
}

function verificarUnidades(d: DadosDasVerificacoes): Verificacao[] {
  const r: Verificacao[] = [];
  for (const unidade of [1, 2, 3] as UnidadePremissa[]) {
    const estrutura = linhasDaTabela(d.est, d.linhas, unidade);
    const rotulos = new Map(estrutura.map((e) => [e.chave, e.rotulo]));
    for (const venda of VENDAS_DA_UNIDADE[unidade]) {
      const gravadas = new Map(d.premissas.filter((p) => p.unidade === unidade && p.venda === venda).map((p) => [`${p.chave}|${p.mes}`, p.valor]));
      const { valores } = calcularTabela(d.est, d.linhas, unidade, d.ano, (chave, mes) => gravadas.get(`${chave}|${mes}`));
      const nomeDaVenda = venda === "MERCANTIL" ? "Mercantil" : "Global";
      for (const l of d.linhas.filter((x) => x.unidade === unidade)) {
        const nome = `${l.nome} (${l.medida})`;
        const daLinha = estrutura.filter((e) => e.tipo === "PREMISSA" && e.grupo === nome).map((e) => e.chave);
        const volume = MESES_DO_ANO.map((m) => Number(valores.get(`VOLUME:${l.codigo}`)?.[m - 1] ?? 0));
        const alvo = `${nomeDaVenda} · ${nome}`;
        const base = { aba: String(unidade) as AbaDaVerificacao, grupo: null, alvo, venda };
        // Os valores por unidade em meses sem volume: gravados e diferentes de zero, não geram resultado. A Variação do Estoque
        // multiplica o Volume de Estoque (a produção menos a expedição); as demais, o volume produzido.
        const estoque = valores.get(`VOLUME_ESTOQUE:${l.codigo}`);
        const baseDa = (k: string, m: number) => (k === `CUSTO:${l.codigo}:${C.VARIACAO_ESTOQUE}` && estoque ? Number(estoque[m - 1] ?? 0) : volume[m - 1]);
        const semResultado = (k: string, m: number) => (gravadas.get(`${k}|${m}`) ?? 0) !== 0 && quase(baseDa(k, m), 0, 1e-9);
        const porVolume = daLinha.filter(dependeDoVolume);
        const semVolume = MESES_DO_ANO.filter((m) => porVolume.some((k) => semResultado(k, m)));
        if (semVolume.length) {
          const chaves = porVolume.filter((k) => semVolume.some((m) => semResultado(k, m)));
          const nomes = chaves.map((k) => rotulos.get(k) ?? k);
          r.push({
            ...base,
            chave: `VALORES_SEM_VOLUME|${unidade}|${venda}|${l.codigo}`,
            tipo: "VALORES_SEM_VOLUME",
            meses: semVolume,
            descricao: `Sem volume em ${nMeses(semVolume.length)} (${textoDosMeses(semVolume)}), mas com valores em ${nomes.slice(0, 4).join("; ")}${nomes.length > 4 ? ` e mais ${nomes.length - 4}` : ""}: eles não geram resultado. Preencha a Demanda Diária (ou a Expedição Diária, na Variação do Estoque) ou tire os valores desses meses.`,
            assinatura: assinar([semVolume, chaves.map((k) => semVolume.map((m) => gravadas.get(`${k}|${m}`) ?? 0))]),
            origem: { tipo: "PREMISSAS", unidade, venda, chaves: [`DEMANDA:${l.codigo}`, ...chaves] },
          });
        }
        // O volume sem a Receita Bruta Média (na linha com receita).
        const receitas = daLinha.filter((k) => k.startsWith(`RB:${l.codigo}:`));
        if (receitas.length) {
          const semReceita = MESES_DO_ANO.filter((m) => volume[m - 1] > 0 && receitas.every((k) => !Number(valores.get(k)?.[m - 1] ?? 0)));
          if (semReceita.length)
            r.push({
              ...base,
              chave: `VOLUME_SEM_RECEITA|${unidade}|${venda}|${l.codigo}`,
              tipo: "VOLUME_SEM_RECEITA",
              meses: semReceita,
              descricao: `Com volume e sem a Receita Bruta Média em ${nMeses(semReceita.length)} (${textoDosMeses(semReceita)}): a produção desses meses não tem receita.`,
              assinatura: assinar([semReceita, semReceita.map((m) => volume[m - 1])]),
              origem: { tipo: "PREMISSAS", unidade, venda, chaves: [`DEMANDA:${l.codigo}`, ...receitas] },
            });
        }
      }
    }
  }
  return r;
}

/** O grupo de cada centro (a cópia do cenário). */
const grupoDosCentros = (grupos: GrupoDoCenario[]) => new Map(grupos.flatMap((g) => g.centros.map((c) => [c.id, g.grupo] as const)));

function verificarQuadro(d: DadosDasVerificacoes): Verificacao[] {
  const r: Verificacao[] = [];
  const doCentro = grupoDosCentros(d.grupos);
  // A chave estável da linha: a unidade, o vínculo, a função e o centro (o id muda na revisão e na importação); repetidas, a ordem.
  const vistas = new Map<string, number>();
  for (const l of d.quadro) {
    const k0 = `${l.unidade}|${l.vinculo}|${l.funcao}|${l.centro}`;
    const n = (vistas.get(k0) ?? 0) + 1;
    vistas.set(k0, n);
    const id = n > 1 ? `${k0}|${n}` : k0;
    const meses = MESES_DO_ANO.map((m) => l.meses.find((x) => x.mes === m) ?? { mes: m, colaboradores: 0, salario: 0 });
    const base = { aba: "quadro" as const, grupo: doCentro.get(l.centroCustoId) ?? null, alvo: `${l.funcao} · ${VINCULO[l.vinculo]} · ${l.centro}`, venda: null, origem: { tipo: "QUADRO" as const, linhas: [l.id] } };
    const valores = meses.map((x) => [x.colaboradores, x.salario]);
    const semSalario = meses.filter((x) => x.colaboradores > 0 && !x.salario).map((x) => x.mes);
    if (semSalario.length)
      r.push({
        ...base,
        chave: `COLABORADORES_SEM_SALARIO|${id}`,
        tipo: "COLABORADORES_SEM_SALARIO",
        meses: semSalario,
        descricao: `Com colaboradores e sem salário em ${nMeses(semSalario.length)} (${textoDosMeses(semSalario)}): as Remunerações e os Encargos do grupo não os contam.`,
        assinatura: assinar([semSalario, valores]),
      });
    const semColaboradores = meses.filter((x) => !x.colaboradores && x.salario > 0).map((x) => x.mes);
    if (semColaboradores.length)
      r.push({
        ...base,
        chave: `SALARIO_SEM_COLABORADORES|${id}`,
        tipo: "SALARIO_SEM_COLABORADORES",
        meses: semColaboradores,
        descricao: `Com salário e sem colaboradores em ${nMeses(semColaboradores.length)} (${textoDosMeses(semColaboradores)}): o salário não gera resultado.`,
        assinatura: assinar([semColaboradores, valores]),
      });
    // A linha PJ sem aumento no ano: o salário dos meses com colaboradores nunca passa o do primeiro deles.
    const ativos = meses.filter((x) => x.colaboradores > 0 && x.salario > 0);
    if (l.vinculo === "PJ" && ativos.length >= 2 && Math.max(...ativos.map((x) => x.salario)) <= ativos[0].salario + 0.005)
      r.push({
        ...base,
        chave: `PJ_SEM_AUMENTO|${id}`,
        tipo: "PJ_SEM_AUMENTO",
        meses: ativos.map((x) => x.mes),
        descricao: `O salário (${moeda(ativos[0].salario)}) não aumenta em nenhum dos ${nMeses(ativos.length)} com colaboradores (${textoDosMeses(ativos.map((x) => x.mes))}).`,
        assinatura: assinar([valores]),
      });
    // O salário por colaborador que cai de um mês para o outro, com os mesmos colaboradores.
    const caiEm = meses.filter((x, i) => i > 0 && x.colaboradores > 0 && quase(x.colaboradores, meses[i - 1].colaboradores, 1e-9) && meses[i - 1].salario > 0 && x.salario > 0 && x.salario < meses[i - 1].salario - 0.005).map((x) => x.mes);
    if (caiEm.length)
      r.push({
        ...base,
        chave: `SALARIO_QUE_CAI|${id}`,
        tipo: "SALARIO_QUE_CAI",
        meses: caiEm,
        descricao: `O salário por colaborador cai, com os mesmos colaboradores, em ${textoDosMeses(caiEm)} (${caiEm.map((m) => `${moeda(meses[m - 2].salario)} → ${moeda(meses[m - 1].salario)}`).slice(0, 3).join("; ")}${caiEm.length > 3 ? "…" : ""}).`,
        assinatura: assinar([caiEm, valores]),
      });
  }
  return r;
}

/** As contas de Gastos Gerais dos grupos (diretos, indiretos e comerciais). */
const ehGastoGeral = (codigo: string) => ["GGD", "GGI", "GGC"].includes(codigo.split(".")[1] ?? "");

function verificarCentros(d: DadosDasVerificacoes): Verificacao[] {
  const r: Verificacao[] = [];
  for (const g of d.grupos) {
    const ids = new Set(g.centros.map((c) => c.id));
    const linhas = d.quadro.filter((l) => ids.has(l.centroCustoId));
    // O grupo com colaboradores no Quadro de Lotação e sem Remunerações (a soma dos salários das linhas) ou sem Gastos Gerais no mês.
    if (linhas.length) {
      const colab = MESES_DO_ANO.map((m) => linhas.reduce((s, l) => s + (l.meses.find((x) => x.mes === m)?.colaboradores ?? 0), 0));
      const remuneracoes = MESES_DO_ANO.map((m) => linhas.reduce((s, l) => { const x = l.meses.find((y) => y.mes === m); return s + (x ? x.colaboradores * x.salario : 0); }, 0));
      const gastos = MESES_DO_ANO.map((m) => d.centros.filter((x) => x.grupo === g.grupo && x.mes === m && ehGastoGeral(x.codigo)).reduce((s, x) => s + Math.abs(x.valor), 0));
      const comColab = MESES_DO_ANO.filter((m) => colab[m - 1] > 0);
      const semRemuneracoes = comColab.filter((m) => Math.abs(remuneracoes[m - 1]) < 0.01);
      const semGastos = comColab.filter((m) => gastos[m - 1] < 0.01);
      const base = { aba: "centros" as const, grupo: g.grupo, alvo: g.grupo, venda: null };
      if (semRemuneracoes.length)
        r.push({
          ...base,
          chave: `QUADRO_SEM_REMUNERACOES|${g.grupo}`,
          tipo: "QUADRO_SEM_REMUNERACOES",
          meses: semRemuneracoes,
          descricao: `Com colaboradores no Quadro de Lotação e sem Remunerações em ${nMeses(semRemuneracoes.length)} (${textoDosMeses(semRemuneracoes)}): preencha os salários das linhas do grupo no Quadro de Lotação.`,
          assinatura: assinar([semRemuneracoes, colab]),
          origem: { tipo: "QUADRO", linhas: linhas.map((l) => l.id) },
        });
      if (semGastos.length)
        r.push({
          ...base,
          chave: `QUADRO_SEM_GASTOS_GERAIS|${g.grupo}`,
          tipo: "QUADRO_SEM_GASTOS_GERAIS",
          meses: semGastos,
          descricao: `Com colaboradores no Quadro de Lotação e sem valores nos Gastos Gerais (diretos, indiretos ou comerciais) em ${nMeses(semGastos.length)} (${textoDosMeses(semGastos)}).`,
          assinatura: assinar([semGastos, colab, gastos.map((v) => Math.round(v * 100))]),
          // Quem alterou por último os Gastos Gerais do grupo (as contas dele no grupo da DRE).
          origem: { tipo: "CENTROS", grupo: g.grupo, contas: d.est.filter((l) => l.tipo === "ITEM" && l.codigo.startsWith(`${g.grupoDRE}.`) && ehGastoGeral(l.codigo)).map((l) => l.codigo) },
        });
    }
    // Os salários de um tipo de colaborador que não variam quando a quantidade varia, no grupo (a soma das linhas do Quadro).
    for (const vinculo of ["CLT", "PJ", "APRENDIZ", "ESTAGIARIO"] as const) {
      const doTipo = linhas.filter((l) => l.vinculo === vinculo);
      if (!doTipo.length) continue;
      const colab = MESES_DO_ANO.map((m) => doTipo.reduce((s, l) => s + (l.meses.find((x) => x.mes === m)?.colaboradores ?? 0), 0));
      const salarios = MESES_DO_ANO.map((m) => doTipo.reduce((s, l) => { const x = l.meses.find((y) => y.mes === m); return s + (x ? x.colaboradores * x.salario : 0); }, 0));
      const meses = MESES_DO_ANO.filter((m) => m > 1 && !quase(colab[m - 1], colab[m - 2], 1e-9) && quase(salarios[m - 1], salarios[m - 2], 0.01));
      if (!meses.length) continue;
      r.push({
        chave: `SALARIOS_SEM_VARIACAO|${g.grupo}|${vinculo}`,
        tipo: "SALARIOS_SEM_VARIACAO",
        aba: "centros",
        grupo: g.grupo,
        alvo: `${g.grupo} · Salários ${TIPO_NO_GRUPO[vinculo]}`,
        venda: null,
        meses,
        descricao: `Os colaboradores ${TIPO_NO_GRUPO[vinculo]} mudam e os salários deles não, em ${textoDosMeses(meses)} (${meses.slice(0, 3).map((m) => `${colab[m - 2].toLocaleString("pt-BR")} → ${colab[m - 1].toLocaleString("pt-BR")} colab., ${moeda(salarios[m - 1])}`).join("; ")}${meses.length > 3 ? "…" : ""}): confira as linhas do grupo no Quadro de Lotação.`,
        assinatura: assinar([meses, colab, salarios.map((s) => Math.round(s * 100))]),
        origem: { tipo: "QUADRO", linhas: doTipo.map((l) => l.id) },
      });
    }
  }
  // Os valores que o rateio do grupo não leva a nenhuma unidade (como em alocarCentros): por grupo e conta.
  const porGrupo = new Map(d.grupos.map((g) => [g.grupo, g]));
  const porGrupoEConta = new Map<string, Array<{ grupo: string; codigo: string; mes: number; valor: number }>>();
  for (const x of d.centros) {
    if (!x.valor || x.mes < 1 || x.mes > 12 || !porGrupo.has(x.grupo)) continue;
    const k = `${x.grupo}|${x.codigo}`;
    porGrupoEConta.set(k, [...(porGrupoEConta.get(k) ?? []), x]);
  }
  const descricao = new Map(d.est.map((l) => [l.codigo, l.descricao]));
  for (const [k, valores] of porGrupoEConta) {
    const [grupo, codigo] = [k.slice(0, k.lastIndexOf("|")), k.slice(k.lastIndexOf("|") + 1)];
    const g = porGrupo.get(grupo)!;
    const alocado = Array<number>(12).fill(0);
    for (const lista of alocarCentros(d.est, d.grupos, valores, d.percentuais).values()) lista.forEach((v, i) => (alocado[i] += v));
    const fora = MESES_DO_ANO.map((m) => valores.filter((x) => x.mes === m).reduce((s, x) => s + x.valor, 0) - alocado[m - 1]);
    const meses = MESES_DO_ANO.filter((m) => Math.abs(fora[m - 1]) >= 1);
    if (!meses.length) continue;
    const total = meses.reduce((s, m) => s + fora[m - 1], 0);
    const chaveDoRateio = g.balde && CHAVES_DE_RATEIO[g.balde] ? g.balde : null;
    const semBase = chaveDoRateio ? meses.filter((m) => ![...(d.percentuais[m - 1] ?? new Map())].some(([c, p]) => c.startsWith(`${chaveDoRateio}|`) && p > 0)) : [];
    const motivo = semBase.length
      ? `a chave de rateio ${CHAVES_DE_RATEIO[chaveDoRateio!]} não tem base${semBase.length === meses.length ? "" : ` em ${textoDosMeses(semBase)}`} (aba Rateios)`
      : `o rateio do grupo (${g.destino}) não leva a conta a nenhuma unidade`;
    r.push({
      chave: `VALORES_FORA_DA_DRE|${grupo}|${codigo}`,
      tipo: "VALORES_FORA_DA_DRE",
      aba: "centros",
      grupo,
      alvo: `${grupo} · ${descricao.get(codigo) ?? codigo}`,
      venda: null,
      meses,
      descricao: `${moeda(total)} em ${nMeses(meses.length)} (${textoDosMeses(meses)}) não chegam à DRE: ${motivo}.`,
      assinatura: assinar([meses, meses.map((m) => Math.round(fora[m - 1] * 100))]),
      origem: { tipo: "CENTROS", grupo, contas: [codigo] },
    });
  }
  return r;
}

/** Uma entrada do Histórico (os campos que dizem o que ela alterou). */
export type EntradaDoHistorico = {
  criadoEm: Date;
  usuarioId: string | null;
  usuarioNome: string;
  tipo: string;
  visao: number | null;
  contas: unknown;
  alcance: unknown;
};

/** As cargas do cenário inteiro (a referência, as médias replicadas ou apagadas): alteram todas as premissas e os centros. */
const doCenarioInteiro = (e: EntradaDoHistorico) => (e.tipo === "REFERENCIA" || e.tipo === "MEDIAS") && !Array.isArray(e.contas);
const codigos = (e: EntradaDoHistorico) => (Array.isArray(e.contas) ? (e.contas as Array<{ codigo?: unknown }>).map((c) => String(c?.codigo ?? "")) : []);
const gruposDoAlcance = (e: EntradaDoHistorico) => (Array.isArray(e.alcance) ? (e.alcance as Array<{ g?: unknown }>).flatMap((a) => (typeof a?.g === "string" ? [a.g] : [])) : []);

/** A entrada do Histórico toca os valores da verificação. */
export function tocaAVerificacao(v: Pick<Verificacao, "origem">, e: EntradaDoHistorico) {
  const cs = codigos(e);
  const o = v.origem;
  if (o.tipo === "PREMISSAS") {
    const ks = new Set(o.chaves);
    const prefixo = `P|${o.unidade}|${o.venda}|`;
    return doCenarioInteiro(e) || cs.some((c) => (e.visao === o.unidade && ks.has(c)) || (c.startsWith(prefixo) && ks.has(c.slice(prefixo.length))));
  }
  if (o.tipo === "QUADRO") {
    const ids = new Set(o.linhas.map((id) => `QUADRO|${id}`));
    return (e.tipo === "REFERENCIA" && !Array.isArray(e.contas)) || cs.some((c) => ids.has(c));
  }
  const ks = new Set(o.contas);
  return doCenarioInteiro(e) || cs.some((c) => (ks.has(c) && gruposDoAlcance(e).includes(o.grupo)) || o.contas.some((x) => c === `C|${o.grupo}|${x}`));
}

/** Quem alterou por último os valores da verificação (o Histórico em ordem decrescente); sem ninguém, nulo. */
export function responsavelDa(v: Pick<Verificacao, "origem">, historico: EntradaDoHistorico[]) {
  const e = historico.find((x) => tocaAVerificacao(v, x));
  return e ? { id: e.usuarioId, nome: e.usuarioNome, em: e.criadoEm } : null;
}
