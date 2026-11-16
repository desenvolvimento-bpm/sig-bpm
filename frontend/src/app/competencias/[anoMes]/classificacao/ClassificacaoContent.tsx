"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { useAbaLembrada } from "@/hooks/useAbaLembrada";
import { ExportarTabela } from "@/components/shared/ExportarTabela";
import { BaldeBadge } from "@/components/shared/BaldeBadge";
import { DataTable } from "@/components/shared/DataTable";
import { useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { Button } from "@/components/ui/button";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";
import { atualizarCompetencia } from "@/lib/atualizarCompetencia";
import type { Coluna } from "@/lib/filtrosDeTabela";

import { CabecalhoDaTela } from "@/components/shared/CabecalhoDaTela";
import { Abas } from "@/components/shared/Abas";
import { FaixaIndicadores } from "@/components/shared/FaixaIndicadores";
import { Paginacao } from "@/components/shared/Paginacao";
import { QuadroTabela } from "@/components/shared/QuadroTabela";
import { AvisoCongelado } from "../../components/AvisoCongelado";
import { apuracaoService } from "../../services/apuracaoService";
import { dataHora, inteiro, lerAnoMes, moeda } from "../utils/formatacao";
import { VALIDACOES, ValidacaoBadge } from "./components/ValidacaoBadge";
import { plural } from "@/lib/texto";
import {
  classificacaoService,
  type LancamentoClassificado,
  type Situacao,
  type Validacao,
} from "./services/classificacaoService";

const POR_PAGINA_INICIAL = 50;
/** O mês inteiro da aba vem de uma vez: o filtro e a ordem das colunas valem para todos os lançamentos. */
const TODOS = 5000;

const textoValidacao = (v: Validacao) => (VALIDACOES[v].codigo ? `${VALIDACOES[v].codigo} ${VALIDACOES[v].rotulo}` : VALIDACOES[v].rotulo);

const adotada = (l: LancamentoClassificado) => l.contaAdotada ?? l.contaResultado;

/**
 * Centro de custo, conta e classificação na DRE dividem a largura; as demais
 * colunas ficam na largura do conteúdo, com os rótulos numa linha só.
 */
const COLUNAS: Coluna<LancamentoClassificado>[] = [
  { chave: "filial", rotulo: "Filial", tipo: "numero", classe: "w-px", valor: (l) => l.filial, texto: (l) => String(l.filial) },
  {
    chave: "centro",
    rotulo: "Centro de custo",
    classe: "w-[26%]",
    valor: (l) => l.codigoCentroCusto,
    texto: (l) => (l.codigoCentroCusto ? [l.codigoCentroCusto, l.nomeCentroCusto].filter(Boolean).join(" · ") : "Sem Centro de Custo"),
  },
  {
    chave: "conta",
    rotulo: "Conta",
    classe: "w-[26%]",
    valor: (l) => adotada(l).reduzido,
    texto: (l) => `${adotada(l).reduzido} · ${adotada(l).descricao}`,
  },
  {
    chave: "linhaDRE",
    rotulo: "Classificação na DRE",
    classe: "w-[32%]",
    valor: (l) => l.linhaDRE?.descricao,
    texto: (l) =>
      l.linhaDRE ? [adotada(l).departamento, adotada(l).atribuicao, l.linhaDRE.descricao].filter(Boolean).join(" · ") : adotada(l).semResultado ? "Sem Resultado" : "sem destino",
  },
  { chave: "validacao", rotulo: "Verificação", classe: "w-px", valor: (l) => textoValidacao(l.validacao) },
  { chave: "balde", rotulo: "Rateio", classe: "w-px", valor: (l) => l.balde },
  { chave: "valor", rotulo: "Valor", tipo: "numero", alinhamento: "direita", classe: "w-px", valor: (l) => Number(l.valorMovimento), texto: (l) => moeda(l.valorMovimento) },
];

/**
 * Uma linha de texto cortada no fim da coluna (o texto inteiro fica no title).
 * Não alarga a coluna: ocupa a largura que ela tiver.
 */
function Cortada({ texto, className, altura = "h-4" }: { texto: string | null | undefined; className: string; altura?: string }) {
  if (!texto) return null;
  return (
    <div className={`relative ${altura}`} title={texto}>
      <div className={`absolute inset-x-0 truncate ${className}`}>{texto}</div>
    </div>
  );
}

function CelulaCentro({ l }: { l: LancamentoClassificado }) {
  if (!l.codigoCentroCusto) {
    return <span className="text-xs text-gray-400">Sem Centro de Custo</span>;
  }
  const obra = /^1\.9[89](\.|$)/.test(l.codigoCentroCusto);
  const c = l.centroCusto;
  return (
    <div>
      <div className="font-medium text-gray-900">{l.codigoCentroCusto}</div>
      <Cortada texto={l.nomeCentroCusto} className="text-xs text-gray-600" />
      {/* Departamento e atribuição do centro: o que a verificação compara com os da conta. */}
      {c ? (
        c.departamento || c.atribuicao ? (
          <Cortada texto={[c.departamento ?? "-", c.atribuicao ?? "-"].join(" · ")} className="text-xs text-gray-500" />
        ) : (
          <span className="text-xs text-gray-400">sem parâmetro</span>
        )
      ) : (
        <span className="text-xs text-gray-400">{obra ? "obra" : "sem cadastro"}</span>
      )}
    </div>
  );
}

/** Como o centro de custo: o número e, embaixo, a descrição em cinza. A reclassificada mostra a original riscada. */
function CelulaConta({ l }: { l: LancamentoClassificado }) {
  const conta = adotada(l);
  return (
    <div>
      {l.reclassificado ? (
        <Cortada texto={`${l.contaResultado.reduzido} ${l.contaResultado.descricao}`} className="text-xs text-gray-400 line-through" />
      ) : null}
      <div className="flex items-center gap-1 font-medium text-gray-900">
        {l.reclassificado ? <ArrowRight className="size-3.5 shrink-0 text-yellow-700" aria-label="reclassificada" /> : null}
        {conta.reduzido}
      </div>
      <Cortada texto={conta.descricao} className="text-xs text-gray-600" />
    </div>
  );
}

/** Para onde a conta leva o lançamento: departamento, atribuição e conta da DRE, uma em cada linha. */
function CelulaClassificacao({ l }: { l: LancamentoClassificado }) {
  // A conta Sem Resultado (13/11/2026) fica fora da DRE sem ser pendência.
  if (!l.linhaDRE && adotada(l).semResultado) return <span className="text-gray-500">Sem Resultado</span>;
  if (!l.linhaDRE) return <span className="text-red-700">sem destino</span>;
  const conta = adotada(l);
  return (
    <div>
      <Cortada texto={conta.departamento ?? "-"} className="text-gray-900" altura="h-5" />
      {/* Um tom acima: em minúsculas, o mesmo cinza parece mais claro que os nomes em maiúsculas. */}
      <Cortada texto={conta.atribuicao ?? "-"} className="text-xs text-gray-700" />
      <Cortada texto={l.linhaDRE.descricao} className="text-xs text-gray-600" />
    </div>
  );
}

export function ClassificacaoContent() {
  const { anoMes } = useParams<{ anoMes: string }>();
  useRegistrarAcessoTela(`/competencias/${anoMes}/classificacao`);
  const periodo = lerAnoMes(anoMes);
  const queryClient = useQueryClient();

  const [situacao, setSituacao] = useAbaLembrada<Situacao>("situacao", "PENDENCIAS", ["TODOS", "PENDENCIAS"]);

  const apuracao = useQuery({ queryKey: ["apuracao", anoMes], queryFn: () => apuracaoService.situacao(anoMes) });
  const resumo = useQuery({
    queryKey: ["classificacao", anoMes, "resumo"],
    queryFn: () => classificacaoService.resumo(anoMes),
    enabled: periodo !== null,
  });

  const lista = useQuery({
    queryKey: ["classificacao", anoMes, "lancamentos", situacao, TODOS],
    queryFn: () =>
      classificacaoService.lancamentos(anoMes, {
        situacao,
        pagina: 1,
        porPagina: TODOS,
      }),
    enabled: periodo !== null,
    placeholderData: keepPreviousData,
  });
  const tabela = useTabelaFiltravel(lista.data?.itens, COLUNAS, { porPaginaInicial: POR_PAGINA_INICIAL });

  const reclassificar = useMutation({
    mutationFn: () => classificacaoService.reclassificar(anoMes),
    onSuccess: (r) => {
      toast.success(
        `${inteiro(r.lancamentos)} lançamentos classificados em ${(r.duracaoMs / 1000).toFixed(1)} s.`,
      );
      atualizarCompetencia(queryClient, anoMes);
    },
    onError: (e) => {
      toast.error(
        (e as { response?: { data?: { error?: string } } }).response?.data?.error ??
          "Não foi possível reclassificar.",
      );
    },
  });

  if (!periodo) {
    return (
      <div className="rounded-sm border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-700">Competência inválida na URL: {anoMes}.</p>
      </div>
    );
  }

  const r = resumo.data;
  const fechada = r?.competencia.status === "FECHADA";
  // Apurada, a classificação faz parte do retrato congelado: só a reapuração a refaz.
  const apurada = apuracao.data?.apurada ?? false;

  function filtrar(s: Situacao) {
    setSituacao(s);
    tabela.setPagina(1);
  }

  return (
    <div className="space-y-6">
      <CabecalhoDaTela
        titulo="Classificação"
        exportar={<ExportarTabela titulo={`Classificação · ${situacao === "TODOS" ? "Todos" : "Pendências"} · ${anoMes.slice(5)}/${anoMes.slice(0, 4)}`} colunas={COLUNAS} linhas={tabela.filtradas} />}
        selo={fechada || apurada ? <AvisoCongelado anoMes={anoMes} fechada={fechada} oQue="da classificação" /> : null}
        comoUsar={
          <ul>
            <li>
              A aba Todos, a primeira, mostra todos os lançamentos. Comece pela aba Pendências (a que abre), com todas as pendências; para ver um
              tipo só (&lt;ERRO!&gt;, &lt;DEP.!&gt;, &lt;ATR.!&gt;, Sem Destino na DRE, Centro de Custo Sem Cadastro ou Sem Aba de Resultado), filtre pela coluna Verificação.
            </li>
            <li>
              “Sem Aba de Resultado” é o lançamento que nenhuma aba de resultado soma — a linha da DRE da conta não combina com o balde do
              centro (por exemplo, uma conta de custo de produção num centro de balde DESPESAS) — e ficaria fora do resultado. Nos Serviços
              Complementares, as contas de Montagem dos centros de balde COMPLEMENTAR entram na linha equivalente dos Complementares; sem ela, a pendência
              aparece.
            </li>
            <li>Use os filtros nos rótulos das colunas (centro de custo, conta, classificação…) para achar os lançamentos.</li>
            <li>Corrija a causa no cadastro (Centros de Custo, Contas de Resultado ou Reclassificações) e clique em “Reclassificar”.</li>
            <li>Sem pendências, siga para a tela Resultados e apure a competência.</li>
          </ul>
        }
        sobre={
          <p>
            Destino de cada lançamento do balancete na DRE e a verificação da coluna LANÇ. OK?. A correção é sempre no cadastro — depois
            dela, reclassifique.
          </p>
        }
        acoes={
          !fechada && !apurada ? (
            <PermissionGuard permission="classificacao:editar">
              <Button
                type="button"
                onClick={() => reclassificar.mutate()}
                disabled={reclassificar.isPending || !r || r.total === 0}
                className="bg-bpm-primary hover:bg-bpm-primary-hover rounded-sm font-bold text-black shadow-sm"
              >
                <RefreshCw className={`size-4 ${reclassificar.isPending ? "animate-spin" : ""}`} />
                {reclassificar.isPending ? "Reclassificando…" : "Reclassificar"}
              </Button>
            </PermissionGuard>
          ) : null
        }
      />

      {r && r.total > 0 ? (
        <FaixaIndicadores
          itens={[
            { rotulo: "lançamentos", valor: inteiro(r.total) },
            { rotulo: r.pendentes === 1 ? "pendência" : "pendências", valor: inteiro(r.pendentes), tom: r.pendentes > 0 ? "atencao" : undefined },
            { rotulo: "reclassificados", valor: inteiro(r.reclassificados), dica: "Pelo cadastro de reclassificação" },
            { rotulo: "classificado em", rotuloAntes: true, valor: <span className="text-sm font-bold">{r.classificadoEm ? dataHora(r.classificadoEm) : "nunca"}</span> },
          ]}
        />
      ) : null}

      {r && r.naoClassificados > 0 ? (
        <div className="flex items-center gap-2 rounded-sm border border-yellow-200 bg-yellow-50 p-4">
          <AlertTriangle className="size-4 shrink-0 text-yellow-800" />
          <p className="text-sm text-yellow-800">
            {inteiro(r.naoClassificados)} {plural(r.naoClassificados, "lançamento", "lançamentos")} ainda sem classificação. Use
            Reclassificar para {plural(r.naoClassificados, "calculá-lo", "calculá-los")}.
          </p>
        </div>
      ) : null}

      {r && r.total === 0 ? (
        <div className="border border-gray-200 bg-white rounded-sm py-12 text-center">
          <p className="text-sm font-medium text-gray-900">Nenhum lançamento nesta competência</p>
          <p className="mt-1 text-sm text-gray-600">
            Importe o balancete em{" "}
            <Link href={`/competencias/${anoMes}/importar`} className="underline">
              Importações
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <Abas
            rotulo="Situação dos lançamentos"
            ativa={situacao}
            onMudar={(c) => filtrar(c as Situacao)}
            abas={[
              // Todos antes das Pendências (12/10/2026); a tela continua abrindo nas Pendências. Desde 20/10/2026, só as duas:
              // os tipos de pendência se separam pelo filtro da coluna Verificação.
              { chave: "TODOS", rotulo: "Todos" },
              {
                chave: "PENDENCIAS",
                rotulo: "Pendências",
                sinal: (r?.pendentes ?? 0) > 0 ? <span className="size-2 rounded-full bg-red-600" aria-hidden /> : undefined,
              },
            ]}
          />
          <QuadroTabela
            rodape={
              lista.data && tabela.total > 0 ? (
                <Paginacao total={tabela.total} pagina={tabela.pagina} porPagina={tabela.porPagina} onPagina={tabela.setPagina} onPorPagina={tabela.setPorPagina} carregando={lista.isFetching} />
              ) : null
            }
          >
          <DataTable<LancamentoClassificado>
            data={tabela.visiveis}
            cabecalho={tabela.cabecalho}
            filtrosAtivos={tabela.ativos}
            onLimparFiltros={tabela.limpar}
            isLoading={lista.isPending}
            error={lista.isError ? "Erro ao carregar os lançamentos." : null}
            emptyMessage={
              situacao === "PENDENCIAS" ? "Nenhuma pendência de classificação" : "Nenhum lançamento encontrado"
            }
            emptyHint={
              situacao === "PENDENCIAS"
                ? "Todos os lançamentos têm destino e passaram na verificação."
                : "Ajuste a busca ou o filtro."
            }
            columns={["Filial", "Centro de custo", "Conta", "Classificação na DRE", "Verificação", "Rateio", "Valor"]}
            renderRow={(l) => (
              <tr key={l.id} className="border-b border-gray-100 align-top hover:bg-gray-50">
                <td className="px-4 py-3 text-sm text-gray-900">{l.filial}</td>
                <td className="px-4 py-3 text-sm">
                  <CelulaCentro l={l} />
                </td>
                <td className="px-4 py-3 text-sm">
                  <CelulaConta l={l} />
                </td>
                <td className="px-4 py-3 text-sm">
                  <CelulaClassificacao l={l} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <ValidacaoBadge validacao={l.validacao} />
                </td>
                <td className="px-4 py-3 text-sm whitespace-nowrap">
                  <BaldeBadge balde={l.balde} />
                </td>
                <td className="px-4 py-3 text-right text-sm whitespace-nowrap text-gray-900">
                  {moeda(l.valorMovimento)}
                </td>
              </tr>
            )}
          />
          </QuadroTabela>
        </div>
      )}
    </div>
  );
}
