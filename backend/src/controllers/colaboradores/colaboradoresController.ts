import type { Request, Response } from "express";
import { z } from "zod";

import {
  ImportacaoColaboradoresError,
  importacaoColaboradoresService,
  TIPOS_IMPORTACAO_COLABORADORES,
  type TipoImportacaoColaboradores,
} from "../../services/colaboradores/importacaoCadastros.js";
import { QuadroError, quadroService } from "../../services/colaboradores/quadroService.js";
import { apuracaoDoQuadroService, type TipoApurado } from "../../services/colaboradores/apuracaoDoQuadro.js";
import { comparacaoDoQuadroService, MARCACOES_COMPARAVEIS } from "../../services/colaboradores/comparacaoDoQuadro.js";
import type { MarcacaoCenario } from "../../generated/prisma/enums.js";

const TIPOS_APURADOS: TipoApurado[] = ["INDICADORES_ADMIN", "QUADRO_LOTACAO"];
const tipoApurado = (request: Request) => {
  const t = String(request.params.tipo) as TipoApurado;
  return TIPOS_APURADOS.includes(t) ? t : null;
};

const quem = (request: Request) => ({ id: request.user!.sub, nome: request.user!.nome ?? null });
/** O erro de regra do Quadro de Lotação vira a resposta; os demais seguem para o tratamento geral. */
const responder = async (response: Response, fazer: () => Promise<unknown>, status = 200) => {
  try {
    const data = await fazer();
    return response.status(status).json({ data: data ?? null });
  } catch (error) {
    if (error instanceof QuadroError) return response.status(error.status).json({ error: error.message });
    throw error;
  }
};
const anoMes = (request: Request) => String(request.params.anoMes);
/** A marcação do cenário da Comparação (09/11/2026; ?comparacao=): undefined sem ela ou inválida. */
const marcacao = (request: Request) => {
  const m = String(request.query.comparacao ?? "") as MarcacaoCenario;
  return MARCACOES_COMPARAVEIS.includes(m) ? m : undefined;
};
const novaMovimentacao = z.object({
  tipoMovimentacaoId: z.string().min(1),
  classificacaoId: z.string().nullish(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  centroCustoId: z.string().min(1),
  vinculo: z.enum(["CLT", "PJ"]),
  funcaoId: z.string().min(1),
  senioridadeId: z.string().min(1),
  motivo: z.string().max(1000).nullish(),
  origem: z.enum(["INICIATIVA_EMPRESA", "PEDIDO_COLABORADOR"]).nullish(),
  gerarVaga: z.boolean().optional(),
});

/** A Gestão de Colaboradores (06/11/2026): as importações dos Cadastros, o Quadro de Lotação e o Painel de Bordo. */
export const colaboradoresController = {
  competencias: (_request: Request, response: Response) => responder(response, () => quadroService.competencias()),
  abrirCompetencia: (request: Request, response: Response) => {
    const corpo = z.object({ ano: z.number().int(), mes: z.number().int() }).safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: "Informe o mês e o ano." });
    return responder(response, () => quadroService.abrir(corpo.data.ano, corpo.data.mes, quem(request)), 201);
  },
  fecharCompetencia: (request: Request, response: Response) => responder(response, () => quadroService.fechar(anoMes(request), quem(request))),
  reabrirCompetencia: (request: Request, response: Response) => responder(response, () => quadroService.reabrir(anoMes(request), quem(request))),
  excluirCompetencia: (request: Request, response: Response) => responder(response, () => quadroService.excluir(anoMes(request), quem(request))),
  opcoes: (_request: Request, response: Response) => responder(response, () => quadroService.opcoes()),
  movimentacoes: (request: Request, response: Response) => responder(response, () => quadroService.movimentacoes(anoMes(request), request.user!.acesso)),
  registrar: (request: Request, response: Response) => {
    const corpo = novaMovimentacao.safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: "Preencha a movimentação: tipo, data, centro de custo, tipo (CLT ou PJ), função e nível." });
    return responder(response, () => quadroService.registrar(anoMes(request), corpo.data, quem(request)), 201);
  },
  excluirMovimentacao: (request: Request, response: Response) => responder(response, () => quadroService.excluirMovimentacao(String(request.params.id), quem(request))),
  controle: (request: Request, response: Response) => responder(response, () => quadroService.controle(anoMes(request), request.user!.acesso)),
  decidir: (request: Request, response: Response) => {
    const corpo = z.object({ aprovar: z.boolean(), justificativa: z.string().max(1000).nullish() }).safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: "Informe a decisão." });
    return responder(response, () => quadroService.decidir(String(request.params.id), corpo.data.aprovar, corpo.data.justificativa ?? null, quem(request), request.user!.acesso));
  },
  realizado: (request: Request, response: Response) => responder(response, () => quadroService.realizado(anoMes(request), request.user!.acesso, marcacao(request))),
  // A Comparação (09/11/2026, etapa 4): os cenários marcados e, com ?comparacao=, os indicadores do cenário mês a mês.
  comparacao: (request: Request, response: Response) =>
    responder(response, async () => {
      const m = marcacao(request);
      return { opcoes: await comparacaoDoQuadroService.opcoes(), comparado: m ? await comparacaoDoQuadroService.doCenario(m) : null };
    }),
  // O Apurar das Importações (06/11/2026, etapa 3): a prévia, a gravação e a lupa de um indicador apurado.
  previaApuracao: (request: Request, response: Response) => {
    const tipo = tipoApurado(request);
    if (!tipo) return response.status(400).json({ error: "Tipo sem apuração." });
    return responder(response, () => apuracaoDoQuadroService.previa(anoMes(request), tipo));
  },
  gravarApuracao: (request: Request, response: Response) => {
    const tipo = tipoApurado(request);
    if (!tipo) return response.status(400).json({ error: "Tipo sem apuração." });
    return responder(response, () => apuracaoDoQuadroService.gravar(anoMes(request), tipo, quem(request)));
  },
  movimentosDoMes: (request: Request, response: Response) => responder(response, () => apuracaoDoQuadroService.movimentos(anoMes(request))),
  painel: (request: Request, response: Response) => {
    const ano = Number(request.query.ano) || new Date().getFullYear();
    return responder(response, () => quadroService.painel(ano));
  },

  /** A importação da planilha de Funções ou do Lançamento Inicial: a prévia, ou (gravar=1) a importação. */
  async importar(request: Request, response: Response) {
    const tipo = String(request.params.tipo) as TipoImportacaoColaboradores;
    const query = z
      .object({ nomeArquivo: z.string().trim().min(1).max(255), competencia: z.string().optional(), gravar: z.enum(["0", "1"]).optional() })
      .safeParse(request.query);
    if (!TIPOS_IMPORTACAO_COLABORADORES.includes(tipo) || !query.success) return response.status(400).json({ error: "Informe o nome do arquivo." });
    if (!Buffer.isBuffer(request.body)) return response.status(400).json({ error: "Envie o arquivo no corpo da requisição." });
    try {
      const data = await importacaoColaboradoresService.importar({
        tipo,
        nomeArquivo: query.data.nomeArquivo,
        competencia: query.data.competencia,
        conteudo: request.body,
        gravar: query.data.gravar === "1",
        usuarioId: request.user!.sub,
      });
      return response.json({ data });
    } catch (error) {
      if (error instanceof ImportacaoColaboradoresError) return response.status(error.status).json({ error: error.message });
      throw error;
    }
  },
};
