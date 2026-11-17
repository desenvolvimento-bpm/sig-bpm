/**
 * A Liberação de Projetos dos cenários analíticos (16/11/2026, pedido do Adão): os indicadores Liberação de Projetos: Matriz
 * e Liberação de Projetos: Filial se digitam na aba Indicadores Manuais das Premissas (no realizado, vêm das Listas — os
 * Projetos Liberados de cada unidade), e a Liberação de Projetos: Total é a soma dos dois. Como no Fechamento Mensal, eles
 * são a base do rateio de Projeto: a parte de cada unidade é a liberação dela sobre a das duas, mês a mês.
 */

export const LIBERACAO_DE_PROJETOS = { MATRIZ: "Liberação de Projetos: Matriz", FILIAL: "Liberação de Projetos: Filial" } as const;
export const LIBERACAO_TOTAL = "Liberação de Projetos: Total";
/** Os dois que se digitam. */
export const LIBERACOES_DIGITADAS: ReadonlySet<string> = new Set(Object.values(LIBERACAO_DE_PROJETOS));

/** O totalizador das Listas da fórmula de cada um (o item [LISTA]) → os indicadores do cenário que o dão. */
export const LIBERACOES_DA_LISTA: Record<string, string[]> = {
  PROJETOS_MATRIZ: [LIBERACAO_DE_PROJETOS.MATRIZ],
  PROJETOS_FILIAL: [LIBERACAO_DE_PROJETOS.FILIAL],
  PROJETOS_TOTAL: [LIBERACAO_DE_PROJETOS.MATRIZ, LIBERACAO_DE_PROJETOS.FILIAL],
};

/**
 * As bases do rateio de Projeto ("PROJETO|MATRIZ" e "PROJETO|FILIAL"): os doze meses da Liberação de Projetos do cenário (o
 * mês sem valor vale zero; o mês 0, a Média de Referência, não entra).
 */
export function basesDosProjetos(indicadores: Array<{ nome: string; mes: number; valor: unknown }>) {
  const bases = new Map<string, number[]>();
  for (const [destino, nome] of Object.entries(LIBERACAO_DE_PROJETOS)) {
    const lista = Array<number>(12).fill(0);
    for (const i of indicadores) if (i.nome === nome && i.mes >= 1 && i.mes <= 12) lista[i.mes - 1] = Number(i.valor) || 0;
    bases.set(`PROJETO|${destino}`, lista);
  }
  return bases;
}

/** Os indicadores que dão as bases do rateio de Projeto, para a leitura no banco. */
export const ondeEstaoOsProjetos = (cenarioId: string) => ({ cenarioId, nome: { in: [...LIBERACOES_DIGITADAS] }, mes: { gte: 1, lte: 12 } });
