import { getPrismaClient } from "../../config/prisma.js";
import type { MarcacaoCenario, OrigemDesligamento, VinculoColaborador } from "../../generated/prisma/enums.js";
import { auditar } from "../auditoriaService.js";
import { plural } from "../../utils/plural.js";
import { chaveDoNome } from "./importacaoCadastros.js";
import { recusaDaFuncao } from "./funcaoPorSenioridade.js";
import { gruposDoCadastro, type GrupoDoCenario } from "../cenarios/centrosCenario.js";
import type { Acesso } from "../acesso/acesso.js";
import { podeVerCentro } from "../acesso/recorteDepartamento.js";
import { colaboradoresPorCentro, comparacaoDoQuadroService } from "./comparacaoDoQuadro.js";

/**
 * O recorte (06/11/2026, etapa 3): quem tem recorte por departamento ou por centro de custo só vê, nas abas Movimentações,
 * Controle e Realizado, as dos centros que alcança (como nas movimentações da DRE). O Painel de Bordo fica inteiro.
 */
const doRecorte = (acesso: Acesso | undefined, centro: { id: string; departamento: string | null }) => !acesso || podeVerCentro(acesso, centro);

/**
 * O Quadro de Lotação da Gestão de Colaboradores (06/11/2026, pedido do Adão; etapa 2).
 *
 * - **Competências próprias:** abertas e fechadas aqui, fora do Fechamento Mensal. Só a aberta recebe movimentações (e
 *   aprovações); fechar exige nenhuma pendente.
 * - **Movimentações:** uma por colaborador ou vaga, com a data dentro do mês da competência. A aprovação vem do tipo
 *   (Cadastros › Movimentações): Automática nasce Aprovada; Manual nasce Pendente, até o Controle aprovar ou reprovar. Um
 *   desligamento (contagem Negativa) pede a Origem e, com "Gerar Vaga em Aberto", cria a Abertura de Vaga com os mesmos
 *   dados (sem a Origem e a Classificação), já aprovada.
 * - **O quadro:** o saldo inicial é o Lançamento Inicial, no mês dele, ou o saldo final da competência anterior; o final
 *   soma as movimentações aprovadas de contagem Positiva e subtrai as de Negativa (as Nulas, as vagas, não mudam o quadro).
 *   Por centro de custo e vínculo (CLT ou PJ).
 * - **Indicadores (Painel de Bordo):** Quadro de Lotação = o saldo final; Turnover = (Positivas + Negativas) ÷ 2 ÷ Quadro de
 *   Lotação; Abertura de Vagas x Contratações = as contratações (as Positivas aprovadas).
 */

export class QuadroError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

type Db = ReturnType<typeof getPrismaClient>;
type Quem = { id: string; nome: string | null };
const mesAno = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;
const ordem = (c: { ano: number; mes: number }) => c.ano * 12 + c.mes;

export function lerAnoMes(anoMes: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(anoMes);
  const mes = m ? Number(m[2]) : 0;
  if (!m || mes < 1 || mes > 12) throw new QuadroError(400, "Competência inválida: use aaaa-mm.");
  return { ano: Number(m[1]), mes };
}

async function competencia(db: Db, anoMes: string) {
  const { ano, mes } = lerAnoMes(anoMes);
  const c = await db.colaboradorCompetencia.findUnique({ where: { ano_mes: { ano, mes } } });
  if (!c) throw new QuadroError(404, `A competência ${mesAno(ano, mes)} do Quadro de Lotação não está aberta.`);
  return c;
}
function exigirAberta(c: { ano: number; mes: number; status: string }) {
  if (c.status !== "ABERTA") throw new QuadroError(409, `A competência ${mesAno(c.ano, c.mes)} está fechada: reabra-a para mudar as movimentações.`);
}

// --------------------------------------------------------------------------------------------------------- o quadro
/** A contagem de um quadro: por centro de custo e vínculo ("centroId|CLT"). */
export type Contagem = Map<string, number>;
const somar = (q: Contagem, chave: string, n: number) => q.set(chave, (q.get(chave) ?? 0) + n);
const total = (q: Contagem) => [...q.values()].reduce((a, b) => a + b, 0);

/** Quem entra na contagem: o centro e o vínculo (e, para o QL Realizado por linha, a função e a senioridade). */
type ItemDoQuadro = { centroCustoId: string; vinculo: VinculoColaborador; funcaoId?: string; senioridadeId?: string };
export type MovimentoDoQuadro = ItemDoQuadro & { contagem: "POSITIVA" | "NEGATIVA" | "NULA"; status: string; tipo: string };
/** A chave da contagem: o centro e o vínculo ("centroId|CLT"). */
const porCentroEVinculo = (i: ItemDoQuadro) => `${i.centroCustoId}|${i.vinculo}`;
export type QuadroDoMes = {
  ano: number;
  mes: number;
  inicial: Contagem;
  final: Contagem;
  positivas: number;
  negativas: number;
  /** As aprovadas de cada tipo de movimentação (o nome do tipo): os Movimentos do QL. */
  porTipo: Record<string, number>;
};

/**
 * O quadro de cada competência, em ordem: o inicial (o Lançamento Inicial no mês dele, senão o final da anterior) e o final,
 * com as movimentações aprovadas. Uma função pura, para os testes: `carga` é o Lançamento Inicial (o mês e os
 * colaboradores), `movimentos`, as movimentações de cada competência. `chave` agrupa a contagem (o centro e o vínculo;
 * 11/11/2026: com a função e a senioridade, o QL Realizado das linhas dos cenários).
 */
export function calcularQuadros(
  competencias: Array<{ ano: number; mes: number }>,
  carga: { ano: number; mes: number; itens: ItemDoQuadro[] } | null,
  movimentos: (c: { ano: number; mes: number }) => MovimentoDoQuadro[],
  chave: (i: ItemDoQuadro) => string = porCentroEVinculo,
): QuadroDoMes[] {
  const ordenadas = [...competencias].sort((a, b) => ordem(a) - ordem(b));
  const quadros: QuadroDoMes[] = [];
  let anterior: Contagem = new Map();
  for (const c of ordenadas) {
    let inicial: Contagem;
    if (carga && ordem(carga) === ordem(c)) {
      inicial = new Map();
      for (const i of carga.itens) somar(inicial, chave(i), 1);
    } else if (carga && ordem(c) < ordem(carga)) {
      // Antes do Lançamento Inicial, o quadro não tem base: só as movimentações do mês.
      inicial = new Map();
    } else inicial = new Map(anterior);
    const final = new Map(inicial);
    let positivas = 0;
    let negativas = 0;
    const porTipo: Record<string, number> = {};
    for (const m of movimentos(c)) {
      if (m.status !== "APROVADA") continue;
      porTipo[m.tipo] = (porTipo[m.tipo] ?? 0) + 1;
      if (m.contagem === "POSITIVA") {
        positivas++;
        somar(final, chave(m), 1);
      } else if (m.contagem === "NEGATIVA") {
        negativas++;
        somar(final, chave(m), -1);
      }
    }
    quadros.push({ ano: c.ano, mes: c.mes, inicial, final, positivas, negativas, porTipo });
    anterior = final;
  }
  return quadros;
}

/** Os indicadores do mês, como no Painel de Bordo. */
export function indicadoresDoMes(q: QuadroDoMes) {
  const quadro = total(q.final);
  return {
    quadroDeLotacao: quadro,
    turnover: quadro ? (q.positivas + q.negativas) / 2 / quadro : null,
    contratacoes: q.positivas,
    positivas: q.positivas,
    negativas: q.negativas,
  };
}

/** Os quadros de todas as competências, do banco. */
async function quadrosDoBanco(db: Db) {
  const [competencias, cargaItens, movs] = await Promise.all([
    db.colaboradorCompetencia.findMany({ select: { id: true, ano: true, mes: true } }),
    db.colaboradorCargaInicial.findMany({ select: { ano: true, mes: true, centroCustoId: true, vinculo: true } }),
    db.colaboradorMovimentacao.findMany({
      select: { competenciaId: true, centroCustoId: true, vinculo: true, status: true, tipoMovimentacao: { select: { contagem: true, nome: true } } },
    }),
  ]);
  const carga = cargaItens.length ? { ano: cargaItens[0].ano, mes: cargaItens[0].mes, itens: cargaItens } : null;
  const idDe = new Map(competencias.map((c) => [ordem(c), c.id]));
  const porCompetencia = new Map<string, MovimentoDoQuadro[]>();
  for (const m of movs) {
    const lista = porCompetencia.get(m.competenciaId) ?? [];
    lista.push({ centroCustoId: m.centroCustoId, vinculo: m.vinculo, status: m.status, contagem: m.tipoMovimentacao.contagem, tipo: m.tipoMovimentacao.nome });
    porCompetencia.set(m.competenciaId, lista);
  }
  return calcularQuadros(competencias, carga, (c) => porCompetencia.get(idDe.get(ordem(c)) ?? "") ?? []);
}

/**
 * O QL Realizado da competência mais recente do Quadro de Lotação (11/11/2026, o Exportar Premissas dos cenários com a
 * referência realizada): os colaboradores do fim do mês por centro de custo, vínculo, função e senioridade
 * ("centroId|CLT|funcaoId|senioridadeId"); nulo sem competência.
 */
export async function quadroRealizadoMaisRecente(db: Db) {
  const [competencias, cargaItens, movs] = await Promise.all([
    db.colaboradorCompetencia.findMany({ select: { id: true, ano: true, mes: true } }),
    db.colaboradorCargaInicial.findMany({ select: { ano: true, mes: true, centroCustoId: true, vinculo: true, funcaoId: true, senioridadeId: true } }),
    db.colaboradorMovimentacao.findMany({
      select: { competenciaId: true, centroCustoId: true, vinculo: true, funcaoId: true, senioridadeId: true, status: true, tipoMovimentacao: { select: { contagem: true, nome: true } } },
    }),
  ]);
  if (!competencias.length) return null;
  const carga = cargaItens.length ? { ano: cargaItens[0].ano, mes: cargaItens[0].mes, itens: cargaItens } : null;
  const porCompetencia = new Map<string, MovimentoDoQuadro[]>();
  for (const m of movs) porCompetencia.set(m.competenciaId, [...(porCompetencia.get(m.competenciaId) ?? []), { ...m, contagem: m.tipoMovimentacao.contagem, tipo: m.tipoMovimentacao.nome }]);
  const idDe = new Map(competencias.map((c) => [ordem(c), c.id]));
  const quadros = calcularQuadros(competencias, carga, (c) => porCompetencia.get(idDe.get(ordem(c)) ?? "") ?? [], chaveDaLinhaDoQuadro);
  const ultimo = quadros.at(-1)!;
  return { ano: ultimo.ano, mes: ultimo.mes, final: ultimo.final };
}
/** A chave do QL Realizado por linha: o centro, o vínculo, a função e a senioridade. */
export const chaveDaLinhaDoQuadro = (i: { centroCustoId: string; vinculo: string; funcaoId?: string; senioridadeId?: string }) =>
  `${i.centroCustoId}|${i.vinculo}|${i.funcaoId ?? ""}|${i.senioridadeId ?? ""}`;

/** Os quadros guardados por 10 segundos: os indicadores do ano pedem um mês de cada vez. */
let guardados: { em: number; quadros: Promise<QuadroDoMes[]> } | null = null;
function quadrosGuardados(db: Db) {
  if (!guardados || Date.now() - guardados.em > 10_000) guardados = { em: Date.now(), quadros: quadrosDoBanco(db) };
  return guardados.quadros;
}

/** Os grupos de centros (a classificação dos cenários) guardados por 60 segundos: a consulta lê os lançamentos. */
let gruposEmCache: { em: number; grupos: Promise<GrupoDoCenario[]> } | null = null;
function gruposGuardados() {
  if (!gruposEmCache || Date.now() - gruposEmCache.em > 60_000) gruposEmCache = { em: Date.now(), grupos: gruposDoCadastro() };
  return gruposEmCache.grupos;
}

/**
 * Os departamentos do Quadro de Lotação de um grupo de centros (09/11/2026), pela classificação dos cenários (a mesma dos
 * "Quadro de Lotação: MO …"): os custos de produção (CPP) na Matriz ou na Filial (pelo balde, ou a filial em que o grupo mais
 * lançou) e na Produção: Geral; os de montagem (CSM) em Serviços; as despesas pelo departamento (DL, DT, DC, DA).
 */
export function departamentosDoGrupo(g: Pick<GrupoDoCenario, "grupoDRE" | "balde" | "unidade">): string[] {
  switch (g.grupoDRE) {
    case "CPP":
      return [g.balde === "MATRIZ" ? "PRODUCAO_MATRIZ" : g.balde === "FILIAL" ? "PRODUCAO_FILIAL" : g.unidade === 2 ? "PRODUCAO_FILIAL" : "PRODUCAO_MATRIZ", "PRODUCAO_GERAL"];
    case "CSM":
      return ["SERVICOS"];
    case "DL":
      return ["LOGISTICA"];
    case "DT":
      return ["TECNICO"];
    case "DC":
      return ["COMERCIAL"];
    case "DA":
      return ["ADMINISTRATIVO"];
    default:
      return [];
  }
}

/**
 * O Quadro de Lotação de um mês para os indicadores (os itens [QL] e [MQL] da Metodologia): no fim do mês, o de cada
 * departamento (DEP|<departamento>|GERAL, DIRETA ou INDIRETA; a atribuição e o departamento pelo grupo dos centros, como nos
 * cenários; Geral = Direto + Indireto, e o Total conta todos) e o de cada centro (CC|<código RM>); e as movimentações
 * aprovadas de cada tipo, ou todas as de uma contagem (#POSITIVA, #NEGATIVA). Null sem a competência do Quadro de Lotação no mês.
 */
export async function valoresDoQuadro(ano: number, mes: number) {
  const db = getPrismaClient();
  const q = (await quadrosGuardados(db)).find((x) => x.ano === ano && x.mes === mes);
  if (!q) return null;
  const ids = [...new Set([...q.final.keys()].map((k) => k.split("|")[0]))];
  const [centros, grupos] = await Promise.all([db.centroCusto.findMany({ where: { id: { in: ids } }, select: { id: true, codigoRM: true } }), gruposGuardados()]);
  const codigoDe = new Map(centros.map((c) => [c.id, c.codigoRM]));
  const grupoDoCodigo = new Map(grupos.flatMap((g) => g.centros.filter((c) => c.codigo).map((c) => [c.codigo!, g] as const)));
  const porChave = new Map<string, number>();
  for (const [k, n] of q.final) {
    somar(porChave, "DEP|TOTAL|GERAL", n);
    const codigo = codigoDe.get(k.split("|")[0]);
    if (codigo) somar(porChave, `CC|${codigo}`, n);
    const g = codigo ? grupoDoCodigo.get(codigo) : undefined;
    if (!g?.atribuicao) continue;
    somar(porChave, `DEP|TOTAL|${g.atribuicao}`, n);
    for (const d of departamentosDoGrupo(g)) {
      somar(porChave, `DEP|${d}|GERAL`, n);
      somar(porChave, `DEP|${d}|${g.atribuicao}`, n);
    }
  }
  return {
    quadro: (chave: string) => porChave.get(chave) ?? 0,
    movimentos: (tipo: string) => (tipo === "#POSITIVA" ? q.positivas : tipo === "#NEGATIVA" ? q.negativas : (q.porTipo[tipo] ?? 0)),
  };
}

// --------------------------------------------------------------------------------------------------- as movimentações
const INCLUIR = {
  tipoMovimentacao: { select: { nome: true, contagem: true, aprovacao: true } },
  classificacao: { select: { nome: true } },
  centroCusto: { select: { codigoRM: true, nomeRM: true, departamento: true } },
  funcao: { select: { nome: true } },
  senioridade: { select: { nome: true } },
  geradaPor: { select: { id: true } },
  vagasGeradas: { select: { id: true } },
} as const;
type MovimentacaoLida = Awaited<ReturnType<Db["colaboradorMovimentacao"]["findMany"]>>[number] & {
  tipoMovimentacao: { nome: string; contagem: string; aprovacao: string };
  classificacao: { nome: string } | null;
  centroCusto: { codigoRM: string | null; nomeRM: string; departamento: string | null };
  funcao: { nome: string };
  senioridade: { nome: string };
  geradaPor: { id: string } | null;
  vagasGeradas: Array<{ id: string }>;
};
const centroRotulo = (c: { codigoRM: string | null; nomeRM: string }) => `${c.codigoRM ? `${c.codigoRM} · ` : ""}${c.nomeRM}`;
function apresentar(m: MovimentacaoLida) {
  return {
    id: m.id,
    data: m.data.toISOString().slice(0, 10),
    tipo: m.tipoMovimentacao.nome,
    contagem: m.tipoMovimentacao.contagem,
    aprovacao: m.tipoMovimentacao.aprovacao,
    classificacao: m.classificacao?.nome ?? null,
    centroCustoId: m.centroCustoId,
    centroCusto: centroRotulo(m.centroCusto),
    departamento: m.centroCusto.departamento,
    vinculo: m.vinculo,
    funcao: m.funcao.nome,
    senioridade: m.senioridade.nome,
    motivo: m.motivo,
    origem: m.origem,
    status: m.status,
    geradaPorDesligamento: !!m.geradaPor,
    vagaGerada: m.vagasGeradas.length > 0,
    registradaPorNome: m.registradaPorNome,
    registradaEm: m.registradaEm.toISOString(),
    decididaPorNome: m.decididaPorNome,
    decididaEm: m.decididaEm?.toISOString() ?? null,
    justificativa: m.justificativa,
  };
}

export type NovaMovimentacao = {
  tipoMovimentacaoId: string;
  classificacaoId?: string | null;
  data: string;
  centroCustoId: string;
  vinculo: VinculoColaborador;
  funcaoId: string;
  senioridadeId: string;
  motivo?: string | null;
  origem?: OrigemDesligamento | null;
  gerarVaga?: boolean;
};

export const quadroService = {
  // ------------------------------------------------------------------------------------------------- as competências
  async competencias() {
    const db = getPrismaClient();
    const [lista, contagens, pendentes, quadros, carga] = await Promise.all([
      db.colaboradorCompetencia.findMany({ orderBy: [{ ano: "desc" }, { mes: "desc" }] }),
      db.colaboradorMovimentacao.groupBy({ by: ["competenciaId"], _count: { _all: true } }),
      db.colaboradorMovimentacao.groupBy({ by: ["competenciaId"], where: { status: "PENDENTE" }, _count: { _all: true } }),
      quadrosDoBanco(db),
      db.colaboradorCargaInicial.findFirst({ select: { ano: true, mes: true } }),
    ]);
    const n = new Map(contagens.map((c) => [c.competenciaId, c._count._all]));
    const p = new Map(pendentes.map((c) => [c.competenciaId, c._count._all]));
    const doMes = new Map(quadros.map((q) => [ordem(q), q]));
    return {
      lancamentoInicial: carga ? mesAno(carga.ano, carga.mes) : null,
      itens: lista.map((c) => {
        const q = doMes.get(ordem(c));
        return {
          id: c.id,
          ano: c.ano,
          mes: c.mes,
          status: c.status,
          abertaEm: c.abertaEm.toISOString(),
          abertaPorNome: c.abertaPorNome,
          fechadaEm: c.fechadaEm?.toISOString() ?? null,
          fechadaPorNome: c.fechadaPorNome,
          movimentacoes: n.get(c.id) ?? 0,
          pendentes: p.get(c.id) ?? 0,
          quadroInicial: q ? total(q.inicial) : 0,
          quadroFinal: q ? total(q.final) : 0,
        };
      }),
    };
  },

  async abrir(ano: number, mes: number, quem: Quem) {
    if (!Number.isInteger(ano) || ano < 2000 || ano > 2100 || !Number.isInteger(mes) || mes < 1 || mes > 12) throw new QuadroError(400, "Mês ou ano inválido.");
    const db = getPrismaClient();
    if (await db.colaboradorCompetencia.findUnique({ where: { ano_mes: { ano, mes } } })) throw new QuadroError(409, `A competência ${mesAno(ano, mes)} já está aberta.`);
    const c = await db.colaboradorCompetencia.create({ data: { ano, mes, abertaPorNome: quem.nome } });
    await auditar({ usuarioId: quem.id, acao: "ABERTURA", entidade: "colaborador_competencia", entidadeId: c.id, metadados: { competencia: mesAno(ano, mes) } });
    return c;
  },

  async fechar(anoMes: string, quem: Quem) {
    const db = getPrismaClient();
    const c = await competencia(db, anoMes);
    if (c.status === "FECHADA") throw new QuadroError(409, `A competência ${mesAno(c.ano, c.mes)} já está fechada.`);
    const pendentes = await db.colaboradorMovimentacao.count({ where: { competenciaId: c.id, status: "PENDENTE" } });
    if (pendentes) {
      throw new QuadroError(409, `A competência tem ${pendentes} ${plural(pendentes, "movimentação pendente", "movimentações pendentes")}: aprove ou reprove no Controle antes de fechar.`);
    }
    await db.colaboradorCompetencia.update({ where: { id: c.id }, data: { status: "FECHADA", fechadaEm: new Date(), fechadaPorNome: quem.nome } });
    await auditar({ usuarioId: quem.id, acao: "FECHAMENTO", entidade: "colaborador_competencia", entidadeId: c.id, metadados: { competencia: mesAno(c.ano, c.mes) } });
  },

  async reabrir(anoMes: string, quem: Quem) {
    const db = getPrismaClient();
    const c = await competencia(db, anoMes);
    if (c.status === "ABERTA") throw new QuadroError(409, `A competência ${mesAno(c.ano, c.mes)} já está aberta.`);
    await db.colaboradorCompetencia.update({ where: { id: c.id }, data: { status: "ABERTA", fechadaEm: null, fechadaPorNome: null } });
    await auditar({ usuarioId: quem.id, acao: "REABERTURA", entidade: "colaborador_competencia", entidadeId: c.id, metadados: { competencia: mesAno(c.ano, c.mes) } });
  },

  /** Exclui a competência sem movimentações (aberta por engano). */
  async excluir(anoMes: string, quem: Quem) {
    const db = getPrismaClient();
    const c = await competencia(db, anoMes);
    const n = await db.colaboradorMovimentacao.count({ where: { competenciaId: c.id } });
    if (n) throw new QuadroError(409, `A competência tem ${n} ${plural(n, "movimentação", "movimentações")}: exclua-as antes.`);
    await db.colaboradorCompetencia.delete({ where: { id: c.id } });
    await auditar({ usuarioId: quem.id, acao: "EXCLUSAO", entidade: "colaborador_competencia", entidadeId: c.id, metadados: { competencia: mesAno(c.ano, c.mes) } });
  },

  // ------------------------------------------------------------------------------------------------ as movimentações
  /** As listas do modal Nova Movimentação: só os cadastros ativos. */
  async opcoes() {
    const db = getPrismaClient();
    const [tipos, classificacoes, centros, funcoes, senioridades] = await Promise.all([
      db.colaboradorTipoMovimentacao.findMany({ where: { ativo: true }, orderBy: [{ ordem: "asc" }, { nome: "asc" }], select: { id: true, nome: true, contagem: true, aprovacao: true } }),
      db.colaboradorClassificacao.findMany({ where: { ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true, tipoMovimentacaoId: true } }),
      db.centroCusto.findMany({ where: { ativo: true }, orderBy: [{ codigoRM: "asc" }, { nomeRM: "asc" }], select: { id: true, codigoRM: true, nomeRM: true } }),
      db.colaboradorFuncao.findMany({ where: { ativo: true }, orderBy: [{ nome: "asc" }, { senioridade: { nome: "asc" } }], select: { id: true, nome: true, senioridadeId: true } }),
      db.colaboradorSenioridade.findMany({ where: { ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
    ]);
    return { tipos, classificacoes, centros: centros.map((c) => ({ id: c.id, nome: centroRotulo(c) })), funcoes, senioridades };
  },

  async movimentacoes(anoMes: string, acesso?: Acesso) {
    const db = getPrismaClient();
    const c = await competencia(db, anoMes);
    const lista = (await db.colaboradorMovimentacao.findMany({ where: { competenciaId: c.id }, include: INCLUIR, orderBy: [{ data: "asc" }, { registradaEm: "asc" }] })) as MovimentacaoLida[];
    return {
      competencia: { ano: c.ano, mes: c.mes, status: c.status },
      itens: lista.filter((m) => doRecorte(acesso, { id: m.centroCustoId, departamento: m.centroCusto.departamento })).map(apresentar),
    };
  },

  async registrar(anoMes: string, v: NovaMovimentacao, quem: Quem) {
    const db = getPrismaClient();
    const c = await competencia(db, anoMes);
    exigirAberta(c);
    const data = new Date(`${v.data}T00:00:00Z`);
    if (Number.isNaN(data.getTime()) || data.getUTCFullYear() !== c.ano || data.getUTCMonth() + 1 !== c.mes) {
      throw new QuadroError(400, `A data da movimentação precisa estar em ${mesAno(c.ano, c.mes)}.`);
    }
    const [tipo, classificacao, centro, funcao, senioridade] = await Promise.all([
      db.colaboradorTipoMovimentacao.findUnique({ where: { id: v.tipoMovimentacaoId } }),
      v.classificacaoId ? db.colaboradorClassificacao.findUnique({ where: { id: v.classificacaoId } }) : null,
      db.centroCusto.findUnique({ where: { id: v.centroCustoId }, select: { id: true, ativo: true } }),
      db.colaboradorFuncao.findUnique({ where: { id: v.funcaoId }, select: { id: true, ativo: true, nome: true, senioridadeId: true, senioridade: { select: { nome: true } } } }),
      db.colaboradorSenioridade.findUnique({ where: { id: v.senioridadeId }, select: { id: true, ativo: true } }),
    ]);
    if (!tipo?.ativo) throw new QuadroError(400, "Escolha um tipo de movimentação ativo.");
    if (v.classificacaoId && (!classificacao?.ativo || classificacao.tipoMovimentacaoId !== tipo.id)) throw new QuadroError(400, `A classificação não é de ${tipo.nome}.`);
    if (!centro?.ativo) throw new QuadroError(400, "Escolha um centro de custo ativo.");
    if (!funcao?.ativo) throw new QuadroError(400, "Escolha uma função ativa.");
    if (!senioridade?.ativo) throw new QuadroError(400, "Escolha uma senioridade ativa.");
    // A função da senioridade (11/11/2026: a mesma função tem uma por senioridade).
    const recusaDaSenioridade = recusaDaFuncao(funcao, senioridade.id);
    if (recusaDaSenioridade) throw new QuadroError(400, recusaDaSenioridade);
    if (v.vinculo !== "CLT" && v.vinculo !== "PJ") throw new QuadroError(400, "O tipo é CLT ou PJ.");
    const desligamento = tipo.contagem === "NEGATIVA";
    if (desligamento && !v.origem) throw new QuadroError(400, "Escolha a origem do desligamento.");
    // A vaga em aberto: o tipo Abertura de Vaga do cadastro.
    const tipoVaga =
      desligamento && v.gerarVaga
        ? (await db.colaboradorTipoMovimentacao.findMany({ where: { ativo: true } })).find((t) => chaveDoNome(t.nome) === chaveDoNome("Abertura de Vaga"))
        : null;
    if (desligamento && v.gerarVaga && !tipoVaga) throw new QuadroError(400, "Para gerar a vaga em aberto, o cadastro precisa da movimentação Abertura de Vaga, ativa.");

    const base = {
      competenciaId: c.id,
      data,
      centroCustoId: centro.id,
      vinculo: v.vinculo,
      funcaoId: funcao.id,
      senioridadeId: senioridade.id,
      motivo: v.motivo?.trim() || null,
      registradaPor: quem.id,
      registradaPorNome: quem.nome,
    };
    const criada = await db.$transaction(async (tx) => {
      const m = await tx.colaboradorMovimentacao.create({
        data: {
          ...base,
          tipoMovimentacaoId: tipo.id,
          classificacaoId: classificacao?.id ?? null,
          origem: desligamento ? v.origem : null,
          status: tipo.aprovacao === "AUTOMATICA" ? "APROVADA" : "PENDENTE",
          ...(tipo.aprovacao === "AUTOMATICA" ? { decididaEm: new Date(), decididaPorNome: "Automática" } : {}),
        },
      });
      // A vaga do desligamento: aprovada por padrão.
      if (tipoVaga) {
        await tx.colaboradorMovimentacao.create({
          data: { ...base, tipoMovimentacaoId: tipoVaga.id, status: "APROVADA", decididaEm: new Date(), decididaPorNome: "Automática", geradaPorId: m.id },
        });
      }
      return m;
    });
    await auditar({
      usuarioId: quem.id,
      acao: "CRIACAO",
      entidade: "colaborador_movimentacao",
      entidadeId: criada.id,
      depois: { tipo: tipo.nome, data: v.data, centroCustoId: centro.id, vinculo: v.vinculo, status: criada.status, vagaGerada: !!tipoVaga },
      metadados: { competencia: mesAno(c.ano, c.mes) },
    });
    return criada;
  },

  async excluirMovimentacao(id: string, quem: Quem) {
    const db = getPrismaClient();
    const m = (await db.colaboradorMovimentacao.findUnique({ where: { id }, include: { ...INCLUIR, competencia: true } })) as (MovimentacaoLida & { competencia: { ano: number; mes: number; status: string } }) | null;
    if (!m) throw new QuadroError(404, "Movimentação não encontrada.");
    exigirAberta(m.competencia);
    // A vaga gerada sai junto com o desligamento (onDelete: Cascade).
    await db.colaboradorMovimentacao.delete({ where: { id } });
    await auditar({ usuarioId: quem.id, acao: "EXCLUSAO", entidade: "colaborador_movimentacao", entidadeId: id, antes: apresentar(m), metadados: { competencia: mesAno(m.competencia.ano, m.competencia.mes) } });
  },

  // ------------------------------------------------------------------------------------------------------- o controle
  /** As movimentações de aprovação manual da competência (Pendentes, Aprovadas e Reprovadas). */
  async controle(anoMes: string, acesso?: Acesso) {
    const db = getPrismaClient();
    const c = await competencia(db, anoMes);
    const lista = (await db.colaboradorMovimentacao.findMany({
      where: { competenciaId: c.id, OR: [{ tipoMovimentacao: { aprovacao: "MANUAL" } }, { status: { in: ["PENDENTE", "REPROVADA"] } }], geradaPorId: null },
      include: INCLUIR,
      orderBy: [{ data: "asc" }, { registradaEm: "asc" }],
    })) as MovimentacaoLida[];
    return {
      competencia: { ano: c.ano, mes: c.mes, status: c.status },
      itens: lista.filter((m) => doRecorte(acesso, { id: m.centroCustoId, departamento: m.centroCusto.departamento })).map(apresentar),
    };
  },

  async decidir(id: string, aprovar: boolean, justificativa: string | null, quem: Quem, acesso?: Acesso) {
    const db = getPrismaClient();
    const m = await db.colaboradorMovimentacao.findUnique({
      where: { id },
      include: { competencia: true, tipoMovimentacao: { select: { nome: true } }, centroCusto: { select: { id: true, departamento: true } } },
    });
    if (!m) throw new QuadroError(404, "Movimentação não encontrada.");
    // O gestor decide as dos centros que alcança.
    if (!doRecorte(acesso, m.centroCusto)) throw new QuadroError(404, "Movimentação não encontrada.");
    exigirAberta(m.competencia);
    if (m.status !== "PENDENTE") throw new QuadroError(409, "A movimentação já foi decidida.");
    await db.colaboradorMovimentacao.update({
      where: { id },
      data: { status: aprovar ? "APROVADA" : "REPROVADA", decididaEm: new Date(), decididaPorNome: quem.nome, justificativa: aprovar ? null : justificativa?.trim() || null },
    });
    await auditar({
      usuarioId: quem.id,
      acao: aprovar ? "APROVACAO" : "REPROVACAO",
      entidade: "colaborador_movimentacao",
      entidadeId: id,
      metadados: { competencia: mesAno(m.competencia.ano, m.competencia.mes), tipo: m.tipoMovimentacao.nome, justificativa },
    });
  },

  // ------------------------------------------------------------------------------------------------------ o realizado
  /** O quadro realizado da competência, por centro de custo: o inicial, as entradas, as saídas e o final (CLT e PJ). */
  /**
   * A aba Realizado. Com a Comparação (09/11/2026, `marcacao`: o cenário marcado), cada centro traz os colaboradores do mês na
   * aba Quadro de Lotação do cenário (nos analíticos com linhas; os centros só do cenário entram, com o realizado zero).
   */
  async realizado(anoMes: string, acesso?: Acesso, marcacao?: MarcacaoCenario) {
    const db = getPrismaClient();
    const c = await competencia(db, anoMes);
    const quadros = await quadrosDoBanco(db);
    const q = quadros.find((x) => ordem(x) === ordem(c));
    const movs = await db.colaboradorMovimentacao.findMany({
      where: { competenciaId: c.id, status: "APROVADA" },
      select: { centroCustoId: true, tipoMovimentacao: { select: { contagem: true } } },
    });
    const cenario = marcacao ? await comparacaoDoQuadroService.cenarioDaMarcacao(marcacao) : null;
    const doCenario = cenario ? await colaboradoresPorCentro(cenario) : null;
    const ids = new Set<string>([
      ...(q ? [...q.inicial.keys(), ...q.final.keys()] : []).map((k) => k.split("|")[0]),
      ...movs.map((m) => m.centroCustoId),
      ...[...(doCenario ?? new Map<string, number[]>())].filter(([, vs]) => vs[c.mes - 1]).map(([id]) => id),
    ]);
    const centros = await db.centroCusto.findMany({ where: { id: { in: [...ids] } }, select: { id: true, codigoRM: true, nomeRM: true, departamento: true, atribuicao: true } });
    const contar = (quadro: Contagem | undefined, id: string, vinculo?: string) =>
      [...(quadro ?? new Map()).entries()].filter(([k]) => k.startsWith(`${id}|`) && (!vinculo || k.endsWith(`|${vinculo}`))).reduce((a, [, n]) => a + n, 0);
    const linhas = centros
      .map((ct) => ({
        centroCustoId: ct.id,
        centroCusto: centroRotulo(ct),
        departamento: ct.departamento,
        atribuicao: ct.atribuicao === "DIRETA" ? "Direta" : ct.atribuicao === "INDIRETA" ? "Indireta" : null,
        inicial: contar(q?.inicial, ct.id),
        entradas: movs.filter((m) => m.centroCustoId === ct.id && m.tipoMovimentacao.contagem === "POSITIVA").length,
        saidas: movs.filter((m) => m.centroCustoId === ct.id && m.tipoMovimentacao.contagem === "NEGATIVA").length,
        final: contar(q?.final, ct.id),
        clt: contar(q?.final, ct.id, "CLT"),
        pj: contar(q?.final, ct.id, "PJ"),
        cenario: doCenario ? (doCenario.get(ct.id)?.[c.mes - 1] ?? 0) : null,
      }))
      .filter((l) => l.inicial || l.entradas || l.saidas || l.final || l.cenario)
      .filter((l) => doRecorte(acesso, { id: l.centroCustoId, departamento: l.departamento }))
      .sort((a, b) => a.centroCusto.localeCompare(b.centroCusto, "pt-BR"));
    return {
      competencia: { ano: c.ano, mes: c.mes, status: c.status },
      linhas,
      indicadores: q ? indicadoresDoMes(q) : null,
      // Os indicadores dos meses do ano até este (09/11/2026): o acumulado da Comparação, como no Painel de Bordo.
      doAno: quadros.filter((x) => x.ano === c.ano && x.mes <= c.mes).map((x) => ({ mes: x.mes, ...indicadoresDoMes(x) })),
      comparacao: cenario ? { cenario: { nome: cenario.nome, ano: cenario.ano, analitico: cenario.tipo === "ANALITICO" }, porCentro: doCenario !== null } : null,
    };
  },

  // ------------------------------------------------------------------------------------------------- o painel de bordo
  /** Os indicadores de cada competência do ano (Painel de Bordo), com os anos que têm competência. */
  async painel(ano: number) {
    const db = getPrismaClient();
    const quadros = await quadrosDoBanco(db);
    const anos = [...new Set(quadros.map((q) => q.ano))].sort((a, b) => b - a);
    const doAno = quadros.filter((q) => q.ano === ano);
    return {
      ano,
      anos,
      meses: doAno.map((q) => ({ mes: q.mes, ...indicadoresDoMes(q), porTipo: q.porTipo })),
    };
  },
};
