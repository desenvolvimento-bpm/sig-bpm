import { api } from "@/lib/api";
import type { DepartamentoAcesso } from "@/services/authService";

export type Acao = "LER" | "EDITAR";
/** Uma permissão da matriz do perfil (14/10/2026): a tela ou a aba ("tela.aba") e a ação. */
export type Permissao = { chave: string; acao: Acao };

/** O catálogo das telas e das abas de cada grupo do menu: as linhas da matriz do perfil. */
export type GrupoDeTelas = { recurso: string; nome: string; telas: Array<{ codigo: string; nome: string; abas: Array<{ codigo: string; nome: string }> }> };

export type PerfilResumo = { id: string; codigo: string; nome: string; ativo: boolean; recorteSetor: boolean; recorteDepartamento: boolean; recorteCentro: boolean };

export type Usuario = {
  id: string;
  nome: string;
  email: string;
  ativo: boolean;
  ordem: number;
  perfil: PerfilResumo;
  setores: string[];
  departamentos: DepartamentoAcesso[];
  /** O recorte por centro de custo (Coordenador): a gestão e os ids dos centros dela que o usuário alcança. */
  gestao: DepartamentoAcesso | null;
  centros: string[];
};

/** Um centro de custo ativo, com a gestão dele (o departamento do cadastro). */
export type CentroDaGestao = { id: string; codigoRM: string | null; nome: string; agrupamento: string | null; gestao: DepartamentoAcesso };

export type Perfil = PerfilResumo & {
  /** Acesso a Informações Sensíveis (27/10/2026): as movimentações da Mão de Obra Direta e Indireta. */
  informacoesSensiveis: boolean;
  descricao: string | null;
  sistema: boolean;
  ordem: number;
  permissoes: Permissao[];
  usuarios: number;
};

export type OpcoesUsuarios = {
  perfis: PerfilResumo[];
  recursos: Array<{ recurso: string; rotulo: string }>;
  telas: GrupoDeTelas[];
  acoes: Acao[];
  setores: Array<{ tipo: string; rotulo: string }>;
  departamentos: Array<{ departamento: DepartamentoAcesso; rotulo: string }>;
  gestoes: Array<{ gestao: DepartamentoAcesso; rotulo: string }>;
  centros: CentroDaGestao[];
};

export type DadosUsuario = {
  nome: string;
  email: string;
  perfilId: string;
  ativo: boolean;
  setores: string[];
  departamentos: DepartamentoAcesso[];
  gestao: DepartamentoAcesso | null;
  centros: string[];
  senha?: string;
};

export type DadosPerfil = {
  codigo?: string;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  recorteSetor: boolean;
  recorteDepartamento: boolean;
  recorteCentro: boolean;
  informacoesSensiveis: boolean;
  permissoes: Permissao[];
};

export const usuariosService = {
  opcoes: async (): Promise<OpcoesUsuarios> => (await api.get<{ data: OpcoesUsuarios }>("/proxy/usuarios/opcoes")).data.data,
  listar: async (): Promise<Usuario[]> => (await api.get<{ data: Usuario[] }>("/proxy/usuarios")).data.data,
  criar: async (d: DadosUsuario): Promise<Usuario> => (await api.post<{ data: Usuario }>("/proxy/usuarios", d)).data.data,
  atualizar: async (id: string, d: DadosUsuario): Promise<Usuario> => (await api.put<{ data: Usuario }>(`/proxy/usuarios/${id}`, d)).data.data,
  redefinirSenha: async (id: string, senha: string): Promise<void> => {
    await api.put(`/proxy/usuarios/${id}/senha`, { senha });
  },

  perfis: async (): Promise<Perfil[]> => (await api.get<{ data: Perfil[] }>("/proxy/perfis")).data.data,
  criarPerfil: async (d: DadosPerfil): Promise<Perfil[]> => (await api.post<{ data: Perfil[] }>("/proxy/perfis", d)).data.data,
  atualizarPerfil: async (id: string, d: DadosPerfil): Promise<Perfil[]> => (await api.put<{ data: Perfil[] }>(`/proxy/perfis/${id}`, d)).data.data,
  // Inativar e reativar (27/10/2026), a ação da lista dos perfis.
  mudarSituacaoPerfil: async (id: string, ativo: boolean): Promise<Perfil[]> => (await api.patch<{ data: Perfil[] }>(`/proxy/perfis/${id}/situacao`, { ativo })).data.data,
  excluirPerfil: async (id: string): Promise<Perfil[]> => (await api.delete<{ data: Perfil[] }>(`/proxy/perfis/${id}`)).data.data,
};

export function mensagemDeErro(error: unknown, padrao: string) {
  return (error as { response?: { data?: { error?: string } } }).response?.data?.error ?? padrao;
}

export const classeSelect = "h-9 w-full rounded-sm border border-gray-300 bg-white px-3 text-sm";
