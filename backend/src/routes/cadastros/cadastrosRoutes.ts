import express, { Router } from "express";

import { env } from "../../config/env.js";
import { verificarAlgumaPermissao, verificarPermissao, verificarTodasAsPermissoes } from "../../middlewares/verificarPermissao.js";

import { cadastrosController } from "../../controllers/cadastros/cadastrosController.js";
import { cenariosController } from "../../controllers/cenarios/cenariosController.js";
import { percentuaisFixosController } from "../../controllers/cadastros/percentuaisFixosController.js";
import { redistribuicoesController } from "../../controllers/cadastros/redistribuicoesController.js";
import { autenticacao } from "../../middlewares/autenticacao.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

export const cadastrosRoutes = Router();

// Consulta, e a recarga a partir da planilha durante o paralelo. A edição
// registro a registro entra no Passo 25.
cadastrosRoutes.get(
  "/resumo",
  autenticacao,
  verificarAlgumaPermissao("cadastros_apuracao:ler", "cadastros_controladoria:ler"),
  asyncHandler(cadastrosController.resumo),
);

// Recarga a partir da planilha, para o período de paralelo (nas telas dos Cadastros Gerais).
cadastrosRoutes.post(
  "/recarga/previa",
  autenticacao,
  verificarTodasAsPermissoes("cadastro_contabil.centros_custo:editar", "cadastro_contabil.contas_resultado:editar", "cadastro_controladoria.estrutura_dre:editar"),
  express.raw({ type: () => true, limit: `${env.UPLOAD_MAX_MB}mb` }),
  asyncHandler(cadastrosController.recargaPrevia),
);

cadastrosRoutes.post(
  "/recarga/confirmar",
  autenticacao,
  verificarTodasAsPermissoes("cadastro_contabil.centros_custo:editar", "cadastro_contabil.contas_resultado:editar", "cadastro_controladoria.estrutura_dre:editar"),
  asyncHandler(cadastrosController.recargaConfirmar),
);

cadastrosRoutes.get(
  "/centros-custo",
  autenticacao,
  verificarPermissao("cadastros_controladoria:ler"),
  asyncHandler(cadastrosController.listarCentrosCusto),
);

cadastrosRoutes.get(
  "/contas-resultado",
  autenticacao,
  verificarPermissao("cadastros_controladoria:ler"),
  asyncHandler(cadastrosController.listarContasResultado),
);

cadastrosRoutes.get(
  "/reclassificacoes",
  autenticacao,
  verificarPermissao("cadastro_reclassificacoes.por_conta:ler"),
  asyncHandler(cadastrosController.listarReclassificacoes),
);

// As reclassificações por fornecedor (13/11/2026): a aba Por Fornecedor da tela Reclassificações.
cadastrosRoutes.get(
  "/reclassificacoes-fornecedor",
  autenticacao,
  verificarPermissao("cadastro_reclassificacoes.por_fornecedor:ler"),
  asyncHandler(cadastrosController.listarReclassificacoesFornecedor),
);

cadastrosRoutes.get(
  "/precos-contrato",
  autenticacao,
  verificarPermissao("cadastros_apuracao:ler"),
  asyncHandler(cadastrosController.listarPrecosContrato),
);

cadastrosRoutes.get(
  "/linhas-dre",
  autenticacao,
  verificarPermissao("cadastros_controladoria:ler"),
  asyncHandler(cadastrosController.listarLinhasDRE),
);

// A correspondência tarefa × linha (14/10/2026; na tela Linhas): as tarefas das requisições e das notas fiscais e a
// linha de cada uma, que a referência realizada dos cenários analíticos usa para dividir os custos entre as linhas.
cadastrosRoutes.get("/linhas/correspondencias", autenticacao, verificarPermissao("cadastro_controladoria.linhas:ler"), asyncHandler(cenariosController.correspondencias));
cadastrosRoutes.put("/linhas/correspondencias", autenticacao, verificarPermissao("cadastro_controladoria.linhas:editar"), express.json(), asyncHandler(cenariosController.gravarCorrespondencias));

// As Redistribuições de Gastos (13/11/2026; Cadastros Gerais / Controladoria): a lista, as listas do modal, os
// fornecedores da combinação (departamento e conta da DRE) e a gravação.
const redistribuicoesLer = verificarPermissao("cadastro_controladoria.redistribuicoes:ler");
const redistribuicoesEditar = verificarPermissao("cadastro_controladoria.redistribuicoes:editar");
cadastrosRoutes.get("/redistribuicoes", autenticacao, redistribuicoesLer, asyncHandler(redistribuicoesController.listar));
cadastrosRoutes.get("/redistribuicoes/opcoes", autenticacao, redistribuicoesLer, asyncHandler(redistribuicoesController.opcoes));
cadastrosRoutes.get("/redistribuicoes/fornecedores", autenticacao, redistribuicoesLer, asyncHandler(redistribuicoesController.fornecedores));
cadastrosRoutes.post("/redistribuicoes", autenticacao, redistribuicoesEditar, express.json(), asyncHandler(redistribuicoesController.criar));
cadastrosRoutes.put("/redistribuicoes/:id", autenticacao, redistribuicoesEditar, express.json(), asyncHandler(redistribuicoesController.atualizar));
cadastrosRoutes.delete("/redistribuicoes/:id", autenticacao, redistribuicoesEditar, asyncHandler(redistribuicoesController.excluir));

// Os percentuais fixos das regras de rateio e a verificação das vigências (14/10/2026; na tela Regras de Rateio).
cadastrosRoutes.get("/regras-rateio/percentuais-fixos", autenticacao, verificarPermissao("cadastro_controladoria.regras_rateio:ler"), asyncHandler(percentuaisFixosController.listar));
cadastrosRoutes.put("/regras-rateio/percentuais-fixos", autenticacao, verificarPermissao("cadastro_controladoria.regras_rateio:editar"), express.json(), asyncHandler(percentuaisFixosController.gravar));
cadastrosRoutes.delete("/regras-rateio/percentuais-fixos", autenticacao, verificarPermissao("cadastro_controladoria.regras_rateio:editar"), asyncHandler(percentuaisFixosController.excluir));
cadastrosRoutes.get("/regras-rateio/verificacao", autenticacao, verificarPermissao("cadastro_controladoria.regras_rateio:ler"), asyncHandler(percentuaisFixosController.verificacao));
