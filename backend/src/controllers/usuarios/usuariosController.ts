import type { Request, Response } from "express";
import { z } from "zod";

import { DepartamentoAcesso, RecursoSistema, AcaoPermissao, TipoImportacao } from "../../generated/prisma/enums.js";
import { CODIGO_ADMINISTRADOR } from "../../services/acesso/acesso.js";
import { presencaService } from "../../services/usuarios/presencaService.js";
import { RegraUsuarioError, usuariosService } from "../../services/usuarios/usuariosService.js";
import { novaSenhaSchema } from "../authController.js";

// Os ids como texto, sem exigir o formato de UUID: o do perfil Administrador, gravado por uma migração (14/10/2026), não
// o tem, e o z.string().uuid() recusava criar ou editar um usuário Administrador. O serviço confere se o perfil e os
// centros existem.
const idSchema = z.string().min(1).max(64);
const usuarioSchema = z.object({
  nome: z.string().trim().min(2).max(120),
  email: z.string().trim().email("E-mail inválido").max(200),
  perfilId: idSchema,
  ativo: z.boolean().default(true),
  setores: z.array(z.enum(Object.values(TipoImportacao) as [string, ...string[]])).default([]),
  departamentos: z.array(z.enum(Object.values(DepartamentoAcesso) as [string, ...string[]])).default([]),
  gestao: z.enum(Object.values(DepartamentoAcesso) as [string, ...string[]]).nullable().default(null),
  centros: z.array(idSchema).default([]),
});
const perfilSchema = z.object({
  nome: z.string().trim().min(2).max(80),
  descricao: z.string().trim().max(300).nullable().default(null),
  ativo: z.boolean().default(true),
  recorteSetor: z.boolean().default(false),
  recorteDepartamento: z.boolean().default(false),
  recorteCentro: z.boolean().default(false),
  // O Acesso a Informações Sensíveis (27/10/2026): sem ele, as movimentações da Mão de Obra Direta e Indireta ficam ocultas.
  informacoesSensiveis: z.boolean().default(false),
  // A matriz por tela e por aba (14/10/2026): a chave é a tela ou "tela.aba" do catálogo.
  permissoes: z
    .array(
      z.object({
        chave: z.string().min(1).max(120),
        acao: z.enum(Object.values(AcaoPermissao) as [string, ...string[]]),
      }),
    )
    .max(1000)
    .default([]),
});

async function responder(response: Response, fn: () => Promise<unknown>, status = 200) {
  try {
    const data = await fn();
    return data === undefined ? response.status(204).end() : response.status(status).json({ data });
  } catch (error) {
    if (error instanceof RegraUsuarioError) return response.status(error.status).json({ error: error.message });
    throw error;
  }
}
const invalido = (response: Response, e: z.ZodError) => response.status(400).json({ error: e.issues[0]?.message ?? "Dados inválidos" });

export const usuariosController = {
  opcoes: (_request: Request, response: Response) => responder(response, () => usuariosService.opcoes()),
  listar: (_request: Request, response: Response) => responder(response, () => usuariosService.listar()),

  async criar(request: Request, response: Response) {
    const b = usuarioSchema.extend({ senha: novaSenhaSchema }).safeParse(request.body);
    if (!b.success) return invalido(response, b.error);
    return responder(response, () => usuariosService.criar(b.data as never, request.user!.sub), 201);
  },

  async atualizar(request: Request, response: Response) {
    const b = usuarioSchema.safeParse(request.body);
    if (!b.success) return invalido(response, b.error);
    return responder(response, () => usuariosService.atualizar(String(request.params.id), b.data as never, request.user!.sub));
  },

  async redefinirSenha(request: Request, response: Response) {
    const b = z.object({ senha: novaSenhaSchema }).safeParse(request.body);
    if (!b.success) return invalido(response, b.error);
    return responder(response, () => usuariosService.redefinirSenha(String(request.params.id), b.data.senha, request.user!.sub));
  },

  listarPerfis: (_request: Request, response: Response) => responder(response, () => usuariosService.listarPerfis()),

  async criarPerfil(request: Request, response: Response) {
    const b = perfilSchema.extend({ codigo: z.string().trim().min(2).max(40) }).safeParse(request.body);
    if (!b.success) return invalido(response, b.error);
    return responder(response, () => usuariosService.criarPerfil(b.data as never, request.user!.sub), 201);
  },

  async atualizarPerfil(request: Request, response: Response) {
    const b = perfilSchema.safeParse(request.body);
    if (!b.success) return invalido(response, b.error);
    return responder(response, () => usuariosService.atualizarPerfil(String(request.params.id), b.data as never, request.user!.sub));
  },

  /** Inativa ou reativa o perfil (27/10/2026, a ação da lista). */
  async mudarSituacaoPerfil(request: Request, response: Response) {
    const b = z.object({ ativo: z.boolean() }).safeParse(request.body);
    if (!b.success) return invalido(response, b.error);
    return responder(response, () => usuariosService.mudarSituacaoPerfil(String(request.params.id), b.data.ativo, request.user!.sub));
  },

  excluirPerfil: (request: Request, response: Response) => responder(response, () => usuariosService.excluirPerfil(String(request.params.id), request.user!.sub)),

  /** O aviso de quem está com o SIG aberto; ao Administrador, devolve quem está online (24/10/2026). */
  presenca(request: Request, response: Response) {
    const u = request.user!;
    presencaService.marcar(u.sub, u.nome);
    if (u.perfil.codigo !== CODIGO_ADMINISTRADOR) return response.json({ data: null });
    const usuarios = presencaService.online();
    return response.json({ data: { total: usuarios.length, usuarios } });
  },

  sairDaPresenca(request: Request, response: Response) {
    presencaService.sair(request.user!.sub);
    return response.status(204).end();
  },
};
