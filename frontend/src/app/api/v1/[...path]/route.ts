import { connection } from "next/server";
import { NextRequest, NextResponse } from "next/server";

import { getBackendUrl } from "@/lib/backend";
import { origemDoPedido } from "@/lib/conexaoDoPedido";
import { AVISO_SEM_BACKEND, CODIGO_DA_PUBLICACAO } from "@/lib/publicacaoServidor";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  return repassar(request, context, "GET");
}

export async function POST(request: NextRequest, context: RouteContext) {
  return repassar(request, context, "POST");
}

/**
 * A API da Biblioteca de APIs para outros aplicativos (24/10/2026): /api/v1/… vai ao /v1/… do backend. Repassa só o
 * Authorization do aplicativo (o token da API; nunca o cookie da sessão do SIG), o tipo do conteúdo e o navegador, e
 * diz ao backend de onde veio o pedido e por qual protocolo (`origemDoPedido`, 27/11/2026, pedido do TI): da conexão do
 * IIS do TI (a PROXY_CONFIAVEL, 192.168.0.10), o último endereço do X-Forwarded-For e o X-Forwarded-Proto que ele manda;
 * de qualquer outra conexão, o endereço e o protocolo da própria conexão — o X-Forwarded-* que o aplicativo mandar não
 * vale. A regra do HTTPS (a API_EXTERNA) e a dos bloqueios ficam no backend.
 */
async function repassar(request: NextRequest, context: RouteContext, metodo: "GET" | "POST") {
  await connection();
  const { path } = await context.params;
  const caminho = path.join("/");
  if (caminho.includes("..")) return NextResponse.json({ error: "Caminho inválido." }, { status: 400 });

  const url = new URL(request.url);
  const headers = new Headers();
  for (const h of ["authorization", "content-type", "accept", "user-agent"]) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  const origem = origemDoPedido(request.headers);
  if (origem.endereco) headers.set("x-forwarded-for", origem.endereco);
  headers.set("x-forwarded-proto", origem.protocolo);

  const init: RequestInit = { method: metodo, headers, cache: "no-store" };
  if (metodo === "POST") {
    const corpo = await request.arrayBuffer();
    if (corpo.byteLength > 0) init.body = corpo;
  }
  try {
    const response = await fetch(`${getBackendUrl()}/v1/${caminho}${url.search}`, init);
    const repassados: Record<string, string> = { "Content-Type": response.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" };
    // O limite de pedidos (429): quando tentar de novo.
    for (const h of ["retry-after", "ratelimit-limit", "ratelimit-remaining", "ratelimit-reset"]) {
      const v = response.headers.get(h);
      if (v) repassados[h] = v;
    }
    return new NextResponse(await response.arrayBuffer(), { status: response.status, headers: repassados });
  } catch {
    return NextResponse.json({ error: AVISO_SEM_BACKEND, codigo: CODIGO_DA_PUBLICACAO }, { status: 503 });
  }
}
