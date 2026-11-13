import { api } from "@/lib/api";

/**
 * Leitura dos cadastros. Passa pelo BFF do Next (`/api/proxy/...`), nunca
 * direto no Express — regra de ouro do CONVENTIONS.md.
 */

export type PaginaCadastro<T> = {
  itens: T[];
  total: number;
  pagina: number;
  porPagina: number;
};

export type CentroCusto = {
  id: string;
  codigoRM: string | null;
  nomeRM: string;
  nomeControladoria: string | null;
  departamento: string | null;
  departamentoSigla: string | null;
  atribuicao: "DIRETA" | "INDIRETA" | null;
  atribuicaoSigla: string | null;
  balde: string | null;
  ativo: boolean;
};

export type ContaResultado = {
  id: string;
  reduzido: string;
  conta: string;
  descricao: string;
  tipoConta: "SINTETICA" | "ANALITICA";
  departamento: string | null;
  atribuicao: string | null;
  balde: string | null;
  ativo: boolean;
  linhaDRE: { codigo: string; descricao: string } | null;
};

export type LinhaDRE = {
  id: string;
  codigo: string;
  ordem: number;
  grupo: string;
  grupoSigla: string;
  atribuicao: string | null;
  atribuicaoSigla: string | null;
  descricao: string;
  tipo: "SECAO" | "ITEM" | "SUBTOTAL" | "TOTAL";
  expressao: string | null;
  definicao: string | null;
  ativo: boolean;
  unidades: { unidadeNegocio: { nome: string } }[];
  _count: { contas: number };
};

/** Conta vista pela verificação do lançamento: código, nome e parâmetros. */
export type ContaResumida = {
  reduzido: string;
  descricao: string;
  departamento: string | null;
  atribuicao: string | null;
};

export type Reclassificacao = {
  id: string;
  codigoCentroCusto: string;
  motivo: string | null;
  ativo: boolean;
  contaOrigem: ContaResumida;
  contaDestino: ContaResumida;
  centro: {
    nomeRM: string;
    departamento: string | null;
    atribuicao: "DIRETA" | "INDIRETA" | null;
  } | null;
};

/** A reclassificação por fornecedor (13/11/2026): o fornecedor, o centro imperativo e os movimentos dele, abertos e fechados. */
export type ReclassificacaoFornecedor = {
  id: string;
  fornecedor: string;
  motivo: string | null;
  ativo: boolean;
  centroCusto: {
    codigoRM: string | null;
    nomeRM: string;
    departamento: string | null;
    atribuicao: "DIRETA" | "INDIRETA" | null;
    ativo: boolean;
  };
  movimentos: { abertas: number; fechadas: number };
};

export type PrecoContrato = {
  id: string;
  versao: number;
  etapa: string | null;
  linhaTexto: string;
  contaResultado: string;
  departamento: string | null;
  atribuicao: string | null;
  unidade: string | null;
  fornecimento: string | null;
  valorUnitario: string | null;
  valorTotal: string | null;
  percentualRL: string | null;
  vigenteDesde: string;
  substituidoEm: string | null;
  obra: { codigo: string; nome: string; situacaoCadastro: string };
};

export type ResumoCadastros = {
  unidades: number;
  centrosCusto: number;
  contas: number;
  contasVinculadas: number;
  linhas: number;
};

export type ParametrosListagem = {
  busca?: string;
  pagina?: number;
  porPagina?: number;
};

async function listar<T>(
  recurso: string,
  parametros: ParametrosListagem,
): Promise<PaginaCadastro<T>> {
  const { data } = await api.get<{ data: PaginaCadastro<T> }>(
    `/proxy/cadastros/${recurso}`,
    { params: parametros },
  );
  return data.data;
}

export type MudancaCadastro = {
  chave: string;
  rotulo: string;
  campos: Array<{ campo: string; antes: string | null; depois: string | null }>;
};

export type SecaoRecarga = {
  contagem: { novos: number; alterados: number; removidos: number; mantidos: number; iguais: number };
  novos: MudancaCadastro[];
  alterados: MudancaCadastro[];
  removidos: MudancaCadastro[];
  mantidos: MudancaCadastro[];
};

export type PreviaRecarga = {
  hash: string;
  centros: SecaoRecarga;
  contas: SecaoRecarga;
  dre: SecaoRecarga;
  semDestino: string[];
  avisos: Array<{ origem: string; chave: string; motivo: string }>;
  /** O que impede a recarga (a linha da DRE em uso que sairia; a conta que nenhuma aba leria): a confirmação é recusada. */
  bloqueios: string[];
  ajustesObsoletos: string[];
};

export type ResultadoRecarga = {
  centros: number;
  centrosRemovidos: number;
  contas: number;
  linhasDRE: number;
  linhasRemovidas: number;
  contasVinculadas: number;
  reclassificadas: string[];
  /** Competências apuradas: ficam com a classificação da apuração até serem reapuradas. */
  apuradasSemReclassificar: string[];
};

export const cadastrosService = {
  recargaPrevia: async (arquivo: File): Promise<PreviaRecarga> => {
    const { data } = await api.post<{ data: PreviaRecarga }>("/proxy/cadastros/recarga/previa", arquivo, {
      headers: { "Content-Type": "application/octet-stream" },
    });
    return data.data;
  },
  recargaConfirmar: async (hash: string): Promise<ResultadoRecarga> => {
    const { data } = await api.post<{ data: ResultadoRecarga }>("/proxy/cadastros/recarga/confirmar", { hash });
    return data.data;
  },
  resumo: async (): Promise<ResumoCadastros> => {
    const { data } = await api.get<{ data: ResumoCadastros }>(
      "/proxy/cadastros/resumo",
    );
    return data.data;
  },
  centrosCusto: (p: ParametrosListagem) => listar<CentroCusto>("centros-custo", p),
  contasResultado: (p: ParametrosListagem) =>
    listar<ContaResultado>("contas-resultado", p),
  linhasDRE: (p: ParametrosListagem) => listar<LinhaDRE>("linhas-dre", p),
  precosContrato: async (p: ParametrosListagem & { historico: boolean }) => {
    const { data } = await api.get<{ data: PaginaCadastro<PrecoContrato> & { substituidos: number } }>(
      "/proxy/cadastros/precos-contrato",
      { params: { ...p, historico: String(p.historico) } },
    );
    return data.data;
  },
  reclassificacoes: (p: ParametrosListagem) =>
    listar<Reclassificacao>("reclassificacoes", p),
  reclassificacoesFornecedor: (p: ParametrosListagem) =>
    listar<ReclassificacaoFornecedor>("reclassificacoes-fornecedor", p),
};
