import { Router } from "express";

import {
  autenticacaoDaApi,
  conectividadeController as c,
  pedidosPorUsuario,
  tokenPorEmail,
  tokenPorEndereco,
} from "../../controllers/conectividade/conectividadeController.js";
import { autenticacao } from "../../middlewares/autenticacao.js";
import { verificarAlgumaPermissao, verificarPermissao } from "../../middlewares/verificarPermissao.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

/**
 * A API externa da Biblioteca de APIs (24/10/2026), montada em /v1 (no servidor do Next, /api/v1): o token, pelo login e
 * pela senha do SIG, e os dados, pelo token da API. As regras (HTTPS, a permissão, os bloqueios e a Auditoria) ficam no
 * serviço.
 */
export const apiExternaRoutes = Router();
apiExternaRoutes.post("/token", tokenPorEndereco, tokenPorEmail, asyncHandler(c.token));
apiExternaRoutes.get("/apis", asyncHandler(autenticacaoDaApi), pedidosPorUsuario, asyncHandler(c.catalogoDaApi));
apiExternaRoutes.get("/apis/:codigo", asyncHandler(autenticacaoDaApi), pedidosPorUsuario, asyncHandler(c.executar));

/**
 * A Central de Conectividade, montada em /conectividade: a tela APIs (Ler vê o catálogo e a prévia; Editar bloqueia as APIs)
 * e, desde 13/11/2026, a tela Acessos, aba APIs (Ler vê os próprios acessos; Editar, os de todos e os bloqueios de
 * usuários e endereços; o controlador confere a permissão de cada tipo de bloqueio).
 */
export const conectividadeRoutes = Router();
const ler = verificarPermissao("biblioteca_apis:ler");
conectividadeRoutes.get("/catalogo", autenticacao, ler, asyncHandler(c.catalogo));
conectividadeRoutes.get("/previa/:codigo", autenticacao, ler, asyncHandler(c.previa));
conectividadeRoutes.get("/acessos", autenticacao, verificarPermissao("conectividade_acessos.apis:ler"), asyncHandler(c.acessos));
conectividadeRoutes.put("/bloqueios", autenticacao, verificarAlgumaPermissao("biblioteca_apis:editar", "conectividade_acessos.apis:editar"), asyncHandler(c.bloquear));
