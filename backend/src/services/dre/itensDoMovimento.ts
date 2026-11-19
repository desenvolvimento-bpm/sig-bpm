import { getPrismaClient } from "../../config/prisma.js";

const rotulo = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;
const valor = (v: { toFixed: (n: number) => string } | null) => (v === null ? null : v.toFixed(2));
const quantidade = (v: { toString: () => string } | null) => (v === null ? null : v.toString());

/**
 * O movimento do balancete cujos itens se buscam (19/11/2026): o ID do RM, a emissão e a competência (sem a emissão, vale o
 * mês dela).
 */
export type MovimentoDosItens = { idMovimento: string | null | undefined; emissao: Date | null | undefined; ano: number; mes: number };

/**
 * A distância máxima, em dias, entre a data do documento e a emissão do movimento (19/11/2026, pedido do Adão). O ID do
 * Balancete (Lista) só é o IDENTIFICADOR da requisição ou da nota nos movimentos delas: nos lotes da folha, nos juros, nos
 * seguros apropriados ou no ICMS diferencial pago, o mesmo número é outra coisa e coincide com o de documentos de outros
 * meses (a folha de 06/2026, ID 46872, com a Nota Fiscal 1391 de 01/2026). Na base de 13/11/2026, os casamentos de verdade
 * ficaram todos a até 5 dias (12 mil itens de notas e 49 mil de requisições) e os por coincidência, a 15 dias ou mais.
 */
export const JANELA_DOS_ITENS_EM_DIAS = 10;
const DIA = 86_400_000;
const mesInteiro = (ano: number, mes: number): [number, number] => [Date.UTC(ano, mes - 1, 1), Date.UTC(ano, mes, 0)];

/**
 * O documento é do movimento: a data dele (a emissão ou a saída da nota; a baixa da requisição; sem nenhuma, o mês da
 * competência em que veio) fica a até JANELA_DOS_ITENS_EM_DIAS dias da emissão do movimento (sem ela, do mês dele).
 */
export function documentoDoMovimento(m: MovimentoDosItens, datas: Array<Date | null>, competencia: { ano: number; mes: number }) {
  const [a, b] = m.emissao ? [m.emissao.getTime(), m.emissao.getTime()] : mesInteiro(m.ano, m.mes);
  const conhecidas = datas.filter((d): d is Date => !!d).map((d) => d.getTime());
  const [c, d] = conhecidas.length ? [Math.min(...conhecidas), Math.max(...conhecidas)] : mesInteiro(competencia.ano, competencia.mes);
  const janela = JANELA_DOS_ITENS_EM_DIAS * DIA;
  return c <= b + janela && d >= a - janela;
}

/** A chave de um movimento no resultado de `contar` (o ID, a emissão e a competência). */
export const chaveDoMovimento = (m: MovimentoDosItens) => `${m.idMovimento ?? ""}|${m.emissao ? m.emissao.toISOString().slice(0, 10) : ""}|${m.ano}-${m.mes}`;

/**
 * Os itens de um movimento do balancete (10/11/2026, pedido do Adão): o ID do movimento no RM (a coluna ID do Balancete
 * (Lista)) é o IDENTIFICADOR das abas Requisições (Lista) e Notas Fiscais (Lista) — um movimento é uma requisição ou uma
 * nota fiscal, com um ou mais itens. Busca-se em todas as competências importadas: o item vem na lista do mês em que
 * a requisição foi baixada ou a nota emitida, que pode não ser o do balancete. Desde 19/11/2026, só os documentos com a data
 * perto da emissão do movimento (documentoDoMovimento): o mesmo número em outra origem não traz itens.
 */
export const itensDoMovimentoService = {
  /** Quantos itens cada movimento tem (para o botão Itens dos extratos), pela chaveDoMovimento. */
  async contar(movimentos: MovimentoDosItens[]) {
    const contagem = new Map<string, number>();
    const unicos = [...new Set(movimentos.flatMap((m) => (m.idMovimento ? [m.idMovimento] : [])))];
    if (!unicos.length) return contagem;
    const prisma = getPrismaClient();
    const competencia = { select: { ano: true, mes: true } } as const;
    const [requisicoes, notas] = await Promise.all([
      prisma.requisicaoItem.findMany({ where: { identificador: { in: unicos } }, select: { identificador: true, dataBaixa: true, competencia } }),
      prisma.notaFiscalItem.findMany({ where: { identificador: { in: unicos } }, select: { identificador: true, dataEmissao: true, dataSaida: true, competencia } }),
    ]);
    const documentos = new Map<string, Array<{ datas: Array<Date | null>; competencia: { ano: number; mes: number } }>>();
    const guardar = (id: string | null, datas: Array<Date | null>, c: { ano: number; mes: number }) => {
      if (id) documentos.set(id, [...(documentos.get(id) ?? []), { datas, competencia: c }]);
    };
    for (const r of requisicoes) guardar(r.identificador, [r.dataBaixa], r.competencia);
    for (const n of notas) guardar(n.identificador, [n.dataEmissao, n.dataSaida], n.competencia);
    for (const m of movimentos) {
      if (!m.idMovimento) continue;
      const n = (documentos.get(m.idMovimento) ?? []).filter((x) => documentoDoMovimento(m, x.datas, x.competencia)).length;
      if (n) contagem.set(chaveDoMovimento(m), n);
    }
    return contagem;
  },

  /** Os itens das requisições e das notas fiscais do movimento (o ID e a data perto da emissão dele), na ordem do arquivo. */
  async listar(m: MovimentoDosItens) {
    const id = m.idMovimento ?? "";
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
          dataSaida: true,
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
    ]).then(([rs, ns]) => [
      // Só os documentos do movimento (19/11/2026): a data perto da emissão dele.
      rs.filter((r) => documentoDoMovimento(m, [r.dataBaixa], r.competencia)),
      ns.filter((n) => documentoDoMovimento(m, [n.dataEmissao, n.dataSaida], n.competencia)),
    ] as const);
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
