"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Calculator, History, LockKeyhole, LockKeyholeOpen, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { SemResultado, useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import type { Coluna } from "@/lib/filtrosDeTabela";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import { atualizarCompetencia } from "@/lib/atualizarCompetencia";

import { apuracaoService, type ParaExcluir } from "../../../services/apuracaoService";
import { dataHora } from "../../utils/formatacao";
import { mensagemDeErro } from "../services/dreService";
import { plural } from "@/lib/texto";

type Props = { anoMes: string; onAvisos: (avisos: string[]) => void; /** O Exportar da DRE (21/10/2026), no fim da barra, depois do Reaberturas (30/10/2026). */ exportar?: ReactNode };

const botaoPrimario = "bg-bpm-primary hover:bg-bpm-primary-hover rounded-sm font-bold text-black shadow-sm";

/**
 * Apuração, fechamento e reabertura da competência (Passo 21). Apurar refaz
 * tudo o que forma o resultado do mês e congela os valores; fechar exige a
 * apuração em dia; reabrir exige justificativa.
 *
 * Os botões ficam no cabeçalho da tela (AcoesApuracao) e a situação numa
 * linha logo abaixo dele (SituacaoApuracao), para a DRE vir logo depois das
 * abas (E10 do levantamento de layout).
 */
export function AcoesApuracao({ anoMes, onAvisos, exportar }: Props) {
  const queryClient = useQueryClient();
  const { refresh } = useAuth();
  const [dialogo, setDialogo] = useState<"fechar" | "reabrir" | null>(null);
  const [historico, setHistorico] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [justificativa, setJustificativa] = useState("");
  const situacao = useQuery({ queryKey: ["apuracao", anoMes], queryFn: () => apuracaoService.situacao(anoMes) });

  // A apuração refaz a classificação, o estoque, a receita, os rateios e a DRE: tudo do mês se atualiza.
  const atualizar = () => {
    atualizarCompetencia(queryClient, anoMes);
    void refresh(); // as divergências de preço resolvidas saem do aviso
  };
  const apurar = useMutation({
    mutationFn: () => apuracaoService.apurar(anoMes),
    onSuccess: (r) => {
      onAvisos(r.avisos);
      toast.success(`Competência apurada e congelada (${r.etapas.join(", ")}).`);
      atualizar();
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível apurar a competência.")),
  });
  const fechar = useMutation({
    mutationFn: () => apuracaoService.fechar(anoMes),
    onSuccess: () => {
      toast.success("Competência fechada.");
      setDialogo(null);
      atualizar();
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível fechar a competência.")),
  });
  const reabrir = useMutation({
    mutationFn: () => apuracaoService.reabrir(anoMes, justificativa),
    onSuccess: () => {
      toast.success("Competência reaberta.");
      setDialogo(null);
      setJustificativa("");
      atualizar();
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível reabrir a competência.")),
  });

  const s = situacao.data;
  if (!s) return null;
  const fechada = s.competencia.status === "FECHADA";

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {/* Excluir Competência (20/10/2026): só a mais recente e em aberto; nas outras, apagado, com o motivo na dica. */}
        {!fechada ? (
          <PermissionGuard permission="competencias:editar">
            <span title={s.motivoNaoExcluir ?? undefined}>
              <Button
                type="button"
                variant="outline"
                className="rounded-sm border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800"
                disabled={s.motivoNaoExcluir !== null || apurar.isPending}
                onClick={() => setExcluindo(true)}
              >
                <Trash2 className="size-4" />
                Excluir Competência
              </Button>
            </span>
          </PermissionGuard>
        ) : null}
        {s.podeApurar ? (
          <PermissionGuard permission="dre:editar">
            <Button
              type="button"
              onClick={() => apurar.mutate()}
              disabled={apurar.isPending || s.bloqueioApuracao !== null}
              title={s.bloqueioApuracao ?? undefined}
              className={botaoPrimario}
            >
              <Calculator className="size-4" />
              {apurar.isPending ? "Apurando…" : s.apurada ? "Reapurar Competência" : "Apurar Competência"}
            </Button>
          </PermissionGuard>
        ) : null}
        {!fechada ? (
          <PermissionGuard permission="competencias:editar">
            <Button
              type="button"
              className={botaoPrimario}
              disabled={!s.podeFechar || apurar.isPending}
              title={s.podeFechar ? undefined : `Para fechar: ${s.motivosNaoFechar.join(" ")}`}
              onClick={() => setDialogo("fechar")}
            >
              <LockKeyhole className="size-4" />
              Fechar Competência
            </Button>
          </PermissionGuard>
        ) : null}
        {s.podeReabrir ? (
          <PermissionGuard permission="competencias:editar">
            <Button type="button" className={botaoPrimario} onClick={() => setDialogo("reabrir")}>
              <LockKeyholeOpen className="size-4" />
              Reabrir Competência
            </Button>
          </PermissionGuard>
        ) : null}
        {s.reaberturas.length > 0 ? (
          <Button type="button" className={botaoPrimario} onClick={() => setHistorico(true)}>
            <History className="size-4" />
            Reaberturas ({s.reaberturas.length})
          </Button>
        ) : null}
        {exportar}
      </div>
      {historico ? <HistoricoReaberturas reaberturas={s.reaberturas} onFechar={() => setHistorico(false)} /> : null}
      {excluindo && s.paraExcluir ? (
        <ExcluirCompetencia anoMes={anoMes} ano={s.competencia.ano} mes={s.competencia.mes} paraExcluir={s.paraExcluir} onFechar={() => setExcluindo(false)} />
      ) : null}

      <Dialog open={dialogo !== null} onOpenChange={(o) => (!o ? setDialogo(null) : undefined)}>
        <DialogContent avisoAoSair className="rounded-sm sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{dialogo === "fechar" ? "Fechar a Competência" : "Reabrir a Competência"}</DialogTitle>
            <DialogDescription>
              {dialogo === "fechar"
                ? "Fechada, a competência não aceita importação, digitação nem apuração. Os valores ficam como foram apurados; mudar exige reabrir com justificativa."
                : "A reabertura fica registrada, com a justificativa. Os valores continuam os da apuração até a competência ser reapurada."}
            </DialogDescription>
          </DialogHeader>
          {/* As telas do mês sem nenhum valor (21/10/2026): um aviso, que não impede o fechamento. */}
          {dialogo === "fechar" && s.telasSemValor.length ? (
            <div className="flex items-start gap-2 rounded-sm border border-l-4 border-gray-200 border-l-red-600 bg-white px-3 py-2 text-sm text-gray-800">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-600" />
              <div>
                <p className="font-medium text-gray-900">
                  {s.telasSemValor.length === 1 ? "Uma tela do mês está sem nenhum valor:" : `${s.telasSemValor.length} telas do mês estão sem nenhum valor:`}
                </p>
                <ul className="list-disc pl-5">
                  {s.telasSemValor.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
                <p className="mt-1">Confira se é isso mesmo antes de fechar.</p>
              </div>
            </div>
          ) : null}
          {dialogo === "reabrir" ? (
            <div className="space-y-1.5">
              <label htmlFor="justificativa" className="text-sm font-medium text-gray-900">
                Justificativa
              </label>
              <textarea
                id="justificativa"
                value={justificativa}
                onChange={(e) => setJustificativa(e.target.value)}
                rows={4}
                className="w-full rounded-sm border border-gray-300 bg-white px-3 py-2 text-sm"
                placeholder="Por que a competência precisa ser reaberta?"
              />
              <p className="text-xs text-gray-500">Ao menos 15 caracteres.</p>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-sm" onClick={() => setDialogo(null)}>
              Cancelar
            </Button>
            {dialogo === "fechar" ? (
              <Button type="button" className={botaoPrimario} disabled={fechar.isPending} onClick={() => fechar.mutate()}>
                {fechar.isPending ? "Fechando…" : "Fechar"}
              </Button>
            ) : (
              <Button type="button" className={botaoPrimario} disabled={reabrir.isPending || justificativa.trim().length < 15} onClick={() => reabrir.mutate()}>
                {reabrir.isPending ? "Reabrindo…" : "Reabrir"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A situação da apuração numa linha, e o que pede atenção (entradas alteradas, motivos para não fechar). */
/** Quando e por quem a competência foi apurada; fica no painel Sobre Esta Tela da DRE. */
export function TextoApuracao({ anoMes }: { anoMes: string }) {
  const situacao = useQuery({ queryKey: ["apuracao", anoMes], queryFn: () => apuracaoService.situacao(anoMes) });
  const s = situacao.data;
  if (!s) return null;
  return s.apurada
    ? `Apurada em ${dataHora(s.apuradaEm!)}${s.apuradaPor ? ` por ${s.apuradaPor}` : ""} · ${s.apuracoes} ${plural(s.apuracoes, "apuração", "apurações")}. Valores congelados: cadastros alterados depois só valem se a competência for reapurada.`
    : "Ainda não apurada. Apurar refaz, em ordem, a classificação, o estoque, a receita prévia, os rateios e a DRE, e congela os valores.";
}

/** Na tela da DRE: o que impede de fechar e as entradas alteradas depois da apuração. */
export function SituacaoApuracao({ anoMes }: { anoMes: string }) {
  const situacao = useQuery({ queryKey: ["apuracao", anoMes], queryFn: () => apuracaoService.situacao(anoMes) });
  const s = situacao.data;
  if (situacao.isError) {
    return (
      <div className="rounded-sm border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {mensagemDeErro(situacao.error, "Não foi possível carregar a situação da apuração.")}
      </div>
    );
  }
  if (!s) return <div className="h-5 w-96 animate-pulse rounded-sm bg-gray-100" />;
  const fechada = s.competencia.status === "FECHADA";

  // Os motivos para não fechar ficam no title do botão Fechar Competência (a linha "Para fechar: …" saiu em 09/10/2026).
  const mudancas = s.apurada && s.mudancas.length > 0;
  const bloqueio = !fechada ? s.bloqueioApuracao : null;
  if (!fechada && !mudancas && !bloqueio) return null;

  return (
    <div className="space-y-2">
      {/* O bloqueio da apuração: competências anteriores com entradas alteradas depois da apuração. */}
      {bloqueio ? (
        // Destaque em vermelho à esquerda, como a faixa dos totais das Listas (que usa o amarelo-ouro); os atalhos à direita, na altura do título.
        <div className="flex items-start gap-2 rounded-sm border border-l-4 border-gray-200 border-l-red-600 bg-white px-4 py-2.5 text-sm text-gray-800">
          <LockKeyhole className="mt-2.5 size-4 shrink-0 text-red-600" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-gray-900">Apuração bloqueada.</p>
              <div className="flex flex-wrap gap-2">
                {s.anterioresDesatualizadas.map((m) => {
                  const [mm, aaaa] = m.split("/");
                  return (
                    <Link
                      key={m}
                      href={`/competencias/${aaaa}-${mm}/dre`}
                      className="inline-flex h-9 items-center rounded-none bg-red-600 px-4 text-sm font-bold text-white shadow-sm hover:bg-red-700"
                    >
                      Ir para {m}
                    </Link>
                  );
                })}
              </div>
            </div>
            <p className="mt-0.5">{bloqueio}</p>
          </div>
        </div>
      ) : null}
      {fechada ? (
        // No destaque das Listas (21/10/2026; antes, texto solto).
        <p className="flex items-center gap-2 rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-2.5 text-sm text-gray-700">
          <LockKeyhole className="size-4 shrink-0 text-gray-500" />
          <span>
            Fechada em {dataHora(s.fechadaEm!)}
            {s.fechadaPor ? ` por ${s.fechadaPor}` : ""}; para mudar qualquer valor, reabra com justificativa.
          </span>
        </p>
      ) : null}
      {mudancas ? (
        // Destaque em amarelo escuro à esquerda, como a faixa dos totais das Listas (que usa o amarelo-ouro).
        <div className="flex items-start gap-2 rounded-sm border border-l-4 border-gray-200 border-l-yellow-600 bg-white px-4 py-2.5 text-sm text-gray-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-yellow-600" />
          <div>
            <p className="font-medium text-gray-900">Entradas ou cadastros alterados depois da apuração. Os valores abaixo são os da apuração; reapure para incluir as mudanças.</p>
            <ul className="list-disc pl-5">{s.mudancas.map((m) => <li key={m}>{m}</li>)}</ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A confirmação da exclusão da competência (20/10/2026): o que sai junto e a competência digitada (MM/AAAA) para
 * liberar o botão. Excluída, a tela volta para a lista das competências.
 */
function ExcluirCompetencia({ anoMes, ano, mes, paraExcluir, onFechar }: { anoMes: string; ano: number; mes: number; paraExcluir: ParaExcluir; onFechar: () => void }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { refresh } = useAuth();
  const rotulo = `${String(mes).padStart(2, "0")}/${ano}`;
  const [digitado, setDigitado] = useState("");
  const excluir = useMutation({
    mutationFn: () => apuracaoService.excluir(anoMes),
    onSuccess: () => {
      toast.success(`Competência ${rotulo} excluída.`);
      onFechar();
      router.replace("/competencias");
      queryClient.removeQueries({ predicate: (q) => JSON.stringify(q.queryKey).includes(anoMes) });
      void queryClient.invalidateQueries();
      void refresh();
    },
  });
  const p = paraExcluir;
  const itens = [
    p.importacoes ? `${p.importacoes} ${plural(p.importacoes, "importação", "importações")} (Em Vigor e Histórico)` : null,
    p.lancamentos ? `${p.lancamentos.toLocaleString("pt-BR")} ${plural(p.lancamentos, "lançamento", "lançamentos")} do balancete, com a classificação` : null,
    p.manuais ? `${p.manuais} ${plural(p.manuais, "lançamento manual", "lançamentos manuais")}` : null,
    p.divergencias ? `${p.divergencias} ${plural(p.divergencias, "divergência", "divergências")}` : null,
  ].filter((x): x is string => x !== null);
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent className="rounded-sm sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Excluir a Competência {rotulo}</DialogTitle>
          <DialogDescription render={<div />}>
            <ul className="list-disc space-y-1 pl-5">
              <li>A competência sai da lista, com tudo o que é dela: as listas, o estoque, a receita prévia, os rateios, a DRE apurada e as reaberturas.</li>
              {itens.length ? <li>Saem também: {itens.join("; ")}.</li> : <li>Ela ainda não tem importações nem lançamentos.</li>}
              <li>Os arquivos importados continuam guardados. A exclusão fica no log de auditoria e não se desfaz.</li>
            </ul>
          </DialogDescription>
        </DialogHeader>
        {/* O campo à direita, alinhado ao botão Excluir, 25% mais estreito e com o texto à direita (11/11/2026, pedido do Adão). */}
        <div className="flex items-center justify-end gap-3">
          <label htmlFor="confirmar-exclusao" className="text-right text-sm font-medium text-gray-900">
            Para confirmar, digite a competência ({rotulo})
          </label>
          <input
            id="confirmar-exclusao"
            value={digitado}
            onChange={(e) => setDigitado(e.target.value)}
            autoComplete="off"
            className="h-9 w-30 shrink-0 rounded-sm border border-gray-300 bg-white px-3 text-right text-sm"
            placeholder="MM/AAAA"
          />
        </div>
        {excluir.isError ? (
          <p className="rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{mensagemDeErro(excluir.error, "Não foi possível excluir a competência.")}</p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            type="button"
            className="rounded-sm bg-red-700 font-bold text-white hover:bg-red-800"
            disabled={excluir.isPending || digitado.trim() !== rotulo}
            onClick={() => excluir.mutate()}
          >
            {excluir.isPending ? "Excluindo…" : "Excluir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Reabertura = { reabertaEm: string; reabertaPor: string; justificativa: string };

const COLUNAS_REABERTURA: Coluna<Reabertura>[] = [
  { chave: "quando", rotulo: "Reaberta em", tipo: "data", valor: (r) => new Date(r.reabertaEm).getTime(), texto: (r) => dataHora(r.reabertaEm), classe: "w-44" },
  { chave: "por", rotulo: "Por", valor: (r) => r.reabertaPor, classe: "w-48" },
  { chave: "justificativa", rotulo: "Justificativa", valor: (r) => r.justificativa },
];

/** O histórico das reaberturas da competência, com filtro e ordem nos rótulos. */
function HistoricoReaberturas({ reaberturas, onFechar }: { reaberturas: Reabertura[]; onFechar: () => void }) {
  const tabela = useTabelaFiltravel(reaberturas, COLUNAS_REABERTURA);
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-sm sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Histórico de Reaberturas</DialogTitle>
          <DialogDescription>{reaberturas.length} {plural(reaberturas.length, "reabertura", "reaberturas")} desta competência, com quem reabriu e a justificativa.</DialogDescription>
        </DialogHeader>
        <table className="tabela-sig w-full border-collapse text-sm">
          {tabela.cabecalho}
          <tbody>
            {tabela.visiveis.length === 0 ? (
              <SemResultado colunas={COLUNAS_REABERTURA.length} onLimpar={tabela.limpar} />
            ) : (
              tabela.visiveis.map((r) => (
                <tr key={r.reabertaEm} className="border-b border-gray-100 align-top">
                  <td className="px-4 py-2 whitespace-nowrap text-gray-700">{dataHora(r.reabertaEm)}</td>
                  <td className="px-4 py-2 text-gray-700">{r.reabertaPor}</td>
                  <td className="px-4 py-2 text-gray-900">{r.justificativa}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </DialogContent>
    </Dialog>
  );
}
