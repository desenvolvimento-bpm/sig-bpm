import { Router } from "express";

import { contestacoesController as c } from "../../controllers/contestacoes/contestacoesController.js";
import { autenticacao } from "../../middlewares/autenticacao.js";
import { verificarAlgumaPermissao, verificarPermissao } from "../../middlewares/verificarPermissao.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

/**
 * As Contestações de Gastos (27/10/2026): montado em /contestacoes. Contestar e as opções do modal pedem Editar na aba
 * Solicitadas; acatar e recusar, na aba Recebidas; Processar e Alterar Status, na tela Validações; desfazer a importação,
 * na aba Contestações dos Lançamentos.
 */
export const contestacoesRoutes = Router();
contestacoesRoutes.get("/opcoes", autenticacao, verificarPermissao("contestacoes.solicitadas:editar"), asyncHandler(c.opcoes));
contestacoesRoutes.get("/previa", autenticacao, verificarPermissao("contestacoes.solicitadas:editar"), asyncHandler(c.previa));
contestacoesRoutes.post("/", autenticacao, verificarPermissao("contestacoes.solicitadas:editar"), asyncHandler(c.criar));
contestacoesRoutes.get("/solicitadas", autenticacao, verificarPermissao("contestacoes.solicitadas:ler"), asyncHandler(c.listar("solicitadas")));
contestacoesRoutes.get("/recebidas", autenticacao, verificarPermissao("contestacoes.recebidas:ler"), asyncHandler(c.listar("recebidas")));
contestacoesRoutes.get("/validacoes", autenticacao, verificarPermissao("contestacoes_validacoes:ler"), asyncHandler(c.listar("validacoes")));
contestacoesRoutes.post("/processar", autenticacao, verificarPermissao("contestacoes_validacoes:editar"), asyncHandler(c.processar));
// Os itens de um movimento (10/11/2026): Ler na aba em que a contestação aparece (?aba=).
contestacoesRoutes.get("/:id/movimentos/:movimentoId/itens", autenticacao, verificarAlgumaPermissao("contestacoes.solicitadas:ler", "contestacoes.recebidas:ler", "contestacoes_validacoes:ler"), asyncHandler(c.itensDoMovimento));
contestacoesRoutes.post("/:id/responder", autenticacao, verificarPermissao("contestacoes.recebidas:editar"), asyncHandler(c.responder));
contestacoesRoutes.post("/:id/situacao", autenticacao, verificarPermissao("contestacoes_validacoes:editar"), asyncHandler(c.alterarSituacao));
contestacoesRoutes.delete("/:id/importacao", autenticacao, verificarPermissao("lancamentos_manuais.contestacoes:editar"), asyncHandler(c.desfazerImportacao));

/** As acatadas para os lançamentos manuais de uma competência: montado em /competencias/:anoMes/contestacoes. */
export const contestacoesDaCompetenciaRoutes = Router({ mergeParams: true });
contestacoesDaCompetenciaRoutes.get("/pendentes", autenticacao, verificarPermissao("lancamentos_manuais.contestacoes:ler"), asyncHandler(c.paraLancamentos));
contestacoesDaCompetenciaRoutes.post("/importar", autenticacao, verificarPermissao("lancamentos_manuais.contestacoes:editar"), asyncHandler(c.importar));
