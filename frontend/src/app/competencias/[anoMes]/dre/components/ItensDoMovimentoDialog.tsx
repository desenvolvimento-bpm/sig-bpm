"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, MessageSquareWarning } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { plural } from "@/lib/texto";

import { botaoPrimario } from "@/app/cenarios/components/CenarioDialog";
import { ROTULO_SITUACAO } from "@/app/contestacoes-de-gastos/services/contestacoesService";

import { moeda } from "../../utils/formatacao";
import { mensagemDeErro, type ItemContestado, type ItemDaNotaFiscal, type ItemDaRequisicao, type ItensDoMovimento } from "../services/dreService";

const dataCurta = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—");
const quantidade = (q: string | null) => (q === null ? "—" : Number(q).toLocaleString("pt-BR", { maximumFractionDigits: 4 }));
const juntar = (...partes: Array<string | number | null | undefined>) => partes.filter((p) => p !== null && p !== undefined && p !== "").join(" · ") || "—";
const centro = (i: ItemDaRequisicao | ItemDaNotaFiscal) => juntar(i.codigoCentroCusto, i.nomeCentroCusto);
const conta = (i: ItemDaRequisicao | ItemDaNotaFiscal) => juntar(i.contaContabil, i.descricaoConta);
const produto = (i: ItemDaRequisicao | ItemDaNotaFiscal) => juntar(i.codigoProduto, i.descricaoItem);
const tipo = (i: ItemDaRequisicao | ItemDaNotaFiscal) => juntar(i.tipoMovimento, i.nomeTipoMovimento);
const soma = (xs: Array<{ valorTotal: string }>) => xs.reduce((s, i) => s + Math.round(Number(i.valorTotal) * 100), 0) / 100;

type Origem = ItemContestado["origem"];
const chave = (origem: Origem, id: string) => `${origem}:${id}`;

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

/** Os itens marcados para o Contestar Selecionados: cada um (a lista e o id), quantos, a soma e o valor no sinal do movimento. */
export type ItensSelecionados = { itens: Array<{ origem: Origem; id: string }>; quantidade: number; doMovimento: number; total: number; valor: string };

/**
 * Itens do Movimento (10/11/2026, pedido do Adão): os itens da requisição ou da nota fiscal com o ID do movimento no RM (a
 * coluna ID do Balancete (Lista); o IDENTIFICADOR das abas Requisições (Lista) e Notas Fiscais (Lista) importadas), de
 * qualquer competência. Abre do modal Balancete dos extratos e do Ver Movimentos das Contestações de Gastos. Abre só com os
 * itens do centro de custo e da conta do movimento (que somam o valor dele); a caixa mostra o documento inteiro, com os
 * itens do movimento em destaque. Voltar aos Movimentos fecha o modal e volta ao de antes.
 *
 * Contestar Selecionados (10/11/2026, pedido do Adão; só no modal Balancete, com `contestar`): uma caixa em cada item do
 * movimento, e o botão abre o Contestar só com os itens marcados — o valor deles muda de centro e/ou de conta. O item já numa
 * contestação de itens não recusada mostra o número dela, sem a caixa.
 */
export function ItensDoMovimentoDialog({
  movimento,
  queryKey,
  carregar,
  onFechar,
  contestar,
}: {
  movimento: MovimentoDosItens;
  queryKey: readonly unknown[];
  carregar: () => Promise<ItensDoMovimento>;
  onFechar: () => void;
  /**
   * O Contestar Selecionados: por que não se contesta (nulo se pode; a caixa fica desabilitada, com o motivo) e o modal
   * Contestar com os itens marcados (`concluir` limpa a seleção depois de contestar).
   */
  contestar?: { bloqueio: string | null; render: (s: ItensSelecionados, fechar: () => void, concluir: () => void) => ReactNode };
}) {
  const consulta = useQuery({ queryKey, queryFn: carregar });
  const [soDoMovimento, setSoDoMovimento] = useState(true);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [contestando, setContestando] = useState(false);
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

  // As contestações dos itens e a seleção (10/11/2026).
  const contestados = new Map((d?.contestados ?? []).map((x) => [chave(x.origem, x.id), x]));
  const contestadoDe = (origem: Origem, i: { id: string }) => contestados.get(chave(origem, i.id));
  const selecionavel = (origem: Origem, i: ItemDaRequisicao | ItemDaNotaFiscal) => !!contestar && !contestar.bloqueio && doMovimento(i) && !contestadoDe(origem, i);
  const comColuna = !!contestar || contestados.size > 0;
  const lista = [...d?.notas.map((i) => ({ origem: "NOTA_FISCAL" as const, i })) ?? [], ...d?.requisicoes.map((i) => ({ origem: "REQUISICAO" as const, i })) ?? []];
  const escolhidos = lista.filter((x) => marcados.has(chave(x.origem, x.i.id)) && selecionavel(x.origem, x.i));
  const totalEscolhido = soma(escolhidos.map((x) => x.i));
  const negativo = Number(movimento.valor) < 0;
  const selecao: ItensSelecionados = {
    itens: escolhidos.map((x) => ({ origem: x.origem, id: x.i.id })),
    quantidade: escolhidos.length,
    doMovimento: deste.length,
    total: totalEscolhido,
    valor: (negativo ? -totalEscolhido : totalEscolhido).toFixed(2),
  };
  const alternar = (k: string, marcar: boolean) =>
    setMarcados((s) => {
      const n = new Set(s);
      if (marcar) n.add(k);
      else n.delete(k);
      return n;
    });
  const motivoDoBotao = contestar?.bloqueio ?? (escolhidos.length ? undefined : "Marque os itens do movimento a contestar");

  /** A primeira coluna: a caixa do item selecionável ou o número da contestação do item contestado. */
  const cabecalhoDaSelecao = (origem: Origem, itens: Array<ItemDaRequisicao | ItemDaNotaFiscal>) => {
    if (!comColuna) return null;
    const livres = itens.filter((i) => selecionavel(origem, i));
    const todosMarcados = livres.length > 0 && livres.every((i) => marcados.has(chave(origem, i.id)));
    return (
      <th className="w-8 px-2 py-1.5 font-medium">
        {contestar ? (
          <input
            type="checkbox"
            className="accent-black"
            aria-label="Marcar todos os itens do movimento"
            title={contestar.bloqueio ?? (livres.length ? "Marcar todos os itens do movimento" : "Nenhum item do movimento a contestar")}
            disabled={!livres.length}
            checked={todosMarcados}
            onChange={(e) => setMarcados((s) => {
              const n = new Set(s);
              for (const i of livres) {
                if (e.target.checked) n.add(chave(origem, i.id));
                else n.delete(chave(origem, i.id));
              }
              return n;
            })}
          />
        ) : null}
      </th>
    );
  };
  const celulaDaSelecao = (origem: Origem, i: ItemDaRequisicao | ItemDaNotaFiscal) => {
    if (!comColuna) return null;
    const ct = contestadoDe(origem, i);
    if (ct) {
      return (
        <td className="px-2 py-1.5 whitespace-nowrap">
          <span
            className={`inline-block rounded-sm border px-1.5 py-0.5 text-[11px] ${ct.desta ? "border-amber-300 bg-amber-50 font-medium text-amber-900" : "border-gray-300 bg-gray-50 text-gray-700"}`}
            title={`Item ${ct.desta ? "desta contestação" : "contestado"}: a contestação nº ${ct.numero} (${ROTULO_SITUACAO[ct.situacao].toLowerCase()})`}
          >
            Nº {ct.numero}
          </span>
        </td>
      );
    }
    const k = chave(origem, i.id);
    return (
      <td className="px-2 py-1.5">
        {contestar && doMovimento(i) ? (
          <input
            type="checkbox"
            className="accent-black"
            aria-label={`Marcar o item ${produto(i)}`}
            title={contestar.bloqueio ?? undefined}
            disabled={!selecionavel(origem, i)}
            checked={marcados.has(k) && selecionavel(origem, i)}
            onChange={(e) => alternar(k, e.target.checked)}
          />
        ) : null}
      </td>
    );
  };

  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent className="flex max-h-[90vh] w-[min(84rem,calc(100%_-_2rem))] max-w-none flex-col overflow-hidden rounded-sm sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Itens do Movimento {movimento.idMovimento}</DialogTitle>
          <DialogDescription>
            {juntar(movimento.emissao ? dataCurta(movimento.emissao) : null, movimento.cliForn, movimento.historico)} · {moeda(movimento.valor)}. Os itens da requisição ou
            da nota fiscal com este ID (o IDENTIFICADOR das abas Requisições (Lista) e Notas Fiscais (Lista) importadas).
            {contestar ? " Marque os itens do movimento e clique em Contestar Selecionados para contestar só eles." : ""}
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
                        {cabecalhoDaSelecao("NOTA_FISCAL", notas)}
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
                          {celulaDaSelecao("NOTA_FISCAL", n)}
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
                        {cabecalhoDaSelecao("REQUISICAO", requisicoes)}
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
                          {celulaDaSelecao("REQUISICAO", r)}
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
            {escolhidos.length ? (
              <>
                {" "}
                · Selecionados ({escolhidos.length} {plural(escolhidos.length, "item", "itens")}) <span className="font-bold text-gray-900">{moeda(totalEscolhido)}</span>
              </>
            ) : null}
          </p>
        ) : null}

        <DialogFooter className="shrink-0 sm:justify-between">
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            <ArrowLeft className="size-4" />
            Voltar aos Movimentos
          </Button>
          {contestar ? (
            <Button type="button" className={botaoPrimario} disabled={!!motivoDoBotao} title={motivoDoBotao} onClick={() => setContestando(true)}>
              <MessageSquareWarning className="size-4" />
              Contestar Selecionados
            </Button>
          ) : null}
        </DialogFooter>
        {contestar && contestando
          ? contestar.render(
              selecao,
              () => setContestando(false),
              () => {
                setContestando(false);
                setMarcados(new Set());
              },
            )
          : null}
      </DialogContent>
    </Dialog>
  );
}
