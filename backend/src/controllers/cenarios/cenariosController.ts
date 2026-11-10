import type { Request, Response } from "express";
import { auditar } from "../../services/auditoriaService.js";
import { exportacaoCenarioService, type EscopoCentrosDoCenario, type EscopoResultadosDoCenario } from "../../services/cenarios/exportacaoCenario.js";
import { temPermissao } from "../../middlewares/verificarPermissao.js";
import { ABA_DA_VISAO } from "../../services/acesso/telas.js";
import { z } from "zod";

import { CODIGO_ADMINISTRADOR } from "../../services/acesso/acesso.js";
import { ABA_DA_PERMISSAO, CenarioError, cenariosService } from "../../services/cenarios/cenariosService.js";
import { abaDaChave, ABAS_DAS_PREMISSAS, DEPARTAMENTOS, NOME_DA_ABA, type AbaDasPremissas, type Departamento } from "../../services/cenarios/planilhaPremissas.js";

/** As abas das premissas que o perfil lê ou edita (15/10/2026: a planilha das premissas). */
const abasDasPremissas = (request: Request, response: Response, acao: "ler" | "editar") => {
  const base = String(response.locals.areaDoCenario ?? "cenarios_analiticos");
  return ABAS_DAS_PREMISSAS.filter((a) => temPermissao(request, `${base}_premissas.${ABA_DA_PERMISSAO[a]}:${acao}`));
};

const idSchema = z.string().uuid();
const nomeSchema = z.string().trim().min(1, "Dê um nome ao cenário.").max(120);
const descricaoSchema = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((d) => d || null);
const anoSchema = z.coerce.number().int().min(2020).max(2100);
const visaoSchema = z.coerce.number().int().min(0).max(5);
const marcacaoSchema = z.enum(["ORCAMENTO_EMPRESARIAL", "RESULTADOS_ANTERIORES", "RESULTADOS_VENDIDOS", "PREVISAO"]).nullable();
const visualizacaoSchema = z.enum(["PARTICULAR", "PUBLICA"]).optional();
const tipoSchema = z.enum(["SINTETICO", "ANALITICO"]);
/** Um mês de uma linha do Quadro de Lotação dos analíticos (09/11/2026): os colaboradores e os salários de cada um. */
const mesDoQuadroSchema = z.object({
  colaboradores: z.number().finite().min(0, "Os colaboradores não podem ser negativos.").max(1e9),
  salarioBruto: z.number().finite().min(0, "O Salário Bruto não pode ser negativo.").max(1e9),
  adicional: z.number().finite().min(0, "A Insalubridade / Periculosidade não pode ser negativa.").max(1e9),
});
const linhaDoQuadroSchema = z.object({
  unidadeNegocioId: z.string().uuid("Escolha a unidade."),
  vinculo: z.enum(["CLT", "PJ"], { message: "O tipo é CLT ou PJ." }),
  senioridadeId: z.string().uuid("Escolha a senioridade."),
  funcaoId: z.string().uuid("Escolha a função."),
  centroCustoId: z.string().uuid("Escolha o centro de custo."),
});

/** Quem pede; o Administrador (Editar no Controle de Usuários) vê também os cenários particulares. */
const usuario = (request: Request) => ({ id: request.user!.sub, nome: request.user!.nome, admin: request.user!.perfil.codigo === CODIGO_ADMINISTRADOR });

/** Envia um arquivo exportado (14/10/2026), com a auditoria; os erros do cenário viram a resposta. */
async function enviarArquivo(request: Request, response: Response, gerar: () => Promise<{ nomeArquivo: string; tipo: string; conteudo: Uint8Array; visoes: string[] }>) {
  try {
    const r = await gerar();
    await auditar({
      usuarioId: request.user!.sub,
      usuarioNome: request.user!.nome,
      acao: "EXPORTACAO",
      entidade: "cenario",
      entidadeId: String(request.params.id),
      metadados: { formato: request.query.formato ?? "xlsx", escopo: request.query.escopo ?? "atual", visoes: r.visoes, arquivo: r.nomeArquivo },
    });
    response.setHeader("Content-Type", r.tipo);
    response.setHeader("Content-Disposition", `attachment; filename="${r.nomeArquivo.normalize("NFD").replace(/[^ -~]/g, "")}"; filename*=UTF-8''${encodeURIComponent(r.nomeArquivo)}`);
    return response.send(Buffer.from(r.conteudo));
  } catch (error) {
    if (error instanceof CenarioError) return response.status(error.status).json({ error: error.message });
    throw error;
  }
}

async function responder(response: Response, fn: () => Promise<unknown>, status = 200) {
  try {
    return response.status(status).json({ data: await fn() });
  } catch (error) {
    if (error instanceof CenarioError) return response.status(error.status).json({ error: error.message });
    throw error;
  }
}

/** O id da rota; sem ele válido, 400. */
function id(request: Request, response: Response) {
  const r = idSchema.safeParse(request.params.id);
  if (!r.success) response.status(400).json({ error: "Cenário inválido." });
  return r.success ? r.data : null;
}

const unidadeSchema = z.coerce.number().int().min(1).max(3);

export const cenariosController = {
  /** As premissas de uma unidade de um cenário analítico (?unidade=1 a 3). */
  premissas(request: Request, response: Response) {
    const c = id(request, response);
    if (!c) return;
    const u = unidadeSchema.safeParse(request.query.unidade);
    if (!u.success) return response.status(400).json({ error: "Unidade inválida." });
    return responder(response, () => cenariosService.premissas(c, u.data as 1 | 2 | 3, usuario(request)));
  },

  centros(request: Request, response: Response) {
    const c = id(request, response);
    return c ? responder(response, () => cenariosService.centros(c, usuario(request))) : undefined;
  },

  /**
   * A exportação da DRE do cenário (14/10/2026), como a de Resultados Empresariais: ?formato=xlsx|pdf e ?escopo=atual (a
   * visão de ?visao=0..5) ou unidades (as seis: pede a leitura de todas as abas da tela Resultados).
   */
  async exportar(request: Request, response: Response) {
    const c = id(request, response);
    if (!c) return;
    const formato = z.enum(["xlsx", "pdf"]).safeParse(request.query.formato);
    if (!formato.success) return response.status(400).json({ error: "Formato inválido: use xlsx ou pdf." });
    const base = String(response.locals.areaDoCenario ?? "cenarios");
    const le = (v: number) => temPermissao(request, `${base}_resultados.${ABA_DA_VISAO[v]}:ler`);
    let escopo: EscopoResultadosDoCenario;
    if (request.query.escopo === "unidades") {
      if (![0, 1, 2, 3, 4, 5].every(le)) return response.status(403).json({ error: "Exportar todas as unidades pede a leitura de todas as abas da tela Resultados." });
      escopo = { tipo: "unidades" };
    } else {
      const v = z.coerce.number().int().min(0).max(5).safeParse(request.query.visao ?? 0);
      if (!v.success) return response.status(400).json({ error: "Visão inválida." });
      if (!le(v.data)) return response.status(403).json({ error: "Sem permissão para esta aba." });
      escopo = { tipo: "visao", visao: v.data as 0 | 1 | 2 | 3 | 4 | 5 };
    }
    return enviarArquivo(request, response, () => exportacaoCenarioService.resultados(c, escopo, formato.data, usuario(request)));
  },

  /** Os centros de custo do cenário analítico em Excel (14/10/2026): ?escopo=atual (o ?grupo=), centros ou centros_arquivos. */
  async exportarCentros(request: Request, response: Response) {
    const c = id(request, response);
    if (!c) return;
    if (request.query.formato !== undefined && request.query.formato !== "xlsx") return response.status(400).json({ error: "Os centros de custo do cenário só saem em Excel." });
    const escopo = String(request.query.escopo ?? "atual");
    let e: EscopoCentrosDoCenario;
    if (escopo === "centros") e = { tipo: "centros" };
    else if (escopo === "centros_arquivos") e = { tipo: "centrosArquivos" };
    else {
      const grupo = z.string().trim().min(1).max(200).safeParse(request.query.grupo);
      if (!grupo.success) return response.status(400).json({ error: "Grupo de centros de custo inválido." });
      e = { tipo: "centro", grupo: grupo.data };
    }
    return enviarArquivo(request, response, () => exportacaoCenarioService.centros(c, e, usuario(request)));
  },

  /** Recalcula a DRE do cenário analítico com as regras de rateio de hoje (14/10/2026). */
  recalcular(request: Request, response: Response) {
    const c = id(request, response);
    return c ? responder(response, () => cenariosService.recalcular(c, usuario(request))) : undefined;
  },

  /** As contas de um grupo de centros (?grupo=, o nome da Controladoria). */
  centro(request: Request, response: Response) {
    const c = id(request, response);
    if (!c) return;
    const grupo = z.string().trim().min(1).max(200).safeParse(request.query.grupo);
    if (!grupo.success) return response.status(400).json({ error: "Grupo de centros de custo inválido." });
    return responder(response, () => cenariosService.centro(c, grupo.data, usuario(request)));
  },

  gravarCentro(request: Request, response: Response) {
    const c = id(request, response);
    if (!c) return;
    const corpo = z
      .object({
        grupo: z.string().trim().min(1).max(200),
        alteracoes: z.array(z.object({ linha: z.string().min(1).max(200), mes: z.number().int().min(1).max(12), valor: z.number().finite().nullable() })).min(1).max(5000),
        origem: z
          .object({ tipo: z.enum(["MARCADOS", "VALOR"]), modo: z.enum(["PERCENTUAL", "ABSOLUTO", "DIGITADO"]), reajuste: z.number().finite().nullable(), replicado: z.boolean() })
          .optional(),
      })
      .safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: corpo.error.issues[0]?.message ?? "Valores inválidos." });
    return responder(response, () => cenariosService.gravarCentro(c, corpo.data.grupo, corpo.data.alteracoes, usuario(request), corpo.data.origem));
  },

  investimentos(request: Request, response: Response) {
    const c = id(request, response);
    return c ? responder(response, () => cenariosService.investimentos(c, usuario(request))) : undefined;
  },

  extraOperacional(request: Request, response: Response) {
    const c = id(request, response);
    return c ? responder(response, () => cenariosService.extraOperacional(c, usuario(request))) : undefined;
  },

  /** Os valores mensais da Depreciação Base (tipo BASE) ou do Extra-Operacional (EXTRA). */
  gravarMensais(request: Request, response: Response) {
    const c = id(request, response);
    if (!c) return;
    const corpo = z
      .object({
        tipo: z.enum(["BASE", "EXTRA"]),
        alteracoes: z.array(z.object({ linha: z.string().min(1).max(200), mes: z.number().int().min(1).max(12), valor: z.number().finite().nullable() })).min(1).max(5000),
        origem: z
          .object({ tipo: z.enum(["MARCADOS", "VALOR"]), modo: z.enum(["PERCENTUAL", "ABSOLUTO", "DIGITADO"]), reajuste: z.number().finite().nullable(), replicado: z.boolean() })
          .optional(),
      })
      .safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: corpo.error.issues[0]?.message ?? "Valores inválidos." });
    return responder(response, () => cenariosService.gravarMensais(c, corpo.data.tipo, corpo.data.alteracoes, usuario(request), corpo.data.origem));
  },

  /** Novo investimento (POST), alteração (PUT /:investimentoId) ou exclusão (DELETE /:investimentoId). */
  gravarInvestimento(request: Request, response: Response) {
    const c = id(request, response);
    if (!c) return;
    const investimentoId = request.params.investimentoId ? idSchema.safeParse(request.params.investimentoId) : null;
    if (investimentoId && !investimentoId.success) return response.status(400).json({ error: "Investimento inválido." });
    if (request.method === "DELETE") return responder(response, () => cenariosService.gravarInvestimento(c, investimentoId!.data!, null, usuario(request)));
    const corpo = z
      .object({
        nomeReferencia: z.string().trim().min(1, "Dê um Nome de Referência ao investimento.").max(80),
        unidade: z.number().int().min(1).max(4),
        descricao: z.string().trim().min(1, "Descreva o investimento.").max(200),
        condicaoPagamento: z.string().trim().max(500).nullish().transform((x) => x || null),
        inicio: z.number().int().min(1).max(12),
        valorTotal: z.number().finite().positive("O valor total precisa ser maior que zero."),
        valorPosUso: z.number().finite().min(0),
        vidaUtil: z.number().int().min(1, "A vida útil é de pelo menos 1 mês.").max(600),
      })
      .safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: corpo.error.issues[0]?.message ?? "Investimento inválido." });
    return responder(response, () => cenariosService.gravarInvestimento(c, investimentoId?.data ?? null, corpo.data, usuario(request)), investimentoId ? 200 : 201);
  },

  /** O Excluir Selecionados dos investimentos (15/10/2026). */
  excluirInvestimentos(request: Request, response: Response) {
    const c = id(request, response);
    if (!c) return;
    const corpo = z.object({ ids: z.array(idSchema).min(1).max(2000) }).safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: "Escolha os investimentos a excluir." });
    return responder(response, () => cenariosService.excluirInvestimentos(c, corpo.data.ids, usuario(request)));
  },

  /** A aba Quadro de Lotação dos analíticos (09/11/2026, etapa 4 da Gestão de Colaboradores). */
  quadro(request: Request, response: Response) {
    const c = id(request, response);
    return c ? responder(response, () => cenariosService.quadro(c, usuario(request))) : undefined;
  },

  /** Nova linha do Quadro de Lotação (POST, com os doze meses), alteração dos cadastros dela (PUT /:linhaId) ou exclusão (DELETE /:linhaId). */
  gravarLinhaDoQuadro(request: Request, response: Response) {
    const c = id(request, response);
    if (!c) return;
    const linhaId = request.params.linhaId ? idSchema.safeParse(request.params.linhaId) : null;
    if (linhaId && !linhaId.success) return response.status(400).json({ error: "Linha do Quadro de Lotação inválida." });
    if (request.method === "DELETE") return responder(response, () => cenariosService.gravarLinhaDoQuadro(c, linhaId!.data!, null, usuario(request)));
    const corpo = linhaDoQuadroSchema.extend({ meses: z.array(mesDoQuadroSchema).length(12).optional() }).safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: corpo.error.issues[0]?.message ?? "Linha do Quadro de Lotação inválida." });
    return responder(response, () => cenariosService.gravarLinhaDoQuadro(c, linhaId?.data ?? null, corpo.data, usuario(request)), linhaId ? 200 : 201);
  },

  /** O Excluir Selecionados do Quadro de Lotação (09/11/2026). */
  excluirLinhasDoQuadro(request: Request, response: Response) {
    const c = id(request, response);
    if (!c) return;
    const corpo = z.object({ ids: z.array(idSchema).min(1).max(5000) }).safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: "Escolha as linhas a excluir." });
    return responder(response, () => cenariosService.excluirLinhasDoQuadro(c, corpo.data.ids, usuario(request)));
  },

  /** Os meses das linhas do Quadro de Lotação (a edição da tabela): os colaboradores, o Salário Bruto ou a Insalubridade / Periculosidade. */
  gravarMesesDoQuadro(request: Request, response: Response) {
    const c = id(request, response);
    if (!c) return;
    const corpo = z
      .object({
        alteracoes: z
          .array(z.object({ linha: idSchema, mes: z.number().int().min(1).max(12), campo: z.enum(["colaboradores", "salarioBruto", "adicional"]), valor: z.number().finite().nullable() }))
          .min(1)
          .max(60_000),
        origem: z
          .object({ tipo: z.enum(["MARCADOS", "VALOR"]), modo: z.enum(["PERCENTUAL", "ABSOLUTO", "DIGITADO"]), reajuste: z.number().finite().nullable(), replicado: z.boolean() })
          .optional(),
      })
      .safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: corpo.error.issues[0]?.message ?? "Valores inválidos." });
    return responder(response, () => cenariosService.gravarMesesDoQuadro(c, corpo.data.alteracoes, usuario(request), corpo.data.origem));
  },

  rateios(request: Request, response: Response) {
    const c = id(request, response);
    return c ? responder(response, () => cenariosService.rateios(c, usuario(request))) : undefined;
  },

  gravarPremissas(request: Request, response: Response) {
    const c = id(request, response);
    if (!c) return;
    const corpo = z
      .object({
        unidade: unidadeSchema,
        alteracoes: z
          .array(z.object({ venda: z.enum(["GLOBAL", "MERCANTIL"]), chave: z.string().min(1).max(200), mes: z.number().int().min(1).max(12), valor: z.number().finite().nullable() }))
          .min(1)
          .max(5000),
        origem: z
          .object({ tipo: z.enum(["MARCADOS", "VALOR"]), modo: z.enum(["PERCENTUAL", "ABSOLUTO", "DIGITADO"]), reajuste: z.number().finite().nullable(), replicado: z.boolean() })
          .optional(),
      })
      .safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: corpo.error.issues[0]?.message ?? "Premissas inválidas." });
    return responder(response, () => cenariosService.gravarPremissas(c, corpo.data.unidade as 1 | 2 | 3, corpo.data.alteracoes, usuario(request), corpo.data.origem));
  },

  /** A lista de um tipo (?tipo=SINTETICO, o padrão, ou ANALITICO). */
  listar(request: Request, response: Response) {
    const tipo = tipoSchema.default("SINTETICO").safeParse(request.query.tipo);
    if (!tipo.success) return response.status(400).json({ error: "Tipo de cenário inválido." });
    return responder(response, () => cenariosService.listar(usuario(request), tipo.data));
  },

  obter(request: Request, response: Response) {
    const c = id(request, response);
    return c ? responder(response, () => cenariosService.obter(c, usuario(request))) : undefined;
  },

  criar(request: Request, response: Response) {
    const corpo = z
      .object({ nome: nomeSchema, ano: anoSchema, descricao: descricaoSchema, copiarDe: idSchema.nullish().transform((x) => x ?? null), visualizacao: visualizacaoSchema, tipo: tipoSchema.default("SINTETICO") })
      .safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: corpo.error.issues[0]?.message ?? "Dados inválidos." });
    return responder(response, () => cenariosService.criar(corpo.data, usuario(request)), 201);
  },

  atualizar(request: Request, response: Response) {
    const c = id(request, response);
    if (!c) return;
    const corpo = z.object({ nome: nomeSchema, descricao: descricaoSchema, visualizacao: visualizacaoSchema }).safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: corpo.error.issues[0]?.message ?? "Dados inválidos." });
    return responder(response, () => cenariosService.atualizar(c, corpo.data, usuario(request)));
  },

  excluir(request: Request, response: Response) {
    const c = id(request, response);
    return c ? responder(response, () => cenariosService.excluir(c, usuario(request))) : undefined;
  },

  marcar(request: Request, response: Response) {
    const c = id(request, response);
    if (!c) return;
    const corpo = z.object({ marcacao: marcacaoSchema }).safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: "Marcação inválida." });
    return responder(response, () => cenariosService.marcar(c, corpo.data.marcacao, usuario(request)));
  },

  /** Replicar Médias / Apagar Valores (15/10/2026): em todas as abas das premissas, que o perfil precisa editar. */
  async replicarMedias(request: Request, response: Response) {
    const c = id(request, response);
    if (!c) return;
    const corpo = z.object({ acao: z.enum(["replicar", "apagar"]) }).safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: "Ação inválida." });
    const faltam = ABAS_DAS_PREMISSAS.filter((a) => !abasDasPremissas(request, response, "editar").includes(a));
    if (faltam.length) return response.status(403).json({ error: `Replicar Médias e Apagar Valores mexem em todas as abas das premissas: seu perfil não edita ${faltam.map((a) => NOME_DA_ABA[a]).join(", ")}.` });
    return responder(response, () => cenariosService.replicarMedias(c, corpo.data.acao, usuario(request)));
  },

  /** O Exportar Premissas (15/10/2026), só em Excel: ?escopo=atual (com ?aba=), todas, centros_abas ou centros_arquivos. */
  async exportarPremissas(request: Request, response: Response) {
    const c = id(request, response);
    if (!c) return;
    if (request.query.formato !== undefined && request.query.formato !== "xlsx") return response.status(400).json({ error: "As premissas só saem em Excel." });
    // Os departamentos (15/10/2026), separados por vírgula: PRODUCAO, SERVICOS, LOGISTICA, TECNICO, COMERCIAL, ADMINISTRATIVO e EXTRA.
    const q = z
      .object({
        escopo: z.enum(["todas", "centros_abas", "centros_arquivos"]).default("todas"),
        departamentos: z
          .string()
          .default(DEPARTAMENTOS.map((d) => d.chave).join(","))
          .transform((t) => t.split(",").filter(Boolean))
          .pipe(z.array(z.enum(DEPARTAMENTOS.map((d) => d.chave) as [Departamento, ...Departamento[]])).min(1)),
      })
      .safeParse(request.query);
    if (!q.success) return response.status(400).json({ error: "Escopo ou departamentos inválidos." });
    return enviarArquivo(request, response, () => cenariosService.exportarPremissas(c, q.data.escopo, q.data.departamentos, abasDasPremissas(request, response, "ler"), usuario(request)));
  },

  /** O Importar Valores, passo 1 (15/10/2026): o arquivo vai cru no corpo, com ?arquivo= (o nome). Devolve a análise de cada planilha. */
  async analisarPremissas(request: Request, response: Response) {
    const c = id(request, response);
    if (!c) return;
    const q = z.object({ arquivo: z.string().trim().min(1).max(255) }).safeParse(request.query);
    if (!q.success) return response.status(400).json({ error: "Dados inválidos." });
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) return response.status(400).json({ error: "O arquivo enviado está vazio." });
    const editaveis = abasDasPremissas(request, response, "editar");
    return responder(response, async () =>
      (await cenariosService.analisarPremissas(c, q.data.arquivo, new Uint8Array(request.body as Buffer), usuario(request))).map((r) => {
        // As abas que o perfil não edita recusam a planilha.
        const fora = r.abasDasPremissas.filter((a) => !editaveis.includes(a));
        return fora.length ? { ...r, valido: false, erros: [...r.erros, `Seu perfil não edita ${fora.map((a) => NOME_DA_ABA[a]).join(", ")}.`] } : r;
      }),
    );
  },

  /** O Importar Valores, passo 2 (15/10/2026; o usuário confirmou): as mudanças das planilhas analisadas e os investimentos. */
  async importarPremissas(request: Request, response: Response) {
    const c = id(request, response);
    if (!c) return;
    const investimento = z.object({
      nomeReferencia: z.string().trim().min(1).max(80),
      unidade: z.number().int().min(1).max(4),
      descricao: z.string().trim().min(1).max(200),
      condicaoPagamento: z.string().max(500).nullable(),
      inicio: z.number().int().min(1).max(12),
      valorTotal: z.number().finite().positive(),
      valorPosUso: z.number().finite().min(0),
      vidaUtil: z.number().int().min(1).max(600),
    });
    const corpo = z
      .object({
        arquivos: z
          .array(
            z.object({
              arquivo: z.string().min(1).max(400),
              alteracoes: z.array(z.object({ chave: z.string().min(1).max(400), mes: z.number().int().min(1).max(12), valor: z.number().finite().nullable() })).max(200_000),
              justificativas: z.array(z.object({ chave: z.string().min(1).max(400), texto: z.string().max(2000).nullable() })).max(50_000),
              investimentos: z.object({ novos: z.array(investimento).max(2000), alterados: z.array(investimento.extend({ id: idSchema })).max(2000) }).optional(),
              // O Quadro de Lotação (09/11/2026): as linhas novas e as alteradas (pelo Código da Linha), já conferidas na análise.
              quadro: z
                .object({
                  novas: z.array(linhaDoQuadroSchema.extend({ meses: z.array(mesDoQuadroSchema).length(12) })).max(5000),
                  alteradas: z.array(linhaDoQuadroSchema.extend({ id: idSchema, meses: z.array(mesDoQuadroSchema).length(12) })).max(5000),
                })
                .optional(),
            }),
          )
          .min(1)
          .max(200),
      })
      .safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: "Dados inválidos." });
    const editaveis = abasDasPremissas(request, response, "editar");
    const abas = new Set(corpo.data.arquivos.flatMap((a) => [...a.alteracoes, ...a.justificativas].map((x) => abaDaChave(x.chave))));
    if (corpo.data.arquivos.some((a) => (a.investimentos?.novos.length ?? 0) + (a.investimentos?.alterados.length ?? 0) > 0)) abas.add("investimentos");
    if (corpo.data.arquivos.some((a) => (a.quadro?.novas.length ?? 0) + (a.quadro?.alteradas.length ?? 0) > 0)) abas.add("quadro");
    if (abas.has(null)) return response.status(400).json({ error: "Há um Código de linha inválido." });
    const fora = [...abas].filter((a): a is AbaDasPremissas => !!a && !editaveis.includes(a));
    if (fora.length) return response.status(403).json({ error: `Seu perfil não edita ${fora.map((a) => NOME_DA_ABA[a]).join(", ")}.` });
    return responder(response, () => cenariosService.importarPremissas(c, corpo.data.arquivos, usuario(request)));
  },

  /** Importação, passo 1: o arquivo vai cru no corpo; ?nomeArquivo= e, para importar num cenário, ?cenarioId=. Devolve a prévia. */
  analisar(request: Request, response: Response) {
    const q = z.object({ nomeArquivo: z.string().trim().min(1).max(255), cenarioId: idSchema.optional() }).safeParse(request.query);
    if (!q.success) return response.status(400).json({ error: "Dados inválidos." });
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) return response.status(400).json({ error: "O arquivo enviado está vazio." });
    return responder(response, () => cenariosService.analisar({ cenarioId: q.data.cenarioId ?? null, nomeArquivo: q.data.nomeArquivo, conteudo: request.body as Buffer }, usuario(request)));
  },

  /** Importação, passo 2 (o usuário confirmou): o hash da prévia e o destino — o cenário ou o nome do novo. */
  importar(request: Request, response: Response) {
    const corpo = z
      .object({
        hash: z.string().regex(/^[0-9a-f]{64}$/),
        nomeArquivo: z.string().trim().min(1).max(255),
        cenarioId: idSchema.nullish(),
        nome: z.string().trim().max(120).nullish(),
        ano: anoSchema.nullish(),
        descricao: descricaoSchema,
        visualizacao: visualizacaoSchema,
      })
      .safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: "Dados inválidos." });
    const d = corpo.data;
    return responder(response, () =>
      cenariosService.importar({ hash: d.hash, nomeArquivo: d.nomeArquivo, cenarioId: d.cenarioId ?? null, nome: d.nome || null, ano: d.ano ?? null, descricao: d.descricao, visualizacao: d.visualizacao }, usuario(request)),
    );
  },

  resultados(request: Request, response: Response) {
    const c = id(request, response);
    if (!c) return;
    const visao = visaoSchema.safeParse(request.query.visao ?? 0);
    if (!visao.success) return response.status(400).json({ error: "Visão inválida." });
    return responder(response, () => cenariosService.resultados(c, visao.data as 0 | 1 | 2 | 3 | 4 | 5, usuario(request)));
  },

  /** O Painel de Bordo do cenário: ?ate=1..12 (dezembro, sem ele). */
  painel(request: Request, response: Response) {
    const c = id(request, response);
    if (!c) return;
    const ate = z.coerce.number().int().min(1).max(12).default(12).safeParse(request.query.ate);
    if (!ate.success) return response.status(400).json({ error: "Mês inválido." });
    // Só as abas permitidas (Resultados, Performance; 14/10/2026).
    const base = String(response.locals.areaDoCenario ?? "cenarios");
    return responder(response, async () => {
      const r = await cenariosService.painel(c, ate.data, usuario(request));
      return { ...r, abas: r.abas.filter((a) => request.user!.permissions.includes(`${base}_painel.${a.chave}:ler`)) };
    });
  },

  /**
   * Os indicadores do cenário, só os das abas permitidas (14/10/2026): a aba Indicadores do Painel de Bordo traz todos; a
   * dos Indicadores Manuais (Configurações, nos sintéticos; Premissas, nos analíticos), os manuais.
   */
  indicadores(request: Request, response: Response) {
    const c = id(request, response);
    if (!c) return;
    const base = String(response.locals.areaDoCenario ?? "cenarios");
    const tem = (p: string) => request.user!.permissions.includes(`${p}:ler`);
    // A aba Indicadores do Painel de Bordo traz todos; os Indicadores Manuais, a aba deles (19/10/2026: nos sintéticos, na
    // tela Configurações; nos analíticos, nas Premissas).
    const todas = tem(`${base}_painel.metas`);
    const resultados = todas;
    const manuais = todas || tem(`${base}_${base === "cenarios_analiticos" ? "premissas" : "configuracoes"}.manuais`);
    return responder(response, async () => {
      const r = await cenariosService.indicadores(c, usuario(request));
      return { ...r, indicadores: todas ? r.indicadores : r.indicadores.filter((i) => (i.classe === "MANUAL" ? manuais : i.classe === "RESULTADO" ? resultados : false)) };
    });
  },

  /** A visão da DRE para a edição: ?visao=0..5. */
  edicao(request: Request, response: Response) {
    const c = id(request, response);
    if (!c) return;
    const visao = visaoSchema.safeParse(request.query.visao ?? 0);
    if (!visao.success) return response.status(400).json({ error: "Visão inválida." });
    return responder(response, () => cenariosService.edicao(c, visao.data as 0 | 1 | 2 | 3 | 4 | 5, usuario(request)));
  },

  /** Valores mensais de contas de uma unidade: { visao: 1..5, alteracoes: [{ linha, mes, valor }] }. */
  gravarValores(request: Request, response: Response) {
    const c = id(request, response);
    if (!c) return;
    const corpo = z
      .object({
        visao: z.number().int().min(1).max(5),
        alteracoes: z.array(z.object({ linha: z.string().min(1).max(200), mes: z.number().int().min(1).max(12), valor: z.number().finite() })).min(1).max(5000),
        origem: z
          .object({
            tipo: z.enum(["MARCADOS", "VALOR"]),
            modo: z.enum(["PERCENTUAL", "ABSOLUTO", "DIGITADO"]),
            reajuste: z.number().finite().nullable(),
            replicado: z.boolean(),
          })
          .optional(),
      })
      .safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: "Valores inválidos." });
    return responder(response, () => cenariosService.gravarValores(c, corpo.data.visao, corpo.data.alteracoes, usuario(request), corpo.data.origem));
  },

  /** O histórico de reajustes do cenário. */
  reajustes(request: Request, response: Response) {
    const c = id(request, response);
    return c ? responder(response, () => cenariosService.reajustes(c, usuario(request))) : undefined;
  },

  /** A referência pelo resultado realizado: { ano, modo: MES_A_MES | MEDIA, de?, ate? } (as competências fechadas dele). */
  referenciaRealizado(request: Request, response: Response) {
    const c = id(request, response);
    if (!c) return;
    const corpo = z
      .object({ ano: anoSchema, modo: z.enum(["MES_A_MES", "MEDIA"]).default("MES_A_MES"), de: z.number().int().min(1).max(12).optional(), ate: z.number().int().min(1).max(12).optional() })
      .safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: "Exercício ou período inválido." });
    const { ano, ...opcoes } = corpo.data;
    return responder(response, () => cenariosService.referenciaRealizado(c, ano, usuario(request), opcoes));
  },

  /** A referência dos sintéticos por cenários e realizados (15/10/2026): uma ou duas partes, sem meses em comum. */
  referenciaComposta(request: Request, response: Response) {
    const c = id(request, response);
    if (!c) return;
    const mes = z.number().int().min(1).max(12);
    const parte = z.discriminatedUnion("tipo", [
      z.object({ tipo: z.literal("REALIZADO"), ano: anoSchema, modo: z.enum(["MES_A_MES", "MEDIA"]), de: mes.optional(), ate: mes.optional(), mesDe: mes, mesAte: mes }),
      z.object({ tipo: z.literal("CENARIO"), origemId: z.string().min(1), mesDe: mes, mesAte: mes }),
    ]);
    const corpo = z.object({ partes: z.array(parte).min(1).max(2) }).safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: "Referência inválida: escolha uma ou duas, com a origem e os meses de cada uma." });
    return responder(response, () => cenariosService.referenciaComposta(c, corpo.data.partes, usuario(request)));
  },

  /** Congelar Versão: trava o cenário. */
  congelarVersao(request: Request, response: Response) {
    const c = id(request, response);
    return c ? responder(response, () => cenariosService.congelarVersao(c, usuario(request))) : undefined;
  },

  /** Reabrir Versão: destrava a versão congelada. */
  reabrirVersao(request: Request, response: Response) {
    const c = id(request, response);
    return c ? responder(response, () => cenariosService.reabrirVersao(c, usuario(request))) : undefined;
  },

  /** Criar Revisão: a cópia da versão congelada numa versão nova, aberta para edição. */
  criarRevisao(request: Request, response: Response) {
    const c = id(request, response);
    return c ? responder(response, () => cenariosService.criarRevisao(c, usuario(request)), 201) : undefined;
  },

  /** O comparativo do cenário: o comparado, as opções e as variações máximas dos totais. */
  comparativo(request: Request, response: Response) {
    const c = id(request, response);
    return c ? responder(response, () => cenariosService.comparativo(c, usuario(request))) : undefined;
  },

  /** Grava o comparativo: { comparadoComId (nulo desliga), limites: { código do total: % ou nulo } }. */
  gravarComparativo(request: Request, response: Response) {
    const c = id(request, response);
    if (!c) return;
    const corpo = z
      .object({
        comparadoComId: idSchema.nullable(),
        // Nos sintéticos, a variação digitada; nos analíticos (19/10/2026), a chave do índice de cada conta.
        limites: z.record(z.string(), z.number().finite().min(0, "A variação máxima não pode ser negativa.").max(100000).nullable()).optional(),
        indices: z.record(z.string(), z.string().max(20).nullable()).optional(),
      })
      .safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: corpo.error.issues[0]?.message ?? "Comparativo inválido." });
    return responder(response, () => cenariosService.gravarComparativo(c, corpo.data, usuario(request)));
  },

  /** As realocações das movimentações fora dos padrões (14/10/2026): o grupo de centros de cada conta, ou nulo. */
  gravarRealocacoes(request: Request, response: Response) {
    const c = id(request, response);
    if (!c) return;
    const corpo = z.object({ decisoes: z.record(z.string().max(300), z.string().trim().min(1).max(200).nullable()) }).safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: "Realocações inválidas." });
    return responder(response, () => cenariosService.gravarRealocacoes(c, corpo.data.decisoes, usuario(request)));
  },

  /** Os Índices de Reajuste do cenário analítico (19/10/2026). */
  indices(request: Request, response: Response) {
    const c = id(request, response);
    return c ? responder(response, () => cenariosService.indices(c, usuario(request))) : undefined;
  },

  /** Grava a lista dos Índices de Reajuste: { indices: [{ chave?, descricao, observacao?, variacao (%) }] }. */
  gravarIndices(request: Request, response: Response) {
    const c = id(request, response);
    if (!c) return;
    const corpo = z
      .object({
        indices: z
          .array(
            z.object({
              chave: z.string().max(20).nullable().optional(),
              descricao: z.string().trim().min(1, "Toda linha precisa da descrição.").max(120),
              observacao: z.string().max(500).nullable().optional(),
              variacao: z.number().finite().min(0, "A variação máxima não pode ser negativa.").max(100000),
            }),
          )
          .max(200),
      })
      .safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: corpo.error.issues[0]?.message ?? "Índices inválidos." });
    return responder(response, () => cenariosService.gravarIndices(c, corpo.data.indices, usuario(request)));
  },

  /** As contas acima da variação máxima do comparativo, por visão, com as justificativas. */
  justificativas(request: Request, response: Response) {
    const c = id(request, response);
    return c ? responder(response, () => cenariosService.justificativas(c, usuario(request))) : undefined;
  },

  /** Grava a justificativa: { visao, linha (código), texto } (o texto vazio apaga). */
  gravarJustificativa(request: Request, response: Response) {
    const c = id(request, response);
    if (!c) return;
    const corpo = z.object({ visao: visaoSchema, linha: z.string().min(1).max(200), texto: z.string().trim().max(2000) }).safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: "Justificativa inválida." });
    return responder(response, () => cenariosService.gravarJustificativa(c, corpo.data, usuario(request)));
  },

  referenciaCenario(request: Request, response: Response) {
    const corpo = z.object({ origemId: z.string().min(1) }).safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ message: "Escolha o cenário de referência." });
    return responder(response, () => cenariosService.referenciaCenario(String(request.params.id), corpo.data.origemId, usuario(request)));
  },

  correspondencias(_request: Request, response: Response) {
    return responder(response, () => cenariosService.correspondencias());
  },

  gravarCorrespondencias(request: Request, response: Response) {
    const corpo = z
      .object({ itens: z.array(z.object({ filial: z.number().int().nullable(), tarefa: z.string().max(120), linha: z.string().min(1) })).max(500) })
      .safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ message: "Correspondência inválida." });
    return responder(response, () => cenariosService.gravarCorrespondencias(corpo.data.itens, usuario(request)));
  },

  salvarManual(request: Request, response: Response) {
    const c = id(request, response);
    if (!c) return;
    const corpo = z.object({ nome: z.string().trim().min(1).max(200), valores: z.array(z.number().finite().nullable()).length(12) }).safeParse(request.body);
    if (!corpo.success) return response.status(400).json({ error: "Valores inválidos." });
    return responder(response, () => cenariosService.salvarManual(c, corpo.data.nome, corpo.data.valores, usuario(request)));
  },
};
