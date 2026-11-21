import { randomUUID } from "node:crypto";

import type { Prisma } from "../../generated/prisma/client.js";
import { nomeDasContas } from "../redistribuicoes/redistribuicoesService.js";
import { lerRealocacoes } from "./realocacoesCenario.js";
import { copiarRegras, trazerNovasRegras } from "./regrasDoCenario.js";
import { copiarBeneficios } from "./quadroDoCenario.js";

/**
 * Os cadastros de cada cenário analítico (20/11/2026, pedido do Adão: Cadastros por cenário): as cópias de Unidades, de Centros de
 * Custo (etapa 1), de Departamentos e de Redistribuições de Gastos (etapa 2) dos Cadastros Gerais, nas abas de mesmo nome das
 * Configurações. O cenário agrupa e aloca pelos centros da cópia (gruposDoCenario) e redistribui o realizado da referência pelas
 * redistribuições da cópia (redistribuicoesDoCenario.ts); o resto do SIG segue os Cadastros Gerais.
 *
 * Decisões do Adão (19/11/2026): a cópia é tirada na criação do cenário (os de antes, na migração de 20/11/2026) e não muda
 * sozinha — "Trazer Novos dos Cadastros Gerais" inclui o que surgiu depois, sem mexer no que foi editado; a revisão e a cópia de
 * um cenário levam as abas dele. Renomear um grupo (todos os centros dele para um nome novo) leva junto as premissas, os valores
 * dos centros, as justificativas e as realocações; o grupo que fica sem centros perde os valores (o SIG avisa antes de gravar).
 */

type Tx = Prisma.TransactionClient;

/** Grava em lotes (as cópias têm centenas de centros). */
async function emLotes<T>(itens: T[], gravar: (lote: T[]) => Promise<unknown>, tamanho = 500) {
  for (let i = 0; i < itens.length; i += tamanho) await gravar(itens.slice(i, i + tamanho));
}

/**
 * Tira a cópia de Unidades e de Centros de Custo para o cenário: a do cenário `de` (a revisão e a cópia de um cenário; sem cópia,
 * como um sintético, os Cadastros Gerais) ou, sem ele, a dos Cadastros Gerais de hoje. Devolve o centro da cópia de `de` → o da
 * cópia nova (para o Quadro de Lotação copiado).
 */
export async function copiarCadastros(tx: Tx, cenarioId: string, de: string | null): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const [unidadesDe, centrosDe] = de
    ? await Promise.all([tx.cenarioUnidade.findMany({ where: { cenarioId: de } }), tx.cenarioCentroCusto.findMany({ where: { cenarioId: de } })])
    : [[], []];
  if (unidadesDe.length) {
    await tx.cenarioUnidade.createMany({ data: unidadesDe.map(({ id: _id, criadoEm: _c, atualizadoEm: _a, ...u }) => ({ ...u, cenarioId })) });
  } else {
    const us = await tx.unidadeNegocio.findMany();
    await tx.cenarioUnidade.createMany({ data: us.map((u) => ({ cenarioId, unidadeNegocioId: u.id, nome: u.nome, ordem: u.ordem, ativo: u.ativo })) });
  }
  if (centrosDe.length) {
    const novos = centrosDe.map(({ id, criadoEm: _c, atualizadoEm: _a, ...c }) => {
      const novo = randomUUID();
      mapa.set(id, novo);
      return { ...c, id: novo, cenarioId };
    });
    await emLotes(novos, (lote) => tx.cenarioCentroCusto.createMany({ data: lote }));
  } else {
    const cs = await tx.centroCusto.findMany();
    await emLotes(
      cs.map((c) => {
        const novo = randomUUID();
        mapa.set(c.id, novo);
        return { ...camposDoCentroGeral(c, cenarioId), id: novo };
      }),
      (lote) => tx.cenarioCentroCusto.createMany({ data: lote }),
    );
  }
  // Os departamentos e as redistribuições (etapa 2): os do cenário `de`, quando ele tem as cópias (um analítico); senão, os dos
  // Cadastros Gerais. Os centros dos destinos vão pelo `mapa` (o centro de `de`, ou o dos Cadastros Gerais, → o da cópia nova).
  const deps = new Map<string, string>();
  if (de && centrosDe.length) {
    const ds = await tx.cenarioDepartamento.findMany({ where: { cenarioId: de } });
    await tx.cenarioDepartamento.createMany({
      data: ds.map(({ id, criadoEm: _c, atualizadoEm: _a, ...d }) => {
        const novo = randomUUID();
        deps.set(id, novo);
        return { ...d, id: novo, cenarioId };
      }),
    });
    const rs = await tx.cenarioRedistribuicao.findMany({ where: { cenarioId: de }, include: { destinos: true, contas: { orderBy: { ordem: "asc" } } } });
    await criarRedistribuicoes(
      tx,
      cenarioId,
      rs.map(({ id: _id, criadoEm: _c, atualizadoEm: _a, cenarioId: _ce, destinos, contas, ...r }) => ({
        ...r,
        departamentoId: r.departamentoId ? (deps.get(r.departamentoId) ?? null) : null,
        destinos,
        contas: contas.map((c) => ({ linhaDREId: c.linhaDREId, ordem: c.ordem })),
      })),
      mapa,
    );
  } else {
    const ds = await tx.departamento.findMany();
    await tx.cenarioDepartamento.createMany({
      data: ds.map((d) => {
        const novo = randomUUID();
        deps.set(d.id, novo);
        return { id: novo, cenarioId, origemId: d.id, unidadeNegocioId: d.unidadeNegocioId, nome: d.nome, gruposDRE: d.gruposDRE, ordem: d.ordem, ativo: d.ativo };
      }),
    });
    const rs = await tx.redistribuicaoGasto.findMany({ include: { destinos: true, contas: { orderBy: { ordem: "asc" } } } });
    await criarRedistribuicoes(
      tx,
      cenarioId,
      rs.map((r) => camposDaRedistribuicaoGeral(r, deps)),
      mapa,
    );
  }
  // As Regras de Rateio (21/11/2026): as do cenário `de`, quando ele tem a cópia; senão, as de Cadastros Gerais.
  await copiarRegras(tx, cenarioId, de);
  // Os Benefícios Padrão (21/11/2026): os do cenário `de`, antes do Quadro de Lotação (que os leva pelo nome).
  if (de) await copiarBeneficios(tx, de, cenarioId);
  return mapa;
}

type RedistribuicaoParaCopiar = Omit<Prisma.CenarioRedistribuicaoCreateManyInput, "id" | "cenarioId"> & {
  destinos: Array<{ centroCustoId: string; percentual: Prisma.Decimal; ordem: number }>;
  /** As contas da DRE (uma ou mais), na ordem. */
  contas: Array<{ linhaDREId: string; ordem: number }>;
};

/** Os campos da cópia de uma redistribuição dos Cadastros Gerais (o departamento pelo mapa das cópias). */
function camposDaRedistribuicaoGeral(r: Prisma.RedistribuicaoGastoGetPayload<{ include: { destinos: true; contas: true } }>, deps: Map<string, string>): RedistribuicaoParaCopiar {
  return {
    origemId: r.id,
    departamentoId: r.departamentoId ? (deps.get(r.departamentoId) ?? null) : null,
    fornecedores: r.fornecedores,
    vigenciaInicio: r.vigenciaInicio,
    vigenciaFim: r.vigenciaFim,
    descricao: r.descricao,
    ordem: r.ordem,
    ativo: r.ativo,
    destinos: r.destinos,
    contas: r.contas.map((c) => ({ linhaDREId: c.linhaDREId, ordem: c.ordem })),
  };
}

/**
 * Grava as redistribuições na cópia do cenário, com os destinos pelos centros da cópia (`centros`: o centro de origem → o da
 * cópia). Devolve a origem das que ficaram sem algum centro (não entram: os percentuais deixariam de somar 100%).
 */
async function criarRedistribuicoes(tx: Tx, cenarioId: string, rs: RedistribuicaoParaCopiar[], centros: Map<string, string>) {
  const semCentro: string[] = [];
  for (const { destinos, contas, ...r } of rs) {
    const ds = destinos.map((d) => ({ ...d, centroCustoId: centros.get(d.centroCustoId) }));
    if (ds.some((d) => !d.centroCustoId)) {
      semCentro.push(r.origemId ?? "");
      continue;
    }
    await tx.cenarioRedistribuicao.create({
      data: {
        ...r,
        cenarioId,
        contas: { create: contas },
        destinos: { create: ds.map((d) => ({ centroCustoId: d.centroCustoId!, percentual: d.percentual, ordem: d.ordem })) },
      },
    });
  }
  return semCentro;
}

/** Os campos da cópia de um centro dos Cadastros Gerais. */
function camposDoCentroGeral(
  c: {
    id: string;
    coligada: number | null;
    codigoRM: string | null;
    nomeRM: string;
    nomeControladoria: string | null;
    departamento: string | null;
    departamentoSigla: string | null;
    atribuicao: Prisma.CenarioCentroCustoCreateManyInput["atribuicao"];
    atribuicaoSigla: string | null;
    balde: Prisma.CenarioCentroCustoCreateManyInput["balde"];
    unidadeNegocioId: string | null;
    ordem: number;
    ativo: boolean;
  },
  cenarioId: string,
): Prisma.CenarioCentroCustoCreateManyInput {
  return {
    cenarioId,
    origemId: c.id,
    coligada: c.coligada,
    codigoRM: c.codigoRM,
    nomeRM: c.nomeRM,
    nomeControladoria: c.nomeControladoria,
    departamento: c.departamento,
    departamentoSigla: c.departamentoSigla,
    atribuicao: c.atribuicao,
    atribuicaoSigla: c.atribuicaoSigla,
    balde: c.balde,
    unidadeNegocioId: c.unidadeNegocioId,
    ordem: c.ordem,
    ativo: c.ativo,
  };
}

/**
 * Trazer Novos dos Cadastros Gerais (a decisão do Adão): inclui na cópia do cenário as unidades e os centros que surgiram nos
 * Cadastros Gerais depois dela (o centro que não tem cópia pela origem nem pelo código), sem mexer no que foi editado.
 */
export async function trazerNovosDosCadastros(tx: Tx, cenarioId: string) {
  const [unidades, minhasUnidades, centros, meusCentros] = await Promise.all([
    tx.unidadeNegocio.findMany(),
    tx.cenarioUnidade.findMany({ where: { cenarioId }, select: { unidadeNegocioId: true } }),
    tx.centroCusto.findMany(),
    tx.cenarioCentroCusto.findMany({ where: { cenarioId }, select: { origemId: true, codigoRM: true } }),
  ]);
  const temUnidade = new Set(minhasUnidades.map((u) => u.unidadeNegocioId));
  const novasUnidades = unidades.filter((u) => !temUnidade.has(u.id));
  if (novasUnidades.length) {
    await tx.cenarioUnidade.createMany({ data: novasUnidades.map((u) => ({ cenarioId, unidadeNegocioId: u.id, nome: u.nome, ordem: u.ordem, ativo: u.ativo })) });
  }
  const origens = new Set(meusCentros.flatMap((c) => (c.origemId ? [c.origemId] : [])));
  const codigos = new Set(meusCentros.flatMap((c) => (c.codigoRM ? [c.codigoRM] : [])));
  const novosCentros = centros.filter((c) => !origens.has(c.id) && !(c.codigoRM && codigos.has(c.codigoRM)));
  await emLotes(
    novosCentros.map((c) => camposDoCentroGeral(c, cenarioId)),
    (lote) => tx.cenarioCentroCusto.createMany({ data: lote }),
  );

  // Os departamentos (etapa 2): os que não têm cópia pela origem nem pelo nome na mesma unidade.
  const [departamentos, meusDepartamentos] = await Promise.all([
    tx.departamento.findMany({ include: { unidadeNegocio: { select: { nome: true } } } }),
    tx.cenarioDepartamento.findMany({ where: { cenarioId }, select: { id: true, origemId: true, unidadeNegocioId: true, nome: true } }),
  ]);
  const doNome = (d: { unidadeNegocioId: string; nome: string }) => `${d.unidadeNegocioId}|${d.nome.toLocaleLowerCase("pt-BR")}`;
  const depDaOrigem = new Map(meusDepartamentos.flatMap((d) => (d.origemId ? [[d.origemId, d.id] as const] : [])));
  const depDoNome = new Map(meusDepartamentos.map((d) => [doNome(d), d.id]));
  const novosDepartamentos = departamentos.filter((d) => !depDaOrigem.has(d.id) && !depDoNome.has(doNome(d)));
  for (const d of novosDepartamentos) {
    const novo = randomUUID();
    await tx.cenarioDepartamento.create({ data: { id: novo, cenarioId, origemId: d.id, unidadeNegocioId: d.unidadeNegocioId, nome: d.nome, gruposDRE: d.gruposDRE, ordem: d.ordem, ativo: d.ativo } });
    depDaOrigem.set(d.id, novo);
  }
  for (const d of departamentos) {
    const k = depDaOrigem.has(d.id) ? undefined : depDoNome.get(doNome(d));
    if (k) depDaOrigem.set(d.id, k);
  }

  // As redistribuições (etapa 2): as que não têm cópia pela origem, com os centros da cópia (pela origem ou pelo código).
  const [redistribuicoes, minhasRedistribuicoes, centrosDaCopia] = await Promise.all([
    tx.redistribuicaoGasto.findMany({ include: { destinos: true, contas: { orderBy: { ordem: "asc" }, include: { linhaDRE: { select: { descricao: true, grupoSigla: true, atribuicao: true } } } } } }),
    tx.cenarioRedistribuicao.findMany({ where: { cenarioId }, select: { origemId: true } }),
    tx.cenarioCentroCusto.findMany({ where: { cenarioId }, select: { id: true, origemId: true, codigoRM: true } }),
  ]);
  const jaCopiadas = new Set(minhasRedistribuicoes.flatMap((r) => (r.origemId ? [r.origemId] : [])));
  const daOrigem = new Map(centrosDaCopia.flatMap((c) => (c.origemId ? [[c.origemId, c.id] as const] : [])));
  const doCodigo = new Map(centrosDaCopia.flatMap((c) => (c.codigoRM ? [[c.codigoRM, c.id] as const] : [])));
  const centroDaCopia = new Map<string, string>();
  for (const c of centros) {
    const k = daOrigem.get(c.id) ?? (c.codigoRM ? doCodigo.get(c.codigoRM) : undefined);
    if (k) centroDaCopia.set(c.id, k);
  }
  const novasRedistribuicoes = redistribuicoes.filter((r) => !jaCopiadas.has(r.id));
  const semCentro = await criarRedistribuicoes(
    tx,
    cenarioId,
    novasRedistribuicoes.map((r) => camposDaRedistribuicaoGeral(r, depDaOrigem)),
    centroDaCopia,
  );
  const rotuloDaRegra = (r: (typeof redistribuicoes)[number]) =>
    `${nomeDasContas(r.contas.map((c) => c.linhaDRE))} (${r.fornecedores.length} ${r.fornecedores.length === 1 ? "fornecedor" : "fornecedores"})`;

  return {
    unidades: novasUnidades.map((u) => u.nome),
    centros: novosCentros.map((c) => `${c.codigoRM ? `${c.codigoRM} - ` : ""}${c.nomeRM}`),
    departamentos: novosDepartamentos.map((d) => `${d.nome} (${d.unidadeNegocio.nome})`),
    redistribuicoes: novasRedistribuicoes.filter((r) => !semCentro.includes(r.id)).map(rotuloDaRegra),
    // As Regras de Rateio (21/11/2026): as de Cadastros Gerais ainda sem cópia no cenário.
    regras: await trazerNovasRegras(tx, cenarioId),
  };
}

/** As chaves das justificativas das premissas de um grupo de centros ("C|grupo|…", "L|grupo|…", "E|grupo|…"). */
const PREFIXOS_DO_GRUPO = ["C", "L", "E"];
const doGrupo = (grupo: string) => PREFIXOS_DO_GRUPO.map((t) => `${t}|${grupo}|`);

/**
 * Leva os valores do grupo `de` para o nome `para` (o renomear do grupo, a decisão do Adão): os valores dos centros, as premissas
 * da unidade 0 (o Quadro de Lotação, os encargos e os benefícios do grupo), as justificativas e as realocações. O Quadro de
 * Lotação vai junto pelos centros.
 */
export async function renomearValoresDoGrupo(tx: Tx, cenarioId: string, de: string, para: string) {
  if (de === para) return;
  await tx.cenarioCentro.updateMany({ where: { cenarioId, grupo: de }, data: { grupo: para } });
  await tx.cenarioPremissa.updateMany({ where: { cenarioId, unidade: 0, chave: de }, data: { chave: para } });
  const prefixos = doGrupo(de);
  const justificativas = await tx.cenarioPremissaJustificativa.findMany({ where: { cenarioId, OR: prefixos.map((p) => ({ chave: { startsWith: p } })) } });
  for (const j of justificativas) {
    const [t, , ...resto] = j.chave.split("|");
    await tx.cenarioPremissaJustificativa.update({ where: { cenarioId_chave: { cenarioId, chave: j.chave } }, data: { chave: [t, para, ...resto].join("|") } });
  }
  await trocarNasRealocacoes(tx, cenarioId, (grupo) => (grupo === de ? para : grupo));
}

/** Tira do cenário os valores de um grupo que ficou sem centros (o aviso antes de gravar, a decisão do Adão). */
export async function apagarValoresDoGrupo(tx: Tx, cenarioId: string, grupo: string) {
  await tx.cenarioCentro.deleteMany({ where: { cenarioId, grupo } });
  await tx.cenarioPremissa.deleteMany({ where: { cenarioId, unidade: 0, chave: grupo } });
  await tx.cenarioPremissaJustificativa.deleteMany({ where: { cenarioId, OR: doGrupo(grupo).map((p) => ({ chave: { startsWith: p } })) } });
  await trocarNasRealocacoes(tx, cenarioId, (g) => (g === grupo ? null : g));
}

/** Troca (ou tira, com null) um grupo nas realocações gravadas do cenário: as decisões, as aplicadas e os destinos. */
async function trocarNasRealocacoes(tx: Tx, cenarioId: string, trocar: (grupo: string) => string | null) {
  const c = await tx.cenario.findUniqueOrThrow({ where: { id: cenarioId }, select: { realocacoes: true } });
  if (!c.realocacoes) return;
  const r = lerRealocacoes(c.realocacoes);
  const decisoes = Object.fromEntries(Object.entries(r.decisoes).map(([k, g]) => [k, g ? trocar(g) : g]));
  const aplicadas = Object.fromEntries(
    Object.entries(r.aplicadas).flatMap(([k, a]) => {
      const g = trocar(a.grupo);
      return g ? [[k, { ...a, grupo: g }]] : [];
    }),
  );
  const movimentacoes = r.movimentacoes.map((m) => ({
    ...m,
    destinos: m.destinos.flatMap((d) => {
      const g = trocar(d.grupo);
      return g ? [{ ...d, grupo: g }] : [];
    }),
    padrao: m.padrao ? trocar(m.padrao) : (m.padrao ?? null),
  }));
  await tx.cenario.update({ where: { id: cenarioId }, data: { realocacoes: { ...r, decisoes, aplicadas, movimentacoes } as unknown as Prisma.InputJsonValue } });
}
