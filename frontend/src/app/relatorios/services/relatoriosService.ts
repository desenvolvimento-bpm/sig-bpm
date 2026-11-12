import { api } from "@/lib/api";

export type MesRelatorio = { mes: number; rotulo: string; apurado: boolean };
/** Valor, participação (fração: 0,25 = 25%) e valor unitário (R$/m³); null quando não se aplica ou o mês não foi apurado. */
export type Celula = { valor: number | null; pct: number | null; unitario: number | null };

export type LinhaResultado = {
  codigo: string;
  tipo: "SECAO" | "ITEM" | "SUBTOTAL" | "TOTAL";
  grupo: string;
  grupoSigla: string;
  descricao: string;
  /** Linha de volume (m³, kg, pistas, dias): sem % nem R$/m³. */
  volume: boolean;
  /** O usuário alcança os lançamentos da linha (o recorte do Gestor por departamento). */
  podeDetalhar: boolean;
  meses: Celula[];
  total: Celula;
  /**
   * Nas visões de Resultados Empresariais: o orçado do mês de referência e o acumulado, com o % e o R$/m³ (o cenário
   * Orçamento Empresarial; zero sem ele). Nos cenários com um cenário comparado (13/10/2026): só o total dele.
   */
  orcado?: { mes?: Celula; total: Celula } | null;
  /** Na Tabela PROVA dos Relatórios Executivos e na Comparação PROVA de Resultados (31/10/2026): o orçado de cada cenário, como o do comparado. */
  prova?: Partial<Record<MarcacaoComparavel, { mes: Celula; total: Celula }>>;
};

export type Resultados = {
  ano: number;
  ate: number;
  /** O cenário do orçado (o Orçamento Empresarial do exercício); null: nenhum (o orçado é zero). */
  cenarioOrcado?: string | null;
  /** O nome do comparado nos rótulos (21/10/2026): "Orçado" ou o nome da marcação escolhida no Compara Com. */
  rotuloComparado?: string;
  /** Nos cenários (13/10/2026): o cenário comparado, cujos totais vêm no lugar do orçado. */
  comparado?: { nome: string; ano: number } | null;
  /** Nos Relatórios Executivos (31/10/2026, a Tabela PROVA): os cenários marcados que existem, na ordem do PROVA. */
  prova?: Array<{ marcacao: MarcacaoComparavel; rotulo: string; cenario: string }>;
  meses: MesRelatorio[];
  linhas: LinhaResultado[];
  grupo?: string;
  /** Nos centros de custo: os centros do agrupamento com lançamento no período. */
  centros?: Array<{ codigoRM: string | null; nome: string }>;
  /** Nas obras: o código (centro 1.98 ou 1.99) e o nome da obra. */
  obra?: { codigo: string; nome: string };
};
/** As obras com lançamento no período, com o total do exercício (o Resultado Líquido; no recorte, a soma do que se vê). */
export type ObrasResultados = { ano: number; ate: number; obras: Array<{ codigo: string; nome: string; total: string }> };
/** Os grupos dos movimentos sem centro de custo com lançamento no período (14/10/2026), com o total do exercício. */
export type SemCentrosResultados = { ano: number; ate: number; grupos: Array<{ codigo: string; nome: string; total: string }> };
export type CentrosResultados = { ano: number; ate: number; grupos: Array<{ grupo: string; departamentos: string[]; total: string }> };
/** Uma linha de produto ou de obra (26/10/2026), da unidade dela. */
export type LinhaDoNegocio = { id: string; codigo: string; nome: string; unidade: number; nomeUnidade: string; ativo: boolean };
/** As linhas das abas Linhas e Rateios das Linhas; `semLinhas`: os meses fechados ainda sem as linhas gravadas. */
export type LinhasResultados = { ano: number; ate: number; linhas: LinhaDoNegocio[]; semLinhas: string[] };
export type ResultadosDaLinha = Resultados & { linha: LinhaDoNegocio; semLinhas: string[] };

export type Indicador = {
  grupo: string;
  numero: string;
  nome: string;
  sentido: string;
  unidade: string;
  metodologia: string;
  acumulado: "ACUM" | "ATUAL";
  meses: Array<number | null>;
  /** Os meses com o valor apurado no Quadro de Lotação (06/11/2026): a lupa com as movimentações. */
  apurados?: boolean[];
  total: number | null;
  /** O orçado de cada mês e o acumulado do orçado: o cenário Orçamento Empresarial do exercício (zero sem ele). */
  orcado: Array<number | null>;
  totalOrcado: number | null;
  /** A Média de Referência (os indicadores manuais dos analíticos, 15/10/2026). */
  referencia?: number | null;
  /** Nos cards PROVA e na Comparação PROVA (31/10/2026): o orçado de cada mês e o acumulado de cada cenário marcado. */
  prova?: Partial<Record<MarcacaoComparavel, { orcado: Array<number | null>; totalOrcado: number | null }>>;
};
export type Indicadores = {
  ano: number;
  ate: number;
  /** O cenário do orçado (o Orçamento Empresarial do exercício); null: nenhum (o orçado é zero). */
  cenarioOrcado?: string | null;
  /** O nome do comparado nos rótulos (21/10/2026): "Orçado" ou o nome da marcação escolhida no Compara Com. */
  rotuloComparado?: string;
  meses: MesRelatorio[];
  indicadores: Indicador[];
};

/** Os formatos das células do Painel de Bordo, como na planilha. */
export type FormatoPainel = "MILHOES" | "MILHARES" | "M3" | "PISTAS" | "PCT" | "PCT_RL" | "RS_M3";
/** O item num período: realizado, orçado, o percentual sob o realizado, o desvio (fração) e o sinal (1 melhor, 0 dentro de 5%, −1 pior). */
export type BlocoPainel = { realizado: number | null; orcado: number | null; base: number | null; vsOrcado: number | null; sinal: -1 | 0 | 1 | null };
export type ItemPainel = {
  titulo: string;
  sigla: string;
  /** A Metodologia por extenso (21/10/2026), no lugar da abreviação no card. */
  metodologia?: string;
  sentido: "↑" | "↓";
  formato: FormatoPainel;
  formatoAcumulado: FormatoPainel;
  base: { rotulo: string; casas: 1 | 2 } | null;
  separar: boolean;
  mes: BlocoPainel;
  acumulado: BlocoPainel;
  /** Os meses do exercício até o de referência (os gráficos): o realizado e o orçado de cada um. */
  serie: Array<{ mes: string; realizado: number | null; orcado: number | null }>;
  /** Nos cards PROVA e na Comparação PROVA (31/10/2026): o realizado contra cada cenário marcado e o orçado dele em cada mês. */
  prova?: Partial<Record<MarcacaoComparavel, { mes: BlocoPainel; acumulado: BlocoPainel; serie: Array<number | null> }>>;
};
export type QuadroPainel = { titulo: string; itens: ItemPainel[] };
export type Painel = {
  ano: number;
  ate: number;
  rotuloMes: string;
  rotuloAcumulado: string;
  mesApurado: boolean;
  mesesSemMeta: string[];
  /** O cenário do orçado (o Orçamento Empresarial do exercício); null: nenhum (o orçado é zero). */
  cenarioOrcado: string | null;
  rotuloComparado?: string;
  abas: Array<{ chave: string; titulo: string; quadros: QuadroPainel[] }>;
};

const periodo = (ano: number, ate?: number) => ({ ano, ...(ate ? { ate } : {}) });

/**
 * O Creditado e o Estornado num mês (04/11/2026): o R$ e o percentual (fração) sobre o custo da conta na unidade; nulo, sem os
 * créditos importados no mês (o percentual nulo também sem o custo).
 */
export type CreditosDoMes = { creditado: { valor: number | null; pct: number | null }; estornado: { valor: number | null; pct: number | null } } | null;
/**
 * A aba Impostos (Créditos de Impostos, 03/11/2026; por unidade desde 04/11/2026): em cada unidade (Matriz e Filial), de cada
 * mês fechado, os créditos do total, de cada grupo (Matérias Primas, Gastos Gerais Variáveis) e de cada conta dele.
 */
export type CreditosDosMeses = {
  meses: Array<{ mes: number; rotulo: string }>;
  unidades: Array<{
    codigo: number;
    nome: string;
    total: { meses: CreditosDoMes[] };
    grupos: Array<{ codigo: string; descricao: string; meses: CreditosDoMes[]; contas: Array<{ codigo: string; descricao: string; meses: CreditosDoMes[] }> }>;
  }>;
};
/** As marcações dos cenários que o Compara Com escolhe (21/10/2026). */
export type MarcacaoComparavel = "ORCAMENTO_EMPRESARIAL" | "RESULTADOS_ANTERIORES" | "RESULTADOS_VENDIDOS" | "PREVISAO";
/** Um cenário marcado (o Compara Com): de qualquer exercício (22/10/2026), com o ano dele. */
export type Comparavel = { marcacao: MarcacaoComparavel; rotulo: string; cenario: { id: string; nome: string; ano: number } };
const comparado = (comparaCom?: MarcacaoComparavel) => (comparaCom && comparaCom !== "ORCAMENTO_EMPRESARIAL" ? { comparaCom } : {});
/** A Comparação PROVA (31/10/2026): as marcações dos cenários, separadas por vírgula; sem elas, a Comparação Padrão. */
const comProva = (prova?: MarcacaoComparavel[]) => (prova?.length ? { prova: prova.join(",") } : {});

/**
 * Uma ocorrência do Pesquisar de Resultados Empresariais (11/11/2026): um movimento do balancete, com o centro de custo, a
 * atribuição, a linha da DRE, a conta (a do balancete e a que vale na DRE), o fornecedor ou cliente e o que o Balancete
 * mostra para contestar.
 */
export type OcorrenciaDaPesquisa = {
  id: string;
  anoMes: string;
  filial: number;
  codigoCentroCusto: string | null;
  nomeCentroCusto: string | null;
  atribuicao: string | null;
  linha: { codigo: string; rotulo: string; grupo: string };
  contaDoBalancete: { reduzido: string; descricao: string };
  contaNaDRE: { reduzido: string; descricao: string };
  adotada: string | null;
  cliForn: string | null;
  emissao: string | null;
  historico: string | null;
  idMovimento: string | null;
  itens: number;
  valor: string;
  centroOriginal: { codigoRM: string | null; nome: string | null } | null;
  contestacaoAplicada: { numero: number; centro: boolean; conta: boolean } | null;
  contestacao: { numero: number; situacao: "PENDENTE" | "ACATADA" | "RECUSADA" | "VALIDADA"; deItens: boolean; comItensContestados: boolean } | null;
};
export type TipoDaPesquisa = "fornecedor" | "conta";
export type ResultadoDaPesquisa = {
  ano: number;
  ate: number;
  tipo: TipoDaPesquisa;
  termo: string;
  conta: { reduzido: string; descricao: string } | null;
  total: number;
  /** A soma de todas as ocorrências (também das que passam do limite). */
  soma: string;
  limite: number;
  ocorrencias: OcorrenciaDaPesquisa[];
};

export const relatoriosService = {
  /** O Pesquisar (11/11/2026): os movimentos de um fornecedor ou cliente, ou de uma conta, no período e no recorte do usuário. */
  pesquisar: async (ano: number, ate: number | undefined, tipo: TipoDaPesquisa, termo: string) =>
    (await api.get<{ data: ResultadoDaPesquisa }>("/proxy/relatorios/resultados/pesquisa", { params: { ...periodo(ano, ate), tipo, termo } })).data.data,
  contasDaPesquisa: async () => (await api.get<{ data: Array<{ reduzido: string; descricao: string }> }>("/proxy/relatorios/resultados/pesquisa/contas")).data.data,
  resultados: async (ano: number, ate: number | undefined, visao: number, comparaCom?: MarcacaoComparavel, prova?: MarcacaoComparavel[]) =>
    (await api.get<{ data: Resultados }>("/proxy/relatorios/resultados", { params: { ...periodo(ano, ate), visao, ...comparado(comparaCom), ...comProva(prova) } })).data.data,
  /** Os cenários marcados do exercício (21/10/2026): as opções do Compara Com. */
  comparaveis: async (ano: number) => (await api.get<{ data: Comparavel[] }>("/proxy/relatorios/comparaveis", { params: { ano } })).data.data,
  centros: async (ano: number, ate: number | undefined) =>
    (await api.get<{ data: CentrosResultados }>("/proxy/relatorios/resultados", { params: { ...periodo(ano, ate), visao: "centros" } })).data.data,
  semCentros: async (ano: number, ate: number | undefined) =>
    (await api.get<{ data: SemCentrosResultados }>("/proxy/relatorios/resultados", { params: { ...periodo(ano, ate), visao: "sem_centros" } })).data.data,
  semCentro: async (ano: number, ate: number | undefined, grupo: string) =>
    (await api.get<{ data: Resultados }>("/proxy/relatorios/resultados", { params: { ...periodo(ano, ate), visao: "sem_centros", grupo } })).data.data,
  /** As linhas (26/10/2026): a lista e a DRE de uma, ou só o rateado dela (`rateios`: a aba Rateios das Linhas). */
  linhas: async (ano: number, ate: number | undefined) =>
    (await api.get<{ data: LinhasResultados }>("/proxy/relatorios/resultados", { params: { ...periodo(ano, ate), visao: "linhas" } })).data.data,
  linha: async (ano: number, ate: number | undefined, linha: string, rateios: boolean) =>
    (await api.get<{ data: ResultadosDaLinha }>("/proxy/relatorios/resultados", { params: { ...periodo(ano, ate), visao: rateios ? "rateios_linhas" : "linhas", linha } })).data.data,
  obras: async (ano: number, ate: number | undefined) =>
    (await api.get<{ data: ObrasResultados }>("/proxy/relatorios/resultados", { params: { ...periodo(ano, ate), visao: "obras" } })).data.data,
  obra: async (ano: number, ate: number | undefined, obra: string) =>
    (await api.get<{ data: Resultados }>("/proxy/relatorios/resultados", { params: { ...periodo(ano, ate), visao: "obras", obra } })).data.data,
  centro: async (ano: number, ate: number | undefined, grupo: string) =>
    (await api.get<{ data: Resultados }>("/proxy/relatorios/resultados", { params: { ...periodo(ano, ate), visao: "centros", grupo } })).data.data,
  /** A aba Impostos (Créditos de Impostos, 03/11/2026): os créditos de impostos de cada mês fechado do exercício. */
  impostos: async (ano: number, ate: number | undefined) =>
    (await api.get<{ data: CreditosDosMeses }>("/proxy/relatorios/resultados/impostos", { params: periodo(ano, ate) })).data.data,
  /** `etapa`: a etapa Indicadores do Fechamento Mensal, que vê o mês aberto; sem ela, só as competências fechadas. */
  indicadores: async (ano: number, ate: number | undefined, etapa = false, comparaCom?: MarcacaoComparavel, prova?: MarcacaoComparavel[]) =>
    (await api.get<{ data: Indicadores }>("/proxy/relatorios/indicadores", { params: { ...periodo(ano, ate), ...(etapa ? { etapa: 1 } : {}), ...comparado(comparaCom), ...comProva(prova) } })).data.data,
  painel: async (ano: number, ate: number | undefined, comparaCom?: MarcacaoComparavel, prova?: MarcacaoComparavel[]) =>
    (await api.get<{ data: Painel }>("/proxy/relatorios/painel", { params: { ...periodo(ano, ate), ...comparado(comparaCom), ...comProva(prova) } })).data.data,
};

export function mensagemDeErro(error: unknown, padrao: string) {
  return (error as { response?: { data?: { error?: string } } }).response?.data?.error ?? padrao;
}

// signDisplay "negative": o que arredonda para zero sai sem o sinal ("0", e não "-0").
const numero = (casas: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas, signDisplay: "negative" });
const n0 = numero(0);
const n1 = numero(1);
const n2 = numero(2);

/** Os formatos dos relatórios, como nas planilhas: valores com duas casas, sem o símbolo da moeda (a tabela é larga). */
export const formato = {
  valor: (v: number) => n2.format(v),
  pct: (v: number) => `${n1.format(v * 100)}%`,
  inteiro: (v: number) => n0.format(v),
  umaCasa: (v: number) => n1.format(v),
};

/**
 * A escala do gráfico na unidade do indicador (22/10/2026): os percentuais em %, o R$ M em milhões e o R$ K em milhares
 * (como os valores aparecem).
 */
export const fatorDaEscalaDa = (unidade: string) => (unidade === "%" ? 100 : unidade === "R$ M" ? 1e-6 : unidade === "R$ K" ? 1e-3 : 1);
