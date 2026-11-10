"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { plural } from "@/lib/texto";

import { moeda } from "../../utils/formatacao";
import { mensagemDeErro, type ItemDaNotaFiscal, type ItemDaRequisicao, type ItensDoMovimento } from "../services/dreService";

const dataCurta = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—");
const quantidade = (q: string | null) => (q === null ? "—" : Number(q).toLocaleString("pt-BR", { maximumFractionDigits: 4 }));
const juntar = (...partes: Array<string | number | null | undefined>) => partes.filter((p) => p !== null && p !== undefined && p !== "").join(" · ") || "—";
const centro = (i: ItemDaRequisicao | ItemDaNotaFiscal) => juntar(i.codigoCentroCusto, i.nomeCentroCusto);
const conta = (i: ItemDaRequisicao | ItemDaNotaFiscal) => juntar(i.contaContabil, i.descricaoConta);
const produto = (i: ItemDaRequisicao | ItemDaNotaFiscal) => juntar(i.codigoProduto, i.descricaoItem);
const tipo = (i: ItemDaRequisicao | ItemDaNotaFiscal) => juntar(i.tipoMovimento, i.nomeTipoMovimento);
const soma = (xs: Array<{ valorTotal: string }>) => xs.reduce((s, i) => s + Number(i.valorTotal), 0);

/** O movimento do extrato ou da contestação cujos itens se mostram. */
export type MovimentoDosItens = {
  idMovimento: string;
  emissao: string | null;
  cliForn: string | null;
  historico: string | null;
  valor: string;
  /**
   * A conta (o código reduzido) e o centro de custo (o código RM) do movimento no balancete: uma nota fiscal ou requisição
   * com itens em vários centros ou contas vira um movimento por centro e conta no balancete.
   */
  conta?: string | null;
  centro?: string | null;
};

/**
 * Itens do Movimento (10/11/2026, pedido do Adão): os itens da requisição ou da nota fiscal com o ID do movimento no RM (a
 * coluna ID do Balancete (Lista); o IDENTIFICADOR das abas Requisições (Lista) e Notas Fiscais (Lista) importadas), de
 * qualquer competência. Abre do modal Balancete dos extratos e do Ver Movimentos das Contestações de Gastos. Abre só com os
 * itens do centro de custo e da conta do movimento (que somam o valor dele); a caixa mostra o documento inteiro, com os
 * itens do movimento em destaque.
 */
export function ItensDoMovimentoDialog({
  movimento,
  queryKey,
  carregar,
  onFechar,
}: {
  movimento: MovimentoDosItens;
  queryKey: readonly unknown[];
  carregar: () => Promise<ItensDoMovimento>;
  onFechar: () => void;
}) {
  const consulta = useQuery({ queryKey, queryFn: carregar });
  const [soDoMovimento, setSoDoMovimento] = useState(true);
  const d = consulta.data;
  const todos = d ? [...d.notas, ...d.requisicoes] : [];
  const doMovimento = (i: ItemDaRequisicao | ItemDaNotaFiscal) => (!movimento.conta || i.contaContabil === movimento.conta) && (!movimento.centro || i.codigoCentroCusto === movimento.centro);
  const deste = todos.filter(doMovimento);
  // A caixa só quando o documento tem itens de outros centros ou contas (e algum do movimento).
  const comCaixa = !!(movimento.conta || movimento.centro) && deste.length > 0 && deste.length < todos.length;
  const recortado = comCaixa && soDoMovimento;
  const notas = d ? (recortado ? d.notas.filter(doMovimento) : d.notas) : [];
  const requisicoes = d ? (recortado ? d.requisicoes.filter(doMovimento) : d.requisicoes) : [];
  const destaque = (i: ItemDaRequisicao | ItemDaNotaFiscal) => (comCaixa && !recortado && doMovimento(i) ? "bg-yellow-50" : "");
  const tituloDasNotas = [...new Set(notas.map((n) => juntar(n.numero ? `Nota Fiscal ${n.numero}` : "Nota Fiscal", n.fornecedor, tipo(n))))];
  const tituloDasRequisicoes = [...new Set(requisicoes.map((r) => juntar("Requisição", tipo(r))))];
  const recorte = [movimento.centro ? "do centro de custo" : null, movimento.conta ? "da conta" : null].filter(Boolean).join(" e ");

  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent className="flex max-h-[90vh] w-[min(84rem,calc(100%_-_2rem))] max-w-none flex-col overflow-hidden rounded-sm sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Itens do Movimento {movimento.idMovimento}</DialogTitle>
          <DialogDescription>
            {juntar(movimento.emissao ? dataCurta(movimento.emissao) : null, movimento.cliForn, movimento.historico)} · {moeda(movimento.valor)}. Os itens da requisição ou
            da nota fiscal com este ID (o IDENTIFICADOR das abas Requisições (Lista) e Notas Fiscais (Lista) importadas).
          </DialogDescription>
        </DialogHeader>

        {d && comCaixa ? (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-gray-800">
              <input type="checkbox" className="accent-black" checked={soDoMovimento} onChange={(e) => setSoDoMovimento(e.target.checked)} />
              Só do Centro de Custo e da Conta do Movimento
            </label>
            {!recortado ? <p className="text-sm text-gray-700">Os itens {recorte} do movimento em amarelo.</p> : null}
          </div>
        ) : null}

        {consulta.isError ? (
          <p className="text-sm text-red-700">{mensagemDeErro(consulta.error, "Erro ao carregar os itens do movimento.")}</p>
        ) : !d ? (
          <div className="h-40 animate-pulse rounded-sm bg-gray-100" />
        ) : todos.length === 0 ? (
          <p className="rounded-sm border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-900">
            Nenhum item com o ID {movimento.idMovimento} nas requisições e nas notas fiscais importadas. Importe as abas Requisições (Lista) e Notas Fiscais (Lista) do mês
            do movimento em Importações.
          </p>
        ) : (
          <div className="min-h-0 flex-1 space-y-4 overflow-auto [--topo-tabela:0px]">
            {notas.length ? (
              <section className="space-y-1.5">
                <h3 className="text-sm font-semibold text-gray-900">{tituloDasNotas.join(" | ")}</h3>
                <div className="rounded-sm border border-gray-200">
                  <table className="tabela-sig w-full border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-600">
                        <th className="px-3 py-1.5 font-medium">Competência</th>
                        <th className="px-3 py-1.5 font-medium">Emissão</th>
                        <th className="px-3 py-1.5 font-medium">Produto</th>
                        <th className="px-3 py-1.5 font-medium">Centro de Custo</th>
                        <th className="px-3 py-1.5 font-medium">Conta</th>
                        <th className="px-3 py-1.5 font-medium">CFOP</th>
                        <th className="px-3 py-1.5 text-right font-medium">Quantidade</th>
                        <th className="px-3 py-1.5 text-right font-medium">Subtotal</th>
                        <th className="px-3 py-1.5 text-right font-medium">Desconto</th>
                        <th className="px-3 py-1.5 text-right font-medium">Valor Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {notas.map((n) => (
                        <tr key={n.id} className={`border-b border-gray-100 align-top ${destaque(n)}`}>
                          <td className="px-3 py-1.5 whitespace-nowrap">{n.competencia}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap">{dataCurta(n.data)}</td>
                          <td className="px-3 py-1.5">{produto(n)}</td>
                          <td className="px-3 py-1.5">{centro(n)}</td>
                          <td className="px-3 py-1.5">{conta(n)}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap">{n.cfop ?? "—"}</td>
                          <td className="px-3 py-1.5 text-right whitespace-nowrap">{quantidade(n.quantidade)}</td>
                          <td className="px-3 py-1.5 text-right whitespace-nowrap">{n.subtotal === null ? "—" : moeda(n.subtotal)}</td>
                          <td className="px-3 py-1.5 text-right whitespace-nowrap">{n.desconto === null ? "—" : moeda(n.desconto)}</td>
                          <td className="px-3 py-1.5 text-right whitespace-nowrap">{moeda(n.valorTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
            {requisicoes.length ? (
              <section className="space-y-1.5">
                <h3 className="text-sm font-semibold text-gray-900">{tituloDasRequisicoes.join(" | ")}</h3>
                <div className="rounded-sm border border-gray-200">
                  <table className="tabela-sig w-full border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-600">
                        <th className="px-3 py-1.5 font-medium">Competência</th>
                        <th className="px-3 py-1.5 font-medium">Baixa</th>
                        <th className="px-3 py-1.5 font-medium">Produto</th>
                        <th className="px-3 py-1.5 font-medium">Centro de Custo</th>
                        <th className="px-3 py-1.5 font-medium">Conta</th>
                        <th className="px-3 py-1.5 text-right font-medium">Quantidade</th>
                        <th className="px-3 py-1.5 text-right font-medium">Valor Unitário</th>
                        <th className="px-3 py-1.5 text-right font-medium">Valor Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {requisicoes.map((r) => (
                        <tr key={r.id} className={`border-b border-gray-100 align-top ${destaque(r)}`}>
                          <td className="px-3 py-1.5 whitespace-nowrap">{r.competencia}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap">{dataCurta(r.data)}</td>
                          <td className="px-3 py-1.5">{produto(r)}</td>
                          <td className="px-3 py-1.5">{centro(r)}</td>
                          <td className="px-3 py-1.5">{conta(r)}</td>
                          <td className="px-3 py-1.5 text-right whitespace-nowrap">{quantidade(r.quantidade)}</td>
                          <td className="px-3 py-1.5 text-right whitespace-nowrap">{r.valorUnitario === null ? "—" : moeda(r.valorUnitario)}</td>
                          <td className="px-3 py-1.5 text-right whitespace-nowrap">{moeda(r.valorTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
          </div>
        )}

        {d && todos.length > 0 ? (
          <p className="shrink-0 text-right text-sm text-gray-700">
            {recortado ? (
              <>
                {deste.length} de {todos.length} {plural(todos.length, "item", "itens")} · Soma <span className="font-bold text-gray-900">{moeda(soma(deste))}</span> · Movimento{" "}
                <span className="font-bold text-gray-900">{moeda(movimento.valor)}</span>
              </>
            ) : (
              <>
                {todos.length} {plural(todos.length, "item", "itens")} · Soma <span className="font-bold text-gray-900">{moeda(soma(todos))}</span>
                {comCaixa ? (
                  <>
                    {" "}
                    · Do movimento ({deste.length} {plural(deste.length, "item", "itens")}) <span className="font-bold text-gray-900">{moeda(soma(deste))}</span>
                  </>
                ) : (
                  <>
                    {" "}
                    · Movimento <span className="font-bold text-gray-900">{moeda(movimento.valor)}</span>
                  </>
                )}
              </>
            )}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
