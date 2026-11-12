import { createReadStream } from "node:fs";

import type { Request, Response } from "express";
import { z } from "zod";

import { temPermissao } from "../../middlewares/verificarPermissao.js";
import { CODIGO_ADMINISTRADOR } from "../../services/acesso/acesso.js";
import { FONTES_DO_TEXTO, MARCACOES_DO_PROVA, NOME_DA_FOTO, NOME_DO_VIDEO, PROCESSOS_DOS_SLIDES, SITES_DE_VIDEO, SlidesError, type UsuarioDosSlides } from "../../services/analisesGerenciais/slides.js";

/**
 * O que os controllers dos Relatórios Executivos e dos Painéis de Bordo têm em comum (31/10/2026): o usuário, as respostas,
 * a validação das páginas e dos blocos, as comparações das Configurações, a cópia dos arquivos e o envio das fotos e dos
 * vídeos.
 */

/** O usuário da requisição: se edita a tela (a permissão de editar do processo), os departamentos do recorte e os processos que lê. */
export const usuarioDosSlides = (request: Request, editar: string): UsuarioDosSlides => ({
  id: request.user!.sub,
  nome: request.user!.nome,
  admin: request.user!.perfil.codigo === CODIGO_ADMINISTRADOR,
  edita: temPermissao(request, editar),
  departamentos: request.user!.acesso.recorteDepartamento ? request.user!.acesso.departamentos : null,
  le: { "relatorios-executivos": temPermissao(request, "relatorios_executivos:ler"), "paineis-de-bordo": temPermissao(request, "paineis_de_bordo:ler") },
});

const respostaDoErro = (response: Response, error: SlidesError) => response.status(error.status).json({ error: error.message, ...(error.codigo ? { codigo: error.codigo, detalhes: error.detalhes } : {}) });

export async function responder(response: Response, fn: () => Promise<unknown>, status = 200) {
  try {
    return response.status(status).json({ data: await fn() });
  } catch (error) {
    if (error instanceof SlidesError) return respostaDoErro(response, error);
    throw error;
  }
}

/** O id do documento na URL (um uuid); inválido, responde 400 com a mensagem e devolve null. */
export function idDaUrl(request: Request, response: Response, mensagem: string) {
  const r = z.string().uuid().safeParse(request.params.id);
  if (!r.success) response.status(400).json({ error: mensagem });
  return r.success ? r.data : null;
}

/**
 * Os ajustes de uma imagem (21/10/2026): brilho e saturação de 0 a 200%, matiz de −180° a 180°, desfoque até 20 px e
 * transparência até 100%; a borda (espessura até 20 px e a cor) e o sombreamento centralizado (intensidade até 100% e
 * desfoque até 60 px), desde 22/10/2026.
 */
const ajustesDeImagem = z.object({
  brilho: z.number().min(0).max(200).optional(),
  matiz: z.number().min(-180).max(180).optional(),
  saturacao: z.number().min(0).max(200).optional(),
  desfoque: z.number().min(0).max(20).optional(),
  transparencia: z.number().min(0).max(100).optional(),
  bordaEspessura: z.number().min(0).max(20).optional(),
  bordaCor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  sombraIntensidade: z.number().min(0).max(100).optional(),
  sombraDesfoque: z.number().min(0).max(60).optional(),
});

const zoomDoCard = z.union([z.literal(1.25), z.literal(1.5), z.literal(2), z.literal(2.5), z.literal(3)]).optional();
export const marcacaoDoProva = z.enum(MARCACOES_DO_PROVA as [(typeof MARCACOES_DO_PROVA)[number], ...(typeof MARCACOES_DO_PROVA)[number][]]);
/**
 * O objeto PROVA (31/10/2026): `true` (os cenários são os da Comparação PROVA do relatório); a lista de marcações, de antes
 * da Comparação PROVA, ainda se aceita e vale o mesmo; sem ele, o objeto padrão.
 */
const prova = z.union([z.literal(true), z.array(marcacaoDoProva).min(1).max(4)]).optional();
const posicao = { id: z.string().min(1).max(60), x: z.number().int().min(0).max(24), y: z.number().int().min(0).max(2000), w: z.number().int().min(1).max(24), h: z.number().int().min(1).max(200) };
// A fonte, o espaçamento entre as linhas e a formatação de um nível do Sumário (20/10/2026).
const fonteDoTexto = z.enum(FONTES_DO_TEXTO);
const espacamento = z.number().min(0.5).max(2).optional();
const estiloDoSumario = z.object({ negrito: z.boolean().optional(), italico: z.boolean().optional(), sublinhado: z.boolean().optional(), tamanho: z.number().int().min(8).max(144).optional(), cor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), fonte: fonteDoTexto.optional() });
/** O corte de uma imagem (27/10/2026): o zoom (1 a 4) e a posição (0 a 1), como na Imagem de Fundo. */
const recorte = z.object({ zoom: z.number().min(1).max(4), x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
/** A Imagem de Fundo da página (20/10/2026): a foto, a proporção, o zoom (1 a 4) e a posição (0 a 1). */
const fundo = z.object({ arquivo: z.string().regex(NOME_DA_FOTO), proporcao: z.number().positive().max(50), zoom: z.number().min(1).max(4), x: z.number().min(0).max(1), y: z.number().min(0).max(1), ajustes: ajustesDeImagem.optional() });

/**
 * O corpo da gravação das páginas de um grupo (16/10/2026: cada página com os blocos dela), com as telas que o Sumário
 * lista (as abas do relatório, da Introdução às performances; a do painel). `versao` e `forcar` (23/10/2026): a conferência
 * de que ninguém gravou o grupo depois que o usuário o abriu.
 */
/** Os dados dos cards antes do gráfico (12/11/2026): só o Atual ou só o Acumulado; sem o campo, os dois. */
const periodosDoCard = z.enum(["ATUAL", "ACUMULADO"]).optional();

export function corpoDasPaginas(telasDoSumario: z.ZodType<string>, maximoDeTelas: number) {
  const bloco = z.discriminatedUnion("tipo", [
    // O Zoom do card (30/10/2026): 125% a 300% (sem ele, 100%).
    z.object({ ...posicao, tipo: z.literal("PAINEL"), aba: z.enum(["resultados", "performance"]), quadro: z.string().max(200), titulo: z.string().max(200), sigla: z.string().max(60), comGrafico: z.boolean(), soAcumulado: z.boolean().optional(), periodos: periodosDoCard, tipoGrafico: z.enum(["barras", "area"]).optional(), comRotulos: z.boolean().optional(), cores: z.enum(["padrao", "daltonismo"]).optional(), zoom: zoomDoCard, prova }),
    z.object({ ...posicao, tipo: z.literal("INDICADOR"), nome: z.string().min(1).max(200), grafico: z.enum(["MESES", "ACUMULADO"]).optional(), periodos: periodosDoCard, tipoGrafico: z.enum(["barras", "area"]).optional(), comRotulos: z.boolean().optional(), zoom: zoomDoCard, prova }),
    z.object({ ...posicao, tipo: z.literal("ANOTACAO"), nota: z.enum(["POSITIVO", "NEGATIVO", "ATENCAO"]), texto: z.string().max(5000), titulo: z.string().max(120).optional(), html: z.string().max(30000).optional(), tamanhoTitulo: z.number().int().min(8).max(48).optional(), fonteTitulo: fonteDoTexto.optional(), espacamento }),
    z.object({ ...posicao, tipo: z.literal("FOTO"), arquivo: z.union([z.literal(""), z.string().regex(NOME_DA_FOTO)]), legenda: z.string().max(500), proporcao: z.number().positive().max(50), legendaHtml: z.string().max(5000).optional(), livre: z.boolean().optional(), ajustes: ajustesDeImagem.optional(), recorte: recorte.optional() }),
    // O vídeo (20/10/2026): o arquivo enviado ou o link de um dos sites aceitos (vazios, o quadro esperando o vídeo).
    z.object({
      ...posicao,
      tipo: z.literal("VIDEO"),
      origem: z.enum(["ARQUIVO", "LINK"]),
      arquivo: z.union([z.literal(""), z.string().regex(NOME_DO_VIDEO)]),
      url: z.union([z.literal(""), z.string().max(2000).regex(SITES_DE_VIDEO)]),
      legenda: z.string().max(500),
      proporcao: z.number().positive().max(50),
      legendaHtml: z.string().max(5000).optional(),
    }),
    // O Texto Livre e o Sumário (20/10/2026).
    z.object({ ...posicao, tipo: z.literal("TEXTO"), texto: z.string().max(5000), html: z.string().max(30000).optional(), espacamento }),
    // A tabela de Resultados (22/10/2026): a visão, o nível, as linhas escolhidas e os meses anteriores recolhidos.
    z.object({ ...posicao, tipo: z.literal("TABELA"), visao: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]), nivel: z.union([z.literal(1), z.literal(2), z.literal(3)]), linhas: z.array(z.string().min(1).max(200)).max(1000).optional(), recolhido: z.boolean().optional(), colunas: z.object({ unitario: z.boolean(), diferenca: z.boolean(), atingimento: z.boolean(), eficiencia: z.boolean() }).optional(), prova }),
    z.object({ ...posicao, tipo: z.literal("SUMARIO"), listar: z.enum(["TELAS", "TELAS_E_SLIDES"]), telas: z.array(telasDoSumario).max(maximoDeTelas), linha: z.enum(["PONTOS", "TRACOS", "LINHA", "NENHUM"]).optional(), estilos: z.object({ telas: estiloDoSumario.optional(), slides: estiloDoSumario.optional() }).optional() }),
  ]);
  return z.object({
    paginas: z.array(z.object({ id: z.string().min(1).max(40), nome: z.string().max(60).optional(), blocos: z.array(bloco).max(200), fundo: fundo.optional(), transicao: z.enum(["ESMAECER", "ROLAR_VERTICAL", "ROLAR_HORIZONTAL"]).optional(), avancarApos: z.number().int().min(1).max(3600).optional(), recomecarAoTerminar: z.boolean().optional() })).min(1).max(30),
    versao: z.string().max(40).optional(),
    forcar: z.boolean().optional(),
  });
}

/** As comparações das Configurações: a Comparação Padrão e, desde 31/10/2026, a Comparação PROVA (dois ou mais cenários). */
export const corpoDasComparacoes = { cenarioComparadoId: z.string().uuid().nullable().optional(), comparacaoProva: z.array(marcacaoDoProva).min(2).max(4).optional() };

/**
 * A cópia das fotos e dos vídeos de outro documento (24/10/2026): o id dele, os arquivos e, desde 31/10/2026, o processo
 * dele (sem ele, um relatório executivo: as cópias de antes dos Painéis de Bordo).
 */
export const corpoDaCopia = z.object({ de: z.string().uuid(), arquivos: z.array(z.string().max(60)).min(1).max(200), processo: z.enum(PROCESSOS_DOS_SLIDES).optional() });

/** Uma foto: o conteúdo, com o tipo e o cache de um dia. */
export async function enviarFoto(response: Response, ler: () => Promise<{ conteudo: Buffer; tipo: string }>) {
  try {
    const f = await ler();
    response.setHeader("Content-Type", f.tipo);
    response.setHeader("Cache-Control", "private, max-age=86400");
    return response.send(f.conteudo);
  } catch (error) {
    if (error instanceof SlidesError) return respostaDoErro(response, error);
    throw error;
  }
}

/** Um vídeo (20/10/2026), em partes (o cabeçalho Range), para o player avançar e recuar sem baixar o arquivo inteiro. */
export async function enviarVideo(request: Request, response: Response, ler: () => Promise<{ caminho: string; tamanho: number; tipo: string }>) {
  try {
    const v = await ler();
    response.setHeader("Content-Type", v.tipo);
    response.setHeader("Accept-Ranges", "bytes");
    response.setHeader("Cache-Control", "private, max-age=86400");
    const intervalo = /^bytes=(\d*)-(\d*)$/.exec(String(request.headers.range ?? ""));
    if (!intervalo || (!intervalo[1] && !intervalo[2])) {
      response.setHeader("Content-Length", String(v.tamanho));
      return createReadStream(v.caminho).pipe(response);
    }
    // "bytes=início-fim", "bytes=início-" ou "bytes=-últimos".
    const inicio = intervalo[1] ? Number(intervalo[1]) : Math.max(0, v.tamanho - Number(intervalo[2]));
    const fim = intervalo[1] && intervalo[2] ? Math.min(Number(intervalo[2]), v.tamanho - 1) : v.tamanho - 1;
    if (inicio >= v.tamanho || inicio > fim) {
      response.setHeader("Content-Range", `bytes */${v.tamanho}`);
      return response.status(416).end();
    }
    response.status(206);
    response.setHeader("Content-Range", `bytes ${inicio}-${fim}/${v.tamanho}`);
    response.setHeader("Content-Length", String(fim - inicio + 1));
    return createReadStream(v.caminho, { start: inicio, end: fim }).pipe(response);
  } catch (error) {
    if (error instanceof SlidesError) return respostaDoErro(response, error);
    throw error;
  }
}

/** O tamanho do vídeo que chega (o Content-Length), quando vem. */
export const tamanhoDoCorpo = (request: Request) => {
  const tamanho = Number(request.headers["content-length"]);
  return Number.isFinite(tamanho) ? tamanho : null;
};
