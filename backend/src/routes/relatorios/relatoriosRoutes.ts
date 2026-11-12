import { Router } from "express";

import { relatoriosController as c } from "../../controllers/relatorios/relatoriosController.js";
import { autenticacao } from "../../middlewares/autenticacao.js";
import { abaDaVisao, verificarAba, verificarAlgumaPermissao, verificarPermissao } from "../../middlewares/verificarPermissao.js";
import { ABA_DA_VISAO } from "../../services/acesso/telas.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

/** Relatórios do exercício (Resultados, Indicadores e Painel de Bordo): montado em /relatorios. */
export const relatoriosRoutes = Router();
// As telas dos Resultados Empresariais por tela e por aba (14/10/2026): a da visão pedida; a exportação, as das visões dela.
relatoriosRoutes.get("/resultados", autenticacao, verificarAba("relatorio_resultados", "ler", (r) => {
  const a = abaDaVisao(r.query.visao ?? 0);
  return a ? [a] : null;
}), asyncHandler(c.resultados));
relatoriosRoutes.get("/resultados/exportar", autenticacao, verificarAba("relatorio_resultados", "ler", (r) => {
  const escopo = String(r.query.escopo ?? "atual");
  if (escopo === "unidades") return [...ABA_DA_VISAO];
  // As obras e os movimentos sem centro de custo (14/10/2026): a aba deles, de um ou de todos.
  if (escopo === "obras" || r.query.visao === "obras") return ["obras"];
  if (escopo === "sem_centros" || r.query.visao === "sem_centros") return ["sem_centros"];
  // As linhas (26/10/2026): a aba Linhas ou a Rateios das Linhas.
  if (escopo === "linhas" || r.query.visao === "linhas") return ["linhas"];
  if (escopo === "rateios_linhas" || r.query.visao === "rateios_linhas") return ["rateios_linhas"];
  if (escopo === "centros" || escopo === "centros_arquivos" || r.query.grupo !== undefined) return ["centros"];
  const a = abaDaVisao(r.query.visao ?? 0);
  return a ? [a] : null;
}), asyncHandler(c.exportarResultados));
// O Pesquisar (11/11/2026, pedido do Adão): os movimentos de um fornecedor ou de uma conta, no recorte do usuário.
relatoriosRoutes.get("/resultados/pesquisa", autenticacao, verificarPermissao("relatorio_resultados:ler"), asyncHandler(c.pesquisar));
relatoriosRoutes.get("/resultados/pesquisa/contas", autenticacao, verificarPermissao("relatorio_resultados:ler"), asyncHandler(c.contasDaPesquisa));
// A aba Impostos (Créditos de Impostos, 03/11/2026, pedido do Adão; de início, Almoxarifado): os créditos de impostos de cada mês.
relatoriosRoutes.get("/resultados/impostos", autenticacao, verificarPermissao("relatorio_resultados.impostos:ler"), asyncHandler(c.impostos));
// Os indicadores: a tela Indicadores dos Resultados Empresariais ou, na etapa do Fechamento Mensal (?etapa=1), a dela.
relatoriosRoutes.get("/indicadores/exportar", autenticacao, verificarAlgumaPermissao("relatorio_painel.indicadores:ler", "totais.indicadores:ler"), asyncHandler(c.exportarIndicadores));
relatoriosRoutes.get("/indicadores", autenticacao, verificarAlgumaPermissao("relatorio_painel.indicadores:ler", "totais.indicadores:ler"), asyncHandler(c.indicadores));
relatoriosRoutes.get("/painel", autenticacao, verificarPermissao("relatorio_painel:ler"), asyncHandler(c.painel));
// O Compara Com (21/10/2026): os cenários marcados do exercício.
relatoriosRoutes.get("/comparaveis", autenticacao, verificarAlgumaPermissao("relatorio_resultados:ler", "relatorio_painel:ler"), asyncHandler(c.comparaveis));
