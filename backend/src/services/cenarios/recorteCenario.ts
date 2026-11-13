import type { DepartamentoAcesso } from "../../generated/prisma/enums.js";
import type { GrupoDoCenario } from "./centrosCenario.js";
import { departamentoDoGrupoDRE, departamentosDaLinha, departamentosDaUnidade, type Departamento, type LinhaDaPlanilha } from "./planilhaPremissas.js";

/**
 * O Acesso às Informações dos cenários analíticos (12/11/2026, pedido do Adão): com “Por Recorte”, quem tem recorte no perfil
 * vê só as premissas e o histórico do seu recorte. O Gestor (recorte por departamento) vê o que é dos departamentos dele, pela
 * regra do Exportar Premissas (`departamentosDaLinha`); o Coordenador (recorte por centro de custo) vê só os grupos de centros
 * com algum centro dele (o Quadro de Lotação, os Centros de Custo e os Rateios deles). Quem criou o cenário e o Administrador
 * veem tudo; com “Geral”, todos veem tudo.
 */
export type RecorteDoUsuario = { departamentos: DepartamentoAcesso[] | null; centros: string[] | null };
export type Recorte = { departamentos: Set<Departamento>; centros: Set<string> | null };

const DO_ACESSO: Record<DepartamentoAcesso, Departamento> = {
  PRODUCAO: "PRODUCAO",
  SERVICOS: "SERVICOS",
  LOGISTICA: "LOGISTICA",
  TECNICO: "TECNICO",
  COMERCIAL: "COMERCIAL",
  ADMINISTRATIVO: "ADMINISTRATIVO",
  EXTRA_OPERACIONAL: "EXTRA",
};
/** O departamento do cadastro (DepartamentoAcesso) de um departamento das premissas. */
export const acessoDoDepartamento = (d: Departamento): DepartamentoAcesso => (Object.keys(DO_ACESSO) as DepartamentoAcesso[]).find((k) => DO_ACESSO[k] === d)!;
export const departamentoDoAcesso = (d: DepartamentoAcesso): Departamento => DO_ACESSO[d];

/** Os departamentos que têm centros de custo e indicadores manuais (o Extra-Operacional não tem). */
const COM_CENTROS: Departamento[] = ["PRODUCAO", "SERVICOS", "LOGISTICA", "TECNICO", "COMERCIAL", "ADMINISTRATIVO"];

/** O recorte do usuário no cenário; null: vê tudo (Geral, quem criou, o Administrador ou quem não tem recorte). */
export function recorteDoCenario(
  c: { tipo: string; acessoInformacoes: string; criadoPorId: string | null },
  u: { id: string; admin?: boolean; recorte?: RecorteDoUsuario | null },
): Recorte | null {
  if (c.tipo !== "ANALITICO" || c.acessoInformacoes !== "POR_RECORTE" || u.admin || (!!c.criadoPorId && c.criadoPorId === u.id) || !u.recorte) return null;
  if (u.recorte.centros) return { departamentos: new Set(), centros: new Set(u.recorte.centros) };
  if (u.recorte.departamentos) return { departamentos: new Set(u.recorte.departamentos.map(departamentoDoAcesso)), centros: null };
  return null;
}

/** Algum dos departamentos está no recorte (o Coordenador não vê o que é só de departamento). */
export const veDepartamentos = (r: Recorte | null, ds: Departamento[]) => !r || ds.some((d) => r.departamentos.has(d));

/** O grupo de centros está no recorte: o do departamento do Gestor, ou o com algum centro do Coordenador. */
export function veGrupo(r: Recorte | null, g: Pick<GrupoDoCenario, "grupoDRE" | "centros">) {
  if (!r) return true;
  if (r.centros) return g.centros.some((x) => r.centros!.has(x.id));
  const d = departamentoDoGrupoDRE(g.grupoDRE);
  return !!d && r.departamentos.has(d);
}

/** Os grupos de centros do recorte. */
export const gruposDoRecorte = <G extends Pick<GrupoDoCenario, "grupoDRE" | "centros">>(r: Recorte | null, grupos: G[]) => (r ? grupos.filter((g) => veGrupo(r, g)) : grupos);

/** Uma linha da planilha das premissas no recorte: a dos centros, pelo grupo; as demais, pelos departamentos. */
export function veLinha(r: Recorte | null, l: Pick<LinhaDaPlanilha, "chave" | "descricao">, grupos: Map<string, Pick<GrupoDoCenario, "grupoDRE" | "centros">>) {
  if (!r) return true;
  const [tipo, a] = l.chave.split("|");
  if (tipo === "C" || tipo === "L" || tipo === "E") {
    const g = grupos.get(a);
    return !!g && veGrupo(r, g);
  }
  return veDepartamentos(r, departamentosDaLinha(l, new Map([...grupos].map(([k, g]) => [k, g.grupoDRE]))));
}

/**
 * Os departamentos de um investimento (12/11/2026): os da unidade (Matriz e Filial, Produção; Serviços, Serviços); em
 * Despesas e Extra, o Departamento dele (sem ele, os cinco do patrimônio).
 */
export const departamentosDoInvestimento = (i: { unidade: number; departamento: DepartamentoAcesso | null }): Departamento[] =>
  i.unidade === 4 && i.departamento ? [departamentoDoAcesso(i.departamento)] : departamentosDaUnidade(i.unidade);

/** Os departamentos que podem ser o de um investimento de Despesas e Extra (os do patrimônio). */
export const DEPARTAMENTOS_DO_PATRIMONIO: DepartamentoAcesso[] = ["LOGISTICA", "TECNICO", "COMERCIAL", "ADMINISTRATIVO", "EXTRA_OPERACIONAL"];

/** O centro de custo (de uma linha do Quadro de Lotação) no recorte: o do Coordenador, ou o de um grupo do departamento do Gestor. */
export function veCentro(r: Recorte | null, centroId: string, grupo: Pick<GrupoDoCenario, "grupoDRE" | "centros"> | null | undefined) {
  if (!r) return true;
  if (r.centros) return r.centros.has(centroId);
  return !!grupo && veGrupo(r, grupo);
}

/**
 * As abas das Premissas do recorte (as chaves da tela): o Coordenador, só as dos centros; o Gestor, as dos departamentos dele
 * (Matriz e Filial, da Produção; Serviços, dos Serviços; os Rateios, da Produção e dos Serviços; o Extra-Operacional, dele;
 * os Investimentos, de todos; os Indicadores Manuais, que são do Comercial e do Administrativo, desses dois).
 */
export function abasDoRecorte(r: Recorte | null): string[] | null {
  if (!r) return null;
  if (r.centros) return ["quadro", "centros", "rateios"];
  const tem = (...ds: Departamento[]) => ds.some((d) => r.departamentos.has(d));
  return [
    ...(tem("PRODUCAO") ? ["1", "2"] : []),
    ...(tem("SERVICOS") ? ["3"] : []),
    ...(tem(...COM_CENTROS) ? ["quadro", "centros"] : []),
    ...(tem("PRODUCAO", "SERVICOS") ? ["rateios"] : []),
    ...(r.departamentos.size ? ["investimentos"] : []),
    ...(tem("EXTRA") ? ["extra"] : []),
    ...(tem("COMERCIAL", "ADMINISTRATIVO") ? ["manuais"] : []),
  ];
}

/** O recorte para a tela (o `obter` do cenário): os departamentos, se é por centro e as abas das Premissas. */
export function recorteParaTela(r: Recorte | null) {
  return r ? { departamentos: [...r.departamentos], porCentro: !!r.centros, abas: abasDoRecorte(r)! } : null;
}

/** A recusa de um trecho fora do recorte. */
export const FORA_DO_RECORTE = "Fora do seu recorte: o cenário tem o Acesso às Informações Por Recorte, e o seu perfil só vê as premissas dos seus departamentos ou centros de custo.";

/**
 * O alcance de uma alteração do histórico (12/11/2026, a coluna `alcance`): os trechos das premissas tocados, cada um com os
 * departamentos dele (vale para qualquer um deles: a depreciação base de Despesas e Extra é dos cinco do patrimônio) e, nos
 * centros de custo e no Quadro de Lotação, o grupo de centros.
 */
export type Trecho = { d: Departamento[]; g?: string };
/** Os trechos sem repetição. */
export const trechos = (ts: Trecho[]): Trecho[] => [...new Map(ts.map((t) => [JSON.stringify(t), t])).values()];
/** O trecho de um grupo de centros. */
export function trechoDoGrupo(g: Pick<GrupoDoCenario, "grupo" | "grupoDRE">): Trecho {
  const d = departamentoDoGrupoDRE(g.grupoDRE);
  return { d: d ? [d] : [], g: g.grupo };
}
/** Os trechos de uma linha da planilha das premissas. */
export function trechoDaLinha(l: Pick<LinhaDaPlanilha, "chave" | "descricao">, grupos: Map<string, Pick<GrupoDoCenario, "grupo" | "grupoDRE">>): Trecho {
  const [tipo, a] = l.chave.split("|");
  if (tipo === "C" || tipo === "L" || tipo === "E") {
    const g = grupos.get(a);
    return g ? trechoDoGrupo(g) : { d: [] };
  }
  return { d: departamentosDaLinha(l, new Map([...grupos].map(([k, g]) => [k, g.grupoDRE]))) };
}

/** As alterações do cenário inteiro (a referência, os recálculos e os reajustes, as médias de quem vê tudo): todos as veem. */
const GERAIS = new Set(["REFERENCIA", "RECALCULO", "MEDIAS"]);
const UNIDADE_DO_NOME: Record<string, number> = { Matriz: 1, Filial: 2, Serviços: 3 };

/**
 * Os trechos de uma alteração de antes da coluna `alcance`, pela descrição (as premissas de uma unidade, um grupo de centros,
 * o extra-operacional, os investimentos pela conta); "geral" nas do cenário inteiro; vazio quando não se sabe (fica oculta
 * para quem vê por recorte).
 */
function alcanceDeAntes(
  x: { tipo: string; descricao: string | null; contas: unknown },
  grupos: Map<string, Pick<GrupoDoCenario, "grupo" | "grupoDRE">>,
  unidadeDaConta: (conta: string) => number | null,
): Trecho[] | "geral" {
  if (GERAIS.has(x.tipo)) return "geral";
  const d = x.descricao ?? "";
  const m = d.match(/^Premissas · (.+)$/);
  if (m && UNIDADE_DO_NOME[m[1]]) return [{ d: departamentosDaUnidade(UNIDADE_DO_NOME[m[1]]) }];
  const g = d.match(/^Centros de Custo · (.+)$/);
  if (g) return grupos.has(g[1]) ? [trechoDoGrupo(grupos.get(g[1])!)] : [];
  if (d === "Extra-Operacional") return [{ d: ["EXTRA"] }];
  if (d.startsWith("Investimentos · ")) {
    const us = ((x.contas ?? []) as Array<{ codigo: string }>).map((c) => unidadeDaConta(c.codigo));
    return us.length && us.every((u) => u !== null) ? trechos(us.map((u) => ({ d: departamentosDaUnidade(u!) }))) : [];
  }
  return [];
}

/** A alteração do histórico no recorte: todos os trechos dela (o grupo, para o Coordenador; os departamentos, para o Gestor). */
export function veAlteracao(
  r: Recorte | null,
  x: { tipo: string; descricao: string | null; contas: unknown; alcance: unknown },
  grupos: Map<string, Pick<GrupoDoCenario, "grupo" | "grupoDRE" | "centros">>,
  unidadeDaConta: (conta: string) => number | null,
) {
  if (!r) return true;
  const ts = (x.alcance as Trecho[] | null) ?? alcanceDeAntes(x, grupos, unidadeDaConta);
  if (ts === "geral") return true;
  if (!ts.length) return false;
  return ts.every((t) => (r.centros ? !!t.g && grupos.has(t.g) && veGrupo(r, grupos.get(t.g)!) : veDepartamentos(r, t.d)));
}

/** O departamento de uma conta da DRE pela sigla do grupo (as Justificativas do Histórico): os centros e o extra-operacional. */
const DA_SIGLA: Record<string, Departamento> = {
  CPP: "PRODUCAO",
  CSM: "SERVICOS",
  CSC: "SERVICOS",
  DL: "LOGISTICA",
  DT: "TECNICO",
  DC: "COMERCIAL",
  DA: "ADMINISTRATIVO",
  DML: "EXTRA",
  RFC: "EXTRA",
  RFNC: "EXTRA",
  DFC: "EXTRA",
  DFNC: "EXTRA",
};
export const departamentosDaConta = (codigo: string): Departamento[] => (DA_SIGLA[codigo.split(".")[0]] ? [DA_SIGLA[codigo.split(".")[0]]] : []);
