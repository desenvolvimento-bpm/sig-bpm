import { getPrismaClient } from "../../config/prisma.js";
import { acumular, type Parte } from "./indicadores.js";
import { catalogoDeIndicadores, ROTULO_DO_REGISTRADO, rotuloDoQuadro } from "./catalogoIndicadores.js";
import { dadosDoMes, encadearMeses } from "./indicadoresService.js";
import { orcamentoDoExercicio, type CenariosDoProva } from "./orcamento.js";
import type { MarcacaoCenario } from "../../generated/prisma/enums.js";
import { rotuloDaComparacao, type Comparacao } from "../cenarios/indicadoresDoCenario.js";
import { quadrosDoPainel } from "./cadastroPainel.js";
import { sinal, vsOrcado, type ItemPainel, type QuadroPainel, type Valor } from "./painelDeBordo.js";
import { mesesDoExercicio } from "./resultadosService.js";
import { formulaPorExtenso } from "./formulaIndicador.js";

const MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

/**
 * O item num período (o mês ou o acumulado): realizado, orçado, o percentual sob o realizado, o desvio e o sinal.
 * `comOrcado` falso: o orçado zero é a falta dele (sem o sinal da meta zero).
 */
function bloco(item: ItemPainel, realizado: Valor, orcado: Valor, comOrcado = true) {
  const r = item.conta(realizado);
  const o = item.conta(orcado);
  return { realizado: r, orcado: o, base: item.base?.conta(realizado) ?? null, vsOrcado: vsOrcado(r, o), sinal: sinal(item, r, o, comOrcado) };
}

/** A Metodologia do item por extenso (os indicadores pelo nome; × e ÷ nas contas). */
function metodologiaPorExtenso(formula: string) {
  try {
    return formulaPorExtenso(formula, (x) => ("nome" in x ? x.nome : "chave" in x ? rotuloDoQuadro(x.chave) : x.tipo === "REGISTRADO" ? ROTULO_DO_REGISTRADO : x.codigo));
  } catch {
    return formula;
  }
}

/** Os meses do exercício até o de referência, para os gráficos: o realizado e o orçado de cada um. */
export type MesDaSerie = { rotulo: string; realizado: Valor; orcado: Valor };

type Periodos = { mes: [Valor, Valor]; acumulado: [Valor, Valor]; comOrcado?: { mes: boolean; acumulado: boolean } };
/**
 * Um dos cenários dos cards PROVA (31/10/2026: os Relatórios Executivos): a marcação, o realizado contra o orçado dele no
 * mês e no acumulado e o orçado dele em cada mês da série.
 */
type ComparadoDoPainel = { marcacao: MarcacaoCenario; periodos: Periodos; serie: Valor[] };

/**
 * Os quadros do painel; exportada para o Painel de Bordo dos cenários (13/10/2026: o cenário × o comparado). Com
 * `comparados` (31/10/2026), cada item traz também, em `prova`, o realizado contra cada um desses cenários.
 */
export function montarPainel(quadros: QuadroPainel[], periodos: Periodos, serie: MesDaSerie[], comparados: ComparadoDoPainel[] = []) {
  return quadros.map((q) => ({
    titulo: q.titulo,
    itens: q.itens.map((i) => ({
      titulo: i.titulo,
      sigla: i.sigla,
      // A Metodologia por extenso (21/10/2026), que o card mostra no lugar da abreviação.
      metodologia: metodologiaPorExtenso(i.formula),
      sentido: i.sentido,
      formato: i.formato,
      // O mesmo formato no Atual e no Acumulado (21/10/2026; a coluna formato_acumulado do cadastro não vale mais).
      formatoAcumulado: i.formato,
      base: i.base ? { rotulo: i.base.rotulo, casas: i.base.casas } : null,
      separar: i.separar ?? false,
      mes: bloco(i, ...periodos.mes, periodos.comOrcado?.mes),
      acumulado: bloco(i, ...periodos.acumulado, periodos.comOrcado?.acumulado),
      serie: serie.map((m) => ({ mes: m.rotulo, realizado: i.conta(m.realizado), orcado: i.conta(m.orcado) })),
      ...(comparados.length
        ? {
            prova: Object.fromEntries(
              comparados.map((c) => [
                c.marcacao,
                {
                  mes: bloco(i, ...c.periodos.mes, c.periodos.comOrcado?.mes),
                  acumulado: bloco(i, ...c.periodos.acumulado, c.periodos.comOrcado?.acumulado),
                  serie: c.serie.map((v) => i.conta(v)),
                },
              ]),
            ),
          }
        : {}),
    })),
  }));
}

export const painelService = {
  /**
   * O Painel de Bordo do mês `ate` (sem ele, o último apurado): o realizado
   * sai dos indicadores (DRE apurada, volumes e indicadores importados); o
   * orçado, do cenário marcado como Orçamento Empresarial no exercício; sem
   * ele, ou sem o valor nele, zero (as metas importadas não valem mais, desde
   * 11/10/2026). O acumulado vai de janeiro ao mês; os meses que o cenário não
   * tem vão em `mesesSemMeta`.
   */
  /**
   * `prova` (31/10/2026, os cards PROVA dos Relatórios Executivos): os orçados de outros cenários, cada um com a marcação,
   * para o realizado contra cada um deles (o realizado continua o do `comparaCom`).
   */
  async painel(ano: number, ate?: number, somenteFechadas = false, comparaCom: Comparacao = "ORCAMENTO_EMPRESARIAL", prova: CenariosDoProva = []) {
    const { ultimo, meses } = await mesesDoExercicio(ano, ate, somenteFechadas);
    // Com `somenteFechadas` (Resultados Empresariais), só os meses de competência fechada têm valor.
    const fechados = new Set(meses.filter((m) => m.competenciaId !== null).map((m) => m.mes));
    const competencias = (await getPrismaClient().competencia.findMany({ where: { ano, mes: { lte: ultimo } }, select: { id: true, mes: true } })).filter(
      (c) => !somenteFechadas || fechados.has(c.mes),
    );
    const porMes = new Map(competencias.map((c) => [c.mes, c]));
    const orcamento = await orcamentoDoExercicio(comparaCom);
    const dados = encadearMeses(
      await Promise.all(
        meses.map((m) => (porMes.has(m.mes) ? dadosDoMes(porMes.get(m.mes)!.id, m.competenciaId !== null, orcamento.porMes[m.mes - 1]) : null)),
      ),
    );
    const metas = meses.map((m) => orcamento.porMes[m.mes - 1]);

    // Os indicadores realizados: as partes de cada mês, para o valor do mês de referência e o acumulado.
    const catalogo = await catalogoDeIndicadores();
    const partes = new Map(catalogo.map((i) => [i.nome, dados.map((d): Parte | null => (d ? i.calculo(d) : null))]));
    const porNome = new Map(catalogo.map((i) => [i.nome, i]));
    const realizadoMes: Valor = (n) => partes.get(n)?.[ultimo - 1]?.valor ?? null;
    const realizadoAcum: Valor = (n) => (porNome.has(n) ? acumular(porNome.get(n)!, partes.get(n)!) : null);
    const orcadoMes: Valor = (n) => metas[ultimo - 1].get(n) ?? 0;
    const orcadoAcum: Valor = (n) => (porNome.has(n) ? orcamento.acumulado(porNome.get(n)!, ultimo) : 0);

    // Sem o cenário (ou, no mês, sem o valor nele), o orçado zero é a falta dele: sem o sinal da meta zero (22/10/2026).
    const periodos = {
      mes: [realizadoMes, orcadoMes] as [Valor, Valor],
      acumulado: [realizadoAcum, orcadoAcum] as [Valor, Valor],
      comOrcado: { mes: !!orcamento.cenario && !orcamento.mesesSemValor.includes(ultimo), acumulado: !!orcamento.cenario },
    };
    const quadros = await quadrosDoPainel();
    // A série mês a mês (gráficos do painel, como os da planilha): o realizado e o orçado de cada mês até o de referência.
    const serie: MesDaSerie[] = meses.map((m, i) => ({
      rotulo: MESES[m.mes - 1],
      realizado: (n) => partes.get(n)?.[i]?.valor ?? null,
      orcado: (n) => metas[i].get(n) ?? 0,
    }));
    // Os cenários dos cards PROVA, como o comparado acima.
    const comparados: ComparadoDoPainel[] = (await prova).map(([marcacao, o]) => {
      const doCenario = meses.map((m) => o.porMes[m.mes - 1]);
      return {
        marcacao,
        periodos: {
          mes: [realizadoMes, (n) => doCenario[ultimo - 1].get(n) ?? 0],
          acumulado: [realizadoAcum, (n) => (porNome.has(n) ? o.acumulado(porNome.get(n)!, ultimo) : 0)],
          comOrcado: { mes: !!o.cenario && !o.mesesSemValor.includes(ultimo), acumulado: !!o.cenario },
        },
        serie: doCenario.map((m): Valor => (n) => m.get(n) ?? 0),
      };
    });
    return {
      ano,
      ate: ultimo,
      rotuloMes: `${MESES[ultimo - 1]}/${ano}`,
      rotuloAcumulado: `ACUMULADO/${ano}`,
      mesApurado: meses[ultimo - 1].competenciaId !== null,
      /** O cenário do orçado (null: nenhum cenário Orçamento Empresarial no exercício; o orçado é zero). */
      cenarioOrcado: orcamento.cenario?.nome ?? null,
      // O nome do comparado nos rótulos (21/10/2026): "Orçado" no Orçamento Empresarial; nos outros, o nome da marcação.
      rotuloComparado: rotuloDaComparacao(comparaCom, orcamento.cenario),
      mesesSemMeta: meses.filter((m) => orcamento.mesesSemValor.includes(m.mes)).map((m) => `${MESES[m.mes - 1]}/${ano}`),
      abas: [
        // Os itens do cadastro do Painel de Bordo (17/10/2026; antes, fixos no código).
        { chave: "resultados", titulo: "Resultados", quadros: montarPainel(quadros.resultados, periodos, serie, comparados) },
        { chave: "performance", titulo: "Performance", quadros: montarPainel(quadros.performance, periodos, serie, comparados) },
      ],
    };
  },
};
