import { getPrismaClient } from "../../../config/prisma.js";
import { auditar } from "../../auditoriaService.js";
import { classificacaoService } from "../../classificacao/classificacaoService.js";
import { apresentar, DEFINICOES, RegraCadastroError, type DefinicaoCadastro, type Valores } from "./definicoesCadastros.js";

/**
 * Edição dos cadastros pela tela (Passo 25). Toda alteração vai para o log de
 * auditoria com o antes e o depois. Corrigir um cadastro que classifica
 * (centro, conta, reclassificação) reclassifica as competências ainda não
 * apuradas; as apuradas ficam como foram apuradas até serem reapuradas
 * (princípio do congelamento, Passo 21).
 */

const rotulo = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;

/** O valor de um campo para comparar o antes e o depois (as listas sem ordem; vazio e nulo iguais). */
const comparavel = (x: unknown) => (Array.isArray(x) ? x.map(String).sort().join("|") : x === null || x === undefined ? "" : String(x));

/**
 * As travas do registro (11/10/2026): com movimentos, os campos-chave (travaComMovimento) não mudam e a exclusão é
 * recusada. A tela recebe isso junto do registro, para mostrar os campos travados e o motivo.
 */
async function travasDo(d: DefinicaoCadastro, id: string) {
  const db = getPrismaClient();
  const movimentos = d.movimentos ? await d.movimentos(db, id) : null;
  const exclusao = d.excluir && d.impedimentoExclusao ? await d.impedimentoExclusao(db, id) : null;
  return { movimentos, campos: movimentos ? d.campos.filter((c) => c.travaComMovimento).map((c) => c.nome) : [], exclusao };
}

function definicao(entidade: string): DefinicaoCadastro {
  const d = Object.hasOwn(DEFINICOES, entidade) ? DEFINICOES[entidade] : undefined;
  if (!d) throw new RegraCadastroError(404, `Cadastro ${entidade} desconhecido.`);
  return d;
}

/**
 * Os Cadastros da Controladoria (17/10/2026): mudar qualquer um pede reapurar as competências apuradas e abertas
 * (apuracao/assinaturaCadastros.ts); a tela diz quais, depois de gravar.
 */
const DA_CONTROLADORIA = new Set(["unidades", "centros-custo", "contas-resultado", "linhas", "estrutura-dre", "regras-rateio", "estrutura-indicadores", "painel-bordo"]);

/**
 * Depois de mudar um cadastro que classifica: reclassifica as não apuradas e diz quais apuradas precisam ser reapuradas.
 * Num Cadastro da Controladoria que não classifica, só as apuradas a reapurar.
 */
async function aplicarNaClassificacao(d: DefinicaoCadastro) {
  if (!d.reclassifica && !DA_CONTROLADORIA.has(d.entidade)) return { reclassificadas: [], apuradasPorReapurar: [] };
  const prisma = getPrismaClient();
  const abertas = await prisma.competencia.findMany({ where: { status: { not: "FECHADA" } }, select: { id: true, ano: true, mes: true, apuradaEm: true }, orderBy: [{ ano: "asc" }, { mes: "asc" }] });
  const reclassificadas: string[] = [];
  for (const c of d.reclassifica ? abertas.filter((x) => !x.apuradaEm) : []) {
    await classificacaoService.classificarCompetencia(c.id);
    reclassificadas.push(rotulo(c.ano, c.mes));
  }
  return { reclassificadas, apuradasPorReapurar: abertas.filter((x) => x.apuradaEm).map((c) => rotulo(c.ano, c.mes)) };
}

export const edicaoCadastrosService = {
  /** Os campos do cadastro, com as opções já resolvidas, para a tela montar o formulário. */
  async definicao(entidade: string) {
    const d = definicao(entidade);
    const db = getPrismaClient();
    const campos = await Promise.all(d.campos.map(async ({ opcoes, ...c }) => ({ ...c, opcoes: opcoes ? await opcoes(db) : undefined })));
    return { entidade: d.entidade, titulo: d.titulo, criar: d.criar, excluir: d.excluir, reclassifica: !!d.reclassifica, explicacao: d.explicacao ?? null, campos };
  },

  async listar(entidade: string, busca?: string) {
    return (await definicao(entidade).listar(getPrismaClient(), busca)).map((v) => apresentar(v));
  },

  async ler(entidade: string, id: string) {
    const d = definicao(entidade);
    const v = await d.ler(getPrismaClient(), id);
    if (!v) throw new RegraCadastroError(404, "Registro não encontrado.");
    return { ...apresentar(v), __travas: await travasDo(d, id) };
  },

  async criar(entidade: string, valores: Valores, quem: string) {
    const d = definicao(entidade);
    if (!d.criar) throw new RegraCadastroError(409, `${d.titulo}: o cadastro não aceita registros novos.`);
    const db = getPrismaClient();
    const dados = await d.preparar(db, valores, null);
    const id = await d.gravar(db, dados, null);
    const depois = apresentar(await d.ler(db, id));
    await auditar({ usuarioId: quem, acao: "CRIACAO", entidade: d.auditoria, entidadeId: id, depois, metadados: { nome: rotuloDoRegistro(depois) } });
    return { registro: depois, ...(await aplicarNaClassificacao(d)) };
  },

  async atualizar(entidade: string, id: string, valores: Valores, quem: string) {
    const d = definicao(entidade);
    const db = getPrismaClient();
    const antes = apresentar(await d.ler(db, id));
    if (!antes) throw new RegraCadastroError(404, "Registro não encontrado.");
    // Os campos de criação e os derivados não vêm da tela na edição: valem os gravados.
    const fixos = Object.fromEntries(d.campos.filter((c) => c.somenteNaCriacao).map((c) => [c.nome, antes[c.nome]]));
    const dados = await d.preparar(db, { ...antes, ...valores, ...fixos }, id);
    // Com movimentos, os campos-chave ficam como estão.
    const { movimentos, campos } = await travasDo(d, id);
    const mudados = d.campos.filter((c) => campos.includes(c.nome) && c.nome in dados && comparavel(dados[c.nome]) !== comparavel(antes[c.nome]));
    if (mudados.length) {
      throw new RegraCadastroError(
        409,
        `Não é possível mudar ${mudados.map((c) => c.rotulo).join(", ")}: ${movimentos} ${mudados.length > 1 ? "Essas informações ligam" : "Essa informação liga"} o cadastro a outras telas.`,
      );
    }
    await d.gravar(db, dados, id);
    const depois = apresentar(await d.ler(db, id));
    await auditar({ usuarioId: quem, acao: "ALTERACAO", entidade: d.auditoria, entidadeId: id, antes, depois, metadados: { nome: rotuloDoRegistro(depois) } });
    return { registro: depois, ...(await aplicarNaClassificacao(d)) };
  },

  async excluir(entidade: string, id: string, quem: string) {
    const d = definicao(entidade);
    if (!d.excluir || !d.remover) throw new RegraCadastroError(409, `${d.titulo}: o cadastro não aceita exclusão; inative o registro.`);
    const db = getPrismaClient();
    const antes = apresentar(await d.ler(db, id));
    if (!antes) throw new RegraCadastroError(404, "Registro não encontrado.");
    const impedimento = d.impedimentoExclusao ? await d.impedimentoExclusao(db, id) : null;
    if (impedimento) throw new RegraCadastroError(409, impedimento);
    await d.remover(db, id);
    await auditar({ usuarioId: quem, acao: "EXCLUSAO", entidade: d.auditoria, entidadeId: id, antes, metadados: { nome: rotuloDoRegistro(antes) } });
    return aplicarNaClassificacao(d);
  },
};

/** O nome que identifica o registro no log. */
function rotuloDoRegistro(v: Valores | null) {
  if (!v) return null;
  const partes = [v.codigoRM ?? v.reduzido ?? v.codigo ?? v.codigoCentroCusto ?? v.secao, v.nomeRM ?? v.descricao ?? v.nome ?? v.rotulo ?? v.peca ?? v.fornecedor].filter(Boolean);
  return partes.join(" · ") || null;
}
