"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ExportarTabela } from "@/components/shared/ExportarTabela";
import { BaldeBadge } from "@/components/shared/BaldeBadge";
import { ConfirmacaoDialog } from "@/components/shared/ConfirmacaoDialog";
import { DataTable } from "@/components/shared/DataTable";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { Button } from "@/components/ui/button";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";
import { atualizarCompetencia } from "@/lib/atualizarCompetencia";
import { CabecalhoDaTela } from "@/components/shared/CabecalhoDaTela";
import { QuadroTabela } from "@/components/shared/QuadroTabela";
import { useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import type { Coluna } from "@/lib/filtrosDeTabela";

import { AvisoCongelado } from "../../components/AvisoCongelado";
import { lerAnoMes, moeda } from "../utils/formatacao";
import { LancamentoManualDialog } from "./components/LancamentoManualDialog";
import { plural } from "@/lib/texto";
import {
  lancamentosManuaisService,
  mensagemDeErro,
  type LancamentoManual,
} from "./services/lancamentosManuaisService";

const COLUNAS: Coluna<LancamentoManual>[] = [
  { chave: "motivo", rotulo: "Motivo", valor: (l) => l.motivo },
  { chave: "filial", rotulo: "Filial", tipo: "numero", valor: (l) => l.filial, texto: (l) => String(l.filial) },
  { chave: "conta", rotulo: "Conta", valor: (l) => l.contaResultado?.reduzido },
  { chave: "descricao", rotulo: "Descrição", valor: (l) => l.descricao },
  { chave: "destino", rotulo: "Destino na DRE", valor: (l) => l.linhaDRE?.descricao ?? "sem destino — corrija a conta" },
  { chave: "rateio", rotulo: "Rateio", valor: (l) => l.balde },
  { chave: "valor", rotulo: "Valor", tipo: "numero", alinhamento: "direita", valor: (l) => Number(l.valor), texto: (l) => moeda(l.valor) },
  { chave: "acoes", rotulo: "", semFiltro: true },
];

export function LancamentosManuaisContent() {
  const { anoMes } = useParams<{ anoMes: string }>();
  useRegistrarAcessoTela(`/competencias/${anoMes}/lancamentos-manuais`);
  const periodo = lerAnoMes(anoMes);
  const queryClient = useQueryClient();
  // undefined: diálogo fechado; null: novo; lançamento: edição.
  const [editando, setEditando] = useState<LancamentoManual | null | undefined>(undefined);
  // O lançamento cuja exclusão espera a confirmação no modal padrão.
  const [excluindo, setExcluindo] = useState<LancamentoManual | null>(null);

  const lista = useQuery({
    queryKey: ["lancamentos-manuais", anoMes],
    queryFn: () => lancamentosManuaisService.listar(anoMes),
    enabled: periodo !== null,
  });
  const opcoes = useQuery({
    queryKey: ["lancamentos-manuais", "opcoes"],
    queryFn: lancamentosManuaisService.opcoes,
    staleTime: 5 * 60_000,
  });

  const invalidar = () => atualizarCompetencia(queryClient, anoMes);
  const excluir = useMutation({
    mutationFn: (id: string) => lancamentosManuaisService.excluir(id),
    onSuccess: () => {
      toast.success("Lançamento excluído.");
      setExcluindo(null);
      invalidar();
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível excluir.")),
  });
  const copiar = useMutation({
    mutationFn: () => lancamentosManuaisService.copiarAnterior(anoMes),
    onSuccess: (r) => {
      toast.success(`${r.copiados} ${plural(r.copiados, "lançamento copiado", "lançamentos copiados")} do mês anterior. Confira os valores.`);
      invalidar();
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível copiar.")),
  });
  const tabela = useTabelaFiltravel(lista.data?.itens, COLUNAS);

  if (!periodo) {
    return (
      <div className="rounded-sm border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-700">Competência inválida na URL: {anoMes}.</p>
      </div>
    );
  }

  const dados = lista.data;
  const fechada = dados?.competencia.status === "FECHADA";
  const itens = dados?.itens ?? [];
  // O rodapé da tabela soma o mês inteiro, ou o que os filtros dos rótulos deixam à vista. (O quadro dos totais saiu em 09/10/2026.)
  const filtrado = tabela.total !== tabela.totalGeral;
  const totalFiltrado = filtrado ? (tabela.filtradas.reduce((s, l) => s + Math.round(Number(l.valor) * 100), 0) / 100).toFixed(2) : null;

  return (
    <div className="space-y-6">
      <CabecalhoDaTela
        titulo="Lançamentos Manuais"
        exportar={<ExportarTabela titulo={`Lançamentos Manuais · Controladoria · ${anoMes.slice(5)}/${anoMes.slice(0, 4)}`} colunas={COLUNAS} linhas={tabela.filtradas} />}
        selo={fechada ? <AvisoCongelado anoMes={anoMes} fechada oQue="dos lançamentos" /> : null}
        comoUsar={
          <ul>
            <li>
              Esta é a aba Controladoria: os lançamentos digitados. Os que vêm das contestações de gastos ficam na aba Contestações, ao lado; os dois
              entram no resultado da competência.
            </li>
            <li>Use “Novo Lançamento” para incluir a RN e outros ajustes; o lápis e a lixeira editam e excluem (a exclusão, depois da confirmação num modal).</li>
            <li>Num mês ainda sem lançamentos, “Copiar do Mês Anterior” traz os do mês anterior para revisar.</li>
            <li>Use os filtros nos rótulos das colunas; o total no rodapé da tabela acompanha o filtro.</li>
            <li>
              Os lançamentos entram na DRE na próxima apuração, na aba de resultado do balde (o do centro de custo ou, sem centro, o da conta), como um
              lançamento do balancete: MATRIZ na Matriz, FILIAL na Filial, UNIDADE na da filial, OBRAS e COMPLEMENTAR em Serviços, DESPESAS e EXTRA em
              Despesas ou no Extra-Operacional (pela linha da DRE), RN no RN, LEBEN na Leben, e os de rateio pelos percentuais. O valor é o da DRE: positivo soma à linha, negativo subtrai (numa receita, o
              negativo a reduz). Uma combinação que nenhuma aba soma é recusada ao gravar, com o motivo.
            </li>
          </ul>
        }
        sobre={<p>O que não vem do balancete do RM — a RN e outros ajustes, em qualquer aba de resultado. É a versão sistêmica da aba Gastos (Lanç. Manuais).</p>}
        acoes={
          !fechada && dados ? (
            <PermissionGuard permission="lancamentos_manuais.controladoria:editar">
              <div className="flex gap-2">
                {itens.length === 0 ? (
                  <Button
                    type="button"
                    onClick={() => copiar.mutate()}
                    disabled={copiar.isPending}
                    className="bg-bpm-primary hover:bg-bpm-primary-hover rounded-sm font-bold text-black shadow-sm"
                  >
                    <Copy className="size-4" />
                    Copiar do Mês Anterior
                  </Button>
                ) : null}
                <Button
                  type="button"
                  onClick={() => setEditando(null)}
                  className="bg-bpm-primary hover:bg-bpm-primary-hover rounded-sm font-bold text-black shadow-sm"
                >
                  <Plus className="size-4" />
                  Novo Lançamento
                </Button>
              </div>
            </PermissionGuard>
          ) : null
        }
      />

      <QuadroTabela
        rodape={
          itens.length > 0 ? (
            <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-4 py-2.5 text-sm">
              <span className="text-gray-600">
                {filtrado ? `Total filtrado (${tabela.total} de ${tabela.totalGeral})` : "Total"}
              </span>
              <span className="font-bold text-gray-900">{moeda(totalFiltrado ?? dados?.total ?? "0")}</span>
            </div>
          ) : null
        }
      >
          <DataTable<LancamentoManual>
            data={tabela.visiveis}
            cabecalho={tabela.cabecalho}
            filtrosAtivos={tabela.ativos}
            onLimparFiltros={tabela.limpar}
            isLoading={lista.isPending}
            error={lista.isError ? mensagemDeErro(lista.error, "Erro ao carregar os lançamentos.") : null}
            emptyMessage="Nenhum lançamento manual nesta competência"
            emptyHint="Inclua os lançamentos da RN, ou copie os do mês anterior e ajuste os valores."
            columns={["Motivo", "Filial", "Conta", "Descrição", "Destino na DRE", "Rateio", "Valor", ""]}
            renderRow={(l) => (
              <tr key={l.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 text-sm whitespace-nowrap text-gray-900">{l.motivo}</td>
                <td className="px-4 text-sm">{l.filial}</td>
                <td className="px-4 text-sm">
                  <div className="font-medium text-gray-900">{l.contaResultado?.reduzido ?? "—"}</div>
                  {l.centroCusto ? (
                    <div className="max-w-56 truncate text-xs text-gray-500" title={`${l.centroCusto.codigoRM} ${l.centroCusto.nomeRM}`}>
                      centro {l.centroCusto.codigoRM} {l.centroCusto.nomeRM}
                    </div>
                  ) : null}
                </td>
                <td className="px-4 text-sm text-gray-600">
                  <div className="max-w-64 truncate" title={l.descricao}>
                    {l.descricao}
                  </div>
                </td>
                <td className="px-4 text-sm text-gray-600">
                  {/* A linha numa linha só; o grupo vai na dica. */}
                  {l.linhaDRE ? (
                    <div className="max-w-56 truncate" title={`${l.linhaDRE.grupo} › ${l.linhaDRE.descricao}`}>
                      {l.linhaDRE.descricao}
                    </div>
                  ) : (
                    <span className="text-red-700">sem destino — corrija a conta</span>
                  )}
                </td>
                <td className="px-4 text-sm">
                  <BaldeBadge balde={l.balde} />
                </td>
                <td className="px-4 text-right text-sm whitespace-nowrap text-gray-900">
                  {moeda(l.valor)}
                </td>
                <td className="px-4 py-0 text-right whitespace-nowrap">
                  {!fechada ? (
                    <PermissionGuard permission="lancamentos_manuais.controladoria:editar">
                      <Button type="button" variant="ghost" size="icon" onClick={() => setEditando(l)} aria-label="Editar">
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Excluir"
                        onClick={() => setExcluindo(l)}
                      >
                        <Trash2 className="size-4 text-red-700" />
                      </Button>
                    </PermissionGuard>
                  ) : null}
                </td>
              </tr>
            )}
          />
      </QuadroTabela>

      {editando !== undefined ? (
        <LancamentoManualDialog
          key={editando?.id ?? "novo"}
          anoMes={anoMes}
          opcoes={opcoes.data}
          editando={editando}
          aberto
          onFechar={() => setEditando(undefined)}
        />
      ) : null}
      {excluindo ? (
        <ConfirmacaoDialog
          titulo="Excluir o Lançamento"
          descricao="O lançamento sai da competência e da próxima apuração. A exclusão fica no log de auditoria."
          pendente={excluir.isPending}
          onConfirmar={() => excluir.mutate(excluindo.id)}
          onFechar={() => setExcluindo(null)}
        >
          <p className="rounded-sm border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
            {excluindo.contaResultado?.reduzido ?? "—"} · {excluindo.descricao} · <span className="font-semibold text-gray-900">{moeda(excluindo.valor)}</span>
          </p>
        </ConfirmacaoDialog>
      ) : null}
    </div>
  );
}
