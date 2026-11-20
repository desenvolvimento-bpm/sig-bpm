"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { ArrowDown, ArrowDown01, ArrowDown10, ArrowDownAZ, ArrowDownZA, ArrowUp, ChevronDown, Filter, FilterX, Search } from "lucide-react";

import { distintos, ESTADO_INICIAL, filtrar, ordenar, type Coluna, type EstadoTabela } from "@/lib/filtrosDeTabela";
import { iniciaisMaiusculas } from "@/lib/texto";

/** Acima disso, a lista do filtro mostra só os primeiros; a pesquisa acha os demais. */
const MAXIMO_NA_LISTA = 500;

const ROTULOS_ORDEM = {
  texto: ["Classificar de A a Z", "Classificar de Z a A", ArrowDownAZ, ArrowDownZA],
  numero: ["Do Menor para o Maior", "Do Maior para o Menor", ArrowDown01, ArrowDown10],
  data: ["Do Mais Antigo para o Mais Recente", "Do Mais Recente para o Mais Antigo", ArrowDown01, ArrowDown10],
} as const;

/** Um valor da lista do filtro: a chave que filtra e o texto que aparece. */
export type ValorDoFiltro = { chave: string; texto: string; n?: number };

type PainelProps = {
  rotulo: string;
  tipo?: Coluna<unknown>["tipo"];
  alinhamento?: "direita";
  filtrado: boolean;
  ordem: { decrescente: boolean } | null;
  /** Os valores da lista, calculados ao abrir o painel. */
  valores: () => ValorDoFiltro[];
  /** As chaves marcadas ao abrir (sem filtro: todas). */
  marcadosAoAbrir: () => string[];
  onOrdenar: (decrescente: boolean) => void;
  /** null: sem filtro (todos marcados). */
  onAplicar: (chaves: string[] | null) => void;
  /** Algum filtro na tabela, nesta coluna ou em outra: habilita o Limpar Todos os Filtros. */
  algumFiltro: boolean;
  /** Limpa os filtros de todas as colunas da tabela (a ordem fica). */
  onLimparTodos: () => void;
  /** Só ordenar, sem lista de valores (a data da Auditoria, filtrada por De e Até). */
  soOrdenar?: boolean;
  /** Só filtrar, sem ordenar (colunas que o servidor não ordena). */
  semOrdem?: boolean;
};

/**
 * O botão do rótulo e o painel de ordenar e filtrar, como o filtro do Excel.
 * Não sabe de onde vêm os valores: a tabela filtrada na tela usa
 * FiltroDeColuna; a Auditoria, que filtra no servidor, passa os valores dele.
 */
export function PainelFiltro({ rotulo, tipo, alinhamento, filtrado, ordem, valores: carregar, marcadosAoAbrir, onOrdenar, onAplicar, algumFiltro, onLimparTodos, soOrdenar, semOrdem }: PainelProps) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [valores, setValores] = useState<ValorDoFiltro[]>([]);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());

  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const achados = termo ? valores.filter((v) => v.texto.toLocaleLowerCase("pt-BR").includes(termo)) : valores;
  const mostrados = achados.slice(0, MAXIMO_NA_LISTA);
  const todosMarcados = achados.length > 0 && achados.every((v) => marcados.has(v.chave));

  const abrir = (sim: boolean) => {
    if (sim) {
      setBusca("");
      setValores(carregar());
      setMarcados(new Set(marcadosAoAbrir()));
    }
    setAberto(sim);
  };
  const aplicar = () => {
    // Com pesquisa, valem só os achados marcados (como no Excel).
    const escolhidos = (termo ? achados : valores).filter((v) => marcados.has(v.chave)).map((v) => v.chave);
    onAplicar(escolhidos.length === valores.length ? null : escolhidos);
    setAberto(false);
  };
  const fechaE = (f: () => void) => () => {
    f();
    setAberto(false);
  };

  const [rotuloCresc, rotuloDecresc, IconeCresc, IconeDecresc] = ROTULOS_ORDEM[tipo ?? "texto"];
  const Icone = filtrado ? Filter : ordem ? (ordem.decrescente ? ArrowDown : ArrowUp) : ChevronDown;
  const itemMenu = "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm normal-case tracking-normal font-normal text-gray-800 hover:bg-gray-100 disabled:pointer-events-none disabled:text-gray-400";

  return (
    <Popover.Root open={aberto} onOpenChange={abrir}>
      <Popover.Trigger
        aria-label={`Ordenar e filtrar ${rotulo}`}
        className={`inline-flex size-4 shrink-0 items-center justify-center rounded-sm border ${
          filtrado || ordem ? "border-black bg-black text-bpm-primary" : "border-gray-400 bg-white text-gray-600 hover:border-gray-700 hover:text-gray-900"
        }`}
      >
        <Icone className="size-3" strokeWidth={filtrado ? 2.5 : 2} fill={filtrado ? "currentColor" : "none"} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={4} align={alinhamento === "direita" ? "end" : "start"} className="z-50">
          <Popover.Popup className="w-72 rounded-sm border border-gray-200 bg-white p-1.5 text-gray-900 shadow-lg outline-none">
            {semOrdem ? null : (
              <>
                <button type="button" className={itemMenu} onClick={fechaE(() => onOrdenar(false))}>
                  <IconeCresc className="size-4 text-gray-500" />
                  {rotuloCresc}
                </button>
                <button type="button" className={itemMenu} onClick={fechaE(() => onOrdenar(true))}>
                  <IconeDecresc className="size-4 text-gray-500" />
                  {rotuloDecresc}
                </button>
              </>
            )}
            {soOrdenar ? null : (
              <>
                <button type="button" className={itemMenu} disabled={!filtrado} onClick={fechaE(() => onAplicar(null))}>
                  <FilterX className="size-4 text-gray-500" />
                  Limpar Filtro de &quot;{rotulo}&quot;
                </button>
                {/* Os filtros de todas as colunas (06/11/2026, pedido do Adão), no lugar do Limpar Filtros acima da tabela. */}
                <button type="button" className={itemMenu} disabled={!algumFiltro} onClick={fechaE(onLimparTodos)}>
                  <FilterX className="size-4 text-gray-500" />
                  Limpar Todos os Filtros
                </button>
                <div className="my-1.5 border-t border-gray-200" />
                <div className="relative px-1">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-gray-400" />
                  <input
                    autoFocus
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Pesquisar"
                    aria-label={`Pesquisar em ${rotulo}`}
                    className="h-8 w-full rounded-sm border border-gray-300 pr-2 pl-7 text-sm outline-none focus:border-gray-500"
                  />
                </div>
                <div className="mt-1.5 max-h-64 overflow-y-auto rounded-sm border border-gray-200 py-1 text-sm">
                  <label className="flex cursor-pointer items-center gap-2 px-2 py-1 font-medium hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={todosMarcados}
                      onChange={(e) => {
                        const novo = new Set(marcados);
                        achados.forEach((v) => (e.target.checked ? novo.add(v.chave) : novo.delete(v.chave)));
                        setMarcados(novo);
                      }}
                      className="size-3.5 accent-black"
                    />
                    {termo ? "(Selecionar todos os resultados)" : "(Selecionar tudo)"}
                  </label>
                  {mostrados.map((v) => (
                    <label key={v.chave} className="flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={marcados.has(v.chave)}
                        onChange={(e) => {
                          const novo = new Set(marcados);
                          if (e.target.checked) novo.add(v.chave);
                          else novo.delete(v.chave);
                          setMarcados(novo);
                        }}
                        className="size-3.5 accent-black"
                      />
                      <span className="min-w-0 flex-1 truncate" title={v.texto}>
                        {v.texto}
                      </span>
                      {v.n !== undefined ? <span className="text-xs text-gray-400 tabular-nums">{v.n.toLocaleString("pt-BR")}</span> : null}
                    </label>
                  ))}
                  {achados.length > MAXIMO_NA_LISTA ? (
                    <p className="px-2 py-1 text-xs text-gray-500">
                      Mostrando {MAXIMO_NA_LISTA} de {achados.length.toLocaleString("pt-BR")}; pesquise para achar os demais.
                    </p>
                  ) : null}
                  {achados.length === 0 ? <p className="px-2 py-1 text-xs text-gray-500">Nada encontrado.</p> : null}
                </div>
                <div className="mt-1.5 flex justify-end gap-2">
                  <button type="button" onClick={() => setAberto(false)} className="h-8 rounded-sm border border-gray-300 px-3 text-sm hover:bg-gray-100">
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={aplicar}
                    disabled={!(termo ? achados : valores).some((v) => marcados.has(v.chave))}
                    className="bg-bpm-primary hover:bg-bpm-primary-hover h-8 rounded-sm px-4 text-sm font-bold text-black disabled:opacity-50"
                  >
                    OK
                  </button>
                </div>
              </>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

type FiltroProps<T> = { coluna: Coluna<T>; linhas: T[]; colunas: Coluna<T>[]; estado: EstadoTabela; onMudar: (e: EstadoTabela) => void };

/** O painel sobre as linhas da tela: a lista mostra os valores das linhas que passam nos filtros das outras colunas. */
function FiltroDeColuna<T>({ coluna, linhas, colunas, estado, onMudar }: FiltroProps<T>) {
  const lista = () => distintos(filtrar(linhas, colunas, estado, coluna.chave), coluna).map((v) => ({ chave: v.texto, texto: v.texto, n: v.n }));
  return (
    <PainelFiltro
      rotulo={iniciaisMaiusculas(coluna.rotulo)}
      tipo={coluna.tipo}
      alinhamento={coluna.alinhamento}
      filtrado={!!estado.filtros[coluna.chave]}
      ordem={estado.ordem?.chave === coluna.chave ? estado.ordem : null}
      valores={lista}
      marcadosAoAbrir={() => estado.filtros[coluna.chave] ?? lista().map((v) => v.chave)}
      onOrdenar={(decrescente) => onMudar({ ...estado, ordem: { chave: coluna.chave, decrescente } })}
      onAplicar={(chaves) => {
        const filtros = { ...estado.filtros };
        if (chaves === null) delete filtros[coluna.chave];
        else filtros[coluna.chave] = chaves;
        onMudar({ ...estado, filtros });
      }}
      algumFiltro={Object.keys(estado.filtros).length > 0}
      onLimparTodos={() => onMudar({ ...estado, filtros: {} })}
    />
  );
}

type Opcoes = {
  /** Linhas por página; sem ele, a tabela mostra todas. */
  porPaginaInicial?: number;
};

/**
 * Ordenar e filtrar pelos rótulos das colunas, como no Excel, com a paginação
 * depois do filtro. As colunas precisam ser estáveis (definidas fora do
 * componente ou num useMemo), porque entram nas memórias de cálculo.
 */
export function useTabelaFiltravel<T>(linhas: T[] | undefined, colunas: Coluna<T>[], opcoes: Opcoes = {}) {
  const [estado, setEstado] = useState<EstadoTabela>(ESTADO_INICIAL);
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(opcoes.porPaginaInicial ?? 0);
  const todas = useMemo(() => linhas ?? [], [linhas]);
  const filtradas = useMemo(() => ordenar(filtrar(todas, colunas, estado), colunas, estado), [todas, colunas, estado]);
  const paginas = porPagina ? Math.max(1, Math.ceil(filtradas.length / porPagina)) : 1;
  const atual = Math.min(pagina, paginas);
  const visiveis = porPagina ? filtradas.slice((atual - 1) * porPagina, atual * porPagina) : filtradas;
  const mudar = (e: EstadoTabela) => {
    setEstado(e);
    setPagina(1);
  };

  // Nas colunas sem filtro, a tela pode pôr outro conteúdo no rótulo (a caixa de marcar todas, nas divergências); nas
  // com filtro, algo antes do rótulo (`antes`: a lista dos grupos, em Indicadores, 13/10/2026).
  const linha = (extras: Record<string, ReactNode> = {}, antes: Record<string, ReactNode> = {}): ReactNode => (
    // Rótulos no cinza do .tabela-sig th, mais escuro que as linhas.
    <tr className="border-b border-gray-200">
      {colunas.map((c) => (
        <th
          key={c.chave}
          className={`px-4 py-3 text-xs font-bold text-gray-900 ${c.alinhamento === "direita" ? "text-right" : "text-left"} ${c.classe ?? ""}`}
        >
          {c.semFiltro ? (
            (extras[c.chave] ?? iniciaisMaiusculas(c.rotulo))
          ) : (
            <span className={`inline-flex items-center gap-1 ${c.alinhamento === "direita" ? "flex-row-reverse" : ""}`}>
              {antes[c.chave]}
              {iniciaisMaiusculas(c.rotulo)}
              <FiltroDeColuna coluna={c} linhas={todas} colunas={colunas} estado={estado} onMudar={mudar} />
            </span>
          )}
        </th>
      ))}
    </tr>
  );
  const montar = (extras: Record<string, ReactNode> = {}, antes: Record<string, ReactNode> = {}): ReactNode => <thead>{linha(extras, antes)}</thead>;

  return {
    cabecalho: montar(),
    /** O cabeçalho com conteúdo próprio no rótulo de colunas sem filtro, por chave (e, no segundo, antes do rótulo das com filtro). */
    cabecalhoCom: montar,
    /** A linha dos rótulos, sem o <thead> (20/11/2026: para a TabelaLarga, que põe os rótulos numa tabela presa à parte). */
    linhaDoCabecalho: linha(),
    /** A linha dos rótulos com conteúdo próprio (como `cabecalhoCom`), sem o <thead>. */
    linhaDoCabecalhoCom: linha,
    /** As linhas da página atual, já filtradas e ordenadas. */
    visiveis,
    /** Todas as que passam nos filtros (para totais e exportação). */
    filtradas,
    total: filtradas.length,
    totalGeral: todas.length,
    ativos: Object.keys(estado.filtros).length > 0 || estado.ordem !== null,
    limpar: () => mudar(ESTADO_INICIAL),
    pagina: atual,
    setPagina,
    porPagina,
    setPorPagina: (n: number) => {
      setPorPagina(n);
      setPagina(1);
    },
  };
}

/** A linha da tabela quando os filtros não deixam nada (o cabeçalho fica, para desfazer o filtro). */
export function SemResultado({ colunas, onLimpar }: { colunas: number; onLimpar: () => void }) {
  return (
    <tr>
      <td colSpan={colunas} className="px-4 py-10 text-center text-sm text-gray-600">
        Nenhum registro com esses filtros.{" "}
        <button type="button" onClick={onLimpar} className="font-medium text-gray-900 underline underline-offset-2">
          Limpar Filtros
        </button>
      </td>
    </tr>
  );
}
