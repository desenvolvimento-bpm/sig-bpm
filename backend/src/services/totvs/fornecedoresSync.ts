import { env } from "../../config/env.js";
import { getPrismaClient } from "../../config/prisma.js";
import { parseXml } from "../../lib/xml.js";
import { logger } from "../../utils/logger.js";
import { realizarConsultaSql } from "./consultaSql.js";

/** A sentença cadastrada no RM com o SQL de fornecedores (SELECT FCFO). */
export const SENTENCA_FORNECEDORES = "BPM.TI.RetCFO";

export type FornecedorRm = {
  codcoligada: number;
  codcfo: string;
  nomeFantasia: string | null;
  pagrec: number | null;
  ativo: number;
  idcfo: number | null;
  cgccfo: string | null;
};

/** Campo de texto do XML: vazio ou ausente vira null (o xml2js devolve objeto para elemento vazio). */
function texto(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  return limpo === "" ? null : limpo;
}

function inteiro(valor: unknown): number | null {
  const t = texto(valor);
  if (t === null) return null;
  const n = Number(t);
  return Number.isInteger(n) ? n : null;
}

/**
 * Transforma o NewDataSet do RM em linhas da tabela. Sem código de cliente/fornecedor, a linha é descartada.
 * ATIVO vale 1 só quando o RM manda "1": qualquer outra coisa é inativo.
 */
export async function normalizarFornecedores(xmlResultado: string, codcoligada: number): Promise<FornecedorRm[]> {
  const doc = await parseXml<{ NewDataSet?: { Resultado?: unknown } }>(xmlResultado);
  const bruto = doc.NewDataSet?.Resultado;
  const linhas = bruto === undefined ? [] : Array.isArray(bruto) ? bruto : [bruto];

  const saida: FornecedorRm[] = [];
  for (const l of linhas as Record<string, unknown>[]) {
    const codcfo = texto(l.CODCFO);
    if (!codcfo) continue;
    saida.push({
      codcoligada,
      codcfo,
      nomeFantasia: texto(l.NOMEFANTASIA),
      pagrec: inteiro(l.PAGREC),
      ativo: texto(l.ATIVO) === "1" ? 1 : 0,
      idcfo: inteiro(l.IDCFO),
      cgccfo: texto(l.CGCCFO),
    });
  }
  return saida;
}

export type ResultadoSyncFornecedores = { lidas: number; gravadas: number };

/**
 * Consulta o RM e espelha os fornecedores na tabela sig_fornecedor.
 * Grava tudo numa só transação: ou atualiza todas as linhas, ou nenhuma. Não apaga nada: um fornecedor que sai
 * do RM continua na tabela, e só o campo ativo muda (quando o RM mandar ATIVO = 0).
 */
export async function sincronizarFornecedores(): Promise<ResultadoSyncFornecedores> {
  const prisma = getPrismaClient();
  const xml = await realizarConsultaSql(SENTENCA_FORNECEDORES);
  const linhas = await normalizarFornecedores(xml, env.TOTVS_CODCOLIGADA);
  if (linhas.length === 0) {
    logger("warn", "Sincronização de fornecedores: o RM não devolveu linhas; nada foi alterado");
    return { lidas: 0, gravadas: 0 };
  }

  const agora = new Date();
  const operacoes = linhas.map((f) =>
    prisma.sigFornecedor.upsert({
      where: { codcoligada_codcfo: { codcoligada: f.codcoligada, codcfo: f.codcfo } },
      create: { ...f, sincronizadoEm: agora },
      update: { nomeFantasia: f.nomeFantasia, pagrec: f.pagrec, ativo: f.ativo, idcfo: f.idcfo, cgccfo: f.cgccfo, sincronizadoEm: agora },
    }),
  );

  // Uma transação para o conjunto inteiro: sem gravação parcial se algo falhar no meio.
  // O padrão do Prisma (5 s) não basta para milhares de upserts: a transação tem um teto de 5 min.
  await prisma.$transaction(operacoes, { timeout: 300_000, maxWait: 10_000 });

  return { lidas: linhas.length, gravadas: linhas.length };
}
