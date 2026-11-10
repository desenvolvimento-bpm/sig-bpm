"use client";

import type { ReactNode } from "react";

import { Abas } from "@/components/shared/Abas";
import { CabecalhoDaTela } from "@/components/shared/CabecalhoDaTela";
import { usePermissions } from "@/context/PermissionContext";
import { StatusCompetenciaBadge } from "@/app/competencias/components/StatusCompetenciaBadge";

import type { StatusCompetenciaQuadro } from "../../services/quadroService";

export type AbaDoQuadro = "movimentacoes" | "controle" | "realizado";
const ABAS: Array<{ chave: AbaDoQuadro; rotulo: string }> = [
  { chave: "movimentacoes", rotulo: "Movimentações" },
  { chave: "controle", rotulo: "Controle" },
  { chave: "realizado", rotulo: "Realizado" },
];

/** "2026-11" → "11/2026". */
export const rotuloDoMes = (anoMes: string) => `${anoMes.slice(5, 7)}/${anoMes.slice(0, 4)}`;

/**
 * O cabeçalho de uma competência do Quadro de Lotação (06/11/2026): o título, o mês e o estado à direita, as ações, e as
 * abas Movimentações, Controle e Realizado que o perfil alcança (cada uma com o endereço dela).
 */
export function CabecalhoDoQuadro({
  anoMes,
  aba,
  status,
  sobre,
  comoUsar,
  acoes,
  exportar,
}: {
  anoMes: string;
  aba: AbaDoQuadro;
  status?: StatusCompetenciaQuadro;
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
  return (
    <div className="space-y-4">
      <CabecalhoDaTela
        titulo="Quadro de Lotação"
        selo={
          <span className="inline-flex items-center gap-2 text-sm font-medium text-gray-900">
            {rotuloDoMes(anoMes)}
            {status ? <StatusCompetenciaBadge status={status} /> : null}
          </span>
        }
        sobre={sobre}
        comoUsar={comoUsar}
        acoes={acoes}
        exportar={exportar}
      />
      <Abas rotulo="Abas da competência" ativa={aba} abas={abas} />
    </div>
  );
}
