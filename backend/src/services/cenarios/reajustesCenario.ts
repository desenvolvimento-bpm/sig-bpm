/**
 * Os Reajustes das Premissas dos cenários analíticos (11/11/2026, pedido do Adão; a aba Reajustes, depois dos Indicadores
 * Manuais): os Índices de Reajuste — cada um com até quatro reajustes, o Valor (%) e o mês em que ele Inicia Em — e a
 * Aplicação dos Reajustes, o índice de cada conta da DRE.
 *
 * Com os reajustes aplicados (o Recalcular dos Resultados, "Aplicar Reajustes"), cada cálculo da DRE multiplica o valor
 * de cada conta com índice, em cada unidade e mês, pelo fator do índice no mês: o produto de (1 + Valor ÷ 100) dos
 * reajustes que já começaram. Cada reajuste vale sobre os anteriores: 4% a partir de janeiro e 2% a partir de abril dão
 * 1,04 de janeiro a março e 1,04 × 1,02 de abril em diante. "Remover Reajustes" desliga: a DRE volta aos valores das
 * premissas (o valor reajustado ÷ o fator de cada mês).
 */

export const MAXIMO_DE_REAJUSTES = 4;

/** Um reajuste de um índice: o percentual (5 = 5%) e o mês em que começa (1 a 12, no exercício do cenário). */
export type ReajusteDoIndice = { valor: number; mes: number };
/** Um Índice de Reajuste das Premissas. */
export type IndiceDosReajustes = { chave: string; descricao: string; observacao: string | null; reajustes: ReajusteDoIndice[] };

/** Os Índices de Reajuste gravados no cenário (vazio sem índices). */
export function indicesDosReajustes(c: { indicesDosReajustes: unknown }): IndiceDosReajustes[] {
  return Array.isArray(c.indicesDosReajustes) ? (c.indicesDosReajustes as IndiceDosReajustes[]) : [];
}

/** A Aplicação dos Reajustes gravada: { código da conta: chave do índice }. */
export function aplicacaoDosReajustes(c: { aplicacaoDosReajustes: unknown }): Record<string, string> {
  const a = c.aplicacaoDosReajustes;
  return a && typeof a === "object" && !Array.isArray(a) ? (a as Record<string, string>) : {};
}

/** Os fatores de um índice nos doze meses: cada reajuste multiplica do mês dele em diante, sobre os anteriores. */
export function fatoresDoIndice(reajustes: ReajusteDoIndice[]): number[] {
  return Array.from({ length: 12 }, (_, k) => reajustes.reduce((f, r) => (k + 1 >= r.mes ? f * (1 + r.valor / 100) : f), 1));
}

/** Os fatores de cada conta com índice na Aplicação dos Reajustes (as contas cujo índice muda algum mês). */
export function fatoresDasContas(c: { indicesDosReajustes: unknown; aplicacaoDosReajustes: unknown }): Map<string, number[]> {
  const doIndice = new Map(indicesDosReajustes(c).map((i) => [i.chave, fatoresDoIndice(i.reajustes)]));
  const fatores = new Map<string, number[]>();
  for (const [codigo, chave] of Object.entries(aplicacaoDosReajustes(c))) {
    const f = doIndice.get(chave);
    if (f && f.some((x) => x !== 1)) fatores.set(codigo, f);
  }
  return fatores;
}

/**
 * Confere uma lista de reajustes de um índice: de 1 a 4, cada um com o percentual (acima de −100%) e o mês (1 a 12), em
 * meses crescentes. Devolve o erro, ou null.
 */
export function erroDosReajustes(descricao: string, reajustes: ReajusteDoIndice[]): string | null {
  if (!reajustes.length) return `O índice ${descricao} precisa de ao menos um reajuste (o Valor (%) e o Inicia Em).`;
  if (reajustes.length > MAXIMO_DE_REAJUSTES) return `O índice ${descricao} tem mais de ${MAXIMO_DE_REAJUSTES} reajustes.`;
  for (const r of reajustes) {
    if (!Number.isFinite(r.valor) || r.valor <= -100) return `O índice ${descricao} tem um Valor (%) inválido: use um número acima de −100.`;
    if (!Number.isInteger(r.mes) || r.mes < 1 || r.mes > 12) return `O índice ${descricao} tem um Inicia Em inválido.`;
  }
  if (reajustes.some((r, k) => k > 0 && r.mes <= reajustes[k - 1].mes)) return `Os reajustes do índice ${descricao} precisam começar em meses crescentes (cada um depois do anterior).`;
  return null;
}

/** O resumo de um cálculo com os reajustes: as contas e os meses reajustados, quantos valores e as somas sem e com eles. */
export type ResumoDosReajustes = { contas: Set<string>; meses: Set<number>; valores: number; somaSem: number; somaCom: number };
export const resumoVazio = (): ResumoDosReajustes => ({ contas: new Set(), meses: new Set(), valores: 0, somaSem: 0, somaCom: 0 });
