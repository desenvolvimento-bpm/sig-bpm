"use client";

import { useMemo, useState } from "react";

import { SemResultado, useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Coluna } from "@/lib/filtrosDeTabela";
import { plural } from "@/lib/texto";

import { botaoPrimario } from "@/app/cenarios/components/CenarioDialog";
import { normal } from "@/app/contestacoes-de-gastos/components/ContasDeResultadoDialog";
import type { ContaDaRedistribuicao } from "../services/redistribuicoesService";

/**
 * A lista das Contas da DRE do modal Redistribuição de Gastos (20/11/2026, pedido do Adão; a lupa ao lado da Conta da DRE, como
 * a das contas no modal Contestar): as linhas de item ativas da Estrutura da DRE, com o código, o grupo, a atribuição e as unidades
 * em que aparecem. Desde 25/11/2026 (pedido do Adão), várias de uma vez: as caixas das linhas (o clique na linha também marca) e a
 * do rótulo (todas as da tabela, com os filtros), e "Incluir Marcadas". De início, só as do departamento e da unidade escolhidos;
 * com a caixa desmarcada, as de fora do departamento aparecem em cinza, sem a caixa (a redistribuição de um departamento só vale
 * nas contas dele), e as de outra unidade podem ser escolhidas (a Unidade só filtra). As já escolhidas aparecem em cinza.
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
  /** As contas marcadas, na ordem da Estrutura da DRE. */
  onEscolher: (contas: ContaDaRedistribuicao[]) => void;
  onFechar: () => void;
}) {
  const [busca, setBusca] = useState("");
  const [marcadas, setMarcadas] = useState<Set<string>>(() => new Set());
  const [soDoFiltro, setSoDoFiltro] = useState(true);
  const nomeDaUnidade = useMemo(() => new Map(unidades.map((u) => [u.codigo, u.nome])), [unidades]);
  const colunas = useMemo<Coluna<ContaDaRedistribuicao>[]>(
    () => [
      { chave: "marcar", rotulo: "", semFiltro: true, classe: "w-10" },
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
  // As que se podem marcar: as do departamento (ou de Todos) que ainda não estão entre as escolhidas.
  const podeMarcar = (c: ContaDaRedistribuicao) => cabe(c) && !escolhidas.has(c.id);
  const marcaveis = tabela.filtradas.filter(podeMarcar);
  const todasMarcadas = marcaveis.length > 0 && marcaveis.every((c) => marcadas.has(c.id));
  const alternar = (id: string) =>
    setMarcadas((atual) => {
      const nova = new Set(atual);
      if (nova.has(id)) nova.delete(id);
      else nova.add(id);
      return nova;
    });
  const alternarTodas = () =>
    setMarcadas((atual) => {
      const nova = new Set(atual);
      for (const c of marcaveis) {
        if (todasMarcadas) nova.delete(c.id);
        else nova.add(c.id);
      }
      return nova;
    });
  const filtro = [nomeDoDepartamento, unidade !== null ? nomeDaUnidade.get(unidade) : null].filter(Boolean).join(" · ");
  const rotuloDoFiltro = nomeDoDepartamento && unidade !== null ? "Só as do Departamento e da Unidade" : nomeDoDepartamento ? "Só as do Departamento" : "Só as da Unidade";
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent className="flex max-h-[90vh] w-[min(72rem,calc(100%_-_2rem))] max-w-none flex-col overflow-hidden rounded-sm sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Contas da DRE</DialogTitle>
          <DialogDescription>
            Marque as contas (a caixa ou a linha; a caixa do rótulo marca todas as da tabela) e clique em “Incluir Marcadas”. São as linhas de item
            ativas da Estrutura da DRE; os fornecedores da redistribuição são os que têm movimentos em qualquer das contas escolhidas.
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
            {marcadas.size ? ` · ${marcadas.size.toLocaleString("pt-BR")} ${plural(marcadas.size, "marcada", "marcadas")}` : ""}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-sm border border-gray-200 [--topo-tabela:0px]">
          <table className="tabela-sig w-full border-collapse text-xs">
            {tabela.cabecalhoCom({
              marcar: (
                <input
                  type="checkbox"
                  aria-label="Marcar todas as contas da tabela"
                  title="Marcar ou desmarcar todas as contas da tabela (com os filtros) que podem ser incluídas"
                  checked={todasMarcadas}
                  disabled={!marcaveis.length}
                  onChange={alternarTodas}
                  className="size-4 accent-black"
                />
              ),
            })}
            <tbody>
              {tabela.visiveis.length === 0 ? (
                <SemResultado colunas={colunas.length} onLimpar={tabela.limpar} />
              ) : (
                tabela.visiveis.map((c) => {
                  const escolhida = escolhidas.has(c.id);
                  const pode = podeMarcar(c);
                  const marcar = () => pode && alternar(c.id);
                  return (
                    <tr
                      key={c.id}
                      data-altera={pode ? "" : undefined}
                      tabIndex={pode ? 0 : undefined}
                      onClick={marcar}
                      onKeyDown={(e) => (e.key === "Enter" ? marcar() : undefined)}
                      title={
                        escolhida
                          ? "Esta conta já está entre as escolhidas"
                          : pode
                            ? "Marcar ou desmarcar esta conta"
                            : `Fora do departamento ${nomeDoDepartamento ?? ""}: escolha outro departamento (ou Todos) para usar esta conta`
                      }
                      className={`border-b border-gray-100 align-top ${pode ? "cursor-pointer hover:bg-gray-100 focus:bg-gray-100 focus:outline-none" : "text-gray-400"}`}
                    >
                      {colunas.map((col) =>
                        col.chave === "marcar" ? (
                          <td key={col.chave} className="w-10 px-3 py-1.5">
                            <input
                              type="checkbox"
                              aria-label={`Marcar ${c.descricao}`}
                              checked={escolhida || marcadas.has(c.id)}
                              disabled={!pode}
                              onClick={(e) => e.stopPropagation()}
                              onChange={() => alternar(c.id)}
                              className="size-4 accent-black"
                            />
                          </td>
                        ) : (
                          <td key={col.chave} className={`px-3 py-1.5 ${col.chave === "codigo" ? "font-medium whitespace-nowrap" : ""}`}>
                            {col.valor?.(c) ?? <span className="text-gray-400">—</span>}
                          </td>
                        ),
                      )}
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
          <Button type="button" className={botaoPrimario} disabled={!marcadas.size} onClick={() => onEscolher(contas.filter((c) => marcadas.has(c.id)))}>
            Incluir Marcadas
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
