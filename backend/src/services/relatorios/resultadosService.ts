import { getPrismaClient } from "../../config/prisma.js";
import { ACESSO_TOTAL, type Acesso } from "../acesso/acesso.js";
import { podeVerLinhaNaObra, podeVerMovimentos, podeVerSensiveis } from "../acesso/recorteDepartamento.js";
import { cenarioDaComparacao, rotuloDaComparacao, type Comparacao } from "../cenarios/indicadoresDoCenario.js";
import type { MarcacaoCenario } from "../../generated/prisma/enums.js";
import { dreService, RegraDREError } from "../dre/dreService.js";
import { obrasService } from "../dre/obrasService.js";
import { GRUPOS_SEM_CENTRO, nomeDoGrupoSemCentro, semCentroService, type GrupoSemCentro } from "../dre/semCentroService.js";
import { linhasDoCentro } from "../dre/recorteCentros.js";
import { baseDoPercentual, baseDoUnitario, basesDoConsolidado, COD, GRUPOS_DE_VOLUME, type VisaoResultados } from "./basesResultados.js";

/**
 * Relatório de Resultados: as visões da DRE (unidades, consolidado e centros
 * de custo) mês a mês no exercício, com a participação (%) e o valor unitário
 * (R$/m³) de cada linha, como as abas Resultados (…) do SIG BPM 2026 - BASE
 * REALIZADO (RESULTADOS). Os valores são os apurados (congelados) de cada
 * competência; o mês sem apuração fica vazio e não entra no total.
 */

export class RelatorioError extends Error {
  constructor(
    readonly status: 400 | 404,
    message: string,
  ) {
    super(message);
  }
}

const MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const rotuloMes = (ano: number, mes: number) => `${MESES[mes - 1]}/${String(ano).slice(2)}`;

export type LinhaEstrutura = { id: string; codigo: string; tipo: string; grupo: string; grupoSigla: string; atribuicaoSigla: string | null; descricao: string };
type Celula = { valor: number | null; pct: number | null; unitario: number | null };

/**
 * Os meses do exercício até `ate`, com a competência apurada de cada um (ou nenhuma). Com `somenteFechadas` (as telas
 * de Resultados Empresariais, 11/10/2026), só as competências fechadas contam: os meses abertos ou em conferência ficam
 * vazios, e sem `ate` o último mês é o último fechado.
 */
export async function mesesDoExercicio(ano: number, ate?: number, somenteFechadas = false) {
  const competencias = await getPrismaClient().competencia.findMany({
    where: { ano },
    select: { id: true, mes: true, apuradaEm: true, status: true },
    orderBy: { mes: "asc" },
  });
  const apuradas = competencias.filter((c) => c.apuradaEm !== null && (!somenteFechadas || c.status === "FECHADA"));
  if (apuradas.length === 0) throw new RelatorioError(404, `Nenhuma competência de ${ano} foi ${somenteFechadas ? "fechada" : "apurada"}.`);
  const ultimo = ate ?? apuradas[apuradas.length - 1].mes;
  return {
    ultimo,
    meses: Array.from({ length: ultimo }, (_, i) => {
      const c = apuradas.find((x) => x.mes === i + 1);
      return { mes: i + 1, rotulo: rotuloMes(ano, i + 1), competenciaId: c?.id ?? null };
    }),
  };
}

export async function estrutura(): Promise<LinhaEstrutura[]> {
  return getPrismaClient().linhaDRE.findMany({
    where: { ativo: true },
    orderBy: { ordem: "asc" },
    select: { id: true, codigo: true, tipo: true, grupo: true, grupoSigla: true, atribuicaoSigla: true, descricao: true },
  });
}

/**
 * O orçado de uma visão (o cenário Orçamento Empresarial do exercício, 11/10/2026): por linha, o valor do mês de
 * referência e o acumulado de janeiro até ele, da visão e do Consolidado (as bases do % e do R$/m³ em Despesas e
 * Extra e no RN). Sem cenário marcado, nenhum (as linhas mostram zero).
 */
async function orcadoDaVisao(visao: number, ate: number, comparacao: Comparacao = "ORCAMENTO_EMPRESARIAL") {
  const cenario = await cenarioDaComparacao(comparacao);
  const vazio = () => ({ mes: new Map<string, number>(), total: new Map<string, number>() });
  const daVisao = vazio();
  const doConsolidado = vazio();
  if (!cenario) return { cenario: null, daVisao, doConsolidado };
  const rs = await getPrismaClient().cenarioResultado.findMany({
    where: { cenarioId: cenario.id, visao: { in: [...new Set([visao, 0])] }, mes: { lte: ate } },
    select: { visao: true, mes: true, valor: true, linhaDRE: { select: { codigo: true } } },
  });
  const somar = (alvo: ReturnType<typeof vazio>, codigo: string, mes: number, v: number) => {
    alvo.total.set(codigo, (alvo.total.get(codigo) ?? 0) + v);
    if (mes === ate) alvo.mes.set(codigo, (alvo.mes.get(codigo) ?? 0) + v);
  };
  for (const r of rs) {
    const v = Number(r.valor);
    if (r.visao === 0) somar(doConsolidado, r.linhaDRE.codigo, r.mes, v);
    // Em Despesas e Extra e no RN, a ROL é a do Consolidado, como no realizado.
    const entra = visao >= 4 ? (r.visao === 0) === (r.linhaDRE.codigo === COD.RO) : r.visao === visao;
    if (entra) somar(daVisao, r.linhaDRE.codigo, r.mes, v);
  }
  return { cenario, daVisao, doConsolidado };
}

/** Valores por mês e código, de uma unidade (1..5) ou do consolidado (0). */
async function valoresDaVisao(competencias: Array<string | null>, unidade: number) {
  const ids = competencias.filter((c): c is string => c !== null);
  const rs = await getPrismaClient().resultadoApurado.findMany({
    where: { competenciaId: { in: ids }, centroCustoId: null, ...(unidade === 0 ? { unidadeNegocioId: null } : { unidadeNegocio: { codigo: unidade } }) },
    select: { competenciaId: true, valor: true, linhaDRE: { select: { codigo: true } } },
  });
  const porMes = competencias.map(() => new Map<string, number>());
  for (const r of rs) porMes[competencias.indexOf(r.competenciaId)].set(r.linhaDRE.codigo, Number(r.valor));
  return porMes;
}

// Valores com quatro casas (os volumes têm três) e razões com oito: sem o resíduo das somas em ponto flutuante.
const arredonda = (x: number, casas: number) => Math.round(x * 10 ** casas) / 10 ** casas;
const divide = (a: number, b: number | undefined) => (b === undefined || b === 0 ? null : arredonda(a / b, 8));
const soma = (xs: Array<number | null | undefined>) => arredonda(xs.reduce<number>((s, x) => s + (x ?? 0), 0), 4);

/**
 * Monta as linhas: os valores de cada mês, a participação e o valor unitário,
 * e o total do exercício (a soma dos meses apurados), com o % e o R$/m³ do
 * total sobre as bases somadas.
 */
export function montar(
  linhas: LinhaEstrutura[],
  visao: VisaoResultados,
  apurado: boolean[],
  valores: Array<Map<string, number>>,
  bases: Array<Map<string, number>>,
  acesso: Acesso,
  /** As linhas que entram mesmo sem valor nos meses (as que só têm o orçado). */
  outras: Set<string> = new Set(),
) {
  const temValor = new Set([...valores.flatMap((m) => [...m.keys()]), ...outras]);
  return linhas
    .filter((l) => l.tipo === "SECAO" || temValor.has(l.codigo))
    .map((l) => {
      const volume = GRUPOS_DE_VOLUME.has(l.grupoSigla);
      const bp = baseDoPercentual(visao, l);
      const bu = baseDoUnitario(l);
      const meses: Celula[] = valores.map((m, i) => {
        if (l.tipo === "SECAO" || !apurado[i]) return { valor: null, pct: null, unitario: null };
        const v = arredonda(m.get(l.codigo) ?? 0, 4);
        return { valor: v, pct: bp ? divide(v, bases[i].get(bp)) : null, unitario: bu ? divide(v, bases[i].get(bu)) : null };
      });
      const total = l.tipo === "SECAO" ? null : soma(meses.map((c) => c.valor));
      const somaBase = (codigo: string | null) => (codigo ? soma(bases.map((b, i) => (apurado[i] ? b.get(codigo) : 0))) : undefined);
      return {
        codigo: l.codigo,
        tipo: l.tipo,
        grupo: l.grupo,
        grupoSigla: l.grupoSigla,
        descricao: l.descricao,
        volume,
        /** O usuário alcança os lançamentos da linha (o recorte do Gestor por departamento), como na DRE. */
        // Sem o Acesso a Informações Sensíveis (27/10/2026), as linhas de Mão de Obra Direta e Indireta sem a lupa, em todas as visões.
        podeDetalhar: podeVerSensiveis(acesso, l) && (visao === "centros" || (visao === "obras" ? podeVerLinhaNaObra(acesso, l) : podeVerMovimentos(acesso, l))),
        meses,
        total: {
          valor: total,
          pct: total !== null && bp ? divide(total, somaBase(bp)) : null,
          unitario: total !== null && bu ? divide(total, somaBase(bu)) : null,
        },
      };
    });
}

export const resultadosService = {
  /** Uma visão da DRE (0 Consolidado, 1..5 as unidades) mês a mês, até o mês `ate`. */
  /** `comparaCom` (21/10/2026): a marcação do cenário comparado (as colunas pretas); sem ela, o Orçamento Empresarial. */
  /**
   * `prova` (31/10/2026, a Tabela PROVA dos Relatórios Executivos): as marcações dos outros cenários; os que existem vêm em
   * `prova` (a marcação, o rótulo e o nome), e cada linha traz, em `prova`, o orçado de cada um, como o do comparado.
   */
  async unidade(ano: number, visao: 0 | 1 | 2 | 3 | 4 | 5, ate?: number, acesso: Acesso = ACESSO_TOTAL, somenteFechadas = false, comparaCom: Comparacao = "ORCAMENTO_EMPRESARIAL", prova: MarcacaoCenario[] = []) {
    const { ultimo, meses } = await mesesDoExercicio(ano, ate, somenteFechadas);
    const competencias = meses.map((m) => m.competenciaId);
    const [linhas, valores] = await Promise.all([estrutura(), valoresDaVisao(competencias, visao)]);
    const consolidado = basesDoConsolidado(visao) ? await valoresDaVisao(competencias, 0) : valores;
    // Em Despesas e Extra e no RN, a ROL do Consolidado abre a tabela, como nas abas da planilha.
    if (visao === 4 || visao === 5) valores.forEach((m, i) => consolidado[i].has(COD.RO) && m.set(COD.RO, consolidado[i].get(COD.RO)!));
    const apurado = meses.map((m) => m.competenciaId !== null);
    const [orcado, ...dosCenarios] = await Promise.all([orcadoDaVisao(visao, ultimo, comparaCom), ...prova.map((m) => orcadoDaVisao(visao, ultimo, m))]);
    // Os cenários da Tabela PROVA que existem, com a marcação.
    const doProva = prova.flatMap((m, k) => (dosCenarios[k].cenario ? [{ marcacao: m, orcado: dosCenarios[k] }] : []));
    // O % e o R$/m³ do orçado sobre as bases do próprio orçado (em Despesas e Extra e no RN, as do Consolidado).
    const celulaDo = (o: typeof orcado) => (l: LinhaEstrutura, periodo: "mes" | "total") => {
      const basesOrcado = basesDoConsolidado(visao) ? o.doConsolidado : o.daVisao;
      const v = arredonda(o.daVisao[periodo].get(l.codigo) ?? 0, 4);
      const bp = baseDoPercentual(visao, l);
      const bu = baseDoUnitario(l);
      return { valor: v, pct: bp ? divide(v, basesOrcado[periodo].get(bp)) : null, unitario: bu ? divide(v, basesOrcado[periodo].get(bu)) : null };
    };
    const celulaOrcada = celulaDo(orcado);
    const porCodigo = new Map(linhas.map((l) => [l.codigo, l]));
    // As linhas que entram mesmo sem o realizado: as que têm o orçado do comparado ou de um dos cenários, diferente de zero
    // (16/11/2026, pedido do Adão: o cenário guarda zeradas as linhas que a unidade não usa — na Matriz, as dos Serviços —,
    // e elas apareciam zeradas na tabela e nos arquivos do Exportar).
    const temOrcado = (o: typeof orcado) =>
      [...o.daVisao.total, ...o.daVisao.mes].filter(([, v]) => arredonda(v, 4) !== 0).map(([codigo]) => codigo);
    const comOrcado = new Set([orcado, ...doProva.map((c) => c.orcado)].flatMap(temOrcado));
    const montadas = montar(linhas, visao, apurado, valores, consolidado, acesso, comOrcado);
    // A base do % de cada linha e o valor dela em cada mês apurado (18/11/2026: a aba Variações, cujo % da média dos meses
    // anteriores é a soma dos valores sobre a soma das bases, como o % do total).
    const basePercentual = new Map(montadas.map((l) => [l.codigo, l.tipo === "SECAO" ? null : baseDoPercentual(visao, porCodigo.get(l.codigo)!)]));
    const basesDoPercentual = Object.fromEntries(
      [...new Set([...basePercentual.values()].filter((b): b is string => !!b))].map((b) => [b, consolidado.map((m, i) => (apurado[i] ? arredonda(m.get(b) ?? 0, 4) : null))]),
    );
    return {
      ano,
      ate: ultimo,
      meses: meses.map(({ mes, rotulo, competenciaId }) => ({ mes, rotulo, apurado: competenciaId !== null })),
      /** O cenário do orçado (o Orçamento Empresarial do exercício); null: nenhum (o orçado é zero). */
      cenarioOrcado: orcado.cenario?.nome ?? null,
      // O nome do comparado nos rótulos (21/10/2026): "Orçado" no Orçamento Empresarial; nos outros, o nome da marcação.
      rotuloComparado: rotuloDaComparacao(comparaCom, orcado.cenario),
      ...(prova.length ? { prova: doProva.map((c) => ({ marcacao: c.marcacao, rotulo: rotuloDaComparacao(c.marcacao), cenario: c.orcado.cenario!.nome })) } : {}),
      basesDoPercentual,
      linhas: montadas.map((l) => ({
        ...l,
        basePercentual: basePercentual.get(l.codigo) ?? null,
        /** O orçado do mês de referência e o acumulado de janeiro até ele, com o % e o R$/m³ (zero sem o cenário ou sem a linha nele). */
        orcado: l.tipo === "SECAO" ? null : { mes: celulaOrcada(porCodigo.get(l.codigo)!, "mes"), total: celulaOrcada(porCodigo.get(l.codigo)!, "total") },
        ...(prova.length && l.tipo !== "SECAO"
          ? {
              prova: Object.fromEntries(
                doProva.map((c) => {
                  const celula = celulaDo(c.orcado);
                  return [c.marcacao, { mes: celula(porCodigo.get(l.codigo)!, "mes"), total: celula(porCodigo.get(l.codigo)!, "total") }];
                }),
              ),
            }
          : {}),
      })),
    };
  },

  /**
   * As obras (centros 1.98 e 1.99) com lançamento em algum mês, com o total do exercício: o Resultado Líquido; no
   * recorte, a soma das linhas que o usuário vê (11/10/2026). O nome é o do último mês.
   */
  async listarObras(ano: number, ate?: number, acesso: Acesso = ACESSO_TOTAL, somenteFechadas = false) {
    const { ultimo, meses } = await mesesDoExercicio(ano, ate, somenteFechadas);
    const obras = new Map<string, { nome: string; total: number }>();
    for (const m of meses) {
      if (!m.competenciaId) continue;
      for (const o of (await obrasService.listar(ano, m.mes, acesso)).obras) {
        const x = obras.get(o.codigo) ?? { nome: o.nome, total: 0 };
        obras.set(o.codigo, { nome: o.nome, total: x.total + Number(o.total) });
      }
    }
    return {
      ano,
      ate: ultimo,
      obras: [...obras]
        .map(([codigo, o]) => ({ codigo, nome: o.nome, total: o.total.toFixed(2) }))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR") || a.codigo.localeCompare(b.codigo)),
    };
  },

  /** Uma obra mês a mês (a DRE da obra de cada mês, como na aba Obras da DRE); o % sobre a receita da própria obra. */
  async obra(ano: number, codigo: string, ate?: number, acesso: Acesso = ACESSO_TOTAL, somenteFechadas = false) {
    const { ultimo, meses } = await mesesDoExercicio(ano, ate, somenteFechadas);
    const linhas = await estrutura();
    let nome = codigo;
    const valores = await Promise.all(
      meses.map(async (m) => {
        const mapa = new Map<string, number>();
        if (!m.competenciaId) return mapa;
        try {
          const dre = await obrasService.consultar(ano, m.mes, codigo, acesso);
          // No mês só com os volumes (sem lançamento), o nome é o código.
          if (dre.obra.nome !== codigo) nome = dre.obra.nome;
          for (const l of dre.linhas) if (l.valor !== null && l.tipo !== "SECAO") mapa.set(l.codigo, Number(l.valor));
        } catch (error) {
          if (!(error instanceof RegraDREError && error.status === 404)) throw error; // sem lançamento no mês
        }
        return mapa;
      }),
    );
    if (valores.every((m) => m.size === 0)) throw new RelatorioError(404, `Nenhum lançamento da obra ${codigo} em ${ano}.`);
    const apurado = meses.map((m) => m.competenciaId !== null);
    const montadas = montar(linhas, "obras", apurado, valores, valores, acesso);
    // As seções ficam de fora, menos a Produção e Serviços (PS) da obra com volume (30/10/2026), como no Consolidado.
    const comVolume = montadas.some((l) => l.volume && l.tipo !== "SECAO");
    return {
      ano,
      ate: ultimo,
      obra: { codigo, nome },
      meses: meses.map(({ mes, rotulo, competenciaId }) => ({ mes, rotulo, apurado: competenciaId !== null })),
      linhas: montadas.filter((l) => l.tipo !== "SECAO" || (comVolume && l.volume)),
    };
  },

  /**
   * Os grupos dos movimentos sem centro de custo (aba Sem Centros de Custo, 14/10/2026) com lançamento em algum mês, na
   * ordem da lista, com o total do exercício.
   */
  async listarSemCentros(ano: number, ate?: number, acesso: Acesso = ACESSO_TOTAL, somenteFechadas = false) {
    const { ultimo, meses } = await mesesDoExercicio(ano, ate, somenteFechadas);
    const totais = new Map<string, number>();
    for (const m of meses) {
      if (!m.competenciaId) continue;
      for (const g of (await semCentroService.listar(ano, m.mes, acesso)).grupos) totais.set(g.codigo, (totais.get(g.codigo) ?? 0) + Number(g.total));
    }
    return {
      ano,
      ate: ultimo,
      grupos: GRUPOS_SEM_CENTRO.filter((g) => totais.has(g.codigo)).map((g) => ({ codigo: g.codigo, nome: g.nome, total: totais.get(g.codigo)!.toFixed(2) })),
    };
  },

  /** Um grupo dos movimentos sem centro de custo mês a mês; as bases do % e do R$/m³ são as do Consolidado, como nos centros. */
  async semCentro(ano: number, grupo: GrupoSemCentro, ate?: number, acesso: Acesso = ACESSO_TOTAL, somenteFechadas = false) {
    const { ultimo, meses } = await mesesDoExercicio(ano, ate, somenteFechadas);
    const competencias = meses.map((m) => m.competenciaId);
    const [linhas, consolidado] = await Promise.all([estrutura(), valoresDaVisao(competencias, 0)]);
    const valores = await Promise.all(
      meses.map(async (m) => {
        const mapa = new Map<string, number>();
        if (!m.competenciaId) return mapa;
        try {
          const dre = await semCentroService.consultar(ano, m.mes, grupo, acesso);
          for (const l of dre.linhas) if (l.valor !== null && l.tipo !== "SECAO") mapa.set(l.codigo, Number(l.valor));
        } catch (error) {
          if (!(error instanceof RegraDREError && error.status === 404)) throw error; // sem lançamento no mês
        }
        return mapa;
      }),
    );
    if (valores.every((m) => m.size === 0)) throw new RelatorioError(404, `Nenhum lançamento sem centro de custo em ${nomeDoGrupoSemCentro(grupo)} em ${ano}.`);
    const apurado = meses.map((m) => m.competenciaId !== null);
    return {
      ano,
      ate: ultimo,
      grupo: nomeDoGrupoSemCentro(grupo),
      meses: meses.map(({ mes, rotulo, competenciaId }) => ({ mes, rotulo, apurado: competenciaId !== null })),
      linhas: montar(linhas, "centros", apurado, valores, consolidado, acesso).filter((l) => l.tipo !== "SECAO"),
    };
  },

  /** Os agrupamentos de centros de custo com valor em algum mês, com o total do exercício (o da tabela de cada um). */
  async listarCentros(ano: number, ate?: number, acesso: Acesso = ACESSO_TOTAL, somenteFechadas = false) {
    const { ultimo, meses } = await mesesDoExercicio(ano, ate, somenteFechadas);
    const grupos = new Map<string, { departamentos: Set<string>; total: number }>();
    for (const m of meses) {
      if (!m.competenciaId) continue;
      const { grupos: doMes } = await dreService.listarCentros(ano, m.mes, acesso);
      for (const g of doMes) {
        const x = grupos.get(g.grupo) ?? { departamentos: new Set<string>(), total: 0 };
        g.departamentos.forEach((d) => x.departamentos.add(d));
        x.total += Number(g.total);
        grupos.set(g.grupo, x);
      }
    }
    return {
      ano,
      ate: ultimo,
      grupos: [...grupos]
        .sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
        .map(([grupo, g]) => ({ grupo, departamentos: [...g.departamentos].sort(), total: g.total.toFixed(2) })),
    };
  },

  /**
   * Um agrupamento de centros de custo mês a mês: em cada mês, o recorte da
   * tela da DRE (linhasDoCentro); as bases do % e do R$/m³ são as do Consolidado.
   */
  async centros(ano: number, grupo: string, ate?: number, acesso: Acesso = ACESSO_TOTAL, somenteFechadas = false) {
    const { ultimo, meses } = await mesesDoExercicio(ano, ate, somenteFechadas);
    const competencias = meses.map((m) => m.competenciaId);
    const [linhas, consolidado] = await Promise.all([estrutura(), valoresDaVisao(competencias, 0)]);
    // Os centros do agrupamento com lançamento em algum mês (o painel explicativo, como na DRE).
    const centros = new Map<string, { codigoRM: string | null; nome: string }>();
    const valores = await Promise.all(
      meses.map(async (m) => {
        const mapa = new Map<string, number>();
        if (!m.competenciaId) return mapa;
        try {
          const dre = await dreService.consultarCentros(ano, m.mes, grupo, acesso);
          for (const l of linhasDoCentro(dre.linhas)) if (l.valor !== null) mapa.set(l.codigo, Number(l.valor));
          for (const cc of dre.centros) centros.set(`${cc.codigoRM}|${cc.nome}`, cc);
        } catch (error) {
          if (!(error instanceof RegraDREError && error.status === 404)) throw error; // sem valor no mês
        }
        return mapa;
      }),
    );
    if (valores.every((m) => m.size === 0)) throw new RelatorioError(404, `Nenhum valor apurado para o centro de custo ${grupo} em ${ano}.`);
    const apurado = meses.map((m) => m.competenciaId !== null);
    return {
      ano,
      ate: ultimo,
      grupo,
      centros: [...centros.values()].sort((a, b) => (a.codigoRM ?? "").localeCompare(b.codigoRM ?? "")),
      meses: meses.map(({ mes, rotulo, competenciaId }) => ({ mes, rotulo, apurado: competenciaId !== null })),
      linhas: montar(linhas, "centros", apurado, valores, consolidado, acesso).filter((l) => l.tipo !== "SECAO"),
    };
  },
};
