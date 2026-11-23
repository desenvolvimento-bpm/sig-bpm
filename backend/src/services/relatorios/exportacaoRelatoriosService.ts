import { getPrismaClient } from "../../config/prisma.js";
import { A4_PAISAGEM, caber, DocumentoPDF, type Cor, type Fonte } from "../../lib/pdfEscrita.js";
import { ESTILO, naCorDaDRE, gerarXlsx, type AbaEscrita, type Celula } from "../../lib/xlsxEscrita.js";
import { fundoDaDRE, semPrimeiroTotalDaRol } from "./linhasDaDRE.js";
import { ACESSO_TOTAL, type Acesso } from "../acesso/acesso.js";
import { indicadoresService } from "./indicadoresService.js";
import { RelatorioError, resultadosService } from "./resultadosService.js";
import { nomeDoGrupoSemCentro, type GrupoSemCentro } from "../dre/semCentroService.js";
import { resultadosLinhaService } from "../resultadosLinha/resultadosLinhaService.js";
import { detalhesDosResultados, type AbaDetalhada, type AlvoDosDetalhes } from "./detalhesDosResultados.js";
import { plural } from "../../utils/plural.js";
import { limparNome, nomeDoDepartamento, TIPO_ZIP, zipDeArquivos } from "../../lib/arquivosExportados.js";
import type { Comparacao } from "../cenarios/indicadoresDoCenario.js";
import type { MarcacaoCenario } from "../../generated/prisma/enums.js";

/**
 * Exportação dos relatórios em Excel e PDF, como a tela: os Resultados (uma
 * visão, todas as unidades ou todos os centros de custo, uma por aba ou por
 * página) e os Indicadores. No Excel vão todas as colunas da tela; no PDF
 * (A4 deitada), cada mês traz o valor e, embaixo, a participação, e o fim da
 * linha o total do exercício com o % e o R$/m³. O R$/m³ só aparece no mês de
 * referência (o último) e no total.
 */

export type EscopoResultados =
  | { tipo: "visao"; visao: 0 | 1 | 2 | 3 | 4 | 5 }
  | { tipo: "centro"; grupo: string }
  /** A aba Departamentos (23/11/2026): o Consolidado com os departamentos abertos pelos centros de custo. */
  | { tipo: "departamentos" }
  | { tipo: "unidades" }
  | { tipo: "centros" }
  /** Todos os centros de custo, um arquivo Excel por centro, num ZIP (14/10/2026). */
  | { tipo: "centrosArquivos" }
  // As obras e os movimentos sem centro de custo (14/10/2026): um (o da tela) ou todos.
  | { tipo: "obra"; codigo: string }
  | { tipo: "obras" }
  | { tipo: "semCentro"; grupo: GrupoSemCentro }
  | { tipo: "semCentros" }
  // As linhas (26/10/2026): uma (a da tela) ou todas, das unidades que o perfil lê; `rateios`, a aba Rateios das Linhas.
  | { tipo: "linha"; id: string; rateios: boolean; unidades: number[] }
  | { tipo: "linhas"; rateios: boolean; unidades: number[] };
export type Formato = "xlsx" | "pdf";
/**
 * A comparação da tela (16/11/2026): nas visões das unidades, as linhas que entram sem o realizado são as que têm o orçado
 * do cenário comparado (ou de um dos da PROVA), como na tela; sem ela, o Orçamento Empresarial.
 */
export type ComparacaoDaTela = { comparaCom: Comparacao; prova: MarcacaoCenario[] };
const SEM_COMPARACAO: ComparacaoDaTela = { comparaCom: "ORCAMENTO_EMPRESARIAL", prova: [] };

// O que as visões e os centros de custo têm em comum (o orçado das visões não vai para a exportação).
type Resultados = Pick<Awaited<ReturnType<typeof resultadosService.centros>>, "ano" | "ate" | "meses" | "linhas">;
/**
 * Uma aba (Excel) ou um conjunto de páginas (PDF); nos centros de custo, o departamento (para o nome do arquivo). `comparado`
 * (23/11/2026, os Resultados dos cenários): o rótulo das colunas do cenário comparado — com ele, o total do comparado de cada linha
 * (o `orcado.total` dela) e as variações (Diferença, Atingimento, Eficiência) entram no arquivo.
 */
export type Bloco = { nome: string; titulo: string; dados: Resultados; departamento?: string; detalhe?: AlvoDosDetalhes | null; comparado?: { rotulo: string } | null };

/** Uma célula do total (o valor, o % e o R$/m³). */
type CelulaDoTotal = { valor: number | null; pct: number | null; unitario: number | null };
type LinhaDoBloco = Resultados["linhas"][number];
/** O total do cenário comparado na linha (o campo do orçado, só o total). */
const doComparado = (l: LinhaDoBloco): CelulaDoTotal | null => (l as { orcado?: { total?: CelulaDoTotal } | null }).orcado?.total ?? null;
/**
 * As variações do cenário contra o comparado (23/11/2026), como na tela: a Diferença (o cenário menos o comparado), o Atingimento (o
 * cenário sobre o comparado; comparado zero, sem ele) e a Eficiência (o % do cenário menos o do comparado, em pontos percentuais; só
 * nas linhas com %).
 */
function variacoes(l: LinhaDoBloco, o: CelulaDoTotal | null) {
  const r = l.total;
  const comPct = !l.volume && (l.meses.some((c) => c.pct !== null) || r.pct !== null);
  return {
    diferenca: o && r.valor !== null && o.valor !== null ? r.valor - o.valor : null,
    atingimento: o && r.valor !== null && o.valor ? r.valor / o.valor : null,
    eficiencia: !o || !comPct ? undefined : r.pct !== null && o.pct !== null ? (r.pct - o.pct) * 100 : null,
  };
}
/**
 * O Atingimento com o sinal (23/11/2026, pedido do Adão, como na tela): o cenário sobre o comparado menos 100% — "+6,5%" (106,5%),
 * "-7,5%" (92,5%); o que arredonda para zero, "0,0%", sem sinal. `razao`: o cenário ÷ o comparado.
 */
const atingimentoComSinal = (razao: number) => {
  const v = razao - 1;
  const t = pct(v);
  if (!/[1-9]/.test(t)) return t.replace("-", "");
  return v > 0 ? `+${t}` : t;
};
/** Os pontos percentuais com o sinal ("+1,2 p.p."; o que arredonda para zero, sem sinal). */
const pontos = (pp: number) => {
  const t = n1.format(pp);
  if (!/[1-9]/.test(t)) return `${t.replace("-", "")} p.p.`;
  return `${pp > 0 ? "+" : ""}${t} p.p.`;
};

const VISOES: Array<{ visao: 0 | 1 | 2 | 3 | 4 | 5; nome: string }> = [
  { visao: 0, nome: "Consolidado" },
  { visao: 1, nome: "Matriz" },
  { visao: 2, nome: "Filial" },
  { visao: 3, nome: "Serviços" },
  { visao: 4, nome: "Despesas e Extra" },
  { visao: 5, nome: "RN" },
];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const dataHora = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d).replace(",", "");
const n0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const n1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const n2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v: number) => `${n1.format(v * 100)}%`;

/** A identificação do arquivo: o período, o estado das competências e quem gerou. */
async function identificar(ano: number, ate: number, usuarioNome: string) {
  const competencias = await getPrismaClient().competencia.findMany({ where: { ano, mes: { lte: ate } }, select: { status: true, apuradaEm: true } });
  const apuradas = competencias.filter((c) => c.apuradaEm !== null);
  const abertas = apuradas.filter((c) => c.status !== "FECHADA").length;
  return {
    periodo: `Exercício ${ano} · de janeiro a ${MESES[ate - 1]} · ${apuradas.length} ${plural(apuradas.length, "competência apurada", "competências apuradas")}`,
    avisos: abertas ? [`Valores provisórios: ${abertas} ${plural(abertas, "competência do período ainda não está fechada", "competências do período ainda não estão fechadas")}.`] : [],
    geracao: `Gerado em ${dataHora(new Date())} por ${usuarioNome} · SIG BPM`,
  };
}
export type Identificacao = Awaited<ReturnType<typeof identificar>>;

/** A identificação de um arquivo de fora dos Resultados Empresariais (os cenários, 14/10/2026): o período e quem gerou. */
export const identificacaoLivre = (periodo: string, usuarioNome: string): Identificacao => ({ periodo, avisos: [], geracao: `Gerado em ${dataHora(new Date())} por ${usuarioNome} · SIG BPM` });

/** O que a aba Detalhes detalha numa visão (27/10/2026): a unidade, ou as cinco no Consolidado. */
const alvoDaVisao = (visao: number): AlvoDosDetalhes => ({ tipo: "unidades", unidades: visao === 0 ? [1, 2, 3, 4, 5] : [visao] });
/** Uma aba exportada, para a aba Detalhes: o nome, as linhas dela e o que detalhar. */
const abaDetalhada = (b: Bloco): AbaDetalhada => ({ nome: b.nome, codigos: b.dados.linhas.map((l) => l.codigo), alvo: b.detalhe ?? null });

// A exportação de Resultados é a tela de Resultados Empresariais: só as competências fechadas (11/10/2026).
async function blocos(ano: number, ate: number | undefined, escopo: EscopoResultados, acesso: Acesso, comparacao: ComparacaoDaTela = SEM_COMPARACAO): Promise<Bloco[]> {
  const daVisao = (visao: 0 | 1 | 2 | 3 | 4 | 5) => resultadosService.unidade(ano, visao, ate, acesso, true, comparacao.comparaCom, comparacao.prova);
  if (escopo.tipo === "visao") {
    const v = VISOES.find((x) => x.visao === escopo.visao)!;
    return [{ nome: v.nome, titulo: v.nome, dados: await daVisao(v.visao), detalhe: alvoDaVisao(v.visao) }];
  }
  // A aba Departamentos (23/11/2026), sem a aba Detalhes (as linhas dos centros e as "(Outros)" não são as do balancete).
  if (escopo.tipo === "departamentos") return [{ nome: "Departamentos", titulo: "Departamentos", dados: await resultadosService.departamentos(ano, ate, acesso, true, comparacao.comparaCom), detalhe: null }];
  if (escopo.tipo === "obra" || escopo.tipo === "obras") {
    const obras = escopo.tipo === "obra" ? [escopo.codigo] : (await resultadosService.listarObras(ano, ate, acesso, true)).obras.map((o) => o.codigo);
    const r: Bloco[] = [];
    for (const codigo of obras) {
      const dados = await resultadosService.obra(ano, codigo, ate, acesso, true);
      r.push({ nome: dados.obra.nome, titulo: `Obra ${dados.obra.nome} (${codigo})`, dados, detalhe: { tipo: "obra", codigo } });
    }
    return r;
  }
  if (escopo.tipo === "semCentro" || escopo.tipo === "semCentros") {
    const grupos = escopo.tipo === "semCentro" ? [escopo.grupo] : (await resultadosService.listarSemCentros(ano, ate, acesso, true)).grupos.map((g) => g.codigo as GrupoSemCentro);
    const r: Bloco[] = [];
    for (const g of grupos) {
      // A aba do Excel tem até 31 caracteres: a DVV abreviada.
      const nome = nomeDoGrupoSemCentro(g).replace("Despesas Variáveis de Venda", "DVV");
      r.push({ nome, titulo: `Sem Centro de Custo · ${nomeDoGrupoSemCentro(g)}`, dados: await resultadosService.semCentro(ano, g, ate, acesso, true), detalhe: { tipo: "semCentro", grupo: g } });
    }
    return r;
  }
  if (escopo.tipo === "linha" || escopo.tipo === "linhas") {
    const ids = escopo.tipo === "linha" ? [escopo.id] : (await resultadosLinhaService.listar(ano, ate, escopo.unidades)).linhas.map((l) => l.id);
    const r: Bloco[] = [];
    for (const id of ids) {
      const dados = await resultadosLinhaService.linha(ano, ate, id, escopo.rateios, escopo.unidades);
      const nome = `${dados.linha.nome} (${dados.linha.nomeUnidade})`;
      r.push({ nome, titulo: escopo.rateios ? `Rateios das Linhas · ${nome}` : `Linha ${nome}`, dados, detalhe: null });
    }
    return r;
  }
  if (escopo.tipo === "unidades") return Promise.all(VISOES.map(async (v) => ({ nome: v.nome, titulo: v.nome, dados: await daVisao(v.visao), detalhe: alvoDaVisao(v.visao) })));
  // Os centros, com o departamento de cada um (o do cadastro; com mais de um, todos) para o nome do arquivo.
  const lista = (await resultadosService.listarCentros(ano, ate, acesso, true)).grupos;
  const departamento = (g: string) => (lista.find((x) => x.grupo === g)?.departamentos ?? []).map(nomeDoDepartamento).join(" e ") || nomeDoDepartamento(null);
  const grupos = escopo.tipo === "centro" ? [escopo.grupo] : lista.map((g) => g.grupo);
  const r: Bloco[] = [];
  for (const g of grupos) r.push({ nome: g, titulo: `Centro de Custo ${g}`, dados: await resultadosService.centros(ano, g, ate, acesso, true), departamento: departamento(g), detalhe: { tipo: "centro", grupo: g } });
  return r;
}

// ---- Excel ------------------------------------------------------------------------------------

function abaResultados(b: Bloco, id: Identificacao): AbaEscrita {
  const { dados } = b;
  const linhas: Celula[][] = [
    [{ valor: `Resultados · ${b.titulo}`, estilo: ESTILO.titulo }],
    [{ valor: id.periodo, estilo: ESTILO.informacao }],
    [{ valor: id.geracao, estilo: ESTILO.informacao }],
    ...id.avisos.map((a) => [{ valor: a, estilo: ESTILO.aviso }]),
    [],
  ];
  const cab = (t: string) => ({ valor: t, estilo: ESTILO.cabecalhoDireita });
  linhas.push([
    { valor: "Linha", estilo: ESTILO.cabecalho },
    // Cada mês com o valor e o %; o mês de referência (o último) também com o R$/m³.
    ...dados.meses.flatMap((m, i) => [cab(m.rotulo), cab("%"), ...(i === dados.meses.length - 1 ? [cab("R$/m³")] : [])]),
    cab(`TOTAL/${String(dados.ano).slice(2)}`),
    cab("%"),
    cab("R$/m³"),
    // O cenário comparado (23/11/2026): o total dele e as variações, depois do total, como na tela.
    ...(b.comparado ? [cab(b.comparado.rotulo), cab("%"), cab("R$/m³"), cab("DIFERENÇA"), cab("ATINGIMENTO"), cab("EFICIÊNCIA")] : []),
  ]);
  const cabecalho = linhas.length;
  // Sem o primeiro total da ROL e com os fundos das telas (22/10/2026): os totais em amarelo claro, os resultados mais forte.
  for (const l of semPrimeiroTotalDaRol(dados.linhas.filter((x) => x.tipo !== "SECAO"))) {
    const fundo = fundoDaDRE(l);
    const d = fundo !== "item";
    const t = (e: Parameters<typeof naCorDaDRE>[0]) => (fundo === "item" ? ESTILO[e] : naCorDaDRE(e, fundo));
    const num = (v: number | null): Celula => (v === null ? { valor: null, estilo: d ? t("destaqueDireita") : ESTILO.itemDireita } : { valor: v, estilo: d ? t("destaqueNumero") : ESTILO.itemNumero });
    const per = (v: number | null): Celula => (v === null || l.volume ? { valor: null, estilo: d ? t("destaqueDireita") : ESTILO.itemDireita } : { valor: v, estilo: d ? t("destaquePercentual") : ESTILO.itemPercentual });
    const o = b.comparado ? doComparado(l) : null;
    const v = variacoes(l, o);
    const texto = (s: string | null): Celula => ({ valor: s, estilo: d ? t("destaqueDireita") : ESTILO.itemDireita });
    linhas.push([
      { valor: l.descricao, estilo: d ? t("destaque") : ESTILO.item },
      ...l.meses.flatMap((c, i) => [num(c.valor), per(c.pct), ...(i === l.meses.length - 1 ? [num(l.volume ? null : c.unitario)] : [])]),
      num(l.total.valor),
      per(l.total.pct),
      num(l.volume ? null : l.total.unitario),
      ...(b.comparado
        ? [
            num(o?.valor ?? null),
            per(o?.pct ?? null),
            num(l.volume ? null : (o?.unitario ?? null)),
            num(v.diferenca),
            // O Atingimento (o cenário ÷ o comparado − 100%, com o sinal, como na tela), também nas linhas de volume.
            texto(v.atingimento === null ? null : atingimentoComSinal(v.atingimento)),
            texto(v.eficiencia === undefined || v.eficiencia === null ? null : pontos(v.eficiencia)),
          ]
        : []),
    ]);
  }
  return {
    nome: b.nome,
    larguras: [48, ...dados.meses.flatMap((_, i) => (i === dados.meses.length - 1 ? [15, 8, 10] : [15, 8])), 16, 8, 10, ...(b.comparado ? [18, 8, 10, 15, 13, 12] : [])],
    linhas,
    linhaCabecalho: cabecalho,
    rodape: `Resultados ${dados.ano} · ${b.titulo}`,
    paisagem: true,
    congelarPrimeiraColuna: true,
  };
}

type Indicadores = Awaited<ReturnType<typeof indicadoresService.listar>>;
const NOME_DO_GRUPO: Record<string, string> = { GME: "Metas Estratégicas (GME)" };

/** Só o mês da competência (a etapa Indicadores do Fechamento Mensal): sem os meses anteriores e sem o acumulado. */
function soOMes(dados: Indicadores): Indicadores {
  return { ...dados, meses: dados.meses.slice(-1), indicadores: dados.indicadores.map((i) => ({ ...i, meses: i.meses.slice(-1) })) };
}

function abaIndicadores(dados: Indicadores, id: Identificacao, acumulado = true): AbaEscrita {
  const linhas: Celula[][] = [
    [{ valor: "Indicadores", estilo: ESTILO.titulo }],
    [{ valor: id.periodo, estilo: ESTILO.informacao }],
    [{ valor: id.geracao, estilo: ESTILO.informacao }],
    ...id.avisos.map((a) => [{ valor: a, estilo: ESTILO.aviso }]),
    [],
  ];
  const cab = (t: string, direita = false) => ({ valor: t, estilo: direita ? ESTILO.cabecalhoDireita : ESTILO.cabecalho });
  linhas.push([cab("Indicador"), cab("Nº"), cab("Sentido"), cab("Und."), cab("Metodologia"), ...dados.meses.map((m) => cab(m.rotulo, true)), ...(acumulado ? [cab("Acumulado", true)] : [])]);
  const cabecalho = linhas.length;
  let grupo = "";
  for (const i of dados.indicadores) {
    if (i.grupo !== grupo) {
      grupo = i.grupo;
      linhas.push([{ valor: (NOME_DO_GRUPO[grupo] ?? grupo).toUpperCase(), estilo: ESTILO.destaque }]);
    }
    // R$ M e R$ K (22/10/2026): em milhões ou em milhares, como a coluna Und. diz.
    const escala = i.unidade === "R$ M" ? 1e-6 : i.unidade === "R$ K" ? 1e-3 : 1;
    const valor = (v: number | null): Celula =>
      v === null ? { valor: null, estilo: ESTILO.itemDireita } : { valor: v * escala, estilo: i.unidade === "%" ? ESTILO.itemPercentual : ESTILO.itemNumero };
    linhas.push([
      { valor: i.nome, estilo: ESTILO.item },
      { valor: i.numero || null },
      { valor: i.sentido },
      { valor: i.unidade },
      { valor: i.metodologia, estilo: ESTILO.informacao },
      ...i.meses.map(valor),
      ...(acumulado ? [valor(i.total)] : []),
    ]);
  }
  return {
    nome: "Indicadores",
    larguras: [46, 7, 8, 12, 40, ...dados.meses.map(() => 14), ...(acumulado ? [16] : [])],
    linhas,
    linhaCabecalho: cabecalho,
    rodape: `Indicadores ${dados.ano}`,
    paisagem: true,
    congelarPrimeiraColuna: true,
  };
}

// ---- PDF --------------------------------------------------------------------------------------

const CINZA: Cor = [75, 85, 99];
const CLARO: Cor = [107, 114, 128];
const AMBAR: Cor = [146, 64, 14];
const FUNDO: Cor = [243, 244, 246];
/** Os fundos dos totais da DRE (22/10/2026), como nas telas: os totais (yellow-100) e as linhas de resultado (yellow-200). */
const FUNDO_DO_TOTAL: Cor = [254, 249, 195];
const FUNDO_DO_RESULTADO: Cor = [254, 240, 138];
const TRACO: Cor = [156, 163, 175];
const M = 30;
const DIREITA = A4_PAISAGEM.largura - M;
const CORPO = 6.8;

/** Cabeçalho da página (título, período e avisos na primeira; "continuação" nas demais). */
function topo(doc: DocumentoPDF, titulo: string, id: Identificacao, primeira: boolean) {
  doc.novaPagina();
  let y = A4_PAISAGEM.altura - 36;
  if (primeira) {
    doc.texto(M, y, titulo, { fonte: "negrito", tamanho: 13 });
    y -= 14;
    doc.texto(M, y, id.periodo, { tamanho: 8, cor: CINZA });
    y -= 10;
    for (const a of id.avisos) {
      doc.texto(M, y, a, { tamanho: 8, cor: AMBAR });
      y -= 10;
    }
    return y - 6;
  }
  doc.texto(M, y, `${titulo} (continuação)`, { fonte: "negrito", tamanho: 9 });
  return y - 14;
}

function paginasResultados(doc: DocumentoPDF, b: Bloco, id: Identificacao) {
  const { dados } = b;
  const larguraDescricao = 190;
  // O R$/m³ do mês de referência (o último) fica logo depois dele, antes do total.
  const colunas = [...dados.meses.map((m) => m.rotulo), "R$/m³", `TOTAL/${String(dados.ano).slice(2)}`, "%", "R$/m³"];
  const w = (DIREITA - M - larguraDescricao) / colunas.length;
  const x = (i: number) => M + larguraDescricao + w * (i + 1) - 3; // borda direita da coluna
  const ALTURA = 15;
  let y = 0;
  const cabecalho = () => {
    doc.retangulo(M, y - 4, DIREITA - M, 13, FUNDO);
    doc.texto(M + 3, y, "Linha", { fonte: "negrito", tamanho: CORPO });
    colunas.forEach((c, i) => doc.texto(x(i), y, c, { fonte: "negrito", tamanho: CORPO, alinhar: "direita" }));
    doc.linha(M, y - 4, DIREITA, y - 4, TRACO);
    y -= 15;
  };
  const titulo = `Resultados · ${b.titulo}`;
  y = topo(doc, titulo, id, true);
  cabecalho();
  for (const l of semPrimeiroTotalDaRol(dados.linhas.filter((z) => z.tipo !== "SECAO"))) {
    if (y < 40) {
      y = topo(doc, titulo, id, false);
      cabecalho();
    }
    const fundo = fundoDaDRE(l);
    const d = fundo !== "item";
    const fonte: Fonte = d ? "negrito" : "normal";
    if (d) doc.retangulo(M, y - 9.5, DIREITA - M, ALTURA - 1, fundo === "resultado" ? FUNDO_DO_RESULTADO : FUNDO_DO_TOTAL);
    const xt = d ? M + 3 : M + 11;
    doc.texto(xt, y - 2, caber(l.descricao, fonte, CORPO, larguraDescricao - (xt - M) - 4), { fonte, tamanho: CORPO });
    const valor = (v: number | null) => (v === null ? "—" : l.volume ? n2.format(v) : n0.format(v));
    l.meses.forEach((c, i) => {
      // Sem a participação embaixo (linhas de volume), o valor fica na altura da descrição.
      doc.texto(x(i), l.volume ? y - 2 : y, valor(c.valor), { fonte, tamanho: CORPO, alinhar: "direita" });
      if (!l.volume && c.pct !== null) doc.texto(x(i), y - 7, pct(c.pct), { tamanho: 5.5, cor: CLARO, alinhar: "direita" });
    });
    const ultimo = l.meses[l.meses.length - 1];
    if (!l.volume && ultimo.unitario !== null) doc.texto(x(l.meses.length), y - 2, n2.format(ultimo.unitario), { tamanho: CORPO, alinhar: "direita" });
    const k = dados.meses.length + 1;
    doc.texto(x(k), y - 2, valor(l.total.valor), { fonte, tamanho: CORPO, alinhar: "direita" });
    if (!l.volume && l.total.pct !== null) doc.texto(x(k + 1), y - 2, pct(l.total.pct), { tamanho: CORPO, alinhar: "direita" });
    if (!l.volume && l.total.unitario !== null) doc.texto(x(k + 2), y - 2, n2.format(l.total.unitario), { tamanho: CORPO, alinhar: "direita" });
    y -= ALTURA;
  }
}

/**
 * O comparativo de um bloco no PDF (23/11/2026, os Resultados dos cenários): os doze meses, o total e o comparado não cabem lado a
 * lado no A4; depois das páginas da DRE, as do comparativo — o total do cenário, o do comparado (o valor, o % e o R$/m³) e as
 * variações (Diferença, Atingimento, Eficiência), como na tela.
 */
function paginasDoComparado(doc: DocumentoPDF, b: Bloco, id: Identificacao) {
  const { dados } = b;
  const larguraDescricao = 230;
  const colunas = [`TOTAL/${String(dados.ano).slice(2)}`, "%", "R$/m³", b.comparado!.rotulo, "%", "R$/m³", "DIFERENÇA", "ATINGIMENTO", "EFICIÊNCIA"];
  // A largura de cada coluna, em partes do espaço depois da descrição: a do rótulo do comparado, a mais larga.
  const pesos = [1.2, 0.7, 0.8, 1.7, 0.7, 0.8, 1.1, 1.1, 1.0];
  const parte = (DIREITA - M - larguraDescricao) / pesos.reduce((s, p) => s + p, 0);
  const x = (i: number) => M + larguraDescricao + parte * pesos.slice(0, i + 1).reduce((s, p) => s + p, 0) - 3;
  const ALTURA = 13;
  let y = 0;
  const cabecalho = () => {
    doc.retangulo(M, y - 4, DIREITA - M, 13, FUNDO);
    doc.texto(M + 3, y, "Linha", { fonte: "negrito", tamanho: CORPO });
    colunas.forEach((c, i) => doc.texto(x(i), y, c, { fonte: "negrito", tamanho: CORPO, alinhar: "direita" }));
    doc.linha(M, y - 4, DIREITA, y - 4, TRACO);
    y -= 15;
  };
  const titulo = `Resultados · ${b.titulo} · Comparativo`;
  y = topo(doc, titulo, id, true);
  cabecalho();
  for (const l of semPrimeiroTotalDaRol(dados.linhas.filter((z) => z.tipo !== "SECAO"))) {
    if (y < 40) {
      y = topo(doc, titulo, id, false);
      cabecalho();
    }
    const fundo = fundoDaDRE(l);
    const d = fundo !== "item";
    const fonte: Fonte = d ? "negrito" : "normal";
    if (d) doc.retangulo(M, y - 7.5, DIREITA - M, ALTURA - 1, fundo === "resultado" ? FUNDO_DO_RESULTADO : FUNDO_DO_TOTAL);
    const xt = d ? M + 3 : M + 11;
    doc.texto(xt, y - 2, caber(l.descricao, fonte, CORPO, larguraDescricao - (xt - M) - 4), { fonte, tamanho: CORPO });
    const valor = (v: number | null | undefined) => (v === null || v === undefined ? "—" : l.volume ? n2.format(v) : n0.format(v));
    const o = doComparado(l);
    const v = variacoes(l, o);
    const comSinal = (n: number, t: string) => (n > 0 && /[1-9]/.test(t) ? `+${t}` : t);
    const celulas = [
      valor(l.total.valor),
      l.volume || l.total.pct === null ? "" : pct(l.total.pct),
      l.volume || l.total.unitario === null ? "" : n2.format(l.total.unitario),
      valor(o?.valor),
      l.volume || !o || o.pct === null ? "" : pct(o.pct),
      l.volume || !o || o.unitario === null ? "" : n2.format(o.unitario),
      v.diferenca === null ? "—" : comSinal(v.diferenca, valor(v.diferenca)),
      v.atingimento === null ? "—" : atingimentoComSinal(v.atingimento),
      v.eficiencia === undefined ? "" : v.eficiencia === null ? "—" : pontos(v.eficiencia),
    ];
    celulas.forEach((t, i) => (t ? doc.texto(x(i), y - 2, t, { fonte: i === 0 || i === 3 ? fonte : "normal", tamanho: CORPO, alinhar: "direita" }) : undefined));
    y -= ALTURA;
  }
}

function valorIndicador(unidade: string, v: number | null) {
  if (v === null) return "—";
  if (unidade === "%") return pct(v);
  if (unidade === "R$" || unidade === "colab." || unidade === "ocorr.") return n0.format(v);
  if (unidade === "pistas") return n1.format(v);
  // Em milhões ou em milhares, com uma casa (22/10/2026), como nos cards do Painel de Bordo.
  if (unidade === "R$ M") return n1.format(v / 1e6);
  if (unidade === "R$ K") return n1.format(v / 1e3);
  return n2.format(v);
}

/** As setas não existem na fonte padrão do PDF (WinAnsi): o sentido vai por extenso. */
const SENTIDO_PDF: Record<string, string> = { "↑": "maior", "↓": "menor", "=": "=", "-": "-" };

function paginasIndicadores(doc: DocumentoPDF, dados: Indicadores, id: Identificacao, acumulado = true) {
  const larguraNome = 230;
  const fixas = [
    { rotulo: "Sent.", w: 26 },
    { rotulo: "Und.", w: 52 },
  ];
  const colunas = [...dados.meses.map((m) => m.rotulo), ...(acumulado ? ["Acumulado"] : [])];
  const inicio = M + larguraNome + fixas.reduce((s, f) => s + f.w, 0);
  const w = (DIREITA - inicio) / colunas.length;
  const x = (i: number) => inicio + w * (i + 1) - 3;
  let y = 0;
  const cabecalho = () => {
    doc.retangulo(M, y - 4, DIREITA - M, 13, FUNDO);
    doc.texto(M + 3, y, "Indicador", { fonte: "negrito", tamanho: CORPO });
    doc.texto(M + larguraNome, y, "Sent.", { fonte: "negrito", tamanho: CORPO });
    doc.texto(M + larguraNome + fixas[0].w, y, "Und.", { fonte: "negrito", tamanho: CORPO });
    colunas.forEach((c, i) => doc.texto(x(i), y, c, { fonte: "negrito", tamanho: CORPO, alinhar: "direita" }));
    doc.linha(M, y - 4, DIREITA, y - 4, TRACO);
    y -= 15;
  };
  y = topo(doc, "Indicadores", id, true);
  cabecalho();
  let grupo = "";
  for (const i of dados.indicadores) {
    if (y < 48) {
      y = topo(doc, "Indicadores", id, false);
      cabecalho();
    }
    if (i.grupo !== grupo) {
      grupo = i.grupo;
      doc.retangulo(M, y - 4, DIREITA - M, 12, FUNDO);
      doc.texto(M + 3, y, (NOME_DO_GRUPO[grupo] ?? grupo).toUpperCase(), { fonte: "negrito", tamanho: CORPO });
      y -= 14;
    }
    const principal = i.numero === "";
    const fonte: Fonte = principal ? "negrito" : "normal";
    const xt = principal ? M + 3 : M + 11;
    doc.texto(xt, y, caber(`${i.numero ? `${i.numero}  ` : ""}${i.nome}`, fonte, CORPO, larguraNome - (xt - M) - 4), { fonte, tamanho: CORPO });
    doc.texto(xt, y - 7, caber(i.metodologia, "normal", 5.5, larguraNome - (xt - M) - 4), { tamanho: 5.5, cor: CLARO });
    doc.texto(M + larguraNome, y, SENTIDO_PDF[i.sentido] ?? i.sentido, { tamanho: CORPO, cor: CINZA });
    doc.texto(M + larguraNome + fixas[0].w, y, i.unidade, { tamanho: CORPO, cor: CINZA });
    i.meses.forEach((v, k) => doc.texto(x(k), y, valorIndicador(i.unidade, v), { fonte, tamanho: CORPO, alinhar: "direita" }));
    if (acumulado) doc.texto(x(i.meses.length), y, valorIndicador(i.unidade, i.total), { fonte: "negrito", tamanho: CORPO, alinhar: "direita" });
    y -= 16;
  }
}

function rodapes(doc: DocumentoPDF, id: Identificacao) {
  for (let p = 1; p <= doc.total; p++) {
    doc.texto(M, 18, id.geracao, { tamanho: 6.5, cor: CINZA, pagina: p });
    doc.texto(DIREITA, 18, `Página ${p} de ${doc.total}`, { tamanho: 6.5, cor: CINZA, alinhar: "direita", pagina: p });
  }
}

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const limpar = (nome: string) => nome.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ");

/**
 * O arquivo (Excel ou PDF) com os blocos: uma aba ou um conjunto de páginas por bloco. Também para os cenários. No Excel,
 * `extras` vão no fim (27/10/2026: a aba Detalhes).
 */
export function arquivoDeResultados(bs: Bloco[], id: Identificacao, formato: Formato, titulo: string, nomeArquivo: string, extras: AbaEscrita[] = []) {
  if (formato === "xlsx") return { nomeArquivo, tipo: XLSX, conteudo: gerarXlsx([...bs.map((b) => abaResultados(b, id)), ...extras], titulo), visoes: bs.map((b) => b.nome) };
  const doc = new DocumentoPDF(A4_PAISAGEM);
  for (const b of bs) {
    paginasResultados(doc, b, id);
    // O comparativo (23/11/2026): com o cenário comparado, as páginas dele logo depois das da DRE do bloco.
    if (b.comparado) paginasDoComparado(doc, b, id);
  }
  rodapes(doc, id);
  return { nomeArquivo, tipo: "application/pdf", conteudo: doc.gerar(titulo), visoes: bs.map((b) => b.nome) };
}

/**
 * Um arquivo Excel por centro de custo, num ZIP (14/10/2026): cada um com o departamento e o centro no nome
 * ("Custos de Produção (CP) - ESTRUTURA - Resultados 2026 até 08.xlsx").
 */
export function zipDosCentros(bs: Bloco[], id: Identificacao, sufixo: string, nomeArquivo: string, extras: AbaEscrita[][] = []) {
  const conteudo = zipDeArquivos(
    bs.map((b, i) => ({ nome: `${b.departamento ?? nomeDoDepartamento(null)} - ${b.nome} - ${sufixo}.xlsx`, conteudo: gerarXlsx([abaResultados(b, id), ...(extras[i] ?? [])], `${sufixo} - ${b.nome}`) })),
  );
  return { nomeArquivo: limparNome(nomeArquivo), tipo: TIPO_ZIP, conteudo, visoes: bs.map((b) => b.nome) };
}

export const exportacaoRelatoriosService = {
  /**
   * `detalhes` (27/10/2026): no Excel, a aba Detalhes no fim (num arquivo por centro, em cada um). `comparacao` (16/11/2026):
   * a da tela, para as visões das unidades trazerem as mesmas linhas dela.
   */
  async resultados(ano: number, ate: number | undefined, escopo: EscopoResultados, formato: Formato, usuarioNome: string, acesso: Acesso = ACESSO_TOTAL, detalhes = false, comparacao: ComparacaoDaTela = SEM_COMPARACAO) {
    if (escopo.tipo === "centrosArquivos" && formato !== "xlsx") throw new RelatorioError(400, "Um arquivo por centro de custo só sai em Excel.");
    // Sem `ate`, até o último mês apurado (como na tela).
    const bs = await blocos(ano, ate, escopo.tipo === "centrosArquivos" ? { tipo: "centros" } : escopo, acesso, comparacao);
    if (bs.length === 0) throw new RelatorioError(404, escopo.tipo === "linhas" ? "Nenhuma linha para exportar." : escopo.tipo === "obras" ? "Nenhuma obra com lançamento para exportar." : escopo.tipo === "semCentros" ? "Nenhum movimento sem centro de custo para exportar." : "Nenhum centro de custo com valor para exportar.");
    const ultimo = bs[0].dados.ate;
    const id = await identificar(ano, ultimo, usuarioNome);
    const nomeVisao =
      escopo.tipo === "unidades"
        ? "todas as unidades"
        : escopo.tipo === "centros"
          ? "todos os centros de custo"
          : escopo.tipo === "centrosArquivos"
            ? "centros de custo (um arquivo por centro)"
            : escopo.tipo === "centro"
              ? `${bs[0].departamento} - ${bs[0].nome}`
              : escopo.tipo === "obras"
            ? "todas as obras"
            : escopo.tipo === "semCentros"
              ? "sem centros de custo"
              : escopo.tipo === "semCentro"
                ? `sem centro de custo - ${bs[0].nome}`
                : escopo.tipo === "linhas"
                  ? escopo.rateios
                    ? "rateios das linhas de todas as linhas"
                    : "todas as linhas"
                  : escopo.tipo === "linha" && escopo.rateios
                    ? `rateios das linhas - ${bs[0].nome}`
                    : bs[0].nome;
    const titulo = `Resultados ${ano} - ${nomeVisao}`;
    const nomeArquivo = limpar(`Resultados ${ano} até ${String(ultimo).padStart(2, "0")} - ${nomeVisao}.${formato}`);
    const det = detalhes && formato === "xlsx" ? await detalhesDosResultados(ano, ultimo, acesso) : null;
    if (escopo.tipo === "centrosArquivos") {
      const sufixo = `Resultados ${ano} até ${String(ultimo).padStart(2, "0")}`;
      const extras = det ? await Promise.all(bs.map(async (b) => [await det.aba([abaDetalhada(b)], `${sufixo} - ${b.nome}`)])) : [];
      return zipDosCentros(bs, id, sufixo, nomeArquivo.replace(/\.xlsx$/, ".zip"), extras);
    }
    // Em Todas as Unidades, o Consolidado é a soma das outras cinco: na aba Detalhes, só elas.
    const detalhadas = escopo.tipo === "unidades" ? bs.filter((b) => b.nome !== "Consolidado") : bs;
    const notas = escopo.tipo === "unidades" ? ["O Consolidado é a soma das cinco unidades: os movimentos dele são os delas."] : [];
    const extras = det ? [await det.aba(detalhadas.map(abaDetalhada), titulo, notas)] : [];
    return arquivoDeResultados(bs, id, formato, titulo, nomeArquivo, extras);
  },

  /**
   * `apenasMes`: só o mês `ate` (a etapa Indicadores do Fechamento Mensal), sem os anteriores nem o acumulado.
   * `somenteFechadas`: só as competências fechadas (Resultados Empresariais).
   */
  async indicadores(ano: number, ate: number | undefined, formato: Formato, usuarioNome: string, apenasMes = false, somenteFechadas = false) {
    const todos = await indicadoresService.listar(ano, ate, somenteFechadas);
    const dados = apenasMes ? soOMes(todos) : todos;
    const id = await identificar(ano, dados.ate, usuarioNome);
    const mm = String(dados.ate).padStart(2, "0");
    const titulo = apenasMes ? `Indicadores ${mm}/${ano}` : `Indicadores ${ano}`;
    const nomeArquivo = limpar(apenasMes ? `Indicadores ${ano}-${mm}.${formato}` : `Indicadores ${ano} até ${mm}.${formato}`);
    if (formato === "xlsx") return { nomeArquivo, tipo: XLSX, conteudo: gerarXlsx([abaIndicadores(dados, id, !apenasMes)], titulo), visoes: ["Indicadores"] };
    const doc = new DocumentoPDF(A4_PAISAGEM);
    paginasIndicadores(doc, dados, id, !apenasMes);
    rodapes(doc, id);
    return { nomeArquivo, tipo: "application/pdf", conteudo: doc.gerar(titulo), visoes: ["Indicadores"] };
  },
};

