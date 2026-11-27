/**
 * As regras das linhas da DRE nas exportações (22/10/2026), as mesmas das telas (frontend: NiveisDRE.tsx).
 *
 * Os dois totais da ROL da estrutura: o primeiro (no topo) sai quando o segundo (depois da receita bruta e dos impostos)
 * está nas linhas; nas visões com um só (Despesas, Extra-Operacional, RN e Leben), ele fica.
 */
const PRIMEIRO_TOTAL_DA_ROL = "RO.RECEITA_OPERACIONAL_LIQUIDA_ROL";
const TOTAL_DA_ROL = "ROL.RECEITA_OPERACIONAL_LIQUIDA_ROL";

export const semPrimeiroTotalDaRol = <L extends { codigo: string }>(linhas: L[]) =>
  linhas.some((l) => l.codigo === TOTAL_DA_ROL) ? linhas.filter((l) => l.codigo !== PRIMEIRO_TOTAL_DA_ROL) : linhas;

/** As linhas de resultado (a ROL, CPV, MB, MC, DFO, EBITDA, EBIT, NOPAT, RF, DF e RL): o fundo mais forte. */
const LINHAS_DE_RESULTADO = new Set([
  PRIMEIRO_TOTAL_DA_ROL,
  TOTAL_DA_ROL,
  "CPV.CUSTO_DE_PRODUTO_VENDIDO_CPV",
  "MB.MARGEM_BRUTA_MB",
  "MC.MARGEM_DE_CONTRIBUICAO_MC",
  "DFO.DESPESA_FIXA_OPERACIONAL_DFO",
  "EBITDA.LUCRO_OPERACIONAL_EBITDA",
  "EBIT.MARGEM_LIQUIDA_EBIT",
  "NOPAT.LUCRO_OPERACIONAL_LIQUIDO_NOPAT",
  "NOPAT.RECEITAS_FINANCEIRAS_RF",
  "NOPAT.DESPESAS_FINANCEIRAS_DF",
  "RL.RESULTADO_LIQUIDO_RL",
]);

/** O fundo da linha: as contas sem fundo, os totais em amarelo claro e as linhas de resultado num amarelo mais forte. */
export type FundoDaDRE = "item" | "total" | "resultado";
export const fundoDaDRE = (l: { codigo: string; tipo: string }): FundoDaDRE =>
  l.tipo === "ITEM" ? "item" : LINHAS_DE_RESULTADO.has(l.codigo) ? "resultado" : "total";
