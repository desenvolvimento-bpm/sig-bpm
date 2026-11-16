/**
 * Os tipos do colaborador (16/11/2026, pedido do Adão: sem as senioridades, só as funções contam; o Aprendiz e o Estagiário,
 * que eram senioridades, passam a ser tipos): CLT, PJ, Aprendiz (o Jovem Aprendiz: FGTS de 2% nos cenários) e Estagiário
 * (os estagiários e os bolsistas da Lei 11.788/2008: sem encargos nos cenários). Valem no Lançamento Inicial, nas
 * movimentações do Quadro de Lotação e no Quadro de Lotação dos cenários analíticos.
 */
export type TipoDoColaborador = "CLT" | "PJ" | "APRENDIZ" | "ESTAGIARIO";
export const TIPOS_DO_COLABORADOR: TipoDoColaborador[] = ["CLT", "PJ", "APRENDIZ", "ESTAGIARIO"];
export const ROTULO_DO_TIPO: Record<TipoDoColaborador, string> = { CLT: "CLT", PJ: "PJ", APRENDIZ: "Aprendiz", ESTAGIARIO: "Estagiário" };

/** O Tipo pelo texto de uma planilha (CLT, PJ, Aprendiz ou Estagiário, sem diferença de maiúsculas e acentos), ou nulo. */
export function tipoDoTexto(v: string): TipoDoColaborador | null {
  const t = v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
  return (TIPOS_DO_COLABORADOR as string[]).includes(t) ? (t as TipoDoColaborador) : null;
}
