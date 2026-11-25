"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmacaoDialog } from "@/components/shared/ConfirmacaoDialog";
import { ExportarTabela } from "@/components/shared/ExportarTabela";
import { SemResultado, useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Coluna } from "@/lib/filtrosDeTabela";
import { plural } from "@/lib/texto";

import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";

import {
  cenariosService,
  type CelulaDoIndice,
  type CombinacaoDoIndice,
  type IndiceDeComparacao,
  type IndiceDosReajustes,
  type ReajustesDasPremissas,
  type UniversoDosIndices,
  type VendaDoIndice,
} from "../services/cenariosService";
import { botaoPrimario, Erro } from "./CenarioDialog";
import { Destaque, LinhaVazia, TabelaComDestaque, TD } from "./DestaqueDaAba";
import { lerNumero } from "./EdicaoDialogs";

/**
 * Os Índices de Comparação e os Índices de Reajuste dos cenários analíticos (21/11/2026, pedido do Adão), na aba Comparativo e
 * Reajustes das Configurações: cada lista numa tabela, como a dos Centros de Custo — clicar numa linha abre o índice no modal, e
 * gravar o modal atualiza a tabela. No modal, além da descrição, da observação e da variação máxima (ou dos até quatro
 * reajustes), as combinações de Unidade, Departamento, Atribuição e Conta (e, nos reajustes, a Venda) em que o índice vale: uma
 * unidade inteira, um departamento de uma unidade, uma atribuição ou só uma conta. A mesma conta não pode estar em duas
 * combinações nem em dois índices do mesmo tipo: o aviso no rodapé do modal impede a gravação. Antes, as tabelas Linha da DRE
 * (Variações Máximas e Aplicação dos Reajustes) escolhiam o índice de cada conta, e os botões “Gravar Índices” gravavam as listas.
 */

/** O percentual no campo: duas casas, sem separador de milhar (fácil de editar). */
const duasCasas = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
/** Os reajustes de cada índice: até quatro, cada um sobre os anteriores. */
const GRUPOS = [0, 1, 2, 3];
const ORDINAL = ["1º", "2º", "3º", "4º"];
const NOME_DA_VENDA: Record<VendaDoIndice, string> = { GLOBAL: "Global", MERCANTIL: "Mercantil" };
const CUMULATIVOS = "Para considerar percentuais cumulativos, use o cálculo “((1+R1)*(1+R2)*(1+RN...))-1” antes de inserir o percentual adotado.";

type Meses = ReajustesDasPremissas["meses"];
type Tipo = UniversoDosIndices["tipo"];
type Deps = Map<string, UniversoDosIndices["departamentos"][number]>;
const rotuloDoMes = (meses: Meses, mes: number) => meses.find((m) => m.mes === mes)?.rotulo ?? String(mes);
/** Os reajustes de um índice numa linha ("4,00% em JAN/27, 2,00% em ABR/27"). */
const textoDosReajustes = (r: Array<{ valor: number; mes: number }>, meses: Meses) => r.map((x) => `${duasCasas(Number(x.valor))}% em ${rotuloDoMes(meses, x.mes)}`).join(", ");
const departamentosDe = (u: UniversoDosIndices): Deps => new Map(u.departamentos.map((d) => [d.id, d]));

/** As atribuições do departamento Receita Operacional (21/11/2026): os grupos da receita (como no servidor). */
const ATRIBUICOES_DA_RECEITA = new Set(["ROB", "IRB", "ROL"]);
/** A conta está na atribuição: a sigla dela ou, nas da Receita Operacional, o grupo. */
const naAtribuicaoDe = (c: CelulaDoIndice, atribuicao: string) => c.atribuicao === atribuicao || (ATRIBUICOES_DA_RECEITA.has(atribuicao) && c.grupo === atribuicao);

/** Se a combinação alcança a conta (como no servidor: indicesCenario.alcanca). */
function alcanca(k: CombinacaoDoIndice, c: CelulaDoIndice, deps: Deps) {
  if (k.unidade !== null && c.unidade !== k.unidade) return false;
  if (k.departamento !== null) {
    const d = deps.get(k.departamento);
    if (!d || d.unidade !== c.unidade || !d.grupos.includes(c.grupo)) return false;
  }
  if (k.atribuicao !== null && !naAtribuicaoDe(c, k.atribuicao)) return false;
  if (k.conta !== null && c.conta !== k.conta) return false;
  if (k.venda !== null && c.venda !== k.venda) return false;
  return true;
}
const celulasDe = (k: CombinacaoDoIndice, u: UniversoDosIndices, deps: Deps) => u.celulas.filter((c) => alcanca(k, c, deps));
/** Quantas contas (cada conta numa unidade; as duas vendas, uma só). */
const contasDas = (cs: CelulaDoIndice[]) => new Set(cs.map((c) => `${c.unidade}|${c.codigo}`)).size;
/** O nome da atribuição com a sigla ("Mão de Obra Direta (MOD)"). */
const nomeDaAtribuicao = (u: UniversoDosIndices, chave: string) => {
  const nome = u.atribuicoes.find((a) => a.chave === chave)?.nome ?? chave;
  return nome.includes(`(${chave})`) ? nome : `${nome} (${chave})`;
};

/** O texto de uma combinação ("Matriz · Produção · Mão de Obra Direta (MOD)"; sem escolha nenhuma, "Todas as Contas"). */
function textoDaCombinacao(k: CombinacaoDoIndice, u: UniversoDosIndices, deps: Deps) {
  const partes = [
    k.unidade === null ? null : (u.unidades.find((x) => x.codigo === k.unidade)?.nome ?? `Unidade ${k.unidade}`),
    k.departamento === null ? null : (deps.get(k.departamento)?.nome ?? "departamento excluído"),
    k.atribuicao === null ? null : nomeDaAtribuicao(u, k.atribuicao),
    k.conta === null ? null : (u.contas.find((c) => c.chave === k.conta)?.nome ?? k.conta),
    k.venda ? NOME_DA_VENDA[k.venda] : null,
  ].filter((x): x is string => !!x);
  if (!partes.length) return "Todas as Contas";
  return k.unidade === null ? `Todas as Unidades · ${partes.join(" · ")}` : partes.join(" · ");
}
const textoDasCombinacoes = (ks: CombinacaoDoIndice[], u: UniversoDosIndices, deps: Deps) => ks.map((k) => textoDaCombinacao(k, u, deps)).join("; ");

/** As escolhas de cada campo de uma combinação, pelos campos à esquerda dele (as listas em cascata). */
function opcoesDa(k: CombinacaoDoIndice, u: UniversoDosIndices, deps: Deps) {
  const dep = k.departamento ? deps.get(k.departamento) : undefined;
  const naUnidade = u.celulas.filter((c) => k.unidade === null || c.unidade === k.unidade);
  const noDepartamento = naUnidade.filter((c) => !k.departamento || (!!dep && dep.unidade === c.unidade && dep.grupos.includes(c.grupo)));
  const naAtribuicao = noDepartamento.filter((c) => k.atribuicao === null || naAtribuicaoDe(c, k.atribuicao));
  return {
    departamentos: k.unidade === null ? [] : u.departamentos.filter((d) => d.unidade === k.unidade && (d.ativo || d.id === k.departamento)),
    // No departamento Receita Operacional, os grupos (Receita Operacional Bruta, Impostos Operacionais e Receita Operacional Líquida).
    atribuicoes: dep?.porGrupo
      ? u.atribuicoes.filter((a) => dep.grupos.includes(a.chave) && noDepartamento.some((c) => c.grupo === a.chave))
      : u.atribuicoes.filter((a) => !ATRIBUICOES_DA_RECEITA.has(a.chave) && noDepartamento.some((c) => c.atribuicao === a.chave)),
    contas: u.contas.filter((x) => naAtribuicao.some((c) => c.conta === x.chave)),
  };
}

/** A combinação sem os campos que deixaram de valer depois de uma mudança à esquerda (voltam a "Todas"). */
function ajustada(k: CombinacaoDoIndice, u: UniversoDosIndices, deps: Deps): CombinacaoDoIndice {
  const r = { ...k };
  if (r.departamento && (r.unidade === null || deps.get(r.departamento)?.unidade !== r.unidade)) r.departamento = null;
  if (r.atribuicao && !opcoesDa(r, u, deps).atribuicoes.some((a) => a.chave === r.atribuicao)) r.atribuicao = null;
  if (r.conta && !opcoesDa(r, u, deps).contas.some((c) => c.chave === r.conta)) r.conta = null;
  return r;
}

const algumas = (xs: string[], n = 2) => (xs.length <= n ? xs.join("; ") : `${xs.slice(0, n).join("; ")} e mais ${xs.length - n}`);

/**
 * Os avisos das combinações do índice no modal (os mesmos do servidor): a combinação sem contas, as contas repetidas entre as
 * combinações do índice e as que já estão em outro índice. `ruins`: as combinações com aviso.
 */
function avisosDasCombinacoes(ks: CombinacaoDoIndice[], outros: Array<{ descricao: string; combinacoes: CombinacaoDoIndice[] }>, u: UniversoDosIndices, deps: Deps) {
  const ruins = new Set<number>();
  const avisos: string[] = [];
  const deOutroIndice = new Map<string, string>();
  for (const o of outros) for (const k of o.combinacoes) for (const c of celulasDe(k, u, deps)) if (!deOutroIndice.has(c.chave)) deOutroIndice.set(c.chave, o.descricao);
  const daCombinacao = new Map<string, number>();
  ks.forEach((k, n) => {
    const qual = `Combinação ${n + 1}`;
    const cs = celulasDe(k, u, deps);
    if (!cs.length) avisos.push(`${qual}: não alcança nenhuma conta.`);
    const repetidas = new Map<number, string[]>();
    const deOutro = new Map<string, string[]>();
    for (const c of cs) {
      const antes = daCombinacao.get(c.chave);
      if (antes === undefined) daCombinacao.set(c.chave, n);
      else repetidas.set(antes, [...(repetidas.get(antes) ?? []), c.descricao]);
      const outro = deOutroIndice.get(c.chave);
      if (outro) deOutro.set(outro, [...(deOutro.get(outro) ?? []), c.descricao]);
    }
    for (const [antes, contas] of repetidas) avisos.push(`${qual}: repete contas da combinação ${antes + 1} — ${algumas(contas)}.`);
    for (const [outro, contas] of deOutro) avisos.push(`${qual}: alcança contas que já estão no índice ${outro} — ${algumas(contas)}.`);
    if (!cs.length || avisos.some((a) => a.startsWith(`${qual}:`))) ruins.add(n);
  });
  return { ruins, avisos };
}

type Grupo = { valor: string; mes: string };
/** Os grupos (reajustes) com erro: fora de ordem, incompletos ou um vazio antes de um preenchido; e a falta de reajuste. */
function errosDosGrupos(grupos: Grupo[]) {
  const preenchido = (g: Grupo) => !!g.valor.trim() || !!g.mes;
  const ultimo = Math.max(-1, ...GRUPOS.filter((k) => preenchido(grupos[k])));
  const ruins = new Set<number>();
  let anterior = 0;
  for (const k of GRUPOS) {
    const g = grupos[k];
    if (!preenchido(g)) {
      if (k < ultimo) ruins.add(k);
      continue;
    }
    const v = lerNumero(g.valor);
    const mes = Number(g.mes);
    if (typeof v !== "number" || v <= -100 || !g.mes || mes <= anterior) ruins.add(k);
    if (g.mes) anterior = Math.max(anterior, mes);
  }
  return { ruins, semReajuste: ultimo < 0 };
}

// ---------------------------------------------------------------------------------------------------------- Índices de Comparação

type LinhaDeComparacao = IndiceDeComparacao & { contas: number };

/** Os Índices de Comparação (antes, de Referência): a tabela, com o “Novo Índice” e o Exportar, e o modal de cada índice. */
export function IndicesDeComparacao({ id, podeEditar }: { id: string; podeEditar: boolean }) {
  const consulta = useQuery({ queryKey: ["cenarios", id, "indices"], queryFn: () => cenariosService.indices(id) });
  const [aberto, setAberto] = useState<LinhaDeComparacao | "novo" | null>(null);
  const universo = consulta.data?.universo;
  const deps = useMemo(() => (universo ? departamentosDe(universo) : new Map() as Deps), [universo]);
  const colunas = useMemo<Coluna<LinhaDeComparacao>[]>(
    () => [
      { chave: "descricao", rotulo: "Descrição", valor: (i) => i.descricao },
      { chave: "observacao", rotulo: "Observação", valor: (i) => i.observacao ?? "" },
      { chave: "variacao", rotulo: "Variação Máxima (%)", tipo: "numero", alinhamento: "direita", valor: (i) => Number(i.variacao), texto: (i) => duasCasas(Number(i.variacao)) },
      { chave: "combinacoes", rotulo: "Combinações", valor: (i) => (universo ? textoDasCombinacoes(i.combinacoes, universo, deps) : "") },
      { chave: "contas", rotulo: "Contas", tipo: "numero", alinhamento: "direita", valor: (i) => i.contas },
    ],
    [universo, deps],
  );
  const tabela = useTabelaFiltravel(consulta.data?.indices, colunas);
  if (consulta.isError) return <Erro erro={mensagemDeErro(consulta.error, "Erro ao carregar os Índices de Comparação.")} />;
  if (consulta.isPending || !universo) return <div className="h-48 animate-pulse rounded-sm bg-gray-100" />;
  const indices = consulta.data.indices;
  const destaque = (
    <Destaque
      titulo="Índices de Comparação"
      descricao="A variação máxima aceita (em %, para mais ou para menos), contra o cenário comparado, nas contas das combinações de cada índice. Clique numa linha para abrir o índice."
    >
      {podeEditar ? (
        <Button type="button" className={botaoPrimario} onClick={() => setAberto("novo")}>
          <Plus className="size-4" />
          Novo Índice
        </Button>
      ) : null}
      <ExportarTabela titulo="Cenário · Comparativo e Reajustes · Índices de Comparação" colunas={colunas} linhas={tabela.filtradas} />
    </Destaque>
  );
  return (
    <>
      <TabelaComDestaque
        destaque={destaque}
        larguras={[240, 260, 170, 560, 110]}
        cabecalho={tabela.linhaDoCabecalho}
        corpo={
          indices.length === 0 ? (
            <LinhaVazia colunas={colunas.length} texto={`Nenhum Índice de Comparação ainda.${podeEditar ? " Use “Novo Índice”." : ""}`} />
          ) : tabela.visiveis.length === 0 ? (
            <SemResultado colunas={colunas.length} onLimpar={tabela.limpar} />
          ) : (
            tabela.visiveis.map((i) => {
              const combinacoes = textoDasCombinacoes(i.combinacoes, universo, deps);
              return (
                <tr key={i.chave} className="cursor-pointer border-t border-gray-100 hover:bg-gray-100" onClick={() => setAberto(i)} title={podeEditar ? "Editar o índice" : "Ver o índice"}>
                  <td className={`${TD} font-medium`}>{i.descricao}</td>
                  <td className={TD}>{i.observacao ?? ""}</td>
                  <td className={`${TD} text-right`}>{duasCasas(Number(i.variacao))}</td>
                  <td className={TD} title={combinacoes || undefined}>
                    {combinacoes || <span className="text-gray-400">Nenhuma combinação</span>}
                  </td>
                  <td className={`${TD} text-right`}>{i.contas ? `${i.contas} ${plural(i.contas, "conta", "contas")}` : "—"}</td>
                </tr>
              );
            })
          )
        }
      />
      {aberto ? (
        <IndiceDialog
          tipo="COMPARACAO"
          universo={universo}
          meses={[]}
          indice={aberto === "novo" ? null : aberto}
          outros={indices.filter((x) => aberto === "novo" || x.chave !== aberto.chave)}
          podeEditar={podeEditar}
          aplicados={false}
          gravar={(editado) => {
            const original = aberto === "novo" ? null : aberto.chave;
            const comoEstao = indices.map((x) => ({ chave: x.chave, descricao: x.descricao, observacao: x.observacao, variacao: Number(x.variacao), combinacoes: x.combinacoes }));
            const doModal = editado ? { chave: original, descricao: editado.descricao, observacao: editado.observacao, variacao: editado.variacao ?? 0, combinacoes: editado.combinacoes } : null;
            const lista = original === null ? [...comoEstao, doModal!] : comoEstao.flatMap((x) => (x.chave === original ? (doModal ? [doModal] : []) : [x]));
            return cenariosService.gravarIndices(id, lista);
          }}
          onFechar={() => setAberto(null)}
        />
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------------------------------------------------ Índices de Reajuste

type LinhaDeReajuste = IndiceDosReajustes & { contas: number };

/**
 * Os Índices de Reajuste: o aviso da caixa Aplicar Reajustes (21/11/2026: nos Resultados, antes do Recalcular; antes, o botão
 * Aplicar / Remover Reajustes deste quadro), a tabela (com a coluna Reajustes, do 1º ao 4º numa só), o “Novo Índice” e o Exportar,
 * e o modal de cada índice.
 */
export function IndicesDeReajuste({ id, podeEditar }: { id: string; podeEditar: boolean }) {
  const consulta = useQuery({ queryKey: ["cenarios", id, "reajustesDasPremissas"], queryFn: () => cenariosService.reajustesDasPremissas(id) });
  const [aberto, setAberto] = useState<LinhaDeReajuste | "novo" | null>(null);
  const dados = consulta.data;
  const universo = dados?.universo;
  const deps = useMemo(() => (universo ? departamentosDe(universo) : new Map() as Deps), [universo]);
  const meses = useMemo(() => dados?.meses ?? [], [dados]);
  const colunas = useMemo<Coluna<LinhaDeReajuste>[]>(
    () => [
      { chave: "descricao", rotulo: "Descrição", valor: (i) => i.descricao },
      { chave: "observacao", rotulo: "Observação", valor: (i) => i.observacao ?? "" },
      { chave: "reajustes", rotulo: "Reajustes", valor: (i) => textoDosReajustes(i.reajustes, meses) },
      { chave: "combinacoes", rotulo: "Combinações", valor: (i) => (universo ? textoDasCombinacoes(i.combinacoes, universo, deps) : "") },
      { chave: "contas", rotulo: "Contas", tipo: "numero", alinhamento: "direita", valor: (i) => i.contas },
    ],
    [universo, deps, meses],
  );
  const tabela = useTabelaFiltravel(dados?.indices, colunas);
  if (consulta.isError) return <Erro erro={mensagemDeErro(consulta.error, "Erro ao carregar os Índices de Reajuste.")} />;
  if (!dados || !universo) return <div className="h-48 animate-pulse rounded-sm bg-gray-100" />;
  const pode = podeEditar && dados.editavel;
  const destaque = (
    <Destaque
      titulo="Índices de Reajuste"
      descricao="Até quatro reajustes por índice (o Valor (%) e o mês em que ele Inicia Em, cada um sobre os anteriores, até o fim do exercício), nas contas das combinações dele. Clique numa linha para abrir o índice."
    >
      {pode ? (
        <Button type="button" className={botaoPrimario} onClick={() => setAberto("novo")}>
          <Plus className="size-4" />
          Novo Índice
        </Button>
      ) : null}
      <ExportarTabela titulo="Cenário · Comparativo e Reajustes · Índices de Reajuste" colunas={colunas} linhas={tabela.filtradas} />
    </Destaque>
  );
  return (
    <div className="space-y-4">
      <p className={`rounded-sm border border-l-4 border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-700 ${dados.aplicados ? "border-l-bpm-primary" : "border-l-red-600"}`}>
        {dados.aplicados ? (
          <>
            <span className="font-bold text-gray-900">Aplicar Reajustes marcado.</span> A DRE tem os reajustes depois do “Recalcular”, nos Resultados. As
            Configurações e as abas das Premissas (menos Indicadores Manuais) ficam bloqueadas para edição; gravar um Índice de Reajuste deixa a DRE
            pendente de recálculo. Para voltar a editar, desmarque a caixa nos Resultados.
          </>
        ) : (
          <>
            <span className="font-bold text-gray-900">Reajustes não aplicados na DRE.</span> Para aplicá-los, marque “Aplicar Reajustes”, nos Resultados, e
            clique em “Recalcular”.
          </>
        )}
      </p>
      <TabelaComDestaque
        destaque={destaque}
        larguras={[220, 220, 330, 460, 110]}
        cabecalho={tabela.linhaDoCabecalho}
        corpo={
          dados.indices.length === 0 ? (
            <LinhaVazia colunas={colunas.length} texto={`Nenhum Índice de Reajuste ainda.${pode ? " Use “Novo Índice”." : ""}`} />
          ) : tabela.visiveis.length === 0 ? (
            <SemResultado colunas={colunas.length} onLimpar={tabela.limpar} />
          ) : (
            tabela.visiveis.map((i) => {
              const combinacoes = textoDasCombinacoes(i.combinacoes, universo, deps);
              const reajustes = textoDosReajustes(i.reajustes, meses);
              return (
                <tr key={i.chave} className="cursor-pointer border-t border-gray-100 hover:bg-gray-100" onClick={() => setAberto(i)} title={pode ? "Editar o índice" : "Ver o índice"}>
                  <td className={`${TD} font-medium`}>{i.descricao}</td>
                  <td className={TD}>{i.observacao ?? ""}</td>
                  <td className={TD} title={reajustes}>
                    {reajustes}
                  </td>
                  <td className={TD} title={combinacoes || undefined}>
                    {combinacoes || <span className="text-gray-400">Nenhuma combinação</span>}
                  </td>
                  <td className={`${TD} text-right`}>{i.contas ? `${i.contas} ${plural(i.contas, "conta", "contas")}` : "—"}</td>
                </tr>
              );
            })
          )
        }
      />
      {aberto ? (
        <IndiceDialog
          tipo="REAJUSTE"
          universo={universo}
          meses={meses}
          indice={aberto === "novo" ? null : aberto}
          outros={dados.indices.filter((x) => aberto === "novo" || x.chave !== aberto.chave)}
          podeEditar={pode}
          aplicados={dados.aplicados}
          gravar={(editado) => {
            const original = aberto === "novo" ? null : aberto.chave;
            const comoEstao = dados.indices.map((x) => ({ chave: x.chave, descricao: x.descricao, observacao: x.observacao, reajustes: x.reajustes, combinacoes: x.combinacoes }));
            const doModal = editado ? { chave: original, descricao: editado.descricao, observacao: editado.observacao, reajustes: editado.reajustes ?? [], combinacoes: editado.combinacoes } : null;
            const lista = original === null ? [...comoEstao, doModal!] : comoEstao.flatMap((x) => (x.chave === original ? (doModal ? [doModal] : []) : [x]));
            return cenariosService.gravarIndicesDosReajustes(id, lista);
          }}
          onFechar={() => setAberto(null)}
        />
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------------------------------------------------------------- O modal do índice

/** O que o modal grava: os campos do índice (a variação, nos de comparação; os reajustes, nos de reajuste) e as combinações. */
type IndiceEditado = {
  descricao: string;
  observacao: string | null;
  variacao?: number;
  reajustes?: Array<{ valor: number; mes: number }>;
  combinacoes: CombinacaoDoIndice[];
};

/**
 * O modal de um Índice de Comparação ou de Reajuste (novo ou existente): a Descrição, a Observação, a Variação Máxima (ou os até
 * quatro reajustes) e as combinações, uma por linha — cada campo em cascata (o Departamento lista os da Unidade; a Atribuição, as do
 * Departamento; a Conta, as da Atribuição), com quantas contas ela alcança. Os avisos (as contas repetidas no índice ou já em outro
 * índice, a combinação sem contas) ficam no rodapé e impedem o “Gravar”. Sem a permissão de editar, só se lê.
 */
function IndiceDialog({
  tipo,
  universo,
  meses,
  indice,
  outros,
  podeEditar,
  aplicados,
  gravar,
  onFechar,
}: {
  tipo: Tipo;
  universo: UniversoDosIndices;
  meses: Meses;
  indice: (IndiceDeComparacao | IndiceDosReajustes) | null;
  outros: Array<{ descricao: string; combinacoes: CombinacaoDoIndice[] }>;
  podeEditar: boolean;
  aplicados: boolean;
  /** Grava a lista com o índice editado (nulo: sem ele, a exclusão). */
  gravar: (editado: IndiceEditado | null) => Promise<unknown>;
  onFechar: () => void;
}) {
  const queryClient = useQueryClient();
  const reajuste = tipo === "REAJUSTE";
  const deps = useMemo(() => departamentosDe(universo), [universo]);
  const [descricao, setDescricao] = useState(indice?.descricao ?? "");
  const [observacao, setObservacao] = useState(indice?.observacao ?? "");
  const [variacao, setVariacao] = useState(indice && "variacao" in indice ? duasCasas(Number(indice.variacao)) : "");
  const [grupos, setGrupos] = useState<Grupo[]>(() =>
    GRUPOS.map((k) => {
      const r = indice && "reajustes" in indice ? indice.reajustes[k] : undefined;
      return r ? { valor: duasCasas(Number(r.valor)), mes: String(r.mes) } : { valor: "", mes: "" };
    }),
  );
  // As combinações, com uma chave estável por linha (para o React).
  const [proxima, setProxima] = useState(indice?.combinacoes.length ?? 0);
  const [linhas, setLinhas] = useState<Array<{ id: number; k: CombinacaoDoIndice }>>(() => (indice?.combinacoes ?? []).map((k, n) => ({ id: n, k })));
  // A área das linhas das combinações (a que rola): o Incluir Combinação a leva até a linha nova.
  const areaDasCombinacoes = useRef<HTMLDivElement>(null);
  const [excluindo, setExcluindo] = useState(false);
  const combinacoes = useMemo(() => linhas.map((l) => l.k), [linhas]);
  const { ruins, avisos: dasCombinacoes } = useMemo(() => avisosDasCombinacoes(combinacoes, outros, universo, deps), [combinacoes, outros, universo, deps]);
  const variacaoLida = lerNumero(variacao);
  const variacaoRuim = !reajuste && (typeof variacaoLida !== "number" || variacaoLida < 0);
  const dosGrupos = errosDosGrupos(grupos);
  const repetida = outros.find((o) => o.descricao.trim().toLowerCase() === descricao.trim().toLowerCase());
  const avisos = [
    ...(!descricao.trim() ? ["Dê uma descrição ao índice."] : []),
    ...(repetida ? [`Já há o índice ${repetida.descricao}: use outra descrição.`] : []),
    ...(variacaoRuim ? ["A Variação Máxima (%) precisa de um número a partir de zero."] : []),
    ...(reajuste && dosGrupos.semReajuste ? ["O índice precisa de ao menos um reajuste (o Valor (%) e o Inicia Em)."] : []),
    ...(reajuste && dosGrupos.ruins.size ? ["Cada reajuste precisa do Valor (%) (acima de −100) e do Inicia Em, na ordem (o 1º antes do 2º…) e em meses crescentes."] : []),
    ...dasCombinacoes,
  ];
  const concluir = (mensagem: string) => {
    queryClient.invalidateQueries({ queryKey: ["cenarios"] });
    toast.success(mensagem);
    onFechar();
  };
  const salvar = useMutation({
    mutationFn: () =>
      gravar({
        descricao: descricao.trim(),
        observacao: observacao.trim() || null,
        ...(reajuste
          ? { reajustes: grupos.filter((g) => g.valor.trim() && g.mes).map((g) => ({ valor: lerNumero(g.valor) as number, mes: Number(g.mes) })) }
          : { variacao: variacaoLida as number }),
        combinacoes,
      }),
    onSuccess: () => concluir(aplicados ? "Índice gravado; a DRE fica pendente de recálculo (Resultados / Recalcular)." : "Índice gravado."),
  });
  const apagar = useMutation({
    mutationFn: () => gravar(null),
    onSuccess: () => concluir(aplicados ? "Índice excluído; a DRE fica pendente de recálculo (Resultados / Recalcular)." : "Índice excluído."),
  });
  const pendente = salvar.isPending || apagar.isPending;
  const erro = salvar.isError ? mensagemDeErro(salvar.error, "Não foi possível gravar o índice.") : apagar.isError ? mensagemDeErro(apagar.error, "Não foi possível excluir o índice.") : null;
  const nome = reajuste ? "Índice de Reajuste" : "Índice de Comparação";
  const mudarCombinacao = (n: number, m: Partial<CombinacaoDoIndice>) =>
    setLinhas((xs) =>
      xs.map((l, i) => {
        if (i !== n) return l;
        const nova = { ...l.k, ...m };
        // A conta escolhida com a Atribuição "Todas" leva a atribuição dela (no departamento Receita Operacional, o grupo dela).
        if (m.conta && nova.atribuicao === null)
          nova.atribuicao = deps.get(nova.departamento ?? "")?.porGrupo
            ? (universo.celulas.find((c) => c.conta === m.conta)?.grupo ?? null)
            : (universo.contas.find((c) => c.chave === m.conta)?.atribuicao ?? null);
        return { ...l, k: ajustada(nova, universo, deps) };
      }),
    );
  const select = (ruim: boolean) => `h-8 w-full min-w-0 rounded-sm border bg-white px-2 text-sm disabled:opacity-70 ${ruim ? "border-red-400" : "border-gray-300"}`;
  // Os rótulos da tabela das combinações presos no alto da área que rola (21/11/2026, pedido do Adão).
  const th = "sticky top-0 z-10 bg-gray-50 px-2 py-2 text-left text-xs font-bold text-gray-900";
  return (
    <Dialog open onOpenChange={(o) => (!o && !pendente ? onFechar() : undefined)}>
      {/* O modal em coluna (21/11/2026, pedido do Adão): o título, os campos e os rótulos das combinações ficam fixos; só as linhas das
          combinações rolam, e os avisos e os botões ficam no pé. */}
      <DialogContent avisoAoSair={podeEditar} className="flex max-h-[92vh] flex-col overflow-y-auto rounded-sm sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{indice ? (podeEditar ? `Editar ${nome}` : nome) : `Novo ${nome}`}</DialogTitle>
          <DialogDescription>
            {reajuste ? (
              `Até quatro reajustes, cada um com o Valor (%) e o mês em que Inicia Em; cada um vale sobre os anteriores, até o fim do exercício, nas contas das combinações abaixo (na DRE, com os reajustes aplicados). A mesma conta não pode estar em duas combinações nem em dois índices. ${CUMULATIVOS}`
            ) : (
              <>
                A variação máxima aceita (em %, para mais ou para menos), contra o cenário comparado, nas contas das combinações abaixo: as que
                passam dela pedem justificativa (tela Histórico, aba Justificativas). Cada combinação escolhe a Unidade, o Departamento (os da
                unidade; na Matriz, na Filial e em Serviços, também a Receita Operacional, com a Receita Operacional Bruta, os Impostos
                Operacionais e a Receita Operacional Líquida como atribuições), a Atribuição e a Conta — “Todas” vale para todas —: uma unidade
                inteira, um departamento de uma unidade, uma atribuição de um departamento ou só uma conta. A mesma conta não pode estar em
                duas combinações nem em dois índices. {CUMULATIVOS}
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <fieldset disabled={!podeEditar || pendente} className="flex min-h-0 flex-1 flex-col gap-5">
          <div className={`grid gap-4 ${reajuste ? "sm:grid-cols-2" : "sm:grid-cols-[1fr_1fr_11rem]"}`}>
            <div className="space-y-1.5">
              <Label htmlFor="ind-descricao">Descrição</Label>
              <Input id="ind-descricao" value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={120} placeholder="Ex.: IPCA, Dissídio, Aço…" className="rounded-sm" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ind-observacao">Observação</Label>
              <Input id="ind-observacao" value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={500} className="rounded-sm" />
            </div>
            {reajuste ? null : (
              <div className="space-y-1.5">
                <Label htmlFor="ind-variacao">Variação Máxima (%)</Label>
                <Input
                  id="ind-variacao"
                  value={variacao}
                  onChange={(e) => setVariacao(e.target.value)}
                  onBlur={() => (typeof variacaoLida === "number" && variacaoLida >= 0 ? setVariacao(duasCasas(variacaoLida)) : undefined)}
                  inputMode="decimal"
                  placeholder="%"
                  className={`rounded-sm text-right ${variacao && variacaoRuim ? "border-red-400" : ""}`}
                />
              </div>
            )}
          </div>
          {reajuste ? (
            <div className="grid gap-3 sm:grid-cols-4">
              {GRUPOS.map((g) => {
                const ruim = dosGrupos.ruins.has(g);
                const grupo = grupos[g];
                const mudar = (m: Partial<Grupo>) => setGrupos((xs) => xs.map((x, i) => (i === g ? { ...x, ...m } : x)));
                return (
                  <fieldset key={g} className="space-y-1.5 rounded-sm border border-gray-200 p-2.5">
                    <legend className="px-1 text-xs font-bold text-gray-900">{ORDINAL[g]} Reajuste</legend>
                    <div className="grid grid-cols-[1fr_1fr] gap-2">
                      <Input
                        aria-label={`Valor do ${ORDINAL[g]} reajuste`}
                        value={grupo.valor}
                        onChange={(e) => mudar({ valor: e.target.value })}
                        onBlur={() => {
                          const v = lerNumero(grupo.valor);
                          if (typeof v === "number" && v > -100) mudar({ valor: duasCasas(v) });
                        }}
                        inputMode="decimal"
                        placeholder="Valor (%)"
                        className={`h-8 rounded-sm text-right ${ruim ? "border-red-400" : ""}`}
                      />
                      <select aria-label={`Início do ${ORDINAL[g]} reajuste`} value={grupo.mes} onChange={(e) => mudar({ mes: e.target.value })} className={select(ruim)}>
                        <option value="">Inicia Em…</option>
                        {meses.map((m) => (
                          <option key={m.mes} value={m.mes}>
                            {m.rotulo}
                          </option>
                        ))}
                      </select>
                    </div>
                  </fieldset>
                );
              })}
            </div>
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-gray-900">Combinações</p>
                <p className="text-xs text-gray-500">
                  {(() => {
                    const n = contasDas(combinacoes.flatMap((k) => celulasDe(k, universo, deps)));
                    return `${linhas.length} ${plural(linhas.length, "combinação", "combinações")}, ${n} ${plural(n, "conta", "contas")} (cada conta numa unidade).`;
                  })()}
                </p>
              </div>
              {podeEditar ? (
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-sm"
                  onClick={() => {
                    setLinhas((xs) => [...xs, { id: proxima, k: { unidade: null, departamento: null, atribuicao: null, conta: null, venda: null } }]);
                    setProxima((p) => p + 1);
                    // A linha nova, no fim da área que rola, à vista.
                    requestAnimationFrame(() => areaDasCombinacoes.current?.scrollTo({ top: areaDasCombinacoes.current.scrollHeight, behavior: "smooth" }));
                  }}
                >
                  <Plus className="size-4" />
                  Incluir Combinação
                </Button>
              ) : null}
            </div>
            {/* Só as linhas rolam (a altura mínima mostra algumas mesmo em telas baixas); os rótulos ficam presos no alto. */}
            <div ref={areaDasCombinacoes} className="min-h-32 flex-1 overflow-auto rounded-sm border border-gray-200">
              <table className="w-full table-fixed text-sm">
                <colgroup>
                  <col style={{ width: 40 }} />
                  <col style={{ width: 150 }} />
                  {/* O Departamento com 150 (25/11/2026, pedido do Adão: 25% menos); a sobra vai para a Conta, a coluna sem largura. */}
                  <col style={{ width: 150 }} />
                  <col style={{ width: reajuste ? 230 : 260 }} />
                  <col />
                  {reajuste ? <col style={{ width: 120 }} /> : null}
                  <col style={{ width: 90 }} />
                  {podeEditar ? <col style={{ width: 44 }} /> : null}
                </colgroup>
                <thead>
                  <tr>
                    <th className={th}>#</th>
                    <th className={th}>Unidade</th>
                    <th className={th}>Departamento</th>
                    <th className={th}>Atribuição</th>
                    <th className={th}>Conta</th>
                    {reajuste ? <th className={th}>Venda</th> : null}
                    <th className={`${th} text-right`}>Contas</th>
                    {podeEditar ? <th className={th} /> : null}
                  </tr>
                </thead>
                <tbody>
                  {linhas.length === 0 ? (
                    <tr>
                      <td colSpan={reajuste ? 8 : 7} className="px-3 py-4 text-center text-sm text-gray-500">
                        Nenhuma combinação: o índice não vale em nenhuma conta.{podeEditar ? " Use “Incluir Combinação”." : ""}
                      </td>
                    </tr>
                  ) : (
                    linhas.map((l, n) => {
                      const k = l.k;
                      const o = opcoesDa(k, universo, deps);
                      const ruim = ruins.has(n);
                      const contas = contasDas(celulasDe(k, universo, deps));
                      const naoAcha = (v: string | null, lista: Array<{ chave?: string; id?: string }>) => !!v && !lista.some((x) => (x.chave ?? x.id) === v);
                      return (
                        <tr key={l.id} className={`border-t border-gray-100 ${ruim ? "bg-red-50" : ""}`}>
                          <td className="px-2 py-1.5 text-xs text-gray-500">{n + 1}</td>
                          <td className="px-2 py-1.5">
                            <select
                              aria-label={`Unidade da combinação ${n + 1}`}
                              value={k.unidade ?? ""}
                              onChange={(e) => mudarCombinacao(n, { unidade: e.target.value ? Number(e.target.value) : null })}
                              className={select(ruim)}
                            >
                              <option value="">Todas</option>
                              {universo.unidades.map((u) => (
                                <option key={u.codigo} value={u.codigo}>
                                  {u.nome}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <select
                              aria-label={`Departamento da combinação ${n + 1}`}
                              value={k.departamento ?? ""}
                              onChange={(e) => mudarCombinacao(n, { departamento: e.target.value || null })}
                              disabled={k.unidade === null}
                              title={k.unidade === null ? "Escolha a unidade para escolher um departamento dela" : undefined}
                              className={select(ruim)}
                            >
                              <option value="">Todos</option>
                              {naoAcha(k.departamento, o.departamentos) ? <option value={k.departamento!}>(departamento excluído)</option> : null}
                              {o.departamentos.map((d) => (
                                <option key={d.id} value={d.id}>
                                  {d.nome}
                                  {d.ativo ? "" : " (inativo)"}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <select aria-label={`Atribuição da combinação ${n + 1}`} value={k.atribuicao ?? ""} onChange={(e) => mudarCombinacao(n, { atribuicao: e.target.value || null })} className={select(ruim)}>
                              <option value="">Todas</option>
                              {o.atribuicoes.map((a) => (
                                <option key={a.chave} value={a.chave}>
                                  {nomeDaAtribuicao(universo, a.chave)}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <select aria-label={`Conta da combinação ${n + 1}`} value={k.conta ?? ""} onChange={(e) => mudarCombinacao(n, { conta: e.target.value || null })} className={select(ruim)}>
                              <option value="">Todas</option>
                              {o.contas.map((c) => (
                                <option key={c.chave} value={c.chave}>
                                  {k.atribuicao === null ? `${c.nome} (${c.atribuicao})` : c.nome}
                                </option>
                              ))}
                            </select>
                          </td>
                          {reajuste ? (
                            <td className="px-2 py-1.5">
                              <select
                                aria-label={`Venda da combinação ${n + 1}`}
                                value={k.venda ?? ""}
                                onChange={(e) => mudarCombinacao(n, { venda: (e.target.value || null) as VendaDoIndice | null })}
                                title="Global ou Mercantil: só as contas dos Custos de Produção da Matriz e da Filial, na parte daquela venda"
                                className={select(ruim)}
                              >
                                <option value="">Todas</option>
                                {(["GLOBAL", "MERCANTIL"] as const).map((v) => (
                                  <option key={v} value={v}>
                                    {NOME_DA_VENDA[v]}
                                  </option>
                                ))}
                              </select>
                            </td>
                          ) : null}
                          <td className={`px-2 py-1.5 text-right whitespace-nowrap ${contas ? "text-gray-700" : "font-medium text-red-700"}`}>
                            {contas} {plural(contas, "conta", "contas")}
                          </td>
                          {podeEditar ? (
                            <td className="px-1 py-1.5 text-right">
                              <button
                                type="button"
                                className="inline-flex size-7 items-center justify-center rounded-sm text-gray-500 hover:bg-gray-100 hover:text-red-700"
                                title="Tirar a combinação"
                                aria-label={`Tirar a combinação ${n + 1}`}
                                onClick={() => setLinhas((xs) => xs.filter((_, i) => i !== n))}
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
          </div>
        </fieldset>
        {/* Os avisos no rodapé (21/11/2026, pedido do Adão): as combinações repetidas ou já em outro índice impedem a gravação. */}
        {podeEditar && avisos.length ? (
          <div className="space-y-0.5 rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
            {avisos.slice(0, 6).map((a) => (
              <p key={a}>{a}</p>
            ))}
            {avisos.length > 6 ? <p>… e mais {avisos.length - 6} {plural(avisos.length - 6, "aviso", "avisos")}.</p> : null}
          </div>
        ) : null}
        <Erro erro={erro} />
        <DialogFooter>
          {indice && podeEditar ? (
            <Button type="button" variant="outline" className="rounded-sm border-red-300 text-red-700 hover:bg-red-50 sm:mr-auto" disabled={pendente} onClick={() => setExcluindo(true)}>
              <Trash2 className="size-4" />
              Excluir
            </Button>
          ) : null}
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar} disabled={pendente}>
            {podeEditar ? "Cancelar" : "Fechar"}
          </Button>
          {podeEditar ? (
            <Button type="button" className={botaoPrimario} disabled={avisos.length > 0 || pendente} onClick={() => salvar.mutate()}>
              {salvar.isPending ? "Gravando…" : "Gravar"}
            </Button>
          ) : null}
        </DialogFooter>
        {excluindo && indice ? (
          <ConfirmacaoDialog
            titulo={`Excluir o ${nome}`}
            descricao={`O índice ${indice.descricao} sai do cenário, com as combinações dele: ${
              reajuste ? (aplicados ? "as contas dele deixam de ser reajustadas no próximo Recalcular dos Resultados." : "as contas dele deixam de ter reajuste.") : "as contas dele deixam de ter variação máxima."
            }`}
            pendente={apagar.isPending}
            onConfirmar={() => apagar.mutate(undefined, { onSettled: () => setExcluindo(false) })}
            onFechar={() => setExcluindo(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
