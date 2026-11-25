import { getPrismaClient } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { LinhaPlanilha } from "../../lib/xlsx.js";
import { ACESSO_TOTAL, type Acesso } from "../acesso/acesso.js";
import { podeVerMovimentos } from "../acesso/recorteDepartamento.js";
import { apuracaoService } from "../apuracao/apuracaoService.js";
import { auditar } from "../auditoriaService.js";
import { interpretarBalancete } from "../importacoes/balancete/leiauteBalancete.js";

/**
 * Detecção de divergência retroativa (Passo 24, RF010).
 *
 * Quando chega dado de uma competência já fechada (balancete) ou já apurada
 * (preço de contrato), o sistema compara com o que está gravado e registra as
 * diferenças. A detecção nunca altera a competência: o retrato congelado fica
 * como está, e a divergência é tratada por justificativa ou resolvida por
 * reabertura (ou, no preço de um mês ainda aberto, pela reapuração).
 *
 * - Balancete: por filial + centro de custo + conta, o movimento gravado contra
 *   o recebido. Vale para o balancete enviado à própria competência fechada
 *   (importação só de comparação) e para os outros meses fechados do mesmo
 *   ano que vêm no arquivo — o balancete do RM traz o exercício inteiro.
 * - Preço de contrato: cada preço substituído na reimportação da DRE do
 *   Comercial que valorou a receita de uma competência apurada, com o efeito
 *   na receita (quantidade × diferença do preço).
 *
 * Uma diferença já registrada com o mesmo valor recebido não é repetida.
 */

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;
const CENTAVO = new Decimal("0.005");
const rotulo = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;

export class RegraDivergenciaError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Compara o balancete (as linhas da aba já lidas) com o gravado na competência
 * e registra as diferenças novas. Devolve quantas foram registradas, ou nulo
 * se o arquivo não traz o mês.
 */
export async function compararBalancete(linhas: LinhaPlanilha[], competencia: { id: string; ano: number; mes: number }, importacaoId: string) {
  const leitura = interpretarBalancete(linhas, competencia.ano, competencia.mes);
  if (!leitura.ok) return null;
  const prisma = getPrismaClient();
  const chave = (filial: number, centro: string | null, conta: string) => `${filial}|${centro ?? ""}|${conta}`;

  const recebido = new Map<string, { filial: number; centro: string | null; conta: string; valor: Decimal; nomeCentro: string | null; nomeConta: string | null }>();
  for (const l of leitura.lancamentos) {
    const k = chave(l.filial, l.codigoCentroCusto, l.reduzido);
    const a = recebido.get(k) ?? { filial: l.filial, centro: l.codigoCentroCusto, conta: l.reduzido, valor: new Decimal(0), nomeCentro: l.nomeCentroCusto, nomeConta: l.descricaoConta };
    a.valor = a.valor.plus(l.valorMovimento);
    recebido.set(k, a);
  }
  const gravados = await prisma.lancamentoContabil.findMany({
    where: { competenciaId: competencia.id },
    orderBy: [{ filial: "asc" }, { codigoCentroCusto: { sort: "asc", nulls: "first" } }, { linhaArquivo: "asc" }],
    select: { filial: true, codigoCentroCusto: true, nomeCentroCusto: true, valorMovimento: true, contaResultado: { select: { reduzido: true, descricao: true } } },
  });
  const gravado = new Map<string, { filial: number; centro: string | null; conta: string; valor: Decimal; nomeCentro: string | null; nomeConta: string | null }>();
  for (const g of gravados) {
    const k = chave(g.filial, g.codigoCentroCusto, g.contaResultado.reduzido);
    const a = gravado.get(k) ?? { filial: g.filial, centro: g.codigoCentroCusto, conta: g.contaResultado.reduzido, valor: new Decimal(0), nomeCentro: g.nomeCentroCusto, nomeConta: g.contaResultado.descricao };
    a.valor = a.valor.plus(g.valorMovimento);
    gravado.set(k, a);
  }

  const [contas, centros, existentes] = await Promise.all([
    prisma.contaResultado.findMany({ select: { id: true, reduzido: true } }),
    prisma.centroCusto.findMany({ where: { codigoRM: { not: null } }, select: { id: true, codigoRM: true } }),
    prisma.divergencia.findMany({
      where: { competenciaId: competencia.id, tipo: "BALANCETE" },
      select: { filial: true, codigoCentroCusto: true, codigoConta: true, valorRecebido: true },
    }),
  ]);
  const contaId = new Map(contas.map((c) => [c.reduzido, c.id]));
  const centroId = new Map(centros.map((c) => [c.codigoRM!, c.id]));
  const jaRegistradas = new Set(existentes.map((e) => `${chave(e.filial ?? 0, e.codigoCentroCusto, e.codigoConta ?? "")}|${e.valorRecebido.toFixed(2)}`));

  const novas: Prisma.DivergenciaCreateManyInput[] = [];
  for (const k of new Set([...recebido.keys(), ...gravado.keys()])) {
    const r = recebido.get(k);
    const g = gravado.get(k);
    const vr = r?.valor ?? new Decimal(0);
    const vg = g?.valor ?? new Decimal(0);
    const dif = vr.minus(vg);
    if (dif.abs().lessThanOrEqualTo(CENTAVO)) continue;
    const base = (r ?? g)!;
    if (jaRegistradas.has(`${k}|${vr.toFixed(2)}`)) continue;
    const centro = base.centro ? `${base.centro}${(r?.nomeCentro ?? g?.nomeCentro) ? ` ${r?.nomeCentro ?? g?.nomeCentro}` : ""}` : "sem centro";
    novas.push({
      competenciaId: competencia.id,
      tipo: "BALANCETE",
      importacaoId,
      filial: base.filial,
      codigoCentroCusto: base.centro,
      codigoConta: base.conta,
      contaResultadoId: contaId.get(base.conta) ?? null,
      centroCustoId: base.centro ? (centroId.get(base.centro) ?? null) : null,
      descricao: `Filial ${base.filial} · ${centro} · conta ${base.conta}${(r?.nomeConta ?? g?.nomeConta) ? ` ${r?.nomeConta ?? g?.nomeConta}` : ""}${!g ? " (nova no arquivo)" : !r ? " (ausente no arquivo)" : ""}`,
      valorGravado: vg,
      valorRecebido: vr,
      diferenca: dif,
    });
  }
  for (let i = 0; i < novas.length; i += 500) await prisma.divergencia.createMany({ data: novas.slice(i, i + 500) });
  return { registradas: novas.length, diferenca: novas.reduce((a, n) => a.plus(n.diferenca as Decimal), new Decimal(0)).toFixed(2) };
}

/** A substituição de um preço na reimportação da DRE do Comercial. */
export type SubstituicaoPreco = { anteriorId: string; valorAnterior: Decimal | null; valorNovo: Decimal | null };

/** Registra os preços substituídos que valoraram a receita de competências apuradas. */
export async function detectarPrecos(importacaoId: string, substituicoes: SubstituicaoPreco[]) {
  if (substituicoes.length === 0) return [];
  const prisma = getPrismaClient();
  const porId = new Map(substituicoes.map((s) => [s.anteriorId, s]));
  const ids = [...porId.keys()];
  const itens = await prisma.receitaPreviaItem.findMany({
    where: {
      OR: [{ precoBrutoId: { in: ids } }, { precoLiquidoId: { in: ids } }],
      receitaPrevia: { competencia: { apuradaEm: { not: null } } },
    },
    select: {
      quantidade: true,
      precoBrutoId: true,
      precoLiquidoId: true,
      receitaPrevia: { select: { competencia: { select: { id: true, ano: true, mes: true } } } },
    },
  });
  // Por competência e preço: a quantidade que ele valorou.
  const grupos = new Map<string, { competencia: { id: string; ano: number; mes: number }; precoId: string; quantidade: Decimal }>();
  for (const it of itens) {
    for (const precoId of [it.precoBrutoId, it.precoLiquidoId]) {
      if (!precoId || !porId.has(precoId)) continue;
      const c = it.receitaPrevia.competencia;
      const k = `${c.id}|${precoId}`;
      const g = grupos.get(k) ?? { competencia: c, precoId, quantidade: new Decimal(0) };
      g.quantidade = g.quantidade.plus(it.quantidade ?? 0);
      grupos.set(k, g);
    }
  }
  const precos = new Map(
    (
      await prisma.precoContrato.findMany({
        where: { id: { in: [...new Set([...grupos.values()].map((g) => g.precoId))] } },
        select: { id: true, obraId: true, linhaTexto: true, contaResultado: true, etapa: true, obra: { select: { codigo: true } } },
      })
    ).map((p) => [p.id, p]),
  );
  const existentes = new Set(
    (await prisma.divergencia.findMany({ where: { tipo: "PRECO_CONTRATO", precoContratoId: { in: ids } }, select: { competenciaId: true, precoContratoId: true } })).map(
      (d) => `${d.competenciaId}|${d.precoContratoId}`,
    ),
  );
  const novas: Prisma.DivergenciaCreateManyInput[] = [];
  const resumo: Array<{ competencia: string; obra: string; impacto: string }> = [];
  for (const g of grupos.values()) {
    if (existentes.has(`${g.competencia.id}|${g.precoId}`)) continue;
    const s = porId.get(g.precoId)!;
    const p = precos.get(g.precoId)!;
    const antes = s.valorAnterior ?? new Decimal(0);
    const depois = s.valorNovo ?? new Decimal(0);
    const impacto = g.quantidade.times(depois.minus(antes));
    novas.push({
      competenciaId: g.competencia.id,
      tipo: "PRECO_CONTRATO",
      importacaoId,
      obraId: p.obraId,
      precoContratoId: g.precoId,
      descricao: `Obra ${p.obra.codigo} · ${p.linhaTexto}${p.etapa ? ` · etapa ${p.etapa}` : ""} · ${p.contaResultado}${s.valorNovo === null ? " (preço retirado da DRE)" : ""}`,
      valorGravado: antes,
      valorRecebido: depois,
      diferenca: depois.minus(antes),
      impacto,
    });
    resumo.push({ competencia: rotulo(g.competencia.ano, g.competencia.mes), obra: p.obra.codigo, impacto: impacto.toFixed(2) });
  }
  if (novas.length) await prisma.divergencia.createMany({ data: novas });
  return resumo;
}

export type FiltroDivergencias = { ano?: number; mes?: number; tipo?: "BALANCETE" | "PRECO_CONTRATO"; status?: string; pagina: number; porPagina: number };

/**
 * O recorte do Gestor por departamento vale para as divergências (decisão de
 * 30/09/2026): só as de balancete em contas dos seus departamentos; as de
 * preço (receita) não são de departamento nenhum.
 */
async function filtroDoAcesso(acesso: Acesso): Promise<Prisma.DivergenciaWhereInput> {
  if (!acesso.recorteDepartamento) return {};
  const linhas = await getPrismaClient().linhaDRE.findMany({ select: { id: true, codigo: true, grupoSigla: true, descricao: true } });
  const permitidas = linhas.filter((l) => podeVerMovimentos(acesso, l)).map((l) => l.id);
  const contas = await getPrismaClient().contaResultado.findMany({ where: { linhaDREId: { in: permitidas } }, select: { id: true } });
  return { tipo: "BALANCETE", contaResultadoId: { in: contas.map((c) => c.id) } };
}

export const divergenciasService = {
  async listar(f: FiltroDivergencias, acesso: Acesso = ACESSO_TOTAL) {
    const prisma = getPrismaClient();
    const where: Prisma.DivergenciaWhereInput = {
      AND: [
        await filtroDoAcesso(acesso),
        f.ano ? { competencia: { ano: f.ano, ...(f.mes ? { mes: f.mes } : {}) } } : {},
        f.tipo ? { tipo: f.tipo } : {},
        f.status ? { status: f.status as never } : {},
      ],
    };
    const [itens, total, porCompetencia] = await Promise.all([
      prisma.divergencia.findMany({
        where,
        orderBy: [{ detectadaEm: "desc" }, { diferenca: "desc" }, { filial: "asc" }, { codigoCentroCusto: { sort: "asc", nulls: "first" } }, { codigoConta: { sort: "asc", nulls: "first" } }, { id: "asc" }],
        skip: (f.pagina - 1) * f.porPagina,
        take: f.porPagina,
        select: {
          id: true,
          tipo: true,
          status: true,
          descricao: true,
          valorGravado: true,
          valorRecebido: true,
          diferenca: true,
          impacto: true,
          detectadaEm: true,
          justificativa: true,
          tratadaEm: true,
          tratadaPor: true,
          competencia: { select: { ano: true, mes: true, status: true } },
          importacao: { select: { nomeArquivo: true, importadoEm: true, comparacao: true } },
        },
      }),
      prisma.divergencia.count({ where }),
      prisma.divergencia.groupBy({ by: ["competenciaId", "status"], where, _count: true }),
    ]);
    const nomes = new Map(
      (await prisma.usuario.findMany({ where: { id: { in: itens.map((i) => i.tratadaPor).filter((x): x is string => !!x) } }, select: { id: true, nome: true } })).map((u) => [u.id, u.nome]),
    );
    const competencias = new Map(
      (await prisma.competencia.findMany({ where: { id: { in: [...new Set(porCompetencia.map((p) => p.competenciaId))] } }, select: { id: true, ano: true, mes: true, status: true } })).map(
        (c) => [c.id, c],
      ),
    );
    const resumo = new Map<string, { ano: number; mes: number; status: string; abertas: number; total: number }>();
    for (const p of porCompetencia) {
      const c = competencias.get(p.competenciaId)!;
      const r = resumo.get(p.competenciaId) ?? { ano: c.ano, mes: c.mes, status: c.status, abertas: 0, total: 0 };
      r.total += p._count;
      if (p.status === "ABERTA") r.abertas += p._count;
      resumo.set(p.competenciaId, r);
    }
    return {
      itens: itens.map((i) => ({
        ...i,
        valorGravado: i.valorGravado.toFixed(2),
        valorRecebido: i.valorRecebido.toFixed(2),
        diferenca: i.diferenca.toFixed(2),
        impacto: i.impacto?.toFixed(2) ?? null,
        tratadaPor: i.tratadaPor ? (nomes.get(i.tratadaPor) ?? i.tratadaPor) : null,
      })),
      total,
      pagina: f.pagina,
      porPagina: f.porPagina,
      competencias: [...resumo.values()].sort((a, b) => b.ano - a.ano || b.mes - a.mes),
    };
  },

  /** Quantas divergências abertas o usuário alcança — o aviso ao entrar no sistema. */
  async contarAbertas(acesso: Acesso = ACESSO_TOTAL) {
    return getPrismaClient().divergencia.count({ where: { AND: [await filtroDoAcesso(acesso), { status: "ABERTA" }] } });
  },

  /** Justifica divergências abertas: ficam registradas, e a competência continua como está. */
  async justificar(ids: string[], justificativa: string, quem: string) {
    const texto = justificativa.trim();
    if (texto.length < 15) throw new RegraDivergenciaError(400, "A justificativa precisa explicar a divergência (ao menos 15 caracteres).");
    const prisma = getPrismaClient();
    const abertas = await prisma.divergencia.findMany({ where: { id: { in: ids }, status: "ABERTA" }, select: { id: true, descricao: true, diferenca: true } });
    if (abertas.length === 0) throw new RegraDivergenciaError(409, "Nenhuma das divergências escolhidas está aberta.");
    const agora = new Date();
    await prisma.divergencia.updateMany({ where: { id: { in: abertas.map((a) => a.id) } }, data: { status: "JUSTIFICADA", justificativa: texto, tratadaEm: agora, tratadaPor: quem } });
    for (const a of abertas) {
      await auditar({
        usuarioId: quem,
        acao: "JUSTIFICATIVA",
        entidade: "divergencia",
        entidadeId: a.id,
        antes: { status: "ABERTA" },
        depois: { status: "JUSTIFICADA", justificativa: texto },
        metadados: { descricao: a.descricao, diferenca: a.diferenca.toFixed(2) },
      });
    }
    return { justificadas: abertas.length };
  },

  /**
   * Resolve as divergências abertas de uma competência fechada pela reabertura
   * (o fluxo do Passo 21, com justificativa). Depois de reaberta, a competência
   * recebe o dado novo e é reapurada.
   */
  async resolverPorReabertura(ano: number, mes: number, justificativa: string, quem: string) {
    const prisma = getPrismaClient();
    const c = await prisma.competencia.findUnique({ where: { ano_mes: { ano, mes } }, select: { id: true, status: true } });
    if (!c) throw new RegraDivergenciaError(404, `A competência ${rotulo(ano, mes)} não existe.`);
    if (c.status !== "FECHADA") throw new RegraDivergenciaError(409, `A competência ${rotulo(ano, mes)} não está fechada; reapure-a para incorporar o dado novo.`);
    const abertas = await prisma.divergencia.findMany({ where: { competenciaId: c.id, status: "ABERTA" }, select: { id: true } });
    if (abertas.length === 0) throw new RegraDivergenciaError(409, `A competência ${rotulo(ano, mes)} não tem divergência aberta.`);
    const situacao = await apuracaoService.reabrir(ano, mes, justificativa, quem);
    await prisma.divergencia.updateMany({
      where: { id: { in: abertas.map((a) => a.id) } },
      data: { status: "RESOLVIDA_POR_REABERTURA", justificativa: justificativa.trim(), tratadaEm: new Date(), tratadaPor: quem },
    });
    await auditar({
      usuarioId: quem,
      acao: "RESOLUCAO",
      entidade: "divergencia",
      entidadeId: c.id,
      antes: { status: "ABERTA", divergencias: abertas.length },
      depois: { status: "RESOLVIDA_POR_REABERTURA" },
      metadados: { competencia: rotulo(ano, mes), justificativa: justificativa.trim(), ids: abertas.map((a) => a.id) },
    });
    return { resolvidas: abertas.length, situacao };
  },

  /**
   * Na reapuração de uma competência aberta, as divergências de preço abertas
   * dela se resolvem: a receita passa a usar o preço vigente.
   */
  async resolverPrecosPorReapuracao(competenciaId: string, quem: string) {
    const prisma = getPrismaClient();
    const abertas = await prisma.divergencia.findMany({ where: { competenciaId, tipo: "PRECO_CONTRATO", status: "ABERTA" }, select: { id: true } });
    if (abertas.length === 0) return 0;
    await prisma.divergencia.updateMany({
      where: { id: { in: abertas.map((a) => a.id) } },
      data: { status: "RESOLVIDA_POR_REAPURACAO", justificativa: "Competência reapurada com o preço vigente.", tratadaEm: new Date(), tratadaPor: quem },
    });
    await auditar({ usuarioId: quem, acao: "RESOLUCAO", entidade: "divergencia", entidadeId: competenciaId, depois: { status: "RESOLVIDA_POR_REAPURACAO" }, metadados: { ids: abertas.map((a) => a.id) } });
    return abertas.length;
  },
};
