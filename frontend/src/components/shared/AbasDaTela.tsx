"use client";

import { createContext, useContext } from "react";

/**
 * As abas da tela aberta (17/10/2026: os Cadastros Gerais — Contábil, Controladoria e Analítico): o layout
 * as descobre pelo endereço (navigation-config, `abasDaTela`) e o `CabecalhoDaTela` mostra o nome da tela no título e
 * as abas logo abaixo dele, cada uma com o endereço do cadastro dela.
 */
export type AbasDaTelaAberta = { titulo: string; abas: Array<{ title: string; href: string }>; ativa: string };

export const AbasDaTela = createContext<AbasDaTelaAberta | null>(null);
export const useAbasDaTela = () => useContext(AbasDaTela);
