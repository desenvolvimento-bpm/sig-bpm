import { getPrismaClient } from "../../config/prisma.js";
import { quadrosDoCadastro } from "./painelDeBordo.js";

/**
 * O cadastro do Painel de Bordo (17/10/2026; Cadastros Gerais / Analítico / Painel de Bordo): os quadros das
 * abas Resultados e Performance montados com os itens ativos, na ordem do cadastro, cada um com a sua Metodologia. O
 * Painel de Resultados Empresariais, o dos cenários e os cards dos Relatórios Executivos usam estes quadros. Mudar o
 * cadastro pede reapurar as competências apuradas e abertas (apuracao/assinaturaCadastros.ts).
 */
export async function quadrosDoPainel() {
  const itens = await getPrismaClient().painelItem.findMany({ where: { ativo: true }, orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }] });
  return quadrosDoCadastro(itens);
}
