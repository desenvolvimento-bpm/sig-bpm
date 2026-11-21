/**
 * Os Reajustes das Premissas dos cenários analíticos (11/11/2026, pedido do Adão; a aba Reajustes, depois dos Indicadores
 * Manuais): os Índices de Reajuste — cada um com até quatro reajustes, o Valor (%) e o mês em que ele Inicia Em — e a
 * Aplicação dos Reajustes, os índices de cada conta da DRE (desde 19/11/2026, até dois: o 1º e o 2º Índice de Reajuste).
 *
 * Com os reajustes aplicados (o Recalcular dos Resultados, "Aplicar Reajustes"), cada cálculo da DRE multiplica o valor
 * de cada conta com índice, em cada unidade e mês, pelo fator do índice no mês: o produto de (1 + Valor ÷ 100) dos
 * reajustes que já começaram. Cada reajuste vale sobre os anteriores: 4% a partir de janeiro e 2% a partir de abril dão
 * 1,04 de janeiro a março e 1,04 × 1,02 de abril em diante. Com dois índices na conta, eles rodam na ordem: o 1º sobre o
 * valor das premissas e o 2º sobre o valor já reajustado pelo 1º (o fator do mês é o do 1º × o do 2º). "Remover Reajustes"
 * desliga: a DRE volta aos valores das premissas (o valor reajustado ÷ o fator de cada mês).
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

/** Os índices de uma conta na Aplicação dos Reajustes (19/11/2026, pedido do Adão: até dois): o 1º e o 2º (ou nulo), nessa ordem. */
export type IndicesDaConta = [string, string | null];

/**
 * A Aplicação dos Reajustes gravada: { código da conta: [1º índice, 2º índice ou nulo] }. A de antes de 19/11/2026
 * ({ código: chave do índice }) vale como só o 1º.
 */
export function aplicacaoDosReajustes(c: { aplicacaoDosReajustes: unknown }): Record<string, IndicesDaConta> {
  const a = c.aplicacaoDosReajustes;
  if (!a || typeof a !== "object" || Array.isArray(a)) return {};
  const aplicacao: Record<string, IndicesDaConta> = {};
  for (const [codigo, valor] of Object.entries(a as Record<string, unknown>)) {
    const chaves = (Array.isArray(valor) ? valor : [valor]).filter((x): x is string => typeof x === "string" && x !== "");
    if (chaves.length) aplicacao[codigo] = [chaves[0], chaves[1] ?? null];
  }
  return aplicacao;
}

/** As vendas das tabelas das premissas da Matriz e da Filial (premissasCenario.VENDAS_DA_UNIDADE), na ordem dos grupos. */
export const VENDAS_DOS_GRUPOS = [
  { chave: "GLOBAL", nome: "GLOBAL" },
  { chave: "MERCANTIL", nome: "MERCANTIL" },
] as const;

/**
 * Os grupos da DRE cujas contas recebem os índices por unidade e venda: os Custos de Produção (CPP) — 19/11/2026, pedido do
 * Adão, um grupo de linhas da Matriz e um da Filial; 21/11/2026, pedido do Adão, cada unidade em dois, Global e Mercantil — na
 * Aplicação dos Reajustes. A chave da conta é "unidade|venda|código" ("1|GLOBAL|CPP.MP.CIMENTO"); a de 19/11/2026,
 * "unidade|código", vale para as duas vendas da unidade, e a sem unidade (as demais contas e a gravação de antes), para todas.
 */
export const GRUPOS_POR_UNIDADE: Record<string, Array<{ unidade: number; nome: string; vendas: typeof VENDAS_DOS_GRUPOS }>> = {
  CPP: [
    { unidade: 1, nome: "MATRIZ", vendas: VENDAS_DOS_GRUPOS },
    { unidade: 2, nome: "FILIAL", vendas: VENDAS_DOS_GRUPOS },
  ],
};

/** O código da conta, a unidade e a venda de uma chave da Aplicação dos Reajustes (sem unidade ou sem venda: nulas). */
export function daChave(chave: string): { codigo: string; unidade: number | null; venda: string | null } {
  const m = /^(\d+)\|(?:(GLOBAL|MERCANTIL)\|)?(.+)$/.exec(chave);
  return m ? { codigo: m[3], unidade: Number(m[1]), venda: m[2] ?? null } : { codigo: chave, unidade: null, venda: null };
}

/**
 * Os índices de uma linha da Aplicação: os da conta na unidade e na venda ("1|GLOBAL|CPP…") ou, sem eles, os da conta na
 * unidade ("1|CPP…", a gravação de 19/11/2026) ou os da conta (a gravação de antes).
 */
export function indicesDaLinha(aplicacao: Record<string, IndicesDaConta>, chave: string): IndicesDaConta | undefined {
  const { codigo, unidade } = daChave(chave);
  return aplicacao[chave] ?? (unidade !== null ? aplicacao[`${unidade}|${codigo}`] : undefined) ?? aplicacao[codigo];
}

/** O fator de uma conta numa unidade (de fatoresDasContas): o da conta na unidade ou, sem ele, o da conta. */
export const fatorNaUnidade = (fatores: Map<string, number[]>, codigo: string, unidade: number) => fatores.get(`${unidade}|${codigo}`) ?? fatores.get(codigo);
/** O fator de uma conta numa unidade e numa venda (21/11/2026): o da venda, o da unidade ou o da conta. */
export const fatorNaVenda = (fatores: Map<string, number[]>, codigo: string, unidade: number, venda: string) =>
  fatores.get(`${unidade}|${venda}|${codigo}`) ?? fatorNaUnidade(fatores, codigo, unidade);

/**
 * O valor reajustado de uma conta dos Custos de Produção numa unidade, venda a venda (21/11/2026, pedido do Adão), nos doze
 * meses: a parte de cada venda é a das premissas dela (a tabela Global ou Mercantil) mais o resto da conta (os centros de
 * custo e a depreciação, que não têm venda) na proporção do volume produzido dela no mês (sem volume no mês, tudo na
 * primeira venda); cada parte sai multiplicada pelo fator da venda (sem ele, 1). Com o mesmo fator nas vendas, é o total ×
 * o fator, como antes.
 */
export function reajustarPorVenda(
  total: number[],
  vendas: Array<{ venda: string; premissas: number[]; volume: number[]; fator: number[] | undefined }>,
): number[] {
  return total.map((t, m) => {
    const resto = t - vendas.reduce((s, v) => s + (v.premissas[m] ?? 0), 0);
    const volume = vendas.reduce((s, v) => s + Math.max(0, v.volume[m] ?? 0), 0);
    return vendas.reduce((s, v, k) => {
      const parte = volume > 0 ? Math.max(0, v.volume[m] ?? 0) / volume : k === 0 ? 1 : 0;
      return s + ((v.premissas[m] ?? 0) + resto * parte) * (v.fator?.[m] ?? 1);
    }, 0);
  });
}

/** Quantas contas usam cada índice na Aplicação dos Reajustes (no 1º ou no 2º); `vale` filtra as contas. */
export function usosDosIndices(aplicacao: Record<string, IndicesDaConta>, vale: (codigo: string) => boolean = () => true): Map<string, number> {
  const usos = new Map<string, number>();
  for (const [codigo, chaves] of Object.entries(aplicacao)) {
    if (!vale(codigo)) continue;
    for (const chave of new Set(chaves.filter((x): x is string => !!x))) usos.set(chave, (usos.get(chave) ?? 0) + 1);
  }
  return usos;
}

/** Os fatores de um índice nos doze meses: cada reajuste multiplica do mês dele em diante, sobre os anteriores. */
export function fatoresDoIndice(reajustes: ReajusteDoIndice[]): number[] {
  return Array.from({ length: 12 }, (_, k) => reajustes.reduce((f, r) => (k + 1 >= r.mes ? f * (1 + r.valor / 100) : f), 1));
}

/**
 * Os fatores de cada conta com índice na Aplicação dos Reajustes (as contas cujos índices mudam algum mês), pela chave dela
 * (o código ou, nos Custos de Produção, "unidade|código": fatorNaUnidade): com dois índices (19/11/2026), o 1º e depois o 2º,
 * sobre o valor já reajustado pelo 1º — o fator do mês é o produto dos dois.
 */
export function fatoresDasContas(c: { indicesDosReajustes: unknown; aplicacaoDosReajustes: unknown }): Map<string, number[]> {
  const doIndice = new Map(indicesDosReajustes(c).map((i) => [i.chave, fatoresDoIndice(i.reajustes)]));
  const fatores = new Map<string, number[]>();
  for (const [codigo, chaves] of Object.entries(aplicacaoDosReajustes(c))) {
    const dosIndices = chaves.map((chave) => (chave ? doIndice.get(chave) : undefined)).filter((f): f is number[] => !!f);
    if (!dosIndices.length) continue;
    const f = Array.from({ length: 12 }, (_, k) => dosIndices.reduce((produto, doIndice) => produto * doIndice[k], 1));
    if (f.some((x) => x !== 1)) fatores.set(codigo, f);
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
