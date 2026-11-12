/**
 * A função por senioridade (11/11/2026, pedido do Adão): a mesma função (o nome) é cadastrada uma vez para cada senioridade,
 * com a sua descrição, competências e atividades. A função escolhida para um colaborador (o Lançamento Inicial), uma
 * movimentação do Quadro de Lotação ou uma linha do Quadro de Lotação de um cenário tem de ser a da senioridade dele; a
 * função cadastrada sem senioridade vale para todas.
 */

/** A função serve na senioridade: a dela, ou qualquer uma quando ela não tem. */
export const funcaoServeNaSenioridade = (funcao: { senioridadeId: string | null }, senioridadeId: string) => !funcao.senioridadeId || funcao.senioridadeId === senioridadeId;

/** O nome da função com a senioridade, para as listas de escolha ("Conferente · Pleno"). */
export const rotuloDaFuncao = (f: { nome: string; senioridade?: { nome: string } | null }) => (f.senioridade ? `${f.nome} · ${f.senioridade.nome}` : f.nome);

/** A recusa de uma função que não é da senioridade escolhida (nula se serve). */
export function recusaDaFuncao(funcao: { nome: string; senioridadeId: string | null; senioridade?: { nome: string } | null }, senioridadeId: string) {
  if (funcaoServeNaSenioridade(funcao, senioridadeId)) return null;
  return `A função ${rotuloDaFuncao(funcao)} é de outra senioridade: escolha a função da senioridade do colaborador.`;
}
