import { getPrismaClient } from "../../config/prisma.js";
import { ArquivoInvalidoError, lerAba, listarAbas, type LinhaPlanilha, type ValorCelula } from "../../lib/xlsx.js";
import { auditar } from "../auditoriaService.js";
import { localizarCabecalho } from "../importacoes/listas/leituraListas.js";
import { plural } from "../../utils/plural.js";

/**
 * As importações da tela Cadastros da Gestão de Colaboradores (06/11/2026, pedido do Adão): a planilha de Funções (as colunas
 * Função, Descrição, Nível, Competências e Atividades) e a do Lançamento Inicial (Unidade, Tipo, Senioridade, Função e Centro
 * de Custo, um colaborador por linha). Primeiro a prévia, linha a linha; com uma linha inválida (um nível, uma função ou um
 * centro de custo não cadastrado…), a importação é cancelada: nada se grava até a planilha vir certa. Gravar relê o arquivo
 * e confere tudo de novo.
 *
 * Nas funções, a do mesmo nome (sem diferença de maiúsculas e acentos) é atualizada, e as que não estão na planilha ficam
 * como estão. O Lançamento Inicial é substituído por inteiro, na competência escolhida (o quadro do início do mês).
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
    { chave: "nivel", rotulo: "Nível", cabecalhos: ["NÍVEL", "NIVEL", "SENIORIDADE"], obrigatoria: false },
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

/**
 * As linhas da planilha, com o valor de cada coluna: a primeira aba que tem o cabeçalho (até a 10ª linha). Cada coluna
 * aceita os nomes de `cabecalhos` (com ou sem acento); as linhas vazias ficam de fora.
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
      .filter((l) => Object.values(l.valores).some(Boolean));
    return { aba, itens };
  }
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
  const [funcoes, senioridades] = await Promise.all([db.colaboradorFuncao.findMany(), db.colaboradorSenioridade.findMany()]);
  const funcaoPorNome = new Map(funcoes.map((f) => [chaveDoNome(f.nome), f]));
  const senioridadePorNome = new Map(senioridades.map((s) => [chaveDoNome(s.nome), s]));
  const vistas = new Map<string, number>();
  const gravar: Array<{ id: string | null; dados: { nome: string; descricao: string | null; senioridadeId: string | null; competencias: string | null; atividades: string | null } }> = [];
  const linhas: LinhaDaPrevia[] = itens.map(({ linha, valores }) => {
    const invalida = (motivo: string): LinhaDaPrevia => ({ linha, valores, situacao: "INVALIDA", motivo });
    if (!valores.funcao) return invalida("Sem a função.");
    const chave = chaveDoNome(valores.funcao);
    if (vistas.has(chave)) return invalida(`Função repetida na planilha (linha ${vistas.get(chave)}).`);
    vistas.set(chave, linha);
    const senioridade = valores.nivel ? senioridadePorNome.get(chaveDoNome(valores.nivel)) : null;
    if (valores.nivel && !senioridade) return invalida(`O nível ${valores.nivel} não está cadastrado (aba Senioridades).`);
    const dados = {
      nome: valores.funcao,
      descricao: valores.descricao || null,
      senioridadeId: senioridade?.id ?? null,
      competencias: valores.competencias || null,
      atividades: valores.atividades || null,
    };
    const existente = funcaoPorNome.get(chave);
    if (!existente) {
      gravar.push({ id: null, dados });
      return { linha, valores, situacao: "NOVA" };
    }
    const igual =
      existente.descricao === dados.descricao && existente.senioridadeId === dados.senioridadeId && existente.competencias === dados.competencias && existente.atividades === dados.atividades;
    if (igual) return { linha, valores, situacao: "IGUAL" };
    // O nome fica o do cadastro (a mesma função, talvez com outra grafia na planilha).
    gravar.push({ id: existente.id, dados: { ...dados, nome: existente.nome } });
    return { linha, valores, situacao: "ALTERADA" };
  });
  return { linhas, gravar };
}

// ------------------------------------------------------------------------------------------------- lançamento inicial
/** Os campos de uma linha como a do Lançamento Inicial: os textos da planilha. */
export type CamposDoColaborador = { unidade: string; tipo: string; senioridade: string; funcao: string; centro: string };
export type ColaboradorResolvido = { unidadeNegocioId: string; vinculo: "CLT" | "PJ"; senioridadeId: string; funcaoId: string; centroCustoId: string };

/**
 * Os cadastros de uma linha como a do Lançamento Inicial pelos textos da planilha (09/11/2026: também a aba Quadro de
 * Lotação dos cenários analíticos): a unidade pelo nome ou pelo código, o tipo (CLT ou PJ), a senioridade e a função pelo
 * nome (ativas) e o centro de custo pelo código, pelo "código - nome" ou pelo nome (ativo). Devolve os motivos de recusa
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
  const funcaoPorNome = new Map(funcoes.map((f) => [chaveDoNome(f.nome), f]));
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
    const funcao = funcaoPorNome.get(chaveDoNome(valores.funcao));
    if (!valores.funcao) motivos.push("Sem a função.");
    else if (!funcao) motivos.push(`A função ${valores.funcao} não está cadastrada.`);
    else if (!funcao.ativo) motivos.push(`A função ${funcao.nome} está inativa.`);
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
    const competencia = input.tipo === "lancamento-inicial" ? lerCompetencia(input.competencia) : null;
    const { aba, itens } = lerPlanilha(input.conteudo, input.tipo);
    if (itens.length === 0) throw new ImportacaoColaboradoresError(400, `A aba ${aba} não tem nenhuma linha preenchida abaixo do cabeçalho.`);

    const funcoes = input.tipo === "funcoes" ? await previaFuncoes(db, itens) : null;
    const carga = input.tipo === "lancamento-inicial" ? await previaLancamentoInicial(db, itens) : null;
    const linhas = (funcoes ?? carga)!.linhas;
    const resumo = resumoDe(linhas);
    const anterior = carga ? await db.colaboradorCargaInicial.findFirst({ select: { ano: true, mes: true } }) : null;
    const previa: PreviaColaboradores = {
      tipo: input.tipo,
      nomeArquivo: input.nomeArquivo,
      aba,
      colunas: COLUNAS[input.tipo].map(({ chave, rotulo }) => ({ chave, rotulo })),
      linhas,
      resumo,
      ...(competencia ? { competencia: mesAno(competencia.ano, competencia.mes) } : {}),
      ...(carga ? { substitui: anterior ? { competencia: mesAno(anterior.ano, anterior.mes), colaboradores: await db.colaboradorCargaInicial.count() } : null } : {}),
    };
    if (!input.gravar) return previa;

    if (resumo.INVALIDA) {
      throw new ImportacaoColaboradoresError(
        409,
        `A importação foi cancelada: a planilha tem ${resumo.INVALIDA} ${plural(resumo.INVALIDA, "linha inválida", "linhas inválidas")}. Corrija a planilha (ou os cadastros) e escolha o arquivo de novo.`,
      );
    }
    if (funcoes) {
      await db.$transaction(async (tx) => {
        for (const g of funcoes.gravar) {
          if (g.id) await tx.colaboradorFuncao.update({ where: { id: g.id }, data: g.dados });
          else await tx.colaboradorFuncao.create({ data: g.dados });
        }
      });
      await auditar({
        usuarioId: input.usuarioId,
        acao: "IMPORTACAO",
        entidade: "colaborador_funcao",
        metadados: { arquivo: input.nomeArquivo, aba, novas: resumo.NOVA, alteradas: resumo.ALTERADA, iguais: resumo.IGUAL },
      });
    }
    if (carga && competencia) {
      await db.$transaction(async (tx) => {
        await tx.colaboradorCargaInicial.deleteMany({});
        await tx.colaboradorCargaInicial.createMany({ data: carga.gravar.map((g) => ({ ...g, ano: competencia.ano, mes: competencia.mes })) });
      });
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
