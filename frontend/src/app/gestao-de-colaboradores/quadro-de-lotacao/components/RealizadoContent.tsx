"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { DataTable } from "@/components/shared/DataTable";
import { ExportarTabela } from "@/components/shared/ExportarTabela";
import { QuadroTabela } from "@/components/shared/QuadroTabela";
import { useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";
import type { Coluna } from "@/lib/filtrosDeTabela";

import { SeletorDaComparacao, useComparacaoDoQuadro } from "../../components/ComparacaoDoQuadro";
import { quadroService, type LinhaDoRealizado } from "../../services/quadroService";
import { CabecalhoDoQuadro, rotuloDoMes } from "./CabecalhoDoQuadro";

const numero = (chave: keyof LinhaDoRealizado, rotulo: string): Coluna<LinhaDoRealizado> => ({
  chave,
  rotulo,
  tipo: "numero",
  alinhamento: "direita",
  valor: (l) => l[chave] as number,
});
// O Departamento antes do Centro de Custo (13/11/2026, pedido do Adão).
const COLUNAS: Coluna<LinhaDoRealizado>[] = [
  { chave: "departamento", rotulo: "Departamento", valor: (l) => l.departamento },
  { chave: "centro", rotulo: "Centro de Custo", valor: (l) => l.centroCusto },
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

/**
 * A aba Realizado de uma competência do Quadro de Lotação (06/11/2026): o quadro do mês por centro de custo — o do início,
 * as entradas e as saídas aprovadas, o do fim (CLT e PJ). Com a Comparação (09/11/2026), por centro, os colaboradores da aba
 * Quadro de Lotação do cenário escolhido (nos analíticos que a têm) e a diferença. Desde 12/11/2026 (pedido do Adão), sem os
 * cards dos indicadores (ficam no Painel de Bordo) e sem o aviso do cenário sem a aba Quadro de Lotação.
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

  return (
    <div className="space-y-4">
      <CabecalhoDoQuadro
        anoMes={anoMes}
        aba="realizado"
        sobre={
          <p>
            O Quadro de Lotação Realizado do mês, por departamento e centro de custo: os colaboradores do início do mês (o Lançamento Inicial, no mês dele, ou o fim da
            competência anterior), as entradas (as movimentações aprovadas de contagem Positiva), as saídas (as de Negativa) e os do fim do mês, CLT e PJ.
            Com a Comparação, por centro, os colaboradores do mês na aba Quadro de Lotação do cenário escolhido (nos cenários analíticos que a têm) e a
            diferença. Os indicadores do mês (Quadro de Lotação, Turnover e Abertura de Vagas x Contratações) ficam no Painel de Bordo.
          </p>
        }
        comoUsar={
          <ul>
            <li>Use os filtros nos rótulos das colunas; a linha Total soma as linhas filtradas.</li>
            <li>
              “Comparação”, ao lado do título, escolhe o cenário marcado (Forecast, Orçamento, Anterior ou Vendido, nos Cenários Sintéticos e Analíticos) ou Sem
              Comparação; a escolha fica guardada neste navegador e vale também no Painel de Bordo. Na tabela, as colunas Cenário (os colaboradores do centro no
              mês, na aba Quadro de Lotação do cenário) e Diferença (Fim do Mês − Cenário) aparecem quando o cenário é analítico e tem linhas nessa aba; os
              centros só do cenário entram com o realizado zero.
            </li>
            <li>A situação da competência (Aberta ou Fechada) fica à direita da barra do topo, e o mês, no caminho do topo.</li>
          </ul>
        }
        acoes={<SeletorDaComparacao comparacao={comparacao} />}
        exportar={<ExportarTabela titulo={`Quadro de Lotação · Realizado · ${rotuloDoMes(anoMes)}`} colunas={colunas} linhas={tabela.filtradas} />}
      />
      <QuadroTabela>
        <DataTable<LinhaDoRealizado>
          data={tabela.visiveis}
          cabecalho={tabela.cabecalho}
          filtrosAtivos={tabela.ativos}
          onLimparFiltros={tabela.limpar}
          isLoading={r.isPending}
          error={r.isError ? "Erro ao carregar o quadro realizado." : null}
          emptyMessage="Nenhum colaborador no quadro desta competência"
          emptyHint="O quadro começa no Lançamento Inicial (Cadastros Auxiliares) e muda com as movimentações aprovadas."
          columns={colunas.map((c) => c.rotulo)}
          renderRow={(l) => (
            <tr key={l.centroCustoId} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="px-4 py-2 text-sm">{l.departamento ?? <span className="text-gray-400">—</span>}</td>
              <td className="px-4 py-2 text-sm">{l.centroCusto}</td>
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
