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
  /**
   * O centro, a Conta da DRE dele (23/11/2026: uma conta do departamento do centro; nula num destino anterior sem conta equivalente)
   * e o percentual de 0 a 100.
   */
  destinos: Array<{ centroCustoId: string; centro: string; linhaDREId: string | null; conta: string | null; percentual: number }>;
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
  destinos: Array<{ centroCustoId: string; linhaDREId: string; percentual: number }>;
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

/** A Conta da DRE é do departamento do centro (23/11/2026): o grupo da linha é o departamento dele, pelos nomes (como no SIG). */
export const contaDoDepartamento = (l: { grupo: string }, c: { departamento: string | null }) => !!c.departamento && l.grupo.trim().toUpperCase() === c.departamento.trim().toUpperCase();
/**
 * A atribuição da conta cabe na do centro (23/11/2026, como a verificação da classificação): o centro direto não leva Mão de Obra
 * Indireta nem Gastos Gerais Indiretos, o indireto não leva Mão de Obra Direta nem Gastos Gerais Diretos; as outras valem nos dois.
 */
export const atribuicaoCabeNoCentro = (atribuicaoDoCentro: "DIRETA" | "INDIRETA" | null, atribuicaoDaConta: string | null) => {
  const a = atribuicaoDaConta ?? "";
  if (atribuicaoDoCentro === "DIRETA") return a !== "Mão de Obra Indireta" && a !== "Gastos Gerais Indiretos";
  if (atribuicaoDoCentro === "INDIRETA") return a !== "Mão de Obra Direta" && a !== "Gastos Gerais Diretos";
  return true;
};
/** A Conta da DRE é do centro: do departamento e da atribuição dele. */
export const contaDoCentro = (l: { grupo: string; atribuicao: string | null }, c: { departamento: string | null; atribuicao: "DIRETA" | "INDIRETA" | null }) =>
  contaDoDepartamento(l, c) && atribuicaoCabeNoCentro(c.atribuicao, l.atribuicao);

/** As contas de uma redistribuição num texto curto: a primeira e quantas mais. */
export const nomeDasContas = (contas: Array<{ rotulo: string }>) =>
  contas.length > 1 ? `${contas[0].rotulo} e mais ${contas.length - 1} ${contas.length === 2 ? "conta" : "contas"}` : (contas[0]?.rotulo ?? "");

/** "AAAA-MM" → "MM/AAAA". */
export const mesBR = (m: string | null) => (m ? `${m.slice(5, 7)}/${m.slice(0, 4)}` : "");
export const vigenciaTexto = (r: { vigenciaInicio: string; vigenciaFim: string | null }) =>
  r.vigenciaFim ? `${mesBR(r.vigenciaInicio)} a ${mesBR(r.vigenciaFim)}` : `Desde ${mesBR(r.vigenciaInicio)}`;
