import type { DepartamentoAcesso } from "../../generated/prisma/enums.js";
import type { Acesso } from "./acesso.js";
import { descricaoDeOrigem, slugDaDRE } from "../dre/descricaoDeOrigem.js";

/**
 * Recorte do Gestor por departamento (decisão do usuário, 30/09/2026).
 *
 * A DRE é inteira para todos; o recorte limita as movimentações (o
 * detalhamento até os lançamentos de origem) e a visão por centro de custo aos
 * departamentos do usuário. A visibilidade segue a linha da DRE, e não o centro
 * do lançamento: quem vê uma linha vê tudo o que a formou, inclusive o que veio
 * rateado de outro departamento.
 */

export const ROTULO_DEPARTAMENTO: Record<DepartamentoAcesso, string> = {
  PRODUCAO: "Produção",
  SERVICOS: "Serviços",
  LOGISTICA: "Logística",
  TECNICO: "Técnico",
  COMERCIAL: "Comercial",
  ADMINISTRATIVO: "Administrativo",
  EXTRA_OPERACIONAL: "Extra-Operacional",
};

/** Grupo da DRE (a sigla) → departamento. As DVV se dividem pela linha. */
const POR_SIGLA: Record<string, DepartamentoAcesso> = {
  CPP: "PRODUCAO",
  CSM: "SERVICOS",
  CSC: "SERVICOS",
  DL: "LOGISTICA",
  DT: "TECNICO",
  DC: "COMERCIAL",
  DA: "ADMINISTRATIVO",
  DML: "EXTRA_OPERACIONAL",
  RFC: "EXTRA_OPERACIONAL",
  RFNC: "EXTRA_OPERACIONAL",
  DFC: "EXTRA_OPERACIONAL",
  DFNC: "EXTRA_OPERACIONAL",
};
/** As DVV pela descrição de origem da linha (25/11/2026: a última parte do código, que não muda com a Descrição). */
const DVV_POR_LINHA: Record<string, DepartamentoAcesso> = {
  [slugDaDRE("Frete e Descarga")]: "LOGISTICA",
  [slugDaDRE("Comissões de Representantes e Terceiros")]: "COMERCIAL",
};

/** Departamento do centro de custo (campo DEPARTAMENTO do cadastro) → departamento do recorte. */
const POR_DEPARTAMENTO_DO_CENTRO: Record<string, DepartamentoAcesso> = {
  "CUSTOS DE PRODUÇÃO (CP)": "PRODUCAO",
  "CUSTOS DE SERVIÇOS: MONTAGEM (CSM)": "SERVICOS",
  "CUSTOS DE SERVIÇOS: COMPLEMENTARES (CSC)": "SERVICOS",
  "DESPESAS DE LOGÍSTICA (DL)": "LOGISTICA",
  "DESPESAS TÉCNICAS (DT)": "TECNICO",
  "DESPESAS COMERCIAIS (DC)": "COMERCIAL",
  "DESPESAS ADMINISTRATIVAS (DA)": "ADMINISTRATIVO",
};

const n = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

/** A gestão (departamento do recorte) de um centro de custo, pelo campo DEPARTAMENTO do cadastro; nula se não é de uma. */
export function gestaoDoCentro(departamentoDoCentro: string | null): DepartamentoAcesso | null {
  return POR_DEPARTAMENTO_DO_CENTRO[n(departamentoDoCentro)] ?? null;
}

/** O departamento de uma linha da DRE; nulo para receitas, margens e resultados, que não são de nenhum. */
export function departamentoDaLinha(l: { grupoSigla: string; codigo: string }): DepartamentoAcesso | null {
  if (l.grupoSigla === "DVV") return DVV_POR_LINHA[descricaoDeOrigem(l.codigo)] ?? null;
  return POR_SIGLA[l.grupoSigla] ?? null;
}

/**
 * Grupos da DRE com as movimentações abertas a todos os gestores, de qualquer departamento (11/10/2026): a Receita
 * Operacional Bruta (ROB) e os Impostos sobre a Receita Bruta (IRB); desde 14/10/2026, também a Receita Operacional
 * Líquida (ROL), que é a ROB menos os IRB.
 */
const ABERTOS_A_TODOS = new Set(["ROB", "IRB", "ROL"]);

/**
 * O usuário pode consultar as movimentações desta linha (nas visões das unidades)? Com recorte por centro de custo
 * (Coordenador), só as abertas a todos: as demais ele consulta dentro dos seus centros (`podeVerLinhaNoCentro`).
 */
export function podeVerMovimentos(acesso: Acesso, l: { grupoSigla: string; codigo: string }) {
  if ((!acesso.recorteDepartamento && !acesso.recorteCentro) || ABERTOS_A_TODOS.has(l.grupoSigla)) return true;
  if (!acesso.recorteDepartamento) return false;
  const d = departamentoDaLinha(l);
  return d !== null && acesso.departamentos.includes(d);
}

/**
 * O usuário pode ver este centro de custo? Almoxarifado, investimento e requisição: só sem recorte. Com recorte por
 * centro de custo, só os centros marcados no usuário.
 */
export function podeVerCentro(acesso: Acesso, centro: { id: string; departamento: string | null }) {
  if (acesso.recorteCentro && !acesso.centros.includes(centro.id)) return false;
  if (!acesso.recorteDepartamento) return true;
  const d = POR_DEPARTAMENTO_DO_CENTRO[n(centro.departamento)];
  return d !== undefined && acesso.departamentos.includes(d);
}

/**
 * O usuário alcança os resultados das obras? Com recorte por centro de custo (Coordenador), só com a opção marcada no
 * cadastro dele (11/10/2026); os demais, sempre (o Gestor, nas linhas dos seus departamentos).
 */
export const veObras = (acesso: Acesso) => !acesso.recorteCentro || acesso.recorteDepartamento || acesso.veObras;

/**
 * Nas obras, as linhas que o usuário vê: o Coordenador com a opção, as da gestão dele e as abertas a todos (como um
 * Gestor daquele departamento); os demais, as das movimentações (`podeVerMovimentos`).
 */
export function podeVerLinhaNaObra(acesso: Acesso, l: { grupoSigla: string; codigo: string }) {
  if (acesso.recorteCentro && !acesso.recorteDepartamento) {
    return acesso.veObras && (ABERTOS_A_TODOS.has(l.grupoSigla) || (acesso.gestao !== null && departamentoDaLinha(l) === acesso.gestao));
  }
  return podeVerMovimentos(acesso, l);
}

/**
 * As linhas com informações sensíveis (27/10/2026, pedido do Adão): as de Mão de Obra Direta (MOD) e Indireta (MOI) de
 * cada grupo da DRE — as Remunerações CLT e PJ, as Horas Extras, as Multas Rescisórias, os Encargos e Benefícios e o Pró
 * Labore Diretoria. A Mão de Obra Terceirizada (MOT) não é delas.
 */
const ATRIBUICOES_SENSIVEIS = new Set(["MOD", "MOI"]);
export const linhaSensivel = (l: { atribuicaoSigla: string | null }) => ATRIBUICOES_SENSIVEIS.has(l.atribuicaoSigla ?? "");

/**
 * O usuário vê as movimentações desta linha, quanto às informações sensíveis? Sem o Acesso a Informações Sensíveis do
 * perfil, não as das linhas de Mão de Obra Direta e Indireta (os extratos, os documentos e a aba Detalhes do Exportar),
 * em qualquer visão (unidades, centros de custo, obras e sem centro); os valores da DRE ficam. Vale por cima dos recortes.
 */
export const podeVerSensiveis = (acesso: Acesso, l: { atribuicaoSigla: string | null }) => acesso.informacoesSensiveis || !linhaSensivel(l);

/** A mensagem da movimentação sensível recusada. */
export const MENSAGEM_SENSIVEL = (descricao: string) =>
  `As movimentações de "${descricao}" são informações sensíveis (Mão de Obra Direta e Indireta): o seu perfil não tem acesso a elas.`;

/**
 * Nas visões por centro de custo, as linhas cujas movimentações o usuário consulta: o Gestor, as dos departamentos
 * dele (como nas unidades); o Coordenador, todas as dos seus centros (o centro já recorta).
 */
export function podeVerLinhaNoCentro(acesso: Acesso, l: { grupoSigla: string; codigo: string }) {
  return acesso.recorteDepartamento ? podeVerMovimentos(acesso, l) : true;
}
