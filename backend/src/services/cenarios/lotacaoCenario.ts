import { IND, IndicadoresPeloId, nomeDo } from "../relatorios/indicadoresDoSistema.js";
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
 * Lotação do cenário (calculados pelo Tipo das linhas; os CLT e os PJ ficam sem eles). O Total de Colaboradores soma os quatro.
 */
export const VENDA_LOTACAO_APRENDIZ = "LOTACAO_APRENDIZ";
export const VENDA_LOTACAO_ESTAGIARIO = "LOTACAO_ESTAGIARIO";
export const VENDAS_LOTACAO = [VENDA_LOTACAO_APRENDIZ, VENDA_LOTACAO_ESTAGIARIO, VENDA_LOTACAO_CLT, VENDA_LOTACAO_PJ];

type Local = "Matriz" | "Filial" | "Montagem";
type Atribuicao = "Direta" | "Indireta";
/** Os quadros por atribuição e local, pelo ID (19/11/2026; antes, o nome montado pela atribuição e pelo local). */
const IDS_DOS_QUADROS: Record<Atribuicao | "Geral", Record<Local | "Total", string>> = {
  Direta: { Matriz: IND.QL_DIRETA_MATRIZ, Filial: IND.QL_DIRETA_FILIAL, Total: IND.QL_DIRETA_TOTAL, Montagem: IND.QL_DIRETA_MONTAGEM },
  Indireta: { Matriz: IND.QL_INDIRETA_MATRIZ, Filial: IND.QL_INDIRETA_FILIAL, Total: IND.QL_INDIRETA_TOTAL, Montagem: IND.QL_INDIRETA_MONTAGEM },
  Geral: { Matriz: IND.QL_GERAL_MATRIZ, Filial: IND.QL_GERAL_FILIAL, Total: IND.QL_GERAL_TOTAL, Montagem: IND.QL_GERAL_MONTAGEM },
};
/** O nome atual do quadro da atribuição no local. */
const nomeQuadro = (a: Atribuicao | "Geral", l: Local | "Total") => nomeDo(IDS_DOS_QUADROS[a][l]);
/** O nome atual do Quadro de Lotação Total. */
export const quadroTotal = () => nomeDo(IND.QUADRO_TOTAL);

/** Os indicadores de quadro de lotação que o analítico calcula pelos centros (os nomes atuais). */
export const QUADROS_DE_LOTACAO = new IndicadoresPeloId(() => [
  ...(["Direta", "Indireta", "Geral"] as const).flatMap((a) => (["Matriz", "Filial", "Total", "Montagem"] as const).map((l) => IDS_DOS_QUADROS[a][l])),
  IND.QUADRO_TOTAL,
]);

/** Onde o grupo entra no quadro de lotação: o local e a atribuição (sem um deles, só no Quadro de Lotação Total). */
export function quadroDoGrupo(g: Pick<GrupoDoCenario, "grupoDRE" | "balde" | "unidade" | "atribuicao">): { local: Local | null; atribuicao: Atribuicao | null; descricao: string } {
  const atribuicao: Atribuicao | null = g.atribuicao === "DIRETA" ? "Direta" : g.atribuicao === "INDIRETA" ? "Indireta" : null;
  const local: Local | null = g.grupoDRE === "CSM" ? "Montagem" : g.grupoDRE === "CPP" ? (g.balde === "MATRIZ" ? "Matriz" : g.balde === "FILIAL" ? "Filial" : g.unidade === 2 ? "Filial" : "Matriz") : null;
  if (!local || !atribuicao) return { local: null, atribuicao: null, descricao: `${quadroTotal()} (${!local ? "despesas" : "sem atribuição"})` };
  const curto = (x: string) => x.replace("Quadro de Lotação: ", "");
  return {
    local,
    atribuicao,
    descricao: `${[nomeQuadro(atribuicao, local), nomeQuadro("Geral", local), ...(local === "Montagem" ? [] : [nomeQuadro(atribuicao, "Total"), nomeQuadro("Geral", "Total")])].map(curto).join(", ")} e ${quadroTotal()}`,
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
      somar(quadroTotal(), k, v);
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
