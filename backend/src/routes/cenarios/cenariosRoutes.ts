import express, { Router } from "express";

import { env } from "../../config/env.js";
import { cenariosController as c } from "../../controllers/cenarios/cenariosController.js";
import { autenticacao } from "../../middlewares/autenticacao.js";
import type { Request } from "express";

import { abaDaVisao, verificarAlgumaPermissao, verificarIndicadoresDoCenario, verificarManuaisDoCenario, verificarPermissaoDoCenario } from "../../middlewares/verificarPermissao.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

/**
 * Criação de Cenários (os sintéticos e os analíticos): montado em /cenarios. A permissão é a do tipo do cenário
 * (13/10/2026): Cenários Sintéticos (cenarios:*) ou Cenários Analíticos (cenarios_analiticos:*) — pelo cenário da rota,
 * ou, na lista e na criação, pelo tipo pedido.
 */
export const cenariosRoutes = Router();
/** A leitura do grupo do tipo (a lista na barra, o cenário aberto); as telas e as abas, cada rota com a sua (14/10/2026). */
const ler = verificarPermissaoDoCenario("ler");
const tela = (t: string, acao: "ler" | "editar" = "ler", aba?: string | ((r: Request) => string | null)) => verificarPermissaoDoCenario(acao, t, aba);
const abaDaVisaoDoCorpo = (r: Request) => abaDaVisao((r.body as { visao?: unknown } | undefined)?.visao);
const abaDaUnidade = (u: unknown) => ({ 1: "matriz", 2: "filial", 3: "servicos" })[Number(u)] ?? null;
const abaDosMensais = (r: Request) => ({ BASE: "investimentos", EXTRA: "extra" })[String((r.body as { tipo?: unknown } | undefined)?.tipo)] ?? null;
// A importação de arquivo é só dos sintéticos: um cenário novo (a lista) ou a referência de um cenário.
const editarSinteticos = verificarAlgumaPermissao("cenarios_lista:editar", "cenarios_configuracoes.referencia:editar");
cenariosRoutes.get("/", autenticacao, ler, asyncHandler(c.listar));
cenariosRoutes.post("/", autenticacao, express.json(), tela("lista", "editar"), asyncHandler(c.criar));
cenariosRoutes.post("/importar/analise", autenticacao, editarSinteticos, express.raw({ type: () => true, limit: `${env.UPLOAD_MAX_MB}mb` }), asyncHandler(c.analisar));
cenariosRoutes.post("/importar", autenticacao, editarSinteticos, express.json(), asyncHandler(c.importar));
cenariosRoutes.get("/:id", autenticacao, ler, asyncHandler(c.obter));
cenariosRoutes.patch("/:id", autenticacao, tela("configuracoes", "editar", "cenario"), express.json(), asyncHandler(c.atualizar));
cenariosRoutes.delete("/:id", autenticacao, tela("configuracoes", "editar", "cenario"), asyncHandler(c.excluir));
cenariosRoutes.put("/:id/marcacao", autenticacao, tela("configuracoes", "editar", "cenario"), express.json(), asyncHandler(c.marcar));
// A exportação (14/10/2026): a DRE (a aba de cada visão, conferida no controller) e os centros dos analíticos.
cenariosRoutes.get("/:id/exportar", autenticacao, tela("resultados", "ler"), asyncHandler(c.exportar));
cenariosRoutes.get("/:id/centros/exportar", autenticacao, tela("premissas", "ler", "centros"), asyncHandler(c.exportarCentros));
cenariosRoutes.get("/:id/resultados", autenticacao, tela("resultados", "ler", (r: Request) => abaDaVisao(r.query.visao ?? 0)), asyncHandler(c.resultados));
// Os indicadores: a tela Indicadores (o controlador deixa só as abas permitidas) ou, no analítico, a aba Indicadores
// Manuais das Premissas.
cenariosRoutes.get("/:id/indicadores", autenticacao, verificarIndicadoresDoCenario, asyncHandler(c.indicadores));
cenariosRoutes.get("/:id/painel", autenticacao, tela("painel"), asyncHandler(c.painel));
// A edição da DRE do cenário pela ferramenta (12/10/2026).
cenariosRoutes.get("/:id/edicao", autenticacao, tela("resultados", "editar", (r: Request) => abaDaVisao(r.query.visao ?? 0)), asyncHandler(c.edicao));
cenariosRoutes.put("/:id/edicao/valores", autenticacao, express.json({ limit: "2mb" }), tela("resultados", "editar", abaDaVisaoDoCorpo), asyncHandler(c.gravarValores));
cenariosRoutes.get("/:id/reajustes", autenticacao, tela("reajustes", "ler", "historico"), asyncHandler(c.reajustes));
cenariosRoutes.post("/:id/referencia/realizado", autenticacao, tela("configuracoes", "editar", "referencia"), express.json(), asyncHandler(c.referenciaRealizado));
// As realocações das movimentações fora dos padrões, na aba Referência (14/10/2026).
cenariosRoutes.put("/:id/realocacoes", autenticacao, tela("configuracoes", "editar", "referencia"), express.json(), asyncHandler(c.gravarRealocacoes));
// A referência dos sintéticos por cenários e realizados (15/10/2026).
cenariosRoutes.post("/:id/referencia/composta", autenticacao, tela("configuracoes", "editar", "referencia"), express.json(), asyncHandler(c.referenciaComposta));
cenariosRoutes.post("/:id/referencia/cenario", autenticacao, tela("configuracoes", "editar", "referencia"), express.json(), asyncHandler(c.referenciaCenario));
// O versionamento (13/10/2026): Congelar Versão, Reabrir Versão e Criar Revisão.
// O Recalcular dos Resultados dos analíticos (14/10/2026): depois de editar uma regra de rateio.
cenariosRoutes.post("/:id/recalcular", autenticacao, tela("resultados", "editar"), asyncHandler(c.recalcular));
cenariosRoutes.post("/:id/versao", autenticacao, tela("resultados", "editar"), asyncHandler(c.congelarVersao));
cenariosRoutes.post("/:id/versao/reabrir", autenticacao, tela("resultados", "editar"), asyncHandler(c.reabrirVersao));
cenariosRoutes.post("/:id/revisao", autenticacao, tela("resultados", "editar"), asyncHandler(c.criarRevisao));
// O comparativo com outro cenário e as justificativas (12/10/2026).
cenariosRoutes.get("/:id/comparativo", autenticacao, tela("configuracoes", "ler", "comparativo"), asyncHandler(c.comparativo));
cenariosRoutes.put("/:id/comparativo", autenticacao, tela("configuracoes", "editar", "comparativo"), express.json(), asyncHandler(c.gravarComparativo));
// Os Índices de Reajuste dos analíticos (19/10/2026): a aba Índices das Configurações; o Comparativo também os lê.
cenariosRoutes.get("/:id/indices", autenticacao, tela("configuracoes"), asyncHandler(c.indices));
cenariosRoutes.put("/:id/indices", autenticacao, tela("configuracoes", "editar", "indices"), express.json(), asyncHandler(c.gravarIndices));
cenariosRoutes.get("/:id/justificativas", autenticacao, tela("reajustes", "ler", "justificativas"), asyncHandler(c.justificativas));
cenariosRoutes.put("/:id/justificativas", autenticacao, tela("reajustes", "editar", "justificativas"), express.json(), asyncHandler(c.gravarJustificativa));
// As premissas dos cenários analíticos (13/10/2026).
cenariosRoutes.get("/:id/premissas", autenticacao, tela("premissas", "ler", (r) => abaDaUnidade(r.query.unidade)), asyncHandler(c.premissas));
// A planilha das premissas (15/10/2026): Replicar Médias / Apagar Valores, Exportar Premissas e Importar Valores; as abas, no controller.
cenariosRoutes.post("/:id/premissas/medias", autenticacao, ler, express.json(), asyncHandler(c.replicarMedias));
cenariosRoutes.get("/:id/premissas/exportar", autenticacao, ler, asyncHandler(c.exportarPremissas));
cenariosRoutes.post("/:id/premissas/importar/analise", autenticacao, ler, express.raw({ type: () => true, limit: `${env.UPLOAD_MAX_MB}mb` }), asyncHandler(c.analisarPremissas));
cenariosRoutes.post("/:id/premissas/importar", autenticacao, ler, express.json({ limit: "50mb" }), asyncHandler(c.importarPremissas));
cenariosRoutes.put("/:id/premissas", autenticacao, express.json({ limit: "2mb" }), tela("premissas", "editar", (r) => abaDaUnidade((r.body as { unidade?: unknown } | undefined)?.unidade)), asyncHandler(c.gravarPremissas));
// Os centros de custo dos cenários analíticos (13/10/2026).
cenariosRoutes.get("/:id/centros", autenticacao, tela("premissas", "ler", "centros"), asyncHandler(c.centros));
cenariosRoutes.get("/:id/centros/contas", autenticacao, tela("premissas", "ler", "centros"), asyncHandler(c.centro));
cenariosRoutes.put("/:id/centros", autenticacao, tela("premissas", "editar", "centros"), express.json({ limit: "2mb" }), asyncHandler(c.gravarCentro));
// Os rateios: a aba Rateios das Premissas; o aviso dos rateios sem base também aparece nas outras abas e nos Resultados.
cenariosRoutes.get("/:id/rateios", autenticacao, verificarPermissaoDoCenario("ler", "premissas"), asyncHandler(c.rateios));
// A aba Quadro de Lotação dos cenários analíticos (09/11/2026, etapa 4 da Gestão de Colaboradores).
cenariosRoutes.get("/:id/quadro", autenticacao, tela("premissas", "ler", "quadro"), asyncHandler(c.quadro));
cenariosRoutes.put("/:id/quadro/meses", autenticacao, tela("premissas", "editar", "quadro"), express.json({ limit: "4mb" }), asyncHandler(c.gravarMesesDoQuadro));
cenariosRoutes.post("/:id/quadro/excluir", autenticacao, tela("premissas", "editar", "quadro"), express.json(), asyncHandler(c.excluirLinhasDoQuadro));
cenariosRoutes.post("/:id/quadro", autenticacao, tela("premissas", "editar", "quadro"), express.json(), asyncHandler(c.gravarLinhaDoQuadro));
cenariosRoutes.put("/:id/quadro/:linhaId", autenticacao, tela("premissas", "editar", "quadro"), express.json(), asyncHandler(c.gravarLinhaDoQuadro));
cenariosRoutes.delete("/:id/quadro/:linhaId", autenticacao, tela("premissas", "editar", "quadro"), asyncHandler(c.gravarLinhaDoQuadro));
// Os investimentos e o extra-operacional dos cenários analíticos (13/10/2026).
cenariosRoutes.get("/:id/investimentos", autenticacao, tela("premissas", "ler", "investimentos"), asyncHandler(c.investimentos));
cenariosRoutes.post("/:id/investimentos/excluir", autenticacao, tela("premissas", "editar", "investimentos"), express.json(), asyncHandler(c.excluirInvestimentos));
cenariosRoutes.post("/:id/investimentos", autenticacao, tela("premissas", "editar", "investimentos"), express.json(), asyncHandler(c.gravarInvestimento));
cenariosRoutes.put("/:id/investimentos/:investimentoId", autenticacao, tela("premissas", "editar", "investimentos"), express.json(), asyncHandler(c.gravarInvestimento));
cenariosRoutes.delete("/:id/investimentos/:investimentoId", autenticacao, tela("premissas", "editar", "investimentos"), asyncHandler(c.gravarInvestimento));
cenariosRoutes.get("/:id/extra-operacional", autenticacao, tela("premissas", "ler", "extra"), asyncHandler(c.extraOperacional));
cenariosRoutes.put("/:id/mensais", autenticacao, express.json({ limit: "2mb" }), tela("premissas", "editar", abaDosMensais), asyncHandler(c.gravarMensais));
// Os Indicadores Manuais: no sintético, a aba da tela Indicadores; no analítico, a das Premissas.
cenariosRoutes.put("/:id/indicadores/manuais", autenticacao, verificarManuaisDoCenario, express.json(), asyncHandler(c.salvarManual));
