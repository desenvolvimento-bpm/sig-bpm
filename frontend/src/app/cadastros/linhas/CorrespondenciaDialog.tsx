"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListTree, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { usePermissions } from "@/context/PermissionContext";

import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";

import { botaoPrimario, classeSelect, Erro } from "@/app/cenarios/components/CenarioDialog";
import { cenariosService, type CorrespondenciaDeTarefa } from "@/app/cenarios/services/cenariosService";

const FILIAIS: Array<[string, string]> = [
  ["", "Qualquer Filial"],
  ["1", "1 · Matriz"],
  ["2", "2 · Filial"],
];
const chaveDe = (i: CorrespondenciaDeTarefa) => `${i.filial ?? ""}|${i.tarefa.trim().replace(/\s+/g, " ").toUpperCase()}`;

/** O botão da tela Linhas (14/10/2026; antes, na aba Referência dos cenários analíticos), na altura do título. */
export function BotaoCorrespondencia() {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Button type="button" className={botaoPrimario} onClick={() => setAberto(true)}>
        <ListTree className="size-4" />
        {/* Nome curto (14/10/2026): o modal se chama Correspondência Tarefa × Linha. */}
        Tarefas
      </Button>
      {aberto ? <CorrespondenciaDialog onFechar={() => setAberto(false)} /> : null}
    </>
  );
}

/**
 * A correspondência tarefa × linha (14/10/2026): a tarefa das requisições e das notas fiscais (o nome dela), numa filial
 * ou em qualquer uma, e a linha dos custos dela. A referência realizada dos cenários analíticos divide os custos de
 * cada conta entre as linhas por ela; o que não tem tarefa, ou tem uma tarefa fora da lista, vai pelo volume (em
 * Serviços, pelos dias de acompanhamento — 26/11/2026, como nos Resultados por Linha).
 */
export function CorrespondenciaDialog({ onFechar }: { onFechar: () => void }) {
  const consulta = useQuery({ queryKey: ["cenarios", "correspondencias"], queryFn: () => cenariosService.correspondencias() });
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="max-h-[90vh] overflow-y-auto rounded-sm sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Correspondência Tarefa × Linha</DialogTitle>
          <DialogDescription>Relação entre as tarefas de Requisições e Notas Fiscais, com as Linhas de Produção e Serviços.</DialogDescription>
        </DialogHeader>
        {consulta.isError ? (
          <Erro erro={mensagemDeErro(consulta.error, "Erro ao carregar a correspondência.")} />
        ) : consulta.isPending ? (
          <div className="h-48 animate-pulse rounded-sm bg-gray-100" />
        ) : (
          <Formulario inicial={consulta.data.itens} linhas={consulta.data.linhas} inativas={consulta.data.inativas} onFechar={onFechar} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Formulario({
  inicial,
  linhas,
  inativas,
  onFechar,
}: {
  inicial: CorrespondenciaDeTarefa[];
  linhas: Array<{ codigo: string; nome: string; unidade: number; nomeUnidade: string }>;
  inativas: Array<{ codigo: string; nome: string; nomeUnidade: string }>;
  onFechar: () => void;
}) {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const pode = hasPermission("cadastro_controladoria.linhas:editar");
  const [itens, setItens] = useState(inicial);
  const mudar = (k: number, x: Partial<CorrespondenciaDeTarefa>) => setItens((a) => a.map((i, j) => (j === k ? { ...i, ...x } : i)));
  const repetidas = new Set(itens.map(chaveDe).filter((c, k, todas) => todas.indexOf(c) !== k));
  const invalido = itens.some((i) => !i.tarefa.trim() || !i.linha) || repetidas.size > 0;
  const gravar = useMutation({
    mutationFn: () => cenariosService.gravarCorrespondencias(itens.map((i) => ({ ...i, tarefa: i.tarefa.trim() }))),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cenarios", "correspondencias"] });
      toast.success("Correspondência gravada: vale na próxima carga do resultado realizado.");
      onFechar();
    },
  });
  const unidades = [...new Set(linhas.map((l) => l.nomeUnidade))];
  // As linhas desativadas que ainda têm tarefas na lista (o aviso some quando todas trocam de linha ou saem).
  const desativada = (codigo: string) => inativas.some((l) => l.codigo === codigo);
  const comTarefas = inativas
    .map((l) => ({ ...l, tarefas: itens.filter((i) => i.linha === l.codigo).map((i) => i.tarefa.trim() || "(sem nome)") }))
    .filter((l) => l.tarefas.length > 0);
  return (
    <>
      {comTarefas.length ? (
        <div className="rounded-sm border border-l-4 border-gray-200 border-l-red-600 bg-white px-4 py-3 text-sm text-gray-700">
          <p className="font-medium text-gray-900">Linhas Desativadas com Tarefas</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {comTarefas.map((l) => (
              <li key={l.codigo}>
                {l.nome}
                {l.nomeUnidade ? ` (${l.nomeUnidade})` : ""}: {l.tarefas.join(", ")}.
              </li>
            ))}
          </ul>
          <p className="mt-1">
            Os custos dessas tarefas não vão para a linha: entram na divisão pelas demais tarefas e pelo volume. Troque a linha ou exclua a tarefa.
          </p>
        </div>
      ) : null}
      {/* A tabela rola por dentro, com os rótulos fixos no topo (14/10/2026). */}
      <div className="max-h-[55vh] overflow-auto rounded-sm border border-gray-200 bg-white [--topo-tabela:0px]">
        <table className="tabela-sig w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="px-3 text-left text-xs font-bold">Filial</th>
              <th className="px-3 text-left text-xs font-bold">Tarefa</th>
              <th className="px-3 text-left text-xs font-bold">Linha</th>
              <th className="w-10 px-2" aria-label="Excluir" />
            </tr>
          </thead>
          <tbody>
            {itens.map((i, k) => (
              <tr key={k} className="border-t border-gray-100">
                <td className="px-3 py-1">
                  <select
                    aria-label="Filial"
                    value={i.filial === null ? "" : String(i.filial)}
                    onChange={(e) => mudar(k, { filial: e.target.value ? Number(e.target.value) : null })}
                    disabled={!pode}
                    className={`${classeSelect} w-40`}
                  >
                    {FILIAIS.map(([v, r]) => (
                      <option key={v} value={v}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-1">
                  <Input
                    aria-label="Tarefa"
                    value={i.tarefa}
                    onChange={(e) => mudar(k, { tarefa: e.target.value })}
                    disabled={!pode}
                    placeholder="Ex.: PILAR"
                    className={`h-9 rounded-sm ${!i.tarefa.trim() || repetidas.has(chaveDe(i)) ? "border-red-400" : ""}`}
                  />
                </td>
                <td className="px-3 py-1">
                  <select
                    aria-label="Linha"
                    value={i.linha}
                    disabled={!pode}
                    onChange={(e) => mudar(k, { linha: e.target.value })}
                    className={`${classeSelect} min-w-48 ${desativada(i.linha) ? "border-red-400" : ""}`}
                  >
                    {!i.linha ? <option value="">Escolha a linha</option> : null}
                    {desativada(i.linha) ? (
                      <optgroup label="Desativadas">
                        {inativas.map((l) => (
                          <option key={l.codigo} value={l.codigo}>
                            {l.nome} (Desativada)
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    {unidades.map((u) => (
                      <optgroup key={u} label={u}>
                        {linhas
                          .filter((l) => l.nomeUnidade === u)
                          .map((l) => (
                            <option key={l.codigo} value={l.codigo}>
                              {l.nome}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1 text-center">
                  {pode ? (
                  <button
                    type="button"
                    className="rounded-sm p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-700"
                    title="Excluir a correspondência"
                    aria-label={`Excluir ${i.tarefa || "a correspondência"}`}
                    onClick={() => setItens((a) => a.filter((_, j) => j !== k))}
                  >
                    <Trash2 className="size-4" />
                  </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {itens.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-gray-500">
                  Nenhuma correspondência: todos os custos vão pelo volume das linhas.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <Erro
        erro={
          repetidas.size
            ? "Há uma tarefa repetida na mesma filial."
            : gravar.isError
              ? mensagemDeErro(gravar.error, "Não foi possível gravar a correspondência.")
              : null
        }
      />
      {pode ? (
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm sm:mr-auto" onClick={() => setItens((a) => [...a, { filial: null, tarefa: "", linha: "" }])}>
            <Plus className="size-4" />
            Incluir Tarefa
          </Button>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={invalido || gravar.isPending} onClick={() => gravar.mutate()}>
            {gravar.isPending ? "Gravando…" : "Gravar"}
          </Button>
        </DialogFooter>
      ) : null}
    </>
  );
}
