import { api } from "@/lib/api";
import { plural } from "@/lib/texto";

/** As telas dos Arquivos Gerais (05/11/2026), pelo endereço. */
export type TelaDosArquivos = "treinamentos" | "informativos";

/** Um arquivo da lista: a descrição, o nome e o tipo como vieram, o tamanho (bytes), quem o enviou e quando. */
export type ArquivoGeral = {
  id: string;
  descricao: string;
  nomeOriginal: string;
  tipo: string;
  tamanho: number;
  enviadoPorNome: string | null;
  enviadoEm: string;
  /** O navegador abre o tipo (PDF, imagem, vídeo, áudio ou texto): o Visualizar fica disponível. */
  visualizavel: boolean;
  /** O processo do arquivo (11/11/2026): o código (nulo: Geral) e o nome. */
  processo: string | null;
  processoNome: string;
};
/** Um processo vigente (11/11/2026), para o campo Processo do Adicionar e do Editar. */
export type ProcessoDosArquivos = { codigo: string; nome: string };

/** O maior arquivo: 500 MB, como no servidor. */
export const MAXIMO_DO_ARQUIVO = 500 * 1024 * 1024;

const base = (tela: TelaDosArquivos) => `/proxy/arquivos-gerais/${tela}`;

export const arquivosGeraisService = {
  /** Os arquivos que o usuário vê (os Gerais e os dos processos dele) e os processos vigentes. */
  listar: async (tela: TelaDosArquivos) => (await api.get<{ data: { arquivos: ArquivoGeral[]; processos: ProcessoDosArquivos[] } }>(base(tela))).data.data,
  /** O arquivo cru no corpo, com o nome, a descrição e o processo (vazio: Geral) no endereço e o andamento do envio (0 a 1). */
  adicionar: async (tela: TelaDosArquivos, arquivo: File, descricao: string, processo: string | null, aoEnviar?: (fracao: number) => void) =>
    (
      await api.post<{ data: ArquivoGeral }>(base(tela), arquivo, {
        params: { nome: arquivo.name, descricao, processo: processo ?? "" },
        headers: { "Content-Type": arquivo.type || "application/octet-stream" },
        onUploadProgress: (e) => (e.total ? aoEnviar?.(e.loaded / e.total) : undefined),
        timeout: 0,
      })
    ).data.data,
  /** Edita a descrição e o processo (11/11/2026; nulo: Geral). */
  editar: async (tela: TelaDosArquivos, id: string, descricao: string, processo: string | null) =>
    (await api.put<{ data: ArquivoGeral }>(`${base(tela)}/${id}`, { descricao, processo: processo ?? "" })).data.data,
  excluir: async (tela: TelaDosArquivos, id: string) => (await api.delete<{ data: { excluido: boolean } }>(`${base(tela)}/${id}`)).data.data,
  /** O endereço do conteúdo: ver (no navegador) ou baixar. */
  endereco: (tela: TelaDosArquivos, id: string, modo: "ver" | "baixar") => `/api${base(tela)}/${id}/conteudo?modo=${modo}`,
};

/** O tamanho legível: 1,2 MB, 340 KB. */
export function tamanhoLegivel(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 ** 3).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 ** 2).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024).toLocaleString("pt-BR")} KB`;
  return `${bytes.toLocaleString("pt-BR")} ${plural(bytes, "byte", "bytes")}`;
}

export function mensagemDeErro(e: unknown, padrao: string) {
  return (e as { response?: { data?: { error?: string } } })?.response?.data?.error || padrao;
}
