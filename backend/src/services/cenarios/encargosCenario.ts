import type { GrupoDoCenario } from "./centrosCenario.js";

/**
 * Os Encargos e Benefícios dos centros de custo dos cenários analíticos (19/10/2026; o "Exemplo de Cálculo dos Encargos e
 * Benefícios" do Quadro de Lotação): na aba Centros de Custo das Premissas, embaixo do Quadro de Lotação, os percentuais
 * de cada grupo e mês — Previdência Social (INSS), Fundo de Garantia (FGTS; desde 09/11/2026, Aprendiz e CLT, abaixo),
 * Férias (+1/3) e Décimo Terceiro, com o padrão
 * abaixo em todos os cenários, editáveis — e os Benefícios Adicionais (R$, digitados). A conta Encargos e Benefícios da
 * mão de obra (direta e indireta) é calculada, mês a mês, com o INSS e o FGTS também sobre as provisões de férias e de
 * décimo terceiro (20/10/2026, o exemplo revisado pelo usuário):
 *
 *   base × (INSS + FGTS + Férias + Décimo Terceiro) + (INSS + FGTS) × (Férias + Décimo Terceiro) × base + Benefícios
 *   Adicionais, com a base = Remunerações CLT + Horas Extras
 *
 * Com o padrão, o fator é 63,64% (antes, sem a incidência, 56,44%). As Remunerações PJ não têm encargos. Os Benefícios
 * Adicionais entram na mão de obra da atribuição do grupo (Direta: a MOD; Indireta ou sem atribuição: a MOI; a outra, quando
 * o grupo da DRE só tem uma); na referência realizada, são a diferença entre os encargos realizados e o cálculo
 * (beneficiosDaDiferenca). A Média de Referência da conta fica a do realizado. Gravados nas premissas com a unidade 0, a
 * venda de cada item e a chave o grupo; os percentuais, em fração. Os 29% do INSS (20% da cota patronal, o RAT × FAP e os
 * terceiros) foram adotados pelo usuário em 20/10/2026, a confirmar com a contabilidade.
 *
 * O FGTS em duas linhas (09/11/2026, etapa 4 da Gestão de Colaboradores): Fundo de Garantia: Aprendiz (2%) sobre os
 * salários dos aprendizes (as linhas do Tipo Aprendiz na aba Quadro de Lotação do cenário) e Fundo de
 * Garantia: CLT (8%, a venda ENCARGOS_FGTS de antes) sobre o resto da base. Com a diferença, o cálculo fica
 *
 *   base × [(INSS + FGTS CLT + Férias + 13º) + (INSS + FGTS CLT) × (Férias + 13º)]
 *   + (FGTS Aprendiz − FGTS CLT) × Salários dos Aprendizes × (1 + Férias + 13º) + Benefícios Adicionais
 *
 * — o mesmo que o FGTS de cada um sobre os seus salários; sem aprendizes, o de antes.
 *
 * Os estagiários e os bolsistas (11/11/2026, pedido do Adão; o Tipo Estagiário, Lei 11.788/2008) não têm INSS, FGTS,
 * férias com o terço nem 13º: os salários deles nas Remunerações CLT saem da base,
 *
 *   base = Remunerações CLT + Horas Extras − Salários dos Estagiários.
 *
 * Os Salários dos Aprendizes e dos Estagiários (12/11/2026, pedido do Adão: um por grupo, como os Salários CLT e PJ; antes,
 * um de cada por mão de obra) entram só na mão de obra da atribuição do grupo, a que recebe as remunerações do Quadro de
 * Lotação (quadroDoCenario.ts); na outra, a base é Remunerações CLT + Horas Extras.
 *
 * Os Benefícios Padrão (21/11/2026, pedido do Adão): a soma dos Benefícios das linhas do grupo na aba Quadro de Lotação (os
 * Benefícios Padrão aplicados × os colaboradores, ou o valor digitado na importação). Calculados, não se digitam; entram, como os
 * Benefícios Adicionais, na conta Encargos e Benefícios da mão de obra principal:
 *
 *   Encargos e Benefícios = (o cálculo acima) + Benefícios Adicionais + Benefícios Padrão.
 */

export type ItemDosEncargos = "INSS" | "FGTS_APRENDIZ" | "FGTS" | "FERIAS" | "DECIMO_TERCEIRO" | "BENEFICIOS" | "BENEFICIOS_PADRAO";
/** Os itens dos Encargos e Benefícios; `calculado` (os Benefícios Padrão, 21/11/2026): vem da aba Quadro de Lotação e não se digita. */
export const ITENS_DOS_ENCARGOS: Array<{ item: ItemDosEncargos; venda: string; rotulo: string; und: "%" | "R$"; padrao: number | null; calculado?: boolean }> = [
  { item: "INSS", venda: "ENCARGOS_INSS", rotulo: "Previdência Social (INSS)", und: "%", padrao: 0.29 },
  { item: "FGTS_APRENDIZ", venda: "ENCARGOS_FGTS_APRENDIZ", rotulo: "Fundo de Garantia: Aprendiz (FGTS)", und: "%", padrao: 0.02 },
  { item: "FGTS", venda: "ENCARGOS_FGTS", rotulo: "Fundo de Garantia: CLT (FGTS)", und: "%", padrao: 0.08 },
  // 1/12 de férias por mês trabalhado, com o terço constitucional: 1/12 × 4/3.
  { item: "FERIAS", venda: "ENCARGOS_FERIAS", rotulo: "Férias (+1/3)", und: "%", padrao: 1 / 9 },
  { item: "DECIMO_TERCEIRO", venda: "ENCARGOS_13", rotulo: "Décimo Terceiro", und: "%", padrao: 1 / 12 },
  // Os Benefícios Padrão antes dos Benefícios Adicionais (27/11/2026, pedido do Adão).
  // A venda não se grava (os Benefícios Padrão saem do Quadro de Lotação em cada cálculo): só o nome do item.
  { item: "BENEFICIOS_PADRAO", venda: "BENEFICIOS_PADRAO", rotulo: "Benefícios Padrão", und: "R$", padrao: null, calculado: true },
  { item: "BENEFICIOS", venda: "BENEFICIOS", rotulo: "Benefícios Adicionais", und: "R$", padrao: null },
];
export const VENDAS_DOS_ENCARGOS = new Set(ITENS_DOS_ENCARGOS.map((i) => i.venda));
export const itemDosEncargos = (item: string) => ITENS_DOS_ENCARGOS.find((i) => i.item === item);

/**
 * As linhas calculadas dos Encargos e Benefícios de um grupo (27/11/2026, pedido do Adão), na aba Centros de Custo das Premissas e
 * nos Excel dos centros: logo antes dos Benefícios Padrão, os Encargos Trabalhistas (a soma das contas Encargos e Benefícios do
 * grupo, só o cálculo pelos percentuais, sem os benefícios) e, abaixo, os Encargos por Folha (os Encargos Trabalhistas ÷ as
 * Remunerações CLT do grupo, em %); depois dos Benefícios Adicionais, os Benefícios por Colaborador (os Benefícios Padrão + os
 * Adicionais ÷ o Total de Colaboradores, em R$). Não se gravam, não se digitam nem se importam: os arquivos sem elas continuam
 * se importando.
 */
export type IndicadorDosEncargos = "ENCARGOS_TRABALHISTAS" | "ENCARGOS_POR_FOLHA" | "BENEFICIOS_POR_COLABORADOR";
export const INDICADORES_DOS_ENCARGOS: Array<{ item: IndicadorDosEncargos; rotulo: string; und: "R$" | "%" | "R$/colab."; depoisDe: ItemDosEncargos }> = [
  { item: "ENCARGOS_TRABALHISTAS", rotulo: "Encargos Trabalhistas", und: "R$", depoisDe: "DECIMO_TERCEIRO" },
  { item: "ENCARGOS_POR_FOLHA", rotulo: "Encargos por Folha", und: "%", depoisDe: "DECIMO_TERCEIRO" },
  { item: "BENEFICIOS_POR_COLABORADOR", rotulo: "Benefícios por Colaborador", und: "R$/colab.", depoisDe: "BENEFICIOS" },
];
/** As linhas dos Encargos e Benefícios na ordem da tela e dos Excel: os itens, com as calculadas depois do item delas. */
export const LINHAS_DOS_ENCARGOS: Array<ItemDosEncargos | IndicadorDosEncargos> = ITENS_DOS_ENCARGOS.flatMap((i) => [
  i.item,
  ...INDICADORES_DOS_ENCARGOS.filter((x) => x.depoisDe === i.item).map((x) => x.item),
]);
export const indicadorDosEncargos = (item: string) => INDICADORES_DOS_ENCARGOS.find((i) => i.item === item);

/**
 * Os valores das linhas calculadas num mês (ou na Média de Referência, ou no ano, com as somas): os Encargos Trabalhistas, os
 * Encargos por Folha (em fração; sem Remunerações CLT, nulo) e os Benefícios por Colaborador (sem colaboradores, nulo).
 */
export function valoresDosIndicadores(x: { encargos: number; remuneracoesCLT: number; beneficios: number; colaboradores: number }): Record<IndicadorDosEncargos, number | null> {
  return {
    ENCARGOS_TRABALHISTAS: x.encargos,
    ENCARGOS_POR_FOLHA: Math.abs(x.remuneracoesCLT) < 0.005 ? null : x.encargos / x.remuneracoesCLT,
    BENEFICIOS_POR_COLABORADOR: Math.abs(x.colaboradores) < 0.0001 ? null : x.beneficios / x.colaboradores,
  };
}

/**
 * O fator dos encargos sobre a base: (INSS + FGTS + Férias + Décimo Terceiro) + (INSS + FGTS) × (Férias + Décimo Terceiro).
 * `valor(item)` lê o percentual (em fração).
 */
export function fatorDosEncargos(valor: (item: ItemDosEncargos) => number) {
  const sobreAFolha = valor("INSS") + valor("FGTS");
  const provisoes = valor("FERIAS") + valor("DECIMO_TERCEIRO");
  return sobreAFolha + provisoes + sobreAFolha * provisoes;
}
/** O fator com os percentuais padrão (63,64%). */
export const FATOR_PADRAO = fatorDosEncargos((item) => itemDosEncargos(item)!.padrao ?? 0);

/**
 * Os encargos de uma mão de obra num mês (09/11/2026): a base pelo fator (com o FGTS CLT) mais a diferença do FGTS dos
 * aprendizes sobre os salários deles, com a incidência nas provisões de férias e de décimo terceiro.
 */
export function encargosDaBase(base: number, aprendizes: number, valor: (item: ItemDosEncargos) => number) {
  const provisoes = valor("FERIAS") + valor("DECIMO_TERCEIRO");
  return base * fatorDosEncargos(valor) + (valor("FGTS_APRENDIZ") - valor("FGTS")) * aprendizes * (1 + provisoes);
}

/** O sufixo das contas da mão de obra. */
const REMUNERACOES_CLT = "REMUNERACOES_CLT";
const REMUNERACOES_PJ = "REMUNERACOES_PJ";
const HORAS_EXTRAS = "HORAS_EXTRAS";
const ENCARGOS = "ENCARGOS_E_BENEFICIOS";
/** A conta é a Encargos e Benefícios (calculada nos analíticos)? */
export const ehContaDeEncargos = (codigo: string) => codigo.endsWith(`.${ENCARGOS}`);
/** A conta é a Remunerações CLT de uma mão de obra (27/11/2026: a base dos Encargos por Folha)? */
export const ehContaDeRemuneracoesCLT = (codigo: string) => codigo.endsWith(`.${REMUNERACOES_CLT}`);

/**
 * As contas de encargos de um grupo: para cada mão de obra (o prefixo "CPP.MOD"…) que o grupo tem, a conta de encargos,
 * as de base, a das Remunerações PJ (09/11/2026: o Quadro de Lotação do cenário) e se é a principal, a da atribuição do grupo
 * (Direta: a MOD; Indireta ou sem atribuição: a MOI; a outra, quando o grupo da DRE só tem uma): a dos Benefícios Adicionais
 * e, desde 12/11/2026, a que recebe as remunerações e os salários do Quadro de Lotação.
 */
export function maosDeObraDoGrupo(codigos: string[], atribuicao: GrupoDoCenario["atribuicao"]) {
  const prefixos = [...new Set(codigos.filter(ehContaDeEncargos).map((c) => c.slice(0, -ENCARGOS.length - 1)))];
  const direta = prefixos.find((p) => p.endsWith(".MOD"));
  const indireta = prefixos.find((p) => p.endsWith(".MOI"));
  const principal = atribuicao === "DIRETA" ? (direta ?? indireta) : (indireta ?? direta);
  return prefixos.map((p) => ({
    prefixo: p,
    direta: p === direta,
    encargos: `${p}.${ENCARGOS}`,
    remuneracoes: `${p}.${REMUNERACOES_CLT}`,
    remuneracoesPJ: `${p}.${REMUNERACOES_PJ}`,
    horasExtras: `${p}.${HORAS_EXTRAS}`,
    beneficios: p === principal,
    principal: p === principal,
  }));
}

/**
 * O valor de um item dos encargos de um grupo num mês: o gravado; sem ele, o padrão (nos Benefícios Adicionais, zero).
 * `gravado` lê a premissa (venda, grupo, mês).
 */
export function valorDoItem(item: (typeof ITENS_DOS_ENCARGOS)[number], gravado: (venda: string, mes: number) => number | undefined, mes: number) {
  return gravado(item.venda, mes) ?? item.padrao ?? 0;
}

/**
 * Os Encargos e Benefícios de um grupo nos doze meses (conta → os doze meses): `conta(codigo, mes)` lê o valor das contas
 * do grupo; `gravado(venda, mes)`, as premissas dos encargos; `aprendizes(mes)`, os Salários dos Aprendizes do grupo
 * (09/11/2026; sem eles, zero); `estagiarios(mes)`, os dos Estagiários, que saem da base (11/11/2026); `beneficiosPadrao(mes)`,
 * os Benefícios do Quadro de Lotação do grupo (21/11/2026). Os três, só na mão de obra principal (12/11/2026).
 */
export function encargosDoGrupo(
  codigos: string[],
  atribuicao: GrupoDoCenario["atribuicao"],
  conta: (codigo: string, mes: number) => number,
  gravado: (venda: string, mes: number) => number | undefined,
  aprendizes: (mes: number) => number = () => 0,
  estagiarios: (mes: number) => number = () => 0,
  beneficiosPadrao: (mes: number) => number = () => 0,
) {
  const r = new Map<string, number[]>();
  const beneficios = ITENS_DOS_ENCARGOS.find((i) => i.item === "BENEFICIOS")!;
  for (const mo of maosDeObraDoGrupo(codigos, atribuicao)) {
    r.set(
      mo.encargos,
      Array.from({ length: 12 }, (_, k) => {
        const mes = k + 1;
        const base = conta(mo.remuneracoes, mes) + conta(mo.horasExtras, mes) - (mo.principal ? estagiarios(mes) : 0);
        const valor = (item: ItemDosEncargos) => valorDoItem(itemDosEncargos(item)!, gravado, mes);
        return encargosDaBase(base, mo.principal ? aprendizes(mes) : 0, valor) + (mo.beneficios ? valorDoItem(beneficios, gravado, mes) + beneficiosPadrao(mes) : 0);
      }),
    );
  }
  return r;
}

/**
 * A base dos Encargos e Benefícios de uma mão de obra de um grupo com a mão de obra das médias (22/11/2026, maoDeObraDasMedias.ts):
 * a Média de Referência da conta (`media(codigo)`, o mês 0), sem cálculo pelos percentuais; na que leva os Benefícios Adicionais,
 * sem a média deles (o mês 0 da premissa). O cálculo a grava na primeira vez e depois a lê: outra referência não a muda.
 */
export function baseDasMedias(
  mo: ReturnType<typeof maosDeObraDoGrupo>[number],
  media: (codigo: string) => number | undefined,
  gravado: (venda: string, mes: number) => number | undefined,
) {
  return (media(mo.encargos) ?? 0) - (mo.beneficios ? (gravado(itemDosEncargos("BENEFICIOS")!.venda, 0) ?? 0) : 0);
}

/**
 * Os Encargos e Benefícios de um grupo com a mão de obra das médias (22/11/2026, maoDeObraDasMedias.ts), nos doze meses: a base de
 * cada mão de obra (`base(codigo)`, baseDasMedias); na que leva os Benefícios Adicionais, mais o valor deles em cada mês — eles
 * continuam digitados. Sem os Benefícios Padrão (o Quadro de Lotação não é a fonte).
 */
export function encargosDasMedias(
  codigos: string[],
  atribuicao: GrupoDoCenario["atribuicao"],
  base: (codigo: string) => number | undefined,
  gravado: (venda: string, mes: number) => number | undefined,
) {
  const r = new Map<string, number[]>();
  const beneficios = itemDosEncargos("BENEFICIOS")!;
  for (const mo of maosDeObraDoGrupo(codigos, atribuicao)) {
    const semBeneficios = base(mo.encargos) ?? 0;
    r.set(
      mo.encargos,
      Array.from({ length: 12 }, (_, k) => semBeneficios + (mo.beneficios ? valorDoItem(beneficios, gravado, k + 1) : 0)),
    );
  }
  return r;
}

/**
 * Os Benefícios Adicionais da referência realizada (20/10/2026, decisão do usuário): a diferença entre os encargos
 * realizados do grupo e o cálculo com os percentuais padrão, (Remunerações CLT + Horas Extras) × FATOR_PADRAO, somada nas
 * mãos de obra dele; assim, os meses fechados e a Média de Referência da conta Encargos e Benefícios batem com o realizado.
 * Pode ser negativa (o realizado abaixo do cálculo). `conta(codigo)` lê o valor do mês.
 */
export function beneficiosDaDiferenca(codigos: string[], atribuicao: GrupoDoCenario["atribuicao"], conta: (codigo: string) => number) {
  return maosDeObraDoGrupo(codigos, atribuicao).reduce((s, mo) => s + conta(mo.encargos) - (conta(mo.remuneracoes) + conta(mo.horasExtras)) * FATOR_PADRAO, 0);
}
