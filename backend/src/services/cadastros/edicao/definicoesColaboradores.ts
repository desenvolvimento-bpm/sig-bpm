import type { Prisma } from "../../../generated/prisma/client.js";
import { plural } from "../../../utils/plural.js";
import type { DefinicaoCadastro, Opcao, Valores } from "./definicoesCadastros.js";
import { RegraCadastroError } from "./erroCadastro.js";

/**
 * Os cadastros da Gestão de Colaboradores (06/11/2026, pedido do Adão; a tela Cadastros dos Processos Administrativos), na
 * edição genérica dos cadastros: Senioridades, Funções, Movimentações (os tipos de movimentação do Quadro de Lotação),
 * Classificações (as de cada tipo) e o Lançamento Inicial (o quadro de lotação do início de um mês, um registro por
 * colaborador). A lista leva `emUso` em cada registro — o motivo de não poder ser excluído, ou nulo —, para a tela deixar o
 * Excluir do menu Ações só nos que não têm registros em outras telas; esses se inativam.
 */

type Db = Parameters<DefinicaoCadastro["listar"]>[0];

const texto = (v: unknown) => (v === undefined || v === null ? null : String(v).trim() || null);
const exigir = (v: unknown, rotulo: string) => {
  const t = texto(v);
  if (!t) throw new RegraCadastroError(400, `${rotulo} é obrigatório.`);
  return t;
};
const booleano = (v: unknown) => v === true || v === "true" || v === 1 || v === "1";
const ativoDe = (v: Valores) => (v.ativo === undefined ? true : booleano(v.ativo));
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const contem = (busca: string | undefined, ...campos: Array<string | null | undefined>) =>
  !busca || campos.some((c) => c && semAcento(c).includes(semAcento(busca)));
/** O nome sem repetir outro registro (sem diferença de maiúsculas); a mensagem cita o nome como está no cadastro. */
async function nomeLivre(achar: () => Promise<{ id: string; nome: string } | null>, id: string | null, mensagem: (nome: string) => string) {
  const outro = await achar();
  if (outro && outro.id !== id) throw new RegraCadastroError(409, mensagem(outro.nome));
}
/** A lista com o motivo de não excluir cada registro (`emUso`). */
async function comUso<T extends { id: string }>(itens: T[], uso: (id: string) => Promise<string | null>) {
  return Promise.all(itens.map(async (i) => ({ ...i, emUso: await uso(i.id) })));
}
const inativo = (ativo: boolean) => (ativo ? "" : " (inativa)");
/** "A, B e C". */
const emLista = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}` : (xs[0] ?? ""));
/** Os usos no Lançamento Inicial e nas movimentações do Quadro de Lotação, em texto. */
const usosNoQuadro = (carga: number, movimentacoes: number, cenarios = 0) =>
  [
    carga ? `${carga} ${plural(carga, "colaborador", "colaboradores")} do Lançamento Inicial` : "",
    movimentacoes ? `${movimentacoes} ${plural(movimentacoes, "movimentação", "movimentações")} do Quadro de Lotação` : "",
    // A aba Quadro de Lotação dos cenários analíticos (09/11/2026).
    cenarios ? `${cenarios} ${plural(cenarios, "linha", "linhas")} do Quadro de Lotação dos cenários analíticos` : "",
  ].filter(Boolean);

export const ROTULO_CONTAGEM: Record<string, string> = { POSITIVA: "Positiva", NEGATIVA: "Negativa", NULA: "Nula" };
export const ROTULO_APROVACAO: Record<string, string> = { AUTOMATICA: "Automática", MANUAL: "Manual" };
const opcoesDe = (rotulos: Record<string, string>): Opcao[] => Object.entries(rotulos).map(([valor, rotulo]) => ({ valor, rotulo }));

const opcoesSenioridades = async (db: Db) =>
  (await db.colaboradorSenioridade.findMany({ orderBy: { nome: "asc" } })).map((s) => ({ valor: s.id, rotulo: `${s.nome}${inativo(s.ativo)}` }));
const opcoesFuncoes = async (db: Db) => (await db.colaboradorFuncao.findMany({ orderBy: { nome: "asc" } })).map((f) => ({ valor: f.id, rotulo: `${f.nome}${inativo(f.ativo)}` }));
const opcoesTipos = async (db: Db) =>
  (await db.colaboradorTipoMovimentacao.findMany({ orderBy: [{ ordem: "asc" }, { nome: "asc" }] })).map((t) => ({ valor: t.id, rotulo: `${t.nome}${inativo(t.ativo)}` }));
const opcoesUnidades = async (db: Db) => (await db.unidadeNegocio.findMany({ orderBy: { codigo: "asc" } })).map((u) => ({ valor: u.id, rotulo: u.nome }));
const opcoesCentros = async (db: Db) =>
  (await db.centroCusto.findMany({ orderBy: [{ codigoRM: "asc" }, { nomeRM: "asc" }], select: { id: true, codigoRM: true, nomeRM: true, ativo: true } })).map((c) => ({
    valor: c.id,
    rotulo: `${c.codigoRM ? `${c.codigoRM} · ` : ""}${c.nomeRM}${c.ativo ? "" : " (inativo)"}`,
  }));

// ------------------------------------------------------------------------------------------------------- senioridades
const senioridades: DefinicaoCadastro = {
  entidade: "colaboradores-senioridades",
  titulo: "Senioridade",
  auditoria: "colaborador_senioridade",
  criar: true,
  excluir: true,
  campos: [
    { nome: "nome", rotulo: "Nome", tipo: "texto", obrigatorio: true, ajuda: "Ex.: Aprendiz, Júnior, Pleno, Sênior." },
    { nome: "descricao", rotulo: "Descrição", tipo: "texto", larguraInteira: true },
    { nome: "ativo", rotulo: "Ativa", tipo: "booleano" },
  ],
  listar: async (db, busca) =>
    comUso(
      (await db.colaboradorSenioridade.findMany({ orderBy: { nome: "asc" } })).filter((s) => contem(busca, s.nome, s.descricao)),
      (id) => senioridades.impedimentoExclusao!(db, id),
    ),
  ler: (db, id) => db.colaboradorSenioridade.findUnique({ where: { id } }),
  async preparar(db, v, id) {
    const nome = exigir(v.nome, "O nome");
    await nomeLivre(() => db.colaboradorSenioridade.findFirst({ where: { nome: { equals: nome, mode: "insensitive" } }, select: { id: true, nome: true } }), id, (n) => `Já existe a senioridade ${n}.`);
    return { nome, descricao: texto(v.descricao), ativo: ativoDe(v) };
  },
  async gravar(db, d, id) {
    const dados = d as Prisma.ColaboradorSenioridadeCreateInput;
    return id ? (await db.colaboradorSenioridade.update({ where: { id }, data: dados })).id : (await db.colaboradorSenioridade.create({ data: dados })).id;
  },
  async impedimentoExclusao(db, id) {
    const [f, c, m, l] = await Promise.all([
      db.colaboradorFuncao.count({ where: { senioridadeId: id } }),
      db.colaboradorCargaInicial.count({ where: { senioridadeId: id } }),
      db.colaboradorMovimentacao.count({ where: { senioridadeId: id } }),
      db.cenarioLotacao.count({ where: { senioridadeId: id } }),
    ]);
    const usos = [f ? `${f} ${plural(f, "função", "funções")}` : "", ...usosNoQuadro(c, m, l)].filter(Boolean);
    return usos.length ? `A senioridade está em ${emLista(usos)}: inative-a em vez de excluir.` : null;
  },
  remover: async (db, id) => void (await db.colaboradorSenioridade.delete({ where: { id } })),
};

// ------------------------------------------------------------------------------------------------------------ funções
const funcoes: DefinicaoCadastro = {
  entidade: "colaboradores-funcoes",
  titulo: "Função",
  auditoria: "colaborador_funcao",
  criar: true,
  excluir: true,
  campos: [
    { nome: "nome", rotulo: "Função", tipo: "texto", obrigatorio: true },
    { nome: "senioridadeId", rotulo: "Nível", tipo: "opcao", opcoes: opcoesSenioridades, ajuda: "A senioridade da função (aba Senioridades)." },
    { nome: "descricao", rotulo: "Descrição", tipo: "texto", larguraInteira: true },
    { nome: "competencias", rotulo: "Competências", tipo: "texto", multilinha: true, larguraInteira: true, naTabela: false },
    { nome: "atividades", rotulo: "Atividades", tipo: "texto", multilinha: true, larguraInteira: true, naTabela: false },
    { nome: "ativo", rotulo: "Ativa", tipo: "booleano" },
  ],
  listar: async (db, busca) =>
    comUso(
      (await db.colaboradorFuncao.findMany({ orderBy: { nome: "asc" } })).filter((f) => contem(busca, f.nome, f.descricao)),
      (id) => funcoes.impedimentoExclusao!(db, id),
    ),
  ler: (db, id) => db.colaboradorFuncao.findUnique({ where: { id } }),
  async preparar(db, v, id) {
    const nome = exigir(v.nome, "A função");
    await nomeLivre(() => db.colaboradorFuncao.findFirst({ where: { nome: { equals: nome, mode: "insensitive" } }, select: { id: true, nome: true } }), id, (n) => `Já existe a função ${n}.`);
    const senioridadeId = texto(v.senioridadeId);
    if (senioridadeId && !(await db.colaboradorSenioridade.findUnique({ where: { id: senioridadeId }, select: { id: true } }))) throw new RegraCadastroError(400, "Nível inexistente.");
    return { nome, descricao: texto(v.descricao), senioridadeId, competencias: texto(v.competencias), atividades: texto(v.atividades), ativo: ativoDe(v) };
  },
  async gravar(db, d, id) {
    const dados = d as Prisma.ColaboradorFuncaoUncheckedCreateInput;
    return id ? (await db.colaboradorFuncao.update({ where: { id }, data: dados })).id : (await db.colaboradorFuncao.create({ data: dados })).id;
  },
  async impedimentoExclusao(db, id) {
    const [c, m, l] = await Promise.all([
      db.colaboradorCargaInicial.count({ where: { funcaoId: id } }),
      db.colaboradorMovimentacao.count({ where: { funcaoId: id } }),
      db.cenarioLotacao.count({ where: { funcaoId: id } }),
    ]);
    const usos = usosNoQuadro(c, m, l);
    return usos.length ? `A função está em ${emLista(usos)}: inative-a em vez de excluir.` : null;
  },
  remover: async (db, id) => void (await db.colaboradorFuncao.delete({ where: { id } })),
};

// ------------------------------------------------------------------------------- movimentações (tipos de movimentação)
const movimentacoes: DefinicaoCadastro = {
  entidade: "colaboradores-movimentacoes",
  titulo: "Movimentação",
  auditoria: "colaborador_tipo_movimentacao",
  criar: true,
  excluir: true,
  explicacao:
    "A Contagem diz como a movimentação mexe no Quadro de Lotação: Positiva soma um colaborador, Negativa subtrai um, Nula não muda o quadro (as vagas). " +
    "Na aprovação Automática, a movimentação vale ao ser registrada; na Manual, fica Pendente até o gestor do centro de custo aprová-la ou recusá-la.",
  campos: [
    { nome: "nome", rotulo: "Movimentação", tipo: "texto", obrigatorio: true, ajuda: "Ex.: Admissão, Reposição, Desligamento, Abertura de Vaga." },
    { nome: "descricao", rotulo: "Descrição", tipo: "texto", larguraInteira: true },
    { nome: "contagem", rotulo: "Tipo de Contagem", rotuloColuna: "Contagem", tipo: "opcao", obrigatorio: true, opcoes: async () => opcoesDe(ROTULO_CONTAGEM) },
    { nome: "aprovacao", rotulo: "Modelo de Aprovação", rotuloColuna: "Aprovação", tipo: "opcao", obrigatorio: true, opcoes: async () => opcoesDe(ROTULO_APROVACAO) },
    { nome: "ativo", rotulo: "Ativa", tipo: "booleano" },
  ],
  listar: async (db, busca) =>
    comUso(
      (await db.colaboradorTipoMovimentacao.findMany({ orderBy: [{ ordem: "asc" }, { nome: "asc" }] })).filter((t) => contem(busca, t.nome, t.descricao)),
      (id) => movimentacoes.impedimentoExclusao!(db, id),
    ),
  ler: (db, id) => db.colaboradorTipoMovimentacao.findUnique({ where: { id } }),
  async preparar(db, v, id) {
    const nome = exigir(v.nome, "A movimentação");
    await nomeLivre(() => db.colaboradorTipoMovimentacao.findFirst({ where: { nome: { equals: nome, mode: "insensitive" } }, select: { id: true, nome: true } }), id, (n) => `Já existe a movimentação ${n}.`);
    const contagem = exigir(v.contagem, "O tipo de contagem");
    const aprovacao = exigir(v.aprovacao, "O modelo de aprovação");
    if (!(contagem in ROTULO_CONTAGEM)) throw new RegraCadastroError(400, "Tipo de contagem inválido.");
    if (!(aprovacao in ROTULO_APROVACAO)) throw new RegraCadastroError(400, "Modelo de aprovação inválido.");
    return { nome, descricao: texto(v.descricao), contagem, aprovacao, ativo: ativoDe(v) };
  },
  async gravar(db, d, id) {
    const dados = d as Prisma.ColaboradorTipoMovimentacaoCreateInput;
    return id
      ? (await db.colaboradorTipoMovimentacao.update({ where: { id }, data: dados })).id
      : (await db.colaboradorTipoMovimentacao.create({ data: { ...dados, ordem: (await db.colaboradorTipoMovimentacao.count()) + 1 } })).id;
  },
  async impedimentoExclusao(db, id) {
    const [c, m] = await Promise.all([db.colaboradorClassificacao.count({ where: { tipoMovimentacaoId: id } }), db.colaboradorMovimentacao.count({ where: { tipoMovimentacaoId: id } })]);
    const usos = [c ? `${c} ${plural(c, "classificação", "classificações")}` : "", m ? `${m} ${plural(m, "registro", "registros")} do Quadro de Lotação` : ""].filter(Boolean);
    return usos.length ? `A movimentação tem ${emLista(usos)}: inative-a em vez de excluir.` : null;
  },
  remover: async (db, id) => void (await db.colaboradorTipoMovimentacao.delete({ where: { id } })),
};

// ----------------------------------------------------------------------------------------------------- classificações
const classificacoes: DefinicaoCadastro = {
  entidade: "colaboradores-classificacoes",
  titulo: "Classificação",
  auditoria: "colaborador_classificacao",
  criar: true,
  excluir: true,
  campos: [
    { nome: "tipoMovimentacaoId", rotulo: "Movimentação", tipo: "opcao", obrigatorio: true, opcoes: opcoesTipos },
    { nome: "nome", rotulo: "Classificação", tipo: "texto", obrigatorio: true },
    { nome: "descricao", rotulo: "Descrição", tipo: "texto", larguraInteira: true },
    { nome: "ativo", rotulo: "Ativa", tipo: "booleano" },
  ],
  listar: async (db, busca) =>
    comUso(
      (await db.colaboradorClassificacao.findMany({ orderBy: [{ tipoMovimentacao: { ordem: "asc" } }, { nome: "asc" }], include: { tipoMovimentacao: { select: { nome: true } } } }))
        .filter((c) => contem(busca, c.nome, c.descricao, c.tipoMovimentacao.nome))
        .map(({ tipoMovimentacao: _t, ...c }) => c),
      (id) => classificacoes.impedimentoExclusao!(db, id),
    ),
  ler: (db, id) => db.colaboradorClassificacao.findUnique({ where: { id } }),
  async preparar(db, v, id) {
    const tipoMovimentacaoId = exigir(v.tipoMovimentacaoId, "A movimentação");
    const tipo = await db.colaboradorTipoMovimentacao.findUnique({ where: { id: tipoMovimentacaoId }, select: { nome: true } });
    if (!tipo) throw new RegraCadastroError(400, "Movimentação inexistente.");
    const nome = exigir(v.nome, "A classificação");
    await nomeLivre(
      () => db.colaboradorClassificacao.findFirst({ where: { tipoMovimentacaoId, nome: { equals: nome, mode: "insensitive" } }, select: { id: true, nome: true } }),
      id,
      (n) => `Já existe a classificação ${n} em ${tipo.nome}.`,
    );
    return { tipoMovimentacaoId, nome, descricao: texto(v.descricao), ativo: ativoDe(v) };
  },
  async gravar(db, d, id) {
    const dados = d as Prisma.ColaboradorClassificacaoUncheckedCreateInput;
    return id ? (await db.colaboradorClassificacao.update({ where: { id }, data: dados })).id : (await db.colaboradorClassificacao.create({ data: dados })).id;
  },
  async impedimentoExclusao(db, id) {
    const m = await db.colaboradorMovimentacao.count({ where: { classificacaoId: id } });
    return m ? `A classificação está em ${m} ${plural(m, "movimentação", "movimentações")} do Quadro de Lotação: inative-a em vez de excluir.` : null;
  },
  remover: async (db, id) => void (await db.colaboradorClassificacao.delete({ where: { id } })),
};

// ------------------------------------------------------------------------------------------------- lançamento inicial
export const ROTULO_VINCULO: Record<string, string> = { CLT: "CLT", PJ: "PJ" };
const mesAno = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;

/** A competência do Lançamento Inicial em vigor (todos os registros são do mesmo mês), ou nula sem nenhum. */
export async function competenciaDaCarga(db: Db) {
  const c = await db.colaboradorCargaInicial.findFirst({ select: { ano: true, mes: true } });
  return c ? { ano: c.ano, mes: c.mes } : null;
}

const lancamentoInicial: DefinicaoCadastro = {
  entidade: "colaboradores-lancamento-inicial",
  titulo: "Colaborador do Lançamento Inicial",
  auditoria: "colaborador_carga_inicial",
  criar: true,
  excluir: true,
  explicacao: "Um colaborador do quadro de lotação do início da competência do Lançamento Inicial. Para trocar a competência, importe a planilha de novo.",
  campos: [
    { nome: "competencia", rotulo: "Competência", tipo: "texto", derivado: true, noFormulario: false, estreita: true },
    { nome: "unidadeNegocioId", rotulo: "Unidade", tipo: "opcao", obrigatorio: true, opcoes: opcoesUnidades },
    { nome: "vinculo", rotulo: "Tipo", tipo: "opcao", obrigatorio: true, opcoes: async () => opcoesDe(ROTULO_VINCULO) },
    { nome: "senioridadeId", rotulo: "Senioridade", tipo: "opcao", obrigatorio: true, opcoes: opcoesSenioridades },
    { nome: "funcaoId", rotulo: "Função", tipo: "opcao", obrigatorio: true, opcoes: opcoesFuncoes },
    { nome: "centroCustoId", rotulo: "Centro de Custo", tipo: "opcao", obrigatorio: true, larguraInteira: true, opcoes: opcoesCentros },
  ],
  async listar(db, busca) {
    const itens = await db.colaboradorCargaInicial.findMany({
      orderBy: [{ centroCusto: { codigoRM: "asc" } }, { funcao: { nome: "asc" } }, { linhaArquivo: "asc" }],
      include: { funcao: { select: { nome: true } }, centroCusto: { select: { codigoRM: true, nomeRM: true } }, senioridade: { select: { nome: true } } },
    });
    return itens
      .filter((i) => contem(busca, i.funcao.nome, i.centroCusto.nomeRM, i.centroCusto.codigoRM, i.senioridade.nome))
      .map(({ funcao: _f, centroCusto: _c, senioridade: _s, ...i }) => ({ ...i, competencia: mesAno(i.ano, i.mes), emUso: null }));
  },
  ler: async (db, id) => {
    const i = await db.colaboradorCargaInicial.findUnique({ where: { id } });
    return i ? { ...i, competencia: mesAno(i.ano, i.mes) } : null;
  },
  async preparar(db, v, id) {
    const atual = id ? await db.colaboradorCargaInicial.findUnique({ where: { id }, select: { ano: true, mes: true } }) : await competenciaDaCarga(db);
    if (!atual) throw new RegraCadastroError(409, "Importe primeiro o Lançamento Inicial: a importação pede a competência do quadro.");
    const vinculo = exigir(v.vinculo, "O tipo");
    if (!(vinculo in ROTULO_VINCULO)) throw new RegraCadastroError(400, "Tipo inválido: CLT ou PJ.");
    const unidadeNegocioId = exigir(v.unidadeNegocioId, "A unidade");
    const senioridadeId = exigir(v.senioridadeId, "A senioridade");
    const funcaoId = exigir(v.funcaoId, "A função");
    const centroCustoId = exigir(v.centroCustoId, "O centro de custo");
    const [u, s, f, c] = await Promise.all([
      db.unidadeNegocio.findUnique({ where: { id: unidadeNegocioId }, select: { id: true } }),
      db.colaboradorSenioridade.findUnique({ where: { id: senioridadeId }, select: { id: true } }),
      db.colaboradorFuncao.findUnique({ where: { id: funcaoId }, select: { id: true } }),
      db.centroCusto.findUnique({ where: { id: centroCustoId }, select: { id: true } }),
    ]);
    if (!u || !s || !f || !c) throw new RegraCadastroError(400, "Unidade, senioridade, função ou centro de custo inexistente.");
    return { ano: atual.ano, mes: atual.mes, unidadeNegocioId, vinculo, senioridadeId, funcaoId, centroCustoId };
  },
  async gravar(db, d, id) {
    const dados = d as Prisma.ColaboradorCargaInicialUncheckedCreateInput;
    return id ? (await db.colaboradorCargaInicial.update({ where: { id }, data: dados })).id : (await db.colaboradorCargaInicial.create({ data: dados })).id;
  },
  remover: async (db, id) => void (await db.colaboradorCargaInicial.delete({ where: { id } })),
};

export const DEFINICOES_COLABORADORES: DefinicaoCadastro[] = [senioridades, funcoes, movimentacoes, classificacoes, lancamentoInicial];
