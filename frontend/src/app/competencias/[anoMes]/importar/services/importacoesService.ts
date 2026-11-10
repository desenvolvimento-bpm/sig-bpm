import { api } from "@/lib/api";

import type { StatusCompetencia } from "../../../services/competenciasService";

export type StatusImportacao = "PROCESSANDO" | "CONCLUIDA" | "REJEITADA";

export type Importacao = {
  id: string;
  tipo: string;
  nomeArquivo: string;
  importadoEm: string;
  status: StatusImportacao;
  progresso: number;
  linhasLidas: number;
  linhasAceitas: number;
  linhasRejeitadas: number;
  linhasIgnoradas: number;
  motivoRejeicao: string | null;
  substituidaEm: string | null;
  /** Balancete de competência fechada: só comparado com o gravado (Passo 24). */
  comparacao: boolean;
  usuario: { nome: string } | null;
};

export type Rejeicao = {
  linha: number;
  codigo: string;
  mensagem: string;
  filial?: string;
  codigoCentroCusto?: string | null;
  reduzido?: string | null;
  valor?: string;
};

export type CentroSemCadastro = {
  codigo: string;
  nome: string | null;
  obra: boolean;
  linhas: number;
  valor: string;
};

export type ResumoBalancete = {
  aba: string;
  somaArquivo: string;
  totalGeral: string | null;
  valorAceito: string;
  valorRejeitado: string;
  ignoradas: { subtotais: number; semMovimento: number };
  porFilial: Array<{ filial: number; linhas: number; valor: string }>;
  centrosSemCadastro: CentroSemCadastro[];
  substituiu: string[];
  /** Comparação com competência fechada: quantas divergências entraram. */
  modo?: "COMPARACAO";
  divergencias?: number;
  diferenca?: string;
  /** Os outros meses fechados do arquivo, comparados com o gravado. */
  retroativas?: Array<{ competencia: string; divergencias: number; diferenca: string }>;
};

/** Resumo das listas operacionais: volumes pelas linhas da aba Totais. */
export type ResumoLista = {
  aba: string;
  lista: string;
  registros: number;
  ignoradas: { vazias: number; outrosMeses: number; semEfeito?: number };
  totais: Array<{ codigo: string; rotulo: string; medida: string; quantidade: string }>;
  /** Lista da receita prévia: os totais são por unidade, não linhas da Totais. */
  receita?: boolean;
  obrasCriadas: number;
  avisos: string[];
  substituiu: string[];
};

/** Resumo da DRE do Comercial: o que a importação fez com os preços vigentes. */
export type ResumoDreComercial = {
  aba: string;
  obras: number;
  obrasCriadas: number;
  precos: { novos: number; alterados: number; inalterados: number; removidos: number };
  alteracoes: Array<{
    obra: string;
    etapa: string | null;
    linha: string;
    conta: string;
    departamento: string | null;
    antes: { unitario: string | null; total: string | null };
    depois: { unitario: string | null; total: string | null };
  }>;
  removidosExemplos: Array<{ obra: string; etapa: string | null; linha: string; conta: string }>;
  obrasComAditivo: string[];
  /** Obras sem nome que receberam o da aba Pedidos (desde 11/10/2026). */
  obrasNomeadas?: number;
  obrasRepetidas: Array<{ obra: string; linhas: number }>;
  obrasSemContrato: number;
  /** Preços alterados que valoraram receita de meses já apurados: viram divergências. */
  divergencias?: Array<{ competencia: string; obra: string; impacto: string }>;
  /** foraDoFiltro: linhas da DRE que a receita prévia não usa (custos, quantidades…). */
  ignoradas?: { vazias: number; repetidas: number; foraDoFiltro: number };
};

/** Resumo dos indicadores do mês (abas Indicadores (Admin.) e (Comercial)). */
export type ResumoIndicadores = { aba: string; indicadores: Array<{ nome: string; valor: number }> };

/** Resumo do saldo inicial do estoque. */
export type ResumoEstoqueInicial = {
  aba: string;
  saldos: number;
  obrasCriadas: number;
  porLinha: Array<{ linha: string; saldos: number; volume: string; valor: string }>;
};

/**
 * O que a importação em lote faz com um mês da aba: importar, comparar (balancete de mês fechado),
 * nada (sem mudança), só avisar (mês anterior já fechado) ou recusar (estrutura inválida no mês).
 */
export type AcaoMes = "IMPORTAR" | "COMPARAR" | "SEM_MUDANCA" | "FECHADA" | "INVALIDA";
export type MesDaAba = {
  /** aaaa-mm */
  anoMes: string;
  /** O mês da competência em que o arquivo foi enviado. */
  atual: boolean;
  acao: AcaoMes;
  registros?: number;
  mensagem?: string;
  avisos: string[];
  /** Depois de importar: a importação na fila, ou o erro ao pôr na fila. */
  importacaoId?: string;
  erro?: string;
};
/** Uma aba do arquivo do lote: o tipo e, mês a mês, o que fazer com ela. */
export type AbaLote = {
  aba: string;
  tipo: string;
  rotulo: string;
  /** IGNORADA: não se importa (fora do setor, mês fechado…); INVALIDA: estrutura errada. O motivo vai em mensagem. */
  situacao: "ANALISADA" | "IGNORADA" | "INVALIDA";
  mensagem?: string;
  meses: MesDaAba[];
};
export type PreviaLote = { hash: string; nomeArquivo: string; abas: AbaLote[]; outras: string[] };

export type ImportacaoDetalhe = Importacao & {
  hashArquivo: string;
  relatorioErros: Rejeicao[] | null;
  /** ResumoBalancete quando tipo é BALANCETE; ResumoLista nas listas. */
  resumo: ResumoBalancete | ResumoLista | ResumoDreComercial | ResumoEstoqueInicial | ResumoIndicadores | null;
  competencia: { ano: number; mes: number; status: StatusCompetencia };
};

export type ImportacoesDaCompetencia = {
  competencia: { id: string; ano: number; mes: number; status: StatusCompetencia };
  itens: Importacao[];
};

/** Resposta de erro do backend: mensagem pronta e, às vezes, um código. */
export type ErroImportacao = { error?: string; codigo?: string };

export const importacoesService = {
  listar: async (anoMes: string): Promise<ImportacoesDaCompetencia> => {
    const { data } = await api.get<{ data: ImportacoesDaCompetencia }>(
      `/proxy/competencias/${anoMes}/importacoes`,
    );
    return data.data;
  },

  detalhar: async (id: string): Promise<ImportacaoDetalhe> => {
    const { data } = await api.get<{ data: ImportacaoDetalhe }>(
      `/proxy/importacoes/${id}`,
    );
    return data.data;
  },

  /** Importação em lote, passo 1: envia o arquivo e recebe a prévia (nada é importado). Com `tipo`, só a aba dele. */
  analisarLote: async (anoMes: string, arquivo: File, onProgresso?: (percentual: number) => void, tipo?: string): Promise<PreviaLote> => {
    const { data } = await api.post<{ data: PreviaLote }>(`/proxy/competencias/${anoMes}/importacoes/lote/analise`, arquivo, {
      params: { nomeArquivo: arquivo.name, tipo },
      headers: { "Content-Type": "application/octet-stream" },
      onUploadProgress: (e) => {
        if (e.total) onProgresso?.(Math.round((e.loaded / e.total) * 100));
      },
    });
    return data.data;
  },

  /** Importação em lote, passo 2: importa o que a prévia indicou; devolve as importações na fila. */
  importarLote: async (anoMes: string, previa: PreviaLote, reimportar = false, tipo?: string): Promise<PreviaLote> => {
    const { data } = await api.post<{ data: PreviaLote }>(`/proxy/competencias/${anoMes}/importacoes/lote/importar`, {
      hash: previa.hash,
      nomeArquivo: previa.nomeArquivo,
      // Sem nenhuma mudança no arquivo: reimporta o mês do envio assim mesmo.
      reimportar,
      // O da prévia do Importar da linha do tipo: só a aba dele entra.
      tipo,
    });
    return data.data;
  },
};
