import type { getPrismaClient } from "../../config/prisma.js";
import { ESTRUTURA_INICIAL_INDICADORES } from "./estruturaInicialIndicadores.js";
import { idPeloOriginal } from "./indicadoresDoSistema.js";
import { gravarFormulasPeloId } from "./referenciasDosIndicadores.js";

/**
 * Grava os indicadores da carga inicial que ainda não estão no cadastro (pelo nome ou, desde 19/11/2026, pelo ID da tabela
 * do sistema: o renomeado não volta com o nome antigo); os já cadastrados ficam como estão. Os novos, com o ID da tabela.
 */
export async function carregarEstruturaIndicadores(prisma: ReturnType<typeof getPrismaClient>) {
  const cadastrados = await prisma.indicadorEstrutura.findMany({ select: { id: true, nome: true } });
  const existentes = new Set(cadastrados.map((i) => i.nome));
  const ids = new Set(cadastrados.map((i) => i.id));
  let criados = 0;
  for (const [i, ind] of ESTRUTURA_INICIAL_INDICADORES.entries()) {
    const id = idPeloOriginal(ind.nome);
    if (existentes.has(ind.nome) || (id && ids.has(id))) continue;
    await prisma.indicadorEstrutura.create({ data: { ...ind, ...(id ? { id } : {}), ordem: i + 1 } });
    criados++;
  }
  // As fórmulas da carga citam os indicadores pelo nome: gravadas pelo ID (25/11/2026).
  if (criados) await gravarFormulasPeloId(prisma);
  return { total: ESTRUTURA_INICIAL_INDICADORES.length, criados };
}

export type MudancaNaEstrutura = { nome: string; campo: "novo" | "ordem" | "numero"; de?: string | number; para: string | number };

/**
 * Traz para o cadastro os indicadores novos da carga inicial e a numeração e a ordem dela (13/10/2026: os 4 do Custo do
 * Produto Vendido, no grupo Geral, e a renumeração dos seguintes): cria os que faltam, na posição da planilha, e acerta a
 * ordem de todos e a numeração dos do `grupo`. O resto do que o usuário editou no cadastro (nome, fórmula, sentido,
 * descrição…) não muda; os indicadores criados no cadastro, fora da carga inicial, vão para o fim, na ordem em que
 * estavam. Com `simular`, só diz o que mudaria.
 */
export async function sincronizarEstruturaIndicadores(prisma: ReturnType<typeof getPrismaClient>, grupo: string, simular: boolean) {
  const atuais = await prisma.indicadorEstrutura.findMany({ orderBy: { ordem: "asc" } });
  const porNome = new Map(atuais.map((i) => [i.nome, i]));
  // Pelo ID da tabela do sistema também (19/11/2026): o renomeado é o mesmo indicador.
  const porId = new Map(atuais.map((i) => [i.id, i]));
  const daCargaAtual = (nome: string) => porNome.get(nome) ?? porId.get(idPeloOriginal(nome) ?? "");
  const daCarga = new Set(ESTRUTURA_INICIAL_INDICADORES.flatMap((i) => [i.nome, daCargaAtual(i.nome)?.nome ?? i.nome]));
  const mudancas: MudancaNaEstrutura[] = [];
  // As gravações do Prisma só rodam no $transaction (são preguiçosas): na simulação, nada vai ao banco.
  const gravar = [];
  for (const [k, ind] of ESTRUTURA_INICIAL_INDICADORES.entries()) {
    const ordem = k + 1;
    const atual = daCargaAtual(ind.nome);
    if (!atual) {
      mudancas.push({ nome: ind.nome, campo: "novo", para: `${ind.grupo} ${ind.numero} (ordem ${ordem})` });
      const id = idPeloOriginal(ind.nome);
      gravar.push(prisma.indicadorEstrutura.create({ data: { ...ind, ...(id ? { id } : {}), ordem } }));
      continue;
    }
    const dados: { ordem?: number; numero?: string } = {};
    if (atual.ordem !== ordem) {
      mudancas.push({ nome: ind.nome, campo: "ordem", de: atual.ordem, para: ordem });
      dados.ordem = ordem;
    }
    if (ind.grupo === grupo && atual.numero !== ind.numero) {
      mudancas.push({ nome: ind.nome, campo: "numero", de: atual.numero, para: ind.numero });
      dados.numero = ind.numero;
    }
    if (Object.keys(dados).length) gravar.push(prisma.indicadorEstrutura.update({ where: { id: atual.id }, data: dados }));
  }
  // Os criados no cadastro, depois dos da carga.
  let ordem = ESTRUTURA_INICIAL_INDICADORES.length;
  for (const i of atuais.filter((i) => !daCarga.has(i.nome))) {
    ordem++;
    if (i.ordem === ordem) continue;
    mudancas.push({ nome: i.nome, campo: "ordem", de: i.ordem, para: ordem });
    gravar.push(prisma.indicadorEstrutura.update({ where: { id: i.id }, data: { ordem } }));
  }
  if (!simular && gravar.length) {
    await prisma.$transaction(gravar);
    // As fórmulas dos indicadores criados citam os outros pelo nome: gravadas pelo ID (25/11/2026).
    await gravarFormulasPeloId(prisma);
  }
  return mudancas;
}
