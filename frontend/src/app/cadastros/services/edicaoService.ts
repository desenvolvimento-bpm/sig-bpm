import { api } from "@/lib/api";

/**
 * Uma opção de lista; `grupos`: os valores do campo `filtradoPor` em que ela aparece. `chave`: liga as opções
 * equivalentes de grupos diferentes — ao trocar o filtro, a lista fica com a equivalente (24/10/2026).
 */
export type Opcao = { valor: string; rotulo: string; grupos?: string[]; chave?: string };
/** Uma correção que o formulário aplica com um clique (24/10/2026: as combinações de linha e rateio de uma conta). */
export type Sugestao = { rotulo: string; detalhe?: string; valores: Record<string, unknown> };
export type Campo = {
  nome: string;
  rotulo: string;
  /** O rótulo curto no cabeçalho da tabela, quando o do formulário é longo demais. */
  rotuloColuna?: string;
  /** "formula": a fórmula de um indicador, montada com os itens das opções (Estrutura dos Indicadores). */
  tipo: "texto" | "inteiro" | "decimal" | "booleano" | "data" | "opcao" | "multipla" | "formula";
  obrigatorio?: boolean;
  somenteNaCriacao?: boolean;
  derivado?: boolean;
  /** Informação-chave: não muda quando o registro tem movimentos. */
  travaComMovimento?: boolean;
  /** A lista mostra só as opções do valor escolhido neste outro campo. */
  filtradoPor?: string;
  /** Ocupa as duas colunas do formulário de edição. */
  larguraInteira?: boolean;
  /** Um texto longo, em várias linhas (06/11/2026). */
  multilinha?: boolean;
  /** Uma coluna estreita na tabela (a ordem e o código). */
  estreita?: boolean;
  /** Um valor em reais: "R$" e duas casas na tabela, duas casas no formulário. */
  moeda?: boolean;
  /** Fora da tabela (só no formulário) ou fora do formulário (só na tabela). */
  naTabela?: boolean;
  noFormulario?: boolean;
  /** No formulário, só aparece com um destes valores no outro campo. */
  visivelSe?: { campo: string; valores: string[] };
  /** O valor num registro novo (sem ele, as caixas de marcar começam marcadas). */
  padrao?: unknown;
  ajuda?: string;
  /** A ajuda ao lado do campo, e não embaixo (21/10/2026). */
  ajudaAoLado?: boolean;
  opcoes?: Opcao[];
};
export type DefinicaoCadastro = { entidade: string; titulo: string; criar: boolean; excluir: boolean; reclassifica: boolean; campos: Campo[]; explicacao?: string | null };
/** As travas do registro: com movimentos, os campos-chave não mudam e a exclusão é recusada (11/10/2026). */
export type Travas = { movimentos: string | null; campos: string[]; exclusao: string | null };
export type Registro = Record<string, unknown> & { id: string; __travas?: Travas };
/** O efeito de uma alteração que classifica: o que foi reclassificado e o que precisa ser reapurado. */
export type Efeito = { reclassificadas: string[]; apuradasPorReapurar: string[] };

const base = (entidade: string) => `/proxy/cadastros/edicao/${entidade}`;

export const edicaoService = {
  definicao: async (entidade: string): Promise<DefinicaoCadastro> => (await api.get<{ data: DefinicaoCadastro }>(`${base(entidade)}/definicao`)).data.data,
  listar: async (entidade: string, busca?: string): Promise<Registro[]> => (await api.get<{ data: Registro[] }>(base(entidade), { params: busca ? { busca } : {} })).data.data,
  ler: async (entidade: string, id: string): Promise<Registro> => (await api.get<{ data: Registro }>(`${base(entidade)}/${id}`)).data.data,
  criar: async (entidade: string, valores: Record<string, unknown>) => (await api.post<{ data: { registro: Registro } & Efeito }>(base(entidade), valores)).data.data,
  atualizar: async (entidade: string, id: string, valores: Record<string, unknown>) =>
    (await api.put<{ data: { registro: Registro } & Efeito }>(`${base(entidade)}/${id}`, valores)).data.data,
  excluir: async (entidade: string, id: string) => (await api.delete<{ data: Efeito }>(`${base(entidade)}/${id}`)).data.data,
};

export function mensagemDeErro(error: unknown, padrao: string) {
  return (error as { response?: { data?: { error?: string } } }).response?.data?.error ?? padrao;
}

/** As correções que o backend propõe junto da recusa, quando há. */
export function sugestoesDoErro(error: unknown): Sugestao[] {
  return (error as { response?: { data?: { sugestoes?: Sugestao[] } } }).response?.data?.sugestoes ?? [];
}

/** O aviso depois de gravar um cadastro que classifica ou um Cadastro da Controladoria (17/10/2026: pede reapurar). */
export function textoDoEfeito(e: Efeito) {
  const partes = [];
  if (e.reclassificadas.length) partes.push(`Reclassificadas: ${e.reclassificadas.join(", ")}.`);
  if (e.apuradasPorReapurar.length) partes.push(`Reapure antes de fechar: ${e.apuradasPorReapurar.join(", ")}.`);
  return partes.join(" ");
}
