import type { Request, Response } from "express";
import { z } from "zod";

import { RegraCadastroError } from "../../services/cadastros/edicao/definicoesCadastros.js";
import { edicaoCadastrosService as s } from "../../services/cadastros/edicao/edicaoCadastrosService.js";
import { testarFormula, valoresDosItens } from "../../services/cadastros/edicao/testeDaFormula.js";

const valoresSchema = z.record(z.string(), z.unknown());

async function responder(response: Response, fn: () => Promise<unknown>, status = 200) {
  try {
    return response.status(status).json({ data: await fn() });
  } catch (error) {
    if (error instanceof RegraCadastroError) return response.status(error.status).json({ error: error.message, ...(error.sugestoes ? { sugestoes: error.sugestoes } : {}) });
    throw error;
  }
}
const entidade = (r: Request) => String(r.params.entidade);
const id = (r: Request) => String(r.params.id);

export const edicaoCadastrosController = {
  definicao: (r: Request, response: Response) => responder(response, () => s.definicao(entidade(r))),
  listar: (r: Request, response: Response) => responder(response, () => s.listar(entidade(r), typeof r.query.busca === "string" ? r.query.busca.trim().slice(0, 120) : undefined)),
  ler: (r: Request, response: Response) => responder(response, () => s.ler(entidade(r), id(r))),

  async criar(r: Request, response: Response) {
    const b = valoresSchema.safeParse(r.body);
    if (!b.success) return response.status(400).json({ error: "Dados inválidos" });
    return responder(response, () => s.criar(entidade(r), b.data, r.user!.sub), 201);
  },
  async atualizar(r: Request, response: Response) {
    const b = valoresSchema.safeParse(r.body);
    if (!b.success) return response.status(400).json({ error: "Dados inválidos" });
    return responder(response, () => s.atualizar(entidade(r), id(r), b.data, r.user!.sub));
  },
  excluir: (r: Request, response: Response) => responder(response, () => s.excluir(entidade(r), id(r), r.user!.sub)),

  // Os valores da Metodologia e o Testar (11/11/2026): nos cards do Painel de Bordo e nos indicadores.
  valoresDosItens: (r: Request, response: Response) => responder(response, () => valoresDosItens(entidade(r))),
  async testar(r: Request, response: Response) {
    const b = valoresSchema.safeParse(r.body);
    if (!b.success) return response.status(400).json({ error: "Dados inválidos" });
    const idDoRegistro = typeof r.query.id === "string" && r.query.id ? r.query.id : null;
    return responder(response, () => testarFormula(entidade(r), b.data, idDoRegistro));
  },
};
