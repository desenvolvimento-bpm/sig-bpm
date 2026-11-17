import { env } from "../../config/env.js";
import { getPrismaClient } from "../../config/prisma.js";
import { parseXml } from "../../lib/xml.js";
import { enviarSoap, escaparXml, extrairResultadoSoap, naFilaRm } from "./consultaSql.js";

/**
 * Leitura de um movimento (TMOV) pelo wsDataServer do TOTVS RM: operação ReadRecord, somente leitura.
 * Cabeçalho (TMOV), itens (TITMMOV) e rateios por centro de custo (TITMMOVRATCCU).
 */

export const DATASERVER_MOVIMENTO = "MovMovimentoTBCData";
const SOAP_ACTION_READ_RECORD = "http://www.totvs.com/IwsDataServer/ReadRecord";
const TIMEOUT_MS = 120_000;

export type CabecalhoMovimento = {
  idmov: number;
  codfilial: number | null;
  codcfo: string | null;
  numeromov: string | null;
  codtmv: string | null;
  /** Data de emissão no formato DD/MM/AAAA. */
  dataemissao: string | null;
};

/** Um rateio do item por centro de custo, como vem do RM. */
export type RateioXml = { codccusto: string | null; nome: string | null; valor: string | null };

/** Um item do movimento, como vem do RM (TITMMOV) com os seus rateios (TITMMOVRATCCU). */
export type ItemXml = {
  nseqitmmov: number;
  idprd: number | null;
  codigoprd: string | null;
  nomeFantasia: string | null;
  quantidade: string | null;
  precoUnitario: string | null;
  rateios: RateioXml[];
};

/** Um item já cruzado com a tabela de lançamentos contábeis (sig_lancamentos_contabeis_rm) e com os cadastros. */
export type ItemMovimento = {
  nseqitmmov: number;
  idprd: number | null;
  codigoprd: string | null;
  /** Nome do produto no cadastro (sig_produto); sem cadastro, o que veio no RM. */
  produto: string | null;
  quantidade: string | null;
  precoUnitario: string | null;
  rateios: Array<{ codccusto: string; centro: string | null; valor: string | null }>;
};

/** Os dados do lançamento contábil que o item precisa conferir: o produto (IDPRD) e o centro (COD_CUSTO). */
export type LancamentoRef = { idprd: number | null; codCusto: string | null };

/** Envelope do ReadRecord, no formato da documentação da TI. A chave é "CODCOLIGADA;IDMOV". */
export function montarEnvelopeReadRecord(dataServerName: string, chave: string, contexto: string): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">` +
    `<soapenv:Header/>` +
    `<soapenv:Body>` +
    `<tot:ReadRecord>` +
    `<tot:DataServerName>${escaparXml(dataServerName)}</tot:DataServerName>` +
    `<tot:PrimaryKey>${escaparXml(chave)}</tot:PrimaryKey>` +
    `<tot:Contexto>${escaparXml(contexto)}</tot:Contexto>` +
    `</tot:ReadRecord>` +
    `</soapenv:Body>` +
    `</soapenv:Envelope>`
  );
}

/** DD/MM/AAAA a partir de "2026-06-01T00:00:00" (ou já em DD/MM/AAAA). Sem data válida, null. */
export function formatarDataEmissao(valor: string | null): string | null {
  if (!valor) return null;
  const iso = valor.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const br = valor.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return br ? `${br[1]}/${br[2]}/${br[3]}` : null;
}

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

/** Todos os nós com esse nome, em qualquer profundidade do XML convertido. */
function colherNos(no: unknown, nome: string, saida: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (no === null || typeof no !== "object") return saida;
  if (Array.isArray(no)) {
    for (const item of no) colherNos(item, nome, saida);
    return saida;
  }
  const objeto = no as Record<string, unknown>;
  for (const [chave, valor] of Object.entries(objeto)) {
    if (chave === nome) {
      if (Array.isArray(valor)) saida.push(...(valor as Record<string, unknown>[]));
      else if (valor && typeof valor === "object") saida.push(valor as Record<string, unknown>);
    } else {
      colherNos(valor, nome, saida);
    }
  }
  return saida;
}

/** Lê o cabeçalho (TMOV) do XML do registro. Sem TMOV, devolve null. */
export async function extrairCabecalhoMovimento(xmlRegistro: string): Promise<CabecalhoMovimento | null> {
  const doc = await parseXml<unknown>(xmlRegistro);
  const [tmov] = colherNos(doc, "TMOV");
  if (!tmov) return null;
  const idmov = inteiro(tmov.IDMOV);
  if (idmov === null) return null;
  return {
    idmov,
    codfilial: inteiro(tmov.CODFILIAL),
    codcfo: texto(tmov.CODCFO),
    numeromov: texto(tmov.NUMEROMOV),
    codtmv: texto(tmov.CODTMV),
    dataemissao: formatarDataEmissao(texto(tmov.DATAEMISSAO)),
  };
}

/** Lê os itens (TITMMOV) e os rateios (TITMMOVRATCCU) do XML do registro, ordenados pelo NSEQITMMOV. */
export async function extrairItensMovimento(xmlRegistro: string): Promise<ItemXml[]> {
  const doc = await parseXml<unknown>(xmlRegistro);
  const rateiosBrutos = colherNos(doc, "TITMMOVRATCCU");
  const itens: ItemXml[] = [];
  for (const it of colherNos(doc, "TITMMOV")) {
    const nseqitmmov = inteiro(it.NSEQITMMOV);
    if (nseqitmmov === null) continue;
    const rateios: RateioXml[] = rateiosBrutos
      .filter((r) => inteiro(r.NSEQITMMOV) === nseqitmmov)
      .map((r) => ({ codccusto: texto(r.CODCCUSTO), nome: texto(r.NOME), valor: texto(r.VALOR) }));
    itens.push({
      nseqitmmov,
      idprd: inteiro(it.IDPRD),
      codigoprd: texto(it.CODIGOPRD),
      nomeFantasia: texto(it.NOMEFANTASIA),
      quantidade: texto(it.QUANTIDADE),
      precoUnitario: texto(it.PRECOUNITARIO),
      rateios,
    });
  }
  return itens.sort((a, b) => a.nseqitmmov - b.nseqitmmov);
}

/**
 * Mantém só os itens que estão na tabela de lançamentos contábeis do movimento (pelo IDPRD) e só os rateios cujo
 * centro de custo também está lá (pelo COD_CUSTO). Ordena pelo NSEQITMMOV. Nomes vêm dos cadastros quando existem.
 */
export function cruzarItensMovimento(
  itens: ItemXml[],
  lancamentos: LancamentoRef[],
  produtos: Map<number, string>,
  centros: Map<string, string>,
): ItemMovimento[] {
  const idprds = new Set(lancamentos.map((l) => l.idprd).filter((v): v is number => v !== null));
  const centrosRegistrados = new Set(lancamentos.map((l) => l.codCusto).filter((v): v is string => v !== null));

  return itens
    .filter((it) => it.idprd !== null && idprds.has(it.idprd))
    .map((it) => ({
      nseqitmmov: it.nseqitmmov,
      idprd: it.idprd,
      codigoprd: it.codigoprd,
      produto: (it.idprd !== null ? produtos.get(it.idprd) : undefined) ?? it.nomeFantasia,
      quantidade: it.quantidade,
      precoUnitario: it.precoUnitario,
      rateios: it.rateios
        .filter((r): r is RateioXml & { codccusto: string } => r.codccusto !== null && centrosRegistrados.has(r.codccusto))
        .map((r) => ({
          codccusto: r.codccusto,
          centro: centros.get(r.codccusto) ?? r.nome,
          valor: r.valor,
        })),
    }))
    .sort((a, b) => a.nseqitmmov - b.nseqitmmov);
}

export class MovimentoNaoEncontrado extends Error {
  constructor(idmov: number) {
    super(`Movimento ${idmov} não encontrado no TOTVS RM`);
  }
}

export type MovimentoDetalhe = {
  cabecalho: CabecalhoMovimento;
  fornecedor: { codigo: string | null; nome: string | null };
  tipoMovimento: { codigo: string | null; nome: string | null; classificacao: string | null };
  itens: ItemMovimento[];
};

/**
 * Lê o movimento no RM pelo IDMOV, completa o cabeçalho com o fornecedor (sig_fornecedor) e o tipo (sig_tipo_movimento)
 * e monta os itens conferidos com sig_lancamentos_contabeis_rm, com o nome do produto (sig_produto) e do centro
 * (sig_centro_custo). Sem o registro no RM, lança MovimentoNaoEncontrado.
 */
export async function buscarMovimento(idmov: number): Promise<MovimentoDetalhe> {
  if (!env.TOTVS_CONSULTA_SQL_URL || !env.TOTVS_USER || !env.TOTVS_PASSWORD) {
    throw new Error("TOTVS RM: configure TOTVS_CONSULTA_SQL_URL, TOTVS_USER e TOTVS_PASSWORD no .env");
  }
  const url = env.TOTVS_CONSULTA_SQL_URL.replace("/wsConsultaSQL/IwsConsultaSQL", "/wsDataServer/IwsDataServer");
  const coligada = env.TOTVS_CODCOLIGADA;
  const envelope = montarEnvelopeReadRecord(DATASERVER_MOVIMENTO, `${coligada};${idmov}`, `CODCOLIGADA=${coligada}`);

  const bruto = await naFilaRm(() =>
    enviarSoap({ url, soapAction: SOAP_ACTION_READ_RECORD, envelope, timeoutMs: TIMEOUT_MS, rotulo: `ReadRecord ${idmov}` }),
  );
  const xmlRegistro = extrairResultadoSoap(bruto, "ReadRecordResult");
  const cabecalho = await extrairCabecalhoMovimento(xmlRegistro);
  if (!cabecalho) throw new MovimentoNaoEncontrado(idmov);
  const itensXml = await extrairItensMovimento(xmlRegistro);

  const prisma = getPrismaClient();
  const lancamentos = await prisma.sigLancamentoContabilRm.findMany({
    where: { idmov },
    select: { idprd: true, codCusto: true },
  });
  const idprds = [...new Set(lancamentos.map((l) => l.idprd).filter((v): v is number => v !== null))];
  const codigosCusto = [...new Set(lancamentos.map((l) => l.codCusto).filter((v): v is string => v !== null))];

  const [fornecedor, tipo, produtos, centros] = await Promise.all([
    cabecalho.codcfo
      ? prisma.sigFornecedor.findUnique({ where: { codcoligada_codcfo: { codcoligada: coligada, codcfo: cabecalho.codcfo } } })
      : null,
    cabecalho.codtmv
      ? prisma.sigTipoMovimento.findUnique({ where: { codcoligada_codtmv: { codcoligada: coligada, codtmv: cabecalho.codtmv } } })
      : null,
    idprds.length > 0 ? prisma.sigProduto.findMany({ where: { codcoligada: coligada, idprd: { in: idprds } }, select: { idprd: true, nomeFantasia: true } }) : [],
    codigosCusto.length > 0
      ? prisma.sigCentroCusto.findMany({ where: { codcoligada: coligada, codccusto: { in: codigosCusto } }, select: { codccusto: true, nome: true } })
      : [],
  ]);

  const nomesProdutos = new Map<number, string>();
  for (const p of produtos) if (p.nomeFantasia) nomesProdutos.set(p.idprd, p.nomeFantasia);
  const nomesCentros = new Map<string, string>();
  for (const c of centros) if (c.nome) nomesCentros.set(c.codccusto, c.nome);

  return {
    cabecalho,
    fornecedor: { codigo: cabecalho.codcfo, nome: fornecedor?.nomeFantasia ?? null },
    tipoMovimento: { codigo: cabecalho.codtmv, nome: tipo?.nome ?? null, classificacao: tipo?.classificacao ?? null },
    itens: cruzarItensMovimento(itensXml, lancamentos, nomesProdutos, nomesCentros),
  };
}
