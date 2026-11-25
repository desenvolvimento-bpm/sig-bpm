import { getPrismaClient } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { LinhaEstrutura } from "../dre/apuracaoUnidades.js";
import { estrutura } from "../dre/dreService.js";
import { diasUteis } from "./calendario.js";
import { alocarCentros, contasDoGrupo, gruposDoCenario, type GrupoDoCenario } from "./centrosCenario.js";
import { baseDasMedias, ehContaDeEncargos, encargosDasMedias, encargosDoGrupo, maosDeObraDoGrupo, VENDAS_DOS_ENCARGOS } from "./encargosCenario.js";
import { gruposDasMedias, marcadoresDasMedias, tirarMarcadores, vendaDaBase } from "./maoDeObraDasMedias.js";
import { VENDA_LOTACAO_APRENDIZ, VENDA_LOTACAO_CLT, VENDA_LOTACAO_ESTAGIARIO, VENDA_LOTACAO_PJ, VENDAS_LOTACAO } from "./lotacaoCenario.js";
import { linhasDoQuadro, quadroDosGrupos, remuneracoesDoQuadro, type QuadroDoGrupo } from "./quadroDoCenario.js";
import { calcularInvestimentosEExtra } from "./investimentosCenario.js";
import { recalcular, UNIDADES } from "./edicaoCenario.js";
import { fatorNaUnidade, fatorNaVenda, GRUPOS_POR_UNIDADE, paresDaReceita, reajustarPorVenda, receitaLiquidaReajustada, resumoVazio } from "./reajustesCenario.js";
import { fatoresDoCenario, IMPOSTOS_OPERACIONAIS } from "./indicesCenario.js";
import { assinaturaDasRegras, percentuaisPelasRegras } from "../volumes/vigenciaDosRateios.js";
import { regrasDoCenario } from "./regrasDoCenario.js";
import { basesDosProjetos, ondeEstaoOsProjetos } from "./projetosCenario.js";

type Tx = Prisma.TransactionClient;

/**
 * As premissas dos cenários analíticos (13/10/2026, etapa 2): as tabelas Matriz, Filial e Serviços da tela Premissas e
 * o cálculo da DRE a partir delas. Em Matriz e Filial, uma tabela para a venda Global e outra para a Mercantil; em
 * Serviços, só a Global. Cada tabela tem, mês a mês:
 *
 * - Jornada: os dias úteis (o calendário — segunda a sexta menos os feriados nacionais —, editável);
 * - Produção e Serviços: a demanda diária de cada linha do cadastro Linhas da unidade, na Und. de Medida dela (nas
 *   linhas de "m³ e pistas", as pistas por dia e os m³ por pista: o m³ é o m³/pista × as pistas); o volume do mês é a
 *   demanda × os dias úteis. Na Matriz e na Filial (20/11/2026), também a Expedição Diária (m³), separada da produção: a
 *   Expedição no Mês (sem ela gravada, igual à produção) e o Volume de Estoque no Mês (a produção menos a expedição);
 * - Receita Operacional: por linha, a receita bruta média de cada conta da ROB (R$ por unidade da linha — o m³, nas
 *   de pistas), os impostos operacionais (%/ROB) e a receita líquida média (calculada);
 * - Custos de Produção / Serviços: por linha, as Matérias Primas, a Mão de Obra Terceirizada (14/10/2026) e os Gastos
 *   Gerais Variáveis (por conta) e o Estoque, em R$ por unidade da linha;
 * - Despesas Variáveis de Venda: por linha, os Gastos Gerais Variáveis da DVV (por conta), em R$ por unidade; as
 *   Comissões (15/10/2026) são um percentual sobre a receita bruta, e a conta das comissões se calcula dele.
 *
 * O valor de cada conta no mês é o volume × o valor unitário (sem ajustes: só as médias e as demandas, 15/10/2026); a
 * Variação do Estoque (20/11/2026), o Volume de Estoque × o custo unitário; a receita líquida, a bruta × (1 − os
 * impostos). As contas das tabelas somam-se na DRE da unidade (as de Global e Mercantil juntas), com os volumes
 * (produção, pistas, metalurgia, expedição e montagem), e os totais e o Consolidado se calculam pela Estrutura da DRE.
 * As demais contas (mão de obra, gastos gerais diretos e indiretos, depreciação, despesas e o extra-operacional) virão
 * dos centros de custo, dos investimentos e do extra-operacional (as próximas etapas).
 */

export type Venda = "GLOBAL" | "MERCANTIL";
export type UnidadePremissa = 1 | 2 | 3;
export const UNIDADES_PREMISSAS: readonly UnidadePremissa[] = [1, 2, 3];
export const VENDAS_DA_UNIDADE: Record<UnidadePremissa, Venda[]> = { 1: ["GLOBAL", "MERCANTIL"], 2: ["GLOBAL", "MERCANTIL"], 3: ["GLOBAL"] };
export const NOME_DA_UNIDADE: Record<UnidadePremissa, string> = { 1: "Matriz", 2: "Filial", 3: "Serviços" };
export const NOME_DA_VENDA: Record<Venda, string> = { GLOBAL: "Global", MERCANTIL: "Mercantil" };

/** As contas da DRE que as premissas usam. */
export const C = {
  RBPF: "ROB.RBPF.RECEITA_BRUTA_DO_PRE_FABRICADO",
  RBF: "ROB.RBF.RECEITA_BRUTA_DE_FRETE",
  RBM: "ROB.RBM.RECEITA_BRUTA_DE_MONTAGEM",
  RBC: "ROB.RBC.RECEITA_BRUTA_COMPLEMENTAR",
  RBDI: "ROB.RBDI.RECEITA_BRUTA_DE_DEVOLUCOES_E_INVENTARIO",
  PRODUCAO_M3: "P.PRODUCAO_DO_PRE_FABRICADO_M",
  PRODUCAO_PISTAS: "P.PRODUCAO_DO_PRE_FABRICADO_PISTAS",
  METALURGIA_KG: "P.PRODUCAO_DA_METALURGIA_KG",
  EXPEDICAO_M3: "S.EXPEDICAO_DO_PRE_FABRICADO_M",
  MONTAGEM_M3: "S.MONTAGEM_DO_PRE_FABRICADO_M",
  ACOMPANHAMENTO_D: "S.ACOMPANHAMENTO_DE_OBRA_D",
  COMISSOES: "DVV.GGV.COMISSOES_DE_REPRESENTANTES_E_TERCEIROS",
  VARIACAO_ESTOQUE: "CPP.E.VARIACAO_DO_ESTOQUE",
} as const;
/** A receita líquida de cada receita bruta. */
export const LIQUIDA_DA_BRUTA: Record<string, string> = {
  [C.RBPF]: "ROL.RLPF.RECEITA_LIQUIDA_DO_PRE_FABRICADO",
  [C.RBF]: "ROL.RLF.RECEITA_LIQUIDA_DE_FRETE",
  [C.RBM]: "ROL.RLM.RECEITA_LIQUIDA_DE_MONTAGEM",
  [C.RBC]: "ROL.RLC.RECEITA_LIQUIDA_COMPLEMENTAR",
  [C.RBDI]: "ROL.RLDI.RECEITA_LIQUIDA_DE_DEVOLUCOES_E_INVENTAR",
};
/**
 * Em Serviços, as linhas da receita de montagem (como as medições: Montagem e Vedação), com os custos na CSM; as
 * demais são complementares (a receita complementar e os custos na CSC).
 */
const LINHAS_DE_MONTAGEM = new Set(["MONTAGEM", "VEDAÇÃO"]);
/** O Frete e Descarga do DVV: em Serviços, só das linhas complementares (24/10/2026). */
const FRETE_DOS_COMPLEMENTARES = "DVV.GGV.FRETE_E_DESCARGA";
/**
 * As linhas complementares de Serviços com a receita de frete (20/11/2026, pedido do Adão: a Fundação): a Receita Bruta de
 * Frete, além da complementar, e a Receita Líquida de Frete dela (pelos impostos), com o Frete e Descarga dos complementares.
 */
export const LINHAS_COM_FRETE_EM_SERVICOS = new Set(["FUNDAÇÃO"]);
const PISTAS = "m³ e pistas";
/**
 * As linhas com a demanda de armadura (14/10/2026), em kg por unidade da linha (kg/m³, kg/kg, kg/m²…), e as com a
 * demanda de metalurgia, também em kg por unidade: as que consomem as peças da Metalurgia. A metalurgia das linhas dá o
 * rateio de Metalurgia e a Produção da Metalurgia (kg) da DRE de cada unidade.
 */
export const LINHAS_COM_ARMADURA = new Set(["ESTRUTURA", "ALVEOLARES", "ESTACAS", "MONTAGEM", "CAPEAMENTO", "METÁLICA"]);
export const LINHAS_COM_METALURGIA = new Set(["ESTRUTURA", "ALVEOLARES", "ESTACAS", "MONTAGEM", "CAPEAMENTO", "METÁLICA"]);
/**
 * As linhas que movimentam o estoque (20/11/2026, pedido do Adão: só as Estacas — produzidas para o estoque e baixadas dele
 * quando expedidas). Na referência realizada, a Variação do Estoque da unidade vai só para elas, por m³ do Volume de Estoque.
 */
export const LINHAS_COM_ESTOQUE = new Set(["ESTACAS"]);

/** Uma linha de produto ou de obra do cadastro Linhas, na unidade dela. */
export type LinhaDoCadastro = { codigo: string; nome: string; unidade: UnidadePremissa; medida: string };

/**
 * As linhas das premissas: as ativas do cadastro. A Metalúrgica saiu delas como linha de apoio (14/10/2026; antes, por um
 * conjunto fixo no código) e, desde 26/10/2026, está inativa no cadastro: a metalurgia é apoio pelo centro METALURGIA, e a
 * que as linhas consomem é a Metalúrgica (Interno) Unit. delas.
 */
export async function linhasDoCadastro(): Promise<LinhaDoCadastro[]> {
  const linhas = await getPrismaClient().linha.findMany({ where: { ativo: true, tipo: { in: ["PRODUTO", "OBRA"] } }, orderBy: { ordem: "asc" }, include: { unidadeNegocio: { select: { codigo: true } } } });
  return linhas
    .filter((l) => UNIDADES_PREMISSAS.includes(l.unidadeNegocio?.codigo as UnidadePremissa))
    .map((l) => ({ codigo: l.codigo, nome: l.nome, unidade: l.unidadeNegocio!.codigo as UnidadePremissa, medida: l.unidadeMedida || "und" }));
}

/** Uma linha da tabela: uma premissa (digitada) ou um cálculo. */
export type LinhaPremissa = {
  chave: string;
  secao: string;
  /** A linha de produto ou de obra da premissa (o subtítulo na tabela); nula na Jornada e no Resultado. */
  grupo: string | null;
  rotulo: string;
  und: string;
  tipo: "PREMISSA" | "CALCULO";
  casas: number;
};

/** As contas de custo e de DVV de uma linha: as da unidade (em Serviços, as da CSM ou da CSC, pela natureza da linha). */
export function contasDaLinha(est: LinhaEstrutura[], l: LinhaDoCadastro) {
  const daUnidade = (prefixo: string) => est.filter((x) => x.tipo === "ITEM" && x.unidades.includes(l.unidade) && x.codigo.startsWith(prefixo));
  const custo = l.unidade === 3 ? (LINHAS_DE_MONTAGEM.has(l.codigo) ? "CSM" : "CSC") : "CPP";
  return {
    // As devoluções e os inventários (14/10/2026), como receita unitária (negativa) nas linhas da Matriz e da Filial.
    // Em Serviços, a de montagem ou a complementar; na Fundação, também a de frete (20/11/2026).
    receitas:
      l.unidade === 3
        ? LINHAS_DE_MONTAGEM.has(l.codigo)
          ? [C.RBM]
          : [C.RBC, ...(LINHAS_COM_FRETE_EM_SERVICOS.has(l.codigo) ? [C.RBF] : [])]
        : [C.RBPF, C.RBF, C.RBDI],
    // A mão de obra terceirizada (14/10/2026) é custo unitário da linha: a de produção na Matriz e na Filial, a de
    // serviços em Serviços (não vem dos centros de custo). Desde 15/10/2026, antes das matérias primas.
    custos: [...daUnidade(`${custo}.MOT.`), ...daUnidade(`${custo}.MP.`), ...daUnidade(`${custo}.GGV.`), ...daUnidade(`${custo}.E.`)],
    // Em Serviços, o Frete e Descarga é só dos complementares (24/10/2026): as linhas de montagem não o têm.
    dvv: daUnidade("DVV.GGV.").filter((x) => !(custo === "CSM" && x.codigo === FRETE_DOS_COMPLEMENTARES)),
  };
}

const pistas = (l: LinhaDoCadastro) => l.medida === PISTAS;
/**
 * As linhas com a Expedição Diária (20/11/2026, pedido do Adão): as de m³ (e de pistas) da Matriz e da Filial, para separar a
 * demanda de produção da de expedição. O Volume de Estoque do mês é a produção menos a expedição.
 */
const comExpedicao = (l: LinhaDoCadastro) => l.unidade !== 3 && (l.medida === "m³" || pistas(l));
/** A unidade dos valores da linha: o m³ nas de pistas; a da linha nas demais. */
const undDoValor = (l: LinhaDoCadastro) => (pistas(l) ? "m³" : l.medida);
const nomeDaLinha = (l: LinhaDoCadastro) => `${l.nome} (${l.medida})`;
/** O destino dos rateios de uma linha: a unidade dela (em Serviços, a Montagem ou a Complementar, pela natureza). */
const destinoDaLinha = (l: LinhaDoCadastro) => (l.unidade === 1 ? "MATRIZ" : l.unidade === 2 ? "FILIAL" : LINHAS_DE_MONTAGEM.has(l.codigo) ? "MONTAGEM" : "COMPLEMENTAR");

/** As linhas de uma tabela (unidade e venda), na ordem da tela. */
export function linhasDaTabela(est: LinhaEstrutura[], linhas: LinhaDoCadastro[], unidade: UnidadePremissa): LinhaPremissa[] {
  const daUnidade = linhas.filter((l) => l.unidade === unidade);
  const descricao = new Map(est.map((x) => [x.codigo, x.descricao]));
  const r: LinhaPremissa[] = [];
  const add = (secao: string, grupo: string | null, chave: string, rotulo: string, und: string, tipo: LinhaPremissa["tipo"] = "PREMISSA", casas = 2) =>
    r.push({ chave, secao, grupo, rotulo, und, tipo, casas });
  add("JORNADA", null, "DIAS_UTEIS", "Dias Úteis", "dia", "PREMISSA", 0);
  for (const l of daUnidade) {
    const g = nomeDaLinha(l);
    if (pistas(l)) {
      add("PRODUÇÃO E SERVIÇOS", g, `DEMANDA:${l.codigo}`, "Demanda Diária", "pistas/dia");
      add("PRODUÇÃO E SERVIÇOS", g, `M3_PISTA:${l.codigo}`, "Volume por Pista", "m³/pista");
      add("PRODUÇÃO E SERVIÇOS", g, `VOLUME_PISTAS:${l.codigo}`, "Pistas no Mês", "pistas", "CALCULO");
      add("PRODUÇÃO E SERVIÇOS", g, `VOLUME:${l.codigo}`, "Volume no Mês", "m³", "CALCULO");
    } else {
      add("PRODUÇÃO E SERVIÇOS", g, `DEMANDA:${l.codigo}`, "Demanda Diária", `${l.medida}/dia`);
      add("PRODUÇÃO E SERVIÇOS", g, `VOLUME:${l.codigo}`, "Volume no Mês", l.medida, "CALCULO");
    }
    // A expedição (20/11/2026, pedido do Adão), separada da produção: a Expedição Diária em m³ e, calculados, a Expedição no
    // Mês e o Volume de Estoque no Mês (a produção menos a expedição), a base da Variação do Estoque.
    if (comExpedicao(l)) {
      add("PRODUÇÃO E SERVIÇOS", g, `EXPEDICAO:${l.codigo}`, "Expedição Diária", "m³/dia");
      add("PRODUÇÃO E SERVIÇOS", g, `VOLUME_EXPEDICAO:${l.codigo}`, "Expedição no Mês", "m³", "CALCULO");
      add("PRODUÇÃO E SERVIÇOS", g, `VOLUME_ESTOQUE:${l.codigo}`, "Volume de Estoque no Mês", "m³", "CALCULO");
    }
    // As bases dos rateios de armadura e de metalurgia (14/10/2026), em kg por unidade da linha (o volume × a demanda).
    if (LINHAS_COM_ARMADURA.has(l.codigo)) {
      add("PRODUÇÃO E SERVIÇOS", g, `ARMADURA:${l.codigo}`, "Armadura (Interno) Unit.", `kg/${undDoValor(l)}`);
      add("PRODUÇÃO E SERVIÇOS", g, `VOLUME_ARMADURA:${l.codigo}`, "Armadura (Interno) no Mês", "kg", "CALCULO");
    }
    if (LINHAS_COM_METALURGIA.has(l.codigo)) {
      add("PRODUÇÃO E SERVIÇOS", g, `METALURGIA:${l.codigo}`, "Metalúrgica (Interno) Unit.", `kg/${undDoValor(l)}`);
      add("PRODUÇÃO E SERVIÇOS", g, `VOLUME_METALURGIA:${l.codigo}`, "Metalúrgica (Interno) no Mês", "kg", "CALCULO");
    }
    if (l.unidade === 3) {
      add("PRODUÇÃO E SERVIÇOS", g, `ACOMPANHAMENTO:${l.codigo}`, "Acompanhamentos por Dia", "acomp./dia");
      add("PRODUÇÃO E SERVIÇOS", g, `VOLUME_ACOMPANHAMENTO:${l.codigo}`, "Acompanhamentos no Mês", "acomp.", "CALCULO");
    }
  }
  for (const l of daUnidade) {
    const g = nomeDaLinha(l);
    const u = undDoValor(l);
    for (const c of contasDaLinha(est, l).receitas) add("RECEITA OPERACIONAL", g, `RB:${l.codigo}:${c}`, `Receita Bruta Média: ${descricao.get(c)?.replace(/^Receita Bruta (d[eoa]s? )?/i, "") ?? c}`, `R$/${u}`);
    add("RECEITA OPERACIONAL", g, `IMPOSTOS:${l.codigo}`, "Impostos Operacionais", "%/ROB");
    add("RECEITA OPERACIONAL", g, `RL:${l.codigo}`, "Receita Líquida Média", `R$/${u}`, "CALCULO");
  }
  const secaoCustos = unidade === 3 ? "CUSTOS DE SERVIÇOS" : "CUSTOS DE PRODUÇÃO";
  for (const l of daUnidade) {
    const g = nomeDaLinha(l);
    for (const c of contasDaLinha(est, l).custos) add(secaoCustos, g, `CUSTO:${l.codigo}:${c.codigo}`, `${rotuloAtribuicao(c.codigo)}: ${c.descricao}`, `R$/${undDoValor(l)}`);
  }
  for (const l of daUnidade) {
    const g = nomeDaLinha(l);
    for (const c of contasDaLinha(est, l).dvv) {
      // As comissões (15/10/2026): o percentual sobre a receita bruta, e a conta calculada dele (a receita bruta média × %).
      const comissoes = c.codigo === C.COMISSOES;
      if (comissoes) add("DESPESAS VARIÁVEIS DE VENDA", g, `COMISSOES:${l.codigo}`, "Comissões", "%/ROB");
      add("DESPESAS VARIÁVEIS DE VENDA", g, `CUSTO:${l.codigo}:${c.codigo}`, `GGV: ${c.descricao}`, `R$/${undDoValor(l)}`, comissoes ? "CALCULO" : "PREMISSA");
    }
  }
  for (const [chave, rotulo] of RESULTADOS) add("RESULTADO DAS PREMISSAS", null, chave, rotulo, "R$", "CALCULO");
  return r;
}

const rotuloAtribuicao = (codigo: string) => (/\.MP\./.test(codigo) ? "MP" : /\.MOT\./.test(codigo) ? "MOT" : /\.GGV\./.test(codigo) ? "GGV" : /\.E\./.test(codigo) ? "Estoque" : "");

/** O resultado da tabela em R$, mês a mês (o que ela leva para a DRE), pelos prefixos das contas. */
const RESULTADOS: Array<[string, string]> = [
  ["RESULTADO:ROB", "Receita Bruta"],
  ["RESULTADO:ROL", "Receita Líquida"],
  ["RESULTADO:MP", "Matérias Primas"],
  ["RESULTADO:MOT", "Mão de Obra Terceirizada"],
  ["RESULTADO:GGV", "Gastos Gerais Variáveis"],
  ["RESULTADO:E", "Estoque"],
  ["RESULTADO:DVV", "Despesas Variáveis de Venda"],
];
const resultadoDaConta = (codigo: string) =>
  codigo.startsWith("ROB.") ? "RESULTADO:ROB" : codigo.startsWith("ROL.") ? "RESULTADO:ROL" : codigo.startsWith("DVV.") ? "RESULTADO:DVV" : /\.MP\./.test(codigo) ? "RESULTADO:MP" : /\.MOT\./.test(codigo) ? "RESULTADO:MOT" : /\.GGV\./.test(codigo) ? "RESULTADO:GGV" : /\.E\./.test(codigo) ? "RESULTADO:E" : null;

/** Lê uma premissa gravada (o mês 0 é a Média de Referência); sem valor gravado, undefined. */
export type Leitor = (chave: string, mes: number) => number | undefined;

/**
 * O cálculo de uma tabela: os valores de cada linha mês a mês (a premissa — a gravada ou o padrão — ou o cálculo), a
 * Média de Referência (a gravada; nos cálculos, a conta sobre as médias), as contas da DRE que ela gera e as bases dos
 * rateios dos centros de custo ("CHAVE|DESTINO": Produção pelo m³ produzido; Metalurgia e Armadura pelo kg das linhas — o
 * volume × a demanda por unidade; Acompanhamento pelos acompanhamentos de Serviços). A base do rateio de Projeto é a
 * Liberação de Projetos dos Indicadores Manuais (projetosCenario.ts), e não sai das tabelas; a venda não muda o cálculo.
 */
export function calcularTabela(est: LinhaEstrutura[], linhas: LinhaDoCadastro[], unidade: UnidadePremissa, ano: number, ler: Leitor, _venda: Venda = "GLOBAL") {
  const daUnidade = linhas.filter((l) => l.unidade === unidade);
  const meses = Array.from({ length: 12 }, (_, k) => k + 1);
  const valores = new Map<string, Array<number | null>>();
  const referencia = new Map<string, number | null>();
  const dre = new Map<string, number[]>();
  const bases = new Map<string, number[]>();
  const acumular = (m: Map<string, number[]>, chave: string, mes: number, v: number) => {
    if (!v) return;
    const lista = m.get(chave) ?? Array<number>(12).fill(0);
    lista[mes - 1] += v;
    m.set(chave, lista);
  };
  const somar = (codigo: string, mes: number, v: number) => acumular(dre, codigo, mes, v);
  const base = (chave: string, destino: string, mes: number, v: number) => acumular(bases, `${chave}|${destino}`, mes, v);
  const premissa = (chave: string, padrao: (mes: number) => number = () => 0) => {
    const lista = meses.map((m) => ler(chave, m) ?? padrao(m));
    valores.set(chave, lista);
    referencia.set(chave, ler(chave, 0) ?? null);
    return lista;
  };
  const dias = premissa("DIAS_UTEIS", (m) => diasUteis(ano, m));
  for (const l of daUnidade) {
    const demanda = premissa(`DEMANDA:${l.codigo}`);
    let volume: number[];
    if (pistas(l)) {
      const porPista = premissa(`M3_PISTA:${l.codigo}`);
      const qtd = demanda.map((d, k) => d * dias[k]);
      valores.set(`VOLUME_PISTAS:${l.codigo}`, qtd);
      volume = qtd.map((p, k) => p * porPista[k]);
      meses.forEach((m) => somar(C.PRODUCAO_PISTAS, m, qtd[m - 1]));
    } else {
      volume = demanda.map((d, k) => d * dias[k]);
    }
    valores.set(`VOLUME:${l.codigo}`, volume);
    // A expedição (20/11/2026): a Expedição Diária × os dias úteis; sem ela gravada no mês, a expedição é a produção (como antes),
    // e o Volume de Estoque (a produção menos a expedição) fica zero.
    let expedicao = volume;
    let estoque: number[] | null = null;
    if (comExpedicao(l)) {
      const k = `EXPEDICAO:${l.codigo}`;
      const diaria = premissa(k, (m) => (dias[m - 1] ? volume[m - 1] / dias[m - 1] : 0));
      expedicao = meses.map((m) => (ler(k, m) === undefined ? volume[m - 1] : diaria[m - 1] * dias[m - 1]));
      estoque = volume.map((v, i) => v - expedicao[i]);
      valores.set(`VOLUME_EXPEDICAO:${l.codigo}`, expedicao);
      valores.set(`VOLUME_ESTOQUE:${l.codigo}`, estoque);
    }
    // A armadura e a metalurgia: o volume × o kg por unidade da linha (14/10/2026; antes, a armadura por dia útil).
    const armadura = LINHAS_COM_ARMADURA.has(l.codigo) ? premissa(`ARMADURA:${l.codigo}`).map((a, k) => a * volume[k]) : Array<number>(12).fill(0);
    if (LINHAS_COM_ARMADURA.has(l.codigo)) valores.set(`VOLUME_ARMADURA:${l.codigo}`, armadura);
    const metalurgia = LINHAS_COM_METALURGIA.has(l.codigo) ? premissa(`METALURGIA:${l.codigo}`).map((a, k) => a * volume[k]) : Array<number>(12).fill(0);
    if (LINHAS_COM_METALURGIA.has(l.codigo)) valores.set(`VOLUME_METALURGIA:${l.codigo}`, metalurgia);
    const acompanhamentos = l.unidade === 3 ? premissa(`ACOMPANHAMENTO:${l.codigo}`).map((a, k) => a * dias[k]) : null;
    if (acompanhamentos) valores.set(`VOLUME_ACOMPANHAMENTO:${l.codigo}`, acompanhamentos);
    const destino = destinoDaLinha(l);
    // Os volumes da DRE: a produção (m³) e a expedição (a da Expedição Diária, 20/11/2026; antes, igual à produção) nas
    // fábricas, a metalurgia consumida pelas linhas da unidade, a montagem e os acompanhamentos em Serviços. E as bases dos
    // rateios dos centros de custo.
    for (const m of meses) {
      const v = volume[m - 1];
      if (l.unidade !== 3 && (l.medida === "m³" || pistas(l))) {
        somar(C.PRODUCAO_M3, m, v);
        somar(C.EXPEDICAO_M3, m, expedicao[m - 1]);
        base("PRODUCAO", destino, m, v);
        // A base do rateio de Projeto é a Liberação de Projetos dos Indicadores Manuais (projetosCenario.ts).
      } else if (l.unidade === 3 && l.codigo === "MONTAGEM") somar(C.MONTAGEM_M3, m, v);
      somar(C.METALURGIA_KG, m, metalurgia[m - 1]);
      base("METALURGIA", destino, m, metalurgia[m - 1]);
      base("ARMADURA", destino, m, armadura[m - 1]);
      if (acompanhamentos) {
        somar(C.ACOMPANHAMENTO_D, m, acompanhamentos[m - 1]);
        base("ACOMPANHAMENTO", destino, m, acompanhamentos[m - 1]);
      }
    }
    const contas = contasDaLinha(est, l);
    const impostos = premissa(`IMPOSTOS:${l.codigo}`);
    const liquida = Array<number>(12).fill(0);
    let liquidaRef: number | null = null;
    // A receita bruta média da linha (todas as contas, com as devoluções), a base das comissões.
    const brutaMedia = Array<number>(12).fill(0);
    let brutaRef: number | null = null;
    for (const c of contas.receitas) {
      const unitario = premissa(`RB:${l.codigo}:${c}`);
      for (const m of meses) {
        const bruta = volume[m - 1] * unitario[m - 1];
        somar(c, m, bruta);
        somar(LIQUIDA_DA_BRUTA[c], m, bruta * (1 - impostos[m - 1] / 100));
        liquida[m - 1] += unitario[m - 1] * (1 - impostos[m - 1] / 100);
        brutaMedia[m - 1] += unitario[m - 1];
      }
      const rb = referencia.get(`RB:${l.codigo}:${c}`);
      if (rb !== null && rb !== undefined) brutaRef = (brutaRef ?? 0) + rb;
      if (rb !== null && rb !== undefined) liquidaRef = (liquidaRef ?? 0) + rb * (1 - (referencia.get(`IMPOSTOS:${l.codigo}`) ?? 0) / 100);
    }
    valores.set(`RL:${l.codigo}`, liquida);
    referencia.set(`RL:${l.codigo}`, liquidaRef);
    for (const c of [...contas.custos, ...contas.dvv]) {
      const k = `CUSTO:${l.codigo}:${c.codigo}`;
      let unitario: number[];
      if (c.codigo === C.COMISSOES) {
        // As comissões: a receita bruta média × o percentual (como o volume sai da demanda); a conta gravada antes fica de fora.
        const pct = premissa(`COMISSOES:${l.codigo}`);
        unitario = brutaMedia.map((b, i) => (b * pct[i]) / 100);
        valores.set(k, unitario);
        const pctRef = referencia.get(`COMISSOES:${l.codigo}`);
        referencia.set(k, pctRef !== null && pctRef !== undefined && brutaRef !== null ? (brutaRef * pctRef) / 100 : null);
      } else unitario = premissa(k);
      // A Variação do Estoque (20/11/2026, pedido do Adão): o custo unitário × o Volume de Estoque (a produção menos a
      // expedição); as demais contas, × o volume produzido.
      const baseDoCusto = c.codigo === C.VARIACAO_ESTOQUE && estoque ? estoque : volume;
      for (const m of meses) somar(c.codigo, m, baseDoCusto[m - 1] * unitario[m - 1]);
    }
  }
  // O resultado da tabela em R$.
  for (const [chave] of RESULTADOS) valores.set(chave, Array<number>(12).fill(0));
  for (const [codigo, lista] of dre) {
    const r = resultadoDaConta(codigo);
    if (r) lista.forEach((v, k) => (valores.get(r)![k]! += v));
  }
  return { valores, referencia, dre, bases };
}

/**
 * As premissas do cenário inteiro (13/10/2026): por unidade e conta da DRE ("u|código"), os doze meses das tabelas (as de
 * Global e Mercantil somadas) e as bases dos rateios ("CHAVE|DESTINO"), somadas em todas as tabelas.
 */
export function calcularPremissas(est: LinhaEstrutura[], linhas: LinhaDoCadastro[], ano: number, gravadas: Array<{ unidade: number; venda: string; chave: string; mes: number; valor: unknown }>) {
  const dados = new Map(gravadas.map((p) => [`${p.unidade}|${p.venda}|${p.chave}|${p.mes}`, Number(p.valor)]));
  const somas = new Map<string, number[]>();
  // As contas de cada tabela ("unidade|venda|código", 21/11/2026): os reajustes dos Custos de Produção por venda.
  const porVenda = new Map<string, number[]>();
  const bases = new Map<string, number[]>();
  const juntar = (m: Map<string, number[]>, k: string, lista: number[]) => {
    const s = m.get(k) ?? Array<number>(12).fill(0);
    lista.forEach((x, i) => (s[i] += x));
    m.set(k, s);
  };
  for (const u of UNIDADES_PREMISSAS) {
    for (const v of VENDAS_DA_UNIDADE[u]) {
      const r = calcularTabela(est, linhas, u, ano, (chave, mes) => dados.get(`${u}|${v}|${chave}|${mes}`), v);
      for (const [codigo, lista] of r.dre) {
        juntar(somas, `${u}|${codigo}`, lista);
        juntar(porVenda, `${u}|${v}|${codigo}`, lista);
      }
      for (const [chave, lista] of r.bases) juntar(bases, chave, lista);
    }
  }
  return { somas, porVenda, bases, juntar };
}

/**
 * A conta Encargos e Benefícios dos grupos (19/10/2026; encargosCenario.ts): calculada nos doze meses, das Remunerações CLT
 * e das Horas Extras do grupo, dos percentuais e dos Benefícios Adicionais dele, e gravada nos centros do cenário (no lugar
 * do que havia nela; a Média de Referência, o mês 0, fica a do realizado), para a tela, as exportações e a DRE a lerem como
 * as outras contas. Devolve os valores dos meses dos centros, com os encargos calculados.
 */
async function materializarEncargos(
  tx: Tx,
  cenarioId: string,
  est: LinhaEstrutura[],
  grupos: GrupoDoCenario[],
  gravadas: Array<{ unidade: number; venda: string; chave: string; mes: number; valor: unknown }>,
  meses: Array<{ grupo: string; codigo: string; mes: number; valor: number }>,
  quadro: Map<string, QuadroDoGrupo>,
  dasMedias: Set<string>,
  bases: Map<string, number>,
) {
  const idDaConta = new Map(est.map((l) => [l.codigo, l.id]));
  const valor = new Map(meses.map((x) => [`${x.grupo}|${x.codigo}|${x.mes}`, x.valor]));
  const premissa = new Map(gravadas.filter((p) => p.unidade === 0 && VENDAS_DOS_ENCARGOS.has(p.venda)).map((p) => [`${p.venda}|${p.chave}|${p.mes}`, Number(p.valor)]));
  const calculados: Array<{ grupo: string; codigo: string; mes: number; valor: number }> = [];
  const doCadastro = new Set<string>();
  for (const g of grupos) {
    doCadastro.add(g.grupo);
    const codigos = contasDoGrupo(est, g).map((l) => l.codigo);
    // Os Salários dos Aprendizes (09/11/2026) e dos Estagiários (11/11/2026) do grupo (12/11/2026; antes, por mão de obra).
    const q = quadro.get(g.grupo);
    // A mão de obra das médias (22/11/2026): a base gravada de cada mão de obra (a Média de Referência do Replicar Médias), sem o
    // cálculo pelos percentuais.
    const r = dasMedias.has(g.grupo)
      ? encargosDasMedias(codigos, g.atribuicao, (codigo) => bases.get(`${g.grupo}|${codigo}`), (venda, mes) => premissa.get(`${venda}|${g.grupo}|${mes}`))
      : encargosDoGrupo(
      codigos,
      g.atribuicao,
      (codigo, mes) => valor.get(`${g.grupo}|${codigo}|${mes}`) ?? 0,
      (venda, mes) => premissa.get(`${venda}|${g.grupo}|${mes}`),
      (mes) => q?.salarios.aprendizes[mes - 1] ?? 0,
      (mes) => q?.salarios.estagiarios[mes - 1] ?? 0,
      // Os Benefícios Padrão do Quadro de Lotação do grupo (21/11/2026).
      (mes) => q?.beneficios[mes - 1] ?? 0,
    );
    for (const [codigo, lista] of r) lista.forEach((v, k) => (Math.abs(v) >= 0.00005 ? calculados.push({ grupo: g.grupo, codigo, mes: k + 1, valor: v }) : undefined));
  }
  const contasDeEncargos = est.filter((l) => l.tipo === "ITEM" && ehContaDeEncargos(l.codigo)).map((l) => l.id);
  await tx.cenarioCentro.deleteMany({ where: { cenarioId, grupo: { in: [...doCadastro] }, mes: { gte: 1, lte: 12 }, linhaDREId: { in: contasDeEncargos } } });
  for (let i = 0; i < calculados.length; i += 500)
    await tx.cenarioCentro.createMany({
      data: calculados.slice(i, i + 500).map((x) => ({ cenarioId, grupo: x.grupo, linhaDREId: idDaConta.get(x.codigo)!, mes: x.mes, valor: new Prisma.Decimal(x.valor.toFixed(4)) })),
    });
  return [...meses.filter((x) => !(doCadastro.has(x.grupo) && ehContaDeEncargos(x.codigo))), ...calculados];
}

/**
 * O Quadro de Lotação do cenário (09/11/2026, quadroDoCenario.ts): nos grupos com linhas, grava os Colaboradores
 * Aprendizes, Estagiários (11/11/2026), CLT e PJ (as premissas VENDAS_LOTACAO), e nos sem linhas, nenhum (12/11/2026: a aba,
 * alimentada pela Gestão de Colaboradores, é a única fonte da contagem); nos grupos com linhas, as Remunerações CLT e PJ dos
 * meses 1 a 12 — na mão de obra principal do grupo (12/11/2026: a CLT, os Salários dos Aprendizes, dos Estagiários e CLT; a
 * PJ, os Salários PJ); na outra, zero —, no lugar do que havia (a Média de Referência, o mês 0, fica); nos grupos sem linhas,
 * zero. Os grupos com a mão de obra das médias (`dasMedias`, 22/11/2026) ficam com as Remunerações que o Replicar Médias gravou.
 * Devolve os valores dos meses dos centros com elas.
 */
async function materializarQuadro(
  tx: Tx,
  cenarioId: string,
  est: LinhaEstrutura[],
  grupos: GrupoDoCenario[],
  quadro: Map<string, QuadroDoGrupo>,
  meses: Array<{ grupo: string; codigo: string; mes: number; valor: number }>,
  dasMedias: Set<string>,
) {
  const idDaConta = new Map(est.map((l) => [l.codigo, l.id]));
  const premissas: Array<{ cenarioId: string; unidade: number; venda: string; chave: string; mes: number; valor: Prisma.Decimal }> = [];
  const centros: Array<{ grupo: string; codigo: string; mes: number; valor: number }> = [];
  // As contas das Remunerações de cada grupo (11/11/2026: todos; sem linhas no Quadro de Lotação, zero).
  const remuneracoesDo = new Map<string, Set<string>>();
  for (const g of grupos) {
    const q = quadro.get(g.grupo);
    // Os colaboradores, só nos grupos com linhas (11/11/2026: os Aprendizes e os Estagiários à parte; os CLT e os PJ sem eles).
    if (q)
      for (const [venda, lista] of [
        [VENDA_LOTACAO_APRENDIZ, q.aprendizes],
        [VENDA_LOTACAO_ESTAGIARIO, q.estagiarios],
        [VENDA_LOTACAO_CLT, q.clt],
        [VENDA_LOTACAO_PJ, q.pj],
      ] as const)
        lista.forEach((v, k) => (v ? premissas.push({ cenarioId, unidade: 0, venda, chave: g.grupo, mes: k + 1, valor: new Prisma.Decimal(v.toFixed(6)) }) : undefined));
    const doGrupo = new Set<string>();
    // A mão de obra das médias (22/11/2026, maoDeObraDasMedias.ts): as Remunerações do grupo ficam as que o Replicar Médias gravou.
    if (dasMedias.has(g.grupo)) continue;
    for (const mo of maosDeObraDoGrupo(contasDoGrupo(est, g).map((l) => l.codigo), g.atribuicao)) {
      // Só a mão de obra principal recebe as remunerações do quadro (12/11/2026, pedido do Adão: não faz sentido prever MOI num
      // centro de custo que é MOD); a outra fica com zero.
      const s = mo.principal ? q?.salarios : undefined;
      for (const [codigo, clt] of [[mo.remuneracoes, true], [mo.remuneracoesPJ, false]] as const) {
        if (!idDaConta.has(codigo)) continue;
        doGrupo.add(codigo);
        if (!s) continue;
        for (let k = 0; k < 12; k++) {
          const r = remuneracoesDoQuadro(s, k);
          const v = clt ? r.clt : r.pj;
          if (Math.abs(v) >= 0.00005) centros.push({ grupo: g.grupo, codigo, mes: k + 1, valor: v });
        }
      }
    }
    if (doGrupo.size) remuneracoesDo.set(g.grupo, doGrupo);
  }
  // Os colaboradores só pela aba Quadro de Lotação (12/11/2026, pedido do Adão: a Gestão de Colaboradores é a única fonte da
  // contagem; antes, os grupos sem linhas ficavam com os digitados ou com os das listas do Quadro de Lotação do realizado):
  // em todos os grupos e meses, também a Média de Referência (o mês 0) — o grupo sem linhas fica sem colaboradores.
  await tx.cenarioPremissa.deleteMany({ where: { cenarioId, unidade: 0, venda: { in: VENDAS_LOTACAO } } });
  if (premissas.length) await tx.cenarioPremissa.createMany({ data: premissas });
  const ids = [...new Set([...remuneracoesDo.values()].flatMap((x) => [...x]))].map((c) => idDaConta.get(c)!);
  if (ids.length) await tx.cenarioCentro.deleteMany({ where: { cenarioId, grupo: { in: [...remuneracoesDo.keys()] }, mes: { gte: 1, lte: 12 }, linhaDREId: { in: ids } } });
  for (let i = 0; i < centros.length; i += 500)
    await tx.cenarioCentro.createMany({
      data: centros.slice(i, i + 500).map((x) => ({ cenarioId, grupo: x.grupo, linhaDREId: idDaConta.get(x.codigo)!, mes: x.mes, valor: new Prisma.Decimal(x.valor.toFixed(4)) })),
    });
  return [...meses.filter((x) => !remuneracoesDo.get(x.grupo)?.has(x.codigo)), ...centros];
}

/** As telas das alterações que a DRE ainda não tem (21/11/2026): o Recalcular dos Resultados conta cada uma. */
export type TelaDoRecalculo = "configuracoes" | "premissas" | "reajustes";
const CAMPO_DO_RECALCULO = { configuracoes: "recalculoConfiguracoes", premissas: "recalculoPremissas", reajustes: "recalculoReajustes" } as const;

/**
 * As linhas calculadas das premissas do analítico (21/11/2026, o Recalcular dos Resultados), sem a DRE: os colaboradores e as
 * Remunerações do Quadro de Lotação e a conta Encargos e Benefícios dos grupos — o que as abas das Premissas mostram calculado.
 * A DRE (os rateios, a depreciação, os reajustes e os totais) só se refaz no calcularAnalitico.
 */
export async function materializarPremissas(tx: Tx, cenarioId: string) {
  const [est, gravadas, grupos, valoresCentros] = await Promise.all([
    estrutura(),
    tx.cenarioPremissa.findMany({ where: { cenarioId } }),
    gruposDoCenario(cenarioId, tx),
    tx.cenarioCentro.findMany({ where: { cenarioId, mes: { gte: 1, lte: 12 } }, include: { linhaDRE: { select: { codigo: true } } } }),
  ]);
  const meses = valoresCentros.map((x) => ({ grupo: x.grupo, codigo: x.linhaDRE.codigo, mes: x.mes, valor: Number(x.valor) }));
  const quadro = quadroDosGrupos(await linhasDoQuadro(tx, cenarioId), grupos);
  const { dasMedias, bases } = await maoDeObraDoCalculo(tx, cenarioId, quadro, est, grupos, gravadas);
  const comQuadro = await materializarQuadro(tx, cenarioId, est, grupos, quadro, meses, dasMedias);
  await materializarEncargos(tx, cenarioId, est, grupos, gravadas, comQuadro, quadro, dasMedias, bases);
}

/**
 * A mão de obra das médias no cálculo (22/11/2026, maoDeObraDasMedias.ts): os grupos dela — os marcadores com a assinatura do quadro
 * de hoje; os vencidos (o quadro do grupo mudou) saem, e o grupo volta ao Quadro de Lotação — e a base dos Encargos e Benefícios de
 * cada mão de obra deles (grupo|conta → valor): a gravada; sem ela (logo depois do Replicar Médias, ou num marcador de antes das
 * bases), a da Média de Referência de agora (baseDasMedias), que fica gravada — outra referência não a muda.
 */
async function maoDeObraDoCalculo(
  tx: Tx,
  cenarioId: string,
  quadro: Map<string, QuadroDoGrupo>,
  est: LinhaEstrutura[],
  grupos: GrupoDoCenario[],
  gravadas: Array<{ unidade: number; venda: string; chave: string; mes: number; valor: unknown }>,
) {
  const { validos, vencidos } = gruposDasMedias(await marcadoresDasMedias(tx, cenarioId), quadro);
  await tirarMarcadores(tx, cenarioId, vencidos);
  const bases = new Map<string, number>();
  if (!validos.size) return { dasMedias: validos, bases };
  const gravada = new Map(gravadas.filter((p) => p.unidade === 0 && p.mes === 0 && validos.has(p.chave)).map((p) => [`${p.venda}|${p.chave}`, Number(p.valor)]));
  let medias: Map<string, number> | undefined;
  const novas: Array<{ cenarioId: string; unidade: number; venda: string; chave: string; mes: number; valor: Prisma.Decimal }> = [];
  for (const g of grupos) {
    if (!validos.has(g.grupo)) continue;
    for (const mo of maosDeObraDoGrupo(contasDoGrupo(est, g).map((l) => l.codigo), g.atribuicao)) {
      const venda = vendaDaBase(mo.direta);
      let base = gravada.get(`${venda}|${g.grupo}`);
      if (base === undefined) {
        medias ??= new Map(
          (await tx.cenarioCentro.findMany({ where: { cenarioId, mes: 0, grupo: { in: [...validos] } }, select: { grupo: true, valor: true, linhaDRE: { select: { codigo: true } } } })).map((x) => [
            `${x.grupo}|${x.linhaDRE.codigo}`,
            Number(x.valor),
          ]),
        );
        // Com as casas da premissa (6), para o cálculo de agora ser igual aos próximos.
        // A média dos Benefícios Adicionais: a premissa do mês 0 (`gravada` só tem o mês 0).
        base = Number(baseDasMedias(mo, (codigo) => medias!.get(`${g.grupo}|${codigo}`), (v) => gravada.get(`${v}|${g.grupo}`)).toFixed(6));
        novas.push({ cenarioId, unidade: 0, venda, chave: g.grupo, mes: 0, valor: new Prisma.Decimal(base.toFixed(6)) });
      }
      bases.set(`${g.grupo}|${mo.encargos}`, base);
    }
  }
  if (novas.length) await tx.cenarioPremissa.createMany({ data: novas });
  return { dasMedias: validos, bases };
}

/**
 * Uma gravação que muda a DRE do analítico (21/11/2026, pedido do Adão): refaz as linhas calculadas das premissas
 * (`materializarPremissas`, com `materializar`) e conta a alteração da tela para o Recalcular dos Resultados — a DRE fica como
 * estava até ele.
 */
export async function alteradoSemRecalcular(tx: Tx, cenarioId: string, tela: TelaDoRecalculo, materializar = true) {
  if (materializar) await materializarPremissas(tx, cenarioId);
  await tx.cenario.update({ where: { id: cenarioId }, data: { [CAMPO_DO_RECALCULO[tela]]: { increment: 1 } } });
}

/** As alterações ainda não recalculadas do analítico, por tela (os Reajustes com a caixa Aplicar Reajustes mudada). */
export function pendenciasDoRecalculo(c: { recalculoConfiguracoes: number; recalculoPremissas: number; recalculoReajustes: number; reajustesAplicados: boolean; reajustesCalculados: boolean }) {
  const reajustes = c.recalculoReajustes + (c.reajustesAplicados !== c.reajustesCalculados ? 1 : 0);
  return { configuracoes: c.recalculoConfiguracoes, premissas: c.recalculoPremissas, reajustes, total: c.recalculoConfiguracoes + c.recalculoPremissas + reajustes };
}

/**
 * Recalcula a DRE do cenário analítico (13/10/2026): as contas das premissas de cada unidade (as de Global e Mercantil
 * somadas), as dos grupos de centros de custo, alocadas às unidades pelo balde e pelos rateios — com os percentuais
 * das bases das premissas (centrosCenario.ts) —, e a depreciação (a base e a dos investimentos) e o extra-operacional
 * (investimentosCenario.ts) substituem a DRE inteira do cenário, e os totais e o Consolidado se
 * recalculam pela Estrutura da DRE. Como a DRE do analítico não se edita, ela é sempre a soma das premissas e dos centros.
 * Com os reajustes aplicados (11/11/2026, reajustesCenario.ts), as contas com Índice de Reajuste (as combinações dele) saem
 * multiplicadas pelo fator do índice em cada mês; devolve o resumo deles (as contas, os meses e as somas sem e com).
 */
export async function calcularAnalitico(tx: Tx, cenarioId: string) {
  const cenario = await tx.cenario.findUniqueOrThrow({ where: { id: cenarioId }, select: { ano: true, reajustesAplicados: true, indicesDosReajustes: true, aplicacaoDosReajustes: true } });
  const [est, linhas, gravadas, grupos, valoresCentros, investimentos, regras, projetos] = await Promise.all([
    estrutura(),
    linhasDoCadastro(),
    tx.cenarioPremissa.findMany({ where: { cenarioId } }),
    // Os grupos da cópia dos Centros de Custo do cenário (20/11/2026, Cadastros por cenário).
    gruposDoCenario(cenarioId, tx),
    tx.cenarioCentro.findMany({ where: { cenarioId }, include: { linhaDRE: { select: { codigo: true } } } }),
    tx.cenarioInvestimento.findMany({ where: { cenarioId } }),
    // As regras da cópia do cenário (21/11/2026: Configurações / Regras de Rateio), no lugar das de Cadastros Gerais.
    regrasDoCenario(tx, cenarioId),
    tx.cenarioIndicador.findMany({ where: ondeEstaoOsProjetos(cenarioId), select: { indicador: true, mes: true, valor: true } }),
  ]);
  const porCodigo = new Map(est.map((l) => [l.codigo, l]));
  const { somas, porVenda, bases, juntar } = calcularPremissas(est, linhas, cenario.ano, gravadas);
  // A base do rateio de Projeto (16/11/2026): a Liberação de Projetos dos Indicadores Manuais.
  for (const [chave, lista] of basesDosProjetos(projetos)) bases.set(chave, lista);
  // Só os meses: o mês 0 é a Média de Referência (15/10/2026).
  const meses = valoresCentros.filter((x) => x.mes >= 1 && x.mes <= 12).map((x) => ({ grupo: x.grupo, codigo: x.linhaDRE.codigo, mes: x.mes, valor: Number(x.valor) }));
  // O Quadro de Lotação do cenário (09/11/2026): os colaboradores e as remunerações dos grupos com linhas, antes dos encargos.
  const quadro = quadroDosGrupos(await linhasDoQuadro(tx, cenarioId), grupos);
  // A mão de obra das médias (22/11/2026): nos grupos dela, as Remunerações e os Encargos das Médias de Referência.
  const { dasMedias, bases: basesDasMedias } = await maoDeObraDoCalculo(tx, cenarioId, quadro, est, grupos, gravadas);
  const comQuadro = await materializarQuadro(tx, cenarioId, est, grupos, quadro, meses, dasMedias);
  const valoresDosCentros = await materializarEncargos(tx, cenarioId, est, grupos, gravadas, comQuadro, quadro, dasMedias, basesDasMedias);
  const alocados = alocarCentros(
    est,
    grupos,
    valoresDosCentros,
    // Os percentuais pelas regras de rateio de cada mês (14/10/2026): o fixo, ou as bases entre os destinos das por volume.
    percentuaisPelasRegras(regras, cenario.ano, bases),
  );
  // As regras deste cálculo: se mudarem depois, a tela Resultados pede o Recalcular. A DRE fica com todas as alterações
  // (21/11/2026): as pendências do Recalcular zeram, e os reajustes do cálculo são os da caixa Aplicar Reajustes.
  await tx.cenario.update({
    where: { id: cenarioId },
    data: { rateiosAssinatura: assinaturaDasRegras(regras), recalculoConfiguracoes: 0, recalculoPremissas: 0, recalculoReajustes: 0, reajustesCalculados: cenario.reajustesAplicados },
  });
  for (const [k, lista] of alocados) juntar(somas, k, lista);
  // A depreciação base, a dos investimentos e o extra-operacional (etapa 4).
  const outros = calcularInvestimentosEExtra(
    gravadas,
    investimentos.map((i) => ({ ...i, valorTotal: Number(i.valorTotal), valorPosUso: Number(i.valorPosUso) })),
  );
  for (const [k, lista] of outros) juntar(somas, k, lista);
  // Os reajustes (11/11/2026): o fator do índice de cada conta em cada mês. O resumo diz o que eles mudam (aplicados
  // ou não); só com eles aplicados os valores gravados saem reajustados.
  // Desde 21/11/2026, pelas combinações dos Índices de Reajuste (indicesCenario.ts), com a cópia dos Departamentos do cenário.
  const fatores = await fatoresDoCenario(tx, { id: cenarioId, ...cenario }, est);
  // Os Impostos Operacionais com índice (21/11/2026, o departamento Receita Operacional): em cada unidade, a ROL de cada produto
  // sai da ROB dele (com o reajuste dela) menos os impostos dele × o fator — a conta da ROL que faltar entra zerada.
  const paresDaRol = paresDaReceita(est);
  const fatorDosImpostos = (u: number) => fatorNaUnidade(fatores, IMPOSTOS_OPERACIONAIS, u);
  for (const u of UNIDADES) {
    if (!fatorDosImpostos(u)) continue;
    for (const [rol, rob] of paresDaRol) if (somas.has(`${u}|${rob}`) && !somas.has(`${u}|${rol}`)) somas.set(`${u}|${rol}`, Array<number>(12).fill(0));
  }
  const resumo = resumoVazio();
  const novos: Array<{ cenarioId: string; visao: number; linhaDREId: string; mes: number; valor: Prisma.Decimal }> = [];
  for (const [k, lista] of somas) {
    const [us, codigo] = k.split("|");
    const u = Number(us);
    const l = porCodigo.get(codigo);
    if (!l || l.tipo !== "ITEM" || !l.unidades.includes(u)) continue;
    // Nos Custos de Produção, o fator da conta na unidade (19/11/2026: um grupo da Matriz e um da Filial) e, desde 21/11/2026,
    // na venda (Global e Mercantil): cada venda com a parte dela (as premissas dela e o resto pelo volume dela).
    const porUnidade = GRUPOS_POR_UNIDADE[l.grupoSigla]?.find((g) => g.unidade === u);
    const doCPP = porUnidade
      ? reajustarPorVenda(
          lista,
          porUnidade.vendas.map((v) => ({
            venda: v.chave,
            premissas: porVenda.get(`${u}|${v.chave}|${codigo}`) ?? [],
            volume: porVenda.get(`${u}|${v.chave}|${C.PRODUCAO_M3}`) ?? [],
            fator: fatorNaVenda(fatores, codigo, u, v.chave),
          })),
        )
      : null;
    const f = porUnidade ? null : fatorNaUnidade(fatores, codigo, u);
    const fImpostos = paresDaRol.has(codigo) ? fatorDosImpostos(u) : undefined;
    const daRol = fImpostos ? receitaLiquidaReajustada(somas.get(`${u}|${paresDaRol.get(codigo)!}`) ?? [], fatorNaUnidade(fatores, paresDaRol.get(codigo)!, u), lista, fImpostos) : null;
    lista.forEach((x, m) => {
      if (Math.abs(x) < 0.00005 && !daRol) return;
      const reajustado = doCPP ? doCPP[m] : daRol ? daRol[m] : f ? x * f[m] : x;
      if (reajustado !== x) {
        resumo.contas.add(codigo);
        resumo.meses.add(m + 1);
        resumo.valores++;
        resumo.somaSem += x;
        resumo.somaCom += reajustado;
      }
      const valor = cenario.reajustesAplicados ? reajustado : x;
      if (Math.abs(valor) >= 0.00005) novos.push({ cenarioId, visao: u, linhaDREId: l.id, mes: m + 1, valor: new Prisma.Decimal(valor.toFixed(4)) });
    });
  }
  await tx.cenarioResultado.deleteMany({ where: { cenarioId } });
  for (let i = 0; i < novos.length; i += 500) await tx.cenarioResultado.createMany({ data: novos.slice(i, i + 500) });
  await recalcular(tx, cenarioId, Array.from({ length: 12 }, (_, k) => k + 1), UNIDADES, est);
  return { aplicados: cenario.reajustesAplicados, reajustes: resumo };
}

/**
 * Os valores de um grupo de centros com os reajustes da DRE (22/11/2026, pedido do Adão: na aba Centros de Custo dos Resultados,
 * com a DRE calculada com os reajustes, os totais batem com o Consolidado). Como no calcularAnalitico, cada conta do grupo vai às
 * unidades pelo rateio (alocarCentros: a unidade e a conta de destino — a parte da Complementar, na equivalente da CSC), e cada
 * parte sai multiplicada pelo fator da conta de destino na unidade; nos Custos de Produção da Matriz e da Filial, pelos das vendas,
 * na proporção do volume produzido de cada uma (como o resto da conta em reajustarPorVenda). O que o rateio não leva a nenhuma
 * unidade fica como está. `porConta`: os doze meses de cada conta do grupo; devolve os doze meses reajustados, na conta do grupo.
 */
export async function reajustarOGrupo(db: Tx, cenarioId: string, g: GrupoDoCenario, porConta: Map<string, number[]>) {
  const cenario = await db.cenario.findUniqueOrThrow({ where: { id: cenarioId }, select: { ano: true, indicesDosReajustes: true, aplicacaoDosReajustes: true } });
  const est = await estrutura();
  const fatores = await fatoresDoCenario(db, { id: cenarioId, ...cenario }, est);
  if (!fatores.size) return porConta;
  const { percentuais, fator } = await rateioDoCenario(db, cenarioId, cenario.ano, est, fatores);
  const r = new Map<string, number[]>();
  for (const [codigo, meses] of porConta) {
    const lista = [...meses];
    const valores = meses.flatMap((valor, k) => (valor ? [{ grupo: g.grupo, codigo, mes: k + 1, valor }] : []));
    for (const [k, partes] of alocarCentros(est, [g], valores, percentuais)) {
      const [u, destino] = [Number(k.slice(0, k.indexOf("|"))), k.slice(k.indexOf("|") + 1)];
      partes.forEach((x, m) => (lista[m] += x * (fator(u, destino, m) - 1)));
    }
    r.set(codigo, lista);
  }
  return r;
}

/**
 * O rateio do cenário (os percentuais das regras de rateio de cada mês, sobre as bases das premissas e a Liberação de Projetos) e o
 * fator do reajuste de cada conta de destino numa unidade e num mês (nos Custos de Produção da Matriz e da Filial, o das vendas, na
 * proporção do volume produzido de cada uma; sem índice, 1), com os `fatores` do cenário (fatoresDoCenario).
 */
async function rateioDoCenario(db: Tx, cenarioId: string, ano: number, est: LinhaEstrutura[], fatores: Awaited<ReturnType<typeof fatoresDoCenario>>) {
  const [linhas, gravadas, regras, projetos] = await Promise.all([
    linhasDoCadastro(),
    db.cenarioPremissa.findMany({ where: { cenarioId } }),
    regrasDoCenario(db, cenarioId),
    db.cenarioIndicador.findMany({ where: ondeEstaoOsProjetos(cenarioId), select: { indicador: true, mes: true, valor: true } }),
  ]);
  const { porVenda, bases } = calcularPremissas(est, linhas, ano, gravadas);
  for (const [chave, lista] of basesDosProjetos(projetos)) bases.set(chave, lista);
  const percentuais = percentuaisPelasRegras(regras, ano, bases);
  const porCodigo = new Map(est.map((l) => [l.codigo, l]));
  const fator = (u: number, codigo: string, m: number) => {
    const l = porCodigo.get(codigo);
    const porUnidade = l ? GRUPOS_POR_UNIDADE[l.grupoSigla]?.find((x) => x.unidade === u) : undefined;
    if (!porUnidade) return fatorNaUnidade(fatores, codigo, u)?.[m] ?? 1;
    const volumes = porUnidade.vendas.map((v) => Math.max(0, porVenda.get(`${u}|${v.chave}|${C.PRODUCAO_M3}`)?.[m] ?? 0));
    const volume = volumes.reduce((s, v) => s + v, 0);
    return porUnidade.vendas.reduce((s, v, k) => s + (volume > 0 ? volumes[k] / volume : k === 0 ? 1 : 0) * (fatorNaVenda(fatores, codigo, u, v.chave)?.[m] ?? 1), 0);
  };
  return { percentuais, fator };
}

/**
 * Os grupos de centros de custo na DRE do cenário (23/11/2026, pedido do Adão: a aba Departamentos dos Resultados): como no
 * calcularAnalitico, os valores gravados de cada grupo (os doze meses, com o Quadro de Lotação e os encargos do último cálculo) vão
 * às unidades pelo rateio (alocarCentros: a unidade e a conta de destino — a parte da Complementar, na equivalente da CSC; a da
 * produção que vai para Serviços, na da CSM ou da CSC), com o fator do reajuste da conta de destino na unidade quando a DRE foi
 * calculada com os reajustes (reajustesCalculados), e somam-se nas unidades, como o Consolidado. O que o rateio não leva a nenhuma
 * unidade fica fora. Por grupo, os doze meses de cada conta de destino.
 */
export async function centrosNaDREDoCenario(db: Tx, cenarioId: string) {
  const cenario = await db.cenario.findUniqueOrThrow({
    where: { id: cenarioId },
    select: { ano: true, indicesDosReajustes: true, aplicacaoDosReajustes: true, reajustesCalculados: true },
  });
  const [est, grupos, gravados] = await Promise.all([
    estrutura(),
    gruposDoCenario(cenarioId, db),
    db.cenarioCentro.findMany({ where: { cenarioId, mes: { gte: 1, lte: 12 } }, select: { grupo: true, mes: true, valor: true, linhaDRE: { select: { codigo: true } } } }),
  ]);
  const fatores = cenario.reajustesCalculados ? await fatoresDoCenario(db, { id: cenarioId, ...cenario }, est) : new Map();
  const { percentuais, fator } = await rateioDoCenario(db, cenarioId, cenario.ano, est, fatores);
  const porGrupo = new Map<string, Array<{ grupo: string; codigo: string; mes: number; valor: number }>>();
  for (const x of gravados) {
    const valor = Number(x.valor);
    if (valor) porGrupo.set(x.grupo, [...(porGrupo.get(x.grupo) ?? []), { grupo: x.grupo, codigo: x.linhaDRE.codigo, mes: x.mes, valor }]);
  }
  const r = new Map<string, Map<string, number[]>>();
  for (const g of grupos) {
    const valores = porGrupo.get(g.grupo);
    if (!valores) continue;
    const porDestino = new Map<string, number[]>();
    for (const [k, partes] of alocarCentros(est, [g], valores, percentuais)) {
      const [u, destino] = [Number(k.slice(0, k.indexOf("|"))), k.slice(k.indexOf("|") + 1)];
      const lista = porDestino.get(destino) ?? Array<number>(12).fill(0);
      partes.forEach((x, m) => (lista[m] += fatores.size ? x * fator(u, destino, m) : x));
      porDestino.set(destino, lista);
    }
    r.set(g.grupo, porDestino);
  }
  return r;
}
