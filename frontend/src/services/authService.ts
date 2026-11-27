import { api } from "@/lib/api";

/** Departamentos do recorte do Gestor (Passo 22). */
export type DepartamentoAcesso = "PRODUCAO" | "SERVICOS" | "LOGISTICA" | "TECNICO" | "COMERCIAL" | "ADMINISTRATIVO" | "EXTRA_OPERACIONAL";

export type AuthUser = {
  id: string;
  nome: string;
  email: string;
  perfil: { codigo: string; nome: string };
  permissions: string[];
  /** Recortes por dado: setores (listas) e departamentos (movimentações e centros de custo). */
  acesso: {
    recorteSetor: boolean;
    setores: string[];
    recorteDepartamento: boolean;
    departamentos: DepartamentoAcesso[];
    /** Recorte por centro de custo (Coordenador): a gestão e os centros. */
    recorteCentro?: boolean;
    gestao?: DepartamentoAcesso | null;
    centros?: string[];
  };
  /** Divergências abertas que o usuário alcança: o aviso ao entrar (Passo 24). */
  divergenciasAbertas?: number;
};

type LoginResponse = {
  data: AuthUser;
};

type MeResponse = {
  data: AuthUser;
};

export const authService = {
  async login(email: string, password: string): Promise<AuthUser> {
    const { data } = await api.post<LoginResponse>("/auth/login", {
      email,
      password,
    });
    return data.data;
  },

  async logout(): Promise<void> {
    // Sai da lista de quem está online (24/10/2026), enquanto a sessão ainda vale; sem ela, some em 3 minutos.
    await api.delete("/proxy/presenca").catch(() => undefined);
    try {
      await api.post("/auth/logout");
    } catch {
      // Cookie pode já estar ausente — logout local segue
    }
  },

  async me(): Promise<AuthUser> {
    const { data } = await api.get<MeResponse>("/auth/me");
    return data.data;
  },

  /** Troca da própria senha: exige a atual. */
  async trocarSenha(atual: string, nova: string): Promise<void> {
    await api.put("/proxy/auth/senha", { atual, nova });
  },
};
