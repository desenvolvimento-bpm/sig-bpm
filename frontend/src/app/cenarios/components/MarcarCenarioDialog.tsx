"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";

import { cenariosService, MARCACOES, rotuloMarcacao, type Cenario, type MarcacaoCenario } from "../services/cenariosService";
import { botaoPrimario, Erro } from "./CenarioDialog";

/** O que cada marcação faz, embaixo da opção. */
const EFEITO: Record<MarcacaoCenario, (c: Cenario) => string> = {
  // Sem as menções aos exercícios (22/10/2026): a Comparação usa o cenário marcado, de qualquer exercício.
  ORCAMENTO_EMPRESARIAL: () => "Dá o orçado de Resultados Empresariais (Resultados, Painel de Bordo e Relatórios Executivos): o comparado padrão da Comparação quando não há cenário marcado como Forecast.",
  RESULTADOS_ANTERIORES: () => "Os resultados anteriores, para comparação; pode ser escolhido na Comparação de Resultados Empresariais.",
  RESULTADOS_VENDIDOS: () => "Os resultados do que foi vendido; pode ser escolhido na Comparação de Resultados Empresariais.",
  PREVISAO: () => "Uma previsão de resultados: o comparado padrão da Comparação de Resultados Empresariais (Resultados e Painel de Bordo).",
};

/**
 * A marcação de um cenário, como uma ação com confirmação (e não uma lista na tabela, para evitar a troca por
 * engano). Cada marcação fica ativa em um cenário só: marcar este tira a marcação do cenário que a tinha.
 */
export function MarcarCenarioDialog({ cenario, cenarios, onFechar }: { cenario: Cenario; cenarios: Cenario[]; onFechar: () => void }) {
  const queryClient = useQueryClient();
  const [escolha, setEscolha] = useState<MarcacaoCenario | "">(cenario.marcacao ?? "");
  const dono = (m: MarcacaoCenario) => cenarios.find((c) => c.marcacao === m && c.id !== cenario.id) ?? null;
  const outro = escolha ? dono(escolha) : null;
  const marcar = useMutation({
    mutationFn: () => cenariosService.marcar(cenario.id, escolha || null),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["cenarios"] });
      // O orçado de Resultados Empresariais muda com o Orçamento.
      queryClient.invalidateQueries({ queryKey: ["relatorios"] });
      toast.success(escolha ? `${cenario.nome} marcado como ${rotuloMarcacao(escolha)}.${r.desmarcado ? ` ${r.desmarcado} deixou de ser.` : ""}` : `${cenario.nome} ficou sem marcação.`);
      onFechar();
    },
  });
  const opcoes: Array<{ valor: MarcacaoCenario | ""; rotulo: string }> = [...MARCACOES, { valor: "", rotulo: "Sem Marcação" }];
  // A marcação vale para todos os usuários: um cenário particular não se marca (11/10/2026).
  const particular = cenario.visualizacao === "PARTICULAR";

  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="rounded-sm sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Marcar Cenário</DialogTitle>
          <DialogDescription>
            {cenario.nome}. Cada marcação fica ativa em um cenário só: marcar este tira a marcação do cenário que a tinha.
          </DialogDescription>
        </DialogHeader>
        {particular ? (
          <p className="rounded-sm border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-900">
            O cenário é particular, e a marcação vale para todos os usuários: torne-o público (lápis, Visualização) antes de marcá-lo.
          </p>
        ) : null}
        <fieldset className="space-y-2">
          <legend className="sr-only">Marcação</legend>
          {opcoes.map((o) => {
            const atualDe = o.valor ? dono(o.valor) : null;
            return (
              <label
                key={o.valor || "nenhuma"}
                className={`flex cursor-pointer items-start gap-3 rounded-sm border px-3 py-2 text-sm ${escolha === o.valor ? "border-gray-900 bg-gray-50" : "border-gray-200 hover:bg-gray-50"}`}
              >
                <input
                  type="radio"
                  name="marcacao"
                  className="mt-1 accent-black"
                  checked={escolha === o.valor}
                  disabled={particular && !!o.valor}
                  onChange={() => setEscolha(o.valor)}
                />
                <span className="min-w-0">
                  <span className="font-medium text-gray-900">{o.rotulo}</span>
                  {cenario.marcacao === (o.valor || null) ? <span className="ml-2 text-xs text-gray-500">(a atual)</span> : null}
                  {o.valor ? <span className="block text-xs text-gray-600">{EFEITO[o.valor](cenario)}</span> : null}
                  {atualDe ? <span className="block text-xs text-gray-500">Hoje em: {atualDe.nome} ({atualDe.ano}).</span> : null}
                </span>
              </label>
            );
          })}
        </fieldset>
        {outro ? (
          <p className="rounded-sm border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-900">
            {outro.nome} ({outro.ano}) deixa de ser {rotuloMarcacao(escolha || null)}.
          </p>
        ) : null}
        <Erro erro={marcar.isError ? mensagemDeErro(marcar.error, "Não foi possível marcar o cenário.") : null} />
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={escolha === (cenario.marcacao ?? "") || marcar.isPending} onClick={() => marcar.mutate()}>
            {marcar.isPending ? "Gravando…" : "Gravar Marcação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
