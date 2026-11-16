import { getPrismaClient } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { ACESSO_TOTAL, type Acesso } from "../acesso/acesso.js";
import { podeVerCentro, podeVerLinhaNoCentro, podeVerMovimentos, podeVerSensiveis } from "../acesso/recorteDepartamento.js";
import { totaisDaCompetencia } from "../volumes/volumesService.js";
import { apurarUnidades, CHAVES_DE_RATEIO, type LinhaEstrutura } from "./apuracaoUnidades.js";
import { atribuicoesDoCentro, linhasDoCentro, prefixoDaAtribuicao } from "./recorteCentros.js";
import { apurarCentros, consolidar } from "./consolidacao.js";
import { plural } from "../../utils/plural.js";
import type { VisaoResultados } from "../relatorios/basesResultados.js";
import { basesDoConsolidadoDoMes, comParticipacoes } from "./participacoesDoMes.js";

/** Erro de regra — vira 400/404/409 no controller, não 500. */
export class RegraDREError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

const rotulo = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;

async function competenciaPorAnoMes(ano: number, mes: number) {
  const c = await getPrismaClient().competencia.findUnique({ where: { ano_mes: { ano, mes } }, select: { id: true, status: true } });
  if (!c) throw new RegraDREError(404, `A competência ${rotulo(ano, mes)} não existe.`);
  return c;
}

export async function estrutura(): Promise<LinhaEstrutura[]> {
  const linhas = await getPrismaClient().linhaDRE.findMany({
    where: { ativo: true },
    orderBy: { ordem: "asc" },
    select: {
      id: true,
      codigo: true,
      tipo: true,
      grupo: true,
      grupoSigla: true,
      atribuicao: true,
      atribuicaoSigla: true,
      descricao: true,
      expressao: true,
      unidades: { select: { unidadeNegocio: { select: { codigo: true } } } },
    },
  });
  return linhas.map((l) => ({ ...l, unidades: l.unidades.map((u) => u.unidadeNegocio.codigo) }));
}

type ValorGravado = { linhaDREId: string; valor: Prisma.Decimal; composicao: Prisma.JsonValue; apuradoEm: Date; congelado: boolean };

/**
 * As linhas da estrutura com valor gravado (e as seções), na ordem da DRE.
 * `podeDetalhar` diz se o usuário alcança as movimentações da linha (o recorte
 * por departamento do Gestor, Passo 22): a DRE é inteira para todos.
 */
function montarLinhas(linhas: LinhaEstrutura[], valores: ValorGravado[], acesso: Acesso) {
  const porLinha = new Map(valores.map((v) => [v.linhaDREId, v]));
  return {
    apuradoEm: valores[0]?.apuradoEm ?? null,
    congelado: valores.some((v) => v.congelado),
    linhas: linhas
      .filter((l) => l.tipo === "SECAO" || porLinha.has(l.id))
      .map((l) => ({
        codigo: l.codigo,
        tipo: l.tipo,
        grupo: l.grupo,
        grupoSigla: l.grupoSigla,
        descricao: l.descricao,
        valor: porLinha.get(l.id)?.valor.toFixed(2) ?? null,
        composicao: porLinha.get(l.id)?.composicao ?? null,
        // Sem o Acesso a Informações Sensíveis (27/10/2026), as linhas de Mão de Obra Direta e Indireta sem a lupa.
        podeDetalhar: podeVerMovimentos(acesso, l) && podeVerSensiveis(acesso, l),
      })),
  };
}

/** As bases do % e do R$/m³ (13/11/2026): os valores gravados por código da linha, com todas as casas (os volumes, três). */
function basesGravadas(linhas: LinhaEstrutura[], valores: Array<{ linhaDREId: string; valor: Prisma.Decimal }>) {
  const codigo = new Map(linhas.map((l) => [l.id, l.codigo]));
  return new Map(valores.flatMap((v) => (codigo.has(v.linhaDREId) ? [[codigo.get(v.linhaDREId)!, Number(v.valor)] as const] : [])));
}

/**
 * Agrupamento do centro na visão por centro de custo: a coluna CENTRO DE CUSTO
 * (CONTROLADORIA) do cadastro (decisão do usuário de 30/09/2026). O centro é
 * achado pelo código RM; sem essa coluna preenchida, fica num grupo à parte.
 */
export const SEM_AGRUPAMENTO = "(sem centro de custo da controladoria)";
export const grupoDoCentro = (cc: { nomeControladoria: string | null }) => cc.nomeControladoria?.trim() || SEM_AGRUPAMENTO;

type CentroDoValor = { id: string; codigoRM: string | null; nomeRM: string; nomeControladoria: string | null; departamento: string | null };
type ValorDoCentro = { linhaDREId: string; valor: Prisma.Decimal; apuradoEm: Date | null; congelado: boolean; centroCusto: CentroDoValor };

/**
 * Os valores dos centros de custo no mês (15/10/2026): os apurados ou, antes da apuração, os calculados na hora dos
 * lançamentos classificados (apurarCentros, a mesma conta da apuração), com `apuradoEm` nulo. Assim, a aba Centros de
 * Custo da DRE do mês se consulta desde a importação do balancete.
 */
async function valoresDosCentros(competenciaId: string, linhas: LinhaEstrutura[]): Promise<ValorDoCentro[]> {
  const prisma = getPrismaClient();
  const selecao = { id: true, codigoRM: true, nomeRM: true, nomeControladoria: true, departamento: true } as const;
  const apurados = await prisma.resultadoApurado.findMany({
    where: { competenciaId, centroCustoId: { not: null } },
    select: { linhaDREId: true, valor: true, apuradoEm: true, congelado: true, centroCusto: { select: selecao } },
  });
  if (apurados.length) return apurados.map((a) => ({ ...a, centroCusto: a.centroCusto! }));
  // Os redistribuídos (13/11/2026) pelas partes, nos centros dos destinos.
  const [diretos, partes] = await Promise.all([
    prisma.lancamentoContabil.findMany({
      where: { competenciaId, redistribuicaoId: null, centroCustoId: { not: null }, linhaDREId: { not: null } },
      select: { centroCustoId: true, linhaDREId: true, valorMovimento: true },
    }),
    prisma.lancamentoRedistribuido.findMany({ where: { competenciaId }, select: { centroCustoId: true, linhaDREId: true, valorMovimento: true } }),
  ]);
  const lancamentos = [...diretos, ...partes];
  if (!lancamentos.length) return [];
  const centros = new Map(
    (await prisma.centroCusto.findMany({ where: { id: { in: [...new Set(lancamentos.map((l) => l.centroCustoId!))] } }, select: selecao })).map((c) => [c.id, c]),
  );
  return apurarCentros(
    linhas,
    lancamentos.map((l) => ({ centroCustoId: l.centroCustoId, linhaDREId: l.linhaDREId, valor: l.valorMovimento })),
  ).flatMap((r) => {
    const cc = centros.get(r.centroCustoId);
    return cc ? [{ linhaDREId: r.linhaId, valor: r.valor, apuradoEm: null, congelado: false, centroCusto: cc }] : [];
  });
}

export const dreService = {
  /**
   * Apura a DRE das cinco unidades a partir do que já está apurado no mês — a
   * classificação dos lançamentos, os rateios e a receita prévia — e dos
   * lançamentos manuais; depois, a consolidada (a soma das unidades) e a visão
   * por centro de custo (os lançamentos de cada centro, antes do rateio).
   * Grava tudo com a composição de cada valor, substituindo a apuração anterior.
   */
  async apurar(ano: number, mes: number, usuarioId?: string) {
    const c = await competenciaPorAnoMes(ano, mes);
    if (c.status === "FECHADA") throw new RegraDREError(409, `A competência ${rotulo(ano, mes)} está fechada. Reapurar exige reabri-la.`);
    const prisma = getPrismaClient();
    if (await prisma.resultadoApurado.count({ where: { competenciaId: c.id, congelado: true } })) {
      throw new RegraDREError(409, `A DRE de ${rotulo(ano, mes)} está congelada pela apuração da competência. Para recalcular, reapure a competência (tela da DRE).`);
    }
    const [linhas, lancamentos, manuais, volumes, receitas, totais, pendentes] = await Promise.all([
      estrutura(),
      // Os redistribuídos (13/11/2026) entram pelas partes (no centro, no rateio e na alocação de cada destino), abaixo.
      prisma.lancamentoContabil.findMany({
        where: { competenciaId: c.id, redistribuicaoId: null },
        select: { filial: true, centroCustoId: true, linhaDREId: true, balde: true, alocacao: true, valorMovimento: true },
      }),
      prisma.lancamentoManual.findMany({ where: { competenciaId: c.id }, select: { linhaDREId: true, balde: true, valor: true, filial: true, competenciaMovimentoId: true } }),
      prisma.volumeOperacional.findMany({ where: { competenciaId: c.id }, select: { percentual: true, regraRateio: { select: { chave: true, destino: true } } } }),
      prisma.receitaPrevia.findMany({ where: { competenciaId: c.id }, select: { natureza: true, receitaBruta: true, receitaLiquida: true, unidadeNegocio: { select: { codigo: true } } } }),
      totaisDaCompetencia(c.id),
      prisma.lancamentoContabil.count({ where: { competenciaId: c.id, classificadoEm: null } }),
    ]);
    const partes = await prisma.lancamentoRedistribuido.findMany({
      where: { competenciaId: c.id },
      select: { filial: true, centroCustoId: true, linhaDREId: true, balde: true, alocacao: true, valorMovimento: true },
    });
    const daApuracao = [...lancamentos, ...partes];
    if (daApuracao.length === 0) throw new RegraDREError(409, `A competência ${rotulo(ano, mes)} não tem balancete importado.`);
    if (pendentes > 0) throw new RegraDREError(409, `Há ${pendentes} ${plural(pendentes, "lançamento", "lançamentos")} sem classificação. Classifique a competência antes de apurar.`);
    if (volumes.length === 0) throw new RegraDREError(409, `Os rateios de ${rotulo(ano, mes)} não foram apurados.`);
    if (receitas.length === 0) throw new RegraDREError(409, `A receita prévia de ${rotulo(ano, mes)} não foi apurada.`);
    // Os percentuais das competências dos movimentos contestados com rateio (30/10/2026), para os lançamentos deles.
    const outras = [...new Set(manuais.filter((m) => CHAVES_DE_RATEIO.has(m.balde ?? "")).map((m) => m.competenciaMovimentoId).filter((id): id is string => !!id && id !== c.id))];
    const percentuaisDe = new Map(
      (
        await prisma.competencia.findMany({
          where: { id: { in: outras } },
          orderBy: [{ ano: "asc" }, { mes: "asc" }],
          select: { id: true, ano: true, mes: true, volumesOperacionais: { select: { percentual: true, regraRateio: { select: { chave: true, destino: true } } } } },
        })
      ).map((o) => [o.id, { rotulo: rotulo(o.ano, o.mes), percentuais: new Map(o.volumesOperacionais.map((v) => [`${v.regraRateio.chave}|${v.regraRateio.destino}`, v.percentual])) }]),
    );

    const { resultados, avisos } = apurarUnidades({
      linhas,
      lancamentos: daApuracao.map((l) => ({ filial: l.filial, linhaDREId: l.linhaDREId, balde: l.balde, alocacao: l.alocacao, valor: l.valorMovimento })),
      manuais: manuais.map((m) => ({ linhaDREId: m.linhaDREId, balde: m.balde, valor: m.valor, filial: m.filial, rateioDe: m.competenciaMovimentoId })),
      percentuais: new Map(volumes.map((v) => [`${v.regraRateio.chave}|${v.regraRateio.destino}`, v.percentual])),
      percentuaisDe,
      totais: new Map(totais.map((t) => [t.codigo as string, t.quantidade])),
      receitas: receitas.map((r) => ({ unidade: r.unidadeNegocio.codigo, natureza: r.natureza, receitaBruta: r.receitaBruta, receitaLiquida: r.receitaLiquida })),
    });
    const consolidado = consolidar(linhas, resultados);
    const centros = apurarCentros(
      linhas,
      daApuracao.map((l) => ({ centroCustoId: l.centroCustoId, linhaDREId: l.linhaDREId, valor: l.valorMovimento })),
    );

    const unidades = new Map((await prisma.unidadeNegocio.findMany({ select: { id: true, codigo: true } })).map((u) => [u.codigo, u.id]));
    const comum = { competenciaId: c.id, apuradoEm: new Date(), apuradoPor: usuarioId ?? null };
    const json = (x: unknown) => (x ?? Prisma.DbNull) as Prisma.InputJsonValue;
    const dados: Prisma.ResultadoApuradoCreateManyInput[] = [
      ...resultados.map((r) => ({ ...comum, unidadeNegocioId: unidades.get(r.unidade)!, linhaDREId: r.linhaId, valor: r.valor, composicao: json(r.composicao) })),
      ...consolidado.map((r) => ({ ...comum, linhaDREId: r.linhaId, valor: r.valor, composicao: json(r.composicao) })),
      ...centros.map((r) => ({ ...comum, centroCustoId: r.centroCustoId, linhaDREId: r.linhaId, valor: r.valor, composicao: json(r.composicao) })),
    ];
    await prisma.$transaction(
      async (tx) => {
        await tx.resultadoApurado.deleteMany({ where: { competenciaId: c.id } });
        for (let i = 0; i < dados.length; i += 500) await tx.resultadoApurado.createMany({ data: dados.slice(i, i + 500) });
      },
      { timeout: 120_000 },
    );
    return { resultados: resultados.length, consolidado: consolidado.length, centros: centros.length, avisos };
  },

  /** A DRE apurada de uma unidade, na ordem da estrutura. */
  async consultarUnidade(ano: number, mes: number, unidade: number, acesso: Acesso = ACESSO_TOTAL) {
    const c = await competenciaPorAnoMes(ano, mes);
    const [linhas, valores] = await Promise.all([
      estrutura(),
      getPrismaClient().resultadoApurado.findMany({
        where: { competenciaId: c.id, centroCustoId: null, unidadeNegocio: { codigo: unidade } },
        select: { linhaDREId: true, valor: true, composicao: true, apuradoEm: true, congelado: true },
      }),
    ]);
    const m = montarLinhas(linhas, valores, acesso);
    // O % e o R$/m³ (13/11/2026): em Despesas e Extra e no RN, sobre as bases do Consolidado; nas outras, os valores gravados
    // da unidade (os volumes com todas as casas, como nos Resultados Empresariais).
    const gravados = basesGravadas(linhas, valores);
    const bases = unidade >= 4 ? await basesDoConsolidadoDoMes(c.id) : gravados;
    return { competencia: { ano, mes, status: c.status }, unidade, ...m, linhas: comParticipacoes(m.linhas, unidade as VisaoResultados, bases, gravados) };
  },

  /** A DRE consolidada, na ordem da estrutura. */
  async consultarConsolidado(ano: number, mes: number, acesso: Acesso = ACESSO_TOTAL) {
    const c = await competenciaPorAnoMes(ano, mes);
    const [linhas, valores] = await Promise.all([
      estrutura(),
      getPrismaClient().resultadoApurado.findMany({
        where: { competenciaId: c.id, unidadeNegocioId: null, centroCustoId: null },
        select: { linhaDREId: true, valor: true, composicao: true, apuradoEm: true, congelado: true },
      }),
    ]);
    const m = montarLinhas(linhas, valores, acesso);
    // O % e o R$/m³ (13/11/2026), sobre os valores gravados do próprio Consolidado.
    const gravados = basesGravadas(linhas, valores);
    return { competencia: { ano, mes, status: c.status }, ...m, linhas: comParticipacoes(m.linhas, 0, gravados, gravados) };
  },

  /**
   * Os agrupamentos de centros de custo com lançamento apurado no mês. O total
   * de cada um é o da DRE do centro na tela: só as contas das atribuições que
   * ela mostra (recorteCentros), somadas pelas atribuições com valor. Os
   * agrupamentos sem nada a mostrar ficam de fora.
   */
  async listarCentros(ano: number, mes: number, acesso: Acesso = ACESSO_TOTAL) {
    const c = await competenciaPorAnoMes(ano, mes);
    const linhas = await estrutura();
    // Os apurados ou, antes da apuração, os da hora (15/10/2026); só as contas (ITEM).
    const porId = new Map(linhas.map((l) => [l.id, l]));
    const valores = (await valoresDosCentros(c.id, linhas)).flatMap((v) => {
      const l = porId.get(v.linhaDREId);
      return l && l.tipo === "ITEM" ? [{ ...v, linhaDRE: { codigo: l.codigo } }] : [];
    });
    const permitidas = atribuicoesDoCentro(linhas);
    type Grupo = { departamentos: Set<string>; centros: Set<string>; atribuicoes: Map<string, Prisma.Decimal> };
    const grupos = new Map<string, Grupo>();
    for (const v of valores) {
      const cc = v.centroCusto!;
      if (!podeVerCentro(acesso, cc)) continue; // recorte do Gestor e do Coordenador
      const g = grupoDoCentro(cc);
      const x = grupos.get(g) ?? { departamentos: new Set<string>(), centros: new Set<string>(), atribuicoes: new Map<string, Prisma.Decimal>() };
      if (cc.departamento) x.departamentos.add(cc.departamento);
      x.centros.add(cc.id);
      const a = prefixoDaAtribuicao(v.linhaDRE.codigo);
      if (permitidas.has(a)) x.atribuicoes.set(a, (x.atribuicoes.get(a) ?? new Prisma.Decimal(0)).plus(v.valor));
      grupos.set(g, x);
    }
    // Como na tela: a atribuição só conta se tiver valor (em centavos, como lá).
    const total = (g: Grupo) => [...g.atribuicoes.values()].map((v) => v.toDecimalPlaces(2)).filter((v) => !v.isZero());
    return {
      competencia: { ano, mes, status: c.status },
      apuradoEm: valores[0]?.apuradoEm ?? null,
      grupos: [...grupos]
        .filter(([, g]) => total(g).length > 0)
        .sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
        .map(([grupo, g]) => ({
          grupo,
          departamentos: [...g.departamentos].sort(),
          centros: g.centros.size,
          total: total(g).reduce((s, v) => s.plus(v), new Prisma.Decimal(0)).toFixed(2),
        })),
    };
  },

  /** A DRE de um agrupamento de centros de custo: a soma dos centros, com a parte de cada um. */
  async consultarCentros(ano: number, mes: number, grupo: string, acesso: Acesso = ACESSO_TOTAL) {
    const c = await competenciaPorAnoMes(ano, mes);
    const linhas = await estrutura();
    const valores = await valoresDosCentros(c.id, linhas);
    // Recorte do Gestor: só os centros e as linhas dos departamentos dele; do Coordenador, só os centros dele.
    const permitidas = new Set(linhas.filter((l) => podeVerLinhaNoCentro(acesso, l)).map((l) => l.id));
    const doGrupo = valores.filter((v) => grupoDoCentro(v.centroCusto!) === grupo && podeVerCentro(acesso, v.centroCusto!) && permitidas.has(v.linhaDREId));
    if (doGrupo.length === 0) throw new RegraDREError(404, `Nenhum valor para o centro de custo ${grupo} em ${rotulo(ano, mes)}.`);
    type Parte = { codigoRM: string | null; nome: string; valor: string };
    const porLinha = new Map<string, { valor: Prisma.Decimal; centros: Parte[] }>();
    for (const v of doGrupo) {
      const a = porLinha.get(v.linhaDREId) ?? { valor: new Prisma.Decimal(0), centros: [] };
      a.valor = a.valor.plus(v.valor);
      a.centros.push({ codigoRM: v.centroCusto!.codigoRM, nome: v.centroCusto!.nomeRM, valor: v.valor.toFixed(2) });
      porLinha.set(v.linhaDREId, a);
    }
    const porCodigo = (a: { codigoRM: string | null }, b: { codigoRM: string | null }) => (a.codigoRM ?? "").localeCompare(b.codigoRM ?? "");
    const centros = new Map(doGrupo.map((v) => [v.centroCusto!.id, { codigoRM: v.centroCusto!.codigoRM, nome: v.centroCusto!.nomeRM }]));
    // O % e o R$/m³ (13/11/2026), sobre as bases do Consolidado, como nos Resultados Empresariais.
    const bases = await basesDoConsolidadoDoMes(c.id);
    const linhasDoGrupo = linhas
      .filter((l) => l.tipo === "SECAO" || porLinha.has(l.id))
      .map((l) => {
        const a = porLinha.get(l.id);
        return {
          codigo: l.codigo,
          tipo: l.tipo,
          grupo: l.grupo,
          grupoSigla: l.grupoSigla,
          descricao: l.descricao,
          valor: a?.valor.toFixed(2) ?? null,
          composicao: a && centros.size > 1 ? { regra: "Soma dos centros do agrupamento", centros: a.centros.sort(porCodigo) } : null,
          podeDetalhar: podeVerSensiveis(acesso, l),
        };
      });
    return {
      competencia: { ano, mes, status: c.status },
      grupo,
      centros: [...centros.values()].sort(porCodigo),
      apuradoEm: doGrupo[0].apuradoEm,
      congelado: doGrupo.some((v) => v.congelado),
      // Na tela e no Exportar, o total de cada grupo é a soma das atribuições mostradas (linhasDoCentro): o % e o R$/m³ dele,
      // sobre esse valor.
      linhas: (() => {
        const mostradas = new Map(comParticipacoes(linhasDoCentro(linhasDoGrupo), "centros", bases).map((l) => [l.codigo, l]));
        return comParticipacoes(linhasDoGrupo, "centros", bases).map((l) => {
          const m = mostradas.get(l.codigo);
          return m ? { ...l, pct: m.pct, unitario: m.unitario } : l;
        });
      })(),
    };
  },
};
