import { getPrismaClient } from "../../config/prisma.js";
import { somarTotais, type ItemVolume } from "./totaisOperacao.js";
import { chaveDaLinha } from "../../lib/linhas.js";

/**
 * Os volumes da competência, pela regra da aba Totais, a partir das listas
 * gravadas — importadas ou, no Passo 13, digitadas.
 */
export async function totaisDaCompetencia(competenciaId: string) {
  const prisma = getPrismaClient();
  const where = { competenciaId };
  const comum = {
    quantidade: true,
    unidadeNegocio: { select: { codigo: true } },
    obra: { select: { tipoVenda: true } },
  } as const;
  const comLinha = { ...comum, linha: { select: { codigo: true } } } as const;

  const [projetos, producoes, pistas, armaduras, metalurgia, expedicoes, montagens, acompanhamentos] =
    await Promise.all([
      prisma.projeto.findMany({ where, select: comLinha }),
      prisma.producao.findMany({ where, select: comLinha }),
      prisma.producaoPista.findMany({ where, select: comLinha }),
      prisma.producaoArmadura.findMany({ where, select: { ...comLinha, categoria: true } }),
      prisma.producaoMetalurgia.findMany({ where, select: { ...comum, finalidade: true } }),
      prisma.expedicao.findMany({ where, select: comLinha }),
      prisma.montagem.findMany({ where, select: comLinha }),
      prisma.acompanhamento.findMany({ where, select: { ...comLinha, etapa: true } }),
    ]);

  type Linha = {
    quantidade: ItemVolume["quantidade"];
    unidadeNegocio: { codigo: number } | null;
    obra: { tipoVenda: string | null } | null;
    linha?: { codigo: string } | null;
    categoria?: string | null;
    finalidade?: string | null;
    etapa?: string | null;
  };
  const itens = (tipo: ItemVolume["tipo"], linhas: Linha[]): ItemVolume[] =>
    linhas.map((l) => ({
      tipo,
      quantidade: l.quantidade,
      unidade: l.unidadeNegocio?.codigo ?? null,
      linha: l.linha ? chaveDaLinha(l.linha.codigo) : null,
      obraGlobal: l.obra?.tipoVenda === "GLOBAL",
      categoria: l.categoria ?? null,
      finalidade: l.finalidade ?? null,
      etapa: l.etapa ?? null,
    }));

  return somarTotais([
    ...itens("PROJETO", projetos),
    ...itens("PRODUCAO", producoes),
    ...itens("PRODUCAO_PISTA", pistas),
    ...itens("PRODUCAO_ARMADURA", armaduras),
    ...itens("PRODUCAO_METALURGIA", metalurgia),
    ...itens("EXPEDICAO", expedicoes),
    ...itens("MONTAGEM", montagens),
    ...itens("ACOMPANHAMENTO", acompanhamentos),
  ]);
}
