import { api } from "@/lib/api";

/** O Quadro de Lotação e o Painel de Bordo da Gestão de Colaboradores (06/11/2026, etapa 2). */
export type StatusCompetenciaQuadro = "ABERTA" | "FECHADA";
export type StatusMovimentacao = "PENDENTE" | "APROVADA" | "REPROVADA";
export type Contagem = "POSITIVA" | "NEGATIVA" | "NULA";

export type CompetenciaDoQuadro = {
  id: string;
  ano: number;
  mes: number;
  status: StatusCompetenciaQuadro;
  abertaEm: string;
  abertaPorNome: string | null;
  fechadaEm: string | null;
  fechadaPorNome: string | null;
  movimentacoes: number;
  pendentes: number;
  quadroInicial: number;
  quadroFinal: number;
};

export type Movimentacao = {
  id: string;
  data: string;
  tipo: string;
  contagem: Contagem;
  aprovacao: "AUTOMATICA" | "MANUAL";
  classificacao: string | null;
  centroCustoId: string;
  centroCusto: string;
  departamento: string | null;
  vinculo: "CLT" | "PJ";
  funcao: string;
  senioridade: string;
  motivo: string | null;
  origem: "INICIATIVA_EMPRESA" | "PEDIDO_COLABORADOR" | null;
  status: StatusMovimentacao;
  geradaPorDesligamento: boolean;
  vagaGerada: boolean;
  registradaPorNome: string | null;
  registradaEm: string;
  decididaPorNome: string | null;
  decididaEm: string | null;
  justificativa: string | null;
};

export type OpcoesDoQuadro = {
  tipos: Array<{ id: string; nome: string; contagem: Contagem; aprovacao: "AUTOMATICA" | "MANUAL" }>;
  classificacoes: Array<{ id: string; nome: string; tipoMovimentacaoId: string }>;
  centros: Array<{ id: string; nome: string }>;
  funcoes: Array<{ id: string; nome: string; senioridadeId: string | null }>;
  senioridades: Array<{ id: string; nome: string }>;
};

export type NovaMovimentacao = {
  tipoMovimentacaoId: string;
  classificacaoId: string | null;
  data: string;
  centroCustoId: string;
  vinculo: "CLT" | "PJ";
  funcaoId: string;
  senioridadeId: string;
  motivo: string | null;
  origem: "INICIATIVA_EMPRESA" | "PEDIDO_COLABORADOR" | null;
  gerarVaga: boolean;
};

export type IndicadoresDoMes = { quadroDeLotacao: number; turnover: number | null; contratacoes: number; positivas: number; negativas: number };
export type LinhaDoRealizado = {
  centroCustoId: string;
  centroCusto: string;
  departamento: string | null;
  atribuicao: string | null;
  inicial: number;
  entradas: number;
  saidas: number;
  final: number;
  clt: number;
  pj: number;
  /** Com a Comparação (09/11/2026): os colaboradores do centro no mês, na aba Quadro de Lotação do cenário; null sem ela. */
  cenario: number | null;
};
type DaCompetencia = { competencia: { ano: number; mes: number; status: StatusCompetenciaQuadro } };

/** As marcações dos cenários da Comparação (as mesmas de Resultados Empresariais). */
export type MarcacaoComparavel = "PREVISAO" | "ORCAMENTO_EMPRESARIAL" | "RESULTADOS_ANTERIORES" | "RESULTADOS_VENDIDOS";
export type OpcaoDaComparacao = { marcacao: MarcacaoComparavel; rotulo: string; cenario: { id: string; nome: string; ano: number } };
/** O cenário comparado (09/11/2026): os indicadores do Painel de Bordo mês a mês (12 valores; null sem valor). */
export type CenarioComparado = {
  cenario: { id: string; nome: string; ano: number; analitico: boolean; porCentro: boolean };
  indicadores: { quadroDeLotacao: Array<number | null>; turnover: Array<number | null>; contratacoes: Array<number | null> };
};

export const ROTULO_ORIGEM: Record<string, string> = { INICIATIVA_EMPRESA: "Iniciativa da Empresa", PEDIDO_COLABORADOR: "Pedido do Colaborador" };
export const ROTULO_STATUS: Record<StatusMovimentacao, string> = { PENDENTE: "Pendente", APROVADA: "Aprovada", REPROVADA: "Reprovada" };

const base = "/proxy/gestao-de-colaboradores";
const dados = <T>(p: Promise<{ data: { data: T } }>) => p.then((r) => r.data.data);

export const quadroService = {
  competencias: () => dados(api.get<{ data: { lancamentoInicial: string | null; itens: CompetenciaDoQuadro[] } }>(`${base}/quadro/competencias`)),
  abrir: (ano: number, mes: number) => dados(api.post<{ data: { ano: number; mes: number } }>(`${base}/quadro/competencias`, { ano, mes })),
  fechar: (anoMes: string) => api.post(`${base}/quadro/competencias/${anoMes}/fechar`),
  reabrir: (anoMes: string) => api.post(`${base}/quadro/competencias/${anoMes}/reabrir`),
  excluir: (anoMes: string) => api.delete(`${base}/quadro/competencias/${anoMes}`),
  opcoes: () => dados(api.get<{ data: OpcoesDoQuadro }>(`${base}/quadro/opcoes`)),
  movimentacoes: (anoMes: string) => dados(api.get<{ data: DaCompetencia & { itens: Movimentacao[] } }>(`${base}/quadro/competencias/${anoMes}/movimentacoes`)),
  registrar: (anoMes: string, m: NovaMovimentacao) => api.post(`${base}/quadro/competencias/${anoMes}/movimentacoes`, m),
  excluirMovimentacao: (id: string) => api.delete(`${base}/quadro/movimentacoes/${id}`),
  controle: (anoMes: string) => dados(api.get<{ data: DaCompetencia & { itens: Movimentacao[] } }>(`${base}/quadro/competencias/${anoMes}/controle`)),
  decidir: (id: string, aprovar: boolean, justificativa: string | null) => api.post(`${base}/quadro/movimentacoes/${id}/decisao`, { aprovar, justificativa }),
  realizado: (anoMes: string, comparacao: MarcacaoComparavel | null) =>
    dados(
      api.get<{
        data: DaCompetencia & {
          linhas: LinhaDoRealizado[];
          indicadores: IndicadoresDoMes | null;
          doAno: Array<IndicadoresDoMes & { mes: number }>;
          comparacao: { cenario: { nome: string; ano: number; analitico: boolean }; porCentro: boolean } | null;
        };
      }>(`${base}/quadro/competencias/${anoMes}/realizado`, { params: comparacao ? { comparacao } : {} }),
    ),
  /** A Comparação (09/11/2026): os cenários marcados e, com a marcação, o cenário dela mês a mês. */
  comparacao: (comparacao: MarcacaoComparavel | null) =>
    dados(api.get<{ data: { opcoes: OpcaoDaComparacao[]; comparado: CenarioComparado | null } }>(`${base}/comparacao`, { params: comparacao ? { comparacao } : {} })),
  painel: (ano: number) =>
    dados(api.get<{ data: { ano: number; anos: number[]; meses: Array<IndicadoresDoMes & { mes: number; porTipo: Record<string, number> }> } }>(`${base}/painel`, { params: { ano } })),
};
