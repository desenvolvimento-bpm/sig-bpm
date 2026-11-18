"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

/**
 * Os grupos recolhidos do Painel de Bordo (21/10/2026), pela chave (nas abas Resultados e Performance, o título do grupo;
 * na aba Variações, 18/11/2026, "variacoes:" e o nome da unidade), guardados no navegador.
 */
const CHAVE_DOS_RECOLHIDOS = "sig.painel.recolhidos";
function lerRecolhidos(): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(CHAVE_DOS_RECOLHIDOS) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
export function useGrupoRecolhido(chave: string): [boolean, () => void] {
  const [recolhido, setRecolhido] = useState(() => (typeof window === "undefined" ? false : lerRecolhidos().has(chave)));
  const alternar = () => {
    const novo = !recolhido;
    setRecolhido(novo);
    try {
      const todos = lerRecolhidos();
      if (novo) todos.add(chave);
      else todos.delete(chave);
      window.localStorage.setItem(CHAVE_DOS_RECOLHIDOS, JSON.stringify([...todos]));
    } catch {
      // Sem o armazenamento do navegador, vale só nesta tela.
    }
  };
  return [recolhido, alternar];
}

/** A seta antes do nome do grupo, que recolhe e expande os cards dele (21/10/2026; a mesma em todas as abas do Painel de Bordo). */
export function BotaoRecolherGrupo({ recolhido, onAlternar, nome }: { recolhido: boolean; onAlternar: () => void; nome: string }) {
  return (
    <button
      type="button"
      onClick={onAlternar}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900"
      title={recolhido ? "Expandir o grupo" : "Recolher o grupo"}
      aria-label={recolhido ? `Expandir ${nome}` : `Recolher ${nome}`}
      aria-expanded={!recolhido}
    >
      {recolhido ? <ChevronRight className="size-5" /> : <ChevronDown className="size-5" />}
    </button>
  );
}
