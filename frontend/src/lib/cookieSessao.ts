import type { NextRequest } from "next/server";

/**
 * O cookie da sessão (15/10/2026). Um nome por ambiente: o navegador não separa os cookies pela porta, e a versão de
 * produção (porta 3000) e a de desenvolvimento (porta 3100), no mesmo computador, derrubariam a sessão uma da outra.
 */
// O teste (21/10/2026, porta 3200) e a base teste Pré-Contestações (16/11/2026, porta 3300) têm o deles: o mesmo banco do
// desenvolvimento (cada um no seu esquema), mas outra compilação.
export const COOKIE_SESSAO =
  process.env.NEXT_PUBLIC_AMBIENTE === "teste"
    ? "bpm_token_teste"
    : process.env.NEXT_PUBLIC_AMBIENTE === "pre-contestacoes"
      ? "bpm_token_pre_contestacoes"
      : process.env.NODE_ENV === "production"
        ? "bpm_token"
        : "bpm_token_dev";

/**
 * O cookie só "seguro" (enviado só por https) quando o pedido chegou por https — direto ou por um proxy na frente
 * (x-forwarded-proto), como num servidor com certificado. No acesso por http na rede interna (http://192.168…), um
 * cookie seguro não seria guardado pelo navegador, e o login não entraria.
 */
export const cookieSeguro = (request: NextRequest) =>
  (request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? request.nextUrl.protocol.replace(":", "")) === "https";
