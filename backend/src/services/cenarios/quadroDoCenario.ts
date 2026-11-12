import { randomUUID } from "node:crypto";

import type { Prisma } from "../../generated/prisma/client.js";
import { chaveDoNome } from "../colaboradores/importacaoCadastros.js";
import type { GrupoDoCenario } from "./centrosCenario.js";
import { maosDeObraDoGrupo } from "./encargosCenario.js";

/**
 * A aba Quadro de Lotação dos cenários analíticos (09/11/2026, etapa 4 da Gestão de Colaboradores; decisões do Adão):
 *
 * - cada linha é como a do Lançamento Inicial — a Unidade, o Tipo (CLT ou PJ), a Senioridade, a Função e o Centro de
 *   Custo (um dos centros dos grupos do cenário) — e tem, em cada mês, os Colaboradores e o Salário Bruto e a
 *   Insalubridade / Periculosidade de cada um (o Salário Total é a soma; a linha vale colaboradores × Salário Total);
 * - o grupo de centros com alguma linha conta por elas: os Colaboradores CLT e PJ (a soma das linhas dos centros dele) e as
 *   Remunerações CLT e PJ de cada mão de obra, que deixam de se digitar. A mão de obra de uma linha é a da atribuição do
 *   centro dela (Direta: a MOD; Indireta: a MOI); sem atribuição, a do grupo (a dos Benefícios Adicionais);
 * - o Fundo de Garantia: Aprendiz vale sobre os salários das linhas CLT de senioridade Aprendiz (encargosCenario.ts);
 * - Aprendizes, Estagiários, CLT e PJ (11/11/2026, pedido do Adão): os colaboradores se contam em quatro, pela senioridade
 *   e pelo tipo — os Aprendizes (a senioridade Aprendiz: o Jovem Aprendiz), os Estagiários (a senioridade Estagiário: os
 *   estagiários e os bolsistas, da Lei 11.788/2008), os CLT e os PJ (as demais senioridades, pelo tipo); o Total de
 *   Colaboradores é a soma dos quatro. Os salários continuam nas Remunerações pelo tipo da linha; os dos estagiários CLT
 *   saem da base dos Encargos e Benefícios (o estagiário não tem INSS, FGTS, férias com o terço nem 13º);
 * - o grupo sem linhas fica como antes: os colaboradores e as remunerações digitados ou da referência.
 *
 * O cálculo do cenário (calcularAnalitico) grava o que os grupos com linhas recebem nas premissas e nos centros, como as
 * outras contas, para a tela, as exportações, os indicadores e a DRE.
 */

export type MesDaLinha = { colaboradores: number; salarioBruto: number; adicional: number };
/** Uma linha para o cálculo: o tipo, se é de aprendiz ou de estagiário, o centro (o código e a atribuição) e os doze meses. */
export type LinhaDoQuadro = {
  vinculo: "CLT" | "PJ";
  aprendiz: boolean;
  estagiario: boolean;
  codigo: string | null;
  atribuicao: "DIRETA" | "INDIRETA" | null;
  meses: MesDaLinha[];
};
/**
 * Por mão de obra (o prefixo "CPP.MOD"…): as Remunerações CLT e PJ e os salários dos aprendizes e dos estagiários (a parte
 * CLT de cada um: a que está nas Remunerações CLT).
 */
export type SalariosDaMaoDeObra = { clt: number[]; pj: number[]; aprendizes: number[]; estagiarios: number[] };
/**
 * O que um grupo com linhas recebe: os colaboradores de cada mês — Aprendizes, Estagiários, CLT e PJ (estes dois sem os
 * aprendizes e os estagiários) —, as mãos de obra e quantas linhas ele tem.
 */
export type QuadroDoGrupo = { aprendizes: number[]; estagiarios: number[]; clt: number[]; pj: number[]; maos: Map<string, SalariosDaMaoDeObra>; linhas: number };

/** A senioridade dos aprendizes (sem diferença de maiúsculas e acentos). */
export const ehAprendiz = (senioridade: string) => chaveDoNome(senioridade) === chaveDoNome("Aprendiz");
/** A senioridade dos estagiários e dos bolsistas (11/11/2026; sem diferença de maiúsculas e acentos). */
export const ehEstagiario = (senioridade: string) => chaveDoNome(senioridade) === chaveDoNome("Estagiário");
export const salarioTotal = (m: MesDaLinha) => m.salarioBruto + m.adicional;
/**
 * A mão de obra de uma linha (do centro dela): a da atribuição do centro (Direta: a MOD; Indireta: a MOI) ou, sem ela, a
 * do grupo (a dos Benefícios Adicionais).
 */
export function maoDeObraDaLinha<T extends { prefixo: string; beneficios: boolean }>(maos: T[], atribuicao: "DIRETA" | "INDIRETA" | null): T | undefined {
  const daAtribuicao = atribuicao === "DIRETA" ? maos.find((m) => m.prefixo.endsWith(".MOD")) : atribuicao === "INDIRETA" ? maos.find((m) => m.prefixo.endsWith(".MOI")) : undefined;
  return daAtribuicao ?? maos.find((m) => m.beneficios) ?? maos[0];
}
const doze = () => Array<number>(12).fill(0);

/**
 * Os grupos de centros com linhas no Quadro de Lotação do cenário (os que não estão no mapa ficam como antes). `contas(g)`
 * dá os códigos das contas do grupo (as mãos de obra saem delas); a linha de um centro fora dos grupos não conta.
 */
export function quadroDosGrupos(linhas: LinhaDoQuadro[], grupos: GrupoDoCenario[], contas: (g: GrupoDoCenario) => string[]) {
  const grupoDoCodigo = new Map(grupos.flatMap((g) => g.centros.filter((c) => c.codigo).map((c) => [c.codigo!, g] as const)));
  const r = new Map<string, QuadroDoGrupo>();
  const maosDoGrupo = new Map<string, ReturnType<typeof maosDeObraDoGrupo>>();
  for (const l of linhas) {
    const g = l.codigo ? grupoDoCodigo.get(l.codigo) : undefined;
    if (!g) continue;
    let maos = maosDoGrupo.get(g.grupo);
    let q = r.get(g.grupo);
    if (!maos || !q) {
      maos = maosDeObraDoGrupo(contas(g), g.atribuicao);
      maosDoGrupo.set(g.grupo, maos);
      // Todas as mãos de obra do grupo passam a ser do quadro (as sem linha, zero).
      q = {
        aprendizes: doze(),
        estagiarios: doze(),
        clt: doze(),
        pj: doze(),
        maos: new Map(maos.map((m) => [m.prefixo, { clt: doze(), pj: doze(), aprendizes: doze(), estagiarios: doze() }])),
        linhas: 0,
      };
      r.set(g.grupo, q);
    }
    q.linhas++;
    const mo = maoDeObraDaLinha(maos, l.atribuicao);
    const s = mo ? q.maos.get(mo.prefixo)! : null;
    // Os colaboradores pela senioridade (Aprendiz, Estagiário) e, nas demais, pelo tipo.
    const contagem = l.aprendiz ? q.aprendizes : l.estagiario ? q.estagiarios : l.vinculo === "CLT" ? q.clt : q.pj;
    l.meses.forEach((m, k) => {
      contagem[k] += m.colaboradores;
      if (!s) return;
      const valor = m.colaboradores * salarioTotal(m);
      (l.vinculo === "CLT" ? s.clt : s.pj)[k] += valor;
      if (l.vinculo === "CLT" && l.aprendiz) s.aprendizes[k] += valor;
      if (l.vinculo === "CLT" && l.estagiario) s.estagiarios[k] += valor;
    });
  }
  return r;
}

type Db = Pick<Prisma.TransactionClient, "cenarioLotacao">;

/** As linhas do Quadro de Lotação de um cenário para o cálculo. */
export async function linhasDoQuadro(db: Db, cenarioId: string): Promise<LinhaDoQuadro[]> {
  const ls = await db.cenarioLotacao.findMany({
    where: { cenarioId },
    select: { vinculo: true, senioridade: { select: { nome: true } }, centroCusto: { select: { codigoRM: true, atribuicao: true } }, meses: true },
  });
  return ls.map((l) => ({
    vinculo: l.vinculo,
    aprendiz: ehAprendiz(l.senioridade.nome),
    estagiario: ehEstagiario(l.senioridade.nome),
    codigo: l.centroCusto.codigoRM,
    atribuicao: l.centroCusto.atribuicao === "DIRETA" || l.centroCusto.atribuicao === "INDIRETA" ? l.centroCusto.atribuicao : null,
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
