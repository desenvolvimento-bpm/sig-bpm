import { createReadStream } from "node:fs";
import type { Request, Response } from "express";

import { arquivosGeraisService as s, RegraArquivosError, type TelaDosArquivos } from "../../services/arquivosGerais/arquivosGeraisService.js";

/** Os Arquivos Gerais (05/11/2026): as telas Treinamentos e Informativos. A rota já conferiu a tela e a permissão. */

const usuario = (request: Request) => ({ id: request.user!.sub, nome: request.user!.nome, permissoes: request.user!.permissions ?? [] });
const tela = (request: Request) => String(request.params.tela) as TelaDosArquivos;

async function responder(response: Response, fn: () => Promise<unknown>, status = 200) {
  try {
    return response.status(status).json({ data: await fn() });
  } catch (error) {
    if (error instanceof RegraArquivosError) return response.status(error.status).json({ error: error.message });
    throw error;
  }
}

/** Um parâmetro do endereço como texto (o nome e a descrição do arquivo novo vêm na query, codificados). */
const texto = (v: unknown) => (typeof v === "string" ? v : "");
/** O Content-Disposition com o nome do arquivo (o ASCII para os navegadores antigos e o UTF-8 para os demais). */
function disposicao(tipo: "inline" | "attachment", nome: string) {
  const ascii = nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${tipo}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`;
}

export const arquivosGeraisController = {
  /** Edita a descrição e o processo (11/11/2026): { descricao, processo } no corpo (o processo vazio é Geral). */
  editar(request: Request, response: Response) {
    const corpo = (request.body ?? {}) as { descricao?: unknown; processo?: unknown };
    return responder(response, () =>
      s.editar(tela(request), String(request.params.id), { descricao: texto(corpo.descricao), processo: texto(corpo.processo) || null }, usuario(request)),
    );
  },

  listar(request: Request, response: Response) {
    return responder(response, () => s.listar(tela(request), usuario(request).permissoes));
  },

  /** Um arquivo novo: o conteúdo cru no corpo (gravado enquanto chega), o tipo no Content-Type e ?nome= e ?descricao=. */
  adicionar(request: Request, response: Response) {
    const tamanho = Number(request.headers["content-length"]);
    return responder(
      response,
      () =>
        s.adicionar(
          tela(request),
          request,
          {
            nome: texto(request.query.nome),
            descricao: texto(request.query.descricao),
            tipo: String(request.headers["content-type"] ?? ""),
            tamanho: Number.isFinite(tamanho) ? tamanho : null,
            // O processo (11/11/2026): o código; vazio, Geral.
            processo: texto(request.query.processo) || null,
          },
          usuario(request),
        ),
      201,
    );
  },

  /**
   * O conteúdo: ?modo=ver abre no navegador (inline, só nos tipos que ele mostra; os demais vão como download) e ?modo=baixar
   * baixa. Em partes (o cabeçalho Range), para o vídeo avançar e recuar sem baixar o arquivo inteiro.
   */
  async conteudo(request: Request, response: Response) {
    let a: Awaited<ReturnType<typeof s.ler>>;
    try {
      a = await s.ler(tela(request), String(request.params.id), usuario(request).permissoes);
    } catch (error) {
      if (error instanceof RegraArquivosError) return response.status(error.status).json({ error: error.message });
      throw error;
    }
    const ver = request.query.modo === "ver" && a.visualizavel;
    response.setHeader("Content-Type", ver ? a.tipo : "application/octet-stream");
    response.setHeader("Content-Disposition", disposicao(ver ? "inline" : "attachment", a.nome));
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "private, no-cache");
    response.setHeader("Accept-Ranges", "bytes");
    const intervalo = /^bytes=(\d*)-(\d*)$/.exec(String(request.headers.range ?? ""));
    if (!intervalo || (!intervalo[1] && !intervalo[2])) {
      response.setHeader("Content-Length", String(a.tamanho));
      return createReadStream(a.caminho).pipe(response);
    }
    // "bytes=início-fim", "bytes=início-" ou "bytes=-últimos".
    const inicio = intervalo[1] ? Number(intervalo[1]) : Math.max(0, a.tamanho - Number(intervalo[2]));
    const fim = intervalo[1] && intervalo[2] ? Math.min(Number(intervalo[2]), a.tamanho - 1) : a.tamanho - 1;
    if (inicio >= a.tamanho || inicio > fim) {
      response.setHeader("Content-Range", `bytes */${a.tamanho}`);
      return response.status(416).end();
    }
    response.status(206);
    response.setHeader("Content-Range", `bytes ${inicio}-${fim}/${a.tamanho}`);
    response.setHeader("Content-Length", String(fim - inicio + 1));
    return createReadStream(a.caminho, { start: inicio, end: fim }).pipe(response);
  },

  excluir(request: Request, response: Response) {
    return responder(response, () => s.excluir(tela(request), String(request.params.id), usuario(request)));
  },
};
