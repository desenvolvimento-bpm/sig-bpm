"use client";

import type { ReactNode } from "react";

import { Carregando, ErroCarga, Vazio } from "./Estados";
import { SemResultado } from "./TabelaFiltravel";
import { iniciaisMaiusculas } from "@/lib/texto";

type DataTableProps<T> = {
  data: T[];
  isLoading?: boolean;
  error?: string | null;
  emptyMessage?: string;
  /** Texto de apoio do estado vazio. Telas de consulta não pedem "crie o
   *  primeiro item" — ali o vazio costuma ser resultado de uma busca. */
  emptyHint?: string;
  renderRow: (item: T) => ReactNode;
  columns: string[];
  /** O cabeçalho com ordenar e filtrar (useTabelaFiltravel), no lugar de columns. */
  cabecalho?: ReactNode;
  /** Com cabeçalho filtrável: a tabela vazia por causa dos filtros mantém o cabeçalho e oferece limpá-los. */
  filtrosAtivos?: boolean;
  onLimparFiltros?: () => void;
  /** Linhas fixas no pé da tabela, como o Total (06/11/2026: o Realizado do Quadro de Lotação). */
  rodape?: ReactNode;
};

export function DataTable<T>({
  data,
  isLoading = false,
  error = null,
  emptyMessage = "Nenhum item encontrado",
  emptyHint = "Crie o primeiro item para começar.",
  renderRow,
  columns,
  cabecalho,
  filtrosAtivos,
  onLimparFiltros,
  rodape,
}: DataTableProps<T>) {
  // Os estados padrão (G12 do levantamento de layout).
  if (isLoading) return <Carregando />;
  if (error) return <ErroCarga mensagem={error} />;
  if (data.length === 0 && cabecalho && filtrosAtivos) {
    return (
      <table className="tabela-sig w-full border-collapse">
        {cabecalho}
        <tbody>
          <SemResultado colunas={columns.length} onLimpar={() => onLimparFiltros?.()} />
        </tbody>
      </table>
    );
  }
  if (data.length === 0) return <Vazio titulo={emptyMessage} dica={emptyHint} />;

  return (
    <table className="tabela-sig w-full border-collapse">
      {cabecalho ?? (
      <thead>
        <tr className="border-b border-gray-200 bg-gray-50">
          {columns.map((column, i) => (
            <th
              key={`${i}-${column}`}
              className="px-4 py-3 text-left text-xs font-bold text-gray-600"
            >
              {iniciaisMaiusculas(column)}
            </th>
          ))}
        </tr>
      </thead>
      )}
      <tbody>{data.map((item) => renderRow(item))}</tbody>
      {rodape ? <tfoot>{rodape}</tfoot> : null}
    </table>
  );
}
