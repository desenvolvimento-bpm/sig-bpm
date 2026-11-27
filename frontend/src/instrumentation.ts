/**
 * Roda uma vez, quando o servidor do Next sobe (27/11/2026, pedido do TI): marca em cada pedido o endereço e o protocolo
 * da conexão (lib/marcarConexao.ts), para a API (/api/v1) aceitar o X-Forwarded-For só do IIS do TI.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { marcarConexao } = await import("./lib/marcarConexao");
  marcarConexao();
}
