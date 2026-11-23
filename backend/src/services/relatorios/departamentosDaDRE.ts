import { TOTAIS_DO_CENTRO } from "../dre/recorteCentros.js";

/**
 * A aba Departamentos dos Resultados (23/11/2026, pedido do Adão; nos Resultados Empresariais e nos Cenários Analíticos), antes
 * das abas Centros de Custo: a DRE do Consolidado, com os mesmos totais, mas, de CUSTO DE PRODUTO VENDIDO até DESPESAS
 * ADMINISTRATIVAS, cada departamento com centros de custo (CPP, CSM, CSC, DL, DT, DC e DA: os departamentos dos centros, os de
 * TOTAIS_DO_CENTRO) abre pelos grupos de centros de custo — cada um com o valor dele no departamento — no lugar das atribuições e
 * das contas. Depois dos centros, as atribuições com o que não vem deles: as que os centros não usam (Mão de Obra Terceirizada,
 * Matérias Primas, Estoque…), com as contas, e, nas que eles usam, o resto (os lançamentos sem centro de custo, nos cenários as
 * Premissas das unidades e os Investimentos, e os centros fora do recorte do usuário), como "Atribuição (Outros)". Assim o total
 * de cada departamento é o do Consolidado. Antes do CPV (as receitas) e depois do DA (a DVV fica como está, sem centros; e do
 * LUCRO OPERACIONAL em diante), as linhas do Consolidado.
 *
 * O cálculo é puro: recebe o Consolidado e os valores de cada grupo de centros já levados à conta de destino na DRE (a regra da
 * apuração nos Resultados Empresariais; o rateio do cenário nos analíticos), por período, em uma ou mais séries (o realizado ou o
 * cenário, e o orçado ou o comparado), e devolve as linhas da aba e os valores de cada série nelas.
 */

export type LinhaDaEstrutura = { id: string; codigo: string; tipo: string; grupo: string; grupoSigla: string; atribuicaoSigla: string | null; descricao: string };

/**
 * Uma série: o Consolidado por período e código e os grupos de centros (pelo nome) com o valor de cada conta de destino por
 * período. `centros` nulo: a série não tem centros de custo (um cenário sintético) — as linhas dos centros e as "(Outros)"
 * ficam sem valor nela.
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
  const departamentoDe = (l: LinhaDaEstrutura) => {
    const p = partes(l.codigo);
    return DEPARTAMENTOS_COM_CENTROS.has(p[0]) && p.length >= 3 ? p[0] : null;
  };
  // As contas de cada departamento e as contas abaixo de cada linha dele (a atribuição: as do mesmo prefixo; a conta: ela mesma).
  const contasDoDepartamento = new Map<string, string[]>();
  for (const l of linhas) {
    const d = departamentoDe(l);
    if (d && l.tipo === "ITEM") contasDoDepartamento.set(d, [...(contasDoDepartamento.get(d) ?? []), l.codigo]);
  }
  const prefixo = (codigo: string) => partes(codigo).slice(0, 2).join(".");
  const contasAbaixo = (l: LinhaDaEstrutura) =>
    l.tipo === "ITEM" ? [l.codigo] : (contasDoDepartamento.get(partes(l.codigo)[0]) ?? []).filter((c) => prefixo(c) === prefixo(l.codigo));
  const periodos = (s: SerieDosDepartamentos) => s.consolidado.length;

  // A soma dos centros de uma série num conjunto de contas, em cada período (um centro, ou todos).
  const somaDosCentros = (s: SerieDosDepartamentos, contas: string[], nome?: string) =>
    Array.from({ length: periodos(s) }, (_, k) => {
      let soma = 0;
      for (const [n, porPeriodo] of s.centros ?? []) {
        if (nome !== undefined && n !== nome) continue;
        const m = porPeriodo[k];
        if (m) for (const c of contas) soma += m.get(c) ?? 0;
      }
      return soma;
    });

  // As atribuições (pelo prefixo) e as contas soltas em que algum centro tem valor em alguma série: as "parciais" (o resto delas).
  const comCentros = new Set<string>();
  for (const s of series)
    for (const [, porPeriodo] of s.centros ?? [])
      for (const m of porPeriodo) for (const [c, v] of m) if (temValor(v)) comCentros.add(prefixo(c)).add(c);

  // Os grupos de centros de cada departamento com valor em alguma série, por nome.
  const nomesNoDepartamento = new Map<string, string[]>();
  for (const [d, contas] of contasDoDepartamento) {
    const nomes = new Set<string>();
    for (const s of series) for (const nome of s.centros?.keys() ?? []) if (!nomes.has(nome) && somaDosCentros(s, contas, nome).some(temValor)) nomes.add(nome);
    nomesNoDepartamento.set(d, [...nomes].sort((a, b) => a.localeCompare(b, "pt-BR")));
  }

  const usados = new Set<string>();
  const resultado: LinhaDaEstrutura[] = [];
  const centros = new Set<string>();
  const parciais = new Set<string>();
  const valores = series.map((s) => Array.from({ length: periodos(s) }, () => new Map<string, number>()));
  const semValor = series.map(() => new Set<string>());
  const gravar = (codigo: string, porSerie: Array<number[] | null>) =>
    porSerie.forEach((lista, i) => {
      if (!lista) semValor[i].add(codigo);
      else lista.forEach((v, k) => valores[i][k].set(codigo, v));
    });

  for (const l of linhas) {
    const d = departamentoDe(l);
    if (!d) {
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
          parciais.add(codigo);
          gravar(codigo, series.map((s) => (s.centros ? somaDosCentros(s, contas, nome) : null)));
        }
      }
      continue;
    }
    // Uma atribuição ou uma conta do departamento: o Consolidado menos os centros, só com valor em alguma série.
    // Parcial: a atribuição em que algum centro tem valor, e as contas dela (o resto, sem centro, mesmo nas contas sem nenhum).
    const contas = contasAbaixo(l);
    const parcial = comCentros.has(prefixo(l.codigo)) || comCentros.has(l.codigo);
    const resto = series.map((s) => {
      if (parcial && !s.centros) return null;
      const dosCentros = somaDosCentros(s, contas);
      return s.consolidado.map((m, k) => (m.get(l.codigo) ?? 0) - dosCentros[k]);
    });
    if (!resto.some((r) => r?.some(temValor))) continue;
    // A atribuição com centros leva "(Outros)": o valor é só o resto dela (as contas, logo abaixo, também).
    resultado.push(parcial && l.tipo !== "ITEM" ? { ...l, descricao: `${l.descricao} (Outros)` } : l);
    if (parcial) parciais.add(l.codigo);
    gravar(l.codigo, resto);
  }
  return { linhas: resultado, centros, parciais, series: series.map((_, i) => ({ valores: valores[i], semValor: semValor[i] })) };
}
