"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

/** A distância entre os rótulos presos da tabela e o destaque flutuante, em px. */
const DISTANCIA = 8;

type Elemento = HTMLDivElement | null;

/** O destaque flutuante: os refs (de função) dos três elementos e se a cópia flutua. */
export type DestaqueQueFlutua = {
  /** O ref do destaque no lugar dele, acima da tabela. */
  refOriginal: (el: Elemento) => void;
  /** O ref da área da tabela: contém o DestaqueFlutuante e a tabela, com os rótulos presos ([data-topo-da-tabela]). */
  refArea: (el: Elemento) => void;
  /** O ref da cópia flutuante (a altura dela decide se ainda cabe sobre a tabela). */
  refFlutuante: (el: Elemento) => void;
  flutuar: boolean;
  /** A altura dos rótulos presos: o destaque flutua logo abaixo deles. */
  rotulos: number;
};

/**
 * O destaque flutuante (16/11/2026, pedido do Adão): ao rolar a tela, quando os rótulos da tabela ficam presos no topo (e o
 * destaque acima dela já passou para baixo do título da tela), uma cópia do destaque flutua sobre a tabela, um pouco abaixo
 * dos rótulos, com as mesmas funções. Cada tabela tem o seu: com várias tabelas na tela, vale o da tabela cujos rótulos estão
 * presos (a cópia some quando a tabela acaba). `ativo`: a tabela tem destaque.
 *
 * Uso: `const { refOriginal, refArea, refFlutuante, flutuar, rotulos } = useDestaqueFlutuante()`; o destaque no lugar dele
 * com `ref={refOriginal}`, e a tabela dentro de um quadro com `ref={refArea}`, que começa pelo <DestaqueFlutuante> (com os
 * outros três); os rótulos presos da tabela levam `data-topo-da-tabela` (TabelaLarga, TabelaEditavel).
 */
export function useDestaqueFlutuante(ativo = true): DestaqueQueFlutua {
  // Os elementos em estado (refs de função): a medida recomeça quando eles entram na tela.
  const [original, setOriginal] = useState<Elemento>(null);
  const [area, setArea] = useState<Elemento>(null);
  const [flutuante, setFlutuante] = useState<Elemento>(null);
  const [estado, setEstado] = useState({ flutuar: false, rotulos: 0 });
  const medir = useCallback(() => {
    const topo = area?.querySelector<HTMLElement>("[data-topo-da-tabela]");
    if (!ativo || !area || !original || !topo || !original.offsetParent) {
      setEstado((e) => (e.flutuar ? { ...e, flutuar: false } : e));
      return;
    }
    // Onde os rótulos param (logo abaixo do título da tela: --topo-tabela).
    const parada = parseFloat(getComputedStyle(topo).top) || 0;
    const rTopo = topo.getBoundingClientRect();
    const rOriginal = original.getBoundingClientRect();
    const altura = flutuante?.offsetHeight || rOriginal.height;
    // Os rótulos presos, com o destaque original já acima deles (escondido pelo título da tela)…
    const preso = rTopo.top <= parada + 0.5 && rOriginal.bottom <= rTopo.top + 0.5;
    // …e a tabela ainda embaixo da cópia (no fim dela, a cópia sai antes de passar para a próxima).
    const cabe = area.getBoundingClientRect().bottom >= rTopo.bottom + DISTANCIA + altura;
    const flutuar = preso && cabe;
    const rotulos = Math.round(rTopo.height);
    setEstado((e) => (e.flutuar === flutuar && e.rotulos === rotulos ? e : { flutuar, rotulos }));
  }, [ativo, area, original, flutuante]);
  useEffect(() => {
    let quadro = 0;
    const pedir = () => {
      if (!quadro)
        quadro = requestAnimationFrame(() => {
          quadro = 0;
          medir();
        });
    };
    window.addEventListener("scroll", pedir, { passive: true });
    window.addEventListener("resize", pedir);
    // A tabela e o destaque mudam de altura (linhas novas, a busca, a marcação).
    const observador = new ResizeObserver(pedir);
    for (const el of [area, original]) if (el) observador.observe(el);
    pedir();
    return () => {
      window.removeEventListener("scroll", pedir);
      window.removeEventListener("resize", pedir);
      observador.disconnect();
      cancelAnimationFrame(quadro);
    };
  }, [medir, area, original]);
  return { refOriginal: setOriginal, refArea: setArea, refFlutuante: setFlutuante, ...estado };
}

/**
 * A cópia flutuante do destaque, no começo da área da tabela: presa logo abaixo dos rótulos presos (sem altura no lugar
 * dela, para não mexer na tabela), por cima das linhas, com a sombra de um cartão solto.
 */
export function DestaqueFlutuante({ refFlutuante, flutuar, rotulos, children }: Omit<DestaqueQueFlutua, "refOriginal" | "refArea"> & { children: ReactNode }) {
  return (
    <div className="pointer-events-none sticky z-30 h-0" style={{ top: `calc(var(--topo-tabela, 0px) + ${rotulos + DISTANCIA}px)` }}>
      {flutuar ? (
        // Fora da imagem da tabela.
        <div ref={refFlutuante} data-fora-da-imagem className="pointer-events-auto absolute inset-x-0 top-0 rounded-sm shadow-lg">
          {children}
        </div>
      ) : null}
    </div>
  );
}
