import { getPrismaClient } from "../../config/prisma.js";
import { cenarioDaComparacao, rotuloDaComparacao, type Comparacao } from "../cenarios/indicadoresDoCenario.js";
import { COD } from "./basesResultados.js";
import { mesesDoExercicio } from "./resultadosService.js";

/**
 * A aba Custos Operacionais da tela Resultados (26/11/2026, pedido do Adão), em Resultados Empresariais e nos Cenários
 * (Sintéticos e Analíticos): os custos de produção e de serviços por dia de trabalho (R$/dia) ou por m³ (R$/m³), com a média
 * de cada trimestre e a Média Mensal, e, contra o comparado, a Diferença e o Atingimento (sem a Eficiência: os valores não
 * têm %).
 *
 * - R$/dia: a soma das linhas nos meses ÷ 20 dias por mês (o trimestre inteiro, ÷ 60). Num trimestre com menos meses (os
 *   fechados até o mês escolhido), ÷ 20 por mês que entra.
 * - R$/m³: a soma das linhas nos meses ÷ a soma do volume dos mesmos meses (a média ponderada, como o R$/m³ do total na DRE):
 *   a Produção do Pré-Fabricado nos custos de produção e a Montagem do Pré-Fabricado nos de montagem. Nos cenários, as linhas
 *   de volume são as da Demanda do cenário.
 */

/** Os dias de trabalho de cada mês nos indicadores em R$/dia (pedido do Adão): 20; no trimestre, 60. */
export const DIAS_POR_MES = 20;

/** A unidade da DRE de cada indicador: 1 Matriz, 2 Filial, 3 Serviços. */
type Unidade = 1 | 2 | 3;
export type UnidadeDoCusto = "R$/dia" | "R$/m³";

export type IndicadorDeCusto = {
  chave: string;
  descricao: string;
  unidade: UnidadeDoCusto;
  visao: Unidade;
  /** As linhas da DRE somadas (pelo código, que não muda com a descrição) e as subtraídas. */
  soma: string[];
  menos?: string[];
  /** A linha do volume, nos R$/m³. */
  volume?: string;
};

const MOD = "MOD.MAO_DE_OBRA_DIRETA";
const MOI = "MOI.MAO_DE_OBRA_INDIRETA";
const MATERIAIS = "MP.MATERIAIS_APLICADOS";
const MADEIRAS = "GGV.MADEIRAS_E_MADEIRITES";
const GGV = "GGV.GASTOS_GERAIS_VARIAVEIS";
const GGD = "GGD.GASTOS_GERAIS_DIRETOS";
const GGI = "GGI.GASTOS_GERAIS_INDIRETOS";
const D = "D.DEPRECIACAO";

/** Os indicadores de uma unidade de produção (Matriz ou Filial), na ordem da lista do pedido. */
const daProducao = (visao: 1 | 2, nome: string): Record<string, IndicadorDeCusto> => ({
  mod: { chave: `mod_${nome}`, descricao: `Mão de Obra Direta de Produção (${visao === 1 ? "Matriz" : "Filial"}) [R$/dia]`, unidade: "R$/dia", visao, soma: [`CPP.${MOD}`] },
  moi: { chave: `moi_${nome}`, descricao: `Mão de Obra Indireta de Produção (${visao === 1 ? "Matriz" : "Filial"}) [R$/dia]`, unidade: "R$/dia", visao, soma: [`CPP.${MOI}`] },
  materiais: { chave: `materiais_${nome}`, descricao: `Materiais Aplicados de Produção (${visao === 1 ? "Matriz" : "Filial"}) [R$/m³]`, unidade: "R$/m³", visao, soma: [`CPP.${MATERIAIS}`], volume: COD.PRODUCAO },
  madeiras: { chave: `madeiras_${nome}`, descricao: `Madeiras e Madeirites de Produção (${visao === 1 ? "Matriz" : "Filial"}) [R$/m³]`, unidade: "R$/m³", visao, soma: [`CPP.${MADEIRAS}`], volume: COD.PRODUCAO },
  ggv: {
    chave: `ggv_${nome}`,
    descricao: `Outros Gastos Gerais Variáveis de Produção (${visao === 1 ? "Matriz" : "Filial"}) [R$/m³]`,
    unidade: "R$/m³",
    visao,
    soma: [`CPP.${GGV}`],
    menos: [`CPP.${MADEIRAS}`],
    volume: COD.PRODUCAO,
  },
  ggd: { chave: `ggd_${nome}`, descricao: `Gastos Gerais Diretos de Produção (${visao === 1 ? "Matriz" : "Filial"}) [R$/dia]`, unidade: "R$/dia", visao, soma: [`CPP.${GGD}`] },
  ggi: { chave: `ggi_${nome}`, descricao: `Gastos Gerais Indiretos de Produção (${visao === 1 ? "Matriz" : "Filial"}) [R$/dia]`, unidade: "R$/dia", visao, soma: [`CPP.${GGI}`] },
  d: { chave: `depreciacao_${nome}`, descricao: `Depreciação do Maquinário da Produção (${visao === 1 ? "Matriz" : "Filial"}) [R$/dia]`, unidade: "R$/dia", visao, soma: [`CPP.${D}`] },
});
const MATRIZ = daProducao(1, "matriz");
const FILIAL = daProducao(2, "filial");

/**
 * Os indicadores da aba, na ordem do pedido do Adão: os de produção (Matriz e Filial; as Madeiras e Madeirites só na Matriz) e
 * os de serviços (a mão de obra e os gastos gerais diretos e indiretos somam a Montagem e a Complementar; os materiais, as
 * madeiras, os outros gastos gerais variáveis e a depreciação são só da Montagem).
 */
export const INDICADORES_DE_CUSTO: IndicadorDeCusto[] = [
  MATRIZ.mod,
  FILIAL.mod,
  MATRIZ.moi,
  FILIAL.moi,
  MATRIZ.materiais,
  FILIAL.materiais,
  MATRIZ.madeiras,
  MATRIZ.ggv,
  FILIAL.ggv,
  MATRIZ.ggd,
  FILIAL.ggd,
  MATRIZ.ggi,
  FILIAL.ggi,
  MATRIZ.d,
  FILIAL.d,
  { chave: "mod_servicos", descricao: "Mão de Obra Direta de Serviços [R$/dia]", unidade: "R$/dia", visao: 3, soma: [`CSM.${MOD}`, `CSC.${MOD}`] },
  { chave: "moi_servicos", descricao: "Mão de Obra Indireta de Serviços [R$/dia]", unidade: "R$/dia", visao: 3, soma: [`CSM.${MOI}`, `CSC.${MOI}`] },
  { chave: "materiais_montagem", descricao: "Materiais Aplicados de Montagem [R$/m³]", unidade: "R$/m³", visao: 3, soma: [`CSM.${MATERIAIS}`], volume: COD.MONTAGEM },
  { chave: "madeiras_montagem", descricao: "Madeiras e Madeirites de Montagem [R$/m³]", unidade: "R$/m³", visao: 3, soma: [`CSM.${MADEIRAS}`], volume: COD.MONTAGEM },
  { chave: "ggv_montagem", descricao: "Outros Gastos Gerais Variáveis de Montagem [R$/m³]", unidade: "R$/m³", visao: 3, soma: [`CSM.${GGV}`], menos: [`CSM.${MADEIRAS}`], volume: COD.MONTAGEM },
  { chave: "ggd_servicos", descricao: "Gastos Gerais Diretos de Serviços [R$/dia]", unidade: "R$/dia", visao: 3, soma: [`CSM.${GGD}`, `CSC.${GGD}`] },
  { chave: "ggi_servicos", descricao: "Gastos Gerais Indiretos de Serviços [R$/dia]", unidade: "R$/dia", visao: 3, soma: [`CSM.${GGI}`, `CSC.${GGI}`] },
  { chave: "depreciacao_montagem", descricao: "Depreciação do Maquinário de Montagem [R$/dia]", unidade: "R$/dia", visao: 3, soma: [`CSM.${D}`] },
];

/** As linhas da DRE que a aba lê. */
export const CODIGOS_DOS_CUSTOS = [...new Set(INDICADORES_DE_CUSTO.flatMap((i) => [...i.soma, ...(i.menos ?? []), ...(i.volume ? [i.volume] : [])]))];

/** Os valores de uma série (o realizado, o cenário ou o comparado): se o mês `i` (0 a 11) entra e o valor de cada linha nele. */
export type SerieDeCustos = { entra: (i: number, visao: Unidade) => boolean; valor: (i: number, visao: Unidade, codigo: string) => number };

const arredonda = (x: number) => Math.round(x * 1e8) / 1e8;

/** O valor de um indicador nos meses `meses` (os índices, de 0 a 11) da série: só os que entram; sem nenhum, null. */
export function valorDoCusto(ind: IndicadorDeCusto, serie: SerieDeCustos, meses: number[]): number | null {
  const usados = meses.filter((i) => serie.entra(i, ind.visao));
  if (!usados.length) return null;
  const somar = (codigos: string[] | undefined) => usados.reduce((s, i) => s + (codigos ?? []).reduce((t, c) => t + serie.valor(i, ind.visao, c), 0), 0);
  const custo = somar(ind.soma) - somar(ind.menos);
  if (ind.unidade === "R$/dia") return arredonda(custo / (DIAS_POR_MES * usados.length));
  const volume = somar(ind.volume ? [ind.volume] : []);
  return volume ? arredonda(custo / volume) : null;
}

const MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const TRIMESTRES = [0, 1, 2, 3].map((t) => [t * 3, t * 3 + 1, t * 3 + 2]);

export type LinhaDeCusto = {
  chave: string;
  descricao: string;
  unidade: UnidadeDoCusto;
  /** A média de cada trimestre (null: nenhum mês dele entra). */
  trimestres: Array<number | null>;
  /** A Média Mensal: todos os meses que entram. */
  media: number | null;
  /** A Média Mensal do comparado (null: sem comparado, ou sem volume nos R$/m³). */
  comparado: number | null;
};

/**
 * A tabela da aba: os indicadores com as médias dos trimestres e a Média Mensal da série e, com o comparado, a Média Mensal dele
 * (nos meses `mesesDoComparado`: no realizado, os mesmos do realizado; nos cenários, os 12 dele).
 */
export function montarCustosOperacionais(ano: number, nMeses: number, serie: SerieDeCustos, comparado: { serie: SerieDeCustos; meses: number[] } | null) {
  const todos = Array.from({ length: nMeses }, (_, i) => i);
  const rotulo = (i: number) => `${MESES[i]}/${String(ano).slice(2)}`;
  // Os meses que entram (em alguma unidade), para as dicas dos rótulos.
  const entra = (i: number) => ([1, 2, 3] as const).some((v) => serie.entra(i, v));
  return {
    trimestres: TRIMESTRES.map((ms, t) => ({ rotulo: `${t + 1}º Trimestre`, meses: ms.filter((i) => i < nMeses && entra(i)).map(rotulo) })),
    mesesDaMedia: todos.filter(entra).map(rotulo),
    linhas: INDICADORES_DE_CUSTO.map(
      (ind): LinhaDeCusto => ({
        chave: ind.chave,
        descricao: ind.descricao,
        unidade: ind.unidade,
        trimestres: TRIMESTRES.map((ms) => valorDoCusto(ind, serie, ms.filter((i) => i < nMeses))),
        media: valorDoCusto(ind, serie, todos),
        comparado: comparado ? valorDoCusto(ind, comparado.serie, comparado.meses) : null,
      }),
    ),
  };
}

/** Os valores por mês (0 a 11), unidade e código. */
type PorMes = Array<Map<string, number>>;
const vazio = () => Array.from({ length: 12 }, () => new Map<string, number>());
const serieDe = (porUnidade: Record<Unidade, PorMes>, entra: (i: number, visao: Unidade) => boolean): SerieDeCustos => ({
  entra,
  valor: (i, visao, codigo) => porUnidade[visao][i]?.get(codigo) ?? 0,
});

/** Os valores de um cenário nas unidades 1 a 3, só as linhas da aba: por unidade, mês a mês. */
export async function custosDoCenario(cenarioId: string) {
  const rs = await getPrismaClient().cenarioResultado.findMany({
    where: { cenarioId, visao: { in: [1, 2, 3] }, mes: { gte: 1, lte: 12 }, linhaDRE: { codigo: { in: CODIGOS_DOS_CUSTOS } } },
    select: { visao: true, mes: true, valor: true, linhaDRE: { select: { codigo: true } } },
  });
  const porUnidade: Record<Unidade, PorMes> = { 1: vazio(), 2: vazio(), 3: vazio() };
  for (const r of rs) porUnidade[r.visao as Unidade][r.mes - 1].set(r.linhaDRE.codigo, Number(r.valor));
  return porUnidade;
}

/**
 * A série de um cenário (os 12 meses): o mês entra na unidade quando a DRE dela tem valor nele, como na tela Resultados do
 * cenário (o mês sem valor fica de fora do total).
 */
export async function serieDoCenario(cenarioId: string): Promise<SerieDeCustos> {
  const [porUnidade, comValor] = await Promise.all([
    custosDoCenario(cenarioId),
    getPrismaClient().cenarioResultado.groupBy({ by: ["visao", "mes"], where: { cenarioId, visao: { in: [1, 2, 3] }, mes: { gte: 1, lte: 12 } } }),
  ]);
  const meses = new Set(comValor.map((r) => `${r.visao}|${r.mes}`));
  return serieDe(porUnidade, (i, visao) => meses.has(`${visao}|${i + 1}`));
}

export const custosOperacionaisService = {
  /**
   * Resultados Empresariais: as competências fechadas do exercício até `ate` (sem ele, a última fechada) e, contra elas, o
   * cenário da Comparação Padrão (`comparaCom`), nos mesmos meses (os números dos meses, mesmo num cenário de outro exercício).
   */
  async realizado(ano: number, ate: number | undefined, comparaCom: Comparacao = "ORCAMENTO_EMPRESARIAL") {
    const { ultimo, meses } = await mesesDoExercicio(ano, ate, true);
    const ids = meses.map((m) => m.competenciaId).filter((c): c is string => c !== null);
    const prisma = getPrismaClient();
    const [rs, cenario] = await Promise.all([
      prisma.resultadoApurado.findMany({
        where: { competenciaId: { in: ids }, centroCustoId: null, unidadeNegocio: { codigo: { in: [1, 2, 3] } }, linhaDRE: { codigo: { in: CODIGOS_DOS_CUSTOS } } },
        select: { competenciaId: true, valor: true, unidadeNegocio: { select: { codigo: true } }, linhaDRE: { select: { codigo: true } } },
      }),
      cenarioDaComparacao(comparaCom),
    ]);
    const porUnidade: Record<Unidade, PorMes> = { 1: vazio(), 2: vazio(), 3: vazio() };
    const indice = new Map(meses.map((m, i) => [m.competenciaId, i]));
    for (const r of rs) {
      const i = indice.get(r.competenciaId);
      const u = r.unidadeNegocio?.codigo as Unidade | undefined;
      if (i !== undefined && u) porUnidade[u][i].set(r.linhaDRE.codigo, Number(r.valor));
    }
    const apurado = meses.map((m) => m.competenciaId !== null);
    const serie = serieDe(porUnidade, (i) => !!apurado[i]);
    const doComparado = cenario ? await custosDoCenario(cenario.id) : null;
    const mesesApurados = apurado.flatMap((a, i) => (a ? [i] : []));
    return {
      ano,
      ate: ultimo,
      comparado: { rotulo: rotuloDaComparacao(comparaCom, cenario), nome: cenario?.nome ?? null },
      ...montarCustosOperacionais(ano, ultimo, serie, doComparado ? { serie: serieDe(doComparado, () => true), meses: mesesApurados } : null),
    };
  },
};
