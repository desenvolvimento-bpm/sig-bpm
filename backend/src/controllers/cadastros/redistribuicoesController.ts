import type { Request, Response } from "express";
import { z } from "zod";

import { RegraRedistribuicaoError, redistribuicoesService as s } from "../../services/redistribuicoes/redistribuicoesService.js";

/** As Redistribuições de Gastos (13/11/2026): Cadastros Gerais / Controladoria / Redistribuições de Gastos. */
async function responder(response: Response, fn: () => Promise<unknown>, status = 200) {
  try {
    return response.status(status).json({ data: await fn() });
  } catch (error) {
    if (error instanceof RegraRedistribuicaoError) return response.status(error.status).json({ error: error.message });
    throw error;
  }
}

const mes = z.string().regex(/^\d{4}-\d{2}$/);
const dadosSchema = z.object({
  departamentoId: z.string().min(1).nullable(),
  linhaDREId: z.string().min(1),
  fornecedores: z.array(z.string().max(300)).max(5000),
  destinos: z.array(z.object({ centroCustoId: z.string().min(1), percentual: z.number() })).max(500),
  vigenciaInicio: mes,
  vigenciaFim: mes.nullable(),
  descricao: z.string().max(500).nullable(),
  ativo: z.boolean(),
});
const fornecedoresSchema = z.object({ linhaDREId: z.string().min(1), departamentoId: z.string().optional() });

export const redistribuicoesController = {
  listar: (_r: Request, response: Response) => responder(response, () => s.listar()),
  opcoes: (_r: Request, response: Response) => responder(response, () => s.opcoes()),
  fornecedores(r: Request, response: Response) {
    const q = fornecedoresSchema.safeParse({ ...r.query });
    if (!q.success) return response.status(400).json({ error: "Escolha a Conta da DRE." });
    return responder(response, () => s.fornecedores(q.data.departamentoId || null, q.data.linhaDREId));
  },
  criar(r: Request, response: Response) {
    const b = dadosSchema.safeParse(r.body);
    if (!b.success) return response.status(400).json({ error: "Dados inválidos", details: b.error.issues });
    return responder(response, () => s.criar(b.data, r.user!.sub), 201);
  },
  atualizar(r: Request, response: Response) {
    const b = dadosSchema.safeParse(r.body);
    if (!b.success) return response.status(400).json({ error: "Dados inválidos", details: b.error.issues });
    return responder(response, () => s.atualizar(String(r.params.id), b.data, r.user!.sub));
  },
  excluir: (r: Request, response: Response) => responder(response, () => s.excluir(String(r.params.id), r.user!.sub)),
};
