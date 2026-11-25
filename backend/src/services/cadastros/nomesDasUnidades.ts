import { getPrismaClient } from "../../config/prisma.js";

/**
 * Os nomes das unidades (25/11/2026, pedido do Adão: o Nome das unidades muda a qualquer momento; as regras usam o código,
 * de 1 a 5). As telas, os relatórios, as exportações e as APIs do Fechamento Mensal e dos Resultados mostram o nome do
 * cadastro, guardado aqui: carregado na partida do servidor e de novo a cada gravação do cadastro Unidades. Antes da carga
 * (e para um código fora do cadastro), os nomes de sempre. Os cenários têm a cópia deles (CenarioUnidade).
 */
export const NOMES_DE_SEMPRE: Readonly<Record<number, string>> = { 1: "Matriz", 2: "Filial", 3: "Serviços", 4: "Despesas e Extra", 5: "RN" };

let guardados = new Map<number, string>(Object.entries(NOMES_DE_SEMPRE).map(([codigo, nome]) => [Number(codigo), nome]));

/** Lê os nomes do cadastro (na partida e depois de gravar uma unidade). */
export async function carregarNomesDasUnidades(): Promise<void> {
  const unidades = await getPrismaClient().unidadeNegocio.findMany({ select: { codigo: true, nome: true } });
  guardados = new Map([...Object.entries(NOMES_DE_SEMPRE).map(([codigo, nome]) => [Number(codigo), nome] as const), ...unidades.map((u) => [u.codigo, u.nome] as const)]);
}

/** O nome da unidade no cadastro. */
export function nomeDaUnidade(codigo: number): string {
  return guardados.get(codigo) ?? NOMES_DE_SEMPRE[codigo] ?? `Unidade ${codigo}`;
}

/** O nome da visão: 0 é o Consolidado; as outras, as unidades. */
export function nomeDaVisao(visao: number): string {
  return visao === 0 ? "Consolidado" : nomeDaUnidade(visao);
}

/** Os nomes de todas as unidades do cadastro, pelo código (a rota das telas). */
export function nomesDasUnidades(): Array<{ codigo: number; nome: string }> {
  return [...guardados].map(([codigo, nome]) => ({ codigo, nome })).sort((a, b) => a.codigo - b.codigo);
}

/** As unidades dos baldes e dos destinos de rateio que são uma unidade. */
const UNIDADE_DO_BALDE: Readonly<Record<string, number>> = { MATRIZ: 1, FILIAL: 2, SERVICOS: 3 };

/** O nome de um balde ou destino de rateio que é uma unidade (MATRIZ, FILIAL, SERVICOS); dos outros, nada. */
export function nomeDoBalde(balde: string): string | undefined {
  const unidade = UNIDADE_DO_BALDE[balde];
  return unidade === undefined ? undefined : nomeDaUnidade(unidade);
}
