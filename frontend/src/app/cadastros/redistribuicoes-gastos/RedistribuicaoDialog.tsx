"use client";

import { useMemo, useState } from "react";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { BuscaNaLista, type OpcaoDaBusca } from "@/components/shared/BuscaNaLista";
import { ConfirmacaoDialog } from "@/components/shared/ConfirmacaoDialog";
import { SemResultado, useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { atualizarCompetencia } from "@/lib/atualizarCompetencia";
import type { Coluna } from "@/lib/filtrosDeTabela";
import { plural } from "@/lib/texto";

import { botaoPrimario, classeSelect, Erro } from "@/app/cenarios/components/CenarioDialog";
import { CentrosDeCustoDialog } from "@/app/contestacoes-de-gastos/components/CentrosDeCustoDialog";
import { lerNumero } from "@/app/cenarios/components/EdicaoDialogs";
import { mensagemDeErro } from "../services/edicaoService";
import {
  redistribuicoesService as servico,
  type DadosDaRedistribuicao,
  type EfeitoDaRedistribuicao,
  type FornecedorDaCombinacao,
  nomeDasContas,
  type OpcoesDaRedistribuicao,
  type Redistribuicao,
} from "../services/redistribuicoesService";
import { ContasDaDREDialog } from "./ContasDaDREDialog";

const moeda = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`;
const chave = (f: string) => f.trim().toUpperCase();

/** O texto do efeito de gravar ou excluir: as competências reclassificadas e as apuradas que pedem reapurar. */
export function textoDoEfeito(e: EfeitoDaRedistribuicao) {
  const partes: string[] = [];
  if (e.reclassificadas.length) partes.push(`Reclassificadas: ${e.reclassificadas.join(", ")}.`);
  if (e.apuradasPorReapurar.length) partes.push(`Reapure ${e.apuradasPorReapurar.length > 1 ? "as competências" : "a competência"} ${e.apuradasPorReapurar.join(", ")} para valer.`);
  return partes.join(" ");
}

type LinhaDoFornecedor = FornecedorDaCombinacao & { marcado: boolean };

/** O registro que o modal edita (o do cadastro ou o da cópia de um cenário). */
export type RegistroDaRedistribuicao = Omit<Redistribuicao, "competencias" | "departamento">;

/**
 * De onde o modal lê e onde grava (20/11/2026: o cadastro, ou a cópia de um cenário analítico — as Redistribuições de Gastos das
 * Configurações): os fornecedores da combinação, a gravação e a exclusão (com o texto do efeito para o aviso), o que atualizar
 * depois e os textos do modal.
 */
export type ServicoDaRedistribuicao = {
  chave: readonly unknown[];
  fornecedores: (departamentoId: string | null, linhasDREIds: string[]) => Promise<FornecedorDaCombinacao[]>;
  gravar: (id: string | null, d: DadosDaRedistribuicao) => Promise<string>;
  excluir: (id: string) => Promise<string>;
  aoConcluir: (queryClient: QueryClient) => void;
  descricao: string;
  descricaoDaExclusao: (conta: string) => string;
};

/** O cadastro (Cadastros Gerais / Redistribuições de Gastos): grava e reclassifica as competências ainda não apuradas. */
const DO_CADASTRO: ServicoDaRedistribuicao = {
  chave: ["cadastros", "redistribuicoes", "fornecedores"],
  fornecedores: servico.fornecedores,
  gravar: async (id, d) => textoDoEfeito(await servico.gravar(id, d)),
  excluir: async (id) => textoDoEfeito(await servico.excluir(id)),
  aoConcluir: (queryClient) => {
    queryClient.invalidateQueries({ queryKey: ["cadastros", "redistribuicoes"] });
    atualizarCompetencia(queryClient);
  },
  descricao:
    "Os movimentos dos fornecedores marcados, nas Contas da DRE (e no departamento), valem divididos entre os centros de custo de Redistribuir Para, pelos percentuais, nas competências da vigência. Movimentos redistribuídos não podem ser contestados.",
  descricaoDaExclusao: (conta) =>
    `A redistribuição de ${conta} sai do cadastro, e as competências ainda não apuradas da vigência voltam a ser classificadas sem ela. Já usada numa competência apurada ou fechada, ela não se exclui: encerre a vigência.`,
};
const COLUNAS: Coluna<LinhaDoFornecedor>[] = [
  { chave: "marcar", rotulo: "", semFiltro: true, classe: "w-10" },
  { chave: "fornecedor", rotulo: "Fornecedor", valor: (f) => f.fornecedor },
  { chave: "movimentos", rotulo: "Movimentos", valor: (f) => f.movimentos, tipo: "numero", alinhamento: "direita" },
  { chave: "valor", rotulo: "Valor", valor: (f) => f.valor, texto: (f) => moeda(f.valor), tipo: "numero", alinhamento: "direita" },
  { chave: "competencias", rotulo: "Competências", valor: (f) => f.competencias },
];

/** O mês gravado ("AAAA-MM") no calendário do Início: o primeiro dia dele. */
const diaDoInicio = (mes: string) => (/^\d{4}-\d{2}$/.test(mes) ? `${mes}-01` : mes);
/** O mês gravado no calendário do Fim: o último dia dele. */
const diaDoFim = (mes: string) => {
  if (!/^\d{4}-\d{2}$/.test(mes)) return mes;
  const [a, m] = mes.split("-").map(Number);
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

/**
 * O modal Redistribuição de Gastos (13/11/2026, pedido do Adão): o Departamento da DRE (ou Todos), a Unidade (ou Todas; só
 * filtra as contas) e as Contas da DRE (20/11/2026: uma ou mais, pela busca ou pela lupa, listadas abaixo do campo), os
 * fornecedores com movimentos em qualquer das contas (de competências fechadas ou abertas; a tabela com os filtros nos rótulos
 * e a caixa de cada um e a de todos), os centros de Redistribuir Para (pela busca ou pela lupa, como no modal Contestar) com o
 * percentual de cada um (somando 100%) e a vigência.
 */
export function RedistribuicaoDialog({
  registro,
  opcoes,
  pode,
  onFechar,
  fonte = DO_CADASTRO,
}: {
  registro: RegistroDaRedistribuicao | null;
  opcoes: OpcoesDaRedistribuicao;
  pode: boolean;
  onFechar: () => void;
  fonte?: ServicoDaRedistribuicao;
}) {
  const queryClient = useQueryClient();
  const [departamentoId, setDepartamentoId] = useState(registro?.departamentoId ?? "");
  const [linhasDREIds, setLinhasDREIds] = useState<string[]>(registro?.linhasDREIds ?? []);
  const [unidade, setUnidade] = useState("");
  // A busca da conta volta vazia a cada conta incluída (a chave remonta o campo).
  const [buscaDaConta, setBuscaDaConta] = useState(0);
  const [consulta, setConsulta] = useState<{ tipo: "contas" } | { tipo: "centros"; linha: number } | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set((registro?.fornecedores ?? []).map(chave)));
  const [destinos, setDestinos] = useState<Array<{ centroCustoId: string; texto: string }>>(() =>
    registro ? registro.destinos.map((d) => ({ centroCustoId: d.centroCustoId, texto: d.percentual.toLocaleString("pt-BR", { maximumFractionDigits: 4 }) })) : [{ centroCustoId: "", texto: "" }],
  );
  // A vigência no calendário (21/11/2026, pedido do Adão: como nas Regras de Rateio): o dia escolhido vale o mês dele.
  const [inicio, setInicio] = useState(diaDoInicio(registro?.vigenciaInicio ?? ""));
  const [fim, setFim] = useState(diaDoFim(registro?.vigenciaFim ?? ""));
  const mesDoInicio = inicio.slice(0, 7);
  const mesDoFim = fim.slice(0, 7);
  const [descricao, setDescricao] = useState(registro?.descricao ?? "");
  const [ativo, setAtivo] = useState(registro?.ativo ?? true);
  const [excluindo, setExcluindo] = useState(false);

  // As contas da DRE do departamento escolhido (Todos: todas) e da unidade (Todas: todas), fora as já escolhidas.
  const doDepartamento = useMemo(() => (departamentoId ? new Set(opcoes.departamentos.find((d) => d.id === departamentoId)?.linhas ?? []) : null), [departamentoId, opcoes]);
  const codigoDaUnidade = unidade ? Number(unidade) : null;
  const escolhidas = useMemo(() => new Set(linhasDREIds), [linhasDREIds]);
  const contas = useMemo(
    () =>
      opcoes.linhas
        .filter((l) => (!doDepartamento || doDepartamento.has(l.id)) && (codigoDaUnidade === null || l.unidades.includes(codigoDaUnidade)) && !escolhidas.has(l.id))
        .map((l): OpcaoDaBusca => ({ id: l.id, codigo: "", nome: l.rotulo, detalhe: l.codigo })),
    [doDepartamento, codigoDaUnidade, escolhidas, opcoes],
  );
  // As escolhidas, na ordem; a que saiu da Estrutura da DRE (inativa) aparece com o nome gravado.
  const contasEscolhidas = linhasDREIds.map((id) => {
    const l = opcoes.linhas.find((x) => x.id === id);
    const gravada = registro?.contas[registro.linhasDREIds.indexOf(id)];
    return { id, codigo: l?.codigo ?? gravada?.codigo ?? "", rotulo: l?.rotulo ?? gravada?.rotulo ?? "Conta inativa" };
  });
  const incluirConta = (id: string) => {
    setLinhasDREIds((xs) => (xs.includes(id) ? xs : [...xs, id]));
    setBuscaDaConta((n) => n + 1);
  };
  const centros = useMemo(() => opcoes.centros.map((c): OpcaoDaBusca => ({ id: c.id, codigo: c.codigo, nome: c.nome, detalhe: c.detalhe })), [opcoes]);
  const escolherCentro = (i: number, id: string) => setDestinos((xs) => xs.map((x, j) => (j === i ? { ...x, centroCustoId: id } : x)));

  // Os fornecedores com movimentos em qualquer das contas; numa edição, também os marcados que hoje não têm movimentos.
  const fornecedores = useQuery({
    queryKey: [...fonte.chave, departamentoId, [...linhasDREIds].sort().join(",")],
    queryFn: () => fonte.fornecedores(departamentoId || null, linhasDREIds),
    enabled: linhasDREIds.length > 0,
  });
  const linhas = useMemo<LinhaDoFornecedor[] | undefined>(() => {
    if (!fornecedores.data) return undefined;
    const lista: LinhaDoFornecedor[] = fornecedores.data.map((f) => ({ ...f, marcado: marcados.has(chave(f.fornecedor)) }));
    const presentes = new Set(lista.map((f) => chave(f.fornecedor)));
    for (const f of registro?.fornecedores ?? []) {
      if (!presentes.has(chave(f)) && marcados.has(chave(f))) lista.push({ fornecedor: f, movimentos: 0, valor: 0, competencias: "", marcado: true });
    }
    return lista;
  }, [fornecedores.data, marcados, registro]);
  const tabela = useTabelaFiltravel(linhas, COLUNAS);
  const nomes = new Map((linhas ?? []).map((f) => [chave(f.fornecedor), f.fornecedor]));
  const marcadosNaLista = (linhas ?? []).filter((f) => f.marcado);
  const todosFiltradosMarcados = tabela.filtradas.length > 0 && tabela.filtradas.every((f) => f.marcado);
  const alternarTodos = () =>
    setMarcados((atual) => {
      const novo = new Set(atual);
      for (const f of tabela.filtradas) {
        if (todosFiltradosMarcados) novo.delete(chave(f.fornecedor));
        else novo.add(chave(f.fornecedor));
      }
      return novo;
    });
  const alternar = (f: string) =>
    setMarcados((atual) => {
      const novo = new Set(atual);
      if (novo.has(chave(f))) novo.delete(chave(f));
      else novo.add(chave(f));
      return novo;
    });

  // Os destinos: os percentuais lidos e a soma.
  const lidos = destinos.map((d) => ({ ...d, valor: lerNumero(d.texto) }));
  const soma = lidos.reduce((s, d) => s + (typeof d.valor === "number" ? d.valor : 0), 0);
  const somaCerta = Math.abs(soma - 100) <= 0.005;
  const percentualInvalido = lidos.some((d) => d.valor === undefined || (typeof d.valor === "number" && (d.valor <= 0 || d.valor > 100)));
  const centrosRepetidos = new Set(lidos.filter((d) => d.centroCustoId).map((d) => d.centroCustoId)).size !== lidos.filter((d) => d.centroCustoId).length;
  const destinosCompletos = lidos.length > 0 && lidos.every((d) => d.centroCustoId && typeof d.valor === "number");
  const vigenciaCerta = !!mesDoInicio && (!mesDoFim || mesDoFim >= mesDoInicio);
  const pronto = pode && linhasDREIds.length > 0 && marcadosNaLista.length > 0 && destinosCompletos && !percentualInvalido && !centrosRepetidos && somaCerta && vigenciaCerta;

  const concluir = (msg: string, efeito: string) => {
    fonte.aoConcluir(queryClient);
    toast.success([msg, efeito].filter(Boolean).join(" "));
    onFechar();
  };
  const gravar = useMutation({
    mutationFn: () =>
      fonte.gravar(registro?.id ?? null, {
        departamentoId: departamentoId || null,
        linhasDREIds,
        fornecedores: marcadosNaLista.map((f) => nomes.get(chave(f.fornecedor)) ?? f.fornecedor),
        destinos: lidos.map((d) => ({ centroCustoId: d.centroCustoId, percentual: d.valor as number })),
        vigenciaInicio: mesDoInicio,
        vigenciaFim: mesDoFim || null,
        descricao: descricao.trim() || null,
        ativo,
      }),
    onSuccess: (e) => concluir(registro ? "Redistribuição gravada." : "Redistribuição criada.", e),
  });
  const apagar = useMutation({ mutationFn: () => fonte.excluir(registro!.id), onSuccess: (e) => concluir("Redistribuição excluída.", e) });
  const erro = gravar.isError ? mensagemDeErro(gravar.error, "Não foi possível gravar.") : apagar.isError ? mensagemDeErro(apagar.error, "Não foi possível excluir.") : null;

  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="rounded-sm sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Redistribuição de Gastos</DialogTitle>
          <DialogDescription>{fonte.descricao}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
          <div className="space-y-1.5">
            <Label htmlFor="rd-departamento">Departamento da DRE</Label>
            <select
              id="rd-departamento"
              value={departamentoId}
              disabled={!pode}
              onChange={(e) => {
                const novo = e.target.value;
                setDepartamentoId(novo);
                // As contas escolhidas ficam só se forem do departamento novo.
                const doNovo = novo ? new Set(opcoes.departamentos.find((d) => d.id === novo)?.linhas ?? []) : null;
                if (doNovo) setLinhasDREIds((xs) => xs.filter((x) => doNovo.has(x)));
              }}
              className={classeSelect}
            >
              <option value="">Todos</option>
              {opcoes.departamentos.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nome}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rd-unidade">Unidade</Label>
            <select id="rd-unidade" value={unidade} disabled={!pode} onChange={(e) => setUnidade(e.target.value)} className={classeSelect}>
              <option value="">Todas</option>
              {opcoes.unidades.map((u) => (
                <option key={u.codigo} value={String(u.codigo)}>
                  {u.nome}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="rd-conta">Conta da DRE</Label>
            {pode ? (
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <BuscaNaLista
                    key={buscaDaConta}
                    id="rd-conta"
                    opcoes={contas}
                    valor={null}
                    onEscolher={(o) => (o ? incluirConta(o.id) : undefined)}
                    placeholder="Digite parte do nome ou do código da conta para incluí-la"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0 rounded-sm"
                  onClick={() => setConsulta({ tipo: "contas" })}
                  aria-label="Ver todas as contas da DRE e incluir uma"
                  title="Ver todas as contas da DRE e incluir uma"
                >
                  <Search className="size-4" />
                </Button>
              </div>
            ) : null}
            {contasEscolhidas.length ? (
              <ul className="divide-y divide-gray-100 rounded-sm border border-gray-200">
                {contasEscolhidas.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-gray-900" title={c.rotulo}>
                        {c.rotulo}
                      </div>
                      <div className="truncate text-xs text-gray-500">{c.codigo}</div>
                    </div>
                    {pode ? (
                      <button
                        type="button"
                        data-altera
                        aria-label={`Tirar a conta ${c.rotulo}`}
                        title="Tirar a conta"
                        onClick={() => setLinhasDREIds((xs) => xs.filter((x) => x !== c.id))}
                        className="rounded-sm p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-900"
                      >
                        <X className="size-4" />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : !pode ? (
              <Input id="rd-conta" value="" disabled className="rounded-sm" />
            ) : null}
          </div>
        </div>

        {/* Os fornecedores da combinação. */}
        <section className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-bold text-gray-900">Fornecedores</h3>
            {linhas ? (
              <span className="text-xs text-gray-600">
                {marcadosNaLista.length} de {linhas.length} {plural(linhas.length, "fornecedor marcado", "fornecedores marcados")}
              </span>
            ) : null}
          </div>
          {!linhasDREIds.length ? (
            <p className="rounded-sm border border-dashed border-gray-300 px-3 py-4 text-sm text-gray-500">Escolha ao menos uma Conta da DRE para ver os fornecedores com movimentos nelas.</p>
          ) : fornecedores.isPending ? (
            <div className="h-32 animate-pulse rounded-sm bg-gray-100" />
          ) : fornecedores.isError ? (
            <Erro erro={mensagemDeErro(fornecedores.error, "Erro ao carregar os fornecedores.")} />
          ) : !linhas?.length ? (
            <p className="rounded-sm border border-dashed border-gray-300 px-3 py-4 text-sm text-gray-500">Nenhum fornecedor com movimentos nesta combinação de departamento e contas.</p>
          ) : (
            <div className="max-h-72 overflow-auto rounded-sm border border-gray-200">
              <table className="w-full text-sm">
                {tabela.cabecalhoCom({
                  marcar: (
                    <input
                      type="checkbox"
                      aria-label="Marcar todos os fornecedores da tabela"
                      title="Marcar ou desmarcar todos os fornecedores da tabela (com os filtros)"
                      checked={todosFiltradosMarcados}
                      disabled={!pode}
                      onChange={alternarTodos}
                      className="size-4 accent-black"
                    />
                  ),
                })}
                <tbody>
                  {tabela.visiveis.length === 0 ? (
                    <SemResultado colunas={COLUNAS.length} onLimpar={tabela.limpar} />
                  ) : (
                    tabela.visiveis.map((f) => (
                      <tr key={f.fornecedor} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="w-10 px-4 py-2">
                          <input type="checkbox" aria-label={`Marcar ${f.fornecedor}`} checked={f.marcado} disabled={!pode} onChange={() => alternar(f.fornecedor)} className="size-4 accent-black" />
                        </td>
                        <td className="px-4 py-2 text-gray-900">{f.fornecedor}</td>
                        <td className="px-4 py-2 text-right text-gray-700">{f.movimentos.toLocaleString("pt-BR")}</td>
                        <td className="px-4 py-2 text-right text-gray-700">{moeda(f.valor)}</td>
                        <td className="px-4 py-2 text-gray-700">{f.competencias || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Redistribuir Para: os centros e os percentuais. */}
        <section className="space-y-2">
          <h3 className="text-sm font-bold text-gray-900">Redistribuir Para</h3>
          <div className="space-y-2">
            {destinos.map((d, i) => (
              <div key={i} className="grid grid-cols-[1fr_8rem_auto] items-center gap-2">
                {pode ? (
                  <div className="flex gap-2">
                    <div className="min-w-0 flex-1">
                      <BuscaNaLista
                        id={`rd-centro-${i}`}
                        opcoes={centros}
                        valor={centros.find((c) => c.id === d.centroCustoId) ?? null}
                        onEscolher={(o) => escolherCentro(i, o?.id ?? "")}
                        placeholder="Código ou nome do centro de custo"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="shrink-0 rounded-sm"
                      onClick={() => setConsulta({ tipo: "centros", linha: i })}
                      aria-label="Ver todos os centros de custo e escolher um"
                      title="Ver todos os centros de custo e escolher um"
                    >
                      <Search className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <Input value={(() => { const c = centros.find((x) => x.id === d.centroCustoId); return c ? `${c.codigo} — ${c.nome}` : ""; })()} disabled className="rounded-sm" />
                )}
                <div className="relative">
                  <Input
                    aria-label={`Percentual do centro ${i + 1}`}
                    value={d.texto}
                    inputMode="decimal"
                    disabled={!pode}
                    onChange={(e) => setDestinos((xs) => xs.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)))}
                    className={`rounded-sm pr-7 text-right ${lidos[i].valor === undefined || (typeof lidos[i].valor === "number" && (lidos[i].valor! <= 0 || lidos[i].valor! > 100)) ? "border-red-400" : ""}`}
                  />
                  <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-gray-500">%</span>
                </div>
                {pode ? (
                  <button
                    type="button"
                    data-altera
                    aria-label="Tirar o centro"
                    title="Tirar o centro"
                    disabled={destinos.length === 1}
                    onClick={() => setDestinos((xs) => xs.filter((_, j) => j !== i))}
                    className="rounded-sm p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-30"
                  >
                    <X className="size-4" />
                  </button>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {pode ? (
              <Button type="button" variant="outline" size="sm" data-altera className="rounded-sm" onClick={() => setDestinos((xs) => [...xs, { centroCustoId: "", texto: "" }])}>
                <Plus className="size-4" />
                Adicionar Centro
              </Button>
            ) : (
              <span />
            )}
            <span className={`text-sm font-bold ${somaCerta ? "text-gray-900" : "text-red-700"}`}>Soma: {pct(soma)}</span>
          </div>
          {percentualInvalido ? <p className="text-xs text-red-700">Cada percentual precisa ser maior que 0% e no máximo 100%.</p> : null}
          {centrosRepetidos ? <p className="text-xs text-red-700">Um centro de custo aparece mais de uma vez.</p> : null}
        </section>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="rd-inicio">Vigência: Início</Label>
            <Input id="rd-inicio" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} disabled={!pode} className="rounded-sm" title="A redistribuição vale a partir do mês da data escolhida" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rd-fim">Vigência: Fim (opcional)</Label>
            <Input
              id="rd-fim"
              type="date"
              value={fim}
              onChange={(e) => setFim(e.target.value)}
              disabled={!pode}
              title="A redistribuição vale até o mês da data escolhida, inteiro"
              className={`rounded-sm ${mesDoFim && mesDoInicio && mesDoFim < mesDoInicio ? "border-red-400" : ""}`}
            />
          </div>
          <p className="-mt-2 text-xs text-gray-500 sm:col-span-2">A vigência é por mês: a data escolhida vale o mês inteiro dela, do primeiro ao último dia.</p>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="rd-descricao">Descrição (opcional)</Label>
            <Input id="rd-descricao" value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={500} disabled={!pode} className="rounded-sm" />
          </div>
          <label className="flex h-9 items-center gap-2 text-sm text-gray-900">
            <input type="checkbox" checked={ativo} disabled={!pode} onChange={(e) => setAtivo(e.target.checked)} className="size-4 accent-black" />
            Ativa
          </label>
        </div>

        <Erro erro={erro} />
        {pode ? (
          <DialogFooter>
            {registro ? (
              <Button type="button" variant="outline" className="rounded-sm border-red-300 text-red-700 hover:bg-red-50 sm:mr-auto" onClick={() => setExcluindo(true)}>
                <Trash2 className="size-4" />
                Excluir
              </Button>
            ) : null}
            <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
              Cancelar
            </Button>
            <Button type="button" className={botaoPrimario} disabled={!pronto || gravar.isPending} onClick={() => gravar.mutate()}>
              {gravar.isPending ? "Gravando…" : "Gravar"}
            </Button>
          </DialogFooter>
        ) : null}
        {excluindo && registro ? (
          <ConfirmacaoDialog
            titulo="Excluir a Redistribuição"
            descricao={fonte.descricaoDaExclusao(nomeDasContas(registro.contas))}
            pendente={apagar.isPending}
            onConfirmar={() => apagar.mutate(undefined, { onSettled: () => setExcluindo(false) })}
            onFechar={() => setExcluindo(false)}
          />
        ) : null}
        {consulta?.tipo === "contas" ? (
          <ContasDaDREDialog
            contas={opcoes.linhas}
            unidades={opcoes.unidades}
            doDepartamento={doDepartamento}
            nomeDoDepartamento={departamentoId ? (opcoes.departamentos.find((d) => d.id === departamentoId)?.nome ?? null) : null}
            unidade={codigoDaUnidade}
            escolhidas={escolhidas}
            onEscolher={(c) => {
              incluirConta(c.id);
              setConsulta(null);
            }}
            onFechar={() => setConsulta(null)}
          />
        ) : null}
        {consulta?.tipo === "centros" ? (
          <CentrosDeCustoDialog
            centros={opcoes.centros}
            descricao="Clique num centro para escolhê-lo nesta linha de Redistribuir Para. São os centros de custo ativos, com o departamento, o grupo, a atribuição e o balde."
            onEscolher={(c) => {
              escolherCentro(consulta.linha, c.id);
              setConsulta(null);
            }}
            onFechar={() => setConsulta(null)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
