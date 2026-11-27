/**
 * Os nomes das unidades no cadastro (25/11/2026, pedido do Adão: o Nome das unidades muda a qualquer momento; as telas
 * acham a unidade pelo código, de 1 a 6; desde 27/11/2026, a 6, Extra-Operacional, e a 4, Despesas). Guardados aqui pelo `useNomesDasUnidades` (a consulta ao servidor), para as
 * listas fixas das telas (as abas, os títulos) lerem o nome atual na hora de mostrar. Até a resposta chegar (e para um
 * código sem cadastro), os nomes de sempre. Os cenários têm a cópia deles e ficam com os nomes de sempre.
 */
export const NOMES_DE_SEMPRE: Readonly<Record<number, string>> = { 1: "Matriz", 2: "Filial", 3: "Serviços", 4: "Despesas", 5: "RN", 6: "Extra-Operacional", 7: "Leben" };

let guardados: Record<number, string> = { ...NOMES_DE_SEMPRE };

/** Guarda os nomes que vieram do servidor. */
export function guardarNomesDasUnidades(lista: Array<{ codigo: number; nome: string }>): void {
  guardados = { ...NOMES_DE_SEMPRE, ...Object.fromEntries(lista.map((u) => [u.codigo, u.nome])) };
}

/** O nome da unidade no cadastro. */
export function nomeDaUnidade(codigo: number | string): string {
  return guardados[Number(codigo)] ?? `Unidade ${codigo}`;
}

/** O nome da visão: 0 é o Consolidado; as outras, as unidades. */
export function nomeDaVisao(visao: number | string): string {
  return Number(visao) === 0 ? "Consolidado" : nomeDaUnidade(visao);
}
