/**
 * Carga inicial: perfis e usuário inicial, unidades de negócio, linhas, e os
 * cadastros vindos das planilhas (centros de custo, contas de resultado e
 * estrutura da DRE — ver cargaCadastros.ts).
 *
 * Os JSON em prisma/carga-inicial/ são exportações fiéis do SIG BPM 2026 -
 * UNIDADES E CENTROS DE CUSTO (exportar-cadastros.ts). A carga é idempotente.
 *
 * Uso: npx tsx prisma/carga-inicial.ts
 */
import "dotenv/config";
import { getPrismaClient } from "../src/config/prisma.js";
import type { AcaoPermissao, RecursoSistema } from "../src/generated/prisma/enums.js";
import { REGRAS_RATEIO, VIGENCIA_REGRAS } from "../src/services/volumes/regrasRateio.js";
import { carregarCadastrosDaPasta } from "./cargaCadastros.js";
import { CHAVES_DA_MATRIZ } from "../src/services/acesso/telas.js";
import { carregarEstruturaIndicadores } from "../src/services/relatorios/cargaEstruturaIndicadores.js";

const prisma = getPrismaClient();

// -----------------------------------------------------------------------------
// Unidades de negócio
//
// Não vêm de nenhuma aba: são as visões em que a DRE é apurada, hoje
// representadas pelas abas `Realizado (...)` do arquivo do SIG.
// -----------------------------------------------------------------------------

const UNIDADES = [
  { codigo: 1, nome: "Matriz" },
  { codigo: 2, nome: "Filial" },
  { codigo: 3, nome: "Serviços" },
  { codigo: 4, nome: "Despesas" },
  { codigo: 6, nome: "Extra-Operacional" },
  { codigo: 5, nome: "RN" },
  { codigo: 7, nome: "Leben" },
];

/**
 * Os três vocabulários de "linha" da planilha (ver SPEC, entidade Linha).
 *
 *  - PRODUTO: ESTRUTURA, ALVEOLARES e ESTACAS não estão em nenhuma aba — são o resultado das fórmulas de Linha das
 *    listas operacionais (ESTRUTURA na Unidade 01; ESTACAS ou ALVEOLARES na 02).
 *    METALÚRGICA vem da coluna LINHA da aba DRE do CONTROLE DAS VENDAS - COMERCIAL
 *    (itens metálicos produzidos na Matriz). TURN-KEY, de obra, também vem de lá.
 *  - OBRA e FATURAMENTO: colunas LINHAS (OBRAS) e FATURAMENTOS (OBRAS) da aba
 *    Listas do SIG BPM 2026 - LISTAS REALIZADO (OPERAÇÃO).
 *
 * O código é o texto que as listas usam; é por ele que a importação resolve a linha.
 */
const LINHAS: Array<{ tipo: "PRODUTO" | "OBRA" | "FATURAMENTO"; codigo: string; nome: string }> = [
  { tipo: "PRODUTO", codigo: "ESTRUTURA", nome: "Estrutura" },
  { tipo: "PRODUTO", codigo: "METALÚRGICA", nome: "Metalúrgica" },
  { tipo: "PRODUTO", codigo: "ALVEOLARES", nome: "Alveolares" },
  { tipo: "PRODUTO", codigo: "ESTACAS", nome: "Estacas" },
  { tipo: "OBRA", codigo: "MONTAGEM", nome: "Montagem" },
  { tipo: "OBRA", codigo: "VEDAÇÃO", nome: "Vedação" },
  { tipo: "OBRA", codigo: "FUNDAÇÃO", nome: "Fundação" },
  { tipo: "OBRA", codigo: "CAPEAMENTO", nome: "Capeamento" },
  { tipo: "OBRA", codigo: "METÁLICA", nome: "Metálica" },
  { tipo: "OBRA", codigo: "TELHAMENTO", nome: "Telhamento" },
  { tipo: "OBRA", codigo: "TURN-KEY", nome: "Turn-Key" },
  { tipo: "OBRA", codigo: "OUTROS", nome: "Outros" },
  { tipo: "FATURAMENTO", codigo: "Frete e Descarga", nome: "Frete e Descarga" },
  { tipo: "FATURAMENTO", codigo: "Execução de Serviços", nome: "Execução de Serviços" },
  { tipo: "FATURAMENTO", codigo: "Materiais Aplicados", nome: "Materiais Aplicados" },
  { tipo: "FATURAMENTO", codigo: "Equipamentos Locados", nome: "Equipamentos Locados" },
];

/** A unidade de cada linha (cadastro Linhas): os produtos na Matriz ou na Filial, as de obra em Serviços. */
const UNIDADE_DA_LINHA: Record<string, number> = { ESTRUTURA: 1, "METALÚRGICA": 1, ALVEOLARES: 2, ESTACAS: 2 };

async function carregarLinhas() {
  const unidades = new Map((await prisma.unidadeNegocio.findMany({ select: { id: true, codigo: true } })).map((u) => [u.codigo, u.id]));
  for (const [i, l] of LINHAS.entries()) {
    const codigoUnidade = l.tipo === "OBRA" ? 3 : l.tipo === "PRODUTO" ? UNIDADE_DA_LINHA[l.codigo] : undefined;
    // Desde o cadastro Linhas (10/10/2026), a carga só cria as que faltam: o nome, a ordem e a unidade se editam na tela.
    await prisma.linha.upsert({
      where: { tipo_codigo: { tipo: l.tipo, codigo: l.codigo } },
      create: { ...l, ordem: i + 1, unidadeNegocioId: codigoUnidade ? (unidades.get(codigoUnidade) ?? null) : null },
      update: {},
    });
  }
  return LINHAS.length;
}

async function carregarUnidades() {
  for (const [i, u] of UNIDADES.entries()) {
    const dados = { nome: u.nome, ordem: i + 1 };
    await prisma.unidadeNegocio.upsert({
      where: { codigo: u.codigo },
      create: { codigo: u.codigo, ...dados },
      update: dados,
    });
  }
  return UNIDADES.length;
}

// -----------------------------------------------------------------------------
// Perfis e usuário inicial
//
// A partir do Passo 9 as entidades registram autor — quem abriu a competência,
// quem apurou, quem fechou. Sem um usuário real no banco, a chave estrangeira
// não fecha. Estes registros são o mínimo para isso; as telas de gestão de
// usuários e a autenticação real entram no Passo 22.
// -----------------------------------------------------------------------------

// Os grupos de telas do menu lateral (11/10/2026).
const RECURSOS: RecursoSistema[] = [
  "CENARIOS_SINTETICOS",
  "CENARIOS_ANALITICOS",
  "RESULTADOS_REALIZADOS",
  "FECHAMENTO_MENSAL",
  "CADASTROS_APURACAO",
  "CADASTROS_CONTROLADORIA",
  "CONTROLE_USUARIOS",
];

const ACOES: AcaoPermissao[] = ["LER", "EDITAR"];

const PERFIS: Array<{
  codigo: string;
  nome: string;
  descricao: string;
  ordem: number;
  recorteSetor?: boolean;
  recorteDepartamento?: boolean;
  permissoes: Array<{ recurso: RecursoSistema; acao: AcaoPermissao }>;
}> = [
  {
    codigo: "CONTABIL",
    nome: "Contábil",
    descricao: "Opera o fechamento, parametriza os cadastros e confere os resultados",
    ordem: 1,
    permissoes: RECURSOS.flatMap((recurso) => ACOES.map((acao) => ({ recurso, acao }))),
  },
  {
    codigo: "ALIMENTADOR",
    nome: "Alimentador",
    descricao: "Digita e importa as listas operacionais dos seus setores",
    ordem: 2,
    recorteSetor: true,
    // O recorte por setor deixa, no Fechamento Mensal, só Importações e Listas, e nas listas dos seus setores.
    permissoes: (["LER", "EDITAR"] as AcaoPermissao[]).map((acao) => ({ recurso: "FECHAMENTO_MENSAL" as RecursoSistema, acao })),
  },
  {
    codigo: "GESTAO",
    nome: "Gestão",
    descricao: "Consulta a DRE apurada, os fechamentos e as divergências",
    ordem: 3,
    recorteDepartamento: true,
    // O recorte por departamento tira as telas que mostram lançamentos de todos os departamentos.
    permissoes: (["RESULTADOS_REALIZADOS", "FECHAMENTO_MENSAL", "CENARIOS_SINTETICOS", "CENARIOS_ANALITICOS"] as RecursoSistema[]).map((recurso) => ({
      recurso,
      acao: "LER" as AcaoPermissao,
    })),
  },
];

/** Mesmo id que o login de desenvolvimento emite no `sub` do token, para que
 *  o usuário autenticado corresponda a uma linha real do banco. */
const USUARIO_INICIAL_ID = "00000000-0000-0000-0000-000000000001";
/** bcrypt de "admin123" — herdado do login de demonstração do molde. */
const USUARIO_INICIAL_SENHA =
  "$2b$10$TfWpTldLcP8P4w0bOlhMw.b5i1v2neNtOCAGdEJjZNZGhF6BPPsQ6";

async function carregarPerfisEUsuario() {
  let perfilContabilId = "";

  for (const p of PERFIS) {
    // Os perfis são cadastro da empresa (tela de Perfis, Passo 22): a carga só
    // cria os que faltam e nunca reescreve um perfil existente — senão cada
    // recarga desfaria as permissões editadas na tela.
    const existente = await prisma.perfil.findUnique({ where: { codigo: p.codigo }, select: { id: true } });
    if (existente) {
      if (p.codigo === "CONTABIL") perfilContabilId = existente.id;
      continue;
    }
    const perfil = await prisma.perfil.create({
      data: {
        codigo: p.codigo,
        nome: p.nome,
        descricao: p.descricao,
        sistema: true,
        ordem: p.ordem,
        recorteSetor: p.recorteSetor ?? false,
        recorteDepartamento: p.recorteDepartamento ?? false,
      },
    });

    for (const perm of p.permissoes) {
      await prisma.perfilPermissao.create({
        data: { perfilId: perfil.id, recurso: perm.recurso, acao: perm.acao },
      });
      // A matriz que vale (14/10/2026): a permissão do grupo em cada tela e aba dele.
      for (const c of CHAVES_DA_MATRIZ.filter((x) => x.recurso === perm.recurso)) {
        await prisma.perfilPermissaoTela.create({ data: { perfilId: perfil.id, chave: c.chave, acao: perm.acao } });
      }
    }

    if (p.codigo === "CONTABIL") perfilContabilId = perfil.id;
  }

  await prisma.usuario.upsert({
    where: { id: USUARIO_INICIAL_ID },
    create: {
      id: USUARIO_INICIAL_ID,
      nome: "Administrador BPM",
      email: "admin@bpm.com",
      senhaHash: USUARIO_INICIAL_SENHA,
      perfilId: perfilContabilId,
      ordem: 1,
    },
    // Só cria: se o usuário já existe, a carga não o reativa nem muda o perfil
    // (a carga roda a cada atualização de planilha; inativar o inicial tem de valer).
    update: {},
  });

  return { perfis: PERFIS.length };
}

/** As 14 regras da aba Rateios do BASE REALIZADO (OPERAÇÃO) — ver regrasRateio.ts. */
async function carregarRegrasRateio() {
  const unidades = new Map((await prisma.unidadeNegocio.findMany({ select: { id: true, codigo: true } })).map((u) => [u.codigo, u.id]));
  for (const [i, r] of REGRAS_RATEIO.entries()) {
    const dados = {
      unidadeDestinoId: unidades.get(r.unidade)!,
      rotulo: r.rotulo,
      baseFisica: r.baseFisica,
      origemDoVolume: r.origem,
      ordem: i + 1,
    };
    await prisma.regraRateio.upsert({
      where: { chave_destino_vigenciaInicio: { chave: r.chave, destino: r.destino, vigenciaInicio: VIGENCIA_REGRAS } },
      create: { chave: r.chave, destino: r.destino, vigenciaInicio: VIGENCIA_REGRAS, ...dados },
      update: dados,
    });
  }
  return REGRAS_RATEIO.length;
}

const perfis = await carregarPerfisEUsuario();
const un = await carregarUnidades();
const linhas = await carregarLinhas();
const regras = await carregarRegrasRateio();
const indicadores = await carregarEstruturaIndicadores(prisma);

console.log("Carga inicial\n");
console.log(`Perfis              : ${perfis.perfis} gravados, com o usuário inicial`);
console.log(`Unidades de negócio : ${un} gravadas`);
console.log(`Linhas              : ${linhas} gravadas (produto, obra e faturamento)`);
console.log(`Regras de rateio    : ${regras} gravadas`);
console.log(`Indicadores         : ${indicadores.criados} gravados (de ${indicadores.total} da carga inicial)`);
await carregarCadastrosDaPasta();
