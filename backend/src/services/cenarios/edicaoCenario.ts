import { getPrismaClient } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { LinhaEstrutura } from "../dre/apuracaoUnidades.js";
import { avaliarEstrutura } from "../dre/consolidacao.js";
import { estrutura } from "../dre/dreService.js";
import { codigosDaExpressao } from "../dre/expressao.js";

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;
type Tx = Prisma.TransactionClient;

/**
 * A edição da DRE de um cenário pela ferramenta (12/10/2026): as contas (linhas ITEM) das unidades se editam mês a
 * mês; os totais e o Consolidado são sempre calculados, como na apuração do realizado (apuracaoUnidades e
 * consolidacao): em cada unidade, os subtotais e totais saem das expressões da Estrutura da DRE com as contas dela;
 * no Consolidado, cada conta é a soma das unidades, e os totais saem das expressões com essas somas.
 */

export const UNIDADES = [1, 2, 3, 4, 5, 6, 7] as const;

/**
 * As linhas de uma unidade: as que a Estrutura da DRE atribui a ela e os totais cujas parcelas são todas dela (a
 * margem bruta e a de contribuição entram na Matriz; o EBITDA, que usa as despesas fixas, não) — a mesma regra da
 * apuração do realizado (daUnidade, em apuracaoUnidades).
 */
export function linhasDaUnidade(linhas: LinhaEstrutura[], u: number): Set<string> {
  const s = new Set(linhas.filter((l) => l.unidades.includes(u)).map((l) => l.codigo));
  for (let mudou = true; mudou; ) {
    mudou = false;
    for (const l of linhas) {
      if (s.has(l.codigo) || l.unidades.length > 0 || !l.expressao) continue;
      if (codigosDaExpressao(l.expressao).every((c) => s.has(c))) {
        s.add(l.codigo);
        mudou = true;
      }
    }
  }
  return s;
}

/** As contas que se editam numa unidade: as linhas ITEM atribuídas a ela. */
export const contasDaUnidade = (linhas: LinhaEstrutura[], u: number) => new Set(linhas.filter((l) => l.tipo === "ITEM" && l.unidades.includes(u)).map((l) => l.codigo));

/** As linhas do Consolidado: as de alguma unidade e os totais gerais. */
export const linhasDoConsolidado = (linhas: LinhaEstrutura[]) => new Set(linhas.filter((l) => l.tipo !== "SECAO").map((l) => l.codigo));

/**
 * Recalcula, nos meses dados, os totais das unidades dadas e o Consolidado inteiro. Os totais zerados não se
 * gravam (a tela mostra zero). Num mês sem nenhuma conta nas unidades, o Consolidado fica como está: um arquivo
 * importado só com a aba Consolidado não é apagado.
 */
export async function recalcular(tx: Tx, cenarioId: string, meses: number[], unidades: readonly number[], linhas?: LinhaEstrutura[]) {
  const est = linhas ?? (await estrutura());
  const porCodigo = new Map(est.map((l) => [l.codigo, l]));
  const porId = new Map(est.map((l) => [l.id, l]));
  const daUnidade = new Map(UNIDADES.map((u) => [u, linhasDaUnidade(est, u)]));
  const rs = await tx.cenarioResultado.findMany({ where: { cenarioId, mes: { in: meses }, visao: { in: [...UNIDADES] } }, select: { visao: true, mes: true, linhaDREId: true, valor: true } });
  for (const mes of meses) {
    const somas = new Map<string, Decimal>();
    let algumaConta = false;
    for (const u of UNIDADES) {
      const contas = new Map<string, Decimal>();
      for (const r of rs) {
        if (r.mes !== mes || r.visao !== u) continue;
        const l = porId.get(r.linhaDREId);
        if (l?.tipo !== "ITEM") continue;
        contas.set(l.codigo, r.valor);
        somas.set(l.codigo, (somas.get(l.codigo) ?? new Decimal(0)).plus(r.valor));
      }
      if (contas.size > 0) algumaConta = true;
      if (!unidades.includes(u)) continue;
      const relevantes = daUnidade.get(u)!;
      const totais = contas.size ? avaliarEstrutura(est, contas, (l) => relevantes.has(l.codigo)) : new Map<string, Decimal>();
      await tx.cenarioResultado.deleteMany({ where: { cenarioId, visao: u, mes, linhaDRE: { tipo: { not: "ITEM" } } } });
      const novos = [...totais].filter(([c, v]) => relevantes.has(c) && !v.isZero() && porCodigo.has(c));
      if (novos.length) await tx.cenarioResultado.createMany({ data: novos.map(([c, v]) => ({ cenarioId, visao: u, mes, linhaDREId: porCodigo.get(c)!.id, valor: v })) });
    }
    if (!algumaConta) continue;
    // O Consolidado: as contas somadas nas unidades e os totais pela estrutura.
    const totais = avaliarEstrutura(est, somas, () => true);
    await tx.cenarioResultado.deleteMany({ where: { cenarioId, visao: 0, mes } });
    const linhasConsolidado = [...somas, ...[...totais].filter(([, v]) => !v.isZero())].filter(([c]) => porCodigo.has(c));
    await tx.cenarioResultado.createMany({ data: linhasConsolidado.map(([c, v]) => ({ cenarioId, visao: 0, mes, linhaDREId: porCodigo.get(c)!.id, valor: v })) });
  }
}

export type Alteracao = { linha: string; mes: number; valor: number };

/**
 * Grava valores mensais de contas de uma unidade (1 a 5) e recalcula os totais dela e o Consolidado nos meses
 * alterados. Só as contas da unidade se editam: os totais, os percentuais e os valores por m³ são calculados.
 */
export async function gravarValores(cenarioId: string, visao: number, alteracoes: Alteracao[]) {
  if (!UNIDADES.includes(visao as (typeof UNIDADES)[number])) throw new ErroEdicao("O Consolidado soma as unidades: edite os valores nas abas delas.");
  const est = await estrutura();
  const contas = contasDaUnidade(est, visao);
  const porCodigo = new Map(est.map((l) => [l.codigo, l]));
  const fora = [...new Set(alteracoes.filter((a) => !contas.has(a.linha)).map((a) => porCodigo.get(a.linha)?.descricao ?? a.linha))];
  if (fora.length) throw new ErroEdicao(`Só as contas da unidade se editam (os totais são calculados): ${fora.slice(0, 5).join(", ")}.`);
  // A última alteração de cada conta e mês vale.
  const finais = new Map(alteracoes.map((a) => [`${a.linha}|${a.mes}`, a]));
  const meses = [...new Set([...finais.values()].map((a) => a.mes))].sort((a, b) => a - b);
  // Os valores de antes, para o histórico de reajustes (a soma antes e depois).
  const ids = [...new Set([...finais.values()].map((a) => porCodigo.get(a.linha)!.id))];
  const anteriores = await getPrismaClient().cenarioResultado.findMany({ where: { cenarioId, visao, mes: { in: meses }, linhaDREId: { in: ids } }, select: { linhaDREId: true, mes: true, valor: true } });
  const antes = new Map(anteriores.map((r) => [`${r.linhaDREId}|${r.mes}`, Number(r.valor)]));
  let somaAntes = 0;
  let somaDepois = 0;
  for (const a of finais.values()) {
    somaAntes += antes.get(`${porCodigo.get(a.linha)!.id}|${a.mes}`) ?? 0;
    somaDepois += a.valor;
  }
  const contasAlteradas = [...new Set([...finais.values()].map((a) => a.linha))].map((c) => ({ codigo: c, descricao: porCodigo.get(c)!.descricao }));
  await getPrismaClient().$transaction(
    async (tx) => {
      for (const a of finais.values()) {
        const linhaDREId = porCodigo.get(a.linha)!.id;
        const valor = new Decimal(a.valor.toFixed(4));
        await tx.cenarioResultado.upsert({
          where: { cenarioId_visao_linhaDREId_mes: { cenarioId, visao, linhaDREId, mes: a.mes } },
          create: { cenarioId, visao, linhaDREId, mes: a.mes, valor },
          update: { valor },
        });
      }
      await recalcular(tx, cenarioId, meses, [visao], est);
    },
    { timeout: 60_000 },
  );
  return { alteradas: finais.size, meses, contas: contasAlteradas, somaAntes, somaDepois };
}

export class ErroEdicao extends Error {}
