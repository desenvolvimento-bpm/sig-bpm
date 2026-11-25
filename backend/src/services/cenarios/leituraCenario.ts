import type { LinhaPlanilha, ValorCelula } from "../../lib/xlsx.js";
import { atualDe, nomesAntigos } from "../relatorios/indicadoresDoSistema.js";
import { ehAConta } from "../dre/descricaoDeOrigem.js";

/**
 * A leitura de um cenário sintético (11/10/2026): as abas da DRE por unidade, como as do ORÇAMENTO BPM 2026 -
 * CENÁRIO ADOTADO (Consolidado, Matriz, Filial, Serviços, Desp.+Extra e Extra RN, com a descrição na coluna A e,
 * no rótulo da linha 1, os meses JAN/26 a DEZ/26 intercalados com o %), e a aba das metas dos indicadores, como a
 * Metas (ou Metas (Orçamento)) do INDICADORES DE RESULTADO (INDICADOR e os meses JAN/2026 a DEZ/2026). O nome do
 * arquivo não importa: as abas são reconhecidas pelo nome.
 *
 * Cada linha de uma aba da DRE se liga à da Estrutura da DRE pela descrição, na ordem — a próxima linha da estrutura
 * com a mesma descrição —, como na Conferência com a planilha; uma descrição repetida na aba fica com a primeira.
 */

export const MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

/** As abas da DRE por visão (0 Consolidado, 1 a 5 as unidades), pelos nomes aceitos. */
export const ABAS_DRE: Array<{ visao: number; nome: string; abas: string[] }> = [
  { visao: 0, nome: "Consolidado", abas: ["Consolidado", "Resultados (Consolidado)"] },
  { visao: 1, nome: "Matriz", abas: ["Matriz", "Resultados (Matriz)"] },
  { visao: 2, nome: "Filial", abas: ["Filial", "Resultados (Filial)"] },
  { visao: 3, nome: "Serviços", abas: ["Serviços", "Resultados (Serviços)"] },
  { visao: 4, nome: "Despesas e Extra", abas: ["Desp.+Extra", "Desp. +Extra", "Despesas e Extra", "Resultados (Desp.+Extra)"] },
  { visao: 5, nome: "RN", abas: ["RN", "Extra RN", "Resultados (RN)"] },
];
/** A aba das metas: a Metas (Orçamento) traz o ano inteiro; a Metas, só até o mês de referência da planilha. */
export const ABAS_METAS = ["Metas (Orçamento)", "Metas"];

/** Totais que só as abas da planilha têm (a soma dos gastos da unidade), como na Conferência com a planilha. */
const TOTAIS_SO_DA_PLANILHA = new Set(["DESPESAS + EXTRA OPERACIONAL (DEO)", "EXTRA OPERACIONAL (EO)"]);
/** Grafias da planilha diferentes das da estrutura ("(pst)" na aba Consolidado do orçamento). */
const GRAFIAS: Record<string, string> = { "PRODUÇÃO DO PRÉ-FABRICADO (PST)": "PRODUÇÃO DO PRÉ-FABRICADO (PISTAS)" };
/**
 * Outros nomes de um indicador na aba das metas → o nome original do indicador (o de 19/11/2026). Depois da troca do nome do
 * indicador, o apelido também é um nome antigo e é recusado.
 */
const APELIDOS: Record<string, string> = { "QUADRO DE LOTAÇÃO": "Quadro de Lotação Total" };

const normalizar = (v: ValorCelula | undefined) => String(v ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toUpperCase();
const nomeDaAba = (v: string) => v.normalize("NFC").replace(/\s+/g, "").toUpperCase();

/** A aba do arquivo com um dos nomes (sem diferença de espaços e de maiúsculas). */
export function acharAba(abas: string[], nomes: string[]): string | null {
  for (const n of nomes) {
    const achada = abas.find((a) => nomeDaAba(a) === nomeDaAba(n));
    if (achada) return achada;
  }
  return null;
}

const numero = (v: ValorCelula | undefined): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v.trim() === "" || v.trim() === "-") return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** O ano e o mês do rótulo de uma coluna: "JAN/26", "JAN/2026" ou a data (serial do Excel). */
function mesDoRotulo(v: ValorCelula): { ano: number; mes: number } | null {
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 };
  }
  const m = normalizar(v).match(/^([A-ZÇ]{3})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const mes = MESES.indexOf(m[1]) + 1;
  if (mes === 0) return null;
  return { ano: m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]), mes };
}

/** As colunas dos meses no rótulo: a primeira de cada mês (as abas repetem DEZ/26 no fim, na coluna do total). */
function colunasDosMeses(celulas: ValorCelula[]): { ano: number | null; colunas: Map<number, number> } {
  const colunas = new Map<number, number>();
  let ano: number | null = null;
  celulas.forEach((v, c) => {
    const r = mesDoRotulo(v);
    if (!r || colunas.has(r.mes)) return;
    if (ano === null) ano = r.ano;
    if (r.ano === ano) colunas.set(r.mes, c);
  });
  return { ano, colunas };
}

export type LinhaDaEstrutura = { id: string; codigo: string; descricao: string };
export type ValorDRE = { linhaDREId: string; mes: number; valor: number };
export type AbaDRELida = { visao: number; aba: string; ano: number; meses: number; linhas: number; valores: ValorDRE[]; semPar: string[] };

/**
 * Uma aba da DRE: os valores de cada mês, ligados às linhas da estrutura (na ordem da DRE). Null quando a aba, com o
 * nome de uma unidade, não é uma DRE (sem os meses no rótulo ou sem nenhuma linha da estrutura): a aba Serviços do
 * INDICADORES DE RESULTADO, por exemplo, é a dos indicadores do setor.
 */
export function lerAbaDRE(visao: number, aba: string, linhas: LinhaPlanilha[], estrutura: LinhaDaEstrutura[]): AbaDRELida | null {
  const cabecalho = linhas.find((l) => l.celulas.some((v) => mesDoRotulo(v)));
  if (!cabecalho || normalizar(cabecalho.celulas[0]) === "GRUPO") return null;
  const { ano, colunas } = colunasDosMeses(cabecalho.celulas);
  const ligadas = new Map<string, string>();
  const valores: ValorDRE[] = [];
  const semPar: string[] = [];
  let j = 0;
  let lidas = 0;
  for (const l of linhas) {
    if (l.numero <= cabecalho.numero) continue;
    const bruta = normalizar(l.celulas[0]);
    if (!bruta || TOTAIS_SO_DA_PLANILHA.has(bruta)) continue;
    const desc = GRAFIAS[bruta] ?? bruta;
    // Pela Descrição atual ou pela de origem (25/11/2026: o arquivo com o nome de antes de uma troca).
    const k = estrutura.findIndex((e, i) => i >= j && (normalizar(e.descricao) === desc || ehAConta(e, desc)));
    if (k >= 0) {
      j = k + 1;
      ligadas.set(desc, estrutura[k].id);
    } else if (!ligadas.has(desc)) {
      // Sem par na estrutura: só avisa quando a linha tem valor.
      if ([...colunas.values()].some((c) => (numero(l.celulas[c]) ?? 0) !== 0)) semPar.push(`${l.numero}: ${String(l.celulas[0]).trim()}`);
      continue;
    } else continue; // a descrição repetida fica com a primeira
    lidas++;
    for (const [mes, c] of colunas) {
      const v = numero(l.celulas[c]);
      if (v !== null) valores.push({ linhaDREId: estrutura[k].id, mes, valor: Math.round(v * 1e6) / 1e6 });
    }
  }
  return lidas === 0 ? null : { visao, aba, ano: ano ?? 0, meses: colunas.size, linhas: lidas, valores, semPar };
}

export type ValorMeta = { nome: string; mes: number; valor: number };
export type AbaMetasLida = {
  aba: string;
  ano: number;
  indicadores: number;
  valores: ValorMeta[];
  ignorados: string[];
  /** As linhas com o nome antigo de um indicador renomeado (19/11/2026): "nome antigo → nome atual"; o arquivo é recusado. */
  nomesAntigos: string[];
};

/**
 * A aba das metas: o valor de cada mês dos indicadores do cadastro (os outros nomes são ignorados e listados; os nomes antigos
 * dos indicadores renomeados, listados à parte, recusam o arquivo); null sem a coluna INDICADOR.
 */
export function lerAbaMetas(aba: string, linhas: LinhaPlanilha[], nomes: string[], antigos: ReadonlyMap<string, string> = nomesAntigos()): AbaMetasLida | null {
  const cabecalho = linhas.find((l) => l.celulas.some((v) => normalizar(v) === "INDICADOR"));
  if (!cabecalho) return null;
  const colNome = cabecalho.celulas.findIndex((v) => normalizar(v) === "INDICADOR");
  const { ano, colunas } = colunasDosMeses(cabecalho.celulas);
  const porNome = new Map(nomes.map((n) => [normalizar(n), n]));
  // Os nomes antigos: os das trocas e os apelidos dos indicadores renomeados (o apelido vale só com o nome original).
  const porAntigo = new Map([...antigos].map(([antigo, atual]) => [normalizar(antigo), atual] as const));
  for (const [apelido, original] of Object.entries(APELIDOS)) if (atualDe(original) !== original) porAntigo.set(apelido, atualDe(original));
  const valores: ValorMeta[] = [];
  const ignorados: string[] = [];
  const comNomeAntigo: string[] = [];
  const vistos = new Set<string>();
  for (const l of linhas) {
    if (l.numero <= cabecalho.numero) continue;
    const bruto = normalizar(l.celulas[colNome]);
    if (!bruto) continue;
    const nome = porNome.get(bruto) ?? (APELIDOS[bruto] && atualDe(APELIDOS[bruto]) === APELIDOS[bruto] && porNome.has(normalizar(APELIDOS[bruto])) ? APELIDOS[bruto] : null);
    const atual = nome ? undefined : porAntigo.get(bruto);
    if (atual) {
      comNomeAntigo.push(`${String(l.celulas[colNome]).trim()} → ${atual}`);
      continue;
    }
    if (!nome) {
      ignorados.push(String(l.celulas[colNome]).trim());
      continue;
    }
    if (vistos.has(nome)) continue;
    vistos.add(nome);
    for (const [mes, c] of colunas) {
      const v = numero(l.celulas[c]);
      if (v !== null) valores.push({ nome, mes, valor: v });
    }
  }
  return { aba, ano: ano ?? 0, indicadores: vistos.size, valores, ignorados, nomesAntigos: comNomeAntigo };
}
