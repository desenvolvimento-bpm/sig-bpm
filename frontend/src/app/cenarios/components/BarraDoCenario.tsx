"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Lock } from "lucide-react";

import { usePermissions } from "@/context/PermissionContext";
import { podeSair } from "@/lib/alteracoesPendentes";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EtiquetasDaBarra } from "@/components/layout/EtiquetasDaBarra";

import { cenariosService, rotuloDoCenario, rotuloVersao } from "../services/cenariosService";
import { EtiquetaMarcacao, EtiquetaVigente } from "./EtiquetasCenario";

const ETIQUETA = "rounded-sm border border-gray-300 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-gray-700";
import { useTipoDoCenario } from "./tipoDoCenario";

/** As telas de um cenário (sintético ou analítico), como as abas de Resultados Empresariais. */
export const TELAS_DO_CENARIO: Array<{ caminho: string; rotulo: string; soAnaliticos?: boolean; /** O nome nos analíticos, quando é outro. */ rotuloAnalitico?: string }> = [
  // As configurações do cenário (12/10/2026). Cada tela aparece com a permissão dela (14/10/2026; antes, as Configurações
  // só para quem editava os cenários).
  { caminho: "configuracoes", rotulo: "Configurações" },
  // As premissas dos analíticos (13/10/2026), de onde a DRE deles se calcula.
  { caminho: "premissas", rotulo: "Premissas", soAnaliticos: true },
  { caminho: "resultados", rotulo: "Resultados" },
  // Os Indicadores são uma aba do Painel de Bordo desde 19/10/2026.
  // O Painel de Bordo do cenário (13/10/2026): o cenário × o comparado, como o de Resultados Empresariais.
  { caminho: "painel", rotulo: "Painel de Bordo" },
  // O histórico de reajustes do cenário (12/10/2026).
  // Nos analíticos, "Histórico" (19/10/2026).
  { caminho: "reajustes", rotulo: "Reajustes", rotuloAnalitico: "Histórico" },
];

/** A rota de uma tela de cenário (sintético ou analítico, 13/10/2026): o id e a tela. */
export function lerRotaDoCenario(pathname: string): { id: string; tela: string } | null {
  const m = pathname.match(/^\/cenarios\/(?:sinteticos|analiticos)\/([0-9a-f-]{36})(?:\/([^/]+))?/);
  return m ? { id: m[1], tela: m[2] ?? "resultados" } : null;
}

/**
 * A barra de um cenário, no formato da barra de etapas do mês: o cenário em amarelo-ouro no início (com a troca
 * de cenário, que mantém a tela) e as telas Configurações, Resultados, Painel de Bordo (com a aba Indicadores) e
 * Reajustes (Histórico, nos analíticos) — cada uma com a permissão dela no perfil —, com a atual em destaque.
 */
export function BarraDoCenario({ id, tela }: { id: string; tela: string }) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  // A lista do tipo do cenário aberto: a troca de cenário fica entre os do mesmo tipo.
  const t = useTipoDoCenario();
  const lista = useQuery({ queryKey: ["cenarios", t.tipo], queryFn: () => cenariosService.listar(t.tipo) });
  const atual = lista.data?.find((c) => c.id === id);
  return (
    <nav aria-label="Telas do cenário" data-tour="barra-de-atividades" className="flex min-w-0 flex-col gap-1 rounded-sm border border-gray-200 bg-white px-2 py-1.5 xl:flex-row xl:items-center">
      <div className="flex shrink-0 items-center gap-2 px-1">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button type="button" className="bg-bpm-primary hover:bg-bpm-primary-hover inline-flex max-w-96 items-center gap-1 rounded-sm px-2.5 py-1 text-sm font-bold text-black">
                <span className="truncate">{atual?.nome ?? "Cenário"}</span>
                {atual ? <span className="font-medium text-black/70">{atual.ano}</span> : null}
                <ChevronDown className="size-3.5 shrink-0 text-black/70" />
              </button>
            }
          />
          <DropdownMenuContent align="start" className="max-h-80 w-auto max-w-[min(40rem,calc(100vw-2rem))] min-w-72 overflow-y-auto">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t.titulo}</DropdownMenuLabel>
              {(lista.data ?? []).map((c) => (
                <DropdownMenuItem key={c.id} onClick={() => podeSair() && router.push(`${t.base}/${c.id}/${tela}`)} className={`whitespace-nowrap ${c.id === id ? "font-bold" : ""}`}>
                  {rotuloDoCenario(c)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ol className="flex min-w-0 flex-wrap items-center gap-y-1 xl:ml-2">
        {TELAS_DO_CENARIO.filter((x) => hasPermission(t.perm(x.caminho)) && (!x.soAnaliticos || t.tipo === "ANALITICO")).map((x) => {
          const ativa = x.caminho === tela;
          return (
            <li key={x.caminho} className="flex shrink-0 items-center">
              <Link
                href={`${t.base}/${id}/${x.caminho}`}
                aria-current={ativa ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-sm whitespace-nowrap ${ativa ? "bg-black font-bold text-white" : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"}`}
              >
                {t.tipo === "ANALITICO" && x.rotuloAnalitico ? x.rotuloAnalitico : x.rotulo}
              </Link>
            </li>
          );
        })}
      </ol>
      {/* As etiquetas da versão e da marcação à direita da barra (13/10/2026; o padrão das barras desde 27/10/2026, EtiquetasDaBarra). */}
      <EtiquetasDaBarra>
        {atual ? (
          <span
            className="inline-flex items-center gap-1 rounded-sm border border-gray-300 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-gray-700"
            title={atual.versaoSalvaEm ? "Versão congelada: os dados não se editam (reabra a versão ou crie uma revisão)" : "Versão aberta para edição"}
          >
            {atual.versaoSalvaEm ? <Lock className="size-3" /> : null}
            {rotuloVersao(atual.versao)}
            {atual.versaoSalvaEm ? " · Congelada" : ""}
          </span>
        ) : null}
        {/* Depois da versão, a etiqueta Vigente e a da marcação, com os símbolos (14/10/2026). */}
        {atual?.vigente ? <EtiquetaVigente classe={ETIQUETA} /> : null}
        <EtiquetaMarcacao marcacao={atual?.marcacao ?? null} classe={ETIQUETA} />
        {/* Os Reajustes aplicados na DRE (11/11/2026): a aba Reajustes das Configurações (12/11/2026) os aplica e os remove. */}
        {t.tipo === "ANALITICO" && atual?.reajustesAplicados ? (
          <span className={ETIQUETA} title="Os Reajustes estão aplicados na DRE (Configurações / Reajustes)">
            Reajustes Aplicados
          </span>
        ) : null}
      </EtiquetasDaBarra>
    </nav>
  );
}
