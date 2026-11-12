import { fundoDoOrcado, LINHAS_DE_RESULTADO, ROTULO_DO_ORCADO } from "@/app/competencias/[anoMes]/dre/components/NiveisDRE";

import type { MarcacaoComparavel } from "../services/relatoriosService";

/**
 * Os cenários dos objetos PROVA (31/10/2026, pedido do Adão), na ordem deles: o rótulo e a cor, nas variáveis do tema
 * (globals.css) — o Forecast em cinza forte (fraco no Escuro), o Orçado no preto do orçado (claro no Escuro), o Vendido em
 * ouro forte e o Anterior em ouro fraco. O Realizado continua no amarelo-ouro da BPM. Os mesmos nos Relatórios Executivos
 * e em Resultados Empresariais (a Comparação PROVA).
 */
export const CENARIOS_DO_PROVA: Array<{ marcacao: MarcacaoComparavel; rotulo: string; cor: string }> = [
  { marcacao: "PREVISAO", rotulo: "Forecast", cor: "var(--cor-grafico-previsao)" },
  { marcacao: "ORCAMENTO_EMPRESARIAL", rotulo: "Orçado", cor: "var(--cor-grafico-orcado)" },
  { marcacao: "RESULTADOS_VENDIDOS", rotulo: "Vendido", cor: "var(--cor-grafico-vendido)" },
  { marcacao: "RESULTADOS_ANTERIORES", rotulo: "Anterior", cor: "var(--cor-grafico-anterior)" },
];
const DA_MARCACAO = new Map(CENARIOS_DO_PROVA.map((c) => [c.marcacao, c]));
/** A cor de uma marcação nos objetos PROVA. */
export const corDaMarcacao = (m: MarcacaoComparavel) => DA_MARCACAO.get(m)!.cor;
/** O rótulo de uma marcação nos objetos PROVA (o Orçamento é “Orçado”). */
export const rotuloNoProva = (m: MarcacaoComparavel) => DA_MARCACAO.get(m)!.rotulo;

/** Um cenário marcado, como os dados o trazem: a marcação, o rótulo e o nome do cenário. */
export type CenarioMarcado = { marcacao: MarcacaoComparavel; rotulo: string; cenario: string };
/** Um cenário da Comparação PROVA com a cor dele. */
export type CenarioDoProva = CenarioMarcado & { cor: string };

/** Os cenários da Comparação PROVA (os que têm cenário marcado), na ordem do PROVA, com a cor de cada um. */
export const comCor = (marcados: CenarioMarcado[]): CenarioDoProva[] => marcados.map((c) => ({ ...c, cor: corDaMarcacao(c.marcacao) }));

/** O estilo das colunas de um cenário numa tabela: a classe do rótulo e o fundo de cada linha. */
export type EstiloNaTabela = { rotulo: string; fundo: (l: { codigo: string; tipo: string }) => string };
/** O fundo em escala, como o do orçado: as linhas de resultado na variação média, os totais na mais fraca, as contas brancas. */
const emEscala = (resultado: string, total: string) => (l: { codigo: string; tipo: string }) =>
  `celula-orcado ${LINHAS_DE_RESULTADO.has(l.codigo) ? resultado : l.tipo !== "ITEM" ? total : "bg-white"}`;
const ROTULO = {
  PREVISAO: "!bg-[var(--cor-grafico-previsao)] !text-[var(--cor-texto-rotulo-previsao)]",
  VENDIDO: "!bg-[var(--cor-grafico-vendido)] !text-[var(--cor-texto-rotulo-vendido)]",
  ANTERIOR: "!bg-[var(--cor-grafico-anterior)] !text-[var(--cor-texto-rotulo-anterior)]",
};
/**
 * As colunas de cada cenário na Tabela PROVA (31/10/2026): o rótulo na cor dele (a dos cards PROVA) e as linhas nas
 * variações mais fracas dela (globals.css); o Orçado, como o orçado da Tabela Padrão (o rótulo preto e as linhas em cinza).
 */
export const ESTILOS_NA_TABELA: Record<MarcacaoComparavel, EstiloNaTabela> = {
  PREVISAO: { rotulo: ROTULO.PREVISAO, fundo: emEscala("bg-[var(--cor-tabela-previsao-resultado)]", "bg-[var(--cor-tabela-previsao-total)]") },
  ORCAMENTO_EMPRESARIAL: { rotulo: ROTULO_DO_ORCADO, fundo: fundoDoOrcado },
  RESULTADOS_VENDIDOS: { rotulo: ROTULO.VENDIDO, fundo: emEscala("bg-[var(--cor-tabela-vendido-resultado)]", "bg-[var(--cor-tabela-vendido-total)]") },
  RESULTADOS_ANTERIORES: { rotulo: ROTULO.ANTERIOR, fundo: emEscala("bg-[var(--cor-tabela-anterior-resultado)]", "bg-[var(--cor-tabela-anterior-total)]") },
};

/**
 * As colunas de cada cenário na tabela dos Indicadores com a Comparação PROVA (31/10/2026): o rótulo, a faixa (os grupos e
 * os totais, sem numeração) e as linhas pares, nas mesmas variações da Tabela PROVA; o Orçado, como o orçado de sempre.
 */
export type EstiloNosIndicadores = { rotulo: string; faixa: string; par: string };
// Nas pares, sem a celula-orcado, que no Escuro deixaria a célula quase branca entre as escuras: o cinza do tema no Orçado
// e, nos outros, a variação mais fraca deles, escura no Escuro (globals.css).
export const ESTILOS_NOS_INDICADORES: Record<MarcacaoComparavel, EstiloNosIndicadores> = {
  PREVISAO: { rotulo: ROTULO.PREVISAO, faixa: "celula-orcado bg-[var(--cor-tabela-previsao-resultado)]", par: "bg-[var(--cor-indicadores-previsao-par)]" },
  ORCAMENTO_EMPRESARIAL: { rotulo: ROTULO_DO_ORCADO, faixa: "celula-orcado bg-gray-300", par: "bg-gray-100" },
  RESULTADOS_VENDIDOS: { rotulo: ROTULO.VENDIDO, faixa: "celula-orcado bg-[var(--cor-tabela-vendido-resultado)]", par: "bg-[var(--cor-indicadores-vendido-par)]" },
  RESULTADOS_ANTERIORES: { rotulo: ROTULO.ANTERIOR, faixa: "celula-orcado bg-[var(--cor-tabela-anterior-resultado)]", par: "bg-[var(--cor-indicadores-anterior-par)]" },
};

/** O texto dos cenários da Comparação PROVA: “Forecast, Orçado e Anterior”. */
export function listaDosCenarios(marcados: Array<{ rotulo: string }>) {
  const r = marcados.map((c) => c.rotulo);
  return r.length > 1 ? `${r.slice(0, -1).join(", ")} e ${r[r.length - 1]}` : (r[0] ?? "");
}
