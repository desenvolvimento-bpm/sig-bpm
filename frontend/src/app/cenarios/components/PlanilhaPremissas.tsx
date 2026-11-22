"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyCheck, Download, Eraser, FileUp, FolderUp, ListChecks, ListX, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { plural } from "@/lib/texto";
import { usePermissions } from "@/context/PermissionContext";
import { useAcessibilidade } from "@/lib/acessibilidade";

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

/** As abas da planilha das premissas (todas menos os Reajustes, que não têm meses digitados), pela chave da permissão. */
const ABAS_DA_PERMISSAO = ["matriz", "filial", "servicos", "quadro", "centros", "rateios", "investimentos", "extra", "manuais"];
/** O perfil edita todas as abas das premissas: o que Replicar Médias e Apagar Valores pedem (o servidor confere também). */
export function useEditaTodasAsAbas() {
  const { hasPermission } = usePermissions();
  return ABAS_DA_PERMISSAO.every((a) => hasPermission(`cenarios_analiticos_premissas.${a}:editar`));
}

/**
 * Os botões Replicar Médias e Apagar Valores (15/10/2026; antes, um botão só, Replicar Médias / Apagar Valores, com a
 * escolha no modal; desde 12/11/2026, pedido do Adão, em Configurações / Referência, logo depois do Realocar — antes, na
 * altura do título das Premissas): em todas as abas, replica a Média de Referência de cada linha nos doze meses, ou deixa
 * os meses em branco. Cada um abre o modal dele, que confirma antes de gravar.
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
      // Nada a mudar (22/11/2026): o servidor não grava, e a DRE não fica pendente.
      toast.success(
        !r.linhas
          ? replicar
            ? "Nada a replicar: os meses já estavam iguais às Médias de Referência."
            : "Nada a apagar: os meses já estavam em branco."
          : replicar
            ? `Médias replicadas em ${r.linhas} ${plural(r.linhas, "linha", "linhas")} (${r.valores} ${plural(r.valores, "valor", "valores")}); a DRE fica pendente de recálculo (Resultados / Recalcular).`
            : `Valores apagados em ${r.linhas} ${plural(r.linhas, "linha", "linhas")}; a DRE fica pendente de recálculo (Resultados / Recalcular).`,
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
                  <li>
                    Nos Centros de Custo, também as Remunerações CLT e PJ (MOD e MOI) dos grupos sem linhas no Quadro de Lotação; nos com linhas,
                    elas continuam calculadas por ele.
                  </li>
                  <li>As linhas sem Média de Referência ficam como estão.</li>
                </>
              ) : (
                <>
                  <li>Os doze meses de cada linha ficam em branco (mês sem valor; os Dias Úteis voltam aos do calendário).</li>
                  <li>As Médias de Referência ficam: “Replicar Médias” as leva de novo aos meses.</li>
                </>
              )}
              <li>Vale para todas as abas das premissas: {ABAS_DA_PLANILHA}.</li>
              <li>A DRE do cenário fica pendente de recálculo (Resultados / Recalcular), e a mudança fica no histórico (tela Histórico, aba Alterações).</li>
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
  // Com o Acesso às Informações Por Recorte (12/11/2026): o Gestor marca só os departamentos dele; o Coordenador não marca (o
  // arquivo leva os grupos de centros dele).
  const cenario = useQuery({ queryKey: ["cenarios", id], queryFn: () => cenariosService.obter(id) });
  const recorte = cenario.data?.recorte ?? null;
  const disponiveis = recorte ? DEPARTAMENTOS_DAS_PREMISSAS.filter((d) => !recorte.porCentro && recorte.departamentos.includes(d.chave)) : DEPARTAMENTOS_DAS_PREMISSAS;
  const marcados = recorte?.porCentro ? DEPARTAMENTOS_DAS_PREMISSAS.map((d) => d.chave) : departamentos.filter((d) => disponiveis.some((x) => x.chave === d));
  const todos = disponiveis.every((d) => departamentos.includes(d.chave));
  const alternar = (d: DepartamentoDasPremissas) => setDepartamentos((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : DEPARTAMENTOS_DAS_PREMISSAS.map((x) => x.chave).filter((x) => x === d || ds.includes(x))));
  const exportar = async () => {
    setGerando(true);
    try {
      const r = await cenariosService.exportarPremissas(id, tipo, marcados);
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
            depreciação de Despesas e Extra; os indicadores manuais vão pelo grupo deles; a aba Quadro de Lotação, as linhas dos centros dos
            departamentos marcados. A aba Investimentos leva todos os investimentos do cenário: importada, ela substitui os seus (os seus que não
            estiverem nela saem). Cada linha traz a Média e o Total da Referência, a Variação Máxima e Justificar? (em fórmula).
          </DialogDescription>
        </DialogHeader>
        {recorte?.porCentro ? (
          <p className="rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-2 text-sm text-gray-600">
            Acesso Por Recorte: o arquivo leva os grupos de centros de custo com algum centro seu (os Centros de Custo e o Quadro de Lotação deles).
          </p>
        ) : (
        <fieldset className="space-y-2">
          <legend className="mb-2 flex w-full items-center justify-between text-sm leading-none font-medium">
            Departamentos
            <button type="button" className="text-xs font-normal text-gray-600 underline underline-offset-2 hover:text-gray-900" onClick={() => setDepartamentos(todos ? [] : disponiveis.map((d) => d.chave))}>
              {todos ? "Desmarcar Todos" : "Marcar Todos"}
            </button>
          </legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {disponiveis.map((d) => (
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
        )}
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
          <Button type="button" className={botaoPrimario} disabled={!marcados.length || gerando} onClick={() => void exportar()}>
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
/** O trecho da aba Investimentos (19/11/2026; o mesmo nome do servidor): em dois arquivos com ela, vale o escolhido. */
const BLOCO_DOS_INVESTIMENTOS = "Investimentos (a lista)";

/**
 * As colunas da tabela do Importar Valores (20/11/2026, pedido do Adão): o que cada arquivo sobrescreve. Produção e Serviços
 * (as abas Matriz, Filial e Serviços), Centros de Custo (os gastos e o Quadro de Lotação de cada grupo) e, desde o mesmo dia,
 * Indicadores Manuais (cada indicador) listam os itens, cada um com a caixa dele; as outras têm uma caixa só (Sobrescrever). A
 * caixa desmarcada deixa o item de fora da importação.
 */
type ColunaDaImportacao = "producao" | "centros" | "investimentos" | "extra" | "manuais";
const COLUNAS_DA_IMPORTACAO: Array<{ chave: ColunaDaImportacao; titulo: string; largura: string }> = [
  { chave: "producao", titulo: "Produção e Serviços", largura: "w-[220px]" },
  { chave: "centros", titulo: "Centros de Custo", largura: "w-[220px]" },
  { chave: "investimentos", titulo: "Investimentos", largura: "w-[120px]" },
  { chave: "extra", titulo: "Extra-Operacional", largura: "w-[136px]" },
  { chave: "manuais", titulo: "Indicadores Manuais", largura: "w-[180px]" },
];
/** As colunas com a lista dos itens (as demais têm uma caixa só). */
const EM_LISTA = new Set<ColunaDaImportacao>(["producao", "centros", "manuais"]);
/** A coluna de uma linha da planilha, pelo tipo do Código: P (Matriz, Filial e Serviços), C, L e E (Centros de Custo), B (a Depreciação Base, com os Investimentos), X e I. */
function colunaDaChave(chave: string): ColunaDaImportacao | null {
  const tipo = chave.split("|")[0];
  if (tipo === "P") return "producao";
  if (tipo === "C" || tipo === "L" || tipo === "E") return "centros";
  if (tipo === "B") return "investimentos";
  if (tipo === "X") return "extra";
  if (tipo === "I") return "manuais";
  return null;
}
/** A chave da caixa de um item: a planilha, a coluna e o item (vazio nas colunas de uma caixa só). */
const chaveDaCaixa = (planilha: string, coluna: ColunaDaImportacao, item: string) => `${planilha}|${coluna}|${EM_LISTA.has(coluna) ? item : ""}`;

/**
 * Os itens de cada coluna de uma planilha, na ordem do arquivo, e se algum trecho deles vale (`vence`; o trecho repetido em
 * outro arquivo pode valer o de lá). Sem item, a coluna mostra Sem Alteração.
 */
function itensDaPlanilha(a: AnaliseDePremissas, vence: (x: { bloco: string }) => boolean) {
  const r = new Map<ColunaDaImportacao, Map<string, boolean>>(COLUNAS_DA_IMPORTACAO.map((c) => [c.chave, new Map()]));
  const incluir = (coluna: ColunaDaImportacao | null, item: string, bloco: string) => {
    if (!coluna) return;
    const doItem = r.get(coluna)!;
    const chave = EM_LISTA.has(coluna) ? item : "";
    doItem.set(chave, (doItem.get(chave) ?? false) || vence({ bloco }));
  };
  for (const x of [...a.alteracoes, ...a.justificativas]) incluir(colunaDaChave(x.chave), x.item, x.bloco);
  for (const l of [...a.quadro.novas, ...a.quadro.alteradas, ...a.quadro.excluidas]) incluir("centros", l.centro, l.bloco);
  if (a.investimentos.novos.length + a.investimentos.alterados.length + a.investimentos.excluidos.length) incluir("investimentos", "", BLOCO_DOS_INVESTIMENTOS);
  return r;
}

/** A situação do arquivo (20/11/2026): Válido (verde; azul na Acessibilidade Daltonismo) ou Inválido (vermelho). */
function EtiquetaDoArquivo({ valido }: { valido: boolean }) {
  const [acessibilidade] = useAcessibilidade();
  const cor = !valido ? "border-red-300 bg-red-50 text-red-800" : acessibilidade === "daltonismo" ? "border-blue-300 bg-blue-50 text-blue-800" : "border-green-300 bg-green-50 text-green-800";
  return <span className={`inline-flex rounded-sm border px-1.5 py-px text-xs font-medium whitespace-nowrap ${cor}`}>{valido ? "Válido" : "Inválido"}</span>;
}

/**
 * O Importar Valores (15/10/2026): a lista dos arquivos escolhidos (um ou vários, ou uma pasta), cada um conferido no
 * padrão do Exportar Premissas assim que entra, com o que ele sobrescreve em cada coluna (20/11/2026, pedido do Adão: as
 * linhas de produto das abas Matriz, Filial e Serviços, os centros de custo e os indicadores manuais um abaixo do outro, cada um
 * com a caixa dele, e Sobrescrever nos Investimentos e no Extra-Operacional; a caixa desmarcada não importa). Os
 * trechos repetidos entre os arquivos (a mesma unidade, o mesmo centro…; 15/10/2026) aparecem num quadro, e o usuário
 * escolhe, em cada um, ignorar o repetido (vale o primeiro arquivo) ou sobrescrever (vale o último). Grava-se só em
 * "Importar", como nas importações do Fechamento Mensal; a importação fica no histórico (tela Histórico, aba Alterações).
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
  // Cada planilha com a chave dela (o arquivo e a posição no .zip), a das caixas desmarcadas.
  const planilhas = itens.flatMap((x) => x.analises.map((a, k) => ({ a, chave: `${x.id}-${k}` })));
  const validas = planilhas.filter((p) => p.a.valido);
  const indiceDaValida = new Map(validas.map((p, i) => [p.chave, i]));
  // Os trechos repetidos entre as planilhas válidas, na ordem da lista, e a escolha de cada um (sobrescrever, de início).
  const repetidos = [...new Set(validas.flatMap(({ a }) => a.blocos))]
    .map((bloco) => ({ bloco, em: validas.flatMap(({ a }, i) => (a.blocos.includes(bloco) ? [i] : [])) }))
    .filter((r) => r.em.length > 1);
  const [ignorar, setIgnorar] = useState<Set<string>>(() => new Set());
  const vencedor = new Map(repetidos.map((r) => [r.bloco, ignorar.has(r.bloco) ? r.em[0] : r.em[r.em.length - 1]]));
  const doVencedor = (i: number) => (x: { bloco: string }) => !vencedor.has(x.bloco) || vencedor.get(x.bloco) === i;
  // As caixas desmarcadas na tabela (20/11/2026): de início, todas marcadas.
  const [desmarcadas, setDesmarcadas] = useState<Set<string>>(() => new Set());
  const alternar = (caixa: string) =>
    setDesmarcadas((atual) => {
      const nova = new Set(atual);
      if (nova.has(caixa)) nova.delete(caixa);
      else nova.add(caixa);
      return nova;
    });
  const marcada = (planilha: string, coluna: ColunaDaImportacao, item: string) => !desmarcadas.has(chaveDaCaixa(planilha, coluna, item));
  // O Quadro de Lotação que substitui as linhas (11/11/2026) tem um trecho por departamento (20/11/2026): em dois arquivos com o
  // mesmo, vale o do arquivo escolhido. A aba Investimentos é um trecho (19/11/2026: ela substitui os investimentos de quem
  // importa). Os itens desmarcados ficam de fora.
  const semInvestimentos = { novos: [], alterados: [], excluidos: [], nomes: null };
  const aImportar = validas.map(({ a, chave }, i) => {
    const vence = doVencedor(i);
    const entra = (x: { chave: string; bloco: string; item: string }) => {
      const coluna = colunaDaChave(x.chave);
      return vence(x) && (!coluna || marcada(chave, coluna, x.item));
    };
    const doCentro = (l: { centro: string; bloco: string }) => vence(l) && marcada(chave, "centros", l.centro);
    return {
      ...a,
      alteracoes: a.alteracoes.filter(entra),
      justificativas: a.justificativas.filter(entra),
      investimentos: vence({ bloco: BLOCO_DOS_INVESTIMENTOS }) && marcada(chave, "investimentos", "") ? a.investimentos : semInvestimentos,
      quadro: { novas: a.quadro.novas.filter(doCentro), alteradas: a.quadro.alteradas.filter(doCentro), excluidas: a.quadro.excluidas.filter(doCentro) },
    };
  });
  const valores = aImportar.reduce((s, a) => s + a.alteracoes.length, 0);
  const justificativas = aImportar.reduce((s, a) => s + a.justificativas.length, 0);
  const investimentos = aImportar.reduce((s, a) => s + a.investimentos.novos.length + a.investimentos.alterados.length + a.investimentos.excluidos.length, 0);
  // As linhas do Quadro de Lotação (09/11/2026): as novas, as alteradas e (11/11/2026) as que saem.
  const doQuadro = aImportar.reduce((s, a) => s + a.quadro.novas.length + a.quadro.alteradas.length + a.quadro.excluidas.length, 0);
  const analisando = itens.some((x) => x.estado === "analisando");
  const importar = useMutation({
    mutationFn: () => cenariosService.importarPremissas(id, aImportar),
    onSuccess: (r) => {
      invalidar(queryClient);
      const inv = r.investimentosNovos + r.investimentosAlterados + r.investimentosExcluidos;
      const ql = r.quadroNovas + r.quadroAlteradas + r.quadroExcluidas;
      toast.success(
        `${r.valores} ${plural(r.valores, "valor importado", "valores importados")}, ${r.justificativas} ${plural(r.justificativas, "justificativa", "justificativas")}${inv ? `, ${r.investimentosNovos} ${plural(r.investimentosNovos, "investimento novo", "investimentos novos")}, ${r.investimentosAlterados} ${plural(r.investimentosAlterados, "alterado", "alterados")} e ${r.investimentosExcluidos} ${plural(r.investimentosExcluidos, "excluído", "excluídos")}` : ""}${ql ? `, ${r.quadroNovas} ${plural(r.quadroNovas, "linha nova", "linhas novas")}, ${r.quadroAlteradas} ${plural(r.quadroAlteradas, "alterada", "alteradas")} e ${r.quadroExcluidas} ${plural(r.quadroExcluidas, "excluída", "excluídas")} no Quadro de Lotação` : ""}; a DRE fica pendente de recálculo (Resultados / Recalcular).`,
      );
      onFechar();
    },
  });
  // Os itens de cada planilha válida, por coluna.
  const itensPorPlanilha = new Map(validas.map(({ a, chave }, i) => [chave, itensDaPlanilha(a, doVencedor(i))]));
  // A quantia e o Marcar Todos / Desmarcar Todos de cada coluna com lista (20/11/2026, pedido do Adão: na altura dos botões
  // Escolher Arquivos e Escolher Pasta, à direita; antes, no alto de cada célula), com os itens de todas as planilhas válidas: a
  // quantia conta os nomes (o mesmo centro em dois arquivos conta uma vez) e os marcados; os botões mudam só as caixas que valem
  // (as de um trecho que vale o de outro arquivo ficam como estão).
  const resumos = (["producao", "centros", "manuais"] as const).map((coluna) => {
    const caixas = validas.flatMap(({ chave }) => [...itensPorPlanilha.get(chave)!.get(coluna)!].map(([item, vence]) => ({ item, vence, caixa: chaveDaCaixa(chave, coluna, item) })));
    const ativas = caixas.filter((c) => c.vence);
    return {
      coluna,
      total: new Set(caixas.map((c) => c.item)).size,
      marcados: new Set(ativas.filter((c) => !desmarcadas.has(c.caixa)).map((c) => c.item)).size,
      ativas: ativas.map((c) => c.caixa),
      todas: ativas.every((c) => !desmarcadas.has(c.caixa)),
      nome: coluna === "producao" ? (["Linha", "Linhas"] as const) : coluna === "centros" ? (["Centro de Custo", "Centros de Custo"] as const) : (["Indicador", "Indicadores"] as const),
    };
  });
  const marcarTodas = (ativas: string[], todas: boolean) =>
    setDesmarcadas((atual) => {
      const nova = new Set(atual);
      for (const k of ativas) {
        if (todas) nova.add(k);
        else nova.delete(k);
      }
      return nova;
    });
  // A célula de uma coluna de uma planilha válida: Sem Alteração, a caixa Sobrescrever ou a lista dos itens.
  const celula = (planilha: string, coluna: ColunaDaImportacao, doItem: Map<string, boolean>) => {
    if (!doItem.size) return <span className="text-gray-500">Sem Alteração</span>;
    const caixa = (item: string, vence: boolean, rotulo: string) => {
      const chave = chaveDaCaixa(planilha, coluna, item);
      return (
        <label
          key={chave}
          title={vence ? undefined : "Vale o mesmo trecho de outro arquivo (veja os trechos repetidos, abaixo da tabela)."}
          className={`flex items-start gap-1.5 text-xs ${vence ? "cursor-pointer text-gray-800" : "cursor-not-allowed text-gray-400"}`}
        >
          <input type="checkbox" className="mt-0.5 shrink-0 accent-black" disabled={!vence} checked={vence && !desmarcadas.has(chave)} onChange={() => alternar(chave)} />
          <span className="min-w-0 break-words">{rotulo}</span>
        </label>
      );
    };
    const lista = [...doItem];
    if (!EM_LISTA.has(coluna)) return caixa("", lista[0][1], "Sobrescrever");
    return <div className="space-y-1">{lista.map(([item, vence]) => caixa(item, vence, item))}</div>;
  };
  const traco = COLUNAS_DA_IMPORTACAO.map((c) => (
    <td key={c.chave} className="px-3 py-2 text-gray-400">
      —
    </td>
  ));
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent avisoAoSair={itens.length > 0} className="flex max-h-[90vh] flex-col rounded-sm sm:max-w-[1360px]">
        <DialogHeader>
          <DialogTitle>Importar Valores</DialogTitle>
          <DialogDescription>Escolha os arquivos .XLSX (ou uma pasta) gerados pelo Exportar Premissas.</DialogDescription>
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
          <div className="ml-auto flex flex-wrap items-center justify-end gap-x-5 gap-y-2">
            {resumos.map((r) =>
              r.total ? (
                <div key={r.coluna} className="flex items-center gap-2">
                  <span className="text-sm whitespace-nowrap text-gray-700">
                    {r.marcados === r.total ? r.total : `${r.marcados} de ${r.total}`} {plural(r.total, r.nome[0], r.nome[1])}
                  </span>
                  {r.ativas.length > 1 ? (
                    <Button type="button" variant="outline" className="rounded-sm" onClick={() => marcarTodas(r.ativas, r.todas)}>
                      {r.todas ? <ListX className="size-4" /> : <ListChecks className="size-4" />}
                      {r.todas ? "Desmarcar Todos" : "Marcar Todos"}
                    </Button>
                  ) : null}
                </div>
              ) : null,
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-sm border border-gray-200">
          <table className="tabela-sig w-full min-w-[1328px] table-fixed border-collapse text-sm">
            <colgroup>
              <col className="w-[316px]" />
              <col className="w-24" />
              {COLUNAS_DA_IMPORTACAO.map((c) => (
                <col key={c.chave} className={c.largura} />
              ))}
              <col className="w-10" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-white">
              <tr className="border-b border-gray-200">
                <th className="px-3 py-2 text-left text-xs font-bold">Arquivo</th>
                <th className="px-3 py-2 text-left text-xs font-bold">Situação</th>
                {COLUNAS_DA_IMPORTACAO.map((c) => (
                  <th key={c.chave} className="px-3 py-2 text-left text-xs font-bold">
                    {c.titulo}
                  </th>
                ))}
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {itens.length === 0 ? (
                <tr>
                  <td colSpan={COLUNAS_DA_IMPORTACAO.length + 3} className="px-3 py-6 text-center text-gray-500">
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
                if (x.estado === "analisando")
                  return [
                    <tr key={x.id} className="border-b border-gray-100">
                      <td className="px-3 py-2 break-words text-gray-900">{x.nome}</td>
                      <td colSpan={COLUNAS_DA_IMPORTACAO.length + 1} className="px-3 py-2 text-gray-500">
                        Conferindo…
                      </td>
                      <td className="px-2 py-2 text-right">{remover}</td>
                    </tr>,
                  ];
                if (x.estado === "erro")
                  return [
                    <tr key={x.id} className="border-b border-gray-100 align-top">
                      <td className="px-3 py-2 break-words text-gray-900">
                        {x.nome}
                        <p className="mt-1 text-xs text-red-700">{x.erro}</p>
                      </td>
                      <td className="px-3 py-2">
                        <EtiquetaDoArquivo valido={false} />
                      </td>
                      {traco}
                      <td className="px-2 py-2 text-right">{remover}</td>
                    </tr>,
                  ];
                return x.analises.map((a, k) => {
                  const planilha = `${x.id}-${k}`;
                  const i = indiceDaValida.get(planilha);
                  const colunas = i === undefined ? null : itensPorPlanilha.get(planilha)!;
                  return (
                    <tr key={planilha} className="border-b border-gray-100 align-top">
                      <td className="px-3 py-2 break-words text-gray-900">
                        {a.arquivo}
                        {[...a.erros.map((e) => ({ e, erro: true })), ...a.avisos.map((e) => ({ e, erro: false }))].map(({ e, erro }) => (
                          <p key={e} className={`mt-1 text-xs ${erro ? "text-red-700" : "text-gray-500"}`}>
                            {e}
                          </p>
                        ))}
                      </td>
                      <td className="px-3 py-2">
                        <EtiquetaDoArquivo valido={a.valido} />
                      </td>
                      {colunas
                        ? COLUNAS_DA_IMPORTACAO.map((c) => (
                            <td key={c.chave} className="px-3 py-2">
                              {celula(planilha, c.chave, colunas.get(c.chave)!)}
                            </td>
                          ))
                        : traco}
                      <td className="px-2 py-2 text-right">{k === 0 ? remover : null}</td>
                    </tr>
                  );
                });
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
                    <td className="py-1.5 pr-3 text-xs text-gray-600">{r.em.map((i) => validas[i].a.arquivo).join("; ")}</td>
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
            {validas.length} {plural(validas.length, "planilha válida", "planilhas válidas")}: {valores.toLocaleString("pt-BR")} {plural(valores, "valor muda", "valores mudam")},{" "}
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
