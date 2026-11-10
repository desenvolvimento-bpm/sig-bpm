/**
 * O erro de regra dos cadastros editáveis, com o status HTTP que o controller devolve (num arquivo próprio desde 06/11/2026,
 * para as definições da Gestão de Colaboradores o usarem sem importar as definições de volta).
 */

/** Uma correção que o formulário aplica com um clique (24/10/2026: as combinações de linha e rateio de uma conta). */
export type Sugestao = { rotulo: string; detalhe?: string; valores: Record<string, unknown> };

export class RegraCadastroError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
    readonly sugestoes?: Sugestao[],
  ) {
    super(message);
  }
}
