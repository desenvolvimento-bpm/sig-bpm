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
 * salários dos aprendizes (a senioridade Aprendiz, nas linhas CLT da aba Quadro de Lotação do cenário) e Fundo de
 * Garantia: CLT (8%, a venda ENCARGOS_FGTS de antes) sobre o resto da base. Com a diferença, o cálculo fica
 *
 *   base × [(INSS + FGTS CLT + Férias + 13º) + (INSS + FGTS CLT) × (Férias + 13º)]
 *   + (FGTS Aprendiz − FGTS CLT) × Salários dos Aprendizes × (1 + Férias + 13º) + Benefícios Adicionais
 *
 * — o mesmo que o FGTS de cada um sobre os seus salários; sem aprendizes, o de antes.
 */

export type ItemDosEncargos = "INSS" | "FGTS_APRENDIZ" | "FGTS" | "FERIAS" | "DECIMO_TERCEIRO" | "BENEFICIOS";
export const ITENS_DOS_ENCARGOS: Array<{ item: ItemDosEncargos; venda: string; rotulo: string; und: "%" | "R$"; padrao: number | null }> = [
  { item: "INSS", venda: "ENCARGOS_INSS", rotulo: "Previdência Social (INSS)", und: "%", padrao: 0.29 },
  { item: "FGTS_APRENDIZ", venda: "ENCARGOS_FGTS_APRENDIZ", rotulo: "Fundo de Garantia: Aprendiz (FGTS)", und: "%", padrao: 0.02 },
  { item: "FGTS", venda: "ENCARGOS_FGTS", rotulo: "Fundo de Garantia: CLT (FGTS)", und: "%", padrao: 0.08 },
  // 1/12 de férias por mês trabalhado, com o terço constitucional: 1/12 × 4/3.
  { item: "FERIAS", venda: "ENCARGOS_FERIAS", rotulo: "Férias (+1/3)", und: "%", padrao: 1 / 9 },
  { item: "DECIMO_TERCEIRO", venda: "ENCARGOS_13", rotulo: "Décimo Terceiro", und: "%", padrao: 1 / 12 },
  { item: "BENEFICIOS", venda: "BENEFICIOS", rotulo: "Benefícios Adicionais", und: "R$", padrao: null },
];
export const VENDAS_DOS_ENCARGOS = new Set(ITENS_DOS_ENCARGOS.map((i) => i.venda));
export const itemDosEncargos = (item: string) => ITENS_DOS_ENCARGOS.find((i) => i.item === item);

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

/**
 * As contas de encargos de um grupo: para cada mão de obra (o prefixo "CPP.MOD"…) que o grupo tem, a conta de encargos,
 * as de base, a das Remunerações PJ (09/11/2026: o Quadro de Lotação do cenário) e se é a dos Benefícios Adicionais (a
 * principal: a da atribuição do grupo).
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
 * do grupo; `gravado(venda, mes)`, as premissas dos encargos; `aprendizes(prefixo, mes)`, os salários dos aprendizes da mão
 * de obra (09/11/2026; sem eles, zero).
 */
export function encargosDoGrupo(
  codigos: string[],
  atribuicao: GrupoDoCenario["atribuicao"],
  conta: (codigo: string, mes: number) => number,
  gravado: (venda: string, mes: number) => number | undefined,
  aprendizes: (prefixo: string, mes: number) => number = () => 0,
) {
  const r = new Map<string, number[]>();
  const beneficios = ITENS_DOS_ENCARGOS.find((i) => i.item === "BENEFICIOS")!;
  for (const mo of maosDeObraDoGrupo(codigos, atribuicao)) {
    r.set(
      mo.encargos,
      Array.from({ length: 12 }, (_, k) => {
        const mes = k + 1;
        const base = conta(mo.remuneracoes, mes) + conta(mo.horasExtras, mes);
        const valor = (item: ItemDosEncargos) => valorDoItem(itemDosEncargos(item)!, gravado, mes);
        return encargosDaBase(base, aprendizes(mo.prefixo, mes), valor) + (mo.beneficios ? valorDoItem(beneficios, gravado, mes) : 0);
      }),
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
