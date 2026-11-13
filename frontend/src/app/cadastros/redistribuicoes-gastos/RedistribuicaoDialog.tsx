"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
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
import { lerNumero } from "@/app/cenarios/components/EdicaoDialogs";
import { mensagemDeErro } from "../services/edicaoService";
import {
  redistribuicoesService as servico,
  type EfeitoDaRedistribuicao,
  type FornecedorDaCombinacao,
  type OpcoesDaRedistribuicao,
  type Redistribuicao,
} from "../services/redistribuicoesService";

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
const COLUNAS: Coluna<LinhaDoFornecedor>[] = [
  { chave: "marcar", rotulo: "", semFiltro: true, classe: "w-10" },
  { chave: "fornecedor", rotulo: "Fornecedor", valor: (f) => f.fornecedor },
  { chave: "movimentos", rotulo: "Movimentos", valor: (f) => f.movimentos, tipo: "numero", alinhamento: "direita" },
  { chave: "valor", rotulo: "Valor", valor: (f) => f.valor, texto: (f) => moeda(f.valor), tipo: "numero", alinhamento: "direita" },
  { chave: "competencias", rotulo: "Competências", valor: (f) => f.competencias },
];

/**
 * O modal Redistribuição de Gastos (13/11/2026, pedido do Adão): o Departamento da DRE (ou Todos) e a Conta da DRE, os
 * fornecedores com movimentos na combinação (de competências fechadas ou abertas; a tabela com os filtros nos rótulos e a
 * caixa de cada um e a de todos), os centros de Redistribuir Para com o percentual de cada um (somando 100%) e a vigência.
 */
export function RedistribuicaoDialog({ registro, opcoes, pode, onFechar }: { registro: Redistribuicao | null; opcoes: OpcoesDaRedistribuicao; pode: boolean; onFechar: () => void }) {
  const queryClient = useQueryClient();
  const [departamentoId, setDepartamentoId] = useState(registro?.departamentoId ?? "");
  const [linhaDREId, setLinhaDREId] = useState(registro?.linhaDREId ?? "");
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set((registro?.fornecedores ?? []).map(chave)));
  const [destinos, setDestinos] = useState<Array<{ centroCustoId: string; texto: string }>>(() =>
    registro ? registro.destinos.map((d) => ({ centroCustoId: d.centroCustoId, texto: d.percentual.toLocaleString("pt-BR", { maximumFractionDigits: 4 }) })) : [{ centroCustoId: "", texto: "" }],
  );
  const [inicio, setInicio] = useState(registro?.vigenciaInicio ?? "");
  const [fim, setFim] = useState(registro?.vigenciaFim ?? "");
  const [descricao, setDescricao] = useState(registro?.descricao ?? "");
  const [ativo, setAtivo] = useState(registro?.ativo ?? true);
  const [excluindo, setExcluindo] = useState(false);

  // As contas da DRE do departamento escolhido (Todos: todas).
  const contas = useMemo(() => {
    const doDepartamento = departamentoId ? new Set(opcoes.departamentos.find((d) => d.id === departamentoId)?.linhas ?? []) : null;
    return opcoes.linhas.filter((l) => !doDepartamento || doDepartamento.has(l.id)).map((l): OpcaoDaBusca => ({ id: l.id, codigo: "", nome: l.rotulo, detalhe: l.codigo }));
  }, [departamentoId, opcoes]);
  const conta = contas.find((c) => c.id === linhaDREId) ?? null;
  const centros = useMemo(() => opcoes.centros.map((c): OpcaoDaBusca => ({ id: c.id, codigo: c.codigo, nome: c.nome, detalhe: c.detalhe })), [opcoes]);

  // Os fornecedores com movimentos na combinação; numa edição, também os marcados que hoje não têm movimentos.
  const fornecedores = useQuery({
    queryKey: ["cadastros", "redistribuicoes", "fornecedores", departamentoId, linhaDREId],
    queryFn: () => servico.fornecedores(departamentoId || null, linhaDREId),
    enabled: !!linhaDREId,
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
  const vigenciaCerta = !!inicio && (!fim || fim >= inicio);
  const pronto = pode && !!linhaDREId && marcadosNaLista.length > 0 && destinosCompletos && !percentualInvalido && !centrosRepetidos && somaCerta && vigenciaCerta;

  const concluir = (msg: string, e: EfeitoDaRedistribuicao) => {
    queryClient.invalidateQueries({ queryKey: ["cadastros", "redistribuicoes"] });
    atualizarCompetencia(queryClient);
    toast.success([msg, textoDoEfeito(e)].filter(Boolean).join(" "));
    onFechar();
  };
  const gravar = useMutation({
    mutationFn: () =>
      servico.gravar(registro?.id ?? null, {
        departamentoId: departamentoId || null,
        linhaDREId,
        fornecedores: marcadosNaLista.map((f) => nomes.get(chave(f.fornecedor)) ?? f.fornecedor),
        destinos: lidos.map((d) => ({ centroCustoId: d.centroCustoId, percentual: d.valor as number })),
        vigenciaInicio: inicio,
        vigenciaFim: fim || null,
        descricao: descricao.trim() || null,
        ativo,
      }),
    onSuccess: (e) => concluir(registro ? "Redistribuição gravada." : "Redistribuição criada.", e),
  });
  const apagar = useMutation({ mutationFn: () => servico.excluir(registro!.id), onSuccess: (e) => concluir("Redistribuição excluída.", e) });
  const erro = gravar.isError ? mensagemDeErro(gravar.error, "Não foi possível gravar.") : apagar.isError ? mensagemDeErro(apagar.error, "Não foi possível excluir.") : null;

  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="rounded-sm sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Redistribuição de Gastos</DialogTitle>
          <DialogDescription>
            Os movimentos dos fornecedores marcados, na Conta da DRE (e no departamento), valem divididos entre os centros de custo de Redistribuir
            Para, pelos percentuais, nas competências da vigência. Movimentos redistribuídos não podem ser contestados.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="rd-departamento">Departamento da DRE</Label>
            <select
              id="rd-departamento"
              value={departamentoId}
              disabled={!pode}
              onChange={(e) => {
                const novo = e.target.value;
                setDepartamentoId(novo);
                // A conta escolhida fica só se for do departamento novo.
                const doNovo = novo ? new Set(opcoes.departamentos.find((d) => d.id === novo)?.linhas ?? []) : null;
                if (doNovo && linhaDREId && !doNovo.has(linhaDREId)) setLinhaDREId("");
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
            <Label htmlFor="rd-conta">Conta da DRE</Label>
            {pode ? (
              <BuscaNaLista id="rd-conta" opcoes={contas} valor={conta} onEscolher={(o) => setLinhaDREId(o?.id ?? "")} placeholder="Digite parte do nome ou do código da conta" />
            ) : (
              <Input id="rd-conta" value={conta?.nome ?? ""} disabled className="rounded-sm" />
            )}
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
          {!linhaDREId ? (
            <p className="rounded-sm border border-dashed border-gray-300 px-3 py-4 text-sm text-gray-500">Escolha a Conta da DRE para ver os fornecedores com movimentos nela.</p>
          ) : fornecedores.isPending ? (
            <div className="h-32 animate-pulse rounded-sm bg-gray-100" />
          ) : fornecedores.isError ? (
            <Erro erro={mensagemDeErro(fornecedores.error, "Erro ao carregar os fornecedores.")} />
          ) : !linhas?.length ? (
            <p className="rounded-sm border border-dashed border-gray-300 px-3 py-4 text-sm text-gray-500">Nenhum fornecedor com movimentos nesta combinação de departamento e conta.</p>
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
                  <BuscaNaLista
                    id={`rd-centro-${i}`}
                    opcoes={centros}
                    valor={centros.find((c) => c.id === d.centroCustoId) ?? null}
                    onEscolher={(o) => setDestinos((xs) => xs.map((x, j) => (j === i ? { ...x, centroCustoId: o?.id ?? "" } : x)))}
                    placeholder="Código ou nome do centro de custo"
                  />
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
          {!somaCerta && !percentualInvalido ? <p className="text-xs text-red-700">Os percentuais precisam somar 100% (faltam {pct(100 - soma)}).</p> : null}
          {percentualInvalido ? <p className="text-xs text-red-700">Cada percentual precisa ser maior que 0% e no máximo 100%.</p> : null}
          {centrosRepetidos ? <p className="text-xs text-red-700">Um centro de custo aparece mais de uma vez.</p> : null}
        </section>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="rd-inicio">Vigência: Início</Label>
            <Input id="rd-inicio" type="month" placeholder="AAAA-MM" value={inicio} onChange={(e) => setInicio(e.target.value)} disabled={!pode} className="rounded-sm" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rd-fim">Vigência: Fim (opcional)</Label>
            <Input id="rd-fim" type="month" placeholder="AAAA-MM" value={fim} onChange={(e) => setFim(e.target.value)} disabled={!pode} className={`rounded-sm ${fim && inicio && fim < inicio ? "border-red-400" : ""}`} />
          </div>
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
            descricao={`A redistribuição de ${registro.conta.rotulo} sai do cadastro, e as competências ainda não apuradas da vigência voltam a ser classificadas sem ela. Já usada numa competência apurada ou fechada, ela não se exclui: encerre a vigência.`}
            pendente={apagar.isPending}
            onConfirmar={() => apagar.mutate(undefined, { onSettled: () => setExcluindo(false) })}
            onFechar={() => setExcluindo(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
