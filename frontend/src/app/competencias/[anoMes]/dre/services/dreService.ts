import { api } from "@/lib/api";

import type { StatusCompetencia } from "../../../services/competenciasService";

/** `competencia`: a parcela dos lançamentos manuais com os percentuais de outra competência (MM/AAAA, 30/10/2026). */
export type ParcelaRateio = { chave: string; destino: string; base: string; percentual: string; valor: string; competencia?: string };
export type ParcelaUnidade = { unidade: number; nome: string; valor: string };
export type ParcelaCentro = { codigoRM: string | null; nome: string; valor: string };
export type Composicao = {
  regra: string;
  direto?: string;
  rateios?: ParcelaRateio[];
  unidades?: ParcelaUnidade[];
  centros?: ParcelaCentro[];
  observacao?: string;
};

export type LinhaDRE = {
  codigo: string;
  tipo: "SECAO" | "ITEM" | "SUBTOTAL" | "TOTAL";
  grupo: string;
  grupoSigla: string;
  descricao: string;
  valor: string | null;
  composicao: Composicao | null;
  /** O usuário alcança as movimentações desta linha (recorte por departamento). */
  podeDetalhar?: boolean;
};

export type DREUnidade = {
  competencia: { ano: number; mes: number; status: StatusCompetencia };
  unidade?: number;
  apuradoEm: string | null;
  congelado: boolean;
  linhas: LinhaDRE[];
};

export type DRECentros = DREUnidade & { grupo: string; centros: Array<{ codigoRM: string | null; nome: string }> };

export type GruposCentros = {
  competencia: { ano: number; mes: number; status: StatusCompetencia };
  apuradoEm: string | null;
  grupos: Array<{ grupo: string; departamentos: string[]; centros: number; total: string }>;
};

/** As obras com lançamento no mês (os centros de obra do RM, 1.98 e 1.99), com o resultado de cada uma. */
export type ObrasDaDRE = {
  competencia: { ano: number; mes: number; status: StatusCompetencia };
  apuradoEm: string | null;
  obras: Array<{ codigo: string; nome: string; total: string }>;
};
export type DREObra = DREUnidade & { obra: { codigo: string; nome: string } };
/** Os grupos dos movimentos sem centro de custo no mês (15/10/2026), com o total de cada um. */
export type SemCentrosDaDRE = {
  competencia: { ano: number; mes: number; status: StatusCompetencia };
  apuradoEm: string | null;
  grupos: Array<{ codigo: string; nome: string; total: string }>;
};
export type DRESemCentro = DREUnidade & { grupo: { codigo: string; nome: string } };

export type LancamentoDetalhe = {
  id: string;
  filial: number;
  centro: { codigoRM: string | null; nome: string | null } | null;
  conta: { reduzido: string; descricao: string };
  contaAdotada: { reduzido: string; descricao: string } | null;
  balde: string | null;
  alocacao: string | null;
  descricao?: string;
  valor: string;
  parcela: string;
  /** O centro do balancete, quando o que vale é outro (uma contestação; 27/10/2026). */
  centroOriginal?: { codigoRM: string | null; nome: string | null } | null;
  /** A contestação aplicada no lançamento: o número e o que ela mudou (o centro, a conta). */
  contestacao?: { numero: number; centro: boolean; conta: boolean } | null;
};

/** A situação de uma contestação (27/10/2026). */
export type SituacaoContestacao = "PENDENTE" | "ACATADA" | "RECUSADA" | "VALIDADA";

/** Um item de requisição ou de nota fiscal do mês (abas Requisições (Lista) e Notas Fiscais (Lista)). */
/** Um movimento do balancete detalhado (15/10/2026): o cliente ou fornecedor, a emissão e o histórico. */
export type MovimentoDoBalancete = {
  id: string;
  filial: number;
  codigoCentroCusto: string | null;
  nomeCentroCusto: string | null;
  cliForn: string | null;
  emissao: string | null;
  historico: string | null;
  /** O ID do movimento no RM (10/11/2026, a coluna ID do Balancete (Lista)) e quantos itens ele tem nas listas importadas. */
  idMovimento: string | null;
  itens: number;
  valor: string;
  /** O centro do balancete, quando o que vale é outro (a contestação; 27/10/2026), e a conta que vale na DRE, quando é outra. */
  centroOriginal: { codigoRM: string | null; nome: string | null } | null;
  contaNaDRE: { reduzido: string; descricao: string } | null;
  /** A contestação aplicada no movimento (o número e o que mudou) e a última contestação dele (a situação). */
  contestacaoAplicada: { numero: number; centro: boolean; conta: boolean } | null;
  contestacao: { numero: number; situacao: SituacaoContestacao } | null;
  /** O reflexo de um rateio (30/10/2026): o movimento é de outra linha da DRE (a de origem) e chega a esta pelo rateio. */
  rateioDe: { linha: string; grupo: string } | null;
};
/** Os itens de um movimento (10/11/2026): os das requisições e os das notas fiscais com o ID dele (o IDENTIFICADOR das listas). */
export type ItemDaRequisicao = {
  id: string;
  competencia: string;
  tipoMovimento: string | null;
  nomeTipoMovimento: string | null;
  data: string | null;
  filial: number | null;
  codigoCentroCusto: string | null;
  nomeCentroCusto: string | null;
  projeto: string | null;
  contaContabil: string;
  descricaoConta: string | null;
  codigoProduto: string | null;
  descricaoItem: string | null;
  quantidade: string | null;
  valorUnitario: string | null;
  valorTotal: string;
};
export type ItemDaNotaFiscal = Omit<ItemDaRequisicao, "valorUnitario"> & {
  numero: string | null;
  fornecedor: string | null;
  subtotal: string | null;
  desconto: string | null;
  cfop: string | null;
};
export type ItensDoMovimento = { id: string; requisicoes: ItemDaRequisicao[]; notas: ItemDaNotaFiscal[] };

/** O balancete de uma conta no mês (15/10/2026; antes, as requisições e as notas fiscais). */
export type BalanceteDaConta = {
  conta: { reduzido: string; descricao: string };
  /** O balancete do mês é o detalhado (sem ele, cada linha é a soma da filial, do centro e da conta). */
  detalhado: boolean;
  linhas: MovimentoDoBalancete[];
};

export type BlocoDetalhe =
  | {
      tipo: "CONTABIL" | "RATEIO" | "MANUAL";
      titulo: string;
      unidade?: number;
      filtro: string;
      fator?: string;
      percentual?: string;
      total: string;
      lancamentos: LancamentoDetalhe[];
    }
  // `obra` (03/11/2026): a receita prévia de uma obra (o número), na aba Obras; a memória de cálculo abre só com ela.
  | { tipo: "PREVIA"; titulo: string; unidade: number; natureza: string; componente: string; sinal: number; total: string; obra?: string };

export type DetalheDRE = {
  competencia: { ano: number; mes: number };
  visao: string;
  linha: { codigo: string; descricao: string; tipo: LinhaDRE["tipo"] };
  valor: string | null;
  regra: string | null;
  observacao: string | null;
  somaOrigens: string | null;
  blocos: BlocoDetalhe[];
};

/** Em que visão o detalhamento é pedido: uma unidade, o consolidado, um agrupamento de centros ou uma obra. */
export type VisaoDetalhe = { unidade: number } | { consolidado: true } | { grupo: string } | { obra: string } | { semCentro: string };

/** Uma linha do extrato das listas de uma linha de volume: os registros da obra somados. */
export type LinhaVolume = {
  obra: string | null;
  obraNome: string | null;
  /** A linha da aba Totais em que os registros entram, ex.: "(P) Pré-Fabricado: Matriz". */
  destino: string;
  linha: string | null;
  quantidade: string;
  registros: number;
};
export type VolumesDaLinha = { linha: string; medida: string | null; destinos: string[]; total: string; linhas: LinhaVolume[] };

/** Os parâmetros do detalhamento: a linha e a visão (a unidade, o centro, a obra ou o grupo sem centro; nenhum, o consolidado). */
const paramsDoDetalhe = (linha: string, visao: VisaoDetalhe) => ({
  linha,
  ...("unidade" in visao
    ? { unidade: visao.unidade }
    : "grupo" in visao
      ? { grupo: visao.grupo }
      : "obra" in visao
        ? { obra: visao.obra }
        : "semCentro" in visao
          ? { semCentro: visao.semCentro }
          : {}),
});

export const dreService = {
  /** As requisições e as notas fiscais de uma conta no mês (o extrato de uma conta): a linha (o recorte), a conta e, quando vêm, o centro e a filial. */
  /** O balancete de uma conta no mês (15/10/2026; antes, as requisições e as notas fiscais). */
  balancete: async (anoMes: string, filtro: { linha: string; conta: string; centro?: string | null; filial?: number | null; adotada?: string | null }): Promise<BalanceteDaConta> => {
    const params = {
      linha: filtro.linha,
      conta: filtro.conta,
      ...(filtro.centro ? { centro: filtro.centro } : {}),
      ...(filtro.filial ? { filial: filtro.filial } : {}),
      // A conta que vale na DRE (27/10/2026), no balancete do lançamento.
      ...(filtro.adotada ? { adotada: filtro.adotada } : {}),
    };
    const { data } = await api.get<{ data: BalanceteDaConta }>(`/proxy/competencias/${anoMes}/dre/documentos`, { params });
    return data.data;
  },

  /** Os itens de um movimento do balancete (10/11/2026), no recorte do modal Balancete. */
  itensDoMovimento: async (anoMes: string, filtro: { linha: string; conta: string; centro?: string | null; filial?: number | null; adotada?: string | null }, lancamento: string): Promise<ItensDoMovimento> => {
    const params = {
      linha: filtro.linha,
      conta: filtro.conta,
      ...(filtro.centro ? { centro: filtro.centro } : {}),
      ...(filtro.filial ? { filial: filtro.filial } : {}),
      ...(filtro.adotada ? { adotada: filtro.adotada } : {}),
      lancamento,
    };
    const { data } = await api.get<{ data: ItensDoMovimento }>(`/proxy/competencias/${anoMes}/dre/documentos/itens`, { params });
    return data.data;
  },

  detalhe: async (anoMes: string, linha: string, visao: VisaoDetalhe): Promise<DetalheDRE> => {
    const { data } = await api.get<{ data: DetalheDRE }>(`/proxy/competencias/${anoMes}/dre/detalhe`, { params: paramsDoDetalhe(linha, visao) });
    return data.data;
  },
  /**
   * O extrato em Excel (24/10/2026): as abas Movimentações e Detalhes. Com `recorte` (o modal Balancete), só a conta do
   * balancete e, quando vêm, o centro e a filial do lançamento.
   */
  exportarExtrato: (anoMes: string, linha: string, visao: VisaoDetalhe, recorte?: { conta: string; centro?: string | null; filial?: number | null }) =>
    api.get<Blob>(`/proxy/competencias/${anoMes}/dre/detalhe/exportar`, {
      params: {
        ...paramsDoDetalhe(linha, visao),
        ...(recorte ? { conta: recorte.conta, ...(recorte.centro ? { centro: recorte.centro } : {}), ...(recorte.filial ? { filial: recorte.filial } : {}) } : {}),
      },
      responseType: "blob",
    }),
  /**
   * As listas que formam uma linha de volume (Produção, Expedição…), por obra; sem unidade, o consolidado; com a obra, só as
   * dela; com as obras (os códigos de uma venda), só as delas.
   */
  volumes: async (anoMes: string, linha: string, unidade?: number, obra?: string, obras?: string[]): Promise<VolumesDaLinha> => {
    const { data } = await api.get<{ data: VolumesDaLinha }>(`/proxy/competencias/${anoMes}/dre/volumes`, { params: { linha, unidade, obra, obras: obras?.join(",") } });
    return data.data;
  },
  consolidado: async (anoMes: string): Promise<DREUnidade> => {
    const { data } = await api.get<{ data: DREUnidade }>(`/proxy/competencias/${anoMes}/dre/consolidado`);
    return data.data;
  },
  grupos: async (anoMes: string): Promise<GruposCentros> => {
    const { data } = await api.get<{ data: GruposCentros }>(`/proxy/competencias/${anoMes}/dre/centros`);
    return data.data;
  },
  centros: async (anoMes: string, grupo: string): Promise<DRECentros> => {
    const { data } = await api.get<{ data: DRECentros }>(`/proxy/competencias/${anoMes}/dre/centros`, { params: { grupo } });
    return data.data;
  },
  obras: async (anoMes: string): Promise<ObrasDaDRE> => {
    const { data } = await api.get<{ data: ObrasDaDRE }>(`/proxy/competencias/${anoMes}/dre/obras`);
    return data.data;
  },
  obra: async (anoMes: string, obra: string): Promise<DREObra> => {
    const { data } = await api.get<{ data: DREObra }>(`/proxy/competencias/${anoMes}/dre/obras`, { params: { obra } });
    return data.data;
  },
  semCentros: async (anoMes: string): Promise<SemCentrosDaDRE> => {
    const { data } = await api.get<{ data: SemCentrosDaDRE }>(`/proxy/competencias/${anoMes}/dre/sem-centros`);
    return data.data;
  },
  semCentro: async (anoMes: string, grupo: string): Promise<DRESemCentro> => {
    const { data } = await api.get<{ data: DRESemCentro }>(`/proxy/competencias/${anoMes}/dre/sem-centros`, { params: { grupo } });
    return data.data;
  },
  consultar: async (anoMes: string, unidade: number): Promise<DREUnidade> => {
    const { data } = await api.get<{ data: DREUnidade }>(`/proxy/competencias/${anoMes}/dre`, { params: { unidade } });
    return data.data;
  },
  apurar: async (anoMes: string): Promise<{ resultados: number; consolidado: number; centros: number; avisos: string[] }> => {
    const { data } = await api.post<{ data: { resultados: number; consolidado: number; centros: number; avisos: string[] } }>(`/proxy/competencias/${anoMes}/dre/apurar`);
    return data.data;
  },
};

export const UNIDADES = [
  { codigo: 1, nome: "Matriz" },
  { codigo: 2, nome: "Filial" },
  { codigo: 3, nome: "Serviços" },
  { codigo: 4, nome: "Despesas e Extra" },
  { codigo: 5, nome: "RN" },
];

export const ROTULO_CHAVE: Record<string, string> = {
  PROJETO: "Projetos",
  PRODUCAO: "Produção",
  METALURGIA: "Metalurgia",
  ARMADURA: "Armadura",
  ACOMPANHAMENTO: "Acompanhamento",
};

export function mensagemDeErro(error: unknown, padrao: string) {
  return (error as { response?: { data?: { error?: string } } }).response?.data?.error ?? padrao;
}
