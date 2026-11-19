import type { getPrismaClient } from "../../config/prisma.js";

type Db = Pick<ReturnType<typeof getPrismaClient>, "departamento" | "unidadeNegocio">;

/** O departamento ou a unidade de uma linha nos quadros de destaque: o nome e a ordem do cadastro (sem ele, por último). */
export type NomeEOrdem = { nome: string; ordem: number };

/**
 * Os quadros de destaque por Departamento e Unidade (18/11/2026, pedido do Adão: o Lançamento Inicial dos Cadastros Auxiliares e a
 * aba Realizado do Quadro de Lotação). O departamento de um centro de custo é o do cadastro Departamentos (Cadastros Gerais /
 * Controladoria) que tem o grupo da DRE do centro (a sigla: CPP é Produção, DA é Administrativo…), com a ordem dele; sem o cadastro,
 * o departamento do centro. A unidade é a do cadastro Unidades de Negócio, com a ordem dele.
 */
export async function departamentoEUnidade(db: Db) {
  const [departamentos, unidades] = await Promise.all([
    db.departamento.findMany({ orderBy: { ordem: "asc" }, select: { nome: true, ordem: true, gruposDRE: true } }),
    db.unidadeNegocio.findMany({ select: { id: true, nome: true, ordem: true } }),
  ]);
  // O primeiro departamento de cada grupo da DRE, na ordem do cadastro (a Produção da Matriz e a da Filial têm o mesmo nome).
  const porSigla = new Map<string, NomeEOrdem>();
  for (const d of departamentos) for (const g of d.gruposDRE) if (!porSigla.has(g)) porSigla.set(g, { nome: d.nome, ordem: d.ordem });
  const unidadeDe = new Map(unidades.map((u) => [u.id, { nome: u.nome, ordem: u.ordem }]));
  return {
    departamento: (centro: { departamento: string | null; departamentoSigla: string | null }): NomeEOrdem | null =>
      (centro.departamentoSigla ? porSigla.get(centro.departamentoSigla) : undefined) ?? (centro.departamento ? { nome: centro.departamento, ordem: 9999 } : null),
    unidade: (id: string | null | undefined): NomeEOrdem | null => (id ? (unidadeDe.get(id) ?? null) : null),
  };
}
