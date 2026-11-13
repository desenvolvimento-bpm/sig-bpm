"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Search, Sigma } from "lucide-react";

import { useAbaLembrada } from "@/hooks/useAbaLembrada";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionContext";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";
import { CabecalhoDaTela } from "@/components/shared/CabecalhoDaTela";
import { Abas } from "@/components/shared/Abas";
import { CampoBusca } from "@/components/shared/Filtros";

import { lerAnoMes, moeda, moedaInteira } from "../utils/formatacao";
import { formato } from "@/app/relatorios/services/relatoriosService";
import { CreditosDoMes, ExportarCreditosDoMes } from "../impostos/components/CreditosDoMes";
import { DetalheDialog } from "./components/DetalheDialog";
import { ExportarDRE } from "./components/ExportarDRE";
import { AcoesApuracao, SituacaoApuracao, TextoApuracao } from "./components/PainelApuracao";
import { InfoAgrupamento } from "./components/InfoAgrupamento";
import { VolumesDialog } from "./components/VolumesDialog";
import { Agrupador, fundoDaLinha, SeletorNivel, semPrimeiroTotalDaRol, useNiveisDRE } from "./components/NiveisDRE";
import { dreService, mensagemDeErro, ROTULO_CHAVE, UNIDADES, type LinhaDRE, type VisaoDetalhe } from "./services/dreService";

const ehVolume = (l: LinhaDRE) => l.grupoSigla === "P" || l.grupoSigla === "S";
/** As larguras das colunas de números, iguais nos rótulos da faixa do título e nas células (13/11/2026: o % e o R$/m³). */
const COLUNA = { valor: "w-36", pct: "w-24", unitario: "w-28" };
const volume = (v: string) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/** Consolidado, uma das unidades (1 a 5), a visão por centro de custo, a dos movimentos sem centro, a por obra ou os créditos de impostos. */
type Visao = "consolidado" | "centros" | "sem_centros" | "obras" | "impostos" | number;
const ABA_DA_UNIDADE = ["consolidado", "matriz", "filial", "servicos", "despesas", "rn"];
const VISOES: Array<{ visao: Visao; aba: string; nome: string }> = [
  { visao: "consolidado", aba: "consolidado", nome: "Consolidado" },
  ...UNIDADES.map((u) => ({ visao: u.codigo as Visao, aba: ABA_DA_UNIDADE[u.codigo], nome: u.nome })),
  { visao: "centros", aba: "centros", nome: "Centros de Custo" },
  // Os movimentos sem centro de custo (15/10/2026), como em Resultados Empresariais.
  { visao: "sem_centros", aba: "sem_centros", nome: "Sem Centros de Custo" },
  { visao: "obras", aba: "obras", nome: "Obras" },
  // Os Créditos de Impostos do mês (04/11/2026, pedido do Adão; de 03/11/2026, a etapa Impostos), como em Resultados Empresariais.
  { visao: "impostos", aba: "impostos", nome: "Impostos" },
];

/**
 * Linhas que abrem o detalhamento até os lançamentos: os itens e os impostos
 * das unidades, desde que o usuário alcance as movimentações delas (o recorte
 * do Gestor por departamento, Passo 22, que o backend informa em podeDetalhar).
 */
const detalhavel = (l: LinhaDRE) => !ehVolume(l) && (l.tipo === "ITEM" || l.descricao === "Impostos Operacionais") && l.podeDetalhar !== false;

/** Linhas de volume (Produção, Expedição, Montagem, Acompanhamento): abrem as listas por obra, no consolidado, nas unidades e na obra (só as dela). */
const listavel = (l: LinhaDRE, visao: VisaoDetalhe) => ehVolume(l) && l.tipo === "ITEM" && ("unidade" in visao || "consolidado" in visao || "obra" in visao);

function Composicao({ l }: { l: LinhaDRE }) {
  const c = l.composicao;
  if (!c) return null;
  return (
    <div className="space-y-1 text-xs text-gray-600">
      <p>{c.regra}</p>
      {c.direto !== undefined ? <p>Diretos: {moeda(c.direto)}</p> : null}
      {c.rateios?.map((r) => (
        <p key={`${r.chave}|${r.destino}|${r.competencia ?? ""}`}>
          Rateio {ROTULO_CHAVE[r.chave] ?? r.chave}
          {r.competencia ? ` (lançamentos manuais, com os percentuais de ${r.competencia})` : ""}: {r.base.split(": ")[1] ? moeda(r.base.split(": ")[1]) : r.base} ×{" "}
          {(Number(r.percentual) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}% = {moeda(r.valor)}
        </p>
      ))}
      {c.unidades?.map((u) => (
        <p key={u.unidade}>
          {u.nome}: {ehVolume(l) ? volume(u.valor) : moeda(u.valor)}
        </p>
      ))}
      {c.centros?.map((cc) => (
        <p key={`${cc.codigoRM}|${cc.nome}`}>
          {cc.codigoRM ?? "sem código"} · {cc.nome}: {moeda(cc.valor)}
        </p>
      ))}
      {c.observacao ? <p className="text-gray-500">{c.observacao}</p> : null}
    </div>
  );
}


function TabelaDRE({
  linhas: todas,
  anoMes,
  visao,
  titulo,
  aoLadoDoTitulo,
}: {
  linhas: LinhaDRE[];
  anoMes: string;
  visao: VisaoDetalhe;
  titulo: string;
  /** Conteúdo logo depois do título (o botão de informação do centro de custo). */
  aoLadoDoTitulo?: ReactNode;
}) {
  // Os níveis (Totais, Atribuições, Contas) e os agrupadores, como no contorno da planilha; sem o primeiro total da ROL,
  // que repete o segundo (22/10/2026).
  const semRolRepetida = useMemo(() => semPrimeiroTotalDaRol(todas), [todas]);
  const niveis = useNiveisDRE(semRolRepetida, "sig.dre.nivel", undefined, "aberta");

  const [aberta, setAberta] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<string | null>(null);
  const [listasDe, setListasDe] = useState<LinhaDRE | null>(null);
  // As linhas que chegam aos lançamentos abrem o detalhamento; as de volume, as listas; as demais (totais) abrem a composição.
  const comLupa = (l: LinhaDRE) => detalhavel(l) || listavel(l, visao);
  const abre = (l: LinhaDRE) => !!l.composicao && !comLupa(l);
  const clica = (l: LinhaDRE) => comLupa(l) || abre(l);
  const nomeVisao = titulo.replace(/^DRE · /, "");
  return (
    // Destaque amarelo-ouro à esquerda, como nos quadros da Receita Prévia.
    <div className="rounded-sm border border-gray-200 bg-white">
      {/* Título como nos quadros da Receita Prévia e de Rateios; fica preso no topo ao rolar a DRE (E10 do levantamento de layout). */}
      <div className="sticky top-[var(--topo-tabela,0px)] z-10 flex items-center gap-4 border-b border-gray-200 bg-bpm-primary py-3 pl-4">
        {/* Os níveis da planilha (1, 2 e 3 do contorno do Excel), num menu. */}
        <SeletorNivel nivel={niveis.nivelGeral} onEscolher={niveis.escolherNivel} />
        <h2 className="text-base font-bold tracking-wide text-gray-900 uppercase">{titulo}</h2>
        {aoLadoDoTitulo}
        {/*
         * Sobre as colunas dos números, com as larguras e o espaço das células (o px-4): o Valor, o % e o R$/m³ (13/11/2026,
         * pedido do Adão, com as regras dos Resultados Empresariais). A faixa não tem o espaço da direita: o da última célula.
         */}
        <div className="ml-auto flex shrink-0">
          <span className={`${COLUNA.valor} px-4 text-right text-base font-bold tracking-wide text-gray-900 uppercase`}>Valor</span>
          <span className={`${COLUNA.pct} px-4 text-right text-base font-bold tracking-wide text-gray-900`}>%</span>
          <span className={`${COLUNA.unitario} px-4 text-right text-base font-bold tracking-wide text-gray-900`}>R$/m³</span>
        </div>
      </div>
      <table className="tabela-sig w-full border-collapse text-sm">
        <tbody>
          {niveis.linhas
            .filter(niveis.visivel)
            .map((l) => {
              const destaque = l.tipo !== "ITEM";
              const aberto = aberta === l.codigo;
              return (
                <Fragment key={l.codigo}>
                  <tr
                    className={`${destaque ? "border-y border-gray-300 font-bold" : "border-t border-gray-100"} ${fundoDaLinha(l)} ${clica(l) ? "cursor-pointer hover:bg-gray-100" : ""}`}
                    onClick={() =>
                      detalhavel(l) ? setDetalhe(l.codigo) : listavel(l, visao) ? setListasDe(l) : abre(l) ? setAberta(aberto ? null : l.codigo) : undefined
                    }
                    title={detalhavel(l) ? "Ver os lançamentos de origem" : listavel(l, visao) ? "Ver as listas por obra" : abre(l) ? "Ver a composição" : undefined}
                  >
                    <td className={`py-1.5 pr-4 whitespace-nowrap ${niveis.recuo(l)} ${destaque ? "text-gray-900" : "text-gray-700"}`}>
                      <span className="inline-flex items-center gap-1">
                        {/* O agrupador da linha: abre e fecha o que está abaixo dela. */}
                        <Agrupador grupo={niveis.grupo(l)} fechado={niveis.fechado(l)} onAlternar={() => niveis.alternar(l.codigo)} />
                        {comLupa(l) ? <Search className="size-3.5 text-gray-400" /> : abre(l) ? <Sigma className="size-3.5 text-gray-400" /> : null}
                        {l.descricao}
                      </span>
                    </td>
                    <td className={`${COLUNA.valor} px-4 py-1.5 text-right`}>
                      {/* Os valores sem os centavos; os volumes com as casas da lista. */}
                      {l.tipo === "SECAO" ? "" : l.valor === null ? "—" : ehVolume(l) ? volume(l.valor) : moedaInteira(l.valor)}
                    </td>
                    {/* O % e o R$/m³, como nos Resultados Empresariais: em branco sem a coluna ou sem a base. */}
                    <td className={`${COLUNA.pct} px-4 py-1.5 text-right text-xs ${destaque ? "text-gray-700" : "text-gray-500"}`}>
                      {l.pct === null || l.pct === undefined ? "" : formato.pct(l.pct)}
                    </td>
                    <td className={`${COLUNA.unitario} px-4 py-1.5 text-right text-xs ${destaque ? "text-gray-700" : "text-gray-500"}`}>
                      {l.unitario === null || l.unitario === undefined ? "" : formato.valor(l.unitario)}
                    </td>
                  </tr>
                  {aberto && abre(l) ? (
                    <tr className="border-t border-gray-100 bg-gray-50/50">
                      <td colSpan={4} className="px-8 py-2">
                        <Composicao l={l} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
        </tbody>
      </table>
      {detalhe ? <DetalheDialog anoMes={anoMes} linha={detalhe} visao={visao} onFechar={() => setDetalhe(null)} /> : null}
      {listasDe ? (
        <VolumesDialog
          anoMes={anoMes}
          linha={listasDe.codigo}
          unidade={"unidade" in visao ? visao.unidade : undefined}
          obra={"obra" in visao ? visao.obra : undefined}
          nomeVisao={nomeVisao}
          valorApurado={listasDe.valor}
          onFechar={() => setListasDe(null)}
        />
      ) : null}
    </div>
  );
}

const Carregando = () => <div className="h-64 animate-pulse rounded-sm bg-gray-100" />;
const Erro = ({ erro, padrao }: { erro: unknown; padrao: string }) => (
  <div className="rounded-sm border border-red-200 bg-red-50 p-4">
    <p className="text-sm text-red-700">{mensagemDeErro(erro, padrao)}</p>
  </div>
);
const SemApuracao = () => (
  <div className="rounded-sm border border-gray-200 bg-white p-6 text-sm text-gray-600">
    Nenhuma apuração ainda. Apure os rateios e a receita prévia do mês e, depois, a DRE.
  </div>
);
/** Centros de Custo, Sem Centros de Custo e Obras saem dos lançamentos desde a importação do balancete (15/10/2026). */
const SemLancamento = ({ oQue }: { oQue: string }) => (
  <div className="rounded-sm border border-gray-200 bg-white p-6 text-sm text-gray-600">
    {oQue} Esta aba se consulta desde a importação do balancete, antes da apuração, com os lançamentos já classificados.
  </div>
);

/**
 * Na DRE de um centro de custo, só os custos de produção e de serviços e as
 * despesas de logística, técnicas, comerciais e administrativas, nas
 * atribuições de mão de obra (direta e indireta), de gastos gerais (variáveis,
 * diretos, indiretos e comerciais) e de depreciação que têm valor. Cada total
 * soma só as atribuições que aparecem.
 */
const TOTAIS_DO_CENTRO = new Set(["CPP", "CSM", "CSC", "DL", "DT", "DC", "DA"]);
const ATRIBUICOES_DO_CENTRO = new Set([
  "MÃO DE OBRA DIRETA",
  "MÃO DE OBRA INDIRETA",
  "GASTOS GERAIS VARIÁVEIS",
  "GASTOS GERAIS DIRETOS",
  "GASTOS GERAIS INDIRETOS",
  "GASTOS GERAIS COMERCIAIS",
  "DEPRECIAÇÃO",
]);
function linhasDoCentro(linhas: LinhaDRE[]) {
  const partes = (c: string) => c.split(".");
  const prefixo = (c: string) => partes(c).slice(0, 2).join(".");
  const mostradas = linhas.filter(
    (l) =>
      l.tipo !== "ITEM" &&
      partes(l.codigo).length === 3 &&
      TOTAIS_DO_CENTRO.has(partes(l.codigo)[0]) &&
      ATRIBUICOES_DO_CENTRO.has(l.descricao.trim().toUpperCase()) &&
      Number(l.valor ?? 0) !== 0,
  );
  const atribuicoes = new Set(mostradas.map((l) => prefixo(l.codigo)));
  // O total de cada grupo passa a ser a soma das atribuições mostradas, em centavos para não acumular erro.
  const soma = new Map<string, number>();
  for (const a of mostradas) {
    const g = partes(a.codigo)[0];
    soma.set(g, (soma.get(g) ?? 0) + Math.round(Number(a.valor) * 100));
  }
  return linhas
    .filter((l) => {
      if (l.tipo === "SECAO") return false;
      const p = partes(l.codigo);
      return p.length === 2 ? l.tipo !== "ITEM" && soma.has(p[0]) : atribuicoes.has(prefixo(l.codigo));
    })
    // Sem a composição (Σ): nos centros, os totais são a soma do que a tabela mostra.
    .map((l) => {
      const p = partes(l.codigo);
      return p.length === 2 ? { ...l, valor: (soma.get(p[0])! / 100).toFixed(2), composicao: null } : { ...l, composicao: null };
    });
}

function VisaoCentros({ anoMes, escolhido, onEscolher }: { anoMes: string; escolhido: string | null; onEscolher: (grupo: string) => void }) {
  const { user } = useAuth();
  const [busca, setBusca] = useState("");
  const grupos = useQuery({ queryKey: ["dre", anoMes, "grupos"], queryFn: () => dreService.grupos(anoMes) });
  const lista = grupos.data?.grupos ?? [];
  const centros = useQuery({
    queryKey: ["dre", anoMes, "centros", escolhido],
    queryFn: () => dreService.centros(anoMes, escolhido!),
    enabled: escolhido !== null,
  });
  const linhas = useMemo(() => linhasDoCentro(centros.data?.linhas ?? []), [centros.data]);

  if (grupos.isError) return <Erro erro={grupos.error} padrao="Erro ao carregar os centros de custo." />;
  if (grupos.isPending) return <Carregando />;
  if (lista.length === 0) {
    return user?.acesso.recorteDepartamento ? (
      <div className="rounded-sm border border-gray-200 bg-white p-6 text-sm text-gray-600">
        Nenhum centro de custo dos seus departamentos tem lançamento neste mês.
      </div>
    ) : (
      <SemLancamento oQue="Nenhum centro de custo tem lançamento classificado neste mês." />
    );
  }
  const t = busca.trim().toLowerCase();
  const filtrados = lista.filter((g) => !t || g.grupo.toLowerCase().includes(t));
  return (
    // A lista dos centros, com busca, à esquerda da DRE do centro (E11 do levantamento de layout); sem o total de cada um (09/10/2026).
    <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start">
      <div className="rounded-sm border border-gray-200 bg-white lg:sticky lg:top-[calc(var(--topo-tabela,0px)+1rem)]">
        <div className="border-b border-gray-200 p-2">
          <CampoBusca rotulo="Buscar centro de custo" valor={busca} onMudar={setBusca} placeholder="Centro de Custo…" largura="w-full" />
        </div>
        <ul className="max-h-[60vh] overflow-y-auto py-1" aria-label="Centros de custo">
          {filtrados.map((g) => (
            <li key={g.grupo}>
              <button
                type="button"
                onClick={() => onEscolher(g.grupo)}
                aria-current={g.grupo === escolhido ? "true" : undefined}
                className={`flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm ${g.grupo === escolhido ? "bg-black text-white" : "text-gray-800 hover:bg-gray-100"}`}
              >
                <span className="min-w-0 truncate" title={g.grupo}>
                  {g.grupo}
                </span>
              </button>
            </li>
          ))}
          {filtrados.length === 0 ? <li className="px-3 py-2 text-sm text-gray-500">Nenhum centro com esse nome.</li> : null}
        </ul>
      </div>

      <div className="min-w-0">
        {centros.isError ? (
          <Erro erro={centros.error} padrao="Erro ao carregar o centro de custo." />
        ) : centros.isPending ? (
          <Carregando />
        ) : (
          <>
            <TabelaDRE
              key={escolhido ?? ""}
              linhas={linhas}
              anoMes={anoMes}
              visao={{ grupo: escolhido! }}
              titulo={escolhido ?? ""}
              aoLadoDoTitulo={<InfoAgrupamento grupo={escolhido ?? ""} centros={centros.data?.centros ?? []} />}
            />
            {linhas.length === 0 ? (
              <p className="mt-3 text-sm text-gray-600">Este centro não tem custos nem despesas de mão de obra ou de gastos gerais neste mês.</p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * A visão por obra (09/10/2026): a lista das obras do mês — os centros de obra do RM (1.98 e 1.99) com lançamento —
 * com busca (sem o resultado de cada uma, pedido de 09/10/2026), à esquerda da DRE da obra, como em Centros de Custo. A DRE da obra tem todos os
 * movimentos: receita operacional, impostos, custos, despesas e receitas e despesas financeiras; e, no grupo PS, os volumes da obra
 * nas listas (30/10/2026).
 */
function VisaoObras({ anoMes, escolhida, onEscolher }: { anoMes: string; escolhida: string | null; onEscolher: (obra: string) => void }) {
  const [busca, setBusca] = useState("");
  const obras = useQuery({ queryKey: ["dre", anoMes, "obras"], queryFn: () => dreService.obras(anoMes) });
  const lista = obras.data?.obras ?? [];
  const obra = useQuery({
    queryKey: ["dre", anoMes, "obra", escolhida],
    queryFn: () => dreService.obra(anoMes, escolhida!),
    enabled: escolhida !== null,
  });

  if (obras.isError) return <Erro erro={obras.error} padrao="Erro ao carregar as obras." />;
  if (obras.isPending) return <Carregando />;
  if (lista.length === 0) return <SemLancamento oQue="Nenhuma obra tem lançamento classificado neste mês." />;
  const t = busca.trim().toLowerCase();
  const filtradas = lista.filter((o) => !t || o.nome.toLowerCase().includes(t) || o.codigo.includes(t));
  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start">
      <div className="rounded-sm border border-gray-200 bg-white lg:sticky lg:top-[calc(var(--topo-tabela,0px)+1rem)]">
        <div className="border-b border-gray-200 p-2">
          <CampoBusca rotulo="Buscar obra" valor={busca} onMudar={setBusca} placeholder="Obra ou Código…" largura="w-full" />
        </div>
        <ul className="max-h-[60vh] overflow-y-auto py-1" aria-label="Obras">
          {filtradas.map((o) => (
            <li key={o.codigo}>
              <button
                type="button"
                onClick={() => onEscolher(o.codigo)}
                aria-current={o.codigo === escolhida ? "true" : undefined}
                title={`${o.nome} (${o.codigo})`}
                className={`block w-full px-3 py-1.5 text-left text-sm ${o.codigo === escolhida ? "bg-black text-white" : "text-gray-800 hover:bg-gray-100"}`}
              >
                {/* O código do centro de obra no RM acima do nome (09/10/2026). */}
                <span className={`block text-xs ${o.codigo === escolhida ? "text-gray-300" : "text-gray-500"}`}>{o.codigo}</span>
                <span className="block truncate">{o.nome}</span>
              </button>
            </li>
          ))}
          {filtradas.length === 0 ? <li className="px-3 py-2 text-sm text-gray-500">Nenhuma obra com esse nome ou código.</li> : null}
        </ul>
      </div>

      <div className="min-w-0">
        {obra.isError ? (
          <Erro erro={obra.error} padrao="Erro ao carregar a obra." />
        ) : obra.isPending ? (
          <Carregando />
        ) : (
          <TabelaDRE
            key={escolhida ?? ""}
            linhas={obra.data.linhas}
            anoMes={anoMes}
            visao={{ obra: escolhida! }}
            titulo={obra.data.obra.nome}
            aoLadoDoTitulo={<span className="text-sm whitespace-nowrap text-gray-800">{obra.data.obra.codigo}</span>}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Os movimentos sem centro de custo (15/10/2026; antes, só em Resultados Empresariais): os grupos (Produção Matriz,
 * Produção Filial, Serviços, Logística…) com lançamento de mão de obra ou de gastos gerais sem centro do cadastro, à
 * esquerda da DRE do grupo, como em Obras.
 */
function VisaoSemCentros({ anoMes, escolhido, onEscolher }: { anoMes: string; escolhido: string | null; onEscolher: (grupo: string) => void }) {
  const grupos = useQuery({ queryKey: ["dre", anoMes, "sem-centros"], queryFn: () => dreService.semCentros(anoMes) });
  const lista = grupos.data?.grupos ?? [];
  const dre = useQuery({
    queryKey: ["dre", anoMes, "sem-centro", escolhido],
    queryFn: () => dreService.semCentro(anoMes, escolhido!),
    enabled: escolhido !== null,
  });
  if (grupos.isError) return <Erro erro={grupos.error} padrao="Erro ao carregar os movimentos sem centro de custo." />;
  if (grupos.isPending) return <Carregando />;
  if (lista.length === 0) return <SemLancamento oQue="Nenhum lançamento de mão de obra ou de gastos gerais sem centro de custo neste mês." />;
  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start">
      <div className="rounded-sm border border-gray-200 bg-white lg:sticky lg:top-[calc(var(--topo-tabela,0px)+1rem)]">
        <ul className="max-h-[60vh] overflow-y-auto py-1" aria-label="Grupos sem centro de custo">
          {lista.map((g) => (
            <li key={g.codigo}>
              <button
                type="button"
                onClick={() => onEscolher(g.codigo)}
                aria-current={g.codigo === escolhido ? "true" : undefined}
                className={`block w-full truncate px-3 py-1.5 text-left text-sm ${g.codigo === escolhido ? "bg-black text-white" : "text-gray-800 hover:bg-gray-100"}`}
              >
                {g.nome}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0">
        {dre.isError ? (
          <Erro erro={dre.error} padrao="Erro ao carregar o grupo." />
        ) : dre.isPending ? (
          <Carregando />
        ) : (
          <TabelaDRE key={escolhido ?? ""} linhas={dre.data.linhas} anoMes={anoMes} visao={{ semCentro: escolhido! }} titulo={`Sem Centro de Custo · ${dre.data.grupo.nome}`} />
        )}
      </div>
    </div>
  );
}

export function DREContent() {
  const { anoMes } = useParams<{ anoMes: string }>();
  useRegistrarAcessoTela(`/competencias/${anoMes}/dre`);
  const periodo = lerAnoMes(anoMes);
  // As abas que o perfil lê (14/10/2026).
  const { hasPermission } = usePermissions();
  const visoes = VISOES.filter((v) => hasPermission(`dre.${v.aba}:ler`));
  // A visão (a aba) lembrada ao recarregar (30/10/2026): guardada como texto; a de uma unidade, o número dela.
  const [visaoLembrada, setVisaoLembrada] = useAbaLembrada("visao", "consolidado");
  const visaoEscolhida: Visao = /^\d+$/.test(visaoLembrada) ? Number(visaoLembrada) : (visaoLembrada as Visao);
  const setVisao = (v: Visao) => setVisaoLembrada(String(v));
  const visao: Visao | null = visoes.some((v) => v.visao === visaoEscolhida) ? visaoEscolhida : (visoes[0]?.visao ?? null);
  const leConsolidado = visoes.some((v) => v.visao === "consolidado");
  const [avisos, setAvisos] = useState<string[]>([]);
  // O centro de custo escolhido fica aqui: o Exportar dele vai para a linha das abas, como nas demais visões.
  const [grupo, setGrupo] = useState<string | null>(null);
  const grupos = useQuery({ queryKey: ["dre", anoMes, "grupos"], queryFn: () => dreService.grupos(anoMes), enabled: periodo !== null && visao === "centros" });
  // O escolhido vale enquanto existir no mês; senão, o primeiro da lista.
  const listaGrupos = grupos.data?.grupos ?? [];
  const grupoEscolhido = (grupo && listaGrupos.some((g) => g.grupo === grupo) ? grupo : listaGrupos[0]?.grupo) ?? null;
  // A obra escolhida, do mesmo jeito: vale enquanto tiver lançamento no mês; senão, a primeira da lista.
  const [obra, setObra] = useState<string | null>(null);
  const obras = useQuery({ queryKey: ["dre", anoMes, "obras"], queryFn: () => dreService.obras(anoMes), enabled: periodo !== null && visao === "obras" });
  const listaObras = obras.data?.obras ?? [];
  const obraEscolhida = (obra && listaObras.some((o) => o.codigo === obra) ? obra : listaObras[0]?.codigo) ?? null;
  // O grupo sem centro de custo escolhido, do mesmo jeito.
  const [semCentro, setSemCentro] = useState<string | null>(null);
  const semCentros = useQuery({ queryKey: ["dre", anoMes, "sem-centros"], queryFn: () => dreService.semCentros(anoMes), enabled: periodo !== null && visao === "sem_centros" });
  const listaSemCentros = semCentros.data?.grupos ?? [];
  const semCentroEscolhido = (semCentro && listaSemCentros.some((g) => g.codigo === semCentro) ? semCentro : listaSemCentros[0]?.codigo) ?? null;

  // A consolidada também traz o estado da competência e da apuração para o cabeçalho.
  const consolidado = useQuery({
    queryKey: ["dre", anoMes, "consolidado"],
    queryFn: () => dreService.consolidado(anoMes),
    enabled: periodo !== null && leConsolidado,
  });
  const unidade = useQuery({
    // Chave própria ("unidade"): com a aba Consolidado aberta, ["dre", anoMes, visao] seria a mesma chave da consulta
    // consolidada, e a recarga depois da reapuração usava esta função, pedindo a "unidade consolidado" ao servidor.
    queryKey: ["dre", anoMes, "unidade", visao],
    queryFn: () => dreService.consultar(anoMes, visao as number),
    enabled: periodo !== null && typeof visao === "number",
  });

  if (!periodo) {
    return (
      <div className="rounded-sm border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-700">Competência inválida na URL: {anoMes}.</p>
      </div>
    );
  }
  // Sem a aba Consolidado, a apuração vem da unidade na tela.
  const cabecalho = leConsolidado ? consolidado.data : unidade.data;
  const consulta = visao === "consolidado" ? consolidado : unidade;

  // O Exportar (21/10/2026: na linha do título, no fim da barra, desde 30/10/2026; antes, ao lado das abas). Centros, sem
  // centros e obras: o Exportar desde a importação do balancete (15/10/2026).
  const exportar =
    visao === "centros" ? (
      grupoEscolhido ? <ExportarDRE anoMes={anoMes} visao={{ grupo: grupoEscolhido }} /> : null
    ) : visao === "sem_centros" ? (
      semCentroEscolhido ? <ExportarDRE anoMes={anoMes} visao={{ semCentro: semCentroEscolhido }} /> : null
    ) : visao === "obras" ? (
      obraEscolhida ? <ExportarDRE anoMes={anoMes} visao={{ obra: obraEscolhida }} /> : null
    ) : visao === "impostos" ? (
      <ExportarCreditosDoMes anoMes={anoMes} />
    ) : visao !== null && cabecalho?.apuradoEm ? (
      <ExportarDRE anoMes={anoMes} visao={visao} />
    ) : null;

  return (
    <div className="space-y-6">
      <CabecalhoDaTela
        titulo="Resultados"
        comoUsar={
          <ul>
            <li>Escolha a visão nas abas: Consolidado, cada unidade, RN, Centros de Custo, Sem Centros de Custo, Obras (com a lista dos centros, dos grupos ou das obras à esquerda) ou Impostos (os Créditos de Impostos). Aparecem só as abas que o seu perfil lê (Controle de Usuários / Perfis).</li>
            <li>
              Centros de Custo, Sem Centros de Custo e Obras saem dos lançamentos do balancete: consultam-se desde a importação, antes da apuração (com
              o que já está classificado). Depois da apuração, os centros de custo mostram os valores apurados.
            </li>
            <li>
              Em Sem Centros de Custo, os lançamentos de mão de obra e de gastos gerais sem centro de custo do cadastro, por grupo (pelo departamento da
              conta e pela filial), como em Resultados Empresariais.
            </li>
            <li>Clique numa linha com lupa para ver os lançamentos de origem; nas linhas de volume (Produção, Expedição, Montagem, Acompanhamento), as listas somadas por obra.</li>
            <li>
              As colunas % e R$/m³ ficam em branco nas linhas sem elas (os volumes, as contas sem R$/m³) e quando a base é zero; nos centros de custo e sem
              centro de custo, antes da apuração, também (a base é o Consolidado apurado). O Exportar leva as duas colunas.
            </li>
            <li>
              No extrato, clique na conta de um lançamento contábil para ver o balancete dela no mês (o modal Balancete): os movimentos da aba
              Balancete (Lista) do LISTAS REALIZADO (RESULTADOS), com a emissão, o cliente ou fornecedor e o histórico de cada um. Abre no centro
              de custo e na filial do lançamento, com a soma ao lado do valor dele; desmarque a caixa para ver a conta inteira.
            </li>
            <li>
              No Balancete, a coluna ID mostra o ID do movimento no RM (a coluna ID do Balancete (Lista)), e o botão Itens, na coluna Ações, abre os itens
              da requisição ou da nota fiscal com esse ID (as abas Requisições (Lista) e Notas Fiscais (Lista) importadas): o produto, o centro de custo, a
              conta, a quantidade e os valores. Abre com os itens do centro de custo e da conta do movimento, que somam o valor dele; desmarque a caixa para
              ver o documento inteiro, com os do movimento em amarelo. Quem contesta marca os itens do movimento e clica em “Contestar Selecionados” (no
              rodapé, à direita): a contestação leva só o valor deles para o novo centro de custo e/ou a nova conta (o item já contestado mostra o número
              da contestação). “Voltar aos Movimentos” (à esquerda) volta ao Balancete.
            </li>
            <li>
              “Regras de Rateio”, no canto de baixo do extrato, mostra as regras de rateio vigentes no mês: em cada chave (Projeto, Produção,
              Metalurgia, Armadura e Acompanhamento), como o valor se divide entre as unidades, com um card por destino (o percentual do mês e o volume);
              e os baldes diretos, que não se dividem.
            </li>
            <li>
              “Exportar”, no pé do extrato, baixa um Excel com a aba Movimentações (os lançamentos do extrato, por bloco, com o valor e a parcela na
              linha) e a aba Detalhes (os movimentos do balancete de cada lançamento, item a item: a emissão, o cliente ou fornecedor e o histórico). No
              Balancete, o “Exportar” baixa só a conta: o lançamento numa aba e os movimentos que o modal mostra (no recorte da caixa) na outra.
            </li>
            <li>
              No extrato e no balancete, o centro de custo e a conta são os que valem na DRE. Os corrigidos — pela reclassificação por conta ou por fornecedor (Cadastros da
              Apuração / Reclassificações) ou por uma contestação validada (Contestações de Gastos) — têm um ícone ao lado, que abre o original (o do balancete do
              RM) e o corrigido.
            </li>
            <li>
              No balancete, a coluna Ações tem “Contestar” (de quem edita Contestações de Gastos › Contestações › Solicitadas): o modal sugere o novo centro
              de custo (os de um departamento da DRE, com o código de três níveis, como 1.01.00000001) e/ou a nova conta de resultado (as do departamento do centro e as do Extra-Operacional) do movimento
              (as listas buscam por código ou nome) e, se quiser, o motivo. Com um centro novo de outro departamento, a conta do movimento não serve, e a nova
              conta é obrigatória. “Contestar Anteriores” e “Contestar Posteriores” levam junto os movimentos do
              mesmo fornecedor, conta e centro de custo nas competências anteriores e nas seguintes, com o total que muda. O movimento com uma contestação
              em andamento mostra o número e a situação dela; o que chega à linha pelo rateio de outra (como os da Metalurgia nas linhas de Serviços)
              mostra “Rateio”: contesta-se na linha de origem. A lupa ao lado de cada campo abre a lista inteira — os centros de custo (o departamento, a atribuição e o balde) e as Contas de Resultado (a linha e o grupo da DRE, o departamento, a atribuição e o balde) —, e clicar num item o escolhe. No canto de baixo do modal, “Regras de Rateio” mostra as regras vigentes no mês do movimento: como cada balde se divide entre as unidades.
            </li>
            <li>
              Os lançamentos de rateio das contestações de competências fechadas (Lançamentos / Contestações) entram no extrato em blocos à parte,
              “com os percentuais de” cada competência dos movimentos: o percentual é o daquela competência, e não o deste mês.
            </li>
            <li>
              Sem o Acesso a Informações Sensíveis no perfil (Controle de Usuários / Perfis), as linhas de Mão de Obra Direta e Indireta (Remunerações
              CLT e PJ, Horas Extras, Multas Rescisórias, Encargos e Benefícios e Pró Labore Diretoria) mostram os valores, mas não abrem o extrato.
            </li>
            <li>No menu de níveis (a seta antes do título da tabela), escolha Totais, Atribuições ou Contas para recolher ou expandir a DRE nos três níveis da planilha; as contas, sem negrito, só aparecem em Contas, menos as de Produção e Serviços (PS), os volumes, que aparecem em todos os níveis. A seta à esquerda de cada total ou atribuição abre e fecha só aquele grupo.</li>
            <li>
              Em Impostos, uma tabela por unidade (Matriz e Filial), com as contas de Matérias Primas, de Gastos Gerais Variáveis da Produção e o Frete e
              Descarga, o valor de cada uma na DRE apurada da unidade e o Creditado (R$) e o Estornado (R$) do mês, cada um com o % sobre o valor da conta.
              Os R$ vêm da aba Impostos (Lista) importada (Importações); sem ela, um traço. O Total e cada grupo somam os R$ das contas, com o % sobre a soma
              delas. Os menus de níveis e as setas dos grupos funcionam como na DRE. No recorte
              por departamento ou por centro de custo, a aba não aparece.
            </li>
            <li>Em Centros de Custo, escolha o centro na lista à esquerda; o ícone de informação ao lado do nome mostra o agrupamento e os centros de custo agrupados. A DRE do centro traz só os custos e as despesas de mão de obra, gastos gerais e depreciação.</li>
            <li>Em Obras, escolha a obra na lista à esquerda (o código do centro de custo da obra fica acima do nome; a busca aceita os dois): a DRE da obra traz todos os movimentos lançados no centro de custo dela — receita, impostos, custos, despesas e financeiros —, sem as margens e os resultados calculados. Nas receitas, como na DRE das unidades: as contas de Reconhecimento do CPV ficam de fora (no centro da obra, elas anulam o faturamento, porque a DRE reconhece a receita na produção); a receita prévia de frete da obra sai da Receita Bruta do Pré-Fabricado e vai à de Frete; a complementar sai da de Montagem e vai à Complementar. No extrato dessas linhas, o botão da receita prévia abre a memória de cálculo só com a obra.</li>
            <li>
              “Excluir Competência” apaga a competência com tudo o que é dela (importações, lançamentos, listas, apuração, divergências): só a mais
              recente e em aberto (não fechada) — nas outras, o botão fica apagado, com o motivo na dica. A confirmação mostra o que sai e pede a
              competência digitada (MM/AAAA); a exclusão fica no log de auditoria e não se desfaz.
            </li>
            <li>
              A Receita Operacional Líquida (ROL) aparece uma vez, depois da receita bruta e dos impostos (o total do topo, que a repetia, não aparece;
              nas visões que só têm ele, fica). Os totais ficam em amarelo, e as linhas de resultado (ROL, CPV, MB, MC, DFO, EBITDA, EBIT, NOPAT,
              RF, DF e RL), num amarelo mais forte.
            </li>
            <li>Use “Apurar Competência” (ou “Reapurar Competência”) depois de importar, classificar e lançar os ajustes do mês.</li>
            <li>
              O aviso amarelo “Entradas ou cadastros alterados depois da apuração” lista o que mudou — as entradas do mês e, com a competência ainda
              aberta, qualquer Cadastro da Controladoria (Unidades, Centros de Custo, Contas de Resultado, Linhas, Estrutura da DRE, Regras de
              Rateio, Indicadores e Painel de Bordo): reapure para usar; até lá, a competência não fecha. O aviso vermelho “Apuração
              bloqueada” aparece quando uma competência anterior tem entradas ou cadastros alterados: reapure as anteriores, em ordem, pelos botões
              “Ir para MM/AAAA”.
            </li>
            <li>Com o mês conferido, “Fechar Competência” congela os valores — os meses se fecham em ordem: com uma competência anterior em aberto, o botão fica desabilitado (passe o mouse para ver o motivo). Na confirmação, um aviso lista as telas do mês sem nenhum valor (Importações sem requisições nem notas fiscais, Lançamentos, Prévias › Receita, Totais › Indicadores, Prévias › Estoque, Conferência), para conferir antes de fechar; ele não impede o fechamento. “Reaberturas” mostra o histórico das reaberturas.</li>
            <li>
              “Exportar”, na linha do título, baixa a DRE da aba aberta em Excel ou PDF; em Excel, também um arquivo por centro de custo (num ZIP, com o
              departamento e o centro no nome de cada arquivo). Em Impostos, ele leva as duas tabelas, com a unidade de cada linha.
            </li>
          </ul>
        }
        sobre={
          <>
            <p>
              Os resultados do mês: a DRE consolidada, a de cada unidade e a de cada centro de custo, a partir da classificação, dos rateios, da
              receita prévia e dos lançamentos manuais, e a de cada obra, com os lançamentos do balancete nos centros de custo de obra (1.98 e 1.99),
              a receita prévia de frete e complementar da obra e, em Produção e Serviços (PS), os volumes da obra nas Listas Operacionais. O lançamento é
              da obra pelo centro de custo que vale para ele: o que uma contestação ou uma reclassificação por fornecedor levou a outro centro, e o
              redistribuído, não entram na obra.
            </p>
            <p>
              Ao lado do valor, o % e o R$/m³, como em Resultados Empresariais: o % da receita bruta, dos impostos e das receitas líquidas por natureza
              sobre a receita bruta (ROB); dos custos de produção, de montagem e complementares sobre a receita líquida do pré-fabricado, de montagem e
              complementar; do Frete e Descarga sobre a receita líquida de frete (em Serviços, a complementar); o resto sobre a receita líquida (ROL). O
              R$/m³ da receita do pré-fabricado e dos custos de produção sobre a produção (m³), da receita e dos custos de montagem sobre a montagem (m³) e
              do Frete e Descarga sobre a expedição (m³). Em Despesas e Extra, no RN, nos centros de custo e sem centro de custo, as bases são as do
              Consolidado; em cada obra, a receita (a ROB nas receitas e nos impostos, a ROL no resto) e os volumes da própria obra.
            </p>
            <p>
              Em Impostos, os créditos de impostos do mês em cada unidade (Matriz e Filial): o Creditado e o Estornado das contas de Matérias Primas, de
              Gastos Gerais Variáveis da Produção e do Frete e Descarga (da aba Impostos (Lista) do LISTAS REALIZADO (RESULTADOS), com cada conta pela
              atribuição e pelo nome, como na Estrutura da DRE; as linhas das demais contas ficam de fora), em R$ e em % sobre o valor da conta na unidade. O Realizado por Obra usa esses percentuais nos custos dessas contas: nas vendas mercantis, tira o Estornado (custo
              × (1 − % Estornado)); nas globais, tira o Estornado e reaplica o Creditado (custo × (1 − % Estornado) ÷ (1 − % Creditado)).
            </p>
            <p>
              <TextoApuracao anoMes={anoMes} />
            </p>
          </>
        }
        acoes={<AcoesApuracao anoMes={anoMes} onAvisos={setAvisos} exportar={visao === null ? null : exportar} />}
      />

      <SituacaoApuracao anoMes={anoMes} />
      {avisos.length > 0 ? (
        <div className="flex items-start gap-2 rounded-sm border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <ul>{avisos.map((a) => <li key={a}>{a}</li>)}</ul>
        </div>
      ) : null}

      {visao === null ? (
        <p className="rounded-sm border border-gray-200 bg-white p-6 text-sm text-gray-600">Seu perfil não tem acesso a nenhuma aba desta tela.</p>
      ) : (
      <>
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <Abas
            rotulo="Visão da DRE"
            ativa={String(visao)}
            onMudar={(c) => setVisao(VISOES.find((v) => String(v.visao) === c)!.visao)}
            abas={visoes.map((v) => ({ chave: String(v.visao), rotulo: v.nome }))}
          />
        </div>
      </div>

      {visao === "centros" ? (
        <VisaoCentros key={anoMes} anoMes={anoMes} escolhido={grupoEscolhido} onEscolher={setGrupo} />
      ) : visao === "sem_centros" ? (
        <VisaoSemCentros key={anoMes} anoMes={anoMes} escolhido={semCentroEscolhido} onEscolher={setSemCentro} />
      ) : visao === "obras" ? (
        <VisaoObras key={anoMes} anoMes={anoMes} escolhida={obraEscolhida} onEscolher={setObra} />
      ) : visao === "impostos" ? (
        <CreditosDoMes key={anoMes} anoMes={anoMes} />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} padrao="Erro ao carregar a DRE." />
      ) : consulta.isPending ? (
        <Carregando />
      ) : (consulta.data?.linhas ?? []).some((l) => l.valor !== null) ? (
        <TabelaDRE
          key={String(visao)}
          linhas={consulta.data!.linhas}
          anoMes={anoMes}
          visao={visao === "consolidado" ? { consolidado: true } : { unidade: visao as number }}
          titulo={`DRE · ${VISOES.find((v) => v.visao === visao)?.nome ?? ""}`}
        />
      ) : (
        <SemApuracao />
      )}
      </>
      )}
    </div>
  );
}
