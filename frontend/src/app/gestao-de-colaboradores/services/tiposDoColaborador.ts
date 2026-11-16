/**
 * Os tipos do colaborador (16/11/2026, pedido do Adão: sem as senioridades, só as funções contam; o Aprendiz e o Estagiário
 * passam a ser tipos): CLT, PJ, Aprendiz e Estagiário — no Lançamento Inicial, nas movimentações do Quadro de Lotação e no
 * Quadro de Lotação dos cenários analíticos.
 */
export type TipoDoColaborador = "CLT" | "PJ" | "APRENDIZ" | "ESTAGIARIO";
export const TIPOS_DO_COLABORADOR: TipoDoColaborador[] = ["CLT", "PJ", "APRENDIZ", "ESTAGIARIO"];
export const ROTULO_DO_TIPO: Record<TipoDoColaborador, string> = { CLT: "CLT", PJ: "PJ", APRENDIZ: "Aprendiz", ESTAGIARIO: "Estagiário" };
/** O plural de cada tipo, nas contagens ("8 Aprendizes"). */
export const ROTULO_DO_TIPO_PLURAL: Record<TipoDoColaborador, string> = { CLT: "CLT", PJ: "PJ", APRENDIZ: "Aprendizes", ESTAGIARIO: "Estagiários" };
/** O rótulo de um tipo vindo da API (o próprio valor, se for outro). */
export const rotuloDoTipo = (t: string) => ROTULO_DO_TIPO[t as TipoDoColaborador] ?? t;

/** "A, B e C". */
export const emLista = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}` : (xs[0] ?? ""));
