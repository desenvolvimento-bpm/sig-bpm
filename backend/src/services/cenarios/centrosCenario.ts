import { getPrismaClient } from "../../config/prisma.js";
import type { LinhaEstrutura } from "../dre/apuracaoUnidades.js";

/**
 * Os centros de custo dos cenários analíticos (13/10/2026, etapa 3): os valores mensais de cada grupo de centros da
 * Controladoria (o nome da Controladoria, como em Resultados Empresariais), por conta da DRE, e a alocação deles às
 * unidades com as regras do fechamento mensal (apuracaoUnidades):
 *
 * - nas contas dos custos de produção (CPP), o balde do grupo: MATRIZ e FILIAL vão direto para a unidade; UNIDADE, para
 *   a unidade da filial do grupo (a filial em que os centros dele mais lançaram no realizado); PRODUCAO e PROJETO se
 *   rateiam entre Matriz e Filial; METALURGIA e ARMADURA, entre Matriz, Filial, Montagem e Complementar (em Serviços, na
 *   conta de mesma atribuição e descrição da CSM ou da CSC);
 * - nas contas dos custos de montagem (CSM), o balde OBRAS vai direto para Serviços; ACOMPANHAMENTO se rateia entre a
 *   Montagem (CSM) e a Complementar (na conta equivalente da CSC);
 * - nas despesas (DL, DT, DC e DA), Despesas e Extra.
 *
 * Os percentuais dos rateios saem das premissas (premissasCenario.ts): Produção pelo m³ produzido, Projeto pelo m³
 * produzido da venda Global, Metalurgia e Armadura pelo kg das linhas (o volume × a demanda por unidade) e
 * Acompanhamento pelos acompanhamentos das linhas de Serviços; numa chave sem base no mês, o percentual é zero (como no
 * fechamento: o valor dos grupos dela não entra).
 *
 * Os centros de estoque e de investimento não entram. As
 * contas dos grupos no cenário são as de mão de obra (direta e indireta) e de gastos gerais diretos, indiretos e
 * comerciais: as Matérias Primas, a Mão de Obra Terceirizada (14/10/2026), os Gastos Gerais Variáveis e o Estoque vêm
 * das premissas (R$ por unidade produzida), e a depreciação, dos investimentos.
 */

/** As atribuições das contas dos centros no cenário (o segundo pedaço do código da conta). */
const ATRIBUICOES = new Set(["MOD", "MOI", "GGD", "GGI", "GGC"]);
/** A conta é de centros no cenário (mão de obra ou gastos gerais diretos, indiretos ou comerciais). */
export const ehContaDeCentro = (codigo: string) => ATRIBUICOES.has(codigo.split(".")[1] ?? "");
/** O grupo da DRE de cada departamento; os demais (requisição, sem departamento) são de produção. */
const GRUPO_DO_DEPARTAMENTO: Record<string, string> = {
  "CUSTOS DE SERVIÇOS: MONTAGEM (CSM)": "CSM",
  "DESPESAS ADMINISTRATIVAS (DA)": "DA",
  "DESPESAS COMERCIAIS (DC)": "DC",
  "DESPESAS DE LOGÍSTICA (DL)": "DL",
  "DESPESAS TÉCNICAS (DT)": "DT",
};
/**
 * O que fica fora do cenário: o estoque e os investimentos — os departamentos Almoxarifado, Requisição e Investimento e
 * os centros dos códigos 1.96 (Estoque e Almoxarifado) e 1.97 (Investimento). Os almoxarifados das fábricas (a equipe,
 * departamento Custos de Produção) ficam.
 */
const FORA = new Set(["ALMOXARIFADO", "REQUISIÇÃO", "INVESTIMENTO"]);
const foraDoCenario = (c: { departamento: string | null; codigoRM: string | null }) =>
  FORA.has((c.departamento ?? "").trim().toUpperCase()) || /^1.9[67](.|$)/.test(c.codigoRM ?? "");
const DESPESAS = new Set(["DL", "DT", "DC", "DA"]);

/** O grupo de um centro: o nome da Controladoria; sem ele, o nome do centro (como em Resultados Empresariais). */
export const nomeDoGrupo = (c: { nomeControladoria: string | null; nomeRM: string | null; codigoRM: string | null }) => c.nomeControladoria?.trim() || c.nomeRM?.trim() || c.codigoRM || "Centro";

export type GrupoDoCenario = {
  /** O nome do grupo (o nome da Controladoria; sem ele, o nome do centro). */
  grupo: string;
  centros: Array<{ id: string; codigo: string | null; nome: string; balde: string | null }>;
  /** O balde do grupo: o mais comum entre os centros dele. */
  balde: string | null;
  /** Os baldes diferentes dos centros (mais de um: o aviso na tela). */
  baldes: string[];
  /** O grupo da DRE das contas: CPP, CSM, DL, DT, DC ou DA. */
  grupoDRE: string;
  /** A unidade do balde UNIDADE (a filial em que os centros mais lançaram); 1 sem lançamentos. */
  unidade: 1 | 2;
  /** Para onde vai o valor, em texto. */
  destino: string;
  /** A atribuição mais comum dos centros (14/10/2026: o quadro de lotação em que o grupo entra); sem ela, nula. */
  atribuicao: "DIRETA" | "INDIRETA" | null;
  /** O departamento mais comum dos centros, como no cadastro (14/10/2026: o nome dos arquivos exportados). */
  departamento: string | null;
};

const maisComum = <T>(xs: T[]) => {
  const n = new Map<T, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0];
};

/** Os grupos de centros de custo ativos (sem os de estoque e de investimento), com o balde e o destino. */
export async function gruposDoCadastro(): Promise<GrupoDoCenario[]> {
  const prisma = getPrismaClient();
  const [centros, diretos, partes] = await Promise.all([
    // Os vazios primeiro, como no SQLite (23/10/2026): o desempate do maisComum é a posição, e decide o balde do grupo.
    prisma.centroCusto.findMany({
      where: { ativo: true },
      orderBy: [{ nomeControladoria: { sort: "asc", nulls: "first" } }, { codigoRM: { sort: "asc", nulls: "first" } }, { criadoEm: "asc" }, { id: "asc" }],
    }),
    prisma.lancamentoContabil.groupBy({ by: ["centroCustoId", "filial"], _count: { _all: true }, where: { centroCustoId: { not: null }, redistribuicaoId: null } }),
    // Os redistribuídos (13/11/2026) contam nos centros dos destinos.
    prisma.lancamentoRedistribuido.groupBy({ by: ["centroCustoId", "filial"], _count: { _all: true } }),
  ]);
  const filiais = [...diretos, ...partes];
  const porGrupo = new Map<string, typeof centros>();
  for (const c of centros) {
    if (foraDoCenario(c)) continue;
    const g = nomeDoGrupo(c);
    porGrupo.set(g, [...(porGrupo.get(g) ?? []), c]);
  }
  return [...porGrupo].map(([grupo, cs]): GrupoDoCenario => {
    const ids = new Set(cs.map((c) => c.id));
    const lancamentos = new Map<number, number>();
    for (const f of filiais) if (ids.has(f.centroCustoId!)) lancamentos.set(f.filial, (lancamentos.get(f.filial) ?? 0) + f._count._all);
    const unidade = (lancamentos.get(2) ?? 0) > (lancamentos.get(1) ?? 0) ? 2 : 1;
    const balde = maisComum(cs.map((c) => c.balde)) ?? null;
    const grupoDRE = maisComum(cs.map((c) => GRUPO_DO_DEPARTAMENTO[(c.departamento ?? "").trim().toUpperCase()] ?? "CPP")) ?? "CPP";
    return {
      grupo,
      centros: cs.map((c) => ({ id: c.id, codigo: c.codigoRM, nome: c.nomeRM ?? c.nomeControladoria ?? c.codigoRM ?? "Centro", balde: c.balde })),
      balde,
      baldes: [...new Set(cs.map((c) => c.balde ?? "—"))],
      grupoDRE,
      unidade,
      destino: destinoDoGrupo(grupoDRE, balde, unidade),
      atribuicao: maisComum(cs.map((c) => c.atribuicao).filter((a): a is "DIRETA" | "INDIRETA" => !!a)) ?? null,
      departamento: maisComum(cs.map((c) => c.departamento?.trim()).filter((d): d is string => !!d)) ?? null,
    };
  });
}

function destinoDoGrupo(grupoDRE: string, balde: string | null, unidade: 1 | 2) {
  if (DESPESAS.has(grupoDRE)) return "Despesas e Extra";
  if (grupoDRE === "CSM") return balde === "ACOMPANHAMENTO" ? "Rateio de Acompanhamento (Montagem e Complementar)" : "Serviços";
  switch (balde) {
    case "MATRIZ":
      return "Matriz";
    case "FILIAL":
      return "Filial";
    case "PRODUCAO":
      return "Rateio de Produção (Matriz e Filial)";
    case "PROJETO":
      return "Rateio de Projeto (Matriz e Filial)";
    case "METALURGIA":
      return "Rateio de Metalurgia (Matriz, Filial, Montagem e Complementar)";
    case "ARMADURA":
      return "Rateio de Armadura (Matriz, Filial, Montagem e Complementar)";
    case "OBRAS":
      return "Serviços";
    default:
      return unidade === 2 ? "Filial" : "Matriz";
  }
}

/** As contas de um grupo no cenário: as da atribuição dos centros, no grupo da DRE dele. */
export function contasDoGrupo(est: LinhaEstrutura[], g: Pick<GrupoDoCenario, "grupoDRE">) {
  return est.filter((l) => l.tipo === "ITEM" && l.codigo.startsWith(`${g.grupoDRE}.`) && ATRIBUICOES.has(l.codigo.split(".")[1]));
}

/** Os percentuais de um mês: a parte de cada destino em cada chave ("PRODUCAO|MATRIZ" → 0,6). */
export type Percentuais = Map<string, number>;

/** As chaves e os destinos dos rateios, na ordem da aba Rateios, com a base das premissas. */
export const RATEIOS: Array<{ chave: string; destino: string; rotulo: string; base: string }> = [
  { chave: "PRODUCAO", destino: "MATRIZ", rotulo: "Produção: Matriz", base: "m³" },
  { chave: "PRODUCAO", destino: "FILIAL", rotulo: "Produção: Filial", base: "m³" },
  { chave: "PROJETO", destino: "MATRIZ", rotulo: "Projeto: Matriz", base: "m³" },
  { chave: "PROJETO", destino: "FILIAL", rotulo: "Projeto: Filial", base: "m³" },
  { chave: "METALURGIA", destino: "MATRIZ", rotulo: "Metalurgia: Matriz", base: "kg" },
  { chave: "METALURGIA", destino: "FILIAL", rotulo: "Metalurgia: Filial", base: "kg" },
  { chave: "METALURGIA", destino: "MONTAGEM", rotulo: "Metalurgia: Montagem", base: "kg" },
  { chave: "METALURGIA", destino: "COMPLEMENTAR", rotulo: "Metalurgia: Complementar", base: "kg" },
  { chave: "ARMADURA", destino: "MATRIZ", rotulo: "Armadura: Matriz", base: "kg" },
  { chave: "ARMADURA", destino: "FILIAL", rotulo: "Armadura: Filial", base: "kg" },
  { chave: "ARMADURA", destino: "MONTAGEM", rotulo: "Armadura: Montagem", base: "kg" },
  { chave: "ARMADURA", destino: "COMPLEMENTAR", rotulo: "Armadura: Complementar", base: "kg" },
  { chave: "ACOMPANHAMENTO", destino: "MONTAGEM", rotulo: "Acompanhamento: Montagem", base: "acomp." },
  { chave: "ACOMPANHAMENTO", destino: "COMPLEMENTAR", rotulo: "Acompanhamento: Complementar", base: "acomp." },
];

/** Os percentuais de cada mês pelas bases das premissas ("CHAVE|DESTINO" → os doze meses): o destino sobre a chave. */
export function percentuaisDasBases(bases: Map<string, number[]>): Percentuais[] {
  return Array.from({ length: 12 }, (_, k) => {
    const total = new Map<string, number>();
    for (const r of RATEIOS) total.set(r.chave, (total.get(r.chave) ?? 0) + (bases.get(`${r.chave}|${r.destino}`)?.[k] ?? 0));
    const p: Percentuais = new Map();
    for (const r of RATEIOS) {
      const t = total.get(r.chave) ?? 0;
      p.set(`${r.chave}|${r.destino}`, t ? (bases.get(`${r.chave}|${r.destino}`)?.[k] ?? 0) / t : 0);
    }
    return p;
  });
}

/** As chaves de rateio (os baldes que se rateiam). */
const CHAVES = new Set(["PRODUCAO", "PROJETO", "METALURGIA", "ARMADURA", "ACOMPANHAMENTO"]);

/**
 * Os valores dos grupos que ficam fora de todas as unidades (13/10/2026): por chave e mês, a soma dos valores dos grupos
 * de rateio num mês em que a chave não tem base nas premissas (todo custo e despesa deve ir para algum lugar). O
 * acompanhamento conta só nas contas da CSM, que são as que ele rateia.
 */
export function rateiosSemBase(grupos: GrupoDoCenario[], valores: Array<{ grupo: string; codigo: string; mes: number; valor: number }>, percentuais: Percentuais[]) {
  const porGrupo = new Map(grupos.map((g) => [g.grupo, g]));
  const r = new Map<string, { chave: string; mes: number; valor: number }>();
  for (const x of valores) {
    const g = porGrupo.get(x.grupo);
    if (!g?.balde || !CHAVES.has(g.balde) || !x.valor) continue;
    const sigla = x.codigo.split(".")[0];
    if (DESPESAS.has(sigla) || (g.balde === "ACOMPANHAMENTO" ? sigla !== "CSM" : sigla !== "CPP")) continue;
    const soma = [...(percentuais[x.mes - 1] ?? new Map())].filter(([k]) => k.startsWith(`${g.balde}|`)).reduce((a, [, p]) => a + p, 0);
    if (soma > 0) continue;
    const k = `${g.balde}|${x.mes}`;
    r.set(k, { chave: g.balde, mes: x.mes, valor: (r.get(k)?.valor ?? 0) + x.valor });
  }
  return [...r.values()].sort((a, b) => a.chave.localeCompare(b.chave) || a.mes - b.mes);
}

/**
 * Aloca os valores dos grupos às unidades (13/10/2026): devolve, por unidade e conta da DRE ("u|código"), os doze
 * meses. `valores`: por grupo, conta (código) e mês (1 a 12).
 */
export function alocarCentros(est: LinhaEstrutura[], grupos: GrupoDoCenario[], valores: Array<{ grupo: string; codigo: string; mes: number; valor: number }>, percentuais: Percentuais[]) {
  const porCodigo = new Map(est.map((l) => [l.codigo, l]));
  const porTripla = new Map(est.filter((l) => l.tipo === "ITEM").map((l) => [`${l.grupoSigla}|${(l.atribuicao ?? "").toUpperCase()}|${l.descricao.toUpperCase()}`, l]));
  const equivalente = (l: LinhaEstrutura, grupo: string) => porTripla.get(`${grupo}|${(l.atribuicao ?? "").toUpperCase()}|${l.descricao.toUpperCase()}`);
  const porGrupo = new Map(grupos.map((g) => [g.grupo, g]));
  const r = new Map<string, number[]>();
  const somar = (u: number, codigo: string | undefined, mes: number, v: number) => {
    if (!codigo || !v) return;
    const k = `${u}|${codigo}`;
    const lista = r.get(k) ?? Array<number>(12).fill(0);
    lista[mes - 1] += v;
    r.set(k, lista);
  };
  for (const x of valores) {
    const g = porGrupo.get(x.grupo);
    const l = porCodigo.get(x.codigo);
    if (!g || !l) continue;
    const pct = (chave: string, destino: string) => percentuais[x.mes - 1]?.get(`${chave}|${destino}`) ?? 0;
    const sigla = l.codigo.split(".")[0];
    if (DESPESAS.has(sigla)) {
      somar(4, l.codigo, x.mes, x.valor);
    } else if (sigla === "CSM") {
      if (g.balde === "ACOMPANHAMENTO") {
        somar(3, l.codigo, x.mes, x.valor * pct("ACOMPANHAMENTO", "MONTAGEM"));
        somar(3, equivalente(l, "CSC")?.codigo, x.mes, x.valor * pct("ACOMPANHAMENTO", "COMPLEMENTAR"));
        // O acompanhamento com percentual fixo na Matriz ou na Filial (14/10/2026): na conta de produção equivalente.
        somar(1, equivalente(l, "CPP")?.codigo, x.mes, x.valor * pct("ACOMPANHAMENTO", "MATRIZ"));
        somar(2, equivalente(l, "CPP")?.codigo, x.mes, x.valor * pct("ACOMPANHAMENTO", "FILIAL"));
      } else somar(3, l.codigo, x.mes, x.valor);
    } else if (sigla === "CPP") {
      switch (g.balde) {
        case "MATRIZ":
          somar(1, l.codigo, x.mes, x.valor);
          break;
        case "FILIAL":
          somar(2, l.codigo, x.mes, x.valor);
          break;
        case "PRODUCAO":
        case "PROJETO":
          somar(1, l.codigo, x.mes, x.valor * pct(g.balde, "MATRIZ"));
          somar(2, l.codigo, x.mes, x.valor * pct(g.balde, "FILIAL"));
          // Com percentual fixo em Serviços (14/10/2026): na conta equivalente da montagem e da complementar.
          somar(3, equivalente(l, "CSM")?.codigo, x.mes, x.valor * pct(g.balde, "MONTAGEM"));
          somar(3, equivalente(l, "CSC")?.codigo, x.mes, x.valor * pct(g.balde, "COMPLEMENTAR"));
          break;
        case "METALURGIA":
        case "ARMADURA":
          somar(1, l.codigo, x.mes, x.valor * pct(g.balde, "MATRIZ"));
          somar(2, l.codigo, x.mes, x.valor * pct(g.balde, "FILIAL"));
          // Em Serviços, na conta de mesma atribuição e descrição (sem ela, como no fechamento, a parte não entra).
          somar(3, equivalente(l, "CSM")?.codigo, x.mes, x.valor * pct(g.balde, "MONTAGEM"));
          somar(3, equivalente(l, "CSC")?.codigo, x.mes, x.valor * pct(g.balde, "COMPLEMENTAR"));
          break;
        case "OBRAS":
          somar(3, equivalente(l, "CSM")?.codigo, x.mes, x.valor);
          break;
        default:
          somar(g.unidade, l.codigo, x.mes, x.valor);
      }
    }
  }
  return r;
}
