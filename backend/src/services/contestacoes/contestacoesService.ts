import { getPrismaClient } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { DepartamentoAcesso, FormaValidacaoContestacao, OrigemItemMovimento, SituacaoContestacao } from "../../generated/prisma/enums.js";
import { carregarUsuariosAtivos, type Acesso } from "../acesso/acesso.js";
import { departamentoDaLinha, gestaoDoCentro, MENSAGEM_SENSIVEL, podeVerCentro, podeVerMovimentos, podeVerSensiveis, ROTULO_DEPARTAMENTO } from "../acesso/recorteDepartamento.js";
import { auditar } from "../auditoriaService.js";
import { classificacaoService } from "../classificacao/classificacaoService.js";
import { manualNoSinalDoBalancete } from "../dre/apuracaoUnidades.js";
import { itensDoMovimentoService, type ItensDoMovimento } from "../dre/itensDoMovimento.js";
import { lancamentosManuaisService } from "../lancamentosManuais/lancamentosManuaisService.js";

/**
 * As Contestações de Gastos (27/10/2026, pedido do Adão).
 *
 * No balancete de uma conta (o modal dos movimentos, na DRE do mês e nos Resultados Empresariais), quem edita a aba
 * Solicitadas contesta um item: sugere outro centro de custo e/ou outra conta de resultado (e, se quiser, o motivo). A
 * conta nova é do departamento do centro (o novo; sem ele, o do item) ou do Extra-Operacional. Com Contestar Anteriores
 * e Posteriores (30/10/2026), os movimentos do mesmo fornecedor, conta e centro de custo nas competências anteriores e nas
 * seguintes (as já importadas) entram na mesma contestação: ela é uma só (a situação, a resposta e a validação), com
 * vários movimentos. Quem responde pelo centro — o novo; sem centro novo, o do item — acata ou recusa (aba Recebidas): os
 * usuários com Editar em Contestações › Recebidas, cada um no seu recorte (30/10/2026: a lista de centros do Coordenador
 * e do Estratégico, os departamentos do Gestor; sem recorte, todos). Quem pede e responde pelo centro já tem a
 * contestação acatada.
 *
 * Em Validações, Processar corrige os movimentos das acatadas: na competência ainda aberta, no próprio balancete (a
 * classificação aplica o centro e a conta novos e guarda os do RM, para mostrar o original); na fechada, o movimento espera
 * os lançamentos manuais da aba Contestações de uma competência aberta (Importar: o estorno no centro e na conta de antes e
 * o lançamento no centro e na conta novos). A contestação fica validada quando todos os movimentos dela estão corrigidos.
 * Alterar Status muda a situação de qualquer uma, com a justificativa.
 */

export class RegraContestacaoError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

export type UsuarioDaContestacao = { id: string; nome: string; acesso: Acesso };

const rotulo = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;
const ABERTAS: SituacaoContestacao[] = ["PENDENTE", "ACATADA"];
export const ROTULO_SITUACAO: Record<SituacaoContestacao, string> = { PENDENTE: "Pendente", ACATADA: "Acatada", RECUSADA: "Recusada", VALIDADA: "Validada" };
/** O motivo dos lançamentos manuais das contestações (a aba Contestações dos Lançamentos). */
export const MOTIVO_CONTESTACAO = "CONTESTAÇÃO";

/**
 * A conta cabe no centro de custo (30/10/2026, pedido do Adão): a do departamento do centro ou a do Extra-Operacional. O
 * centro sem departamento (Almoxarifado, Investimento, Requisição) não restringe — só o do movimento, quando a contestação
 * muda só a conta (a lista dos centros novos não os tem).
 */
export function contaCabeNoCentro(departamentoDoCentro: DepartamentoAcesso | null, departamentoDaConta: DepartamentoAcesso | null) {
  if (!departamentoDoCentro) return true;
  return departamentoDaConta === departamentoDoCentro || departamentoDaConta === "EXTRA_OPERACIONAL";
}

/**
 * Por que o centro não pode ser o centro novo de uma contestação (nulo se pode), pelo código (04/11/2026, pedido do Adão): só
 * vale o de código com três níveis (1.01.00000001). Ficam fora o sem código no cadastro, o genérico (dois níveis: 1.01
 * Administrativo, 1.02 Comercial, 1.11 a 1.15 da Produção, 1.16 Serviços, que agrupam os centros do departamento) e o de
 * código mais longo (1.11.00000006.1 Laboratório).
 */
export function centroForaDaContestacao(codigoRM: string | null) {
  const codigo = codigoRM?.trim() ?? "";
  if (!codigo) return "não tem código no cadastro";
  if (/^\d+\.\d+$/.test(codigo)) return "é genérico";
  if (!/^\d+\.\d+\.\d+$/.test(codigo)) return "tem o código fora do padrão de três níveis (como 1.01.00000001)";
  return null;
}

/** A forma da contestação validada, pelos movimentos: os lançamentos manuais, se algum foi por eles; senão, o balancete. */
function formaDaContestacao(ms: Array<{ formaValidacao: FormaValidacaoContestacao | null }>): FormaValidacaoContestacao | null {
  if (ms.some((m) => m.formaValidacao === "LANCAMENTO_MANUAL")) return "LANCAMENTO_MANUAL";
  return ms.some((m) => m.formaValidacao === "NO_BALANCETE") ? "NO_BALANCETE" : null;
}

const centroSel = { select: { id: true, codigoRM: true, nomeRM: true, departamento: true } } as const;
const contaSel = { select: { id: true, reduzido: true, descricao: true } } as const;
const MOVIMENTO_SEL = {
  id: true,
  principal: true,
  lancamentoContabilId: true,
  filial: true,
  emissao: true,
  cliForn: true,
  historico: true,
  valor: true,
  centroAntesId: true,
  contaAntesId: true,
  formaValidacao: true,
  competencia: { select: { id: true, ano: true, mes: true, status: true, apuradaEm: true } },
  // O ID do movimento no RM (10/11/2026), pelo item do balancete: abre os itens do movimento.
  lancamentoContabil: { select: { idMovimento: true } },
  // A contestação de itens (10/11/2026): o valor do movimento inteiro e quantos itens.
  valorMovimento: true,
  _count: { select: { itens: true } },
} satisfies Prisma.ContestacaoMovimentoSelect;
type MovimentoDaContestacao = Prisma.ContestacaoMovimentoGetPayload<{ select: typeof MOVIMENTO_SEL }>;
const SELECAO = {
  id: true,
  numero: true,
  competenciaId: true,
  lancamentoContabilId: true,
  filial: true,
  codigoCentroCusto: true,
  nomeCentroCusto: true,
  emissao: true,
  cliForn: true,
  historico: true,
  valor: true,
  motivo: true,
  situacao: true,
  solicitanteId: true,
  solicitadaEm: true,
  respondidaPorId: true,
  respondidaEm: true,
  justificativa: true,
  justificadaPorId: true,
  justificadaEm: true,
  validadaPorId: true,
  validadaEm: true,
  formaValidacao: true,
  anteriores: true,
  posteriores: true,
  centroAntesId: true,
  centroNovoId: true,
  contaNovaId: true,
  competencia: { select: { id: true, ano: true, mes: true, status: true } },
  contaBalancete: contaSel,
  centroAntes: centroSel,
  contaAntes: { select: { id: true, reduzido: true, descricao: true, linhaDRE: { select: { grupoSigla: true, descricao: true } } } },
  centroNovo: centroSel,
  contaNova: contaSel,
  solicitante: { select: { nome: true } },
  lancamentosManuais: { select: { competencia: { select: { ano: true, mes: true } } }, take: 1 },
  movimentos: { select: MOVIMENTO_SEL, orderBy: [{ competencia: { ano: "asc" } }, { competencia: { mes: "asc" } }, { emissao: "asc" }] },
} satisfies Prisma.ContestacaoSelect;
type Linha = Prisma.ContestacaoGetPayload<{ select: typeof SELECAO }>;

/** O item do balancete, com o que a contestação e as anteriores e posteriores pedem dele. */
const LANCAMENTO_SEL = {
  id: true,
  competenciaId: true,
  filial: true,
  codigoCentroCusto: true,
  nomeCentroCusto: true,
  contaResultadoId: true,
  contaAdotadaId: true,
  centroCustoId: true,
  emissao: true,
  cliForn: true,
  historico: true,
  valorMovimento: true,
  linhaDRE: { select: { grupoSigla: true, descricao: true, atribuicaoSigla: true } },
  competencia: { select: { ano: true, mes: true } },
  // Os itens do movimento (10/11/2026): o ID do RM e a conta do balancete (o código reduzido).
  idMovimento: true,
  contaResultado: { select: { reduzido: true } },
  // A redistribuição de gastos (13/11/2026): o movimento redistribuído não se contesta.
  redistribuicaoId: true,
} satisfies Prisma.LancamentoContabilSelect;
type LancamentoDoMovimento = Prisma.LancamentoContabilGetPayload<{ select: typeof LANCAMENTO_SEL }>;

/**
 * A conta que vale hoje no item (a adotada; sem ela, a do balancete) e o departamento dela, pela linha da DRE (10/11/2026): com
 * um centro novo e sem conta nova, ela precisa caber no departamento do centro novo.
 */
async function contaDoItem(l: LancamentoDoMovimento) {
  return contaComDepartamento(l.contaAdotadaId ?? l.contaResultadoId);
}
/** Uma conta, com o departamento dela pela linha da DRE (nulo sem linha). */
async function contaComDepartamento(id: string) {
  const c = await getPrismaClient().contaResultado.findUniqueOrThrow({
    where: { id },
    select: { reduzido: true, descricao: true, linhaDRE: { select: { grupoSigla: true, descricao: true } } },
  });
  return { reduzido: c.reduzido, descricao: c.descricao, departamento: c.linhaDRE ? departamentoDaLinha(c.linhaDRE) : null };
}

/**
 * O destino de uma contestação — o centro e/ou a conta novos —, conferido contra o centro e a conta que valem hoje no item (a
 * mesma regra no Contestar e no Editar das Validações, 10/11/2026): o centro novo ativo, de um departamento da DRE e com o
 * código de três níveis; a conta nova analítica, ativa, com destino na DRE e do departamento do centro (o novo; sem ele, o de
 * hoje) ou do Extra-Operacional; e, com o centro novo sem a conta nova, a conta de hoje do departamento do centro novo.
 */
async function conferirDestino(atual: { centroId: string | null; contaId: string }, d: { centroNovoId: string | null; contaNovaId: string | null }) {
  const prisma = getPrismaClient();
  if (!d.centroNovoId && !d.contaNovaId) throw new RegraContestacaoError(400, "Sugira o novo centro de custo e/ou a nova conta de resultado.");
  if (d.centroNovoId && d.centroNovoId === atual.centroId) throw new RegraContestacaoError(400, "O novo centro de custo é o mesmo do movimento.");
  if (d.contaNovaId && d.contaNovaId === atual.contaId) throw new RegraContestacaoError(400, "A nova conta de resultado é a mesma do movimento.");
  // O centro que vale depois: o novo (de um departamento da DRE) ou o do movimento.
  let departamentoAlvo: DepartamentoAcesso | null;
  if (d.centroNovoId) {
    const c = await prisma.centroCusto.findUnique({ where: { id: d.centroNovoId }, select: { ativo: true, codigoRM: true, nomeRM: true, departamento: true } });
    if (!c) throw new RegraContestacaoError(400, "Centro de custo não encontrado.");
    if (!c.ativo) throw new RegraContestacaoError(400, `O centro de custo ${c.nomeRM} está inativo no cadastro.`);
    const fora = centroForaDaContestacao(c.codigoRM);
    if (fora) throw new RegraContestacaoError(400, `O centro de custo ${[c.codigoRM, c.nomeRM].filter(Boolean).join(" ")} ${fora}: escolha outro centro do departamento.`);
    departamentoAlvo = gestaoDoCentro(c.departamento);
    if (!departamentoAlvo) throw new RegraContestacaoError(400, `O centro de custo ${c.nomeRM} não é de um departamento da DRE.`);
  } else {
    const c = atual.centroId ? await prisma.centroCusto.findUnique({ where: { id: atual.centroId }, select: { departamento: true } }) : null;
    departamentoAlvo = gestaoDoCentro(c?.departamento ?? null);
  }
  // O centro novo sem a conta nova (10/11/2026, pedido do Adão): a conta do movimento continua e tem de caber no departamento
  // do centro novo; senão, a nova conta é obrigatória (antes, passava e virava erro de departamento na classificação).
  if (d.centroNovoId && !d.contaNovaId) {
    const conta = await contaComDepartamento(atual.contaId);
    if (!contaCabeNoCentro(departamentoAlvo, conta.departamento)) {
      throw new RegraContestacaoError(
        400,
        `A conta do movimento (${conta.reduzido} ${conta.descricao}) não é do departamento do novo centro de custo (${ROTULO_DEPARTAMENTO[departamentoAlvo!]}) nem do Extra-Operacional: escolha também a nova conta de resultado.`,
      );
    }
  }
  if (d.contaNovaId) {
    const c = await prisma.contaResultado.findUnique({
      where: { id: d.contaNovaId },
      select: { ativo: true, reduzido: true, tipoConta: true, linhaDREId: true, linhaDRE: { select: { grupoSigla: true, descricao: true } } },
    });
    if (!c) throw new RegraContestacaoError(400, "Conta de resultado não encontrada.");
    if (!c.ativo || c.tipoConta !== "ANALITICA" || !c.linhaDREId) throw new RegraContestacaoError(400, `A conta ${c.reduzido} não é uma conta analítica ativa com destino na DRE.`);
    if (!contaCabeNoCentro(departamentoAlvo, c.linhaDRE ? departamentoDaLinha(c.linhaDRE) : null)) {
      throw new RegraContestacaoError(400, `A conta ${c.reduzido} não é do departamento do centro de custo (${ROTULO_DEPARTAMENTO[departamentoAlvo!]}) nem do Extra-Operacional.`);
    }
  }
}

/** O centro que decide a contestação: o novo; sem ele, o do item. */
const centroAlvo = (c: { centroNovoId: string | null; centroAntesId: string | null }) => c.centroNovoId ?? c.centroAntesId;
const soma = (xs: Array<{ valor: Prisma.Decimal }>) => xs.reduce((s, x) => s.add(x.valor), new Prisma.Decimal(0));

/** Por que o usuário não contesta o item (o recorte e as informações sensíveis, como no balancete); nulo se pode. */
function recusaDoAcesso(l: LancamentoDoMovimento, acesso: Acesso): string | null {
  if (l.linhaDRE && !podeVerSensiveis(acesso, l.linhaDRE)) return MENSAGEM_SENSIVEL(l.linhaDRE.descricao);
  const doCentroDele = acesso.recorteCentro && !!l.centroCustoId && acesso.centros.includes(l.centroCustoId);
  if (l.linhaDRE && !podeVerMovimentos(acesso, l.linhaDRE) && !doCentroDele) return "O movimento não é do seu recorte.";
  return null;
}

/** O movimento da contestação, a partir do item do balancete: a identidade dele e o centro e a conta que valem hoje. */
const movimentoDoItem = (l: LancamentoDoMovimento, principal: boolean) => ({
  competenciaId: l.competenciaId,
  lancamentoContabilId: l.id,
  principal,
  filial: l.filial,
  codigoCentroCusto: l.codigoCentroCusto,
  nomeCentroCusto: l.nomeCentroCusto,
  contaBalanceteId: l.contaResultadoId,
  emissao: l.emissao,
  cliForn: l.cliForn,
  historico: l.historico,
  valor: l.valorMovimento,
  centroAntesId: l.centroCustoId,
  contaAntesId: l.contaAdotadaId ?? l.contaResultadoId,
});

/**
 * As anteriores e as posteriores (30/10/2026): os itens do mesmo fornecedor, na mesma conta e no mesmo centro de custo do
 * balancete (os do RM), nas outras competências já importadas. Ficam de fora os que já têm uma contestação em andamento,
 * os que o usuário não vê e os que já estão no centro e na conta novos.
 */
async function combinacao(l: LancamentoDoMovimento, acesso: Acesso, destino: { centroNovoId: string | null; contaNovaId: string | null }) {
  const vazio = { anteriores: [] as LancamentoDoMovimento[], posteriores: [] as LancamentoDoMovimento[], emAndamento: 0, foraDoAcesso: 0 };
  if (!l.cliForn) return vazio;
  const prisma = getPrismaClient();
  const outros = await prisma.lancamentoContabil.findMany({
    // Sem os redistribuídos (13/11/2026), que não se contestam.
    where: { cliForn: l.cliForn, contaResultadoId: l.contaResultadoId, codigoCentroCusto: l.codigoCentroCusto, competenciaId: { not: l.competenciaId }, redistribuicaoId: null },
    select: LANCAMENTO_SEL,
    orderBy: [{ competencia: { ano: "asc" } }, { competencia: { mes: "asc" } }, { emissao: "asc" }, { linhaArquivo: "asc" }],
  });
  if (!outros.length) return vazio;
  const emAndamento = new Set(
    (
      await prisma.contestacaoMovimento.findMany({
        where: { lancamentoContabilId: { in: outros.map((o) => o.id) }, contestacao: { situacao: { in: ABERTAS } } },
        select: { lancamentoContabilId: true },
      })
    ).map((m) => m.lancamentoContabilId),
  );
  const r = { ...vazio, anteriores: [] as LancamentoDoMovimento[], posteriores: [] as LancamentoDoMovimento[] };
  const chave = (x: { competencia: { ano: number; mes: number } }) => x.competencia.ano * 100 + x.competencia.mes;
  for (const o of outros) {
    if (emAndamento.has(o.id)) {
      r.emAndamento++;
      continue;
    }
    if (recusaDoAcesso(o, acesso)) {
      r.foraDoAcesso++;
      continue;
    }
    // Já no centro e na conta novos (com um deles escolhido): nada muda.
    const contaAntes = o.contaAdotadaId ?? o.contaResultadoId;
    const comDestino = !!destino.centroNovoId || !!destino.contaNovaId;
    if (comDestino && (destino.centroNovoId ?? o.centroCustoId) === o.centroCustoId && (destino.contaNovaId ?? contaAntes) === contaAntes) continue;
    (chave(o) < chave(l) ? r.anteriores : r.posteriores).push(o);
  }
  return r;
}

/** As anteriores ou as posteriores, para o modal: quantos movimentos, o valor e cada competência. */
function resumo(xs: LancamentoDoMovimento[]) {
  const porCompetencia = new Map<string, { competencia: string; movimentos: number; valor: Prisma.Decimal }>();
  for (const x of xs) {
    const k = rotulo(x.competencia.ano, x.competencia.mes);
    const c = porCompetencia.get(k) ?? { competencia: k, movimentos: 0, valor: new Prisma.Decimal(0) };
    c.movimentos++;
    c.valor = c.valor.add(x.valorMovimento);
    porCompetencia.set(k, c);
  }
  return {
    movimentos: xs.length,
    valor: xs.reduce((s, x) => s.add(x.valorMovimento), new Prisma.Decimal(0)).toFixed(2),
    competencias: [...porCompetencia.values()].map((c) => ({ ...c, valor: c.valor.toFixed(2) })),
  };
}

/** Quem responde: o id, o nome e se tem recorte (sem recorte, é a Controladoria: o Administrador, o Contador). */
type Respondente = { id: string; nome: string; comRecorte: boolean };
const PERMISSAO_DE_RESPONDER = "contestacoes.recebidas:editar";
const temRecorte = (a: Acesso) => a.recorteCentro || a.recorteDepartamento;

/**
 * Quem responde (acata ou recusa) às contestações de cada centro (30/10/2026, decisão do Adão): os usuários ativos, de
 * perfil ativo, com Editar em Contestações › Recebidas, cada um no seu recorte — com recorte por centro de custo (o
 * Coordenador, o Estratégico), os centros da lista dele; por departamento (o Gestor), os centros dos departamentos dele;
 * sem recorte (o Administrador, o Contador), todos. Sem centro (o movimento sem centro, quando só a conta muda), os sem
 * recorte.
 */
async function responsaveisDosCentros(centroIds: Array<string | null>): Promise<Map<string | null, Respondente[]>> {
  const ids = [...new Set(centroIds)];
  const r = new Map<string | null, Respondente[]>();
  if (!ids.length) return r;
  const [usuarios, centros] = await Promise.all([
    carregarUsuariosAtivos().then((us) => us.filter((u) => u.permissions.includes(PERMISSAO_DE_RESPONDER))),
    getPrismaClient().centroCusto.findMany({ where: { id: { in: ids.filter((x): x is string => !!x) } }, select: { id: true, departamento: true } }),
  ]);
  const respondente = (u: (typeof usuarios)[number]): Respondente => ({ id: u.sub, nome: u.nome, comRecorte: temRecorte(u.acesso) });
  for (const c of centros) r.set(c.id, usuarios.filter((u) => podeVerCentro(u.acesso, c)).map(respondente));
  if (ids.includes(null)) r.set(null, usuarios.filter((u) => !temRecorte(u.acesso)).map(respondente));
  return r;
}

/** Os nomes dos usuários (quem respondeu, quem justificou e quem validou). */
async function nomes(ids: Array<string | null | undefined>) {
  const lista = [...new Set(ids.filter((x): x is string => !!x))];
  if (!lista.length) return new Map<string, string>();
  const us = await getPrismaClient().usuario.findMany({ where: { id: { in: lista } }, select: { id: true, nome: true } });
  return new Map(us.map((u) => [u.id, u.nome]));
}

const centroTexto = (c: { codigoRM: string | null; nomeRM: string } | null) => (c ? `${c.codigoRM ?? "—"} · ${c.nomeRM}` : null);
const contaTexto = (c: { reduzido: string; descricao: string } | null) => (c ? `${c.reduzido} · ${c.descricao}` : null);
/**
 * A contestação de itens do movimento (10/11/2026, Contestar Selecionados): só o valor dos itens muda, pelos lançamentos
 * manuais (o estorno e o novo) — o balancete não se divide.
 */
const ehDeItens = (m: { valorMovimento: Prisma.Decimal | null }) => m.valorMovimento !== null;
/** O movimento sem correção que espera os lançamentos manuais: a competência dele fechada, ou ele fora do balancete reimportado. */
const esperaLancamentos = (m: MovimentoDaContestacao) => !m.formaValidacao && (m.competencia.status === "FECHADA" || !m.lancamentoContabilId);
/** O movimento inteiro sem correção que o Processar corrige no balancete: a competência dele aberta e ele no balancete. */
const corrigivelNoBalancete = (m: MovimentoDaContestacao) => !m.formaValidacao && m.competencia.status !== "FECHADA" && !!m.lancamentoContabilId && !ehDeItens(m);
/**
 * O de itens sem correção que o Processar corrige pelos lançamentos manuais na competência dele (10/11/2026): ela aberta e ele no
 * balancete (o estorno e o novo, com o valor dos itens).
 */
const lancavelNoMes = (m: MovimentoDaContestacao) => !m.formaValidacao && m.competencia.status !== "FECHADA" && !!m.lancamentoContabilId && ehDeItens(m);
/** O movimento para os lançamentos manuais, com quantos itens (a descrição deles). */
const paraOsLancamentos = (m: MovimentoDaContestacao) => ({ ...m, itens: m._count.itens });

/** A contestação para as telas: os movimentos, o antes e o depois, a situação, quem fez o quê e os responsáveis. */
async function apresentar(ls: Linha[], usuarioId: string) {
  const responsaveis = await responsaveisDosCentros(ls.map(centroAlvo));
  const ns = await nomes(ls.flatMap((c) => [c.respondidaPorId, c.justificadaPorId, c.validadaPorId]));
  const itens = await itensDoMovimentoService.contar(ls.flatMap((c) => c.movimentos.map((m) => m.lancamentoContabil?.idMovimento)));
  return ls.map((c) => {
    const resp = responsaveis.get(centroAlvo(c)) ?? [];
    const manual = c.lancamentosManuais[0]?.competencia;
    const acatada = c.situacao === "ACATADA";
    const paraLancamentos = acatada ? c.movimentos.filter(esperaLancamentos) : [];
    return {
      id: c.id,
      numero: c.numero,
      /** A competência do movimento contestado ("09/2026"). */
      competencia: rotulo(c.competencia.ano, c.competencia.mes),
      /** As competências dos movimentos, em ordem (com as anteriores e as posteriores). */
      competencias: [...new Set(c.movimentos.map((m) => rotulo(m.competencia.ano, m.competencia.mes)))],
      competenciaFechada: c.competencia.status === "FECHADA",
      /** O item ainda está no balancete (uma reimportação pode tê-lo tirado). */
      comItem: c.lancamentoContabilId !== null,
      /**
       * O Editar das Validações (10/11/2026): o centro e a conta de antes e os novos (os ids e os departamentos), e por que
       * não dá para editar (nulo se dá) — só a pendente ou a acatada sem movimento corrigido.
       */
      edicao: {
        centroAntesId: c.centroAntesId,
        contaAntesId: c.contaAntes.id,
        centroNovoId: c.centroNovoId,
        contaNovaId: c.contaNovaId,
        departamentoDoCentroAntes: gestaoDoCentro(c.centroAntes?.departamento ?? null),
        departamentoDaContaAntes: c.contaAntes.linhaDRE ? departamentoDaLinha(c.contaAntes.linhaDRE) : null,
        motivoNaoEditar: motivoNaoEditar(c),
      },
      filial: c.filial,
      emissao: c.emissao,
      cliForn: c.cliForn,
      historico: c.historico,
      /** O valor dos movimentos todos (o que muda de centro e/ou de conta; na contestação de itens, o deles). */
      valor: soma(c.movimentos).toFixed(2),
      /** O valor do movimento contestado (o inteiro, também na contestação de itens). */
      valorDoMovimento: c.valor.toFixed(2),
      /** Na contestação de itens do movimento (10/11/2026), quantos itens; 0 na do movimento inteiro. */
      itensContestados: c.movimentos.reduce((s, m) => s + m._count.itens, 0),
      anteriores: c.anteriores,
      posteriores: c.posteriores,
      movimentos: c.movimentos.map((m) => ({
        id: m.id,
        principal: m.principal,
        competencia: rotulo(m.competencia.ano, m.competencia.mes),
        competenciaFechada: m.competencia.status === "FECHADA",
        comItem: m.lancamentoContabilId !== null,
        filial: m.filial,
        emissao: m.emissao,
        cliForn: m.cliForn,
        historico: m.historico,
        valor: m.valor.toFixed(2),
        formaValidacao: m.formaValidacao,
        /** O ID do movimento no RM e quantos itens ele tem nas requisições e nas notas fiscais importadas. */
        idMovimento: m.lancamentoContabil?.idMovimento ?? null,
        itens: m.lancamentoContabil?.idMovimento ? (itens.get(m.lancamentoContabil.idMovimento) ?? 0) : 0,
        /** A contestação de itens (10/11/2026): quantos itens do movimento e o valor dele inteiro (nulo na do movimento inteiro). */
        itensContestados: m._count.itens,
        valorDoMovimento: m.valorMovimento?.toFixed(2) ?? null,
      })),
      /**
       * A correção dos movimentos: no balancete, pelos lançamentos, os que o Processar corrige (no balancete; os de itens, pelos
       * lançamentos na competência deles) e os que esperam o Importar.
       */
      correcao: {
        noBalancete: c.movimentos.filter((m) => m.formaValidacao === "NO_BALANCETE").length,
        porLancamentos: c.movimentos.filter((m) => m.formaValidacao === "LANCAMENTO_MANUAL").length,
        diretos: acatada ? c.movimentos.filter(corrigivelNoBalancete).length : 0,
        itensNoMes: acatada ? c.movimentos.filter(lancavelNoMes).length : 0,
        paraLancamentos: paraLancamentos.length,
        valorParaLancamentos: soma(paraLancamentos).toFixed(2),
        competenciasParaLancamentos: [...new Set(paraLancamentos.map((m) => rotulo(m.competencia.ano, m.competencia.mes)))],
      },
      contaBalancete: contaTexto(c.contaBalancete),
      /** A conta do balancete pelo código reduzido (10/11/2026: os itens do movimento nela). */
      contaBalanceteReduzido: c.contaBalancete?.reduzido ?? null,
      /** O centro de custo do balancete (o código RM), o dos movimentos todos. */
      codigoCentroCusto: c.codigoCentroCusto,
      centroAntes: centroTexto(c.centroAntes) ?? (c.codigoCentroCusto ? `${c.codigoCentroCusto} · ${c.nomeCentroCusto ?? ""}` : null),
      contaAntes: contaTexto(c.contaAntes),
      centroNovo: centroTexto(c.centroNovo),
      contaNova: contaTexto(c.contaNova),
      motivo: c.motivo,
      situacao: c.situacao,
      solicitante: c.solicitante.nome,
      solicitanteId: c.solicitanteId,
      solicitadaEm: c.solicitadaEm,
      respondidaPor: c.respondidaPorId ? (ns.get(c.respondidaPorId) ?? null) : null,
      respondidaEm: c.respondidaEm,
      justificativa: c.justificativa,
      justificadaPor: c.justificadaPorId ? (ns.get(c.justificadaPorId) ?? null) : null,
      justificadaEm: c.justificadaEm,
      validadaPor: c.validadaPorId ? (ns.get(c.validadaPorId) ?? null) : null,
      validadaEm: c.validadaEm,
      formaValidacao: c.formaValidacao,
      /** Onde a contestação virou lançamentos manuais (a competência), quando virou. */
      lancadaEm: manual ? rotulo(manual.ano, manual.mes) : null,
      /** Quem responde com recorte (os nomes); a Controladoria (os sem recorte) à parte. */
      responsaveis: resp.filter((x) => x.comRecorte).map((x) => x.nome),
      controladoria: resp.some((x) => !x.comRecorte),
      /** O usuário é um dos que respondem (acata ou recusa a pendente, na aba Recebidas). */
      souResponsavel: resp.some((x) => x.id === usuarioId),
    };
  });
}

/** Os centros do recorte do usuário (a aba Recebidas); nulo sem recorte (todos). */
async function centrosDoRecorte(acesso: Acesso): Promise<string[] | null> {
  if (!temRecorte(acesso)) return null;
  const todos = await getPrismaClient().centroCusto.findMany({ select: { id: true, departamento: true } });
  return todos.filter((c) => podeVerCentro(acesso, c)).map((c) => c.id);
}

type AbaDaContestacao = "solicitadas" | "recebidas" | "validacoes";

/** As contestações de uma aba: as do usuário (Solicitadas), as dos centros dele (Recebidas) ou todas (Validações). */
async function ondeDaAba(aba: AbaDaContestacao, u: UsuarioDaContestacao): Promise<Prisma.ContestacaoWhereInput> {
  if (aba === "solicitadas") return { solicitanteId: u.id };
  if (aba === "recebidas") {
    // As pedidas por outros usuários (as do próprio ficam em Solicitadas), do recorte dele (o centro novo; sem ele, o do
    // movimento); sem recorte, todas.
    const centros = await centrosDoRecorte(u.acesso);
    return {
      solicitanteId: { not: u.id },
      ...(centros ? { OR: [{ centroNovoId: { in: centros } }, { centroNovoId: null, centroAntesId: { in: centros } }] } : {}),
    };
  }
  return {};
}

/** Por que a contestação não se edita (nulo se edita): só a pendente ou a acatada, sem movimento corrigido nem lançamento manual. */
function motivoNaoEditar(c: Pick<Linha, "situacao" | "movimentos" | "lancamentosManuais">) {
  if (c.situacao !== "PENDENTE" && c.situacao !== "ACATADA") return `A contestação está ${ROTULO_SITUACAO[c.situacao].toLowerCase()}: só a pendente ou a acatada se edita (mude antes a situação em Alterar Status).`;
  if (c.movimentos.some((m) => m.formaValidacao) || c.lancamentosManuais.length) return "A contestação já tem movimentos corrigidos: desfaça a correção em Alterar Status antes de editar.";
  return null;
}

async function exigirContestacao(id: string) {
  const c = await getPrismaClient().contestacao.findUnique({ where: { id }, select: SELECAO });
  if (!c) throw new RegraContestacaoError(404, "Contestação não encontrada.");
  return c;
}

async function exigirLancamento(id: string) {
  const l = await getPrismaClient().lancamentoContabil.findUnique({ where: { id }, select: LANCAMENTO_SEL });
  if (!l) throw new RegraContestacaoError(404, "Movimento não encontrado no balancete.");
  // Como os reflexos dos rateios, o movimento redistribuído (13/11/2026) não se contesta: a redistribuição vale sempre.
  if (l.redistribuicaoId) {
    throw new RegraContestacaoError(409, "O movimento é redistribuído (Cadastros Gerais / Redistribuições de Gastos) e não pode ser contestado.");
  }
  return l;
}

/**
 * Os grupos dos lançamentos manuais (30/10/2026): os movimentos que esperam o Importar, somados pela competência, pela
 * filial, pelo centro e pela conta de antes — um estorno e um lançamento novo por grupo, com a competência do movimento
 * (a que a aba Contestações dos Lançamentos mostra e, com rateio, a dos percentuais). Na ordem das competências.
 */
export function agruparParaLancamentos<
  M extends { filial: number; centroAntesId: string | null; contaAntesId: string; valor: Prisma.Decimal; competencia: { id: string; ano: number; mes: number }; itens?: number },
>(ms: M[]) {
  const grupos = new Map<
    string,
    {
      competencia: { id: string; ano: number; mes: number };
      filial: number;
      centroAntesId: string | null;
      contaAntesId: string;
      valor: Prisma.Decimal;
      movimentos: number;
      /** Os itens contestados (10/11/2026: a contestação de itens do movimento); 0 na do movimento inteiro. */
      itens: number;
    }
  >();
  for (const m of ms) {
    const k = `${m.competencia.id}|${m.filial}|${m.centroAntesId ?? ""}|${m.contaAntesId}`;
    const g = grupos.get(k) ?? { competencia: m.competencia, filial: m.filial, centroAntesId: m.centroAntesId, contaAntesId: m.contaAntesId, valor: new Prisma.Decimal(0), movimentos: 0, itens: 0 };
    g.valor = g.valor.add(m.valor);
    g.movimentos++;
    g.itens += m.itens ?? 0;
    grupos.set(k, g);
  }
  return [...grupos.values()].sort((a, b) => a.competencia.ano - b.competencia.ano || a.competencia.mes - b.competencia.mes);
}

/**
 * Os lançamentos manuais de uma contestação: para cada grupo, o estorno (centro e conta de antes) e o novo (centro e conta
 * novos), os dois com a competência do movimento (30/10/2026): com rateio, a apuração os divide pelos percentuais dela,
 * como o movimento foi dividido, e não pelos da competência dos lançamentos.
 */
async function lancamentosDaContestacao(
  c: { numero: number; historico: string | null; cliForn: string | null; centroNovoId: string | null; contaNovaId: string | null },
  movimentos: Array<{ filial: number; centroAntesId: string | null; contaAntesId: string; valor: Prisma.Decimal; competencia: { id: string; ano: number; mes: number }; itens?: number }>,
) {
  const prisma = getPrismaClient();
  const grupos = agruparParaLancamentos(movimentos);
  const ids = [...new Set(grupos.flatMap((g) => [g.contaAntesId, c.contaNovaId ?? g.contaAntesId]))];
  const contas = await prisma.contaResultado.findMany({ where: { id: { in: ids } }, select: { id: true, linhaDRE: { select: { grupoSigla: true } } } });
  // O valor no sinal da DRE (o do lançamento manual): nas receitas, o do balancete trocado.
  const naDRE = (contaId: string, valor: Prisma.Decimal) => manualNoSinalDoBalancete(contas.find((x) => x.id === contaId)?.linhaDRE?.grupoSigla ?? "", valor);
  const item = (c.historico || c.cliForn || "").slice(0, 120);
  return grupos.flatMap((g) => {
    // Na contestação de itens (10/11/2026), quantos itens do movimento: "· 3 itens de 09/2026".
    const quantos = g.itens ? `${g.itens} ${g.itens === 1 ? "item" : "itens"} de ` : g.movimentos > 1 ? `${g.movimentos} movimentos de ` : "";
    const quando = ` · ${quantos}${rotulo(g.competencia.ano, g.competencia.mes)}`;
    const contaNovaId = c.contaNovaId ?? g.contaAntesId;
    return [
      {
        filial: g.filial,
        centroCustoId: g.centroAntesId,
        contaResultadoId: g.contaAntesId,
        descricao: `Contestação nº ${c.numero}: estorno${item ? ` (${item})` : ""}${quando}`,
        valor: naDRE(g.contaAntesId, g.valor).neg(),
        competenciaMovimentoId: g.competencia.id,
      },
      {
        filial: g.filial,
        centroCustoId: c.centroNovoId ?? g.centroAntesId,
        contaResultadoId: contaNovaId,
        descricao: `Contestação nº ${c.numero}${item ? ` (${item})` : ""}${quando}`,
        valor: naDRE(contaNovaId, g.valor),
        competenciaMovimentoId: g.competencia.id,
      },
    ];
  });
}

const reais = (v: Prisma.Decimal) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** A identidade de um item da lista (10/11/2026): a origem, o produto, o centro, a conta e o valor (o ID é o do movimento). */
const chaveDoItem = (origem: OrigemItemMovimento, x: { codigoProduto: string | null; codigoCentroCusto: string | null; contaContabil: string; valorTotal: string }) =>
  [origem, x.codigoProduto ?? "", x.codigoCentroCusto ?? "", x.contaContabil, Number(x.valorTotal).toFixed(2)].join("|");

/** Um item contestado na lista de hoje: o item, a contestação (o número e a situação) e se é a contestação aberta na tela. */
export type ItemContestado = { id: string; origem: OrigemItemMovimento; numero: number; situacao: SituacaoContestacao; desta: boolean };

/**
 * Os itens contestados na lista de hoje (10/11/2026): os itens das contestações de itens pedidas em `onde`, reconhecidos pela
 * identidade (o item é regravado a cada importação da lista; o mesmo item duas vezes conta duas vezes).
 */
async function marcarContestados(lista: ItensDoMovimento, onde: Prisma.ContestacaoItemWhereInput, destaMovimentoId: string | null): Promise<ItemContestado[]> {
  const xs = await getPrismaClient().contestacaoItem.findMany({
    where: onde,
    select: {
      origem: true,
      codigoProduto: true,
      codigoCentroCusto: true,
      contaContabil: true,
      valorTotal: true,
      contestacaoMovimentoId: true,
      movimento: { select: { contestacao: { select: { numero: true, situacao: true } } } },
    },
    orderBy: [{ movimento: { contestacao: { numero: "asc" } } }],
  });
  if (!xs.length) return [];
  const livres = [
    ...lista.notas.map((n) => ({ id: n.id, origem: "NOTA_FISCAL" as const, chave: chaveDoItem("NOTA_FISCAL", n) })),
    ...lista.requisicoes.map((r) => ({ id: r.id, origem: "REQUISICAO" as const, chave: chaveDoItem("REQUISICAO", r) })),
  ];
  const usados = new Set<string>();
  const r: ItemContestado[] = [];
  for (const x of xs) {
    const k = chaveDoItem(x.origem, { ...x, valorTotal: x.valorTotal.toFixed(2) });
    const item = livres.find((i) => i.chave === k && !usados.has(i.id));
    if (!item) continue;
    usados.add(item.id);
    r.push({ id: item.id, origem: item.origem, numero: x.movimento.contestacao.numero, situacao: x.movimento.contestacao.situacao, desta: x.contestacaoMovimentoId === destaMovimentoId });
  }
  return r;
}

/** Os itens de um movimento nas contestações de itens não recusadas (os que não se contestam de novo). */
const contestadosDoMovimento = (lancamentoId: string): Prisma.ContestacaoItemWhereInput => ({ movimento: { lancamentoContabilId: lancamentoId, contestacao: { situacao: { not: "RECUSADA" } } } });

/**
 * Os itens escolhidos no Contestar Selecionados (10/11/2026), conferidos: do movimento (o ID, a conta do balancete e o centro de
 * custo do RM), fora de outra contestação de itens não recusada e, somados, até o valor do movimento. O valor que muda é a soma
 * deles, no sinal do movimento; a identidade de cada um fica na contestação.
 */
async function itensEscolhidos(l: LancamentoDoMovimento, escolhidos: Array<{ origem: OrigemItemMovimento; id: string }>) {
  if (!l.idMovimento) throw new RegraContestacaoError(400, "O movimento não tem o ID do RM (a coluna ID do Balancete (Lista)): não há itens para contestar.");
  const prisma = getPrismaClient();
  const ids = (origem: OrigemItemMovimento) => [...new Set(escolhidos.filter((x) => x.origem === origem).map((x) => x.id))];
  const sel = { id: true, identificador: true, codigoProduto: true, descricaoItem: true, codigoCentroCusto: true, contaContabil: true, quantidade: true, valorTotal: true } as const;
  const [rs, ns] = await Promise.all([
    prisma.requisicaoItem.findMany({ where: { id: { in: ids("REQUISICAO") } }, select: sel }),
    prisma.notaFiscalItem.findMany({ where: { id: { in: ids("NOTA_FISCAL") } }, select: sel }),
  ]);
  if (rs.length + ns.length !== ids("REQUISICAO").length + ids("NOTA_FISCAL").length) {
    throw new RegraContestacaoError(404, "Algum item escolhido não está mais nas listas importadas (Requisições e Notas Fiscais): abra os itens de novo.");
  }
  const todos = [...ns.map((x) => ({ ...x, origem: "NOTA_FISCAL" as const })), ...rs.map((x) => ({ ...x, origem: "REQUISICAO" as const }))];
  for (const x of todos) {
    if (x.identificador !== l.idMovimento || x.contaContabil !== l.contaResultado.reduzido || (!!l.codigoCentroCusto && x.codigoCentroCusto !== l.codigoCentroCusto)) {
      throw new RegraContestacaoError(400, `O item ${[x.codigoProduto, x.descricaoItem].filter(Boolean).join(" ")} não é do movimento (do ID, do centro de custo e da conta dele no balancete).`);
    }
  }
  const lista = await itensDoMovimentoService.listar(l.idMovimento);
  const ja = (await marcarContestados(lista, contestadosDoMovimento(l.id), null)).find((c) => todos.some((x) => x.id === c.id));
  if (ja) throw new RegraContestacaoError(409, `Um item escolhido já está na contestação nº ${ja.numero} (${ROTULO_SITUACAO[ja.situacao].toLowerCase()}).`);
  const total = todos.reduce((s, x) => s.add(x.valorTotal), new Prisma.Decimal(0));
  if (total.lte(0)) throw new RegraContestacaoError(400, "Os itens escolhidos não têm valor.");
  const doMovimento = l.valorMovimento.abs();
  if (total.gt(doMovimento.add("0.005"))) {
    throw new RegraContestacaoError(400, `Os itens escolhidos somam ${reais(total)}, mais que o movimento (${reais(doMovimento)}): conteste o movimento inteiro.`);
  }
  return {
    valor: l.valorMovimento.isNegative() ? total.neg() : total,
    itens: todos.map((x) => ({
      origem: x.origem,
      identificador: x.identificador!,
      codigoProduto: x.codigoProduto,
      descricaoItem: x.descricaoItem,
      codigoCentroCusto: x.codigoCentroCusto,
      contaContabil: x.contaContabil,
      quantidade: x.quantidade,
      valorTotal: x.valorTotal,
    })),
  };
}

export const contestacoesService = {
  /**
   * O que o modal Contestar mostra do movimento (30/10/2026): o departamento do centro dele (a lista das contas novas,
   * quando a contestação muda só a conta) e as anteriores e as posteriores, com o valor de cada competência.
   */
  async previa(d: { lancamentoId: string; centroNovoId: string | null; contaNovaId: string | null }, u: UsuarioDaContestacao) {
    const prisma = getPrismaClient();
    const l = await exigirLancamento(d.lancamentoId);
    const recusa = recusaDoAcesso(l, u.acesso);
    if (recusa) throw new RegraContestacaoError(403, recusa);
    const centro = l.centroCustoId ? await prisma.centroCusto.findUnique({ where: { id: l.centroCustoId }, select: { departamento: true } }) : null;
    const c = await combinacao(l, u.acesso, d);
    return {
      departamentoDoCentro: gestaoDoCentro(centro?.departamento ?? null),
      /** A conta do movimento e o departamento dela (10/11/2026): com um centro novo de outro departamento, a nova conta é obrigatória. */
      contaDoMovimento: await contaDoItem(l),
      semFornecedor: !l.cliForn,
      valor: l.valorMovimento.toFixed(2),
      anteriores: resumo(c.anteriores),
      posteriores: resumo(c.posteriores),
      /** Os da combinação que ficam de fora: com uma contestação em andamento, ou fora do que o usuário vê. */
      emAndamento: c.emAndamento,
      foraDoAcesso: c.foraDoAcesso,
    };
  },

  /**
   * Contesta um item do balancete (o botão Contestar do modal), com as anteriores e as posteriores, se marcadas. Com `itens`
   * (10/11/2026, o Contestar Selecionados do modal dos itens), só os itens escolhidos do movimento: o valor deles muda.
   */
  async criar(
    d: {
      lancamentoId: string;
      centroNovoId: string | null;
      contaNovaId: string | null;
      motivo: string | null;
      anteriores: boolean;
      posteriores: boolean;
      itens?: Array<{ origem: OrigemItemMovimento; id: string }>;
    },
    u: UsuarioDaContestacao,
  ) {
    const prisma = getPrismaClient();
    const l = await exigirLancamento(d.lancamentoId);
    const recusa = recusaDoAcesso(l, u.acesso);
    if (recusa) throw new RegraContestacaoError(403, recusa);
    const contaAntesId = l.contaAdotadaId ?? l.contaResultadoId;
    await conferirDestino({ centroId: l.centroCustoId, contaId: contaAntesId }, d);
    const deItens = !!d.itens?.length;
    if (deItens && (d.anteriores || d.posteriores)) throw new RegraContestacaoError(400, "A contestação de itens é só do movimento: sem anteriores e posteriores.");
    // As contestações de hoje do movimento: a do movimento inteiro em andamento barra as duas; a de itens em andamento ou
    // validada barra a do movimento inteiro (a de outros itens, não); a do inteiro validada pelos lançamentos barra a de itens.
    const outras = await prisma.contestacaoMovimento.findMany({
      where: { lancamentoContabilId: l.id, contestacao: { situacao: { not: "RECUSADA" } } },
      select: { valorMovimento: true, formaValidacao: true, contestacao: { select: { numero: true, situacao: true } } },
      orderBy: { contestacao: { numero: "asc" } },
    });
    const inteiraAberta = outras.find((m) => !ehDeItens(m) && ABERTAS.includes(m.contestacao.situacao));
    if (inteiraAberta) throw new RegraContestacaoError(409, `O movimento já tem a contestação nº ${inteiraAberta.contestacao.numero} em andamento.`);
    if (!deItens) {
      const deItensAberta = outras.find((m) => ehDeItens(m) && ABERTAS.includes(m.contestacao.situacao));
      if (deItensAberta) throw new RegraContestacaoError(409, `O movimento já tem a contestação nº ${deItensAberta.contestacao.numero} em andamento.`);
      const comItens = outras.find(ehDeItens);
      if (comItens) throw new RegraContestacaoError(409, `O movimento tem itens contestados (a contestação nº ${comItens.contestacao.numero}): conteste os demais itens pelo botão Itens.`);
    } else {
      const inteiraLancada = outras.find((m) => !ehDeItens(m) && m.formaValidacao !== "NO_BALANCETE");
      if (inteiraLancada) throw new RegraContestacaoError(409, `O movimento inteiro já foi contestado (a contestação nº ${inteiraLancada.contestacao.numero}).`);
    }
    const escolhidos = deItens ? await itensEscolhidos(l, d.itens!) : null;
    if ((d.anteriores || d.posteriores) && !l.cliForn) throw new RegraContestacaoError(400, "O movimento não tem fornecedor: não há anteriores nem posteriores para contestar.");
    const outros = d.anteriores || d.posteriores ? await combinacao(l, u.acesso, d) : null;
    const extras = [...(d.anteriores ? (outros?.anteriores ?? []) : []), ...(d.posteriores ? (outros?.posteriores ?? []) : [])];
    const alvo = d.centroNovoId ?? l.centroCustoId;
    const responsaveis = (await responsaveisDosCentros([alvo])).get(alvo) ?? [];
    // Quem pede e responde pelo centro (no recorte dele): acatada na hora.
    const acatada = responsaveis.some((x) => x.id === u.id);
    const agora = new Date();
    const criada = await prisma.contestacao.create({
      data: {
        competenciaId: l.competenciaId,
        lancamentoContabilId: l.id,
        filial: l.filial,
        codigoCentroCusto: l.codigoCentroCusto,
        nomeCentroCusto: l.nomeCentroCusto,
        contaBalanceteId: l.contaResultadoId,
        emissao: l.emissao,
        cliForn: l.cliForn,
        historico: l.historico,
        valor: l.valorMovimento,
        centroAntesId: l.centroCustoId,
        contaAntesId,
        centroNovoId: d.centroNovoId,
        contaNovaId: d.contaNovaId,
        motivo: d.motivo?.trim() || null,
        situacao: acatada ? "ACATADA" : "PENDENTE",
        solicitanteId: u.id,
        anteriores: d.anteriores,
        posteriores: d.posteriores,
        movimentos: {
          create: escolhidos
            ? // A de itens (10/11/2026): o valor deles (o que muda), o do movimento inteiro (a identidade) e os itens.
              [{ ...movimentoDoItem(l, true), valor: escolhidos.valor, valorMovimento: l.valorMovimento, itens: { create: escolhidos.itens } }]
            : [movimentoDoItem(l, true), ...extras.map((x) => movimentoDoItem(x, false))],
        },
        ...(acatada ? { respondidaPorId: u.id, respondidaEm: agora } : {}),
      },
      select: SELECAO,
    });
    const [r] = await apresentar([criada], u.id);
    await auditar({
      usuarioId: u.id,
      usuarioNome: u.nome,
      acao: "CRIACAO",
      entidade: "contestacao",
      entidadeId: criada.id,
      depois: r,
      metadados: {
        numero: criada.numero,
        competencia: rotulo(l.competencia.ano, l.competencia.mes),
        movimentos: criada.movimentos.length,
        anteriores: d.anteriores,
        posteriores: d.posteriores,
        ...(escolhidos ? { itens: escolhidos.itens.length, valorDosItens: escolhidos.valor.toFixed(2) } : {}),
      },
    });
    return r;
  },

  /** As contestações de uma aba: as do usuário (Solicitadas), as dos centros dele (Recebidas) ou todas (Validações). */
  async listar(aba: AbaDaContestacao, u: UsuarioDaContestacao) {
    const ls = await getPrismaClient().contestacao.findMany({ where: await ondeDaAba(aba, u), select: SELECAO, orderBy: [{ solicitadaEm: "desc" }] });
    return apresentar(ls, u.id);
  },

  /**
   * Os itens de um movimento da contestação (10/11/2026): a contestação tem de estar na aba do usuário, como na lista. Com os
   * itens contestados (os desta contestação e os das outras de itens do movimento, não recusadas).
   */
  async itensDoMovimento(id: string, movimentoId: string, aba: AbaDaContestacao, u: UsuarioDaContestacao) {
    const c = await getPrismaClient().contestacao.findFirst({
      where: { AND: [{ id }, await ondeDaAba(aba, u)] },
      select: { movimentos: { where: { id: movimentoId }, select: { id: true, lancamentoContabilId: true, lancamentoContabil: { select: { idMovimento: true } } } } },
    });
    if (!c) throw new RegraContestacaoError(404, "Contestação não encontrada.");
    const m = c.movimentos[0];
    if (!m) throw new RegraContestacaoError(404, "O movimento não está na contestação.");
    if (!m.lancamentoContabil?.idMovimento) throw new RegraContestacaoError(404, "O movimento não tem o ID do RM (a coluna ID do Balancete (Lista)).");
    const lista = await itensDoMovimentoService.listar(m.lancamentoContabil.idMovimento);
    const onde: Prisma.ContestacaoItemWhereInput = m.lancamentoContabilId ? { OR: [{ contestacaoMovimentoId: m.id }, contestadosDoMovimento(m.lancamentoContabilId)] } : { contestacaoMovimentoId: m.id };
    return { ...lista, contestados: await marcarContestados(lista, onde, m.id) };
  },

  /** Os itens contestados de um movimento do balancete (10/11/2026): os das contestações de itens dele não recusadas. */
  async itensContestados(lancamentoId: string, lista: ItensDoMovimento) {
    return marcarContestados(lista, contestadosDoMovimento(lancamentoId), null);
  },

  /**
   * Os movimentos contestados de um balancete (o modal): a situação da última contestação de cada um, para a coluna Ações — se
   * ela é de itens do movimento (10/11/2026) e se o movimento tem itens numa contestação não recusada (que barra a do inteiro).
   */
  async doBalancete(lancamentoIds: string[]) {
    const r = new Map<string, { numero: number; situacao: SituacaoContestacao; deItens: boolean; comItensContestados: boolean }>();
    if (!lancamentoIds.length) return r;
    const ms = await getPrismaClient().contestacaoMovimento.findMany({
      where: { lancamentoContabilId: { in: lancamentoIds } },
      select: { lancamentoContabilId: true, valorMovimento: true, contestacao: { select: { numero: true, situacao: true } } },
      orderBy: { contestacao: { solicitadaEm: "asc" } },
    });
    // A última de cada movimento.
    for (const m of ms) {
      const antes = r.get(m.lancamentoContabilId!);
      const comItens = (antes?.comItensContestados ?? false) || (ehDeItens(m) && m.contestacao.situacao !== "RECUSADA");
      r.set(m.lancamentoContabilId!, { numero: m.contestacao.numero, situacao: m.contestacao.situacao, deItens: ehDeItens(m), comItensContestados: comItens });
    }
    return r;
  },

  /**
   * O Editar das Validações (10/11/2026, pedido do Adão): troca o centro e/ou a conta novos da contestação pendente ou acatada,
   * sem movimento corrigido, com as mesmas conferências do Contestar (contra o centro e a conta de antes). A situação não muda;
   * a Auditoria guarda o antes e o depois.
   */
  async editar(id: string, d: { centroNovoId: string | null; contaNovaId: string | null }, u: UsuarioDaContestacao) {
    const prisma = getPrismaClient();
    const c = await exigirContestacao(id);
    const motivo = motivoNaoEditar(c);
    if (motivo) throw new RegraContestacaoError(409, motivo);
    if (d.centroNovoId === c.centroNovoId && d.contaNovaId === c.contaNovaId) throw new RegraContestacaoError(400, "Nada mudou: escolha outro centro de custo e/ou outra conta.");
    await conferirDestino({ centroId: c.centroAntesId, contaId: c.contaAntes.id }, d);
    await prisma.contestacao.update({ where: { id }, data: { centroNovoId: d.centroNovoId, contaNovaId: d.contaNovaId } });
    const depois = await exigirContestacao(id);
    const texto = (x: Linha) => ({ centroNovo: x.centroNovo ? `${x.centroNovo.codigoRM ?? ""} ${x.centroNovo.nomeRM}`.trim() : null, contaNova: x.contaNova ? `${x.contaNova.reduzido} ${x.contaNova.descricao}` : null });
    await auditar({ usuarioId: u.id, usuarioNome: u.nome, acao: "ALTERACAO", entidade: "contestacao", entidadeId: id, antes: texto(c), depois: texto(depois), metadados: { numero: c.numero, situacao: c.situacao, tela: "Validações" } });
    return (await apresentar([depois], u.id))[0];
  },

  /** O responsável acata ou recusa a pendente (aba Recebidas). */
  async responder(id: string, d: { acatar: boolean; justificativa: string | null }, u: UsuarioDaContestacao) {
    const prisma = getPrismaClient();
    const c = await exigirContestacao(id);
    if (c.situacao !== "PENDENTE") throw new RegraContestacaoError(409, `A contestação nº ${c.numero} está ${ROTULO_SITUACAO[c.situacao].toLowerCase()}: só a pendente se acata ou recusa.`);
    const alvo = centroAlvo(c);
    const responsaveis = (await responsaveisDosCentros([alvo])).get(alvo) ?? [];
    if (!responsaveis.some((x) => x.id === u.id)) throw new RegraContestacaoError(403, "Só quem responde pelo centro de custo (no seu recorte) acata ou recusa a contestação.");
    const agora = new Date();
    const justificativa = d.justificativa?.trim() || null;
    const salva = await prisma.contestacao.update({
      where: { id },
      data: {
        situacao: d.acatar ? "ACATADA" : "RECUSADA",
        respondidaPorId: u.id,
        respondidaEm: agora,
        ...(justificativa ? { justificativa, justificadaPorId: u.id, justificadaEm: agora } : {}),
      },
      select: SELECAO,
    });
    const [r] = await apresentar([salva], u.id);
    await auditar({ usuarioId: u.id, usuarioNome: u.nome, acao: d.acatar ? "ACATAR" : "RECUSAR", entidade: "contestacao", entidadeId: id, antes: { situacao: c.situacao }, depois: r, metadados: { numero: c.numero } });
    return r;
  },

  /**
   * Alterar Status (Validações): qualquer situação, com a justificativa. A que deixa de ser validada (ou a acatada com
   * movimentos já corrigidos que volta a pendente ou é recusada) desfaz as correções: no balancete, a classificação deixa
   * de aplicá-las (na próxima apuração); pelos lançamentos manuais, eles saem (com a competência deles aberta). A que passa
   * a validada por aqui não corrige nada além do que já estava: é a validação feita fora do SIG.
   */
  async alterarSituacao(id: string, d: { situacao: SituacaoContestacao; justificativa: string }, u: UsuarioDaContestacao) {
    const prisma = getPrismaClient();
    const c = await exigirContestacao(id);
    const justificativa = d.justificativa.trim();
    if (!justificativa) throw new RegraContestacaoError(400, "Escreva a justificativa.");
    if (c.situacao === d.situacao) throw new RegraContestacaoError(409, `A contestação nº ${c.numero} já está ${ROTULO_SITUACAO[d.situacao].toLowerCase()}.`);
    const agora = new Date();
    const desfaz = d.situacao !== "VALIDADA" && c.movimentos.some((m) => m.formaValidacao);
    const noBalanceteFechado = desfaz ? c.movimentos.find((m) => m.formaValidacao === "NO_BALANCETE" && m.competencia.status === "FECHADA") : undefined;
    if (noBalanceteFechado) {
      throw new RegraContestacaoError(409, `A correção da contestação nº ${c.numero} está no balancete de ${rotulo(noBalanceteFechado.competencia.ano, noBalanceteFechado.competencia.mes)}, fechada: reabra a competência antes.`);
    }
    const manuais = desfaz ? await prisma.lancamentoManual.findMany({ where: { contestacaoId: id }, select: { id: true, competencia: { select: { ano: true, mes: true, status: true } } } }) : [];
    const fechada = manuais.find((m) => m.competencia.status === "FECHADA");
    if (fechada) throw new RegraContestacaoError(409, `Os lançamentos da contestação nº ${c.numero} estão na competência ${rotulo(fechada.competencia.ano, fechada.competencia.mes)}, fechada: reabra a competência antes.`);
    const salva = await prisma.$transaction(async (tx) => {
      if (manuais.length) await tx.lancamentoManual.deleteMany({ where: { contestacaoId: id } });
      if (desfaz) {
        await tx.contestacaoMovimento.updateMany({ where: { contestacaoId: id, formaValidacao: "NO_BALANCETE" }, data: { formaValidacao: null, corrigidoEm: agora } });
        await tx.contestacaoMovimento.updateMany({ where: { contestacaoId: id, formaValidacao: "LANCAMENTO_MANUAL" }, data: { formaValidacao: null } });
      }
      const sai = c.situacao === "VALIDADA";
      return tx.contestacao.update({
        where: { id },
        data: {
          situacao: d.situacao,
          justificativa,
          justificadaPorId: u.id,
          justificadaEm: agora,
          ...(d.situacao === "VALIDADA"
            ? { validadaPorId: u.id, validadaEm: agora, formaValidacao: formaDaContestacao(c.movimentos) }
            : sai
              ? { validadaPorId: null, validadaEm: null, formaValidacao: null }
              : {}),
        },
        select: SELECAO,
      });
    });
    const [r] = await apresentar([salva], u.id);
    await auditar({
      usuarioId: u.id,
      usuarioNome: u.nome,
      acao: "ALTERACAO",
      entidade: "contestacao",
      entidadeId: id,
      antes: { situacao: c.situacao, formaValidacao: c.formaValidacao },
      depois: r,
      metadados: { numero: c.numero, justificativa, lancamentosExcluidos: manuais.length },
    });
    return r;
  },

  /**
   * Processar (Validações): os movimentos das acatadas com a competência aberta (e no balancete) ficam corrigidos no
   * balancete — a classificação aplica o centro e a conta novos (já, na competência ainda não apurada; nas apuradas, na
   * reapuração, que a situação pede); os demais (competência fechada, ou o item fora do balancete reimportado) esperam a
   * importação para os lançamentos manuais de uma competência aberta. Os de itens (10/11/2026), com a competência aberta e no
   * balancete, viram já o estorno e o lançamento novo, com o valor dos itens, nos lançamentos manuais da competência deles (a
   * aba Contestações; a apurada pede reapuração). A contestação com todos corrigidos fica validada. `ids` limita a algumas
   * acatadas (os roteiros de conferência; a tela processa todas).
   */
  async processar(u: UsuarioDaContestacao, ids?: string[]) {
    const prisma = getPrismaClient();
    const acatadas = await prisma.contestacao.findMany({
      where: { situacao: "ACATADA", ...(ids ? { id: { in: ids } } : {}) },
      select: { id: true, numero: true, historico: true, cliForn: true, centroNovoId: true, contaNovaId: true, movimentos: { select: MOVIMENTO_SEL } },
    });
    const agora = new Date();
    const competencias = new Map<string, MovimentoDaContestacao["competencia"]>();
    const dosLancamentos = new Map<string, MovimentoDaContestacao["competencia"]>();
    const validadas: number[] = [];
    const recusadas: Array<{ numero: number; motivo: string }> = [];
    let movimentos = 0;
    let porLancamentos = 0;
    let paraLancamentos = 0;
    for (const c of acatadas) {
      const diretos = c.movimentos.filter(corrigivelNoBalancete);
      if (diretos.length) {
        await prisma.contestacaoMovimento.updateMany({ where: { id: { in: diretos.map((m) => m.id) } }, data: { formaValidacao: "NO_BALANCETE", corrigidoEm: agora } });
        for (const m of diretos) competencias.set(m.competencia.id, m.competencia);
        movimentos += diretos.length;
      }
      // Os de itens: o estorno e o novo na competência do movimento (a que um lançamento não aceita fica, com o motivo).
      const lancados: MovimentoDaContestacao[] = [];
      for (const m of c.movimentos.filter(lancavelNoMes)) {
        try {
          const pares = await lancamentosDaContestacao(c, [paraOsLancamentos(m)]);
          await lancamentosManuaisService.criarDeContestacao(m.competencia.id, c.id, MOTIVO_CONTESTACAO, pares, u.id);
          await prisma.contestacaoMovimento.update({ where: { id: m.id }, data: { formaValidacao: "LANCAMENTO_MANUAL" } });
          dosLancamentos.set(m.competencia.id, m.competencia);
          lancados.push(m);
        } catch (e) {
          recusadas.push({ numero: c.numero, motivo: e instanceof Error ? e.message : String(e) });
        }
      }
      porLancamentos += lancados.length;
      const depois = c.movimentos.map((m) =>
        diretos.includes(m) ? { ...m, formaValidacao: "NO_BALANCETE" as const } : lancados.includes(m) ? { ...m, formaValidacao: "LANCAMENTO_MANUAL" as const } : m,
      );
      if (depois.every((m) => m.formaValidacao)) {
        await prisma.contestacao.update({ where: { id: c.id }, data: { situacao: "VALIDADA", formaValidacao: formaDaContestacao(depois), validadaPorId: u.id, validadaEm: agora } });
        validadas.push(c.numero);
      } else paraLancamentos++;
    }
    // As competências ainda não apuradas se reclassificam já; as apuradas pedem reapuração (também as dos lançamentos dos itens).
    const reclassificadas: string[] = [];
    const reapurar: string[] = [];
    for (const comp of competencias.values()) {
      if (comp.apuradaEm) reapurar.push(rotulo(comp.ano, comp.mes));
      else {
        await classificacaoService.classificarCompetencia(comp.id);
        reclassificadas.push(rotulo(comp.ano, comp.mes));
      }
    }
    for (const comp of dosLancamentos.values()) {
      if (comp.apuradaEm && !competencias.has(comp.id)) reapurar.push(rotulo(comp.ano, comp.mes));
    }
    reapurar.sort((a, b) => a.slice(3).localeCompare(b.slice(3)) || a.localeCompare(b));
    const resumoDoProcessar = { validadas: validadas.length, movimentos, porLancamentos, paraLancamentos, reclassificadas, reapurar, recusadas };
    await auditar({ usuarioId: u.id, usuarioNome: u.nome, acao: "PROCESSAR", entidade: "contestacao", entidadeId: null, metadados: { ...resumoDoProcessar, numeros: validadas } });
    return resumoDoProcessar;
  },

  /** As acatadas com movimentos que não puderam ser corrigidos no balancete (o modal Importar da aba Contestações dos Lançamentos). */
  async paraLancamentos(ano: number, mes: number, u: UsuarioDaContestacao) {
    const prisma = getPrismaClient();
    const destino = await prisma.competencia.findUnique({ where: { ano_mes: { ano, mes } }, select: { id: true } });
    if (!destino) throw new RegraContestacaoError(404, `A competência ${rotulo(ano, mes)} não existe.`);
    const ls = await prisma.contestacao.findMany({
      where: { situacao: "ACATADA", movimentos: { some: { formaValidacao: null, OR: [{ competencia: { status: "FECHADA" } }, { lancamentoContabilId: null }] } } },
      select: SELECAO,
      orderBy: [{ competencia: { ano: "asc" } }, { competencia: { mes: "asc" } }, { numero: "asc" }],
    });
    return apresentar(ls, u.id);
  },

  /**
   * Importar Selecionadas (aba Contestações dos Lançamentos, numa competência aberta): os movimentos de cada contestação
   * que esperam os lançamentos viram, somados pela competência, pela filial, pelo centro e pela conta de antes, o estorno e
   * o lançamento no centro e na conta novos (com a competência do movimento, que, com rateio, dá os percentuais); a
   * contestação com todos corrigidos fica validada. A que um lançamento não aceita (uma
   * combinação que nenhuma aba soma) fica como estava, com o motivo.
   */
  async importar(ano: number, mes: number, ids: string[], u: UsuarioDaContestacao) {
    const prisma = getPrismaClient();
    const destino = await prisma.competencia.findUnique({ where: { ano_mes: { ano, mes } }, select: { id: true, status: true } });
    if (!destino) throw new RegraContestacaoError(404, `A competência ${rotulo(ano, mes)} não existe.`);
    if (destino.status === "FECHADA") throw new RegraContestacaoError(409, `A competência ${rotulo(ano, mes)} está fechada. Importar nela exige reabri-la.`);
    const cs = await prisma.contestacao.findMany({
      where: { id: { in: ids }, situacao: "ACATADA" },
      select: { id: true, numero: true, historico: true, cliForn: true, centroNovoId: true, contaNovaId: true, movimentos: { select: MOVIMENTO_SEL } },
    });
    const importadas: number[] = [];
    const recusadas: Array<{ numero: number; motivo: string }> = [];
    for (const c of cs) {
      const pendentes = c.movimentos.filter(esperaLancamentos);
      if (!pendentes.length) continue;
      try {
        const pares = await lancamentosDaContestacao(c, pendentes.map(paraOsLancamentos));
        await lancamentosManuaisService.criarDeContestacao(destino.id, c.id, MOTIVO_CONTESTACAO, pares, u.id);
        await prisma.contestacaoMovimento.updateMany({ where: { id: { in: pendentes.map((m) => m.id) } }, data: { formaValidacao: "LANCAMENTO_MANUAL" } });
        const depois = c.movimentos.map((m) => (pendentes.includes(m) ? { ...m, formaValidacao: "LANCAMENTO_MANUAL" as const } : m));
        if (depois.every((m) => m.formaValidacao)) {
          await prisma.contestacao.update({ where: { id: c.id }, data: { situacao: "VALIDADA", formaValidacao: formaDaContestacao(depois), validadaPorId: u.id, validadaEm: new Date() } });
        }
        importadas.push(c.numero);
      } catch (e) {
        recusadas.push({ numero: c.numero, motivo: e instanceof Error ? e.message : String(e) });
      }
    }
    await auditar({ usuarioId: u.id, usuarioNome: u.nome, acao: "IMPORTACAO", entidade: "contestacao", entidadeId: null, metadados: { competencia: rotulo(ano, mes), importadas, recusadas } });
    return { importadas: importadas.length, recusadas };
  },

  /**
   * Desfaz a importação de uma contestação (a lixeira da aba Contestações dos Lançamentos, na competência aberta): os
   * lançamentos dela saem, os movimentos voltam a esperar o Importar, e ela volta a acatada.
   */
  async desfazerImportacao(id: string, u: UsuarioDaContestacao) {
    const prisma = getPrismaClient();
    const c = await exigirContestacao(id);
    const manuais = await prisma.lancamentoManual.findMany({ where: { contestacaoId: id }, select: { id: true, competencia: { select: { ano: true, mes: true, status: true } } } });
    if (!manuais.length) throw new RegraContestacaoError(404, `A contestação nº ${c.numero} não tem lançamentos.`);
    const comp = manuais[0].competencia;
    if (comp.status === "FECHADA") throw new RegraContestacaoError(409, `A competência ${rotulo(comp.ano, comp.mes)} está fechada.`);
    await prisma.$transaction([
      prisma.lancamentoManual.deleteMany({ where: { contestacaoId: id } }),
      prisma.contestacaoMovimento.updateMany({ where: { contestacaoId: id, formaValidacao: "LANCAMENTO_MANUAL" }, data: { formaValidacao: null } }),
      prisma.contestacao.update({ where: { id }, data: { situacao: "ACATADA", formaValidacao: null, validadaPorId: null, validadaEm: null } }),
    ]);
    await auditar({ usuarioId: u.id, usuarioNome: u.nome, acao: "EXCLUSAO", entidade: "contestacao", entidadeId: id, metadados: { numero: c.numero, desfeita: rotulo(comp.ano, comp.mes) } });
  },

  /**
   * Depois de reimportar o balancete de uma competência (os lançamentos são gravados de novo): os movimentos das
   * contestações voltam a apontar para o item, pela identidade dele (a filial, o centro e a conta do RM, a emissão, o
   * cliente ou fornecedor, o histórico e o valor). O corrigido no balancete cujo item não volta perde a correção, e a
   * contestação validada fica acatada de novo, com o aviso na justificativa.
   */
  async religar(competenciaId: string) {
    const prisma = getPrismaClient();
    const soltos = await prisma.contestacaoMovimento.findMany({
      where: { competenciaId, lancamentoContabilId: null, contestacao: { situacao: { not: "RECUSADA" } } },
      select: {
        id: true,
        principal: true,
        contestacaoId: true,
        formaValidacao: true,
        filial: true,
        codigoCentroCusto: true,
        contaBalanceteId: true,
        emissao: true,
        cliForn: true,
        historico: true,
        valor: true,
        valorMovimento: true,
        contestacao: { select: { situacao: true } },
      },
      orderBy: [{ contestacao: { numero: "asc" } }],
    });
    if (!soltos.length) return { religadas: 0, semItem: 0 };
    const usados = new Set(
      (await prisma.contestacaoMovimento.findMany({ where: { competenciaId, lancamentoContabilId: { not: null } }, select: { lancamentoContabilId: true } })).map((m) => m.lancamentoContabilId!),
    );
    let religadas = 0;
    let semItem = 0;
    for (const m of soltos) {
      const candidatos = await prisma.lancamentoContabil.findMany({
        where: {
          competenciaId,
          filial: m.filial,
          codigoCentroCusto: m.codigoCentroCusto,
          contaResultadoId: m.contaBalanceteId,
          emissao: m.emissao,
          cliForn: m.cliForn,
          historico: m.historico,
          // Na contestação de itens (10/11/2026), o valor do movimento inteiro.
          valorMovimento: m.valorMovimento ?? m.valor,
        },
        select: { id: true },
        orderBy: { linhaArquivo: "asc" },
      });
      const l = candidatos.find((x) => !usados.has(x.id));
      if (l) {
        usados.add(l.id);
        await prisma.contestacaoMovimento.update({ where: { id: m.id }, data: { lancamentoContabilId: l.id } });
        if (m.principal) await prisma.contestacao.update({ where: { id: m.contestacaoId }, data: { lancamentoContabilId: l.id } });
        religadas++;
        continue;
      }
      semItem++;
      if (m.formaValidacao !== "NO_BALANCETE") continue;
      const agora = new Date();
      await prisma.contestacaoMovimento.update({ where: { id: m.id }, data: { formaValidacao: null, corrigidoEm: agora } });
      if (m.contestacao.situacao === "VALIDADA") {
        await prisma.contestacao.update({
          where: { id: m.contestacaoId },
          data: {
            situacao: "ACATADA",
            formaValidacao: null,
            validadaPorId: null,
            validadaEm: null,
            justificativa: "Um movimento não está no balancete reimportado: a correção dele no balancete foi desfeita.",
            justificadaPorId: null,
            justificadaEm: agora,
          },
        });
      }
    }
    return { religadas, semItem };
  },
};
