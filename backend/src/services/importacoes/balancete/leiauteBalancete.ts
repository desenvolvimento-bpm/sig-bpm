import { Prisma } from "../../../generated/prisma/client.js";
import type { LinhaPlanilha, ValorCelula } from "../../../lib/xlsx.js";

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/**
 * Interpretação do arquivo do balancete — leiaute da aba `Balancete (Lista)`
 * do SIG BPM 2026 - LISTAS REALIZADO (RESULTADOS).
 *
 * A aba é uma tabela dinâmica do exercício inteiro, em forma tabular:
 *
 *   FILIAL | [ID] | COD_CUSTO | C_CUSTO | SUB_COD_CONTA_4 | REDUZIDO_CONTA | CONTA | [CLI_FORN | EMISSAO | HISTORICO] | <mês> … | Total Geral
 *
 * Cada mês ocupa três colunas com a mesma data no cabeçalho — as duas parciais
 * (crédito e débito) e a movimentação do mês, que é a soma delas — ou, desde
 * 15/10/2026, uma só, a movimentação. A planilha de resultados usa só a
 * movimentação, e é ela que se grava.
 *
 * O balancete detalhado (15/10/2026): com as colunas CLI_FORN, EMISSAO e
 * HISTORICO, cada linha é um movimento (o cliente ou fornecedor, a data de
 * emissão e o histórico), e a mesma filial, centro e conta se repetem — não é
 * duplicidade. Sem elas, uma linha por filial, centro e conta, como antes. A coluna ID (10/11/2026) é o ID do
 * movimento no RM — o IDENTIFICADOR das abas Requisições (Lista) e Notas Fiscais (Lista) —, que abre os itens do
 * movimento nos extratos; as colunas são lidas pelo nome, e o arquivo sem ela vale como antes. As linhas de subtotal
 * da tabela dinâmica ("3.01 Total", "1 Total", "Total Geral") não são
 * lançamento; a Total Geral serve para conferir o arquivo. A aba pode ter mais
 * de uma tabela dinâmica, uma embaixo da outra (22/10/2026: janeiro a agosto
 * numa e setembro noutra), cada uma com a sua Total Geral: o total do mês é a
 * soma delas, e o mês só pode estar numa tabela.
 *
 * Esta função é pura: não consulta cadastro. Verificar se a conta e o centro
 * existem é do serviço de importação.
 */

export const ABA_BALANCETE = "Balancete (Lista)";

export type CodigoRejeicao =
  | "FILIAL_INVALIDA"
  | "CONTA_AUSENTE"
  | "CONTA_NAO_CADASTRADA"
  | "VALOR_INVALIDO"
  | "TOTAL_DIVERGENTE"
  | "LINHA_DUPLICADA";

export type Rejeicao = {
  linha: number;
  codigo: CodigoRejeicao;
  mensagem: string;
  filial?: string;
  codigoCentroCusto?: string | null;
  reduzido?: string | null;
  /** Movimentação do mês na linha recusada, quando legível. */
  valor?: string;
};

export type LinhaBalancete = {
  linhaArquivo: number;
  filial: number;
  codigoCentroCusto: string | null;
  nomeCentroCusto: string | null;
  reduzido: string;
  descricaoConta: string | null;
  valorMovimento: Decimal;
  /** O detalhe do movimento (15/10/2026), quando o arquivo traz as colunas CLI_FORN, EMISSAO e HISTORICO. */
  cliForn: string | null;
  emissao: Date | null;
  historico: string | null;
  /** O ID do movimento no RM (10/11/2026, a coluna ID), quando o arquivo o traz. */
  idMovimento: string | null;
};

export type LeituraBalancete =
  | { ok: false; motivo: string }
  | {
      ok: true;
      /** Todas as linhas abaixo do cabeçalho: aceitas + rejeitadas + ignoradas. */
      linhasLidas: number;
      lancamentos: LinhaBalancete[];
      rejeicoes: Rejeicao[];
      ignoradas: { subtotais: number; semMovimento: number };
      /** Soma da movimentação de todas as linhas de dado legíveis. */
      somaArquivo: Decimal;
      /** O "Total Geral" do próprio arquivo no mês, quando ele existe: a soma das Total Geral de todas as tabelas da aba. */
      totalGeral: Decimal | null;
      /** Quantas tabelas da aba trazem o mês (as Total Geral com valor na coluna dele); mais de uma é duplicidade. */
      tabelasDoMes: number;
    };

const COLUNAS_OBRIGATORIAS = {
  filial: "FILIAL",
  codigoCentroCusto: "COD_CUSTO",
  nomeCentroCusto: "C_CUSTO",
  reduzido: "REDUZIDO_CONTA",
  descricaoConta: "CONTA",
} as const;

type Colunas = Record<keyof typeof COLUNAS_OBRIGATORIAS, number>;

const MESES_CURTOS = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

/** Tolerância de arredondamento: um centavo. */
const CENTAVO = new Decimal("0.01");

function normalizar(v: ValorCelula): string {
  return v === null ? "" : String(v).trim().toUpperCase();
}

function texto(v: ValorCelula): string | null {
  if (v === null || v === undefined) return null;
  const s = typeof v === "number" ? String(v) : String(v).trim();
  return s === "" ? null : s;
}

/**
 * Data de cabeçalho → { ano, mes }. O Excel grava datas como número de série
 * (46023 = 01/01/2026); aceita-se também o texto dd/mm/aaaa.
 */
function mesDoCabecalho(v: ValorCelula): { ano: number; mes: number } | null {
  if (typeof v === "number" && v > 36500 && v < 73000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000);
    return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 };
  }
  if (typeof v === "string") {
    const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return { ano: Number(m[3]), mes: Number(m[2]) };
  }
  return null;
}

/** A data de emissão do movimento: o número de série do Excel ou o texto dd/mm/aaaa; outra coisa, sem data. */
function dataDaCelula(v: ValorCelula): Date | null {
  if (typeof v === "number" && v > 36500 && v < 73000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000);
  if (typeof v === "string") {
    const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  }
  return null;
}

function rotuloMes(ano: number, mes: number): string {
  return `${MESES_CURTOS[mes - 1]}/${ano}`;
}

/**
 * Valor numérico de uma célula. Vazio é ausência (null); texto que não é
 * número é erro (undefined). Arredonda em centavos: o RM exporta valores como
 * 158881.51999999999, que são 158881.52.
 */
function decimal(v: ValorCelula): Decimal | null | undefined {
  if (v === null || v === "") return null;
  if (typeof v === "number") return new Decimal(v).toDecimalPlaces(2);
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) {
    return new Decimal(v.trim()).toDecimalPlaces(2);
  }
  return undefined;
}

function ehSubtotal(celulas: ValorCelula[]): boolean {
  return celulas.some(
    (c) => typeof c === "string" && /(^|\s)Total( Geral)?$/i.test(c.trim()),
  );
}

function localizarCabecalho(linhas: LinhaPlanilha[]) {
  for (const linha of linhas.slice(0, 20)) {
    const nomes = linha.celulas.map(normalizar);
    if (nomes.includes("FILIAL") && nomes.includes("REDUZIDO_CONTA")) {
      return linha;
    }
  }
  return null;
}

export function interpretarBalancete(
  linhas: LinhaPlanilha[],
  ano: number,
  mes: number,
): LeituraBalancete {
  const cabecalho = localizarCabecalho(linhas);
  if (!cabecalho) {
    return {
      ok: false,
      motivo:
        "Cabeçalho não encontrado. A aba precisa ter, nas primeiras linhas, " +
        "as colunas FILIAL e REDUZIDO_CONTA, como na aba Balancete (Lista).",
    };
  }

  const nomes = cabecalho.celulas.map(normalizar);
  const faltantes = Object.values(COLUNAS_OBRIGATORIAS).filter(
    (n) => !nomes.includes(n),
  );
  if (faltantes.length > 0) {
    return {
      ok: false,
      motivo: `Faltam colunas no cabeçalho: ${faltantes.join(", ")}.`,
    };
  }
  const col = Object.fromEntries(
    Object.entries(COLUNAS_OBRIGATORIAS).map(([k, n]) => [k, nomes.indexOf(n)]),
  ) as Colunas;
  // As colunas do detalhe (15/10/2026); com alguma delas, o balancete é detalhado.
  const colDetalhe = { cliForn: nomes.indexOf("CLI_FORN"), emissao: nomes.indexOf("EMISSAO"), historico: nomes.indexOf("HISTORICO") };
  const detalhado = Object.values(colDetalhe).some((i) => i >= 0);
  // O ID do movimento no RM (10/11/2026): opcional, como o detalhe.
  const colId = nomes.indexOf("ID");

  // Colunas do mês da competência, e o inventário dos meses para a mensagem.
  const doMes: number[] = [];
  const mesesNoArquivo = new Map<string, true>();
  cabecalho.celulas.forEach((v, i) => {
    const m = mesDoCabecalho(v);
    if (!m) return;
    mesesNoArquivo.set(rotuloMes(m.ano, m.mes), true);
    if (m.ano === ano && m.mes === mes) doMes.push(i);
  });

  if (doMes.length === 0) {
    const encontrados = [...mesesNoArquivo.keys()];
    return {
      ok: false,
      motivo:
        `O arquivo não traz a coluna de ${rotuloMes(ano, mes)}. ` +
        (encontrados.length
          ? `Meses encontrados: ${encontrados.join(", ")}.`
          : "Nenhuma coluna de mês foi reconhecida no cabeçalho."),
    };
  }
  // Três colunas (parciais + movimentação) ou uma só (movimentação).
  if (doMes.length !== 3 && doMes.length !== 1) {
    return {
      ok: false,
      motivo:
        `Esperava 3 colunas para ${rotuloMes(ano, mes)} — crédito, débito e ` +
        `movimentação — e o arquivo tem ${doMes.length}.`,
    };
  }
  const colTotal = doMes[doMes.length - 1];
  // As colunas de agrupamento (antes do primeiro mês). Na tabela dinâmica, o subtotal traz "… Total" numa delas e as
  // seguintes vazias; a última (no detalhado, o HISTORICO) nunca tem subtotal — um histórico que termine em "Total" é
  // movimento (15/10/2026: os subtotais por conta do balancete detalhado, com " Total" na coluna CLI_FORN).
  const primeiroMes = cabecalho.celulas.findIndex((v) => mesDoCabecalho(v) !== null);
  const ultimaDimensao = (primeiroMes > 0 ? primeiroMes : cabecalho.celulas.length) - 1;
  const ehSubtotalDaTabela = (c: ValorCelula[]) => {
    for (let i = 0; i < ultimaDimensao; i++) {
      const v = c[i];
      if (typeof v === "string" && /(^|\s)Total$/.test(v.trim()) && c.slice(i + 1, ultimaDimensao + 1).every((x) => x === null || x === undefined || String(x).trim() === "")) return true;
    }
    return false;
  };
  const colParciais = doMes.length === 3 ? doMes.slice(0, 2) : [];

  const lancamentos: LinhaBalancete[] = [];
  const rejeicoes: Rejeicao[] = [];
  const ignoradas = { subtotais: 0, semMovimento: 0 };
  const chaves = new Map<string, number>();
  let linhasLidas = 0;
  let somaArquivo = new Decimal(0);
  let totalGeral: Decimal | null = null;
  let tabelasDoMes = 0;

  for (const linha of linhas) {
    if (linha.numero <= cabecalho.numero) continue;
    const c = linha.celulas;
    const celula = (i: number) => c[i] ?? null;
    linhasLidas++;

    // A Total Geral de cada tabela da aba (22/10/2026; antes, valia só a última): somam-se; a que não tem o mês, vazia, não conta.
    if (normalizar(celula(0)) === "TOTAL GERAL") {
      const doMes = decimal(celula(colTotal));
      if (doMes) tabelasDoMes++;
      totalGeral = (totalGeral ?? new Decimal(0)).plus(doMes ?? 0);
      ignoradas.subtotais++;
      continue;
    }

    if (ehSubtotalDaTabela(c)) {
      ignoradas.subtotais++;
      continue;
    }

    const reduzido = texto(celula(col.reduzido));
    const total = decimal(celula(colTotal));

    // Subtotal por conta, se a tabela dinâmica tiver um, traz "16656 Total"
    // na própria coluna da conta.
    if (!reduzido || /Total$/i.test(reduzido)) {
      if (ehSubtotal(c)) {
        ignoradas.subtotais++;
      } else if (!total || total.isZero()) {
        // Item vazio da tabela dinâmica: filial sem centro nem conta, zerado.
        ignoradas.semMovimento++;
      } else {
        somaArquivo = somaArquivo.plus(total);
        rejeicoes.push({
          linha: linha.numero,
          codigo: "CONTA_AUSENTE",
          mensagem: "Linha com movimentação e sem conta (REDUZIDO_CONTA vazio).",
          valor: total.toFixed(2),
        });
      }
      continue;
    }

    const filialTexto = texto(celula(col.filial));
    const codigoCentroCusto = texto(celula(col.codigoCentroCusto));
    const base = { linha: linha.numero, filial: filialTexto ?? "", codigoCentroCusto, reduzido };

    if (total === undefined || colParciais.some((i) => decimal(celula(i)) === undefined)) {
      rejeicoes.push({
        ...base,
        codigo: "VALOR_INVALIDO",
        mensagem: `Valor de ${rotuloMes(ano, mes)} não é número.`,
      });
      continue;
    }

    const parciais = colParciais.map((i) => decimal(celula(i)) ?? new Decimal(0));
    const movimento = total ?? new Decimal(0);
    somaArquivo = somaArquivo.plus(movimento);

    if (parciais.length === 2) {
      const soma = parciais[0].plus(parciais[1]);
      if (soma.minus(movimento).abs().greaterThan(CENTAVO)) {
        rejeicoes.push({
          ...base,
          codigo: "TOTAL_DIVERGENTE",
          mensagem:
            `Movimentação ${movimento.toFixed(2)} difere da soma de crédito e ` +
            `débito (${soma.toFixed(2)}).`,
          valor: movimento.toFixed(2),
        });
        continue;
      }
    }

    if (movimento.isZero()) {
      ignoradas.semMovimento++;
      continue;
    }

    const filial = Number(filialTexto);
    if (!filialTexto || !Number.isInteger(filial) || filial <= 0) {
      rejeicoes.push({
        ...base,
        codigo: "FILIAL_INVALIDA",
        mensagem: `Filial "${filialTexto ?? ""}" não é um código de filial.`,
        valor: movimento.toFixed(2),
      });
      continue;
    }

    // No detalhado, a mesma filial, centro e conta se repetem: cada linha é um movimento.
    const chave = `${filial}|${codigoCentroCusto ?? ""}|${reduzido}`;
    const anterior = detalhado ? undefined : chaves.get(chave);
    if (anterior !== undefined) {
      rejeicoes.push({
        ...base,
        codigo: "LINHA_DUPLICADA",
        mensagem: `Mesma filial, centro de custo e conta da linha ${anterior}.`,
        valor: movimento.toFixed(2),
      });
      continue;
    }
    chaves.set(chave, linha.numero);

    lancamentos.push({
      linhaArquivo: linha.numero,
      filial,
      codigoCentroCusto,
      nomeCentroCusto: texto(celula(col.nomeCentroCusto)),
      reduzido,
      descricaoConta: texto(celula(col.descricaoConta)),
      valorMovimento: movimento,
      cliForn: colDetalhe.cliForn >= 0 ? texto(celula(colDetalhe.cliForn)) : null,
      emissao: colDetalhe.emissao >= 0 ? dataDaCelula(celula(colDetalhe.emissao)) : null,
      historico: colDetalhe.historico >= 0 ? texto(celula(colDetalhe.historico)) : null,
      idMovimento: colId >= 0 ? texto(celula(colId)) : null,
    });
  }

  return {
    ok: true,
    linhasLidas,
    lancamentos,
    rejeicoes,
    ignoradas,
    somaArquivo,
    totalGeral,
    tabelasDoMes,
  };
}

/**
 * A conferência do arquivo contra ele mesmo: a soma das linhas tem de bater
 * com o Total Geral das tabelas dinâmicas. Se não bate, o arquivo foi editado à
 * mão ou cortado, e gravar metade dele seria pior do que recusar. O mesmo mês
 * em duas tabelas da aba (`tabelasDoMes`) também se recusa: as linhas dele
 * entrariam duas vezes.
 */
export function conferirTotal(
  somaArquivo: Decimal,
  totalGeral: Decimal | null,
  tabelasDoMes = 1,
): string | null {
  if (tabelasDoMes > 1) {
    return (
      `O mês aparece em ${tabelasDoMes} tabelas da aba (${tabelasDoMes} linhas Total Geral com valor nele): ` +
      "as linhas dele entrariam mais de uma vez. Deixe o mês numa tabela só."
    );
  }
  if (totalGeral === null) return null;
  const diferenca = somaArquivo.minus(totalGeral);
  if (diferenca.abs().lessThanOrEqualTo(CENTAVO)) return null;
  return (
    `A soma das linhas (${somaArquivo.toFixed(2)}) não confere com o Total ` +
    `Geral do arquivo (${totalGeral.toFixed(2)}); diferença de ` +
    `${diferenca.toFixed(2)}. O arquivo parece ter sido cortado ou editado.`
  );
}
