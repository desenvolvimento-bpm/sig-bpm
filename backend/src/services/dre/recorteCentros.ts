import { descricaoDeOrigem, slugDaDRE } from "./descricaoDeOrigem.js";

/**
 * O que a DRE de um centro de custo mostra (tela, lista dos centros e
 * exportação): só os totais CPP, CSM, CSC, DL, DT, DC e DA, e neles só as
 * atribuições de mão de obra, gastos gerais e depreciação com valor (e as
 * contas delas); cada total soma só as atribuições que aparecem. O frontend
 * repete a regra em linhasDoCentro (DREContent.tsx).
 */
export const TOTAIS_DO_CENTRO = new Set(["CPP", "CSM", "CSC", "DL", "DT", "DC", "DA"]);
/** As atribuições dos centros pela descrição de origem dos subtotais (25/11/2026: a última parte do código, que não muda com a Descrição). */
export const ATRIBUICOES_DO_CENTRO = new Set(
  ["MÃO DE OBRA DIRETA", "MÃO DE OBRA INDIRETA", "GASTOS GERAIS VARIÁVEIS", "GASTOS GERAIS DIRETOS", "GASTOS GERAIS INDIRETOS", "GASTOS GERAIS COMERCIAIS", "DEPRECIAÇÃO"].map(slugDaDRE),
);

const partes = (c: string) => c.split(".");
/** "CPP.MOD.REMUNERACOES_CLT" → "CPP.MOD": a atribuição de uma conta. */
export const prefixoDaAtribuicao = (codigo: string) => partes(codigo).slice(0, 2).join(".");

type Linha = { codigo: string; tipo: string; descricao: string };

/** As atribuições que podem aparecer nos centros (pelo prefixo do código), a partir da estrutura da DRE. */
export function atribuicoesDoCentro(linhas: Linha[]) {
  return new Set(
    linhas
      .filter(
        (l) =>
          l.tipo !== "ITEM" &&
          partes(l.codigo).length === 3 &&
          TOTAIS_DO_CENTRO.has(partes(l.codigo)[0]) &&
          ATRIBUICOES_DO_CENTRO.has(descricaoDeOrigem(l.codigo)),
      )
      .map((l) => prefixoDaAtribuicao(l.codigo)),
  );
}

/** A DRE de um centro como a tela mostra, com os totais somando só as atribuições mostradas. */
export function linhasDoCentro<L extends Linha & { valor: string | null }>(linhas: L[]): L[] {
  const permitidas = atribuicoesDoCentro(linhas);
  const mostradas = linhas.filter(
    (l) => l.tipo !== "ITEM" && partes(l.codigo).length === 3 && permitidas.has(prefixoDaAtribuicao(l.codigo)) && Number(l.valor ?? 0) !== 0,
  );
  const atribuicoes = new Set(mostradas.map((l) => prefixoDaAtribuicao(l.codigo)));
  // Em centavos, para não acumular erro.
  const soma = new Map<string, number>();
  for (const a of mostradas) {
    const g = partes(a.codigo)[0];
    soma.set(g, (soma.get(g) ?? 0) + Math.round(Number(a.valor) * 100));
  }
  return linhas
    .filter((l) => {
      if (l.tipo === "SECAO") return false;
      const p = partes(l.codigo);
      return p.length === 2 ? l.tipo !== "ITEM" && soma.has(p[0]) : atribuicoes.has(prefixoDaAtribuicao(l.codigo));
    })
    .map((l) => (partes(l.codigo).length === 2 ? { ...l, valor: (soma.get(partes(l.codigo)[0])! / 100).toFixed(2) } : l));
}
