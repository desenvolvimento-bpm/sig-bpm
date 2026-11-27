/**
 * As bases da participação (%) e do valor unitário (R$/m³) de cada linha, como
 * nas abas Resultados (…) do SIG BPM 2026 - BASE REALIZADO (RESULTADOS) —
 * conferido nas fórmulas das seis abas (08/10/2026):
 *
 * - %: a receita bruta, os impostos e as receitas líquidas por natureza sobre
 *   a ROB; os custos de produção (CPP) sobre a Receita Líquida do
 *   Pré-Fabricado (também na Filial: corrigido na planilha em 08/10/2026,
 *   antes era sobre a ROL); os de montagem (CSM) sobre a
 *   Receita Líquida de Montagem; os complementares (CSC) sobre a Receita
 *   Líquida Complementar; Frete e Descarga sobre a Receita Líquida de Frete (em
 *   Serviços, o frete dos complementares, sobre a Receita Líquida Complementar,
 *   24/10/2026); o resto sobre a ROL. As linhas de volume (PS) não têm %.
 * - R$/m³: a receita do pré-fabricado e os custos de produção sobre a
 *   produção (m³); a receita de montagem e os custos de montagem sobre a
 *   montagem (m³); o Frete e Descarga sobre a expedição (m³) (21/10/2026). As demais linhas não têm.
 *
 * Em Despesas, no Extra-Operacional, no RN e na Leben, a base é a ROL do Consolidado (a primeira linha
 * dessas abas); nos centros de custo, as do Consolidado.
 */

export const COD = {
  RO: "RO.RECEITA_OPERACIONAL_LIQUIDA_ROL",
  ROB: "ROB.RECEITA_OPERACIONAL_BRUTA_ROB",
  ROL: "ROL.RECEITA_OPERACIONAL_LIQUIDA_ROL",
  RBPF: "ROB.RBPF.RECEITA_BRUTA_DO_PRE_FABRICADO",
  RBM: "ROB.RBM.RECEITA_BRUTA_DE_MONTAGEM",
  RLPF: "ROL.RLPF.RECEITA_LIQUIDA_DO_PRE_FABRICADO",
  RLF: "ROL.RLF.RECEITA_LIQUIDA_DE_FRETE",
  RLM: "ROL.RLM.RECEITA_LIQUIDA_DE_MONTAGEM",
  RLC: "ROL.RLC.RECEITA_LIQUIDA_COMPLEMENTAR",
  RLDI: "ROL.RLDI.RECEITA_LIQUIDA_DE_DEVOLUCOES_E_INVENTAR",
  FRETE: "DVV.GGV.FRETE_E_DESCARGA",
  PRODUCAO: "P.PRODUCAO_DO_PRE_FABRICADO_M",
  MONTAGEM: "S.MONTAGEM_DO_PRE_FABRICADO_M",
  EXPEDICAO: "S.EXPEDICAO_DO_PRE_FABRICADO_M",
} as const;

/** 0 Consolidado, 1 Matriz, 2 Filial, 3 Serviços, 4 Despesas, 5 RN, 6 Extra-Operacional (27/11/2026), 7 Leben (27/11/2026), ou os centros de custo. */
export type VisaoResultados = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | "centros" | "obras";
type Linha = { codigo: string; grupoSigla: string };

/** Os grupos das linhas de volume (m³, kg, pistas, dias): sem % nem R$/m³. */
export const GRUPOS_DE_VOLUME = new Set(["PS", "P", "S"]);

/** A linha cujo valor é a base do % da linha; null quando a linha não tem %. */
export function baseDoPercentual(visao: VisaoResultados, l: Linha): string | null {
  if (GRUPOS_DE_VOLUME.has(l.grupoSigla)) return null;
  // Nas obras (11/10/2026), sobre a receita da própria obra: a ROB nas receitas e nos impostos, a ROL (ROB − IRB) no resto.
  if (visao === "obras") return l.grupoSigla === "ROB" || l.grupoSigla === "IRB" ? COD.ROB : COD.ROL;
  if (l.codigo === COD.RO || l.codigo === COD.ROL) return l.codigo;
  if (l.grupoSigla === "ROB" || l.grupoSigla === "IRB" || l.grupoSigla === "ROL") return COD.ROB;
  if (l.grupoSigla === "CPP") return COD.RLPF;
  if (l.grupoSigla === "CSM") return COD.RLM;
  if (l.grupoSigla === "CSC") return COD.RLC;
  // Em Serviços, o frete é o dos complementares (24/10/2026): sobre a Receita Líquida Complementar.
  if (l.codigo === COD.FRETE) return visao === 3 ? COD.RLC : COD.RLF;
  return COD.RO;
}

/** A linha de volume que é a base do R$/m³ da linha; null quando a linha não tem. */
export function baseDoUnitario(l: Linha): string | null {
  if (l.codigo === COD.RBPF || l.codigo === COD.RLPF || l.grupoSigla === "CPP") return COD.PRODUCAO;
  if (l.codigo === COD.RBM || l.codigo === COD.RLM || l.grupoSigla === "CSM") return COD.MONTAGEM;
  // O Frete e Descarga sobre o volume expedido (21/10/2026).
  if (l.codigo === COD.FRETE) return COD.EXPEDICAO;
  return null;
}

/** Em Despesas, no Extra-Operacional, no RN, na Leben e nos centros de custo, as bases vêm do Consolidado. */
export const basesDoConsolidado = (visao: VisaoResultados) => visao === 4 || visao === 5 || visao === 6 || visao === 7 || visao === "centros";
