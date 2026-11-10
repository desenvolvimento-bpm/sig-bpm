import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";

import { getPrismaClient } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { MarcacaoCenario, VisualizacaoCenario } from "../../generated/prisma/enums.js";
import { ArquivoInvalidoError, lerAba, listarAbas } from "../../lib/xlsx.js";
import { ACESSO_TOTAL } from "../acesso/acesso.js";
import { auditar } from "../auditoriaService.js";
import { caminhoDoArquivo, diretorioUploads } from "../importacoes/arquivosImportados.js";
import { INDICADORES_DAS_LISTAS } from "../relatorios/catalogoIndicadores.js";
import { basesDoConsolidado, COD } from "../relatorios/basesResultados.js";
import { estrutura, montar } from "../relatorios/resultadosService.js";
import { estrutura as estruturaDRE } from "../dre/dreService.js";
import { contasDaUnidade, ErroEdicao, gravarValores, linhasDaUnidade, linhasDoConsolidado, recalcular, UNIDADES, type Alteracao } from "./edicaoCenario.js";
import { indicadoresService } from "../relatorios/indicadoresService.js";
import { calcularCenario, type CalculoDoCenario } from "./indicadoresDoCenario.js";
import {
  ABA_CONSOLIDADO,
  abaDaPlanilha,
  abaDeInvestimentos,
  abaDoQuadroDeLotacao,
  ABAS_DAS_PREMISSAS,
  blocoDaChave,
  DEPARTAMENTOS,
  departamentoDoGrupoDRE,
  departamentosDaLinha,
  departamentosDaUnidade,
  lerArquivoDePremissas,
  NOME_DA_ABA,
  origensDaAba,
  type AbaDasPremissas,
  type Departamento,
  type InvestimentoLido,
  type LinhaDaPlanilha,
} from "./planilhaPremissas.js";
import { abaConsolidado, type OrigensDasContas } from "./consolidadoDosCentros.js";
import { gerarXlsx, nomesDasAbas, type AbaEscrita } from "../../lib/xlsxEscrita.js";
import { limparNome, nomeDoDepartamento, TIPO_ZIP, zipDeArquivos } from "../../lib/arquivosExportados.js";
import { montarPainel } from "../relatorios/painelService.js";
import { type Valor } from "../relatorios/painelDeBordo.js";
import { quadrosDoPainel } from "../relatorios/cadastroPainel.js";
import { limiteDaLinha, linhasDasVisoes, mesesAcima, totaisDaDRE } from "./comparativoCenario.js";
import { ABAS_DRE, ABAS_METAS, acharAba, lerAbaDRE, lerAbaMetas, MESES, type AbaDRELida, type AbaMetasLida } from "./leituraCenario.js";
import {
  C as CONTAS_DAS_PREMISSAS,
  calcularAnalitico,
  calcularPremissas,
  calcularTabela,
  linhasDaTabela,
  linhasDoCadastro,
  NOME_DA_UNIDADE,
  NOME_DA_VENDA,
  UNIDADES_PREMISSAS,
  VENDAS_DA_UNIDADE,
  type UnidadePremissa,
  type Venda,
} from "./premissasCenario.js";
import { contasDoGrupo, gruposDoCadastro, RATEIOS, rateiosSemBase } from "./centrosCenario.js";
import {
  CONTAS_DEPRECIACAO,
  contaDeDepreciacao,
  contasExtra,
  depreciacaoMensal,
  depreciacaoNosMeses,
  UNIDADES_EXTRA,
  VENDA_BASE,
  VENDA_EXTRA,
} from "./investimentosCenario.js";
import { mediaDosMeses, mediaNosMesesComOcorrencia, referenciaDoRealizado } from "./referenciaAnalitico.js";
import { diferencasDasDecisoes, lerRealocacoes, type Realocacoes } from "./realocacoesCenario.js";
import { QUADROS_DE_LOTACAO, quadroDoGrupo, VENDA_LOTACAO_CLT, VENDA_LOTACAO_PJ, VENDAS_LOTACAO } from "./lotacaoCenario.js";
import { beneficiosDaDiferenca, ehContaDeEncargos, itemDosEncargos, ITENS_DOS_ENCARGOS, maosDeObraDoGrupo, VENDAS_DOS_ENCARGOS } from "./encargosCenario.js";
import { copiarQuadro, ehAprendiz, linhasDoQuadro, mesesDaLinha, quadroDosGrupos, type MesDaLinha } from "./quadroDoCenario.js";
import { resolvedorDeColaboradores } from "../colaboradores/importacaoCadastros.js";
import { lotacaoDosGrupos } from "../listas/lotacaoDosCentros.js";
import { assinaturaDasRegras, avisosDosRateios, bloqueioPorRateios, mesesDoAno, percentuaisPelasRegras, regrasDeRateio, type RegraDoMes } from "../volumes/vigenciaDosRateios.js";

/**
 * Os cenários sintéticos (Criação de Cenários, 11/10/2026): a lista dos cenários gerados, a criação (vazio ou cópia
 * de outro), a importação de um arquivo, a marcação (Orçamento Empresarial, Resultados Anteriores, Resultados
 * Vendidos — cada uma ativa em um cenário só por vez) e as telas Resultados e Indicadores de cada cenário.
 *
 * A visualização (11/10/2026): o cenário particular só aparece para quem o criou e para o Administrador (Editar no
 * Controle de Usuários); para os demais, ele não existe (404). O público aparece para todos com permissão.
 */

export class CenarioError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

export const MARCACOES: Record<MarcacaoCenario, string> = {
  // Os nomes curtos (22/10/2026; antes, Orçamento Empresarial, Resultados Anteriores, Resultados Vendidos e Previsão de Resultados).
  ORCAMENTO_EMPRESARIAL: "Orçamento",
  RESULTADOS_ANTERIORES: "Anterior",
  RESULTADOS_VENDIDOS: "Vendido",
  PREVISAO: "Previsão",
};

/**
 * O tipo do cenário (13/10/2026): os sintéticos (a DRE importada ou digitada) e os analíticos (a DRE calculada a partir
 * das premissas). Ficam em listas separadas: um cenário só copia e importa de outro do mesmo tipo; o comparativo vale
 * entre os tipos (pela DRE; o que só os analíticos têm, como os centros de custo, só se compara entre analíticos).
 */
export type TipoCenario = "SINTETICO" | "ANALITICO";
export const TIPOS: Record<TipoCenario, string> = { SINTETICO: "Cenários Sintéticos", ANALITICO: "Cenários Analíticos" };

/** O que só os sintéticos fazem: a importação de um arquivo, a edição da DRE e (por enquanto) a referência realizada. */
function exigirSintetico(c: { nome: string; tipo: string }, oQue: string) {
  if (c.tipo === "ANALITICO") throw new CenarioError(400, `O cenário ${c.nome} é analítico: ${oQue}.`);
}

/** O que só os analíticos têm: as premissas. */
function exigirAnalitico(c: { nome: string; tipo: string }) {
  if (c.tipo !== "ANALITICO") throw new CenarioError(400, `O cenário ${c.nome} é sintético: as premissas são só dos cenários analíticos.`);
}

/** Quem pede: `admin` é o Administrador (o perfil Administrador, 14/10/2026; antes, Editar no Controle de Usuários), que vê também os cenários particulares. */
type Usuario = { id: string; nome: string; admin?: boolean };
/** Uma parte da referência composta dos sintéticos (15/10/2026): a origem e os meses do cenário (`mesDe`–`mesAte`) que ela preenche. */
export type ParteDaReferencia =
  | { tipo: "REALIZADO"; ano: number; modo: "MES_A_MES" | "MEDIA"; de?: number; ate?: number; mesDe: number; mesAte: number }
  | { tipo: "CENARIO"; origemId: string; mesDe: number; mesAte: number };
/** O que a tela fez numa gravação de valores (o histórico de reajustes, 12/10/2026). */
export type OrigemDaGravacao = { tipo: "MARCADOS" | "VALOR"; modo: "PERCENTUAL" | "ABSOLUTO" | "DIGITADO"; reajuste: number | null; replicado: boolean };
/** As chamadas internas (testes, scripts) veem todos os cenários. */
const SISTEMA: Usuario = { id: "", nome: "Sistema", admin: true };

export const VISUALIZACOES: Record<VisualizacaoCenario, string> = { PARTICULAR: "Particular", PUBLICA: "Pública" };
/** O usuário alcança o cenário? */
const alcanca = (c: { visualizacao: VisualizacaoCenario; criadoPorId: string | null }, u: Usuario) =>
  c.visualizacao === "PUBLICA" || !!u.admin || (!!c.criadoPorId && c.criadoPorId === u.id);
/** Quem muda a visualização de um cenário: quem o criou e o Administrador. */
const mudaVisualizacao = (c: { criadoPorId: string | null }, u: Usuario) => !!u.admin || (!!c.criadoPorId && c.criadoPorId === u.id);
/**
 * As Configurações (o cenário, a referência e o comparativo) só se alteram por quem criou o cenário ou pelo
 * Administrador (14/10/2026): num cenário público, os demais as leem. É a mesma regra da visualização.
 */
function exigirQuemCriou(c: { nome: string; criadoPorId: string | null }, u: Usuario) {
  if (!mudaVisualizacao(c, u)) throw new CenarioError(403, `O cenário ${c.nome} é de outro usuário: só quem o criou (ou o Administrador) altera as Configurações dele.`);
}
const LOTE = 500;
const MANUAIS = new Set(INDICADORES_DAS_LISTAS);
const rotuloMes = (ano: number, mes: number) => `${MESES[mes - 1]}/${String(ano).slice(2)}`;

/** O rótulo da versão: VER00, VER01… */
export const rotuloVersao = (v: number) => `VER${String(v).padStart(2, "0")}`;

/**
 * As travas dos dados do cenário — a DRE, os indicadores manuais e a referência (arquivo ou realizado); o nome, a
 * descrição, o comparativo e as justificativas continuam editáveis:
 * - o cenário marcado (12/10/2026: Orçamento Empresarial, Resultados Anteriores ou Resultados Vendidos);
 * - a versão congelada (13/10/2026: Congelar Versão trava o cenário, como o fechamento de uma competência; para mudar,
 *   reabre-se a versão ou cria-se uma revisão).
 */
/** Os rateios sem regra vigente em algum mês do exercício não deixam abrir nem fechar um cenário analítico (14/10/2026). */
function exigirRateios(regras: RegraDoMes[], ano: number, acao: string) {
  const bloqueio = bloqueioPorRateios(regras, mesesDoAno(ano), acao);
  if (bloqueio) throw new CenarioError(409, bloqueio);
}

function exigirEditavel(c: { nome: string; marcacao: MarcacaoCenario | null; versao: number; versaoSalvaEm: Date | null }) {
  if (c.versaoSalvaEm) throw new CenarioError(409, `A ${rotuloVersao(c.versao)} do cenário ${c.nome} está congelada e não se edita: reabra a versão (Reabrir Versão) ou crie uma revisão (Criar Revisão), na tela Resultados.`);
  if (c.marcacao) throw new CenarioError(409, `O cenário ${c.nome} está marcado como ${MARCACOES[c.marcacao]} e não se edita: tire a marcação (ou marque outro cenário) antes de editá-lo.`);
}

/** O cenário, se o usuário o alcança; o particular de outro usuário é "não encontrado". */
async function obterOuFalhar(id: string, usuario: Usuario) {
  const c = await getPrismaClient().cenario.findUnique({ where: { id } });
  if (!c || !alcanca(c, usuario)) throw new CenarioError(404, "Cenário não encontrado.");
  return c;
}

/** O que o cenário tem: as visões da DRE com valor e os indicadores com meta. */
async function conteudo(ids: string[]) {
  const prisma = getPrismaClient();
  const [visoes, metas] = await Promise.all([
    prisma.cenarioResultado.groupBy({ by: ["cenarioId", "visao"], where: { cenarioId: { in: ids } } }),
    prisma.cenarioIndicador.groupBy({ by: ["cenarioId", "nome"], where: { cenarioId: { in: ids } } }),
  ]);
  return (id: string) => ({
    visoes: visoes.filter((v) => v.cenarioId === id).map((v) => v.visao).sort(),
    indicadores: metas.filter((m) => m.cenarioId === id).length,
  });
}

/**
 * A DRE de um cenário numa visão, mês a mês: os valores da visão e as bases (as do Consolidado em Despesas e Extra e no
 * RN, cuja tabela abre com a ROL do Consolidado, como em Resultados Empresariais) e os meses com valor.
 */
async function dreDoCenario(cenarioId: string, visao: 0 | 1 | 2 | 3 | 4 | 5) {
  const visoes = basesDoConsolidado(visao) ? [visao, 0] : [visao];
  const rs = await getPrismaClient().cenarioResultado.findMany({ where: { cenarioId, visao: { in: visoes } }, select: { visao: true, mes: true, valor: true, linhaDRE: { select: { codigo: true } } } });
  const mapas = (v: number) => {
    const porMes = Array.from({ length: 12 }, () => new Map<string, number>());
    for (const r of rs) if (r.visao === v) porMes[r.mes - 1].set(r.linhaDRE.codigo, Number(r.valor));
    return porMes;
  };
  const valores = mapas(visao);
  const consolidado = basesDoConsolidado(visao) ? mapas(0) : valores;
  if (visao === 4 || visao === 5) valores.forEach((m, i) => consolidado[i].has(COD.RO) && m.set(COD.RO, consolidado[i].get(COD.RO)!));
  return { valores, consolidado, comValor: valores.map((m) => m.size > 0) };
}

/**
 * O resumo dos resultados do cenário (13/10/2026, a coluna Resultados da lista): o total do exercício no Consolidado
 * da ROL, do CPV, do EBITDA e do RL, com o % de cada um como na coluna do total da tela Resultados. Null sem DRE.
 */
async function resumoDoCenario(cenarioId: string, linhas: Awaited<ReturnType<typeof estrutura>>) {
  const d = await dreDoCenario(cenarioId, 0);
  if (!d.comValor.some(Boolean)) return null;
  const totais = new Map(montar(linhas, 0, d.comValor, d.valores, d.consolidado, ACESSO_TOTAL).map((l) => [l.codigo, l.total]));
  const de = (codigo: string) => ({ valor: totais.get(codigo)?.valor ?? 0, pct: totais.get(codigo)?.pct ?? null });
  return { rol: de(COD.RO), cpv: de("CPV.CUSTO_DE_PRODUTO_VENDIDO_CPV"), ebitda: de("EBITDA.LUCRO_OPERACIONAL_EBITDA"), rl: de("RL.RESULTADO_LIQUIDO_RL") };
}

/**
 * As famílias de versões (13/10/2026): por família (o id da VER00), a maior versão e quantas versões há. A vigente é a
 * maior; com mais de uma versão, o nome fica travado (é o mesmo em todas, para comparar as versões).
 */
async function familias() {
  const porFamilia = new Map<string, { maior: number; versoes: number }>();
  for (const v of await getPrismaClient().cenario.findMany({ select: { id: true, familiaId: true, versao: true } })) {
    const f = v.familiaId ?? v.id;
    const atual = porFamilia.get(f) ?? { maior: 0, versoes: 0 };
    porFamilia.set(f, { maior: Math.max(atual.maior, v.versao), versoes: atual.versoes + 1 });
  }
  return (c: { id: string; familiaId: string | null; versao: number }) => {
    const f = porFamilia.get(c.familiaId ?? c.id) ?? { maior: c.versao, versoes: 1 };
    return { vigente: c.versao === f.maior, nomeTravado: f.versoes > 1 };
  };
}

/** O cenário comparado (o comparativo), se houver. */
/** Um Índice de Reajuste do cenário analítico (19/10/2026; Configurações / Índices): a variação máxima em %. */
export type IndiceDeReajuste = { chave: string; descricao: string; observacao: string | null; variacao: number };
type ComVariacoes = { tipo: string; variacoesMaximas: unknown; indicesReajuste: unknown; indicesDoComparativo: unknown };

/** Os Índices de Reajuste do cenário (vazio nos sintéticos e nos analíticos sem índices). */
export function indicesDe(c: { indicesReajuste: unknown }): IndiceDeReajuste[] {
  return Array.isArray(c.indicesReajuste) ? (c.indicesReajuste as IndiceDeReajuste[]) : [];
}

/**
 * As variações máximas (em %) de cada linha verificada no comparativo: nos analíticos (19/10/2026), a do índice escolhido
 * para a conta (Configurações / Índices); nos sintéticos, a digitada.
 */
export function limitesDe(c: ComVariacoes): Record<string, number> {
  if (c.tipo !== "ANALITICO") return (c.variacoesMaximas ?? {}) as Record<string, number>;
  const variacao = new Map(indicesDe(c).map((i) => [i.chave, Number(i.variacao)]));
  const escolhidos = (c.indicesDoComparativo ?? {}) as Record<string, string>;
  return Object.fromEntries(Object.entries(escolhidos).flatMap(([codigo, chave]) => (variacao.has(chave) ? [[codigo, variacao.get(chave)!]] : [])));
}

/** O índice de uma linha verificada no Comparativo dos analíticos: o dela ou, sem ele, o do total ou da atribuição acima. */
function indiceDaLinha(escolhidos: Record<string, string>, chaves: Set<string>, codigo: string, acima: string[]): string | null {
  for (const k of [codigo, ...[...acima].reverse()]) if (escolhidos[k] && chaves.has(escolhidos[k])) return escolhidos[k];
  return null;
}

/** Quantas contas (linhas verificadas) do Comparativo usam cada índice, contando as que o herdam de um total. */
async function contasPorIndice(c: { indicesReajuste: unknown; indicesDoComparativo: unknown }): Promise<Map<string, number>> {
  const chaves = new Set(indicesDe(c).map((i) => i.chave));
  const escolhidos = (c.indicesDoComparativo ?? {}) as Record<string, string>;
  const n = new Map<string, number>();
  for (const l of totaisDaDRE(await estruturaDRE()).linhas) {
    if (!l.folha) continue;
    const chave = indiceDaLinha(escolhidos, chaves, l.linha.codigo, l.acima);
    if (chave) n.set(chave, (n.get(chave) ?? 0) + 1);
  }
  return n;
}

async function comparadoDe(c: { comparadoComId: string | null }) {
  return c.comparadoComId ? getPrismaClient().cenario.findUnique({ where: { id: c.comparadoComId }, select: { id: true, nome: true, ano: true } }) : null;
}

type CelulaTotal = { valor: number | null; pct: number | null; unitario: number | null };
const TOTAL_ZERO: CelulaTotal = { valor: 0, pct: null, unitario: null };

/**
 * Os totais do exercício do cenário comparado numa visão, por linha (13/10/2026): o valor, o % e o R$/m³ do total,
 * como a coluna do total da tabela dele. Vão no lugar do orçado dos Resultados Empresariais (só o total, sem o mês).
 */
async function totaisDoComparado(comparadoId: string, visao: 0 | 1 | 2 | 3 | 4 | 5, linhas: Awaited<ReturnType<typeof estrutura>>) {
  const d = await dreDoCenario(comparadoId, visao);
  return new Map(montar(linhas, visao, d.comValor, d.valores, d.consolidado, ACESSO_TOTAL).map((l) => [l.codigo, l.total as CelulaTotal]));
}
/** A linha com o total do comparado (no campo do orçado, só o total). */
const comTotalComparado = <L extends { codigo: string; tipo: string }>(l: L, totais: Map<string, CelulaTotal> | null) =>
  totais ? { ...l, orcado: l.tipo === "SECAO" ? null : { total: totais.get(l.codigo) ?? TOTAL_ZERO } } : l;

async function gravarEmLotes<T>(itens: T[], gravar: (lote: T[]) => Promise<unknown>) {
  for (let i = 0; i < itens.length; i += LOTE) await gravar(itens.slice(i, i + LOTE));
}

/** As abas do arquivo que a importação lê: a DRE por visão e as metas, com o exercício dos rótulos. */
async function lerArquivo(conteudo: Buffer) {
  const prisma = getPrismaClient();
  let abas: string[];
  try {
    abas = listarAbas(conteudo);
  } catch (error) {
    if (error instanceof ArquivoInvalidoError) throw new CenarioError(400, error.message);
    throw error;
  }
  const linhasDRE = await prisma.linhaDRE.findMany({ where: { ativo: true }, orderBy: { ordem: "asc" }, select: { id: true, codigo: true, descricao: true } });
  const nomes = (await prisma.indicadorEstrutura.findMany({ select: { nome: true } })).map((i) => i.nome);
  const dre: AbaDRELida[] = [];
  const ignoradas: string[] = [];
  let metas: AbaMetasLida | null = null;
  try {
    const ler = (aba: string) => lerAba(conteudo, () => aba).linhas;
    for (const a of ABAS_DRE) {
      const aba = acharAba(abas, a.abas);
      if (!aba) continue;
      const lida = lerAbaDRE(a.visao, aba, ler(aba), linhasDRE);
      if (lida) dre.push(lida);
      else ignoradas.push(aba);
    }
    const abaMetas = acharAba(abas, ABAS_METAS);
    if (abaMetas) {
      metas = lerAbaMetas(abaMetas, ler(abaMetas), nomes);
      if (!metas) ignoradas.push(abaMetas);
    }
  } catch (error) {
    if (error instanceof ArquivoInvalidoError) throw new CenarioError(400, error.message);
    throw error;
  }
  if (dre.length === 0 && !metas) {
    throw new CenarioError(
      400,
      `O arquivo não tem nenhuma aba de cenário. As abas lidas são: ${ABAS_DRE.map((a) => a.abas[0]).join(", ")} (a DRE por unidade) e Metas ou Metas (Orçamento) (as metas dos indicadores). Abas encontradas: ${abas.join(", ")}.`,
    );
  }
  const anos = [...new Set([...dre.map((d) => d.ano), ...(metas ? [metas.ano] : [])].filter((a) => a > 0))];
  if (anos.length !== 1) throw new CenarioError(400, anos.length ? `As abas são de exercícios diferentes (${anos.join(", ")}).` : "Não achei o exercício nos rótulos dos meses.");
  return { ano: anos[0], dre, metas, ignoradas };
}

const igual = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-9);

/** Os valores novos contra os do cenário: quantos entram, mudam e saem (o que ficaria igual não conta). */
function comparar(novos: Map<string, number>, atuais: Map<string, number>) {
  let novas = 0;
  let alteradas = 0;
  for (const [k, v] of novos) {
    const a = atuais.get(k);
    if (a === undefined) novas++;
    else if (!igual(v, a)) alteradas++;
  }
  const removidas = [...atuais.keys()].filter((k) => !novos.has(k)).length;
  return { novas, alteradas, removidas, semMudanca: novas + alteradas + removidas === 0 };
}

/**
 * A prévia da importação: o que o arquivo traz, aba por aba, e, num cenário que já existe, o que muda nele. O
 * bloqueio (o exercício do arquivo diferente do do cenário) impede a importação.
 */
async function previa(lido: Awaited<ReturnType<typeof lerArquivo>>, cenarioId: string | null, usuario: Usuario) {
  const prisma = getPrismaClient();
  const existente = cenarioId ? await obterOuFalhar(cenarioId, usuario) : null;
  if (existente) exigirEditavel(existente);
  const [resultados, metasAtuais] = existente
    ? await Promise.all([
        prisma.cenarioResultado.findMany({ where: { cenarioId: existente.id }, select: { visao: true, linhaDREId: true, mes: true, valor: true } }),
        prisma.cenarioIndicador.findMany({ where: { cenarioId: existente.id }, select: { nome: true, mes: true, valor: true, origem: true } }),
      ])
    : [[], []];
  const visoesAtuais = new Set(resultados.map((r) => r.visao));
  return {
    ano: lido.ano,
    cenario: existente ? { id: existente.id, nome: existente.nome, ano: existente.ano } : null,
    bloqueio: existente && existente.ano !== lido.ano ? `O arquivo é de ${lido.ano}, e o cenário, de ${existente.ano}: importe num cenário de ${lido.ano} ou num cenário novo.` : null,
    visoes: lido.dre.map((d) => {
      const atuais = new Map(resultados.filter((r) => r.visao === d.visao).map((r) => [`${r.linhaDREId}|${r.mes}`, Number(r.valor)]));
      const novos = new Map(d.valores.map((v) => [`${v.linhaDREId}|${v.mes}`, v.valor]));
      return {
        visao: d.visao,
        nome: ABAS_DRE.find((a) => a.visao === d.visao)!.nome,
        aba: d.aba,
        meses: d.meses,
        linhas: d.linhas,
        semPar: d.semPar,
        valores: d.valores.length,
        /** NOVA: o cenário não tem a visão; SUBSTITUI: tem, e o arquivo a substitui. */
        acao: atuais.size === 0 ? ("NOVA" as const) : ("SUBSTITUI" as const),
        mudancas: comparar(novos, atuais),
      };
    }),
    /** As visões que o arquivo não traz: ficam como estão (com valores) ou vazias. */
    faltam: ABAS_DRE.filter((a) => !lido.dre.some((d) => d.visao === a.visao)).map((a) => ({ nome: a.nome, temValores: visoesAtuais.has(a.visao) })),
    metas: lido.metas
      ? (() => {
          const atuais = new Map(metasAtuais.map((m) => [`${m.nome}|${m.mes}`, Number(m.valor)]));
          const novos = new Map(lido.metas.valores.map((v) => [`${v.nome}|${v.mes}`, v.valor]));
          return {
            aba: lido.metas.aba,
            indicadores: lido.metas.indicadores,
            meses: new Set(lido.metas.valores.map((v) => v.mes)).size,
            ignorados: lido.metas.ignorados,
            acao: atuais.size === 0 ? ("NOVA" as const) : ("SUBSTITUI" as const),
            mudancas: comparar(novos, atuais),
            /** Os lançamentos manuais digitados que a importação substitui. */
            digitados: metasAtuais.filter((m) => m.origem === "DIGITADO").length,
          };
        })()
      : null,
    metasAtuais: metasAtuais.length,
    ignoradas: lido.ignoradas,
  };
}

export type PreviaCenario = Awaited<ReturnType<typeof previa>>;

/** A conta da DRE de uma premissa de unidade: a da receita (RB:linha:conta) ou a do custo (CUSTO:linha:conta). */
const contaDaPremissa = (chave: string) => (/^(RB|CUSTO):/.test(chave) ? (chave.split(":")[2] ?? null) : chave.startsWith("COMISSOES:") ? CONTAS_DAS_PREMISSAS.COMISSOES : null);
/** A aba da permissão (cenarios_analiticos_premissas.<aba>) de cada aba das premissas. */
export const ABA_DA_PERMISSAO: Record<AbaDasPremissas, string> = { "1": "matriz", "2": "filial", "3": "servicos", quadro: "quadro", centros: "centros", investimentos: "investimentos", extra: "extra", manuais: "manuais" };
const iguais = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)));
const MESES_1_A_12 = Array.from({ length: 12 }, (_, k) => k + 1);

/** O rótulo da linha dos Salários dos Aprendizes de uma mão de obra (com o nome dela, quando o grupo tem mais de uma). */
function rotuloDosAprendizes(prefixo: string, maos: number, totais: Array<{ codigo: string; descricao: string }>) {
  return `Salários dos Aprendizes${maos > 1 ? ` (${totais.find((t) => t.codigo === prefixo)?.descricao ?? prefixo})` : ""}`;
}

/**
 * As linhas da planilha das premissas de um cenário analítico (15/10/2026): as premissas das unidades (por venda), o
 * quadro de lotação e as contas de cada grupo de centros de custo, a depreciação base, o extra-operacional e os
 * indicadores manuais, com a Média de Referência (o mês 0), os doze meses gravados (em branco: null), a variação máxima
 * da conta (do Comparativo) e a justificativa.
 */
async function linhasDaPlanilha(c: { id: string } & ComVariacoes): Promise<LinhaDaPlanilha[]> {
  const prisma = getPrismaClient();
  const [est, cadastro, premissas, centros, indicadores, grupos, justificativas, calculo, linhasDoQuadroDoCenario] = await Promise.all([
    estruturaDRE(),
    linhasDoCadastro(),
    prisma.cenarioPremissa.findMany({ where: { cenarioId: c.id } }),
    prisma.cenarioCentro.findMany({ where: { cenarioId: c.id }, include: { linhaDRE: { select: { codigo: true } } } }),
    prisma.cenarioIndicador.findMany({ where: { cenarioId: c.id } }),
    gruposDoCadastro(),
    prisma.cenarioPremissaJustificativa.findMany({ where: { cenarioId: c.id } }),
    calcularCenario(c.id),
    linhasDoQuadro(prisma, c.id),
  ]);
  // Os grupos com linhas no Quadro de Lotação do cenário (09/11/2026): os colaboradores e as remunerações calculados.
  const quadro = quadroDosGrupos(linhasDoQuadroDoCenario, grupos, (g) => contasDoGrupo(est, g).map((l) => l.codigo));
  const limites = limitesDe(c);
  const acimaDe = new Map(totaisDaDRE(est).linhas.map((l) => [l.linha.codigo, l.acima]));
  const limiteDa = (conta: string | null) => (conta && acimaDe.has(conta) ? limiteDaLinha(limites, conta, acimaDe.get(conta)!) : null);
  const justificativa = new Map(justificativas.map((j) => [j.chave, j.texto]));
  const doze = (ler: (mes: number) => number | undefined) => MESES_1_A_12.map((m) => ler(m) ?? null);
  const linhas: LinhaDaPlanilha[] = [];
  const add = (l: Omit<LinhaDaPlanilha, "limite" | "justificativa">) => linhas.push({ ...l, limite: limiteDa(l.conta), justificativa: justificativa.get(l.chave) ?? null });
  const prem = new Map(premissas.map((p) => [`${p.unidade}|${p.venda}|${p.chave}|${p.mes}`, Number(p.valor)]));
  for (const u of UNIDADES_PREMISSAS) {
    for (const venda of VENDAS_DA_UNIDADE[u]) {
      for (const l of linhasDaTabela(est, cadastro, u).filter((x) => x.tipo === "PREMISSA")) {
        const ler = (mes: number) => prem.get(`${u}|${venda}|${l.chave}|${mes}`);
        const conta = contaDaPremissa(l.chave);
        add({ aba: String(u) as AbaDasPremissas, chave: `P|${u}|${venda}|${l.chave}`, descricao: [NOME_DA_VENDA[venda], l.secao, l.grupo ?? "", l.rotulo], und: l.und, conta, media: ler(0) ?? null, meses: doze(ler) });
      }
    }
  }
  const cen = new Map(centros.map((x) => [`${x.grupo}|${x.linhaDRE.codigo}|${x.mes}`, Number(x.valor)]));
  const totais = est.filter((l) => l.tipo !== "ITEM");
  for (const g of [...grupos].sort((a, b) => a.grupo.localeCompare(b.grupo, "pt-BR"))) {
    // O Quadro de Lotação (19/10/2026: Colaboradores CLT e PJ e o Total, em fórmula) e os Encargos e Benefícios (os
    // percentuais em fração; o mês em branco vale a Média de Referência, o padrão).
    for (const [venda, sufixo, rotulo] of [[VENDA_LOTACAO_CLT, "CLT", "Colaboradores CLT"], [VENDA_LOTACAO_PJ, "PJ", "Colaboradores PJ"]] as const) {
      const ler = (mes: number) => prem.get(`0|${venda}|${g.grupo}|${mes}`);
      add({ aba: "centros", grupo: g.grupo, chave: `L|${g.grupo}|${sufixo}`, descricao: [g.grupo, "Quadro de Lotação", rotulo], und: "colab.", conta: null, media: ler(0) ?? null, meses: doze(ler), calculada: quadro.has(g.grupo) });
    }
    const lot = (mes: number) => {
      const vs = VENDAS_LOTACAO.map((v) => prem.get(`0|${v}|${g.grupo}|${mes}`));
      return vs.every((v) => v === undefined) ? undefined : vs.reduce<number>((s, v) => s + (v ?? 0), 0);
    };
    add({
      aba: "centros",
      grupo: g.grupo,
      chave: `L|${g.grupo}|TOTAL`,
      descricao: [g.grupo, "Quadro de Lotação", "Total de Colaboradores"],
      und: "colab.",
      conta: null,
      media: lot(0) ?? null,
      meses: doze(lot),
      calculada: true,
      formula: (ref) => `N(${ref(`L|${g.grupo}|CLT`)})+N(${ref(`L|${g.grupo}|PJ`)})`,
    });
    // Os Salários dos Aprendizes de cada mão de obra (09/11/2026), do Quadro de Lotação do cenário: a base do FGTS Aprendiz.
    const q = quadro.get(g.grupo);
    const maosDoGrupo = maosDeObraDoGrupo(contasDoGrupo(est, g).map((l) => l.codigo), g.atribuicao);
    for (const mo of q ? maosDoGrupo : []) {
      add({
        aba: "centros",
        grupo: g.grupo,
        chave: `L|${g.grupo}|APRENDIZ|${mo.prefixo}`,
        descricao: [g.grupo, "Quadro de Lotação", rotuloDosAprendizes(mo.prefixo, maosDoGrupo.length, totais)],
        und: "R$",
        conta: null,
        media: null,
        meses: q!.maos.get(mo.prefixo)!.aprendizes,
        calculada: true,
      });
    }
    for (const i of ITENS_DOS_ENCARGOS) {
      const ler = (mes: number) => prem.get(`0|${i.venda}|${g.grupo}|${mes}`);
      add({
        aba: "centros",
        grupo: g.grupo,
        chave: `E|${g.grupo}|${i.item}`,
        descricao: [g.grupo, "Encargos e Benefícios", i.rotulo],
        und: i.und,
        conta: null,
        media: ler(0) ?? i.padrao,
        meses: doze(ler),
        percentual: i.und === "%",
      });
    }
    const maos = new Map(maosDoGrupo.map((m) => [m.encargos, m]));
    // As Remunerações CLT e PJ dos grupos com linhas no Quadro de Lotação (09/11/2026): calculadas, sem fórmula.
    const doQuadro = new Set(q ? maosDoGrupo.flatMap((m) => [m.remuneracoes, m.remuneracoesPJ]) : []);
    for (const l of contasDoGrupo(est, g)) {
      const atribuicao = totais.find((t) => t.codigo.startsWith(`${l.codigo.split(".").slice(0, 2).join(".")}.`))?.descricao ?? l.atribuicao ?? "";
      const ler = (mes: number) => cen.get(`${g.grupo}|${l.codigo}|${mes}`);
      // A conta Encargos e Benefícios é calculada (19/10/2026): em fórmula, das Remunerações CLT, das Horas Extras e dos
      // Encargos e Benefícios do grupo; o mês em branco dos percentuais vale a Média de Referência (o padrão).
      const mo = maos.get(l.codigo);
      const formula: LinhaDaPlanilha["formula"] = mo
        ? (ref) => {
            const item = (x: string) => `IF(${ref(`E|${g.grupo}|${x}`)}="",${ref(`E|${g.grupo}|${x}`, true)},${ref(`E|${g.grupo}|${x}`)})`;
            // 20/10/2026: com o INSS e o FGTS também sobre as férias e o décimo terceiro.
            const [folha, provisoes] = [`(${item("INSS")}+${item("FGTS")})`, `(${item("FERIAS")}+${item("DECIMO_TERCEIRO")})`];
            const beneficios = mo.beneficios ? `+N(${ref(`E|${g.grupo}|BENEFICIOS`)})` : "";
            // 09/11/2026: o FGTS Aprendiz sobre os salários dos aprendizes (a diferença para o FGTS CLT).
            const aprendizes = q ? `+(${item("FGTS_APRENDIZ")}-${item("FGTS")})*N(${ref(`L|${g.grupo}|APRENDIZ|${mo.prefixo}`)})*(1+${provisoes})` : "";
            return `(N(${ref(`C|${g.grupo}|${mo.remuneracoes}`)})+N(${ref(`C|${g.grupo}|${mo.horasExtras}`)}))*(${folha}+${provisoes}+${folha}*${provisoes})${aprendizes}${beneficios}`;
          }
        : undefined;
      add({ aba: "centros", grupo: g.grupo, chave: `C|${g.grupo}|${l.codigo}`, descricao: [g.grupo, atribuicao, l.descricao], und: "R$", conta: l.codigo, media: ler(0) ?? null, meses: doze(ler), calculada: !!mo || doQuadro.has(l.codigo), formula });
    }
  }
  for (const d of CONTAS_DEPRECIACAO) {
    const chave = `${d.unidade}|${d.conta}`;
    const ler = (mes: number) => prem.get(`${d.unidade}|${VENDA_BASE}|${chave}|${mes}`);
    add({ aba: "investimentos", chave: `B|${chave}`, descricao: [d.nomeUnidade, d.rotulo], und: "R$", conta: d.conta, media: ler(0) ?? null, meses: doze(ler) });
  }
  for (const u of UNIDADES_EXTRA) {
    for (const l of contasExtra(est, u.unidade)) {
      const chave = `${u.unidade}|${l.codigo}`;
      const secao = est.find((t) => t.tipo !== "ITEM" && t.grupoSigla === l.grupoSigla && t.codigo.split(".").length >= 2)?.descricao ?? l.grupoSigla;
      const ler = (mes: number) => prem.get(`${u.unidade}|${VENDA_EXTRA}|${chave}|${mes}`);
      add({ aba: "extra", chave: `X|${chave}`, descricao: [u.nome, secao, l.descricao], und: "R$", conta: l.codigo, media: ler(0) ?? null, meses: doze(ler) });
    }
  }
  const ind = new Map(indicadores.map((i) => [`${i.nome}|${i.mes}`, Number(i.valor)]));
  for (const i of calculo.indicadores.filter((x) => x.classe === "MANUAL" && !QUADROS_DE_LOTACAO.has(x.indicador.nome))) {
    const ler = (mes: number) => ind.get(`${i.indicador.nome}|${mes}`);
    add({ aba: "manuais", chave: `I|${i.indicador.nome}`, descricao: [i.indicador.grupo, i.indicador.nome], und: i.indicador.unidade, conta: null, media: ler(0) ?? null, meses: doze(ler), percentual: i.indicador.unidade === "%" });
  }
  return linhas;
}

/** Os dados de uma linha do Quadro de Lotação do cenário (09/11/2026): os cadastros e os doze meses. */
export type DadosDaLinhaDoQuadro = { unidadeNegocioId: string; vinculo: "CLT" | "PJ"; senioridadeId: string; funcaoId: string; centroCustoId: string; meses: MesDaLinha[] };
const INCLUIR_DO_QUADRO = {
  unidadeNegocio: { select: { nome: true } },
  senioridade: { select: { nome: true } },
  funcao: { select: { nome: true } },
  centroCusto: { select: { codigoRM: true, nomeRM: true } },
  meses: true,
} satisfies Prisma.CenarioLotacaoInclude;
const rotuloDoCentro = (c: { codigoRM: string | null; nomeRM: string }) => `${c.codigoRM ? `${c.codigoRM} - ` : ""}${c.nomeRM}`;

/**
 * Os cadastros que as linhas do Quadro de Lotação do cenário aceitam (09/11/2026): as unidades, as senioridades e as
 * funções ativas da Gestão de Colaboradores e os centros ativos, com código, dos grupos do cenário (os de estoque e de
 * investimento ficam de fora, como nos Centros de Custo).
 */
async function cadastrosDoQuadro() {
  const prisma = getPrismaClient();
  const [grupos, unidades, senioridades, funcoes] = await Promise.all([
    gruposDoCadastro(),
    prisma.unidadeNegocio.findMany({ where: { ativo: true }, orderBy: [{ ordem: "asc" }, { codigo: "asc" }], select: { id: true, nome: true } }),
    prisma.colaboradorSenioridade.findMany({ where: { ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
    prisma.colaboradorFuncao.findMany({ where: { ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true, senioridadeId: true } }),
  ]);
  const grupoDoCodigo = new Map(grupos.flatMap((g) => g.centros.filter((x) => x.codigo).map((x) => [x.codigo!, g] as const)));
  const centros = await prisma.centroCusto.findMany({
    where: { ativo: true, codigoRM: { in: [...grupoDoCodigo.keys()] } },
    orderBy: { codigoRM: "asc" },
    select: { id: true, codigoRM: true, nomeRM: true },
  });
  return {
    grupos,
    grupoDoCodigo,
    unidades,
    senioridades,
    funcoes,
    centros: centros.map((x) => ({ id: x.id, nome: rotuloDoCentro(x), grupo: grupoDoCodigo.get(x.codigoRM!)!.grupo })),
  };
}

/** O motivo de recusar uma linha do Quadro de Lotação; null, certa. Os cadastros da linha que já existia valem, mesmo inativos. */
function recusaDaLinha(d: DadosDaLinhaDoQuadro, cad: Awaited<ReturnType<typeof cadastrosDoQuadro>>, atual?: { senioridadeId: string; funcaoId: string; centroCustoId: string; unidadeNegocioId: string } | null) {
  const mantido = (campo: "senioridadeId" | "funcaoId" | "centroCustoId" | "unidadeNegocioId") => atual?.[campo] === d[campo];
  if (!mantido("unidadeNegocioId") && !cad.unidades.some((u) => u.id === d.unidadeNegocioId)) return "Escolha a unidade.";
  if (d.vinculo !== "CLT" && d.vinculo !== "PJ") return "O tipo é CLT ou PJ.";
  if (!mantido("senioridadeId") && !cad.senioridades.some((x) => x.id === d.senioridadeId)) return "Escolha uma senioridade ativa da Gestão de Colaboradores.";
  if (!mantido("funcaoId") && !cad.funcoes.some((x) => x.id === d.funcaoId)) return "Escolha uma função ativa da Gestão de Colaboradores.";
  if (!mantido("centroCustoId") && !cad.centros.some((x) => x.id === d.centroCustoId)) return "Escolha um centro de custo ativo, com código, de um grupo do cenário.";
  if (d.meses.length !== 12 || d.meses.some((m) => [m.colaboradores, m.salarioBruto, m.adicional].some((v) => !Number.isFinite(v) || v < 0 || v > 1e9)))
    return "Os colaboradores e os salários de cada mês são números de zero para cima.";
  return null;
}

/** Os meses de uma linha para gravar (os meses com algum valor). */
const mesesParaGravar = (linhaId: string, meses: MesDaLinha[]) =>
  meses.flatMap((m, k) =>
    m.colaboradores || m.salarioBruto || m.adicional
      ? [{ linhaId, mes: k + 1, colaboradores: new Prisma.Decimal(m.colaboradores.toFixed(4)), salarioBruto: new Prisma.Decimal(m.salarioBruto.toFixed(2)), adicional: new Prisma.Decimal(m.adicional.toFixed(2)) }]
      : [],
  );
/** O nome de uma linha do Quadro de Lotação no histórico: a função e o centro. */
const nomeDaLinha = (l: { funcao: { nome: string }; centroCusto: { codigoRM: string | null; nomeRM: string } }) => `${l.funcao.nome} · ${rotuloDoCentro(l.centroCusto)}`;

type MudancaDaPlanilha = { chave: string; mes: number; valor: number | null };
/** Os campos de um investimento importado da planilha (15/10/2026). */
type DadosDoInvestimento = Omit<InvestimentoLido, "aba" | "numero">;
/** O Nome de Referência para comparar: sem espaços nas pontas e sem diferença de maiúsculas. */
const chaveDoNome = (nome: string) => nome.trim().toLocaleLowerCase("pt-BR");

/**
 * Grava mudanças das linhas da planilha (15/10/2026: o Replicar Médias, o Apagar Valores e o Importar Valores): cada
 * (chave, mês) vira a premissa, o centro, o mensal ou o indicador dela; null apaga (o mês em branco). Apaga e recria em
 * lotes, para as dezenas de milhares de valores de uma vez.
 */
async function aplicarMudancas(tx: Prisma.TransactionClient, cenarioId: string, mudancas: MudancaDaPlanilha[], est: Array<{ codigo: string; id: string }>) {
  const idDaConta = new Map(est.map((l) => [l.codigo, l.id]));
  type Prem = { unidade: number; venda: string; chave: string; mes: number };
  type Cen = { grupo: string; linhaDREId: string; mes: number };
  type Ind = { nome: string; mes: number };
  const prem: Array<Prem & { valor: number | null }> = [];
  const cen: Array<Cen & { valor: number | null }> = [];
  const ind: Array<Ind & { valor: number | null }> = [];
  for (const m of mudancas) {
    const [tipo, ...resto] = m.chave.split("|");
    if (tipo === "P") prem.push({ unidade: Number(resto[0]), venda: resto[1], chave: resto.slice(2).join("|"), mes: m.mes, valor: m.valor });
    else if (tipo === "L") {
      // L|grupo|CLT e L|grupo|PJ (19/10/2026); o Total de Colaboradores é calculado e não se grava.
      const sufixo = resto[resto.length - 1];
      if (sufixo === "CLT" || sufixo === "PJ") prem.push({ unidade: 0, venda: sufixo === "CLT" ? VENDA_LOTACAO_CLT : VENDA_LOTACAO_PJ, chave: resto.slice(0, -1).join("|"), mes: m.mes, valor: m.valor });
    } else if (tipo === "E") {
      // Os Encargos e Benefícios (19/10/2026): E|grupo|item.
      const item = itemDosEncargos(resto[resto.length - 1]);
      if (item) prem.push({ unidade: 0, venda: item.venda, chave: resto.slice(0, -1).join("|"), mes: m.mes, valor: m.valor });
    }
    else if (tipo === "B" || tipo === "X") prem.push({ unidade: Number(resto[0]), venda: tipo === "B" ? VENDA_BASE : VENDA_EXTRA, chave: resto.join("|"), mes: m.mes, valor: m.valor });
    else if (tipo === "C") {
      const linhaDREId = idDaConta.get(resto[resto.length - 1]);
      // Nos centros, o zero também apaga (como na tela). A conta Encargos e Benefícios é calculada (19/10/2026).
      if (linhaDREId && !ehContaDeEncargos(resto[resto.length - 1])) cen.push({ grupo: resto.slice(0, -1).join("|"), linhaDREId, mes: m.mes, valor: m.valor || null });
    } else if (tipo === "I") ind.push({ nome: resto.join("|"), mes: m.mes, valor: m.valor });
  }
  const emLotes = async <T>(xs: T[], fn: (lote: T[]) => Promise<unknown>) => {
    for (let i = 0; i < xs.length; i += 200) await fn(xs.slice(i, i + 200));
  };
  await emLotes(prem, (l) => tx.cenarioPremissa.deleteMany({ where: { cenarioId, OR: l.map(({ unidade, venda, chave, mes }) => ({ unidade, venda, chave, mes })) } }));
  await emLotes(cen, (l) => tx.cenarioCentro.deleteMany({ where: { cenarioId, OR: l.map(({ grupo, linhaDREId, mes }) => ({ grupo, linhaDREId, mes })) } }));
  await emLotes(ind, (l) => tx.cenarioIndicador.deleteMany({ where: { cenarioId, OR: l.map(({ nome, mes }) => ({ nome, mes })) } }));
  await gravarEmLotes(
    prem.filter((p) => p.valor !== null).map((p) => ({ cenarioId, unidade: p.unidade, venda: p.venda, chave: p.chave, mes: p.mes, valor: new Prisma.Decimal(p.valor!.toFixed(6)) })),
    (lote) => tx.cenarioPremissa.createMany({ data: lote }),
  );
  await gravarEmLotes(
    cen.filter((x) => x.valor !== null).map((x) => ({ cenarioId, grupo: x.grupo, linhaDREId: x.linhaDREId, mes: x.mes, valor: new Prisma.Decimal(x.valor!.toFixed(4)) })),
    (lote) => tx.cenarioCentro.createMany({ data: lote }),
  );
  await gravarEmLotes(
    ind.filter((x) => x.valor !== null).map((x) => ({ cenarioId, nome: x.nome, mes: x.mes, valor: new Prisma.Decimal(x.valor!.toFixed(8)), origem: "DIGITADO" as const })),
    (lote) => tx.cenarioIndicador.createMany({ data: lote }),
  );
}

export const cenariosService = {
  async listar(usuario: Usuario = SISTEMA, tipo: TipoCenario = "SINTETICO") {
    const cenarios = (await getPrismaClient().cenario.findMany({ where: { tipo }, orderBy: [{ ano: "desc" }, { criadoEm: "desc" }] })).filter((c) => alcanca(c, usuario));
    const [doCenario, linhas, daFamilia] = await Promise.all([conteudo(cenarios.map((c) => c.id)), estrutura(), familias()]);
    const resumos = await Promise.all(cenarios.map((c) => resumoDoCenario(c.id, linhas)));
    return cenarios.map((c, k) => ({ ...c, ...doCenario(c.id), ...daFamilia(c), resultados: resumos[k], podeMudarVisualizacao: mudaVisualizacao(c, usuario) }));
  },

  async obter(id: string, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    // Nos analíticos (14/10/2026): os rateios sem regra no exercício e se as regras mudaram depois do último cálculo.
    const regras = c.tipo === "ANALITICO" ? await regrasDeRateio() : null;
    const rateios = regras ? { avisos: avisosDosRateios(regras, mesesDoAno(c.ano)), desatualizados: c.rateiosAssinatura !== assinaturaDasRegras(regras) } : null;
    return { ...c, ...(await conteudo([id]))(id), ...(await familias())(c), podeMudarVisualizacao: mudaVisualizacao(c, usuario), rateios };
  },

  /**
   * Um cenário novo: vazio, no exercício dado, ou a cópia de outro do mesmo tipo (com a DRE e as metas dele, no
   * exercício dele).
   */
  async criar(dados: { nome: string; ano: number; descricao: string | null; copiarDe: string | null; visualizacao?: VisualizacaoCenario; tipo?: TipoCenario }, usuario: Usuario) {
    const prisma = getPrismaClient();
    const tipo = dados.tipo ?? "SINTETICO";
    // Os analíticos usam as regras de rateio: sem regra vigente em algum mês do exercício, não se abrem (14/10/2026).
    if (tipo === "ANALITICO") exigirRateios(await regrasDeRateio(), dados.ano, `abrir um cenário analítico de ${dados.ano}`);
    const origem = dados.copiarDe ? await obterOuFalhar(dados.copiarDe, usuario) : null;
    if (origem && origem.tipo !== tipo) throw new CenarioError(400, `${TIPOS[tipo]} só copiam de ${TIPOS[tipo]}: ${origem.nome} é de outro tipo.`);
    const cenario = await prisma.$transaction(
      async (tx) => {
        const c = await tx.cenario.create({
          data: {
            nome: dados.nome,
            tipo,
            ano: origem?.ano ?? dados.ano,
            descricao: dados.descricao,
            visualizacao: dados.visualizacao ?? "PUBLICA",
            criadoPor: usuario.nome,
            criadoPorId: usuario.id || null,
            nomeArquivo: origem?.nomeArquivo ?? null,
            importadoEm: origem?.importadoEm ?? null,
          },
        });
        if (origem) {
          const resultados = await tx.cenarioResultado.findMany({ where: { cenarioId: origem.id } });
          await gravarEmLotes(resultados, (lote) => tx.cenarioResultado.createMany({ data: lote.map((r) => ({ ...r, cenarioId: c.id })) }));
          const indicadores = await tx.cenarioIndicador.findMany({ where: { cenarioId: origem.id } });
          await gravarEmLotes(indicadores, (lote) => tx.cenarioIndicador.createMany({ data: lote.map((r) => ({ ...r, cenarioId: c.id })) }));
          // As premissas do analítico (13/10/2026).
          const premissas = await tx.cenarioPremissa.findMany({ where: { cenarioId: origem.id } });
          await gravarEmLotes(premissas, (lote) => tx.cenarioPremissa.createMany({ data: lote.map((p) => ({ ...p, cenarioId: c.id })) }));
          const centros = await tx.cenarioCentro.findMany({ where: { cenarioId: origem.id } });
          await gravarEmLotes(centros, (lote) => tx.cenarioCentro.createMany({ data: lote.map((x) => ({ ...x, cenarioId: c.id })) }));
          const investimentos = await tx.cenarioInvestimento.findMany({ where: { cenarioId: origem.id } });
          await gravarEmLotes(investimentos, (lote) => tx.cenarioInvestimento.createMany({ data: lote.map(({ id: _id, ...x }) => ({ ...x, cenarioId: c.id })) }));
          // O Quadro de Lotação do analítico (09/11/2026).
          await copiarQuadro(tx, origem.id, c.id);
        }
        return c;
      },
      { timeout: 60_000 },
    );
    await auditar({ usuarioId: usuario.id, usuarioNome: usuario.nome, acao: "CRIACAO", entidade: "cenario", entidadeId: cenario.id, depois: cenario, metadados: origem ? { copiaDe: origem.nome } : undefined });
    return this.obter(cenario.id, usuario);
  },

  /**
   * O nome, a descrição e a visualização. A visualização só muda por quem criou o cenário ou pelo Administrador, e um
   * cenário marcado não fica particular (a marcação vale para todos: o Orçamento Empresarial dá o orçado de Resultados
   * Realizados).
   */
  async atualizar(id: string, dados: { nome: string; descricao: string | null; visualizacao?: VisualizacaoCenario }, usuario: Usuario) {
    const antes = await obterOuFalhar(id, usuario);
    exigirQuemCriou(antes, usuario);
    // Com revisões criadas, o nome é o mesmo em todas as versões e não muda (13/10/2026).
    if (dados.nome !== antes.nome && (await familias())(antes).nomeTravado) {
      throw new CenarioError(409, `O cenário ${antes.nome} tem revisões: o nome é o mesmo em todas as versões e não muda.`);
    }
    // O nome e a descrição do cenário travado (marcado ou com a versão congelada) não mudam (14/10/2026); a visualização, sim.
    if (dados.nome !== antes.nome || (dados.descricao ?? null) !== (antes.descricao ?? null)) exigirEditavel(antes);
    const visualizacao = dados.visualizacao ?? antes.visualizacao;
    if (visualizacao !== antes.visualizacao) {
      if (!mudaVisualizacao(antes, usuario)) throw new CenarioError(409, "Só quem criou o cenário ou o Administrador muda a visualização dele.");
      if (visualizacao === "PARTICULAR" && antes.marcacao) {
        throw new CenarioError(409, `O cenário está marcado como ${MARCACOES[antes.marcacao]}: um cenário marcado fica público. Tire a marcação antes de torná-lo particular.`);
      }
    }
    const depois = await getPrismaClient().cenario.update({ where: { id }, data: { nome: dados.nome, descricao: dados.descricao, visualizacao } });
    await auditar({ usuarioId: usuario.id, usuarioNome: usuario.nome, acao: "ALTERACAO", entidade: "cenario", entidadeId: id, antes, depois });
    return this.obter(id, usuario);
  },

  /** Exclui o cenário; um cenário marcado (Orçamento Empresarial, Resultados Anteriores, Resultados Vendidos) não se exclui. */
  async excluir(id: string, usuario: Usuario) {
    const antes = await obterOuFalhar(id, usuario);
    exigirQuemCriou(antes, usuario);
    if (antes.marcacao) {
      throw new CenarioError(409, `O cenário ${antes.nome} está marcado como ${MARCACOES[antes.marcacao]}: tire a marcação (ou marque outro cenário) antes de excluí-lo.`);
    }
    await getPrismaClient().cenario.delete({ where: { id } });
    await auditar({ usuarioId: usuario.id, usuarioNome: usuario.nome, acao: "EXCLUSAO", entidade: "cenario", entidadeId: id, antes });
  },

  /** Marca o cenário (ou tira a marcação); a marcação sai do outro cenário que a tinha (de qualquer exercício). */
  async marcar(id: string, marcacao: MarcacaoCenario | null, usuario: Usuario) {
    const prisma = getPrismaClient();
    const antes = await obterOuFalhar(id, usuario);
    exigirQuemCriou(antes, usuario);
    if (marcacao && antes.visualizacao === "PARTICULAR") {
      throw new CenarioError(409, `O cenário ${antes.nome} é particular: a marcação vale para todos os usuários. Torne-o público (Editar) antes de marcá-lo.`);
    }
    const anterior = marcacao ? await prisma.cenario.findFirst({ where: { marcacao, id: { not: id } }, select: { id: true, nome: true } }) : null;
    await prisma.$transaction(async (tx) => {
      if (anterior) await tx.cenario.update({ where: { id: anterior.id }, data: { marcacao: null } });
      await tx.cenario.update({ where: { id }, data: { marcacao } });
    });
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "ALTERACAO",
      entidade: "cenario",
      entidadeId: id,
      antes: { marcacao: antes.marcacao },
      depois: { marcacao },
      metadados: anterior ? { desmarcado: anterior.nome } : undefined,
    });
    return { desmarcado: anterior?.nome ?? null };
  },

  /**
   * Importação, passo 1: guarda o arquivo (pelo hash) e devolve a prévia — o que cada aba traz e o que muda no
   * cenário (`cenarioId`) ou, sem ele, no cenário novo. Nada é gravado no cenário.
   */
  async analisar(dados: { cenarioId: string | null; nomeArquivo: string; conteudo: Buffer }, usuario: Usuario = SISTEMA) {
    if (dados.cenarioId) {
      const alvo = await obterOuFalhar(dados.cenarioId, usuario);
      exigirQuemCriou(alvo, usuario);
      exigirSintetico(alvo, "a importação de arquivo é só dos cenários sintéticos");
    }
    const lido = await lerArquivo(dados.conteudo);
    const hash = createHash("sha256").update(dados.conteudo).digest("hex");
    await mkdir(diretorioUploads(), { recursive: true });
    const caminho = caminhoDoArquivo(hash);
    try {
      await access(caminho);
    } catch {
      await writeFile(caminho, dados.conteudo);
    }
    return { hash, nomeArquivo: dados.nomeArquivo, ...(await previa(lido, dados.cenarioId, usuario)) };
  },

  /**
   * Importação, passo 2 (o usuário confirmou): relê o arquivo guardado e grava. As abas da DRE substituem as mesmas
   * visões do cenário, e a aba das metas substitui as metas (inclusive as digitadas). Sem `cenarioId`, cria o
   * cenário no exercício escolhido (`ano`), que precisa ser o dos meses do arquivo.
   */
  async importar(
    dados: { hash: string; cenarioId: string | null; nome: string | null; ano: number | null; descricao: string | null; nomeArquivo: string; visualizacao?: VisualizacaoCenario },
    usuario: Usuario,
  ) {
    const prisma = getPrismaClient();
    if (dados.cenarioId) exigirSintetico(await obterOuFalhar(dados.cenarioId, usuario), "a importação de arquivo é só dos cenários sintéticos");
    let conteudo: Buffer;
    try {
      conteudo = await readFile(caminhoDoArquivo(dados.hash));
    } catch {
      throw new CenarioError(404, "O arquivo analisado não foi encontrado. Escolha o arquivo de novo.");
    }
    const lido = await lerArquivo(conteudo);
    const p = await previa(lido, dados.cenarioId, usuario);
    if (p.bloqueio) throw new CenarioError(400, p.bloqueio);
    if (!p.cenario && !dados.nome) throw new CenarioError(400, "Dê um nome ao cenário.");
    if (!p.cenario && dados.ano !== null && dados.ano !== lido.ano) throw new CenarioError(400, `O arquivo é de ${lido.ano}, e o exercício escolhido, ${dados.ano}.`);
    const { ano, dre, metas } = lido;

    const agora = new Date();
    const cenario = await prisma.$transaction(
      async (tx) => {
        const c = p.cenario
          ? await tx.cenario.update({ where: { id: p.cenario.id }, data: { nomeArquivo: dados.nomeArquivo, importadoEm: agora } })
          : await tx.cenario.create({
              data: {
                nome: dados.nome!,
                ano,
                descricao: dados.descricao,
                visualizacao: dados.visualizacao ?? "PUBLICA",
                criadoPor: usuario.nome,
                criadoPorId: usuario.id || null,
                nomeArquivo: dados.nomeArquivo,
                importadoEm: agora,
              },
            });
        for (const d of dre) {
          await tx.cenarioResultado.deleteMany({ where: { cenarioId: c.id, visao: d.visao } });
          await gravarEmLotes(d.valores, (lote) => tx.cenarioResultado.createMany({ data: lote.map((v) => ({ cenarioId: c.id, visao: d.visao, ...v })) }));
        }
        // Os totais das unidades e o Consolidado são calculados (12/10/2026), como na edição pela ferramenta.
        if (dre.length) await recalcular(tx, c.id, Array.from({ length: 12 }, (_, k) => k + 1), UNIDADES);
        if (metas) {
          await tx.cenarioIndicador.deleteMany({ where: { cenarioId: c.id } });
          await gravarEmLotes(metas.valores, (lote) => tx.cenarioIndicador.createMany({ data: lote.map((v) => ({ cenarioId: c.id, ...v, origem: "IMPORTADO" })) }));
        }
        return c;
      },
      { timeout: 120_000 },
    );
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "IMPORTACAO",
      entidade: "cenario",
      entidadeId: cenario.id,
      metadados: { arquivo: dados.nomeArquivo, hash: dados.hash, novo: !p.cenario, visoes: p.visoes.map((v) => v.aba), metas: p.metas?.aba ?? null },
    });
    await prisma.cenarioReajuste.create({
      data: { cenarioId: cenario.id, usuarioId: usuario.id || null, usuarioNome: usuario.nome, tipo: "REFERENCIA", descricao: `Arquivo ${dados.nomeArquivo}` },
    });
    return { cenario: await this.obter(cenario.id, usuario), previa: { hash: dados.hash, nomeArquivo: dados.nomeArquivo, ...p } };
  },

  /** Uma visão da DRE do cenário (0 Consolidado, 1 a 5 as unidades), mês a mês, como as abas de Resultados Empresariais. */
  async resultados(id: string, visao: 0 | 1 | 2 | 3 | 4 | 5, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    const [linhas, d, comparado] = await Promise.all([estrutura(), dreDoCenario(id, visao), comparadoDe(c)]);
    // Com um cenário comparado (13/10/2026), cada linha traz o total dele; entram também as linhas que só ele tem.
    const totais = comparado ? await totaisDoComparado(comparado.id, visao, linhas) : null;
    return {
      ano: c.ano,
      ate: 12,
      meses: Array.from({ length: 12 }, (_, k) => ({ mes: k + 1, rotulo: rotuloMes(c.ano, k + 1), apurado: d.comValor[k] })),
      comparado: comparado ? { nome: comparado.nome, ano: comparado.ano } : null,
      linhas: montar(linhas, visao, d.comValor, d.valores, d.consolidado, ACESSO_TOTAL, totais ? new Set(totais.keys()) : undefined).map((l) =>
        comTotalComparado({ ...l, podeDetalhar: false }, totais),
      ),
    };
  },

  /**
   * O Painel de Bordo do cenário (13/10/2026), como o de Resultados Empresariais: os mesmos quadros (Resultados e
   * Performance), com o cenário no lugar do realizado e o cenário comparado (o comparativo) no lugar do orçado — sem
   * comparado, essa parte fica vazia. O mês de referência é `ate` (dezembro, sem ele); o acumulado vai de janeiro a ele.
   */
  async painel(id: string, ate: number, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    const comparado = await comparadoDe(c);
    const [doCenario, doComparado] = await Promise.all([calcularCenario(id), comparado ? calcularCenario(comparado.id) : null]);
    const valores = (k: CalculoDoCenario | null) => {
      const porNome = new Map((k?.indicadores ?? []).map((i) => [i.indicador.nome, i]));
      const doMes = (mes: number): Valor => (n) => porNome.get(n)?.partes[mes - 1]?.valor ?? null;
      const acumulado: Valor = (n) => {
        const i = porNome.get(n);
        return k && i ? k.acumulado(i, ate) : null;
      };
      return { doMes, acumulado };
    };
    const cen = valores(doCenario);
    const comp = valores(doComparado);
    const periodos = { mes: [cen.doMes(ate), comp.doMes(ate)] as [Valor, Valor], acumulado: [cen.acumulado, comp.acumulado] as [Valor, Valor] };
    const quadros = await quadrosDoPainel();
    const serie = Array.from({ length: ate }, (_, k) => ({ rotulo: MESES[k], realizado: cen.doMes(k + 1), orcado: comp.doMes(k + 1) }));
    return {
      ano: c.ano,
      ate,
      rotuloMes: `${MESES[ate - 1]}/${c.ano}`,
      rotuloAcumulado: `ACUMULADO/${c.ano}`,
      mesApurado: true,
      cenarioOrcado: comparado?.nome ?? null,
      mesesSemMeta: [],
      comparado: comparado ? { nome: comparado.nome, ano: comparado.ano } : null,
      abas: [
        // Os itens do cadastro do Painel de Bordo (17/10/2026).
        { chave: "resultados", titulo: "Resultados", quadros: montarPainel(quadros.resultados, periodos, serie) },
        { chave: "performance", titulo: "Performance", quadros: montarPainel(quadros.performance, periodos, serie) },
      ],
    };
  },

  /** Os indicadores do cenário, mês a mês e acumulados, com a classe de cada um (as abas da tela). */
  async indicadores(id: string, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    const comparado = await comparadoDe(c);
    const [calculo, doComparado, medias] = await Promise.all([
      calcularCenario(id),
      comparado ? calcularCenario(comparado.id) : null,
      // A Média de Referência dos indicadores manuais (o mês 0; 15/10/2026).
      getPrismaClient().cenarioIndicador.findMany({ where: { cenarioId: id, mes: 0 }, select: { nome: true, valor: true } }),
    ]);
    const mediaDe = new Map(medias.map((m) => [m.nome, Number(m.valor)]));
    // Com um cenário comparado (13/10/2026), o acumulado dele no lugar do orçado acumulado (pelo nome do indicador).
    const comparados = new Map((doComparado?.indicadores ?? []).map((i) => [i.indicador.nome, i]));
    const acumuladoComparado = (nome: string) => {
      const i = comparados.get(nome);
      return doComparado && i ? doComparado.acumulado(i, 12) : null;
    };
    return {
      ano: c.ano,
      ate: 12,
      comparado: comparado ? { nome: comparado.nome, ano: comparado.ano } : null,
      meses: Array.from({ length: 12 }, (_, k) => ({ mes: k + 1, rotulo: rotuloMes(c.ano, k + 1), apurado: true })),
      indicadores: calculo.indicadores.map((i) => ({
        grupo: i.indicador.grupo,
        numero: i.indicador.numero,
        nome: i.indicador.nome,
        sentido: i.indicador.sentido,
        unidade: i.indicador.unidade,
        metodologia: i.indicador.metodologia,
        acumulado: i.indicador.acumulado,
        classe: i.classe,
        meses: i.partes.map((p) => p?.valor ?? null),
        total: calculo.acumulado(i, 12),
        digitados: i.digitados,
        referencia: i.classe === "MANUAL" ? (mediaDe.get(i.indicador.nome) ?? null) : null,
        // Os meses do comparado (16/10/2026), para o gráfico do indicador (o cenário × o comparado); sem comparado, vazio.
        orcado: doComparado ? Array.from({ length: 12 }, (_, k) => comparados.get(i.indicador.nome)?.partes[k]?.valor ?? null) : [],
        totalOrcado: acumuladoComparado(i.indicador.nome),
      })),
    };
  },

  /**
   * Uma visão da DRE do cenário para a edição (12/10/2026): como `resultados`, mas com todas as linhas da visão
   * (também as vazias, para editar) e os doze meses; `editaveis` são as contas que se editam (nenhuma no
   * Consolidado, que soma as unidades).
   */
  async edicao(id: string, visao: 0 | 1 | 2 | 3 | 4 | 5, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    exigirSintetico(c, "a DRE é calculada a partir das premissas e não se edita");
    const [linhas, est, d, comparado] = await Promise.all([estrutura(), estruturaDRE(), dreDoCenario(id, visao), comparadoDe(c)]);
    const totais = comparado ? await totaisDoComparado(comparado.id, visao, linhas) : null;
    const todas = visao === 0 ? linhasDoConsolidado(est) : linhasDaUnidade(est, visao);
    const meses = Array.from({ length: 12 }, () => true);
    return {
      ano: c.ano,
      ate: 12,
      meses: Array.from({ length: 12 }, (_, k) => ({ mes: k + 1, rotulo: rotuloMes(c.ano, k + 1), apurado: true })),
      comparado: comparado ? { nome: comparado.nome, ano: comparado.ano } : null,
      linhas: montar(linhas, visao, meses, d.valores, d.consolidado, ACESSO_TOTAL, todas).map((l) => comTotalComparado({ ...l, podeDetalhar: false }, totais)),
      editaveis: visao === 0 ? [] : [...contasDaUnidade(est, visao)],
    };
  },

  /**
   * Grava valores mensais de contas de uma unidade e recalcula os totais e o Consolidado (12/10/2026). `origem` diz o
   * que a tela fez — o reajuste dos marcados ou a edição de um valor, com o reajuste — para o histórico de reajustes.
   */
  async gravarValores(id: string, visao: number, alteracoes: Alteracao[], usuario: Usuario, origem?: OrigemDaGravacao) {
    const c = await obterOuFalhar(id, usuario);
    exigirSintetico(c, "a DRE é calculada a partir das premissas e não se edita");
    exigirEditavel(c);
    let r: Awaited<ReturnType<typeof gravarValores>>;
    try {
      r = await gravarValores(id, visao, alteracoes);
    } catch (error) {
      if (error instanceof ErroEdicao) throw new CenarioError(400, error.message);
      throw error;
    }
    await getPrismaClient().cenarioReajuste.create({
      data: {
        cenarioId: id,
        usuarioId: usuario.id || null,
        usuarioNome: usuario.nome,
        tipo: origem?.tipo ?? "VALOR",
        modo: origem?.modo ?? "DIGITADO",
        reajuste: origem?.reajuste ?? null,
        visao,
        replicado: !!origem?.replicado,
        contas: r.contas,
        meses: r.meses,
        valores: r.alteradas,
        somaAntes: r.somaAntes,
        somaDepois: r.somaDepois,
      },
    });
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "ALTERACAO",
      entidade: "cenario",
      entidadeId: id,
      metadados: { cenario: c.nome, visao, valores: r.alteradas, meses: r.meses, linhas: r.contas.map((x) => x.codigo).slice(0, 50), origem: origem ?? null },
    });
    return { alteradas: r.alteradas, meses: r.meses };
  },

  /**
   * A referência do cenário pelo resultado realizado (12/10/2026): a DRE das competências fechadas de um exercício
   * (o Consolidado e as cinco unidades, mês a mês) substitui a DRE do cenário; os meses sem competência fechada
   * ficam vazios. Os indicadores realizados desses meses (os de Resultados Empresariais) substituem os do cenário, como
   * a aba das metas de um arquivo (12/10/2026): os que saem da DRE o cenário recalcula; os das listas, os
   * lançamentos manuais e os GME ficam com o realizado. Com `modo` MEDIA (12/10/2026), a média do período `de`–`ate`
   * (todo de competências fechadas) vai para os doze meses do cenário, na DRE e nos indicadores.
   *
   * No cenário analítico (14/10/2026), a DRE é calculada: a referência carrega as premissas (as Médias de Referência
   * do período — todos os meses fechados, no Mês a Mês —, e os doze meses iguais a elas), os grupos de centros de
   * custo, a depreciação base e o extra-operacional (mês a mês ou a média), e os indicadores; os investimentos ficam.
   * Devolve também os avisos do que não coube nas premissas.
   */
  async referenciaRealizado(id: string, ano: number, usuario: Usuario, opcoes: { modo: "MES_A_MES" | "MEDIA"; de?: number; ate?: number } = { modo: "MES_A_MES" }) {
    const c = await obterOuFalhar(id, usuario);
    exigirQuemCriou(c, usuario);
    exigirEditavel(c);
    const analitico = c.tipo === "ANALITICO";
    // Nos sintéticos, a referência composta com uma parte só, nos doze meses (15/10/2026).
    if (!analitico) return this.referenciaComposta(id, [{ tipo: "REALIZADO", ano, ...opcoes, mesDe: 1, mesAte: 12 }], usuario);
    const prisma = getPrismaClient();
    const todas = await prisma.competencia.findMany({ where: { ano, status: "FECHADA" }, select: { id: true, mes: true }, orderBy: { mes: "asc" } });
    if (todas.length === 0) throw new CenarioError(400, `Nenhuma competência de ${ano} está fechada.`);
    // A média replicada (12/10/2026): o período escolhido, todo de competências fechadas.
    const media = opcoes.modo === "MEDIA";
    const de = opcoes.de ?? todas[0].mes;
    const ate = opcoes.ate ?? todas[todas.length - 1].mes;
    if (media) {
      if (de > ate) throw new CenarioError(400, "O mês inicial do período vem depois do final.");
      const abertas = Array.from({ length: ate - de + 1 }, (_, k) => de + k).filter((m) => !todas.some((f) => f.mes === m));
      if (abertas.length) throw new CenarioError(400, `O período tem meses sem competência fechada: ${abertas.map((m) => `${String(m).padStart(2, "0")}/${ano}`).join(", ")}.`);
    }
    const fechadas = media ? todas.filter((f) => f.mes >= de && f.mes <= ate) : todas;
    const meses = fechadas.map((f) => String(f.mes).padStart(2, "0"));
    const periodo = meses.length === 1 ? meses[0] : `${meses[0]} a ${meses[meses.length - 1]}`;
    const realizados = await indicadoresService.listar(ano, fechadas[fechadas.length - 1].mes, true);
    const doze = Array.from({ length: 12 }, (_, k) => k + 1);
    // Os indicadores realizados: mês a mês, os dos meses fechados; na média, a média simples dos meses do período com
    // valor, nos doze meses (os que saem da DRE o cenário recalcula das contas médias).
    const noPeriodo = (k: number) => fechadas.some((f) => f.mes === k + 1);
    const indicadores = realizados.indicadores.flatMap((i) => {
      if (!media) return i.meses.flatMap((v, k) => (v === null || !Number.isFinite(v) || !noPeriodo(k) ? [] : [{ nome: i.nome, mes: k + 1, valor: new Prisma.Decimal(v.toFixed(8)) }]));
      const vs = i.meses.filter((v, k): v is number => v !== null && Number.isFinite(v) && noPeriodo(k));
      if (!vs.length) return [];
      const valor = new Prisma.Decimal((vs.reduce((s, v) => s + v, 0) / vs.length).toFixed(8));
      return doze.map((mes) => ({ nome: i.nome, mes, valor }));
    });
    // Nos analíticos, a média vai só para as Médias de Referência (15/10/2026).
    const nomeArquivo = media ? `Médias do realizado de ${ano} (${periodo})` : `Resultado realizado de ${ano} (${periodo})`;
    // As decisões de realocação das movimentações fora dos padrões ficam entre as cargas (14/10/2026).
    const anteriores = lerRealocacoes(c.realocacoes);
    const ref = await referenciaDoRealizado(ano, fechadas.map((f) => f.mes), anteriores.decisoes);
    // Cada movimentação (15/10/2026): a média dos meses com movimentação vai para a Média de Referência do grupo (o mês
    // 0); os meses, só no Mês a Mês (na média do período, os meses do cenário ficam em branco).
    const movimentacoes = ref.movimentacoes.map(({ meses, ...m }) => ({ ...m, valores: media ? Array<number>(12).fill(0) : meses, media: mediaDosMeses(meses)[0] }));
    const realocacoes: Realocacoes = {
      ...anteriores,
      referencia: nomeArquivo,
      movimentacoes,
      aplicadas: Object.fromEntries(
        movimentacoes.flatMap((m) => {
          const a = ref.aplicadas.get(m.chave);
          return a ? [[m.chave, { ...a, valores: m.valores, media: m.media }]] : [];
        }),
      ),
    };
    const idDaConta = new Map((await estruturaDRE()).map((l) => [l.codigo, l.id]));
    const grupos = await gruposDoCadastro();
    // A Média de Referência (15/10/2026; o mês 0): a soma no período ÷ o número de meses. Os doze meses do cenário ficam
    // em branco (o botão Replicar Médias os preenche); no Mês a Mês, cada mês fechado vai também para o seu mês.
    const comMedia = <T extends { mes: number; valor: number }>(xs: T[], chave: (x: T) => string) => {
      const somas = new Map<string, { x: T; soma: number }>();
      for (const x of xs) somas.set(chave(x), { x, soma: (somas.get(chave(x))?.soma ?? 0) + x.valor });
      const medias = [...somas.values()].map(({ x, soma }) => ({ ...x, mes: 0, valor: soma / fechadas.length }));
      return media ? medias : [...medias, ...xs];
    };
    const decimal = (v: number) => new Prisma.Decimal(v.toFixed(4));
    // O quadro de lotação dos grupos (19/10/2026): os colaboradores de cada grupo nas listas do Quadro de Lotação (a aba
    // de mesmo nome do LISTAS REALIZADO (OPERAÇÃO), nas Listas do mês) das competências do período — a soma dos centros
    // da aba de cada grupo. A Média de Referência (o mês 0) é a soma nos meses com a lista ÷ o número deles; no Mês a
    // Mês, também cada mês fechado no seu mês. Os indicadores de quadro de lotação do realizado não entram.
    const lotacao: Array<{ cenarioId: string; unidade: number; venda: string; chave: string; mes: number; valor: Prisma.Decimal }> = [];
    {
      const { porCompetencia, semGrupo } = await lotacaoDosGrupos(fechadas.map((f) => f.id), grupos.map((g) => g.grupo));
      const comLista = fechadas.filter((f) => porCompetencia.has(f.id));
      // Os Colaboradores CLT e os PJ, cada um na sua venda (19/10/2026).
      const somas = new Map<string, number>();
      const empilhar = (venda: string, grupo: string, mes: number, v: number) => {
        if (!v) return;
        somas.set(`${venda}|${grupo}`, (somas.get(`${venda}|${grupo}`) ?? 0) + v);
        if (!media) lotacao.push({ cenarioId: id, unidade: 0, venda, chave: grupo, mes, valor: new Prisma.Decimal(v) });
      };
      for (const f of comLista)
        for (const [grupo, v] of porCompetencia.get(f.id)!) {
          empilhar(VENDA_LOTACAO_CLT, grupo, f.mes, v.clt);
          empilhar(VENDA_LOTACAO_PJ, grupo, f.mes, v.pj);
        }
      for (const [k, soma] of somas) {
        const [venda, ...grupo] = k.split("|");
        lotacao.push({ cenarioId: id, unidade: 0, venda, chave: grupo.join("|"), mes: 0, valor: decimal(soma / comLista.length) });
      }
      const semLista = fechadas.filter((f) => !porCompetencia.has(f.id)).map((f) => `${String(f.mes).padStart(2, "0")}/${ano}`);
      if (!comLista.length) ref.avisos.push("Nenhum mês do período tem a lista do Quadro de Lotação (Listas do mês): o quadro de lotação dos grupos fica em branco.");
      else if (semLista.length)
        ref.avisos.push(`Sem a lista do Quadro de Lotação em ${semLista.join(", ")}: o quadro de lotação desses meses fica em branco, e a Média de Referência é a dos outros meses.`);
      if (semGrupo.size) ref.avisos.push(`Quadro de lotação de centros de custo sem grupo no cadastro Centros de Custo (fica fora do cenário): ${[...semGrupo.keys()].join(", ")}.`);
    }
    await prisma.$transaction(
      async (tx) => {
        await tx.cenarioPremissa.deleteMany({ where: { cenarioId: id } });
        // Só as Médias de Referência (o mês 0; 15/10/2026: antes, também os doze meses iguais a elas).
        const premissas = ref.premissas.map((p) => ({ cenarioId: id, unidade: p.unidade, venda: p.venda, chave: p.chave, mes: 0, valor: new Prisma.Decimal(p.valor.toFixed(6)) }));
        const mensais = comMedia(ref.mensais, (x) => `${x.venda}|${x.chave}`).map((x) => ({ cenarioId: id, unidade: x.unidade, venda: x.venda, chave: x.chave, mes: x.mes, valor: decimal(x.valor) }));
        await gravarEmLotes([...premissas, ...mensais], (lote) => tx.cenarioPremissa.createMany({ data: lote }));
        await tx.cenarioCentro.deleteMany({ where: { cenarioId: id } });
        // A Média de Referência dos centros (o mês 0; 15/10/2026): cada grupo e conta conta só os meses em que teve
        // movimentação (14/10/2026), e as realocações aplicadas entram com a média delas (a mesma que o quadro das
        // realocações soma e tira ao mudar a decisão). No Mês a Mês, também cada mês fechado no seu mês.
        const somaDosCentros = new Map<string, { grupo: string; codigo: string; mes: number; valor: number }>();
        const naSoma = (x: { grupo: string; codigo: string; mes: number; valor: number }) => {
          const k = `${x.grupo}|${x.codigo}|${x.mes}`;
          somaDosCentros.set(k, { ...x, valor: (somaDosCentros.get(k)?.valor ?? 0) + x.valor });
        };
        mediaNosMesesComOcorrencia(ref.centrosProprios, (x) => `${x.grupo}|${x.codigo}`)
          .filter((x) => x.mes === 1)
          .forEach((x) => naSoma({ ...x, mes: 0 }));
        for (const m of movimentacoes) {
          const a = ref.aplicadas.get(m.chave);
          if (a && m.media) naSoma({ grupo: a.grupo, codigo: a.conta, mes: 0, valor: m.media });
        }
        if (!media) ref.centros.forEach(naSoma);
        const centros = [...somaDosCentros.values()].flatMap((x) => {
          const linhaDREId = idDaConta.get(x.codigo);
          return linhaDREId && Math.abs(x.valor) >= 0.00005 ? [{ cenarioId: id, grupo: x.grupo, linhaDREId, mes: x.mes, valor: decimal(x.valor) }] : [];
        });
        await gravarEmLotes(centros, (lote) => tx.cenarioCentro.createMany({ data: lote }));
        // Os Benefícios Adicionais (20/10/2026, decisão do usuário): em cada grupo e mês da referência (a Média de
        // Referência e, no Mês a Mês, os meses fechados), a diferença entre os encargos realizados e o cálculo com os
        // percentuais padrão, para a conta Encargos e Benefícios calculada bater com o realizado.
        const codigoDoId = new Map([...idDaConta].map(([codigo, idConta]) => [idConta, codigo]));
        const valorDoCentro = new Map(centros.map((x) => [`${x.grupo}|${codigoDoId.get(x.linhaDREId)}|${x.mes}`, Number(x.valor)]));
        const mesesDosCentros = [...new Set(centros.map((x) => x.mes))];
        const estrutura = await estruturaDRE();
        const beneficios = grupos.flatMap((g) => {
          const codigos = contasDoGrupo(estrutura, g).map((l) => l.codigo);
          return mesesDosCentros.flatMap((mes) => {
            const v = beneficiosDaDiferenca(codigos, g.atribuicao, (codigo) => valorDoCentro.get(`${g.grupo}|${codigo}|${mes}`) ?? 0);
            return Math.abs(v) >= 0.005 ? [{ cenarioId: id, unidade: 0, venda: itemDosEncargos("BENEFICIOS")!.venda, chave: g.grupo, mes, valor: decimal(v) }] : [];
          });
        });
        await gravarEmLotes(beneficios, (lote) => tx.cenarioPremissa.createMany({ data: lote }));
        // O quadro de lotação dos grupos (19/10/2026; antes, os indicadores divididos pela mão de obra dos grupos): as
        // listas do Quadro de Lotação dos meses do período (lotacaoDosGrupos, calculada antes da transação).
        await gravarEmLotes(lotacao, (lote) => tx.cenarioPremissa.createMany({ data: lote }));
        await tx.cenarioIndicador.deleteMany({ where: { cenarioId: id } });
        // Os indicadores: a Média de Referência (o mês 0, a média dos meses do período com valor) e, no Mês a Mês, os
        // meses (15/10/2026: antes, na média, os doze meses iguais a ela).
        const medias = realizados.indicadores.flatMap((i) => {
          const vs = i.meses.filter((v, k): v is number => v !== null && Number.isFinite(v) && noPeriodo(k));
          return vs.length ? [{ nome: i.nome, mes: 0, valor: new Prisma.Decimal((vs.reduce((s, v) => s + v, 0) / vs.length).toFixed(8)) }] : [];
        });
        const semQuadros = [...medias, ...(media ? [] : indicadores)].filter((v) => !QUADROS_DE_LOTACAO.has(v.nome));
        await gravarEmLotes(semQuadros, (lote) => tx.cenarioIndicador.createMany({ data: lote.map((v) => ({ cenarioId: id, ...v, origem: "IMPORTADO" as const })) }));
        await calcularAnalitico(tx, id);
        await tx.cenario.update({ where: { id }, data: { nomeArquivo, importadoEm: new Date(), realocacoes: realocacoes as unknown as Prisma.InputJsonValue } });
      },
      { timeout: 300_000 },
    );
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "IMPORTACAO",
      entidade: "cenario",
      entidadeId: id,
      metadados: { cenario: c.nome, referencia: media ? "media do realizado" : "realizado", ano, meses, premissas: ref.premissas.length, centros: ref.centros.length, avisos: ref.avisos },
    });
    await prisma.cenarioReajuste.create({ data: { cenarioId: id, usuarioId: usuario.id || null, usuarioNome: usuario.nome, tipo: "REFERENCIA", descricao: nomeArquivo } });
    return { ...(await this.obter(id, usuario)), avisos: ref.avisos };
  },

  /**
   * A referência dos cenários sintéticos por cenários e realizados (15/10/2026): uma ou duas partes, cada uma com a
   * origem e os meses do cenário que ela preenche (sem meses em comum). A parte do resultado realizado é como a
   * referência realizada: no Mês a Mês, as competências fechadas do exercício que caem nos meses da parte, cada uma no
   * seu mês; na Média Replicada, a média do período `de`–`ate` (todo de competências fechadas) em todos os meses da
   * parte. A parte de outro cenário (sintético ou analítico, de qualquer exercício) leva a DRE e os indicadores dele,
   * mês a mês, para os mesmos meses. A DRE e os indicadores do cenário são substituídos: os meses fora das partes ficam
   * vazios.
   */
  async referenciaComposta(id: string, partes: ParteDaReferencia[], usuario: Usuario) {
    const c = await obterOuFalhar(id, usuario);
    exigirQuemCriou(c, usuario);
    exigirEditavel(c);
    if (c.tipo !== "SINTETICO") throw new CenarioError(400, "A referência por cenários e realizados é dos cenários sintéticos.");
    if (!partes.length || partes.length > 2) throw new CenarioError(400, "Escolha uma ou duas referências.");
    const faixa = (p: ParteDaReferencia) => Array.from({ length: Math.max(0, p.mesAte - p.mesDe + 1) }, (_, k) => p.mesDe + k);
    const doisDigitos = (m: number) => String(m).padStart(2, "0");
    const rotuloFaixa = (ms: number[]) => (ms.length === 1 ? doisDigitos(ms[0]) : `${doisDigitos(ms[0])} a ${doisDigitos(ms[ms.length - 1])}`);
    partes.forEach((p, i) => {
      if (p.mesDe > p.mesAte) throw new CenarioError(400, `Na ${i + 1}ª referência, o mês inicial vem depois do final.`);
    });
    if (partes.length === 2) {
      const comuns = faixa(partes[0]).filter((m) => faixa(partes[1]).includes(m));
      if (comuns.length) throw new CenarioError(400, `As duas referências têm meses em comum (${comuns.map((m) => MESES[m - 1].charAt(0) + MESES[m - 1].slice(1).toLowerCase()).join(", ")}): escolha meses distintos.`);
    }
    const prisma = getPrismaClient();
    const dre: Array<{ visao: number; linhaDREId: string; mes: number; valor: Prisma.Decimal }> = [];
    const indicadores: Array<{ nome: string; mes: number; valor: Prisma.Decimal }> = [];
    const nomes: string[] = [];
    const preenchidos: number[] = [];
    for (const [i, p] of partes.entries()) {
      const alvo = faixa(p);
      const todos = alvo.length === 12;
      if (p.tipo === "CENARIO") {
        if (p.origemId === id) throw new CenarioError(400, "Escolha outro cenário: a referência não pode ser o próprio cenário.");
        const o = await obterOuFalhar(p.origemId, usuario);
        dre.push(...(await prisma.cenarioResultado.findMany({ where: { cenarioId: o.id, mes: { in: alvo } }, select: { visao: true, linhaDREId: true, mes: true, valor: true } })));
        indicadores.push(...(await prisma.cenarioIndicador.findMany({ where: { cenarioId: o.id, mes: { in: alvo } }, select: { nome: true, mes: true, valor: true } })));
        preenchidos.push(...alvo);
        nomes.push(`Cenário ${o.nome} ${rotuloVersao(o.versao)}${o.ano !== c.ano ? ` de ${o.ano}` : ""}${todos ? "" : ` (${rotuloFaixa(alvo)})`}`);
        continue;
      }
      const todas = await prisma.competencia.findMany({ where: { ano: p.ano, status: "FECHADA" }, select: { id: true, mes: true }, orderBy: { mes: "asc" } });
      if (todas.length === 0) throw new CenarioError(400, `Nenhuma competência de ${p.ano} está fechada.`);
      const media = p.modo === "MEDIA";
      const de = p.de ?? todas[0].mes;
      const ate = p.ate ?? todas[todas.length - 1].mes;
      if (media) {
        if (de > ate) throw new CenarioError(400, "O mês inicial do período vem depois do final.");
        const abertas = Array.from({ length: ate - de + 1 }, (_, k) => de + k).filter((m) => !todas.some((f) => f.mes === m));
        if (abertas.length) throw new CenarioError(400, `O período tem meses sem competência fechada: ${abertas.map((m) => `${doisDigitos(m)}/${p.ano}`).join(", ")}.`);
      }
      // Na média, as competências do período; no Mês a Mês, as que caem nos meses da parte.
      const fechadas = media ? todas.filter((f) => f.mes >= de && f.mes <= ate) : todas.filter((f) => alvo.includes(f.mes));
      if (!fechadas.length) throw new CenarioError(400, `Nenhuma competência de ${p.ano} está fechada nos meses da ${i + 1}ª referência (${rotuloFaixa(alvo)}).`);
      const mesDe = new Map(fechadas.map((f) => [f.id, f.mes]));
      const rs = await prisma.resultadoApurado.findMany({
        where: { competenciaId: { in: fechadas.map((f) => f.id) }, centroCustoId: null },
        select: { competenciaId: true, linhaDREId: true, valor: true, unidadeNegocio: { select: { codigo: true } } },
      });
      // A DRE: mês a mês, os valores de cada competência; na média, a soma de cada linha no período ÷ o número de meses,
      // em todos os meses da parte (os totais, recalculados das contas médias, também são as médias).
      if (media) {
        const somas = new Map<string, Prisma.Decimal>();
        for (const r of rs) {
          const k = `${r.unidadeNegocio?.codigo ?? 0}|${r.linhaDREId}`;
          somas.set(k, (somas.get(k) ?? new Prisma.Decimal(0)).plus(r.valor));
        }
        for (const [k, soma] of somas) {
          const [visao, linhaDREId] = k.split("|");
          const valor = new Prisma.Decimal(soma.div(fechadas.length).toFixed(4));
          for (const mes of alvo) dre.push({ visao: Number(visao), linhaDREId, mes, valor });
        }
      } else for (const r of rs) dre.push({ visao: r.unidadeNegocio?.codigo ?? 0, linhaDREId: r.linhaDREId, mes: mesDe.get(r.competenciaId)!, valor: r.valor });
      // Os indicadores realizados (os de Resultados Empresariais): mês a mês, os dos meses fechados; na média, a média
      // simples dos meses do período com valor, nos meses da parte (os que saem da DRE o cenário recalcula).
      const realizados = await indicadoresService.listar(p.ano, Math.max(...fechadas.map((f) => f.mes)), true);
      const noPeriodo = (k: number) => fechadas.some((f) => f.mes === k + 1);
      for (const ind of realizados.indicadores) {
        if (!media) {
          ind.meses.forEach((v, k) => {
            if (v !== null && Number.isFinite(v) && noPeriodo(k)) indicadores.push({ nome: ind.nome, mes: k + 1, valor: new Prisma.Decimal(v.toFixed(8)) });
          });
          continue;
        }
        const vs = ind.meses.filter((v, k): v is number => v !== null && Number.isFinite(v) && noPeriodo(k));
        if (!vs.length) continue;
        const valor = new Prisma.Decimal((vs.reduce((s, v) => s + v, 0) / vs.length).toFixed(8));
        for (const mes of alvo) indicadores.push({ nome: ind.nome, mes, valor });
      }
      preenchidos.push(...(media ? alvo : fechadas.map((f) => f.mes)));
      const periodo = rotuloFaixa(fechadas.map((f) => f.mes));
      nomes.push(media ? `Média do realizado de ${p.ano} (${periodo}), ${todos ? "nos 12 meses" : `em ${rotuloFaixa(alvo)}`}` : `Resultado realizado de ${p.ano} (${periodo})`);
    }
    const nomeArquivo = nomes.join(" + ");
    const meses = [...new Set(preenchidos)].sort((a, b) => a - b);
    await prisma.$transaction(
      async (tx) => {
        await tx.cenarioResultado.deleteMany({ where: { cenarioId: id } });
        await gravarEmLotes(dre, (lote) => tx.cenarioResultado.createMany({ data: lote.map((r) => ({ cenarioId: id, ...r })) }));
        await recalcular(tx, id, meses, UNIDADES);
        await tx.cenarioIndicador.deleteMany({ where: { cenarioId: id } });
        await gravarEmLotes(indicadores, (lote) => tx.cenarioIndicador.createMany({ data: lote.map((v) => ({ cenarioId: id, ...v, origem: "IMPORTADO" as const })) }));
        await tx.cenario.update({ where: { id }, data: { nomeArquivo, importadoEm: new Date() } });
      },
      { timeout: 120_000 },
    );
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "IMPORTACAO",
      entidade: "cenario",
      entidadeId: id,
      metadados: { cenario: c.nome, referencia: nomeArquivo, partes: partes.map((p) => ({ ...p })), meses, indicadores: indicadores.length },
    });
    await prisma.cenarioReajuste.create({ data: { cenarioId: id, usuarioId: usuario.id || null, usuarioNome: usuario.nome, tipo: "REFERENCIA", descricao: nomeArquivo } });
    return { ...(await this.obter(id, usuario)), avisos: [] as string[] };
  },

  /**
   * As realocações das movimentações fora dos padrões (14/10/2026): o grupo de centros de cada conta da última carga do
   * realizado (nulo: fica fora do cenário). A diferença entra nos centros do cenário (e sai do grupo de antes), e a DRE
   * se recalcula; as decisões valem nas próximas cargas.
   */
  async gravarRealocacoes(id: string, decisoes: Record<string, string | null>, usuario: Usuario) {
    const c = await obterOuFalhar(id, usuario);
    exigirQuemCriou(c, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    const r = lerRealocacoes(c.realocacoes);
    if (!r.movimentacoes.length) throw new CenarioError(400, "Não há movimentações fora dos padrões: carregue o resultado realizado na aba Referência.");
    for (const [chave, grupo] of Object.entries(decisoes)) {
      const m = r.movimentacoes.find((x) => x.chave === chave);
      if (!m) throw new CenarioError(400, "A lista das movimentações mudou: abra o modal de novo.");
      if (grupo && !m.destinos.some((d) => d.grupo === grupo)) {
        throw new CenarioError(400, `O grupo ${grupo} não tem a conta ${m.linha.descricao} (${m.linha.atribuicao}): escolha outro centro de custo.`);
      }
    }
    const { diferencas, aplicadas } = diferencasDasDecisoes(r, decisoes);
    const idDaConta = new Map((await estruturaDRE()).map((l) => [l.codigo, l.id]));
    const prisma = getPrismaClient();
    await prisma.$transaction(
      async (tx) => {
        for (const [k, v] of diferencas) {
          const [grupo, conta, mes] = k.split("|");
          const linhaDREId = idDaConta.get(conta);
          if (!linhaDREId || Math.abs(v) < 0.00005) continue;
          const chave = { cenarioId: id, grupo, linhaDREId, mes: Number(mes) };
          const atual = await tx.cenarioCentro.findUnique({ where: { cenarioId_grupo_linhaDREId_mes: chave } });
          const valor = new Prisma.Decimal(((atual ? Number(atual.valor) : 0) + v).toFixed(4));
          if (valor.isZero()) {
            if (atual) await tx.cenarioCentro.delete({ where: { cenarioId_grupo_linhaDREId_mes: chave } });
          } else await tx.cenarioCentro.upsert({ where: { cenarioId_grupo_linhaDREId_mes: chave }, create: { ...chave, valor }, update: { valor } });
        }
        await calcularAnalitico(tx, id);
        const novas: Realocacoes = { ...r, decisoes: { ...r.decisoes, ...decisoes }, aplicadas, atualizadoEm: new Date().toISOString(), atualizadoPor: usuario.nome };
        await tx.cenario.update({ where: { id }, data: { realocacoes: novas as unknown as Prisma.InputJsonValue } });
      },
      { timeout: 120_000 },
    );
    const realocadas = Object.keys(aplicadas).length;
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "ALTERACAO",
      entidade: "cenario_realocacoes",
      entidadeId: id,
      metadados: { cenario: c.nome, contas: r.movimentacoes.length, realocadas },
    });
    await prisma.cenarioReajuste.create({
      data: { cenarioId: id, usuarioId: usuario.id || null, usuarioNome: usuario.nome, tipo: "REFERENCIA", descricao: `Realocações das movimentações fora dos padrões (${realocadas} de ${r.movimentacoes.length} contas)` },
    });
    return this.obter(id, usuario);
  },

  /**
   * A referência de um cenário analítico por outro analítico (14/10/2026; os analíticos só importam de analíticos): as
   * premissas, os centros de custo, os investimentos e os indicadores da origem substituem os do cenário, e a DRE se
   * recalcula. As justificativas e o comparativo ficam.
   */
  async referenciaCenario(id: string, origemId: string, usuario: Usuario) {
    const c = await obterOuFalhar(id, usuario);
    exigirQuemCriou(c, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    if (origemId === id) throw new CenarioError(400, "Escolha outro cenário: a referência não pode ser o próprio cenário.");
    const origem = await obterOuFalhar(origemId, usuario);
    if (origem.tipo !== "ANALITICO") throw new CenarioError(400, `Os cenários analíticos só importam de cenários analíticos: ${origem.nome} é sintético.`);
    const prisma = getPrismaClient();
    const nomeArquivo = `Cenário ${origem.nome} ${rotuloVersao(origem.versao)}${origem.ano !== c.ano ? ` (${origem.ano})` : ""}`;
    await prisma.$transaction(
      async (tx) => {
        await tx.cenarioPremissa.deleteMany({ where: { cenarioId: id } });
        await tx.cenarioCentro.deleteMany({ where: { cenarioId: id } });
        await tx.cenarioInvestimento.deleteMany({ where: { cenarioId: id } });
        await tx.cenarioLotacao.deleteMany({ where: { cenarioId: id } });
        await tx.cenarioIndicador.deleteMany({ where: { cenarioId: id } });
        const premissas = await tx.cenarioPremissa.findMany({ where: { cenarioId: origem.id } });
        await gravarEmLotes(premissas, (lote) => tx.cenarioPremissa.createMany({ data: lote.map((p) => ({ ...p, cenarioId: id })) }));
        const centros = await tx.cenarioCentro.findMany({ where: { cenarioId: origem.id } });
        await gravarEmLotes(centros, (lote) => tx.cenarioCentro.createMany({ data: lote.map((x) => ({ ...x, cenarioId: id })) }));
        const investimentos = await tx.cenarioInvestimento.findMany({ where: { cenarioId: origem.id } });
        await gravarEmLotes(investimentos, (lote) => tx.cenarioInvestimento.createMany({ data: lote.map(({ id: _id, criadoEm: _c, atualizadoEm: _a, ...x }) => ({ ...x, cenarioId: id })) }));
        await copiarQuadro(tx, origem.id, id);
        const indicadores = await tx.cenarioIndicador.findMany({ where: { cenarioId: origem.id } });
        await gravarEmLotes(indicadores, (lote) => tx.cenarioIndicador.createMany({ data: lote.map((r) => ({ ...r, cenarioId: id })) }));
        await calcularAnalitico(tx, id);
        // As realocações da origem vêm junto: os centros copiados já têm o que ela realocou (14/10/2026).
        await tx.cenario.update({ where: { id }, data: { nomeArquivo, importadoEm: new Date(), realocacoes: origem.realocacoes ?? Prisma.DbNull } });
      },
      { timeout: 300_000 },
    );
    await auditar({ usuarioId: usuario.id, usuarioNome: usuario.nome, acao: "IMPORTACAO", entidade: "cenario", entidadeId: id, metadados: { cenario: c.nome, referencia: "cenario", origem: nomeArquivo } });
    await prisma.cenarioReajuste.create({ data: { cenarioId: id, usuarioId: usuario.id || null, usuarioNome: usuario.nome, tipo: "REFERENCIA", descricao: nomeArquivo } });
    return this.obter(id, usuario);
  },

  /** A correspondência tarefa × linha (14/10/2026), da referência realizada dos analíticos, com as linhas possíveis. */
  async correspondencias() {
    const prisma = getPrismaClient();
    const [itens, linhas] = await Promise.all([
      prisma.correspondenciaTarefa.findMany({
        include: { linha: { select: { codigo: true, nome: true, ativo: true, unidadeNegocio: { select: { codigo: true } } } } },
        // Qualquer filial (vazia) primeiro, como no SQLite (23/10/2026).
        orderBy: [{ tarefa: "asc" }, { filial: { sort: "asc", nulls: "first" } }],
      }),
      linhasDoCadastro(),
    ]);
    // As linhas desativadas que ainda têm tarefas (14/10/2026): o modal avisa e as mostra na lista, para trocar.
    const inativas = new Map(
      itens
        .filter((i) => !i.linha.ativo)
        .map((i) => [i.linha.codigo, { codigo: i.linha.codigo, nome: i.linha.nome, nomeUnidade: NOME_DA_UNIDADE[i.linha.unidadeNegocio?.codigo as UnidadePremissa] ?? "" }]),
    );
    return {
      itens: itens.map((i) => ({ filial: i.filial, tarefa: i.tarefa, linha: i.linha.codigo })),
      linhas: linhas.map((l) => ({ codigo: l.codigo, nome: l.nome, unidade: l.unidade, nomeUnidade: NOME_DA_UNIDADE[l.unidade] })),
      inativas: [...inativas.values()],
    };
  },

  /** Grava a correspondência inteira (14/10/2026): a lista substitui a anterior. */
  async gravarCorrespondencias(itens: Array<{ filial: number | null; tarefa: string; linha: string }>, usuario: Usuario) {
    const prisma = getPrismaClient();
    // As linhas ativas e, para não travar a gravação, as desativadas que já tinham tarefas (o modal avisa delas).
    const atuais = await prisma.correspondenciaTarefa.findMany({ select: { linhaId: true } });
    const linhas = await prisma.linha.findMany({
      where: { tipo: { in: ["PRODUTO", "OBRA"] }, OR: [{ ativo: true }, { id: { in: atuais.map((a) => a.linhaId) } }] },
      select: { id: true, codigo: true },
    });
    const idDa = new Map(linhas.map((l) => [l.codigo, l.id]));
    const vistos = new Set<string>();
    const novos = itens.map((i) => {
      const tarefa = i.tarefa.trim().replace(/\s+/g, " ").toUpperCase();
      if (!tarefa) throw new CenarioError(400, "Há uma correspondência sem a tarefa.");
      const linhaId = idDa.get(i.linha);
      if (!linhaId) throw new CenarioError(400, `A linha ${i.linha} não existe no cadastro Linhas.`);
      const k = `${i.filial ?? ""}|${tarefa}`;
      if (vistos.has(k)) throw new CenarioError(400, `A tarefa ${tarefa} aparece duas vezes ${i.filial ? `na filial ${i.filial}` : "em Qualquer Filial"}.`);
      vistos.add(k);
      return { filial: i.filial, tarefa, linhaId };
    });
    const antes = await prisma.correspondenciaTarefa.count();
    await prisma.$transaction(async (tx) => {
      await tx.correspondenciaTarefa.deleteMany({});
      for (const n of novos) await tx.correspondenciaTarefa.create({ data: n });
    });
    await auditar({ usuarioId: usuario.id, usuarioNome: usuario.nome, acao: "ALTERACAO", entidade: "correspondencia_tarefa", entidadeId: "todas", antes: { itens: antes }, depois: { itens: novos.length } });
    return this.correspondencias();
  },

  /**
   * O histórico de reajustes do cenário (12/10/2026), do mais recente ao mais antigo. Cada conta vem com o
   * departamento e a atribuição da linha dela na Estrutura da DRE atual (13/10/2026: o modal das contas).
   */
  async reajustes(id: string, usuario: Usuario = SISTEMA) {
    await obterOuFalhar(id, usuario);
    const [rs, est] = await Promise.all([getPrismaClient().cenarioReajuste.findMany({ where: { cenarioId: id }, orderBy: { criadoEm: "desc" } }), estruturaDRE()]);
    const porCodigo = new Map(est.map((l) => [l.codigo, l]));
    return rs.map((r) => ({
      ...r,
      reajuste: r.reajuste === null ? null : Number(r.reajuste),
      somaAntes: r.somaAntes === null ? null : Number(r.somaAntes),
      somaDepois: r.somaDepois === null ? null : Number(r.somaDepois),
      contas: ((r.contas ?? []) as Array<{ codigo: string; descricao: string }>).map((c) => ({
        ...c,
        departamento: porCodigo.get(c.codigo)?.grupo ?? null,
        atribuicao: porCodigo.get(c.codigo)?.atribuicao ?? null,
      })),
      meses: (r.meses ?? []) as number[],
    }));
  },

  /**
   * Congelar Versão (13/10/2026; antes, Salvar Versão): trava o cenário, como o fechamento de uma competência — a DRE,
   * os indicadores manuais e a referência não se editam mais. Para mudar, reabre-se a versão ou cria-se uma revisão.
   * (As colunas seguem com o nome antigo: versao_salva_em e versao_salva_por são o congelamento.)
   */
  async congelarVersao(id: string, usuario: Usuario) {
    const c = await obterOuFalhar(id, usuario);
    if (c.versaoSalvaEm) throw new CenarioError(409, `A ${rotuloVersao(c.versao)} do cenário ${c.nome} já está congelada.`);
    if (c.tipo === "ANALITICO") exigirRateios(await regrasDeRateio(), c.ano, `congelar a ${rotuloVersao(c.versao)} de ${c.nome}`);
    const depois = await getPrismaClient().cenario.update({ where: { id }, data: { versaoSalvaEm: new Date(), versaoSalvaPor: usuario.nome } });
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "ALTERACAO",
      entidade: "cenario",
      entidadeId: id,
      antes: { versaoSalvaEm: null },
      depois: { versaoSalvaEm: depois.versaoSalvaEm },
      metadados: { congelarVersao: rotuloVersao(c.versao) },
    });
    return this.obter(id, usuario);
  },

  /**
   * Reabrir Versão (13/10/2026): destrava a versão congelada, como a reabertura de uma competência — a DRE, os
   * indicadores manuais e a referência voltam a se editar (no cenário marcado, a marcação continua travando). As
   * revisões criadas dela não mudam. Fica no log de auditoria.
   */
  async reabrirVersao(id: string, usuario: Usuario) {
    const c = await obterOuFalhar(id, usuario);
    if (!c.versaoSalvaEm) throw new CenarioError(409, `A ${rotuloVersao(c.versao)} do cenário ${c.nome} não está congelada.`);
    if (c.tipo === "ANALITICO") exigirRateios(await regrasDeRateio(), c.ano, `reabrir a ${rotuloVersao(c.versao)} de ${c.nome}`);
    await getPrismaClient().cenario.update({ where: { id }, data: { versaoSalvaEm: null, versaoSalvaPor: null } });
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "ALTERACAO",
      entidade: "cenario",
      entidadeId: id,
      antes: { versaoSalvaEm: c.versaoSalvaEm, versaoSalvaPor: c.versaoSalvaPor },
      depois: { versaoSalvaEm: null },
      metadados: { reabrirVersao: rotuloVersao(c.versao) },
    });
    return this.obter(id, usuario);
  },

  /**
   * Criar Revisão (13/10/2026): a cópia de uma versão congelada numa versão nova da mesma família (a maior + 1: VER01,
   * VER02…), aberta para edição — um cenário novo, com a DRE, os indicadores, o comparativo e as justificativas da
   * versão de origem. A marcação não passa: remarca-se à mão.
   */
  async criarRevisao(id: string, usuario: Usuario) {
    const prisma = getPrismaClient();
    const origem = await obterOuFalhar(id, usuario);
    if (!origem.versaoSalvaEm) throw new CenarioError(409, `Congele a ${rotuloVersao(origem.versao)} (Congelar Versão) antes de criar uma revisão.`);
    if (origem.tipo === "ANALITICO") exigirRateios(await regrasDeRateio(), origem.ano, `criar uma revisão de ${origem.nome}`);
    const familia = origem.familiaId ?? origem.id;
    const ultima = await prisma.cenario.aggregate({ where: { OR: [{ id: familia }, { familiaId: familia }] }, _max: { versao: true } });
    const versao = (ultima._max.versao ?? origem.versao) + 1;
    const revisao = await prisma.$transaction(
      async (tx) => {
        const c = await tx.cenario.create({
          data: {
            nome: origem.nome,
            ano: origem.ano,
            tipo: origem.tipo,
            descricao: origem.descricao,
            visualizacao: origem.visualizacao,
            criadoPor: usuario.nome,
            criadoPorId: usuario.id || null,
            nomeArquivo: origem.nomeArquivo,
            importadoEm: origem.importadoEm,
            comparadoComId: origem.comparadoComId,
            variacoesMaximas: origem.variacoesMaximas ?? undefined,
            indicesReajuste: origem.indicesReajuste ?? undefined,
            indicesDoComparativo: origem.indicesDoComparativo ?? undefined,
            realocacoes: origem.realocacoes ?? undefined,
            versao,
            familiaId: familia,
            revisaoDeId: origem.id,
          },
        });
        const resultados = await tx.cenarioResultado.findMany({ where: { cenarioId: origem.id } });
        await gravarEmLotes(resultados, (lote) => tx.cenarioResultado.createMany({ data: lote.map((r) => ({ ...r, cenarioId: c.id })) }));
        const indicadores = await tx.cenarioIndicador.findMany({ where: { cenarioId: origem.id } });
        await gravarEmLotes(indicadores, (lote) => tx.cenarioIndicador.createMany({ data: lote.map((r) => ({ ...r, cenarioId: c.id })) }));
        const justificativas = await tx.cenarioJustificativa.findMany({ where: { cenarioId: origem.id } });
        await gravarEmLotes(justificativas, (lote) => tx.cenarioJustificativa.createMany({ data: lote.map((j) => ({ ...j, cenarioId: c.id })) }));
        const premissas = await tx.cenarioPremissa.findMany({ where: { cenarioId: origem.id } });
        await gravarEmLotes(premissas, (lote) => tx.cenarioPremissa.createMany({ data: lote.map((p) => ({ ...p, cenarioId: c.id })) }));
        const centros = await tx.cenarioCentro.findMany({ where: { cenarioId: origem.id } });
        await gravarEmLotes(centros, (lote) => tx.cenarioCentro.createMany({ data: lote.map((x) => ({ ...x, cenarioId: c.id })) }));
        const investimentos = await tx.cenarioInvestimento.findMany({ where: { cenarioId: origem.id } });
        await gravarEmLotes(investimentos, (lote) => tx.cenarioInvestimento.createMany({ data: lote.map(({ id: _id, ...x }) => ({ ...x, cenarioId: c.id })) }));
        await copiarQuadro(tx, origem.id, c.id);
        return c;
      },
      { timeout: 120_000 },
    );
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "CRIACAO",
      entidade: "cenario",
      entidadeId: revisao.id,
      depois: revisao,
      metadados: { revisaoDe: `${origem.nome} ${rotuloVersao(origem.versao)}`, versao: rotuloVersao(versao) },
    });
    return this.obter(revisao.id, usuario);
  },

  /**
   * As premissas de uma unidade de um cenário analítico (13/10/2026): as tabelas (Global e Mercantil; em Serviços, só
   * Global) com as linhas, a Média de Referência e os doze meses — as premissas (as gravadas, ou o padrão) e os
   * cálculos —, e se o cenário se edita (não marcado nem congelado).
   */
  async premissas(id: string, unidade: UnidadePremissa, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    const [est, linhas, gravadas] = await Promise.all([estruturaDRE(), linhasDoCadastro(), getPrismaClient().cenarioPremissa.findMany({ where: { cenarioId: id, unidade } })]);
    const estrutura = linhasDaTabela(est, linhas, unidade);
    return {
      ano: c.ano,
      unidade,
      nome: NOME_DA_UNIDADE[unidade],
      meses: Array.from({ length: 12 }, (_, k) => ({ mes: k + 1, rotulo: rotuloMes(c.ano, k + 1) })),
      editavel: !c.marcacao && !c.versaoSalvaEm,
      tabelas: VENDAS_DA_UNIDADE[unidade].map((venda) => {
        const daVenda = new Map(gravadas.filter((p) => p.venda === venda).map((p) => [`${p.chave}|${p.mes}`, Number(p.valor)]));
        const { valores, referencia } = calcularTabela(est, linhas, unidade, c.ano, (chave, mes) => daVenda.get(`${chave}|${mes}`));
        return {
          venda,
          titulo: NOME_DA_VENDA[venda],
          linhas: estrutura.map((l) => ({
            ...l,
            referencia: referencia.get(l.chave) ?? null,
            valores: valores.get(l.chave) ?? Array(12).fill(null),
            // Os meses com a premissa gravada (os demais valem o padrão: os dias úteis do calendário, ou zero).
            gravados: Array.from({ length: 12 }, (_, k) => daVenda.has(`${l.chave}|${k + 1}`)),
          })),
        };
      }),
    };
  },

  /**
   * Grava premissas de uma unidade (13/10/2026): o valor de cada (venda, chave, mês) — nulo volta ao padrão — e
   * recalcula a DRE do cenário. Só as premissas da tabela se gravam (os cálculos não), nos meses 1 a 12 (a Média de
   * Referência vem da referência). Vai para o histórico de reajustes, como a edição da DRE dos sintéticos.
   */
  async gravarPremissas(
    id: string,
    unidade: UnidadePremissa,
    alteracoes: Array<{ venda: Venda; chave: string; mes: number; valor: number | null }>,
    usuario: Usuario,
    origem?: OrigemDaGravacao,
  ) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    const prisma = getPrismaClient();
    const [est, linhas] = await Promise.all([estruturaDRE(), linhasDoCadastro()]);
    const daTabela = new Map(linhasDaTabela(est, linhas, unidade).filter((l) => l.tipo === "PREMISSA").map((l) => [l.chave, l]));
    const vendas = VENDAS_DA_UNIDADE[unidade];
    const fora = alteracoes.filter((a) => !daTabela.has(a.chave) || !vendas.includes(a.venda));
    if (fora.length) throw new CenarioError(400, `Não são premissas de ${NOME_DA_UNIDADE[unidade]}: ${[...new Set(fora.map((a) => a.chave))].slice(0, 3).join(", ")}.`);
    // A última alteração de cada premissa e mês vale.
    const finais = new Map(alteracoes.map((a) => [`${a.venda}|${a.chave}|${a.mes}`, a]));
    const anteriores = await prisma.cenarioPremissa.findMany({ where: { cenarioId: id, unidade, mes: { in: [...new Set([...finais.values()].map((a) => a.mes))] } } });
    const antes = new Map(anteriores.map((p) => [`${p.venda}|${p.chave}|${p.mes}`, Number(p.valor)]));
    let somaAntes = 0;
    let somaDepois = 0;
    for (const [k, a] of finais) {
      somaAntes += antes.get(k) ?? 0;
      somaDepois += a.valor ?? 0;
    }
    await prisma.$transaction(
      async (tx) => {
        for (const a of finais.values()) {
          const chave = { cenarioId: id, unidade, venda: a.venda, chave: a.chave, mes: a.mes };
          if (a.valor === null) await tx.cenarioPremissa.deleteMany({ where: chave });
          else {
            const valor = new Prisma.Decimal(a.valor.toFixed(4));
            await tx.cenarioPremissa.upsert({ where: { cenarioId_unidade_venda_chave_mes: chave }, create: { ...chave, valor }, update: { valor } });
          }
        }
        await calcularAnalitico(tx, id);
      },
      { timeout: 120_000 },
    );
    const meses = [...new Set([...finais.values()].map((a) => a.mes))].sort((x, y) => x - y);
    const contas = [...new Map([...finais.values()].map((a) => {
      const l = daTabela.get(a.chave)!;
      return [`${a.venda}|${a.chave}`, { codigo: a.chave, descricao: [NOME_DA_VENDA[a.venda], l.grupo, l.rotulo].filter(Boolean).join(" · ") }];
    })).values()];
    await prisma.cenarioReajuste.create({
      data: {
        cenarioId: id,
        usuarioId: usuario.id || null,
        usuarioNome: usuario.nome,
        tipo: origem?.tipo ?? "VALOR",
        modo: origem?.modo ?? "DIGITADO",
        reajuste: origem?.reajuste ?? null,
        visao: unidade,
        replicado: !!origem?.replicado,
        contas,
        meses,
        valores: finais.size,
        somaAntes,
        somaDepois,
        descricao: `Premissas · ${NOME_DA_UNIDADE[unidade]}`,
      },
    });
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "ALTERACAO",
      entidade: "cenario",
      entidadeId: id,
      metadados: { cenario: c.nome, premissas: NOME_DA_UNIDADE[unidade], valores: finais.size, meses, chaves: contas.map((x) => x.codigo).slice(0, 50), origem: origem ?? null },
    });
    return { alteradas: finais.size, meses };
  },

  /**
   * Os centros de custo de um cenário analítico (13/10/2026): os grupos da Controladoria (sem os de estoque e de
   * investimento), com o balde, o destino do valor e o total do exercício de cada um.
   */
  async centros(id: string, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    const [grupos, totais] = await Promise.all([gruposDoCadastro(), getPrismaClient().cenarioCentro.groupBy({ by: ["grupo"], where: { cenarioId: id, mes: { gte: 1 } }, _sum: { valor: true } })]);
    const total = new Map(totais.map((t) => [t.grupo, Number(t._sum.valor ?? 0)]));
    return {
      ano: c.ano,
      meses: Array.from({ length: 12 }, (_, k) => ({ mes: k + 1, rotulo: rotuloMes(c.ano, k + 1) })),
      editavel: !c.marcacao && !c.versaoSalvaEm,
      grupos: grupos.map((g) => ({ ...g, total: total.get(g.grupo) ?? 0 })),
    };
  },

  /**
   * A tabela Premissas de um grupo de centros no cenário (13/10/2026; 19/10/2026: uma tabela só), com os doze meses: o
   * Quadro de Lotação (Colaboradores CLT e PJ; o Total de Colaboradores a tela soma), os Encargos e Benefícios (os
   * percentuais em %, com o padrão nos meses sem valor gravado, e os Benefícios Adicionais em R$) e as contas do grupo (a
   * Encargos e Benefícios, calculada).
   */
  async centro(id: string, grupo: string, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    const g = (await gruposDoCadastro()).find((x) => x.grupo === grupo);
    if (!g) throw new CenarioError(404, "Grupo de centros de custo não encontrado.");
    const [est, gravados, premissas, linhasDoCenario] = await Promise.all([
      estruturaDRE(),
      getPrismaClient().cenarioCentro.findMany({ where: { cenarioId: id, grupo } }),
      getPrismaClient().cenarioPremissa.findMany({ where: { cenarioId: id, unidade: 0, chave: grupo, venda: { in: [...VENDAS_LOTACAO, ...VENDAS_DOS_ENCARGOS] } } }),
      linhasDoQuadro(getPrismaClient(), id),
    ]);
    // O Quadro de Lotação do cenário (09/11/2026): com linhas dos centros do grupo, os colaboradores e as remunerações são calculados.
    const q = quadroDosGrupos(linhasDoCenario, [g], (x) => contasDoGrupo(est, x).map((l) => l.codigo)).get(grupo);
    const maos = maosDeObraDoGrupo(contasDoGrupo(est, g).map((l) => l.codigo), g.atribuicao);
    const doQuadro = new Set(q ? maos.flatMap((m) => [m.remuneracoes, m.remuneracoesPJ]) : []);
    const porLinha = new Map(gravados.map((x) => [`${x.linhaDREId}|${x.mes}`, Number(x.valor)]));
    const prem = new Map(premissas.map((x) => [`${x.venda}|${x.mes}`, Number(x.valor)]));
    const totais = est.filter((l) => l.tipo !== "ITEM");
    // Os percentuais vão em % (a premissa grava a fração).
    const serie = (venda: string, padrao: number | null, escala = 1) => ({
      referencia: (prem.get(`${venda}|0`) ?? padrao) === null ? null : (prem.get(`${venda}|0`) ?? padrao)! * escala,
      valores: Array.from({ length: 12 }, (_, k) => (prem.get(`${venda}|${k + 1}`) ?? padrao ?? 0) * escala),
      gravados: Array.from({ length: 12 }, (_, k) => prem.has(`${venda}|${k + 1}`)),
    });
    return {
      grupo: g,
      // O quadro de lotação do grupo (14/10/2026; 19/10/2026: CLT e PJ) e os quadros em que ele entra.
      lotacao: { clt: serie(VENDA_LOTACAO_CLT, null), pj: serie(VENDA_LOTACAO_PJ, null), quadro: quadroDoGrupo(g).descricao, linhasDoQuadro: q?.linhas ?? 0 },
      // Os Salários dos Aprendizes de cada mão de obra (09/11/2026; só nos grupos com linhas no Quadro de Lotação).
      aprendizes: q ? maos.map((m) => ({ prefixo: m.prefixo, encargos: m.encargos, rotulo: rotuloDosAprendizes(m.prefixo, maos.length, totais), valores: q.maos.get(m.prefixo)!.aprendizes })) : [],
      encargos: ITENS_DOS_ENCARGOS.map((i) => ({ item: i.item, rotulo: i.rotulo, und: i.und, ...serie(i.venda, i.padrao, i.und === "%" ? 100 : 1) })),
      contas: contasDoGrupo(est, g).map((l) => ({
        codigo: l.codigo,
        descricao: l.descricao,
        // A atribuição (Mão de Obra Direta…), pelo total dela (CPP.MOD…).
        atribuicao: totais.find((t) => t.codigo.startsWith(`${l.codigo.split(".").slice(0, 2).join(".")}.`))?.descricao ?? l.atribuicao ?? "",
        // A Encargos e Benefícios é calculada (19/10/2026): não se digita; as Remunerações também, com o Quadro de Lotação (09/11/2026).
        calculada: ehContaDeEncargos(l.codigo) || doQuadro.has(l.codigo),
        doQuadro: doQuadro.has(l.codigo),
        referencia: porLinha.get(`${l.id}|0`) ?? null,
        valores: Array.from({ length: 12 }, (_, k) => porLinha.get(`${l.id}|${k + 1}`) ?? 0),
        gravados: Array.from({ length: 12 }, (_, k) => porLinha.has(`${l.id}|${k + 1}`)),
      })),
    };
  },

  /**
   * Grava valores da tabela Premissas de um grupo de centros (13/10/2026; 19/10/2026: também o quadro de lotação e os
   * encargos, antes à parte): o valor de cada (linha, mês) — nulo ou zero apaga — e recalcula a DRE do cenário. As linhas
   * são as contas do grupo (menos a Encargos e Benefícios, calculada), LOTACAO|CLT e LOTACAO|PJ (colaboradores) e
   * ENCARGOS|item (os percentuais em %; os Benefícios Adicionais em R$). Vai para o histórico ("Centros de Custo · grupo").
   */
  async gravarCentro(id: string, grupo: string, alteracoes: Array<{ linha: string; mes: number; valor: number | null }>, usuario: Usuario, origem?: OrigemDaGravacao) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    const prisma = getPrismaClient();
    const g = (await gruposDoCadastro()).find((x) => x.grupo === grupo);
    if (!g) throw new CenarioError(404, "Grupo de centros de custo não encontrado.");
    const est = await estruturaDRE();
    const contas = new Map(contasDoGrupo(est, g).map((l) => [l.codigo, l]));
    // As premissas da tabela: a venda, o rótulo, a escala (os percentuais chegam em %) e se aceita negativo.
    const premissa = (linha: string) => {
      const [tipo, x] = linha.split("|");
      if (tipo === "LOTACAO" && (x === "CLT" || x === "PJ")) return { venda: x === "CLT" ? VENDA_LOTACAO_CLT : VENDA_LOTACAO_PJ, rotulo: `Quadro de Lotação · Colaboradores ${x}`, escala: 1 };
      const i = tipo === "ENCARGOS" ? itemDosEncargos(x) : undefined;
      return i ? { venda: i.venda, rotulo: `Encargos e Benefícios · ${i.rotulo}`, escala: i.und === "%" ? 100 : 1 } : undefined;
    };
    const fora = [...new Set(alteracoes.filter((a) => !premissa(a.linha) && (!contas.has(a.linha) || ehContaDeEncargos(a.linha))).map((a) => a.linha))];
    if (fora.length) throw new CenarioError(400, `Não são linhas que se digitam no grupo ${grupo}: ${fora.slice(0, 3).join(", ")}.`);
    // O grupo com linhas no Quadro de Lotação do cenário (09/11/2026): os colaboradores e as remunerações vêm de lá.
    const q = quadroDosGrupos(await linhasDoQuadro(prisma, id), [g], (x) => contasDoGrupo(est, x).map((l) => l.codigo)).get(grupo);
    if (q) {
      const doQuadro = new Set(maosDeObraDoGrupo([...contas.keys()], g.atribuicao).flatMap((m) => [m.remuneracoes, m.remuneracoesPJ]));
      if (alteracoes.some((a) => a.linha.startsWith("LOTACAO|") || doQuadro.has(a.linha)))
        throw new CenarioError(400, `O grupo ${grupo} tem linhas na aba Quadro de Lotação: os colaboradores e as remunerações vêm de lá. Edite-os naquela aba.`);
    }
    // Os Benefícios Adicionais podem ser negativos (20/10/2026: a diferença da referência quando o realizado fica abaixo do cálculo).
    if (alteracoes.some((a) => premissa(a.linha) && a.linha !== "ENCARGOS|BENEFICIOS" && a.valor !== null && a.valor < 0))
      throw new CenarioError(400, "O quadro de lotação e os percentuais dos encargos não podem ser negativos.");
    const finais = new Map(alteracoes.map((a) => [`${a.linha}|${a.mes}`, a]));
    const [anteriores, premissasAntes] = await Promise.all([
      prisma.cenarioCentro.findMany({ where: { cenarioId: id, grupo } }),
      prisma.cenarioPremissa.findMany({ where: { cenarioId: id, unidade: 0, chave: grupo, venda: { in: [...VENDAS_LOTACAO, ...VENDAS_DOS_ENCARGOS] } } }),
    ]);
    const antes = new Map(anteriores.map((x) => [`${x.linhaDREId}|${x.mes}`, Number(x.valor)]));
    const premissaAntes = new Map(premissasAntes.map((x) => [`${x.venda}|${x.mes}`, Number(x.valor)]));
    let somaAntes = 0;
    let somaDepois = 0;
    for (const a of finais.values()) {
      const p = premissa(a.linha);
      somaAntes += p ? (premissaAntes.get(`${p.venda}|${a.mes}`) ?? 0) * p.escala : (antes.get(`${contas.get(a.linha)!.id}|${a.mes}`) ?? 0);
      somaDepois += a.valor ?? 0;
    }
    await prisma.$transaction(
      async (tx) => {
        for (const a of finais.values()) {
          const p = premissa(a.linha);
          if (p) {
            const chave = { cenarioId: id, unidade: 0, venda: p.venda, chave: grupo, mes: a.mes };
            // Nos percentuais, o zero vale (0%); só o nulo apaga (volta ao padrão).
            if (a.valor === null || (!a.valor && p.escala === 1)) await tx.cenarioPremissa.deleteMany({ where: chave });
            else {
              const valor = new Prisma.Decimal((a.valor / p.escala).toFixed(6));
              await tx.cenarioPremissa.upsert({ where: { cenarioId_unidade_venda_chave_mes: chave }, create: { ...chave, valor }, update: { valor } });
            }
            continue;
          }
          const chave = { cenarioId: id, grupo, linhaDREId: contas.get(a.linha)!.id, mes: a.mes };
          if (!a.valor) await tx.cenarioCentro.deleteMany({ where: chave });
          else {
            const valor = new Prisma.Decimal(a.valor.toFixed(4));
            await tx.cenarioCentro.upsert({ where: { cenarioId_grupo_linhaDREId_mes: chave }, create: { ...chave, valor }, update: { valor } });
          }
        }
        await calcularAnalitico(tx, id);
      },
      { timeout: 120_000 },
    );
    const meses = [...new Set([...finais.values()].map((a) => a.mes))].sort((x, y) => x - y);
    const alteradas = [...new Set([...finais.values()].map((a) => a.linha))].map((codigo) => ({
      codigo,
      descricao: `${grupo} · ${premissa(codigo)?.rotulo ?? contas.get(codigo)!.descricao}`,
    }));
    await prisma.cenarioReajuste.create({
      data: {
        cenarioId: id,
        usuarioId: usuario.id || null,
        usuarioNome: usuario.nome,
        tipo: origem?.tipo ?? "VALOR",
        modo: origem?.modo ?? "DIGITADO",
        reajuste: origem?.reajuste ?? null,
        replicado: !!origem?.replicado,
        contas: alteradas,
        meses,
        valores: finais.size,
        somaAntes,
        somaDepois,
        descricao: `Centros de Custo · ${grupo}`,
      },
    });
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "ALTERACAO",
      entidade: "cenario",
      entidadeId: id,
      metadados: { cenario: c.nome, grupo, valores: finais.size, meses, contas: alteradas.map((x) => x.codigo), origem: origem ?? null },
    });
    return { alteradas: finais.size, meses };
  },

  /**
   * A aba Investimentos de um cenário analítico (13/10/2026): por unidade, a Depreciação Base (digitada), a dos
   * investimentos e a total, mês a mês; e a lista dos investimentos, com a depreciação mensal e o ROI.
   */
  async investimentos(id: string, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    const prisma = getPrismaClient();
    const [base, lista] = await Promise.all([
      prisma.cenarioPremissa.findMany({ where: { cenarioId: id, venda: VENDA_BASE } }),
      prisma.cenarioInvestimento.findMany({ where: { cenarioId: id }, orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }] }),
    ]);
    const investimentos = lista.map((i) => ({
      ...i,
      valorTotal: Number(i.valorTotal),
      valorPosUso: Number(i.valorPosUso),
    }));
    const linhas = CONTAS_DEPRECIACAO.flatMap((d) => {
      const chave = `${d.unidade}|${d.conta}`;
      const gravado = new Map(base.filter((p) => p.chave === chave).map((p) => [p.mes, Number(p.valor)]));
      const valoresBase = Array.from({ length: 12 }, (_, k) => gravado.get(k + 1) ?? 0);
      const dosInvestimentos = Array<number>(12).fill(0);
      for (const i of investimentos.filter((x) => x.unidade === d.unidade && x.conta === d.conta)) depreciacaoNosMeses(i).forEach((v, k) => (dosInvestimentos[k] += v));
      const secao = d.nomeUnidade.toUpperCase();
      const linha = (k: string, rotulo: string, tipo: "PREMISSA" | "CALCULO", valores: number[], gravados: boolean[], referencia: number | null = null) => ({ chave: k, secao, grupo: null, rotulo, und: "R$", tipo, casas: 2, referencia, valores, gravados });
      return [
        // A Média de Referência da base (o mês 0; 15/10/2026).
        linha(chave, `Depreciação Base (${d.rotulo.replace(/^Depreciação d[oa] /, "")})`, "PREMISSA", valoresBase, valoresBase.map((_, k) => gravado.has(k + 1)), gravado.get(0) ?? null),
        linha(`${chave}|INVESTIMENTOS`, "Depreciação dos Investimentos", "CALCULO", dosInvestimentos, dosInvestimentos.map(() => false)),
        linha(`${chave}|TOTAL`, "Depreciação Total", "CALCULO", valoresBase.map((v, k) => v + dosInvestimentos[k]), valoresBase.map(() => false)),
      ];
    });
    return {
      ano: c.ano,
      meses: Array.from({ length: 12 }, (_, k) => ({ mes: k + 1, rotulo: rotuloMes(c.ano, k + 1) })),
      editavel: !c.marcacao && !c.versaoSalvaEm,
      contas: CONTAS_DEPRECIACAO,
      depreciacao: linhas,
      investimentos: investimentos.map((i) => ({ ...i, depreciacaoMensal: depreciacaoMensal(i) })),
    };
  },

  /** A aba Extra-Operacional de um cenário analítico (13/10/2026): as contas de Despesas e Extra e do RN, mês a mês. */
  async extraOperacional(id: string, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    const [est, gravadas] = await Promise.all([estruturaDRE(), getPrismaClient().cenarioPremissa.findMany({ where: { cenarioId: id, venda: VENDA_EXTRA } })]);
    const valor = new Map(gravadas.map((p) => [`${p.chave}|${p.mes}`, Number(p.valor)]));
    return {
      ano: c.ano,
      meses: Array.from({ length: 12 }, (_, k) => ({ mes: k + 1, rotulo: rotuloMes(c.ano, k + 1) })),
      editavel: !c.marcacao && !c.versaoSalvaEm,
      tabelas: UNIDADES_EXTRA.map((u) => ({
        unidade: u.unidade,
        nome: u.nome,
        linhas: contasExtra(est, u.unidade).map((l) => {
          const chave = `${u.unidade}|${l.codigo}`;
          const grupo = est.find((t) => t.tipo !== "ITEM" && t.grupoSigla === l.grupoSigla && t.codigo.split(".").length >= 2)?.descricao ?? l.grupoSigla;
          return {
            chave,
            secao: grupo.toUpperCase(),
            grupo: null,
            rotulo: l.descricao,
            und: "R$",
            tipo: "PREMISSA" as const,
            casas: 2,
            // A Média de Referência (o mês 0; 15/10/2026).
            referencia: valor.get(`${chave}|0`) ?? null,
            valores: Array.from({ length: 12 }, (_, k) => valor.get(`${chave}|${k + 1}`) ?? 0),
            gravados: Array.from({ length: 12 }, (_, k) => valor.has(`${chave}|${k + 1}`)),
          };
        }),
      })),
    };
  },

  /**
   * Grava valores mensais da Depreciação Base (`tipo` BASE) ou do Extra-Operacional (EXTRA) (13/10/2026): a chave de
   * cada linha é "unidade|conta"; nulo ou zero apaga. Recalcula a DRE do cenário; vai para o histórico.
   */
  async gravarMensais(id: string, tipo: "BASE" | "EXTRA", alteracoes: Array<{ linha: string; mes: number; valor: number | null }>, usuario: Usuario, origem?: OrigemDaGravacao) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    const prisma = getPrismaClient();
    const est = await estruturaDRE();
    const descricao = new Map(est.map((l) => [l.codigo, l.descricao]));
    const validas = new Set(
      tipo === "BASE" ? CONTAS_DEPRECIACAO.map((d) => `${d.unidade}|${d.conta}`) : UNIDADES_EXTRA.flatMap((u) => contasExtra(est, u.unidade).map((l) => `${u.unidade}|${l.codigo}`)),
    );
    const fora = [...new Set(alteracoes.filter((a) => !validas.has(a.linha)).map((a) => a.linha))];
    if (fora.length) throw new CenarioError(400, `Contas inválidas: ${fora.slice(0, 3).join(", ")}.`);
    const venda = tipo === "BASE" ? VENDA_BASE : VENDA_EXTRA;
    const finais = new Map(alteracoes.map((a) => [`${a.linha}|${a.mes}`, a]));
    const anteriores = await prisma.cenarioPremissa.findMany({ where: { cenarioId: id, venda } });
    const antes = new Map(anteriores.map((p) => [`${p.chave}|${p.mes}`, Number(p.valor)]));
    let somaAntes = 0;
    let somaDepois = 0;
    for (const [k, a] of finais) {
      somaAntes += antes.get(k) ?? 0;
      somaDepois += a.valor ?? 0;
    }
    await prisma.$transaction(
      async (tx) => {
        for (const a of finais.values()) {
          const chave = { cenarioId: id, unidade: Number(a.linha.split("|")[0]), venda, chave: a.linha, mes: a.mes };
          if (!a.valor) await tx.cenarioPremissa.deleteMany({ where: chave });
          else {
            const valor = new Prisma.Decimal(a.valor.toFixed(4));
            await tx.cenarioPremissa.upsert({ where: { cenarioId_unidade_venda_chave_mes: chave }, create: { ...chave, valor }, update: { valor } });
          }
        }
        await calcularAnalitico(tx, id);
      },
      { timeout: 120_000 },
    );
    const meses = [...new Set([...finais.values()].map((a) => a.mes))].sort((x, y) => x - y);
    const nomeUnidade = (u: string) => ({ 1: "Matriz", 2: "Filial", 3: "Serviços", 4: "Despesas e Extra", 5: "RN" })[Number(u)] ?? u;
    const contas = [...new Set([...finais.values()].map((a) => a.linha))].map((k) => {
      const [u, conta] = k.split("|");
      return { codigo: conta, descricao: `${nomeUnidade(u)} · ${descricao.get(conta) ?? conta}` };
    });
    await prisma.cenarioReajuste.create({
      data: {
        cenarioId: id,
        usuarioId: usuario.id || null,
        usuarioNome: usuario.nome,
        tipo: origem?.tipo ?? "VALOR",
        modo: origem?.modo ?? "DIGITADO",
        reajuste: origem?.reajuste ?? null,
        replicado: !!origem?.replicado,
        contas,
        meses,
        valores: finais.size,
        somaAntes,
        somaDepois,
        descricao: tipo === "BASE" ? "Investimentos · Depreciação Base" : "Extra-Operacional",
      },
    });
    await auditar({ usuarioId: usuario.id, usuarioNome: usuario.nome, acao: "ALTERACAO", entidade: "cenario", entidadeId: id, metadados: { cenario: c.nome, tipo, valores: finais.size, meses } });
    return { alteradas: finais.size, meses };
  },

  /**
   * Cria, altera ou exclui um investimento (13/10/2026) e recalcula a DRE do cenário. A conta é a de depreciação da
   * unidade; o início, um mês do exercício; a vida útil, em meses (a partir de 1); o valor pós uso não passa do total.
   */
  async gravarInvestimento(
    id: string,
    investimentoId: string | null,
    dados: { nomeReferencia: string; unidade: number; descricao: string; condicaoPagamento: string | null; inicio: number; valorTotal: number; valorPosUso: number; vidaUtil: number } | null,
    usuario: Usuario,
  ) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    const prisma = getPrismaClient();
    const atual = investimentoId ? await prisma.cenarioInvestimento.findFirst({ where: { id: investimentoId, cenarioId: id } }) : null;
    if (investimentoId && !atual) throw new CenarioError(404, "Investimento não encontrado.");
    if (dados) {
      if (!contaDeDepreciacao(dados.unidade)) throw new CenarioError(400, "Unidade inválida.");
      if (dados.valorPosUso > dados.valorTotal) throw new CenarioError(400, "O valor pós uso não pode passar do valor total.");
      // O Nome de Referência não se repete no cenário (15/10/2026).
      const mesmoNome = (await prisma.cenarioInvestimento.findMany({ where: { cenarioId: id }, select: { id: true, nomeReferencia: true } })).find(
        (i) => i.id !== atual?.id && chaveDoNome(i.nomeReferencia) === chaveDoNome(dados.nomeReferencia),
      );
      if (mesmoNome) throw new CenarioError(400, `Já há um investimento com o Nome de Referência “${mesmoNome.nomeReferencia}” no cenário.`);
    }
    await prisma.$transaction(
      async (tx) => {
        if (!dados) await tx.cenarioInvestimento.delete({ where: { id: investimentoId! } });
        else {
          const valores = {
            nomeReferencia: dados.nomeReferencia,
            unidade: dados.unidade,
            conta: contaDeDepreciacao(dados.unidade)!.conta,
            descricao: dados.descricao,
            condicaoPagamento: dados.condicaoPagamento,
            inicio: dados.inicio,
            valorTotal: new Prisma.Decimal(dados.valorTotal.toFixed(2)),
            valorPosUso: new Prisma.Decimal(dados.valorPosUso.toFixed(2)),
            vidaUtil: dados.vidaUtil,
          };
          if (atual) await tx.cenarioInvestimento.update({ where: { id: atual.id }, data: valores });
          else await tx.cenarioInvestimento.create({ data: { ...valores, cenarioId: id, ordem: await tx.cenarioInvestimento.count({ where: { cenarioId: id } }) } });
        }
        await calcularAnalitico(tx, id);
      },
      { timeout: 120_000 },
    );
    await prisma.cenarioReajuste.create({
      data: {
        cenarioId: id,
        usuarioId: usuario.id || null,
        usuarioNome: usuario.nome,
        tipo: "VALOR",
        modo: "DIGITADO",
        contas: [{ codigo: contaDeDepreciacao(dados?.unidade ?? atual!.unidade)!.conta, descricao: dados?.descricao ?? atual!.descricao }],
        descricao: `Investimentos · ${!dados ? "Excluído" : atual ? "Alterado" : "Novo"}: ${dados?.descricao ?? atual!.descricao}`,
      },
    });
    await auditar({ usuarioId: usuario.id, usuarioNome: usuario.nome, acao: !dados ? "EXCLUSAO" : atual ? "ALTERACAO" : "CRIACAO", entidade: "cenario_investimento", entidadeId: investimentoId ?? id, antes: atual ?? undefined, depois: dados ?? undefined, metadados: { cenario: c.nome } });
    return this.investimentos(id, usuario);
  },

  /** Exclui vários investimentos de uma vez (15/10/2026: o Excluir Selecionados da aba Investimentos), com um recálculo só. */
  async excluirInvestimentos(id: string, ids: string[], usuario: Usuario) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    const prisma = getPrismaClient();
    const lista = await prisma.cenarioInvestimento.findMany({ where: { cenarioId: id, id: { in: ids } }, orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }] });
    if (lista.length !== new Set(ids).size) throw new CenarioError(404, "Algum investimento não foi encontrado: atualize a tela.");
    await prisma.$transaction(
      async (tx) => {
        await tx.cenarioInvestimento.deleteMany({ where: { cenarioId: id, id: { in: ids } } });
        await calcularAnalitico(tx, id);
      },
      { timeout: 120_000 },
    );
    await prisma.cenarioReajuste.create({
      data: {
        cenarioId: id,
        usuarioId: usuario.id || null,
        usuarioNome: usuario.nome,
        tipo: "VALOR",
        modo: "DIGITADO",
        contas: lista.map((i) => ({ codigo: i.conta, descricao: i.descricao })),
        descricao: `Investimentos · ${lista.length === 1 ? "Excluído" : `${lista.length} excluídos`}: ${lista.map((i) => i.descricao).join(", ").slice(0, 400)}`,
      },
    });
    await auditar({ usuarioId: usuario.id, usuarioNome: usuario.nome, acao: "EXCLUSAO", entidade: "cenario_investimento", entidadeId: id, antes: lista, metadados: { cenario: c.nome, excluidos: lista.length } });
    return this.investimentos(id, usuario);
  },

  /**
   * A aba Quadro de Lotação de um cenário analítico (09/11/2026, etapa 4 da Gestão de Colaboradores; quadroDoCenario.ts): as
   * linhas, como as do Lançamento Inicial, com os colaboradores e os salários de cada mês e o grupo do centro, e as opções:
   * as unidades, as senioridades e as funções ativas e os centros dos grupos do cenário.
   */
  async quadro(id: string, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    const [linhas, cad] = await Promise.all([
      getPrismaClient().cenarioLotacao.findMany({ where: { cenarioId: id }, orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }], include: INCLUIR_DO_QUADRO }),
      cadastrosDoQuadro(),
    ]);
    return {
      ano: c.ano,
      meses: Array.from({ length: 12 }, (_, k) => ({ mes: k + 1, rotulo: rotuloMes(c.ano, k + 1) })),
      editavel: !c.marcacao && !c.versaoSalvaEm,
      linhas: linhas.map((l) => ({
        id: l.id,
        unidadeNegocioId: l.unidadeNegocioId,
        unidade: l.unidadeNegocio.nome,
        vinculo: l.vinculo,
        senioridadeId: l.senioridadeId,
        senioridade: l.senioridade.nome,
        aprendiz: ehAprendiz(l.senioridade.nome),
        funcaoId: l.funcaoId,
        funcao: l.funcao.nome,
        centroCustoId: l.centroCustoId,
        centro: rotuloDoCentro(l.centroCusto),
        // O grupo do centro (null: fora dos grupos do cenário; a linha não conta).
        grupo: cad.grupoDoCodigo.get(l.centroCusto.codigoRM ?? "")?.grupo ?? null,
        meses: mesesDaLinha(l.meses),
      })),
      opcoes: { unidades: cad.unidades, senioridades: cad.senioridades, funcoes: cad.funcoes, centros: cad.centros },
    };
  },

  /** Nova linha do Quadro de Lotação (linhaId null), a alteração dos cadastros de uma (sem `meses`, eles ficam) ou a exclusão (dados null). */
  async gravarLinhaDoQuadro(id: string, linhaId: string | null, dados: (Omit<DadosDaLinhaDoQuadro, "meses"> & { meses?: MesDaLinha[] }) | null, usuario: Usuario) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    const prisma = getPrismaClient();
    const atual = linhaId ? await prisma.cenarioLotacao.findFirst({ where: { id: linhaId, cenarioId: id }, include: INCLUIR_DO_QUADRO }) : null;
    if (linhaId && !atual) throw new CenarioError(404, "Linha do Quadro de Lotação não encontrada: atualize a tela.");
    const meses = dados?.meses ?? (atual ? mesesDaLinha(atual.meses) : Array.from({ length: 12 }, () => ({ colaboradores: 0, salarioBruto: 0, adicional: 0 })));
    if (dados) {
      const recusa = recusaDaLinha({ ...dados, meses }, await cadastrosDoQuadro(), atual);
      if (recusa) throw new CenarioError(400, recusa);
    }
    let gravada = atual;
    await prisma.$transaction(
      async (tx) => {
        if (!dados) await tx.cenarioLotacao.delete({ where: { id: linhaId! } });
        else {
          const campos = { unidadeNegocioId: dados.unidadeNegocioId, vinculo: dados.vinculo, senioridadeId: dados.senioridadeId, funcaoId: dados.funcaoId, centroCustoId: dados.centroCustoId };
          const l = atual
            ? await tx.cenarioLotacao.update({ where: { id: atual.id }, data: campos, include: INCLUIR_DO_QUADRO })
            : await tx.cenarioLotacao.create({ data: { ...campos, cenarioId: id, ordem: await tx.cenarioLotacao.count({ where: { cenarioId: id } }) }, include: INCLUIR_DO_QUADRO });
          if (dados.meses || !atual) {
            await tx.cenarioLotacaoMes.deleteMany({ where: { linhaId: l.id } });
            await tx.cenarioLotacaoMes.createMany({ data: mesesParaGravar(l.id, meses) });
          }
          gravada = l;
        }
        await calcularAnalitico(tx, id);
      },
      { timeout: 120_000 },
    );
    const nome = nomeDaLinha(gravada!);
    await prisma.cenarioReajuste.create({
      data: {
        cenarioId: id,
        usuarioId: usuario.id || null,
        usuarioNome: usuario.nome,
        tipo: "VALOR",
        modo: "DIGITADO",
        contas: [{ codigo: `QUADRO|${gravada!.id}`, descricao: nome }],
        descricao: `Quadro de Lotação · ${!dados ? "Linha excluída" : atual ? "Linha alterada" : "Linha nova"}: ${nome}`,
      },
    });
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: !dados ? "EXCLUSAO" : atual ? "ALTERACAO" : "CRIACAO",
      entidade: "cenario_lotacao",
      entidadeId: gravada!.id,
      antes: atual ? { ...atual, meses: mesesDaLinha(atual.meses) } : undefined,
      depois: dados ? { ...dados, meses } : undefined,
      metadados: { cenario: c.nome, linha: nome },
    });
    return this.quadro(id, usuario);
  },

  /** Exclui várias linhas do Quadro de Lotação de uma vez (o Excluir Selecionados), com um recálculo só. */
  async excluirLinhasDoQuadro(id: string, ids: string[], usuario: Usuario) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    const prisma = getPrismaClient();
    const lista = await prisma.cenarioLotacao.findMany({ where: { cenarioId: id, id: { in: ids } }, include: INCLUIR_DO_QUADRO });
    if (lista.length !== new Set(ids).size) throw new CenarioError(404, "Alguma linha do Quadro de Lotação não foi encontrada: atualize a tela.");
    await prisma.$transaction(
      async (tx) => {
        await tx.cenarioLotacao.deleteMany({ where: { cenarioId: id, id: { in: ids } } });
        await calcularAnalitico(tx, id);
      },
      { timeout: 120_000 },
    );
    const nomes = lista.map(nomeDaLinha);
    await prisma.cenarioReajuste.create({
      data: {
        cenarioId: id,
        usuarioId: usuario.id || null,
        usuarioNome: usuario.nome,
        tipo: "VALOR",
        modo: "DIGITADO",
        contas: lista.map((l, k) => ({ codigo: `QUADRO|${l.id}`, descricao: nomes[k] })),
        descricao: `Quadro de Lotação · ${lista.length === 1 ? "Linha excluída" : `${lista.length} linhas excluídas`}: ${nomes.join(", ").slice(0, 400)}`,
      },
    });
    await auditar({ usuarioId: usuario.id, usuarioNome: usuario.nome, acao: "EXCLUSAO", entidade: "cenario_lotacao", entidadeId: id, antes: lista.map((l) => ({ ...l, meses: mesesDaLinha(l.meses) })), metadados: { cenario: c.nome, excluidas: lista.length } });
    return this.quadro(id, usuario);
  },

  /**
   * Grava os meses das linhas do Quadro de Lotação (a edição da tabela): o valor de cada (linha, mês, campo) — os
   * Colaboradores, o Salário Bruto ou a Insalubridade / Periculosidade (de cada colaborador); nulo vale zero — e recalcula
   * a DRE do cenário. Vai para o histórico ("Quadro de Lotação").
   */
  async gravarMesesDoQuadro(
    id: string,
    alteracoes: Array<{ linha: string; mes: number; campo: "colaboradores" | "salarioBruto" | "adicional"; valor: number | null }>,
    usuario: Usuario,
    origem?: OrigemDaGravacao,
  ) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    const prisma = getPrismaClient();
    const ids = [...new Set(alteracoes.map((a) => a.linha))];
    const linhas = await prisma.cenarioLotacao.findMany({ where: { cenarioId: id, id: { in: ids } }, include: INCLUIR_DO_QUADRO });
    if (linhas.length !== ids.length) throw new CenarioError(404, "Alguma linha do Quadro de Lotação não foi encontrada: atualize a tela.");
    if (alteracoes.some((a) => a.valor !== null && (!Number.isFinite(a.valor) || a.valor < 0 || a.valor > 1e9)))
      throw new CenarioError(400, "Os colaboradores e os salários não podem ser negativos.");
    const meses = new Map(linhas.map((l) => [l.id, mesesDaLinha(l.meses)]));
    let somaAntes = 0;
    let somaDepois = 0;
    const finais = new Map(alteracoes.map((a) => [`${a.linha}|${a.mes}|${a.campo}`, a]));
    for (const a of finais.values()) {
      const m = meses.get(a.linha)![a.mes - 1];
      somaAntes += m[a.campo];
      m[a.campo] = a.valor ?? 0;
      somaDepois += m[a.campo];
    }
    const tocados = [...new Set([...finais.values()].map((a) => `${a.linha}|${a.mes}`))];
    await prisma.$transaction(
      async (tx) => {
        for (const k of tocados) {
          const [linhaId, mes] = [k.split("|")[0], Number(k.split("|")[1])];
          await tx.cenarioLotacaoMes.deleteMany({ where: { linhaId, mes } });
          const novo = mesesParaGravar(linhaId, meses.get(linhaId)!).find((x) => x.mes === mes);
          if (novo) await tx.cenarioLotacaoMes.create({ data: novo });
        }
        await calcularAnalitico(tx, id);
      },
      { timeout: 120_000 },
    );
    const mesesTocados = [...new Set([...finais.values()].map((a) => a.mes))].sort((x, y) => x - y);
    await prisma.cenarioReajuste.create({
      data: {
        cenarioId: id,
        usuarioId: usuario.id || null,
        usuarioNome: usuario.nome,
        tipo: origem?.tipo ?? "VALOR",
        modo: origem?.modo ?? "DIGITADO",
        reajuste: origem?.reajuste ?? null,
        replicado: !!origem?.replicado,
        contas: linhas.map((l) => ({ codigo: `QUADRO|${l.id}`, descricao: nomeDaLinha(l) })),
        meses: mesesTocados,
        valores: finais.size,
        somaAntes,
        somaDepois,
        descricao: "Quadro de Lotação",
      },
    });
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "ALTERACAO",
      entidade: "cenario_lotacao",
      entidadeId: id,
      metadados: { cenario: c.nome, valores: finais.size, meses: mesesTocados, linhas: linhas.map(nomeDaLinha).slice(0, 50), origem: origem ?? null },
    });
    return this.quadro(id, usuario);
  },

  /**
   * Os rateios de um cenário analítico (13/10/2026): por chave e destino, a base de cada mês nas premissas (o volume) e
   * o percentual (o destino sobre a chave; zero sem base no mês).
   */
  async rateios(id: string, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    const prisma = getPrismaClient();
    const [est, linhas, gravadas, grupos, valores] = await Promise.all([
      estruturaDRE(),
      linhasDoCadastro(),
      prisma.cenarioPremissa.findMany({ where: { cenarioId: id } }),
      gruposDoCadastro(),
      // Só os meses: o mês 0 é a Média de Referência (15/10/2026).
      prisma.cenarioCentro.findMany({ where: { cenarioId: id, mes: { gte: 1 } }, include: { linhaDRE: { select: { codigo: true } } } }),
    ]);
    const { bases } = calcularPremissas(est, linhas, c.ano, gravadas);
    // Os percentuais pelas regras de rateio do mês (14/10/2026; antes, só as bases das premissas).
    const percentuais = percentuaisPelasRegras(await regrasDeRateio(), c.ano, bases);
    const nomes = new Map(RATEIOS.map((r) => [r.chave, r.rotulo.split(":")[0]]));
    const NOME_DESTINO: Record<string, string> = { MATRIZ: "Matriz", FILIAL: "Filial", MONTAGEM: "Montagem", COMPLEMENTAR: "Complementar" };
    // Os destinos que só os percentuais fixos usam (a Produção em Serviços…) entram nas linhas, sem base.
    const extras = [...new Set(percentuais.flatMap((p) => [...p].filter(([, v]) => v).map(([k]) => k)))]
      .filter((k) => !RATEIOS.some((r) => `${r.chave}|${r.destino}` === k))
      .map((k) => {
        const [chave, destino] = k.split("|");
        return { chave, destino, rotulo: `${nomes.get(chave) ?? chave}: ${NOME_DESTINO[destino] ?? destino}`, base: "fixo" };
      });
    return {
      ano: c.ano,
      meses: Array.from({ length: 12 }, (_, k) => ({ mes: k + 1, rotulo: rotuloMes(c.ano, k + 1) })),
      // Os valores dos grupos que ficam fora de todas as unidades: a chave sem base nas premissas no mês.
      semBase: rateiosSemBase(
        grupos,
        valores.map((x) => ({ grupo: x.grupo, codigo: x.linhaDRE.codigo, mes: x.mes, valor: Number(x.valor) })),
        percentuais,
      ).map((x) => ({ ...x, nome: nomes.get(x.chave) ?? x.chave, rotuloMes: rotuloMes(c.ano, x.mes) })),
      rateios: [...RATEIOS, ...extras].map((r) => ({
        ...r,
        bases: bases.get(`${r.chave}|${r.destino}`) ?? Array<number>(12).fill(0),
        percentuais: percentuais.map((p) => p.get(`${r.chave}|${r.destino}`) ?? 0),
      })),
    };
  },

  /**
   * Replicar Médias / Apagar Valores (15/10/2026), em todas as abas das premissas: replicar leva a Média de Referência de
   * cada linha aos doze meses (as linhas sem média ficam como estão); apagar deixa os meses em branco. Recalcula a DRE; vai para o histórico (tela Reajustes).
   */
  async replicarMedias(id: string, acao: "replicar" | "apagar", usuario: Usuario) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    // As linhas calculadas (o Total de Colaboradores e a conta Encargos e Benefícios, 19/10/2026) não se replicam nem apagam.
    const linhas = (await linhasDaPlanilha(c)).filter((l) => !l.calculada);
    const mudancas: MudancaDaPlanilha[] = linhas.flatMap((l) =>
      acao === "replicar"
        ? l.media === null
          ? []
          : MESES_1_A_12.filter((m) => !iguais(l.meses[m - 1], l.media)).map((mes) => ({ chave: l.chave, mes, valor: l.media }))
        : MESES_1_A_12.filter((m) => l.meses[m - 1] !== null).map((mes) => ({ chave: l.chave, mes, valor: null })),
    );
    const prisma = getPrismaClient();
    const est = await estruturaDRE();
    await prisma.$transaction(
      async (tx) => {
        await aplicarMudancas(tx, id, mudancas, est);
        await calcularAnalitico(tx, id);
      },
      { timeout: 300_000 },
    );
    const nLinhas = new Set(mudancas.map((m) => m.chave)).size;
    const descricao =
      acao === "replicar"
        ? `Médias de Referência replicadas nos doze meses (${nLinhas} ${nLinhas === 1 ? "linha" : "linhas"}, em todas as abas das premissas)`
        : `Valores mensais apagados (${nLinhas} ${nLinhas === 1 ? "linha" : "linhas"}, em todas as abas das premissas)`;
    await prisma.cenarioReajuste.create({
      data: { cenarioId: id, usuarioId: usuario.id || null, usuarioNome: usuario.nome, tipo: "MEDIAS", descricao, valores: mudancas.length, meses: MESES_1_A_12 },
    });
    await auditar({ usuarioId: usuario.id, usuarioNome: usuario.nome, acao: "ALTERACAO", entidade: "cenario", entidadeId: id, metadados: { cenario: c.nome, premissas: acao, linhas: nLinhas, valores: mudancas.length } });
    return { linhas: nLinhas, valores: mudancas.length };
  },

  /**
   * O Exportar Premissas (15/10/2026), só em Excel, com o que é dos `departamentos` marcados (planilhaPremissas:
   * `departamentosDaLinha`): `todas` (uma aba por aba da tela, os centros de custo numa só), `centros_abas` (um centro
   * por aba, com o Consolidado na frente) ou `centros_arquivos` (um arquivo por centro e um com as demais abas, num ZIP).
   * A aba Investimentos traz a lista dos investimentos das unidades dos departamentos. `abas`: as que o perfil lê.
   */
  async exportarPremissas(id: string, escopo: "todas" | "centros_abas" | "centros_arquivos", departamentos: Departamento[], abas: AbaDasPremissas[], usuario: Usuario) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    if (!departamentos.length) throw new CenarioError(400, "Marque ao menos um departamento.");
    const cadastro = await gruposDoCadastro();
    const grupoDRE = new Map(cadastro.map((g) => [g.grupo, g.grupoDRE]));
    const dos = (ds: Departamento[]) => ds.some((d) => departamentos.includes(d));
    const linhas = (await linhasDaPlanilha(c)).filter((l) => abas.includes(l.aba) && dos(departamentosDaLinha(l, grupoDRE)));
    const investimentos = abas.includes("investimentos")
      ? (await getPrismaClient().cenarioInvestimento.findMany({ where: { cenarioId: id }, orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }] }))
          .filter((i) => dos(departamentosDaUnidade(i.unidade)))
          .map((i) => ({ ...i, valorTotal: Number(i.valorTotal), valorPosUso: Number(i.valorPosUso) }))
      : null;
    // O Quadro de Lotação (09/11/2026): as linhas dos centros dos departamentos escolhidos (a de um centro fora dos grupos vai sempre).
    const quadroDaPlanilha = abas.includes("quadro")
      ? await (async () => {
          const cad = await cadastrosDoQuadro();
          const ls = await getPrismaClient().cenarioLotacao.findMany({ where: { cenarioId: id }, orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }], include: INCLUIR_DO_QUADRO });
          return {
            listas: { unidades: cad.unidades.map((u) => u.nome), senioridades: cad.senioridades.map((x) => x.nome) },
            linhas: ls
              .filter((l) => {
                const d = departamentoDoGrupoDRE(cad.grupoDoCodigo.get(l.centroCusto.codigoRM ?? "")?.grupoDRE);
                return !d || departamentos.includes(d);
              })
              .map((l) => ({ id: l.id, unidade: l.unidadeNegocio.nome, tipo: l.vinculo, senioridade: l.senioridade.nome, funcao: l.funcao.nome, centro: rotuloDoCentro(l.centroCusto), meses: mesesDaLinha(l.meses) })),
          };
        })()
      : null;
    if (!linhas.length && !investimentos && !quadroDaPlanilha) throw new CenarioError(400, "Nada a exportar: o seu perfil não lê as abas desses departamentos.");
    const meses = MESES_1_A_12.map((m) => rotuloMes(c.ano, m));
    const nomeDoCenario = `${/^cen[aá]rio/i.test(c.nome) ? "" : "Cenário "}${c.nome} ${rotuloVersao(c.versao)} (${c.ano})`;
    const geracao = `${nomeDoCenario} · gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })} por ${usuario.nome}`;
    const daAba = (a: AbaDasPremissas) => linhas.filter((l) => l.aba === a);
    const grupos = [...new Set(daAba("centros").map((l) => l.grupo!))];
    const departamento = new Map(cadastro.map((g) => [g.grupo, nomeDoDepartamento(g.departamento)]));
    const nomesDosDepartamentos = DEPARTAMENTOS.filter((d) => departamentos.includes(d.chave)).map((d) => d.nome);
    const deQuais = departamentos.length === DEPARTAMENTOS.length ? "todos os departamentos" : nomesDosDepartamentos.join(", ");
    const sufixo = `Premissas - ${c.nome} ${rotuloVersao(c.versao)} ${c.ano}`;
    // As abas que não são de centros, na ordem da tela, com a lista dos investimentos depois da Depreciação Base.
    const demais = () =>
      ABAS_DAS_PREMISSAS.filter((a) => a !== "centros").flatMap((a) => [
        ...(daAba(a).length ? [abaDaPlanilha(NOME_DA_ABA[a], a, daAba(a), meses, geracao)] : []),
        ...(a === "quadro" && quadroDaPlanilha ? [abaDoQuadroDeLotacao(quadroDaPlanilha.linhas, meses, geracao, quadroDaPlanilha.listas)] : []),
        ...(a === "investimentos" && investimentos ? [abaDeInvestimentos(investimentos, geracao)] : []),
      ]);
    const visoes = [...nomesDosDepartamentos];
    if (escopo === "centros_arquivos") {
      const arquivos = grupos.map((g) => ({
        nome: limparNome(`${departamento.get(g) ?? nomeDoDepartamento(null)} - ${g} - ${sufixo}.xlsx`),
        conteudo: gerarXlsx([abaDaPlanilha(g, "centros", daAba("centros").filter((l) => l.grupo === g), meses, geracao)], `${sufixo} - ${g}`),
      }));
      const outras = demais();
      if (outras.length) arquivos.push({ nome: limparNome(`${sufixo} - demais abas (${deQuais}).xlsx`), conteudo: gerarXlsx(outras, `${sufixo} - demais abas`) });
      return { nomeArquivo: limparNome(`${sufixo} - ${deQuais} (um arquivo por centro).zip`), tipo: TIPO_ZIP, conteudo: zipDeArquivos(arquivos), visoes };
    }
    const umPorAba = escopo === "centros_abas" && grupos.length > 0;
    const doCentro = new Map<AbaEscrita, LinhaDaPlanilha[]>();
    const centros = !daAba("centros").length
      ? []
      : umPorAba
        ? grupos.map((g) => {
            const ls = daAba("centros").filter((l) => l.grupo === g);
            const p = abaDaPlanilha(g, "centros", ls, meses, geracao);
            doCentro.set(p, ls);
            return p;
          })
        : [abaDaPlanilha(NOME_DA_ABA.centros, "centros", daAba("centros"), meses, geracao)];
    // A ordem da tela: as unidades, os centros e as demais.
    const outras = demais();
    // As unidades e o Quadro de Lotação (09/11/2026) vêm antes dos centros, como na tela.
    const unidades = outras.filter((p) => ["Matriz", "Filial", "Serviços", NOME_DA_ABA.quadro].includes(p.nome));
    const planilhas = [...unidades, ...centros, ...outras.filter((p) => !unidades.includes(p))];
    if (umPorAba) {
      // Os nomes finais das abas (o Excel limita e repete nomes), para as fórmulas do Consolidado.
      const nomes = nomesDasAbas([ABA_CONSOLIDADO, ...planilhas.map((p) => p.nome)]);
      const origens: OrigensDasContas = new Map();
      planilhas.forEach((p, i) => {
        p.nome = nomes[i + 1];
        const ls = doCentro.get(p);
        if (ls) origensDaAba(origens, p.nome, ls);
      });
      planilhas.unshift(
        abaConsolidado({
          est: await estruturaDRE(),
          informacoes: [
            geracao,
            "A DRE das contas dos centros de custo: cada conta é a soma dela nas abas dos centros (em fórmulas: acompanha os valores das abas); as atribuições, os grupos e o total somam as contas. Confira com a DRE do cenário (tela Resultados / Consolidado): o total bate; por conta, a parte dos rateios que vai para Serviços (Metalurgia, Armadura e Acompanhamento) está, na DRE, nas contas da CSM ou da CSC. O Quadro de Lotação não entra, e esta aba não se importa.",
          ],
          rotulos: ["Média de Referência", ...meses],
          total: [1, 12],
          origens,
          rodape: `Premissas · ${ABA_CONSOLIDADO}`,
        }),
      );
    }
    const nome = `${deQuais}${umPorAba ? " (um centro por aba)" : ""}`;
    return {
      nomeArquivo: limparNome(`${sufixo} - ${nome}.xlsx`),
      tipo: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      conteudo: gerarXlsx(planilhas, `${sufixo} - ${nome}`),
      visoes,
    };
  },


  /**
   * O Importar Valores, passo 1 (15/10/2026): lê um arquivo (.xlsx do Exportar Premissas, ou o .zip de um arquivo por
   * centro) e confere o padrão; devolve, por planilha, as abas lidas, os erros e avisos e as mudanças (os meses e as
   * justificativas diferentes dos do cenário). Não grava nada.
   */
  async analisarPremissas(id: string, arquivo: string, conteudo: Uint8Array, usuario: Usuario) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    const porChave = new Map((await linhasDaPlanilha(c)).map((l) => [l.chave, l]));
    // Os investimentos do cenário pelo Nome de Referência (sem diferença de maiúsculas).
    const existentes = new Map((await getPrismaClient().cenarioInvestimento.findMany({ where: { cenarioId: id } })).map((i) => [chaveDoNome(i.nomeReferencia), i]));
    const lidos = lerArquivoDePremissas(arquivo, conteudo);
    // O Quadro de Lotação (09/11/2026): os cadastros pelos textos, como no Lançamento Inicial, e as linhas do cenário pelo código.
    const comQuadro = lidos.some((r) => r.quadro.length);
    const [resolver, cad, linhasDoCenario] = comQuadro
      ? await Promise.all([
          resolvedorDeColaboradores(getPrismaClient()),
          cadastrosDoQuadro(),
          getPrismaClient().cenarioLotacao.findMany({ where: { cenarioId: id }, include: { meses: true } }),
        ])
      : [null, null, []];
    const doCenario = new Map(linhasDoCenario.map((l) => [l.id, l]));
    return lidos.map((r) => {
      const novasDoQuadro: Array<DadosDaLinhaDoQuadro & { descricao: string }> = [];
      const alteradasDoQuadro: Array<DadosDaLinhaDoQuadro & { id: string; descricao: string }> = [];
      for (const l of r.quadro) {
        const erro = (m: string) => r.erros.push(`${l.aba}, linha ${l.numero}: ${m}`);
        const res = resolver!(l.campos);
        if (!res.cadastros) {
          erro(res.motivos.join(" "));
          continue;
        }
        if (!cad!.centros.some((x) => x.id === res.cadastros!.centroCustoId)) {
          erro(`o centro de custo ${l.campos.centro} não é de um grupo do cenário (os de estoque e de investimento ficam de fora).`);
          continue;
        }
        const dados = { ...res.cadastros, meses: l.meses, descricao: `${l.campos.funcao} · ${l.campos.centro}` };
        if (!l.id) {
          novasDoQuadro.push(dados);
          continue;
        }
        const atual = doCenario.get(l.id);
        if (!atual) {
          erro(`o Código da Linha ${l.id} não é deste cenário (para uma linha nova, deixe-o em branco).`);
          continue;
        }
        const antes = mesesDaLinha(atual.meses);
        const mudou =
          (["unidadeNegocioId", "vinculo", "senioridadeId", "funcaoId", "centroCustoId"] as const).some((k) => atual[k] !== dados[k]) ||
          antes.some((m, k) => (["colaboradores", "salarioBruto", "adicional"] as const).some((x) => !iguais(m[x], dados.meses[k][x])));
        if (mudou) alteradasDoQuadro.push({ ...dados, id: l.id });
      }
      const alteracoes = new Map<string, MudancaDaPlanilha & { bloco: string }>();
      const justificativas = new Map<string, { chave: string; texto: string | null; bloco: string }>();
      const desconhecidas: string[] = [];
      const abasDasLinhas = new Set<AbaDasPremissas>();
      // Os trechos do arquivo (15/10/2026): a unidade, o centro, a depreciação base de uma unidade… — para conferir os
      // repetidos entre os arquivos de uma importação.
      const blocos = new Set<string>();
      for (const l of r.linhas) {
        const atual = porChave.get(l.chave);
        if (!atual) {
          desconhecidas.push(`${l.aba}, linha ${l.numero}`);
          continue;
        }
        abasDasLinhas.add(atual.aba);
        const bloco = blocoDaChave(l.chave, atual.descricao);
        // As linhas calculadas (19/10/2026) não se importam: só a justificativa.
        if (atual.calculada) l.meses = [...atual.meses];
        blocos.add(bloco);
        l.meses.forEach((v, k) => {
          const chave = `${l.chave}|${k + 1}`;
          if (!iguais(atual.meses[k], v)) alteracoes.set(chave, { chave: l.chave, mes: k + 1, valor: v, bloco });
          else alteracoes.delete(chave);
        });
        if ((l.justificativa ?? null) !== (atual.justificativa ?? null)) justificativas.set(l.chave, { chave: l.chave, texto: l.justificativa, bloco });
        else justificativas.delete(l.chave);
      }
      // Os investimentos (15/10/2026): com o Nome de Referência de um investimento do cenário, a alteração dele (se mudou);
      // com um nome novo, um novo.
      const novos: InvestimentoLido[] = [];
      const alterados: Array<InvestimentoLido & { id: string }> = [];
      for (const i of r.investimentos) {
        const atual = existentes.get(chaveDoNome(i.nomeReferencia));
        if (!atual) novos.push(i);
        else if (
          atual.unidade !== i.unidade ||
          atual.descricao !== i.descricao ||
          (atual.condicaoPagamento ?? null) !== i.condicaoPagamento ||
          atual.inicio !== i.inicio ||
          !iguais(Number(atual.valorTotal), i.valorTotal) ||
          !iguais(Number(atual.valorPosUso), i.valorPosUso) ||
          atual.vidaUtil !== i.vidaUtil
        )
          alterados.push({ ...i, id: atual.id });
      }
      if (r.investimentos.length) abasDasLinhas.add("investimentos");
      if (r.quadro.length) abasDasLinhas.add("quadro");
      const avisos = [...r.avisos];
      if (desconhecidas.length) {
        avisos.push(
          `${desconhecidas.length} ${desconhecidas.length === 1 ? "linha com um Código que este cenário não tem foi ignorada" : "linhas com Códigos que este cenário não tem foram ignoradas"} (${desconhecidas.slice(0, 5).join("; ")}${desconhecidas.length > 5 ? "…" : ""}).`,
        );
      }
      const semLinhas = r.linhas.length > 0 && r.linhas.length === desconhecidas.length && !r.investimentos.length && !r.quadro.length;
      return {
        arquivo: r.arquivo,
        valido: r.erros.length === 0 && (r.linhas.length > desconhecidas.length || r.investimentos.length > 0 || r.quadro.length > 0),
        erros: semLinhas && !r.erros.length ? ["Nenhuma linha do arquivo é deste cenário (os Códigos não batem)."] : r.erros,
        avisos,
        abas: r.abas,
        abasDasPremissas: [...abasDasLinhas],
        blocos: [...blocos],
        linhas: r.linhas.length - desconhecidas.length,
        alteracoes: [...alteracoes.values()],
        justificativas: [...justificativas.values()],
        investimentos: { novos, alterados },
        quadro: { novas: novasDoQuadro, alteradas: alteradasDoQuadro },
      };
    });
  },

  /**
   * O Importar Valores, passo 2 (15/10/2026; o usuário confirmou): grava os meses (em branco apaga) e as justificativas
   * das planilhas válidas, na ordem (a última vale; os trechos repetidos entre os arquivos o usuário resolve antes, na
   * tela: ignorar ou sobrescrever), e os investimentos — os alterados pelo Nome de Referência e os novos na sequência dos
   * que já existem —, recalcula a DRE e registra no histórico (tela Reajustes).
   */
  async importarPremissas(
    id: string,
    arquivos: Array<{
      arquivo: string;
      alteracoes: MudancaDaPlanilha[];
      justificativas: Array<{ chave: string; texto: string | null }>;
      investimentos?: { novos: DadosDoInvestimento[]; alterados: Array<DadosDoInvestimento & { id: string }> };
      quadro?: { novas: DadosDaLinhaDoQuadro[]; alteradas: Array<DadosDaLinhaDoQuadro & { id: string }> };
    }>,
    usuario: Usuario,
  ) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    const porChave = new Map((await linhasDaPlanilha(c)).map((l) => [l.chave, l]));
    const mudancas = new Map<string, MudancaDaPlanilha>();
    const justificativas = new Map<string, string | null>();
    for (const a of arquivos) {
      for (const m of a.alteracoes) {
        if (!porChave.has(m.chave)) throw new CenarioError(400, `O Código ${m.chave} não é deste cenário: analise os arquivos de novo.`);
        mudancas.set(`${m.chave}|${m.mes}`, m);
      }
      for (const j of a.justificativas) {
        if (!porChave.has(j.chave)) throw new CenarioError(400, `O Código ${j.chave} não é deste cenário: analise os arquivos de novo.`);
        justificativas.set(j.chave, j.texto);
      }
    }
    // Os novos pelo Nome de Referência (o mesmo nome em dois arquivos: vale o último); o que já existe no cenário vira
    // alteração dele.
    const doCenario = new Map((await getPrismaClient().cenarioInvestimento.findMany({ where: { cenarioId: id } })).map((i) => [chaveDoNome(i.nomeReferencia), i.id]));
    const porNome = new Map(arquivos.flatMap((a) => a.investimentos?.novos ?? []).map((i) => [chaveDoNome(i.nomeReferencia), i]));
    const alterados = new Map(arquivos.flatMap((a) => a.investimentos?.alterados ?? []).map((i) => [i.id, i]));
    for (const [nome, i] of porNome) {
      const existente = doCenario.get(nome);
      if (existente) {
        alterados.set(existente, { ...i, id: existente });
        porNome.delete(nome);
      }
    }
    const novos = [...porNome.values()];
    for (const i of [...novos, ...alterados.values()]) {
      if (!contaDeDepreciacao(i.unidade)) throw new CenarioError(400, `Unidade inválida no investimento ${i.descricao}.`);
      if (i.valorPosUso > i.valorTotal) throw new CenarioError(400, `No investimento ${i.descricao}, o valor pós uso passa do valor total.`);
    }
    const nInvestimentos = novos.length + alterados.size;
    // O Quadro de Lotação (09/11/2026): as linhas alteradas pelo código (a última vale) e as novas, conferidas de novo.
    const novasDoQuadro = arquivos.flatMap((a) => a.quadro?.novas ?? []);
    const alteradasDoQuadro = new Map(arquivos.flatMap((a) => a.quadro?.alteradas ?? []).map((l) => [l.id, l]));
    const nQuadro = novasDoQuadro.length + alteradasDoQuadro.size;
    if (nQuadro) {
      const [cad, atuais] = await Promise.all([cadastrosDoQuadro(), getPrismaClient().cenarioLotacao.findMany({ where: { cenarioId: id, id: { in: [...alteradasDoQuadro.keys()] } } })]);
      if (atuais.length !== alteradasDoQuadro.size) throw new CenarioError(400, "Uma linha do Quadro de Lotação da planilha não é deste cenário: analise os arquivos de novo.");
      const atualDe = new Map(atuais.map((l) => [l.id, l]));
      for (const l of [...novasDoQuadro, ...alteradasDoQuadro.values()]) {
        const recusa = recusaDaLinha(l, cad, "id" in l ? atualDe.get(l.id as string) : null);
        if (recusa) throw new CenarioError(400, `Quadro de Lotação: ${recusa}`);
      }
    }
    if (!mudancas.size && !justificativas.size && !nInvestimentos && !nQuadro)
      throw new CenarioError(400, "Nada a importar: os arquivos têm os mesmos valores, justificativas, investimentos e linhas do Quadro de Lotação do cenário.");
    const prisma = getPrismaClient();
    const est = await estruturaDRE();
    if (alterados.size) {
      const contados = await prisma.cenarioInvestimento.count({ where: { cenarioId: id, id: { in: [...alterados.keys()] } } });
      if (contados !== alterados.size) throw new CenarioError(400, "Um investimento da planilha não é deste cenário: analise os arquivos de novo.");
    }
    const camposDoInvestimento = (i: DadosDoInvestimento) => ({
      nomeReferencia: i.nomeReferencia,
      unidade: i.unidade,
      conta: contaDeDepreciacao(i.unidade)!.conta,
      descricao: i.descricao,
      condicaoPagamento: i.condicaoPagamento,
      inicio: i.inicio,
      valorTotal: new Prisma.Decimal(i.valorTotal.toFixed(2)),
      valorPosUso: new Prisma.Decimal(i.valorPosUso.toFixed(2)),
      vidaUtil: i.vidaUtil,
    });
    await prisma.$transaction(
      async (tx) => {
        await aplicarMudancas(tx, id, [...mudancas.values()], est);
        for (const i of alterados.values()) await tx.cenarioInvestimento.update({ where: { id: i.id }, data: camposDoInvestimento(i) });
        const ordem = await tx.cenarioInvestimento.count({ where: { cenarioId: id } });
        for (const [k, i] of novos.entries()) await tx.cenarioInvestimento.create({ data: { ...camposDoInvestimento(i), cenarioId: id, ordem: ordem + k } });
        const camposDaLinha = (l: DadosDaLinhaDoQuadro) => ({ unidadeNegocioId: l.unidadeNegocioId, vinculo: l.vinculo, senioridadeId: l.senioridadeId, funcaoId: l.funcaoId, centroCustoId: l.centroCustoId });
        for (const l of alteradasDoQuadro.values()) {
          await tx.cenarioLotacao.update({ where: { id: l.id }, data: camposDaLinha(l) });
          await tx.cenarioLotacaoMes.deleteMany({ where: { linhaId: l.id } });
          await tx.cenarioLotacaoMes.createMany({ data: mesesParaGravar(l.id, l.meses) });
        }
        const ordemDoQuadro = await tx.cenarioLotacao.count({ where: { cenarioId: id } });
        for (const [k, l] of novasDoQuadro.entries()) {
          const nova = await tx.cenarioLotacao.create({ data: { ...camposDaLinha(l), cenarioId: id, ordem: ordemDoQuadro + k } });
          await tx.cenarioLotacaoMes.createMany({ data: mesesParaGravar(nova.id, l.meses) });
        }
        for (const [chave, texto] of justificativas) {
          if (texto) await tx.cenarioPremissaJustificativa.upsert({ where: { cenarioId_chave: { cenarioId: id, chave } }, create: { cenarioId: id, chave, texto, usuarioNome: usuario.nome }, update: { texto, usuarioNome: usuario.nome } });
          else await tx.cenarioPremissaJustificativa.deleteMany({ where: { cenarioId: id, chave } });
        }
        if (mudancas.size || nInvestimentos || nQuadro) await calcularAnalitico(tx, id);
      },
      { timeout: 300_000 },
    );
    const meses = [...new Set([...mudancas.values()].map((m) => m.mes))].sort((a, b) => a - b);
    const nomes = arquivos.map((a) => a.arquivo);
    const doInvestimento = nInvestimentos
      ? `, ${novos.length} ${novos.length === 1 ? "investimento novo" : "investimentos novos"} e ${alterados.size} ${alterados.size === 1 ? "alterado" : "alterados"}`
      : "";
    const doQuadro = nQuadro
      ? `, ${novasDoQuadro.length} ${novasDoQuadro.length === 1 ? "linha nova" : "linhas novas"} e ${alteradasDoQuadro.size} ${alteradasDoQuadro.size === 1 ? "alterada" : "alteradas"} no Quadro de Lotação`
      : "";
    const descricao = `Valores importados de ${nomes.length === 1 ? nomes[0] : `${nomes.length} arquivos`}: ${mudancas.size} ${mudancas.size === 1 ? "valor" : "valores"} e ${justificativas.size} ${justificativas.size === 1 ? "justificativa" : "justificativas"}${doInvestimento}${doQuadro}`;
    const contas = [...new Set([...mudancas.values()].map((m) => m.chave))].slice(0, 200).map((k) => ({ codigo: k, descricao: porChave.get(k)!.descricao.filter(Boolean).join(" · ") }));
    await prisma.cenarioReajuste.create({
      data: { cenarioId: id, usuarioId: usuario.id || null, usuarioNome: usuario.nome, tipo: "IMPORTACAO", descricao, valores: mudancas.size, meses, contas },
    });
    await auditar({ usuarioId: usuario.id, usuarioNome: usuario.nome, acao: "IMPORTACAO", entidade: "cenario", entidadeId: id, metadados: { cenario: c.nome, premissas: "importar valores", arquivos: nomes, valores: mudancas.size, justificativas: justificativas.size, investimentosNovos: novos.length, investimentosAlterados: alterados.size, quadroNovas: novasDoQuadro.length, quadroAlteradas: alteradasDoQuadro.size } });
    return { valores: mudancas.size, justificativas: justificativas.size, investimentosNovos: novos.length, investimentosAlterados: alterados.size, quadroNovas: novasDoQuadro.length, quadroAlteradas: alteradasDoQuadro.size };
  },

  /**
   * Recalcula a DRE do cenário analítico (14/10/2026: o botão Recalcular dos Resultados), com as regras de rateio de
   * hoje: depois de editar uma regra com o cenário em aberto. Só nos cenários em aberto (sem marcação nem versão
   * congelada).
   */
  async recalcular(id: string, usuario: Usuario) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    await getPrismaClient().$transaction(async (tx) => calcularAnalitico(tx, id), { timeout: 120_000 });
    await auditar({ usuarioId: usuario.id, usuarioNome: usuario.nome, acao: "ALTERACAO", entidade: "cenario", entidadeId: id, metadados: { cenario: c.nome, recalculo: "regras de rateio" } });
    await getPrismaClient().cenarioReajuste.create({ data: { cenarioId: id, usuarioId: usuario.id || null, usuarioNome: usuario.nome, tipo: "RECALCULO", descricao: "Recalculado com as regras de rateio de hoje" } });
    return this.obter(id, usuario);
  },

  /**
   * O comparativo do cenário (12/10/2026): o cenário comparado, os cenários que o usuário pode escolher e as linhas da
   * DRE (14/10/2026: totais, atribuições e contas; antes, só os totais), com a variação máxima (em %) de cada linha
   * verificada (nula: a linha não se verifica).
   */
  async comparativo(id: string, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    // Os dois tipos (13/10/2026): o analítico se compara também com um sintético (o Orçamento Empresarial, por exemplo).
    const outros = (await getPrismaClient().cenario.findMany({ where: { id: { not: id } }, orderBy: [{ ano: "desc" }, { criadoEm: "desc" }] })).filter((o) => alcanca(o, usuario));
    const limites = limitesDe(c);
    const { linhas } = totaisDaDRE(await estruturaDRE());
    const comparado = c.comparadoComId ? await getPrismaClient().cenario.findUnique({ where: { id: c.comparadoComId }, select: { id: true, nome: true, ano: true } }) : null;
    // Nos analíticos (19/10/2026), o índice escolhido em cada linha (o da conta ou, sem ele, o do total ou da atribuição acima).
    const analitico = c.tipo === "ANALITICO";
    const indices = indicesDe(c);
    const escolhidos = (c.indicesDoComparativo ?? {}) as Record<string, string>;
    const chaves = new Set(indices.map((i) => i.chave));
    const indiceDa = (codigo: string, acima: string[]) => indiceDaLinha(escolhidos, chaves, codigo, acima);
    // A versão vigente (13/10/2026): a maior da família (o filtro "Apenas Vigentes" do modal de escolha).
    const ultimas = new Map<string, number>();
    for (const v of await getPrismaClient().cenario.findMany({ select: { id: true, familiaId: true, versao: true } })) {
      const familia = v.familiaId ?? v.id;
      ultimas.set(familia, Math.max(ultimas.get(familia) ?? 0, v.versao));
    }
    return {
      comparadoCom: comparado,
      opcoes: outros.map((o) => ({ id: o.id, nome: o.nome, ano: o.ano, tipo: o.tipo as TipoCenario, marcacao: o.marcacao, versao: o.versao, vigente: o.versao === ultimas.get(o.familiaId ?? o.id) })),
      linhas: linhas.map((l) => ({
        codigo: l.linha.codigo,
        descricao: l.linha.descricao,
        tipo: l.linha.tipo,
        verificada: l.folha,
        limite: l.folha ? limiteDaLinha(limites, l.linha.codigo, l.acima) : null,
        indice: analitico && l.folha ? indiceDa(l.linha.codigo, l.acima) : null,
      })),
      /** Os Índices de Reajuste (só nos analíticos; nulo nos sintéticos, que digitam a variação). */
      indices: analitico ? indices : null,
    };
  },

  /**
   * Grava o comparativo: o cenário comparado (nulo desliga o comparativo; as variações máximas ficam guardadas) e as
   * variações máximas das linhas verificadas (as contas, e os totais e atribuições sem contas). Não vale para o cenário
   * travado (14/10/2026: marcado ou com a versão congelada; antes, valia).
   */
  async gravarComparativo(
    id: string,
    dados: { comparadoComId: string | null; limites?: Record<string, number | null>; indices?: Record<string, string | null> },
    usuario: Usuario,
  ) {
    const antes = await obterOuFalhar(id, usuario);
    exigirQuemCriou(antes, usuario);
    exigirEditavel(antes);
    if (dados.comparadoComId === id) throw new CenarioError(400, "Escolha outro cenário para comparar.");
    if (dados.comparadoComId) await obterOuFalhar(dados.comparadoComId, usuario);
    const codigos = new Set(totaisDaDRE(await estruturaDRE()).verificadas.map((v) => v.linha.codigo));
    // Nos analíticos (19/10/2026), o índice de cada conta (Configurações / Índices); nos sintéticos, a variação digitada.
    const analitico = antes.tipo === "ANALITICO";
    const escolhas = analitico ? (dados.indices ?? {}) : (dados.limites ?? {});
    const fora = Object.keys(escolhas).filter((k) => !codigos.has(k));
    if (fora.length) throw new CenarioError(400, `Não são contas da DRE: ${fora.slice(0, 3).join(", ")}.`);
    let data: Prisma.CenarioUncheckedUpdateInput;
    if (analitico) {
      const chaves = new Set(indicesDe(antes).map((i) => i.chave));
      const desconhecido = Object.values(dados.indices ?? {}).find((v) => v !== null && !chaves.has(v));
      if (desconhecido) throw new CenarioError(400, "Um dos índices escolhidos não existe mais: atualize a tela (Configurações / Índices).");
      const indicesDoComparativo = Object.fromEntries(Object.entries(dados.indices ?? {}).filter((e): e is [string, string] => e[1] !== null));
      data = { comparadoComId: dados.comparadoComId, indicesDoComparativo };
    } else {
      const variacoesMaximas = Object.fromEntries(Object.entries(dados.limites ?? {}).filter((e): e is [string, number] => e[1] !== null));
      data = { comparadoComId: dados.comparadoComId, variacoesMaximas };
    }
    const depois = await getPrismaClient().cenario.update({ where: { id }, data });
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "ALTERACAO",
      entidade: "cenario",
      entidadeId: id,
      antes: { comparadoComId: antes.comparadoComId, ...(analitico ? { indicesDoComparativo: antes.indicesDoComparativo } : { variacoesMaximas: antes.variacoesMaximas }) },
      depois: { comparadoComId: depois.comparadoComId, ...(analitico ? { indicesDoComparativo: depois.indicesDoComparativo } : { variacoesMaximas: depois.variacoesMaximas }) },
      metadados: { comparativo: true },
    });
    return this.comparativo(id, usuario);
  },

  /**
   * Os Índices de Reajuste do cenário analítico (19/10/2026; Configurações / Índices), com quantas contas do Comparativo
   * usam cada um.
   */
  async indices(id: string, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    if (c.tipo !== "ANALITICO") throw new CenarioError(400, "Os Índices de Reajuste são dos cenários analíticos.");
    const usos = await contasPorIndice(c);
    return { indices: indicesDe(c).map((i) => ({ ...i, contas: usos.get(i.chave) ?? 0 })) };
  },

  /**
   * Grava a lista inteira dos Índices de Reajuste (19/10/2026): os de chave conhecida mudam, os sem chave entram (com uma
   * chave nova) e os que faltam saem — menos os que o Comparativo usa (troque o índice das contas antes). Vale o que vale
   * para o comparativo: só quem criou o cenário (ou o Administrador) e com o cenário editável.
   */
  async gravarIndices(id: string, lista: Array<{ chave?: string | null; descricao: string; observacao?: string | null; variacao: number }>, usuario: Usuario) {
    const antes = await obterOuFalhar(id, usuario);
    if (antes.tipo !== "ANALITICO") throw new CenarioError(400, "Os Índices de Reajuste são dos cenários analíticos.");
    exigirQuemCriou(antes, usuario);
    exigirEditavel(antes);
    const atuais = indicesDe(antes);
    const conhecidas = new Set(atuais.map((i) => i.chave));
    const repetida = lista.find((i, k) => lista.findIndex((x) => x.descricao.trim().toLowerCase() === i.descricao.trim().toLowerCase()) !== k);
    if (repetida) throw new CenarioError(400, `O índice ${repetida.descricao.trim()} aparece duas vezes.`);
    let proxima = Math.max(0, ...atuais.map((i) => Number(/^i(\d+)$/.exec(i.chave)?.[1] ?? 0))) + 1;
    const novos: IndiceDeReajuste[] = lista.map((i) => ({
      chave: i.chave && conhecidas.has(i.chave) ? i.chave : `i${proxima++}`,
      descricao: i.descricao.trim(),
      observacao: i.observacao?.trim() || null,
      variacao: i.variacao,
    }));
    const ficam = new Set(novos.map((i) => i.chave));
    // Em uso: escolhido em alguma linha do Comparativo (a contagem é a das contas, com as que o herdam de um total).
    const usos = await contasPorIndice(antes);
    const escolhidos = new Set(Object.values((antes.indicesDoComparativo ?? {}) as Record<string, string>));
    const emUso = atuais.filter((i) => !ficam.has(i.chave) && escolhidos.has(i.chave));
    if (emUso.length) {
      throw new CenarioError(
        409,
        `${emUso.map((i) => `${i.descricao} (${usos.get(i.chave) ?? 0} ${usos.get(i.chave) === 1 ? "conta" : "contas"})`).join(", ")}: ${emUso.length === 1 ? "o índice está" : "os índices estão"} no Comparativo. Troque o índice dessas contas antes de excluir.`,
      );
    }
    const depois = await getPrismaClient().cenario.update({ where: { id }, data: { indicesReajuste: novos as unknown as Prisma.InputJsonValue } });
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "ALTERACAO",
      entidade: "cenario",
      entidadeId: id,
      antes: { indicesReajuste: antes.indicesReajuste },
      depois: { indicesReajuste: depois.indicesReajuste },
      metadados: { indices: true },
    });
    return this.indices(id, usuario);
  },

  /**
   * As justificativas do comparativo: em cada visão da DRE, as contas (ou os totais e atribuições sem contas) com algum
   * mês acima da variação máxima delas, os meses (o valor, o comparado e a variação) e a justificativa gravada.
   */
  async justificativas(id: string, usuario: Usuario = SISTEMA) {
    const prisma = getPrismaClient();
    const c = await obterOuFalhar(id, usuario);
    const comparado = c.comparadoComId ? await prisma.cenario.findUnique({ where: { id: c.comparadoComId }, select: { id: true, nome: true, ano: true } }) : null;
    if (!comparado) return { comparadoCom: null, visoes: [] };
    const limites = limitesDe(c);
    const est = await estruturaDRE();
    const { verificadas, linhas } = totaisDaDRE(est);
    const acimaDe = new Map(linhas.map((l) => [l.linha.codigo, l.acima]));
    const dasVisoes = linhasDasVisoes(est);
    const [valores, comparados, gravadas] = await Promise.all([
      prisma.cenarioResultado.findMany({ where: { cenarioId: id }, select: { visao: true, linhaDREId: true, mes: true, valor: true } }),
      prisma.cenarioResultado.findMany({ where: { cenarioId: comparado.id }, select: { visao: true, linhaDREId: true, mes: true, valor: true } }),
      prisma.cenarioJustificativa.findMany({ where: { cenarioId: id } }),
    ]);
    const mapa = (rs: typeof valores) => {
      const m = new Map<string, Map<number, number>>();
      for (const r of rs) {
        const k = `${r.visao}|${r.linhaDREId}`;
        if (!m.has(k)) m.set(k, new Map());
        m.get(k)!.set(r.mes, Number(r.valor));
      }
      return m;
    };
    const doCenario = mapa(valores);
    const doComparado = mapa(comparados);
    const vazio = new Map<number, number>();
    const justificativa = new Map(gravadas.map((j) => [`${j.visao}|${j.linhaDREId}`, j]));
    return {
      comparadoCom: comparado,
      visoes: ABAS_DRE.map(({ visao, nome }) => ({
        visao,
        nome,
        itens: verificadas.flatMap(({ linha, total }) => {
          const limite = limiteDaLinha(limites, linha.codigo, acimaDe.get(linha.codigo) ?? []);
          if (typeof limite !== "number" || !dasVisoes.get(visao)!.has(linha.codigo)) return [];
          const k = `${visao}|${linha.id}`;
          const meses = mesesAcima(doCenario.get(k) ?? vazio, doComparado.get(k) ?? vazio, limite);
          if (!meses.length) return [];
          const j = justificativa.get(k);
          return [
            {
              codigo: linha.codigo,
              descricao: linha.descricao,
              total: total.descricao,
              ehTotal: linha.codigo === total.codigo,
              limite,
              meses,
              justificativa: j ? { texto: j.texto, usuarioNome: j.usuarioNome, atualizadoEm: j.atualizadoEm } : null,
            },
          ];
        }),
      })),
    };
  },

  /**
   * Grava a justificativa de uma linha numa visão; o texto vazio a apaga. Não vale para o cenário travado (14/10/2026:
   * marcado ou com a versão congelada; antes, valia).
   */
  async gravarJustificativa(id: string, dados: { visao: number; linha: string; texto: string }, usuario: Usuario) {
    const prisma = getPrismaClient();
    exigirEditavel(await obterOuFalhar(id, usuario));
    const linha = await prisma.linhaDRE.findUnique({ where: { codigo: dados.linha }, select: { id: true, descricao: true } });
    if (!linha) throw new CenarioError(400, "Conta não encontrada na Estrutura da DRE.");
    const chave = { cenarioId_visao_linhaDREId: { cenarioId: id, visao: dados.visao, linhaDREId: linha.id } };
    const antes = await prisma.cenarioJustificativa.findUnique({ where: chave });
    if (!dados.texto) {
      if (antes) await prisma.cenarioJustificativa.delete({ where: chave });
    } else {
      await prisma.cenarioJustificativa.upsert({
        where: chave,
        create: { cenarioId: id, visao: dados.visao, linhaDREId: linha.id, texto: dados.texto, usuarioNome: usuario.nome },
        update: { texto: dados.texto, usuarioNome: usuario.nome },
      });
    }
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "ALTERACAO",
      entidade: "cenario",
      entidadeId: id,
      antes: antes ? { texto: antes.texto } : undefined,
      depois: dados.texto ? { texto: dados.texto } : undefined,
      metadados: { justificativa: linha.descricao, visao: dados.visao },
    });
  },

  /** Grava os lançamentos manuais de um indicador (os 12 meses; vazio apaga o mês). */
  async salvarManual(id: string, nome: string, valores: Array<number | null>, usuario: Usuario) {
    const c = await obterOuFalhar(id, usuario);
    exigirEditavel(c);
    if (!MANUAIS.has(nome)) throw new CenarioError(400, `${nome} não é um lançamento manual: sai da DRE do cenário.`);
    if (c.tipo === "ANALITICO" && QUADROS_DE_LOTACAO.has(nome))
      throw new CenarioError(400, `${nome} sai do Quadro de Lotação dos centros de custo (Premissas / Centros de Custo) e não se digita.`);
    const prisma = getPrismaClient();
    const antes = await prisma.cenarioIndicador.findMany({ where: { cenarioId: id, nome, mes: { gte: 1 } }, orderBy: { mes: "asc" } });
    await prisma.$transaction(async (tx) => {
      // Só os meses: a Média de Referência (o mês 0) fica (15/10/2026).
      await tx.cenarioIndicador.deleteMany({ where: { cenarioId: id, nome, mes: { gte: 1 } } });
      const novos = valores.map((v, k) => ({ v, mes: k + 1 })).filter((x) => x.v !== null);
      await tx.cenarioIndicador.createMany({
        data: novos.map(({ v, mes }) => {
          // O mês que não mudou continua com a origem dele.
          const anterior = antes.find((a) => a.mes === mes);
          const igual = anterior && Math.abs(Number(anterior.valor) - v!) < 1e-9;
          return { cenarioId: id, nome, mes, valor: v!, origem: igual ? anterior.origem : "DIGITADO" };
        }),
      });
    });
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "ALTERACAO",
      entidade: "cenario",
      entidadeId: id,
      antes: { nome, valores: antes.map((a) => ({ mes: a.mes, valor: a.valor })) },
      depois: { nome, valores: valores.map((v, k) => ({ mes: k + 1, valor: v })) },
      metadados: { lancamentoManual: nome },
    });
  },
};
