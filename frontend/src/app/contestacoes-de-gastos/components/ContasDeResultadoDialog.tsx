"use client";

import { useMemo, useState } from "react";

import { SemResultado, useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Coluna } from "@/lib/filtrosDeTabela";
import { plural } from "@/lib/texto";

import { contaCabeNoCentro, ROTULO_DEPARTAMENTO, type ContaOpcao, type DepartamentoDoRecorte } from "../services/contestacoesService";
import { ROTULO_BALDE } from "./RegrasDeRateioDialog";

/** Sem acentos e sem caixa, para a busca achar "manutencao" em "MANUTENÇÃO". */
export const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** O código da conta como número, para ordenar (os códigos com sufixo, como 112294.D, pelo número). */
const numeroDaConta = (reduzido: string) => parseInt(reduzido, 10) || 0;

const COLUNAS: Coluna<ContaOpcao>[] = [
  { chave: "conta", rotulo: "Conta", tipo: "numero", valor: (c) => numeroDaConta(c.reduzido), texto: (c) => c.reduzido, classe: "w-20" },
  { chave: "descricao", rotulo: "Descrição", valor: (c) => c.descricao },
  { chave: "linha", rotulo: "Linha do DRE", valor: (c) => c.linha?.descricao ?? null },
  { chave: "grupo", rotulo: "Grupo", valor: (c) => c.linha?.grupo ?? null },
  { chave: "departamento", rotulo: "Departamento", valor: (c) => (c.departamentoDoRecorte ? ROTULO_DEPARTAMENTO[c.departamentoDoRecorte] : null) },
  { chave: "atribuicao", rotulo: "Atribuição", valor: (c) => c.atribuicao },
  { chave: "balde", rotulo: "Balde", valor: (c) => (c.balde ? (ROTULO_BALDE[c.balde] ?? c.balde) : null) },
];

/**
 * A lista das contas do modal Contestar (04/11/2026, pedido do Adão; a lupa ao lado da Nova Conta de Resultado): as Contas
 * de Resultado que a contestação pode escolher — as analíticas ativas com destino na DRE —, com a linha e o grupo da DRE, o
 * departamento, a atribuição e o balde (o da conta vale para os lançamentos sem centro de custo). Clicar numa conta a escolhe;
 * de início, só as que cabem no centro (as do departamento dele e as do Extra-Operacional); as demais, com a caixa
 * desmarcada, aparecem em cinza, sem o clique. A busca acha por qualquer termo; os rótulos ordenam e filtram.
 */
export function ContasDeResultadoDialog({
  contas,
  departamentoDoCentro,
  onEscolher,
  onFechar,
}: {
  contas: ContaOpcao[];
  departamentoDoCentro: DepartamentoDoRecorte | null;
  onEscolher: (c: ContaOpcao) => void;
  onFechar: () => void;
}) {
  const [busca, setBusca] = useState("");
  const [soDoCentro, setSoDoCentro] = useState(true);
  const cabe = (c: ContaOpcao) => contaCabeNoCentro(departamentoDoCentro, c.departamentoDoRecorte);
  const termos = normal(busca).split(/\s+/).filter(Boolean);
  // Na ordem do código da conta, como número (o cadastro a manda pelo texto: 10991 antes de 1123).
  const achadas = useMemo(
    () =>
      contas
        .filter((c) => !soDoCentro || contaCabeNoCentro(departamentoDoCentro, c.departamentoDoRecorte))
        .filter((c) => !termos.length || termos.every((t) => normal(`${c.reduzido} ${c.descricao} ${c.linha?.descricao ?? ""} ${c.linha?.grupo ?? ""}`).includes(t)))
        .sort((a, b) => numeroDaConta(a.reduzido) - numeroDaConta(b.reduzido) || a.reduzido.localeCompare(b.reduzido)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- os termos saem da busca.
    [contas, busca, soDoCentro, departamentoDoCentro],
  );
  const tabela = useTabelaFiltravel(achadas, COLUNAS);
  const doCentro = departamentoDoCentro ? `${ROTULO_DEPARTAMENTO[departamentoDoCentro]} e Extra-Operacional` : null;
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent className="flex max-h-[90vh] w-[min(80rem,calc(100%_-_2rem))] max-w-none flex-col overflow-hidden rounded-sm sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Contas de Resultado</DialogTitle>
          <DialogDescription>
            Clique numa conta para escolhê-la como a nova conta de resultado. O balde da conta (a chave de rateio ou o destino direto) vale para os
            lançamentos sem centro de custo; com centro, vale o balde do centro.
          </DialogDescription>
        </DialogHeader>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Código, nome ou linha da DRE" className="h-8 w-80 rounded-sm border-gray-300" autoComplete="off" />
            {doCentro ? (
              <label className="inline-flex items-center gap-2 text-sm text-gray-800">
                <input type="checkbox" className="accent-black" checked={soDoCentro} onChange={(e) => setSoDoCentro(e.target.checked)} />
                Só as do Centro de Custo ({doCentro})
              </label>
            ) : null}
          </div>
          <p className="text-sm text-gray-700">
            {tabela.total.toLocaleString("pt-BR")} {plural(tabela.total, "conta", "contas")}
            {tabela.total !== contas.length ? ` de ${contas.length.toLocaleString("pt-BR")}` : ""}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-sm border border-gray-200 [--topo-tabela:0px]">
          <table className="tabela-sig w-full border-collapse text-xs">
            {tabela.cabecalho}
            <tbody>
              {tabela.visiveis.length === 0 ? (
                <SemResultado colunas={COLUNAS.length} onLimpar={tabela.limpar} />
              ) : (
                tabela.visiveis.map((c) => {
                  const pode = cabe(c);
                  const escolher = () => pode && onEscolher(c);
                  return (
                    <tr
                      key={c.id}
                      data-altera={pode ? "" : undefined}
                      tabIndex={pode ? 0 : undefined}
                      onClick={escolher}
                      onKeyDown={(e) => (e.key === "Enter" ? escolher() : undefined)}
                      title={pode ? "Escolher esta conta" : `Fora do departamento do centro de custo (${doCentro}): escolha outro centro para usar esta conta`}
                      className={`border-b border-gray-100 align-top ${pode ? "cursor-pointer hover:bg-gray-100 focus:bg-gray-100 focus:outline-none" : "text-gray-400"}`}
                    >
                      {COLUNAS.map((col) => (
                        <td key={col.chave} className={`px-3 py-1.5 ${col.chave === "conta" ? "font-medium whitespace-nowrap" : ""}`}>
                          {(col.chave === "conta" ? c.reduzido : col.valor?.(c)) ?? <span className="text-gray-400">—</span>}
                        </td>
                      ))}
                    </tr>
                  );
                })
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
