"use client";

import { useQuery } from "@tanstack/react-query";

import { CabecalhoDaTela } from "@/components/shared/CabecalhoDaTela";
import { Carregando, ErroCarga, Vazio } from "@/components/shared/Estados";
import { ExportarTabela } from "@/components/shared/ExportarTabela";
import { QuadroTabela } from "@/components/shared/QuadroTabela";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";
import type { Coluna } from "@/lib/filtrosDeTabela";
import { RotulosDoGrafico, useTipoGrafico } from "@/app/relatorios/components/GraficoRealizadoOrcado";
import { blocoComparado, CardDoPainel, LegendaDoPainel, useCoresDoPainel, type FormatacaoDoCard } from "@/app/relatorios/painel/PainelContent";
import type { ItemPainel } from "@/app/relatorios/services/relatoriosService";

import { diferenca, INDICADORES_DO_QUADRO, SeletorDaComparacao, useComparacaoDoQuadro } from "../../components/ComparacaoDoQuadro";
import { quadroService, type IndicadoresDoMes } from "../../services/quadroService";

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
type MesDoPainel = IndicadoresDoMes & { mes: number };
type Indicador = (typeof INDICADORES_DO_QUADRO)[number];

/**
 * O card padrão de um indicador (12/11/2026, pedido do Adão; antes, um card próprio): o do Painel de Bordo de Resultados
 * Empresariais — o Atual (o mês da competência) e o Acumulado (os meses do ano com competência até ela), cada um com o desvio
 * contra o cenário da Comparação (vs. a marcação), e o gráfico dos meses e do acumulado (o realizado e o cenário). O
 * comportamento (↑, ↓ ou acompanhamento) é o do indicador no cadastro dos indicadores.
 */
function itemDoCard(ind: Indicador, meses: MesDoPainel[], mes: number, cenario: Array<number | null> | null, sentido: string): ItemPainel {
  const ate = meses.filter((m) => m.mes <= mes);
  const atual = meses.find((m) => m.mes === mes);
  const real = atual ? ind.valor(atual) : null;
  const acumulado = ind.acumulado(ate.map((m) => ind.valor(m)));
  const cenarioNoMes = cenario ? cenario[mes - 1] : null;
  const acumuladoCenario = cenario ? ind.acumulado(ate.map((m) => cenario[m.mes - 1])) : null;
  return {
    titulo: ind.nome,
    sigla: ind.chave,
    metodologia: ind.metodologia,
    sentido: sentido as ItemPainel["sentido"],
    formato: "PCT",
    formatoAcumulado: "PCT",
    base: null,
    separar: false,
    mes: blocoComparado(real, cenarioNoMes, sentido, !!cenario),
    acumulado: blocoComparado(acumulado, acumuladoCenario, sentido, !!cenario),
    serie: ate.map((m) => ({ mes: MESES[m.mes - 1].toUpperCase(), realizado: ind.valor(m), orcado: cenario ? cenario[m.mes - 1] : null })),
  };
}
const formatacaoDo = (ind: Indicador): FormatacaoDoCard => ({ unidade: ind.unidade, formatar: ind.formatar, formatarCurto: ind.formatarCurto, fatorDaEscala: ind.fatorDaEscala });

type LinhaDoIndicador = { chave: string; nome: string; unidade: string; meses: Record<number, string>; acumulado: string; explicacao: string; comparacao?: boolean };

/**
 * O Painel de Bordo da Gestão de Colaboradores (06/11/2026, etapa 2): na aba Resultados, os cards padrão dos indicadores
 * (12/11/2026); na aba Indicadores, a tabela de cada mês do ano. Os valores vêm das competências do Quadro de Lotação, sempre
 * no ano e no mês da competência mais recente (12/11/2026, pedido do Adão: a em edição ou a última lida; antes, as listas do
 * ano e do mês). Com a Comparação (09/11/2026), o cenário marcado escolhido: nos cards, o mês e o acumulado; na tabela, as
 * linhas do cenário e da diferença de cada indicador.
 */
export function PainelDoQuadro({ aba }: { aba: "resultados" | "indicadores" }) {
  useRegistrarAcessoTela(`/gestao-de-colaboradores/painel/${aba}`);
  const comparacao = useComparacaoDoQuadro();
  const painel = useQuery({ queryKey: ["quadro", "painel", "recente"], queryFn: () => quadroService.painel() });
  const meses = painel.data?.meses ?? [];
  const ano = painel.data?.ano ?? new Date().getFullYear();
  const mes = meses.at(-1)?.mes ?? null;
  const cenario = comparacao.comparado;
  const marcacao = comparacao.atual?.rotulo ?? "Cenário";
  const [tipo] = useTipoGrafico();
  const [cores] = useCoresDoPainel();
  const competencia = mes ? `${String(mes).padStart(2, "0")}/${ano}` : null;

  const linhas: LinhaDoIndicador[] = INDICADORES_DO_QUADRO.flatMap((ind) => {
    const real: LinhaDoIndicador = {
      chave: ind.chave,
      nome: ind.nome,
      unidade: ind.unidade,
      meses: Object.fromEntries(meses.map((m) => [m.mes, ind.formatar(ind.valor(m))])),
      acumulado: ind.formatar(ind.acumulado(meses.map((m) => ind.valor(m)))),
      explicacao: ind.explicacao,
    };
    const doCenario = cenario?.indicadores[ind.chave];
    if (!doCenario) return [real];
    // O cenário em todos os meses; o acumulado e a diferença, nos meses com competência (como o realizado).
    const acumuladoReal = ind.acumulado(meses.map((m) => ind.valor(m)));
    const acumuladoCenario = ind.acumulado(meses.map((m) => doCenario[m.mes - 1]));
    return [
      real,
      {
        chave: `${ind.chave}-cenario`,
        nome: `${ind.nome} · ${marcacao}`,
        unidade: ind.unidade,
        meses: Object.fromEntries(doCenario.map((v, k) => [k + 1, ind.formatar(v)])),
        acumulado: ind.formatar(acumuladoCenario),
        explicacao: `O cenário ${cenario.cenario.nome} (${cenario.cenario.ano}): o indicador de mesmo nome no cadastro dos indicadores, mês a mês; o acumulado, nos meses com competência do Quadro de Lotação.`,
        comparacao: true,
      },
      {
        chave: `${ind.chave}-diferenca`,
        nome: `${ind.nome} · Diferença`,
        unidade: ind.unidade,
        meses: Object.fromEntries(meses.map((m) => [m.mes, diferenca(ind, ind.valor(m), doCenario[m.mes - 1])])),
        acumulado: diferenca(ind, acumuladoReal, acumuladoCenario),
        explicacao: "Realizado − cenário, nos meses com competência do Quadro de Lotação.",
        comparacao: true,
      },
    ];
  });
  const colunas: Coluna<LinhaDoIndicador>[] = [
    { chave: "nome", rotulo: "Indicador", valor: (l) => l.nome },
    { chave: "unidade", rotulo: "Und", valor: (l) => l.unidade },
    ...MESES.map((rotulo, i) => ({ chave: `m${i + 1}`, rotulo, alinhamento: "direita" as const, valor: (l: LinhaDoIndicador) => l.meses[i + 1] ?? null })),
    { chave: "acumulado", rotulo: "Acumulado", alinhamento: "direita", valor: (l) => l.acumulado },
  ];

  return (
    // O rótulo do comparado (vs. a marcação) nos cards e na legenda (12/11/2026).
    <RotulosDoGrafico.Provider value={{ realizado: "Realizado", orcado: marcacao }}>
    <div className="space-y-4">
      <CabecalhoDaTela
        titulo="Painel de Bordo"
        sobre={
          <p>
            Os indicadores do Quadro de Lotação, mês a mês, a partir das competências do Quadro de Lotação: Quadro de Lotação (o quadro do fim do mês: o
            anterior, ou o Lançamento Inicial no mês dele, + as movimentações aprovadas de contagem Positiva − as de Negativa), Turnover ((Positivas +
            Negativas) ÷ 2 ÷ Quadro de Lotação) e Abertura de Vagas x Contratações (as contratações: as Positivas aprovadas). Com a Comparação, os do
            cenário marcado escolhido: os indicadores de mesmo nome no cadastro dos indicadores (Quadro de Lotação Total, Turnover e Abertura de Vagas x
            Contratações), mês a mês.
          </p>
        }
        comoUsar={
          <ul>
            <li>O painel mostra sempre a competência mais recente do Quadro de Lotação (a em edição ou a última fechada), ao lado do título; o ano é o dela.</li>
            <li>
              A aba Resultados mostra um card padrão por indicador, como no Painel de Bordo de Resultados Empresariais: o nome e, à direita, a conta e o
              comportamento (o do cadastro dos indicadores); o Atual (o mês da competência) e o Acumulado (os meses do ano com competência até ela), com a
              unidade no rótulo; o gráfico dos meses e do acumulado, à direita.
            </li>
            <li>A aba Indicadores mostra a tabela dos meses do ano, com o acumulado: o Quadro de Lotação do último mês, e a soma dos meses nos demais.</li>
            <li>
              “Comparação” escolhe o cenário marcado (Forecast, Orçamento, Anterior ou Vendido) ou Sem Comparação; a escolha fica guardada neste navegador e
              vale também no Quadro de Lotação. Nos cards, o desvio do Atual e do Acumulado contra o cenário (vs. a marcação, com o valor dele) e, no
              gráfico, o cenário ao lado do realizado; na tabela, abaixo de cada indicador, a linha do cenário (todos os meses) e a da diferença. O
              acumulado do cenário usa os mesmos meses do realizado (os do ano com competência do Quadro de Lotação).
            </li>
          </ul>
        }
        selo={competencia ? <span className="text-sm font-medium text-gray-900">{competencia}</span> : undefined}
        acoes={
          <div className="flex flex-wrap items-center justify-end gap-4">
            {aba === "resultados" && cenario ? <LegendaDoPainel tipo={tipo} cores={cores} comparado={cenario.cenario.nome} /> : null}
            <SeletorDaComparacao comparacao={comparacao} />
          </div>
        }
        exportar={aba === "indicadores" ? <ExportarTabela titulo={`Gestão de Colaboradores · Indicadores · ${ano}`} colunas={colunas} linhas={linhas} /> : undefined}
      />
      {painel.isPending ? (
        <Carregando linhas={4} />
      ) : painel.isError ? (
        <ErroCarga mensagem="Erro ao carregar os indicadores." />
      ) : meses.length === 0 || mes === null ? (
        <Vazio titulo="Nenhuma competência do Quadro de Lotação" dica="Abra as competências na tela Quadro de Lotação." />
      ) : aba === "resultados" ? (
        // Os cards padrão (12/11/2026), um embaixo do outro.
          <div className="space-y-3">
            {INDICADORES_DO_QUADRO.map((ind) => (
              <CardDoPainel
                key={ind.chave}
                i={itemDoCard(ind, meses, mes, cenario?.indicadores[ind.chave] ?? null, painel.data?.sentidos[ind.chave] ?? "=")}
                rotuloMes={`${MESES[mes - 1].toUpperCase()}/${ano}`}
                tipo={tipo}
                cores={cores}
                comGrafico
                formatacao={{ mes: formatacaoDo(ind), acumulado: formatacaoDo(ind) }}
              />
            ))}
          </div>
      ) : (
        <QuadroTabela>
          <table className="tabela-sig w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs font-bold text-gray-900">
                {colunas.map((c) => (
                  <th key={c.chave} className={`px-3 py-2 ${c.alinhamento === "direita" ? "text-right" : ""}`}>
                    {c.rotulo}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.chave} className={`border-b border-gray-100 ${l.comparacao ? "bg-gray-50 text-gray-700" : ""}`} title={l.explicacao}>
                  <td className={`px-3 py-2 whitespace-nowrap ${l.comparacao ? "pl-6" : "font-medium text-gray-900"}`}>{l.nome}</td>
                  <td className="px-3 py-2 text-gray-600">{l.unidade}</td>
                  {MESES.map((_, m) => (
                    <td key={m} className="px-3 py-2 text-right whitespace-nowrap">
                      {l.meses[m + 1] ?? <span className="text-gray-400">—</span>}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-bold whitespace-nowrap">{l.acumulado}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </QuadroTabela>
      )}
    </div>
    </RotulosDoGrafico.Provider>
  );
}
