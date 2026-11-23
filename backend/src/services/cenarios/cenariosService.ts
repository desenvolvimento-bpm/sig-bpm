import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";

import { getPrismaClient } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { AcessoInformacoesCenario, DepartamentoAcesso, MarcacaoCenario, VisualizacaoCenario } from "../../generated/prisma/enums.js";
import { ArquivoInvalidoError, lerAba, listarAbas } from "../../lib/xlsx.js";
import { ACESSO_TOTAL, carregarUsuariosAtivos, CODIGO_ADMINISTRADOR } from "../acesso/acesso.js";
import { auditar } from "../auditoriaService.js";
import { caminhoDoArquivo, diretorioUploads } from "../importacoes/arquivosImportados.js";
import { INDICADORES_DAS_LISTAS } from "../relatorios/catalogoIndicadores.js";
import { carregarNomesDoSistema, nomesAntigos } from "../relatorios/indicadoresDoSistema.js";
import { basesDoConsolidado, COD } from "../relatorios/basesResultados.js";
import { estrutura, montar } from "../relatorios/resultadosService.js";
import { montarDepartamentos } from "../relatorios/departamentosDaDRE.js";
import { estrutura as estruturaDRE } from "../dre/dreService.js";
import { contasDaUnidade, ErroEdicao, gravarValores, linhasDaUnidade, linhasDoConsolidado, recalcular, UNIDADES, type Alteracao } from "./edicaoCenario.js";
import { indicadoresService } from "../relatorios/indicadoresService.js";
import { calcularCenario, rotuloDoComparado, type CalculoDoCenario } from "./indicadoresDoCenario.js";
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
  departamentosDoGrupoDoIndicador,
  lerArquivoDePremissas,
  nadaAImportar,
  chaveDaDescricao,
  quadroDoArquivo,
  NOME_DA_ABA,
  origensDaAba,
  type AbaDasPremissas,
  type Departamento,
  type InvestimentoLido,
  type LinhaDaPlanilha,
  type ReferenciaDasAbas,
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
  alteradoSemRecalcular,
  calcularAnalitico,
  materializarPremissas,
  pendenciasDoRecalculo,
  reajustarOGrupo,
  centrosNaDREDoCenario,
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
import { contasDoGrupo, gruposDoCenario, RATEIOS, rateiosSemBase, type GrupoDoCenario } from "./centrosCenario.js";
import { apagarValoresDoGrupo, copiarCadastros, renomearValoresDoGrupo, trazerNovosDosCadastros } from "./cadastrosDoCenario.js";
import {
  gruposDaDREParaDepartamentos,
  prepararDepartamento,
  prepararRedistribuicao,
  redistribuicaoParaAuditoria,
  regrasDoCenario,
  type DadosDaRedistribuicaoDoCenario,
} from "./redistribuicoesDoCenario.js";
import {
  contasParaGravar,
  fornecedoresDaCombinacao,
  LINHA_SEL,
  linhaDoDepartamento,
  opcaoDaLinha,
  opcaoDoCentro,
  RegraRedistribuicaoError,
  rotuloDaLinha,
  textoDoMes,
} from "../redistribuicoes/redistribuicoesService.js";
import { foraDoCenario, nomeDoGrupo } from "./centrosCenario.js";
import { BALDES, departamentos as departamentosDosCentros } from "../cadastros/edicao/definicoesCadastros.js";
import {
  abasDoRecorte,
  DEPARTAMENTOS_DO_PATRIMONIO,
  departamentoDoAcesso,
  departamentosDaConta,
  departamentosDoInvestimento,
  FORA_DO_RECORTE,
  gruposDoRecorte,
  recorteDoCenario,
  recorteDoPerfil,
  alteraOInvestimento,
  alteraTodosOsInvestimentos,
  foraDosSeusInvestimentos,
  recorteParaTela,
  trechoDaLinha,
  trechoDoGrupo,
  trechos,
  veAlteracao,
  veCentro,
  veDepartamentos,
  veGrupo,
  veLinha,
  type Recorte,
  type RecorteDoUsuario,
  type Trecho,
} from "./recorteCenario.js";
import { dadosDasVerificacoes, responsavelDa, ROTULO_DA_ABA, textoDosMeses, TITULO_DA_VERIFICACAO, verificar, type Verificacao } from "./verificacoesCenario.js";
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
import { mediaDoPeriodo, mediaNoPeriodo, referenciaDoRealizado } from "./referenciaAnalitico.js";
import { diferencasDasDecisoes, lerRealocacoes, type Realocacoes } from "./realocacoesCenario.js";
import { erroDosReajustes, daChave, type ReajusteDoIndice } from "./reajustesCenario.js";
import {
  departamentosDosIndices,
  errosDasCombinacoes,
  fatoresDoCenario,
  indicesDasLinhas,
  indicesDeComparacao,
  indicesDeReajuste,
  lerCombinacao,
  limitesDasCelulas,
  limiteNaVisao,
  remapearDepartamentosDosIndices,
  type Combinacao,
  type IndiceDeComparacao,
  type IndiceDeReajusteComCombinacoes,
  type Universo,
} from "./indicesCenario.js";
import { QUADROS_DE_LOTACAO, quadroDoGrupo, VENDA_LOTACAO_APRENDIZ, VENDA_LOTACAO_CLT, VENDA_LOTACAO_ESTAGIARIO, VENDA_LOTACAO_PJ, VENDAS_LOTACAO } from "./lotacaoCenario.js";
import { basesDosProjetos, liberacaoTotal, LIBERACOES_DIGITADAS, ondeEstaoOsProjetos } from "./projetosCenario.js";
import { beneficiosDaDiferenca, ehContaDeEncargos, itemDosEncargos, ITENS_DOS_ENCARGOS, maosDeObraDoGrupo, VENDAS_DOS_ENCARGOS } from "./encargosCenario.js";
import {
  beneficiosDoMes,
  beneficiosImportados,
  copiarQuadro,
  linhasDoQuadro,
  mesesDaLinha,
  quadroDosGrupos,
  tipoDaLinha,
  valoresDosBeneficios,
  type LinhaDoQuadro,
  type MesDaLinha,
  type TipoDeColaborador,
} from "./quadroDoCenario.js";
import { gruposDasMedias, marcadoresDasMedias, marcarGrupos, tirarMarcadores, VENDA_DA_BASE, VENDAS_DA_MAO_DE_OBRA_DAS_MEDIAS, vendaDaBase } from "./maoDeObraDasMedias.js";
import { chaveDaLinhaDoQuadro, quadroRealizadoMaisRecente, quadrosRealizadosPorLinha } from "../colaboradores/quadroService.js";
import { resolvedorDeColaboradores } from "../colaboradores/importacaoCadastros.js";
import { ROTULO_DO_TIPO, TIPOS_DO_COLABORADOR, type TipoDoColaborador } from "../colaboradores/tiposDoColaborador.js";
import { assinaturaDasRegras, avisosDosRateios, bloqueioPorRateios, mesesDoAno, percentuaisPelasRegras, regrasDeRateio, type RegraDoMes } from "../volumes/vigenciaDosRateios.js";
import {
  abaDasRegras,
  excluirConjuntoFixo,
  excluirRegraParametrica,
  gravarConjuntoFixo,
  gravarRegraParametrica,
  RegraDoCenarioError,
  regrasDoCenario as regrasDeRateioDoCenario,
} from "./regrasDoCenario.js";

/**
 * Os cenários sintéticos (Criação de Cenários, 11/10/2026): a lista dos cenários gerados, a criação (vazio ou cópia
 * de outro), a importação de um arquivo, a marcação (Orçamento Empresarial, Resultados Anteriores, Resultados
 * Vendidos — cada uma ativa em um cenário só por vez) e as telas Resultados e Indicadores de cada cenário.
 *
 * A visualização (11/10/2026): o cenário particular só aparece para quem o criou e para o Administrador (Editar no
 * Controle de Usuários); para os demais, ele não existe (404). O público aparece para todos com permissão.
 */

/** As recusas das regras das redistribuições e dos departamentos (RegraRedistribuicaoError) como recusas do cenário. */
async function daRegra<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof RegraRedistribuicaoError || e instanceof RegraDoCenarioError) throw new CenarioError(e.status, e.message);
    throw e;
  }
}

export class CenarioError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    message: string,
    /** O que a tela precisa além da mensagem (20/11/2026: o grupo que fica sem centros, para confirmar). */
    readonly detalhes?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const MARCACOES: Record<MarcacaoCenario, string> = {
  // Os nomes curtos (22/10/2026; antes, Orçamento Empresarial, Resultados Anteriores, Resultados Vendidos e Previsão de Resultados).
  ORCAMENTO_EMPRESARIAL: "Orçamento",
  RESULTADOS_ANTERIORES: "Anterior",
  RESULTADOS_VENDIDOS: "Vendido",
  PREVISAO: "Forecast",
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
/** `recorte` (12/11/2026): o recorte do perfil (Departamento ou Centros de Custo), para o Acesso às Informações Por Recorte. */
type Usuario = { id: string; nome: string; admin?: boolean; recorte?: RecorteDoUsuario | null };
/** O trecho da aba Investimentos no Importar Valores (19/11/2026): em dois arquivos com ela, o usuário escolhe qual vale. */
const BLOCO_DOS_INVESTIMENTOS = "Investimentos (a lista)";
/** Uma parte da referência composta dos sintéticos (15/10/2026): a origem e os meses do cenário (`mesDe`–`mesAte`) que ela preenche. */
export type ParteDaReferencia =
  | { tipo: "REALIZADO"; ano: number; modo: "MES_A_MES" | "MEDIA"; de?: number; ate?: number; mesDe: number; mesAte: number }
  | { tipo: "CENARIO"; origemId: string; mesDe: number; mesAte: number };
/** O que a tela fez numa gravação de valores (o histórico de reajustes, 12/10/2026). */
/** `modo` REFERENCIA (13/11/2026): o Replicar Referências dos marcados (a Média de Referência de cada conta nos meses marcados). */
export type OrigemDaGravacao = { tipo: "MARCADOS" | "VALOR"; modo: "PERCENTUAL" | "ABSOLUTO" | "DIGITADO" | "REFERENCIA"; reajuste: number | null; replicado: boolean };
/** As chamadas internas (testes, scripts) veem todos os cenários. */
const SISTEMA: Usuario = { id: "", nome: "Sistema", admin: true };

export const VISUALIZACOES: Record<VisualizacaoCenario, string> = { PARTICULAR: "Particular", PUBLICA: "Pública" };
/** O usuário alcança o cenário? */
/** Um usuário convidado a ver um cenário particular (21/11/2026, pedido do Adão: o Compartilhar das Configurações / Cenário). */
type Compartilhamento = { usuarioId: string; convidadoPor: string; convidadoEm: string };
const compartilhamentosDe = (c: { compartilhamentos?: unknown }): Compartilhamento[] =>
  Array.isArray(c.compartilhamentos) ? (c.compartilhamentos as Compartilhamento[]).filter((x) => x && typeof x.usuarioId === "string") : [];
/**
 * Quem vê o cenário: todos, no público; no particular, quem o criou, o Administrador e (21/11/2026) os usuários convidados no
 * Compartilhar — que usam as telas pelo seu perfil (o só de leitura só lê).
 */
const alcanca = (c: { visualizacao: VisualizacaoCenario; criadoPorId: string | null; compartilhamentos?: unknown }, u: Usuario) =>
  c.visualizacao === "PUBLICA" || !!u.admin || (!!c.criadoPorId && c.criadoPorId === u.id) || (!!u.id && compartilhamentosDe(c).some((x) => x.usuarioId === u.id));
/** Quem muda a visualização e a Edição das Configurações de um cenário: quem o criou e o Administrador. */
const mudaVisualizacao = (c: { criadoPorId: string | null }, u: Usuario) => !!u.admin || (!!c.criadoPorId && c.criadoPorId === u.id);
/**
 * Quem altera a tela Configurações (todas as abas e ações: o cenário, marcar e excluir, a referência, as realocações, o
 * Replicar Médias e o Apagar Valores, o comparativo e os índices): com a Edição das Configurações Particular (o padrão; a
 * regra de 14/10/2026), só quem criou o cenário e o Administrador; Pública (12/11/2026, pedido do Adão), todos com a
 * permissão do perfil (as rotas conferem a dela).
 */
const editaConfiguracoes = (c: { criadoPorId: string | null; edicaoConfiguracoes: VisualizacaoCenario }, u: Usuario) =>
  c.edicaoConfiguracoes === "PUBLICA" || mudaVisualizacao(c, u);
function exigirQuemCriou(c: { nome: string; criadoPorId: string | null; edicaoConfiguracoes: VisualizacaoCenario }, u: Usuario) {
  if (!editaConfiguracoes(c, u))
    throw new CenarioError(403, `O cenário ${c.nome} é de outro usuário, com a Edição das Configurações Particular: só quem o criou (ou o Administrador) altera as Configurações dele.`);
}
const LOTE = 500;
// Os nomes atuais (19/11/2026: pelo ID, acompanham as trocas de nome).
const MANUAIS = INDICADORES_DAS_LISTAS;
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
/**
 * Os rateios sem regra vigente em algum mês do exercício não deixam abrir nem fechar um cenário analítico (14/10/2026); desde
 * 21/11/2026, as regras da cópia do cenário (Configurações / Regras de Rateio).
 */
function exigirRateios(regras: RegraDoMes[], ano: number, acao: string, onde?: string) {
  const bloqueio = bloqueioPorRateios(regras, mesesDoAno(ano), acao, onde);
  if (bloqueio) throw new CenarioError(409, bloqueio);
}

function exigirEditavel(c: { nome: string; marcacao: MarcacaoCenario | null; versao: number; versaoSalvaEm: Date | null }) {
  if (c.versaoSalvaEm) throw new CenarioError(409, `A ${rotuloVersao(c.versao)} do cenário ${c.nome} está congelada e não se edita: reabra a versão (Reabrir Versão) ou crie uma revisão (Criar Revisão), na tela Resultados.`);
  if (c.marcacao) throw new CenarioError(409, `O cenário ${c.nome} está marcado como ${MARCACOES[c.marcacao]} e não se edita: tire a marcação (ou marque outro cenário) antes de editá-lo.`);
}

/**
 * Com os reajustes aplicados na DRE (Premissas / Reajustes, “Aplicar Reajustes”), as premissas não se editam: as abas das
 * unidades, o Quadro de Lotação, os Centros de Custo, os Investimentos e o Extra-Operacional, o Replicar Médias, o Apagar
 * Valores e o Importar Valores, e a referência (que as carrega) com as realocações. Os Indicadores Manuais e a própria aba
 * Reajustes continuam editáveis; desmarcar a caixa Aplicar Reajustes (Resultados, 21/11/2026) destrava.
 */
function exigirSemReajustes(c: { nome: string; reajustesAplicados: boolean }) {
  if (c.reajustesAplicados)
    throw new CenarioError(
      409,
      `A caixa Aplicar Reajustes está marcada no cenário ${c.nome}: as Configurações e as Premissas não se editam (menos os Indicadores Manuais). Para editá-las, desmarque “Aplicar Reajustes”, nos Resultados.`,
    );
}

/** O cenário, se o usuário o alcança; o particular de outro usuário é "não encontrado". */
async function obterOuFalhar(id: string, usuario: Usuario) {
  const c = await getPrismaClient().cenario.findUnique({ where: { id } });
  if (!c || !alcanca(c, usuario)) throw new CenarioError(404, "Cenário não encontrado.");
  return c;
}

/**
 * A ordem dos responsáveis imediatos das verificações (21/11/2026, pedido do Adão), pelo nome do perfil (sem acento): o Analista;
 * sem ele, o Coordenador e o Gente e Gestão (22/11/2026, pedido do Adão: no nível do Coordenador); sem eles, o Estratégico; sem ele,
 * o Gestor. O nível de cada perfil (0 é o primeiro).
 */
const NIVEL_DO_RESPONSAVEL: Record<string, number> = { analista: 0, coordenador: 1, "gente e gestao": 1, estrategico: 2, gestor: 3 };
const NIVEIS_DOS_RESPONSAVEIS = Math.max(...Object.values(NIVEL_DO_RESPONSAVEL)) + 1;
const semAcento = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/**
 * Os responsáveis imediatos de cada verificação (21/11/2026, pedido do Adão): os usuários ativos do primeiro nível da hierarquia
 * (Analista; Coordenador e Gente e Gestão; Estratégico; Gestor) cujo recorte do perfil (os centros de custo, ou os departamentos
 * do Gestor) alcança a verificação — a linha ou o centro dela. Vazio: ninguém da hierarquia a alcança.
 */
async function responsaveisImediatos() {
  const usuarios = (await carregarUsuariosAtivos()).flatMap((u) => {
    const nivel = NIVEL_DO_RESPONSAVEL[semAcento(u.perfil.nome)] ?? -1;
    const a = u.acesso;
    const recorte = recorteDoPerfil({ recorte: a.recorteCentro ? { centros: a.centros, departamentos: null } : a.recorteDepartamento ? { departamentos: a.departamentos, centros: null } : null });
    return nivel >= 0 && recorte ? [{ id: u.sub, nome: u.nome, nivel, recorte }] : [];
  });
  return (v: Pick<Verificacao, "aba" | "grupo">, grupos: Map<string, GrupoDoCenario>) => {
    for (let nivel = 0; nivel < NIVEIS_DOS_RESPONSAVEIS; nivel++) {
      const deste = usuarios.filter((u) => u.nivel === nivel && veVerificacao(u.recorte, v, grupos));
      if (deste.length) return deste.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map((u) => ({ id: u.id as string | null, nome: u.nome }));
    }
    return [];
  };
}

/**
 * As Verificações das Premissas de um cenário analítico (20/11/2026, pedido do Adão; verificacoesCenario.ts), com os responsáveis
 * (21/11/2026: os imediatos, pela hierarquia dos perfis; sem nenhum, quem alterou os valores por último, pelo Histórico, ou quem
 * criou o cenário), quem alterou por último (`responsavel`) e a situação: De Acordo (o da assinatura de hoje) ou pendente (com o
 * De Acordo anterior, se os valores mudaram depois dele).
 */
async function verificacoesComSituacao(c: { id: string; ano: number; criadoPorId: string | null; criadoPor: string | null }) {
  const prisma = getPrismaClient();
  const [dados, historico, acordos, imediatos] = await Promise.all([
    dadosDasVerificacoes(c),
    prisma.cenarioReajuste.findMany({
      where: { cenarioId: c.id },
      orderBy: { criadoEm: "desc" },
      select: { criadoEm: true, usuarioId: true, usuarioNome: true, tipo: true, visao: true, contas: true, alcance: true },
    }),
    prisma.cenarioVerificacaoAcordo.findMany({ where: { cenarioId: c.id } }),
    responsaveisImediatos(),
  ]);
  const grupos = new Map(dados.grupos.map((g) => [g.grupo, g]));
  const doAcordo = new Map(acordos.map((a) => [a.chave, a]));
  const lista = verificar(dados).map((v) => {
    const responsavel = responsavelDa(v, historico) ?? (c.criadoPor ? { id: c.criadoPorId, nome: c.criadoPor, em: null } : null);
    const daHierarquia = imediatos(v, grupos);
    const responsaveis = daHierarquia.length ? daHierarquia : responsavel ? [{ id: responsavel.id, nome: responsavel.nome }] : [];
    const a = doAcordo.get(v.chave);
    const quem = a ? { usuarioId: a.usuarioId, nome: a.usuarioNome, em: a.criadoEm } : null;
    return { ...v, responsavel, responsaveis, acordo: a && a.assinatura === v.assinatura ? quem : null, acordoAnterior: a && a.assinatura !== v.assinatura ? quem : null };
  });
  return { lista, grupos };
}
type VerificacaoComSituacao = Awaited<ReturnType<typeof verificacoesComSituacao>>["lista"][number];
/** A verificação está no recorte do usuário: as das unidades pelos departamentos delas; as do Quadro e dos Centros, pelo grupo. */
const veVerificacao = (r: Recorte | null, v: Pick<Verificacao, "aba" | "grupo">, grupos: Map<string, GrupoDoCenario>) =>
  !r || (["1", "2", "3"].includes(v.aba) ? veDepartamentos(r, departamentosDaUnidade(Number(v.aba))) : !!v.grupo && grupos.has(v.grupo) && veGrupo(r, grupos.get(v.grupo)!));
/** Quem dá (e retira) o De Acordo: um responsável pela verificação (o imediato, 21/11/2026) ou o Administrador. */
const daOAcordo = (v: Pick<VerificacaoComSituacao, "responsaveis">, u: Usuario) =>
  !!u.admin || v.responsaveis.some((r) => (r.id ? r.id === u.id : r.nome === u.nome));
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

type ComVariacoes = { tipo: string; variacoesMaximas: unknown; indicesReajuste: unknown; indicesDoComparativo: unknown };

/** Quantas contas (cada conta numa unidade) cada índice alcança, pelo índice de cada célula. */
function contasPorIndice(porCelula: Map<string, string>, u: Universo): Map<string, number> {
  const celula = new Map(u.celulas.map((c) => [c.chave, c]));
  const porIndice = new Map<string, Set<string>>();
  for (const [chave, indice] of porCelula) {
    const c = celula.get(chave);
    if (!c) continue;
    if (!porIndice.has(indice)) porIndice.set(indice, new Set());
    porIndice.get(indice)!.add(`${c.unidade}|${c.codigo}`);
  }
  return new Map([...porIndice].map(([k, v]) => [k, v.size]));
}

/** Os percentuais com duas casas ("4,00%"), como na tela. */
const pctDoIndice = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

/**
 * Os índices de cada linha numa visão dos Resultados dos analíticos (21/11/2026, pedido do Adão): o Índice de Reajuste (a coluna
 * antes de Janeiro) e, com um cenário comparado, o Índice de Comparação (a coluna antes do Comparativo) — o texto e a dica.
 */
async function indicesDosResultados(
  c: { id: string; ano: number; reajustesAplicados: boolean; indicesDosReajustes: unknown; aplicacaoDosReajustes: unknown; indicesReajuste: unknown; indicesDoComparativo: unknown },
  visao: number,
  comComparado: boolean,
) {
  const prisma = getPrismaClient();
  const est = await estruturaDRE();
  const [reajuste, comparacao] = await Promise.all([indicesDeReajuste(prisma, c, est), comComparado ? indicesDeComparacao(prisma, c, est) : null]);
  const comObservacao = (i: { observacao: string | null }) => (i.observacao ? ` (${i.observacao})` : "");
  const dosReajustes = new Map(
    reajuste.indices.map((i) => [i.chave, { texto: i.descricao, dica: `${i.descricao}: ${i.reajustes.map((r) => `${pctDoIndice(Number(r.valor))} em ${rotuloMes(c.ano, r.mes)}`).join(", ")}${comObservacao(i)}` }]),
  );
  const dasComparacoes = new Map(
    (comparacao?.indices ?? []).map((i) => [
      i.chave,
      { texto: `${i.descricao} (${pctDoIndice(i.variacao)})`, dica: `${i.descricao}: variação máxima de ${pctDoIndice(i.variacao)}, para mais ou para menos${comObservacao(i)}` },
    ]),
  );
  return {
    aplicados: c.reajustesAplicados,
    reajuste: indicesDasLinhas(est, reajuste.universo, reajuste.porCelula, visao, (k) => dosReajustes.get(k) ?? null),
    comparacao: comparacao ? indicesDasLinhas(est, comparacao.universo, comparacao.porCelula, visao, (k) => dasComparacoes.get(k) ?? null) : null,
  };
}

type ComReajustes = { id: string; reajustesAplicados: boolean; indicesDosReajustes: unknown; aplicacaoDosReajustes: unknown };

/**
 * A soma das contas dadas na DRE gravada do cenário, nas unidades (o histórico do recálculo com os reajustes). As chaves são
 * as da Aplicação dos Reajustes: o código (todas as unidades) ou "unidade|código" (19/11/2026: os Custos de Produção da Matriz
 * e da Filial), só naquela unidade.
 */
async function somaDasContas(tx: Prisma.TransactionClient, cenarioId: string, est: Awaited<ReturnType<typeof estruturaDRE>>, chaves: Set<string>) {
  if (!chaves.size) return 0;
  const codigos = new Set([...chaves].map((c) => daChave(c).codigo));
  const codigoDe = new Map(est.filter((l) => codigos.has(l.codigo)).map((l) => [l.id, l.codigo]));
  const linhas = await tx.cenarioResultado.findMany({ where: { cenarioId, visao: { in: [...UNIDADES] }, linhaDREId: { in: [...codigoDe.keys()] } }, select: { linhaDREId: true, visao: true, valor: true } });
  return linhas.reduce((s, r) => {
    const codigo = codigoDe.get(r.linhaDREId)!;
    // A chave da conta, a da conta na unidade ou (21/11/2026) a da conta numa venda da unidade.
    return chaves.has(codigo) || chaves.has(`${r.visao}|${codigo}`) || [...chaves].some((k) => k.startsWith(`${r.visao}|`) && daChave(k).codigo === codigo) ? s + Number(r.valor) : s;
  }, 0);
}

/** O nome de uma conta da Aplicação dos Reajustes no histórico: a descrição e, nos Custos de Produção, a unidade e a venda. */
function nomeDaChave(chave: string, nome: Map<string, string>) {
  const { codigo, unidade, venda } = daChave(chave);
  const descricao = nome.get(codigo) ?? codigo;
  if (unidade === null) return descricao;
  const daUnidade = unidade === 1 ? "Matriz" : unidade === 2 ? "Filial" : `unidade ${unidade}`;
  return `${descricao} (${venda ? `${daUnidade} · ${venda === "GLOBAL" ? "Global" : "Mercantil"}` : daUnidade})`;
}

/**
 * O Recalcular com os reajustes mudados (21/11/2026: a caixa Aplicar Reajustes dos Resultados, ou os Índices de Reajuste gravados
 * com ela marcada): recalcula a DRE e registra no histórico (tela Histórico, aba Alterações) as contas com Índice de Reajuste e a
 * soma delas antes e depois do cálculo. `descricao` recebe o número dessas contas.
 */
async function recalcularComReajustes(tx: Prisma.TransactionClient, c: ComReajustes, usuario: Usuario, descricao: (contas: number) => string) {
  const est = await estruturaDRE();
  const nome = new Map(est.map((l) => [l.codigo, l.descricao]));
  const codigos = new Set((await fatoresDoCenario(tx, c, est)).keys());
  const somaAntes = await somaDasContas(tx, c.id, est, codigos);
  const { reajustes } = await calcularAnalitico(tx, c.id);
  const somaDepois = await somaDasContas(tx, c.id, est, codigos);
  await tx.cenarioReajuste.create({
    data: {
      cenarioId: c.id,
      usuarioId: usuario.id || null,
      usuarioNome: usuario.nome,
      tipo: "RECALCULO",
      descricao: descricao(codigos.size),
      contas: [...codigos].map((k) => ({ codigo: daChave(k).codigo, descricao: nomeDaChave(k, nome) })),
      meses: [...reajustes.meses].sort((a, b) => a - b),
      valores: codigos.size ? reajustes.valores : 0,
      somaAntes: codigos.size ? somaAntes : null,
      somaDepois: codigos.size ? somaDepois : null,
    },
  });
}

/** O texto do Recalcular no histórico (21/11/2026): as alterações recalculadas de cada tela. */
function textoDoRecalculo(p: ReturnType<typeof pendenciasDoRecalculo>, aplicados: boolean) {
  const itens = ([[p.configuracoes, "nas Configurações"], [p.premissas, "nas Premissas"], [p.reajustes, "nos Reajustes"]] as const).filter(([n]) => n > 0);
  const partes = itens.map(([n, onde], k) => (k === 0 ? `${n} ${n === 1 ? "alteração" : "alterações"} ${onde}` : `${n} ${onde}`));
  const lista = partes.length > 1 ? `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}` : (partes[0] ?? "");
  return `Recalculado (Resultados)${lista ? `: ${lista}` : " com as regras de rateio do cenário"}${aplicados ? ", com os reajustes aplicados" : ""}`;
}
const deContas = (n: number) => `${n} ${n === 1 ? "conta" : "contas"}`;

/** Recusa `acao` (congelar, marcar) com alterações ainda não recalculadas na DRE do analítico (21/11/2026). */
function exigirRecalculado(c: Parameters<typeof pendenciasDoRecalculo>[0], acao: string) {
  const { total } = pendenciasDoRecalculo(c);
  if (total)
    throw new CenarioError(409, `${total === 1 ? "Há 1 alteração pendente" : `Há ${total} alterações pendentes`} de recálculo: clique em “Recalcular”, nos Resultados, antes de ${acao}.`);
}

async function comparadoDe(c: { comparadoComId: string | null }) {
  return c.comparadoComId ? getPrismaClient().cenario.findUnique({ where: { id: c.comparadoComId }, select: { id: true, nome: true, ano: true, tipo: true, marcacao: true } }) : null;
}

/** O comparado nas respostas dos Resultados: o nome, o exercício e o rótulo das colunas dele (rotuloDoComparado, 23/11/2026). */
const comparadoDaResposta = (c: { nome: string; ano: number; marcacao: MarcacaoCenario | null } | null) => (c ? { nome: c.nome, ano: c.ano, rotulo: rotuloDoComparado(c) } : null);

/**
 * A DRE de um grupo de centros num cenário analítico (19/11/2026; 22/11/2026: também a do comparado), mês a mês: as contas do
 * grupo com valor em algum mês (os valores gravados, com as casas deles, como na DRE do cenário), o subtotal de cada atribuição e
 * o total de cada grupo da DRE, que somam as contas; e o Consolidado do cenário (as bases do % e do R$/m³).
 */
async function dreDoGrupo(cenarioId: string, grupo: string) {
  const prisma = getPrismaClient();
  const [linhas, gravados, consolidado, c, grupos] = await Promise.all([
    estrutura(),
    prisma.cenarioCentro.findMany({ where: { cenarioId, grupo, mes: { gte: 1, lte: 12 } }, select: { mes: true, valor: true, linhaDRE: { select: { codigo: true } } } }),
    dreDoCenario(cenarioId, 0),
    prisma.cenario.findUnique({ where: { id: cenarioId }, select: { reajustesCalculados: true } }),
    gruposDoCenario(cenarioId),
  ]);
  const porConta = new Map<string, number[]>();
  for (const r of gravados) {
    const lista = porConta.get(r.linhaDRE.codigo) ?? Array<number>(12).fill(0);
    lista[r.mes - 1] += Number(r.valor);
    porConta.set(r.linhaDRE.codigo, lista);
  }
  // Com a DRE calculada com os reajustes (22/11/2026, pedido do Adão), os valores do grupo com eles (reajustarOGrupo): os totais
  // batem com o Consolidado. A aba Centros de Custo das Premissas continua sem eles (a base digitada).
  const g = grupos.find((x) => x.grupo === grupo);
  const reajustado = !!c?.reajustesCalculados && !!g;
  return { valores: somarNoGrupo(linhas, reajustado ? await reajustarOGrupo(prisma, cenarioId, g!, porConta) : porConta, 12), consolidado, reajustado };
}

/**
 * Os valores de um grupo de centros por período (`n` períodos: os 12 meses, ou 1 na referência): cada conta com valor em algum
 * período, o subtotal da atribuição dela e o total do grupo da DRE dela, que somam as contas.
 */
function somarNoGrupo(linhas: Awaited<ReturnType<typeof estrutura>>, porConta: Map<string, number[]>, n: number) {
  const partes = (codigo: string) => codigo.split(".");
  const totais = linhas.filter((l) => l.tipo !== "ITEM" && l.tipo !== "SECAO");
  // A atribuição de uma conta (CPP.MOD.X → CPP.MOD.MAO_DE_OBRA_DIRETA) e o total do grupo da DRE (CPP → CPP.CUSTOS_…).
  const atribuicao = new Map(totais.filter((l) => partes(l.codigo).length === 3).map((l) => [partes(l.codigo).slice(0, 2).join("."), l.codigo]));
  const doGrupo = new Map(totais.filter((l) => partes(l.codigo).length === 2).map((l) => [partes(l.codigo)[0], l.codigo]));
  const valores = Array.from({ length: n }, () => new Map<string, number>());
  const somar = (codigo: string | undefined, k: number, v: number) => {
    if (codigo) valores[k].set(codigo, (valores[k].get(codigo) ?? 0) + v);
  };
  for (const [conta, periodos] of porConta) {
    if (periodos.every((v) => v === 0)) continue;
    periodos.forEach((v, k) => {
      somar(conta, k, v);
      somar(atribuicao.get(partes(conta).slice(0, 2).join(".")), k, v);
      somar(doGrupo.get(partes(conta)[0]), k, v);
    });
  }
  return valores;
}

/**
 * A Média de Referência de um grupo de centros × 12 (22/11/2026, pedido do Adão: o comparativo da aba Centros de Custo dos
 * Resultados quando o comparado é sintético, sem centros de custo): o mês 0 de cada conta do grupo (a média do realizado que a
 * Referência carregou, Configurações / Referência) vezes 12, com os subtotais. Sem as bases (a referência não tem o Consolidado):
 * o % e o R$/m³ ficam vazios. Null quando o cenário não tem Média de Referência em nenhum grupo.
 */
async function referenciaDoGrupo(cenarioId: string, grupo: string, linhas: Awaited<ReturnType<typeof estrutura>>) {
  const prisma = getPrismaClient();
  const [temReferencia, gravados] = await Promise.all([
    prisma.cenarioCentro.count({ where: { cenarioId, mes: 0, valor: { not: 0 } } }),
    prisma.cenarioCentro.findMany({ where: { cenarioId, grupo, mes: 0 }, select: { valor: true, linhaDRE: { select: { codigo: true } } } }),
  ]);
  if (!temReferencia) return null;
  const porConta = new Map<string, number[]>();
  for (const r of gravados) porConta.set(r.linhaDRE.codigo, [(porConta.get(r.linhaDRE.codigo)?.[0] ?? 0) + Number(r.valor) * 12]);
  return new Map(
    montar(linhas, "centros", [true], somarNoGrupo(linhas, porConta, 1), [new Map()], ACESSO_TOTAL)
      .filter((l) => l.tipo !== "SECAO")
      .map((l) => [l.codigo, l.total as CelulaTotal]),
  );
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
  await carregarNomesDoSistema();
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
      // Os nomes antigos dos indicadores renomeados (19/11/2026) recusam o arquivo: ele muda antes de importar.
      else if (metas.nomesAntigos.length)
        throw new CenarioError(
          400,
          `A aba ${abaMetas} tem ${metas.nomesAntigos.length === 1 ? "um nome antigo de indicador" : `${metas.nomesAntigos.length} nomes antigos de indicadores`} (o nome antigo → o atual): ${metas.nomesAntigos.slice(0, 6).join("; ")}${metas.nomesAntigos.length > 6 ? "…" : ""}. Mude os nomes no arquivo e importe de novo.`,
        );
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
/**
 * O valor de uma linha da planilha como `aplicarMudancas` o grava e a tela o lê de volta (22/11/2026): as premissas (P, E, B e X)
 * com 6 casas, os centros (C) com 4 — o zero apaga, e o mês fica em branco — e os indicadores (I) com 8.
 */
function comoGravado(chave: string, valor: number): number | null {
  const tipo = chave.split("|")[0];
  const casas = tipo === "C" ? 4 : tipo === "I" ? 8 : 6;
  const v = Number(valor.toFixed(casas));
  return tipo === "C" && v === 0 ? null : v;
}
const MESES_1_A_12 = Array.from({ length: 12 }, (_, k) => k + 1);

/**
 * As linhas dos Salários de um grupo (12/11/2026, pedido do Adão; antes, os Salários dos Aprendizes e dos Estagiários de cada
 * mão de obra): uma por tipo de colaborador, como os Colaboradores — o tipo, o sufixo da chave da planilha (L|grupo|…), o
 * rótulo e o Tipo das linhas da aba Quadro de Lotação que ela soma no Excel.
 */
const SALARIOS_DO_QUADRO: Array<{ tipo: TipoDeColaborador; sufixo: string; rotulo: string; filtro: { tipo: TipoDoColaborador } }> = [
  { tipo: "aprendizes", sufixo: "SALARIOS_APRENDIZES", rotulo: "Salários dos Aprendizes", filtro: { tipo: "APRENDIZ" } },
  { tipo: "estagiarios", sufixo: "SALARIOS_ESTAGIARIOS", rotulo: "Salários dos Estagiários", filtro: { tipo: "ESTAGIARIO" } },
  { tipo: "clt", sufixo: "SALARIOS_CLT", rotulo: "Salários CLT", filtro: { tipo: "CLT" } },
  { tipo: "pj", sufixo: "SALARIOS_PJ", rotulo: "Salários PJ", filtro: { tipo: "PJ" } },
];
/** As linhas dos Salários de antes (as de cada mão de obra, "Salários dos Aprendizes (CPP.MOD)"): calculadas, a importação as ignora. */
const SALARIOS_POR_MAO_DE_OBRA = /^Salários dos (Aprendizes|Estagiários) \(.+\)$/;

/** A referência carregada no cenário analítico (11/11/2026): o realizado (o ano e os meses do período) ou o cenário de origem. */
export type DetalheDaReferencia = { tipo: "REALIZADO"; ano: number; meses: number[] } | { tipo: "CENARIO"; cenarioId: string };

/**
 * Os meses da referência do cenário para o Exportar Premissas (11/11/2026, pedido do Adão): com as mesmas chaves das
 * tabelas do cenário (as premissas "unidade|venda|chave|mes", os centros "grupo|conta|mes" e os indicadores "nome|mes"), as
 * linhas do Quadro de Lotação de origem (os Salários dos Aprendizes) e a coluna da aba Quadro de Lotação.
 */
type FontesDaReferencia = {
  /** O prefixo das colunas ("Realizado" ou "Referência") e os rótulos dos meses ("JAN/26"). */
  rotulo: string;
  meses: string[];
  /** Para a explicação da aba: "o resultado realizado de 2026 (01 a 09)" ou "o Cenário X VER00 (2026)". */
  descricao: string;
  prem: Map<string, number>;
  cen: Map<string, number>;
  ind: Map<string, number>;
  linhasDoQuadro: LinhaDoQuadro[] | null;
  /**
   * A coluna da aba Quadro de Lotação: os colaboradores do QL Realizado da competência mais recente ou do último mês do cenário
   * de origem (17/11/2026, pedido do Adão: só a quantidade de colaboradores, sem os salários na referência).
   */
  colunaDoQuadro: { rotulo: string; daLinha: (l: CadastrosDaLinhaDoQuadro) => number } | null;
};

/**
 * A referência carregada no cenário: a gravada (desde 11/11/2026) ou, nas carregadas antes, a do nome dela (o nomeArquivo:
 * "Resultado realizado de 2026 (01 a 09)", "Médias do realizado de 2026 (03 a 05)" ou "Cenário X VER00 (2026)").
 */
async function detalheDaReferencia(c: { id: string; ano: number; nomeArquivo: string | null; referenciaDetalhe: unknown }): Promise<DetalheDaReferencia | null> {
  const d = c.referenciaDetalhe as Partial<DetalheDaReferencia> | null;
  if (d?.tipo === "REALIZADO" && typeof d.ano === "number" && Array.isArray(d.meses)) return { tipo: "REALIZADO", ano: d.ano, meses: d.meses };
  if (d?.tipo === "CENARIO" && typeof d.cenarioId === "string") return { tipo: "CENARIO", cenarioId: d.cenarioId };
  const nome = c.nomeArquivo?.trim() ?? "";
  // (Também o nome antigo da média: "Média do realizado de 2026 (01 a 08), nos 12 meses".)
  const r = /^(?:Resultado realizado|Médias? do realizado) de (\d{4}) \((\d{2})(?: a (\d{2}))?\)(?:, nos 12 meses)?$/.exec(nome);
  if (r) {
    const [de, ate] = [Number(r[2]), Number(r[3] ?? r[2])];
    return { tipo: "REALIZADO", ano: Number(r[1]), meses: Array.from({ length: ate - de + 1 }, (_, k) => de + k) };
  }
  const x = /^Cenário (.+) VER(\d+)(?: \((\d{4})\))?$/.exec(nome);
  if (x) {
    const origem = await getPrismaClient().cenario.findFirst({
      where: { id: { not: c.id }, tipo: "ANALITICO", nome: x[1], versao: Number(x[2]), ano: x[3] ? Number(x[3]) : c.ano },
      select: { id: true },
      orderBy: { criadoEm: "desc" },
    });
    if (origem) return { tipo: "CENARIO", cenarioId: origem.id };
  }
  return null;
}

type CadastrosDaLinhaDoQuadro = { unidadeNegocioId: string; vinculo: string; funcaoId: string; centroCustoId: string };

/**
 * Os colaboradores de cada linha do Quadro de Lotação na referência do cenário (11/11/2026, a coluna da aba Quadro de Lotação
 * do Exportar Premissas; 16/11/2026, também a coluna Colab. Ref. da tela e o Replicar Referências dela): da referência
 * realizada, o QL Realizado da competência mais recente da Gestão de Colaboradores (pelo centro, o tipo e a função); de outro
 * cenário, os colaboradores do último mês do Quadro de Lotação dele (pelos cadastros da linha). A linha que não está lá fica
 * nula. Nula sem referência (ou sem o quadro dela). Só a quantidade de colaboradores (17/11/2026, pedido do Adão: sem os salários
 * do Lançamento Inicial na referência).
 */
async function colunaDoQuadroDe(detalhe: DetalheDaReferencia | null, cenarioId: string): Promise<{ rotulo: string; daLinha: (l: CadastrosDaLinhaDoQuadro) => number | null } | null> {
  if (!detalhe) return null;
  const prisma = getPrismaClient();
  // O centro de cada linha é o da cópia do cenário (20/11/2026, Cadastros por cenário): o centro de origem dele (ou, sem ela, o
  // código) o acha no QL Realizado e nas linhas do outro cenário.
  const meus = await prisma.cenarioCentroCusto.findMany({ where: { cenarioId }, select: { id: true, origemId: true, codigoRM: true } });
  const doCentro = new Map(meus.map((x) => [x.id, x]));
  const identidade = (c: { origemId: string | null; codigoRM: string | null } | undefined) => (c ? (c.origemId ?? `codigo:${c.codigoRM ?? ""}`) : "");
  if (detalhe.tipo === "CENARIO") {
    const origem = await prisma.cenario.findUnique({ where: { id: detalhe.cenarioId }, select: { id: true, ano: true, tipo: true } });
    if (!origem || origem.tipo !== "ANALITICO") return null;
    const lotacao = await prisma.cenarioLotacao.findMany({
      where: { cenarioId: origem.id },
      select: { unidadeNegocioId: true, vinculo: true, funcaoId: true, meses: true, centroCusto: { select: { origemId: true, codigoRM: true } } },
    });
    const chave = (l: Omit<CadastrosDaLinhaDoQuadro, "centroCustoId">, centro: string) => `${l.unidadeNegocioId}|${l.vinculo}|${l.funcaoId}|${centro}`;
    const doUltimo = new Map<string, number>();
    for (const l of lotacao) {
      const k = chave(l, identidade(l.centroCusto));
      doUltimo.set(k, (doUltimo.get(k) ?? 0) + (mesesDaLinha(l.meses)[11]?.colaboradores ?? 0));
    }
    return { rotulo: `Colaboradores da Referência (${rotuloMes(origem.ano, 12)})`, daLinha: (l) => doUltimo.get(chave(l, identidade(doCentro.get(l.centroCustoId)))) ?? null };
  }
  const ql = await quadroRealizadoMaisRecente(prisma);
  if (!ql) return null;
  const chave = (l: CadastrosDaLinhaDoQuadro) => chaveDaLinhaDoQuadro({ centroCustoId: doCentro.get(l.centroCustoId)?.origemId ?? "", vinculo: l.vinculo, funcaoId: l.funcaoId });
  return { rotulo: `QL Realizado (${String(ql.mes).padStart(2, "0")}/${ql.ano})`, daLinha: (l) => ql.final.get(chave(l)) ?? null };
}

/**
 * Os meses da referência (11/11/2026). Do realizado: cada mês fechado do período calculado como a referência de um mês só
 * (a média de um mês é o realizado dele: as premissas das unidades, os centros com as realocações decididas, a depreciação
 * base e o extra-operacional), os Benefícios Adicionais (a diferença dos encargos), o quadro de lotação dos grupos (as
 * listas) e os indicadores realizados — como a referência Mês a Mês; na aba Quadro de Lotação, o QL Realizado da competência
 * mais recente da Gestão de Colaboradores. De outro cenário: os doze meses dele, como estão; na aba Quadro de Lotação, os
 * colaboradores do último mês dele. Nula sem referência (ou sem nada dela).
 */
async function fontesDaReferencia(c: { id: string; ano: number; nomeArquivo: string | null; referenciaDetalhe: unknown; realocacoes: unknown }): Promise<FontesDaReferencia | null> {
  const detalhe = await detalheDaReferencia(c);
  if (!detalhe) return null;
  const prisma = getPrismaClient();
  const somar = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  if (detalhe.tipo === "CENARIO") {
    const origem = await prisma.cenario.findUnique({ where: { id: detalhe.cenarioId }, select: { id: true, nome: true, versao: true, ano: true, tipo: true } });
    if (!origem || origem.tipo !== "ANALITICO") return null;
    const [premissas, centros, indicadores, quadro, coluna] = await Promise.all([
      prisma.cenarioPremissa.findMany({ where: { cenarioId: origem.id, mes: { gte: 1 } } }),
      prisma.cenarioCentro.findMany({ where: { cenarioId: origem.id, mes: { gte: 1 } }, include: { linhaDRE: { select: { codigo: true } } } }),
      prisma.cenarioIndicador.findMany({ where: { cenarioId: origem.id, mes: { gte: 1 } } }),
      linhasDoQuadro(prisma, origem.id),
      // Os colaboradores do último mês do Quadro de Lotação de origem, pelos cadastros da linha.
      colunaDoQuadroDe(detalhe, c.id),
    ]);
    return {
      rotulo: "Referência",
      meses: MESES_1_A_12.map((m) => rotuloMes(origem.ano, m)),
      descricao: `o Cenário ${origem.nome} ${rotuloVersao(origem.versao)} (${origem.ano})`,
      prem: new Map(premissas.map((p) => [`${p.unidade}|${p.venda}|${p.chave}|${p.mes}`, Number(p.valor)])),
      cen: new Map(centros.map((x) => [`${x.grupo}|${x.linhaDRE.codigo}|${x.mes}`, Number(x.valor)])),
      ind: new Map(indicadores.map((i) => [`${i.nome}|${i.mes}`, Number(i.valor)])),
      linhasDoQuadro: quadro,
      colunaDoQuadro: coluna ? { rotulo: coluna.rotulo, daLinha: (l) => coluna.daLinha(l) ?? 0 } : null,
    };
  }
  const { ano } = detalhe;
  const fechadas = await prisma.competencia.findMany({ where: { ano, mes: { in: detalhe.meses }, status: "FECHADA" }, select: { id: true, mes: true }, orderBy: { mes: "asc" } });
  const decisoes = lerRealocacoes(c.realocacoes).decisoes;
  const prem = new Map<string, number>();
  const cen = new Map<string, number>();
  const ind = new Map<string, number>();
  // Os grupos da cópia dos Centros de Custo do cenário (20/11/2026, Cadastros por cenário).
  const gruposDoC = await gruposDoCenario(c.id);
  // As Redistribuições de Gastos da cópia do cenário (20/11/2026, etapa 2).
  const regrasDoC = await regrasDoCenario(c.id);
  for (const f of fechadas) {
    const ref = await referenciaDoRealizado(ano, [f.mes], decisoes, gruposDoC, regrasDoC);
    for (const p of ref.premissas) prem.set(`${p.unidade}|${p.venda}|${p.chave}|${f.mes}`, p.valor);
    for (const x of ref.mensais) somar(prem, `${x.unidade}|${x.venda}|${x.chave}|${x.mes}`, x.valor);
    for (const x of ref.centros) somar(cen, `${x.grupo}|${x.codigo}|${x.mes}`, x.valor);
  }
  if (fechadas.length) {
    const [est, grupos] = [await estruturaDRE(), gruposDoC];
    // Os Benefícios Adicionais de cada mês: a diferença entre os encargos realizados e o cálculo com os percentuais padrão.
    const vendaDosBeneficios = itemDosEncargos("BENEFICIOS")!.venda;
    for (const g of grupos) {
      const codigos = contasDoGrupo(est, g).map((l) => l.codigo);
      for (const f of fechadas) {
        const v = beneficiosDaDiferenca(codigos, g.atribuicao, (codigo) => cen.get(`${g.grupo}|${codigo}|${f.mes}`) ?? 0);
        if (Math.abs(v) >= 0.005) prem.set(`0|${vendaDosBeneficios}|${g.grupo}|${f.mes}`, v);
      }
    }
    // Os indicadores realizados dos meses (sem os de quadro de lotação, como na referência).
    const realizados = await indicadoresService.listar(ano, fechadas[fechadas.length - 1].mes, true);
    for (const i of realizados.indicadores) {
      if (QUADROS_DE_LOTACAO.has(i.nome)) continue;
      i.meses.forEach((v, k) => {
        if (v !== null && Number.isFinite(v) && fechadas.some((f) => f.mes === k + 1)) ind.set(`${i.nome}|${k + 1}`, v);
      });
    }
  }
  // Os colaboradores dos grupos em cada mês (12/11/2026: a Gestão de Colaboradores é a única fonte; antes, as listas do
  // Quadro de Lotação do Fechamento Mensal): o QL Realizado do fim do mês, nos meses com a competência do Quadro de Lotação.
  for (const [mes, doMes] of await colaboradoresRealizados(ano, detalhe.meses, gruposDoC)) for (const [k, n] of doMes) prem.set(`0|${k}|${mes}`, n);
  // O QL Realizado da competência mais recente do Quadro de Lotação (Gestão de Colaboradores).
  const coluna = await colunaDoQuadroDe(detalhe, c.id);
  const periodo = detalhe.meses.length ? `${String(detalhe.meses[0]).padStart(2, "0")}${detalhe.meses.length > 1 ? ` a ${String(detalhe.meses[detalhe.meses.length - 1]).padStart(2, "0")}` : ""}` : "";
  return {
    rotulo: "Realizado",
    meses: MESES_1_A_12.map((m) => rotuloMes(ano, m)),
    descricao: `o resultado realizado de ${ano}${periodo ? ` (${periodo})` : ""}`,
    prem,
    cen,
    ind,
    linhasDoQuadro: null,
    colunaDoQuadro: coluna ? { rotulo: coluna.rotulo, daLinha: (l) => coluna.daLinha(l) ?? 0 } : null,
  };
}

/**
 * Os colaboradores realizados de cada grupo de centros nos meses de um exercício (12/11/2026, pedido do Adão: a Gestão de
 * Colaboradores é a única fonte da contagem dos cenários analíticos): o QL Realizado do fim de cada mês com a competência do
 * Quadro de Lotação, pelos centros dos grupos e pelo Tipo (Aprendizes, Estagiários, CLT e PJ), como a aba Quadro de Lotação
 * do cenário. Devolve mês → ("VENDA|grupo" → colaboradores).
 */
async function colaboradoresRealizados(ano: number, meses: number[], grupos: GrupoDoCenario[]) {
  const prisma = getPrismaClient();
  const { quadros } = await quadrosRealizadosPorLinha(prisma);
  const doPeriodo = quadros.filter((q) => q.ano === ano && meses.includes(q.mes));
  const r = new Map<number, Map<string, number>>();
  if (!doPeriodo.length) return r;
  // O QL Realizado é dos centros dos Cadastros Gerais: o grupo da cópia de cada um no cenário (20/11/2026, pelo centro de origem).
  const grupoDaOrigem = new Map(grupos.flatMap((g) => g.centros.flatMap((x) => (x.origemId ? [[x.origemId, g.grupo] as const] : []))));
  const vendaDo: Record<TipoDeColaborador, string> = {
    aprendizes: VENDA_LOTACAO_APRENDIZ,
    estagiarios: VENDA_LOTACAO_ESTAGIARIO,
    clt: VENDA_LOTACAO_CLT,
    pj: VENDA_LOTACAO_PJ,
  };
  for (const q of doPeriodo) {
    const doMes = new Map<string, number>();
    for (const [k, n] of q.final) {
      const [centroId, vinculo] = k.split("|");
      const grupo = grupoDaOrigem.get(centroId);
      if (!n || !grupo || !TIPOS_DO_COLABORADOR.includes(vinculo as TipoDoColaborador)) continue;
      const venda = vendaDo[tipoDaLinha({ vinculo: vinculo as TipoDoColaborador })];
      doMes.set(`${venda}|${grupo}`, (doMes.get(`${venda}|${grupo}`) ?? 0) + n);
    }
    r.set(q.mes, doMes);
  }
  return r;
}

/**
 * As linhas da planilha das premissas de um cenário analítico (15/10/2026): as premissas das unidades (por venda), o
 * quadro de lotação e as contas de cada grupo de centros de custo, a depreciação base, o extra-operacional e os
 * indicadores manuais, com a Média de Referência (o mês 0), os doze meses gravados (em branco: null), a variação máxima
 * da conta (do Comparativo) e a justificativa. Com `fonte` (11/11/2026), também os meses da referência de cada linha
 * (`referencia`), pelas mesmas chaves.
 */
async function linhasDaPlanilha(c: { id: string } & ComVariacoes, fonte: FontesDaReferencia | null = null): Promise<LinhaDaPlanilha[]> {
  const prisma = getPrismaClient();
  const [est, cadastro, premissas, centros, indicadores, grupos, justificativas, calculo, linhasDoQuadroDoCenario] = await Promise.all([
    estruturaDRE(),
    linhasDoCadastro(),
    prisma.cenarioPremissa.findMany({ where: { cenarioId: c.id } }),
    prisma.cenarioCentro.findMany({ where: { cenarioId: c.id }, include: { linhaDRE: { select: { codigo: true } } } }),
    prisma.cenarioIndicador.findMany({ where: { cenarioId: c.id } }),
    gruposDoCenario(c.id),
    prisma.cenarioPremissaJustificativa.findMany({ where: { cenarioId: c.id } }),
    calcularCenario(c.id),
    linhasDoQuadro(prisma, c.id),
  ]);
  // Os grupos com linhas no Quadro de Lotação do cenário (09/11/2026): os colaboradores, os salários e as remunerações calculados.
  const quadro = quadroDosGrupos(linhasDoQuadroDoCenario, grupos);
  // Os grupos com a mão de obra das médias (22/11/2026, maoDeObraDasMedias.ts): as Remunerações e os Encargos gravados pelo Replicar
  // Médias, sem a fórmula do Quadro de Lotação e sem os Benefícios Padrão.
  const dasMedias = gruposDasMedias(await marcadoresDasMedias(prisma, c.id), quadro).validos;
  // A variação máxima de cada conta: a do Índice de Comparação dela na unidade (21/11/2026: pelas combinações dos índices); nas
  // linhas de uma unidade (as premissas, a depreciação base e o extra-operacional: P|, B| e X|unidade|…), a da unidade; nas outras
  // (as dos centros de custo), a maior das unidades.
  const limites = await limitesDasCelulas(prisma, c, est);
  const limiteDa = (conta: string | null, chave: string) => {
    const u = /^[PBX]\|(\d+)\|/.exec(chave)?.[1];
    return conta ? limiteNaVisao(limites, conta, u ? Number(u) : null) : null;
  };
  const justificativa = new Map(justificativas.map((j) => [j.chave, j.texto]));
  const doze = (ler: (mes: number) => number | undefined) => MESES_1_A_12.map((m) => ler(m) ?? null);
  const linhas: LinhaDaPlanilha[] = [];
  const add = (l: Omit<LinhaDaPlanilha, "limite" | "justificativa">) => linhas.push({ ...l, limite: limiteDa(l.conta, l.chave), justificativa: justificativa.get(l.chave) ?? null });
  const prem = new Map(premissas.map((p) => [`${p.unidade}|${p.venda}|${p.chave}|${p.mes}`, Number(p.valor)]));
  // Os meses da referência (11/11/2026): as mesmas chaves, nas tabelas da referência.
  const refP = (chave: string) => (fonte ? doze((mes) => fonte.prem.get(`${chave}|${mes}`)) : undefined);
  const refI = (nome: string) => (fonte ? doze((mes) => fonte.ind.get(`${nome}|${mes}`)) : undefined);
  const quadroDaReferencia = fonte?.linhasDoQuadro ? quadroDosGrupos(fonte.linhasDoQuadro, grupos) : null;
  for (const u of UNIDADES_PREMISSAS) {
    for (const venda of VENDAS_DA_UNIDADE[u]) {
      for (const l of linhasDaTabela(est, cadastro, u).filter((x) => x.tipo === "PREMISSA")) {
        const ler = (mes: number) => prem.get(`${u}|${venda}|${l.chave}|${mes}`);
        const conta = contaDaPremissa(l.chave);
        add({
          aba: String(u) as AbaDasPremissas,
          chave: `P|${u}|${venda}|${l.chave}`,
          descricao: [NOME_DA_VENDA[venda], l.secao, l.grupo ?? "", l.rotulo],
          und: l.und,
          conta,
          media: ler(0) ?? null,
          meses: doze(ler),
          referencia: refP(`${u}|${venda}|${l.chave}`),
        });
      }
    }
  }
  const cen = new Map(centros.map((x) => [`${x.grupo}|${x.linhaDRE.codigo}|${x.mes}`, Number(x.valor)]));
  const totais = est.filter((l) => l.tipo !== "ITEM");
  for (const g of [...grupos].sort((a, b) => a.grupo.localeCompare(b.grupo, "pt-BR"))) {
    // O Quadro de Lotação (19/10/2026: Colaboradores CLT e PJ e o Total, em fórmula) e os Encargos e Benefícios (os
    // percentuais em fração; o mês em branco vale a Média de Referência, o padrão). Nos grupos com linhas na aba Quadro de
    // Lotação (11/11/2026), também os Colaboradores Aprendizes e Estagiários, antes dos CLT (calculados).
    const q = quadro.get(g.grupo);
    // A mão de obra das médias do grupo (22/11/2026): os valores gravados, sem o Quadro de Lotação nas Remunerações, nos Encargos e
    // nos Benefícios Padrão.
    const dasMediasNoGrupo = dasMedias.has(g.grupo);
    // Os centros do grupo (11/11/2026): as fórmulas do Excel sobre a aba Quadro de Lotação.
    const codigos = g.centros.flatMap((x) => (x.codigo ? [x.codigo] : []));
    const maosDoGrupo = maosDeObraDoGrupo(contasDoGrupo(est, g).map((l) => l.codigo), g.atribuicao);
    // Os colaboradores de todos os grupos (12/11/2026, pedido do Adão: a Gestão de Colaboradores, pela aba Quadro de Lotação, é
    // a única fonte da contagem; antes, nos grupos sem linhas, digitados): em fórmula sobre a aba do arquivo, que não se importa.
    const doQuadroDa = (sufixo: string): LinhaDaPlanilha["doQuadro"] => ({
      centros: codigos,
      tipo: sufixo === "APRENDIZES" ? "APRENDIZ" : sufixo === "ESTAGIARIOS" ? "ESTAGIARIO" : sufixo === "CLT" ? "CLT" : "PJ",
      soma: "COLABORADORES",
    });
    const lotacoes = [
      [VENDA_LOTACAO_APRENDIZ, "APRENDIZES", "Colaboradores Aprendizes"],
      [VENDA_LOTACAO_ESTAGIARIO, "ESTAGIARIOS", "Colaboradores Estagiários"],
      [VENDA_LOTACAO_CLT, "CLT", "Colaboradores CLT"],
      [VENDA_LOTACAO_PJ, "PJ", "Colaboradores PJ"],
    ] as const;
    for (const [venda, sufixo, rotulo] of lotacoes) {
      const ler = (mes: number) => prem.get(`0|${venda}|${g.grupo}|${mes}`);
      add({
        aba: "centros",
        grupo: g.grupo,
        chave: `L|${g.grupo}|${sufixo}`,
        descricao: [g.grupo, "Quadro de Lotação", rotulo],
        und: "colab.",
        conta: null,
        media: ler(0) ?? null,
        meses: doze(ler),
        calculada: true,
        doQuadro: doQuadroDa(sufixo),
        referencia: refP(`0|${venda}|${g.grupo}`),
      });
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
      // A soma das linhas acima (os Aprendizes e os Estagiários, nos grupos com linhas no Quadro de Lotação).
      formula: (ref) => lotacoes.map(([, sufixo]) => `N(${ref(`L|${g.grupo}|${sufixo}`)})`).join("+"),
      // O total da referência: a soma dos colaboradores dela.
      referencia: fonte
        ? doze((mes) => {
            const vs = VENDAS_LOTACAO.map((v) => fonte.prem.get(`0|${v}|${g.grupo}|${mes}`));
            return vs.every((v) => v === undefined) ? undefined : vs.reduce<number>((s, v) => s + (v ?? 0), 0);
          })
        : undefined,
    });
    // Os Salários de cada tipo de colaborador (12/11/2026, pedido do Adão; antes, os dos Aprendizes e dos Estagiários de cada
    // mão de obra), em todos os grupos (sem linhas, em branco): no Excel, a soma da aba Quadro de Lotação do arquivo; deles
    // saem as Remunerações e, os dos Aprendizes e dos Estagiários, os Encargos e Benefícios.
    const daReferencia = quadroDaReferencia?.get(g.grupo);
    for (const s of SALARIOS_DO_QUADRO)
      add({
        aba: "centros",
        grupo: g.grupo,
        chave: `L|${g.grupo}|${s.sufixo}`,
        descricao: [g.grupo, "Quadro de Lotação", s.rotulo],
        und: "R$",
        conta: null,
        media: null,
        meses: doze((mes) => q?.salarios[s.tipo][mes - 1]),
        calculada: true,
        doQuadro: { centros: codigos, ...s.filtro, soma: "SALARIOS" },
        referencia: fonte ? doze((mes) => daReferencia?.salarios[s.tipo][mes - 1]) : undefined,
      });
    const salario = (ref: (chave: string) => string, tipo: TipoDeColaborador) => `N(${ref(`L|${g.grupo}|${SALARIOS_DO_QUADRO.find((s) => s.tipo === tipo)!.sufixo}`)})`;
    // A conta Encargos e Benefícios que leva os Benefícios Adicionais (17/11/2026, pedido do Adão): vai sem eles, e a linha
    // dos Benefícios Adicionais soma nela no Consolidado (a DRE da conta é a soma das duas).
    const contaDosBeneficios = maosDoGrupo.find((m) => m.beneficios)?.encargos ?? null;
    const vendaDosBeneficios = itemDosEncargos("BENEFICIOS")!.venda;
    for (const i of ITENS_DOS_ENCARGOS) {
      // Os Benefícios Padrão (21/11/2026): a soma dos Benefícios das linhas dos centros do grupo na aba Quadro de Lotação; no
      // Excel, em fórmula sobre a aba Quadro de Lotação do arquivo. Calculados (não se importam), somam na conta no Consolidado.
      if (i.calculado) {
        add({
          aba: "centros",
          grupo: g.grupo,
          chave: `E|${g.grupo}|${i.item}`,
          descricao: [g.grupo, "Encargos e Benefícios", i.rotulo],
          und: i.und,
          conta: null,
          media: null,
          meses: doze((mes) => (dasMediasNoGrupo ? undefined : q?.beneficios[mes - 1])),
          calculada: true,
          ...(dasMediasNoGrupo ? {} : { doQuadro: { centros: codigos, tipo: null, soma: "BENEFICIOS" as const } }),
          ...(contaDosBeneficios ? { somaNaConta: contaDosBeneficios } : {}),
        });
        continue;
      }
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
        referencia: refP(`0|${i.venda}|${g.grupo}`),
        ...(i.venda === vendaDosBeneficios && contaDosBeneficios ? { somaNaConta: contaDosBeneficios } : {}),
      });
    }
    const maos = new Map(maosDoGrupo.map((m) => [m.encargos, m]));
    // As Remunerações CLT e PJ vêm da aba Quadro de Lotação (09/11/2026, nos grupos com linhas; 11/11/2026, pedido do Adão, em
    // todos): calculadas — desde 12/11/2026, na mão de obra principal, a soma das linhas dos Salários (CLT: Aprendizes,
    // Estagiários e CLT; PJ: PJ); na outra, zero. Na mão de obra das médias (22/11/2026), calculadas também (não se digitam nem
    // se importam), mas com os valores que o Replicar Médias gravou, sem fórmula.
    const remuneracaoDa = new Map(
      maosDoGrupo.flatMap((m) => [
        [m.remuneracoes, (ref: (chave: string) => string) => (m.principal ? (["aprendizes", "estagiarios", "clt"] as const).map((t) => salario(ref, t)).join("+") : "0")],
        [m.remuneracoesPJ, (ref: (chave: string) => string) => (m.principal ? salario(ref, "pj") : "0")],
      ]),
    );
    for (const l of contasDoGrupo(est, g)) {
      const atribuicao = totais.find((t) => t.codigo.startsWith(`${l.codigo.split(".").slice(0, 2).join(".")}.`))?.descricao ?? l.atribuicao ?? "";
      // Na conta dos Benefícios Adicionais (17/11/2026), o valor gravado menos eles (no cenário e na referência).
      const semBeneficios = (v: number | undefined, beneficios: number | undefined) => (v === undefined || l.codigo !== contaDosBeneficios ? v : v - (beneficios ?? 0));
      // Sem os Benefícios Adicionais e (21/11/2026) os Benefícios Padrão do grupo: as linhas deles ficam à parte.
      const ler = (mes: number) =>
        semBeneficios(cen.get(`${g.grupo}|${l.codigo}|${mes}`), (prem.get(`0|${vendaDosBeneficios}|${g.grupo}|${mes}`) ?? 0) + (mes >= 1 && !dasMediasNoGrupo ? (q?.beneficios[mes - 1] ?? 0) : 0));
      // A conta Encargos e Benefícios é calculada (19/10/2026): em fórmula, das Remunerações CLT, das Horas Extras e dos
      // Encargos e Benefícios do grupo; o mês em branco dos percentuais vale a Média de Referência (o padrão).
      const mo = maos.get(l.codigo);
      // Na mão de obra das médias (22/11/2026), sem fórmula: os valores gravados.
      const formula: LinhaDaPlanilha["formula"] = dasMediasNoGrupo
        ? undefined
        : mo
        ? (ref, doQuadroNoMes) => {
            const item = (x: string) => `IF(${ref(`E|${g.grupo}|${x}`)}="",${ref(`E|${g.grupo}|${x}`, true)},${ref(`E|${g.grupo}|${x}`)})`;
            // 20/10/2026: com o INSS e o FGTS também sobre as férias e o décimo terceiro.
            const [folha, provisoes] = [`(${item("INSS")}+${item("FGTS")})`, `(${item("FERIAS")}+${item("DECIMO_TERCEIRO")})`];
            // Os Salários dos Aprendizes e dos Estagiários do grupo (12/11/2026: as linhas dos Salários), só na mão de obra principal.
            // 09/11/2026: o FGTS Aprendiz sobre os salários dos aprendizes (a diferença para o FGTS CLT).
            const aprendizes = mo.principal ? `+(${item("FGTS_APRENDIZ")}-${item("FGTS")})*${salario(ref, "aprendizes")}*(1+${provisoes})` : "";
            // 11/11/2026: os salários dos estagiários saem da base (sem INSS, FGTS, férias com o terço e 13º).
            const estagiarios = mo.principal ? `-${salario(ref, "estagiarios")}` : "";
            // 17/11/2026: sem os Benefícios Adicionais (a linha deles fica à parte; a soma das duas é a conta na DRE).
            return `(N(${ref(`C|${g.grupo}|${mo.remuneracoes}`)})+N(${ref(`C|${g.grupo}|${mo.horasExtras}`)})${estagiarios})*(${folha}+${provisoes}+${folha}*${provisoes})${aprendizes}`;
          }
        : remuneracaoDa.get(l.codigo);
      add({
        aba: "centros",
        grupo: g.grupo,
        chave: `C|${g.grupo}|${l.codigo}`,
        descricao: [g.grupo, atribuicao, l.descricao],
        und: "R$",
        conta: l.codigo,
        media: ler(0) ?? null,
        meses: doze(ler),
        calculada: !!mo || remuneracaoDa.has(l.codigo),
        formula,
        referencia: fonte ? doze((mes) => semBeneficios(fonte.cen.get(`${g.grupo}|${l.codigo}|${mes}`), fonte.prem.get(`0|${vendaDosBeneficios}|${g.grupo}|${mes}`))) : undefined,
      });
    }
  }
  for (const d of CONTAS_DEPRECIACAO) {
    const chave = `${d.unidade}|${d.conta}`;
    const ler = (mes: number) => prem.get(`${d.unidade}|${VENDA_BASE}|${chave}|${mes}`);
    add({ aba: "investimentos", chave: `B|${chave}`, descricao: [d.nomeUnidade, d.rotulo], und: "R$", conta: d.conta, media: ler(0) ?? null, meses: doze(ler), referencia: refP(`${d.unidade}|${VENDA_BASE}|${chave}`) });
  }
  for (const u of UNIDADES_EXTRA) {
    for (const l of contasExtra(est, u.unidade)) {
      const chave = `${u.unidade}|${l.codigo}`;
      const secao = est.find((t) => t.tipo !== "ITEM" && t.grupoSigla === l.grupoSigla && t.codigo.split(".").length >= 2)?.descricao ?? l.grupoSigla;
      const ler = (mes: number) => prem.get(`${u.unidade}|${VENDA_EXTRA}|${chave}|${mes}`);
      add({ aba: "extra", chave: `X|${chave}`, descricao: [u.nome, secao, l.descricao], und: "R$", conta: l.codigo, media: ler(0) ?? null, meses: doze(ler), referencia: refP(`${u.unidade}|${VENDA_EXTRA}|${chave}`) });
    }
  }
  const ind = new Map(indicadores.map((i) => [`${i.nome}|${i.mes}`, Number(i.valor)]));
  for (const i of calculo.indicadores.filter((x) => x.classe === "MANUAL" && !QUADROS_DE_LOTACAO.has(x.indicador.nome))) {
    const ler = (mes: number) => ind.get(`${i.indicador.nome}|${mes}`);
    add({
      aba: "manuais",
      chave: `I|${i.indicador.nome}`,
      descricao: [i.indicador.grupo, i.indicador.nome],
      und: i.indicador.unidade,
      conta: null,
      media: ler(0) ?? null,
      meses: doze(ler),
      percentual: i.indicador.unidade === "%",
      referencia: refI(i.indicador.nome),
    });
  }
  return linhas;
}

/** Os dados de uma linha do Quadro de Lotação do cenário (09/11/2026): os cadastros e os doze meses. */
export type DadosDaLinhaDoQuadro = { unidadeNegocioId: string; vinculo: TipoDoColaborador; funcaoId: string; centroCustoId: string; meses: MesDaLinha[] };
const INCLUIR_DO_QUADRO = {
  unidadeNegocio: { select: { nome: true } },
  funcao: { select: { nome: true } },
  centroCusto: { select: { codigoRM: true, nomeRM: true, origemId: true } },
  meses: true,
} satisfies Prisma.CenarioLotacaoInclude;
const rotuloDoCentro = (c: { codigoRM: string | null; nomeRM: string }) => `${c.codigoRM ? `${c.codigoRM} - ` : ""}${c.nomeRM}`;

/**
 * Os cadastros que as linhas do Quadro de Lotação do cenário aceitam (09/11/2026): as unidades ativas e os centros ativos dos
 * grupos do cenário (os de estoque e de investimento ficam de fora, como nos Centros de Custo) — desde 20/11/2026 (Cadastros por
 * cenário), os das cópias de Unidades e de Centros de Custo do cenário (a unidade pelo id da dos Cadastros Gerais, com o nome da
 * cópia) — e as funções ativas da Gestão de Colaboradores.
 */
async function cadastrosDoQuadro(cenarioId: string) {
  const prisma = getPrismaClient();
  const [grupos, unidades, funcoes, centros] = await Promise.all([
    gruposDoCenario(cenarioId),
    prisma.cenarioUnidade.findMany({ where: { cenarioId }, orderBy: [{ ordem: "asc" }, { unidadeNegocio: { codigo: "asc" } }], select: { unidadeNegocioId: true, nome: true, ativo: true } }),
    prisma.colaboradorFuncao.findMany({ where: { ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
    prisma.cenarioCentroCusto.findMany({ where: { cenarioId }, orderBy: [{ codigoRM: { sort: "asc", nulls: "last" } }, { nomeRM: "asc" }], select: { id: true, origemId: true, codigoRM: true, nomeRM: true, ativo: true } }),
  ]);
  const grupoDoCodigo = new Map(grupos.flatMap((g) => g.centros.filter((x) => x.codigo).map((x) => [x.codigo!, g] as const)));
  const grupoDoCentro = new Map(grupos.flatMap((g) => g.centros.map((x) => [x.id, g] as const)));
  return {
    grupos,
    grupoDoCodigo,
    /** O grupo de cada centro da cópia (os ativos, nos grupos do cenário). */
    grupoDoCentro,
    /** O centro de origem (dos Cadastros Gerais) de cada centro da cópia, também dos inativos: o recorte por centro. */
    origemDoCentro: new Map(centros.map((x) => [x.id, x.origemId])),
    /** O nome de cada unidade na cópia do cenário, também das inativas. */
    nomeDaUnidade: new Map(unidades.map((u) => [u.unidadeNegocioId, u.nome])),
    unidades: unidades.filter((u) => u.ativo).map((u) => ({ id: u.unidadeNegocioId, nome: u.nome })),
    funcoes,
    centros: centros.filter((x) => x.ativo && grupoDoCentro.has(x.id)).map((x) => ({ id: x.id, origemId: x.origemId, nome: rotuloDoCentro(x), grupo: grupoDoCentro.get(x.id)!.grupo })),
  };
}

/**
 * O Quadro de Lotação Vigente (12/11/2026, pedido do Adão: a caixa “Importar Quadro de Lotação Vigente” da referência
 * realizada): as linhas do QL Realizado da competência mais recente da Gestão de Colaboradores — uma por centro, tipo e
 * função, com os colaboradores do fim do mês nos doze meses —, nos centros ativos, com código, dos grupos do cenário
 * (os demais vão em `fora`, com os colaboradores). A unidade é a dos colaboradores do Lançamento Inicial com a mesma linha
 * (sem ela, a dedicada do centro; sem ela, a da filial do grupo); os salários de cada mês, os da linha que o cenário já tinha
 * com o mesmo centro, tipo e função (sem ela, zero).
 */
async function quadroVigente(cenarioId: string) {
  const prisma = getPrismaClient();
  const ql = await quadroRealizadoMaisRecente(prisma);
  if (!ql) throw new CenarioError(400, "Nenhuma competência no Quadro de Lotação (Gestão de Colaboradores) para importar.");
  const [cad, centros, gerais, unidades, funcoes, existentes] = await Promise.all([
    cadastrosDoQuadro(cenarioId),
    // Os centros da cópia do cenário (20/11/2026): o QL Realizado é dos centros dos Cadastros Gerais e chega pelo de origem.
    prisma.cenarioCentroCusto.findMany({ where: { cenarioId }, select: { id: true, origemId: true, codigoRM: true, nomeRM: true, unidadeNegocioId: true } }),
    prisma.centroCusto.findMany({ select: { id: true, codigoRM: true, nomeRM: true } }),
    prisma.unidadeNegocio.findMany({ select: { id: true, codigo: true } }),
    prisma.colaboradorFuncao.findMany({ select: { id: true, nome: true } }),
    prisma.cenarioLotacao.findMany({ where: { cenarioId }, select: { vinculo: true, funcaoId: true, centroCustoId: true, meses: true } }),
  ]);
  const copiaDaOrigem = new Map(centros.flatMap((x) => (x.origemId ? [[x.origemId, x] as const] : [])));
  const origemDaCopia = new Map(centros.map((x) => [x.id, x.origemId]));
  const geralDe = new Map(gerais.map((x) => [x.id, x]));
  const centroDe = new Map(centros.map((x) => [x.id, x]));
  const ativos = new Set(cad.centros.map((x) => x.id));
  const unidadeDoCodigo = new Map(unidades.map((u) => [u.codigo, u.id]));
  const nomeDaFuncao = new Map(funcoes.map((f) => [f.id, f.nome]));
  // Os salários das linhas que o cenário já tinha, pelo centro de origem (a chave do QL Realizado).
  const salarios = new Map(existentes.map((l) => [chaveDaLinhaDoQuadro({ ...l, centroCustoId: origemDaCopia.get(l.centroCustoId) ?? l.centroCustoId }), mesesDaLinha(l.meses)]));
  const linhas: DadosDaLinhaDoQuadro[] = [];
  const fora = new Map<string, number>();
  let total = 0;
  for (const [k, n] of ql.final) {
    if (n <= 0) continue;
    const [origemId, vinculo, funcaoId] = k.split("|");
    const c = copiaDaOrigem.get(origemId);
    const g = c && ativos.has(c.id) ? cad.grupoDoCentro.get(c.id) : undefined;
    if (!c || !g || !funcaoId || !TIPOS_DO_COLABORADOR.includes(vinculo as TipoDoColaborador)) {
      const geral = geralDe.get(origemId);
      const nome = c ? rotuloDoCentro(c) : geral ? rotuloDoCentro(geral) : "centro de custo excluído";
      fora.set(nome, (fora.get(nome) ?? 0) + n);
      continue;
    }
    const s = salarios.get(k);
    linhas.push({
      unidadeNegocioId: ql.unidadeDaChave.get(k) ?? c.unidadeNegocioId ?? unidadeDoCodigo.get(g.unidade) ?? unidades[0].id,
      vinculo: vinculo as TipoDoColaborador,
      funcaoId,
      centroCustoId: c.id,
      // Os Benefícios das linhas que já havia (21/11/2026) também ficam.
      meses: Array.from({ length: 12 }, (_, m) => ({
        colaboradores: n,
        salarioBruto: s?.[m].salarioBruto ?? 0,
        adicional: s?.[m].adicional ?? 0,
        beneficiosPadrao: s?.[m].beneficiosPadrao ?? [],
        beneficiosDigitados: s?.[m].beneficiosDigitados ?? null,
      })),
    });
    total += n;
  }
  // Na ordem do centro, do tipo e da função.
  const ordem = (l: DadosDaLinhaDoQuadro) => `${centroDe.get(l.centroCustoId)?.codigoRM ?? ""}|${l.vinculo}|${nomeDaFuncao.get(l.funcaoId) ?? ""}`;
  linhas.sort((a, b) => ordem(a).localeCompare(ordem(b), "pt-BR"));
  return { ano: ql.ano, mes: ql.mes, linhas, total, fora };
}

/** O motivo de recusar uma linha do Quadro de Lotação; null, certa. Os cadastros da linha que já existia valem, mesmo inativos. */
function recusaDaLinha(d: DadosDaLinhaDoQuadro, cad: Awaited<ReturnType<typeof cadastrosDoQuadro>>, atual?: { funcaoId: string; centroCustoId: string; unidadeNegocioId: string } | null) {
  const mantido = (campo: "funcaoId" | "centroCustoId" | "unidadeNegocioId") => atual?.[campo] === d[campo];
  if (!mantido("unidadeNegocioId") && !cad.unidades.some((u) => u.id === d.unidadeNegocioId)) return "Escolha a unidade.";
  if (!TIPOS_DO_COLABORADOR.includes(d.vinculo)) return "O tipo é CLT, PJ, Aprendiz ou Estagiário.";
  if (!mantido("funcaoId") && !cad.funcoes.some((x) => x.id === d.funcaoId)) return "Escolha uma função ativa da Gestão de Colaboradores.";
  if (!mantido("centroCustoId") && !cad.centros.some((x) => x.id === d.centroCustoId)) return "Escolha um centro de custo ativo, com código, de um grupo do cenário.";
  if (d.meses.length !== 12 || d.meses.some((m) => [m.colaboradores, m.salarioBruto, m.adicional, m.beneficiosDigitados ?? 0].some((v) => !Number.isFinite(v) || v < 0 || v > 1e9)))
    return "Os colaboradores, os salários e os benefícios de cada mês são números de zero para cima.";
  return null;
}

/** Os meses de uma linha para gravar (os meses com algum valor), com os Benefícios Padrão aplicados e o valor digitado (21/11/2026). */
const mesesParaGravar = (linhaId: string, meses: MesDaLinha[]) =>
  meses.flatMap((m, k) =>
    m.colaboradores || m.salarioBruto || m.adicional || m.beneficiosPadrao?.length || m.beneficiosDigitados
      ? [
          {
            linhaId,
            mes: k + 1,
            colaboradores: new Prisma.Decimal(m.colaboradores.toFixed(4)),
            salarioBruto: new Prisma.Decimal(m.salarioBruto.toFixed(2)),
            adicional: new Prisma.Decimal(m.adicional.toFixed(2)),
            beneficiosPadrao: m.beneficiosPadrao ?? [],
            beneficios: m.beneficiosDigitados === null || m.beneficiosDigitados === undefined ? null : new Prisma.Decimal(m.beneficiosDigitados.toFixed(2)),
          },
        ]
      : [],
  );
/** O nome de uma linha do Quadro de Lotação no histórico: a função e o centro. */
const nomeDaLinha = (l: { funcao: { nome: string }; centroCusto: { codigoRM: string | null; nomeRM: string } }) => `${l.funcao.nome} · ${rotuloDoCentro(l.centroCusto)}`;

type MudancaDaPlanilha = { chave: string; mes: number; valor: number | null };
/** Os campos de um investimento importado da planilha (15/10/2026). */
type DadosDoInvestimento = Omit<InvestimentoLido, "aba" | "numero">;
/** O Nome de Referência para comparar: sem espaços nas pontas e sem diferença de maiúsculas. */
const chaveDoNome = (nome: string) => nome.trim().toLocaleLowerCase("pt-BR");

/** A recusa do que fica fora do recorte do usuário (o Acesso às Informações Por Recorte, 12/11/2026). */
function exigirNoRecorte(ok: boolean) {
  if (!ok) throw new CenarioError(403, FORA_DO_RECORTE);
}
/** O recorte nas linhas do Quadro de Lotação (12/11/2026): cada centro pelo grupo dele no cenário, e o trecho do histórico. */
function recorteDoQuadroCom(r: Recorte | null, cad: { grupoDoCentro: Map<string, GrupoDoCenario>; origemDoCentro: Map<string, string | null> }) {
  // O centro é o da cópia do cenário (20/11/2026): o grupo dele no cenário e, no recorte por centro, o de origem.
  const grupo = (centroId: string) => cad.grupoDoCentro.get(centroId);
  return {
    ve: (centroId: string) => veCentro(r, cad.origemDoCentro.get(centroId) ?? null, grupo(centroId)),
    trecho: (centroId: string): Trecho => {
      const g = grupo(centroId);
      return g ? trechoDoGrupo(g) : { d: [] };
    },
  };
}
const recorteDoQuadro = async (r: Recorte | null, cenarioId: string) => recorteDoQuadroCom(r, await cadastrosDoQuadro(cenarioId));

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
      // Os colaboradores (L|grupo|…) vêm da aba Quadro de Lotação (12/11/2026: a Gestão de Colaboradores é a única fonte) e
      // não se gravam.
      continue;
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
    return cenarios.map((c, k) => ({ ...c, ...doCenario(c.id), ...daFamilia(c), resultados: resumos[k], podeMudarVisualizacao: mudaVisualizacao(c, usuario), podeEditarConfiguracoes: editaConfiguracoes(c, usuario), recorte: recorteParaTela(recorteDoCenario(c, usuario)) }));
  },

  async obter(id: string, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    // Nos analíticos (14/10/2026): os rateios sem regra no exercício e se as regras mudaram depois do último cálculo.
    // As regras da cópia do cenário (21/11/2026: Configurações / Regras de Rateio).
    const regras = c.tipo === "ANALITICO" ? await regrasDeRateioDoCenario(getPrismaClient(), c.id) : null;
    const rateios = regras ? { avisos: avisosDosRateios(regras, mesesDoAno(c.ano), "Configurações / Regras de Rateio"), desatualizados: c.rateiosAssinatura !== assinaturaDasRegras(regras) } : null;
    // As alterações ainda não recalculadas (21/11/2026): o destaque Pendente de Recálculo e o Recalcular dos Resultados.
    const recalculo = c.tipo === "ANALITICO" ? pendenciasDoRecalculo(c) : null;
    return {
      ...c,
      ...(await conteudo([id]))(id),
      ...(await familias())(c),
      podeMudarVisualizacao: mudaVisualizacao(c, usuario),
      podeEditarConfiguracoes: editaConfiguracoes(c, usuario),
      recorte: recorteParaTela(recorteDoCenario(c, usuario)),
      rateios,
      recalculo,
    };
  },

  /**
   * Um cenário novo: vazio, no exercício dado, ou a cópia de outro do mesmo tipo (com a DRE e as metas dele, no
   * exercício dele).
   */
  async criar(dados: { nome: string; ano: number; descricao: string | null; copiarDe: string | null; visualizacao?: VisualizacaoCenario; tipo?: TipoCenario }, usuario: Usuario) {
    const prisma = getPrismaClient();
    const tipo = dados.tipo ?? "SINTETICO";
    // Os analíticos usam as regras de rateio: sem regra vigente em algum mês do exercício, não se abrem (14/10/2026).
    const origem = dados.copiarDe ? await obterOuFalhar(dados.copiarDe, usuario) : null;
    // As regras que o cenário novo leva (21/11/2026): as da cópia do cenário de origem ou, sem ela, as de Cadastros Gerais.
    if (tipo === "ANALITICO") {
      const daOrigem = origem ? await regrasDeRateioDoCenario(getPrismaClient(), origem.id) : [];
      exigirRateios(daOrigem.length ? daOrigem : await regrasDeRateio(), origem?.ano ?? dados.ano, `abrir um cenário analítico de ${origem?.ano ?? dados.ano}`, daOrigem.length ? "Configurações / Regras de Rateio" : undefined);
    }
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
            referenciaDetalhe: origem?.referenciaDetalhe ?? undefined,
            // O Comparativo (11/11/2026, pedido do Adão; como na revisão): o Cenário Comparado, as Variações Máximas, os Índices
            // de Referência e o índice de cada conta (de onde sai o Justificar? das premissas) e as realocações da referência.
            comparadoComId: origem?.comparadoComId ?? null,
            variacoesMaximas: origem?.variacoesMaximas ?? undefined,
            indicesReajuste: origem?.indicesReajuste ?? undefined,
            indicesDoComparativo: origem?.indicesDoComparativo ?? undefined,
            realocacoes: origem?.realocacoes ?? undefined,
            // Os Reajustes das Premissas do analítico (11/11/2026), como as premissas: a DRE copiada já os traz, quando aplicados.
            indicesDosReajustes: origem?.indicesDosReajustes ?? undefined,
            aplicacaoDosReajustes: origem?.aplicacaoDosReajustes ?? undefined,
            reajustesAplicados: origem?.reajustesAplicados ?? false,
            // As alterações ainda não recalculadas da origem (21/11/2026): a DRE copiada também não as tem.
            recalculoConfiguracoes: origem?.recalculoConfiguracoes ?? 0,
            recalculoPremissas: origem?.recalculoPremissas ?? 0,
            recalculoReajustes: origem?.recalculoReajustes ?? 0,
            reajustesCalculados: origem?.reajustesCalculados ?? false,
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
          // O Quadro de Lotação do analítico (09/11/2026), nos centros da cópia nova (20/11/2026).
          const mapa = tipo === "ANALITICO" ? await copiarCadastros(tx, c.id, origem.id) : undefined;
          // Os departamentos das combinações dos índices (21/11/2026): os da cópia nova.
          if (tipo === "ANALITICO") await remapearDepartamentosDosIndices(tx, origem.id, c.id);
          await copiarQuadro(tx, origem.id, c.id, mapa);
        } else if (tipo === "ANALITICO") {
          // As cópias de Unidades e de Centros de Custo (20/11/2026, Cadastros por cenário): as dos Cadastros Gerais de hoje.
          await copiarCadastros(tx, c.id, null);
        }
        return c;
      },
      { timeout: 60_000 },
    );
    await auditar({ usuarioId: usuario.id, usuarioNome: usuario.nome, acao: "CRIACAO", entidade: "cenario", entidadeId: cenario.id, depois: cenario, metadados: origem ? { copiaDe: origem.nome } : undefined });
    return this.obter(cenario.id, usuario);
  },

  /**
   * O nome, a descrição, a visualização e a Edição das Configurações (12/11/2026). Os dois últimos só mudam por quem criou o
   * cenário ou pelo Administrador, e um cenário marcado não fica particular (a marcação vale para todos: o Orçamento
   * Empresarial dá o orçado de Resultados Realizados).
   */
  async atualizar(
    id: string,
    dados: { nome: string; descricao: string | null; visualizacao?: VisualizacaoCenario; edicaoConfiguracoes?: VisualizacaoCenario; acessoInformacoes?: AcessoInformacoesCenario },
    usuario: Usuario,
  ) {
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
    const edicaoConfiguracoes = dados.edicaoConfiguracoes ?? antes.edicaoConfiguracoes;
    if (edicaoConfiguracoes !== antes.edicaoConfiguracoes && !mudaVisualizacao(antes, usuario))
      throw new CenarioError(409, "Só quem criou o cenário ou o Administrador muda a Edição das Configurações dele.");
    // O Acesso às Informações (12/11/2026): só nos analíticos, e só por quem criou o cenário ou pelo Administrador.
    const acessoInformacoes = antes.tipo === "ANALITICO" ? (dados.acessoInformacoes ?? antes.acessoInformacoes) : antes.acessoInformacoes;
    if (acessoInformacoes !== antes.acessoInformacoes && !mudaVisualizacao(antes, usuario))
      throw new CenarioError(409, "Só quem criou o cenário ou o Administrador muda o Acesso às Informações dele.");
    const depois = await getPrismaClient().cenario.update({ where: { id }, data: { nome: dados.nome, descricao: dados.descricao, visualizacao, edicaoConfiguracoes, acessoInformacoes } });
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
    // A DRE do analítico marcado é a de todos (o orçado dos Resultados Empresariais): com todas as alterações (21/11/2026).
    if (marcacao && antes.tipo === "ANALITICO") exigirRecalculado(antes, `marcar ${antes.nome}`);
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
          ? await tx.cenario.update({ where: { id: p.cenario.id }, data: { nomeArquivo: dados.nomeArquivo, importadoEm: agora, referenciaDetalhe: Prisma.DbNull } })
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
      comparado: comparadoDaResposta(comparado),
      linhas: montar(linhas, visao, d.comValor, d.valores, d.consolidado, ACESSO_TOTAL, totais ? new Set(totais.keys()) : undefined).map((l) =>
        comTotalComparado({ ...l, podeDetalhar: false }, totais),
      ),
      // As colunas dos índices (21/11/2026) só nas unidades: no Consolidado, não (pedido do Adão).
      indices: c.tipo === "ANALITICO" && visao !== 0 ? await indicesDosResultados(c, visao, !!comparado) : null,
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
      comparado: comparadoDaResposta(comparado),
      abas: [
        // Os itens do cadastro do Painel de Bordo (17/10/2026).
        { chave: "resultados", titulo: "Resultados", quadros: montarPainel(quadros.resultados, periodos, serie) },
        { chave: "performance", titulo: "Performance", quadros: montarPainel(quadros.performance, periodos, serie) },
      ],
    };
  },

  /** Os indicadores do cenário, mês a mês e acumulados, com a classe de cada um (as abas da tela). */
  async indicadores(id: string, usuario: Usuario = SISTEMA, recortar = false) {
    const c = await obterOuFalhar(id, usuario);
    // `recortar` (12/11/2026): a aba Indicadores Manuais das Premissas, com o Acesso às Informações Por Recorte, só com os
    // indicadores manuais dos grupos dos departamentos do recorte (o Painel de Bordo mostra todos).
    const recorte = recortar ? recorteDoCenario(c, usuario) : null;
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
      comparado: comparadoDaResposta(comparado),
      meses: Array.from({ length: 12 }, (_, k) => ({ mes: k + 1, rotulo: rotuloMes(c.ano, k + 1), apurado: true })),
      indicadores: calculo.indicadores
        .filter((i) => !recorte || i.classe !== "MANUAL" || veDepartamentos(recorte, departamentosDoGrupoDoIndicador(i.indicador.grupo)))
        .map((i) => ({
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
      comparado: comparadoDaResposta(comparado),
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
   * Devolve também os avisos do que não coube nas premissas. Com `manterMeses` (11/11/2026, pedido do Adão), só as Médias
   * de Referência (o mês 0) mudam: os doze meses do cenário (digitados ou importados) ficam como estão, também no Mês a Mês.
   */
  async referenciaRealizado(
    id: string,
    ano: number,
    usuario: Usuario,
    opcoesDaReferencia: { modo: "MES_A_MES" | "MEDIA"; de?: number; ate?: number; manterMeses?: boolean; importarQuadro?: boolean } = { modo: "MES_A_MES" },
  ) {
    const { manterMeses: manter = false, importarQuadro = false, ...opcoes } = opcoesDaReferencia;
    const c = await obterOuFalhar(id, usuario);
    exigirQuemCriou(c, usuario);
    exigirEditavel(c);
    exigirSemReajustes(c);
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
    // Os indicadores realizados: mês a mês, os dos meses fechados; na média, a soma dos meses do período ÷ os meses dele
    // (17/11/2026: também os sem valor), nos doze meses (os que saem da DRE o cenário recalcula das contas médias).
    const noPeriodo = (k: number) => fechadas.some((f) => f.mes === k + 1);
    const indicadores = realizados.indicadores.flatMap((i) => {
      if (!media) return i.meses.flatMap((v, k) => (v === null || !Number.isFinite(v) || !noPeriodo(k) ? [] : [{ nome: i.nome, mes: k + 1, valor: new Prisma.Decimal(v.toFixed(8)) }]));
      const vs = i.meses.filter((v, k): v is number => v !== null && Number.isFinite(v) && noPeriodo(k));
      if (!vs.length) return [];
      const valor = new Prisma.Decimal((vs.reduce((s, v) => s + v, 0) / fechadas.length).toFixed(8));
      return doze.map((mes) => ({ nome: i.nome, mes, valor }));
    });
    // Nos analíticos, a média vai só para as Médias de Referência (15/10/2026).
    const nomeArquivo = media ? `Médias do realizado de ${ano} (${periodo})` : `Resultado realizado de ${ano} (${periodo})`;
    // As decisões de realocação das movimentações fora dos padrões ficam entre as cargas (14/10/2026).
    const anteriores = lerRealocacoes(c.realocacoes);
    // Os grupos da cópia dos Centros de Custo do cenário (20/11/2026, Cadastros por cenário).
    const grupos = await gruposDoCenario(c.id);
    // E as Redistribuições de Gastos da cópia (20/11/2026, etapa 2), no lugar das dos Cadastros Gerais.
    const ref = await referenciaDoRealizado(ano, fechadas.map((f) => f.mes), anteriores.decisoes, grupos, await regrasDoCenario(c.id));
    // Cada movimentação (15/10/2026): a soma dos meses ÷ os meses da referência (17/11/2026, pedido do Adão: também os sem
    // valor) vai para a Média de Referência do grupo (o mês 0); os meses, só no Mês a Mês (na média do período, os meses do
    // cenário ficam em branco). Mantendo os meses (11/11/2026), as realocações também ficam só na média.
    const movimentacoes = ref.movimentacoes.map(({ meses, ...m }) => ({ ...m, valores: media || manter ? Array<number>(12).fill(0) : meses, media: mediaDoPeriodo(meses, fechadas.length) }));
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
    // A Média de Referência (15/10/2026; o mês 0): a soma no período ÷ o número de meses. Os doze meses do cenário ficam
    // em branco (o botão Replicar Médias os preenche); no Mês a Mês, cada mês fechado vai também para o seu mês.
    const comMedia = <T extends { mes: number; valor: number }>(xs: T[], chave: (x: T) => string) => {
      const somas = new Map<string, { x: T; soma: number }>();
      for (const x of xs) somas.set(chave(x), { x, soma: (somas.get(chave(x))?.soma ?? 0) + x.valor });
      const medias = [...somas.values()].map(({ x, soma }) => ({ ...x, mes: 0, valor: soma / fechadas.length }));
      return media ? medias : [...medias, ...xs];
    };
    const decimal = (v: number) => new Prisma.Decimal(v.toFixed(4));
    // Os colaboradores (12/11/2026, pedido do Adão): a Gestão de Colaboradores é a única fonte da contagem — a referência não
    // traz mais as listas do Quadro de Lotação do Fechamento Mensal; os colaboradores saem da aba Quadro de Lotação do cenário,
    // que o Importar Quadro de Lotação Vigente (`importarQuadro`) preenche com o QL Realizado mais recente, qualquer que seja o
    // período.
    const vigente = importarQuadro ? await quadroVigente(id) : null;
    if (vigente?.fora.size)
      ref.avisos.push(
        `Quadro de Lotação Vigente: ${[...vigente.fora.values()].reduce((s, n) => s + n, 0)} colaboradores de centros fora dos grupos do cenário (ou inativos) ficaram de fora: ${[...vigente.fora.entries()].map(([c, n]) => `${c} (${n})`).join(", ")}.`,
      );
    await prisma.$transaction(
      async (tx) => {
        // Mantendo os meses (11/11/2026), só as Médias de Referência (o mês 0) saem e entram de novo. A mão de obra das médias do
        // cenário fica (22/11/2026, pedido do Adão: os meses e o resultado não mudam): antes, o cálculo grava as bases dos Encargos
        // dela com as médias de agora; o marcador e as bases não saem.
        if (manter) await materializarPremissas(tx, id);
        const soMedias = manter ? { mes: 0 } : {};
        const semAMaoDeObraDasMedias = manter ? { venda: { notIn: VENDAS_DA_MAO_DE_OBRA_DAS_MEDIAS } } : {};
        await tx.cenarioPremissa.deleteMany({ where: { cenarioId: id, ...soMedias, ...semAMaoDeObraDasMedias } });
        // Só as Médias de Referência (o mês 0; 15/10/2026: antes, também os doze meses iguais a elas).
        const premissas = ref.premissas.map((p) => ({ cenarioId: id, unidade: p.unidade, venda: p.venda, chave: p.chave, mes: 0, valor: new Prisma.Decimal(p.valor.toFixed(6)) }));
        const mensais = comMedia(ref.mensais, (x) => `${x.venda}|${x.chave}`)
          .filter((x) => !manter || x.mes === 0)
          .map((x) => ({ cenarioId: id, unidade: x.unidade, venda: x.venda, chave: x.chave, mes: x.mes, valor: decimal(x.valor) }));
        await gravarEmLotes([...premissas, ...mensais], (lote) => tx.cenarioPremissa.createMany({ data: lote }));
        await tx.cenarioCentro.deleteMany({ where: { cenarioId: id, ...soMedias } });
        // A Média de Referência dos centros (o mês 0; 15/10/2026): a soma de cada grupo e conta ÷ os meses da referência
        // (17/11/2026, pedido do Adão: também os sem valor; antes, só os com movimentação), e as realocações aplicadas entram com
        // a média delas (a mesma que o quadro das realocações soma e tira ao mudar a decisão). No Mês a Mês, também cada mês
        // fechado no seu mês.
        const somaDosCentros = new Map<string, { grupo: string; codigo: string; mes: number; valor: number }>();
        const naSoma = (x: { grupo: string; codigo: string; mes: number; valor: number }) => {
          const k = `${x.grupo}|${x.codigo}|${x.mes}`;
          somaDosCentros.set(k, { ...x, valor: (somaDosCentros.get(k)?.valor ?? 0) + x.valor });
        };
        mediaNoPeriodo(ref.centrosProprios, (x) => `${x.grupo}|${x.codigo}`, fechadas.length).forEach(naSoma);
        for (const m of movimentacoes) {
          const a = ref.aplicadas.get(m.chave);
          if (a && m.media) naSoma({ grupo: a.grupo, codigo: a.conta, mes: 0, valor: m.media });
        }
        if (!media && !manter) ref.centros.forEach(naSoma);
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
        // O Quadro de Lotação Vigente (12/11/2026): as linhas da aba Quadro de Lotação do cenário trocadas pelas do QL
        // Realizado mais recente (os salários de cada linha que já havia ficam); o cálculo, abaixo, conta os colaboradores.
        if (vigente) {
          await tx.cenarioLotacao.deleteMany({ where: { cenarioId: id } });
          const novas = vigente.linhas.map((l, k) => ({ ...l, id: randomUUID(), ordem: k }));
          await gravarEmLotes(
            novas.map(({ meses: _m, ...l }) => ({ ...l, cenarioId: id })),
            (lote) => tx.cenarioLotacao.createMany({ data: lote }),
          );
          await gravarEmLotes(
            novas.flatMap((l) => mesesParaGravar(l.id, l.meses)),
            (lote) => tx.cenarioLotacaoMes.createMany({ data: lote }),
          );
        }
        await tx.cenarioIndicador.deleteMany({ where: { cenarioId: id, ...soMedias } });
        // Os indicadores: a Média de Referência (o mês 0: a soma dos meses do período ÷ os meses dele — 17/11/2026, pedido do
        // Adão, também os sem valor) e, no Mês a Mês, os meses (15/10/2026: antes, na média, os doze meses iguais a ela).
        const medias = realizados.indicadores.flatMap((i) => {
          const vs = i.meses.filter((v, k): v is number => v !== null && Number.isFinite(v) && noPeriodo(k));
          return vs.length ? [{ nome: i.nome, mes: 0, valor: new Prisma.Decimal((vs.reduce((s, v) => s + v, 0) / fechadas.length).toFixed(8)) }] : [];
        });
        const semQuadros = [...medias, ...(media || manter ? [] : indicadores)].filter((v) => !QUADROS_DE_LOTACAO.has(v.nome));
        await gravarEmLotes(semQuadros, (lote) => tx.cenarioIndicador.createMany({ data: lote.map((v) => ({ cenarioId: id, ...v, origem: "IMPORTADO" as const })) }));
        await alteradoSemRecalcular(tx, id, "configuracoes");
        // O detalhe da referência (11/11/2026): o ano e os meses do período, para os realizados do Exportar Premissas.
        const referenciaDetalhe: DetalheDaReferencia = { tipo: "REALIZADO", ano, meses: fechadas.map((f) => f.mes) };
        await tx.cenario.update({ where: { id }, data: { nomeArquivo, importadoEm: new Date(), realocacoes: realocacoes as unknown as Prisma.InputJsonValue, referenciaDetalhe } });
      },
      { timeout: 300_000 },
    );
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "IMPORTACAO",
      entidade: "cenario",
      entidadeId: id,
      metadados: { cenario: c.nome, referencia: media ? "media do realizado" : "realizado", ano, meses, premissas: ref.premissas.length, centros: ref.centros.length, avisos: ref.avisos, manterMeses: manter },
    });
    await prisma.cenarioReajuste.create({
      data: {
        cenarioId: id,
        usuarioId: usuario.id || null,
        usuarioNome: usuario.nome,
        tipo: "REFERENCIA",
        descricao: `${nomeArquivo}${manter ? " (só as Médias de Referência; os meses do cenário mantidos)" : ""}${vigente ? `; Quadro de Lotação Vigente (${String(vigente.mes).padStart(2, "0")}/${vigente.ano}: ${vigente.total} colaboradores em ${vigente.linhas.length} linhas)` : ""}`,
      },
    });
    return {
      ...(await this.obter(id, usuario)),
      avisos: ref.avisos,
      ...(vigente ? { quadroVigente: { competencia: `${String(vigente.mes).padStart(2, "0")}/${vigente.ano}`, colaboradores: vigente.total, linhas: vigente.linhas.length } } : {}),
    };
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
    exigirSemReajustes(c);
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
        await tx.cenario.update({ where: { id }, data: { nomeArquivo, importadoEm: new Date(), referenciaDetalhe: Prisma.DbNull } });
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
    exigirSemReajustes(c);
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
        await alteradoSemRecalcular(tx, id, "configuracoes");
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
   * recalcula. As justificativas e o comparativo ficam. Com `manterMeses` (11/11/2026, pedido do Adão), só as Médias de
   * Referência (o mês 0) vêm da origem: os doze meses, os investimentos e as linhas do Quadro de Lotação do cenário ficam.
   */
  async referenciaCenario(id: string, origemId: string, usuario: Usuario, manterMeses = false) {
    const c = await obterOuFalhar(id, usuario);
    exigirQuemCriou(c, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    exigirSemReajustes(c);
    if (origemId === id) throw new CenarioError(400, "Escolha outro cenário: a referência não pode ser o próprio cenário.");
    const origem = await obterOuFalhar(origemId, usuario);
    if (origem.tipo !== "ANALITICO") throw new CenarioError(400, `Os cenários analíticos só importam de cenários analíticos: ${origem.nome} é sintético.`);
    const prisma = getPrismaClient();
    const nomeArquivo = `Cenário ${origem.nome} ${rotuloVersao(origem.versao)}${origem.ano !== c.ano ? ` (${origem.ano})` : ""}`;
    await prisma.$transaction(
      async (tx) => {
        // Mantendo os meses (11/11/2026), só as Médias de Referência (o mês 0) saem e vêm da origem. A mão de obra das médias do
        // cenário fica, e a da origem não vem (22/11/2026, pedido do Adão: os meses e o resultado não mudam; antes, os marcadores da
        // origem vinham com as médias e, nos grupos com o mesmo Quadro de Lotação, os Encargos passavam a sair da média): antes, o
        // cálculo grava as bases dos Encargos dela com as médias de agora. Sem manter os meses, as da origem vêm com os meses dela.
        if (manterMeses) await materializarPremissas(tx, id);
        const soMedias = manterMeses ? { mes: 0 } : {};
        const semAMaoDeObraDasMedias = manterMeses ? { venda: { notIn: VENDAS_DA_MAO_DE_OBRA_DAS_MEDIAS } } : {};
        await tx.cenarioPremissa.deleteMany({ where: { cenarioId: id, ...soMedias, ...semAMaoDeObraDasMedias } });
        await tx.cenarioCentro.deleteMany({ where: { cenarioId: id, ...soMedias } });
        await tx.cenarioIndicador.deleteMany({ where: { cenarioId: id, ...soMedias } });
        const premissas = await tx.cenarioPremissa.findMany({ where: { cenarioId: origem.id, ...soMedias, ...semAMaoDeObraDasMedias } });
        await gravarEmLotes(premissas, (lote) => tx.cenarioPremissa.createMany({ data: lote.map((p) => ({ ...p, cenarioId: id })) }));
        const centros = await tx.cenarioCentro.findMany({ where: { cenarioId: origem.id, ...soMedias } });
        await gravarEmLotes(centros, (lote) => tx.cenarioCentro.createMany({ data: lote.map((x) => ({ ...x, cenarioId: id })) }));
        if (!manterMeses) {
          await tx.cenarioInvestimento.deleteMany({ where: { cenarioId: id } });
          await tx.cenarioLotacao.deleteMany({ where: { cenarioId: id } });
          const investimentos = await tx.cenarioInvestimento.findMany({ where: { cenarioId: origem.id } });
          await gravarEmLotes(investimentos, (lote) => tx.cenarioInvestimento.createMany({ data: lote.map(({ id: _id, criadoEm: _c, atualizadoEm: _a, ...x }) => ({ ...x, cenarioId: id })) }));
          await copiarQuadro(tx, origem.id, id);
        }
        const indicadores = await tx.cenarioIndicador.findMany({ where: { cenarioId: origem.id, ...soMedias } });
        await gravarEmLotes(indicadores, (lote) => tx.cenarioIndicador.createMany({ data: lote.map((r) => ({ ...r, cenarioId: id })) }));
        await alteradoSemRecalcular(tx, id, "configuracoes");
        // As realocações da origem vêm junto: os centros copiados já têm o que ela realocou (14/10/2026).
        const referenciaDetalhe: DetalheDaReferencia = { tipo: "CENARIO", cenarioId: origem.id };
        await tx.cenario.update({ where: { id }, data: { nomeArquivo, importadoEm: new Date(), realocacoes: origem.realocacoes ?? Prisma.DbNull, referenciaDetalhe } });
      },
      { timeout: 300_000 },
    );
    await auditar({ usuarioId: usuario.id, usuarioNome: usuario.nome, acao: "IMPORTACAO", entidade: "cenario", entidadeId: id, metadados: { cenario: c.nome, referencia: "cenario", origem: nomeArquivo, manterMeses } });
    await prisma.cenarioReajuste.create({
      data: { cenarioId: id, usuarioId: usuario.id || null, usuarioNome: usuario.nome, tipo: "REFERENCIA", descricao: `${nomeArquivo}${manterMeses ? " (só as Médias de Referência; os meses do cenário mantidos)" : ""}` },
    });
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
    const c = await obterOuFalhar(id, usuario);
    const [todas, est] = await Promise.all([getPrismaClient().cenarioReajuste.findMany({ where: { cenarioId: id }, orderBy: { criadoEm: "desc" } }), estruturaDRE()]);
    // Com o Acesso às Informações Por Recorte (12/11/2026), só as alterações do recorte (as do cenário inteiro, todos).
    const recorte = recorteDoCenario(c, usuario);
    const grupos = recorte ? new Map((await gruposDoCenario(id)).map((g) => [g.grupo, g])) : new Map();
    const unidadeDaConta = (conta: string) => CONTAS_DEPRECIACAO.find((d) => d.conta === conta)?.unidade ?? null;
    // As alterações da lista dos investimentos (19/11/2026), todos as veem, como veem a lista inteira.
    const rs = recorte ? todas.filter((x) => veAlteracao(recorte, x, grupos, unidadeDaConta)) : todas;
    const porCodigo = new Map(est.map((l) => [l.codigo, l]));
    return rs.map(({ alcance: _alcance, ...r }) => ({
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
    if (c.tipo === "ANALITICO") {
      exigirRateios(await regrasDeRateioDoCenario(getPrismaClient(), c.id), c.ano, `congelar a ${rotuloVersao(c.versao)} de ${c.nome}`, "Configurações / Regras de Rateio");
      // A DRE com todas as alterações (21/11/2026): o Recalcular antes de congelar.
      exigirRecalculado(c, `congelar a ${rotuloVersao(c.versao)} de ${c.nome}`);
      // As Verificações das Premissas (20/11/2026): todas corrigidas ou com o De Acordo.
      const pendentes = (await verificacoesComSituacao(c)).lista.filter((v) => !v.acordo).length;
      if (pendentes)
        throw new CenarioError(
          409,
          `${pendentes === 1 ? "Há 1 verificação pendente" : `Há ${pendentes} verificações pendentes`} na aba Verificações das Premissas: corrija os valores ou peça o De Acordo de quem os alterou antes de congelar a ${rotuloVersao(c.versao)} de ${c.nome}.`,
        );
    }
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
    if (c.tipo === "ANALITICO") exigirRateios(await regrasDeRateioDoCenario(getPrismaClient(), c.id), c.ano, `reabrir a ${rotuloVersao(c.versao)} de ${c.nome}`, "Configurações / Regras de Rateio");
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
    if (origem.tipo === "ANALITICO") exigirRateios(await regrasDeRateioDoCenario(getPrismaClient(), origem.id), origem.ano, `criar uma revisão de ${origem.nome}`, "Configurações / Regras de Rateio");
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
            // A Edição das Configurações da versão de origem (12/11/2026).
            edicaoConfiguracoes: origem.edicaoConfiguracoes,
            // E o Acesso às Informações (12/11/2026).
            acessoInformacoes: origem.acessoInformacoes,
            // E os usuários convidados a vê-lo (21/11/2026).
            compartilhamentos: origem.compartilhamentos ?? undefined,
            criadoPor: usuario.nome,
            criadoPorId: usuario.id || null,
            nomeArquivo: origem.nomeArquivo,
            importadoEm: origem.importadoEm,
            referenciaDetalhe: origem.referenciaDetalhe ?? undefined,
            comparadoComId: origem.comparadoComId,
            variacoesMaximas: origem.variacoesMaximas ?? undefined,
            indicesReajuste: origem.indicesReajuste ?? undefined,
            indicesDoComparativo: origem.indicesDoComparativo ?? undefined,
            // Os Reajustes das Premissas (11/11/2026): a DRE copiada já os traz, quando aplicados.
            indicesDosReajustes: origem.indicesDosReajustes ?? undefined,
            aplicacaoDosReajustes: origem.aplicacaoDosReajustes ?? undefined,
            reajustesAplicados: origem.reajustesAplicados,
            reajustesCalculados: origem.reajustesCalculados,
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
        // As cópias de Unidades e de Centros de Custo do cenário de origem (20/11/2026) e o Quadro de Lotação nos centros delas.
        const mapa = origem.tipo === "ANALITICO" ? await copiarCadastros(tx, c.id, origem.id) : undefined;
        // Os departamentos das combinações dos índices (21/11/2026): os da cópia nova.
        if (origem.tipo === "ANALITICO") await remapearDepartamentosDosIndices(tx, origem.id, c.id);
        await copiarQuadro(tx, origem.id, c.id, mapa);
        // Os De Acordo das Verificações (20/11/2026): valem na revisão enquanto os valores não mudam.
        const acordos = await tx.cenarioVerificacaoAcordo.findMany({ where: { cenarioId: origem.id } });
        if (acordos.length) await tx.cenarioVerificacaoAcordo.createMany({ data: acordos.map((a) => ({ ...a, cenarioId: c.id })) });
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
    exigirNoRecorte(veDepartamentos(recorteDoCenario(c, usuario), departamentosDaUnidade(unidade)));
    const [est, linhas, gravadas] = await Promise.all([estruturaDRE(), linhasDoCadastro(), getPrismaClient().cenarioPremissa.findMany({ where: { cenarioId: id, unidade } })]);
    const estrutura = linhasDaTabela(est, linhas, unidade);
    return {
      ano: c.ano,
      unidade,
      nome: NOME_DA_UNIDADE[unidade],
      meses: Array.from({ length: 12 }, (_, k) => ({ mes: k + 1, rotulo: rotuloMes(c.ano, k + 1) })),
      editavel: !c.marcacao && !c.versaoSalvaEm && !c.reajustesAplicados,
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
    exigirNoRecorte(veDepartamentos(recorteDoCenario(c, usuario), departamentosDaUnidade(unidade)));
    exigirAnalitico(c);
    exigirEditavel(c);
    exigirSemReajustes(c);
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
            // O Replicar Referências (13/11/2026) grava a média como ela está (6 casas, como a Média de Referência e o Replicar Médias).
            const valor = new Prisma.Decimal(a.valor.toFixed(origem?.modo === "REFERENCIA" ? 6 : 4));
            await tx.cenarioPremissa.upsert({ where: { cenarioId_unidade_venda_chave_mes: chave }, create: { ...chave, valor }, update: { valor } });
          }
        }
        await alteradoSemRecalcular(tx, id, "premissas");
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
        alcance: [{ d: departamentosDaUnidade(unidade) }],
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
    const [grupos, totais] = await Promise.all([gruposDoCenario(id), getPrismaClient().cenarioCentro.groupBy({ by: ["grupo"], where: { cenarioId: id, mes: { gte: 1 } }, _sum: { valor: true } })]);
    const total = new Map(totais.map((t) => [t.grupo, Number(t._sum.valor ?? 0)]));
    return {
      ano: c.ano,
      meses: Array.from({ length: 12 }, (_, k) => ({ mes: k + 1, rotulo: rotuloMes(c.ano, k + 1) })),
      editavel: !c.marcacao && !c.versaoSalvaEm && !c.reajustesAplicados,
      // Com o Acesso às Informações Por Recorte (12/11/2026), só os grupos do recorte.
      grupos: gruposDoRecorte(recorteDoCenario(c, usuario), grupos).map((g) => ({ ...g, total: total.get(g.grupo) ?? 0 })),
    };
  },

  /**
   * A aba Departamentos da tela Resultados de um cenário analítico (23/11/2026, pedido do Adão), antes de Centros de Custo, como a de
   * Resultados Empresariais: a DRE do Consolidado do cenário, com os mesmos totais, mas cada departamento com centros de custo (de CPP
   * a DA) abre pelos grupos de centros (montarDepartamentos), cada um com o valor dele no departamento pelo rateio do cenário e, com a
   * DRE calculada com os reajustes, com eles (centrosNaDREDoCenario), e pelo resto das atribuições (as Premissas das unidades, os
   * Investimentos…). Com um cenário comparado, o total do exercício dele em cada linha, como no Consolidado: o analítico abre pelos
   * centros dele do mesmo jeito; o sintético não tem centros (`comparadoSemCentros`), e as linhas dos centros e as "(Outros)" ficam
   * sem o comparativo. Os grupos fora do recorte do perfil do usuário (recorteDoPerfil, como a aba Centros de Custo) ficam nas
   * "(Outros)".
   */
  async departamentosDosResultados(id: string, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    const prisma = getPrismaClient();
    const [linhas, d, comparado, grupos, centros, calculo] = await Promise.all([
      estrutura(),
      dreDoCenario(id, 0),
      comparadoDe(c),
      gruposDoCenario(id),
      centrosNaDREDoCenario(prisma, id),
      prisma.cenario.findUnique({ where: { id }, select: { reajustesCalculados: true } }),
    ]);
    const visiveis = new Set(gruposDoRecorte(recorteDoPerfil(usuario), grupos).map((g) => g.grupo));
    // Os doze meses de cada conta de destino de cada grupo do recorte, mês a mês.
    const porMes = (m: Map<string, Map<string, number[]>>) =>
      new Map(
        [...m]
          .filter(([g]) => visiveis.has(g))
          .map(([g, contas]) => [g, Array.from({ length: 12 }, (_, k) => new Map([...contas].map(([codigo, lista]) => [codigo, lista[k]])))] as const),
      );
    const analitico = comparado?.tipo === "ANALITICO";
    const [dComparado, centrosDoComparado] = comparado
      ? await Promise.all([dreDoCenario(comparado.id, 0), analitico ? centrosNaDREDoCenario(prisma, comparado.id) : null])
      : [null, null];
    const dep = montarDepartamentos(linhas, [
      { consolidado: d.valores, centros: porMes(centros) },
      ...(dComparado ? [{ consolidado: dComparado.valores, centros: centrosDoComparado ? porMes(centrosDoComparado) : null }] : []),
    ]);
    // O total do exercício do comparado em cada linha (o % e o R$/m³ sobre o Consolidado dele), como totaisDoComparado.
    const totais = dComparado
      ? new Map(montar(dep.linhas, 0, dComparado.comValor, dep.series[1].valores, dComparado.consolidado, ACESSO_TOTAL).map((l) => [l.codigo, l.total as CelulaTotal]))
      : null;
    return {
      ano: c.ano,
      ate: 12,
      meses: Array.from({ length: 12 }, (_, k) => ({ mes: k + 1, rotulo: rotuloMes(c.ano, k + 1), apurado: d.comValor[k] })),
      comparado: comparadoDaResposta(comparado),
      comparadoSemCentros: comparado && !analitico ? { nome: comparado.nome, ano: comparado.ano } : null,
      // Os centros com os reajustes da DRE: a tela avisa, como na aba Centros de Custo.
      reajustado: !!calculo?.reajustesCalculados,
      linhas: montar(dep.linhas, 0, d.comValor, dep.series[0].valores, d.consolidado, ACESSO_TOTAL, totais ? new Set(totais.keys()) : undefined).map((l) => ({
        ...comTotalComparado({ ...l, podeDetalhar: false }, totais && !dep.series[1].semValor.has(l.codigo) ? totais : null),
        ...(dep.centros.has(l.codigo) ? { centro: true } : {}),
      })),
    };
  },

  /**
   * A aba Centros de Custo da tela Resultados de um cenário analítico (19/11/2026, pedido do Adão: como a de Resultados
   * Empresariais; de quem lê a tela): os grupos de centros com valor no exercício, só os do recorte do perfil do usuário
   * (recorteDoPerfil: todos, os dos departamentos dele ou os com algum centro dele, qualquer que seja o Acesso às Informações do
   * cenário), em ordem alfabética.
   */
  async centrosDosResultados(id: string, usuario: Usuario = SISTEMA) {
    await obterOuFalhar(id, usuario);
    const lista = await this.centros(id, SISTEMA);
    const recorte = recorteDoPerfil(usuario);
    return {
      ano: lista.ano,
      grupos: lista.grupos
        .filter((g) => g.total !== 0 && veGrupo(recorte, g))
        .sort((a, b) => a.grupo.localeCompare(b.grupo, "pt-BR"))
        .map((g) => ({ grupo: g.grupo, departamento: g.departamento, total: g.total })),
    };
  },

  /**
   * A DRE de um grupo de centros no cenário (19/11/2026), mês a mês, como a de um centro em Resultados Empresariais: as contas
   * do grupo com valor (as da aba Centros de Custo das Premissas, com os Benefícios Adicionais na conta deles, como na DRE), o
   * subtotal de cada atribuição (Mão de Obra Direta…) e o total de cada grupo da DRE (CPP, DA…), que somam as contas
   * mostradas; o % e o R$/m³ sobre as bases do Consolidado do cenário. Antes da parte dos rateios que vai para Serviços (na
   * DRE, nas contas da CSM ou da CSC), como no Exportar dos centros.
   */
  async resultadosDoCentro(id: string, grupo: string, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    const g = (await gruposDoCenario(id)).find((x) => x.grupo === grupo);
    if (!g) throw new CenarioError(404, "Grupo de centros de custo não encontrado.");
    // O recorte do perfil, qualquer que seja o acesso do cenário (19/11/2026), como a lista.
    if (!veGrupo(recorteDoPerfil(usuario), g)) throw new CenarioError(403, "Fora do seu recorte: o seu perfil só vê os centros de custo dos seus departamentos ou os seus centros de custo.");
    const [linhas, d, comparado] = await Promise.all([estrutura(), dreDoGrupo(id, grupo), comparadoDe(c)]);
    // O comparativo (22/11/2026, pedido do Adão), como nas unidades: com um cenário comparado analítico, cada linha traz o total do
    // exercício do mesmo grupo (pelo nome) no comparado, com o % e o R$/m³ sobre as bases do Consolidado dele. O sintético não tem
    // centros de custo: no lugar dele, a Média de Referência do grupo × 12 (sem o % e o R$/m³); sem Média de Referência no cenário,
    // a aba fica sem o comparativo (comparadoSemCentros avisa). Entram também as linhas que só o comparado tem.
    const analitico = comparado?.tipo === "ANALITICO";
    const doComparado = comparado && analitico ? await dreDoGrupo(comparado.id, grupo) : null;
    const totais = doComparado
      ? new Map(
          montar(linhas, "centros", doComparado.consolidado.comValor, doComparado.valores, doComparado.consolidado.valores, ACESSO_TOTAL)
            .filter((l) => l.tipo !== "SECAO")
            .map((l) => [l.codigo, l.total as CelulaTotal]),
        )
      : comparado
        ? await referenciaDoGrupo(id, grupo, linhas)
        : null;
    const comparadoDaAba =
      !comparado || !totais
        ? null
        : analitico
          ? comparadoDaResposta(comparado)
          : {
              // O rótulo é o do comparado (pela marcação dele, ou COMPARADO TOTAL/AA, com o exercício dele; pedido do Adão, 22/11 e
              // 23/11/2026); a dica diz de onde vem.
              ...comparadoDaResposta(comparado)!,
              dica: `A Média de Referência de cada conta do grupo × 12 (Configurações / Referência), no lugar do cenário comparado (${comparado.nome}), que é sintético e não tem centros de custo.`,
            };
    return {
      ano: c.ano,
      ate: 12,
      grupo: g.grupo,
      departamento: g.departamento,
      destino: g.destino,
      centros: g.centros.map((x) => ({ codigoRM: x.codigo, nome: x.nome })),
      meses: Array.from({ length: 12 }, (_, k) => ({ mes: k + 1, rotulo: rotuloMes(c.ano, k + 1), apurado: d.consolidado.comValor[k] })),
      comparado: comparadoDaAba,
      comparadoSemCentros: comparado && !totais ? { nome: comparado.nome, ano: comparado.ano } : null,
      // Os valores do grupo com os reajustes da DRE (22/11/2026): a tela avisa.
      reajustado: d.reajustado,
      // Sem as seções (os volumes), como os centros de Resultados Empresariais.
      linhas: montar(linhas, "centros", d.consolidado.comValor, d.valores, d.consolidado.valores, ACESSO_TOTAL, totais ? new Set(totais.keys()) : undefined)
        .filter((l) => l.tipo !== "SECAO")
        .map((l) => comTotalComparado({ ...l, podeDetalhar: false }, totais)),
    };
  },

  /**
   * A tabela Premissas de um grupo de centros no cenário (13/10/2026; 19/10/2026: uma tabela só), com os doze meses: o
   * Quadro de Lotação (Colaboradores CLT e PJ; o Total de Colaboradores a tela soma), os Encargos e Benefícios (os
   * percentuais em %, com o padrão nos meses sem valor gravado, e os Benefícios Adicionais em R$) e as contas do grupo (a
   * Encargos e Benefícios, calculada). Desde 17/11/2026 (pedido do Adão), a conta Encargos e Benefícios que leva os
   * Benefícios Adicionais (comBeneficios) vem sem eles — só o cálculo pelos percentuais —, para a soma das duas linhas dar o
   * total; na DRE, a conta continua com eles, e o Total do Centro da tela os soma.
   */
  async centro(id: string, grupo: string, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    const g = (await gruposDoCenario(id)).find((x) => x.grupo === grupo);
    if (!g) throw new CenarioError(404, "Grupo de centros de custo não encontrado.");
    exigirNoRecorte(veGrupo(recorteDoCenario(c, usuario), g));
    const [est, gravados, premissas, linhasDoCenario] = await Promise.all([
      estruturaDRE(),
      getPrismaClient().cenarioCentro.findMany({ where: { cenarioId: id, grupo } }),
      getPrismaClient().cenarioPremissa.findMany({ where: { cenarioId: id, unidade: 0, chave: grupo, venda: { in: [...VENDAS_LOTACAO, ...VENDAS_DOS_ENCARGOS] } } }),
      linhasDoQuadro(getPrismaClient(), id),
    ]);
    // O Quadro de Lotação do cenário (09/11/2026): com linhas dos centros do grupo, os colaboradores e as remunerações são calculados.
    const quadroDoCentro = quadroDosGrupos(linhasDoCenario, [g]);
    const q = quadroDoCentro.get(grupo);
    // A mão de obra das médias (22/11/2026, maoDeObraDasMedias.ts): as Remunerações e os Encargos que o Replicar Médias gravou, sem o
    // Quadro de Lotação (nem os Benefícios Padrão dele).
    const dasMediasNoGrupo = gruposDasMedias(await marcadoresDasMedias(getPrismaClient(), id), quadroDoCentro).validos.has(grupo);
    // Os Benefícios Padrão do grupo (21/11/2026): a soma dos Benefícios das linhas dele no Quadro de Lotação.
    const beneficiosPadrao = (mes: number) => (mes >= 1 && !dasMediasNoGrupo ? (q?.beneficios[mes - 1] ?? 0) : 0);
    const maos = maosDeObraDoGrupo(contasDoGrupo(est, g).map((l) => l.codigo), g.atribuicao);
    // As Remunerações vêm da aba Quadro de Lotação em todos os grupos (11/11/2026, pedido do Adão; antes, só nos com linhas) e não
    // se digitam; na mão de obra das médias, ficam as que o Replicar Médias gravou.
    const remuneracoesDoGrupo = new Set(maos.flatMap((m) => [m.remuneracoes, m.remuneracoesPJ]));
    const doQuadro = dasMediasNoGrupo ? new Set<string>() : remuneracoesDoGrupo;
    const porLinha = new Map(gravados.map((x) => [`${x.linhaDREId}|${x.mes}`, Number(x.valor)]));
    const prem = new Map(premissas.map((x) => [`${x.venda}|${x.mes}`, Number(x.valor)]));
    const totais = est.filter((l) => l.tipo !== "ITEM");
    // A conta que leva os Benefícios Adicionais (17/11/2026): mostrada sem eles (o valor gravado menos os do mês).
    const vendaDosBeneficios = itemDosEncargos("BENEFICIOS")!.venda;
    const contaDosBeneficios = maos.find((m) => m.beneficios)?.encargos ?? null;
    const beneficiosDoMes = (mes: number) => prem.get(`${vendaDosBeneficios}|${mes}`) ?? 0;
    // Os percentuais vão em % (a premissa grava a fração).
    const serie = (venda: string, padrao: number | null, escala = 1) => ({
      referencia: (prem.get(`${venda}|0`) ?? padrao) === null ? null : (prem.get(`${venda}|0`) ?? padrao)! * escala,
      valores: Array.from({ length: 12 }, (_, k) => (prem.get(`${venda}|${k + 1}`) ?? padrao ?? 0) * escala),
      gravados: Array.from({ length: 12 }, (_, k) => prem.has(`${venda}|${k + 1}`)),
    });
    return {
      grupo: g,
      // A mão de obra das médias (22/11/2026): as Remunerações e os Encargos do grupo são as Médias de Referência replicadas.
      maoDeObraDasMedias: dasMediasNoGrupo,
      // O quadro de lotação do grupo (14/10/2026; 19/10/2026: CLT e PJ; 11/11/2026: com linhas no Quadro de Lotação, também os
      // Aprendizes e os Estagiários, sem eles nos CLT e nos PJ) e os quadros em que ele entra.
      lotacao: {
        // Os quatro em todos os grupos (12/11/2026), calculados pela aba Quadro de Lotação (sem linhas, zero).
        aprendizes: serie(VENDA_LOTACAO_APRENDIZ, null),
        estagiarios: serie(VENDA_LOTACAO_ESTAGIARIO, null),
        clt: serie(VENDA_LOTACAO_CLT, null),
        pj: serie(VENDA_LOTACAO_PJ, null),
        quadro: quadroDoGrupo(g).descricao,
        linhasDoQuadro: q?.linhas ?? 0,
      },
      // Os Salários de cada tipo de colaborador (12/11/2026, pedido do Adão; antes, os dos Aprendizes e dos Estagiários de cada
      // mão de obra), em todos os grupos (sem linhas, zero), e a mão de obra principal, que recebe as remunerações deles.
      salarios: SALARIOS_DO_QUADRO.map((s) => ({ tipo: s.tipo, rotulo: s.rotulo, valores: q ? [...q.salarios[s.tipo]] : Array<number>(12).fill(0) })),
      principal: maos.find((m) => m.principal)?.prefixo ?? null,
      // Os Benefícios Padrão (21/11/2026): calculados pela aba Quadro de Lotação, não se digitam.
      encargos: ITENS_DOS_ENCARGOS.map((i) =>
        i.calculado
          ? {
              item: i.item,
              rotulo: i.rotulo,
              und: i.und,
              calculado: true,
              referencia: null,
              valores: Array.from({ length: 12 }, (_, k) => beneficiosPadrao(k + 1)),
              gravados: Array<boolean>(12).fill(false),
            }
          : { item: i.item, rotulo: i.rotulo, und: i.und, calculado: false, ...serie(i.venda, i.padrao, i.und === "%" ? 100 : 1) },
      ),
      contas: contasDoGrupo(est, g).map((l) => {
        const comBeneficios = l.codigo === contaDosBeneficios;
        // Sem os Benefícios Adicionais e (21/11/2026) os Benefícios Padrão: as linhas deles ficam à parte.
        const menos = (mes: number) => (comBeneficios ? beneficiosDoMes(mes) + beneficiosPadrao(mes) : 0);
        const referencia = porLinha.get(`${l.id}|0`);
        return {
          codigo: l.codigo,
          descricao: l.descricao,
          // A atribuição (Mão de Obra Direta…), pelo total dela (CPP.MOD…).
          atribuicao: totais.find((t) => t.codigo.startsWith(`${l.codigo.split(".").slice(0, 2).join(".")}.`))?.descricao ?? l.atribuicao ?? "",
          // A Encargos e Benefícios é calculada (19/10/2026): não se digita; as Remunerações também, com o Quadro de Lotação (09/11/2026)
          // ou com a mão de obra das médias (22/11/2026).
          calculada: ehContaDeEncargos(l.codigo) || remuneracoesDoGrupo.has(l.codigo),
          doQuadro: doQuadro.has(l.codigo),
          // A conta dos Benefícios Adicionais (17/11/2026): sem eles aqui; o Total do Centro os soma.
          comBeneficios,
          referencia: referencia === undefined ? null : referencia - menos(0),
          valores: Array.from({ length: 12 }, (_, k) => (porLinha.get(`${l.id}|${k + 1}`) ?? 0) - menos(k + 1)),
          gravados: Array.from({ length: 12 }, (_, k) => porLinha.has(`${l.id}|${k + 1}`)),
        };
      }),
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
    exigirSemReajustes(c);
    const prisma = getPrismaClient();
    const g = (await gruposDoCenario(id)).find((x) => x.grupo === grupo);
    if (!g) throw new CenarioError(404, "Grupo de centros de custo não encontrado.");
    exigirNoRecorte(veGrupo(recorteDoCenario(c, usuario), g));
    const est = await estruturaDRE();
    const contas = new Map(contasDoGrupo(est, g).map((l) => [l.codigo, l]));
    // As premissas da tabela: a venda, o rótulo, a escala (os percentuais chegam em %) e se aceita negativo.
    const premissa = (linha: string) => {
      const [tipo, x] = linha.split("|");
      if (tipo === "LOTACAO" && (x === "CLT" || x === "PJ")) return { venda: x === "CLT" ? VENDA_LOTACAO_CLT : VENDA_LOTACAO_PJ, rotulo: `Quadro de Lotação · Colaboradores ${x}`, escala: 1 };
      // Os Benefícios Padrão (21/11/2026) vêm da aba Quadro de Lotação e não se digitam.
      const i = tipo === "ENCARGOS" ? itemDosEncargos(x) : undefined;
      return i && !i.calculado ? { venda: i.venda, rotulo: `Encargos e Benefícios · ${i.rotulo}`, escala: i.und === "%" ? 100 : 1 } : undefined;
    };
    const fora = [...new Set(alteracoes.filter((a) => !premissa(a.linha) && (!contas.has(a.linha) || ehContaDeEncargos(a.linha))).map((a) => a.linha))];
    if (fora.length) throw new CenarioError(400, `Não são linhas que se digitam no grupo ${grupo}: ${fora.slice(0, 3).join(", ")}.`);
    // As Remunerações CLT e PJ vêm sempre da aba Quadro de Lotação (11/11/2026, pedido do Adão; antes, só nos grupos com
    // linhas lá) e não se digitam — nem na mão de obra das médias (22/11/2026: a única fonte além do quadro é o Replicar Médias);
    // os colaboradores, nos grupos com linhas (09/11/2026).
    const remuneracoes = new Set(maosDeObraDoGrupo([...contas.keys()], g.atribuicao).flatMap((m) => [m.remuneracoes, m.remuneracoesPJ]));
    if (alteracoes.some((a) => remuneracoes.has(a.linha)))
      throw new CenarioError(400, `As Remunerações CLT e PJ vêm da aba Quadro de Lotação e não se digitam: inclua ou edite as linhas do grupo ${grupo} naquela aba.`);
    // Os colaboradores também (12/11/2026, pedido do Adão: a Gestão de Colaboradores, pela aba Quadro de Lotação, é a única
    // fonte da contagem; antes, os grupos sem linhas os digitavam).
    if (alteracoes.some((a) => a.linha.startsWith("LOTACAO|")))
      throw new CenarioError(400, `Os colaboradores vêm da aba Quadro de Lotação e não se digitam: inclua ou edite as linhas do grupo ${grupo} naquela aba (ou importe o Quadro de Lotação Vigente na Referência).`);
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
        await alteradoSemRecalcular(tx, id, "premissas");
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
        alcance: [trechoDoGrupo(g)],
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
    // O recorte (12/11/2026): a depreciação base das unidades dos departamentos dele e a dos investimentos deles. A lista dos
    // investimentos (19/11/2026, pedido do Adão), sem o recorte: a aba é de todos os que a leem.
    const r = recorteDoCenario(c, usuario);
    const prisma = getPrismaClient();
    const [base, lista] = await Promise.all([
      prisma.cenarioPremissa.findMany({ where: { cenarioId: id, venda: VENDA_BASE } }),
      prisma.cenarioInvestimento.findMany({ where: { cenarioId: id }, orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }], include: { criadoPor: { select: { nome: true } } } }),
    ]);
    // Quem incluiu cada um e se o usuário o altera (19/11/2026, pedido do Adão: com recorte, só os que ele incluiu).
    const alteraTodos = alteraTodosOsInvestimentos(c, usuario);
    const comValores = lista.map(({ criadoPor, ...i }) => ({
      ...i,
      valorTotal: Number(i.valorTotal),
      valorPosUso: Number(i.valorPosUso),
      incluidoPor: criadoPor?.nome ?? null,
      podeAlterar: alteraOInvestimento(alteraTodos, i, usuario),
    }));
    const investimentos = comValores;
    const daDepreciacao = comValores.filter((i) => veDepartamentos(r, departamentosDoInvestimento(i)));
    const contas = CONTAS_DEPRECIACAO.filter((d) => veDepartamentos(r, departamentosDaUnidade(d.unidade)));
    const linhas = contas.flatMap((d) => {
      const chave = `${d.unidade}|${d.conta}`;
      const gravado = new Map(base.filter((p) => p.chave === chave).map((p) => [p.mes, Number(p.valor)]));
      const valoresBase = Array.from({ length: 12 }, (_, k) => gravado.get(k + 1) ?? 0);
      const dosInvestimentos = Array<number>(12).fill(0);
      for (const i of daDepreciacao.filter((x) => x.unidade === d.unidade && x.conta === d.conta)) depreciacaoNosMeses(i).forEach((v, k) => (dosInvestimentos[k] += v));
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
      editavel: !c.marcacao && !c.versaoSalvaEm && !c.reajustesAplicados,
      // As contas da Depreciação (as do recorte) e as da lista dos investimentos (19/11/2026: todas, para quem edita a aba).
      contas,
      contasDosInvestimentos: CONTAS_DEPRECIACAO,
      // O Departamento dos investimentos de Despesas e Extra (12/11/2026): os cinco do patrimônio, sem obrigação (sem ele, é dos cinco).
      departamentos: DEPARTAMENTOS_DO_PATRIMONIO,
      alteraTodos,
      depreciacao: linhas,
      investimentos: investimentos.map((i) => ({ ...i, depreciacaoMensal: depreciacaoMensal(i) })),
    };
  },

  /** A aba Extra-Operacional de um cenário analítico (13/10/2026): as contas de Despesas e Extra e do RN, mês a mês. */
  async extraOperacional(id: string, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    exigirNoRecorte(veDepartamentos(recorteDoCenario(c, usuario), ["EXTRA"]));
    const [est, gravadas] = await Promise.all([estruturaDRE(), getPrismaClient().cenarioPremissa.findMany({ where: { cenarioId: id, venda: VENDA_EXTRA } })]);
    const valor = new Map(gravadas.map((p) => [`${p.chave}|${p.mes}`, Number(p.valor)]));
    return {
      ano: c.ano,
      meses: Array.from({ length: 12 }, (_, k) => ({ mes: k + 1, rotulo: rotuloMes(c.ano, k + 1) })),
      editavel: !c.marcacao && !c.versaoSalvaEm && !c.reajustesAplicados,
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
    exigirSemReajustes(c);
    const prisma = getPrismaClient();
    const est = await estruturaDRE();
    const descricao = new Map(est.map((l) => [l.codigo, l.descricao]));
    const validas = new Set(
      tipo === "BASE" ? CONTAS_DEPRECIACAO.map((d) => `${d.unidade}|${d.conta}`) : UNIDADES_EXTRA.flatMap((u) => contasExtra(est, u.unidade).map((l) => `${u.unidade}|${l.codigo}`)),
    );
    const fora = [...new Set(alteracoes.filter((a) => !validas.has(a.linha)).map((a) => a.linha))];
    if (fora.length) throw new CenarioError(400, `Contas inválidas: ${fora.slice(0, 3).join(", ")}.`);
    // O recorte (12/11/2026): a depreciação base das unidades dele ou o extra-operacional.
    const deps = (linha: string): Departamento[] => (tipo === "BASE" ? departamentosDaUnidade(Number(linha.split("|")[0])) : ["EXTRA"]);
    const r = recorteDoCenario(c, usuario);
    exigirNoRecorte(alteracoes.every((a) => veDepartamentos(r, deps(a.linha))));
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
            // O Replicar Referências (13/11/2026) grava a média como ela está (6 casas).
            const valor = new Prisma.Decimal(a.valor.toFixed(origem?.modo === "REFERENCIA" ? 6 : 4));
            await tx.cenarioPremissa.upsert({ where: { cenarioId_unidade_venda_chave_mes: chave }, create: { ...chave, valor }, update: { valor } });
          }
        }
        await alteradoSemRecalcular(tx, id, "premissas");
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
        alcance: trechos([...new Set(alteracoes.map((a) => a.linha))].map((l) => ({ d: deps(l) }))),
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
    dados: {
      nomeReferencia: string;
      unidade: number;
      descricao: string;
      condicaoPagamento: string | null;
      inicio: number;
      valorTotal: number;
      valorPosUso: number;
      vidaUtil: number;
      departamento?: DepartamentoAcesso | null;
    } | null,
    usuario: Usuario,
  ) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    exigirSemReajustes(c);
    const prisma = getPrismaClient();
    const atual = investimentoId ? await prisma.cenarioInvestimento.findFirst({ where: { id: investimentoId, cenarioId: id }, include: { criadoPor: { select: { nome: true } } } }) : null;
    if (investimentoId && !atual) throw new CenarioError(404, "Investimento não encontrado.");
    // Com recorte, só os que ele incluiu (19/11/2026, pedido do Adão).
    if (atual && !alteraOInvestimento(alteraTodosOsInvestimentos(c, usuario), atual, usuario)) throw new CenarioError(403, foraDosSeusInvestimentos(atual));
    // O Departamento (12/11/2026): só nos de Despesas e Extra, um dos cinco do patrimônio. A lista não tem recorte (19/11/2026).
    const departamento = dados && dados.unidade === 4 ? (dados.departamento ?? null) : null;
    if (departamento && !DEPARTAMENTOS_DO_PATRIMONIO.includes(departamento)) throw new CenarioError(400, "Departamento inválido para um investimento de Despesas e Extra.");
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
            departamento,
          };
          if (atual) await tx.cenarioInvestimento.update({ where: { id: atual.id }, data: valores });
          // Quem incluiu (19/11/2026): fica com ele, também quando outro o altera.
          else await tx.cenarioInvestimento.create({ data: { ...valores, cenarioId: id, criadoPorId: usuario.id || null, ordem: await tx.cenarioInvestimento.count({ where: { cenarioId: id } }) } });
        }
        await alteradoSemRecalcular(tx, id, "premissas", false);
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
        // Os trechos de investimento (`i`, 19/11/2026): quem edita a aba Investimentos os vê com qualquer recorte.
        alcance: trechos([
          ...(atual ? [{ d: departamentosDoInvestimento(atual), i: true as const }] : []),
          ...(dados ? [{ d: departamentosDoInvestimento({ unidade: dados.unidade, departamento }), i: true as const }] : []),
        ]),
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
    exigirSemReajustes(c);
    const prisma = getPrismaClient();
    const lista = await prisma.cenarioInvestimento.findMany({
      where: { cenarioId: id, id: { in: ids } },
      orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }],
      include: { criadoPor: { select: { nome: true } } },
    });
    if (lista.length !== new Set(ids).size) throw new CenarioError(404, "Algum investimento não foi encontrado: atualize a tela.");
    // Com recorte, só os que ele incluiu (19/11/2026, pedido do Adão).
    const alteraTodos = alteraTodosOsInvestimentos(c, usuario);
    const alheios = lista.filter((i) => !alteraOInvestimento(alteraTodos, i, usuario));
    if (alheios.length === 1) throw new CenarioError(403, foraDosSeusInvestimentos(alheios[0]));
    if (alheios.length)
      throw new CenarioError(
        403,
        `${alheios.length} dos investimentos marcados foram incluídos por outros usuários (${alheios.map((i) => i.nomeReferencia).join(", ").slice(0, 300)}): com recorte, você exclui só os investimentos que incluiu.`,
      );
    await prisma.$transaction(
      async (tx) => {
        await tx.cenarioInvestimento.deleteMany({ where: { cenarioId: id, id: { in: ids } } });
        await alteradoSemRecalcular(tx, id, "premissas", false);
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
        alcance: trechos(lista.map((i) => ({ d: departamentosDoInvestimento(i), i: true as const }))),
      },
    });
    await auditar({ usuarioId: usuario.id, usuarioNome: usuario.nome, acao: "EXCLUSAO", entidade: "cenario_investimento", entidadeId: id, antes: lista, metadados: { cenario: c.nome, excluidos: lista.length } });
    return this.investimentos(id, usuario);
  },

  /**
   * A aba Quadro de Lotação de um cenário analítico (09/11/2026, etapa 4 da Gestão de Colaboradores; quadroDoCenario.ts): as
   * linhas, como as do Lançamento Inicial, com os colaboradores e os salários de cada mês e o grupo do centro, e as opções:
   * as unidades e as funções ativas e os centros dos grupos do cenário.
   */
  async quadro(id: string, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    const [linhas, cad, referencia, beneficios] = await Promise.all([
      getPrismaClient().cenarioLotacao.findMany({ where: { cenarioId: id }, orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }], include: INCLUIR_DO_QUADRO }),
      cadastrosDoQuadro(id),
      // Os colaboradores de cada linha na referência (16/11/2026): a coluna Colab. Ref. e o Replicar Referências da tela.
      detalheDaReferencia(c).then((d) => colunaDoQuadroDe(d, id)),
      // Os Benefícios Padrão do cenário (21/11/2026): o modal do botão Benefícios e o valor de cada mês.
      getPrismaClient().cenarioBeneficioPadrao.findMany({ where: { cenarioId: id }, orderBy: [{ ordem: "asc" }, { nome: "asc" }] }),
    ]);
    const valores = new Map(beneficios.map((b) => [b.id, Number(b.valorMensal)]));
    // O recorte (12/11/2026): as linhas e os centros dos grupos dele.
    const r = recorteDoCenario(c, usuario);
    exigirNoRecorte(!r || abasDoRecorte(r)!.includes("quadro"));
    const q = recorteDoQuadroCom(r, cad);
    return {
      ano: c.ano,
      meses: Array.from({ length: 12 }, (_, k) => ({ mes: k + 1, rotulo: rotuloMes(c.ano, k + 1) })),
      editavel: !c.marcacao && !c.versaoSalvaEm && !c.reajustesAplicados,
      referencia: referencia ? { rotulo: referencia.rotulo } : null,
      linhas: linhas.filter((l) => q.ve(l.centroCustoId)).map((l) => ({
        id: l.id,
        unidadeNegocioId: l.unidadeNegocioId,
        // O nome da unidade na cópia do cenário (20/11/2026).
        unidade: cad.nomeDaUnidade.get(l.unidadeNegocioId) ?? l.unidadeNegocio.nome,
        vinculo: l.vinculo,
        funcaoId: l.funcaoId,
        funcao: l.funcao.nome,
        centroCustoId: l.centroCustoId,
        centro: rotuloDoCentro(l.centroCusto),
        // Só o nome (21/11/2026, pedido do Adão: a coluna Centro de Custo da tabela, sem o código RM).
        nomeDoCentro: l.centroCusto.nomeRM,
        // O grupo do centro (null: fora dos grupos do cenário; a linha não conta).
        grupo: cad.grupoDoCentro.get(l.centroCustoId)?.grupo ?? null,
        // Os Benefícios de cada mês (21/11/2026): o valor e os Benefícios Padrão aplicados (ou o valor digitado na importação).
        meses: mesesDaLinha(l.meses).map((m) => ({ ...m, beneficios: beneficiosDoMes(m, valores) })),
        // Os colaboradores da linha na referência (nulo: a linha não está nela, ou o cenário não tem referência).
        referencia: referencia ? referencia.daLinha(l) : null,
      })),
      beneficios: beneficios.map((b) => ({ id: b.id, nome: b.nome, descricao: b.descricao, valorMensal: Number(b.valorMensal) })),
      opcoes: { unidades: cad.unidades, funcoes: cad.funcoes, centros: cad.centros.filter((x) => q.ve(x.id)) },
    };
  },

  /** Nova linha do Quadro de Lotação (linhaId null), a alteração dos cadastros de uma (sem `meses`, eles ficam) ou a exclusão (dados null). */
  async gravarLinhaDoQuadro(id: string, linhaId: string | null, dados: (Omit<DadosDaLinhaDoQuadro, "meses"> & { meses?: MesDaLinha[] }) | null, usuario: Usuario) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    exigirSemReajustes(c);
    const prisma = getPrismaClient();
    const atual = linhaId ? await prisma.cenarioLotacao.findFirst({ where: { id: linhaId, cenarioId: id }, include: INCLUIR_DO_QUADRO }) : null;
    if (linhaId && !atual) throw new CenarioError(404, "Linha do Quadro de Lotação não encontrada: atualize a tela.");
    // O recorte (12/11/2026): a linha de antes e o centro novo.
    const q = await recorteDoQuadro(recorteDoCenario(c, usuario), id);
    if (atual) exigirNoRecorte(q.ve(atual.centroCustoId));
    if (dados) exigirNoRecorte(q.ve(dados.centroCustoId));
    const meses = dados?.meses ?? (atual ? mesesDaLinha(atual.meses) : Array.from({ length: 12 }, () => ({ colaboradores: 0, salarioBruto: 0, adicional: 0 })));
    if (dados) {
      const recusa = recusaDaLinha({ ...dados, meses }, await cadastrosDoQuadro(id), atual);
      if (recusa) throw new CenarioError(400, recusa);
    }
    let gravada = atual;
    await prisma.$transaction(
      async (tx) => {
        if (!dados) await tx.cenarioLotacao.delete({ where: { id: linhaId! } });
        else {
          const campos = { unidadeNegocioId: dados.unidadeNegocioId, vinculo: dados.vinculo, funcaoId: dados.funcaoId, centroCustoId: dados.centroCustoId };
          const l = atual
            ? await tx.cenarioLotacao.update({ where: { id: atual.id }, data: campos, include: INCLUIR_DO_QUADRO })
            : await tx.cenarioLotacao.create({ data: { ...campos, cenarioId: id, ordem: await tx.cenarioLotacao.count({ where: { cenarioId: id } }) }, include: INCLUIR_DO_QUADRO });
          if (dados.meses || !atual) {
            await tx.cenarioLotacaoMes.deleteMany({ where: { linhaId: l.id } });
            await tx.cenarioLotacaoMes.createMany({ data: mesesParaGravar(l.id, meses) });
          }
          gravada = l;
        }
        await alteradoSemRecalcular(tx, id, "premissas");
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
        alcance: trechos([...(atual ? [q.trecho(atual.centroCustoId)] : []), ...(dados ? [q.trecho(dados.centroCustoId)] : [])]),
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
    exigirSemReajustes(c);
    const prisma = getPrismaClient();
    const lista = await prisma.cenarioLotacao.findMany({ where: { cenarioId: id, id: { in: ids } }, include: INCLUIR_DO_QUADRO });
    if (lista.length !== new Set(ids).size) throw new CenarioError(404, "Alguma linha do Quadro de Lotação não foi encontrada: atualize a tela.");
    const q = await recorteDoQuadro(recorteDoCenario(c, usuario), id);
    exigirNoRecorte(lista.every((l) => q.ve(l.centroCustoId)));
    await prisma.$transaction(
      async (tx) => {
        await tx.cenarioLotacao.deleteMany({ where: { cenarioId: id, id: { in: ids } } });
        await alteradoSemRecalcular(tx, id, "premissas");
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
        alcance: trechos(lista.map((l) => q.trecho(l.centroCustoId))),
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
    exigirSemReajustes(c);
    const prisma = getPrismaClient();
    const ids = [...new Set(alteracoes.map((a) => a.linha))];
    const linhas = await prisma.cenarioLotacao.findMany({ where: { cenarioId: id, id: { in: ids } }, include: INCLUIR_DO_QUADRO });
    if (linhas.length !== ids.length) throw new CenarioError(404, "Alguma linha do Quadro de Lotação não foi encontrada: atualize a tela.");
    const q = await recorteDoQuadro(recorteDoCenario(c, usuario), id);
    exigirNoRecorte(linhas.every((l) => q.ve(l.centroCustoId)));
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
        await alteradoSemRecalcular(tx, id, "premissas");
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
        alcance: trechos(linhas.map((l) => q.trecho(l.centroCustoId))),
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
    const [est, linhas, gravadas, grupos, valores, projetos] = await Promise.all([
      estruturaDRE(),
      linhasDoCadastro(),
      prisma.cenarioPremissa.findMany({ where: { cenarioId: id } }),
      gruposDoCenario(id),
      // Só os meses: o mês 0 é a Média de Referência (15/10/2026).
      prisma.cenarioCentro.findMany({ where: { cenarioId: id, mes: { gte: 1 } }, include: { linhaDRE: { select: { codigo: true } } } }),
      prisma.cenarioIndicador.findMany({ where: ondeEstaoOsProjetos(id), select: { nome: true, mes: true, valor: true } }),
    ]);
    const { bases } = calcularPremissas(est, linhas, c.ano, gravadas);
    // A base do rateio de Projeto (16/11/2026): a Liberação de Projetos dos Indicadores Manuais.
    for (const [chave, lista] of basesDosProjetos(projetos)) bases.set(chave, lista);
    // Os percentuais pelas regras de rateio do mês (14/10/2026; antes, só as bases das premissas).
    const percentuais = percentuaisPelasRegras(await regrasDeRateioDoCenario(getPrismaClient(), c.id), c.ano, bases);
    // O recorte (12/11/2026): as chaves dos grupos de centros dele e, para o Gestor, os destinos dos departamentos dele.
    const recorte = recorteDoCenario(c, usuario);
    const visiveis = gruposDoRecorte(recorte, grupos);
    const chavesDoRecorte = new Set(visiveis.map((g) => g.balde));
    const DO_DESTINO: Record<string, Departamento> = { MATRIZ: "PRODUCAO", FILIAL: "PRODUCAO", MONTAGEM: "SERVICOS", COMPLEMENTAR: "SERVICOS" };
    const veRateio = (x: { chave: string; destino: string }) =>
      !recorte || chavesDoRecorte.has(x.chave) || (!recorte.centros && !!DO_DESTINO[x.destino] && recorte.departamentos.has(DO_DESTINO[x.destino]));
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
        visiveis,
        valores.map((x) => ({ grupo: x.grupo, codigo: x.linhaDRE.codigo, mes: x.mes, valor: Number(x.valor) })),
        percentuais,
      ).map((x) => ({ ...x, nome: nomes.get(x.chave) ?? x.chave, rotuloMes: rotuloMes(c.ano, x.mes) })),
      rateios: [...RATEIOS, ...extras].filter(veRateio).map((r) => ({
        ...r,
        bases: bases.get(`${r.chave}|${r.destino}`) ?? Array<number>(12).fill(0),
        percentuais: percentuais.map((p) => p.get(`${r.chave}|${r.destino}`) ?? 0),
      })),
    };
  },

  /**
   * A aba Verificações das Premissas (20/11/2026, pedido do Adão): as inconsistências nos valores, do recorte do usuário, com a
   * aba, a linha ou o centro de custo, o responsável e a situação, e se o usuário dá o De Acordo em cada uma.
   */
  async verificacoes(id: string, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    const recorte = recorteDoCenario(c, usuario);
    const { lista, grupos } = await verificacoesComSituacao(c);
    const editavel = !c.marcacao && !c.versaoSalvaEm;
    const visiveis = lista.filter((v) => veVerificacao(recorte, v, grupos));
    return {
      editavel,
      pendentes: visiveis.filter((v) => !v.acordo).length,
      // As do cenário inteiro (as de fora do recorte também seguram o Congelar Versão).
      pendentesNoCenario: lista.filter((v) => !v.acordo).length,
      verificacoes: visiveis.map((v) => ({
        chave: v.chave,
        tipo: v.tipo,
        titulo: TITULO_DA_VERIFICACAO[v.tipo],
        aba: v.aba,
        abaRotulo: ROTULO_DA_ABA[v.aba],
        grupo: v.grupo,
        alvo: v.alvo,
        descricao: v.descricao,
        meses: v.meses,
        mesesTexto: textoDosMeses(v.meses),
        // Quem alterou os valores por último (a dica da coluna Responsável).
        responsavel: v.responsavel ? { nome: v.responsavel.nome, em: v.responsavel.em } : null,
        // O responsável imediato (21/11/2026, pedido do Adão: só ele na coluna; mais de um só no mesmo nível da hierarquia).
        responsaveis: v.responsaveis.map((r) => r.nome),
        acordo: v.acordo ? { nome: v.acordo.nome, em: v.acordo.em } : null,
        acordoAnterior: v.acordoAnterior ? { nome: v.acordoAnterior.nome, em: v.acordoAnterior.em } : null,
        podeAcordar: editavel && daOAcordo(v, usuario),
      })),
    };
  },

  /**
   * O De Acordo (ou a retirada dele) nas verificações marcadas (20/11/2026): só o responsável imediato por cada uma (21/11/2026: o
   * Analista, o Coordenador, o Estratégico ou o Gestor do recorte dela) ou o Administrador, no cenário editável. O De Acordo guarda
   * a assinatura dos valores de hoje.
   */
  async acordarVerificacoes(id: string, chaves: string[], deAcordo: boolean, usuario: Usuario) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    const recorte = recorteDoCenario(c, usuario);
    const { lista, grupos } = await verificacoesComSituacao(c);
    const pedidas = new Set(chaves);
    const alvo = lista.filter((v) => pedidas.has(v.chave) && veVerificacao(recorte, v, grupos));
    if (!alvo.length || alvo.length !== pedidas.size) throw new CenarioError(409, "As verificações mudaram (corrigidas ou com outros valores): atualize a aba Verificações e marque de novo.");
    const deOutros = alvo.filter((v) => !daOAcordo(v, usuario));
    if (deOutros.length) {
      const nomes = [...new Set(deOutros.flatMap((v) => (v.responsaveis.length ? v.responsaveis.map((r) => r.nome) : ["quem criou o cenário"])))];
      throw new CenarioError(
        403,
        `Só o responsável (ou o Administrador) dá ou retira o De Acordo: ${deOutros.length} ${deOutros.length === 1 ? "das marcadas é" : "das marcadas são"} de ${nomes.join(", ")}.`,
      );
    }
    const prisma = getPrismaClient();
    if (deAcordo)
      await prisma.$transaction(
        alvo.map((v) =>
          prisma.cenarioVerificacaoAcordo.upsert({
            where: { cenarioId_chave: { cenarioId: id, chave: v.chave } },
            create: { cenarioId: id, chave: v.chave, assinatura: v.assinatura, usuarioId: usuario.id || null, usuarioNome: usuario.nome },
            update: { assinatura: v.assinatura, usuarioId: usuario.id || null, usuarioNome: usuario.nome, criadoEm: new Date() },
          }),
        ),
      );
    else await prisma.cenarioVerificacaoAcordo.deleteMany({ where: { cenarioId: id, chave: { in: alvo.map((v) => v.chave) } } });
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "ALTERACAO",
      entidade: "cenario_verificacao",
      entidadeId: id,
      depois: { deAcordo, verificacoes: alvo.map((v) => `${TITULO_DA_VERIFICACAO[v.tipo]} · ${v.alvo}`) },
      metadados: { cenario: c.nome, deAcordo },
    });
    return this.verificacoes(id, usuario);
  },

  /**
   * Replicar Médias / Apagar Valores (15/10/2026), em todas as abas das premissas: replicar leva a Média de Referência de
   * cada linha aos doze meses (as linhas sem média ficam como estão); apagar deixa os meses em branco. Recalcula a DRE; vai para o histórico (tela Reajustes).
   */
  async replicarMedias(id: string, acao: "replicar" | "apagar", usuario: Usuario) {
    const c = await obterOuFalhar(id, usuario);
    // Em Configurações / Referência (12/11/2026): a Edição das Configurações vale para eles.
    exigirQuemCriou(c, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    exigirSemReajustes(c);
    // As linhas calculadas (o Total de Colaboradores e a conta Encargos e Benefícios, 19/10/2026) não se replicam nem apagam.
    // Com o Acesso às Informações Por Recorte (12/11/2026), só as linhas do recorte de quem o usa (a Edição Pública).
    const recorte = recorteDoCenario(c, usuario);
    const gruposDoMedias = new Map((await gruposDoCenario(id)).map((g) => [g.grupo, g]));
    const todas = (await linhasDaPlanilha(c)).filter((l) => veLinha(recorte, l, gruposDoMedias));
    const linhas = todas.filter((l) => !l.calculada);
    const prisma = getPrismaClient();
    // A média como ela fica gravada (22/11/2026): os meses já iguais a ela não mudam — sem isso, a média com mais casas que as
    // gravadas (os padrões de Férias, 1/9, e do 13º, 1/12) contava como alteração a cada Replicar Médias.
    const paraAMedia = (l: LinhaDaPlanilha): MudancaDaPlanilha[] => {
      const gravada = l.media === null ? null : comoGravado(l.chave, l.media);
      return MESES_1_A_12.filter((m) => !iguais(l.meses[m - 1], gravada)).map((mes) => ({ chave: l.chave, mes, valor: l.media }));
    };
    // A mão de obra das médias (22/11/2026, pedido do Adão; maoDeObraDasMedias.ts): nos grupos com Média de Referência em alguma
    // Remuneração CLT ou PJ ou nos Encargos e Benefícios, as Remunerações vão direto aos doze meses (sem média, zero, como no
    // realizado) e os Encargos, pela média deles (no cálculo); o grupo fica marcado, com a verificação, até o Quadro de Lotação dele
    // mudar. O Apagar Valores tira as marcas (os grupos voltam ao quadro).
    const quadro = quadroDosGrupos(await linhasDoQuadro(prisma, id), [...gruposDoMedias.values()]);
    const jaDasMedias = gruposDasMedias(await marcadoresDasMedias(prisma, id), quadro).validos;
    const daMaoDeObra = todas.filter((l) => l.aba === "centros" && l.grupo && l.conta && (/\.REMUNERACOES_(CLT|PJ)$/.test(l.conta) || ehContaDeEncargos(l.conta)));
    const comMedia = (l: LinhaDaPlanilha) => l.media !== null && Math.abs(l.media) >= 0.005;
    const gruposDaMaoDeObra = acao === "replicar" ? [...new Set(daMaoDeObra.filter(comMedia).map((l) => l.grupo!))] : [];
    const novosDasMedias = gruposDaMaoDeObra.filter((g) => !jaDasMedias.has(g));
    const desmarcados = acao === "apagar" ? [...jaDasMedias].filter((g) => daMaoDeObra.some((l) => l.grupo === g)) : [];
    const remuneracoes = daMaoDeObra.filter((l) => !ehContaDeEncargos(l.conta!) && gruposDaMaoDeObra.includes(l.grupo!));
    // Em Serviços, as linhas por dia útil (22/11/2026, pedido do Adão: sem volume nas listas, os valores médios são por dia e a
    // Demanda Diária fica sem Média de Referência): Demanda 1 nos meses em branco (a digitada fica), para os valores por dia × os
    // dias úteis darem o realizado.
    const comValorMedio = (venda: string, codigo: string) =>
      linhas.some((x) => (x.chave.startsWith(`P|3|${venda}|RB:${codigo}:`) || x.chave.startsWith(`P|3|${venda}|CUSTO:${codigo}:`)) && comMedia(x));
    const demandasPorDia =
      acao === "replicar"
        ? linhas.filter((l) => {
            const m = /^P\|3\|([^|]+)\|DEMANDA:(.+)$/.exec(l.chave);
            return !!m && l.media === null && comValorMedio(m[1], m[2]);
          })
        : [];
    const mudancas: MudancaDaPlanilha[] = [
      ...linhas.flatMap((l) =>
        acao === "apagar" ? MESES_1_A_12.filter((m) => l.meses[m - 1] !== null).map((mes) => ({ chave: l.chave, mes, valor: null })) : l.media === null ? [] : paraAMedia(l),
      ),
      ...remuneracoes.flatMap(paraAMedia),
      ...demandasPorDia.flatMap((l) => MESES_1_A_12.filter((m) => l.meses[m - 1] === null).map((mes) => ({ chave: l.chave, mes, valor: 1 }))),
    ];
    // Os Encargos dos grupos que já estão nas médias (22/11/2026): com outra Média de Referência (outra referência, mantendo os
    // meses), a base gravada (maoDeObraDasMedias.ts) fica para trás, e o Replicar Médias a troca — marcarGrupos a tira, e o cálculo
    // a grava de novo com a média de agora. Sem base gravada (um marcador de antes delas), o cálculo já a grava com a de agora.
    const gravadasDasMedias =
      acao === "replicar" && jaDasMedias.size
        ? new Map(
            (
              await prisma.cenarioPremissa.findMany({
                where: { cenarioId: id, unidade: 0, mes: 0, chave: { in: [...jaDasMedias] }, venda: { in: [VENDA_DA_BASE.direta, VENDA_DA_BASE.indireta] } },
                select: { venda: true, chave: true, valor: true },
              })
            ).map((p) => [`${p.venda}|${p.chave}`, Number(p.valor)]),
          )
        : new Map<string, number>();
    const baseVencida = (l: LinhaDaPlanilha) => {
      if (!jaDasMedias.has(l.grupo!) || !gruposDaMaoDeObra.includes(l.grupo!) || !ehContaDeEncargos(l.conta!)) return false;
      const codigos = daMaoDeObra.filter((x) => x.grupo === l.grupo).map((x) => x.conta!);
      const mo = maosDeObraDoGrupo(codigos, gruposDoMedias.get(l.grupo!)!.atribuicao).find((x) => x.encargos === l.conta);
      const gravada = mo && gravadasDasMedias.get(`${vendaDaBase(mo.direta)}|${l.grupo}`);
      if (!mo || gravada === undefined) return false;
      // A média da linha já é a base (baseDasMedias): na planilha, a conta que leva os Benefícios Adicionais sai sem a média deles.
      return Math.abs(gravada - (l.media ?? 0)) >= 0.005;
    };
    // As linhas da mão de obra que mudam só no cálculo (os Encargos dos grupos que entram nas médias ou com a base vencida; nos que
    // saem, também as Remunerações, que voltam ao quadro).
    const doCalculo = daMaoDeObra.filter((l) => (novosDasMedias.includes(l.grupo!) && ehContaDeEncargos(l.conta!)) || desmarcados.includes(l.grupo!) || baseVencida(l));
    // Nada a mudar (22/11/2026): sem gravação, sem a pendência de recálculo e sem a entrada no Histórico.
    if (!mudancas.length && !doCalculo.length) return { linhas: 0, valores: 0, grupos: 0 };
    const est = await estruturaDRE();
    await prisma.$transaction(
      async (tx) => {
        await aplicarMudancas(tx, id, mudancas, est);
        await marcarGrupos(tx, id, gruposDaMaoDeObra, quadro);
        await tirarMarcadores(tx, id, desmarcados);
        await alteradoSemRecalcular(tx, id, "premissas");
      },
      { timeout: 300_000 },
    );
    const mudadas = new Set([...mudancas.map((m) => m.chave), ...doCalculo.map((l) => l.chave)]);
    const nLinhas = mudadas.size;
    const nValores = mudancas.length + 12 * doCalculo.filter((l) => !mudancas.some((m) => m.chave === l.chave)).length;
    const maoDeObra = gruposDaMaoDeObra.length
      ? `; a mão de obra das médias em ${gruposDaMaoDeObra.length} ${gruposDaMaoDeObra.length === 1 ? "grupo" : "grupos"} de centros`
      : desmarcados.length
        ? `; ${desmarcados.length} ${desmarcados.length === 1 ? "grupo volta" : "grupos voltam"} ao Quadro de Lotação`
        : "";
    const descricao =
      acao === "replicar"
        ? `Médias de Referência replicadas nos doze meses (${nLinhas} ${nLinhas === 1 ? "linha" : "linhas"}, em todas as abas das premissas${maoDeObra})`
        : `Valores mensais apagados (${nLinhas} ${nLinhas === 1 ? "linha" : "linhas"}, em todas as abas das premissas${maoDeObra})`;
    await prisma.cenarioReajuste.create({
      data: {
        cenarioId: id,
        usuarioId: usuario.id || null,
        usuarioNome: usuario.nome,
        tipo: "MEDIAS",
        descricao: recorte ? descricao.replace("em todas as abas das premissas", "no recorte de quem replicou") : descricao,
        valores: nValores,
        meses: MESES_1_A_12,
        ...(recorte ? { alcance: trechos(todas.filter((l) => mudadas.has(l.chave)).map((l) => trechoDaLinha(l, gruposDoMedias))) } : {}),
      },
    });
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "ALTERACAO",
      entidade: "cenario",
      entidadeId: id,
      metadados: { cenario: c.nome, premissas: acao, linhas: nLinhas, valores: nValores, maoDeObraDasMedias: gruposDaMaoDeObra, voltamAoQuadro: desmarcados },
    });
    return { linhas: nLinhas, valores: nValores, grupos: gruposDaMaoDeObra.length };
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
    const cadastro = await gruposDoCenario(id);
    const grupoDRE = new Map(cadastro.map((g) => [g.grupo, g.grupoDRE]));
    // O recorte (12/11/2026): os departamentos dele (o Coordenador, os dos grupos dele) e só as linhas, os investimentos e o
    // Quadro de Lotação do recorte.
    const recorte = recorteDoCenario(c, usuario);
    const gruposPorNome = new Map(cadastro.map((g) => [g.grupo, g]));
    if (recorte)
      departamentos = recorte.centros
        ? DEPARTAMENTOS.map((d) => d.chave).filter((d) => gruposDoRecorte(recorte, cadastro).some((g) => departamentoDoGrupoDRE(g.grupoDRE) === d))
        : departamentos.filter((d) => recorte.departamentos.has(d));
    if (!departamentos.length) throw new CenarioError(400, "Nada a exportar: os departamentos marcados ficam fora do seu recorte.");
    const dos = (ds: Departamento[]) => ds.some((d) => departamentos.includes(d));
    // Os meses da referência (11/11/2026, pedido do Adão): o realizado ou o outro cenário, antes da Média de Referência.
    const fonte = await fontesDaReferencia(c);
    const referencia: ReferenciaDasAbas | undefined = fonte ? { rotulo: fonte.rotulo, meses: fonte.meses, descricao: fonte.descricao } : undefined;
    const linhas = (await linhasDaPlanilha(c, fonte)).filter((l) => abas.includes(l.aba) && dos(departamentosDaLinha(l, grupoDRE)) && veLinha(recorte, l, gruposPorNome));
    // A aba Investimentos com todos os investimentos do cenário (19/11/2026: a lista não tem recorte, e a aba importada substitui
    // os investimentos de quem importa — com só os dos departamentos marcados, os dele de outros departamentos sairiam).
    const investimentos = abas.includes("investimentos")
      ? (await getPrismaClient().cenarioInvestimento.findMany({ where: { cenarioId: id }, orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }] })).map((i) => ({
          ...i,
          valorTotal: Number(i.valorTotal),
          valorPosUso: Number(i.valorPosUso),
        }))
      : null;
    // O Quadro de Lotação (09/11/2026): as linhas dos centros dos departamentos escolhidos (a de um centro fora dos grupos vai sempre).
    const quadroDaPlanilha = abas.includes("quadro")
      ? await (async () => {
          const cad = await cadastrosDoQuadro(id);
          const ls = await getPrismaClient().cenarioLotacao.findMany({ where: { cenarioId: id }, orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }], include: INCLUIR_DO_QUADRO });
          const valores = await valoresDosBeneficios(getPrismaClient(), id);
          return {
            listas: { unidades: cad.unidades.map((u) => u.nome) },
            linhas: ls
              .filter((l) => {
                const d = departamentoDoGrupoDRE(cad.grupoDoCentro.get(l.centroCustoId)?.grupoDRE);
                return (!d || departamentos.includes(d)) && veCentro(recorte, l.centroCusto.origemId, cad.grupoDoCentro.get(l.centroCustoId));
              })
              .map((l) => ({
                id: l.id,
                unidade: cad.nomeDaUnidade.get(l.unidadeNegocioId) ?? l.unidadeNegocio.nome,
                tipo: ROTULO_DO_TIPO[l.vinculo],
                funcao: l.funcao.nome,
                centro: rotuloDoCentro(l.centroCusto),
                meses: mesesDaLinha(l.meses),
                // Os Benefícios de cada mês (21/11/2026): o valor, que no Excel se digita.
                beneficios: mesesDaLinha(l.meses).map((m) => beneficiosDoMes(m, valores)),
                // A coluna da referência (11/11/2026): o QL Realizado ou o último mês do cenário de origem.
                referencia: fonte?.colunaDoQuadro ? fonte.colunaDoQuadro.daLinha(l) : null,
              })),
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
        ...(daAba(a).length ? [abaDaPlanilha(NOME_DA_ABA[a], a, daAba(a), meses, geracao, referencia)] : []),
        ...(a === "quadro" && quadroDaPlanilha
          ? [
              abaDoQuadroDeLotacao(
                quadroDaPlanilha.linhas,
                meses,
                geracao,
                quadroDaPlanilha.listas,
                fonte?.colunaDoQuadro
                  ? {
                      rotulo: fonte.colunaDoQuadro.rotulo,
                      explicacao:
                        fonte.rotulo === "Realizado"
                          ? "traz os colaboradores da linha (o centro de custo, o tipo e a função) no Quadro de Lotação realizado da competência mais recente da Gestão de Colaboradores"
                          : `traz os colaboradores da linha no último mês do Quadro de Lotação de ${fonte.descricao}`,
                    }
                  : undefined,
                // Os departamentos do arquivo (11/11/2026): as linhas do cenário que a aba substitui na importação.
                nomesDosDepartamentos,
              ),
            ]
          : []),
        ...(a === "investimentos" && investimentos ? [abaDeInvestimentos(investimentos, geracao)] : []),
      ]);
    const visoes = [...nomesDosDepartamentos];
    if (escopo === "centros_arquivos") {
      const arquivos = grupos.map((g) => ({
        nome: limparNome(`${departamento.get(g) ?? nomeDoDepartamento(null)} - ${g} - ${sufixo}.xlsx`),
        conteudo: gerarXlsx([abaDaPlanilha(g, "centros", daAba("centros").filter((l) => l.grupo === g), meses, geracao, referencia)], `${sufixo} - ${g}`),
      }));
      const outras = demais();
      if (outras.length) arquivos.push({ nome: limparNome(`${sufixo} - demais abas (${deQuais}).xlsx`), conteudo: gerarXlsx(outras, `${sufixo} - demais abas`) });
      return { nomeArquivo: limparNome(`${sufixo} - ${deQuais} (um arquivo por centro).zip`), tipo: TIPO_ZIP, conteudo: zipDeArquivos(arquivos), visoes };
    }
    // A aba Quadro de Lotação no mesmo arquivo (11/11/2026): os centros dos grupos com linhas nela vão em fórmula sobre ela
    // (no um arquivo por centro, não: ela fica em outro arquivo).
    const noArquivo = quadroDaPlanilha ? quadroDoArquivo(quadroDaPlanilha.linhas.length, !!fonte?.colunaDoQuadro) : undefined;
    const umPorAba = escopo === "centros_abas" && grupos.length > 0;
    const doCentro = new Map<AbaEscrita, LinhaDaPlanilha[]>();
    const centros = !daAba("centros").length
      ? []
      : umPorAba
        ? grupos.map((g) => {
            const ls = daAba("centros").filter((l) => l.grupo === g);
            const p = abaDaPlanilha(g, "centros", ls, meses, geracao, referencia, noArquivo);
            doCentro.set(p, ls);
            return p;
          })
        : [abaDaPlanilha(NOME_DA_ABA.centros, "centros", daAba("centros"), meses, geracao, referencia, noArquivo)];
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
        if (ls) origensDaAba(origens, p.nome, ls, referencia);
      });
      planilhas.unshift(
        abaConsolidado({
          est: await estruturaDRE(),
          informacoes: [
            geracao,
            "A DRE das contas dos centros de custo: cada conta é a soma dela nas abas dos centros (em fórmulas: acompanha os valores das abas); as atribuições, os grupos e o total somam as contas. Confira com a DRE do cenário (tela Resultados / Consolidado): o total bate; por conta, a parte dos rateios que vai para Serviços (Metalurgia, Armadura e Acompanhamento) está, na DRE, nas contas da CSM ou da CSC. A conta Encargos e Benefícios soma a linha dela e a dos Benefícios Adicionais (nas abas, separadas). O Quadro de Lotação não entra, e esta aba não se importa.",
          ],
          // Os meses da referência (11/11/2026), com ela, antes da Média de Referência; o Total soma os doze meses do cenário.
          rotulos: [...(referencia ? referencia.meses.map((m) => `${referencia.rotulo} · ${m}`) : []), "Média de Referência", ...meses],
          total: referencia ? [13, 24] : [1, 12],
          origens,
          rodape: `Premissas · ${ABA_CONSOLIDADO}`,
          quebra: true,
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
    const atuais = await linhasDaPlanilha(c);
    const porChave = new Map(atuais.map((l) => [l.chave, l]));
    // O recorte (12/11/2026): as linhas, os investimentos e o Quadro de Lotação de fora dele recusam o arquivo.
    const recorte = recorteDoCenario(c, usuario);
    const gruposPorNome = new Map((await gruposDoCenario(id)).map((g) => [g.grupo, g]));
    // Sem a coluna Código (11/11/2026, pedido do Adão), a linha pela aba e pelas descrições (que não se repetem numa aba; a
    // repetida não se acha).
    const vezes = new Map<string, number>();
    for (const l of atuais) vezes.set(chaveDaDescricao(l.aba, l.descricao), (vezes.get(chaveDaDescricao(l.aba, l.descricao)) ?? 0) + 1);
    const porDescricao = new Map(atuais.filter((l) => vezes.get(chaveDaDescricao(l.aba, l.descricao)) === 1).map((l) => [chaveDaDescricao(l.aba, l.descricao), l]));
    // Os investimentos do cenário pelo Nome de Referência (sem diferença de maiúsculas).
    const existentes = new Map(
      (await getPrismaClient().cenarioInvestimento.findMany({ where: { cenarioId: id }, include: { criadoPor: { select: { nome: true } } } })).map((i) => [chaveDoNome(i.nomeReferencia), i]),
    );
    const lidos = lerArquivoDePremissas(arquivo, conteudo);
    // O Quadro de Lotação (09/11/2026): os cadastros pelos textos, como no Lançamento Inicial, e as linhas do cenário pelo
    // código (nos arquivos de antes) ou, desde 11/11/2026, substituídas nos departamentos do arquivo.
    const comQuadro = lidos.some((r) => r.quadro.length || r.substituiQuadro);
    const [resolver, cad, linhasDoCenario] = comQuadro
      ? await Promise.all([
          // A unidade e o centro pelas cópias do cenário (20/11/2026, Cadastros por cenário).
          (async () => {
            const [unidades, centros] = await Promise.all([
              getPrismaClient().cenarioUnidade.findMany({ where: { cenarioId: id }, select: { unidadeNegocioId: true, nome: true, unidadeNegocio: { select: { codigo: true } } } }),
              getPrismaClient().cenarioCentroCusto.findMany({ where: { cenarioId: id }, select: { id: true, codigoRM: true, nomeRM: true, ativo: true } }),
            ]);
            return resolvedorDeColaboradores(getPrismaClient(), { unidades: unidades.map((u) => ({ id: u.unidadeNegocioId, codigo: u.unidadeNegocio.codigo, nome: u.nome })), centros });
          })(),
          cadastrosDoQuadro(id),
          getPrismaClient().cenarioLotacao.findMany({
            where: { cenarioId: id },
            orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }],
            include: { meses: true, funcao: { select: { nome: true } }, centroCusto: { select: { codigoRM: true, nomeRM: true } } },
          }),
        ])
      : [null, null, []];
    const doCenario = new Map(linhasDoCenario.map((l) => [l.id, l]));
    const q = cad ? recorteDoQuadroCom(recorte, cad) : null;
    // Os Benefícios Padrão do cenário (21/11/2026): o valor de cada mês das linhas de antes, para comparar com a coluna Benefícios.
    const valoresDosBeneficiosDoCenario = comQuadro ? await valoresDosBeneficios(getPrismaClient(), id) : new Map<string, number>();
    const comBeneficios = (lidos: MesDaLinha[], atuais: MesDaLinha[] | undefined) => lidos.map((m, k) => ({ ...m, ...beneficiosImportados(m, atuais?.[k], valoresDosBeneficiosDoCenario) }));
    // O mesmo valor dos Benefícios (sem a coluna no arquivo, igual).
    const beneficiosIguais = (atual: MesDaLinha, lido: MesDaLinha) =>
      lido.beneficiosDigitados === undefined || Math.abs((lido.beneficiosDigitados ?? 0) - beneficiosDoMes(atual, valoresDosBeneficiosDoCenario)) < 0.005;
    // O item de cada mudança na tabela do Importar Valores (20/11/2026, pedido do Adão), que o usuário desmarca para não importar:
    // nas abas Matriz, Filial e Serviços, a aba e a linha de produto ou de obra (ou os Dias Úteis); nos Centros de Custo, o grupo;
    // nos Indicadores Manuais (mesmo dia, pedido do Adão), o indicador; nas demais, o trecho. As linhas do Quadro de Lotação vão
    // no grupo do centro delas (fora dos grupos, o próprio centro).
    const itemDaLinha = (l: LinhaDaPlanilha, bloco: string) =>
      l.chave.startsWith("P|")
        ? `${NOME_DA_ABA[l.aba]} · ${l.descricao[2] || l.descricao[3]}`
        : l.chave.startsWith("I|")
          ? l.descricao[1] || l.chave.slice(2)
          : (l.grupo ?? bloco);
    const centroDoQuadro = (centroCustoId: string, centro?: { codigoRM: string | null; nomeRM: string }) =>
      cad!.grupoDoCentro.get(centroCustoId)?.grupo ?? (centro ? rotuloDoCentro(centro) : "Sem Grupo");
    // O trecho de cada linha do Quadro de Lotação (20/11/2026, pedido do Adão; antes, a aba inteira era um trecho só): o
    // departamento do centro dela. Em dois arquivos, o quadro dos repetidos pergunta só pelos departamentos que os dois trazem
    // (um arquivo só do Extra-Operacional não disputa o Quadro de Lotação da Produção); os centros fora dos grupos (ou de um
    // grupo da DRE sem departamento), que vão em todos os arquivos, são o trecho Sem Departamento.
    const nomeDoDepartamento = new Map(DEPARTAMENTOS.map((d) => [d.chave, d.nome]));
    const blocoDoQuadro = (d: Departamento | null) => `${NOME_DA_ABA.quadro}: ${d ? nomeDoDepartamento.get(d) : "Sem Departamento"}`;
    const departamentoDoCentro = (centroCustoId: string, codigoRM?: string | null) =>
      departamentoDoGrupoDRE((cad!.grupoDoCentro.get(centroCustoId) ?? cad!.grupoDoCodigo.get(codigoRM ?? ""))?.grupoDRE);
    return lidos.map((r) => {
      const novasDoQuadro: Array<DadosDaLinhaDoQuadro & { descricao: string; centro: string; bloco: string }> = [];
      const alteradasDoQuadro: Array<DadosDaLinhaDoQuadro & { id: string; descricao: string; centro: string; bloco: string }> = [];
      const excluidasDoQuadro: Array<{ id: string; descricao: string; centro: string; bloco: string }> = [];
      const blocosDoQuadro = new Set<string>();
      // As linhas da aba que substitui (11/11/2026), conferidas, para comparar com as do cenário depois.
      const daAba: Array<DadosDaLinhaDoQuadro & { descricao: string; centro: string; bloco: string }> = [];
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
        if (!q!.ve(res.cadastros.centroCustoId)) {
          erro(`o centro de custo ${l.campos.centro} fica fora do seu recorte.`);
          continue;
        }
        const dados = { ...res.cadastros, meses: l.meses, descricao: `${l.campos.funcao} · ${l.campos.centro}`,
          centro: centroDoQuadro(res.cadastros.centroCustoId),
          bloco: blocoDoQuadro(departamentoDoCentro(res.cadastros.centroCustoId)),
        };
        if (r.substituiQuadro) {
          daAba.push(dados);
          continue;
        }
        if (!l.id) {
          novasDoQuadro.push({ ...dados, meses: comBeneficios(dados.meses, undefined) });
          continue;
        }
        const atual = doCenario.get(l.id);
        if (!atual) {
          erro(`o Código da Linha ${l.id} não é deste cenário (para uma linha nova, deixe-o em branco).`);
          continue;
        }
        const antes = mesesDaLinha(atual.meses);
        const mudou =
          (["unidadeNegocioId", "vinculo", "funcaoId", "centroCustoId"] as const).some((k) => atual[k] !== dados[k]) ||
          antes.some((m, k) => (["colaboradores", "salarioBruto", "adicional"] as const).some((x) => !iguais(m[x], dados.meses[k][x])) || !beneficiosIguais(m, dados.meses[k]));
        if (mudou) alteradasDoQuadro.push({ ...dados, id: l.id, meses: comBeneficios(dados.meses, antes) });
      }
      // A aba sem o Código da Linha (11/11/2026, pedido do Adão) substitui as linhas do cenário dos departamentos do arquivo
      // (e as dos centros fora dos grupos, que vão em todos): a linha igual (os cadastros e os meses) fica; a de mesmos
      // cadastros e outros meses é alterada (na ordem); as da aba sem par entram, e as do cenário sem par saem.
      if (r.substituiQuadro && !r.erros.length) {
        const deps = r.substituiQuadro;
        const cadastrosDe = (x: Pick<DadosDaLinhaDoQuadro, "unidadeNegocioId" | "vinculo" | "funcaoId" | "centroCustoId">) =>
          [x.unidadeNegocioId, x.vinculo, x.funcaoId, x.centroCustoId].join("|");
        const mesesIguais = (a: MesDaLinha[], b: MesDaLinha[]) =>
          a.every((m, k) => (["colaboradores", "salarioBruto", "adicional"] as const).every((f) => iguais(m[f], b[k][f])) && beneficiosIguais(m, b[k]));
        const doEscopo = linhasDoCenario
          .filter((x) => {
            const d = departamentoDoCentro(x.centroCustoId, x.centroCusto.codigoRM);
            return (!d || deps.includes(d)) && q!.ve(x.centroCustoId);
          })
          .map((x) => ({ x, meses: mesesDaLinha(x.meses), usada: false }));
        const semPar: typeof daAba = [];
        for (const d of daAba) {
          const par = doEscopo.find((y) => !y.usada && cadastrosDe(y.x) === cadastrosDe(d) && mesesIguais(y.meses, d.meses));
          if (par) par.usada = true;
          else semPar.push(d);
        }
        for (const d of semPar) {
          const par = doEscopo.find((y) => !y.usada && cadastrosDe(y.x) === cadastrosDe(d));
          if (par) {
            par.usada = true;
            alteradasDoQuadro.push({ ...d, id: par.x.id, meses: comBeneficios(d.meses, par.meses) });
          } else novasDoQuadro.push({ ...d, meses: comBeneficios(d.meses, undefined) });
        }
        for (const y of doEscopo)
          if (!y.usada)
            excluidasDoQuadro.push({
              id: y.x.id,
              descricao: `${y.x.funcao.nome} · ${rotuloDoCentro(y.x.centroCusto)}`,
              centro: centroDoQuadro(y.x.centroCustoId, y.x.centroCusto),
              bloco: blocoDoQuadro(departamentoDoCentro(y.x.centroCustoId, y.x.centroCusto.codigoRM)),
            });
        // Os trechos da aba (20/11/2026): os departamentos do arquivo com grupos de centros no cenário e, com alguma linha de
        // centro sem departamento (no arquivo ou no cenário), o Sem Departamento.
        for (const d of deps) if (cad!.grupos.some((g) => departamentoDoGrupoDRE(g.grupoDRE) === d)) blocosDoQuadro.add(blocoDoQuadro(d));
        if (daAba.some((l) => l.bloco === blocoDoQuadro(null)) || doEscopo.some((y) => !departamentoDoCentro(y.x.centroCustoId, y.x.centroCusto.codigoRM)))
          blocosDoQuadro.add(blocoDoQuadro(null));
      }
      const alteracoes = new Map<string, MudancaDaPlanilha & { bloco: string; item: string }>();
      const justificativas = new Map<string, { chave: string; texto: string | null; bloco: string; item: string }>();
      const desconhecidas: string[] = [];
      // Os nomes antigos dos indicadores renomeados (19/11/2026) nos Indicadores Manuais recusam o arquivo.
      const antigos = nomesAntigos();
      const comNomeAntigo: string[] = [];
      const foraDoRecorte = new Set<string>();
      const abasDasLinhas = new Set<AbaDasPremissas>();
      // Os trechos do arquivo (15/10/2026): a unidade, o centro, a depreciação base de uma unidade… — para conferir os
      // repetidos entre os arquivos de uma importação.
      const blocos = new Set<string>();
      for (const l of r.linhas) {
        const doIndicador = l.chave?.startsWith("I|") ? l.chave.slice(2) : l.doTipo === "manuais" ? String(l.descricao.at(-1) ?? "").replace(/\s+/g, " ").trim() : null;
        const nomeNovo = doIndicador ? antigos.get(doIndicador) : undefined;
        if (doIndicador && nomeNovo) {
          comNomeAntigo.push(`${l.aba}, linha ${l.numero}: ${doIndicador} → ${nomeNovo}`);
          continue;
        }
        // Pelo Código (os arquivos de antes) ou pela aba e pelas descrições (11/11/2026).
        const atual = l.chave !== null ? porChave.get(l.chave) : l.doTipo ? porDescricao.get(chaveDaDescricao(l.doTipo, l.descricao)) : undefined;
        if (!atual) {
          // As linhas dos Salários de cada mão de obra (os arquivos de antes de 12/11/2026): calculadas, sem aviso.
          if (l.doTipo === "centros" && SALARIOS_POR_MAO_DE_OBRA.test(String(l.descricao.at(-1) ?? "").trim())) continue;
          desconhecidas.push(`${l.aba}, linha ${l.numero}`);
          continue;
        }
        const daLinha = atual.chave;
        if (!veLinha(recorte, atual, gruposPorNome)) {
          foraDoRecorte.add(blocoDaChave(daLinha, atual.descricao));
          continue;
        }
        abasDasLinhas.add(atual.aba);
        const bloco = blocoDaChave(daLinha, atual.descricao);
        const item = itemDaLinha(atual, bloco);
        // As linhas calculadas (19/10/2026) não se importam: só a justificativa.
        if (atual.calculada) l.meses = [...atual.meses];
        blocos.add(bloco);
        l.meses.forEach((v, k) => {
          const chave = `${daLinha}|${k + 1}`;
          if (!iguais(atual.meses[k], v)) alteracoes.set(chave, { chave: daLinha, mes: k + 1, valor: v, bloco, item });
          else alteracoes.delete(chave);
        });
        if ((l.justificativa ?? null) !== (atual.justificativa ?? null)) justificativas.set(daLinha, { chave: daLinha, texto: l.justificativa, bloco, item });
        else justificativas.delete(daLinha);
      }
      // Os investimentos (15/10/2026): com o Nome de Referência de um investimento do cenário, a alteração dele (se mudou);
      // com um nome novo, um novo.
      const novos: InvestimentoLido[] = [];
      const alterados: Array<InvestimentoLido & { id: string }> = [];
      // Os investimentos não têm recorte (19/11/2026); com recorte, só altera os que ele incluiu (pedido do Adão).
      const alteraTodos = alteraTodosOsInvestimentos(c, usuario);
      for (const i of r.investimentos) {
        const atual = existentes.get(chaveDoNome(i.nomeReferencia));
        if (!atual) novos.push(i);
        else if (
          (atual.departamento ?? null) !== i.departamento ||
          atual.unidade !== i.unidade ||
          atual.descricao !== i.descricao ||
          (atual.condicaoPagamento ?? null) !== i.condicaoPagamento ||
          atual.inicio !== i.inicio ||
          !iguais(Number(atual.valorTotal), i.valorTotal) ||
          !iguais(Number(atual.valorPosUso), i.valorPosUso) ||
          atual.vidaUtil !== i.vidaUtil
        ) {
          if (!alteraOInvestimento(alteraTodos, atual, usuario)) r.erros.push(`${i.aba}, linha ${i.numero}: ${foraDosSeusInvestimentos(atual)}`);
          else alterados.push({ ...i, id: atual.id });
        }
      }
      // A aba Investimentos substitui os investimentos de quem importa (19/11/2026, pedido do Adão): os dele que não estão nela
      // saem do cenário (os de outros usuários ficam). Em dois arquivos com a aba, o usuário escolhe qual vale (um trecho).
      const nomesDoArquivo = new Set(r.investimentos.map((i) => chaveDoNome(i.nomeReferencia)));
      const excluidos = r.comInvestimentos
        ? [...existentes.values()]
            .filter((i) => !!usuario.id && i.criadoPorId === usuario.id && !nomesDoArquivo.has(chaveDoNome(i.nomeReferencia)))
            .map((i) => ({ id: i.id, nomeReferencia: i.nomeReferencia, descricao: i.descricao }))
        : [];
      if (r.investimentos.length || r.comInvestimentos) abasDasLinhas.add("investimentos");
      if (r.comInvestimentos) blocos.add(BLOCO_DOS_INVESTIMENTOS);
      if (r.quadro.length || r.substituiQuadro) abasDasLinhas.add("quadro");
      // O Quadro de Lotação que substitui (11/11/2026): um trecho por departamento (20/11/2026); em dois arquivos com o mesmo, o
      // usuário escolhe qual vale.
      for (const b of blocosDoQuadro) blocos.add(b);
      if (comNomeAntigo.length)
        r.erros.push(
          `${comNomeAntigo.length === 1 ? "Um nome antigo de indicador" : `${comNomeAntigo.length} nomes antigos de indicadores`} (o nome antigo → o atual): ${comNomeAntigo.slice(0, 5).join("; ")}${comNomeAntigo.length > 5 ? "…" : ""}. Mude os nomes no arquivo (ou exporte as Premissas de novo) e importe de novo.`,
        );
      if (foraDoRecorte.size)
        r.erros.push(`Fora do seu recorte (o cenário tem o Acesso às Informações Por Recorte): ${[...foraDoRecorte].slice(0, 6).join(", ")}${foraDoRecorte.size > 6 ? "…" : ""}.`);
      const avisos = [...r.avisos];
      if (desconhecidas.length) {
        avisos.push(
          `${desconhecidas.length} ${desconhecidas.length === 1 ? "linha que este cenário não tem foi ignorada" : "linhas que este cenário não tem foram ignoradas"} (as descrições não batem com as do cenário: ${desconhecidas.slice(0, 5).join("; ")}${desconhecidas.length > 5 ? "…" : ""}).`,
        );
      }
      const semLinhas = r.linhas.length > 0 && r.linhas.length === desconhecidas.length && !r.investimentos.length && !r.comInvestimentos && !r.quadro.length && !r.substituiQuadro;
      // Nada a importar (20/11/2026, pedido do Adão): o arquivo sem erros que não muda nada no cenário fica Inválido, com o
      // motivo — antes, Válido e o Importar sem nada a gravar.
      if (
        !r.erros.length &&
        !semLinhas &&
        nadaAImportar({
          alteracoes: alteracoes.size,
          justificativas: justificativas.size,
          investimentos: { novos: novos.length, alterados: alterados.length, excluidos: excluidos.length },
          quadro: { novas: novasDoQuadro.length, alteradas: alteradasDoQuadro.length, excluidas: excluidasDoQuadro.length },
        })
      )
        r.erros.push(
          `Nada a importar: o arquivo não muda nenhum valor, justificativa, investimento nem linha do Quadro de Lotação do cenário (${
            avisos.length ? "os valores dele são iguais aos do cenário, ou estão nas abas e linhas ignoradas dos avisos abaixo" : "os valores dele são iguais aos do cenário"
          }).`,
        );
      return {
        arquivo: r.arquivo,
        valido: r.erros.length === 0 && (r.linhas.length > desconhecidas.length || r.investimentos.length > 0 || r.comInvestimentos || r.quadro.length > 0 || r.substituiQuadro !== null),
        erros: semLinhas && !r.erros.length ? ["Nenhuma linha do arquivo é deste cenário (as descrições não batem com as do cenário)."] : r.erros,
        avisos,
        abas: r.abas,
        abasDasPremissas: [...abasDasLinhas],
        blocos: [...blocos],
        linhas: r.linhas.length - desconhecidas.length,
        alteracoes: [...alteracoes.values()],
        justificativas: [...justificativas.values()],
        // `nomes` (19/11/2026): com a aba Investimentos, os Nomes de Referência dela — a gravação tira os do usuário que não
        // estão em nenhuma (os `excluidos`, para a prévia).
        investimentos: { novos, alterados, excluidos, nomes: r.comInvestimentos ? r.investimentos.map((i) => i.nomeReferencia) : null },
        quadro: { novas: novasDoQuadro, alteradas: alteradasDoQuadro, excluidas: excluidasDoQuadro },
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
      investimentos?: { novos: DadosDoInvestimento[]; alterados: Array<DadosDoInvestimento & { id: string }>; nomes?: string[] | null };
      quadro?: { novas: DadosDaLinhaDoQuadro[]; alteradas: Array<DadosDaLinhaDoQuadro & { id: string }>; excluidas?: Array<{ id: string }> };
    }>,
    usuario: Usuario,
  ) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    exigirSemReajustes(c);
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
    // A aba Investimentos substitui os investimentos de quem importa (19/11/2026, pedido do Adão): os dele que não estão em
    // nenhum arquivo com a aba saem do cenário; os de outros usuários ficam.
    const comAbaDeInvestimentos = arquivos.filter((a) => Array.isArray(a.investimentos?.nomes));
    const nomesDosArquivos = new Set(comAbaDeInvestimentos.flatMap((a) => a.investimentos!.nomes!).map(chaveDoNome));
    const excluidos = comAbaDeInvestimentos.length && usuario.id
      ? (await getPrismaClient().cenarioInvestimento.findMany({ where: { cenarioId: id, criadoPorId: usuario.id }, orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }] })).filter(
          (i) => !nomesDosArquivos.has(chaveDoNome(i.nomeReferencia)) && !alterados.has(i.id),
        )
      : [];
    const nInvestimentos = novos.length + alterados.size + excluidos.length;
    // O Quadro de Lotação (09/11/2026): as linhas alteradas (a última vale), as novas e, desde 11/11/2026 (a aba que substitui
    // as linhas), as que saem, conferidas de novo.
    const novasDoQuadro = arquivos.flatMap((a) => a.quadro?.novas ?? []);
    const alteradasDoQuadro = new Map(arquivos.flatMap((a) => a.quadro?.alteradas ?? []).map((l) => [l.id, l]));
    const excluidasDoQuadro = new Set(arquivos.flatMap((a) => a.quadro?.excluidas ?? []).map((l) => l.id).filter((x) => !alteradasDoQuadro.has(x)));
    const nQuadro = novasDoQuadro.length + alteradasDoQuadro.size + excluidasDoQuadro.size;
    if (nQuadro) {
      const ids = [...alteradasDoQuadro.keys(), ...excluidasDoQuadro];
      const [cad, atuais] = await Promise.all([cadastrosDoQuadro(id), getPrismaClient().cenarioLotacao.findMany({ where: { cenarioId: id, id: { in: ids } } })]);
      if (atuais.length !== ids.length) throw new CenarioError(400, "Uma linha do Quadro de Lotação da planilha não é deste cenário: analise os arquivos de novo.");
      const atualDe = new Map(atuais.map((l) => [l.id, l]));
      for (const l of [...novasDoQuadro, ...alteradasDoQuadro.values()]) {
        const recusa = recusaDaLinha(l, cad, "id" in l ? atualDe.get(l.id as string) : null);
        if (recusa) throw new CenarioError(400, `Quadro de Lotação: ${recusa}`);
      }
    }
    if (!mudancas.size && !justificativas.size && !nInvestimentos && !nQuadro)
      throw new CenarioError(400, "Nada a importar: os arquivos têm os mesmos valores, justificativas, investimentos e linhas do Quadro de Lotação do cenário.");
    // O recorte (12/11/2026), de novo: as linhas, os investimentos (o de antes e o novo) e as linhas do Quadro de Lotação.
    const recorte = recorteDoCenario(c, usuario);
    const gruposPorNome = new Map((await gruposDoCenario(id)).map((g) => [g.grupo, g]));
    const tocadas = [...new Set([...[...mudancas.values()].map((m) => m.chave), ...justificativas.keys()])].map((k) => porChave.get(k)!);
    exigirNoRecorte(tocadas.every((l) => veLinha(recorte, l, gruposPorNome)));
    const investimentosDeAntes = new Map(
      (await getPrismaClient().cenarioInvestimento.findMany({ where: { cenarioId: id, id: { in: [...alterados.keys()] } }, include: { criadoPor: { select: { nome: true } } } })).map((i) => [
        i.id,
        i,
      ]),
    );
    // Com recorte, só altera os que ele incluiu (19/11/2026, pedido do Adão).
    const alteraTodos = alteraTodosOsInvestimentos(c, usuario);
    const alheio = [...investimentosDeAntes.values()].find((i) => !alteraOInvestimento(alteraTodos, i, usuario));
    if (alheio) throw new CenarioError(403, foraDosSeusInvestimentos(alheio));
    // Os investimentos não têm recorte (19/11/2026): os trechos marcados (`i`), que todos veem no histórico.
    const trechosDosInvestimentos = [
      ...[...novos, ...alterados.values()].flatMap((i) => {
        const antes = "id" in i ? investimentosDeAntes.get(i.id as string) : undefined;
        const depois = { unidade: i.unidade, departamento: i.unidade === 4 ? (i.departamento ?? null) : null };
        return [{ d: departamentosDoInvestimento(depois), i: true as const }, ...(antes ? [{ d: departamentosDoInvestimento(antes), i: true as const }] : [])];
      }),
      ...excluidos.map((i) => ({ d: departamentosDoInvestimento(i), i: true as const })),
    ];
    const qDoImportar = nQuadro ? await recorteDoQuadro(recorte, id) : null;
    const linhasDeAntesDoQuadro = nQuadro
      ? await getPrismaClient().cenarioLotacao.findMany({ where: { cenarioId: id, id: { in: [...alteradasDoQuadro.keys(), ...excluidasDoQuadro] } }, select: { centroCustoId: true } })
      : [];
    const centrosDoQuadro = [...novasDoQuadro.map((l) => l.centroCustoId), ...[...alteradasDoQuadro.values()].map((l) => l.centroCustoId), ...linhasDeAntesDoQuadro.map((l) => l.centroCustoId)];
    if (qDoImportar) exigirNoRecorte(centrosDoQuadro.every((x) => qDoImportar.ve(x)));
    const alcance = trechos([
      ...tocadas.map((l) => trechoDaLinha(l, gruposPorNome)),
      ...trechosDosInvestimentos,
      ...(qDoImportar ? centrosDoQuadro.map((x) => qDoImportar.trecho(x)) : []),
    ]);
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
      departamento: i.unidade === 4 ? (i.departamento ?? null) : null,
      inicio: i.inicio,
      valorTotal: new Prisma.Decimal(i.valorTotal.toFixed(2)),
      valorPosUso: new Prisma.Decimal(i.valorPosUso.toFixed(2)),
      vidaUtil: i.vidaUtil,
    });
    await prisma.$transaction(
      async (tx) => {
        await aplicarMudancas(tx, id, [...mudancas.values()], est);
        // Os investimentos de quem importa que não estão na aba (19/11/2026).
        if (excluidos.length) await tx.cenarioInvestimento.deleteMany({ where: { cenarioId: id, id: { in: excluidos.map((i) => i.id) } } });
        for (const i of alterados.values()) await tx.cenarioInvestimento.update({ where: { id: i.id }, data: camposDoInvestimento(i) });
        const ordem = await tx.cenarioInvestimento.count({ where: { cenarioId: id } });
        for (const [k, i] of novos.entries()) await tx.cenarioInvestimento.create({ data: { ...camposDoInvestimento(i), cenarioId: id, criadoPorId: usuario.id || null, ordem: ordem + k } });
        const camposDaLinha = (l: DadosDaLinhaDoQuadro) => ({ unidadeNegocioId: l.unidadeNegocioId, vinculo: l.vinculo, funcaoId: l.funcaoId, centroCustoId: l.centroCustoId });
        // Os Benefícios Padrão das linhas (21/11/2026), como a análise os devolveu: só os do cenário (um excluído depois da análise sai).
        const doCenario = nQuadro ? new Set((await valoresDosBeneficios(tx, id)).keys()) : new Set<string>();
        const comOsDoCenario = (meses: MesDaLinha[]) => meses.map((m) => ({ ...m, beneficiosPadrao: (m.beneficiosPadrao ?? []).filter((b) => doCenario.has(b)) }));
        // As linhas que saem (11/11/2026: a aba que substitui; os meses vão junto).
        if (excluidasDoQuadro.size) await tx.cenarioLotacao.deleteMany({ where: { cenarioId: id, id: { in: [...excluidasDoQuadro] } } });
        for (const l of alteradasDoQuadro.values()) {
          await tx.cenarioLotacao.update({ where: { id: l.id }, data: camposDaLinha(l) });
          await tx.cenarioLotacaoMes.deleteMany({ where: { linhaId: l.id } });
          await tx.cenarioLotacaoMes.createMany({ data: mesesParaGravar(l.id, comOsDoCenario(l.meses)) });
        }
        const ordemDoQuadro = await tx.cenarioLotacao.count({ where: { cenarioId: id } });
        for (const [k, l] of novasDoQuadro.entries()) {
          const nova = await tx.cenarioLotacao.create({ data: { ...camposDaLinha(l), cenarioId: id, ordem: ordemDoQuadro + k } });
          await tx.cenarioLotacaoMes.createMany({ data: mesesParaGravar(nova.id, comOsDoCenario(l.meses)) });
        }
        for (const [chave, texto] of justificativas) {
          if (texto) await tx.cenarioPremissaJustificativa.upsert({ where: { cenarioId_chave: { cenarioId: id, chave } }, create: { cenarioId: id, chave, texto, usuarioNome: usuario.nome }, update: { texto, usuarioNome: usuario.nome } });
          else await tx.cenarioPremissaJustificativa.deleteMany({ where: { cenarioId: id, chave } });
        }
        if (mudancas.size || nInvestimentos || nQuadro) await alteradoSemRecalcular(tx, id, "premissas");
      },
      { timeout: 300_000 },
    );
    const meses = [...new Set([...mudancas.values()].map((m) => m.mes))].sort((a, b) => a - b);
    const nomes = arquivos.map((a) => a.arquivo);
    const doInvestimento = nInvestimentos
      ? `, ${novos.length} ${novos.length === 1 ? "investimento novo" : "investimentos novos"}, ${alterados.size} ${alterados.size === 1 ? "alterado" : "alterados"} e ${excluidos.length} ${excluidos.length === 1 ? "excluído" : "excluídos"}`
      : "";
    const doQuadro = nQuadro
      ? `, ${novasDoQuadro.length} ${novasDoQuadro.length === 1 ? "linha nova" : "linhas novas"}, ${alteradasDoQuadro.size} ${alteradasDoQuadro.size === 1 ? "alterada" : "alteradas"} e ${excluidasDoQuadro.size} ${excluidasDoQuadro.size === 1 ? "excluída" : "excluídas"} no Quadro de Lotação`
      : "";
    const descricao = `Valores importados de ${nomes.length === 1 ? nomes[0] : `${nomes.length} arquivos`}: ${mudancas.size} ${mudancas.size === 1 ? "valor" : "valores"} e ${justificativas.size} ${justificativas.size === 1 ? "justificativa" : "justificativas"}${doInvestimento}${doQuadro}`;
    const contas = [...new Set([...mudancas.values()].map((m) => m.chave))].slice(0, 200).map((k) => ({ codigo: k, descricao: porChave.get(k)!.descricao.filter(Boolean).join(" · ") }));
    await prisma.cenarioReajuste.create({
      data: { cenarioId: id, usuarioId: usuario.id || null, usuarioNome: usuario.nome, tipo: "IMPORTACAO", descricao, valores: mudancas.size, meses, contas, alcance },
    });
    await auditar({ usuarioId: usuario.id, usuarioNome: usuario.nome, acao: "IMPORTACAO", entidade: "cenario", entidadeId: id, metadados: { cenario: c.nome, premissas: "importar valores", arquivos: nomes, valores: mudancas.size, justificativas: justificativas.size, investimentosNovos: novos.length, investimentosAlterados: alterados.size, investimentosExcluidos: excluidos.length, quadroNovas: novasDoQuadro.length, quadroAlteradas: alteradasDoQuadro.size, quadroExcluidas: excluidasDoQuadro.size } });
    return {
      valores: mudancas.size,
      justificativas: justificativas.size,
      investimentosNovos: novos.length,
      investimentosAlterados: alterados.size,
      investimentosExcluidos: excluidos.length,
      quadroNovas: novasDoQuadro.length,
      quadroAlteradas: alteradasDoQuadro.size,
      quadroExcluidas: excluidasDoQuadro.size,
    };
  },

  /**
   * Recalcula a DRE do cenário analítico (14/10/2026: o botão Recalcular dos Resultados). Desde 21/11/2026 (pedido do Adão), as
   * gravações das Configurações, das Premissas e dos Índices de Reajuste não refazem a DRE — só contam as alterações
   * (`pendenciasDoRecalculo`) —, e é aqui que ela se refaz com todas, com os reajustes da caixa Aplicar Reajustes (aplicados ou
   * removidos, com o registro das contas e das somas). Só nos cenários em aberto (sem marcação nem versão congelada).
   */
  async recalcular(id: string, usuario: Usuario) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    const p = pendenciasDoRecalculo(c);
    // Os reajustes mudados: a caixa (aplicar ou remover) ou os Índices de Reajuste gravados com ela marcada.
    const reajustesMudados = p.reajustes > 0 && (c.reajustesAplicados || c.reajustesCalculados);
    await getPrismaClient().$transaction(
      async (tx) => {
        if (reajustesMudados)
          await recalcularComReajustes(tx, c, usuario, (n) =>
            !c.reajustesAplicados
              ? `Reajustes removidos: ${deContas(n)} ${n === 1 ? "volta" : "voltam"} aos valores das premissas`
              : c.reajustesCalculados
                ? `Reajustes recalculados com os Índices de Reajuste gravados: ${deContas(n)}`
                : `Reajustes aplicados: ${deContas(n)}`,
          );
        else await calcularAnalitico(tx, id);
        await tx.cenarioReajuste.create({ data: { cenarioId: id, usuarioId: usuario.id || null, usuarioNome: usuario.nome, tipo: "RECALCULO", descricao: textoDoRecalculo(p, c.reajustesAplicados) } });
      },
      { timeout: 120_000 },
    );
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "ALTERACAO",
      entidade: "cenario",
      entidadeId: id,
      metadados: { cenario: c.nome, recalculo: p, reajustes: c.reajustesAplicados ? "aplicados" : "sem reajustes" },
    });
    return this.obter(id, usuario);
  },

  /**
   * A caixa Aplicar Reajustes dos Resultados (21/11/2026, pedido do Adão; antes, o botão Aplicar / Remover Reajustes do quadro
   * Índices de Reajuste das Configurações): marca ou desmarca os Reajustes das Premissas, que o Recalcular aplica na DRE (cada
   * conta com índice, em cada unidade e mês, multiplicada pelo fator do mês) ou remove (a DRE volta aos valores das premissas).
   * Marcada, as Configurações e as Premissas não se editam (como com os reajustes aplicados). A caixa já como pedida é recusada.
   */
  async aplicarReajustes(id: string, aplicar: boolean, usuario: Usuario) {
    const c = await obterOuFalhar(id, usuario);
    // A Edição das Configurações (12/11/2026) vale para ela: os reajustes travam as Configurações e as Premissas.
    exigirQuemCriou(c, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    if (c.reajustesAplicados === aplicar) {
      throw new CenarioError(409, aplicar ? "A caixa Aplicar Reajustes já está marcada: atualize a tela." : "A caixa Aplicar Reajustes já está desmarcada: atualize a tela.");
    }
    if (aplicar && !(await fatoresDoCenario(getPrismaClient(), c)).size) {
      throw new CenarioError(409, "Nenhuma conta com Índice de Reajuste: inclua as combinações dos índices (Configurações / Comparativo e Reajustes) antes de aplicar.");
    }
    // Só se a caixa ainda está como estava: dois cliques seguidos não marcam (nem desmarcam) duas vezes.
    const { count } = await getPrismaClient().cenario.updateMany({ where: { id, reajustesAplicados: c.reajustesAplicados }, data: { reajustesAplicados: aplicar } });
    if (!count) throw new CenarioError(409, `A caixa Aplicar Reajustes já foi ${aplicar ? "marcada" : "desmarcada"} por outra gravação: atualize a tela.`);
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "ALTERACAO",
      entidade: "cenario",
      entidadeId: id,
      antes: { reajustesAplicados: c.reajustesAplicados },
      depois: { reajustesAplicados: aplicar },
      metadados: { cenario: c.nome, reajustes: aplicar ? "marcados para aplicar no Recalcular" : "marcados para remover no Recalcular" },
    });
    return this.obter(id, usuario);
  },

  /**
   * O Compartilhar do cenário particular (21/11/2026, pedido do Adão; Configurações / Cenário, depois da Visualização; como o dos
   * Painéis e Apresentações): os usuários convidados a ver o cenário — o perfil, quem convidou e quando, e se o perfil só lê os
   * cenários — e, para quem muda a visualização (quem criou o cenário e o Administrador), os que ele pode convidar: os ativos que
   * leem os cenários do tipo, menos os Administradores (que já veem todos), quem criou o cenário e os já convidados.
   */
  async compartilhamento(id: string, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    const base = c.tipo === "ANALITICO" ? "cenarios_analiticos" : "cenarios";
    const podeCompartilhar = mudaVisualizacao(c, usuario);
    const lista = compartilhamentosDe(c);
    const [ativos, nomes] = await Promise.all([
      carregarUsuariosAtivos(),
      getPrismaClient().usuario.findMany({ where: { id: { in: lista.map((x) => x.usuarioId) } }, select: { id: true, nome: true, email: true } }),
    ]);
    const doId = new Map(ativos.map((a) => [a.sub, a]));
    const cadastro = new Map(nomes.map((n) => [n.id, n]));
    // Os sintéticos (cenarios_…) sem as permissões dos analíticos (cenarios_analiticos_…).
    const doTipo = (p: string) => p.startsWith(`${base}_`) && (base === "cenarios_analiticos" || !p.startsWith("cenarios_analiticos"));
    const soLe = (permissoes: string[]) => !permissoes.some((p) => doTipo(p) && p.endsWith(":editar"));
    return {
      podeCompartilhar,
      particular: c.visualizacao === "PARTICULAR",
      criadoPor: c.criadoPor,
      usuarios: lista.map((x) => {
        const a = doId.get(x.usuarioId);
        const n = cadastro.get(x.usuarioId);
        return {
          id: x.usuarioId,
          nome: n?.nome ?? "Usuário excluído",
          email: n?.email ?? "",
          perfil: a?.perfil.nome ?? null,
          convidadoPor: x.convidadoPor,
          convidadoEm: x.convidadoEm,
          // Ativo e com a leitura dos cenários do tipo: vê o cenário; só lê, se o perfil não edita nenhuma tela deles.
          ve: !!a?.permissions.includes(`${base}:ler`),
          soLe: a ? soLe(a.permissions) : true,
        };
      }),
      candidatos: podeCompartilhar
        ? ativos
            .filter((a) => a.permissions.includes(`${base}:ler`) && a.perfil.codigo !== CODIGO_ADMINISTRADOR && a.sub !== c.criadoPorId && !lista.some((x) => x.usuarioId === a.sub))
            .map((a) => ({ id: a.sub, nome: a.nome, email: a.email, perfil: a.perfil.nome, soLe: soLe(a.permissions) }))
            .sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR"))
        : [],
    };
  },

  /** Convida usuários a ver o cenário particular (quem criou o cenário ou o Administrador): os da lista de candidatos do Compartilhar. */
  async compartilhar(id: string, usuarios: string[], usuario: Usuario) {
    const c = await obterOuFalhar(id, usuario);
    if (!mudaVisualizacao(c, usuario)) throw new CenarioError(403, "Só quem criou o cenário ou o Administrador compartilha o cenário.");
    if (c.visualizacao !== "PARTICULAR") throw new CenarioError(400, "O cenário é público: todos com acesso aos cenários já o veem.");
    const { candidatos } = await this.compartilhamento(id, usuario);
    const validos = candidatos.filter((x) => usuarios.includes(x.id));
    if (!validos.length || validos.length !== new Set(usuarios).size) throw new CenarioError(400, "Convide só usuários ativos com acesso aos cenários (e que ainda não veem o cenário).");
    const agora = new Date().toISOString();
    const lista = [...compartilhamentosDe(c), ...validos.map((x) => ({ usuarioId: x.id, convidadoPor: usuario.nome, convidadoEm: agora }))];
    await getPrismaClient().cenario.update({ where: { id }, data: { compartilhamentos: lista as unknown as Prisma.InputJsonValue } });
    await auditar({ usuarioId: usuario.id, usuarioNome: usuario.nome, acao: "ALTERACAO", entidade: "cenario", entidadeId: id, metadados: { cenario: c.nome, compartilhado: validos.map((x) => x.nome) } });
    return this.compartilhamento(id, usuario);
  },

  /** Tira um usuário convidado do cenário (quem criou o cenário ou o Administrador): com o cenário particular, ele deixa de vê-lo. */
  async removerCompartilhamento(id: string, usuarioId: string, usuario: Usuario) {
    const c = await obterOuFalhar(id, usuario);
    if (!mudaVisualizacao(c, usuario)) throw new CenarioError(403, "Só quem criou o cenário ou o Administrador muda o compartilhamento do cenário.");
    const lista = compartilhamentosDe(c);
    if (!lista.some((x) => x.usuarioId === usuarioId)) throw new CenarioError(404, "O usuário não está no compartilhamento do cenário.");
    const nome = (await getPrismaClient().usuario.findUnique({ where: { id: usuarioId }, select: { nome: true } }))?.nome ?? usuarioId;
    await getPrismaClient().cenario.update({ where: { id }, data: { compartilhamentos: lista.filter((x) => x.usuarioId !== usuarioId) as unknown as Prisma.InputJsonValue } });
    await auditar({ usuarioId: usuario.id, usuarioNome: usuario.nome, acao: "ALTERACAO", entidade: "cenario", entidadeId: id, metadados: { cenario: c.nome, compartilhamentoRemovido: nome } });
    return this.compartilhamento(id, usuario);
  },

  /**
   * O comparativo do cenário (12/10/2026): o cenário comparado, os cenários que o usuário pode escolher e, nos sintéticos, as
   * linhas da DRE (14/10/2026: totais, atribuições e contas; antes, só os totais), com a variação máxima (em %) de cada linha
   * verificada (nula: a linha não se verifica). Nos analíticos (21/11/2026, pedido do Adão), a variação de cada conta vem das
   * combinações dos Índices de Comparação (indicesCenario.ts): sem as linhas aqui.
   */
  async comparativo(id: string, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    // Os dois tipos (13/10/2026): o analítico se compara também com um sintético (o Orçamento Empresarial, por exemplo).
    const outros = (await getPrismaClient().cenario.findMany({ where: { id: { not: id } }, orderBy: [{ ano: "desc" }, { criadoEm: "desc" }] })).filter((o) => alcanca(o, usuario));
    const analitico = c.tipo === "ANALITICO";
    const limites = (c.variacoesMaximas ?? {}) as Record<string, number>;
    const linhas = analitico ? [] : totaisDaDRE(await estruturaDRE()).linhas;
    const comparado = c.comparadoComId ? await getPrismaClient().cenario.findUnique({ where: { id: c.comparadoComId }, select: { id: true, nome: true, ano: true } }) : null;
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
      })),
    };
  },

  /**
   * Grava o comparativo: o cenário comparado (nulo desliga o comparativo; as variações máximas ficam guardadas) e, nos sintéticos,
   * as variações máximas das linhas verificadas (as contas, e os totais e atribuições sem contas); nos analíticos (21/11/2026), só o
   * cenário comparado — as variações vêm dos Índices de Comparação. Não vale para o cenário travado (14/10/2026: marcado ou com a
   * versão congelada; antes, valia).
   */
  async gravarComparativo(id: string, dados: { comparadoComId: string | null; limites?: Record<string, number | null> }, usuario: Usuario) {
    const antes = await obterOuFalhar(id, usuario);
    exigirQuemCriou(antes, usuario);
    exigirEditavel(antes);
    if (dados.comparadoComId === id) throw new CenarioError(400, "Escolha outro cenário para comparar.");
    if (dados.comparadoComId) await obterOuFalhar(dados.comparadoComId, usuario);
    const analitico = antes.tipo === "ANALITICO";
    let data: Prisma.CenarioUncheckedUpdateInput;
    if (analitico) data = { comparadoComId: dados.comparadoComId };
    else {
      const codigos = new Set(totaisDaDRE(await estruturaDRE()).verificadas.map((v) => v.linha.codigo));
      const fora = Object.keys(dados.limites ?? {}).filter((k) => !codigos.has(k));
      if (fora.length) throw new CenarioError(400, `Não são contas da DRE: ${fora.slice(0, 3).join(", ")}.`);
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
      antes: { comparadoComId: antes.comparadoComId, ...(analitico ? {} : { variacoesMaximas: antes.variacoesMaximas }) },
      depois: { comparadoComId: depois.comparadoComId, ...(analitico ? {} : { variacoesMaximas: depois.variacoesMaximas }) },
      metadados: { comparativo: true },
    });
    return this.comparativo(id, usuario);
  },

  /**
   * Os Índices de Comparação do cenário analítico (19/10/2026, de Referência; 21/11/2026, pedido do Adão: de Comparação, com as
   * combinações de Unidade, Departamento, Atribuição e Conta), com quantas contas cada um alcança e o universo das combinações.
   */
  async indices(id: string, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    if (c.tipo !== "ANALITICO") throw new CenarioError(400, "Os Índices de Comparação são dos cenários analíticos.");
    const { universo, indices, porCelula } = await indicesDeComparacao(getPrismaClient(), c);
    const usos = contasPorIndice(porCelula, universo);
    return { indices: indices.map((i) => ({ ...i, contas: usos.get(i.chave) ?? 0 })), universo };
  },

  /**
   * Grava a lista inteira dos Índices de Comparação (19/10/2026; 21/11/2026, com as combinações): os de chave conhecida mudam, os
   * sem chave entram (com uma chave nova) e os que faltam saem, com as combinações deles. As combinações se conferem: cada uma com
   * ao menos uma conta, e nenhuma conta em duas (do mesmo índice ou de outro). Só quem criou o cenário (ou o Administrador), com o
   * cenário editável.
   */
  async gravarIndices(id: string, lista: Array<{ chave?: string | null; descricao: string; observacao?: string | null; variacao: number; combinacoes: Combinacao[] }>, usuario: Usuario) {
    const antes = await obterOuFalhar(id, usuario);
    if (antes.tipo !== "ANALITICO") throw new CenarioError(400, "Os Índices de Comparação são dos cenários analíticos.");
    exigirQuemCriou(antes, usuario);
    exigirEditavel(antes);
    const { indices: atuais, universo } = await indicesDeComparacao(getPrismaClient(), antes);
    const conhecidas = new Set(atuais.map((i) => i.chave));
    const repetida = lista.find((i, k) => lista.findIndex((x) => x.descricao.trim().toLowerCase() === i.descricao.trim().toLowerCase()) !== k);
    if (repetida) throw new CenarioError(400, `O índice ${repetida.descricao.trim()} aparece duas vezes.`);
    let proxima = Math.max(0, ...atuais.map((i) => Number(/^i(\d+)$/.exec(i.chave)?.[1] ?? 0))) + 1;
    const novos: IndiceDeComparacao[] = lista.map((i) => ({
      chave: i.chave && conhecidas.has(i.chave) ? i.chave : `i${proxima++}`,
      descricao: i.descricao.trim(),
      observacao: i.observacao?.trim() || null,
      variacao: i.variacao,
      combinacoes: i.combinacoes.map(lerCombinacao),
    }));
    const erros = errosDasCombinacoes(novos, universo);
    if (erros.length) throw new CenarioError(400, erros.slice(0, 4).join(" "));
    // O formato das combinações (21/11/2026): a escolha por conta de antes (indicesDoComparativo) deixa de valer.
    const depois = await getPrismaClient().cenario.update({ where: { id }, data: { indicesReajuste: novos as unknown as Prisma.InputJsonValue, indicesDoComparativo: {} } });
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "ALTERACAO",
      entidade: "cenario",
      entidadeId: id,
      antes: { indicesReajuste: antes.indicesReajuste, indicesDoComparativo: antes.indicesDoComparativo },
      depois: { indicesReajuste: depois.indicesReajuste },
      metadados: { indices: "comparação" },
    });
    return this.indices(id, usuario);
  },

  /**
   * Os Índices de Reajuste do cenário analítico (11/11/2026, pedido do Adão; 21/11/2026, com as combinações de Unidade,
   * Departamento, Atribuição, Conta e Venda): cada um com até quatro reajustes (o Valor (%) e o Inicia Em) e quantas contas
   * alcança, o universo das combinações e se os reajustes estão aplicados na DRE.
   */
  async reajustesDasPremissas(id: string, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    const prisma = getPrismaClient();
    const est = await estruturaDRE();
    const [{ universo, indices, porCelula }, fatores] = await Promise.all([indicesDeReajuste(prisma, c, est), fatoresDoCenario(prisma, c, est)]);
    const usos = contasPorIndice(porCelula, universo);
    return {
      ano: c.ano,
      meses: MESES_1_A_12.map((m) => ({ mes: m, rotulo: rotuloMes(c.ano, m) })),
      editavel: !c.marcacao && !c.versaoSalvaEm,
      aplicados: c.reajustesAplicados,
      /** As contas que os reajustes mudam (as com um índice que muda algum mês, cada uma numa unidade): sem nenhuma, não há o que aplicar. */
      contasComReajuste: new Set(
        [...fatores.keys()].map((k) => {
          const d = daChave(k);
          return `${d.unidade}|${d.codigo}`;
        }),
      ).size,
      indices: indices.map((i) => ({ ...i, contas: usos.get(i.chave) ?? 0 })),
      universo,
    };
  },

  /**
   * Grava a lista inteira dos Índices de Reajuste (11/11/2026; 21/11/2026, com as combinações), como a dos Índices de Comparação:
   * os de chave conhecida mudam, os sem chave entram e os que faltam saem, com as combinações deles (conferidas: nenhuma conta em
   * dois índices). Com os reajustes aplicados, a DRE se recalcula com os índices novos.
   */
  async gravarIndicesDosReajustes(
    id: string,
    lista: Array<{ chave?: string | null; descricao: string; observacao?: string | null; reajustes: ReajusteDoIndice[]; combinacoes: Combinacao[] }>,
    usuario: Usuario,
  ) {
    const antes = await obterOuFalhar(id, usuario);
    exigirQuemCriou(antes, usuario);
    exigirAnalitico(antes);
    exigirEditavel(antes);
    const { indices: atuais, universo } = await indicesDeReajuste(getPrismaClient(), antes);
    const conhecidas = new Set(atuais.map((i) => i.chave));
    const repetida = lista.find((i, k) => lista.findIndex((x) => x.descricao.trim().toLowerCase() === i.descricao.trim().toLowerCase()) !== k);
    if (repetida) throw new CenarioError(400, `O índice ${repetida.descricao.trim()} aparece duas vezes.`);
    for (const i of lista) {
      const erro = erroDosReajustes(i.descricao.trim(), i.reajustes);
      if (erro) throw new CenarioError(400, erro);
    }
    let proxima = Math.max(0, ...atuais.map((i) => Number(/^r(\d+)$/.exec(i.chave)?.[1] ?? 0))) + 1;
    const novos: IndiceDeReajusteComCombinacoes[] = lista.map((i) => ({
      chave: i.chave && conhecidas.has(i.chave) ? i.chave : `r${proxima++}`,
      descricao: i.descricao.trim(),
      observacao: i.observacao?.trim() || null,
      reajustes: i.reajustes.map((r) => ({ valor: r.valor, mes: r.mes })),
      combinacoes: i.combinacoes.map(lerCombinacao),
    }));
    const erros = errosDasCombinacoes(novos, universo);
    if (erros.length) throw new CenarioError(400, erros.slice(0, 4).join(" "));
    // O formato das combinações (21/11/2026): a Aplicação dos Reajustes de antes (por conta) deixa de valer.
    const data = { indicesDosReajustes: novos as unknown as Prisma.InputJsonValue, aplicacaoDosReajustes: {} };
    // Com a caixa Aplicar Reajustes marcada (21/11/2026), a DRE fica pendente do Recalcular (os Reajustes).
    await getPrismaClient().cenario.update({ where: { id }, data: { ...data, ...(antes.reajustesAplicados ? { recalculoReajustes: { increment: 1 } } : {}) } });
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "ALTERACAO",
      entidade: "cenario",
      entidadeId: id,
      antes: { indicesDosReajustes: antes.indicesDosReajustes, aplicacaoDosReajustes: antes.aplicacaoDosReajustes },
      depois: { indicesDosReajustes: novos },
      metadados: { reajustes: "índices" },
    });
    return this.reajustesDasPremissas(id, usuario);
  },

  // ------------------------------------------------------------------------------------------------------------------------
  // Cadastros por cenário (20/11/2026, pedido do Adão; etapa 1): as abas Unidades e Centros de Custo das Configurações dos
  // analíticos, as cópias dos cadastros com que o cenário calcula (cadastrosDoCenario.ts). Editam como a Referência (a Edição das
  // Configurações, com o cenário em aberto e sem os reajustes aplicados); cada mudança nos centros recalcula a DRE do cenário.

  /** A aba Unidades das Configurações de um analítico: a cópia das unidades (o nome, a ordem e a situação no cenário). */
  async unidadesDoCenario(id: string, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    const us = await getPrismaClient().cenarioUnidade.findMany({
      where: { cenarioId: id },
      include: { unidadeNegocio: { select: { codigo: true, nome: true } } },
      orderBy: [{ ordem: "asc" }, { unidadeNegocio: { codigo: "asc" } }],
    });
    return {
      editavel: !c.marcacao && !c.versaoSalvaEm && !c.reajustesAplicados,
      unidades: us.map((u) => ({ id: u.id, codigo: u.unidadeNegocio.codigo, nome: u.nome, nomeNosCadastros: u.unidadeNegocio.nome, ordem: u.ordem, ativo: u.ativo })),
    };
  },

  /** Grava uma unidade da cópia do cenário: o nome (único no cenário), a ordem e a situação. */
  async gravarUnidadeDoCenario(id: string, unidadeId: string, dados: { nome: string; ordem: number; ativo: boolean }, usuario: Usuario) {
    const c = await obterOuFalhar(id, usuario);
    exigirQuemCriou(c, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    exigirSemReajustes(c);
    const prisma = getPrismaClient();
    const antes = await prisma.cenarioUnidade.findFirst({ where: { id: unidadeId, cenarioId: id } });
    if (!antes) throw new CenarioError(404, "Unidade não encontrada no cenário.");
    const nome = dados.nome.trim();
    if (!nome) throw new CenarioError(400, "Dê um nome à unidade.");
    const mesmoNome = await prisma.cenarioUnidade.findFirst({ where: { cenarioId: id, id: { not: unidadeId }, nome: { equals: nome, mode: "insensitive" } } });
    if (mesmoNome) throw new CenarioError(409, `Já há a unidade ${mesmoNome.nome} no cenário.`);
    await prisma.cenarioUnidade.update({ where: { id: unidadeId }, data: { nome, ordem: dados.ordem, ativo: dados.ativo } });
    await auditar({ usuarioId: usuario.id, usuarioNome: usuario.nome, acao: "ALTERACAO", entidade: "cenario_unidade", entidadeId: unidadeId, antes, depois: dados, metadados: { cenario: c.nome } });
    return this.unidadesDoCenario(id, usuario);
  },

  /**
   * A aba Centros de Custo das Configurações de um analítico: a cópia dos centros, com o grupo de cada um (o Nome da
   * Controladoria; nulo nos de estoque e de investimento, que ficam fora do cenário), as linhas do Quadro de Lotação e as opções.
   */
  async centrosDoCadastroDoCenario(id: string, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    const prisma = getPrismaClient();
    const [centros, unidades, linhas, deps] = await Promise.all([
      prisma.cenarioCentroCusto.findMany({ where: { cenarioId: id }, orderBy: [{ codigoRM: { sort: "asc", nulls: "last" } }, { nomeRM: "asc" }] }),
      prisma.cenarioUnidade.findMany({ where: { cenarioId: id }, include: { unidadeNegocio: { select: { codigo: true } } }, orderBy: [{ ordem: "asc" }, { unidadeNegocio: { codigo: "asc" } }] }),
      prisma.cenarioLotacao.groupBy({ by: ["centroCustoId"], where: { cenarioId: id }, _count: { _all: true } }),
      departamentosDosCentros(prisma),
    ]);
    const nomeDaUnidade = new Map(unidades.map((u) => [u.unidadeNegocioId, u.nome]));
    const doQuadro = new Map(linhas.map((l) => [l.centroCustoId, l._count._all]));
    const departamentos = [...new Set([...deps.keys(), ...centros.flatMap((x) => (x.departamento ? [x.departamento] : []))])].sort((a, b) => a.localeCompare(b, "pt-BR"));
    return {
      editavel: !c.marcacao && !c.versaoSalvaEm && !c.reajustesAplicados,
      centros: centros.map((x) => ({
        id: x.id,
        codigoRM: x.codigoRM,
        coligada: x.coligada,
        nomeRM: x.nomeRM,
        nomeControladoria: x.nomeControladoria,
        /** O grupo do centro no cenário (nulo: de estoque ou de investimento, fora do cenário). */
        grupo: foraDoCenario(x) ? null : nomeDoGrupo(x),
        departamento: x.departamento,
        atribuicao: x.atribuicao,
        balde: x.balde,
        unidadeNegocioId: x.unidadeNegocioId,
        unidade: x.unidadeNegocioId ? (nomeDaUnidade.get(x.unidadeNegocioId) ?? null) : null,
        ativo: x.ativo,
        /** Incluído só no cenário (sem o centro de origem nos Cadastros Gerais). */
        doCenario: !x.origemId,
        linhasDoQuadro: doQuadro.get(x.id) ?? 0,
      })),
      opcoes: {
        departamentos,
        baldes: BALDES.map(([valor, rotulo]) => ({ valor, rotulo })),
        unidades: unidades.map((u) => ({ id: u.unidadeNegocioId, nome: u.nome })),
      },
    };
  },

  /**
   * Inclui ou altera um centro da cópia do cenário (20/11/2026). O grupo que ficaria sem centros: se o centro só mudou de nome
   * de grupo (para um grupo novo), os valores vão junto (o renomear); senão, saem do cenário — pede `confirmar` (409 com o
   * `grupoSemCentros`). Recalcula a DRE do cenário.
   */
  async gravarCentroDoCadastroDoCenario(
    id: string,
    centroId: string | null,
    dados: {
      codigoRM: string | null;
      coligada: number | null;
      nomeRM: string;
      nomeControladoria: string | null;
      departamento: string | null;
      atribuicao: "DIRETA" | "INDIRETA" | null;
      balde: string | null;
      unidadeNegocioId: string | null;
      ativo: boolean;
    },
    confirmar: boolean,
    usuario: Usuario,
  ) {
    const c = await obterOuFalhar(id, usuario);
    exigirQuemCriou(c, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    exigirSemReajustes(c);
    const prisma = getPrismaClient();
    const atual = centroId ? await prisma.cenarioCentroCusto.findFirst({ where: { id: centroId, cenarioId: id } }) : null;
    if (centroId && !atual) throw new CenarioError(404, "Centro de custo não encontrado no cenário.");
    const texto = (v: string | null) => v?.trim() || null;
    const codigoRM = texto(dados.codigoRM);
    if (codigoRM) {
      const outro = await prisma.cenarioCentroCusto.findFirst({ where: { cenarioId: id, codigoRM, id: centroId ? { not: centroId } : undefined } });
      if (outro) throw new CenarioError(409, `Já há o centro ${codigoRM} no cenário (${outro.nomeRM}).`);
    }
    const nomeRM = dados.nomeRM.trim();
    if (!nomeRM) throw new CenarioError(400, "Dê o nome do centro de custo (o nome no RM).");
    if (dados.balde && !BALDES.some(([b]) => b === dados.balde)) throw new CenarioError(400, `Rateio ${dados.balde} desconhecido.`);
    if (dados.unidadeNegocioId && !(await prisma.cenarioUnidade.findFirst({ where: { cenarioId: id, unidadeNegocioId: dados.unidadeNegocioId } }))) {
      throw new CenarioError(400, "A unidade dedicada não é uma das unidades do cenário.");
    }
    const departamento = texto(dados.departamento);
    const siglaDoDepartamento = departamento
      ? ((await departamentosDosCentros(prisma)).get(departamento) ??
        (await prisma.cenarioCentroCusto.findFirst({ where: { cenarioId: id, departamento, departamentoSigla: { not: null } }, select: { departamentoSigla: true } }))?.departamentoSigla ??
        null)
      : null;
    const campos = {
      codigoRM,
      coligada: dados.coligada,
      nomeRM,
      nomeControladoria: texto(dados.nomeControladoria),
      departamento,
      departamentoSigla: siglaDoDepartamento,
      atribuicao: dados.atribuicao,
      atribuicaoSigla: dados.atribuicao ? dados.atribuicao.slice(0, 3) : null,
      balde: (dados.balde as Prisma.CenarioCentroCustoCreateInput["balde"]) ?? null,
      unidadeNegocioId: dados.unidadeNegocioId,
      ativo: dados.ativo,
    };
    const { renomear, apagar } = await this.efeitoNosGrupos(id, centroId, atual, campos);
    if (apagar && !confirmar) {
      throw new CenarioError(
        409,
        `O grupo ${apagar} fica sem centros de custo: os valores dele (as premissas, os encargos, os benefícios e as justificativas) saem do cenário.`,
        { grupoSemCentros: apagar },
      );
    }
    const rotulo = `${codigoRM ? `${codigoRM} - ` : ""}${nomeRM}`;
    await prisma.$transaction(
      async (tx) => {
        if (renomear) await renomearValoresDoGrupo(tx, id, renomear.de, renomear.para);
        if (apagar) await apagarValoresDoGrupo(tx, id, apagar);
        if (atual) await tx.cenarioCentroCusto.update({ where: { id: atual.id }, data: campos });
        else await tx.cenarioCentroCusto.create({ data: { ...campos, cenarioId: id, origemId: null, ordem: (await tx.cenarioCentroCusto.count({ where: { cenarioId: id } })) + 1 } });
        await alteradoSemRecalcular(tx, id, "configuracoes");
      },
      { timeout: 120_000 },
    );
    await this.registrarCadastroNoHistorico(
      id,
      usuario,
      `Centros de Custo do cenário (Configurações): ${rotulo} ${atual ? "alterado" : "incluído"}${renomear ? `; o grupo ${renomear.de} passou a ${renomear.para}, com os valores` : ""}${apagar ? `; o grupo ${apagar} saiu do cenário, com os valores` : ""}`,
    );
    await auditar({ usuarioId: usuario.id, usuarioNome: usuario.nome, acao: atual ? "ALTERACAO" : "CRIACAO", entidade: "cenario_centro_custo", entidadeId: centroId ?? id, antes: atual ?? undefined, depois: campos, metadados: { cenario: c.nome, renomear, apagar } });
    return this.centrosDoCadastroDoCenario(id, usuario);
  },

  /** Exclui um centro da cópia do cenário (sem linhas no Quadro de Lotação), com a mesma regra do grupo que fica sem centros. */
  async excluirCentroDoCadastroDoCenario(id: string, centroId: string, confirmar: boolean, usuario: Usuario) {
    const c = await obterOuFalhar(id, usuario);
    exigirQuemCriou(c, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    exigirSemReajustes(c);
    const prisma = getPrismaClient();
    const atual = await prisma.cenarioCentroCusto.findFirst({ where: { id: centroId, cenarioId: id } });
    if (!atual) throw new CenarioError(404, "Centro de custo não encontrado no cenário.");
    const linhas = await prisma.cenarioLotacao.count({ where: { cenarioId: id, centroCustoId: centroId } });
    if (linhas) throw new CenarioError(409, `O centro está em ${linhas} ${linhas === 1 ? "linha" : "linhas"} do Quadro de Lotação do cenário: inative-o em vez de excluir (ou tire as linhas antes).`);
    const destinos = await prisma.cenarioRedistribuicaoDestino.count({ where: { centroCustoId: centroId } });
    if (destinos) throw new CenarioError(409, `O centro está em ${destinos} ${destinos === 1 ? "redistribuição" : "redistribuições"} de gastos do cenário (Redistribuir Para): tire-o delas antes de excluir.`);
    const { apagar } = await this.efeitoNosGrupos(id, centroId, atual, null);
    if (apagar && !confirmar) {
      throw new CenarioError(409, `O grupo ${apagar} fica sem centros de custo: os valores dele (as premissas, os encargos, os benefícios e as justificativas) saem do cenário.`, {
        grupoSemCentros: apagar,
      });
    }
    await prisma.$transaction(
      async (tx) => {
        if (apagar) await apagarValoresDoGrupo(tx, id, apagar);
        await tx.cenarioCentroCusto.delete({ where: { id: centroId } });
        await alteradoSemRecalcular(tx, id, "configuracoes");
      },
      { timeout: 120_000 },
    );
    const rotulo = `${atual.codigoRM ? `${atual.codigoRM} - ` : ""}${atual.nomeRM}`;
    await this.registrarCadastroNoHistorico(id, usuario, `Centros de Custo do cenário (Configurações): ${rotulo} excluído${apagar ? `; o grupo ${apagar} saiu do cenário, com os valores` : ""}`);
    await auditar({ usuarioId: usuario.id, usuarioNome: usuario.nome, acao: "EXCLUSAO", entidade: "cenario_centro_custo", entidadeId: centroId, antes: atual, metadados: { cenario: c.nome, apagar } });
    return this.centrosDoCadastroDoCenario(id, usuario);
  },

  /**
   * Renomeia um grupo da cópia (o Nome da Controladoria de todos os centros dele) e leva os valores do grupo junto (a decisão do
   * Adão). O nome de um grupo que já existe é recusado: juntar dois grupos é mover os centros um a um.
   */
  async renomearGrupoDoCenario(id: string, de: string, para: string, usuario: Usuario) {
    const c = await obterOuFalhar(id, usuario);
    exigirQuemCriou(c, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    exigirSemReajustes(c);
    const novo = para.trim();
    if (!novo) throw new CenarioError(400, "Dê o nome novo do grupo.");
    if (novo === de) return this.centrosDoCadastroDoCenario(id, usuario);
    const grupos = await gruposDoCenario(id);
    if (!grupos.some((g) => g.grupo === de)) throw new CenarioError(404, `O grupo ${de} não está no cenário.`);
    if (grupos.some((g) => g.grupo === novo)) throw new CenarioError(409, `Já há o grupo ${novo} no cenário: para juntar os dois, mude o Nome da Controladoria dos centros um a um.`);
    const prisma = getPrismaClient();
    const doGrupo = (await prisma.cenarioCentroCusto.findMany({ where: { cenarioId: id } })).filter((x) => nomeDoGrupo(x) === de);
    await prisma.$transaction(
      async (tx) => {
        await tx.cenarioCentroCusto.updateMany({ where: { id: { in: doGrupo.map((x) => x.id) } }, data: { nomeControladoria: novo } });
        await renomearValoresDoGrupo(tx, id, de, novo);
        await alteradoSemRecalcular(tx, id, "configuracoes");
      },
      { timeout: 120_000 },
    );
    await this.registrarCadastroNoHistorico(id, usuario, `Centros de Custo do cenário (Configurações): o grupo ${de} passou a ${novo} (${doGrupo.length} ${doGrupo.length === 1 ? "centro" : "centros"}), com os valores`);
    await auditar({ usuarioId: usuario.id, usuarioNome: usuario.nome, acao: "ALTERACAO", entidade: "cenario_centro_custo", entidadeId: id, metadados: { cenario: c.nome, renomearGrupo: { de, para: novo } } });
    return this.centrosDoCadastroDoCenario(id, usuario);
  },

  /** Trazer Novos dos Cadastros Gerais (a decisão do Adão): as unidades e os centros que surgiram depois da cópia. */
  async trazerNovosDosCadastrosDoCenario(id: string, usuario: Usuario) {
    const c = await obterOuFalhar(id, usuario);
    exigirQuemCriou(c, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    exigirSemReajustes(c);
    const trazidos = await getPrismaClient().$transaction(
      async (tx) => {
        const r = await trazerNovosDosCadastros(tx, id);
        if (r.centros.length || r.regras.length) await alteradoSemRecalcular(tx, id, "configuracoes");
        return r;
      },
      { timeout: 120_000 },
    );
    if (trazidos.unidades.length || trazidos.centros.length || trazidos.departamentos.length || trazidos.redistribuicoes.length || trazidos.regras.length) {
      const partes = [
        trazidos.unidades.length ? `${trazidos.unidades.length} ${trazidos.unidades.length === 1 ? "unidade" : "unidades"}` : "",
        trazidos.departamentos.length ? `${trazidos.departamentos.length} ${trazidos.departamentos.length === 1 ? "departamento" : "departamentos"}` : "",
        trazidos.centros.length ? `${trazidos.centros.length} ${trazidos.centros.length === 1 ? "centro de custo" : "centros de custo"}` : "",
        trazidos.redistribuicoes.length ? `${trazidos.redistribuicoes.length} ${trazidos.redistribuicoes.length === 1 ? "redistribuição de gastos" : "redistribuições de gastos"}` : "",
        trazidos.regras.length ? `${trazidos.regras.length} ${trazidos.regras.length === 1 ? "regra de rateio" : "regras de rateio"}` : "",
      ].filter(Boolean);
      await this.registrarCadastroNoHistorico(id, usuario, `Cadastros do cenário (Configurações): ${partes.join(" e ")} dos Cadastros Gerais`);
      await auditar({ usuarioId: usuario.id, usuarioNome: usuario.nome, acao: "ALTERACAO", entidade: "cenario", entidadeId: id, metadados: { cenario: c.nome, trazerNovos: trazidos } });
    }
    return trazidos;
  },


  // Os Benefícios Padrão (21/11/2026, pedido do Adão): a aba Benefícios Padrão das Configurações dos analíticos, depois de Centros de
  // Custo (o cadastro do cenário: o Nome, a Descrição e o Valor Mensal por colaborador), e o botão Benefícios da aba Quadro de Lotação
  // das Premissas, que os aplica às linhas e aos meses marcados (quadroDoCenario.ts). Editam como as outras cópias dos cadastros; a
  // mudança num benefício em uso recalcula a DRE.

  /** A aba Benefícios Padrão: os benefícios do cenário, com os valores (as linhas × os meses) do Quadro de Lotação que usam cada um. */
  async beneficiosDoCenario(id: string, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    const prisma = getPrismaClient();
    const [bs, meses] = await Promise.all([
      prisma.cenarioBeneficioPadrao.findMany({ where: { cenarioId: id }, orderBy: [{ ordem: "asc" }, { nome: "asc" }] }),
      prisma.cenarioLotacaoMes.findMany({ where: { linha: { cenarioId: id }, NOT: { beneficiosPadrao: { isEmpty: true } } }, select: { linhaId: true, beneficiosPadrao: true } }),
    ]);
    const uso = (b: string) => {
      const ms = meses.filter((m) => m.beneficiosPadrao.includes(b));
      return { valores: ms.length, linhas: new Set(ms.map((m) => m.linhaId)).size };
    };
    return {
      editavel: !c.marcacao && !c.versaoSalvaEm && !c.reajustesAplicados,
      beneficios: bs.map((b) => ({ id: b.id, nome: b.nome, descricao: b.descricao, valorMensal: Number(b.valorMensal), ...uso(b.id) })),
    };
  },

  /** Inclui (beneficioId nulo) ou altera um Benefício Padrão do cenário: o Nome (único no cenário), a Descrição e o Valor Mensal (/ Colab.). */
  async gravarBeneficioDoCenario(id: string, beneficioId: string | null, dados: { nome: string; descricao: string | null; valorMensal: number }, usuario: Usuario) {
    const c = await obterOuFalhar(id, usuario);
    exigirQuemCriou(c, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    exigirSemReajustes(c);
    const prisma = getPrismaClient();
    const antes = beneficioId ? await prisma.cenarioBeneficioPadrao.findFirst({ where: { id: beneficioId, cenarioId: id } }) : null;
    if (beneficioId && !antes) throw new CenarioError(404, "Benefício não encontrado no cenário.");
    const nome = dados.nome.trim();
    if (!nome) throw new CenarioError(400, "Dê um nome ao benefício.");
    if (!Number.isFinite(dados.valorMensal) || dados.valorMensal < 0 || dados.valorMensal > 1e7) throw new CenarioError(400, "O Valor Mensal (/ Colab.) é um número de zero para cima.");
    const mesmoNome = await prisma.cenarioBeneficioPadrao.findFirst({ where: { cenarioId: id, nome: { equals: nome, mode: "insensitive" }, ...(beneficioId ? { id: { not: beneficioId } } : {}) } });
    if (mesmoNome) throw new CenarioError(409, `Já há o benefício ${mesmoNome.nome} no cenário.`);
    const campos = { nome, descricao: dados.descricao?.trim() || null, valorMensal: new Prisma.Decimal(dados.valorMensal.toFixed(2)) };
    // O valor de um benefício em uso muda os Encargos e Benefícios dos grupos: a DRE se recalcula.
    const emUso = antes ? await prisma.cenarioLotacaoMes.count({ where: { linha: { cenarioId: id }, beneficiosPadrao: { has: antes.id } } }) : 0;
    await prisma.$transaction(
      async (tx) => {
        if (antes) await tx.cenarioBeneficioPadrao.update({ where: { id: antes.id }, data: campos });
        else await tx.cenarioBeneficioPadrao.create({ data: { ...campos, cenarioId: id, ordem: (await tx.cenarioBeneficioPadrao.count({ where: { cenarioId: id } })) + 1 } });
        if (emUso && Number(antes!.valorMensal) !== dados.valorMensal) await alteradoSemRecalcular(tx, id, "configuracoes");
      },
      { timeout: 120_000 },
    );
    const valor = dados.valorMensal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    await this.registrarCadastroNoHistorico(id, usuario, `Benefícios Padrão (Configurações): ${antes ? "alterado" : "incluído"} o benefício ${nome} (R$ ${valor} por colaborador)`);
    await auditar({ usuarioId: usuario.id, usuarioNome: usuario.nome, acao: antes ? "ALTERACAO" : "CRIACAO", entidade: "cenario_beneficio_padrao", entidadeId: beneficioId ?? id, antes: antes ?? undefined, depois: dados, metadados: { cenario: c.nome } });
    return this.beneficiosDoCenario(id, usuario);
  },

  /** Exclui um Benefício Padrão do cenário: ele sai também dos meses do Quadro de Lotação em que está aplicado (e a DRE se recalcula). */
  async excluirBeneficioDoCenario(id: string, beneficioId: string, usuario: Usuario) {
    const c = await obterOuFalhar(id, usuario);
    exigirQuemCriou(c, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    exigirSemReajustes(c);
    const prisma = getPrismaClient();
    const antes = await prisma.cenarioBeneficioPadrao.findFirst({ where: { id: beneficioId, cenarioId: id } });
    if (!antes) throw new CenarioError(404, "Benefício não encontrado no cenário.");
    const meses = await prisma.cenarioLotacaoMes.findMany({ where: { linha: { cenarioId: id }, beneficiosPadrao: { has: beneficioId } }, select: { linhaId: true, mes: true, beneficiosPadrao: true } });
    await prisma.$transaction(
      async (tx) => {
        for (const m of meses)
          await tx.cenarioLotacaoMes.update({ where: { linhaId_mes: { linhaId: m.linhaId, mes: m.mes } }, data: { beneficiosPadrao: m.beneficiosPadrao.filter((b) => b !== beneficioId) } });
        await tx.cenarioBeneficioPadrao.delete({ where: { id: beneficioId } });
        if (meses.length) await alteradoSemRecalcular(tx, id, "configuracoes");
      },
      { timeout: 120_000 },
    );
    await this.registrarCadastroNoHistorico(
      id,
      usuario,
      `Benefícios Padrão (Configurações): excluído o benefício ${antes.nome}${meses.length ? `, que saiu de ${meses.length} ${meses.length === 1 ? "valor" : "valores"} do Quadro de Lotação` : ""}`,
    );
    await auditar({ usuarioId: usuario.id, usuarioNome: usuario.nome, acao: "EXCLUSAO", entidade: "cenario_beneficio_padrao", entidadeId: beneficioId, antes, metadados: { cenario: c.nome, meses: meses.length } });
    return this.beneficiosDoCenario(id, usuario);
  },

  /**
   * O botão Benefícios da aba Quadro de Lotação (21/11/2026, pedido do Adão): os Benefícios Padrão marcados no modal passam a ser os
   * de cada linha marcada nos meses marcados (no lugar dos que havia e do valor digitado; sem nenhum marcado, os meses ficam sem
   * benefícios). Os Benefícios do mês são os colaboradores da linha × a soma do Valor Mensal deles; a DRE se recalcula.
   */
  async aplicarBeneficiosNoQuadro(id: string, dados: { linhas: string[]; meses: number[]; beneficios: string[] }, usuario: Usuario) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    exigirSemReajustes(c);
    const prisma = getPrismaClient();
    const ids = [...new Set(dados.linhas)];
    const meses = [...new Set(dados.meses)].filter((m) => Number.isInteger(m) && m >= 1 && m <= 12).sort((a, b) => a - b);
    if (!ids.length || !meses.length) throw new CenarioError(400, "Marque ao menos uma linha e um mês do Quadro de Lotação.");
    const [linhas, beneficios] = await Promise.all([
      prisma.cenarioLotacao.findMany({ where: { cenarioId: id, id: { in: ids } }, include: INCLUIR_DO_QUADRO }),
      prisma.cenarioBeneficioPadrao.findMany({ where: { cenarioId: id } }),
    ]);
    if (linhas.length !== ids.length) throw new CenarioError(404, "Alguma linha do Quadro de Lotação não foi encontrada: atualize a tela.");
    const escolhidos = [...new Set(dados.beneficios)];
    if (escolhidos.some((b) => !beneficios.some((x) => x.id === b))) throw new CenarioError(400, "Algum benefício não existe mais: atualize a tela (Configurações / Benefícios Padrão).");
    const q = await recorteDoQuadro(recorteDoCenario(c, usuario), id);
    exigirNoRecorte(linhas.every((l) => q.ve(l.centroCustoId)));
    const valores = new Map(beneficios.map((b) => [b.id, Number(b.valorMensal)]));
    let somaAntes = 0;
    let somaDepois = 0;
    for (const l of linhas) {
      const ms = mesesDaLinha(l.meses);
      for (const mes of meses) {
        somaAntes += beneficiosDoMes(ms[mes - 1], valores);
        somaDepois += beneficiosDoMes({ ...ms[mes - 1], beneficiosPadrao: escolhidos, beneficiosDigitados: null }, valores);
      }
    }
    await prisma.$transaction(
      async (tx) => {
        for (const l of linhas)
          for (const mes of meses)
            await tx.cenarioLotacaoMes.upsert({
              where: { linhaId_mes: { linhaId: l.id, mes } },
              create: { linhaId: l.id, mes, beneficiosPadrao: escolhidos, beneficios: null },
              update: { beneficiosPadrao: escolhidos, beneficios: null },
            });
        await alteradoSemRecalcular(tx, id, "premissas");
      },
      { timeout: 120_000 },
    );
    const nomes = beneficios.filter((b) => escolhidos.includes(b.id)).map((b) => b.nome);
    await prisma.cenarioReajuste.create({
      data: {
        cenarioId: id,
        usuarioId: usuario.id || null,
        usuarioNome: usuario.nome,
        tipo: "MARCADOS",
        modo: "DIGITADO",
        contas: linhas.map((l) => ({ codigo: `QUADRO|${l.id}`, descricao: nomeDaLinha(l) })),
        alcance: trechos(linhas.map((l) => q.trecho(l.centroCustoId))),
        meses,
        valores: linhas.length * meses.length,
        somaAntes,
        somaDepois,
        descricao: `Quadro de Lotação · Benefícios: ${nomes.length ? nomes.join(", ") : "nenhum (os meses ficaram sem benefícios)"}`.slice(0, 900),
      },
    });
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "ALTERACAO",
      entidade: "cenario_lotacao",
      entidadeId: id,
      metadados: { cenario: c.nome, beneficios: nomes, meses, linhas: linhas.map(nomeDaLinha).slice(0, 50) },
    });
    return this.quadro(id, usuario);
  },

  // Cadastros por cenário (21/11/2026, pedido do Adão): a aba Regras de Rateio das Configurações dos analíticos, depois de Centros
  // de Custo (regrasDoCenario.ts): a cópia das regras de Cadastros Gerais com que o cenário calcula os rateios. Edita como as
  // outras cópias (a Edição das Configurações, com o cenário em aberto e sem os reajustes aplicados); cada mudança recalcula a DRE
  // do cenário e fica no Histórico (aba Alterações).

  /** A aba Regras de Rateio: as regras da cópia, os conjuntos fixos, as opções do Novo Rateio e os avisos do exercício. */
  async regrasDoCenarioAba(id: string, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    return { editavel: !c.marcacao && !c.versaoSalvaEm && !c.reajustesAplicados, ...(await abaDasRegras(getPrismaClient(), id, c.ano)) };
  },

  /** Grava uma mudança nas regras do cenário (`mudar`, na transação) e recalcula a DRE, com o registro no Histórico. */
  async mudarRegrasDoCenario(id: string, usuario: Usuario, mudar: (tx: Prisma.TransactionClient) => Promise<string>) {
    const c = await obterOuFalhar(id, usuario);
    exigirQuemCriou(c, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    exigirSemReajustes(c);
    const descricao = await daRegra(() =>
      getPrismaClient().$transaction(
        async (tx) => {
          const d = await mudar(tx);
          await alteradoSemRecalcular(tx, id, "configuracoes", false);
          return d;
        },
        { timeout: 120_000 },
      ),
    );
    await this.registrarCadastroNoHistorico(id, usuario, descricao);
    await auditar({ usuarioId: usuario.id, usuarioNome: usuario.nome, acao: "ALTERACAO", entidade: "cenario_regra_rateio", entidadeId: id, metadados: { cenario: c.nome, regras: descricao } });
    return this.regrasDoCenarioAba(id, usuario);
  },

  /** Inclui (regraId nulo) ou altera uma regra paramétrica do cenário. */
  async gravarRegraDoCenario(id: string, regraId: string | null, dados: { rotulo: string; chave: string; origemDoVolume: string; inicio: string; fim: string | null }, usuario: Usuario) {
    return this.mudarRegrasDoCenario(id, usuario, (tx) => gravarRegraParametrica(tx, id, regraId, dados));
  },

  /** Exclui uma regra paramétrica do cenário. */
  async excluirRegraDoCenario(id: string, regraId: string, usuario: Usuario) {
    return this.mudarRegrasDoCenario(id, usuario, (tx) => excluirRegraParametrica(tx, id, regraId));
  },

  /** Grava um conjunto de percentuais fixos do cenário (novo, ou o de inicioAnterior). */
  async gravarFixosDoCenario(
    id: string,
    dados: { chave: string; inicioAnterior: string | null; inicio: string; fim: string | null; percentuais: Record<string, number>; rotulo: string | null },
    usuario: Usuario,
  ) {
    return this.mudarRegrasDoCenario(id, usuario, (tx) => gravarConjuntoFixo(tx, id, dados));
  },

  /** Exclui um conjunto de percentuais fixos do cenário. */
  async excluirFixosDoCenario(id: string, chave: string, inicio: string, usuario: Usuario) {
    return this.mudarRegrasDoCenario(id, usuario, (tx) => excluirConjuntoFixo(tx, id, chave, inicio));
  },

  // Cadastros por cenário, etapa 2 (20/11/2026): as abas Departamentos e Redistribuições de Gastos das Configurações dos
  // analíticos (redistribuicoesDoCenario.ts). Editam como as da etapa 1; valem na próxima carga do realizado da referência.

  /** A aba Departamentos: a cópia dos departamentos do cenário, com os grupos da DRE e as redistribuições que usam cada um. */
  async departamentosDoCenario(id: string, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    const prisma = getPrismaClient();
    const [ds, unidades, grupos, usos] = await Promise.all([
      prisma.cenarioDepartamento.findMany({ where: { cenarioId: id }, orderBy: [{ ordem: "asc" }, { nome: "asc" }] }),
      prisma.cenarioUnidade.findMany({ where: { cenarioId: id }, include: { unidadeNegocio: { select: { codigo: true } } }, orderBy: [{ ordem: "asc" }, { unidadeNegocio: { codigo: "asc" } }] }),
      gruposDaDREParaDepartamentos(),
      prisma.cenarioRedistribuicao.groupBy({ by: ["departamentoId"], where: { cenarioId: id, departamentoId: { not: null } }, _count: { _all: true } }),
    ]);
    const nomeDaUnidade = new Map(unidades.map((u) => [u.unidadeNegocioId, u.nome]));
    const nomeDoGrupoDRE = new Map(grupos.map((g) => [g.sigla, g.nome]));
    const usadas = new Map(usos.map((u) => [u.departamentoId, u._count._all]));
    return {
      editavel: !c.marcacao && !c.versaoSalvaEm && !c.reajustesAplicados,
      departamentos: ds.map((d) => ({
        id: d.id,
        unidadeNegocioId: d.unidadeNegocioId,
        unidade: nomeDaUnidade.get(d.unidadeNegocioId) ?? "",
        nome: d.nome,
        gruposDRE: d.gruposDRE,
        grupos: d.gruposDRE.map((g) => nomeDoGrupoDRE.get(g) ?? g),
        ordem: d.ordem,
        ativo: d.ativo,
        /** Incluído só no cenário (sem o departamento de origem nos Cadastros Gerais). */
        doCenario: !d.origemId,
        redistribuicoes: usadas.get(d.id) ?? 0,
      })),
      opcoes: { unidades: unidades.map((u) => ({ id: u.unidadeNegocioId, nome: u.nome })), grupos },
    };
  },

  /** Inclui (sem `departamentoId`) ou altera um departamento da cópia do cenário (as regras do cadastro). */
  async gravarDepartamentoDoCenario(
    id: string,
    departamentoId: string | null,
    dados: { unidadeNegocioId: string; nome: string; gruposDRE: string[]; ordem: number | null; ativo: boolean },
    usuario: Usuario,
  ) {
    const c = await obterOuFalhar(id, usuario);
    exigirQuemCriou(c, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    exigirSemReajustes(c);
    const prisma = getPrismaClient();
    const antes = departamentoId ? await prisma.cenarioDepartamento.findFirst({ where: { id: departamentoId, cenarioId: id } }) : null;
    if (departamentoId && !antes) throw new CenarioError(404, "Departamento não encontrado no cenário.");
    // O departamento das combinações dos índices (21/11/2026) é de uma unidade: não muda de unidade.
    if (antes && antes.unidadeNegocioId !== dados.unidadeNegocioId && departamentosDosIndices(c).has(antes.id)) {
      throw new CenarioError(409, "O departamento está nas combinações de Índices de Comparação ou de Reajuste do cenário (Configurações / Comparativo e Reajustes): tire-o delas antes de mudar a unidade dele.");
    }
    const campos = await daRegra(() => prepararDepartamento(prisma, id, dados, departamentoId));
    const { ordem, ...resto } = campos;
    if (antes) await prisma.cenarioDepartamento.update({ where: { id: antes.id }, data: { ...resto, ...(ordem !== null ? { ordem } : {}) } });
    else await prisma.cenarioDepartamento.create({ data: { ...resto, cenarioId: id, origemId: null, ordem: ordem ?? (await prisma.cenarioDepartamento.count({ where: { cenarioId: id } })) + 1 } });
    await auditar({ usuarioId: usuario.id, usuarioNome: usuario.nome, acao: antes ? "ALTERACAO" : "CRIACAO", entidade: "cenario_departamento", entidadeId: departamentoId ?? id, antes: antes ?? undefined, depois: campos, metadados: { cenario: c.nome } });
    return this.departamentosDoCenario(id, usuario);
  },

  /** Exclui um departamento da cópia do cenário (sem redistribuições do cenário que o usem). */
  async excluirDepartamentoDoCenario(id: string, departamentoId: string, usuario: Usuario) {
    const c = await obterOuFalhar(id, usuario);
    exigirQuemCriou(c, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    exigirSemReajustes(c);
    const prisma = getPrismaClient();
    const antes = await prisma.cenarioDepartamento.findFirst({ where: { id: departamentoId, cenarioId: id } });
    if (!antes) throw new CenarioError(404, "Departamento não encontrado no cenário.");
    const usos = await prisma.cenarioRedistribuicao.count({ where: { cenarioId: id, departamentoId } });
    if (usos) throw new CenarioError(409, `O departamento está em ${usos} ${usos === 1 ? "redistribuição" : "redistribuições"} de gastos do cenário: troque o departamento delas (ou inative-o) antes de excluir.`);
    if (departamentosDosIndices(c).has(departamentoId)) {
      throw new CenarioError(409, "O departamento está nas combinações de Índices de Comparação ou de Reajuste do cenário (Configurações / Comparativo e Reajustes): tire-o delas antes de excluir.");
    }
    await prisma.cenarioDepartamento.delete({ where: { id: departamentoId } });
    await auditar({ usuarioId: usuario.id, usuarioNome: usuario.nome, acao: "EXCLUSAO", entidade: "cenario_departamento", entidadeId: departamentoId, antes, metadados: { cenario: c.nome } });
    return this.departamentosDoCenario(id, usuario);
  },

  /** A aba Redistribuições de Gastos: a cópia das redistribuições do cenário e as listas do modal (as do cenário). */
  async redistribuicoesDoCenario(id: string, usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    const prisma = getPrismaClient();
    const [rs, departamentos, linhas, centros, unidades] = await Promise.all([
      prisma.cenarioRedistribuicao.findMany({
        where: { cenarioId: id },
        orderBy: [{ ativo: "desc" }, { vigenciaInicio: "desc" }, { criadoEm: "asc" }],
        include: {
          departamento: { select: { nome: true, unidadeNegocioId: true } },
          contas: { orderBy: { ordem: "asc" }, select: { linhaDREId: true, linhaDRE: { select: { codigo: true, descricao: true, grupoSigla: true, atribuicao: true } } } },
          destinos: { orderBy: { ordem: "asc" }, select: { centroCustoId: true, percentual: true, centroCusto: { select: { codigoRM: true, nomeRM: true, ativo: true } } } },
        },
      }),
      prisma.cenarioDepartamento.findMany({ where: { cenarioId: id, ativo: true }, orderBy: [{ ordem: "asc" }, { nome: "asc" }], include: { unidadeNegocio: { select: { codigo: true } } } }),
      prisma.linhaDRE.findMany({ where: { tipo: "ITEM", ativo: true }, orderBy: { ordem: "asc" }, select: LINHA_SEL }),
      prisma.cenarioCentroCusto.findMany({ where: { cenarioId: id, ativo: true }, orderBy: [{ codigoRM: { sort: "asc", nulls: "last" } }, { nomeRM: "asc" }], select: { id: true, codigoRM: true, nomeRM: true, nomeControladoria: true, departamento: true, atribuicao: true, balde: true } }),
      prisma.cenarioUnidade.findMany({ where: { cenarioId: id }, orderBy: { unidadeNegocio: { codigo: "asc" } }, select: { unidadeNegocioId: true, nome: true, unidadeNegocio: { select: { codigo: true } } } }),
    ]);
    const nomeDaUnidade = new Map(unidades.map((u) => [u.unidadeNegocioId, u.nome]));
    return {
      editavel: !c.marcacao && !c.versaoSalvaEm && !c.reajustesAplicados,
      redistribuicoes: rs.map((r) => ({
        id: r.id,
        departamentoId: r.departamentoId,
        departamento: r.departamento ? `${r.departamento.nome} (${nomeDaUnidade.get(r.departamento.unidadeNegocioId) ?? ""})` : null,
        linhasDREIds: r.contas.map((x) => x.linhaDREId),
        contas: r.contas.map((x) => ({ codigo: x.linhaDRE.codigo, rotulo: rotuloDaLinha(x.linhaDRE) })),
        fornecedores: r.fornecedores,
        destinos: r.destinos.map((d) => ({
          centroCustoId: d.centroCustoId,
          centro: `${d.centroCusto.codigoRM ?? "sem código"} · ${d.centroCusto.nomeRM}${d.centroCusto.ativo ? "" : " (inativo)"}`,
          percentual: Number(d.percentual) * 100,
        })),
        vigenciaInicio: textoDoMes(r.vigenciaInicio)!,
        vigenciaFim: textoDoMes(r.vigenciaFim),
        descricao: r.descricao,
        ativo: r.ativo,
        /** Incluída só no cenário (sem a redistribuição de origem nos Cadastros Gerais). */
        doCenario: !r.origemId,
      })),
      opcoes: {
        departamentos: departamentos.map((d) => ({
          id: d.id,
          nome: `${d.nome} (${nomeDaUnidade.get(d.unidadeNegocioId) ?? ""})`,
          linhas: linhas.filter((l) => linhaDoDepartamento(l, d)).map((l) => l.id),
        })),
        unidades: unidades.map((u) => ({ codigo: u.unidadeNegocio.codigo, nome: u.nome })),
        linhas: linhas.map(opcaoDaLinha),
        centros: centros.map((x) => ({ ...opcaoDoCentro(x), detalhe: [x.nomeControladoria, x.departamento, x.balde].filter(Boolean).join(" · ") || null })),
      },
    };
  },

  /** Os fornecedores com movimentos nas contas do modal, com o departamento da cópia do cenário (ou todos). */
  async fornecedoresDaRedistribuicaoDoCenario(id: string, departamentoId: string | null, linhasDREIds: string[], usuario: Usuario = SISTEMA) {
    const c = await obterOuFalhar(id, usuario);
    exigirAnalitico(c);
    let departamento: { gruposDRE: string[]; unidadeNegocio: { codigo: number } } | null = null;
    if (departamentoId) {
      departamento = await getPrismaClient().cenarioDepartamento.findFirst({ where: { id: departamentoId, cenarioId: id }, select: { gruposDRE: true, unidadeNegocio: { select: { codigo: true } } } });
      if (!departamento) throw new CenarioError(404, "Departamento não encontrado no cenário.");
    }
    return daRegra(() => fornecedoresDaCombinacao(departamento, linhasDREIds));
  },

  /** Inclui (sem `redistribuicaoId`) ou altera uma redistribuição da cópia do cenário (as regras do cadastro). */
  async gravarRedistribuicaoDoCenario(id: string, redistribuicaoId: string | null, dados: DadosDaRedistribuicaoDoCenario, usuario: Usuario) {
    const c = await obterOuFalhar(id, usuario);
    exigirQuemCriou(c, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    exigirSemReajustes(c);
    const prisma = getPrismaClient();
    const antes = redistribuicaoId
      ? await prisma.cenarioRedistribuicao.findFirst({ where: { id: redistribuicaoId, cenarioId: id }, include: { destinos: { orderBy: { ordem: "asc" } }, contas: { orderBy: { ordem: "asc" } } } })
      : null;
    if (redistribuicaoId && !antes) throw new CenarioError(404, "Redistribuição não encontrada no cenário.");
    const campos = await daRegra(() => prepararRedistribuicao(prisma, id, dados, redistribuicaoId));
    const { destinos, linhasDREIds, nomeDasContas: _nome, ...regra } = campos;
    const contas = contasParaGravar(linhasDREIds);
    const gravada = await prisma.$transaction(async (tx) => {
      if (antes) {
        await tx.cenarioRedistribuicaoDestino.deleteMany({ where: { redistribuicaoId: antes.id } });
        await tx.cenarioRedistribuicaoConta.deleteMany({ where: { redistribuicaoId: antes.id } });
        return tx.cenarioRedistribuicao.update({ where: { id: antes.id }, data: { ...regra, contas: { create: contas }, destinos: { create: destinos } } });
      }
      return tx.cenarioRedistribuicao.create({
        data: { ...regra, cenarioId: id, origemId: null, ordem: (await tx.cenarioRedistribuicao.count({ where: { cenarioId: id } })) + 1, contas: { create: contas }, destinos: { create: destinos } },
      });
    });
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: antes ? "ALTERACAO" : "CRIACAO",
      entidade: "cenario_redistribuicao",
      entidadeId: gravada.id,
      antes: antes ? redistribuicaoParaAuditoria(antes) : undefined,
      depois: redistribuicaoParaAuditoria({ ...regra, contas, destinos }),
      metadados: { cenario: c.nome },
    });
    return this.redistribuicoesDoCenario(id, usuario);
  },

  /** Exclui uma redistribuição da cópia do cenário (vale só nas próximas cargas do realizado: nada a desfazer). */
  async excluirRedistribuicaoDoCenario(id: string, redistribuicaoId: string, usuario: Usuario) {
    const c = await obterOuFalhar(id, usuario);
    exigirQuemCriou(c, usuario);
    exigirAnalitico(c);
    exigirEditavel(c);
    exigirSemReajustes(c);
    const prisma = getPrismaClient();
    const antes = await prisma.cenarioRedistribuicao.findFirst({ where: { id: redistribuicaoId, cenarioId: id }, include: { destinos: { orderBy: { ordem: "asc" } }, contas: { orderBy: { ordem: "asc" } } } });
    if (!antes) throw new CenarioError(404, "Redistribuição não encontrada no cenário.");
    await prisma.cenarioRedistribuicao.delete({ where: { id: redistribuicaoId } });
    await auditar({ usuarioId: usuario.id, usuarioNome: usuario.nome, acao: "EXCLUSAO", entidade: "cenario_redistribuicao", entidadeId: redistribuicaoId, antes: redistribuicaoParaAuditoria(antes), metadados: { cenario: c.nome } });
    return this.redistribuicoesDoCenario(id, usuario);
  },

  /**
   * O que a mudança de um centro faz nos grupos do cenário: o grupo de antes que fica sem centros vai para o nome novo
   * (`renomear`: o centro era o último dele e foi para um grupo que ainda não existe) ou sai do cenário (`apagar`).
   */
  async efeitoNosGrupos(
    id: string,
    centroId: string | null,
    atual: { ativo: boolean; departamento: string | null; codigoRM: string | null; nomeControladoria: string | null; nomeRM: string } | null,
    depois: { ativo: boolean; departamento: string | null; codigoRM: string | null; nomeControladoria: string | null; nomeRM: string } | null,
  ): Promise<{ renomear: { de: string; para: string } | null; apagar: string | null }> {
    const grupoDe = (x: typeof atual) => (x && x.ativo && !foraDoCenario(x) ? nomeDoGrupo(x) : null);
    const antes = grupoDe(atual);
    const novo = grupoDe(depois);
    if (!antes || antes === novo) return { renomear: null, apagar: null };
    const grupos = await gruposDoCenario(id);
    const g = grupos.find((x) => x.grupo === antes);
    if (!g || g.centros.some((x) => x.id !== centroId)) return { renomear: null, apagar: null };
    if (novo && !grupos.some((x) => x.grupo === novo)) return { renomear: { de: antes, para: novo }, apagar: null };
    return { renomear: null, apagar: antes };
  },

  /** A mudança nos cadastros do cenário no Histórico (aba Alterações): um recálculo do cenário inteiro, que todos veem. */
  async registrarCadastroNoHistorico(id: string, usuario: Usuario, descricao: string) {
    await getPrismaClient().cenarioReajuste.create({ data: { cenarioId: id, usuarioId: usuario.id || null, usuarioNome: usuario.nome, tipo: "RECALCULO", modo: "DIGITADO", descricao: descricao.slice(0, 900), contas: [] } });
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
    const est = await estruturaDRE();
    // Nos analíticos (21/11/2026), a variação da conta em cada unidade, pelas combinações dos Índices de Comparação (no
    // Consolidado, a maior das unidades); nos sintéticos, a digitada.
    const variacoes = (c.variacoesMaximas ?? {}) as Record<string, number>;
    const doIndice = c.tipo === "ANALITICO" ? await limitesDasCelulas(prisma, c, est) : null;
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
    // Com o Acesso às Informações Por Recorte (12/11/2026), só as contas dos departamentos do recorte (pela sigla do grupo).
    const recorte = recorteDoCenario(c, usuario);
    return {
      comparadoCom: comparado,
      visoes: ABAS_DRE.map(({ visao, nome }) => ({
        visao,
        nome,
        itens: verificadas.flatMap(({ linha, total }) => {
          if (!veDepartamentos(recorte, departamentosDaConta(linha.codigo))) return [];
          const limite = doIndice ? limiteNaVisao(doIndice, linha.codigo, visao) : limiteDaLinha(variacoes, linha.codigo, acimaDe.get(linha.codigo) ?? []);
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
    const c = await obterOuFalhar(id, usuario);
    exigirEditavel(c);
    exigirNoRecorte(veDepartamentos(recorteDoCenario(c, usuario), departamentosDaConta(dados.linha)));
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

  /**
   * Grava os lançamentos manuais de um indicador (os 12 meses; vazio apaga o mês). Os meses que mudam vão para o Histórico do
   * cenário (16/11/2026, com o modal Editar Valor: a origem diz o reajuste e se replicou), como as edições das premissas.
   */
  async salvarManual(id: string, nome: string, valores: Array<number | null>, usuario: Usuario, origem?: OrigemDaGravacao) {
    const c = await obterOuFalhar(id, usuario);
    // Nos sintéticos, os Indicadores Manuais são uma aba da tela Resultados (12/11/2026), como a DRE: valem a permissão da aba
    // (a rota confere), sem a Edição das Configurações; nos analíticos, ficam nas Premissas.
    exigirEditavel(c);
    // A Liberação de Projetos: Matriz e Filial (16/11/2026): manuais nos analíticos, a base do rateio de Projeto.
    const projeto = c.tipo === "ANALITICO" && LIBERACOES_DIGITADAS.has(nome);
    if (c.tipo === "ANALITICO" && nome === liberacaoTotal())
      throw new CenarioError(400, `${nome} é a soma da Liberação de Projetos: Matriz e da Filial e não se digita.`);
    if (!MANUAIS.has(nome) && !projeto) throw new CenarioError(400, `${nome} não é um lançamento manual: sai da DRE do cenário.`);
    if (c.tipo === "ANALITICO" && QUADROS_DE_LOTACAO.has(nome))
      throw new CenarioError(400, `${nome} sai do Quadro de Lotação dos centros de custo (Premissas / Centros de Custo) e não se digita.`);
    const prisma = getPrismaClient();
    // O recorte (12/11/2026): o indicador de um grupo dos departamentos dele.
    const recorte = recorteDoCenario(c, usuario);
    const ind = await prisma.indicadorEstrutura.findFirst({ where: { nome }, select: { grupo: true } });
    const departamentos = departamentosDoGrupoDoIndicador(ind?.grupo ?? "");
    if (recorte) exigirNoRecorte(veDepartamentos(recorte, departamentos));
    const antes = await prisma.cenarioIndicador.findMany({ where: { cenarioId: id, nome, mes: { gte: 1 } }, orderBy: { mes: "asc" } });
    // Os meses que mudam (o valor ou o em branco), para o Histórico.
    const valorAntes = (mes: number) => {
      const a = antes.find((x) => x.mes === mes);
      return a ? Number(a.valor) : null;
    };
    const mudados = valores.flatMap((v, k) => {
      const a = valorAntes(k + 1);
      const igual = v === null ? a === null : a !== null && Math.abs(a - v) < 1e-9;
      return igual ? [] : [{ mes: k + 1, antes: a, depois: v }];
    });
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
      // A Liberação de Projetos muda os percentuais do rateio de Projeto: a DRE do cenário se recalcula.
      if (projeto) await alteradoSemRecalcular(tx, id, "premissas", false);
    }, { timeout: 300_000 });
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
    if (mudados.length)
      await prisma.cenarioReajuste.create({
        data: {
          cenarioId: id,
          usuarioId: usuario.id || null,
          usuarioNome: usuario.nome,
          tipo: origem?.tipo ?? "VALOR",
          modo: origem?.modo ?? "DIGITADO",
          reajuste: origem?.reajuste ?? null,
          replicado: !!origem?.replicado,
          contas: [{ codigo: `I|${nome}`, descricao: `Indicadores Manuais · ${nome}` }],
          meses: mudados.map((m) => m.mes),
          valores: mudados.length,
          somaAntes: mudados.reduce((s, m) => s + (m.antes ?? 0), 0),
          somaDepois: mudados.reduce((s, m) => s + (m.depois ?? 0), 0),
          descricao: "Indicadores Manuais",
          alcance: trechos([{ d: departamentos }]),
        },
      });
  },
};
