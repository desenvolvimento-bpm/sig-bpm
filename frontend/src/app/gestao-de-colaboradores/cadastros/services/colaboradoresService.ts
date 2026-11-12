import { api } from "@/lib/api";

/** As importações da tela Cadastros da Gestão de Colaboradores (06/11/2026). */
export type TipoImportacaoColaboradores = "funcoes" | "lancamento-inicial";
export type SituacaoLinha = "NOVA" | "ALTERADA" | "IGUAL" | "INVALIDA";
export type LinhaDaPrevia = { linha: number; valores: Record<string, string>; situacao: SituacaoLinha; motivo?: string };
export type PreviaColaboradores = {
  tipo: TipoImportacaoColaboradores;
  nomeArquivo: string;
  aba: string;
  colunas: Array<{ chave: string; rotulo: string }>;
  linhas: LinhaDaPrevia[];
  resumo: Record<SituacaoLinha, number>;
  /** O Lançamento Inicial: a competência escolhida (MM/AAAA) e o que ele substitui. */
  competencia?: string;
  substitui?: { competencia: string; colaboradores: number } | null;
  /** As funções (11/11/2026: a importação substitui o cadastro inteiro): as que saem (até 200 nomes, "Função · Senioridade"). */
  excluidas?: { total: number; nomes: string[] };
  /** As funções que saem e estão em movimentações do Quadro de Lotação ou nos cenários: a importação é recusada. */
  bloqueio?: string | null;
  /** O Lançamento Inicial que usa funções que saem: é apagado junto. */
  apagaLancamentoInicial?: { competencia: string; colaboradores: number; funcoes: number } | null;
};

export const colaboradoresService = {
  /** A prévia da planilha (sem `gravar`) ou a importação (com `gravar`, recusada com alguma linha inválida). */
  importar: async (tipo: TipoImportacaoColaboradores, arquivo: File, opcoes: { competencia?: string; gravar: boolean }): Promise<PreviaColaboradores> => {
    const { data } = await api.post<{ data: PreviaColaboradores }>(`/proxy/gestao-de-colaboradores/importacoes/${tipo}`, arquivo, {
      params: { nomeArquivo: arquivo.name, competencia: opcoes.competencia, gravar: opcoes.gravar ? "1" : undefined },
      headers: { "Content-Type": "application/octet-stream" },
    });
    return data.data;
  },
};
