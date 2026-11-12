"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { DataTable } from "@/components/shared/DataTable";
import { ExportarTabela } from "@/components/shared/ExportarTabela";
import { QuadroTabela } from "@/components/shared/QuadroTabela";
import { useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";
import type { Coluna } from "@/lib/filtrosDeTabela";

import { diferenca, INDICADORES_DO_QUADRO, SeletorDaComparacao, useComparacaoDoQuadro } from "../../components/ComparacaoDoQuadro";
import { quadroService, type LinhaDoRealizado } from "../../services/quadroService";
import { CabecalhoDoQuadro, rotuloDoMes } from "./CabecalhoDoQuadro";

const numero = (chave: keyof LinhaDoRealizado, rotulo: string): Coluna<LinhaDoRealizado> => ({
  chave,
  rotulo,
  tipo: "numero",
  alinhamento: "direita",
  valor: (l) => l[chave] as number,
});
const COLUNAS: Coluna<LinhaDoRealizado>[] = [
  { chave: "centro", rotulo: "Centro de Custo", valor: (l) => l.centroCusto },
  { chave: "departamento", rotulo: "Departamento", valor: (l) => l.departamento },
  { chave: "atribuicao", rotulo: "Atribuição", valor: (l) => l.atribuicao },
  numero("inicial", "Início do Mês"),
  numero("entradas", "Entradas"),
  numero("saidas", "Saídas"),
  numero("final", "Fim do Mês"),
  numero("clt", "CLT"),
  numero("pj", "PJ"),
];
/** As colunas da Comparação (09/11/2026): os colaboradores do centro na aba Quadro de Lotação do cenário e a diferença. */
const DA_COMPARACAO: Coluna<LinhaDoRealizado>[] = [
  { chave: "cenario", rotulo: "Cenário", tipo: "numero", alinhamento: "direita", valor: (l) => l.cenario ?? 0 },
  { chave: "diferenca", rotulo: "Diferença", tipo: "numero", alinhamento: "direita", valor: (l) => l.final - (l.cenario ?? 0) },
];
const sinal = (v: number) => (v > 0 ? `+${v.toLocaleString("pt-BR")}` : v < 0 ? `−${Math.abs(v).toLocaleString("pt-BR")}` : "0");

function Destaque({
  rotulo,
  valor,
  dica,
  comparacao,
}: {
  rotulo: string;
  valor: string;
  dica: string;
  comparacao?: { marcacao: string; mes: string; diferenca: string; acumulado: string; acumuladoCenario: string; diferencaAcumulada: string };
}) {
  return (
    <div className="rounded-sm border border-gray-200 bg-white px-4 py-3" title={dica}>
      <p className="text-xs font-medium text-gray-600">{rotulo}</p>
      <p className="text-2xl font-bold text-gray-900">{valor}</p>
      {comparacao ? (
        <dl className="mt-1 grid grid-cols-[auto_1fr_1fr] gap-x-3 text-xs text-gray-700">
          <dt />
          <dd className="text-right font-medium text-gray-500">Mês</dd>
          <dd className="text-right font-medium text-gray-500">Acumulado</dd>
          <dt>Realizado</dt>
          <dd className="text-right">{valor}</dd>
          <dd className="text-right">{comparacao.acumulado}</dd>
          <dt>{comparacao.marcacao}</dt>
          <dd className="text-right">{comparacao.mes}</dd>
          <dd className="text-right">{comparacao.acumuladoCenario}</dd>
          <dt>Diferença</dt>
          <dd className="text-right font-medium text-gray-900">{comparacao.diferenca}</dd>
          <dd className="text-right font-medium text-gray-900">{comparacao.diferencaAcumulada}</dd>
        </dl>
      ) : null}
    </div>
  );
}

/**
 * A aba Realizado de uma competência do Quadro de Lotação (06/11/2026): o quadro do mês por centro de custo — o do início,
 * as entradas e as saídas aprovadas, o do fim (CLT e PJ) —, com os indicadores do mês acima. Com a Comparação (09/11/2026),
 * o cenário escolhido: nos indicadores, o mês e o acumulado no ano; por centro, os colaboradores da aba Quadro de Lotação do
 * cenário (nos analíticos que a têm) e a diferença.
 */
export function RealizadoContent() {
  const { anoMes } = useParams<{ anoMes: string }>();
  useRegistrarAcessoTela(`/gestao-de-colaboradores/quadro-de-lotacao/${anoMes}/realizado`);
  const comparacao = useComparacaoDoQuadro();
  const r = useQuery({
    queryKey: ["quadro", "realizado", anoMes, comparacao.marcacao],
    queryFn: () => quadroService.realizado(anoMes, comparacao.marcacao),
    enabled: comparacao.pronta,
  });
  const porCentro = !!r.data?.comparacao?.porCentro;
  const colunas = porCentro ? [...COLUNAS, ...DA_COMPARACAO] : COLUNAS;
  const linhas = r.data?.linhas;
  const tabela = useTabelaFiltravel(linhas, colunas, { porPaginaInicial: 50 });
  const soma = (k: "inicial" | "entradas" | "saidas" | "final" | "clt" | "pj") => tabela.filtradas.reduce((a, l) => a + l[k], 0);
  const somaCenario = tabela.filtradas.reduce((a, l) => a + (l.cenario ?? 0), 0);
  const ind = r.data?.indicadores;
  const doAno = r.data?.doAno ?? [];
  const mes = Number(anoMes.slice(5, 7));
  const cenario = comparacao.comparado;
  const rotuloDaComparacao = comparacao.atual?.rotulo ?? "Cenário";

  return (
    <div className="space-y-4">
      <CabecalhoDoQuadro
        anoMes={anoMes}
        aba="realizado"
        status={r.data?.competencia.status}
        sobre={
          <p>
            O Quadro de Lotação Realizado do mês, por centro de custo: os colaboradores do início do mês (o Lançamento Inicial, no mês dele, ou o fim da
            competência anterior), as entradas (as movimentações aprovadas de contagem Positiva), as saídas (as de Negativa) e os do fim do mês, CLT e PJ.
            Acima, os indicadores do mês, como no Painel de Bordo. Com a Comparação, o cenário marcado escolhido: nos indicadores, o mês e o acumulado no
            ano (os do cadastro dos indicadores no cenário: Quadro de Lotação Total, Turnover e Abertura de Vagas x Contratações); por centro, os
            colaboradores do mês na aba Quadro de Lotação do cenário (nos cenários analíticos que a têm) e a diferença.
          </p>
        }
        comoUsar={
          <ul>
            <li>Use os filtros nos rótulos das colunas; a linha Total soma as linhas filtradas.</li>
            <li>Turnover = (Entradas + Saídas) ÷ 2 ÷ Quadro de Lotação do fim do mês; Contratações = as entradas aprovadas.</li>
            <li>
              “Comparação”, ao lado do título, escolhe o cenário marcado (Forecast, Orçamento, Anterior ou Vendido, nos Cenários Sintéticos e Analíticos) ou Sem Comparação;
              a escolha fica guardada neste navegador e vale também no Painel de Bordo. Nos cards, o realizado, o cenário e a diferença do mês e do acumulado no
              ano (os meses do ano com competência até este: o Quadro de Lotação do último; o Turnover e as Contratações somados, nos dois). Na tabela, as
              colunas Cenário (os colaboradores do centro no mês, na aba Quadro de Lotação do cenário) e Diferença (Fim do Mês − Cenário) aparecem quando o
              cenário é analítico e tem essa aba; os centros só do cenário entram com o realizado zero.
            </li>
          </ul>
        }
        acoes={<SeletorDaComparacao comparacao={comparacao} />}
        exportar={<ExportarTabela titulo={`Quadro de Lotação · Realizado · ${rotuloDoMes(anoMes)}`} colunas={colunas} linhas={tabela.filtradas} />}
      />
      {ind ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {INDICADORES_DO_QUADRO.map((i) => {
            const real = i.valor(ind);
            const doCenario = cenario?.indicadores[i.chave] ?? null;
            const cenarioNoMes = doCenario ? doCenario[mes - 1] : null;
            // O acumulado nos meses do ano com competência até este, nos dois (como no Painel de Bordo).
            const acumulado = i.acumulado(doAno.map((m) => i.valor(m)));
            const acumuladoCenario = doCenario ? i.acumulado(doAno.map((m) => doCenario[m.mes - 1])) : null;
            return (
              <Destaque
                key={i.chave}
                rotulo={i.nome}
                valor={i.formatar(real)}
                dica={i.explicacao}
                comparacao={
                  doCenario
                    ? {
                        marcacao: rotuloDaComparacao,
                        mes: i.formatar(cenarioNoMes),
                        diferenca: diferenca(i, real, cenarioNoMes),
                        acumulado: i.formatar(acumulado),
                        acumuladoCenario: i.formatar(acumuladoCenario),
                        diferencaAcumulada: diferenca(i, acumulado, acumuladoCenario),
                      }
                    : undefined
                }
              />
            );
          })}
        </div>
      ) : null}
      {r.data?.comparacao && !porCentro ? (
        <p className="rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-2 text-sm text-gray-700">
          {r.data.comparacao.cenario.analitico
            ? `O cenário ${r.data.comparacao.cenario.nome} não tem linhas na aba Quadro de Lotação: a comparação fica nos indicadores.`
            : `O cenário ${r.data.comparacao.cenario.nome} é sintético (sem a aba Quadro de Lotação): a comparação fica nos indicadores.`}
        </p>
      ) : null}
      <QuadroTabela>
        <DataTable<LinhaDoRealizado>
          data={tabela.visiveis}
          cabecalho={tabela.cabecalho}
          filtrosAtivos={tabela.ativos}
          onLimparFiltros={tabela.limpar}
          isLoading={r.isPending}
          error={r.isError ? "Erro ao carregar o quadro realizado." : null}
          emptyMessage="Nenhum colaborador no quadro desta competência"
          emptyHint="O quadro começa no Lançamento Inicial (Cadastros) e muda com as movimentações aprovadas."
          columns={colunas.map((c) => c.rotulo)}
          renderRow={(l) => (
            <tr key={l.centroCustoId} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="px-4 py-2 text-sm">{l.centroCusto}</td>
              <td className="px-4 py-2 text-sm">{l.departamento ?? <span className="text-gray-400">—</span>}</td>
              <td className="px-4 py-2 text-sm">{l.atribuicao ?? <span className="text-gray-400">—</span>}</td>
              <td className="px-4 py-2 text-right text-sm">{l.inicial}</td>
              <td className="px-4 py-2 text-right text-sm">{l.entradas || <span className="text-gray-400">0</span>}</td>
              <td className="px-4 py-2 text-right text-sm">{l.saidas || <span className="text-gray-400">0</span>}</td>
              <td className="px-4 py-2 text-right text-sm font-medium">{l.final}</td>
              <td className="px-4 py-2 text-right text-sm">{l.clt}</td>
              <td className="px-4 py-2 text-right text-sm">{l.pj}</td>
              {porCentro ? (
                <>
                  <td className="px-4 py-2 text-right text-sm">{(l.cenario ?? 0).toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-2 text-right text-sm font-medium">{sinal(l.final - (l.cenario ?? 0))}</td>
                </>
              ) : null}
            </tr>
          )}
          rodape={
            tabela.filtradas.length ? (
              <tr className="border-t border-gray-300 bg-gray-50 text-sm font-bold">
                <td className="px-4 py-2" colSpan={3}>
                  Total
                </td>
                <td className="px-4 py-2 text-right">{soma("inicial")}</td>
                <td className="px-4 py-2 text-right">{soma("entradas")}</td>
                <td className="px-4 py-2 text-right">{soma("saidas")}</td>
                <td className="px-4 py-2 text-right">{soma("final")}</td>
                <td className="px-4 py-2 text-right">{soma("clt")}</td>
                <td className="px-4 py-2 text-right">{soma("pj")}</td>
                {porCentro ? (
                  <>
                    <td className="px-4 py-2 text-right">{somaCenario.toLocaleString("pt-BR")}</td>
                    <td className="px-4 py-2 text-right">{sinal(soma("final") - somaCenario)}</td>
                  </>
                ) : null}
              </tr>
            ) : null
          }
        />
      </QuadroTabela>
    </div>
  );
}
