import { env } from "../../config/env.js";
import { getPrismaClient } from "../../config/prisma.js";
import { parseXml } from "../../lib/xml.js";
import { logger } from "../../utils/logger.js";
import { realizarConsultaSql } from "./consultaSql.js";

/** A sentença cadastrada no RM com o SQL de centros de custo (GCCUSTO + responsável em PPESSOA). */
export const SENTENCA_CENTROS_CUSTO = "BPM.TI.RetCC";

export type CentroCustoRm = {
  codcoligada: number;
  codccusto: string;
  nome: string | null;
  ativo: number;
  reccreatedon: Date | null;
  recmodifiedon: Date | null;
  responsavel: string | null;
  nomeResponsavel: string | null;
  emailResponsavel: string | null;
};

/** Campo de texto do XML: vazio ou ausente vira null. */
function texto(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  return limpo === "" ? null : limpo;
}

/** Data do RM ("2023-05-10T14:22:11" ou "2023-05-10 14:22:11.000"). Inválida vira null. */
function data(valor: unknown): Date | null {
  const t = texto(valor);
  if (t === null) return null;
  const d = new Date(t.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Transforma o NewDataSet do RM em linhas da tabela. Sem código, a linha é descartada.
 * ATIVO vale 1 só quando o RM manda "1".
 */
export async function normalizarCentrosCusto(xmlResultado: string, codcoligada: number): Promise<CentroCustoRm[]> {
  const doc = await parseXml<{ NewDataSet?: { Resultado?: unknown } }>(xmlResultado);
  const bruto = doc.NewDataSet?.Resultado;
  const linhas = bruto === undefined ? [] : Array.isArray(bruto) ? bruto : [bruto];

  const saida: CentroCustoRm[] = [];
  for (const l of linhas as Record<string, unknown>[]) {
    const codccusto = texto(l.CODCCUSTO);
    if (!codccusto) continue;
    saida.push({
      codcoligada,
      codccusto,
      nome: texto(l.NOME),
      ativo: texto(l.ATIVO) === "1" ? 1 : 0,
      reccreatedon: data(l.RECCREATEDON),
      recmodifiedon: data(l.RECMODIFIEDON),
      responsavel: texto(l.RESPONSAVEL),
      nomeResponsavel: texto(l.NOME_RESPONSAVEL),
      emailResponsavel: texto(l.EMAIL),
    });
  }
  return saida;
}

export type ResultadoSyncCentrosCusto = { lidas: number; gravadas: number };

/**
 * Consulta o RM e espelha os centros de custo na tabela sig_centro_custo.
 * Uma transação para o conjunto inteiro (ou atualiza tudo, ou nada). Não apaga: um centro que sai do RM
 * continua na tabela, e só o campo ativo muda.
 */
export async function sincronizarCentrosCusto(): Promise<ResultadoSyncCentrosCusto> {
  const prisma = getPrismaClient();
  const xml = await realizarConsultaSql(SENTENCA_CENTROS_CUSTO);
  const linhas = await normalizarCentrosCusto(xml, env.TOTVS_CODCOLIGADA);
  if (linhas.length === 0) {
    logger("warn", "Sincronização de centros de custo: o RM não devolveu linhas; nada foi alterado");
    return { lidas: 0, gravadas: 0 };
  }

  const agora = new Date();
  const operacoes = linhas.map((c) =>
    prisma.sigCentroCusto.upsert({
      where: { codcoligada_codccusto: { codcoligada: c.codcoligada, codccusto: c.codccusto } },
      create: { ...c, sincronizadoEm: agora },
      update: { ...c, sincronizadoEm: agora },
    }),
  );

  // O padrão do Prisma (5 s) não basta para milhares de upserts: a transação tem um teto de 5 min.
  await prisma.$transaction(operacoes, { timeout: 300_000, maxWait: 10_000 });

  return { lidas: linhas.length, gravadas: linhas.length };
}
