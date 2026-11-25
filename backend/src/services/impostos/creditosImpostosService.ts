import { getPrismaClient } from "../../config/prisma.js";
import { mesesDoExercicio } from "../relatorios/resultadosService.js";
import { nomeDaUnidade } from "../cadastros/nomesDasUnidades.js";

/**
 * Os Créditos de Impostos (03/11/2026, pedido do Adão): a tela Impostos do Fechamento Mensal. Desde 04/11/2026, a aba Impostos
 * (Lista) do LISTAS REALIZADO (RESULTADOS) traz o **Creditado** e o **Estornado** do mês em R$, por unidade (Matriz e Filial) e
 * conta (a ATRIBUIÇÃO e a CONTA da Estrutura da DRE): as de Matérias Primas e de Gastos Gerais Variáveis da Produção (os itens
 * CPP.MP e CPP.GGV) e o Frete e Descarga (DVV.GGV), que a aba põe nos Gastos Gerais Variáveis; as linhas das demais contas a
 * importação ignora. Os percentuais são os R$ sobre o custo da conta na unidade (o valor dela na DRE apurada do mês). O
 * Realizado por Obra usa os percentuais nos custos dessas contas: na venda mercantil, sem o Estornado; na global, sem o
 * Estornado e com o Creditado reaplicado; a aba Impostos dos Resultados Empresariais › Resultados os mostra mês a mês.
 */

const rotulo = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;

/**
 * Os grupos das contas dos créditos: o código do subtotal, o prefixo dos itens dele e as contas de fora do prefixo que a aba
 * Impostos (Lista) põe no grupo (o Frete e Descarga das Despesas Variáveis de Venda, 04/11/2026).
 */
export const GRUPOS_DOS_CREDITOS: ReadonlyArray<{ subtotal: string; prefixo: string; extras: readonly string[] }> = [
  { subtotal: "CPP.MP.MATERIAS_PRIMAS", prefixo: "CPP.MP.", extras: [] },
  { subtotal: "CPP.GGV.GASTOS_GERAIS_VARIAVEIS", prefixo: "CPP.GGV.", extras: ["DVV.GGV.FRETE_E_DESCARGA"] },
];

/** As unidades dos créditos, pelo código da unidade de negócio. */
export const UNIDADES_DOS_CREDITOS = [{ codigo: 1 }, { codigo: 2 }] as const;

/** Uma conta dos créditos (CPP.MP.*, CPP.GGV.* e o Frete e Descarga, fora os subtotais). */
export const ehContaDosCreditos = (codigo: string) => GRUPOS_DOS_CREDITOS.some((g) => (codigo.startsWith(g.prefixo) && codigo !== g.subtotal) || g.extras.includes(codigo));

export class RegraImpostosError extends Error {
  constructor(
    readonly status: 404,
    message: string,
  ) {
    super(message);
  }
}

/** Os percentuais de uma conta numa unidade e num mês, em frações (0,0836 = 8,36%): o Creditado e o Estornado sobre o custo. */
export type Percentuais = { creditado: number; estornado: number };

/** As contas dos créditos na ordem da DRE, com o subtotal de cada grupo. */
async function contas() {
  const ls = await getPrismaClient().linhaDRE.findMany({
    where: { ativo: true, OR: GRUPOS_DOS_CREDITOS.flatMap((g) => [{ codigo: { startsWith: g.prefixo } }, ...g.extras.map((codigo) => ({ codigo }))]) },
    orderBy: { ordem: "asc" },
    select: { id: true, codigo: true, descricao: true, atribuicao: true, tipo: true },
  });
  return GRUPOS_DOS_CREDITOS.map((g) => ({
    subtotal: ls.find((l) => l.codigo === g.subtotal) ?? null,
    itens: ls.filter((l) => (l.codigo.startsWith(g.prefixo) && l.tipo === "ITEM") || g.extras.includes(l.codigo)),
  }));
}

/** As contas dos créditos, sem os grupos: a importação da aba Impostos (Lista) as acha pela atribuição e pelo nome. */
export const contasDosCreditos = async () => (await contas()).flatMap((g) => g.itens);

/** Chave de uma conta numa unidade. */
const chave = (unidade: number, id: string) => `${unidade}|${id}`;

/**
 * Os créditos e os custos das competências: os R$ importados (competência → unidade|linhaDREId → Creditado e Estornado) e o
 * custo das contas na unidade, da DRE apurada (competência → unidade|linhaDREId → valor).
 */
async function dadosDasCompetencias(competenciaIds: string[], linhaIds: string[]) {
  const prisma = getPrismaClient();
  const [creditos, custos] = await Promise.all([
    prisma.creditoImposto.findMany({ where: { competenciaId: { in: competenciaIds } }, select: { competenciaId: true, unidade: true, linhaDREId: true, creditado: true, estornado: true } }),
    prisma.resultadoApurado.findMany({
      where: { competenciaId: { in: competenciaIds }, centroCustoId: null, linhaDREId: { in: linhaIds }, unidadeNegocio: { codigo: { in: UNIDADES_DOS_CREDITOS.map((u) => u.codigo) } } },
      select: { competenciaId: true, linhaDREId: true, valor: true, unidadeNegocio: { select: { codigo: true } } },
    }),
  ]);
  const vazio = () => new Map(competenciaIds.map((id) => [id, new Map<string, { creditado: number; estornado: number }>()]));
  const doMes = vazio();
  for (const c of creditos) doMes.get(c.competenciaId)!.set(chave(c.unidade, c.linhaDREId), { creditado: Number(c.creditado), estornado: Number(c.estornado) });
  const custo = new Map(competenciaIds.map((id) => [id, new Map<string, number>()]));
  for (const r of custos) custo.get(r.competenciaId)!.set(chave(r.unidadeNegocio!.codigo, r.linhaDREId), Number(r.valor));
  return { creditos: doMes, custos: custo };
}

/**
 * Os percentuais das competências, para o Realizado por Obra: competência → unidade|código da conta → o Creditado e o
 * Estornado sobre o custo da conta na unidade. Só as contas com custo positivo; sem os créditos no mês, o mapa vazio.
 */
export async function percentuaisDasCompetencias(competenciaIds: string[]): Promise<Map<string, Map<string, Percentuais>>> {
  const itens = await contasDosCreditos();
  const { creditos, custos } = await dadosDasCompetencias(competenciaIds, itens.map((i) => i.id));
  const codigoDe = new Map(itens.map((i) => [i.id, i.codigo]));
  return new Map(
    competenciaIds.map((id) => {
      const r = new Map<string, Percentuais>();
      for (const [k, c] of creditos.get(id)!) {
        const custo = custos.get(id)!.get(k);
        const [unidade, linhaId] = k.split("|");
        const codigo = codigoDe.get(linhaId);
        if (codigo && custo !== undefined && custo > 0) r.set(`${unidade}|${codigo}`, { creditado: c.creditado / custo, estornado: c.estornado / custo });
      }
      return [id, r];
    }),
  );
}

/** Um crédito da conta: o R$ e o percentual (sobre o custo da conta na unidade). */
type Credito = { valor: number | null; pct: number | null };
type CreditosDaConta = { valor: number | null; creditado: Credito; estornado: Credito };
const arredonda = (x: number) => Math.round(x * 100) / 100;
const credito = (valor: number | null, custo: number | null): Credito => ({ valor: valor === null ? null : arredonda(valor), pct: valor === null || custo === null || custo <= 0 ? null : valor / custo });
/** O total de várias contas: a soma dos R$ e o percentual sobre a soma dos custos. */
function somaDe(xs: CreditosDaConta[]): CreditosDaConta {
  const soma = (f: (x: CreditosDaConta) => number | null) => (xs.some((x) => f(x) === null) ? null : arredonda(xs.reduce((s, x) => s + f(x)!, 0)));
  const valor = soma((x) => x.valor);
  return { valor, creditado: credito(soma((x) => x.creditado.valor), valor), estornado: credito(soma((x) => x.estornado.valor), valor) };
}

export const creditosImpostosService = {
  /**
   * A tela Impostos do mês: em cada unidade (Matriz e Filial), as contas, com o custo na DRE apurada da unidade (sem a
   * apuração, nulo) e o Creditado e o Estornado (o R$ e o percentual sobre o custo), o total de cada grupo e o da unidade. Sem
   * os créditos importados no mês, os R$ ficam nulos; com eles, a conta fora da aba fica com zero.
   */
  async doMes(ano: number, mes: number) {
    const c = await getPrismaClient().competencia.findUnique({ where: { ano_mes: { ano, mes } }, select: { id: true, status: true, apuradaEm: true } });
    if (!c) throw new RegraImpostosError(404, `A competência ${rotulo(ano, mes)} não existe.`);
    const grupos = await contas();
    const { creditos, custos } = await dadosDasCompetencias([c.id], grupos.flatMap((g) => g.itens.map((i) => i.id)));
    const apurada = c.apuradaEm !== null;
    const doMes = creditos.get(c.id)!;
    const temCreditos = doMes.size > 0;
    const unidades = UNIDADES_DOS_CREDITOS.map((u) => {
      const linhas = grupos.map((g) => {
        const contasDoGrupo = g.itens.map((i) => {
          const k = chave(u.codigo, i.id);
          const valor = apurada ? arredonda(custos.get(c.id)!.get(k) ?? 0) : null;
          const x = temCreditos ? (doMes.get(k) ?? { creditado: 0, estornado: 0 }) : null;
          return { codigo: i.codigo, descricao: i.descricao, valor, creditado: credito(x ? x.creditado : null, valor), estornado: credito(x ? x.estornado : null, valor) };
        });
        return { codigo: g.subtotal?.codigo ?? g.itens[0]?.codigo ?? "", descricao: g.subtotal?.descricao ?? "", contas: contasDoGrupo, total: somaDe(contasDoGrupo) };
      });
      return { codigo: u.codigo, nome: nomeDaUnidade(u.codigo), grupos: linhas, total: somaDe(linhas.flatMap((g) => g.contas)) };
    });
    return { competencia: { ano, mes, status: c.status, apurada }, temCreditos, unidades };
  },

  /**
   * A aba Impostos (Créditos de Impostos) dos Resultados Empresariais › Resultados (03/11/2026, pedido do Adão; de início,
   * Almoxarifado): de cada mês fechado do exercício, até o mês `ate`, em cada unidade, o Creditado e o Estornado (o R$ e o
   * percentual) das contas, de cada grupo e do total (como na etapa Impostos); sem os créditos importados no mês, nulos.
   */
  async impostos(ano: number, ate?: number) {
    const fechados = (await mesesDoExercicio(ano, ate, true)).meses.filter((m) => m.competenciaId !== null);
    const doMes = await Promise.all(fechados.map((m) => this.doMes(ano, m.mes)));
    const dos = (d: (typeof doMes)[number], x: CreditosDaConta) => (d.temCreditos ? { creditado: x.creditado, estornado: x.estornado } : null);
    const grupos = (await contas()).map((g) => ({ codigo: g.subtotal?.codigo ?? g.itens[0]?.codigo ?? "", descricao: g.subtotal?.descricao ?? "", contas: g.itens }));
    return {
      meses: fechados.map((m) => ({ mes: m.mes, rotulo: m.rotulo })),
      unidades: UNIDADES_DOS_CREDITOS.map((u, n) => ({
        codigo: u.codigo,
        nome: nomeDaUnidade(u.codigo),
        total: { meses: doMes.map((d) => dos(d, d.unidades[n].total)) },
        grupos: grupos.map((g, k) => ({
          codigo: g.codigo,
          descricao: g.descricao,
          meses: doMes.map((d) => dos(d, d.unidades[n].grupos[k].total)),
          contas: g.contas.map((c, j) => ({ codigo: c.codigo, descricao: c.descricao, meses: doMes.map((d) => dos(d, d.unidades[n].grupos[k].contas[j])) })),
        })),
      })),
    };
  },
};
