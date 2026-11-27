import type { Request, Response } from "express";
import { z } from "zod";

import { semRecorte } from "../../services/acesso/acesso.js";
import { RegraRealizadoObraError, realizadoObraService as s } from "../../services/realizadoObra/realizadoObraService.js";

async function responder(response: Response, fn: () => Promise<unknown>) {
  try {
    return response.json({ data: await fn() });
  } catch (error) {
    if (error instanceof RegraRealizadoObraError) return response.status(error.status).json({ error: error.message });
    throw error;
  }
}

/** O Realizado por Obra (03/11/2026): montado em /realizado-por-obra. Cada usuário vê a venda que escolheu. */
export const realizadoObraController = {
  /** GET /vendas: as opções da lista Venda e a escolhida pelo usuário. */
  vendas(request: Request, response: Response) {
    return responder(response, () => s.vendas(request.user!.sub));
  },

  /** PUT /venda: grava a venda do usuário (a obra e a versão vendida). */
  escolher(request: Request, response: Response) {
    const corpo = z.object({ obraId: z.string().uuid(), versao: z.number().int().min(0).max(99) }).safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: "Escolha a venda." });
    return responder(response, () => s.escolher(request.user!.sub, corpo.data.obraId, corpo.data.versao));
  },

  /** GET /resultados: a DRE da venda, por aba, contra o vendido; sem recorte (27/11/2026): quem lê a tela a vê inteira. */
  resultados(request: Request, response: Response) {
    return responder(response, () => s.resultados(request.user!.sub, semRecorte(request.user!.acesso)));
  },

  /** GET /memoria?mes=AAAAMM&aba=&codigo=: a memória de cálculo de um subtotal agrupado (a Mão de Obra e os Gastos Gerais). */
  memoria(request: Request, response: Response) {
    const q = z
      .object({ mes: z.coerce.number().int().min(202501).max(210012), aba: z.string().trim().min(1).max(60), codigo: z.string().trim().min(1).max(120) })
      .safeParse(request.query);
    if (!q.success || q.data.mes % 100 < 1 || q.data.mes % 100 > 12) return response.status(400).json({ error: "Mês, aba ou linha inválidos." });
    return responder(response, () => s.memoria(request.user!.sub, Math.floor(q.data.mes / 100), q.data.mes % 100, q.data.aba, q.data.codigo));
  },
};
