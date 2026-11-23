import type { Prisma } from "../../generated/prisma/client.js";
import type { QuadroDoGrupo } from "./quadroDoCenario.js";

/**
 * A mão de obra das médias (22/11/2026, pedido do Adão): o Replicar Médias leva as Médias de Referência das Remunerações CLT e PJ e
 * dos Encargos e Benefícios de cada grupo de centros direto aos doze meses dos Centros de Custo — a única situação em que esses
 * valores não saem do Quadro de Lotação (os Benefícios Adicionais, como sempre, se digitam; as Horas Extras, as Multas Rescisórias
 * e o Pró-Labore também). O grupo fica assim, com a verificação "Mão de Obra das Médias", até o Quadro de Lotação dele mudar:
 * o marcador guarda a assinatura do quadro do grupo naquela hora, e com outra assinatura (uma linha incluída, editada ou
 * excluída, por qualquer caminho) o grupo volta a calcular pelo Quadro de Lotação.
 *
 * O marcador é uma premissa do cenário (unidade 0, esta venda, o grupo na chave, o mês 0 e a assinatura no valor): vai junto na
 * cópia e na revisão. Ao lado dele, a base dos Encargos e Benefícios de cada mão de obra do grupo (as vendas de
 * `VENDA_DA_BASE`, o mês 0): a Média de Referência da conta na hora do Replicar Médias, sem a dos Benefícios Adicionais — os
 * meses dos Encargos são ela mais os Benefícios Adicionais do mês, e não mudam com outra referência (22/11/2026, pedido do Adão:
 * trocar a referência mantendo os meses não muda o resultado). A referência que troca as premissas tira o marcador e as bases (a
 * de outro analítico traz os da origem, com os meses dela); a que mantém os meses deixa os do cenário e não traz os da origem.
 */
export const VENDA_MAO_DE_OBRA_DAS_MEDIAS = "MAO_DE_OBRA_DAS_MEDIAS";
/** A base dos Encargos e Benefícios da mão de obra direta (a MOD) e da indireta (a MOI) do grupo com a mão de obra das médias. */
export const VENDA_DA_BASE = { direta: "ENCARGOS_DAS_MEDIAS_MOD", indireta: "ENCARGOS_DAS_MEDIAS_MOI" } as const;
export const vendaDaBase = (direta: boolean) => (direta ? VENDA_DA_BASE.direta : VENDA_DA_BASE.indireta);
/** As premissas da mão de obra das médias (o marcador e as bases): a referência que mantém os meses não as troca. */
export const VENDAS_DA_MAO_DE_OBRA_DAS_MEDIAS = [VENDA_MAO_DE_OBRA_DAS_MEDIAS, VENDA_DA_BASE.direta, VENDA_DA_BASE.indireta];

type Cliente = Pick<Prisma.TransactionClient, "cenarioPremissa">;

/**
 * A assinatura do Quadro de Lotação de um grupo: os colaboradores e os salários de cada tipo, os Benefícios e as linhas (sem
 * linhas, zero). Não depende dos ids das linhas nem dos centros (vale na revisão). Um inteiro de 31 bits (FNV-1a), que cabe no
 * valor da premissa.
 */
export function assinaturaDoQuadro(q: QuadroDoGrupo | undefined): number {
  if (!q) return 0;
  const r = (xs: number[]) => xs.map((v) => Math.round(v * 10000));
  const texto = JSON.stringify([q.linhas, r(q.aprendizes), r(q.estagiarios), r(q.clt), r(q.pj), r(q.salarios.aprendizes), r(q.salarios.estagiarios), r(q.salarios.clt), r(q.salarios.pj), r(q.beneficios)]);
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Nunca zero (o grupo sem linhas): o zero é a assinatura do quadro vazio.
  return (h & 0x7fffffff) || 1;
}

/** Os marcadores gravados do cenário: o grupo → a assinatura do quadro dele quando as médias foram replicadas. */
export async function marcadoresDasMedias(cliente: Cliente, cenarioId: string) {
  const xs = await cliente.cenarioPremissa.findMany({ where: { cenarioId, unidade: 0, venda: VENDA_MAO_DE_OBRA_DAS_MEDIAS, mes: 0 }, select: { chave: true, valor: true } });
  return new Map(xs.map((x) => [x.chave, Number(x.valor)]));
}

/**
 * Os grupos com a mão de obra das médias (os marcadores com a assinatura do quadro de hoje) e os marcadores vencidos (o quadro do
 * grupo mudou desde o Replicar Médias: o grupo volta ao Quadro de Lotação).
 */
export function gruposDasMedias(marcadores: Map<string, number>, quadro: Map<string, QuadroDoGrupo>) {
  const validos = new Set<string>();
  const vencidos: string[] = [];
  for (const [grupo, assinatura] of marcadores) (assinatura === assinaturaDoQuadro(quadro.get(grupo)) ? validos.add(grupo) : vencidos.push(grupo));
  return { validos, vencidos };
}

/** Tira os marcadores e as bases dos grupos (todos, sem `grupos`): eles voltam ao Quadro de Lotação. */
export async function tirarMarcadores(cliente: Cliente, cenarioId: string, grupos?: string[]) {
  if (grupos && !grupos.length) return;
  await cliente.cenarioPremissa.deleteMany({ where: { cenarioId, unidade: 0, venda: { in: VENDAS_DA_MAO_DE_OBRA_DAS_MEDIAS }, ...(grupos ? { chave: { in: grupos } } : {}) } });
}

/** Grava (ou troca) o marcador de cada grupo, com a assinatura do quadro dele agora; as bases, o próximo cálculo grava. */
export async function marcarGrupos(cliente: Cliente, cenarioId: string, grupos: string[], quadro: Map<string, QuadroDoGrupo>) {
  if (!grupos.length) return;
  await tirarMarcadores(cliente, cenarioId, grupos);
  await cliente.cenarioPremissa.createMany({
    data: grupos.map((grupo) => ({ cenarioId, unidade: 0, venda: VENDA_MAO_DE_OBRA_DAS_MEDIAS, chave: grupo, mes: 0, valor: assinaturaDoQuadro(quadro.get(grupo)) })),
  });
}
