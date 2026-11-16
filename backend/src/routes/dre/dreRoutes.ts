import { Router } from "express";

import { dreController as c } from "../../controllers/dre/dreController.js";
import { autenticacao } from "../../middlewares/autenticacao.js";
import { lerDREDoMes, verificarPermissao } from "../../middlewares/verificarPermissao.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

/** DRE apurada de uma competência: montado em /competencias/:anoMes/dre. */
export const dreRoutes = Router({ mergeParams: true });
dreRoutes.get("/", autenticacao, lerDREDoMes, asyncHandler(c.consultar));
dreRoutes.get("/consolidado", autenticacao, lerDREDoMes, asyncHandler(c.consolidado));
dreRoutes.get("/centros", autenticacao, lerDREDoMes, asyncHandler(c.centros));
dreRoutes.get("/obras", autenticacao, lerDREDoMes, asyncHandler(c.obras));
dreRoutes.get("/sem-centros", autenticacao, lerDREDoMes, asyncHandler(c.semCentros));
dreRoutes.get("/detalhe", autenticacao, lerDREDoMes, asyncHandler(c.detalhe));
// As Regras de Rateio vigentes no mês (04/11/2026): o extrato de uma linha e o modal Contestar.
dreRoutes.get("/rateios", autenticacao, lerDREDoMes, asyncHandler(c.rateios));
dreRoutes.get("/detalhe/exportar", autenticacao, lerDREDoMes, asyncHandler(c.exportarExtrato));
dreRoutes.get("/documentos", autenticacao, lerDREDoMes, asyncHandler(c.documentos));
dreRoutes.get("/documentos/itens", autenticacao, lerDREDoMes, asyncHandler(c.itensDoMovimento));
dreRoutes.get("/volumes", autenticacao, lerDREDoMes, asyncHandler(c.volumes));
dreRoutes.get("/exportar", autenticacao, lerDREDoMes, asyncHandler(c.exportar));
dreRoutes.post("/apurar", autenticacao, verificarPermissao("dre:editar"), asyncHandler(c.apurar));
