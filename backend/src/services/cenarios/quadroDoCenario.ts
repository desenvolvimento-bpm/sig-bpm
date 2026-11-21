import { randomUUID } from "node:crypto";

import type { Prisma } from "../../generated/prisma/client.js";
import type { VinculoColaborador } from "../../generated/prisma/enums.js";
import type { GrupoDoCenario } from "./centrosCenario.js";

/**
 * A aba Quadro de Lotação dos cenários analíticos (09/11/2026, etapa 4 da Gestão de Colaboradores; decisões do Adão):
 *
 * - cada linha é como a do Lançamento Inicial — a Unidade, o Tipo (CLT, PJ, Aprendiz ou Estagiário), a Função e o Centro
 *   de Custo (um dos centros dos grupos do cenário) — e tem, em cada mês, os Colaboradores e o Salário Bruto e a
 *   Insalubridade / Periculosidade da linha (o Salário Total é a soma; desde 17/11/2026, pedido do Adão, os valores já são
 *   os de todos os colaboradores da linha e não se multiplicam por eles);
 * - o grupo de centros com alguma linha conta por elas: os Colaboradores (a soma das linhas dos centros dele) e as
 *   Remunerações CLT e PJ, que não se digitam;
 * - Aprendizes, Estagiários, CLT e PJ (11/11/2026, pedido do Adão): os colaboradores se contam em quatro, pelo Tipo da
 *   linha — os Aprendizes (o Jovem Aprendiz), os Estagiários (os estagiários e os bolsistas, da Lei 11.788/2008), os CLT e
 *   os PJ; o Total de Colaboradores é a soma dos quatro;
 * - os Salários dos mesmos quatro (12/11/2026, pedido do Adão; antes, os dos aprendizes e os dos estagiários de cada mão de
 *   obra, pela atribuição do centro de cada linha): a soma do Salário Total das linhas de cada um. Todos vão para a mão
 *   de obra da atribuição do grupo (Direta: a MOD; Indireta ou sem atribuição: a MOI; a outra, quando o grupo da DRE só tem
 *   uma) — a outra mão de obra fica sem remunerações do quadro: as Remunerações CLT dela são os Salários dos Aprendizes, dos
 *   Estagiários e CLT, e as Remunerações PJ, os Salários PJ. O Fundo de Garantia: Aprendiz vale sobre os Salários dos
 *   Aprendizes, e os Salários dos Estagiários saem da base dos Encargos e Benefícios (o estagiário não tem INSS, FGTS, férias
 *   com o terço nem 13º; encargosCenario.ts);
 * - o grupo sem linhas fica como antes: os colaboradores e as remunerações digitados ou da referência;
 * - os Benefícios (21/11/2026, pedido do Adão): em cada mês, os Benefícios Padrão aplicados à linha (o botão Benefícios da aba;
 *   o cadastro em Configurações / Benefícios Padrão) — os colaboradores × a soma do Valor Mensal deles — ou, sem eles, o valor
 *   digitado na importação (a coluna Benefícios da aba Quadro de Lotação do Excel). O grupo soma os das linhas dele, que entram
 *   na conta Encargos e Benefícios da mão de obra principal (a linha Benefícios Padrão dos centros de custo; encargosCenario.ts).
 *
 * O cálculo do cenário (calcularAnalitico) grava o que os grupos com linhas recebem nas premissas e nos centros, como as
 * outras contas, para a tela, as exportações, os indicadores e a DRE.
 */

/**
 * Um mês de uma linha: os Colaboradores, o Salário Bruto e a Insalubridade / Periculosidade e (21/11/2026) os Benefícios — os ids
 * dos Benefícios Padrão aplicados (`beneficiosPadrao`) ou, sem eles, o valor digitado na importação (`beneficiosDigitados`; nulo:
 * nenhum; sem o campo, não informado: a importação mantém o que havia).
 */
export type MesDaLinha = { colaboradores: number; salarioBruto: number; adicional: number; beneficiosPadrao?: string[]; beneficiosDigitados?: number | null };
/** Uma linha para o cálculo: o tipo, o código do centro, os doze meses e os Benefícios de cada mês (os valores). */
export type LinhaDoQuadro = {
  vinculo: VinculoColaborador;
  codigo: string | null;
  meses: MesDaLinha[];
  beneficios?: number[];
};

/**
 * Os Benefícios de um mês de uma linha (21/11/2026): com Benefícios Padrão aplicados, os colaboradores × a soma do Valor Mensal deles
 * (`valores`: o id → o valor; o que não existe mais vale zero); sem eles, o valor digitado na importação (ou zero).
 */
export function beneficiosDoMes(m: MesDaLinha, valores: Map<string, number>): number {
  if (m.beneficiosPadrao?.length) return m.colaboradores * m.beneficiosPadrao.reduce((s, id) => s + (valores.get(id) ?? 0), 0);
  return m.beneficiosDigitados ?? 0;
}
/** Os quatro tipos de colaboradores (11/11/2026), nas contagens e, desde 12/11/2026, nos salários. */
export type TipoDeColaborador = "aprendizes" | "estagiarios" | "clt" | "pj";
export const TIPOS_DE_COLABORADORES: TipoDeColaborador[] = ["aprendizes", "estagiarios", "clt", "pj"];
/** Os Salários de um grupo (12/11/2026): de cada tipo, a soma do Salário Total das linhas, nos doze meses. */
export type SalariosDoGrupo = Record<TipoDeColaborador, number[]>;
/**
 * O que um grupo com linhas recebe: os colaboradores de cada mês — Aprendizes, Estagiários, CLT e PJ (estes dois sem os
 * aprendizes e os estagiários) —, os salários dos mesmos quatro, os Benefícios (21/11/2026) e quantas linhas ele tem.
 */
export type QuadroDoGrupo = Record<TipoDeColaborador, number[]> & { salarios: SalariosDoGrupo; beneficios: number[]; linhas: number };
/** Os colaboradores de cada Tipo da linha. */
const TIPO_DO_VINCULO: Record<VinculoColaborador, TipoDeColaborador> = { APRENDIZ: "aprendizes", ESTAGIARIO: "estagiarios", CLT: "clt", PJ: "pj" };
export const tipoDaLinha = (l: Pick<LinhaDoQuadro, "vinculo">): TipoDeColaborador => TIPO_DO_VINCULO[l.vinculo];
/**
 * As Remunerações do Quadro de Lotação num mês (k: 0 a 11), as da mão de obra do grupo: CLT, os Salários dos Aprendizes, dos
 * Estagiários e CLT; PJ, os Salários PJ (12/11/2026).
 */
export const remuneracoesDoQuadro = (s: SalariosDoGrupo, k: number) => ({ clt: s.aprendizes[k] + s.estagiarios[k] + s.clt[k], pj: s.pj[k] });

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
      q = { aprendizes: doze(), estagiarios: doze(), clt: doze(), pj: doze(), salarios: { aprendizes: doze(), estagiarios: doze(), clt: doze(), pj: doze() }, beneficios: doze(), linhas: 0 };
      r.set(g.grupo, q);
    }
    q.linhas++;
    // Os colaboradores e os salários pelo Tipo da linha (17/11/2026: o Salário Total já é o da linha, sem multiplicar pelos colaboradores).
    const tipo = tipoDaLinha(l);
    l.meses.forEach((m, k) => {
      q.salarios[tipo][k] += salarioTotal(m);
      q[tipo][k] += m.colaboradores;
      q.beneficios[k] += l.beneficios?.[k] ?? 0;
    });
  }
  return r;
}

type Db = Pick<Prisma.TransactionClient, "cenarioLotacao" | "cenarioBeneficioPadrao">;

/** O Valor Mensal de cada Benefício Padrão do cenário (o id → o valor por colaborador). */
export async function valoresDosBeneficios(db: Pick<Prisma.TransactionClient, "cenarioBeneficioPadrao">, cenarioId: string): Promise<Map<string, number>> {
  const bs = await db.cenarioBeneficioPadrao.findMany({ where: { cenarioId }, select: { id: true, valorMensal: true } });
  return new Map(bs.map((b) => [b.id, Number(b.valorMensal)]));
}

/** As linhas do Quadro de Lotação de um cenário para o cálculo, com os Benefícios de cada mês (21/11/2026). */
export async function linhasDoQuadro(db: Db, cenarioId: string): Promise<LinhaDoQuadro[]> {
  const [ls, valores] = await Promise.all([
    db.cenarioLotacao.findMany({
      where: { cenarioId },
      select: { vinculo: true, centroCusto: { select: { codigoRM: true } }, meses: true },
    }),
    valoresDosBeneficios(db, cenarioId),
  ]);
  return ls.map((l) => {
    const meses = mesesDaLinha(l.meses);
    return { vinculo: l.vinculo, codigo: l.centroCusto.codigoRM, meses, beneficios: meses.map((m) => beneficiosDoMes(m, valores)) };
  });
}

/** Os doze meses de uma linha (o mês sem registro, zero), com os Benefícios Padrão aplicados e o valor digitado (21/11/2026). */
export function mesesDaLinha(
  meses: Array<{ mes: number; colaboradores: unknown; salarioBruto: unknown; adicional: unknown; beneficiosPadrao?: string[] | null; beneficios?: unknown }>,
): MesDaLinha[] {
  const porMes = new Map(meses.map((m) => [m.mes, m]));
  return Array.from({ length: 12 }, (_, k) => {
    const m = porMes.get(k + 1);
    return {
      colaboradores: Number(m?.colaboradores ?? 0),
      salarioBruto: Number(m?.salarioBruto ?? 0),
      adicional: Number(m?.adicional ?? 0),
      beneficiosPadrao: m?.beneficiosPadrao ?? [],
      beneficiosDigitados: m?.beneficios === null || m?.beneficios === undefined ? null : Number(m.beneficios),
    };
  });
}

/**
 * Os Benefícios de um mês na importação (21/11/2026): o `lido` (a coluna Benefícios da aba Quadro de Lotação; sem ela, undefined)
 * sobre o `atual` do cenário. Sem a coluna, ou com o mesmo valor que o mês já tinha (os Benefícios Padrão aplicados, pelos
 * colaboradores de antes), ficam os de antes — os aplicados seguem os colaboradores novos; com outro valor, ele fica digitado, sem
 * os aplicados.
 */
export function beneficiosImportados(lido: MesDaLinha, atual: MesDaLinha | undefined, valores: Map<string, number>): Pick<MesDaLinha, "beneficiosPadrao" | "beneficiosDigitados"> {
  const antes = { beneficiosPadrao: atual?.beneficiosPadrao ?? [], beneficiosDigitados: atual?.beneficiosDigitados ?? null };
  if (lido.beneficiosDigitados === undefined) return antes;
  const valorAntes = atual ? beneficiosDoMes(atual, valores) : 0;
  if (Math.abs((lido.beneficiosDigitados ?? 0) - valorAntes) < 0.005) return antes;
  return { beneficiosPadrao: [], beneficiosDigitados: lido.beneficiosDigitados };
}

/** Copia os Benefícios Padrão de um cenário para outro (a revisão e a cópia), antes do Quadro de Lotação. */
export async function copiarBeneficios(tx: Pick<Prisma.TransactionClient, "cenarioBeneficioPadrao">, de: string, para: string) {
  const bs = await tx.cenarioBeneficioPadrao.findMany({ where: { cenarioId: de } });
  if (bs.length) await tx.cenarioBeneficioPadrao.createMany({ data: bs.map(({ id: _id, criadoEm: _c, atualizadoEm: _a, cenarioId: _ce, ...b }) => ({ ...b, cenarioId: para })) });
}

/**
 * Copia as linhas do Quadro de Lotação de um cenário para outro (a cópia, a revisão e a referência de outro analítico). O centro
 * de cada linha é o da cópia dos Centros de Custo do cenário de destino (20/11/2026, Cadastros por cenário): pelo `mapa` (o da
 * cópia dos cadastros, na revisão e na cópia) ou pelo centro de origem e pelo código; a linha de um centro que o destino não tem
 * não vai (devolve quantas).
 */
export async function copiarQuadro(
  tx: Pick<Prisma.TransactionClient, "cenarioLotacao" | "cenarioLotacaoMes" | "cenarioCentroCusto" | "cenarioBeneficioPadrao">,
  de: string,
  para: string,
  mapa?: Map<string, string>,
) {
  const linhas = await tx.cenarioLotacao.findMany({ where: { cenarioId: de }, include: { meses: true } });
  if (!linhas.length) return 0;
  let centroPara = mapa;
  if (!centroPara) {
    const [deles, nossos] = await Promise.all([
      tx.cenarioCentroCusto.findMany({ where: { cenarioId: de }, select: { id: true, origemId: true, codigoRM: true } }),
      tx.cenarioCentroCusto.findMany({ where: { cenarioId: para }, select: { id: true, origemId: true, codigoRM: true } }),
    ]);
    const porOrigem = new Map(nossos.flatMap((c) => (c.origemId ? [[c.origemId, c.id] as const] : [])));
    const porCodigo = new Map(nossos.flatMap((c) => (c.codigoRM ? [[c.codigoRM, c.id] as const] : [])));
    centroPara = new Map(
      deles.flatMap((c) => {
        const id = (c.origemId ? porOrigem.get(c.origemId) : undefined) ?? (c.codigoRM ? porCodigo.get(c.codigoRM) : undefined);
        return id ? [[c.id, id] as const] : [];
      }),
    );
  }
  const novas = linhas.flatMap((l) => {
    const centroCustoId = centroPara.get(l.centroCustoId);
    return centroCustoId ? [{ ...l, centroCustoId, novoId: randomUUID() }] : [];
  });
  if (novas.length) {
    await tx.cenarioLotacao.createMany({
      data: novas.map(({ id: _id, novoId, meses: _meses, criadoEm: _criado, atualizadoEm: _atualizado, ...x }) => ({ ...x, id: novoId, cenarioId: para })),
    });
  }
  // Os Benefícios Padrão aplicados (21/11/2026): os do cenário de destino, pelo nome (os que ele não tem saem).
  const [deles, nossos] = await Promise.all([
    tx.cenarioBeneficioPadrao.findMany({ where: { cenarioId: de }, select: { id: true, nome: true } }),
    tx.cenarioBeneficioPadrao.findMany({ where: { cenarioId: para }, select: { id: true, nome: true } }),
  ]);
  const doNome = new Map(nossos.map((b) => [b.nome, b.id]));
  const beneficioPara = new Map(deles.flatMap((b) => (doNome.has(b.nome) ? [[b.id, doNome.get(b.nome)!] as const] : [])));
  const meses = novas.flatMap((l) =>
    l.meses.map(({ linhaId: _linha, ...m }) => ({ ...m, beneficiosPadrao: m.beneficiosPadrao.flatMap((b) => (beneficioPara.has(b) ? [beneficioPara.get(b)!] : [])), linhaId: l.novoId })),
  );
  for (let i = 0; i < meses.length; i += 1000) await tx.cenarioLotacaoMes.createMany({ data: meses.slice(i, i + 1000) });
  return linhas.length - novas.length;
}
