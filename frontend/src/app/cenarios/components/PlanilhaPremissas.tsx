"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CopyCheck, Download, Eraser, FileUp, FolderUp, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { plural } from "@/lib/texto";

import { mensagemDoErro, nomeDoArquivo } from "@/app/competencias/[anoMes]/dre/components/ExportarDRE";
import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";

import { cenariosService, DEPARTAMENTOS_DAS_PREMISSAS, type AnaliseDePremissas, type DepartamentoDasPremissas } from "../services/cenariosService";
import { botaoPrimario, Erro, OpcaoEmLinha } from "./CenarioDialog";

const invalidar = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries({ queryKey: ["cenarios"] });
  queryClient.invalidateQueries({ queryKey: ["relatorios"] });
};

/** O que cada botão faz, nos modais e no Como Usar. */
const ABAS_DA_PLANILHA =
  "Matriz, Filial, Serviços, Quadro de Lotação, Centros de Custo (com o Quadro de Lotação e os Encargos e Benefícios), Investimentos (a Depreciação Base), Extra-Operacional e Indicadores Manuais";

/**
 * Os botões Replicar Médias e Apagar Valores (15/10/2026; antes, um botão só, Replicar Médias / Apagar Valores, com a
 * escolha no modal), na altura do título das Premissas: em todas as abas, replica a Média de Referência de cada linha
 * nos doze meses, ou deixa os meses em branco. Cada um abre o modal dele, que confirma antes de gravar.
 */
export function BotaoReplicarMedias({ id }: { id: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Button type="button" className={botaoPrimario} onClick={() => setAberto(true)}>
        <CopyCheck className="size-4" />
        Replicar Médias
      </Button>
      {aberto ? <ReplicarOuApagarDialog id={id} acao="replicar" onFechar={() => setAberto(false)} /> : null}
    </>
  );
}

export function BotaoApagarValores({ id }: { id: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Button type="button" className={botaoPrimario} onClick={() => setAberto(true)}>
        <Eraser className="size-4" />
        Apagar Valores
      </Button>
      {aberto ? <ReplicarOuApagarDialog id={id} acao="apagar" onFechar={() => setAberto(false)} /> : null}
    </>
  );
}

function ReplicarOuApagarDialog({ id, acao, onFechar }: { id: string; acao: "replicar" | "apagar"; onFechar: () => void }) {
  const queryClient = useQueryClient();
  const replicar = acao === "replicar";
  const gravar = useMutation({
    mutationFn: () => cenariosService.replicarMedias(id, acao),
    onSuccess: (r) => {
      invalidar(queryClient);
      toast.success(
        replicar
          ? `Médias replicadas em ${r.linhas} ${plural(r.linhas, "linha", "linhas")} (${r.valores} ${plural(r.valores, "valor", "valores")}); a DRE do cenário foi recalculada.`
          : `Valores apagados em ${r.linhas} ${plural(r.linhas, "linha", "linhas")}; a DRE do cenário foi recalculada.`,
      );
      onFechar();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-sm sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{replicar ? "Replicar Médias" : "Apagar Valores"}</DialogTitle>
          {/* Uma frase por item, com a bolinha, como nos painéis explicativos. */}
          <DialogDescription render={<div />}>
            <ul className="list-disc space-y-1.5 pl-5">
              {replicar ? (
                <>
                  <li>A Média de Referência de cada linha vai para os doze meses, no lugar dos valores de hoje.</li>
                  <li>As linhas sem Média de Referência ficam como estão.</li>
                </>
              ) : (
                <>
                  <li>Os doze meses de cada linha ficam em branco (mês sem valor; os Dias Úteis voltam aos do calendário).</li>
                  <li>As Médias de Referência ficam: “Replicar Médias” as leva de novo aos meses.</li>
                </>
              )}
              <li>Vale para todas as abas das premissas: {ABAS_DA_PLANILHA}.</li>
              <li>A DRE do cenário se recalcula, e a mudança fica no histórico (tela Histórico, aba Alterações).</li>
            </ul>
          </DialogDescription>
        </DialogHeader>
        {replicar ? null : (
          <p className="rounded-sm border border-l-4 border-gray-200 border-l-red-600 bg-white px-4 py-2 text-sm text-gray-700">
            Os valores digitados nos meses se perdem. Para guardá-los, use antes o “Exportar Premissas”.
          </p>
        )}
        <Erro erro={gravar.isError ? mensagemDeErro(gravar.error, "Não foi possível gravar.") : null} />
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={gravar.isPending} onClick={() => gravar.mutate()}>
            {gravar.isPending ? "Gravando…" : replicar ? "Replicar Médias" : "Apagar Valores"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Os tipos do Exportar Premissas (15/10/2026: os de antes, sem a Aba Atual). */
const TIPOS_DE_EXPORTACAO = [
  { chave: "todas", rotulo: "Todas as Abas", detalhe: "Uma aba por aba da tela; os centros de custo numa aba só." },
  { chave: "centros_abas", rotulo: "Um Centro de Custo por Aba", detalhe: "As abas da tela, com um centro de custo por aba e o Consolidado (a DRE dos centros) na frente." },
  { chave: "centros_arquivos", rotulo: "Um Arquivo por Centro de Custo", detalhe: "Um ZIP com um arquivo por centro de custo (o departamento e o centro no nome) e um com as demais abas." },
] as const;

/**
 * O Exportar Premissas (15/10/2026; antes, uma lista suspensa com a aba atual ou todas): o botão abre o modal, com os
 * departamentos (o arquivo leva só as abas, os centros de custo, a depreciação, os investimentos e os indicadores
 * manuais deles) e o tipo da exportação. Só em Excel.
 */
export function ExportarPremissas({ id }: { id: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Button type="button" className={botaoPrimario} onClick={() => setAberto(true)}>
        <Download className="size-4" />
        Exportar Premissas
      </Button>
      {aberto ? <ExportarPremissasDialog id={id} onFechar={() => setAberto(false)} /> : null}
    </>
  );
}

function ExportarPremissasDialog({ id, onFechar }: { id: string; onFechar: () => void }) {
  const [departamentos, setDepartamentos] = useState<DepartamentoDasPremissas[]>(DEPARTAMENTOS_DAS_PREMISSAS.map((d) => d.chave));
  const [tipo, setTipo] = useState<(typeof TIPOS_DE_EXPORTACAO)[number]["chave"]>("todas");
  const [gerando, setGerando] = useState(false);
  const todos = departamentos.length === DEPARTAMENTOS_DAS_PREMISSAS.length;
  const alternar = (d: DepartamentoDasPremissas) => setDepartamentos((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : DEPARTAMENTOS_DAS_PREMISSAS.map((x) => x.chave).filter((x) => x === d || ds.includes(x))));
  const exportar = async () => {
    setGerando(true);
    try {
      const r = await cenariosService.exportarPremissas(id, tipo, departamentos);
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = nomeDoArquivo(r.headers["content-disposition"] as string | undefined, tipo === "centros_arquivos" ? "Premissas.zip" : "Premissas.xlsx");
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      onFechar();
    } catch (error) {
      toast.error(await mensagemDoErro(error));
    } finally {
      setGerando(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-sm sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Exportar Premissas</DialogTitle>
          <DialogDescription>
            O arquivo em Excel leva só o que é dos departamentos marcados. Logística, Técnico, Comercial, Administrativo e Extra-Operacional levam também a
            depreciação e os investimentos de Despesas e Extra; os indicadores manuais vão pelo grupo deles; a aba Quadro de Lotação, as linhas dos
            centros dos departamentos marcados. Cada linha traz a Média e o Total da Referência, a Variação Máxima e Justificar? (em fórmula).
          </DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="mb-2 flex w-full items-center justify-between text-sm leading-none font-medium">
            Departamentos
            <button type="button" className="text-xs font-normal text-gray-600 underline underline-offset-2 hover:text-gray-900" onClick={() => setDepartamentos(todos ? [] : DEPARTAMENTOS_DAS_PREMISSAS.map((d) => d.chave))}>
              {todos ? "Desmarcar Todos" : "Marcar Todos"}
            </button>
          </legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {DEPARTAMENTOS_DAS_PREMISSAS.map((d) => (
              <label key={d.chave} className="flex cursor-pointer items-start gap-2 rounded-sm border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50">
                <input type="checkbox" className="mt-0.5 accent-black" checked={departamentos.includes(d.chave)} onChange={() => alternar(d.chave)} />
                <span>
                  <span className="font-medium text-gray-900">{d.nome}</span>
                  <span className="block text-xs text-gray-500">{d.detalhe[0].toUpperCase() + d.detalhe.slice(1)}.</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm leading-none font-medium">Tipo da Exportação</legend>
          {TIPOS_DE_EXPORTACAO.map((t) => (
            <OpcaoEmLinha key={t.chave} nome="tipo-exportacao" marcada={tipo === t.chave} onMarcar={() => setTipo(t.chave)} rotulo={t.rotulo} detalhe={t.detalhe} />
          ))}
        </fieldset>
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={!departamentos.length || gerando} onClick={() => void exportar()}>
            {gerando ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {gerando ? "Gerando…" : "Exportar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** O botão Importar Valores (15/10/2026), antes do Exportar Premissas. */
export function BotaoImportarValores({ id }: { id: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Button type="button" className={botaoPrimario} onClick={() => setAberto(true)}>
        <Upload className="size-4" />
        Importar Valores
      </Button>
      {aberto ? <ImportarValoresDialog id={id} onFechar={() => setAberto(false)} /> : null}
    </>
  );
}

type Item = { id: number; nome: string; estado: "analisando" | "pronto" | "erro"; analises: AnaliseDePremissas[]; erro?: string };

/**
 * O Importar Valores (15/10/2026): a lista dos arquivos escolhidos (um ou vários, ou uma pasta), cada um conferido no
 * padrão do Exportar Premissas assim que entra, com o que muda (os valores, as justificativas e os investimentos). Os
 * trechos repetidos entre os arquivos (a mesma unidade, o mesmo centro…; 15/10/2026) aparecem num quadro, e o usuário
 * escolhe, em cada um, ignorar o repetido (vale o primeiro arquivo) ou sobrescrever (vale o último); os investimentos
 * não se conferem: os novos entram na sequência. Grava-se só em "Importar", como nas importações do Fechamento Mensal;
 * a importação fica no histórico (tela Histórico, aba Alterações).
 */
function ImportarValoresDialog({ id, onFechar }: { id: string; onFechar: () => void }) {
  const queryClient = useQueryClient();
  const [itens, setItens] = useState<Item[]>([]);
  const proximo = useRef(1);
  const arquivo = useRef<HTMLInputElement>(null);
  const pasta = useRef<HTMLInputElement>(null);
  const adicionar = (lista: FileList | null) => {
    const arquivos = [...(lista ?? [])].filter((f) => /\.(xlsx|zip)$/i.test(f.name) && !f.name.startsWith("~$"));
    if (lista && lista.length && !arquivos.length) toast.error("Nenhum arquivo .xlsx ou .zip na escolha.");
    for (const f of arquivos) {
      const n = proximo.current++;
      const nome = f.webkitRelativePath || f.name;
      setItens((xs) => [...xs, { id: n, nome, estado: "analisando", analises: [] }]);
      cenariosService
        .analisarPremissas(id, f)
        .then((analises) => setItens((xs) => xs.map((x) => (x.id === n ? { ...x, estado: "pronto", analises } : x))))
        .catch((e) => setItens((xs) => xs.map((x) => (x.id === n ? { ...x, estado: "erro", erro: mensagemDeErro(e, "Não foi possível ler o arquivo.") } : x))));
    }
  };
  const analises = itens.flatMap((x) => x.analises);
  const validas = analises.filter((a) => a.valido);
  // Os trechos repetidos entre as planilhas válidas, na ordem da lista, e a escolha de cada um (sobrescrever, de início).
  const repetidos = [...new Set(validas.flatMap((a) => a.blocos))]
    .map((bloco) => ({ bloco, em: validas.flatMap((a, i) => (a.blocos.includes(bloco) ? [i] : [])) }))
    .filter((r) => r.em.length > 1);
  const [ignorar, setIgnorar] = useState<Set<string>>(() => new Set());
  const vencedor = new Map(repetidos.map((r) => [r.bloco, ignorar.has(r.bloco) ? r.em[0] : r.em[r.em.length - 1]]));
  const doVencedor = (i: number) => (x: { bloco: string }) => !vencedor.has(x.bloco) || vencedor.get(x.bloco) === i;
  const aImportar = validas.map((a, i) => ({ ...a, alteracoes: a.alteracoes.filter(doVencedor(i)), justificativas: a.justificativas.filter(doVencedor(i)) }));
  const valores = aImportar.reduce((s, a) => s + a.alteracoes.length, 0);
  const justificativas = aImportar.reduce((s, a) => s + a.justificativas.length, 0);
  const investimentos = aImportar.reduce((s, a) => s + a.investimentos.novos.length + a.investimentos.alterados.length, 0);
  // As linhas do Quadro de Lotação (09/11/2026): as novas e as alteradas.
  const doQuadro = aImportar.reduce((s, a) => s + a.quadro.novas.length + a.quadro.alteradas.length, 0);
  const analisando = itens.some((x) => x.estado === "analisando");
  const importar = useMutation({
    mutationFn: () => cenariosService.importarPremissas(id, aImportar),
    onSuccess: (r) => {
      invalidar(queryClient);
      const inv = r.investimentosNovos + r.investimentosAlterados;
      const ql = r.quadroNovas + r.quadroAlteradas;
      toast.success(
        `${r.valores} ${plural(r.valores, "valor importado", "valores importados")}, ${r.justificativas} ${plural(r.justificativas, "justificativa", "justificativas")}${inv ? `, ${r.investimentosNovos} ${plural(r.investimentosNovos, "investimento novo", "investimentos novos")} e ${r.investimentosAlterados} ${plural(r.investimentosAlterados, "alterado", "alterados")}` : ""}${ql ? `, ${r.quadroNovas} ${plural(r.quadroNovas, "linha nova", "linhas novas")} e ${r.quadroAlteradas} ${plural(r.quadroAlteradas, "alterada", "alteradas")} no Quadro de Lotação` : ""}; a DRE do cenário foi recalculada.`,
      );
      onFechar();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent avisoAoSair={itens.length > 0} className="flex max-h-[90vh] flex-col rounded-sm sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Importar Valores</DialogTitle>
          <DialogDescription>
            Escolha os arquivos (ou uma pasta) gerados pelo Exportar Premissas: planilhas .xlsx ou o .zip de um arquivo por centro. Cada arquivo é
            conferido assim que entra na lista; os valores mensais, as justificativas e os investimentos se gravam só em “Importar” (em branco, o mês
            fica sem valor). A Média e o Total da Referência, a Variação Máxima e Justificar? não se importam. Na aba Investimentos, os com o Nome de
            Referência de um investimento do cenário são atualizados e os de nome novo entram na sequência dos que já existem. Na aba Quadro de
            Lotação, as linhas com o Código da Linha são atualizadas e as sem código entram como novas; um cadastro que não existe recusa o arquivo.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={arquivo} type="file" accept=".xlsx,.zip" multiple className="hidden" onChange={(e) => (adicionar(e.target.files), (e.target.value = ""))} />
          <input
            ref={(el) => {
              pasta.current = el;
              el?.setAttribute("webkitdirectory", "");
            }}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => (adicionar(e.target.files), (e.target.value = ""))}
          />
          <Button type="button" variant="outline" className="rounded-sm" onClick={() => arquivo.current?.click()}>
            <FileUp className="size-4" />
            Escolher Arquivos
          </Button>
          <Button type="button" variant="outline" className="rounded-sm" onClick={() => pasta.current?.click()}>
            <FolderUp className="size-4" />
            Escolher Pasta
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-sm border border-gray-200">
          <table className="tabela-sig w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="px-3 py-2 text-left text-xs font-bold">Arquivo</th>
                <th className="px-3 py-2 text-left text-xs font-bold">Situação</th>
                <th className="px-3 py-2 text-right text-xs font-bold">Linhas</th>
                <th className="px-3 py-2 text-right text-xs font-bold">Valores</th>
                <th className="px-3 py-2 text-right text-xs font-bold">Justificativas</th>
                <th className="px-3 py-2 text-right text-xs font-bold">Investimentos</th>
                <th className="px-3 py-2 text-right text-xs font-bold">Quadro de Lotação</th>
                <th className="w-10 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {itens.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-gray-500">
                    Nenhum arquivo escolhido.
                  </td>
                </tr>
              ) : null}
              {itens.flatMap((x) => {
                const remover = (
                  <button type="button" title="Tirar da lista" aria-label={`Tirar ${x.nome} da lista`} className="rounded-sm p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900" onClick={() => setItens((xs) => xs.filter((y) => y.id !== x.id))}>
                    <X className="size-4" />
                  </button>
                );
                if (x.estado !== "pronto")
                  return [
                    <tr key={x.id} className="border-b border-gray-100">
                      <td className="px-3 py-2 break-all text-gray-900">{x.nome}</td>
                      <td colSpan={6} className={`px-3 py-2 ${x.estado === "erro" ? "text-red-700" : "text-gray-500"}`}>
                        {x.estado === "erro" ? x.erro : "Conferindo…"}
                      </td>
                      <td className="px-2 py-2 text-right">{remover}</td>
                    </tr>,
                  ];
                return x.analises.map((a, k) => (
                  <tr key={`${x.id}-${k}`} className="border-b border-gray-100 align-top">
                    <td className="px-3 py-2 break-all text-gray-900">
                      {a.arquivo}
                      {[...a.erros.map((e) => ({ e, erro: true })), ...a.avisos.map((e) => ({ e, erro: false }))].map(({ e, erro }) => (
                        <p key={e} className={`mt-1 text-xs ${erro ? "text-red-700" : "text-gray-500"}`}>
                          {e}
                        </p>
                      ))}
                    </td>
                    <td className={`px-3 py-2 whitespace-nowrap ${a.valido ? "text-green-700" : "text-red-700"}`}>{a.valido ? "No padrão" : "Fora do padrão"}</td>
                    <td className="px-3 py-2 text-right">{a.linhas.toLocaleString("pt-BR")}</td>
                    <td className="px-3 py-2 text-right">{a.valido ? a.alteracoes.length.toLocaleString("pt-BR") : "—"}</td>
                    <td className="px-3 py-2 text-right">{a.valido ? a.justificativas.length.toLocaleString("pt-BR") : "—"}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {!a.valido
                        ? "—"
                        : a.investimentos.novos.length + a.investimentos.alterados.length
                          ? `${a.investimentos.novos.length} ${plural(a.investimentos.novos.length, "novo", "novos")} · ${a.investimentos.alterados.length} ${plural(a.investimentos.alterados.length, "alterado", "alterados")}`
                          : "0"}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {!a.valido
                        ? "—"
                        : a.quadro.novas.length + a.quadro.alteradas.length
                          ? `${a.quadro.novas.length} ${plural(a.quadro.novas.length, "nova", "novas")} · ${a.quadro.alteradas.length} ${plural(a.quadro.alteradas.length, "alterada", "alteradas")}`
                          : "0"}
                    </td>
                    <td className="px-2 py-2 text-right">{k === 0 ? remover : null}</td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
        {repetidos.length ? (
          <div className="max-h-56 shrink-0 space-y-2 overflow-y-auto rounded-sm border border-l-4 border-gray-200 border-l-red-600 bg-white px-4 py-3">
            <p className="text-sm text-gray-700">
              {plural(repetidos.length, "Um trecho aparece", `${repetidos.length} trechos aparecem`)} em mais de um arquivo. Em cada um, escolha:
              Ignorar (vale o primeiro arquivo da lista) ou Sobrescrever (vale o último).
            </p>
            <div className="flex justify-end gap-3 text-xs">
              <button type="button" className="text-gray-600 underline underline-offset-2 hover:text-gray-900" onClick={() => setIgnorar(new Set(repetidos.map((r) => r.bloco)))}>
                Ignorar Todos
              </button>
              <button type="button" className="text-gray-600 underline underline-offset-2 hover:text-gray-900" onClick={() => setIgnorar(new Set())}>
                Sobrescrever Todos
              </button>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {repetidos.map((r) => (
                  <tr key={r.bloco} className="border-t border-gray-100 align-top">
                    <td className="py-1.5 pr-3 font-medium text-gray-900">{r.bloco}</td>
                    <td className="py-1.5 pr-3 text-xs text-gray-600">{r.em.map((i) => validas[i].arquivo).join("; ")}</td>
                    <td className="py-1.5 whitespace-nowrap">
                      {(
                        [
                          [true, "Ignorar"],
                          [false, "Sobrescrever"],
                        ] as const
                      ).map(([ig, rotulo]) => (
                        <label key={rotulo} className="mr-3 inline-flex cursor-pointer items-center gap-1.5 text-xs text-gray-800">
                          <input
                            type="radio"
                            name={`repetido-${r.bloco}`}
                            className="accent-black"
                            checked={ignorar.has(r.bloco) === ig}
                            onChange={() =>
                              setIgnorar((atual) => {
                                const novo = new Set(atual);
                                if (ig) novo.add(r.bloco);
                                else novo.delete(r.bloco);
                                return novo;
                              })
                            }
                          />
                          {rotulo}
                        </label>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <Erro erro={importar.isError ? mensagemDeErro(importar.error, "Não foi possível importar.") : null} />
        <DialogFooter className="items-center">
          <span className="text-xs text-gray-600 sm:mr-auto">
            {validas.length} {plural(validas.length, "planilha no padrão", "planilhas no padrão")}: {valores.toLocaleString("pt-BR")} {plural(valores, "valor muda", "valores mudam")},{" "}
            {justificativas} {plural(justificativas, "justificativa", "justificativas")}, {investimentos} {plural(investimentos, "investimento", "investimentos")} e {doQuadro}{" "}
            {plural(doQuadro, "linha do Quadro de Lotação", "linhas do Quadro de Lotação")}.
          </span>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={analisando || importar.isPending || valores + justificativas + investimentos + doQuadro === 0} onClick={() => importar.mutate()}>
            {importar.isPending ? "Importando…" : "Importar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
