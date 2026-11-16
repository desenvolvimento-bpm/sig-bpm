import { env } from "../../config/env.js";
import { getPrismaClient } from "../../config/prisma.js";
import { parseXml } from "../../lib/xml.js";
import { logger } from "../../utils/logger.js";
import { realizarConsultaSql } from "./consultaSql.js";

/** A sentença cadastrada no RM com o SQL de tipos de movimento (SELECT CODTMV, NOME, CLASSIFICACAO FROM TTMV). */
export const SENTENCA_TIPOS_MOVIMENTO = "BPM.TI.TMOV";

export type TipoMovimentoRm = {
  codcoligada: number;
  codtmv: string;
  nome: string | null;
  classificacao: string | null;
};

/** Campo de texto do XML: vazio ou ausente vira null. */
function texto(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  return limpo === "" ? null : limpo;
}

/**
 * Transforma o NewDataSet do RM em linhas da tabela. Sem código do tipo, a linha é descartada.
 * Colunas a mais no resultado são ignoradas.
 */
export async function normalizarTiposMovimento(xmlResultado: string, codcoligada: number): Promise<TipoMovimentoRm[]> {
  const doc = await parseXml<{ NewDataSet?: { Resultado?: unknown } }>(xmlResultado);
  const bruto = doc.NewDataSet?.Resultado;
  const linhas = bruto === undefined ? [] : Array.isArray(bruto) ? bruto : [bruto];

  const saida: TipoMovimentoRm[] = [];
  for (const l of linhas as Record<string, unknown>[]) {
    const codtmv = texto(l.CODTMV);
    if (!codtmv) continue;
    saida.push({
      codcoligada,
      codtmv,
      nome: texto(l.NOME),
      classificacao: texto(l.CLASSIFICACAO),
    });
  }
  return saida;
}

export type ResultadoSyncTiposMovimento = { lidas: number; gravadas: number };

/**
 * Consulta o RM e espelha os tipos de movimento na tabela sig_tipo_movimento (upsert, numa transação).
 * Não apaga: um tipo que sai do RM continua na tabela.
 */
export async function sincronizarTiposMovimento(): Promise<ResultadoSyncTiposMovimento> {
  const prisma = getPrismaClient();
  const xml = await realizarConsultaSql(SENTENCA_TIPOS_MOVIMENTO);
  const linhas = await normalizarTiposMovimento(xml, env.TOTVS_CODCOLIGADA);
  if (linhas.length === 0) {
    logger("warn", "Sincronização de tipos de movimento: o RM não devolveu linhas; nada foi alterado");
    return { lidas: 0, gravadas: 0 };
  }

  const agora = new Date();
  const operacoes = linhas.map((t) =>
    prisma.sigTipoMovimento.upsert({
      where: { codcoligada_codtmv: { codcoligada: t.codcoligada, codtmv: t.codtmv } },
      create: { ...t, sincronizadoEm: agora },
      update: { ...t, sincronizadoEm: agora },
    }),
  );

  // O padrão do Prisma (5 s) não basta para milhares de upserts: a transação tem um teto de 5 min.
  await prisma.$transaction(operacoes, { timeout: 300_000, maxWait: 10_000 });

  return { lidas: linhas.length, gravadas: linhas.length };
}
