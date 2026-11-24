import { getPrismaClient } from "../../config/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { nomeDoGrupo } from "../cenarios/centrosCenario.js";
import { RegraListaError } from "./listasService.js";

/**
 * O quadro de lotação por centro de custo (19/10/2026): os colaboradores do mês importados da aba Quadro de Lotação do
 * LISTAS REALIZADO (OPERAÇÃO), a aba Quadro de Lotação das Listas e a referência realizada do quadro de lotação dos
 * grupos de centros nos cenários analíticos.
 *
 * O CENTRO DE CUSTO da aba é o grupo do cadastro Centros de Custo (o nome da Controladoria), comparado sem acentos,
 * maiúsculas e espaços repetidos. Três nomes da aba diferem do cadastro e têm o par fixo em APELIDOS.
 */

const chave = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

/** Os nomes da aba que diferem do grupo do cadastro (conferidos em 19/10/2026), já na chave de comparação. */
const APELIDOS: Record<string, string> = {
  ESTACA: "ESTACAS",
  "CONSOLO (CRI)": "CONSOLES",
  "GENTE E GESTAO (CRI)": "GENTE E GESTAO",
};

/** O grupo do cadastro (entre `grupos`) do centro de custo da aba; null quando não há. */
export function grupoDaLotacao(centroCusto: string, grupos: Iterable<string>): string | null {
  const porChave = new Map([...grupos].map((g) => [chave(g), g]));
  const k = chave(centroCusto);
  return porChave.get(k) ?? porChave.get(APELIDOS[k] ?? "") ?? null;
}

/**
 * A troca do Nome Controladoria (24/11/2026, pedido do Adão): as lotações importadas do grupo `antigo` passam ao nome `novo`, para
 * as competências já importadas continuarem no grupo. Devolve quantas linhas mudaram.
 */
export async function renomearNasLotacoes(tx: Pick<Prisma.TransactionClient, "lotacaoCentro">, antigo: string, novo: string) {
  const linhas = await tx.lotacaoCentro.findMany({ select: { id: true, centroCusto: true } });
  const ids = linhas.filter((l) => grupoDaLotacao(l.centroCusto, [antigo]) === antigo).map((l) => l.id);
  return ids.length ? (await tx.lotacaoCentro.updateMany({ where: { id: { in: ids } }, data: { centroCusto: novo } })).count : 0;
}

/**
 * A lotação realizada dos grupos em cada competência: a soma dos colaboradores CLT e PJ dos centros da aba de cada grupo
 * (19/10/2026: separados). Os centros sem grupo entre `grupos` vão em `semGrupo`, com o total somado nas competências.
 */
export async function lotacaoDosGrupos(competenciaIds: string[], grupos: string[]) {
  const linhas = await getPrismaClient().lotacaoCentro.findMany({
    where: { competenciaId: { in: competenciaIds }, importacao: { status: "CONCLUIDA", substituidaEm: null } },
    select: { competenciaId: true, centroCusto: true, clt: true, pj: true, total: true },
    orderBy: [{ competencia: { mes: "asc" } }, { linhaArquivo: "asc" }],
  });
  const porCompetencia = new Map<string, Map<string, { clt: number; pj: number }>>();
  const semGrupo = new Map<string, number>();
  for (const l of linhas) {
    const grupo = grupoDaLotacao(l.centroCusto, grupos);
    if (!grupo) {
      semGrupo.set(l.centroCusto, (semGrupo.get(l.centroCusto) ?? 0) + l.total);
      continue;
    }
    const doMes = porCompetencia.get(l.competenciaId) ?? new Map<string, { clt: number; pj: number }>();
    const atual = doMes.get(grupo) ?? { clt: 0, pj: 0 };
    doMes.set(grupo, { clt: atual.clt + l.clt, pj: atual.pj + l.pj });
    porCompetencia.set(l.competenciaId, doMes);
  }
  return { porCompetencia, semGrupo };
}

const rotulo = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;

/** A aba Quadro de Lotação das Listas: os centros do mês, com o grupo do cadastro, e os totais. */
export async function lotacaoDaLista(ano: number, mes: number) {
  const prisma = getPrismaClient();
  const competencia = await prisma.competencia.findUnique({ where: { ano_mes: { ano, mes } }, select: { id: true, ano: true, mes: true, status: true } });
  if (!competencia) throw new RegraListaError(404, `A competência ${rotulo(ano, mes)} não existe.`);
  const [importacao, centros] = await Promise.all([
    prisma.importacao.findFirst({
      where: { competenciaId: competencia.id, tipo: "QUADRO_LOTACAO", status: "CONCLUIDA", substituidaEm: null },
      orderBy: { importadoEm: "desc" },
      select: {
        nomeArquivo: true,
        importadoEm: true,
        resumo: true,
        lotacoes: { orderBy: { linhaArquivo: "asc" }, select: { id: true, centroCusto: true, unidade: true, departamento: true, atribuicao: true, clt: true, pj: true, total: true, linhaArquivo: true } },
      },
    }),
    prisma.centroCusto.findMany({ where: { ativo: true }, select: { nomeControladoria: true, nomeRM: true, codigoRM: true } }),
  ]);
  const grupos = [...new Set(centros.map(nomeDoGrupo))];
  const itens = (importacao?.lotacoes ?? []).map((l) => ({ ...l, grupo: grupoDaLotacao(l.centroCusto, grupos) }));
  const soma = (k: "clt" | "pj" | "total") => itens.reduce((s, i) => s + i[k], 0);
  const modo = (importacao?.resumo as { modo?: unknown } | null)?.modo;
  return {
    competencia,
    importacao: importacao ? { nomeArquivo: importacao.nomeArquivo, importadoEm: importacao.importadoEm, cargaRetroativa: modo === "CARGA_RETROATIVA" } : null,
    itens,
    totais: { clt: soma("clt"), pj: soma("pj"), total: soma("total") },
  };
}
