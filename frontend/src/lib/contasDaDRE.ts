/**
 * A descrição de origem de uma linha da DRE (25/11/2026, passo 3 de renomear os cadastros; a mesma regra do backend, em
 * dre/descricaoDeOrigem.ts): o código de uma linha termina na descrição com que ela nasceu, em slug (DVV.GGV.FRETE_E_DESCARGA),
 * e não muda. As telas acham as contas por ela, e não pela Descrição, que muda a qualquer momento.
 */
export function slugDaDRE(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/** A descrição de origem: a última parte do código. */
export const descricaoDeOrigem = (codigo: string) => codigo.slice(codigo.lastIndexOf(".") + 1);

/** A linha é a conta que nasceu com esta descrição? */
export const ehAConta = (l: { codigo: string }, descricao: string) => descricaoDeOrigem(l.codigo) === slugDaDRE(descricao);
