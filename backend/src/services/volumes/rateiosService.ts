import { getPrismaClient } from "../../config/prisma.js";
import { calcularPercentuais } from "./percentuaisRateio.js";
import { LINHAS_TOTAIS, type CodigoTotais } from "./totaisOperacao.js";
import { descreverVigencia } from "./vigenciasRateio.js";
import { totaisDaCompetencia } from "./volumesService.js";

/** As chaves de rateio e os nomes delas. */
export const CHAVES_DE_RATEIO = ["PROJETO", "PRODUCAO", "METALURGIA", "ARMADURA", "ACOMPANHAMENTO"] as const;
export const NOME_DA_CHAVE: Record<string, string> = { PROJETO: "Projeto", PRODUCAO: "Produção", METALURGIA: "Metalurgia", ARMADURA: "Armadura", ACOMPANHAMENTO: "Acompanhamento" };

/** Erro de regra — vira 400/404/409 no controller, não 500. */
export class RegraRateioError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

const rotulo = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;

async function competenciaPorAnoMes(ano: number, mes: number) {
  const c = await getPrismaClient().competencia.findUnique({
    where: { ano_mes: { ano, mes } },
    select: { id: true, ano: true, mes: true, status: true },
  });
  if (!c) throw new RegraRateioError(404, `A competência ${rotulo(ano, mes)} não existe.`);
  return c;
}

/** Regras vigentes no mês: início até o dia 1º, e sem fim ou fim depois dele. */
async function regrasVigentes(ano: number, mes: number) {
  const inicioMes = new Date(Date.UTC(ano, mes - 1, 1));
  return getPrismaClient().regraRateio.findMany({
    where: { vigenciaInicio: { lte: inicioMes }, OR: [{ vigenciaFim: null }, { vigenciaFim: { gte: inicioMes } }] },
    orderBy: [{ ordem: "asc" }],
    select: { id: true, chave: true, destino: true, origemDoVolume: true, baseFisica: true, rotulo: true, unidadeDestinoId: true, percentualFixo: true },
  });
}

export const rateiosService = {
  /**
   * Apura os volumes e os percentuais da competência a partir das listas
   * gravadas e grava o retrato, substituindo a apuração anterior. O retrato
   * congelado (Passo 21) não é refeito.
   */
  async apurar(ano: number, mes: number) {
    const c = await competenciaPorAnoMes(ano, mes);
    if (c.status === "FECHADA") throw new RegraRateioError(409, `A competência ${rotulo(ano, mes)} está fechada. Reapurar exige reabri-la.`);
    const prisma = getPrismaClient();
    if (await prisma.volumeOperacional.count({ where: { competenciaId: c.id, congelado: true } })) {
      throw new RegraRateioError(409, `Os rateios de ${rotulo(ano, mes)} estão congelados pela apuração da competência. Para recalcular, reapure a competência (tela da DRE).`);
    }
    const [regras, totais] = await Promise.all([regrasVigentes(ano, mes), totaisDaCompetencia(c.id)]);
    if (regras.length === 0) throw new RegraRateioError(409, "Não há regras de rateio vigentes. Carregue o cadastro.");
    const porCodigo = new Map(totais.map((t) => [t.codigo as string, t.quantidade]));
    const calculados = calcularPercentuais(
      regras.map((r) => ({ id: r.id, chave: r.chave, destino: r.destino, origem: r.origemDoVolume as CodigoTotais, fixo: r.percentualFixo })),
      porCodigo,
    );
    const unidadePorRegra = new Map(regras.map((r) => [r.id, r.unidadeDestinoId]));
    const agora = new Date();
    await prisma.$transaction([
      prisma.volumeOperacional.deleteMany({ where: { competenciaId: c.id } }),
      prisma.volumeOperacional.createMany({
        data: calculados.map((p) => ({
          competenciaId: c.id,
          regraRateioId: p.id,
          unidadeNegocioId: unidadePorRegra.get(p.id)!,
          quantidade: p.quantidade,
          percentual: p.percentual,
          apuradoEm: agora,
        })),
      }),
    ]);
    // As chaves sem regra vigente no mês (14/10/2026): os lançamentos de rateio delas não vão para nenhuma unidade.
    const avisos = CHAVES_DE_RATEIO.filter((k) => !regras.some((r) => r.chave === k)).map(
      (k) => `Rateio de ${NOME_DA_CHAVE[k]} sem regra vigente em ${rotulo(ano, mes)}: os lançamentos de rateio dele não vão para nenhuma unidade. Cadastre a regra em Cadastros Gerais / Regras de Rateio.`,
    );
    return { ...(await this.consultar(ano, mes)), avisos };
  },

  /**
   * Os percentuais apurados, por chave, com a memória de cálculo: o volume de
   * cada destino, a linha dos Totais de onde veio e o total da chave. Traz
   * também os Totais de hoje, para mostrar se as listas mudaram depois da
   * apuração.
   */
  async consultar(ano: number, mes: number) {
    const c = await competenciaPorAnoMes(ano, mes);
    const prisma = getPrismaClient();
    const [volumes, totais] = await Promise.all([
      prisma.volumeOperacional.findMany({
        where: { competenciaId: c.id },
        select: {
          quantidade: true,
          percentual: true,
          apuradoEm: true,
          congelado: true,
          regraRateio: { select: { chave: true, destino: true, origemDoVolume: true, baseFisica: true, rotulo: true, ordem: true, percentualFixo: true } },
        },
        orderBy: { regraRateio: { ordem: "asc" } },
      }),
      totaisDaCompetencia(c.id),
    ]);
    const totalAtual = new Map(totais.map((t) => [t.codigo as string, t.quantidade]));
    // Os lançamentos de rateio do mês por chave (13/10/2026): numa chave sem volume, ficam fora de todas as unidades.
    // As receitas e despesas financeiras do acompanhamento vão inteiras para Despesas e Extra e não contam.
    // Os redistribuídos (13/11/2026) pelas partes, na chave do centro de cada destino.
    const foraDaChave = { NOT: { AND: [{ balde: "ACOMPANHAMENTO" as const }, { linhaDRE: { grupoSigla: { in: ["RFC", "RFNC", "DFC", "DFNC"] } } }] } };
    const [deRateio, partesDeRateio] = await Promise.all([
      prisma.lancamentoContabil.groupBy({ by: ["balde"], where: { competenciaId: c.id, redistribuicaoId: null, alocacao: "RATEIO", ...foraDaChave }, _sum: { valorMovimento: true } }),
      prisma.lancamentoRedistribuido.groupBy({ by: ["balde"], where: { competenciaId: c.id, alocacao: "RATEIO", ...foraDaChave }, _sum: { valorMovimento: true } }),
    ]);
    const lancadoNaChave = new Map<string, number>();
    for (const x of [...deRateio, ...partesDeRateio]) lancadoNaChave.set(x.balde as string, (lancadoNaChave.get(x.balde as string) ?? 0) + Number(x._sum.valorMovimento ?? 0));
    const chaves = new Map<string, { chave: string; baseFisica: string; total: number; percentual: number; destinos: unknown[] }>();
    for (const v of volumes) {
      const r = v.regraRateio;
      const k = chaves.get(r.chave) ?? { chave: r.chave, baseFisica: r.baseFisica, total: 0, percentual: 0, destinos: [] };
      k.total += Number(v.quantidade);
      k.percentual += Number(v.percentual);
      const atual = totalAtual.get(r.origemDoVolume);
      k.destinos.push({
        destino: r.destino,
        rotulo: r.rotulo,
        origem: r.origemDoVolume,
        quantidade: v.quantidade.toFixed(3),
        percentual: v.percentual.toFixed(10),
        // O percentual fixo da regra (14/10/2026): o volume aparece, mas não dá o percentual.
        fixo: r.percentualFixo !== null,
        /**
         * Volume de hoje, se as listas mudaram depois da apuração. Compara com
         * as três casas das listas: as somas guardam resíduo de ponto flutuante
         * (6806.303000000003), que não é mudança.
         */
        quantidadeAtual: atual && atual.toFixed(3) !== v.quantidade.toFixed(3) ? atual.toFixed(3) : null,
      });
      chaves.set(r.chave, k);
    }
    return {
      competencia: { ano, mes, status: c.status },
      apuradoEm: volumes[0]?.apuradoEm ?? null,
      congelado: volumes.some((v) => v.congelado),
      chaves: [...chaves.values()].map(({ percentual, ...k }) => ({
        ...k,
        total: k.total.toFixed(3),
        // A chave sem percentual (sem volume, ou sem regra fixa) com lançamentos de rateio no mês: o valor que não vai para
        // nenhuma unidade.
        semVolume: percentual === 0 && lancadoNaChave.get(k.chave) ? lancadoNaChave.get(k.chave)!.toFixed(2) : null,
      })),
      totais: totais.map((t) => ({ codigo: t.codigo, rotulo: t.rotulo, medida: t.medida, tipo: t.tipo, quantidade: t.quantidade.toFixed(3) })),
    };
  },

  /**
   * As regras de rateio vigentes no mês, para a consulta do modal Contestar (04/11/2026, pedido do Adão): por chave, quantos
   * centros de custo ativos e quantas contas ativas a usam (o balde do lançamento é o do centro; sem centro, o da conta), a
   * vigência, se a divisão é pelo volume ou por percentuais fixos e os destinos — a unidade, o percentual do mês (o apurado;
   * sem a apuração, o fixo ou nulo), o volume de origem e as linhas de cada um. Também os baldes diretos, que não se rateiam.
   */
  async vigentes(ano: number, mes: number) {
    const c = await competenciaPorAnoMes(ano, mes);
    const prisma = getPrismaClient();
    const inicioMes = new Date(Date.UTC(ano, mes - 1, 1));
    const [regras, volumes, centros, contas] = await Promise.all([
      prisma.regraRateio.findMany({
        where: { vigenciaInicio: { lte: inicioMes }, OR: [{ vigenciaFim: null }, { vigenciaFim: { gte: inicioMes } }] },
        orderBy: [{ ordem: "asc" }],
        select: {
          id: true,
          chave: true,
          destino: true,
          rotulo: true,
          baseFisica: true,
          origemDoVolume: true,
          vigenciaInicio: true,
          vigenciaFim: true,
          percentualFixo: true,
          unidadeDestino: { select: { nome: true } },
          linhas: { select: { percentual: true, linha: { select: { nome: true, ordem: true } } } },
        },
      }),
      prisma.volumeOperacional.findMany({ where: { competenciaId: c.id }, select: { regraRateioId: true, quantidade: true, percentual: true } }),
      prisma.centroCusto.groupBy({ by: ["balde"], where: { ativo: true }, _count: { _all: true } }),
      prisma.contaResultado.groupBy({ by: ["balde"], where: { ativo: true, tipoConta: "ANALITICA", linhaDREId: { not: null } }, _count: { _all: true } }),
    ]);
    const doMes = new Map(volumes.map((v) => [v.regraRateioId, v]));
    const daOrigem = new Map<string, { rotulo: string; medida: string }>(LINHAS_TOTAIS.map((t) => [t.codigo, { rotulo: t.rotulo, medida: t.medida }]));
    const centrosNoBalde = new Map(centros.map((x) => [x.balde as string | null, x._count._all]));
    const contasNoBalde = new Map(contas.map((x) => [x.balde as string | null, x._count._all]));
    const ehChave = (balde: string | null) => !!balde && (CHAVES_DE_RATEIO as readonly string[]).includes(balde);
    return {
      competencia: { ano, mes, status: c.status },
      apurado: volumes.length > 0,
      chaves: CHAVES_DE_RATEIO.map((chave) => {
        const rs = regras.filter((r) => r.chave === chave);
        return {
          chave,
          nome: NOME_DA_CHAVE[chave],
          centros: centrosNoBalde.get(chave) ?? 0,
          contas: contasNoBalde.get(chave) ?? 0,
          baseFisica: rs[0]?.baseFisica ?? null,
          fixo: rs.some((r) => r.percentualFixo !== null),
          vigencias: [...new Set(rs.map((r) => descreverVigencia({ inicio: r.vigenciaInicio, fim: r.vigenciaFim })))],
          destinos: rs.map((r) => {
            const v = doMes.get(r.id);
            return {
              destino: r.destino,
              unidade: r.unidadeDestino.nome,
              rotulo: r.rotulo,
              origem: daOrigem.get(r.origemDoVolume)?.rotulo ?? r.origemDoVolume,
              medida: daOrigem.get(r.origemDoVolume)?.medida ?? null,
              quantidade: v ? v.quantidade.toFixed(3) : null,
              percentual: v ? v.percentual.toFixed(10) : (r.percentualFixo?.toFixed(10) ?? null),
              percentualFixo: r.percentualFixo?.toFixed(10) ?? null,
              linhas: r.linhas
                .sort((a, b) => a.linha.ordem - b.linha.ordem || a.linha.nome.localeCompare(b.linha.nome, "pt-BR"))
                .map((l) => ({ nome: l.linha.nome, percentual: l.percentual.toFixed(10) })),
            };
          }),
        };
      }),
      diretos: [...new Set([...centrosNoBalde.keys(), ...contasNoBalde.keys()])]
        .filter((balde): balde is string => !!balde && !ehChave(balde))
        .map((balde) => ({ balde, centros: centrosNoBalde.get(balde) ?? 0, contas: contasNoBalde.get(balde) ?? 0 }))
        .sort((a, b) => b.centros + b.contas - (a.centros + a.contas)),
    };
  },
};
