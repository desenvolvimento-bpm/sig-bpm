import { getPrismaClient } from "../../config/prisma.js";
import { valoresDoQuadro } from "../colaboradores/quadroService.js";
import { acumular, type DadosDoMes } from "./indicadores.js";
import { catalogoDeIndicadores, TOTAIS_SINTETICOS } from "./catalogoIndicadores.js";
import { totaisDaCompetencia } from "../volumes/volumesService.js";
import { orcamentoDoExercicio, type CenariosDoProva } from "./orcamento.js";
import { rotuloDaComparacao, type Comparacao } from "../cenarios/indicadoresDoCenario.js";
import { mesesDoExercicio } from "./resultadosService.js";

/**
 * Os dados de um mês: a DRE de todas as visões e os volumes congelados dos
 * rateios (só no mês apurado; senão NaN, e o indicador fica sem valor) e os
 * indicadores importados (com ou sem apuração). `metasDoOrcamento`: o orçado do mês (o do cenário Orçamento
 * Empresarial, que os GME 4 e 8 e o item [META] das fórmulas usam); sem ele, sem metas. As metas importadas (aba Metas
 * (Orçamento)) não valem mais fora dos cenários (11/10/2026).
 */
export async function dadosDoMes(competenciaId: string, apurado: boolean, metasDoOrcamento?: Map<string, number> | null): Promise<DadosDoMes> {
  const prisma = getPrismaClient();
  const [dre, volumes, importados, digitados, totaisListas, competencia] = await Promise.all([
    apurado
      ? prisma.resultadoApurado.findMany({
          where: { competenciaId, centroCustoId: null },
          select: { valor: true, linhaDRE: { select: { codigo: true } }, unidadeNegocio: { select: { codigo: true } } },
        })
      : [],
    apurado ? prisma.volumeOperacional.findMany({ where: { competenciaId }, select: { quantidade: true, regraRateio: { select: { origemDoVolume: true } } } }) : [],
    prisma.indicadorImportado.findMany({ where: { competenciaId }, select: { nome: true, valor: true } }),
    // Os digitados nas abas Comercial e Administrativo das Listas sobrepõem os importados.
    prisma.indicadorDigitado.findMany({ where: { competenciaId }, select: { nome: true, valor: true } }),
    // Os totais das listas do mês (os totalizadores que não têm volume congelado: Expedição, Montagem, Pistas…).
    apurado ? totaisDaCompetencia(competenciaId) : [],
    prisma.competencia.findUnique({ where: { id: competenciaId }, select: { ano: true, mes: true } }),
  ]);
  // O Quadro de Lotação do mês (os itens [QL] e [MQL], 06/11/2026), da competência dele no mesmo mês.
  const doQuadro = competencia ? await valoresDoQuadro(competencia.ano, competencia.mes) : null;
  const porLista = new Map(totaisListas.map((t) => [t.codigo as string, Number(t.quantidade)]));
  const totalDaLista = (c: string): number => (porOrigem.has(c) ? porOrigem.get(c)! : (porLista.get(c) ?? 0));
  const porMeta = metasDoOrcamento ?? new Map<string, number>();
  const porVisao = new Map(dre.map((r) => [`${r.unidadeNegocio?.codigo ?? 0}|${r.linhaDRE.codigo}`, Number(r.valor)]));
  // Cada origem aparece em mais de uma regra de rateio com o mesmo volume: vale uma vez.
  const porOrigem = new Map(volumes.map((v) => [v.regraRateio.origemDoVolume, Number(v.quantidade)]));
  const porNome = new Map([...importados, ...digitados].map((i) => [i.nome, Number(i.valor)]));
  return {
    dre: (u, c) => (apurado ? (porVisao.get(`${u}|${c}`) ?? 0) : NaN),
    volume: (o) => (apurado ? (porOrigem.get(o) ?? 0) : NaN),
    importado: (n) => porNome.get(n) ?? null,
    meta: (n) => porMeta.get(n) ?? null,
    quadro: (k) => doQuadro?.quadro(k) ?? null,
    movimentosQL: (tipo) => doQuadro?.movimentos(tipo) ?? null,
    lista: (c) => {
      if (!apurado) return NaN;
      const sintetico = TOTAIS_SINTETICOS[c];
      return sintetico ? sintetico.codigos.reduce((s, x) => s + totalDaLista(x), 0) : totalDaLista(c);
    },
  };
}

/** Liga cada mês aos anteriores do exercício (em ordem), para os indicadores acumulados do GME 8. */
export function encadearMeses<T extends DadosDoMes | null>(dados: T[]): T[] {
  dados.forEach((d, i) => {
    if (d) d.anteriores = dados.slice(0, i).filter((x): x is NonNullable<T> => x !== null);
  });
  return dados;
}

export const indicadoresService = {
  /**
   * Os indicadores do exercício, mês a mês até `ate`, com o acumulado. Com `somenteFechadas` (Resultados Empresariais),
   * só os meses de competência fechada têm valor.
   */
  /**
   * `prova` (31/10/2026, os cards PROVA dos Relatórios Executivos): os orçados de outros cenários, cada um com a marcação;
   * cada indicador traz, em `prova`, o orçado de cada mês e o acumulado de cada um deles.
   */
  async listar(ano: number, ate?: number, somenteFechadas = false, comparaCom: Comparacao = "ORCAMENTO_EMPRESARIAL", prova: CenariosDoProva = []) {
    const { ultimo, meses } = await mesesDoExercicio(ano, ate, somenteFechadas);
    const fechados = new Set(meses.filter((m) => m.competenciaId !== null).map((m) => m.mes));
    const competencias = new Map(
      (await getPrismaClient().competencia.findMany({ where: { ano, mes: { lte: ultimo } }, select: { id: true, mes: true } }))
        .filter((c) => !somenteFechadas || fechados.has(c.mes))
        .map((c) => [c.mes, c.id]),
    );
    // O orçado de cada mês, para o gráfico do indicador, como no Painel de Bordo: o cenário Orçamento Empresarial (sem ele, zero).
    const orcamento = await orcamentoDoExercicio(comparaCom);
    const metas = meses.map((m) => orcamento.porMes[m.mes - 1]);
    // Os indicadores do cadastro Estrutura dos Indicadores, com as fórmulas.
    const catalogo = await catalogoDeIndicadores();
    const dados = encadearMeses(
      await Promise.all(meses.map((m) => (competencias.has(m.mes) ? dadosDoMes(competencias.get(m.mes)!, m.competenciaId !== null, orcamento.porMes[m.mes - 1]) : null))),
    );
    const doProva = await prova;
    // Os meses de cada indicador apurados no Quadro de Lotação (06/11/2026): a lupa com as movimentações do mês.
    const apurados = new Set(
      (
        await getPrismaClient().indicadorDigitado.findMany({
          where: { competenciaId: { in: [...competencias.values()] }, origem: "APURADO" },
          select: { competenciaId: true, nome: true },
        })
      ).map((d) => `${d.competenciaId}|${d.nome}`),
    );
    return {
      ano,
      ate: ultimo,
      /** O cenário do orçado (null: nenhum cenário Orçamento Empresarial no exercício; o orçado é zero). */
      cenarioOrcado: orcamento.cenario?.nome ?? null,
      // O nome do comparado nos rótulos (21/10/2026): "Orçado" no Orçamento Empresarial; nos outros, o nome da marcação.
      rotuloComparado: rotuloDaComparacao(comparaCom, orcamento.cenario),
      meses: meses.map(({ mes, rotulo, competenciaId }) => ({ mes, rotulo, apurado: competenciaId !== null })),
      indicadores: catalogo.map((i) => {
        const partes = dados.map((d) => (d ? i.calculo(d) : null));
        return {
          grupo: i.grupo,
          numero: i.numero,
          nome: i.nome,
          sentido: i.sentido,
          unidade: i.unidade,
          metodologia: i.metodologia,
          acumulado: i.acumulado,
          meses: partes.map((p) => p?.valor ?? null),
          apurados: meses.map((m) => apurados.has(`${competencias.get(m.mes)}|${i.nome}`)),
          total: acumular(i, partes),
          /** O orçado de cada mês e o acumulado do orçado (zero sem o cenário Orçamento Empresarial ou sem o valor nele). */
          orcado: metas.map((m) => m.get(i.nome) ?? 0),
          totalOrcado: orcamento.acumulado(i, ultimo),
          ...(doProva.length
            ? { prova: Object.fromEntries(doProva.map(([marcacao, o]) => [marcacao, { orcado: meses.map((m) => o.porMes[m.mes - 1].get(i.nome) ?? 0), totalOrcado: o.acumulado(i, ultimo) }])) }
            : {}),
        };
      }),
    };
  },
};
