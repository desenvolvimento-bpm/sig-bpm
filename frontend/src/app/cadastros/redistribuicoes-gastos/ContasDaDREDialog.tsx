"use client";

import { useMemo, useState } from "react";

import { SemResultado, useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Coluna } from "@/lib/filtrosDeTabela";
import { plural } from "@/lib/texto";

import { normal } from "@/app/contestacoes-de-gastos/components/ContasDeResultadoDialog";
import type { ContaDaRedistribuicao } from "../services/redistribuicoesService";

/**
 * A lista das Contas da DRE do modal Redistribuição de Gastos (20/11/2026, pedido do Adão; a lupa ao lado da Conta da DRE, como
 * a das contas no modal Contestar): as linhas de item ativas da Estrutura da DRE, com o código, o grupo, a atribuição e as unidades
 * em que aparecem. Clicar numa conta a inclui entre as escolhidas. De início, só as do departamento e da unidade escolhidos; com a
 * caixa desmarcada, as de fora do departamento aparecem em cinza, sem o clique (a redistribuição de um departamento só vale nas
 * contas dele), e as de outra unidade podem ser escolhidas (a Unidade só filtra). As já escolhidas aparecem em cinza.
 */
export function ContasDaDREDialog({
  contas,
  unidades,
  doDepartamento,
  nomeDoDepartamento,
  unidade,
  escolhidas,
  onEscolher,
  onFechar,
}: {
  contas: ContaDaRedistribuicao[];
  unidades: Array<{ codigo: number; nome: string }>;
  /** As contas do departamento escolhido (nulo: Todos). */
  doDepartamento: Set<string> | null;
  nomeDoDepartamento: string | null;
  /** O código da unidade escolhida (nulo: Todas). */
  unidade: number | null;
  escolhidas: Set<string>;
  onEscolher: (c: ContaDaRedistribuicao) => void;
  onFechar: () => void;
}) {
  const [busca, setBusca] = useState("");
  const [soDoFiltro, setSoDoFiltro] = useState(true);
  const nomeDaUnidade = useMemo(() => new Map(unidades.map((u) => [u.codigo, u.nome])), [unidades]);
  const colunas = useMemo<Coluna<ContaDaRedistribuicao>[]>(
    () => [
      { chave: "codigo", rotulo: "Código", valor: (c) => c.codigo },
      { chave: "descricao", rotulo: "Conta da DRE", valor: (c) => c.descricao },
      { chave: "grupo", rotulo: "Grupo", valor: (c) => c.grupo },
      { chave: "atribuicao", rotulo: "Atribuição", valor: (c) => c.atribuicao },
      { chave: "unidades", rotulo: "Unidades", valor: (c) => c.unidades.map((u) => nomeDaUnidade.get(u) ?? String(u)).join(", ") || null },
    ],
    [nomeDaUnidade],
  );
  const cabe = (c: ContaDaRedistribuicao) => !doDepartamento || doDepartamento.has(c.id);
  const noFiltro = (c: ContaDaRedistribuicao) => cabe(c) && (unidade === null || c.unidades.includes(unidade));
  const termos = normal(busca).split(/\s+/).filter(Boolean);
  // Na ordem da Estrutura da DRE (a das opções).
  const achadas = useMemo(
    () =>
      contas
        .filter((c) => !soDoFiltro || noFiltro(c))
        .filter((c) => !termos.length || termos.every((t) => normal(`${c.codigo} ${c.descricao} ${c.grupo} ${c.atribuicao ?? ""}`).includes(t))),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- os termos saem da busca; o filtro, do departamento e da unidade.
    [contas, busca, soDoFiltro, doDepartamento, unidade],
  );
  const tabela = useTabelaFiltravel(achadas, colunas);
  const filtro = [nomeDoDepartamento, unidade !== null ? nomeDaUnidade.get(unidade) : null].filter(Boolean).join(" · ");
  const rotuloDoFiltro = nomeDoDepartamento && unidade !== null ? "Só as do Departamento e da Unidade" : nomeDoDepartamento ? "Só as do Departamento" : "Só as da Unidade";
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent className="flex max-h-[90vh] w-[min(72rem,calc(100%_-_2rem))] max-w-none flex-col overflow-hidden rounded-sm sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Contas da DRE</DialogTitle>
          <DialogDescription>
            Clique numa conta para incluí-la entre as contas da redistribuição. São as linhas de item ativas da Estrutura da DRE; os fornecedores da
            redistribuição são os que têm movimentos em qualquer das contas escolhidas.
          </DialogDescription>
        </DialogHeader>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Código, nome ou grupo da conta" className="h-8 w-80 rounded-sm border-gray-300" autoComplete="off" />
            {filtro ? (
              <label className="inline-flex items-center gap-2 text-sm text-gray-800">
                <input type="checkbox" className="accent-black" checked={soDoFiltro} onChange={(e) => setSoDoFiltro(e.target.checked)} />
                {rotuloDoFiltro} ({filtro})
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
                <SemResultado colunas={colunas.length} onLimpar={tabela.limpar} />
              ) : (
                tabela.visiveis.map((c) => {
                  const escolhida = escolhidas.has(c.id);
                  const pode = cabe(c) && !escolhida;
                  const escolher = () => pode && onEscolher(c);
                  return (
                    <tr
                      key={c.id}
                      data-altera={pode ? "" : undefined}
                      tabIndex={pode ? 0 : undefined}
                      onClick={escolher}
                      onKeyDown={(e) => (e.key === "Enter" ? escolher() : undefined)}
                      title={
                        escolhida
                          ? "Esta conta já está entre as escolhidas"
                          : pode
                            ? "Incluir esta conta"
                            : `Fora do departamento ${nomeDoDepartamento ?? ""}: escolha outro departamento (ou Todos) para usar esta conta`
                      }
                      className={`border-b border-gray-100 align-top ${pode ? "cursor-pointer hover:bg-gray-100 focus:bg-gray-100 focus:outline-none" : "text-gray-400"}`}
                    >
                      {colunas.map((col) => (
                        <td key={col.chave} className={`px-3 py-1.5 ${col.chave === "codigo" ? "font-medium whitespace-nowrap" : ""}`}>
                          {col.valor?.(c) ?? <span className="text-gray-400">—</span>}
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
