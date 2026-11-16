import type {
  AtribuicaoCusto,
  BaldeAlocacao,
  TipoAlocacao,
  TipoConta,
  ValidacaoLancamento,
} from "../../generated/prisma/enums.js";
import { ehCentroDeObra } from "./centrosObra.js";

/**
 * Classificação de um lançamento do balancete — a versão sistêmica das colunas
 * G a T da aba `Gastos (Contábil)` do BASE REALIZADO (RESULTADOS).
 *
 * Diferenças deliberadas em relação à planilha:
 *  - o centro de custo é localizado pelo CÓDIGO do RM, não pelo nome;
 *  - a troca de conta (CONTA (ALOC.)) vem do cadastro de reclassificação, e não
 *    de um valor digitado ao lado da linha;
 *  - a verificação compara os NOMES de departamento e atribuição. As siglas
 *    (DEP., ATR.) da planilha são só abreviação visual.
 *
 * Função pura: recebe o cadastro já resolvido e devolve os campos derivados.
 */

export type CentroParaClassificar = {
  id: string;
  departamento: string | null;
  atribuicao: AtribuicaoCusto | null;
  balde: BaldeAlocacao | null;
};

export type ContaParaClassificar = {
  id: string;
  tipoConta: TipoConta;
  departamento: string | null;
  atribuicao: string | null;
  balde: BaldeAlocacao | null;
  linhaDREId: string | null;
  /** Rótulo da linha da DRE — a CONTA DRE da planilha, usado na etiqueta. */
  linhaDREDescricao: string | null;
  /** Sem Resultado (13/11/2026): a conta não vai à DRE, e o movimento não vira pendência. */
  semResultado?: boolean;
};

export type Classificacao = {
  centroCustoId: string | null;
  contaAdotadaId: string;
  departamento: string | null;
  atribuicao: string | null;
  linhaDREId: string | null;
  balde: BaldeAlocacao | null;
  alocacao: TipoAlocacao;
  etiqueta: string;
  validacao: ValidacaoLancamento;
};

/**
 * Departamentos de custo e despesa: só eles passam pela verificação. São
 * também os únicos que contam como parâmetro do centro — ALMOXARIFADO,
 * INVESTIMENTO e REQUISIÇÃO, que a planilha marca com sigla "-", não são
 * departamento da DRE e deixam o centro sem parâmetro.
 */
export const DEPARTAMENTOS_VERIFICADOS = new Set([
  "CUSTOS DE PRODUÇÃO (CP)",
  "CUSTOS DE SERVIÇOS: MONTAGEM (CSM)",
  "CUSTOS DE SERVIÇOS: COMPLEMENTARES (CSC)",
  "DESPESAS DE LOGÍSTICA (DL)",
  "DESPESAS TÉCNICAS (DT)",
  "DESPESAS COMERCIAIS (DC)",
  "DESPESAS ADMINISTRATIVAS (DA)",
]);

/** Atribuições de conta que não cabem em centro direto, e em centro indireto. */
const PROIBIDAS_EM_DIRETA = new Set(["Mão de Obra Indireta", "Gastos Gerais Indiretos"]);
const PROIBIDAS_EM_INDIRETA = new Set(["Mão de Obra Direta", "Gastos Gerais Diretos"]);

/** Baldes que são chave de rateio; os demais são alocação direta. */
const CHAVES_RATEIO = new Set<BaldeAlocacao>([
  "PROJETO",
  "PRODUCAO",
  "METALURGIA",
  "ARMADURA",
  "ACOMPANHAMENTO",
]);

/** Rótulo do balde como a planilha escreve — é o prefixo da etiqueta. */
const ROTULO_BALDE: Partial<Record<BaldeAlocacao, string>> = {
  PRODUCAO: "PRODUÇÃO",
};

/**
 * A coluna LANÇ. OK?, na ordem da fórmula da planilha:
 *  1. o centro tem departamento ou atribuição e a conta não → <ERRO!>;
 *  2. a conta não é de custo nem de despesa → a verificação para;
 *  3. departamento do centro ≠ da conta → <DEP.!>; atribuição incompatível → <ATR.!>.
 * O caso inverso de 1 (conta com parâmetro, centro sem) NÃO é erro: é o caso
 * dos centros de obra, que por definição não têm parâmetro.
 */
export function verificarLancamento(
  centro: { departamento: string | null; atribuicao: AtribuicaoCusto | null },
  conta: { departamento: string | null; atribuicao: string | null },
): ValidacaoLancamento {
  if (centro.departamento && !conta.departamento) return "ERRO_PARAMETRIZACAO";
  if (centro.atribuicao && !conta.atribuicao) return "ERRO_PARAMETRIZACAO";
  if (!conta.departamento || !DEPARTAMENTOS_VERIFICADOS.has(conta.departamento)) return "OK";
  if (centro.departamento && centro.departamento !== conta.departamento) {
    return "ERRO_DEPARTAMENTO";
  }
  const atr = conta.atribuicao ?? "";
  if (centro.atribuicao === "DIRETA" && PROIBIDAS_EM_DIRETA.has(atr)) return "ERRO_ATRIBUICAO";
  if (centro.atribuicao === "INDIRETA" && PROIBIDAS_EM_INDIRETA.has(atr)) return "ERRO_ATRIBUICAO";
  return "OK";
}

export function classificarLancamento(
  codigoCentroCusto: string | null,
  centro: CentroParaClassificar | null,
  contaAdotada: ContaParaClassificar,
): Classificacao {
  const obra = codigoCentroCusto !== null && ehCentroDeObra(codigoCentroCusto);
  const centroNaoCadastrado = codigoCentroCusto !== null && !obra && !centro;
  const centroValido = obra ? null : centro;

  // Lançamento sem centro não é verificado: na planilha os dois lados viram "-".
  const semCentro = codigoCentroCusto === null;
  let validacao: ValidacaoLancamento = centroNaoCadastrado
    ? "CENTRO_NAO_CADASTRADO"
    : semCentro
      ? "OK"
      : verificarLancamento(
          {
            departamento:
              centroValido?.departamento && DEPARTAMENTOS_VERIFICADOS.has(centroValido.departamento)
                ? centroValido.departamento
                : null,
            atribuicao: centroValido?.atribuicao ?? null,
          },
          {
            departamento: contaAdotada.departamento,
            atribuicao: contaAdotada.atribuicao,
          },
        );

  if (
    validacao === "OK" &&
    contaAdotada.tipoConta === "ANALITICA" &&
    !contaAdotada.linhaDREId
  ) {
    validacao = "SEM_DESTINO";
  }
  // A conta Sem Resultado (13/11/2026, pedido do Adão) não vai à DRE: o movimento dela não vira pendência, qualquer que
  // seja o centro.
  if (contaAdotada.semResultado) validacao = "OK";

  // RATEIO: o do centro, quando o centro está no cadastro — mesmo que vazio, e
  // mesmo sendo de obra; senão o da conta. É o IFERROR(centro; conta) da
  // planilha, que ao contrário do departamento não exclui as obras.
  const balde = centro ? centro.balde : contaAdotada.balde;
  const alocacao: TipoAlocacao = balde && CHAVES_RATEIO.has(balde) ? "RATEIO" : "DIRETO";

  const partes = [
    contaAdotada.departamento ?? "-",
    contaAdotada.atribuicao ?? "-",
    contaAdotada.linhaDREDescricao ?? "-",
  ];
  const etiqueta =
    alocacao === "RATEIO"
      ? [ROTULO_BALDE[balde!] ?? balde!, ...partes].join(".")
      : partes.join(".");

  return {
    centroCustoId: centro?.id ?? null,
    contaAdotadaId: contaAdotada.id,
    departamento: contaAdotada.departamento,
    atribuicao: contaAdotada.atribuicao,
    linhaDREId: contaAdotada.linhaDREId,
    balde,
    alocacao,
    etiqueta,
    validacao,
  };
}

/** O fornecedor como a reclassificação o compara (13/11/2026): o nome do CLI_FORN sem espaços nas pontas e sem caixa. */
export const chaveDoFornecedor = (nome: string) => nome.trim().toUpperCase();

/**
 * O centro e a conta que valem para um movimento do balancete (13/11/2026), na ordem das correções:
 *  1. a reclassificação por fornecedor: o centro imperativo do fornecedor no lugar do centro do RM — só o centro;
 *  2. a reclassificação por conta, pelo centro do RM (o do balancete), também no movimento que foi para o centro
 *     imperativo: a troca de conta não depende da reclassificação por fornecedor (decisão do Adão, 13/11/2026, depois da
 *     simulação de 01 a 09/2026: com a troca pelo centro imperativo, a VJR ENGENHARIA perdia as trocas Externo → Interno
 *     do centro do RM e mudava de linha na DRE consolidada);
 *  3. por cima das duas, a contestação validada no balancete: o centro novo dela (sem ele, fica o da 1 ou o do RM) e a
 *     conta nova (sem ela, fica a da 2 ou a do RM).
 * `centro` é nulo quando vale o do RM (`codigoCentroCusto`, o do balancete); senão, é o corrigido, com o código dele.
 */
export function corrigirCentroEConta<C extends { codigoRM: string | null }>(
  l: { codigoCentroCusto: string | null; contaResultadoId: string; cliForn: string | null },
  regras: {
    /** "código do centro|conta de origem" → a conta de destino (a reclassificação por conta). */
    contaDestino: Map<string, string>;
    /** A chave do fornecedor → o centro imperativo (a reclassificação por fornecedor). */
    centroDoFornecedor: Map<string, C>;
  },
  contestacao: { centroNovo: C | null; contaNovaId: string | null } | null,
): { centro: C | null; codigoCentroCusto: string | null; contaId: string; porFornecedor: boolean; porConta: boolean } {
  const imperativo = l.cliForn ? (regras.centroDoFornecedor.get(chaveDoFornecedor(l.cliForn)) ?? null) : null;
  const destino = l.codigoCentroCusto ? regras.contaDestino.get(`${l.codigoCentroCusto}|${l.contaResultadoId}`) : undefined;
  const centro = contestacao?.centroNovo ?? imperativo;
  return {
    centro,
    codigoCentroCusto: centro ? centro.codigoRM : l.codigoCentroCusto,
    contaId: contestacao?.contaNovaId ?? destino ?? l.contaResultadoId,
    porFornecedor: !!imperativo && imperativo.codigoRM !== l.codigoCentroCusto,
    porConta: !!destino,
  };
}

/** O departamento de uma redistribuição de gastos (13/11/2026): os grupos da DRE dele e, na Produção (Matriz e Filial), a filial. */
export type DepartamentoDaRedistribuicao = { grupos: Set<string>; filial: number | null };
/** Uma redistribuição de gastos, como a classificação a usa (13/11/2026): já filtrada pela vigência da competência. */
export type RegraDeRedistribuicao<C> = {
  id: string;
  linhaDREId: string;
  /** Nulo: todos os departamentos. */
  departamento: DepartamentoDaRedistribuicao | null;
  /** As chaves dos fornecedores marcados (chaveDoFornecedor). */
  fornecedores: Set<string>;
  destinos: Array<{ centro: C; percentual: number }>;
};

/** A filial de um departamento na redistribuição: a da unidade, na Produção (1 Matriz, 2 Filial); nas demais unidades, todas. */
export const filialDoDepartamento = (codigoDaUnidade: number) => (codigoDaUnidade === 1 || codigoDaUnidade === 2 ? codigoDaUnidade : null);

/** O movimento é do departamento: a linha é de um grupo da DRE dele e, na Produção, a filial é a da unidade. */
export const movimentoNoDepartamento = (d: DepartamentoDaRedistribuicao, grupoSigla: string | null, filial: number) =>
  !!grupoSigla && d.grupos.has(grupoSigla) && (d.filial === null || d.filial === filial);

/**
 * A redistribuição de gastos de um movimento (13/11/2026), ou nula: a da conta da DRE dele (a linha da conta que vale
 * depois das reclassificações), do fornecedor dele entre os marcados e do departamento (ou de todos). As regras não se
 * sobrepõem (o cadastro recusa); havendo mais de uma, vale a primeira.
 */
export function redistribuicaoDoMovimento<R extends RegraDeRedistribuicao<unknown>>(
  m: { linhaDREId: string | null; grupoSigla: string | null; filial: number; cliForn: string | null },
  regras: R[],
): R | null {
  if (!m.linhaDREId || !m.cliForn) return null;
  const fornecedor = chaveDoFornecedor(m.cliForn);
  return regras.find((r) => r.linhaDREId === m.linhaDREId && r.fornecedores.has(fornecedor) && (!r.departamento || movimentoNoDepartamento(r.departamento, m.grupoSigla, m.filial))) ?? null;
}

/**
 * O valor de um movimento dividido pelos percentuais (0 a 1, somando 1), em centavos (13/11/2026): cada parte arredondada
 * a duas casas e a última com o que falta, para as partes somarem exatamente o valor.
 */
export function partesDoValor(valor: number, percentuais: number[]): number[] {
  const centavos = Math.round(valor * 100);
  let usados = 0;
  return percentuais.map((p, i) => {
    const parte = i === percentuais.length - 1 ? centavos - usados : Math.round(centavos * p);
    usados += parte;
    return parte / 100;
  });
}
