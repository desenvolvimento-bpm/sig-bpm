"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmacaoDialog } from "@/components/shared/ConfirmacaoDialog";
import { type ColunaExportavel, ExportarTabela } from "@/components/shared/ExportarTabela";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAlteracoesPendentes } from "@/lib/alteracoesPendentes";
import { plural } from "@/lib/texto";

import { Agrupador, fundoDaLinha, SeletorNivel, useNiveisDRE } from "@/app/competencias/[anoMes]/dre/components/NiveisDRE";
import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";

import { cenariosService, type IndiceDosReajustes, type ReajustesDasPremissas } from "../services/cenariosService";
import { botaoPrimario, Erro } from "./CenarioDialog";
import { Caixa } from "./ComparativoCenario";
import { lerNumero } from "./EdicaoDialogs";

/** O percentual no campo: duas casas, sem separador de milhar (fácil de editar), como nos Índices de Referência. */
const duasCasas = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
const QUADRO = "space-y-4 rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white p-5";
const TITULO = "text-sm font-bold text-gray-900";
/** Os reajustes de cada índice: até quatro, cada um sobre os anteriores. */
const GRUPOS = [0, 1, 2, 3];
const ORDINAL = ["1º", "2º", "3º", "4º"];
/** A altura da linha dos grupos (1º Reajuste…) no cabeçalho: a de baixo (Valor e Inicia Em) fica logo abaixo dela. */
const ALTURA_DOS_GRUPOS = 30;

type Meses = ReajustesDasPremissas["meses"];
const rotuloDoMes = (meses: Meses, mes: number) => meses.find((m) => m.mes === mes)?.rotulo ?? String(mes);
/** O índice nas listas: a descrição e os reajustes ("IPCA (4,00% em JAN/27, 2,00% em ABR/27)"). */
const rotuloDoIndice = (i: IndiceDosReajustes, meses: Meses) =>
  `${i.descricao} (${i.reajustes.map((r) => `${duasCasas(Number(r.valor))}% em ${rotuloDoMes(meses, r.mes)}`).join(", ")})`;

/**
 * A aba Reajustes das Premissas dos cenários analíticos (11/11/2026, pedido do Adão): a cópia da aba Comparativo das
 * Configurações, sem o Cenário Comparado. Em cima, os Índices de Reajuste — cada um com até quatro reajustes, o Valor (%) e o
 * mês em que Inicia Em, cada um sobre os anteriores —; embaixo, a Aplicação dos Reajustes, o índice de cada conta da DRE.
 * Os reajustes entram na DRE pelo botão do quadro de baixo, depois de “Gravar Aplicação”: “Aplicar Reajustes” ou, com eles
 * aplicados, “Remover Reajustes” (nunca duas vezes seguidas). Com eles aplicados, gravar um quadro recalcula a DRE, o
 * Recalcular dos Resultados os mantém, e as demais abas das Premissas (menos os Indicadores Manuais) e a referência ficam
 * bloqueadas para edição até “Remover Reajustes”.
 */
export function ReajustesDoCenario({ id, podeEditar }: { id: string; podeEditar: boolean }) {
  const consulta = useQuery({ queryKey: ["cenarios", id, "reajustesDasPremissas"], queryFn: () => cenariosService.reajustesDasPremissas(id) });
  if (consulta.isError) return <Erro erro={mensagemDeErro(consulta.error, "Erro ao carregar os reajustes.")} />;
  if (consulta.isPending) return <div className="h-64 animate-pulse rounded-sm bg-gray-100" />;
  const dados = consulta.data;
  return (
    <div className="space-y-6">
      <p
        className={`rounded-sm border border-l-4 border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-700 ${dados.aplicados ? "border-l-bpm-primary" : "border-l-red-600"}`}
      >
        {dados.aplicados ? (
          <>
            <span className="font-bold text-gray-900">Reajustes aplicados na DRE.</span> As demais abas das Premissas (menos Indicadores Manuais) ficam
            bloqueadas para edição; gravar os índices ou a aplicação recalcula a DRE do cenário. Para tirá-los e voltar a editar as premissas, use
            “Remover Reajustes”, no quadro Aplicação dos Reajustes.
          </>
        ) : (
          <>
            <span className="font-bold text-gray-900">Reajustes não aplicados na DRE.</span> Para aplicá-los, use “Aplicar Reajustes”, no quadro Aplicação
            dos Reajustes.
          </>
        )}
      </p>
      <ListaDosIndices key={JSON.stringify(dados.indices)} id={id} dados={dados} podeEditar={podeEditar} />
      <Aplicacao key={JSON.stringify([dados.linhas, dados.indices])} id={id} dados={dados} podeEditar={podeEditar} />
    </div>
  );
}

type Grupo = { valor: string; mes: string };
type LinhaDoIndice = { chave: string | null; descricao: string; observacao: string; grupos: Grupo[]; contas: number };

/** O que está errado numa linha: a descrição, os grupos incompletos ou fora de ordem (os índices dos grupos) e a falta de reajuste. */
function errosDaLinha(l: LinhaDoIndice) {
  const preenchido = (g: Grupo) => !!g.valor.trim() || !!g.mes;
  const ultimo = Math.max(-1, ...GRUPOS.filter((k) => preenchido(l.grupos[k])));
  const grupos = new Set<number>();
  let anterior = 0;
  for (const k of GRUPOS) {
    const g = l.grupos[k];
    if (!preenchido(g)) {
      // Um grupo vazio antes de um preenchido: os reajustes vão na ordem.
      if (k < ultimo) grupos.add(k);
      continue;
    }
    const v = lerNumero(g.valor);
    const mes = Number(g.mes);
    if (typeof v !== "number" || v <= -100 || !g.mes || mes <= anterior) grupos.add(k);
    if (g.mes) anterior = Math.max(anterior, mes);
  }
  return { descricao: !l.descricao.trim(), grupos, semReajuste: ultimo < 0 };
}

const COLUNAS_DOS_INDICES = (meses: Meses): ColunaExportavel<IndiceDosReajustes & { contas: number }>[] => [
  { chave: "descricao", rotulo: "Descrição", valor: (i) => i.descricao },
  { chave: "observacao", rotulo: "Observação", valor: (i) => i.observacao ?? "" },
  ...GRUPOS.flatMap((k): ColunaExportavel<IndiceDosReajustes & { contas: number }>[] => [
    {
      chave: `valor${k}`,
      rotulo: `${ORDINAL[k]} Valor (%)`,
      tipo: "numero",
      valor: (i) => (i.reajustes[k] ? Number(i.reajustes[k].valor) : null),
      texto: (i) => (i.reajustes[k] ? duasCasas(Number(i.reajustes[k].valor)) : ""),
    },
    { chave: `mes${k}`, rotulo: `${ORDINAL[k]} Inicia Em`, valor: (i) => (i.reajustes[k] ? rotuloDoMes(meses, i.reajustes[k].mes) : "") },
  ]),
  { chave: "contas", rotulo: "Contas", tipo: "numero", valor: (i) => i.contas },
];

/**
 * Os Índices de Reajuste (o quadro de cima): como os Índices de Referência das Configurações, com o Valor (%) no lugar da
 * Variação Máxima e, depois dele, o Inicia Em (um mês do exercício do cenário), em até quatro grupos. A lista se grava inteira.
 */
function ListaDosIndices({ id, dados, podeEditar }: { id: string; dados: ReajustesDasPremissas; podeEditar: boolean }) {
  const queryClient = useQueryClient();
  const deLinha = (i: IndiceDosReajustes & { contas: number }): LinhaDoIndice => ({
    chave: i.chave,
    descricao: i.descricao,
    observacao: i.observacao ?? "",
    grupos: GRUPOS.map((k) => (i.reajustes[k] ? { valor: duasCasas(Number(i.reajustes[k].valor)), mes: String(i.reajustes[k].mes) } : { valor: "", mes: "" })),
    contas: i.contas,
  });
  const [linhas, setLinhas] = useState<LinhaDoIndice[]>(() => dados.indices.map(deLinha));
  const mudou = JSON.stringify(linhas) !== JSON.stringify(dados.indices.map(deLinha));
  // Sair com a lista mudada e não gravada pergunta antes.
  useAlteracoesPendentes(mudou);
  const erros = linhas.map(errosDaLinha);
  const invalidas = erros.filter((e) => e.descricao || e.grupos.size || e.semReajuste).length;
  const mudar = (k: number, m: Partial<LinhaDoIndice>) => setLinhas((atual) => atual.map((l, i) => (i === k ? { ...l, ...m } : l)));
  const mudarGrupo = (k: number, g: number, m: Partial<Grupo>) => mudar(k, { grupos: linhas[k].grupos.map((x, i) => (i === g ? { ...x, ...m } : x)) });
  const gravar = useMutation({
    mutationFn: () =>
      cenariosService.gravarIndicesDosReajustes(
        id,
        linhas.map((l) => ({
          chave: l.chave,
          descricao: l.descricao.trim(),
          observacao: l.observacao.trim() || null,
          reajustes: l.grupos.filter((g) => g.valor.trim() && g.mes).map((g) => ({ valor: lerNumero(g.valor) as number, mes: Number(g.mes) })),
        })),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cenarios", id] });
      toast.success(dados.aplicados ? "Índices gravados; a DRE foi recalculada com os reajustes." : "Índices gravados.");
    },
  });
  const celula = "px-1.5 py-1.5";
  // Descrição, Observação, os quatro grupos (o Valor e o Inicia Em), Contas e a lixeira.
  const colunas = podeEditar ? 12 : 11;
  return (
    <section className={QUADRO}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h2 className={TITULO}>Índices de Reajuste</h2>
          <p className="mt-1 text-xs text-gray-600">
            Até quatro reajustes por índice: o Valor (%) e o mês em que ele Inicia Em; cada um vale sobre os anteriores, até o fim do exercício. Na
            Aplicação dos Reajustes, abaixo, cada conta escolhe um índice; as contas sem índice não se reajustam.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {podeEditar ? (
            <Button
              type="button"
              variant="outline"
              className="shrink-0 rounded-sm"
              onClick={() => setLinhas((atual) => [...atual, { chave: null, descricao: "", observacao: "", grupos: GRUPOS.map(() => ({ valor: "", mes: "" })), contas: 0 }])}
            >
              <Plus className="size-4" />
              Incluir Índice
            </Button>
          ) : null}
          {/* O Exportar, por último: os índices gravados. */}
          <ExportarTabela titulo="Cenário · Premissas · Índices de Reajuste" colunas={COLUNAS_DOS_INDICES(dados.meses)} linhas={dados.indices} />
        </div>
      </div>
      <div className="overflow-x-auto rounded-sm border border-gray-200">
        {/* [--topo-tabela:0px]: a rolagem é a da caixa (para os lados), e os rótulos ficam no topo dela, como no Quadro de Lotação. */}
        <table className="tabela-sig w-full border-collapse [--topo-tabela:0px]">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-xs font-bold text-gray-600">
              <th rowSpan={2} className={`${celula} min-w-40 pl-3 text-left`}>
                Descrição
              </th>
              <th rowSpan={2} className={`${celula} min-w-32 text-left`}>
                Observação
              </th>
              {GRUPOS.map((k) => (
                <th key={k} colSpan={2} className="border-l border-gray-200 px-1.5 !py-0 text-center" style={{ height: ALTURA_DOS_GRUPOS }}>
                  {ORDINAL[k]} Reajuste
                </th>
              ))}
              <th rowSpan={2} className={`${celula} w-24 border-l border-gray-200 text-right`}>
                Contas
              </th>
              {podeEditar ? <th rowSpan={2} className={`${celula} w-10`} aria-label="Excluir" /> : null}
            </tr>
            <tr className="border-b border-gray-200 bg-gray-50 text-xs font-bold text-gray-600">
              {GRUPOS.map((k) => (
                <GrupoDoRotulo key={k} celula={celula} />
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 ? (
              <tr>
                <td colSpan={colunas} className="px-3 py-6 text-center text-sm text-gray-500">
                  Nenhum índice ainda.{podeEditar ? " Use “Incluir Índice”." : ""}
                </td>
              </tr>
            ) : (
              linhas.map((l, k) => {
                const e = erros[k];
                return (
                  <tr key={l.chave ?? `novo-${k}`} className="border-b border-gray-100 last:border-b-0">
                    <td className={`${celula} pl-3`}>
                      <Input
                        aria-label="Descrição do índice"
                        value={l.descricao}
                        onChange={(ev) => mudar(k, { descricao: ev.target.value })}
                        disabled={!podeEditar}
                        maxLength={120}
                        placeholder="Ex.: IPCA, Dissídio, Aço…"
                        className={`h-8 rounded-sm bg-white ${e.descricao ? "border-red-400" : ""}`}
                      />
                    </td>
                    <td className={celula}>
                      <Input aria-label="Observação do índice" value={l.observacao} onChange={(ev) => mudar(k, { observacao: ev.target.value })} disabled={!podeEditar} maxLength={500} className="h-8 rounded-sm bg-white" />
                    </td>
                    {GRUPOS.map((g) => {
                      const ruim = e.grupos.has(g) || (e.semReajuste && g === 0 && !e.descricao);
                      return (
                        <GrupoDaLinha
                          key={g}
                          celula={celula}
                          ordinal={ORDINAL[g]}
                          grupo={l.grupos[g]}
                          meses={dados.meses}
                          ruim={ruim}
                          podeEditar={podeEditar}
                          onMudar={(m) => mudarGrupo(k, g, m)}
                        />
                      );
                    })}
                    <td className={`${celula} border-l border-gray-100 text-right text-sm whitespace-nowrap text-gray-600`} title={l.contas ? "Contas da Aplicação dos Reajustes com este índice" : undefined}>
                      {l.contas ? `${l.contas} ${plural(l.contas, "conta", "contas")}` : "—"}
                    </td>
                    {podeEditar ? (
                      <td className={`${celula} text-right`}>
                        <button
                          type="button"
                          className="inline-flex size-7 items-center justify-center rounded-sm text-gray-500 hover:bg-gray-100 hover:text-red-700 disabled:opacity-40 disabled:hover:bg-transparent"
                          title={l.contas ? "O índice está na Aplicação dos Reajustes: troque o índice dessas contas antes de excluir" : "Excluir o índice"}
                          aria-label="Excluir o índice"
                          disabled={l.contas > 0}
                          onClick={() => setLinhas((atual) => atual.filter((_, i) => i !== k))}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {invalidas ? (
        <p className="text-xs text-red-700">
          {invalidas} {plural(invalidas, "índice incompleto", "índices incompletos")} (em vermelho): toda linha precisa da descrição e de ao menos um
          reajuste; cada reajuste, do Valor (%) (acima de −100) e do Inicia Em, na ordem (o 1º antes do 2º…) e em meses crescentes.
        </p>
      ) : null}
      <Erro erro={gravar.isError ? mensagemDeErro(gravar.error, "Não foi possível gravar os índices.") : null} />
      {podeEditar ? (
        <div className="flex items-center justify-end gap-3">
          <span className="text-xs text-gray-500">
            {linhas.length} {plural(linhas.length, "índice", "índices")}
          </span>
          <Button type="button" className={botaoPrimario} disabled={!mudou || invalidas > 0 || gravar.isPending} onClick={() => gravar.mutate()}>
            {gravar.isPending ? "Gravando…" : "Gravar Índices"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** Os rótulos de um grupo: o Valor (%) e o Inicia Em. */
function GrupoDoRotulo({ celula }: { celula: string }) {
  return (
    <>
      <th className={`${celula} border-l border-gray-200 text-right whitespace-nowrap`} style={{ top: ALTURA_DOS_GRUPOS }}>
        Valor (%)
      </th>
      <th className={`${celula} text-left whitespace-nowrap`} style={{ top: ALTURA_DOS_GRUPOS }}>
        Inicia Em
      </th>
    </>
  );
}

/** Um reajuste de um índice: o Valor (%) e o mês em que começa. */
function GrupoDaLinha({
  celula,
  ordinal,
  grupo,
  meses,
  ruim,
  podeEditar,
  onMudar,
}: {
  celula: string;
  ordinal: string;
  grupo: Grupo;
  meses: Meses;
  ruim: boolean;
  podeEditar: boolean;
  onMudar: (m: Partial<Grupo>) => void;
}) {
  const borda = ruim ? "border-red-400" : "border-gray-300";
  return (
    <>
      <td className={`${celula} border-l border-gray-100 text-right`}>
        <Input
          aria-label={`Valor do ${ordinal} reajuste`}
          value={grupo.valor}
          onChange={(e) => onMudar({ valor: e.target.value })}
          onBlur={() => {
            const v = lerNumero(grupo.valor);
            if (typeof v === "number" && v > -100) onMudar({ valor: duasCasas(v) });
          }}
          disabled={!podeEditar}
          inputMode="decimal"
          placeholder="%"
          className={`ml-auto h-8 w-20 rounded-sm bg-white text-right ${ruim ? "border-red-400" : ""}`}
        />
      </td>
      <td className={celula}>
        <select
          aria-label={`Início do ${ordinal} reajuste`}
          value={grupo.mes}
          onChange={(e) => onMudar({ mes: e.target.value })}
          disabled={!podeEditar}
          className={`h-8 w-24 rounded-sm border ${borda} bg-white px-1.5 text-sm disabled:opacity-70`}
        >
          <option value="">—</option>
          {meses.map((m) => (
            <option key={m.mes} value={m.mes}>
              {m.rotulo}
            </option>
          ))}
        </select>
      </td>
    </>
  );
}

type LinhaDaAplicacao = ReajustesDasPremissas["linhas"][number];

/**
 * A Aplicação dos Reajustes (o quadro de baixo): como as Variações Máximas das Configurações, o índice de cada conta na
 * estrutura da DRE vigente (sem Produção e Serviços: os volumes não se reajustam). O índice de um total ou de uma
 * atribuição vale para as contas abaixo dele; “Preencher Selecionados” aplica um índice às contas marcadas.
 */
function Aplicacao({ id, dados, podeEditar }: { id: string; dados: ReajustesDasPremissas; podeEditar: boolean }) {
  const queryClient = useQueryClient();
  const indices = dados.indices;
  const verificadas = dados.linhas.filter((l) => l.verificada);
  const [escolhas, setEscolhas] = useState<Record<string, string>>(() => Object.fromEntries(verificadas.map((l) => [l.codigo, l.indice ?? ""])));
  const [todos, setTodos] = useState("");
  const [marcadas, setMarcadas] = useState<Set<string>>(() => new Set());
  const niveis = useNiveisDRE(dados.linhas, "sig.cenarios.reajustes.nivel");
  const mudou = verificadas.some((l) => (escolhas[l.codigo] ?? "") !== (l.indice ?? ""));
  const comIndice = verificadas.filter((l) => !!escolhas[l.codigo]).length;
  useAlteracoesPendentes(mudou);
  const rotulo = (chave: string) => {
    const i = indices.find((x) => x.chave === chave);
    return i ? rotuloDoIndice(i, dados.meses) : "";
  };
  const colunasExportadas: ColunaExportavel<LinhaDaAplicacao>[] = [
    { chave: "linha", rotulo: "Linha da DRE", valor: (l) => l.descricao },
    { chave: "indice", rotulo: "Índice de Reajuste", valor: (l) => (l.verificada && l.indice ? rotulo(l.indice) : "") },
  ];
  // As contas de um total ou de uma atribuição: o índice escolhido nele vale para todas elas.
  const contasDe = (l: LinhaDaAplicacao) => (l.verificada ? [l.codigo] : niveis.abaixo(l).filter((x) => x.verificada).map((x) => x.codigo));
  // A lista do total ou da atribuição: o índice das contas dele, quando todas têm o mesmo; senão, em branco ("Vários").
  const escolhaDe = (l: LinhaDaAplicacao) => {
    const valores = [...new Set(contasDe(l).map((c) => escolhas[c] ?? ""))];
    return valores.length === 1 ? valores[0] : "";
  };
  const marcacaoDe = (codigos: string[]) => {
    const n = codigos.filter((c) => marcadas.has(c)).length;
    return n === 0 ? "nenhuma" : n === codigos.length ? "todas" : "parte";
  };
  const marcar = (codigos: string[], marcar: boolean) =>
    setMarcadas((atual) => {
      const novo = new Set(atual);
      for (const c of codigos) {
        if (marcar) novo.add(c);
        else novo.delete(c);
      }
      return novo;
    });
  const preencherMarcadas = (chave: string) => setEscolhas((atual) => ({ ...atual, ...Object.fromEntries([...marcadas].map((c) => [c, chave])) }));
  const mudar = (l: LinhaDaAplicacao, chave: string) => setEscolhas((atual) => ({ ...atual, ...Object.fromEntries(contasDe(l).map((c) => [c, chave])) }));
  const gravar = useMutation({
    mutationFn: () => cenariosService.gravarAplicacaoDosReajustes(id, Object.fromEntries(verificadas.map((l) => [l.codigo, escolhas[l.codigo] || null]))),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cenarios", id] });
      toast.success(dados.aplicados ? "Aplicação gravada; a DRE foi recalculada com os reajustes." : "Aplicação gravada.");
    },
  });
  // Aplicar / Remover Reajustes (11/11/2026, pedido do Adão; antes, no Recalcular dos Resultados): um botão só, que troca
  // com a situação — aplicados, Remover; senão, Aplicar —, e confirma no modal antes.
  const [confirmando, setConfirmando] = useState(false);
  const aplicar = !dados.aplicados;
  const alternar = useMutation({
    mutationFn: () => cenariosService.aplicarReajustes(id, aplicar),
    onSuccess: () => {
      // A DRE, a barra do cenário (a etiqueta Reajustes Aplicados) e esta aba.
      queryClient.invalidateQueries({ queryKey: ["cenarios"] });
      setConfirmando(false);
      toast.success(
        aplicar
          ? "Reajustes aplicados na DRE. As demais abas das Premissas (menos Indicadores Manuais) ficam bloqueadas para edição."
          : "Reajustes removidos da DRE. As abas das Premissas voltam a ser editáveis.",
      );
    },
  });
  const contasDosReajustes = `${dados.contasComReajuste} ${plural(dados.contasComReajuste, "conta", "contas")}`;
  const motivoDoBotao = mudou
    ? "Grave a aplicação antes (ou descarte as mudanças)"
    : aplicar && dados.contasComReajuste === 0
      ? "Nenhuma conta com índice: escolha os índices das contas e grave a aplicação"
      : undefined;

  return (
    <section className={QUADRO}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h2 className={TITULO}>Aplicação dos Reajustes</h2>
          <p className="mt-1 text-xs text-gray-600">
            O índice de reajuste de cada conta, na estrutura da DRE vigente (sem Produção e Serviços). Contas sem índice não se reajustam.
          </p>
          {indices.length === 0 ? <p className="mt-1 text-xs font-medium text-red-700">Nenhum índice cadastrado: inclua os índices no quadro Índices de Reajuste, acima.</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {podeEditar ? (
            <>
              <Label htmlFor="rea-todos">Preencher Selecionados</Label>
              <select id="rea-todos" value={todos} onChange={(e) => setTodos(e.target.value)} className="h-9 max-w-64 rounded-sm border border-gray-300 bg-white px-2 text-sm">
                <option value="">Escolha o índice…</option>
                {indices.map((i) => (
                  <option key={i.chave} value={i.chave}>
                    {rotuloDoIndice(i, dados.meses)}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                className="rounded-sm"
                disabled={marcadas.size === 0 || !todos}
                title={marcadas.size === 0 ? "Marque as contas (a caixa de um total ou de uma atribuição marca as contas abaixo dele)" : undefined}
                onClick={() => preencherMarcadas(todos)}
              >
                Aplicar
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded-sm"
                disabled={![...marcadas].some((c) => !!escolhas[c])}
                title={marcadas.size === 0 ? "Marque as contas que perdem o índice" : undefined}
                onClick={() => preencherMarcadas("")}
              >
                Limpar
              </Button>
            </>
          ) : null}
          {/* O Exportar, por último, depois do Limpar: o que está gravado em cada linha da DRE. */}
          <ExportarTabela titulo="Cenário · Premissas · Aplicação dos Reajustes" colunas={colunasExportadas} linhas={dados.linhas} />
        </div>
      </div>
      <div className="rounded-sm border border-gray-200">
        <table className="tabela-sig w-full border-collapse">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-600">
                <span className="flex items-center gap-2">
                  <SeletorNivel nivel={niveis.nivelGeral} onEscolher={niveis.escolherNivel} />
                  {podeEditar ? (
                    <Caixa rotulo="Marcar todas as contas" estado={marcacaoDe(verificadas.map((l) => l.codigo))} onMudar={(m) => marcar(verificadas.map((l) => l.codigo), m)} />
                  ) : null}
                  Linha da DRE
                </span>
              </th>
              <th className="w-96 px-4 py-2.5 text-right text-xs font-bold text-gray-600">Índice de Reajuste</th>
            </tr>
          </thead>
          <tbody>
            {niveis.linhas.filter(niveis.visivel).map((l) => {
              const contas = contasDe(l);
              const escolha = escolhaDe(l);
              const varias = !l.verificada && !escolha && contas.some((c) => escolhas[c]);
              return (
                <tr key={l.codigo} className={`border-b border-gray-100 last:border-b-0 ${fundoDaLinha(l)}`}>
                  <td className={`py-1.5 pr-4 text-sm ${niveis.recuo(l)} ${l.tipo !== "ITEM" ? "font-bold text-gray-900" : "text-gray-700"}`}>
                    <span className="flex items-center gap-1">
                      <Agrupador grupo={niveis.grupo(l)} fechado={niveis.fechado(l)} onAlternar={() => niveis.alternar(l.codigo)} />
                      {podeEditar && contas.length ? <Caixa rotulo={`Marcar ${l.descricao}`} estado={marcacaoDe(contas)} onMudar={(m) => marcar(contas, m)} /> : null}
                      <span className="truncate" title={l.descricao}>
                        {l.descricao}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-1.5 text-right">
                    {contas.length ? (
                      <select
                        aria-label={`Índice de ${l.descricao}`}
                        title={escolha ? rotulo(escolha) : l.verificada ? undefined : "O índice escolhido vale para todas as contas abaixo"}
                        value={escolha}
                        onChange={(e) => mudar(l, e.target.value)}
                        disabled={!podeEditar}
                        className="ml-auto h-8 w-full max-w-88 rounded-sm border border-gray-300 bg-white px-2 text-sm disabled:opacity-70"
                      >
                        <option value="">{varias ? "Vários" : "—"}</option>
                        {indices.map((i) => (
                          <option key={i.chave} value={i.chave}>
                            {rotuloDoIndice(i, dados.meses)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-sm text-gray-400" title="Sem contas para reajustar">
                        —
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Erro erro={gravar.isError ? mensagemDeErro(gravar.error, "Não foi possível gravar a aplicação dos reajustes.") : null} />
      {podeEditar ? (
        <div className="flex items-center justify-end gap-3">
          <span className="text-xs text-gray-500">
            {marcadas.size ? `${marcadas.size} ${plural(marcadas.size, "conta marcada", "contas marcadas")} · ` : ""}
            {comIndice} de {verificadas.length} {plural(verificadas.length, "conta", "contas")} com índice.
          </span>
          <Button type="button" className={botaoPrimario} disabled={!mudou || gravar.isPending} onClick={() => gravar.mutate()}>
            {gravar.isPending ? "Gravando…" : "Gravar Aplicação"}
          </Button>
          <Button
            type="button"
            className={botaoPrimario}
            disabled={!!motivoDoBotao || gravar.isPending || alternar.isPending}
            title={motivoDoBotao}
            onClick={() => {
              alternar.reset();
              setConfirmando(true);
            }}
          >
            {aplicar ? "Aplicar Reajustes" : "Remover Reajustes"}
          </Button>
        </div>
      ) : null}
      {confirmando ? (
        <ConfirmacaoDialog
          titulo={aplicar ? "Aplicar Reajustes" : "Remover Reajustes"}
          descricao={
            aplicar
              ? `A DRE do cenário passa a ter os reajustes: em ${contasDosReajustes}, cada mês a partir do Inicia Em de cada reajuste vira o valor × (1 + Valor), cada reajuste sobre os anteriores. As demais abas das Premissas (menos Indicadores Manuais) ficam bloqueadas para edição, assim como a referência (Configurações / Referência); o Recalcular dos Resultados mantém os reajustes. Para tirá-los e voltar a editar, use “Remover Reajustes”.`
              : `A DRE do cenário volta aos valores das premissas: em ${contasDosReajustes}, o inverso dos reajustes (o valor ÷ os mesmos fatores, de dezembro a janeiro), e as abas das Premissas voltam a ser editáveis. Para aplicá-los de novo, use “Aplicar Reajustes”.`
          }
          acao={aplicar ? "Aplicar Reajustes" : "Remover Reajustes"}
          acaoPendente={aplicar ? "Aplicando…" : "Removendo…"}
          pendente={alternar.isPending}
          destrutiva={false}
          onConfirmar={() => alternar.mutate()}
          onFechar={() => (alternar.isPending ? undefined : setConfirmando(false))}
        >
          <Erro erro={alternar.isError ? mensagemDeErro(alternar.error, aplicar ? "Não foi possível aplicar os reajustes." : "Não foi possível remover os reajustes.") : null} />
        </ConfirmacaoDialog>
      ) : null}
    </section>
  );
}
