import { getPrismaClient } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { NaturezaReceita } from "../../generated/prisma/enums.js";
import { manualNoSinalDoBalancete, type Composicao, type OrigemValor, type ParcelaRateio } from "./apuracaoUnidades.js";
import { ACESSO_TOTAL, type Acesso } from "../acesso/acesso.js";
import { MENSAGEM_SENSIVEL, podeVerCentro, podeVerLinhaNaObra, podeVerLinhaNoCentro, podeVerMovimentos, podeVerSensiveis } from "../acesso/recorteDepartamento.js";
import { grupoDoCentro, RegraDREError } from "./dreService.js";
import { CENTRO_DE_OBRA, foraDaObra, ondeOCentroVale, PREVIAS_DA_OBRA, previasDaObra, sinalDaLinha } from "./obrasService.js";
import { numeroDaObra } from "../resultadosLinha/alocacaoNasLinhas.js";
import { plural } from "../../utils/plural.js";
import { deveriaTerCentro, ehGrupoSemCentro, grupoSemCentro, nomeDoGrupoSemCentro, veSemCentros } from "./semCentroService.js";

/**
 * Detalhamento de um valor da DRE até os lançamentos de origem (Passo 20).
 *
 * Parte da composição gravada na apuração: a origem de cada valor é um filtro
 * sobre os dados da competência (os lançamentos contábeis, os de rateio, os
 * manuais e a receita prévia), com o fator ou o percentual que a regra
 * aplicou. A soma das parcelas é o valor da linha; quando a linha é derivada
 * (uma receita líquida, uma guarda que zerou o valor), o detalhamento diz isso.
 */

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;
const rotulo = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;
const NOME_UNIDADE: Record<number, string> = { 1: "Matriz", 2: "Filial", 3: "Serviços", 4: "Despesas e Extra", 5: "RN" };
const ROTULO_NATUREZA: Record<string, string> = {
  PRE_FABRICADO: "Pré-Fabricado",
  FRETE: "Frete",
  DEVOLUCOES_INVENTARIOS: "Devoluções e Inventários",
  MONTAGEM: "Montagem",
  COMPLEMENTAR: "Complementar",
};
/** As chaves e os destinos dos rateios nos títulos dos blocos (15/10/2026: "Rateio: Produção → Matriz"). */
const ROTULO_RATEIO: Record<string, string> = {
  PRODUCAO: "Produção",
  PROJETO: "Projeto",
  METALURGIA: "Metalurgia",
  ARMADURA: "Armadura",
  ACOMPANHAMENTO: "Acompanhamento",
  MATRIZ: "Matriz",
  FILIAL: "Filial",
  SERVICOS: "Serviços",
  MONTAGEM: "Montagem",
  COMPLEMENTAR: "Complementar",
};
const rotuloRateio = (c: string) => ROTULO_RATEIO[c] ?? c.charAt(0) + c.slice(1).toLowerCase();

export type Visao = { unidade: number } | { consolidado: true } | { grupo: string } | { obra: string } | { semCentro: string };

type LancamentoDetalhe = {
  id: string;
  filial: number;
  centro: { codigoRM: string | null; nome: string | null } | null;
  conta: { reduzido: string; descricao: string };
  contaAdotada: { reduzido: string; descricao: string } | null;
  balde: string | null;
  alocacao: string | null;
  descricao?: string;
  valor: string;
  parcela: string;
  /**
   * As correções (27/10/2026): o centro do balancete (o original), quando o que vale é outro — por uma contestação —, e a
   * contestação aplicada (o número e o que ela mudou). A conta original é `conta`; a que vale, `contaAdotada`.
   */
  centroOriginal?: { codigoRM: string | null; nome: string | null } | null;
  contestacaoId?: string | null;
  contestacao?: { numero: number; centro: boolean; conta: boolean } | null;
  /** A parte de um movimento redistribuído (13/11/2026, Redistribuições de Gastos): o centro é o do destino; o original, o do movimento. */
  redistribuido?: boolean;
};

type Bloco =
  | {
      tipo: "CONTABIL" | "RATEIO" | "MANUAL";
      titulo: string;
      unidade?: number;
      filtro: string;
      fator?: string;
      percentual?: string;
      total: string;
      lancamentos: LancamentoDetalhe[];
    }
  // `obra` (03/11/2026): a receita prévia de uma obra (o número), na aba Obras; a memória de cálculo abre só com ela.
  | { tipo: "PREVIA"; titulo: string; unidade: number; natureza: string; componente: string; sinal: number; total: string; obra?: string };

const selecaoContabil = {
  id: true,
  filial: true,
  balde: true,
  alocacao: true,
  valorMovimento: true,
  codigoCentroCusto: true,
  nomeCentroCusto: true,
  centroCusto: { select: { codigoRM: true, nomeRM: true } },
  contaResultado: { select: { reduzido: true, descricao: true } },
  contaAdotada: { select: { reduzido: true, descricao: true } },
  contestacaoId: true,
  redistribuicaoId: true,
} satisfies Prisma.LancamentoContabilSelect;
type Contabil = Prisma.LancamentoContabilGetPayload<{ select: typeof selecaoContabil }>;

/**
 * As partes redistribuídas (13/11/2026) como lançamentos do extrato: o valor da parte, no centro, no rateio e na alocação do
 * destino, com a conta e o centro do balancete do movimento (o centro original aparece no ícone da correção).
 */
const selecaoParte = {
  id: true,
  filial: true,
  balde: true,
  alocacao: true,
  valorMovimento: true,
  redistribuicaoId: true,
  centroCusto: { select: { codigoRM: true, nomeRM: true } },
  lancamentoContabil: { select: { codigoCentroCusto: true, nomeCentroCusto: true, contaResultado: { select: { reduzido: true, descricao: true } }, contaAdotada: { select: { reduzido: true, descricao: true } } } },
} satisfies Prisma.LancamentoRedistribuidoSelect;
async function partesComoLancamentos(where: Prisma.LancamentoRedistribuidoWhereInput): Promise<Contabil[]> {
  const ps = await getPrismaClient().lancamentoRedistribuido.findMany({ where, select: selecaoParte });
  return ps.map(({ lancamentoContabil: l, ...p }) => ({
    ...p,
    codigoCentroCusto: l.codigoCentroCusto,
    nomeCentroCusto: l.nomeCentroCusto,
    contaResultado: l.contaResultado,
    contaAdotada: l.contaAdotada,
    contestacaoId: null,
  }));
}

function paraDetalhe(l: Contabil, multiplicador: Decimal): LancamentoDetalhe {
  const adotada = l.contaAdotada && l.contaAdotada.reduzido !== l.contaResultado.reduzido ? l.contaAdotada : null;
  return {
    id: l.id,
    filial: l.filial,
    centro:
      l.centroCusto || l.codigoCentroCusto
        ? { codigoRM: l.centroCusto?.codigoRM ?? l.codigoCentroCusto, nome: l.centroCusto?.nomeRM ?? l.nomeCentroCusto }
        : null,
    conta: l.contaResultado,
    contaAdotada: adotada,
    balde: l.balde,
    alocacao: l.alocacao,
    valor: l.valorMovimento.toFixed(2),
    parcela: l.valorMovimento.times(multiplicador).toFixed(2),
    // O centro do balancete, quando o que vale é outro (a contestação validada no balancete).
    centroOriginal: l.centroCusto && l.codigoCentroCusto && l.centroCusto.codigoRM !== l.codigoCentroCusto ? { codigoRM: l.codigoCentroCusto, nome: l.nomeCentroCusto } : null,
    contestacaoId: l.contestacaoId,
    ...(l.redistribuicaoId ? { redistribuido: true } : {}),
  };
}

const somar = (xs: Decimal[]) => xs.reduce((a, x) => a.plus(x), new Decimal(0));
const porValor = (a: { valor: string }, b: { valor: string }) => Math.abs(Number(b.valor)) - Math.abs(Number(a.valor));

/**
 * O extrato agrupado (15/10/2026): no balancete detalhado, cada movimento é um lançamento, e a mesma filial, centro e
 * conta se repetem. O extrato soma os movimentos de cada filial, centro, conta (e conta adotada, balde e alocação),
 * como antes; os movimentos aparecem no modal Balancete da conta.
 */
function agrupar(ls: Contabil[]): Contabil[] {
  const grupos = new Map<string, Contabil>();
  for (const l of ls) {
    // O movimento contestado fica à parte (27/10/2026): o ícone mostra o original e a contestação dele.
    const k = [l.filial, l.codigoCentroCusto ?? "", l.centroCusto?.codigoRM ?? "", l.contaResultado.reduzido, l.contaAdotada?.reduzido ?? "", l.balde ?? "", l.alocacao ?? "", l.contestacaoId ?? "", l.redistribuicaoId ?? ""].join("|");
    const g = grupos.get(k);
    if (g) g.valorMovimento = g.valorMovimento.plus(l.valorMovimento);
    else grupos.set(k, { ...l });
  }
  return [...grupos.values()].filter((g) => !g.valorMovimento.isZero());
}

/** Os blocos de origem de um valor apurado de unidade. */
async function blocosDaUnidade(competenciaId: string, unidade: number, c: Composicao): Promise<Bloco[]> {
  const prisma = getPrismaClient();
  const o: OrigemValor = c.origem ?? {};
  const blocos: Bloco[] = [];
  const naoRateio: Prisma.LancamentoContabilWhereInput = { OR: [{ alocacao: null }, { alocacao: { not: "RATEIO" } }] };

  // Os lançamentos manuais (21/10/2026) entram nas abas como lançamentos do balancete: os do mesmo filtro aparecem num
  // bloco à parte, com a parcela no sinal da DRE (o valor digitado, × o fator da regra levado ao sinal do balancete).
  const CHAVES = ["PROJETO", "PRODUCAO", "METALURGIA", "ARMADURA", "ACOMPANHAMENTO"];
  const selecaoManual = {
    id: true,
    filial: true,
    balde: true,
    descricao: true,
    motivo: true,
    valor: true,
    centroCusto: { select: { codigoRM: true, nomeRM: true } },
    contaResultado: { select: { reduzido: true, descricao: true } },
  } as const;
  type Manual = Prisma.LancamentoManualGetPayload<{ select: typeof selecaoManual }>;
  const linhaManual = (m: Manual, parcela: Decimal): LancamentoDetalhe => ({
    id: m.id,
    filial: m.filial,
    centro: m.centroCusto ? { codigoRM: m.centroCusto.codigoRM, nome: m.centroCusto.nomeRM } : null,
    conta: m.contaResultado ?? { reduzido: "—", descricao: m.descricao },
    contaAdotada: null,
    balde: m.balde,
    alocacao: "MANUAL",
    descricao: `${m.motivo} · ${m.descricao}`,
    valor: m.valor.toFixed(2),
    parcela: parcela.toFixed(2),
  });
  const sinalDaLinhaManual = async (linhaId: string) =>
    manualNoSinalDoBalancete((await prisma.linhaDRE.findUnique({ where: { id: linhaId }, select: { grupoSigla: true } }))?.grupoSigla ?? "", new Decimal(1));
  // `percentual`: nos de rateio (30/10/2026), o percentual da parcela, como nos contábeis (o "× %" e a coluna Na Linha).
  const blocoManual = async (where: Prisma.LancamentoManualWhereInput, linhaId: string, multiplicador: Decimal, titulo: string, filtro: string, percentual?: string) => {
    const ms = await prisma.lancamentoManual.findMany({ where: { competenciaId, linhaDREId: linhaId, ...where }, select: selecaoManual, orderBy: [{ criadoEm: "asc" }, { id: "asc" }] });
    if (!ms.length) return;
    const m = (await sinalDaLinhaManual(linhaId)).times(multiplicador);
    blocos.push({
      tipo: "MANUAL",
      titulo,
      unidade,
      filtro,
      ...(percentual ? { percentual } : {}),
      total: somar(ms.map((x) => x.valor.times(m))).toFixed(2),
      lancamentos: ms.map((x) => linhaManual(x, x.valor.times(m))).sort(porValor),
    });
  };

  const blocoContabil = async (f: NonNullable<OrigemValor["contabil"]>, titulo: string) => {
    const filtros: Prisma.LancamentoContabilWhereInput[] = [naoRateio];
    if (f.baldes) filtros.push({ balde: { in: f.baldes as never } });
    if (f.excetoBaldes) filtros.push({ OR: [{ balde: null }, { balde: { notIn: f.excetoBaldes as never } }] });
    if (f.pares) filtros.push({ OR: f.pares.map((p) => ({ balde: p.balde as never, ...(p.filial !== undefined ? { filial: p.filial } : {}) })) });
    // As partes redistribuídas (13/11/2026) do mesmo filtro: a alocação delas nunca é nula.
    const filtrosDasPartes: Prisma.LancamentoRedistribuidoWhereInput[] = [{ alocacao: { not: "RATEIO" } }];
    if (f.baldes) filtrosDasPartes.push({ balde: { in: f.baldes as never } });
    if (f.excetoBaldes) filtrosDasPartes.push({ OR: [{ balde: null }, { balde: { notIn: f.excetoBaldes as never } }] });
    if (f.pares) filtrosDasPartes.push({ OR: f.pares.map((p) => ({ balde: p.balde as never, ...(p.filial !== undefined ? { filial: p.filial } : {}) })) });
    const ls = [
      ...(await prisma.lancamentoContabil.findMany({
        where: { competenciaId, redistribuicaoId: null, linhaDREId: f.linhaId, ...(f.filial !== undefined ? { filial: f.filial } : {}), AND: filtros },
        select: selecaoContabil,
        orderBy: { linhaArquivo: "asc" },
      })),
      ...(await partesComoLancamentos({ competenciaId, linhaDREId: f.linhaId, ...(f.filial !== undefined ? { filial: f.filial } : {}), AND: filtrosDasPartes })),
    ];
    const fator = new Decimal(f.fator ?? 1);
    const partes = [
      f.pares ? null : f.filial !== undefined ? `filial ${f.filial}` : "todas as filiais",
      f.baldes ? `balde ${f.baldes.join(", ")}` : null,
      f.excetoBaldes ? `fora do balde ${f.excetoBaldes.join(", ")}` : null,
      f.pares ? f.pares.map((p) => (p.filial === undefined ? `balde ${p.balde}` : `balde ${p.balde} da filial ${p.filial}`)).join(" + ") : null,
    ].filter(Boolean);
    blocos.push({
      tipo: "CONTABIL",
      titulo,
      unidade,
      filtro: partes.join(" · "),
      fator: f.fator,
      total: somar(ls.map((l) => l.valorMovimento)).times(fator).toFixed(2),
      lancamentos: agrupar(ls).map((l) => paraDetalhe(l, fator)).sort(porValor),
    });
    // Os manuais do mesmo filtro (fora do balde RN, que é da aba RN, e dos baldes de rateio).
    const fm: Prisma.LancamentoManualWhereInput[] = [{ OR: [{ balde: null }, { balde: { notIn: ["RN", ...CHAVES] as never } }] }];
    if (f.baldes) fm.push({ balde: { in: f.baldes as never } });
    if (f.excetoBaldes) fm.push({ OR: [{ balde: null }, { balde: { notIn: f.excetoBaldes as never } }] });
    if (f.pares) fm.push({ OR: f.pares.map((p) => ({ balde: p.balde as never, ...(p.filial !== undefined ? { filial: p.filial } : {}) })) });
    await blocoManual({ ...(f.filial !== undefined ? { filial: f.filial } : {}), AND: fm }, f.linhaId, fator, titulo.replace("Lançamentos Contábeis", "Lançamentos Manuais"), partes.join(" · "));
  };
  if (o.contabil) await blocoContabil(o.contabil, "Lançamentos Contábeis Diretos");
  // Os Complementares (21/10/2026): os diretos do balde COMPLEMENTAR da linha equivalente da Montagem.
  if (o.contabilPar) await blocoContabil({ linhaId: o.contabilPar.linhaId, baldes: o.contabilPar.baldes }, "Lançamentos Contábeis Diretos da Linha da Montagem");

  for (const r of (c.rateios ?? []) as ParcelaRateio[]) {
    if (!r.linhaId) continue;
    // A parcela com os percentuais de outra competência (30/10/2026): só os lançamentos manuais que os levam.
    if (r.competenciaId) {
      await blocoManual(
        { balde: r.chave as never, competenciaMovimentoId: r.competenciaId },
        r.linhaId,
        new Decimal(r.percentual),
        `Lançamentos Manuais de Rateio: ${rotuloRateio(r.chave)} → ${rotuloRateio(r.destino)}, com os percentuais de ${r.competencia}`,
        `balde ${r.chave}, percentual de ${r.competencia}`,
        r.percentual,
      );
      continue;
    }
    const ls = [
      ...(await prisma.lancamentoContabil.findMany({
        where: { competenciaId, redistribuicaoId: null, linhaDREId: r.linhaId, alocacao: "RATEIO", balde: r.chave as never },
        select: selecaoContabil,
        orderBy: { linhaArquivo: "asc" },
      })),
      // As partes redistribuídas (13/11/2026) na chave do rateio.
      ...(await partesComoLancamentos({ competenciaId, linhaDREId: r.linhaId, alocacao: "RATEIO", balde: r.chave as never })),
    ];
    const p = new Decimal(r.percentual);
    blocos.push({
      tipo: "RATEIO",
      titulo: `Rateio: ${rotuloRateio(r.chave)} → ${rotuloRateio(r.destino)}`,
      unidade,
      filtro: `lançamentos de rateio do balde ${r.chave}, linha ${r.base.split(": ")[0]}`,
      percentual: r.percentual,
      total: somar(ls.map((l) => l.valorMovimento)).times(p).toFixed(2),
      lancamentos: agrupar(ls).map((l) => paraDetalhe(l, p)).sort(porValor),
    });
    // Os manuais do balde da chave (21/10/2026), na mesma linha de base, × o percentual.
    await blocoManual({ balde: r.chave as never, OR: [{ competenciaMovimentoId: null }, { competenciaMovimentoId: competenciaId }] }, r.linhaId, p, `Lançamentos Manuais de Rateio: ${rotuloRateio(r.chave)} → ${rotuloRateio(r.destino)}`, `balde ${r.chave}`, r.percentual);
  }

  if (o.manual) {
    const ms = await prisma.lancamentoManual.findMany({
      where: { competenciaId, linhaDREId: o.manual.linhaId, balde: o.manual.balde as never },
      orderBy: [{ criadoEm: "asc" }, { id: "asc" }],
      select: {
        id: true,
        filial: true,
        balde: true,
        descricao: true,
        motivo: true,
        valor: true,
        centroCusto: { select: { codigoRM: true, nomeRM: true } },
        contaResultado: { select: { reduzido: true, descricao: true } },
      },
    });
    blocos.push({
      tipo: "MANUAL",
      titulo: "Lançamentos Manuais",
      unidade,
      filtro: `balde ${o.manual.balde}`,
      total: somar(ms.map((m) => m.valor)).toFixed(2),
      lancamentos: ms
        .map((m) => ({
          id: m.id,
          filial: m.filial,
          centro: m.centroCusto ? { codigoRM: m.centroCusto.codigoRM, nome: m.centroCusto.nomeRM } : null,
          conta: m.contaResultado ?? { reduzido: "—", descricao: m.descricao },
          contaAdotada: null,
          balde: m.balde,
          alocacao: "MANUAL",
          descricao: `${m.motivo} · ${m.descricao}`,
          valor: m.valor.toFixed(2),
          parcela: m.valor.toFixed(2),
        }))
        .sort(porValor),
    });
  }

  for (const pv of o.previa ?? []) {
    const r = await prisma.receitaPrevia.findFirst({
      where: { competenciaId, natureza: pv.natureza as NaturezaReceita, unidadeNegocio: { codigo: pv.unidade } },
      select: { receitaBruta: true, receitaLiquida: true },
    });
    const v = r ? (pv.componente === "BRUTA" ? r.receitaBruta : r.receitaLiquida) : new Decimal(0);
    blocos.push({
      tipo: "PREVIA",
      titulo: `Receita Prévia: ${ROTULO_NATUREZA[pv.natureza] ?? pv.natureza} (${pv.componente === "BRUTA" ? "Bruta" : "Líquida"})${pv.sinal < 0 ? ", com sinal trocado" : ""}`,
      unidade: pv.unidade,
      natureza: pv.natureza,
      componente: pv.componente,
      sinal: pv.sinal,
      total: v.times(pv.sinal).toFixed(2),
    });
  }
  return blocos;
}

export const detalhamentoService = {
  /** O detalhamento de uma linha da DRE numa visão (unidade, consolidado ou agrupamento de centros). */
  async detalhar(ano: number, mes: number, codigo: string, visao: Visao, acesso: Acesso = ACESSO_TOTAL) {
    const prisma = getPrismaClient();
    const c = await prisma.competencia.findUnique({ where: { ano_mes: { ano, mes } }, select: { id: true } });
    if (!c) throw new RegraDREError(404, `A competência ${rotulo(ano, mes)} não existe.`);
    const linha = await prisma.linhaDRE.findUnique({ where: { codigo }, select: { id: true, codigo: true, descricao: true, tipo: true, grupoSigla: true, atribuicaoSigla: true } });
    if (!linha) throw new RegraDREError(404, `A linha ${codigo} não está na estrutura da DRE.`);
    // As informações sensíveis (27/10/2026): sem o acesso, nenhuma movimentação da Mão de Obra Direta e Indireta.
    if (!podeVerSensiveis(acesso, linha)) throw new RegraDREError(403, MENSAGEM_SENSIVEL(linha.descricao));
    // Recorte do Gestor (Passo 22): só as movimentações das linhas dos seus departamentos. O do Coordenador: nas
    // unidades, só as linhas abertas a todos; nos centros de custo, as dos seus centros.
    // Nas obras, as linhas que o usuário vê nelas (o Coordenador com a opção: as da gestão dele).
    const pode = "grupo" in visao ? podeVerLinhaNoCentro(acesso, linha) : "obra" in visao ? podeVerLinhaNaObra(acesso, linha) : podeVerMovimentos(acesso, linha);
    if (!pode) {
      throw new RegraDREError(403, `As movimentações de "${linha.descricao}" não são de um departamento seu.`);
    }

    let valor: Decimal | null = null;
    let regra: string | null = null;
    let observacao: string | null = null;
    const blocos: Bloco[] = [];
    let titulo: string;

    if ("semCentro" in visao) {
      // Os movimentos sem centro de custo (14/10/2026): os lançamentos da linha sem centro do cadastro, no grupo (a
      // filial, na Produção e na DVV).
      if (!ehGrupoSemCentro(visao.semCentro)) throw new RegraDREError(400, "Grupo dos movimentos sem centro de custo inválido.");
      if (!veSemCentros(acesso)) throw new RegraDREError(403, "Os movimentos sem centro de custo não são do seu recorte.");
      titulo = `Sem Centro de Custo · ${nomeDoGrupoSemCentro(visao.semCentro)}`;
      regra = "Lançamentos contábeis sem centro de custo do cadastro, nas contas de mão de obra e de gastos gerais, antes do rateio";
      const ls = deveriaTerCentro(linha)
        ? (await prisma.lancamentoContabil.findMany({ where: { competenciaId: c.id, linhaDREId: linha.id, centroCustoId: null, redistribuicaoId: null }, select: selecaoContabil, orderBy: { linhaArquivo: "asc" } })).filter(
            (l) => grupoSemCentro(linha.codigo, l.filial) === visao.semCentro,
          )
        : [];
      if (ls.length > 0) {
        valor = somar(ls.map((l) => l.valorMovimento));
        blocos.push({
          tipo: "CONTABIL",
          titulo: "Lançamentos Contábeis",
          filtro: "sem centro de custo do cadastro, diretos e de rateio",
          total: valor.toFixed(2),
          lancamentos: agrupar(ls).map((l) => paraDetalhe(l, new Decimal(1))).sort(porValor),
        });
      } else {
        observacao = "Linha que soma outras linhas do grupo: veja o detalhamento de cada uma.";
      }
    } else if ("obra" in visao) {
      // A obra (aba Obras): os lançamentos do centro de obra na linha, com o sinal da DRE (receitas trocadas). Nas receitas
      // (03/11/2026, pedido do Adão), sem as contas de Reconhecimento do CPV e com a receita prévia de frete e complementar
      // da obra, como na lista (obrasService).
      if (!CENTRO_DE_OBRA.test(visao.obra)) throw new RegraDREError(400, `${visao.obra} não é um centro de custo de obra (1.98 ou 1.99).`);
      const [todos, previas] = await Promise.all([
        // Pelo centro que vale (13/11/2026): sem os movimentos que saíram da obra.
        prisma.lancamentoContabil.findMany({ where: { competenciaId: c.id, linhaDREId: linha.id, ...ondeOCentroVale(visao.obra) }, select: selecaoContabil, orderBy: { linhaArquivo: "asc" } }),
        previasDaObra(c.id, visao.obra),
      ]);
      const ls = todos.filter((l) => !foraDaObra(linha.codigo, l.contaAdotada ?? l.contaResultado));
      titulo = `Obra ${todos[0]?.nomeCentroCusto ?? visao.obra} (${visao.obra})`;
      const receita = linha.codigo.startsWith("ROB.");
      const contabil = `lançamentos contábeis do centro de obra${receita ? " (sem as contas de Reconhecimento do CPV)" : ""}, diretos e de rateio, antes do rateio`;
      const entra = PREVIAS_DA_OBRA.find((p) => p.item === linha.codigo);
      const sai = PREVIAS_DA_OBRA.find((p) => p.de === linha.codigo);
      regra = entra
        ? `Receita bruta ${entra.natureza === "FRETE" ? "de frete" : "complementar"} da receita prévia da obra`
        : sai
          ? `${contabil.charAt(0).toUpperCase()}${contabil.slice(1)}, menos a receita prévia ${sai.natureza === "FRETE" ? "de frete" : "complementar"} da obra`
          : `${contabil.charAt(0).toUpperCase()}${contabil.slice(1)}`;
      if (ls.length > 0) {
        const fator = new Decimal(sinalDaLinha(linha.codigo));
        blocos.push({
          tipo: "CONTABIL",
          titulo: "Lançamentos Contábeis",
          filtro: `todas as filiais, diretos e de rateio${receita ? ", sem as contas de Reconhecimento do CPV" : ""}`,
          ...(fator.isNegative() ? { fator: "-1" } : {}),
          total: somar(ls.map((l) => l.valorMovimento)).times(fator).toFixed(2),
          lancamentos: agrupar(ls).map((l) => paraDetalhe(l, fator)).sort(porValor),
        });
      }
      for (const [p, sinal] of [entra ? ([entra, 1] as const) : null, sai ? ([sai, -1] as const) : null].filter((x) => x !== null)) {
        for (const [unidade, v] of [...(previas?.get(p.natureza) ?? [])].sort((a, b) => a[0] - b[0])) {
          blocos.push({
            tipo: "PREVIA",
            titulo: `Receita Prévia da Obra: ${ROTULO_NATUREZA[p.natureza]} (Bruta)${sinal < 0 ? ", com sinal trocado" : ""}`,
            unidade,
            natureza: p.natureza,
            componente: "BRUTA",
            sinal,
            total: v.times(sinal).toFixed(2),
            obra: numeroDaObra(visao.obra),
          });
        }
      }
      if (blocos.length > 0) valor = somar(blocos.map((b) => new Decimal(b.total)));
      const ignorados = todos.length - ls.length;
      observacao =
        ignorados > 0
          ? `Fora da obra: ${ignorados} ${plural(ignorados, "lançamento", "lançamentos")} das contas de Reconhecimento do CPV, que anulam o faturamento da obra (a DRE reconhece a receita na produção, sem obra).`
          : blocos.length === 0
            ? "Linha que soma outras linhas da obra: veja o detalhamento de cada uma."
            : null;
    } else if ("grupo" in visao) {
      titulo = `Centro de Custo ${visao.grupo}`;
      const centros = await prisma.centroCusto.findMany({ select: { id: true, nomeControladoria: true, departamento: true } });
      const ids = centros.filter((x) => grupoDoCentro(x) === visao.grupo && podeVerCentro(acesso, x)).map((x) => x.id);
      if (ids.length === 0) throw new RegraDREError(403, `O centro de custo ${visao.grupo} não é de um departamento seu.`);
      const [gravados, ls] = await Promise.all([
        prisma.resultadoApurado.findMany({ where: { competenciaId: c.id, linhaDREId: linha.id, centroCustoId: { in: ids } }, select: { valor: true, composicao: true } }),
        // Os redistribuídos (13/11/2026) pelas partes, nos centros dos destinos.
        Promise.all([
          prisma.lancamentoContabil.findMany({ where: { competenciaId: c.id, redistribuicaoId: null, linhaDREId: linha.id, centroCustoId: { in: ids } }, select: selecaoContabil, orderBy: { linhaArquivo: "asc" } }),
          partesComoLancamentos({ competenciaId: c.id, linhaDREId: linha.id, centroCustoId: { in: ids } }),
        ]).then(([diretos, partes]) => [...diretos, ...partes]),
      ]);
      // Antes da apuração (15/10/2026), a soma dos lançamentos.
      valor = gravados.length ? somar(gravados.map((g) => g.valor)) : ls.length ? somar(ls.map((l) => l.valorMovimento)) : null;
      regra = "Lançamentos contábeis dos centros do agrupamento, diretos e de rateio, antes do rateio";
      if (ls.length > 0) {
        blocos.push({
          tipo: "CONTABIL",
          titulo: "Lançamentos Contábeis",
          filtro: "todas as filiais, diretos e de rateio",
          total: somar(ls.map((l) => l.valorMovimento)).toFixed(2),
          lancamentos: agrupar(ls).map((l) => paraDetalhe(l, new Decimal(1))).sort(porValor),
        });
      } else if (valor) {
        observacao = "Linha que soma outras linhas do agrupamento: veja o detalhamento de cada uma.";
      }
    } else {
      const unidadeFiltro = "unidade" in visao ? { unidadeNegocio: { codigo: visao.unidade } } : { unidadeNegocioId: null };
      titulo = "unidade" in visao ? NOME_UNIDADE[visao.unidade] : "Consolidado";
      const gravado = await prisma.resultadoApurado.findFirst({
        where: { competenciaId: c.id, linhaDREId: linha.id, centroCustoId: null, ...unidadeFiltro },
        select: { valor: true, composicao: true },
      });
      if (!gravado) throw new RegraDREError(404, `A linha ${linha.descricao} não tem valor apurado em ${titulo} (${rotulo(ano, mes)}).`);
      valor = gravado.valor;
      const comp = gravado.composicao as Composicao | null;
      regra = comp?.regra ?? null;

      if ("unidade" in visao) {
        if (comp?.origem || comp?.rateios?.length) blocos.push(...(await blocosDaUnidade(c.id, visao.unidade, comp)));
      } else if (comp?.unidades?.length || linha.tipo !== "ITEM") {
        // Consolidado: a origem de cada unidade que compôs o item. Também num
        // total cuja origem está nas unidades: os Impostos Operacionais são, no
        // Consolidado, ROB − ROL, que é a soma dos lançamentos da linha em cada
        // unidade. Os demais totais não têm origem nas unidades (são somas de
        // linhas) e continuam com a observação de subtotal.
        const porUnidade = await prisma.resultadoApurado.findMany({
          where: { competenciaId: c.id, linhaDREId: linha.id, centroCustoId: null, unidadeNegocioId: { not: null } },
          select: { composicao: true, unidadeNegocio: { select: { codigo: true } } },
        });
        for (const r of porUnidade.sort((a, b) => a.unidadeNegocio!.codigo - b.unidadeNegocio!.codigo)) {
          const cu = r.composicao as Composicao | null;
          if (cu?.origem || cu?.rateios?.length) blocos.push(...(await blocosDaUnidade(c.id, r.unidadeNegocio!.codigo, cu)));
        }
      }
      if (blocos.length === 0) {
        observacao =
          linha.tipo === "ITEM" && !valor.isZero()
            ? "Valor derivado de outras linhas (a regra acima), sem lançamento de origem próprio."
            : linha.tipo === "ITEM"
              ? "Valor zero pela regra da unidade (a regra acima)."
              : "Subtotal ou total: soma das linhas que o compõem, pela estrutura da DRE.";
      }
    }

    // As contestações aplicadas nos lançamentos do extrato (27/10/2026): o número e o que cada uma mudou, para o ícone.
    const comContestacao = blocos.flatMap((b) => ("lancamentos" in b ? b.lancamentos : [])).filter((l) => l.contestacaoId);
    if (comContestacao.length) {
      const cs = await prisma.contestacao.findMany({
        where: { id: { in: [...new Set(comContestacao.map((l) => l.contestacaoId!))] } },
        select: { id: true, numero: true, centroNovoId: true, contaNovaId: true },
      });
      const porId = new Map(cs.map((x) => [x.id, x]));
      for (const l of comContestacao) {
        const x = porId.get(l.contestacaoId!);
        l.contestacao = x ? { numero: x.numero, centro: !!x.centroNovoId, conta: !!x.contaNovaId } : null;
      }
    }
    const somaOrigens = blocos.length ? somar(blocos.map((b) => new Decimal(b.total))) : null;
    return {
      competencia: { ano, mes },
      visao: titulo,
      linha: { codigo: linha.codigo, descricao: linha.descricao, tipo: linha.tipo },
      valor: valor?.toFixed(2) ?? null,
      regra,
      observacao,
      somaOrigens: somaOrigens?.toFixed(2) ?? null,
      blocos,
    };
  },
};
