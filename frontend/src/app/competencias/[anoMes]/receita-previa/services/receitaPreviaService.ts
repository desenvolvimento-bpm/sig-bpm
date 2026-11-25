import { api } from "@/lib/api";

import type { StatusCompetencia } from "../../../services/competenciasService";
import { nomeDaUnidade } from "@/lib/nomesDasUnidades";

export type Natureza = "PRE_FABRICADO" | "FRETE" | "DEVOLUCOES_INVENTARIOS" | "MONTAGEM" | "COMPLEMENTAR";
export type Componente = "BRUTA" | "LIQUIDA" | "VARIACAO_ESTOQUE";
export type Venda = "GLOBAL" | "MERCANTIL";

export type ReceitaNatureza = {
  unidade: number;
  unidadeNome: string;
  natureza: Natureza;
  receitaBruta: string;
  impostos: string;
  receitaLiquida: string;
  variacaoEstoque: string;
  itens: number;
  precos: number;
};

export type ReceitaPrevia = {
  competencia: { ano: number; mes: number; status: StatusCompetencia };
  apuradoEm: string | null;
  congelado: boolean;
  receitas: ReceitaNatureza[];
  /** Matriz e Filial: as receitas de cada natureza separadas em venda global e mercantil. */
  porVenda: Array<{
    unidade: number;
    natureza: Natureza;
    global: { receitaBruta: string; receitaLiquida: string };
    mercantil: { receitaBruta: string; receitaLiquida: string };
  }>;
  /** Os impostos abertos por unidade (em Obras, só PIS/COFINS e ISS). */
  impostos: Array<{ unidade: number; pisCofinsGlobal: string; pisCofinsMercantil: string; iss: string; icms: string }>;
  criterios: Array<{ criterio: string; origem: string; itens: number }>;
  observacoes: Array<{ observacao: string; itens: number }>;
  /** Só na resposta da apuração. */
  avisos?: string[];
};

export type ItemReceita = {
  id: string;
  origem: string;
  obra: string | null;
  obraNome: string | null;
  /** Peça da estaca, movimento ou tipo de faturamento. */
  detalhe: string | null;
  /** Descrição do movimento das saídas e devoluções. */
  detalheDescricao: string | null;
  linha: string | null;
  quantidade: string | null;
  criterio: string;
  precoBruto: string | null;
  precoLiquido: string | null;
  receitaBruta: string;
  receitaLiquida: string;
  variacaoEstoque: string;
  observacao: string | null;
  venda: Venda | null;
};

export type PaginaItens = { itens: ItemReceita[]; total: number; pagina: number; porPagina: number };

export type LancamentoReceita = {
  id: string;
  unidade: number;
  unidadeNome: string;
  natureza: Natureza;
  componente: Componente;
  valor: string;
  observacao: string;
  venda: Venda | null;
  atualizadoEm: string;
};

export type LancamentoReceitaEntrada = {
  unidade: number;
  natureza: Natureza;
  componente: Componente;
  valor: string;
  observacao: string;
  venda: Venda | null;
};

export type OpcoesLancamentoReceita = {
  linhasPorUnidade: Record<string, Array<{ natureza: Natureza; componentes: Componente[] }>>;
};

export const receitaPreviaService = {
  consultar: async (anoMes: string): Promise<ReceitaPrevia> => {
    const { data } = await api.get<{ data: ReceitaPrevia }>(`/proxy/competencias/${anoMes}/receita-previa`);
    return data.data;
  },
  apurar: async (anoMes: string): Promise<ReceitaPrevia> => {
    const { data } = await api.post<{ data: ReceitaPrevia }>(`/proxy/competencias/${anoMes}/receita-previa/apurar`);
    return data.data;
  },
  /** Todos os itens da memória de cálculo da linha, para filtrar e ordenar no modal. */
  itens: async (anoMes: string, unidade: number, natureza: Natureza): Promise<PaginaItens> => {
    const { data } = await api.get<{ data: PaginaItens }>(`/proxy/competencias/${anoMes}/receita-previa/itens`, {
      params: { unidade, natureza, pagina: 1, porPagina: 20000 },
    });
    return data.data;
  },
  lancamentos: async (anoMes: string): Promise<{ itens: LancamentoReceita[] }> => {
    const { data } = await api.get<{ data: { itens: LancamentoReceita[] } }>(
      `/proxy/competencias/${anoMes}/receita-previa/lancamentos`,
    );
    return data.data;
  },
  opcoes: async (): Promise<OpcoesLancamentoReceita> => {
    const { data } = await api.get<{ data: OpcoesLancamentoReceita }>("/proxy/lancamentos-receita/opcoes");
    return data.data;
  },
  criarLancamento: async (anoMes: string, e: LancamentoReceitaEntrada) => {
    const { data } = await api.post<{ data: LancamentoReceita }>(`/proxy/competencias/${anoMes}/receita-previa/lancamentos`, e);
    return data.data;
  },
  atualizarLancamento: async (id: string, e: LancamentoReceitaEntrada) => {
    const { data } = await api.put<{ data: LancamentoReceita }>(`/proxy/lancamentos-receita/${id}`, e);
    return data.data;
  },
  excluirLancamento: async (id: string) => {
    await api.delete(`/proxy/lancamentos-receita/${id}`);
  },
};

export const ROTULO_VENDA: Record<Venda, string> = { GLOBAL: "Global", MERCANTIL: "Mercantil" };

/** Matriz e Filial separam as receitas em venda global e mercantil; Obras e a variação do estoque, não. */
export const pedeVenda = (unidade: number, componente: Componente) => (unidade === 1 || unidade === 2) && componente !== "VARIACAO_ESTOQUE";

/** O nome das unidades no cadastro na hora de mostrar (25/11/2026: muda a qualquer momento; a tela usa useNomesDasUnidades). */
export const ROTULO_UNIDADE: Record<number, string> = {
  get 1() {
    return nomeDaUnidade(1);
  },
  get 2() {
    return nomeDaUnidade(2);
  },
  get 3() {
    return nomeDaUnidade(3);
  },
};

export const ROTULO_NATUREZA: Record<Natureza, string> = {
  PRE_FABRICADO: "Pré-fabricado",
  FRETE: "Frete",
  DEVOLUCOES_INVENTARIOS: "Devoluções e inventários",
  MONTAGEM: "Montagem",
  COMPLEMENTAR: "Complementar",
};

/** Rótulos das linhas da aba Receitas (Prévia), por natureza. */
export const ROTULO_LINHA: Record<Natureza, { bruta: string; liquida: string }> = {
  PRE_FABRICADO: { bruta: "Receita Bruta do Pré-Fabricado", liquida: "Receita Líquida do Pré-Fabricado" },
  FRETE: { bruta: "Receita Bruta de Frete", liquida: "Receita Líquida de Frete" },
  DEVOLUCOES_INVENTARIOS: { bruta: "Receita Bruta de Devoluções e Inventários", liquida: "Receita Líquida de Devoluções e Inventários" },
  MONTAGEM: { bruta: "Receita Bruta de Montagem", liquida: "Receita Líquida de Montagem" },
  COMPLEMENTAR: { bruta: "Receita Bruta Complementar", liquida: "Receita Líquida Complementar" },
};

export function rotuloLancamento(natureza: Natureza, componente: Componente) {
  if (componente === "VARIACAO_ESTOQUE") return "Variação do Estoque";
  return componente === "BRUTA" ? ROTULO_LINHA[natureza].bruta : ROTULO_LINHA[natureza].liquida;
}

/** Como o volume foi valorado: o preço do contrato ou o preço padrão (obra genérica, sem contrato ou linha × unidade). */
export const ROTULO_CRITERIO: Record<string, string> = {
  CONTRATO: "Contrato",
  SEM_CONTRATO: "Padrão",
  GENERICA: "Padrão",
  LINHA_INCONSISTENTE: "Padrão",
  TABELA_ESTACA: "Tabela de estacas",
  NOTA_FISCAL: "Nota fiscal",
  MEDICAO: "Medição",
  LANCAMENTO: "Lançamento manual",
};

/**
 * Os agrupamentos da memória de cálculo, com os nomes das abas de receita do
 * BASE PRÉVIAS (RECEITAS E ESTOQUE), na ordem delas.
 */
export const GRUPOS_ORIGEM: Array<{ origem: string; rotulo: string }> = [
  { origem: "PRODUCAO", rotulo: "Produção" },
  { origem: "EXPEDICAO", rotulo: "Expedição" },
  { origem: "SAIDA", rotulo: "Saídas" },
  { origem: "DEVOLUCAO", rotulo: "Devoluções" },
  { origem: "MEDICAO", rotulo: "Serviços" },
  { origem: "LANCAMENTO", rotulo: "Lanç. Manuais" },
];

export const ROTULO_ORIGEM: Record<string, string> = {
  PRODUCAO: "Produção",
  EXPEDICAO: "Expedição",
  SAIDA: "Saída",
  DEVOLUCAO: "Devolução",
  MEDICAO: "Medição",
  LANCAMENTO: "Lançamento",
};

export function mensagemDeErro(error: unknown, padrao: string) {
  return (error as { response?: { data?: { error?: string } } }).response?.data?.error ?? padrao;
}
