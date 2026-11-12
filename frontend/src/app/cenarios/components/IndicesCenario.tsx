"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { type ColunaExportavel, ExportarTabela } from "@/components/shared/ExportarTabela";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAlteracoesPendentes } from "@/lib/alteracoesPendentes";
import { plural } from "@/lib/texto";

import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";

import { cenariosService, type IndiceDeReajuste } from "../services/cenariosService";
import { botaoPrimario, Erro } from "./CenarioDialog";
import { lerNumero } from "./EdicaoDialogs";

/** A variação no campo: duas casas, sem separador de milhar (fácil de editar), como no Comparativo. */
const duasCasas = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
const QUADRO = "space-y-4 rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white p-5";

/**
 * Os Índices de Referência do cenário analítico (19/10/2026, como a aba Índices de Reajuste; desde 11/11/2026, pedido do Adão,
 * o quadro do meio da aba Comparativo das Configurações): a lista dos índices — a descrição, a observação e a variação
 * máxima (em %) —, que as Variações Máximas, abaixo, usam no lugar da variação digitada em cada conta. A lista se grava
 * inteira, em “Gravar Índices”.
 */
export function IndicesCenario({ id, podeEditar }: { id: string; podeEditar: boolean }) {
  const consulta = useQuery({ queryKey: ["cenarios", id, "indices"], queryFn: () => cenariosService.indices(id) });
  if (consulta.isError) return <Erro erro={mensagemDeErro(consulta.error, "Erro ao carregar os índices.")} />;
  if (consulta.isPending) return <div className="h-64 animate-pulse rounded-sm bg-gray-100" />;
  return <Lista key={JSON.stringify(consulta.data)} id={id} indices={consulta.data.indices} podeEditar={podeEditar} />;
}

type Linha = { chave: string | null; descricao: string; observacao: string; variacao: string; contas: number };

const COLUNAS_DOS_INDICES: ColunaExportavel<IndiceDeReajuste & { contas: number }>[] = [
  { chave: "descricao", rotulo: "Descrição", valor: (i) => i.descricao },
  { chave: "observacao", rotulo: "Observação", valor: (i) => i.observacao ?? "" },
  { chave: "variacao", rotulo: "Variação Máxima (%)", tipo: "numero", valor: (i) => Number(i.variacao), texto: (i) => duasCasas(Number(i.variacao)) },
  { chave: "contas", rotulo: "Contas", tipo: "numero", valor: (i) => i.contas },
];

function Lista({ id, indices, podeEditar }: { id: string; indices: Array<IndiceDeReajuste & { contas: number }>; podeEditar: boolean }) {
  const queryClient = useQueryClient();
  const deLinha = (i: IndiceDeReajuste & { contas: number }): Linha => ({ chave: i.chave, descricao: i.descricao, observacao: i.observacao ?? "", variacao: duasCasas(Number(i.variacao)), contas: i.contas });
  const [linhas, setLinhas] = useState<Linha[]>(() => indices.map(deLinha));
  const original = JSON.stringify(indices.map(deLinha));
  const mudou = JSON.stringify(linhas) !== original;
  // Sair com a lista mudada e não gravada pergunta antes.
  useAlteracoesPendentes(mudou);
  const invalidas = linhas.filter((l) => !l.descricao.trim() || typeof lerNumero(l.variacao) !== "number" || (lerNumero(l.variacao) as number) < 0);
  const mudar = (k: number, m: Partial<Linha>) => setLinhas((atual) => atual.map((l, i) => (i === k ? { ...l, ...m } : l)));
  const gravar = useMutation({
    mutationFn: () =>
      cenariosService.gravarIndices(
        id,
        linhas.map((l) => ({ chave: l.chave, descricao: l.descricao.trim(), observacao: l.observacao.trim() || null, variacao: lerNumero(l.variacao) as number })),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cenarios", id] });
      toast.success("Índices gravados.");
    },
  });
  const celula = "px-3 py-1.5";
  return (
    <section className={QUADRO}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-gray-900">Índices de Referência</h2>
          <p className="mt-1 text-xs text-gray-600">
            A variação máxima aceita (em %, para mais ou para menos) de cada índice. Em Variações Máximas, abaixo, cada conta escolhe um índice; as
            contas sem índice não são verificadas.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {podeEditar ? (
            <Button type="button" variant="outline" className="shrink-0 rounded-sm" onClick={() => setLinhas((atual) => [...atual, { chave: null, descricao: "", observacao: "", variacao: "", contas: 0 }])}>
              <Plus className="size-4" />
              Incluir Índice
            </Button>
          ) : null}
          {/* O Exportar (30/10/2026): os índices gravados; por último, depois do Incluir Índice (03/11/2026, pedido do Adão). */}
          <ExportarTabela titulo="Cenário · Comparativo · Índices de Referência" colunas={COLUNAS_DOS_INDICES} linhas={indices} />
        </div>
      </div>
      <div className="rounded-sm border border-gray-200">
        <table className="tabela-sig w-full border-collapse">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-xs font-bold text-gray-600">
              <th className={`${celula} text-left`}>Descrição</th>
              <th className={`${celula} text-left`}>Observação</th>
              <th className={`${celula} w-44 text-right`}>Variação Máxima (%)</th>
              <th className={`${celula} w-28 text-right`}>Contas</th>
              {podeEditar ? <th className={`${celula} w-12`} aria-label="Excluir" /> : null}
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 ? (
              <tr>
                <td colSpan={podeEditar ? 5 : 4} className="px-3 py-6 text-center text-sm text-gray-500">
                  Nenhum índice ainda.{podeEditar ? " Use “Incluir Índice”." : ""}
                </td>
              </tr>
            ) : (
              linhas.map((l, k) => {
                const ruim = invalidas.includes(l);
                return (
                  <tr key={l.chave ?? `novo-${k}`} className="border-b border-gray-100 last:border-b-0">
                    <td className={celula}>
                      <Input
                        aria-label="Descrição do índice"
                        value={l.descricao}
                        onChange={(e) => mudar(k, { descricao: e.target.value })}
                        disabled={!podeEditar}
                        maxLength={120}
                        placeholder="Ex.: IPCA, Dissídio, Aço…"
                        className={`h-8 rounded-sm bg-white ${ruim && !l.descricao.trim() ? "border-red-400" : ""}`}
                      />
                    </td>
                    <td className={celula}>
                      <Input aria-label="Observação do índice" value={l.observacao} onChange={(e) => mudar(k, { observacao: e.target.value })} disabled={!podeEditar} maxLength={500} className="h-8 rounded-sm bg-white" />
                    </td>
                    <td className={`${celula} text-right`}>
                      <Input
                        aria-label="Variação máxima do índice"
                        value={l.variacao}
                        onChange={(e) => mudar(k, { variacao: e.target.value })}
                        onBlur={() => {
                          const v = lerNumero(l.variacao);
                          if (typeof v === "number" && v >= 0) mudar(k, { variacao: duasCasas(v) });
                        }}
                        disabled={!podeEditar}
                        inputMode="decimal"
                        placeholder="%"
                        className={`ml-auto h-8 w-28 rounded-sm bg-white text-right ${ruim && l.descricao.trim() ? "border-red-400" : ""}`}
                      />
                    </td>
                    <td className={`${celula} text-right text-sm text-gray-600`} title={l.contas ? "Contas das Variações Máximas com este índice" : undefined}>
                      {l.contas ? `${l.contas} ${plural(l.contas, "conta", "contas")}` : "—"}
                    </td>
                    {podeEditar ? (
                      <td className={`${celula} text-right`}>
                        <button
                          type="button"
                          className="inline-flex size-7 items-center justify-center rounded-sm text-gray-500 hover:bg-gray-100 hover:text-red-700 disabled:opacity-40 disabled:hover:bg-transparent"
                          title={l.contas ? "O índice está nas Variações Máximas: troque o índice dessas contas antes de excluir" : "Excluir o índice"}
                          aria-label="Excluir o índice"
                          disabled={l.contas > 0}
                          onClick={() => setLinhas((atual) => atual.filter((_, i) => i !== k))}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {invalidas.length ? (
        <p className="text-xs text-red-700">
            {invalidas.length} {plural(invalidas.length, "índice incompleto", "índices incompletos")} (em vermelho): toda linha precisa da descrição e de uma variação a partir de zero.
        </p>
      ) : null}
      <Erro erro={gravar.isError ? mensagemDeErro(gravar.error, "Não foi possível gravar os índices.") : null} />
      {podeEditar ? (
        <div className="flex items-center justify-end gap-3">
          <span className="text-xs text-gray-500">
            {linhas.length} {plural(linhas.length, "índice", "índices")}
          </span>
          <Button type="button" className={botaoPrimario} disabled={!mudou || invalidas.length > 0 || gravar.isPending} onClick={() => gravar.mutate()}>
            {gravar.isPending ? "Gravando…" : "Gravar Índices"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
