"use client";

import { itemPermitido, navGrupos } from "./navigation-config";

/**
 * A Tela Inicial (13/11/2026, pedido do Adão): o processo que o SIG abre ao entrar (depois do login sem um destino pedido e
 * no endereço raiz), escolhido no menu do usuário e guardado neste navegador, por usuário. Sem a escolha, ou sem a
 * permissão do processo escolhido, vale o início de sempre (o Fechamento Mensal ou a primeira tela que o perfil alcança).
 */
const chave = (usuarioId: string) => `sig:tela-inicial:${usuarioId}`;

export function lerTelaInicial(usuarioId: string): string | null {
  try {
    return window.localStorage.getItem(chave(usuarioId));
  } catch {
    return null;
  }
}

export function gravarTelaInicial(usuarioId: string, processo: string | null) {
  try {
    if (processo) window.localStorage.setItem(chave(usuarioId), processo);
    else window.localStorage.removeItem(chave(usuarioId));
  } catch {
    // Sem o armazenamento do navegador, a escolha vale só nesta visita.
  }
}

/** Os processos que o perfil alcança (sem os em desenvolvimento), por grupo do menu lateral, com o endereço de cada um. */
export function processosAcessiveis(pode: (p: string) => boolean) {
  return navGrupos
    .map((g) => ({
      grupo: g.titulo,
      processos: g.itens.flatMap((item) => {
        if (item.emDesenvolvimento) return [];
        const permitido = itemPermitido(item, pode);
        return permitido ? [{ titulo: item.title, href: permitido.href }] : [];
      }),
    }))
    .filter((g) => g.processos.length > 0);
}

/** O endereço da Tela Inicial: o do processo escolhido, quando o perfil ainda o alcança; senão, nulo. */
export function enderecoDaTelaInicial(usuarioId: string, pode: (p: string) => boolean): string | null {
  const escolhido = lerTelaInicial(usuarioId);
  if (!escolhido) return null;
  return processosAcessiveis(pode).flatMap((g) => g.processos).find((p) => p.titulo === escolhido)?.href ?? null;
}
