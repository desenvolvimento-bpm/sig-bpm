import { getPrismaClient } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { AcaoPermissao, DepartamentoAcesso, RecursoSistema, TipoImportacao } from "../../generated/prisma/enums.js";
import { hashSenha } from "../../lib/senha.js";
import { gestaoDoCentro, ROTULO_DEPARTAMENTO } from "../acesso/recorteDepartamento.js";
import { CODIGO_ADMINISTRADOR } from "../acesso/acesso.js";
import { CATALOGO_DE_TELAS, CHAVES_DA_MATRIZ, chaveValida, MATRIZ_COMPLETA } from "../acesso/telas.js";
import { DEFINICOES_LISTAS } from "../importacoes/listas/definicoesListas.js";
import { auditar } from "../auditoriaService.js";
import { plural } from "../../utils/plural.js";

/**
 * Usuários e perfis (Passo 22). O perfil é cadastro, não código: a empresa
 * cria tipos novos, inativa os existentes e define, em cada grupo de telas do
 * menu lateral, se o perfil lê ou edita (11/10/2026). Os recortes por dado (setores do Alimentador, departamentos do
 * Gestor) ficam no usuário e só valem se o perfil recorta.
 *
 * Travas contra se trancar para fora: ninguém inativa a si mesmo, troca o
 * próprio perfil, inativa o próprio perfil nem tira dele a edição de usuários.
 *
 * O perfil Administrador (14/10/2026): acesso total, de sistema (não se exclui nem se inativa, e as permissões e os
 * recortes não mudam), não fica sem usuário ativo, e só um Administrador põe ou tira alguém dele, ou edita um
 * Administrador (os dados, a senha).
 */

export class RegraUsuarioError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

/** Os grupos de telas do menu lateral, na ordem do menu (11/10/2026). */
export const RECURSOS: RecursoSistema[] = [
  "ANALISES_GERENCIAIS",
  "CENARIOS_SINTETICOS",
  "CENARIOS_ANALITICOS",
  // O Realizado por Obra (03/11/2026), no alto da Apuração dos Resultados, como no menu.
  "REALIZADO_POR_OBRA",
  "RESULTADOS_REALIZADOS",
  "CONTESTACOES_GASTOS",
  "FECHAMENTO_MENSAL",
  "CADASTROS_APURACAO",
  // A Gestão de Colaboradores (06/11/2026), nos Processos Administrativos, entre a Apuração e a Controladoria, como no menu.
  "GESTAO_COLABORADORES",
  "CENTRAL_CONECTIVIDADE",
  "CADASTROS_CONTROLADORIA",
  // Os Arquivos Gerais (05/11/2026), acima do Controle de Usuários, como no menu.
  "ARQUIVOS_GERAIS",
  "CONTROLE_USUARIOS",
];
const ROTULO_RECURSO: Record<RecursoSistema, string> = {
  CENARIOS_SINTETICOS: "Cenários Sintéticos",
  CENARIOS_ANALITICOS: "Cenários Analíticos",
  RESULTADOS_REALIZADOS: "Resultados Empresariais",
  FECHAMENTO_MENSAL: "Fechamento Mensal",
  CADASTROS_APURACAO: "Cadastros da Apuração",
  CADASTROS_CONTROLADORIA: "Cadastros da Controladoria",
  CONTROLE_USUARIOS: "Controle de Usuários",
  ANALISES_GERENCIAIS: "Análises Gerenciais",
  CENTRAL_CONECTIVIDADE: "Central de Conectividade",
  CONTESTACOES_GASTOS: "Contestações de Gastos",
  REALIZADO_POR_OBRA: "Realizado por Obra",
  ARQUIVOS_GERAIS: "Arquivos Gerais",
  GESTAO_COLABORADORES: "Gestão de Colaboradores",
};
const ACOES: AcaoPermissao[] = ["LER", "EDITAR"];
const SETORES: Array<{ tipo: TipoImportacao; rotulo: string }> = [
  ...Object.values(DEFINICOES_LISTAS).map((d) => ({ tipo: d.tipo as TipoImportacao, rotulo: d.rotulo })),
  { tipo: "DEVOLUCAO", rotulo: "Devoluções" },
  { tipo: "SAIDA", rotulo: "Saídas" },
  { tipo: "MEDICAO", rotulo: "Medições" },
];
const DEPARTAMENTOS = Object.keys(ROTULO_DEPARTAMENTO) as DepartamentoAcesso[];

/** Setores são as listas operacionais: balancete, DRE do Comercial e saldo inicial não são de setor. */
function exigirSetores(setores: TipoImportacao[]) {
  const validos = new Set(SETORES.map((s) => s.tipo));
  const fora = setores.filter((s) => !validos.has(s));
  if (fora.length) throw new RegraUsuarioError(400, `Setor inválido: ${fora.join(", ")}. Os setores são as listas operacionais.`);
}


/** Uma permissão da matriz (14/10/2026): a tela ou a aba ("tela.aba") do catálogo e a ação. */
export type Permissao = { chave: string; acao: AcaoPermissao };
export type DadosUsuario = {
  nome: string;
  email: string;
  perfilId: string;
  ativo: boolean;
  setores: TipoImportacao[];
  departamentos: DepartamentoAcesso[];
  /** O recorte por centro de custo (Coordenador): a gestão e os centros dela que o usuário alcança. */
  gestao?: DepartamentoAcesso | null;
  centros?: string[];
  /** Com recorte por centro de custo: vê também os resultados das obras, nas linhas da gestão. */
  veObras?: boolean;
};
export type DadosPerfil = {
  nome: string;
  descricao: string | null;
  ativo: boolean;
  recorteSetor: boolean;
  recorteDepartamento: boolean;
  recorteCentro?: boolean;
  /** Acesso a Informações Sensíveis (27/10/2026): as movimentações da Mão de Obra Direta e Indireta. */
  informacoesSensiveis?: boolean;
  permissoes: Permissao[];
};

/**
 * EDITAR implica LER: a matriz gravada é sempre coerente. Os recortes não conflitam com os grupos: o que um perfil
 * recortado não pode ler (as telas de todos os departamentos, ou as fora das listas do setor) sai na hora de montar
 * as permissões das rotas (permissoesDasRotas, em acesso.ts).
 */
function normalizarPermissoes(ps: Permissao[]): Permissao[] {
  const fora = [...new Set(ps.map((p) => p.chave).filter((c) => !chaveValida(c)))];
  if (fora.length) throw new RegraUsuarioError(400, `Tela ou aba inválida: ${fora.slice(0, 3).join(", ")}.`);
  const nivel = { LER: 1, EDITAR: 2 } as const;
  const maior = new Map<string, number>();
  for (const p of ps) maior.set(p.chave, Math.max(maior.get(p.chave) ?? 0, nivel[p.acao]));
  // A aba só vale com a tela lida.
  for (const c of CHAVES_DA_MATRIZ) if (c.aba && !maior.get(c.tela)) maior.delete(c.chave);
  return [...maior].flatMap(([chave, n]) => ACOES.filter((a) => nivel[a] <= n).map((acao) => ({ chave, acao })));
}

const selecaoUsuario = {
  id: true,
  nome: true,
  email: true,
  ativo: true,
  ordem: true,
  perfil: { select: { id: true, codigo: true, nome: true, recorteSetor: true, recorteDepartamento: true, recorteCentro: true, ativo: true } },
  setores: { select: { tipoLista: true } },
  departamentos: { select: { departamento: true } },
  gestao: true,
  veObras: true,
  centros: { select: { centroCusto: { select: { id: true, codigoRM: true, nomeRM: true } } } },
} satisfies Prisma.UsuarioSelect;
type UsuarioLido = Prisma.UsuarioGetPayload<{ select: typeof selecaoUsuario }>;
const paraTela = (u: UsuarioLido) => ({
  ...u,
  setores: u.setores.map((s) => s.tipoLista),
  departamentos: u.departamentos.map((d) => d.departamento),
  centros: u.centros.map((c) => c.centroCusto.id),
});

/**
 * Os centros de custo do Coordenador: precisam ser ativos e da gestão escolhida (o campo DEPARTAMENTO do cadastro).
 * Sem gestão, nenhum centro.
 */
async function exigirCentros(gestao: DepartamentoAcesso | null, centros: string[]) {
  const ids = [...new Set(centros)];
  if (ids.length === 0) return [];
  if (!gestao) throw new RegraUsuarioError(400, "Escolha a gestão do usuário antes dos centros de custo.");
  const achados = await getPrismaClient().centroCusto.findMany({ where: { id: { in: ids } }, select: { id: true, nomeRM: true, departamento: true, ativo: true } });
  const fora = achados.filter((c) => !c.ativo || gestaoDoCentro(c.departamento) !== gestao);
  if (achados.length !== ids.length) throw new RegraUsuarioError(400, "Centro de custo inexistente.");
  if (fora.length) throw new RegraUsuarioError(400, `Centros fora da gestão ${ROTULO_DEPARTAMENTO[gestao]} ou inativos: ${fora.map((c) => c.nomeRM).join(", ")}.`);
  return ids;
}

async function perfilExistente(id: string) {
  const p = await getPrismaClient().perfil.findUnique({ where: { id }, select: { id: true, ativo: true, codigo: true } });
  if (!p) throw new RegraUsuarioError(400, "Perfil inexistente.");
  return p;
}

const ehPerfilAdministrador = (p: { codigo: string }) => p.codigo === CODIGO_ADMINISTRADOR;
/** O usuário é Administrador (o perfil dele). */
async function ehAdministrador(usuarioId: string) {
  const u = await getPrismaClient().usuario.findUnique({ where: { id: usuarioId }, select: { perfil: { select: { codigo: true } } } });
  return !!u && ehPerfilAdministrador(u.perfil);
}
function exigirAdministrador(quemEhAdministrador: boolean, oQue: string) {
  if (!quemEhAdministrador) throw new RegraUsuarioError(409, `Só um Administrador ${oQue}.`);
}

export const usuariosService = {
  /** O que as telas oferecem: perfis, recursos e ações, setores e departamentos. */
  async opcoes() {
    const perfis = await getPrismaClient().perfil.findMany({
      orderBy: [{ ordem: "asc" }, { nome: "asc" }],
      select: { id: true, codigo: true, nome: true, ativo: true, recorteSetor: true, recorteDepartamento: true, recorteCentro: true },
    });
    // Os centros ativos de cada gestão, para o recorte por centro de custo (Coordenador).
    const centros = (
      await getPrismaClient().centroCusto.findMany({
        where: { ativo: true },
        orderBy: [{ codigoRM: "asc" }],
        select: { id: true, codigoRM: true, nomeRM: true, nomeControladoria: true, departamento: true },
      })
    )
      // Os com código RM primeiro, na ordem do código; os sem código no fim, pelo nome.
      .sort((a, b) => (a.codigoRM ?? "￿").localeCompare(b.codigoRM ?? "￿") || a.nomeRM.localeCompare(b.nomeRM))
      .flatMap((c) => {
      const gestao = gestaoDoCentro(c.departamento);
      return gestao ? [{ id: c.id, codigoRM: c.codigoRM, nome: c.nomeRM, agrupamento: c.nomeControladoria, gestao }] : [];
    });
    return {
      perfis,
      recursos: RECURSOS.map((r) => ({ recurso: r, rotulo: ROTULO_RECURSO[r] })),
      /** O catálogo das telas e das abas de cada grupo (14/10/2026): as linhas da matriz do perfil. */
      telas: CATALOGO_DE_TELAS.map((g) => ({ recurso: g.recurso, nome: g.nome, telas: g.telas.map((t) => ({ codigo: t.codigo, nome: t.nome, abas: t.abas ?? [] })) })),
      acoes: ACOES,
      setores: SETORES,
      departamentos: DEPARTAMENTOS.map((d) => ({ departamento: d, rotulo: ROTULO_DEPARTAMENTO[d] })),
      /** As gestões com centros de custo, e os centros de cada uma. */
      gestoes: DEPARTAMENTOS.filter((d) => centros.some((c) => c.gestao === d)).map((d) => ({ gestao: d, rotulo: ROTULO_DEPARTAMENTO[d] })),
      centros,
    };
  },

  async listar() {
    const us = await getPrismaClient().usuario.findMany({ orderBy: [{ ordem: "asc" }, { nome: "asc" }], select: selecaoUsuario });
    return us.map(paraTela);
  },

  async criar(d: DadosUsuario & { senha: string }, quem: string) {
    exigirSetores(d.setores);
    const centros = await exigirCentros(d.gestao ?? null, d.centros ?? []);
    const prisma = getPrismaClient();
    const perfil = await perfilExistente(d.perfilId);
    if (ehPerfilAdministrador(perfil)) exigirAdministrador(await ehAdministrador(quem), "cria um usuário Administrador");
    const email = d.email.trim().toLowerCase();
    if (await prisma.usuario.findUnique({ where: { email }, select: { id: true } })) throw new RegraUsuarioError(409, `Já existe um usuário com o e-mail ${email}.`);
    const u = await prisma.usuario.create({
      data: {
        nome: d.nome.trim(),
        email,
        senhaHash: await hashSenha(d.senha),
        perfilId: d.perfilId,
        ativo: d.ativo,
        ordem: (await prisma.usuario.count()) + 1,
        setores: { create: [...new Set(d.setores)].map((tipoLista) => ({ tipoLista })) },
        departamentos: { create: [...new Set(d.departamentos)].map((departamento) => ({ departamento })) },
        gestao: d.gestao ?? null,
        veObras: d.veObras ?? false,
        centros: { create: centros.map((centroCustoId) => ({ centroCustoId })) },
      },
      select: selecaoUsuario,
    });
    const r = paraTela(u);
    await auditar({ usuarioId: quem, acao: "CRIACAO", entidade: "usuario", entidadeId: u.id, depois: r, metadados: { nome: r.nome } });
    return r;
  },

  async atualizar(id: string, d: DadosUsuario, quemEdita: string) {
    exigirSetores(d.setores);
    const centros = await exigirCentros(d.gestao ?? null, d.centros ?? []);
    const prisma = getPrismaClient();
    const atual = await prisma.usuario.findUnique({ where: { id }, select: { id: true, perfilId: true, ativo: true, perfil: { select: { codigo: true } } } });
    if (!atual) throw new RegraUsuarioError(404, "Usuário não encontrado.");
    const antes = paraTela(await prisma.usuario.findUniqueOrThrow({ where: { id }, select: selecaoUsuario }));
    const novoPerfil = await perfilExistente(d.perfilId);
    const eraAdministrador = ehPerfilAdministrador(atual.perfil);
    const seraAdministrador = ehPerfilAdministrador(novoPerfil);
    if (eraAdministrador || seraAdministrador) {
      const quemEhAdministrador = await ehAdministrador(quemEdita);
      if (!eraAdministrador) exigirAdministrador(quemEhAdministrador, "promove outro usuário a Administrador");
      else exigirAdministrador(quemEhAdministrador, "edita um usuário Administrador");
    }
    // O Administrador não fica sem usuário ativo.
    if (eraAdministrador && atual.ativo && (!seraAdministrador || !d.ativo)) {
      const outros = await prisma.usuario.count({ where: { id: { not: id }, ativo: true, perfil: { codigo: CODIGO_ADMINISTRADOR } } });
      if (outros === 0) throw new RegraUsuarioError(409, "Este é o único Administrador ativo: promova outro usuário a Administrador antes de trocar o perfil ou inativar este.");
    }
    if (id === quemEdita && !d.ativo) throw new RegraUsuarioError(409, "Você não pode inativar o seu próprio usuário.");
    if (id === quemEdita && d.perfilId !== atual.perfilId) throw new RegraUsuarioError(409, "Você não pode trocar o seu próprio perfil.");
    const email = d.email.trim().toLowerCase();
    const outro = await prisma.usuario.findUnique({ where: { email }, select: { id: true } });
    if (outro && outro.id !== id) throw new RegraUsuarioError(409, `Já existe um usuário com o e-mail ${email}.`);
    const u = await prisma.$transaction(async (tx) => {
      await tx.usuarioSetor.deleteMany({ where: { usuarioId: id } });
      await tx.usuarioDepartamento.deleteMany({ where: { usuarioId: id } });
      await tx.usuarioCentro.deleteMany({ where: { usuarioId: id } });
      return tx.usuario.update({
        where: { id },
        data: {
          nome: d.nome.trim(),
          email,
          perfilId: d.perfilId,
          ativo: d.ativo,
          setores: { create: [...new Set(d.setores)].map((tipoLista) => ({ tipoLista })) },
          departamentos: { create: [...new Set(d.departamentos)].map((departamento) => ({ departamento })) },
          gestao: d.gestao ?? null,
          veObras: d.veObras ?? false,
          centros: { create: centros.map((centroCustoId) => ({ centroCustoId })) },
        },
        select: selecaoUsuario,
      });
    });
    const r = paraTela(u);
    await auditar({ usuarioId: quemEdita, acao: "ALTERACAO", entidade: "usuario", entidadeId: id, antes, depois: r, metadados: { nome: r.nome } });
    return r;
  },

  async redefinirSenha(id: string, senha: string, quem: string) {
    const prisma = getPrismaClient();
    const alvo = await prisma.usuario.findUnique({ where: { id }, select: { id: true, perfil: { select: { codigo: true } } } });
    if (!alvo) throw new RegraUsuarioError(404, "Usuário não encontrado.");
    if (ehPerfilAdministrador(alvo.perfil) && id !== quem) exigirAdministrador(await ehAdministrador(quem), "redefine a senha de um Administrador");
    await prisma.usuario.update({ where: { id }, data: { senhaHash: await hashSenha(senha) } });
    // A senha nunca vai para o log: só o fato.
    const nome = (await prisma.usuario.findUnique({ where: { id }, select: { nome: true } }))?.nome;
    await auditar({ usuarioId: quem, acao: "REDEFINICAO_SENHA", entidade: "usuario", entidadeId: id, metadados: { nome } });
  },

  // ------------------------------------------------------------- perfis

  async listarPerfis() {
    const ps = await getPrismaClient().perfil.findMany({
      orderBy: [{ ordem: "asc" }, { nome: "asc" }],
      select: {
        id: true,
        codigo: true,
        nome: true,
        descricao: true,
        sistema: true,
        ativo: true,
        ordem: true,
        recorteSetor: true,
        recorteDepartamento: true,
        recorteCentro: true,
        informacoesSensiveis: true,
        permissoes: { select: { recurso: true, acao: true } },
        permissoesTelas: { select: { chave: true, acao: true } },
        _count: { select: { usuarios: true } },
      },
    });
    // A matriz que vale é a por tela e por aba; a por grupo (permissoes) fica só como histórico.
    return ps.map(({ _count, permissoes: _grupos, permissoesTelas, ...p }) => ({ ...p, permissoes: permissoesTelas, usuarios: _count.usuarios }));
  },

  async criarPerfil(d: DadosPerfil & { codigo: string }, quem: string) {
    const prisma = getPrismaClient();
    const codigo = d.codigo.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    if (await prisma.perfil.findUnique({ where: { codigo }, select: { id: true } })) throw new RegraUsuarioError(409, `Já existe um perfil com o código ${codigo}.`);
    await prisma.perfil.create({
      data: {
        codigo,
        nome: d.nome.trim(),
        descricao: d.descricao?.trim() || null,
        ativo: d.ativo,
        recorteSetor: d.recorteSetor,
        recorteDepartamento: d.recorteDepartamento,
        recorteCentro: d.recorteCentro ?? false,
        informacoesSensiveis: d.informacoesSensiveis ?? false,
        ordem: (await prisma.perfil.count()) + 1,
        permissoesTelas: { create: normalizarPermissoes(d.permissoes) },
      },
    });
    const lista = await this.listarPerfis();
    const criado = lista.find((p) => p.codigo === codigo);
    await auditar({ usuarioId: quem, acao: "CRIACAO", entidade: "perfil", entidadeId: criado?.id, depois: criado, metadados: { nome: criado?.nome } });
    return lista;
  },

  async atualizarPerfil(id: string, d: DadosPerfil, quemEdita: string) {
    const prisma = getPrismaClient();
    const atual = await prisma.perfil.findUnique({ where: { id }, select: { id: true, codigo: true, nome: true } });
    if (!atual) throw new RegraUsuarioError(404, "Perfil não encontrado.");
    if (ehPerfilAdministrador(atual)) {
      exigirAdministrador(await ehAdministrador(quemEdita), "edita o perfil Administrador");
      if (!d.ativo) throw new RegraUsuarioError(409, "O perfil Administrador não pode ser inativado.");
      // Só a descrição muda: o nome, a situação, os recortes, o acesso às informações sensíveis e as permissões (todas) são fixos.
      d = { ...d, nome: atual.nome, ativo: true, recorteSetor: false, recorteDepartamento: false, recorteCentro: false, informacoesSensiveis: true, permissoes: MATRIZ_COMPLETA };
    }
    const antes = (await this.listarPerfis()).find((p) => p.id === id);
    const permissoes = normalizarPermissoes(d.permissoes);
    const meu = (await prisma.usuario.findUniqueOrThrow({ where: { id: quemEdita }, select: { perfilId: true } })).perfilId === id;
    if (meu && !d.ativo) throw new RegraUsuarioError(409, "Você não pode inativar o seu próprio perfil.");
    if (meu && !permissoes.some((p) => p.chave === "perfis" && p.acao === "EDITAR")) {
      throw new RegraUsuarioError(409, "Você não pode tirar do seu próprio perfil a edição da tela Perfis.");
    }
    await prisma.$transaction([
      prisma.perfilPermissaoTela.deleteMany({ where: { perfilId: id } }),
      prisma.perfil.update({
        where: { id },
        data: {
          nome: d.nome.trim(),
          descricao: d.descricao?.trim() || null,
          ativo: d.ativo,
          recorteSetor: d.recorteSetor,
          recorteDepartamento: d.recorteDepartamento,
          recorteCentro: d.recorteCentro ?? false,
          informacoesSensiveis: d.informacoesSensiveis ?? false,
          permissoesTelas: { create: permissoes },
        },
      }),
    ]);
    const lista = await this.listarPerfis();
    await auditar({ usuarioId: quemEdita, acao: "ALTERACAO", entidade: "perfil", entidadeId: id, antes, depois: lista.find((p) => p.id === id), metadados: { nome: d.nome } });
    return lista;
  },

  /** Exclui um perfil que não é de sistema e não tem usuários. */
  /**
   * Inativa ou reativa um perfil (27/10/2026, a ação Inativar da lista dos perfis), como a caixa Ativo do modal: o
   * Administrador não se inativa, nem o perfil de quem está inativando. Inativo, os usuários dele não entram.
   */
  async mudarSituacaoPerfil(id: string, ativo: boolean, quem: string) {
    const prisma = getPrismaClient();
    const p = await prisma.perfil.findUnique({ where: { id }, select: { id: true, codigo: true, nome: true, ativo: true } });
    if (!p) throw new RegraUsuarioError(404, "Perfil não encontrado.");
    if (ehPerfilAdministrador(p)) throw new RegraUsuarioError(409, "O perfil Administrador não pode ser excluído nem inativado.");
    if (!ativo && (await prisma.usuario.findUniqueOrThrow({ where: { id: quem }, select: { perfilId: true } })).perfilId === id) {
      throw new RegraUsuarioError(409, "Você não pode inativar o seu próprio perfil.");
    }
    if (p.ativo === ativo) return this.listarPerfis();
    const antes = (await this.listarPerfis()).find((x) => x.id === id);
    await prisma.perfil.update({ where: { id }, data: { ativo } });
    const lista = await this.listarPerfis();
    await auditar({ usuarioId: quem, acao: "ALTERACAO", entidade: "perfil", entidadeId: id, antes, depois: lista.find((x) => x.id === id), metadados: { nome: p.nome } });
    return lista;
  },

  async excluirPerfil(id: string, quem: string) {
    const prisma = getPrismaClient();
    const p = await prisma.perfil.findUnique({ where: { id }, select: { sistema: true, nome: true, codigo: true, _count: { select: { usuarios: true } } } });
    if (!p) throw new RegraUsuarioError(404, "Perfil não encontrado.");
    if (ehPerfilAdministrador(p)) throw new RegraUsuarioError(409, "O perfil Administrador não pode ser excluído nem inativado.");
    if (p.sistema) throw new RegraUsuarioError(409, `O perfil ${p.nome} é de sistema: pode ser inativado, mas não excluído.`);
    if (p._count.usuarios > 0) throw new RegraUsuarioError(409, `O perfil ${p.nome} tem ${p._count.usuarios} ${plural(p._count.usuarios, "usuário", "usuários")}; troque o perfil ${plural(p._count.usuarios, "dele", "deles")} antes de excluir.`);
    const antes = (await this.listarPerfis()).find((x) => x.id === id);
    await prisma.perfil.delete({ where: { id } });
    await auditar({ usuarioId: quem, acao: "EXCLUSAO", entidade: "perfil", entidadeId: id, antes, metadados: { nome: antes?.nome } });
    return this.listarPerfis();
  },
};
