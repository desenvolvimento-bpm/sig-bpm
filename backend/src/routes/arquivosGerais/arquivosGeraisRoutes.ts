import express, { Router, type NextFunction, type Request, type Response } from "express";

import { arquivosGeraisController as c } from "../../controllers/arquivosGerais/arquivosGeraisController.js";
import { autenticacao } from "../../middlewares/autenticacao.js";
import { verificarPermissao } from "../../middlewares/verificarPermissao.js";
import { ehTelaDosArquivos, TELAS_DOS_ARQUIVOS } from "../../services/arquivosGerais/arquivosGeraisService.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

/**
 * Os Arquivos Gerais (05/11/2026, pedido do Adão): montado em /arquivos-gerais, com a tela no endereço (treinamentos ou
 * informativos). Listar, visualizar e baixar pedem Ler na tela; adicionar e excluir, Editar. O arquivo novo chega cru no corpo
 * (sem o express.raw): o serviço o grava enquanto chega.
 */
const permissao = (acao: "ler" | "editar") => (request: Request, response: Response, next: NextFunction) => {
  const t = String(request.params.tela);
  if (!ehTelaDosArquivos(t)) return response.status(404).json({ error: "Tela de arquivos inexistente." });
  return verificarPermissao(`${TELAS_DOS_ARQUIVOS[t].tela}:${acao}`)(request, response, next);
};

export const arquivosGeraisRoutes = Router();
arquivosGeraisRoutes.get("/:tela", autenticacao, permissao("ler"), asyncHandler(c.listar));
arquivosGeraisRoutes.post("/:tela", autenticacao, permissao("editar"), asyncHandler(c.adicionar));
arquivosGeraisRoutes.get("/:tela/:id/conteudo", autenticacao, permissao("ler"), asyncHandler(c.conteudo));
arquivosGeraisRoutes.delete("/:tela/:id", autenticacao, permissao("editar"), asyncHandler(c.excluir));
// O Editar (11/11/2026): a descrição e o processo.
arquivosGeraisRoutes.put("/:tela/:id", autenticacao, permissao("editar"), express.json(), asyncHandler(c.editar));
