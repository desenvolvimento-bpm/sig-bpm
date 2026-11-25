import { readFile } from "node:fs/promises";

import { getPrismaClient } from "../../../config/prisma.js";
import type { Prisma } from "../../../generated/prisma/client.js";
import { ArquivoInvalidoError, lerAba } from "../../../lib/xlsx.js";
import { logger } from "../../../utils/logger.js";
import { contasDosCreditos } from "../../impostos/creditosImpostosService.js";
import { caminhoDoArquivo } from "../arquivosImportados.js";
import { SEM_REGISTROS_NO_MES } from "../listas/processarLista.js";
import { escolherAba, recusarImportacao, registrarProgresso } from "../statusImportacao.js";
import { ABA_CREDITOS, chaveDaConta, lerCreditos, type ItemCredito, type LeituraCreditos, type RejeicaoCredito } from "./leituraCreditos.js";
import { descricaoDeOrigem, slugDaDRE } from "../../dre/descricaoDeOrigem.js";

class ArquivoRecusado extends Error {}

/** Um crédito da aba com a conta da Estrutura da DRE. */
export type CreditoDaConta = ItemCredito & { linhaDREId: string };

/** Uma conta da Estrutura da DRE: a atribuição e o nome. */
type ContaDaEstrutura = { atribuicao: string | null; codigo: string; descricao: string };
/** A chave da conta pela descrição de origem (25/11/2026): o arquivo com o nome de antes de uma troca. */
const chaveDeOrigem = (atribuicao: string | null, origem: string) => `${chaveDaConta(atribuicao, "")}#${origem}`;

/**
 * As linhas da aba nas contas dos créditos (Matérias Primas e Gastos Gerais Variáveis da Produção e o Frete e Descarga), pela
 * ATRIBUIÇÃO e pela CONTA: os créditos com a conta; as linhas de outra conta da Estrutura da DRE (Gastos Gerais Diretos e
 * Indiretos, montagem…), ignoradas (04/11/2026, pedido do Adão); e a rejeição das de conta que a Estrutura não tem.
 */
export function separarPorConta(itens: ItemCredito[], dosCreditos: Array<ContaDaEstrutura & { id: string }>, daEstrutura: ContaDaEstrutura[]) {
  // Pela Descrição atual ou pela de origem (25/11/2026: os nomes da Estrutura da DRE mudam a qualquer momento).
  const porChave = new Map(dosCreditos.flatMap((c) => [[chaveDaConta(c.atribuicao, c.descricao), c.id] as const, [chaveDeOrigem(c.atribuicao, descricaoDeOrigem(c.codigo)), c.id] as const]));
  const naEstrutura = new Set(daEstrutura.flatMap((c) => [chaveDaConta(c.atribuicao, c.descricao), chaveDeOrigem(c.atribuicao, descricaoDeOrigem(c.codigo))]));
  const creditos: CreditoDaConta[] = [];
  const ignoradas: ItemCredito[] = [];
  const rejeicoes: RejeicaoCredito[] = [];
  for (const i of itens) {
    const chave = chaveDaConta(i.atribuicao, i.conta);
    const deOrigem = chaveDeOrigem(i.atribuicao === undefined || i.atribuicao === null ? null : String(i.atribuicao), slugDaDRE(String(i.conta ?? "")));
    const linhaDREId = porChave.get(chave) ?? porChave.get(deOrigem);
    if (linhaDREId) creditos.push({ ...i, linhaDREId });
    else if (naEstrutura.has(chave) || naEstrutura.has(deOrigem)) ignoradas.push(i);
    else rejeicoes.push({ linha: i.linhaArquivo, codigo: "CONTA_DESCONHECIDA", mensagem: `${i.atribuicao} › ${i.conta}: a Estrutura da DRE não tem esta conta (a ATRIBUIÇÃO e a CONTA).` });
  }
  return { creditos, ignoradas, rejeicoes };
}

/** `separarPorConta` com as contas dos créditos e as contas (itens) da Estrutura da DRE. */
export async function comAsContas(itens: ItemCredito[]) {
  const [dosCreditos, daEstrutura] = await Promise.all([
    contasDosCreditos(),
    getPrismaClient().linhaDRE.findMany({ where: { ativo: true, tipo: "ITEM" }, select: { atribuicao: true, codigo: true, descricao: true } }),
  ]);
  return separarPorConta(itens, dosCreditos, daEstrutura);
}

/** O resumo da importação: a aba, as contas, as somas do Creditado e do Estornado do mês e as linhas de outras contas. */
export function resumoDosCreditos(
  aba: string,
  leitura: Extract<LeituraCreditos, { ok: true }>,
  creditos: CreditoDaConta[],
  ignoradas: ItemCredito[],
  extra: Record<string, unknown> = {},
) {
  const soma = (k: "creditado" | "estornado") => Math.round(creditos.reduce((s, i) => s + i[k], 0) * 100) / 100;
  return { aba, contas: creditos.length, creditado: soma("creditado"), estornado: soma("estornado"), foraDoMes: leitura.foraDoMes, foraDasContas: ignoradas.length, ...extra };
}

/**
 * Grava os créditos do mês na transação: apaga os da competência (as importações anteriores do tipo ficam substituídas) e grava
 * os novos. A importação `importacaoId` já existe.
 */
export async function gravarCreditosDoMes(tx: Prisma.TransactionClient, competenciaId: string, importacaoId: string, creditos: CreditoDaConta[], agora = new Date()) {
  const anteriores = (
    await tx.importacao.findMany({ where: { competenciaId, tipo: "CREDITOS_IMPOSTOS", status: "CONCLUIDA", substituidaEm: null, id: { not: importacaoId } }, select: { id: true } })
  ).map((a) => a.id);
  await tx.creditoImposto.deleteMany({ where: { competenciaId } });
  if (anteriores.length) await tx.importacao.updateMany({ where: { id: { in: anteriores } }, data: { substituidaEm: agora } });
  await tx.creditoImposto.createMany({
    data: creditos.map((i) => ({ competenciaId, importacaoId, unidade: i.unidade, linhaDREId: i.linhaDREId, creditado: i.creditado, estornado: i.estornado, linhaArquivo: i.linhaArquivo })),
  });
  return anteriores;
}

/**
 * Importa os Créditos de Impostos do mês (aba Impostos (Lista) do LISTAS REALIZADO (RESULTADOS), 04/11/2026), substituindo a
 * importação anterior do mesmo tipo na competência. Não entra na apuração (importar não pede reapuração): a tela Impostos, a
 * aba Impostos dos Resultados Empresariais e o Realizado por Obra leem os créditos na hora.
 */
export async function processarCreditos(importacaoId: string): Promise<void> {
  const prisma = getPrismaClient();
  try {
    const importacao = await prisma.importacao.findUniqueOrThrow({
      where: { id: importacaoId },
      select: { hashArquivo: true, competenciaId: true, competencia: { select: { ano: true, mes: true } } },
    });
    const aba = lerAba(await readFile(caminhoDoArquivo(importacao.hashArquivo)), escolherAba([ABA_CREDITOS]));
    await registrarProgresso(importacaoId, 40);
    const { ano, mes } = importacao.competencia;
    const leitura = lerCreditos(aba.linhas, ano, mes);
    if (!leitura.ok) throw new ArquivoRecusado(leitura.motivo);
    if (leitura.itens.length === 0) throw new ArquivoRecusado(`A aba "${aba.nome}" ${SEM_REGISTROS_NO_MES} ${String(mes).padStart(2, "0")}/${ano}.`);
    const { creditos, ignoradas, rejeicoes } = await comAsContas(leitura.itens);
    if (creditos.length === 0)
      throw new ArquivoRecusado("Nenhuma linha do mês é de uma conta de Matérias Primas ou de Gastos Gerais Variáveis da Produção nem do Frete e Descarga. Nada foi gravado.");
    await registrarProgresso(importacaoId, 60);

    const competenciaId = importacao.competenciaId;
    const todas = [...leitura.rejeicoes, ...rejeicoes];
    await prisma.$transaction(
      async (tx) => {
        const competencia = await tx.competencia.findUniqueOrThrow({ where: { id: competenciaId }, select: { status: true } });
        if (competencia.status === "FECHADA") throw new ArquivoRecusado("A competência foi fechada enquanto o arquivo era processado. Nada foi gravado.");
        await gravarCreditosDoMes(tx, competenciaId, importacaoId, creditos);
        await tx.importacao.update({
          where: { id: importacaoId },
          data: {
            status: "CONCLUIDA",
            progresso: 100,
            linhasLidas: leitura.itens.length + leitura.rejeicoes.length,
            linhasAceitas: creditos.length,
            linhasRejeitadas: todas.length,
            linhasIgnoradas: leitura.foraDoMes,
            relatorioErros: todas,
            resumo: resumoDosCreditos(aba.nome, leitura, creditos, ignoradas),
          },
        });
      },
      { timeout: 120_000 },
    );
    logger("info", "Créditos de impostos importados", { importacaoId, contas: creditos.length });
  } catch (error) {
    if (error instanceof ArquivoRecusado || error instanceof ArquivoInvalidoError) {
      await recusarImportacao(importacaoId, error.message);
      return;
    }
    logger("error", "Falha ao processar os créditos de impostos", { importacaoId, error: error instanceof Error ? error.message : String(error) });
    await recusarImportacao(importacaoId, "Erro inesperado no processamento. Nada foi gravado. Se persistir, encaminhe o arquivo ao responsável pelo sistema.");
  }
}
