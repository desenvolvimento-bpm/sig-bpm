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
  // O nome (25/11/2026): a gravação recusa o vazio com a mensagem dela.
  nome: z.string().max(300),
  departamentoId: z.string().min(1).nullable(),
  linhasDREIds: z.array(z.string().min(1)).min(1).max(200),
  fornecedores: z.array(z.string().max(300)).max(5000),
  // A Conta da DRE de cada centro (23/11/2026): vazia, a gravação pede a conta.
  destinos: z.array(z.object({ centroCustoId: z.string().min(1), linhaDREId: z.string().max(100), percentual: z.number() })).max(500),
  vigenciaInicio: mes,
  vigenciaFim: mes.nullable(),
  descricao: z.string().max(500).nullable(),
  ativo: z.boolean(),
});
/** As contas da DRE (uma ou mais) vêm separadas por vírgula. */
const fornecedoresSchema = z.object({ linhasDREIds: z.string().min(1).max(10000), departamentoId: z.string().optional() });
export const idsDaConsulta = (texto: string) => texto.split(",").map((x) => x.trim()).filter(Boolean);

export const redistribuicoesController = {
  listar: (_r: Request, response: Response) => responder(response, () => s.listar()),
  opcoes: (_r: Request, response: Response) => responder(response, () => s.opcoes()),
  fornecedores(r: Request, response: Response) {
    const q = fornecedoresSchema.safeParse({ ...r.query });
    if (!q.success) return response.status(400).json({ error: "Escolha ao menos uma Conta da DRE." });
    return responder(response, () => s.fornecedores(q.data.departamentoId || null, idsDaConsulta(q.data.linhasDREIds)));
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
