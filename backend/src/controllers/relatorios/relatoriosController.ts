import type { Request, Response } from "express";
import { z } from "zod";

import { auditar } from "../../services/auditoriaService.js";
import { exportacaoRelatoriosService, type EscopoResultados } from "../../services/relatorios/exportacaoRelatoriosService.js";
import { indicadoresService } from "../../services/relatorios/indicadoresService.js";
import { orcamentosDoProva } from "../../services/relatorios/orcamento.js";
import { painelService } from "../../services/relatorios/painelService.js";
import { pesquisaDosResultados } from "../../services/relatorios/pesquisaDosResultados.js";
import { RelatorioError, resultadosService } from "../../services/relatorios/resultadosService.js";
import { creditosImpostosService } from "../../services/impostos/creditosImpostosService.js";
import { veObras } from "../../services/acesso/recorteDepartamento.js";
import { cenariosMarcados } from "../../services/cenarios/indicadoresDoCenario.js";
import { ehGrupoSemCentro, veSemCentros, type GrupoSemCentro } from "../../services/dre/semCentroService.js";
import { RegraLinhasError, resultadosLinhaService } from "../../services/resultadosLinha/resultadosLinhaService.js";
import { ABA_DA_VISAO } from "../../services/acesso/telas.js";

const anoSchema = z.coerce.number().int().min(2025).max(2100);
const ateSchema = z.coerce.number().int().min(1).max(12).optional();
const visaoSchema = z.union([z.literal("centros"), z.literal("obras"), z.literal("sem_centros"), z.literal("linhas"), z.literal("rateios_linhas"), z.coerce.number().int().min(0).max(5)]);
const obraSchema = z.string().trim().regex(/^1.9[89]./, "Obra inválida").max(40).optional();
const grupoSchema = z.string().trim().min(1).max(200).optional();
const linhaSchema = z.string().trim().min(1).max(60).optional();

async function responder(response: Response, fn: () => Promise<unknown>) {
  try {
    return response.json({ data: await fn() });
  } catch (error) {
    if (error instanceof RelatorioError || error instanceof RegraLinhasError) return response.status(error.status).json({ error: error.message });
    throw error;
  }
}

const formatoSchema = z.enum(["xlsx", "pdf"]);

/** Envia o arquivo gerado, com o nome em UTF-8, e registra a exportação na auditoria. */
async function enviarArquivo(request: Request, response: Response, relatorio: string, gerar: () => Promise<{ nomeArquivo: string; tipo: string; conteudo: Uint8Array; visoes: string[] }>) {
  try {
    const r = await gerar();
    await auditar({
      usuarioId: request.user!.sub,
      usuarioNome: request.user!.nome,
      acao: "EXPORTACAO",
      entidade: "relatorio",
      entidadeId: relatorio,
      metadados: { formato: request.query.formato, ano: request.query.ano, ate: request.query.ate, visoes: r.visoes, arquivo: r.nomeArquivo, ...(request.query.detalhes === "1" ? { detalhes: true } : {}) },
    });
    response.setHeader("Content-Type", r.tipo);
    response.setHeader("Content-Disposition", `attachment; filename="${r.nomeArquivo.normalize("NFD").replace(/[^ -~]/g, "")}"; filename*=UTF-8''${encodeURIComponent(r.nomeArquivo)}`);
    return response.send(Buffer.from(r.conteudo));
  } catch (error) {
    if (error instanceof RelatorioError || error instanceof RegraLinhasError) return response.status(error.status).json({ error: error.message });
    throw error;
  }
}

/**
 * Resultados Empresariais mostra só as competências fechadas (11/10/2026). A etapa Indicadores do Fechamento Mensal usa
 * as mesmas rotas com ?etapa=1 e vê o mês aberto, se o usuário tem a tela dela (indicadores_mes, 14/10/2026).
 */
const tem = (request: Request, p: string) => request.user!.permissions.includes(p);
const somenteFechadas = (request: Request) => !(request.query.etapa === "1" && tem(request, "totais.indicadores:ler"));
/** Os indicadores: a tela Indicadores dos Resultados Empresariais ou a etapa do Fechamento Mensal (?etapa=1). */
// A aba Indicadores do Painel de Bordo (19/10/2026; antes, a tela Indicadores).
const podeIndicadores = (request: Request) => tem(request, "relatorio_painel.indicadores:ler") || (request.query.etapa === "1" && tem(request, "totais.indicadores:ler"));

/** As unidades das linhas que o perfil vê (26/10/2026): as das abas Matriz, Filial e Serviços que ele lê. */
const unidadesDasLinhas = (request: Request) => [1, 2, 3].filter((u) => tem(request, `relatorio_resultados.${ABA_DA_VISAO[u]}:ler`));

/** ?ano= e ?ate= (o último mês; sem ele, o último apurado). */
function periodo(request: Request, response: Response) {
  const ano = anoSchema.safeParse(request.query.ano);
  const ate = ateSchema.safeParse(request.query.ate || undefined);
  if (!ano.success || !ate.success) {
    response.status(400).json({ error: "Exercício ou mês inválido" });
    return null;
  }
  return { ano: ano.data, ate: ate.data };
}

/** O Compara Com (21/10/2026): ?comparaCom= a marcação do cenário comparado; sem ele, o Orçamento Empresarial; inválido, false. */
const comparaComSchema = z.enum(["ORCAMENTO_EMPRESARIAL", "RESULTADOS_ANTERIORES", "RESULTADOS_VENDIDOS", "PREVISAO"]);
function comparaComDe(request: Request) {
  if (request.query.comparaCom === undefined || request.query.comparaCom === "") return "ORCAMENTO_EMPRESARIAL" as const;
  const r = comparaComSchema.safeParse(request.query.comparaCom);
  return r.success ? r.data : false;
}

/**
 * A Comparação PROVA (31/10/2026): ?prova= as marcações dos cenários, separadas por vírgula (até quatro), na ordem em que
 * vêm; sem ela, nenhuma (a Comparação Padrão); inválida, false.
 */
const provaSchema = z.array(comparaComSchema).min(1).max(4);
function provaDe(request: Request) {
  if (request.query.prova === undefined || request.query.prova === "") return [];
  const r = provaSchema.safeParse(String(request.query.prova).split(","));
  return r.success ? [...new Set(r.data)] : false;
}

export const relatoriosController = {
  /** Os cenários marcados (21/10/2026; desde 22/10/2026, de qualquer exercício): as opções do Compara Com. */
  async comparaveis(_request: Request, response: Response) {
    return responder(response, () => cenariosMarcados());
  },

  /**
   * O Pesquisar (11/11/2026): ?tipo=fornecedor|conta&termo=, nos meses fechados do exercício até ?ate=, no recorte do
   * usuário. O fornecedor pede ao menos três letras.
   */
  async pesquisar(request: Request, response: Response) {
    const p = periodo(request, response);
    if (!p) return;
    const tipo = z.enum(["fornecedor", "conta"]).safeParse(request.query.tipo);
    const termo = z.string().trim().min(1).max(120).safeParse(request.query.termo);
    if (!tipo.success || !termo.success) return response.status(400).json({ error: "Pesquisa inválida" });
    if (tipo.data === "fornecedor" && termo.data.length < 3) return response.status(400).json({ error: "Digite ao menos três letras do fornecedor ou cliente." });
    return responder(response, () => pesquisaDosResultados.pesquisar(p.ano, p.ate, tipo.data, termo.data, request.user!.acesso));
  },
  /** As contas de resultado da lista do Pesquisar (o plano de contas). */
  async contasDaPesquisa(_request: Request, response: Response) {
    return responder(response, () => pesquisaDosResultados.contas());
  },

  /** A aba Impostos (Créditos de Impostos, 03/11/2026): os créditos de impostos de cada mês fechado do exercício, até ?ate=. */
  async impostos(request: Request, response: Response) {
    const p = periodo(request, response);
    if (!p) return;
    return responder(response, () => creditosImpostosService.impostos(p.ano, p.ate));
  },

  /**
   * ?visao=0..5 (0 Consolidado) ou ?visao=centros: sem ?grupo, a lista dos agrupamentos; com ele, o agrupamento. Ou
   * ?visao=obras: sem ?obra, a lista das obras; com ela (o código do centro 1.98 ou 1.99), a obra. Ou ?visao=linhas e
   * ?visao=rateios_linhas (26/10/2026): sem ?linha, a lista das linhas; com ela, a DRE da linha ou o rateado dela.
   */
  async resultados(request: Request, response: Response) {
    const p = periodo(request, response);
    if (!p) return;
    const v = visaoSchema.safeParse(request.query.visao ?? 0);
    const g = grupoSchema.safeParse(request.query.grupo);
    if (!v.success || !g.success) return response.status(400).json({ error: "Visão inválida" });
    const acesso = request.user!.acesso;
    if (v.data === "obras") {
      const o = obraSchema.safeParse(request.query.obra || undefined);
      if (!o.success) return response.status(400).json({ error: "Obra inválida" });
      // O Coordenador vê as obras só com a opção marcada no cadastro dele.
      if (!veObras(acesso)) return response.status(403).json({ error: "O seu usuário não inclui os resultados das obras." });
      return responder(response, () => (o.data ? resultadosService.obra(p.ano, o.data, p.ate, acesso, true) : resultadosService.listarObras(p.ano, p.ate, acesso, true)));
    }
    // Os movimentos sem centro de custo (14/10/2026): sem ?grupo, a lista dos grupos; com ele, o grupo.
    if (v.data === "sem_centros") {
      if (!veSemCentros(acesso)) return response.status(403).json({ error: "Os movimentos sem centro de custo não são do seu recorte." });
      if (g.data && !ehGrupoSemCentro(g.data)) return response.status(400).json({ error: "Grupo inválido" });
      return responder(response, () => (g.data ? resultadosService.semCentro(p.ano, g.data as GrupoSemCentro, p.ate, acesso, true) : resultadosService.listarSemCentros(p.ano, p.ate, acesso, true)));
    }
    if (v.data === "centros") {
      return responder(response, () => (g.data ? resultadosService.centros(p.ano, g.data, p.ate, acesso, true) : resultadosService.listarCentros(p.ano, p.ate, acesso, true)));
    }
    // As linhas (26/10/2026), gravadas na etapa Linhas da apuração: as das unidades que o perfil lê.
    if (v.data === "linhas" || v.data === "rateios_linhas") {
      const l = linhaSchema.safeParse(request.query.linha || undefined);
      if (!l.success) return response.status(400).json({ error: "Linha inválida" });
      const unidades = unidadesDasLinhas(request);
      const rateios = v.data === "rateios_linhas";
      return responder(response, () => (l.data ? resultadosLinhaService.linha(p.ano, p.ate, l.data, rateios, unidades) : resultadosLinhaService.listar(p.ano, p.ate, unidades)));
    }
    const visao = v.data as 0 | 1 | 2 | 3 | 4 | 5;
    const comparaCom = comparaComDe(request);
    if (comparaCom === false) return response.status(400).json({ error: "Compara Com inválido" });
    const prova = provaDe(request);
    if (prova === false) return response.status(400).json({ error: "Comparação PROVA inválida" });
    return responder(response, () => resultadosService.unidade(p.ano, visao, p.ate, acesso, true, comparaCom, prova));
  },

  /**
   * ?formato=xlsx|pdf e ?escopo=atual (a visão de ?visao=0..5, ou o centro de ?grupo=), unidades (as seis visões) ou
   * centros (todos os agrupamentos que o usuário alcança): uma visão por aba (Excel) ou por página (PDF).
   */
  async exportarResultados(request: Request, response: Response) {
    const p = periodo(request, response);
    if (!p) return;
    const formato = formatoSchema.safeParse(request.query.formato);
    if (!formato.success) return response.status(400).json({ error: "Formato inválido: use xlsx ou pdf." });
    const g = grupoSchema.safeParse(request.query.grupo);
    const v = visaoSchema.safeParse(request.query.visao ?? 0);
    const escopo = String(request.query.escopo ?? "atual");
    let e: EscopoResultados;
    const acesso = request.user!.acesso;
    const o = obraSchema.safeParse(request.query.obra || undefined);
    if (escopo === "unidades") e = { tipo: "unidades" };
    else if (escopo === "centros") e = { tipo: "centros" };
    else if (escopo === "centros_arquivos") e = { tipo: "centrosArquivos" };
    // As obras (o Coordenador só com a opção) e os movimentos sem centro de custo (14/10/2026).
    else if (escopo === "obras" || (v.success && v.data === "obras")) {
      if (!veObras(acesso)) return response.status(403).json({ error: "O seu usuário não inclui os resultados das obras." });
      if (escopo === "obras") e = { tipo: "obras" };
      else if (o.success && o.data) e = { tipo: "obra", codigo: o.data };
      else return response.status(400).json({ error: "Obra inválida" });
    } else if (escopo === "sem_centros" || (v.success && v.data === "sem_centros")) {
      if (!veSemCentros(acesso)) return response.status(403).json({ error: "Os movimentos sem centro de custo não são do seu recorte." });
      if (escopo === "sem_centros") e = { tipo: "semCentros" };
      else if (g.success && g.data && ehGrupoSemCentro(g.data)) e = { tipo: "semCentro", grupo: g.data };
      else return response.status(400).json({ error: "Grupo inválido" });
    }
    // As linhas (26/10/2026): a da tela ou todas, na aba Linhas ou na Rateios das Linhas.
    else if (escopo === "linhas" || escopo === "rateios_linhas" || (v.success && (v.data === "linhas" || v.data === "rateios_linhas"))) {
      const rateios = escopo === "rateios_linhas" || (v.success && v.data === "rateios_linhas");
      const unidades = unidadesDasLinhas(request);
      const l = linhaSchema.safeParse(request.query.linha || undefined);
      if (escopo === "linhas" || escopo === "rateios_linhas") e = { tipo: "linhas", rateios, unidades };
      else if (l.success && l.data) e = { tipo: "linha", id: l.data, rateios, unidades };
      else return response.status(400).json({ error: "Linha inválida" });
    }
    else if (g.success && g.data) e = { tipo: "centro", grupo: g.data };
    else if (v.success && typeof v.data === "number") e = { tipo: "visao", visao: v.data as 0 | 1 | 2 | 3 | 4 | 5 };
    else return response.status(400).json({ error: "Visão inválida: use ?visao=0..5, ?grupo= ou ?escopo=unidades|centros." });
    // ?detalhes=1 (27/10/2026): no Excel, a aba Detalhes no fim, com os movimentos do balancete de cada aba.
    const detalhes = request.query.detalhes === "1";
    return enviarArquivo(request, response, "resultados", () =>
      exportacaoRelatoriosService.resultados(p.ano, p.ate, e, formato.data, request.user!.nome, acesso, detalhes),
    );
  },

  async exportarIndicadores(request: Request, response: Response) {
    if (!podeIndicadores(request)) return response.status(403).json({ error: "Sem permissão para esta ação" });
    const p = periodo(request, response);
    if (!p) return;
    const formato = formatoSchema.safeParse(request.query.formato);
    if (!formato.success) return response.status(400).json({ error: "Formato inválido: use xlsx ou pdf." });
    // ?escopo=mes: só o mês ?ate= (a etapa Indicadores do Fechamento Mensal).
    const apenasMes = request.query.escopo === "mes";
    return enviarArquivo(request, response, "indicadores", () => exportacaoRelatoriosService.indicadores(p.ano, p.ate, formato.data, request.user!.nome, apenasMes, somenteFechadas(request)));
  },

  async indicadores(request: Request, response: Response) {
    if (!podeIndicadores(request)) return response.status(403).json({ error: "Sem permissão para esta ação" });
    const p = periodo(request, response);
    if (!p) return;
    const comparaCom = comparaComDe(request);
    if (comparaCom === false) return response.status(400).json({ error: "Compara Com inválido" });
    const prova = provaDe(request);
    if (prova === false) return response.status(400).json({ error: "Comparação PROVA inválida" });
    return responder(response, () => indicadoresService.listar(p.ano, p.ate, somenteFechadas(request), comparaCom, orcamentosDoProva(prova)));
  },

  /** O Painel de Bordo do mês ?ate= (sem ele, o último apurado). */
  async painel(request: Request, response: Response) {
    const p = periodo(request, response);
    if (!p) return;
    const comparaCom = comparaComDe(request);
    if (comparaCom === false) return response.status(400).json({ error: "Compara Com inválido" });
    const prova = provaDe(request);
    if (prova === false) return response.status(400).json({ error: "Comparação PROVA inválida" });
    // Só as abas permitidas (Resultados, Performance; 14/10/2026).
    return responder(response, async () => {
      const r = await painelService.painel(p.ano, p.ate, true, comparaCom, orcamentosDoProva(prova));
      return { ...r, abas: r.abas.filter((a) => tem(request, `relatorio_painel.${a.chave}:ler`)) };
    });
  },
};
