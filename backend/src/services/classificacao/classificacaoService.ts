import { getPrismaClient } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { ValidacaoLancamento } from "../../generated/prisma/enums.js";
import { lancamentosManuaisService } from "../lancamentosManuais/lancamentosManuaisService.js";
import {
  chaveDoFornecedor,
  classificarLancamento,
  corrigirCentroEConta,
  filialDoDepartamento,
  partesDoValor,
  redistribuicaoDoMovimento,
  type CentroParaClassificar,
  type RegraDeRedistribuicao,
  type ContaParaClassificar,
} from "./regrasClassificacao.js";
import { abasQueSomam } from "../dre/apuracaoUnidades.js";

/** Erro de regra — vira 404/409 no controller, não 500. */
export class RegraClassificacaoError extends Error {
  constructor(
    readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

export const VALIDACOES_PENDENTES: ValidacaoLancamento[] = [
  "ERRO_PARAMETRIZACAO",
  "ERRO_DEPARTAMENTO",
  "ERRO_ATRIBUICAO",
  "SEM_DESTINO",
  "CENTRO_NAO_CADASTRADO",
  "SEM_ABA",
];

function rotulo(ano: number, mes: number) {
  return `${String(mes).padStart(2, "0")}/${ano}`;
}

async function competenciaPorAnoMes(ano: number, mes: number) {
  const competencia = await getPrismaClient().competencia.findUnique({
    where: { ano_mes: { ano, mes } },
    select: { id: true, ano: true, mes: true, status: true },
  });
  if (!competencia) {
    throw new RegraClassificacaoError(404, `A competência ${rotulo(ano, mes)} não existe.`);
  }
  return competencia;
}

export type FiltroClassificacao = {
  ano: number;
  mes: number;
  /** PENDENCIAS, TODOS ou uma validação específica. */
  situacao: "PENDENCIAS" | "TODOS" | ValidacaoLancamento;
  busca?: string;
  pagina: number;
  porPagina: number;
};

export const classificacaoService = {
  /**
   * Recalcula os campos derivados de todos os lançamentos da competência, a
   * partir do cadastro vigente. É o que faz "corrigir o cadastro reclassifica
   * sem reimportar". Recusado em competência fechada: lá a classificação está
   * congelada.
   */
  async classificarCompetencia(competenciaId: string) {
    const prisma = getPrismaClient();
    const inicio = Date.now();

    const competencia = await prisma.competencia.findUniqueOrThrow({
      where: { id: competenciaId },
      select: { ano: true, mes: true, status: true },
    });
    if (competencia.status === "FECHADA") {
      throw new RegraClassificacaoError(
        409,
        `A competência ${rotulo(competencia.ano, competencia.mes)} está fechada; a classificação dela está congelada.`,
      );
    }

    const [lancamentos, centros, contas, reclassificacoes, porFornecedor, contestacoes] = await Promise.all([
      prisma.lancamentoContabil.findMany({
        where: { competenciaId },
        select: { id: true, codigoCentroCusto: true, contaResultadoId: true, filial: true, cliForn: true, valorMovimento: true },
      }),
      // Todos os centros (27/10/2026): os do balancete pelo código; o de uma contestação, pelo id (com ou sem código).
      prisma.centroCusto.findMany({
        select: {
          id: true,
          codigoRM: true,
          departamento: true,
          atribuicao: true,
          balde: true,
        },
      }),
      prisma.contaResultado.findMany({
        select: {
          id: true,
          tipoConta: true,
          departamento: true,
          atribuicao: true,
          balde: true,
          linhaDREId: true,
          semResultado: true,
          linhaDRE: { select: { descricao: true } },
        },
      }),
      prisma.reclassificacaoConta.findMany({
        where: { ativo: true },
        select: { codigoCentroCusto: true, contaOrigemId: true, contaDestinoId: true },
      }),
      // As reclassificações por fornecedor (13/11/2026): o centro imperativo de cada fornecedor.
      prisma.reclassificacaoFornecedor.findMany({ where: { ativo: true }, select: { fornecedor: true, centroCustoId: true } }),
      // Os movimentos contestados corrigidos no balancete (27/10/2026; desde 30/10/2026, os de cada contestação, com as
      // anteriores e as posteriores): o centro e a conta novos valem no lugar dos do RM.
      prisma.contestacaoMovimento
        .findMany({
          where: { competenciaId, formaValidacao: "NO_BALANCETE", lancamentoContabilId: { not: null }, contestacao: { situacao: { in: ["ACATADA", "VALIDADA"] } } },
          select: { lancamentoContabilId: true, contestacao: { select: { id: true, centroNovoId: true, contaNovaId: true } } },
        })
        .then((ms) => ms.map((m) => ({ lancamentoContabilId: m.lancamentoContabilId, ...m.contestacao }))),
    ]);

    const centroPorCodigo = new Map<string, CentroParaClassificar>(
      centros.filter((c) => c.codigoRM).map((c) => [c.codigoRM!, c]),
    );
    const centroPorId = new Map(centros.map((c) => [c.id, c]));
    const contestacaoDo = new Map(contestacoes.map((c) => [c.lancamentoContabilId!, c]));
    let contestados = 0;
    const contaPorId = new Map<string, ContaParaClassificar>(
      contas.map(({ linhaDRE, ...c }) => [
        c.id,
        { ...c, linhaDREDescricao: linhaDRE?.descricao ?? null },
      ]),
    );
    // As linhas da DRE com as abas de cada uma (21/10/2026): a verificação "Sem Aba de Resultado".
    const linhasDRE = await prisma.linhaDRE.findMany({
      where: { ativo: true },
      select: { id: true, tipo: true, grupo: true, grupoSigla: true, atribuicao: true, descricao: true, unidades: { select: { unidadeNegocio: { select: { codigo: true } } } } },
    });
    const linhaPorId = new Map(linhasDRE.map((l) => [l.id, { ...l, unidades: l.unidades.map((u) => u.unidadeNegocio.codigo) }]));
    const tripla = (g: string, a: string | null, d: string) => `${g.trim().toUpperCase()}|${(a ?? "").trim().toUpperCase()}|${d.trim().toUpperCase()}`;
    const complementares = new Set(linhasDRE.filter((l) => l.tipo === "ITEM" && l.grupoSigla === "CSC").map((l) => tripla("", l.atribuicao, l.descricao)));

    const regras = {
      contaDestino: new Map(reclassificacoes.map((r) => [`${r.codigoCentroCusto}|${r.contaOrigemId}`, r.contaDestinoId])),
      centroDoFornecedor: new Map(porFornecedor.flatMap((r) => (centroPorId.has(r.centroCustoId) ? [[chaveDoFornecedor(r.fornecedor), centroPorId.get(r.centroCustoId)!] as const] : []))),
    };

    // As redistribuições de gastos vigentes no mês (13/11/2026): a vigência por mês (dia 1º do início ao dia 1º do fim).
    const doMes = new Date(Date.UTC(competencia.ano, competencia.mes - 1, 1));
    const redistribuicoes: Array<RegraDeRedistribuicao<(typeof centros)[number]>> = (
      await prisma.redistribuicaoGasto.findMany({
        where: { ativo: true, vigenciaInicio: { lte: doMes }, OR: [{ vigenciaFim: null }, { vigenciaFim: { gte: doMes } }] },
        orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }],
        select: {
          id: true,
          linhaDREId: true,
          fornecedores: true,
          departamento: { select: { gruposDRE: true, unidadeNegocio: { select: { codigo: true } } } },
          destinos: { orderBy: { ordem: "asc" }, select: { centroCustoId: true, percentual: true } },
        },
      })
    ).map((r) => ({
      id: r.id,
      linhaDREId: r.linhaDREId,
      departamento: r.departamento ? { grupos: new Set(r.departamento.gruposDRE), filial: filialDoDepartamento(r.departamento.unidadeNegocio.codigo) } : null,
      fornecedores: new Set(r.fornecedores.map(chaveDoFornecedor)),
      destinos: r.destinos.flatMap((d) => (centroPorId.has(d.centroCustoId) ? [{ centro: centroPorId.get(d.centroCustoId)!, percentual: Number(d.percentual) }] : [])),
    }));
    const partes: Prisma.LancamentoRedistribuidoCreateManyInput[] = [];

    const agora = new Date();
    const contagem = new Map<ValidacaoLancamento, number>();
    let reclassificados = 0;
    let doFornecedor = 0;
    let redistribuidos = 0;
    // A combinação da linha e do balde que nenhuma aba soma (21/10/2026): a verificação "Sem Aba de Resultado".
    const semAba = (linhaDREId: string | null, filial: number, balde: (typeof centros)[number]["balde"], alocacao: string) => {
      const linha = linhaDREId ? linhaPorId.get(linhaDREId) : undefined;
      if (!linha || linha.tipo !== "ITEM") return false;
      const par = linha.grupoSigla === "CSM" && complementares.has(tripla("", linha.atribuicao, linha.descricao));
      return !abasQueSomam(linha, { filial, balde, rateio: alocacao === "RATEIO", parNaComplementar: par }).length;
    };

    const atualizacoes = lancamentos.map((l) => {
      // A redistribuição de gastos (13/11/2026) vale por cima de tudo, inclusive da contestação (pedido do Adão): a conta da
      // DRE é a das reclassificações (sem a contestação); o movimento se divide entre os centros dos destinos, e as partes
      // não passam pela verificação de departamento e atribuição (o plano de contas resumido de 2027 vale para qualquer
      // centro), só pela de aba.
      const semContestacao = corrigirCentroEConta(l, regras, null);
      const contaSem = contaPorId.get(semContestacao.contaId)!;
      const rd = redistribuicoes.length
        ? redistribuicaoDoMovimento({ linhaDREId: contaSem.linhaDREId, grupoSigla: contaSem.linhaDREId ? (linhaPorId.get(contaSem.linhaDREId)?.grupoSigla ?? null) : null, filial: l.filial, cliForn: l.cliForn }, redistribuicoes)
        : null;
      if (rd && rd.destinos.length) {
        redistribuidos++;
        if (semContestacao.porConta) reclassificados++;
        if (semContestacao.porFornecedor) doFornecedor++;
        const centroDoMovimento = semContestacao.centro ?? (l.codigoCentroCusto ? (centroPorCodigo.get(l.codigoCentroCusto) ?? null) : null);
        const c = { ...classificarLancamento(semContestacao.codigoCentroCusto, centroDoMovimento, contaSem), validacao: "OK" as ValidacaoLancamento, contestacaoId: null, redistribuicaoId: rd.id };
        const valores = partesDoValor(Number(l.valorMovimento), rd.destinos.map((d) => d.percentual));
        rd.destinos.forEach((d, i) => {
          const p = classificarLancamento(d.centro.codigoRM, d.centro, contaSem);
          if (semAba(contaSem.linhaDREId, l.filial, p.balde, p.alocacao)) c.validacao = "SEM_ABA";
          partes.push({
            competenciaId,
            lancamentoContabilId: l.id,
            redistribuicaoId: rd.id,
            filial: l.filial,
            linhaDREId: contaSem.linhaDREId!,
            centroCustoId: d.centro.id,
            // Em texto (13/11/2026): o número do JavaScript gravava 9796.799999999999 no lugar de 9796.80.
            percentual: String(d.percentual),
            valorMovimento: valores[i].toFixed(2),
            balde: p.balde,
            alocacao: p.alocacao,
            etiqueta: p.etiqueta,
          });
        });
        contagem.set(c.validacao, (contagem.get(c.validacao) ?? 0) + 1);
        return { id: l.id, data: { ...c, classificadoEm: agora } };
      }
      // O centro e a conta que valem (13/11/2026): o centro imperativo do fornecedor, a troca de conta do centro e, por
      // cima, a contestação validada no balancete (o centro novo e a conta nova dela).
      const ct = contestacaoDo.get(l.id);
      if (ct) contestados++;
      const corrigido = corrigirCentroEConta(l, regras, ct ? { centroNovo: ct.centroNovoId ? (centroPorId.get(ct.centroNovoId) ?? null) : null, contaNovaId: ct.contaNovaId } : null);
      if (corrigido.porConta) reclassificados++;
      if (corrigido.porFornecedor) doFornecedor++;
      const conta = contaPorId.get(corrigido.contaId)!;
      const centro = corrigido.centro ?? (l.codigoCentroCusto ? (centroPorCodigo.get(l.codigoCentroCusto) ?? null) : null);
      const c = { ...classificarLancamento(corrigido.codigoCentroCusto, centro, conta), contestacaoId: ct?.id ?? null, redistribuicaoId: null as string | null };
      // Sem aba de resultado (21/10/2026): a combinação da linha e do balde que nenhuma aba soma.
      if (c.validacao === "OK" && semAba(c.linhaDREId, l.filial, c.balde, c.alocacao)) c.validacao = "SEM_ABA";
      contagem.set(c.validacao, (contagem.get(c.validacao) ?? 0) + 1);
      return { id: l.id, data: { ...c, classificadoEm: agora } };
    });

    // Em lote (23/10/2026, PostgreSQL): os lançamentos com a mesma classificação num comando só, em blocos de 5.000 ids. Um
    // a um eram uma ida ao banco por lançamento — no PostgreSQL, em outra máquina, a maior parte do tempo da apuração.
    const porDados = new Map<string, { data: (typeof atualizacoes)[number]["data"]; ids: string[] }>();
    for (const u of atualizacoes) {
      const chave = JSON.stringify(u.data);
      const grupo = porDados.get(chave) ?? { data: u.data, ids: [] };
      grupo.ids.push(u.id);
      porDados.set(chave, grupo);
    }
    await prisma.$transaction(
      async (tx) => {
        // As partes redistribuídas do mês (13/11/2026) se refazem junto com a classificação.
        await tx.lancamentoRedistribuido.deleteMany({ where: { competenciaId } });
        for (const { data, ids } of porDados.values()) {
          for (let k = 0; k < ids.length; k += 5000) await tx.lancamentoContabil.updateMany({ where: { id: { in: ids.slice(k, k + 5000) } }, data });
        }
        for (let k = 0; k < partes.length; k += 2000) await tx.lancamentoRedistribuido.createMany({ data: partes.slice(k, k + 2000) });
      },
      { timeout: 120_000 },
    );

    // Os lançamentos manuais derivam rateio e destino da conta: correm junto.
    const manuais = await lancamentosManuaisService.rederivar(competenciaId);

    return {
      lancamentos: lancamentos.length,
      manuais,
      reclassificados,
      /** Os movimentos que foram para o centro imperativo do fornecedor (13/11/2026). */
      porFornecedor: doFornecedor,
      /** Os movimentos redistribuídos (13/11/2026) e as partes deles. */
      redistribuidos,
      partesRedistribuidas: partes.length,
      contestados,
      porValidacao: Object.fromEntries(contagem),
      duracaoMs: Date.now() - inicio,
    };
  },

  /**
   * Reclassificação avulsa, pela tela. Recusada em competência apurada: a
   * classificação dos lançamentos é parte do retrato congelado (Passo 21), e só
   * a reapuração da competência a refaz — junto com o resto do resultado.
   */
  async reclassificar(ano: number, mes: number) {
    const competencia = await competenciaPorAnoMes(ano, mes);
    const { apuradaEm } = await getPrismaClient().competencia.findUniqueOrThrow({ where: { id: competencia.id }, select: { apuradaEm: true } });
    if (apuradaEm) {
      throw new RegraClassificacaoError(
        409,
        `A competência ${rotulo(ano, mes)} está apurada; a classificação dela está congelada. Para recalcular, reapure a competência (tela da DRE).`,
      );
    }
    return this.classificarCompetencia(competencia.id);
  },

  async resumo(ano: number, mes: number) {
    const prisma = getPrismaClient();
    const competencia = await competenciaPorAnoMes(ano, mes);

    const [grupos, reclassificados, classificacao, naoClassificados] = await Promise.all([
      // A soma não vem do groupBy: com o adaptador do SQLite, o groupBy trunca
      // todas as somas para inteiro quando a primeira do resultado é inteira.
      // O aggregate, um por grupo, soma certo.
      prisma.lancamentoContabil
        .groupBy({ by: ["validacao"], where: { competenciaId: competencia.id }, _count: { _all: true } })
        .then((gs) =>
          Promise.all(
            gs.map(async (g) => ({
              ...g,
              _sum: (await prisma.lancamentoContabil.aggregate({ where: { competenciaId: competencia.id, validacao: g.validacao }, _sum: { valorMovimento: true } }))._sum,
            })),
          ),
        ),
      prisma.lancamentoContabil.count({
        where: {
          competenciaId: competencia.id,
          contaAdotadaId: { not: null },
          NOT: { contaAdotadaId: { equals: prisma.lancamentoContabil.fields.contaResultadoId } },
        },
      }),
      prisma.lancamentoContabil.aggregate({
        where: { competenciaId: competencia.id },
        _min: { classificadoEm: true },
      }),
      prisma.lancamentoContabil.count({
        where: { competenciaId: competencia.id, classificadoEm: null },
      }),
    ]);

    const porValidacao = grupos.map((g) => ({
      validacao: g.validacao,
      lancamentos: g._count._all,
      valor: (g._sum.valorMovimento ?? new Prisma.Decimal(0)).toFixed(2),
    }));

    return {
      competencia,
      total: porValidacao.reduce((n, g) => n + g.lancamentos, 0),
      pendentes: porValidacao
        .filter((g) => VALIDACOES_PENDENTES.includes(g.validacao))
        .reduce((n, g) => n + g.lancamentos, 0),
      reclassificados,
      naoClassificados,
      // A mais antiga: toda a competência foi classificada ao menos desde então.
      classificadoEm: classificacao._min.classificadoEm,
      porValidacao,
    };
  },

  async listar(filtro: FiltroClassificacao) {
    const prisma = getPrismaClient();
    const competencia = await competenciaPorAnoMes(filtro.ano, filtro.mes);
    const busca = filtro.busca?.trim();

    const where: Prisma.LancamentoContabilWhereInput = {
      competenciaId: competencia.id,
      ...(filtro.situacao === "PENDENCIAS"
        ? { validacao: { in: VALIDACOES_PENDENTES } }
        : filtro.situacao === "TODOS"
          ? {}
          : { validacao: filtro.situacao }),
      ...(busca
        ? {
            OR: [
              { codigoCentroCusto: { contains: busca, mode: "insensitive" } },
              { nomeCentroCusto: { contains: busca, mode: "insensitive" } },
              { contaResultado: { reduzido: { contains: busca, mode: "insensitive" } } },
              { contaResultado: { descricao: { contains: busca, mode: "insensitive" } } },
              { contaAdotada: { reduzido: { contains: busca, mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    const contaCampos = {
      reduzido: true,
      descricao: true,
      departamento: true,
      atribuicao: true,
      semResultado: true,
    } as const;

    const [itens, total] = await Promise.all([
      prisma.lancamentoContabil.findMany({
        where,
        // Sem centro primeiro, como no SQLite (23/10/2026).
        orderBy: [{ filial: "asc" }, { codigoCentroCusto: { sort: "asc", nulls: "first" } }, { linhaArquivo: "asc" }],
        skip: (filtro.pagina - 1) * filtro.porPagina,
        take: filtro.porPagina,
        select: {
          id: true,
          filial: true,
          linhaArquivo: true,
          codigoCentroCusto: true,
          nomeCentroCusto: true,
          valorMovimento: true,
          validacao: true,
          balde: true,
          alocacao: true,
          etiqueta: true,
          contaResultadoId: true,
          contaAdotadaId: true,
          centroCusto: {
            select: { nomeRM: true, departamento: true, atribuicao: true },
          },
          contaResultado: { select: contaCampos },
          contaAdotada: { select: contaCampos },
          linhaDRE: { select: { codigo: true, descricao: true } },
        },
      }),
      prisma.lancamentoContabil.count({ where }),
    ]);

    return {
      competencia,
      total,
      pagina: filtro.pagina,
      porPagina: filtro.porPagina,
      itens: itens.map(({ contaResultadoId, contaAdotadaId, valorMovimento, ...l }) => ({
        ...l,
        valorMovimento: valorMovimento.toFixed(2),
        reclassificado: contaAdotadaId !== null && contaAdotadaId !== contaResultadoId,
      })),
    };
  },
};
