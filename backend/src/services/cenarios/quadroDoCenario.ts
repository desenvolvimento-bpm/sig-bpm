import { randomUUID } from "node:crypto";

import type { Prisma } from "../../generated/prisma/client.js";
import { chaveDoNome } from "../colaboradores/importacaoCadastros.js";
import type { GrupoDoCenario } from "./centrosCenario.js";

/**
 * A aba Quadro de Lotação dos cenários analíticos (09/11/2026, etapa 4 da Gestão de Colaboradores; decisões do Adão):
 *
 * - cada linha é como a do Lançamento Inicial — a Unidade, o Tipo (CLT ou PJ), a Senioridade, a Função e o Centro de
 *   Custo (um dos centros dos grupos do cenário) — e tem, em cada mês, os Colaboradores e o Salário Bruto e a
 *   Insalubridade / Periculosidade de cada um (o Salário Total é a soma; a linha vale colaboradores × Salário Total);
 * - o grupo de centros com alguma linha conta por elas: os Colaboradores (a soma das linhas dos centros dele) e as
 *   Remunerações CLT e PJ, que não se digitam;
 * - Aprendizes, Estagiários, CLT e PJ (11/11/2026, pedido do Adão): os colaboradores se contam em quatro, pela senioridade
 *   e pelo tipo — os Aprendizes (a senioridade Aprendiz: o Jovem Aprendiz), os Estagiários (a senioridade Estagiário: os
 *   estagiários e os bolsistas, da Lei 11.788/2008), os CLT e os PJ (as demais senioridades, pelo tipo); o Total de
 *   Colaboradores é a soma dos quatro;
 * - os Salários dos mesmos quatro (12/11/2026, pedido do Adão; antes, os dos aprendizes e os dos estagiários de cada mão de
 *   obra, pela atribuição do centro de cada linha): colaboradores × Salário Total das linhas de cada um. Todos vão para a mão
 *   de obra da atribuição do grupo (Direta: a MOD; Indireta ou sem atribuição: a MOI; a outra, quando o grupo da DRE só tem
 *   uma) — a outra mão de obra fica sem remunerações do quadro: as Remunerações CLT dela são os Salários dos Aprendizes, dos
 *   Estagiários e CLT, e as Remunerações PJ, os Salários PJ. O Fundo de Garantia: Aprendiz vale sobre os Salários dos
 *   Aprendizes, e os Salários dos Estagiários saem da base dos Encargos e Benefícios (o estagiário não tem INSS, FGTS, férias
 *   com o terço nem 13º; encargosCenario.ts);
 * - o grupo sem linhas fica como antes: os colaboradores e as remunerações digitados ou da referência.
 *
 * O cálculo do cenário (calcularAnalitico) grava o que os grupos com linhas recebem nas premissas e nos centros, como as
 * outras contas, para a tela, as exportações, os indicadores e a DRE.
 */

export type MesDaLinha = { colaboradores: number; salarioBruto: number; adicional: number };
/** Uma linha para o cálculo: o tipo, se é de aprendiz ou de estagiário, o código do centro e os doze meses. */
export type LinhaDoQuadro = {
  vinculo: "CLT" | "PJ";
  aprendiz: boolean;
  estagiario: boolean;
  codigo: string | null;
  meses: MesDaLinha[];
};
/** Os quatro tipos de colaboradores (11/11/2026), nas contagens e, desde 12/11/2026, nos salários. */
export type TipoDeColaborador = "aprendizes" | "estagiarios" | "clt" | "pj";
export const TIPOS_DE_COLABORADORES: TipoDeColaborador[] = ["aprendizes", "estagiarios", "clt", "pj"];
/** Os Salários de um grupo (12/11/2026): de cada tipo, colaboradores × Salário Total das linhas, nos doze meses. */
export type SalariosDoGrupo = Record<TipoDeColaborador, number[]>;
/**
 * O que um grupo com linhas recebe: os colaboradores de cada mês — Aprendizes, Estagiários, CLT e PJ (estes dois sem os
 * aprendizes e os estagiários) —, os salários dos mesmos quatro e quantas linhas ele tem.
 */
export type QuadroDoGrupo = Record<TipoDeColaborador, number[]> & { salarios: SalariosDoGrupo; linhas: number };
/** O tipo de uma linha: a senioridade (Aprendiz, Estagiário) e, nas demais, o vínculo. */
export const tipoDaLinha = (l: Pick<LinhaDoQuadro, "vinculo" | "aprendiz" | "estagiario">): TipoDeColaborador =>
  l.aprendiz ? "aprendizes" : l.estagiario ? "estagiarios" : l.vinculo === "CLT" ? "clt" : "pj";
/**
 * As Remunerações do Quadro de Lotação num mês (k: 0 a 11), as da mão de obra do grupo: CLT, os Salários dos Aprendizes, dos
 * Estagiários e CLT; PJ, os Salários PJ (12/11/2026).
 */
export const remuneracoesDoQuadro = (s: SalariosDoGrupo, k: number) => ({ clt: s.aprendizes[k] + s.estagiarios[k] + s.clt[k], pj: s.pj[k] });

/** A senioridade dos aprendizes (sem diferença de maiúsculas e acentos). */
export const ehAprendiz = (senioridade: string) => chaveDoNome(senioridade) === chaveDoNome("Aprendiz");
/** A senioridade dos estagiários e dos bolsistas (11/11/2026; sem diferença de maiúsculas e acentos). */
export const ehEstagiario = (senioridade: string) => chaveDoNome(senioridade) === chaveDoNome("Estagiário");
export const salarioTotal = (m: MesDaLinha) => m.salarioBruto + m.adicional;
const doze = () => Array<number>(12).fill(0);

/**
 * Os grupos de centros com linhas no Quadro de Lotação do cenário (os que não estão no mapa não têm colaboradores nem
 * salários); a linha de um centro fora dos grupos não conta.
 */
export function quadroDosGrupos(linhas: LinhaDoQuadro[], grupos: GrupoDoCenario[]) {
  const grupoDoCodigo = new Map(grupos.flatMap((g) => g.centros.filter((c) => c.codigo).map((c) => [c.codigo!, g] as const)));
  const r = new Map<string, QuadroDoGrupo>();
  for (const l of linhas) {
    const g = l.codigo ? grupoDoCodigo.get(l.codigo) : undefined;
    if (!g) continue;
    let q = r.get(g.grupo);
    if (!q) {
      q = { aprendizes: doze(), estagiarios: doze(), clt: doze(), pj: doze(), salarios: { aprendizes: doze(), estagiarios: doze(), clt: doze(), pj: doze() }, linhas: 0 };
      r.set(g.grupo, q);
    }
    q.linhas++;
    // Os colaboradores e os salários pela senioridade (Aprendiz, Estagiário) e, nas demais, pelo vínculo.
    const tipo = tipoDaLinha(l);
    l.meses.forEach((m, k) => {
      q.salarios[tipo][k] += m.colaboradores * salarioTotal(m);
      q[tipo][k] += m.colaboradores;
    });
  }
  return r;
}

type Db = Pick<Prisma.TransactionClient, "cenarioLotacao">;

/** As linhas do Quadro de Lotação de um cenário para o cálculo. */
export async function linhasDoQuadro(db: Db, cenarioId: string): Promise<LinhaDoQuadro[]> {
  const ls = await db.cenarioLotacao.findMany({
    where: { cenarioId },
    select: { vinculo: true, senioridade: { select: { nome: true } }, centroCusto: { select: { codigoRM: true } }, meses: true },
  });
  return ls.map((l) => ({
    vinculo: l.vinculo,
    aprendiz: ehAprendiz(l.senioridade.nome),
    estagiario: ehEstagiario(l.senioridade.nome),
    codigo: l.centroCusto.codigoRM,
    meses: mesesDaLinha(l.meses),
  }));
}

/** Os doze meses de uma linha (o mês sem registro, zero). */
export function mesesDaLinha(meses: Array<{ mes: number; colaboradores: unknown; salarioBruto: unknown; adicional: unknown }>): MesDaLinha[] {
  const porMes = new Map(meses.map((m) => [m.mes, m]));
  return Array.from({ length: 12 }, (_, k) => {
    const m = porMes.get(k + 1);
    return { colaboradores: Number(m?.colaboradores ?? 0), salarioBruto: Number(m?.salarioBruto ?? 0), adicional: Number(m?.adicional ?? 0) };
  });
}

/** Copia as linhas do Quadro de Lotação de um cenário para outro (a cópia, a revisão e a referência de outro analítico). */
export async function copiarQuadro(tx: Pick<Prisma.TransactionClient, "cenarioLotacao" | "cenarioLotacaoMes">, de: string, para: string) {
  const linhas = await tx.cenarioLotacao.findMany({ where: { cenarioId: de }, include: { meses: true } });
  if (!linhas.length) return;
  const novas = linhas.map((l) => ({ ...l, novoId: randomUUID() }));
  await tx.cenarioLotacao.createMany({
    data: novas.map(({ id: _id, novoId, meses: _meses, criadoEm: _criado, atualizadoEm: _atualizado, ...x }) => ({ ...x, id: novoId, cenarioId: para })),
  });
  const meses = novas.flatMap((l) => l.meses.map(({ linhaId: _linha, ...m }) => ({ ...m, linhaId: l.novoId })));
  for (let i = 0; i < meses.length; i += 1000) await tx.cenarioLotacaoMes.createMany({ data: meses.slice(i, i + 1000) });
}
