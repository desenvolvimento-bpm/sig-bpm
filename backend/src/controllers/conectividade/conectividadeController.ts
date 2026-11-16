import type { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import { verifyToken } from "../../lib/jwt.js";
import { carregarUsuario } from "../../services/acesso/acesso.js";
import { ApiError } from "../../services/conectividade/catalogoApis.js";
import { conectividadeService, exigirLigada, type Origem } from "../../services/conectividade/conectividadeService.js";

/**
 * A Biblioteca de APIs (24/10/2026): as rotas externas (/v1, pelo /api/v1 do servidor do Next) e as da tela
 * (/conectividade, com a sessão do SIG). As respostas seguem o padrão do TI: { data, meta } ou { error, codigo }.
 */

/** O pedido veio do servidor do Next (a rede interna do contêiner ou o próprio computador): os cabeçalhos dele valem. */
const DA_REDE_INTERNA = /^(::ffff:)?(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|^::1$|^f[cd]/i;
const doProxy = (request: Request) => DA_REDE_INTERNA.test(request.socket.remoteAddress ?? "");
const limpar = (ip: string) => ip.trim().replace(/^::ffff:/i, "");

/**
 * O endereço de quem chama: o último do X-Forwarded-For que o servidor do Next (ou o proxy HTTPS do TI, na frente dele)
 * acrescenta; fora disso, o da conexão. Sem o proxy do TI, o aplicativo pode mandar o próprio cabeçalho (o Next guarda o
 * que vier): só com o proxy, e a porta do SIG fechada sem ele, o endereço é confiável.
 */
export function enderecoDe(request: Request) {
  const xff = request.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim() && doProxy(request)) return limpar(xff.split(",").pop() ?? "");
  return request.socket.remoteAddress ? limpar(request.socket.remoteAddress) : null;
}

/**
 * O pedido chegou por HTTPS: o X-Forwarded-Proto do Next (ou do proxy do TI) ou a própria conexão. Como o endereço, só é
 * confiável com o proxy do TI, que reescreve o cabeçalho — por isso a API em "https" é só para depois do proxy.
 */
export function httpsDe(request: Request) {
  const proto = request.headers["x-forwarded-proto"];
  if (typeof proto === "string" && doProxy(request)) return proto.split(",")[0]?.trim() === "https";
  return request.secure;
}

const origemDe = (request: Request): Origem => ({ endereco: enderecoDe(request), userAgent: request.headers["user-agent"] ?? null, https: httpsDe(request) });

function erro(response: Response, e: unknown) {
  if (e instanceof ApiError) return response.status(e.status).json({ error: e.message, ...(e.codigo ? { codigo: e.codigo } : {}) });
  throw e;
}

/** O token da API no cabeçalho Authorization: Bearer (o da sessão do SIG não vale aqui). */
export async function autenticacaoDaApi(request: Request, response: Response, next: NextFunction) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return response.status(401).json({ error: "Informe o token no cabeçalho Authorization: Bearer <token> (peça o token em POST /api/v1/token).", codigo: "SEM_TOKEN" });
  }
  let sub: string;
  try {
    const payload = verifyToken(header.slice("Bearer ".length));
    if (payload.escopo !== "api") throw new Error("escopo");
    sub = payload.sub;
  } catch {
    return response.status(401).json({ error: "Token inválido ou vencido: peça outro em POST /api/v1/token.", codigo: "TOKEN_INVALIDO" });
  }
  try {
    const usuario = await carregarUsuario({ id: sub });
    if (!usuario) return response.status(401).json({ error: "Usuário inativo ou sem acesso.", codigo: "USUARIO_INATIVO" });
    const { senhaHash: _, ...user } = usuario;
    request.user = user;
    return next();
  } catch (e) {
    return next(e);
  }
}

const limite = { error: "Muitos pedidos. Tente de novo em alguns minutos.", codigo: "LIMITE_DE_PEDIDOS" };
/** O pedido do token: 20 tentativas erradas por e-mail e 30 por endereço, a cada 15 minutos (o certo não conta). */
export const tokenPorEmail = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (request) => String((request.body as { email?: unknown } | undefined)?.email ?? "").trim().toLowerCase() || "sem-email",
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: limite,
});
export const tokenPorEndereco = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: (request) => enderecoDe(request) ?? "sem-endereco",
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: limite,
});
/** Os dados: 120 pedidos por minuto por usuário. */
export const pedidosPorUsuario = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: (request) => request.user?.sub ?? enderecoDe(request) ?? "sem-usuario",
  standardHeaders: true,
  legacyHeaders: false,
  message: limite,
});

const tokenSchema = z.object({ email: z.string().trim().email().max(200), senha: z.string().min(1).max(200) });
const codigoSchema = z.string().regex(/^[a-z][a-z-]{0,39}$/);
/** A consulta (?a=1&b=2), só com os textos (um parâmetro repetido vale o primeiro). */
const consultaDe = (request: Request) =>
  Object.fromEntries(Object.entries(request.query).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => typeof v === "string")) as Record<string, string>;
const diasSchema = z.coerce.number().int().refine((d) => [7, 30, 90].includes(d)).default(30);
const bloqueioSchema = z.object({ tipo: z.enum(["API", "USUARIO", "ENDERECO"]), valor: z.string().trim().min(1).max(100), bloqueado: z.boolean() });

export const conectividadeController = {
  /** POST /v1/token: { email, senha } → o token da API (uma hora). */
  async token(request: Request, response: Response) {
    const origem = origemDe(request);
    try {
      exigirLigada(origem);
      const b = tokenSchema.safeParse(request.body);
      if (!b.success) return response.status(422).json({ error: "Informe o e-mail e a senha do SIG: { \"email\": \"…\", \"senha\": \"…\" }.", codigo: "PARAMETRO_INVALIDO" });
      return response.json({ data: await conectividadeService.emitirToken(b.data.email, b.data.senha, origem) });
    } catch (e) {
      return erro(response, e);
    }
  },

  /** GET /v1/apis: as APIs que o usuário do token lê. */
  async catalogoDaApi(request: Request, response: Response) {
    try {
      const apis = await conectividadeService.catalogoDaApi(request.user!, origemDe(request));
      return response.json({ data: apis, meta: { total: apis.length } });
    } catch (e) {
      return erro(response, e);
    }
  },

  /** GET /v1/apis/:codigo?formato=dados|visual&…: os dados de uma API. */
  async executar(request: Request, response: Response) {
    const codigo = codigoSchema.safeParse(request.params.codigo);
    if (!codigo.success) return response.status(404).json({ error: "Código de API inválido.", codigo: "API_INEXISTENTE" });
    try {
      const r = await conectividadeService.executar(codigo.data, consultaDe(request), request.user!, origemDe(request));
      const { meta, ...data } = r;
      return response.json({ data: { api: codigo.data, ...data }, meta: { ...meta, geradoEm: new Date().toISOString() } });
    } catch (e) {
      return erro(response, e);
    }
  },

  /** GET /conectividade/catalogo: a tela. */
  async catalogo(request: Request, response: Response) {
    return response.json({ data: await conectividadeService.catalogo(request.user!) });
  },

  /** GET /conectividade/previa/:codigo: o resultado da API com a sessão do SIG (a prévia da tela). */
  async previa(request: Request, response: Response) {
    const codigo = codigoSchema.safeParse(request.params.codigo);
    if (!codigo.success) return response.status(404).json({ error: "Código de API inválido." });
    try {
      const r = await conectividadeService.previa(codigo.data, consultaDe(request), request.user!);
      const { meta, ...data } = r;
      return response.json({ data: { api: codigo.data, ...data }, meta });
    } catch (e) {
      return erro(response, e);
    }
  },

  /** GET /conectividade/acessos?dias=7|30|90. */
  async acessos(request: Request, response: Response) {
    const dias = diasSchema.safeParse(request.query.dias || undefined);
    if (!dias.success) return response.status(400).json({ error: "Período inválido: 7, 30 ou 90 dias." });
    return response.json({ data: await conectividadeService.acessos(dias.data, request.user!) });
  },

  /** PUT /conectividade/bloqueios: { tipo, valor, bloqueado }. */
  async bloquear(request: Request, response: Response) {
    const b = bloqueioSchema.safeParse(request.body);
    if (!b.success) return response.status(400).json({ error: "Bloqueio inválido." });
    // A API se bloqueia na tela APIs; o usuário e o endereço, na tela Acessos (13/11/2026).
    const exige = b.data.tipo === "API" ? "biblioteca_apis:editar" : "conectividade_acessos.apis:editar";
    if (!request.user!.permissions.includes(exige)) {
      return response.status(403).json({ error: b.data.tipo === "API" ? "Bloquear uma API pede Editar na tela APIs." : "Bloquear um usuário ou um endereço pede Editar na tela Acessos." });
    }
    return response.json({ data: await conectividadeService.bloquear(b.data.tipo, b.data.valor, b.data.bloqueado, request.user!) });
  },
};
