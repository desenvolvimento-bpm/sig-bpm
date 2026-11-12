"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronRightIcon, ChevronsLeft, ChevronsRight, Minimize2 } from "lucide-react";

import { BpmLogo } from "@/components/layout/BpmLogo";

import { LegendaDoPainel, type Cores } from "@/app/relatorios/painel/PainelContent";
import { ehProva, seriesDaLegenda } from "./cenariosDoProva";
import type { TipoGrafico } from "@/app/relatorios/components/GraficoRealizadoOrcado";

import { CamadaDoFundo } from "./FundoDoSlide";
import { GradeDoRelatorio, linhasDaPagina } from "./GradeDoRelatorio";
import { useProcesso } from "./processo";
import { TelaNaEscala } from "./TelaPadrao";
import type { Bloco, DadosDoRelatorio, Fundo, TelaDoSumario, Transicao } from "../services/relatoriosExecutivosService";

/**
 * Um slide: o título da aba (`nome`: Introdução, Performance da Produção…), o nome da página (`pagina`), os blocos e a
 * Imagem de Fundo (20/10/2026), e o número dele na contagem que começa na Introdução (`numero`, de `total`; nulo na Capa e no Encerramento).
 */
export type Slide = {
  chave: string;
  nome: string;
  pagina: string;
  blocos: Bloco[];
  fundo?: Fundo;
  numero: number | null;
  total: number;
  transicao?: Transicao;
  /** Avançar Após, em segundos. */
  avancarApos?: number;
  /** Recomeçar ao Terminar (11/11/2026, os painéis): depois do Avançar Após do último, volta ao primeiro. */
  recomecarAoTerminar?: boolean;
};

/**
 * As transições (27/10/2026, pedido do Adão), as do grupo do slide que entra: Esmaecer (o slide novo aparece sobre o
 * anterior), Rolar Vertical e Rolar Horizontal (o novo empurra o anterior: para a frente, de baixo ou da direita; para
 * trás, de cima ou da esquerda). Sem transição, o slide troca na hora.
 */
const DURACAO_DA_TRANSICAO = 600;
const ESTILO_DAS_TRANSICOES = `
@keyframes re-esmaecer { from { opacity: 0 } to { opacity: 1 } }
@keyframes re-entra-x { from { transform: translateX(calc(var(--sentido) * 100%)) } to { transform: none } }
@keyframes re-sai-x { from { transform: none } to { transform: translateX(calc(var(--sentido) * -100%)) } }
@keyframes re-entra-y { from { transform: translateY(calc(var(--sentido) * 100%)) } to { transform: none } }
@keyframes re-sai-y { from { transform: none } to { transform: translateY(calc(var(--sentido) * -100%)) } }
`;
type Troca = { de: number; sentido: 1 | -1; transicao: Transicao };
function animacao(t: Troca, papel: "entra" | "sai"): React.CSSProperties | undefined {
  const nome = t.transicao === "ESMAECER" ? (papel === "entra" ? "re-esmaecer" : null) : `re-${papel}-${t.transicao === "ROLAR_HORIZONTAL" ? "x" : "y"}`;
  if (!nome) return undefined;
  return { animation: `${nome} ${DURACAO_DA_TRANSICAO}ms ease-in-out both`, ["--sentido" as string]: t.sentido };
}

/** Entra na tela inteira do navegador (a página toda; a apresentação a cobre, sem o menu lateral). */
export function entrarEmTelaInteira() {
  document.documentElement.requestFullscreen?.().catch(() => undefined);
}

/**
 * A apresentação do relatório (16/10/2026): em tela inteira (a função do navegador), sem o menu lateral, uma página
 * por slide, só para leitura, na altura da página (o espaço útil da tela inteira). Os botões de recuar, avançar e sair ficam
 * no centro da base, em cinza escuro, e só aparecem quando o mouse se move; as setas do teclado também mudam o slide, e
 * Esc encerra. Sem seleção de textos; o bloco se destaca sob o mouse e, clicado, se amplia (GradeDoRelatorio, ampliavel). O
 * slide com Avançar Após (30/10/2026) passa sozinho ao próximo.
 */
export function ApresentacaoDoRelatorio({
  relatorioId,
  periodo,
  slides,
  sumario,
  inicial,
  dados,
  cores,
  tipo,
  onSair,
}: {
  relatorioId: string;
  /** O período do relatório (Agosto/2026…), à direita do topo, depois de "Relatório Executivo". */
  periodo: string;
  slides: Slide[];
  /** As telas e os slides, com os números, para os blocos de Sumário (20/10/2026). */
  sumario: TelaDoSumario[];
  inicial: number;
  dados: DadosDoRelatorio | undefined;
  cores: Cores;
  tipo: TipoGrafico;
  onSair: () => void;
}) {
  const processo = useProcesso();
  const [k, setKAgora] = useState(inicial);
  // A troca em andamento (27/10/2026): o slide que sai, o sentido e a transição do que entra.
  const [troca, setTroca] = useState<Troca | null>(null);
  const setK = (proximo: number | ((x: number) => number)) => {
    const j = typeof proximo === "function" ? proximo(k) : proximo;
    if (j === k) return;
    const transicao = slides[j]?.transicao;
    setTroca(transicao ? { de: k, sentido: j > k ? 1 : -1, transicao } : null);
    setKAgora(j);
  };
  // O slide que sai some no fim da transição (também se a animação não terminar, como numa aba escondida).
  useEffect(() => {
    if (!troca) return;
    const t = window.setTimeout(() => setTroca(null), DURACAO_DA_TRANSICAO + 100);
    return () => window.clearTimeout(t);
  }, [troca]);
  // Os botões aparecem quando o mouse se move e somem 2,5 s depois (ficam enquanto o mouse está sobre eles).
  const [comBotoes, setComBotoes] = useState(false);
  const sobreOsBotoes = useRef(false);
  const relogio = useRef<number | undefined>(undefined);
  const mostrarBotoes = () => {
    setComBotoes(true);
    window.clearTimeout(relogio.current);
    relogio.current = window.setTimeout(() => {
      if (!sobreOsBotoes.current) setComBotoes(false);
    }, 2500);
  };
  useEffect(() => () => window.clearTimeout(relogio.current), []);
  const ir = (d: number) => setK((x) => Math.min(slides.length - 1, Math.max(0, x + d)));
  // Os grupos (17/10/2026): as abas. Recuar vai ao início do grupo anterior; avançar, ao início do próximo.
  const grupo = (i: number) => slides[i]?.chave.split("|")[0];
  const inicioDoGrupo = (i: number) => {
    let j = i;
    while (j > 0 && grupo(j - 1) === grupo(i)) j--;
    return j;
  };
  const inicio = inicioDoGrupo(k);
  const grupoAnterior = inicio > 0 ? inicioDoGrupo(inicio - 1) : null;
  const proximoGrupo = (() => {
    let j = k;
    while (j < slides.length && grupo(j) === grupo(k)) j++;
    return j < slides.length ? j : null;
  })();
  const sair = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    onSair();
  };
  // Avançar Após (30/10/2026, pedido do Adão): o slide com os segundos passa sozinho ao próximo (o último fica; com o
  // Recomeçar ao Terminar, 11/11/2026, volta ao primeiro). O tempo conta de novo a cada troca; com um bloco ampliado, o slide espera.
  const avancarApos = slides[k]?.avancarApos;
  const recomecar = !!slides[k]?.recomecarAoTerminar;
  const avancarSozinho = useEffectEvent(() => {
    if (document.querySelector("[data-bloco-ampliado]")) return;
    if (k >= slides.length - 1) setK(0);
    else ir(1);
  });
  useEffect(() => {
    if (!avancarApos || (k >= slides.length - 1 && !recomecar)) return;
    const t = window.setTimeout(avancarSozinho, avancarApos * 1000);
    return () => window.clearTimeout(t);
  }, [k, avancarApos, recomecar, slides.length]);
  useEffect(() => {
    // Sair da tela inteira pelo navegador (Esc) encerra a apresentação.
    const aoMudar = () => {
      if (!document.fullscreenElement) onSair();
    };
    const aoTeclar = (e: KeyboardEvent) => {
      // Com um bloco ampliado (20/10/2026: o vídeo usa o teclado), as teclas são dele; o Esc fecha o ampliado (a grade).
      if (document.querySelector("[data-bloco-ampliado]")) return;
      if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key)) ir(1);
      else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) ir(-1);
      else if (e.key === "Escape") sair();
      else return;
      e.preventDefault();
    };
    document.addEventListener("fullscreenchange", aoMudar);
    window.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("fullscreenchange", aoMudar);
      window.removeEventListener("keydown", aoTeclar);
    };
  });
  const slide = slides[k];
  const botao = "inline-flex size-9 items-center justify-center rounded-sm text-gray-100 hover:bg-gray-700 hover:text-white disabled:pointer-events-none disabled:opacity-40";
  return (
    <div role="dialog" aria-modal aria-label={`Apresentação: ${processo.nome} de ${periodo}`} className="fixed inset-0 z-[60] overflow-hidden bg-background select-none" onMouseMove={mostrarBotoes} onDragStart={(e) => e.preventDefault()}>
      <style>{ESTILO_DAS_TRANSICOES}</style>
      {/* O slide na tela padrão, na escala da tela de quem apresenta (27/10/2026); na troca, o que sai e o que entra. */}
      <TelaNaEscala>
        {troca && slides[troca.de] ? (
          <div key={`sai-${slides[troca.de].chave}`} aria-hidden className="absolute inset-0 bg-background" style={animacao(troca, "sai")}>
            <SlideDoRelatorio relatorioId={relatorioId} periodo={periodo} slide={slides[troca.de]} sumario={sumario} dados={dados} cores={cores} tipo={tipo} />
          </div>
        ) : null}
        <div key={`entra-${slide?.chave}`} className="absolute inset-0 bg-background" style={troca ? animacao(troca, "entra") : undefined}>
          <SlideDoRelatorio relatorioId={relatorioId} periodo={periodo} slide={slide} sumario={sumario} dados={dados} cores={cores} tipo={tipo} />
        </div>
      </TelaNaEscala>
      <nav
        aria-label="Slides"
        onMouseEnter={() => (sobreOsBotoes.current = true)}
        onMouseLeave={() => {
          sobreOsBotoes.current = false;
          mostrarBotoes();
        }}
        className={`fixed bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-sm bg-gray-800 p-1 shadow-lg transition-opacity duration-300 ${comBotoes ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        {/* Os botões dos grupos só nos relatórios (31/10/2026: o painel de bordo tem uma tela só). */}
        {processo.comGrupos ? (
          <button type="button" className={botao} disabled={grupoAnterior === null} onClick={() => grupoAnterior !== null && setK(grupoAnterior)} title="Grupo anterior" aria-label="Grupo anterior">
            <ChevronsLeft className="size-5" />
          </button>
        ) : null}
        <button type="button" className={botao} disabled={k === 0} onClick={() => ir(-1)} title="Slide anterior (←)" aria-label="Slide anterior">
          <ChevronLeft className="size-5" />
        </button>
        <button type="button" className={botao} disabled={k >= slides.length - 1} onClick={() => ir(1)} title="Próximo slide (→)" aria-label="Próximo slide">
          <ChevronRight className="size-5" />
        </button>
        {processo.comGrupos ? (
          <button type="button" className={botao} disabled={proximoGrupo === null} onClick={() => proximoGrupo !== null && setK(proximoGrupo)} title="Próximo grupo" aria-label="Próximo grupo">
            <ChevronsRight className="size-5" />
          </button>
        ) : null}
        <span className="mx-1 h-6 w-px bg-gray-600" />
        <button type="button" className={botao} onClick={sair} title="Sair da apresentação (Esc)" aria-label="Sair da apresentação">
          <Minimize2 className="size-4" />
        </button>
      </nav>
    </div>
  );
}

/**
 * Um slide (22/10/2026: separado da apresentação, para a exportação em PDF sair igual): o topo, a Imagem de Fundo, a grade
 * dos blocos e o rodapé, na tela inteira. `paraImagem`: sem o destaque e a ampliação dos blocos, e os vídeos como quadros.
 */
export function SlideDoRelatorio({
  relatorioId,
  periodo,
  slide,
  sumario,
  dados,
  cores,
  tipo,
  paraImagem = false,
}: {
  relatorioId: string;
  periodo: string;
  slide: Slide | undefined;
  sumario: TelaDoSumario[];
  dados: DadosDoRelatorio | undefined;
  cores: Cores;
  tipo: TipoGrafico;
  paraImagem?: boolean;
}) {
  const processo = useProcesso();
  return (
    <>
    {/*
      O topo e as margens do slide: os de linhasDaPagina, para a página caber inteira na tela. Embaixo da página, o rodapé
      (22/10/2026), no espaço que sobra até o pé da tela.
    */}
    <div className="flex h-full flex-col px-8 pt-6">
      {/*
        À esquerda, o grupo (o título da aba: Introdução…) em cinza, a seta dos caminhos do topo das telas, em cinza, e o
        nome do slide (o da página) em preto; à direita, "Relatório Executivo" (num painel, "Painel de Bordo") em cinza, a seta e
        o período em preto (20/10/2026; antes, o traço e "RE - período" em preto), logo antes da logo da BPM (16/10/2026). A logo, de 30 px,
        fica centrada na altura da barra, sem mudar a altura dela.
      */}
      {/* O contador (20/10/2026), no centro: o número do slide e o total, contados da Introdução em diante; na Capa e no Encerramento, sem ele. */}
      <header className="relative mb-4 flex h-10 items-center gap-1.5 border-b border-gray-200 pb-3">
        <span className="shrink-0 text-lg font-semibold whitespace-nowrap text-gray-500">{slide?.nome}</span>
        <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-gray-500" />
        <h1 className="min-w-0 truncate text-lg font-bold text-gray-900">{slide?.pagina}</h1>
        <span className="ml-auto shrink-0 text-lg font-semibold whitespace-nowrap text-gray-500">{processo.nome}</span>
        <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-gray-500" />
        <span className="shrink-0 pr-1.5 text-lg font-bold whitespace-nowrap text-gray-900">{periodo}</span>
        <BpmLogo className="h-[30px] w-auto shrink-0" />
      </header>
      {/*
        A Imagem de Fundo (20/10/2026): o slide inteiro, por cima do cabeçalho (vem depois dele) e atrás dos blocos (a grade
        vem depois dela).
      */}
      {slide?.fundo ? <CamadaDoFundo key={slide.chave} relatorioId={relatorioId} fundo={slide.fundo} className="absolute inset-0" /> : null}
      {slide ? (
        <div className="relative">
          <GradeDoRelatorio
              key={slide.chave}
              relatorioId={relatorioId}
              blocos={slide.blocos}
              sumario={sumario}
              dados={dados}
              editavel={false}
              cores={cores}
              tipo={tipo}
              linhas={linhasDaPagina()}
              ampliavel={!paraImagem}
              paraImagem={paraImagem}
              onMudar={() => undefined}
            />
        </div>
      ) : null}
      {/*
        O rodapé (22/10/2026), com o separador igual ao do cabeçalho: à esquerda, a legenda dos cards, como a da tela Painel
        de Bordo (só nos slides com cards do Painel ou dos Indicadores); à direita, o contador dos slides, com o número do
        slide em preto e negrito (antes, no centro do cabeçalho); na Capa e no Encerramento, sem ele.
      */}
      <footer className="relative mt-auto flex min-h-6 flex-1 items-center justify-between gap-4">
        {/*
          O separador atrás da Imagem de Fundo (22/10/2026): numa camada abaixo das posicionadas (a imagem a cobre); a legenda
          e o contador ficam por cima dela.
        */}
        <span aria-hidden className="absolute inset-x-0 top-0 -z-10 border-t border-gray-200" />
        {/*
          Com cards PROVA (31/10/2026), a legenda traz os cenários do slide, cada um na cor dele, e o nome do cenário de
          comparação só com cards padrão.
        */}
        <div>
          {slide?.blocos.some((b) => b.tipo === "PAINEL" || b.tipo === "INDICADOR") ? (
            <LegendaDoPainel
              tipo={tipo}
              cores={cores}
              comparado={slide.blocos.some((b) => (b.tipo === "PAINEL" || b.tipo === "INDICADOR") && !ehProva(b)) ? dados?.painel.cenarioOrcado : null}
              comparados={seriesDaLegenda(slide.blocos, dados)}
            />
          ) : null}
        </div>
        {slide?.numero ? (
          <span className="shrink-0 text-lg font-semibold whitespace-nowrap text-gray-500">
            <span className="font-bold text-gray-900">{slide.numero}</span>/{slide.total}
          </span>
        ) : null}
      </footer>
    </div>
    </>
  );
}
