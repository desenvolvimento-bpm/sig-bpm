import type { LinhaEstrutura } from "../dre/apuracaoUnidades.js";

/**
 * Os investimentos e o extra-operacional dos cenários analíticos (13/10/2026, etapa 4), nas abas Investimentos e
 * Extra-Operacional da tela Premissas:
 *
 * - a Depreciação Base de cada unidade, mês a mês (digitada, ou da referência), na conta de depreciação dela: o
 *   maquinário de produção na Matriz e na Filial (CPP), o de serviços em Serviços (CSM) e o patrimônio em Despesas e
 *   Extra (DA); gravada nas premissas com a venda BASE e a chave "unidade|conta";
 * - os investimentos: cada um deprecia, a partir do mês de início e pela vida útil, (valor total − valor pós uso) ÷ vida
 *   útil por mês, somado à depreciação base da conta (19/10/2026: sem o ROI, o Ganho Previsto e a Receita Bruta Prevista);
 * - o extra-operacional, mês a mês, como os Lançamentos Manuais do fechamento: o imposto de renda e a contribuição
 *   social e as receitas e despesas financeiras, em Despesas e Extra e no RN (no RN, também as Assessorias e Consultorias da
 *   DA, 26/11/2026); gravado nas premissas com a venda EXTRA e a chave "unidade|conta".
 */

export const VENDA_BASE = "BASE";
export const VENDA_EXTRA = "EXTRA";

/** As contas de depreciação de cada unidade (a Matriz e a Filial usam a mesma). */
export const CONTAS_DEPRECIACAO: Array<{ unidade: 1 | 2 | 3 | 4; nomeUnidade: string; conta: string; rotulo: string }> = [
  { unidade: 1, nomeUnidade: "Matriz", conta: "CPP.D.DEPRECIACAO_DO_MAQUINARIO", rotulo: "Depreciação do Maquinário de Produção" },
  { unidade: 2, nomeUnidade: "Filial", conta: "CPP.D.DEPRECIACAO_DO_MAQUINARIO", rotulo: "Depreciação do Maquinário de Produção" },
  { unidade: 3, nomeUnidade: "Serviços", conta: "CSM.D.DEPRECIACAO_DO_MAQUINARIO", rotulo: "Depreciação do Maquinário de Serviços" },
  { unidade: 4, nomeUnidade: "Despesas e Extra", conta: "DA.D.DEPRECIACAO_DO_PATRIMONIO", rotulo: "Depreciação do Patrimônio" },
];
export const contaDeDepreciacao = (unidade: number) => CONTAS_DEPRECIACAO.find((c) => c.unidade === unidade);

/** As unidades do extra-operacional: Despesas e Extra e o RN. */
export const UNIDADES_EXTRA: Array<{ unidade: 4 | 5; nome: string }> = [
  { unidade: 4, nome: "Despesas e Extra" },
  { unidade: 5, nome: "RN" },
];
const GRUPOS_EXTRA = new Set(["DML", "RFC", "RFNC", "DFC", "DFNC"]);

/**
 * As contas do extra-operacional de uma unidade: o IR e a CS e as receitas e despesas financeiras dela. No RN, todas as contas
 * dele (26/11/2026: também as Assessorias e Consultorias da DA), que só têm valor por aqui, como os lançamentos manuais do balde RN
 * no fechamento.
 */
export const contasExtra = (est: LinhaEstrutura[], unidade: number) =>
  est.filter((l) => l.tipo === "ITEM" && l.unidades.includes(unidade) && (unidade === 5 || GRUPOS_EXTRA.has(l.grupoSigla)));

export type Investimento = { unidade: number; conta: string; inicio: number; valorTotal: number; valorPosUso: number; vidaUtil: number };

/** A depreciação mensal do investimento: (valor total − valor pós uso) ÷ vida útil. */
export const depreciacaoMensal = (i: Pick<Investimento, "valorTotal" | "valorPosUso" | "vidaUtil">) => (i.vidaUtil > 0 ? (i.valorTotal - i.valorPosUso) / i.vidaUtil : 0);

/** A depreciação do investimento nos doze meses: do mês de início, pela vida útil. */
export function depreciacaoNosMeses(i: Investimento): number[] {
  const m = depreciacaoMensal(i);
  return Array.from({ length: 12 }, (_, k) => (k + 1 >= i.inicio && k + 1 < i.inicio + i.vidaUtil ? m : 0));
}

/**
 * As contas da DRE que a depreciação base, os investimentos e o extra-operacional dão ("u|conta" → os doze meses).
 * `gravadas`: as premissas do cenário (só as de venda BASE e EXTRA contam aqui).
 */
export function calcularInvestimentosEExtra(gravadas: Array<{ unidade: number; venda: string; chave: string; mes: number; valor: unknown }>, investimentos: Investimento[]) {
  const r = new Map<string, number[]>();
  const somar = (k: string, mes: number, v: number) => {
    if (!v) return;
    const lista = r.get(k) ?? Array<number>(12).fill(0);
    lista[mes - 1] += v;
    r.set(k, lista);
  };
  for (const p of gravadas) {
    if ((p.venda !== VENDA_BASE && p.venda !== VENDA_EXTRA) || p.mes < 1 || p.mes > 12) continue;
    // A chave é "unidade|conta".
    somar(p.chave, p.mes, Number(p.valor));
  }
  for (const i of investimentos) depreciacaoNosMeses(i).forEach((v, k) => somar(`${i.unidade}|${i.conta}`, k + 1, v));
  return r;
}
