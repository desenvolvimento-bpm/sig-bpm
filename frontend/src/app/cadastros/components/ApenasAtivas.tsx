"use client";

import { useMemo, useState } from "react";

export type ControleApenasAtivas = { marcado: boolean; onMudar: (marcado: boolean) => void };

/**
 * A caixa "Apenas Ativas" dos Cadastros Gerais (11/10/2026): marcada, a tabela esconde os registros
 * inativos (nas regras de rateio, os de vigência encerrada). Começa desmarcada, com o cadastro inteiro.
 */
export function useApenasAtivas<T>(itens: T[] | undefined, ativo: (t: T) => boolean) {
  const [marcado, setMarcado] = useState(false);
  const visiveis = useMemo(() => (marcado && itens ? itens.filter(ativo) : itens), [itens, marcado, ativo]);
  return { itens: visiveis, controle: { marcado, onMudar: setMarcado } satisfies ControleApenasAtivas };
}

/** A caixa, na linha do título da tela, logo antes dos botões. */
export function CaixaApenasAtivas({ marcado, onMudar }: ControleApenasAtivas) {
  return (
    <label className="flex items-center gap-2 text-sm whitespace-nowrap text-gray-700">
      <input type="checkbox" checked={marcado} onChange={(e) => onMudar(e.target.checked)} className="size-4 accent-black" />
      Apenas Ativas
    </label>
  );
}

/** O registro está ativo: o campo Ativo/Ativa; sem ele, a vigência (regras de rateio) ainda não encerrada. */
export function registroAtivo(r: Record<string, unknown>) {
  if ("ativo" in r) return r.ativo !== false;
  const fim = r.vigenciaFim;
  if (typeof fim === "string" && fim) return fim >= new Date().toISOString().slice(0, 10);
  return true;
}
