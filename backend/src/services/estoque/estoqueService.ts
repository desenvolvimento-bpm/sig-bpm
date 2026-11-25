import { getPrismaClient } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { calcularEstoque, mediasPorLinha } from "./calculoEstoque.js";
import { chaveDaLinha, linhasPorChave } from "../../lib/linhas.js";

/** Erro de regra — vira 400/404/409 no controller, não 500. */
export class RegraEstoqueError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

const rotulo = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;
const anterior = (ano: number, mes: number) => (mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 });

async function competencia(ano: number, mes: number) {
  return getPrismaClient().competencia.findUnique({ where: { ano_mes: { ano, mes } }, select: { id: true, status: true } });
}

async function exigirCompetencia(ano: number, mes: number) {
  const c = await competencia(ano, mes);
  if (!c) throw new RegraEstoqueError(404, `A competência ${rotulo(ano, mes)} não existe.`);
  return c;
}

export const estoqueService = {
  /**
   * Apura o saldo da competência: o saldo do mês anterior mais o movimento do
   * mês. O primeiro mês da ferramenta (01/2026) parte do saldo inicial
   * importado (aba Estoque (2025)). Não reapura um saldo congelado.
   */
  async apurar(ano: number, mes: number) {
    const c = await exigirCompetencia(ano, mes);
    if (c.status === "FECHADA") throw new RegraEstoqueError(409, `A competência ${rotulo(ano, mes)} está fechada. Reapurar exige reabri-la.`);
    const prisma = getPrismaClient();
    if (await prisma.estoqueSaldo.count({ where: { competenciaId: c.id, congelado: true } })) {
      throw new RegraEstoqueError(409, `O saldo de ${rotulo(ano, mes)} está congelado pela apuração da competência. Para recalcular, reapure a competência (tela da DRE).`);
    }
    // O primeiro mês parte do saldo inicial importado; os demais, do saldo do mês anterior.
    const doSaldo = { saldoVolume: true, saldoValor: true, linhaTexto: true, obra: { select: { codigo: true } } } as const;
    let saldosAnteriores = await prisma.estoqueSaldoInicial.findMany({ where: { competenciaId: c.id }, select: doSaldo });
    if (saldosAnteriores.length === 0) {
      const a = anterior(ano, mes);
      const ca = await competencia(a.ano, a.mes);
      if (!ca) {
        throw new RegraEstoqueError(409, `${rotulo(ano, mes)} é o primeiro mês da ferramenta e não tem o saldo inicial do estoque. Importe-o (aba Estoque (2025)) nesta competência.`);
      }
      saldosAnteriores = await prisma.estoqueSaldo.findMany({ where: { competenciaId: ca.id }, select: doSaldo });
      if (saldosAnteriores.length === 0) throw new RegraEstoqueError(409, `O saldo de ${rotulo(a.ano, a.mes)} não existe. Apure o mês anterior.`);
    }

    const daLista = { competenciaId: c.id };
    const sel = { quantidade: true, nomePeca: true, obra: { select: { codigo: true } }, linha: { select: { codigo: true } } } as const;
    const [producoes, expedicoes, precos, estacas] = await Promise.all([
      prisma.producao.findMany({ where: daLista, select: { ...sel, secao: true, grupo: true } }),
      prisma.expedicao.findMany({ where: daLista, select: sel }),
      prisma.precoContrato.findMany({
        where: { substituidoEm: null },
        select: { versao: true, linhaTexto: true, contaResultado: true, valorUnitario: true, obra: { select: { codigo: true } } },
        orderBy: [{ vigenteDesde: "asc" }, { id: "asc" }],
      }),
      prisma.tabelaEstaca.findMany({ where: { vigenciaFim: null }, select: { grupo: true, secao: true, peca: true, precoLiquido: true } }),
    ]);
    const mov = (r: { quantidade: Prisma.Decimal; nomePeca: string | null; obra: { codigo: string } | null; linha: { codigo: string } | null; secao?: string | null; grupo?: string | null }) => ({
      obra: r.obra?.codigo ?? null,
      linha: r.linha ? chaveDaLinha(r.linha.codigo) : null,
      quantidade: r.quantidade,
      // Na produção, o grupo da peça (E, ES, ESD) do Resumo; na lista antiga, o nome da peça, de onde o grupo sai.
      nomePeca: r.grupo ?? r.nomePeca,
      secao: r.secao ?? null,
    });
    const { saldos, avisos } = calcularEstoque({
      anterior: saldosAnteriores.map((s) => ({ obra: s.obra.codigo, linha: s.linhaTexto, saldoVolume: s.saldoVolume, saldoValor: s.saldoValor })),
      producoes: producoes.map(mov),
      expedicoes: expedicoes.map(mov),
      precos: precos.map((p) => ({ obra: p.obra.codigo, versao: p.versao, linha: p.linhaTexto, contaResultado: p.contaResultado, valorUnitario: p.valorUnitario })),
      estacas,
    });

    const obras = new Map((await prisma.obra.findMany({ where: { codigo: { in: [...new Set(saldos.map((s) => s.obra))] } }, select: { id: true, codigo: true } })).map((o) => [o.codigo.toUpperCase(), o.id]));
    // A linha do saldo pelo Código ou pelo Nome (25/11/2026: o Código não muda; o Nome, sim).
    const linhas = linhasPorChave(await prisma.linha.findMany({ where: { tipo: "PRODUTO" }, select: { id: true, nome: true, codigo: true } }));
    const semObra = saldos.filter((s) => !obras.has(s.obra)).map((s) => s.obra);
    if (semObra.length) throw new RegraEstoqueError(409, `Obras sem cadastro no saldo: ${[...new Set(semObra)].join(", ")}. Importe a DRE do Comercial ou as listas que as cadastram.`);
    const agora = new Date();
    await prisma.$transaction([
      prisma.estoqueSaldo.deleteMany({ where: { competenciaId: c.id } }),
      prisma.estoqueSaldo.createMany({
        data: saldos.map((s) => ({
          competenciaId: c.id,
          obraId: obras.get(s.obra)!,
          linhaId: linhas.get(chaveDaLinha(s.linha))?.id ?? null,
          linhaTexto: s.linha,
          movimentoVolume: s.movimentoVolume,
          movimentoValor: s.movimentoValor,
          precoMovimento: s.precoMovimento,
          criterio: s.criterio,
          saldoVolume: s.saldoVolume,
          saldoValor: s.saldoValor,
          precoMedio: s.precoMedio,
          apuradoEm: agora,
        })),
      }),
    ]);
    return { ...(await this.consultar(ano, mes)), avisos };
  },

  /** O saldo da competência por obra e linha, e os preços médios da aba Estoque (Médias). */
  async consultar(ano: number, mes: number) {
    const c = await exigirCompetencia(ano, mes);
    const iniciais = await getPrismaClient().estoqueSaldoInicial.count({ where: { competenciaId: c.id } });
    const saldos = await getPrismaClient().estoqueSaldo.findMany({
      where: { competenciaId: c.id },
      orderBy: [{ linhaTexto: "asc" }, { obra: { codigo: "asc" } }],
      select: {
        linhaTexto: true,
        movimentoVolume: true,
        movimentoValor: true,
        precoMovimento: true,
        criterio: true,
        saldoVolume: true,
        saldoValor: true,
        precoMedio: true,
        apuradoEm: true,
        congelado: true,
        obra: { select: { codigo: true, nome: true } },
      },
    });
    const medias = mediasPorLinha(saldos.map((s) => ({ linha: s.linhaTexto, saldoVolume: s.saldoVolume, saldoValor: s.saldoValor })));
    const d = (x: Prisma.Decimal | null, n = 2) => (x === null ? null : x.toFixed(n));
    return {
      competencia: { ano, mes, status: c.status },
      apuradoEm: saldos[0]?.apuradoEm ?? null,
      congelado: saldos.some((s) => s.congelado),
      /** O mês parte do saldo inicial importado (o primeiro mês da ferramenta), não do mês anterior. */
      inicial: iniciais > 0,
      medias: Object.entries(medias).map(([linha, m]) => ({ linha, volume: m.volume.toFixed(3), valor: m.valor.toFixed(2), precoMedio: m.precoMedio.toFixed(2) })),
      saldos: saldos.map((s) => ({
        obra: s.obra.codigo,
        nomeObra: s.obra.nome,
        linha: s.linhaTexto,
        unidade: s.linhaTexto === "ESTRUTURA" ? "MATRIZ" : "FILIAL",
        movimentoVolume: d(s.movimentoVolume, 3),
        movimentoValor: d(s.movimentoValor),
        precoMovimento: d(s.precoMovimento),
        criterio: s.criterio,
        saldoVolume: d(s.saldoVolume, 3),
        saldoValor: d(s.saldoValor),
        precoMedio: d(s.precoMedio),
      })),
    };
  },
};
