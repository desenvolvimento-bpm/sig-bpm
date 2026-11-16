import { getPrismaClient } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { ACESSO_TOTAL, type Acesso } from "../acesso/acesso.js";
import { podeVerMovimentos } from "../acesso/recorteDepartamento.js";
import { ehContaDeCentro } from "../cenarios/centrosCenario.js";
import type { LinhaEstrutura } from "./apuracaoUnidades.js";
import { estrutura, RegraDREError } from "./dreService.js";
import { linhasDaObra } from "./obrasService.js";
import { basesDoConsolidadoDoMes, comParticipacoes } from "./participacoesDoMes.js";

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;
const zero = () => new Decimal(0);
const rotulo = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;

/**
 * Os movimentos sem centro de custo (aba Sem Centros de Custo de Resultados Empresariais, 14/10/2026): os lançamentos do
 * balancete que deveriam ter um centro de custo e não têm um do cadastro — pela regra da referência realizada dos
 * cenários analíticos, os das contas de mão de obra e de gastos gerais diretos, indiretos e comerciais (MOD, MOI, GGD,
 * GGI e GGC) sem centro (ou com um centro fora do cadastro, como os de obra). Os Gastos Gerais Variáveis ficam de fora:
 * nos analíticos, vêm das premissas por linha.
 *
 * Os lançamentos se agrupam pelo departamento da conta na DRE e, na Produção e nas Despesas Variáveis de Venda, pela
 * filial do lançamento. Os valores são os da classificação congelada com a apuração, antes de qualquer rateio.
 */
export const GRUPOS_SEM_CENTRO = [
  { codigo: "PRODUCAO_MATRIZ", nome: "Produção (Matriz)" },
  { codigo: "PRODUCAO_FILIAL", nome: "Produção (Filial)" },
  { codigo: "DVV_MATRIZ", nome: "Despesas Variáveis de Venda (Matriz)" },
  { codigo: "DVV_FILIAL", nome: "Despesas Variáveis de Venda (Filial)" },
  { codigo: "SERVICOS", nome: "Serviços" },
  { codigo: "LOGISTICA", nome: "Logística" },
  { codigo: "TECNICO", nome: "Técnico" },
  { codigo: "COMERCIAL", nome: "Comercial" },
  { codigo: "ADMINISTRATIVO", nome: "Administrativo" },
] as const;
export type GrupoSemCentro = (typeof GRUPOS_SEM_CENTRO)[number]["codigo"];
export const ehGrupoSemCentro = (g: string): g is GrupoSemCentro => GRUPOS_SEM_CENTRO.some((x) => x.codigo === g);
export const nomeDoGrupoSemCentro = (g: string) => GRUPOS_SEM_CENTRO.find((x) => x.codigo === g)?.nome ?? g;

/** O grupo de um lançamento sem centro: o departamento da conta na DRE (e a filial, na Produção e na DVV). */
export function grupoSemCentro(codigoDaLinha: string, filial: number): GrupoSemCentro | null {
  switch (codigoDaLinha.split(".")[0]) {
    case "CPP":
      return filial === 2 ? "PRODUCAO_FILIAL" : "PRODUCAO_MATRIZ";
    case "DVV":
      return filial === 2 ? "DVV_FILIAL" : "DVV_MATRIZ";
    case "CSM":
    case "CSC":
      return "SERVICOS";
    case "DL":
      return "LOGISTICA";
    case "DT":
      return "TECNICO";
    case "DC":
      return "COMERCIAL";
    case "DA":
      return "ADMINISTRATIVO";
    default:
      return null;
  }
}

/** O lançamento entra na aba: sem centro do cadastro, numa conta (ITEM) de mão de obra ou de gastos gerais de centros. */
export const deveriaTerCentro = (l: { tipo: string; codigo: string }) => l.tipo === "ITEM" && ehContaDeCentro(l.codigo);

/** O Coordenador (recorte por centro de custo, sem o por departamento) não vê a aba: ela não tem centros dele. */
export const veSemCentros = (acesso: Acesso) => !acesso.recorteCentro || acesso.recorteDepartamento;

async function competencia(ano: number, mes: number) {
  const c = await getPrismaClient().competencia.findUnique({ where: { ano_mes: { ano, mes } }, select: { id: true, status: true } });
  if (!c) throw new RegraDREError(404, `A competência ${rotulo(ano, mes)} não existe.`);
  return c;
}

async function apuracao(competenciaId: string) {
  return getPrismaClient().resultadoApurado.findFirst({ where: { competenciaId, unidadeNegocioId: null, centroCustoId: null }, select: { apuradoEm: true, congelado: true } });
}

/** Os lançamentos sem centro do mês, nas linhas que o usuário alcança, agrupados por grupo e linha. */
async function movimentos(competenciaId: string, linhas: LinhaEstrutura[], acesso: Acesso) {
  const porId = new Map(linhas.filter((l) => deveriaTerCentro(l) && podeVerMovimentos(acesso, l)).map((l) => [l.id, l]));
  const ls = await getPrismaClient().lancamentoContabil.findMany({
    // O redistribuído (13/11/2026) não fica sem centro: vai aos centros dos destinos.
    where: { competenciaId, centroCustoId: null, redistribuicaoId: null, linhaDREId: { in: [...porId.keys()] } },
    select: { filial: true, linhaDREId: true, valorMovimento: true },
  });
  const grupos = new Map<GrupoSemCentro, Map<string, { valor: Decimal; n: number }>>();
  for (const m of ls) {
    const l = porId.get(m.linhaDREId!);
    const g = l ? grupoSemCentro(l.codigo, m.filial) : null;
    if (!l || !g) continue;
    const itens = grupos.get(g) ?? new Map<string, { valor: Decimal; n: number }>();
    const a = itens.get(l.codigo) ?? { valor: zero(), n: 0 };
    itens.set(l.codigo, { valor: a.valor.plus(m.valorMovimento), n: a.n + 1 });
    grupos.set(g, itens);
  }
  return grupos;
}

const totalDe = (itens: Map<string, { valor: Decimal }>) => [...itens.values()].reduce((s, a) => s.plus(a.valor), zero());

export const semCentroService = {
  /** Os grupos com lançamento sem centro no mês, na ordem da lista, com o total de cada um. */
  async listar(ano: number, mes: number, acesso: Acesso = ACESSO_TOTAL) {
    const c = await competencia(ano, mes);
    const ap = await apuracao(c.id);
    // Desde a importação do balancete (15/10/2026; antes, só depois da apuração).
    const grupos = veSemCentros(acesso) ? await movimentos(c.id, await estrutura(), acesso) : new Map();
    return {
      competencia: { ano, mes, status: c.status },
      apuradoEm: ap?.apuradoEm ?? null,
      grupos: GRUPOS_SEM_CENTRO.flatMap((g) => {
        const itens = grupos.get(g.codigo);
        return itens && itens.size ? [{ codigo: g.codigo, nome: g.nome, total: totalDe(itens).toFixed(2) }] : [];
      }),
    };
  },

  /** A DRE de um grupo no mês: as contas sem centro e os totais que as somam. */
  async consultar(ano: number, mes: number, grupo: GrupoSemCentro, acesso: Acesso = ACESSO_TOTAL) {
    if (!veSemCentros(acesso)) throw new RegraDREError(403, "Os movimentos sem centro de custo não são do seu recorte.");
    const c = await competencia(ano, mes);
    const ap = await apuracao(c.id);
    const linhas = await estrutura();
    const itens = (await movimentos(c.id, linhas, acesso)).get(grupo);
    if (!itens?.size) throw new RegraDREError(404, `Nenhum lançamento sem centro de custo em ${nomeDoGrupoSemCentro(grupo)} em ${rotulo(ano, mes)}.`);
    return {
      competencia: { ano, mes, status: c.status },
      grupo: { codigo: grupo, nome: nomeDoGrupoSemCentro(grupo) },
      apuradoEm: ap?.apuradoEm ?? null,
      congelado: ap?.congelado ?? false,
      // O % e o R$/m³ (13/11/2026), sobre as bases do Consolidado, como nos Resultados Empresariais.
      linhas: comParticipacoes(linhasDaObra(linhas, itens, false, acesso), "centros", await basesDoConsolidadoDoMes(c.id)),
    };
  },
};
