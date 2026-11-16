import { getPrismaClient } from "../../config/prisma.js";
import { estrutura } from "../dre/dreService.js";
import { diasUteis } from "./calendario.js";
import { contasDoGrupo, ehContaDeCentro, gruposDoCadastro, nomeDoGrupo } from "./centrosCenario.js";
import { CONTAS_DEPRECIACAO, contasExtra, UNIDADES_EXTRA, VENDA_BASE, VENDA_EXTRA } from "./investimentosCenario.js";
import { centroPadrao, grupoDoCentroRM, type MovimentacaoForaDoPadrao } from "./realocacoesCenario.js";
import { C, contasDaLinha, LINHAS_COM_ARMADURA, LINHAS_COM_METALURGIA, LIQUIDA_DA_BRUTA, linhasDoCadastro, UNIDADES_PREMISSAS, VENDAS_DA_UNIDADE, type LinhaDoCadastro, type UnidadePremissa, type Venda } from "./premissasCenario.js";

/**
 * A referência realizada dos cenários analíticos (14/10/2026, etapa 5): do realizado das competências de um período,
 *
 * - as Médias de Referência das premissas (Matriz, Filial e Serviços, por linha e venda), que também viram os doze
 *   meses: a demanda diária (o volume do período ÷ os dias úteis dele), a armadura e a metalurgia por unidade da linha,
 *   a receita bruta média (com as devoluções e os inventários) e os impostos, e os custos (com a mão de obra
 *   terceirizada) e as despesas variáveis de venda em R$ por unidade da linha;
 * - os valores dos grupos de centros de custo, a depreciação de cada unidade e o extra-operacional, mês a mês.
 *
 * Os volumes saem das listas (a produção — em m³, com as pistas nas linhas de pistas —, a metalurgia em kg, a montagem
 * em m³, a armadura e os acompanhamentos), na venda da obra (o tipo de venda dela; sem ele, G… é Global e o resto
 * Mercantil; sem obra, pela receita da linha em cada venda). Em Serviços, a linha sem volume nas listas (Vedação,
 * Fundação, Capeamento, Telhamento…) vai por dia útil: a demanda diária fica 1 e os valores médios são por dia.
 *
 * A receita de cada conta (Pré-Fabricado, Frete, Montagem e Complementar) é a da DRE realizada da unidade, dividida
 * entre as linhas e as vendas pela receita prévia (os itens trazem a linha e a venda); os impostos, os dos itens. Os
 * custos (Matérias Primas, Gastos Gerais Variáveis e Estoque) e as despesas variáveis de venda de cada conta e mês são
 * os da DRE realizada da unidade, divididos entre as linhas na proporção das requisições e das notas fiscais com a
 * tarefa de cada linha (a correspondência tarefa × linha); a parte sem tarefa (ou com uma tarefa sem correspondência)
 * vai pelo volume das linhas (o m³; nas despesas variáveis de venda e em Serviços, pela receita).
 */

const RECEITA_DA_NATUREZA: Record<string, string> = { PRE_FABRICADO: C.RBPF, FRETE: C.RBF, MONTAGEM: C.RBM, COMPLEMENTAR: C.RBC, DEVOLUCOES_INVENTARIOS: C.RBDI };
const RECEITAS = [C.RBPF, C.RBF, C.RBM, C.RBC, C.RBDI];
const PISTAS = "m³ e pistas";
const emM3 = (l: LinhaDoCadastro) => l.medida === "m³" || l.medida === PISTAS;

export const normalizarTarefa = (t: string | null | undefined) => (t ?? "").trim().replace(/\s+/g, " ").toUpperCase();

export type Correspondencia = { filial: number | null; tarefa: string; unidade: number; linha: string };

/** A linha da tarefa (`u|código`): a correspondência da filial do documento; sem ela, a de qualquer filial. */
export function linhaDaTarefa(correspondencias: Correspondencia[], filial: number | null, tarefa: string | null) {
  const t = normalizarTarefa(tarefa);
  if (!t) return null;
  const c = correspondencias.find((x) => x.filial !== null && x.filial === filial && normalizarTarefa(x.tarefa) === t) ?? correspondencias.find((x) => x.filial === null && normalizarTarefa(x.tarefa) === t);
  return c ? `${c.unidade}|${c.linha}` : null;
}

/**
 * Divide o valor de uma conta entre as linhas (as chaves de `pesos`): cada linha fica com a parte dos documentos com a
 * tarefa dela, e a dos documentos sem tarefa se divide pelos pesos (o volume ou a receita das linhas). Sem documentos,
 * tudo vai pelos pesos; sem pesos, em partes iguais.
 */
export function dividirPorLinhas(total: number, tarefados: Map<string, number>, semTarefa: number, pesos: Map<string, number>) {
  const linhas = [...pesos.keys()];
  const r = new Map<string, number>();
  if (!linhas.length) return r;
  const somaPesos = linhas.reduce((s, l) => s + (pesos.get(l) ?? 0), 0);
  const peso = (l: string) => (somaPesos ? (pesos.get(l) ?? 0) / somaPesos : 1 / linhas.length);
  const doc = (l: string) => tarefados.get(l) ?? 0;
  const documentos = linhas.reduce((s, l) => s + doc(l), 0) + semTarefa;
  for (const l of linhas) r.set(l, total * (documentos ? (doc(l) + semTarefa * peso(l)) / documentos : peso(l)));
  return r;
}

/** A venda da obra: o tipo de venda dela; sem ele, pelo código (G… é Global); sem obra, nula. */
export const vendaDaObra = (obra: { codigo: string; tipoVenda: string | null } | null | undefined): Venda | null =>
  !obra ? null : obra.tipoVenda === "GLOBAL" || obra.tipoVenda === "MERCANTIL" ? obra.tipoVenda : obra.codigo.trim().toUpperCase().startsWith("G") ? "GLOBAL" : "MERCANTIL";

export type ReferenciaRealizada = {
  /** As Médias de Referência (por unidade, venda e chave da premissa). */
  premissas: Array<{ unidade: UnidadePremissa; venda: Venda; chave: string; valor: number }>;
  /** Os grupos de centros de custo, por conta e mês. */
  centros: Array<{ grupo: string; codigo: string; mes: number; valor: number }>;
  /** Os mesmos, sem as realocações aplicadas (14/10/2026: a média dos centros conta os meses com movimentação de cada um). */
  centrosProprios: Array<{ grupo: string; codigo: string; mes: number; valor: number }>;
  /** A depreciação (BASE) e o extra-operacional (EXTRA) das unidades, mês a mês ("u|conta"). */
  mensais: Array<{ venda: typeof VENDA_BASE | typeof VENDA_EXTRA; unidade: number; chave: string; mes: number; valor: number }>;
  /** O que não coube (receita sem volume, custos sem linha…). */
  avisos: string[];
  /**
   * As movimentações fora dos padrões das premissas (14/10/2026): a mão de obra e os gastos gerais que não caem num
   * grupo de centros do cenário, por conta, com os valores de cada mês (1 a 12) — no lugar dos avisos de antes.
   */
  movimentacoes: Array<Omit<MovimentacaoForaDoPadrao, "valores"> & { meses: number[] }>;
  /** As decisões que entraram nos centros desta carga (a conta → o grupo e a conta de destino). */
  aplicadas: Map<string, { grupo: string; conta: string }>;
};

/**
 * A média dos centros de custo na referência Média Replicada (14/10/2026): a soma de cada grupo e conta no período ÷ o
 * número de meses em que a conta teve movimentação no grupo (antes, ÷ todos os meses do período), nos doze meses. A
 * conta sem movimentação no período fica de fora.
 */
export function mediaNosMesesComOcorrencia<T extends { mes: number; valor: number }>(xs: T[], chave: (x: T) => string): T[] {
  const somas = new Map<string, { x: T; soma: number; meses: Set<number> }>();
  for (const x of xs) {
    const s = somas.get(chave(x)) ?? { x, soma: 0, meses: new Set<number>() };
    s.soma += x.valor;
    if (Math.abs(x.valor) >= 0.005) s.meses.add(x.mes);
    somas.set(chave(x), s);
  }
  return [...somas.values()].flatMap(({ x, soma, meses }) => (meses.size ? Array.from({ length: 12 }, (_, k) => ({ ...x, mes: k + 1, valor: soma / meses.size })) : []));
}

/** Os doze meses de uma movimentação na Média Replicada: a soma ÷ os meses com movimentação (14/10/2026). */
export function mediaDosMeses(meses: number[]): number[] {
  const com = meses.filter((v) => Math.abs(v) >= 0.005);
  const media = com.length ? com.reduce((s, v) => s + v, 0) / com.length : 0;
  return Array<number>(12).fill(media);
}

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** A referência realizada dos meses `meses` do exercício `ano` (os das competências pedidas). */
export async function referenciaDoRealizado(ano: number, meses: number[], decisoes: Record<string, string | null> = {}): Promise<ReferenciaRealizada> {
  const prisma = getPrismaClient();
  const comps = await prisma.competencia.findMany({ where: { ano, mes: { in: meses } }, select: { id: true, mes: true } });
  const ids = comps.map((c) => c.id);
  const mesDe = new Map(comps.map((c) => [c.id, c.mes]));
  const naComp = { competenciaId: { in: ids } };
  const obra = { select: { codigo: true, tipoVenda: true } } as const;
  const linhaSel = { select: { codigo: true } } as const;
  const unidadeSel = { select: { codigo: true } } as const;
  const [est, linhas, grupos, corr, unidades, centros, lancamentosDiretos, producoes, pistas, metalurgias, armaduras, montagens, acompanhamentos, itens, requisicoes, notas, contas] = await Promise.all([
    estrutura(),
    linhasDoCadastro(),
    gruposDoCadastro(),
    prisma.correspondenciaTarefa.findMany({ include: { linha: { select: { codigo: true, unidadeNegocio: unidadeSel } } } }),
    prisma.resultadoApurado.findMany({
      where: { ...naComp, centroCustoId: null, unidadeNegocioId: { not: null } },
      select: { competenciaId: true, valor: true, linhaDRE: linhaSel, unidadeNegocio: unidadeSel },
      orderBy: [{ unidadeNegocio: { codigo: "asc" } }, { linhaDRE: { ordem: "asc" } }],
    }),
    prisma.resultadoApurado.findMany({
      where: { ...naComp, centroCustoId: { not: null } },
      select: { competenciaId: true, valor: true, linhaDRE: { select: { codigo: true, tipo: true } }, centroCusto: { select: { nomeControladoria: true, nomeRM: true, codigoRM: true } } },
    }),
    // Os lançamentos das contas de centros (14/10/2026): os que não caem num grupo do cenário são as movimentações fora
    // dos padrões, que o usuário realoca.
    prisma.lancamentoContabil.findMany({
      where: { ...naComp, redistribuicaoId: null, OR: [".MOD.", ".MOI.", ".GGD.", ".GGI.", ".GGC."].map((a) => ({ linhaDRE: { codigo: { contains: a } } })) },
      orderBy: [{ competencia: { mes: "asc" } }, { linhaArquivo: "asc" }],
      select: {
        competenciaId: true,
        filial: true,
        valorMovimento: true,
        codigoCentroCusto: true,
        nomeCentroCusto: true,
        linhaDRE: { select: { codigo: true, tipo: true } },
        contaResultado: { select: { reduzido: true, descricao: true } },
        centroCusto: { select: { nomeControladoria: true, nomeRM: true, codigoRM: true } },
      },
    }),
    prisma.producao.findMany({ where: naComp, select: { quantidade: true, linha: linhaSel, obra, unidadeNegocio: unidadeSel } }),
    prisma.producaoPista.findMany({ where: naComp, select: { quantidade: true, linha: linhaSel, unidadeNegocio: unidadeSel } }),
    prisma.producaoMetalurgia.findMany({ where: naComp, select: { quantidade: true, linha: linhaSel, unidadeNegocio: unidadeSel } }),
    prisma.producaoArmadura.findMany({ where: naComp, select: { quantidade: true, linha: linhaSel, obra, unidadeNegocio: unidadeSel } }),
    prisma.montagem.findMany({ where: naComp, select: { quantidade: true } }),
    prisma.acompanhamento.findMany({ where: naComp, select: { quantidade: true, linha: linhaSel } }),
    prisma.receitaPreviaItem.findMany({
      where: { receitaPrevia: naComp },
      select: { linha: true, venda: true, obraCodigo: true, receitaBruta: true, receitaLiquida: true, receitaPrevia: { select: { natureza: true, unidadeNegocio: unidadeSel } } },
    }),
    prisma.requisicaoItem.findMany({ where: naComp, select: { competenciaId: true, filial: true, nomeTarefa: true, contaContabil: true, valorTotal: true } }),
    prisma.notaFiscalItem.findMany({ where: naComp, select: { competenciaId: true, filial: true, nomeTarefa: true, contaContabil: true, valorTotal: true } }),
    prisma.contaResultado.findMany({ where: { linhaDREId: { not: null } }, select: { reduzido: true, linhaDRE: linhaSel } }),
  ]);
  const avisos: string[] = [];
  const somar = (m: Map<string, number>, k: string, v: number) => v && m.set(k, (m.get(k) ?? 0) + v);
  const dias = meses.reduce((s, m) => s + diasUteis(ano, m), 0);

  // O realizado de cada unidade e conta, mês a mês.
  const real = new Map<string, number[]>();
  for (const r of unidades) {
    const k = `${r.unidadeNegocio!.codigo}|${r.linhaDRE.codigo}`;
    const lista = real.get(k) ?? Array<number>(12).fill(0);
    lista[mesDe.get(r.competenciaId)! - 1] += Number(r.valor);
    real.set(k, lista);
  }
  const doPeriodo = (k: string) => (real.get(k) ?? []).reduce((s, v) => s + v, 0);

  const daUnidade = (u: number) => linhas.filter((l) => l.unidade === u);
  const linha = (u: number | undefined, codigo: string | null | undefined) => linhas.find((l) => l.unidade === u && l.codigo === codigo);
  const chave = (l: LinhaDoCadastro) => `${l.unidade}|${l.codigo}`;

  // Os volumes do período por linha e venda ("?": sem obra, para dividir pela receita).
  const m3 = new Map<string, number>();
  const outros = new Map<string, number>();
  const qtdPistas = new Map<string, number>();
  const armadura = new Map<string, number>();
  const metalurgia = new Map<string, number>();
  const acomp = new Map<string, number>();
  for (const p of producoes) {
    const l = linha(p.unidadeNegocio?.codigo, p.linha?.codigo);
    if (l && l.unidade !== 3 && emM3(l)) somar(m3, `${chave(l)}|${vendaDaObra(p.obra) ?? "?"}`, Number(p.quantidade));
  }
  for (const p of pistas) {
    const l = linha(p.unidadeNegocio?.codigo, p.linha?.codigo);
    if (l) somar(qtdPistas, chave(l), Number(p.quantidade));
  }
  // A metalurgia (14/10/2026): a consumida por linha (a da lista); a da linha em kg de Serviços (a Metálica) também é o
  // volume dela. A Metalúrgica presta serviço às outras linhas (apoio; inativa no cadastro desde 26/10/2026).
  const kgServicos = daUnidade(3).find((l) => l.medida === "kg");
  for (const p of metalurgias) {
    const consumidora = linha(p.unidadeNegocio?.codigo, p.linha?.codigo);
    if (!consumidora) continue;
    somar(metalurgia, chave(consumidora), Number(p.quantidade));
    if (consumidora === kgServicos) somar(outros, `${chave(kgServicos)}|GLOBAL`, Number(p.quantidade));
  }
  const montagem = daUnidade(3).find((l) => l.codigo === "MONTAGEM" && l.medida === "m³");
  if (montagem) for (const p of montagens) somar(outros, `${chave(montagem)}|GLOBAL`, Number(p.quantidade));
  for (const p of armaduras) {
    const l = linha(p.unidadeNegocio?.codigo, p.linha?.codigo);
    if (l) somar(armadura, `${chave(l)}|${l.unidade === 3 ? "GLOBAL" : (vendaDaObra(p.obra) ?? "?")}`, Number(p.quantidade));
  }
  for (const p of acompanhamentos) {
    const l = linha(3, p.linha?.codigo);
    if (l) somar(acomp, chave(l), Number(p.quantidade));
  }

  // A receita: a de cada conta da DRE realizada da unidade, dividida entre as linhas e as vendas pelos itens.
  const rbItens = new Map<string, number>();
  const rlItens = new Map<string, number>();
  for (const i of itens) {
    const u = i.receitaPrevia.unidadeNegocio.codigo;
    const conta = RECEITA_DA_NATUREZA[i.receitaPrevia.natureza];
    const l = linha(u, i.linha);
    if (!conta || !l) continue;
    const venda: Venda = u === 3 ? "GLOBAL" : ((i.venda as Venda | null) ?? vendaDaObra(i.obraCodigo ? { codigo: i.obraCodigo, tipoVenda: null } : null) ?? "GLOBAL");
    somar(rbItens, `${chave(l)}|${venda}|${conta}`, Number(i.receitaBruta));
    somar(rlItens, `${chave(l)}|${venda}|${conta}`, Number(i.receitaLiquida));
  }
  const receita = new Map<string, number>();
  for (const u of UNIDADES_PREMISSAS) {
    for (const conta of RECEITAS) {
      const total = doPeriodo(`${u}|${conta}`);
      const daConta = [...rbItens].filter(([k]) => k.startsWith(`${u}|`) && k.endsWith(`|${conta}`));
      if (conta === C.RBDI && u === 3) continue;
      const soma = daConta.reduce((s, [, v]) => s + v, 0);
      if (!soma) {
        if (Math.abs(total) >= 1) avisos.push(`${nomeDaConta(est, conta)} (${NOME_DA_UNIDADE[u]}): ${reais(total)} sem itens na receita prévia por linha, fora das premissas.`);
        continue;
      }
      for (const [k, v] of daConta) somar(receita, k, (total * v) / soma);
    }
  }
  // A receita da linha (sem as devoluções, negativas), para dividir os volumes sem obra e os custos pela receita.
  const receitaDaLinha = (l: LinhaDoCadastro, venda?: Venda) =>
    [...receita].filter(([k]) => k.startsWith(`${chave(l)}|${venda ?? ""}`) && !k.endsWith(`|${C.RBDI}`)).reduce((s, [, v]) => s + v, 0);

  // Os volumes por venda: o "?" (sem obra) pela receita da linha em cada venda; em Serviços, tudo Global.
  const parteGlobal = (l: LinhaDoCadastro) => {
    if (l.unidade === 3) return 1;
    const g = receitaDaLinha(l, "GLOBAL");
    const m = receitaDaLinha(l, "MERCANTIL");
    return g + m ? g / (g + m) : 1;
  };
  const porVenda = (m: Map<string, number>, l: LinhaDoCadastro, venda: Venda) => {
    const sem = m.get(`${chave(l)}|?`) ?? 0;
    return (m.get(`${chave(l)}|${venda}`) ?? 0) + sem * (venda === "GLOBAL" ? parteGlobal(l) : 1 - parteGlobal(l));
  };
  const volume = (l: LinhaDoCadastro, venda: Venda) => (emM3(l) && l.unidade !== 3 ? porVenda(m3, l, venda) : porVenda(outros, l, venda));
  const volumeTotal = (l: LinhaDoCadastro) => VENDAS_DA_UNIDADE[l.unidade].reduce((s, v) => s + volume(l, v), 0);
  // Em Serviços, a linha sem volume nas listas vai por dia útil.
  const porDia = (l: LinhaDoCadastro) => l.unidade === 3 && !volumeTotal(l);
  const base = (l: LinhaDoCadastro, venda: Venda) => (porDia(l) ? (venda === "GLOBAL" ? dias : 0) : volume(l, venda));
  const baseTotal = (l: LinhaDoCadastro) => (porDia(l) ? dias : volumeTotal(l));

  // Os custos e as despesas variáveis de venda: a DRE realizada de cada conta e mês, pelas linhas.
  const reduzidos = new Map(contas.map((c) => [c.reduzido, c.linhaDRE!.codigo]));
  const correspondencias: Correspondencia[] = corr.map((c) => ({ filial: c.filial, tarefa: c.tarefa, unidade: c.linha.unidadeNegocio?.codigo ?? 0, linha: c.linha.codigo }));
  const tarefados = new Map<string, Map<string, number>>();
  const semTarefa = new Map<string, number>();
  for (const d of [...requisicoes, ...notas]) {
    const codigo = reduzidos.get(d.contaContabil);
    const mes = mesDe.get(d.competenciaId);
    if (!codigo || !mes) continue;
    const l = linhaDaTarefa(correspondencias, d.filial, d.nomeTarefa);
    if (l) {
      const k = `${mes}|${codigo}`;
      const m = tarefados.get(k) ?? new Map<string, number>();
      somar(m, l, Number(d.valorTotal));
      tarefados.set(k, m);
    } else {
      const u = /^CS[MC]\./.test(codigo) ? 3 : d.filial === 2 ? 2 : 1;
      somar(semTarefa, `${mes}|${codigo}|${u}`, Number(d.valorTotal));
    }
  }
  const custos = new Map<string, number>();
  for (const u of UNIDADES_PREMISSAS) {
    const doCodigo = new Map<string, LinhaDoCadastro[]>();
    for (const l of daUnidade(u)) {
      const cs = contasDaLinha(est, l);
      for (const c of [...cs.custos, ...cs.dvv]) doCodigo.set(c.codigo, [...(doCodigo.get(c.codigo) ?? []), l]);
    }
    for (const [codigo, ls] of doCodigo) {
      // Os pesos da parte sem tarefa: o m³ das linhas (sem ele, o volume delas); nas despesas variáveis de venda e em
      // Serviços, a receita.
      const pelaReceita = u === 3 || codigo.startsWith("DVV.");
      let pesos = new Map(ls.map((l) => [chave(l), pelaReceita ? receitaDaLinha(l) : emM3(l) ? volumeTotal(l) : 0]));
      if (![...pesos.values()].some(Boolean)) pesos = new Map(ls.map((l) => [chave(l), baseTotal(l)]));
      for (const mes of meses) {
        const total = real.get(`${u}|${codigo}`)?.[mes - 1] ?? 0;
        if (!total) continue;
        const partes = dividirPorLinhas(total, tarefados.get(`${mes}|${codigo}`) ?? new Map(), semTarefa.get(`${mes}|${codigo}|${u}`) ?? 0, pesos);
        for (const [l, v] of partes) somar(custos, `${l}|${codigo}`, v);
      }
    }
  }

  // Os impostos de cada linha e venda são os dos itens (a bruta menos a líquida, sobre a bruta), ajustados para que os da
  // unidade sejam os da DRE realizada (a receita bruta das contas menos a líquida delas).
  const pctDosItens = (k: string) => {
    let rb = 0;
    let rl = 0;
    for (const [x, v] of rbItens) if (x.startsWith(k)) rb += v;
    for (const [x, v] of rlItens) if (x.startsWith(k)) rl += v;
    return rb > 0 ? (rb - rl) / rb : 0;
  };
  const ajusteDosImpostos = new Map<number, number>();
  for (const u of UNIDADES_PREMISSAS) {
    let realizados = 0;
    let calculados = 0;
    for (const conta of RECEITAS) realizados += doPeriodo(`${u}|${conta}`) - doPeriodo(`${u}|${LIQUIDA_DA_BRUTA[conta]}`);
    for (const l of daUnidade(u))
      for (const venda of VENDAS_DA_UNIDADE[u]) {
        const comDevolucoes = [...receita].filter(([k]) => k.startsWith(`${chave(l)}|${venda}|`)).reduce((s, [, v]) => s + v, 0);
        calculados += comDevolucoes * pctDosItens(`${chave(l)}|${venda}|`);
      }
    if (calculados > 0 && realizados > 0) ajusteDosImpostos.set(u, realizados / calculados);
  }

  // As comissões (15/10/2026), em % da receita bruta, por venda (Global ou Mercantil): as da unidade, divididas entre as
  // vendas pela receita bruta de cada uma, sobre a receita bruta da venda. O realizado não separa as comissões por venda.
  const robDaUnidade = (u: number, venda?: Venda) =>
    [...receita].filter(([k]) => k.startsWith(`${u}|`) && (!venda || k.split("|")[2] === venda)).reduce((s, [, v]) => s + v, 0);
  const comissoesPorVenda = (u: number, venda: Venda) => {
    const rob = robDaUnidade(u, venda);
    const total = robDaUnidade(u);
    return rob && total ? ((doPeriodo(`${u}|${C.COMISSOES}`) * (rob / total)) / rob) * 100 : 0;
  };

  // As Médias de Referência, por linha e venda.
  const premissas: ReferenciaRealizada["premissas"] = [];
  const add = (unidade: UnidadePremissa, venda: Venda, k: string, valor: number) => {
    if (Number.isFinite(valor) && Math.abs(valor) >= 1e-9) premissas.push({ unidade, venda, chave: k, valor: Number(valor.toFixed(6)) });
  };
  for (const u of UNIDADES_PREMISSAS) {
    for (const l of daUnidade(u)) {
      const temValor = receitaDaLinha(l) !== 0 || [...custos].some(([k]) => k.startsWith(`${chave(l)}|`));
      const pistasDaLinha = qtdPistas.get(chave(l)) ?? 0;
      for (const venda of VENDAS_DA_UNIDADE[u]) {
        const b = base(l, venda);
        if (porDia(l)) {
          if (temValor && venda === "GLOBAL") add(u, venda, `DEMANDA:${l.codigo}`, 1);
        } else if (l.medida === PISTAS && pistasDaLinha) {
          // As pistas da venda na proporção do m³ dela.
          add(u, venda, `DEMANDA:${l.codigo}`, (pistasDaLinha * (volumeTotal(l) ? b / volumeTotal(l) : 0)) / dias);
          add(u, venda, `M3_PISTA:${l.codigo}`, volumeTotal(l) / pistasDaLinha);
        } else add(u, venda, `DEMANDA:${l.codigo}`, b / dias);
        // A armadura e a metalurgia por unidade da linha: o kg do período ÷ o volume dele.
        const bt0 = baseTotal(l);
        if (LINHAS_COM_ARMADURA.has(l.codigo) && bt0) add(u, venda, `ARMADURA:${l.codigo}`, VENDAS_DA_UNIDADE[u].reduce((s, v) => s + porVenda(armadura, l, v), 0) / bt0);
        if (LINHAS_COM_METALURGIA.has(l.codigo) && bt0) add(u, venda, `METALURGIA:${l.codigo}`, (metalurgia.get(chave(l)) ?? 0) / bt0);
        if (u === 3 && venda === "GLOBAL") add(u, venda, `ACOMPANHAMENTO:${l.codigo}`, (acomp.get(chave(l)) ?? 0) / dias);
        // A receita bruta média de cada conta e os impostos (dos itens: a bruta menos a líquida, sobre a bruta).
        let rb = 0;
        let rl = 0;
        for (const conta of contasDaLinha(est, l).receitas) {
          const v = receita.get(`${chave(l)}|${venda}|${conta}`) ?? 0;
          if (v && !b) avisos.push(`${l.nome} (${NOME_DA_UNIDADE[u]}, ${venda === "GLOBAL" ? "Global" : "Mercantil"}): ${reais(v)} de receita sem volume no período, fora das premissas.`);
          else if (b) add(u, venda, `RB:${l.codigo}:${conta}`, v / b);
          rb += rbItens.get(`${chave(l)}|${venda}|${conta}`) ?? 0;
          rl += rlItens.get(`${chave(l)}|${venda}|${conta}`) ?? 0;
        }
        if (rb > 0) add(u, venda, `IMPOSTOS:${l.codigo}`, ((rb - rl) / rb) * 100 * (ajusteDosImpostos.get(u) ?? 1));
        if (receitaDaLinha(l, venda) && contasDaLinha(est, l).dvv.some((c) => c.codigo === C.COMISSOES)) add(u, venda, `COMISSOES:${l.codigo}`, comissoesPorVenda(u, venda));
        // Os custos por unidade da linha: o mesmo nas duas vendas.
        const bt = baseTotal(l);
        for (const c of [...contasDaLinha(est, l).custos, ...contasDaLinha(est, l).dvv]) {
          // A conta das comissões se calcula do percentual (acima).
          if (c.codigo === C.COMISSOES) continue;
          const v = custos.get(`${chave(l)}|${c.codigo}`) ?? 0;
          if (v && bt) add(u, venda, `CUSTO:${l.codigo}:${c.codigo}`, v / bt);
          else if (v && venda === VENDAS_DA_UNIDADE[u][0]) avisos.push(`${l.nome} (${NOME_DA_UNIDADE[u]}): ${reais(v)} de ${c.descricao} sem volume no período, fora das premissas.`);
        }
      }
    }
  }

  // Os grupos de centros de custo: as contas do grupo no cenário; o resto (os centros de estoque e de investimento e
  // as contas que o cenário não usa nos centros) fica de fora.
  const porGrupo = new Map(grupos.map((g) => [g.grupo, new Set(contasDoGrupo(est, g).map((l) => l.codigo))]));
  const somaCentros = new Map<string, number>();
  // O que não cai num grupo do cenário vira movimentação fora dos padrões (abaixo, pelos lançamentos).
  const noGrupo = (grupo: string | null, codigo: string, competenciaId: string, v: number) => {
    if (!grupo || !porGrupo.get(grupo)?.has(codigo)) return;
    somar(somaCentros, `${grupo}|${codigo}|${mesDe.get(competenciaId)}`, v);
  };
  // As outras contas dos centros (a receita, as matérias primas, a depreciação…) vêm das premissas, dos investimentos e
  // do extra-operacional.
  for (const r of centros) if (r.linhaDRE.tipo === "ITEM" && ehContaDeCentro(r.linhaDRE.codigo)) noGrupo(nomeDoGrupo(r.centroCusto!), r.linhaDRE.codigo, r.competenciaId, Number(r.valor));
  // As movimentações fora dos padrões (14/10/2026; antes, dois avisos com os totais): os lançamentos das contas de
  // centros sem centro de custo, em centros fora do cenário ou em contas fora do grupo do centro, por conta contábil e
  // conta da DRE. Cada uma pode ir a um grupo que tenha a mesma atribuição e conta no grupo da DRE dele.
  const daEstrutura = new Map(est.map((l) => [l.codigo, l]));
  const foraDoPadrao = new Map<string, Omit<MovimentacaoForaDoPadrao, "valores"> & { meses: number[] }>();
  const porFilial = new Map<string, Map<number, number>>();
  // Os redistribuídos (13/11/2026) pelas partes, nos centros dos destinos.
  const partes = await getPrismaClient().lancamentoRedistribuido.findMany({
    where: { ...naComp, OR: [".MOD.", ".MOI.", ".GGD.", ".GGI.", ".GGC."].map((a) => ({ linhaDRE: { codigo: { contains: a } } })) },
    select: {
      competenciaId: true,
      filial: true,
      valorMovimento: true,
      linhaDRE: { select: { codigo: true, tipo: true } },
      centroCusto: { select: { nomeControladoria: true, nomeRM: true, codigoRM: true } },
      lancamentoContabil: { select: { contaResultado: { select: { reduzido: true, descricao: true } } } },
    },
  });
  const lancamentosDeCentros = [
    ...lancamentosDiretos,
    ...partes.map(({ lancamentoContabil, ...p }) => ({ ...p, codigoCentroCusto: p.centroCusto.codigoRM, nomeCentroCusto: p.centroCusto.nomeRM, contaResultado: lancamentoContabil.contaResultado })),
  ];
  for (const l of lancamentosDeCentros) {
    const codigo = l.linhaDRE?.codigo;
    if (!codigo || l.linhaDRE?.tipo !== "ITEM" || !ehContaDeCentro(codigo)) continue;
    const grupo = l.centroCusto ? nomeDoGrupo(l.centroCusto) : null;
    if (grupo && porGrupo.get(grupo)?.has(codigo)) continue;
    const chaveM = `${l.contaResultado.reduzido}|${codigo}`;
    let m = foraDoPadrao.get(chaveM);
    if (!m) {
      const e = daEstrutura.get(codigo);
      const [, atrib, conta] = codigo.split(".");
      m = {
        chave: chaveM,
        conta: { reduzido: l.contaResultado.reduzido, descricao: l.contaResultado.descricao },
        linha: { codigo, departamento: e?.grupo ?? codigo.split(".")[0], atribuicao: e?.atribuicao ?? atrib, descricao: e?.descricao ?? conta },
        origens: [],
        total: 0,
        meses: Array<number>(12).fill(0),
        destinos: grupos.flatMap((g) => {
          const destino = `${g.grupoDRE}.${atrib}.${conta}`;
          return porGrupo.get(g.grupo)?.has(destino) ? [{ grupo: g.grupo, conta: destino, departamento: daEstrutura.get(destino)?.grupo ?? g.grupoDRE }] : [];
        }),
      };
      foraDoPadrao.set(chaveM, m);
    }
    const origem = l.centroCusto
      ? `${[l.centroCusto.codigoRM, grupo].filter(Boolean).join(" ")}${porGrupo.has(grupo!) ? " (conta fora do grupo)" : " (centro fora do cenário)"}`
      : l.codigoCentroCusto
        ? `${l.codigoCentroCusto} ${l.nomeCentroCusto ?? ""} (fora do cadastro)`.replace(/\s+/g, " ")
        : "Sem centro de custo";
    if (!m.origens.includes(origem)) m.origens.push(origem);
    const v = Number(l.valorMovimento);
    const f = porFilial.get(chaveM) ?? new Map<number, number>();
    f.set(l.filial, (f.get(l.filial) ?? 0) + v);
    porFilial.set(chaveM, f);
    m.total += v;
    m.meses[(mesDe.get(l.competenciaId) ?? 1) - 1] += v;
  }
  const movimentacoes = [...foraDoPadrao.values()].filter((m) => m.meses.some((v) => Math.abs(v) >= 0.005)).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  // O padrão de cada conta (14/10/2026): o centro do RM pela filial predominante, se o grupo dele puder recebê-la.
  for (const m of movimentacoes) {
    m.filial = [...(porFilial.get(m.chave) ?? new Map<number, number>())].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]?.[0] ?? 1;
    const nomeRM = centroPadrao(m.linha.codigo, m.filial);
    const grupo = nomeRM ? grupoDoCentroRM(grupos, nomeRM) : null;
    m.padrao = grupo && m.destinos.some((d) => d.grupo === grupo) ? grupo : null;
  }
  const proprios = new Map(somaCentros);
  // As decisões gravadas (mantidas entre as cargas) entram nos grupos escolhidos.
  const aplicadas = new Map<string, { grupo: string; conta: string }>();
  for (const m of movimentacoes) {
    const grupo = decisoes[m.chave];
    const alvo = grupo ? m.destinos.find((d) => d.grupo === grupo) : undefined;
    if (!alvo) continue;
    m.meses.forEach((v, k) => v && somar(somaCentros, `${alvo.grupo}|${alvo.conta}|${k + 1}`, v));
    aplicadas.set(m.chave, alvo);
  }
  const paraLista = (m: Map<string, number>) =>
    [...m].map(([k, valor]) => {
      const [grupo, codigo, mes] = k.split("|");
      return { grupo, codigo, mes: Number(mes), valor };
    });
  const centrosDoCenario = paraLista(somaCentros);

  // A depreciação de cada unidade e o extra-operacional.
  const mensais: ReferenciaRealizada["mensais"] = [];
  const mensal = (venda: typeof VENDA_BASE | typeof VENDA_EXTRA, unidade: number, conta: string) =>
    (real.get(`${unidade}|${conta}`) ?? []).forEach((valor, k) => valor && mensais.push({ venda, unidade, chave: `${unidade}|${conta}`, mes: k + 1, valor }));
  for (const d of CONTAS_DEPRECIACAO) mensal(VENDA_BASE, d.unidade, d.conta);
  for (const u of UNIDADES_EXTRA) for (const l of contasExtra(est, u.unidade)) mensal(VENDA_EXTRA, u.unidade, l.codigo);

  const diarias = daUnidade(3).filter((l) => porDia(l) && (receitaDaLinha(l) !== 0 || [...custos].some(([k]) => k.startsWith(`${chave(l)}|`))));
  if (diarias.length)
    avisos.push(
      `${diarias.map((l) => l.nome).join(", ")} (Serviços): sem volume nas listas, vão por dia útil — a Demanda Diária é 1 e os valores médios são por dia. Para usar a unidade da linha, troque a demanda e reajuste os valores na mesma proporção.`,
    );

  // As contas do realizado que o cenário não tem (fora das premissas, dos centros, da depreciação e do extra).
  const cobertas = new Set<string>();
  for (const u of UNIDADES_PREMISSAS)
    for (const l of daUnidade(u)) {
      const cs = contasDaLinha(est, l);
      for (const c of cs.receitas) cobertas.add(`${u}|${c}`).add(`${u}|${LIQUIDA_DA_BRUTA[c]}`);
      for (const c of [...cs.custos, ...cs.dvv]) cobertas.add(`${u}|${c.codigo}`);
    }
  for (const d of CONTAS_DEPRECIACAO) cobertas.add(`${d.unidade}|${d.conta}`);
  for (const u of UNIDADES_EXTRA) for (const l of contasExtra(est, u.unidade)) cobertas.add(`${u.unidade}|${l.codigo}`);
  const contasItem = new Map(est.filter((l) => l.tipo === "ITEM").map((l) => [l.codigo, l]));
  const fora: string[] = [];
  for (const [k] of real) {
    const [u, codigo] = k.split("|");
    const l = contasItem.get(codigo);
    const v = doPeriodo(k);
    if (!l || Math.abs(v) < 1000 || cobertas.has(k) || ehContaDeCentro(codigo) || /^(P|S|IRB)\./.test(codigo)) continue;
    fora.push(`${l.descricao} (${NOME_DA_UNIDADE_TODAS[Number(u)] ?? u}): ${reais(v)}`);
  }
  if (fora.length) avisos.push(`Contas do realizado que o cenário não tem (ficam fora da DRE dele): ${fora.join("; ")}.`);

  return { premissas, centros: centrosDoCenario, centrosProprios: paraLista(proprios), mensais, avisos, movimentacoes, aplicadas };
}

const NOME_DA_UNIDADE: Record<number, string> = { 1: "Matriz", 2: "Filial", 3: "Serviços" };
const NOME_DA_UNIDADE_TODAS: Record<number, string> = { ...NOME_DA_UNIDADE, 4: "Despesas e Extra", 5: "RN" };
const nomeDaConta = (est: Array<{ codigo: string; descricao: string }>, codigo: string) => est.find((l) => l.codigo === codigo)?.descricao ?? codigo;
