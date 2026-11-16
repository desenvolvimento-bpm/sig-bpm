import { getPrismaClient } from "../../config/prisma.js";
import type { MarcacaoCenario } from "../../generated/prisma/enums.js";
import { calcularCenario, cenariosMarcados } from "../cenarios/indicadoresDoCenario.js";
import { mesesDaLinha } from "../cenarios/quadroDoCenario.js";

/**
 * A Comparação do Quadro de Lotação com um cenário (09/11/2026, etapa 4 da Gestão de Colaboradores): os cenários marcados
 * (Forecast, Orçamento, Anterior e Vendido, de qualquer exercício, como a Comparação de Resultados Empresariais; num de outro
 * exercício, valem os mesmos meses). Do cenário escolhido:
 *
 * - os indicadores do Painel de Bordo, mês a mês, pelo nome no cadastro dos indicadores (os mesmos do Apurar): Quadro de
 *   Lotação Total, Turnover e Abertura de Vagas x Contratações;
 * - nos analíticos com linhas na aba Quadro de Lotação, os colaboradores de cada centro de custo em cada mês (a aba
 *   Realizado compara centro a centro).
 */
export const NOMES_DOS_INDICADORES = { quadroDeLotacao: "Quadro de Lotação Total", turnover: "Turnover", contratacoes: "Abertura de Vagas x Contratações" } as const;
export const MARCACOES_COMPARAVEIS: MarcacaoCenario[] = ["PREVISAO", "ORCAMENTO_EMPRESARIAL", "RESULTADOS_ANTERIORES", "RESULTADOS_VENDIDOS"];

/** O cenário de uma marcação (null: nenhum marcado com ela). */
async function cenarioDaMarcacao(marcacao: MarcacaoCenario) {
  return getPrismaClient().cenario.findFirst({ where: { marcacao }, select: { id: true, nome: true, ano: true, tipo: true } });
}

/** Os colaboradores de cada centro em cada mês, na aba Quadro de Lotação do analítico; null sem linhas (ou num sintético). */
export async function colaboradoresPorCentro(cenario: { id: string; tipo: string }) {
  if (cenario.tipo !== "ANALITICO") return null;
  const linhas = await getPrismaClient().cenarioLotacao.findMany({ where: { cenarioId: cenario.id }, select: { centroCustoId: true, meses: true } });
  if (!linhas.length) return null;
  const porCentro = new Map<string, number[]>();
  for (const l of linhas) {
    const s = porCentro.get(l.centroCustoId) ?? Array<number>(12).fill(0);
    mesesDaLinha(l.meses).forEach((m, k) => (s[k] += m.colaboradores));
    porCentro.set(l.centroCustoId, s);
  }
  return porCentro;
}

export const comparacaoDoQuadroService = {
  /** Os cenários marcados: as opções da Comparação. */
  opcoes: () => cenariosMarcados(),

  /** O cenário de uma marcação e os indicadores dele mês a mês (null: nenhum cenário com a marcação). */
  async doCenario(marcacao: MarcacaoCenario) {
    const c = await cenarioDaMarcacao(marcacao);
    if (!c) return null;
    const [calc, porCentro] = await Promise.all([calcularCenario(c.id), colaboradoresPorCentro(c)]);
    const serie = (nome: string) => {
      const i = calc.indicadores.find((x) => x.indicador.nome === nome);
      return Array.from({ length: 12 }, (_, k) => {
        const v = i?.partes[k]?.valor;
        return v === null || v === undefined || !Number.isFinite(v) ? null : v;
      });
    };
    return {
      cenario: { id: c.id, nome: c.nome, ano: c.ano, analitico: c.tipo === "ANALITICO", porCentro: porCentro !== null },
      indicadores: {
        quadroDeLotacao: serie(NOMES_DOS_INDICADORES.quadroDeLotacao),
        turnover: serie(NOMES_DOS_INDICADORES.turnover),
        contratacoes: serie(NOMES_DOS_INDICADORES.contratacoes),
      },
    };
  },

  cenarioDaMarcacao,
};
