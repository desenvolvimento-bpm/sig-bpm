"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ListTree, MessageSquareWarning } from "lucide-react";

import { EtiquetaRedistribuicao, textoDaRedistribuicao } from "@/components/shared/EtiquetaRedistribuicao";
import { IconeDaCorrecao } from "@/components/shared/IconeDaCorrecao";
import { SemResultado, useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePermissions } from "@/context/PermissionContext";
import type { Coluna } from "@/lib/filtrosDeTabela";
import { plural } from "@/lib/texto";

import { ContestarDialog } from "@/app/contestacoes-de-gastos/components/ContestarDialog";
import { ROTULO_SITUACAO } from "@/app/contestacoes-de-gastos/services/contestacoesService";

import { moeda } from "../../utils/formatacao";
import { dreService, mensagemDeErro, type LancamentoDetalhe, type MovimentoDoBalancete, type VisaoDetalhe } from "../services/dreService";
import { ExportarExtrato } from "./ExportarExtrato";
import { ItensDoMovimentoDialog, type ItensSelecionados } from "./ItensDoMovimentoDialog";

const dataCurta = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : null);
const centroTexto = (d: MovimentoDoBalancete) => (d.codigoCentroCusto ? `${d.codigoCentroCusto}${d.nomeCentroCusto ? ` · ${d.nomeCentroCusto}` : ""}` : null);
const textoDe = (x: { codigoRM: string | null; nome: string | null }) => `${x.codigoRM ?? "sem código"}${x.nome ? ` · ${x.nome}` : ""}`;

/**
 * O balancete de uma conta no mês (15/10/2026; antes, o modal Requisições e Notas Fiscais, com as abas Requisições (Lista)
 * e Notas Fiscais (Lista), que saíram do LISTAS REALIZADO (RESULTADOS)), a partir de um lançamento do extrato: os
 * movimentos do balancete detalhado — a emissão, o cliente ou fornecedor e o histórico de cada um. Abre recortado no
 * centro de custo, na filial e na conta que vale na DRE do lançamento, para comparar com o valor dele; a caixa mostra a
 * conta inteira. A conta do título é a do balancete (antes da reclassificação).
 *
 * As contestações (27/10/2026): o centro e a conta mostrados são os que valem, com o ícone do original quando a
 * reclassificação ou uma contestação os mudou; a coluna Ações tem o Contestar (de quem edita Contestações › Solicitadas)
 * ou a situação da contestação em andamento.
 *
 * Os itens (10/11/2026): com a coluna ID do Balancete (Lista), o ID do movimento no RM numa coluna e o botão Itens, que abre
 * os itens da requisição ou da nota fiscal com ele (as abas Requisições (Lista) e Notas Fiscais (Lista) importadas). Lá, quem
 * contesta marca os itens e clica em Contestar Selecionados: a contestação só dos itens (o valor deles muda).
 */
export function BalanceteDialog({
  anoMes,
  linha,
  visao,
  lancamento,
  rotuloMes,
  onVoltar,
}: {
  anoMes: string;
  linha: string;
  /** A visão do extrato (o Exportar traz os lançamentos da conta nela). */
  visao: VisaoDetalhe;
  lancamento: LancamentoDetalhe;
  rotuloMes?: string;
  onVoltar: () => void;
}) {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const podeContestar = hasPermission("contestacoes.solicitadas:editar");
  const [contestando, setContestando] = useState<MovimentoDoBalancete | null>(null);
  const [vendoItens, setVendoItens] = useState<MovimentoDoBalancete | null>(null);
  const temCentro = !!lancamento.centro?.codigoRM;
  const [soDoLancamento, setSoDoLancamento] = useState(true);
  const filtro = {
    linha,
    conta: lancamento.conta.reduzido,
    ...(soDoLancamento ? { centro: lancamento.centro?.codigoRM ?? null, filial: lancamento.filial, adotada: (lancamento.contaAdotada ?? lancamento.conta).reduzido } : {}),
  };
  const consulta = useQuery({ queryKey: ["dre", anoMes, "balancete", filtro], queryFn: () => dreService.balancete(anoMes, filtro) });
  const d = consulta.data;
  // A conta que vale na DRE, numa coluna, quando algum movimento está noutra (reclassificado ou contestado).
  const comContaNaDRE = !!d?.linhas.some((x) => x.contaNaDRE);
  // O ID do movimento no RM (10/11/2026), numa coluna, quando o balancete o traz.
  const comId = !!d?.linhas.some((x) => x.idMovimento);
  const contaDoBalancete = d ? `${d.conta.reduzido} · ${d.conta.descricao || lancamento.conta.descricao}` : "";
  const colunas = useMemo<Coluna<MovimentoDoBalancete>[]>(
    () => [
      { chave: "emissao", rotulo: "Emissão", tipo: "data", valor: (x) => (x.emissao ? new Date(x.emissao).getTime() : null), texto: (x) => dataCurta(x.emissao) },
      { chave: "cliForn", rotulo: "Cliente/Fornecedor", valor: (x) => x.cliForn },
      { chave: "historico", rotulo: "Histórico", valor: (x) => x.historico },
      { chave: "filial", rotulo: "Filial", tipo: "numero", valor: (x) => x.filial },
      ...(comId ? [{ chave: "id", rotulo: "ID", valor: (x: MovimentoDoBalancete) => x.idMovimento }] : []),
      { chave: "centro", rotulo: "Centro de Custo", valor: centroTexto },
      ...(comContaNaDRE ? [{ chave: "contaDRE", rotulo: "Conta na DRE", valor: (x: MovimentoDoBalancete) => (x.contaNaDRE ? `${x.contaNaDRE.reduzido} · ${x.contaNaDRE.descricao}` : contaDoBalancete) }] : []),
      { chave: "valor", rotulo: "Valor", tipo: "numero", alinhamento: "direita", valor: (x) => Number(x.valor), texto: (x) => moeda(x.valor) },
      { chave: "acoes", rotulo: "Ações", semFiltro: true },
    ],
    [comContaNaDRE, comId, contaDoBalancete],
  );
  const tabela = useTabelaFiltravel(d?.linhas, colunas);
  const soma = useMemo(() => (d ? d.linhas.reduce((s, x) => s + Number(x.valor), 0) : 0), [d]);

  const celula = (c: Coluna<MovimentoDoBalancete>, m: MovimentoDoBalancete) => {
    if (c.chave === "centro") {
      const t = centroTexto(m);
      if (!t) return <span className="text-gray-400">—</span>;
      return (
        <span>
          {t}
          {m.centroOriginal ? (
            <IconeDaCorrecao campo="centro" original={textoDe(m.centroOriginal)} atual={t} origem={m.redistribuicao?.parte ? { tipo: "redistribuicao" } : m.contestacaoAplicada ? { tipo: "contestacao", numero: m.contestacaoAplicada.numero } : { tipo: "reclassificacao" }} />
          ) : null}
        </span>
      );
    }
    if (c.chave === "contaDRE") {
      if (!m.contaNaDRE) return <span>{contaDoBalancete}</span>;
      const atual = `${m.contaNaDRE.reduzido} · ${m.contaNaDRE.descricao}`;
      return (
        <span>
          {atual}
          <IconeDaCorrecao campo="conta" original={contaDoBalancete} atual={atual} origem={m.contestacaoAplicada?.conta ? { tipo: "contestacao", numero: m.contestacaoAplicada.numero } : { tipo: "reclassificacao" }} />
        </span>
      );
    }
    if (c.chave === "id") {
      if (!m.idMovimento) return <span className="text-gray-400">—</span>;
      return m.itens > 0 ? <span>{m.idMovimento}</span> : <span title="Nenhum item com este ID nas requisições e nas notas fiscais importadas">{m.idMovimento}</span>;
    }
    if (c.chave === "acoes") {
      // Os itens do movimento (10/11/2026), antes da contestação.
      const itens =
        m.idMovimento && m.itens > 0 ? (
          <Button type="button" variant="outline" size="sm" className="h-6 rounded-sm px-2 text-[11px]" onClick={() => setVendoItens(m)} title={`Os itens da requisição ou da nota fiscal do movimento (${m.itens} ${plural(m.itens, "item", "itens")})`}>
            <ListTree className="size-3.5" />
            Itens
          </Button>
        ) : null;
      return (
        <span className="inline-flex items-center gap-1">
          {itens}
          {acaoDaContestacao(m)}
        </span>
      );
    }
    return (c.texto ? c.texto(m) : c.valor?.(m)) ?? <span className="text-gray-400">—</span>;
  };

  /** A coluna Ações, na parte da contestação: a situação da em andamento, o Rateio do reflexo ou o Contestar. */
  const acaoDaContestacao = (m: MovimentoDoBalancete) => {
    // A contestação em andamento (pendente ou acatada): a situação; senão, o Contestar.
    const andamento = m.contestacao && (m.contestacao.situacao === "PENDENTE" || m.contestacao.situacao === "ACATADA");
    if (andamento) {
      return (
        <span
          className="inline-flex items-center gap-1 rounded-sm border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-amber-900"
          title={m.contestacao!.deItens ? "A contestação de itens do movimento em andamento (Contestações de Gastos): os itens dela no botão Itens" : "A contestação em andamento (Contestações de Gastos)"}
        >
          Nº {m.contestacao!.numero} · {m.contestacao!.deItens ? "Itens · " : ""}
          {ROTULO_SITUACAO[m.contestacao!.situacao]}
        </span>
      );
    }
    // O movimento com itens contestados (10/11/2026): os demais itens se contestam pelo botão Itens, não o movimento inteiro.
    if (m.contestacao?.comItensContestados) {
      return (
        <span
          className="inline-flex items-center gap-1 rounded-sm border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-gray-700"
          title="O movimento tem itens contestados: conteste os demais itens pelo botão Itens"
        >
          Itens Contestados
        </span>
      );
    }
    // O movimento redistribuído (13/11/2026) não se contesta: a etiqueta mostra os destinos.
    if (m.redistribuicao) return podeContestar ? <EtiquetaRedistribuicao redistribuicao={m.redistribuicao} /> : null;
    // O reflexo de um rateio (30/10/2026): contesta-se o movimento na linha de origem, não aqui.
    if (m.rateioDe) {
      return podeContestar ? (
        <span
          className="inline-flex items-center rounded-sm border border-yellow-300 bg-yellow-50 px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-yellow-800"
          title={`Reflexo do rateio: o movimento é da linha "${m.rateioDe.linha}" (${m.rateioDe.grupo}) e chega a esta pelo rateio. Para contestá-lo, abra o extrato da linha de origem.`}
        >
          Rateio
        </span>
      ) : null;
    }
    return podeContestar ? (
      <Button type="button" variant="outline" size="sm" className="h-6 rounded-sm px-2 text-[11px]" onClick={() => setContestando(m)} title="Sugerir outro centro de custo e/ou outra conta para o movimento">
        <MessageSquareWarning className="size-3.5" />
        Contestar
      </Button>
    ) : null;
  };

  /** Por que os itens do movimento não se contestam (nulo se se contestam): o reflexo de um rateio ou o movimento inteiro em contestação. */
  const bloqueioDosItens = (m: MovimentoDoBalancete) => {
    if (m.redistribuicao) return textoDaRedistribuicao(m.redistribuicao);
    if (m.rateioDe) return `Reflexo do rateio: o movimento é da linha "${m.rateioDe.linha}". Para contestar os itens, abra o extrato da linha de origem.`;
    const andamento = m.contestacao && !m.contestacao.deItens && (m.contestacao.situacao === "PENDENTE" || m.contestacao.situacao === "ACATADA");
    return andamento ? `O movimento inteiro está na contestação nº ${m.contestacao!.numero} (${ROTULO_SITUACAO[m.contestacao!.situacao].toLowerCase()}).` : null;
  };
  /** O Contestar só dos itens marcados (10/11/2026). */
  const contestarItens = (m: MovimentoDoBalancete, sel: ItensSelecionados, fechar: () => void, concluir: () => void) => (
    <ContestarDialog
      movimento={movimentoContestado(m)}
      anoMes={anoMes}
      itens={sel}
      onFechar={fechar}
      onCriada={() => {
        concluir();
        void queryClient.invalidateQueries({ queryKey: ["dre", anoMes, "balancete"] });
        void queryClient.invalidateQueries({ queryKey: ["contestacoes"] });
      }}
    />
  );
  /** O movimento para o Contestar: o centro e a conta que valem hoje. */
  const movimentoContestado = (m: MovimentoDoBalancete) => ({
    id: m.id,
    filial: m.filial,
    emissao: m.emissao,
    cliForn: m.cliForn,
    historico: m.historico,
    valor: m.valor,
    centro: centroTexto(m),
    conta: m.contaNaDRE ? `${m.contaNaDRE.reduzido} · ${m.contaNaDRE.descricao}` : contaDoBalancete,
  });

  return (
    <Dialog open onOpenChange={(o) => (!o ? onVoltar() : undefined)}>
      <DialogContent className="flex max-h-[90vh] w-[min(84rem,calc(100%_-_2rem))] max-w-none flex-col overflow-hidden rounded-sm sm:max-w-none">
        <DialogHeader>
          <DialogTitle>
            {/* A conta como veio do cadastro (em <span>, para o título não mudar a caixa dela). */}
            Balancete ·{" "}
            <span>
              {lancamento.conta.reduzido} · {d?.conta.descricao || lancamento.conta.descricao}
            </span>
          </DialogTitle>
          <DialogDescription>
            {rotuloMes ?? anoMes}
            {soDoLancamento ? ` · Filial ${lancamento.filial}${temCentro ? ` · ${lancamento.centro!.codigoRM} · ${lancamento.centro!.nome ?? ""}` : ""}` : " · todas as filiais e centros de custo"}. Os
            movimentos da conta no balancete do mês (aba Balancete (Lista) do LISTAS REALIZADO (RESULTADOS)): a emissão, o cliente ou fornecedor e o histórico de
            cada um{comId ? "; o botão Itens abre os itens da requisição ou da nota fiscal com o ID do movimento" : ""}.
            {lancamento.contaAdotada ? ` Na DRE, a conta é a ${lancamento.contaAdotada.reduzido}.` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-gray-800">
            <input type="checkbox" className="accent-black" checked={soDoLancamento} onChange={(e) => setSoDoLancamento(e.target.checked)} />
            Só do Centro de Custo e da Filial do Lançamento
          </label>
          {d ? (
            <p className="text-sm text-gray-700">
              {d.linhas.length.toLocaleString("pt-BR")} {d.linhas.length === 1 ? "movimento" : "movimentos"} · Soma <span className="font-bold text-gray-900">{moeda(soma)}</span>
              {soDoLancamento ? (
                <>
                  {" "}
                  · Lançamento <span className="font-bold text-gray-900">{moeda(Number(lancamento.valor))}</span>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
        {d && !d.detalhado ? (
          <p className="shrink-0 rounded-sm border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-900">
            O balancete deste mês foi importado sem o detalhe dos movimentos (as colunas CLI_FORN, EMISSAO e HISTORICO): cada linha é a soma da filial, do centro de
            custo e da conta. Importe o LISTAS REALIZADO (RESULTADOS) atualizado em Importações.
          </p>
        ) : null}

        {consulta.isError ? (
          <p className="text-sm text-red-700">{mensagemDeErro(consulta.error, "Erro ao carregar o balancete da conta.")}</p>
        ) : !d ? (
          <div className="h-40 animate-pulse rounded-sm bg-gray-100" />
        ) : d.linhas.length === 0 ? (
          <p className="rounded-sm border border-gray-200 bg-white p-4 text-sm text-gray-600">Nenhum movimento da conta no mês.</p>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto rounded-sm border border-gray-200 [--topo-tabela:0px]">
            <table className="tabela-sig w-full border-collapse text-xs">
              {tabela.cabecalho}
              <tbody>
                {tabela.visiveis.length === 0 ? (
                  <SemResultado colunas={colunas.length} onLimpar={tabela.limpar} />
                ) : (
                  tabela.visiveis.map((m) => (
                    <tr key={m.id} className="border-b border-gray-100 align-top">
                      {colunas.map((c) => (
                        <td key={c.chave} className={`px-3 py-1.5 ${c.alinhamento === "direita" || c.chave === "emissao" || c.chave === "acoes" ? "whitespace-nowrap" : ""} ${c.alinhamento === "direita" ? "text-right" : ""}`}>
                          {celula(c, m)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {tabela.total !== tabela.totalGeral ? (
              <p className="px-3 py-1.5 text-right text-xs text-gray-600">
                Total filtrado ({tabela.total} de {tabela.totalGeral}): <span className="font-bold">{moeda(tabela.filtradas.reduce((a, m) => a + Number(m.valor), 0))}</span>
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter className="shrink-0 sm:justify-between">
          <Button type="button" variant="outline" className="rounded-sm" onClick={onVoltar}>
            <ArrowLeft className="size-4" />
            Voltar ao Extrato
          </Button>
          {/* O balancete da conta em Excel (24/10/2026): o lançamento numa aba e os movimentos, no recorte da caixa, em outra. */}
          <ExportarExtrato anoMes={anoMes} linha={linha} visao={visao} recorte={{ conta: lancamento.conta.reduzido, ...(soDoLancamento ? { centro: lancamento.centro?.codigoRM ?? null, filial: lancamento.filial } : {}) }} />
        </DialogFooter>
        {vendoItens?.idMovimento ? (
          <ItensDoMovimentoDialog
            movimento={{ idMovimento: vendoItens.idMovimento, emissao: vendoItens.emissao, cliForn: vendoItens.cliForn, historico: vendoItens.historico, valor: vendoItens.valor, conta: lancamento.conta.reduzido, centro: vendoItens.centroOriginal ? vendoItens.centroOriginal.codigoRM : vendoItens.codigoCentroCusto }}
            queryKey={["dre", anoMes, "balancete", "itens", filtro, vendoItens.id]}
            carregar={() => dreService.itensDoMovimento(anoMes, filtro, vendoItens.id)}
            onFechar={() => setVendoItens(null)}
            contestar={podeContestar ? { bloqueio: bloqueioDosItens(vendoItens), render: (sel, fechar, concluir) => contestarItens(vendoItens, sel, fechar, concluir) } : undefined}
          />
        ) : null}
        {contestando ? (
          <ContestarDialog
            movimento={movimentoContestado(contestando)}
            anoMes={anoMes}
            onFechar={() => setContestando(null)}
            onCriada={() => {
              setContestando(null);
              void queryClient.invalidateQueries({ queryKey: ["dre", anoMes, "balancete"] });
              void queryClient.invalidateQueries({ queryKey: ["contestacoes"] });
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
