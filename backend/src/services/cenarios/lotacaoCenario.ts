import type { GrupoDoCenario } from "./centrosCenario.js";

/**
 * O quadro de lotação dos cenários analíticos (14/10/2026): os colaboradores de cada grupo de centros de custo, mês a
 * mês (o Quadro de Lotação da tabela Premissas na aba Centros de Custo das Premissas), gravados nas premissas com as vendas
 * LOTACAO_CLT e LOTACAO_PJ (19/10/2026) e a chave o nome do grupo. Os indicadores de quadro de lotação do cenário saem deles, pela classificação do grupo:
 *
 * - Direta ou Indireta: a atribuição mais comum dos centros do grupo;
 * - Matriz ou Filial: nos custos de produção (CPP), o balde MATRIZ ou FILIAL; nos demais (Unidade e os de rateio), a
 *   filial em que os centros do grupo mais lançaram;
 * - Montagem: os grupos dos custos de montagem (CSM);
 * - as despesas (DA, DC, DL, DT) e os grupos sem atribuição entram só no Quadro de Lotação Total.
 *
 * MO Direta Total e MO Indireta Total = Matriz + Filial; MO Geral = Direta + Indireta; Quadro de Lotação Total = todos
 * os grupos. Com eles, as eficiências (volume e receita por colaborador) se calculam como no realizado.
 *
 * Na referência realizada (19/10/2026), os colaboradores de cada grupo vêm das listas do Quadro de Lotação dos meses
 * (listas/lotacaoDosCentros.ts); antes, os quadros realizados (os indicadores) se dividiam entre os grupos pela mão de obra.
 */

/**
 * O quadro de lotação em Colaboradores CLT e Colaboradores PJ (19/10/2026; antes, só Colaboradores, a venda LOTACAO, que
 * a migração passou para CLT): o Total de Colaboradores é a soma, de onde saem os quadros.
 */
export const VENDA_LOTACAO_CLT = "LOTACAO_CLT";
export const VENDA_LOTACAO_PJ = "LOTACAO_PJ";
/**
 * Os Colaboradores Aprendizes e Estagiários (11/11/2026, pedido do Adão): só nos grupos com linhas na aba Quadro de
 * Lotação do cenário (calculados pela senioridade; os CLT e os PJ ficam sem eles). O Total de Colaboradores soma os quatro.
 */
export const VENDA_LOTACAO_APRENDIZ = "LOTACAO_APRENDIZ";
export const VENDA_LOTACAO_ESTAGIARIO = "LOTACAO_ESTAGIARIO";
export const VENDAS_LOTACAO = [VENDA_LOTACAO_APRENDIZ, VENDA_LOTACAO_ESTAGIARIO, VENDA_LOTACAO_CLT, VENDA_LOTACAO_PJ];

type Local = "Matriz" | "Filial" | "Montagem";
type Atribuicao = "Direta" | "Indireta";
const nomeQuadro = (a: Atribuicao | "Geral", l: Local | "Total") => `Quadro de Lotação: MO ${a} ${l}`;
export const QUADRO_TOTAL = "Quadro de Lotação Total";

/** Os indicadores de quadro de lotação que o analítico calcula pelos centros. */
export const QUADROS_DE_LOTACAO = new Set([
  ...(["Direta", "Indireta", "Geral"] as const).flatMap((a) => (["Matriz", "Filial", "Total", "Montagem"] as const).map((l) => nomeQuadro(a, l))),
  QUADRO_TOTAL,
]);

/** Onde o grupo entra no quadro de lotação: o local e a atribuição (sem um deles, só no Quadro de Lotação Total). */
export function quadroDoGrupo(g: Pick<GrupoDoCenario, "grupoDRE" | "balde" | "unidade" | "atribuicao">): { local: Local | null; atribuicao: Atribuicao | null; descricao: string } {
  const atribuicao: Atribuicao | null = g.atribuicao === "DIRETA" ? "Direta" : g.atribuicao === "INDIRETA" ? "Indireta" : null;
  const local: Local | null = g.grupoDRE === "CSM" ? "Montagem" : g.grupoDRE === "CPP" ? (g.balde === "MATRIZ" ? "Matriz" : g.balde === "FILIAL" ? "Filial" : g.unidade === 2 ? "Filial" : "Matriz") : null;
  if (!local || !atribuicao) return { local: null, atribuicao: null, descricao: `${QUADRO_TOTAL} (${!local ? "despesas" : "sem atribuição"})` };
  const curto = (x: string) => x.replace("Quadro de Lotação: ", "");
  return {
    local,
    atribuicao,
    descricao: `${[nomeQuadro(atribuicao, local), nomeQuadro("Geral", local), ...(local === "Montagem" ? [] : [nomeQuadro(atribuicao, "Total"), nomeQuadro("Geral", "Total")])].map(curto).join(", ")} e ${QUADRO_TOTAL}`,
  };
}

/**
 * Os quadros de lotação do cenário, mês a mês, pelos colaboradores dos grupos (`lotacao`: grupo → os doze meses). Um
 * mês sem colaboradores num quadro fica nulo (sem quadro, as eficiências dele não se calculam).
 */
export function quadrosDeLotacao(grupos: Array<Pick<GrupoDoCenario, "grupo" | "grupoDRE" | "balde" | "unidade" | "atribuicao">>, lotacao: Map<string, number[]>) {
  const somas = new Map<string, number[]>();
  const somar = (nome: string, k: number, v: number) => {
    const lista = somas.get(nome) ?? Array<number>(12).fill(0);
    lista[k] += v;
    somas.set(nome, lista);
  };
  for (const g of grupos) {
    const valores = lotacao.get(g.grupo);
    if (!valores) continue;
    const q = quadroDoGrupo(g);
    valores.forEach((v, k) => {
      if (!v) return;
      somar(QUADRO_TOTAL, k, v);
      if (!q.local || !q.atribuicao) return;
      somar(nomeQuadro(q.atribuicao, q.local), k, v);
      somar(nomeQuadro("Geral", q.local), k, v);
      if (q.local !== "Montagem") {
        somar(nomeQuadro(q.atribuicao, "Total"), k, v);
        somar(nomeQuadro("Geral", "Total"), k, v);
      }
    });
  }
  return new Map([...QUADROS_DE_LOTACAO].map((nome) => [nome, (somas.get(nome) ?? Array<number>(12).fill(0)).map((v) => (v ? v : null))]));
}
