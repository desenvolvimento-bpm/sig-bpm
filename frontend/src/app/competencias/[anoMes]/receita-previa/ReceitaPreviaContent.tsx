"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Calculator, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ExportarTabela } from "@/components/shared/ExportarTabela";
import { ConfirmacaoDialog } from "@/components/shared/ConfirmacaoDialog";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { Button } from "@/components/ui/button";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";
import { atualizarCompetencia } from "@/lib/atualizarCompetencia";
import { CabecalhoDaTela } from "@/components/shared/CabecalhoDaTela";
import { SemResultado, useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import { Destaque, LinhaVazia, TabelaComDestaque } from "@/app/cenarios/components/DestaqueDaAba";
import type { Coluna } from "@/lib/filtrosDeTabela";

import { AvisoCongelado } from "../../components/AvisoCongelado";
import { dataHora, lerAnoMes, moeda } from "../utils/formatacao";
import { LancamentoReceitaDialog } from "./components/LancamentoReceitaDialog";
import { MemoriaCalculoDialog } from "./components/MemoriaCalculoDialog";
import { QuadroReceita } from "./components/QuadroReceita";
import { plural } from "@/lib/texto";
import {
  mensagemDeErro,
  receitaPreviaService,
  rotuloLancamento,
  ROTULO_UNIDADE,
  ROTULO_VENDA,
  type LancamentoReceita,
  type Natureza,
} from "./services/receitaPreviaService";

const COLUNAS: Coluna<LancamentoReceita>[] = [
  { chave: "unidade", rotulo: "Unidade", valor: (l) => ROTULO_UNIDADE[l.unidade] },
  { chave: "linha", rotulo: "Linha da receita", valor: (l) => rotuloLancamento(l.natureza, l.componente) },
  { chave: "venda", rotulo: "Venda", valor: (l) => (l.venda ? ROTULO_VENDA[l.venda] : null) },
  { chave: "observacao", rotulo: "Observação", valor: (l) => l.observacao },
  { chave: "valor", rotulo: "Valor", tipo: "numero", alinhamento: "direita", valor: (l) => Number(l.valor), texto: (l) => moeda(l.valor) },
  { chave: "acoes", rotulo: "", semFiltro: true },
];

export function ReceitaPreviaContent() {
  const { anoMes } = useParams<{ anoMes: string }>();
  useRegistrarAcessoTela(`/competencias/${anoMes}/receita-previa`);
  const periodo = lerAnoMes(anoMes);
  const queryClient = useQueryClient();
  const [memoria, setMemoria] = useState<{ unidade: number; natureza: Natureza; variacao?: boolean } | null>(null);
  // undefined: diálogo fechado; null: novo; lançamento: edição.
  const [editando, setEditando] = useState<LancamentoReceita | null | undefined>(undefined);
  // O lançamento cuja exclusão espera a confirmação no modal padrão.
  const [excluindo, setExcluindo] = useState<LancamentoReceita | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);

  const receita = useQuery({
    queryKey: ["receita-previa", anoMes],
    queryFn: () => receitaPreviaService.consultar(anoMes),
    enabled: periodo !== null,
  });
  const lancamentos = useQuery({
    queryKey: ["receita-previa", anoMes, "lancamentos"],
    queryFn: () => receitaPreviaService.lancamentos(anoMes),
    enabled: periodo !== null,
  });
  const opcoes = useQuery({
    queryKey: ["lancamentos-receita", "opcoes"],
    queryFn: receitaPreviaService.opcoes,
    staleTime: 5 * 60_000,
  });

  const apurar = useMutation({
    mutationFn: () => receitaPreviaService.apurar(anoMes),
    onSuccess: (r) => {
      setAvisos(r.avisos ?? []);
      toast.success("Receita prévia apurada.");
      queryClient.setQueryData(["receita-previa", anoMes], r);
      queryClient.invalidateQueries({ queryKey: ["receita-previa", anoMes, "itens"] });
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível apurar.")),
  });
  const excluir = useMutation({
    mutationFn: (id: string) => receitaPreviaService.excluirLancamento(id),
    onSuccess: () => {
      toast.success("Lançamento excluído. Apure de novo para refletir na receita.");
      setExcluindo(null);
      atualizarCompetencia(queryClient, anoMes);
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível excluir.")),
  });
  const tabela = useTabelaFiltravel(lancamentos.data?.itens, COLUNAS);

  if (!periodo) {
    return (
      <div className="rounded-sm border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-700">Competência inválida na URL: {anoMes}.</p>
      </div>
    );
  }

  const dados = receita.data;
  const fechada = dados?.competencia.status === "FECHADA";
  const bloqueada = fechada || dados?.congelado;

  return (
    <div className="space-y-6">
      <CabecalhoDaTela
        titulo="Receita Prévia"
        selo={bloqueada ? <AvisoCongelado anoMes={anoMes} fechada={fechada} oQue="da receita prévia" /> : null}
        comoUsar={
          <ul>
            <li>A tela Prévias (Prévias de Receita e Estoque) tem duas abas: Receita (esta, com a receita prévia do mês) e Estoque (o saldo de estoque prévio).</li>
            <li>Cada quadro (Matriz, Filial e Serviços) mostra a receita bruta, os impostos e a receita líquida, com a abertura em venda global e mercantil.</li>
            <li>Clique numa linha com lupa para abrir a memória de cálculo, com uma aba por origem (Produção, Expedição, Saídas, Devoluções, Serviços e Lanç. Manuais). Filtre e ordene pelos rótulos das colunas; o total acompanha o filtro.</li>
            <li>A linha Variação do Estoque abre só as estacas que a movimentam.</li>
            <li>Em Lançamentos Manuais de Receita, “Novo Lançamento” inclui ajustes, que entram na próxima apuração; o lápis os edita e a lixeira os exclui, depois da confirmação num modal; “Exportar”, o último botão do destaque, leva a tabela em Excel ou PDF.</li>
            <li>Cada tabela (os quadros de cada unidade e os Lançamentos Manuais) tem o destaque acima dela — o título, a descrição e os botões —, que flutua sobre a tabela ao rolar a tela, com os rótulos das colunas presos logo abaixo; os rótulos dos Lançamentos Manuais filtram e ordenam a tabela.</li>
            <li>Depois da apuração, a aba fica congelada: o que mudar só entra ao reapurar a competência, na tela Resultados.</li>
          </ul>
        }
        sobre={
          <p>
            As listas do mês valoradas pelos preços da DRE do Comercial, mais os lançamentos de receita. É a versão sistêmica da aba
            Receitas (Prévia). {dados?.apuradoEm ? `Apurada em ${dataHora(dados.apuradoEm)}.` : "Ainda não apurada."}
          </p>
        }
        acoes={
          !bloqueada && dados ? (
            <PermissionGuard permission="previas.receita:editar">
              <Button
                type="button"
                onClick={() => apurar.mutate()}
                disabled={apurar.isPending}
                className="bg-bpm-primary hover:bg-bpm-primary-hover rounded-sm font-bold text-black shadow-sm"
              >
                <Calculator className="size-4" />
                {apurar.isPending ? "Apurando…" : dados.apuradoEm ? "Apurar de novo" : "Apurar receita prévia"}
              </Button>
            </PermissionGuard>
          ) : null
        }
      />

      {avisos.length > 0 || (dados?.observacoes.length ?? 0) > 0 ? (
        <div className="rounded-sm border border-yellow-200 bg-yellow-50 p-4">
          <div className="flex items-start gap-2 text-sm text-yellow-800">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <ul className="space-y-1">
              {avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
              {avisos.length === 0
                ? dados?.observacoes.map((o) => (
                    <li key={o.observacao}>
                      {o.observacao} ({o.itens} {plural(o.itens, "item", "itens")})
                    </li>
                  ))
                : null}
            </ul>
          </div>
        </div>
      ) : null}

      {receita.isError ? (
        <div className="rounded-sm border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{mensagemDeErro(receita.error, "Erro ao carregar a receita prévia.")}</p>
        </div>
      ) : receita.isPending ? (
        <div className="h-64 animate-pulse rounded-sm bg-gray-100" />
      ) : dados && dados.receitas.length > 0 ? (
        <div className="space-y-4">
          {[1, 2, 3].map((u) => (
            <QuadroReceita key={u} unidade={u} receitas={dados.receitas} porVenda={dados.porVenda ?? []} impostos={dados.impostos ?? []} onAbrir={(unidade, natureza, variacao) => setMemoria({ unidade, natureza, variacao })} />
          ))}
        </div>
      ) : (
        <div className="rounded-sm border border-gray-200 bg-white p-6 text-sm text-gray-600">
          Nenhuma apuração ainda. Importe as listas do mês (produção, expedição, saídas, devoluções e medições) e apure.
        </div>
      )}

      {/*
        Os Lançamentos Manuais de Receita (21/11/2026, pedido do Adão: o padrão das telas com mais de uma tabela, como os Investimentos
        dos Cenários Analíticos): o destaque com o título, a descrição, o Novo Lançamento e o Exportar, por último, e a tabela com os
        rótulos presos e os filtros padrão.
      */}
      <TabelaComDestaque
        destaque={
          <Destaque titulo="Lançamentos Manuais de Receita" descricao="Correções da prévia contra o contábil, redistribuições e inventário: entram na receita na próxima apuração.">
            {!fechada ? (
              <PermissionGuard permission="lancamentos_manuais:editar">
                <Button type="button" onClick={() => setEditando(null)} className="bg-bpm-primary hover:bg-bpm-primary-hover rounded-sm font-bold text-black shadow-sm">
                  <Plus className="size-4" />
                  Novo Lançamento
                </Button>
              </PermissionGuard>
            ) : null}
            {/* O Exportar dos lançamentos de receita (30/10/2026), por último. */}
            <ExportarTabela titulo={`Receita Prévia · Lançamentos Manuais de Receita · ${anoMes.slice(5)}/${anoMes.slice(0, 4)}`} colunas={COLUNAS} linhas={tabela.filtradas} />
          </Destaque>
        }
        larguras={[150, 300, 130, 460, 160, 100]}
        cabecalho={tabela.linhaDoCabecalho}
        corpo={
          lancamentos.isError ? (
            <LinhaVazia colunas={COLUNAS.length} texto={mensagemDeErro(lancamentos.error, "Erro ao carregar os lançamentos.")} />
          ) : lancamentos.isPending ? (
            <LinhaVazia colunas={COLUNAS.length} texto="Carregando…" />
          ) : (lancamentos.data?.itens.length ?? 0) === 0 ? (
            <LinhaVazia colunas={COLUNAS.length} texto="Nenhum lançamento de receita nesta competência." />
          ) : tabela.visiveis.length === 0 ? (
            <SemResultado colunas={COLUNAS.length} onLimpar={tabela.limpar} />
          ) : (
            tabela.visiveis.map((l) => (
              <tr key={l.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-1.5 whitespace-nowrap">{ROTULO_UNIDADE[l.unidade]}</td>
                <td className="truncate px-3 py-1.5 text-gray-900">{rotuloLancamento(l.natureza, l.componente)}</td>
                <td className="px-3 py-1.5 whitespace-nowrap text-gray-700">{l.venda ? ROTULO_VENDA[l.venda] : "—"}</td>
                <td className="truncate px-3 py-1.5 text-gray-600" title={l.observacao}>
                  {l.observacao}
                </td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap">{moeda(l.valor)}</td>
                <td className="px-3 py-0 text-right whitespace-nowrap">
                  {!fechada ? (
                    <PermissionGuard permission="lancamentos_manuais:editar">
                      <Button type="button" variant="ghost" size="icon" onClick={() => setEditando(l)} aria-label="Editar">
                        <Pencil className="size-4" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" aria-label="Excluir" onClick={() => setExcluindo(l)}>
                        <Trash2 className="size-4 text-red-700" />
                      </Button>
                    </PermissionGuard>
                  ) : null}
                </td>
              </tr>
            ))
          )
        }
      />

      {memoria ? <MemoriaCalculoDialog anoMes={anoMes} {...memoria} onFechar={() => setMemoria(null)} /> : null}
      {editando !== undefined ? (
        <LancamentoReceitaDialog key={editando?.id ?? "novo"} anoMes={anoMes} opcoes={opcoes.data} editando={editando} onFechar={() => setEditando(undefined)} />
      ) : null}
      {excluindo ? (
        <ConfirmacaoDialog
          titulo="Excluir o Lançamento de Receita"
          descricao="O lançamento sai da competência; apure de novo para refletir na receita. A exclusão fica no log de auditoria."
          pendente={excluir.isPending}
          onConfirmar={() => excluir.mutate(excluindo.id)}
          onFechar={() => setExcluindo(null)}
        >
          <p className="rounded-sm border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
            {ROTULO_UNIDADE[excluindo.unidade]} · {rotuloLancamento(excluindo.natureza, excluindo.componente)} · {excluindo.observacao} ·{" "}
            <span className="font-semibold text-gray-900">{moeda(excluindo.valor)}</span>
          </p>
        </ConfirmacaoDialog>
      ) : null}
    </div>
  );
}
