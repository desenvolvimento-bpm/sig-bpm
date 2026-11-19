import type { Prisma } from "../../generated/prisma/client.js";
import { plural } from "../../utils/plural.js";

/**
 * A troca do nome de um indicador ou de um card do Painel de Bordo (19/11/2026, pedido do Adão: os nomes se editam, e as
 * outras telas acompanham). Os dados se ligam pelo nome; a troca os atualiza todos numa transação só, com a conferência no
 * fim (sobrou algum com o nome antigo? então nada se grava):
 *
 * - indicador: os valores importados e digitados, as metas importadas, as metas dos cenários, as justificativas das
 *   Premissas (o código I|nome), as fórmulas dos indicadores e dos cards ([IND|…], [META|…] e [INDICADOR|…]) e os blocos
 *   dos Relatórios Executivos e dos Painéis de Bordo ({ tipo: "INDICADOR", nome });
 * - card: os blocos ({ tipo: "PAINEL", aba, quadro, titulo, sigla }).
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

/** Quantos blocos casam (para a conferência). */
const contarNosBlocos = (json: unknown, casa: (b: Bloco) => boolean) => trocarNosBlocos(json, casa, (b) => b).trocas;

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

/** Os blocos dos relatórios e dos painéis com a troca; grava só os que mudaram (com quem trocou e quando, a versão deles). */
async function trocarOsBlocos(tx: Tx, casa: (b: Bloco) => boolean, muda: (b: Bloco) => Bloco, quem: string) {
  let blocosDosRelatorios = 0;
  let blocosDosPaineis = 0;
  for (const a of await tx.relatorioExecutivoAba.findMany({ select: { relatorioId: true, departamento: true, blocos: true } })) {
    const r = trocarNosBlocos(a.blocos, casa, muda);
    if (!r.trocas) continue;
    blocosDosRelatorios += r.trocas;
    await tx.relatorioExecutivoAba.update({
      where: { relatorioId_departamento: { relatorioId: a.relatorioId, departamento: a.departamento } },
      data: { blocos: r.json as Prisma.InputJsonValue, atualizadoPor: quem },
    });
  }
  for (const p of await tx.painelDeBordo.findMany({ select: { id: true, paginas: true } })) {
    const r = trocarNosBlocos(p.paginas, casa, muda);
    if (!r.trocas) continue;
    blocosDosPaineis += r.trocas;
    await tx.painelDeBordo.update({ where: { id: p.id }, data: { paginas: r.json as Prisma.InputJsonValue, paginasPor: quem, paginasEm: new Date() } });
  }
  return { blocosDosRelatorios, blocosDosPaineis };
}

/** Quantos blocos dos relatórios e dos painéis ainda casam. */
async function blocosQueCasam(tx: Tx, casa: (b: Bloco) => boolean) {
  const [abas, paineis] = await Promise.all([tx.relatorioExecutivoAba.findMany({ select: { blocos: true } }), tx.painelDeBordo.findMany({ select: { paginas: true } })]);
  return abas.reduce((s, a) => s + contarNosBlocos(a.blocos, casa), 0) + paineis.reduce((s, p) => s + contarNosBlocos(p.paginas, casa), 0);
}

const ehBlocoDoIndicador = (nome: string) => (b: Bloco) => b.tipo === "INDICADOR" && b.nome === nome;

/**
 * Recusa o nome novo que já está nos dados (valores, metas ou cenários com esse nome, sem indicador no cadastro): a troca
 * juntaria os dois.
 */
export async function exigirNomeLivreNosDados(tx: Tx, novo: string) {
  const [importados, digitados, metas, cenarios, justificativas] = await Promise.all([
    tx.indicadorImportado.count({ where: { nome: novo } }),
    tx.indicadorDigitado.count({ where: { nome: novo } }),
    tx.metaImportada.count({ where: { nome: novo } }),
    tx.cenarioIndicador.count({ where: { nome: novo } }),
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
 * Troca o nome do indicador em todos os dados ligados a ele (na transação dada; o cadastro já com o nome novo ou não) e
 * confere que nada ficou com o nome antigo.
 */
export async function propagarNomeDoIndicador(tx: Tx, antigo: string, novo: string, quem: string): Promise<ResumoDaTroca> {
  const onde = { where: { nome: antigo }, data: { nome: novo } };
  const [importados, digitados, metas, cenarios] = [
    (await tx.indicadorImportado.updateMany(onde)).count,
    (await tx.indicadorDigitado.updateMany(onde)).count,
    (await tx.metaImportada.updateMany(onde)).count,
    (await tx.cenarioIndicador.updateMany(onde)).count,
  ];
  const justificativas = (await tx.cenarioPremissaJustificativa.updateMany({ where: { chave: `I|${antigo}` }, data: { chave: `I|${novo}` } })).count;

  let formulasDeIndicadores = 0;
  for (const i of await tx.indicadorEstrutura.findMany({ select: { id: true, formula: true, peso: true } })) {
    if (!citaNaFormula(i.formula, antigo) && !citaNaFormula(i.peso, antigo)) continue;
    formulasDeIndicadores++;
    await tx.indicadorEstrutura.update({
      where: { id: i.id },
      data: { formula: i.formula && trocarNaFormula(i.formula, antigo, novo), peso: i.peso && trocarNaFormula(i.peso, antigo, novo) },
    });
  }
  let formulasDeCards = 0;
  for (const c of await tx.painelItem.findMany({ select: { id: true, formula: true, percentual: true } })) {
    if (!citaNaFormula(c.formula, antigo) && !citaNaFormula(c.percentual, antigo)) continue;
    formulasDeCards++;
    await tx.painelItem.update({ where: { id: c.id }, data: { formula: trocarNaFormula(c.formula, antigo, novo), percentual: c.percentual && trocarNaFormula(c.percentual, antigo, novo) } });
  }
  const blocos = await trocarOsBlocos(tx, ehBlocoDoIndicador(antigo), (b) => ({ ...b, nome: novo }), quem);

  // A conferência: nada pode ter ficado com o nome antigo.
  const [r1, r2, r3, r4, r5] = await Promise.all([
    tx.indicadorImportado.count({ where: { nome: antigo } }),
    tx.indicadorDigitado.count({ where: { nome: antigo } }),
    tx.metaImportada.count({ where: { nome: antigo } }),
    tx.cenarioIndicador.count({ where: { nome: antigo } }),
    tx.cenarioPremissaJustificativa.count({ where: { chave: `I|${antigo}` } }),
  ]);
  const formulas = [
    ...(await tx.indicadorEstrutura.findMany({ select: { formula: true, peso: true } })).flatMap((i) => [i.formula, i.peso]),
    ...(await tx.painelItem.findMany({ select: { formula: true, percentual: true } })).flatMap((c) => [c.formula, c.percentual]),
  ].filter((f) => citaNaFormula(f, antigo)).length;
  const restantes = r1 + r2 + r3 + r4 + r5 + formulas + (await blocosQueCasam(tx, ehBlocoDoIndicador(antigo)));
  if (restantes) throw new TrocaDeNomeError(`A conferência achou ${restantes} ${plural(restantes, "registro", "registros")} ainda com o nome ${antigo}: nada foi gravado.`);

  return { importados, digitados, metas, cenarios, justificativas, formulasDeIndicadores, formulasDeCards, ...blocos };
}

export type IdentidadeDoCard = { grupo: string; quadro: string; nome: string; sigla: string };

/** A aba dos blocos PAINEL de um grupo do cadastro (RESULTADOS → resultados). */
const abaDoGrupo = (grupo: string) => grupo.toLowerCase();

const ehBlocoDoCard = (c: IdentidadeDoCard) => (b: Bloco) => b.tipo === "PAINEL" && b.aba === abaDoGrupo(c.grupo) && b.quadro === c.quadro && b.titulo === c.nome && b.sigla === c.sigla;

/** Troca a identidade do card (o grupo, o quadro, o nome e a abreviação) nos blocos e confere que nenhum ficou com a antiga. */
export async function propagarIdentidadeDoCard(tx: Tx, antes: IdentidadeDoCard, depois: IdentidadeDoCard, quem: string): Promise<ResumoDaTroca> {
  const blocos = await trocarOsBlocos(tx, ehBlocoDoCard(antes), (b) => ({ ...b, aba: abaDoGrupo(depois.grupo), quadro: depois.quadro, titulo: depois.nome, sigla: depois.sigla }), quem);
  const restantes = await blocosQueCasam(tx, ehBlocoDoCard(antes));
  if (restantes) throw new TrocaDeNomeError(`A conferência achou ${restantes} ${plural(restantes, "card", "cards")} dos relatórios ainda com o nome antigo: nada foi gravado.`);
  return blocos;
}
