/**
 * O Painel de Bordo, como as abas Painel (Resultados) e Painel (Performance)
 * do SIG BPM 2026 - INDICADORES DE RESULTADO: em cada quadro, os indicadores
 * do mês de referência e do acumulado do exercício, o realizado contra o
 * orçado (aba Metas) e o sinal do desvio.
 *
 * Cada item é uma fórmula (a Metodologia, 17/10/2026) sobre os indicadores do
 * catálogo (os nomes da Estrutura dos Indicadores); a mesma fórmula sobre as
 * metas dá o orçado, como nas fórmulas do painel (o realizado vem da aba
 * Realizado; o orçado, da Metas). O acumulado é a fórmula sobre os acumulados
 * (a coluna ACUM. de cada aba).
 */

import { compilarFormula } from "./formulaIndicador.js";

/** O valor de um indicador do catálogo no período (o mês ou o acumulado), realizado ou orçado. */
export type Valor = (nome: string) => number | null;

/**
 * Os formatos das células do painel: R$ em milhões (M) ou em milhares (K),
 * volumes (m³, pistas), percentuais (sobre a receita líquida, /RL) e R$/m³.
 */
export type Formato = "MILHOES" | "MILHARES" | "M3" | "PISTAS" | "PCT" | "PCT_RL" | "RS_M3";

/** Os formatos, com o nome da tela (o cadastro do Painel de Bordo). */
export const FORMATOS_DO_PAINEL: Array<[Formato, string]> = [
  ["MILHOES", "R$ em Milhões (M)"],
  ["MILHARES", "R$ em Milhares (K)"],
  ["M3", "Volume (m³)"],
  ["PISTAS", "Pistas"],
  ["PCT", "Percentual (%)"],
  ["PCT_RL", "Percentual da Receita (% RL)"],
  ["RS_M3", "R$/m³"],
];

export type ItemPainel = {
  /** O ID do card no cadastro (25/11/2026: os blocos dos relatórios e dos painéis acham o card por ele). */
  id?: string;
  /** O nome do card, por extenso (13/10/2026; antes, abreviado como na planilha: "Receita Oper. Líquida"). */
  titulo: string;
  /** A sigla da linha de baixo do item, como no painel (▪ ROL). */
  sigla: string;
  /** ↑ quanto maior melhor; ↓ quanto menor melhor. */
  sentido: "↑" | "↓";
  /** O formato do Atual e do Acumulado (21/10/2026: o mesmo nos dois; antes, o acumulado podia ter outro). */
  formato: Formato;
  /** A Metodologia: a fórmula sobre os indicadores ([INDICADOR|nome]), como a dos Indicadores. */
  formula: string;
  conta: (x: Valor) => number | null;
  /** O percentual sob o realizado (▪ 48,4% (/RL)): a fórmula e a base que aparece no rótulo. */
  base?: { formula: string; conta: (x: Valor) => number | null; rotulo: string; casas: 1 | 2 };
  /** Começa um novo bloco do quadro (o espaço entre as linhas da planilha). */
  separar?: boolean;
};

export type QuadroPainel = { titulo: string; itens: ItemPainel[] };

/**
 * A conta de uma fórmula do painel: os itens são indicadores ([INDICADOR|nome]); sem o valor de algum (ou com divisão
 * por zero), o item fica sem valor. Lança FormulaInvalidaError com a fórmula mal escrita.
 */
export function contaDaFormula(formula: string): (x: Valor) => number | null {
  const f = compilarFormula(formula);
  return (x) =>
    f.avaliar((chave) => {
      const item = f.itens.get(chave);
      return item?.tipo === "INDICADOR" ? (x(item.nome) ?? NaN) : NaN;
    });
}

/** Os indicadores que uma fórmula do painel usa, pelo nome (vazio se ela não se lê). */
export function indicadoresDaFormula(formula: string | null | undefined): string[] {
  if (!formula) return [];
  try {
    return [...compilarFormula(formula).itens.values()].flatMap((i) => (i.tipo === "INDICADOR" ? [i.nome] : []));
  } catch {
    return [];
  }
}

const N = {
  CPP_MATRIZ: "Custos de Produção: Matriz (CPP)",
  CPP_FILIAL: "Custos de Produção: Filial (CPP)",
  VOL_MATRIZ: "Produção (Vol.): Matriz",
  VOL_FILIAL: "Produção (Vol.): Filial",
  PISTAS: "Produção (Pistas): Filial",
  MO_MATRIZ: "Mão de Obra: Matriz",
  MO_FILIAL: "Mão de Obra: Filial",
  MP_MATRIZ: "Matérias Primas: Matriz",
  MP_FILIAL: "Matérias Primas: Filial",
  GG_MATRIZ: "Gastos Gerais: Matriz",
  GG_FILIAL: "Gastos Gerais: Filial",
  CSM: "Custos de Serviços: Montagem (CSM)",
  RENDIMENTO: "Rendimento: Montagem",
  MOD_MONTAGEM: "Mão de Obra Direta: Montagem",
  GUINDASTES: "Custos e Manutenção: Guindastes",
  FRETE_MATRIZ: "Custos de Frete: Matriz (DVV)",
  FRETE_FILIAL: "Custos de Frete: Filial (DVV)",
  FRETE_TOTAL: "Custos de Frete: Total (DVV)",
  DL: "Despesas de Logística (DL)",
  EXP_MATRIZ: "Expedição (Vol.): Matriz",
  EXP_FILIAL: "Expedição (Vol.): Filial",
  EXP_TOTAL: "Expedição (Vol.): Total",
  DT: "Despesas Técnicas (DT)",
  COMISSOES: "Comissões de Representantes e 3os (DVV)",
  DC: "Despesas Comerciais (DC)",
  VENDA: "Venda: Total",
  MC_VENDAS: "Margem de Contribuição: Total",
  DEMANDA_MATRIZ: "Demanda (Vol.): Matriz",
  DEMANDA_FILIAL: "Demanda (Vol.): Filial",
  DEMANDA_MONTAGEM: "Demanda (Vol.): Montagem",
  DA: "Despesas Administrativas (DA)",
  FCOL: "Fluxo de Caixa Operacional Líquido",
  RL_PROD_MATRIZ: "Receita Líquida: Produção Matriz",
  RL_PROD_FILIAL: "Receita Líquida: Produção Filial",
  RL_FRETE_MATRIZ: "Receita Líquida: Frete Matriz",
  RL_FRETE_FILIAL: "Receita Líquida: Frete Filial",
  RL_MONTAGEM: "Receita Líquida: Montagem",
  RL_SERVICOS: "Receita Líquida: Serviços",
  RL_TOTAL: "Receita Líquida: Total",
  CPV_MATRIZ: "Custo do Produto Vendido (CPV): Matriz",
  CPV_FILIAL: "Custo do Produto Vendido (CPV): Filial",
  CPV_SERVICOS: "Custo do Produto Vendido (CPV): Serviços",
  CPV_TOTAL: "Custo do Produto Vendido (CPV): Total",
  MB_MATRIZ: "Margem Bruta (MB): Matriz",
  MB_FILIAL: "Margem Bruta (MB): Filial",
  MB_SERVICOS: "Margem Bruta (MB): Serviços",
  MB_TOTAL: "Margem Bruta (MB): Total",
  MC: "Margem de Contribuição (MC): Total",
  EBITDA: "Lucro Operacional (EBITDA)",
  RF: "Resultado Financeiro (RF)",
  RL: "Resultado Líquido (RL)",
};

/** Um indicador na fórmula. */
const I = (nome: string) => `[INDICADOR|${nome}]`;

type DefinicaoItem = Omit<ItemPainel, "conta" | "base"> & { base?: { formula: string; casas: 1 | 2 } };
/** O item pronto: as contas das fórmulas (a Metodologia e o percentual). */
export function itemDoPainel({ base, ...d }: DefinicaoItem): ItemPainel {
  return { ...d, conta: contaDaFormula(d.formula), ...(base ? { base: { ...base, conta: contaDaFormula(base.formula), rotulo: "(/RL)" } } : {}) };
}

/** Sobre a receita líquida (/RL). */
const sobre = (nome: string, base: string, casas: 1 | 2 = 1) => ({ formula: `${I(nome)} / ${I(base)}`, casas });
/** R$/m³: o valor sobre o volume. */
const porM3 = (nome: string, volume: string) => `${I(nome)} / ${I(volume)}`;
/** O custo em R$/m³: o percentual do custo sobre a receita, vezes a receita, sobre o volume (como o painel). */
const custoPorM3 = (pct: string, receita: string, volume: string) => `${I(pct)} * ${I(receita)} / ${I(volume)}`;
/** Despesa fixa em R$: o percentual sobre a receita líquida total, vezes ela. */
const despesa = (pct: string) => `${I(pct)} * ${I(N.RL_TOTAL)}`;

const receita = (nome: string) => itemDoPainel({ titulo: "Receita Operacional Líquida", sigla: "ROL", sentido: "↑", formato: "MILHOES", formula: I(nome) });
/**
 * O Custo do Produto Vendido (13/10/2026), entre a receita e a margem bruta, como a planilha: "Custos de Produção", ▪ CPV,
 * ↓ (quanto menor, melhor), com o percentual sobre a receita líquida do quadro.
 */
const cpv = (nome: string, base: string) => itemDoPainel({ titulo: "Custos de Produção", sigla: "CPV", sentido: "↓", formato: "MILHOES", formula: I(nome), base: sobre(nome, base) });
const margemBruta = (nome: string, base: string) => itemDoPainel({ titulo: "Margem Bruta", sigla: "MB", sentido: "↑", formato: "MILHOES", formula: I(nome), base: sobre(nome, base) });
const volume = (titulo: string, sigla: string, nome: string, formato: Formato = "M3") => itemDoPainel({ titulo, sigla, sentido: "↑", formato, formula: I(nome) });
const fixa = (titulo: string, sigla: string, pct: string) =>
  itemDoPainel({ titulo, sigla, sentido: "↓", formato: "MILHARES", formula: despesa(pct), base: { formula: I(pct), casas: 2 } });
const unitario = (titulo: string, sigla: string, nome: string, separar?: boolean) => itemDoPainel({ titulo, sigla, sentido: "↓", formato: "RS_M3", formula: I(nome), separar });

/**
 * Aba Painel (Resultados), como o painel era antes do cadastro (17/10/2026): o cadastro do Painel de Bordo começou com
 * estes itens; os painéis leem o cadastro.
 */
export const PAINEL_RESULTADOS: QuadroPainel[] = [
  {
    titulo: "Consolidado",
    itens: [
      receita(N.RL_TOTAL),
      cpv(N.CPV_TOTAL, N.RL_TOTAL),
      // A planilha traz "▪ MC" na linha de baixo da Margem Bruta (C12); é a MB.
      margemBruta(N.MB_TOTAL, N.RL_TOTAL),
      itemDoPainel({ titulo: "Margem de Contribuição", sigla: "MC", sentido: "↑", formato: "MILHOES", formula: I(N.MC), base: sobre(N.MC, N.RL_TOTAL) }),
      itemDoPainel({ titulo: "Lucro Operacional", sigla: "EBITDA", sentido: "↑", formato: "MILHOES", formula: I(N.EBITDA), base: sobre(N.EBITDA, N.RL_TOTAL) }),
      // O percentual é sobre a receita líquida (/RL), como os demais (13/10/2026; antes, sobre a Margem de Contribuição, I19/I13 na planilha).
      itemDoPainel({ titulo: "Resultado Financeiro", sigla: "RF", sentido: "↑", formato: "MILHARES", formula: I(N.RF), base: sobre(N.RF, N.RL_TOTAL) }),
      itemDoPainel({ titulo: "Resultado Líquido", sigla: "RL", sentido: "↑", formato: "MILHOES", formula: I(N.RL), base: sobre(N.RL, N.RL_TOTAL) }),
      itemDoPainel({ titulo: "FCO Líquido", sigla: "FCOL", sentido: "↑", formato: "MILHOES", formula: I(N.FCOL), base: sobre(N.FCOL, N.RL_TOTAL) }),
    ],
  },
  {
    titulo: "Produção: Matriz",
    itens: [volume("Volume Produzido", "V (P)", N.VOL_MATRIZ), receita(N.RL_PROD_MATRIZ), cpv(N.CPV_MATRIZ, N.RL_PROD_MATRIZ), margemBruta(N.MB_MATRIZ, N.RL_PROD_MATRIZ)],
  },
  {
    titulo: "Produção: Filial",
    itens: [
      volume("Volume Produzido", "V (P)", N.VOL_FILIAL),
      volume("Pistas Produzidas", "P", N.PISTAS, "PISTAS"),
      receita(N.RL_PROD_FILIAL),
      cpv(N.CPV_FILIAL, N.RL_PROD_FILIAL),
      margemBruta(N.MB_FILIAL, N.RL_PROD_FILIAL),
    ],
  },
  {
    titulo: "Despesas Variáveis de Venda",
    itens: [
      volume("Volume Expedido", "V (E)", N.EXP_TOTAL),
      itemDoPainel({
        titulo: "Custos de Frete",
        sigla: "CF (%RL Frete)",
        sentido: "↓",
        formato: "PCT_RL",
        formula: `${I(N.FRETE_TOTAL)} / (${I(N.RL_FRETE_MATRIZ)} + ${I(N.RL_FRETE_FILIAL)})`,
      }),
      itemDoPainel({ titulo: "Comissões", sigla: "C (%RL Total)", sentido: "↓", formato: "PCT_RL", formula: `${I(N.COMISSOES)} / ${I(N.RL_TOTAL)}` }),
    ],
  },
  {
    titulo: "Serviços",
    itens: [volume("Volume Montado", "V (M)", N.RENDIMENTO), receita(N.RL_SERVICOS), cpv(N.CPV_SERVICOS, N.RL_SERVICOS), margemBruta(N.MB_SERVICOS, N.RL_SERVICOS)],
  },
  {
    titulo: "Despesas Fixas Operacionais",
    itens: [fixa("Logística", "DL", N.DL), fixa("Técnico", "DT", N.DT), fixa("Comercial", "DC", N.DC), fixa("Administrativo", "DA", N.DA)],
  },
];

const producaoUnitaria = (u: "Matriz" | "Filial"): ItemPainel[] => {
  const m = u === "Matriz";
  const vol = m ? N.VOL_MATRIZ : N.VOL_FILIAL;
  const rl = m ? N.RL_PROD_MATRIZ : N.RL_PROD_FILIAL;
  const cpp = m ? N.CPP_MATRIZ : N.CPP_FILIAL;
  const mb = m ? N.MB_MATRIZ : N.MB_FILIAL;
  return [
    volume("Volume Produzido", "V (P)", vol),
    ...(m ? [] : [volume("Pistas Produzidas", "P", N.PISTAS, "PISTAS")]),
    itemDoPainel({ titulo: "Receita Líquida de Produção", sigla: "ROL (P)", sentido: "↑", formato: "RS_M3", formula: porM3(rl, vol) }),
    itemDoPainel({ titulo: "Custos de Produção", sigla: "CP", sentido: "↓", formato: "RS_M3", formula: custoPorM3(cpp, rl, vol), base: { formula: I(cpp), casas: 1 } }),
    itemDoPainel({ titulo: "Margem Bruta", sigla: "MB", sentido: "↑", formato: "RS_M3", formula: porM3(mb, vol), base: sobre(mb, rl) }),
    unitario(m ? "Mão de Obra +Formas" : "Mão de Obra", m ? "MO+F" : "MO", m ? N.MO_MATRIZ : N.MO_FILIAL, true),
    unitario("Matérias Primas", "MP", m ? N.MP_MATRIZ : N.MP_FILIAL),
    unitario("Gastos Gerais", "GG", m ? N.GG_MATRIZ : N.GG_FILIAL),
  ];
};

/** Aba Painel (Performance), como era antes do cadastro (17/10/2026): os unitários. */
export const PAINEL_PERFORMANCE: QuadroPainel[] = [
  {
    titulo: "Vendas",
    itens: [
      itemDoPainel({ titulo: "Venda Total", sigla: "VT", sentido: "↑", formato: "MILHOES", formula: I(N.VENDA) }),
      itemDoPainel({ titulo: "Margem de Contribuição Vendida", sigla: "MC (V)", sentido: "↑", formato: "PCT", formula: I(N.MC_VENDAS) }),
      volume("Demanda: Matriz", "D (M)", N.DEMANDA_MATRIZ),
      volume("Demanda: Filial", "D (F)", N.DEMANDA_FILIAL),
      volume("Demanda: Montagem", "D (S)", N.DEMANDA_MONTAGEM),
    ],
  },
  { titulo: "Produção: Matriz", itens: producaoUnitaria("Matriz") },
  { titulo: "Produção: Filial", itens: producaoUnitaria("Filial") },
  {
    titulo: "Despesas Variáveis de Venda",
    itens: [
      volume("Volume Expedido: Matriz", "V (E,M)", N.EXP_MATRIZ),
      volume("Volume Expedido: Filial", "V (E,F)", N.EXP_FILIAL),
      itemDoPainel({ titulo: "Custos de Frete: Matriz", sigla: "CF (M)", sentido: "↓", formato: "PCT_RL", formula: `${I(N.FRETE_MATRIZ)} / ${I(N.RL_FRETE_MATRIZ)}` }),
      itemDoPainel({ titulo: "Custos de Frete: Filial", sigla: "CF (F)", sentido: "↓", formato: "PCT_RL", formula: `${I(N.FRETE_FILIAL)} / ${I(N.RL_FRETE_FILIAL)}` }),
    ],
  },
  {
    titulo: "Serviços",
    itens: [
      volume("Volume Montado", "V (M)", N.RENDIMENTO),
      itemDoPainel({ titulo: "Receita Operacional Líquida", sigla: "ROL", sentido: "↑", formato: "RS_M3", formula: porM3(N.RL_MONTAGEM, N.RENDIMENTO) }),
      itemDoPainel({
        titulo: "Custos de Montagem",
        sigla: "CSM",
        sentido: "↓",
        formato: "RS_M3",
        formula: custoPorM3(N.CSM, N.RL_MONTAGEM, N.RENDIMENTO),
        base: { formula: I(N.CSM), casas: 1 },
      }),
      itemDoPainel({ titulo: "Margem Bruta", sigla: "MB", sentido: "↑", formato: "RS_M3", formula: porM3(N.MB_SERVICOS, N.RENDIMENTO), base: sobre(N.MB_SERVICOS, N.RL_MONTAGEM) }),
      unitario("Mão de Obra Direta + Terceiros", "MOD+3os", N.MOD_MONTAGEM, true),
      unitario("Manutenção + Locação", "M+L", N.GUINDASTES),
    ],
  },
];

/** O desvio contra o orçado; com o orçado negativo, o sinal se inverte (como o painel faz no resultado financeiro e no líquido). */
export function vsOrcado(realizado: number | null, orcado: number | null): number | null {
  if (realizado === null || orcado === null || orcado === 0) return null;
  return (realizado / orcado - 1) * (orcado < 0 ? -1 : 1);
}

/**
 * O sinal do painel: 0 com desvio de até 5%; senão 1 quando o realizado está do lado bom do orçado, −1 do outro. Com o
 * orçado zero (22/10/2026: a meta zero, como a de Acidentes c/ Afastamento), sem o desvio, o sinal pelo lado do
 * realizado: 0 se também for zero; senão melhor ou pior conforme o sentido. `comOrcado` falso (o exercício sem o cenário
 * orçado ou o mês sem valor nele: o zero é a falta do orçado), sem sinal.
 */
export function sinal(item: Pick<ItemPainel, "sentido">, realizado: number | null, orcado: number | null, comOrcado = true): -1 | 0 | 1 | null {
  if (orcado === 0 && realizado !== null) {
    if (!comOrcado || (item.sentido !== "↑" && item.sentido !== "↓")) return null;
    if (realizado === 0) return 0;
    return (item.sentido === "↑" ? realizado > 0 : realizado < 0) ? 1 : -1;
  }
  const vs = vsOrcado(realizado, orcado);
  if (vs === null) return null;
  if (Math.abs(vs) <= 0.05) return 0;
  const pior = item.sentido === "↑" ? realizado! < orcado! : realizado! > orcado!;
  return pior ? -1 : 1;
}

/** Um item do cadastro do Painel de Bordo (o que a tabela painel_itens guarda). */
export type ItemDoCadastroPainel = {
  id?: string;
  grupo: string;
  quadro: string;
  nome: string;
  sigla: string;
  sentido: string;
  formula: string;
  formato: string;
  percentual: string | null;
  casasPercentual: number;
  separar: boolean;
};

const FORMATOS = new Set<string>(FORMATOS_DO_PAINEL.map(([f]) => f));

/**
 * Os quadros de cada aba a partir dos itens do cadastro (ativos, já na ordem): o item usa a Metodologia, o formato e o
 * percentual do cadastro; os quadros seguem a ordem do primeiro item de cada um. Item com a fórmula que não se lê fica
 * de fora (o cadastro valida ao gravar).
 */
export function quadrosDoCadastro(itens: ItemDoCadastroPainel[]): Record<"resultados" | "performance", QuadroPainel[]> {
  const r: Record<"resultados" | "performance", QuadroPainel[]> = { resultados: [], performance: [] };
  for (const i of itens) {
    let item: ItemPainel;
    try {
      item = itemDoPainel({
        ...(i.id ? { id: i.id } : {}),
        titulo: i.nome,
        sigla: i.sigla,
        sentido: i.sentido === "↓" ? "↓" : "↑",
        formato: (FORMATOS.has(i.formato) ? i.formato : "MILHOES") as Formato,
        formula: i.formula,
        ...(i.percentual ? { base: { formula: i.percentual, casas: i.casasPercentual === 2 ? 2 : 1 } } : {}),
        ...(i.separar ? { separar: true } : {}),
      });
    } catch {
      continue;
    }
    const quadros = r[i.grupo === "PERFORMANCE" ? "performance" : "resultados"];
    let q = quadros.find((x) => x.titulo === i.quadro);
    if (!q) quadros.push((q = { titulo: i.quadro, itens: [] }));
    q.itens.push(item);
  }
  return r;
}
