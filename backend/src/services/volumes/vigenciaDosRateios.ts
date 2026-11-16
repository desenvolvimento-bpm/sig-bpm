import { createHash } from "node:crypto";

import { getPrismaClient } from "../../config/prisma.js";
import { peloTexto } from "../../lib/ordemDoSqlite.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { CHAVES_DE_RATEIO, NOME_DA_CHAVE } from "./rateiosService.js";
import { rotuloDoMes, valeNoMes } from "./vigenciasRateio.js";

/**
 * As regras de rateio por mês (14/10/2026): as chaves sem regra vigente (o aviso e o bloqueio no Fechamento Mensal e
 * nos Cenários Analíticos), os percentuais de cada mês de um cenário analítico pelas regras (o percentual fixo, ou o
 * das bases das premissas entre os destinos das regras por volume) e a assinatura das regras de um cálculo (o
 * Recalcular dos Resultados do cenário).
 */

export type RegraDoMes = {
  id: string;
  chave: string;
  destino: string;
  vigenciaInicio: Date;
  vigenciaFim: Date | null;
  percentualFixo: Prisma.Decimal | null;
  atualizadoEm: Date;
};

type Db = Pick<ReturnType<typeof getPrismaClient>, "regraRateio">;

/** Todas as regras de rateio, com a vigência, o percentual fixo e a data de alteração. */
export async function regrasDeRateio(db: Db = getPrismaClient()): Promise<RegraDoMes[]> {
  const rs = await db.regraRateio.findMany({
    select: { id: true, chave: true, destino: true, vigenciaInicio: true, vigenciaFim: true, percentualFixo: true, atualizadoEm: true },
    orderBy: [{ vigenciaInicio: "asc" }, { id: "asc" }],
  });
  // A chave pelo texto, como no SQLite (23/10/2026: no PostgreSQL, o enum ordena pela declaração).
  return rs.sort(peloTexto((r) => r.chave));
}

const vigencia = (r: RegraDoMes) => ({ inicio: r.vigenciaInicio, fim: r.vigenciaFim });
const nome = (c: string) => NOME_DA_CHAVE[c] ?? c;

/** As chaves sem regra vigente no mês (1 a 12). */
export const chavesSemRegra = (regras: RegraDoMes[], ano: number, mes: number) =>
  CHAVES_DE_RATEIO.filter((c) => !regras.some((r) => r.chave === c && valeNoMes(vigencia(r), ano, mes)));

/**
 * Os avisos dos meses: por chave, os meses sem regra (em períodos seguidos), e os conjuntos de percentuais fixos que
 * valem em algum dos meses e não somam 100%.
 */
export function avisosDosRateios(regras: RegraDoMes[], meses: Array<{ ano: number; mes: number }>) {
  const avisos: string[] = [];
  for (const chave of CHAVES_DE_RATEIO) {
    const sem = meses.filter((m) => chavesSemRegra(regras, m.ano, m.mes).includes(chave)).map((m) => m.ano * 12 + m.mes - 1).sort((a, b) => a - b);
    if (!sem.length) continue;
    const periodos: Array<[number, number]> = [];
    for (const m of sem) {
      const ultimo = periodos[periodos.length - 1];
      if (ultimo && ultimo[1] === m - 1) ultimo[1] = m;
      else periodos.push([m, m]);
    }
    const texto = periodos.map(([a, b]) => (a === b ? rotuloDoMes(a) : `${rotuloDoMes(a)} a ${rotuloDoMes(b)}`)).join(", ");
    avisos.push(`Rateio de ${nome(chave)} sem regra vigente em ${texto}: cadastre a regra em Cadastros Gerais / Regras de Rateio.`);
  }
  const somas = new Map<string, { soma: number; regra: RegraDoMes }>();
  for (const r of regras.filter((x) => x.percentualFixo !== null && meses.some((m) => valeNoMes(vigencia(x), m.ano, m.mes)))) {
    const k = `${r.chave}|${r.vigenciaInicio.toISOString()}`;
    somas.set(k, { soma: (somas.get(k)?.soma ?? 0) + Number(r.percentualFixo), regra: r });
  }
  for (const { soma, regra } of somas.values())
    if (Math.abs(soma - 1) > 0.00005)
      avisos.push(`Rateio de ${nome(regra.chave)}: os percentuais fixos a partir de ${regra.vigenciaInicio.toISOString().slice(0, 10).split("-").reverse().join("/")} somam ${(soma * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%, e não 100%.`);
  return avisos;
}

/** Por que abrir ou fechar (`acao`) não pode (nulo se pode): os rateios sem regra vigente em algum dos meses. */
export function bloqueioPorRateios(regras: RegraDoMes[], meses: Array<{ ano: number; mes: number }>, acao: string) {
  const sem = avisosDosRateios(regras, meses).filter((a) => a.includes("sem regra vigente"));
  return sem.length ? `Não é possível ${acao}: ${sem.map((a) => a.replace(/: cadastre a regra.*$/, "")).join("; ")}. Cadastre as regras em Cadastros Gerais / Regras de Rateio.` : null;
}

/** Os doze meses de um exercício. */
export const mesesDoAno = (ano: number) => Array.from({ length: 12 }, (_, k) => ({ ano, mes: k + 1 }));

/** A assinatura das regras (o id e a data de alteração de cada uma): muda se alguma regra é criada, editada ou excluída. */
export const assinaturaDasRegras = (regras: RegraDoMes[]) =>
  createHash("sha1")
    .update(regras.map((r) => `${r.id}|${r.atualizadoEm.toISOString()}`).sort().join(";"))
    .digest("hex");

/**
 * Os percentuais de cada mês de um cenário analítico pelas regras de rateio vigentes ("CHAVE|DESTINO" → a parte):
 * numa chave com percentuais fixos no mês, eles; com regras por volume, a base das premissas de cada destino delas
 * sobre a soma desses destinos; sem regra, nenhum (o valor fica fora das unidades, como no Fechamento Mensal).
 */
export function percentuaisPelasRegras(regras: RegraDoMes[], ano: number, bases: Map<string, number[]>) {
  return Array.from({ length: 12 }, (_, k) => {
    const p = new Map<string, number>();
    for (const chave of CHAVES_DE_RATEIO) {
      const vigentes = regras.filter((r) => r.chave === chave && valeNoMes(vigencia(r), ano, k + 1));
      if (!vigentes.length) continue;
      const fixas = vigentes.filter((r) => r.percentualFixo !== null);
      if (fixas.length) {
        for (const r of fixas) p.set(`${chave}|${r.destino}`, (p.get(`${chave}|${r.destino}`) ?? 0) + Number(r.percentualFixo));
        continue;
      }
      const destinos = [...new Set(vigentes.map((r) => r.destino))];
      const total = destinos.reduce((s, d) => s + (bases.get(`${chave}|${d}`)?.[k] ?? 0), 0);
      for (const d of destinos) p.set(`${chave}|${d}`, total ? (bases.get(`${chave}|${d}`)?.[k] ?? 0) / total : 0);
    }
    return p;
  });
}
