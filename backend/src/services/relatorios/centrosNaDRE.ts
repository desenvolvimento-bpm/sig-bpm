import { getPrismaClient } from "../../config/prisma.js";
import type { Acesso } from "../acesso/acesso.js";
import { podeVerCentro, podeVerLinhaNoCentro } from "../acesso/recorteDepartamento.js";
import { apurarUnidades, type LinhaEstrutura } from "../dre/apuracaoUnidades.js";
import { estrutura, grupoDoCentro } from "../dre/dreService.js";
import { atribuicoesDoCentro, prefixoDaAtribuicao } from "../dre/recorteCentros.js";
import { totaisDaCompetencia } from "../volumes/volumesService.js";

/** Os grupos de centros de custo de um mês: o valor de cada conta de destino na DRE do Consolidado, por grupo. */
type ValoresDosGrupos = Map<string, Map<string, number>>;

/**
 * Os grupos de centros das competências já calculadas, pela competência e pela data da apuração dela (23/11/2026). Só os do acesso
 * total: com recorte (o Gestor e o Coordenador), o cálculo é na hora, com os centros e as linhas do recorte. Numa nova apuração a
 * data muda, e o mês se recalcula.
 */
const guardados = new Map<string, ValoresDosGrupos>();
const temRecorte = (a: Acesso) => a.recorteCentro || a.recorteDepartamento;

/**
 * Os grupos de centros de custo de uma competência na DRE do Consolidado (23/11/2026, a aba Departamentos dos Resultados
 * Empresariais): os lançamentos de cada grupo (o Nome da Controladoria dos centros, como na aba Centros de Custo) passam pela mesma
 * regra da apuração (apurarUnidades: o balde, a filial e os rateios do mês — a parte da produção que vai para Serviços, a
 * Montagem dos centros complementares na conta equivalente da CSC…), somados nas unidades, como o Consolidado. Só as contas das
 * atribuições que a aba Centros de Custo mostra (as de mão de obra, de gastos gerais e de depreciação dos departamentos dos
 * centros, recorteCentros) e, com recorte, só os centros e as linhas dele. O resto do Consolidado (os lançamentos sem centro, os
 * manuais, as outras atribuições) fica fora dos grupos.
 */
async function centrosDoMes(competenciaId: string, apuradaEm: Date | null, linhas: LinhaEstrutura[], acesso: Acesso): Promise<ValoresDosGrupos> {
  const chave = temRecorte(acesso) ? null : `${competenciaId}|${apuradaEm?.getTime() ?? 0}`;
  const guardado = chave ? guardados.get(chave) : undefined;
  if (guardado) return guardado;
  const prisma = getPrismaClient();
  const selecao = { filial: true, centroCustoId: true, linhaDREId: true, balde: true, alocacao: true, valorMovimento: true } as const;
  // Os redistribuídos (13/11/2026) pelas partes, nos centros dos destinos, como na apuração.
  const [diretos, partes, volumes, totais] = await Promise.all([
    prisma.lancamentoContabil.findMany({ where: { competenciaId, redistribuicaoId: null, centroCustoId: { not: null } }, select: selecao }),
    prisma.lancamentoRedistribuido.findMany({ where: { competenciaId }, select: selecao }),
    prisma.volumeOperacional.findMany({ where: { competenciaId }, select: { percentual: true, regraRateio: { select: { chave: true, destino: true } } } }),
    totaisDaCompetencia(competenciaId),
  ]);
  const lancamentos = [...diretos, ...partes];
  const centros = new Map(
    (
      await prisma.centroCusto.findMany({
        where: { id: { in: [...new Set(lancamentos.map((l) => l.centroCustoId!))] } },
        select: { id: true, nomeControladoria: true, departamento: true },
      })
    ).map((c) => [c.id, c]),
  );
  const porGrupo = new Map<string, typeof lancamentos>();
  for (const l of lancamentos) {
    const cc = centros.get(l.centroCustoId!);
    if (!cc || !podeVerCentro(acesso, cc)) continue;
    const g = grupoDoCentro(cc);
    porGrupo.set(g, [...(porGrupo.get(g) ?? []), l]);
  }
  const permitidas = atribuicoesDoCentro(linhas);
  const porId = new Map(linhas.map((l) => [l.id, l]));
  const percentuais = new Map(volumes.map((v) => [`${v.regraRateio.chave}|${v.regraRateio.destino}`, v.percentual]));
  const quantidades = new Map(totais.map((t) => [t.codigo as string, t.quantidade]));
  const r: ValoresDosGrupos = new Map();
  for (const [g, doGrupo] of porGrupo) {
    const { resultados } = apurarUnidades({
      linhas,
      lancamentos: doGrupo.map((l) => ({ filial: l.filial, linhaDREId: l.linhaDREId, balde: l.balde, alocacao: l.alocacao, valor: l.valorMovimento })),
      manuais: [],
      percentuais,
      totais: quantidades,
      receitas: [],
    });
    const m = new Map<string, number>();
    for (const x of resultados) {
      const l = porId.get(x.linhaId);
      if (!l || l.tipo !== "ITEM" || !permitidas.has(prefixoDaAtribuicao(l.codigo)) || !podeVerLinhaNoCentro(acesso, l)) continue;
      m.set(l.codigo, (m.get(l.codigo) ?? 0) + Number(x.valor));
    }
    if (m.size) r.set(g, m);
  }
  if (chave) guardados.set(chave, r);
  return r;
}

/**
 * Os grupos de centros de custo nos meses (as competências, null no mês sem apuração) na DRE do Consolidado: por grupo, o valor de
 * cada conta de destino em cada mês (centrosDoMes).
 */
export async function centrosNaDRE(competencias: Array<string | null>, acesso: Acesso): Promise<Map<string, Array<Map<string, number>>>> {
  const ids = competencias.filter((c): c is string => c !== null);
  const [linhas, datas] = await Promise.all([
    estrutura(),
    getPrismaClient().competencia.findMany({ where: { id: { in: ids } }, select: { id: true, apuradaEm: true } }),
  ]);
  const apuradaEm = new Map(datas.map((c) => [c.id, c.apuradaEm]));
  const porMes: ValoresDosGrupos[] = [];
  for (const c of competencias) porMes.push(c ? await centrosDoMes(c, apuradaEm.get(c) ?? null, linhas, acesso) : new Map());
  const r = new Map<string, Array<Map<string, number>>>();
  porMes.forEach((grupos, k) => {
    for (const [g, m] of grupos) {
      const lista = r.get(g) ?? competencias.map(() => new Map<string, number>());
      lista[k] = m;
      r.set(g, lista);
    }
  });
  return r;
}
