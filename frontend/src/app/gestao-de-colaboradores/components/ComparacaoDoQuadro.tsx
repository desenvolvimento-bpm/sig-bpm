"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { quadroService, type CenarioComparado, type IndicadoresDoMes, type MarcacaoComparavel } from "../services/quadroService";

/**
 * Os indicadores do Quadro de Lotação (Painel de Bordo, aba Realizado e a Comparação, 09/11/2026): o valor do mês, a chave do
 * cenário comparado, o acumulado no ano (dos valores dos meses, na ordem) e a explicação.
 */
export const INDICADORES_DO_QUADRO: Array<{
  chave: keyof CenarioComparado["indicadores"];
  nome: string;
  unidade: string;
  valor: (m: IndicadoresDoMes) => number | null;
  acumulado: (valores: Array<number | null>) => number | null;
  formatar: (v: number | null) => string;
  explicacao: string;
}> = [
  {
    chave: "quadroDeLotacao",
    nome: "Quadro de Lotação",
    unidade: "und",
    valor: (m) => m.quadroDeLotacao,
    acumulado: (vs) => vs.filter((v): v is number => v !== null).at(-1) ?? null,
    formatar: (v) => (v === null ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })),
    explicacao: "O quadro do fim do mês: o do início (o Lançamento Inicial, no mês dele, ou o fim do mês anterior) + as movimentações Positivas − as Negativas, aprovadas. No ano, o do último mês.",
  },
  {
    chave: "turnover",
    nome: "Turnover",
    unidade: "%",
    valor: (m) => m.turnover,
    acumulado: (vs) => (vs.some((v) => v !== null) ? vs.reduce<number>((a, v) => a + (v ?? 0), 0) : null),
    formatar: (v) => (v === null ? "—" : `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`),
    explicacao: "(Movimentações Positivas + Negativas) ÷ 2 ÷ Quadro de Lotação do mês. No ano, a soma dos meses.",
  },
  {
    chave: "contratacoes",
    nome: "Abertura de Vagas x Contratações",
    unidade: "ocorr.",
    valor: (m) => m.contratacoes,
    acumulado: (vs) => (vs.some((v) => v !== null) ? vs.reduce<number>((a, v) => a + (v ?? 0), 0) : null),
    formatar: (v) => (v === null ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })),
    explicacao: "As contratações do mês: as movimentações aprovadas de contagem Positiva. No ano, a soma dos meses.",
  },
];

/** A diferença (realizado − cenário) no formato do indicador; sem um dos dois, "—". */
export function diferenca(ind: (typeof INDICADORES_DO_QUADRO)[number], realizado: number | null, cenario: number | null) {
  if (realizado === null || cenario === null) return "—";
  const d = realizado - cenario;
  const texto = ind.formatar(Math.abs(d));
  return d > 0 ? `+${texto}` : d < 0 ? `−${texto}` : texto;
}

const CHAVE = "sig.quadro.comparacao";
/** A escolha de Resultados Empresariais (a Comparação Padrão), o ponto de partida. */
const CHAVE_DE_RESULTADOS = "sig.comparaCom";
function ler(chave: string) {
  try {
    return window.localStorage.getItem(chave);
  } catch {
    return null;
  }
}
function guardar(valor: string) {
  try {
    window.localStorage.setItem(CHAVE, valor);
  } catch {
    // Sem o armazenamento do navegador, vale só nesta tela.
  }
}

/**
 * A Comparação do Quadro de Lotação (09/11/2026, etapa 4): um dos cenários marcados (Previsão, Orçamento, Anterior e
 * Vendido), como a de Resultados Empresariais, ou nenhum. A escolha fica guardada neste navegador e vale no Quadro de
 * Lotação e no Painel de Bordo; de início, a de Resultados (ou a primeira marcação que houver).
 */
export function useComparacaoDoQuadro() {
  const naTela = typeof window !== "undefined";
  const [escolhida, setEscolhida] = useState<string | null>(() => (naTela ? ler(CHAVE) : null));
  const opcoes = useQuery({ queryKey: ["quadro", "comparacao", "opcoes"], queryFn: () => quadroService.comparacao(null) });
  const lista = opcoes.data?.opcoes ?? [];
  const tem = (m: string | null) => !!m && lista.some((o) => o.marcacao === m);
  const deResultados = naTela ? ler(CHAVE_DE_RESULTADOS) : null;
  const marcacao = (escolhida === "NENHUMA" ? null : tem(escolhida) ? escolhida : tem(deResultados) ? deResultados : (lista[0]?.marcacao ?? null)) as MarcacaoComparavel | null;
  const comparado = useQuery({ queryKey: ["quadro", "comparacao", marcacao], queryFn: () => quadroService.comparacao(marcacao), enabled: marcacao !== null });
  return {
    opcoes: lista,
    marcacao,
    atual: lista.find((o) => o.marcacao === marcacao) ?? null,
    comparado: marcacao ? (comparado.data?.comparado ?? null) : null,
    /** As opções chegaram (ou falharam): a tela pode pedir os dados com a escolha. */
    pronta: opcoes.isSuccess || opcoes.isError,
    mudar: (m: MarcacaoComparavel | null) => {
      setEscolhida(m ?? "NENHUMA");
      guardar(m ?? "NENHUMA");
    },
  };
}
export type ComparacaoDoQuadro = ReturnType<typeof useComparacaoDoQuadro>;

/** A lista Comparação, na altura do título: os cenários marcados (pelo nome da marcação) ou Sem Comparação. */
export function SeletorDaComparacao({ comparacao }: { comparacao: ComparacaoDoQuadro }) {
  if (!comparacao.opcoes.length) return null;
  const dica = comparacao.atual ? `Comparação: ${comparacao.atual.rotulo} (${comparacao.atual.cenario.nome}, ${comparacao.atual.cenario.ano})` : "Sem Comparação";
  return (
    <label className="flex items-center gap-2" title={dica}>
      <span className="text-xs font-medium whitespace-nowrap text-gray-600">Comparação</span>
      <select
        aria-label="Comparação"
        value={comparacao.marcacao ?? ""}
        onChange={(e) => comparacao.mudar((e.target.value || null) as MarcacaoComparavel | null)}
        className="h-9 w-40 rounded-sm border border-gray-300 bg-white px-3 text-sm"
      >
        <option value="">Sem Comparação</option>
        {comparacao.opcoes.map((o) => (
          <option key={o.marcacao} value={o.marcacao}>
            {o.rotulo}
          </option>
        ))}
      </select>
    </label>
  );
}
