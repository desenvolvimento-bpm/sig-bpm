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
