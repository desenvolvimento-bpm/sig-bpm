"use client";

import { useEffect, type ReactNode } from "react";

import { Abas } from "@/components/shared/Abas";
import { CabecalhoDaTela } from "@/components/shared/CabecalhoDaTela";
import { usePermissions } from "@/context/PermissionContext";

import { guardarCompetenciaAberta } from "./SituacaoDaCompetenciaDoQuadro";

export type AbaDoQuadro = "movimentacoes" | "controle" | "realizado";
const ABAS: Array<{ chave: AbaDoQuadro; rotulo: string }> = [
  { chave: "movimentacoes", rotulo: "Movimentações" },
  { chave: "controle", rotulo: "Controle" },
  { chave: "realizado", rotulo: "Realizado" },
];

/** "2026-11" → "11/2026". */
export const rotuloDoMes = (anoMes: string) => `${anoMes.slice(5, 7)}/${anoMes.slice(0, 4)}`;

/**
 * O cabeçalho de uma competência do Quadro de Lotação (06/11/2026): o título, as ações e as abas Movimentações, Controle e
 * Realizado que o perfil alcança (cada uma com o endereço dela). Desde 12/11/2026 (pedido do Adão), sem o mês e o estado ao
 * lado do título: o mês fica no caminho do topo e o estado, à direita da barra das telas. Devolve o título e as abas sem
 * envoltório, para o título ficar fixo ao rolar (filho direto do contêiner da página) e a tabela parar logo abaixo dele.
 */
export function CabecalhoDoQuadro({
  anoMes,
  aba,
  sobre,
  comoUsar,
  acoes,
  exportar,
}: {
  anoMes: string;
  aba: AbaDoQuadro;
  sobre: ReactNode;
  comoUsar: ReactNode;
  acoes?: ReactNode;
  exportar?: ReactNode;
}) {
  const { hasPermission } = usePermissions();
  const abas = ABAS.filter((a) => hasPermission(`colaboradores_quadro.${a.chave}:ler`)).map((a) => ({
    ...a,
    href: `/gestao-de-colaboradores/quadro-de-lotacao/${anoMes}/${a.chave}`,
  }));
  // A competência e a aba abertas (12/11/2026): o Quadro de Lotação da barra volta a elas.
  useEffect(() => guardarCompetenciaAberta(`/gestao-de-colaboradores/quadro-de-lotacao/${anoMes}/${aba}`), [anoMes, aba]);
  return (
    <>
      <CabecalhoDaTela titulo="Quadro de Lotação" sobre={sobre} comoUsar={comoUsar} acoes={acoes} exportar={exportar} />
      <Abas rotulo="Abas da competência" ativa={aba} abas={abas} />
    </>
  );
}
