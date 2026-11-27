import http, { type IncomingMessage, type Server } from "node:http";
import type { TLSSocket } from "node:tls";

import { CABECALHO_DO_ENDERECO, CABECALHO_DO_PROTOCOLO, MARCA_ATIVA } from "./conexaoDoPedido";

/**
 * Grava a conexão nos cabeçalhos de todo pedido HTTP do processo do Next (27/11/2026, pedido do TI; ver conexaoDoPedido.ts):
 * no evento "request" do servidor, antes do Next, o endereço e o protocolo da conexão, sempre reescritos. Uma vez só; no
 * fim, liga a marca do processo (sem ela, a rota da API não confia nesses cabeçalhos).
 */
export function marcarConexao(prototipo: Server = http.Server.prototype) {
  const global = globalThis as { [MARCA_ATIVA]?: boolean };
  if (global[MARCA_ATIVA]) return;
  const emitir = prototipo.emit;
  prototipo.emit = function (this: Server, evento: string | symbol, ...args: unknown[]) {
    if (evento === "request") {
      const pedido = args[0] as IncomingMessage;
      pedido.headers[CABECALHO_DO_ENDERECO] = pedido.socket?.remoteAddress ?? "";
      pedido.headers[CABECALHO_DO_PROTOCOLO] = (pedido.socket as TLSSocket | undefined)?.encrypted ? "https" : "http";
    }
    return emitir.call(this, evento, ...args);
  } as Server["emit"];
  global[MARCA_ATIVA] = true;
}
