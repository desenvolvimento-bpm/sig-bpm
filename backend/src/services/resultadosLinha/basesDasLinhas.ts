import { getPrismaClient } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { chaveDaLinha } from "../../lib/linhas.js";
import { linhaDosTotais, type CodigoTotais, type ItemVolume } from "../volumes/totaisOperacao.js";

/**
 * As bases por linha dos Resultados por Linha (26/10/2026): o volume de cada linha nas listas do mês, pela mesma regra
 * da aba Totais que os rateios da DRE usam (linhaDosTotais) — assim a divisão entre as linhas de uma unidade segue o
 * volume que deu a parte da unidade —, e a receita bruta da Receita Prévia. Cada registro guarda a obra, para levar os
 * custos dos centros de obra às linhas da própria obra.
 */

export type Base = "M3_PRODUZIDO" | "M3_PROJETOS" | "KG_METALURGIA" | "KG_ARMADURA" | "DIAS_ACOMPANHAMENTO" | "RECEITA";

/** Uma linha de produto ou de obra do cadastro (as inativas também: os registros antigos ainda as citam). */
export type LinhaDoNegocio = { id: string; codigo: string; nome: string; unidade: number; ativo: boolean; ordem: number };

/** Um registro de volume das listas: a linha dos Totais em que entra, a linha, a obra e a quantidade. */
export type Volume = { total: CodigoTotais; linhaId: string; obraId: string | null; quantidade: number };
/** Um item da Receita Prévia: a natureza, a unidade, a linha, a obra e as receitas. */
export type ItemDaReceita = { natureza: string; unidade: number; linhaId: string | null; obraCodigo: string | null; bruta: number; liquida: number };

/** A unidade que recebe cada linha dos Totais (as pistas e a expedição seguem a unidade da linha). */
export const UNIDADE_DO_TOTAL = (t: CodigoTotais): number =>
  t.endsWith("_MATRIZ") ? 1 : t.endsWith("_FILIAL") || t === "PREFABRICADO_PISTAS" ? 2 : 3;

/** As linhas dos Totais de cada base de volume. */
const TOTAIS_DA_BASE: Record<Exclude<Base, "RECEITA">, (t: CodigoTotais) => boolean> = {
  M3_PRODUZIDO: (t) => t === "PREFABRICADO_MATRIZ" || t === "PREFABRICADO_FILIAL",
  M3_PROJETOS: (t) => t.startsWith("PROJETOS_"),
  KG_METALURGIA: (t) => t.startsWith("METALURGIA_"),
  KG_ARMADURA: (t) => t.startsWith("ARMADURA_"),
  DIAS_ACOMPANHAMENTO: (t) => t.startsWith("ACOMPANHAMENTO_"),
};

export async function linhasDoNegocio(): Promise<LinhaDoNegocio[]> {
  const ls = await getPrismaClient().linha.findMany({
    where: { tipo: { in: ["PRODUTO", "OBRA"] } },
    select: { id: true, codigo: true, nome: true, ativo: true, ordem: true, unidadeNegocio: { select: { codigo: true } } },
  });
  return ls
    .filter((l) => l.unidadeNegocio && [1, 2, 3].includes(l.unidadeNegocio.codigo))
    .map((l) => ({ id: l.id, codigo: l.codigo, nome: l.nome, ativo: l.ativo, ordem: l.ordem, unidade: l.unidadeNegocio!.codigo }))
    .sort((a, b) => a.unidade - b.unidade || a.ordem - b.ordem);
}

/** Os volumes do mês, registro a registro, só os que entram em alguma linha dos Totais e têm a linha da unidade dela. */
export async function volumesDoMes(competenciaId: string, linhas: LinhaDoNegocio[]): Promise<Volume[]> {
  const prisma = getPrismaClient();
  const where = { competenciaId };
  const sel = {
    quantidade: true,
    unidadeNegocio: { select: { codigo: true } },
    obra: { select: { id: true, tipoVenda: true } },
    linha: { select: { id: true, codigo: true } },
  } as const;
  type Registro = {
    quantidade: Prisma.Decimal;
    unidadeNegocio: { codigo: number } | null;
    obra: { id: string; tipoVenda: string | null } | null;
    linha: { id: string; codigo: string } | null;
    categoria?: string | null;
    finalidade?: string | null;
    etapa?: string | null;
  };
  const listas: Array<[ItemVolume["tipo"], Promise<Registro[]>]> = [
    ["PROJETO", prisma.projeto.findMany({ where, select: sel })],
    ["PRODUCAO", prisma.producao.findMany({ where, select: sel })],
    ["PRODUCAO_PISTA", prisma.producaoPista.findMany({ where, select: sel })],
    ["PRODUCAO_ARMADURA", prisma.producaoArmadura.findMany({ where, select: { ...sel, categoria: true } })],
    ["PRODUCAO_METALURGIA", prisma.producaoMetalurgia.findMany({ where, select: { ...sel, finalidade: true } })],
    ["EXPEDICAO", prisma.expedicao.findMany({ where, select: sel })],
    ["MONTAGEM", prisma.montagem.findMany({ where, select: sel })],
    ["ACOMPANHAMENTO", prisma.acompanhamento.findMany({ where, select: { ...sel, etapa: true } })],
  ];
  const unidadeDaLinha = new Map(linhas.map((l) => [l.id, l.unidade]));
  // A lista de Montagem traz a linha do produto montado (Estrutura, Alveolares): o volume é da linha Montagem, de Serviços.
  const montagem = linhas.find((l) => l.unidade === 3 && l.codigo === "MONTAGEM");
  const volumes: Volume[] = [];
  for (const [tipo, busca] of listas) {
    for (const r of await busca) {
      if (!r.linha) continue;
      const total = linhaDosTotais({
        tipo,
        quantidade: r.quantidade,
        unidade: r.unidadeNegocio?.codigo ?? null,
        linha: chaveDaLinha(r.linha.codigo),
        obraGlobal: r.obra?.tipoVenda === "GLOBAL",
        categoria: r.categoria ?? null,
        finalidade: r.finalidade ?? null,
        etapa: r.etapa ?? null,
      });
      if (!total) continue;
      const linhaId = total === "MONTAGEM" ? montagem?.id : r.linha.id;
      // O registro conta na unidade da linha dos Totais; a linha dele precisa ser dessa unidade.
      if (!linhaId || unidadeDaLinha.get(linhaId) !== UNIDADE_DO_TOTAL(total)) continue;
      volumes.push({ total, linhaId, obraId: r.obra?.id ?? null, quantidade: Number(r.quantidade) });
    }
  }
  return volumes;
}

/** Os itens da Receita Prévia do mês, com a linha do cadastro (pelo nome, como as listas). */
export async function receitaDoMes(competenciaId: string, linhas: LinhaDoNegocio[]): Promise<ItemDaReceita[]> {
  const itens = await getPrismaClient().receitaPreviaItem.findMany({
    where: { receitaPrevia: { competenciaId } },
    select: { linha: true, obraCodigo: true, receitaBruta: true, receitaLiquida: true, receitaPrevia: { select: { natureza: true, unidadeNegocio: { select: { codigo: true } } } } },
  });
  return itens.map((i) => {
    const unidade = i.receitaPrevia.unidadeNegocio.codigo;
    const chave = chaveDaLinha(i.linha);
    const linha = chave ? linhas.find((l) => l.unidade === unidade && l.codigo === chave) : undefined;
    return { natureza: i.receitaPrevia.natureza, unidade, linhaId: linha?.id ?? null, obraCodigo: i.obraCodigo, bruta: Number(i.receitaBruta), liquida: Number(i.receitaLiquida) };
  });
}

/**
 * Os pesos de uma base entre as linhas de uma unidade (linhaId → volume), opcionalmente só de uma obra (pelo id, nos
 * volumes, ou pelo código, na receita). Vazio quando nenhuma linha da unidade tem volume.
 */
export function pesosDaBase(
  base: Base,
  unidade: number,
  dados: { volumes: Volume[]; receita: ItemDaReceita[] },
  obra?: { id: string | null; codigo: string },
): Map<string, number> {
  const pesos = new Map<string, number>();
  const somar = (linhaId: string, v: number) => pesos.set(linhaId, (pesos.get(linhaId) ?? 0) + v);
  if (base === "RECEITA") {
    for (const i of dados.receita) {
      if (i.unidade !== unidade || !i.linhaId || (obra && i.obraCodigo !== obra.codigo)) continue;
      // A receita das devoluções é negativa: não é base.
      if (i.natureza !== "DEVOLUCOES_INVENTARIOS") somar(i.linhaId, i.bruta);
    }
  } else {
    const daBase = TOTAIS_DA_BASE[base];
    for (const v of dados.volumes) {
      if (!daBase(v.total) || UNIDADE_DO_TOTAL(v.total) !== unidade || (obra && v.obraId !== obra.id)) continue;
      somar(v.linhaId, v.quantidade);
    }
  }
  for (const [l, v] of pesos) if (!(v > 0)) pesos.delete(l);
  return pesos;
}

/** O volume de cada linha numa linha de volume da DRE (as linhas dos Totais dela), para as linhas P e S da tabela. */
export function volumeDaLinhaDRE(totais: CodigoTotais[], volumes: Volume[]): Map<string, number> {
  const r = new Map<string, number>();
  for (const v of volumes) if (totais.includes(v.total)) r.set(v.linhaId, (r.get(v.linhaId) ?? 0) + v.quantidade);
  return r;
}
