import { createHash } from "node:crypto";

import { getPrismaClient } from "../../config/prisma.js";
import { auditar } from "../auditoriaService.js";
import { gruposDoCadastro } from "../cenarios/centrosCenario.js";
import { quadrosDeLotacao } from "../cenarios/lotacaoCenario.js";
import { gravarLotacaoDoMes } from "../importacoes/lotacao/processarLotacao.js";
import { calcularQuadros, indicadoresDoMes, lerAnoMes, QuadroError, type QuadroDoMes } from "./quadroService.js";

/**
 * O Apurar das Importações (06/11/2026, pedido do Adão; Gestão de Colaboradores, etapa 3): no Importar da linha dos tipos
 * Indicadores do Administrativo e Quadro de Lotação, os valores do mês saem da competência do Quadro de Lotação do mesmo
 * mês, em vez da planilha.
 *
 * - **Indicadores do Administrativo:** o Quadro de Lotação Total, o Turnover, a Abertura de Vagas x Contratações e os
 *   quadros "Quadro de Lotação: MO …" (pelos grupos de centros, como nos Cenários Analíticos). Gravados como os digitados nas
 *   Listas (valem por cima do importado), com a origem APURADO; uma nova importação da planilha os sobrescreve. Os outros
 *   indicadores da aba (Fluxo de Caixa, Inadimplência, Acidentes) continuam vindo da planilha.
 * - **Quadro de Lotação:** os colaboradores do fim do mês por grupo de centros (o nome da controladoria, como na aba da
 *   planilha), com a unidade, o departamento e a atribuição; gravados numa importação do tipo (a "apurada"), que substitui a
 *   anterior, como uma importação da planilha.
 */

type Db = ReturnType<typeof getPrismaClient>;
type Quem = { id: string; nome: string | null };
export type TipoApurado = "INDICADORES_ADMIN" | "QUADRO_LOTACAO";
const mesAno = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;

/** O quadro do Quadro de Lotação no mês (exige a competência dele). */
async function quadroDoMes(db: Db, ano: number, mes: number): Promise<QuadroDoMes> {
  const [competencias, cargaItens, movs] = await Promise.all([
    db.colaboradorCompetencia.findMany({ select: { id: true, ano: true, mes: true } }),
    db.colaboradorCargaInicial.findMany({ select: { ano: true, mes: true, centroCustoId: true, vinculo: true } }),
    db.colaboradorMovimentacao.findMany({ select: { competenciaId: true, centroCustoId: true, vinculo: true, status: true, tipoMovimentacao: { select: { contagem: true, nome: true } } } }),
  ]);
  if (!competencias.some((c) => c.ano === ano && c.mes === mes)) {
    throw new QuadroError(409, `A competência ${mesAno(ano, mes)} do Quadro de Lotação (Gestão de Colaboradores) não está aberta: não há o que apurar.`);
  }
  const carga = cargaItens.length ? { ano: cargaItens[0].ano, mes: cargaItens[0].mes, itens: cargaItens } : null;
  const idDe = new Map(competencias.map((c) => [`${c.ano}-${c.mes}`, c.id]));
  const quadros = calcularQuadros(competencias, carga, (c) =>
    movs
      .filter((m) => m.competenciaId === idDe.get(`${c.ano}-${c.mes}`))
      .map((m) => ({ centroCustoId: m.centroCustoId, vinculo: m.vinculo, status: m.status, contagem: m.tipoMovimentacao.contagem, tipo: m.tipoMovimentacao.nome })),
  );
  return quadros.find((q) => q.ano === ano && q.mes === mes)!;
}

/** Os centros do quadro do fim do mês, com o grupo (o nome da controladoria) e os dados de cada um. */
async function centrosDoQuadro(db: Db, q: QuadroDoMes) {
  const ids = [...new Set([...q.final.keys()].map((k) => k.split("|")[0]))];
  const centros = await db.centroCusto.findMany({
    where: { id: { in: ids } },
    select: { id: true, codigoRM: true, nomeRM: true, nomeControladoria: true, departamento: true, atribuicao: true, unidadeNegocio: { select: { nome: true } } },
  });
  return new Map(centros.map((c) => [c.id, c]));
}

/** Os indicadores do Administrativo do mês: os do quadro (Total, Turnover, Contratações) e os "Quadro de Lotação: MO …". */
async function indicadoresApurados(db: Db, q: QuadroDoMes) {
  const ind = indicadoresDoMes(q);
  const centros = await centrosDoQuadro(db, q);
  // Os colaboradores de cada grupo de centros no mês (o índice do mês no ano), como a premissa dos cenários analíticos.
  const grupos = await gruposDoCadastro();
  const grupoDoCodigo = new Map(grupos.flatMap((g) => g.centros.filter((c) => c.codigo).map((c) => [c.codigo!, g.grupo] as const)));
  const porGrupo = new Map<string, number[]>();
  for (const [k, n] of q.final) {
    const c = centros.get(k.split("|")[0]);
    const grupo = (c?.codigoRM && grupoDoCodigo.get(c.codigoRM)) ?? c?.nomeControladoria ?? null;
    if (!grupo || !n) continue;
    const lista = porGrupo.get(grupo) ?? Array<number>(12).fill(0);
    lista[q.mes - 1] += n;
    porGrupo.set(grupo, lista);
  }
  const quadros = quadrosDeLotacao(grupos, porGrupo);
  const valores: Array<{ nome: string; valor: number | null }> = [
    { nome: "Quadro de Lotação Total", valor: ind.quadroDeLotacao },
    { nome: "Turnover", valor: ind.turnover },
    { nome: "Abertura de Vagas x Contratações", valor: ind.contratacoes },
    ...[...quadros]
      .filter(([nome]) => nome !== "Quadro de Lotação Total")
      .map(([nome, meses]) => ({ nome, valor: meses[q.mes - 1] ?? 0 })),
  ];
  return valores;
}

/** A lista do Quadro de Lotação do mês: os colaboradores por grupo de centros, unidade, departamento e atribuição. */
async function lotacaoApurada(db: Db, q: QuadroDoMes) {
  const centros = await centrosDoQuadro(db, q);
  const porLinha = new Map<string, { centroCusto: string; unidade: string | null; departamento: string | null; atribuicao: string | null; clt: number; pj: number }>();
  for (const [k, n] of q.final) {
    if (!n) continue;
    const [id, vinculo] = k.split("|");
    const c = centros.get(id);
    if (!c) continue;
    const centroCusto = c.nomeControladoria ?? c.nomeRM;
    const atribuicao = c.atribuicao === "DIRETA" ? "DIRETA" : c.atribuicao === "INDIRETA" ? "INDIRETA" : null;
    const chave = [centroCusto, c.unidadeNegocio?.nome ?? "", c.departamento ?? "", atribuicao ?? ""].join("|");
    const linha = porLinha.get(chave) ?? { centroCusto, unidade: c.unidadeNegocio?.nome ?? null, departamento: c.departamento, atribuicao, clt: 0, pj: 0 };
    if (vinculo === "PJ") linha.pj += n;
    else linha.clt += n;
    porLinha.set(chave, linha);
  }
  return [...porLinha.values()]
    .filter((l) => l.clt + l.pj > 0)
    .sort((a, b) => a.centroCusto.localeCompare(b.centroCusto, "pt-BR"))
    .map((l, k) => ({ ...l, total: l.clt + l.pj, linhaArquivo: k + 1 }));
}

async function competenciaDoFechamento(db: Db, anoMes: string) {
  const { ano, mes } = lerAnoMes(anoMes);
  const c = await db.competencia.findUnique({ where: { ano_mes: { ano, mes } }, select: { id: true, ano: true, mes: true, status: true } });
  if (!c) throw new QuadroError(404, `A competência ${mesAno(ano, mes)} não existe no Fechamento Mensal.`);
  return c;
}

export const apuracaoDoQuadroService = {
  /** A prévia: os valores do mês, com os registrados hoje (o importado ou o digitado) para comparar. */
  async previa(anoMes: string, tipo: TipoApurado) {
    const db = getPrismaClient();
    const c = await competenciaDoFechamento(db, anoMes);
    const q = await quadroDoMes(db, c.ano, c.mes);
    if (tipo === "INDICADORES_ADMIN") {
      const valores = await indicadoresApurados(db, q);
      const [importados, digitados] = await Promise.all([
        db.indicadorImportado.findMany({ where: { competenciaId: c.id, nome: { in: valores.map((v) => v.nome) } }, select: { nome: true, valor: true } }),
        db.indicadorDigitado.findMany({ where: { competenciaId: c.id, nome: { in: valores.map((v) => v.nome) } }, select: { nome: true, valor: true, origem: true } }),
      ]);
      const atual = new Map([
        ...importados.map((i) => [i.nome, { valor: Number(i.valor), origem: "IMPORTADO" }] as const),
        ...digitados.map((d) => [d.nome, { valor: Number(d.valor), origem: d.origem }] as const),
      ]);
      return { tipo, competencia: mesAno(c.ano, c.mes), indicadores: valores.map((v) => ({ ...v, atual: atual.get(v.nome) ?? null })) };
    }
    const linhas = await lotacaoApurada(db, q);
    const vigente = await db.importacao.findFirst({
      where: { competenciaId: c.id, tipo: "QUADRO_LOTACAO", status: "CONCLUIDA", substituidaEm: null, comparacao: false },
      orderBy: { importadoEm: "desc" },
      select: { nomeArquivo: true },
    });
    const totalAtual = vigente ? (await db.lotacaoCentro.aggregate({ where: { competenciaId: c.id }, _sum: { total: true } }))._sum.total : null;
    return { tipo, competencia: mesAno(c.ano, c.mes), lotacao: linhas, atual: vigente ? { nomeArquivo: vigente.nomeArquivo, total: totalAtual ?? 0 } : null };
  },

  async gravar(anoMes: string, tipo: TipoApurado, quem: Quem) {
    const db = getPrismaClient();
    const c = await competenciaDoFechamento(db, anoMes);
    if (c.status === "FECHADA") throw new QuadroError(409, `A competência ${mesAno(c.ano, c.mes)} está fechada: reabra-a para apurar.`);
    const q = await quadroDoMes(db, c.ano, c.mes);
    if (tipo === "INDICADORES_ADMIN") {
      const valores = (await indicadoresApurados(db, q)).filter((v) => v.valor !== null && Number.isFinite(v.valor));
      await db.$transaction(async (tx) => {
        for (const v of valores) {
          await tx.indicadorDigitado.upsert({
            where: { competenciaId_nome: { competenciaId: c.id, nome: v.nome } },
            create: { competenciaId: c.id, nome: v.nome, valor: v.valor!, digitadoPor: quem.id, origem: "APURADO" },
            update: { valor: v.valor!, digitadoPor: quem.id, digitadoEm: new Date(), origem: "APURADO" },
          });
        }
      });
      await auditar({ usuarioId: quem.id, acao: "APURACAO", entidade: "indicador_digitado", metadados: { competencia: mesAno(c.ano, c.mes), origem: "Quadro de Lotação", valores } });
      return { gravados: valores.length };
    }
    const linhas = await lotacaoApurada(db, q);
    if (!linhas.length) throw new QuadroError(409, `O Quadro de Lotação de ${mesAno(c.ano, c.mes)} não tem colaboradores: não há o que gravar.`);
    const conteudo = JSON.stringify({ origem: "Quadro de Lotação", competencia: anoMes, linhas });
    const soma = (k: "clt" | "pj" | "total") => linhas.reduce((s, l) => s + l[k], 0);
    const importacao = await db.$transaction(async (tx) => {
      const imp = await tx.importacao.create({
        data: {
          competenciaId: c.id,
          tipo: "QUADRO_LOTACAO",
          nomeArquivo: "Apurado no Quadro de Lotação (Gestão de Colaboradores)",
          hashArquivo: createHash("sha256").update(conteudo).digest("hex"),
          importadoPor: quem.id,
          status: "CONCLUIDA",
          progresso: 100,
          linhasLidas: linhas.length,
          linhasAceitas: linhas.length,
          linhasRejeitadas: 0,
          linhasIgnoradas: 0,
          resumo: { aba: "Quadro de Lotação (apurado)", modo: "APURADO", centros: linhas.length, clt: soma("clt"), pj: soma("pj"), total: soma("total"), zerados: 0, foraDoMes: 0 },
        },
        select: { id: true },
      });
      await gravarLotacaoDoMes(tx, c.id, imp.id, linhas);
      return imp;
    });
    await auditar({ usuarioId: quem.id, acao: "APURACAO", entidade: "importacao", entidadeId: importacao.id, metadados: { competencia: mesAno(c.ano, c.mes), tipo, centros: linhas.length, total: soma("total") } });
    return { gravados: linhas.length };
  },

  /** As movimentações aprovadas do mês (a lupa de um indicador apurado), com o tipo, a contagem e o centro. */
  async movimentos(anoMes: string) {
    const db = getPrismaClient();
    const { ano, mes } = lerAnoMes(anoMes);
    const c = await db.colaboradorCompetencia.findUnique({ where: { ano_mes: { ano, mes } }, select: { id: true } });
    if (!c) return { competencia: mesAno(ano, mes), itens: [] };
    const lista = await db.colaboradorMovimentacao.findMany({
      where: { competenciaId: c.id, status: "APROVADA" },
      orderBy: [{ data: "asc" }, { registradaEm: "asc" }],
      select: {
        id: true,
        data: true,
        vinculo: true,
        tipoMovimentacao: { select: { nome: true, contagem: true } },
        classificacao: { select: { nome: true } },
        centroCusto: { select: { codigoRM: true, nomeRM: true } },
        funcao: { select: { nome: true } },
        senioridade: { select: { nome: true } },
      },
    });
    return {
      competencia: mesAno(ano, mes),
      itens: lista.map((m) => ({
        id: m.id,
        data: m.data.toISOString().slice(0, 10),
        tipo: m.tipoMovimentacao.nome,
        contagem: m.tipoMovimentacao.contagem,
        classificacao: m.classificacao?.nome ?? null,
        centroCusto: `${m.centroCusto.codigoRM ? `${m.centroCusto.codigoRM} · ` : ""}${m.centroCusto.nomeRM}`,
        vinculo: m.vinculo,
        funcao: m.funcao.nome,
        senioridade: m.senioridade.nome,
      })),
    };
  },
};
