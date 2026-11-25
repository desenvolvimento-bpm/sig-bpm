import { getPrismaClient } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { BaldeAlocacao } from "../../generated/prisma/enums.js";
import type { LancamentoManualInput } from "../../schemas/lancamentosManuais/lancamentoManualSchema.js";
import { auditar } from "../auditoriaService.js";
import { abasQueSomam, CHAVES_DE_RATEIO } from "../dre/apuracaoUnidades.js";
import { semOGrupo } from "../dre/descricaoDeOrigem.js";

/** Erro de regra — vira 400/404/409 no controller, não 500. */
export class RegraLancamentoManualError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

function rotulo(ano: number, mes: number) {
  return `${String(mes).padStart(2, "0")}/${ano}`;
}

/**
 * Derivados do lançamento, na regra das colunas E a I da Gastos (Lanç.
 * Manuais): o rateio é o do centro, quando há centro, senão o da conta; o
 * destino na DRE é a linha da conta.
 */
export function derivarLancamentoManual(
  conta: { balde: BaldeAlocacao | null; linhaDREId: string | null },
  centro: { balde: BaldeAlocacao | null } | null,
) {
  return { balde: centro ? centro.balde : conta.balde, linhaDREId: conta.linhaDREId };
}

async function competenciaPorAnoMes(ano: number, mes: number) {
  const competencia = await getPrismaClient().competencia.findUnique({
    where: { ano_mes: { ano, mes } },
    select: { id: true, ano: true, mes: true, status: true },
  });
  if (!competencia) {
    throw new RegraLancamentoManualError(404, `A competência ${rotulo(ano, mes)} não existe.`);
  }
  return competencia;
}

function exigirAberta(c: { ano: number; mes: number; status: string }) {
  if (c.status === "FECHADA") {
    throw new RegraLancamentoManualError(
      409,
      `A competência ${rotulo(c.ano, c.mes)} está fechada. Lançar nela exige reabri-la.`,
    );
  }
}

/** Valida conta e centro e devolve os derivados. */
async function resolver(input: LancamentoManualInput) {
  const prisma = getPrismaClient();
  const [conta, centro] = await Promise.all([
    prisma.contaResultado.findUnique({
      where: { id: input.contaResultadoId },
      select: { tipoConta: true, balde: true, linhaDREId: true, reduzido: true, ativo: true },
    }),
    input.centroCustoId
      ? prisma.centroCusto.findUnique({ where: { id: input.centroCustoId }, select: { balde: true, ativo: true, nomeRM: true } })
      : Promise.resolve(null),
  ]);
  if (!conta) throw new RegraLancamentoManualError(400, "Conta não encontrada.");
  if (!conta.ativo) throw new RegraLancamentoManualError(400, `A conta ${conta.reduzido} está inativa no cadastro.`);
  if (conta.tipoConta !== "ANALITICA") {
    throw new RegraLancamentoManualError(400, `A conta ${conta.reduzido} é sintética; lance numa conta analítica.`);
  }
  if (!conta.linhaDREId) {
    throw new RegraLancamentoManualError(
      400,
      `A conta ${conta.reduzido} não tem destino na DRE. Corrija o cadastro antes de lançar.`,
    );
  }
  if (input.centroCustoId && !centro) {
    throw new RegraLancamentoManualError(400, "Centro de custo não encontrado.");
  }
  if (centro && !centro.ativo) throw new RegraLancamentoManualError(400, `O centro de custo ${centro.nomeRM} está inativo no cadastro.`);
  const derivados = derivarLancamentoManual(conta, centro);
  await exigirAbaDeResultado(derivados, input.filial);
  return derivados;
}

/**
 * Os lançamentos manuais entram em todas as abas de resultado (21/10/2026), pela regra do balde, como o balancete: a
 * combinação da linha da conta, do balde e da filial que nenhuma aba soma é recusada, com o motivo (antes, ficava fora do
 * resultado sem aviso).
 */
async function exigirAbaDeResultado(d: { balde: BaldeAlocacao | null; linhaDREId: string | null }, filial: number) {
  if (!d.linhaDREId) return;
  const prisma = getPrismaClient();
  const linha = await prisma.linhaDRE.findUnique({
    where: { id: d.linhaDREId },
    select: { codigo: true, tipo: true, grupoSigla: true, atribuicao: true, descricao: true, unidades: { select: { unidadeNegocio: { select: { codigo: true } } } } },
  });
  if (!linha) return;
  const par =
    linha.grupoSigla === "CSM" &&
    // O par nos Complementares pelo código sem o grupo (25/11/2026: a atribuição e a descrição de origem).
    (await prisma.linhaDRE.count({ where: { ativo: true, tipo: "ITEM", grupoSigla: "CSC", codigo: { endsWith: `.${semOGrupo(linha.codigo)}` } } })) > 0;
  const rateio = ["PROJETO", "PRODUCAO", "METALURGIA", "ARMADURA", "ACOMPANHAMENTO"].includes(d.balde ?? "");
  const abas = abasQueSomam({ ...linha, unidades: linha.unidades.map((u) => u.unidadeNegocio.codigo) }, { filial, balde: d.balde, rateio, manual: true, parNaComplementar: par });
  if (!abas.length) {
    throw new RegraLancamentoManualError(
      400,
      `Nenhuma aba de resultado soma a linha "${linha.descricao}" com o balde ${d.balde ?? "vazio"} na filial ${filial}: o lançamento ficaria fora do resultado. Escolha outro centro de custo ou outra conta.`,
    );
  }
}

async function competenciaDoLancamento(id: string) {
  const atual = await getPrismaClient().lancamentoManual.findUnique({
    where: { id },
    select: { contestacaoId: true, competencia: { select: { ano: true, mes: true, status: true } } },
  });
  if (!atual) throw new RegraLancamentoManualError(404, "Lançamento não encontrado.");
  // Os lançamentos das contestações (27/10/2026) não se editam nem se excluem um a um: o par sai pela aba Contestações.
  if (atual.contestacaoId) {
    throw new RegraLancamentoManualError(409, "O lançamento é de uma contestação: na aba Contestações, a lixeira desfaz a importação dela (os dois lançamentos).");
  }
  return atual.competencia;
}

const SELECAO = {
  id: true,
  motivo: true,
  filial: true,
  descricao: true,
  valor: true,
  balde: true,
  atualizadoEm: true,
  centroCusto: { select: { id: true, codigoRM: true, nomeRM: true } },
  contaResultado: {
    select: { id: true, reduzido: true, descricao: true, departamento: true, atribuicao: true },
  },
  linhaDRE: { select: { codigo: true, descricao: true, grupo: true } },
  // A competência do movimento que o lançamento de uma contestação corrige (30/10/2026); com rateio, a dos percentuais.
  competenciaId: true,
  competenciaMovimentoId: true,
  competenciaMovimento: { select: { ano: true, mes: true } },
  // A contestação de que o lançamento veio (27/10/2026: a aba Contestações).
  contestacao: {
    select: {
      id: true,
      numero: true,
      historico: true,
      cliForn: true,
      solicitante: { select: { nome: true } },
      competencia: { select: { ano: true, mes: true } },
    },
  },
} as const;

type Linha = Prisma.LancamentoManualGetPayload<{ select: typeof SELECAO }>;
const apresentar = ({ valor, contestacao, competenciaId, competenciaMovimentoId, competenciaMovimento, ...l }: Linha) => ({
  ...l,
  valor: valor.toFixed(2),
  competenciaMovimento: competenciaMovimento ? rotulo(competenciaMovimento.ano, competenciaMovimento.mes) : null,
  // Os percentuais de outra competência: só no de rateio (no direto, eles não valem) e com o movimento de outro mês.
  rateioDe:
    competenciaMovimento && competenciaMovimentoId !== competenciaId && CHAVES_DE_RATEIO.has(l.balde ?? "") ? rotulo(competenciaMovimento.ano, competenciaMovimento.mes) : null,
  contestacao: contestacao
    ? {
        id: contestacao.id,
        numero: contestacao.numero,
        item: contestacao.historico || contestacao.cliForn || null,
        solicitante: contestacao.solicitante.nome,
        competencia: rotulo(contestacao.competencia.ano, contestacao.competencia.mes),
      }
    : null,
});

function dados(input: LancamentoManualInput) {
  return {
    motivo: input.motivo,
    filial: input.filial,
    centroCustoId: input.centroCustoId ?? null,
    contaResultadoId: input.contaResultadoId,
    descricao: input.descricao,
    valor: new Prisma.Decimal(input.valor),
  };
}

export const lancamentosManuaisService = {
  /** Os lançamentos de uma aba (27/10/2026): Controladoria (os digitados) ou Contestações (os vindos das contestações). */
  async listar(ano: number, mes: number, aba: "controladoria" | "contestacoes" = "controladoria") {
    const competencia = await competenciaPorAnoMes(ano, mes);
    const itens = await getPrismaClient().lancamentoManual.findMany({
      where: { competenciaId: competencia.id, contestacaoId: aba === "contestacoes" ? { not: null } : null },
      orderBy: [{ motivo: "asc" }, { criadoEm: "asc" }, { id: "asc" }],
      select: SELECAO,
    });
    const total = itens.reduce((a, l) => a.plus(l.valor), new Prisma.Decimal(0));
    return { competencia, itens: itens.map(apresentar), total: total.toFixed(2) };
  },

  /** O que a tela precisa para montar o formulário. */
  async opcoes() {
    const prisma = getPrismaClient();
    const [contas, centros, motivos] = await Promise.all([
      prisma.contaResultado.findMany({
        where: { tipoConta: "ANALITICA", linhaDREId: { not: null }, ativo: true },
        orderBy: { ordem: "asc" },
        select: { id: true, reduzido: true, descricao: true, departamento: true, atribuicao: true },
      }),
      prisma.centroCusto.findMany({
        where: { codigoRM: { not: null }, ativo: true },
        orderBy: { ordem: "asc" },
        select: { id: true, codigoRM: true, nomeRM: true },
      }),
      prisma.lancamentoManual.findMany({
        distinct: ["motivo"],
        select: { motivo: true },
        orderBy: { motivo: "asc" },
      }),
    ]);
    return { contas, centros, motivos: motivos.map((m) => m.motivo) };
  },

  async criar(ano: number, mes: number, input: LancamentoManualInput, usuarioId: string) {
    const competencia = await competenciaPorAnoMes(ano, mes);
    exigirAberta(competencia);
    const derivados = await resolver(input);
    const criado = await getPrismaClient().lancamentoManual.create({
      data: { competenciaId: competencia.id, criadoPor: usuarioId, ...dados(input), ...derivados },
      select: SELECAO,
    });
    const r = apresentar(criado);
    await auditar({ usuarioId, acao: "CRIACAO", entidade: "lancamento_manual", entidadeId: criado.id, depois: r, metadados: { competencia: rotulo(ano, mes) } });
    return r;
  },

  async atualizar(id: string, input: LancamentoManualInput, usuarioId: string) {
    exigirAberta(await competenciaDoLancamento(id));
    const antes = await getPrismaClient().lancamentoManual.findUniqueOrThrow({ where: { id }, select: SELECAO });
    const derivados = await resolver(input);
    const salvo = await getPrismaClient().lancamentoManual.update({
      where: { id },
      data: { ...dados(input), ...derivados },
      select: SELECAO,
    });
    const r = apresentar(salvo);
    await auditar({ usuarioId, acao: "ALTERACAO", entidade: "lancamento_manual", entidadeId: id, antes: apresentar(antes), depois: r });
    return r;
  },

  async excluir(id: string, usuarioId: string) {
    exigirAberta(await competenciaDoLancamento(id));
    const antes = await getPrismaClient().lancamentoManual.findUniqueOrThrow({ where: { id }, select: SELECAO });
    await getPrismaClient().lancamentoManual.delete({ where: { id } });
    await auditar({ usuarioId, acao: "EXCLUSAO", entidade: "lancamento_manual", entidadeId: id, antes: apresentar(antes) });
  },

  /**
   * Copia os lançamentos do mês anterior, com os mesmos valores, para o
   * Contábil ajustar — a RN se repete quase igual de um mês para o outro. Só
   * numa competência ainda sem lançamentos manuais.
   */
  async copiarDoMesAnterior(ano: number, mes: number, usuarioId: string) {
    const prisma = getPrismaClient();
    const competencia = await competenciaPorAnoMes(ano, mes);
    exigirAberta(competencia);
    const [anoAnt, mesAnt] = mes === 1 ? [ano - 1, 12] : [ano, mes - 1];
    const anterior = await prisma.competencia.findUnique({
      where: { ano_mes: { ano: anoAnt, mes: mesAnt } },
      select: { id: true },
    });
    if (!anterior) {
      throw new RegraLancamentoManualError(404, `Não há competência ${rotulo(anoAnt, mesAnt)} para copiar.`);
    }
    // Só os da Controladoria (27/10/2026): os das contestações não se copiam.
    if ((await prisma.lancamentoManual.count({ where: { competenciaId: competencia.id, contestacaoId: null } })) > 0) {
      throw new RegraLancamentoManualError(
        409,
        "Esta competência já tem lançamentos manuais. A cópia só é feita numa competência vazia.",
      );
    }
    const origem = await prisma.lancamentoManual.findMany({
      where: { competenciaId: anterior.id, contestacaoId: null },
      orderBy: [{ motivo: "asc" }, { criadoEm: "asc" }, { id: "asc" }],
      select: {
        motivo: true,
        filial: true,
        centroCustoId: true,
        contaResultadoId: true,
        descricao: true,
        valor: true,
        contaResultado: { select: { balde: true, linhaDREId: true } },
        centroCusto: { select: { balde: true } },
      },
    });
    if (origem.length === 0) {
      throw new RegraLancamentoManualError(404, `A competência ${rotulo(anoAnt, mesAnt)} não tem lançamentos manuais.`);
    }
    // Cada cópia 1 ms depois da anterior (23/10/2026): a lista ordena pela criação, e as cópias ficam na ordem do mês copiado.
    const copiadoEm = Date.now();
    await prisma.lancamentoManual.createMany({
      data: origem.map(({ contaResultado, centroCusto, ...l }, k) => ({
        ...l,
        competenciaId: competencia.id,
        criadoPor: usuarioId,
        criadoEm: new Date(copiadoEm + k),
        // Derivados com o cadastro de hoje, não com o do mês copiado.
        ...(contaResultado
          ? derivarLancamentoManual(contaResultado, centroCusto)
          : { balde: null, linhaDREId: null }),
      })),
    });
    await auditar({
      usuarioId,
      acao: "COPIA_MES_ANTERIOR",
      entidade: "lancamento_manual",
      entidadeId: rotulo(ano, mes),
      metadados: { de: rotulo(anoAnt, mesAnt), para: rotulo(ano, mes), copiados: origem.length },
    });
    return { copiados: origem.length };
  },

  /**
   * Os lançamentos de uma contestação (27/10/2026: o Importar da aba Contestações): o estorno e o novo, com as mesmas
   * verificações dos digitados (a conta, o centro e uma aba de resultado que os some), juntos — ou nenhum.
   */
  async criarDeContestacao(
    competenciaId: string,
    contestacaoId: string,
    motivo: string,
    pares: Array<{ filial: number; centroCustoId: string | null; contaResultadoId: string; descricao: string; valor: Prisma.Decimal; competenciaMovimentoId?: string | null }>,
    usuarioId: string,
  ) {
    const prisma = getPrismaClient();
    const dadosDosPares = [];
    for (const p of pares) {
      const derivados = await resolver({ motivo, filial: p.filial, centroCustoId: p.centroCustoId, contaResultadoId: p.contaResultadoId, descricao: p.descricao, valor: p.valor.toFixed(2) });
      dadosDosPares.push({ ...p, ...derivados });
    }
    const agora = Date.now();
    await prisma.lancamentoManual.createMany({
      data: dadosDosPares.map((p, k) => ({ competenciaId, contestacaoId, motivo, criadoPor: usuarioId, criadoEm: new Date(agora + k), ...p })),
    });
  },

  /** Recalcula os derivados com o cadastro vigente. Chamado na reclassificação. */
  async rederivar(competenciaId: string) {
    const prisma = getPrismaClient();
    const lancamentos = await prisma.lancamentoManual.findMany({
      where: { competenciaId },
      select: {
        id: true,
        atualizadoEm: true,
        contaResultado: { select: { balde: true, linhaDREId: true } },
        centroCusto: { select: { balde: true } },
      },
    });
    // Recalcular os campos derivados não é alteração do lançamento: a data de
    // alteração fica (ela entra no retrato das entradas da apuração).
    for (const l of lancamentos) {
      if (!l.contaResultado) continue;
      await prisma.lancamentoManual.update({
        where: { id: l.id },
        data: { ...derivarLancamentoManual(l.contaResultado, l.centroCusto), atualizadoEm: l.atualizadoEm },
      });
    }
    return lancamentos.length;
  },
};
