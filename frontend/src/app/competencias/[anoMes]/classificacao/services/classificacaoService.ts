import { api } from "@/lib/api";

import type { StatusCompetencia } from "../../../services/competenciasService";

export type Validacao =
  | "OK"
  | "ERRO_PARAMETRIZACAO"
  | "ERRO_DEPARTAMENTO"
  | "ERRO_ATRIBUICAO"
  | "SEM_DESTINO"
  | "CENTRO_NAO_CADASTRADO"
  | "SEM_ABA";

export type Situacao = "PENDENCIAS" | "TODOS" | Validacao;

type Conta = {
  reduzido: string;
  descricao: string;
  departamento: string | null;
  atribuicao: string | null;
  /** Sem Resultado na Linha do DRE (13/11/2026): o lançamento fica fora da DRE, sem pendência. */
  semResultado?: boolean;
};

export type LancamentoClassificado = {
  id: string;
  filial: number;
  linhaArquivo: number;
  codigoCentroCusto: string | null;
  nomeCentroCusto: string | null;
  valorMovimento: string;
  validacao: Validacao;
  balde: string | null;
  alocacao: "DIRETO" | "RATEIO" | null;
  etiqueta: string | null;
  reclassificado: boolean;
  centroCusto: {
    nomeRM: string;
    departamento: string | null;
    atribuicao: "DIRETA" | "INDIRETA" | null;
  } | null;
  contaResultado: Conta;
  contaAdotada: Conta | null;
  linhaDRE: { codigo: string; descricao: string } | null;
};

type Competencia = { id: string; ano: number; mes: number; status: StatusCompetencia };

export type ResumoClassificacao = {
  competencia: Competencia;
  total: number;
  pendentes: number;
  reclassificados: number;
  naoClassificados: number;
  classificadoEm: string | null;
  porValidacao: Array<{ validacao: Validacao; lancamentos: number; valor: string }>;
};

export type PaginaLancamentos = {
  competencia: Competencia;
  itens: LancamentoClassificado[];
  total: number;
  pagina: number;
  porPagina: number;
};

export const classificacaoService = {
  resumo: async (anoMes: string): Promise<ResumoClassificacao> => {
    const { data } = await api.get<{ data: ResumoClassificacao }>(
      `/proxy/competencias/${anoMes}/classificacao`,
    );
    return data.data;
  },

  lancamentos: async (
    anoMes: string,
    parametros: { situacao: Situacao; busca?: string; pagina: number; porPagina: number },
  ): Promise<PaginaLancamentos> => {
    const { data } = await api.get<{ data: PaginaLancamentos }>(
      `/proxy/competencias/${anoMes}/classificacao/lancamentos`,
      { params: parametros },
    );
    return data.data;
  },

  reclassificar: async (anoMes: string) => {
    const { data } = await api.post<{
      data: { lancamentos: number; reclassificados: number; duracaoMs: number };
    }>(`/proxy/competencias/${anoMes}/classificacao`);
    return data.data;
  },
};
