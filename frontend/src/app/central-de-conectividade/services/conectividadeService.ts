import { api } from "@/lib/api";

/** A Biblioteca de APIs (24/10/2026): o catálogo, a prévia, os acessos e os bloqueios (a sessão do SIG). */
const base = "/proxy/conectividade";

export type Parametro = { nome: string; descricao: string; obrigatorio: boolean; exemplo: string };
export type Formato = "dados" | "visual";
export type ApiDoCatalogo = {
  codigo: string;
  nome: string;
  origem: "Resultados Empresariais" | "Realizado por Obra" | "Cenários";
  descricao: string;
  exige: string;
  formatos: Formato[];
  parametros: Parametro[];
  alcanca: boolean;
  bloqueio: { bloqueadoPor: string | null; bloqueadoEm: string } | null;
};
/** O modo da API (a API_EXTERNA do backend, que só o TI liga): desligada, só por HTTPS ou também por HTTP. */
export type ModoDaApi = "desligada" | "https" | "http";
export type Catalogo = { modo: ModoDaApi; podeEditar: boolean; duracaoDoToken: number; apis: ApiDoCatalogo[] };

export type Coluna = { chave: string; titulo: string; tipo: "texto" | "numero" | "percentual" };
export type Visual = { titulo: string; largura: number; altura: number; svg: string };
export type Previa =
  | { api: string; formato: "dados"; colunas: Coluna[]; linhas: Array<Record<string, string | number | null>> }
  | { api: string; formato: "visual"; visuais: Visual[] };

export type TipoDeBloqueio = "API" | "USUARIO" | "ENDERECO";
export type Acessos = {
  dias: number;
  todos: boolean;
  totais: { pedidos: number; recusados: number; usuarios: number; enderecos: number };
  porDia: Array<{ dia: string; atendidos: number; recusados: number }>;
  porUsuario: Array<{ usuarioId: string; nome: string; total: number; recusados: number; ultimo: string; enderecos: string[]; bloqueado: boolean }>;
  porEndereco: Array<{ endereco: string; total: number; recusados: number; ultimo: string; usuarios: string[]; bloqueado: boolean }>;
  porApi: Array<{ codigo: string; nome: string; total: number; recusados: number }>;
  ultimos: Array<{ quando: string; usuario: string; endereco: string | null; api: string; formato: string | null; status: number | null; motivo: string | null; ms: number | null }>;
  bloqueios: Array<{ tipo: TipoDeBloqueio; valor: string; nome: string }>;
};

export const conectividadeService = {
  catalogo: async () => (await api.get<{ data: Catalogo }>(`${base}/catalogo`)).data.data,
  previa: async (codigo: string, params: Record<string, string>) => (await api.get<{ data: Previa; meta: Record<string, unknown> }>(`${base}/previa/${codigo}`, { params })).data,
  acessos: async (dias: number) => (await api.get<{ data: Acessos }>(`${base}/acessos`, { params: { dias } })).data.data,
  bloquear: async (tipo: TipoDeBloqueio, valor: string, bloqueado: boolean) =>
    (await api.put<{ data: { tipo: TipoDeBloqueio; valor: string; bloqueado: boolean } }>(`${base}/bloqueios`, { tipo, valor, bloqueado })).data.data,
};

/** O endereço da API para os aplicativos: o do SIG aberto, com /api/v1. */
export const enderecoDaApi = () => (typeof window === "undefined" ? "/api/v1" : `${window.location.origin}/api/v1`);

/**
 * Copia o texto (24/10/2026): a área de transferência do navegador só existe em HTTPS; no endereço HTTP do SIG, o
 * copiar de antes (um campo escondido e o comando copy).
 */
export async function copiarTexto(texto: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(texto);
    return;
  }
  const campo = document.createElement("textarea");
  campo.value = texto;
  campo.setAttribute("readonly", "");
  campo.style.position = "fixed";
  campo.style.opacity = "0";
  document.body.appendChild(campo);
  campo.select();
  document.execCommand("copy");
  campo.remove();
}
