"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { CabecalhoDaTela } from "@/components/shared/CabecalhoDaTela";
import { Carregando, ErroCarga, Vazio } from "@/components/shared/Estados";
import { ExportarTabela } from "@/components/shared/ExportarTabela";
import { QuadroTabela } from "@/components/shared/QuadroTabela";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";
import type { Coluna } from "@/lib/filtrosDeTabela";

import { diferenca, INDICADORES_DO_QUADRO, SeletorDaComparacao, useComparacaoDoQuadro } from "../../components/ComparacaoDoQuadro";
import { quadroService, type IndicadoresDoMes } from "../../services/quadroService";

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const classeSelect = "h-9 rounded-sm border border-gray-300 bg-white px-3 text-sm";
type MesDoPainel = IndicadoresDoMes & { mes: number };
type Indicador = (typeof INDICADORES_DO_QUADRO)[number];

/**
 * O cartão de um indicador (aba Resultados): o valor do mês, o do mês anterior, o do ano e as barras dos meses; com a
 * Comparação (09/11/2026), o cenário e a diferença no mês e no acumulado.
 */
function Cartao({ ind, meses, mes, cenario, marcacao }: { ind: Indicador; meses: MesDoPainel[]; mes: number; cenario: Array<number | null> | null; marcacao: string }) {
  const atual = meses.find((m) => m.mes === mes);
  const anterior = meses.filter((m) => m.mes < mes).at(-1);
  const ate = meses.filter((m) => m.mes <= mes);
  const valores = meses.map((m) => ind.valor(m) ?? 0);
  const maior = Math.max(1e-9, ...valores.map(Math.abs));
  const real = atual ? ind.valor(atual) : null;
  const acumulado = ind.acumulado(ate.map((m) => ind.valor(m)));
  // O acumulado do cenário nos mesmos meses (os do ano com competência até o escolhido).
  const cenarioNoMes = cenario ? cenario[mes - 1] : null;
  const acumuladoCenario = cenario ? ind.acumulado(ate.map((m) => cenario[m.mes - 1])) : null;
  return (
    <article className="rounded-sm border border-gray-200 bg-white p-4" title={ind.explicacao}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-gray-900">{ind.nome}</h3>
        <span className="text-xs text-gray-500">{ind.unidade}</span>
      </div>
      <p className="mt-2 text-3xl font-bold text-gray-900">{ind.formatar(real)}</p>
      <p className="text-xs text-gray-600">
        {MESES[mes - 1]} · mês anterior: {ind.formatar(anterior ? ind.valor(anterior) : null)} · no ano: {ind.formatar(acumulado)}
      </p>
      {cenario ? (
        <dl className="mt-2 grid grid-cols-[auto_1fr_1fr] gap-x-3 border-t border-gray-100 pt-2 text-xs text-gray-700">
          <dt />
          <dd className="text-right font-medium text-gray-500">Mês</dd>
          <dd className="text-right font-medium text-gray-500">Acumulado</dd>
          <dt>{marcacao}</dt>
          <dd className="text-right">{ind.formatar(cenarioNoMes)}</dd>
          <dd className="text-right">{ind.formatar(acumuladoCenario)}</dd>
          <dt>Diferença</dt>
          <dd className="text-right font-medium text-gray-900">{diferenca(ind, real, cenarioNoMes)}</dd>
          <dd className="text-right font-medium text-gray-900">{diferenca(ind, acumulado, acumuladoCenario)}</dd>
        </dl>
      ) : null}
      <div className="mt-3 flex h-16 items-end gap-1" aria-hidden>
        {meses.map((m) => (
          <div key={m.mes} className="flex flex-1 flex-col items-center gap-0.5">
            <div
              className={`w-full rounded-t-sm ${m.mes === mes ? "bg-bpm-primary" : "bg-gray-300"}`}
              style={{ height: `${Math.max(2, (Math.abs(ind.valor(m) ?? 0) / maior) * 48)}px` }}
              title={`${MESES[m.mes - 1]}: ${ind.formatar(ind.valor(m))}`}
            />
            <span className="text-[10px] text-gray-500">{MESES[m.mes - 1]}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

type LinhaDoIndicador = { chave: string; nome: string; unidade: string; meses: Record<number, string>; acumulado: string; explicacao: string; comparacao?: boolean };

/**
 * O Painel de Bordo da Gestão de Colaboradores (06/11/2026, etapa 2): na aba Resultados, os cards dos indicadores do mês
 * escolhido; na aba Indicadores, a tabela de cada mês do ano. Os valores vêm das competências do Quadro de Lotação. Com a
 * Comparação (09/11/2026), o cenário marcado escolhido: nos cards, o mês e o acumulado; na tabela, as linhas do cenário e
 * da diferença de cada indicador.
 */
export function PainelDoQuadro({ aba }: { aba: "resultados" | "indicadores" }) {
  useRegistrarAcessoTela(`/gestao-de-colaboradores/painel/${aba}`);
  const [ano, setAno] = useState(new Date().getFullYear());
  const [mesEscolhido, setMesEscolhido] = useState<number | null>(null);
  const comparacao = useComparacaoDoQuadro();
  const painel = useQuery({ queryKey: ["quadro", "painel", ano], queryFn: () => quadroService.painel(ano) });
  const meses = painel.data?.meses ?? [];
  const anos = [...new Set([...(painel.data?.anos ?? []), ano])].sort((a, b) => b - a);
  const mes = mesEscolhido && meses.some((m) => m.mes === mesEscolhido) ? mesEscolhido : (meses.at(-1)?.mes ?? null);
  const cenario = comparacao.comparado;
  const marcacao = comparacao.atual?.rotulo ?? "Cenário";

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
            <li>Escolha o ano (e, na aba Resultados, o mês) à direita do título.</li>
            <li>A aba Resultados mostra um card por indicador: o valor do mês, o do mês anterior, o do ano e as barras dos meses; passe o mouse para ver a conta.</li>
            <li>A aba Indicadores mostra a tabela dos meses do ano, com o acumulado: o Quadro de Lotação do último mês, e a soma dos meses nos demais.</li>
            <li>
              “Comparação” escolhe o cenário marcado (Previsão, Orçamento, Anterior ou Vendido) ou Sem Comparação; a escolha fica guardada neste navegador e
              vale também no Quadro de Lotação. Nos cards, o cenário e a diferença (realizado − cenário) do mês e do acumulado; na tabela, abaixo de cada
              indicador, a linha do cenário (todos os meses) e a da diferença. O acumulado do cenário usa os mesmos meses do realizado (os do ano com
              competência do Quadro de Lotação).
            </li>
          </ul>
        }
        acoes={
          <div className="flex flex-wrap items-center gap-2">
            <SeletorDaComparacao comparacao={comparacao} />
            <select aria-label="Ano" value={ano} onChange={(e) => (setAno(Number(e.target.value)), setMesEscolhido(null))} className={classeSelect}>
              {anos.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            {aba === "resultados" && meses.length ? (
              <select aria-label="Mês" value={mes ?? ""} onChange={(e) => setMesEscolhido(Number(e.target.value))} className={classeSelect}>
                {meses.map((m) => (
                  <option key={m.mes} value={m.mes}>
                    {MESES[m.mes - 1]}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        }
        exportar={aba === "indicadores" ? <ExportarTabela titulo={`Gestão de Colaboradores · Indicadores · ${ano}`} colunas={colunas} linhas={linhas} /> : undefined}
      />
      {painel.isPending ? (
        <Carregando linhas={4} />
      ) : painel.isError ? (
        <ErroCarga mensagem="Erro ao carregar os indicadores." />
      ) : meses.length === 0 || mes === null ? (
        <Vazio titulo={`Nenhuma competência do Quadro de Lotação em ${ano}`} dica="Abra as competências na tela Quadro de Lotação." />
      ) : aba === "resultados" ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {INDICADORES_DO_QUADRO.map((ind) => (
            <Cartao key={ind.chave} ind={ind} meses={meses} mes={mes} cenario={cenario?.indicadores[ind.chave] ?? null} marcacao={marcacao} />
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
  );
}
