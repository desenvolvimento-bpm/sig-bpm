import { getPrismaClient } from "../../config/prisma.js";
import type { MarcacaoCenario } from "../../generated/prisma/enums.js";
import { INDICADORES_DAS_LISTAS, montarCatalogo, formulaEfetiva } from "../relatorios/catalogoIndicadores.js";
import { compilarFormula } from "../relatorios/formulaIndicador.js";
import { acumular, type DadosDoMes, type Indicador, type Parte } from "../relatorios/indicadores.js";
import { acumularMeta } from "../relatorios/metasOrcamento.js";
import { gruposDoCadastro } from "./centrosCenario.js";
import { QUADROS_DE_LOTACAO, quadrosDeLotacao, VENDAS_LOTACAO } from "./lotacaoCenario.js";

/**
 * Os indicadores de um cenário sintético (11/10/2026), com as fórmulas do cadastro Estrutura dos Indicadores — as
 * mesmas de Resultados Empresariais —, sobre a DRE do cenário e os lançamentos manuais dele. Cada indicador fica numa
 * classe:
 *
 * - RESULTADO: a fórmula só usa linhas da DRE (custos, volumes, receitas, margens…): sai da DRE do cenário;
 * - MANUAL: os que não saem da DRE — os quadros de lotação e os numerados do Comercial e do Administrativo (os das
 *   abas Comercial e Administrativo das Listas): vêm da aba das metas e se digitam na tela;
 * - CALCULADO: a fórmula junta a DRE e os lançamentos manuais (as eficiências: volume ou receita por colaborador), ou
 *   usa outros indicadores (23/10/2026: o item [INDICADOR], com o valor deles no cenário — nos importados, o das metas);
 * - IMPORTADO: os que o cenário não tem como calcular (a liberação de projetos, que vem das Listas, e os GME 4 e 8,
 *   que usam a demanda condicionada à venda e o orçado acumulado): ficam com o valor da aba das metas.
 *
 * O acumulado é o de Resultados Empresariais (acumular); nos importados, o das metas (acumularMeta).
 *
 * No cenário analítico (14/10/2026), os quadros de lotação são CALCULADOS: saem do Quadro de Lotação dos grupos de
 * centros de custo (lotacaoCenario.ts), e não são lançamentos manuais.
 */

export type ClasseIndicador = "RESULTADO" | "MANUAL" | "CALCULADO" | "IMPORTADO";

const MANUAIS = new Set(INDICADORES_DAS_LISTAS);

type Linha = { nome: string; formula: string | null; peso: string | null; modo: string };

export function classificar(r: Linha, analitico = false): ClasseIndicador {
  if (analitico && QUADROS_DE_LOTACAO.has(r.nome)) return "CALCULADO";
  if (MANUAIS.has(r.nome)) return "MANUAL";
  // Sem itens na Metodologia (06/11/2026), a mesma do [IND|nome] do próprio nome.
  const formula = formulaEfetiva(r);
  // Do sistema, só a eficiência da operação total se calcula (a DRE e os quadros); os GME, não.
  if (r.modo === "SISTEMA" || !formula) return r.nome.startsWith("Eficiência") ? "CALCULADO" : "IMPORTADO";
  // O peso da média e a Fórmula do Acumulado (o modo FORMULA, 23/10/2026) também contam.
  const itens = [...compilarFormula(formula).itens.values(), ...((r.modo === "MEDIA_PONDERADA" || r.modo === "FORMULA") && r.peso ? compilarFormula(r.peso).itens.values() : [])];
  const tipos = new Set(itens.map((i) => i.tipo));
  if (tipos.has("LISTA") || tipos.has("META")) return "IMPORTADO";
  // O Quadro de Lotação e os Movimentos do QL (06/11/2026) contam como os indicadores; nos cenários, sem valor por ora.
  if (tipos.has("IND") || tipos.has("INDICADOR") || tipos.has("QL") || tipos.has("MQL") || tipos.has("REGISTRADO")) return "CALCULADO";
  return "RESULTADO";
}

export type IndicadorDoCenario = {
  indicador: Indicador;
  classe: ClasseIndicador;
  /** As partes de cada mês (JAN a DEZ), para o valor e o acumulado. */
  partes: Array<Parte | null>;
  /** Os meses digitados (só nos manuais). */
  digitados: boolean[];
};

export type CalculoDoCenario = {
  ano: number;
  /** Os meses com a DRE do cenário. */
  mesesComDRE: boolean[];
  indicadores: IndicadorDoCenario[];
  /** As metas importadas de cada mês (null sem nenhuma), para o acumulado dos importados. */
  importadas: Array<Map<string, number> | null>;
  /** O acumulado de janeiro até `ate` (1 a 12). */
  acumulado: (i: IndicadorDoCenario, ate: number) => number | null;
};

/** Calcula os indicadores do cenário, mês a mês. */
export async function calcularCenario(cenarioId: string): Promise<CalculoDoCenario> {
  const prisma = getPrismaClient();
  const [cenario, dre, metas, estrutura] = await Promise.all([
    prisma.cenario.findUniqueOrThrow({ where: { id: cenarioId }, select: { ano: true, tipo: true } }),
    prisma.cenarioResultado.findMany({ where: { cenarioId }, select: { visao: true, mes: true, valor: true, linhaDRE: { select: { codigo: true } } } }),
    prisma.cenarioIndicador.findMany({ where: { cenarioId }, select: { nome: true, mes: true, valor: true, origem: true } }),
    // Todos (os inativos também), para o item [INDICADOR]; só os ativos vão no resultado.
    prisma.indicadorEstrutura.findMany({ orderBy: { ordem: "asc" } }),
  ]);
  const porLinha = new Map(dre.map((r) => [`${r.mes}|${r.visao}|${r.linhaDRE.codigo}`, Number(r.valor)]));
  // No analítico, os quadros de lotação dos grupos de centros de custo.
  const analitico = cenario.tipo === "ANALITICO";
  let quadros: Map<string, Array<number | null>> | null = null;
  if (analitico) {
    const [grupos, lotacao] = await Promise.all([gruposDoCadastro(), prisma.cenarioPremissa.findMany({ where: { cenarioId, venda: { in: VENDAS_LOTACAO } } })]);
    const porGrupo = new Map<string, number[]>();
    for (const p of lotacao) {
      if (p.mes < 1 || p.mes > 12) continue;
      const lista = porGrupo.get(p.chave) ?? Array<number>(12).fill(0);
      // O Total de Colaboradores: CLT + PJ (19/10/2026; 11/11/2026: também os Aprendizes e os Estagiários).
      lista[p.mes - 1] += Number(p.valor);
      porGrupo.set(p.chave, lista);
    }
    quadros = quadrosDeLotacao(grupos, porGrupo);
  }
  const mesesComDRE = Array.from({ length: 12 }, (_, k) => dre.some((r) => r.mes === k + 1));
  const porMeta = new Map(metas.map((m) => [`${m.mes}|${m.nome}`, { valor: Number(m.valor), digitado: m.origem === "DIGITADO" }]));
  const importadas = Array.from({ length: 12 }, (_, k) => {
    const doMes = metas.filter((m) => m.mes === k + 1);
    return doMes.length ? new Map(doMes.map((m) => [m.nome, Number(m.valor)])) : null;
  });

  const classes = new Map(estrutura.map((r) => [r.nome, classificar(r, analitico)]));
  const dados: DadosDoMes[] = Array.from({ length: 12 }, (_, k) => {
    const mes = k + 1;
    const temDRE = mesesComDRE[k];
    return {
      dre: (u, c) => (temDRE ? (porLinha.get(`${mes}|${u}|${c}`) ?? 0) : NaN),
      volume: () => NaN,
      lista: () => NaN,
      importado: (n) => (quadros?.has(n) ? quadros.get(n)![k] : (porMeta.get(`${mes}|${n}`)?.valor ?? null)),
      meta: () => null,
      // O item [INDICADOR]: num importado, o valor das metas; nos outros, a conta dele no cenário.
      indicador: (n) => (classes.get(n) === "IMPORTADO" ? (importadas[k]?.get(n) ?? null) : undefined),
    };
  });
  // Os meses anteriores de cada um, para o Acumulado no Ano dos itens (23/10/2026).
  dados.forEach((d, k) => (d.anteriores = dados.slice(0, k)));

  const catalogo = montarCatalogo(estrutura);
  const indicadores = estrutura.flatMap((r, n): IndicadorDoCenario[] => {
    if (!r.ativo) return [];
    const indicador = catalogo[n];
    const classe = classes.get(r.nome)!;
    const partes =
      classe === "IMPORTADO"
        ? importadas.map((m) => (m ? { valor: m.get(r.nome) ?? null } : null))
        : dados.map((d) => indicador.calculo(d));
    return [{ indicador, classe, partes, digitados: Array.from({ length: 12 }, (_, k) => classe === "MANUAL" && !!porMeta.get(`${k + 1}|${r.nome}`)?.digitado) }];
  });

  return {
    ano: cenario.ano,
    mesesComDRE,
    indicadores,
    importadas,
    acumulado: (i, ate) => {
      if (i.classe === "IMPORTADO") {
        const meses = importadas.slice(0, ate);
        return meses.every((m) => m !== null) ? acumularMeta(i.indicador, meses) : null;
      }
      return acumular(i.indicador, i.partes.slice(0, ate));
    },
  };
}

/** As metas orçadas de cada mês (todos os indicadores com valor), como Resultados Empresariais lê o orçado. */
export function metasPorMes(c: CalculoDoCenario): Array<Map<string, number> | null> {
  return Array.from({ length: 12 }, (_, k) => {
    const m = new Map<string, number>();
    for (const i of c.indicadores) {
      const v = i.partes[k]?.valor;
      if (v !== null && v !== undefined) m.set(i.indicador.nome, v);
    }
    return m.size ? m : null;
  });
}

/**
 * O cenário com a marcação (o Orçamento Empresarial dá o orçado de Resultados Empresariais). Cada marcação fica em um cenário
 * só; desde 22/10/2026, de qualquer exercício (antes, só o do mesmo exercício da tela): num de outro exercício, valem os
 * mesmos meses dele.
 */
export async function cenarioMarcado(marcacao: MarcacaoCenario) {
  return getPrismaClient().cenario.findFirst({ where: { marcacao }, select: { id: true, nome: true, ano: true, marcacao: true } });
}

/**
 * O cenário comparado (22/10/2026): o da marcação no exercício (o Compara Com de Resultados Empresariais) ou um cenário
 * escolhido (as Configurações dos Relatórios Executivos).
 */
export type Comparacao = MarcacaoCenario | { cenarioId: string };
export async function cenarioDaComparacao(c: Comparacao) {
  if (typeof c === "string") return cenarioMarcado(c);
  return getPrismaClient().cenario.findUnique({ where: { id: c.cenarioId }, select: { id: true, nome: true, ano: true, marcacao: true } });
}
/**
 * O nome do comparado nos rótulos (as colunas das tabelas e o "vs." dos cards): "Orçado" no Orçamento Empresarial; nas
 * outras marcações, o nome dela; no cenário escolhido (22/10/2026: os Relatórios Executivos), o da marcação dele ("Orçado" no
 * Orçamento Empresarial) ou, sem marcação, o nome do cenário.
 */
export function rotuloDaComparacao(c: Comparacao, cenario?: { nome: string; marcacao: MarcacaoCenario | null } | null) {
  const marcacao = typeof c === "string" ? c : (cenario?.marcacao ?? null);
  if (typeof c !== "string" && !marcacao) return cenario?.nome ?? "Orçado";
  return !marcacao || marcacao === "ORCAMENTO_EMPRESARIAL" ? "Orçado" : ROTULO_DA_MARCACAO[marcacao];
}

/** O nome de cada marcação (21/10/2026: o Compara Com de Resultados Empresariais e os rótulos do comparado). */
export const ROTULO_DA_MARCACAO: Record<MarcacaoCenario, string> = {
  // Os nomes curtos (22/10/2026; antes, Orçamento Empresarial, Resultados Anteriores, Resultados Vendidos e Previsão de Resultados).
  ORCAMENTO_EMPRESARIAL: "Orçamento",
  RESULTADOS_ANTERIORES: "Anterior",
  RESULTADOS_VENDIDOS: "Vendido",
  PREVISAO: "Forecast",
};

/** Os cenários marcados do exercício (21/10/2026): as opções do Compara Com de Resultados Empresariais. */
export async function cenariosMarcados() {
  // De qualquer exercício (22/10/2026), com o ano dele.
  const cs = await getPrismaClient().cenario.findMany({ where: { marcacao: { not: null } }, select: { id: true, nome: true, ano: true, marcacao: true } });
  // Na ordem do padrão da Comparação (23/10/2026): Forecast, Orçamento, Anterior e Vendido.
  const ordem: MarcacaoCenario[] = ["PREVISAO", "ORCAMENTO_EMPRESARIAL", "RESULTADOS_ANTERIORES", "RESULTADOS_VENDIDOS"];
  return cs
    .map((c) => ({ marcacao: c.marcacao!, rotulo: ROTULO_DA_MARCACAO[c.marcacao!], cenario: { id: c.id, nome: c.nome, ano: c.ano } }))
    .sort((a, b) => ordem.indexOf(a.marcacao) - ordem.indexOf(b.marcacao));
}
