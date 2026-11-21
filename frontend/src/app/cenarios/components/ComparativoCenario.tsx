"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { type ColunaExportavel, ExportarTabela } from "@/components/shared/ExportarTabela";
import { CampoBusca } from "@/components/shared/Filtros";
import { SemResultado, useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import type { Coluna } from "@/lib/filtrosDeTabela";
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
import { Destaque, TabelaComDestaque } from "./DestaqueDaAba";
import { EtiquetaMarcacao, EtiquetaVigente } from "./EtiquetasCenario";
import { lerNumero } from "./EdicaoDialogs";

/** A variação máxima no campo: sempre com duas casas (13/10/2026), sem separador de milhar (fácil de editar). */
const duasCasas = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });

/**
 * A aba Comparativo das Configurações dos cenários sintéticos (13/10/2026; antes, a aba Referência da tela Comparativo e, antes,
 * a aba Comparar dos Resultados): o cenário com que este se compara e a variação máxima (em %) de cada conta, na estrutura da DRE
 * vigente (14/10/2026; antes, só os totais). Com um cenário comparado, a aba Justificativas da tela Reajustes lista as contas que
 * passam da variação. Os analíticos (21/11/2026, pedido do Adão) têm só o Cenário Comparado (CenarioComparado, abaixo), na aba
 * Comparativo e Reajustes, com os Índices de Comparação e os de Reajuste (IndicesDoCenario.tsx).
 */
export function ComparativoCenario({ id, podeEditar }: { id: string; podeEditar: boolean }) {
  const consulta = useQuery({ queryKey: ["cenarios", id, "comparativo"], queryFn: () => cenariosService.comparativo(id) });
  if (consulta.isError) return <Erro erro={mensagemDeErro(consulta.error, "Erro ao carregar o comparativo.")} />;
  if (consulta.isPending) return <div className="h-64 animate-pulse rounded-sm bg-gray-100" />;
  return <Formulario key={JSON.stringify(consulta.data)} id={id} dados={consulta.data} podeEditar={podeEditar} />;
}

/**
 * O Cenário Comparado dos analíticos (21/11/2026, pedido do Adão): o cartão com o cenário escolhido e o “Escolher Cenário”, cujo
 * modal grava a escolha (sem a tabela das Variações Máximas: as variações vêm dos Índices de Comparação).
 */
export function CenarioComparado({ id, podeEditar }: { id: string; podeEditar: boolean }) {
  const queryClient = useQueryClient();
  const consulta = useQuery({ queryKey: ["cenarios", id, "comparativo"], queryFn: () => cenariosService.comparativo(id) });
  const [escolhendo, setEscolhendo] = useState(false);
  const gravar = useMutation({
    mutationFn: (comparadoComId: string) => cenariosService.gravarComparativo(id, { comparadoComId: comparadoComId || null }),
    onSuccess: (_, comparadoComId) => {
      queryClient.invalidateQueries({ queryKey: ["cenarios"] });
      setEscolhendo(false);
      toast.success(comparadoComId ? "Cenário comparado gravado." : "Comparativo desligado.");
    },
  });
  if (consulta.isError) return <Erro erro={mensagemDeErro(consulta.error, "Erro ao carregar o comparativo.")} />;
  if (consulta.isPending) return <div className="h-24 animate-pulse rounded-sm bg-gray-100" />;
  const dados = consulta.data;
  const atual = dados.comparadoCom?.id ?? "";
  return (
    <>
      <CartaoDoComparado
        escolhido={dados.opcoes.find((o) => o.id === atual) ?? null}
        descricao={
          atual
            ? "Cada conta se compara, mês a mês e em cada aba da DRE, com a mesma conta do cenário escolhido. As que passam da variação máxima do Índice de Comparação delas aparecem na aba Justificativas da tela Histórico."
            : "Sem cenário comparado, o comparativo fica desligado e a aba Justificativas (tela Histórico) não aparece. Os Índices de Comparação ficam guardados."
        }
        botao={
          podeEditar ? (
            <Button
              type="button"
              variant="outline"
              className="shrink-0 rounded-sm"
              onClick={() => {
                gravar.reset();
                setEscolhendo(true);
              }}
            >
              Escolher Cenário
            </Button>
          ) : null
        }
      />
      {escolhendo ? (
        <EscolherCenarioDialog
          opcoes={dados.opcoes}
          atual={atual}
          grava
          pendente={gravar.isPending}
          erro={gravar.isError ? mensagemDeErro(gravar.error, "Não foi possível gravar o cenário comparado.") : null}
          onEscolher={(c) => gravar.mutate(c)}
          onFechar={() => (gravar.isPending ? undefined : setEscolhendo(false))}
        />
      ) : null}
    </>
  );
}

/** O cartão do Cenário Comparado: o escolhido (o nome, a versão, o exercício e as etiquetas) e, à direita, o botão. */
function CartaoDoComparado({ escolhido, descricao, botao }: { escolhido: Comparativo["opcoes"][number] | null; descricao: string; botao: React.ReactNode }) {
  return (
    <Destaque
      titulo="Cenário Comparado"
      descricao={descricao}
      abaixo={
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
      }
    >
      {botao}
    </Destaque>
  );
}

type LinhaDaVariacao = Comparativo["linhas"][number];

function Formulario({ id, dados, podeEditar }: { id: string; dados: Comparativo; podeEditar: boolean }) {
  const queryClient = useQueryClient();
  const [comparado, setComparado] = useState(dados.comparadoCom?.id ?? "");
  // As linhas verificadas (as contas, e os totais e atribuições sem contas) guardam a variação; as demais a repassam.
  const verificadas = dados.linhas.filter((l) => l.verificada);
  const original = (l: LinhaDaVariacao) => (l.limite === null ? "" : duasCasas(l.limite));
  const [limites, setLimites] = useState<Record<string, string>>(() => Object.fromEntries(verificadas.map((l) => [l.codigo, original(l)])));
  const colunasExportadas: ColunaExportavel<LinhaDaVariacao>[] = [
    { chave: "linha", rotulo: "Linha da DRE", valor: (l) => l.descricao },
    { chave: "variacao", rotulo: "Variação Máxima (%)", tipo: "numero", valor: (l) => (l.verificada ? l.limite : null), texto: (l) => (l.verificada && l.limite !== null ? duasCasas(l.limite) : "") },
  ];
  const [todos, setTodos] = useState("");
  // As contas marcadas (15/10/2026): o Preencher Selecionados e o Limpar valem só para elas (antes, para todas).
  const [marcadas, setMarcadas] = useState<Set<string>>(() => new Set());
  const [escolhendo, setEscolhendo] = useState(false);
  // Os níveis da DRE (14/10/2026): totais, atribuições e contas, com as setas de abrir e fechar. PRODUÇÃO E SERVIÇOS (PS)
  // também em Totais e em Atribuições, recolhida (12/11/2026, pedido do Adão: como em Resultados Empresariais).
  const niveis = useNiveisDRE(dados.linhas, "sig.cenarios.variacaoMaxima.nivel", undefined, "recolhida");
  const escolhido = dados.opcoes.find((o) => o.id === comparado) ?? null;
  const lidos = Object.fromEntries(Object.entries(limites).map(([c, t]) => [c, lerNumero(t)]));
  const invalidos = verificadas.filter((l) => lidos[l.codigo] === undefined || ((lidos[l.codigo] as number | null) ?? 0) < 0);
  const mudou = comparado !== (dados.comparadoCom?.id ?? "") || verificadas.some((l) => (limites[l.codigo] ?? "") !== original(l));
  const comLimite = verificadas.filter((l) => typeof lidos[l.codigo] === "number").length;
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
  const valorTodos = lerNumero(todos);

  const gravar = useMutation({
    mutationFn: () =>
      cenariosService.gravarComparativo(id, { comparadoComId: comparado || null, limites: Object.fromEntries(verificadas.map((l) => [l.codigo, (lidos[l.codigo] as number | null) ?? null])) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cenarios"] });
      toast.success(comparado ? "Comparativo gravado." : "Comparativo desligado.");
    },
  });

  const titulo = "Variação Máxima";
  // Os filtros padrão nos rótulos (20/11/2026, pedido do Adão): sem filtro nem ordem, a árvore da DRE; com eles, as linhas que
  // passam (de todos os níveis, abertas), pelo que está na tela.
  const colunasDoFiltro: Coluna<LinhaDaVariacao>[] = [
    { chave: "linha", rotulo: "Linha da DRE", valor: (l) => l.descricao },
    {
      chave: "valor",
      rotulo: "Variação Máxima (%)",
      tipo: "numero",
      alinhamento: "direita",
      valor: (l) => {
        const v = lerNumero(textoDe(l));
        return typeof v === "number" ? v : null;
      },
      texto: (l) => textoDe(l),
    },
  ];
  const tabela = useTabelaFiltravel(niveis.linhas, colunasDoFiltro);
  const visiveis = tabela.ativos ? tabela.filtradas : niveis.linhas.filter(niveis.visivel);
  // O destaque da Variação Máxima, acima da tabela, que flutua sobre ela ao rolar (20/11/2026, pedido do Adão: o padrão das
  // Premissas): o Preencher Selecionados, o Gravar Comparativo e, por último, o Exportar.
  const destaque = (
    <Destaque
      titulo={titulo}
      descricao="A variação aceita (em %, para mais ou para menos) em cada conta, na estrutura da DRE vigente. Variações em branco não serão verificadas."
      abaixo={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {podeEditar ? (
            <span className="text-xs text-gray-500">
              {marcadas.size ? `${marcadas.size} ${plural(marcadas.size, "conta marcada", "contas marcadas")} · ` : ""}
              {comLimite} de {verificadas.length} {plural(verificadas.length, "conta", "contas")} com variação máxima.
            </span>
          ) : null}
          {invalidos.length ? (
            <span className="text-xs text-red-700">
              Variação inválida em {invalidos.length} {plural(invalidos.length, "conta", "contas")} (em vermelho): use um número a partir de zero.
            </span>
          ) : null}
          <Erro erro={gravar.isError ? mensagemDeErro(gravar.error, "Não foi possível gravar o comparativo.") : null} />
        </div>
      }
    >
      {podeEditar ? (
        <>
          <Label htmlFor="cmp-todos">Preencher Selecionados</Label>
          <Input id="cmp-todos" value={todos} onChange={(e) => setTodos(e.target.value)} placeholder="%" inputMode="decimal" className="w-24 rounded-sm text-right" />
          <Button
            type="button"
            variant="outline"
            className="rounded-sm"
            disabled={marcadas.size === 0 || typeof valorTodos !== "number" || valorTodos < 0}
            title={marcadas.size === 0 ? "Marque as contas (a caixa de um total ou de uma atribuição marca as contas abaixo dele)" : undefined}
            onClick={() => preencherMarcadas(duasCasas(valorTodos as number))}
          >
            Aplicar
          </Button>
          <Button
            type="button"
            variant="outline"
            className="rounded-sm"
            disabled={![...marcadas].some((c) => typeof lidos[c] === "number")}
            title={marcadas.size === 0 ? "Marque as contas que perdem a variação" : undefined}
            onClick={() => preencherMarcadas("")}
          >
            Limpar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={!mudou || invalidos.length > 0 || gravar.isPending} onClick={() => gravar.mutate()}>
            {gravar.isPending ? "Gravando…" : "Gravar Comparativo"}
          </Button>
        </>
      ) : null}
      {/* O Exportar (30/10/2026): o que está gravado em cada linha da DRE; por último. */}
      <ExportarTabela titulo={`Cenário · Comparativo · ${titulo}`} colunas={colunasExportadas} linhas={dados.linhas} />
    </Destaque>
  );

  return (
    <div className="space-y-8">
      {/*
        O cenário escolhido e o botão que abre o modal de escolha (13/10/2026; antes, uma lista), no cartão de destaque (20/11/2026),
        com o Escolher Cenário à direita.
      */}
      <CartaoDoComparado
        escolhido={escolhido}
        descricao={
          comparado
            ? "Cada conta se compara, mês a mês e em cada aba da DRE, com a mesma conta do cenário escolhido. As que passam da variação máxima delas aparecem na aba Justificativas da tela Reajustes."
            : "Sem cenário comparado, o comparativo fica desligado e a aba Justificativas (tela Reajustes) não aparece. As variações máximas ficam guardadas."
        }
        botao={
          podeEditar ? (
            <Button type="button" variant="outline" className="shrink-0 rounded-sm" onClick={() => setEscolhendo(true)}>
              Escolher Cenário
            </Button>
          ) : null
        }
      />

      <TabelaComDestaque
        destaque={destaque}
        larguras={[620, 200]}
        cabecalho={tabela.linhaDoCabecalhoCom(
          {},
          {
            linha: (
              <>
                <SeletorNivel nivel={niveis.nivelGeral} onEscolher={niveis.escolherNivel} />
                {podeEditar ? <Caixa rotulo="Marcar todas as contas" estado={marcacaoDe(verificadas.map((l) => l.codigo))} onMudar={(m) => marcar(verificadas.map((l) => l.codigo), m)} /> : null}
              </>
            ),
          },
        )}
        corpo={
          visiveis.length === 0 ? (
            <SemResultado colunas={2} onLimpar={tabela.limpar} />
          ) : (
            visiveis.map((l) => {
              const contas = contasDe(l);
              const invalido = invalidos.some((x) => contas.includes(x.codigo));
              const texto = textoDe(l);
              const varias = !l.verificada && !texto && contas.some((c) => limites[c]);
              return (
                <tr key={l.codigo} className={`border-t border-gray-100 ${fundoDaLinha(l)}`}>
                  <td className={`py-1.5 pr-3 ${niveis.recuo(l)} ${l.tipo !== "ITEM" ? "font-bold text-gray-900" : "text-gray-700"}`}>
                    <span className="flex min-w-0 items-center gap-1">
                      <Agrupador grupo={niveis.grupo(l)} fechado={niveis.fechado(l)} onAlternar={() => niveis.alternar(l.codigo)} />
                      {podeEditar ? <Caixa rotulo={`Marcar ${l.descricao}`} estado={marcacaoDe(contas)} onMudar={(m) => marcar(contas, m)} /> : null}
                      <span className="truncate" title={l.descricao}>
                        {l.descricao}
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right">
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
                  </td>
                </tr>
              );
            })
          )
        }
      />
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

/** A caixa de marcar uma linha (ou todas): parcial quando só parte das contas dela está marcada. */
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
const paraBusca = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * A escolha do cenário comparado (13/10/2026; antes, uma lista): a lista dos cenários, com a busca pelo nome e os
 * filtros "Apenas Vigentes" (a versão mais recente de cada cenário) e "Apenas com Marcação". Nos sintéticos, a escolha vale no
 * formulário e grava-se em "Gravar Comparativo"; nos analíticos (`grava`, 21/11/2026), o “Gravar” do modal a grava.
 */
function EscolherCenarioDialog({
  opcoes,
  atual,
  onEscolher,
  onFechar,
  grava = false,
  pendente = false,
  erro = null,
}: {
  opcoes: Comparativo["opcoes"];
  atual: string;
  onEscolher: (id: string) => void;
  onFechar: () => void;
  grava?: boolean;
  pendente?: boolean;
  erro?: string | null;
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
            DRE; o que só os analíticos têm (como os centros de custo) só se compara entre analíticos.{" "}
            {grava ? "“Gravar” grava a escolha." : "A escolha grava-se em “Gravar Comparativo”."}
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
        <Erro erro={erro} />
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar} disabled={pendente}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={escolha === atual || pendente} onClick={() => onEscolher(escolha)}>
            {grava ? (pendente ? "Gravando…" : "Gravar") : "Escolher"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
