import { unzipSync } from "fflate";

import { ArquivoInvalidoError, lerAba, listarAbas, type ValorCelula } from "../../lib/xlsx.js";
import { coluna, ESTILO, type AbaEscrita, type Celula } from "../../lib/xlsxEscrita.js";
import { juntarOrigem, type OrigensDasContas } from "./consolidadoDosCentros.js";
import { CONTAS_DEPRECIACAO, depreciacaoMensal } from "./investimentosCenario.js";
import { salarioTotal, type MesDaLinha } from "./quadroDoCenario.js";

/**
 * A planilha das premissas de um cenário analítico (15/10/2026): o Exportar Premissas (só Excel) e o Importar Valores.
 * Cada aba da tela vira uma aba da planilha (os centros de custo numa aba só, um por aba ou um arquivo por centro): a
 * coluna Código (a chave da linha, que não se altera), as colunas que descrevem a linha, a unidade, a Média de
 * Referência, o Total da Referência (a média × 12) e a Variação Máxima da conta (do Comparativo) — 15/10/2026 —, os doze
 * meses (em branco: o mês sem valor), Justificar? (uma fórmula: Sim quando o total dos doze meses passa da variação
 * máxima em relação ao Total da Referência) e a Justificativa (texto livre). O Importar Valores lê os meses e a
 * Justificativa das linhas pela coluna Código; as colunas da referência e Justificar? não se importam. A aba
 * Investimentos (15/10/2026) traz a lista dos investimentos, com as listas suspensas da Unidade e da Conta e as fórmulas
 * da Depreciação Mensal; importada, atualiza os investimentos pelo Nome de Referência e inclui os de nome novo. A aba
 * Quadro de Lotação (09/11/2026) traz as linhas da aba de mesmo nome. Desde 11/11/2026 (pedido do Adão), sem as colunas
 * Código e Código da Linha: o Importar Valores acha cada linha pelas colunas que a descrevem (as antes da Und., que não se
 * repetem numa aba; a unidade das abas Matriz, Filial e Serviços pelo título da aba), e a aba Quadro de Lotação substitui as
 * linhas do cenário nos departamentos do arquivo (a linha 4 os diz). Os arquivos de antes, com a coluna Código, continuam
 * valendo (pelo código; o Quadro de Lotação, pelo Código da Linha, sem excluir). Com a referência do cenário, os doze meses dela logo
 * antes da Média de Referência (Realizado: o resultado realizado de cada mês do período; Referência: os meses do outro
 * cenário) e, na aba Quadro de Lotação, depois do Centro de Custo, o QL Realizado da competência mais recente (ou os
 * colaboradores do último mês do outro cenário); nada disso se importa.
 */

export type AbaDasPremissas = "1" | "2" | "3" | "quadro" | "centros" | "investimentos" | "extra" | "manuais";
export const ABAS_DAS_PREMISSAS: AbaDasPremissas[] = ["1", "2", "3", "quadro", "centros", "investimentos", "extra", "manuais"];
export const NOME_DA_ABA: Record<AbaDasPremissas, string> = {
  "1": "Matriz",
  "2": "Filial",
  "3": "Serviços",
  quadro: "Quadro de Lotação",
  centros: "Centros de Custo",
  investimentos: "Depreciação Base",
  extra: "Extra-Operacional",
  manuais: "Indicadores Manuais",
};
/** As colunas que descrevem a linha, em cada aba. */
const COLUNAS: Record<AbaDasPremissas, Array<[string, number]>> = {
  "1": [["Venda", 11], ["Seção", 24], ["Linha", 30], ["Premissa", 44]],
  "2": [["Venda", 11], ["Seção", 24], ["Linha", 30], ["Premissa", 44]],
  "3": [["Venda", 11], ["Seção", 24], ["Linha", 30], ["Premissa", 44]],
  // A aba Quadro de Lotação é uma lista (abaDoQuadroDeLotacao), não tem linhas de premissa.
  quadro: [],
  centros: [["Grupo", 28], ["Atribuição", 26], ["Conta", 40]],
  investimentos: [["Unidade", 18], ["Conta", 44]],
  extra: [["Unidade", 18], ["Seção", 30], ["Conta", 44]],
  manuais: [["Grupo", 22], ["Indicador", 44]],
};

export type LinhaDaPlanilha = {
  aba: AbaDasPremissas;
  /**
   * P|unidade|venda|premissa, C|grupo|conta, L|grupo|CLT, L|grupo|PJ e L|grupo|TOTAL (19/10/2026; antes, L|grupo),
   * E|grupo|item (os Encargos e Benefícios), B|unidade|conta, X|unidade|conta ou I|indicador.
   */
  chave: string;
  descricao: string[];
  und: string;
  /**
   * Nos grupos com linhas no Quadro de Lotação (11/11/2026, pedido do Adão): a soma da aba Quadro de Lotação do arquivo que a
   * linha é, em fórmula — os centros (os códigos), o Tipo e a senioridade das linhas que entram e o que somar (os
   * Colaboradores ou os salários, colaboradores × (Salário Bruto + Insalubridade / Periculosidade)).
   */
  doQuadro?: { centros: string[]; tipo?: "CLT" | "PJ"; senioridade?: "APRENDIZ" | "ESTAGIARIO" | "OUTRAS"; soma: "COLABORADORES" | "SALARIOS" };
  /** A conta da DRE (a variação máxima do Comparativo); nula nas linhas sem conta (volumes, dias úteis, quadros). */
  conta: string | null;
  limite: number | null;
  media: number | null;
  /** Os doze meses gravados; null: em branco. */
  meses: Array<number | null>;
  /** O valor é uma fração (0,25 = 25%): os indicadores em %. */
  percentual?: boolean;
  /** Nos centros de custo, o grupo (para separar os centros em abas ou arquivos). */
  grupo?: string;
  /**
   * A linha é calculada (19/10/2026: o Total de Colaboradores e a conta Encargos e Benefícios): não se importa, não se
   * replica e, na planilha, os meses vão em fórmula (`formula`).
   */
  calculada?: boolean;
  /**
   * A fórmula de um mês da linha, com `ref(chave)`, a célula do mesmo mês de outra linha da aba (`ref(chave, true)`: a
   * Média de Referência dela).
   */
  formula?: (ref: (chave: string, media?: boolean) => string, doQuadroNoMes?: (d: NonNullable<LinhaDaPlanilha["doQuadro"]>) => string) => string;
  justificativa: string | null;
  /** Os doze meses da referência do cenário (11/11/2026: o realizado ou o outro cenário); sem referência, ausente. */
  referencia?: Array<number | null>;
};

/** A aba das premissas de uma chave da planilha (a permissão de editar é a dela). */
export function abaDaChave(chave: string): AbaDasPremissas | null {
  const [tipo, u] = chave.split("|");
  if (tipo === "P") return u === "1" || u === "2" || u === "3" ? u : null;
  return ({ C: "centros", L: "centros", E: "centros", B: "investimentos", X: "extra", I: "manuais" } as const)[tipo as "C"] ?? null;
}

/**
 * Os departamentos do Exportar Premissas (15/10/2026): o arquivo leva só o que é dos marcados. Produção: Matriz, Filial,
 * os centros de custo de produção (CPP) e a depreciação base e os investimentos da Matriz e da Filial; Serviços: a aba
 * Serviços, os centros de serviços (CSM e CSC) e a depreciação e os investimentos de Serviços; Logística, Técnico,
 * Comercial e Administrativo: os centros do departamento (DL, DT, DC e DA); Extra-Operacional: a aba Extra-Operacional.
 * Esses cinco levam também a depreciação base e os investimentos de Despesas e Extra (o patrimônio). Os indicadores
 * manuais vão pelo grupo deles (o GME, que é das vendas, com o Comercial; o Geral, com o Administrativo).
 */
export type Departamento = "PRODUCAO" | "SERVICOS" | "LOGISTICA" | "TECNICO" | "COMERCIAL" | "ADMINISTRATIVO" | "EXTRA";
export const DEPARTAMENTOS: Array<{ chave: Departamento; nome: string }> = [
  { chave: "PRODUCAO", nome: "Produção" },
  { chave: "SERVICOS", nome: "Serviços" },
  { chave: "LOGISTICA", nome: "Logística" },
  { chave: "TECNICO", nome: "Técnico" },
  { chave: "COMERCIAL", nome: "Comercial" },
  { chave: "ADMINISTRATIVO", nome: "Administrativo" },
  { chave: "EXTRA", nome: "Extra-Operacional" },
];
const DO_PATRIMONIO: Departamento[] = ["LOGISTICA", "TECNICO", "COMERCIAL", "ADMINISTRATIVO", "EXTRA"];
const DO_GRUPO_DRE: Record<string, Departamento> = { CPP: "PRODUCAO", CSM: "SERVICOS", CSC: "SERVICOS", DL: "LOGISTICA", DT: "TECNICO", DC: "COMERCIAL", DA: "ADMINISTRATIVO" };
const DO_GRUPO_DO_INDICADOR: Record<string, Departamento> = {
  Produção: "PRODUCAO",
  Serviços: "SERVICOS",
  Logística: "LOGISTICA",
  Técnico: "TECNICO",
  Comercial: "COMERCIAL",
  GME: "COMERCIAL",
  Administrativo: "ADMINISTRATIVO",
  Geral: "ADMINISTRATIVO",
};

/** O departamento de um grupo da DRE (CPP, CSM, DL…): as linhas do Quadro de Lotação, pelo grupo do centro (09/11/2026). */
export const departamentoDoGrupoDRE = (grupoDRE: string | null | undefined): Departamento | null => DO_GRUPO_DRE[grupoDRE ?? ""] ?? null;

/** Os departamentos de uma unidade (a depreciação base e os investimentos dela). */
export const departamentosDaUnidade = (unidade: number): Departamento[] => (unidade === 1 || unidade === 2 ? ["PRODUCAO"] : unidade === 3 ? ["SERVICOS"] : DO_PATRIMONIO);

/** Os departamentos de uma linha da planilha; `grupoDRE` dá o grupo da DRE de cada grupo de centros. */
export function departamentosDaLinha(l: Pick<LinhaDaPlanilha, "chave" | "descricao">, grupoDRE: Map<string, string | null>): Departamento[] {
  const [tipo, a] = l.chave.split("|");
  if (tipo === "P") return departamentosDaUnidade(Number(a));
  if (tipo === "B") return departamentosDaUnidade(Number(a));
  if (tipo === "X") return ["EXTRA"];
  if (tipo === "C" || tipo === "L" || tipo === "E") {
    const d = DO_GRUPO_DRE[grupoDRE.get(a) ?? ""];
    return d ? [d] : [];
  }
  if (tipo === "I") {
    const d = DO_GRUPO_DO_INDICADOR[l.descricao[0] ?? ""];
    return d ? [d] : [];
  }
  return [];
}

/**
 * O trecho de uma linha da planilha (15/10/2026), para conferir as abas repetidas ao importar vários arquivos: a
 * unidade, o centro de custo, a depreciação base da unidade, o extra-operacional ou o grupo dos indicadores manuais.
 */
export function blocoDaChave(chave: string, descricao: string[] = []) {
  const [tipo, a, b] = chave.split("|");
  if (tipo === "P") return NOME_DA_ABA[a as "1"] ?? "Premissas";
  if (tipo === "C" || tipo === "L" || tipo === "E") return `Centro de Custo: ${a}`;
  if (tipo === "B") return `Depreciação Base: ${CONTAS_DEPRECIACAO.find((c) => String(c.unidade) === a)?.nomeUnidade ?? a}`;
  if (tipo === "X") return `Extra-Operacional: ${a === "5" ? "RN" : "Despesas e Extra"}`;
  if (tipo === "I") return `Indicadores Manuais${descricao[0] ? `: ${descricao[0]}` : ""}`;
  return b ?? chave;
}

export const COLUNA_CODIGO = "Código (não altere)";
const COLUNA_MEDIA = "Média de Referência";
const COLUNA_TOTAL_REFERENCIA = "Total da Referência";
const COLUNA_VARIACAO = "Variação Máxima (%)";
const COLUNA_JUSTIFICAR = "Justificar?";
const COLUNA_JUSTIFICATIVA = "Justificativa";

/**
 * Justificar? (15/10/2026; antes, mês a mês): Sim quando o total dos doze meses (os em branco valem zero) passa da
 * variação máxima da conta em relação ao Total da Referência (a Média de Referência × 12); com o Total da Referência
 * zero, Sim quando o total não é zero. Sem média, sem variação máxima ou sem conta, Não. A planilha leva a mesma conta
 * em fórmula; esta dá o valor que o arquivo mostra antes de o Excel recalcular.
 */
export function precisaJustificar(l: Pick<LinhaDaPlanilha, "limite" | "media" | "meses">) {
  if (l.limite === null || l.media === null) return false;
  const total = l.meses.reduce<number>((s, v) => s + (v ?? 0), 0);
  const referencia = l.media * 12;
  if (Math.abs(referencia) < 0.005) return Math.abs(total) >= 0.005;
  return Math.round((Math.abs(total - referencia) / Math.abs(referencia)) * 10000) / 100 > l.limite;
}

/** Os meses da referência nas abas (11/11/2026): o prefixo das colunas, os rótulos dos meses e a referência, para a explicação. */
export type ReferenciaDasAbas = { rotulo: string; meses: string[]; descricao: string };
/** As colunas dos meses da referência: doze, com ela; nenhuma, sem. */
const colunasDaReferencia = (r: ReferenciaDasAbas | undefined) => (r ? 12 : 0);

/** A aba Quadro de Lotação no arquivo (11/11/2026): o nome, as linhas (da primeira à última, com as em branco) e as colunas de cada mês. */
export type QuadroDoArquivo = { aba: string; primeira: number; ultima: number; doMes: (k: number, campo: 0 | 1 | 2) => string };
/** A aba Quadro de Lotação de um arquivo com `linhas` linhas do cenário (as em branco depois delas) e, com a referência, a coluna dela. */
export function quadroDoArquivo(linhas: number, comReferencia: boolean): QuadroDoArquivo {
  const R = comReferencia ? 1 : 0;
  return { aba: NOME_DA_ABA.quadro, primeira: PRIMEIRA_LINHA, ultima: PRIMEIRA_LINHA + linhas + LINHAS_NOVAS - 1, doMes: (k, campo) => coluna(CAMPOS_DO_QUADRO.length + R + k * 4 + campo) };
}

/**
 * A fórmula de um mês (k) de uma linha calculada pela aba Quadro de Lotação (11/11/2026): a soma das linhas da aba dos centros
 * dela (o Centro de Custo é o código ou "código - nome", como o Exportar escreve), do Tipo e da senioridade (Aprendiz;
 * Estagiário; ou as outras), dos Colaboradores ou dos salários (colaboradores × (Salário Bruto + Insalubridade /
 * Periculosidade)), como o SIG calcula.
 */
export function formulaDoQuadro(d: NonNullable<LinhaDaPlanilha["doQuadro"]>, q: QuadroDoArquivo, k: number): string {
  const aba = `'${q.aba.replace(/'/g, "''")}'`;
  // As linhas fixas ($): a fórmula copiada para outra célula continua na mesma faixa da aba.
  const faixa = (c: string) => `${aba}!${c}$${q.primeira}:${c}$${q.ultima}`;
  const texto = (x: string) => `"${x.replace(/"/g, '""')}"`;
  // As colunas da aba (a partir de A): Unidade, Tipo, Senioridade, Função e Centro de Custo.
  const [tipo, senioridade, centro] = [faixa(coluna(1)), faixa(coluna(2)), faixa(coluna(4))];
  const centros = d.centros.length
    ? `((${d.centros.map((c) => `(${centro}=${texto(c)})+(LEFT(${centro},${c.length + 3})=${texto(`${c} - `)})`).join("+")})>0)`
    : "0";
  const aprendiz = `(${senioridade}="Aprendiz")`;
  const estagiario = `((${senioridade}="Estagiário")+(${senioridade}="Estagiario"))`;
  const filtros = [
    centros,
    ...(d.tipo ? [`(${tipo}="${d.tipo}")`] : []),
    ...(d.senioridade === "APRENDIZ" ? [aprendiz] : d.senioridade === "ESTAGIARIO" ? [estagiario] : d.senioridade === "OUTRAS" ? [`(1-${aprendiz})`, `(1-${estagiario})`] : []),
  ];
  const doMes = (campo: 0 | 1 | 2) => faixa(q.doMes(k, campo));
  const valor = d.soma === "COLABORADORES" ? doMes(0) : `${doMes(0)}*(${doMes(1)}+${doMes(2)})`;
  return `SUMPRODUCT(${filtros.join("*")}*${valor})`;
}

/**
 * Uma aba da planilha: o título, a explicação, os rótulos e as linhas. Com `referencia` (11/11/2026, pedido do Adão), os doze
 * meses da referência do cenário (o realizado ou o outro cenário) logo antes da Média de Referência; não se importam. Com
 * `quadro` (11/11/2026: a aba Quadro de Lotação no mesmo arquivo), as linhas calculadas por ela (`doQuadro`) vão em fórmula.
 */
export function abaDaPlanilha(
  nome: string,
  aba: AbaDasPremissas,
  linhas: LinhaDaPlanilha[],
  meses: string[],
  identificacao: string,
  referencia?: ReferenciaDasAbas,
  quadro?: QuadroDoArquivo,
): AbaEscrita {
  // Os rótulos (a linha 5) com a quebra de texto automática (11/11/2026, pedido do Adão), como em todas as abas da planilha.
  const cab = (valor: string): Celula => ({ valor, estilo: ESTILO.cabecalhoQuebra });
  const cabDireita = (valor: string): Celula => ({ valor, estilo: ESTILO.cabecalhoDireitaQuebra });
  const numero = (l: LinhaDaPlanilha, v: number | null): Celula => ({ valor: v, estilo: l.percentual ? ESTILO.itemPercentual : ESTILO.itemNumero });
  // As colunas (a partir de 0): as descrições (11/11/2026: sem o Código antes delas), a Und., os meses da referência (com
  // ela), a Média, o Total da Referência, a Variação Máxima, os doze meses, Justificar? e a Justificativa.
  const n = COLUNAS[aba].length;
  const R = colunasDaReferencia(referencia);
  const [cMedia, cTotal, cVariacao, cJan, cDez] = [n + 1 + R, n + 2 + R, n + 3 + R, n + 4 + R, n + 15 + R].map(coluna);
  // As linhas calculadas (19/10/2026): a fórmula de cada mês aponta para as linhas da mesma aba pela chave.
  const linhaDa = new Map(linhas.map((l, i) => [l.chave, PRIMEIRA_LINHA + i]));
  const mesEmFormula = (l: LinhaDaPlanilha, k: number): string | undefined => {
    // Pela aba Quadro de Lotação do arquivo (11/11/2026); sem ela no arquivo, o valor.
    if (l.doQuadro) return quadro ? formulaDoQuadro(l.doQuadro, quadro, k) : undefined;
    if (!l.formula) return undefined;
    let falta = false;
    const ref = (chave: string, media = false) => {
      const r = linhaDa.get(chave);
      if (r === undefined) falta = true;
      return `${media ? cMedia : coluna(n + 4 + R + k)}${r ?? 0}`;
    };
    // A soma da aba Quadro de Lotação do arquivo no mês (11/11/2026), quando ela está no arquivo.
    const f = l.formula(ref, quadro ? (d) => formulaDoQuadro(d, quadro, k) : undefined);
    return falta ? undefined : f;
  };
  return {
    nome,
    larguras: [...COLUNAS[aba].map(([, w]) => w), 10, ...Array.from({ length: R }, () => 13), 14, 14, 12, ...meses.map(() => 13), 12, 60],
    linhas: [
      [{ valor: `Premissas · ${nome}`, estilo: ESTILO.titulo }],
      [{ valor: identificacao, estilo: ESTILO.informacao }],
      [
        {
          valor:
            "Preencha os meses e a Justificativa e importe o arquivo em Premissas / Importar Valores. Em branco, o mês fica sem valor. As colunas antes da Und. identificam a linha: não as altere (nem o nome desta aba). Justificar? é Sim quando o total dos doze meses passa da Variação Máxima em relação ao Total da Referência (a Média de Referência × 12). A Média, o Total da Referência, a Variação Máxima e Justificar? não se importam." +
            (referencia ? ` As colunas ${referencia.rotulo}, antes da Média, são os meses da referência do cenário (${referencia.descricao}) e também não se importam.` : ""),
          estilo: ESTILO.informacao,
        },
      ],
      [],
      [
        ...COLUNAS[aba].map(([c]) => cab(c)),
        cab("Und."),
        ...(referencia ? referencia.meses.map((m) => cabDireita(`${referencia.rotulo} · ${m}`)) : []),
        cabDireita(COLUNA_MEDIA),
        cabDireita(COLUNA_TOTAL_REFERENCIA),
        cabDireita(COLUNA_VARIACAO),
        ...meses.map(cabDireita),
        cab(COLUNA_JUSTIFICAR),
        cab(COLUNA_JUSTIFICATIVA),
      ],
      ...linhas.map((l, i): Celula[] => {
        const r = PRIMEIRA_LINHA + i;
        const soma = `SUM(${cJan}${r}:${cDez}${r})`;
        const [m, t, v] = [`${cMedia}${r}`, `${cTotal}${r}`, `${cVariacao}${r}`];
        return [
          ...l.descricao.map((d) => ({ valor: d })),
          { valor: l.und },
          ...Array.from({ length: R }, (_, k) => numero(l, l.referencia?.[k] ?? null)),
          numero(l, l.media),
          { ...numero(l, l.media === null ? null : l.media * 12), formula: `IF(${m}="","",${m}*12)` },
          { valor: l.limite, estilo: ESTILO.itemNumero },
          ...l.meses.map((x, k) => ({ ...numero(l, x), formula: mesEmFormula(l, k) })),
          {
            valor: precisaJustificar(l) ? "Sim" : "Não",
            formula: `IF(OR(${m}="",${v}=""),"Não",IF(ABS(${t})<0.005,IF(ABS(${soma})<0.005,"Não","Sim"),IF(ROUND(ABS(${soma}-${t})/ABS(${t})*100,2)>${v},"Sim","Não")))`,
          },
          { valor: l.justificativa },
        ];
      }),
    ],
    linhaCabecalho: 5,
    rodape: `Premissas · ${nome}`,
    paisagem: true,
    // As descrições e a Und. presas ao rolar para os lados (11/11/2026, pedido do Adão), antes da referência e das médias.
    congelarColunas: n + 1,
  };
}

/** A linha da primeira linha de valores nas abas da planilha (abaDaPlanilha: o título, a identificação, a explicação, uma em branco e os rótulos). */
const PRIMEIRA_LINHA = 6;

/**
 * As contas de uma aba de centros da planilha (15/10/2026), para o Consolidado: as linhas das contas (C|grupo|conta) e as
 * colunas da Média de Referência e dos doze meses. `aba` é o nome final da aba no arquivo.
 */
export function origensDaAba(origens: OrigensDasContas, aba: string, linhas: LinhaDaPlanilha[], referencia?: ReferenciaDasAbas) {
  // Os meses da referência (11/11/2026: com ela, as doze colunas logo depois da Und.), a Média de Referência e os meses
  // (depois do Total da Referência e da Variação Máxima).
  const R = colunasDaReferencia(referencia);
  // As descrições (11/11/2026: sem o Código antes delas) e a Und.
  const iReferencia = COLUNAS.centros.length + 1;
  const iMedia = iReferencia + R;
  const colunas = [...Array.from({ length: R }, (_, k) => coluna(iReferencia + k)), coluna(iMedia), ...Array.from({ length: 12 }, (_, k) => coluna(iMedia + 3 + k))];
  linhas.forEach((l, i) => {
    const daReferencia = Array.from({ length: R }, (_, k) => l.referencia?.[k] ?? null);
    if (l.chave.startsWith("C|") && l.conta) juntarOrigem(origens, l.conta, { aba, linha: PRIMEIRA_LINHA + i, colunas, valores: [...daReferencia, l.media, ...l.meses] });
  });
}

/** O nome da aba Consolidado: o Importar Valores a ignora sem aviso. */
export const ABA_CONSOLIDADO = "Consolidado";

/**
 * Uma linha lida de um arquivo: a chave (nos arquivos com a coluna Código, de antes de 11/11/2026) ou a aba e as descrições
 * que a identificam (`doTipo` e `descricao`; a chave sai delas no serviço, chaveDaDescricao), os doze meses (null: em branco)
 * e a justificativa.
 */
export type LinhaLida = {
  aba: string;
  numero: number;
  chave: string | null;
  doTipo: AbaDasPremissas | null;
  descricao: string[];
  meses: Array<number | null>;
  justificativa: string | null;
};
/** A chave de uma linha pela aba e pelas descrições (11/11/2026): sem diferença de espaços. */
export const chaveDaDescricao = (aba: AbaDasPremissas, descricao: string[]) => `${aba}|${descricao.map((d) => String(d ?? "").replace(/\s+/g, " ").trim()).join(" › ")}`;
/** Um investimento lido da aba Investimentos: o Nome de Referência (o do investimento a atualizar, ou o de um novo) e os campos, já validados. */
export type InvestimentoLido = {
  aba: string;
  numero: number;
  nomeReferencia: string;
  unidade: number;
  descricao: string;
  condicaoPagamento: string | null;
  inicio: number;
  valorTotal: number;
  valorPosUso: number;
  vidaUtil: number;
};
/** Os campos de uma linha do Quadro de Lotação lida (09/11/2026): os textos dos cadastros, como no Lançamento Inicial. */
export type CamposDoQuadro = { unidade: string; tipo: string; senioridade: string; funcao: string; centro: string };
/** Uma linha lida da aba Quadro de Lotação: o Código da Linha (nos arquivos de antes de 11/11/2026; null: nova), os campos e os doze meses. */
export type LinhaDoQuadroLida = { aba: string; numero: number; id: string | null; campos: CamposDoQuadro; meses: MesDaLinha[] };
export type ArquivoLido = {
  arquivo: string;
  linhas: LinhaLida[];
  investimentos: InvestimentoLido[];
  quadro: LinhaDoQuadroLida[];
  /**
   * A aba Quadro de Lotação sem o Código da Linha (11/11/2026): os departamentos do arquivo, cujas linhas do cenário ela
   * substitui; null sem a aba ou no arquivo de antes (com o código).
   */
  substituiQuadro: Departamento[] | null;
  abas: string[];
  erros: string[];
  avisos: string[];
};

/** O número de uma célula: o do Excel ou um texto no formato brasileiro ("1.234,5", "25%"); vazio, null; inválido, undefined. */
function numeroDa(v: ValorCelula): number | null | undefined {
  if (v === null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "boolean") return undefined;
  const t = v.trim();
  if (!t) return null;
  const pct = t.endsWith("%");
  const n = Number(t.replace(/%$/, "").replace(/R\$|\s/g, "").replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n)) return undefined;
  return pct ? n / 100 : n;
}

/** O nome da aba da lista dos investimentos (15/10/2026). */
export const ABA_INVESTIMENTOS = "Investimentos";
/** As colunas da aba Investimentos (a partir de A). */
/** A primeira coluna da aba Investimentos (15/10/2026; antes, o Código). */
const COLUNA_NOME_REFERENCIA = "Nome de Referência";
/** A Condição de Pagamento (19/10/2026, no lugar do Ganho Previsto, da Receita Bruta Prevista e do ROI): opcional na leitura. */
const COLUNA_CONDICAO = "Condição de Pagamento";
const COLUNAS_INVESTIMENTOS: Array<[string, number]> = [
  [COLUNA_NOME_REFERENCIA, 30],
  ["Unidade", 18],
  ["Conta", 36],
  ["Descrição", 40],
  [COLUNA_CONDICAO, 30],
  ["Mês de Início (1 a 12)", 12],
  ["Valor Total", 16],
  ["Valor Pós Uso", 16],
  ["Vida Útil (meses)", 12],
  ["Depreciação Mensal", 16],
];
/** As colunas dos campos (sem a Depreciação Mensal, uma fórmula). */
const CAMPOS_INVESTIMENTOS = COLUNAS_INVESTIMENTOS.slice(0, 9).map(([c]) => c);
/** As linhas em branco, com as fórmulas e as listas, para incluir investimentos novos na planilha. */
const LINHAS_NOVAS = 30;

export type InvestimentoDaPlanilha = Omit<InvestimentoLido, "aba" | "numero"> & { id: string };

/**
 * A aba Investimentos (15/10/2026): os investimentos das unidades escolhidas, com o Nome de Referência (que identifica o
 * investimento na importação), a Unidade e a Conta em listas suspensas, os campos do investimento (com a Condição de
 * Pagamento, 19/10/2026) e, em fórmula, a Depreciação Mensal ((valor total − valor pós uso) ÷ vida útil). Abaixo, linhas em
 * branco para os investimentos novos.
 */
export function abaDeInvestimentos(investimentos: InvestimentoDaPlanilha[], identificacao: string): AbaEscrita {
  // Os rótulos com a quebra de texto automática (11/11/2026).
  const cab = (valor: string, direita = false): Celula => ({ valor, estilo: direita ? ESTILO.cabecalhoDireitaQuebra : ESTILO.cabecalhoQuebra });
  const nomeDaUnidade = (u: number) => CONTAS_DEPRECIACAO.find((c) => c.unidade === u)?.nomeUnidade ?? "";
  const rotuloDaConta = (u: number) => CONTAS_DEPRECIACAO.find((c) => c.unidade === u)?.rotulo ?? "";
  const formulas = (r: number) => ({
    depreciacao: `IF(OR(G${r}="",I${r}="",I${r}=0),"",(G${r}-IF(H${r}="",0,H${r}))/I${r})`,
  });
  const linhas: Celula[][] = [
    [{ valor: `Premissas · ${ABA_INVESTIMENTOS}`, estilo: ESTILO.titulo }],
    [{ valor: identificacao, estilo: ESTILO.informacao }],
    [
      {
        valor:
          "Altere os investimentos ou inclua novos nas linhas em branco e importe o arquivo em Premissas / Importar Valores: com o Nome de Referência de um investimento do cenário, ele é atualizado; com um nome novo, é incluído (o nome não se repete no cenário). A Depreciação Mensal é uma fórmula e não se importa.",
        estilo: ESTILO.informacao,
      },
    ],
    [],
    COLUNAS_INVESTIMENTOS.map(([c], k) => cab(c, k >= 5)),
  ];
  investimentos.forEach((i, k) => {
    const r = PRIMEIRA_LINHA + k;
    const f = formulas(r);
    linhas.push([
      { valor: i.nomeReferencia },
      { valor: nomeDaUnidade(i.unidade) },
      { valor: rotuloDaConta(i.unidade) },
      { valor: i.descricao },
      { valor: i.condicaoPagamento },
      { valor: i.inicio },
      { valor: i.valorTotal, estilo: ESTILO.itemNumero },
      { valor: i.valorPosUso, estilo: ESTILO.itemNumero },
      { valor: i.vidaUtil },
      { valor: Math.round(depreciacaoMensal(i) * 100) / 100, estilo: ESTILO.itemNumero, formula: f.depreciacao },
    ]);
  });
  for (let k = 0; k < LINHAS_NOVAS; k++) {
    const r = PRIMEIRA_LINHA + investimentos.length + k;
    const f = formulas(r);
    linhas.push([
      ...Array.from({ length: 9 }, (): Celula => ({ valor: null })),
      { valor: null, estilo: ESTILO.itemNumero, formula: f.depreciacao },
    ]);
  }
  const ultima = PRIMEIRA_LINHA + investimentos.length + LINHAS_NOVAS - 1;
  const intervalo = (c: string) => `${c}${PRIMEIRA_LINHA}:${c}${ultima}`;
  return {
    nome: ABA_INVESTIMENTOS,
    larguras: COLUNAS_INVESTIMENTOS.map(([, w]) => w),
    linhas,
    linhaCabecalho: 5,
    rodape: `Premissas · ${ABA_INVESTIMENTOS}`,
    paisagem: true,
    // O Nome de Referência, a Unidade, a Conta e a Descrição presos ao rolar para os lados (11/11/2026, pedido do Adão).
    congelarColunas: 4,
    validacoes: [
      { celulas: intervalo("B"), lista: CONTAS_DEPRECIACAO.map((c) => c.nomeUnidade) },
      { celulas: intervalo("C"), lista: [...new Set(CONTAS_DEPRECIACAO.map((c) => c.rotulo))] },
      { celulas: intervalo("F"), inteiro: [1, 12] },
      { celulas: intervalo("I"), inteiro: [1, 600] },
    ],
  };
}

/** Lê a aba Investimentos: as linhas com algum campo (a Depreciação Mensal, fórmula, não conta). A Condição de Pagamento é opcional (os arquivos de antes de 19/10/2026 não a têm). */
function lerInvestimentos(nome: string, linhas: Array<{ numero: number; celulas: ValorCelula[] }>, i: number, r: ArquivoLido) {
  const rotulos = linhas[i].celulas.map((c) => String(c ?? "").trim());
  const col = (rotulo: string) => rotulos.indexOf(rotulo);
  const iCampos = CAMPOS_INVESTIMENTOS.map((c) => col(c));
  const obrigatorias = CAMPOS_INVESTIMENTOS.filter((c) => c !== COLUNA_CONDICAO);
  if (obrigatorias.some((c) => col(c) < 0)) {
    r.erros.push(`A aba ${nome} não tem as colunas do padrão (${obrigatorias.map((c) => `“${c}”`).join(", ")}).`);
    return;
  }
  const [iNome, iUnidade, iConta, iDescricao, iCondicao, iInicio, iTotal, iPosUso, iVida] = iCampos;
  const texto = (v: ValorCelula | undefined) => (v === null || v === undefined ? "" : String(v).trim());
  const nomes = new Set<string>();
  r.abas.push(nome);
  for (const l of linhas.slice(i + 1)) {
    const c = l.celulas;
    if (iCampos.every((k) => k < 0 || texto(c[k]) === "")) continue;
    const erro = (m: string) => r.erros.push(`${nome}, linha ${l.numero}: ${m}`);
    const nomeReferencia = texto(c[iNome]).slice(0, 80);
    if (!nomeReferencia) {
      erro("dê um Nome de Referência ao investimento.");
      continue;
    }
    if (nomes.has(nomeReferencia.toLocaleLowerCase("pt-BR"))) {
      erro(`o Nome de Referência “${nomeReferencia}” se repete na aba.`);
      continue;
    }
    nomes.add(nomeReferencia.toLocaleLowerCase("pt-BR"));
    const unidade = CONTAS_DEPRECIACAO.find((x) => x.nomeUnidade.toLocaleLowerCase("pt-BR") === texto(c[iUnidade]).toLocaleLowerCase("pt-BR"));
    if (!unidade) {
      erro(`a Unidade “${texto(c[iUnidade])}” não é uma das da lista (${CONTAS_DEPRECIACAO.map((x) => x.nomeUnidade).join(", ")}).`);
      continue;
    }
    const conta = texto(c[iConta]);
    if (conta && conta.toLocaleLowerCase("pt-BR") !== unidade.rotulo.toLocaleLowerCase("pt-BR")) {
      erro(`a Conta de ${unidade.nomeUnidade} é a ${unidade.rotulo} (está “${conta}”).`);
      continue;
    }
    const descricao = texto(c[iDescricao]).slice(0, 200);
    if (!descricao) {
      erro("descreva o investimento.");
      continue;
    }
    const num = (k: number, rotulo: string) => {
      const v = numeroDa(c[k] ?? null);
      if (v === undefined) erro(`${rotulo}: “${texto(c[k])}” não é um número.`);
      return v;
    };
    const inicio = num(iInicio, "Mês de Início");
    const total = num(iTotal, "Valor Total");
    const posUso = num(iPosUso, "Valor Pós Uso");
    const vida = num(iVida, "Vida Útil");
    if ([inicio, total, posUso, vida].includes(undefined)) continue;
    if (inicio === null || inicio === undefined || !Number.isInteger(inicio) || inicio < 1 || inicio > 12) {
      erro("o Mês de Início vai de 1 a 12.");
      continue;
    }
    if (total === null || total! <= 0) {
      erro("o Valor Total precisa ser maior que zero.");
      continue;
    }
    if (vida === null || !Number.isInteger(vida) || vida! < 1 || vida! > 600) {
      erro("a Vida Útil é um número inteiro de meses, de 1 a 600.");
      continue;
    }
    if ((posUso ?? 0) < 0 || (posUso ?? 0) > total!) {
      erro("o Valor Pós Uso vai de zero ao Valor Total.");
      continue;
    }
    r.investimentos.push({
      aba: nome,
      numero: l.numero,
      nomeReferencia,
      unidade: unidade.unidade,
      descricao,
      condicaoPagamento: iCondicao < 0 ? null : texto(c[iCondicao]).slice(0, 500) || null,
      inicio: inicio!,
      valorTotal: total!,
      valorPosUso: posUso ?? 0,
      vidaUtil: vida!,
    });
  }
}

/** A primeira coluna da aba Quadro de Lotação nos arquivos de antes de 11/11/2026: o id da linha; em branco, uma linha nova. */
const COLUNA_CODIGO_DA_LINHA = "Código da Linha (não altere)";
/** A linha 4 da aba Quadro de Lotação (11/11/2026): os departamentos do arquivo, cujas linhas do cenário a aba substitui. */
const DEPARTAMENTOS_DO_ARQUIVO = "Departamentos do arquivo:";
const CAMPOS_DO_QUADRO: Array<[keyof CamposDoQuadro, string, number]> = [
  ["unidade", "Unidade", 16],
  ["tipo", "Tipo", 8],
  ["senioridade", "Senioridade", 14],
  ["funcao", "Função", 30],
  ["centro", "Centro de Custo", 40],
];
/** As quatro colunas de cada mês (o mês antes: "JAN/26 · Colaboradores"); o Salário Total é uma fórmula. */
const DO_MES = ["Colaboradores", "Salário Bruto (R$)", "Insalubridade / Periculosidade (R$)", "Salário Total (R$)"] as const;
const COLUNA_CUSTO_ANUAL = "Custo no Ano (R$)";
/** Uma linha do Quadro de Lotação do cenário para a planilha: o id e os nomes dos cadastros. */
export type LinhaDoQuadroDaPlanilha = {
  id: string;
  unidade: string;
  tipo: string;
  senioridade: string;
  funcao: string;
  centro: string;
  meses: MesDaLinha[];
  /** A coluna da referência (11/11/2026): o QL Realizado ou os colaboradores do último mês do cenário de origem. */
  referencia?: number | null;
};

/**
 * A aba Quadro de Lotação (09/11/2026, etapa 4 da Gestão de Colaboradores): as linhas da aba do cenário, com a Unidade, o
 * Tipo, a Senioridade, a Função e o Centro de Custo (pelo código, como no Lançamento Inicial) e, em cada mês, os
 * Colaboradores, o Salário Bruto e a Insalubridade / Periculosidade de cada um e o Salário Total (a soma, em fórmula); no
 * fim, o Custo no Ano (colaboradores × Salário Total nos doze meses, em fórmula). Abaixo, linhas em branco para as linhas
 * novas. Sem o Código da Linha (11/11/2026, pedido do Adão): na importação, as linhas da aba substituem as do cenário nos
 * departamentos do arquivo (a linha 4, `departamentos`; sem eles, todos).
 */
export function abaDoQuadroDeLotacao(
  linhas: LinhaDoQuadroDaPlanilha[],
  meses: string[],
  identificacao: string,
  listas: { unidades: string[]; senioridades: string[] },
  /** A coluna da referência (11/11/2026), depois do Centro de Custo: o rótulo e a explicação. */
  referencia?: { rotulo: string; explicacao: string },
  /** Os departamentos do arquivo (11/11/2026; os nomes): as linhas do cenário que a aba substitui na importação. */
  departamentos: string[] = DEPARTAMENTOS.map((d) => d.nome),
): AbaEscrita {
  // Os rótulos com a quebra de texto automática (11/11/2026).
  const cab = (valor: string): Celula => ({ valor, estilo: ESTILO.cabecalhoQuebra });
  const n = CAMPOS_DO_QUADRO.length;
  // A coluna de um campo do mês k (0 a 11): f = 0 Colaboradores, 1 Salário Bruto, 2 Insalubridade, 3 Salário Total.
  const R = referencia ? 1 : 0;
  // 11/11/2026: sem o Código da Linha antes dos campos.
  const col = (k: number, f: number) => coluna(n + R + k * 4 + f);
  const cCusto = coluna(n + R + 48);
  const formulas = (r: number) => ({
    total: (k: number) => `IF(AND(${col(k, 1)}${r}="",${col(k, 2)}${r}=""),"",N(${col(k, 1)}${r})+N(${col(k, 2)}${r}))`,
    custo: Array.from({ length: 12 }, (_, k) => `N(${col(k, 0)}${r})*(N(${col(k, 1)}${r})+N(${col(k, 2)}${r}))`).join("+"),
  });
  const vazio = (v: number) => (v ? v : null);
  const linhasDaAba: Celula[][] = [
    [{ valor: `Premissas · ${NOME_DA_ABA.quadro}`, estilo: ESTILO.titulo }],
    [{ valor: identificacao, estilo: ESTILO.informacao }],
    [
      {
        valor:
          "Altere as linhas, apague as que saem ou inclua novas nas linhas em branco e importe o arquivo em Premissas / Importar Valores: as linhas desta aba substituem as do Quadro de Lotação do cenário nos departamentos do arquivo (a linha 4; não a altere) — as que não estão aqui saem. A Unidade, o Tipo (CLT ou PJ), a Senioridade, a Função e o Centro de Custo (o código) são os dos cadastros, como no Lançamento Inicial. Em cada mês, os Colaboradores e o Salário Bruto e a Insalubridade / Periculosidade de cada um; o Salário Total e o Custo no Ano são fórmulas e não se importam. Nos centros de custo deste arquivo, as Remunerações CLT e PJ de todos os grupos e, nos grupos com linhas aqui, os colaboradores e os Salários dos Aprendizes e dos Estagiários são fórmulas sobre esta aba (o Centro de Custo pelo código ou “código - nome”): incluir ou mudar as linhas muda os centros e os Encargos." +
          (referencia ? ` A coluna ${referencia.rotulo}, depois do Centro de Custo, ${referencia.explicacao} e não se importa.` : ""),
        estilo: ESTILO.informacao,
      },
    ],
    [{ valor: `${DEPARTAMENTOS_DO_ARQUIVO} ${departamentos.join(", ")}`, estilo: ESTILO.informacao }],
    // Os rótulos dos meses e o Custo no Ano com a quebra de texto automática (11/11/2026, pedido do Adão).
    [
      ...CAMPOS_DO_QUADRO.map(([, c]) => cab(c)),
      ...(referencia ? [{ valor: referencia.rotulo, estilo: ESTILO.cabecalhoDireitaQuebra }] : []),
      ...meses.flatMap((m) => DO_MES.map((d): Celula => ({ valor: `${m} · ${d}`, estilo: ESTILO.cabecalhoDireitaQuebra }))),
      { valor: COLUNA_CUSTO_ANUAL, estilo: ESTILO.cabecalhoDireitaQuebra },
    ],
  ];
  linhas.forEach((l, i) => {
    const r = PRIMEIRA_LINHA + i;
    const f = formulas(r);
    linhasDaAba.push([
      { valor: l.unidade },
      { valor: l.tipo },
      { valor: l.senioridade },
      { valor: l.funcao },
      { valor: l.centro },
      ...(referencia ? [{ valor: l.referencia ?? null, estilo: ESTILO.itemNumero }] : []),
      ...l.meses.flatMap((m, k): Celula[] => [
        { valor: vazio(m.colaboradores), estilo: ESTILO.itemNumero },
        { valor: vazio(m.salarioBruto), estilo: ESTILO.itemNumero },
        { valor: vazio(m.adicional), estilo: ESTILO.itemNumero },
        { valor: vazio(salarioTotal(m)), estilo: ESTILO.itemNumero, formula: f.total(k) },
      ]),
      { valor: Math.round(l.meses.reduce((s, m) => s + m.colaboradores * salarioTotal(m), 0) * 100) / 100, estilo: ESTILO.itemNumero, formula: f.custo },
    ]);
  });
  for (let k = 0; k < LINHAS_NOVAS; k++) {
    const r = PRIMEIRA_LINHA + linhas.length + k;
    const f = formulas(r);
    linhasDaAba.push([
      ...Array.from({ length: n + R }, (): Celula => ({ valor: null })),
      ...Array.from({ length: 12 }, (_, m): Celula[] => [
        { valor: null, estilo: ESTILO.itemNumero },
        { valor: null, estilo: ESTILO.itemNumero },
        { valor: null, estilo: ESTILO.itemNumero },
        { valor: null, estilo: ESTILO.itemNumero, formula: f.total(m) },
      ]).flat(),
      { valor: null, estilo: ESTILO.itemNumero, formula: f.custo },
    ]);
  }
  const ultima = PRIMEIRA_LINHA + linhas.length + LINHAS_NOVAS - 1;
  const intervalo = (c: string) => `${c}${PRIMEIRA_LINHA}:${c}${ultima}`;
  // As listas suspensas que cabem no limite do Excel (255 caracteres): o Tipo, a Unidade e a Senioridade.
  const cabe = (xs: string[]) => xs.length > 0 && xs.join(",").length <= 250 && !xs.some((x) => x.includes(","));
  return {
    nome: NOME_DA_ABA.quadro,
    larguras: [...CAMPOS_DO_QUADRO.map(([, , w]) => w), ...(referencia ? [15] : []), ...meses.flatMap(() => [13, 15, 17, 15]), 17],
    linhas: linhasDaAba,
    linhaCabecalho: 5,
    rodape: `Premissas · ${NOME_DA_ABA.quadro}`,
    paisagem: true,
    // Os cadastros presos ao rolar para os lados (11/11/2026, pedido do Adão), antes da referência e dos meses.
    congelarColunas: n,
    validacoes: [
      { celulas: intervalo(coluna(1)), lista: ["CLT", "PJ"] },
      ...(cabe(listas.unidades) ? [{ celulas: intervalo(coluna(0)), lista: listas.unidades }] : []),
      ...(cabe(listas.senioridades) ? [{ celulas: intervalo(coluna(2)), lista: listas.senioridades }] : []),
    ],
  };
}

/**
 * Lê a aba Quadro de Lotação (09/11/2026): as linhas com algum campo ou valor (o Salário Total e o Custo no Ano, fórmulas,
 * não contam). Sem o Código da Linha (11/11/2026), também os departamentos do arquivo (a linha antes dos rótulos).
 */
function lerQuadroDeLotacao(nome: string, linhas: Array<{ numero: number; celulas: ValorCelula[] }>, i: number, r: ArquivoLido) {
  const rotulos = linhas[i].celulas.map((c) => String(c ?? "").trim());
  const comCodigo = rotulos[0] === COLUNA_CODIGO_DA_LINHA;
  if (!comCodigo) {
    const linha = linhas.slice(0, i).map((l) => String(l.celulas[0] ?? "").trim()).find((t) => t.startsWith(DEPARTAMENTOS_DO_ARQUIVO));
    const nomes = (linha ?? "").slice(DEPARTAMENTOS_DO_ARQUIVO.length).split(",").map((x) => x.trim()).filter(Boolean);
    const departamentos = nomes.map((x) => DEPARTAMENTOS.find((d) => chaveSemAcento(d.nome) === chaveSemAcento(x))?.chave);
    if (!linha || !nomes.length || departamentos.some((d) => !d)) {
      r.erros.push(`A aba ${nome} não tem a linha dos departamentos do arquivo (“${DEPARTAMENTOS_DO_ARQUIVO} …”, antes dos rótulos), ou ela foi alterada: exporte as premissas de novo.`);
      return;
    }
    r.substituiQuadro = departamentos as Departamento[];
  }
  const iCampos = CAMPOS_DO_QUADRO.map(([, c]) => rotulos.indexOf(c));
  // As colunas de cada campo do mês, na ordem dos meses.
  const doMes = (d: string) => rotulos.flatMap((x, k) => (x.endsWith(` · ${d}`) ? [k] : []));
  const [iColaboradores, iBruto, iAdicional] = [doMes(DO_MES[0]), doMes(DO_MES[1]), doMes(DO_MES[2])];
  if (iCampos.some((k) => k < 0) || [iColaboradores, iBruto, iAdicional].some((x) => x.length !== 12)) {
    r.erros.push(`A aba ${nome} não tem as colunas do padrão (${CAMPOS_DO_QUADRO.map(([, c]) => `“${c}”`).join(", ")} e, em cada um dos doze meses, ${DO_MES.slice(0, 3).map((d) => `“${d}”`).join(", ")}).`);
    return;
  }
  const texto = (v: ValorCelula | undefined) => (v === null || v === undefined ? "" : String(v).trim());
  const ids = new Set<string>();
  r.abas.push(nome);
  for (const l of linhas.slice(i + 1)) {
    const c = l.celulas;
    const doMesLido = [...iColaboradores, ...iBruto, ...iAdicional];
    if ((!comCodigo || texto(c[0]) === "") && iCampos.every((k) => texto(c[k]) === "") && doMesLido.every((k) => texto(c[k]) === "")) continue;
    const erro = (m: string) => r.erros.push(`${nome}, linha ${l.numero}: ${m}`);
    const id = comCodigo ? texto(c[0]) || null : null;
    if (id && ids.has(id)) {
      erro(`o Código da Linha ${id} se repete na aba.`);
      continue;
    }
    if (id) ids.add(id);
    const campos = Object.fromEntries(CAMPOS_DO_QUADRO.map(([chave], k) => [chave, texto(c[iCampos[k]]).slice(0, 200)])) as CamposDoQuadro;
    const faltam = CAMPOS_DO_QUADRO.filter(([chave]) => !campos[chave]).map(([, rotulo]) => rotulo);
    if (faltam.length) {
      erro(`preencha ${faltam.join(", ")}.`);
      continue;
    }
    let invalida = false;
    const num = (k: number) => {
      const v = numeroDa(c[k] ?? null);
      if (v === undefined || (v !== null && (v < 0 || v > 1e9))) {
        erro(`${rotulos[k]}: “${texto(c[k])}” não é um número válido (zero ou mais).`);
        invalida = true;
        return 0;
      }
      return v ?? 0;
    };
    const meses = Array.from({ length: 12 }, (_, k) => ({ colaboradores: num(iColaboradores[k]), salarioBruto: num(iBruto[k]), adicional: num(iAdicional[k]) }));
    if (!invalida) r.quadro.push({ aba: nome, numero: l.numero, id, campos, meses });
  }
}

/** A aba de uma tabela pelos rótulos das descrições (11/11/2026); as das unidades (os mesmos rótulos) pelo título ou pelo nome. */
function tipoDaAba(descricoes: string[], titulo: string, nome: string): AbaDasPremissas | null {
  const tipos = ABAS_DAS_PREMISSAS.filter((a) => COLUNAS[a].length && COLUNAS[a].map(([c]) => c).join("|") === descricoes.join("|"));
  if (tipos.length === 1) return tipos[0];
  if (!tipos.length) return null;
  const doNome = (x: string) => tipos.find((a) => chaveSemAcento(NOME_DA_ABA[a]) === chaveSemAcento(x));
  return doNome(titulo.replace(/^Premissas\s*·\s*/, "")) ?? doNome(nome) ?? null;
}
/** Sem diferença de maiúsculas, acentos e espaços. */
const chaveSemAcento = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Lê um .xlsx do Exportar Premissas: as abas no padrão (as tabelas, pelos rótulos — 11/11/2026: sem a coluna Código; os
 * arquivos de antes, com ela —, a Investimentos e a Quadro de Lotação); as outras são ignoradas, com um aviso.
 */
function lerXlsx(arquivo: string, buffer: Uint8Array): ArquivoLido {
  const r: ArquivoLido = { arquivo, linhas: [], investimentos: [], quadro: [], substituiQuadro: null, abas: [], erros: [], avisos: [] };
  let abas: string[];
  try {
    abas = listarAbas(buffer);
  } catch (e) {
    r.erros.push(e instanceof ArquivoInvalidoError ? e.message : "O arquivo não é uma planilha do Excel (.xlsx) legível.");
    return r;
  }
  for (const nome of abas) {
    if (nome === ABA_CONSOLIDADO) continue;
    const { linhas } = lerAba(buffer, () => nome);
    const ehRotulo = (cs: string[]) =>
      [COLUNA_CODIGO, COLUNA_NOME_REFERENCIA, COLUNA_CODIGO_DA_LINHA].includes(cs[0]) ||
      (cs.includes("Und.") && cs.includes(COLUNA_MEDIA) && cs.includes(COLUNA_JUSTIFICATIVA)) ||
      CAMPOS_DO_QUADRO.every(([, c], k) => cs[k] === c);
    const i = linhas.findIndex((l) => ehRotulo(l.celulas.map((c) => String(c ?? "").trim())));
    if (i < 0) {
      r.avisos.push(`A aba ${nome} não está no padrão do Exportar Premissas (sem os rótulos dele) e foi ignorada.`);
      continue;
    }
    const rotulos = linhas[i].celulas.map((c) => String(c ?? "").trim());
    // A aba Investimentos (15/10/2026): pelo Nome de Referência na primeira coluna.
    if (rotulos[0] === COLUNA_NOME_REFERENCIA) {
      lerInvestimentos(nome, linhas, i, r);
      continue;
    }
    // A aba Quadro de Lotação (09/11/2026): pelo Código da Linha na primeira coluna; desde 11/11/2026, sem ele.
    if (rotulos[0] === COLUNA_CODIGO_DA_LINHA || CAMPOS_DO_QUADRO.every(([, c], k) => rotulos[k] === c)) {
      lerQuadroDeLotacao(nome, linhas, i, r);
      continue;
    }
    const iMedia = rotulos.indexOf(COLUNA_MEDIA);
    // Os meses vêm depois da Variação Máxima (15/10/2026); nos arquivos de antes, logo depois da Média de Referência.
    const iVariacao = rotulos.indexOf(COLUNA_VARIACAO);
    const iJan = iVariacao > iMedia ? iVariacao + 1 : iMedia + 1;
    const iJustificativa = rotulos.indexOf(COLUNA_JUSTIFICATIVA);
    if (iMedia < 0 || iJustificativa < 0 || iJustificativa < iJan + 12) {
      r.erros.push(`A aba ${nome} não tem as colunas do padrão (“${COLUNA_MEDIA}”, os doze meses e “${COLUNA_JUSTIFICATIVA}”).`);
      continue;
    }
    // As descrições (as colunas antes da Und.; nos arquivos de antes, depois do Código) e a aba delas.
    const comCodigo = rotulos[0] === COLUNA_CODIGO;
    const iUnd = rotulos.indexOf("Und.");
    const [d0, d1] = [comCodigo ? 1 : 0, iUnd];
    const doTipo = comCodigo ? null : tipoDaAba(rotulos.slice(d0, d1), String(linhas[0]?.celulas[0] ?? ""), nome);
    if (!comCodigo && !doTipo) {
      r.erros.push(`A aba ${nome} não é uma das abas do Exportar Premissas (os rótulos antes da Und. ou o nome dela mudaram).`);
      continue;
    }
    r.abas.push(nome);
    for (const l of linhas.slice(i + 1)) {
      const chave = comCodigo ? String(l.celulas[0] ?? "").trim() : null;
      const descricao = l.celulas.slice(d0, d1).map((c) => String(c ?? "").trim());
      if (comCodigo ? !chave : descricao.every((d) => !d)) continue;
      const meses: Array<number | null> = [];
      for (let k = 0; k < 12; k++) {
        const v = numeroDa(l.celulas[iJan + k] ?? null);
        if (v === undefined) {
          r.erros.push(`${nome}, linha ${l.numero}, ${rotulos[iJan + k] || `mês ${k + 1}`}: “${l.celulas[iJan + k]}” não é um número.`);
          meses.push(null);
        } else meses.push(v);
      }
      const j = l.celulas[iJustificativa];
      r.linhas.push({ aba: nome, numero: l.numero, chave, doTipo, descricao, meses, justificativa: j === null || j === undefined || String(j).trim() === "" ? null : String(j).trim().slice(0, 2000) });
    }
  }
  if (!r.abas.length && !r.erros.length) r.erros.push("O arquivo não está no padrão do Exportar Premissas: nenhuma aba tem os rótulos dele.");
  return r;
}

/** Lê um arquivo do Importar Valores: um .xlsx, ou um .zip (o "um arquivo por centro") com os .xlsx dentro. */
export function lerArquivoDePremissas(arquivo: string, buffer: Uint8Array): ArquivoLido[] {
  if (/\.zip$/i.test(arquivo)) {
    let itens: Record<string, Uint8Array>;
    try {
      itens = unzipSync(buffer);
    } catch {
      return [{ arquivo, linhas: [], investimentos: [], abas: [], erros: ["O arquivo .zip não pôde ser aberto."], avisos: [], quadro: [], substituiQuadro: null }];
    }
    const xlsx = Object.entries(itens).filter(([n]) => /\.xlsx$/i.test(n) && !n.startsWith("__MACOSX"));
    if (!xlsx.length) return [{ arquivo, linhas: [], investimentos: [], abas: [], erros: ["O .zip não tem nenhuma planilha (.xlsx)."], avisos: [], quadro: [], substituiQuadro: null }];
    return xlsx.map(([n, b]) => lerXlsx(`${arquivo} › ${n.split("/").pop()}`, b));
  }
  return [lerXlsx(arquivo, buffer)];
}
