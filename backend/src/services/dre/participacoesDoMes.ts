import { getPrismaClient } from "../../config/prisma.js";
import { baseDoPercentual, baseDoUnitario, type VisaoResultados } from "../relatorios/basesResultados.js";

/**
 * O % e o R$/m³ da DRE do mês (13/11/2026, pedido do Adão: Fechamento Mensal / Resultados), com as regras dos Resultados
 * Empresariais (basesResultados.ts): o % sobre a ROB nas receitas e nos impostos, sobre a receita líquida da natureza nos
 * custos de produção, de montagem e complementares e no Frete e Descarga, e sobre a ROL no resto; o R$/m³ do pré-fabricado
 * e dos custos de produção sobre a produção, da montagem sobre a montagem e do Frete e Descarga sobre a expedição; nas
 * obras, sobre a receita da própria obra. As linhas de volume não têm nem um nem outro. As bases são as da própria visão
 * (o Consolidado, Matriz, Filial, Serviços, a obra) ou, em Despesas e Extra, no RN, nos centros de custo e nos movimentos
 * sem centro de custo, as do Consolidado apurado do mês.
 */

type Linha = { codigo: string; tipo: string; grupoSigla: string; valor: string | null };

const divide = (a: number, b: number | undefined) => (b === undefined || b === 0 ? null : Math.round((a / b) * 1e8) / 1e8);

/** As bases do Consolidado apurado do mês: os valores de cada linha (vazio antes da apuração). */
export async function basesDoConsolidadoDoMes(competenciaId: string) {
  const rs = await getPrismaClient().resultadoApurado.findMany({
    where: { competenciaId, unidadeNegocioId: null, centroCustoId: null },
    select: { valor: true, linhaDRE: { select: { codigo: true } } },
  });
  return new Map(rs.map((r) => [r.linhaDRE.codigo, Number(r.valor)]));
}

/** As bases da própria visão: os valores das linhas dela. */
export const basesDasLinhas = (linhas: Linha[]) => new Map(linhas.filter((l) => l.valor !== null).map((l) => [l.codigo, Number(l.valor)]));

/**
 * As linhas com o % (`pct`, a fração: 0,25 = 25%) e o R$/m³ (`unitario`): nulos quando a base é zero ou falta; ausentes
 * (undefined) quando a linha não tem a coluna (as seções, os volumes, as contas sem R$/m³). `gravados`: o valor de cada
 * linha com todas as casas (como nos Resultados Empresariais); sem ele, o da linha.
 */
export function comParticipacoes<L extends Linha>(linhas: L[], visao: VisaoResultados, bases: Map<string, number>, gravados?: Map<string, number>) {
  return linhas.map((l) => {
    if (l.tipo === "SECAO" || l.valor === null) return { ...l, pct: undefined, unitario: undefined };
    const bp = baseDoPercentual(visao, l);
    const bu = baseDoUnitario(l);
    const v = Math.round((gravados?.get(l.codigo) ?? Number(l.valor)) * 1e4) / 1e4;
    return { ...l, pct: bp ? divide(v, bases.get(bp)) : undefined, unitario: bu ? divide(v, bases.get(bu)) : undefined };
  });
}
