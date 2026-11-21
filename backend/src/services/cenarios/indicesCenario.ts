import type { Prisma } from "../../generated/prisma/client.js";
import type { LinhaEstrutura } from "../dre/apuracaoUnidades.js";
import { estrutura as estruturaDRE } from "../dre/dreService.js";
import { linhasDasVisoes, totaisDaDRE } from "./comparativoCenario.js";
import { UNIDADES } from "./edicaoCenario.js";
import { aplicacaoDosReajustes, fatoresDasContas, GRUPOS_POR_UNIDADE, indicesDaLinha, indicesDosReajustes, type IndicesDaConta, type IndiceDosReajustes } from "./reajustesCenario.js";

/**
 * As combinações dos Índices de Comparação e dos Índices de Reajuste dos cenários analíticos (21/11/2026, pedido do Adão; antes,
 * as tabelas Linha da DRE das abas Comparativo e Reajustes das Configurações, que escolhiam o índice de cada conta). Cada índice
 * guarda a lista das suas combinações de Unidade, Departamento, Atribuição e Conta — cada uma "Todas" (nula) ou uma escolha —, e
 * vale nas contas que alguma delas alcança: uma unidade inteira, um departamento de uma unidade, uma atribuição, ou só uma conta.
 *
 * - Unidade: as unidades do cenário com contas (o nome da cópia das Unidades do cenário).
 * - Departamento: os da cópia dos Departamentos do cenário, da unidade escolhida (sem unidade, só "Todos"); alcança as contas dos
 *   grupos da DRE dele (gruposDRE).
 * - Atribuição: a sigla da atribuição da conta na DRE (MOD, MOI, GGI…, a segunda parte do código; nos volumes de Produção e
 *   Serviços, P ou S). Com o Departamento "Todos", a mesma atribuição vale em todos os grupos da unidade (a Mão de Obra Direta da
 *   Montagem e a dos Complementares, por exemplo).
 * - Conta: o código sem o grupo ("MOD.REMUNERACOES_CLT"): com o Departamento "Todos", a mesma conta de todos os grupos.
 * - Venda (só nos Índices de Reajuste): Todas (nula), Global ou Mercantil; Global ou Mercantil restringe a combinação às contas
 *   com venda, as dos Custos de Produção da Matriz e da Filial (21/11/2026, a parte de cada venda; reajustesCenario.reajustarPorVenda).
 *
 * A mesma conta (na unidade e, nos reajustes, na venda) não pode estar em duas combinações, nem em dois índices do mesmo tipo: sem
 * o 1º e o 2º índice de antes — os percentuais cumulativos se calculam antes ("((1+R1)*(1+R2)…)−1").
 *
 * Os índices gravados antes (sem combinações) seguem a escolha de cada conta (indicesDoComparativo e aplicacaoDosReajustes, por
 * código) até a próxima gravação, que passa ao formato novo: a tela os mostra com as combinações que alcançam as mesmas contas
 * (combinacoesDoLegado).
 */

export type TipoDoIndice = "COMPARACAO" | "REAJUSTE";
export type Venda = "GLOBAL" | "MERCANTIL";
export const VENDAS: Venda[] = ["GLOBAL", "MERCANTIL"];
export const NOME_DA_VENDA: Record<Venda, string> = { GLOBAL: "Global", MERCANTIL: "Mercantil" };

/** Uma combinação de um índice: cada campo nulo vale "Todas" (ou "Todos"). */
export type Combinacao = { unidade: number | null; departamento: string | null; atribuicao: string | null; conta: string | null; venda: Venda | null };

/**
 * Uma conta numa unidade (e, nos reajustes dos Custos de Produção da Matriz e da Filial, numa venda): o que cada combinação
 * alcança. `chave` é a da conta na unidade ("1|CPP.MOD.REMUNERACOES_CLT") ou na venda ("1|GLOBAL|CPP…"), a mesma das contas
 * nos fatores dos reajustes (reajustesCenario.fatorNaVenda).
 */
export type CelulaDoIndice = { chave: string; unidade: number; codigo: string; grupo: string; atribuicao: string; conta: string; venda: Venda | null; descricao: string };
export type DepartamentoDoIndice = { id: string; unidade: number; nome: string; grupos: string[]; ativo: boolean };

/** O que as combinações de um tipo de índice podem escolher, e as contas que elas alcançam. */
export type Universo = {
  tipo: TipoDoIndice;
  unidades: Array<{ codigo: number; nome: string }>;
  departamentos: DepartamentoDoIndice[];
  atribuicoes: Array<{ chave: string; nome: string }>;
  contas: Array<{ chave: string; nome: string; atribuicao: string }>;
  celulas: CelulaDoIndice[];
};

type Db = Prisma.TransactionClient;

/** Os nomes das seções dos volumes, como atribuição (P e S). */
const SECOES: Record<string, string> = { P: "Produção", S: "Serviços" };
const NOME_PADRAO_DA_UNIDADE: Record<number, string> = { 1: "Matriz", 2: "Filial", 3: "Serviços", 4: "Despesas e Extra", 5: "RN" };

/**
 * O universo das combinações (puro): as contas de cada tipo, em cada unidade — nos Índices de Comparação, as linhas verificadas do
 * Comparativo (as contas, os volumes de Produção e Serviços e os totais sem contas, como os Impostos Operacionais); nos de Reajuste,
 * as contas (ITEM) fora de Produção e Serviços, com os Custos de Produção da Matriz e da Filial em cada venda.
 */
export function montarUniverso(
  tipo: TipoDoIndice,
  est: LinhaEstrutura[],
  departamentos: DepartamentoDoIndice[],
  unidadesDoCenario: Array<{ codigo: number; nome: string }>,
): Universo {
  const { linhas } = totaisDaDRE(est);
  const visoes = linhasDasVisoes(est);
  const ps = linhas.find((l) => l.linha.tipo === "SECAO" && l.linha.codigo.startsWith("PS."))?.linha.codigo;
  const nomeDaUnidade = (u: number) => unidadesDoCenario.find((x) => x.codigo === u)?.nome ?? NOME_PADRAO_DA_UNIDADE[u] ?? `Unidade ${u}`;
  const celulas: CelulaDoIndice[] = [];
  const atribuicoes = new Map<string, string>();
  const contas = new Map<string, { nome: string; atribuicao: string }>();
  for (const r of linhas) {
    if (!r.folha) continue;
    const l = r.linha;
    const doPS = !!ps && (l.codigo === ps || r.acima[0] === ps);
    if (tipo === "REAJUSTE" && (l.tipo !== "ITEM" || doPS)) continue;
    const partes = l.codigo.split(".");
    const atribuicao = partes.length > 2 ? partes[1] : l.grupoSigla;
    const nomeDaAtribuicao = partes.length > 2 ? (l.atribuicao ?? partes[1]) : (SECOES[l.grupoSigla] ?? l.grupo);
    const conta = partes.slice(1).join(".");
    let alguma = false;
    for (const u of UNIDADES) {
      if (!visoes.get(u)?.has(l.codigo)) continue;
      alguma = true;
      const rotulo = `${l.descricao} (${partes.length > 2 ? `${partes[1]}, ` : ""}${l.grupoSigla})`;
      const comVenda = tipo === "REAJUSTE" && GRUPOS_POR_UNIDADE[l.grupoSigla]?.some((g) => g.unidade === u);
      for (const venda of comVenda ? VENDAS : [null]) {
        celulas.push({
          chave: venda ? `${u}|${venda}|${l.codigo}` : `${u}|${l.codigo}`,
          unidade: u,
          codigo: l.codigo,
          grupo: l.grupoSigla,
          atribuicao,
          conta,
          venda,
          descricao: `${nomeDaUnidade(u)}${venda ? ` · ${NOME_DA_VENDA[venda]}` : ""} · ${rotulo}`,
        });
      }
    }
    if (!alguma) continue;
    if (!atribuicoes.has(atribuicao)) atribuicoes.set(atribuicao, nomeDaAtribuicao);
    if (!contas.has(conta)) contas.set(conta, { nome: l.descricao, atribuicao });
  }
  const comContas = new Set(celulas.map((c) => c.unidade));
  const unidades = [
    ...unidadesDoCenario.filter((u) => comContas.has(u.codigo)),
    ...[...comContas].filter((u) => !unidadesDoCenario.some((x) => x.codigo === u)).map((u) => ({ codigo: u, nome: nomeDaUnidade(u) })),
  ];
  return {
    tipo,
    unidades,
    departamentos: departamentos.filter((d) => comContas.has(d.unidade)),
    atribuicoes: [...atribuicoes].map(([chave, nome]) => ({ chave, nome })),
    contas: [...contas].map(([chave, c]) => ({ chave, ...c })),
    celulas,
  };
}

/** O universo do cenário: a Estrutura da DRE, a cópia dos Departamentos e a das Unidades dele. */
export async function universoDoCenario(db: Db, cenarioId: string, tipo: TipoDoIndice, est?: LinhaEstrutura[]): Promise<Universo> {
  const [estr, deps, unidades] = await Promise.all([
    est ?? estruturaDRE(),
    db.cenarioDepartamento.findMany({ where: { cenarioId }, include: { unidadeNegocio: { select: { codigo: true } } }, orderBy: [{ ordem: "asc" }, { nome: "asc" }] }),
    db.cenarioUnidade.findMany({ where: { cenarioId }, include: { unidadeNegocio: { select: { codigo: true } } }, orderBy: [{ ordem: "asc" }, { unidadeNegocio: { codigo: "asc" } }] }),
  ]);
  return montarUniverso(
    tipo,
    estr,
    deps.map((d) => ({ id: d.id, unidade: d.unidadeNegocio.codigo, nome: d.nome, grupos: d.gruposDRE, ativo: d.ativo })),
    unidades.map((u) => ({ codigo: u.unidadeNegocio.codigo, nome: u.nome })),
  );
}

/** Se a combinação alcança a conta (a venda nula vale as duas; a conta sem venda só com a venda nula). */
export function alcanca(k: Combinacao, c: CelulaDoIndice, departamentos: Map<string, DepartamentoDoIndice>): boolean {
  if (k.unidade !== null && c.unidade !== k.unidade) return false;
  if (k.departamento !== null) {
    const d = departamentos.get(k.departamento);
    if (!d || d.unidade !== c.unidade || !d.grupos.includes(c.grupo)) return false;
  }
  if (k.atribuicao !== null && c.atribuicao !== k.atribuicao) return false;
  if (k.conta !== null && c.conta !== k.conta) return false;
  if (k.venda !== null && c.venda !== k.venda) return false;
  return true;
}

const porId = (u: Universo) => new Map(u.departamentos.map((d) => [d.id, d]));

/** As contas que uma combinação alcança. */
export function celulasDaCombinacao(k: Combinacao, u: Universo, deps = porId(u)): CelulaDoIndice[] {
  return u.celulas.filter((c) => alcanca(k, c, deps));
}

/** Quantas contas (cada conta numa unidade, as duas vendas juntas) as combinações alcançam. */
export function contasDasCelulas(celulas: CelulaDoIndice[]): number {
  return new Set(celulas.map((c) => `${c.unidade}|${c.codigo}`)).size;
}

/** Um índice com as combinações dele (os de comparação e os de reajuste). */
export type ComCombinacoes = { chave: string; descricao: string; combinacoes: Combinacao[] };

/** A combinação lida de um JSON gravado ou recebido (os campos que faltam valem "Todas"). */
export function lerCombinacao(x: unknown): Combinacao {
  const o = (x ?? {}) as Record<string, unknown>;
  const texto = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    unidade: typeof o.unidade === "number" && Number.isInteger(o.unidade) ? o.unidade : null,
    departamento: texto(o.departamento),
    atribuicao: texto(o.atribuicao),
    conta: texto(o.conta),
    venda: o.venda === "GLOBAL" || o.venda === "MERCANTIL" ? o.venda : null,
  };
}

/** Os índices gravados estão no formato das combinações (21/11/2026): algum deles tem a lista. */
export const temCombinacoes = (lista: unknown) => Array.isArray(lista) && lista.some((i) => Array.isArray((i as { combinacoes?: unknown })?.combinacoes));

/** O texto de uma combinação ("Matriz · Produção · Mão de Obra Direta · Todas"), para os avisos. */
export function textoDaCombinacao(k: Combinacao, u: Universo): string {
  const partes = [
    k.unidade === null ? "Todas as Unidades" : (u.unidades.find((x) => x.codigo === k.unidade)?.nome ?? `Unidade ${k.unidade}`),
    k.departamento === null ? "Todos os Departamentos" : (u.departamentos.find((d) => d.id === k.departamento)?.nome ?? "departamento excluído"),
    k.atribuicao === null ? "Todas as Atribuições" : (u.atribuicoes.find((a) => a.chave === k.atribuicao)?.nome ?? k.atribuicao),
    k.conta === null ? "Todas as Contas" : (u.contas.find((c) => c.chave === k.conta)?.nome ?? k.conta),
  ];
  if (k.venda) partes.push(NOME_DA_VENDA[k.venda]);
  return partes.join(" · ");
}

const algumas = (xs: string[], n = 3) => (xs.length <= n ? xs.join("; ") : `${xs.slice(0, n).join("; ")} e mais ${xs.length - n}`);

/**
 * Confere as combinações de todos os índices de um tipo (a gravação): cada campo dentro do universo (o departamento da unidade
 * escolhida; a venda só nos Custos de Produção da Matriz e da Filial, nos reajustes), cada combinação com ao menos uma conta, e
 * nenhuma conta em duas combinações — do mesmo índice ou de índices diferentes. Devolve os erros (vazio: pode gravar).
 */
export function errosDasCombinacoes(indices: ComCombinacoes[], u: Universo): string[] {
  const erros: string[] = [];
  const deps = porId(u);
  const dono = new Map<string, { indice: ComCombinacoes; k: number }>();
  for (const i of indices) {
    i.combinacoes.forEach((k, n) => {
      const qual = `${i.descricao}, combinação ${n + 1}`;
      if (k.unidade !== null && !u.unidades.some((x) => x.codigo === k.unidade)) erros.push(`${qual}: a unidade não tem contas no cenário.`);
      if (k.departamento !== null) {
        const d = deps.get(k.departamento);
        if (!d) erros.push(`${qual}: o departamento não existe mais no cenário (Configurações / Departamentos).`);
        else if (k.unidade !== d.unidade) erros.push(`${qual}: o departamento ${d.nome} não é da unidade escolhida.`);
      }
      if (k.atribuicao !== null && !u.atribuicoes.some((a) => a.chave === k.atribuicao)) erros.push(`${qual}: a atribuição não existe na DRE.`);
      if (k.conta !== null && !u.contas.some((c) => c.chave === k.conta)) erros.push(`${qual}: a conta não existe na DRE.`);
      // A venda (Global ou Mercantil) restringe a combinação às contas com venda: as dos Custos de Produção da Matriz e da Filial.
      if (k.venda !== null && u.tipo !== "REAJUSTE") erros.push(`${qual}: a venda vale só nos Índices de Reajuste.`);
      const celulas = celulasDaCombinacao(k, u, deps);
      if (!celulas.length) erros.push(`${qual}: a combinação não alcança nenhuma conta.`);
      const repetidas: string[] = [];
      const deOutro = new Map<string, string[]>();
      for (const c of celulas) {
        const antes = dono.get(c.chave);
        if (!antes) {
          dono.set(c.chave, { indice: i, k: n });
          continue;
        }
        if (antes.indice === i) repetidas.push(`${c.descricao} (combinação ${antes.k + 1})`);
        else deOutro.set(antes.indice.descricao, [...(deOutro.get(antes.indice.descricao) ?? []), c.descricao]);
      }
      if (repetidas.length) erros.push(`${qual}: alcança contas de outra combinação do índice — ${algumas(repetidas)}.`);
      for (const [outro, contas] of deOutro) erros.push(`${qual}: alcança contas que já estão no índice ${outro} — ${algumas(contas)}.`);
    });
  }
  return erros;
}

/** O índice de cada conta (a chave da célula → a do índice), pelas combinações; a primeira vale (a gravação recusa as repetidas). */
export function indicePorCelula(indices: ComCombinacoes[], u: Universo): Map<string, string> {
  const deps = porId(u);
  const mapa = new Map<string, string>();
  for (const i of indices) for (const k of i.combinacoes) for (const c of celulasDaCombinacao(k, u, deps)) if (!mapa.has(c.chave)) mapa.set(c.chave, i.chave);
  return mapa;
}

/**
 * As combinações que alcançam exatamente as contas de cada índice (os índices gravados antes de 21/11/2026, pela escolha de cada
 * conta): das mais largas às mais estreitas — a unidade toda (ou todas), o departamento, a atribuição (num departamento ou em
 * todos), a conta e, nos reajustes, a venda —, cada uma só com contas do índice e ainda sem combinação.
 */
export function combinacoesDoLegado(porCelula: Map<string, string>, u: Universo): Map<string, Combinacao[]> {
  const deps = porId(u);
  const candidatas: Combinacao[] = [];
  const k = (unidade: number | null, departamento: string | null, atribuicao: string | null, conta: string | null, venda: Venda | null = null): Combinacao => ({
    unidade,
    departamento,
    atribuicao,
    conta,
    venda,
  });
  candidatas.push(k(null, null, null, null));
  for (const a of u.atribuicoes) candidatas.push(k(null, null, a.chave, null));
  for (const c of u.contas) candidatas.push(k(null, null, c.atribuicao, c.chave));
  for (const un of u.unidades) {
    const daUnidade = u.celulas.filter((c) => c.unidade === un.codigo);
    const deps2 = u.departamentos.filter((d) => d.unidade === un.codigo);
    const atribs = [...new Set(daUnidade.map((c) => c.atribuicao))];
    const contas = [...new Map(daUnidade.map((c) => [c.conta, c.atribuicao])).entries()];
    candidatas.push(k(un.codigo, null, null, null));
    for (const d of deps2) candidatas.push(k(un.codigo, d.id, null, null));
    for (const a of atribs) candidatas.push(k(un.codigo, null, a, null));
    for (const d of deps2) for (const a of atribs) candidatas.push(k(un.codigo, d.id, a, null));
    for (const [c, a] of contas) candidatas.push(k(un.codigo, null, a, c));
    for (const d of deps2) for (const [c, a] of contas) candidatas.push(k(un.codigo, d.id, a, c));
    if (u.tipo === "REAJUSTE" && daUnidade.some((c) => c.venda)) {
      for (const v of VENDAS) {
        for (const d of deps2) candidatas.push(k(un.codigo, d.id, null, null, v));
        for (const d of deps2) for (const a of atribs) candidatas.push(k(un.codigo, d.id, a, null, v));
        for (const d of deps2) for (const [c, a] of contas) candidatas.push(k(un.codigo, d.id, a, c, v));
        for (const [c, a] of contas) candidatas.push(k(un.codigo, null, a, c, v));
      }
    }
  }
  const resultado = new Map<string, Combinacao[]>();
  const coberta = new Set<string>();
  for (const cand of candidatas) {
    const celulas = celulasDaCombinacao(cand, u, deps);
    if (!celulas.length) continue;
    const indice = porCelula.get(celulas[0].chave);
    if (!indice || celulas.some((c) => porCelula.get(c.chave) !== indice || coberta.has(c.chave))) continue;
    if (cand.venda && celulas.some((c) => c.venda === null)) continue;
    for (const c of celulas) coberta.add(c.chave);
    resultado.set(indice, [...(resultado.get(indice) ?? []), cand]);
  }
  return resultado;
}

// ---------------------------------------------------------------------------------------------------------- Índices de Comparação

/** Um Índice de Comparação (antes de 21/11/2026, de Referência): a variação máxima aceita (em %), com as combinações. */
export type IndiceDeComparacao = { chave: string; descricao: string; observacao: string | null; variacao: number; combinacoes: Combinacao[] };
type ComComparacao = { id: string; indicesReajuste: unknown; indicesDoComparativo: unknown };

/** O índice de uma linha verificada na escolha de antes (por conta): o dela ou, sem ele, o do total ou da atribuição acima. */
function indiceDaLinhaDeAntes(escolhidos: Record<string, string>, chaves: Set<string>, codigo: string, acima: string[]): string | null {
  for (const k of [codigo, ...[...acima].reverse()]) if (escolhidos[k] && chaves.has(escolhidos[k])) return escolhidos[k];
  return null;
}

/**
 * Os Índices de Comparação do cenário, com as combinações (as gravadas ou, nos de antes, as que alcançam as contas escolhidas), o
 * universo delas e o índice de cada conta (a chave "unidade|código" → a do índice).
 */
export async function indicesDeComparacao(db: Db, c: ComComparacao, est?: LinhaEstrutura[]) {
  const estr = est ?? (await estruturaDRE());
  const universo = await universoDoCenario(db, c.id, "COMPARACAO", estr);
  const lista = Array.isArray(c.indicesReajuste) ? (c.indicesReajuste as Array<Record<string, unknown>>) : [];
  const base = lista.map((i) => ({
    chave: String(i.chave),
    descricao: String(i.descricao ?? ""),
    observacao: typeof i.observacao === "string" && i.observacao ? i.observacao : null,
    variacao: Number(i.variacao),
    combinacoes: Array.isArray(i.combinacoes) ? i.combinacoes.map(lerCombinacao) : [],
  }));
  let porCelula: Map<string, string>;
  if (temCombinacoes(lista)) porCelula = indicePorCelula(base, universo);
  else {
    const escolhidos = (c.indicesDoComparativo ?? {}) as Record<string, string>;
    const chaves = new Set(base.map((i) => i.chave));
    const acima = new Map(totaisDaDRE(estr).linhas.map((l) => [l.linha.codigo, l.acima]));
    porCelula = new Map();
    for (const cel of universo.celulas) {
      const chave = indiceDaLinhaDeAntes(escolhidos, chaves, cel.codigo, acima.get(cel.codigo) ?? []);
      if (chave) porCelula.set(cel.chave, chave);
    }
    const doLegado = combinacoesDoLegado(porCelula, universo);
    for (const i of base) i.combinacoes = doLegado.get(i.chave) ?? [];
  }
  const indices: IndiceDeComparacao[] = base;
  return { universo, indices, porCelula };
}

/**
 * As variações máximas de cada conta numa unidade ("unidade|código" → %), para o comparativo dos analíticos: a do índice dela.
 */
export async function limitesDasCelulas(db: Db, c: ComComparacao, est?: LinhaEstrutura[]): Promise<Map<string, number>> {
  const { indices, porCelula } = await indicesDeComparacao(db, c, est);
  const variacao = new Map(indices.map((i) => [i.chave, i.variacao]));
  const limites = new Map<string, number>();
  for (const [cel, chave] of porCelula) if (variacao.has(chave)) limites.set(cel, variacao.get(chave)!);
  return limites;
}

/**
 * A variação máxima de uma conta numa visão: a da conta na unidade ou, no Consolidado (visão 0) e onde a unidade não se sabe
 * (nula), a maior das unidades — a variação do Consolidado é uma média das unidades, que não passa da maior delas.
 */
export function limiteNaVisao(limites: Map<string, number>, codigo: string, visao: number | null): number | null {
  if (visao) return limites.get(`${visao}|${codigo}`) ?? null;
  let maior: number | null = null;
  for (const u of UNIDADES) {
    const v = limites.get(`${u}|${codigo}`);
    if (v !== undefined) maior = maior === null ? v : Math.max(maior, v);
  }
  return maior;
}

// ------------------------------------------------------------------------------------------------------------ Índices de Reajuste

export type IndiceDeReajusteComCombinacoes = IndiceDosReajustes & { combinacoes: Combinacao[] };
type ComReajuste = { id: string; indicesDosReajustes: unknown; aplicacaoDosReajustes: unknown };

/**
 * Os Índices de Reajuste do cenário, com as combinações (as gravadas ou, nos de antes, as que alcançam as contas da Aplicação dos
 * Reajustes — o 1º índice de cada conta), o universo delas e o índice de cada conta (a chave da célula → a do índice).
 */
export async function indicesDeReajuste(db: Db, c: ComReajuste, est?: LinhaEstrutura[]) {
  const universo = await universoDoCenario(db, c.id, "REAJUSTE", est);
  const lista = indicesDosReajustes(c) as Array<IndiceDosReajustes & { combinacoes?: unknown }>;
  const base: IndiceDeReajusteComCombinacoes[] = lista.map((i) => ({
    chave: i.chave,
    descricao: i.descricao,
    observacao: i.observacao ?? null,
    reajustes: i.reajustes,
    combinacoes: Array.isArray(i.combinacoes) ? i.combinacoes.map(lerCombinacao) : [],
  }));
  let porCelula: Map<string, string>;
  if (temCombinacoes(lista)) porCelula = indicePorCelula(base, universo);
  else {
    const aplicacao = aplicacaoDosReajustes(c);
    const chaves = new Set(base.map((i) => i.chave));
    porCelula = new Map();
    for (const cel of universo.celulas) {
      const chave = indicesDaLinha(aplicacao, cel.chave)?.[0];
      if (chave && chaves.has(chave)) porCelula.set(cel.chave, chave);
    }
    const doLegado = combinacoesDoLegado(porCelula, universo);
    for (const i of base) i.combinacoes = doLegado.get(i.chave) ?? [];
  }
  return { universo, indices: base, porCelula };
}

/**
 * A Aplicação dos Reajustes que vale no cálculo: pelas combinações (a chave da célula → [o índice, nulo]) ou, nos índices gravados
 * antes de 21/11/2026, a gravada (com o 1º e o 2º índice de cada conta).
 */
export async function aplicacaoEfetiva(db: Db, c: ComReajuste, est?: LinhaEstrutura[]): Promise<Record<string, IndicesDaConta>> {
  if (!temCombinacoes(c.indicesDosReajustes)) return aplicacaoDosReajustes(c);
  const { porCelula } = await indicesDeReajuste(db, c, est);
  return Object.fromEntries([...porCelula].map(([cel, chave]) => [cel, [chave, null] as IndicesDaConta]));
}

/** Os fatores de cada conta com índice (reajustesCenario.fatoresDasContas), pela aplicação que vale. */
export async function fatoresDoCenario(db: Db, c: ComReajuste, est?: LinhaEstrutura[]): Promise<Map<string, number[]>> {
  return fatoresDasContas({ indicesDosReajustes: c.indicesDosReajustes, aplicacaoDosReajustes: await aplicacaoEfetiva(db, c, est) });
}

// ------------------------------------------------------------------------------------------------------------- Cópias e cadastros

/** Os departamentos que as combinações dos índices do cenário usam (os ids). */
export function departamentosDosIndices(c: { indicesReajuste: unknown; indicesDosReajustes: unknown }): Set<string> {
  const usados = new Set<string>();
  for (const lista of [c.indicesReajuste, c.indicesDosReajustes]) {
    if (!Array.isArray(lista)) continue;
    for (const i of lista as Array<{ combinacoes?: unknown }>) {
      if (!Array.isArray(i?.combinacoes)) continue;
      for (const k of i.combinacoes.map(lerCombinacao)) if (k.departamento) usados.add(k.departamento);
    }
  }
  return usados;
}

/**
 * Na revisão e na cópia de um cenário (a cópia nova dos Departamentos tem ids novos), os departamentos das combinações dos índices
 * passam aos da cópia nova (pela unidade e pelo nome, únicos no cenário).
 */
export async function remapearDepartamentosDosIndices(tx: Db, de: string, para: string) {
  const c = await tx.cenario.findUniqueOrThrow({ where: { id: para }, select: { indicesReajuste: true, indicesDosReajustes: true } });
  if (!departamentosDosIndices(c).size) return;
  const [antigos, novos] = await Promise.all([tx.cenarioDepartamento.findMany({ where: { cenarioId: de } }), tx.cenarioDepartamento.findMany({ where: { cenarioId: para } })]);
  const mapa = new Map(antigos.map((d) => [d.id, novos.find((n) => n.unidadeNegocioId === d.unidadeNegocioId && n.nome === d.nome)?.id ?? d.id]));
  const trocar = (lista: unknown) =>
    Array.isArray(lista)
      ? lista.map((i: { combinacoes?: unknown }) =>
          Array.isArray(i?.combinacoes)
            ? { ...i, combinacoes: i.combinacoes.map((x) => { const k = lerCombinacao(x); return k.departamento ? { ...k, departamento: mapa.get(k.departamento) ?? k.departamento } : k; }) }
            : i,
        )
      : lista;
  await tx.cenario.update({
    where: { id: para },
    data: {
      ...(Array.isArray(c.indicesReajuste) ? { indicesReajuste: trocar(c.indicesReajuste) as Prisma.InputJsonValue } : {}),
      ...(Array.isArray(c.indicesDosReajustes) ? { indicesDosReajustes: trocar(c.indicesDosReajustes) as Prisma.InputJsonValue } : {}),
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------------- Resultados

/** O índice de uma linha numa coluna dos Resultados: o texto e a dica. */
export type IndiceNaLinha = { texto: string; dica: string };

/**
 * Os índices de cada linha da DRE numa visão (os Resultados dos analíticos, 21/11/2026, pedido do Adão: o Índice de Reajuste antes
 * de Janeiro e o Índice de Comparação antes do Comparativo): nas contas, o índice da conta na unidade (no Consolidado, nas unidades);
 * nos totais e nas atribuições, o das contas abaixo dele. Com índices diferentes (ou contas sem índice), "Vários", e a dica diz o de cada
 * conta.
 */
export function indicesDasLinhas(
  est: LinhaEstrutura[],
  u: Universo,
  porCelula: Map<string, string>,
  visao: number,
  rotuloDoIndice: (chave: string) => { texto: string; dica: string } | null,
): Record<string, IndiceNaLinha> {
  const { linhas } = totaisDaDRE(est);
  const celulasDe = new Map<string, CelulaDoIndice[]>();
  for (const c of u.celulas) if (!visao || c.unidade === visao) celulasDe.set(c.codigo, [...(celulasDe.get(c.codigo) ?? []), c]);
  const abaixo = new Map<string, CelulaDoIndice[]>();
  for (const r of linhas) {
    const cs = celulasDe.get(r.linha.codigo);
    if (!cs) continue;
    for (const g of [r.linha.codigo, ...r.acima]) abaixo.set(g, [...(abaixo.get(g) ?? []), ...cs]);
  }
  const resultado: Record<string, IndiceNaLinha> = {};
  for (const [codigo, cs] of abaixo) {
    const chaves = [...new Set(cs.map((c) => porCelula.get(c.chave) ?? ""))];
    if (chaves.length === 1 && !chaves[0]) continue;
    if (chaves.length === 1) {
      const r = rotuloDoIndice(chaves[0]);
      if (r) resultado[codigo] = r;
      continue;
    }
    const detalhe = cs.map((c) => {
      const r = porCelula.get(c.chave) ? rotuloDoIndice(porCelula.get(c.chave)!) : null;
      return `${c.descricao}: ${r?.texto ?? "sem índice"}`;
    });
    resultado[codigo] = { texto: "Vários", dica: detalhe.length > 12 ? `${detalhe.slice(0, 12).join("\n")}\n… e mais ${detalhe.length - 12}` : detalhe.join("\n") };
  }
  return resultado;
}
