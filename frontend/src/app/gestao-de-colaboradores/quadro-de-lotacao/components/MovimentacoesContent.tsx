"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EllipsisVertical, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmacaoDialog } from "@/components/shared/ConfirmacaoDialog";
import { ExportarTabela } from "@/components/shared/ExportarTabela";
import { QuadroTabela } from "@/components/shared/QuadroTabela";
import { usePermissions } from "@/context/PermissionContext";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";
import { botaoPrimario } from "@/app/cenarios/components/CenarioDialog";
import { mensagemDeErro } from "@/app/cadastros/services/edicaoService";

import { quadroService, type Movimentacao } from "../../services/quadroService";
import { CabecalhoDoQuadro, rotuloDoMes } from "./CabecalhoDoQuadro";
import { NovaMovimentacaoDialog } from "./NovaMovimentacaoDialog";
import { colunasParaExportar, TabelaDeMovimentacoes } from "./TabelaDeMovimentacoes";

/** A aba Movimentações de uma competência do Quadro de Lotação (06/11/2026): registrar e excluir movimentações. */
export function MovimentacoesContent() {
  const { anoMes } = useParams<{ anoMes: string }>();
  useRegistrarAcessoTela(`/gestao-de-colaboradores/quadro-de-lotacao/${anoMes}/movimentacoes`);
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const lista = useQuery({ queryKey: ["quadro", "movimentacoes", anoMes], queryFn: () => quadroService.movimentacoes(anoMes) });
  const aberta = lista.data?.competencia.status === "ABERTA";
  const pode = hasPermission("colaboradores_quadro.movimentacoes:editar") && aberta;
  const [nova, setNova] = useState(false);
  const [excluindo, setExcluindo] = useState<Movimentacao | null>(null);
  const excluir = useMutation({
    mutationFn: (m: Movimentacao) => quadroService.excluirMovimentacao(m.id),
    onSuccess: () => {
      toast.success("Movimentação excluída.");
      setExcluindo(null);
      void queryClient.invalidateQueries({ queryKey: ["quadro"] });
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível excluir.")),
  });

  return (
    <div className="space-y-4">
      <CabecalhoDoQuadro
        anoMes={anoMes}
        aba="movimentacoes"
        status={lista.data?.competencia.status}
        sobre={
          <p>
            As movimentações do Quadro de Lotação no mês: admissões, reposições, desligamentos, aberturas e encerramentos de vaga (os tipos da aba
            Movimentações dos Cadastros). As de aprovação Automática valem ao gravar; as de Manual ficam Pendentes até a aprovação na aba Controle. Só as
            aprovadas mudam o quadro: as de contagem Positiva somam um colaborador, as de Negativa subtraem um.
          </p>
        }
        comoUsar={
          <ul>
            <li>
              Use Novo, à direita do título, para registrar uma movimentação: a classificação (que já escolhe a movimentação) ou a movimentação, a data (hoje,
              por padrão), o centro de custo, o tipo (CLT ou PJ), a função, o nível (o da função, por padrão) e o motivo.
            </li>
            <li>
              Num desligamento, escolha a Origem (Iniciativa da Empresa ou Pedido do Colaborador). Com Gerar Vaga em Aberto, marcada por padrão, o SIG cria a
              Abertura de Vaga com os mesmos dados, já aprovada.
            </li>
            <li>No menu Ações, Excluir apaga a movimentação, depois da confirmação; o desligamento leva junto a vaga que gerou.</li>
            <li>Com a competência fechada, as movimentações ficam como estão: reabra-a na lista das competências para mudar.</li>
          </ul>
        }
        acoes={
          pode ? (
            <Button type="button" className={botaoPrimario} onClick={() => setNova(true)}>
              <Plus className="size-4" />
              Novo
            </Button>
          ) : null
        }
        exportar={<ExportarTabela titulo={`Quadro de Lotação · Movimentações · ${rotuloDoMes(anoMes)}`} colunas={colunasParaExportar(false)} linhas={lista.data?.itens ?? []} />}
      />
      <QuadroTabela>
        <TabelaDeMovimentacoes
          itens={lista.data?.itens}
          carregando={lista.isPending}
          erro={lista.isError}
          vazio="Nenhuma movimentação nesta competência"
          acoes={
            pode
              ? (m) => (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button type="button" size="icon" variant="outline" className="size-7 rounded-sm" aria-label={`Ações da movimentação ${m.tipo}`} title="Ações">
                          <EllipsisVertical className="size-4" />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end" className="w-auto min-w-40">
                      <DropdownMenuItem variant="destructive" onClick={() => setExcluindo(m)}>
                        <Trash2 />
                        Excluir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )
              : undefined
          }
        />
      </QuadroTabela>
      {lista.isError ? <p className="text-sm text-red-700">{mensagemDeErro(lista.error, "Erro ao carregar as movimentações.")}</p> : null}
      {nova ? <NovaMovimentacaoDialog anoMes={anoMes} onFechar={() => setNova(false)} /> : null}
      {excluindo ? (
        <ConfirmacaoDialog
          titulo="Excluir Movimentação"
          descricao={
            excluindo.vagaGerada
              ? "Exclui a movimentação e a Abertura de Vaga que ela gerou. Não é possível desfazer."
              : "Exclui a movimentação. Não é possível desfazer."
          }
          pendente={excluir.isPending}
          onConfirmar={() => excluir.mutate(excluindo)}
          onFechar={() => setExcluindo(null)}
        >
          <p className="rounded-sm border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900">
            {excluindo.tipo} · {excluindo.data.split("-").reverse().join("/")} · {excluindo.funcao} · {excluindo.centroCusto}
          </p>
        </ConfirmacaoDialog>
      ) : null}
    </div>
  );
}
