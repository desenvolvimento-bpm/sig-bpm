import { getPrismaClient } from "../../config/prisma.js";
import type { NaturezaReceita } from "../../generated/prisma/enums.js";
import { calcularReceita, separarPorVenda, totalizar, type DadosCalculo, type Registro } from "./calculoReceita.js";
import { chaveDaLinha } from "../../lib/linhas.js";
import { peloTexto } from "../../lib/ordemDoSqlite.js";

/** Erro de regra — vira 400/404/409 no controller, não 500. */
export class RegraReceitaError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

const rotulo = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;
const LOTE = 500;

export async function competenciaPorAnoMes(ano: number, mes: number) {
  const c = await getPrismaClient().competencia.findUnique({
    where: { ano_mes: { ano, mes } },
    select: { id: true, ano: true, mes: true, status: true },
  });
  if (!c) throw new RegraReceitaError(404, `A competência ${rotulo(ano, mes)} não existe.`);
  return c;
}

/** Lê tudo o que o cálculo precisa: listas da competência, preços vigentes e tabelas. */
async function carregarDados(competenciaId: string): Promise<DadosCalculo> {
  const prisma = getPrismaClient();
  const daLista = { competenciaId };
  const comuns = {
    id: true,
    quantidade: true,
    obra: { select: { codigo: true } },
    unidadeNegocio: { select: { codigo: true } },
    linha: { select: { codigo: true, unidadeNegocio: { select: { codigo: true } } } },
  } as const;
  type Bruto = { id: string; quantidade: Registro["quantidade"]; obra: { codigo: string } | null; unidadeNegocio: { codigo: number } | null; linha: { codigo: string; unidadeNegocio: { codigo: number } | null } | null };
  const registro = (r: Bruto, extra: Partial<Registro> = {}): Registro => ({
    id: r.id,
    obra: r.obra?.codigo ?? null,
    unidade: r.unidadeNegocio?.codigo ?? null,
    linha: r.linha ? chaveDaLinha(r.linha.codigo) : null,
    unidadeDaLinha: r.linha?.unidadeNegocio?.codigo ?? null,
    quantidade: r.quantidade,
    ...extra,
  });

  const [precos, estacas, movimentos, producoes, expedicoes, saidas, devolucoes, medicoes, lancamentos] = await Promise.all([
    // Numa ordem fixa (23/10/2026, PostgreSQL): o id gravado como preço da receita é o do primeiro do grupo.
    prisma.precoContrato.findMany({
      where: { substituidoEm: null },
      select: { id: true, versao: true, linhaTexto: true, atribuicao: true, departamento: true, valorUnitario: true, valorTotal: true, obra: { select: { codigo: true } } },
      orderBy: [{ vigenteDesde: "asc" }, { id: "asc" }],
    }),
    prisma.tabelaEstaca.findMany({ where: { vigenciaFim: null }, select: { grupo: true, secao: true, peca: true, precoLiquido: true } }),
    prisma.tipoMovimento.findMany({ where: { ativo: true }, select: { codigo: true } }),
    prisma.producao.findMany({ where: daLista, select: { ...comuns, nomePeca: true, secao: true, grupo: true } }),
    prisma.expedicao.findMany({ where: daLista, select: { ...comuns, nomePeca: true } }),
    prisma.saida.findMany({ where: daLista, select: { ...comuns, valor: true, creditos: true, movimento: true, nomeMovimento: true, tipoMovimento: { select: { descricao: true } } } }),
    prisma.devolucao.findMany({ where: daLista, select: { ...comuns, valor: true, creditos: true, movimento: true, nomeMovimento: true, tipoMovimento: { select: { descricao: true } } } }),
    prisma.medicao.findMany({ where: daLista, select: { ...comuns, valorMedido: true, tipoFaturamento: true } }),
    prisma.lancamentoReceita.findMany({
      where: daLista,
      select: { id: true, natureza: true, componente: true, valor: true, observacao: true, venda: true, unidadeNegocio: { select: { codigo: true } } },
    }),
  ]);

  return {
    precos: precos.map((p) => ({
      id: p.id,
      obra: p.obra.codigo,
      versao: p.versao,
      linha: p.linhaTexto,
      atribuicao: p.atribuicao,
      departamento: p.departamento,
      valorUnitario: p.valorUnitario,
      valorTotal: p.valorTotal,
    })),
    estacas,
    movimentos: new Set(movimentos.map((m) => m.codigo.trim().toUpperCase())),
    // Na produção, o grupo da peça (E, ES, ESD) do Resumo; na lista antiga, o nome da peça, de onde o grupo sai.
    producoes: producoes.map((r) => registro(r, { nomePeca: r.grupo ?? r.nomePeca, secao: r.secao })),
    expedicoes: expedicoes.map((r) => registro(r, { nomePeca: r.nomePeca })),
    // O Resumo não traz a descrição do movimento: a do cadastro de Tipos de Movimento.
    saidas: saidas.map((r) => registro(r, { valor: r.valor, creditos: r.creditos, movimento: r.movimento, nomeMovimento: r.nomeMovimento ?? r.tipoMovimento?.descricao ?? null })),
    devolucoes: devolucoes.map((r) => registro(r, { valor: r.valor, creditos: r.creditos, movimento: r.movimento, nomeMovimento: r.nomeMovimento ?? r.tipoMovimento?.descricao ?? null })),
    medicoes: medicoes.map((r) => registro(r, { valorMedido: r.valorMedido, tipoFaturamento: r.tipoFaturamento })),
    lancamentos: lancamentos.map((l) => ({
      id: l.id,
      unidade: l.unidadeNegocio.codigo,
      natureza: l.natureza,
      componente: l.componente,
      valor: l.valor,
      observacao: l.observacao,
      venda: l.venda,
    })),
  };
}

export const receitaPreviaService = {
  /**
   * Apura a receita prévia da competência e grava o resultado com a memória de
   * cálculo, substituindo a apuração anterior. Uma receita congelada (Passo 21)
   * não é refeita: o preço vigente de hoje não pode mover um mês já apurado.
   */
  async apurar(ano: number, mes: number) {
    const competencia = await competenciaPorAnoMes(ano, mes);
    if (competencia.status === "FECHADA") {
      throw new RegraReceitaError(409, `A competência ${rotulo(ano, mes)} está fechada. Reapurar exige reabri-la.`);
    }
    const prisma = getPrismaClient();
    const congelada = await prisma.receitaPrevia.count({ where: { competenciaId: competencia.id, congelado: true } });
    if (congelada > 0) {
      throw new RegraReceitaError(409, `A receita prévia de ${rotulo(ano, mes)} está congelada pela apuração da competência. Para recalcular, reapure a competência (tela da DRE).`);
    }

    const dados = await carregarDados(competencia.id);
    const { itens, avisos } = calcularReceita(dados);
    const totais = totalizar(itens);
    const unidades = new Map((await prisma.unidadeNegocio.findMany({ select: { id: true, codigo: true } })).map((u) => [u.codigo, u.id]));

    await prisma.$transaction(
      async (tx) => {
        await tx.receitaPrevia.deleteMany({ where: { competenciaId: competencia.id } });
        const agora = new Date();
        for (const t of totais) {
          const unidadeNegocioId = unidades.get(t.unidade);
          if (!unidadeNegocioId) throw new Error(`Unidade de negócio ${t.unidade} não cadastrada`);
          const rp = await tx.receitaPrevia.create({
            data: {
              competenciaId: competencia.id,
              unidadeNegocioId,
              natureza: t.natureza,
              receitaBruta: t.receitaBruta,
              impostos: t.impostos,
              receitaLiquida: t.receitaLiquida,
              variacaoEstoque: t.variacaoEstoque,
              apuradoEm: agora,
            },
            select: { id: true },
          });
          const seus = itens.filter((i) => i.unidade === t.unidade && i.natureza === t.natureza);
          for (let i = 0; i < seus.length; i += LOTE) {
            await tx.receitaPreviaItem.createMany({
              data: seus.slice(i, i + LOTE).map(({ unidade: _u, natureza: _n, ...item }) => ({ ...item, receitaPreviaId: rp.id })),
            });
          }
          const precoIds = [...new Set(seus.flatMap((i) => [i.precoBrutoId, i.precoLiquidoId]).filter((x): x is string => !!x))];
          if (precoIds.length) {
            await tx.receitaPreviaPreco.createMany({ data: precoIds.map((precoContratoId) => ({ receitaPreviaId: rp.id, precoContratoId })) });
          }
        }
      },
      { timeout: 120_000 },
    );

    return { ...(await this.consultar(ano, mes)), avisos };
  },

  /** A receita apurada, na forma da aba Receitas (Prévia): por unidade e natureza. */
  async consultar(ano: number, mes: number) {
    const competencia = await competenciaPorAnoMes(ano, mes);
    const prisma = getPrismaClient();
    const [receitas, porCriterio] = await Promise.all([
      prisma.receitaPrevia.findMany({
        where: { competenciaId: competencia.id },
        select: {
          natureza: true,
          receitaBruta: true,
          impostos: true,
          receitaLiquida: true,
          variacaoEstoque: true,
          apuradoEm: true,
          congelado: true,
          unidadeNegocio: { select: { codigo: true, nome: true } },
          _count: { select: { itens: true, precos: true } },
        },
      }),
      prisma.receitaPreviaItem.groupBy({
        by: ["criterio", "origem"],
        where: { receitaPrevia: { competenciaId: competencia.id } },
        _count: true,
      }),
    ]);
    // A separação em venda global e mercantil sai dos itens congelados com a
    // apuração. Somada aqui, não com groupBy: o adaptador do SQLite trunca as
    // somas (prisma/PORTABILIDADE.md).
    const paraSeparar = await prisma.receitaPreviaItem.findMany({
      where: { receitaPrevia: { competenciaId: competencia.id } },
      select: { venda: true, receitaBruta: true, receitaLiquida: true, receitaPrevia: { select: { natureza: true, unidadeNegocio: { select: { codigo: true } } } } },
    });
    const separacao = separarPorVenda(
      paraSeparar.map((i) => ({
        unidade: i.receitaPrevia.unidadeNegocio.codigo,
        natureza: i.receitaPrevia.natureza,
        venda: i.venda,
        receitaBruta: i.receitaBruta,
        receitaLiquida: i.receitaLiquida,
      })),
    );
    const observacoes = await prisma.receitaPreviaItem.groupBy({
      by: ["observacao"],
      where: { receitaPrevia: { competenciaId: competencia.id }, origem: { not: "LANCAMENTO" }, observacao: { not: null } },
      _count: true,
      orderBy: { observacao: "asc" },
    });
    return {
      competencia: { ano, mes, status: competencia.status },
      apuradoEm: receitas[0]?.apuradoEm ?? null,
      congelado: receitas.some((r) => r.congelado),
      receitas: receitas
        .map((r) => ({
          unidade: r.unidadeNegocio.codigo,
          unidadeNome: r.unidadeNegocio.nome,
          natureza: r.natureza,
          receitaBruta: r.receitaBruta.toFixed(2),
          impostos: r.impostos.toFixed(2),
          receitaLiquida: r.receitaLiquida.toFixed(2),
          variacaoEstoque: r.variacaoEstoque.toFixed(2),
          itens: r._count.itens,
          precos: r._count.precos,
        }))
        .sort((a, b) => a.unidade - b.unidade),
      porVenda: separacao.porNatureza.map((n) => ({
        unidade: n.unidade,
        natureza: n.natureza,
        global: { receitaBruta: n.global.receitaBruta.toFixed(2), receitaLiquida: n.global.receitaLiquida.toFixed(2) },
        mercantil: { receitaBruta: n.mercantil.receitaBruta.toFixed(2), receitaLiquida: n.mercantil.receitaLiquida.toFixed(2) },
      })),
      impostos: separacao.impostos.map((i) => ({
        unidade: i.unidade,
        pisCofinsGlobal: i.pisCofinsGlobal.toFixed(2),
        pisCofinsMercantil: i.pisCofinsMercantil.toFixed(2),
        iss: i.iss.toFixed(2),
        icms: i.icms.toFixed(2),
      })),
      criterios: porCriterio.map((c) => ({ criterio: c.criterio, origem: c.origem, itens: c._count })),
      observacoes: observacoes.map((o) => ({ observacao: o.observacao!, itens: o._count })),
    };
  },

  /** Memória de cálculo de uma natureza de uma unidade. */
  async itens(ano: number, mes: number, unidade: number, natureza: NaturezaReceita, pagina: number, porPagina: number) {
    const competencia = await competenciaPorAnoMes(ano, mes);
    const prisma = getPrismaClient();
    const where = { receitaPrevia: { competenciaId: competencia.id, natureza, unidadeNegocio: { codigo: unidade } } };
    // A origem pelo texto e os vazios primeiro, como no SQLite (23/10/2026: no PostgreSQL, o enum ordena pela declaração):
    // ordena-se aqui, e a página sai daqui.
    const todos = (
      await prisma.receitaPreviaItem.findMany({
        where,
        orderBy: [{ obraCodigo: { sort: "asc", nulls: "first" } }, { linha: { sort: "asc", nulls: "first" } }, { registroId: { sort: "asc", nulls: "first" } }, { id: "asc" }],
      })
    ).sort(peloTexto((i) => i.origem));
    const total = todos.length;
    const itens = todos.slice((pagina - 1) * porPagina, pagina * porPagina);
    const dec = (d: { toFixed: (n: number) => string } | null, n = 2) => (d === null ? null : d.toFixed(n));
    // O nome da obra, como na coluna Nome da Obra das abas de receita.
    const codigos = [...new Set(itens.map((i) => i.obraCodigo).filter((c): c is string => !!c))];
    const nomes = new Map((await prisma.obra.findMany({ where: { codigo: { in: codigos } }, select: { codigo: true, nome: true } })).map((o) => [o.codigo, o.nome]));
    return {
      itens: itens.map((i) => ({
        id: i.id,
        origem: i.origem,
        obra: i.obraCodigo,
        obraNome: i.obraCodigo && nomes.get(i.obraCodigo) !== i.obraCodigo ? (nomes.get(i.obraCodigo) ?? null) : null,
        detalhe: i.detalhe,
        detalheDescricao: i.detalheDescricao,
        linha: i.linha,
        quantidade: dec(i.quantidade, 6),
        criterio: i.criterio,
        precoBruto: dec(i.precoBruto),
        precoLiquido: dec(i.precoLiquido),
        // Com todas as casas: o modal soma os itens, e a soma dos arredondados se afastaria do apurado.
        receitaBruta: dec(i.receitaBruta, 6),
        receitaLiquida: dec(i.receitaLiquida, 6),
        variacaoEstoque: dec(i.variacaoEstoque, 6),
        observacao: i.observacao,
        venda: i.venda,
      })),
      total,
      pagina,
      porPagina,
    };
  },
};
