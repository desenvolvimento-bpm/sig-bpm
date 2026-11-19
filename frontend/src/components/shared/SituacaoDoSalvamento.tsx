"use client";

import { useEffect, useState } from "react";
import { useIsMutating, useQueryClient } from "@tanstack/react-query";
import { CloudCheck, CloudOff, LoaderCircle } from "lucide-react";

const CLASSE = "inline-flex h-9 items-center gap-1.5 rounded-sm px-2 text-sm whitespace-nowrap";

/** A mensagem do erro da gravação (a do servidor, quando há). */
function mensagem(erro: unknown) {
  const e = erro as { response?: { data?: { error?: string } }; message?: string } | null;
  return e?.response?.data?.error ?? e?.message ?? "Não foi possível salvar.";
}

/**
 * A situação do salvamento (18/11/2026, pedido do Adão: nas Premissas dos Cenários Analíticos, como a dos Relatórios
 * Executivos): "Salvando…" enquanto alguma gravação da tela está em andamento, "Salvo às 14:32" depois da última que deu certo e
 * "Não Salvo", em vermelho, quando a última falhou (o motivo na dica). As gravações são as da tela (as mutações do React Query):
 * cada modal grava ao confirmar, sem botão de gravar à parte.
 */
export function SituacaoDoSalvamento({ dica = "Cada alteração se salva ao ser confirmada." }: { dica?: string }) {
  const queryClient = useQueryClient();
  const salvando = useIsMutating() > 0;
  const [estado, setEstado] = useState<{ em: Date | null; erro: string | null }>({ em: null, erro: null });
  useEffect(
    () =>
      queryClient.getMutationCache().subscribe((e) => {
        if (e.type !== "updated") return;
        if (e.action.type === "success") setEstado({ em: new Date(), erro: null });
        else if (e.action.type === "error") setEstado((x) => ({ ...x, erro: mensagem(e.mutation.state.error) }));
      }),
    [queryClient],
  );
  if (salvando) {
    return (
      <span className={`${CLASSE} text-gray-500`} role="status">
        <LoaderCircle className="size-4 animate-spin" />
        Salvando…
      </span>
    );
  }
  if (estado.erro) {
    return (
      <span className={`${CLASSE} font-semibold text-red-700`} role="status" title={estado.erro}>
        <CloudOff className="size-4" />
        Não Salvo
      </span>
    );
  }
  return (
    <span className={`${CLASSE} text-gray-500`} role="status" title={dica}>
      <CloudCheck className="size-4" />
      {estado.em ? `Salvo às ${estado.em.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "Salvo"}
    </span>
  );
}
