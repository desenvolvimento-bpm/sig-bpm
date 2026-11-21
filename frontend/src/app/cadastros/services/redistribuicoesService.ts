import type { CentroDaLupa } from "@/app/contestacoes-de-gastos/components/CentrosDeCustoDialog";
import { api } from "@/lib/api";

/** As Redistribuições de Gastos (13/11/2026): Cadastros Gerais / Controladoria / Redistribuições de Gastos. */
export type Redistribuicao = {
  id: string;
  departamentoId: string | null;
  /** O departamento e a unidade; nulo = Todos. */
  departamento: string | null;
  /** As contas da DRE (uma ou mais), na ordem do modal. */
  linhasDREIds: string[];
  contas: Array<{ codigo: string; rotulo: string }>;
  fornecedores: string[];
  /** O percentual de 0 a 100. */
  destinos: Array<{ centroCustoId: string; centro: string; percentual: number }>;
  /** "AAAA-MM". */
  vigenciaInicio: string;
  vigenciaFim: string | null;
  descricao: string | null;
  ativo: boolean;
  /** As competências em que já valeu (MM/AAAA). */
  competencias: string[];
};
/** Uma Conta da DRE do modal: a linha de item, com o grupo, a atribuição e as unidades em que aparece (o filtro da Unidade). */
export type ContaDaRedistribuicao = { id: string; codigo: string; rotulo: string; descricao: string; grupo: string; atribuicao: string | null; unidades: number[] };
/** Um centro de Redistribuir Para: o da busca (código, nome e detalhe) e o da lupa (a lista das contestações). */
export type CentroDaRedistribuicao = CentroDaLupa & { codigo: string; nome: string; detalhe: string | null };
export type OpcoesDaRedistribuicao = {
  departamentos: Array<{ id: string; nome: string; linhas: string[] }>;
  unidades: Array<{ codigo: number; nome: string }>;
  linhas: ContaDaRedistribuicao[];
  centros: CentroDaRedistribuicao[];
};
export type FornecedorDaCombinacao = { fornecedor: string; movimentos: number; valor: number; competencias: string };
export type DadosDaRedistribuicao = Omit<Redistribuicao, "id" | "departamento" | "contas" | "competencias" | "destinos"> & {
  destinos: Array<{ centroCustoId: string; percentual: number }>;
};
/** O efeito de gravar: as competências reclassificadas e as apuradas que pedem reapurar. */
export type EfeitoDaRedistribuicao = { reclassificadas: string[]; apuradasPorReapurar: string[] };

const base = "/proxy/cadastros/redistribuicoes";
export const redistribuicoesService = {
  listar: async () => (await api.get<{ data: Redistribuicao[] }>(base)).data.data,
  opcoes: async () => (await api.get<{ data: OpcoesDaRedistribuicao }>(`${base}/opcoes`)).data.data,
  fornecedores: async (departamentoId: string | null, linhasDREIds: string[]) =>
    (await api.get<{ data: FornecedorDaCombinacao[] }>(`${base}/fornecedores`, { params: { linhasDREIds: linhasDREIds.join(","), ...(departamentoId ? { departamentoId } : {}) } })).data.data,
  gravar: async (id: string | null, d: DadosDaRedistribuicao) =>
    (id ? await api.put<{ data: EfeitoDaRedistribuicao }>(`${base}/${id}`, d) : await api.post<{ data: EfeitoDaRedistribuicao }>(base, d)).data.data,
  excluir: async (id: string) => (await api.delete<{ data: EfeitoDaRedistribuicao }>(`${base}/${id}`)).data.data,
};

/** As contas de uma redistribuição num texto curto: a primeira e quantas mais. */
export const nomeDasContas = (contas: Array<{ rotulo: string }>) =>
  contas.length > 1 ? `${contas[0].rotulo} e mais ${contas.length - 1} ${contas.length === 2 ? "conta" : "contas"}` : (contas[0]?.rotulo ?? "");

/** "AAAA-MM" → "MM/AAAA". */
export const mesBR = (m: string | null) => (m ? `${m.slice(5, 7)}/${m.slice(0, 4)}` : "");
export const vigenciaTexto = (r: { vigenciaInicio: string; vigenciaFim: string | null }) =>
  r.vigenciaFim ? `${mesBR(r.vigenciaInicio)} a ${mesBR(r.vigenciaFim)}` : `Desde ${mesBR(r.vigenciaInicio)}`;
