import { getPrismaClient } from "../../config/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { AcaoPermissao, DepartamentoAcesso, TipoImportacao } from "../../generated/prisma/enums.js";
import { areasDaMatriz, CATALOGO_DE_TELAS, MATRIZ_COMPLETA } from "./telas.js";

/**
 * Quem é o usuário e o que ele alcança (Passo 22).
 *
 * As permissões pertencem ao perfil — Ler ou Editar em cada tela e em cada aba de
 * conteúdo (14/10/2026; antes, em cada grupo de telas do menu lateral) — e viram a
 * lista "área:acao" que as rotas verificam (permissoesDasRotas; o catálogo em telas.ts). Os recortes por dado vêm do perfil (se ele
 * recorta) e do usuário (quais setores, quais departamentos).
 *
 * O backend relê isso do banco a cada requisição, e não do token: inativar
 * um usuário ou um perfil, ou mudar uma permissão, vale na hora.
 */

/**
 * O perfil Administrador (14/10/2026): acesso total a todas as telas, sem recortes — as permissões vêm do código do
 * perfil, não da matriz gravada, para as telas novas entrarem sozinhas.
 */
export const CODIGO_ADMINISTRADOR = "ADMINISTRADOR";

export type Acesso = {
  /** Só as listas operacionais dos setores do usuário. */
  recorteSetor: boolean;
  setores: TipoImportacao[];
  /** Só as movimentações e os centros de custo dos departamentos do usuário. */
  recorteDepartamento: boolean;
  departamentos: DepartamentoAcesso[];
  /** Só os centros de custo marcados no usuário (da gestão dele), e as movimentações só dentro deles (11/10/2026). */
  recorteCentro: boolean;
  gestao: DepartamentoAcesso | null;
  /** Os ids dos centros de custo do usuário. */
  centros: string[];
  /**
   * Acesso a Informações Sensíveis (27/10/2026): vê as movimentações das linhas de Mão de Obra Direta e Indireta
   * (`podeVerSensiveis`). Do perfil.
   */
  informacoesSensiveis: boolean;
};

export type UsuarioAutenticado = {
  sub: string;
  email: string;
  nome: string;
  perfil: { codigo: string; nome: string };
  permissions: string[];
  acesso: Acesso;
};

/**
 * O recorte por departamento (Gestor) vale na DRE, nos centros de custo e nas divergências. A classificação, os
 * lançamentos manuais, a apuração (receita, rateios, estoque, linhas, conferência e o apurar da DRE) e a auditoria mostram
 * lançamentos de todos os departamentos: quem tem o recorte não as alcança, mesmo com a tela liberada, senão o recorte
 * seria contornado. O mesmo vale para o recorte por centro de custo (Coordenador).
 */
// As Validações das contestações (27/10/2026) mostram as de todos os departamentos, como os Lançamentos. O Realizado por
// Obra não tem recorte (27/11/2026, pedido do Adão): quem lê a tela a vê inteira, com qualquer recorte (`semRecorte`).
const FORA_DO_RECORTE_DE_DEPARTAMENTO = new Set([
  "classificacao",
  "lancamentos_manuais",
  "previas",
  "linhas_mes",
  "conferencia",
  "auditoria",
  "contestacoes_validacoes",
]);
/**
 * As abas fora do recorte numa tela que ele alcança (27/10/2026): os Rateios, na tela Totais (os Indicadores ficam); os
 * Créditos de Impostos (03/11/2026), que juntam os custos de todos os departamentos — a aba Impostos dos Resultados
 * Empresariais e, desde 04/11/2026, a dos Resultados do mês.
 */
const ABAS_FORA_DO_RECORTE_DE_DEPARTAMENTO = new Set(["totais.rateios", "relatorio_resultados.impostos", "dre.impostos"]);
/** O recorte por setor (Alimentador) é o das listas operacionais: no Fechamento Mensal, só Competências, Importações e Listas. */
const TELAS_DO_FECHAMENTO = new Set(CATALOGO_DE_TELAS.find((g) => g.recurso === "FECHAMENTO_MENSAL")!.telas.map((t) => t.codigo));
const DENTRO_DO_RECORTE_DE_SETOR = new Set(["competencias", "importacao", "listas_operacionais"]);

/**
 * A matriz do perfil (tela e aba × ação, 14/10/2026) → a lista "área:acao" das rotas, com Editar implicando Ler e os
 * recortes aplicados.
 */
export function permissoesDasRotas(
  permissoes: Array<{ chave: string; acao: AcaoPermissao }>,
  recortes: { recorteSetor: boolean; recorteDepartamento: boolean; recorteCentro?: boolean },
): string[] {
  const tela = (area: string) => area.split(".")[0];
  return areasDaMatriz(permissoes, (area, acao) => {
    if (recortes.recorteDepartamento || recortes.recorteCentro) {
      if (FORA_DO_RECORTE_DE_DEPARTAMENTO.has(tela(area)) || ABAS_FORA_DO_RECORTE_DE_DEPARTAMENTO.has(area)) return true;
      // O apurar da competência (a edição da DRE) mostra todos os departamentos.
      if (area === "dre" && acao === "EDITAR") return true;
      // As linhas (26/10/2026) juntam os lançamentos de todos os departamentos, como a etapa Linhas.
      if (area === "relatorio_resultados.linhas" || area === "relatorio_resultados.rateios_linhas") return true;
    }
    if (recortes.recorteSetor && TELAS_DO_FECHAMENTO.has(tela(area)) && !DENTRO_DO_RECORTE_DE_SETOR.has(tela(area))) return true;
    return false;
  });
}

const SELECAO_DO_USUARIO = {
  id: true,
  nome: true,
  email: true,
  senhaHash: true,
  ativo: true,
  setores: { select: { tipoLista: true } },
  departamentos: { select: { departamento: true } },
  gestao: true,
  centros: { select: { centroCustoId: true } },
  perfil: {
    select: {
      codigo: true,
      nome: true,
      ativo: true,
      recorteSetor: true,
      recorteDepartamento: true,
      recorteCentro: true,
      informacoesSensiveis: true,
      permissoesTelas: { select: { chave: true, acao: true } },
    },
  },
} satisfies Prisma.UsuarioSelect;

/** O usuário com permissões e recortes; nulo se não existe, está inativo ou tem perfil inativo. */
export async function carregarUsuario(filtro: { id: string } | { email: string }): Promise<(UsuarioAutenticado & { senhaHash: string }) | null> {
  const usuario = await getPrismaClient().usuario.findUnique({ where: filtro, select: SELECAO_DO_USUARIO });
  if (!usuario || !usuario.ativo || !usuario.perfil.ativo) return null;
  return montarUsuario(usuario);
}

/** Os usuários ativos, de perfil ativo, com as permissões e os recortes (30/10/2026: quem responde às contestações). */
export async function carregarUsuariosAtivos(): Promise<UsuarioAutenticado[]> {
  const us = await getPrismaClient().usuario.findMany({ where: { ativo: true, perfil: { ativo: true } }, select: SELECAO_DO_USUARIO });
  return us.map((u) => {
    const { senhaHash: _senha, ...x } = montarUsuario(u);
    return x;
  });
}

/** As permissões e os recortes do usuário, a partir do registro dele (SELECAO_DO_USUARIO). */
function montarUsuario(usuario: Prisma.UsuarioGetPayload<{ select: typeof SELECAO_DO_USUARIO }>): UsuarioAutenticado & { senhaHash: string } {
  if (usuario.perfil.codigo === CODIGO_ADMINISTRADOR) {
    return {
      sub: usuario.id,
      email: usuario.email,
      nome: usuario.nome,
      senhaHash: usuario.senhaHash,
      perfil: { codigo: usuario.perfil.codigo, nome: usuario.perfil.nome },
      permissions: permissoesDasRotas(MATRIZ_COMPLETA, { recorteSetor: false, recorteDepartamento: false, recorteCentro: false }),
      acesso: ACESSO_TOTAL,
    };
  }
  return {
    sub: usuario.id,
    email: usuario.email,
    nome: usuario.nome,
    senhaHash: usuario.senhaHash,
    perfil: { codigo: usuario.perfil.codigo, nome: usuario.perfil.nome },
    permissions: permissoesDasRotas(usuario.perfil.permissoesTelas, usuario.perfil),
    acesso: {
      recorteSetor: usuario.perfil.recorteSetor,
      setores: usuario.setores.map((s) => s.tipoLista),
      recorteDepartamento: usuario.perfil.recorteDepartamento,
      departamentos: usuario.departamentos.map((d) => d.departamento),
      recorteCentro: usuario.perfil.recorteCentro,
      gestao: usuario.gestao,
      centros: usuario.centros.map((c) => c.centroCustoId),
      informacoesSensiveis: usuario.perfil.informacoesSensiveis,
    },
  };
}

/** Acesso irrestrito: o de quem não tem recorte nenhum (o Contábil). Para scripts e chamadas internas. */
export const ACESSO_TOTAL: Acesso = {
  recorteSetor: false,
  setores: [],
  recorteDepartamento: false,
  departamentos: [],
  recorteCentro: false,
  gestao: null,
  centros: [],
  informacoesSensiveis: true,
};

/**
 * O acesso do Realizado por Obra (27/11/2026, pedido do Adão: ou o usuário lê a tela, ou não): sem os recortes por setor,
 * departamento e centro de custo, nos Resultados, na API obra-dre e nas consultas da obra na DRE do mês (o extrato, os
 * volumes e o balancete de um centro de obra). As informações sensíveis seguem o perfil.
 */
export const semRecorte = (acesso: Acesso): Acesso => ({ ...ACESSO_TOTAL, informacoesSensiveis: acesso.informacoesSensiveis });

/** O usuário alcança esta lista operacional? */
export const alcancaLista = (acesso: Acesso, tipo: string) => !acesso.recorteSetor || acesso.setores.includes(tipo as TipoImportacao);
