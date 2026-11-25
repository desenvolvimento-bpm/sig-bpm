import { createHash } from "node:crypto";

import { getPrismaClient } from "../../config/prisma.js";
import { comNomesNasFormulas, indicadoresParaReferencias, mapasDosIndicadores } from "../relatorios/referenciasDosIndicadores.js";

/**
 * A assinatura dos Cadastros Gerais (17/10/2026; antes, só a do Painel de Bordo): uma por cadastro, guardada
 * na apuração da competência (Competencia.cadastrosAssinatura). Se algum cadastro muda com a competência apurada e
 * ainda aberta, a situação pede reapurar e o fechamento fica bloqueado até lá. As datas de criação e de alteração ficam
 * de fora: gravar sem mudar nada não pede reapurar.
 */

const sem = { criadoEm: true, atualizadoEm: true } as const;
/**
 * O Nome das unidades e das linhas também fica de fora (25/11/2026, pedido do Adão: os nomes dos cadastros mudam a qualquer
 * momento): as regras da apuração usam o código delas, e trocar o nome não pede reapurar.
 */
const semNome = { ...sem, nome: true } as const;
const hash = (dados: unknown) => createHash("sha1").update(JSON.stringify(dados)).digest("hex");
/**
 * A assinatura de antes de 25/11/2026 (com o Nome), na chave do cadastro com este sufixo: a das apurações gravadas antes
 * continua valendo enquanto o nome não muda (`cadastrosMudados`). Não se grava (`assinaturaParaGravar`).
 */
const COM_O_NOME = ":comONome";

/**
 * Os cadastros, na ordem das telas (Contábil, Controladoria e Analítico), com o nome da aba. `comONome`: os dados como
 * eram assinados antes de 25/11/2026.
 */
const CADASTROS: Array<{ chave: string; nome: string; dados: () => Promise<unknown>; comONome?: () => Promise<unknown> }> = [
  {
    chave: "unidades",
    nome: "Unidades",
    dados: () => getPrismaClient().unidadeNegocio.findMany({ omit: semNome, orderBy: { id: "asc" } }),
    comONome: () => getPrismaClient().unidadeNegocio.findMany({ omit: sem, orderBy: { id: "asc" } }),
  },
  { chave: "centros", nome: "Centros de Custo", dados: () => getPrismaClient().centroCusto.findMany({ omit: sem, orderBy: { id: "asc" } }) },
  { chave: "contas", nome: "Contas de Resultado", dados: () => getPrismaClient().contaResultado.findMany({ omit: sem, orderBy: { id: "asc" } }) },
  {
    chave: "linhas",
    nome: "Linhas",
    // As correspondências das tarefas são gravadas de novo a cada vez (ids novos): entram pelo conteúdo.
    dados: async () => [await getPrismaClient().linha.findMany({ omit: semNome, orderBy: { id: "asc" } }), await correspondencias()],
    comONome: async () => [await getPrismaClient().linha.findMany({ omit: sem, orderBy: { id: "asc" } }), await correspondencias()],
  },
  {
    chave: "estruturaDre",
    nome: "Estrutura da DRE",
    // Sem a Descrição e o "O que a linha significa" (25/11/2026: as regras acham a linha pelo código): trocar o nome de uma
    // conta não pede reapurar.
    dados: async () => [
      await getPrismaClient().linhaDRE.findMany({ omit: { ...sem, descricao: true, definicao: true }, orderBy: { id: "asc" } }),
      await unidadesDasLinhas(),
    ],
    comONome: async () => [await getPrismaClient().linhaDRE.findMany({ omit: sem, orderBy: { id: "asc" } }), await unidadesDasLinhas()],
  },
  {
    chave: "regras",
    nome: "Regras de Rateio",
    // Com os percentuais por linha dos rateios fixos (26/10/2026); sem nenhum, a assinatura é a de antes (as apurações
    // gravadas não pedem reapurar só por eles existirem).
    dados: async () => {
      const regras = await getPrismaClient().regraRateio.findMany({ omit: sem, orderBy: { id: "asc" } });
      const linhas = await getPrismaClient().regraRateioLinha.findMany({ orderBy: [{ regraRateioId: "asc" }, { linhaId: "asc" }] });
      return linhas.length ? [regras, linhas] : regras;
    },
  },
  // A Alocação nas Linhas (26/10/2026): as regras da etapa Linhas da apuração. As apurações de antes não a têm: não pedem reapurar.
  { chave: "alocacaoLinhas", nome: "Alocação nas Linhas", dados: () => getPrismaClient().alocacaoLinha.findMany({ omit: sem, orderBy: { id: "asc" } }) },
  // Os indicadores e os cards (25/11/2026: as fórmulas pelo ID dos indicadores): sem o nome e a descrição dos indicadores e
  // sem o nome, a abreviação e o quadro dos cards — trocar o nome não pede reapurar. A assinatura de antes tinha os nomes,
  // também nas fórmulas.
  {
    chave: "indicadores",
    nome: "Indicadores",
    dados: () => getPrismaClient().indicadorEstrutura.findMany({ omit: { ...sem, nome: true, descricao: true }, orderBy: { id: "asc" } }),
    comONome: async () => {
      const linhas = await getPrismaClient().indicadorEstrutura.findMany({ omit: sem, orderBy: { id: "asc" } });
      const { nomePorId } = mapasDosIndicadores(linhas);
      return linhas.map((l) => comNomesNasFormulas(l, nomePorId));
    },
  },
  {
    chave: "painel",
    nome: "Painel de Bordo",
    dados: () => getPrismaClient().painelItem.findMany({ omit: { ...sem, nome: true, sigla: true, quadro: true }, orderBy: { id: "asc" } }),
    comONome: async () => {
      const { nomePorId } = await indicadoresParaReferencias(getPrismaClient());
      return (await getPrismaClient().painelItem.findMany({ omit: sem, orderBy: { id: "asc" } })).map((c) => comNomesNasFormulas(c, nomePorId));
    },
  },
];

/** As unidades de cada linha da DRE na assinatura da Estrutura da DRE. */
const unidadesDasLinhas = () => getPrismaClient().linhaDREUnidade.findMany({ orderBy: [{ linhaDREId: "asc" }, { unidadeNegocioId: "asc" }] });

/** As correspondências das tarefas na assinatura das Linhas. */
const correspondencias = () =>
  getPrismaClient().correspondenciaTarefa.findMany({
    select: { filial: true, tarefa: true, linhaId: true },
    // A filial vazia (qualquer filial) primeiro, como no SQLite: a assinatura gravada nas apurações bate (23/10/2026).
    orderBy: [{ filial: { sort: "asc", nulls: "first" } }, { tarefa: "asc" }],
  });

export type AssinaturaCadastros = Record<string, string>;

// A lista de competências confere várias de uma vez: a assinatura vale por um instante.
let guardada: { em: number; valor: Promise<AssinaturaCadastros> } | null = null;

/** A assinatura atual de cada cadastro (`fresca`: sem usar a guardada, como na apuração). */
export function assinaturaDosCadastros(fresca = false): Promise<AssinaturaCadastros> {
  if (!fresca && guardada && Date.now() - guardada.em < 2000) return guardada.valor;
  const valor = Promise.all(
    CADASTROS.flatMap((c) => [
      (async () => [c.chave, hash(await c.dados())] as const)(),
      ...(c.comONome ? [(async () => [c.chave + COM_O_NOME, hash(await c.comONome!())] as const)()] : []),
    ]),
  ).then((r) => Object.fromEntries(r));
  guardada = { em: Date.now(), valor };
  valor.catch(() => (guardada = null));
  return valor;
}

/**
 * Os cadastros (pelo nome da aba) que mudaram desde a apuração. Sem a assinatura (apurada antes de 17/10/2026), nada:
 * não há com o que comparar.
 */
export function cadastrosMudados(naApuracao: string | null, atual: AssinaturaCadastros): string[] {
  if (!naApuracao) return [];
  let antes: AssinaturaCadastros;
  try {
    antes = JSON.parse(naApuracao) as AssinaturaCadastros;
  } catch {
    return [];
  }
  if (!antes || typeof antes !== "object") return [];
  // A assinatura gravada antes de 25/11/2026 tem o Nome: vale também a atual com ele.
  return CADASTROS.filter((c) => antes[c.chave] !== undefined && antes[c.chave] !== atual[c.chave] && antes[c.chave] !== atual[c.chave + COM_O_NOME]).map((c) => c.nome);
}

/** A assinatura que a apuração grava: sem as de antes de 25/11/2026. */
export function assinaturaParaGravar(a: AssinaturaCadastros): string {
  return JSON.stringify(Object.fromEntries(Object.entries(a).filter(([k]) => !k.endsWith(COM_O_NOME))));
}

/** A frase da situação da competência com os cadastros que mudaram. */
export function fraseDosCadastros(nomes: string[]): string {
  const lista = nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
  return `${nomes.length === 1 ? "O cadastro" : "Os cadastros"} ${lista} (Cadastros Gerais) ${nomes.length === 1 ? "mudou" : "mudaram"} depois da apuração.`;
}
