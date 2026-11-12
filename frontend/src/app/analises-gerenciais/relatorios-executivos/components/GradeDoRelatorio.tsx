"use client";

import { useCallback, useContext, useEffect, useRef, useState, useLayoutEffect } from "react";
import GridLayout, { type Layout } from "react-grid-layout";
import { CalendarDays, ChartColumn, CircleAlert, CirclePlay, ClipboardPaste, Columns2, Copy, Crop, ImagePlus, Redo2, Settings, Sigma, SlidersHorizontal, ThumbsDown, ThumbsUp, Trash2, Undo2, ZoomIn } from "lucide-react";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import { blocoComparado, CardDoPainel, type ComparacaoDoCard, type FormatacaoDoCard, type Cores } from "@/app/relatorios/painel/PainelContent";
import type { ItemPainel } from "@/app/relatorios/services/relatoriosService";
import { SeletorRotulos, SeletorTipoGrafico } from "@/app/relatorios/components/GraficoRealizadoOrcado";
import type { MarcacaoComparavel } from "@/app/relatorios/services/relatoriosService";
import { botaoPrimario, OpcaoEmLinha } from "@/app/cenarios/components/CenarioDialog";
import { valor, valorCurto } from "@/app/relatorios/indicadores/TabelaIndicadores";
import { fatorDaEscalaDa } from "@/app/relatorios/services/relatoriosService";
import type { TipoGrafico } from "@/app/relatorios/components/GraficoRealizadoOrcado";

import { enderecoDaFoto, type Bloco, type DadosDoRelatorio, type Fundo, type Nota, type PeriodosDoCard, type TelaDoSumario } from "../services/relatoriosExecutivosService";
import { AjustesDaImagemDialog, ImagemComMoldura } from "./AjustesDaImagem";
import { CortarImagemDialog, type CorteDaImagem } from "./CortarImagem";
import { CamadaDoFundo } from "./FundoDoSlide";
import { NaTelaPadrao, TELA_PADRAO } from "./TelaPadrao";
import { BarraDoSumario, ConfigurarSumarioDialog, ListaDoSumario } from "./SumarioDoRelatorio";
import { alturaDaLinha, BarraDeTexto, familiaDa, TAMANHO_DO_TITULO, TextoRico } from "./TextoRico";
import { estadoDoPlayer, irPara, pausarPlayer, PlayerDoVideo } from "./PlayerDoVideo";
import { videoDoLink } from "./videoIncorporado";
import { ConfigurarTabelaDialog, TabelaDoBloco } from "./TabelaDoRelatorio";
import { guardarCopia, textoDoBloco, TIPO_DA_COPIA, type Copia } from "./copiarColar";
import { useProcesso } from "./processo";
import { comCor, corDosCardsPadrao, ehProva, temProva } from "./cenariosDoProva";


/** A grade: 12 colunas, linhas de 24 px, 12 px entre os blocos. */
export const COLUNAS = 12;
const ALTURA_DA_LINHA = 24;
const MARGEM = 12;

/**
 * O gráfico dos cards (22/10/2026): os meses e o acumulado, só o acumulado ou nenhum. O ícone do gráfico passa de um ao
 * outro, nessa ordem, e o card muda de largura na proporção: os valores são 2 partes, o gráfico dos meses e do acumulado
 * mais 3, e o só do acumulado mais 1.
 */
export type ModoDoGrafico = "MESES" | "ACUMULADO" | "NENHUM";
export function modoDoGrafico(b: Pick<Bloco, "tipo"> & { comGrafico?: boolean; soAcumulado?: boolean; grafico?: "MESES" | "ACUMULADO" }): ModoDoGrafico {
  if (b.tipo === "PAINEL") return !b.comGrafico ? "NENHUM" : b.soAcumulado ? "ACUMULADO" : "MESES";
  if (b.tipo === "INDICADOR") return b.grafico ?? "NENHUM";
  return "NENHUM";
}
/** As partes do gráfico na largura do card: o dos meses e do acumulado, 3; o só do acumulado, 1. */
const PARTES_DO_GRAFICO: Record<ModoDoGrafico, number> = { MESES: 3, ACUMULADO: 1, NENHUM: 0 };
const PROXIMO: Record<ModoDoGrafico, ModoDoGrafico> = { MESES: "ACUMULADO", ACUMULADO: "NENHUM", NENHUM: "MESES" };

/**
 * Os dados do card antes do gráfico (12/11/2026, pedido do Adão): o Atual e o Acumulado, só o Atual ou só o Acumulado. O
 * ícone dos dados passa de um ao outro, nessa ordem, e o card muda de largura na proporção, como no gráfico: os dois
 * valores são 2 partes, um só, 1.
 */
export type DadosDoCard = "AMBOS" | PeriodosDoCard;
export const dadosDoCard = (b: { periodos?: PeriodosDoCard }): DadosDoCard => b.periodos ?? "AMBOS";
const PROXIMOS_DADOS: Record<DadosDoCard, DadosDoCard> = { AMBOS: "ATUAL", ATUAL: "ACUMULADO", ACUMULADO: "AMBOS" };
/** As partes do card: as dos valores (2, ou 1 com um período só) e as do gráfico. */
const partesDoCard = (modo: ModoDoGrafico, dados: DadosDoCard) => (dados === "AMBOS" ? 2 : 1) + PARTES_DO_GRAFICO[modo];

/** A largura mínima dos cards em cada modo do gráfico, com os dois valores e com um só (12/11/2026). */
const MINIMO: Record<"PAINEL" | "INDICADOR", Record<ModoDoGrafico, number>> = {
  PAINEL: { MESES: 10, ACUMULADO: 6, NENHUM: 5 },
  // O card de indicador é o card do Painel (22/10/2026): as mesmas larguras.
  INDICADOR: { MESES: 10, ACUMULADO: 6, NENHUM: 5 },
};
const MINIMO_COM_UM_PERIODO: Record<ModoDoGrafico, number> = { MESES: 8, ACUMULADO: 4, NENHUM: 3 };
const minimoDoCard = (tipo: "PAINEL" | "INDICADOR", modo: ModoDoGrafico, dados: DadosDoCard) => (dados === "AMBOS" ? MINIMO[tipo][modo] : MINIMO_COM_UM_PERIODO[modo]);
/** A largura do card de `antes` partes com `depois` partes, entre o mínimo e a grade. */
const larguraNaProporcao = (w: number, antes: number, depois: number, minimo: number) => Math.min(COLUNAS, Math.max(minimo, Math.round((w * depois) / antes)));

/** O próximo modo do gráfico do card e a largura dele nesse modo (na proporção das partes, entre o mínimo e a grade). */
function proximoGrafico(b: Extract<Bloco, { tipo: "PAINEL" | "INDICADOR" }>): Partial<Bloco> {
  const atual = modoDoGrafico(b);
  const novo = PROXIMO[atual];
  const dados = dadosDoCard(b);
  const w = larguraNaProporcao(b.w, partesDoCard(atual, dados), partesDoCard(novo, dados), minimoDoCard(b.tipo, novo, dados));
  return (b.tipo === "PAINEL" ? { comGrafico: novo !== "NENHUM", soAcumulado: novo === "ACUMULADO", w } : { grafico: novo === "NENHUM" ? undefined : novo, w }) as Partial<Bloco>;
}
/** Os próximos dados do card (12/11/2026) e a largura dele com eles (na proporção das partes, entre o mínimo e a grade). */
function proximosDados(b: Extract<Bloco, { tipo: "PAINEL" | "INDICADOR" }>): Partial<Bloco> {
  const modo = modoDoGrafico(b);
  const atual = dadosDoCard(b);
  const novo = PROXIMOS_DADOS[atual];
  const w = larguraNaProporcao(b.w, partesDoCard(modo, atual), partesDoCard(modo, novo), minimoDoCard(b.tipo, modo, novo));
  return { periodos: novo === "AMBOS" ? undefined : novo, w } as Partial<Bloco>;
}

/** O tamanho inicial de cada tipo de bloco (colunas × linhas); o card do Painel sem o gráfico, 2/5 dele com o gráfico. */
export function tamanhoInicial(b: Pick<Bloco, "tipo"> & { comGrafico?: boolean; grafico?: "MESES" | "ACUMULADO" }) {
  if (b.tipo === "PAINEL") return b.comGrafico ? { w: 12, h: 9 } : { w: 5, h: 9 };
  // O card de indicador, como o do Painel (22/10/2026).
  if (b.tipo === "INDICADOR") return b.grafico ? { w: 12, h: 9 } : { w: 5, h: 9 };
  if (b.tipo === "FOTO") return { w: 4, h: 6 };
  if (b.tipo === "VIDEO") return { w: 6, h: 8 };
  if (b.tipo === "TEXTO") return { w: 6, h: 3 };
  if (b.tipo === "SUMARIO") return { w: 6, h: 10 };
  // A tabela de Resultados (22/10/2026): a largura da página.
  if (b.tipo === "TABELA") return { w: 12, h: 16 };
  return { w: 6, h: 6 };
}

/**
 * A altura mínima dos cards: 6 linhas; nos cards PROVA (31/10/2026), com uma linha por cenário da Comparação PROVA
 * embaixo dos valores, 7 com três cenários e 8 com quatro.
 */
const alturaMinimaDoCard = (b: Extract<Bloco, { tipo: "PAINEL" | "INDICADOR" }>, cenariosProva: number) => (ehProva(b) ? Math.max(6, cenariosProva + 4) : 6);

/**
 * O tamanho mínimo de cada tipo de bloco (16/10/2026), para as informações não se amontoarem; `largura`, a da grade;
 * `cenariosProva`, os da Comparação PROVA do relatório.
 */
function tamanhoMinimo(b: Bloco, largura: number, cenariosProva: number) {
  if (b.tipo === "PAINEL" || b.tipo === "INDICADOR") return { minW: minimoDoCard(b.tipo, modoDoGrafico(b), dadosDoCard(b)), minH: alturaMinimaDoCard(b, cenariosProva) };
  // A Imagem Livre (22/10/2026) diminui até duas linhas de altura ou uma coluna de largura, o que vier antes (a altura
  // acompanha a largura, na proporção da imagem); a com legenda, até 2 × 2.
  if (b.tipo === "FOTO" && b.recorte) return { minW: 2, minH: 2 };
  if (b.tipo === "FOTO" && b.livre) {
    const minW = Array.from({ length: COLUNAS }, (_, k) => k + 1).find((w) => linhasSemMinimo(w, b.proporcao, largura) >= 2) ?? COLUNAS;
    return { minW, minH: linhasDaFoto(minW, b.proporcao, largura, true) };
  }
  if (b.tipo === "FOTO") return { minW: 2, minH: 2 };
  if (b.tipo === "VIDEO") return { minW: 3, minH: 3 };
  // O Texto Livre baixa até uma linha; o Sumário, até duas (20/10/2026).
  if (b.tipo === "TEXTO") return { minW: 2, minH: 1 };
  if (b.tipo === "SUMARIO") return { minW: 3, minH: 2 };
  if (b.tipo === "TABELA") return { minW: 3, minH: 3 };
  // A anotação baixa a ponto de mostrar uma linha só do texto (16/10/2026).
  return { minW: 3, minH: 2 };
}

/**
 * A grade no fundo, ao mover ou redimensionar (16/10/2026): as células das colunas e das linhas, bem claras, desenhadas
 * por uma máscara (o SVG de uma célula, repetido) sobre o cinza do tema.
 */
function GradeDeFundo({ largura }: { largura: number }) {
  const coluna = (largura - MARGEM * (COLUNAS - 1) - MARGEM * 2) / COLUNAS;
  const celula = `<svg xmlns="http://www.w3.org/2000/svg" width="${coluna + MARGEM}" height="${ALTURA_DA_LINHA + MARGEM}"><rect width="${coluna}" height="${ALTURA_DA_LINHA}" rx="2"/></svg>`;
  const mascara = `url("data:image/svg+xml,${encodeURIComponent(celula)}")`;
  const tamanho = `${coluna + MARGEM}px ${ALTURA_DA_LINHA + MARGEM}px`;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 bg-gray-200/60"
      style={{ maskImage: mascara, WebkitMaskImage: mascara, maskSize: tamanho, WebkitMaskSize: tamanho, maskPosition: `${MARGEM}px ${MARGEM}px`, WebkitMaskPosition: `${MARGEM}px ${MARGEM}px` }}
    />
  );
}

/**
 * As linhas de uma página (16/10/2026): só o espaço útil da tela padrão, onde a apresentação a mostra — a altura dela,
 * menos o topo do slide (24 px de margem, o título em 40 px e 16 px abaixo dele) e a margem de baixo (24 px).
 */
export function linhasDaPagina() {
  const grade = TELA_PADRAO.altura - 24 - 40 - 16 - 24;
  // A grade: 12 px em cima e embaixo, e cada linha com 12 px entre elas.
  return Math.max(8, Math.floor((grade - MARGEM) / (ALTURA_DA_LINHA + MARGEM)));
}

/**
 * A largura da grade do slide (22/10/2026): a da apresentação — a tela inteira menos as margens de 32 px, mais os 12 px de
 * cada lado da grade. A grade tem sempre essa largura; na edição, o slide inteiro se reduz na mesma proporção para caber
 * na tela, e sai igual na apresentação (antes, a grade tinha a largura da área da tela e as linhas, a mesma altura: na tela
 * inteira, os blocos ficavam mais largos e mais baixos, e a imagem, na proporção dela, mais estreita que a legenda).
 */
export function larguraDoSlide() {
  // A da tela padrão (27/10/2026; antes, a da tela de quem abria).
  return TELA_PADRAO.largura - 64 + 24;
}

/** O card do Painel sem o gráfico fica com 2/5 da largura (as duas colunas dos valores, do mesmo tamanho); com ele, 5/2. */
const LARGURA_SEM_GRAFICO = 2 / 5;

/** A altura da legenda da foto (o destaque e o espaço acima dele), em px. */
const ALTURA_DA_LEGENDA = 44;

/**
 * As linhas de uma foto com `w` colunas na grade de `largura` px (16/10/2026): a altura da foto na proporção dela, mais a
 * legenda — a foto aumenta e diminui sempre na mesma proporção.
 */
export function linhasDaFoto(w: number, proporcao: number, largura: number, semLegenda = false) {
  // A Imagem Livre (21/10/2026) não tem a legenda: a altura é só a da imagem.
  return Math.max(2, linhasSemMinimo(w, proporcao, largura, semLegenda ? 0 : ALTURA_DA_LEGENDA));
}

/**
 * As linhas para um texto colado (24/10/2026) caber num bloco de `w` colunas: uma estimativa pelo número de letras (a fonte
 * padrão, de 14 px: uns 7,5 px por letra e 20 px por linha), mais `extra` px (o título da anotação), até a altura da página.
 */
export function linhasDoTexto(texto: string, w: number, extra = 0) {
  const coluna = (larguraDoSlide() - MARGEM * (COLUNAS - 1) - MARGEM * 2) / COLUNAS;
  const porLinha = Math.max(10, Math.floor((coluna * w + MARGEM * (w - 1) - 32) / 7.5));
  const linhas = texto.split("\n").reduce((n, p) => n + Math.max(1, Math.ceil(p.length / porLinha)), 0);
  return Math.max(2, Math.min(linhasDaPagina(), Math.round((linhas * 20 + 24 + extra + MARGEM) / (ALTURA_DA_LINHA + MARGEM))));
}

/**
 * O lugar do bloco colado (24/10/2026): o mais perto de (x0, y0) em que ele cabe na página sem encobrir outro bloco; sem
 * nenhum, embaixo do último, na coluna de origem.
 */
export function lugarLivre(blocos: Array<Pick<Bloco, "x" | "y" | "w" | "h">>, w: number, h: number, x0: number, y0: number, linhas: number) {
  const livre = (x: number, y: number) => blocos.every((b) => x >= b.x + b.w || b.x >= x + w || y >= b.y + b.h || b.y >= y + h);
  let melhor: { x: number; y: number; d: number } | null = null;
  for (let y = 0; y + h <= linhas; y++)
    for (let x = 0; x + w <= COLUNAS; x++) {
      const d = Math.abs(y - y0) * 2 + Math.abs(x - x0);
      if ((!melhor || d < melhor.d) && livre(x, y)) melhor = { x, y, d };
    }
  return melhor ? { x: melhor.x, y: melhor.y } : { x: Math.max(0, Math.min(x0, COLUNAS - w)), y: blocos.reduce((m, b) => Math.max(m, b.y + b.h), 0) };
}

/** O foco num texto em edição: o texto formatado, o título da anotação ou outro campo. */
export function escrevendoAgora() {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

/** As linhas da imagem com `w` colunas, na proporção dela (mais `extra` px), sem o mínimo de duas. */
function linhasSemMinimo(w: number, proporcao: number, largura: number, extra = 0) {
  const coluna = (largura - MARGEM * (COLUNAS - 1) - MARGEM * 2) / COLUNAS;
  const alto = (coluna * w + MARGEM * (w - 1)) / proporcao + extra;
  return Math.round((alto + MARGEM) / (ALTURA_DA_LINHA + MARGEM));
}

/**
 * O bloco se redimensiona na proporção (20/10/2026): a foto, o vídeo do computador e o do YouTube (o player tem a proporção
 * do vídeo); os vídeos do Instagram, do Facebook e do LinkedIn (a publicação, com o texto dela), livres.
 */
const naProporcao = (b: Bloco | undefined): b is Extract<Bloco, { tipo: "FOTO" | "VIDEO" }> =>
  // A imagem cortada (27/10/2026) tem o quadro livre: a imagem cobre o tamanho que ele tiver.
  (b?.tipo === "FOTO" && !b.recorte) || (b?.tipo === "VIDEO" && (b.origem === "ARQUIVO" || !!videoDoLink(b.url)?.comandos));

/**
 * As medidas, em px da tela padrão, do quadro da imagem de um bloco de `w` × `h` (27/10/2026, o Cortar e Posicionar): a
 * largura das colunas e a altura das linhas, menos a legenda (na Imagem com Legenda).
 */
export function quadroDaImagem(w: number, h: number, livre: boolean) {
  const coluna = (larguraDoSlide() - MARGEM * (COLUNAS - 1) - MARGEM * 2) / COLUNAS;
  return { largura: coluna * w + MARGEM * (w - 1), altura: Math.max(1, (ALTURA_DA_LINHA + MARGEM) * h - MARGEM - (livre ? 0 : ALTURA_DA_LEGENDA)) };
}

/**
 * Os quadrados de ancoragem do bloco escolhido (24/10/2026, como no Canva): os quatro cantos e o meio dos lados; nos
 * blocos na proporção (a foto e os vídeos), só os cantos — a altura acompanha a largura.
 */
type Alca = "s" | "w" | "e" | "n" | "sw" | "nw" | "se" | "ne";
const TODAS_AS_ALCAS: Alca[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const CANTOS: Alca[] = ["nw", "ne", "se", "sw"];

/**
 * O desenho dos quadrados de ancoragem e da borda do bloco escolhido (24/10/2026). As medidas se dividem pela escala do
 * slide na edição (--escala), para os quadrados terem o mesmo tamanho na tela em qualquer largura.
 */
const ESTILO_DA_EDICAO = `
.grade-do-relatorio .react-grid-item > .ancora-do-bloco {
  width: calc(10px / var(--escala, 1)) !important; height: calc(10px / var(--escala, 1)) !important;
  padding: 0 !important; margin: 0 !important; transform: none !important; box-sizing: border-box;
  background: var(--background) !important; background-image: none !important;
  border: calc(2px / var(--escala, 1)) solid var(--color-sky-600); border-radius: calc(2px / var(--escala, 1)); z-index: 30;
}
.grade-do-relatorio .react-grid-item > .ancora-do-bloco::after { display: none !important; }
.grade-do-relatorio .ancora-do-bloco.react-resizable-handle-nw { top: calc(-6px / var(--escala, 1)) !important; left: calc(-6px / var(--escala, 1)) !important; cursor: nwse-resize; }
.grade-do-relatorio .ancora-do-bloco.react-resizable-handle-ne { top: calc(-6px / var(--escala, 1)) !important; right: calc(-6px / var(--escala, 1)) !important; left: auto !important; cursor: nesw-resize; }
.grade-do-relatorio .ancora-do-bloco.react-resizable-handle-se { bottom: calc(-6px / var(--escala, 1)) !important; right: calc(-6px / var(--escala, 1)) !important; cursor: nwse-resize; }
.grade-do-relatorio .ancora-do-bloco.react-resizable-handle-sw { bottom: calc(-6px / var(--escala, 1)) !important; left: calc(-6px / var(--escala, 1)) !important; cursor: nesw-resize; }
.grade-do-relatorio .ancora-do-bloco.react-resizable-handle-n { top: calc(-6px / var(--escala, 1)) !important; left: calc(50% - 5px / var(--escala, 1)) !important; cursor: ns-resize; }
.grade-do-relatorio .ancora-do-bloco.react-resizable-handle-s { bottom: calc(-6px / var(--escala, 1)) !important; left: calc(50% - 5px / var(--escala, 1)) !important; cursor: ns-resize; }
.grade-do-relatorio .ancora-do-bloco.react-resizable-handle-e { right: calc(-6px / var(--escala, 1)) !important; top: calc(50% - 5px / var(--escala, 1)) !important; cursor: ew-resize; }
.grade-do-relatorio .ancora-do-bloco.react-resizable-handle-w { left: calc(-6px / var(--escala, 1)) !important; top: calc(50% - 5px / var(--escala, 1)) !important; cursor: ew-resize; }
.grade-do-relatorio.em-ajuste .react-grid-item { pointer-events: none; }
.grade-do-relatorio .react-grid-item.react-draggable-dragging, .grade-do-relatorio .react-grid-item.resizing { z-index: 40 !important; }
`;

/**
 * O cursor durante o ajuste (24/10/2026): mover ou o eixo do quadrado de ancoragem. Enquanto um bloco se move ou se
 * redimensiona, os outros não respondem ao mouse (.em-ajuste): antes, o mouse escapava da borda fina do arrastado e passava
 * sobre eles, que piscavam (o contorno tracejado e o bloco por cima do arrastado).
 */
const CURSOR_DA_ALCA: Record<string, string> = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize" };

/** Os blocos que `fixo` encobre descem para logo abaixo dele; e os que esses encobrem, para baixo deles (em cascata). */
function empurrar(l: Layout[], fixo: Layout) {
  const encobre = (a: Layout, b: Layout) => a.i !== b.i && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const fila = [fixo];
  for (let k = 0; k < fila.length; k++) {
    const de = fila[k];
    for (const b of l) {
      if (b.i === fixo.i || !encobre(de, b)) continue;
      b.y = de.y + de.h;
      fila.push(b);
    }
  }
}

/** As faixas da borda do bloco escolhido que o movem ao arrastar (por cima da linha de destaque, 8 px na tela). */
const FAIXAS_DA_BORDA: Array<{ lado: string; estilo: React.CSSProperties }> = [
  { lado: "cima", estilo: { left: 0, right: 0, top: "calc(-6px / var(--escala, 1))", height: "calc(8px / var(--escala, 1))" } },
  { lado: "baixo", estilo: { left: 0, right: 0, bottom: "calc(-6px / var(--escala, 1))", height: "calc(8px / var(--escala, 1))" } },
  { lado: "esquerda", estilo: { top: 0, bottom: 0, left: "calc(-6px / var(--escala, 1))", width: "calc(8px / var(--escala, 1))" } },
  { lado: "direita", estilo: { top: 0, bottom: 0, right: "calc(-6px / var(--escala, 1))", width: "calc(8px / var(--escala, 1))" } },
];

/** O nome do bloco escolhido, na dica da borda dele. */
function nomeDoBloco(b: Bloco) {
  if (b.tipo === "PAINEL") return ehProva(b) ? "Card PROVA do Painel de Bordo" : "Card do Painel de Bordo";
  if (b.tipo === "INDICADOR") return ehProva(b) ? "Card PROVA de Indicador" : "Card de Indicador";
  if (b.tipo === "ANOTACAO") return "Anotação";
  if (b.tipo === "TEXTO") return "Texto Livre";
  if (b.tipo === "SUMARIO") return "Sumário";
  if (b.tipo === "TABELA") return ehProva(b) ? "Tabela PROVA" : "Tabela Padrão";
  if (b.tipo === "VIDEO") return "Vídeo";
  return b.livre ? "Imagem Livre" : "Imagem com Legenda";
}

/** O campo de texto de quando nenhum bloco com texto está escolhido (estável, para a barra do texto). */
const semCampo = () => null;

/** O ícone dos dados do card (12/11/2026): os de agora e, na dica, os próximos. */
function BotaoDosDados({ dados, botao, onClicar }: { dados: DadosDoCard; botao: string; onClicar: () => void }) {
  const AGORA: Record<DadosDoCard, string> = { AMBOS: "Atual e Acumulado", ATUAL: "Apenas o Atual", ACUMULADO: "Apenas o Acumulado" };
  const PROXIMA: Record<DadosDoCard, string> = { AMBOS: "clique para mostrar apenas o Atual", ATUAL: "clique para mostrar apenas o Acumulado", ACUMULADO: "clique para mostrar o Atual e o Acumulado" };
  const dica = `Dados do card: ${AGORA[dados]}; ${PROXIMA[dados]}`;
  const Icone = dados === "ATUAL" ? CalendarDays : dados === "ACUMULADO" ? Sigma : Columns2;
  return (
    <button type="button" className={`${botao} ${dados === "AMBOS" ? "" : "text-gray-900"}`} title={dica} aria-label={dica} onClick={onClicar}>
      <Icone className="size-4" />
    </button>
  );
}

/** O ícone do gráfico do card (22/10/2026): o modo de agora e, na dica, o próximo. */
function BotaoDoGrafico({ modo, botao, onClicar }: { modo: ModoDoGrafico; botao: string; onClicar: () => void }) {
  const AGORA: Record<ModoDoGrafico, string> = { MESES: "Gráfico dos meses e do acumulado", ACUMULADO: "Gráfico só do acumulado", NENHUM: "Sem gráfico" };
  const PROXIMA: Record<ModoDoGrafico, string> = { MESES: "clique para mostrar só o acumulado", ACUMULADO: "clique para tirar o gráfico", NENHUM: "clique para mostrar os meses e o acumulado" };
  const dica = `${AGORA[modo]}: ${PROXIMA[modo]}`;
  return (
    <button type="button" className={`relative ${botao} ${modo === "NENHUM" ? "" : "text-gray-900"}`} title={dica} aria-label={dica} onClick={onClicar}>
      <ChartColumn className="size-4" />
      {modo === "NENHUM" ? <span className="absolute h-px w-4 rotate-45 bg-current" /> : null}
      {modo === "ACUMULADO" ? <span className="absolute right-0 bottom-0 text-[8px] leading-none font-bold">A</span> : null}
    </button>
  );
}

/**
 * As notas das anotações (15/10/2026): o ícone e as cores, no padrão do Painel de Bordo — positivo em verde (azul com a
 * Acessibilidade Daltonismo, do menu do usuário), negativo em vermelho e atenção em laranja. O rótulo é o título da anotação até alguém o mudar.
 */
export const NOTAS: Record<Nota, { rotulo: string; Icone: typeof ThumbsUp; classe: (cores: Cores) => string; icone: (cores: Cores) => string }> = {
  POSITIVO: {
    rotulo: "Positivo",
    Icone: ThumbsUp,
    classe: (c) => (c === "daltonismo" ? "border-l-blue-600" : "border-l-green-500"),
    icone: (c) => (c === "daltonismo" ? "text-blue-700" : "text-green-600"),
  },
  // O vermelho mais escuro e o laranja (16/10/2026; antes, o amarelo, perto do amarelo-ouro da BPM).
  // O ícone e o título negativos (17/10/2026): no Escuro, o mesmo vermelho do destaque e do texto (--cor-nota-negativa).
  NEGATIVO: { rotulo: "Negativo", Icone: ThumbsDown, classe: () => "border-l-red-700", icone: () => "text-[var(--cor-nota-negativa)]" },
  ATENCAO: { rotulo: "Atenção", Icone: CircleAlert, classe: () => "border-l-orange-500", icone: () => "text-orange-600" },
};

/**
 * A grade do relatório (15/10/2026): os blocos de uma aba — os cards do Painel de Bordo (com ou sem o gráfico), os
 * cards dos Indicadores (o destaque, como nas Listas), as anotações, as fotos e os vídeos (20/10/2026). Na edição, cada bloco se move pela alça,
 * se redimensiona pelo canto (até o tamanho mínimo do tipo; a foto, na proporção dela) e tem os botões dele (com ou sem
 * gráfico, as opções do gráfico, a nota da anotação, excluir).
 */
export function GradeDoRelatorio({
  relatorioId,
  blocos,
  dados,
  editavel,
  cores,
  tipo,
  linhas,
  ampliavel = false,
  sumario = [],
  fundo,
  onCarregarImagem,
  onEscolherVideo,
  paraImagem = false,
  desfazer,
  refazer,
  colar,
  escolher,
  onMudar,
}: {
  relatorioId: string;
  /** O Desfazer e o Refazer do menu da edição (24/10/2026); sem eles, quase apagados. */
  desfazer?: () => void;
  refazer?: () => void;
  /** O Colar do menu da edição (24/10/2026: o bloco copiado); sem ele, quase apagado. */
  colar?: () => void;
  /** O bloco a escolher (24/10/2026: o colado ou o adicionado); um objeto novo a cada vez. `cortar` (27/10/2026): a imagem adicionada abre o Cortar e Posicionar. */
  escolher?: { id: string; cortar?: boolean };
  /** Na imagem do slide (22/10/2026: a exportação em PDF): os vídeos como quadros com o ícone. */
  paraImagem?: boolean;
  /** As telas e os slides do relatório, com os números (20/10/2026), para os blocos de Sumário. */
  sumario?: TelaDoSumario[];
  /** A Imagem de Fundo da página (20/10/2026), atrás dos blocos (na edição; a apresentação a põe no slide inteiro). */
  fundo?: Fundo;
  /** O vídeo de um quadro de vídeo vazio (20/10/2026): abre o Adicionar Vídeo para ele. */
  onEscolherVideo?: (id: string) => void;
  /** A imagem escolhida para um quadro de foto vazio (17/10/2026). */
  onCarregarImagem?: (id: string, arquivo: File) => void;
  /** As linhas da página: os blocos não passam delas, e a página tem essa altura (o espaço útil da tela inteira). */
  linhas: number;
  /** Na apresentação (16/10/2026): o bloco se destaca sob o mouse e, clicado, se amplia na tela, com o fundo escurecido. */
  ampliavel?: boolean;
  blocos: Bloco[];
  dados: DadosDoRelatorio | undefined;
  editavel: boolean;
  cores: Cores;
  tipo: TipoGrafico;
  onMudar: (blocos: Bloco[]) => void;
}) {
  const { rota } = useProcesso();
  const [configurando, setConfigurando] = useState<string | null>(null);
  // A imagem no Cortar e Posicionar (27/10/2026).
  const [cortando, setCortando] = useState<string | null>(() => (escolher?.cortar ? escolher.id : null));
  // O slide na largura da tela inteira (caixa) e a escala dele no espaço da tela (area): 1 na apresentação, menor na edição.
  const LARGURA = larguraDoSlide();
  const area = useRef<HTMLDivElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const alturaDaPagina = linhas * (ALTURA_DA_LINHA + MARGEM) + MARGEM;
  const [escala, setEscala] = useState(1);
  const [alturaDoSlide, setAlturaDoSlide] = useState(alturaDaPagina);
  useLayoutEffect(() => {
    const a = area.current;
    const c = caixa.current;
    if (!a || !c) return;
    const medir = () => {
      setEscala(a.clientWidth / LARGURA || 1);
      setAlturaDoSlide(c.offsetHeight);
    };
    const obs = new ResizeObserver(medir);
    obs.observe(a);
    obs.observe(c);
    return () => obs.disconnect();
  }, [LARGURA]);
  // Os campos de texto formatado dos blocos (anotações e legendas), para a barra de formatação do menu da edição.
  const campos = useRef(new Map<string, HTMLElement>());
  // O bloco escolhido na edição (24/10/2026, como no Canva): o clique o destaca, com os quadrados de ancoragem para
  // redimensionar e a borda para mover; o menu único, no alto, mostra as opções dele. Um clique fora dos blocos ou o Esc
  // o soltam; o Delete (fora de um texto) o exclui.
  const [selecionado, setSelecionado] = useState<string | null>(() => escolher?.id ?? null);
  // O bloco a escolher que chegou (o colado ou o adicionado) passa a ser o escolhido.
  const [escolherVisto, setEscolherVisto] = useState(escolher);
  if (escolher !== escolherVisto) {
    setEscolherVisto(escolher);
    if (escolher) setSelecionado(escolher.id);
    if (escolher?.cortar) setCortando(escolher.id);
  }
  const escolhido = editavel ? blocos.find((b) => b.id === selecionado) : undefined;
  // Num slide com blocos PROVA (31/10/2026: os cards e as tabelas), os cards e as tabelas padrão na cor do cenário de comparação.
  const corDoOrcado = corDosCardsPadrao(blocos, dados);
  const comparadaProva = temProva(blocos) ? (dados?.prova.marcacaoComparada ?? null) : null;
  const campoDoEscolhido = useCallback(() => (selecionado ? (campos.current.get(selecionado) ?? null) : null), [selecionado]);
  const excluir = (id: string) => {
    onMudar(blocos.filter((x) => x.id !== id));
    setSelecionado(null);
  };
  useEffect(() => {
    if (!editavel || !selecionado) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (document.querySelector("[role=dialog]")) return;
      const el = document.activeElement as HTMLElement | null;
      const escrevendo = !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
      if (e.key === "Escape") {
        if (escrevendo) el!.blur();
        setSelecionado(null);
      } else if (e.key === "Delete" && !escrevendo) {
        e.preventDefault();
        excluir(selecionado);
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  });
  // Copiar e recortar (24/10/2026): com um bloco escolhido, o Ctrl+C o copia (o Ctrl+X o recorta), fora de um texto em
  // edição ou nele sem nenhum trecho selecionado (com o trecho, vale a cópia do texto; o Ctrl+X, só fora dos textos). O
  // botão Copiar do menu copia o bloco sempre.
  const peloBotao = useRef(false);
  const copiarBloco = (e: ClipboardEvent | null, b: Bloco) => {
    // O texto vai junto (o do bloco; sem ele, o nome do bloco): é o que outro programa recebe.
    const copia: Copia = { relatorioId, processo: rota, blocos: [b], texto: textoDoBloco(b) || nomeDoBloco(b), em: Date.now() };
    e?.clipboardData?.setData(TIPO_DA_COPIA, JSON.stringify(copia));
    e?.clipboardData?.setData("text/plain", copia.texto ?? "");
    guardarCopia(copia);
  };
  useEffect(() => {
    if (!editavel) return;
    const aoCopiar = (e: ClipboardEvent) => {
      const b = blocos.find((x) => x.id === selecionado);
      if (!b || (document.querySelector("[role=dialog]") && !peloBotao.current)) return;
      const el = document.activeElement;
      const comTrecho = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.selectionStart !== el.selectionEnd : !window.getSelection()?.isCollapsed;
      if (!peloBotao.current && (comTrecho || (e.type === "cut" && escrevendoAgora()))) return;
      e.preventDefault();
      copiarBloco(e, b);
      if (e.type === "cut") excluir(b.id);
    };
    document.addEventListener("copy", aoCopiar);
    document.addEventListener("cut", aoCopiar);
    return () => {
      document.removeEventListener("copy", aoCopiar);
      document.removeEventListener("cut", aoCopiar);
    };
  });
  const copiar = escolhido
    ? () => {
        peloBotao.current = true;
        const foi = document.execCommand("copy");
        peloBotao.current = false;
        if (!foi) copiarBloco(null, escolhido);
      }
    : undefined;
  // A largura da grade (para a grade de fundo) e o cursor enquanto um bloco se move ou se redimensiona; fora disso, null.
  const [ajustando, setAjustando] = useState<{ largura: number; cursor: string } | null>(null);
  const comecar = (cursor = "move") => setAjustando(caixa.current ? { largura: caixa.current.offsetWidth, cursor } : null);
  const comecarRedimensionar = (_l: Layout[], _a: Layout, _n: Layout, _p: Layout, _e: MouseEvent, alca: HTMLElement) =>
    comecar(CURSOR_DA_ALCA[/react-resizable-handle-([a-z]+)/.exec(alca?.className ?? "")?.[1] ?? ""] ?? "default");
  const terminar = () => setAjustando(null);
  // O arrasto (22/10/2026): os blocos empurrados voltam ao lugar quando o arrastado sai de cima deles. A cada passo do
  // arrasto, os outros blocos voltam à posição do início dele e os que o bloco encobre agora descem para logo abaixo dele
  // (em cascata). Durante o arrasto, a grade não resolve as colisões (allowOverlap): a regra dela (24/10/2026) trocava a
  // linha do arrastado pela do bloco encoberto e, a cada movimento do mouse, alternava entre duas arrumações — os outros
  // blocos pulavam de um lugar para o outro (piscavam).
  const doInicio = useRef<Map<string, { x: number; y: number }> | null>(null);
  const comecarArrasto = (l: Layout[]) => {
    doInicio.current = new Map(l.map((b) => [b.i, { x: b.x, y: b.y }]));
    comecar();
  };
  const aoArrastar = (l: Layout[], _antes: Layout, arrastado: Layout) => {
    const inicio = doInicio.current;
    // O arrastado está na célula do mouse; o leiaute pode ser uma cópia (o item dele, outro objeto).
    const alvo = l.find((b) => b.i === arrastado.i);
    if (!inicio || !alvo) return;
    alvo.x = arrastado.x;
    alvo.y = arrastado.y;
    for (const b of l) {
      const p = inicio.get(b.i);
      if (b === alvo || !p) continue;
      b.x = p.x;
      b.y = p.y;
      b.moved = false;
    }
    empurrar(l, alvo);
  };
  // Ao soltar, a posição final vai aos blocos daqui mesmo (26/10/2026): a grade só avisa a mudança (onLayoutChange) se o
  // leiaute final difere do de antes do arrasto, mas o dela guarda, no lugar, o bloco já na primeira célula a que ele
  // chegou. O bloco solto nessa célula (uma coluna ou uma linha, num espaço vazio) não era salvo e voltava ao lugar quando
  // a grade relia os blocos (ao escolher outro, por exemplo).
  const terminarArrasto = (l: Layout[], antes: Layout, arrastado: Layout) => {
    aoArrastar(l, antes, arrastado);
    doInicio.current = null;
    terminar();
    aoMudarLeiaute(l);
  };
  // Só o bloco escolhido se redimensiona, pelos quadrados de ancoragem (24/10/2026; antes, qualquer bloco, pelo canto).
  const layout: Layout[] = blocos.map((b) => ({
    i: b.id,
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h,
    ...tamanhoMinimo(b, LARGURA, dados?.prova.cenarios.length ?? 0),
    isResizable: editavel && b.id === selecionado,
    resizeHandles: naProporcao(b) ? CANTOS : TODAS_AS_ALCAS,
  }));
  // A foto se redimensiona pela largura: a altura acompanha, na proporção dela. Por um canto de cima (24/10/2026), o pé
  // fica no lugar: o topo acompanha a altura.
  const aoRedimensionar = (_l: Layout[], antes: Layout, novo: Layout, sombra: Layout) => {
    const b = blocos.find((x) => x.id === novo.i);
    if (!naProporcao(b) || !caixa.current) return;
    const h = linhasDaFoto(novo.w, b.proporcao, caixa.current.offsetWidth, b.tipo === "FOTO" && !!b.livre);
    if (novo.y !== antes.y) novo.y = sombra.y = Math.max(0, antes.y + antes.h - h);
    novo.h = sombra.h = h;
  };
  const mudarBloco = (id: string, m: Partial<Bloco>) => onMudar(blocos.map((b) => (b.id === id ? ({ ...b, ...m } as Bloco) : b)));
  /**
   * O bloco com outra posição e outro tamanho (27/10/2026): os que ele encobre descem para logo abaixo dele (em cascata),
   * como no arrasto.
   */
  const reposicionar = (id: string, m: Partial<Bloco>, novo: { x: number; y: number; w: number; h: number }) => {
    const l = blocos.map((b) => ({ i: b.id, x: b.x, y: b.y, w: b.w, h: b.h, ...(b.id === id ? novo : {}) })) as Layout[];
    empurrar(l, l.find((b) => b.i === id)!);
    const pos = new Map(l.map((b) => [b.i, b]));
    onMudar(blocos.map((b) => ({ ...b, ...(b.id === id ? m : {}), x: pos.get(b.id)!.x, y: pos.get(b.id)!.y, w: pos.get(b.id)!.w, h: pos.get(b.id)!.h }) as Bloco));
  };
  /**
   * As caixas de texto crescem com o texto (27/10/2026, pedido do Adão): na anotação e no Texto Livre, o texto que passa da
   * altura do bloco o aumenta (em linhas da grade, até o pé da página), e os blocos de baixo descem.
   */
  const mudarTexto = (b: Bloco, m: Partial<Bloco>) => {
    const el = campos.current.get(b.id);
    const falta = editavel && (b.tipo === "ANOTACAO" || b.tipo === "TEXTO") && "html" in m && el ? el.scrollHeight - el.clientHeight : 0;
    const h = falta > 1 ? Math.min(linhas - b.y, b.h + Math.ceil(falta / (ALTURA_DA_LINHA + MARGEM))) : b.h;
    if (h <= b.h) return mudarBloco(b.id, m);
    reposicionar(b.id, m, { x: b.x, y: b.y, w: b.w, h });
  };
  /** O Cortar e Posicionar aplicado (27/10/2026): o tamanho dentro da página, o corte (sem ele, a proporção da imagem) e os ajustes. */
  const aplicarCorte = (b: Bloco, t: CorteDaImagem) => {
    const w = Math.min(COLUNAS, t.w);
    const x = Math.min(b.x, COLUNAS - w);
    const y = Math.max(0, Math.min(b.y, linhas - t.h));
    reposicionar(b.id, { recorte: t.recorte, ajustes: t.ajustes } as Partial<Bloco>, { x, y, w, h: t.h });
  };
  const aoMudarLeiaute = (novo: Layout[]) => {
    const pos = new Map(novo.map((l) => [l.i, l]));
    const mudou = blocos.some((b) => {
      const l = pos.get(b.id);
      return l && (l.x !== b.x || l.y !== b.y || l.w !== b.w || l.h !== b.h);
    });
    if (mudou) onMudar(blocos.map((b) => ({ ...b, ...(pos.has(b.id) ? { x: pos.get(b.id)!.x, y: pos.get(b.id)!.y, w: pos.get(b.id)!.w, h: pos.get(b.id)!.h } : {}) })));
  };
  const doCard = blocos.find((b) => b.id === configurando);
  // O bloco ampliado, com o tamanho dele na grade (sem a ampliação do mouse); Esc ou um clique o fecham. No card do Painel
  // (17/10/2026), só o card (sem o nome do grupo) ou só o gráfico, conforme o ponto clicado: `recorte` é a parte do card
  // que aparece (o gráfico), em px do card.
  // No vídeo (20/10/2026), `video`: de onde ele continua ampliado (o tempo e se estava tocando, na grade).
  const [ampliado, setAmpliado] = useState<{ b: Bloco; w: number; h: number; soCard?: boolean; semGrafico?: boolean; recorte?: Recorte; video?: { tempo: number; tocando: boolean } } | null>(null);
  // Fechar o ampliado: o vídeo da grade fica no tempo em que o ampliado parou (pausado).
  const fechar = () => {
    if (ampliado?.b.tipo === "VIDEO" && caixa.current) {
      const { tempo } = estadoDoPlayer(document.querySelector("[data-bloco-ampliado] [data-video-do-bloco]"));
      const daGrade = [...caixa.current.querySelectorAll(`[data-video-do-bloco="${ampliado.b.id}"]`)].find((el) => !el.closest("[data-bloco-ampliado]"));
      irPara(daGrade ?? null, tempo);
    }
    setAmpliado(null);
  };
  // O destaque sob o mouse (16/10/2026): o bloco cresce até 10%, a partir do ponto que o mantém dentro da tela.
  const [realce, setRealce] = useState<{ id: string; escala: number; origem: string } | null>(null);
  useEffect(() => {
    if (!ampliado) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      fechar();
    };
    window.addEventListener("keydown", aoTeclar, true);
    return () => window.removeEventListener("keydown", aoTeclar, true);
    // A cada desenho (20/10/2026): o fechar do momento (o do vídeo ampliado lê o tempo dele).
  });
  return (
    <>
      {/* O menu único da edição (24/10/2026; antes, a barra de cada bloco, com o mouse sobre ele), logo abaixo das abas. */}
      {editavel ? (
        <>
          <style>{ESTILO_DA_EDICAO}</style>
          <BarraDeEdicao
            b={escolhido}
            campo={campoDoEscolhido}
            desfazer={desfazer}
            refazer={refazer}
            copiar={copiar}
            colar={colar}
            onMudar={(m) => escolhido && mudarBloco(escolhido.id, m)}
            onConfigurar={() => escolhido && setConfigurando(escolhido.id)}
            onCortar={() => escolhido && setCortando(escolhido.id)}
            onExcluir={() => escolhido && excluir(escolhido.id)}
          />
        </>
      ) : null}
    {/* A página na altura do espaço útil da tela inteira; na edição, com o contorno tracejado dela (o bloco que passa dele,
        de antes do limite, aparece abaixo e volta para dentro ao ser movido). A sombra do bloco, em cinza. */}
    <div ref={area} className="relative -mx-3" style={{ height: alturaDoSlide * escala }}>
      <div
        ref={caixa}
        className={`grade-do-relatorio absolute top-0 left-0 [&_.react-grid-placeholder]:!bg-gray-400 ${ajustando ? "em-ajuste" : ""}`}
        style={{ width: LARGURA, minHeight: alturaDaPagina, transform: escala === 1 ? undefined : `scale(${escala})`, transformOrigin: "top left", ["--escala" as string]: escala, cursor: ajustando?.cursor }}
        // O clique fora dos blocos solta o escolhido.
        onMouseDown={editavel ? (e) => (!(e.target as HTMLElement).closest(".react-grid-item") ? setSelecionado(null) : undefined) : undefined}
      >
      {editavel ? (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 rounded-sm border border-dashed border-gray-300" style={{ height: linhas * (ALTURA_DA_LINHA + MARGEM) + MARGEM }} />
      ) : null}
      {fundo ? <CamadaDoFundo relatorioId={relatorioId} fundo={fundo} className="absolute inset-x-0 top-0 rounded-sm" style={{ height: linhas * (ALTURA_DA_LINHA + MARGEM) + MARGEM }} /> : null}
      {ajustando ? <GradeDeFundo largura={ajustando.largura} /> : null}
      <GridLayout
        layout={layout}
        width={LARGURA}
        transformScale={escala}
        cols={COLUNAS}
        rowHeight={ALTURA_DA_LINHA}
        maxRows={linhas}
        margin={[12, 12]}
        isDraggable={editavel}
        isResizable={editavel}
        // Move-se pela borda do bloco escolhido (as faixas .alca-do-bloco, 24/10/2026; antes, pela alça da barra do bloco).
        draggableHandle=".alca-do-bloco"
        // Os quadrados de ancoragem do bloco escolhido (24/10/2026), no desenho de ESTILO_DA_EDICAO.
        resizeHandle={(eixo: Alca, ref: React.Ref<HTMLElement>) => (
          <span ref={ref as React.Ref<HTMLSpanElement>} className={`react-resizable-handle react-resizable-handle-${eixo} ancora-do-bloco`} />
        )}
        // Os blocos ficam onde se põem, em todas as páginas (22/10/2026; antes, só na Capa, no Encerramento e nas com a
        // Imagem de Fundo — nas demais, a grade os encostava em cima): sem se sobrepor (o bloco arrastado sobre outro o
        // empurra; e, se o arrasto continua, o empurrado volta ao lugar, 22/10/2026) e dentro da página (as linhas dela e as
        // colunas, isBounded).
        compactType={null}
        allowOverlap={ajustando?.cursor === "move"}
        isBounded
        // A grade com a altura da página, no mínimo (22/10/2026): o isBounded limita o arrasto à altura da grade, que sem
        // isso era só a do bloco mais baixo (numa página com poucos blocos, eles não desciam).
        style={{ minHeight: alturaDaPagina }}
        onLayoutChange={aoMudarLeiaute}
        onResize={aoRedimensionar}
        onDragStart={comecarArrasto}
        onDrag={aoArrastar}
        onDragStop={terminarArrasto}
        onResizeStart={comecarRedimensionar}
        onResizeStop={terminar}
      >
        {blocos.map((b) => {
          // O Texto Livre e o Sumário (20/10/2026) são da composição do slide: na apresentação, sem o destaque e sem ampliar. A
          // Imagem Livre se destaca e se amplia como as demais (22/10/2026; antes, como o Texto Livre), sem o fundo atrás dela
          // e com a sombra no contorno da imagem (o PNG transparente continua transparente).
          const amplia = ampliavel && b.tipo !== "TEXTO" && b.tipo !== "SUMARIO";
          const imagemLivre = b.tipo === "FOTO" && !!b.livre;
          return (
          // Sob o mouse, o bloco fica por cima dos vizinhos (a dica do gráfico e o destaque da apresentação passam por cima deles).
          // Na edição, o clique (ou o foco num texto dele) escolhe o bloco.
          <div
            key={b.id}
            className={`group relative focus-within:z-10 hover:z-10 ${b.id === selecionado ? "z-20" : ""}`}
            onMouseDownCapture={editavel ? () => setSelecionado(b.id) : undefined}
            onFocusCapture={editavel ? () => setSelecionado(b.id) : undefined}
          >
            {editavel && b.id === selecionado ? (
              <>
                {/* O destaque do bloco escolhido e as faixas da borda, que o movem ao arrastar. */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 z-20 rounded-[2px]"
                  style={{ outline: "calc(2px / var(--escala, 1)) solid var(--color-sky-600)", outlineOffset: "calc(2px / var(--escala, 1))" }}
                />
                {FAIXAS_DA_BORDA.map(({ lado, estilo }) => (
                  <span key={lado} className="alca-do-bloco absolute z-20 cursor-move" style={estilo} title={`${nomeDoBloco(b)}: arraste a borda para mover`} />
                ))}
              </>
            ) : editavel ? (
              <>
                {/* Sob o mouse, o contorno tracejado mostra o bloco que o clique escolhe. */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 z-20 rounded-[2px] opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ outline: "calc(1px / var(--escala, 1)) dashed var(--color-gray-400)", outlineOffset: "calc(2px / var(--escala, 1))" }}
                />
                {/* O player do vídeo (um iframe) não passa o clique adiante: a camada recebe o primeiro, que escolhe o bloco. */}
                {b.tipo === "VIDEO" ? <div className="absolute inset-0 z-10 cursor-pointer" title="Clique para escolher o vídeo" /> : null}
              </>
            ) : null}
            {/* Na apresentação, sob o mouse, o bloco cresce 10% com uma sombra fraca, sem sair da tela; o clique o amplia. */}
            <div
              // O card do Painel sem recorte (16/10/2026): a dica do mês, ao passar o mouse no gráfico, sai dos limites do card.
              className={`h-full ${b.tipo === "PAINEL" ? "" : "overflow-hidden"} ${amplia ? `cursor-zoom-in rounded-sm transition duration-200 ${imagemLivre ? "hover:drop-shadow-lg" : "hover:bg-background hover:shadow-lg"}` : ""}`}
              style={realce?.id === b.id ? { transform: `scale(${realce.escala})`, transformOrigin: realce.origem } : undefined}
              onMouseEnter={amplia ? (e) => setRealce({ id: b.id, ...destaqueNaTela(e.currentTarget) }) : undefined}
              onMouseLeave={amplia ? () => setRealce(null) : undefined}
              onClick={amplia ? (e) => setAmpliado(oQueAmpliar(b, e.currentTarget, e.target as HTMLElement)) : undefined}
            >
              <ConteudoDoBloco
                relatorioId={relatorioId}
                b={b}
                dados={dados}
                editavel={editavel}
                cores={cores}
                tipo={tipo}
                apresentacao={ampliavel}
                sumario={sumario}
                registrar={(el) => (el ? campos.current.set(b.id, el) : campos.current.delete(b.id))}
                onCarregarImagem={onCarregarImagem ? (arquivo) => onCarregarImagem(b.id, arquivo) : undefined}
                onEscolherVideo={onEscolherVideo ? () => onEscolherVideo(b.id) : undefined}
                paraImagem={paraImagem}
                corDoOrcado={corDoOrcado} comparadaProva={comparadaProva}
                onMudar={(m) => mudarTexto(b, m)}
              />
            </div>
          </div>
          );
        })}
      </GridLayout>
      </div>
      {ampliado ? (
        <BlocoAmpliado w={ampliado.recorte?.w ?? ampliado.w} h={ampliado.recorte?.h ?? ampliado.h} onFechar={fechar}>
          {ampliado.recorte ? (
            // Só o gráfico: o card inteiro, no tamanho dele, deslocado para que só a área do gráfico fique à vista.
            <div className="relative size-full overflow-hidden">
              <div className="absolute" style={{ left: -ampliado.recorte.x, top: -ampliado.recorte.y, width: ampliado.w, height: ampliado.h }}>
                <ConteudoDoBloco relatorioId={relatorioId} b={ampliado.b} dados={dados} editavel={false} cores={cores} tipo={tipo} ampliado soCard corDoOrcado={corDoOrcado} comparadaProva={comparadaProva} onMudar={() => undefined} />
              </div>
            </div>
          ) : (
            <ConteudoDoBloco
              relatorioId={relatorioId}
              b={ampliado.b}
              dados={dados}
              editavel={false}
              cores={cores}
              tipo={tipo}
              ampliado
              soCard={ampliado.soCard}
              semGrafico={ampliado.semGrafico}
              video={ampliado.video}
              corDoOrcado={corDoOrcado} comparadaProva={comparadaProva}
              onMudar={() => undefined}
            />
          )}
        </BlocoAmpliado>
      ) : null}
      {doCard?.tipo === "FOTO" && doCard.arquivo ? (
        <AjustesDaImagemDialog
          relatorioId={relatorioId}
          arquivo={doCard.arquivo}
          proporcao={doCard.proporcao}
          inicial={doCard.ajustes}
          comMoldura
          onFechar={() => setConfigurando(null)}
          onAplicar={(ajustes, troca) => {
            // Com a imagem trocada (22/10/2026), o bloco fica com a altura da proporção da nova; os ajustes ficam.
            // Com o corte (27/10/2026), o quadro fica, e a nova imagem o cobre, centralizada.
            const nova = !troca
              ? {}
              : doCard.recorte
                ? { arquivo: troca.arquivo, proporcao: troca.proporcao, recorte: { zoom: 1, x: 0.5, y: 0.5 } }
                : { arquivo: troca.arquivo, proporcao: troca.proporcao, h: linhasDaFoto(doCard.w, troca.proporcao, LARGURA, !!doCard.livre) };
            mudarBloco(doCard.id, { ajustes, ...nova } as Partial<Bloco>);
            setConfigurando(null);
          }}
        />
      ) : null}
      {(() => {
        const b = blocos.find((x) => x.id === cortando);
        return b?.tipo === "FOTO" && b.arquivo ? (
          <CortarImagemDialog
            relatorioId={relatorioId}
            bloco={b}
            colunas={COLUNAS}
            linhas={linhas}
            linhasNaProporcao={(w) => linhasDaFoto(w, b.proporcao, LARGURA, !!b.livre)}
            quadro={(w, h) => quadroDaImagem(w, h, !!b.livre)}
            onFechar={() => setCortando(null)}
            onAplicar={(t) => {
              aplicarCorte(b, t);
              setCortando(null);
            }}
          />
        ) : null;
      })()}
      {doCard?.tipo === "SUMARIO" ? (
        <ConfigurarSumarioDialog
          titulo="Configurar Sumário"
          inicial={{ listar: doCard.listar, telas: doCard.telas, linha: doCard.linha }}
          sumario={sumario}
          onFechar={() => setConfigurando(null)}
          onAplicar={(o) => {
            mudarBloco(doCard.id, o);
            setConfigurando(null);
          }}
        />
      ) : null}
      {doCard?.tipo === "TABELA" ? (
        <ConfigurarTabelaDialog
          relatorioId={relatorioId}
          titulo={ehProva(doCard) ? "Configurar Tabela PROVA" : "Configurar Tabela Padrão"}
          inicial={{ visao: doCard.visao, nivel: doCard.nivel, linhas: doCard.linhas, recolhido: doCard.recolhido, colunas: doCard.colunas, prova: doCard.prova }}
          onFechar={() => setConfigurando(null)}
          onAplicar={(o) => {
            // Sem as linhas (todas), o campo sai do bloco.
            mudarBloco(doCard.id, { ...o, linhas: o.linhas, colunas: o.colunas } as Partial<Bloco>);
            setConfigurando(null);
          }}
        />
      ) : null}
      {doCard?.tipo === "PAINEL" || doCard?.tipo === "INDICADOR" ? (
        <ConfigurarGraficoDialog
          b={doCard}
          tipo={tipo}
          cores={cores}
          onFechar={() => setConfigurando(null)}
          onAplicar={(opcoes, todos) => {
            // Neste card ou em todos os cards da aba (os do Painel de Bordo e, desde 22/10/2026, os dos Indicadores).
            // As cores próprias do card do Painel (de antes de 16/10/2026) saem: valem as da Acessibilidade.
            onMudar(
              blocos.map((x) =>
                !(todos || x.id === doCard.id) ? x : x.tipo === "PAINEL" ? { ...x, ...opcoes, cores: undefined } : x.tipo === "INDICADOR" ? { ...x, ...opcoes } : x,
              ),
            );
            setConfigurando(null);
          }}
        />
      ) : null}
    </div>
    </>
  );
}

/**
 * O destaque de um bloco (16/10/2026): a escala (até 1,1) e o ponto de origem dela que deixam o bloco ampliado dentro da
 * tela (8 px das bordas). Em cada direção, a origem fica no meio, se cabe; senão, encosta no lado que não tem espaço.
 */
function destaqueNaTela(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  // O slide em escala na tela (27/10/2026: a tela padrão): a origem volta às medidas do bloco.
  const naTela = r.width / el.offsetWidth || 1;
  const folga = 8;
  const eixo = (inicio: number, tamanho: number, limite: number) => {
    const antes = Math.max(0, inicio - folga);
    const depois = Math.max(0, limite - folga - (inicio + tamanho));
    const escala = Math.min(1.1, (tamanho + antes + depois) / tamanho);
    const cresce = escala - 1;
    // A origem o, em px a partir do início: cresce·o ≤ antes e cresce·(tamanho − o) ≤ depois; de preferência, o meio.
    const o = cresce > 0 ? Math.min(Math.max(tamanho / 2, tamanho - depois / cresce), antes / cresce) : tamanho / 2;
    return { escala, o: Math.min(tamanho, Math.max(0, o)) };
  };
  const x = eixo(r.left, r.width, window.innerWidth);
  const y = eixo(r.top, r.height, window.innerHeight);
  return { escala: Math.min(x.escala, y.escala), origem: `${x.o / naTela}px ${y.o / naTela}px` };
}

type Recorte = { x: number; y: number; w: number; h: number };

/**
 * O que ampliar ao clicar num bloco da apresentação (17/10/2026): no card do Painel, o gráfico (clicado nele) ou a parte
 * antes dele (clicado no resto: o card como se não tivesse gráfico, na largura dessa parte), sem o nome do grupo; nos
 * demais blocos, o bloco inteiro. As medidas saem do card na tela, divididas
 * pela ampliação do destaque do mouse, para virem no tamanho da grade.
 */
function oQueAmpliar(b: Bloco, bloco: HTMLElement, alvo: HTMLElement) {
  const inteiro = { b, w: bloco.offsetWidth, h: bloco.offsetHeight };
  // O vídeo (20/10/2026): ampliado, continua de onde estava; o da grade pausa.
  if (b.tipo === "VIDEO") {
    const el = bloco.querySelector("[data-video-do-bloco]");
    const video = estadoDoPlayer(el);
    pausarPlayer(el);
    return { ...inteiro, video };
  }
  if (b.tipo !== "PAINEL") return inteiro;
  const card = bloco.querySelector<HTMLElement>("[data-card-indicador]");
  if (!card) return inteiro;
  const rc = card.getBoundingClientRect();
  const escala = rc.width / card.offsetWidth || 1;
  // As medidas do card são as de dentro do Zoom dele (o card é montado menor e ampliado); o bloco ampliado aplica o Zoom de
  // novo, e elas voltam ao tamanho do bloco (31/10/2026: sem isso, o card com Zoom saía apertado, cortado embaixo).
  const z = b.zoom ?? 1;
  const grafico = alvo.closest<HTMLElement>("[data-grafico-do-card]");
  if (!grafico || !card.contains(grafico)) {
    // A parte antes do gráfico: o card sem o gráfico, na largura do card menos a do gráfico (o card sem gráfico já ocupa só ela).
    const doCard = card.querySelector<HTMLElement>("[data-grafico-do-card]");
    const comGrafico = !!doCard && doCard.offsetWidth > 0;
    return { b, w: (card.offsetWidth - (comGrafico ? doCard.offsetWidth : 0)) * z, h: card.offsetHeight * z, soCard: true, semGrafico: comGrafico };
  }
  const rg = grafico.getBoundingClientRect();
  return {
    b,
    w: card.offsetWidth * z,
    h: card.offsetHeight * z,
    soCard: true,
    recorte: { x: ((rg.left - rc.left) / escala) * z, y: ((rg.top - rc.top) / escala) * z, w: grafico.offsetWidth * z, h: grafico.offsetHeight * z },
  };
}

/**
 * O bloco ampliado na apresentação (16/10/2026): o mesmo bloco, no tamanho da grade, ampliado (transform) até ocupar o
 * máximo da tela, sobre um fundo escurecido; um clique em qualquer lugar fecha.
 */
function BlocoAmpliado({ w, h, onFechar, children }: { w: number; h: number; onFechar: () => void; children: React.ReactNode }) {
  const borda = 16;
  // Dentro do slide em escala (27/10/2026: a tela padrão), a camada cobre a caixa do slide, nas medidas dela.
  const naTela = useContext(NaTelaPadrao);
  const largura = naTela ? TELA_PADRAO.largura : window.innerWidth;
  const altura = naTela ? TELA_PADRAO.altura : window.innerHeight;
  const escala = Math.min((largura * 0.94) / (w + 2 * borda), (altura * 0.92) / (h + 2 * borda));
  return (
    // data-bloco-ampliado: com ele aberto, as setas e o espaço não mudam o slide (o vídeo ampliado usa o teclado).
    <div role="dialog" aria-modal aria-label="Bloco ampliado" data-bloco-ampliado className="fixed inset-0 z-[70] flex cursor-zoom-out items-center justify-center bg-black/75" onClick={onFechar}>
      <div className="shrink-0 rounded-sm bg-background shadow-2xl" style={{ width: w + 2 * borda, height: h + 2 * borda, padding: borda, transform: `scale(${escala})` }}>
        {children}
      </div>
    </div>
  );
}

type OpcoesDoGrafico = { tipoGrafico: TipoGrafico; comRotulos: boolean };

/**
 * O Configurar Gráfico de um card do Painel de Bordo (16/10/2026) ou dos Indicadores (22/10/2026): as opções do Configurar
 * Gráficos do Painel — os Rótulos e o Tipo (as cores são as da Acessibilidade, 16/10/2026) —, aplicadas a este card ou a
 * todos os cards da aba. Nos cards PROVA, os cenários são os da Comparação PROVA do relatório (a aba Configurações).
 */
function ConfigurarGraficoDialog({
  b,
  tipo,
  cores,
  onAplicar,
  onFechar,
}: {
  b: Extract<Bloco, { tipo: "PAINEL" | "INDICADOR" }>;
  tipo: TipoGrafico;
  cores: Cores;
  onAplicar: (o: OpcoesDoGrafico, todos: boolean) => void;
  onFechar: () => void;
}) {
  const [o, setO] = useState<OpcoesDoGrafico>({ tipoGrafico: b.tipoGrafico ?? tipo, comRotulos: b.comRotulos ?? false });
  const [todos, setTodos] = useState(false);
  return (
    <Dialog open onOpenChange={(a) => (!a ? onFechar() : undefined)}>
      <DialogContent className="rounded-sm sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Configurar Gráfico</DialogTitle>
          <DialogDescription>
            {b.tipo === "PAINEL" ? `${b.titulo} (${b.quadro})` : b.nome}: as opções do Configurar Gráficos do Painel de Bordo.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 [&_label]:justify-between [&_label>span]:text-sm [&_[data-slot=select-trigger]]:w-40">
          <SeletorRotulos com={o.comRotulos} onMudar={(comRotulos) => setO((x) => ({ ...x, comRotulos }))} />
          <SeletorTipoGrafico tipo={o.tipoGrafico} onMudar={(tipoGrafico) => setO((x) => ({ ...x, tipoGrafico }))} />
        </div>
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-sm leading-none font-medium">Aplicar</legend>
          <OpcaoEmLinha nome="aplicar-grafico" marcada={!todos} onMarcar={() => setTodos(false)} rotulo="Neste Card" detalhe="Só o card escolhido." />
          <OpcaoEmLinha nome="aplicar-grafico" marcada={todos} onMarcar={() => setTodos(true)} rotulo="Em Toda a Aba" detalhe="Todos os cards da aba." />
        </fieldset>
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} onClick={() => onAplicar(o, todos)}>
            Aplicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Os Zooms dos cards (30/10/2026, pedido do Adão): 100% (o padrão, sem o campo no bloco) a 300%. */
const ZOOMS = [1, 1.25, 1.5, 2, 2.5, 3];
const rotuloDoZoom = (z: number) => `${Math.round(z * 100)}%`;

/** O botão do Zoom do card, no menu da edição: o zoom de agora e a lista dos zooms. */
function BotaoDoZoom({ zoom, botao, desabilitado, onEscolher }: { zoom: number; botao: string; desabilitado: boolean; onEscolher: (z: number) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={`${botao} w-auto min-w-12 gap-0.5 px-1 text-xs font-semibold`}
            disabled={desabilitado}
            title="Zoom do card"
            aria-label={`Zoom do card: ${rotuloDoZoom(zoom)}`}
          >
            <ZoomIn className="size-4" />
            {desabilitado ? null : rotuloDoZoom(zoom)}
          </button>
        }
      />
      <DropdownMenuContent align="start" className="w-36">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-gray-500">Zoom do Card</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={String(zoom)} onValueChange={(v) => onEscolher(Number(v))}>
            {ZOOMS.map((z) => (
              <DropdownMenuRadioItem key={z} value={String(z)} closeOnClick>
                {z === 1 ? "100% (padrão)" : rotuloDoZoom(z)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * O card com o Zoom (30/10/2026, pedido do Adão): o conteúdo inteiro (os textos, os valores e o gráfico) maior, na mesma
 * proporção, no mesmo bloco — montado numa área menor (1/zoom do bloco) e ampliado até o tamanho dele. O que não couber,
 * o usuário resolve aumentando o bloco. A Metodologia em até metade da largura dos valores (22/10/2026), quebrando as linhas.
 */
function CardComZoom({ zoom = 1, children }: { zoom?: number; children: React.ReactNode }) {
  if (zoom === 1) return <div className="h-full [&_[data-metodologia]]:max-w-[50%]">{children}</div>;
  return (
    <div className="h-full overflow-hidden">
      <div className="origin-top-left [&_[data-metodologia]]:max-w-[50%]" style={{ width: `${100 / zoom}%`, height: `${100 / zoom}%`, transform: `scale(${zoom})` }}>
        {children}
      </div>
    </div>
  );
}

/**
 * O menu único da edição (24/10/2026, pedido do Adão; antes, a barra de cada bloco, com o mouse sobre ele), logo abaixo
 * das abas, preso no alto ao rolar e centralizado, na largura dos botões (24/10/2026: sem o nome do bloco — ele fica na dica
 * da borda — e sem o espaço vazio à direita): o Desfazer e o Refazer e, sempre nos mesmos lugares, as opções de todos os
 * tipos — o gráfico dos cards e o Configurar (o gráfico, o sumário ou a tabela), os ajustes da imagem, as notas das
 * anotações, a formatação do texto (no Sumário, a dele, por nível) e excluir. As que não valem para o bloco escolhido (ou
 * sem bloco escolhido) ficam à vista, quase apagadas (o cinza claro no tema claro, o escuro no Escuro).
 */
export function BarraDeEdicao({
  b,
  campo = semCampo,
  desfazer,
  refazer,
  copiar,
  colar,
  onMudar = () => undefined,
  onConfigurar = () => undefined,
  onCortar = () => undefined,
  onExcluir = () => undefined,
}: {
  b?: Bloco;
  campo?: () => HTMLElement | null;
  /** O Desfazer e o Refazer (24/10/2026); sem eles (nada a desfazer ou a refazer), quase apagados. */
  desfazer?: () => void;
  refazer?: () => void;
  /** Copiar o bloco escolhido e colar o copiado (24/10/2026); sem eles, quase apagados. */
  copiar?: () => void;
  colar?: () => void;
  onMudar?: (m: Partial<Bloco>) => void;
  onConfigurar?: () => void;
  /** O Cortar e Posicionar da imagem (27/10/2026). */
  onCortar?: () => void;
  onExcluir?: () => void;
}) {
  const botao = "inline-flex size-7 items-center justify-center rounded-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900 disabled:cursor-default disabled:text-gray-300 disabled:hover:bg-transparent";
  const card = b?.tipo === "PAINEL" || b?.tipo === "INDICADOR" ? b : undefined;
  const configurar = card && modoDoGrafico(card) !== "NENHUM" ? "Configurar o gráfico" : b?.tipo === "SUMARIO" ? "Configurar o sumário" : b?.tipo === "TABELA" ? "Configurar a tabela" : null;
  const imagem = b?.tipo === "FOTO" && b.arquivo ? b : undefined;
  // O texto formatado: as anotações, o Texto Livre e as legendas das fotos e dos vídeos (a fonte e o espaçamento, só nos dois primeiros).
  const comTexto = !!b && (b.tipo === "ANOTACAO" || b.tipo === "TEXTO" || (b.tipo === "FOTO" && !b.livre) || b.tipo === "VIDEO");
  const doTexto = b?.tipo === "ANOTACAO" || b?.tipo === "TEXTO";
  const separador = <span aria-hidden className="mx-1 h-5 w-px bg-gray-200" />;
  return (
    <div
      role="toolbar"
      aria-label="Edição do bloco escolhido"
      title={b ? undefined : "Clique num bloco para editá-lo"}
      className="sticky top-[var(--topo-tabela,0px)] z-30 mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-0.5 rounded-sm border border-gray-200 bg-white px-2 py-1 shadow-sm"
    >
      {/* O Desfazer e o Refazer (24/10/2026): as alterações da sessão, em todas as abas. */}
      <button type="button" className={botao} disabled={!desfazer} title="Desfazer (Ctrl+Z)" aria-label="Desfazer" onClick={desfazer}>
        <Undo2 className="size-4" />
      </button>
      <button type="button" className={botao} disabled={!refazer} title="Refazer (Ctrl+Y)" aria-label="Refazer" onClick={refazer}>
        <Redo2 className="size-4" />
      </button>
      {separador}
      {/* Copiar e Colar (24/10/2026): o bloco escolhido, para esta ou outra página, aba ou relatório. */}
      <button type="button" className={botao} disabled={!copiar} title="Copiar o bloco (Ctrl+C; o Ctrl+X recorta)" aria-label="Copiar" onClick={copiar}>
        <Copy className="size-4" />
      </button>
      <button type="button" className={botao} disabled={!colar} title="Colar o bloco copiado (Ctrl+V; o Ctrl+V também cola textos, imagens e vídeos de outros programas)" aria-label="Colar" onClick={colar}>
        <ClipboardPaste className="size-4" />
      </button>
      {separador}
      {/* Os dados do card (12/11/2026), em ciclo, antes do gráfico: o Atual e o Acumulado → só o Atual → só o Acumulado → os dois. */}
      {card ? (
        <BotaoDosDados dados={dadosDoCard(card)} botao={botao} onClicar={() => onMudar(proximosDados(card))} />
      ) : (
        <button type="button" className={botao} disabled title="Dados do card" aria-label="Dados do card">
          <Columns2 className="size-4" />
        </button>
      )}
      {/* O gráfico do card (22/10/2026), em ciclo: os meses e o acumulado → só o acumulado → sem gráfico → os meses e o acumulado. */}
      {card ? (
        <BotaoDoGrafico modo={modoDoGrafico(card)} botao={botao} onClicar={() => onMudar(proximoGrafico(card))} />
      ) : (
        <button type="button" className={botao} disabled title="Gráfico do card" aria-label="Gráfico do card">
          <ChartColumn className="size-4" />
        </button>
      )}
      {/* O Zoom do card (30/10/2026): o conteúdo inteiro maior, no mesmo bloco. */}
      <BotaoDoZoom zoom={card?.zoom ?? 1} botao={botao} desabilitado={!card} onEscolher={(z) => onMudar({ zoom: z === 1 ? undefined : z } as Partial<Bloco>)} />
      {/* O Configurar: as opções do gráfico dos cards com gráfico, o sumário ou a tabela. */}
      <button type="button" className={botao} disabled={!configurar} title={configurar ?? "Configurar"} aria-label={configurar ?? "Configurar"} onClick={onConfigurar}>
        <Settings className="size-4" />
      </button>
      {/* Os ajustes da imagem (21/10/2026): brilho, matiz, saturação, desfoque e transparência. */}
      <button type="button" className={`${botao} ${imagem?.ajustes ? "text-gray-900" : ""}`} disabled={!imagem} title="Ajustes da imagem" aria-label="Ajustes da imagem" onClick={onConfigurar}>
        <SlidersHorizontal className="size-4" />
      </button>
      {/* O Cortar e Posicionar (27/10/2026): o tamanho na proporção da imagem, um tamanho pronto ou o atual, e o corte. */}
      <button type="button" className={`${botao} ${imagem?.recorte ? "text-gray-900" : ""}`} disabled={!imagem} title="Cortar e posicionar a imagem" aria-label="Cortar e posicionar a imagem" onClick={onCortar}>
        <Crop className="size-4" />
      </button>
      {separador}
      {(Object.keys(NOTAS) as Nota[]).map((n) => {
        const { Icone, rotulo } = NOTAS[n];
        const marcada = b?.tipo === "ANOTACAO" && b.nota === n;
        return (
          <button
            key={n}
            type="button"
            className={`${botao} ${marcada ? "bg-gray-200 text-gray-900" : ""}`}
            disabled={b?.tipo !== "ANOTACAO"}
            title={`Nota: ${rotulo}`}
            aria-label={`Nota: ${rotulo}`}
            aria-pressed={marcada}
            onClick={() => onMudar({ nota: n } as Partial<Bloco>)}
          >
            <Icone className="size-4" />
          </button>
        );
      })}
      {separador}
      {/* A formatação: no Sumário, a dele, por nível (20/10/2026); nos demais, a do texto (17/10/2026). */}
      {b?.tipo === "SUMARIO" ? (
        <BarraDoSumario b={b} botao={botao} onMudar={(m) => onMudar(m as Partial<Bloco>)} />
      ) : (
        <BarraDeTexto
          campo={comTexto ? campo : semCampo}
          botao={botao}
          desabilitado={!comTexto}
          // A fonte e o espaçamento entre as linhas (20/10/2026), nas anotações e no Texto Livre.
          fontes={doTexto}
          espacamento={doTexto ? { valor: b.espacamento, definir: (espacamento) => onMudar({ espacamento } as Partial<Bloco>) } : undefined}
          titulo={
            b?.tipo === "ANOTACAO"
              ? {
                  campo: () => campo()?.closest(".group")?.querySelector<HTMLInputElement>("[data-titulo-da-anotacao]") ?? null,
                  tamanho: b.tamanhoTitulo ?? TAMANHO_DO_TITULO,
                  definir: (px) => onMudar({ tamanhoTitulo: px } as Partial<Bloco>),
                  fonte: b.fonteTitulo,
                  definirFonte: (fonteTitulo) => onMudar({ fonteTitulo } as Partial<Bloco>),
                }
              : undefined
          }
        />
      )}
      {separador}
      <button type="button" className={`${botao} hover:text-red-700`} disabled={!b} title="Excluir o bloco (Delete)" aria-label="Excluir o bloco" onClick={onExcluir}>
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

function ConteudoDoBloco({
  relatorioId,
  b,
  dados,
  editavel,
  cores,
  tipo,
  ampliado = false,
  soCard = false,
  semGrafico = false,
  apresentacao = false,
  sumario = [],
  video,
  registrar,
  onCarregarImagem,
  onEscolherVideo,
  paraImagem = false,
  corDoOrcado,
  comparadaProva,
  onMudar,
}: {
  relatorioId: string;
  b: Bloco;
  /** Na imagem do slide (22/10/2026: a exportação em PDF): o vídeo como um quadro com o ícone (o player não vira imagem). */
  paraImagem?: boolean;
  /** A cor do orçado dos cards padrão (31/10/2026): a do cenário de comparação, nos slides com blocos PROVA. */
  corDoOrcado?: string;
  /** A marcação do cenário de comparação nos slides com blocos PROVA (31/10/2026): as colunas do orçado da Tabela Padrão na cor dele. */
  comparadaProva?: MarcacaoComparavel | null;
  /** Na apresentação (20/10/2026): o vídeo sem os controles do player, com os botões ao passar o mouse. */
  apresentacao?: boolean;
  /** As telas e os slides, com os números, para o Sumário (20/10/2026). */
  sumario?: TelaDoSumario[];
  /** No vídeo ampliado: de onde ele continua (o tempo e se estava tocando). */
  video?: { tempo: number; tocando: boolean };
  /** No quadro de vídeo vazio, na edição: escolher o vídeo. */
  onEscolherVideo?: () => void;
  /** No bloco ampliado da apresentação (16/10/2026): a legenda da foto com metade do tamanho. */
  ampliado?: boolean;
  /** No card do Painel ampliado (17/10/2026): só o card, sem o nome do grupo em cima. */
  soCard?: boolean;
  /** No card ampliado pela parte antes do gráfico (17/10/2026): o card como se não tivesse gráfico. */
  semGrafico?: boolean;
  /** O campo do texto formatado (anotação ou legenda), para a barra de formatação. */
  registrar?: (el: HTMLElement | null) => void;
  /** A imagem escolhida no quadro de foto vazio. */
  onCarregarImagem?: (arquivo: File) => void;
  dados: DadosDoRelatorio | undefined;
  editavel: boolean;
  cores: Cores;
  tipo: TipoGrafico;
  onMudar: (m: Partial<Bloco>) => void;
}) {
  const { rota } = useProcesso();
  const indisponivel = (o: string) => <div className="flex h-full items-center justify-center rounded-sm border border-dashed border-gray-300 bg-white p-3 text-center text-xs text-gray-500">{o}</div>;
  if (b.tipo === "ANOTACAO") {
    // No formato do card do Painel (16/10/2026): o título editável (de início, o nome da nota) no fundo da página, como o
    // nome do grupo em cima dos cards, e o texto num card branco com o destaque da cor da nota à esquerda.
    const n = NOTAS[b.nota];
    const titulo = b.titulo?.trim() ? b.titulo : n.rotulo;
    return (
      <div className="flex h-full flex-col">
        {/* O título no tamanho escolhido na barra (19/10/2026; antes, sempre 12 px); o ícone acompanha. */}
        <header
          className={`flex min-h-5 shrink-0 items-center gap-1.5 pb-1 font-bold tracking-wide uppercase ${n.icone(cores)}`}
          style={{ fontSize: b.tamanhoTitulo ?? TAMANHO_DO_TITULO, lineHeight: 1.2, fontFamily: familiaDa(b.fonteTitulo) }}
        >
          <n.Icone className="shrink-0" style={{ width: "1.15em", height: "1.15em" }} />
          {editavel ? (
            <input
              value={b.titulo ?? n.rotulo}
              onChange={(e) => onMudar({ titulo: e.target.value } as Partial<Bloco>)}
              placeholder={n.rotulo}
              maxLength={120}
              aria-label="Título da anotação"
              data-titulo-da-anotacao
              className="min-w-0 flex-1 rounded-sm bg-transparent font-bold tracking-wide uppercase outline-none placeholder:text-current placeholder:opacity-60 hover:bg-gray-100 focus:bg-gray-100"
            />
          ) : (
            <span className="min-w-0 truncate">{titulo}</span>
          )}
        </header>
        <article className={`flex min-h-0 flex-1 rounded-sm border border-l-4 border-gray-200 bg-white ${n.classe(cores)}`}>
          {/* O texto formatado (17/10/2026; antes, só texto): a formatação no menu da edição. */}
          <TextoRico
            html={b.html}
            texto={b.texto}
            editavel={editavel}
            placeholder="Escreva a anotação…"
            estilo={{ lineHeight: alturaDaLinha(b.espacamento) }}
            rotulo={`Anotação (${titulo})`}
            registrar={registrar}
            onMudar={(html, texto) => onMudar({ html, texto } as Partial<Bloco>)}
            className="min-h-0 w-full flex-1 overflow-auto px-4 py-2 text-sm text-gray-900"
          />
        </article>
      </div>
    );
  }
  if (b.tipo === "TEXTO") {
    // O Texto Livre (20/10/2026): o texto formatado das anotações, sem o destaque, o título, o ícone e o fundo; na edição,
    // o contorno tracejado com o mouse sobre ele.
    return (
      <TextoRico
        html={b.html}
        texto={b.texto}
        editavel={editavel}
        placeholder="Escreva o texto…"
        estilo={{ lineHeight: alturaDaLinha(b.espacamento) }}
        rotulo="Texto livre"
        registrar={registrar}
        onMudar={(html, texto) => onMudar({ html, texto } as Partial<Bloco>)}
        className={`h-full w-full overflow-auto text-sm text-gray-900 ${editavel ? "rounded-sm border border-dashed border-transparent px-1 hover:border-gray-300 focus:border-gray-300" : "px-1"}`}
      />
    );
  }
  if (b.tipo === "SUMARIO") return <ListaDoSumario b={b} sumario={sumario} editavel={editavel} />;
  if (b.tipo === "FOTO" && b.livre && b.arquivo) {
    // A Imagem Livre (21/10/2026): só a imagem, na proporção dela, sem a legenda e sem o fundo (o PNG transparente continua
    // transparente sobre o slide).
    return (
      <ImagemComMoldura src={enderecoDaFoto(relatorioId, b.arquivo, rota)} alt="Imagem" proporcao={b.proporcao} ajustes={b.ajustes} recorte={b.recorte} />
    );
  }
  if (b.tipo === "FOTO") {
    // A foto inteira (na proporção dela) e, embaixo, a legenda no destaque das Listas (16/10/2026).
    return (
      <figure className="flex h-full flex-col gap-2">
        <div className="min-h-0 flex-1">
          {b.arquivo ? (
            <ImagemComMoldura src={enderecoDaFoto(relatorioId, b.arquivo, rota)} alt={b.legenda || "Imagem"} proporcao={b.proporcao} ajustes={b.ajustes} recorte={b.recorte} />
          ) : (
            // O quadro sem a imagem (17/10/2026: o relatório importado sem as imagens): cinza, com o botão de carregar.
            <label
              className={`flex h-full w-full flex-col items-center justify-center gap-1 rounded-sm bg-gray-200 text-gray-500 ${editavel && onCarregarImagem ? "cursor-pointer hover:bg-gray-300 hover:text-gray-700" : ""}`}
              title={editavel ? "Carregar uma imagem neste quadro" : "Sem imagem"}
            >
              <ImagePlus className="size-8" />
              {editavel ? <span className="text-xs font-medium">Carregar Imagem</span> : null}
              {editavel && onCarregarImagem ? (
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const arquivo = e.target.files?.[0];
                    e.target.value = "";
                    if (arquivo) onCarregarImagem(arquivo);
                  }}
                />
              ) : null}
            </label>
          )}
        </div>
        {/* A legenda formatada (17/10/2026; antes, só texto): a formatação no menu da edição. A Imagem Livre não a tem. */}
        {!b.livre && (editavel || b.legenda) ? (
          <figcaption
            className="max-h-[40%] min-h-9 shrink-0 overflow-auto rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white text-sm font-semibold text-gray-900"
            style={ampliado ? { zoom: 0.5 } : undefined}
          >
            <TextoRico
              html={b.legendaHtml}
              texto={b.legenda}
              editavel={editavel}
              placeholder="Escreva a legenda…"
              rotulo="Legenda da foto"
              registrar={registrar}
              onMudar={(html, texto) => onMudar({ legendaHtml: html, legenda: texto.slice(0, 500) } as Partial<Bloco>)}
              className="px-3 py-1.5"
            />
          </figcaption>
        ) : null}
      </figure>
    );
  }
  if (b.tipo === "VIDEO") {
    // O vídeo (20/10/2026), como a foto: o player e, embaixo, a legenda no destaque das Listas.
    return (
      <figure className="flex h-full flex-col gap-2">
        <div className="min-h-0 flex-1">
          {paraImagem ? (
            <div className="flex size-full flex-col items-center justify-center gap-2 rounded-sm bg-gray-900 text-gray-100">
              <CirclePlay className="size-12" />
              <span className="text-sm">Vídeo (na apresentação)</span>
            </div>
          ) : (
          <PlayerDoVideo
            relatorioId={relatorioId}
            b={b}
            modo={ampliado ? "ampliado" : editavel ? "edicao" : apresentacao ? "apresentacao" : "leitura"}
            inicio={video?.tempo}
            tocar={video?.tocando}
            onEscolher={editavel ? onEscolherVideo : undefined}
          />
          )}
        </div>
        {editavel || b.legenda ? (
          <figcaption
            className="max-h-[40%] min-h-9 shrink-0 overflow-auto rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white text-sm font-semibold text-gray-900"
            style={ampliado ? { zoom: 0.5 } : undefined}
          >
            <TextoRico
              html={b.legendaHtml}
              texto={b.legenda}
              editavel={editavel}
              placeholder="Escreva a legenda…"
              rotulo="Legenda do vídeo"
              registrar={registrar}
              onMudar={(html, texto) => onMudar({ legendaHtml: html, legenda: texto.slice(0, 500) } as Partial<Bloco>)}
              className="px-3 py-1.5"
            />
          </figcaption>
        ) : null}
      </figure>
    );
  }
  // A tabela de Resultados (22/10/2026), com a consulta dela (não depende dos dados dos cards).
  if (b.tipo === "TABELA") return <TabelaDoBloco relatorioId={relatorioId} b={b} comparada={comparadaProva} />;
  if (!dados) return <div className="h-full animate-pulse rounded-sm bg-gray-100" />;
  // O card PROVA (31/10/2026): os cenários da Comparação PROVA do relatório (Configurações); sem nenhum marcado, o aviso.
  const cenarios = ehProva(b) ? comCor(dados.prova.cenarios) : null;
  if (cenarios && !cenarios.length) return indisponivel("Nenhum cenário da Comparação PROVA (Configurações) está marcado (Análises Gerenciais / Cenários Sintéticos).");
  if (b.tipo === "PAINEL") {
    const item = dados.painel.abas.find((a) => a.chave === b.aba)?.quadros.find((q) => q.titulo === b.quadro)?.itens.find((i) => i.titulo === b.titulo && i.sigla === b.sigla);
    if (!item) return indisponivel(`O card ${b.titulo} (${b.quadro}) não está mais no Painel de Bordo.`);
    const comparacoes = cenarios?.flatMap((c): ComparacaoDoCard[] => {
      const p = item.prova?.[c.marcacao];
      return p ? [{ rotulo: c.rotulo, cor: c.cor, dica: `${c.rotulo} (${c.cenario})`, ...p }] : [];
    });
    const card = (
      <CardDoPainel
        i={item}
        rotuloMes={dados.painel.rotuloMes}
        tipo={b.tipoGrafico ?? tipo}
        cores={cores}
        comGrafico={b.comGrafico && !semGrafico}
        soAcumulado={!!b.soAcumulado}
        periodos={b.periodos}
        comRotulos={b.comRotulos ?? false}
        comparacoes={comparacoes}
        corDoOrcado={cenarios ? undefined : corDoOrcado}
      />
    );
    // Sem o nome do grupo em cima do card (22/10/2026; antes, "PRODUÇÃO: MATRIZ"…): o card ocupa o bloco inteiro.
    return <CardComZoom zoom={b.zoom}>{card}</CardComZoom>;
  }
  const i = dados.indicadores.indicadores.find((x) => x.nome === b.nome);
  if (!i) return indisponivel(`O indicador ${b.nome} não está mais no cadastro Indicadores (Cadastros da Controladoria / Analítico).`);
  const ate = dados.indicadores.ate;
  // O card do indicador é o card do Painel de Bordo (22/10/2026), com a formatação do indicador: "Atual" e "Acumulado" com a
  // unidade entre parênteses, os valores sem ela, o destaque do desvio, o gráfico (o modo do ícone) e, à direita do nome,
  // o grupo e o comportamento. Nos percentuais, a escala dos gráficos em % (antes, em fração: 0,05 no lugar de 5).
  const modo = modoDoGrafico(b);
  const daSerie = dados.indicadores.meses.slice(0, ate).map((m, k) => ({ mes: m.rotulo.split("/")[0], realizado: i.meses[k] ?? null, orcado: i.orcado[k] ?? null }));
  const f: FormatacaoDoCard = { unidade: i.unidade, formatar: (v) => valor(i, v), formatarCurto: (v) => valorCurto(i, v), fatorDaEscala: fatorDaEscalaDa(i.unidade) };
  const item: ItemPainel = {
    titulo: i.nome,
    sigla: "",
    metodologia: i.grupo,
    sentido: i.sentido as ItemPainel["sentido"],
    formato: "PCT",
    formatoAcumulado: "PCT",
    base: null,
    separar: false,
    mes: blocoComparado(i.meses[ate - 1] ?? null, i.orcado[ate - 1] ?? null, i.sentido, !!dados.indicadores.cenarioOrcado),
    acumulado: blocoComparado(i.total, i.totalOrcado, i.sentido, !!dados.indicadores.cenarioOrcado),
    serie: daSerie,
  };
  // O card PROVA do indicador (31/10/2026): o realizado contra o orçado de cada cenário, com a regra do painel.
  const comparacoes = cenarios?.flatMap((c): ComparacaoDoCard[] => {
    const p = i.prova?.[c.marcacao];
    if (!p) return [];
    return [
      {
        rotulo: c.rotulo,
        cor: c.cor,
        dica: `${c.rotulo} (${c.cenario})`,
        mes: blocoComparado(i.meses[ate - 1] ?? null, p.orcado[ate - 1] ?? null, i.sentido),
        acumulado: blocoComparado(i.total, p.totalOrcado, i.sentido),
        serie: p.orcado.slice(0, ate),
      },
    ];
  });
  return (
    <CardComZoom zoom={b.zoom}>
      <CardDoPainel
        i={item}
        rotuloMes={dados.painel.rotuloMes}
        tipo={b.tipoGrafico ?? tipo}
        cores={cores}
        comGrafico={modo !== "NENHUM" && !semGrafico}
        soAcumulado={modo === "ACUMULADO"}
        periodos={b.periodos}
        comRotulos={b.comRotulos ?? false}
        formatacao={{ mes: f, acumulado: f }}
        comparacoes={comparacoes}
        corDoOrcado={cenarios ? undefined : corDoOrcado}
      />
    </CardComZoom>
  );
}
