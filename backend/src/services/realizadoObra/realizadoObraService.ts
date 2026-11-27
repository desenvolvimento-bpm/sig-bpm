import { getPrismaClient } from "../../config/prisma.js";
import { ACESSO_TOTAL, type Acesso } from "../acesso/acesso.js";
import { PREVIAS_DA_OBRA, receitasDaObra } from "../dre/obrasService.js";
import { ehContaDosCreditos, percentuaisDasCompetencias, type Percentuais } from "../impostos/creditosImpostosService.js";
import { baseDoPercentual, baseDoUnitario } from "../relatorios/basesResultados.js";
import { montar } from "../relatorios/resultadosService.js";
import { numeroDaObra } from "../resultadosLinha/alocacaoNasLinhas.js";
import { linhasDoNegocio, receitaDoMes, volumesDoMes, type ItemDaReceita, type LinhaDoNegocio, type Volume } from "../resultadosLinha/basesDasLinhas.js";
import { basesDoRateio, pesosDasObras, type BaseDaObra } from "../resultadosLinha/divisaoEntreObras.js";
import { comTotais, DO_RESULTADO, escopo, estruturaDaDRE, NATUREZA_DA_RECEITA, obrasDoRateio, type ApuracaoLinhas, type LinhaDRE } from "../resultadosLinha/resultadosLinhaService.js";
import { chaveDaLinha } from "../../lib/linhas.js";
import type { LinhaVendida } from "../importacoes/dreComercial/leiauteDreComercial.js";
import { dreDoArquivo, fonteDoVendido, VendidoIndisponivelError, vendidoNaEstrutura, versoesDaObra, type FonteDoVendido } from "./dreVendida.js";
import { nomeDaUnidade } from "../cadastros/nomesDasUnidades.js";

/**
 * O Realizado por Obra (03/11/2026, pedido do Adão): a DRE de uma obra, da receita à Margem de Contribuição, mês a mês, contra
 * a DRE vendida. Cada usuário escolhe a venda (a obra e a versão vendida) na lista Venda dos Resultados.
 *
 * - A receita bruta, os impostos e a receita líquida, no modelo da aba Obras da DRE do mês (`receitasPorLinha`):
 *   os lançamentos dos centros da obra, com a receita prévia de frete e complementar levada; a ROL, a ROB menos os impostos.
 * - Os custos e os volumes de cada mês, os gravados pela etapa Linhas nas competências fechadas (ResultadoObra): o direto na
 *   obra (os lançamentos dos centros de obra e os volumes) mais a parte dela no rateio de cada linha. Os custos de
 *   Matérias Primas, de Gastos Gerais Variáveis da Produção e de Frete e Descarga saem dos resultados apurados e, mês a mês,
 *   pelos Créditos de Impostos do Fechamento Mensal (os percentuais da conta na unidade do custo): na venda mercantil, sem o
 *   Estornado; na global, sem o Estornado e com o Creditado reaplicado (04/11/2026).
 * - O vendido (só o total) é a DRE da obra na versão escolhida, da aba DRE do CONTROLE DAS VENDAS importada na competência
 *   fechada mais recente (dreVendida.ts): provisório, até a consulta ao novo CRM (a tela Integrações e Consultas).
 * - As abas: o Consolidado e uma por linha da obra (as com realizado ou vendido).
 * - A Mão de Obra e os Gastos Gerais, Diretos e Indiretos, ficam agrupados, sem as contas, como na DRE de venda.
 */

export class RegraRealizadoObraError extends Error {
  constructor(
    readonly status: 400 | 404,
    message: string,
  ) {
    super(message);
  }
}

const MESES_CURTOS = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const rotuloCurto = (ano: number, mes: number) => `${MESES_CURTOS[mes - 1]}/${String(ano).slice(2)}`;
const rotulo = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;
export const rotuloDaVersao = (versao: number) => `VER${String(versao).padStart(2, "0")}`;
const arredonda = (x: number, casas = 4) => Math.round(x * 10 ** casas) / 10 ** casas;
const divide = (a: number, b: number | undefined) => (b === undefined || b === 0 ? null : arredonda(a / b, 8));

/**
 * A Mão de Obra e os Gastos Gerais, Diretos e Indiretos (MOD, MOI, GGD e GGI), agrupados, sem as contas, para igualar à DRE
 * de venda (03/11/2026, pedido do Adão): a tabela mostra só o subtotal de cada um.
 */
const AGRUPADAS = /^[A-Z]+\.(MOD|MOI|GGD|GGI)\./;
export const semAsContasAgrupadas = (l: { codigo: string; tipo: string }) => !(l.tipo === "ITEM" && AGRUPADAS.test(l.codigo));
/** As linhas da tabela: sem as contas agrupadas e sem a receita líquida por natureza (no modelo da aba Obras, só a ROL). */
export const naTabela = (l: { codigo: string; tipo: string }) => semAsContasAgrupadas(l) && !(l.tipo === "ITEM" && l.codigo.startsWith("ROL."));

/** A composição de um item num mês (as consultas): o direto (os lançamentos dos centros da obra), o rateio e os créditos. */
type Composicao = { direto: number; rateio: number; creditos: number };

/** O nome e a medida de cada base do rateio das linhas entre as obras, na memória de cálculo. */
const NOME_DA_BASE: Record<BaseDaObra, { nome: string; medida: string }> = {
  M3_PRODUZIDO: { nome: "m³ produzidos", medida: "m³" },
  KG_METALURGIA: { nome: "kg da metalurgia", medida: "kg" },
  M3_MONTAGEM: { nome: "m³ montados", medida: "m³" },
  DIAS_ACOMPANHAMENTO: { nome: "dias de acompanhamento", medida: "d" },
  RECEITA: { nome: "receita bruta", medida: "R$" },
};

const SELECAO_DA_OBRA = {
  id: true,
  codigo: true,
  nome: true,
  tipoVenda: true,
  generica: true,
  unidadeNegocio: { select: { nome: true } },
  linha: { select: { nome: true } },
} as const;
type ObraSelecionada = { id: string; codigo: string; nome: string; tipoVenda: "GLOBAL" | "MERCANTIL" | null; generica: boolean; unidadeNegocio: { nome: string } | null; linha: { nome: string } | null };

/**
 * O código da venda de cada obra, o do CONTROLE DAS VENDAS (a letra e o número do projeto: G887305). As listas trouxeram
 * obras de código só numérico que são a mesma obra (`numerada`):
 * - a de Montagem, na coluna OBRA, a numeração das linhas (1, 2…), com o código no nome ("G887305 | 3-SM ADMINISTRADORA |
 *   NOVO PAVILHÃO"): vale o código do nome, e o nome fica sem ele;
 * - a de Acompanhamento, o número do projeto sem a letra ("887305"): vale o da obra com a letra e o mesmo número, se há uma
 *   só.
 */
const CODIGO_NO_NOME = /^\s*([A-Z]+\d+)\s*\|\s*(.+)$/i;
export function codigosDasVendas(obras: Array<{ id: string; codigo: string; nome: string }>) {
  const comLetra = new Map<string, string[]>();
  for (const o of obras) {
    const m = /^([A-Z]+)(\d+)$/.exec(o.codigo.trim().toUpperCase());
    if (m) comLetra.set(m[2], [...(comLetra.get(m[2]) ?? []), m[0]]);
  }
  return new Map(
    obras.map((o) => {
      const codigo = o.codigo.trim().toUpperCase();
      const nome = o.nome.trim();
      if (!/^\d+$/.test(codigo)) return [o.id, { codigo, nome, numerada: false }];
      const doNome = CODIGO_NO_NOME.exec(o.nome);
      if (doNome) return [o.id, { codigo: doNome[1].toUpperCase(), nome: doNome[2].trim(), numerada: true }];
      const letradas = comLetra.get(codigo) ?? [];
      return [o.id, letradas.length === 1 ? { codigo: letradas[0], nome, numerada: true } : { codigo, nome, numerada: false }];
    }),
  );
}

/**
 * Uma venda: o código, as obras dela no cadastro (os ids e os códigos: a do código e as numeradas) e a principal (a do código;
 * sem ela, uma numerada).
 */
type Venda = { codigo: string; nome: string; principal: ObraSelecionada; numerada: boolean; ids: string[]; codigos: string[] };

/** As vendas do cadastro de obras, por código e pelo id de cada obra. */
async function vendasDoCadastro() {
  const obras = await getPrismaClient().obra.findMany({ select: SELECAO_DA_OBRA, orderBy: { codigo: "asc" } });
  const codigos = codigosDasVendas(obras);
  const porCodigo = new Map<string, Venda>();
  const daObra = new Map<string, Venda>();
  for (const o of obras) {
    const v = codigos.get(o.id)!;
    let venda = porCodigo.get(v.codigo);
    if (!venda) porCodigo.set(v.codigo, (venda = { codigo: v.codigo, nome: v.nome, principal: o, numerada: v.numerada, ids: [], codigos: [] }));
    else if (venda.numerada && !v.numerada) Object.assign(venda, { nome: v.nome, principal: o, numerada: false });
    venda.ids.push(o.id);
    venda.codigos.push(o.codigo);
    daObra.set(o.id, venda);
  }
  return { porCodigo, daObra };
}

/**
 * A venda como a lista e as telas a mostram: o id da obra principal, o código e o nome sem a numeração. O tipo de venda e a
 * obra genérica são os da obra do código; só com as numeradas, o tipo vem do código (G, venda global), como no cadastro.
 */
const descricaoDaVenda = (v: Venda) => ({
  id: v.principal.id,
  codigo: v.codigo,
  nome: v.nome,
  tipoVenda: v.numerada ? (v.codigo.startsWith("G") ? ("GLOBAL" as const) : ("MERCANTIL" as const)) : v.principal.tipoVenda,
  generica: v.principal.generica,
  unidade: v.principal.unidadeNegocio?.nome ?? null,
  linha: v.principal.linha?.nome ?? null,
});
const descricaoDaFonte = (f: FonteDoVendido | null) => (f ? { competencia: rotulo(f.ano, f.mes), arquivo: f.nomeArquivo, importadoEm: f.importadoEm.toISOString() } : null);

/**
 * O ajuste dos Créditos de Impostos num custo de Matérias Primas, de Gastos Gerais Variáveis da Produção ou de Frete e Descarga
 * (04/11/2026, pedido do Adão), com os percentuais da conta na unidade e no mês: na venda mercantil, Custo Realizado × (1 −
 * %Estornado); na global, Custo Realizado × (1 − %Estornado) ÷ (1 − %Creditado). Nulo quando a conta não se faz (um percentual
 * de 100% ou mais): o custo fica sem o ajuste.
 */
export function comOsCreditos(valor: number, tipoVenda: "GLOBAL" | "MERCANTIL", p: Percentuais) {
  if (p.estornado >= 1 || (tipoVenda === "GLOBAL" && p.creditado >= 1)) return null;
  return tipoVenda === "GLOBAL" ? (valor * (1 - p.estornado)) / (1 - p.creditado) : valor * (1 - p.estornado);
}

/** As competências fechadas, com e sem as obras gravadas na etapa Linhas, em ordem. */
async function fechadas() {
  const cs = await getPrismaClient().competencia.findMany({
    where: { status: "FECHADA" },
    select: { id: true, ano: true, mes: true, apuracaoLinhas: true },
    orderBy: [{ ano: "asc" }, { mes: "asc" }],
  });
  return cs.map((c) => ({ id: c.id, ano: c.ano, mes: c.mes, comObras: !!(c.apuracaoLinhas as ApuracaoLinhas | null)?.obras }));
}

/** Os meses de ano/mes até ano/mes, inclusive. */
function mesesEntre(de: { ano: number; mes: number }, ate: { ano: number; mes: number }) {
  const meses: Array<{ ano: number; mes: number }> = [];
  for (let a = de.ano, m = de.mes; a < ate.ano || (a === ate.ano && m <= ate.mes); m === 12 ? ((a += 1), (m = 1)) : (m += 1)) meses.push({ ano: a, mes: m });
  return meses;
}

/**
 * Os meses da venda: do primeiro ao último fechado com as obras gravadas em que ela tem valor (`comValor`: o gravado das obras
 * dela ou as receitas e os impostos dos centros dela); o mês fechado sem as obras gravadas, ou sem valor dela, fica vazio no
 * meio. `semObras`, as competências fechadas sem as obras gravadas.
 */
function mesesDaVenda(cs: Awaited<ReturnType<typeof fechadas>>, comValor: Set<string>) {
  const comObras = cs.filter((c) => c.comObras);
  const daObra = comObras.filter((c) => comValor.has(c.id));
  const semObras = cs.filter((c) => !c.comObras).map((c) => rotulo(c.ano, c.mes));
  if (!daObra.length) return { meses: [] as Array<{ ano: number; mes: number; rotulo: string; competenciaId: string | null }>, semObras };
  const porMes = new Map(daObra.map((c) => [`${c.ano}-${c.mes}`, c.id]));
  return {
    meses: mesesEntre(daObra[0], daObra[daObra.length - 1]).map((m) => ({ ...m, rotulo: rotuloCurto(m.ano, m.mes), competenciaId: porMes.get(`${m.ano}-${m.mes}`) ?? null })),
    semObras,
  };
}

/** A receita prévia bruta da venda: a natureza e a linha (sem ela, nula). */
export type PreviaDaVenda = { natureza: string; linhaId: string | null; bruta: number };
const IMPOSTOS = "IRB.IO.IMPOSTOS_OPERACIONAIS";
const ROL = "ROL.RECEITA_OPERACIONAL_LIQUIDA_ROL";

/**
 * As receitas e os impostos da venda num mês, por linha (sem a linha, nula), no modelo da aba Obras da DRE do mês
 * (03/11/2026, pedido do Adão): os lançamentos dos centros da obra nas linhas da ROB e dos impostos (`lancadas`,
 * no sinal da DRE, em IMPOSTOS a soma dos impostos) e a receita prévia de frete e complementar da obra, que sai do
 * Pré-Fabricado e vai ao Frete, e sai da Montagem e vai à Complementar, cada uma na linha dela.
 *
 * Os lançamentos não têm linha: cada item da ROB vai às linhas pela receita prévia bruta da obra na natureza dele (no mês; sem
 * ela, no período da venda; sem as duas, pela de todas as naturezas), e os impostos pela de todas as naturezas; sem nenhuma,
 * ficam sem linha (só no Consolidado). As devoluções (negativas) não são base.
 */
export function receitasPorLinha(lancadas: Map<string, number>, doMes: PreviaDaVenda[], doPeriodo: PreviaDaVenda[]) {
  const r = new Map<string | null, Map<string, number>>();
  const somar = (linha: string | null, codigo: string, v: number) => {
    const m = r.get(linha) ?? new Map<string, number>();
    m.set(codigo, (m.get(codigo) ?? 0) + v);
    r.set(linha, m);
  };
  const pesos = (ps: PreviaDaVenda[], natureza?: string) => {
    const m = new Map<string, number>();
    for (const p of ps) if (p.linhaId && p.bruta > 0 && p.natureza !== "DEVOLUCOES_INVENTARIOS" && (!natureza || p.natureza === natureza)) m.set(p.linhaId, (m.get(p.linhaId) ?? 0) + p.bruta);
    return m;
  };
  const dividir = (codigo: string, v: number, natureza?: string) => {
    const w = [...(natureza ? [pesos(doMes, natureza), pesos(doPeriodo, natureza)] : []), pesos(doMes), pesos(doPeriodo)].find((m) => m.size);
    if (!w) return somar(null, codigo, v);
    const soma = [...w.values()].reduce((s, x) => s + x, 0);
    for (const [linha, x] of w) somar(linha, codigo, (v * x) / soma);
  };
  for (const [codigo, v] of lancadas) {
    if (Math.abs(v) < 1e-9) continue;
    dividir(codigo, v, codigo === IMPOSTOS ? undefined : NATUREZA_DA_RECEITA[codigo.split(".")[1]]);
  }
  for (const p of PREVIAS_DA_OBRA) {
    for (const x of doMes) {
      if (x.natureza !== p.natureza || Math.abs(x.bruta) < 1e-9) continue;
      somar(x.linhaId, p.de, -x.bruta);
      somar(x.linhaId, p.item, x.bruta);
    }
  }
  return r;
}

/** A receita prévia bruta da venda em cada competência (a das obras dela: pelo código ou pelo número da obra). */
async function previasDaVenda(competenciaIds: string[], venda: Venda, linhas: LinhaDoNegocio[]) {
  const numero = numeroDaObra(venda.codigo);
  const codigos = new Set(venda.codigos.map((c) => c.trim().toUpperCase()));
  const itens = await getPrismaClient().receitaPreviaItem.findMany({
    where: { receitaPrevia: { competenciaId: { in: competenciaIds } }, OR: [{ obraCodigo: { in: venda.codigos } }, ...(numero ? [{ obraCodigo: { endsWith: numero } }] : [])] },
    select: { linha: true, obraCodigo: true, receitaBruta: true, receitaPrevia: { select: { competenciaId: true, natureza: true, unidadeNegocio: { select: { codigo: true } } } } },
  });
  const r = new Map<string, PreviaDaVenda[]>(competenciaIds.map((id) => [id, []]));
  for (const i of itens) {
    if (!i.obraCodigo || (!codigos.has(i.obraCodigo.trim().toUpperCase()) && numeroDaObra(i.obraCodigo) !== numero) || i.receitaBruta.isZero()) continue;
    const chave = chaveDaLinha(i.linha);
    const linha = chave ? linhas.find((l) => l.unidade === i.receitaPrevia.unidadeNegocio.codigo && l.codigo === chave) : undefined;
    r.get(i.receitaPrevia.competenciaId)!.push({ natureza: i.receitaPrevia.natureza, linhaId: linha?.id ?? null, bruta: Number(i.receitaBruta) });
  }
  return r;
}

const SEM_FONTE = "Nenhuma competência fechada tem a DRE do Comercial importada.";

/** A DRE de venda de cada código (todas as versões) e a fonte; sem a fonte ou sem o arquivo, vazia, com o motivo. */
async function dreDasVendas() {
  const fonte = await fonteDoVendido();
  if (!fonte) return { fonte: null, dre: new Map<string, LinhaVendida[]>(), indisponivel: SEM_FONTE as string | null };
  try {
    return { fonte, dre: await dreDoArquivo(fonte.hash), indisponivel: null as string | null };
  } catch (error) {
    if (error instanceof VendidoIndisponivelError) return { fonte, dre: new Map<string, LinhaVendida[]>(), indisponivel: error.message as string | null };
    throw error;
  }
}

/** A venda escolhida pelo usuário (a da obra gravada) e a versão gravada; nula sem a escolha. */
async function escolhaDo(usuarioId: string, cadastro: Awaited<ReturnType<typeof vendasDoCadastro>>) {
  const cfg = await getPrismaClient().realizadoObraConfiguracao.findUnique({ where: { usuarioId }, select: { versao: true, obraId: true } });
  const venda = cfg ? cadastro.daObra.get(cfg.obraId) : undefined;
  return cfg && venda ? { venda, versao: cfg.versao } : null;
}

/** A versão que vale: a gravada, se está na DRE de venda; senão, a primeira dela (sem versões, nula). */
const versaoQueVale = (versoes: number[], gravada: number) => (versoes.length ? (versoes.includes(gravada) ? gravada : versoes[0]) : null);

/**
 * A venda pelo código dela (o do CONTROLE DAS VENDAS, como G887305), pelo código de uma obra dela no cadastro (as numeradas)
 * ou pelo id de uma obra dela; sem diferenciar maiúsculas. Nula se nenhuma.
 */
function vendaPedida(cadastro: Awaited<ReturnType<typeof vendasDoCadastro>>, pedido: string) {
  const alvo = pedido.trim().toUpperCase();
  return (
    cadastro.porCodigo.get(alvo) ??
    cadastro.daObra.get(pedido.trim().toLowerCase()) ??
    [...cadastro.porCodigo.values()].find((v) => v.codigos.some((c) => c.trim().toUpperCase() === alvo)) ??
    null
  );
}

/** Os Resultados de nenhuma venda (sem a escolha na lista Venda). */
const SEM_VENDA = { obra: null, versao: 0, versoes: [] as number[], fonte: null, abas: [], semObras: [] as string[], avisos: [] as string[], centros: [] as Array<string | null>, obras: [] as string[] };

/**
 * Os Resultados de uma venda na versão vendida `pedida` (a gravada na lista Venda; na API, a pedida, e nula, a mais recente):
 * o cálculo de `realizadoObraService.resultados`.
 */
async function resultadosDaVenda(venda: Venda, pedida: number | null, acesso: Acesso) {
  const prisma = getPrismaClient();
  const obra = descricaoDaVenda(venda);
  const tipoVenda = obra.tipoVenda ?? "MERCANTIL";
  const numero = numeroDaObra(venda.codigo);
  const [cs, est, linhasDoCadastro, vendido] = await Promise.all([fechadas(), estruturaDaDRE(), linhasDoNegocio(), dreDasVendas()]);
  const comObras = cs.filter((c) => c.comObras).map((c) => c.id);
  const [gravadas, receitas, previas] = await Promise.all([
    prisma.resultadoObra.groupBy({ by: ["competenciaId"], where: { obraId: { in: venda.ids }, competenciaId: { in: comObras } } }),
    numero ? receitasDaObra(comObras, numero) : Promise.resolve(new Map<string, { receitas: Map<string, number>; centros: Map<string, number> }>()),
    previasDaVenda(comObras, venda, linhasDoCadastro),
  ]);
  // Os meses com valor: o gravado das obras da venda, as receitas e os impostos dos centros dela ou a receita prévia de frete e complementar.
  const comValor = new Set(gravadas.map((g) => g.competenciaId));
  for (const id of comObras) {
    if ([...(receitas.get(id)?.receitas.values() ?? [])].some((v) => Math.abs(v) >= 0.005)) comValor.add(id);
    if ((previas.get(id) ?? []).some((p) => PREVIAS_DA_OBRA.some((x) => x.natureza === p.natureza))) comValor.add(id);
  }
  const { meses, semObras } = mesesDaVenda(cs, comValor);
  const daVenda = vendido.dre.get(venda.codigo) ?? [];
  const s = escopo(est, DO_RESULTADO);
  const estDaTabela = est.filter((l) => s.has(l.codigo));
  const ids = meses.flatMap((m) => (m.competenciaId ? [m.competenciaId] : []));
  const [rows, percentuais] = await Promise.all([
    prisma.resultadoObra.findMany({
      where: { obraId: { in: venda.ids }, competenciaId: { in: ids } },
      select: { competenciaId: true, unidade: true, linhaId: true, valor: true, direto: true, linhaDRE: { select: { codigo: true } } },
    }),
    percentuaisDasCompetencias(ids),
  ]);
  const avisos: string[] = [];
  if (!obra.tipoVenda) avisos.push("A obra está sem o tipo de venda no cadastro: os créditos de impostos seguem a regra da venda mercantil.");
  const semCreditos = meses.filter((m) => m.competenciaId && !percentuais.get(m.competenciaId)?.size).map((m) => m.rotulo);
  if (semCreditos.length) avisos.push(`Sem os Créditos de Impostos em ${semCreditos.join(", ")}: Matérias Primas, Gastos Gerais Variáveis da Produção e Frete e Descarga sem o ajuste nesses meses.`);

  // O vendido na versão escolhida (ou na primeira, se ela não existe mais); sem a escolha (a API), na mais recente.
  const versoes = versoesDaObra(daVenda);
  const versao = pedida === null ? (versoes[versoes.length - 1] ?? 0) : (versaoQueVale(versoes, pedida) ?? pedida);
  if (pedida !== null && versoes.length && versao !== pedida) avisos.push(`A ${rotuloDaVersao(pedida)} não está na DRE de venda da obra: vale a ${rotuloDaVersao(versao)}.`);
  if (vendido.indisponivel) avisos.push(`Sem o vendido: ${vendido.indisponivel}`);
  else if (!versoes.length) avisos.push(`A obra não está na DRE do Comercial importada em ${vendido.fonte ? rotulo(vendido.fonte.ano, vendido.fonte.mes) : "—"}: sem o vendido.`);
  const doVendido = vendidoNaEstrutura(
    daVenda.filter((l) => l.versao === versao),
    est,
    s,
    linhasDoCadastro.map((l) => ({ id: l.id, nome: l.nome, codigo: l.codigo, unidade: l.unidade })),
  );
  if (doVendido.naoAchadas.length) avisos.push(`Contas da DRE de venda fora da Estrutura da DRE: ${doVendido.naoAchadas.join("; ")}.`);

  // O realizado de cada mês por aba (o Consolidado e cada linha) e a composição de cada item (para as consultas).
  const realizado = new Map<string, Array<Map<string, number>>>();
  const composicao = new Map<string, Map<string, Array<Composicao | null>>>();
  const somar = (aba: string, i: number, codigo: string, v: number, c: Composicao) => {
    const m = realizado.get(aba) ?? meses.map(() => new Map<string, number>());
    m[i].set(codigo, (m[i].get(codigo) ?? 0) + v);
    realizado.set(aba, m);
    const daAba = composicao.get(aba) ?? new Map<string, Array<Composicao | null>>();
    const doItem = daAba.get(codigo) ?? meses.map(() => null);
    const x = doItem[i] ?? { direto: 0, rateio: 0, creditos: 0 };
    doItem[i] = { direto: x.direto + c.direto, rateio: x.rateio + c.rateio, creditos: x.creditos + c.creditos };
    daAba.set(codigo, doItem);
    composicao.set(aba, daAba);
  };
  const nasAbas = (linhaId: string | null, i: number, codigo: string, v: number, c: Composicao) => {
    somar("consolidado", i, codigo, v, c);
    if (linhaId) somar(linhaId, i, codigo, v, c);
  };
  const indiceDa = new Map(meses.flatMap((m, i) => (m.competenciaId ? [[m.competenciaId, i] as const] : [])));
  // Os custos e os volumes gravados; a receita gravada (pela Receita Prévia) dá lugar à do modelo da aba Obras. A conta com
  // um percentual dos créditos de 100% ou mais (o crédito maior que o custo da conta na unidade) fica sem o ajuste, sem
  // aviso (05/11/2026, pedido do Adão).
  for (const r of rows) {
    const codigo = r.linhaDRE.codigo;
    if (codigo.startsWith("ROB.") || codigo.startsWith("ROL.")) continue;
    const i = indiceDa.get(r.competenciaId)!;
    const valor = Number(r.valor);
    const p = ehContaDosCreditos(codigo) ? percentuais.get(r.competenciaId)?.get(`${r.unidade}|${codigo}`) : undefined;
    const v = (p ? comOsCreditos(valor, tipoVenda, p) : valor) ?? valor;
    nasAbas(r.linhaId, i, codigo, v, { direto: Number(r.direto), rateio: valor - Number(r.direto), creditos: v - valor });
  }
  // As receitas e os impostos (o modelo da aba Obras), por linha. Os impostos não são item da DRE (o total deles é a ROB
  // menos a ROL): ficam só na composição e na ROL de cada aba, a ROB menos os impostos.
  const linhasDaVenda = new Set(linhasDoCadastro.map((l) => l.id));
  const doPeriodo = ids.flatMap((id) => previas.get(id) ?? []);
  const impostos = new Map<string, number[]>();
  for (const [id, i] of indiceDa) {
    for (const [linha, itens] of receitasPorLinha(receitas.get(id)?.receitas ?? new Map(), previas.get(id) ?? [], doPeriodo)) {
      const linhaId = linha && linhasDaVenda.has(linha) ? linha : null;
      for (const [codigo, v] of itens) {
        nasAbas(linhaId, i, codigo, v, { direto: v, rateio: 0, creditos: 0 });
        if (codigo !== IMPOSTOS) continue;
        for (const aba of ["consolidado", ...(linhaId ? [linhaId] : [])]) {
          realizado.get(aba)![i].delete(IMPOSTOS);
          const xs = impostos.get(aba) ?? meses.map(() => 0);
          xs[i] += v;
          impostos.set(aba, xs);
        }
      }
    }
  }
  for (const [aba, porMes] of realizado) {
    porMes.forEach((itens, i) => {
      const daRob = [...itens].filter(([c]) => c.startsWith("ROB."));
      const irb = impostos.get(aba)?.[i] ?? 0;
      if (daRob.length || Math.abs(irb) >= 0.005) itens.set(ROL, daRob.reduce((soma, [, v]) => soma + v, 0) - irb);
    });
  }
  const vendidoDaAba = (aba: string) => {
    if (aba !== "consolidado") return doVendido.valores.get(aba) ?? null;
    if (!doVendido.valores.size) return null;
    const soma = new Map<string, number>();
    for (const m of doVendido.valores.values()) for (const [k, v] of m) soma.set(k, (soma.get(k) ?? 0) + v);
    return soma;
  };
  const comVendido = versoes.length > 0 && !vendido.indisponivel;
  const linhasDasAbas = linhasDoCadastro.filter((l) => realizado.has(l.id) || doVendido.valores.has(l.id));
  const abas = [{ chave: "consolidado", nome: "Consolidado", unidade: null as number | null }, ...linhasDasAbas.map((l) => ({ chave: l.id, nome: l.nome, unidade: l.unidade as number | null }))];
  const apurado = meses.map((m) => m.competenciaId !== null);
  const ultimo = meses[meses.length - 1];
  // O centro de obra de cada mês (o de mais lançamentos) e, sem lançamento no mês, o do período.
  const maisLancado = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const centrosDoPeriodo = new Map<string, number>();
  for (const id of ids) for (const [c, n] of receitas.get(id)?.centros ?? []) centrosDoPeriodo.set(c, (centrosDoPeriodo.get(c) ?? 0) + n);
  const centroDoPeriodo = maisLancado(centrosDoPeriodo);
  return {
    obra,
    versao,
    versoes,
    fonte: descricaoDaFonte(vendido.fonte),
    semObras,
    avisos,
    centros: meses.map((m) => (m.competenciaId ? (maisLancado(receitas.get(m.competenciaId)?.centros ?? new Map()) ?? centroDoPeriodo) : null)),
    obras: venda.codigos,
    abas: abas.map((a) => {
      const porMes = (realizado.get(a.chave) ?? meses.map(() => new Map<string, number>())).map((itens) => comTotais(itens, estDaTabela, s));
      const v = vendidoDaAba(a.chave);
      const celulaVendida = (l: LinhaDRE) => {
        const x = arredonda(v?.get(l.codigo) ?? 0);
        const bp = baseDoPercentual("obras", l);
        const bu = baseDoUnitario(l);
        return { valor: x, pct: bp ? divide(x, v?.get(bp)) : null, unitario: bu ? divide(x, v?.get(bu)) : null };
      };
      const linhas = montar(estDaTabela.filter(naTabela), "obras", apurado, porMes, porMes, acesso, new Set(v ? v.keys() : [])).map((x) => {
        const l = estDaTabela.find((e) => e.codigo === x.codigo)!;
        return { ...x, ...(comVendido ? { orcado: { total: celulaVendida(l) } } : {}) };
      });
      const daAba = composicao.get(a.chave) ?? new Map<string, Array<Composicao | null>>();
      return {
        chave: a.chave,
        nome: a.nome,
        unidade: a.unidade,
        nomeUnidade: a.unidade ? nomeDaUnidade(a.unidade) : null,
        composicao: Object.fromEntries(
          [...daAba].map(([codigo, xs]) => [codigo, xs.map((x) => (x ? { direto: arredonda(x.direto, 2), rateio: arredonda(x.rateio, 2), creditos: arredonda(x.creditos, 2) } : null))]),
        ),
        dados: {
          ano: ultimo?.ano ?? new Date().getFullYear(),
          ate: ultimo?.mes ?? 0,
          meses: meses.map((m) => ({ mes: m.ano * 100 + m.mes, rotulo: m.rotulo, apurado: m.competenciaId !== null })),
          rotuloComparado: "Vendido",
          ...(comVendido ? { comparado: { nome: rotuloDaVersao(versao), ano: ultimo?.ano ?? new Date().getFullYear() } } : {}),
          linhas,
        },
      };
    }),
  };
}

export const realizadoObraService = {
  /**
   * A lista Venda: uma opção por versão de cada venda da DRE do Comercial e uma, sem a versão, por venda só com o realizado
   * gravado nas competências fechadas, em ordem de código; a escolhida pelo usuário (com a versão que vale) e a fonte do
   * vendido.
   */
  async vendas(usuarioId: string) {
    const [cadastro, gravadas, { fonte, dre, indisponivel }] = await Promise.all([
      vendasDoCadastro(),
      getPrismaClient().resultadoObra.groupBy({ by: ["obraId"], where: { obraId: { not: null }, competencia: { status: "FECHADA" } } }),
      dreDasVendas(),
    ]);
    const comRealizado = new Set(gravadas.map((x) => x.obraId!));
    const vendas = [...cadastro.porCodigo.values()]
      .sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true }))
      .flatMap((v) => {
        const versoes = versoesDaObra(dre.get(v.codigo) ?? []);
        const realizado = v.ids.some((id) => comRealizado.has(id));
        if (!realizado && !versoes.length) return [];
        const d = descricaoDaVenda(v);
        const opcao = { obraId: d.id, codigo: d.codigo, nome: d.nome, tipoVenda: d.tipoVenda, generica: d.generica, comRealizado: realizado };
        return versoes.length ? versoes.map((versao) => ({ ...opcao, versao: versao as number | null })) : [{ ...opcao, versao: null as number | null }];
      });
    const escolha = await escolhaDo(usuarioId, cadastro);
    return {
      vendas,
      escolhida: escolha ? { obraId: escolha.venda.principal.id, versao: versaoQueVale(versoesDaObra(dre.get(escolha.venda.codigo) ?? []), escolha.versao) } : null,
      fonte: descricaoDaFonte(fonte),
      indisponivel,
    };
  },

  /** Grava a venda do usuário: a obra (a principal da venda) e a versão vendida (sem o vendido, 0). */
  async escolher(usuarioId: string, obraId: string, versao: number) {
    const prisma = getPrismaClient();
    if (!(await prisma.obra.findUnique({ where: { id: obraId }, select: { id: true } }))) throw new RegraRealizadoObraError(404, "A obra não existe.");
    await prisma.realizadoObraConfiguracao.upsert({ where: { usuarioId }, create: { usuarioId, obraId, versao }, update: { obraId, versao } });
  },

  /**
   * Os Resultados da venda: o Consolidado e uma aba por linha, cada uma com a DRE mês a mês e o vendido no total; os meses
   * fechados sem as obras gravadas e os avisos.
   *
   * - A receita bruta, os impostos e a receita líquida no modelo da aba Obras da DRE do mês (03/11/2026, pedido
   *   do Adão; `receitasPorLinha`): a ROB e os impostos dos lançamentos dos centros da obra, com a receita prévia de frete e
   *   complementar levada, e a ROL, a ROB menos os impostos (sem a receita líquida por natureza). O % é o da aba Obras: sobre a
   *   ROB nas receitas e nos impostos, sobre a ROL no resto.
   * - Os custos e os volumes, os gravados pela etapa Linhas (o direto nas obras da venda e a parte delas no rateio), com os
   *   créditos de impostos.
   * - Para as consultas: em cada aba, a composição de cada item em cada mês (o direto, o rateio e o ajuste dos créditos); em
   *   cada mês, o centro de obra da venda (o de mais lançamentos; sem lançamento no mês, o do período); os códigos das obras
   *   da venda (os volumes das listas).
   */
  async resultados(usuarioId: string, acesso: Acesso = ACESSO_TOTAL) {
    const escolha = await escolhaDo(usuarioId, await vendasDoCadastro());
    return escolha ? resultadosDaVenda(escolha.venda, escolha.versao, acesso) : SEM_VENDA;
  },

  /**
   * Os Resultados de uma venda pedida pela API obra-dre (26/11/2026, pedido do Adão), sem a escolha da lista Venda: a venda pelo
   * código (`vendaPedida`) e a versão vendida pedida (sem ela, a mais recente da DRE de venda). Nulo sem a venda.
   */
  async resultadosDaApi(obra: string, versao: number | null, acesso: Acesso = ACESSO_TOTAL) {
    const venda = vendaPedida(await vendasDoCadastro(), obra);
    return venda ? resultadosDaVenda(venda, versao, acesso) : null;
  },

  /**
   * A memória de cálculo de um subtotal agrupado num mês da venda (03/11/2026, pedido do Adão: a Mão de Obra e os Gastos
   * Gerais, Diretos e Indiretos). Em cada linha da venda (no Consolidado, todas; na aba de uma linha, ela): o custo da linha
   * sem os centros de obra (o rateio da linha, da etapa Linhas), dividido pela base da linha (a das obras vendidas: o m³
   * produzido, os kg da metalurgia, o m³ montado, os dias de acompanhamento ou a receita bruta; sem ela no mês, a do exercício
   * até ele) e multiplicado pela base da venda, mais os lançamentos dos centros da obra que foram à linha; e por conta. Os
   * valores são os gravados pela etapa Linhas; as bases, as das listas de hoje (`confere` falso: a conta difere do gravado).
   */
  async memoria(usuarioId: string, ano: number, mes: number, aba: string, codigo: string) {
    const prisma = getPrismaClient();
    const escolha = await escolhaDo(usuarioId, await vendasDoCadastro());
    if (!escolha) throw new RegraRealizadoObraError(404, "Escolha a venda na lista Venda.");
    const { venda } = escolha;
    const c = await prisma.competencia.findUnique({ where: { ano_mes: { ano, mes } }, select: { id: true, status: true, apuracaoLinhas: true } });
    if (!c || c.status !== "FECHADA" || !(c.apuracaoLinhas as ApuracaoLinhas | null)?.obras) {
      throw new RegraRealizadoObraError(404, `A competência ${rotulo(ano, mes)} não está fechada com as obras gravadas.`);
    }
    const [est, linhas, obras] = await Promise.all([estruturaDaDRE(), linhasDoNegocio(), prisma.obra.findMany({ select: { id: true, codigo: true, generica: true } })]);
    const subtotal = est.find((l) => l.codigo === codigo);
    const doGrupo = AGRUPADAS.exec(codigo)?.[0];
    if (!subtotal || subtotal.tipo !== "SUBTOTAL" || !doGrupo) {
      throw new RegraRealizadoObraError(400, "A memória de cálculo é da Mão de Obra e dos Gastos Gerais, Diretos e Indiretos.");
    }
    const contas = est.filter((l) => l.tipo === "ITEM" && l.codigo.startsWith(doGrupo));
    const codigos = contas.map((l) => l.codigo);
    const daAba = aba === "consolidado" ? {} : { linhaId: aba };
    const [daVenda, dasLinhas] = await Promise.all([
      prisma.resultadoObra.findMany({
        where: { competenciaId: c.id, obraId: { in: venda.ids }, linhaDRE: { codigo: { in: codigos } }, ...daAba },
        select: { linhaId: true, valor: true, direto: true, linhaDRE: { select: { codigo: true } } },
      }),
      prisma.resultadoLinha.findMany({
        where: { competenciaId: c.id, linhaId: aba === "consolidado" ? { not: null } : aba, linhaDRE: { codigo: { in: codigos } } },
        select: { linhaId: true, valor: true, naObra: true, linhaDRE: { select: { codigo: true } } },
      }),
    ]);

    // As listas (e a Receita Prévia, nas despesas variáveis de venda) do mês e do exercício até ele, só quando a base pede.
    const { obraDaReceita, genericas } = obrasDoRateio(obras);
    const comReceita = doGrupo.startsWith("DVV.");
    const dadosDe = async (id: string) => ({ volumes: await volumesDoMes(id, linhas), receita: comReceita ? await receitaDoMes(id, linhas) : [] });
    const cache = new Map<boolean, Promise<{ volumes: Volume[]; receita: ItemDaReceita[] }>>();
    const dados = (doAno: boolean) => {
      if (!cache.has(doAno)) {
        cache.set(
          doAno,
          doAno
            ? (async () => {
                const ids = await prisma.competencia.findMany({ where: { ano, mes: { lte: mes } }, select: { id: true }, orderBy: { mes: "asc" } });
                const todos = await Promise.all(ids.map((x) => dadosDe(x.id)));
                return { volumes: todos.flatMap((d) => d.volumes), receita: todos.flatMap((d) => d.receita) };
              })()
            : dadosDe(c.id),
        );
      }
      return cache.get(doAno)!;
    };

    const daVendaIds = new Set(venda.ids);
    const grupo = codigo.split(".")[0];
    const ordem = new Map(linhas.map((l, i) => [l.id, i]));
    const linhaIds = [...new Set(daVenda.map((r) => r.linhaId))].sort((a, b) => (a ? (ordem.get(a) ?? 0) : 1e9) - (b ? (ordem.get(b) ?? 0) : 1e9));
    const blocos = [];
    for (const linhaId of linhaIds) {
      const linha = linhaId ? linhas.find((l) => l.id === linhaId) : undefined;
      const porConta = new Map(codigos.map((k) => [k, { rateado: 0, rateio: 0, direto: 0 }]));
      for (const r of daVenda) {
        if (r.linhaId !== linhaId) continue;
        const x = porConta.get(r.linhaDRE.codigo)!;
        x.rateio += Number(r.valor) - Number(r.direto);
        x.direto += Number(r.direto);
      }
      for (const r of dasLinhas) if (r.linhaId === linhaId) porConta.get(r.linhaDRE.codigo)!.rateado += Number(r.valor) - Number(r.naObra);
      // A base: a primeira das da linha com volume no mês e, sem nenhuma, no exercício (a ordem da etapa Linhas).
      let base: { nome: string; medida: string; doExercicio: boolean; total: number; daVenda: number } | null = null;
      if (linha) {
        procura: for (const doAno of [false, true]) {
          for (const b of basesDoRateio(grupo, linha.unidade, linha.codigo)) {
            const pesos = pesosDasObras(b, linha.id, await dados(doAno), genericas, obraDaReceita);
            if (!pesos.size) continue;
            const total = [...pesos.values()].reduce((s, x) => s + x, 0);
            const daObra = [...pesos].filter(([o]) => daVendaIds.has(o)).reduce((s, [, x]) => s + x, 0);
            base = { ...NOME_DA_BASE[b], doExercicio: doAno, total: arredonda(total), daVenda: arredonda(daObra) };
            break procura;
          }
        }
      }
      const soma = (k: "rateado" | "rateio" | "direto") => [...porConta.values()].reduce((s, x) => s + x[k], 0);
      const rateado = soma("rateado");
      const rateio = soma("rateio");
      const calculado = base && base.total ? (rateado * base.daVenda) / base.total : 0;
      blocos.push({
        linha: linha?.nome ?? "Sem Linha",
        unidade: linha ? nomeDaUnidade(linha.unidade) : null,
        rateado: arredonda(rateado, 2),
        base,
        calculado: arredonda(calculado, 2),
        rateio: arredonda(rateio, 2),
        direto: arredonda(soma("direto"), 2),
        total: arredonda(rateio + soma("direto"), 2),
        confere: !linha || Math.abs(calculado - rateio) < 1,
        contas: contas
          .map((l) => ({ codigo: l.codigo, descricao: l.descricao, ...porConta.get(l.codigo)! }))
          .filter((x) => [x.rateado, x.rateio, x.direto].some((v) => Math.abs(v) >= 0.005))
          .map((x) => ({ ...x, rateado: arredonda(x.rateado, 2), rateio: arredonda(x.rateio, 2), direto: arredonda(x.direto, 2) })),
      });
    }
    return {
      venda: descricaoDaVenda(venda),
      descricao: subtotal.descricao,
      mes: rotuloCurto(ano, mes),
      aba: aba === "consolidado" ? "Consolidado" : (linhas.find((l) => l.id === aba)?.nome ?? aba),
      total: arredonda(blocos.reduce((s, b) => s + b.total, 0), 2),
      blocos,
    };
  },
};
