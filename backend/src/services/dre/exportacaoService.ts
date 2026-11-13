import { getPrismaClient } from "../../config/prisma.js";
import { ESTILO, naCorDaDRE, gerarXlsx, type AbaEscrita, type Celula } from "../../lib/xlsxEscrita.js";
import { limparNome, nomeDoDepartamento, TIPO_ZIP, zipDeArquivos } from "../../lib/arquivosExportados.js";
import { A4, caber, DocumentoPDF, type Cor } from "../../lib/pdfEscrita.js";
import { ACESSO_TOTAL, type Acesso } from "../acesso/acesso.js";
import { apuracaoService } from "../apuracao/apuracaoService.js";
import { dreService, RegraDREError } from "./dreService.js";
import { linhasDoCentro } from "./recorteCentros.js";
import { fundoDaDRE, semPrimeiroTotalDaRol } from "../relatorios/linhasDaDRE.js";
import { obrasService } from "./obrasService.js";
import { semCentroService, type GrupoSemCentro } from "./semCentroService.js";

/**
 * Exportação da DRE apurada em Excel e PDF (Passo 26, RF012). O arquivo
 * reproduz a tela: as mesmas linhas (sem as seções), na mesma ordem, com os
 * totais em destaque e os itens recuados, e os mesmos valores. Identifica a
 * competência, o estado dela, a apuração e quem gerou o arquivo e quando.
 *
 * O recorte é o da consulta: a DRE das unidades e a consolidada são inteiras
 * para todos; a visão por centro de custo só sai com os centros e as linhas
 * que o usuário alcança. Nos centros, como na tela, só os custos e despesas
 * de mão de obra, gastos gerais e depreciação, com os totais somando só o que
 * aparece (linhasDoCentro). Nas obras, a DRE da obra inteira, como na aba
 * Obras (obrasService).
 */

export type VisaoExportacao =
  | { tipo: "consolidado" }
  | { tipo: "unidade"; unidade: number }
  | { tipo: "todas" }
  | { tipo: "centros"; grupo: string }
  /** Todos os centros de custo (agrupamentos) que o usuário alcança, um por aba. */
  | { tipo: "todosCentros" }
  /** Todos os centros de custo, um arquivo Excel por centro, num ZIP (14/10/2026). */
  | { tipo: "centrosArquivos" }
  | { tipo: "obra"; obra: string }
  /** Todas as obras com lançamento no mês, uma por aba. */
  | { tipo: "todasObras" }
  /** Um grupo dos movimentos sem centro de custo, ou todos, um por aba (15/10/2026). */
  | { tipo: "semCentro"; grupo: GrupoSemCentro }
  | { tipo: "todosSemCentros" };
export type Formato = "xlsx" | "pdf";

/** `pct` e `unitario` (13/11/2026): o % e o R$/m³ da tela (participacoesDoMes), em branco quando nulos ou ausentes. */
type LinhaTela = { codigo: string; tipo: string; grupo: string; descricao: string; valor: string | null; pct?: number | null; unitario?: number | null };
type Bloco = { nome: string; titulo: string; complemento?: string; linhas: LinhaTela[]; departamento?: string };

const ROTULO_STATUS: Record<string, string> = { ABERTA: "Aberta", EM_CONFERENCIA: "Em conferência", FECHADA: "Fechada" };
// As linhas de volume (m³ e kg) dos grupos PRODUÇÃO e SERVIÇOS, pelo nome do grupo.
const GRUPOS_DE_VOLUME = new Set(["PRODUÇÃO (P)", "SERVIÇOS (S)"]);
const ehVolume = (l: LinhaTela) => GRUPOS_DE_VOLUME.has(l.grupo);

// Os mesmos formatos da tela (frontend: utils/formatacao.ts e DREContent.tsx).
const fmtMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fmtVolume = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
const fmtPct = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtUnitario = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** O % e o R$/m³ como a tela mostra (em branco sem a coluna ou sem a base). */
const pctTela = (l: LinhaTela) => (l.pct === null || l.pct === undefined ? "" : `${fmtPct.format(l.pct * 100)}%`);
const unitarioTela = (l: LinhaTela) => (l.unitario === null || l.unitario === undefined ? "" : fmtUnitario.format(l.unitario));
/** O valor como a tela mostra. */
const valorTela = (l: LinhaTela) => (l.valor === null ? "—" : ehVolume(l) ? fmtVolume.format(Number(l.valor)) : fmtMoeda.format(Number(l.valor)));
const dataHora = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d).replace(",", "");
const rotulo = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;

/** As DREs a exportar, já com o recorte do usuário. */
async function blocos(ano: number, mes: number, visao: VisaoExportacao, acesso: Acesso): Promise<Bloco[]> {
  const unidades = await getPrismaClient().unidadeNegocio.findMany({ where: { ativo: true }, orderBy: { ordem: "asc" }, select: { codigo: true, nome: true } });
  const nomeDa = (codigo: number) => unidades.find((u) => u.codigo === codigo)?.nome ?? `Unidade ${codigo}`;
  const consolidado = async (): Promise<Bloco> => ({ nome: "Consolidado", titulo: "Consolidado", linhas: (await dreService.consultarConsolidado(ano, mes, acesso)).linhas });
  const unidade = async (codigo: number): Promise<Bloco> => ({ nome: nomeDa(codigo), titulo: nomeDa(codigo), linhas: (await dreService.consultarUnidade(ano, mes, codigo, acesso)).linhas });

  if (visao.tipo === "consolidado") return [await consolidado()];
  if (visao.tipo === "unidade") {
    if (!unidades.some((u) => u.codigo === visao.unidade)) throw new RegraDREError(400, "Unidade inválida.");
    return [await unidade(visao.unidade)];
  }
  if (visao.tipo === "todas") return [await consolidado(), ...(await Promise.all(unidades.map((u) => unidade(u.codigo))))];
  // O departamento de cada centro (o do cadastro; com mais de um, todos), para o nome do arquivo.
  const listaCentros = visao.tipo === "centros" || visao.tipo === "todosCentros" || visao.tipo === "centrosArquivos" ? (await dreService.listarCentros(ano, mes, acesso)).grupos : [];
  const departamento = (g: string) => (listaCentros.find((x) => x.grupo === g)?.departamentos ?? []).map(nomeDoDepartamento).join(" e ") || nomeDoDepartamento(null);
  const centro = async (grupo: string): Promise<Bloco> => {
    const c = await dreService.consultarCentros(ano, mes, grupo, acesso);
    return {
      departamento: departamento(grupo),
      nome: grupo,
      titulo: `Centro de custo: ${grupo}`,
      complemento: c.centros.map((x) => `${x.codigoRM ?? "sem código"} · ${x.nome}`).join("  |  "),
      linhas: linhasDoCentro(c.linhas),
    };
  };
  const obra = async (codigo: string): Promise<Bloco> => {
    const o = await obrasService.consultar(ano, mes, codigo, acesso);
    return { nome: o.obra.nome, titulo: `Obra: ${o.obra.nome}`, complemento: `Centro de custo ${o.obra.codigo}`, linhas: o.linhas };
  };
  const semCentro = async (grupo: GrupoSemCentro): Promise<Bloco> => {
    const s = await semCentroService.consultar(ano, mes, grupo, acesso);
    return { nome: s.grupo.nome, titulo: `Sem centro de custo: ${s.grupo.nome}`, linhas: s.linhas };
  };
  if (visao.tipo === "semCentro") return [await semCentro(visao.grupo)];
  if (visao.tipo === "todosSemCentros") {
    const { grupos } = await semCentroService.listar(ano, mes, acesso);
    return Promise.all(grupos.map((g) => semCentro(g.codigo as GrupoSemCentro)));
  }
  if (visao.tipo === "obra") return [await obra(visao.obra)];
  if (visao.tipo === "todasObras") {
    const { obras } = await obrasService.listar(ano, mes, acesso);
    return Promise.all(obras.map((o) => obra(o.codigo)));
  }
  if (visao.tipo === "centros") return [await centro(visao.grupo)];
  // Todos os agrupamentos que o usuário alcança; os sem custo nem despesa na tela ficam de fora.
  const todos = await Promise.all(listaCentros.map((g) => centro(g.grupo)));
  return todos.filter((b) => b.linhas.length > 0);
}

/** O cabeçalho comum: competência, estado, apuração e geração. */
type Identificacao = { competencia: string; estado: string; apuracao: string; avisos: string[]; geracao: string };

async function identificar(ano: number, mes: number, usuarioNome: string): Promise<Identificacao> {
  const s = await apuracaoService.situacao(ano, mes);
  if (!s.apurada) throw new RegraDREError(409, `A competência ${rotulo(ano, mes)} ainda não foi apurada: não há DRE para exportar.`);
  const avisos: string[] = [];
  if (s.competencia.status !== "FECHADA") avisos.push("Valores provisórios: a competência não está fechada.");
  if (s.mudancas.length) avisos.push("As entradas mudaram depois da apuração; os valores são os da última apuração.");
  return {
    competencia: rotulo(ano, mes),
    estado: ROTULO_STATUS[s.competencia.status] ?? s.competencia.status,
    apuracao: `apurada em ${dataHora(s.apuradaEm!)}${s.apuradaPor ? ` por ${s.apuradaPor}` : ""}${s.competencia.status === "FECHADA" && s.fechadaEm ? ` · fechada em ${dataHora(s.fechadaEm)}${s.fechadaPor ? ` por ${s.fechadaPor}` : ""}` : ""}`,
    avisos,
    geracao: `Gerado em ${dataHora(new Date())} por ${usuarioNome} · SIG BPM`,
  };
}

function abaExcel(b: Bloco, id: Identificacao): AbaEscrita {
  const linhas: Celula[][] = [
    [{ valor: `DRE · ${id.competencia} · ${b.titulo}`, estilo: ESTILO.titulo }],
    [{ valor: `Competência ${id.competencia} · ${id.estado} · ${id.apuracao}`, estilo: ESTILO.informacao }],
    [{ valor: id.geracao, estilo: ESTILO.informacao }],
    ...id.avisos.map((a) => [{ valor: a, estilo: ESTILO.aviso }]),
    ...(b.complemento ? [[{ valor: b.complemento, estilo: ESTILO.informacao }]] : []),
    [],
  ];
  linhas.push([
    { valor: "Linha", estilo: ESTILO.cabecalho },
    { valor: "Valor", estilo: ESTILO.cabecalhoDireita },
    { valor: "%", estilo: ESTILO.cabecalhoDireita },
    { valor: "R$/m³", estilo: ESTILO.cabecalhoDireita },
  ]);
  const cabecalho = linhas.length;
  // Sem o primeiro total da ROL e com os fundos das telas (22/10/2026): os totais em amarelo claro, os resultados mais forte.
  for (const l of semPrimeiroTotalDaRol(b.linhas.filter((x) => x.tipo !== "SECAO"))) {
    const fundo = fundoDaDRE(l);
    const destaque = fundo !== "item";
    const total = (e: Parameters<typeof naCorDaDRE>[0]) => (fundo === "item" ? ESTILO[e] : naCorDaDRE(e, fundo));
    const valor: Celula =
      l.valor === null
        ? { valor: "—", estilo: destaque ? total("destaqueDireita") : ESTILO.itemDireita }
        : { valor: Number(l.valor), estilo: ehVolume(l) ? (destaque ? total("destaqueVolume") : ESTILO.itemVolume) : destaque ? total("destaqueMoeda") : ESTILO.itemMoeda };
    // O % e o R$/m³ (13/11/2026), como na tela: em branco sem a coluna ou sem a base.
    const vazio: Celula = { valor: "", estilo: destaque ? total("destaqueDireita") : ESTILO.itemDireita };
    const pct: Celula = l.pct === null || l.pct === undefined ? vazio : { valor: l.pct, estilo: destaque ? total("destaquePercentual") : ESTILO.itemPercentual };
    const unitario: Celula = l.unitario === null || l.unitario === undefined ? vazio : { valor: l.unitario, estilo: destaque ? total("destaqueNumero") : ESTILO.itemNumero };
    linhas.push([{ valor: l.descricao, estilo: destaque ? total("destaque") : ESTILO.item }, valor, pct, unitario]);
  }
  return { nome: b.nome, larguras: [72, 20, 10, 12], linhas, linhaCabecalho: cabecalho, rodape: `DRE ${id.competencia} · ${b.titulo} · ${id.estado}` };
}

const CINZA: Cor = [75, 85, 99];
const AMBAR: Cor = [146, 64, 14];
const FUNDO: Cor = [243, 244, 246];
/** Os fundos dos totais da DRE (22/10/2026), como nas telas: os totais (yellow-100) e as linhas de resultado (yellow-200). */
const FUNDO_DO_TOTAL: Cor = [254, 249, 195];
const FUNDO_DO_RESULTADO: Cor = [254, 240, 138];
const TRACO: Cor = [156, 163, 175];
const M = 42; // margem lateral
const ALTURA_LINHA = 12.5;
const CORPO = 8.5;

function paginasPdf(doc: DocumentoPDF, b: Bloco, id: Identificacao) {
  const direita = A4.largura - M;
  // As colunas dos números, da direita: o R$/m³, o % e o Valor (13/11/2026: o % e o R$/m³).
  const xUnitario = direita - 4;
  const xPct = xUnitario - 64;
  const xValor = xPct - 54;
  let y = 0;
  const cabecalhoTabela = () => {
    doc.retangulo(M, y - 4, direita - M, ALTURA_LINHA + 2, FUNDO);
    doc.texto(M + 4, y, "Linha", { fonte: "negrito", tamanho: CORPO });
    doc.texto(xValor, y, "Valor", { fonte: "negrito", tamanho: CORPO, alinhar: "direita" });
    doc.texto(xPct, y, "%", { fonte: "negrito", tamanho: CORPO, alinhar: "direita" });
    doc.texto(xUnitario, y, "R$/m³", { fonte: "negrito", tamanho: CORPO, alinhar: "direita" });
    doc.linha(M, y - 4, direita, y - 4, TRACO);
    y -= ALTURA_LINHA + 2;
  };
  const novaPagina = (primeira: boolean) => {
    doc.novaPagina();
    y = A4.altura - 48;
    if (primeira) {
      doc.texto(M, y, `DRE · ${id.competencia} · ${b.titulo}`, { fonte: "negrito", tamanho: 14 });
      y -= 16;
      doc.texto(M, y, caber(`Competência ${id.competencia} · ${id.estado} · ${id.apuracao}`, "normal", CORPO, direita - M), { tamanho: CORPO, cor: CINZA });
      y -= 11;
      for (const a of id.avisos) {
        doc.texto(M, y, a, { tamanho: CORPO, cor: AMBAR });
        y -= 11;
      }
      if (b.complemento) {
        doc.texto(M, y, caber(b.complemento, "normal", CORPO, direita - M), { tamanho: CORPO, cor: CINZA });
        y -= 11;
      }
      y -= 8;
    } else {
      doc.texto(M, y, `DRE · ${id.competencia} · ${b.titulo} (continuação)`, { fonte: "negrito", tamanho: 10 });
      y -= 18;
    }
    cabecalhoTabela();
  };

  novaPagina(true);
  for (const l of semPrimeiroTotalDaRol(b.linhas.filter((x) => x.tipo !== "SECAO"))) {
    if (y < 52) novaPagina(false);
    const fundo = fundoDaDRE(l);
    const destaque = fundo !== "item";
    const fonte = destaque ? "negrito" : "normal";
    if (destaque) doc.retangulo(M, y - 3.5, direita - M, ALTURA_LINHA, fundo === "resultado" ? FUNDO_DO_RESULTADO : FUNDO_DO_TOTAL);
    const valor = valorTela(l);
    const xTexto = destaque ? M + 4 : M + 16;
    doc.texto(xTexto, y, caber(l.descricao, fonte, CORPO, xValor - 90 - xTexto), { fonte, tamanho: CORPO });
    doc.texto(xValor, y, valor, { fonte, tamanho: CORPO, alinhar: "direita" });
    doc.texto(xPct, y, pctTela(l), { fonte, tamanho: CORPO, alinhar: "direita", cor: CINZA });
    doc.texto(xUnitario, y, unitarioTela(l), { fonte, tamanho: CORPO, alinhar: "direita", cor: CINZA });
    y -= ALTURA_LINHA;
  }
}

/** Os rodapés, com o total de páginas, depois de tudo desenhado. */
function rodapes(doc: DocumentoPDF, id: Identificacao) {
  for (let p = 1; p <= doc.total; p++) {
    doc.texto(M, 26, id.geracao, { tamanho: 7, cor: CINZA, pagina: p });
    doc.texto(A4.largura - M, 26, `Página ${p} de ${doc.total}`, { tamanho: 7, cor: CINZA, alinhar: "direita", pagina: p });
  }
}

const nomeDaVisao = (v: VisaoExportacao, b: Bloco[]) =>
  v.tipo === "todas"
    ? "todas as unidades"
    : v.tipo === "todosCentros"
      ? "todos os centros de custo"
      : v.tipo === "centrosArquivos"
        ? "centros de custo (um arquivo por centro)"
        : v.tipo === "centros"
          ? `${b[0].departamento} - ${b[0].nome}`
          : v.tipo === "todasObras"
            ? "todas as obras"
            : v.tipo === "todosSemCentros"
              ? "sem centros de custo"
              : v.tipo === "semCentro"
                ? `sem centro de custo - ${b[0].nome}`
                : b[0].nome;

export const exportacaoService = {
  async exportar(ano: number, mes: number, visao: VisaoExportacao, formato: Formato, usuarioNome: string, acesso: Acesso = ACESSO_TOTAL) {
    const id = await identificar(ano, mes, usuarioNome);
    const bs = await blocos(ano, mes, visao, acesso);
    if (bs.length === 0) {
      throw new RegraDREError(
        404,
        visao.tipo === "todasObras"
          ? "Nenhuma obra com lançamento para exportar."
          : visao.tipo === "todosSemCentros"
            ? "Nenhum movimento sem centro de custo para exportar."
            : "Nenhum centro de custo com custos ou despesas para exportar.",
      );
    }
    const titulo = `DRE ${id.competencia} - ${nomeDaVisao(visao, bs)}`;
    const nomeArquivo = limparNome(`DRE ${ano}-${String(mes).padStart(2, "0")} - ${nomeDaVisao(visao, bs)}.${formato}`);
    // Um arquivo Excel por centro de custo, num ZIP, com o departamento e o centro no nome (14/10/2026).
    if (visao.tipo === "centrosArquivos") {
      if (formato !== "xlsx") throw new RegraDREError(400, "Um arquivo por centro de custo só sai em Excel.");
      const sufixo = `DRE ${ano}-${String(mes).padStart(2, "0")}`;
      const conteudo = zipDeArquivos(bs.map((b) => ({ nome: `${b.departamento} - ${b.nome} - ${sufixo}.xlsx`, conteudo: gerarXlsx([abaExcel(b, id)], `${sufixo} - ${b.nome}`) })));
      return { nomeArquivo: nomeArquivo.replace(/\.xlsx$/, ".zip"), tipo: TIPO_ZIP, conteudo, visoes: bs.map((b) => b.nome) };
    }
    if (formato === "xlsx") {
      return {
        nomeArquivo,
        tipo: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        conteudo: gerarXlsx(bs.map((b) => abaExcel(b, id)), titulo),
        visoes: bs.map((b) => b.nome),
      };
    }
    const doc = new DocumentoPDF();
    for (const b of bs) paginasPdf(doc, b, id);
    rodapes(doc, id);
    return { nomeArquivo, tipo: "application/pdf", conteudo: doc.gerar(titulo), visoes: bs.map((b) => b.nome) };
  },
};
