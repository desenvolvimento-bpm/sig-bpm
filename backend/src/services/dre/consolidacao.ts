import { Prisma } from "../../generated/prisma/client.js";
import type { Composicao, LinhaEstrutura, ResultadoLinha } from "./apuracaoUnidades.js";
import { avaliarExpressao } from "./expressao.js";
import { plural } from "../../utils/plural.js";
import { nomeDaUnidade } from "../cadastros/nomesDasUnidades.js";

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;
const zero = () => new Decimal(0);

/**
 * Consolidação da DRE e visão por centro de custo (Passo 19).
 *
 * Consolidado — a aba Resultados (Consolidado) do SIG BPM 2026 - BASE
 * REALIZADO (RESULTADOS), cópia da Realizado (Consolidado) do UNIDADES E
 * CENTROS DE CUSTO: cada item é a soma do mesmo item nas unidades
 * ('Resultados (Matriz)'!B22+'Resultados (Filial)'!B23…); subtotais e totais
 * saem das expressões da estrutura, avaliadas com os itens consolidados. Os
 * Impostos Operacionais, por isso, são ROB − ROL (B12-B20), e não a soma dos
 * impostos das unidades.
 *
 * Centro de custo — a aba Realizado (Centro de Custo) do UNIDADES E CENTROS DE
 * CUSTO: os lançamentos da Gastos (Contábil) de cada centro, diretos e de
 * rateio, em todas as filiais, pela linha da DRE em que foram classificados,
 * antes de qualquer rateio. A tela agrupa os centros pelo nome da
 * controladoria (a coluna C. CUSTO (AGRUPADO)).
 */

export type ResultadoConsolidado = { linhaId: string; codigo: string; valor: Decimal; composicao: Composicao | null };
export type ResultadoCentro = { centroCustoId: string; linhaId: string; codigo: string; valor: Decimal; composicao: Composicao | null };

export type LancamentoDoCentro = { centroCustoId: string | null; linhaDREId: string | null; valor: Decimal };


/** Avalia os subtotais e totais da estrutura a partir dos valores dados (itens e, se houver, totais já com valor). */
export function avaliarEstrutura(linhas: LinhaEstrutura[], valores: Map<string, Decimal>, incluir: (l: LinhaEstrutura) => boolean) {
  const porCodigo = new Map(linhas.map((l) => [l.codigo, l]));
  const calculados = new Map<string, Decimal>();
  const avaliar = (codigo: string, pilha = new Set<string>()): Decimal => {
    const direto = valores.get(codigo);
    if (direto !== undefined) return direto;
    const jaTem = calculados.get(codigo);
    if (jaTem !== undefined) return jaTem;
    const l = porCodigo.get(codigo);
    if (!l || l.tipo === "ITEM" || !l.expressao || !incluir(l)) return zero();
    if (pilha.has(codigo)) throw new Error(`Referência circular na estrutura da DRE: ${codigo}`);
    pilha.add(codigo);
    const v = avaliarExpressao(l.expressao, (c) => avaliar(c, pilha));
    calculados.set(codigo, v);
    return v;
  };
  for (const l of linhas) if (l.tipo !== "ITEM" && l.tipo !== "SECAO" && l.expressao && incluir(l)) avaliar(l.codigo);
  return calculados;
}

/** Consolidado: itens somados entre as unidades; subtotais e totais pela estrutura. */
export function consolidar(linhas: LinhaEstrutura[], porUnidade: ResultadoLinha[]): ResultadoConsolidado[] {
  const tipo = new Map(linhas.map((l) => [l.codigo, l.tipo]));
  const itens = new Map<string, Decimal>();
  const parcelas = new Map<string, Array<{ unidade: number; valor: Decimal }>>();
  for (const r of porUnidade) {
    if (tipo.get(r.codigo) !== "ITEM") continue;
    itens.set(r.codigo, (itens.get(r.codigo) ?? zero()).plus(r.valor));
    if (!parcelas.has(r.codigo)) parcelas.set(r.codigo, []);
    parcelas.get(r.codigo)!.push({ unidade: r.unidade, valor: r.valor });
  }
  const totais = avaliarEstrutura(linhas, itens, () => true);
  const resultados: ResultadoConsolidado[] = [];
  for (const l of linhas) {
    if (l.tipo === "SECAO") continue;
    if (l.tipo === "ITEM") {
      const ps = (parcelas.get(l.codigo) ?? []).sort((a, b) => a.unidade - b.unidade);
      if (ps.length === 0) continue;
      resultados.push({
        linhaId: l.id,
        codigo: l.codigo,
        valor: itens.get(l.codigo)!,
        composicao: {
          regra: "Soma do item nas unidades",
          unidades: ps.map((p) => ({ unidade: p.unidade, nome: nomeDaUnidade(p.unidade) ?? String(p.unidade), valor: p.valor.toFixed(2) })),
        },
      });
    } else if (totais.has(l.codigo)) {
      resultados.push({ linhaId: l.id, codigo: l.codigo, valor: totais.get(l.codigo)!, composicao: null });
    }
  }
  return resultados;
}

/**
 * Linhas agregadoras: as que só somam (sem subtração). São as que fazem
 * sentido no recorte de um centro — departamento, atribuição, CPV, DFO. As
 * margens e resultados (ROL − CPV, MC − DFO…) não entram.
 */
export const soSoma = (l: LinhaEstrutura) => !!l.expressao && !l.expressao.includes("-");

/** Visão por centro de custo: os lançamentos de cada centro pela linha da DRE, e os agregadores que só somam. */
export function apurarCentros(linhas: LinhaEstrutura[], lancamentos: LancamentoDoCentro[]): ResultadoCentro[] {
  const porId = new Map(linhas.map((l) => [l.id, l]));
  const porCentro = new Map<string, Map<string, { valor: Decimal; n: number }>>();
  for (const lc of lancamentos) {
    if (!lc.centroCustoId || !lc.linhaDREId) continue;
    const l = porId.get(lc.linhaDREId);
    if (!l) continue;
    if (!porCentro.has(lc.centroCustoId)) porCentro.set(lc.centroCustoId, new Map());
    const m = porCentro.get(lc.centroCustoId)!;
    const a = m.get(l.codigo) ?? { valor: zero(), n: 0 };
    m.set(l.codigo, { valor: a.valor.plus(lc.valor), n: a.n + 1 });
  }
  const resultados: ResultadoCentro[] = [];
  for (const [centroCustoId, m] of porCentro) {
    const diretos = new Map([...m].map(([c, a]) => [c, a.valor]));
    const agregados = avaliarEstrutura(linhas, diretos, soSoma);
    for (const l of linhas) {
      const d = m.get(l.codigo);
      if (d) {
        resultados.push({
          centroCustoId,
          linhaId: l.id,
          codigo: l.codigo,
          valor: d.valor,
          composicao: { regra: "Lançamentos contábeis do centro, diretos e de rateio, antes do rateio", direto: d.valor.toFixed(2), observacao: `${d.n} ${plural(d.n, "lançamento", "lançamentos")}` },
        });
        continue;
      }
      const v = agregados.get(l.codigo);
      if (v && !v.isZero()) resultados.push({ centroCustoId, linhaId: l.id, codigo: l.codigo, valor: v, composicao: null });
    }
  }
  return resultados;
}
