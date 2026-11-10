import { env } from "../../config/env.js";
import { getPrismaClient } from "../../config/prisma.js";
import { parseXml } from "../../lib/xml.js";
import { logger } from "../../utils/logger.js";
import { realizarConsultaSql } from "./consultaSql.js";

/** A sentença cadastrada no RM com o SQL de contas contábeis (SELECT CCONTA). */
export const SENTENCA_CONTAS_CONTABEIS = "BPM.TI.CConta";

export type ContaContabilRm = {
  codcoligada: number;
  codconta: string;
  reduzido: string | null;
  descricao: string | null;
};

/** Campo de texto do XML: vazio ou ausente vira null. */
function texto(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  return limpo === "" ? null : limpo;
}

/** Transforma o NewDataSet do RM em linhas da tabela. Sem código da conta, a linha é descartada. */
export async function normalizarContasContabeis(xmlResultado: string, codcoligada: number): Promise<ContaContabilRm[]> {
  const doc = await parseXml<{ NewDataSet?: { Resultado?: unknown } }>(xmlResultado);
  const bruto = doc.NewDataSet?.Resultado;
  const linhas = bruto === undefined ? [] : Array.isArray(bruto) ? bruto : [bruto];

  const saida: ContaContabilRm[] = [];
  for (const l of linhas as Record<string, unknown>[]) {
    const codconta = texto(l.CODCONTA);
    if (!codconta) continue;
    saida.push({
      codcoligada,
      codconta,
      reduzido: texto(l.REDUZIDO),
      descricao: texto(l.DESCRICAO),
    });
  }
  return saida;
}

export type ResultadoSyncContasContabeis = { lidas: number; gravadas: number };

/**
 * Consulta o RM e espelha o plano de contas na tabela sig_conta_contabil.
 * Uma transação para o conjunto inteiro (ou atualiza tudo, ou nada). Não apaga: uma conta que sai do RM
 * continua na tabela.
 */
export async function sincronizarContasContabeis(): Promise<ResultadoSyncContasContabeis> {
  const prisma = getPrismaClient();
  const xml = await realizarConsultaSql(SENTENCA_CONTAS_CONTABEIS);
  const linhas = await normalizarContasContabeis(xml, env.TOTVS_CODCOLIGADA);
  if (linhas.length === 0) {
    logger("warn", "Sincronização de contas contábeis: o RM não devolveu linhas; nada foi alterado");
    return { lidas: 0, gravadas: 0 };
  }

  const agora = new Date();
  const operacoes = linhas.map((c) =>
    prisma.sigContaContabil.upsert({
      where: { codcoligada_codconta: { codcoligada: c.codcoligada, codconta: c.codconta } },
      create: { ...c, sincronizadoEm: agora },
      update: { ...c, sincronizadoEm: agora },
    }),
  );

  // O padrão do Prisma (5 s) não basta para milhares de upserts: a transação tem um teto de 5 min.
  await prisma.$transaction(operacoes, { timeout: 300_000, maxWait: 10_000 });

  return { lidas: linhas.length, gravadas: linhas.length };
}
