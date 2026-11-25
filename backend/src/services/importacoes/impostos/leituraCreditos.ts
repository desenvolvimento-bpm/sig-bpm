import type { LinhaPlanilha, ValorCelula } from "../../../lib/xlsx.js";
import { data, localizarCabecalho, mesmoMes, normalizar, numero, texto } from "../listas/leituraListas.js";
import { nomeDaUnidade } from "../../cadastros/nomesDasUnidades.js";

/**
 * A leitura da aba Impostos (Lista) do SIG BPM 2026 - LISTAS REALIZADO (RESULTADOS) (04/11/2026, pedido do Adão): de cada mês
 * (a coluna PERÍODO), unidade (Matriz ou Filial) e conta (a ATRIBUIÇÃO e a CONTA, pela atribuição e pelo nome da conta na
 * Estrutura da DRE: os Outros Custos/Despesas dos Gastos Gerais Diretos e os dos Indiretos são contas diferentes), o CREDITADO
 * e o ESTORNADO em R$ (as colunas E e F). O % ESTORNADO da aba não se grava: os percentuais saem na tela Impostos, sobre o
 * custo da conta na unidade. Não entra na apuração.
 */

export const ABA_CREDITOS = "Impostos (Lista)";
export const ROTULO_CREDITOS = "Créditos de Impostos";

/** As unidades da aba, pelo nome: o código da unidade de negócio. */
const UNIDADES: Record<string, 1 | 2> = { MATRIZ: 1, FILIAL: 2 };

export type ItemCredito = {
  linhaArquivo: number;
  /** 1 Matriz, 2 Filial. */
  unidade: 1 | 2;
  /** A atribuição e o nome da conta, como vieram na aba. */
  atribuicao: string;
  conta: string;
  creditado: number;
  estornado: number;
};
export type RejeicaoCredito = { linha: number; codigo: "UNIDADE_INVALIDA" | "SEM_CONTA" | "VALOR_INVALIDO" | "REPETIDA" | "CONTA_DESCONHECIDA"; mensagem: string };
export type LeituraCreditos =
  | { ok: true; itens: ItemCredito[]; rejeicoes: RejeicaoCredito[]; lidas: number; foraDoMes: number }
  | { ok: false; motivo: string };

/** O nome da conta para comparar com a Estrutura da DRE: sem acentos, sem espaços repetidos, em maiúsculas. */
export const nomeDaConta = (v: ValorCelula | undefined) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();

/** A chave de uma conta: a atribuição e o nome, para comparar com a Estrutura da DRE. */
export const chaveDaConta = (atribuicao: ValorCelula | undefined, conta: ValorCelula | undefined) => `${nomeDaConta(atribuicao)}|${nomeDaConta(conta)}`;

/** Um valor em R$: número (vazio conta zero), sem sinal; undefined quando não é. */
function reais(v: ValorCelula | undefined): number | undefined {
  const n = numero(v);
  if (n === undefined || n.isNegative()) return undefined;
  return n.toNumber();
}

/** As linhas do mês da aba. */
export function lerCreditos(linhas: LinhaPlanilha[], ano: number, mes: number): LeituraCreditos {
  const cab = localizarCabecalho(linhas, ["PERÍODO", "UNIDADE", "ATRIBUIÇÃO", "CONTA", "CREDITADO (R$)", "ESTORNADO (R$)"]);
  if ("erro" in cab) return { ok: false, motivo: cab.erro };
  const c = (l: LinhaPlanilha, n: string) => (cab.col[n] >= 0 ? (l.celulas[cab.col[n]] ?? null) : null);
  const itens: ItemCredito[] = [];
  const rejeicoes: RejeicaoCredito[] = [];
  const vistas = new Set<string>();
  let lidas = 0;
  let foraDoMes = 0;
  for (const l of linhas) {
    if (l.numero <= cab.numero) continue;
    const periodo = data(c(l, "PERÍODO"));
    if (!periodo) continue; // linha vazia
    lidas++;
    if (!mesmoMes(periodo, ano, mes)) {
      foraDoMes++;
      continue;
    }
    const unidade = UNIDADES[normalizar(c(l, "UNIDADE"))];
    const atribuicao = texto(c(l, "ATRIBUIÇÃO"));
    const conta = texto(c(l, "CONTA"));
    if (!unidade) {
      rejeicoes.push({ linha: l.numero, codigo: "UNIDADE_INVALIDA", mensagem: `A UNIDADE "${String(c(l, "UNIDADE") ?? "")}" não é Matriz nem Filial.` });
      continue;
    }
    if (!atribuicao || !conta) {
      rejeicoes.push({ linha: l.numero, codigo: "SEM_CONTA", mensagem: `Linha sem a ${!atribuicao && !conta ? "ATRIBUIÇÃO e a CONTA" : !atribuicao ? `ATRIBUIÇÃO (CONTA ${conta})` : "CONTA"}.` });
      continue;
    }
    const creditado = reais(c(l, "CREDITADO (R$)"));
    const estornado = reais(c(l, "ESTORNADO (R$)"));
    if (creditado === undefined || estornado === undefined) {
      rejeicoes.push({
        linha: l.numero,
        codigo: "VALOR_INVALIDO",
        mensagem: `${atribuicao} › ${conta}: o CREDITADO e o ESTORNADO precisam ser números, sem sinal (CREDITADO ${String(c(l, "CREDITADO (R$)"))}, ESTORNADO ${String(c(l, "ESTORNADO (R$)"))}).`,
      });
      continue;
    }
    const chave = `${unidade}|${chaveDaConta(atribuicao, conta)}`;
    if (vistas.has(chave)) {
      rejeicoes.push({ linha: l.numero, codigo: "REPETIDA", mensagem: `${atribuicao} › ${conta} aparece mais de uma vez na ${nomeDaUnidade(unidade)} no mês.` });
      continue;
    }
    vistas.add(chave);
    itens.push({ linhaArquivo: l.numero, unidade, atribuicao, conta, creditado, estornado });
  }
  return { ok: true, itens, rejeicoes, lidas, foraDoMes };
}
