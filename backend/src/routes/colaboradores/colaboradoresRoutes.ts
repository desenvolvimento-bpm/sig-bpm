import express, { Router, type NextFunction, type Request, type Response } from "express";

import { env } from "../../config/env.js";
import { colaboradoresController as c } from "../../controllers/colaboradores/colaboradoresController.js";
import { autenticacao } from "../../middlewares/autenticacao.js";
import { verificarAlgumaPermissao, verificarPermissao } from "../../middlewares/verificarPermissao.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

/**
 * A Gestão de Colaboradores (06/11/2026, pedido do Adão): montado em /gestao-de-colaboradores. Os cadastros da tela
 * Cadastros vão pela edição genérica (/cadastros/edicao/colaboradores-…); aqui, as importações das abas Funções e Lançamento
 * Inicial, que pedem Editar na aba (a planilha chega crua no corpo), o Quadro de Lotação (etapa 2: as competências pedem a
 * tela; cada aba, a dela, Editar para mudar) e o Painel de Bordo.
 */
const ABA_DA_IMPORTACAO: Record<string, string> = { funcoes: "funcoes", "lancamento-inicial": "lancamento_inicial" };
const editarAba = (request: Request, response: Response, next: NextFunction) => {
  const aba = ABA_DA_IMPORTACAO[String(request.params.tipo)];
  if (!aba) return response.status(404).json({ error: "Importação inexistente." });
  return verificarPermissao(`colaboradores_cadastros.${aba}:editar`)(request, response, next);
};

export const colaboradoresRoutes = Router();
colaboradoresRoutes.post(
  "/importacoes/:tipo",
  autenticacao,
  editarAba,
  express.raw({ type: () => true, limit: `${env.UPLOAD_MAX_MB}mb` }),
  asyncHandler(c.importar),
);

const pode = (p: string) => verificarPermissao(p);
colaboradoresRoutes.get("/quadro/competencias", autenticacao, pode("colaboradores_quadro:ler"), asyncHandler(c.competencias));
colaboradoresRoutes.post("/quadro/competencias", autenticacao, pode("colaboradores_quadro:editar"), asyncHandler(c.abrirCompetencia));
colaboradoresRoutes.post("/quadro/competencias/:anoMes/fechar", autenticacao, pode("colaboradores_quadro:editar"), asyncHandler(c.fecharCompetencia));
colaboradoresRoutes.post("/quadro/competencias/:anoMes/reabrir", autenticacao, pode("colaboradores_quadro:editar"), asyncHandler(c.reabrirCompetencia));
colaboradoresRoutes.delete("/quadro/competencias/:anoMes", autenticacao, pode("colaboradores_quadro:editar"), asyncHandler(c.excluirCompetencia));
colaboradoresRoutes.get("/quadro/opcoes", autenticacao, pode("colaboradores_quadro.movimentacoes:ler"), asyncHandler(c.opcoes));
colaboradoresRoutes.get("/quadro/competencias/:anoMes/movimentacoes", autenticacao, pode("colaboradores_quadro.movimentacoes:ler"), asyncHandler(c.movimentacoes));
colaboradoresRoutes.post("/quadro/competencias/:anoMes/movimentacoes", autenticacao, pode("colaboradores_quadro.movimentacoes:editar"), asyncHandler(c.registrar));
colaboradoresRoutes.delete("/quadro/movimentacoes/:id", autenticacao, pode("colaboradores_quadro.movimentacoes:editar"), asyncHandler(c.excluirMovimentacao));
colaboradoresRoutes.get("/quadro/competencias/:anoMes/controle", autenticacao, pode("colaboradores_quadro.controle:ler"), asyncHandler(c.controle));
colaboradoresRoutes.post("/quadro/movimentacoes/:id/decisao", autenticacao, pode("colaboradores_quadro.controle:editar"), asyncHandler(c.decidir));
colaboradoresRoutes.get("/quadro/competencias/:anoMes/realizado", autenticacao, pode("colaboradores_quadro.realizado:ler"), asyncHandler(c.realizado));
// A Jornada (13/11/2026): Ler vê as linhas; Editar grava as horas extras e as faltas (na competência aberta).
colaboradoresRoutes.get("/quadro/competencias/:anoMes/jornada", autenticacao, pode("colaboradores_quadro.jornada:ler"), asyncHandler(c.jornada));
colaboradoresRoutes.put("/quadro/competencias/:anoMes/jornada", autenticacao, pode("colaboradores_quadro.jornada:editar"), asyncHandler(c.gravarJornada));
colaboradoresRoutes.get("/painel", autenticacao, pode("colaboradores_painel:ler"), asyncHandler(c.painel));
// A Comparação com um cenário marcado (09/11/2026, etapa 4): no Quadro de Lotação e no Painel de Bordo.
colaboradoresRoutes.get("/comparacao", autenticacao, verificarAlgumaPermissao("colaboradores_quadro:ler", "colaboradores_painel:ler"), asyncHandler(c.comparacao));

// O Apurar das Importações (06/11/2026, etapa 3): no modal de um tipo (Indicadores do Administrativo ou Quadro de Lotação), com
// Editar nas Importações; a lupa dos indicadores apurados (as movimentações aprovadas do mês), de quem vê os indicadores.
colaboradoresRoutes.get("/apuracao/:anoMes/:tipo", autenticacao, pode("importacao:editar"), asyncHandler(c.previaApuracao));
colaboradoresRoutes.post("/apuracao/:anoMes/:tipo", autenticacao, pode("importacao:editar"), asyncHandler(c.gravarApuracao));
colaboradoresRoutes.get(
  "/quadro/competencias/:anoMes/movimentos-aprovados",
  autenticacao,
  verificarAlgumaPermissao("relatorio_painel:ler", "colaboradores_quadro:ler", "listas_operacionais:ler"),
  asyncHandler(c.movimentosDoMes),
);
