import { getPrismaClient } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { plural } from "../../utils/plural.js";
import { auditar } from "../auditoriaService.js";
import { classificacaoService } from "../classificacao/classificacaoService.js";
import { chaveDoFornecedor, filialDoDepartamento, movimentoNoDepartamento } from "../classificacao/regrasClassificacao.js";

/**
 * As Redistribuições de Gastos (13/11/2026, pedido do Adão; Cadastros Gerais / Controladoria): os movimentos dos
 * fornecedores marcados, numa conta da DRE (e num departamento, ou em todos), valem divididos entre os centros de custo
 * dos destinos, pelos percentuais (somam 100%), nas competências da vigência. A classificação aplica (classificacaoService);
 * aqui, o cadastro: as listas do modal, a validação, a gravação (com a reclassificação das competências ainda não apuradas
 * da vigência) e a exclusão.
 */

export class RegraRedistribuicaoError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

export type DadosDaRedistribuicao = {
  departamentoId: string | null;
  linhaDREId: string;
  fornecedores: string[];
  /** O percentual de 0 a 100, como digitado. */
  destinos: Array<{ centroCustoId: string; percentual: number }>;
  /** "AAAA-MM". */
  vigenciaInicio: string;
  vigenciaFim: string | null;
  descricao: string | null;
  ativo: boolean;
};

const rotulo = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;
/** "AAAA-MM" → o dia 1º do mês (UTC), como a classificação compara. */
function mesDe(texto: string, campo: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(texto.trim());
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new RegraRedistribuicaoError(400, `${campo}: informe o mês e o ano.`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
}
const textoDoMes = (d: Date | null) => (d ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` : null);
const mesDaCompetencia = (c: { ano: number; mes: number }) => new Date(Date.UTC(c.ano, c.mes - 1, 1));
const naVigencia = (c: { ano: number; mes: number }, inicio: Date, fim: Date | null) => mesDaCompetencia(c) >= inicio && (!fim || mesDaCompetencia(c) <= fim);
const rotuloDaLinha = (l: { grupoSigla: string | null; atribuicao: string | null; descricao: string }) => [l.grupoSigla, l.atribuicao, l.descricao].filter(Boolean).join(" · ");

const LINHA_SEL = { id: true, codigo: true, descricao: true, grupoSigla: true, atribuicao: true, tipo: true, ativo: true, unidades: { select: { unidadeNegocio: { select: { codigo: true } } } } } as const;
const DEPARTAMENTO_SEL = { id: true, nome: true, gruposDRE: true, ativo: true, unidadeNegocio: { select: { codigo: true, nome: true } } } as const;

/** A linha é do departamento: um grupo da DRE dele, numa linha da unidade dele. */
const linhaDoDepartamento = (l: { grupoSigla: string | null; unidades: Array<{ unidadeNegocio: { codigo: number } }> }, d: { gruposDRE: string[]; unidadeNegocio: { codigo: number } }) =>
  !!l.grupoSigla && d.gruposDRE.includes(l.grupoSigla) && l.unidades.some((u) => u.unidadeNegocio.codigo === d.unidadeNegocio.codigo);

/** Depois de gravar: reclassifica as competências ainda não apuradas da vigência e diz quais apuradas pedem reapurar. */
async function aplicarNasCompetencias(vigencias: Array<{ inicio: Date; fim: Date | null }>) {
  const prisma = getPrismaClient();
  const abertas = await prisma.competencia.findMany({ where: { status: { not: "FECHADA" } }, select: { id: true, ano: true, mes: true, apuradaEm: true }, orderBy: [{ ano: "asc" }, { mes: "asc" }] });
  const afetadas = abertas.filter((c) => vigencias.some((v) => naVigencia(c, v.inicio, v.fim)));
  const reclassificadas: string[] = [];
  for (const c of afetadas.filter((x) => !x.apuradaEm)) {
    await classificacaoService.classificarCompetencia(c.id);
    reclassificadas.push(rotulo(c.ano, c.mes));
  }
  return { reclassificadas, apuradasPorReapurar: afetadas.filter((x) => x.apuradaEm).map((c) => rotulo(c.ano, c.mes)) };
}

async function ler(id: string) {
  const r = await getPrismaClient().redistribuicaoGasto.findUnique({
    where: { id },
    include: { destinos: { orderBy: { ordem: "asc" }, select: { centroCustoId: true, percentual: true } } },
  });
  if (!r) throw new RegraRedistribuicaoError(404, "Redistribuição não encontrada.");
  return r;
}
/** Para a auditoria: os campos como a tela os mostra. */
const paraAuditoria = (r: Awaited<ReturnType<typeof ler>>) => ({
  departamentoId: r.departamentoId,
  linhaDREId: r.linhaDREId,
  fornecedores: r.fornecedores,
  destinos: r.destinos.map((d) => ({ centroCustoId: d.centroCustoId, percentual: Number(d.percentual) })),
  vigenciaInicio: textoDoMes(r.vigenciaInicio),
  vigenciaFim: textoDoMes(r.vigenciaFim),
  descricao: r.descricao,
  ativo: r.ativo,
});

/** Valida e normaliza o que veio do modal. */
async function preparar(d: DadosDaRedistribuicao, id: string | null) {
  const prisma = getPrismaClient();
  const linha = await prisma.linhaDRE.findUnique({ where: { id: d.linhaDREId }, select: LINHA_SEL });
  if (!linha || linha.tipo !== "ITEM") throw new RegraRedistribuicaoError(400, "Escolha uma Conta da DRE (uma linha de item da Estrutura da DRE).");
  if (!linha.ativo) throw new RegraRedistribuicaoError(400, "A Conta da DRE está inativa.");
  let departamento: Prisma.DepartamentoGetPayload<{ select: typeof DEPARTAMENTO_SEL }> | null = null;
  if (d.departamentoId) {
    departamento = await prisma.departamento.findUnique({ where: { id: d.departamentoId }, select: DEPARTAMENTO_SEL });
    if (!departamento) throw new RegraRedistribuicaoError(400, "Departamento da DRE inexistente.");
    if (!linhaDoDepartamento(linha, departamento)) throw new RegraRedistribuicaoError(400, `A conta ${rotuloDaLinha(linha)} não é do departamento ${departamento.nome} (${departamento.unidadeNegocio.nome}).`);
  }
  // Os fornecedores marcados, um por nome (sem caixa).
  const porChave = new Map<string, string>();
  for (const f of d.fornecedores) {
    const nome = f.trim();
    if (nome && !porChave.has(chaveDoFornecedor(nome))) porChave.set(chaveDoFornecedor(nome), nome);
  }
  if (!porChave.size) throw new RegraRedistribuicaoError(400, "Marque ao menos um fornecedor.");
  // Os destinos: centros diferentes, percentuais positivos somando 100%.
  if (!d.destinos.length) throw new RegraRedistribuicaoError(400, "Inclua ao menos um centro de custo em Redistribuir Para.");
  const ids = d.destinos.map((x) => x.centroCustoId);
  if (new Set(ids).size !== ids.length) throw new RegraRedistribuicaoError(400, "Um centro de custo aparece mais de uma vez em Redistribuir Para.");
  const centros = await prisma.centroCusto.findMany({ where: { id: { in: ids } }, select: { id: true, ativo: true, codigoRM: true, nomeRM: true } });
  if (centros.length !== ids.length) throw new RegraRedistribuicaoError(400, "Centro de custo inexistente em Redistribuir Para.");
  const inativo = centros.find((c) => !c.ativo);
  if (inativo) throw new RegraRedistribuicaoError(400, `O centro ${inativo.codigoRM ?? ""} ${inativo.nomeRM} está inativo.`.replace(/\s+/g, " "));
  if (d.destinos.some((x) => !Number.isFinite(x.percentual) || x.percentual <= 0 || x.percentual > 100)) throw new RegraRedistribuicaoError(400, "Cada percentual precisa ser maior que 0% e no máximo 100%.");
  const soma = d.destinos.reduce((s, x) => s + x.percentual, 0);
  if (Math.abs(soma - 100) > 0.005) throw new RegraRedistribuicaoError(400, `Os percentuais somam ${soma.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%: precisam somar 100%.`);
  // A vigência por mês.
  const inicio = mesDe(d.vigenciaInicio, "O início da vigência");
  const fim = d.vigenciaFim ? mesDe(d.vigenciaFim, "O fim da vigência") : null;
  if (fim && fim < inicio) throw new RegraRedistribuicaoError(400, "O fim da vigência é anterior ao início.");
  // Sem sobreposição: na mesma conta, com um fornecedor em comum, em departamentos que se cruzam e na mesma época.
  if (d.ativo) {
    const outras = await prisma.redistribuicaoGasto.findMany({
      where: { ativo: true, linhaDREId: linha.id, ...(id ? { id: { not: id } } : {}) },
      select: { id: true, departamentoId: true, fornecedores: true, vigenciaInicio: true, vigenciaFim: true, departamento: { select: { nome: true } } },
    });
    const cruza = (o: (typeof outras)[number]) =>
      (!o.departamentoId || !d.departamentoId || o.departamentoId === d.departamentoId) &&
      o.vigenciaInicio <= (fim ?? new Date(Date.UTC(9999, 0, 1))) &&
      inicio <= (o.vigenciaFim ?? new Date(Date.UTC(9999, 0, 1))) &&
      o.fornecedores.some((f) => porChave.has(chaveDoFornecedor(f)));
    const conflito = outras.find(cruza);
    if (conflito) {
      const comuns = conflito.fornecedores.filter((f) => porChave.has(chaveDoFornecedor(f)));
      throw new RegraRedistribuicaoError(
        409,
        `Já há uma redistribuição ativa desta conta (${conflito.departamento?.nome ?? "Todos os departamentos"}, vigência ${rotuloDaVigencia(conflito.vigenciaInicio, conflito.vigenciaFim)}) com ${plural(comuns.length, "o fornecedor", "os fornecedores")} ${comuns.slice(0, 3).join(", ")}${comuns.length > 3 ? "…" : ""} no mesmo período. Encerre a vigência de uma delas ou tire o fornecedor.`,
      );
    }
  }
  return {
    departamentoId: departamento?.id ?? null,
    linhaDREId: linha.id,
    fornecedores: [...porChave.values()].sort((a, b) => a.localeCompare(b, "pt-BR")),
    destinos: d.destinos.map((x, i) => ({ centroCustoId: x.centroCustoId, percentual: new Prisma.Decimal(x.percentual).div(100), ordem: i + 1 })),
    vigenciaInicio: inicio,
    vigenciaFim: fim,
    descricao: d.descricao?.trim() || null,
    ativo: d.ativo,
  };
}
const rotuloDaVigencia = (inicio: Date, fim: Date | null) => {
  const t = (x: Date) => `${String(x.getUTCMonth() + 1).padStart(2, "0")}/${x.getUTCFullYear()}`;
  return fim ? `${t(inicio)} a ${t(fim)}` : `desde ${t(inicio)}`;
};

export const redistribuicoesService = {
  /** A lista da aba: o departamento, a conta, os fornecedores, os destinos, a vigência e as competências em que já valeu. */
  async listar() {
    const prisma = getPrismaClient();
    const [rs, usos] = await Promise.all([
      prisma.redistribuicaoGasto.findMany({
        orderBy: [{ ativo: "desc" }, { vigenciaInicio: "desc" }, { criadoEm: "asc" }],
        include: {
          departamento: { select: { nome: true, unidadeNegocio: { select: { nome: true } } } },
          linhaDRE: { select: { codigo: true, descricao: true, grupoSigla: true, atribuicao: true } },
          destinos: { orderBy: { ordem: "asc" }, select: { centroCustoId: true, percentual: true, centroCusto: { select: { codigoRM: true, nomeRM: true } } } },
        },
      }),
      prisma.lancamentoRedistribuido.groupBy({ by: ["redistribuicaoId", "competenciaId"], _count: { _all: true } }),
    ]);
    const competencias = new Map((await prisma.competencia.findMany({ select: { id: true, ano: true, mes: true } })).map((c) => [c.id, c]));
    const usadas = new Map<string, string[]>();
    for (const u of usos) {
      const c = competencias.get(u.competenciaId);
      if (c) usadas.set(u.redistribuicaoId, [...(usadas.get(u.redistribuicaoId) ?? []), rotulo(c.ano, c.mes)]);
    }
    return rs.map((r) => ({
      id: r.id,
      departamentoId: r.departamentoId,
      departamento: r.departamento ? `${r.departamento.nome} (${r.departamento.unidadeNegocio.nome})` : null,
      linhaDREId: r.linhaDREId,
      conta: { codigo: r.linhaDRE.codigo, rotulo: rotuloDaLinha(r.linhaDRE) },
      fornecedores: r.fornecedores,
      destinos: r.destinos.map((d) => ({ centroCustoId: d.centroCustoId, centro: `${d.centroCusto.codigoRM ?? "sem código"} · ${d.centroCusto.nomeRM}`, percentual: Number(d.percentual) * 100 })),
      vigenciaInicio: textoDoMes(r.vigenciaInicio)!,
      vigenciaFim: textoDoMes(r.vigenciaFim),
      descricao: r.descricao,
      ativo: r.ativo,
      competencias: (usadas.get(r.id) ?? []).sort((a, b) => a.slice(3).localeCompare(b.slice(3)) || a.localeCompare(b)),
    }));
  },

  /** As listas do modal: os departamentos (com os grupos da DRE e a unidade), as contas da DRE (linhas de item) e os centros. */
  async opcoes() {
    const prisma = getPrismaClient();
    const [departamentos, linhas, centros] = await Promise.all([
      prisma.departamento.findMany({ where: { ativo: true }, orderBy: { ordem: "asc" }, select: DEPARTAMENTO_SEL }),
      prisma.linhaDRE.findMany({ where: { tipo: "ITEM", ativo: true }, orderBy: { ordem: "asc" }, select: LINHA_SEL }),
      prisma.centroCusto.findMany({ where: { ativo: true }, orderBy: { codigoRM: "asc" }, select: { id: true, codigoRM: true, nomeRM: true, departamento: true, balde: true } }),
    ]);
    return {
      departamentos: departamentos.map((d) => ({
        id: d.id,
        nome: `${d.nome} (${d.unidadeNegocio.nome})`,
        // As contas do departamento: as linhas dos grupos da DRE dele, na unidade dele.
        linhas: linhas.filter((l) => linhaDoDepartamento(l, d)).map((l) => l.id),
      })),
      linhas: linhas.map((l) => ({ id: l.id, codigo: l.codigo, rotulo: rotuloDaLinha(l) })),
      centros: centros.map((c) => ({ id: c.id, codigo: c.codigoRM ?? "", nome: c.nomeRM, detalhe: [c.departamento, c.balde].filter(Boolean).join(" · ") || null })),
    };
  },

  /**
   * Os fornecedores com movimentos na combinação (de competências fechadas ou abertas): na conta da DRE (a linha que vale
   * hoje para o movimento) e no departamento (os grupos da DRE dele e, na Produção, a filial). Com os movimentos e o valor.
   */
  async fornecedores(departamentoId: string | null, linhaDREId: string) {
    const prisma = getPrismaClient();
    const linha = await prisma.linhaDRE.findUnique({ where: { id: linhaDREId }, select: { id: true, grupoSigla: true } });
    if (!linha) throw new RegraRedistribuicaoError(404, "Conta da DRE inexistente.");
    let filial: number | null = null;
    if (departamentoId) {
      const d = await prisma.departamento.findUnique({ where: { id: departamentoId }, select: { gruposDRE: true, unidadeNegocio: { select: { codigo: true } } } });
      if (!d) throw new RegraRedistribuicaoError(404, "Departamento da DRE inexistente.");
      if (!movimentoNoDepartamento({ grupos: new Set(d.gruposDRE), filial: null }, linha.grupoSigla, 0)) return [];
      filial = filialDoDepartamento(d.unidadeNegocio.codigo);
    }
    const [grupos, competencias] = await Promise.all([
      prisma.lancamentoContabil.groupBy({
        by: ["cliForn", "competenciaId"],
        where: { linhaDREId, cliForn: { not: null }, ...(filial !== null ? { filial } : {}) },
        _count: { _all: true },
        _sum: { valorMovimento: true },
      }),
      prisma.competencia.findMany({ select: { id: true, ano: true, mes: true, status: true } }),
    ]);
    const comp = new Map(competencias.map((c) => [c.id, c]));
    const porChave = new Map<string, { fornecedor: string; movimentos: number; valor: number; meses: Array<{ ano: number; mes: number }> }>();
    for (const g of grupos) {
      const nome = (g.cliForn ?? "").trim();
      if (!nome) continue;
      const k = chaveDoFornecedor(nome);
      const x = porChave.get(k) ?? { fornecedor: nome, movimentos: 0, valor: 0, meses: [] };
      x.movimentos += g._count._all;
      x.valor += Number(g._sum.valorMovimento ?? 0);
      const c = comp.get(g.competenciaId);
      if (c) x.meses.push({ ano: c.ano, mes: c.mes });
      porChave.set(k, x);
    }
    return [...porChave.values()]
      .map((x) => {
        const ordem = x.meses.sort((a, b) => a.ano - b.ano || a.mes - b.mes);
        const de = ordem[0];
        const ate = ordem[ordem.length - 1];
        return {
          fornecedor: x.fornecedor,
          movimentos: x.movimentos,
          valor: Math.round(x.valor * 100) / 100,
          competencias: de ? (de === ate ? rotulo(de.ano, de.mes) : `${rotulo(de.ano, de.mes)} a ${rotulo(ate.ano, ate.mes)}`) : "",
        };
      })
      .sort((a, b) => a.fornecedor.localeCompare(b.fornecedor, "pt-BR"));
  },

  async criar(d: DadosDaRedistribuicao, usuarioId: string) {
    const prisma = getPrismaClient();
    const dados = await preparar(d, null);
    const { destinos, ...regra } = dados;
    const criada = await prisma.redistribuicaoGasto.create({
      data: { ...regra, ordem: (await prisma.redistribuicaoGasto.count()) + 1, destinos: { create: destinos } },
    });
    const depois = paraAuditoria(await ler(criada.id));
    await auditar({ usuarioId, acao: "CRIACAO", entidade: "redistribuicao_gasto", entidadeId: criada.id, depois, metadados: { nome: `${(await nomeDaConta(regra.linhaDREId)) ?? ""} · ${regra.fornecedores.length} ${plural(regra.fornecedores.length, "fornecedor", "fornecedores")}` } });
    return { id: criada.id, ...(await aplicarNasCompetencias([{ inicio: regra.vigenciaInicio, fim: regra.vigenciaFim }])) };
  },

  async atualizar(id: string, d: DadosDaRedistribuicao, usuarioId: string) {
    const prisma = getPrismaClient();
    const anterior = await ler(id);
    const dados = await preparar(d, id);
    const { destinos, ...regra } = dados;
    await prisma.$transaction([
      prisma.redistribuicaoDestino.deleteMany({ where: { redistribuicaoId: id } }),
      prisma.redistribuicaoGasto.update({ where: { id }, data: { ...regra, destinos: { create: destinos } } }),
    ]);
    const depois = paraAuditoria(await ler(id));
    await auditar({ usuarioId, acao: "ALTERACAO", entidade: "redistribuicao_gasto", entidadeId: id, antes: paraAuditoria(anterior), depois, metadados: { nome: `${(await nomeDaConta(regra.linhaDREId)) ?? ""} · ${regra.fornecedores.length} ${plural(regra.fornecedores.length, "fornecedor", "fornecedores")}` } });
    // A vigência de antes e a de agora: as competências que saíram e as que entraram se reclassificam.
    return { id, ...(await aplicarNasCompetencias([{ inicio: anterior.vigenciaInicio, fim: anterior.vigenciaFim }, { inicio: regra.vigenciaInicio, fim: regra.vigenciaFim }])) };
  },

  /** A exclusão: recusada se a redistribuição já valeu numa competência apurada ou fechada (encerre a vigência). */
  async excluir(id: string, usuarioId: string) {
    const prisma = getPrismaClient();
    const anterior = await ler(id);
    const usadas = await prisma.lancamentoRedistribuido.findMany({
      where: { redistribuicaoId: id, competencia: { OR: [{ status: "FECHADA" }, { apuradaEm: { not: null } }] } },
      distinct: ["competenciaId"],
      select: { competencia: { select: { ano: true, mes: true } } },
    });
    if (usadas.length) {
      const meses = usadas.map((u) => rotulo(u.competencia.ano, u.competencia.mes)).sort((a, b) => a.slice(3).localeCompare(b.slice(3)) || a.localeCompare(b));
      throw new RegraRedistribuicaoError(409, `A redistribuição já valeu na apuração de ${meses.join(", ")}: encerre a vigência (o Fim) em vez de excluir.`);
    }
    await prisma.$transaction([
      // As partes das competências ainda não apuradas saem com a regra; a classificação as refaz sem ela.
      prisma.lancamentoRedistribuido.deleteMany({ where: { redistribuicaoId: id } }),
      prisma.redistribuicaoGasto.delete({ where: { id } }),
    ]);
    await auditar({ usuarioId, acao: "EXCLUSAO", entidade: "redistribuicao_gasto", entidadeId: id, antes: paraAuditoria(anterior), metadados: { nome: (await nomeDaConta(anterior.linhaDREId)) ?? "" } });
    return aplicarNasCompetencias([{ inicio: anterior.vigenciaInicio, fim: anterior.vigenciaFim }]);
  },
};

async function nomeDaConta(linhaDREId: string) {
  const l = await getPrismaClient().linhaDRE.findUnique({ where: { id: linhaDREId }, select: { descricao: true, grupoSigla: true, atribuicao: true } });
  return l ? rotuloDaLinha(l) : null;
}
