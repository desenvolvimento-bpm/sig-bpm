/**
 * A função por senioridade (11/11/2026, pedido do Adão): a mesma função (o nome) é cadastrada uma vez para cada senioridade;
 * a sem senioridade vale para todas. A linha do Quadro de Lotação dos cenários mostra a função com a senioridade ao lado e
 * mantém as duas de acordo; a Nova Movimentação do Quadro de Lotação mostra a função com a senioridade ao lado e leva a dela.
 */
export type FuncaoComSenioridade = { id: string; nome: string; senioridadeId: string | null };

/** As funções para a lista de escolha: as que servem na senioridade escolhida (sem ela, todas), com a senioridade ao lado. */
export function opcoesDeFuncao(funcoes: FuncaoComSenioridade[], senioridades: Array<{ id: string; nome: string }>, senioridadeId: string) {
  const nomeDa = new Map(senioridades.map((s) => [s.id, s.nome]));
  return funcoes
    .filter((f) => !senioridadeId || !f.senioridadeId || f.senioridadeId === senioridadeId)
    .map((f) => ({ id: f.id, nome: f.senioridadeId && nomeDa.has(f.senioridadeId) ? `${f.nome} · ${nomeDa.get(f.senioridadeId)}` : f.nome }));
}

/**
 * A função de acordo com a senioridade nova: a mesma, se serve; senão, a do mesmo nome nessa senioridade (ou a sem
 * senioridade); sem nenhuma, vazia.
 */
export function funcaoNaSenioridade(funcoes: FuncaoComSenioridade[], funcaoId: string, senioridadeId: string) {
  const atual = funcoes.find((f) => f.id === funcaoId);
  if (!atual || !senioridadeId || !atual.senioridadeId || atual.senioridadeId === senioridadeId) return funcaoId;
  const mesmoNome = funcoes.filter((f) => f.nome.toLocaleLowerCase("pt-BR") === atual.nome.toLocaleLowerCase("pt-BR"));
  return (mesmoNome.find((f) => f.senioridadeId === senioridadeId) ?? mesmoNome.find((f) => !f.senioridadeId))?.id ?? "";
}
