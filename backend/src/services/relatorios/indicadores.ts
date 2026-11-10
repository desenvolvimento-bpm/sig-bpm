import { COD } from "./basesResultados.js";
import { L } from "./estruturaInicialIndicadores.js";

/**
 * Os indicadores de resultado. Desde 11/10/2026, o catálogo (grupo, numeração, nome, comportamento, unidade, fórmula e
 * modo do acumulado) é o cadastro Estrutura dos Indicadores (catalogoIndicadores.ts); aqui ficam os tipos, o
 * acumulado e os cálculos que a fórmula não expressa (modo SISTEMA).
 *
 * O cálculo de cada mês sai da DRE apurada (por unidade), dos volumes congelados da apuração, dos totais das listas e
 * dos indicadores importados das abas Indicadores (Admin.) e Indicadores (Comercial). Conferido contra a aba Realizado
 * (SIG) em 08/10/2026; a troca para o cadastro, conferida em 11/10/2026 (os 114 indicadores, mês a mês e no
 * acumulado, iguais ao cálculo anterior).
 *
 * Acumulado, como a aba Realizado: a fórmula sobre a soma dos itens (nas razões, a soma dos numeradores sobre a dos
 * denominadores), a média ponderada por um peso (SUMPRODUCT) ou o valor do último mês (ATUAL).
 */

/**
 * Os valores de um mês: a DRE apurada de uma visão (0 Consolidado, 1..5 as
 * unidades), os volumes congelados e os indicadores importados. No mês sem
 * apuração, a DRE e os volumes valem NaN, e o indicador que depende deles fica
 * sem valor; sem o indicador importado, null.
 */
export type DadosDoMes = {
  dre: (unidade: number, codigo: string) => number;
  volume: (origem: string) => number;
  importado: (nome: string) => number | null;
  /** O orçado do mês (o cenário Orçamento Empresarial do exercício): a capacidade de produção e o orçado dos atingimentos (GME 4 e GME 8). */
  meta?: (nome: string) => number | null;
  /** Os meses anteriores do exercício, em ordem (os atingimentos acumulados do GME 8). */
  anteriores?: DadosDoMes[];
  /** Um totalizador das Listas (o item [LISTA] das fórmulas): o volume congelado da apuração ou, sem ele, o das listas. */
  lista?: (codigo: string) => number;
  /**
   * O valor do mês de outro indicador do cadastro (o item [INDICADOR], 23/10/2026), quando quem monta os dados o dá (nos
   * cenários, os importados vêm das metas); undefined: vale a conta do indicador.
   */
  indicador?: (nome: string) => number | null | undefined;
  /** O Quadro de Lotação do fim do mês (o item [QL], 06/11/2026): "TOTAL" ou "departamento|GERAL…"; null sem a competência. */
  quadro?: (chave: string) => number | null;
  /** As movimentações aprovadas do mês de um tipo (o item [MQL], 06/11/2026); null sem a competência. */
  movimentosQL?: (tipo: string) => number | null;
};
/** O valor do mês e o peso dele no acumulado; `componentes`, quando o acumulado pondera partes (Matriz e Filial) em vez do total. */
export type Parte = {
  valor: number | null;
  peso?: number;
  componentes?: Array<{ valor: number | null; peso: number }>;
  /** Os itens da fórmula no mês (indicadores do cadastro com o acumulado pela soma dos itens). */
  operandos?: Record<string, number>;
  /** O acumulado de janeiro até o mês, pela Fórmula do Acumulado (o modo FORMULA do cadastro, 23/10/2026). */
  acumulado?: number | null;
};
type Calculo = (m: DadosDoMes) => Parte;

export type Indicador = {
  grupo: string;
  /** O número do indicador no grupo, como na planilha; vazio nos indicadores principais do grupo. */
  numero: string;
  nome: string;
  /** ↑ quanto maior melhor, ↓ quanto menor melhor, = acompanhamento, - sem sentido. */
  sentido: string;
  unidade: string;
  metodologia: string;
  acumulado: "ACUM" | "ATUAL";
  calculo: Calculo;
  /** A fórmula sobre a soma de cada item nos meses com valor (o acumulado SOMA do cadastro Estrutura dos Indicadores). */
  reavaliar?: (somas: Record<string, number>) => number | null;
  /** O acumulado é o da Fórmula do Acumulado no último mês com valor (o modo FORMULA, 23/10/2026). */
  porFormula?: true;
};

/** a ÷ b; sem divisor (zero ou sem dado), sem valor. */
const divide = (a: number, b: number) => (Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? a / b : null);
const finito = (x: number) => (Number.isFinite(x) ? x : null);
const lotacao = (m: DadosDoMes, quadro: string) => m.importado(`Quadro de Lotação: ${quadro}`) ?? NaN;

/** Volume (ou receita) por colaborador do quadro; o acumulado pondera pelo volume (ou pela receita), como a planilha. */
const porColaborador =
  (numerador: (m: DadosDoMes) => number, quadro: (m: DadosDoMes) => number, escala = 1): Calculo =>
  (m) => {
    const n = numerador(m);
    const q = divide(n, quadro(m));
    return { valor: q === null ? null : q / escala, peso: n };
  };
const receitaProducao = (u: number) => (m: DadosDoMes) => m.dre(u, COD.RLPF);

/** Eficiência da operação da Matriz e da Filial juntas: o acumulado pondera os acumulados de cada uma pela receita (célula Q100 da aba Realizado). */
const operacaoTotal =
  (quadro: string): Calculo =>
  (m) => {
    const matriz = porColaborador(receitaProducao(1), (x) => lotacao(x, `${quadro} Matriz`), 1000)(m);
    const filial = porColaborador(receitaProducao(2), (x) => lotacao(x, `${quadro} Filial`), 1000)(m);
    const total = porColaborador((x) => x.dre(1, COD.RLPF) + x.dre(2, COD.RLPF), (x) => lotacao(x, `${quadro} Total`), 1000)(m);
    return { valor: total.valor, componentes: [matriz, filial].map((p) => ({ valor: p.valor, peso: p.peso ?? 0 })) };
  };

/**
 * GME 4 (aba Realizado do INDICADORES DE RESULTADO, linhas 112 e 113): o volume do mês sobre a capacidade de produção,
 * que é a meta de Produção (Vol.): Total do mês (Metas!M7). A demanda gerada só tem valor no mês com a Venda: Total, e
 * o acumulado pondera pela venda; a expedida pondera pela expedição.
 */
const sobreCapacidade = (volume: (m: DadosDoMes) => number | null, peso: (m: DadosDoMes) => number | null): Calculo => (m) => {
  const p = peso(m);
  if (p === null || !Number.isFinite(p)) return { valor: null };
  return { valor: divide(volume(m) ?? NaN, m.meta?.("Produção (Vol.): Total") ?? NaN), peso: p };
};

/**
 * GME 8 (linhas 114 e 115): o realizado de janeiro até o mês sobre o orçado do mesmo período (as metas importadas,
 * pelo nome do indicador); o acumulado é o do último mês.
 */
const atingimentoAcumulado = (nome: string, realizado: (m: DadosDoMes) => number | null): Calculo => (m) => {
  if (realizado(m) === null) return { valor: null };
  const meses = [...(m.anteriores ?? []), m];
  const soma = meses.reduce((s, x) => s + (realizado(x) ?? 0), 0);
  const orcado = meses.reduce((s, x) => s + (x.meta?.(nome) ?? 0), 0);
  return { valor: divide(soma, orcado) };
};

/**
 * Os indicadores com a conta no código (modo SISTEMA). Desde 23/10/2026, a Metodologia os expressa (o Acumulado no Ano dos
 * itens e a Fórmula do Acumulado), e o cadastro passou a usá-la; o modo fica para voltar atrás.
 */
export const CALCULOS_SISTEMA: Record<string, { calculo: Calculo; acumulado: "ACUM" | "ATUAL" }> = {
  "Eficiência da Operação: MO Direta Total": { calculo: operacaoTotal("MO Direta"), acumulado: "ACUM" },
  "Eficiência da Operação: MO Indireta Total": { calculo: operacaoTotal("MO Indireta"), acumulado: "ACUM" },
  "Eficiência da Operação: MO Geral Total": { calculo: operacaoTotal("MO Geral"), acumulado: "ACUM" },
  "Média Móvel da Demanda Gerada": {
    calculo: sobreCapacidade((m) => m.importado("Demanda (Vol.): Total (Fabricação)"), (m) => m.importado("Venda: Total")),
    acumulado: "ACUM",
  },
  "Média Móvel da Demanda Expedida": {
    calculo: sobreCapacidade((m) => finito(m.dre(0, L.EXPEDICAO)), (m) => finito(m.dre(0, L.EXPEDICAO))),
    acumulado: "ACUM",
  },
  "Atingimento do FCOL Acumulado": {
    calculo: atingimentoAcumulado("Fluxo de Caixa Operacional Líquido", (m) => m.importado("Fluxo de Caixa Operacional Líquido")),
    acumulado: "ATUAL",
  },
  "Atingimento da MC Acumulada": {
    calculo: atingimentoAcumulado("Margem de Contribuição (MC): Total", (m) => finito(m.dre(0, L.MC))),
    acumulado: "ATUAL",
  },
};

/** O acumulado dos meses (as partes de cada mês, em ordem; null no mês sem dado). */
export function acumular(i: Pick<Indicador, "acumulado" | "reavaliar" | "porFormula">, partes: Array<Parte | null>): number | null {
  const comDado = partes.filter((p): p is Parte => p !== null && (p.valor !== null || !!p.componentes));
  if (comDado.length === 0) return null;
  if (i.porFormula) return comDado[comDado.length - 1].acumulado ?? null;
  if (i.acumulado === "ATUAL") return comDado[comDado.length - 1].valor;
  if (i.reavaliar && comDado.every((p) => p.operandos)) {
    const somas: Record<string, number> = {};
    for (const p of comDado) for (const [k, v] of Object.entries(p.operandos!)) somas[k] = (somas[k] ?? 0) + v;
    return i.reavaliar(somas);
  }
  const itens = comDado.flatMap((p): Array<{ valor: number | null; peso?: number }> => p.componentes ?? [p]).filter((p) => p.valor !== null);
  if (itens.every((p) => p.peso === undefined)) return itens.reduce((s, p) => s + p.valor!, 0);
  const pesados = itens.filter((p) => p.peso !== undefined && Number.isFinite(p.peso));
  const soma = pesados.reduce((s, p) => s + p.peso!, 0);
  return soma === 0 ? null : pesados.reduce((s, p) => s + p.valor! * p.peso!, 0) / soma;
}
