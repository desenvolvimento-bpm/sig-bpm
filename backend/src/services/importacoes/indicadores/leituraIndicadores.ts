import type { TipoImportacao } from "../../../generated/prisma/enums.js";
import type { LinhaPlanilha, ValorCelula } from "../../../lib/xlsx.js";
import { getPrismaClient } from "../../../config/prisma.js";
import { ESTRUTURA_INICIAL_INDICADORES } from "../../relatorios/estruturaInicialIndicadores.js";
import { atualDe, IND, nomeDo, nomesAntigos } from "../../relatorios/indicadoresDoSistema.js";

/**
 * Os nomes dos indicadores do cadastro Estrutura dos Indicadores, para a aba das metas (11/10/2026): um indicador
 * novo no cadastro já recebe a meta dele. Lidos do banco antes de cada análise e de cada importação; até lá, os da
 * carga inicial.
 */
let nomesDasMetas: string[] = ESTRUTURA_INICIAL_INDICADORES.map((i) => i.nome);
export async function atualizarNomesDasMetas() {
  const nomes = (await getPrismaClient().indicadorEstrutura.findMany({ select: { nome: true } })).map((i) => i.nome);
  if (nomes.length) nomesDasMetas = nomes;
}

/**
 * Indicadores gerenciais que não saem da DRE, importados mês a mês:
 *
 * - aba Indicadores (Admin.) do SIG BPM 2026 - LISTAS REALIZADO (OPERAÇÃO):
 *   o quadro de lotação, o fluxo de caixa, a inadimplência, o turnover, as
 *   vagas e os acidentes;
 * - aba Indicadores (Comercial) do CONTROLE DAS VENDAS - COMERCIAL: as vendas,
 *   a receita líquida vendida, a margem de contribuição das vendas, a demanda
 *   e o mix ampliado.
 *
 * E as metas do orçamento, da aba Metas (Orçamento) do INDICADORES DE
 * RESULTADO: o valor orçado de cada um dos indicadores do catálogo, a base do
 * "vs. Orçado" do Painel de Bordo.
 *
 * As abas têm o mesmo leiaute: a coluna INDICADOR (a primeira nas abas dos
 * indicadores; a segunda, depois de GRUPO, na das metas) e uma coluna por mês
 * (a data do dia 1º, ou JAN/2026). Cada linha é um indicador, pelo nome da aba
 * Realizado (SIG) do INDICADORES DE RESULTADO; o valor é o da coluna do mês da
 * competência.
 */

export type TipoIndicadores = "INDICADORES_ADMIN" | "INDICADORES_COMERCIAL" | "METAS_ORCAMENTO";

type Definicao = {
  aba: string;
  rotulo: string;
  /** Os indicadores da aba, pelo ID (19/11/2026): a linha da aba vale pelo nome atual do indicador. */
  ids?: readonly string[];
  /** Os nomes atuais (dos IDs; nas metas, os do cadastro). */
  readonly nomes: string[];
  /** Onde o valor é gravado: os indicadores realizados ou as metas do orçamento. */
  destino: "INDICADOR" | "META";
  /**
   * Outros nomes de um indicador na aba (o nome da aba → o nome original do indicador, o de 19/11/2026). Depois da troca do
   * nome do indicador, o apelido também é um nome antigo e é recusado.
   */
  apelidos?: Record<string, string>;
  /** Linhas com nome fora do catálogo são ignoradas, e não rejeitadas (a aba das metas tem indicadores que a ferramenta não calcula). */
  ignorarOutros?: boolean;
};

export const DEFINICOES_INDICADORES: Record<TipoIndicadores, Definicao> = {
  INDICADORES_ADMIN: {
    aba: "Indicadores (Admin.)",
    rotulo: "Indicadores do Administrativo",
    destino: "INDICADOR",
    ids: [
      IND.QL_DIRETA_MATRIZ,
      IND.QL_DIRETA_FILIAL,
      IND.QL_DIRETA_TOTAL,
      IND.QL_INDIRETA_MATRIZ,
      IND.QL_INDIRETA_FILIAL,
      IND.QL_INDIRETA_TOTAL,
      IND.QL_GERAL_MATRIZ,
      IND.QL_GERAL_FILIAL,
      IND.QL_GERAL_TOTAL,
      IND.QL_DIRETA_MONTAGEM,
      IND.QL_INDIRETA_MONTAGEM,
      IND.QL_GERAL_MONTAGEM,
      IND.FCOL,
      IND.INADIMPLENCIA,
      IND.QUADRO_TOTAL,
      IND.TURNOVER,
      IND.CONTRATACOES,
      IND.ACIDENTES,
    ],
    get nomes() {
      return (this.ids ?? []).map(nomeDo);
    },
  },
  INDICADORES_COMERCIAL: {
    aba: "Indicadores (Comercial)",
    rotulo: "Indicadores do Comercial",
    destino: "INDICADOR",
    ids: [
      IND.VENDA_GLOBAL,
      IND.VENDA_MERCANTIL,
      IND.VENDA_TOTAL,
      IND.RLV_GLOBAL,
      IND.RLV_MERCANTIL,
      IND.RLV_TOTAL,
      IND.MCV_GLOBAL,
      IND.MCV_MERCANTIL,
      IND.MCV_TOTAL,
      IND.DEMANDA_MATRIZ,
      IND.DEMANDA_FILIAL,
      IND.DEMANDA_FABRICACAO,
      IND.DEMANDA_MONTAGEM,
      IND.DEMANDA_PISTAS_FILIAL,
      IND.MIX_AMPLIADO,
    ],
    get nomes() {
      return (this.ids ?? []).map(nomeDo);
    },
  },
  // Desde 11/10/2026, não se importa mais no mês (as metas ficam nos cenários); a definição fica para as importações antigas.
  METAS_ORCAMENTO: {
    aba: "Metas (Orçamento)",
    rotulo: "Metas do Orçamento",
    destino: "META",
    get nomes() {
      return nomesDasMetas;
    },
    apelidos: { "Quadro de Lotação": "Quadro de Lotação Total" },
    ignorarOutros: true,
  },
};

export const ehTipoIndicadores = (tipo: string): tipo is TipoIndicadores => tipo in DEFINICOES_INDICADORES;

/**
 * Os tipos que não entram na apuração: importá-los depois de apurar não muda
 * nenhum valor apurado, então não pede reapuração (nem acende a bola verde).
 */
// As requisições e as notas fiscais (11/10/2026) também ficam fora das importações do retrato: desde 26/10/2026 têm
// entrada própria nele (a etapa Linhas), para as apurações de antes não acusarem mudança. E o quadro de lotação por
// centro de custo (19/10/2026): a referência dos cenários analíticos.
export const TIPOS_FORA_DA_APURACAO: TipoImportacao[] = [...(Object.keys(DEFINICOES_INDICADORES) as TipoIndicadores[]), "REQUISICOES", "NOTAS_FISCAIS", "QUADRO_LOTACAO", "CREDITOS_IMPOSTOS"];

export type ValorIndicador = { nome: string; valor: number; linhaArquivo: number };
export type Rejeicao = { linha: number; codigo: string; mensagem: string };

/** A recusa do arquivo com nomes antigos de indicadores (19/11/2026), ou nulo. */
export function recusaPorNomesAntigos(rejeicoes: Rejeicao[]): string | null {
  const antigas = rejeicoes.filter((r) => r.codigo === "NOME_ANTIGO");
  if (!antigas.length) return null;
  return `O arquivo tem ${antigas.length === 1 ? "um nome antigo de indicador" : `${antigas.length} nomes antigos de indicadores`}, e nada foi gravado: ${antigas
    .slice(0, 5)
    .map((r) => `linha ${r.linha}, ${r.mensagem.replace(/: mude o nome no arquivo e importe de novo\.$/, "")}`)
    .join("; ")}${antigas.length > 5 ? "…" : ""}. Mude os nomes no arquivo e importe de novo.`;
}
export type LeituraIndicadores =
  | { ok: true; valores: ValorIndicador[]; rejeicoes: Rejeicao[]; lidas: number; vazias: number }
  | { ok: false; motivo: string };

const normalizar = (v: ValorCelula) => String(v ?? "").trim().replace(/\s+/g, " ").toUpperCase();

/** O ano e o mês do rótulo de uma coluna: a data (serial do Excel ou texto dd/mm/aaaa) ou "AGO/2026". */
function mesDaColuna(v: ValorCelula): { ano: number; mes: number } | null {
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000);
    return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 };
  }
  const t = String(v ?? "").trim().toUpperCase();
  const data = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (data) return { ano: Number(data[3]), mes: Number(data[2]) };
  const MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
  const nome = t.match(/^([A-Z]{3})\/(\d{2}|\d{4})$/);
  if (nome && MESES.includes(nome[1])) return { ano: Number(nome[2].length === 2 ? `20${nome[2]}` : nome[2]), mes: MESES.indexOf(nome[1]) + 1 };
  return null;
}

const numero = (v: ValorCelula): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = String(v ?? "").trim();
  if (!t) return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/**
 * Lê o mês da aba: o valor de cada indicador do catálogo do tipo. Recusa a aba
 * sem o cabeçalho ou sem a coluna do mês; uma linha de indicador fora do
 * catálogo ou com valor que não é número é rejeitada (e relatada).
 *
 * `antigos` (19/11/2026): os nomes antigos dos indicadores renomeados → o nome atual. A linha com um nome antigo é
 * rejeitada, com o nome novo na mensagem: o arquivo muda antes de importar (pedido do Adão).
 */
export function lerIndicadores(tipo: TipoIndicadores, linhas: LinhaPlanilha[], ano: number, mes: number, antigos: ReadonlyMap<string, string> = nomesAntigos()): LeituraIndicadores {
  const def = DEFINICOES_INDICADORES[tipo];
  const cabecalho = linhas.find((l) => l.celulas.slice(0, 3).some((v) => normalizar(v) === "INDICADOR"));
  if (!cabecalho) return { ok: false, motivo: `A aba não tem o cabeçalho (coluna INDICADOR). Envie a aba ${def.aba}.` };
  const colunaNome = cabecalho.celulas.findIndex((v) => normalizar(v) === "INDICADOR");
  const coluna = cabecalho.celulas.findIndex((v, i) => i > colunaNome && (() => {
    const m = mesDaColuna(v);
    return m !== null && m.ano === ano && m.mes === mes;
  })());
  if (coluna < 0) return { ok: false, motivo: `A aba não tem a coluna de ${String(mes).padStart(2, "0")}/${ano}.` };
  // Os apelidos valem enquanto o indicador tem o nome original; depois da troca, são nomes antigos.
  const apelidos = Object.entries(def.apelidos ?? {}).filter(([, original]) => atualDe(original) === original);
  const catalogo = new Map([...def.nomes.map((n) => [normalizar(n), n] as const), ...apelidos.map(([a, n]) => [normalizar(a), n] as const)]);
  const nomesAntigos = new Map([...antigos].map(([antigo, atual]) => [normalizar(antigo), atual] as const));
  for (const [a, original] of Object.entries(def.apelidos ?? {})) if (atualDe(original) !== original) nomesAntigos.set(normalizar(a), atualDe(original));
  const valores: ValorIndicador[] = [];
  const rejeicoes: Rejeicao[] = [];
  let lidas = 0;
  let vazias = 0;
  for (const l of linhas) {
    if (l.numero <= cabecalho.numero) continue;
    const nome = normalizar(l.celulas[colunaNome]);
    if (!nome) continue;
    lidas++;
    const bruto = l.celulas[coluna];
    if (bruto === null || String(bruto).trim() === "") {
      vazias++;
      continue;
    }
    const doCatalogo = catalogo.get(nome);
    const atual = doCatalogo ? undefined : nomesAntigos.get(nome);
    if (atual) {
      rejeicoes.push({
        linha: l.numero,
        codigo: "NOME_ANTIGO",
        mensagem: `"${String(l.celulas[colunaNome]).trim()}" é o nome antigo do indicador ${atual}: mude o nome no arquivo e importe de novo.`,
      });
      continue;
    }
    if (!doCatalogo && def.ignorarOutros) {
      vazias++;
      continue;
    }
    if (!doCatalogo) {
      rejeicoes.push({ linha: l.numero, codigo: "INDICADOR_DESCONHECIDO", mensagem: `"${String(l.celulas[colunaNome]).trim()}" não é um indicador do catálogo.` });
      continue;
    }
    const v = numero(bruto);
    if (v === null) {
      rejeicoes.push({ linha: l.numero, codigo: "VALOR_INVALIDO", mensagem: `O valor de "${doCatalogo}" não é um número.` });
      continue;
    }
    valores.push({ nome: doCatalogo, valor: v, linhaArquivo: l.numero });
  }
  return { ok: true, valores, rejeicoes, lidas, vazias };
}
