import { TOTAIS_DO_CENTRO } from "../dre/recorteCentros.js";

/**
 * A aba Departamentos dos Resultados (23/11/2026, pedido do Adão; nos Resultados Empresariais e nos Cenários Analíticos), antes
 * das abas Centros de Custo: a DRE do Consolidado, com os mesmos totais, mas, de CUSTO DE PRODUTO VENDIDO até DESPESAS
 * ADMINISTRATIVAS, cada departamento com centros de custo (CPP, CSM, CSC, DL, DT, DC e DA: os departamentos dos centros, os de
 * TOTAIS_DO_CENTRO) mostra só os grupos de centros de custo — cada um com o valor dele no departamento —, sem as atribuições e as
 * contas (23/11/2026, pedido do Adão: também sem a Mão de Obra Terceirizada, as Matérias Primas, os Gastos Gerais, o Estoque, a
 * Depreciação e o resto das atribuições dos centros, que antes vinham depois deles). O total de cada departamento continua o do
 * Consolidado (os totais da DRE batem com ele), e a soma dos grupos fica menor que ele pelo que não vem dos centros. Antes do CPV
 * (as receitas) e depois do DA (a DVV fica como está, sem centros; e do LUCRO OPERACIONAL em diante), as linhas do Consolidado.
 *
 * O cálculo é puro: recebe o Consolidado e os valores de cada grupo de centros já levados à conta de destino na DRE (a regra da
 * apuração nos Resultados Empresariais; o rateio do cenário nos analíticos), por período, em uma ou mais séries (o realizado ou o
 * cenário, e o orçado ou o comparado), e devolve as linhas da aba e os valores de cada série nelas.
 */

export type LinhaDaEstrutura = { id: string; codigo: string; tipo: string; grupo: string; grupoSigla: string; atribuicaoSigla: string | null; descricao: string };

/**
 * Uma série: o Consolidado por período e código e os grupos de centros (pelo nome) com o valor de cada conta de destino por
 * período. `centros` nulo: a série não tem centros de custo (um cenário sintético) — as linhas dos centros ficam sem valor nela.
 */
export type SerieDosDepartamentos = { consolidado: Array<Map<string, number>>; centros: Map<string, Array<Map<string, number>>> | null };

/** Os departamentos que abrem pelos centros de custo, na ordem da DRE. */
export const DEPARTAMENTOS_COM_CENTROS = TOTAIS_DO_CENTRO;

const QUASE_ZERO = 0.005;
const partes = (codigo: string) => codigo.split(".");
const temValor = (v: number) => Math.abs(v) >= QUASE_ZERO;

/** O código da linha de um grupo de centros num departamento: "CPP.CENTRO.ACABAMENTO" (sem acentos, só letras, números e _). */
function codigoDoCentro(departamento: string, nome: string, usados: Set<string>) {
  const base = `${departamento}.CENTRO.${
    nome
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "SEM_NOME"
  }`;
  let codigo = base;
  for (let k = 2; usados.has(codigo); k++) codigo = `${base}_${k}`;
  usados.add(codigo);
  return codigo;
}

export function montarDepartamentos(linhas: LinhaDaEstrutura[], series: SerieDosDepartamentos[]) {
  // As atribuições e as contas dos departamentos com centros (os códigos de três partes ou mais deles): saem da aba.
  const doDepartamento = (l: LinhaDaEstrutura) => {
    const p = partes(l.codigo);
    return DEPARTAMENTOS_COM_CENTROS.has(p[0]) && p.length >= 3;
  };
  // As contas de cada departamento: as que os grupos de centros somam nele.
  const contasDoDepartamento = new Map<string, string[]>();
  for (const l of linhas) if (doDepartamento(l) && l.tipo === "ITEM") contasDoDepartamento.set(partes(l.codigo)[0], [...(contasDoDepartamento.get(partes(l.codigo)[0]) ?? []), l.codigo]);
  const periodos = (s: SerieDosDepartamentos) => s.consolidado.length;

  // O valor de um grupo de centros de uma série num conjunto de contas, em cada período.
  const doGrupo = (s: SerieDosDepartamentos, contas: string[], nome: string) =>
    Array.from({ length: periodos(s) }, (_, k) => {
      const m = s.centros?.get(nome)?.[k];
      return m ? contas.reduce((soma, c) => soma + (m.get(c) ?? 0), 0) : 0;
    });

  // Os grupos de centros de cada departamento com valor em alguma série, por nome.
  const nomesNoDepartamento = new Map<string, string[]>();
  for (const [d, contas] of contasDoDepartamento) {
    const nomes = new Set<string>();
    for (const s of series) for (const nome of s.centros?.keys() ?? []) if (!nomes.has(nome) && doGrupo(s, contas, nome).some(temValor)) nomes.add(nome);
    nomesNoDepartamento.set(d, [...nomes].sort((a, b) => a.localeCompare(b, "pt-BR")));
  }

  const usados = new Set<string>();
  const resultado: LinhaDaEstrutura[] = [];
  const centros = new Set<string>();
  const valores = series.map((s) => Array.from({ length: periodos(s) }, () => new Map<string, number>()));
  const semValor = series.map(() => new Set<string>());

  for (const l of linhas) {
    if (doDepartamento(l)) continue;
    // Fora dos departamentos (e o total de cada um): o Consolidado.
    resultado.push(l);
    series.forEach((s, i) => s.consolidado.forEach((m, k) => m.has(l.codigo) && valores[i][k].set(l.codigo, m.get(l.codigo)!)));
    const p = partes(l.codigo);
    // Logo depois do total do departamento (CPP.CUSTOS_…), os grupos de centros dele.
    if (p.length === 2 && l.tipo !== "ITEM" && DEPARTAMENTOS_COM_CENTROS.has(p[0])) {
      const contas = contasDoDepartamento.get(p[0]) ?? [];
      for (const nome of nomesNoDepartamento.get(p[0]) ?? []) {
        const codigo = codigoDoCentro(p[0], nome, usados);
        resultado.push({ id: `centro|${p[0]}|${nome}`, codigo, tipo: "ITEM", grupo: l.grupo, grupoSigla: l.grupoSigla, atribuicaoSigla: null, descricao: nome });
        centros.add(codigo);
        series.forEach((s, i) => {
          if (!s.centros) semValor[i].add(codigo);
          else doGrupo(s, contas, nome).forEach((v, k) => valores[i][k].set(codigo, v));
        });
      }
    }
  }
  // As linhas dos centros não abrem os lançamentos (`parciais`, como as chamam os Resultados).
  return { linhas: resultado, centros, parciais: centros, series: series.map((_, i) => ({ valores: valores[i], semValor: semValor[i] })) };
}
