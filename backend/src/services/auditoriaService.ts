import { env } from "../config/env.js";
import { getPrismaClient, prisma } from "../config/prisma.js";
import { Prisma } from "../generated/prisma/client.js";

/**
 * Log de auditoria (Passo 23, RF011): quem fez o quê, quando, em qual registro,
 * com o estado antes e depois. É a tabela `audit_log` — o LogAuditoria do SPEC
 * (registroId = entidadeId, valorAnterior = dadosAntes, valorNovo =
 * dadosDepois, ocorridoEm = createdAt).
 *
 * Imutável: não há rota que altere ou apague registro, e gatilhos no banco
 * recusam UPDATE e DELETE na tabela. Uma falha ao auditar não desfaz a
 * operação já feita (Docs/seguranca/AUDITORIA-LOGS.md): vira log técnico.
 * Nunca se grava senha nem token.
 */

export type EventoAuditoria = {
  usuarioId: string | null;
  /** Se ausente, é lido do cadastro do usuário. */
  usuarioNome?: string | null;
  acao: string;
  entidade: string;
  entidadeId?: string | null;
  antes?: unknown;
  depois?: unknown;
  metadados?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  /** Quando aconteceu (24/10/2026: a gravação em sequência entra no log depois); se ausente, agora. */
  quando?: Date;
};

/** Ações registradas, com o rótulo da tela de consulta. */
export const ROTULO_ACAO: Record<string, string> = {
  ACESSO: "Acesso a tela",
  LOGIN: "Entrada no sistema",
  LOGIN_FALHA: "Tentativa de entrada recusada",
  TROCA_SENHA: "Troca da própria senha",
  CRIACAO: "Criação",
  ALTERACAO: "Alteração",
  EXCLUSAO: "Exclusão",
  REDEFINICAO_SENHA: "Senha redefinida",
  ABERTURA: "Abertura da competência",
  APURACAO: "Apuração da competência",
  APURACAO_PARCIAL: "Apuração de uma parte (avulsa)",
  FECHAMENTO: "Fechamento da competência",
  REABERTURA: "Reabertura da competência",
  IMPORTACAO: "Importação de arquivo",
  RECARGA_CADASTROS: "Recarga dos cadastros pela planilha",
  RECLASSIFICACAO: "Reclassificação dos lançamentos",
  COPIA_MES_ANTERIOR: "Cópia do mês anterior",
  JUSTIFICATIVA: "Divergência justificada",
  RESOLUCAO: "Divergência resolvida",
  EXPORTACAO: "Exportação da DRE",
  CONFERENCIA_PLANILHA: "Planilha enviada para conferência",
  // Os Relatórios Executivos (23/10/2026): a gravação, a finalização e a reabertura de um grupo.
  GRAVACAO_RE: "Gravação do grupo",
  FINALIZACAO_RE: "Finalização do grupo",
  REABERTURA_RE: "Reabertura do grupo",
  // Os Painéis de Bordo (31/10/2026): a gravação das páginas do painel; a finalização e a reabertura (01/11/2026).
  GRAVACAO_PAINEL: "Gravação do painel",
  FINALIZACAO_PAINEL: "Finalização do painel",
  REABERTURA_PAINEL: "Reabertura do painel",
  // O Compartilhar dos painéis (01/11/2026): os editores convidados e os removidos.
  COMPARTILHAMENTO_PAINEL: "Compartilhamento do painel",
  REMOCAO_EDITOR_PAINEL: "Remoção de editor do painel",
  // A Biblioteca de APIs (24/10/2026): o token emitido e os pedidos às APIs, atendidos ou recusados.
  TOKEN_API: "Token da API emitido",
  ACESSO_API: "Acesso pela API",
  ACESSO_API_NEGADO: "Acesso pela API recusado",
  // O Quadro de Lotação (06/11/2026): a decisão sobre uma movimentação de aprovação manual.
  APROVACAO: "Aprovação de movimentação",
  REPROVACAO: "Reprovação de movimentação",
};

/** Entidades registradas, com o rótulo da tela de consulta. */
export const ROTULO_ENTIDADE: Record<string, string> = {
  tela: "Tela",
  usuario: "Usuário",
  perfil: "Perfil",
  competencia: "Competência",
  importacao: "Importação",
  cadastros: "Cadastros",
  classificacao: "Classificação",
  lancamento_manual: "Lançamento manual",
  lancamento_receita: "Lançamento de receita",
  lista_operacional: "Lista operacional",
  divergencia: "Divergência",
  cenario: "Cenário",
  cenario_lotacao: "Quadro de Lotação do cenário",
  centro_custo: "Centro de custo",
  conta_resultado: "Conta de resultado",
  reclassificacao: "Reclassificação de conta",
  reclassificacao_fornecedor: "Reclassificação por fornecedor",
  redistribuicao_gasto: "Redistribuição de gastos",
  linha_dre: "Linha da DRE",
  unidade_negocio: "Unidade de negócio",
  regra_rateio: "Regra de rateio",
  alocacao_linha: "Alocação nas linhas",
  tipo_movimento: "Tipo de movimento",
  tabela_estaca: "Tabela de estacas",
  relatorio_executivo: "Relatório Executivo",
  painel_de_bordo: "Painel de Bordo",
  api: "APIs",
  api_bloqueio: "Bloqueio nas APIs",
  contestacao: "Contestação de gasto",
  arquivo_geral: "Arquivo Geral",
  // A Gestão de Colaboradores (06/11/2026): os cadastros e o Lançamento Inicial.
  colaborador_senioridade: "Senioridade",
  colaborador_funcao: "Função",
  colaborador_tipo_movimentacao: "Tipo de movimentação",
  colaborador_classificacao: "Classificação de movimentação",
  colaborador_carga_inicial: "Lançamento Inicial",
  colaborador_competencia: "Competência do Quadro de Lotação",
  colaborador_movimentacao: "Movimentação do Quadro de Lotação",
  colaborador_jornada: "Jornada do Quadro de Lotação",
};

/** Deixa o JSON gravável: Decimal e Date viram texto, undefined some. */
const json = (x: unknown) => (x === undefined || x === null ? Prisma.DbNull : (JSON.parse(JSON.stringify(x)) as Prisma.InputJsonValue));

export async function auditar(e: EventoAuditoria) {
  if (!env.enableAudit) return;
  try {
    const db = getPrismaClient();
    let nome = e.usuarioNome ?? null;
    if (!nome && e.usuarioId) nome = (await db.usuario.findUnique({ where: { id: e.usuarioId }, select: { nome: true } }))?.nome ?? null;
    await db.auditLog.create({
      data: {
        acao: e.acao,
        entidade: e.entidade,
        entidadeId: e.entidadeId ?? null,
        usuarioId: e.usuarioId,
        usuarioNome: nome,
        ip: e.ip ?? null,
        userAgent: e.userAgent ?? null,
        dadosAntes: json(e.antes),
        dadosDepois: json(e.depois),
        metadados: json(e.metadados),
        ...(e.quando ? { createdAt: e.quando } : {}),
      },
    });
  } catch (error) {
    console.error("[AUDIT] Falha ao registrar", {
      message: error instanceof Error ? error.message : "erro desconhecido",
      acao: e.acao,
      entidade: e.entidade,
      entidadeId: e.entidadeId,
    });
  }
}

/** A sequência de 5 min: sem outra gravação nesse tempo, a sequência acaba e a última entra no log. */
export const FIM_DA_SEQUENCIA = 5 * 60_000;

/**
 * As ações em sequência (24/10/2026, com o salvamento automático dos Relatórios Executivos, pedido do Adão): a mesma ação
 * do mesmo usuário no mesmo registro (a `chave`), uma atrás da outra, fica só com a mais recente na Auditoria. A ação
 * espera aqui, na memória, até a sequência acabar — 5 min sem outra, outra pessoa no mesmo registro, outra ação nele
 * (`encerrar`) ou o servidor parando — e entra no log com a data e a hora da última, os metadados dela (com as marcas das
 * anteriores, como o "por cima") e, havendo mais de uma, quantas foram e a hora da primeira. O log continua imutável:
 * nada nele se altera nem se apaga. Se o servidor cair sem parar (falta de energia), a última da sequência se perde.
 */
export function criarSequencias(gravar: (e: EventoAuditoria) => Promise<void>, fim = FIM_DA_SEQUENCIA) {
  type Sequencia = { evento: EventoAuditoria; metadados: Record<string, unknown>; quando: Date; desde: Date; vezes: number; timer: NodeJS.Timeout };
  const abertas = new Map<string, Sequencia>();
  const fechar = (chave: string) => {
    const s = abertas.get(chave);
    if (!s) return Promise.resolve();
    clearTimeout(s.timer);
    abertas.delete(chave);
    const metadados = { ...s.metadados, ...(s.vezes > 1 ? { gravacoes: s.vezes, desde: s.desde.toISOString() } : {}) };
    return gravar({ ...s.evento, metadados, quando: s.quando });
  };
  return {
    registrar(chave: string, e: EventoAuditoria, agora = new Date()) {
      const anterior = abertas.get(chave);
      const continua = !!anterior && anterior.evento.usuarioId === e.usuarioId && anterior.evento.acao === e.acao;
      if (anterior && !continua) void fechar(chave);
      if (anterior) clearTimeout(anterior.timer);
      const timer = setTimeout(() => void fechar(chave), fim);
      // Não segura o processo (os testes e o encerramento do servidor).
      timer.unref();
      abertas.set(chave, {
        evento: e,
        metadados: { ...(continua ? anterior.metadados : {}), ...obj(e.metadados) },
        quando: agora,
        desde: continua ? anterior.desde : agora,
        vezes: continua ? anterior.vezes + 1 : 1,
        timer,
      });
    },
    /** Encerra as sequências cujas chaves começam com `prefixo` (todas, sem ele): a última de cada uma entra no log. */
    async encerrar(prefixo = "") {
      await Promise.all([...abertas.keys()].filter((k) => k.startsWith(prefixo)).map(fechar));
    },
  };
}

/** As sequências da Auditoria (a gravação dos grupos dos Relatórios Executivos). */
export const auditoriaEmSequencia = criarSequencias(auditar);

export type FiltroAuditoria = {
  de?: Date;
  ate?: Date;
  usuarioId?: string[];
  entidade?: string[];
  acao?: string[];
  /** A ordem da data (o padrão é a mais recente primeiro). */
  ordem?: "asc" | "desc";
  entidadeId?: string;
  incluirAcessos: boolean;
  pagina: number;
  porPagina: number;
};

const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const rotuloMes = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;
const horaDe = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const LISTA: Record<string, string> = {
  PROJETO: "Projetos", PRODUCAO: "Produção (m³)", PRODUCAO_PISTA: "Produção (pistas)", PRODUCAO_ARMADURA: "Armadura",
  PRODUCAO_METALURGIA: "Metalurgia", EXPEDICAO: "Expedição", MONTAGEM: "Montagem", ACOMPANHAMENTO: "Acompanhamento",
};

type ItemDoLog = { id: string; acao: string; entidade: string | null; entidadeId: string | null; usuarioNome: string | null; metadados: unknown; dadosAntes: unknown; dadosDepois: unknown };

/**
 * O nome do registro, para quem lê o log (E14 do levantamento de layout): a
 * competência, o usuário, o perfil, a descrição do lançamento ou da
 * divergência, o arquivo. Vem do que o próprio log guardou e, quando não
 * guardou (registros anteriores aos metadados), do cadastro atual pelo
 * identificador. O identificador continua no detalhe.
 */
async function nomesDosRegistros(itens: ItemDoLog[]) {
  const db = getPrismaClient();
  const ids = [...new Set(itens.map((i) => i.entidadeId).filter((x): x is string => !!x))];
  const [competencias, divergencias, usuarios, perfis] = await Promise.all([
    db.competencia.findMany({ where: { id: { in: ids } }, select: { id: true, ano: true, mes: true } }),
    db.divergencia.findMany({ where: { id: { in: ids } }, select: { id: true, descricao: true, competencia: { select: { ano: true, mes: true } } } }),
    db.usuario.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } }),
    db.perfil.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } }),
  ]);
  const mesPorId = new Map(competencias.map((c) => [c.id, rotuloMes(c.ano, c.mes)]));
  const divPorId = new Map(divergencias.map((d) => [d.id, [rotuloMes(d.competencia.ano, d.competencia.mes), d.descricao].filter(Boolean).join(" · ")]));
  const nomePorId = new Map([...usuarios, ...perfis].map((u) => [u.id, u.nome]));

  const nomes = new Map<string, string>();
  for (const i of itens) {
    const m = obj(i.metadados);
    const d = { ...obj(i.dadosAntes), ...obj(i.dadosDepois) };
    const id = i.entidadeId;
    const anoMes = id?.match(/^(\d{4})-(\d{2})$/);
    const competencia = txt(m.competencia) ?? (anoMes ? `${anoMes[2]}/${anoMes[1]}` : id ? (mesPorId.get(id) ?? null) : null);
    let nome: string | null;
    if (i.entidade === "tela") nome = txt(m.tela) ?? id;
    else if (i.acao === "LOGIN_FALHA") nome = txt(m.email);
    else if (i.entidade === "usuario" || i.entidade === "perfil") {
      const cadastrado = id ? nomePorId.get(id) : undefined;
      nome = txt(m.nome) ?? txt(d.nome) ?? cadastrado ?? (i.acao === "LOGIN" ? i.usuarioNome : null);
    }
    else if (i.entidade === "divergencia") nome = (id ? divPorId.get(id) : null) ?? [competencia, txt(m.descricao)].filter(Boolean).join(" · ");
    else if (i.entidade === "lista_operacional") nome = [competencia, LISTA[txt(m.tipo) ?? ""] ?? txt(m.tipo)].filter(Boolean).join(" · ");
    else if (i.entidade === "cadastros") nome = "Planilha de cadastros";
    // A Biblioteca de APIs (24/10/2026): a API (o código) e o formato; recusado, o motivo; o token tentado, o e-mail.
    else if (i.entidade === "api")
      nome = [txt(m.codigo) === "token" ? "Pedido do token" : txt(m.codigo), txt(m.formato), m.status && m.status !== 200 ? `recusado${txt(m.motivo) ? ` (${txt(m.motivo)})` : ""}` : null, txt(m.email)]
        .filter(Boolean)
        .join(" · ");
    else if (i.entidade === "api_bloqueio") nome = `${m.tipo === "API" ? "API" : m.tipo === "USUARIO" ? "Usuário" : "Endereço"} ${txt(m.nome) ?? ""}`.trim();
    // Os Relatórios Executivos (23/10/2026): o mês e o grupo (ou as Configurações); "por cima" na gravação sobre a de outro;
    // as gravações em sequência (24/10/2026, o salvamento automático), quantas foram e desde quando.
    else if (i.entidade === "relatorio_executivo")
      nome = [
        `RE ${txt(m.mes) ?? ""}`.trim(),
        txt(m.aba),
        m.configuracoes ? "Configurações" : null,
        m.porCima ? "por cima da gravação de outro usuário" : null,
        typeof m.gravacoes === "number" && txt(m.desde) ? `${m.gravacoes} gravações seguidas, desde ${horaDe(txt(m.desde)!)}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
    // Os Painéis de Bordo (31/10/2026), como os relatórios: o nome e o mês do painel, as Configurações, o "por cima" e as
    // gravações em sequência.
    else if (i.entidade === "painel_de_bordo")
      nome = [
        txt(m.nome),
        txt(m.mes),
        m.configuracoes ? "Configurações" : null,
        // Os editores convidados ou removidos (01/11/2026, o Compartilhar).
        Array.isArray(m.usuarios) && m.usuarios.length ? m.usuarios.join(", ") : null,
        m.porCima ? "por cima da gravação de outro usuário" : null,
        typeof m.gravacoes === "number" && txt(m.desde) ? `${m.gravacoes} gravações seguidas, desde ${horaDe(txt(m.desde)!)}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
    else {
      const detalhe = txt(m.nome) ?? txt(d.nome) ?? txt(d.descricao) ?? txt(m.arquivo) ?? txt(d.nomeRM);
      nome = [competencia, detalhe].filter(Boolean).join(" · ");
    }
    if (nome) nomes.set(i.id, nome);
  }
  return nomes;
}

export const auditoriaService = {
  async registrarAcesso(params: { usuarioId: string; usuarioNome: string; tela: string; ip?: string; userAgent?: string }) {
    if (!prisma) {
      console.info("[AUDIT]", JSON.stringify({ acao: "ACESSO", tela: params.tela, usuarioId: params.usuarioId }));
      return;
    }
    await auditar({
      usuarioId: params.usuarioId,
      usuarioNome: params.usuarioNome,
      acao: "ACESSO",
      entidade: "tela",
      entidadeId: params.tela,
      metadados: { tela: params.tela },
      ip: params.ip,
      userAgent: params.userAgent,
    });
  },

  /** Consulta do log, do mais recente para o mais antigo. */
  async consultar(f: FiltroAuditoria) {
    const db = getPrismaClient();
    const where: Prisma.AuditLogWhereInput = {
      ...(f.de || f.ate ? { createdAt: { ...(f.de ? { gte: f.de } : {}), ...(f.ate ? { lte: f.ate } : {}) } } : {}),
      ...(f.usuarioId ? { usuarioId: { in: f.usuarioId } } : {}),
      ...(f.entidade ? { entidade: { in: f.entidade } } : {}),
      ...(f.entidadeId ? { entidadeId: f.entidadeId } : {}),
      // Os acessos às telas e, desde 24/10/2026, os pedidos às APIs (muitos, dos aplicativos) só com "incluir acessos".
      ...(f.acao ? { acao: { in: f.acao } } : !f.incluirAcessos ? { acao: { notIn: ["ACESSO", "ACESSO_API"] } } : {}),
    };
    const [itens, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: f.ordem ?? "desc" },
        skip: (f.pagina - 1) * f.porPagina,
        take: f.porPagina,
        select: { id: true, acao: true, entidade: true, entidadeId: true, usuarioId: true, usuarioNome: true, ip: true, dadosAntes: true, dadosDepois: true, metadados: true, createdAt: true },
      }),
      db.auditLog.count({ where }),
    ]);
    const nomes = await nomesDosRegistros(itens);
    return { itens: itens.map((i) => ({ ...i, registro: nomes.get(i.id) ?? null })), total, pagina: f.pagina, porPagina: f.porPagina };
  },

  /** O que os filtros da tela oferecem: usuários que aparecem no log, ações e entidades. */
  async opcoes() {
    const db = getPrismaClient();
    // Um usuário por id. O nome gravado no log pode variar: os acessos anteriores
    // ao Passo 22 guardaram o e-mail no lugar do nome, e o log não se corrige
    // (é imutável). Vale o nome atual do cadastro; para quem já foi excluído,
    // o último nome registrado.
    const nomesNoLog = await db.auditLog.groupBy({ by: ["usuarioId", "usuarioNome"], where: { usuarioId: { not: null } }, _max: { createdAt: true } });
    const ultimoNome = new Map<string, { nome: string | null; em: Date }>();
    for (const n of nomesNoLog) {
      const atual = ultimoNome.get(n.usuarioId!);
      if (!atual || n._max.createdAt! > atual.em) ultimoNome.set(n.usuarioId!, { nome: n.usuarioNome, em: n._max.createdAt! });
    }
    const cadastro = new Map(
      (await db.usuario.findMany({ where: { id: { in: [...ultimoNome.keys()] } }, select: { id: true, nome: true } })).map((u) => [u.id, u.nome]),
    );
    return {
      usuarios: [...ultimoNome]
        .map(([id, n]) => ({ id, nome: cadastro.get(id) ?? n.nome ?? id }))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
      acoes: Object.entries(ROTULO_ACAO).map(([acao, rotulo]) => ({ acao, rotulo })),
      entidades: Object.entries(ROTULO_ENTIDADE).map(([entidade, rotulo]) => ({ entidade, rotulo })),
    };
  },
};
