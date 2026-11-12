import { getPrismaClient } from "../../../config/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import { abasDaConta, combinacoesDaConta } from "../../dre/apuracaoUnidades.js";
import { avaliarExpressao, codigosDaExpressao } from "../../dre/expressao.js";
import { chaveDaLinha } from "../../../lib/linhas.js";
import { LINHAS_TOTAIS } from "../../volumes/totaisOperacao.js";
import { NOME_DA_CHAVE } from "../../volumes/rateiosService.js";
import { conflitoDeVigencia } from "../../volumes/vigenciasRateio.js";
import { formulasPorExtenso, INDICADORES_DAS_LISTAS, ROTULO_DO_REGISTRADO, rotuloDoMovimento, rotuloDoQuadro, TOTALIZADORES_DAS_LISTAS } from "../../relatorios/catalogoIndicadores.js";
import { DEPARTAMENTOS_DO_QUADRO } from "../../relatorios/formulaIndicador.js";
import { compilarFormula, FormulaInvalidaError, formulaPorExtenso } from "../../relatorios/formulaIndicador.js";
import { CALCULOS_SISTEMA } from "../../relatorios/indicadores.js";
import { FORMATOS_DO_PAINEL, indicadoresDaFormula } from "../../relatorios/painelDeBordo.js";
import { plural } from "../../../utils/plural.js";
import { DEFINICOES_COLABORADORES } from "./definicoesColaboradores.js";
import { RegraCadastroError, type Sugestao } from "./erroCadastro.js";

/**
 * Cadastros editáveis pela tela (Passo 25, RF002 e RF003). Cada cadastro
 * declara os campos que a tela mostra e o que pode ser alterado, como validar,
 * o que é derivado de outro campo e o que impede a exclusão — registro usado
 * por lançamento ou apuração só se inativa.
 */

const Decimal = Prisma.Decimal;
type Db = ReturnType<typeof getPrismaClient>;
export type Valores = Record<string, unknown>;

// O erro de regra e a sugestão ficam em erroCadastro.ts (06/11/2026); daqui, os de sempre os importam.
export { RegraCadastroError, type Sugestao } from "./erroCadastro.js";

/**
 * Uma opção de lista; `grupos`: os valores do campo `filtradoPor` em que ela aparece. `chave`: liga as opções
 * equivalentes de grupos diferentes — ao trocar o filtro, a lista fica com a equivalente (24/10/2026).
 */
export type Opcao = { valor: string; rotulo: string; grupos?: string[]; chave?: string };
export type Campo = {
  nome: string;
  rotulo: string;
  /** O rótulo curto no cabeçalho da tabela, quando o do formulário é longo demais. */
  rotuloColuna?: string;
  /** "formula": a fórmula de um indicador, montada na tela com os itens das opções (Estrutura dos Indicadores). */
  tipo: "texto" | "inteiro" | "decimal" | "booleano" | "data" | "opcao" | "multipla" | "formula";
  obrigatorio?: boolean;
  /** Só na criação: a chave natural não muda depois (código RM, reduzido, código da linha). */
  somenteNaCriacao?: boolean;
  /** Calculado pelo sistema; a tela mostra, não edita. */
  derivado?: boolean;
  /**
   * Informação-chave, que liga o cadastro a outras telas (o código do balancete, o nome com que as planilhas citam a
   * linha…): não muda quando o registro já tem movimentos (11/10/2026).
   */
  travaComMovimento?: boolean;
  /** A lista mostra só as opções do valor escolhido neste outro campo (as Linhas dos Totais da Chave, nas regras de rateio). */
  filtradoPor?: string;
  /** Ocupa as duas colunas do formulário de edição. */
  larguraInteira?: boolean;
  /** Um texto longo, em várias linhas (06/11/2026: as Competências e as Atividades das funções). */
  multilinha?: boolean;
  /** Uma coluna estreita na tabela (a ordem e o código, 12/10/2026): o nome fica com o resto. */
  estreita?: boolean;
  /** Um valor em reais: a tabela mostra "R$" e duas casas, e o formulário, duas casas (12/10/2026). */
  moeda?: boolean;
  /** Fora da tabela (só no formulário) ou fora do formulário (só na tabela). */
  naTabela?: boolean;
  noFormulario?: boolean;
  /** No formulário, só aparece com um destes valores no outro campo (o peso, na média ponderada). */
  visivelSe?: { campo: string; valores: string[] };
  /** O valor num registro novo (sem ele, as caixas de marcar começam marcadas, como o Ativo). */
  padrao?: unknown;
  ajuda?: string;
  /** A ajuda ao lado do campo, e não embaixo (21/10/2026; o Formato do Painel de Bordo). */
  ajudaAoLado?: boolean;
  opcoes?: (db: Db) => Promise<Opcao[]>;
};

export type DefinicaoCadastro = {
  entidade: string;
  titulo: string;
  /** Entidade no log de auditoria. */
  auditoria: string;
  campos: Campo[];
  /** Pode criar e excluir (as unidades de negócio, por exemplo, são fixas). */
  criar: boolean;
  excluir: boolean;
  /** O cadastro muda a classificação dos lançamentos: reclassifica as competências não apuradas. */
  reclassifica?: boolean;
  /** O texto explicativo do modal de edição (14/10/2026: as regras de rateio). */
  explicacao?: string;
  listar: (db: Db, busca?: string) => Promise<Valores[]>;
  ler: (db: Db, id: string) => Promise<Valores | null>;
  /** Normaliza, valida e completa os derivados; devolve os dados para gravar. */
  preparar: (db: Db, v: Valores, id: string | null) => Promise<Record<string, unknown>>;
  gravar: (db: Db, dados: Record<string, unknown>, id: string | null) => Promise<string>;
  /** Por que não pode ser excluído (nulo se pode). */
  impedimentoExclusao?: (db: Db, id: string) => Promise<string | null>;
  /**
   * Os movimentos do registro (lançamentos, valores apurados, registros das listas…), em texto, ou nulo sem nenhum.
   * Com movimentos, os campos travaComMovimento não mudam e a exclusão é recusada.
   */
  movimentos?: (db: Db, id: string) => Promise<string | null>;
  remover?: (db: Db, id: string) => Promise<void>;
};

// --------------------------------------------------------------- utilitários
const texto = (v: unknown) => (v === undefined || v === null ? null : String(v).trim() || null);
const exigir = (v: unknown, rotulo: string) => {
  const t = texto(v);
  if (!t) throw new RegraCadastroError(400, `${rotulo} é obrigatório.`);
  return t;
};
const inteiro = (v: unknown, rotulo: string, obrigatorio = false) => {
  const t = texto(v);
  if (t === null) {
    if (obrigatorio) throw new RegraCadastroError(400, `${rotulo} é obrigatório.`);
    return null;
  }
  const n = Number(t);
  if (!Number.isInteger(n)) throw new RegraCadastroError(400, `${rotulo} precisa ser um número inteiro.`);
  return n;
};
const decimal = (v: unknown, rotulo: string) => {
  // Aceita "1298.19", "1298,19", "1.298,19" e "1.298": com vírgula, ou só com
  // pontos de milhar (grupos de três), o ponto é de milhar; senão, decimal.
  const bruto = texto(v);
  const t = bruto && (bruto.includes(",") || /^-?[1-9]\d{0,2}(\.\d{3})+$/.test(bruto)) ? bruto.replace(/\./g, "").replace(",", ".") : bruto;
  if (!t || Number.isNaN(Number(t))) throw new RegraCadastroError(400, `${rotulo} precisa ser um número.`);
  return new Decimal(t);
};
const data = (v: unknown, rotulo: string, obrigatorio = false) => {
  const t = texto(v);
  if (!t) {
    if (obrigatorio) throw new RegraCadastroError(400, `${rotulo} é obrigatória.`);
    return null;
  }
  const d = new Date(`${t.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new RegraCadastroError(400, `${rotulo} não é uma data válida.`);
  return d;
};
const booleano = (v: unknown) => v === true || v === "true" || v === 1 || v === "1";
const opcoesFixas = (pares: Array<[string, string]>) => async () => pares.map(([valor, rotulo]) => ({ valor, rotulo }));
const dia = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const contem = (busca: string | undefined, ...xs: Array<string | null | undefined>) =>
  !busca || xs.some((x) => (x ?? "").toLowerCase().includes(busca.toLowerCase()));
/** "A, B e C". */
const emLista = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}` : (xs[0] ?? ""));

/** Baldes de alocação: as chaves de rateio e os baldes diretos (a coluna RATEIO da planilha). */
const BALDES: Array<[string, string]> = [
  ["UNIDADE", "UNIDADE — direto na unidade do lançamento"],
  ["PROJETO", "PROJETO — rateio por projetos"],
  ["PRODUCAO", "PRODUCAO — rateio pela produção"],
  ["METALURGIA", "METALURGIA — rateio pela metalurgia"],
  ["ARMADURA", "ARMADURA — rateio pela armadura"],
  ["ACOMPANHAMENTO", "ACOMPANHAMENTO — rateio pelos acompanhamentos"],
  ["MATRIZ", "MATRIZ"],
  ["FILIAL", "FILIAL"],
  ["OBRAS", "OBRAS"],
  ["COMPLEMENTAR", "COMPLEMENTAR"],
  ["DESPESAS", "DESPESAS"],
  ["EXTRA", "EXTRA"],
  ["RN", "RN"],
  ["LEBEN", "LEBEN (em desuso)"],
];
const opcaoBalde = (v: unknown) => {
  const t = texto(v);
  if (t && !BALDES.some(([b]) => b === t)) throw new RegraCadastroError(400, `Rateio ${t} desconhecido.`);
  return t;
};

/** Departamentos que um centro pode ter: os dos cadastros e os grupos da DRE, com a sigla de cada um. */
async function departamentos(db: Db) {
  const [centros, linhas] = await Promise.all([
    db.centroCusto.groupBy({ by: ["departamento", "departamentoSigla"], where: { departamento: { not: null } } }),
    db.linhaDRE.findMany({ where: { tipo: "ITEM" }, select: { grupo: true, grupoSigla: true }, distinct: ["grupo"], orderBy: { ordem: "asc" } }),
  ]);
  const sigla = new Map<string, string | null>();
  for (const l of linhas) if (/\(/.test(l.grupo)) sigla.set(l.grupo, l.grupoSigla);
  for (const c of centros) if (!sigla.get(c.departamento!) && c.departamentoSigla) sigla.set(c.departamento!, c.departamentoSigla);
  for (const c of centros) if (!sigla.has(c.departamento!)) sigla.set(c.departamento!, null);
  return sigla;
}

async function linhaPorId(db: Db, id: string) {
  const l = await db.linhaDRE.findUnique({ where: { id }, select: { id: true, tipo: true, grupo: true, atribuicao: true, ativo: true } });
  if (!l) throw new RegraCadastroError(400, "Linha da DRE inexistente.");
  return l;
}

/** As linhas a que uma conta pode apontar: as de item e de total ativas dos departamentos da DRE (os grupos com sigla). */
async function linhasDasContas(db: Db) {
  const ls = await db.linhaDRE.findMany({ where: { tipo: { in: ["ITEM", "TOTAL"] }, ativo: true }, orderBy: { ordem: "asc" } });
  return ls.filter((l) => /\(/.test(l.grupo));
}

/**
 * Recusa a conta cuja linha e rateio nenhuma aba de resultado lê (24/10/2026): os lançamentos que seguem o rateio da
 * conta (obras, centros fora do cadastro e sem centro) ficariam fora do resultado, com a pendência Sem Aba de Resultado
 * da Classificação. O aviso traz as combinações que alguma aba lê, para o formulário aplicar.
 */
async function exigirAbaQueLeia(db: Db, linhaId: string, balde: string | null) {
  const [ls, us] = await Promise.all([
    db.linhaDRE.findMany({
      orderBy: { ordem: "asc" },
      select: { id: true, tipo: true, grupo: true, grupoSigla: true, atribuicao: true, descricao: true, ativo: true, unidades: { select: { unidadeNegocio: { select: { codigo: true } } } } },
    }),
    db.unidadeNegocio.findMany({ select: { codigo: true, nome: true } }),
  ]);
  const linhas = ls.map((l) => ({ ...l, unidades: l.unidades.map((u) => u.unidadeNegocio.codigo) }));
  // O par da Montagem nos Complementares, como na Classificação: entre as linhas ativas.
  const ativas = linhas.filter((l) => l.ativo);
  const escolhida = linhas.find((l) => l.id === linhaId);
  if (!escolhida || abasDaConta(escolhida, balde, ativas).some((a) => a.length)) return;
  const nome = new Map(us.map((u) => [u.codigo, u.nome]));
  const nomes = (abas: number[]) => emLista(abas.map((u) => nome.get(u) ?? String(u)));
  // Iguais nas duas filiais, só as abas; senão, as de cada filial (o rateio UNIDADE: Matriz na filial 1, Filial na 2).
  const lidaEm = ([f1, f2]: [number[], number[]]) =>
    f1.join() === f2.join() ? nomes(f1) : [f1.length ? `${nomes(f1)} (filial 1)` : null, f2.length ? `${nomes(f2)} (filial 2)` : null].filter(Boolean).join(" ou ");
  const sugestoes = combinacoesDaConta(escolhida, ativas.filter((l) => /\(/.test(l.grupo)), BALDES.map(([b]) => b).filter((b) => b !== "LEBEN")).map((c) => ({
    rotulo: `${c.linha.grupoSigla} › ${c.linha.atribuicao ?? "—"} › ${c.linha.descricao} · Rateio ${c.balde}`,
    detalhe: `lida em ${lidaEm(c.abas)}`,
    valores: { departamento: c.linha.grupo, linhaDREId: c.linha.id, balde: c.balde },
  }));
  throw new RegraCadastroError(
    400,
    `Nenhuma aba de resultado lê a linha “${escolhida.descricao}” (${escolhida.grupoSigla}) com o rateio ${balde ?? "vazio"}: os lançamentos que seguem o rateio da conta (de obras, de centros fora do cadastro e sem centro) ficariam fora do resultado, com a pendência Sem Aba de Resultado. ${sugestoes.length ? "Escolha uma das combinações que alguma aba lê:" : "Nenhum rateio faz uma aba ler esta linha: escolha outra Linha da DRE."}`,
    sugestoes,
  );
}

// ----------------------------------------------------------- centros de custo
const centros: DefinicaoCadastro = {
  entidade: "centros-custo",
  titulo: "Centro de custo",
  auditoria: "centro_custo",
  criar: true,
  excluir: true,
  reclassifica: true,
  campos: [
    { nome: "codigoRM", rotulo: "Código RM", tipo: "texto", travaComMovimento: true, ajuda: "A chave do balancete. Vazio só para centros mantidos fora do RM." },
    { nome: "coligada", rotulo: "Coligada", tipo: "inteiro" },
    { nome: "nomeRM", rotulo: "Nome no RM", tipo: "texto", obrigatorio: true },
    { nome: "nomeControladoria", rotulo: "Centro de custo (controladoria)", tipo: "texto", travaComMovimento: true, ajuda: "Agrupa os centros na visão por centro de custo (Resultados, no mês e em Resultados Empresariais)." },
    {
      nome: "departamento",
      rotulo: "Departamento",
      tipo: "opcao",
      opcoes: async (db) => [...(await departamentos(db)).keys()].sort().map((d) => ({ valor: d, rotulo: d })),
    },
    { nome: "departamentoSigla", rotulo: "Sigla do departamento", tipo: "texto", derivado: true },
    { nome: "atribuicao", rotulo: "Atribuição", tipo: "opcao", opcoes: opcoesFixas([["DIRETA", "DIRETA"], ["INDIRETA", "INDIRETA"]]) },
    { nome: "balde", rotulo: "Rateio", tipo: "opcao", opcoes: opcoesFixas(BALDES) },
    {
      nome: "unidadeNegocioId",
      rotulo: "Unidade dedicada",
      tipo: "opcao",
      opcoes: async (db) => (await db.unidadeNegocio.findMany({ orderBy: { codigo: "asc" } })).map((u) => ({ valor: u.id, rotulo: `${u.codigo} · ${u.nome}` })),
    },
    { nome: "ativo", rotulo: "Ativo", tipo: "booleano" },
  ],
  async listar(db, busca) {
    const cs = await db.centroCusto.findMany({ orderBy: [{ ordem: "asc" }, { codigoRM: "asc" }] });
    return cs.filter((c) => contem(busca, c.codigoRM, c.nomeRM, c.nomeControladoria));
  },
  ler: (db, id) => db.centroCusto.findUnique({ where: { id } }),
  async preparar(db, v, id) {
    const codigoRM = texto(v.codigoRM);
    if (codigoRM) {
      const outro = await db.centroCusto.findUnique({ where: { codigoRM }, select: { id: true } });
      if (outro && outro.id !== id) throw new RegraCadastroError(409, `Já existe um centro com o código ${codigoRM}.`);
    }
    const departamento = texto(v.departamento);
    const atribuicao = texto(v.atribuicao);
    if (atribuicao && !["DIRETA", "INDIRETA"].includes(atribuicao)) throw new RegraCadastroError(400, "Atribuição deve ser DIRETA ou INDIRETA.");
    const unidadeNegocioId = texto(v.unidadeNegocioId);
    if (unidadeNegocioId && !(await db.unidadeNegocio.findUnique({ where: { id: unidadeNegocioId } }))) throw new RegraCadastroError(400, "Unidade inexistente.");
    return {
      codigoRM,
      coligada: inteiro(v.coligada, "Coligada"),
      nomeRM: exigir(v.nomeRM, "O nome no RM"),
      nomeControladoria: texto(v.nomeControladoria),
      departamento,
      departamentoSigla: departamento ? ((await departamentos(db)).get(departamento) ?? null) : null,
      atribuicao,
      atribuicaoSigla: atribuicao ? atribuicao.slice(0, 3) : null,
      balde: opcaoBalde(v.balde),
      unidadeNegocioId,
      ativo: v.ativo === undefined ? true : booleano(v.ativo),
    };
  },
  async gravar(db, d, id) {
    const dados = d as Prisma.CentroCustoUncheckedCreateInput;
    return id ? (await db.centroCusto.update({ where: { id }, data: dados })).id : (await db.centroCusto.create({ data: { ...dados, ordem: (await db.centroCusto.count()) + 1 } })).id;
  },
  async movimentos(db, id) {
    const [l, m, r] = await Promise.all([
      db.lancamentoContabil.count({ where: { centroCustoId: id } }),
      db.lancamentoManual.count({ where: { centroCustoId: id } }),
      db.resultadoApurado.count({ where: { centroCustoId: id } }),
    ]);
    return l + m + r > 0 ? `O centro tem ${l} ${plural(l, "lançamento", "lançamentos")} do balancete, ${m} ${plural(m, "manual", "manuais")} e ${r} ${plural(r, "valor apurado", "valores apurados")}.` : null;
  },
  async impedimentoExclusao(db, id) {
    if ((await db.regraRateio.findUnique({ where: { id }, select: { percentualFixo: true } }))?.percentualFixo != null) return "Esta regra é de percentual fixo: exclua-a em “Percentuais Fixos”, com os outros destinos da chave.";
    const m = await this.movimentos!(db, id);
    if (m) return `${m} Inative-o em vez de excluir.`;
    // A Gestão de Colaboradores (09/11/2026): o Lançamento Inicial, as movimentações e as linhas do Quadro de Lotação dos cenários.
    const [c, q, l] = await Promise.all([
      db.colaboradorCargaInicial.count({ where: { centroCustoId: id } }),
      db.colaboradorMovimentacao.count({ where: { centroCustoId: id } }),
      db.cenarioLotacao.count({ where: { centroCustoId: id } }),
    ]);
    const usos = [
      c ? `${c} ${plural(c, "colaborador", "colaboradores")} do Lançamento Inicial` : "",
      q ? `${q} ${plural(q, "movimentação", "movimentações")} do Quadro de Lotação` : "",
      l ? `${l} ${plural(l, "linha", "linhas")} do Quadro de Lotação dos cenários analíticos` : "",
    ].filter(Boolean);
    return usos.length ? `O centro está em ${usos.join(", ")} (Gestão de Colaboradores). Inative-o em vez de excluir.` : null;
  },
  remover: async (db, id) => void (await db.centroCusto.delete({ where: { id } })),
};

// --------------------------------------------------------- contas de resultado
const contas: DefinicaoCadastro = {
  entidade: "contas-resultado",
  titulo: "Conta de resultado",
  auditoria: "conta_resultado",
  criar: true,
  excluir: true,
  reclassifica: true,
  campos: [
    { nome: "reduzido", rotulo: "Reduzido", tipo: "texto", obrigatorio: true, somenteNaCriacao: true, travaComMovimento: true, ajuda: "A chave do balancete." },
    { nome: "conta", rotulo: "Conta", tipo: "texto", obrigatorio: true },
    { nome: "descricao", rotulo: "Descrição", tipo: "texto", obrigatorio: true },
    { nome: "tipoConta", rotulo: "Tipo", tipo: "opcao", obrigatorio: true, opcoes: opcoesFixas([["ANALITICA", "Analítica"], ["SINTETICA", "Sintética"]]) },
    // O departamento escolhe o grupo da DRE, e a linha fica entre as dele (24/10/2026; antes, derivado da linha).
    {
      nome: "departamento",
      rotulo: "Departamento",
      tipo: "opcao",
      larguraInteira: true,
      ajuda: "O grupo da DRE. A Linha da DRE mostra só as linhas dele.",
      opcoes: async (db) => [...new Set((await linhasDasContas(db)).map((l) => l.grupo))].map((g) => ({ valor: g, rotulo: g })),
    },
    {
      nome: "linhaDREId",
      rotulo: "Linha da DRE",
      tipo: "opcao",
      filtradoPor: "departamento",
      larguraInteira: true,
      ajuda: "O destino na DRE. Ao trocar o departamento, fica a linha de mesma atribuição e descrição, quando ele tem uma. A atribuição sai da linha.",
      opcoes: async (db) =>
        (await linhasDasContas(db)).map((l) => ({
          valor: l.id,
          rotulo: `${l.grupoSigla} › ${l.atribuicao ?? "—"} › ${l.descricao}`,
          grupos: [l.grupo],
          chave: `${l.atribuicao ?? ""}|${l.descricao}`.toUpperCase(),
        })),
    },
    { nome: "atribuicao", rotulo: "Atribuição", tipo: "texto", derivado: true },
    { nome: "balde", rotulo: "Rateio", tipo: "opcao", opcoes: opcoesFixas(BALDES) },
    { nome: "ativo", rotulo: "Ativa", tipo: "booleano" },
  ],
  async listar(db, busca) {
    const cs = await db.contaResultado.findMany({ orderBy: [{ conta: "asc" }, { ordem: "asc" }] });
    return cs.filter((c) => contem(busca, c.reduzido, c.conta, c.descricao));
  },
  // Com linha, o departamento é sempre o grupo dela (a lista da linha é filtrada por ele).
  async ler(db, id) {
    const c = await db.contaResultado.findUnique({ where: { id }, include: { linhaDRE: { select: { grupo: true } } } });
    if (!c) return null;
    const { linhaDRE, ...conta } = c;
    return { ...conta, departamento: linhaDRE?.grupo ?? conta.departamento };
  },
  async preparar(db, v, id) {
    const reduzido = exigir(v.reduzido, "O reduzido");
    const outro = await db.contaResultado.findUnique({ where: { reduzido }, select: { id: true } });
    if (outro && outro.id !== id) throw new RegraCadastroError(409, `Já existe uma conta com o reduzido ${reduzido}.`);
    const tipoConta = exigir(v.tipoConta, "O tipo");
    if (!["ANALITICA", "SINTETICA"].includes(tipoConta)) throw new RegraCadastroError(400, "Tipo deve ser analítica ou sintética.");
    const departamento = texto(v.departamento);
    const linhaDREId = texto(v.linhaDREId);
    const linha = linhaDREId ? await linhaPorId(db, linhaDREId) : null;
    if (linha && linha.tipo !== "ITEM" && linha.tipo !== "TOTAL") throw new RegraCadastroError(400, "A conta só aponta para linha de item (ou para os impostos operacionais).");
    if ((linha || departamento) && tipoConta === "SINTETICA") throw new RegraCadastroError(400, "Conta sintética não classifica: deixe o Departamento e a Linha da DRE vazios.");
    if (linha && departamento && departamento !== linha.grupo) throw new RegraCadastroError(400, `A Linha da DRE escolhida é do departamento ${linha.grupo}, e não de ${departamento}.`);
    const balde = opcaoBalde(v.balde);
    if (linha?.tipo === "ITEM" && tipoConta === "ANALITICA") await exigirAbaQueLeia(db, linha.id, balde);
    return {
      reduzido,
      conta: exigir(v.conta, "A conta"),
      descricao: exigir(v.descricao, "A descrição"),
      tipoConta,
      linhaDREId,
      departamento: linha?.grupo ?? departamento,
      atribuicao: linha?.atribuicao ?? null,
      balde,
      ativo: v.ativo === undefined ? true : booleano(v.ativo),
    };
  },
  async gravar(db, d, id) {
    const dados = d as Prisma.ContaResultadoUncheckedCreateInput;
    if (id) {
      const { reduzido: _, ...resto } = dados;
      return (await db.contaResultado.update({ where: { id }, data: resto })).id;
    }
    return (await db.contaResultado.create({ data: { ...dados, ordem: (await db.contaResultado.count()) + 1 } })).id;
  },
  async impedimentoExclusao(db, id) {
    const [l, a, m, r] = await Promise.all([
      db.lancamentoContabil.count({ where: { contaResultadoId: id } }),
      db.lancamentoContabil.count({ where: { contaAdotadaId: id } }),
      db.lancamentoManual.count({ where: { contaResultadoId: id } }),
      db.reclassificacaoConta.count({ where: { OR: [{ contaOrigemId: id }, { contaDestinoId: id }] } }),
    ]);
    return l + a + m + r > 0 ? `A conta é usada por ${l + a} ${plural(l + a, "lançamento", "lançamentos")} do balancete, ${m} ${plural(m, "manual", "manuais")} e ${r} ${plural(r, "reclassificação", "reclassificações")}: inative-a em vez de excluir.` : null;
  },
  async movimentos(db, id) {
    const [l, a, m] = await Promise.all([
      db.lancamentoContabil.count({ where: { contaResultadoId: id } }),
      db.lancamentoContabil.count({ where: { contaAdotadaId: id } }),
      db.lancamentoManual.count({ where: { contaResultadoId: id } }),
    ]);
    return l + a + m > 0 ? `A conta é usada por ${l + a} ${plural(l + a, "lançamento", "lançamentos")} do balancete e ${m} ${plural(m, "manual", "manuais")}.` : null;
  },
  remover: async (db, id) => void (await db.contaResultado.delete({ where: { id } })),
};

// --------------------------------------------------------- reclassificações
const reclassificacoes: DefinicaoCadastro = {
  entidade: "reclassificacoes",
  titulo: "Reclassificação de conta",
  auditoria: "reclassificacao",
  criar: true,
  excluir: true,
  reclassifica: true,
  campos: [
    { nome: "codigoCentroCusto", rotulo: "Centro de custo (código RM)", tipo: "texto", obrigatorio: true, ajuda: "Centro do cadastro ou de obra (1.98, 1.99)." },
    { nome: "contaOrigemId", rotulo: "Conta em que o RM lançou", tipo: "opcao", obrigatorio: true, opcoes: async (db) => opcoesContas(db) },
    { nome: "contaDestinoId", rotulo: "Conta que vale na DRE", tipo: "opcao", obrigatorio: true, opcoes: async (db) => opcoesContas(db) },
    { nome: "motivo", rotulo: "Motivo", tipo: "texto" },
    { nome: "ativo", rotulo: "Ativa", tipo: "booleano" },
  ],
  async listar(db, busca) {
    const rs = await db.reclassificacaoConta.findMany({
      orderBy: [{ codigoCentroCusto: "asc" }, { ordem: "asc" }],
      include: { contaOrigem: { select: { reduzido: true, descricao: true } }, contaDestino: { select: { reduzido: true, descricao: true } } },
    });
    return rs.filter((r) => contem(busca, r.codigoCentroCusto, r.contaOrigem.reduzido, r.contaDestino.reduzido, r.motivo));
  },
  ler: (db, id) => db.reclassificacaoConta.findUnique({ where: { id } }),
  async preparar(db, v, id) {
    const codigoCentroCusto = exigir(v.codigoCentroCusto, "O centro de custo");
    const contaOrigemId = exigir(v.contaOrigemId, "A conta de origem");
    const contaDestinoId = exigir(v.contaDestinoId, "A conta de destino");
    if (contaOrigemId === contaDestinoId) throw new RegraCadastroError(400, "A conta de destino precisa ser diferente da de origem.");
    const destino = await db.contaResultado.findUnique({ where: { id: contaDestinoId }, select: { tipoConta: true, linhaDREId: true } });
    if (!destino || !(await db.contaResultado.findUnique({ where: { id: contaOrigemId } }))) throw new RegraCadastroError(400, "Conta inexistente.");
    if (destino.tipoConta !== "ANALITICA" || !destino.linhaDREId) throw new RegraCadastroError(400, "A conta de destino precisa ser analítica e ter linha na DRE.");
    const outra = await db.reclassificacaoConta.findUnique({ where: { codigoCentroCusto_contaOrigemId: { codigoCentroCusto, contaOrigemId } }, select: { id: true } });
    if (outra && outra.id !== id) throw new RegraCadastroError(409, "Já existe uma reclassificação para este centro e esta conta.");
    return { codigoCentroCusto, contaOrigemId, contaDestinoId, motivo: texto(v.motivo), ativo: v.ativo === undefined ? true : booleano(v.ativo) };
  },
  async gravar(db, d, id) {
    const dados = d as Prisma.ReclassificacaoContaUncheckedCreateInput;
    return id
      ? (await db.reclassificacaoConta.update({ where: { id }, data: dados })).id
      : (await db.reclassificacaoConta.create({ data: { ...dados, ordem: (await db.reclassificacaoConta.count()) + 1 } })).id;
  },
  // A reclassificação não é referenciada: o lançamento guarda a conta adotada, congelada na apuração.
  remover: async (db, id) => void (await db.reclassificacaoConta.delete({ where: { id } })),
};
async function opcoesContas(db: Db) {
  return (await db.contaResultado.findMany({ where: { tipoConta: "ANALITICA" }, orderBy: { reduzido: "asc" }, select: { id: true, reduzido: true, descricao: true } })).map((c) => ({
    valor: c.id,
    rotulo: `${c.reduzido} · ${c.descricao}`,
  }));
}

// --------------------------------------------------------- estrutura da DRE
const estrutura: DefinicaoCadastro = {
  entidade: "estrutura-dre",
  titulo: "Linha da DRE",
  auditoria: "linha_dre",
  criar: true,
  excluir: true,
  campos: [
    { nome: "codigo", rotulo: "Código", tipo: "texto", obrigatorio: true, somenteNaCriacao: true, ajuda: "Referência estável nas expressões (ex.: CPP.MOD.REMUNERACOES_CLT)." },
    { nome: "ordem", rotulo: "Ordem", tipo: "inteiro", obrigatorio: true },
    { nome: "tipo", rotulo: "Tipo", tipo: "opcao", obrigatorio: true, travaComMovimento: true, opcoes: opcoesFixas([["SECAO", "Seção"], ["ITEM", "Item"], ["SUBTOTAL", "Subtotal"], ["TOTAL", "Total"]]) },
    { nome: "grupo", rotulo: "Grupo", tipo: "texto", obrigatorio: true, travaComMovimento: true },
    { nome: "grupoSigla", rotulo: "Sigla do grupo", tipo: "texto", obrigatorio: true, travaComMovimento: true },
    { nome: "atribuicao", rotulo: "Atribuição", tipo: "texto", travaComMovimento: true },
    { nome: "atribuicaoSigla", rotulo: "Sigla da atribuição", tipo: "texto", travaComMovimento: true },
    { nome: "descricao", rotulo: "Descrição", tipo: "texto", obrigatorio: true, travaComMovimento: true },
    { nome: "expressao", rotulo: "Expressão", tipo: "texto", ajuda: "Subtotal e total: códigos de outras linhas com + e −, parênteses e SUM(a, b)." },
    {
      nome: "unidades",
      rotulo: "Unidades em que aparece",
      tipo: "multipla",
      travaComMovimento: true,
      opcoes: async (db) => (await db.unidadeNegocio.findMany({ orderBy: { codigo: "asc" } })).map((u) => ({ valor: String(u.codigo), rotulo: u.nome })),
    },
    { nome: "definicao", rotulo: "O que a linha significa", tipo: "texto" },
    { nome: "ativo", rotulo: "Ativa", tipo: "booleano" },
  ],
  async listar(db, busca) {
    const ls = await db.linhaDRE.findMany({ orderBy: { ordem: "asc" }, include: { unidades: { select: { unidadeNegocio: { select: { codigo: true } } } } } });
    return ls.filter((l) => contem(busca, l.codigo, l.descricao, l.grupo, l.atribuicao)).map(({ unidades, ...l }) => ({ ...l, unidades: unidades.map((u) => String(u.unidadeNegocio.codigo)) }));
  },
  async ler(db, id) {
    const l = await db.linhaDRE.findUnique({ where: { id }, include: { unidades: { select: { unidadeNegocio: { select: { codigo: true } } } } } });
    return l ? { ...l, unidades: l.unidades.map((u) => String(u.unidadeNegocio.codigo)) } : null;
  },
  async preparar(db, v, id) {
    const codigo = exigir(v.codigo, "O código").toUpperCase();
    const outra = await db.linhaDRE.findUnique({ where: { codigo }, select: { id: true } });
    if (outra && outra.id !== id) throw new RegraCadastroError(409, `Já existe uma linha com o código ${codigo}.`);
    const tipo = exigir(v.tipo, "O tipo");
    if (!["SECAO", "ITEM", "SUBTOTAL", "TOTAL"].includes(tipo)) throw new RegraCadastroError(400, "Tipo inválido.");
    const expressao = texto(v.expressao);
    const ativo = v.ativo === undefined ? true : booleano(v.ativo);
    if ((tipo === "SUBTOTAL" || tipo === "TOTAL") && !expressao) throw new RegraCadastroError(400, "Subtotal e total precisam de expressão.");
    if ((tipo === "ITEM" || tipo === "SECAO") && expressao) throw new RegraCadastroError(400, "Item e seção não têm expressão: o valor vem das contas.");
    if (expressao) await validarExpressao(db, codigo, expressao);
    if (id && !ativo) await validarInativacao(db, id, codigo);
    const unidades = Array.isArray(v.unidades) ? v.unidades.map(String) : [];
    return {
      codigo,
      ordem: inteiro(v.ordem, "A ordem", true),
      tipo,
      grupo: exigir(v.grupo, "O grupo"),
      grupoSigla: exigir(v.grupoSigla, "A sigla do grupo"),
      atribuicao: texto(v.atribuicao),
      atribuicaoSigla: texto(v.atribuicaoSigla),
      descricao: exigir(v.descricao, "A descrição"),
      expressao,
      definicao: texto(v.definicao),
      ativo,
      unidades,
    };
  },
  async gravar(db, d, id) {
    const { unidades, ...dados } = d as { unidades: string[] } & Prisma.LinhaDREUncheckedCreateInput;
    const ids = (await db.unidadeNegocio.findMany({ where: { codigo: { in: unidades.map(Number) } }, select: { id: true } })).map((u) => u.id);
    return db.$transaction(async (tx) => {
      const linha = id ? await tx.linhaDRE.update({ where: { id }, data: dados }) : await tx.linhaDRE.create({ data: dados });
      await tx.linhaDREUnidade.deleteMany({ where: { linhaDREId: linha.id } });
      if (ids.length) await tx.linhaDREUnidade.createMany({ data: ids.map((unidadeNegocioId) => ({ linhaDREId: linha.id, unidadeNegocioId })) });
      return linha.id;
    });
  },
  async movimentos(db, id) {
    const [contasN, resultados, manuais, lancamentos] = await Promise.all([
      db.contaResultado.count({ where: { linhaDREId: id } }),
      db.resultadoApurado.count({ where: { linhaDREId: id } }),
      db.lancamentoManual.count({ where: { linhaDREId: id } }),
      db.lancamentoContabil.count({ where: { linhaDREId: id } }),
    ]);
    return contasN + resultados + manuais + lancamentos > 0
      ? `A linha tem ${contasN} ${plural(contasN, "conta vinculada", "contas vinculadas")}, ${lancamentos} ${plural(lancamentos, "lançamento", "lançamentos")} do balancete, ${manuais} ${plural(manuais, "manual", "manuais")} e ${resultados} ${plural(resultados, "valor apurado", "valores apurados")}.`
      : null;
  },
  async impedimentoExclusao(db, id) {
    const l = await db.linhaDRE.findUniqueOrThrow({ where: { id }, select: { codigo: true } });
    const [contasN, resultados, manuais, lancamentos] = await Promise.all([
      db.contaResultado.count({ where: { linhaDREId: id } }),
      db.resultadoApurado.count({ where: { linhaDREId: id } }),
      db.lancamentoManual.count({ where: { linhaDREId: id } }),
      db.lancamentoContabil.count({ where: { linhaDREId: id } }),
    ]);
    const referencias = await quemReferencia(db, l.codigo);
    if (contasN + resultados + manuais + lancamentos + referencias.length > 0) {
      return `A linha é usada (${contasN} ${plural(contasN, "conta", "contas")}, ${lancamentos + manuais} ${plural(lancamentos + manuais, "lançamento", "lançamentos")}, ${resultados} ${plural(resultados, "valor apurado", "valores apurados")}${referencias.length ? `, nas expressões de ${referencias.join(", ")}` : ""}): inative-a em vez de excluir.`;
    }
    return null;
  },
  remover: async (db, id) => void (await db.linhaDRE.delete({ where: { id } })),
};

/** As linhas ativas cuja expressão cita o código. */
async function quemReferencia(db: Db, codigo: string) {
  const ls = await db.linhaDRE.findMany({ where: { expressao: { not: null }, ativo: true }, select: { codigo: true, expressao: true } });
  return ls.filter((l) => codigosDaExpressao(l.expressao!).includes(codigo)).map((l) => l.codigo);
}

/** A expressão precisa ser válida, citar só linhas ativas existentes e não fechar ciclo. */
async function validarExpressao(db: Db, codigo: string, expressao: string) {
  let citados: string[];
  try {
    avaliarExpressao(expressao, () => new Decimal(0)); // a sintaxe
    citados = codigosDaExpressao(expressao);
  } catch (e) {
    throw new RegraCadastroError(400, /^Express/.test((e as Error).message) ? (e as Error).message : `Expressão inválida: ${(e as Error).message}`);
  }
  if (citados.length === 0) throw new RegraCadastroError(400, "A expressão não cita nenhuma linha.");
  const linhas = await db.linhaDRE.findMany({ select: { codigo: true, expressao: true, ativo: true } });
  const porCodigo = new Map(linhas.map((l) => [l.codigo, l]));
  const faltam = citados.filter((c) => !porCodigo.get(c)?.ativo);
  if (faltam.length) throw new RegraCadastroError(400, `A expressão cita ${plural(faltam.length, "linha inexistente ou inativa", "linhas inexistentes ou inativas")}: ${faltam.join(", ")}.`);
  // Ciclo: a partir das linhas citadas, alguma chega de volta a esta?
  const grafo = new Map(linhas.map((l) => [l.codigo, l.expressao ? codigosDaExpressao(l.expressao) : []]));
  grafo.set(codigo, citados);
  const visitados = new Set<string>();
  const caminho: string[] = [];
  const temCiclo = (c: string): boolean => {
    if (c === codigo && caminho.length > 0) return true;
    if (visitados.has(c)) return false;
    visitados.add(c);
    caminho.push(c);
    for (const p of grafo.get(c) ?? []) if (temCiclo(p)) return true;
    caminho.pop();
    return false;
  };
  for (const c of citados) {
    caminho.length = 0;
    caminho.push(codigo);
    visitados.clear();
    if (temCiclo(c)) throw new RegraCadastroError(400, `A expressão é circular: ${[...caminho, codigo].join(" → ")}.`);
  }
}

/** Inativar exige que nenhuma linha ativa a cite e que nenhuma competência fechada a tenha apurada (RF003). */
async function validarInativacao(db: Db, id: string, codigo: string) {
  const referencias = await quemReferencia(db, codigo);
  if (referencias.length) throw new RegraCadastroError(409, `A linha é citada nas expressões de ${referencias.join(", ")}: ajuste-as antes de inativá-la.`);
  const fechadas = await db.resultadoApurado.findMany({ where: { linhaDREId: id, competencia: { status: "FECHADA" } }, select: { competencia: { select: { ano: true, mes: true } } }, distinct: ["competenciaId"] });
  if (fechadas.length) {
    throw new RegraCadastroError(
      409,
      `A linha tem valores apurados em competência fechada (${fechadas.map((f) => `${String(f.competencia.mes).padStart(2, "0")}/${f.competencia.ano}`).join(", ")}): a estrutura de competência fechada não muda.`,
    );
  }
}

// ------------------------------------------------------- unidades de negócio
const unidades: DefinicaoCadastro = {
  entidade: "unidades",
  titulo: "Unidade de negócio",
  auditoria: "unidade_negocio",
  // As cinco unidades são fixas: cada uma é apurada por uma regra própria. O Tipo saiu do cadastro (09/10/2026):
  // a unidade é identificada pelo código e, onde a planilha a cita (as abas Realizado (…)), pelo nome.
  criar: false,
  excluir: false,
  campos: [
    { nome: "ordem", rotulo: "Ordem", tipo: "inteiro", estreita: true },
    { nome: "codigo", rotulo: "Código", tipo: "inteiro", derivado: true, estreita: true },
    { nome: "nome", rotulo: "Nome", tipo: "texto", obrigatorio: true, travaComMovimento: true },
    { nome: "ativo", rotulo: "Ativa", tipo: "booleano" },
  ],
  listar: async (db) => db.unidadeNegocio.findMany({ orderBy: { codigo: "asc" } }),
  // O nome identifica a unidade na carga da Estrutura da DRE (as abas Realizado (…)): com movimentos, não muda.
  async movimentos(db, id) {
    const u = await db.unidadeNegocio.findUnique({
      where: { id },
      select: { _count: { select: { resultadosApurados: true, receitasPrevias: true, volumesOperacionais: true, projetos: true, producoes: true, expedicoes: true, montagens: true, acompanhamentos: true, medicoes: true, devolucoes: true, saidas: true } } },
    });
    const n = u ? Object.values(u._count).reduce((s, x) => s + x, 0) : 0;
    return n ? `A unidade tem ${n} ${plural(n, "registro", "registros")} nas listas, nos rateios, na receita prévia e na DRE apurada.` : null;
  },
  ler: (db, id) => db.unidadeNegocio.findUnique({ where: { id } }),
  async preparar(_db, v) {
    return { nome: exigir(v.nome, "O nome"), ordem: inteiro(v.ordem, "A ordem") ?? 0, ativo: v.ativo === undefined ? true : booleano(v.ativo) };
  },
  gravar: async (db, d, id) => (await db.unidadeNegocio.update({ where: { id: id! }, data: d as Prisma.UnidadeNegocioUpdateInput })).id,
};

// ---------------------------------------------------------------------- linhas
/**
 * As linhas por unidade (10/10/2026): os produtos (Estrutura, Alveolares, Estacas; a Metalúrgica, inativa desde 26/10/2026) na Matriz ou na Filial
 * e as linhas de obra (Montagem, Fundação, Capeamento…) em Serviços. É o cadastro que as Listas usam: elas acham a
 * linha pelo código (o texto das planilhas, em maiúsculas), que não muda depois de criada. As linhas de faturamento
 * (das medições) ficam fora da tela.
 */
const UNIDADES_DAS_LINHAS = [1, 2, 3];
const tipoDaLinha = (codigoUnidade: number) => (codigoUnidade === 3 ? "OBRA" : "PRODUTO");
/** As unidades de medida das linhas (12/10/2026), para os Cenários Analíticos. */
const UNIDADES_DE_MEDIDA = ["m³", "m³ e pistas", "kg", "m", "m²", "dia", "%"];
function unidadeDeMedida(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const u = String(v);
  if (!UNIDADES_DE_MEDIDA.includes(u)) throw new RegraCadastroError(400, `Unidade de medida inválida: ${u}. Use ${UNIDADES_DE_MEDIDA.join(", ")}.`);
  return u;
}

const linhas: DefinicaoCadastro = {
  entidade: "linhas",
  titulo: "Linha",
  auditoria: "linha",
  criar: true,
  excluir: true,
  campos: [
    { nome: "ordem", rotulo: "Ordem", tipo: "inteiro", estreita: true },
    {
      nome: "unidadeNegocioId",
      rotulo: "Unidade",
      tipo: "opcao",
      obrigatorio: true,
      ajuda: "Matriz ou Filial para os produtos; Serviços para as linhas de obra.",
      travaComMovimento: true,
      opcoes: async (db) =>
        (await db.unidadeNegocio.findMany({ where: { codigo: { in: UNIDADES_DAS_LINHAS } }, orderBy: { codigo: "asc" } })).map((u) => ({ valor: u.id, rotulo: u.nome })),
    },
    { nome: "nome", rotulo: "Linha", tipo: "texto", obrigatorio: true, travaComMovimento: true, ajuda: "O nome com que as planilhas das Listas citam a linha (sem diferença de maiúsculas)." },
    {
      nome: "unidadeMedida",
      rotulo: "Und. de Medida",
      tipo: "opcao",
      ajuda: "Em que se mede a linha (para os Cenários Analíticos).",
      opcoes: async () => UNIDADES_DE_MEDIDA.map((u) => ({ valor: u, rotulo: u })),
    },
    { nome: "ativo", rotulo: "Ativa", tipo: "booleano" },
  ],
  listar: async (db, busca) =>
    (
      await db.linha.findMany({
        where: { tipo: { in: ["PRODUTO", "OBRA"] } },
        include: { unidadeNegocio: { select: { codigo: true, nome: true } } },
        orderBy: { ordem: "asc" },
      })
    )
      .sort((a, b) => (a.unidadeNegocio?.codigo ?? 9) - (b.unidadeNegocio?.codigo ?? 9) || a.ordem - b.ordem)
      .filter((l) => contem(busca, l.nome, l.codigo, l.unidadeNegocio?.nome))
      .map(({ unidadeNegocio: _u, ...l }) => l),
  ler: (db, id) => db.linha.findUnique({ where: { id } }),
  async preparar(db, v, id) {
    const unidade = await db.unidadeNegocio.findUnique({ where: { id: exigir(v.unidadeNegocioId, "A unidade") } });
    if (!unidade || !UNIDADES_DAS_LINHAS.includes(unidade.codigo)) throw new RegraCadastroError(400, "A unidade precisa ser Matriz, Filial ou Serviços.");
    const nome = exigir(v.nome, "A linha");
    const tipo = tipoDaLinha(unidade.codigo);
    if (id) {
      const atual = await db.linha.findUnique({ where: { id }, select: { tipo: true } });
      if (!atual) throw new RegraCadastroError(404, "Linha não encontrada.");
      // O tipo (produto ou obra) vem da unidade e faz parte da chave com que as telas acham a linha: não muda.
      if (atual.tipo !== tipo) {
        throw new RegraCadastroError(400, atual.tipo === "OBRA" ? "Linha de obra fica em Serviços." : "Linha de produto fica na Matriz ou na Filial.");
      }
    }
    // As telas e as importações acham a linha pelo Nome (11/10/2026); o código interno o acompanha, em maiúsculas.
    const codigo = chaveDaLinha(nome);
    const mesmoNome = (await db.linha.findMany({ where: { tipo }, select: { id: true, nome: true } })).find((l) => l.id !== id && chaveDaLinha(l.nome) === codigo);
    if (mesmoNome) throw new RegraCadastroError(409, `Já existe a linha ${mesmoNome.nome}.`);
    return {
      tipo,
      codigo,
      nome,
      unidadeNegocioId: unidade.id,
      ordem: inteiro(v.ordem, "A ordem") ?? undefined,
      ativo: v.ativo === undefined ? true : booleano(v.ativo),
      unidadeMedida: unidadeDeMedida(v.unidadeMedida),
    };
  },
  async gravar(db, d, id) {
    const dados = d as Prisma.LinhaUncheckedCreateInput;
    if (id) {
      const { tipo: _t, ...editaveis } = dados;
      return (await db.linha.update({ where: { id }, data: editaveis })).id;
    }
    return (await db.linha.create({ data: { ...dados, ordem: dados.ordem ?? (await db.linha.count({ where: { tipo: { in: ["PRODUTO", "OBRA"] } } })) + 1 } })).id;
  },
  async movimentos(db, id) {
    const l = await db.linha.findUnique({
      where: { id },
      select: {
        _count: {
          select: {
            obras: true, precosContrato: true, estoqueSaldos: true, estoqueIniciais: true, projetos: true, producoes: true,
            producoesPista: true, producoesArmadura: true, producoesMetalurgia: true, expedicoes: true, montagens: true,
            acompanhamentos: true, medicoes: true, devolucoes: true, saidas: true,
          },
        },
      },
    });
    const n = l ? Object.values(l._count).reduce((s, x) => s + x, 0) : 0;
    return n ? `A linha está em ${n} ${plural(n, "registro", "registros")} das listas, do estoque, dos preços ou das obras.` : null;
  },
  async impedimentoExclusao(db, id) {
    const m = await this.movimentos!(db, id);
    if (m) return `${m} Inative-a em vez de excluir.`;
    // As regras da Alocação nas Linhas (26/10/2026) não travam o nome, mas a exclusão, sim.
    const n = await db.alocacaoLinha.count({ where: { linhaId: id } });
    if (n) return `A linha está em ${n} ${plural(n, "regra", "regras")} da Alocação nas Linhas: troque a linha delas ou exclua-as antes.`;
    // Os percentuais por linha dos rateios fixos (26/10/2026).
    const fixos = await db.regraRateioLinha.count({ where: { linhaId: id } });
    if (fixos) return `A linha está nos percentuais por linha de ${fixos} ${plural(fixos, "regra", "regras")} de rateio fixo (Regras de Rateio): passe o percentual dela a outra linha antes.`;
    // Os resultados gravados pela etapa Linhas da apuração (26/10/2026).
    const r = await db.resultadoLinha.groupBy({ by: ["competenciaId"], where: { linhaId: id } });
    return r.length ? `A linha tem resultados gravados em ${r.length} ${plural(r.length, "competência", "competências")} (a etapa Linhas): inative-a em vez de excluir.` : null;
  },
  remover: async (db, id) => void (await db.linha.delete({ where: { id } })),
};

// --------------------------------------------------------- estrutura dos indicadores
/**
 * A Estrutura dos Indicadores (11/10/2026): os indicadores de resultado, com a fórmula (Metodologia) que os calcula —
 * itens da DRE (qualquer linha, por unidade), totalizadores das Listas, indicadores do Comercial e do Administrativo,
 * metas do orçamento e (23/10/2026) outros indicadores do cadastro, com + − × ÷ e parênteses. O nome identifica o
 * indicador nas metas importadas, nos valores digitados, no Painel de Bordo e na Metodologia de outros indicadores: com
 * eles, não muda.
 */
const GRUPOS_DE_INDICADORES = ["Produção", "Serviços", "Logística", "Técnico", "Comercial", "Administrativo", "Geral", "GME"];
const SENTIDOS: Array<[string, string]> = [["↑", "↑ Maior, melhor"], ["↓", "↓ Menor, melhor"], ["=", "= Acompanhamento"], ["-", "- Sem sentido"]];
// As unidades que as telas sabem mostrar (formatação dos valores). R$ M e R$ K (22/10/2026): o valor em R$ mostrado em
// milhões ou em milhares, com uma casa, como nos cards do Painel de Bordo.
const UNIDADES_DE_INDICADOR: Array<[string, string]> = [
  ["%", "%"],
  ["R$", "R$"],
  ["R$ M", "R$ em Milhões (M)"],
  ["R$ K", "R$ em Milhares (K)"],
  ["R$/m³", "R$/m³"],
  ["R$ (K)/colab.", "R$ (K)/colab."],
  ["m³", "m³"],
  ["m³/colab.", "m³/colab."],
  ["pistas", "pistas"],
  ["colab.", "colab."],
  ["ocorr.", "ocorr."],
];
// FORMULA (23/10/2026): o acumulado de janeiro até o mês por uma fórmula própria (a Fórmula do Acumulado), gravada na
// coluna peso — que nos outros modos é o Peso da Média ou fica vazia —, para não mudar o banco.
const MODOS_DO_ACUMULADO: Array<[string, string]> = [
  ["SOMA", "Soma dos meses"],
  ["MEDIA_PONDERADA", "Média ponderada"],
  ["ULTIMO", "Último mês"],
  ["FORMULA", "Fórmula do acumulado"],
  ["SISTEMA", "Cálculo do sistema"],
];

/** Os centros de custo do item Quadro de Lotação (09/11/2026): os ativos com o código RM, pelo código. */
const centrosDoQuadro = (db: Db) =>
  db.centroCusto.findMany({ where: { ativo: true, codigoRM: { not: null } }, orderBy: { codigoRM: "asc" }, select: { codigoRM: true, nomeRM: true } });

/** Os itens que a fórmula pode usar (as opções do montador): valor "TIPO|chave", grupo pelo tipo do item. */
async function itensDaFormula(db: Db): Promise<Opcao[]> {
  const linhas = await db.linhaDRE.findMany({ where: { tipo: { not: "SECAO" }, ativo: true }, orderBy: { ordem: "asc" }, select: { codigo: true, descricao: true, grupoSigla: true, tipo: true } });
  const indicadores = await db.indicadorEstrutura.findMany({ orderBy: { ordem: "asc" }, select: { nome: true, grupo: true, ativo: true } });
  const nomes = indicadores.map((i) => i.nome);
  const centros = await centrosDoQuadro(db);
  const tiposDeMovimentacao = await db.colaboradorTipoMovimentacao.findMany({ orderBy: [{ ordem: "asc" }, { nome: "asc" }], select: { nome: true } });
  return [
    ...linhas.map((l) => ({ valor: `DRE|${l.codigo}`, rotulo: `${l.grupoSigla} › ${l.descricao}${l.tipo === "ITEM" ? "" : " (total)"}`, grupos: ["DRE"] })),
    ...TOTALIZADORES_DAS_LISTAS.map((t) => ({ valor: `LISTA|${t.codigo}`, rotulo: t.rotulo, grupos: ["LISTA"] })),
    // O "Comercial e Administrativo" saiu do montador em 06/11/2026: as opções ficam só para mostrar os itens já gravados.
    ...INDICADORES_DAS_LISTAS.map((n) => ({ valor: `IND|${n}`, rotulo: n, grupos: ["IND"] })),
    // A marca ACUMULAVEL (23/10/2026): o montador oferece o Período (No Mês ou Acumulado no Ano) nas metas e nos indicadores.
    ...nomes.map((n) => ({ valor: `META|${n}`, rotulo: n, grupos: ["META", "ACUMULAVEL"] })),
    // Os outros indicadores do cadastro (23/10/2026), com o grupo antes, como no Painel de Bordo; o próprio, o cadastro recusa.
    ...indicadores.filter((i) => i.ativo).map((i) => ({ valor: `INDICADOR|${i.nome}`, rotulo: `${i.grupo} › ${i.nome}`, grupos: ["INDICADOR", "ACUMULAVEL"] })),
    // O Quadro de Lotação (09/11/2026): por Departamento (com a Atribuição no montador: Geral, Direto ou Indireto) ou por
    // Centro de Custo. O valor do departamento é "QL|DEP|<código>"; o montador acrescenta a atribuição ao inserir.
    ...DEPARTAMENTOS_DO_QUADRO.map(([codigo, nome]) => ({ valor: `QL|DEP|${codigo}`, rotulo: nome, grupos: ["QL", "QL_DEP"] })),
    ...centros.map((c) => ({ valor: `QL|CC|${c.codigoRM}`, rotulo: `${c.codigoRM} · ${c.nomeRM}`, grupos: ["QL", "QL_CC"] })),
    // Os Movimentos do QL (06/11/2026): as movimentações aprovadas do mês de cada tipo e, desde 09/11/2026, todas as de uma contagem.
    { valor: "MQL|#POSITIVA", rotulo: rotuloDoMovimento("#POSITIVA"), grupos: ["MQL"] },
    { valor: "MQL|#NEGATIVA", rotulo: rotuloDoMovimento("#NEGATIVA"), grupos: ["MQL"] },
    ...tiposDeMovimentacao.map((t) => ({ valor: `MQL|${t.nome}`, rotulo: t.nome, grupos: ["MQL"] })),
    // O Valor Registrado (09/11/2026): o valor do mês com o nome do próprio indicador (importado, digitado ou apurado).
    { valor: "REGISTRADO|", rotulo: ROTULO_DO_REGISTRADO, grupos: ["REGISTRADO"] },
  ];
}

/**
 * Recusa a Metodologia (ou o Peso da Média) que faz um ciclo pelos indicadores que usa (23/10/2026): o indicador que
 * usa, direta ou indiretamente, a si mesmo. `id`: o indicador editado (o gravado dele sai da conta).
 */
async function exigirSemCiclo(db: Db, id: string | null, nome: string, formula: string | null, peso: string | null) {
  const outros = await db.indicadorEstrutura.findMany({ select: { id: true, nome: true, formula: true, peso: true } });
  const usa = new Map(outros.filter((o) => o.id !== id).map((o) => [o.nome, [...indicadoresDaFormula(o.formula), ...indicadoresDaFormula(o.peso)]]));
  usa.set(nome, [...indicadoresDaFormula(formula), ...indicadoresDaFormula(peso)]);
  const vistos = new Set<string>();
  const caminho = (de: string): string[] | null => {
    for (const p of usa.get(de) ?? []) {
      if (p === nome) return [de];
      if (vistos.has(p)) continue;
      vistos.add(p);
      const resto = caminho(p);
      if (resto) return [de, ...resto];
    }
    return null;
  };
  const ciclo = caminho(nome);
  if (ciclo) throw new RegraCadastroError(400, `A Metodologia faz um ciclo entre os indicadores: ${[...ciclo, nome].join(" → ")}.`);
}

/** Valida a fórmula: a escrita e os itens (linhas que existem na DRE, totalizadores, indicadores e metas conhecidos). */
async function validarFormula(db: Db, formula: string, rotulo: string, nomesDoCatalogo: string[]) {
  let compilada: ReturnType<typeof compilarFormula>;
  try {
    compilada = compilarFormula(formula);
  } catch (e) {
    throw new RegraCadastroError(400, `${rotulo}: ${e instanceof FormulaInvalidaError ? e.message : "fórmula inválida."}`);
  }
  const codigos = new Set((await db.linhaDRE.findMany({ select: { codigo: true } })).map((l) => l.codigo));
  const listas = new Set(TOTALIZADORES_DAS_LISTAS.map((t) => t.codigo));
  const indicadores = new Set(INDICADORES_DAS_LISTAS);
  const metas = new Set(nomesDoCatalogo);
  // O Quadro de Lotação e os Movimentos do QL: os centros (pelo código RM) e os tipos de movimentação (ou uma contagem).
  const centros = new Set((await centrosDoQuadro(db)).map((c) => c.codigoRM!));
  const movimentos = new Set([...(await db.colaboradorTipoMovimentacao.findMany({ select: { nome: true } })).map((t) => t.nome), "#POSITIVA", "#NEGATIVA"]);
  for (const i of compilada.itens.values()) {
    const ok =
      i.tipo === "DRE"
        ? codigos.has(i.codigo)
        : i.tipo === "LISTA"
          ? listas.has(i.codigo)
          : i.tipo === "IND"
            ? indicadores.has(i.nome)
            : i.tipo === "QL"
              ? i.chave.startsWith("DEP|") || centros.has(i.chave.slice(3))
              : i.tipo === "MQL"
                ? movimentos.has(i.nome)
                : i.tipo === "REGISTRADO" || ((i.tipo === "META" || i.tipo === "INDICADOR") && metas.has(i.nome));
    if (!ok) {
      const nome = i.tipo === "DRE" || i.tipo === "LISTA" ? i.codigo : i.tipo === "QL" ? rotuloDoQuadro(i.chave) : i.tipo === "REGISTRADO" ? ROTULO_DO_REGISTRADO : i.nome;
      throw new RegraCadastroError(400, `${rotulo}: o item ${nome} não existe.`);
    }
  }
}

/**
 * O indicador como a tela o mostra: a Metodologia por extenso e, no modo FORMULA (23/10/2026), a Fórmula do Acumulado
 * (gravada em peso) no campo dela, com o Peso da Média vazio.
 */
function paraATela<T extends { modo: string; peso: string | null }>(i: T, texto: string | null) {
  const porFormula = i.modo === "FORMULA";
  return {
    ...i,
    peso: porFormula ? null : i.peso,
    formulaAcumulado: porFormula ? i.peso : null,
    metodologiaTexto: i.modo === "SISTEMA" ? "Cálculo do sistema" : (texto ?? ROTULO_DO_REGISTRADO),
  };
}

const estruturaIndicadores: DefinicaoCadastro = {
  entidade: "estrutura-indicadores",
  titulo: "Indicador",
  auditoria: "indicador_estrutura",
  criar: true,
  excluir: true,
  campos: [
    { nome: "ordem", rotulo: "Ordem", tipo: "inteiro" },
    { nome: "grupo", rotulo: "Grupo", tipo: "opcao", obrigatorio: true, opcoes: opcoesFixas(GRUPOS_DE_INDICADORES.map((g) => [g, g])) },
    { nome: "numero", rotulo: "Numeração", rotuloColuna: "Nº", tipo: "texto", ajuda: "Vazia nos indicadores principais do grupo." },
    { nome: "nome", rotulo: "Nome", tipo: "texto", obrigatorio: true, travaComMovimento: true },
    { nome: "sentido", rotulo: "Comportamento", rotuloColuna: "Comp.", tipo: "opcao", obrigatorio: true, opcoes: opcoesFixas(SENTIDOS) },
    { nome: "unidade", rotulo: "Unidade de Medida", rotuloColuna: "Und.", tipo: "opcao", obrigatorio: true, opcoes: opcoesFixas(UNIDADES_DE_INDICADOR) },
    { nome: "descricao", rotulo: "Descrição", tipo: "texto", larguraInteira: true, naTabela: false, ajuda: "O texto que a aba Indicadores do Painel de Bordo mostra sob o nome." },
    {
      nome: "formula",
      rotulo: "Metodologia",
      tipo: "formula",
      larguraInteira: true,
      naTabela: false,
      opcoes: itensDaFormula,
      ajuda: "O item Valor Registrado é o valor do mês com o nome do indicador: importado (Indicadores do Administrativo e do Comercial), digitado nas Listas ou apurado no Quadro de Lotação.",
    },
    { nome: "metodologiaTexto", rotulo: "Metodologia", tipo: "texto", derivado: true, noFormulario: false },
    { nome: "modo", rotulo: "Acumulado", tipo: "opcao", obrigatorio: true, opcoes: opcoesFixas(MODOS_DO_ACUMULADO) },
    { nome: "peso", rotulo: "Peso da Média", tipo: "formula", larguraInteira: true, naTabela: false, visivelSe: { campo: "modo", valores: ["MEDIA_PONDERADA"] }, opcoes: itensDaFormula },
    // A Fórmula do Acumulado (23/10/2026): gravada na coluna peso; a tela a mostra num campo próprio.
    {
      nome: "formulaAcumulado",
      rotulo: "Fórmula do Acumulado",
      tipo: "formula",
      larguraInteira: true,
      naTabela: false,
      visivelSe: { campo: "modo", valores: ["FORMULA"] },
      opcoes: itensDaFormula,
      ajuda: "O acumulado de janeiro até o mês: use os itens com o Período “Acumulado no Ano”.",
    },
    { nome: "ativo", rotulo: "Ativo", tipo: "booleano" },
  ],
  async listar(db, busca) {
    const r = (await db.indicadorEstrutura.findMany({ orderBy: { ordem: "asc" } })).filter((i) => contem(busca, i.grupo, i.nome, i.numero));
    const textos = await formulasPorExtenso(r.map((i) => i.formula));
    return r.map((i, k) => paraATela(i, textos[k]));
  },
  async ler(db, id) {
    const i = await db.indicadorEstrutura.findUnique({ where: { id } });
    if (!i) return null;
    return paraATela(i, (await formulasPorExtenso([i.formula]))[0]);
  },
  async preparar(db, v, id) {
    const nome = exigir(v.nome, "O nome");
    const outro = await db.indicadorEstrutura.findUnique({ where: { nome }, select: { id: true } });
    if (outro && outro.id !== id) throw new RegraCadastroError(409, `Já existe o indicador ${nome}.`);
    const grupo = exigir(v.grupo, "O grupo");
    if (!GRUPOS_DE_INDICADORES.includes(grupo)) throw new RegraCadastroError(400, "Grupo inválido.");
    const sentido = exigir(v.sentido, "O comportamento");
    if (!SENTIDOS.some(([s]) => s === sentido)) throw new RegraCadastroError(400, "Comportamento inválido.");
    const unidade = exigir(v.unidade, "A unidade de medida");
    if (!UNIDADES_DE_INDICADOR.some(([u]) => u === unidade)) throw new RegraCadastroError(400, "Unidade de medida inválida.");
    const modo = exigir(v.modo, "O acumulado");
    if (!MODOS_DO_ACUMULADO.some(([m]) => m === modo)) throw new RegraCadastroError(400, "Acumulado inválido.");
    const nomes = (await db.indicadorEstrutura.findMany({ select: { nome: true } })).map((i) => i.nome).concat(nome);
    let formula = texto(v.formula);
    let peso = texto(v.peso);
    if (modo === "SISTEMA") {
      // Só os que têm a conta no código; a fórmula não vale para eles.
      if (!CALCULOS_SISTEMA[nome]) throw new RegraCadastroError(400, "O cálculo do sistema só vale para os indicadores que já o têm; monte a Metodologia.");
      formula = null;
      peso = null;
    } else {
      // Para o valor registrado no mês com o nome do indicador, o item Valor Registrado (09/11/2026).
      if (!formula) throw new RegraCadastroError(400, "Monte a Metodologia; para o valor registrado no mês com o nome do indicador, use o item Valor Registrado.");
      await validarFormula(db, formula, "Metodologia", nomes);
      if (modo === "MEDIA_PONDERADA") {
        if (!peso) throw new RegraCadastroError(400, "Na média ponderada, monte o Peso da Média.");
        await validarFormula(db, peso, "Peso da Média", nomes);
      } else if (modo === "FORMULA") {
        // A Fórmula do Acumulado vai na coluna do peso (23/10/2026).
        peso = texto(v.formulaAcumulado);
        if (!peso) throw new RegraCadastroError(400, "No acumulado pela fórmula, monte a Fórmula do Acumulado.");
        await validarFormula(db, peso, "Fórmula do Acumulado", nomes);
      } else {
        peso = null;
      }
      await exigirSemCiclo(db, id, nome, formula, peso);
    }
    return {
      ordem: inteiro(v.ordem, "A ordem") ?? undefined,
      grupo,
      numero: texto(v.numero) ?? "",
      nome,
      sentido,
      unidade,
      descricao: texto(v.descricao),
      formula,
      modo,
      peso,
      ativo: v.ativo === undefined ? true : booleano(v.ativo),
    };
  },
  async gravar(db, d, id) {
    const dados = d as Prisma.IndicadorEstruturaUncheckedCreateInput;
    if (id) return (await db.indicadorEstrutura.update({ where: { id }, data: dados })).id;
    return (await db.indicadorEstrutura.create({ data: { ...dados, ordem: dados.ordem ?? (await db.indicadorEstrutura.count()) + 1 } })).id;
  },
  // O nome liga o indicador às metas dos cenários, aos valores importados e digitados e ao Painel de Bordo.
  async movimentos(db, id) {
    const i = await db.indicadorEstrutura.findUnique({ where: { id }, select: { nome: true } });
    if (!i) return null;
    const [metas, digitados, importados] = await Promise.all([
      db.cenarioIndicador.count({ where: { nome: i.nome } }),
      db.indicadorDigitado.count({ where: { nome: i.nome } }),
      db.indicadorImportado.count({ where: { nome: i.nome } }),
    ]);
    // Usado na Metodologia (ou no percentual) de algum item do Painel de Bordo (17/10/2026: o cadastro).
    const noPainel = (await db.painelItem.findMany({ select: { formula: true, percentual: true } })).some(
      (p) => indicadoresDaFormula(p.formula).includes(i.nome) || indicadoresDaFormula(p.percentual).includes(i.nome),
    );
    // Usado na Metodologia (ou no Peso da Média) de outro indicador (23/10/2026).
    const naMetodologia = (await db.indicadorEstrutura.findMany({ where: { id: { not: id } }, select: { formula: true, peso: true } })).filter(
      (o) => indicadoresDaFormula(o.formula).includes(i.nome) || indicadoresDaFormula(o.peso).includes(i.nome),
    ).length;
    if (!metas && !digitados && !importados && !noPainel && !naMetodologia) return null;
    const partes = [
      metas ? `${metas} ${plural(metas, "meta", "metas")} de cenários` : null,
      importados + digitados ? `${importados + digitados} ${plural(importados + digitados, "valor importado ou digitado", "valores importados ou digitados")}` : null,
      noPainel ? "o Painel de Bordo" : null,
      naMetodologia ? `a Metodologia de ${naMetodologia} ${plural(naMetodologia, "outro indicador", "outros indicadores")}` : null,
    ].filter(Boolean);
    return `O indicador é usado por ${partes.join(", ")}.`;
  },
  async impedimentoExclusao(db, id) {
    const m = await this.movimentos!(db, id);
    return m ? `${m} Inative-o em vez de excluir.` : null;
  },
  remover: async (db, id) => void (await db.indicadorEstrutura.delete({ where: { id } })),
};

// ------------------------------------------------------------ regras de rateio
/** As chaves de rateio de cada lista dos Totais (a Expedição e a Montagem não são base de nenhuma). */
const CHAVES_DA_LISTA: Record<string, string[]> = {
  PROJETO: ["PROJETO"],
  PRODUCAO: ["PRODUCAO"],
  PRODUCAO_PISTA: ["PRODUCAO"],
  PRODUCAO_METALURGIA: ["METALURGIA"],
  PRODUCAO_ARMADURA: ["ARMADURA"],
  ACOMPANHAMENTO: ["ACOMPANHAMENTO"],
};
/** A base física pela medida do total. */
const BASE_DA_MEDIDA: Record<string, string> = { "m³": "M3", kg: "KG", und: "PISTA", d: "DIA" };
/** O destino de cada linha dos Totais (11/10/2026): o da unidade ou do serviço que ela mede (as pistas são da Filial). */
const DESTINO_DO_TOTAL: Record<string, string> = {
  PROJETOS_MATRIZ: "MATRIZ",
  PROJETOS_FILIAL: "FILIAL",
  PREFABRICADO_MATRIZ: "MATRIZ",
  PREFABRICADO_FILIAL: "FILIAL",
  PREFABRICADO_PISTAS: "FILIAL",
  METALURGIA_MATRIZ: "MATRIZ",
  METALURGIA_FILIAL: "FILIAL",
  METALURGIA_MONTAGEM: "MONTAGEM",
  METALURGIA_COMPLEMENTAR: "COMPLEMENTAR",
  ARMADURA_MATRIZ: "MATRIZ",
  ARMADURA_FILIAL: "FILIAL",
  ARMADURA_MONTAGEM: "MONTAGEM",
  ARMADURA_COMPLEMENTAR: "COMPLEMENTAR",
  EXPEDICAO_MATRIZ: "MATRIZ",
  EXPEDICAO_FILIAL: "FILIAL",
  MONTAGEM: "MONTAGEM",
  ACOMPANHAMENTO_MONTAGEM: "MONTAGEM",
  ACOMPANHAMENTO_COMPLEMENTAR: "COMPLEMENTAR",
};
/** A unidade que recebe pelo destino (11/10/2026): Matriz, Filial, ou Serviços para a Montagem e a Complementar. */
const UNIDADE_DO_DESTINO: Record<string, number> = { MATRIZ: 1, FILIAL: 2, MONTAGEM: 3, COMPLEMENTAR: 3 };
/** Os totais das Listas (a faixa acima de cada lista), com o rótulo como lá: sem o "(P)" ou "(S)" e com a medida. */
const TOTAIS_DAS_LISTAS = LINHAS_TOTAIS.map((t) => ({
  codigo: t.codigo as string,
  rotulo: `${t.rotulo.replace(/^\([PS]\) /, "")} (${t.medida})`,
  chaves: CHAVES_DA_LISTA[t.tipo] ?? [],
  base: BASE_DA_MEDIDA[t.medida],
  destino: DESTINO_DO_TOTAL[t.codigo],
}));
const totalDaRegra = (v: unknown, chave: string) => {
  const t = TOTAIS_DAS_LISTAS.find((x) => x.codigo === exigir(v, "O destino"));
  if (!t) throw new RegraCadastroError(400, "Escolha o destino na lista (os totais das Listas Operacionais).");
  if (!t.chaves.includes(chave)) throw new RegraCadastroError(400, `O destino ${t.rotulo} não é da chave ${chave}.`);
  return t;
};

const regras: DefinicaoCadastro = {
  entidade: "regras-rateio",
  explicacao: "Rateios com a mesma chave não podem ter vigências sobrepostas. A alteração fica no log de auditoria, com o antes e o depois.",
  titulo: "Regra de rateio",
  auditoria: "regra_rateio",
  criar: true,
  excluir: true,
  // O Rótulo na primeira coluna e a Chave no lugar dele (11/10/2026).
  campos: [
    // O Destino saiu da tela (11/10/2026): é o da Linha dos Totais escolhida.
    { nome: "rotulo", rotulo: "Rótulo", tipo: "texto", obrigatorio: true, larguraInteira: true },
    { nome: "chave", rotulo: "Chave", tipo: "opcao", obrigatorio: true, somenteNaCriacao: true, opcoes: opcoesFixas(BALDES.slice(1, 6)) },
    {
      nome: "origemDoVolume",
      // O campo da linha dos Totais, com o rótulo Destino (11/10/2026): é ela que dá o destino, a unidade e a base física.
      rotulo: "Destino",
      // Uma lista com os totais destacados na faixa das Listas Operacionais, só os da Chave escolhida (11/10/2026).
      tipo: "opcao",
      obrigatorio: true,
      travaComMovimento: true,
      filtradoPor: "chave",
      opcoes: async () => TOTAIS_DAS_LISTAS.map((t) => ({ valor: t.codigo, rotulo: t.rotulo, grupos: t.chaves })),
    },
    { nome: "vigenciaInicio", rotulo: "Vigência: início", rotuloColuna: "Início", tipo: "data", obrigatorio: true },
    { nome: "vigenciaFim", rotulo: "Vigência: fim", rotuloColuna: "Fim", tipo: "data" },
    // O percentual fixo (14/10/2026): só na tabela; grava-se em Percentuais Fixos, com os destinos da chave somando 100%.
    { nome: "percentualFixoTexto", rotulo: "Percentual Fixo", rotuloColuna: "% Fixo", tipo: "texto", derivado: true, noFormulario: false },
  ],
  listar: async (db) =>
    (await db.regraRateio.findMany({ orderBy: [{ ordem: "asc" }, { chave: "asc" }, { vigenciaInicio: "asc" }] })).map((r) => ({
      ...r,
      percentualFixoTexto: r.percentualFixo === null ? null : `${(Number(r.percentualFixo) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`,
    })),
  ler: (db, id) => db.regraRateio.findUnique({ where: { id } }),
  async preparar(db, v, id) {
    const inicio = data(v.vigenciaInicio, "A vigência inicial", true)!;
    const fim = data(v.vigenciaFim, "A vigência final");
    if (fim && fim < inicio) throw new RegraCadastroError(400, "A vigência final é anterior à inicial.");
    const chave = exigir(v.chave, "A chave");
    const total = totalDaRegra(v.origemDoVolume, chave);
    const destino = total.destino;
    const unidade = await db.unidadeNegocio.findUnique({ where: { codigo: UNIDADE_DO_DESTINO[destino] ?? -1 }, select: { id: true } });
    if (!unidade) throw new RegraCadastroError(400, "Destino inválido.");
    // A regra de percentual fixo se edita em Percentuais Fixos, com as outras da chave (14/10/2026).
    if (id && (await db.regraRateio.findUnique({ where: { id }, select: { percentualFixo: true } }))?.percentualFixo != null)
      throw new RegraCadastroError(409, "Esta regra é de percentual fixo: edite-a em “Percentuais Fixos”, com os outros destinos da chave.");
    // Duas regras da mesma chave e do mesmo destino não valem no mesmo mês, e as de um mesmo período da chave são todas
    // por volume ou todas de percentual fixo (14/10/2026).
    const daChave = await db.regraRateio.findMany({ where: { chave: chave as never }, select: { id: true, chave: true, destino: true, vigenciaInicio: true, vigenciaFim: true, percentualFixo: true } });
    const conflito = conflitoDeVigencia(
      { id: id ?? undefined, chave, destino, inicio, fim, fixo: false },
      daChave.map((r) => ({ id: r.id, chave: r.chave, destino: r.destino, inicio: r.vigenciaInicio, fim: r.vigenciaFim, fixo: r.percentualFixo !== null })),
      (c) => NOME_DA_CHAVE[c] ?? c,
    );
    if (conflito) throw new RegraCadastroError(409, conflito);
    return {
      chave,
      destino,
      // A unidade sai do destino e a base física, da medida da linha dos Totais (os campos saíram da tela em 11/10/2026).
      unidadeDestinoId: unidade.id,
      rotulo: exigir(v.rotulo, "O rótulo"),
      baseFisica: total.base,
      origemDoVolume: total.codigo,
      vigenciaInicio: inicio,
      vigenciaFim: fim,
    };
  },
  async gravar(db, d, id) {
    const dados = d as Prisma.RegraRateioUncheckedCreateInput;
    if (id) {
      // A chave não muda; o destino acompanha a Linha dos Totais (que, com apurações, não muda).
      const { chave: _c, ...resto } = dados;
      return (await db.regraRateio.update({ where: { id }, data: resto })).id;
    }
    return (await db.regraRateio.create({ data: { ...dados, ordem: (await db.regraRateio.count()) + 1 } })).id;
  },
  async movimentos(db, id) {
    const n = await db.volumeOperacional.count({ where: { regraRateioId: id } });
    return n ? `A regra já foi usada em ${n} ${plural(n, "apuração", "apurações")} de rateio.` : null;
  },
  async impedimentoExclusao(db, id) {
    const m = await this.movimentos!(db, id);
    return m ? `${m} Encerre a vigência em vez de excluir.` : null;
  },
  remover: async (db, id) => void (await db.regraRateio.delete({ where: { id } })),
};

// --------------------------------------------------------- alocação nas linhas
/**
 * As bases por linha da Alocação nas Linhas (26/10/2026): o volume de cada linha nas listas do mês, com que os Resultados
 * por Linha dividem entre as linhas de uma unidade o que um rateio (ou um centro) leva a ela. O cálculo de cada base fica
 * no código; qual vale para cada rateio ou centro, no cadastro.
 */
export const BASES_DAS_LINHAS: Array<[string, string]> = [
  ["M3_PRODUZIDO", "Volume Produzido (m³)"],
  ["M3_PROJETOS", "Projetos Liberados (m³)"],
  ["KG_METALURGIA", "Metalúrgica: Interna (kg)"],
  ["KG_ARMADURA", "Armadura: Interna (kg)"],
  ["DIAS_ACOMPANHAMENTO", "Dias de Acompanhamento"],
  ["RECEITA", "Receita Bruta"],
];
/** Os rateios que levam custos às unidades: sem o Extra, a RN e a Leben, fora dos resultados por linha. */
const BALDES_DAS_LINHAS = BALDES.filter(([b]) => !["EXTRA", "RN", "LEBEN"].includes(b));
const ORIGENS_DA_ALOCACAO: Array<[string, string]> = [["CENTRO", "Centro de Custo"], ["RATEIO", "Rateio"]];
const DESTINOS_DA_ALOCACAO: Array<[string, string]> = [["LINHA", "Uma Linha (100%)"], ["BASE", "Base por Linha"]];
const SEM_FIM = new Date("9999-12-31T00:00:00Z");
const diaBR = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");

/**
 * A Alocação nas Linhas (26/10/2026, pedido do Adão): as regras com que os Resultados por Linha levam às linhas os custos
 * sem tarefa. A origem é um centro de custo (vários centros podem ir à mesma linha, sem precisar do nome dela) ou um
 * rateio (o balde dos centros sem regra própria); o destino, uma linha com 100% ou uma base por linha. A regra do centro
 * vale antes da do rateio dele. Não entra na apuração da DRE: só divide entre as linhas o que a DRE já deu a cada unidade.
 */
const alocacaoLinhas: DefinicaoCadastro = {
  entidade: "alocacao-linhas",
  titulo: "Alocação nas linhas",
  auditoria: "alocacao_linha",
  criar: true,
  excluir: true,
  explicacao:
    "A regra de um centro vale antes da do rateio dele. Uma Linha leva 100% do que a DRE dá à unidade da linha; uma Base por Linha divide o que a DRE dá a cada unidade entre as linhas dela, pelo volume de cada uma nas listas do mês. Regras da mesma origem não podem ter vigências sobrepostas. A alteração fica no log de auditoria, com o antes e o depois.",
  campos: [
    { nome: "origem", rotulo: "Origem", tipo: "opcao", obrigatorio: true, opcoes: opcoesFixas(ORIGENS_DA_ALOCACAO), ajuda: "Um centro de custo, ou um rateio: os centros dele sem regra própria." },
    {
      nome: "centroCustoId",
      rotulo: "Centro de Custo",
      tipo: "opcao",
      visivelSe: { campo: "origem", valores: ["CENTRO"] },
      opcoes: async (db) =>
        (await db.centroCusto.findMany({ orderBy: [{ codigoRM: "asc" }, { nomeRM: "asc" }], select: { id: true, codigoRM: true, nomeRM: true, nomeControladoria: true, balde: true, ativo: true } })).map((c) => ({
          valor: c.id,
          rotulo: `${c.codigoRM ?? "—"} · ${c.nomeControladoria ?? c.nomeRM}${c.balde ? ` (Rateio ${c.balde})` : ""}${c.ativo ? "" : " (inativo)"}`,
        })),
    },
    { nome: "balde", rotulo: "Rateio", tipo: "opcao", visivelSe: { campo: "origem", valores: ["RATEIO"] }, opcoes: opcoesFixas(BALDES_DAS_LINHAS) },
    { nome: "destino", rotulo: "Destino", tipo: "opcao", obrigatorio: true, opcoes: opcoesFixas(DESTINOS_DA_ALOCACAO) },
    {
      nome: "linhaId",
      rotulo: "Linha",
      tipo: "opcao",
      visivelSe: { campo: "destino", valores: ["LINHA"] },
      opcoes: async (db) =>
        (
          await db.linha.findMany({
            where: { tipo: { in: ["PRODUTO", "OBRA"] } },
            select: { id: true, nome: true, ativo: true, ordem: true, unidadeNegocio: { select: { codigo: true, nome: true } } },
          })
        )
          .sort((a, b) => (a.unidadeNegocio?.codigo ?? 9) - (b.unidadeNegocio?.codigo ?? 9) || a.ordem - b.ordem)
          .map((l) => ({ valor: l.id, rotulo: `${l.nome} (${l.unidadeNegocio?.nome ?? "sem unidade"}${l.ativo ? "" : ", inativa"})` })),
    },
    {
      nome: "base",
      rotulo: "Base",
      tipo: "opcao",
      visivelSe: { campo: "destino", valores: ["BASE"] },
      ajuda: "O volume de cada linha nas listas do mês: a Produção, os Projetos, a Metalúrgica e a Armadura internas (os kg que cada linha consome), os Acompanhamentos ou a Receita Prévia.",
      opcoes: opcoesFixas(BASES_DAS_LINHAS),
    },
    { nome: "vigenciaInicio", rotulo: "Vigência: início", rotuloColuna: "Início", tipo: "data", obrigatorio: true, padrao: `${new Date().getFullYear()}-01-01` },
    { nome: "vigenciaFim", rotulo: "Vigência: fim", rotuloColuna: "Fim", tipo: "data" },
  ],
  async listar(db) {
    const xs = await db.alocacaoLinha.findMany({ include: { centroCusto: { select: { codigoRM: true, nomeRM: true } } }, orderBy: { vigenciaInicio: "asc" } });
    // Os rateios (a regra geral) antes dos centros (as exceções); os rateios na ordem da lista, os centros pelo código.
    const ordemDoBalde = (b: string | null) => BALDES_DAS_LINHAS.findIndex(([x]) => x === b);
    return xs
      .sort(
        (a, b) =>
          (a.origem === "RATEIO" ? 0 : 1) - (b.origem === "RATEIO" ? 0 : 1) ||
          ordemDoBalde(a.balde) - ordemDoBalde(b.balde) ||
          (a.centroCusto?.codigoRM ?? a.centroCusto?.nomeRM ?? "").localeCompare(b.centroCusto?.codigoRM ?? b.centroCusto?.nomeRM ?? ""),
      )
      .map(({ centroCusto: _c, ...x }) => x);
  },
  async ler(db, id) {
    const a = await db.alocacaoLinha.findUnique({ where: { id }, include: { centroCusto: { select: { codigoRM: true, nomeRM: true, nomeControladoria: true } }, linha: { select: { nome: true } } } });
    if (!a) return null;
    const { centroCusto: c, linha: l, ...x } = a;
    // O nome da regra, para a Auditoria: a origem e o destino por extenso.
    const deOnde = c ? `Centro ${c.codigoRM ?? ""} ${c.nomeControladoria ?? c.nomeRM}`.replace(/\s+/g, " ") : `Rateio ${x.balde}`;
    const paraOnde = l ? l.nome : (BASES_DAS_LINHAS.find(([b]) => b === x.base)?.[1] ?? x.base);
    return { ...x, nome: `${deOnde} → ${paraOnde}` };
  },
  async preparar(db, v, id) {
    const origem = exigir(v.origem, "A origem");
    if (!ORIGENS_DA_ALOCACAO.some(([o]) => o === origem)) throw new RegraCadastroError(400, `Origem ${origem} desconhecida.`);
    const destino = exigir(v.destino, "O destino");
    if (!DESTINOS_DA_ALOCACAO.some(([d]) => d === destino)) throw new RegraCadastroError(400, `Destino ${destino} desconhecido.`);
    let centroCustoId: string | null = null;
    let balde: string | null = null;
    let nomeDaOrigem: string;
    if (origem === "CENTRO") {
      const c = await db.centroCusto.findUnique({ where: { id: exigir(v.centroCustoId, "O centro de custo") }, select: { id: true, nomeRM: true, nomeControladoria: true } });
      if (!c) throw new RegraCadastroError(400, "Centro de custo inexistente.");
      centroCustoId = c.id;
      nomeDaOrigem = `O centro ${c.nomeControladoria ?? c.nomeRM}`;
    } else {
      balde = exigir(v.balde, "O rateio");
      if (!BALDES_DAS_LINHAS.some(([b]) => b === balde)) throw new RegraCadastroError(400, `O rateio ${balde} fica fora dos resultados por linha.`);
      nomeDaOrigem = `O rateio ${balde}`;
    }
    let linhaId: string | null = null;
    let base: string | null = null;
    if (destino === "LINHA") {
      const l = await db.linha.findUnique({ where: { id: exigir(v.linhaId, "A linha") }, select: { id: true, nome: true, tipo: true, ativo: true } });
      if (!l || !["PRODUTO", "OBRA"].includes(l.tipo)) throw new RegraCadastroError(400, "Linha inexistente.");
      if (!l.ativo) throw new RegraCadastroError(400, `A linha ${l.nome} está inativa: escolha uma linha ativa.`);
      linhaId = l.id;
    } else {
      base = exigir(v.base, "A base");
      if (!BASES_DAS_LINHAS.some(([b]) => b === base)) throw new RegraCadastroError(400, `Base ${base} desconhecida.`);
    }
    const inicio = data(v.vigenciaInicio, "A vigência inicial", true)!;
    const fim = data(v.vigenciaFim, "A vigência final");
    if (fim && fim < inicio) throw new RegraCadastroError(400, "A vigência final é anterior à inicial.");
    // Uma origem tem uma regra por vez: as vigências da mesma origem não se sobrepõem.
    const daOrigem = await db.alocacaoLinha.findMany({
      where: { id: id ? { not: id } : undefined, ...(centroCustoId ? { centroCustoId } : { origem: "RATEIO", balde: balde as never }) },
      select: { vigenciaInicio: true, vigenciaFim: true },
    });
    const outra = daOrigem.find((x) => x.vigenciaInicio <= (fim ?? SEM_FIM) && (x.vigenciaFim ?? SEM_FIM) >= inicio);
    if (outra) {
      throw new RegraCadastroError(
        409,
        `${nomeDaOrigem} já tem uma regra de ${diaBR(outra.vigenciaInicio)}${outra.vigenciaFim ? ` a ${diaBR(outra.vigenciaFim)}` : ", sem fim"}: preencha o Fim dela antes de criar outra, ou edite-a.`,
      );
    }
    return { origem, centroCustoId, balde, destino, linhaId, base, vigenciaInicio: inicio, vigenciaFim: fim };
  },
  async gravar(db, d, id) {
    const dados = d as Prisma.AlocacaoLinhaUncheckedCreateInput;
    return id ? (await db.alocacaoLinha.update({ where: { id }, data: dados })).id : (await db.alocacaoLinha.create({ data: { ...dados, ordem: (await db.alocacaoLinha.count()) + 1 } })).id;
  },
  remover: async (db, id) => void (await db.alocacaoLinha.delete({ where: { id } })),
};

// --------------------------------------------------------- tipos de movimento
// ------------------------------------------------------------ painel de bordo
const GRUPOS_DO_PAINEL: Array<[string, string]> = [["RESULTADOS", "Resultados"], ["PERFORMANCE", "Performance"]];
const SENTIDOS_DO_PAINEL: Array<[string, string]> = [["↑", "↑ Maior, melhor"], ["↓", "↓ Menor, melhor"]];
const CASAS_DO_PERCENTUAL: Array<[string, string]> = [["1", "1 casa (48,4%)"], ["2", "2 casas (4,84%)"]];

/** Os itens que a Metodologia do painel pode usar: os indicadores ativos da Estrutura dos Indicadores. */
async function indicadoresDoPainel(db: Db): Promise<Opcao[]> {
  const nomes = await db.indicadorEstrutura.findMany({ where: { ativo: true }, orderBy: { ordem: "asc" }, select: { nome: true, grupo: true } });
  return nomes.map((i) => ({ valor: `INDICADOR|${i.nome}`, rotulo: `${i.grupo} › ${i.nome}`, grupos: ["INDICADOR"] }));
}

/** Valida uma fórmula do painel: a escrita e os itens (só indicadores que existem no cadastro). */
async function validarFormulaDoPainel(db: Db, formula: string, rotulo: string) {
  let compilada: ReturnType<typeof compilarFormula>;
  try {
    compilada = compilarFormula(formula);
  } catch (e) {
    throw new RegraCadastroError(400, `${rotulo}: ${e instanceof FormulaInvalidaError ? e.message : "fórmula inválida."}`);
  }
  const nomes = new Set((await db.indicadorEstrutura.findMany({ select: { nome: true } })).map((i) => i.nome));
  for (const i of compilada.itens.values()) {
    if (i.tipo !== "INDICADOR") throw new RegraCadastroError(400, `${rotulo}: use só os indicadores do cadastro Indicadores (Cadastros da Controladoria / Analítico).`);
    // O Acumulado no Ano (23/10/2026) é dos indicadores; o painel já tem o Atual e o Acumulado.
    if (i.acumulado) throw new RegraCadastroError(400, `${rotulo}: o Acumulado no Ano vale só na Metodologia dos Indicadores.`);
    if (!nomes.has(i.nome)) throw new RegraCadastroError(400, `${rotulo}: o indicador “${i.nome}” não está no cadastro Indicadores.`);
  }
}

/** A fórmula do painel por extenso (os indicadores pelo nome). */
function porExtensoNoPainel(formula: string | null) {
  if (!formula) return null;
  try {
    return formulaPorExtenso(formula, (i) => ("nome" in i ? i.nome : "chave" in i ? rotuloDoQuadro(i.chave) : i.tipo === "REGISTRADO" ? ROTULO_DO_REGISTRADO : i.codigo));
  } catch {
    return formula;
  }
}
const comTextos = <T extends { formula: string; casasPercentual: number }>(i: T) => ({ ...i, casasPercentual: String(i.casasPercentual), metodologiaTexto: porExtensoNoPainel(i.formula) });

/**
 * O cadastro do Painel de Bordo (17/10/2026; Analítico / Painel de Bordo): os itens das abas Resultados e Performance —
 * o nome, a abreviação, o comportamento, o grupo (a aba), o quadro, a ordem e a Metodologia (a fórmula sobre os
 * indicadores, montada como a dos Indicadores; antes, um modelo de apuração fixo), com o formato, o percentual sob o
 * valor e o espaço antes. Os Painéis de Bordo (Resultados Empresariais, cenários e os cards dos Relatórios Executivos)
 * leem os itens ativos daqui, na ordem; os quadros seguem a ordem do primeiro item de cada um. Mudar o cadastro com uma
 * competência apurada e ainda aberta pede reapurar, como todos os Cadastros da Controladoria (assinaturaCadastros.ts).
 */
const painelBordo: DefinicaoCadastro = {
  entidade: "painel-bordo",
  titulo: "Item do Painel de Bordo",
  auditoria: "painel_item",
  criar: true,
  excluir: true,
  campos: [
    { nome: "ordem", rotulo: "Ordem", tipo: "inteiro", estreita: true },
    { nome: "grupo", rotulo: "Grupo", tipo: "opcao", obrigatorio: true, opcoes: opcoesFixas(GRUPOS_DO_PAINEL), ajuda: "A aba do Painel de Bordo." },
    { nome: "quadro", rotulo: "Quadro", tipo: "texto", obrigatorio: true, ajuda: "O quadro da aba (Consolidado, Produção: Matriz…): os itens com o mesmo quadro ficam juntos." },
    { nome: "nome", rotulo: "Nome", tipo: "texto", obrigatorio: true },
    { nome: "sigla", rotulo: "Abreviação", rotuloColuna: "Abrev.", tipo: "texto", obrigatorio: true },
    { nome: "sentido", rotulo: "Comportamento", rotuloColuna: "Comp.", tipo: "opcao", obrigatorio: true, opcoes: opcoesFixas(SENTIDOS_DO_PAINEL) },
    {
      nome: "formula",
      rotulo: "Metodologia",
      tipo: "formula",
      obrigatorio: true,
      larguraInteira: true,
      naTabela: false,
      opcoes: indicadoresDoPainel,
      ajuda: "A fórmula sobre os indicadores: com os valores realizados, dá o realizado; com as metas, o orçado.",
    },
    { nome: "metodologiaTexto", rotulo: "Metodologia", tipo: "texto", derivado: true, noFormulario: false },
    {
      nome: "formato",
      rotulo: "Formato",
      tipo: "opcao",
      obrigatorio: true,
      larguraInteira: true,
      ajudaAoLado: true,
      opcoes: opcoesFixas(FORMATOS_DO_PAINEL),
      ajuda: "O mesmo no Atual e no Acumulado. A unidade vai no rótulo do card (Atual (R$ M)…), e não nos valores.",
    },
    {
      nome: "percentual",
      rotulo: "Percentual sob o Valor",
      tipo: "formula",
      larguraInteira: true,
      naTabela: false,
      opcoes: indicadoresDoPainel,
      ajuda: "Opcional: o percentual que aparece sob o realizado, com o rótulo (/RL) — em geral, o item sobre a receita líquida do quadro.",
    },
    { nome: "casasPercentual", rotulo: "Casas do Percentual", tipo: "opcao", naTabela: false, padrao: "1", opcoes: opcoesFixas(CASAS_DO_PERCENTUAL) },
    { nome: "separar", rotulo: "Espaço Antes", tipo: "booleano", naTabela: false, padrao: false, ajuda: "Começa um novo bloco no quadro." },
    { nome: "ativo", rotulo: "Ativo", tipo: "booleano" },
  ],
  async listar(db, busca) {
    const itens = (await db.painelItem.findMany({ orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }] })).map(comTextos);
    return itens.filter((i) => contem(busca, i.grupo, i.quadro, i.nome, i.sigla, i.metodologiaTexto));
  },
  async ler(db, id) {
    const i = await db.painelItem.findUnique({ where: { id } });
    return i ? comTextos(i) : null;
  },
  async preparar(db, v) {
    const grupo = exigir(v.grupo, "O grupo");
    if (!GRUPOS_DO_PAINEL.some(([g]) => g === grupo)) throw new RegraCadastroError(400, "Grupo inválido.");
    const sentido = exigir(v.sentido, "O comportamento");
    if (!SENTIDOS_DO_PAINEL.some(([s]) => s === sentido)) throw new RegraCadastroError(400, "Comportamento inválido.");
    const formula = texto(v.formula);
    if (!formula) throw new RegraCadastroError(400, "Monte a Metodologia (a fórmula do item).");
    await validarFormulaDoPainel(db, formula, "Metodologia");
    const formato = exigir(v.formato, "O formato");
    if (!FORMATOS_DO_PAINEL.some(([x]) => x === formato)) throw new RegraCadastroError(400, "Formato inválido.");
    const percentual = texto(v.percentual);
    if (percentual) await validarFormulaDoPainel(db, percentual, "Percentual sob o Valor");
    const casas = texto(v.casasPercentual) ?? "1";
    if (!CASAS_DO_PERCENTUAL.some(([c]) => c === casas)) throw new RegraCadastroError(400, "Casas do percentual inválidas.");
    return {
      ordem: inteiro(v.ordem, "A ordem") ?? undefined,
      grupo,
      quadro: exigir(v.quadro, "O quadro"),
      nome: exigir(v.nome, "O nome"),
      sigla: exigir(v.sigla, "A abreviação"),
      sentido,
      formula,
      formato,
      // Um formato só (21/10/2026): a coluna do acumulado fica vazia.
      formatoAcumulado: null,
      percentual,
      casasPercentual: Number(casas),
      separar: v.separar === undefined ? false : booleano(v.separar),
      ativo: v.ativo === undefined ? true : booleano(v.ativo),
    };
  },
  async gravar(db, d, id) {
    const dados = d as Prisma.PainelItemUncheckedCreateInput;
    if (id) return (await db.painelItem.update({ where: { id }, data: dados })).id;
    const ultima = await db.painelItem.aggregate({ _max: { ordem: true } });
    return (await db.painelItem.create({ data: { ...dados, ordem: dados.ordem ?? (ultima._max.ordem ?? 0) + 1 } })).id;
  },
  remover: async (db, id) => void (await db.painelItem.delete({ where: { id } })),
};

const tipos: DefinicaoCadastro = {
  entidade: "tipos-movimento",
  titulo: "Tipo de movimento",
  auditoria: "tipo_movimento",
  criar: true,
  excluir: true,
  campos: [
    { nome: "codigo", rotulo: "Código", tipo: "texto", obrigatorio: true, ajuda: "Ex.: 1.2.18." },
    { nome: "descricao", rotulo: "Descrição", tipo: "texto", obrigatorio: true },
    { nome: "retornaEstoque", rotulo: "Devolve a peça ao estoque", tipo: "booleano" },
    { nome: "ativo", rotulo: "Ativo", tipo: "booleano" },
  ],
  listar: async (db, busca) => (await db.tipoMovimento.findMany({ orderBy: { codigo: "asc" } })).filter((t) => contem(busca, t.codigo, t.descricao)),
  ler: (db, id) => db.tipoMovimento.findUnique({ where: { id } }),
  async preparar(db, v, id) {
    const codigo = exigir(v.codigo, "O código");
    const outro = await db.tipoMovimento.findUnique({ where: { codigo }, select: { id: true } });
    if (outro && outro.id !== id) throw new RegraCadastroError(409, `Já existe o tipo de movimento ${codigo}.`);
    return { codigo, descricao: exigir(v.descricao, "A descrição"), retornaEstoque: booleano(v.retornaEstoque), ativo: v.ativo === undefined ? true : booleano(v.ativo) };
  },
  async gravar(db, d, id) {
    const dados = d as Prisma.TipoMovimentoCreateInput;
    return id ? (await db.tipoMovimento.update({ where: { id }, data: dados })).id : (await db.tipoMovimento.create({ data: { ...dados, ordem: (await db.tipoMovimento.count()) + 1 } })).id;
  },
  async impedimentoExclusao(db, id) {
    const [s, d] = await Promise.all([db.saida.count({ where: { tipoMovimentoId: id } }), db.devolucao.count({ where: { tipoMovimentoId: id } })]);
    return s + d ? `O tipo de movimento está em ${s + d} ${plural(s + d, "registro", "registros")} de saídas e devoluções: inative-o em vez de excluir.` : null;
  },
  remover: async (db, id) => void (await db.tipoMovimento.delete({ where: { id } })),
};

// ---------------------------------------------------------------- departamentos
/**
 * Os grupos da DRE que um departamento pode ter (os Departamentos da DRE, 12/11/2026): os grupos com sigla e linhas de
 * item ativas (os do Departamento das Contas de Resultado, sem os volumes de Produção e Serviços, P e S), com as unidades em
 * que as linhas aparecem.
 */
const GRUPOS_DE_VOLUME = new Set(["P", "S"]);
async function gruposDaDRE(db: Db) {
  const ls = await db.linhaDRE.findMany({
    where: { tipo: "ITEM", ativo: true },
    orderBy: { ordem: "asc" },
    select: { grupo: true, grupoSigla: true, unidades: { select: { unidadeNegocio: { select: { id: true } } } } },
  });
  const grupos = new Map<string, { sigla: string; nome: string; unidades: Set<string> }>();
  for (const l of ls) {
    if (!l.grupoSigla || !/\(/.test(l.grupo) || GRUPOS_DE_VOLUME.has(l.grupoSigla)) continue;
    const g = grupos.get(l.grupoSigla) ?? { sigla: l.grupoSigla, nome: l.grupo, unidades: new Set<string>() };
    for (const u of l.unidades) g.unidades.add(u.unidadeNegocio.id);
    grupos.set(l.grupoSigla, g);
  }
  return grupos;
}

/**
 * Os Departamentos (11/11/2026, pedido do Adão; Cadastros da Controladoria / Controladoria): a ordem, a unidade de negócio
 * (a lista do cadastro Unidades), o nome do departamento, único na unidade, e os Departamentos da DRE (12/11/2026: os grupos
 * da DRE do departamento, pela sigla; só os que têm linhas na unidade, e cada grupo num departamento só da unidade). Inativo,
 * o departamento sai das listas.
 */
const departamentosDoCadastro: DefinicaoCadastro = {
  entidade: "departamentos",
  titulo: "Departamento",
  auditoria: "departamento",
  criar: true,
  excluir: true,
  campos: [
    { nome: "ordem", rotulo: "Ordem", tipo: "inteiro", estreita: true },
    {
      nome: "unidadeNegocioId",
      rotulo: "Unidade",
      tipo: "opcao",
      obrigatorio: true,
      opcoes: async (db) => (await db.unidadeNegocio.findMany({ orderBy: { codigo: "asc" } })).map((u) => ({ valor: u.id, rotulo: u.nome })),
      ajuda: "A unidade de negócio (cadastro Unidades).",
    },
    { nome: "nome", rotulo: "Departamento", tipo: "texto", obrigatorio: true },
    {
      nome: "gruposDRE",
      rotulo: "Departamentos da DRE",
      tipo: "multipla",
      naTabela: true,
      opcoes: async (db) => [...(await gruposDaDRE(db)).values()].map((g) => ({ valor: g.sigla, rotulo: g.nome })),
      ajuda: "Os grupos da DRE do departamento, entre os que têm linhas na unidade dele; cada grupo fica num departamento só da unidade.",
    },
    { nome: "ativo", rotulo: "Ativo", tipo: "booleano" },
  ],
  async listar(db, busca) {
    const ds = await db.departamento.findMany({ orderBy: [{ ordem: "asc" }, { nome: "asc" }], include: { unidadeNegocio: { select: { nome: true } } } });
    return ds.filter((d) => contem(busca, d.nome, d.unidadeNegocio.nome, ...d.gruposDRE)).map(({ unidadeNegocio: _u, ...d }) => d);
  },
  ler: (db, id) => db.departamento.findUnique({ where: { id } }),
  async preparar(db, v, id) {
    const nome = exigir(v.nome, "O departamento");
    const unidadeNegocioId = exigir(v.unidadeNegocioId, "A unidade");
    const unidade = await db.unidadeNegocio.findUnique({ where: { id: unidadeNegocioId }, select: { nome: true } });
    if (!unidade) throw new RegraCadastroError(400, "Unidade inválida.");
    const outro = await db.departamento.findUnique({ where: { unidadeNegocioId_nome: { unidadeNegocioId, nome } }, select: { id: true } });
    if (outro && outro.id !== id) throw new RegraCadastroError(409, `Já existe o departamento ${nome} na unidade ${unidade.nome}.`);
    // Os Departamentos da DRE (12/11/2026): grupos que existem, com linhas na unidade, e fora dos outros departamentos ativos dela.
    const gruposDRE = [...new Set(Array.isArray(v.gruposDRE) ? v.gruposDRE.map(String) : [])];
    const grupos = await gruposDaDRE(db);
    for (const s of gruposDRE) {
      const g = grupos.get(s);
      if (!g) throw new RegraCadastroError(400, `O grupo ${s} não está na Estrutura da DRE.`);
      if (!g.unidades.has(unidadeNegocioId)) throw new RegraCadastroError(400, `O grupo ${g.nome} não tem linhas na unidade ${unidade.nome}.`);
    }
    const ativo = v.ativo === undefined ? true : booleano(v.ativo);
    if (ativo && gruposDRE.length) {
      const outros = await db.departamento.findMany({ where: { unidadeNegocioId, ativo: true, ...(id ? { id: { not: id } } : {}) }, select: { nome: true, gruposDRE: true } });
      for (const o of outros) {
        const repetido = gruposDRE.find((s) => o.gruposDRE.includes(s));
        if (repetido) throw new RegraCadastroError(409, `O grupo ${grupos.get(repetido)!.nome} já é do departamento ${o.nome} da unidade ${unidade.nome}.`);
      }
    }
    // Na ordem da DRE.
    const ordemDaDRE = [...grupos.keys()];
    gruposDRE.sort((a, b) => ordemDaDRE.indexOf(a) - ordemDaDRE.indexOf(b));
    return { ordem: inteiro(v.ordem, "A ordem") ?? undefined, unidadeNegocioId, nome, gruposDRE, ativo };
  },
  async gravar(db, d, id) {
    const dados = d as Prisma.DepartamentoUncheckedCreateInput;
    if (id) return (await db.departamento.update({ where: { id }, data: dados })).id;
    return (await db.departamento.create({ data: { ...dados, ordem: dados.ordem ?? (await db.departamento.count()) + 1 } })).id;
  },
  remover: async (db, id) => void (await db.departamento.delete({ where: { id } })),
};

// ---------------------------------------------------------- tabela de estacas
const estacas: DefinicaoCadastro = {
  entidade: "tabela-estacas",
  titulo: "Preço de estaca",
  auditoria: "tabela_estaca",
  criar: true,
  excluir: true,
  campos: [
    { nome: "secao", rotulo: "Seção", tipo: "texto", obrigatorio: true },
    { nome: "grupo", rotulo: "Grupo", tipo: "texto", obrigatorio: true },
    { nome: "peca", rotulo: "Peça", tipo: "texto", obrigatorio: true },
    { nome: "precoUnitario", rotulo: "Preço bruto (m³)", tipo: "decimal", obrigatorio: true, moeda: true },
    { nome: "precoLiquido", rotulo: "Preço líquido (m³)", tipo: "decimal", obrigatorio: true, moeda: true },
    { nome: "vigenciaInicio", rotulo: "Vigência: início", rotuloColuna: "Início", tipo: "data", obrigatorio: true },
    { nome: "vigenciaFim", rotulo: "Vigência: fim", rotuloColuna: "Fim", tipo: "data" },
  ],
  listar: async (db, busca) => (await db.tabelaEstaca.findMany({ orderBy: [{ ordem: "asc" }, { secao: "asc" }] })).filter((t) => contem(busca, t.secao, t.grupo, t.peca)),
  ler: (db, id) => db.tabelaEstaca.findUnique({ where: { id } }),
  async preparar(db, v, id) {
    const inicio = data(v.vigenciaInicio, "A vigência inicial", true)!;
    const fim = data(v.vigenciaFim, "A vigência final");
    if (fim && fim < inicio) throw new RegraCadastroError(400, "A vigência final é anterior à inicial.");
    const secao = exigir(v.secao, "A seção");
    const grupo = exigir(v.grupo, "O grupo");
    const outro = await db.tabelaEstaca.findUnique({ where: { secao_grupo_vigenciaInicio: { secao, grupo, vigenciaInicio: inicio } }, select: { id: true } });
    if (outro && outro.id !== id) throw new RegraCadastroError(409, "Já existe um preço desta seção e deste grupo com a mesma vigência.");
    return { secao, grupo, peca: exigir(v.peca, "A peça"), precoUnitario: decimal(v.precoUnitario, "O preço bruto"), precoLiquido: decimal(v.precoLiquido, "O preço líquido"), vigenciaInicio: inicio, vigenciaFim: fim };
  },
  async gravar(db, d, id) {
    const dados = d as Prisma.TabelaEstacaCreateInput;
    return id ? (await db.tabelaEstaca.update({ where: { id }, data: dados })).id : (await db.tabelaEstaca.create({ data: { ...dados, ordem: (await db.tabelaEstaca.count()) + 1 } })).id;
  },
  // A receita guarda o preço usado em cada item: a tabela não é referenciada.
  remover: async (db, id) => void (await db.tabelaEstaca.delete({ where: { id } })),
};

export const DEFINICOES: Record<string, DefinicaoCadastro> = Object.fromEntries(
  // Os cadastros da Gestão de Colaboradores (06/11/2026), no arquivo deles.
  [centros, contas, reclassificacoes, estrutura, unidades, linhas, estruturaIndicadores, painelBordo, regras, alocacaoLinhas, departamentosDoCadastro, tipos, estacas, ...DEFINICOES_COLABORADORES].map((d) => [
    d.entidade,
    d,
  ]),
);

/** Para a tela e para o log: Decimal e Date viram texto. */
export function apresentar(v: Valores | null) {
  if (!v) return null;
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x instanceof Date ? dia(x) : Decimal.isDecimal(x) ? (x as Prisma.Decimal).toString() : x]));
}
