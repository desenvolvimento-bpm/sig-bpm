"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, RotateCcw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { botaoPrimario } from "@/app/cenarios/components/CenarioDialog";

/**
 * A Introdução ao SIG (21/10/2026; o arquivo "Apresentação SIG"), aberta pelo menu do usuário: um tour em etapas, num
 * modelo único que se sobrepõe à tela atual. As etapas com `alvo` destacam a parte da tela (o seletor, em geral um
 * data-tour nos componentes comuns: o menu lateral, o cabeçalho, a barra de atividades, o título, as ações e as abas);
 * quando a tela atual não tem a parte (ou ela está escondida, como o menu lateral no celular), a etapa aparece no centro,
 * com o aviso `semAlvo`. Assim o tour vale em qualquer tela, sem depender de nenhuma.
 */
type Etapa = { titulo: string; texto: ReactNode; alvo?: string; semAlvo?: string };

const ETAPAS: Etapa[] = [
  {
    titulo: "Introdução ao SIG",
    texto: (
      <p>
        O SIG (Sistemas de Informações Gerenciais) é uma metodologia que centraliza e padroniza as informações e os relatórios
        fornecidos pela Controladoria, com o intuito de instrumentalizar a inteligência da empresa. O SIG da BPM era operado de
        forma caseira, via Excel, e agora, com o advento da IA, passa a ser uma ferramenta web, com recursos e acessibilidade
        superiores.
      </p>
    ),
  },
  {
    titulo: "Layout",
    texto: (
      <p>
        O SIG tem uma estrutura padronizada, voltada à facilidade da operação, que agrupa as atividades de um processo na mesma
        tela. Além disso, as telas seguem padrões que aproveitam o espaço útil dos cabeçalhos, pensando na horizontalidade dos
        monitores. As próximas etapas mostram cada parte na tela em que você está.
      </p>
    ),
  },
  {
    titulo: "Menu Lateral (Processos)",
    alvo: '[data-slot="sidebar-container"]',
    texto: <p>À esquerda, no menu lateral, estão todos os processos já desenvolvidos no SIG, agrupados por finalidade.</p>,
    semAlvo: "O menu lateral está escondido nesta largura de tela: use o botão de recolher o menu, no canto de cima, para abri-lo.",
  },
  {
    titulo: "Telas (Atividades dos Processos)",
    texto: (
      <>
        <p>As telas têm a estrutura padronizada, que as próximas etapas destacam:</p>
        <ol className="list-decimal space-y-0.5 pl-5">
          <li>o botão de recolher o menu;</li>
          <li>o caminho da tela, na parte de cima;</li>
          <li>o menu do usuário;</li>
          <li>a barra de atividades;</li>
          <li>o título da tela, com o “Sobre Esta Tela” e o “Como Usar Esta Tela”;</li>
          <li>os botões de ação da tela;</li>
          <li>as abas, com os segmentos das atividades e os seus conteúdos.</li>
        </ol>
      </>
    ),
  },
  {
    titulo: "(1) Recolher o Menu",
    alvo: '[data-slot="sidebar-trigger"]',
    texto: <p>Recolhe o menu lateral (e o abre de novo), para deixar mais espaço para a tela.</p>,
  },
  {
    titulo: "(2) Caminho da Tela",
    alvo: '[data-slot="breadcrumb"]',
    texto: <p>Mostra onde você está: o processo e a tela. Clique num nível acima para voltar a ele.</p>,
    semAlvo: "Nesta largura de tela, o caminho fica escondido.",
  },
  {
    titulo: "(3) Menu do Usuário",
    alvo: '[data-tour="menu-do-usuario"]',
    texto: (
      <p>
        O seu nome e o seu perfil, a Tela Inicial (o processo que o SIG abre ao entrar), o Tema (Padrão, Claro ou Escuro), a Acessibilidade (Daltonismo), as Novidades (as
        atualizações do SIG nas telas que você acessa, por dia, processo e tela; com alguma ainda não vista, um sino balança
        ao lado do nome), Trocar Senha, Sair e esta Introdução ao SIG, para revê-la quando quiser. Para o Administrador, ao
        lado do nome, quantos usuários estão online (os nomes aparecem ao parar o mouse em cima).
      </p>
    ),
  },
  {
    titulo: "(4) Barra de Atividades",
    alvo: '[data-tour="barra-de-atividades"]',
    texto: (
      <p>
        O nome do processo, em amarelo-ouro, e as telas (atividades) dele, com a atual em destaque: por exemplo, as etapas do
        mês no Fechamento Mensal, as telas de um cenário ou as abas de um Relatório Executivo.
      </p>
    ),
    semAlvo: "Esta tela não tem a barra de atividades: ela aparece nos processos com mais de uma tela.",
  },
  {
    titulo: "(5) Título da Tela",
    alvo: '[data-tour="titulo-da-tela"]',
    texto: (
      <p>
        O nome da tela e, ao lado, o ícone de informação, que abre o “Sobre Esta Tela” (o que a tela faz e de onde vêm os dados)
        e o “Como Usar Esta Tela” (os passos, com os nomes dos botões e das abas).
      </p>
    ),
    semAlvo: "Esta tela não tem o título padronizado.",
  },
  {
    titulo: "(6) Botões de Ação",
    alvo: '[data-tour="acoes-da-tela"]',
    texto: (
      <p>
        As ações da tela, na linha do título: filtros, exportar, gravar, adicionar… Ao rolar a tela para baixo, o título e os
        botões de ação continuam no topo, assim como os rótulos das tabelas, quando houver.
      </p>
    ),
    semAlvo: "Esta tela não tem botões de ação. Nas que têm, eles ficam na linha do título e continuam no topo ao rolar a tela.",
  },
  {
    titulo: "(7) Abas (Segmentos das Atividades)",
    alvo: '[data-tour="abas"]',
    texto: (
      <p>
        As abas têm a parte prática do SIG: a visualização e o tratamento das informações. Em telas sem abas, as informações são
        listadas logo abaixo do título.
      </p>
    ),
    semAlvo: "Esta tela não tem abas: as informações aparecem logo abaixo do título.",
  },
  {
    titulo: "Bom Trabalho",
    texto: (
      <p>
        Esta é a estrutura de todas as telas do SIG. Para rever esta introdução, abra o menu do usuário, no canto de cima, e
        escolha “Introdução ao SIG”.
      </p>
    ),
  },
];

/** A primeira parte visível da tela que casa com o seletor (com tamanho e sem estar escondida). */
function parteVisivel(seletor: string): HTMLElement | null {
  for (const e of document.querySelectorAll<HTMLElement>(seletor)) {
    const r = e.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden") return e;
  }
  return null;
}

const FOLGA = 6;
const MARGEM = 16;
const LARGURA = 520;

/** O lugar do quadro: embaixo, em cima, à direita ou à esquerda do destaque, no primeiro que couber; senão, no centro. */
function lugarDoQuadro(r: DOMRect | null, altura: number): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const largura = Math.min(LARGURA, vw - 2 * MARGEM);
  const centro: CSSProperties = { left: (vw - largura) / 2, top: Math.max(MARGEM, (vh - altura) / 2), width: largura };
  if (!r) return centro;
  const x = Math.min(Math.max(MARGEM, r.left + r.width / 2 - largura / 2), vw - largura - MARGEM);
  const y = Math.min(Math.max(MARGEM, r.top + r.height / 2 - altura / 2), vh - altura - MARGEM);
  if (r.bottom + FOLGA + 12 + altura <= vh - MARGEM) return { left: x, top: r.bottom + FOLGA + 12, width: largura };
  if (r.top - FOLGA - 12 - altura >= MARGEM) return { left: x, top: r.top - FOLGA - 12 - altura, width: largura };
  if (r.right + FOLGA + 12 + largura <= vw - MARGEM) return { left: r.right + FOLGA + 12, top: y, width: largura };
  if (r.left - FOLGA - 12 - largura >= MARGEM) return { left: r.left - FOLGA - 12 - largura, top: y, width: largura };
  return centro;
}

/**
 * Aberta ou não: o menu do usuário (no cabeçalho) abre, e o layout desenha o tour fora da área da tela, ao lado do menu
 * lateral, para o escurecimento cobrir os dois.
 */
let aberta = false;
const ouvintes = new Set<() => void>();
const mudar = (v: boolean) => {
  aberta = v;
  ouvintes.forEach((o) => o());
};
export const abrirIntroducao = () => mudar(true);

/** O tour, quando aberto pelo menu do usuário (no ProtectedLayout). */
export function IntroducaoDoLayout() {
  const aberto = useSyncExternalStore(
    (o) => {
      ouvintes.add(o);
      return () => ouvintes.delete(o);
    },
    () => aberta,
    () => false,
  );
  return aberto ? <IntroducaoAoSig onEncerrar={() => mudar(false)} /> : null;
}

function IntroducaoAoSig({ onEncerrar }: { onEncerrar: () => void }) {
  const [n, setN] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [alturaDoQuadro, setAlturaDoQuadro] = useState(320);
  const quadro = useRef<HTMLDivElement>(null);
  const etapa = ETAPAS[n];
  const ultima = n === ETAPAS.length - 1;

  // A parte da etapa: rola até ela (se preciso) e mede; sem ela, o quadro vai para o centro.
  const medir = useCallback(() => {
    const e = etapa.alvo ? parteVisivel(etapa.alvo) : null;
    setRect(e ? e.getBoundingClientRect() : null);
  }, [etapa.alvo]);
  useLayoutEffect(() => {
    const e = etapa.alvo ? parteVisivel(etapa.alvo) : null;
    e?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const quadroDaTela = requestAnimationFrame(medir);
    return () => cancelAnimationFrame(quadroDaTela);
  }, [etapa.alvo, medir]);
  useEffect(() => {
    window.addEventListener("resize", medir);
    window.addEventListener("scroll", medir, true);
    return () => {
      window.removeEventListener("resize", medir);
      window.removeEventListener("scroll", medir, true);
    };
  }, [medir]);
  // A altura do quadro, para o lugar dele caber na tela.
  useEffect(() => {
    const q = quadro.current;
    if (!q) return;
    const obs = new ResizeObserver(() => setAlturaDoQuadro(q.offsetHeight));
    obs.observe(q);
    return () => obs.disconnect();
  }, []);
  useEffect(() => quadro.current?.focus(), [n]);

  const anterior = useCallback(() => setN((x) => Math.max(0, x - 1)), []);
  const proximo = useCallback(() => setN((x) => Math.min(ETAPAS.length - 1, x + 1)), []);
  // O teclado: as setas trocam de etapa e o Esc encerra.
  useEffect(() => {
    const tecla = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        onEncerrar();
      } else if (ev.key === "ArrowRight") proximo();
      else if (ev.key === "ArrowLeft") anterior();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [anterior, proximo, onEncerrar]);

  const semParte = !!etapa.alvo && !rect;
  return (
    // Fixo sobre a tela, acima de tudo (camada 60; os modais e os menus ficam na 50), bloqueando os cliques por baixo.
    <div className="fixed inset-0 z-[60]">
      {rect ? (
        // O destaque: um recorte da tela, com a borda amarelo-ouro, e o resto escurecido pela sombra dele.
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-md ring-2 ring-bpm-primary transition-all duration-200"
          style={{
            left: rect.left - FOLGA,
            top: rect.top - FOLGA,
            width: rect.width + 2 * FOLGA,
            height: rect.height + 2 * FOLGA,
            boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.55)",
          }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-black/55" />
      )}
      <div
        ref={quadro}
        role="dialog"
        aria-modal="true"
        aria-labelledby="introducao-titulo"
        tabIndex={-1}
        className="absolute flex max-h-[calc(100vh-2rem)] flex-col rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white text-sm text-gray-700 shadow-xl outline-none"
        style={lugarDoQuadro(rect, alturaDoQuadro)}
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 pt-3 pb-2">
          <div className="min-w-0">
            <p className="text-xs text-gray-500">
              Introdução ao SIG · Etapa {n + 1} de {ETAPAS.length}
            </p>
            <h2 id="introducao-titulo" className="text-base font-bold text-gray-900">
              {etapa.titulo}
            </h2>
          </div>
          <button type="button" onClick={onEncerrar} aria-label="Encerrar a introdução" title="Encerrar" className="rounded-sm p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900">
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 space-y-2 overflow-y-auto px-4 py-3 leading-relaxed">
          {etapa.texto}
          {semParte && etapa.semAlvo ? <p className="rounded-sm bg-gray-100 px-2 py-1.5 text-xs text-gray-600">{etapa.semAlvo}</p> : null}
        </div>
        {/* O andamento: um traço por etapa, a atual em amarelo-ouro. */}
        <div className="flex gap-1 px-4" aria-hidden>
          {ETAPAS.map((_, i) => (
            <span key={i} className={`h-1 flex-1 rounded-full ${i === n ? "bg-bpm-primary" : i < n ? "bg-gray-400" : "bg-gray-200"}`} />
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 pb-3">
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="rounded-sm" onClick={() => setN(0)} disabled={n === 0}>
              <RotateCcw className="size-4" />
              Reiniciar
            </Button>
            <Button type="button" variant="outline" className="rounded-sm" onClick={onEncerrar}>
              Encerrar
            </Button>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="rounded-sm" onClick={anterior} disabled={n === 0}>
              <ChevronLeft className="size-4" />
              Anterior
            </Button>
            <Button type="button" className={botaoPrimario} onClick={proximo} disabled={ultima}>
              Próximo
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
