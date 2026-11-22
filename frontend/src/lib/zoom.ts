"use client";

import { useSyncExternalStore } from "react";

import { CHAVE_ZOOM } from "./temaScript";

/**
 * O zoom da ferramenta (18/11/2026, pedido do Adão: as telas ficavam grandes nos monitores de resolução maior), escolhido no
 * menu do usuário, logo abaixo da Acessibilidade, e guardado neste navegador: Menor (85%), Padrão (100%) ou Máximo (125%). Vai
 * no atributo data-zoom do <html>; o globals.css muda o tamanho da fonte da raiz, que os tamanhos em rem (os textos, os
 * espaçamentos, o menu e os cards) acompanham.
 */
export type Zoom = "85" | "100" | "125";

/** `icone` (22/11/2026, pedido do Adão): o que o menu do usuário mostra no lugar do rótulo (A↓, A e A↑). */
export const ZOOMS: Array<{ valor: Zoom; rotulo: string; icone: string; dica: string }> = [
  { valor: "85", rotulo: "Menor", icone: "A↓", dica: "Menor: 85% do tamanho padrão" },
  { valor: "100", rotulo: "Padrão", icone: "A", dica: "Padrão: o tamanho padrão (100%)" },
  { valor: "125", rotulo: "Máximo", icone: "A↑", dica: "Máximo: 125% do tamanho padrão" },
];

const ouvintes = new Set<() => void>();

const lerZoom = (): Zoom => {
  const z = typeof document === "undefined" ? null : document.documentElement.dataset.zoom;
  return z === "85" || z === "125" ? z : "100";
};

export function aplicarZoom(zoom: Zoom) {
  const html = document.documentElement;
  if (zoom === "100") delete html.dataset.zoom;
  else html.dataset.zoom = zoom;
  try {
    window.localStorage.setItem(CHAVE_ZOOM, zoom);
  } catch {
    // sem armazenamento: o zoom vale só nesta visita
  }
  ouvintes.forEach((avisar) => avisar());
  // As telas que medem o próprio tamanho (os títulos presos, as tabelas largas) refazem as contas.
  window.dispatchEvent(new Event("resize"));
}

export function useZoom(): [Zoom, (z: Zoom) => void] {
  const zoom = useSyncExternalStore(
    (avisar) => {
      ouvintes.add(avisar);
      return () => ouvintes.delete(avisar);
    },
    lerZoom,
    () => "100" as Zoom,
  );
  return [zoom, aplicarZoom];
}
