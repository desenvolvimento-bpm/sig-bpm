import { getPrismaClient } from "../../config/prisma.js";
import { ArquivoInvalidoError, lerAba, listarAbas, type LinhaPlanilha, type ValorCelula } from "../../lib/xlsx.js";
import { auditar } from "../auditoriaService.js";
import { localizarCabecalho } from "../importacoes/listas/leituraListas.js";
import { plural } from "../../utils/plural.js";
import { travaDoLancamentoInicial } from "./travaDoLancamentoInicial.js";

/**
 * As importações da tela Cadastros da Gestão de Colaboradores (06/11/2026, pedido do Adão): a planilha de Funções (as colunas
 * Função, Descrição, Senioridade, Competências e Atividades) e a do Lançamento Inicial (Unidade, Tipo, Senioridade, Função e Centro
 * de Custo, um colaborador por linha). Primeiro a prévia, linha a linha; com uma linha inválida (uma senioridade, uma função ou um
 * centro de custo não cadastrado…), a importação é cancelada: nada se grava até a planilha vir certa. Gravar relê o arquivo
 * e confere tudo de novo.
 *
 * As duas importações substituem o cadastro inteiro (11/11/2026, pedido do Adão; antes, nas funções, as que não estavam
 * na planilha ficavam): o Lançamento Inicial anterior sai todo e entram as linhas da planilha, na competência escolhida (o
 * quadro do início do mês); nas funções, as da planilha são cadastradas de novo — a do mesmo nome e senioridade (sem
 * diferença de maiúsculas e acentos) fica com os dados da planilha e com os vínculos dela — e as que não estão na planilha
 * são excluídas. Uma função excluída que o Lançamento Inicial usa apaga o Lançamento Inicial junto (importe-o de novo em
 * seguida); uma que as movimentações do Quadro de Lotação ou os cenários usam cancela a importação (é histórico).
 */

export class ImportacaoColaboradoresError extends Error {
  constructor(
    readonly status: 400 | 409,
    message: string,
  ) {
    super(message);
  }
}

export type TipoImportacaoColaboradores = "funcoes" | "lancamento-inicial";
export const TIPOS_IMPORTACAO_COLABORADORES: TipoImportacaoColaboradores[] = ["funcoes", "lancamento-inicial"];
export type SituacaoLinha = "NOVA" | "ALTERADA" | "IGUAL" | "INVALIDA";
export type LinhaDaPrevia = { linha: number; valores: Record<string, string>; situacao: SituacaoLinha; motivo?: string };
export type PreviaColaboradores = {
  tipo: TipoImportacaoColaboradores;
  nomeArquivo: string;
  aba: string;
  colunas: Array<{ chave: string; rotulo: string }>;
  linhas: LinhaDaPrevia[];
  resumo: Record<SituacaoLinha, number>;
  /** O Lançamento Inicial: a competência escolhida e o que ele substitui. */
  competencia?: string;
  substitui?: { competencia: string; colaboradores: number } | null;
  /** As funções (11/11/2026): as que saem do cadastro (não estão na planilha; até 200 nomes, "Função · Senioridade"). */
  excluidas?: { total: number; nomes: string[] };
  /** As funções que saem e estão em movimentações do Quadro de Lotação ou nos cenários: a importação é recusada. */
  bloqueio?: string | null;
  /** O Lançamento Inicial que usa funções que saem: é apagado junto (`funcoes`, quantas das que saem ele usa). */
  apagaLancamentoInicial?: { competencia: string; colaboradores: number; funcoes: number } | null;
};

/** Sem acentos, sem espaços repetidos e em maiúsculas: a comparação dos nomes da planilha com os cadastros. */
export const chaveDoNome = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
const textoDaCelula = (v: ValorCelula | undefined) => (v === null || v === undefined ? "" : String(v).trim());
const mesAno = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;

type Coluna = { chave: string; rotulo: string; cabecalhos: string[]; obrigatoria: boolean };
const COLUNAS: Record<TipoImportacaoColaboradores, Coluna[]> = {
  funcoes: [
    { chave: "funcao", rotulo: "Função", cabecalhos: ["FUNÇÃO", "FUNCAO"], obrigatoria: true },
    { chave: "descricao", rotulo: "Descrição", cabecalhos: ["DESCRIÇÃO", "DESCRICAO"], obrigatoria: false },
    // A Senioridade: a planilha com o cabeçalho Nível também vale.
    { chave: "senioridade", rotulo: "Senioridade", cabecalhos: ["SENIORIDADE", "NÍVEL", "NIVEL"], obrigatoria: false },
    { chave: "competencias", rotulo: "Competências", cabecalhos: ["COMPETÊNCIAS", "COMPETENCIAS"], obrigatoria: false },
    { chave: "atividades", rotulo: "Atividades", cabecalhos: ["ATIVIDADES"], obrigatoria: false },
  ],
  "lancamento-inicial": [
    { chave: "unidade", rotulo: "Unidade", cabecalhos: ["UNIDADE"], obrigatoria: true },
    { chave: "tipo", rotulo: "Tipo", cabecalhos: ["TIPO"], obrigatoria: true },
    { chave: "senioridade", rotulo: "Senioridade", cabecalhos: ["SENIORIDADE", "NÍVEL", "NIVEL"], obrigatoria: true },
    { chave: "funcao", rotulo: "Função", cabecalhos: ["FUNÇÃO", "FUNCAO"], obrigatoria: true },
    { chave: "centro", rotulo: "Centro de Custo", cabecalhos: ["CENTRO DE CUSTO", "CENTRO"], obrigatoria: true },
  ],
};

/** A linha sem dado: as células vazias ou com 0 (o resto de uma fórmula, como o das linhas sem colaborador). */
const linhaSemDado = (valores: Record<string, string>) => Object.values(valores).every((v) => !v || v === "0");

/**
 * As linhas da planilha, com o valor de cada coluna: a aba que tem o cabeçalho (até a 10ª linha) com mais das colunas
 * esperadas (11/11/2026: a planilha com várias abas, como a da carga inicial, que tem as funções e os colaboradores; no
 * empate, a primeira). Cada coluna aceita os nomes de `cabecalhos` (com ou sem acento); as linhas vazias (ou só com 0)
 * ficam de fora.
 */
export function lerPlanilha(conteudo: Uint8Array, tipo: TipoImportacaoColaboradores) {
  let abas: string[];
  try {
    abas = listarAbas(conteudo);
  } catch {
    throw new ImportacaoColaboradoresError(400, "O arquivo não é uma planilha .xlsx válida.");
  }
  const colunas = COLUNAS[tipo];
  let primeiroErro: string | null = null;
  let melhor: { aba: string; itens: Array<{ linha: number; valores: Record<string, string> }>; colunas: number } | null = null;
  for (const aba of abas) {
    let linhas: LinhaPlanilha[];
    try {
      linhas = lerAba(conteudo, () => aba).linhas;
    } catch (error) {
      if (error instanceof ArquivoInvalidoError) continue;
      throw error;
    }
    // Cada coluna pelo primeiro nome que a aba tem.
    const nomes = new Set(linhas.slice(0, 10).flatMap((l) => l.celulas.map((c) => textoDaCelula(c).toUpperCase())));
    const escolhidos = colunas.map((c) => c.cabecalhos.find((h) => nomes.has(h)) ?? c.cabecalhos[0]);
    const cab = localizarCabecalho(
      linhas,
      escolhidos.filter((_, i) => colunas[i].obrigatoria),
      escolhidos.filter((_, i) => !colunas[i].obrigatoria),
    );
    if ("erro" in cab) {
      primeiroErro ??= cab.erro;
      continue;
    }
    const itens = linhas
      .filter((l) => l.numero > cab.numero)
      .map((l) => ({
        linha: l.numero,
        valores: Object.fromEntries(colunas.map((c, i) => [c.chave, cab.col[escolhidos[i]] >= 0 ? textoDaCelula(l.celulas[cab.col[escolhidos[i]]]) : ""])),
      }))
      .filter((l) => !linhaSemDado(l.valores));
    const achadas = escolhidos.filter((h) => cab.col[h] >= 0).length;
    if (!melhor || achadas > melhor.colunas) melhor = { aba, itens, colunas: achadas };
  }
  if (melhor) return { aba: melhor.aba, itens: melhor.itens };
  const esperado = colunas.filter((c) => c.obrigatoria).map((c) => c.rotulo).join(", ");
  throw new ImportacaoColaboradoresError(400, `Nenhuma aba da planilha tem as colunas ${esperado}. ${primeiroErro ?? ""}`.trim());
}

type Db = ReturnType<typeof getPrismaClient>;
const resumoDe = (linhas: LinhaDaPrevia[]) =>
  ({ NOVA: 0, ALTERADA: 0, IGUAL: 0, INVALIDA: 0, ...Object.fromEntries((["NOVA", "ALTERADA", "IGUAL", "INVALIDA"] as SituacaoLinha[]).map((s) => [s, linhas.filter((l) => l.situacao === s).length])) }) as Record<
    SituacaoLinha,
    number
  >;

// ------------------------------------------------------------------------------------------------------------ funções
async function previaFuncoes(db: Db, itens: Array<{ linha: number; valores: Record<string, string> }>) {
  const [funcoes, senioridades] = await Promise.all([
    db.colaboradorFuncao.findMany({ include: { senioridade: { select: { nome: true } }, _count: { select: { cargaInicial: true, movimentacoes: true, cenarios: true } } } }),
    db.colaboradorSenioridade.findMany(),
  ]);
  // A função por senioridade (11/11/2026, pedido do Adão): a chave é o nome com a senioridade; só o par se repete.
  const par = (nome: string, senioridadeId: string | null) => `${chaveDoNome(nome)}|${senioridadeId ?? ""}`;
  const funcaoPorPar = new Map(funcoes.map((f) => [par(f.nome, f.senioridadeId), f]));
  // O nome com a grafia da planilha (a da primeira linha da função), igual em todas as senioridades.
  const grafia = new Map<string, string>();
  const senioridadePorNome = new Map(senioridades.map((s) => [chaveDoNome(s.nome), s]));
  const vistas = new Map<string, number>();
  // As funções do cadastro que a planilha traz (ficam, com os dados dela); as demais saem.
  const ficam = new Set<string>();
  const gravar: Array<{ id: string | null; dados: { nome: string; descricao: string | null; senioridadeId: string | null; competencias: string | null; atividades: string | null; ativo: boolean } }> = [];
  const linhas: LinhaDaPrevia[] = itens.map(({ linha, valores }) => {
    const invalida = (motivo: string): LinhaDaPrevia => ({ linha, valores, situacao: "INVALIDA", motivo });
    if (!valores.funcao) return invalida("Sem a função.");
    const senioridade = valores.senioridade ? senioridadePorNome.get(chaveDoNome(valores.senioridade)) : null;
    if (valores.senioridade && !senioridade) return invalida(`A senioridade ${valores.senioridade} não está cadastrada (aba Senioridades).`);
    const chave = par(valores.funcao, senioridade?.id ?? null);
    if (vistas.has(chave)) return invalida(`Função e senioridade repetidas na planilha (linha ${vistas.get(chave)}).`);
    vistas.set(chave, linha);
    const nome = grafia.get(chaveDoNome(valores.funcao)) ?? valores.funcao;
    grafia.set(chaveDoNome(valores.funcao), nome);
    // Cadastrada de novo: os dados da planilha, ativa.
    const dados = {
      nome,
      descricao: valores.descricao || null,
      senioridadeId: senioridade?.id ?? null,
      competencias: valores.competencias || null,
      atividades: valores.atividades || null,
      ativo: true,
    };
    const existente = funcaoPorPar.get(chave);
    if (!existente) {
      gravar.push({ id: null, dados });
      return { linha, valores, situacao: "NOVA" };
    }
    // A do mesmo nome e senioridade fica (com os vínculos dela: o Lançamento Inicial, as movimentações, os cenários).
    ficam.add(existente.id);
    const igual =
      existente.nome === dados.nome &&
      existente.descricao === dados.descricao &&
      existente.competencias === dados.competencias &&
      existente.atividades === dados.atividades &&
      existente.ativo;
    if (igual) return { linha, valores, situacao: "IGUAL" };
    gravar.push({ id: existente.id, dados });
    return { linha, valores, situacao: "ALTERADA" };
  });
  // As que não estão na planilha saem. As das movimentações do Quadro de Lotação e dos cenários não se excluem (é o
  // histórico): a importação é recusada; as do Lançamento Inicial apagam o Lançamento Inicial junto.
  const saem = funcoes.filter((f) => !ficam.has(f.id));
  const rotulo = (f: (typeof funcoes)[number]) => `${f.nome} · ${f.senioridade?.nome ?? "sem senioridade"}`;
  const emUso = saem.filter((f) => f._count.movimentacoes || f._count.cenarios);
  const bloqueio = emUso.length
    ? `${emUso.length} ${plural(emUso.length, "função que não está", "funções que não estão")} na planilha ${emUso.length === 1 ? "está" : "estão"} em movimentações do Quadro de Lotação ou nos cenários e não ${emUso.length === 1 ? "pode ser excluída" : "podem ser excluídas"}: ${emUso
        .slice(0, 10)
        .map(rotulo)
        .join("; ")}${emUso.length > 10 ? ` e mais ${emUso.length - 10}` : ""}. ${emUso.length === 1 ? "Inclua-a na planilha para mantê-la." : "Inclua-as na planilha para mantê-las."}`
    : null;
  return { linhas, gravar, saem, rotulos: saem.map(rotulo), bloqueio, naCarga: saem.filter((f) => f._count.cargaInicial).length };
}

// ------------------------------------------------------------------------------------------------- lançamento inicial
/** Os campos de uma linha como a do Lançamento Inicial: os textos da planilha. */
export type CamposDoColaborador = { unidade: string; tipo: string; senioridade: string; funcao: string; centro: string };
export type ColaboradorResolvido = { unidadeNegocioId: string; vinculo: "CLT" | "PJ"; senioridadeId: string; funcaoId: string; centroCustoId: string };

/**
 * Os cadastros de uma linha como a do Lançamento Inicial pelos textos da planilha (09/11/2026: também a aba Quadro de
 * Lotação dos cenários analíticos): a unidade pelo nome ou pelo código, o tipo (CLT ou PJ), a senioridade pelo nome, a função
 * pelo nome e pela senioridade (11/11/2026: a função é cadastrada por senioridade; a sem senioridade vale para todas), as duas
 * ativas, e o centro de custo pelo código, pelo "código - nome" ou pelo nome (ativo). Devolve os motivos de recusa
 * ou os cadastros.
 */
export async function resolvedorDeColaboradores(db: Db) {
  const [unidades, senioridades, funcoes, centros] = await Promise.all([
    db.unidadeNegocio.findMany(),
    db.colaboradorSenioridade.findMany(),
    db.colaboradorFuncao.findMany(),
    db.centroCusto.findMany({ select: { id: true, codigoRM: true, nomeRM: true, ativo: true } }),
  ]);
  const unidadePorNome = new Map(unidades.flatMap((u) => [[chaveDoNome(u.nome), u] as const, [String(u.codigo), u] as const]));
  const senioridadePorNome = new Map(senioridades.map((s) => [chaveDoNome(s.nome), s]));
  const funcoesPorNome = new Map<string, typeof funcoes>();
  for (const f of funcoes) funcoesPorNome.set(chaveDoNome(f.nome), [...(funcoesPorNome.get(chaveDoNome(f.nome)) ?? []), f]);
  const centroPorCodigo = new Map(centros.filter((c) => c.codigoRM).map((c) => [chaveDoNome(c.codigoRM!), c]));
  // Pelo nome, só os que não se repetem no cadastro.
  const porNome = new Map<string, typeof centros>();
  for (const c of centros) porNome.set(chaveDoNome(c.nomeRM), [...(porNome.get(chaveDoNome(c.nomeRM)) ?? []), c]);
  const centroDe = (v: string) => {
    const chave = chaveDoNome(v);
    // O código, o "código - nome" ou o nome.
    const codigo = chave.split(" - ")[0].trim();
    const pelos = centroPorCodigo.get(chave) ?? centroPorCodigo.get(codigo);
    if (pelos) return pelos;
    const nomes = porNome.get(chave) ?? porNome.get(chave.split(" - ").slice(1).join(" - ").trim()) ?? [];
    return nomes.length === 1 ? nomes[0] : nomes.length > 1 ? ("REPETIDO" as const) : null;
  };
  return (valores: CamposDoColaborador): { motivos: string[]; cadastros: ColaboradorResolvido | null } => {
    const motivos: string[] = [];
    const unidade = unidadePorNome.get(chaveDoNome(valores.unidade));
    if (!valores.unidade) motivos.push("Sem a unidade.");
    else if (!unidade) motivos.push(`A unidade ${valores.unidade} não está cadastrada.`);
    const vinculo = chaveDoNome(valores.tipo);
    if (vinculo !== "CLT" && vinculo !== "PJ") motivos.push(valores.tipo ? `O tipo ${valores.tipo} não é CLT nem PJ.` : "Sem o tipo (CLT ou PJ).");
    const senioridade = senioridadePorNome.get(chaveDoNome(valores.senioridade));
    if (!valores.senioridade) motivos.push("Sem a senioridade.");
    else if (!senioridade) motivos.push(`A senioridade ${valores.senioridade} não está cadastrada.`);
    else if (!senioridade.ativo) motivos.push(`A senioridade ${senioridade.nome} está inativa.`);
    // A função da senioridade da linha; sem ela, a função sem senioridade (a que vale para todas).
    const daFuncao = funcoesPorNome.get(chaveDoNome(valores.funcao)) ?? [];
    const funcao = senioridade ? (daFuncao.find((f) => f.senioridadeId === senioridade.id) ?? daFuncao.find((f) => !f.senioridadeId)) : undefined;
    if (!valores.funcao) motivos.push("Sem a função.");
    else if (!daFuncao.length) motivos.push(`A função ${valores.funcao} não está cadastrada.`);
    else if (senioridade && !funcao) motivos.push(`A função ${daFuncao[0].nome} não está cadastrada com a senioridade ${senioridade.nome} (Cadastros › Funções).`);
    else if (funcao && !funcao.ativo) motivos.push(`A função ${funcao.nome}${senioridade ? ` (${senioridade.nome})` : ""} está inativa.`);
    const centro = valores.centro ? centroDe(valores.centro) : null;
    if (!valores.centro) motivos.push("Sem o centro de custo.");
    else if (centro === "REPETIDO") motivos.push(`Há mais de um centro de custo com o nome ${valores.centro}: use o código.`);
    else if (!centro) motivos.push(`O centro de custo ${valores.centro} não está cadastrado.`);
    else if (!centro.ativo) motivos.push(`O centro de custo ${centro.codigoRM ?? centro.nomeRM} está inativo.`);
    if (motivos.length || !unidade || !senioridade || !funcao || !centro || centro === "REPETIDO") return { motivos, cadastros: null };
    return { motivos, cadastros: { unidadeNegocioId: unidade.id, vinculo: vinculo as "CLT" | "PJ", senioridadeId: senioridade.id, funcaoId: funcao.id, centroCustoId: centro.id } };
  };
}

async function previaLancamentoInicial(db: Db, itens: Array<{ linha: number; valores: Record<string, string> }>) {
  const resolver = await resolvedorDeColaboradores(db);
  const gravar: Array<ColaboradorResolvido & { linhaArquivo: number }> = [];
  const linhas: LinhaDaPrevia[] = itens.map(({ linha, valores }) => {
    const r = resolver(valores as CamposDoColaborador);
    if (!r.cadastros) return { linha, valores, situacao: "INVALIDA", motivo: r.motivos.join(" ") };
    gravar.push({ ...r.cadastros, linhaArquivo: linha });
    return { linha, valores, situacao: "NOVA" };
  });
  return { linhas, gravar };
}

/** "2026-11" → { ano, mes }. */
export function lerCompetencia(v: unknown) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(v ?? ""));
  const mes = m ? Number(m[2]) : 0;
  if (!m || mes < 1 || mes > 12) throw new ImportacaoColaboradoresError(400, "Escolha a competência do Lançamento Inicial (o mês do quadro).");
  return { ano: Number(m[1]), mes };
}

export const importacaoColaboradoresService = {
  /**
   * A prévia (sem `gravar`) ou a importação (com `gravar`, que recusa a planilha com alguma linha inválida). `competencia`
   * (aaaa-mm): a do Lançamento Inicial.
   */
  async importar(input: { tipo: TipoImportacaoColaboradores; nomeArquivo: string; conteudo: Uint8Array; competencia?: string; gravar: boolean; usuarioId: string }) {
    if (input.conteudo.length === 0) throw new ImportacaoColaboradoresError(400, "O arquivo enviado está vazio.");
    const db = getPrismaClient();
    // Com competências fechadas na Gestão de Colaboradores, o Lançamento Inicial não se importa (13/11/2026, pedido do Adão).
    const trava = await travaDoLancamentoInicial(db);
    if (input.tipo === "lancamento-inicial" && trava) throw new ImportacaoColaboradoresError(409, trava);
    const competencia = input.tipo === "lancamento-inicial" ? lerCompetencia(input.competencia) : null;
    const { aba, itens } = lerPlanilha(input.conteudo, input.tipo);
    if (itens.length === 0) throw new ImportacaoColaboradoresError(400, `A aba ${aba} não tem nenhuma linha preenchida abaixo do cabeçalho.`);

    const funcoes = input.tipo === "funcoes" ? await previaFuncoes(db, itens) : null;
    // A importação das Funções que apagaria o Lançamento Inicial também para com a trava (13/11/2026).
    if (funcoes && !funcoes.bloqueio && funcoes.naCarga && trava) {
      funcoes.bloqueio = `${funcoes.naCarga} ${plural(funcoes.naCarga, "função que sai da planilha está", "funções que saem da planilha estão")} no Lançamento Inicial, e a importação o apagaria. ${trava}`;
    }
    const carga = input.tipo === "lancamento-inicial" ? await previaLancamentoInicial(db, itens) : null;
    const linhas = (funcoes ?? carga)!.linhas;
    const resumo = resumoDe(linhas);
    const anterior = carga || funcoes?.naCarga ? await db.colaboradorCargaInicial.findFirst({ select: { ano: true, mes: true } }) : null;
    const previa: PreviaColaboradores = {
      tipo: input.tipo,
      nomeArquivo: input.nomeArquivo,
      aba,
      colunas: COLUNAS[input.tipo].map(({ chave, rotulo }) => ({ chave, rotulo })),
      linhas,
      resumo,
      ...(competencia ? { competencia: mesAno(competencia.ano, competencia.mes) } : {}),
      ...(carga ? { substitui: anterior ? { competencia: mesAno(anterior.ano, anterior.mes), colaboradores: await db.colaboradorCargaInicial.count() } : null } : {}),
      ...(funcoes
        ? {
            excluidas: { total: funcoes.saem.length, nomes: funcoes.rotulos.slice(0, 200) },
            bloqueio: funcoes.bloqueio,
            apagaLancamentoInicial:
              funcoes.naCarga && anterior ? { competencia: mesAno(anterior.ano, anterior.mes), colaboradores: await db.colaboradorCargaInicial.count(), funcoes: funcoes.naCarga } : null,
          }
        : {}),
    };
    if (!input.gravar) return previa;

    if (resumo.INVALIDA) {
      throw new ImportacaoColaboradoresError(
        409,
        `A importação foi cancelada: a planilha tem ${resumo.INVALIDA} ${plural(resumo.INVALIDA, "linha inválida", "linhas inválidas")}. Corrija a planilha (ou os cadastros) e escolha o arquivo de novo.`,
      );
    }
    if (funcoes) {
      if (funcoes.bloqueio) throw new ImportacaoColaboradoresError(409, `A importação foi cancelada: ${funcoes.bloqueio}`);
      // A substituição (11/11/2026): primeiro saem as que não estão na planilha (e, se ele usa alguma, o Lançamento Inicial);
      // depois, as novas de uma vez e as alteradas uma a uma (com uma linha por senioridade, a planilha passa de 300 funções;
      // uma a uma, a transação passava dos 5 s e era desfeita).
      const apagado = previa.apagaLancamentoInicial ?? null;
      await db.$transaction(
        async (tx) => {
          if (apagado) await tx.colaboradorCargaInicial.deleteMany({});
          if (funcoes.saem.length) await tx.colaboradorFuncao.deleteMany({ where: { id: { in: funcoes.saem.map((f) => f.id) } } });
          const novas = funcoes.gravar.filter((g) => !g.id).map((g) => g.dados);
          if (novas.length) await tx.colaboradorFuncao.createMany({ data: novas });
          for (const g of funcoes.gravar) if (g.id) await tx.colaboradorFuncao.update({ where: { id: g.id }, data: g.dados });
        },
        { timeout: 60_000 },
      );
      await auditar({
        usuarioId: input.usuarioId,
        acao: "IMPORTACAO",
        entidade: "colaborador_funcao",
        metadados: { arquivo: input.nomeArquivo, aba, novas: resumo.NOVA, alteradas: resumo.ALTERADA, iguais: resumo.IGUAL, excluidas: funcoes.saem.length, lancamentoInicialApagado: apagado },
      });
      if (apagado) {
        await auditar({
          usuarioId: input.usuarioId,
          acao: "EXCLUSAO",
          entidade: "colaborador_carga_inicial",
          antes: { competencia: apagado.competencia, colaboradores: apagado.colaboradores },
          metadados: { motivo: `importação das funções (${input.nomeArquivo}): ${apagado.funcoes} ${plural(apagado.funcoes, "função excluída estava", "funções excluídas estavam")} no Lançamento Inicial` },
        });
      }
    }
    if (carga && competencia) {
      await db.$transaction(async (tx) => {
        await tx.colaboradorCargaInicial.deleteMany({});
        await tx.colaboradorCargaInicial.createMany({ data: carga.gravar.map((g) => ({ ...g, ano: competencia.ano, mes: competencia.mes })) });
      }, { timeout: 60_000 });
      await auditar({
        usuarioId: input.usuarioId,
        acao: "IMPORTACAO",
        entidade: "colaborador_carga_inicial",
        antes: previa.substitui ?? undefined,
        metadados: { arquivo: input.nomeArquivo, aba, competencia: previa.competencia, colaboradores: carga.gravar.length },
      });
    }
    return previa;
  },
};
