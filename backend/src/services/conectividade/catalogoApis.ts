import { z } from "zod";

import { getPrismaClient } from "../../config/prisma.js";
import { CODIGO_ADMINISTRADOR, type UsuarioAutenticado } from "../acesso/acesso.js";
import { ABA_DA_VISAO } from "../acesso/telas.js";
import { CenarioError, cenariosService, MARCACOES } from "../cenarios/cenariosService.js";
import { indicadoresService } from "../relatorios/indicadoresService.js";
import { nomesAntigos } from "../relatorios/indicadoresDoSistema.js";
import { painelService } from "../relatorios/painelService.js";
import { RelatorioError, resultadosService } from "../relatorios/resultadosService.js";
import { cardEmSvg, direcaoDo, tabelaEmSvg, type BlocoDoCard, type ColunaVisual, type Sinal, type Visual } from "./visuais.js";
import { nomeDaVisao } from "../cadastros/nomesDasUnidades.js";

/**
 * O catálogo da Biblioteca de APIs (24/10/2026, pedido do Adão): as APIs que abrem a outros aplicativos os dados das
 * DREs, dos cards e dos indicadores do Painel de Bordo dos Resultados Empresariais e dos Cenários. Cada API tem o código
 * (o que o aplicativo pede), os parâmetros e os dois formatos: os dados (a tabela, valores para usar) e o visual (os cards
 * e as tabelas em SVG, como nas telas). Cada uma lê pelos mesmos serviços das telas e exige a mesma permissão de leitura
 * da tela no perfil do usuário (o login e a senha do token): quem não lê a tela no SIG não lê pela API.
 */

export class ApiError extends Error {
  constructor(
    readonly status: 401 | 403 | 404 | 422 | 429 | 503,
    message: string,
    readonly codigo?: string,
  ) {
    super(message);
  }
}

export type Formato = "dados" | "visual";
export type Coluna = { chave: string; titulo: string; tipo: "texto" | "numero" | "percentual" };
export type Linha = Record<string, string | number | null>;
export type Resposta =
  | { formato: "dados"; colunas: Coluna[]; linhas: Linha[]; meta: Record<string, unknown> }
  | { formato: "visual"; visuais: Visual[]; meta: Record<string, unknown> };
export type Parametro = { nome: string; descricao: string; obrigatorio: boolean; exemplo: string };
export type DefinicaoDaApi = {
  codigo: string;
  nome: string;
  origem: "Resultados Empresariais" | "Cenários";
  descricao: string;
  /** A permissão de leitura que a API exige (o texto do catálogo). */
  exige: string;
  formatos: Formato[];
  parametros: Parametro[];
  /** Se o perfil lê os dados da API (sem os parâmetros: a tela). */
  alcanca: (u: UsuarioAutenticado) => boolean;
  executar: (q: Record<string, unknown>, u: UsuarioAutenticado, formato: Formato) => Promise<Resposta>;
};

const pode = (u: UsuarioAutenticado, p: string) => u.permissions.includes(p);
function exigir(u: UsuarioAutenticado, p: string) {
  if (!pode(u, p)) throw new ApiError(403, "O seu perfil não lê estes dados no SIG.", "SEM_PERMISSAO");
}

// Os números como nas telas (signDisplay "negative": o que arredonda para zero sai sem o sinal).
// (O "negative" é do Node 24; os tipos do TypeScript do backend ainda não o têm.)
const numero = (casas: number) =>
  new Intl.NumberFormat("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas, signDisplay: "negative" as Intl.NumberFormatOptions["signDisplay"] });
const n0 = numero(0);
const n1 = numero(1);
const n2 = numero(2);
const ou = (v: number | null, f: (x: number) => string) => (v === null ? "—" : f(v));
const desvio = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${n1.format(v * 100)}%`);
/** O desvio do realizado sobre o comparado (o do Painel): o sinal invertido no comparado negativo; sem ele (ou zero), null. */
export const variacao = (r: number | null, c: number | null) => (r === null || c === null || c === 0 ? null : (r / c - 1) * (c < 0 ? -1 : 1));
const ROTULO_DO_SINAL: Record<string, string> = { "1": "Melhor", "0": "Até 5%", "-1": "Pior" };
const rotuloDoSinal = (s: Sinal) => (s === null ? null : ROTULO_DO_SINAL[String(s)]);
const mes2 = (m: number) => String(m).padStart(2, "0");

/**
 * O sinal fora do Painel (os indicadores), com a regra do Painel (blocoComparado do frontend): até 5% amarelo; senão,
 * melhor ou pior conforme o sentido (↑ maior é melhor, ↓ menor é melhor); sem sentido (os de acompanhamento), sem sinal. O
 * comparado zero: o sinal pelo lado do realizado.
 */
export function sinalDo(realizado: number | null, comparado: number | null, sentido: string): Sinal {
  const comSentido = sentido === "↑" || sentido === "↓";
  if (!comSentido || realizado === null || comparado === null) return null;
  if (comparado === 0) return realizado === 0 ? 0 : (sentido === "↑" ? realizado > 0 : realizado < 0) ? 1 : -1;
  const v = variacao(realizado, comparado)!;
  if (Math.abs(v) <= 0.05) return 0;
  return (sentido === "↑" ? realizado < comparado : realizado > comparado) ? -1 : 1;
}

/** Os formatos dos cards do Painel (os da tela): a unidade, o valor sem ela (como nos cards) e o fator do gráfico. */
type FormatoPainel = "MILHOES" | "MILHARES" | "M3" | "PISTAS" | "PCT" | "PCT_RL" | "RS_M3";
const UNIDADE_DO_FORMATO: Record<FormatoPainel, string> = { MILHOES: "R$ M", MILHARES: "R$ K", M3: "m³", PISTAS: "pst", PCT: "%", PCT_RL: "%/RL", RS_M3: "R$/m³" };
export function curtoDoPainel(v: number | null, f: FormatoPainel) {
  if (v === null) return "—";
  if (f === "MILHOES") return n1.format(v / 1e6);
  if (f === "MILHARES") return n1.format(v / 1e3);
  if (f === "PCT" || f === "PCT_RL") return n1.format(v * 100);
  return n0.format(v);
}
const fatorDoPainel = (f: FormatoPainel) => (f === "MILHOES" ? 1e-6 : f === "MILHARES" ? 1e-3 : f === "PCT" || f === "PCT_RL" ? 100 : 1);

/** As unidades dos indicadores (as da tela Indicadores): o valor sem a unidade, como nos cards, e o fator do gráfico. */
export function curtoDoIndicador(unidade: string, v: number | null) {
  if (v === null) return "—";
  if (unidade === "%") return n1.format(v * 100);
  if (unidade === "R$ M") return n1.format(v / 1e6);
  if (unidade === "R$ K") return n1.format(v / 1e3);
  if (unidade === "R$" || unidade === "colab." || unidade === "ocorr.") return n0.format(v);
  if (unidade === "pistas") return n1.format(v);
  return n2.format(v);
}
const fatorDoIndicador = (unidade: string) => (unidade === "%" ? 100 : unidade === "R$ M" ? 1e-6 : unidade === "R$ K" ? 1e-3 : 1);

// Os parâmetros: as mensagens dizem o que vale em cada um.
const MENSAGENS: Record<string, string> = {
  ano: "ano: o exercício, de 2025 a 2100",
  mes: "mes: o mês, de 1 a 12",
  visao: "visao: 0 (Consolidado), 1 (Matriz), 2 (Filial), 3 (Serviços), 4 (Despesas e Extra) ou 5 (RN)",
  comparacao: "comparacao: ORCAMENTO_EMPRESARIAL, RESULTADOS_ANTERIORES, RESULTADOS_VENDIDOS ou PREVISAO",
  aba: "aba: resultados ou performance",
  grafico: "grafico: sim ou nao",
  cenario: "cenario: o id do cenário (a API cenarios lista os que você lê)",
  item: "item: a sigla ou o nome do card",
  nivel: "nivel: 1 (Totais), 2 (Atribuições) ou 3 (Contas)",
};
function validar<T extends z.ZodType>(esquema: T, q: Record<string, unknown>): z.infer<T> {
  const r = esquema.safeParse(q);
  if (r.success) return r.data;
  const campo = String(r.error.issues[0]?.path[0] ?? "");
  throw new ApiError(422, `Parâmetro inválido — ${MENSAGENS[campo] ?? campo}.`, "PARAMETRO_INVALIDO");
}
const vazioComoAusente = (v: unknown) => (v === "" ? undefined : v);
const P = {
  ano: z.coerce.number().int().min(2025).max(2100),
  mes: z.preprocess(vazioComoAusente, z.coerce.number().int().min(1).max(12).optional()),
  visao: z.preprocess(vazioComoAusente, z.coerce.number().int().min(0).max(5).default(0)),
  comparacao: z.preprocess(vazioComoAusente, z.enum(["ORCAMENTO_EMPRESARIAL", "RESULTADOS_ANTERIORES", "RESULTADOS_VENDIDOS", "PREVISAO"]).default("ORCAMENTO_EMPRESARIAL")),
  aba: z.preprocess(vazioComoAusente, z.enum(["resultados", "performance"]).optional()),
  grafico: z.preprocess(vazioComoAusente, z.enum(["sim", "nao"]).default("sim")),
  cenario: z.string().uuid(),
  item: z.preprocess(vazioComoAusente, z.string().trim().min(1).max(200).optional()),
  nivel: z.preprocess(vazioComoAusente, z.coerce.number().int().min(1).max(3).default(1)),
};

/**
 * O nível de cada linha da DRE (o de NiveisDRE.estrutura, nas telas): 0 os totais (os grupos com o código em duas partes),
 * 1 as atribuições (abaixo de um total) e as contas logo abaixo de um total, 2 as contas abaixo de uma atribuição.
 */
export function niveisDaDre(linhas: Array<{ codigo: string; tipo: string }>) {
  const partes = (c: string) => c.split(".");
  const totais = new Set(linhas.filter((l) => l.tipo !== "ITEM" && partes(l.codigo).length === 2).map((l) => partes(l.codigo)[0]));
  const nivel = new Map<string, number>();
  for (const l of linhas) {
    if (l.tipo === "ITEM") continue;
    const p = partes(l.codigo);
    nivel.set(l.codigo, p.length > 2 && totais.has(p[0]) ? 1 : 0);
  }
  const atribuicoes = new Set(linhas.filter((l) => l.tipo !== "ITEM" && nivel.get(l.codigo) === 1).map((l) => partes(l.codigo).slice(0, 2).join(".")));
  for (const l of linhas) {
    if (l.tipo !== "ITEM") continue;
    const p = partes(l.codigo);
    nivel.set(l.codigo, p.length > 2 && atribuicoes.has(p.slice(0, 2).join(".")) ? 2 : 1);
  }
  return nivel;
}

/**
 * A DRE só com as linhas do nível escolhido (1 Totais, 2 Atribuições, 3 Contas), com o nível de cada uma, e sem o
 * primeiro total da ROL quando o segundo está nela (como nas telas, semPrimeiroTotalDaRol, desde 21/10/2026).
 */
function noNivel<T extends { codigo: string; tipo: string }>(todas: T[], escolhido: number) {
  const linhas = todas.some((l) => l.codigo === "ROL.RECEITA_OPERACIONAL_LIQUIDA_ROL") ? todas.filter((l) => l.codigo !== "RO.RECEITA_OPERACIONAL_LIQUIDA_ROL") : todas;
  const nivel = niveisDaDre(linhas);
  return linhas.map((l) => ({ ...l, nivel: nivel.get(l.codigo) ?? 0 })).filter((l) => l.nivel < escolhido);
}
const NOME_DO_NIVEL = ["Total", "Atribuição", "Conta"];
const NOME_DO_MODO = ["Totais", "Atribuições", "Contas"];
const PARAMETRO: Record<string, Parametro> = {
  ano: { nome: "ano", descricao: "O exercício.", obrigatorio: true, exemplo: "2026" },
  mes: { nome: "mes", descricao: "O mês (1 a 12); sem ele, o último fechado. Só as competências fechadas, como nas telas.", obrigatorio: false, exemplo: "9" },
  visao: { nome: "visao", descricao: "0 Consolidado, 1 Matriz, 2 Filial, 3 Serviços, 4 Despesas e Extra ou 5 RN; sem ela, 0.", obrigatorio: false, exemplo: "0" },
  comparacao: { nome: "comparacao", descricao: "O cenário comparado, pela marcação: ORCAMENTO_EMPRESARIAL (o padrão), RESULTADOS_ANTERIORES, RESULTADOS_VENDIDOS ou PREVISAO.", obrigatorio: false, exemplo: "ORCAMENTO_EMPRESARIAL" },
  aba: { nome: "aba", descricao: "Só os cards de uma aba do Painel: resultados ou performance; sem ela, as que o seu perfil lê.", obrigatorio: false, exemplo: "resultados" },
  item: { nome: "item", descricao: "Só um card: a sigla, o nome (sem diferenciar maiúsculas) ou o id dele no cadastro, que não muda com o nome.", obrigatorio: false, exemplo: "ROL" },
  nivel: { nome: "nivel", descricao: "As linhas, como os níveis da tela: 1 Totais (o padrão), 2 Atribuições ou 3 Contas (todas).", obrigatorio: false, exemplo: "1" },
  grafico: { nome: "grafico", descricao: "No formato visual, o card com o gráfico dos meses e do acumulado (sim, o padrão) ou sem ele (nao).", obrigatorio: false, exemplo: "sim" },
  cenario: { nome: "cenario", descricao: "O id do cenário (a API cenarios lista os que você lê).", obrigatorio: true, exemplo: "a1b2c3d4-…" },
  formato: { nome: "formato", descricao: "dados (a tabela, o padrão) ou visual (os cards e as tabelas em SVG).", obrigatorio: false, exemplo: "dados" },
};

/** Os erros dos serviços das telas viram os da API (o mesmo status e a mesma mensagem). */
async function daTela<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof RelatorioError || e instanceof CenarioError) {
      const status = [403, 404, 422].includes(e.status) ? (e.status as 403 | 404 | 422) : 422;
      throw new ApiError(status, e.message);
    }
    throw e;
  }
}

type Celula = { valor: number | null; pct: number | null };
type LinhaDaDre = { codigo: string; tipo: string; grupo: string | null; descricao: string; meses: Celula[]; total: Celula; orcado: { mes?: Celula; total: Celula } | null };
type Dre = { ano: number; ate: number; meses: Array<{ mes: number; rotulo: string }>; linhas: Array<LinhaDaDre & { nivel?: number }> };

/** A DRE em tabela: as linhas com os meses, o acumulado, o comparado e as variações. */
function dreEmDados(r: Dre, rotuloComparado: string, meta: Record<string, unknown>): Resposta {
  const iMes = r.meses.findIndex((m) => m.mes === r.ate);
  const colunas: Coluna[] = [
    { chave: "codigo", titulo: "Código", tipo: "texto" },
    { chave: "descricao", titulo: "Linha", tipo: "texto" },
    { chave: "tipo", titulo: "Tipo", tipo: "texto" },
    { chave: "nivel", titulo: "Nível", tipo: "texto" },
    { chave: "grupo", titulo: "Grupo", tipo: "texto" },
    ...r.meses.map((m): Coluna => ({ chave: `mes_${mes2(m.mes)}`, titulo: m.rotulo, tipo: "numero" })),
    { chave: "acumulado", titulo: "Acumulado", tipo: "numero" },
    { chave: "acumulado_pct", titulo: "% Acumulado", tipo: "percentual" },
    { chave: "comparado_mes", titulo: `${rotuloComparado} (mês)`, tipo: "numero" },
    { chave: "comparado_acumulado", titulo: `${rotuloComparado} (acumulado)`, tipo: "numero" },
    { chave: "variacao_mes", titulo: "Variação (mês)", tipo: "percentual" },
    { chave: "variacao_acumulado", titulo: "Variação (acumulado)", tipo: "percentual" },
  ];
  const linhas = r.linhas.map((l): Linha => {
    const doMes = iMes >= 0 ? (l.meses[iMes]?.valor ?? null) : null;
    return {
      codigo: l.codigo,
      descricao: l.descricao,
      tipo: l.tipo,
      nivel: NOME_DO_NIVEL[l.nivel ?? 0] ?? null,
      grupo: l.grupo,
      ...Object.fromEntries(r.meses.map((m, k) => [`mes_${mes2(m.mes)}`, l.meses[k]?.valor ?? null])),
      acumulado: l.total.valor,
      acumulado_pct: l.total.pct,
      comparado_mes: l.orcado?.mes?.valor ?? null,
      comparado_acumulado: l.orcado?.total.valor ?? null,
      variacao_mes: variacao(doMes, l.orcado?.mes?.valor ?? null),
      variacao_acumulado: variacao(l.total.valor, l.orcado?.total.valor ?? null),
    };
  });
  return { formato: "dados", colunas, linhas, meta: { ...meta, linhas: linhas.length } };
}

const ESTILO_DA_LINHA: Record<string, "SECAO" | "ITEM" | "SUBTOTAL" | "TOTAL"> = { SECAO: "SECAO", ITEM: "ITEM", SUBTOTAL: "SUBTOTAL", TOTAL: "TOTAL" };

/** A DRE em SVG, como a tabela da tela: o mês (com o comparado) e o acumulado; nos cenários (o ano todo), só o total. */
function dreEmVisual(r: Dre, titulo: string, subtitulo: string, rotuloComparado: string, comMes: boolean): Visual {
  const iMes = r.meses.findIndex((m) => m.mes === r.ate);
  const rotuloDoMes = r.meses[iMes]?.rotulo ?? "Mês";
  const colunas: ColunaVisual[] = [
    { titulo: "Linha", largura: 340, alinhar: "start" },
    ...(comMes
      ? ([
          { titulo: rotuloDoMes, largura: 128, alinhar: "end" },
          { titulo: `${rotuloComparado} ${rotuloDoMes}`, largura: 150, alinhar: "end" },
          { titulo: "Var.", largura: 72, alinhar: "end" },
        ] as ColunaVisual[])
      : []),
    { titulo: comMes ? "Acumulado" : `Total ${r.ano}`, largura: 136, alinhar: "end" },
    { titulo: "%", largura: 64, alinhar: "end" },
    { titulo: `${rotuloComparado}${comMes ? " Acum." : ""}`, largura: 150, alinhar: "end" },
    { titulo: "Var.", largura: 72, alinhar: "end" },
  ];
  const linhas = r.linhas.map((l) => {
    const doMes = iMes >= 0 ? (l.meses[iMes]?.valor ?? null) : null;
    const secao = l.tipo === "SECAO";
    const v = (x: number | null) => (secao ? "" : ou(x, n2.format));
    const p = (x: number | null) => (secao ? "" : x === null ? "—" : `${n1.format(x * 100)}%`);
    return {
      estilo: ESTILO_DA_LINHA[l.tipo] ?? "ITEM",
      recuo: l.nivel ?? (l.tipo === "ITEM" ? 1 : 0),
      celulas: [
        l.descricao,
        ...(comMes ? [v(doMes), v(l.orcado?.mes?.valor ?? null), secao ? "" : desvio(variacao(doMes, l.orcado?.mes?.valor ?? null))] : []),
        v(l.total.valor),
        p(l.total.pct),
        v(l.orcado?.total.valor ?? null),
        secao ? "" : desvio(variacao(l.total.valor, l.orcado?.total.valor ?? null)),
      ],
    };
  });
  return tabelaEmSvg(titulo, subtitulo, colunas, linhas);
}

type BlocoDoPainel = { realizado: number | null; orcado: number | null; vsOrcado: number | null; sinal: Sinal };
type ItemDoPainel = {
  /** O ID do card no cadastro (25/11/2026). */
  id?: string | null;
  titulo: string;
  sigla: string;
  metodologia: string;
  sentido: string;
  formato: FormatoPainel;
  formatoAcumulado: FormatoPainel;
  mes: BlocoDoPainel;
  acumulado: BlocoDoPainel;
  serie: Array<{ mes: string; realizado: number | null; orcado: number | null }>;
};
type Painel = { rotuloMes: string; abas: Array<{ chave: string; titulo: string; quadros: Array<{ titulo: string; itens: ItemDoPainel[] }> }> };

/** Os cards do Painel: as abas que o perfil lê (`abaDaTela`), o filtro da aba e do item. */
function cardsDoPainel(p: Painel, podeAba: (chave: string) => boolean, aba?: string, item?: string) {
  const abas = p.abas.filter((a) => podeAba(a.chave) && (!aba || a.chave === aba));
  if (!abas.length) throw new ApiError(403, "O seu perfil não lê esta aba do Painel de Bordo.", "SEM_PERMISSAO");
  const alvo = item?.toLowerCase();
  // Pela sigla, pelo nome ou pelo ID do card (25/11/2026: o ID não muda com o nome).
  const cards = abas.flatMap((a) =>
    a.quadros.flatMap((q) => q.itens.filter((i) => !alvo || i.sigla.toLowerCase() === alvo || i.titulo.toLowerCase() === alvo || i.id?.toLowerCase() === alvo).map((i) => ({ aba: a, quadro: q, item: i }))),
  );
  if (item && !cards.length) throw new ApiError(404, `Nenhum card com a sigla ou o nome "${item}".`, "ITEM_INEXISTENTE");
  return cards;
}

function painelEmDados(cards: ReturnType<typeof cardsDoPainel>, rotuloComparado: string, meta: Record<string, unknown>): Resposta {
  const colunas: Coluna[] = [
    { chave: "aba", titulo: "Aba", tipo: "texto" },
    { chave: "quadro", titulo: "Quadro", tipo: "texto" },
    { chave: "titulo", titulo: "Card", tipo: "texto" },
    { chave: "sigla", titulo: "Sigla", tipo: "texto" },
    { chave: "sentido", titulo: "Sentido", tipo: "texto" },
    { chave: "formato", titulo: "Formato", tipo: "texto" },
    { chave: "unidade", titulo: "Unidade", tipo: "texto" },
    { chave: "mes_realizado", titulo: "Mês", tipo: "numero" },
    { chave: "mes_comparado", titulo: `${rotuloComparado} (mês)`, tipo: "numero" },
    { chave: "mes_variacao", titulo: "Variação (mês)", tipo: "percentual" },
    { chave: "mes_sinal", titulo: "Sinal (mês)", tipo: "texto" },
    { chave: "acumulado_realizado", titulo: "Acumulado", tipo: "numero" },
    { chave: "acumulado_comparado", titulo: `${rotuloComparado} (acumulado)`, tipo: "numero" },
    { chave: "acumulado_variacao", titulo: "Variação (acumulado)", tipo: "percentual" },
    { chave: "acumulado_sinal", titulo: "Sinal (acumulado)", tipo: "texto" },
    { chave: "metodologia", titulo: "Metodologia", tipo: "texto" },
  ];
  const linhas = cards.map(({ aba, quadro, item: i }): Linha => ({
    aba: aba.titulo,
    quadro: quadro.titulo,
    titulo: i.titulo,
    sigla: i.sigla,
    sentido: i.sentido,
    formato: i.formato,
    unidade: UNIDADE_DO_FORMATO[i.formato],
    mes_realizado: i.mes.realizado,
    mes_comparado: i.mes.orcado,
    mes_variacao: i.mes.vsOrcado,
    mes_sinal: rotuloDoSinal(i.mes.sinal),
    acumulado_realizado: i.acumulado.realizado,
    acumulado_comparado: i.acumulado.orcado,
    acumulado_variacao: i.acumulado.vsOrcado,
    acumulado_sinal: rotuloDoSinal(i.acumulado.sinal),
    metodologia: i.metodologia,
  }));
  return { formato: "dados", colunas, linhas, meta: { ...meta, linhas: linhas.length } };
}

function painelEmVisual(cards: ReturnType<typeof cardsDoPainel>, periodo: string, rotuloComparado: string, comGrafico: boolean): Visual[] {
  return cards.map(({ item: i }) => {
    const bloco = (b: BlocoDoPainel, f: FormatoPainel): BlocoDoCard => ({ valor: curtoDoPainel(b.realizado, f), comparado: curtoDoPainel(b.orcado, f), desvio: desvio(b.vsOrcado), sinal: b.sinal, direcao: direcaoDo(b.realizado, b.orcado) });
    const fator = fatorDoPainel(i.formato);
    const fatorAcum = fatorDoPainel(i.formatoAcumulado);
    const escala = (v: number | null, f: number) => (v === null ? null : v * f);
    return cardEmSvg({
      titulo: i.titulo,
      subtitulo: `${i.sigla} (${i.sentido})`,
      periodo,
      unidade: UNIDADE_DO_FORMATO[i.formato],
      rotuloComparado,
      mes: bloco(i.mes, i.formato),
      acumulado: bloco(i.acumulado, i.formatoAcumulado),
      ...(comGrafico
        ? {
            serie: i.serie.map((s) => ({ rotulo: s.mes, realizado: escala(s.realizado, fator), comparado: escala(s.orcado, fator) })),
            acumuladoNoGrafico: { realizado: escala(i.acumulado.realizado, fatorAcum), comparado: escala(i.acumulado.orcado, fatorAcum) },
          }
        : {}),
    });
  });
}

type Indicador = { id?: string | null; grupo: string; numero: string; nome: string; sentido: string; unidade: string; metodologia: string; acumulado: string; meses: Array<number | null>; total: number | null; orcado: Array<number | null>; totalOrcado: number | null };
type Indicadores = { ano: number; ate: number; meses: Array<{ mes: number; rotulo: string }>; indicadores: Indicador[] };

function indicadoresEmDados(r: Indicadores, rotuloComparado: string, item: string | undefined, meta: Record<string, unknown>): Resposta {
  const lista = filtrarIndicadores(r, item);
  const colunas: Coluna[] = [
    { chave: "grupo", titulo: "Grupo", tipo: "texto" },
    { chave: "numero", titulo: "Número", tipo: "texto" },
    { chave: "nome", titulo: "Indicador", tipo: "texto" },
    { chave: "sentido", titulo: "Sentido", tipo: "texto" },
    { chave: "unidade", titulo: "Unidade", tipo: "texto" },
    { chave: "acumulado_tipo", titulo: "Acumulado", tipo: "texto" },
    ...r.meses.map((m): Coluna => ({ chave: `mes_${mes2(m.mes)}`, titulo: m.rotulo, tipo: "numero" })),
    { chave: "total", titulo: "Acumulado", tipo: "numero" },
    ...r.meses.map((m): Coluna => ({ chave: `comparado_${mes2(m.mes)}`, titulo: `${rotuloComparado} ${m.rotulo}`, tipo: "numero" })),
    { chave: "comparado_total", titulo: `${rotuloComparado} (acumulado)`, tipo: "numero" },
    { chave: "metodologia", titulo: "Metodologia", tipo: "texto" },
  ];
  const linhas = lista.map((i): Linha => ({
    grupo: i.grupo,
    numero: i.numero,
    nome: i.nome,
    sentido: i.sentido,
    unidade: i.unidade,
    acumulado_tipo: i.acumulado,
    ...Object.fromEntries(r.meses.map((m, k) => [`mes_${mes2(m.mes)}`, i.meses[k] ?? null])),
    total: i.total,
    ...Object.fromEntries(r.meses.map((m, k) => [`comparado_${mes2(m.mes)}`, i.orcado[k] ?? null])),
    comparado_total: i.totalOrcado,
    metodologia: i.metodologia,
  }));
  return { formato: "dados", colunas, linhas, meta: { ...meta, linhas: linhas.length } };
}

function filtrarIndicadores(r: Indicadores, item?: string) {
  if (!item) return r.indicadores;
  // Pelo nome, pelo número e nome ou pelo ID (25/11/2026: o ID não muda com o nome); um nome antigo vale pelo atual.
  const alvo = (nomesAntigos().get(item) ?? item).toLowerCase();
  const lista = r.indicadores.filter((i) => i.nome.toLowerCase() === alvo || `${i.numero} ${i.nome}`.trim().toLowerCase() === alvo || i.id?.toLowerCase() === alvo);
  if (!lista.length) throw new ApiError(404, `Nenhum indicador com o nome "${item}".`, "ITEM_INEXISTENTE");
  return lista;
}

function indicadoresEmVisual(r: Indicadores, periodo: string, rotuloComparado: string, item: string | undefined, comGrafico: boolean): Visual[] {
  const iMes = r.meses.findIndex((m) => m.mes === r.ate);
  return filtrarIndicadores(r, item).map((i) => {
    const doMes = iMes >= 0 ? (i.meses[iMes] ?? null) : null;
    const compMes = iMes >= 0 ? (i.orcado[iMes] ?? null) : null;
    const bloco = (real: number | null, comp: number | null): BlocoDoCard => ({
      valor: curtoDoIndicador(i.unidade, real),
      comparado: curtoDoIndicador(i.unidade, comp),
      desvio: desvio(variacao(real, comp)),
      sinal: sinalDo(real, comp, i.sentido),
      direcao: direcaoDo(real, comp),
    });
    const f = fatorDoIndicador(i.unidade);
    const escala = (v: number | null) => (v === null ? null : v * f);
    return cardEmSvg({
      titulo: i.nome,
      subtitulo: `${i.grupo} (${i.sentido})`,
      periodo,
      unidade: i.unidade,
      rotuloComparado,
      mes: bloco(doMes, compMes),
      acumulado: bloco(i.total, i.totalOrcado),
      ...(comGrafico
        ? {
            serie: r.meses.slice(0, iMes + 1).map((m, k) => ({ rotulo: m.rotulo.slice(0, 3), realizado: escala(i.meses[k] ?? null), comparado: escala(i.orcado[k] ?? null) })),
            acumuladoNoGrafico: { realizado: escala(i.total), comparado: escala(i.totalOrcado) },
          }
        : {}),
    });
  });
}

const admin = (u: UsuarioAutenticado) => u.perfil.codigo === CODIGO_ADMINISTRADOR;
const usuarioDoCenario = (u: UsuarioAutenticado) => ({ id: u.sub, nome: u.nome, admin: admin(u) });
const BASES = ["cenarios", "cenarios_analiticos"] as const;

/** O cenário que o usuário alcança (público, dele ou do Administrador) e a base das permissões do tipo dele. */
async function cenarioDaApi(id: string, u: UsuarioAutenticado) {
  const c = await getPrismaClient().cenario.findUnique({ where: { id }, select: { id: true, nome: true, ano: true, tipo: true, visualizacao: true, criadoPorId: true } });
  if (!c || !(c.visualizacao === "PUBLICA" || admin(u) || c.criadoPorId === u.sub)) throw new ApiError(404, "Cenário não encontrado.", "CENARIO_INEXISTENTE");
  return { ...c, base: c.tipo === "ANALITICO" ? "cenarios_analiticos" : "cenarios" };
}

export const CATALOGO: DefinicaoDaApi[] = [
  {
    codigo: "resultados-dre",
    nome: "DRE dos Resultados Empresariais",
    origem: "Resultados Empresariais",
    descricao: "A tabela de Resultados de uma visão (Consolidado, Matriz, Filial, Serviços, Despesas e Extra ou RN): as linhas da DRE com os meses, o acumulado, o comparado e as variações.",
    exige: "Resultados Empresariais › Resultados (a aba da visão): Ler",
    formatos: ["dados", "visual"],
    parametros: [PARAMETRO.ano, PARAMETRO.mes, PARAMETRO.visao, PARAMETRO.nivel, PARAMETRO.comparacao, PARAMETRO.formato],
    alcanca: (u) => ABA_DA_VISAO.some((a) => pode(u, `relatorio_resultados.${a}:ler`)),
    async executar(q, u, formato) {
      const p = validar(z.object({ ano: P.ano, mes: P.mes, visao: P.visao, nivel: P.nivel, comparacao: P.comparacao }), q);
      exigir(u, `relatorio_resultados.${ABA_DA_VISAO[p.visao]}:ler`);
      const tela = await daTela(() => resultadosService.unidade(p.ano, p.visao as 0 | 1 | 2 | 3 | 4 | 5, p.mes, u.acesso, true, p.comparacao));
      const r = { ...tela, linhas: noNivel(tela.linhas, p.nivel) } as unknown as Dre;
      const meta = { ano: tela.ano, mes: tela.ate, visao: nomeDaVisao(p.visao), nivel: NOME_DO_MODO[p.nivel - 1], comparado: tela.rotuloComparado };
      if (formato === "dados") return dreEmDados(r, tela.rotuloComparado, meta);
      const mes = tela.meses.find((m) => m.mes === tela.ate)?.rotulo ?? "";
      return { formato, visuais: [dreEmVisual(r, `Resultados · ${nomeDaVisao(p.visao)}`, `${mes} · comparado: ${tela.rotuloComparado}`, tela.rotuloComparado, true)], meta };
    },
  },
  {
    codigo: "resultados-painel",
    nome: "Cards do Painel de Bordo",
    origem: "Resultados Empresariais",
    descricao: "Os cards do Painel de Bordo (as abas Resultados e Performance): o valor do mês e o acumulado, com o comparado, a variação e o sinal (Melhor, Até 5% ou Pior).",
    exige: "Resultados Empresariais › Painel de Bordo (e a aba de cada card): Ler",
    formatos: ["dados", "visual"],
    parametros: [PARAMETRO.ano, PARAMETRO.mes, PARAMETRO.comparacao, PARAMETRO.aba, PARAMETRO.item, PARAMETRO.grafico, PARAMETRO.formato],
    alcanca: (u) => pode(u, "relatorio_painel:ler"),
    async executar(q, u, formato) {
      const p = validar(z.object({ ano: P.ano, mes: P.mes, comparacao: P.comparacao, aba: P.aba, item: P.item, grafico: P.grafico }), q);
      exigir(u, "relatorio_painel:ler");
      const r = await daTela(() => painelService.painel(p.ano, p.mes, true, p.comparacao));
      const cards = cardsDoPainel(r as unknown as Painel, (chave) => pode(u, `relatorio_painel.${chave}:ler`), p.aba, p.item);
      const meta = { ano: r.ano, mes: r.ate, periodo: r.rotuloMes, comparado: r.rotuloComparado };
      if (formato === "dados") return painelEmDados(cards, r.rotuloComparado, meta);
      return { formato, visuais: painelEmVisual(cards, r.rotuloMes, r.rotuloComparado, p.grafico === "sim"), meta };
    },
  },
  {
    codigo: "resultados-indicadores",
    nome: "Indicadores do Painel de Bordo",
    origem: "Resultados Empresariais",
    descricao: "Os indicadores da aba Indicadores do Painel de Bordo: o valor de cada mês e o acumulado, com o comparado.",
    exige: "Resultados Empresariais › Painel de Bordo › Indicadores: Ler",
    formatos: ["dados", "visual"],
    parametros: [PARAMETRO.ano, PARAMETRO.mes, PARAMETRO.comparacao, { ...PARAMETRO.item, descricao: "Só um indicador: o nome (sem diferenciar maiúsculas; um nome antigo também vale) ou o id dele no cadastro, que não muda com o nome." }, PARAMETRO.grafico, PARAMETRO.formato],
    alcanca: (u) => pode(u, "relatorio_painel.indicadores:ler"),
    async executar(q, u, formato) {
      const p = validar(z.object({ ano: P.ano, mes: P.mes, comparacao: P.comparacao, item: P.item, grafico: P.grafico }), q);
      exigir(u, "relatorio_painel.indicadores:ler");
      const r = (await daTela(() => indicadoresService.listar(p.ano, p.mes, true, p.comparacao))) as unknown as Indicadores & { rotuloComparado: string };
      const periodo = r.meses.find((m) => m.mes === r.ate)?.rotulo ?? "";
      const meta = { ano: r.ano, mes: r.ate, comparado: r.rotuloComparado };
      if (formato === "dados") return indicadoresEmDados(r, r.rotuloComparado, p.item, meta);
      return { formato, visuais: indicadoresEmVisual(r, periodo, r.rotuloComparado, p.item, p.grafico === "sim"), meta };
    },
  },
  {
    codigo: "cenarios",
    nome: "Lista de Cenários",
    origem: "Cenários",
    descricao: "Os cenários sintéticos e analíticos que você lê (os públicos e os seus), com o id, que as APIs dos cenários pedem.",
    exige: "Cenários Sintéticos ou Cenários Analíticos › Lista de Cenários: Ler",
    formatos: ["dados"],
    parametros: [],
    alcanca: (u) => pode(u, "cenarios_lista:ler") || pode(u, "cenarios_analiticos_lista:ler"),
    async executar(_q, u, formato) {
      if (formato === "visual") throw new ApiError(422, "A Lista de Cenários só tem o formato dados.", "FORMATO_INDISPONIVEL");
      const tipos = [...(pode(u, "cenarios_lista:ler") ? ["SINTETICO"] : []), ...(pode(u, "cenarios_analiticos_lista:ler") ? ["ANALITICO"] : [])];
      if (!tipos.length) throw new ApiError(403, "O seu perfil não lê a lista de cenários no SIG.", "SEM_PERMISSAO");
      const cs = await getPrismaClient().cenario.findMany({
        where: { tipo: { in: tipos }, ...(admin(u) ? {} : { OR: [{ visualizacao: "PUBLICA" }, { criadoPorId: u.sub }] }) },
        select: { id: true, nome: true, ano: true, tipo: true, marcacao: true, visualizacao: true },
        orderBy: [{ ano: "desc" }, { nome: "asc" }],
      });
      const colunas: Coluna[] = [
        { chave: "id", titulo: "Id", tipo: "texto" },
        { chave: "nome", titulo: "Cenário", tipo: "texto" },
        { chave: "ano", titulo: "Ano", tipo: "numero" },
        { chave: "tipo", titulo: "Tipo", tipo: "texto" },
        { chave: "marcacao", titulo: "Marcação", tipo: "texto" },
        { chave: "visualizacao", titulo: "Visualização", tipo: "texto" },
      ];
      const linhas = cs.map((c): Linha => ({
        id: c.id,
        nome: c.nome,
        ano: c.ano,
        tipo: c.tipo === "ANALITICO" ? "Analítico" : "Sintético",
        marcacao: c.marcacao ? MARCACOES[c.marcacao] : null,
        visualizacao: c.visualizacao === "PUBLICA" ? "Pública" : "Particular",
      }));
      return { formato: "dados", colunas, linhas, meta: { linhas: linhas.length } };
    },
  },
  {
    codigo: "cenario-dre",
    nome: "DRE de um Cenário",
    origem: "Cenários",
    descricao: "Os Resultados de um cenário (sintético ou analítico) numa visão: as linhas da DRE com os meses, o total do ano e o comparado do cenário.",
    exige: "Cenários Sintéticos ou Analíticos › Resultados (a aba da visão): Ler",
    formatos: ["dados", "visual"],
    parametros: [PARAMETRO.cenario, PARAMETRO.visao, PARAMETRO.nivel, PARAMETRO.formato],
    alcanca: (u) => BASES.some((b) => ABA_DA_VISAO.some((a) => pode(u, `${b}_resultados.${a}:ler`))),
    async executar(q, u, formato) {
      const p = validar(z.object({ cenario: P.cenario, visao: P.visao, nivel: P.nivel }), q);
      const c = await cenarioDaApi(p.cenario, u);
      exigir(u, `${c.base}_resultados.${ABA_DA_VISAO[p.visao]}:ler`);
      const tela = await daTela(() => cenariosService.resultados(p.cenario, p.visao as 0 | 1 | 2 | 3 | 4 | 5, usuarioDoCenario(u)));
      const r = { ...tela, linhas: noNivel(tela.linhas, p.nivel) } as unknown as Dre;
      const comparado = tela.comparado?.nome ?? "Comparado";
      const meta = { cenario: c.nome, ano: tela.ano, visao: nomeDaVisao(p.visao), nivel: NOME_DO_MODO[p.nivel - 1], comparado: tela.comparado?.nome ?? null };
      if (formato === "dados") return dreEmDados(r, comparado, meta);
      return { formato, visuais: [dreEmVisual(r, `${c.nome} · ${nomeDaVisao(p.visao)}`, `Cenário ${c.ano}${tela.comparado ? ` · comparado: ${tela.comparado.nome}` : ""}`, comparado, false)], meta };
    },
  },
  {
    codigo: "cenario-painel",
    nome: "Cards do Painel de Bordo de um Cenário",
    origem: "Cenários",
    descricao: "Os cards do Painel de Bordo de um cenário, no mês escolhido: o valor do mês e o acumulado, com o comparado do cenário.",
    exige: "Cenários Sintéticos ou Analíticos › Painel de Bordo (e a aba de cada card): Ler",
    formatos: ["dados", "visual"],
    parametros: [PARAMETRO.cenario, { ...PARAMETRO.mes, descricao: "O mês (1 a 12); sem ele, 12 (o ano todo)." }, PARAMETRO.aba, PARAMETRO.item, PARAMETRO.grafico, PARAMETRO.formato],
    alcanca: (u) => BASES.some((b) => pode(u, `${b}_painel:ler`)),
    async executar(q, u, formato) {
      const p = validar(z.object({ cenario: P.cenario, mes: P.mes, aba: P.aba, item: P.item, grafico: P.grafico }), q);
      const c = await cenarioDaApi(p.cenario, u);
      exigir(u, `${c.base}_painel:ler`);
      const r = await daTela(() => cenariosService.painel(p.cenario, p.mes ?? 12, usuarioDoCenario(u)));
      const comparado = r.comparado?.nome ?? "Comparado";
      const cards = cardsDoPainel(r as unknown as Painel, (chave) => pode(u, `${c.base}_painel.${chave}:ler`), p.aba, p.item);
      const meta = { cenario: c.nome, ano: r.ano, mes: r.ate, periodo: r.rotuloMes, comparado: r.comparado?.nome ?? null };
      if (formato === "dados") return painelEmDados(cards, comparado, meta);
      return { formato, visuais: painelEmVisual(cards, `${c.nome} · ${r.rotuloMes}`, comparado, p.grafico === "sim"), meta };
    },
  },
  {
    codigo: "cenario-indicadores",
    nome: "Indicadores de um Cenário",
    origem: "Cenários",
    descricao: "Os indicadores de um cenário (a aba Indicadores do Painel de Bordo dele): os meses e o acumulado, com o comparado do cenário.",
    exige: "Cenários Sintéticos ou Analíticos › Painel de Bordo › Indicadores: Ler",
    formatos: ["dados", "visual"],
    parametros: [PARAMETRO.cenario, { ...PARAMETRO.item, descricao: "Só um indicador: o nome (sem diferenciar maiúsculas; um nome antigo também vale) ou o id dele no cadastro, que não muda com o nome." }, PARAMETRO.grafico, PARAMETRO.formato],
    alcanca: (u) => BASES.some((b) => pode(u, `${b}_painel.metas:ler`)),
    async executar(q, u, formato) {
      const p = validar(z.object({ cenario: P.cenario, item: P.item, grafico: P.grafico }), q);
      const c = await cenarioDaApi(p.cenario, u);
      exigir(u, `${c.base}_painel.metas:ler`);
      const r = (await daTela(() => cenariosService.indicadores(p.cenario, usuarioDoCenario(u)))) as unknown as Indicadores & { comparado: { nome: string } | null };
      const comparado = r.comparado?.nome ?? "Comparado";
      const meta = { cenario: c.nome, ano: r.ano, comparado: r.comparado?.nome ?? null };
      if (formato === "dados") return indicadoresEmDados(r, comparado, p.item, meta);
      return { formato, visuais: indicadoresEmVisual(r, `${c.nome} · ${r.ano}`, comparado, p.item, p.grafico === "sim"), meta };
    },
  },
];

export const apiDoCodigo = (codigo: string) => CATALOGO.find((a) => a.codigo === codigo);
