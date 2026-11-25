"use client";

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { guardarNomesDasUnidades, nomeDaUnidade as nomeGuardado } from "@/lib/nomesDasUnidades";

/** A chave da consulta, para o cadastro Unidades atualizar as telas depois de gravar. */
export const CHAVE_DOS_NOMES_DAS_UNIDADES = ["cadastros", "unidades", "nomes"] as const;

/**
 * Os nomes das unidades no cadastro (25/11/2026: mudam a qualquer momento), em `lib/nomesDasUnidades.ts`. A tela que mostra
 * uma unidade usa este hook: ele busca os nomes, guarda-os para as listas fixas e desenha a tela de novo quando chegam.
 */
export function useNomesDasUnidades() {
  const { data } = useQuery({
    queryKey: CHAVE_DOS_NOMES_DAS_UNIDADES,
    queryFn: async () => {
      const lista = (await api.get<Array<{ codigo: number; nome: string }>>("/cadastros/unidades/nomes")).data;
      guardarNomesDasUnidades(lista);
      return lista;
    },
    staleTime: 5 * 60 * 1000,
  });
  // Os nomes já em cache (de outra tela) também valem para as listas fixas.
  if (data) guardarNomesDasUnidades(data);
  const nomeDaUnidade = useCallback((codigo: number | string) => (data?.find((u) => u.codigo === Number(codigo))?.nome ?? nomeGuardado(codigo)), [data]);
  const nomeDaVisao = useCallback((visao: number | string) => (Number(visao) === 0 ? "Consolidado" : nomeDaUnidade(visao)), [nomeDaUnidade]);
  return { nomeDaUnidade, nomeDaVisao };
}
