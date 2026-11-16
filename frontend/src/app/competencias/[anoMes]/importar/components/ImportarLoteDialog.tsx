"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownToLine, Calculator, CheckCircle2, Circle, Loader2, MinusCircle, Upload, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CampoArquivo } from "@/components/shared/CampoArquivo";
import { SinalDadosNovos } from "@/components/shared/SinalDadosNovos";
import { rotuloDoMes } from "@/lib/etapasDoMes";

import { inteiro } from "../../utils/formatacao";
import { ApurarDialog } from "./ApurarDialog";
import { plural } from "@/lib/texto";
import {
  importacoesService,
  type AbaLote,
  type ImportacaoDetalhe,
  type MesDaAba,
  type PreviaLote,
  type ResumoBalancete,
  type ResumoDreComercial,
} from "../services/importacoesService";

const mensagemDoErro = (error: unknown, padrao: string) =>
  (error as { response?: { data?: { error?: string } } }).response?.data?.error ?? padrao;

/** O que a importação mexeu em competências fechadas (ou já apuradas, nos preços), para avisar na linha do mês. */
function avisosDeFechadas(d: ImportacaoDetalhe): string[] {
  const r = d.resumo as (ResumoBalancete & ResumoDreComercial) | null;
  if (!r) return [];
  const avisos: string[] = [];
  if (r.modo === "COMPARACAO") {
    avisos.push(
      r.divergencias ? `Competência fechada: ${inteiro(r.divergencias)} ${plural(r.divergencias, "divergência", "divergências")} com o gravado.` : "Competência fechada: sem diferença com o gravado.",
    );
  }
  const retro = (r.retroativas ?? []).filter((x) => x.divergencias > 0);
  if (retro.length) avisos.push(`Diferenças em competências fechadas: ${retro.map((x) => `${x.competencia} (${inteiro(x.divergencias)})`).join(", ")}.`);
  if (Array.isArray(r.divergencias) && r.divergencias.length) {
    const porMes = new Map<string, number>();
    for (const x of r.divergencias) porMes.set(x.competencia, (porMes.get(x.competencia) ?? 0) + 1);
    avisos.push(`Preços alterados em competências já apuradas: ${[...porMes].map(([m, n]) => `${m} (${n})`).join(", ")}.`);
  }
  return avisos;
}

const ICONES = {
  importar: <ArrowDownToLine className="size-4 text-gray-900" />,
  fila: <Circle className="size-4 text-gray-400" />,
  andamento: <Loader2 className="size-4 animate-spin text-gray-700" />,
  ok: <CheckCircle2 className="size-4 text-green-600" />,
  aviso: <AlertTriangle className="size-4 text-yellow-600" />,
  erro: <XCircle className="size-4 text-red-600" />,
  fora: <MinusCircle className="size-4 text-gray-400" />,
};

function Situacao({
  icone,
  texto,
  detalhe,
  avisos = [],
  children,
}: {
  icone: keyof typeof ICONES;
  texto: string;
  detalhe?: string;
  avisos?: string[];
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className="mt-0.5 shrink-0">{ICONES[icone]}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className={`font-medium ${icone === "erro" ? "text-red-700" : "text-gray-900"}`}>{texto}</span>
          {children}
        </div>
        {detalhe ? <p className={`text-xs ${icone === "erro" ? "text-red-700" : "text-gray-600"}`}>{detalhe}</p> : null}
        {avisos.map((a) => (
          <p key={a} className="text-xs text-yellow-800">
            {a}{" "}
            <Link href="/divergencias" className="font-medium underline underline-offset-2">
              Ver divergências
            </Link>
          </p>
        ))}
      </div>
    </div>
  );
}

/** Um mês na fila: acompanha a importação até terminar. */
function MesNaFila({ anoMes, id, onAbrirRelatorio }: { anoMes: string; id: string; onAbrirRelatorio: (id: string) => void }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["importacao", id],
    queryFn: () => importacoesService.detalhar(id),
    refetchInterval: (q) => (q.state.data && q.state.data.status !== "PROCESSANDO" ? false : 1500),
  });
  const terminou = data && data.status !== "PROCESSANDO";
  useEffect(() => {
    if (!terminou) return;
    queryClient.invalidateQueries({ queryKey: ["importacoes", anoMes] });
    queryClient.invalidateQueries({ queryKey: ["competencias"] });
  }, [terminou, anoMes, queryClient]);

  if (!data || (data.status === "PROCESSANDO" && data.progresso === 0)) return <Situacao icone="fila" texto="Na fila" />;
  if (data.status === "PROCESSANDO") return <Situacao icone="andamento" texto={`Importando… ${data.progresso}%`} />;
  const relatorio = (
    <button type="button" onClick={() => onAbrirRelatorio(data.id)} className="text-xs font-medium text-gray-900 underline underline-offset-2">
      Relatório
    </button>
  );
  if (data.status === "REJEITADA") {
    return (
      <Situacao icone="erro" texto="Recusada" detalhe={data.motivoRejeicao ?? undefined}>
        {relatorio}
      </Situacao>
    );
  }
  const fechadas = avisosDeFechadas(data);
  return (
    <Situacao
      icone={fechadas.length ? "aviso" : "ok"}
      texto={data.comparacao ? "Comparada" : "Importada"}
      detalhe={`${inteiro(data.linhasAceitas)} ${plural(data.linhasAceitas, "registro gravado", "registros gravados")}${data.linhasRejeitadas ? `, ${inteiro(data.linhasRejeitadas)} com erro` : ""}.`}
      avisos={fechadas}
    >
      {relatorio}
    </Situacao>
  );
}

/** Um mês da aba: na prévia, o que vai acontecer; depois de importar, o andamento. */
function Mes({ anoMes, m, onAbrirRelatorio }: { anoMes: string; m: MesDaAba; onAbrirRelatorio: (id: string) => void }) {
  const situacao = m.importacaoId ? (
    <MesNaFila anoMes={anoMes} id={m.importacaoId} onAbrirRelatorio={onAbrirRelatorio} />
  ) : m.erro ? (
    <Situacao icone="erro" texto="Erro" detalhe={m.erro} />
  ) : m.acao === "IMPORTAR" ? (
    <Situacao icone="importar" texto={m.atual ? "Será importado" : "Será importado (mês anterior aberto)"} />
  ) : m.acao === "COMPARAR" ? (
    <Situacao icone="importar" texto="Será comparado com o gravado (competência fechada)" />
  ) : m.acao === "FECHADA" ? (
    <Situacao icone="aviso" texto="Diferente, em competência fechada" detalhe={m.mensagem} />
  ) : (
    <Situacao icone="erro" texto="Estrutura inválida no mês" detalhe={m.mensagem} />
  );
  return (
    <div className="flex items-start gap-3 py-1">
      <span className={`w-16 shrink-0 ${m.atual ? "font-bold text-gray-900" : "text-gray-700"}`}>{rotuloDoMes(m.anoMes)}</span>
      <span className="w-24 shrink-0 text-right text-gray-600">{m.registros !== undefined ? `${inteiro(m.registros)} reg.` : ""}</span>
      <div className="min-w-0 flex-1">
        {situacao}
        {m.avisos.map((x) => (
          <p key={x} className="text-xs text-yellow-800">
            {x}
          </p>
        ))}
      </div>
    </div>
  );
}

/** Uma aba: os meses que mudam, um por linha, e os sem mudança numa linha só. */
function Aba({ anoMes, a, onAbrirRelatorio }: { anoMes: string; a: AbaLote; onAbrirRelatorio: (id: string) => void }) {
  const semMudanca = a.meses.filter((m) => m.acao === "SEM_MUDANCA" && !m.importacaoId);
  const outros = a.meses.filter((m) => !(m.acao === "SEM_MUDANCA" && !m.importacaoId));
  return (
    <tr className="border-b border-gray-100 align-top">
      <td className="px-3 py-2">
        <div className="font-medium text-gray-900">{a.aba}</div>
        <div className="text-xs text-gray-500">{a.rotulo}</div>
      </td>
      <td className="px-3 py-1">
        {a.situacao === "INVALIDA" ? (
          <div className="py-1">
            <Situacao icone="erro" texto="Estrutura inválida" detalhe={a.mensagem} />
          </div>
        ) : a.situacao === "IGNORADA" ? (
          <div className="py-1">
            <Situacao icone="fora" texto="Não importada" detalhe={a.mensagem} />
          </div>
        ) : (
          <>
            {outros.map((m) => (
              <Mes key={m.anoMes} anoMes={anoMes} m={m} onAbrirRelatorio={onAbrirRelatorio} />
            ))}
            {semMudanca.length ? (
              <div className="py-1">
                <Situacao icone="fora" texto="Sem mudança" detalhe={semMudanca.map((m) => rotuloDoMes(m.anoMes)).join(", ")} />
              </div>
            ) : null}
            {a.meses.length === 0 && a.mensagem ? (
              <div className="py-1">
                <Situacao icone="fora" texto="Nada a importar" detalhe={a.mensagem} />
              </div>
            ) : null}
          </>
        )}
      </td>
    </tr>
  );
}

/**
 * "Importar Arquivo": o usuário escolhe uma planilha .xlsx; a ferramenta lê o
 * arquivo inteiro e mostra a prévia — as abas que reconheceu e, em cada uma,
 * o que muda no mês da competência e nos meses anteriores ainda abertos. Com
 * "Importar", os meses que mudaram entram na fila, um por vez; um erro é
 * avisado e o próximo segue. Sem nenhuma mudança, "Importar" continua valendo e
 * reimporta o mês do envio das abas sem mudança (11/10/2026).
 *
 * Com `tipo` (o Importar ou Reimportar da linha do tipo, 06/11/2026), o mesmo
 * diálogo só com a aba dele: na lista dos arquivos, na prévia e na importação.
 */
/** Os arquivos que a importação lê, com as abas de cada um e o tipo de cada aba (o reconhecimento é pelo nome da aba). */
const ARQUIVOS_DE_IMPORTACAO: Array<{ arquivo: string; abas: Record<string, string> }> = [
  {
    arquivo: "SIG BPM 2026 - LISTAS REALIZADO (OPERAÇÃO)",
    abas: {
      "Projetos (Resumo)": "PROJETO",
      "Produção (Resumo)": "PRODUCAO",
      "Produção (Lista pst)": "PRODUCAO_PISTA",
      "Produção (Armaduras)": "PRODUCAO_ARMADURA",
      "Produção (Metalúrgica)": "PRODUCAO_METALURGIA",
      "Expedição (Resumo)": "EXPEDICAO",
      "Montagem (Resumo)": "MONTAGEM",
      Acompanhamentos: "ACOMPANHAMENTO",
      Medições: "MEDICAO",
      "Devoluções (Resumo)": "DEVOLUCAO",
      "Saídas (Resumo)": "SAIDA",
      "Quadro de Lotação": "QUADRO_LOTACAO",
      "Indicadores (Admin.)": "INDICADORES_ADMIN",
      "Estoque (2025)": "ESTOQUE_INICIAL",
    },
  },
  // As abas Requisições (Lista) e Notas Fiscais (Lista) saíram do arquivo em 15/10/2026 e voltaram em 26/10/2026 (a etapa Linhas);
  // a Impostos (Lista), os Créditos de Impostos, entrou em 04/11/2026.
  {
    arquivo: "SIG BPM 2026 - LISTAS REALIZADO (RESULTADOS)",
    abas: { "Balancete (Lista)": "BALANCETE", "Requisições (Lista)": "REQUISICOES", "Notas Fiscais (Lista)": "NOTAS_FISCAIS", "Impostos (Lista)": "CREDITOS_IMPOSTOS" },
  },
  { arquivo: "CONTROLE DAS VENDAS - COMERCIAL", abas: { DRE: "DRE_COMERCIAL", "Indicadores (Comercial)": "INDICADORES_COMERCIAL" } },
];

export function ImportarLoteDialog({
  anoMes,
  aberto,
  fechada,
  tipo,
  titulo,
  onFechar,
  onAbrirRelatorio,
}: {
  anoMes: string;
  aberto: boolean;
  /** Competência fechada: só o balancete entra, para comparar. */
  fechada: boolean;
  /** O Importar da linha de um tipo: só a aba dele. */
  tipo?: string;
  /** O título no Importar da linha ("Reimportar Projetos"); sem ele, o do Importar Arquivo. */
  titulo?: string;
  onFechar: () => void;
  onAbrirRelatorio: (id: string) => void;
}) {
  const campo = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [envio, setEnvio] = useState(0);
  const [escolhido, setEscolhido] = useState<File | null>(null);
  const [previa, setPrevia] = useState<PreviaLote | null>(null);
  const [importado, setImportado] = useState<PreviaLote | null>(null);
  const [apurando, setApurando] = useState(false);
  const analisar = useMutation({
    mutationFn: (arquivo: File) => {
      setEnvio(0);
      setPrevia(null);
      setImportado(null);
      return importacoesService.analisarLote(anoMes, arquivo, setEnvio, tipo);
    },
    onSuccess: setPrevia,
  });
  const importar = useMutation({
    mutationFn: () => importacoesService.importarLote(anoMes, previa!, reimportar, tipo),
    onSuccess: (r) => {
      setImportado(r);
      // As importações novas (na fila) já entram no Histórico, no Em Vigor e nos sinais das competências.
      queryClient.invalidateQueries({ queryKey: ["importacoes"] });
      queryClient.invalidateQueries({ queryKey: ["competencias"] });
    },
  });
  const recomecar = () => {
    analisar.reset();
    importar.reset();
    setPrevia(null);
    setImportado(null);
    setEscolhido(null);
    if (campo.current) campo.current.value = "";
  };

  const exibida = importado ?? previa;
  const meses = (previa?.abas ?? []).flatMap((a) => a.meses);
  const aImportar = meses.filter((m) => m.acao === "IMPORTAR" || m.acao === "COMPARAR");
  const anteriores = aImportar.filter((m) => !m.atual);
  const naFila = (importado?.abas ?? []).flatMap((a) => a.meses).filter((m) => m.importacaoId).length;
  // Nada mudou: "Importar" reimporta assim mesmo o mês do envio das abas sem mudança.
  const aReimportar = aImportar.length === 0 ? meses.filter((m) => m.acao === "SEM_MUDANCA" && m.atual) : [];
  const reimportar = aReimportar.length > 0;
  const quantos = aImportar.length || aReimportar.length;
  // Os arquivos que servem; no Importar da linha, só o do tipo, com a aba dele.
  const arquivos = ARQUIVOS_DE_IMPORTACAO.map((a) => ({ arquivo: a.arquivo, abas: Object.keys(a.abas).filter((aba) => !tipo || a.abas[aba] === tipo) })).filter((a) => a.abas.length);
  const abaDoTipo = tipo ? arquivos[0]?.abas[0] : undefined;
  // O Apurar (06/11/2026): no Quadro de Lotação e nos Indicadores do Administrativo, os valores do mês saem do Quadro de
  // Lotação da Gestão de Colaboradores, sem a planilha.
  const apuravel = tipo === "QUADRO_LOTACAO" || tipo === "INDICADORES_ADMIN";
  const botaoApurar = apuravel ? (
    <Button type="button" variant="outline" className="rounded-sm" onClick={() => setApurando(true)} disabled={importar.isPending}>
      <Calculator className="size-4" />
      Apurar
    </Button>
  ) : null;
  return (
    <Dialog
      open={aberto}
      onOpenChange={(o) => {
        if (!o) {
          onFechar();
          recomecar();
        }
      }}
    >
      {/* O topo (título, descrição, resumo do arquivo e rótulos da tabela) e os botões ficam fixos; só as linhas da tabela rolam. */}
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden rounded-sm sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{titulo ?? (fechada ? "Comparar Balancete" : "Importar Arquivo")}</DialogTitle>
          <DialogDescription>
            {tipo ? (
              <>
                Escolha a planilha (.xlsx) com a aba {abaDoTipo}: o arquivo completo ou uma pasta de trabalho só com essa aba. A ferramenta confere a
                estrutura e compara, mês a mês, com o que está importado — o mês desta competência e os meses anteriores ainda abertos. Só essa aba é lida,
                e nada é importado antes de você confirmar.
              </>
            ) : (
              <>
                Escolha uma planilha (.xlsx). A ferramenta lê o arquivo inteiro, reconhece as abas pelo nome (Balancete (Lista), Projetos (Resumo), DRE…),
                confere a estrutura e compara, mês a mês, com o que está importado — o mês desta competência e os meses anteriores ainda abertos. Nada é
                importado antes de você confirmar.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {!exibida ? (
          <div className="min-h-0 space-y-3 overflow-y-auto">
            <CampoArquivo
              ref={campo}
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={analisar.isPending}
              arquivo={escolhido}
              onEscolher={(f) => {
                setEscolhido(f);
                if (f) analisar.mutate(f);
              }}
            />
            {analisar.isPending ? (
              <p className="flex items-center gap-2 text-sm text-gray-700">
                <Loader2 className="size-4 animate-spin" />
                {envio < 100 ? `Enviando o arquivo… ${envio}%` : "Lendo o arquivo e comparando cada mês com o que está importado…"}
              </p>
            ) : null}
            {analisar.isError ? <p className="text-sm text-red-700">{mensagemDoErro(analisar.error, "Não foi possível ler o arquivo.")}</p> : null}
            {botaoApurar ? (
              <div className="flex items-center justify-end gap-3">
                <p className="text-xs text-gray-600">Ou apure os valores do mês no Quadro de Lotação (Gestão de Colaboradores):</p>
                {botaoApurar}
              </div>
            ) : null}
            {/* Os arquivos que servem para a importação, com as abas que a ferramenta lê de cada um. */}
            <div className="rounded-sm border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs font-bold text-gray-900">{arquivos.length === 1 ? "Arquivo que Serve" : "Arquivos que Servem"} para a Importação</p>
              <ul className="mt-1.5 space-y-1 text-xs text-gray-700">
                {arquivos.map((a) => (
                  <li key={a.arquivo}>
                    <span className="font-medium text-gray-900">{a.arquivo}</span>: {a.abas.join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <p className="text-sm text-gray-700">
              <span className="font-medium text-gray-900">{exibida.nomeArquivo}</span>:{" "}
              {exibida.abas.length === 0
                ? "nenhuma aba que a ferramenta importa."
                : importado
                  ? `${naFila} ${plural(naFila, "mês", "meses")} na fila de importação.`
                  : reimportar
                    ? "nenhuma mudança: o arquivo é igual ao que está importado. “Importar” reimporta o mês atual assim mesmo."
                    : aImportar.length === 0
                    ? "nada a importar: o arquivo é igual ao que está importado."
                    : `${aImportar.length} ${plural(aImportar.length, "mês", "meses")} a importar${anteriores.length ? `, dos quais ${anteriores.length} ${plural(anteriores.length, "de mês anterior ainda aberto", "de meses anteriores ainda abertos")}` : ""}.`}
            </p>
            {anteriores.length ? (
              <p className="flex items-center gap-2 text-xs text-gray-600">
                <SinalDadosNovos titulo="Bola verde" />
                Os meses anteriores importados ficam marcados com a bola verde (Fechamento Mensal, seletor de mês e menu lateral) até serem reapurados.
              </p>
            ) : null}
            {exibida.abas.length > 0 || exibida.outras.length > 0 ? (
              // A área que rola: os rótulos presos no alto dela (--topo-tabela zerado), as abas e, no fim, as abas ignoradas.
              <div className="min-h-0 flex-1 overflow-y-auto rounded-sm border border-gray-200 [--topo-tabela:0px]">
            {exibida.abas.length > 0 ? (
              <table className="tabela-sig w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs font-bold text-gray-900">
                    <th className="w-56 px-3 py-2">Aba</th>
                    <th className="px-3 py-2">Meses e Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {exibida.abas.map((a) => (
                    <Aba key={a.aba} anoMes={anoMes} a={a} onAbrirRelatorio={onAbrirRelatorio} />
                  ))}
                </tbody>
              </table>
            ) : null}
            {exibida.outras.length > 0 ? <p className="px-3 py-2 text-xs text-gray-500">Abas sem importação (ignoradas): {exibida.outras.join(", ")}.</p> : null}
              </div>
            ) : null}
            {importar.isError ? <p className="text-sm text-red-700">{mensagemDoErro(importar.error, "Não foi possível importar.")}</p> : null}
            <div className="flex justify-end gap-2 pt-1">
              {importado ? (
                <>
                  <Button type="button" variant="outline" className="rounded-sm" onClick={recomecar}>
                    Importar Outro Arquivo
                  </Button>
                  <Button type="button" className="rounded-sm" onClick={() => (onFechar(), recomecar())}>
                    Fechar
                  </Button>
                </>
              ) : (
                <>
                  <Button type="button" variant="outline" className="rounded-sm" onClick={recomecar} disabled={importar.isPending}>
                    Escolher Outro Arquivo
                  </Button>
                  {botaoApurar}
                  <Button
                    type="button"
                    onClick={() => importar.mutate()}
                    disabled={quantos === 0 || importar.isPending}
                    className="bg-bpm-primary hover:bg-bpm-primary-hover rounded-sm font-bold text-black shadow-sm"
                  >
                    {importar.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                    {importar.isPending ? "Importando…" : `Importar${quantos ? ` (${quantos})` : ""}`}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </DialogContent>
      {apurando && apuravel ? <ApurarDialog anoMes={anoMes} tipo={tipo} onFechar={() => setApurando(false)} /> : null}
    </Dialog>
  );
}
