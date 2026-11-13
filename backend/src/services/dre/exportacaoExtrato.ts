import { getPrismaClient } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { ESTILO, gerarXlsx, type AbaEscrita, type Celula } from "../../lib/xlsxEscrita.js";
import { ACESSO_TOTAL, type Acesso } from "../acesso/acesso.js";
import { detalhamentoService } from "./detalhamentoService.js";
import { documentosService } from "./documentosService.js";

/**
 * O extrato de um valor da DRE em Excel (24/10/2026, pedido do Adão: o botão Exportar dos modais do extrato e do
 * Balancete, em Resultados Empresariais e na DRE do mês). Duas abas:
 * - Movimentações: os lançamentos do extrato, como o modal os mostra (por bloco; no balancete detalhado, os movimentos de
 *   cada filial, centro, conta, balde e alocação somados), com a parcela na linha;
 * - Detalhes: os movimentos do balancete de cada lançamento, item a item (a emissão, o cliente ou fornecedor e o
 *   histórico), na ordem do extrato.
 * Do modal Balancete de uma conta (`recorte`), só os lançamentos dela (no centro e na filial, quando vêm) e, nos
 * detalhes, os movimentos que o modal mostra. As permissões são as do extrato e do balancete (o recorte do usuário).
 */

type Visao = Parameters<typeof detalhamentoService.detalhar>[3];
type Extrato = Awaited<ReturnType<typeof detalhamentoService.detalhar>>;
type Bloco = Extrato["blocos"][number];
type BlocoComLancamentos = Extract<Bloco, { lancamentos: unknown }>;
type Lancamento = BlocoComLancamentos["lancamentos"][number];
/** A conta do modal Balancete (o reduzido do balancete) e, com a caixa marcada, o centro e a filial do lançamento. */
export type RecorteDaConta = { conta: string; centro: string | null; filial: number | null };

const Decimal = Prisma.Decimal;
const rotuloMes = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;
const dataCurta = (d: Date | null) => (d ? d.toISOString().slice(0, 10).split("-").reverse().join("/") : null);
const texto = (v: string | number | null | undefined): Celula => ({ valor: v ?? null, estilo: ESTILO.item });
const moeda = (v: Prisma.Decimal | string | number): Celula => ({ valor: Number(v), estilo: ESTILO.itemMoeda });
const cabecalho = (colunas: Array<[string, number, boolean?]>) => colunas.map(([valor, , direita]) => ({ valor, estilo: direita ? ESTILO.cabecalhoDireita : ESTILO.cabecalho }));
const larguras = (colunas: Array<[string, number, boolean?]>) => colunas.map(([, w]) => w);
const total = (rotulo: string, colunaDoValor: number, valores: Array<Prisma.Decimal | string | number>): Celula[] => [
  { valor: rotulo, estilo: ESTILO.destaque },
  ...Array.from({ length: colunaDoValor - 1 }, () => ({ valor: null, estilo: ESTILO.destaque })),
  ...valores.map((v) => ({ valor: Number(v), estilo: ESTILO.destaqueMoeda })),
];

/** A conta que vale na DRE (a corrigida pela reclassificação) e a do balancete, quando foi corrigida. */
const contaNaDre = (l: { conta: { reduzido: string; descricao: string }; contaAdotada: { reduzido: string; descricao: string } | null }) => l.contaAdotada ?? l.conta;

/**
 * A chave que agrupa os movimentos num lançamento do extrato (a do `agrupar` do detalhamento; 13/11/2026: com o centro do
 * balancete e o que vale, a contestação e a redistribuição, para um lançamento não levar os movimentos de outro).
 */
const chaveDoLancamento = (l: Lancamento) =>
  [l.filial, l.centroOriginal?.codigoRM ?? l.centro?.codigoRM ?? "", l.centro?.codigoRM ?? "", l.conta.reduzido, l.contaAdotada?.reduzido ?? "", l.balde ?? "", l.alocacao ?? "", l.contestacaoId ?? "", l.redistribuido ? "R" : ""].join("|");

const selecaoMovimento = {
  filial: true,
  codigoCentroCusto: true,
  nomeCentroCusto: true,
  balde: true,
  alocacao: true,
  emissao: true,
  cliForn: true,
  historico: true,
  idMovimento: true,
  valorMovimento: true,
  centroCusto: { select: { codigoRM: true, nomeRM: true } },
  contaResultado: { select: { reduzido: true, descricao: true } },
  contaAdotada: { select: { reduzido: true, descricao: true } },
  contestacaoId: true,
} satisfies Prisma.LancamentoContabilSelect;
/** `redistribuido`: a parte de um movimento redistribuído (13/11/2026), com o valor da parte e o centro do destino. */
type Movimento = Prisma.LancamentoContabilGetPayload<{ select: typeof selecaoMovimento }> & { redistribuido?: boolean };

const chaveDoMovimento = (m: Movimento) => {
  const adotada = m.contaAdotada && m.contaAdotada.reduzido !== m.contaResultado.reduzido ? m.contaAdotada.reduzido : "";
  const vale = m.centroCusto?.codigoRM ?? m.codigoCentroCusto ?? "";
  return [m.filial, m.codigoCentroCusto ?? m.centroCusto?.codigoRM ?? "", vale, m.contaResultado.reduzido, adotada, m.balde ?? "", m.alocacao ?? "", m.contestacaoId ?? "", m.redistribuido ? "R" : ""].join("|");
};

/** As partes redistribuídas como movimentos (13/11/2026): o detalhe do movimento, com o valor e o centro da parte. */
const selecaoParte = {
  filial: true,
  balde: true,
  alocacao: true,
  valorMovimento: true,
  centroCusto: { select: { codigoRM: true, nomeRM: true } },
  lancamentoContabil: {
    select: { codigoCentroCusto: true, nomeCentroCusto: true, emissao: true, cliForn: true, historico: true, idMovimento: true, contaResultado: { select: { reduzido: true, descricao: true } }, contaAdotada: { select: { reduzido: true, descricao: true } } },
  },
} satisfies Prisma.LancamentoRedistribuidoSelect;

/** Os movimentos do balancete dos lançamentos de um bloco (uma consulta por bloco, em partes de 200 lançamentos). */
async function movimentosDoBloco(competenciaId: string, ls: Lancamento[]) {
  const prisma = getPrismaClient();
  const adotada = (l: Lancamento): Prisma.LancamentoContabilWhereInput =>
    l.contaAdotada ? { contaAdotada: { reduzido: l.contaAdotada.reduzido } } : { OR: [{ contaAdotadaId: null }, { contaAdotada: { reduzido: l.conta.reduzido } }] };
  // O centro que vale (13/11/2026; antes, o do balancete, e o movimento com o centro corrigido pela contestação ou pela
  // reclassificação por fornecedor ficava de fora): a chave do movimento acerta o resto.
  const onde = (l: Lancamento): Prisma.LancamentoContabilWhereInput => ({
    filial: l.filial,
    redistribuicaoId: null,
    contaResultado: { reduzido: l.conta.reduzido },
    AND: [{ OR: [{ codigoCentroCusto: l.centro?.codigoRM ?? null }, { centroCusto: { codigoRM: l.centro?.codigoRM ?? null } }] }, adotada(l)],
    balde: (l.balde ?? null) as never,
    alocacao: (l.alocacao ?? null) as never,
  });
  // As partes redistribuídas (13/11/2026): pelo centro do destino.
  const ondeParte = (l: Lancamento): Prisma.LancamentoRedistribuidoWhereInput => ({
    filial: l.filial,
    centroCusto: { codigoRM: l.centro?.codigoRM ?? null },
    balde: (l.balde ?? null) as never,
    alocacao: l.alocacao as never,
    lancamentoContabil: { contaResultado: { reduzido: l.conta.reduzido }, ...adotada(l) },
  });
  const porChave = new Map<string, Movimento[]>();
  const guardar = (m: Movimento) => porChave.set(chaveDoMovimento(m), [...(porChave.get(chaveDoMovimento(m)) ?? []), m]);
  const diretos = ls.filter((l) => !l.redistribuido);
  const redistribuidos = ls.filter((l) => l.redistribuido);
  for (let k = 0; k < diretos.length; k += 200) {
    const ms = await prisma.lancamentoContabil.findMany({
      where: { competenciaId, OR: diretos.slice(k, k + 200).map(onde) },
      select: selecaoMovimento,
      orderBy: [{ emissao: { sort: "asc", nulls: "first" } }, { linhaArquivo: "asc" }, { id: "asc" }],
    });
    for (const m of ms) guardar(m);
  }
  for (let k = 0; k < redistribuidos.length; k += 200) {
    const ps = await prisma.lancamentoRedistribuido.findMany({
      where: { competenciaId, OR: redistribuidos.slice(k, k + 200).map(ondeParte) },
      select: selecaoParte,
      orderBy: [{ lancamentoContabil: { emissao: { sort: "asc", nulls: "first" } } }, { lancamentoContabil: { linhaArquivo: "asc" } }, { id: "asc" }],
    });
    for (const { lancamentoContabil: l, ...p } of ps) guardar({ ...l, ...p, contestacaoId: null, redistribuido: true });
  }
  return porChave;
}

const COLUNAS_MOVIMENTACOES: Array<[string, number, boolean?]> = [
  ["Bloco", 44],
  ["Filtro", 40],
  ["Filial", 7],
  ["Centro de Custo", 16],
  ["Nome do Centro de Custo", 34],
  ["Conta", 10],
  ["Descrição da Conta", 36],
  ["Conta do Balancete", 12],
  ["Balde", 15],
  ["Observação", 36],
  ["Valor", 16, true],
  ["Na Linha", 16, true],
];
const COLUNAS_DETALHES: Array<[string, number, boolean?]> = [
  ["Bloco", 44],
  ["Filial", 7],
  // O ID do movimento no RM (10/11/2026), como no Balancete (Lista).
  ["ID", 10],
  ["Centro de Custo", 16],
  ["Nome do Centro de Custo", 34],
  ["Conta", 10],
  ["Descrição da Conta", 36],
  ["Conta do Balancete", 12],
  ["Balde", 15],
  ["Emissão", 11],
  ["Cliente/Fornecedor", 36],
  ["Histórico", 60],
  ["Valor", 16, true],
  ["Na Linha", 16, true],
];

export async function exportarExtrato(ano: number, mes: number, linha: string, visao: Visao, acesso: Acesso = ACESSO_TOTAL, recorte?: RecorteDaConta) {
  const prisma = getPrismaClient();
  const extrato = await detalhamentoService.detalhar(ano, mes, linha, visao, acesso);
  const c = await prisma.competencia.findUniqueOrThrow({ where: { ano_mes: { ano, mes } }, select: { id: true } });
  const unidades = new Map((await prisma.unidadeNegocio.findMany({ select: { codigo: true, nome: true } })).map((u) => [u.codigo, u.nome]));
  const consolidado = extrato.visao === "Consolidado";
  const tituloDoBloco = (b: Bloco) => `${consolidado && b.unidade ? `${unidades.get(b.unidade) ?? b.unidade} · ` : ""}${b.titulo}`;
  const daConta = (l: Lancamento) =>
    !recorte || (l.conta.reduzido === recorte.conta && (!recorte.centro || l.centro?.codigoRM === recorte.centro) && (!recorte.filial || l.filial === recorte.filial));
  const titulo = `${extrato.visao} · ${extrato.linha.descricao} · ${rotuloMes(ano, mes)}`;
  const geracao = `Gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`;

  // --- Movimentações ---------------------------------------------------------------------------------------------
  const movimentacoes: Celula[][] = [
    [{ valor: recorte ? `Extrato da Conta ${recorte.conta} · ${titulo}` : `Extrato · ${titulo}`, estilo: ESTILO.titulo }],
    [{ valor: extrato.regra ?? "Os lançamentos que formaram o valor, como foram apurados.", estilo: ESTILO.informacao }],
    ...(recorte ? [[{ valor: recorte.filial ? `Só a filial ${recorte.filial}${recorte.centro ? ` e o centro de custo ${recorte.centro}` : ""}.` : "Todas as filiais e centros de custo da conta.", estilo: ESTILO.informacao }]] : []),
    [{ valor: geracao, estilo: ESTILO.informacao }],
    [],
  ];
  const linhaCabecalhoMov = movimentacoes.length + 1;
  movimentacoes.push(cabecalho(COLUNAS_MOVIMENTACOES));
  let somaValor = new Decimal(0);
  let somaParcela = new Decimal(0);
  const blocosDoExtrato: Array<{ bloco: BlocoComLancamentos; lancamentos: Lancamento[] }> = [];
  for (const b of extrato.blocos) {
    if (b.tipo === "PREVIA") {
      if (recorte) continue;
      movimentacoes.push([texto(tituloDoBloco(b)), texto("receita prévia (memória de cálculo da receita)"), texto(null), texto(null), texto(null), texto(null), texto(null), texto(null), texto(null), texto(null), moeda(b.total), moeda(b.total)]);
      somaParcela = somaParcela.plus(b.total);
      continue;
    }
    const ls = b.lancamentos.filter(daConta);
    if (b.tipo !== "MANUAL") blocosDoExtrato.push({ bloco: b, lancamentos: ls });
    for (const l of ls) {
      const conta = contaNaDre(l);
      movimentacoes.push([
        texto(tituloDoBloco(b)),
        texto(b.filtro),
        texto(l.filial),
        texto(l.centro?.codigoRM ?? null),
        texto(l.centro?.nome ?? null),
        texto(conta.reduzido),
        texto(conta.descricao),
        texto(l.contaAdotada ? l.conta.reduzido : null),
        texto(l.balde),
        texto(l.descricao ?? null),
        moeda(l.valor),
        moeda(l.parcela),
      ]);
      somaValor = somaValor.plus(l.valor);
      somaParcela = somaParcela.plus(l.parcela);
    }
  }
  movimentacoes.push(total("Soma", COLUNAS_MOVIMENTACOES.length - 2, [somaValor, somaParcela]));
  if (!recorte && extrato.valor !== null) movimentacoes.push(total("Valor da linha", COLUNAS_MOVIMENTACOES.length - 1, [extrato.valor]));

  // --- Detalhes ----------------------------------------------------------------------------------------------------
  const detalhes: Celula[][] = [
    [{ valor: recorte ? `Balancete da Conta ${recorte.conta} · ${titulo}` : `Detalhes · ${titulo}`, estilo: ESTILO.titulo }],
    [{ valor: "Os movimentos do balancete do mês (aba Balancete (Lista) do LISTAS REALIZADO (RESULTADOS)) de cada lançamento das Movimentações, item a item.", estilo: ESTILO.informacao }],
    [{ valor: geracao, estilo: ESTILO.informacao }],
    [],
  ];
  let linhaCabecalhoDet = detalhes.length + 1;
  let colunasDetalhes = COLUNAS_DETALHES;
  if (recorte) {
    // Os movimentos que o modal Balancete mostra: a conta do balancete no mês, no centro e na filial, quando vêm.
    colunasDetalhes = COLUNAS_DETALHES.filter(([n]) => !["Bloco", "Conta do Balancete", "Balde", "Na Linha"].includes(n));
    const b = await documentosService.listar(ano, mes, { linha, conta: recorte.conta, centro: recorte.centro, filial: recorte.filial }, acesso);
    if (!b.detalhado) detalhes.splice(3, 0, [{ valor: "O balancete deste mês foi importado sem o detalhe dos movimentos: cada linha é a soma da filial, do centro de custo e da conta.", estilo: ESTILO.aviso }]);
    linhaCabecalhoDet = detalhes.length + 1;
    detalhes.push(cabecalho(colunasDetalhes));
    let soma = new Decimal(0);
    for (const m of b.linhas) {
      detalhes.push([texto(m.filial), texto(m.idMovimento), texto(m.codigoCentroCusto), texto(m.nomeCentroCusto), texto(b.conta.reduzido), texto(b.conta.descricao), texto(dataCurta(m.emissao)), texto(m.cliForn), texto(m.historico), moeda(m.valor)]);
      soma = soma.plus(m.valor);
    }
    detalhes.push(total("Soma", colunasDetalhes.length - 1, [soma]));
  } else {
    detalhes.push(cabecalho(colunasDetalhes));
    let soma = new Decimal(0);
    let somaNaLinha = new Decimal(0);
    let algumDetalhe = false;
    for (const { bloco, lancamentos } of blocosDoExtrato) {
      if (!lancamentos.length) continue;
      const fator = new Decimal(bloco.percentual ?? bloco.fator ?? "1");
      const porChave = await movimentosDoBloco(c.id, lancamentos);
      for (const l of lancamentos) {
        for (const m of porChave.get(chaveDoLancamento(l)) ?? []) {
          const conta = contaNaDre(l);
          if (m.emissao || m.cliForn || m.historico) algumDetalhe = true;
          detalhes.push([
            texto(tituloDoBloco(bloco)),
            texto(m.filial),
            texto(m.idMovimento),
            texto(m.centroCusto?.codigoRM ?? m.codigoCentroCusto),
            texto(m.centroCusto?.nomeRM ?? m.nomeCentroCusto),
            texto(conta.reduzido),
            texto(conta.descricao),
            texto(l.contaAdotada ? l.conta.reduzido : null),
            texto(m.balde),
            texto(dataCurta(m.emissao)),
            texto(m.cliForn),
            texto(m.historico),
            moeda(m.valorMovimento),
            moeda(m.valorMovimento.times(fator).toDecimalPlaces(2)),
          ]);
          soma = soma.plus(m.valorMovimento);
          somaNaLinha = somaNaLinha.plus(m.valorMovimento.times(fator));
        }
      }
    }
    detalhes.push(total("Soma", colunasDetalhes.length - 2, [soma, somaNaLinha.toDecimalPlaces(2)]));
    if (!algumDetalhe && detalhes.length > linhaCabecalhoDet + 1) {
      detalhes.splice(3, 0, [{ valor: "O balancete deste mês foi importado sem o detalhe dos movimentos: cada linha é a soma da filial, do centro de custo e da conta.", estilo: ESTILO.aviso }]);
      linhaCabecalhoDet++;
    }
  }

  const abas: AbaEscrita[] = [
    { nome: "Movimentações", larguras: larguras(COLUNAS_MOVIMENTACOES), linhas: movimentacoes, linhaCabecalho: linhaCabecalhoMov, rodape: titulo, paisagem: true },
    { nome: "Detalhes", larguras: larguras(colunasDetalhes), linhas: detalhes, linhaCabecalho: linhaCabecalhoDet, rodape: titulo, paisagem: true },
  ];
  const mesArquivo = `${String(mes).padStart(2, "0")}-${ano}`;
  const nomeArquivo = recorte
    ? `Balancete ${recorte.conta} - ${extrato.linha.descricao} - ${mesArquivo}.xlsx`
    : `Extrato ${extrato.visao} - ${extrato.linha.descricao} - ${mesArquivo}.xlsx`;
  return {
    nomeArquivo: nomeArquivo.replace(/[\\/:*?"<>|]/g, "-"),
    tipo: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    conteudo: gerarXlsx(abas, titulo),
  };
}
