import { CENARIOS_DO_PROVA, corDaMarcacao } from "@/app/relatorios/components/cenariosDoProva";
import type { MarcacaoComparavel } from "@/app/relatorios/services/relatoriosService";

import type { Bloco, DadosDoRelatorio } from "../services/relatoriosExecutivosService";

// Os cenários, as cores e os estilos do PROVA: os mesmos de Resultados Empresariais (a Comparação PROVA, 31/10/2026).
export { CENARIOS_DO_PROVA, comCor, corDaMarcacao, ESTILOS_NA_TABELA, listaDosCenarios } from "@/app/relatorios/components/cenariosDoProva";
export type { CenarioMarcado, EstiloNaTabela } from "@/app/relatorios/components/cenariosDoProva";

type Card = Extract<Bloco, { tipo: "PAINEL" | "INDICADOR" }>;
const ehCard = (b: Bloco): b is Card => b.tipo === "PAINEL" || b.tipo === "INDICADOR";

/**
 * Se o objeto é PROVA (31/10/2026): `prova` verdadeiro (ou a lista de marcações, de antes da Comparação PROVA). Os
 * cenários são sempre os da Comparação PROVA do relatório (a aba Configurações).
 */
export const ehProva = (b: { prova?: true | MarcacaoComparavel[] }) => b.prova === true || (Array.isArray(b.prova) && b.prova.length > 0);

/** Se o slide tem objetos PROVA: os cards e, desde 31/10/2026, as tabelas. */
export const temProva = (blocos: Bloco[]) => blocos.some((b) => (ehCard(b) || b.tipo === "TABELA") && ehProva(b));

/**
 * A cor do orçado dos cards padrão: num slide com objetos PROVA, a do cenário de comparação do relatório (o Forecast em
 * cinza forte, como no PROVA); sem eles, ou com um cenário sem marcação, a de sempre.
 */
export function corDosCardsPadrao(blocos: Bloco[], dados: DadosDoRelatorio | undefined) {
  const m = dados?.prova.marcacaoComparada;
  return m && temProva(blocos) ? corDaMarcacao(m) : undefined;
}

/**
 * As séries da legenda de um slide com objetos PROVA (31/10/2026): os cenários da Comparação PROVA (com cards PROVA) e o
 * de comparação dos cards padrão, sem repetir, na ordem do PROVA e cada um na cor dele (o cenário de comparação sem
 * marcação, no fim, no preto do orçado). Sem objetos PROVA, nada: a legenda de sempre. A legenda é a dos cards: as tabelas
 * têm os rótulos nas colunas.
 */
export function seriesDaLegenda(blocos: Bloco[], dados: DadosDoRelatorio | undefined) {
  if (!dados || !temProva(blocos)) return undefined;
  const cards = blocos.filter(ehCard);
  const usados = new Set(cards.some(ehProva) ? dados.prova.cenarios.map((c) => c.marcacao) : []);
  const comPadrao = cards.some((b) => !ehProva(b));
  const comparada = dados.prova.marcacaoComparada;
  if (comPadrao && comparada) usados.add(comparada);
  const series = CENARIOS_DO_PROVA.filter((c) => usados.has(c.marcacao)).map(({ rotulo, cor }) => ({ rotulo, cor }));
  if (comPadrao && !comparada) series.push({ rotulo: dados.painel.rotuloComparado ?? "Orçado", cor: "var(--cor-grafico-orcado)" });
  return series;
}
