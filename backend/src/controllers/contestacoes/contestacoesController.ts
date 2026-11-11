import type { Request, Response } from "express";
import { z } from "zod";

import { getPrismaClient } from "../../config/prisma.js";
import { temPermissao } from "../../middlewares/verificarPermissao.js";
import { anoMesSchema } from "../../schemas/importacoes/importacaoSchemas.js";
import { departamentoDaLinha, gestaoDoCentro } from "../../services/acesso/recorteDepartamento.js";
import { centroForaDaContestacao, contestacoesService, RegraContestacaoError, type UsuarioDaContestacao } from "../../services/contestacoes/contestacoesService.js";

/** As contestações de gastos (27/10/2026): o pedido, as abas, a resposta, a validação e a importação para os lançamentos. */

const idSchema = z.string().min(1).max(64);
const criarSchema = z.object({
  lancamentoId: idSchema,
  centroNovoId: idSchema.nullable().default(null),
  contaNovaId: idSchema.nullable().default(null),
  motivo: z.string().trim().max(500).nullable().default(null),
  // Contestar Anteriores e Posteriores (30/10/2026): o mesmo fornecedor, conta e centro nas outras competências.
  anteriores: z.boolean().default(false),
  posteriores: z.boolean().default(false),
  // Contestar Selecionados (10/11/2026): só os itens escolhidos do movimento (a lista e o id de cada um).
  itens: z.array(z.object({ origem: z.enum(["REQUISICAO", "NOTA_FISCAL"]), id: idSchema })).max(2000).default([]),
});
const previaSchema = z.object({
  lancamentoId: idSchema,
  centroNovoId: idSchema.nullable().catch(null).default(null),
  contaNovaId: idSchema.nullable().catch(null).default(null),
});
const editarSchema = z.object({ centroNovoId: idSchema.nullable().default(null), contaNovaId: idSchema.nullable().default(null) });
const responderSchema = z.object({ acatar: z.boolean(), justificativa: z.string().trim().max(500).nullable().default(null) });
const situacaoSchema = z.object({
  situacao: z.enum(["PENDENTE", "ACATADA", "RECUSADA", "VALIDADA"]),
  justificativa: z.string().trim().min(1, "Escreva a justificativa").max(500),
});
const importarSchema = z.object({ ids: z.array(idSchema).min(1, "Marque ao menos uma contestação").max(2000) });
const abaSchema = z.enum(["solicitadas", "recebidas", "validacoes"]);

const usuario = (request: Request): UsuarioDaContestacao => ({ id: request.user!.sub, nome: request.user!.nome, acesso: request.user!.acesso });

async function responder(response: Response, fn: () => Promise<unknown>, status = 200) {
  try {
    return response.status(status).json({ data: await fn() });
  } catch (error) {
    if (error instanceof RegraContestacaoError) return response.status(error.status).json({ error: error.message });
    throw error;
  }
}

function invalido(response: Response, e: z.ZodError) {
  return response.status(400).json({ error: e.issues[0]?.message ?? "Dados inválidos", details: e.issues });
}

function competencia(request: Request, response: Response) {
  const c = anoMesSchema.safeParse(request.params.anoMes);
  if (!c.success) {
    response.status(400).json({ error: "Competência inválida" });
    return null;
  }
  return c.data;
}

/** A permissão de Ler de cada aba das contestações. */
const LER_DA_ABA = { solicitadas: "contestacoes.solicitadas:ler", recebidas: "contestacoes.recebidas:ler", validacoes: "contestacoes_validacoes:ler" } as const;

export const contestacoesController = {
  /** Os itens de um movimento da contestação (10/11/2026): ?aba= (a aba em que o usuário a vê). */
  async itensDoMovimento(request: Request, response: Response) {
    const aba = abaSchema.safeParse(request.query.aba);
    const id = idSchema.safeParse(request.params.id);
    const movimentoId = idSchema.safeParse(request.params.movimentoId);
    if (!aba.success || !id.success || !movimentoId.success) return response.status(400).json({ error: "Dados inválidos." });
    if (!temPermissao(request, LER_DA_ABA[aba.data])) return response.status(403).json({ error: "Sem acesso a esta aba das contestações." });
    return responder(response, () => contestacoesService.itensDoMovimento(id.data, movimentoId.data, aba.data, usuario(request)));
  },

  async criar(request: Request, response: Response) {
    const b = criarSchema.safeParse(request.body);
    if (!b.success) return invalido(response, b.error);
    return responder(response, () => contestacoesService.criar(b.data, usuario(request)), 201);
  },

  /** A aba (Solicitadas ou Recebidas) ou a tela Validações; a rota confere a permissão de cada uma. */
  listar: (aba: z.infer<typeof abaSchema>) => (request: Request, response: Response) => responder(response, () => contestacoesService.listar(aba, usuario(request))),

  /**
   * As listas do modal Contestar: os centros de custo ativos de um departamento da DRE (30/10/2026: sem os de Almoxarifado,
   * Investimento e Requisição; 04/11/2026: só os de código com três níveis, `centroForaDaContestacao`) e as contas analíticas
   * ativas com destino na DRE, cada um com o departamento do recorte (a lista das contas mostra as do departamento do centro e
   * as do Extra-Operacional) e, para a consulta Contas do modal
   * (04/11/2026), o grupo e a descrição da linha da DRE.
   */
  async opcoes(_request: Request, response: Response) {
    const prisma = getPrismaClient();
    const [centros, contas] = await Promise.all([
      // O balde e a atribuição (04/11/2026): a lista da lupa do Novo Centro de Custo.
      prisma.centroCusto.findMany({ where: { ativo: true }, orderBy: [{ codigoRM: "asc" }], select: { id: true, codigoRM: true, nomeRM: true, departamento: true, atribuicao: true, balde: true } }),
      prisma.contaResultado.findMany({
        where: { ativo: true, tipoConta: "ANALITICA", linhaDREId: { not: null } },
        orderBy: { reduzido: "asc" },
        select: { id: true, reduzido: true, descricao: true, departamento: true, atribuicao: true, balde: true, linhaDRE: { select: { grupo: true, grupoSigla: true, descricao: true } } },
      }),
    ]);
    return response.json({
      data: {
        centros: centros.flatMap((c) => {
          const departamentoDoRecorte = gestaoDoCentro(c.departamento);
          return departamentoDoRecorte && !centroForaDaContestacao(c.codigoRM) ? [{ ...c, departamentoDoRecorte }] : [];
        }),
        contas: contas.map(({ linhaDRE, ...c }) => ({
          ...c,
          departamentoDoRecorte: linhaDRE ? departamentoDaLinha(linhaDRE) : null,
          linha: linhaDRE ? { grupo: linhaDRE.grupo, descricao: linhaDRE.descricao } : null,
        })),
      },
    });
  },

  /** O que o modal Contestar mostra do movimento: o departamento do centro dele e as anteriores e as posteriores. */
  async previa(request: Request, response: Response) {
    const q = previaSchema.safeParse(request.query);
    if (!q.success) return invalido(response, q.error);
    return responder(response, () => contestacoesService.previa(q.data, usuario(request)));
  },

  async responder(request: Request, response: Response) {
    const b = responderSchema.safeParse(request.body);
    if (!b.success) return invalido(response, b.error);
    return responder(response, () => contestacoesService.responder(String(request.params.id), b.data, usuario(request)));
  },

  /** O Editar das Validações (10/11/2026): o centro e/ou a conta novos da contestação. */
  async editar(request: Request, response: Response) {
    const b = editarSchema.safeParse(request.body);
    if (!b.success) return invalido(response, b.error);
    return responder(response, () => contestacoesService.editar(String(request.params.id), b.data, usuario(request)));
  },

  async alterarSituacao(request: Request, response: Response) {
    const b = situacaoSchema.safeParse(request.body);
    if (!b.success) return invalido(response, b.error);
    return responder(response, () => contestacoesService.alterarSituacao(String(request.params.id), b.data, usuario(request)));
  },

  processar: (request: Request, response: Response) => responder(response, () => contestacoesService.processar(usuario(request))),

  async paraLancamentos(request: Request, response: Response) {
    const c = competencia(request, response);
    if (!c) return;
    return responder(response, () => contestacoesService.paraLancamentos(c.ano, c.mes, usuario(request)));
  },

  async importar(request: Request, response: Response) {
    const c = competencia(request, response);
    if (!c) return;
    const b = importarSchema.safeParse(request.body);
    if (!b.success) return invalido(response, b.error);
    return responder(response, () => contestacoesService.importar(c.ano, c.mes, b.data.ids, usuario(request)));
  },

  desfazerImportacao: (request: Request, response: Response) => responder(response, () => contestacoesService.desfazerImportacao(String(request.params.id), usuario(request))),
};
