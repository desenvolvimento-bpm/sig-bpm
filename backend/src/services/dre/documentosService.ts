import { getPrismaClient } from "../../config/prisma.js";
import { ACESSO_TOTAL, type Acesso } from "../acesso/acesso.js";
import { MENSAGEM_SENSIVEL, podeVerLinhaNaObra, podeVerLinhaNoCentro, podeVerMovimentos, podeVerSensiveis } from "../acesso/recorteDepartamento.js";
import { contestacoesService } from "../contestacoes/contestacoesService.js";
import { CENTRO_DE_OBRA } from "./obrasService.js";
import { itensDoMovimentoService } from "./itensDoMovimento.js";
import { RegraDREError } from "./dreService.js";

const rotulo = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;

type FiltroDoBalancete = { linha: string; conta: string; centro: string | null; filial: number | null; adotada?: string | null };

/** A competência do balancete, depois de conferir que o usuário vê os movimentos da conta no recorte pedido (o do extrato). */
async function competenciaDoBalancete(ano: number, mes: number, filtro: FiltroDoBalancete, acesso: Acesso) {
  const prisma = getPrismaClient();
  const c = await prisma.competencia.findUnique({ where: { ano_mes: { ano, mes } }, select: { id: true } });
  if (!c) throw new RegraDREError(404, `A competência ${rotulo(ano, mes)} não existe.`);
  const linha = await prisma.linhaDRE.findUnique({ where: { codigo: filtro.linha }, select: { descricao: true, grupoSigla: true, atribuicaoSigla: true } });
  if (!linha) throw new RegraDREError(404, `A linha ${filtro.linha} não está na estrutura da DRE.`);
  // As informações sensíveis (27/10/2026): sem o acesso, nenhum movimento da Mão de Obra Direta e Indireta.
  if (!podeVerSensiveis(acesso, linha)) throw new RegraDREError(403, MENSAGEM_SENSIVEL(linha.descricao));
  // O Coordenador (recorte por centro de custo) consulta as linhas fechadas a ele só num centro seu.
  const doCentroDele =
    acesso.recorteCentro &&
    !!filtro.centro &&
    podeVerLinhaNoCentro(acesso, linha) &&
    !!(await prisma.centroCusto.findFirst({ where: { codigoRM: filtro.centro, id: { in: acesso.centros } }, select: { id: true } }));
  // E, com a opção das obras, numa obra (centro 1.98 ou 1.99), nas linhas que ele vê nas obras.
  const daObra = acesso.recorteCentro && !!filtro.centro && CENTRO_DE_OBRA.test(filtro.centro) && podeVerLinhaNaObra(acesso, linha);
  if (!podeVerMovimentos(acesso, linha) && !doCentroDele && !daObra) {
    throw new RegraDREError(403, acesso.recorteCentro ? "Só as movimentações dos seus centros de custo: marque o Centro de Custo do Lançamento." : `As movimentações de "${linha.descricao}" não são de um departamento seu.`);
  }
  return c;
}

/** Os movimentos da conta no recorte pedido. */
const ondeDoBalancete = (competenciaId: string, filtro: FiltroDoBalancete) => ({
  competenciaId,
  contaResultado: { reduzido: filtro.conta },
  // O centro e a conta que valem (27/10/2026): com a contestação validada no balancete, o centro e a conta novos.
  ...(filtro.adotada ? { contaAdotada: { reduzido: filtro.adotada } } : {}),
  // O redistribuído (13/11/2026) está nos centros dos destinos: no de cada parte, e não no dele.
  ...(filtro.centro
    ? {
        OR: [
          { redistribuicaoId: null, centroCusto: { codigoRM: filtro.centro } },
          { redistribuicaoId: null, centroCustoId: null, codigoCentroCusto: filtro.centro },
          { partesRedistribuidas: { some: { centroCusto: { codigoRM: filtro.centro } } } },
        ],
      }
    : {}),
  ...(filtro.filial ? { filial: filtro.filial } : {}),
});

/**
 * O balancete de uma conta no mês (15/10/2026; antes, as requisições e as notas fiscais, das abas Requisições (Lista) e
 * Notas Fiscais (Lista), que saíram do LISTAS REALIZADO (RESULTADOS)): o que o extrato de uma conta na DRE abre — os
 * movimentos do balancete detalhado (o cliente ou fornecedor, a emissão e o histórico de cada um). A conta é a do
 * balancete (o código reduzido, antes da reclassificação); o centro de custo (código RM) e a filial recortam, quando
 * vêm. A linha da DRE dá o recorte do Gestor por departamento, como no extrato.
 */
export const documentosService = {
  async listar(ano: number, mes: number, filtro: FiltroDoBalancete, acesso: Acesso = ACESSO_TOTAL) {
    const prisma = getPrismaClient();
    const c = await competenciaDoBalancete(ano, mes, filtro, acesso);
    const [conta, lancamentos, detalhados] = await Promise.all([
      prisma.contaResultado.findUnique({ where: { reduzido: filtro.conta }, select: { reduzido: true, descricao: true } }),
      prisma.lancamentoContabil.findMany({
        where: ondeDoBalancete(c.id, filtro),
        select: {
          id: true,
          filial: true,
          codigoCentroCusto: true,
          nomeCentroCusto: true,
          cliForn: true,
          emissao: true,
          historico: true,
          idMovimento: true,
          valorMovimento: true,
          centroCusto: { select: { codigoRM: true, nomeRM: true } },
          contaAdotada: { select: { reduzido: true, descricao: true } },
          contestacaoId: true,
          linhaDRE: { select: { codigo: true, descricao: true, grupo: true } },
          redistribuicaoId: true,
          partesRedistribuidas: { select: { valorMovimento: true, percentual: true, centroCusto: { select: { codigoRM: true, nomeRM: true } } } },
        },
        // Sem emissão primeiro, como no SQLite (23/10/2026).
        orderBy: [{ emissao: { sort: "asc", nulls: "first" } }, { linhaArquivo: "asc" }],
      }),
      // O mês tem o balancete detalhado (com o detalhe de algum movimento)?
      prisma.lancamentoContabil.count({ where: { competenciaId: c.id, OR: [{ historico: { not: null } }, { cliForn: { not: null } }, { emissao: { not: null } }] } }),
    ]);
    // As contestações (27/10/2026): a aplicada em cada movimento (o número e o que mudou, para o ícone) e a última de cada
    // um (a situação, na coluna Ações).
    const aplicadas = await prisma.contestacao.findMany({
      where: { id: { in: [...new Set(lancamentos.flatMap((l) => (l.contestacaoId ? [l.contestacaoId] : [])))] } },
      select: { id: true, numero: true, centroNovoId: true, contaNovaId: true },
    });
    const aplicada = new Map(aplicadas.map((x) => [x.id, x]));
    const situacoes = await contestacoesService.doBalancete(lancamentos.map((l) => l.id));
    // Os itens de cada movimento (10/11/2026): pelo ID do RM, nas requisições e nas notas fiscais importadas.
    const itens = await itensDoMovimentoService.contar(lancamentos.map((l) => l.idMovimento));
    return {
      conta: conta ?? { reduzido: filtro.conta, descricao: "" },
      /** O balancete do mês é o detalhado (sem ele, cada linha é a soma da filial, do centro e da conta). */
      detalhado: detalhados > 0,
      linhas: lancamentos.map((l) => {
        // A parte do centro pedido, num movimento redistribuído (13/11/2026): o valor e o centro dela.
        const parte = filtro.centro && l.redistribuicaoId ? (l.partesRedistribuidas.find((p) => p.centroCusto.codigoRM === filtro.centro) ?? null) : null;
        return {
        id: l.id,
        filial: l.filial,
        codigoCentroCusto: parte ? parte.centroCusto.codigoRM : (l.centroCusto?.codigoRM ?? l.codigoCentroCusto),
        nomeCentroCusto: parte ? parte.centroCusto.nomeRM : (l.centroCusto?.nomeRM ?? l.nomeCentroCusto),
        cliForn: l.cliForn,
        emissao: l.emissao,
        historico: l.historico,
        /** O ID do movimento no RM (a coluna ID do Balancete (Lista)) e quantos itens ele tem nas listas importadas. */
        idMovimento: l.idMovimento,
        itens: l.idMovimento ? (itens.get(l.idMovimento) ?? 0) : 0,
        valor: (parte ? parte.valorMovimento : l.valorMovimento).toFixed(2),
        // O centro do balancete, quando o que vale é outro (a contestação), e a conta que vale na DRE, quando é outra.
        centroOriginal: parte
          ? { codigoRM: l.codigoCentroCusto, nome: l.nomeCentroCusto }
          : l.centroCusto && l.codigoCentroCusto && l.centroCusto.codigoRM !== l.codigoCentroCusto
            ? { codigoRM: l.codigoCentroCusto, nome: l.nomeCentroCusto }
            : null,
        contaNaDRE: l.contaAdotada && l.contaAdotada.reduzido !== filtro.conta ? l.contaAdotada : null,
        contestacaoAplicada: l.contestacaoId && aplicada.get(l.contestacaoId) ? { numero: aplicada.get(l.contestacaoId)!.numero, centro: !!aplicada.get(l.contestacaoId)!.centroNovoId, conta: !!aplicada.get(l.contestacaoId)!.contaNovaId } : null,
        contestacao: situacoes.get(l.id) ?? null,
        // O reflexo de um rateio (30/10/2026): o movimento é de outra linha da DRE e chega a esta pelo rateio (os da
        // Metalurgia e da Armadura nas linhas de Serviços, por exemplo). Contesta-se na linha de origem, não no reflexo.
        rateioDe: l.linhaDRE && l.linhaDRE.codigo !== filtro.linha ? { linha: l.linhaDRE.descricao, grupo: l.linhaDRE.grupo } : null,
        // A redistribuição de gastos (13/11/2026): os destinos (o centro, o percentual e o valor de cada parte). Não se contesta.
        redistribuicao: l.redistribuicaoId
          ? {
              destinos: l.partesRedistribuidas.map((p) => ({ centro: `${p.centroCusto.codigoRM ?? "sem código"} · ${p.centroCusto.nomeRM}`, percentual: Number(p.percentual), valor: p.valorMovimento.toFixed(2) })),
              parte: !!parte,
            }
          : null,
        };
      }),
    };
  },

  /**
   * Os itens de um movimento do balancete (10/11/2026): o movimento tem de estar no recorte do extrato (o mesmo acesso do
   * modal Balancete); os itens são os das requisições e das notas fiscais com o ID dele, com os já contestados (as contestações
   * de itens do movimento não recusadas: o Contestar Selecionados não os leva de novo).
   */
  async itens(ano: number, mes: number, filtro: FiltroDoBalancete, lancamentoId: string, acesso: Acesso = ACESSO_TOTAL) {
    const prisma = getPrismaClient();
    const c = await competenciaDoBalancete(ano, mes, filtro, acesso);
    const l = await prisma.lancamentoContabil.findFirst({
      where: { id: lancamentoId, ...ondeDoBalancete(c.id, filtro) },
      select: { idMovimento: true },
    });
    if (!l) throw new RegraDREError(404, "O movimento não está no balancete da conta.");
    if (!l.idMovimento) throw new RegraDREError(404, "O movimento não tem o ID do RM (a coluna ID do Balancete (Lista)).");
    const lista = await itensDoMovimentoService.listar(l.idMovimento);
    return { ...lista, contestados: await contestacoesService.itensContestados(lancamentoId, lista) };
  },
};
