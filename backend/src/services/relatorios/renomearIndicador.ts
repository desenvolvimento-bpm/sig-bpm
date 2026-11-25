import type { Prisma } from "../../generated/prisma/client.js";
import { plural } from "../../utils/plural.js";
import { formulaComIds } from "./referenciasDosIndicadores.js";

/**
 * A troca do nome de um indicador (19/11/2026, pedido do Adão: os nomes se editam, e as outras telas acompanham). Desde
 * 25/11/2026, tudo cita o indicador pelo ID (referenciasDosIndicadores.ts): as fórmulas dos indicadores e dos cards, os cards
 * dos Relatórios Executivos e dos Painéis de Bordo, os valores importados e digitados, as metas importadas, os valores dos
 * cenários e as justificativas das Premissas (o código I|id). A troca muda só o cadastro; a de um card do Painel de Bordo,
 * também.
 *
 * O código cita os indicadores pelo ID (indicadoresDoSistema.ts), e a troca relê os nomes depois de gravar.
 */

type Tx = Prisma.TransactionClient;

export class TrocaDeNomeError extends Error {}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A fórmula com o indicador renomeado nos itens [IND|nome], [META|nome(|ACUM)] e [INDICADOR|nome(|ACUM)]. */
export function trocarNaFormula(formula: string, antigo: string, novo: string): string {
  return formula.replace(new RegExp(`\\[(IND|META|INDICADOR)\\|${escapar(antigo)}(\\|ACUM)?\\]`, "g"), (_, tipo: string, acum?: string) => `[${tipo}|${novo}${acum ?? ""}]`);
}

/** A fórmula ainda cita o indicador com este nome? */
export function citaNaFormula(formula: string | null | undefined, nome: string): boolean {
  return !!formula && new RegExp(`\\[(IND|META|INDICADOR)\\|${escapar(nome)}(\\|ACUM)?\\]`).test(formula);
}

type Bloco = Record<string, unknown>;

/**
 * Os blocos (as páginas de um grupo dos relatórios ou de um painel, em qualquer profundidade) com a troca aplicada aos que
 * casam; devolve o JSON novo e quantos blocos mudaram.
 */
export function trocarNosBlocos(json: unknown, casa: (b: Bloco) => boolean, muda: (b: Bloco) => Bloco): { json: unknown; trocas: number } {
  let trocas = 0;
  const visitar = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(visitar);
    if (!x || typeof x !== "object") return x;
    const o = x as Bloco;
    const filhos = Object.fromEntries(Object.entries(o).map(([k, v]) => [k, visitar(v)]));
    if (casa(o)) {
      trocas++;
      return muda(filhos);
    }
    return filhos;
  };
  return { json: visitar(json), trocas };
}

export type ResumoDaTroca = Record<string, number>;

/** O resumo da troca em texto (só o que mudou), para o aviso da tela. */
export function textoDoResumo(r: ResumoDaTroca): string | null {
  const ROTULOS: Record<string, [string, string]> = {
    importados: ["valor importado", "valores importados"],
    digitados: ["valor digitado", "valores digitados"],
    metas: ["meta importada", "metas importadas"],
    cenarios: ["valor dos cenários", "valores dos cenários"],
    justificativas: ["justificativa das Premissas", "justificativas das Premissas"],
    formulasDeIndicadores: ["fórmula de indicador", "fórmulas de indicadores"],
    formulasDeCards: ["fórmula de card do Painel de Bordo", "fórmulas de cards do Painel de Bordo"],
    blocosDosRelatorios: ["card dos Relatórios Executivos", "cards dos Relatórios Executivos"],
    blocosDosPaineis: ["card dos Painéis de Bordo", "cards dos Painéis de Bordo"],
  };
  const partes = Object.entries(r)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n.toLocaleString("pt-BR")} ${plural(n, ROTULOS[k]?.[0] ?? k, ROTULOS[k]?.[1] ?? k)}`);
  return partes.length ? partes.join(", ") : null;
}

/**
 * Recusa o nome novo que já está nos dados sem indicador no cadastro (valores, metas ou cenários gravados com esse nome): as
 * telas os juntariam ao indicador renomeado.
 */
export async function exigirNomeLivreNosDados(tx: Tx, novo: string) {
  const [importados, digitados, metas, cenarios, justificativas] = await Promise.all([
    tx.indicadorImportado.count({ where: { indicador: novo } }),
    tx.indicadorDigitado.count({ where: { indicador: novo } }),
    tx.metaImportada.count({ where: { indicador: novo } }),
    tx.cenarioIndicador.count({ where: { indicador: novo } }),
    tx.cenarioPremissaJustificativa.count({ where: { chave: `I|${novo}` } }),
  ]);
  const total = importados + digitados + metas + cenarios + justificativas;
  if (total) {
    throw new TrocaDeNomeError(
      `Já há ${total.toLocaleString("pt-BR")} ${plural(total, "valor gravado", "valores gravados")} com o nome ${novo} (de um indicador que não está mais no cadastro): escolha outro nome.`,
    );
  }
}

/**
 * Na troca do nome (na transação dada; o cadastro já com o nome novo ou não): os valores, as justificativas e as fórmulas
 * citam o indicador pelo ID (25/11/2026) e não mudam. O que ainda estiver com o nome antigo (gravado antes da migração e
 * que ela não alcançou) passa ao ID; a conferência no fim recusa a troca se algo ficar com o nome antigo.
 */
export async function propagarNomeDoIndicador(tx: Tx, id: string, antigo: string): Promise<ResumoDaTroca> {
  const onde = { where: { indicador: antigo }, data: { indicador: id } };
  const [importados, digitados, metas, cenarios] = [
    (await tx.indicadorImportado.updateMany(onde)).count,
    (await tx.indicadorDigitado.updateMany(onde)).count,
    (await tx.metaImportada.updateMany(onde)).count,
    (await tx.cenarioIndicador.updateMany(onde)).count,
  ];
  const justificativas = (await tx.cenarioPremissaJustificativa.updateMany({ where: { chave: `I|${antigo}` }, data: { chave: `I|${id}` } })).count;
  const peloId = new Map([[antigo, id]]);
  let formulasDeIndicadores = 0;
  for (const i of await tx.indicadorEstrutura.findMany({ select: { id: true, formula: true, peso: true } })) {
    if (!citaNaFormula(i.formula, antigo) && !citaNaFormula(i.peso, antigo)) continue;
    formulasDeIndicadores++;
    await tx.indicadorEstrutura.update({ where: { id: i.id }, data: { formula: formulaComIds(i.formula, peloId), peso: formulaComIds(i.peso, peloId) } });
  }
  let formulasDeCards = 0;
  for (const c of await tx.painelItem.findMany({ select: { id: true, formula: true, percentual: true } })) {
    if (!citaNaFormula(c.formula, antigo) && !citaNaFormula(c.percentual, antigo)) continue;
    formulasDeCards++;
    await tx.painelItem.update({ where: { id: c.id }, data: { formula: formulaComIds(c.formula, peloId), percentual: formulaComIds(c.percentual, peloId) } });
  }

  // A conferência: nada pode ter ficado com o nome antigo.
  const [r1, r2, r3, r4, r5] = await Promise.all([
    tx.indicadorImportado.count({ where: { indicador: antigo } }),
    tx.indicadorDigitado.count({ where: { indicador: antigo } }),
    tx.metaImportada.count({ where: { indicador: antigo } }),
    tx.cenarioIndicador.count({ where: { indicador: antigo } }),
    tx.cenarioPremissaJustificativa.count({ where: { chave: `I|${antigo}` } }),
  ]);
  const formulas = [
    ...(await tx.indicadorEstrutura.findMany({ select: { formula: true, peso: true } })).flatMap((i) => [i.formula, i.peso]),
    ...(await tx.painelItem.findMany({ select: { formula: true, percentual: true } })).flatMap((c) => [c.formula, c.percentual]),
  ].filter((f) => citaNaFormula(f, antigo)).length;
  const restantes = r1 + r2 + r3 + r4 + r5 + formulas;
  if (restantes) throw new TrocaDeNomeError(`A conferência achou ${restantes} ${plural(restantes, "registro", "registros")} ainda com o nome ${antigo}: nada foi gravado.`);

  return { importados, digitados, metas, cenarios, justificativas, formulasDeIndicadores, formulasDeCards };
}
