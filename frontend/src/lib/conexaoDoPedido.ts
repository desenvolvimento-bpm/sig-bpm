/**
 * A conexão de cada pedido e a origem dele para a API (27/11/2026, pedido do TI).
 *
 * O Next só preenche o X-Forwarded-For e o X-Forwarded-Proto quando o pedido não os traz, e as rotas não veem a conexão.
 * Por isso o instrumentation.ts (`marcarConexao`) grava, em cada pedido que chega ao servidor do Next, o endereço e o
 * protocolo da conexão nos cabeçalhos abaixo, sempre reescritos: o que o aplicativo mandar com esses nomes é trocado.
 */
export const CABECALHO_DO_ENDERECO = "x-sig-conexao-endereco";
export const CABECALHO_DO_PROTOCOLO = "x-sig-conexao-protocolo";

/**
 * A marca ativa neste processo (o `marcarConexao` já rodou). Sem ela, os cabeçalhos acima podem ter vindo do aplicativo:
 * não valem.
 */
export const MARCA_ATIVA = Symbol.for("sig.conexaoMarcada");
export const conexaoMarcada = () => (globalThis as { [MARCA_ATIVA]?: boolean })[MARCA_ATIVA] === true;

/** O endereço sem o prefixo do IPv6 que o Node põe no IPv4 (::ffff:192.168.0.10). */
export const semPrefixoIpv6 = (ip: string) => ip.trim().replace(/^::ffff:/i, "");

/**
 * Só o endereço de um item do X-Forwarded-For: sem a porta, se vier (o IIS pode mandar "IP:porta": 192.168.10.25:51234 ou
 * [fe80::1]:51234), e sem o prefixo do IPv6. O IPv6 sem colchetes fica como está (os dois-pontos são dele).
 */
export function soOEndereco(item: string) {
  const v = item.trim();
  const ipv6 = /^\[([^\]]+)\](?::\d+)?$/.exec(v);
  if (ipv6) return semPrefixoIpv6(ipv6[1]);
  const ipv4 = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(v);
  return semPrefixoIpv6(ipv4 ? ipv4[1] : v);
}

/**
 * Os servidores de entrada em que o SIG confia (o IIS do TI, 192.168.0.10, que repassa o http://sig.bpm.interno): só deles
 * valem o X-Forwarded-For e o X-Forwarded-Proto. A variável PROXY_CONFIAVEL troca a lista (os endereços separados por vírgula).
 */
export function proxiesConfiaveis(valor = process.env.PROXY_CONFIAVEL) {
  return new Set((valor?.trim() ? valor : "192.168.0.10").split(",").map(semPrefixoIpv6).filter(Boolean));
}

type Cabecalhos = { get(nome: string): string | null };
export type OrigemDoPedido = { endereco: string | null; protocolo: "http" | "https" };

/**
 * De onde veio o pedido, para a API (a Auditoria, os bloqueios por endereço e a regra do HTTPS):
 * - da conexão do IIS: o último endereço do X-Forwarded-For (o que o IIS acrescenta; sem a porta, se vier) e o
 *   X-Forwarded-Proto dele;
 * - de qualquer outra conexão: o endereço e o protocolo da própria conexão (o X-Forwarded-* do aplicativo não vale).
 * Sem a marca da conexão (o instrumentation.ts não rodou, ou o pedido chegou antes dele), endereço nulo e HTTP: nada do
 * aplicativo vale, e o backend registra o endereço do servidor do Next.
 */
export function origemDoPedido(h: Cabecalhos, confiaveis = proxiesConfiaveis(), marcada = conexaoMarcada()): OrigemDoPedido {
  const conexao = marcada ? h.get(CABECALHO_DO_ENDERECO)?.trim() : null;
  if (!conexao) return { endereco: null, protocolo: "http" };
  const daConexao = semPrefixoIpv6(conexao);
  const protocoloDaConexao = h.get(CABECALHO_DO_PROTOCOLO) === "https" ? "https" : "http";
  if (!confiaveis.has(daConexao)) return { endereco: daConexao, protocolo: protocoloDaConexao };
  const xff = (h.get("x-forwarded-for") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const xfp = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim().toLowerCase();
  return {
    endereco: xff.length ? soOEndereco(xff[xff.length - 1]) : daConexao,
    protocolo: xfp === "https" || xfp === "http" ? xfp : protocoloDaConexao,
  };
}
