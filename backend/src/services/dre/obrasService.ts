import { getPrismaClient } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { NaturezaReceita } from "../../generated/prisma/enums.js";
import { ACESSO_TOTAL, type Acesso } from "../acesso/acesso.js";
import { podeVerLinhaNaObra, podeVerSensiveis } from "../acesso/recorteDepartamento.js";
import type { LinhaEstrutura } from "./apuracaoUnidades.js";
import { avaliarEstrutura, soSoma } from "./consolidacao.js";
import { estrutura, RegraDREError } from "./dreService.js";
import { volumesDasObras } from "./volumesDaLinhaService.js";
import { numeroDaObra } from "../resultadosLinha/alocacaoNasLinhas.js";
import { codigoQueVale } from "../classificacao/centrosObra.js";
import { basesDasLinhas, comParticipacoes } from "./participacoesDoMes.js";
export { codigoQueVale } from "../classificacao/centrosObra.js";

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;
const zero = () => new Decimal(0);
const rotulo = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;

/**
 * A DRE por obra (aba Obras da DRE, pedido de 09/10/2026): os lançamentos do
 * balancete nos centros de custo de obra — 1.98 (obras com montagem) e 1.99
 * (obras de venda da Matriz e da Filial) —, pela linha da DRE em que foram
 * classificados, antes de qualquer rateio. Todos os tipos de movimento entram:
 * receita operacional, impostos, custos, despesas e receitas e despesas
 * financeiras. O grupo Produção e Serviços (PS) vem das listas operacionais
 * (30/10/2026, pedido do Adão): os volumes da obra (`volumesDasObras`), e a
 * obra só com volume no mês também se consulta.
 *
 * Os centros de obra não estão no cadastro de centros de custo: a obra é
 * identificada pelo código do centro no RM, como veio no balancete, e o nome
 * é o do balancete. Não há gravação própria na apuração: a classificação dos
 * lançamentos fica congelada com ela (classificacaoService), então a soma dos
 * lançamentos é a da apuração.
 *
 * Como na DRE das unidades, as receitas (ROB e receitas financeiras) aparecem
 * com o sinal trocado — positivas — e os custos e despesas positivos. O
 * balancete não tem a receita líquida por natureza (na DRE das unidades ela
 * sai da receita prévia): na obra, a Receita Operacional Líquida é a ROB menos
 * os impostos (IRB), e dela saem as margens até o Resultado Líquido, que é o
 * resultado da obra no mês — o valor na lista das obras.
 *
 * As receitas da obra (03/11/2026, pedido do Adão), como na DRE das unidades: as contas de Reconhecimento do CPV ficam
 * de fora (no centro de obra, elas anulam o faturamento da obra — 44635 com 7061, 50305 com 44701 —, porque a DRE
 * reconhece a receita na produção, num lançamento sem obra); a receita prévia de frete da obra sai da Receita Bruta do
 * Pré-Fabricado e vai à de Frete; a complementar sai da de Montagem e vai à Complementar. A tabela da obra não
 * mostra esses totais calculados (pedido de 09/10/2026): a primeira ROL, o CPV,
 * a MB, a MC, o EBITDA, o EBIT, o NOPAT e o RL (CALCULADOS). No recorte do Gestor por departamento, só as
 * linhas dos departamentos dele, com os totais que só somam (como nos centros); no do Coordenador (com a opção de
 * ver as obras, 11/10/2026), as da gestão dele, também com os totais que só somam.
 */

export const CENTRO_DE_OBRA = /^1\.9[89]\./;
const ehCentroDeObra = (codigo: string | null): codigo is string => !!codigo && CENTRO_DE_OBRA.test(codigo);

/**
 * Os movimentos cujo centro que vale (codigoQueVale, 13/11/2026) é o do filtro (o código ou um começo dele). O redistribuído
 * vai aos centros dos destinos (as partes), e não à obra.
 */
export const ondeOCentroVale = (f: string | Prisma.StringFilter): Prisma.LancamentoContabilWhereInput => ({
  redistribuicaoId: null,
  OR: [{ centroCustoId: null, codigoCentroCusto: f }, { centroCusto: { codigoRM: f } }],
});

/** As linhas cuja movimentação entra com o sinal trocado: as receitas. */
const RECEITAS = new Set(["ROB", "RFC", "RFNC"]);
export const sinalDaLinha = (codigo: string) => (RECEITAS.has(codigo.split(".")[0]) ? -1 : 1);

const ROB = "ROB.RECEITA_OPERACIONAL_BRUTA_ROB";
const IRB = "IRB.IMPOSTOS_SOBRE_A_RECEITA_BRUTA_IRB";
const ROL = "ROL.RECEITA_OPERACIONAL_LIQUIDA_ROL";
const RL = "RL.RESULTADO_LIQUIDO_RL";

/** Os totais calculados que a tabela da obra não mostra (a primeira ROL, CPV, margens e resultados). */
const CALCULADOS = new Set([
  "RO.RECEITA_OPERACIONAL_LIQUIDA_ROL",
  "CPV.CUSTO_DE_PRODUTO_VENDIDO_CPV",
  "MB.MARGEM_BRUTA_MB",
  "MC.MARGEM_DE_CONTRIBUICAO_MC",
  "EBITDA.LUCRO_OPERACIONAL_EBITDA",
  "EBIT.MARGEM_LIQUIDA_EBIT",
  "NOPAT.LUCRO_OPERACIONAL_LIQUIDO_NOPAT",
  RL,
]);

/** As contas de Reconhecimento do CPV (7061, 44701 e 7692), que ficam fora das receitas da obra (03/11/2026). */
export const ehReconhecimentoDoCpv = (descricao: string) => descricao.toUpperCase().includes("RECONHECIMENTO DO CPV");
/** O lançamento que a obra não leva: o de uma conta de Reconhecimento do CPV numa linha de receita (pela conta que vale). */
export const foraDaObra = (codigoDaLinha: string, conta: { descricao: string }) => codigoDaLinha.startsWith("ROB.") && ehReconhecimentoDoCpv(conta.descricao);
/** Os ids das contas de Reconhecimento do CPV (a lista das obras os usa: ler a descrição de cada lançamento custa ~0,4 s no ano). */
async function contasDoReconhecimentoDoCpv() {
  const cs = await getPrismaClient().contaResultado.findMany({ where: { descricao: { contains: "RECONHECIMENTO DO CPV", mode: "insensitive" } }, select: { id: true, descricao: true } });
  return new Set(cs.filter((c) => ehReconhecimentoDoCpv(c.descricao)).map((c) => c.id));
}

/** A receita prévia que muda a obra: a de frete sai do Pré-Fabricado e vai ao Frete; a complementar sai da Montagem e vai à Complementar. */
export const PREVIAS_DA_OBRA = [
  { natureza: "FRETE", item: "ROB.RBF.RECEITA_BRUTA_DE_FRETE", de: "ROB.RBPF.RECEITA_BRUTA_DO_PRE_FABRICADO" },
  { natureza: "COMPLEMENTAR", item: "ROB.RBC.RECEITA_BRUTA_COMPLEMENTAR", de: "ROB.RBM.RECEITA_BRUTA_DE_MONTAGEM" },
] as const satisfies ReadonlyArray<{ natureza: NaturezaReceita; item: string; de: string }>;
/** A receita prévia bruta de uma obra: por natureza (frete e complementar) e unidade. */
export type PreviasDaObra = Map<NaturezaReceita, Map<number, Decimal>>;

type Movimento = {
  codigoCentroCusto: string | null;
  nomeCentroCusto: string | null;
  linhaDREId: string | null;
  valorMovimento: Decimal;
  contaResultadoId: string;
  contaAdotadaId: string | null;
};

/** Os itens de uma obra (com o sinal da DRE), e os subtotais e totais pela estrutura. */
export function linhasDaObra(linhas: LinhaEstrutura[], itens: Map<string, { valor: Decimal; n: number }>, completa: boolean, acesso: Acesso = ACESSO_TOTAL) {
  // As contas com soma zero no mês ficam de fora, como nos centros.
  itens = new Map([...itens].filter(([, a]) => !a.valor.isZero()));
  const diretos = new Map([...itens].map(([c, a]) => [c, a.valor]));
  let totais: Map<string, Decimal>;
  if (completa) {
    // A ROL da obra é a ROB menos os impostos; com ela, as margens e o resultado pela estrutura.
    const somas = avaliarEstrutura(linhas, diretos, soSoma);
    const rol = (somas.get(ROB) ?? zero()).minus(somas.get(IRB) ?? zero());
    const comRol = new Map(diretos);
    if (!rol.isZero()) comRol.set(ROL, rol);
    totais = avaliarEstrutura(linhas, comRol, () => true);
    if (!rol.isZero()) totais.set(ROL, rol);
  } else {
    totais = avaliarEstrutura(linhas, diretos, soSoma);
  }
  return linhas
    .filter((l) => l.tipo === "SECAO" || itens.has(l.codigo) || (l.tipo !== "ITEM" && !(totais.get(l.codigo) ?? zero()).isZero()))
    .map((l) => {
      const item = itens.get(l.codigo);
      const valor = item?.valor ?? totais.get(l.codigo) ?? null;
      return {
        codigo: l.codigo,
        tipo: l.tipo,
        grupo: l.grupo,
        grupoSigla: l.grupoSigla,
        descricao: l.descricao,
        valor: l.tipo === "SECAO" ? null : (valor?.toFixed(2) ?? null),
        composicao: null,
        // Sem o Acesso a Informações Sensíveis (27/10/2026), as linhas de Mão de Obra Direta e Indireta sem a lupa.
        podeDetalhar: podeVerSensiveis(acesso, l),
      };
    });
}

async function competencia(ano: number, mes: number) {
  const c = await getPrismaClient().competencia.findUnique({ where: { ano_mes: { ano, mes } }, select: { id: true, status: true } });
  if (!c) throw new RegraDREError(404, `A competência ${rotulo(ano, mes)} não existe.`);
  return c;
}

/** A apuração da DRE do mês (a data e se está congelada), ou null se ainda não foi apurada. */
async function apuracao(competenciaId: string) {
  const r = await getPrismaClient().resultadoApurado.findFirst({ where: { competenciaId, unidadeNegocioId: null, centroCustoId: null }, select: { apuradoEm: true, congelado: true } });
  return r;
}

/** Os lançamentos dos centros de obra no mês, nas linhas que o usuário alcança, agrupados por obra e linha. */
async function movimentos(competenciaId: string, linhas: LinhaEstrutura[], acesso: Acesso, obra?: string) {
  const [ls, cpv]: [Movimento[], Set<string>] = await Promise.all([
    getPrismaClient().lancamentoContabil.findMany({
      // Pelo centro que vale (13/11/2026): sem os movimentos que saíram da obra pela contestação, pela reclassificação por
      // fornecedor ou pela redistribuição.
      where: { competenciaId, linhaDREId: { not: null }, ...(obra ? ondeOCentroVale(obra) : { OR: [ondeOCentroVale({ startsWith: "1.98." }), ondeOCentroVale({ startsWith: "1.99." })] }) },
      select: { codigoCentroCusto: true, nomeCentroCusto: true, centroCustoId: true, centroCusto: { select: { codigoRM: true, nomeRM: true } }, linhaDREId: true, valorMovimento: true, contaResultadoId: true, contaAdotadaId: true },
    }).then((ms) => ms.map(({ centroCusto, centroCustoId, ...m }) => ({ ...m, codigoCentroCusto: codigoQueVale({ ...m, centroCustoId, centroCusto }), nomeCentroCusto: centroCusto?.nomeRM ?? m.nomeCentroCusto }))),
    contasDoReconhecimentoDoCpv(),
  ]);
  const porId = new Map(linhas.filter((l) => podeVerLinhaNaObra(acesso, l)).map((l) => [l.id, l]));
  const obras = new Map<string, { nomes: Map<string, number>; itens: Map<string, { valor: Decimal; n: number }> }>();
  for (const m of ls) {
    if (!ehCentroDeObra(m.codigoCentroCusto)) continue;
    const l = porId.get(m.linhaDREId!);
    // Nas receitas, sem as contas de Reconhecimento do CPV (pela conta que vale: a adotada, se houver).
    if (!l || (l.codigo.startsWith("ROB.") && cpv.has(m.contaAdotadaId ?? m.contaResultadoId))) continue;
    const o = obras.get(m.codigoCentroCusto) ?? { nomes: new Map<string, number>(), itens: new Map<string, { valor: Decimal; n: number }>() };
    const nome = m.nomeCentroCusto?.trim();
    if (nome) o.nomes.set(nome, (o.nomes.get(nome) ?? 0) + 1);
    const a = o.itens.get(l.codigo) ?? { valor: zero(), n: 0 };
    o.itens.set(l.codigo, { valor: a.valor.plus(m.valorMovimento.times(sinalDaLinha(l.codigo))), n: a.n + 1 });
    obras.set(m.codigoCentroCusto, o);
  }
  // O nome mais frequente no mês (o balancete repete o nome em cada lançamento).
  const nomeDe = (o: { nomes: Map<string, number> }, codigo: string) => [...o.nomes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? codigo;
  return [...obras].map(([codigo, o]) => ({ codigo, nome: nomeDe(o, codigo), itens: o.itens }));
}

/**
 * Os volumes da obra no mês (30/10/2026, pedido do Adão): as linhas do grupo PS (P e S) que o usuário alcança, das listas
 * operacionais, pelo número da obra (o do centro 1.98 ou 1.99).
 */
async function volumesDaObra(competenciaId: string, linhas: LinhaEstrutura[], acesso: Acesso, obra: string) {
  const numero = numeroDaObra(obra);
  const alcancadas = new Set(linhas.filter((l) => podeVerLinhaNaObra(acesso, l)).map((l) => l.codigo));
  const vs = (await volumesDasObras(competenciaId, linhas, numero)).get(numero) ?? new Map<string, Decimal>();
  return new Map([...vs].filter(([codigo, v]) => alcancadas.has(codigo) && !v.isZero()).map(([codigo, v]) => [codigo, { valor: v, n: 1 }]));
}

/** A receita prévia bruta de frete e complementar das obras no mês (de uma, com o número), pelo número da obra. */
export async function previasDasObras(competenciaId: string, numero?: string) {
  const itens = await getPrismaClient().receitaPreviaItem.findMany({
    where: { receitaPrevia: { competenciaId, natureza: { in: PREVIAS_DA_OBRA.map((p) => p.natureza) } }, obraCodigo: numero ? { endsWith: numero } : { not: null } },
    select: { obraCodigo: true, receitaBruta: true, receitaPrevia: { select: { natureza: true, unidadeNegocio: { select: { codigo: true } } } } },
  });
  const obras = new Map<string, PreviasDaObra>();
  for (const i of itens) {
    const n = numeroDaObra(i.obraCodigo);
    if (!n || (numero && n !== numero) || i.receitaBruta.isZero()) continue;
    const o = obras.get(n) ?? new Map();
    const porUnidade = o.get(i.receitaPrevia.natureza) ?? new Map<number, Decimal>();
    const u = i.receitaPrevia.unidadeNegocio.codigo;
    porUnidade.set(u, (porUnidade.get(u) ?? zero()).plus(i.receitaBruta));
    o.set(i.receitaPrevia.natureza, porUnidade);
    obras.set(n, o);
  }
  return obras;
}

/**
 * A receita prévia de uma obra (o centro 1.98 ou 1.99). A obra com os dois centros no mês (rara: uma em 2026) a leva no
 * 1.98, a obra com montagem, para não contar duas vezes.
 */
export async function previasDaObra(competenciaId: string, obra: string) {
  if (obra.startsWith("1.99.")) {
    const irma = await getPrismaClient().lancamentoContabil.findFirst({ where: { competenciaId, linhaDREId: { not: null }, ...ondeOCentroVale(obra.replace(/^1\.99\./, "1.98.")) }, select: { id: true } });
    if (irma) return undefined;
  }
  const numero = numeroDaObra(obra);
  return (await previasDasObras(competenciaId, numero)).get(numero);
}

/** Leva a receita prévia da obra aos itens dela (no sinal da DRE): o frete sai do Pré-Fabricado e vai ao Frete; a complementar, da Montagem à Complementar. */
export function comAsPrevias(itens: Map<string, { valor: Decimal; n: number }>, previas: PreviasDaObra | undefined) {
  if (!previas) return itens;
  const r = new Map(itens);
  const somar = (codigo: string, v: Decimal) => {
    const a = r.get(codigo) ?? { valor: zero(), n: 0 };
    r.set(codigo, { valor: a.valor.plus(v), n: a.n + 1 });
  };
  for (const p of PREVIAS_DA_OBRA) {
    const v = [...(previas.get(p.natureza)?.values() ?? [])].reduce((s, x) => s.plus(x), zero());
    if (v.isZero()) continue;
    somar(p.de, v.negated());
    somar(p.item, v);
  }
  return r;
}

/**
 * As receitas e os impostos de uma obra (o número) em cada competência, no modelo da aba Obras (03/11/2026, o Realizado por
 * Obra): os lançamentos dos centros de obra dela (1.98 e 1.99) nas linhas da ROB e dos impostos (IRB), sem as contas de
 * Reconhecimento do CPV, no sinal da DRE. Também os centros da obra com lançamento no mês (em qualquer linha), com quantos
 * lançamentos cada um tem. A receita prévia de frete e complementar fica com quem chama.
 */
export async function receitasDaObra(competenciaIds: string[], numero: string) {
  const [ls, cpv] = await Promise.all([
    getPrismaClient()
      .lancamentoContabil.findMany({
        where: { competenciaId: { in: competenciaIds }, linhaDREId: { not: null }, ...ondeOCentroVale({ endsWith: numero }) },
        select: { competenciaId: true, codigoCentroCusto: true, centroCustoId: true, centroCusto: { select: { codigoRM: true } }, valorMovimento: true, contaResultadoId: true, contaAdotadaId: true, linhaDRE: { select: { codigo: true } } },
      })
      .then((ms) => ms.map(({ centroCusto, centroCustoId, ...m }) => ({ ...m, codigoCentroCusto: codigoQueVale({ ...m, centroCustoId, centroCusto }) }))),
    contasDoReconhecimentoDoCpv(),
  ]);
  const r = new Map(competenciaIds.map((id) => [id, { receitas: new Map<string, number>(), centros: new Map<string, number>() }]));
  for (const m of ls) {
    if (!ehCentroDeObra(m.codigoCentroCusto) || numeroDaObra(m.codigoCentroCusto) !== numero || !m.linhaDRE) continue;
    const x = r.get(m.competenciaId)!;
    x.centros.set(m.codigoCentroCusto, (x.centros.get(m.codigoCentroCusto) ?? 0) + 1);
    const codigo = m.linhaDRE.codigo;
    if (!codigo.startsWith("ROB.") && !codigo.startsWith("IRB.")) continue;
    if (codigo.startsWith("ROB.") && cpv.has(m.contaAdotadaId ?? m.contaResultadoId)) continue;
    x.receitas.set(codigo, (x.receitas.get(codigo) ?? 0) + Number(m.valorMovimento) * sinalDaLinha(codigo));
  }
  return r;
}

/** O total da obra na lista: o Resultado Líquido; no recorte, a soma das linhas que o usuário vê. */
function totalDa(linhas: Array<{ codigo: string; tipo: string; valor: string | null }>) {
  const rl = linhas.find((l) => l.codigo === RL);
  if (rl?.valor) return rl.valor;
  return linhas.filter((l) => l.tipo === "ITEM").reduce((s, l) => s.plus(l.valor ?? 0), zero()).toFixed(2);
}

export const obrasService = {
  /** As obras com lançamento no mês, em ordem de nome, com o total de cada uma. */
  async listar(ano: number, mes: number, acesso: Acesso = ACESSO_TOTAL) {
    const c = await competencia(ano, mes);
    const ap = await apuracao(c.id);
    const linhas = await estrutura();
    // Desde a importação do balancete (15/10/2026; antes, só depois da apuração): os lançamentos dos centros de obra.
    const [obras, previas] = await Promise.all([movimentos(c.id, linhas, acesso), previasDasObras(c.id)]);
    const completa = !acesso.recorteDepartamento && !acesso.recorteCentro;
    // A receita prévia vai ao 1.98 quando a obra tem os dois centros no mês (previasDaObra).
    const de98 = new Set(obras.filter((o) => o.codigo.startsWith("1.98.")).map((o) => numeroDaObra(o.codigo)));
    const previasDe = (codigo: string) => (codigo.startsWith("1.99.") && de98.has(numeroDaObra(codigo)) ? undefined : previas.get(numeroDaObra(codigo)));
    return {
      competencia: { ano, mes, status: c.status },
      apuradoEm: ap?.apuradoEm ?? null,
      obras: obras
        .map((o) => ({ codigo: o.codigo, nome: o.nome, total: totalDa(linhasDaObra(linhas, comAsPrevias(o.itens, previasDe(o.codigo)), completa)) }))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR") || a.codigo.localeCompare(b.codigo)),
    };
  },

  /** A DRE de uma obra (o código do centro no RM). */
  async consultar(ano: number, mes: number, obra: string, acesso: Acesso = ACESSO_TOTAL) {
    if (!CENTRO_DE_OBRA.test(obra)) throw new RegraDREError(400, `${obra} não é um centro de custo de obra (1.98 ou 1.99).`);
    const c = await competencia(ano, mes);
    const ap = await apuracao(c.id);
    const linhas = await estrutura();
    const [[o], volumes, previas] = await Promise.all([movimentos(c.id, linhas, acesso, obra), volumesDaObra(c.id, linhas, acesso, obra), previasDaObra(c.id, obra)]);
    if (!o && !volumes.size && !previas) throw new RegraDREError(404, `Nenhum lançamento nem volume da obra ${obra} em ${rotulo(ano, mes)}.`);
    const itens = comAsPrevias(new Map([...volumes, ...(o?.itens ?? [])]), previas);
    const daObra = linhasDaObra(linhas, itens, !acesso.recorteDepartamento && !acesso.recorteCentro, acesso);
    return {
      competencia: { ano, mes, status: c.status },
      obra: { codigo: obra, nome: o?.nome ?? obra },
      apuradoEm: ap?.apuradoEm ?? null,
      congelado: ap?.congelado ?? false,
      // O % e o R$/m³ (13/11/2026), sobre a receita e os volumes da própria obra (as bases antes de tirar os calculados).
      linhas: comParticipacoes(daObra, "obras", basesDasLinhas(daObra)).filter((l) => !CALCULADOS.has(l.codigo)),
    };
  },
};
