import { getPrismaClient } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { ACESSO_TOTAL, type Acesso } from "../acesso/acesso.js";
import { podeVerLinhaNaObra, podeVerLinhaNoCentro, podeVerMovimentos, podeVerSensiveis } from "../acesso/recorteDepartamento.js";
import { contestacoesService } from "../contestacoes/contestacoesService.js";
import { chaveDoMovimento, itensDoMovimentoService } from "../dre/itensDoMovimento.js";
import { CENTRO_DE_OBRA } from "../dre/obrasService.js";
import { rotuloDaLinha } from "./detalhesDosResultados.js";
import { mesesDoExercicio, RelatorioError } from "./resultadosService.js";

/**
 * O Pesquisar de Resultados Empresariais (11/11/2026, pedido do Adão): os movimentos do balancete das competências fechadas
 * do exercício, até o mês escolhido, de um fornecedor ou cliente (desde 18/11/2026, pedido do Adão, o escolhido na lista dos
 * que têm movimentos no período, pelo nome exato; antes, o nome digitado, em parte) ou de uma conta de resultado (a que
 * vale na DRE: a do balancete ou a da reclassificação ou da contestação). Cada ocorrência traz o centro de custo, a
 * atribuição, a linha da DRE, a conta (na pesquisa por fornecedor) ou o fornecedor (na pesquisa por conta) e o valor, com
 * o que o Balancete mostra para contestar (a situação da contestação e os itens do movimento).
 *
 * O recorte é o do Balancete: as linhas com as movimentações do usuário (o departamento dele), os centros dele (o
 * Coordenador) e as obras (com a opção), sem as informações sensíveis sem o acesso a elas. Só as linhas da DRE (os
 * movimentos sem linha não vão aos resultados).
 */

export type TipoDaPesquisa = "fornecedor" | "conta";

/** O máximo de ocorrências (a mais, a tela pede para refinar a pesquisa). */
const LIMITE = 2000;

const selecao = {
  id: true,
  filial: true,
  cliForn: true,
  emissao: true,
  historico: true,
  idMovimento: true,
  valorMovimento: true,
  atribuicao: true,
  codigoCentroCusto: true,
  nomeCentroCusto: true,
  contestacaoId: true,
  competencia: { select: { ano: true, mes: true } },
  centroCusto: { select: { id: true, codigoRM: true, nomeRM: true } },
  contaResultado: { select: { reduzido: true, descricao: true } },
  contaAdotada: { select: { reduzido: true, descricao: true } },
  linhaDRE: { select: { codigo: true, descricao: true, grupo: true, grupoSigla: true, atribuicaoSigla: true } },
  // A redistribuição de gastos (13/11/2026): os destinos, para a etiqueta no lugar do Contestar.
  redistribuicaoId: true,
  partesRedistribuidas: { select: { valorMovimento: true, percentual: true, centroCusto: { select: { codigoRM: true, nomeRM: true } }, linhaDRE: { select: { grupoSigla: true, atribuicao: true, descricao: true } } } },
} satisfies Prisma.LancamentoContabilSelect;
type Movimento = Prisma.LancamentoContabilGetPayload<{ select: typeof selecao }>;

/** O usuário vê este movimento? A regra do Balancete (documentosService), linha a linha. */
function noRecorte(acesso: Acesso, m: Pick<Movimento, "linhaDRE" | "centroCusto" | "codigoCentroCusto">) {
  const l = m.linhaDRE;
  if (!l || !podeVerSensiveis(acesso, l)) return false;
  if (podeVerMovimentos(acesso, l)) return true;
  if (!acesso.recorteCentro) return false;
  const codigo = m.centroCusto?.codigoRM ?? m.codigoCentroCusto;
  if (m.centroCusto && acesso.centros.includes(m.centroCusto.id) && podeVerLinhaNoCentro(acesso, l)) return true;
  return !!codigo && CENTRO_DE_OBRA.test(codigo) && podeVerLinhaNaObra(acesso, l);
}

/** A conta da pesquisa: pelo código reduzido (ou "código · descrição", da lista) ou pela descrição, se só uma a tiver. */
async function contaDaPesquisa(termo: string) {
  const prisma = getPrismaClient();
  const codigo = termo.split(" · ")[0].trim();
  const exata = await prisma.contaResultado.findUnique({ where: { reduzido: codigo }, select: { id: true, reduzido: true, descricao: true } });
  if (exata) return exata;
  const porNome = await prisma.contaResultado.findMany({ where: { descricao: { contains: termo, mode: "insensitive" } }, select: { id: true, reduzido: true, descricao: true }, take: 3 });
  if (porNome.length === 1) return porNome[0];
  if (porNome.length === 0) throw new RelatorioError(404, `Nenhuma conta de resultado com “${termo}”.`);
  throw new RelatorioError(400, `Mais de uma conta de resultado com “${termo}”: escolha a conta na lista.`);
}

/**
 * As combinações de conta, fornecedor ou cliente, linha e centro dos movimentos do período que vão aos resultados, no recorte do
 * usuário (18/11/2026: as listas do Pesquisar só com o que tem movimentos e o usuário vê).
 */
async function combinacoesDoPeriodo(ano: number, ate: number | undefined, acesso: Acesso) {
  const prisma = getPrismaClient();
  const { meses } = await mesesDoExercicio(ano, ate, true);
  const competencias = meses.flatMap((m) => (m.competenciaId ? [m.competenciaId] : []));
  if (!competencias.length) return [];
  const grupos = await prisma.lancamentoContabil.groupBy({
    by: ["cliForn", "contaResultadoId", "contaAdotadaId", "linhaDREId", "centroCustoId", "codigoCentroCusto"],
    where: { competenciaId: { in: competencias }, linhaDREId: { not: null } },
  });
  const [linhas, centros] = await Promise.all([
    prisma.linhaDRE.findMany({
      where: { id: { in: [...new Set(grupos.flatMap((g) => (g.linhaDREId ? [g.linhaDREId] : [])))] } },
      select: { id: true, codigo: true, descricao: true, grupo: true, grupoSigla: true, atribuicaoSigla: true },
    }),
    prisma.centroCusto.findMany({ where: { id: { in: [...new Set(grupos.flatMap((g) => (g.centroCustoId ? [g.centroCustoId] : [])))] } }, select: { id: true, codigoRM: true, nomeRM: true } }),
  ]);
  const linhaDe = new Map(linhas.map(({ id, ...l }) => [id, l]));
  const centroDe = new Map(centros.map((c) => [c.id, c]));
  return grupos.filter((g) =>
    noRecorte(acesso, { linhaDRE: (g.linhaDREId && linhaDe.get(g.linhaDREId)) || null, centroCusto: (g.centroCustoId && centroDe.get(g.centroCustoId)) || null, codigoCentroCusto: g.codigoCentroCusto }),
  );
}

export const pesquisaDosResultados = {
  /**
   * As contas de resultado da lista do Pesquisar: as que valem na DRE (a do balancete ou a da reclassificação ou da contestação)
   * em algum movimento do período que o usuário vê (18/11/2026; antes, o plano de contas inteiro), pelo código reduzido.
   */
  async contas(ano: number, ate: number | undefined, acesso: Acesso = ACESSO_TOTAL) {
    const ids = [...new Set((await combinacoesDoPeriodo(ano, ate, acesso)).map((g) => g.contaAdotadaId ?? g.contaResultadoId))];
    return getPrismaClient().contaResultado.findMany({ where: { id: { in: ids } }, orderBy: { reduzido: "asc" }, select: { reduzido: true, descricao: true } });
  },

  /** Os fornecedores e clientes da lista do Pesquisar (18/11/2026): os dos movimentos do período que o usuário vê, pelo nome. */
  async fornecedores(ano: number, ate: number | undefined, acesso: Acesso = ACESSO_TOTAL) {
    const nomes = new Set((await combinacoesDoPeriodo(ano, ate, acesso)).flatMap((g) => (g.cliForn?.trim() ? [g.cliForn] : [])));
    return [...nomes].sort((a, b) => a.localeCompare(b, "pt-BR"));
  },

  async pesquisar(ano: number, ate: number | undefined, tipo: TipoDaPesquisa, termo: string, acesso: Acesso = ACESSO_TOTAL) {
    const prisma = getPrismaClient();
    const { ultimo, meses } = await mesesDoExercicio(ano, ate, true);
    const competencias = meses.flatMap((m) => (m.competenciaId ? [m.competenciaId] : []));
    const conta = tipo === "conta" ? await contaDaPesquisa(termo) : null;
    const onde: Prisma.LancamentoContabilWhereInput = {
      competenciaId: { in: competencias },
      linhaDREId: { not: null },
      ...(conta
        ? { OR: [{ contaAdotadaId: conta.id }, { contaAdotadaId: null, contaResultadoId: conta.id }] }
        : // O fornecedor ou cliente escolhido na lista, pelo nome exato (18/11/2026; antes, o nome em parte).
          { cliForn: termo }),
    };
    const lidos = await prisma.lancamentoContabil.findMany({
      where: onde,
      select: selecao,
      orderBy: [{ competencia: { mes: "asc" } }, { emissao: { sort: "asc", nulls: "first" } }, { linhaArquivo: "asc" }],
    });
    const vistos = lidos.filter((m) => noRecorte(acesso, m));
    const movimentos = vistos.slice(0, LIMITE);
    const [situacoes, itens] = await Promise.all([
      contestacoesService.doBalancete(movimentos.map((m) => m.id)),
      // Os itens (desde 19/11/2026, os documentos com a data perto da emissão do movimento).
      itensDoMovimentoService.contar(movimentos.map((m) => ({ idMovimento: m.idMovimento, emissao: m.emissao, ano: m.competencia.ano, mes: m.competencia.mes }))),
    ]);
    const aplicadas = new Map(
      (
        await prisma.contestacao.findMany({
          where: { id: { in: [...new Set(movimentos.flatMap((m) => (m.contestacaoId ? [m.contestacaoId] : [])))] } },
          select: { id: true, numero: true, centroNovoId: true, contaNovaId: true },
        })
      ).map((x) => [x.id, x]),
    );
    return {
      ano,
      ate: ultimo,
      tipo,
      termo,
      conta: conta ? { reduzido: conta.reduzido, descricao: conta.descricao } : null,
      /** As ocorrências no recorte do usuário (acima do limite, a tela mostra as primeiras e pede para refinar). */
      total: vistos.length,
      /** A soma de todas as ocorrências (também das que passam do limite). */
      soma: vistos.reduce((s, m) => s.plus(m.valorMovimento), new Prisma.Decimal(0)).toFixed(2),
      limite: LIMITE,
      ocorrencias: movimentos.map((m) => {
        const contaNaDRE = m.contaAdotada ?? m.contaResultado;
        const aplicada = m.contestacaoId ? aplicadas.get(m.contestacaoId) : undefined;
        return {
          id: m.id,
          anoMes: `${m.competencia.ano}-${String(m.competencia.mes).padStart(2, "0")}`,
          filial: m.filial,
          codigoCentroCusto: m.centroCusto?.codigoRM ?? m.codigoCentroCusto,
          nomeCentroCusto: m.centroCusto?.nomeRM ?? m.nomeCentroCusto,
          atribuicao: m.atribuicao,
          linha: { codigo: m.linhaDRE!.codigo, rotulo: rotuloDaLinha(m.linhaDRE!), grupo: m.linhaDRE!.grupo },
          /** A conta do balancete (o filtro do Balancete e dos itens) e a que vale na DRE. */
          contaDoBalancete: m.contaResultado,
          contaNaDRE,
          /** A conta adotada (o filtro dos itens: o Balancete recorta por ela), nula sem a classificação. */
          adotada: m.contaAdotada?.reduzido ?? null,
          cliForn: m.cliForn,
          emissao: m.emissao,
          historico: m.historico,
          idMovimento: m.idMovimento,
          itens: itens.get(chaveDoMovimento({ idMovimento: m.idMovimento, emissao: m.emissao, ano: m.competencia.ano, mes: m.competencia.mes })) ?? 0,
          valor: m.valorMovimento.toFixed(2),
          centroOriginal: m.centroCusto && m.codigoCentroCusto && m.centroCusto.codigoRM !== m.codigoCentroCusto ? { codigoRM: m.codigoCentroCusto, nome: m.nomeCentroCusto } : null,
          contestacaoAplicada: aplicada ? { numero: aplicada.numero, centro: !!aplicada.centroNovoId, conta: !!aplicada.contaNovaId } : null,
          contestacao: situacoes.get(m.id) ?? null,
          redistribuicao: m.redistribuicaoId
            ? { destinos: m.partesRedistribuidas.map((p) => ({ centro: `${p.centroCusto.codigoRM ?? "sem código"} · ${p.centroCusto.nomeRM}`, conta: [p.linhaDRE.grupoSigla, p.linhaDRE.atribuicao, p.linhaDRE.descricao].filter(Boolean).join(" · "), percentual: Number(p.percentual), valor: p.valorMovimento.toFixed(2) })) }
            : null,
        };
      }),
    };
  },
};
