/**
 * A Liberação de Projetos dos cenários analíticos (16/11/2026, pedido do Adão): os indicadores Liberação de Projetos: Matriz
 * e Liberação de Projetos: Filial se digitam na aba Indicadores Manuais das Premissas (no realizado, vêm das Listas — os
 * Projetos Liberados de cada unidade), e a Liberação de Projetos: Total é a soma dos dois. Como no Fechamento Mensal, eles
 * são a base do rateio de Projeto: a parte de cada unidade é a liberação dela sobre a das duas, mês a mês. Pelo ID
 * (19/11/2026): os nomes são os atuais do cadastro.
 */
import { IND, IndicadoresPeloId, nomeDo } from "../relatorios/indicadoresDoSistema.js";

export const LIBERACAO_DE_PROJETOS = {
  get MATRIZ() {
    return nomeDo(IND.LIBERACAO_MATRIZ);
  },
  get FILIAL() {
    return nomeDo(IND.LIBERACAO_FILIAL);
  },
};
/** O nome atual da Liberação de Projetos: Total. */
export const liberacaoTotal = () => nomeDo(IND.LIBERACAO_TOTAL);
/** Os dois que se digitam. */
export const LIBERACOES_DIGITADAS = new IndicadoresPeloId(() => [IND.LIBERACAO_MATRIZ, IND.LIBERACAO_FILIAL]);

/** O totalizador das Listas da fórmula de cada um (o item [LISTA]) → os indicadores do cenário que o dão. */
export const LIBERACOES_DA_LISTA: Readonly<Record<string, readonly string[]>> = {
  get PROJETOS_MATRIZ() {
    return [LIBERACAO_DE_PROJETOS.MATRIZ];
  },
  get PROJETOS_FILIAL() {
    return [LIBERACAO_DE_PROJETOS.FILIAL];
  },
  get PROJETOS_TOTAL() {
    return [LIBERACAO_DE_PROJETOS.MATRIZ, LIBERACAO_DE_PROJETOS.FILIAL];
  },
};

/**
 * As bases do rateio de Projeto ("PROJETO|MATRIZ" e "PROJETO|FILIAL"): os doze meses da Liberação de Projetos do cenário (o
 * mês sem valor vale zero; o mês 0, a Média de Referência, não entra).
 */
export function basesDosProjetos(indicadores: Array<{ indicador: string; mes: number; valor: unknown }>) {
  const bases = new Map<string, number[]>();
  // Pelo ID do indicador (25/11/2026: os valores dos cenários guardam o ID).
  for (const [destino, id] of Object.entries({ MATRIZ: IND.LIBERACAO_MATRIZ, FILIAL: IND.LIBERACAO_FILIAL })) {
    const lista = Array<number>(12).fill(0);
    for (const i of indicadores) if (i.indicador === id && i.mes >= 1 && i.mes <= 12) lista[i.mes - 1] = Number(i.valor) || 0;
    bases.set(`PROJETO|${destino}`, lista);
  }
  return bases;
}

/** Os indicadores que dão as bases do rateio de Projeto, para a leitura no banco. */
export const ondeEstaoOsProjetos = (cenarioId: string) => ({ cenarioId, indicador: { in: [IND.LIBERACAO_MATRIZ, IND.LIBERACAO_FILIAL] }, mes: { gte: 1, lte: 12 } });
