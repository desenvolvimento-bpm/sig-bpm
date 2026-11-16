import type { getPrismaClient } from "../../config/prisma.js";
import { plural } from "../../utils/plural.js";

type Db = ReturnType<typeof getPrismaClient>;

/**
 * A trava do Lançamento Inicial (13/11/2026, pedido do Adão): com alguma competência fechada no Quadro de Lotação da Gestão
 * de Colaboradores, o quadro inicial não muda — nem o Importar, nem o Novo, a edição ou a exclusão de um colaborador, nem a
 * importação das Funções que apagaria o Lançamento Inicial. Devolve o motivo, ou nulo sem competência fechada.
 */
export async function travaDoLancamentoInicial(db: Db): Promise<string | null> {
  const fechadas = await db.colaboradorCompetencia.findMany({ where: { status: "FECHADA" }, orderBy: [{ ano: "asc" }, { mes: "asc" }], select: { ano: true, mes: true } });
  if (!fechadas.length) return null;
  const meses = fechadas.map((c) => `${String(c.mes).padStart(2, "0")}/${c.ano}`).join(", ");
  return `O Lançamento Inicial não se edita: a Gestão de Colaboradores tem ${fechadas.length} ${plural(fechadas.length, "competência fechada", "competências fechadas")} (${meses}). Para mudar o quadro inicial, reabra ${plural(fechadas.length, "a competência", "as competências")} no Quadro de Lotação.`;
}
