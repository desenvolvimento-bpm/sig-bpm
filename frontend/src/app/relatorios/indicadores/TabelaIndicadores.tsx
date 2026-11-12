"use client";

import { Fragment, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { ChevronDown, Search } from "lucide-react";

import { BarraDeRolagem } from "@/components/shared/BarraDeRolagem";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SemResultado, useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import type { Coluna } from "@/lib/filtrosDeTabela";

import { ROTULO_DO_ORCADO } from "../../competencias/[anoMes]/dre/components/NiveisDRE";
import { ESTILOS_NOS_INDICADORES, type EstiloNosIndicadores } from "../components/cenariosDoProva";
import { formato, type Indicador, type MarcacaoComparavel, type MesRelatorio } from "../services/relatoriosService";

/** Os grupos, na ordem e com os nomes das abas da planilha (Produção, Serviços…). */
const NOME_DO_GRUPO: Record<string, string> = { GME: "Metas Estratégicas (GME)" };
const nomeDoGrupo = (g: string) => NOME_DO_GRUPO[g] ?? g;

const TODOS_OS_GRUPOS = "todos";

/**
 * A lista dos grupos (13/10/2026), antes do rótulo Indicador, como a dos níveis em DRE / Resultados: Todos os Grupos
 * ou um deles (Produção, Serviços, Logística, Técnico, Comercial, Administrativo, Geral, Metas Estratégicas (GME)), na
 * ordem da tabela; só os grupos que a tabela tem.
 */
function SeletorGrupo({ grupos, grupo, onEscolher }: { grupos: string[]; grupo: string; onEscolher: (g: string) => void }) {
  const atual = grupo === TODOS_OS_GRUPOS ? "Todos os Grupos" : nomeDoGrupo(grupo);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="outline" aria-label="Grupos dos Indicadores" title={`Grupos: ${atual}`} className="size-8 shrink-0 rounded-sm border-black/30 bg-white p-0">
            <ChevronDown className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-gray-500">Mostrar os indicadores de</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={grupo} onValueChange={(v) => onEscolher(String(v))}>
            <DropdownMenuRadioItem value={TODOS_OS_GRUPOS} closeOnClick>
              Todos os Grupos
            </DropdownMenuRadioItem>
            {grupos.map((g) => (
              <DropdownMenuRadioItem key={g} value={g} closeOnClick>
                {nomeDoGrupo(g)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const SENTIDO: Record<string, string> = { "↑": "Quanto maior, melhor", "↓": "Quanto menor, melhor", "=": "Acompanhamento", "-": "Sem sentido definido" };

/** O valor na unidade do indicador, como nas abas dos setores. */
export function valor(i: Pick<Indicador, "unidade">, v: number | null) {
  if (v === null) return "—";
  switch (i.unidade) {
    case "%":
      return formato.pct(v);
    case "R$":
      return formato.inteiro(v);
    // Em milhões ou em milhares, com uma casa (22/10/2026), como nos cards do Painel de Bordo (a unidade diz R$ M ou R$ K).
    case "R$ M":
      return formato.umaCasa(v / 1e6);
    case "R$ K":
      return formato.umaCasa(v / 1e3);
    case "colab.":
    case "ocorr.":
      return formato.inteiro(v);
    case "pistas":
      return formato.umaCasa(v);
    default:
      return formato.valor(v);
  }
}

/** O valor sem a unidade (os rótulos e a escala do gráfico do indicador, 13/10/2026): as mesmas casas, sem o %. */
export function valorCurto(i: Pick<Indicador, "unidade">, v: number | null) {
  if (v === null || i.unidade !== "%") return valor(i, v);
  return formato.umaCasa(v * 100);
}

/**
 * As cores da faixa dos grupos e dos totais (13/10/2026: um pouco mais fortes, antes yellow-50 e gray-200): a do realizado
 * e, nas colunas do orçado, a do estilo do Orçado (o cinza; na Comparação PROVA, 31/10/2026, a de cada cenário).
 */
const FAIXA_DO_REALIZADO = "bg-yellow-100";
const DO_ORCADO = ESTILOS_NOS_INDICADORES.ORCAMENTO_EMPRESARIAL;

/** O amarelo de antes da faixa dos grupos (o yellow-50) mais fraco, para as linhas pares, sem transparência (as colunas presas cobrem as que rolam). */
const AMARELO_FRACO = "bg-[color-mix(in_srgb,var(--color-yellow-50)_55%,var(--color-white))]";

/**
 * O fundo da linha do indicador (13/10/2026): sem numeração (os totais, como Custos de Produção: Matriz), a cor da faixa
 * dos grupos — o amarelo nas colunas do realizado, o cinza nas do orçado (na Comparação PROVA, a faixa de cada cenário);
 * com numeração par (2, 4…, GME 4, GME 8), um tom mais fraco das mesmas cores; com numeração ímpar, sem fundo.
 */
function fundoDoIndicador(i: Indicador, orcado: EstiloNosIndicadores | null) {
  if (i.numero === "") return orcado ? orcado.faixa : FAIXA_DO_REALIZADO;
  const n = Number(/(\d+)\s*$/.exec(i.numero)?.[1]);
  if (n % 2 === 0) return orcado ? orcado.par : AMARELO_FRACO;
  return "";
}

/** Um cenário da Comparação PROVA (31/10/2026): a marcação, o rótulo, o nome e o estilo das colunas dele. */
type ComparadoNosIndicadores = { marcacao: MarcacaoComparavel; rotulo: string; cenario: string; estilo: EstiloNosIndicadores };

/** As larguras das colunas fixas (Indicador, Sent., Und.) e das de valor. */
const LARGURA = { indicador: 400, sentido: 84, unidade: 100, mes: 112, acumulado: 124, orcado: 148 };

/**
 * As colunas, com os filtros e a ordem nos rótulos, como nas demais tabelas.
 * As três primeiras ficam presas à esquerda; os meses (e o acumulado) rolam.
 * A posição das presas segue a largura real da coluna Indicador (--largura-indicador),
 * que cresce quando a tabela é mais estreita que a área.
 */
function montarColunas<T extends Indicador>(
  meses: MesRelatorio[],
  indices: number[],
  acumulado: boolean,
  orcado: boolean,
  comparado: { rotulo: string } | null,
  comReferencia = false,
  rotuloDoOrcado = "Orçado",
  comparados?: ComparadoNosIndicadores[],
): Coluna<T>[] {
  const ultimo = meses.length - 1;
  // Na Comparação PROVA (31/10/2026), no lugar do orçado: o do último mês de cada cenário, depois dele, e o acumulado de
  // cada um, depois do acumulado, lado a lado e cada um com o rótulo na cor dele.
  if (orcado && comparados?.length) {
    const doCenario = (c: ComparadoNosIndicadores, periodo: "mes" | "acum"): Coluna<T> => {
      const v = (i: T) => (periodo === "mes" ? (i.prova?.[c.marcacao]?.orcado[ultimo] ?? null) : (i.prova?.[c.marcacao]?.totalOrcado ?? null));
      return {
        chave: `orcado:${periodo}:${c.marcacao}`,
        rotulo: periodo === "mes" ? `${c.rotulo} ${meses[ultimo].rotulo}` : `${c.rotulo} Acum.`,
        tipo: "numero",
        alinhamento: "direita",
        valor: v,
        texto: (i) => valor(i, v(i)),
        classe: c.estilo.rotulo,
      };
    };
    const colunas = montarColunas<T>(meses, indices, acumulado, false, null, comReferencia);
    const k = colunas.findIndex((c) => c.chave === "acumulado");
    const doMes = comparados.map((c) => doCenario(c, "mes"));
    return k < 0 ? [...colunas, ...doMes] : [...colunas.slice(0, k), ...doMes, colunas[k], ...comparados.map((c) => doCenario(c, "acum"))];
  }
  // O orçado (Resultados Empresariais, 11/10/2026): o do último mês, depois dele, e o acumulado, depois do acumulado. Nos
  // cenários com um cenário comparado (13/10/2026), só o acumulado dele, depois do acumulado.
  const orcadoDoMes: Coluna<T>[] = orcado && !comparado
    ? [{ chave: "orcado:mes", rotulo: `${rotuloDoOrcado} ${meses[ultimo].rotulo}`, tipo: "numero", alinhamento: "direita", valor: (i) => i.orcado[ultimo] ?? null, texto: (i) => valor(i, i.orcado[ultimo] ?? null), classe: ROTULO_DO_ORCADO }]
    : [];
  const orcadoAcumulado: Coluna<T>[] = orcado
    ? [
        {
          chave: "orcado:acum",
          rotulo: comparado?.rotulo ?? `${rotuloDoOrcado} Acum.`,
          tipo: "numero",
          alinhamento: "direita",
          valor: (i) => i.totalOrcado,
          texto: (i) => valor(i, i.totalOrcado),
          classe: ROTULO_DO_ORCADO,
        },
      ]
    : [];
  return [
    { chave: "indicador", rotulo: "Indicador", valor: (i) => i.nome, classe: "sticky left-0 !z-30" },
    {
      chave: "sentido",
      rotulo: "Sent.",
      valor: (i) => i.sentido,
      texto: (i) => `${i.sentido} ${SENTIDO[i.sentido] ?? ""}`.trim(),
      classe: "sticky left-[var(--largura-indicador)] !z-30",
    },
    { chave: "unidade", rotulo: "Und.", valor: (i) => i.unidade, classe: `sticky left-[calc(var(--largura-indicador)+84px)] !z-30 shadow-[inset_-1px_0_0_#d1d5db]` },
    // A Média de Referência (15/10/2026: os indicadores manuais dos analíticos), antes dos meses.
    ...(comReferencia
      ? [{ chave: "referencia", rotulo: "Média de Ref.", tipo: "numero", alinhamento: "direita", valor: (i: T) => i.referencia ?? null, texto: (i: T) => valor(i, i.referencia ?? null), classe: "border-r border-gray-300" } as Coluna<T>]
      : []),
    ...indices.map(
      (k): Coluna<T> => ({
        chave: `mes:${meses[k].mes}`,
        rotulo: meses[k].rotulo,
        tipo: "numero",
        alinhamento: "direita",
        valor: (i) => i.meses[k],
        texto: (i) => valor(i, i.meses[k]),
      }),
    ),
    ...orcadoDoMes,
    ...(acumulado
      ? [
          {
            chave: "acumulado",
            rotulo: "Acumulado",
            tipo: "numero",
            alinhamento: "direita",
            valor: (i: T) => i.total,
            texto: (i: T) => valor(i, i.total),
            classe: "border-l border-gray-300",
          } as Coluna<T>,
        ]
      : []),
    ...orcadoAcumulado,
  ];
}

type Props<T extends Indicador> = {
  meses: MesRelatorio[];
  indicadores: T[];
  /** Só a coluna do último mês, sem o acumulado (a etapa Indicadores do Fechamento Mensal). */
  soUltimoMes?: boolean;
  /** Clicar na linha (o gráfico do indicador; a edição dos lançamentos manuais do cenário). */
  onClicar?: (i: T) => void;
  dicaDoClique?: string;
  iconeDoClique?: ComponentType<{ className?: string }>;
  /** As colunas do orçado (Resultados Empresariais): a do último mês e a do acumulado. */
  comOrcado?: boolean;
  /**
   * O nome do orçado nos rótulos dessas colunas (23/10/2026): "Orçado" no Orçamento; nas outras marcações da Comparação, o
   * nome dela (Forecast SET/26, Forecast Acum.), como em Resultados.
   */
  rotuloDoOrcado?: string;
  /** Nos cenários (13/10/2026): o cenário comparado, cujo acumulado vem no lugar do orçado (só ele, sem o do mês). */
  comparado?: { nome: string; ano: number } | null;
  /** A célula do mês em destaque (o valor digitado, nos lançamentos manuais do cenário). */
  destacar?: (i: T, k: number) => boolean;
  dicaDoDestaque?: string;
  /** A coluna Média de Referência, antes dos meses (os indicadores manuais dos analíticos, 15/10/2026). */
  comReferencia?: boolean;
  /**
   * A Comparação PROVA de Resultados Empresariais (31/10/2026): com `comOrcado`, no lugar das colunas do orçado, as de cada
   * cenário (o último mês e o acumulado), lado a lado e nas cores dele.
   */
  comparados?: ComparadoNosIndicadores[];
  /** A lupa de um mês (06/11/2026: os apurados no Quadro de Lotação): o clique dela, ou nulo sem lupa. */
  lupa?: (i: T, k: number) => (() => void) | null;
};

/**
 * A tabela dos indicadores (Resultados Empresariais / Indicadores e os cenários sintéticos): os grupos em faixas, as
 * colunas Indicador, Sent. e Und. presas à esquerda, os meses e o acumulado, com os filtros nos rótulos.
 */
export function TabelaIndicadores<T extends Indicador>({
  meses,
  indicadores,
  soUltimoMes,
  onClicar,
  dicaDoClique,
  iconeDoClique: Icone,
  comOrcado,
  rotuloDoOrcado,
  comparado,
  destacar,
  dicaDoDestaque,
  comReferencia,
  comparados,
  lupa,
}: Props<T>) {
  const colunas = useMemo(() => {
    const indices = soUltimoMes ? [meses.length - 1] : meses.map((_, k) => k);
    const doComparado = comparado ? { rotulo: "Comparado Acum." } : null;
    return montarColunas<T>(meses, indices, !soUltimoMes, (!!comOrcado || !!comparado) && !soUltimoMes, doComparado, !!comReferencia, rotuloDoOrcado, comparados);
  }, [meses, soUltimoMes, comOrcado, comparado, comReferencia, rotuloDoOrcado, comparados]);
  // O grupo escolhido na lista antes do rótulo Indicador (13/10/2026); um grupo que a tabela não tem vale Todos.
  const [grupoEscolhido, setGrupo] = useState(TODOS_OS_GRUPOS);
  const grupos = useMemo(() => [...new Set(indicadores.map((i) => i.grupo))], [indicadores]);
  const grupo = grupos.includes(grupoEscolhido) ? grupoEscolhido : TODOS_OS_GRUPOS;
  const doGrupo = useMemo(() => (grupo === TODOS_OS_GRUPOS ? indicadores : indicadores.filter((i) => i.grupo === grupo)), [indicadores, grupo]);
  const tabela = useTabelaFiltravel(doGrupo, colunas);
  const larguras = [LARGURA.indicador, LARGURA.sentido, LARGURA.unidade, ...colunas.slice(3).map((c) => (c.chave.startsWith("orcado:") ? LARGURA.orcado : c.chave === "acumulado" || c.chave === "referencia" ? LARGURA.acumulado : LARGURA.mes))];
  // O estilo de uma coluna do orçado: o do Orçado ou, na Comparação PROVA, o do cenário dela; null nas do realizado.
  const estiloDa = (chave: string): EstiloNosIndicadores | null => {
    if (!chave.startsWith("orcado:")) return null;
    const m = chave.split(":")[2];
    return comparados?.find((c) => c.marcacao === m)?.estilo ?? DO_ORCADO;
  };
  // A faixa do grupo em pedaços: amarela nas colunas do realizado, cinza nas do orçado (a mesma escala); na Comparação
  // PROVA, cada cenário na faixa dele.
  const faixas = colunas.reduce<Array<{ estilo: EstiloNosIndicadores | null; n: number }>>((fs, c) => {
    const estilo = estiloDa(c.chave);
    const ultima = fs[fs.length - 1];
    if (ultima && ultima.estilo === estilo) ultima.n++;
    else fs.push({ estilo, n: 1 });
    return fs;
  }, []);
  const total = larguras.reduce((s, w) => s + w, 0);

  // A largura real da coluna Indicador posiciona as outras duas colunas presas.
  const moldura = useRef<HTMLDivElement>(null);
  const topo = useRef<HTMLDivElement>(null);
  const corpo = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = moldura.current;
    const th = el?.querySelector("thead th");
    if (!el || !th) return;
    const medir = () => el.style.setProperty("--largura-indicador", `${th.getBoundingClientRect().width}px`);
    medir();
    const obs = new ResizeObserver(medir);
    obs.observe(th);
    return () => obs.disconnect();
  }, [colunas]);


  const clicavel = !!onClicar;
  const colgroup = (
    <colgroup>
      {/* A coluna Indicador sem largura: fica com o que sobra quando a tabela é mais estreita que a área. */}
      <col style={{ minWidth: LARGURA.indicador }} />
      {larguras.slice(1).map((w, k) => (
        <col key={k} style={{ width: w }} />
      ))}
    </colgroup>
  );
  return (
    <>
      {/*
        Como a tabela de Resultados (12/10/2026; antes, uma caixa com rolagem própria): a página rola, os rótulos ficam
        presos logo abaixo do título da tela, as três primeiras colunas à esquerda, e a barra de rolagem lateral no pé
        da janela. Os rótulos e o corpo são duas tabelas com as mesmas colunas; os rótulos acompanham o corpo.
      */}
      <div ref={moldura} className="rounded-sm border border-gray-200 bg-white [--largura-indicador:400px]">
        <div ref={topo} className="sticky top-[var(--topo-tabela,0px)] z-30 overflow-hidden">
          <table className="tabela-sig table-fixed border-collapse text-sm [--topo-tabela:0px]" style={{ width: total, minWidth: "100%" }}>
            {colgroup}
            {tabela.cabecalhoCom(
              {},
              {
                indicador: (
                  <span className="mr-2 inline-flex">
                    <SeletorGrupo grupos={grupos} grupo={grupo} onEscolher={setGrupo} />
                  </span>
                ),
              },
            )}
          </table>
        </div>
        <div
          ref={corpo}
          className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onScroll={(e) => {
            if (topo.current && topo.current.scrollLeft !== e.currentTarget.scrollLeft) topo.current.scrollLeft = e.currentTarget.scrollLeft;
          }}
        >
        <table className="tabela-sig table-fixed border-collapse text-sm" style={{ width: total, minWidth: "100%" }}>
          {colgroup}
          <tbody>
            {tabela.visiveis.length === 0 ? (
              <SemResultado colunas={colunas.length} onLimpar={tabela.limpar} />
            ) : (
              tabela.visiveis.map((i, k) => {
                const anterior = tabela.visiveis[k - 1];
                const principal = i.numero === "";
                const tom = principal ? "text-gray-900" : "text-gray-700";
                // As colunas presas precisam de fundo (as outras rolam por baixo): sem destaque, o branco.
                const fundoPreso = fundoDoIndicador(i, null) || "bg-white";
                const aoPassar = clicavel ? "group-hover:bg-gray-100" : "";
                return (
                  <Fragment key={i.nome}>
                    {!anterior || anterior.grupo !== i.grupo ? (
                      // O nome do grupo no tamanho dos departamentos da DRE / Resultados (15/10/2026; de 14/10/2026, 21 px).
                      <tr className="border-y border-gray-300">
                        {faixas.map((f, n) => (
                          <td key={n} colSpan={f.n} className={`${f.estilo ? f.estilo.faixa : FAIXA_DO_REALIZADO} px-3 py-2 text-sm font-bold text-gray-900 uppercase`}>
                            {n === 0 ? <span className="sticky left-3">{nomeDoGrupo(i.grupo)}</span> : null}
                          </td>
                        ))}
                      </tr>
                    ) : null}
                    <tr
                      className={`group border-t border-gray-100 ${principal ? "font-bold" : ""} ${clicavel ? "cursor-pointer hover:bg-gray-100" : ""}`}
                      onClick={onClicar ? () => onClicar(i) : undefined}
                      title={clicavel ? dicaDoClique : undefined}
                    >
                      <td className={`sticky left-0 z-10 ${fundoPreso} py-1.5 pr-3 ${aoPassar} ${principal ? "pl-4" : "pl-9"} ${tom}`}>
                        <div className="flex items-baseline gap-2">
                          {i.numero ? <span className="w-10 shrink-0 text-xs font-normal text-gray-400">{i.numero}</span> : null}
                          {Icone ? <Icone className="size-3.5 shrink-0 self-center text-gray-400" /> : null}
                          <span>{i.nome}</span>
                        </div>
                        <div className={`text-xs font-normal text-gray-500 ${i.numero ? "pl-12" : ""}`}>
                          {i.metodologia}
                          {i.acumulado === "ATUAL" && !soUltimoMes ? " · acumulado: o último mês" : ""}
                        </div>
                      </td>
                      <td
                        className={`sticky left-[var(--largura-indicador)] z-10 ${fundoPreso} px-4 py-1.5 font-normal text-gray-600 ${aoPassar}`}
                        title={SENTIDO[i.sentido]}
                      >
                        {i.sentido}
                      </td>
                      <td
                        className={`sticky left-[calc(var(--largura-indicador)+84px)] z-10 ${fundoPreso} shadow-[inset_-1px_0_0_#d1d5db] px-4 py-1.5 text-xs font-normal whitespace-nowrap text-gray-600 ${aoPassar}`}
                      >
                        {i.unidade}
                      </td>
                      {colunas.slice(3).map((c) => {
                        const mes = c.chave.startsWith("mes:") ? Number(c.chave.slice(4)) - 1 : -1;
                        const emDestaque = mes >= 0 && !!destacar?.(i, meses.findIndex((m) => m.mes === mes + 1));
                        // O valor digitado (lançamentos manuais do cenário) num amarelo mais forte que o das linhas e o dos totais.
                        const fundo = emDestaque ? "bg-yellow-200" : fundoDoIndicador(i, estiloDa(c.chave));
                        const daLupa = mes >= 0 ? lupa?.(i, meses.findIndex((m) => m.mes === mes + 1)) : null;
                        return (
                          <td
                            key={c.chave}
                            className={`px-4 py-1.5 text-right whitespace-nowrap ${tom} ${c.chave === "acumulado" ? "border-l border-gray-300" : ""} ${fundo} ${aoPassar}`}
                            title={emDestaque ? dicaDoDestaque : undefined}
                          >
                            {daLupa ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  daLupa();
                                }}
                                title="Ver as movimentações do Quadro de Lotação que deram este valor"
                                className="mr-1 inline-flex align-middle text-gray-400 hover:text-gray-900"
                              >
                                <Search className="size-3.5" />
                              </button>
                            ) : null}
                            {c.texto?.(i)}
                          </td>
                        );
                      })}
                    </tr>
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
        </div>
        <BarraDeRolagem area={corpo} />
      </div>
    </>
  );
}
