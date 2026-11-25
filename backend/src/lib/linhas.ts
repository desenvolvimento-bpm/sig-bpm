/**
 * A forma com que as telas e as importações comparam uma linha do cadastro Linhas com o texto das planilhas: em
 * maiúsculas, com hífen no lugar dos espaços ("Turn-Key" e "TURN KEY" dão TURN-KEY).
 *
 * Desde 25/11/2026, o Código da linha nasce do Nome, nessa forma, na criação e não muda mais: é a chave das regras da
 * apuração (ESTACAS, MONTAGEM…), da receita prévia, do estoque e das premissas dos cenários. O Nome fica livre (as telas
 * mostram o Nome; as planilhas acham a linha pelo Código ou pelo Nome atual, `linhasPorChave`).
 */
export function chaveDaLinha(texto: string | number | boolean | null | undefined): string {
  return texto === null || texto === undefined ? "" : String(texto).trim().toUpperCase().replace(/\s*-\s*|\s+/g, "-");
}

/**
 * As linhas pelas chaves com que o texto de uma planilha as cita (25/11/2026): o Código e o Nome atual, os dois na forma
 * de chaveDaLinha. O Código vale antes do Nome; entre duas linhas com a mesma chave, a que vem depois em `linhas`
 * (as linhas de produto depois das de obra, na DRE do Comercial). `prefixo`: uma parte a mais da chave (o tipo da linha).
 */
export function linhasPorChave<T extends { codigo: string; nome: string }>(linhas: T[], prefixo: (l: T) => string = () => ""): Map<string, T> {
  const porChave = new Map<string, T>();
  for (const l of linhas) porChave.set(prefixo(l) + chaveDaLinha(l.nome), l);
  for (const l of linhas) porChave.set(prefixo(l) + chaveDaLinha(l.codigo), l);
  return porChave;
}
