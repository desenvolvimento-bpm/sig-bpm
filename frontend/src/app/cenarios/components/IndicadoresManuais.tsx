"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { TabelaIndicadores } from "@/app/relatorios/indicadores/TabelaIndicadores";
import { mensagemDeErro, type MesRelatorio } from "@/app/relatorios/services/relatoriosService";
import { plural } from "@/lib/texto";

import { cenariosService, type IndicadorDoCenario } from "../services/cenariosService";
import { Erro } from "./CenarioDialog";
import { ValorDialog } from "./EdicaoDialogs";

/** Os percentuais se editam em % (25 = 25%) e se gravam em fração (0,25), como nas abas Comercial e Administrativo das Listas. */
const escalaDe = (i: IndicadorDoCenario) => (i.unidade === "%" ? 100 : 1);

/** O mês de um indicador manual em edição: o indicador e o índice do mês. */
export type MesEmEdicao = { indicador: IndicadorDoCenario; mes: number };

/**
 * A edição de um mês de um indicador manual (16/11/2026, pedido do Adão: o mesmo modal Editar Valor das demais tabelas dos
 * cenários, no lugar do modal com os doze meses de uma vez): o Valor Atual, o reajuste (percentual ou absoluto) e o Valor
 * Recalculado, que também se digita direto, com a chave "Replicar aos meses posteriores". Os percentuais se editam em %. Em
 * branco, o mês fica sem valor. A gravação fica no Histórico do cenário, como as das premissas.
 */
export function EditarIndicadorDialog({
  id,
  edicao,
  meses,
  onFechar,
  recalculaDRE = false,
}: {
  id: string;
  edicao: MesEmEdicao;
  meses: MesRelatorio[];
  onFechar: () => void;
  /** O indicador muda a DRE do cenário (16/11/2026: a Liberação de Projetos dos analíticos, a base do rateio de Projeto). */
  recalculaDRE?: boolean;
}) {
  const queryClient = useQueryClient();
  const { indicador, mes } = edicao;
  const escala = escalaDe(indicador);
  const atual = indicador.meses[mes] ?? null;
  const gravar = useMutation({
    mutationFn: ({ valor, replicar, reajuste }: { valor: number | null; replicar: boolean; reajuste: { modo: "PERCENTUAL" | "ABSOLUTO"; valor: number } | null }) => {
      // Os doze meses: o editado (e os seguintes, replicando) com o valor novo; os outros com o valor gravado.
      const valores = indicador.meses.map((v, k) => (k === mes || (replicar && k > mes) ? (valor === null ? null : valor / escala) : v));
      return cenariosService.salvarManual(id, indicador.nome, valores, {
        tipo: "VALOR",
        modo: reajuste ? reajuste.modo : "DIGITADO",
        reajuste: reajuste ? reajuste.valor : null,
        replicado: replicar,
      });
    },
    onSuccess: (_, { replicar }) => {
      queryClient.invalidateQueries({ queryKey: ["cenarios"] });
      // Se o cenário é o Orçamento Empresarial, o orçado de Resultados Empresariais muda.
      queryClient.invalidateQueries({ queryKey: ["relatorios"] });
      const n = replicar ? meses.length - mes : 1;
      toast.success(`${indicador.nome}: ${n} ${plural(n, "valor gravado", "valores gravados")}${recalculaDRE ? "; a DRE fica pendente de recálculo (Resultados / Recalcular)" : ""}.`);
      onFechar();
    },
  });
  return (
    <ValorDialog
      conta={`${indicador.nome} (${indicador.unidade})`}
      rotuloMes={meses[mes].rotulo}
      mesesSeguintes={meses.slice(mes + 1).map((m) => m.rotulo)}
      atual={atual === null ? null : atual * escala}
      permiteVazio
      gravando={gravar.isPending}
      erro={gravar.isError ? mensagemDeErro(gravar.error, "Não foi possível gravar.") : null}
      onGravar={(valor, replicar, reajuste) => gravar.mutate({ valor, replicar, reajuste })}
      onFechar={() => {
        gravar.reset();
        onFechar();
      }}
    />
  );
}

/**
 * Os Indicadores Manuais de um cenário (14/10/2026: também a aba das Premissas dos analíticos): os quadros de lotação e
 * os indicadores do Comercial e do Administrativo, que não saem da DRE. Clicar no valor de um mês abre o modal Editar Valor
 * (16/11/2026), como nas demais tabelas dos cenários. Nos analíticos (16/11/2026), também a Liberação de Projetos: Matriz e
 * Filial, a base do rateio de Projeto (gravar deixa a DRE do cenário pendente de recálculo).
 */
export function IndicadoresManuais({ id, podeEditar, comReferencia = false }: { id: string; podeEditar: boolean; comReferencia?: boolean }) {
  const [editando, setEditando] = useState<MesEmEdicao | null>(null);
  // A aba Indicadores Manuais das Premissas (12/11/2026): com o Acesso às Informações Por Recorte, só os dos grupos do recorte.
  const consulta = useQuery({ queryKey: ["cenarios", id, "indicadores", "manuais"], queryFn: () => cenariosService.indicadores(id, "manuais") });
  if (consulta.isError) return <Erro erro={mensagemDeErro(consulta.error, "Erro ao carregar os indicadores do cenário.")} />;
  if (consulta.isPending) return <div className="h-64 animate-pulse rounded-sm bg-gray-100" />;
  const dados = consulta.data;
  return (
    <>
      <TabelaIndicadores
        meses={dados.meses}
        indicadores={dados.indicadores.filter((i) => i.classe === "MANUAL")}
        comparado={dados.comparado}
        onCelula={podeEditar ? (indicador, mes) => setEditando({ indicador, mes }) : undefined}
        destacar={(i, k) => i.digitados[k]}
        dicaDoDestaque="Valor digitado"
        comReferencia={comReferencia}
      />
      {editando ? (
        <EditarIndicadorDialog
          id={id}
          edicao={editando}
          meses={dados.meses}
          onFechar={() => setEditando(null)}
          recalculaDRE={comReferencia && !!editando.indicador.recalculaDRE}
        />
      ) : null}
    </>
  );
}
