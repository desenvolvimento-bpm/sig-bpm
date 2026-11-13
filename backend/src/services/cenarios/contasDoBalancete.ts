import { getPrismaClient } from "../../config/prisma.js";
import { CenarioError } from "./cenariosService.js";

/**
 * As Contas do Balancete de uma conta da DRE (13/11/2026, pedido do Adão: o botão das contas em Premissas / Centros de
 * Custo e em Resultados dos Cenários Analíticos): as contas do RM (Contas de Resultado) cuja Linha da DRE é a linha
 * clicada, as ativas primeiro, pela conta.
 */
export async function contasDoBalancete(codigo: string) {
  const db = getPrismaClient();
  const linha = await db.linhaDRE.findFirst({ where: { codigo }, select: { id: true, codigo: true, descricao: true, grupo: true, grupoSigla: true, atribuicao: true } });
  if (!linha) throw new CenarioError(404, `A conta ${codigo} não está na Estrutura da DRE.`);
  const contas = await db.contaResultado.findMany({
    where: { linhaDREId: linha.id },
    orderBy: [{ ativo: "desc" }, { conta: "asc" }, { reduzido: "asc" }],
    select: { reduzido: true, conta: true, descricao: true, departamento: true, balde: true, ativo: true },
  });
  const { id: _id, ...daLinha } = linha;
  return { linha: daLinha, contas };
}
