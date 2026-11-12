"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChartColumn, Pencil } from "lucide-react";

import { usePermissions } from "@/context/PermissionContext";

import { TabelaIndicadores, valor, valorCurto } from "@/app/relatorios/indicadores/TabelaIndicadores";
import { GraficoIndicadorDialog } from "@/app/relatorios/indicadores/GraficoIndicadorDialog";
import { RotulosDoGrafico, type TipoGrafico } from "@/app/relatorios/components/GraficoRealizadoOrcado";
import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";

import { LancamentoDialog } from "../../../components/IndicadoresManuais";
import { AvisoMarcado, estaTravado } from "../../../components/AvisoMarcado";
import { cenariosService, type IndicadorDoCenario } from "../../../services/cenariosService";
import { useTipoDoCenario } from "../../../components/tipoDoCenario";

/**
 * A aba dos indicadores no Painel de Bordo do cenário, depois de Performance (19/10/2026): Indicadores (antes, Metas; a
 * chave da aba no perfil continua `metas`), o compilado de todos os indicadores. Os Indicadores Manuais ficam na tela
 * Resultados (sintéticos) ou nas Premissas (analíticos).
 */
const ABAS = [{ chave: "metas", rotulo: "Indicadores" }];
const DA_ABA: Record<string, (i: IndicadorDoCenario) => boolean> = {
  manuais: (i) => i.classe === "MANUAL",
  metas: () => true,
};

/** As abas dos indicadores que o perfil lê (no Painel de Bordo do cenário). */
export function useAbasDosIndicadoresDoCenario() {
  const t = useTipoDoCenario();
  const { hasPermission } = usePermissions();
  return ABAS.filter((a) => hasPermission(t.perm("painel", "ler", a.chave)));
}

/**
 * Os indicadores de um cenário (19/10/2026; antes, a tela Indicadores): a aba Indicadores do Painel de Bordo (`metas`,
 * todos) ou a aba Indicadores Manuais da tela Resultados dos sintéticos (`manuais`, onde se digitam) — a tabela e o
 * gráfico de cada indicador, com o Tipo e os Rótulos do Configurar Gráficos do Painel de Bordo.
 */
export function IndicadoresDoCenario({ id, aba, tipo, comRotulos }: { id: string; aba: string; tipo: TipoGrafico; comRotulos: boolean }) {
  const t = useTipoDoCenario();
  const { hasPermission } = usePermissions();
  // O cenário marcado não se edita (12/10/2026): os Indicadores Manuais ficam só para leitura, com o aviso.
  const cenario = useQuery({ queryKey: ["cenarios", id], queryFn: () => cenariosService.obter(id) });
  // Também a versão congelada (13/10/2026) trava os Indicadores Manuais.
  const travado = !!cenario.data && estaTravado(cenario.data);
  // No analítico (14/10/2026), os Indicadores Manuais se editam na tela Premissas; aqui ficam só para leitura.
  const analitico = t.tipo === "ANALITICO";
  // Os Indicadores Manuais são uma aba da tela Resultados (12/11/2026): vale a permissão de editar a aba, como na DRE.
  const editaAba = hasPermission(t.perm("resultados", "editar", "manuais"));
  const podeEditar = editaAba && !!cenario.data && !travado && !analitico;
  const [editando, setEditando] = useState<IndicadorDoCenario | null>(null);
  // O gráfico do indicador (16/10/2026), como em Resultados Empresariais: o cenário × o comparado.
  const [comGrafico, setComGrafico] = useState<IndicadorDoCenario | null>(null);
  const consulta = useQuery({ queryKey: ["cenarios", id, "indicadores"], queryFn: () => cenariosService.indicadores(id) });
  const dados = consulta.data;
  const daAba = DA_ABA[aba] ? (dados?.indicadores.filter(DA_ABA[aba]) ?? []) : [];
  const manuais = aba === "manuais";
  // Nos Indicadores Manuais que se editam, o clique digita os lançamentos; nos demais, abre o gráfico.
  const digita = manuais && podeEditar;

  return (
    <div className="space-y-6">
      {aba === "metas" ? (
        <p className="rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-2 text-sm text-gray-600">
          Os indicadores do cenário: os que saem da DRE (na tela Resultados) e os Indicadores Manuais (
          {analitico ? "nas Premissas, aba Indicadores Manuais" : "na tela Resultados, aba Indicadores Manuais"}), com as eficiências calculadas e os
          importados (liberação de projetos, GME). Não se editam aqui.
        </p>
      ) : null}
      {manuais && cenario.data && travado && editaAba ? <AvisoMarcado cenario={cenario.data} oQue="os Indicadores Manuais" varios /> : null}
      {manuais && analitico ? (
        <p className="rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-2 text-sm text-gray-600">
          No cenário analítico, os Indicadores Manuais se digitam na tela Premissas, aba Indicadores Manuais.
        </p>
      ) : null}
      {consulta.isError ? (
        <div className="rounded-sm border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{mensagemDeErro(consulta.error, "Erro ao carregar os indicadores do cenário.")}</p>
        </div>
      ) : !dados ? (
        <div className="h-64 animate-pulse rounded-sm bg-gray-100" />
      ) : (
        <TabelaIndicadores
          key={aba}
          meses={dados.meses}
          indicadores={daAba}
          comparado={dados.comparado}
          onClicar={digita ? setEditando : setComGrafico}
          dicaDoClique={digita ? "Digitar os lançamentos do indicador" : "Ver o gráfico do indicador"}
          iconeDoClique={digita ? Pencil : ChartColumn}
          destacar={manuais ? (i, k) => i.digitados[k] : undefined}
          dicaDoDestaque="Valor digitado"
        />
      )}
      {editando && dados ? <LancamentoDialog id={id} indicador={editando} meses={dados.meses} onFechar={() => setEditando(null)} /> : null}
      {comGrafico && dados ? (
        <RotulosDoGrafico.Provider value={{ realizado: "Cenário", orcado: dados.comparado ? `Comparado (${dados.comparado.nome})` : "Comparado" }}>
          <GraficoIndicadorDialog
            indicador={comGrafico}
            meses={dados.meses}
            formatar={(v) => valor(comGrafico, v)}
            formatarCurto={(v) => valorCurto(comGrafico, v)}
            tipo={tipo}
            comRotulos={comRotulos}
            onFechar={() => setComGrafico(null)}
          />
        </RotulosDoGrafico.Provider>
      ) : null}
    </div>
  );
}
