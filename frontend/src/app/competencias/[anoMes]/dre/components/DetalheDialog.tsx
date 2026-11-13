"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, FileSearch } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SemResultado, useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import type { Coluna } from "@/lib/filtrosDeTabela";

import { MemoriaCalculoDialog } from "../../receita-previa/components/MemoriaCalculoDialog";
import type { Natureza } from "../../receita-previa/services/receitaPreviaService";
import { moeda } from "../../utils/formatacao";
import { dreService, mensagemDeErro, UNIDADES, type BlocoDetalhe, type LancamentoDetalhe, type VisaoDetalhe } from "../services/dreService";
import { IconeDaCorrecao } from "@/components/shared/IconeDaCorrecao";

import { RegrasDeRateioDialog } from "@/app/contestacoes-de-gastos/components/RegrasDeRateioDialog";

import { BalanceteDialog } from "./BalanceteDialog";
import { ExportarExtrato } from "./ExportarExtrato";
import { plural } from "@/lib/texto";

type Props = {
  anoMes: string;
  linha: string;
  visao: VisaoDetalhe;
  onFechar: () => void;
  /** O mês no título ("AGO/26"), quando a tela mostra vários meses (Resultados). */
  rotuloMes?: string;
  /** Uma nota no alto do extrato (03/11/2026: no Realizado por Obra, a composição do valor da célula). */
  nota?: ReactNode;
};

const nomeUnidade = (u?: number) => UNIDADES.find((x) => x.codigo === u)?.nome;
const percentual = (p: string) => `${(Number(p) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`;
const fatorTexto = (f: string) => (f === "-1" ? "sinal trocado" : `× ${Number(f).toLocaleString("pt-BR", { maximumFractionDigits: 8 })}`);

function Bloco({
  b,
  consolidado,
  onMemoria,
  onDocumentos,
}: {
  b: BlocoDetalhe;
  consolidado: boolean;
  onMemoria: (u: number, n: Natureza, obra?: string) => void;
  onDocumentos: (l: LancamentoDetalhe) => void;
}) {
  const cabecalho = (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <p className="text-sm font-bold text-gray-900">
          {consolidado && b.unidade ? `${nomeUnidade(b.unidade)} · ` : ""}
          {b.titulo}
        </p>
        {b.tipo !== "PREVIA" ? (
          <p className="text-xs text-gray-500">
            {b.filtro}
            {b.fator ? ` · ${fatorTexto(b.fator)}` : ""}
            {b.percentual ? ` · × ${percentual(b.percentual)}` : ""}
            {` · ${b.lancamentos.length} ${plural(b.lancamentos.length, "lançamento", "lançamentos")}`}
          </p>
        ) : null}
      </div>
      <p className="text-sm font-bold">{moeda(b.total)}</p>
    </div>
  );
  if (b.tipo === "PREVIA") {
    return (
      <div className="space-y-2 rounded-sm border border-gray-200 p-3">
        {cabecalho}
        <Button type="button" variant="outline" size="sm" className="rounded-sm" onClick={() => onMemoria(b.unidade, b.natureza as Natureza, b.obra)}>
          Abrir a memória de cálculo da receita prévia
        </Button>
      </div>
    );
  }
  const multiplica = !!(b.fator || b.percentual);
  return (
    <div className="space-y-2 rounded-sm border border-gray-200 p-3">
      {cabecalho}
      {b.lancamentos.length > 0 ? (
        <TabelaLancamentos lancamentos={b.lancamentos} multiplica={multiplica} onDocumentos={b.tipo === "MANUAL" ? undefined : onDocumentos} />
      ) : (
        <p className="text-xs text-gray-500">Nenhum lançamento.</p>
      )}
    </div>
  );
}

type Lancamento = LancamentoDetalhe;

const centroTexto = (l: Lancamento) => (l.centro ? `${l.centro.codigoRM ?? "sem código"} · ${l.centro.nome}` : null);
// A conta que vale na DRE (a corrigida pela reclassificação, 15/10/2026), para o filtro e a ordem.
const contaTexto = (l: Lancamento) => `${(l.contaAdotada ?? l.conta).reduzido} · ${(l.contaAdotada ?? l.conta).descricao}`;

/**
 * Os lançamentos de um bloco, com filtro e ordem nos rótulos das colunas. Nos contábeis (diretos e de rateio), a conta
 * abre o balancete dela no mês (15/10/2026; antes, as requisições e as notas fiscais). Reclassificado ou contestado
 * (27/10/2026), o lançamento mostra o centro e a conta que valem, com o ícone que abre o original (antes, a conta
 * corrigida com "(Corrigida de: …)" em vermelho).
 */
function TabelaLancamentos({ lancamentos, multiplica, onDocumentos }: { lancamentos: Lancamento[]; multiplica: boolean; onDocumentos?: (l: Lancamento) => void }) {
  const colunas = useMemo<Coluna<Lancamento>[]>(
    () => [
      { chave: "filial", rotulo: "Filial", tipo: "numero", valor: (l) => l.filial },
      { chave: "centro", rotulo: "Centro de Custo", valor: centroTexto },
      { chave: "conta", rotulo: "Conta", valor: contaTexto },
      { chave: "balde", rotulo: "Balde", valor: (l) => l.balde },
      { chave: "valor", rotulo: "Valor", tipo: "numero", alinhamento: "direita", valor: (l) => Number(l.valor), texto: (l) => moeda(l.valor) },
      ...(multiplica
        ? [{ chave: "parcela", rotulo: "Na Linha", tipo: "numero", alinhamento: "direita", valor: (l) => Number(l.parcela), texto: (l) => moeda(l.parcela) } as Coluna<Lancamento>]
        : []),
    ],
    [multiplica],
  );
  const tabela = useTabelaFiltravel(lancamentos, colunas);
  return (
    <div className="max-h-96 overflow-auto">
      <table className="tabela-sig w-full border-collapse text-xs">
        {tabela.cabecalho}
        <tbody>
          {tabela.visiveis.length === 0 ? (
            <SemResultado colunas={colunas.length} onLimpar={tabela.limpar} />
          ) : (
            tabela.visiveis.map((l) => (
              <tr key={l.id} className="border-b border-gray-100 align-top">
                <td className="px-4 py-1.5">{l.filial}</td>
                <td className="px-4 py-1.5">
                  {l.centro ? (
                    <>
                      <span>{l.centro.codigoRM ?? "sem código"}</span>
                      <span className="text-gray-500"> · {l.centro.nome}</span>
                      {/* O centro corrigido por uma contestação (27/10/2026): o ícone abre o do balancete. */}
                      {l.centroOriginal ? (
                        <IconeDaCorrecao
                          campo="centro"
                          original={`${l.centroOriginal.codigoRM ?? "sem código"} · ${l.centroOriginal.nome ?? ""}`}
                          atual={`${l.centro.codigoRM ?? "sem código"} · ${l.centro.nome ?? ""}`}
                          origem={l.redistribuido ? { tipo: "redistribuicao" } : l.contestacao ? { tipo: "contestacao", numero: l.contestacao.numero } : { tipo: "reclassificacao" }}
                        />
                      ) : null}
                    </>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-1.5">
                  {onDocumentos ? (
                    <button
                      type="button"
                      onClick={() => onDocumentos(l)}
                      title="Ver o balancete da conta no mês"
                      className="inline-flex items-start gap-1 text-left underline decoration-gray-300 underline-offset-2 hover:decoration-gray-900"
                    >
                      <FileSearch className="mt-px size-3.5 shrink-0 text-gray-400" />
                      <span>
                        {(l.contaAdotada ?? l.conta).reduzido}
                        <span className="text-gray-500"> · {(l.contaAdotada ?? l.conta).descricao}</span>
                      </span>
                    </button>
                  ) : (
                    <>
                      <span>{(l.contaAdotada ?? l.conta).reduzido}</span>
                      <span className="text-gray-500"> · {(l.contaAdotada ?? l.conta).descricao}</span>
                    </>
                  )}
                  {/* A conta corrigida (a reclassificação ou uma contestação, 27/10/2026): o ícone abre a do balancete. */}
                  {l.contaAdotada ? (
                    <IconeDaCorrecao
                      campo="conta"
                      original={`${l.conta.reduzido} · ${l.conta.descricao}`}
                      atual={`${l.contaAdotada.reduzido} · ${l.contaAdotada.descricao}`}
                      origem={l.contestacao?.conta ? { tipo: "contestacao", numero: l.contestacao.numero } : { tipo: "reclassificacao" }}
                    />
                  ) : null}
                  {l.descricao ? <div className="text-gray-500">{l.descricao}</div> : null}
                </td>
                <td className="px-4 py-1.5 text-gray-600">{l.balde ?? "—"}</td>
                <td className="px-4 py-1.5 text-right whitespace-nowrap">{moeda(l.valor)}</td>
                {multiplica ? <td className="px-4 py-1.5 text-right whitespace-nowrap">{moeda(l.parcela)}</td> : null}
              </tr>
            ))
          )}
        </tbody>
      </table>
      {tabela.total !== tabela.totalGeral ? (
        <p className="px-4 py-1.5 text-right text-xs text-gray-600">
          Total filtrado ({tabela.total} de {tabela.totalGeral}): <span className="font-bold">{moeda(tabela.filtradas.reduce((a, l) => a + Number(l.valor), 0))}</span>
        </p>
      ) : null}
    </div>
  );
}

/** Detalhamento de um valor da DRE até os lançamentos de origem. */
export function DetalheDialog({ anoMes, linha, visao, onFechar, rotuloMes, nota }: Props) {
  const [memoria, setMemoria] = useState<{ unidade: number; natureza: Natureza; obra?: string } | null>(null);
  // O lançamento cuja conta abre o balancete do mês (15/10/2026; o extrato volta ao fechar).
  const [documentos, setDocumentos] = useState<LancamentoDetalhe | null>(null);
  // As Regras de Rateio vigentes no mês (04/11/2026, pedido do Adão), por cima do extrato.
  const [regras, setRegras] = useState(false);
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["dre", anoMes, "detalhe", linha, visao],
    queryFn: () => dreService.detalhe(anoMes, linha, visao),
  });
  const fecha = data?.somaOrigens !== null && data?.somaOrigens !== undefined && Math.abs(Number(data.somaOrigens) - Number(data.valor ?? 0)) <= 0.05;

  if (documentos) {
    return <BalanceteDialog anoMes={anoMes} linha={linha} visao={visao} lancamento={documentos} rotuloMes={rotuloMes} onVoltar={() => setDocumentos(null)} />;
  }
  if (memoria) {
    return <MemoriaCalculoDialog anoMes={anoMes} unidade={memoria.unidade} natureza={memoria.natureza} obra={memoria.obra} onFechar={() => setMemoria(null)} />;
  }
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-sm sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            {data ? `${data.visao} · ${data.linha.descricao}${rotuloMes ? ` · ${rotuloMes}` : ""}` : "Detalhamento"}
            {data?.valor ? <span className="ml-2 text-gray-600">{moeda(data.valor)}</span> : null}
          </DialogTitle>
          <DialogDescription>{data?.regra ?? "Os lançamentos que formaram o valor, como foram apurados."}</DialogDescription>
        </DialogHeader>
        {nota ? <div className="rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-3 py-2 text-sm text-gray-700">{nota}</div> : null}
        {isError ? <p className="text-sm text-red-700">{mensagemDeErro(error, "Erro ao carregar o detalhamento.")}</p> : null}
        {isPending ? <div className="h-40 animate-pulse rounded-sm bg-gray-100" /> : null}
        {data ? (
          <div className="space-y-3">
            {data.observacao ? <p className="rounded-sm border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">{data.observacao}</p> : null}
            {data.blocos.map((b, i) => (
              <Bloco key={i} b={b} consolidado={data.visao === "Consolidado"} onMemoria={(u, n, obra) => setMemoria({ unidade: u, natureza: n, obra })} onDocumentos={setDocumentos} />
            ))}
            {data.somaOrigens !== null ? (
              <div className={`flex items-center gap-2 rounded-sm border p-3 text-sm ${fecha ? "border-green-200 bg-green-50 text-green-800" : "border-yellow-200 bg-yellow-50 text-yellow-800"}`}>
                {fecha ? <CheckCircle2 className="size-4 shrink-0" /> : <AlertTriangle className="size-4 shrink-0" />}
                Soma das origens: {moeda(data.somaOrigens)} · valor da linha: {moeda(data.valor ?? "0")}
              </div>
            ) : null}
          </div>
        ) : null}
        {/* O extrato em Excel (24/10/2026): as movimentações numa aba e os detalhes, item a item, em outra. O pé fica preso
            embaixo (o DialogFooter), como o título em cima, para o botão aparecer sem rolar o extrato. À esquerda, as Regras de
            Rateio do mês (04/11/2026). */}
        {data ? (
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="outline" className="rounded-sm" onClick={() => setRegras(true)} title="As Regras de Rateio vigentes no mês">
              Regras de Rateio
            </Button>
            <ExportarExtrato anoMes={anoMes} linha={linha} visao={visao} />
          </DialogFooter>
        ) : null}
        {regras ? <RegrasDeRateioDialog anoMes={anoMes} onFechar={() => setRegras(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}
