import { Router } from "express";

import { autenticacao } from "../../middlewares/autenticacao.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { buscarMovimento, MovimentoNaoEncontrado } from "../../services/totvs/movimentoRm.js";

/** Movimentos do TOTVS RM (leitura): montado em /movimento. Tela fora do menu, por enquanto. */
export const movimentoRoutes = Router();

movimentoRoutes.get(
  "/:idmov",
  autenticacao,
  asyncHandler(async (request, response) => {
    const idmov = Number(request.params.idmov);
    if (!Number.isInteger(idmov) || idmov <= 0) {
      return response.status(400).json({ error: "IDMOV inválido." });
    }
    try {
      return response.json({ data: await buscarMovimento(idmov) });
    } catch (error) {
      if (error instanceof MovimentoNaoEncontrado) return response.status(404).json({ error: error.message });
      const mensagem = error instanceof Error ? error.message : "";
      // Falha do RM (licença, tempo esgotado, sentença): 502 com a mensagem, como na importação dos lançamentos.
      if (mensagem.startsWith("TOTVS RM:")) return response.status(502).json({ error: mensagem });
      throw error;
    }
  }),
);
