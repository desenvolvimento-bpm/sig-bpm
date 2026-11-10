"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { plural } from "@/lib/texto";

import { inteiro } from "../../utils/formatacao";

export type TipoApurado = "INDICADORES_ADMIN" | "QUADRO_LOTACAO";
type Previa = {
  tipo: TipoApurado;
  competencia: string;
  indicadores?: Array<{ nome: string; valor: number | null; atual: { valor: number; origem: string } | null }>;
  lotacao?: Array<{ centroCusto: string; unidade: string | null; departamento: string | null; atribuicao: string | null; clt: number; pj: number; total: number }>;
  atual?: { nomeArquivo: string; total: number } | null;
};

const mensagemDoErro = (error: unknown, padrao: string) => (error as { response?: { data?: { error?: string } } }).response?.data?.error ?? padrao;
const ORIGEM: Record<string, string> = { IMPORTADO: "importado", DIGITADO: "digitado", APURADO: "apurado" };
/** O valor do indicador: o Turnover em %, os quadros e as contratações em número. */
const formatar = (nome: string, v: number | null) =>
  v === null ? "—" : nome === "Turnover" ? `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : inteiro(v);

/**
 * O Apurar das Importações (06/11/2026, pedido do Adão): os valores do mês tirados do Quadro de Lotação da Gestão de
 * Colaboradores, com os registrados hoje ao lado; com Gravar, os Indicadores do Administrativo ficam como os digitados nas
 * Listas (por cima do importado) e o Quadro de Lotação vira uma importação "apurada". Uma nova importação da planilha os
 * sobrescreve.
 */
export function ApurarDialog({ anoMes, tipo, onFechar }: { anoMes: string; tipo: TipoApurado; onFechar: () => void }) {
  const queryClient = useQueryClient();
  const previa = useQuery({
    queryKey: ["apuracao", anoMes, tipo],
    queryFn: async () => (await api.get<{ data: Previa }>(`/proxy/gestao-de-colaboradores/apuracao/${anoMes}/${tipo}`)).data.data,
    retry: false,
  });
  const gravar = useMutation({
    mutationFn: async () => (await api.post<{ data: { gravados: number } }>(`/proxy/gestao-de-colaboradores/apuracao/${anoMes}/${tipo}`)).data.data,
    onSuccess: (r) => {
      toast.success(
        tipo === "INDICADORES_ADMIN"
          ? `${r.gravados} ${plural(r.gravados, "indicador apurado gravado", "indicadores apurados gravados")}.`
          : `Quadro de Lotação apurado gravado: ${r.gravados} ${plural(r.gravados, "linha", "linhas")}.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["importacoes"] });
      void queryClient.invalidateQueries({ queryKey: ["competencias"] });
      void queryClient.invalidateQueries({ queryKey: ["apuracao"] });
      onFechar();
    },
  });
  const p = previa.data;
  const totalLotacao = p?.lotacao?.reduce((s, l) => s + l.total, 0) ?? 0;

  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden rounded-sm sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{tipo === "INDICADORES_ADMIN" ? "Apurar Indicadores do Administrativo" : "Apurar Quadro de Lotação"}</DialogTitle>
          <DialogDescription>
            {tipo === "INDICADORES_ADMIN"
              ? "Os indicadores do quadro de lotação do mês, tirados da competência do Quadro de Lotação (Gestão de Colaboradores): o Quadro de Lotação Total, o Turnover, a Abertura de Vagas x Contratações e os quadros por atribuição e local. Com Gravar, eles valem por cima do importado (como os digitados nas Listas); uma nova importação da planilha os sobrescreve. Os demais indicadores da aba continuam vindo da planilha."
              : "Os colaboradores do fim do mês por grupo de centros de custo, tirados da competência do Quadro de Lotação (Gestão de Colaboradores). Com Gravar, a lista vira a importação em vigor do tipo, no lugar da anterior; uma nova importação da planilha a substitui."}
          </DialogDescription>
        </DialogHeader>
        {previa.isPending ? (
          <p className="flex items-center gap-2 text-sm text-gray-700">
            <Loader2 className="size-4 animate-spin" />
            Apurando o mês no Quadro de Lotação…
          </p>
        ) : previa.isError ? (
          <p className="text-sm text-red-700">{mensagemDoErro(previa.error, "Não foi possível apurar.")}</p>
        ) : p?.indicadores ? (
          <div className="min-h-0 flex-1 overflow-y-auto rounded-sm border border-gray-200 [--topo-tabela:0px]">
            <table className="tabela-sig w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs font-bold text-gray-900">
                  <th className="px-3 py-2">Indicador</th>
                  <th className="px-3 py-2 text-right">Apurado</th>
                  <th className="px-3 py-2 text-right">Registrado Hoje</th>
                </tr>
              </thead>
              <tbody>
                {p.indicadores.map((i) => (
                  <tr key={i.nome} className="border-b border-gray-100">
                    <td className="px-3 py-1.5">{i.nome}</td>
                    <td className="px-3 py-1.5 text-right font-medium">{formatar(i.nome, i.valor)}</td>
                    <td className="px-3 py-1.5 text-right text-gray-600">
                      {i.atual ? `${formatar(i.nome, i.atual.valor)} (${ORIGEM[i.atual.origem] ?? i.atual.origem})` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : p?.lotacao ? (
          <>
            <p className="text-sm text-gray-700">
              {p.lotacao.length} {plural(p.lotacao.length, "linha", "linhas")}, {inteiro(totalLotacao)} {plural(totalLotacao, "colaborador", "colaboradores")}
              {p.atual ? `; hoje, ${inteiro(p.atual.total)} (${p.atual.nomeArquivo}).` : "; o mês ainda não tem o Quadro de Lotação."}
            </p>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-sm border border-gray-200 [--topo-tabela:0px]">
              <table className="tabela-sig w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs font-bold text-gray-900">
                    <th className="px-3 py-2">Centro de Custo</th>
                    <th className="px-3 py-2">Unidade</th>
                    <th className="px-3 py-2">Departamento</th>
                    <th className="px-3 py-2">Atribuição</th>
                    <th className="px-3 py-2 text-right">CLT</th>
                    <th className="px-3 py-2 text-right">PJ</th>
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {p.lotacao.map((l) => (
                    <tr key={`${l.centroCusto}|${l.unidade}|${l.departamento}|${l.atribuicao}`} className="border-b border-gray-100">
                      <td className="px-3 py-1.5">{l.centroCusto}</td>
                      <td className="px-3 py-1.5">{l.unidade ?? "—"}</td>
                      <td className="px-3 py-1.5">{l.departamento ?? "—"}</td>
                      <td className="px-3 py-1.5">{l.atribuicao === "DIRETA" ? "Direta" : l.atribuicao === "INDIRETA" ? "Indireta" : "—"}</td>
                      <td className="px-3 py-1.5 text-right">{l.clt}</td>
                      <td className="px-3 py-1.5 text-right">{l.pj}</td>
                      <td className="px-3 py-1.5 text-right font-medium">{l.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
        {gravar.isError ? <p className="text-sm text-red-700">{mensagemDoErro(gravar.error, "Não foi possível gravar.")}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!p || gravar.isPending || (p.lotacao !== undefined && p.lotacao.length === 0)}
            onClick={() => gravar.mutate()}
            className="bg-bpm-primary hover:bg-bpm-primary-hover rounded-sm font-bold text-black shadow-sm"
          >
            {gravar.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {gravar.isPending ? "Gravando…" : "Gravar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
