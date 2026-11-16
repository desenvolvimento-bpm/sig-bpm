// Carrega o .env do modo (.env.development ou .env.production) e o .env comum antes de qualquer leitura de
// process.env (15/10/2026; antes, só o .env). Sem isto, todas as variáveis caem no valor padrão — inclusive
// DATABASE_URL e JWT_SECRET.
import "./ambiente.js";

import { z } from "zod";

const WEAK_SECRETS = new Set([
  "altere-em-producao",
  "change-me",
  "secret",
  "jwt-secret",
  "use-uma-string-aleatoria-com-pelo-menos-32-caracteres", // o do .env.example
]);

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().default(3001),
    DATABASE_URL: z.string().optional(),
    JWT_SECRET: z.string().default("altere-em-producao"),
    JWT_EXPIRES_IN: z.string().default("7d"),
    REDIS_URL: z.string().optional(),
    CORS_ORIGIN: z.string().default("http://localhost:3000"),
    MSSQL_SERVER: z.string().optional(),
    MSSQL_DATABASE: z.string().optional(),
    MSSQL_USER: z.string().optional(),
    MSSQL_PASSWORD: z.string().optional(),
    // "true"/"false", "1"/"0", "sim"... — z.coerce.boolean() tomaria "false" por verdadeiro.
    ENABLE_SWAGGER: z.stringbool().optional(),
    ENABLE_AUDIT: z.stringbool().optional(),
    /**
     * A API da Biblioteca de APIs (24/10/2026), que só o TI liga (o arquivo .env): "desligada" (o padrão da produção)
     * recusa todo pedido, antes de conferir a senha; "https" aceita só o pedido que o proxy HTTPS do TI marca como
     * HTTPS (a regra do TI, Docs/projeto/anexos/RNF-API-SEGURA.md) — o proxy reescreve o X-Forwarded-Proto e acrescenta
     * o X-Forwarded-For, e a porta do SIG não fica acessível sem ele; "http" aceita também o HTTP (o padrão fora da
     * produção). Um valor errado desliga a API, sem derrubar o SIG.
     */
    API_EXTERNA: z.enum(["desligada", "https", "http"]).optional().catch("desligada"),
    TOTVS_WSDL_URL: z.string().optional(),
    TOTVS_USER: z.string().optional(),
    TOTVS_PASSWORD: z.string().optional(),
    /** Onde os arquivos importados ficam guardados, nomeados pelo hash. */
    UPLOAD_DIR: z.string().default("./uploads"),
    UPLOAD_MAX_MB: z.coerce.number().positive().default(50),
    /** Sincronização dos fornecedores (FCFO) pelo wsConsultaSQL do TOTVS RM — somente leitura. */
    TOTVS_CONSULTA_SQL_URL: z.string().optional(),
    TOTVS_CODCOLIGADA: z.coerce.number().int().default(1),
    TOTVS_CODSISTEMA: z.string().default("T"),
    FORNECEDOR_SYNC_ATIVO: z.stringbool().default(true),
    CENTRO_CUSTO_SYNC_ATIVO: z.stringbool().default(true),
    CONTA_CONTABIL_SYNC_ATIVO: z.stringbool().default(true),
    PRODUTO_SYNC_ATIVO: z.stringbool().default(true),
    TIPO_MOVIMENTO_SYNC_ATIVO: z.stringbool().default(true),
    /** Intervalo do ciclo de cadastros do TOTVS: 2 horas (7.200.000 ms). */
    FORNECEDOR_SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(7_200_000),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV !== "production") return;

    if (WEAK_SECRETS.has(data.JWT_SECRET) || data.JWT_SECRET.length < 32) {
      ctx.addIssue({
        code: "custom",
        message:
          "JWT_SECRET deve ter pelo menos 32 caracteres e não pode ser valor padrão em produção",
        path: ["JWT_SECRET"],
      });
    }
  });

const parsed = envSchema.parse(process.env);
if (process.env.API_EXTERNA && process.env.API_EXTERNA !== parsed.API_EXTERNA) {
  console.warn(`API_EXTERNA="${process.env.API_EXTERNA}" não é desligada, https nem http: as APIs da Central de Conectividade ficam desligadas.`);
}

export const env = {
  ...parsed,
  enableSwagger: parsed.ENABLE_SWAGGER ?? parsed.NODE_ENV !== "production",
  enableAudit: parsed.ENABLE_AUDIT ?? true,
  apiExterna: parsed.API_EXTERNA ?? (parsed.NODE_ENV === "production" ? "desligada" : "http"),
  totvsConfigured: Boolean(parsed.TOTVS_WSDL_URL),
  /** A sincronização de fornecedores só roda com URL, usuário e senha do TOTVS. */
  fornecedorSyncConfigurada: Boolean(parsed.TOTVS_CONSULTA_SQL_URL && parsed.TOTVS_USER && parsed.TOTVS_PASSWORD),
};
