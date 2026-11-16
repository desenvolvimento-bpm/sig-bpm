import { getPrismaClient } from "../../config/prisma.js";
import { Prisma, type TipoImportacao } from "../../generated/prisma/client.js";
import { classificacaoService, VALIDACOES_PENDENTES } from "../classificacao/classificacaoService.js";
import { dreService } from "../dre/dreService.js";
import { estoqueService } from "../estoque/estoqueService.js";
import { receitaPreviaService } from "../receitaPrevia/receitaPreviaService.js";
import { rateiosService } from "../volumes/rateiosService.js";
import { resultadosLinhaService } from "../resultadosLinha/resultadosLinhaService.js";
import { auditar } from "../auditoriaService.js";
import { divergenciasService } from "../divergencias/divergenciasService.js";
import { assinaturaDosCadastros, cadastrosMudados, fraseDosCadastros } from "./assinaturaCadastros.js";
import { TIPOS_FORA_DA_APURACAO } from "../importacoes/indicadores/leituraIndicadores.js";
import { SEM_REGISTROS_NO_MES } from "../importacoes/listas/processarLista.js";
import { plural } from "../../utils/plural.js";
import { chavesSemRegra, regrasDeRateio } from "../volumes/vigenciaDosRateios.js";
import { NOME_DA_CHAVE as NOME_DA_CHAVE_RATEIO } from "../volumes/rateiosService.js";

/**
 * Apuração congelada, fechamento e reabertura da competência (Passo 21).
 *
 * Apurar a competência refaz, em ordem, tudo o que forma o resultado do mês —
 * a classificação dos lançamentos, o saldo de estoque, a receita prévia, os
 * rateios, a DRE e as linhas (26/10/2026) — e congela o retrato: a partir daí, nenhum recálculo avulso
 * (reclassificar, apurar só os rateios…) nem a recarga de um cadastro mexe nos
 * valores do mês. Só a reapuração da competência, enquanto ela está aberta ou
 * em conferência, os refaz; depois do fechamento, só a reabertura com
 * justificativa volta a permiti-la.
 *
 * A apuração guarda também um retrato das entradas (contagens e somas dos
 * lançamentos, das listas e das importações ativas). Se uma entrada mudar
 * depois — uma lista reimportada, um lançamento manual corrigido —, os valores
 * continuam congelados, e a competência passa a acusar a mudança até ser
 * reapurada; fechar exige que não haja nenhuma.
 */

export class RegraApuracaoError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

const rotulo = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;
const anterior = (ano: number, mes: number) => (mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 });

async function competenciaPorAnoMes(ano: number, mes: number) {
  const c = await getPrismaClient().competencia.findUnique({
    where: { ano_mes: { ano, mes } },
    select: { id: true, status: true, apuradaEm: true, apuracoes: true, entradasApuradas: true, cadastrosAssinatura: true, fechadaEm: true, fechadaPor: true, apuracaoLinhas: true },
  });
  if (!c) throw new RegraApuracaoError(404, `A competência ${rotulo(ano, mes)} não existe.`);
  return c;
}

/** As entradas da competência que, mudando, desatualizam a apuração. */
type Retrato = Record<string, { rotulo: string; n: number; soma: string; ultima?: string | null }>;

/** O retrato das entradas da apuração (exportado em 15/10/2026: a troca do balancete detalhado nos meses apurados). */
/**
 * As listas obrigatórias para fechar (17/10/2026): os arquivos de todo mês, na ordem da aba Em Vigor das Importações. A
 * DRE do Comercial e o saldo inicial do estoque são opcionais. A regra vale para todo fechamento daqui em diante; o que
 * já está fechado fica como está.
 */
const LISTAS_OBRIGATORIAS: Array<[TipoImportacao, string]> = [
  ["BALANCETE", "Balancete"],
  ["PROJETO", "Projetos"],
  ["PRODUCAO", "Produção (m³)"],
  ["PRODUCAO_PISTA", "Produção (pistas)"],
  ["PRODUCAO_ARMADURA", "Armadura"],
  ["PRODUCAO_METALURGIA", "Metalurgia"],
  ["EXPEDICAO", "Expedição"],
  ["MONTAGEM", "Montagem"],
  ["ACOMPANHAMENTO", "Acompanhamento"],
  ["MEDICAO", "Medições"],
  ["DEVOLUCAO", "Devoluções"],
  ["SAIDA", "Saídas"],
  // 19/10/2026: o quadro de lotação por centro de custo (JAN–AGO/2026 entraram pela carga retroativa).
  ["QUADRO_LOTACAO", "Quadro de Lotação"],
  ["INDICADORES_ADMIN", "Indicadores do Administrativo"],
  ["INDICADORES_COMERCIAL", "Indicadores do Comercial"],
];

/**
 * As listas obrigatórias sem importação em vigor na competência (concluída, não substituída, não só de comparação). O
 * arquivo recusado por não ter registros no mês (o mês sem movimento daquela lista) conta como entregue.
 */
async function listasQueFaltam(competenciaId: string) {
  const vigentes = await getPrismaClient().importacao.findMany({
    where: {
      competenciaId,
      comparacao: false,
      tipo: { in: LISTAS_OBRIGATORIAS.map(([t]) => t) },
      OR: [{ status: "CONCLUIDA", substituidaEm: null }, { status: "REJEITADA", motivoRejeicao: { contains: SEM_REGISTROS_NO_MES } }],
    },
    select: { tipo: true },
    distinct: ["tipo"],
  });
  const tem = new Set(vigentes.map((v) => v.tipo));
  return LISTAS_OBRIGATORIAS.filter(([t]) => !tem.has(t)).map(([, nome]) => nome);
}

export async function retratoEntradas(competenciaId: string): Promise<Retrato> {
  const prisma = getPrismaClient();
  const where = { competenciaId };
  const q = (x: Prisma.Decimal | null | undefined) => (x ?? new Prisma.Decimal(0)).toFixed(4);
  const d = (x: Date | null | undefined) => x?.toISOString() ?? null;
  // As contestações corrigidas no balancete (27/10/2026) mudam o centro e a conta dos lançamentos: a última mudança da
  // correção de um movimento da competência (a validação ou o desfazer) entra na data dos lançamentos do balancete (assim
  // também pede reapurar o mês apurado antes delas existirem).
  const contestadas = await prisma.contestacaoMovimento
    .aggregate({ where: { competenciaId, corrigidoEm: { not: null } }, _count: true, _max: { corrigidoEm: true } })
    .then((a) => ({ _count: a._count, _max: { validadaEm: a._max.corrigidoEm } }));
  const [contabeis, manuais, receita, importacoes, documentos, ...listas] = await Promise.all([
    prisma.lancamentoContabil.aggregate({ where, _count: true, _sum: { valorMovimento: true }, _max: { criadoEm: true } }),
    prisma.lancamentoManual.aggregate({ where, _count: true, _sum: { valor: true }, _max: { atualizadoEm: true } }),
    prisma.lancamentoReceita.aggregate({ where, _count: true, _sum: { valor: true }, _max: { atualizadoEm: true } }),
    // Os indicadores importados não entram na apuração: não contam como mudança.
    prisma.importacao.findMany({
      where: { ...where, status: "CONCLUIDA", substituidaEm: null, comparacao: false, tipo: { notIn: TIPOS_FORA_DA_APURACAO } },
      select: { id: true },
      orderBy: { id: "asc" },
    }),
    // As requisições e as notas fiscais (26/10/2026): a tarefa delas leva os custos às linhas (a etapa Linhas). As
    // apurações de antes não as têm no retrato: não acusam mudança.
    prisma.importacao.findMany({
      where: { ...where, status: "CONCLUIDA", substituidaEm: null, comparacao: false, tipo: { in: ["REQUISICOES", "NOTAS_FISCAIS"] } },
      select: { id: true, linhasAceitas: true },
      orderBy: { id: "asc" },
    }),
    prisma.projeto.aggregate({ where, _count: true, _sum: { quantidade: true }, _max: { atualizadoEm: true } }),
    prisma.producao.aggregate({ where, _count: true, _sum: { quantidade: true }, _max: { atualizadoEm: true } }),
    prisma.producaoPista.aggregate({ where, _count: true, _sum: { quantidade: true }, _max: { atualizadoEm: true } }),
    prisma.producaoArmadura.aggregate({ where, _count: true, _sum: { quantidade: true }, _max: { atualizadoEm: true } }),
    prisma.producaoMetalurgia.aggregate({ where, _count: true, _sum: { quantidade: true }, _max: { atualizadoEm: true } }),
    prisma.expedicao.aggregate({ where, _count: true, _sum: { quantidade: true }, _max: { atualizadoEm: true } }),
    prisma.montagem.aggregate({ where, _count: true, _sum: { quantidade: true }, _max: { atualizadoEm: true } }),
    prisma.acompanhamento.aggregate({ where, _count: true, _sum: { quantidade: true }, _max: { atualizadoEm: true } }),
    prisma.medicao.aggregate({ where, _count: true, _sum: { quantidade: true }, _max: { criadoEm: true } }),
    prisma.devolucao.aggregate({ where, _count: true, _sum: { valor: true }, _max: { criadoEm: true } }),
    prisma.saida.aggregate({ where, _count: true, _sum: { valor: true }, _max: { criadoEm: true } }),
  ]);
  const NOMES = ["projetos", "produção (m³)", "produção (pistas)", "produção de armadura", "produção da metalurgia", "expedição", "montagem", "acompanhamentos", "medições", "devoluções", "saídas"];
  const r: Retrato = {
    contabeis: {
      rotulo: "lançamentos do balancete",
      n: contabeis._count,
      soma: q(contabeis._sum.valorMovimento),
      ultima: d(
        contestadas._count && contestadas._max.validadaEm && (!contabeis._max.criadoEm || contestadas._max.validadaEm > contabeis._max.criadoEm)
          ? contestadas._max.validadaEm
          : contabeis._max.criadoEm,
      ),
    },
    manuais: { rotulo: "lançamentos manuais", n: manuais._count, soma: q(manuais._sum.valor), ultima: d(manuais._max.atualizadoEm) },
    receita: { rotulo: "lançamentos de receita", n: receita._count, soma: q(receita._sum.valor), ultima: d(receita._max.atualizadoEm) },
    importacoes: { rotulo: "importações", n: importacoes.length, soma: importacoes.map((i) => i.id).join(",") },
    documentos: { rotulo: "requisições e notas fiscais", n: documentos.reduce((s, i) => s + (i.linhasAceitas ?? 0), 0), soma: documentos.map((i) => i.id).join(",") },
  };
  // As listas de rateio guardam a última alteração (um registro digitado pode
  // mudar de unidade ou de etapa sem mudar a soma); as demais, só a criação.
  listas.forEach((a, i) => {
    const s = a._sum as { quantidade?: Prisma.Decimal | null; valor?: Prisma.Decimal | null };
    const m = a._max as { atualizadoEm?: Date | null; criadoEm?: Date | null };
    r[`lista${i}`] = { rotulo: `lista de ${NOMES[i]}`, n: a._count, soma: q(s.quantidade ?? s.valor), ultima: d(m.atualizadoEm ?? m.criadoEm) };
  });
  return r;
}

/**
 * Competências com apuração em andamento neste processo. Apurar, fechar e
 * reabrir a mesma competência ao mesmo tempo misturaria os retratos: um
 * fechamento no meio da reapuração, ou duas apurações intercaladas.
 */
const emApuracao = new Set<string>();
function exigirLivre(ano: number, mes: number) {
  if (emApuracao.has(`${ano}-${mes}`)) {
    throw new RegraApuracaoError(409, `A competência ${rotulo(ano, mes)} está sendo apurada agora. Espere terminar e tente de novo.`);
  }
}

/**
 * Por que a competência não se exclui (20/10/2026), ou null: só a mais recente, em aberto (não fechada), sem apuração
 * nem importação em andamento.
 */
async function motivoNaoExcluir(ano: number, mes: number, status: string, competenciaId: string): Promise<string | null> {
  const prisma = getPrismaClient();
  if (status === "FECHADA") return "A competência está fechada: só uma competência em aberto pode ser excluída.";
  const posterior = await prisma.competencia.findFirst({
    where: { OR: [{ ano: { gt: ano } }, { ano, mes: { gt: mes } }] },
    orderBy: [{ ano: "desc" }, { mes: "desc" }],
    select: { ano: true, mes: true },
  });
  if (posterior) return `Só a competência mais recente pode ser excluída (a mais recente é ${rotulo(posterior.ano, posterior.mes)}).`;
  if (emApuracao.has(`${ano}-${mes}`)) return `A competência ${rotulo(ano, mes)} está sendo apurada agora.`;
  if (await prisma.importacao.count({ where: { competenciaId, status: "PROCESSANDO" } })) return "Há uma importação em andamento na competência: espere terminar.";
  return null;
}

/**
 * As telas do mês sem nenhum valor (21/10/2026): o aviso do Fechar Competência (não impede o fechamento). As listas
 * obrigatórias e o balancete já têm regra própria; aqui, as que o mês pode ter vazias por esquecimento.
 */
async function telasSemValor(competenciaId: string): Promise<string[]> {
  const prisma = getPrismaClient();
  // A Receita (22/10/2026): a receita calculada das listas (as prévias) ou os ajustes manuais; antes, só os ajustes, que
  // são opcionais — e o mês com a receita calculada e sem ajuste dava o aviso.
  const [manuais, receitaCalculada, receitaManual, importados, digitados, estoque, conferencia, requisicoes, notas] = await Promise.all([
    prisma.lancamentoManual.count({ where: { competenciaId } }),
    prisma.receitaPrevia.count({ where: { competenciaId } }),
    prisma.lancamentoReceita.count({ where: { competenciaId } }),
    prisma.indicadorImportado.count({ where: { competenciaId } }),
    prisma.indicadorDigitado.count({ where: { competenciaId } }),
    prisma.estoqueSaldo.count({ where: { competenciaId } }),
    prisma.conferenciaPlanilha.count({ where: { competenciaId } }),
    prisma.requisicaoItem.count({ where: { competenciaId } }),
    prisma.notaFiscalItem.count({ where: { competenciaId } }),
  ]);
  return [
    // Sem os documentos, os custos vão às linhas sem a tarefa (26/10/2026: a etapa Linhas).
    requisicoes + notas ? null : "Importações (nenhuma requisição nem nota fiscal: os custos vão às linhas sem a tarefa)",
    manuais ? null : "Lançamentos (nenhum lançamento manual)",
    // As abas pelo caminho (27/10/2026): Receita e Estoque em Prévias, Indicadores em Totais.
    receitaCalculada + receitaManual ? null : "Prévias › Receita (nenhuma receita calculada nem ajuste manual)",
    importados + digitados ? null : "Totais › Indicadores (nenhum indicador importado ou digitado)",
    estoque ? null : "Prévias › Estoque (nenhum saldo)",
    conferencia ? null : "Conferência (a planilha não foi enviada)",
  ].filter((x): x is string => x !== null);
}

/** O que a exclusão leva junto (as contagens para a confirmação e a auditoria). */
async function paraExcluir(competenciaId: string) {
  const prisma = getPrismaClient();
  const [importacoes, lancamentos, manuais, divergencias] = await Promise.all([
    prisma.importacao.count({ where: { competenciaId } }),
    prisma.lancamentoContabil.count({ where: { competenciaId } }),
    prisma.lancamentoManual.count({ where: { competenciaId } }),
    prisma.divergencia.count({ where: { competenciaId } }),
  ]);
  return { importacoes, lancamentos, manuais, divergencias };
}

/** O que mudou nas entradas desde a apuração, em frases. */
function mudancas(apurado: Retrato | null, atual: Retrato): string[] {
  if (!apurado) return [];
  const m: string[] = [];
  for (const [k, a] of Object.entries(atual)) {
    const b = apurado[k];
    if (!b) continue;
    if (k === "importacoes") {
      if (a.soma !== b.soma) m.push("Houve importação depois da apuração.");
      continue;
    }
    if (a.n !== b.n || a.soma !== b.soma || (a.ultima ?? null) !== (b.ultima ?? null)) {
      m.push(`A ${a.rotulo.startsWith("lista") ? a.rotulo : `relação de ${a.rotulo}`} mudou depois da apuração (${b.n} → ${a.n} ${plural(a.n, "registro", "registros")}).`);
    }
  }
  return m;
}

/**
 * As competências anteriores a esta (de qualquer exercício) que estão
 * apuradas, não fechadas, e com as entradas (ou os Cadastros Gerais,
 * desde 17/10/2026) alterados depois da apuração — a bola da etapa DRE —, ou
 * com o mês anterior reapurado depois delas (o saldo inicial do estoque). Em
 * ordem, como "MM/AAAA".
 *
 * Apurar uma competência com uma anterior assim usaria o estoque e os saldos
 * de um mês que não reflete as próprias entradas (pedido de 09/10/2026): a
 * apuração é recusada até as anteriores serem reapuradas, em ordem. A fechada
 * fica de fora — não se reapura sem reabrir, e as entradas dela não mudam a
 * apuração.
 */
async function anterioresDesatualizadas(ano: number, mes: number): Promise<string[]> {
  const prisma = getPrismaClient();
  const todas = await prisma.competencia.findMany({
    where: { OR: [{ ano: { lt: ano } }, { ano, mes: { lt: mes } }] },
    select: { id: true, ano: true, mes: true, status: true, apuradaEm: true, entradasApuradas: true, cadastrosAssinatura: true },
    orderBy: [{ ano: "asc" }, { mes: "asc" }],
  });
  const cadastros = await assinaturaDosCadastros();
  const apuradaEm = new Map(todas.map((c) => [`${c.ano}-${c.mes}`, c.apuradaEm]));
  const desatualizadas: string[] = [];
  for (const c of todas) {
    if (!c.apuradaEm || c.status === "FECHADA") continue;
    const a = anterior(c.ano, c.mes);
    const antes = apuradaEm.get(`${a.ano}-${a.mes}`);
    const mudou =
      (antes && antes > c.apuradaEm) ||
      cadastrosMudados(c.cadastrosAssinatura, cadastros).length > 0 ||
      mudancas(c.entradasApuradas as Retrato | null, await retratoEntradas(c.id)).length > 0;
    if (mudou) desatualizadas.push(rotulo(c.ano, c.mes));
  }
  return desatualizadas;
}

/** A mensagem do bloqueio da apuração, ou null quando as anteriores estão em dia. */
function bloqueioDaApuracao(ano: number, mes: number, anteriores: string[]): string | null {
  if (anteriores.length === 0) return null;
  const lista = anteriores.length === 1 ? `a competência ${anteriores[0]}` : `as competências ${anteriores.slice(0, -1).join(", ")} e ${anteriores[anteriores.length - 1]}`;
  return `Não é possível apurar ${rotulo(ano, mes)}: ${lista} ${anteriores.length === 1 ? "tem" : "têm"} entradas ou cadastros alterados depois da apuração. Reapure ${anteriores.length === 1 ? "essa competência" : "essas competências, em ordem,"} antes.`;
}

/** Os quatro retratos da apuração: congela (ou descongela, para reapurar) todos de uma vez. */
async function congelar(competenciaId: string, congelado: boolean) {
  const prisma = getPrismaClient();
  const where = { competenciaId };
  await prisma.$transaction([
    prisma.resultadoApurado.updateMany({ where, data: { congelado } }),
    prisma.receitaPrevia.updateMany({ where, data: { congelado } }),
    prisma.volumeOperacional.updateMany({ where, data: { congelado } }),
    prisma.estoqueSaldo.updateMany({ where, data: { congelado } }),
  ]);
}

/**
 * As competências (apuradas, não fechadas) com a apuração para trás das
 * entradas — a bola da etapa DRE: entradas alteradas depois da apuração, ou o
 * mês anterior reapurado depois dela. Os ids.
 */
async function desatualizadas(competencias: { id: string; ano: number; mes: number; status: string; apuradaEm: Date | null }[]): Promise<Set<string>> {
  const prisma = getPrismaClient();
  const apuradaEm = new Map(competencias.map((c) => [`${c.ano}-${c.mes}`, c.apuradaEm]));
  const cadastros = await assinaturaDosCadastros();
  const r = new Set<string>();
  for (const c of competencias) {
    if (!c.apuradaEm || c.status === "FECHADA") continue;
    const { entradasApuradas, cadastrosAssinatura } = await prisma.competencia.findUniqueOrThrow({ where: { id: c.id }, select: { entradasApuradas: true, cadastrosAssinatura: true } });
    // Os Cadastros Gerais alterados depois da apuração (17/10/2026) também pedem reapurar.
    let desatualizada = cadastrosMudados(cadastrosAssinatura, cadastros).length > 0 || mudancas(entradasApuradas as Retrato | null, await retratoEntradas(c.id)).length > 0;
    // O mês anterior reapurado depois muda o saldo inicial do estoque (como na situação).
    const a = anterior(c.ano, c.mes);
    const antes = apuradaEm.has(`${a.ano}-${a.mes}`)
      ? apuradaEm.get(`${a.ano}-${a.mes}`)
      : (await prisma.competencia.findUnique({ where: { ano_mes: a }, select: { apuradaEm: true } }))?.apuradaEm;
    if (antes && antes > c.apuradaEm) desatualizada = true;
    if (desatualizada) r.add(c.id);
  }
  return r;
}

export const apuracaoService = {
  desatualizadas,

  /**
   * O andamento de cada competência, para a lista de competências: balancete
   * importado, lançamentos sem classificação ou com pendência, e se a apuração
   * ficou para trás das entradas (só nas não fechadas; a fechada não muda).
   */
  async andamento(competencias: { id: string; ano: number; mes: number; status: string; apuradaEm: Date | null }[]) {
    const prisma = getPrismaClient();
    const ids = competencias.map((c) => c.id);
    const [balancetes, lancamentos, pendentes, naoClassificados] = await Promise.all([
      prisma.importacao.findMany({
        where: { competenciaId: { in: ids }, tipo: "BALANCETE", status: "CONCLUIDA", substituidaEm: null, comparacao: false },
        select: { competenciaId: true },
      }),
      prisma.lancamentoContabil.groupBy({ by: ["competenciaId"], where: { competenciaId: { in: ids } }, _count: true }),
      prisma.lancamentoContabil.groupBy({ by: ["competenciaId"], where: { competenciaId: { in: ids }, validacao: { in: VALIDACOES_PENDENTES } }, _count: true }),
      prisma.lancamentoContabil.groupBy({ by: ["competenciaId"], where: { competenciaId: { in: ids }, classificadoEm: null }, _count: true }),
    ]);
    const conta = (g: { competenciaId: string; _count: number }[]) => new Map(g.map((x) => [x.competenciaId, x._count]));
    const [nLanc, nPend, nSem] = [conta(lancamentos), conta(pendentes), conta(naoClassificados)];
    const comBalancete = new Set(balancetes.map((b) => b.competenciaId));
    const atrasadas = await desatualizadas(competencias);

    const r = new Map<string, { balancete: boolean; lancamentos: number; pendencias: number; semClassificacao: number; desatualizada: boolean }>();
    for (const c of competencias) {
      r.set(c.id, { balancete: comBalancete.has(c.id), lancamentos: nLanc.get(c.id) ?? 0, pendencias: nPend.get(c.id) ?? 0, semClassificacao: nSem.get(c.id) ?? 0, desatualizada: atrasadas.has(c.id) });
    }
    return r;
  },

  /** A situação da competência: estado, apuração, o que mudou desde ela e o que falta para fechar. */
  async situacao(ano: number, mes: number) {
    const prisma = getPrismaClient();
    const c = await competenciaPorAnoMes(ano, mes);
    const a = anterior(ano, mes);
    const [detalhe, atual, pendentes, naoClassificados, reaberturas, mesAnterior, anteriores] = await Promise.all([
      prisma.competencia.findUniqueOrThrow({
        where: { id: c.id },
        select: { usuarioApuracao: { select: { nome: true } }, usuarioFechamento: { select: { nome: true } } },
      }),
      retratoEntradas(c.id),
      prisma.lancamentoContabil.count({ where: { competenciaId: c.id, validacao: { in: VALIDACOES_PENDENTES } } }),
      prisma.lancamentoContabil.count({ where: { competenciaId: c.id, classificadoEm: null } }),
      prisma.reaberturaCompetencia.findMany({
        where: { competenciaId: c.id },
        orderBy: { reabertaEm: "desc" },
        select: { justificativa: true, reabertaEm: true, fechamentoAnteriorEm: true, usuario: { select: { nome: true } } },
      }),
      prisma.competencia.findUnique({ where: { ano_mes: a }, select: { apuradaEm: true } }),
      c.status === "FECHADA" ? Promise.resolve([] as string[]) : anterioresDesatualizadas(ano, mes),
    ]);
    const apurada = c.apuradaEm !== null;
    const bloqueio = bloqueioDaApuracao(ano, mes, anteriores);
    const mudou = apurada ? mudancas(c.entradasApuradas as Retrato | null, atual) : [];
    // Algum Cadastro da Controladoria mudou depois da apuração, com a competência ainda aberta (17/10/2026): reapurar.
    const cadastros = apurada && c.status !== "FECHADA" ? cadastrosMudados(c.cadastrosAssinatura, await assinaturaDosCadastros()) : [];
    if (cadastros.length) mudou.push(fraseDosCadastros(cadastros));
    if (apurada && mesAnterior?.apuradaEm && mesAnterior.apuradaEm > c.apuradaEm!) {
      mudou.push(`A competência ${rotulo(a.ano, a.mes)} foi reapurada depois; o saldo inicial do estoque pode ter mudado.`);
    }
    const motivosNaoFechar: string[] = [];
    if (c.status === "FECHADA") motivosNaoFechar.push("A competência já está fechada.");
    if (!apurada) motivosNaoFechar.push("A competência ainda não foi apurada.");
    // Os rateios sem regra vigente no mês (14/10/2026).
    const semRegra = chavesSemRegra(await regrasDeRateio(), ano, mes);
    if (semRegra.length) motivosNaoFechar.push(`Rateios sem regra vigente no mês: ${semRegra.map((k) => NOME_DA_CHAVE_RATEIO[k] ?? k).join(", ")} (Cadastros Gerais / Regras de Rateio).`);
    if (mudou.length) motivosNaoFechar.push("As entradas ou os Cadastros Gerais mudaram depois da apuração: reapure antes de fechar.");
    // A etapa Linhas (26/10/2026): o mês apurado antes dela fecha só depois de reapurado, com as linhas gravadas.
    else if (apurada && c.status !== "FECHADA" && c.apuracaoLinhas === null) motivosNaoFechar.push("A competência foi apurada antes da etapa Linhas: reapure antes de fechar.");
    if (pendentes) motivosNaoFechar.push(`Há ${pendentes} ${plural(pendentes, "lançamento", "lançamentos")} com pendência de classificação.`);
    if (naoClassificados) motivosNaoFechar.push(`Há ${naoClassificados} ${plural(naoClassificados, "lançamento", "lançamentos")} sem classificação.`);
    // Todas as listas obrigatórias importadas (17/10/2026; a DRE do Comercial e o saldo inicial do estoque são opcionais).
    const faltam = c.status === "FECHADA" ? [] : await listasQueFaltam(c.id);
    if (faltam.length) {
      motivosNaoFechar.push(
        faltam.length === 1
          ? `Falta importar a lista ${faltam[0]} (Importações / Em Vigor).`
          : `Faltam importar ${faltam.length} listas: ${faltam.join(", ")} (Importações / Em Vigor).`,
      );
    }
    // Fecha-se em ordem (11/10/2026): com uma competência anterior em aberto, esta não se fecha.
    if (c.status !== "FECHADA") {
      const abertas = await getPrismaClient().competencia.findMany({
        where: { status: { not: "FECHADA" }, OR: [{ ano: { lt: ano } }, { ano, mes: { lt: mes } }] },
        select: { ano: true, mes: true },
        orderBy: [{ ano: "asc" }, { mes: "asc" }],
      });
      if (abertas.length) {
        const lista = abertas.map((x) => rotulo(x.ano, x.mes));
        motivosNaoFechar.push(
          abertas.length === 1
            ? `A competência anterior ${lista[0]} está em aberto: feche-a antes.`
            : `As competências anteriores ${lista.join(", ")} estão em aberto: feche-as antes, em ordem.`,
        );
      }
    }
    return {
      competencia: { ano, mes, status: c.status },
      apurada,
      apuradaEm: c.apuradaEm,
      apuradaPor: detalhe.usuarioApuracao?.nome ?? null,
      apuracoes: c.apuracoes,
      fechadaEm: c.fechadaEm,
      fechadaPor: detalhe.usuarioFechamento?.nome ?? null,
      mudancas: mudou,
      pendenciasClassificacao: pendentes,
      podeApurar: c.status !== "FECHADA",
      /** As competências anteriores com entradas alteradas depois da apuração: enquanto houver, esta não se apura. */
      anterioresDesatualizadas: anteriores,
      bloqueioApuracao: bloqueio,
      podeFechar: motivosNaoFechar.length === 0,
      motivosNaoFechar,
      podeReabrir: c.status === "FECHADA",
      reaberturas: reaberturas.map((r) => ({ justificativa: r.justificativa, reabertaEm: r.reabertaEm, reabertaPor: r.usuario.nome, fechamentoAnteriorEm: r.fechamentoAnteriorEm })),
      /** A exclusão da competência (20/10/2026): o motivo de não poder, ou null; e o que ela leva junto, para a confirmação. */
      motivoNaoExcluir: await motivoNaoExcluir(ano, mes, c.status, c.id),
      /** As telas do mês sem nenhum valor (21/10/2026): o aviso do Fechar Competência. */
      telasSemValor: c.status === "FECHADA" ? [] : await telasSemValor(c.id),
      paraExcluir: c.status === "FECHADA" ? null : await paraExcluir(c.id),
    };
  },

  /**
   * Exclui a competência (20/10/2026): só a mais recente e em aberto. Leva junto tudo o que é dela — as importações, os
   * lançamentos do balancete, as listas, os lançamentos manuais, o estoque, a receita prévia, os rateios, a DRE apurada,
   * as divergências e as reaberturas (as tabelas filhas apagam em cascata). Os arquivos importados ficam guardados (pelo
   * hash, podem servir a outros meses). Fica na auditoria, com as contagens.
   */
  async excluir(ano: number, mes: number, usuarioId: string) {
    const c = await competenciaPorAnoMes(ano, mes);
    const motivo = await motivoNaoExcluir(ano, mes, c.status, c.id);
    if (motivo) throw new RegraApuracaoError(409, motivo);
    const levou = await paraExcluir(c.id);
    await getPrismaClient().competencia.delete({ where: { id: c.id } });
    await auditar({
      usuarioId,
      acao: "EXCLUSAO",
      entidade: "competencia",
      entidadeId: c.id,
      antes: { status: c.status, apuradaEm: c.apuradaEm, apuracoes: c.apuracoes, ...levou },
      metadados: { competencia: rotulo(ano, mes) },
    });
    return { ano, mes, ...levou };
  },

  /**
   * Apura a competência inteira e congela o resultado. Recusa competência
   * fechada. Se uma etapa falhar, a competência fica sem apuração válida — o
   * retrato anterior já foi em parte refeito — e o erro diz em qual etapa parou.
   */
  async apurar(ano: number, mes: number, usuarioId: string) {
    const prisma = getPrismaClient();
    const c = await competenciaPorAnoMes(ano, mes);
    if (c.status === "FECHADA") throw new RegraApuracaoError(409, `A competência ${rotulo(ano, mes)} está fechada. Reapurar exige reabri-la.`);
    const bloqueio = bloqueioDaApuracao(ano, mes, await anterioresDesatualizadas(ano, mes));
    if (bloqueio) throw new RegraApuracaoError(409, bloqueio);
    exigirLivre(ano, mes);
    emApuracao.add(`${ano}-${mes}`);
    try {
      return await this.apurarSemTrava(c, ano, mes, usuarioId);
    } finally {
      emApuracao.delete(`${ano}-${mes}`);
    }
  },

  /** A apuração em si: chamada só por apurar(), com a trava da competência. */
  async apurarSemTrava(c: Awaited<ReturnType<typeof competenciaPorAnoMes>>, ano: number, mes: number, usuarioId: string) {
    const prisma = getPrismaClient();
    // O retrato das entradas é o do início: o que chegar durante a apuração (uma
    // lista que termina de importar na fila) não entrou no cálculo e tem de
    // aparecer como mudança depois dela.
    const retrato = await retratoEntradas(c.id);
    // Os Cadastros Gerais também (17/10/2026): mudar algum durante a apuração pede reapurar depois.
    const cadastros = await assinaturaDosCadastros(true);
    await congelar(c.id, false);
    const etapas: Array<{ etapa: string; resumo: unknown }> = [];
    const avisos: string[] = [];
    let etapa = "classificação";
    try {
      etapas.push({ etapa, resumo: await classificacaoService.classificarCompetencia(c.id) });
      etapa = "saldo de estoque";
      const e = await estoqueService.apurar(ano, mes);
      etapas.push({ etapa, resumo: e });
      avisos.push(...((e as { avisos?: string[] }).avisos ?? []));
      etapa = "receita prévia";
      const r = await receitaPreviaService.apurar(ano, mes);
      etapas.push({ etapa, resumo: r });
      avisos.push(...((r as { avisos?: string[] }).avisos ?? []));
      etapa = "rateios";
      const ra = await rateiosService.apurar(ano, mes);
      etapas.push({ etapa, resumo: ra });
      avisos.push(...ra.avisos);
      etapa = "DRE";
      const d = await dreService.apurar(ano, mes, usuarioId);
      etapas.push({ etapa, resumo: d });
      avisos.push(...d.avisos);
      // A DRE de cada unidade dividida entre as linhas (26/10/2026) e cada linha entre as obras (03/11/2026, o Realizado por
      // Obra): os avisos ficam na etapa Linhas do mês.
      etapa = "linhas";
      const l = await resultadosLinhaService.apurar(c.id);
      etapas.push({ etapa, resumo: { registros: l.registros, linhas: l.linhas, semLinha: l.semLinha, avisos: l.avisos.length, obras: l.obras.obras, semObra: l.obras.semObra } });
    } catch (e) {
      await prisma.competencia.update({ where: { id: c.id }, data: { apuradaEm: null, apuradaPor: null, entradasApuradas: Prisma.DbNull } });
      const msg = e instanceof Error ? e.message : String(e);
      await auditar({
        usuarioId,
        acao: "APURACAO",
        entidade: "competencia",
        entidadeId: c.id,
        antes: { status: c.status, apuradaEm: c.apuradaEm, apuracoes: c.apuracoes },
        depois: { status: c.status, apuradaEm: null },
        metadados: { competencia: rotulo(ano, mes), resultado: "interrompida", etapa, erro: msg },
      });
      throw new RegraApuracaoError(409, `A apuração de ${rotulo(ano, mes)} parou na etapa "${etapa}": ${msg} A competência ficou sem apuração válida; corrija e apure de novo.`);
    }

    await congelar(c.id, true);
    const agora = new Date();
    await prisma.competencia.update({
      where: { id: c.id },
      data: {
        apuradaEm: agora,
        apuradaPor: usuarioId,
        apuracoes: { increment: 1 },
        entradasApuradas: retrato as Prisma.InputJsonValue,
        // Os Cadastros Gerais na apuração (17/10/2026), para pedir reapurar se algum mudar antes de fechar.
        cadastrosAssinatura: JSON.stringify(cadastros),
        ...(c.status === "ABERTA" ? { status: "EM_CONFERENCIA" as const } : {}),
      },
    });
    // A receita foi refeita com os preços vigentes: as divergências de preço da competência se resolvem.
    const precosResolvidos = await divergenciasService.resolverPrecosPorReapuracao(c.id, usuarioId);
    await auditar({
      usuarioId,
      acao: "APURACAO",
      entidade: "competencia",
      entidadeId: c.id,
      antes: { status: c.status, apuradaEm: c.apuradaEm, apuracoes: c.apuracoes },
      depois: { status: c.status === "ABERTA" ? "EM_CONFERENCIA" : c.status, apuradaEm: agora, apuracoes: c.apuracoes + 1, divergenciasDePrecoResolvidas: precosResolvidos },
      metadados: { competencia: rotulo(ano, mes), resultado: "concluída", etapas: etapas.map((e) => e.etapa) },
    });
    return { apuradaEm: agora, apuracoes: c.apuracoes + 1, etapas: etapas.map((e) => e.etapa), avisos: [...new Set(avisos)] };
  },

  /** Fecha a competência: exige apuração em dia e nenhuma pendência de classificação. */
  async fechar(ano: number, mes: number, usuarioId: string) {
    exigirLivre(ano, mes);
    const s = await this.situacao(ano, mes);
    if (!s.podeFechar) throw new RegraApuracaoError(409, `A competência ${rotulo(ano, mes)} não pode ser fechada: ${s.motivosNaoFechar.join(" ")}`);
    const c = await competenciaPorAnoMes(ano, mes);
    const fechadaEm = new Date();
    await getPrismaClient().competencia.update({
      where: { id: c.id },
      data: { status: "FECHADA", fechadaEm, fechadaPor: usuarioId },
    });
    await auditar({
      usuarioId,
      acao: "FECHAMENTO",
      entidade: "competencia",
      entidadeId: c.id,
      antes: { status: c.status, fechadaEm: null },
      depois: { status: "FECHADA", fechadaEm },
      metadados: { competencia: rotulo(ano, mes), apuradaEm: c.apuradaEm, apuracoes: c.apuracoes },
    });
    return this.situacao(ano, mes);
  },

  /**
   * Reabre uma competência fechada, com justificativa. Os valores continuam
   * como foram apurados (congelados) até a competência ser reapurada.
   */
  async reabrir(ano: number, mes: number, justificativa: string, usuarioId: string) {
    const c = await competenciaPorAnoMes(ano, mes);
    if (c.status !== "FECHADA") throw new RegraApuracaoError(409, `A competência ${rotulo(ano, mes)} não está fechada.`);
    const texto = justificativa.trim();
    if (texto.length < 15) throw new RegraApuracaoError(400, "A justificativa da reabertura precisa explicar o motivo (ao menos 15 caracteres).");
    const prisma = getPrismaClient();
    await prisma.$transaction([
      prisma.reaberturaCompetencia.create({
        data: { competenciaId: c.id, justificativa: texto, reabertaPor: usuarioId, fechamentoAnteriorEm: c.fechadaEm, fechamentoAnteriorPor: c.fechadaPor },
      }),
      prisma.competencia.update({ where: { id: c.id }, data: { status: "ABERTA", fechadaEm: null, fechadaPor: null } }),
    ]);
    await auditar({
      usuarioId,
      acao: "REABERTURA",
      entidade: "competencia",
      entidadeId: c.id,
      antes: { status: "FECHADA", fechadaEm: c.fechadaEm, fechadaPor: c.fechadaPor },
      depois: { status: "ABERTA", fechadaEm: null },
      metadados: { competencia: rotulo(ano, mes), justificativa: texto },
    });
    return this.situacao(ano, mes);
  },
};
