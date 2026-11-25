import type { Prisma } from "../../generated/prisma/client.js";

/**
 * As referências aos indicadores e aos cards pelo ID (25/11/2026, pedido do Adão: os nomes dos cadastros mudam a qualquer
 * momento; passo 2 de renomear os cadastros).
 *
 * - As fórmulas gravadas (a Metodologia, o Peso da Média e a Fórmula do Acumulado dos indicadores; a Metodologia e o
 *   Percentual dos cards do Painel de Bordo) citam o indicador pelo ID: [IND|id], [META|id(|ACUM)] e [INDICADOR|id(|ACUM)].
 *   Na leitura, o ID vira o nome atual (`formulaComNomes`): o cálculo, as telas e o editor das fórmulas trabalham com os
 *   nomes. Na gravação, o nome vira o ID (`formulaComIds`). O item com um nome que não é de nenhum indicador do cadastro (um
 *   [IND|nome] importado que não está no cadastro) fica com o nome.
 * - Os blocos dos Relatórios Executivos e dos Painéis de Bordo guardam o `indicadorId` (o card de um indicador) e o `cardId`
 *   (o card do Painel de Bordo); a tela acha o card por eles e, num bloco sem eles, pelo nome.
 *
 * Assim, trocar o nome de um indicador ou de um card não muda as fórmulas nem os blocos.
 */

/** Um item de indicador numa fórmula: o tipo, a referência (o ID ou o nome) e o Acumulado no Ano. */
const ITEM_DE_INDICADOR = /\[(IND|META|INDICADOR)\|([^|\]]+)(\|ACUM)?\]/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** É um ID (UUID)? */
export const ehId = (s: string) => UUID.test(s);

/** A fórmula com os nomes atuais no lugar dos IDs (um ID sem indicador fica como está: a fórmula acusa o item). */
export function formulaComNomes(formula: string, nomePorId: ReadonlyMap<string, string>): string;
export function formulaComNomes(formula: string | null, nomePorId: ReadonlyMap<string, string>): string | null;
export function formulaComNomes(formula: string | null, nomePorId: ReadonlyMap<string, string>): string | null {
  if (!formula) return formula;
  return formula.replace(ITEM_DE_INDICADOR, (todo, tipo: string, ref: string, acum?: string) => {
    const nome = ehId(ref) ? nomePorId.get(ref) : undefined;
    return nome === undefined ? todo : `[${tipo}|${nome}${acum ?? ""}]`;
  });
}

/** A fórmula com os IDs no lugar dos nomes do cadastro (o que se grava). */
export function formulaComIds(formula: string, idPorNome: ReadonlyMap<string, string>): string;
export function formulaComIds(formula: string | null, idPorNome: ReadonlyMap<string, string>): string | null;
export function formulaComIds(formula: string | null, idPorNome: ReadonlyMap<string, string>): string | null {
  if (!formula) return formula;
  return formula.replace(ITEM_DE_INDICADOR, (todo, tipo: string, ref: string, acum?: string) => {
    const id = ehId(ref) ? undefined : idPorNome.get(ref);
    return id === undefined ? todo : `[${tipo}|${id}${acum ?? ""}]`;
  });
}

/** Os nomes pelo ID e os IDs pelo nome, dos indicadores dados. */
export function mapasDosIndicadores(indicadores: ReadonlyArray<{ id: string; nome: string }>) {
  return { nomePorId: new Map(indicadores.map((i) => [i.id, i.nome])), idPorNome: new Map(indicadores.map((i) => [i.nome, i.id])) };
}

type ComFormulas = { formula: string | null; peso?: string | null; percentual?: string | null };

/** O registro (indicador ou card) com as fórmulas pelos nomes atuais. */
export function comNomesNasFormulas<T extends ComFormulas>(r: T, nomePorId: ReadonlyMap<string, string>): T {
  return {
    ...r,
    formula: formulaComNomes(r.formula, nomePorId),
    ...("peso" in r ? { peso: formulaComNomes(r.peso ?? null, nomePorId) } : {}),
    ...("percentual" in r ? { percentual: formulaComNomes(r.percentual ?? null, nomePorId) } : {}),
  };
}

/** Os indicadores do cadastro (o ID e o nome), para as traduções. */
export async function indicadoresParaReferencias(db: Pick<Prisma.TransactionClient, "indicadorEstrutura">) {
  return mapasDosIndicadores(await db.indicadorEstrutura.findMany({ select: { id: true, nome: true } }));
}

/**
 * Passa ao ID os itens pelo nome que ainda houver nas fórmulas dos indicadores e dos cards (a carga inicial dos indicadores
 * grava as fórmulas com os nomes). Devolve quantos registros mudaram.
 */
export async function gravarFormulasPeloId(db: Pick<Prisma.TransactionClient, "indicadorEstrutura" | "painelItem">): Promise<number> {
  const indicadores = await db.indicadorEstrutura.findMany({ select: { id: true, nome: true, formula: true, peso: true } });
  const { idPorNome } = mapasDosIndicadores(indicadores);
  let mudaram = 0;
  for (const i of indicadores) {
    const [formula, peso] = [formulaComIds(i.formula, idPorNome), formulaComIds(i.peso, idPorNome)];
    if (formula === i.formula && peso === i.peso) continue;
    await db.indicadorEstrutura.update({ where: { id: i.id }, data: { formula, peso } });
    mudaram++;
  }
  for (const c of await db.painelItem.findMany({ select: { id: true, formula: true, percentual: true } })) {
    const [formula, percentual] = [formulaComIds(c.formula, idPorNome), formulaComIds(c.percentual, idPorNome)];
    if (formula === c.formula && percentual === c.percentual) continue;
    await db.painelItem.update({ where: { id: c.id }, data: { formula, percentual } });
    mudaram++;
  }
  return mudaram;
}

/**
 * Os valores ligados aos indicadores (25/11/2026, a parte 2b): os importados e digitados, as metas importadas, os valores dos
 * cenários (o campo `indicador`, na coluna "nome") e as justificativas das Premissas (o código I|…) guardam o ID do
 * indicador; o nome só quando não há indicador com ele no cadastro. `nomeDaReferencia` na leitura, `referenciaDoNome` na
 * gravação (as planilhas e as telas citam o indicador pelo nome).
 */
export type Referencias = { nomePorId: ReadonlyMap<string, string>; idPorNome: ReadonlyMap<string, string> };
export const nomeDaReferencia = (ref: string, r: Referencias) => r.nomePorId.get(ref) ?? ref;
export const referenciaDoNome = (nome: string, r: Referencias) => r.idPorNome.get(nome) ?? nome;

/** As linhas com o `nome` do indicador (o atual, pela referência gravada). */
export function comNomesDosIndicadores<T extends { indicador: string }>(linhas: T[], r: Referencias): Array<T & { nome: string }> {
  return linhas.map((l) => ({ ...l, nome: nomeDaReferencia(l.indicador, r) }));
}
