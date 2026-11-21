"use client";

import { useMemo, useState } from "react";

import { SemResultado, useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Coluna } from "@/lib/filtrosDeTabela";
import { plural } from "@/lib/texto";

import { ROTULO_DEPARTAMENTO, type CentroOpcao, type DepartamentoDoRecorte } from "../services/contestacoesService";
import { normal } from "./ContasDeResultadoDialog";
import { ROTULO_BALDE } from "./RegrasDeRateioDialog";

const ATRIBUICAO: Record<string, string> = { DIRETA: "Direta", INDIRETA: "Indireta" };

/** O centro da lista (20/11/2026: também o das Redistribuições de Gastos, que pode não ser de um departamento da DRE). */
export type CentroDaLupa = Omit<CentroOpcao, "departamentoDoRecorte"> & { departamentoDoRecorte: DepartamentoDoRecorte | null };

const COLUNAS: Coluna<CentroDaLupa>[] = [
  { chave: "codigo", rotulo: "Código", valor: (c) => c.codigoRM, classe: "w-32" },
  { chave: "nome", rotulo: "Centro de Custo", valor: (c) => c.nomeRM },
  { chave: "departamento", rotulo: "Departamento", valor: (c) => (c.departamentoDoRecorte ? ROTULO_DEPARTAMENTO[c.departamentoDoRecorte] : null) },
  { chave: "grupo", rotulo: "Grupo", valor: (c) => c.departamento },
  { chave: "atribuicao", rotulo: "Atribuição", valor: (c) => (c.atribuicao ? ATRIBUICAO[c.atribuicao] : null) },
  { chave: "balde", rotulo: "Balde", valor: (c) => (c.balde ? (ROTULO_BALDE[c.balde] ?? c.balde) : null) },
];

/**
 * A lista dos centros de custo do modal Contestar (04/11/2026, pedido do Adão; a lupa ao lado do Novo Centro de Custo): os
 * centros que a contestação pode escolher — os ativos de um departamento da DRE, com o código de três níveis —, com o
 * departamento, o grupo da DRE, a atribuição e o balde (que decide como os lançamentos do centro chegam às unidades). Clicar
 * num centro o escolhe. A busca acha por qualquer termo; os rótulos ordenam e filtram. Serve também a Redistribuir Para das
 * Redistribuições de Gastos (20/11/2026, pedido do Adão), com a descrição dela.
 */
export function CentrosDeCustoDialog<C extends CentroDaLupa>({
  centros,
  onEscolher,
  onFechar,
  descricao = "Clique num centro para escolhê-lo como o novo centro de custo. São os ativos de um departamento da DRE, com o código de três níveis (como 1.01.00000001). O balde do centro decide como os lançamentos dele chegam às unidades (Regras de Rateio).",
}: {
  centros: C[];
  onEscolher: (c: C) => void;
  onFechar: () => void;
  descricao?: string;
}) {
  const [busca, setBusca] = useState("");
  const termos = normal(busca).split(/\s+/).filter(Boolean);
  const achados = useMemo(
    () => centros.filter((c) => !termos.length || termos.every((t) => normal(`${c.codigoRM ?? ""} ${c.nomeRM} ${c.departamento ?? ""}`).includes(t))),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- os termos saem da busca.
    [centros, busca],
  );
  const tabela = useTabelaFiltravel<C>(achados, COLUNAS as Coluna<C>[]);
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent className="flex max-h-[90vh] w-[min(72rem,calc(100%_-_2rem))] max-w-none flex-col overflow-hidden rounded-sm sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Centros de Custo</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Código, nome ou departamento" className="h-8 w-80 rounded-sm border-gray-300" autoComplete="off" />
          <p className="text-sm text-gray-700">
            {tabela.total.toLocaleString("pt-BR")} {plural(tabela.total, "centro de custo", "centros de custo")}
            {tabela.total !== centros.length ? ` de ${centros.length.toLocaleString("pt-BR")}` : ""}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-sm border border-gray-200 [--topo-tabela:0px]">
          <table className="tabela-sig w-full border-collapse text-xs">
            {tabela.cabecalho}
            <tbody>
              {tabela.visiveis.length === 0 ? (
                <SemResultado colunas={COLUNAS.length} onLimpar={tabela.limpar} />
              ) : (
                tabela.visiveis.map((c) => (
                  <tr
                    key={c.id}
                    data-altera=""
                    tabIndex={0}
                    onClick={() => onEscolher(c)}
                    onKeyDown={(e) => (e.key === "Enter" ? onEscolher(c) : undefined)}
                    title="Escolher este centro de custo"
                    className="cursor-pointer border-b border-gray-100 align-top hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                  >
                    {COLUNAS.map((col) => (
                      <td key={col.chave} className={`px-3 py-1.5 ${col.chave === "codigo" ? "font-medium whitespace-nowrap" : ""}`}>
                        {col.valor?.(c) ?? <span className="text-gray-400">—</span>}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
