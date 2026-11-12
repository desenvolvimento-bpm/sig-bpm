import type { NextFunction, Request, Response } from "express";

import { getPrismaClient } from "../config/prisma.js";
import { ABA_DA_VISAO } from "../services/acesso/telas.js";

/**
 * As permissões das rotas (14/10/2026: por tela e por aba). A área de uma tela é o código dela no catálogo
 * (services/acesso/telas.ts), e a de uma aba, "tela.aba"; o grupo do menu dá só uma área de leitura (cenarios:ler,
 * resultados:ler, fechamento:ler…), para o que é comum às telas dele.
 */

const SEM_PERMISSAO = { error: "Sem permissão para esta ação" };
export const temPermissao = (request: Request, p: string) => (request.user?.permissions ?? []).includes(p);

export function verificarPermissao(permission: string) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!temPermissao(request, permission)) return response.status(403).json(SEM_PERMISSAO);
    return next();
  };
}

/** Basta uma das permissões: para uma consulta que várias telas usam. */
export function verificarAlgumaPermissao(...permissoes: string[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!permissoes.some((p) => temPermissao(request, p))) return response.status(403).json(SEM_PERMISSAO);
    return next();
  };
}

/** Todas as permissões (a recarga dos cadastros mexe em três telas). */
export function verificarTodasAsPermissoes(...permissoes: string[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!permissoes.every((p) => temPermissao(request, p))) return response.status(403).json(SEM_PERMISSAO);
    return next();
  };
}

/**
 * A permissão de uma aba que vem do pedido (a visão, a unidade…): `aba` lê o pedido e devolve as abas que ele toca
 * (todas precisam da permissão); nulo é pedido inválido (400).
 */
export function verificarAba(tela: string, acao: "ler" | "editar", aba: (request: Request) => string[] | null) {
  return (request: Request, response: Response, next: NextFunction) => {
    const abas = aba(request);
    if (!abas) return response.status(400).json({ error: "Aba inválida." });
    if (!abas.every((a) => temPermissao(request, `${tela}.${a}:${acao}`))) return response.status(403).json(SEM_PERMISSAO);
    return next();
  };
}

/** A aba de uma visão da DRE pelo número (0 Consolidado, 1 a 5 as unidades), ou "centros"/"obras". */
export function abaDaVisao(v: unknown): string | null {
  const s = String(v ?? "0");
  if (s === "centros" || s === "obras" || s === "consolidado" || s === "sem_centros" || s === "linhas" || s === "rateios_linhas") return s;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 && n <= 5 ? ABA_DA_VISAO[n] : null;
}

/**
 * As abas da DRE do mês que o pedido toca (/competencias/:anoMes/dre…): o caminho (/consolidado, /centros, /obras) ou
 * os parâmetros (?unidade, ?grupo, ?obra, ?visao da exportação).
 */
export function abasDaDREDoPedido(request: Request): string[] | null {
  const caminho = request.path.replace(/\/+$/, "");
  const q = request.query as Record<string, unknown>;
  if (caminho.endsWith("/consolidado")) return ["consolidado"];
  if (caminho.endsWith("/centros")) return ["centros"];
  if (caminho.endsWith("/obras")) return ["obras"];
  if (caminho.endsWith("/sem-centros")) return ["sem_centros"];
  if (caminho.endsWith("/exportar")) {
    const v = String(q.grupo ? "centros" : q.obra ? "obras" : q.semCentro ? "sem_centros" : (q.visao ?? "consolidado"));
    if (v === "todas") return [...ABA_DA_VISAO];
    if (v === "centros_arquivos") return ["centros"];
    const a = abaDaVisao(v);
    return a ? [a] : null;
  }
  // O detalhamento dos movimentos sem centro de custo: a aba deles (nos Resultados Empresariais e, desde 15/10/2026, na DRE do mês).
  if (q.semCentro !== undefined) return ["sem_centros"];
  // Os documentos de uma linha e as Regras de Rateio do mês valem para qualquer aba da tela.
  if (caminho.endsWith("/documentos") || caminho.endsWith("/rateios")) return [];
  if (q.grupo !== undefined) return ["centros"];
  if (q.obra !== undefined || q.obras !== undefined) return ["obras"];
  if (q.unidade !== undefined) {
    const a = abaDaVisao(q.unidade);
    return a ? [a] : null;
  }
  // A tela da DRE (sem parâmetro) é a da Matriz; o detalhe e os volumes sem unidade são o consolidado.
  return [caminho === "" || caminho === "/" ? "matriz" : "consolidado"];
}

/**
 * A DRE de um mês (/competencias/:anoMes/dre…): com a tela DRE do Fechamento Mensal, qualquer mês, nas abas dela; com a
 * tela Resultados dos Resultados Empresariais, só as competências fechadas, nas abas dela (11/10/2026; por aba desde
 * 14/10/2026).
 */
export async function lerDREDoMes(request: Request, response: Response, next: NextFunction) {
  const abas = abasDaDREDoPedido(request);
  if (!abas) return response.status(400).json({ error: "Visão inválida." });
  // Sem aba (os documentos de uma linha), basta a tela.
  const pode = (tela: string) => (abas.length ? abas.every((a) => temPermissao(request, `${tela}.${a}:ler`)) : temPermissao(request, `${tela}:ler`));
  if (pode("dre")) return next();
  // As consultas dos Resultados do Realizado por Obra (03/11/2026): as da obra (os lançamentos dos centros dela, os volumes
  // das listas e o balancete de uma conta), só nas competências fechadas, como nos Resultados Empresariais.
  const doRealizado = abas.every((a) => a === "obras") && temPermissao(request, "realizado_obra_resultados:ler");
  if (!pode("relatorio_resultados") && !doRealizado) return response.status(403).json(SEM_PERMISSAO);
  const m = /^(\d{4})-(\d{2})$/.exec(String(request.params.anoMes ?? ""));
  if (!m) return response.status(400).json({ error: "Competência inválida." });
  try {
    const c = await getPrismaClient().competencia.findUnique({ where: { ano_mes: { ano: Number(m[1]), mes: Number(m[2]) } }, select: { status: true } });
    if (c?.status !== "FECHADA") return response.status(403).json({ error: "Os Resultados Empresariais mostram só as competências fechadas." });
    return next();
  } catch (error) {
    return next(error);
  }
}

/** A área de um cenário pelo tipo (os sintéticos, cenarios; os analíticos, cenarios_analiticos). */
async function areaDoCenario(request: Request) {
  if (request.params.id) {
    const c = await getPrismaClient().cenario.findUnique({ where: { id: String(request.params.id) }, select: { tipo: true } });
    return c ? (c.tipo === "ANALITICO" ? "cenarios_analiticos" : "cenarios") : null;
  }
  const tipo = String(request.query.tipo ?? (request.body as { tipo?: unknown } | undefined)?.tipo ?? "SINTETICO");
  return tipo === "ANALITICO" ? "cenarios_analiticos" : "cenarios";
}

/**
 * A permissão de um cenário pelo tipo dele (13/10/2026) e pela tela (14/10/2026): sem `tela`, a leitura do grupo
 * (o cenário aberto na barra, a lista dos cenários); com ela, a da tela (`lista`, `resultados`…) ou, com `aba`, a da
 * aba (fixa, ou lida do pedido). Com :id, o tipo é o do cenário (desconhecido segue adiante: a rota responde 404);
 * sem ele (a lista e a criação), o pedido em ?tipo= ou no corpo (o padrão, SINTETICO).
 */
export function verificarPermissaoDoCenario(acao: "ler" | "editar", tela?: string, aba?: string | ((request: Request, base: string) => string | null)) {
  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      const base = await areaDoCenario(request);
      if (!base) return next();
      response.locals.areaDoCenario = base;
      if (!tela) return verificarPermissao(`${base}:ler`)(request, response, next);
      const daAba = typeof aba === "function" ? aba(request, base) : aba;
      if (typeof aba === "function" && !daAba) return response.status(400).json({ error: "Aba inválida." });
      const area = daAba ? `${base}_${tela}.${daAba}` : `${base}_${tela}`;
      return verificarPermissao(`${area}:${acao}`)(request, response, next);
    } catch (error) {
      return next(error);
    }
  };
}

/**
 * A tela de cada cadastro (14/10/2026; antes, o grupo): a chave é a entidade da rota (/cadastros/edicao/:entidade). Os
 * da Controladoria são abas das telas Contábil, Controladoria e Analítico (17/10/2026).
 */
export const AREA_DO_CADASTRO: Record<string, string> = {
  reclassificacoes: "cadastro_reclassificacoes",
  "precos-contrato": "cadastro_precos_contrato",
  "tipos-movimento": "cadastro_tipos_movimento",
  "tabela-estacas": "cadastro_tabela_estacas",
  unidades: "cadastro_contabil.unidades",
  "centros-custo": "cadastro_contabil.centros_custo",
  "contas-resultado": "cadastro_contabil.contas_resultado",
  linhas: "cadastro_controladoria.linhas",
  "estrutura-dre": "cadastro_controladoria.estrutura_dre",
  "regras-rateio": "cadastro_controladoria.regras_rateio",
  "alocacao-linhas": "cadastro_controladoria.alocacao_linhas",
  // Os Departamentos (11/11/2026).
  departamentos: "cadastro_controladoria.departamentos",
  "estrutura-indicadores": "cadastro_analitico.estrutura_indicadores",
  "painel-bordo": "cadastro_analitico.painel_bordo",
  // A tela Cadastros da Gestão de Colaboradores (06/11/2026).
  "colaboradores-senioridades": "colaboradores_cadastros.senioridades",
  "colaboradores-funcoes": "colaboradores_cadastros.funcoes",
  "colaboradores-movimentacoes": "colaboradores_cadastros.movimentacoes",
  "colaboradores-classificacoes": "colaboradores_cadastros.classificacoes",
  "colaboradores-lancamento-inicial": "colaboradores_cadastros.lancamento_inicial",
};

/** A permissão da tela do cadastro da rota (:entidade); entidade desconhecida segue adiante (a rota responde 404). */
export function verificarPermissaoDoCadastro(acao: "ler" | "editar") {
  return (request: Request, response: Response, next: NextFunction) => {
    const area = AREA_DO_CADASTRO[String(request.params.entidade)];
    if (!area) return next();
    return verificarPermissao(`${area}:${acao}`)(request, response, next);
  };
}

/**
 * Os indicadores de um cenário (14/10/2026): a tela Indicadores (o controlador deixa só as abas permitidas) ou, no
 * analítico, a aba Indicadores Manuais das Premissas.
 */
export async function verificarIndicadoresDoCenario(request: Request, response: Response, next: NextFunction) {
  try {
    const base = await areaDoCenario(request);
    if (!base) return next();
    response.locals.areaDoCenario = base;
    // Os Indicadores são uma aba do Painel de Bordo (19/10/2026): a tela dele (o controlador deixa só as abas permitidas).
    // Os Indicadores Manuais também: nos sintéticos, na tela Configurações; nos analíticos, nas Premissas (19/10/2026).
    if (temPermissao(request, `${base}_painel:ler`) || temPermissao(request, `${base}_${base === "cenarios_analiticos" ? "premissas" : "configuracoes"}.manuais:ler`)) return next();
    return response.status(403).json(SEM_PERMISSAO);
  } catch (error) {
    return next(error);
  }
}

/** A gravação dos Indicadores Manuais: no sintético, a aba da tela Configurações (19/10/2026); no analítico, a das Premissas. */
export async function verificarManuaisDoCenario(request: Request, response: Response, next: NextFunction) {
  try {
    const base = await areaDoCenario(request);
    if (!base) return next();
    const area = base === "cenarios_analiticos" ? `${base}_premissas.manuais` : `${base}_configuracoes.manuais`;
    return verificarPermissao(`${area}:editar`)(request, response, next);
  } catch (error) {
    return next(error);
  }
}
