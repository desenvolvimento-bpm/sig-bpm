"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, EllipsisVertical, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { ConfirmacaoDialog } from "@/components/shared/ConfirmacaoDialog";
import { ExportarTabela } from "@/components/shared/ExportarTabela";
import { QuadroTabela } from "@/components/shared/QuadroTabela";
import { usePermissions } from "@/context/PermissionContext";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";
import { plural } from "@/lib/texto";
import { mensagemDeErro } from "@/app/cadastros/services/edicaoService";

import { quadroService, type Movimentacao } from "../../services/quadroService";
import { CabecalhoDoQuadro, rotuloDoMes } from "./CabecalhoDoQuadro";
import { colunasParaExportar, TabelaDeMovimentacoes } from "./TabelaDeMovimentacoes";

/**
 * A aba Controle de uma competência do Quadro de Lotação (06/11/2026): as movimentações de aprovação manual, Pendentes até
 * a gestão aprovar (Aprovada) ou reprovar (Reprovada, com o motivo) no menu Ações.
 */
export function ControleContent() {
  const { anoMes } = useParams<{ anoMes: string }>();
  useRegistrarAcessoTela(`/gestao-de-colaboradores/quadro-de-lotacao/${anoMes}/controle`);
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const lista = useQuery({ queryKey: ["quadro", "controle", anoMes], queryFn: () => quadroService.controle(anoMes) });
  const aberta = lista.data?.competencia.status === "ABERTA";
  const pode = hasPermission("colaboradores_quadro.controle:editar") && aberta;
  const [decidindo, setDecidindo] = useState<{ m: Movimentacao; aprovar: boolean } | null>(null);
  const [justificativa, setJustificativa] = useState("");
  const decidir = useMutation({
    mutationFn: ({ m, aprovar }: { m: Movimentacao; aprovar: boolean }) => quadroService.decidir(m.id, aprovar, aprovar ? null : justificativa || null),
    onSuccess: (_r, { aprovar }) => {
      toast.success(aprovar ? "Movimentação aprovada." : "Movimentação reprovada.");
      setDecidindo(null);
      void queryClient.invalidateQueries({ queryKey: ["quadro"] });
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível gravar a decisão.")),
  });
  const pendentes = lista.data?.itens.filter((m) => m.status === "PENDENTE").length ?? 0;

  return (
    <div className="space-y-4">
      <CabecalhoDoQuadro
        anoMes={anoMes}
        aba="controle"
        status={lista.data?.competencia.status}
        sobre={
          <p>
            As movimentações de aprovação Manual (o Modelo de Aprovação do tipo, nos Cadastros) do mês. Elas nascem Pendentes e só mudam o quadro depois de
            aprovadas; a reprovada fica registrada, com o motivo, e não conta. A competência só fecha sem movimentações pendentes.
          </p>
        }
        comoUsar={
          <ul>
            <li>No menu Ações de uma movimentação Pendente, use Aprovar (fica Aprovada e passa a contar no quadro) ou Reprovar (com o motivo, opcional).</li>
            <li>Use os filtros nos rótulos das colunas; a coluna Situação separa as Pendentes das já decididas.</li>
            <li>Com a competência fechada, as decisões ficam como estão: reabra-a na lista das competências para mudar.</li>
          </ul>
        }
        exportar={<ExportarTabela titulo={`Quadro de Lotação · Controle · ${rotuloDoMes(anoMes)}`} colunas={colunasParaExportar(true)} linhas={lista.data?.itens ?? []} />}
      />
      {pendentes ? (
        <p className="rounded-sm border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
          {pendentes} {plural(pendentes, "movimentação aguarda", "movimentações aguardam")} a aprovação.
        </p>
      ) : null}
      <QuadroTabela>
        <TabelaDeMovimentacoes
          itens={lista.data?.itens}
          controle
          carregando={lista.isPending}
          erro={lista.isError}
          vazio="Nenhuma movimentação de aprovação manual nesta competência"
          acoes={
            pode
              ? (m) =>
                  m.status === "PENDENTE" ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button type="button" size="icon" variant="outline" className="size-7 rounded-sm" aria-label={`Ações da movimentação ${m.tipo}`} title="Ações">
                            <EllipsisVertical className="size-4" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end" className="w-auto min-w-40">
                        <DropdownMenuItem onClick={() => setDecidindo({ m, aprovar: true })}>
                          <Check />
                          Aprovar
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onClick={() => (setJustificativa(""), setDecidindo({ m, aprovar: false }))}>
                          <X />
                          Reprovar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null
              : undefined
          }
        />
      </QuadroTabela>
      {decidindo ? (
        <ConfirmacaoDialog
          titulo={decidindo.aprovar ? "Aprovar Movimentação" : "Reprovar Movimentação"}
          descricao={decidindo.aprovar ? "A movimentação fica Aprovada e passa a contar no Quadro de Lotação." : "A movimentação fica Reprovada e não conta no Quadro de Lotação."}
          acao={decidindo.aprovar ? "Aprovar" : "Reprovar"}
          acaoPendente="Gravando…"
          destrutiva={!decidindo.aprovar}
          pendente={decidir.isPending}
          onConfirmar={() => decidir.mutate(decidindo)}
          onFechar={() => setDecidindo(null)}
        >
          <p className="rounded-sm border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900">
            {decidindo.m.tipo} · {decidindo.m.data.split("-").reverse().join("/")} · {decidindo.m.funcao} · {decidindo.m.centroCusto}
          </p>
          {decidindo.aprovar ? null : (
            <div className="space-y-1.5">
              <Label htmlFor="justificativa">Motivo da Reprovação</Label>
              <textarea
                id="justificativa"
                rows={3}
                value={justificativa}
                onChange={(e) => setJustificativa(e.target.value)}
                className="w-full rounded-sm border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              />
            </div>
          )}
        </ConfirmacaoDialog>
      ) : null}
    </div>
  );
}
