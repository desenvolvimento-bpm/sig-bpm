/**
 * As movimentações do realizado fora dos padrões das premissas (cenário analítico, 14/10/2026): os lançamentos de mão
 * de obra e de gastos gerais que a referência realizada não leva aos grupos de centros de custo — sem centro de custo
 * no balancete (ou num centro fora do cadastro, como os de obra), em centros de estoque e de investimento, ou numa
 * conta fora do grupo da DRE do centro. A aba Referência lista cada conta (a conta contábil, com a alocação dela na
 * DRE) e o usuário escolhe o grupo de centros que a recebe; sem grupo, fica fora do cenário.
 *
 * As decisões ficam no cenário (`cenarios.realocacoes`) e valem nas próximas cargas do realizado (o modal as mostra,
 * editáveis). Ao mudar uma decisão depois da carga, a diferença entra (e sai) dos valores dos centros do cenário, sem
 * mexer no que foi digitado neles.
 */

/** Uma conta com movimentações fora dos padrões, no período da carga. */
export type MovimentacaoForaDoPadrao = {
  /** A conta contábil e a conta da DRE ("reduzido|codigo da linha da DRE"). */
  chave: string;
  conta: { reduzido: string; descricao: string };
  /** A alocação na DRE: o departamento, a atribuição e a conta de resultado. */
  linha: { codigo: string; departamento: string; atribuicao: string; descricao: string };
  /** De onde vêm os lançamentos (sem centro de custo, ou os centros fora do cenário). */
  origens: string[];
  /** O total movimentado no período. */
  total: number;
  /** Os valores que entram nos doze meses do cenário (mês a mês; zeros na média do período, 15/10/2026). */
  valores: number[];
  /** O que entra na Média de Referência do grupo (o mês 0): a soma dos meses ÷ os meses da referência (17/11/2026: também os sem valor). */
  media?: number;
  /** Os grupos de centros que podem recebê-la: os que têm a mesma atribuição e conta no grupo da DRE deles. */
  destinos: Array<{ grupo: string; conta: string; departamento: string }>;
  /** A filial predominante dos lançamentos (pelo valor). */
  filial?: number;
  /** O grupo do padrão (botão Aplicar Padrão), quando ele pode recebê-la; nas cargas antigas, ausente. */
  padrao?: string | null;
};

/** O que está somado nos centros do cenário por uma decisão (para tirar se ela mudar). */
export type RealocacaoAplicada = { grupo: string; conta: string; valores: number[]; media?: number };

export type Realocacoes = {
  /** A carga do realizado que gerou a lista (o nome da referência). */
  referencia: string | null;
  movimentacoes: MovimentacaoForaDoPadrao[];
  /** O grupo escolhido para cada conta (nulo: fica fora do cenário). Valem nas próximas cargas. */
  decisoes: Record<string, string | null>;
  aplicadas: Record<string, RealocacaoAplicada>;
  atualizadoEm: string | null;
  atualizadoPor: string | null;
};

export const SEM_REALOCACOES: Realocacoes = { referencia: null, movimentacoes: [], decisoes: {}, aplicadas: {}, atualizadoEm: null, atualizadoPor: null };

/** As realocações gravadas no cenário (o JSON da coluna), com os campos que faltarem. */
export function lerRealocacoes(json: unknown): Realocacoes {
  if (!json || typeof json !== "object") return { ...SEM_REALOCACOES };
  const r = json as Partial<Realocacoes>;
  return {
    referencia: r.referencia ?? null,
    movimentacoes: Array.isArray(r.movimentacoes) ? r.movimentacoes : [],
    decisoes: r.decisoes && typeof r.decisoes === "object" ? r.decisoes : {},
    aplicadas: r.aplicadas && typeof r.aplicadas === "object" ? r.aplicadas : {},
    atualizadoEm: r.atualizadoEm ?? null,
    atualizadoPor: r.atualizadoPor ?? null,
  };
}

/**
 * As diferenças nos centros do cenário ao trocar as decisões ("grupo|conta|mês" → valor a somar) e as aplicadas novas.
 * Uma decisão que não muda fica como está; a que muda tira o valor do grupo antigo e põe no novo.
 */
export function diferencasDasDecisoes(r: Realocacoes, decisoes: Record<string, string | null>) {
  const diferencas = new Map<string, number>();
  const mais = (a: RealocacaoAplicada, mes: number, v: number) => v && diferencas.set(`${a.grupo}|${a.conta}|${mes}`, (diferencas.get(`${a.grupo}|${a.conta}|${mes}`) ?? 0) + v);
  // Os meses e, desde 15/10/2026, a Média de Referência (o mês 0).
  const somar = (a: RealocacaoAplicada, sinal: 1 | -1) => {
    a.valores.forEach((v, k) => mais(a, k + 1, sinal * v));
    if (a.media) mais(a, 0, sinal * a.media);
  };
  const aplicadas: Record<string, RealocacaoAplicada> = {};
  for (const m of r.movimentacoes) {
    const grupo = m.chave in decisoes ? decisoes[m.chave] : (r.decisoes[m.chave] ?? null);
    const alvo = grupo ? m.destinos.find((d) => d.grupo === grupo) : undefined;
    const antiga = r.aplicadas[m.chave];
    if (antiga && alvo && antiga.grupo === alvo.grupo && antiga.conta === alvo.conta) {
      aplicadas[m.chave] = antiga;
      continue;
    }
    if (antiga) somar(antiga, -1);
    if (alvo) {
      const nova = { grupo: alvo.grupo, conta: alvo.conta, valores: m.valores, media: m.media };
      somar(nova, 1);
      aplicadas[m.chave] = nova;
    }
  }
  return { diferencas, aplicadas };
}

/** "Técnico" → "TECNICO": para achar o centro do RM pelo nome, sem acentos e sem caixa. */
const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();

/**
 * O padrão das realocações (14/10/2026, botão Aplicar Padrão): o centro de custo do RM que recebe cada conta, pelo
 * departamento da conta na DRE, pela filial (a predominante dos lançamentos) e pela atribuição. Na produção e nos
 * serviços, a mão de obra direta e os gastos gerais diretos (e variáveis) vão ao centro produtivo; a indireta e os
 * gastos gerais indiretos, ao de apoio.
 */
export function centroPadrao(codigoDaLinha: string, filial: number): string | null {
  const [departamento, atribuicao] = codigoDaLinha.split(".");
  const direta = ["MOD", "GGD", "GGV"].includes(atribuicao);
  const indireta = ["MOI", "GGI"].includes(atribuicao);
  switch (departamento) {
    case "CPP":
      if (filial === 2) return direta ? "ALVEOLARES" : indireta ? "PCP (FOR)" : null;
      return direta ? "ESTRUTURA" : indireta ? "PCP (CRI)" : null;
    case "CSM":
    case "CSC":
      return direta ? "GUINDASTEIROS" : indireta ? "ADM. DE OBRAS" : null;
    case "DL":
      return "LOGISTICA";
    case "DT":
      return "TECNICO";
    case "DC":
      return "ORCAMENTOS";
    case "DA":
      return "FINANCEIRO";
    default:
      return null;
  }
}

/** O grupo do cenário que tem o centro do RM de nome `nomeRM` (sem acentos e sem caixa). */
export function grupoDoCentroRM(grupos: Array<{ grupo: string; centros: Array<{ nome: string }> }>, nomeRM: string) {
  const alvo = normalizar(nomeRM);
  return grupos.find((g) => g.centros.some((c) => normalizar(c.nome) === alvo))?.grupo ?? null;
}
