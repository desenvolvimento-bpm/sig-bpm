import { getPrismaClient } from "../../config/prisma.js";
import { DEFINICOES_INDICADORES } from "../importacoes/indicadores/leituraIndicadores.js";
import { LINHAS_TOTAIS } from "../volumes/totaisOperacao.js";
import { compilarFormula, DEPARTAMENTOS_DO_QUADRO, formulaPorExtenso, type Item } from "./formulaIndicador.js";
import { acumular, CALCULOS_SISTEMA, type DadosDoMes, type Indicador, type Parte } from "./indicadores.js";
import { acumularMeta } from "./metasOrcamento.js";

/**
 * O catálogo dos indicadores, lido do cadastro Estrutura dos Indicadores (11/10/2026): cada indicador com a fórmula
 * compilada (ou, nos de cálculo do sistema, a conta do código) e o modo do acumulado.
 */

/** Os totais das Listas que somam uma lista inteira (o "Total" de Projetos, Pré-Fabricado, Metalurgia…). */
export const TOTAIS_SINTETICOS: Record<string, { rotulo: string; medida: string; codigos: string[] }> = {
  PROJETOS_TOTAL: { rotulo: "Projetos Liberados: Total", medida: "m³", codigos: ["PROJETOS_MATRIZ", "PROJETOS_FILIAL"] },
  PREFABRICADO_TOTAL: { rotulo: "Pré-Fabricado: Total", medida: "m³", codigos: ["PREFABRICADO_MATRIZ", "PREFABRICADO_FILIAL"] },
  METALURGIA_TOTAL: { rotulo: "Metalurgia: Total", medida: "kg", codigos: ["METALURGIA_MATRIZ", "METALURGIA_FILIAL", "METALURGIA_MONTAGEM", "METALURGIA_COMPLEMENTAR"] },
  ARMADURA_TOTAL: { rotulo: "Armadura: Total", medida: "kg", codigos: ["ARMADURA_MATRIZ", "ARMADURA_FILIAL", "ARMADURA_MONTAGEM", "ARMADURA_COMPLEMENTAR"] },
  EXPEDICAO_TOTAL: { rotulo: "Expedição: Total", medida: "m³", codigos: ["EXPEDICAO_MATRIZ", "EXPEDICAO_FILIAL"] },
  ACOMPANHAMENTO_TOTAL: { rotulo: "Acompanhamento: Total", medida: "d", codigos: ["ACOMPANHAMENTO_MONTAGEM", "ACOMPANHAMENTO_COMPLEMENTAR"] },
};

/** Os totalizadores das Listas que a fórmula pode usar: os da faixa de cada lista e os totais de cada lista. */
export const TOTALIZADORES_DAS_LISTAS: Array<{ codigo: string; rotulo: string }> = [
  ...LINHAS_TOTAIS.map((t) => ({ codigo: t.codigo as string, rotulo: `${t.rotulo.replace(/^\([PS]\) /, "")} (${t.medida})` })),
  ...Object.entries(TOTAIS_SINTETICOS).map(([codigo, t]) => ({ codigo, rotulo: `${t.rotulo} (${t.medida})` })),
];

/** Os indicadores do Comercial e do Administrativo (importados ou digitados nas Listas). */
export const INDICADORES_DAS_LISTAS = [...DEFINICOES_INDICADORES.INDICADORES_COMERCIAL.nomes, ...DEFINICOES_INDICADORES.INDICADORES_ADMIN.nomes];

/**
 * A Metodologia que vale: sem itens (e fora do cálculo do sistema), o item Valor Registrado ([REGISTRADO], 09/11/2026) — o
 * valor registrado no mês com o nome do indicador (importado, digitado nas Listas ou apurado no Quadro de Lotação), o mesmo
 * do antigo [IND|nome] do próprio nome.
 */
export function formulaEfetiva(r: { nome: string; formula: string | null; modo: string }): string | null {
  if (r.formula?.trim()) return r.formula;
  return r.modo === "SISTEMA" ? null : "[REGISTRADO]";
}

export const ROTULO_DO_REGISTRADO = "Valor registrado no mês (importado, digitado ou apurado)";
const ROTULO_DA_PARTE: Record<string, string> = { GERAL: "Geral", DIRETA: "Direto", INDIRETA: "Indireto" };
const ROTULO_DO_DEPARTAMENTO = new Map(DEPARTAMENTOS_DO_QUADRO);
/**
 * O item [QL|…] por extenso: "Produção: Matriz (Direto)", "Total" (o Total Geral) ou "Centro 1.01.00000001"; `centros`, o
 * nome dos centros pelo código, quando há.
 */
export const rotuloDoQuadro = (chave: string, centros?: Map<string, string>) => {
  const [nivel, a, b] = chave.split("|");
  if (nivel === "CC") return `Centro ${centros?.get(a) ?? a}`;
  const departamento = ROTULO_DO_DEPARTAMENTO.get(a) ?? a;
  return a === "TOTAL" && b === "GERAL" ? departamento : `${departamento} (${ROTULO_DA_PARTE[b] ?? b})`;
};
/** Os Movimentos do QL por extenso: o tipo, ou todas as de uma contagem. */
export const rotuloDoMovimento = (nome: string) =>
  nome === "#POSITIVA" ? "Todas as de Contagem Positiva" : nome === "#NEGATIVA" ? "Todas as de Contagem Negativa" : nome;

const NOME_DA_VISAO: Record<number, string> = { 0: "Consolidado", 1: "Matriz", 2: "Filial", 3: "Serviços", 4: "Despesas e Extra", 5: "RN" };

/** O nome de cada item, para a fórmula por extenso. */
export async function rotulosDosItens() {
  const linhas = new Map((await getPrismaClient().linhaDRE.findMany({ select: { codigo: true, descricao: true } })).map((l) => [l.codigo, l.descricao]));
  const listas = new Map(TOTALIZADORES_DAS_LISTAS.map((t) => [t.codigo, t.rotulo]));
  // Os centros do item Quadro de Lotação (09/11/2026), pelo código RM.
  const centros = new Map(
    (await getPrismaClient().centroCusto.findMany({ where: { codigoRM: { not: null } }, select: { codigoRM: true, nomeRM: true } })).map((c) => [c.codigoRM!, `${c.codigoRM} · ${c.nomeRM}`]),
  );
  return (i: Item) =>
    i.tipo === "DRE"
      ? `${linhas.get(i.codigo) ?? i.codigo} (${NOME_DA_VISAO[i.unidade] ?? i.unidade})`
      : i.tipo === "LISTA"
        ? `${listas.get(i.codigo) ?? i.codigo} [Listas]`
        : i.tipo === "QL"
          ? `Quadro de Lotação: ${rotuloDoQuadro(i.chave, centros)}`
          : i.tipo === "MQL"
            ? `Movimentos do QL: ${rotuloDoMovimento(i.nome)}`
            : i.tipo === "REGISTRADO"
              ? ROTULO_DO_REGISTRADO
              : i.tipo === "META"
          ? `Meta: ${i.nome}${i.acumulado ? " (Acumulado no Ano)" : ""}`
          : i.tipo === "INDICADOR" && i.acumulado
            ? `${i.nome} (Acumulado no Ano)`
            : i.nome;
}

/** As partes de outros indicadores já contadas em cada mês, e os que estão sendo contados (um ciclo fica sem valor). */
const contados = new WeakMap<DadosDoMes, Map<string, Parte | null>>();
const contando = new WeakMap<DadosDoMes, Set<string>>();

/** A parte do mês de outro indicador (o item [INDICADOR], 23/10/2026): o valor que os dados do mês dão ou a conta dele. */
function parteDoIndicador(m: DadosDoMes, nome: string, irmaos?: Map<string, Indicador>): Parte | null {
  const dado = m.indicador?.(nome);
  if (dado !== undefined) return { valor: dado };
  const memo = contados.get(m) ?? new Map<string, Parte | null>();
  contados.set(m, memo);
  if (memo.has(nome)) return memo.get(nome)!;
  const outro = irmaos?.get(nome);
  const emCurso = contando.get(m) ?? new Set<string>();
  contando.set(m, emCurso);
  if (!outro || emCurso.has(nome)) return null;
  emCurso.add(nome);
  try {
    const p = outro.calculo(m);
    memo.set(nome, p);
    return p;
  } finally {
    emCurso.delete(nome);
  }
}

/** Os meses do exercício de janeiro até este (o Acumulado no Ano). */
const ateOMes = (m: DadosDoMes) => [...(m.anteriores ?? []), m];

/**
 * O item [INDICADOR|nome|ACUM]: o acumulado do indicador de janeiro até o mês, pelo modo dele (o da coluna Acumulado);
 * sem o valor do mês, sem valor (o IF(E74="","",…) da aba Realizado).
 */
function acumuladoDoIndicador(m: DadosDoMes, nome: string, irmaos?: Map<string, Indicador>): number {
  const outro = irmaos?.get(nome);
  const doMes = parteDoIndicador(m, nome, irmaos)?.valor;
  if (!outro || doMes === null || doMes === undefined || !Number.isFinite(doMes)) return NaN;
  return acumular(outro, ateOMes(m).map((x) => parteDoIndicador(x, nome, irmaos))) ?? NaN;
}

/** O item [META|nome|ACUM]: o orçado acumulado do indicador de janeiro até o mês, como o de Resultados Empresariais. */
function acumuladoDaMeta(m: DadosDoMes, nome: string, irmaos?: Map<string, Indicador>): number {
  if (!m.meta) return NaN;
  const meses = ateOMes(m).map((x) => (x.meta ? { get: (n: string) => x.meta!(n) ?? undefined } : null));
  return acumularMeta(irmaos?.get(nome) ?? { nome, acumulado: "ACUM" }, meses) ?? NaN;
}

/** O valor de um item no mês (NaN sem dado). */
function valorDoItem(m: DadosDoMes, i: Item, irmaos: Map<string, Indicador> | undefined, proprio: string): number {
  switch (i.tipo) {
    case "DRE":
      return m.dre(i.unidade, i.codigo);
    case "LISTA":
      return m.lista ? m.lista(i.codigo) : m.volume(i.codigo);
    case "IND":
      return m.importado(i.nome) ?? NaN;
    case "META":
      return i.acumulado ? acumuladoDaMeta(m, i.nome, irmaos) : (m.meta?.(i.nome) ?? NaN);
    case "INDICADOR":
      return i.acumulado ? acumuladoDoIndicador(m, i.nome, irmaos) : (parteDoIndicador(m, i.nome, irmaos)?.valor ?? NaN);
    // O Quadro de Lotação e os Movimentos do QL (06/11/2026): sem a competência do Quadro de Lotação no mês, sem valor.
    case "QL":
      return m.quadro?.(i.chave) ?? NaN;
    case "MQL":
      return m.movimentosQL?.(i.nome) ?? NaN;
    // O valor registrado no mês com o nome do próprio indicador (09/11/2026).
    case "REGISTRADO":
      return m.importado(proprio) ?? NaN;
  }
}

export type LinhaEstruturaIndicador = {
  grupo: string;
  numero: string;
  nome: string;
  sentido: string;
  unidade: string;
  descricao: string | null;
  formula: string | null;
  modo: string;
  peso: string | null;
};

/** Um indicador do cadastro pronto para calcular; `irmaos`: os indicadores pelo nome, para o item [INDICADOR]. */
export function montarIndicador(r: LinhaEstruturaIndicador, irmaos?: Map<string, Indicador>): Indicador {
  const base = { grupo: r.grupo, numero: r.numero, nome: r.nome, sentido: r.sentido, unidade: r.unidade, metodologia: r.descricao ?? "" };
  const formula = formulaEfetiva(r);
  if (r.modo === "SISTEMA" || !formula) {
    const s = CALCULOS_SISTEMA[r.nome];
    return { ...base, acumulado: s?.acumulado ?? "ACUM", calculo: s?.calculo ?? (() => ({ valor: null })) };
  }
  const f = compilarFormula(formula);
  const peso = r.modo === "MEDIA_PONDERADA" && r.peso ? compilarFormula(r.peso) : null;
  // A Fórmula do Acumulado (o modo FORMULA, 23/10/2026; gravada na coluna peso): o acumulado de janeiro até o mês.
  const doAcumulado = r.modo === "FORMULA" && r.peso ? compilarFormula(r.peso) : null;
  const itens = [...f.itens];
  const avaliarNoMes = (g: ReturnType<typeof compilarFormula>, m: DadosDoMes) =>
    g.avaliar((k) => {
      const it = g.itens.get(k);
      return it ? valorDoItem(m, it, irmaos, r.nome) : NaN;
    });
  return {
    ...base,
    acumulado: r.modo === "ULTIMO" ? "ATUAL" : "ACUM",
    ...(r.modo === "FORMULA" ? { porFormula: true as const } : {}),
    calculo: (m) => {
      const valores = new Map(itens.map(([chave, item]) => [chave, valorDoItem(m, item, irmaos, r.nome)]));
      const valor = f.avaliar((k) => valores.get(k) ?? NaN);
      if (peso) {
        const p = avaliarNoMes(peso, m);
        return { valor, peso: p ?? undefined };
      }
      if (r.modo === "FORMULA") return { valor, acumulado: doAcumulado ? avaliarNoMes(doAcumulado, m) : null };
      return r.modo === "SOMA" ? { valor, operandos: Object.fromEntries(valores) } : { valor };
    },
    // Soma dos meses: a fórmula sobre a soma de cada item nos meses com valor.
    reavaliar: r.modo === "SOMA" ? (somas) => f.avaliar((k) => somas[k] ?? NaN) : undefined,
  };
}

/** Os indicadores das linhas, ligados uns aos outros pelo nome (o item [INDICADOR] da Metodologia, 23/10/2026). */
export function montarCatalogo(linhas: LinhaEstruturaIndicador[]): Indicador[] {
  const irmaos = new Map<string, Indicador>();
  const todos = linhas.map((r) => montarIndicador(r, irmaos));
  for (const i of todos) irmaos.set(i.nome, i);
  return todos;
}

/** Os indicadores ativos do cadastro, na ordem da tela (um inativo usado na Metodologia de outro ainda se conta). */
export async function catalogoDeIndicadores(): Promise<Indicador[]> {
  const linhas = await getPrismaClient().indicadorEstrutura.findMany({ orderBy: { ordem: "asc" } });
  const todos = montarCatalogo(linhas);
  return todos.filter((_, k) => linhas[k].ativo);
}

/** A fórmula por extenso de cada indicador do cadastro (a coluna Metodologia da tela). */
export async function formulasPorExtenso(formulas: Array<string | null>) {
  const rotulo = await rotulosDosItens();
  return formulas.map((f) => {
    if (!f) return null;
    try {
      return formulaPorExtenso(f, rotulo);
    } catch {
      return f;
    }
  });
}
