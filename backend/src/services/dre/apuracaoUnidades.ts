import { Prisma } from "../../generated/prisma/client.js";
import { avaliarExpressao, codigosDaExpressao } from "./expressao.js";
import type { CodigoTotais } from "../volumes/totaisOperacao.js";
import { descricaoDeOrigem, ehAConta, semOGrupo, slugDaDRE } from "./descricaoDeOrigem.js";

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/**
 * Apuração da DRE por unidade — as abas Resultados (Matriz), (Filial),
 * (Serviços), (Desp.+Extra) e (RN) do SIG BPM 2026 - BASE REALIZADO
 * (RESULTADOS). Cada linha de item sai dos lançamentos classificados (a aba
 * Gastos (Contábil)), dos percentuais de rateio, da receita prévia e dos
 * lançamentos manuais, com a regra da fórmula da planilha; subtotais e totais
 * saem das expressões da estrutura da DRE, avaliadas com os itens da unidade.
 *
 * Os lançamentos manuais (21/10/2026; antes, só os do balde RN, na aba RN): os do balde RN continuam na aba RN; os
 * demais entram como um lançamento do balancete do mesmo balde, filial e linha, com o valor digitado (o da DRE)
 * levado ao sinal do balancete (nas receitas, o sinal trocado) — e passam pelas mesmas regras de cada aba, inclusive os
 * rateios. Os de rateio das contestações de competências fechadas (30/10/2026) se dividem pelos percentuais da
 * competência do movimento (`rateioDe`), cada uma numa parcela à parte: a correção sai como o movimento entrou.
 *
 * Os Serviços Complementares (21/10/2026, pedido do usuário): cada linha de custo complementar (CSC) soma também os
 * lançamentos diretos do balde COMPLEMENTAR na linha equivalente da Montagem (CSM, a mesma atribuição e descrição) — os
 * centros complementares lançam nas contas de MO da Montagem, porque não há contas de resultado de MO para os
 * Complementares (e uma conta complementar daria <DEP.!> na classificação).
 *
 * O cálculo é puro: recebe os dados já lidos e devolve os valores com a
 * composição de cada um, para a memória de cálculo e o detalhamento.
 */

export const UNIDADE = { MATRIZ: 1, FILIAL: 2, SERVICOS: 3, DESPESAS: 4, RN: 5 } as const;

export type LinhaEstrutura = {
  id: string;
  codigo: string;
  tipo: "SECAO" | "ITEM" | "SUBTOTAL" | "TOTAL";
  grupo: string;
  grupoSigla: string;
  atribuicao: string | null;
  /** A sigla da atribuição (MOD, MOI…): as linhas de Mão de Obra Direta e Indireta são as sensíveis (27/10/2026). */
  atribuicaoSigla: string | null;
  descricao: string;
  expressao: string | null;
  unidades: number[];
};

export type LancamentoClassificado = {
  filial: number;
  linhaDREId: string | null;
  balde: string | null;
  alocacao: string | null;
  valor: Decimal;
  /** O lançamento de rateio dividido pelos percentuais de outra competência (o id dela, em `percentuaisDe`). */
  rateioDe?: string;
};

export type LancamentoManualApuracao = {
  linhaDREId: string | null;
  balde: string | null;
  valor: Decimal;
  /** A filial (21/10/2026): a regra das abas usa a filial, como no balancete. */
  filial?: number;
  /** A competência dos percentuais de rateio (30/10/2026: os lançamentos de uma contestação de competência fechada). */
  rateioDe?: string | null;
};

export type ReceitaPreviaApuracao = { unidade: number; natureza: string; receitaBruta: Decimal; receitaLiquida: Decimal };

export type DadosApuracao = {
  linhas: LinhaEstrutura[];
  lancamentos: LancamentoClassificado[];
  manuais: LancamentoManualApuracao[];
  /** Percentual por chave e destino (ex.: "PRODUCAO|MATRIZ"). */
  percentuais: Map<string, Decimal>;
  /** Os percentuais das outras competências dos lançamentos manuais (`rateioDe`), pelo id, com o rótulo (MM/AAAA). */
  percentuaisDe?: Map<string, { rotulo: string; percentuais: Map<string, Decimal> }>;
  /** Volumes da aba Totais, pelo código da linha (ex.: PREFABRICADO_MATRIZ). */
  totais: Map<string, Decimal>;
  receitas: ReceitaPreviaApuracao[];
};

/** Um balde de lançamentos diretos, de uma filial ou de todas. */
export type ParBalde = { balde: string; filial?: number };
export type ParcelaRateio = {
  chave: string;
  destino: string;
  base: string;
  percentual: string;
  valor: string;
  linhaId?: string;
  /** A parcela dos lançamentos manuais com os percentuais de outra competência (30/10/2026): o id e o rótulo dela. */
  competenciaId?: string;
  competencia?: string;
};
export type ParcelaUnidade = { unidade: number; nome: string; valor: string };
/**
 * De onde o valor saiu, na forma de filtros sobre os dados da competência —
 * é o que o detalhamento usa para chegar aos lançamentos de origem (Passo 20).
 * - contabil: lançamentos contábeis que não são de rateio, da linha, com os
 *   filtros de filial e balde da regra, multiplicados pelo fator. Em pares, a
 *   soma de baldes, cada um de uma filial ou de todas (Matriz e Filial).
 * - rateios: lançamentos de rateio da chave (o balde) na linha de base, ×
 *   percentual (estão em ParcelaRateio, com linhaId).
 * - manual: lançamentos manuais da linha e do balde.
 * - previa: a receita prévia da unidade e da natureza, com o sinal.
 */
export type OrigemValor = {
  contabil?: { linhaId: string; filial?: number; baldes?: string[]; excetoBaldes?: string[]; pares?: ParBalde[]; fator?: string };
  /** Na linha complementar (CSC), os diretos do balde COMPLEMENTAR da linha equivalente da Montagem (21/10/2026). */
  contabilPar?: { linhaId: string; baldes: string[] };
  manual?: { linhaId: string; balde: string };
  previa?: Array<{ unidade: number; natureza: string; componente: "BRUTA" | "LIQUIDA"; sinal: 1 | -1 }>;
};
export type Composicao = {
  regra: string;
  direto?: string;
  rateios?: ParcelaRateio[];
  unidades?: ParcelaUnidade[];
  observacao?: string;
  origem?: OrigemValor;
};
export type ResultadoLinha = { unidade: number; linhaId: string; codigo: string; valor: Decimal; composicao: Composicao | null };

const zero = () => new Decimal(0);
const n = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

/** As chaves de um mapa pela descrição de origem das linhas (descricaoDeOrigem.ts). */
const pelaOrigem = <T>(o: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(o).map(([k, v]) => [slugDaDRE(k), v]));

/**
 * As linhas de volume (P e S) de cada unidade, pela descrição de origem (25/11/2026: a última parte do código; antes, a
 * descrição em maiúsculas, que agora muda a qualquer momento), e as linhas da aba Totais que as somam. Também usado pelo
 * extrato das listas de uma linha de volume da DRE.
 */
export const VOLUMES_DA_DRE: Record<number, Record<string, CodigoTotais[]>> = {
  1: pelaOrigem({ "PRODUÇÃO DO PRÉ-FABRICADO (M³)": ["PREFABRICADO_MATRIZ"], "PRODUÇÃO DA METALURGIA (KG)": ["METALURGIA_MATRIZ"], "EXPEDIÇÃO DO PRÉ-FABRICADO (M³)": ["EXPEDICAO_MATRIZ"] }),
  2: pelaOrigem({
    "PRODUÇÃO DO PRÉ-FABRICADO (M³)": ["PREFABRICADO_FILIAL"],
    "PRODUÇÃO DO PRÉ-FABRICADO (PISTAS)": ["PREFABRICADO_PISTAS"],
    "PRODUÇÃO DA METALURGIA (KG)": ["METALURGIA_FILIAL"],
    "EXPEDIÇÃO DO PRÉ-FABRICADO (M³)": ["EXPEDICAO_FILIAL"],
  }),
  3: pelaOrigem({
    "PRODUÇÃO DA METALURGIA (KG)": ["METALURGIA_MONTAGEM", "METALURGIA_COMPLEMENTAR"],
    "MONTAGEM DO PRÉ-FABRICADO (M³)": ["MONTAGEM"],
    "ACOMPANHAMENTO DE OBRA (D)": ["ACOMPANHAMENTO_MONTAGEM", "ACOMPANHAMENTO_COMPLEMENTAR"],
  }),
};

/** O nome das chaves de rateio, para os avisos. */
export const NOME_DA_CHAVE: Record<string, string> = { PROJETO: "Projeto", PRODUCAO: "Produção", METALURGIA: "Metalurgia", ARMADURA: "Armadura", ACOMPANHAMENTO: "Acompanhamento" };
const FINANCEIRAS = new Set(["RFC", "RFNC", "DFC", "DFNC"]);

/**
 * As chaves de rateio com lançamentos e sem volume no mês (a soma dos percentuais da chave é zero), com a soma dos
 * lançamentos que ficam fora de todas as unidades (13/10/2026). Os do acompanhamento nas receitas e despesas
 * financeiras não contam: vão inteiros para Despesas e Extra.
 */
export function rateiosSemVolume(d: Pick<DadosApuracao, "lancamentos" | "percentuais" | "linhas">): Map<string, Decimal> {
  const porId = new Map(d.linhas.map((l) => [l.id, l]));
  const soma = new Map<string, Decimal>();
  for (const l of d.lancamentos) {
    if (l.alocacao !== "RATEIO" || !l.balde || !l.linhaDREId) continue;
    if (l.balde === "ACOMPANHAMENTO" && FINANCEIRAS.has(porId.get(l.linhaDREId)?.grupoSigla ?? "")) continue;
    soma.set(l.balde, (soma.get(l.balde) ?? zero()).plus(l.valor));
  }
  const r = new Map<string, Decimal>();
  for (const [chave, valor] of soma) {
    if (valor.isZero()) continue;
    const pcts = [...d.percentuais].filter(([k]) => k.startsWith(`${chave}|`)).reduce((a, [, p]) => a.plus(p), zero());
    if (pcts.isZero()) r.set(chave, valor);
  }
  return r;
}

/** Chaves de rateio que cada unidade de produção recebe, e o destino dela. */
const RATEIOS_PRODUCAO = ["PROJETO", "PRODUCAO", "METALURGIA", "ARMADURA"] as const;
const DESTINO_DA_UNIDADE: Record<number, string> = { 1: "MATRIZ", 2: "FILIAL" };
export const CHAVES_DE_RATEIO = new Set<string>([...RATEIOS_PRODUCAO, "ACOMPANHAMENTO"]);

/**
 * Os grupos em que a DRE mostra o valor com o sinal trocado em relação ao balancete (as receitas: no balancete, a
 * crédito, negativas). O lançamento manual é digitado no sinal da DRE (21/10/2026).
 */
const RECEITAS_DA_DRE = new Set(["ROB", "RFC", "RFNC"]);
/** O valor do lançamento manual (no sinal da DRE) no sinal do balancete. */
export const manualNoSinalDoBalancete = (grupoSigla: string, valor: Decimal) => (RECEITAS_DA_DRE.has(grupoSigla) ? valor.neg() : valor);

/** As linhas que as abas calculam (não somam o balancete): as receitas da receita prévia e as líquidas (pela descrição de origem). */
const CALCULADAS = new Set(
  [
    "Receita Bruta de Frete",
    "Receita Líquida de Frete",
    "Receita Líquida do Pré-Fabricado",
    "Receita Líquida de Devoluções e Inventários",
    "Receita Bruta Complementar",
    "Receita Líquida Complementar",
    "Receita Líquida de Montagem",
  ].map(slugDaDRE),
);

/**
 * As abas que somam um lançamento (21/10/2026), pela mesma regra da apuração: a linha da DRE dele, o balde e a filial.
 * Vazio, o lançamento fica fora de todas as abas e do resultado (ex.: uma conta de Montagem num centro com o balde
 * COMPLEMENTAR: Serviços soma a Montagem só do balde OBRAS, e a Complementar só nas linhas dela). Usado pela apuração (o
 * aviso), pela Classificação (a pendência "Sem Aba de Resultado") e pelos lançamentos manuais (`manual`: o do balde RN
 * vai só para a aba RN).
 */
export function abasQueSomam(
  linha: Pick<LinhaEstrutura, "tipo" | "codigo" | "grupoSigla" | "unidades">,
  l: { filial: number; balde: string | null; rateio: boolean; manual?: boolean; /** A linha de Montagem tem a equivalente nos Complementares (CSC). */ parNaComplementar?: boolean },
): number[] {
  if (linha.tipo !== "ITEM") return [];
  const b = l.balde ?? "";
  // A conta pela descrição de origem (25/11/2026), que não muda com a Descrição.
  const desc = descricaoDeOrigem(linha.codigo);
  const g = linha.grupoSigla;
  if (l.manual && b === "RN") return linha.unidades.includes(UNIDADE.RN) ? [UNIDADE.RN] : [];
  if (g === "P" || g === "S" || CALCULADAS.has(desc)) return [];
  const comissao = desc === slugDaDRE("Comissões de Representantes e Terceiros");
  const impostos = desc === slugDaDRE("Impostos Operacionais");
  const abas: number[] = [];
  for (const u of linha.unidades) {
    if (l.rateio) {
      // Os rateios: a produção nas linhas da Matriz e da Filial (e nas de Serviços, pela linha de custo de produção); o
      // acompanhamento na Montagem (a base dele) e nas financeiras de Despesas e Extra.
      const producao = (RATEIOS_PRODUCAO as readonly string[]).includes(b);
      if ((u === UNIDADE.MATRIZ || u === UNIDADE.FILIAL) && producao && !comissao && !impostos) abas.push(u);
      else if (u === UNIDADE.SERVICOS && b === "ACOMPANHAMENTO" && g === "CSM") abas.push(u);
      else if (u === UNIDADE.DESPESAS && b === "ACOMPANHAMENTO" && FINANCEIRAS.has(g)) abas.push(u);
      continue;
    }
    if (u === UNIDADE.MATRIZ || u === UNIDADE.FILIAL) {
      const destino = DESTINO_DA_UNIDADE[u];
      const receita = impostos || desc === slugDaDRE("Receita Bruta do Pré-Fabricado") || desc === slugDaDRE("Receita Bruta de Devoluções e Inventários");
      if (comissao || b === destino || (b === "UNIDADE" && l.filial === u) || (receita && b === "DESPESAS" && l.filial === u)) abas.push(u);
    } else if (u === UNIDADE.SERVICOS) {
      if (comissao || desc === slugDaDRE("Receita Bruta de Montagem")) abas.push(u);
      else if (impostos) { if (b === "OBRAS") abas.push(u); }
      else if (g === "CSM" && b === "OBRAS") abas.push(u);
      else if (g === "CSC" && b === "COMPLEMENTAR") abas.push(u);
      // O frete dos complementares (24/10/2026): o Frete e Descarga do DVV, só do balde COMPLEMENTAR.
      else if (g === "DVV" && desc === slugDaDRE("Frete e Descarga") && b === "COMPLEMENTAR") abas.push(u);
      // A Montagem com o balde COMPLEMENTAR vai para a linha equivalente dos Complementares, quando ela existe.
      else if (g === "CSM" && b === "COMPLEMENTAR" && l.parNaComplementar) abas.push(u);
    } else if (u === UNIDADE.DESPESAS) abas.push(u);
  }
  return abas;
}

type LinhaDaConta = Pick<LinhaEstrutura, "id" | "codigo" | "tipo" | "grupo" | "grupoSigla" | "atribuicao" | "descricao" | "unidades">;
// A mesma atribuição e a mesma descrição de origem (25/11/2026: pelo código sem o grupo, que não muda com os nomes).
const mesmaLinha = (a: LinhaDaConta, b: LinhaDaConta) => semOGrupo(a.codigo) === semOGrupo(b.codigo);

/**
 * As abas que leem uma conta com esta linha e este rateio, na filial 1 e na 2 (24/10/2026): as dos lançamentos que
 * seguem o rateio da conta — de obras, de centros fora do cadastro e sem centro. Vazias nas duas, esses lançamentos
 * ficam com a pendência Sem Aba de Resultado; o cadastro da conta recusa a combinação.
 */
export function abasDaConta(linha: LinhaDaConta, balde: string | null, linhas: LinhaDaConta[]): [number[], number[]] {
  const par = linha.grupoSigla === "CSM" && linhas.some((x) => x.tipo === "ITEM" && x.grupoSigla === "CSC" && mesmaLinha(x, linha));
  const abas = (filial: number) => abasQueSomam(linha, { filial, balde, rateio: CHAVES_DE_RATEIO.has(balde ?? ""), parNaComplementar: par }).sort((a, b) => a - b);
  return [abas(1), abas(2)];
}

/**
 * As combinações que alguma aba lê, para a conta com a linha escolhida (24/10/2026): a própria linha e as equivalentes
 * de outros departamentos (mesma atribuição e descrição), cada uma com os rateios aceitos, na ordem de `baldes`.
 */
export function combinacoesDaConta(escolhida: LinhaDaConta, linhas: LinhaDaConta[], baldes: string[]) {
  const candidatas = [escolhida, ...linhas.filter((l) => l.id !== escolhida.id && l.tipo === "ITEM" && mesmaLinha(l, escolhida))];
  return candidatas.flatMap((linha) =>
    baldes.map((balde) => ({ linha, balde, abas: abasDaConta(linha, balde, linhas) })).filter((c) => c.abas[0].length || c.abas[1].length),
  );
}

export function apurarUnidades(d: DadosApuracao): { resultados: ResultadoLinha[]; avisos: string[] } {
  const avisos: string[] = [];
  // A linha equivalente de outro departamento: a mesma atribuição e descrição de origem (25/11/2026: pelo código, e não
  // pelos nomes do grupo, da atribuição e da conta, que mudam a qualquer momento).
  const porGrupoESemGrupo = new Map(d.linhas.filter((l) => l.tipo === "ITEM").map((l) => [`${l.grupoSigla}|${semOGrupo(l.codigo)}`, l]));
  const porCodigo = new Map(d.linhas.map((l) => [l.codigo, l]));
  const linhaCP = (l: LinhaEstrutura) => porGrupoESemGrupo.get(`CPP|${semOGrupo(l.codigo)}`);
  const linhaCSM = (l: LinhaEstrutura) => porGrupoESemGrupo.get(`CSM|${semOGrupo(l.codigo)}`);
  const linhaCSC = (l: LinhaEstrutura) => porGrupoESemGrupo.get(`CSC|${semOGrupo(l.codigo)}`);

  // Os lançamentos manuais fora do balde RN (21/10/2026): como lançamentos do balancete do mesmo balde, filial e linha,
  // no sinal do balancete; os que nenhuma aba soma ficam num aviso.
  const porId = new Map(d.linhas.map((l) => [l.id, l]));
  const manuaisComoBalancete: LancamentoClassificado[] = [];
  for (const m of d.manuais) {
    const linha = m.linhaDREId ? porId.get(m.linhaDREId) : undefined;
    if (!linha) continue;
    const rateioManual = CHAVES_DE_RATEIO.has(m.balde ?? "");
    if (!abasQueSomam(linha, { filial: m.filial ?? 1, balde: m.balde, rateio: rateioManual, manual: true, parNaComplementar: !!linhaCSC(linha) }).length) {
      avisos.push(`Lançamento manual de ${m.valor.toFixed(2)} em "${linha.descricao}" (balde ${m.balde ?? "-"}, filial ${m.filial ?? "-"}): nenhuma aba de resultado soma essa combinação; ficou fora do resultado.`);
    }
    if (n(m.balde) === "RN") continue;
    // O de rateio com os percentuais de outra competência (30/10/2026) fica à parte, com a competência.
    const rateioDe = rateioManual && m.rateioDe && d.percentuaisDe?.has(m.rateioDe) ? m.rateioDe : undefined;
    manuaisComoBalancete.push({
      filial: m.filial ?? 1,
      linhaDREId: linha.id,
      balde: m.balde,
      alocacao: rateioManual ? "RATEIO" : "DIRETO",
      valor: manualNoSinalDoBalancete(linha.grupoSigla, m.valor),
      ...(rateioDe ? { rateioDe } : {}),
    });
  }
  const lancamentos = [...d.lancamentos, ...manuaisComoBalancete];

  // Somas dos lançamentos, na forma dos SOMASES da Gastos (Contábil): os
  // diretos por filial, linha e balde; os de rateio por chave e linha (os com os percentuais de outra competência, também
  // por ela).
  const direto = new Map<string, Decimal>();
  const rateio = new Map<string, Decimal>();
  const somar = (m: Map<string, Decimal>, k: string, v: Decimal) => m.set(k, (m.get(k) ?? zero()).plus(v));
  for (const l of lancamentos) {
    if (!l.linhaDREId) continue;
    if (l.alocacao === "RATEIO") somar(rateio, `${l.balde}|${l.linhaDREId}${l.rateioDe ? `|${l.rateioDe}` : ""}`, l.valor);
    else somar(direto, `${l.filial}|${l.linhaDREId}|${l.balde}`, l.valor);
  }
  const somaDireto = (linhaId: string | undefined, filtro: { filial?: number; balde?: (b: string) => boolean } = {}) => {
    if (!linhaId) return zero();
    let s = zero();
    for (const [k, v] of direto) {
      const [f, id, b] = k.split("|");
      if (id !== linhaId) continue;
      if (filtro.filial !== undefined && Number(f) !== filtro.filial) continue;
      if (filtro.balde && !filtro.balde(b)) continue;
      s = s.plus(v);
    }
    return s;
  };
  const somaPares = (linhaId: string | undefined, pares: ParBalde[]) => {
    if (!linhaId) return zero();
    let s = zero();
    for (const [k, v] of direto) {
      const [f, id, b] = k.split("|");
      if (id === linhaId && pares.some((p) => p.balde === b && (p.filial === undefined || p.filial === Number(f)))) s = s.plus(v);
    }
    return s;
  };
  const descreverPares = (pares: ParBalde[]) =>
    pares.map((p) => (p.filial === undefined ? `balde ${p.balde}` : `balde ${p.balde} da filial ${p.filial}`)).join(" + ");
  /**
   * As bases do rateio da chave na linha: a dos lançamentos do mês, com os percentuais dele, e a dos lançamentos manuais
   * de cada outra competência (30/10/2026), com os percentuais dela. Com `exige`, só as em que a chave tem regra para
   * esse destino (o percentual fixo de uma chave em outra unidade).
   */
  type BaseDoRateio = { base: Decimal; percentuais: Map<string, Decimal>; competencia?: { id: string; rotulo: string } };
  const basesDoRateio = (chave: string, linhaId: string | undefined, exige?: string): BaseDoRateio[] => {
    if (!linhaId) return [];
    const fontes: BaseDoRateio[] = [{ base: rateio.get(`${chave}|${linhaId}`) ?? zero(), percentuais: d.percentuais }];
    for (const [id, o] of d.percentuaisDe ?? []) fontes.push({ base: rateio.get(`${chave}|${linhaId}|${id}`) ?? zero(), percentuais: o.percentuais, competencia: { id, rotulo: o.rotulo } });
    return fontes.filter((f) => !f.base.isZero() && (!exige || f.percentuais.has(`${chave}|${exige}`)));
  };
  const pct = (chave: string, destino: string, percentuais: Map<string, Decimal>) => percentuais.get(`${chave}|${destino}`) ?? zero();
  const total = (codigo: string) => d.totais.get(codigo) ?? zero();
  const previa = (unidade: number, natureza: string) =>
    d.receitas.find((r) => r.unidade === unidade && r.natureza === natureza) ?? { receitaBruta: zero(), receitaLiquida: zero() };
  const manualRN = (linhaId: string) =>
    d.manuais.filter((m) => m.linhaDREId === linhaId && n(m.balde) === "RN").reduce((a, m) => a.plus(m.valor), zero());

  const parcela = (chave: string, destino: string, linhaBase: LinhaEstrutura | undefined, base: Decimal, p: Decimal, competencia?: BaseDoRateio["competencia"]): ParcelaRateio => ({
    chave,
    destino,
    base: `${linhaBase?.codigo ?? "?"}: ${base.toFixed(2)}`,
    percentual: p.toFixed(10),
    valor: base.times(p).toFixed(2),
    linhaId: linhaBase?.id,
    ...(competencia ? { competenciaId: competencia.id, competencia: competencia.rotulo } : {}),
  });

  // Valores por unidade, linha → valor.
  const valores = new Map<number, Map<string, Decimal>>();
  const composicoes = new Map<string, Composicao>();
  const gravar = (u: number, l: LinhaEstrutura, v: Decimal, c: Composicao | null) => {
    if (!valores.has(u)) valores.set(u, new Map());
    valores.get(u)!.set(l.codigo, v);
    if (c) composicoes.set(`${u}|${l.codigo}`, c);
  };
  const valorDe = (u: number, codigo: string) => valores.get(u)?.get(codigo) ?? zero();
  const itemDe = (u: number, descricao: string) => {
    const l = d.linhas.find((x) => x.tipo === "ITEM" && ehAConta(x, descricao) && x.unidades.includes(u));
    return l ? valorDe(u, l.codigo) : zero();
  };

  // --- Volumes (linhas P e S), da aba Totais -------------------------------
  const VOLUMES = VOLUMES_DA_DRE;

  // Sem as guardas das fórmulas da planilha (IF(B$4=0,0,…) na Matriz e na Filial e IF(B$6=0,0,…) em Serviços), que
  // zeravam a unidade inteira num mês sem produção ou sem montagem: servem só ao Excel (para esconder os meses
  // vazios), e não à ferramenta (decisão do usuário de 13/10/2026). O mês sem produção mostra os custos que teve.

  const itensDa = (u: number) => d.linhas.filter((l) => l.tipo === "ITEM" && l.unidades.includes(u));
  const ehVolume = (l: LinhaEstrutura) => l.grupoSigla === "P" || l.grupoSigla === "S";
  const ehComissao = (l: LinhaEstrutura) => ehAConta(l, "Comissões de Representantes e Terceiros");
  const linhaPorDescricao = (u: number, descricao: string) =>
    d.linhas.find((x) => ehAConta(x, descricao) && x.unidades.includes(u) && (x.tipo === "ITEM" || x.tipo === "TOTAL"));

  // --- Matriz e Filial -----------------------------------------------------
  // Os diretos da unidade são o balde dela (MATRIZ ou FILIAL), de qualquer
  // filial, e o balde UNIDADE da filial dela; nas receitas e nos impostos,
  // também o balde DESPESAS da filial (abas Resultados (Matriz) e (Filial),
  // a partir de 06/10/2026).
  for (const u of [UNIDADE.MATRIZ, UNIDADE.FILIAL]) {
    const destino = DESTINO_DA_UNIDADE[u];
    const receitaFrete = previa(u, "FRETE");
    const paresCusto: ParBalde[] = [{ balde: destino }, { balde: "UNIDADE", filial: u }];
    const paresReceita: ParBalde[] = [...paresCusto, { balde: "DESPESAS", filial: u }];
    for (const l of itensDa(u)) {
      if (ehVolume(l)) {
        const cods = VOLUMES[u][descricaoDeOrigem(l.codigo)] ?? [];
        gravar(u, l, cods.reduce((a, c) => a.plus(total(c)), zero()), { regra: `Volume da aba Totais: ${cods.join(" + ") || "—"}` });
        continue;
      }
      if (ehComissao(l)) continue; // depois da ROB consolidada
      const desc = descricaoDeOrigem(l.codigo);
      if (desc === slugDaDRE("Receita Bruta do Pré-Fabricado")) {
        const contabil = somaPares(l.id, paresReceita);
        gravar(u, l, receitaFrete.receitaBruta.neg().minus(contabil), {
          regra: `−(frete da receita prévia) − (receita contábil: ${descreverPares(paresReceita)})`,
          direto: contabil.toFixed(2),
          observacao: `Frete da receita prévia: ${receitaFrete.receitaBruta.toFixed(2)}`,
          origem: { contabil: { linhaId: l.id, pares: paresReceita, fator: "-1" }, previa: [{ unidade: u, natureza: "FRETE", componente: "BRUTA", sinal: -1 }] },
        });
      } else if (desc === slugDaDRE("Receita Bruta de Frete")) {
        gravar(u, l, receitaFrete.receitaBruta, {
          regra: "Receita bruta de frete da receita prévia",
          origem: { previa: [{ unidade: u, natureza: "FRETE", componente: "BRUTA", sinal: 1 }] },
        });
      } else if (desc === slugDaDRE("Receita Bruta de Devoluções e Inventários")) {
        // Negativa, como a receita bruta do pré-fabricado (correção do usuário de 06/10/2026).
        const c = somaPares(l.id, paresReceita);
        gravar(u, l, c.neg(), {
          regra: `−(lançamentos contábeis: ${descreverPares(paresReceita)})`,
          direto: c.toFixed(2),
          origem: { contabil: { linhaId: l.id, pares: paresReceita, fator: "-1" } },
        });
      } else if (desc === slugDaDRE("Receita Líquida de Frete")) {
        gravar(u, l, receitaFrete.receitaLiquida, {
          regra: "Receita líquida de frete da receita prévia",
          origem: { previa: [{ unidade: u, natureza: "FRETE", componente: "LIQUIDA", sinal: 1 }] },
        });
      } else if (desc === slugDaDRE("Receita Líquida do Pré-Fabricado") || desc === slugDaDRE("Receita Líquida de Devoluções e Inventários")) {
        continue; // depois dos impostos
      } else {
        const dir = somaPares(l.id, paresCusto);
        let v = dir;
        const rateios: ParcelaRateio[] = [];
        for (const chave of RATEIOS_PRODUCAO) {
          for (const f of basesDoRateio(chave, l.id)) {
            const p = pct(chave, destino, f.percentuais);
            rateios.push(parcela(chave, destino, l, f.base, p, f.competencia));
            v = v.plus(f.base.times(p));
          }
        }
        // O acompanhamento com percentual fixo na Matriz ou na Filial (14/10/2026): a base é a mesma conta na montagem
        // (CSM), onde os lançamentos dele estão.
        const linhaBase = linhaCSM(l);
        for (const f of basesDoRateio("ACOMPANHAMENTO", linhaBase?.id, destino)) {
          const p = pct("ACOMPANHAMENTO", destino, f.percentuais);
          rateios.push(parcela("ACOMPANHAMENTO", destino, linhaBase, f.base, p, f.competencia));
          v = v.plus(f.base.times(p));
        }
        gravar(u, l, v, {
          regra: `Diretos (${descreverPares(paresCusto)}) + rateios × percentual da unidade`,
          direto: dir.toFixed(2),
          rateios,
          origem: { contabil: { linhaId: l.id, pares: paresCusto } },
        });
      }
    }
    // Impostos Operacionais: no Consolidado é ROB − ROL; na unidade, o contábil
    // dos baldes da receita.
    const io = linhaPorDescricao(u, "Impostos Operacionais");
    if (io) {
      const v = somaPares(io.id, paresReceita);
      gravar(u, io, v, {
        regra: `Lançamentos contábeis: ${descreverPares(paresReceita)}`,
        direto: v.toFixed(2),
        origem: { contabil: { linhaId: io.id, pares: paresReceita } },
      });
    }
    // Receitas líquidas do pré-fabricado e das devoluções: a bruta menos a
    // parte dos impostos (sem os do frete), na proporção da bruta.
    const robPre = itemDe(u, "Receita Bruta do Pré-Fabricado");
    const robDev = itemDe(u, "Receita Bruta de Devoluções e Inventários");
    const irb = io ? valorDe(u, io.codigo) : zero();
    const impostosFrete = receitaFrete.receitaBruta.minus(receitaFrete.receitaLiquida);
    const base = robPre.plus(robDev);
    const fator = base.isZero() ? zero() : irb.minus(impostosFrete).div(base);
    if (base.isZero() && !irb.minus(impostosFrete).isZero()) {
      avisos.push(`Unidade ${u}: receita bruta de pré-fabricado + devoluções é zero; a planilha dá #DIV/0! nas receitas líquidas.`);
    }
    for (const [descricao, rob] of [["Receita Líquida do Pré-Fabricado", robPre], ["Receita Líquida de Devoluções e Inventários", robDev]] as const) {
      const l = linhaPorDescricao(u, descricao);
      if (!l) continue;
      gravar(u, l, rob.minus(fator.times(rob)), {
        regra: "Bruta − (IRB − impostos do frete) / (bruta do pré-fabricado + devoluções) × bruta",
        observacao: `Bruta ${rob.toFixed(2)} − (IRB ${irb.toFixed(2)} − impostos do frete ${impostosFrete.toFixed(2)}) / ${base.toFixed(2)} × bruta; fator ${fator.toFixed(10)}`,
      });
    }
  }

  // --- Serviços -------------------------------------------------------------
  {
    const u = UNIDADE.SERVICOS;
    const compl = previa(u, "COMPLEMENTAR");
    // O frete da receita prévia de Serviços (20/11/2026, a receita de frete da Fundação nos cenários): hoje não há — o frete
    // faturado com os serviços está na complementar —; com ele, vai às linhas de frete de Serviços e sai da de montagem.
    const frete = previa(u, "FRETE");
    const comFrete = !frete.receitaBruta.isZero() || !frete.receitaLiquida.isZero();
    for (const l of itensDa(u)) {
      const desc = descricaoDeOrigem(l.codigo);
      if (ehVolume(l)) {
        const cods = VOLUMES[u][desc] ?? [];
        gravar(u, l, cods.reduce((a, c) => a.plus(total(c)), zero()), { regra: `Volume da aba Totais: ${cods.join(" + ") || "—"}` });
        continue;
      }
      if (ehComissao(l)) continue;
      if (desc === slugDaDRE("Receita Bruta de Montagem")) {
        const c = somaDireto(l.id);
        gravar(u, l, compl.receitaBruta.neg().minus(frete.receitaBruta).minus(c), {
          regra: comFrete
            ? "−(complementar e frete da receita prévia) − (receita contábil, todas as filiais)"
            : "−(complementar da receita prévia) − (receita contábil, todas as filiais)",
          direto: c.toFixed(2),
          origem: {
            contabil: { linhaId: l.id, fator: "-1" },
            previa: [
              { unidade: u, natureza: "COMPLEMENTAR", componente: "BRUTA", sinal: -1 },
              ...(comFrete ? [{ unidade: u, natureza: "FRETE", componente: "BRUTA" as const, sinal: -1 as const }] : []),
            ],
          },
        });
      } else if (desc === slugDaDRE("Receita Bruta de Frete") || desc === slugDaDRE("Receita Líquida de Frete")) {
        const liquida = desc === slugDaDRE("Receita Líquida de Frete");
        gravar(u, l, liquida ? frete.receitaLiquida : frete.receitaBruta, {
          regra: `Receita ${liquida ? "líquida" : "bruta"} de frete da receita prévia de Serviços`,
          origem: { previa: [{ unidade: u, natureza: "FRETE", componente: liquida ? "LIQUIDA" : "BRUTA", sinal: 1 }] },
        });
      } else if (desc === slugDaDRE("Receita Bruta Complementar")) {
        gravar(u, l, compl.receitaBruta, {
          regra: "Receita bruta complementar da receita prévia",
          origem: { previa: [{ unidade: u, natureza: "COMPLEMENTAR", componente: "BRUTA", sinal: 1 }] },
        });
      } else if (desc === slugDaDRE("Receita Líquida Complementar")) {
        gravar(u, l, compl.receitaLiquida, {
          regra: "Receita líquida complementar da receita prévia",
          origem: { previa: [{ unidade: u, natureza: "COMPLEMENTAR", componente: "LIQUIDA", sinal: 1 }] },
        });
      } else if (desc === slugDaDRE("Receita Líquida de Montagem")) {
        continue; // depois dos impostos
      } else if (l.grupoSigla === "DVV" && desc === slugDaDRE("Frete e Descarga")) {
        // O frete dos complementares (24/10/2026, pedido do Adão): em Serviços, só o balde COMPLEMENTAR; o de montagem
        // (OBRAS) não tem a linha. Na Matriz e na Filial, o frete segue como antes.
        const v = somaDireto(l.id, { balde: (b) => b === "COMPLEMENTAR" });
        gravar(u, l, v, {
          regra: "Lançamentos contábeis do balde COMPLEMENTAR, todas as filiais (o frete dos complementares)",
          direto: v.toFixed(2),
          origem: { contabil: { linhaId: l.id, baldes: ["COMPLEMENTAR"] } },
        });
      } else if (l.grupoSigla === "CSM" || l.grupoSigla === "CSC") {
        const montagem = l.grupoSigla === "CSM";
        const destino = montagem ? "MONTAGEM" : "COMPLEMENTAR";
        // Nos Complementares, também os diretos do balde COMPLEMENTAR da linha equivalente da Montagem (21/10/2026).
        const par = montagem ? undefined : linhaCSM(l);
        const dirPar = par ? somaDireto(par.id, { balde: (b) => b === "COMPLEMENTAR" }) : zero();
        const dir = somaDireto(l.id, { balde: (b) => b === (montagem ? "OBRAS" : "COMPLEMENTAR") }).plus(dirPar);
        let v = dir;
        const rateios: ParcelaRateio[] = [];
        const partes: Array<[string, LinhaEstrutura | undefined, string?]> = [
          ["ACOMPANHAMENTO", montagem ? l : linhaCSM(l)],
          ["METALURGIA", linhaCP(l)],
          ["ARMADURA", linhaCP(l)],
          // Projeto e Produção com percentual fixo em Serviços (14/10/2026): a base é a mesma conta na produção (CP), nos
          // percentuais com a regra delas para a unidade.
          ["PROJETO", linhaCP(l), destino],
          ["PRODUCAO", linhaCP(l), destino],
        ];
        // A depreciação de montagem fica com o acompanhamento inteiro: o bloco
        // complementar não tem linha de depreciação (aba Resultados (Serviços),
        // linha 68, correção do usuário de 06/10/2026).
        const acompanhamentoInteiro = montagem && ehAConta(l, "Depreciação do Maquinário");
        for (const [chave, linhaBase, exige] of partes) {
          for (const f of basesDoRateio(chave, linhaBase?.id, exige)) {
            const p = chave === "ACOMPANHAMENTO" && acompanhamentoInteiro ? zero().plus(1) : pct(chave, destino, f.percentuais);
            rateios.push(parcela(chave, destino, linhaBase, f.base, p, f.competencia));
            v = v.plus(f.base.times(p));
          }
        }
        gravar(u, l, v, {
          regra: `Diretos do balde ${montagem ? "OBRAS" : "COMPLEMENTAR"}${par ? " (também os da linha da Montagem)" : ""} + rateios × percentual de ${destino.toLowerCase()}`,
          direto: dir.toFixed(2),
          rateios,
          origem: { contabil: { linhaId: l.id, baldes: [montagem ? "OBRAS" : "COMPLEMENTAR"] }, ...(par ? { contabilPar: { linhaId: par.id, baldes: ["COMPLEMENTAR"] } } : {}) },
        });
      } else {
        gravar(u, l, zero(), { regra: "Linha sem regra na unidade" });
        avisos.push(`Serviços: a linha ${l.codigo} não tem regra de apuração.`);
      }
    }
    const io = linhaPorDescricao(u, "Impostos Operacionais");
    if (io) {
      const v = somaDireto(io.id, { balde: (b) => b === "OBRAS" });
      gravar(u, io, v, {
        regra: "Lançamentos contábeis do balde OBRAS, todas as filiais",
        direto: v.toFixed(2),
        origem: { contabil: { linhaId: io.id, baldes: ["OBRAS"] } },
      });
      const rlm = linhaPorDescricao(u, "Receita Líquida de Montagem");
      if (rlm) {
        const rbm = itemDe(u, "Receita Bruta de Montagem");
        const impCompl = compl.receitaBruta.minus(compl.receitaLiquida);
        // Os impostos do frete de Serviços (20/11/2026; hoje não há) também saem, como os da complementar.
        const impFrete = frete.receitaBruta.minus(frete.receitaLiquida);
        gravar(u, rlm, rbm.minus(v.minus(impCompl).minus(impFrete)), {
          regra: comFrete ? "Bruta de montagem − (IRB − impostos da complementar e do frete)" : "Bruta de montagem − (IRB − impostos da complementar)",
          observacao: comFrete
            ? `Bruta de montagem ${rbm.toFixed(2)} − (IRB ${v.toFixed(2)} − impostos da complementar ${impCompl.toFixed(2)} − impostos do frete ${impFrete.toFixed(2)})`
            : `Bruta de montagem ${rbm.toFixed(2)} − (IRB ${v.toFixed(2)} − impostos da complementar ${impCompl.toFixed(2)})`,
        });
      }
    }
  }

  // --- Despesas + Extra ----------------------------------------------------
  // Sem a guarda da ROL consolidada (Resultados (Desp.+Extra), linha 2), que zerava as despesas num mês sem receita:
  // como as guardas da produção e da montagem, servia só ao Excel (decisão do usuário de 13/10/2026).
  const robDe = (u: number) => {
    const l = porCodigo.get("ROB.RECEITA_OPERACIONAL_BRUTA_ROB");
    return l?.expressao ? avaliarExpressao(l.expressao, (c) => valorDe(u, c)) : zero();
  };
  const robConsolidada = [1, 2, 3].reduce((a, u) => a.plus(robDe(u)), zero());
  {
    const u = UNIDADE.DESPESAS;
    for (const l of itensDa(u)) {
      const c = somaDireto(l.id);
      // Receitas financeiras entram com o sinal trocado (linhas 84, 85 e 87).
      const financeira = l.grupoSigla === "RFC" || l.grupoSigla === "RFNC";
      // As receitas e despesas financeiras somam também o rateio de
      // acompanhamento inteiro (linhas 84, 85, 87, 91 a 93 e 95, correções do
      // usuário de 06/10/2026): é o centro ADM. DE OBRAS que transforma em
      // rateio os juros e descontos lançados nele.
      const despesaFinanceira = l.grupoSigla === "DFC" || l.grupoSigla === "DFNC";
      const bases = despesaFinanceira || financeira ? basesDoRateio("ACOMPANHAMENTO", l.id) : [];
      const acompanhamento = bases.reduce((a, f) => a.plus(f.base), zero());
      const rateios = bases.map((f) => parcela("ACOMPANHAMENTO", "DESPESAS", l, f.base, zero().plus(financeira ? -1 : 1), f.competencia));
      gravar(u, l, financeira ? c.plus(acompanhamento).neg() : c.plus(acompanhamento), {
        regra: financeira
          ? "−(lançamentos contábeis diretos + rateio de acompanhamento inteiro)"
          : despesaFinanceira
            ? "Lançamentos contábeis diretos + rateio de acompanhamento inteiro"
            : "Lançamentos contábeis diretos",
        direto: c.toFixed(2),
        ...(rateios.length ? { rateios } : {}),
        origem: { contabil: { linhaId: l.id, ...(financeira ? { fator: "-1" } : {}) } },
      });
    }
  }

  // --- RN: lançamentos manuais do balde RN ----------------------------------
  for (const l of itensDa(UNIDADE.RN)) {
    const v = manualRN(l.id);
    gravar(UNIDADE.RN, l, v, { regra: "Lançamentos manuais do balde RN", origem: { manual: { linhaId: l.id, balde: "RN" } } });
  }

  // --- Comissões: diretos × participação da unidade na ROB consolidada ------
  for (const u of [UNIDADE.MATRIZ, UNIDADE.FILIAL, UNIDADE.SERVICOS]) {
    for (const l of itensDa(u).filter(ehComissao)) {
      const c = somaDireto(l.id);
      const rob = robDe(u);
      const v = robConsolidada.isZero() ? zero() : c.div(robConsolidada).times(rob);
      const fator = robConsolidada.isZero() ? null : rob.div(robConsolidada);
      gravar(u, l, v, {
        regra: "Diretos da linha / ROB consolidada × ROB da unidade",
        direto: c.toFixed(2),
        observacao: `ROB ${rob.toFixed(2)} de ${robConsolidada.toFixed(2)}`,
        origem: fator ? { contabil: { linhaId: l.id, fator: fator.toString() } } : undefined,
      });
    }
  }

  // --- Rateios sem volume (13/10/2026) -------------------------------------
  // Todo custo e despesa vai para algum lugar: uma chave com lançamentos de rateio e sem volume no mês (todos os
  // percentuais zero) deixa esses lançamentos fora de todas as unidades. O aviso diz quanto ficou de fora. As receitas e
  // as despesas financeiras do acompanhamento vão inteiras para Despesas e Extra e não dependem dos percentuais.
  for (const [chave, valor] of rateiosSemVolume({ ...d, lancamentos: lancamentos.filter((l) => !l.rateioDe) })) {
    avisos.push(`Rateio de ${NOME_DA_CHAVE[chave] ?? chave} sem volume no mês: ${valor.toFixed(2)} em lançamentos de rateio não foram para nenhuma unidade.`);
  }
  for (const [id, o] of d.percentuaisDe ?? []) {
    for (const [chave, valor] of rateiosSemVolume({ linhas: d.linhas, percentuais: o.percentuais, lancamentos: lancamentos.filter((l) => l.rateioDe === id) })) {
      avisos.push(`Rateio de ${NOME_DA_CHAVE[chave] ?? chave} sem volume em ${o.rotulo}: ${valor.toFixed(2)} em lançamentos manuais com os percentuais dessa competência não foram para nenhuma unidade.`);
    }
  }

  // --- Subtotais e totais, pela estrutura, com os itens da unidade ---------
  const ordenadas = [...d.linhas].filter((l) => l.tipo !== "ITEM" && l.tipo !== "SECAO" && l.expressao);
  for (const u of [1, 2, 3, 4, 5]) {
    const avaliar = (codigo: string, pilha = new Set<string>()): Decimal => {
      const jaTem = valores.get(u)?.get(codigo);
      if (jaTem !== undefined) return jaTem;
      const l = porCodigo.get(codigo);
      if (!l || l.tipo === "ITEM" || !l.expressao) return zero();
      if (pilha.has(codigo)) throw new Error(`Referência circular na estrutura da DRE: ${codigo}`);
      pilha.add(codigo);
      const v = avaliarExpressao(l.expressao, (c) => avaliar(c, pilha));
      gravar(u, l, v, null);
      return v;
    };
    for (const l of ordenadas) avaliar(l.codigo);
  }

  // Linhas da unidade: as que a estrutura atribui a ela e os totais gerais
  // (margens) cujas parcelas são todas da unidade — a margem bruta e a de
  // contribuição entram na Matriz; o EBITDA, que usa as despesas fixas, não.
  const daUnidade = (u: number) => {
    const s = new Set(d.linhas.filter((l) => l.unidades.includes(u)).map((l) => l.codigo));
    for (let mudou = true; mudou; ) {
      mudou = false;
      for (const l of d.linhas) {
        if (s.has(l.codigo) || l.unidades.length > 0 || !l.expressao) continue;
        if (codigosDaExpressao(l.expressao).every((c) => s.has(c))) {
          s.add(l.codigo);
          mudou = true;
        }
      }
    }
    return s;
  };
  const resultados: ResultadoLinha[] = [];
  for (const [u, m] of valores) {
    const relevantes = daUnidade(u);
    for (const [codigo, valor] of m) {
      if (!relevantes.has(codigo)) continue;
      const l = porCodigo.get(codigo)!;
      resultados.push({ unidade: u, linhaId: l.id, codigo, valor, composicao: composicoes.get(`${u}|${codigo}`) ?? null });
    }
  }
  return { resultados, avisos };
}
