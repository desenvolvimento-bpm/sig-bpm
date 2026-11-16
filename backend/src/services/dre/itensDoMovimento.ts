import { getPrismaClient } from "../../config/prisma.js";

const rotulo = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;
const valor = (v: { toFixed: (n: number) => string } | null) => (v === null ? null : v.toFixed(2));
const quantidade = (v: { toString: () => string } | null) => (v === null ? null : v.toString());

/**
 * Os itens de um movimento do balancete (10/11/2026, pedido do Adão): o ID do movimento no RM (a coluna ID do Balancete
 * (Lista)) é o IDENTIFICADOR das abas Requisições (Lista) e Notas Fiscais (Lista) — um movimento é uma requisição ou uma
 * nota fiscal, com um ou mais itens. Busca-se em todas as competências importadas: o item vem na lista do mês em que
 * a requisição foi baixada ou a nota emitida, que pode não ser o do balancete.
 */
export const itensDoMovimentoService = {
  /** Quantos itens cada ID tem (para o botão Itens dos extratos). */
  async contar(ids: Array<string | null | undefined>) {
    const unicos = [...new Set(ids.filter((x): x is string => !!x))];
    const contagem = new Map<string, number>();
    if (!unicos.length) return contagem;
    const prisma = getPrismaClient();
    const [requisicoes, notas] = await Promise.all([
      prisma.requisicaoItem.groupBy({ by: ["identificador"], where: { identificador: { in: unicos } }, _count: { _all: true } }),
      prisma.notaFiscalItem.groupBy({ by: ["identificador"], where: { identificador: { in: unicos } }, _count: { _all: true } }),
    ]);
    for (const g of [...requisicoes, ...notas]) {
      if (g.identificador) contagem.set(g.identificador, (contagem.get(g.identificador) ?? 0) + g._count._all);
    }
    return contagem;
  },

  /** Os itens das requisições e das notas fiscais com o ID, na ordem do arquivo. */
  async listar(id: string) {
    const prisma = getPrismaClient();
    const competencia = { select: { ano: true, mes: true } } as const;
    const [requisicoes, notas] = await Promise.all([
      prisma.requisicaoItem.findMany({
        where: { identificador: id },
        select: {
          id: true,
          tipoMovimento: true,
          nomeTipoMovimento: true,
          dataBaixa: true,
          filial: true,
          codigoCentroCusto: true,
          nomeCentroCusto: true,
          projeto: true,
          contaContabil: true,
          descricaoConta: true,
          codigoProduto: true,
          descricaoItem: true,
          quantidade: true,
          valorUnitario: true,
          valorTotal: true,
          competencia,
        },
        orderBy: [{ competencia: { ano: "asc" } }, { competencia: { mes: "asc" } }, { linhaArquivo: "asc" }],
      }),
      prisma.notaFiscalItem.findMany({
        where: { identificador: id },
        select: {
          id: true,
          numero: true,
          dataEmissao: true,
          filial: true,
          codigoCentroCusto: true,
          nomeCentroCusto: true,
          projeto: true,
          fornecedor: true,
          codigoProduto: true,
          descricaoItem: true,
          quantidade: true,
          subtotal: true,
          desconto: true,
          valorTotal: true,
          cfop: true,
          tipoMovimento: true,
          nomeTipoMovimento: true,
          contaContabil: true,
          competencia,
        },
        orderBy: [{ competencia: { ano: "asc" } }, { competencia: { mes: "asc" } }, { linhaArquivo: "asc" }],
      }),
    ]);
    // A descrição das contas das notas (a lista não a traz): a do cadastro das Contas de Resultado.
    const reduzidos = [...new Set(notas.map((n) => n.contaContabil))];
    const contas = reduzidos.length
      ? new Map((await prisma.contaResultado.findMany({ where: { reduzido: { in: reduzidos } }, select: { reduzido: true, descricao: true } })).map((c) => [c.reduzido, c.descricao]))
      : new Map<string, string>();
    return {
      id,
      requisicoes: requisicoes.map((r) => ({
        id: r.id,
        competencia: rotulo(r.competencia.ano, r.competencia.mes),
        tipoMovimento: r.tipoMovimento,
        nomeTipoMovimento: r.nomeTipoMovimento,
        data: r.dataBaixa,
        filial: r.filial,
        codigoCentroCusto: r.codigoCentroCusto,
        nomeCentroCusto: r.nomeCentroCusto,
        projeto: r.projeto,
        contaContabil: r.contaContabil,
        descricaoConta: r.descricaoConta,
        codigoProduto: r.codigoProduto,
        descricaoItem: r.descricaoItem,
        quantidade: quantidade(r.quantidade),
        valorUnitario: valor(r.valorUnitario),
        valorTotal: r.valorTotal.toFixed(2),
      })),
      notas: notas.map((n) => ({
        id: n.id,
        competencia: rotulo(n.competencia.ano, n.competencia.mes),
        numero: n.numero,
        tipoMovimento: n.tipoMovimento,
        nomeTipoMovimento: n.nomeTipoMovimento,
        data: n.dataEmissao,
        filial: n.filial,
        codigoCentroCusto: n.codigoCentroCusto,
        nomeCentroCusto: n.nomeCentroCusto,
        projeto: n.projeto,
        fornecedor: n.fornecedor,
        contaContabil: n.contaContabil,
        descricaoConta: contas.get(n.contaContabil) ?? null,
        codigoProduto: n.codigoProduto,
        descricaoItem: n.descricaoItem,
        quantidade: quantidade(n.quantidade),
        subtotal: valor(n.subtotal),
        desconto: valor(n.desconto),
        cfop: n.cfop,
        valorTotal: n.valorTotal.toFixed(2),
      })),
    };
  },
};
export type ItensDoMovimento = Awaited<ReturnType<typeof itensDoMovimentoService.listar>>;
