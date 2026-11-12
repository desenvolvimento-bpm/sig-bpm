import { getPrismaClient } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { LinhaEstrutura } from "../dre/apuracaoUnidades.js";
import { estrutura } from "../dre/dreService.js";
import { diasUteis } from "./calendario.js";
import { alocarCentros, contasDoGrupo, gruposDoCadastro } from "./centrosCenario.js";
import { ehContaDeEncargos, encargosDoGrupo, maosDeObraDoGrupo, VENDAS_DOS_ENCARGOS } from "./encargosCenario.js";
import { VENDA_LOTACAO_APRENDIZ, VENDA_LOTACAO_CLT, VENDA_LOTACAO_ESTAGIARIO, VENDA_LOTACAO_PJ, VENDAS_LOTACAO } from "./lotacaoCenario.js";
import { linhasDoQuadro, quadroDosGrupos, type QuadroDoGrupo } from "./quadroDoCenario.js";
import { calcularInvestimentosEExtra } from "./investimentosCenario.js";
import { recalcular, UNIDADES } from "./edicaoCenario.js";
import { fatoresDasContas, resumoVazio } from "./reajustesCenario.js";
import { assinaturaDasRegras, percentuaisPelasRegras, regrasDeRateio } from "../volumes/vigenciaDosRateios.js";

type Tx = Prisma.TransactionClient;

/**
 * As premissas dos cenários analíticos (13/10/2026, etapa 2): as tabelas Matriz, Filial e Serviços da tela Premissas e
 * o cálculo da DRE a partir delas. Em Matriz e Filial, uma tabela para a venda Global e outra para a Mercantil; em
 * Serviços, só a Global. Cada tabela tem, mês a mês:
 *
 * - Jornada: os dias úteis (o calendário — segunda a sexta menos os feriados nacionais —, editável);
 * - Produção e Serviços: a demanda diária de cada linha do cadastro Linhas da unidade, na Und. de Medida dela (nas
 *   linhas de "m³ e pistas", as pistas por dia e os m³ por pista: o m³ é o m³/pista × as pistas); o volume do mês é a
 *   demanda × os dias úteis;
 * - Receita Operacional: por linha, a receita bruta média de cada conta da ROB (R$ por unidade da linha — o m³, nas
 *   de pistas), os impostos operacionais (%/ROB) e a receita líquida média (calculada);
 * - Custos de Produção / Serviços: por linha, as Matérias Primas, a Mão de Obra Terceirizada (14/10/2026) e os Gastos
 *   Gerais Variáveis (por conta) e o Estoque, em R$ por unidade da linha;
 * - Despesas Variáveis de Venda: por linha, os Gastos Gerais Variáveis da DVV (por conta), em R$ por unidade; as
 *   Comissões (15/10/2026) são um percentual sobre a receita bruta, e a conta das comissões se calcula dele.
 *
 * O valor de cada conta no mês é o volume × o valor unitário (sem ajustes: só as médias e as demandas, 15/10/2026); a receita líquida, a bruta × (1 − os
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
const PISTAS = "m³ e pistas";
/**
 * As linhas com a demanda de armadura (14/10/2026), em kg por unidade da linha (kg/m³, kg/kg, kg/m²…), e as com a
 * demanda de metalurgia, também em kg por unidade: as que consomem as peças da Metalurgia. A metalurgia das linhas dá o
 * rateio de Metalurgia e a Produção da Metalurgia (kg) da DRE de cada unidade.
 */
export const LINHAS_COM_ARMADURA = new Set(["ESTRUTURA", "ALVEOLARES", "ESTACAS", "MONTAGEM", "CAPEAMENTO", "METÁLICA"]);
export const LINHAS_COM_METALURGIA = new Set(["ESTRUTURA", "ALVEOLARES", "ESTACAS", "MONTAGEM", "CAPEAMENTO", "METÁLICA"]);

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
    receitas: l.unidade === 3 ? [LINHAS_DE_MONTAGEM.has(l.codigo) ? C.RBM : C.RBC] : [C.RBPF, C.RBF, C.RBDI],
    // A mão de obra terceirizada (14/10/2026) é custo unitário da linha: a de produção na Matriz e na Filial, a de
    // serviços em Serviços (não vem dos centros de custo). Desde 15/10/2026, antes das matérias primas.
    custos: [...daUnidade(`${custo}.MOT.`), ...daUnidade(`${custo}.MP.`), ...daUnidade(`${custo}.GGV.`), ...daUnidade(`${custo}.E.`)],
    // Em Serviços, o Frete e Descarga é só dos complementares (24/10/2026): as linhas de montagem não o têm.
    dvv: daUnidade("DVV.GGV.").filter((x) => !(custo === "CSM" && x.codigo === FRETE_DOS_COMPLEMENTARES)),
  };
}

const pistas = (l: LinhaDoCadastro) => l.medida === PISTAS;
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
 * rateios dos centros de custo ("CHAVE|DESTINO": Produção pelo m³ produzido; Projeto pelo m³ da venda Global; Metalurgia
 * e Armadura pelo kg das linhas — o volume × a demanda por unidade; Acompanhamento pelos acompanhamentos de Serviços).
 */
export function calcularTabela(est: LinhaEstrutura[], linhas: LinhaDoCadastro[], unidade: UnidadePremissa, ano: number, ler: Leitor, venda: Venda = "GLOBAL") {
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
    // A armadura e a metalurgia: o volume × o kg por unidade da linha (14/10/2026; antes, a armadura por dia útil).
    const armadura = LINHAS_COM_ARMADURA.has(l.codigo) ? premissa(`ARMADURA:${l.codigo}`).map((a, k) => a * volume[k]) : Array<number>(12).fill(0);
    if (LINHAS_COM_ARMADURA.has(l.codigo)) valores.set(`VOLUME_ARMADURA:${l.codigo}`, armadura);
    const metalurgia = LINHAS_COM_METALURGIA.has(l.codigo) ? premissa(`METALURGIA:${l.codigo}`).map((a, k) => a * volume[k]) : Array<number>(12).fill(0);
    if (LINHAS_COM_METALURGIA.has(l.codigo)) valores.set(`VOLUME_METALURGIA:${l.codigo}`, metalurgia);
    const acompanhamentos = l.unidade === 3 ? premissa(`ACOMPANHAMENTO:${l.codigo}`).map((a, k) => a * dias[k]) : null;
    if (acompanhamentos) valores.set(`VOLUME_ACOMPANHAMENTO:${l.codigo}`, acompanhamentos);
    const destino = destinoDaLinha(l);
    // Os volumes da DRE: a produção (m³, e a expedição igual a ela) nas fábricas, a metalurgia consumida pelas linhas da
    // unidade, a montagem e os acompanhamentos em Serviços. E as bases dos rateios dos centros de custo.
    for (const m of meses) {
      const v = volume[m - 1];
      if (l.unidade !== 3 && (l.medida === "m³" || pistas(l))) {
        somar(C.PRODUCAO_M3, m, v);
        somar(C.EXPEDICAO_M3, m, v);
        base("PRODUCAO", destino, m, v);
        if (venda === "GLOBAL") base("PROJETO", destino, m, v);
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
      for (const m of meses) somar(c.codigo, m, volume[m - 1] * unitario[m - 1]);
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
  const bases = new Map<string, number[]>();
  const juntar = (m: Map<string, number[]>, k: string, lista: number[]) => {
    const s = m.get(k) ?? Array<number>(12).fill(0);
    lista.forEach((x, i) => (s[i] += x));
    m.set(k, s);
  };
  for (const u of UNIDADES_PREMISSAS) {
    for (const v of VENDAS_DA_UNIDADE[u]) {
      const r = calcularTabela(est, linhas, u, ano, (chave, mes) => dados.get(`${u}|${v}|${chave}|${mes}`), v);
      for (const [codigo, lista] of r.dre) juntar(somas, `${u}|${codigo}`, lista);
      for (const [chave, lista] of r.bases) juntar(bases, chave, lista);
    }
  }
  return { somas, bases, juntar };
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
  grupos: Awaited<ReturnType<typeof gruposDoCadastro>>,
  gravadas: Array<{ unidade: number; venda: string; chave: string; mes: number; valor: unknown }>,
  meses: Array<{ grupo: string; codigo: string; mes: number; valor: number }>,
  quadro: Map<string, QuadroDoGrupo>,
) {
  const idDaConta = new Map(est.map((l) => [l.codigo, l.id]));
  const valor = new Map(meses.map((x) => [`${x.grupo}|${x.codigo}|${x.mes}`, x.valor]));
  const premissa = new Map(gravadas.filter((p) => p.unidade === 0 && VENDAS_DOS_ENCARGOS.has(p.venda)).map((p) => [`${p.venda}|${p.chave}|${p.mes}`, Number(p.valor)]));
  const calculados: Array<{ grupo: string; codigo: string; mes: number; valor: number }> = [];
  const doCadastro = new Set<string>();
  for (const g of grupos) {
    doCadastro.add(g.grupo);
    const codigos = contasDoGrupo(est, g).map((l) => l.codigo);
    // Os salários dos aprendizes (09/11/2026) e dos estagiários (11/11/2026): os do Quadro de Lotação do cenário, por mão de obra.
    const q = quadro.get(g.grupo);
    const r = encargosDoGrupo(
      codigos,
      g.atribuicao,
      (codigo, mes) => valor.get(`${g.grupo}|${codigo}|${mes}`) ?? 0,
      (venda, mes) => premissa.get(`${venda}|${g.grupo}|${mes}`),
      (prefixo, mes) => q?.maos.get(prefixo)?.aprendizes[mes - 1] ?? 0,
      (prefixo, mes) => q?.maos.get(prefixo)?.estagiarios[mes - 1] ?? 0,
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
 * alimentada pela Gestão de Colaboradores, é a única fonte da contagem); em todos os grupos (11/11/2026, pedido do
 * Adão: as Remunerações sempre vêm do Quadro de Lotação e não se digitam; antes, só nos grupos com linhas), as Remunerações
 * CLT e PJ de cada mão de obra (os centros) dos meses 1 a 12 — sem linhas, zero —, no lugar do que havia (a Média de
 * Referência, o mês 0, fica). Devolve os valores dos meses dos centros com elas.
 */
async function materializarQuadro(
  tx: Tx,
  cenarioId: string,
  est: LinhaEstrutura[],
  grupos: Awaited<ReturnType<typeof gruposDoCadastro>>,
  quadro: Map<string, QuadroDoGrupo>,
  meses: Array<{ grupo: string; codigo: string; mes: number; valor: number }>,
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
    for (const mo of maosDeObraDoGrupo(contasDoGrupo(est, g).map((l) => l.codigo), g.atribuicao)) {
      const s = q?.maos.get(mo.prefixo);
      for (const [codigo, lista] of [[mo.remuneracoes, s?.clt], [mo.remuneracoesPJ, s?.pj]] as const) {
        if (!idDaConta.has(codigo)) continue;
        doGrupo.add(codigo);
        lista?.forEach((v, k) => (Math.abs(v) >= 0.00005 ? centros.push({ grupo: g.grupo, codigo, mes: k + 1, valor: v }) : undefined));
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

/**
 * Recalcula a DRE do cenário analítico (13/10/2026): as contas das premissas de cada unidade (as de Global e Mercantil
 * somadas), as dos grupos de centros de custo, alocadas às unidades pelo balde e pelos rateios — com os percentuais
 * das bases das premissas (centrosCenario.ts) —, e a depreciação (a base e a dos investimentos) e o extra-operacional
 * (investimentosCenario.ts) substituem a DRE inteira do cenário, e os totais e o Consolidado se
 * recalculam pela Estrutura da DRE. Como a DRE do analítico não se edita, ela é sempre a soma das premissas e dos centros.
 * Com os reajustes aplicados (11/11/2026, reajustesCenario.ts), as contas com índice na Aplicação dos Reajustes saem
 * multiplicadas pelo fator do índice em cada mês; devolve o resumo deles (as contas, os meses e as somas sem e com).
 */
export async function calcularAnalitico(tx: Tx, cenarioId: string) {
  const cenario = await tx.cenario.findUniqueOrThrow({ where: { id: cenarioId }, select: { ano: true, reajustesAplicados: true, indicesDosReajustes: true, aplicacaoDosReajustes: true } });
  const [est, linhas, gravadas, grupos, valoresCentros, investimentos, regras] = await Promise.all([
    estrutura(),
    linhasDoCadastro(),
    tx.cenarioPremissa.findMany({ where: { cenarioId } }),
    gruposDoCadastro(),
    tx.cenarioCentro.findMany({ where: { cenarioId }, include: { linhaDRE: { select: { codigo: true } } } }),
    tx.cenarioInvestimento.findMany({ where: { cenarioId } }),
    regrasDeRateio(tx),
  ]);
  const porCodigo = new Map(est.map((l) => [l.codigo, l]));
  const { somas, bases, juntar } = calcularPremissas(est, linhas, cenario.ano, gravadas);
  // Só os meses: o mês 0 é a Média de Referência (15/10/2026).
  const meses = valoresCentros.filter((x) => x.mes >= 1 && x.mes <= 12).map((x) => ({ grupo: x.grupo, codigo: x.linhaDRE.codigo, mes: x.mes, valor: Number(x.valor) }));
  // O Quadro de Lotação do cenário (09/11/2026): os colaboradores e as remunerações dos grupos com linhas, antes dos encargos.
  const quadro = quadroDosGrupos(await linhasDoQuadro(tx, cenarioId), grupos, (g) => contasDoGrupo(est, g).map((l) => l.codigo));
  const comQuadro = await materializarQuadro(tx, cenarioId, est, grupos, quadro, meses);
  const valoresDosCentros = await materializarEncargos(tx, cenarioId, est, grupos, gravadas, comQuadro, quadro);
  const alocados = alocarCentros(
    est,
    grupos,
    valoresDosCentros,
    // Os percentuais pelas regras de rateio de cada mês (14/10/2026): o fixo, ou as bases entre os destinos das por volume.
    percentuaisPelasRegras(regras, cenario.ano, bases),
  );
  // As regras deste cálculo: se mudarem depois, a tela Resultados pede o Recalcular.
  await tx.cenario.update({ where: { id: cenarioId }, data: { rateiosAssinatura: assinaturaDasRegras(regras) } });
  for (const [k, lista] of alocados) juntar(somas, k, lista);
  // A depreciação base, a dos investimentos e o extra-operacional (etapa 4).
  const outros = calcularInvestimentosEExtra(
    gravadas,
    investimentos.map((i) => ({ ...i, valorTotal: Number(i.valorTotal), valorPosUso: Number(i.valorPosUso) })),
  );
  for (const [k, lista] of outros) juntar(somas, k, lista);
  // Os reajustes (11/11/2026): o fator do índice de cada conta em cada mês. O resumo diz o que eles mudam (aplicados
  // ou não); só com eles aplicados os valores gravados saem reajustados.
  const fatores = fatoresDasContas(cenario);
  const resumo = resumoVazio();
  const novos: Array<{ cenarioId: string; visao: number; linhaDREId: string; mes: number; valor: Prisma.Decimal }> = [];
  for (const [k, lista] of somas) {
    const [us, codigo] = k.split("|");
    const u = Number(us);
    const l = porCodigo.get(codigo);
    if (!l || l.tipo !== "ITEM" || !l.unidades.includes(u)) continue;
    const f = fatores.get(codigo);
    lista.forEach((x, m) => {
      if (Math.abs(x) < 0.00005) return;
      const reajustado = f ? x * f[m] : x;
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
