import { Router } from "express";

import { edicaoCadastrosController as c } from "../../controllers/cadastros/edicaoCadastrosController.js";
import { autenticacao } from "../../middlewares/autenticacao.js";
import { verificarPermissaoDoCadastro } from "../../middlewares/verificarPermissao.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

// Cada cadastro segue o grupo do menu dele: Cadastros da Apuração ou da Controladoria.
const ler = verificarPermissaoDoCadastro("ler");
const editar = verificarPermissaoDoCadastro("editar");

/**
 * Edição dos cadastros (Passo 25): montado em /cadastros/edicao. A entidade é
 * centros-custo, contas-resultado, reclassificacoes, estrutura-dre, unidades,
 * regras-rateio, tipos-movimento ou tabela-estacas.
 */
export const edicaoCadastrosRoutes = Router();
edicaoCadastrosRoutes.get("/:entidade/definicao", autenticacao, ler, asyncHandler(c.definicao));
edicaoCadastrosRoutes.get("/:entidade", autenticacao, ler, asyncHandler(c.listar));
// Os valores dos itens da Metodologia e o Testar (11/11/2026): só leem (a competência fechada mais recente).
edicaoCadastrosRoutes.get("/:entidade/valores-da-metodologia", autenticacao, ler, asyncHandler(c.valoresDosItens));
edicaoCadastrosRoutes.post("/:entidade/testar", autenticacao, ler, asyncHandler(c.testar));
edicaoCadastrosRoutes.get("/:entidade/:id", autenticacao, ler, asyncHandler(c.ler));
edicaoCadastrosRoutes.post("/:entidade", autenticacao, editar, asyncHandler(c.criar));
edicaoCadastrosRoutes.put("/:entidade/:id", autenticacao, editar, asyncHandler(c.atualizar));
edicaoCadastrosRoutes.delete("/:entidade/:id", autenticacao, editar, asyncHandler(c.excluir));
