/**
 * A descrição de origem de uma linha da DRE (25/11/2026, pedido do Adão: os nomes dos cadastros mudam a qualquer momento; passo
 * 3 de renomear os cadastros). O código de uma linha é a sigla do grupo, a da atribuição e a descrição com que ela nasceu, em
 * slug (ROB.RBF.RECEITA_BRUTA_DE_FRETE, DVV.GGV.FRETE_E_DESCARGA), e não muda: a Recarga dos Cadastros o mantém mesmo com
 * outra descrição na planilha. As regras da apuração, dos recortes e das telas acham as contas pela última parte dele (a
 * descrição de origem), e não pela Descrição, que muda a qualquer momento.
 */

/** O texto como as partes do código das linhas da DRE: maiúsculas, sem acentos, "_" no lugar dos espaços e dos sinais, até 40 caracteres. */
export function slugDaDRE(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/** A descrição de origem: a última parte do código ("DVV.GGV.FRETE_E_DESCARGA" → "FRETE_E_DESCARGA"). */
export const descricaoDeOrigem = (codigo: string) => codigo.slice(codigo.lastIndexOf(".") + 1);

/** A linha é a conta que nasceu com esta descrição? (`ehAConta(l, "Impostos Operacionais")`.) */
export const ehAConta = (l: { codigo: string }, descricao: string) => descricaoDeOrigem(l.codigo) === slugDaDRE(descricao);

/** O código sem o grupo — a atribuição e a descrição de origem: liga as linhas equivalentes de outros departamentos (CPP, CSM, CSC). */
export const semOGrupo = (codigo: string) => codigo.slice(codigo.indexOf(".") + 1);

const normal = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toUpperCase();

/**
 * O texto de uma planilha (a descrição de uma conta: a DRE do Comercial, os créditos de impostos, a planilha dos sintéticos, a
 * conferência) casa com a linha: pela Descrição atual ou pela de origem (os arquivos com o nome de antes de uma troca).
 */
export const casaComADescricao = (l: { codigo: string; descricao: string }, texto: string) => normal(l.descricao) === normal(texto) || ehAConta(l, texto);
