"use client";

import type { ReactNode } from "react";

import { DataTable } from "@/components/shared/DataTable";
import { useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import type { Coluna } from "@/lib/filtrosDeTabela";
import { dataHora } from "@/app/competencias/[anoMes]/utils/formatacao";

import { ROTULO_ORIGEM, ROTULO_STATUS, type Movimentacao, type StatusMovimentacao } from "../../services/quadroService";

const dia = (iso: string) => iso.split("-").reverse().join("/");
const ESTILO_STATUS: Record<StatusMovimentacao, string> = {
  PENDENTE: "border-yellow-200 bg-yellow-50 text-yellow-800",
  APROVADA: "border-green-200 bg-green-50 text-green-700",
  REPROVADA: "border-red-200 bg-red-50 text-red-700",
};

export function SeloDaSituacao({ status }: { status: StatusMovimentacao }) {
  return <span className={`inline-block rounded-sm border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${ESTILO_STATUS[status]}`}>{ROTULO_STATUS[status]}</span>;
}

const decididaPor = (m: Movimentacao) => (m.decididaEm && m.decididaPorNome !== "Automática" ? m.decididaPorNome : null);

/**
 * As colunas da exportação: as da tabela e, em colunas próprias, a Origem, quem registrou e (em Aprovações) quem decidiu, que a
 * tabela mostra em linhas menores abaixo da movimentação, da data e da situação.
 */
export function colunasParaExportar(controle: boolean): Coluna<Movimentacao>[] {
  return [
    ...colunasDasMovimentacoes(),
    { chave: "origem", rotulo: "Origem", valor: (m) => (m.origem ? ROTULO_ORIGEM[m.origem] : null) },
    { chave: "registrada", rotulo: "Registrada Por", valor: (m) => m.registradaPorNome },
    ...(controle ? [{ chave: "decidida", rotulo: "Decidida Por", valor: decididaPor }] : []),
  ];
}

/** As colunas da tabela de movimentações. */
export function colunasDasMovimentacoes(): Coluna<Movimentacao>[] {
  return [
    { chave: "data", rotulo: "Data", tipo: "data", valor: (m) => new Date(m.data).getTime(), texto: (m) => dia(m.data) },
    // A origem do desligamento fica abaixo da movimentação (na exportação, uma coluna).
    { chave: "tipo", rotulo: "Movimentação", valor: (m) => m.tipo },
    { chave: "classificacao", rotulo: "Classificação", valor: (m) => m.classificacao },
    { chave: "centro", rotulo: "Centro de Custo", valor: (m) => m.centroCusto },
    { chave: "vinculo", rotulo: "Tipo", valor: (m) => m.vinculo },
    { chave: "funcao", rotulo: "Função", valor: (m) => m.funcao },
    { chave: "senioridade", rotulo: "Senioridade", valor: (m) => m.senioridade },
    { chave: "motivo", rotulo: "Motivo", valor: (m) => m.motivo },
    { chave: "situacao", rotulo: "Situação", valor: (m) => ROTULO_STATUS[m.status] },
  ];
}

/** A tabela das movimentações (as abas Movimentações e Aprovações), com o menu Ações na última coluna, quando há. */
export function TabelaDeMovimentacoes({
  itens,
  controle = false,
  carregando,
  erro,
  acoes,
  vazio,
}: {
  itens: Movimentacao[] | undefined;
  controle?: boolean;
  carregando: boolean;
  erro: boolean;
  /** O menu Ações de cada linha; sem ele, a coluna não aparece. */
  acoes?: (m: Movimentacao) => ReactNode;
  vazio: string;
}) {
  const colunas = [...colunasDasMovimentacoes(), ...(acoes ? [{ chave: "acoes", rotulo: "Ações", semFiltro: true, classe: "w-20" } as Coluna<Movimentacao>] : [])];
  const tabela = useTabelaFiltravel(itens, colunas, { porPaginaInicial: 50 });
  return (
    <DataTable<Movimentacao>
      data={tabela.visiveis}
      cabecalho={tabela.cabecalho}
      filtrosAtivos={tabela.ativos}
      onLimparFiltros={tabela.limpar}
      isLoading={carregando}
      error={erro ? "Erro ao carregar as movimentações." : null}
      emptyMessage={vazio}
      columns={colunas.map((c) => c.rotulo)}
      renderRow={(m) => (
        <tr key={m.id} className="border-b border-gray-100 align-top hover:bg-gray-50">
          <td className="px-4 py-2 text-sm whitespace-nowrap" title={`Registrada em ${dataHora(m.registradaEm)}`}>
            {dia(m.data)}
            {m.registradaPorNome ? <span className="block text-xs text-gray-500">{m.registradaPorNome}</span> : null}
          </td>
          <td className="px-4 py-2 text-sm whitespace-nowrap">
            {m.tipo}
            {m.origem ? <span className="block text-xs text-gray-500">{ROTULO_ORIGEM[m.origem]}</span> : null}
            {m.geradaPorDesligamento ? <span className="block text-xs text-gray-500">Gerada pelo desligamento</span> : null}
          </td>
          <td className="px-4 py-2 text-sm">{m.classificacao ?? <span className="text-gray-400">—</span>}</td>
          <td className="px-4 py-2 text-sm">{m.centroCusto}</td>
          <td className="px-4 py-2 text-sm">{m.vinculo}</td>
          <td className="px-4 py-2 text-sm">{m.funcao}</td>
          <td className="px-4 py-2 text-sm">{m.senioridade}</td>
          <td className="min-w-36 px-4 py-2 text-sm" title={m.motivo ?? undefined}>
            {m.motivo ? <span className="line-clamp-2">{m.motivo}</span> : <span className="text-gray-400">—</span>}
          </td>
          <td className="px-4 py-2">
            <SeloDaSituacao status={m.status} />
            {controle && decididaPor(m) ? (
              <span className="mt-0.5 block text-xs whitespace-nowrap text-gray-500" title={m.decididaEm ? dataHora(m.decididaEm) : undefined}>
                por {decididaPor(m)}
              </span>
            ) : null}
            {m.status === "REPROVADA" && m.justificativa ? <span className="mt-0.5 block max-w-48 text-xs text-red-700">{m.justificativa}</span> : null}
          </td>
          {acoes ? <td className="px-4 py-2">{acoes(m)}</td> : null}
        </tr>
      )}
    />
  );
}
