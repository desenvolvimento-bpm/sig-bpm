"use client";

import { useQuery } from "@tanstack/react-query";

import { contestacoesService, type CompetenciaAberta } from "../services/contestacoesService";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
/** "11/2026 (novembro), aberta" / "em conferência". */
const descricaoDa = (c: CompetenciaAberta) =>
  `${String(c.mes).padStart(2, "0")}/${c.ano} (${MESES[c.mes - 1]}) está ${c.status === "EM_CONFERENCIA" ? "em conferência" : "aberta"}`;

/**
 * A competência do Fechamento Mensal que não está fechada (23/11/2026, pedido do Adão), ou null: com ela, as Contestações de Gastos
 * ficam somente leitura (o servidor recusa contestar, responder, editar, alterar o status e processar). Recarrega a cada minuto e
 * ao voltar para a janela, para o aviso sumir quando a competência fecha.
 */
export function useFechamentoAberto() {
  const consulta = useQuery({
    queryKey: ["contestacoes", "fechamento-aberto"],
    queryFn: contestacoesService.fechamentoAberto,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  return consulta.data ?? null;
}

/** O motivo do bloqueio, para as dicas dos botões e do Contestar Selecionados. */
export const motivoDoFechamentoAberto = (c: CompetenciaAberta) =>
  `A competência ${descricaoDa(c)} no Fechamento Mensal: as Contestações de Gastos ficam somente leitura até ela ser fechada.`;

/**
 * O destaque da competência aberta (23/11/2026, pedido do Adão), com a borda esquerda vermelha: nas telas das Contestações de Gastos
 * (`tela`) e nos modais de gastos de Resultados Empresariais com o Contestar (`modal`).
 */
export function AvisoDoFechamentoAberto({ competencia, onde }: { competencia: CompetenciaAberta | null; onde: "tela" | "modal" }) {
  if (!competencia) return null;
  return (
    <div role="status" className="rounded-sm border border-l-4 border-gray-200 border-l-red-600 bg-white px-4 py-3 text-sm text-gray-700">
      <p className="font-medium text-gray-900">Somente Leitura</p>
      <p className="mt-0.5">
        A competência {descricaoDa(competencia)} no Fechamento Mensal.{" "}
        {onde === "tela"
          ? "Até ela ser fechada, as Contestações de Gastos ficam somente leitura: nada se acata, recusa, edita, altera ou processa."
          : "Até ela ser fechada, as Contestações de Gastos ficam somente leitura: o Contestar e o Contestar Selecionados ficam indisponíveis."}
      </p>
    </div>
  );
}
