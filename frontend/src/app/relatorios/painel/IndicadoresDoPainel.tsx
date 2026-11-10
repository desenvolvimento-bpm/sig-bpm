"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChartColumn } from "lucide-react";

import { ESTILOS_NOS_INDICADORES, type CenarioDoProva } from "../components/cenariosDoProva";
import type { TipoGrafico } from "../components/GraficoRealizadoOrcado";
import { mensagemDeErro, relatoriosService, type Indicador, type MarcacaoComparavel } from "../services/relatoriosService";
import { GraficoIndicadorDialog } from "../indicadores/GraficoIndicadorDialog";
import { MovimentosDoQuadroDialog } from "../indicadores/MovimentosDoQuadroDialog";
import { TabelaIndicadores, valor, valorCurto } from "../indicadores/TabelaIndicadores";

/**
 * A aba Indicadores do Painel de Bordo de Resultados Empresariais (19/10/2026; antes, a tela Indicadores): os
 * indicadores do exercício até o Período do Configurar Gráficos do painel, com o orçado, e o gráfico de cada um no Tipo
 * e com os Rótulos escolhidos lá. Com a Comparação PROVA (31/10/2026), o atual e o acumulado de cada cenário dela, lado a
 * lado e na cor dele, e uma série por cenário no gráfico.
 */
export function IndicadoresDoPainel({
  ano,
  ate,
  tipo,
  comRotulos,
  comparaCom,
  prova,
}: {
  ano: number;
  ate: number;
  tipo: TipoGrafico;
  comRotulos: boolean;
  /** O Compara Com (21/10/2026). */
  comparaCom?: MarcacaoComparavel;
  /** A Comparação PROVA (31/10/2026): os cenários; null, a Padrão. */
  prova?: CenarioDoProva[] | null;
}) {
  const marcacoes = prova?.map((c) => c.marcacao);
  const consulta = useQuery({
    queryKey: ["relatorios", "indicadores", ano, ate, comparaCom, marcacoes ?? null],
    queryFn: () => relatoriosService.indicadores(ano, ate, false, comparaCom, marcacoes),
  });
  const dados = consulta.data;
  const [comGrafico, setComGrafico] = useState<Indicador | null>(null);
  // A lupa dos apurados no Quadro de Lotação (06/11/2026).
  const [lupa, setLupa] = useState<{ mes: number; indicador: string } | null>(null);
  if (consulta.isError) {
    return (
      <div className="rounded-sm border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-700">{mensagemDeErro(consulta.error, "Erro ao carregar os indicadores.")}</p>
      </div>
    );
  }
  if (!dados) return <div className="h-64 animate-pulse rounded-sm bg-gray-100" />;
  const comparados = prova?.map((c) => ({ ...c, estilo: ESTILOS_NOS_INDICADORES[c.marcacao] }));
  return (
    <>
      <TabelaIndicadores
        meses={dados.meses}
        indicadores={dados.indicadores}
        onClicar={setComGrafico}
        dicaDoClique="Ver o gráfico do indicador"
        iconeDoClique={ChartColumn}
        comOrcado
        rotuloDoOrcado={dados.rotuloComparado}
        comparados={comparados}
        lupa={(i, k) => (i.apurados?.[k] ? () => setLupa({ mes: dados.meses[k].mes, indicador: i.nome }) : null)}
      />
      {lupa ? <MovimentosDoQuadroDialog ano={ano} mes={lupa.mes} indicador={lupa.indicador} onFechar={() => setLupa(null)} /> : null}
      {comGrafico ? (
        <GraficoIndicadorDialog
          indicador={comGrafico}
          meses={dados.meses}
          formatar={(v) => valor(comGrafico, v)}
          formatarCurto={(v) => valorCurto(comGrafico, v)}
          tipo={tipo}
          comRotulos={comRotulos}
          comparados={prova ?? undefined}
          onFechar={() => setComGrafico(null)}
        />
      ) : null}
    </>
  );
}
