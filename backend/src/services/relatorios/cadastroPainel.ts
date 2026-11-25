import { getPrismaClient } from "../../config/prisma.js";
import { quadrosDoCadastro } from "./painelDeBordo.js";
import { comNomesNasFormulas, indicadoresParaReferencias } from "./referenciasDosIndicadores.js";

/**
 * O cadastro do Painel de Bordo (17/10/2026; Cadastros Gerais / Analítico / Painel de Bordo): os quadros das
 * abas Resultados e Performance montados com os itens ativos, na ordem do cadastro, cada um com a sua Metodologia. O
 * Painel de Resultados Empresariais, o dos cenários e os cards dos Relatórios Executivos usam estes quadros. Mudar o
 * cadastro pede reapurar as competências apuradas e abertas (apuracao/assinaturaCadastros.ts).
 */
export async function quadrosDoPainel() {
  const prisma = getPrismaClient();
  const [itens, { nomePorId }] = await Promise.all([
    prisma.painelItem.findMany({ where: { ativo: true }, orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }] }),
    indicadoresParaReferencias(prisma),
  ]);
  // As fórmulas com os nomes atuais dos indicadores (25/11/2026: gravadas pelo ID).
  return quadrosDoCadastro(itens.map((i) => comNomesNasFormulas(i, nomePorId)));
}
