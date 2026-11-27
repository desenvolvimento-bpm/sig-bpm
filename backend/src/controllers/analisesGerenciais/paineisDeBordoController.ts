import type { Request, Response } from "express";
import { z } from "zod";

import { CHAVE_DA_TELA, paineisDeBordoService as s } from "../../services/analisesGerenciais/paineisDeBordoService.js";
import { corpoDaCopia, corpoDasComparacoes, corpoDasPaginas, enviarFoto, enviarVideo, idDaUrl, responder, tamanhoDoCorpo, usuarioDosSlides } from "./slides.js";

const usuario = (request: Request) => usuarioDosSlides(request, "paineis_de_bordo:editar");

const id = (request: Request, response: Response) => idDaUrl(request, response, "Painel inválido.");

/** A tela do painel na URL da gravação: a única, Painel de Bordo. */
function tela(request: Request, response: Response) {
  const ok = request.params.tela === CHAVE_DA_TELA;
  if (!ok) response.status(400).json({ error: "Tela inválida." });
  return ok;
}
// As páginas da tela; o Sumário lista a própria tela.
const corpoDaTela = corpoDasPaginas(z.literal(CHAVE_DA_TELA), 1);

const nome = z.string().trim().min(1).max(80);
const visualizacao = z.enum(["PRIVADO", "PUBLICO"]);
const ano = z.number().int().min(2000).max(2100);
const mes = z.number().int().min(1).max(12);

/** Os Painéis de Bordo (31/10/2026, Análises Gerenciais): montado em /paineis-de-bordo. */
export const paineisDeBordoController = {
  listar(request: Request, response: Response) {
    return responder(response, () => s.listar(usuario(request)));
  },

  /** O painel novo: a competência (o ano e o mês) ou, com `automatica` (03/11/2026), a competência automática. */
  criar(request: Request, response: Response) {
    const corpo = z
      .object({ nome, visualizacao, ano: ano.optional(), mes: mes.optional(), automatica: z.boolean().optional(), copiarDe: z.string().uuid().nullish(), manterImagensEAnotacoes: z.boolean().optional() })
      .refine((c) => (c.automatica ? c.ano === undefined && c.mes === undefined : c.ano !== undefined && c.mes !== undefined))
      .safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: "Dê um nome ao painel (até 80 caracteres) e escolha a visualização e a competência." });
    return responder(response, () => s.criar(corpo.data, usuario(request)), 201);
  },

  obter(request: Request, response: Response) {
    const r = id(request, response);
    return r ? responder(response, () => s.obter(r, usuario(request))) : undefined;
  },

  dados(request: Request, response: Response) {
    const r = id(request, response);
    return r ? responder(response, () => s.dados(r, usuario(request))) : undefined;
  },

  configuracoes(request: Request, response: Response) {
    const r = id(request, response);
    return r ? responder(response, () => s.configuracoes(r, usuario(request))) : undefined;
  },

  /**
   * As Configurações: o nome, a visualização, a competência (o ano e o mês juntos ou, com `automatica`, 03/11/2026, a
   * competência automática) e as comparações; uma ou mais.
   */
  gravarConfiguracoes(request: Request, response: Response) {
    const r = id(request, response);
    if (!r) return;
    const corpo = z
      .object({ nome: nome.optional(), visualizacao: visualizacao.optional(), ano: ano.optional(), mes: mes.optional(), automatica: z.literal(true).optional(), ...corpoDasComparacoes })
      .refine((c) => (c.ano === undefined) === (c.mes === undefined))
      .refine((c) => !(c.automatica && c.ano !== undefined))
      .refine((c) => Object.values(c).some((v) => v !== undefined))
      .safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: "Configurações inválidas: o nome (até 80 caracteres), a visualização, a competência ou as comparações." });
    return responder(response, () => s.gravarConfiguracoes(r, corpo.data, usuario(request)));
  },

  resultados(request: Request, response: Response) {
    const r = id(request, response);
    if (!r) return;
    const visao = Number(request.query.visao);
    if (![0, 1, 2, 3, 4, 5, 6, 7].includes(visao)) return response.status(400).json({ error: "Visão inválida." });
    return responder(response, () => s.resultados(r, visao as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7, usuario(request)));
  },

  gravarPaginas(request: Request, response: Response) {
    const r = id(request, response);
    if (!r || !tela(request, response)) return;
    const corpo = corpoDaTela.safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: "Páginas ou blocos inválidos." });
    return responder(response, () => s.gravarPaginas(r, corpo.data.paginas, usuario(request), { versao: corpo.data.versao, forcar: corpo.data.forcar }));
  },

  /** Finaliza ou reabre o painel (01/11/2026), na rota das abas dos relatórios, com a única tela. */
  finalizar(request: Request, response: Response) {
    const r = id(request, response);
    return r && tela(request, response) ? responder(response, () => s.mudarSituacao(r, "finalizar", usuario(request))) : undefined;
  },

  reabrir(request: Request, response: Response) {
    const r = id(request, response);
    return r && tela(request, response) ? responder(response, () => s.mudarSituacao(r, "reabrir", usuario(request))) : undefined;
  },

  /** O Compartilhar (01/11/2026): os editores convidados e, para quem criou o painel, os usuários que ele pode convidar. */
  compartilhamento(request: Request, response: Response) {
    const r = id(request, response);
    return r ? responder(response, () => s.compartilhamento(r, usuario(request))) : undefined;
  },

  compartilhar(request: Request, response: Response) {
    const r = id(request, response);
    if (!r) return;
    const corpo = z.object({ usuarios: z.array(z.string().uuid()).min(1).max(200) }).safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: "Escolha os usuários que vão editar o painel." });
    return responder(response, () => s.compartilhar(r, corpo.data.usuarios, usuario(request)));
  },

  removerEditor(request: Request, response: Response) {
    const r = id(request, response);
    if (!r) return;
    const editor = z.string().uuid().safeParse(request.params.usuario);
    if (!editor.success) return response.status(400).json({ error: "Usuário inválido." });
    return responder(response, () => s.removerEditor(r, editor.data, usuario(request)));
  },

  copiarArquivos(request: Request, response: Response) {
    const r = id(request, response);
    if (!r) return;
    const corpo = corpoDaCopia.safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: "Informe o documento de origem e os arquivos." });
    return responder(response, () => s.copiarArquivos(r, { processo: corpo.data.processo ?? "relatorios-executivos", id: corpo.data.de }, corpo.data.arquivos, usuario(request)));
  },

  /** Uma foto nova: o arquivo vai cru no corpo, com o tipo no Content-Type. */
  salvarFoto(request: Request, response: Response) {
    const r = id(request, response);
    if (!r) return;
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) return response.status(400).json({ error: "O arquivo da foto está vazio." });
    return responder(response, () => s.salvarFoto(r, request.body as Buffer, String(request.headers["content-type"] ?? ""), usuario(request)), 201);
  },

  lerFoto(request: Request, response: Response) {
    const r = id(request, response);
    return r ? enviarFoto(response, () => s.lerFoto(r, String(request.params.arquivo), usuario(request))) : undefined;
  },

  /** Um vídeo novo: o arquivo vai cru no corpo, com o tipo no Content-Type, e é gravado enquanto chega. */
  salvarVideo(request: Request, response: Response) {
    const r = id(request, response);
    if (!r) return;
    return responder(response, () => s.salvarVideo(r, request, String(request.headers["content-type"] ?? ""), tamanhoDoCorpo(request), usuario(request)), 201);
  },

  lerVideo(request: Request, response: Response) {
    const r = id(request, response);
    return r ? enviarVideo(request, response, () => s.lerVideo(r, String(request.params.arquivo), usuario(request))) : undefined;
  },

  excluir(request: Request, response: Response) {
    const r = id(request, response);
    return r ? responder(response, () => s.excluir(r, usuario(request))) : undefined;
  },
};
