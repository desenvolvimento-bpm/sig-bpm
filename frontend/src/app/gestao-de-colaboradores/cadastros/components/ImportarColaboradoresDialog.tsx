"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { CampoArquivo } from "@/components/shared/CampoArquivo";
import { botaoPrimario } from "@/app/cenarios/components/CenarioDialog";
import { mensagemDeErro } from "@/app/cadastros/services/edicaoService";
import { plural } from "@/lib/texto";

import { colaboradoresService, type PreviaColaboradores, type SituacaoLinha, type TipoImportacaoColaboradores } from "../services/colaboradoresService";

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const classeSelect = "h-9 rounded-sm border border-gray-300 bg-white px-3 text-sm";

const ROTULO_SITUACAO: Record<SituacaoLinha, { rotulo: string; classe: string }> = {
  NOVA: { rotulo: "Nova", classe: "text-green-700" },
  ALTERADA: { rotulo: "Alterada", classe: "text-blue-700" },
  IGUAL: { rotulo: "Igual", classe: "text-gray-500" },
  INVALIDA: { rotulo: "Inválida", classe: "font-medium text-red-700" },
};

const TEXTOS: Record<TipoImportacaoColaboradores, { titulo: string; descricao: string }> = {
  funcoes: {
    titulo: "Importar Funções",
    descricao:
      "Escolha a planilha (.xlsx) com as colunas Função, Descrição, Senioridade, Competências e Atividades. Cada linha é uma função numa senioridade (a mesma função pode vir em várias linhas, uma por senioridade). A importação substitui o cadastro inteiro: as funções que não estão na planilha são excluídas, e as da planilha são cadastradas de novo (a já cadastrada com o mesmo nome e a mesma senioridade fica com os dados da planilha e com os vínculos dela). A Senioridade precisa estar cadastrada na aba Senioridades. Na planilha com várias abas, vale a que tem mais dessas colunas. Nada é importado antes de você confirmar, e uma linha inválida cancela a importação.",
  },
  "lancamento-inicial": {
    titulo: "Importar Lançamento Inicial",
    descricao:
      "Escolha a competência e a planilha (.xlsx) com as colunas Unidade, Tipo (CLT ou PJ), Senioridade, Função e Centro de Custo (o código ou o nome), um colaborador por linha: o quadro de lotação do início do mês. A importação apaga o Lançamento Inicial anterior inteiro e grava as linhas da planilha. Nada é importado antes de você confirmar, e uma linha inválida (uma senioridade, uma função ou um centro de custo não cadastrado) cancela a importação.",
  },
};

/** O modal de importação das abas Funções e Lançamento Inicial (06/11/2026): a prévia, linha a linha, e o Importar. */
export function ImportarColaboradoresDialog({ tipo, onFechar }: { tipo: TipoImportacaoColaboradores; onFechar: () => void }) {
  const queryClient = useQueryClient();
  const hoje = new Date();
  const [mes, setMes] = useState(hoje.getMonth() + 1);
  const [ano, setAno] = useState(hoje.getFullYear());
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<PreviaColaboradores | null>(null);
  const comCompetencia = tipo === "lancamento-inicial";
  const competencia = comCompetencia ? `${ano}-${String(mes).padStart(2, "0")}` : undefined;

  const analisar = useMutation({
    mutationFn: (opcoes: { arquivo: File; competencia?: string }) => colaboradoresService.importar(tipo, opcoes.arquivo, { competencia: opcoes.competencia, gravar: false }),
    onMutate: () => setPrevia(null),
    onSuccess: setPrevia,
  });
  const importar = useMutation({
    mutationFn: () => colaboradoresService.importar(tipo, arquivo!, { competencia, gravar: true }),
    onSuccess: (r) => {
      const excluidas = r.excluidas?.total ?? 0;
      toast.success(
        tipo === "funcoes"
          ? `Funções importadas: ${r.resumo.NOVA} ${plural(r.resumo.NOVA, "nova", "novas")}, ${r.resumo.ALTERADA} ${plural(r.resumo.ALTERADA, "alterada", "alteradas")} e ${excluidas} ${plural(excluidas, "excluída", "excluídas")}.${r.apagaLancamentoInicial ? " O Lançamento Inicial foi apagado: importe-o de novo." : ""}`
          : `Lançamento Inicial de ${r.competencia} importado: ${r.resumo.NOVA} ${plural(r.resumo.NOVA, "colaborador", "colaboradores")}.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["edicao"] });
      onFechar();
    },
  });

  const escolher = (f: File | null) => {
    setArquivo(f);
    importar.reset();
    if (f) analisar.mutate({ arquivo: f, competencia });
    else setPrevia(null);
  };
  /** Trocar a competência refaz a prévia do mesmo arquivo. */
  const mudarCompetencia = (m: number, a: number) => {
    setMes(m);
    setAno(a);
    if (arquivo) analisar.mutate({ arquivo, competencia: `${a}-${String(m).padStart(2, "0")}` });
  };

  const r = previa?.resumo;
  // Nas funções, também as que saem do cadastro (11/11/2026: a importação substitui o cadastro inteiro).
  const excluidas = previa?.excluidas?.total ?? 0;
  const aGravar = r ? r.NOVA + r.ALTERADA + excluidas : 0;
  const anos = [hoje.getFullYear() - 2, hoje.getFullYear() - 1, hoje.getFullYear(), hoje.getFullYear() + 1];

  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden rounded-sm sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{TEXTOS[tipo].titulo}</DialogTitle>
          <DialogDescription>{TEXTOS[tipo].descricao}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          {comCompetencia ? (
            <div className="space-y-1.5">
              <Label htmlFor="competencia-mes">Competência</Label>
              <div className="flex gap-2">
                <select id="competencia-mes" aria-label="Mês" value={mes} onChange={(e) => mudarCompetencia(Number(e.target.value), ano)} className={classeSelect}>
                  {MESES.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
                <select aria-label="Ano" value={ano} onChange={(e) => mudarCompetencia(mes, Number(e.target.value))} className={classeSelect}>
                  {anos.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}
          <div className="min-w-64 flex-1 space-y-1.5">
            <Label htmlFor="planilha-colaboradores">Planilha (.xlsx)</Label>
            <CampoArquivo
              id="planilha-colaboradores"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              arquivo={arquivo}
              disabled={analisar.isPending || importar.isPending}
              onEscolher={escolher}
            />
          </div>
        </div>

        {analisar.isPending ? (
          <p className="flex items-center gap-2 text-sm text-gray-700">
            <Loader2 className="size-4 animate-spin" />
            Lendo a planilha e conferindo os cadastros…
          </p>
        ) : null}
        {analisar.isError ? <p className="text-sm text-red-700">{mensagemDeErro(analisar.error, "Não foi possível ler a planilha.")}</p> : null}

        {previa && r ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <p className="text-sm text-gray-700">
              <span className="font-medium text-gray-900">{previa.nomeArquivo}</span> (aba {previa.aba}):{" "}
              {tipo === "funcoes"
                ? `${previa.linhas.length} ${plural(previa.linhas.length, "linha", "linhas")}: ${r.NOVA} ${plural(r.NOVA, "nova", "novas")}, ${r.ALTERADA} ${plural(r.ALTERADA, "alterada", "alteradas")}, ${r.IGUAL} ${plural(r.IGUAL, "igual", "iguais")} e ${r.INVALIDA} ${plural(r.INVALIDA, "inválida", "inválidas")}.`
                : `${previa.linhas.length} ${plural(previa.linhas.length, "colaborador", "colaboradores")} no quadro do início de ${previa.competencia}${r.INVALIDA ? `, ${r.INVALIDA} ${plural(r.INVALIDA, "linha inválida", "linhas inválidas")}` : ""}.`}
              {previa.substitui ? ` A importação apaga os ${previa.substitui.colaboradores} do Lançamento Inicial de ${previa.substitui.competencia}.` : ""}
              {tipo === "funcoes" ? (excluidas ? ` ${excluidas} ${plural(excluidas, "função que não está", "funções que não estão")} na planilha ${excluidas === 1 ? "será excluída" : "serão excluídas"}.` : " Nenhuma função sai do cadastro.") : ""}
            </p>
            {excluidas ? (
              <p className="max-h-20 overflow-y-auto text-xs text-gray-600">
                <span className="font-medium text-gray-900">Saem do cadastro:</span> {previa.excluidas!.nomes.join("; ")}
                {excluidas > previa.excluidas!.nomes.length ? ` e mais ${excluidas - previa.excluidas!.nomes.length}` : ""}.
              </p>
            ) : null}
            {previa.apagaLancamentoInicial && !previa.bloqueio ? (
              <p className="rounded-sm border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                O Lançamento Inicial de {previa.apagaLancamentoInicial.competencia} ({previa.apagaLancamentoInicial.colaboradores}{" "}
                {plural(previa.apagaLancamentoInicial.colaboradores, "colaborador", "colaboradores")}) usa {previa.apagaLancamentoInicial.funcoes} das funções excluídas e também será apagado: importe-o de novo em seguida
                (aba Lançamento Inicial), com as funções da planilha.
              </p>
            ) : null}
            {previa.bloqueio ? <p className="rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">A importação será cancelada: {previa.bloqueio}</p> : null}
            {r.INVALIDA ? (
              <p className="rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                A importação será cancelada: corrija {r.INVALIDA === 1 ? "a linha inválida" : `as ${r.INVALIDA} linhas inválidas`} na planilha (ou cadastre o que falta) e escolha o
                arquivo de novo.
              </p>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto rounded-sm border border-gray-200 [--topo-tabela:0px]">
              <table className="tabela-sig w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs font-bold text-gray-900">
                    <th className="px-3 py-2 text-right">Linha</th>
                    {previa.colunas.map((c) => (
                      <th key={c.chave} className="px-3 py-2">
                        {c.rotulo}
                      </th>
                    ))}
                    <th className="px-3 py-2">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {previa.linhas.map((l) => (
                    <tr key={l.linha} className="border-b border-gray-100 align-top">
                      <td className="px-3 py-1.5 text-right text-gray-600">{l.linha}</td>
                      {previa.colunas.map((c) => (
                        <td key={c.chave} className="max-w-56 truncate px-3 py-1.5" title={l.valores[c.chave]}>
                          {l.valores[c.chave] || <span className="text-gray-400">—</span>}
                        </td>
                      ))}
                      <td className="px-3 py-1.5">
                        <span className={ROTULO_SITUACAO[l.situacao].classe}>{ROTULO_SITUACAO[l.situacao].rotulo}</span>
                        {l.motivo ? <p className="text-xs text-red-700">{l.motivo}</p> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {importar.isError ? <p className="text-sm text-red-700">{mensagemDeErro(importar.error, "Não foi possível importar.")}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar} disabled={importar.isPending}>
                Cancelar
              </Button>
              <Button type="button" className={botaoPrimario} disabled={!!r.INVALIDA || !!previa.bloqueio || aGravar === 0 || importar.isPending} onClick={() => importar.mutate()}>
                {importar.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                {importar.isPending ? "Importando…" : `Importar${aGravar ? ` (${aGravar})` : ""}`}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
