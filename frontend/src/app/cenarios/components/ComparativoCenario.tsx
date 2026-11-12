"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { type ColunaExportavel, ExportarTabela } from "@/components/shared/ExportarTabela";
import { CampoBusca } from "@/components/shared/Filtros";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { useAlteracoesPendentes } from "@/lib/alteracoesPendentes";
import { plural } from "@/lib/texto";

import { Agrupador, fundoDaLinha, SeletorNivel, useNiveisDRE } from "@/app/competencias/[anoMes]/dre/components/NiveisDRE";
import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";

import { cenariosService, rotuloVersao, type Comparativo } from "../services/cenariosService";
import { botaoPrimario, Erro } from "./CenarioDialog";
import { EtiquetaMarcacao, EtiquetaVigente } from "./EtiquetasCenario";
import { lerNumero } from "./EdicaoDialogs";

// Os quadros com o destaque amarelo-ouro à esquerda; o título com iniciais maiúsculas (13/10/2026).
/** A variação máxima no campo: sempre com duas casas (13/10/2026), sem separador de milhar (fácil de editar). */
const duasCasas = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
const QUADRO = "space-y-4 rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white p-5";
const TITULO = "text-sm font-bold text-gray-900";

/**
 * A aba Comparativo das Configurações do cenário (13/10/2026; antes, a aba Referência da tela Comparativo e, antes, a
 * aba Comparar dos Resultados): o cenário com que este se compara e a variação máxima (em %) de cada conta, na
 * estrutura da DRE vigente (14/10/2026; antes, só os totais). Com um cenário comparado, a aba Justificativas da tela
 * Reajustes lista as contas que passam da variação. Nos analíticos (19/10/2026), cada conta escolhe um Índice de
 * Referência no lugar da variação digitada; a tela Reajustes deles se chama Histórico. Desde 11/11/2026 (pedido do Adão), nos
 * analíticos, três quadros: Cenário Comparado, Índices de Referência (`indices`; antes, a aba Índices) e Variações Máximas
 * (o índice de cada conta; antes, Índices de Reajuste).
 */
export function ComparativoCenario({ id, podeEditar, indices = null }: { id: string; podeEditar: boolean; indices?: React.ReactNode }) {
  const consulta = useQuery({ queryKey: ["cenarios", id, "comparativo"], queryFn: () => cenariosService.comparativo(id) });
  if (consulta.isError) return <Erro erro={mensagemDeErro(consulta.error, "Erro ao carregar o comparativo.")} />;
  if (consulta.isPending) return <div className="h-64 animate-pulse rounded-sm bg-gray-100" />;
  return <Formulario key={JSON.stringify(consulta.data)} id={id} dados={consulta.data} podeEditar={podeEditar} quadroDosIndices={indices} />;
}

type LinhaDaVariacao = Comparativo["linhas"][number];

function Formulario({ id, dados, podeEditar, quadroDosIndices }: { id: string; dados: Comparativo; podeEditar: boolean; quadroDosIndices: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [comparado, setComparado] = useState(dados.comparadoCom?.id ?? "");
  // As linhas verificadas (as contas, e os totais e atribuições sem contas) guardam a variação; as demais a repassam.
  const verificadas = dados.linhas.filter((l) => l.verificada);
  // Nos analíticos (19/10/2026), o valor de cada conta é a chave do índice escolhido; nos sintéticos, a variação digitada.
  const indices = dados.indices;
  const analitico = indices !== null;
  const original = (l: LinhaDaVariacao) => (analitico ? (l.indice ?? "") : l.limite === null ? "" : duasCasas(l.limite));
  const [limites, setLimites] = useState<Record<string, string>>(() => Object.fromEntries(verificadas.map((l) => [l.codigo, original(l)])));
  const daTela = analitico ? "Histórico" : "Reajustes";
  const rotuloDoIndice = (i: { descricao: string; variacao: number }) => `${i.descricao} (${duasCasas(Number(i.variacao))}%)`;
  const colunasExportadas: ColunaExportavel<LinhaDaVariacao>[] = [
    { chave: "linha", rotulo: "Linha da DRE", valor: (l) => l.descricao },
    analitico
      ? {
          chave: "indice",
          rotulo: "Índice de Referência",
          valor: (l) => {
            const i = l.verificada && l.indice ? indices.find((x) => x.chave === l.indice) : undefined;
            return i ? rotuloDoIndice(i) : "";
          },
        }
      : { chave: "variacao", rotulo: "Variação Máxima (%)", tipo: "numero", valor: (l) => (l.verificada ? l.limite : null), texto: (l) => (l.verificada && l.limite !== null ? duasCasas(l.limite) : "") },
  ];
  const [todos, setTodos] = useState("");
  // As contas marcadas (15/10/2026): o Preencher Selecionados e o Limpar valem só para elas (antes, para todas).
  const [marcadas, setMarcadas] = useState<Set<string>>(() => new Set());
  const [escolhendo, setEscolhendo] = useState(false);
  // Os níveis da DRE (14/10/2026): totais, atribuições e contas, com as setas de abrir e fechar.
  const niveis = useNiveisDRE(dados.linhas, "sig.cenarios.variacaoMaxima.nivel");
  const escolhido = dados.opcoes.find((o) => o.id === comparado) ?? null;
  const lidos = Object.fromEntries(Object.entries(limites).map(([c, t]) => [c, analitico ? t || null : lerNumero(t)]));
  const invalidos = analitico ? [] : verificadas.filter((l) => lidos[l.codigo] === undefined || ((lidos[l.codigo] as number | null) ?? 0) < 0);
  const mudou = comparado !== (dados.comparadoCom?.id ?? "") || verificadas.some((l) => (limites[l.codigo] ?? "") !== original(l));
  const comLimite = verificadas.filter((l) => (analitico ? !!limites[l.codigo] : typeof lidos[l.codigo] === "number")).length;
  // As contas de um total ou de uma atribuição: a variação digitada nele vale para todas elas (14/10/2026).
  const contasDe = (l: LinhaDaVariacao) => (l.verificada ? [l.codigo] : niveis.abaixo(l).filter((x) => x.verificada).map((x) => x.codigo));
  // O campo do total ou da atribuição: a variação das contas dele, quando todas têm a mesma; senão, em branco ("Várias").
  const textoDe = (l: LinhaDaVariacao) => {
    const textos = [...new Set(contasDe(l).map((c) => limites[c] ?? ""))];
    return textos.length === 1 ? textos[0] : "";
  };
  // A caixa de um total ou de uma atribuição marca as contas abaixo dele; fica parcial com só parte delas marcada.
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
  const preencherMarcadas = (texto: string) => setLimites((atual) => ({ ...atual, ...Object.fromEntries([...marcadas].map((c) => [c, texto])) }));
  const mudar = (l: LinhaDaVariacao, texto: string) => setLimites((atual) => ({ ...atual, ...Object.fromEntries(contasDe(l).map((c) => [c, texto])) }));
  // Sair com o comparativo mudado e não gravado pergunta antes (13/10/2026).
  useAlteracoesPendentes(mudou);
  const valorTodos = analitico ? (todos ? 0 : undefined) : lerNumero(todos);

  const gravar = useMutation({
    mutationFn: () =>
      cenariosService.gravarComparativo(
        id,
        analitico
          ? { comparadoComId: comparado || null, indices: Object.fromEntries(verificadas.map((l) => [l.codigo, limites[l.codigo] || null])) }
          : { comparadoComId: comparado || null, limites: Object.fromEntries(verificadas.map((l) => [l.codigo, (lidos[l.codigo] as number | null) ?? null])) },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cenarios"] });
      toast.success(comparado ? "Comparativo gravado." : "Comparativo desligado.");
    },
  });

  return (
    <div className="space-y-6">
      <section className={QUADRO}>
        {/*
          O cenário escolhido e o botão que abre o modal de escolha (13/10/2026; antes, uma lista). Desde 03/11/2026 (pedido do
          Adão): o título como o da Variação Máxima, o espaço do nome mais largo (1,5 vez o original) e o Escolher Cenário à direita.
        */}
        <div className="space-y-2">
          <h2 className={TITULO}>Cenário Comparado</h2>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex h-9 w-full max-w-[40.5rem] min-w-0 items-center gap-2 rounded-sm border border-gray-300 bg-gray-50 px-3 text-sm">
              {escolhido ? (
                <>
                  <span className="truncate font-medium text-gray-900">{escolhido.nome}</span>
                  <span className="shrink-0 text-gray-600">
                    {rotuloVersao(escolhido.versao)} · {escolhido.ano}
                  </span>
                  <Etiqueta>{ROTULO_DO_TIPO[escolhido.tipo]}</Etiqueta>
                  {escolhido.vigente ? <EtiquetaVigente classe={ETIQUETA} /> : null}
                  <EtiquetaMarcacao marcacao={escolhido.marcacao} classe={ETIQUETA} />
                </>
              ) : (
                <span className="text-gray-500">Nenhum (sem comparativo)</span>
              )}
            </div>
            <p className="min-w-0 flex-1 text-xs text-gray-600">
              {comparado
                ? `Cada conta se compara, mês a mês e em cada aba da DRE, com a mesma conta do cenário escolhido. As que passam da variação máxima delas aparecem na aba Justificativas da tela ${daTela}.`
                : `Sem cenário comparado, o comparativo fica desligado e a aba Justificativas (tela ${daTela}) não aparece. ${analitico ? "Os índices das contas ficam guardados." : "As variações máximas ficam guardadas."}`}
            </p>
            {podeEditar ? (
              <Button type="button" variant="outline" className="shrink-0 rounded-sm" onClick={() => setEscolhendo(true)}>
                Escolher Cenário
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      {/* Os Índices de Referência (11/11/2026: o quadro do meio, nos analíticos). */}
      {quadroDosIndices}

      <section className={QUADRO}>
        {/* O "Preencher Selecionados" à direita, ao lado do texto (13/10/2026; até 15/10/2026, "Preencher Todos Com"). */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h2 className={TITULO}>{analitico ? "Variações Máximas" : "Variação Máxima"}</h2>
            <p className="mt-1 text-xs text-gray-600">
              {analitico
                ? "O índice de referência de cada conta (a variação máxima dela), na estrutura da DRE vigente. Contas sem índice não serão verificadas."
                : "A variação aceita (em %, para mais ou para menos) em cada conta, na estrutura da DRE vigente. Variações em branco não serão verificadas."}
            </p>
            {analitico && indices.length === 0 ? (
              <p className="mt-1 text-xs font-medium text-red-700">Nenhum índice cadastrado: inclua os índices no quadro Índices de Referência, acima.</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {podeEditar ? (
              <>
                <Label htmlFor="cmp-todos">Preencher Selecionados</Label>
                {analitico ? (
                  <select id="cmp-todos" value={todos} onChange={(e) => setTodos(e.target.value)} className="h-9 max-w-64 rounded-sm border border-gray-300 bg-white px-2 text-sm">
                    <option value="">Escolha o índice…</option>
                    {indices.map((i) => (
                      <option key={i.chave} value={i.chave}>
                        {rotuloDoIndice(i)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input id="cmp-todos" value={todos} onChange={(e) => setTodos(e.target.value)} placeholder="%" inputMode="decimal" className="w-24 rounded-sm text-right" />
                )}
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-sm"
                  disabled={marcadas.size === 0 || typeof valorTodos !== "number" || valorTodos < 0}
                  title={marcadas.size === 0 ? "Marque as contas (a caixa de um total ou de uma atribuição marca as contas abaixo dele)" : undefined}
                  onClick={() => preencherMarcadas(analitico ? todos : duasCasas(valorTodos as number))}
                >
                  Aplicar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-sm"
                  disabled={![...marcadas].some((c) => (analitico ? !!limites[c] : typeof lidos[c] === "number"))}
                  title={marcadas.size === 0 ? "Marque as contas que perdem a variação" : undefined}
                  onClick={() => preencherMarcadas("")}
                >
                  Limpar
                </Button>
              </>
            ) : null}
            {/* O Exportar (30/10/2026): o que está gravado em cada linha da DRE; por último, depois do Limpar (03/11/2026, pedido do Adão). */}
            <ExportarTabela titulo={`Cenário · Comparativo · ${analitico ? "Variações Máximas" : "Variação Máxima"}`} colunas={colunasExportadas} linhas={dados.linhas} />
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
                      <Caixa
                        rotulo="Marcar todas as contas"
                        estado={marcacaoDe(verificadas.map((l) => l.codigo))}
                        onMudar={(m) => marcar(verificadas.map((l) => l.codigo), m)}
                      />
                    ) : null}
                    Linha da DRE
                  </span>
                </th>
                <th className={`${analitico ? "w-80" : "w-48"} px-4 py-2.5 text-right text-xs font-bold text-gray-600`}>{analitico ? "Índice de Referência" : "Variação Máxima (%)"}</th>
              </tr>
            </thead>
            <tbody>
              {niveis.linhas.filter(niveis.visivel).map((l) => {
                const contas = contasDe(l);
                const invalido = invalidos.some((x) => contas.includes(x.codigo));
                const texto = textoDe(l);
                const varias = !l.verificada && !texto && contas.some((c) => limites[c]);
                return (
                  <tr key={l.codigo} className={`border-b border-gray-100 last:border-b-0 ${fundoDaLinha(l)}`}>
                    <td className={`py-1.5 pr-4 text-sm ${niveis.recuo(l)} ${l.tipo !== "ITEM" ? "font-bold text-gray-900" : "text-gray-700"}`}>
                      <span className="flex items-center gap-1">
                        <Agrupador grupo={niveis.grupo(l)} fechado={niveis.fechado(l)} onAlternar={() => niveis.alternar(l.codigo)} />
                        {podeEditar ? <Caixa rotulo={`Marcar ${l.descricao}`} estado={marcacaoDe(contas)} onMudar={(m) => marcar(contas, m)} /> : null}
                        <span className="truncate" title={l.descricao}>
                          {l.descricao}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      {analitico ? (
                        <select
                          aria-label={`Índice de ${l.descricao}`}
                          title={l.verificada ? undefined : "O índice escolhido vale para todas as contas abaixo"}
                          value={texto}
                          onChange={(e) => mudar(l, e.target.value)}
                          disabled={!podeEditar}
                          className="ml-auto h-8 w-full max-w-72 rounded-sm border border-gray-300 bg-white px-2 text-sm disabled:opacity-70"
                        >
                          <option value="">{varias ? "Vários" : "—"}</option>
                          {indices.map((i) => (
                            <option key={i.chave} value={i.chave}>
                              {rotuloDoIndice(i)}
                            </option>
                          ))}
                        </select>
                      ) : (
                      <Input
                        aria-label={`Variação máxima de ${l.descricao}`}
                        title={l.verificada ? undefined : "A variação digitada vale para todas as contas abaixo"}
                        value={texto}
                        onChange={(e) => mudar(l, e.target.value)}
                        // Ao sair do campo, o número digitado fica com duas casas.
                        onBlur={() => {
                          const v = lerNumero(texto);
                          if (texto && typeof v === "number" && v >= 0) mudar(l, duasCasas(v));
                        }}
                        disabled={!podeEditar}
                        inputMode="decimal"
                        placeholder={varias ? "Várias" : "—"}
                        className={`ml-auto h-8 w-28 rounded-sm bg-white text-right ${invalido ? "border-red-400" : ""}`}
                      />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {invalidos.length ? (
          <p className="text-xs text-red-700">
            Variação inválida em {invalidos.length} {plural(invalidos.length, "conta", "contas")} (em vermelho): use um número a partir de zero.
          </p>
        ) : null}
        <Erro erro={gravar.isError ? mensagemDeErro(gravar.error, "Não foi possível gravar o comparativo.") : null} />
        {podeEditar ? (
          <div className="flex items-center justify-end gap-3">
            <span className="text-xs text-gray-500">
              {marcadas.size ? `${marcadas.size} ${plural(marcadas.size, "conta marcada", "contas marcadas")} · ` : ""}
              {comLimite} de {verificadas.length} {plural(verificadas.length, "conta", "contas")} com {analitico ? "índice" : "variação máxima"}.
            </span>
            <Button type="button" className={botaoPrimario} disabled={!mudou || invalidos.length > 0 || gravar.isPending} onClick={() => gravar.mutate()}>
              {gravar.isPending ? "Gravando…" : "Gravar Comparativo"}
            </Button>
          </div>
        ) : null}
      </section>
      {escolhendo ? (
        <EscolherCenarioDialog
          opcoes={dados.opcoes}
          atual={comparado}
          onEscolher={(c) => {
            setComparado(c);
            setEscolhendo(false);
          }}
          onFechar={() => setEscolhendo(false)}
        />
      ) : null}
    </div>
  );
}

/** A caixa de marcar uma linha (ou todas): parcial quando só parte das contas dela está marcada (também nos Reajustes das Premissas). */
export function Caixa({ rotulo, estado, onMudar }: { rotulo: string; estado: "nenhuma" | "parte" | "todas"; onMudar: (marcar: boolean) => void }) {
  return (
    <input
      type="checkbox"
      aria-label={rotulo}
      className="size-3.5 shrink-0 accent-black"
      checked={estado === "todas"}
      ref={(el) => {
        if (el) el.indeterminate = estado === "parte";
      }}
      onChange={() => onMudar(estado !== "todas")}
    />
  );
}

/** O tipo do cenário na etiqueta (13/10/2026: o comparativo vale entre sintéticos e analíticos). */
const ROTULO_DO_TIPO = { SINTETICO: "Sintético", ANALITICO: "Analítico" } as const;

const ETIQUETA = "shrink-0 rounded-sm border border-gray-300 bg-white px-1.5 py-px text-xs font-medium whitespace-nowrap text-gray-700";
const Etiqueta = ({ children }: { children: React.ReactNode }) => <span className={ETIQUETA}>{children}</span>;
/** O texto para a busca: sem diferença de maiúsculas e de acentos. */
const paraBusca = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * A escolha do cenário comparado (13/10/2026; antes, uma lista): a lista dos cenários, com a busca pelo nome e os
 * filtros "Apenas Vigentes" (a versão mais recente de cada cenário) e "Apenas com Marcação". A escolha vale no
 * formulário; grava-se em "Gravar Comparativo".
 */
function EscolherCenarioDialog({
  opcoes,
  atual,
  onEscolher,
  onFechar,
}: {
  opcoes: Comparativo["opcoes"];
  atual: string;
  onEscolher: (id: string) => void;
  onFechar: () => void;
}) {
  const [busca, setBusca] = useState("");
  const [soVigentes, setSoVigentes] = useState(false);
  const [soMarcados, setSoMarcados] = useState(false);
  const [escolha, setEscolha] = useState(atual);
  const termo = paraBusca(busca.trim());
  const visiveis = opcoes.filter((o) => (!soVigentes || o.vigente) && (!soMarcados || o.marcacao) && (!termo || paraBusca(`${o.nome} ${rotuloVersao(o.versao)} ${o.ano} ${ROTULO_DO_TIPO[o.tipo]}`).includes(termo)));
  const linha = (marcada: boolean) =>
    `flex cursor-pointer items-center gap-3 border-b border-gray-100 px-3 py-2 text-sm last:border-b-0 ${marcada ? "bg-gray-100" : "hover:bg-gray-50"}`;
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent className="flex max-h-[85vh] flex-col rounded-sm sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Escolher Cenário Comparado</DialogTitle>
          <DialogDescription>
            O cenário com que este se compara, conta a conta e mês a mês: sintético ou analítico. Entre um sintético e um analítico, compara-se a
            DRE; o que só os analíticos têm (como os centros de custo) só se compara entre analíticos. A escolha grava-se em “Gravar Comparativo”.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <CampoBusca rotulo="Buscar cenário" valor={busca} onMudar={setBusca} placeholder="Nome, versão, exercício ou tipo…" largura="w-72" />
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" className="accent-black" checked={soVigentes} onChange={(e) => setSoVigentes(e.target.checked)} />
            Apenas Vigentes
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" className="accent-black" checked={soMarcados} onChange={(e) => setSoMarcados(e.target.checked)} />
            Apenas com Marcação
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-sm border border-gray-200" role="radiogroup" aria-label="Cenários">
          <label className={linha(escolha === "")}>
            <input type="radio" name="cenario-comparado" className="accent-black" checked={escolha === ""} onChange={() => setEscolha("")} />
            <span className="text-gray-700">Nenhum (sem comparativo)</span>
          </label>
          {visiveis.map((o) => (
            <label key={o.id} className={linha(escolha === o.id)}>
              <input type="radio" name="cenario-comparado" className="accent-black" checked={escolha === o.id} onChange={() => setEscolha(o.id)} />
              <span className="min-w-0 flex-1 truncate font-medium text-gray-900">{o.nome}</span>
              <span className="shrink-0 text-gray-600">
                {rotuloVersao(o.versao)} · {o.ano}
              </span>
              <Etiqueta>{ROTULO_DO_TIPO[o.tipo]}</Etiqueta>
              {o.vigente ? <EtiquetaVigente classe={ETIQUETA} /> : null}
              <EtiquetaMarcacao marcacao={o.marcacao} classe={ETIQUETA} />
            </label>
          ))}
          {visiveis.length === 0 ? <p className="px-3 py-6 text-center text-sm text-gray-500">Nenhum cenário com esses filtros.</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={escolha === atual} onClick={() => onEscolher(escolha)}>
            Escolher
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
