import { env } from "../../config/env.js";
import { getPrismaClient } from "../../config/prisma.js";
import { parseXml } from "../../lib/xml.js";
import { logger } from "../../utils/logger.js";
import { realizarConsultaSql } from "./consultaSql.js";

/** A sentença cadastrada no RM com o SQL de produtos (TPRODUTO + TPRODUTODEF + TPRDCOMPL + GIMAGEM). */
export const SENTENCA_PRODUTOS = "BPM.TI.RetPRD";

export type ProdutoRm = {
  codcoligada: number;
  idprd: number;
  codcolprd: number | null;
  nomeFantasia: string | null;
  codigoprd: string;
  inativo: number;
  codigoreduzido: string | null;
  ultimonivel: number;
  tipo: string | null;
  codigoauxiliar: string | null;
  idclassifbensservico: string | null;
  codundcontrole: string | null;
  codundcompra: string | null;
  codundvenda: string | null;
  codtb1fat: string | null;
  codtborcamento: string | null;
  codcoltborcamento: string | null;
  codtborcamentoreceita: string | null;
  codcoltborcamentoreceita: string | null;
  integraManutencao: number | null;
  codtrf: string | null;
  volume: string | null;
  imagem: string | null;
  usuarioCriacaoTotvs: string | null;
  dtcadastramento: Date | null;
};

/** Campo de texto do XML: vazio ou ausente vira null. */
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

/** Data do RM ("2023-05-10T14:22:11" ou "2023-05-10 14:22:11.000"). Inválida vira null. */
function data(valor: unknown): Date | null {
  const t = texto(valor);
  if (t === null) return null;
  const d = new Date(t.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Transforma o NewDataSet do RM em linhas da tabela. Sem IDPRD ou CODIGOPRD, a linha é descartada.
 * Colunas a mais no resultado são ignoradas.
 */
export async function normalizarProdutos(xmlResultado: string, codcoligada: number): Promise<ProdutoRm[]> {
  const doc = await parseXml<{ NewDataSet?: { Resultado?: unknown } }>(xmlResultado);
  const bruto = doc.NewDataSet?.Resultado;
  const linhas = bruto === undefined ? [] : Array.isArray(bruto) ? bruto : [bruto];

  const saida: ProdutoRm[] = [];
  for (const l of linhas as Record<string, unknown>[]) {
    const idprd = inteiro(l.IDPRD);
    const codigoprd = texto(l.CODIGOPRD);
    if (idprd === null || !codigoprd) continue;
    const integra = texto(l.INTEGRA_MANUTENCAO);
    saida.push({
      codcoligada,
      idprd,
      codcolprd: inteiro(l.CODCOLPRD),
      nomeFantasia: texto(l.NOMEFANTASIA),
      codigoprd,
      inativo: inteiro(l.INATIVO) ?? 0,
      codigoreduzido: texto(l.CODIGOREDUZIDO),
      ultimonivel: inteiro(l.ULTIMONIVEL) ?? 0,
      tipo: texto(l.TIPO),
      codigoauxiliar: texto(l.CODIGOAUXILIAR),
      idclassifbensservico: texto(l.IDCLASSIFBENSSERVICO),
      codundcontrole: texto(l.CODUNDCONTROLE),
      codundcompra: texto(l.CODUNDCOMPRA),
      codundvenda: texto(l.CODUNDVENDA),
      codtb1fat: texto(l.CODTB1FAT),
      codtborcamento: texto(l.CODTBORCAMENTO),
      codcoltborcamento: texto(l.CODCOLTBORCAMENTO),
      codtborcamentoreceita: texto(l.CODTBORCAMENTORECEITA),
      codcoltborcamentoreceita: texto(l.CODCOLTBORCAMENTORECEITA),
      // O RM manda 0/1 (ou "true"/"false" em alguns leiautes): ambos viram 1/0.
      integraManutencao: integra === null ? null : integra === "1" || integra.toLowerCase() === "true" ? 1 : 0,
      codtrf: texto(l.CODTRF),
      volume: texto(l.VOLUME),
      imagem: texto(l.IMAGEM),
      usuarioCriacaoTotvs: texto(l.USUARIOCRIACAO),
      dtcadastramento: data(l.DTCADASTRAMENTO),
    });
  }
  return saida;
}

export type ResultadoSyncProdutos = { lidas: number; gravadas: number };

/**
 * Consulta o RM e espelha os produtos na tabela sig_produto (upsert, numa transação). Não apaga: um produto que sai
 * do RM continua na tabela.
 */
export async function sincronizarProdutos(): Promise<ResultadoSyncProdutos> {
  const prisma = getPrismaClient();
  const xml = await realizarConsultaSql(SENTENCA_PRODUTOS);
  const linhas = await normalizarProdutos(xml, env.TOTVS_CODCOLIGADA);
  if (linhas.length === 0) {
    logger("warn", "Sincronização de produtos: o RM não devolveu linhas; nada foi alterado");
    return { lidas: 0, gravadas: 0 };
  }

  const agora = new Date();
  const operacoes = linhas.map((p) =>
    prisma.sigProduto.upsert({
      where: { codcoligada_idprd: { codcoligada: p.codcoligada, idprd: p.idprd } },
      create: { ...p, sincronizadoEm: agora },
      update: { ...p, sincronizadoEm: agora },
    }),
  );

  // O padrão do Prisma (5 s) não basta para milhares de upserts: a transação tem um teto de 5 min.
  await prisma.$transaction(operacoes, { timeout: 300_000, maxWait: 10_000 });

  return { lidas: linhas.length, gravadas: linhas.length };
}
