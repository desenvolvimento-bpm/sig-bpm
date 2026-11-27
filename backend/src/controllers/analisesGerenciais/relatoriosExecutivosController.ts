import type { Request, Response } from "express";
import { z } from "zod";

import { CHAVES_DAS_ABAS, relatoriosExecutivosService as s } from "../../services/analisesGerenciais/relatoriosExecutivosService.js";
import { corpoDaCopia, corpoDasComparacoes, corpoDasPaginas, enviarFoto, enviarVideo, idDaUrl, responder, tamanhoDoCorpo, usuarioDosSlides } from "./slides.js";

/** O usuário da requisição: se edita a tela e os departamentos do recorte (sem recorte, nulo: todos). */
const usuario = (request: Request) => usuarioDosSlides(request, "relatorios_executivos:editar");

const id = (request: Request, response: Response) => idDaUrl(request, response, "Relatório inválido.");

const departamento = z.enum(CHAVES_DAS_ABAS as [(typeof CHAVES_DAS_ABAS)[number], ...(typeof CHAVES_DAS_ABAS)[number][]]);
function aba(request: Request, response: Response) {
  const r = departamento.safeParse(request.params.departamento);
  if (!r.success) response.status(400).json({ error: "Aba inválida." });
  return r.success ? r.data : null;
}
// As páginas de um grupo; as telas do Sumário são da Introdução às performances (sem a Capa e o Encerramento).
const corpoDaAba = corpoDasPaginas(departamento.exclude(["CAPA", "ENCERRAMENTO"]), CHAVES_DAS_ABAS.length);

/** Os Relatórios Executivos (15/10/2026, Análises Gerenciais): montado em /relatorios-executivos. */
export const relatoriosExecutivosController = {
  listar(request: Request, response: Response) {
    return responder(response, () => s.listar(usuario(request)));
  },

  criar(request: Request, response: Response) {
    const corpo = z.object({ ano: z.number().int().min(2000).max(2100), mes: z.number().int().min(1).max(12), importarDe: z.string().uuid().nullish(), manterImagensEAnotacoes: z.boolean().optional() }).safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: "Escolha a competência do relatório." });
    return responder(response, () => s.criar(corpo.data, usuario(request)), 201);
  },

  obter(request: Request, response: Response) {
    const r = id(request, response);
    return r ? responder(response, () => s.obter(r, usuario(request))) : undefined;
  },

  dados(request: Request, response: Response) {
    const r = id(request, response);
    return r ? responder(response, () => s.dados(r)) : undefined;
  },

  configuracoes(request: Request, response: Response) {
    const r = id(request, response);
    return r ? responder(response, () => s.configuracoes(r, usuario(request))) : undefined;
  },

  gravarConfiguracoes(request: Request, response: Response) {
    const r = id(request, response);
    if (!r) return;
    // A Comparação Padrão e, desde 31/10/2026, a Comparação PROVA (dois ou mais cenários); uma das duas, ou as duas.
    const corpo = z
      .object(corpoDasComparacoes)
      .refine((c) => c.cenarioComparadoId !== undefined || c.comparacaoProva !== undefined)
      .safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: "Escolha o cenário da Comparação Padrão ou dois ou mais cenários da Comparação PROVA." });
    return responder(response, () => s.gravarConfiguracoes(r, corpo.data, usuario(request)));
  },

  resultados(request: Request, response: Response) {
    const r = id(request, response);
    if (!r) return;
    const visao = Number(request.query.visao);
    if (![0, 1, 2, 3, 4, 5, 6, 7].includes(visao)) return response.status(400).json({ error: "Visão inválida." });
    return responder(response, () => s.resultados(r, visao as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7));
  },

  gravarAba(request: Request, response: Response) {
    const r = id(request, response);
    const d = r ? aba(request, response) : null;
    if (!r || !d) return;
    const corpo = corpoDaAba.safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: "Páginas ou blocos inválidos." });
    return responder(response, () => s.gravarAba(r, d, corpo.data.paginas, usuario(request), { versao: corpo.data.versao, forcar: corpo.data.forcar }));
  },

  finalizarAba(request: Request, response: Response) {
    const r = id(request, response);
    const d = r ? aba(request, response) : null;
    return r && d ? responder(response, () => s.mudarAba(r, d, "finalizar", usuario(request))) : undefined;
  },

  reabrirAba(request: Request, response: Response) {
    const r = id(request, response);
    const d = r ? aba(request, response) : null;
    return r && d ? responder(response, () => s.mudarAba(r, d, "reabrir", usuario(request))) : undefined;
  },

  /** A cópia das fotos e dos vídeos de outro relatório (24/10/2026) ou, desde 31/10/2026, de um painel de bordo. */
  copiarArquivos(request: Request, response: Response) {
    const r = id(request, response);
    if (!r) return;
    const corpo = corpoDaCopia.safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: "Informe o relatório de origem e os arquivos." });
    return responder(response, () => s.copiarArquivos(r, { processo: corpo.data.processo ?? "relatorios-executivos", id: corpo.data.de }, corpo.data.arquivos, usuario(request)));
  },

  /** Uma foto nova (16/10/2026): o arquivo vai cru no corpo, com o tipo no Content-Type. */
  salvarFoto(request: Request, response: Response) {
    const r = id(request, response);
    if (!r) return;
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) return response.status(400).json({ error: "O arquivo da foto está vazio." });
    return responder(response, () => s.salvarFoto(r, request.body as Buffer, String(request.headers["content-type"] ?? ""), usuario(request)), 201);
  },

  lerFoto(request: Request, response: Response) {
    const r = id(request, response);
    return r ? enviarFoto(response, () => s.lerFoto(r, String(request.params.arquivo))) : undefined;
  },

  /** Um vídeo novo (20/10/2026): o arquivo vai cru no corpo, com o tipo no Content-Type, e é gravado enquanto chega. */
  salvarVideo(request: Request, response: Response) {
    const r = id(request, response);
    if (!r) return;
    return responder(response, () => s.salvarVideo(r, request, String(request.headers["content-type"] ?? ""), tamanhoDoCorpo(request), usuario(request)), 201);
  },

  /** Um vídeo (20/10/2026), em partes (o cabeçalho Range). */
  lerVideo(request: Request, response: Response) {
    const r = id(request, response);
    return r ? enviarVideo(request, response, () => s.lerVideo(r, String(request.params.arquivo))) : undefined;
  },

  excluir(request: Request, response: Response) {
    const r = id(request, response);
    return r ? responder(response, () => s.excluir(r, usuario(request))) : undefined;
  },
};
