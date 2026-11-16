import { env } from "../../config/env.js";
import { getPrismaClient } from "../../config/prisma.js";
import { DURACAO_DO_TOKEN_DA_API, signTokenDaApi } from "../../lib/jwt.js";
import type { UsuarioAutenticado } from "../acesso/acesso.js";
import { auditar } from "../auditoriaService.js";
import { authService, RegraAuthError } from "../authService.js";
import { ApiError, apiDoCodigo, CATALOGO, type Formato, type Resposta } from "./catalogoApis.js";

/**
 * A Biblioteca de APIs (24/10/2026, pedido do Adão), com as regras do TI para API exposta
 * (Docs/projeto/anexos/RNF-API-SEGURA.md):
 * - o aplicativo pede o token com o login e a senha do SIG (POST /api/v1/token) e manda o token no cabeçalho
 *   `Authorization: Bearer` em cada pedido (GET /api/v1/apis/{código}); o token vale uma hora e só abre a API (o SIG o
 *   recusa, e o da sessão do SIG não abre a API);
 * - só com a API ligada pelo TI (a API_EXTERNA: desligada, o padrão da produção, recusa antes de conferir a senha) e,
 *   ligada em "https", só com HTTPS;
 * - o usuário precisa da Biblioteca de APIs (Ler) e da leitura da tela dos dados (a mesma das telas: quem não lê no SIG não
 *   lê pela API);
 * - os bloqueios da tela (uma API, um usuário ou um endereço) recusam na hora (403);
 * - todo pedido fica na Auditoria (quem, de onde, qual API, o resultado e o tempo), e o pedido do token tem o limite de
 *   tentativas do login.
 */

export type TipoDeBloqueio = "API" | "USUARIO" | "ENDERECO";
export type Origem = { endereco: string | null; userAgent: string | null; https: boolean };

/** As ações da Auditoria da API: o acesso (atendido ou recusado) e o token emitido. */
export const ACOES_DA_API = ["ACESSO_API", "ACESSO_API_NEGADO", "TOKEN_API"] as const;
const ENTIDADE = "api";

async function bloqueado(tipo: TipoDeBloqueio, valor: string | null) {
  if (!valor) return false;
  return !!(await getPrismaClient().apiBloqueio.findUnique({ where: { tipo_valor: { tipo, valor } }, select: { id: true } }));
}

/**
 * A API ligada pelo TI (a API_EXTERNA) e, em "https", o HTTPS (a regra do TI). Vem antes de tudo: desligada, nem a senha
 * é conferida.
 */
export function exigirLigada(origem: Pick<Origem, "https">, modo = env.apiExterna) {
  if (modo === "desligada") {
    throw new ApiError(503, "A API do SIG BPM ainda não foi ligada pelo TI da BPM neste endereço.", "API_DESLIGADA");
  }
  if (modo === "https" && !origem.https) {
    throw new ApiError(403, "A API só aceita conexões HTTPS (regra de segurança do TI da BPM). Peça ao TI o endereço do SIG com HTTPS.", "HTTPS_OBRIGATORIO");
  }
}

const podeUsar = (u: UsuarioAutenticado) => u.permissions.includes("biblioteca_apis:ler");

/** O usuário e o endereço liberados (os controles da tela) e a Biblioteca de APIs no perfil. */
async function exigirLiberado(u: UsuarioAutenticado, origem: Origem) {
  if (!podeUsar(u)) throw new ApiError(403, "O seu perfil não tem a tela APIs (Central de Conectividade). Peça ao Administrador do SIG.", "SEM_BIBLIOTECA");
  if (await bloqueado("USUARIO", u.sub)) throw new ApiError(403, "O seu acesso às APIs está bloqueado na Central de Conectividade.", "USUARIO_BLOQUEADO");
  if (await bloqueado("ENDERECO", origem.endereco)) throw new ApiError(403, "Este endereço está bloqueado na Central de Conectividade.", "ENDERECO_BLOQUEADO");
}

const registrar = (acao: (typeof ACOES_DA_API)[number] | "LOGIN_FALHA", u: { sub: string; nome: string } | null, origem: Origem, metadados: Record<string, unknown>) =>
  auditar({
    usuarioId: u?.sub ?? null,
    usuarioNome: u?.nome ?? null,
    acao,
    entidade: ENTIDADE,
    entidadeId: typeof metadados.codigo === "string" ? metadados.codigo : null,
    ip: origem.endereco,
    userAgent: origem.userAgent,
    metadados,
  });

export const conectividadeService = {
  /** O token da API, pelo login e pela senha do SIG (a mesma verificação do login). */
  async emitirToken(email: string, senha: string, origem: Origem) {
    exigirLigada(origem);
    let u: UsuarioAutenticado;
    try {
      u = await authService.verificarCredenciais(email, senha);
    } catch (e) {
      if (e instanceof RegraAuthError) {
        // O e-mail tentado, nunca a senha.
        await registrar("LOGIN_FALHA", null, origem, { email: email.trim().toLowerCase(), api: true, status: 401 });
        throw new ApiError(401, "E-mail ou senha inválidos.", "CREDENCIAIS_INVALIDAS");
      }
      throw e;
    }
    try {
      await exigirLiberado(u, origem);
    } catch (e) {
      if (e instanceof ApiError) await registrar("ACESSO_API_NEGADO", u, origem, { codigo: "token", status: e.status, motivo: e.codigo });
      throw e;
    }
    await registrar("TOKEN_API", u, origem, { codigo: "token", status: 200 });
    return { token: signTokenDaApi({ sub: u.sub, email: u.email }), tipo: "Bearer", expiraEm: new Date(Date.now() + DURACAO_DO_TOKEN_DA_API * 1000).toISOString() };
  },

  /** As APIs que o usuário do token lê (o catálogo, pela API). */
  async catalogoDaApi(u: UsuarioAutenticado, origem: Origem) {
    exigirLigada(origem);
    await exigirLiberado(u, origem);
    const bloqueadas = new Set((await getPrismaClient().apiBloqueio.findMany({ where: { tipo: "API" }, select: { valor: true } })).map((b) => b.valor));
    return CATALOGO.filter((a) => a.alcanca(u)).map((a) => ({ codigo: a.codigo, nome: a.nome, origem: a.origem, descricao: a.descricao, formatos: a.formatos, parametros: a.parametros, bloqueada: bloqueadas.has(a.codigo) }));
  },

  /** Um pedido a uma API: as regras, os dados e o registro na Auditoria (atendido ou recusado, com o tempo). */
  async executar(codigo: string, consulta: Record<string, unknown>, u: UsuarioAutenticado, origem: Origem): Promise<Resposta> {
    const inicio = Date.now();
    const formato = (consulta.formato === "visual" ? "visual" : "dados") as Formato;
    try {
      exigirLigada(origem);
      if (consulta.formato !== undefined && consulta.formato !== "dados" && consulta.formato !== "visual") {
        throw new ApiError(422, "Parâmetro inválido — formato: dados ou visual.", "PARAMETRO_INVALIDO");
      }
      const api = apiDoCodigo(codigo);
      if (!api) throw new ApiError(404, `Nenhuma API com o código "${codigo}". A lista está em GET /api/v1/apis.`, "API_INEXISTENTE");
      await exigirLiberado(u, origem);
      if (await bloqueado("API", codigo)) throw new ApiError(403, "Esta API está bloqueada na Central de Conectividade.", "API_BLOQUEADA");
      const { formato: _, ...parametros } = consulta;
      const resposta = await api.executar(parametros, u, formato);
      await registrar("ACESSO_API", u, origem, { codigo, formato, status: 200, ms: Date.now() - inicio });
      return resposta;
    } catch (e) {
      if (e instanceof ApiError) await registrar("ACESSO_API_NEGADO", u, origem, { codigo, formato, status: e.status, motivo: e.codigo, ms: Date.now() - inicio });
      throw e;
    }
  },

  /** A prévia na tela (a sessão do SIG): o mesmo resultado da API, sem os bloqueios e sem o registro de acesso externo. */
  async previa(codigo: string, consulta: Record<string, unknown>, u: UsuarioAutenticado) {
    const api = apiDoCodigo(codigo);
    if (!api) throw new ApiError(404, `Nenhuma API com o código "${codigo}".`, "API_INEXISTENTE");
    const { formato, ...parametros } = consulta;
    return api.executar(parametros, u, formato === "visual" ? "visual" : "dados");
  },

  /** O catálogo da tela: todas as APIs, com o que o usuário lê, os bloqueios e o modo da API (desligada, https ou http). */
  async catalogo(u: UsuarioAutenticado) {
    const bloqueios = await getPrismaClient().apiBloqueio.findMany({ select: { tipo: true, valor: true, bloqueadoPor: true, bloqueadoEm: true } });
    const daApi = new Map(bloqueios.filter((b) => b.tipo === "API").map((b) => [b.valor, b]));
    return {
      modo: env.apiExterna,
      podeEditar: u.permissions.includes("biblioteca_apis:editar"),
      duracaoDoToken: DURACAO_DO_TOKEN_DA_API,
      apis: CATALOGO.map((a) => ({
        codigo: a.codigo,
        nome: a.nome,
        origem: a.origem,
        descricao: a.descricao,
        exige: a.exige,
        formatos: a.formatos,
        parametros: a.parametros,
        alcanca: a.alcanca(u),
        bloqueio: daApi.get(a.codigo) ?? null,
      })),
    };
  },

  /**
   * Os acessos dos últimos `dias` (a Auditoria): por dia, por usuário, por endereço e por API, e os últimos pedidos. Quem
   * edita a tela vê os de todos, com os bloqueios; quem só lê, os próprios.
   */
  async acessos(dias: number, u: UsuarioAutenticado) {
    // Quem edita a tela Acessos (13/11/2026; antes, a tela APIs) vê os de todos.
    const todos = u.permissions.includes("conectividade_acessos.apis:editar");
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
    const prisma = getPrismaClient();
    const registros = await prisma.auditLog.findMany({
      where: {
        entidade: ENTIDADE,
        acao: { in: [...ACOES_DA_API, "LOGIN_FALHA"] },
        createdAt: { gte: desde },
        ...(todos ? {} : { usuarioId: u.sub }),
      },
      orderBy: { createdAt: "desc" },
      take: 20_000,
      select: { acao: true, usuarioId: true, usuarioNome: true, ip: true, metadados: true, createdAt: true },
    });
    const bloqueios = todos ? await prisma.apiBloqueio.findMany({ select: { tipo: true, valor: true } }) : [];
    const idsBloqueados = bloqueios.filter((b) => b.tipo === "USUARIO").map((b) => b.valor);
    const nomes = new Map(
      idsBloqueados.length ? (await prisma.usuario.findMany({ where: { id: { in: idsBloqueados } }, select: { id: true, nome: true } })).map((x) => [x.id, x.nome]) : [],
    );
    const bloqueadoS = new Set(bloqueios.map((b) => `${b.tipo}|${b.valor}`));
    const meta = (m: unknown) => (m && typeof m === "object" ? (m as Record<string, unknown>) : {});
    const negado = (acao: string) => acao === "ACESSO_API_NEGADO" || acao === "LOGIN_FALHA";
    const dia = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

    const porDia = new Map<string, { atendidos: number; recusados: number }>();
    for (let k = dias - 1; k >= 0; k--) porDia.set(dia(new Date(Date.now() - k * 24 * 60 * 60 * 1000)), { atendidos: 0, recusados: 0 });
    type PorUsuario = { usuarioId: string; nome: string; total: number; recusados: number; ultimo: Date; enderecos: Set<string> };
    type PorEndereco = { endereco: string; total: number; recusados: number; ultimo: Date; usuarios: Set<string> };
    const porUsuario = new Map<string, PorUsuario>();
    const porEndereco = new Map<string, PorEndereco>();
    const porApi = new Map<string, { codigo: string; total: number; recusados: number }>();
    for (const r of registros) {
      const recusado = negado(r.acao);
      const d = porDia.get(dia(r.createdAt));
      if (d) d[recusado ? "recusados" : "atendidos"]++;
      if (r.usuarioId) {
        const p = porUsuario.get(r.usuarioId) ?? { usuarioId: r.usuarioId, nome: r.usuarioNome ?? r.usuarioId, total: 0, recusados: 0, ultimo: r.createdAt, enderecos: new Set<string>() };
        p.total++;
        if (recusado) p.recusados++;
        if (r.ip) p.enderecos.add(r.ip);
        porUsuario.set(r.usuarioId, p);
      }
      if (r.ip) {
        const p = porEndereco.get(r.ip) ?? { endereco: r.ip, total: 0, recusados: 0, ultimo: r.createdAt, usuarios: new Set<string>() };
        p.total++;
        if (recusado) p.recusados++;
        p.usuarios.add(r.usuarioNome ?? String(meta(r.metadados).email ?? "desconhecido"));
        porEndereco.set(r.ip, p);
      }
      const codigo = String(meta(r.metadados).codigo ?? "token");
      const a = porApi.get(codigo) ?? { codigo, total: 0, recusados: 0 };
      a.total++;
      if (recusado) a.recusados++;
      porApi.set(codigo, a);
    }
    const nomeDaApi = (codigo: string) => (codigo === "token" ? "Pedido do token" : (apiDoCodigo(codigo)?.nome ?? codigo));
    return {
      dias,
      todos,
      totais: {
        pedidos: registros.length,
        recusados: registros.filter((r) => negado(r.acao)).length,
        usuarios: porUsuario.size,
        enderecos: porEndereco.size,
      },
      porDia: [...porDia].map(([d, v]) => ({ dia: d, ...v })),
      porUsuario: [...porUsuario.values()]
        .sort((a, b) => b.total - a.total)
        .map((p) => ({ usuarioId: p.usuarioId, nome: p.nome, total: p.total, recusados: p.recusados, ultimo: p.ultimo, enderecos: [...p.enderecos], bloqueado: bloqueadoS.has(`USUARIO|${p.usuarioId}`) })),
      porEndereco: [...porEndereco.values()]
        .sort((a, b) => b.total - a.total)
        .map((p) => ({ endereco: p.endereco, total: p.total, recusados: p.recusados, ultimo: p.ultimo, usuarios: [...p.usuarios], bloqueado: bloqueadoS.has(`ENDERECO|${p.endereco}`) })),
      porApi: [...porApi.values()].sort((a, b) => b.total - a.total).map((a) => ({ ...a, nome: nomeDaApi(a.codigo) })),
      ultimos: registros.slice(0, 50).map((r) => {
        const m = meta(r.metadados);
        return {
          quando: r.createdAt,
          usuario: r.usuarioNome ?? (typeof m.email === "string" ? `${m.email} (não entrou)` : "—"),
          endereco: r.ip,
          api: nomeDaApi(String(m.codigo ?? "token")),
          formato: typeof m.formato === "string" ? m.formato : null,
          status: typeof m.status === "number" ? m.status : null,
          motivo: typeof m.motivo === "string" ? m.motivo : null,
          ms: typeof m.ms === "number" ? m.ms : null,
        };
      }),
      // Os usuários e endereços bloqueados sem acesso no período (para desbloquear).
      bloqueios: bloqueios.filter((b) => b.tipo !== "API").map((b) => ({ ...b, nome: b.tipo === "USUARIO" ? (nomes.get(b.valor) ?? b.valor) : b.valor })),
    };
  },

  /** Bloqueia ou libera uma API, um usuário ou um endereço (quem edita a tela), na Auditoria. */
  async bloquear(tipo: TipoDeBloqueio, valor: string, bloquear: boolean, u: UsuarioAutenticado) {
    const prisma = getPrismaClient();
    const antes = await prisma.apiBloqueio.findUnique({ where: { tipo_valor: { tipo, valor } } });
    if (bloquear && !antes) await prisma.apiBloqueio.create({ data: { tipo, valor, bloqueadoPor: u.nome } });
    if (!bloquear && antes) await prisma.apiBloqueio.delete({ where: { tipo_valor: { tipo, valor } } });
    if (bloquear !== !!antes) {
      await auditar({
        usuarioId: u.sub,
        usuarioNome: u.nome,
        acao: "ALTERACAO",
        entidade: "api_bloqueio",
        entidadeId: `${tipo}|${valor}`,
        antes: { bloqueado: !!antes },
        depois: { bloqueado: bloquear },
        metadados: { tipo, valor, nome: tipo === "API" ? (apiDoCodigo(valor)?.nome ?? valor) : valor },
      });
    }
    return { tipo, valor, bloqueado: bloquear };
  },
};
