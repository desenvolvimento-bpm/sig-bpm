import type { Request, Response } from "express";
import { z } from "zod";

import { anoMesSchema } from "../../schemas/importacoes/importacaoSchemas.js";
import { detalhamentoService } from "../../services/dre/detalhamentoService.js";
import { documentosService } from "../../services/dre/documentosService.js";
import { dreService, RegraDREError } from "../../services/dre/dreService.js";
import { exportacaoService, type VisaoExportacao } from "../../services/dre/exportacaoService.js";
import { exportarExtrato } from "../../services/dre/exportacaoExtrato.js";
import { obrasService } from "../../services/dre/obrasService.js";
import { ehGrupoSemCentro, semCentroService, type GrupoSemCentro } from "../../services/dre/semCentroService.js";
import { volumesDaLinha } from "../../services/dre/volumesDaLinhaService.js";
import { rateiosService, RegraRateioError } from "../../services/volumes/rateiosService.js";
import { auditar } from "../../services/auditoriaService.js";

const unidadeSchema = z.coerce.number().int().min(1).max(5);
const grupoSchema = z.string().trim().min(1).max(200).optional();
/** A obra: o código do centro de custo de obra no RM (1.98.… ou 1.99.…). */
const obraSchema = z.string().trim().regex(/^1.9[89].[0-9.]+$/).optional();
/** ?obras= (03/11/2026, o Realizado por Obra): os códigos das obras de uma venda, separados por vírgula. */
const obrasSchema = z.string().trim().max(4000).optional().transform((s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 200) : undefined));

function competencia(request: Request, response: Response) {
  const c = anoMesSchema.safeParse(request.params.anoMes);
  if (!c.success) {
    response.status(400).json({ error: "Competência inválida" });
    return null;
  }
  return c.data;
}

/** A linha e a visão do detalhamento pela query: ?linha= e ?unidade=1..5, ?grupo= (centro), ?obra=, ?semCentro= ou nenhuma (consolidado). */
function linhaEVisaoDoDetalhe(request: Request): { linha: string; visao: Parameters<typeof detalhamentoService.detalhar>[3] } | { erro: string } {
  const linha = z.string().trim().min(1).max(200).safeParse(request.query.linha);
  if (!linha.success) return { erro: "Linha da DRE inválida" };
  const g = grupoSchema.safeParse(request.query.grupo);
  if (!g.success) return { erro: "Centro de custo inválido" };
  const o = obraSchema.safeParse(request.query.obra);
  if (!o.success) return { erro: "Obra inválida" };
  const semCentro = z.string().trim().min(1).max(40).optional().safeParse(request.query.semCentro);
  if (!semCentro.success) return { erro: "Grupo inválido" };
  if (semCentro.data) return { linha: linha.data, visao: { semCentro: semCentro.data } };
  if (o.data) return { linha: linha.data, visao: { obra: o.data } };
  if (g.data) return { linha: linha.data, visao: { grupo: g.data } };
  if (request.query.unidade !== undefined) {
    const u = unidadeSchema.safeParse(request.query.unidade);
    if (!u.success) return { erro: "Unidade inválida" };
    return { linha: linha.data, visao: { unidade: u.data } };
  }
  return { linha: linha.data, visao: { consolidado: true } };
}

async function responder(response: Response, fn: () => Promise<unknown>) {
  try {
    return response.json({ data: await fn() });
  } catch (error) {
    if (error instanceof RegraDREError) return response.status(error.status).json({ error: error.message });
    throw error;
  }
}

/** O recorte do modal Balancete (o do extrato): a linha, a conta do balancete, o centro, a filial e a conta que vale na DRE. */
const filtroDoBalanceteSchema = z.object({
  linha: z.string().trim().min(1).max(200),
  conta: z.string().trim().min(1).max(50),
  centro: z.string().trim().max(50).optional(),
  filial: z.coerce.number().int().min(1).max(99).optional(),
  // A conta que vale na DRE (27/10/2026): com a reclassificação ou a contestação, a do lançamento do extrato.
  adotada: z.string().trim().max(50).optional(),
});

export const dreController = {
  async consultar(request: Request, response: Response) {
    const c = competencia(request, response);
    if (!c) return;
    const u = unidadeSchema.safeParse(request.query.unidade ?? 1);
    if (!u.success) return response.status(400).json({ error: "Unidade inválida" });
    return responder(response, () => dreService.consultarUnidade(c.ano, c.mes, u.data, request.user!.acesso));
  },

  async consolidado(request: Request, response: Response) {
    const c = competencia(request, response);
    if (!c) return;
    return responder(response, () => dreService.consultarConsolidado(c.ano, c.mes, request.user!.acesso));
  },

  /** Sem ?grupo, a lista dos agrupamentos de centros; com ele, a DRE do agrupamento. */
  async centros(request: Request, response: Response) {
    const c = competencia(request, response);
    if (!c) return;
    const g = grupoSchema.safeParse(request.query.grupo);
    if (!g.success) return response.status(400).json({ error: "Centro de custo inválido" });
    return responder(response, () => (g.data ? dreService.consultarCentros(c.ano, c.mes, g.data, request.user!.acesso) : dreService.listarCentros(c.ano, c.mes, request.user!.acesso)));
  },

  /** Sem ?obra, a lista das obras (centros de obra com lançamento no mês); com ela, a DRE da obra. */
  async obras(request: Request, response: Response) {
    const c = competencia(request, response);
    if (!c) return;
    const o = obraSchema.safeParse(request.query.obra);
    if (!o.success) return response.status(400).json({ error: "Obra inválida" });
    return responder(response, () => (o.data ? obrasService.consultar(c.ano, c.mes, o.data, request.user!.acesso) : obrasService.listar(c.ano, c.mes, request.user!.acesso)));
  },

  /** Sem ?grupo, os grupos dos movimentos sem centro de custo no mês; com ele, a DRE do grupo (15/10/2026). */
  async semCentros(request: Request, response: Response) {
    const c = competencia(request, response);
    if (!c) return;
    const g = z.string().trim().min(1).max(40).optional().safeParse(request.query.grupo);
    if (!g.success) return response.status(400).json({ error: "Grupo inválido" });
    if (g.data && !ehGrupoSemCentro(g.data)) return response.status(400).json({ error: "Grupo dos movimentos sem centro de custo inválido." });
    return responder(response, () =>
      g.data ? semCentroService.consultar(c.ano, c.mes, g.data as GrupoSemCentro, request.user!.acesso) : semCentroService.listar(c.ano, c.mes, request.user!.acesso),
    );
  },

  /**
   * As Regras de Rateio vigentes no mês (04/11/2026, pedido do Adão): o botão Regras de Rateio do extrato de uma linha e do
   * modal Contestar (que se abre do extrato).
   */
  async rateios(request: Request, response: Response) {
    const c = competencia(request, response);
    if (!c) return;
    try {
      return response.json({ data: await rateiosService.vigentes(c.ano, c.mes) });
    } catch (error) {
      if (error instanceof RegraRateioError) return response.status(error.status).json({ error: error.message });
      throw error;
    }
  },

  /** Detalhamento de uma linha: ?linha=código e ?unidade=1..5, ?grupo=centro, ou nenhum dos dois (consolidado). */
  async detalhe(request: Request, response: Response) {
    const c = competencia(request, response);
    if (!c) return;
    const q = linhaEVisaoDoDetalhe(request);
    if ("erro" in q) return response.status(400).json({ error: q.erro });
    return responder(response, () => detalhamentoService.detalhar(c.ano, c.mes, q.linha, q.visao, request.user!.acesso));
  },

  /**
   * O extrato de um valor em Excel (24/10/2026), com as abas Movimentações e Detalhes: os mesmos parâmetros do
   * detalhamento e, do modal Balancete, ?conta= (o reduzido do balancete), ?centro= e ?filial=.
   */
  async exportarExtrato(request: Request, response: Response) {
    const c = competencia(request, response);
    if (!c) return;
    const q = linhaEVisaoDoDetalhe(request);
    if ("erro" in q) return response.status(400).json({ error: q.erro });
    const r = z
      .object({ conta: z.string().trim().min(1).max(50).optional(), centro: z.string().trim().max(50).optional(), filial: z.coerce.number().int().min(1).max(99).optional() })
      .safeParse(request.query);
    if (!r.success) return response.status(400).json({ error: "Conta, centro de custo ou filial inválidos." });
    const recorte = r.data.conta ? { conta: r.data.conta, centro: r.data.centro || null, filial: r.data.filial ?? null } : undefined;
    try {
      const x = await exportarExtrato(c.ano, c.mes, q.linha, q.visao, request.user!.acesso, recorte);
      await auditar({
        usuarioId: request.user!.sub,
        usuarioNome: request.user!.nome,
        acao: "EXPORTACAO",
        entidade: "competencia",
        entidadeId: `${c.ano}-${String(c.mes).padStart(2, "0")}`,
        metadados: { formato: "xlsx", extrato: q.linha, visao: q.visao, ...(recorte ? { conta: recorte } : {}), arquivo: x.nomeArquivo },
      });
      response.setHeader("Content-Type", x.tipo);
      response.setHeader("Content-Disposition", `attachment; filename="${x.nomeArquivo.normalize("NFD").replace(/[^\x20-\x7e]/g, "")}"; filename*=UTF-8''${encodeURIComponent(x.nomeArquivo)}`);
      return response.send(Buffer.from(x.conteudo));
    } catch (error) {
      if (error instanceof RegraDREError) return response.status(error.status).json({ error: error.message });
      throw error;
    }
  },

  /** O balancete de uma conta no mês: ?linha= (o recorte), ?conta= (reduzido), ?centro= (código RM) e ?filial=. */
  async documentos(request: Request, response: Response) {
    const c = competencia(request, response);
    if (!c) return;
    const q = filtroDoBalanceteSchema.safeParse(request.query);
    if (!q.success) return response.status(400).json({ error: "Dados inválidos." });
    return responder(response, () =>
      documentosService.listar(c.ano, c.mes, { linha: q.data.linha, conta: q.data.conta, centro: q.data.centro || null, filial: q.data.filial ?? null, adotada: q.data.adotada || null }, request.user!.acesso),
    );
  },

  /** Os itens de um movimento do balancete (10/11/2026): o recorte do balancete e ?lancamento= (o movimento). */
  async itensDoMovimento(request: Request, response: Response) {
    const c = competencia(request, response);
    if (!c) return;
    const q = filtroDoBalanceteSchema.extend({ lancamento: z.string().uuid() }).safeParse(request.query);
    if (!q.success) return response.status(400).json({ error: "Dados inválidos." });
    return responder(response, () =>
      documentosService.itens(
        c.ano,
        c.mes,
        { linha: q.data.linha, conta: q.data.conta, centro: q.data.centro || null, filial: q.data.filial ?? null, adotada: q.data.adotada || null },
        q.data.lancamento,
        request.user!.acesso,
      ),
    );
  },

  /** As listas que formam uma linha de volume, por obra: ?linha=código e ?unidade=1..3 (sem ela, o consolidado). */
  async volumes(request: Request, response: Response) {
    const c = competencia(request, response);
    if (!c) return;
    const linha = z.string().trim().min(1).max(200).safeParse(request.query.linha);
    if (!linha.success) return response.status(400).json({ error: "Linha da DRE inválida" });
    let unidade: number | null = null;
    if (request.query.unidade !== undefined) {
      const u = unidadeSchema.safeParse(request.query.unidade);
      if (!u.success) return response.status(400).json({ error: "Unidade inválida" });
      unidade = u.data;
    }
    // ?obra= (30/10/2026): só os registros da obra (a linha de volume na aba Obras).
    const o = obraSchema.safeParse(request.query.obra);
    if (!o.success) return response.status(400).json({ error: "Obra inválida" });
    const os = obrasSchema.safeParse(request.query.obras);
    if (!os.success) return response.status(400).json({ error: "Obras inválidas" });
    return responder(response, () => volumesDaLinha(c.ano, c.mes, linha.data, unidade, request.user!.acesso, o.data, os.data));
  },

  async apurar(request: Request, response: Response) {
    const c = competencia(request, response);
    if (!c) return;
    return responder(response, () => (async () => {
      const r = await dreService.apurar(c.ano, c.mes, request.user!.sub);
      await auditar({ usuarioId: request.user!.sub, usuarioNome: request.user!.nome, acao: "APURACAO_PARCIAL", entidade: "competencia", entidadeId: `${c.ano}-${String(c.mes).padStart(2, "0")}`, metadados: { parte: "DRE" } });
      return r;
    })());
  },

  /**
   * A DRE apurada em Excel ou PDF (Passo 26): ?formato=xlsx|pdf e ?visao=
   * consolidado, todas, centros, obras ou 1..5, ?grupo= para um agrupamento de
   * centros ou ?obra= para uma obra.
   */
  async exportar(request: Request, response: Response) {
    const c = competencia(request, response);
    if (!c) return;
    const formato = z.enum(["xlsx", "pdf"]).safeParse(request.query.formato);
    if (!formato.success) return response.status(400).json({ error: "Formato inválido: use xlsx ou pdf." });
    const g = grupoSchema.safeParse(request.query.grupo);
    if (!g.success) return response.status(400).json({ error: "Centro de custo inválido" });
    const o = obraSchema.safeParse(request.query.obra);
    if (!o.success) return response.status(400).json({ error: "Obra inválida" });
    let visao: VisaoExportacao;
    const v = String(request.query.visao ?? "consolidado");
    const s = z.string().trim().min(1).max(40).optional().safeParse(request.query.semCentro);
    if (!s.success || (s.data && !ehGrupoSemCentro(s.data))) return response.status(400).json({ error: "Grupo dos movimentos sem centro de custo inválido." });
    if (s.data) visao = { tipo: "semCentro", grupo: s.data as GrupoSemCentro };
    else if (v === "sem_centros") visao = { tipo: "todosSemCentros" };
    else if (o.data) visao = { tipo: "obra", obra: o.data };
    else if (g.data) visao = { tipo: "centros", grupo: g.data };
    else if (v === "consolidado" || v === "todas") visao = { tipo: v };
    else if (v === "centros") visao = { tipo: "todosCentros" };
    else if (v === "centros_arquivos") visao = { tipo: "centrosArquivos" };
    else if (v === "obras") visao = { tipo: "todasObras" };
    else {
      const u = unidadeSchema.safeParse(v);
      if (!u.success) return response.status(400).json({ error: "Visão inválida: use consolidado, todas, centros, obras ou a unidade (1 a 5)." });
      visao = { tipo: "unidade", unidade: u.data };
    }
    try {
      const r = await exportacaoService.exportar(c.ano, c.mes, visao, formato.data, request.user!.nome, request.user!.acesso);
      await auditar({
        usuarioId: request.user!.sub,
        usuarioNome: request.user!.nome,
        acao: "EXPORTACAO",
        entidade: "competencia",
        entidadeId: `${c.ano}-${String(c.mes).padStart(2, "0")}`,
        metadados: { formato: formato.data, visoes: r.visoes, arquivo: r.nomeArquivo },
      });
      response.setHeader("Content-Type", r.tipo);
      response.setHeader("Content-Disposition", `attachment; filename="${r.nomeArquivo.normalize("NFD").replace(/[^\x20-\x7e]/g, "")}"; filename*=UTF-8''${encodeURIComponent(r.nomeArquivo)}`);
      return response.send(Buffer.from(r.conteudo));
    } catch (error) {
      if (error instanceof RegraDREError) return response.status(error.status).json({ error: error.message });
      throw error;
    }
  },
};
