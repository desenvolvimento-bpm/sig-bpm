import { getPrismaClient } from "../../../config/prisma.js";
import { acumular, type DadosDoMes } from "../../relatorios/indicadores.js";
import { montarCatalogo, TOTALIZADORES_DAS_LISTAS, type LinhaEstruturaIndicador } from "../../relatorios/catalogoIndicadores.js";
import { dadosDoMes, encadearMeses } from "../../relatorios/indicadoresService.js";
import { orcamentoDoExercicio } from "../../relatorios/orcamento.js";
import { mesesDoExercicio } from "../../relatorios/resultadosService.js";
import { compilarFormula, DEPARTAMENTOS_DO_QUADRO, FormulaInvalidaError, PARTES_DO_DEPARTAMENTO } from "../../relatorios/formulaIndicador.js";
import { contaDaFormula } from "../../relatorios/painelDeBordo.js";
import { RegraCadastroError } from "./definicoesCadastros.js";

/**
 * Os valores da Metodologia nos modais dos cards (Painel de Bordo) e dos indicadores (11/11/2026, pedido do Adão), em
 * Cadastros Gerais / Analítico: ao lado de cada item que se pode inserir, o valor acumulado de janeiro até a
 * competência fechada mais recente, como em Resultados Empresariais; e o Testar, que mostra o Realizado (Atual) do card
 * (ou do indicador) nesse mês, com a fórmula do formulário, antes de gravar.
 *
 * Os valores são os que a fórmula lê: as linhas da DRE pela unidade (como o item [DRE|unidade|linha]), os totalizadores
 * das Listas, os Movimentos do QL e o realizado dos indicadores pela soma (ou pelo modo do Acumulado, nos indicadores); as
 * metas, pelo acumulado do cenário Orçamento Empresarial; o Quadro de Lotação, pela posição do mês (um estoque de
 * colaboradores não se soma).
 */

const MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

/** A base do teste: os meses do exercício da competência fechada mais recente, até ela, com os dados de cada um. */
async function baseDoTeste() {
  const prisma = getPrismaClient();
  const ultima = await prisma.competencia.findFirst({
    where: { status: "FECHADA", apuradaEm: { not: null } },
    orderBy: [{ ano: "desc" }, { mes: "desc" }],
    select: { ano: true, mes: true },
  });
  if (!ultima) return null;
  const { ultimo, meses } = await mesesDoExercicio(ultima.ano, ultima.mes, true);
  const fechados = new Map(meses.filter((m) => m.competenciaId !== null).map((m) => [m.mes, m.competenciaId!]));
  const orcamento = await orcamentoDoExercicio();
  const dados = encadearMeses(await Promise.all(meses.map((m) => (fechados.has(m.mes) ? dadosDoMes(fechados.get(m.mes)!, true, orcamento.porMes[m.mes - 1]) : null))));
  const linhas = await prisma.indicadorEstrutura.findMany({ orderBy: { ordem: "asc" } });
  return { ano: ultima.ano, ultimo, competencia: `${MESES[ultimo - 1]}/${ultima.ano}`, dados, orcamento, linhas };
}

/** A soma de um valor nos meses com dado (null: nenhum mês com valor). */
function somaDosMeses(dados: Array<DadosDoMes | null>, valor: (m: DadosDoMes) => number | null | undefined) {
  let soma = 0;
  let algum = false;
  for (const m of dados) {
    if (!m) continue;
    const v = valor(m);
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    soma += v;
    algum = true;
  }
  return algum ? soma : null;
}

const finito = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : v);

/**
 * Os valores acumulados dos itens da Metodologia, pela chave do item como a fórmula o grava (sem os colchetes):
 * DRE|unidade|linha, LISTA|código, META|nome, INDICADOR|nome, QL|DEP|departamento|atribuição, QL|CC|centro e MQL|tipo.
 * `percentuais`: as chaves dos indicadores (e das metas) em %, que a tela mostra como 0,00%. No Painel de Bordo, só os
 * indicadores (os únicos itens da Metodologia dele).
 */
export async function valoresDosItens(entidade: string) {
  const b = await baseDoTeste();
  if (!b) return { competencia: null, valores: {}, percentuais: [] };
  const valores: Record<string, number | null> = {};
  const percentuais: string[] = [];
  const catalogo = montarCatalogo(b.linhas);
  catalogo.forEach((i, k) => {
    const partes = b.dados.map((d) => (d ? i.calculo(d) : null));
    valores[`INDICADOR|${i.nome}`] = finito(acumular(i, partes));
    if (b.linhas[k].unidade === "%") percentuais.push(`INDICADOR|${i.nome}`, `META|${i.nome}`);
  });
  if (entidade !== "painel-bordo") {
    const prisma = getPrismaClient();
    for (const i of catalogo) valores[`META|${i.nome}`] = b.orcamento.cenario ? finito(b.orcamento.acumulado(i, b.ultimo)) : null;
    const codigos = (await prisma.linhaDRE.findMany({ where: { tipo: { not: "SECAO" }, ativo: true }, select: { codigo: true } })).map((l) => l.codigo);
    for (let u = 0; u <= 5; u++) for (const c of codigos) valores[`DRE|${u}|${c}`] = somaDosMeses(b.dados, (m) => m.dre(u, c));
    for (const t of TOTALIZADORES_DAS_LISTAS) valores[`LISTA|${t.codigo}`] = somaDosMeses(b.dados, (m) => (m.lista ? m.lista(t.codigo) : m.volume(t.codigo)));
    // O Quadro de Lotação: a posição do mês da competência (o estoque de colaboradores não se soma).
    const doMes = b.dados[b.ultimo - 1];
    const centros = await prisma.centroCusto.findMany({ where: { ativo: true, codigoRM: { not: null } }, select: { codigoRM: true } });
    for (const [d] of DEPARTAMENTOS_DO_QUADRO) for (const p of PARTES_DO_DEPARTAMENTO) valores[`QL|DEP|${d}|${p}`] = finito(doMes?.quadro?.(`DEP|${d}|${p}`));
    for (const c of centros) valores[`QL|CC|${c.codigoRM}`] = finito(doMes?.quadro?.(`CC|${c.codigoRM}`));
    const tipos = (await prisma.colaboradorTipoMovimentacao.findMany({ select: { nome: true } })).map((t) => t.nome);
    for (const t of ["#POSITIVA", "#NEGATIVA", ...tipos]) valores[`MQL|${t}`] = somaDosMeses(b.dados, (m) => m.movimentosQL?.(t));
  }
  return { competencia: b.competencia, valores, percentuais };
}

const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** A fórmula do formulário compilada, ou o erro com o nome do campo. */
function exigirFormula(formula: string | null, rotulo: string) {
  if (!formula) throw new RegraCadastroError(400, `Monte ${rotulo} para testar.`);
  try {
    compilarFormula(formula);
  } catch (e) {
    throw new RegraCadastroError(400, `${rotulo}: ${e instanceof FormulaInvalidaError ? e.message : "fórmula inválida."}`);
  }
  return formula;
}

/**
 * O Testar (11/11/2026): o Realizado (Atual) do card ou do indicador na competência fechada mais recente, com os valores
 * do formulário (ainda não gravados). No card, também o Percentual sob o Valor; no indicador, também o Acumulado (pelo
 * modo escolhido). `id`: o indicador editado (a fórmula do formulário entra no lugar da gravada).
 */
export async function testarFormula(entidade: string, v: Record<string, unknown>, id: string | null) {
  const b = await baseDoTeste();
  if (!b) throw new RegraCadastroError(404, "Nenhuma competência fechada em Resultados Empresariais para testar.");
  if (entidade === "painel-bordo") {
    const formula = exigirFormula(texto(v.formula), "a Metodologia");
    const percentual = texto(v.percentual);
    if (percentual) exigirFormula(percentual, "o Percentual sob o Valor");
    const catalogo = montarCatalogo(b.linhas);
    const partes = new Map(catalogo.map((i) => [i.nome, b.dados[b.ultimo - 1] ? i.calculo(b.dados[b.ultimo - 1]!) : null]));
    const doMes = (n: string) => finito(partes.get(n)?.valor);
    return {
      competencia: b.competencia,
      realizado: finito(contaDaFormula(formula)(doMes)),
      percentual: percentual ? finito(contaDaFormula(percentual)(doMes)) : null,
      formato: texto(v.formato),
    };
  }
  if (entidade !== "estrutura-indicadores") throw new RegraCadastroError(400, "Este cadastro não tem o Testar.");
  const modo = texto(v.modo) ?? "SOMA";
  const nome = texto(v.nome) ?? "(Indicador em teste)";
  const formula = modo === "SISTEMA" ? null : exigirFormula(texto(v.formula), "a Metodologia");
  const peso =
    modo === "MEDIA_PONDERADA" ? exigirFormula(texto(v.peso), "o Peso da Média") : modo === "FORMULA" ? exigirFormula(texto(v.formulaAcumulado), "a Fórmula do Acumulado") : null;
  const atual = b.linhas.find((l) => l.id === id);
  const editado: LinhaEstruturaIndicador = {
    grupo: texto(v.grupo) ?? atual?.grupo ?? "",
    numero: texto(v.numero) ?? "",
    nome,
    sentido: texto(v.sentido) ?? "↑",
    unidade: texto(v.unidade) ?? "",
    descricao: null,
    formula,
    modo,
    peso,
  };
  // O formulário no lugar do gravado (ou, no novo, no fim): os outros indicadores que o usam não mudam o teste.
  const linhas = [...b.linhas.filter((l) => l.id !== id && l.nome !== nome), editado];
  const catalogo = montarCatalogo(linhas);
  const indicador = catalogo[catalogo.length - 1];
  const partes = b.dados.map((d) => (d ? indicador.calculo(d) : null));
  return {
    competencia: b.competencia,
    realizado: finito(partes[b.ultimo - 1]?.valor),
    acumulado: finito(acumular(indicador, partes)),
    unidade: editado.unidade,
  };
}
