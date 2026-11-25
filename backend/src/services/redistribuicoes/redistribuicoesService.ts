import { getPrismaClient } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { plural } from "../../utils/plural.js";
import { gestaoDoCentro } from "../acesso/recorteDepartamento.js";
import { auditar } from "../auditoriaService.js";
import { classificacaoService } from "../classificacao/classificacaoService.js";
import type { AtribuicaoCusto } from "../../generated/prisma/enums.js";
import { atribuicaoCabeNoCentro, chaveDoFornecedor, filialDoDepartamento, movimentoNoDepartamento } from "../classificacao/regrasClassificacao.js";

/**
 * As Redistribuições de Gastos (13/11/2026, pedido do Adão; Cadastros Gerais / Controladoria): os movimentos dos
 * fornecedores marcados, nas contas da DRE (uma ou mais) e num departamento (ou em todos), valem divididos entre os centros de custo
 * dos destinos, pelos percentuais (somam 100%), nas competências da vigência — cada centro numa Conta da DRE do departamento e da
 * atribuição dele (23/11/2026). A classificação aplica (classificacaoService); aqui, o cadastro: as listas do modal, a validação, a gravação (com a
 * reclassificação das competências ainda não apuradas da vigência) e a exclusão.
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
  /** O nome (25/11/2026, pedido do Adão): o primeiro campo do modal e da tabela. */
  nome: string;
  departamentoId: string | null;
  /** As contas da DRE (uma ou mais), na ordem do modal. */
  linhasDREIds: string[];
  fornecedores: string[];
  /** O centro, a Conta da DRE dele (23/11/2026) e o percentual de 0 a 100, como digitado. */
  destinos: Array<{ centroCustoId: string; linhaDREId: string; percentual: number }>;
  /** "AAAA-MM". */
  vigenciaInicio: string;
  vigenciaFim: string | null;
  descricao: string | null;
  ativo: boolean;
};

const rotulo = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;
/** "AAAA-MM" → o dia 1º do mês (UTC), como a classificação compara. */
export function mesDe(texto: string, campo: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(texto.trim());
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new RegraRedistribuicaoError(400, `${campo}: informe o mês e o ano.`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
}
export const textoDoMes = (d: Date | null) => (d ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` : null);
const mesDaCompetencia = (c: { ano: number; mes: number }) => new Date(Date.UTC(c.ano, c.mes - 1, 1));
const naVigencia = (c: { ano: number; mes: number }, inicio: Date, fim: Date | null) => mesDaCompetencia(c) >= inicio && (!fim || mesDaCompetencia(c) <= fim);
/** O nome da redistribuição (25/11/2026): obrigatório, até 120 caracteres, sem espaços nas pontas. */
export function nomeDaRedistribuicao(texto: string) {
  const nome = texto.trim().replace(/\s+/g, " ");
  if (!nome) throw new RegraRedistribuicaoError(400, "Dê um nome à redistribuição.");
  if (nome.length > 120) throw new RegraRedistribuicaoError(400, "O nome da redistribuição passa de 120 caracteres.");
  return nome;
}
export const rotuloDaLinha = (l: { grupoSigla: string | null; atribuicao: string | null; descricao: string }) => [l.grupoSigla, l.atribuicao, l.descricao].filter(Boolean).join(" · ");

export const LINHA_SEL = { id: true, codigo: true, descricao: true, grupo: true, grupoSigla: true, atribuicao: true, tipo: true, ativo: true, unidades: { select: { unidadeNegocio: { select: { codigo: true } } } } } as const;
export type LinhaDaRegra = Prisma.LinhaDREGetPayload<{ select: typeof LINHA_SEL }>;
const DEPARTAMENTO_SEL = { id: true, nome: true, gruposDRE: true, ativo: true, unidadeNegocio: { select: { codigo: true, nome: true } } } as const;

/** A linha é do departamento: um grupo da DRE dele, numa linha da unidade dele. */
export const linhaDoDepartamento = (l: { grupoSigla: string | null; unidades: Array<{ unidadeNegocio: { codigo: number } }> }, d: { gruposDRE: string[]; unidadeNegocio: { codigo: number } }) =>
  !!l.grupoSigla && d.gruposDRE.includes(l.grupoSigla) && l.unidades.some((u) => u.unidadeNegocio.codigo === d.unidadeNegocio.codigo);

/**
 * As contas da DRE de uma redistribuição (20/11/2026: uma ou mais): sem repetir, na ordem do modal, cada uma uma linha de item
 * ativa da Estrutura da DRE e, com o departamento, uma linha dele. Serve ao cadastro e às cópias dos cenários.
 */
export async function contasDaRegra(ids: string[], departamento: { nome: string; gruposDRE: string[]; unidadeNegocio: { codigo: number; nome: string } } | null): Promise<LinhaDaRegra[]> {
  const unicos = [...new Set(ids.filter(Boolean))];
  if (!unicos.length) throw new RegraRedistribuicaoError(400, "Escolha ao menos uma Conta da DRE.");
  const achadas = new Map((await getPrismaClient().linhaDRE.findMany({ where: { id: { in: unicos } }, select: LINHA_SEL })).map((l) => [l.id, l]));
  return unicos.map((id) => {
    const linha = achadas.get(id);
    if (!linha || linha.tipo !== "ITEM") throw new RegraRedistribuicaoError(400, "Escolha Contas da DRE que sejam linhas de item da Estrutura da DRE.");
    if (!linha.ativo) throw new RegraRedistribuicaoError(400, `A Conta da DRE ${rotuloDaLinha(linha)} está inativa.`);
    if (departamento && !linhaDoDepartamento(linha, departamento)) throw new RegraRedistribuicaoError(400, `A conta ${rotuloDaLinha(linha)} não é do departamento ${departamento.nome} (${departamento.unidadeNegocio.nome}).`);
    return linha;
  });
}

/** A conta em comum com a redistribuição que conflita, para a mensagem: "da conta X" (ou "das contas X, Y"). */
export const contaEmComum = (linhas: LinhaDaRegra[], outras: Array<{ linhaDREId: string }>) => {
  const comuns = linhas.filter((l) => outras.some((o) => o.linhaDREId === l.id)).map(rotuloDaLinha);
  return `${comuns.length === 1 ? "da conta" : "das contas"} ${comuns.slice(0, 3).join(", ")}${comuns.length > 3 ? "…" : ""}`;
};

/** As contas da DRE para gravar, na ordem do modal. */
export const contasParaGravar = (ids: string[]) => ids.map((linhaDREId, i) => ({ linhaDREId, ordem: i + 1 }));

/**
 * Um centro de Redistribuir Para, para a conta dele: o código, o nome, o departamento e a atribuição (os dos Cadastros Gerais ou os da
 * cópia do cenário).
 */
export type CentroDoDestino = { codigoRM: string | null; nomeRM: string; departamento: string | null; atribuicao: AtribuicaoCusto | null };
const nomeDoCentro = (c: CentroDoDestino) => `${c.codigoRM ?? ""} ${c.nomeRM}`.trim().replace(/\s+/g, " ");
const ROTULO_DA_ATRIBUICAO: Record<AtribuicaoCusto, string> = { DIRETA: "Direta", INDIRETA: "Indireta" };

/** A conta da DRE é do departamento do centro (23/11/2026): o grupo da linha é o departamento dele, pelos nomes (como na classificação). */
export const contaDoDepartamento = (l: { grupo: string }, c: { departamento: string | null }) => !!c.departamento && l.grupo.trim().toUpperCase() === c.departamento.trim().toUpperCase();
/** A conta da DRE é do centro (23/11/2026): do departamento dele e de uma atribuição que cabe na dele (atribuicaoCabeNoCentro). */
export const contaDoCentro = (l: { grupo: string; atribuicao: string | null }, c: { departamento: string | null; atribuicao: AtribuicaoCusto | null }) =>
  contaDoDepartamento(l, c) && atribuicaoCabeNoCentro(c.atribuicao, l.atribuicao);

/**
 * As contas dos destinos (23/11/2026, pedido do Adão): cada centro de Redistribuir Para numa Conta da DRE, uma linha de item ativa
 * do departamento do centro e da atribuição dele (o centro direto não leva Mão de Obra Indireta nem Gastos Gerais Indiretos, o
 * indireto não leva Mão de Obra Direta nem Gastos Gerais Diretos, como a verificação da classificação). `centros`: o centro de cada
 * destino, pelo id. Serve ao cadastro e às cópias dos cenários.
 */
export async function validarContasDosDestinos(destinos: Array<{ centroCustoId: string; linhaDREId: string | null | undefined }>, centros: Map<string, CentroDoDestino>) {
  const prisma = getPrismaClient();
  const ids = [...new Set(destinos.flatMap((d) => (d.linhaDREId ? [d.linhaDREId] : [])))];
  const [linhas, ativas] = await Promise.all([
    prisma.linhaDRE.findMany({ where: { id: { in: ids } }, select: { id: true, tipo: true, ativo: true, grupo: true, grupoSigla: true, atribuicao: true, descricao: true } }),
    prisma.linhaDRE.findMany({ where: { tipo: "ITEM", ativo: true }, select: { grupo: true, atribuicao: true }, distinct: ["grupo", "atribuicao"] }),
  ]);
  const porId = new Map(linhas.map((l) => [l.id, l]));
  for (const d of destinos) {
    const c = centros.get(d.centroCustoId);
    if (!c) continue;
    const nome = nomeDoCentro(c);
    if (!ativas.some((l) => contaDoDepartamento(l, c))) {
      throw new RegraRedistribuicaoError(400, `O centro ${nome} não tem um departamento da DRE${c.departamento ? ` (${c.departamento})` : ""}: escolha outro centro em Redistribuir Para.`);
    }
    if (!ativas.some((l) => contaDoCentro(l, c))) {
      throw new RegraRedistribuicaoError(400, `O departamento do centro ${nome} (${c.departamento}) não tem contas da atribuição dele (${ROTULO_DA_ATRIBUICAO[c.atribuicao!]}): escolha outro centro em Redistribuir Para.`);
    }
    if (!d.linhaDREId) throw new RegraRedistribuicaoError(400, `Escolha a Conta da DRE do centro ${nome} em Redistribuir Para.`);
    const l = porId.get(d.linhaDREId);
    if (!l || l.tipo !== "ITEM" || !l.ativo) throw new RegraRedistribuicaoError(400, `A Conta da DRE do centro ${nome} não é uma linha de item ativa da Estrutura da DRE.`);
    if (!contaDoDepartamento(l, c)) throw new RegraRedistribuicaoError(400, `A conta ${rotuloDaLinha(l)} não é do departamento do centro ${nome} (${c.departamento}): escolha uma conta dele.`);
    if (!contaDoCentro(l, c)) {
      throw new RegraRedistribuicaoError(400, `A conta ${rotuloDaLinha(l)} não é da atribuição do centro ${nome} (${ROTULO_DA_ATRIBUICAO[c.atribuicao!]}): escolha uma conta dela.`);
    }
  }
}

/** As opções das Contas da DRE do modal: com o grupo, a atribuição e as unidades (a lupa e o filtro da Unidade). */
export const opcaoDaLinha = (l: LinhaDaRegra) => ({
  id: l.id,
  codigo: l.codigo,
  rotulo: rotuloDaLinha(l),
  descricao: l.descricao,
  grupo: l.grupo,
  atribuicao: l.atribuicao,
  unidades: l.unidades.map((u) => u.unidadeNegocio.codigo),
});

/** As opções de um centro de Redistribuir Para: com o departamento, o grupo, a atribuição e o balde (a lupa). */
export const opcaoDoCentro = (c: { id: string; codigoRM: string | null; nomeRM: string; departamento: string | null; atribuicao: string | null; balde: string | null }) => ({
  id: c.id,
  codigo: c.codigoRM ?? "",
  nome: c.nomeRM,
  detalhe: [c.departamento, c.balde].filter(Boolean).join(" · ") || null,
  codigoRM: c.codigoRM,
  nomeRM: c.nomeRM,
  departamento: c.departamento,
  atribuicao: c.atribuicao,
  balde: c.balde,
  departamentoDoRecorte: gestaoDoCentro(c.departamento),
});


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
    include: {
      contas: { orderBy: { ordem: "asc" }, select: { linhaDREId: true, linhaDRE: { select: { descricao: true, grupoSigla: true, atribuicao: true } } } },
      destinos: { orderBy: { ordem: "asc" }, select: { centroCustoId: true, linhaDREId: true, percentual: true } },
    },
  });
  if (!r) throw new RegraRedistribuicaoError(404, "Redistribuição não encontrada.");
  return r;
}
/** Para a auditoria: os campos como a tela os mostra. */
const paraAuditoria = (r: Awaited<ReturnType<typeof ler>>) => ({
  nome: r.nome,
  departamentoId: r.departamentoId,
  linhasDREIds: r.contas.map((c) => c.linhaDREId),
  fornecedores: r.fornecedores,
  destinos: r.destinos.map((d) => ({ centroCustoId: d.centroCustoId, linhaDREId: d.linhaDREId, percentual: Number(d.percentual) })),
  vigenciaInicio: textoDoMes(r.vigenciaInicio),
  vigenciaFim: textoDoMes(r.vigenciaFim),
  descricao: r.descricao,
  ativo: r.ativo,
});

/** Valida e normaliza o que veio do modal. */
async function preparar(d: DadosDaRedistribuicao, id: string | null) {
  const prisma = getPrismaClient();
  const nome = nomeDaRedistribuicao(d.nome);
  let departamento: Prisma.DepartamentoGetPayload<{ select: typeof DEPARTAMENTO_SEL }> | null = null;
  if (d.departamentoId) {
    departamento = await prisma.departamento.findUnique({ where: { id: d.departamentoId }, select: DEPARTAMENTO_SEL });
    if (!departamento) throw new RegraRedistribuicaoError(400, "Departamento da DRE inexistente.");
  }
  const linhas = await contasDaRegra(d.linhasDREIds, departamento);
  const idsDasContas = linhas.map((l) => l.id);
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
  const centros = await prisma.centroCusto.findMany({ where: { id: { in: ids } }, select: { id: true, ativo: true, codigoRM: true, nomeRM: true, departamento: true, atribuicao: true } });
  if (centros.length !== ids.length) throw new RegraRedistribuicaoError(400, "Centro de custo inexistente em Redistribuir Para.");
  const inativo = centros.find((c) => !c.ativo);
  if (inativo) throw new RegraRedistribuicaoError(400, `O centro ${inativo.codigoRM ?? ""} ${inativo.nomeRM} está inativo.`.replace(/\s+/g, " "));
  // A conta de cada centro (23/11/2026): uma Conta da DRE do departamento e da atribuição dele.
  await validarContasDosDestinos(d.destinos, new Map(centros.map((c) => [c.id, c])));
  if (d.destinos.some((x) => !Number.isFinite(x.percentual) || x.percentual <= 0 || x.percentual > 100)) throw new RegraRedistribuicaoError(400, "Cada percentual precisa ser maior que 0% e no máximo 100%.");
  const soma = d.destinos.reduce((s, x) => s + x.percentual, 0);
  if (Math.abs(soma - 100) > 0.005) throw new RegraRedistribuicaoError(400, `Os percentuais somam ${soma.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%: precisam somar 100%.`);
  // A vigência por mês.
  const inicio = mesDe(d.vigenciaInicio, "O início da vigência");
  const fim = d.vigenciaFim ? mesDe(d.vigenciaFim, "O fim da vigência") : null;
  if (fim && fim < inicio) throw new RegraRedistribuicaoError(400, "O fim da vigência é anterior ao início.");
  // Sem sobreposição: numa conta em comum, com um fornecedor em comum, em departamentos que se cruzam e na mesma época.
  if (d.ativo) {
    const outras = await prisma.redistribuicaoGasto.findMany({
      where: { ativo: true, contas: { some: { linhaDREId: { in: idsDasContas } } }, ...(id ? { id: { not: id } } : {}) },
      select: { id: true, nome: true, departamentoId: true, fornecedores: true, vigenciaInicio: true, vigenciaFim: true, departamento: { select: { nome: true } }, contas: { select: { linhaDREId: true } } },
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
        `Já há uma redistribuição ativa, ${conflito.nome}, ${contaEmComum(linhas, conflito.contas)} (${conflito.departamento?.nome ?? "Todos os departamentos"}, vigência ${rotuloDaVigencia(conflito.vigenciaInicio, conflito.vigenciaFim)}) com ${plural(comuns.length, "o fornecedor", "os fornecedores")} ${comuns.slice(0, 3).join(", ")}${comuns.length > 3 ? "…" : ""} no mesmo período. Encerre a vigência de uma delas ou tire o fornecedor.`,
      );
    }
  }
  return {
    nome,
    departamentoId: departamento?.id ?? null,
    linhasDREIds: idsDasContas,
    fornecedores: [...porChave.values()].sort((a, b) => a.localeCompare(b, "pt-BR")),
    destinos: d.destinos.map((x, i) => ({ centroCustoId: x.centroCustoId, linhaDREId: x.linhaDREId, percentual: new Prisma.Decimal(x.percentual).div(100), ordem: i + 1 })),
    vigenciaInicio: inicio,
    vigenciaFim: fim,
    descricao: d.descricao?.trim() || null,
    ativo: d.ativo,
  };
}
export const rotuloDaVigencia = (inicio: Date, fim: Date | null) => {
  const t = (x: Date) => `${String(x.getUTCMonth() + 1).padStart(2, "0")}/${x.getUTCFullYear()}`;
  return fim ? `${t(inicio)} a ${t(fim)}` : `desde ${t(inicio)}`;
};

export const redistribuicoesService = {
  /** A lista da aba: o departamento, as contas, os fornecedores, os destinos, a vigência e as competências em que já valeu. */
  async listar() {
    const prisma = getPrismaClient();
    const [rs, usos] = await Promise.all([
      prisma.redistribuicaoGasto.findMany({
        orderBy: [{ ativo: "desc" }, { vigenciaInicio: "desc" }, { criadoEm: "asc" }],
        include: {
          departamento: { select: { nome: true, unidadeNegocio: { select: { nome: true } } } },
          contas: { orderBy: { ordem: "asc" }, select: { linhaDREId: true, linhaDRE: { select: { codigo: true, descricao: true, grupoSigla: true, atribuicao: true } } } },
          destinos: {
            orderBy: { ordem: "asc" },
            select: { centroCustoId: true, linhaDREId: true, percentual: true, centroCusto: { select: { codigoRM: true, nomeRM: true } }, linhaDRE: { select: { descricao: true, grupoSigla: true, atribuicao: true } } },
          },
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
      nome: r.nome,
      departamentoId: r.departamentoId,
      departamento: r.departamento ? `${r.departamento.nome} (${r.departamento.unidadeNegocio.nome})` : null,
      linhasDREIds: r.contas.map((c) => c.linhaDREId),
      contas: r.contas.map((c) => ({ codigo: c.linhaDRE.codigo, rotulo: rotuloDaLinha(c.linhaDRE) })),
      fornecedores: r.fornecedores,
      destinos: r.destinos.map((d) => ({
        centroCustoId: d.centroCustoId,
        centro: `${d.centroCusto.codigoRM ?? "sem código"} · ${d.centroCusto.nomeRM}`,
        linhaDREId: d.linhaDREId,
        /** A Conta da DRE do centro (23/11/2026); nula num destino anterior sem conta equivalente (a parte fica na conta do movimento). */
        conta: d.linhaDRE ? rotuloDaLinha(d.linhaDRE) : null,
        percentual: Number(d.percentual) * 100,
      })),
      vigenciaInicio: textoDoMes(r.vigenciaInicio)!,
      vigenciaFim: textoDoMes(r.vigenciaFim),
      descricao: r.descricao,
      ativo: r.ativo,
      competencias: (usadas.get(r.id) ?? []).sort((a, b) => a.slice(3).localeCompare(b.slice(3)) || a.localeCompare(b)),
    }));
  },

  /**
   * As listas do modal: os departamentos (com os grupos da DRE e a unidade), as unidades (o filtro das contas), as contas da
   * DRE (linhas de item, com as unidades em que aparecem) e os centros (com o que a lupa mostra).
   */
  async opcoes() {
    const prisma = getPrismaClient();
    const [departamentos, linhas, centros, unidades] = await Promise.all([
      prisma.departamento.findMany({ where: { ativo: true }, orderBy: { ordem: "asc" }, select: DEPARTAMENTO_SEL }),
      prisma.linhaDRE.findMany({ where: { tipo: "ITEM", ativo: true }, orderBy: { ordem: "asc" }, select: LINHA_SEL }),
      prisma.centroCusto.findMany({ where: { ativo: true }, orderBy: { codigoRM: "asc" }, select: { id: true, codigoRM: true, nomeRM: true, departamento: true, atribuicao: true, balde: true } }),
      prisma.unidadeNegocio.findMany({ orderBy: { codigo: "asc" }, select: { codigo: true, nome: true } }),
    ]);
    return {
      departamentos: departamentos.map((d) => ({
        id: d.id,
        nome: `${d.nome} (${d.unidadeNegocio.nome})`,
        // As contas do departamento: as linhas dos grupos da DRE dele, na unidade dele.
        linhas: linhas.filter((l) => linhaDoDepartamento(l, d)).map((l) => l.id),
      })),
      unidades,
      linhas: linhas.map(opcaoDaLinha),
      centros: centros.map(opcaoDoCentro),
    };
  },

  /**
   * Os fornecedores com movimentos na combinação (de competências fechadas ou abertas): nas contas da DRE (a linha que vale
   * hoje para o movimento; em qualquer das escolhidas) e no departamento (os grupos da DRE dele e, na Produção, a filial).
   * Com os movimentos e o valor.
   */
  async fornecedores(departamentoId: string | null, linhasDREIds: string[]) {
    let departamento: DepartamentoDaCombinacao | null = null;
    if (departamentoId) {
      departamento = await getPrismaClient().departamento.findUnique({ where: { id: departamentoId }, select: { gruposDRE: true, unidadeNegocio: { select: { codigo: true } } } });
      if (!departamento) throw new RegraRedistribuicaoError(404, "Departamento da DRE inexistente.");
    }
    return fornecedoresDaCombinacao(departamento, linhasDREIds);
  },

  async criar(d: DadosDaRedistribuicao, usuarioId: string) {
    const prisma = getPrismaClient();
    const dados = await preparar(d, null);
    const { destinos, linhasDREIds, ...regra } = dados;
    const criada = await prisma.redistribuicaoGasto.create({
      data: { ...regra, ordem: (await prisma.redistribuicaoGasto.count()) + 1, contas: { create: contasParaGravar(linhasDREIds) }, destinos: { create: destinos } },
    });
    const depois = paraAuditoria(await ler(criada.id));
    await auditar({ usuarioId, acao: "CRIACAO", entidade: "redistribuicao_gasto", entidadeId: criada.id, depois, metadados: { nome: regra.nome } });
    return { id: criada.id, ...(await aplicarNasCompetencias([{ inicio: regra.vigenciaInicio, fim: regra.vigenciaFim }])) };
  },

  async atualizar(id: string, d: DadosDaRedistribuicao, usuarioId: string) {
    const prisma = getPrismaClient();
    const anterior = await ler(id);
    const dados = await preparar(d, id);
    const { destinos, linhasDREIds, ...regra } = dados;
    await prisma.$transaction([
      prisma.redistribuicaoDestino.deleteMany({ where: { redistribuicaoId: id } }),
      prisma.redistribuicaoConta.deleteMany({ where: { redistribuicaoId: id } }),
      prisma.redistribuicaoGasto.update({ where: { id }, data: { ...regra, contas: { create: contasParaGravar(linhasDREIds) }, destinos: { create: destinos } } }),
    ]);
    const depois = paraAuditoria(await ler(id));
    await auditar({ usuarioId, acao: "ALTERACAO", entidade: "redistribuicao_gasto", entidadeId: id, antes: paraAuditoria(anterior), depois, metadados: { nome: regra.nome } });
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
    await auditar({ usuarioId, acao: "EXCLUSAO", entidade: "redistribuicao_gasto", entidadeId: id, antes: paraAuditoria(anterior), metadados: { nome: anterior.nome } });
    return aplicarNasCompetencias([{ inicio: anterior.vigenciaInicio, fim: anterior.vigenciaFim }]);
  },
};

/** O departamento de uma combinação (o dos Cadastros Gerais ou o da cópia de um cenário): os grupos da DRE e a unidade. */
export type DepartamentoDaCombinacao = { gruposDRE: string[]; unidadeNegocio: { codigo: number } };

/**
 * Os fornecedores com movimentos na combinação (de competências fechadas ou abertas): nas contas da DRE (a linha que vale
 * hoje para o movimento; em qualquer das escolhidas, somadas por fornecedor) e no departamento (os grupos da DRE dele e, na
 * Produção, a filial), com os movimentos e o valor. Serve ao cadastro e às Redistribuições de Gastos dos cenários analíticos.
 */
export async function fornecedoresDaCombinacao(departamento: DepartamentoDaCombinacao | null, linhasDREIds: string[]) {
  const prisma = getPrismaClient();
  let linhas = await prisma.linhaDRE.findMany({ where: { id: { in: [...new Set(linhasDREIds)] } }, select: { id: true, grupoSigla: true } });
  if (!linhas.length) throw new RegraRedistribuicaoError(404, "Conta da DRE inexistente.");
  let filial: number | null = null;
  if (departamento) {
    linhas = linhas.filter((l) => movimentoNoDepartamento({ grupos: new Set(departamento.gruposDRE), filial: null }, l.grupoSigla, 0));
    if (!linhas.length) return [];
    filial = filialDoDepartamento(departamento.unidadeNegocio.codigo);
  }
  const [grupos, competencias] = await Promise.all([
    prisma.lancamentoContabil.groupBy({
      by: ["cliForn", "competenciaId"],
      where: { linhaDREId: { in: linhas.map((l) => l.id) }, cliForn: { not: null }, ...(filial !== null ? { filial } : {}) },
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
}
