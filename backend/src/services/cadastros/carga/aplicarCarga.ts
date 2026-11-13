import { getPrismaClient } from "../../../config/prisma.js";
import type { PrismaClient } from "../../../generated/prisma/client.js";
import { BaldeAlocacao, type TipoLinhaDRE } from "../../../generated/prisma/enums.js";
import { abasDaConta, combinacoesDaConta } from "../../dre/apuracaoUnidades.js";
import type { CadastrosPreparados } from "./prepararCadastros.js";
import { plural } from "../../../utils/plural.js";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/**
 * O que a recarga muda no banco, e a gravação em si. A comparação é o que o
 * Contábil vê antes de confirmar; a gravação é idempotente — rodar de novo com
 * a mesma planilha não muda nada.
 */

export type Mudanca = {
  chave: string;
  rotulo: string;
  campos: Array<{ campo: string; antes: string | null; depois: string | null }>;
};

export type Diferencas = {
  novos: Mudanca[];
  alterados: Mudanca[];
  /** Saem do banco na recarga. */
  removidos: Mudanca[];
  /** Estão no banco e não vieram na planilha, mas ficam (contas nunca são apagadas). */
  mantidos: Mudanca[];
  iguais: number;
};

const txt = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/** Compara registro a registro, pelos campos listados com o seu rótulo. */
function comparar<T extends Record<string, unknown>>(
  alvos: Map<string, { rotulo: string; valores: T }>,
  atuais: Map<string, { rotulo: string; valores: T }>,
  campos: Array<[keyof T & string, string]>,
  removerAusentes: boolean,
): Diferencas {
  const d: Diferencas = { novos: [], alterados: [], removidos: [], mantidos: [], iguais: 0 };
  for (const [chave, alvo] of alvos) {
    const atual = atuais.get(chave);
    const lista = campos.map(([campo, rotulo]) => ({
      campo: rotulo,
      antes: atual ? txt(atual.valores[campo]) : null,
      depois: txt(alvo.valores[campo]),
    }));
    if (!atual) {
      d.novos.push({ chave, rotulo: alvo.rotulo, campos: lista.filter((c) => c.depois !== null) });
      continue;
    }
    const mudaram = lista.filter((c) => c.antes !== c.depois);
    if (mudaram.length === 0) d.iguais++;
    else d.alterados.push({ chave, rotulo: alvo.rotulo, campos: mudaram });
  }
  for (const [chave, atual] of atuais) {
    if (alvos.has(chave)) continue;
    const m = { chave, rotulo: atual.rotulo, campos: [] };
    (removerAusentes ? d.removidos : d.mantidos).push(m);
  }
  return d;
}

type LinhaNoBanco = { id: string; codigo: string; tipo: string; grupo: string; ordem: number };

/**
 * Linhas da DRE renomeadas na planilha. O código da linha sai da descrição
 * (prepararCadastros), então mudar a descrição na planilha muda o código. Sem
 * isto, a recarga criaria uma linha nova e tentaria apagar a antiga, que tem
 * valores apurados (e o banco recusa). Uma linha da planilha com código novo
 * é a renomeação de uma linha do banco que saiu da planilha quando as duas
 * estão na mesma posição, com o mesmo tipo e grupo (a atribuição não serve:
 * nas linhas de volume ela é a própria descrição e muda junto). A linha do
 * banco fica com o código novo, e os valores apurados continuam ligados a ela.
 * A prévia da recarga mostra a renomeação como alteração, para o Contábil ver.
 * Devolve código novo → linha do banco.
 */
export function renomeacoesDaDre(p: CadastrosPreparados, noBanco: LinhaNoBanco[]) {
  const naPlanilha = new Set(p.dre.linhas.map((l) => l.codigo));
  const existentes = new Set(noBanco.map((l) => l.codigo));
  const sairiam = noBanco.filter((l) => !naPlanilha.has(l.codigo));
  const renomeacoes = new Map<string, LinhaNoBanco>();
  for (const l of p.dre.linhas) {
    if (existentes.has(l.codigo)) continue;
    const antiga = sairiam.find(
      (b) => b.ordem === l.dados.ordem && b.tipo === l.dados.tipo && b.grupo === l.dados.grupo && ![...renomeacoes.values()].includes(b),
    );
    if (antiga) renomeacoes.set(l.codigo, antiga);
  }
  return renomeacoes;
}

export async function compararComBanco(p: CadastrosPreparados) {
  const prisma = getPrismaClient();
  const [centros, contas, linhas] = await Promise.all([
    prisma.centroCusto.findMany({
      include: { _count: { select: { lancamentosContabeis: true, lancamentosManuais: true, resultadosApurados: true } } },
      orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }],
    }),
    prisma.contaResultado.findMany({ include: { linhaDRE: { select: { codigo: true } } }, orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }] }),
    prisma.linhaDRE.findMany({
      orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }],
      include: {
        unidades: { include: { unidadeNegocio: { select: { nome: true, codigo: true } } } },
        _count: { select: { contas: true, lancamentosContabeis: true, lancamentosManuais: true, resultadosApurados: true } },
      },
    }),
  ]);

  const chaveCentro = (codigoRM: string | null, nomeRM: string) => codigoRM ?? `sem código · ${nomeRM}`;
  const centrosDif = comparar(
    new Map(p.centros.alvos.map((c) => [chaveCentro(c.codigoRM, c.dados.nomeRM), { rotulo: c.dados.nomeRM, valores: c.dados }])),
    new Map(centros.map((c) => [chaveCentro(c.codigoRM, c.nomeRM), { rotulo: c.nomeRM, valores: c }])),
    [["nomeRM", "Nome no RM"], ["nomeControladoria", "Controladoria"], ["departamento", "Departamento"], ["atribuicao", "Atribuição"], ["balde", "Rateio"], ["coligada", "Coligada"]],
    true,
  );
  const emUso = new Set(
    centros.filter((c) => c._count.lancamentosContabeis + c._count.lancamentosManuais + c._count.resultadosApurados > 0).map((c) => chaveCentro(c.codigoRM, c.nomeRM)),
  );
  for (const m of centrosDif.removidos.filter((r) => emUso.has(r.chave))) {
    centrosDif.mantidos.push({ ...m, rotulo: `${m.rotulo} (em uso: fica inativado)` });
  }
  centrosDif.removidos = centrosDif.removidos.filter((r) => !emUso.has(r.chave));

  const contasDif = comparar(
    new Map(p.contas.alvos.map((c) => [c.reduzido, { rotulo: c.dados.descricao, valores: { ...c.dados, linha: p.vinculos.get(c.reduzido) ?? null } }])),
    new Map(contas.map((c) => [c.reduzido, { rotulo: c.descricao, valores: { ...c, linha: c.linhaDRE?.codigo ?? null } }])),
    [["conta", "Conta"], ["descricao", "Descrição"], ["tipoConta", "Tipo"], ["departamento", "Departamento"], ["atribuicao", "Atribuição"], ["balde", "Rateio"], ["linha", "Linha do DRE"]],
    false,
  );

  // A linha renomeada aparece como alterada (a descrição), não como nova e removida.
  const codigoNovo = new Map([...renomeacoesDaDre(p, linhas)].map(([novo, antiga]) => [antiga.codigo, novo]));
  const dreDif = comparar(
    new Map(p.dre.linhas.map((l) => [l.codigo, { rotulo: l.dados.descricao, valores: { ...l.dados, unidades: l.unidades.join(", ") } }])),
    new Map(linhas.map((l) => [codigoNovo.get(l.codigo) ?? l.codigo, {
      rotulo: l.descricao,
      valores: { ...l, unidades: l.unidades.map((u) => u.unidadeNegocio.nome).sort((a, b) => a.localeCompare(b, "pt-BR")).join(", ") },
    }])),
    [["descricao", "Descrição"], ["grupo", "Grupo"], ["atribuicao", "Atribuição"], ["tipo", "Tipo"], ["expressao", "Fórmula"], ["definicao", "Definição"], ["unidades", "Unidades"], ["ordem", "Posição"]],
    true,
  );

  // Linha da DRE que sairia e está em uso: o banco recusa apagá-la (valores
  // apurados, lançamentos e contas apontam para ela). A recarga é bloqueada.
  const emUsoDre = linhasEmUso(dreDif.removidos.map((r) => r.chave), linhas);

  // As contas que nenhuma aba de resultado leria (24/10/2026, a regra do cadastro da conta), na estrutura da DRE da
  // planilha: a recarga é bloqueada pela conta que ficaria assim; a que já estava assim e não muda vira aviso.
  const unidades = await prisma.unidadeNegocio.findMany({ select: { codigo: true, nome: true } });
  const codigoDaUnidade = new Map(unidades.map((u) => [chaveNome(u.nome), u.codigo]));
  const linhasDepois = p.dre.linhas.map((l) => ({
    id: l.codigo,
    ...l.dados,
    unidades: l.unidades.map((n) => codigoDaUnidade.get(chaveNome(n))).filter((u): u is number => u !== undefined),
  }));
  const linhasAntes = linhas
    .filter((l) => l.ativo)
    .map((l) => ({ ...l, id: codigoNovo.get(l.codigo) ?? l.codigo, unidades: l.unidades.map((u) => u.unidadeNegocio.codigo) }));
  const chave = (c: ContaParaAbas) => `${c.reduzido}|${c.linha}|${c.balde}`;
  const jaSemAba = new Set(
    contasSemAba(
      contas.map((c) => ({ reduzido: c.reduzido, descricao: c.descricao, tipoConta: c.tipoConta, balde: c.balde, linha: c.linhaDRE ? (codigoNovo.get(c.linhaDRE.codigo) ?? c.linhaDRE.codigo) : null })),
      linhasAntes,
    ).map(({ conta }) => chave(conta)),
  );
  const semAba = contasSemAba(
    p.contas.alvos.map((c) => ({ reduzido: c.reduzido, descricao: c.dados.descricao, tipoConta: c.dados.tipoConta, balde: c.dados.balde, linha: p.vinculos.get(c.reduzido) ?? null })),
    linhasDepois,
  );
  const bloqueiosContas = semAba
    .filter(({ conta }) => !jaSemAba.has(chave(conta)))
    .map(({ conta, linha, permitidas }) => `A conta ${conta.reduzido} ${conta.descricao} ficaria ${semAbaPorque(linha, conta.balde)} ${permitidas}`);
  const avisosContas = semAba
    .filter(({ conta }) => jaSemAba.has(chave(conta)))
    .map(({ conta, linha, permitidas }) => ({ origem: "contas de resultado", chave: `${conta.reduzido} ${conta.descricao}`, motivo: `já está ${semAbaPorque(linha, conta.balde)} A recarga não muda isso. ${permitidas}` }));
  return { centros: centrosDif, contas: contasDif, dre: dreDif, bloqueios: [...emUsoDre, ...bloqueiosContas], avisosContas };
}

/** A chave do nome da unidade: sem diferença de maiúsculas e acentos. */
const chaveNome = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
/** "A, B ou C". */
const ouLista = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} ou ${xs[xs.length - 1]}` : (xs[0] ?? ""));
const BALDES_DAS_CONTAS = Object.values(BaldeAlocacao).filter((b) => b !== "LEBEN");

type ContaParaAbas = { reduzido: string; descricao: string; tipoConta: string; balde: string | null; linha: string | null };
type LinhaParaAbas = { id: string; tipo: TipoLinhaDRE; grupo: string; grupoSigla: string; atribuicao: string | null; descricao: string; unidades: number[] };

const semAbaPorque = (linha: LinhaParaAbas, balde: string | null) =>
  `na linha “${linha.descricao}” (${linha.grupoSigla}) com o rateio ${balde ?? "vazio"}, que nenhuma aba de resultado lê: os lançamentos de obras, de centros fora do cadastro e sem centro ficariam fora do resultado.`;

/**
 * As contas analíticas de linha de item que nenhuma aba de resultado lê (abasDaConta, a regra da Classificação), com o
 * texto das combinações que alguma aba lê — a linha e as de mesma atribuição e descrição, com os rateios aceitos.
 */
function contasSemAba(contas: ContaParaAbas[], linhas: LinhaParaAbas[]) {
  const porCodigo = new Map(linhas.map((l) => [l.id, l]));
  const comSigla = linhas.filter((l) => /\(/.test(l.grupo));
  return contas.flatMap((conta) => {
    const linha = conta.linha ? porCodigo.get(conta.linha) : undefined;
    if (conta.tipoConta !== "ANALITICA" || !linha || linha.tipo !== "ITEM" || abasDaConta(linha, conta.balde, linhas).some((a) => a.length)) return [];
    const porLinha = new Map<string, string[]>();
    for (const c of combinacoesDaConta(linha, comSigla, BALDES_DAS_CONTAS)) {
      const k = `${c.linha.grupoSigla} › ${c.linha.atribuicao ?? "—"} › ${c.linha.descricao}`;
      porLinha.set(k, [...(porLinha.get(k) ?? []), c.balde]);
    }
    const permitidas = porLinha.size
      ? `Na planilha, use uma das combinações que alguma aba lê: ${[...porLinha].map(([k, bs]) => `${k}, com o rateio ${ouLista(bs)}`).join("; ")}.`
      : "Nenhum rateio faz uma aba ler essa linha: aponte a conta para outra linha na planilha.";
    return [{ conta, linha, permitidas }];
  });
}

type LinhaComUso = { codigo: string; descricao: string; _count: { contas: number; lancamentosContabeis: number; lancamentosManuais: number; resultadosApurados: number } };
function linhasEmUso(codigos: string[], linhas: LinhaComUso[]) {
  return linhas
    .filter((l) => codigos.includes(l.codigo))
    .filter((l) => l._count.contas + l._count.lancamentosContabeis + l._count.lancamentosManuais + l._count.resultadosApurados > 0)
    .map((l) => {
      const lancamentos = l._count.lancamentosContabeis + l._count.lancamentosManuais;
      return `A linha da DRE "${l.descricao}" sairia da estrutura, mas está em uso (${l._count.resultadosApurados} ${plural(l._count.resultadosApurados, "valor apurado", "valores apurados")}, ${lancamentos} ${plural(lancamentos, "lançamento", "lançamentos")}, ${l._count.contas} ${plural(l._count.contas, "conta", "contas")}). Mantenha-a na planilha, ou renomeie-a na mesma posição.`;
    });
}

/** Grava a planilha preparada. Tudo numa transação: ou entra inteira, ou nada. */
export async function gravarCadastros(tx: Tx, p: CadastrosPreparados) {
  // Centros sem código no RM: a chave é o nome (como na prévia). Antes eram
  // apagados e recriados a cada carga, com id novo.
  const semCodigo = await tx.centroCusto.findMany({ where: { codigoRM: null }, select: { id: true, nomeRM: true }, orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }] });
  const codigos: string[] = [];
  const mantidosSemCodigo: string[] = [];
  for (const c of p.centros.alvos) {
    if (c.codigoRM) {
      await tx.centroCusto.upsert({ where: { codigoRM: c.codigoRM }, create: { codigoRM: c.codigoRM, ...c.dados }, update: c.dados });
      codigos.push(c.codigoRM);
    } else {
      const existente = semCodigo.find((x) => x.nomeRM === c.dados.nomeRM && !mantidosSemCodigo.includes(x.id));
      const id = existente
        ? (await tx.centroCusto.update({ where: { id: existente.id }, data: c.dados })).id
        : (await tx.centroCusto.create({ data: { codigoRM: null, ...c.dados } })).id;
      mantidosSemCodigo.push(id);
    }
  }
  // O que não veio desta vez sai — senão um registro descartado por ajuste
  // sobreviveria. Mas o centro em uso (lançamentos ou valores apurados) fica,
  // inativado: apagá-lo tiraria o centro dos lançamentos e dos valores de meses
  // já apurados.
  const sairiam = await tx.centroCusto.findMany({
    where: { OR: [{ codigoRM: { notIn: codigos, not: null } }, { codigoRM: null, id: { notIn: mantidosSemCodigo } }] },
    select: { id: true, _count: { select: { lancamentosContabeis: true, lancamentosManuais: true, resultadosApurados: true } } },
  });
  const emUso = sairiam.filter((c) => c._count.lancamentosContabeis + c._count.lancamentosManuais + c._count.resultadosApurados > 0).map((c) => c.id);
  await tx.centroCusto.updateMany({ where: { id: { in: emUso } }, data: { ativo: false } });
  const { count: centrosRemovidos } = await tx.centroCusto.deleteMany({ where: { id: { in: sairiam.map((c) => c.id).filter((id) => !emUso.includes(id)) } } });

  for (const c of p.contas.alvos) {
    await tx.contaResultado.upsert({ where: { reduzido: c.reduzido }, create: { reduzido: c.reduzido, ...c.dados }, update: c.dados });
  }

  // A unidade de cada linha pelo nome (o Tipo saiu do cadastro em 09/10/2026), sem diferença de maiúsculas e acentos.
  const unidades = await tx.unidadeNegocio.findMany({ select: { id: true, nome: true } });
  const unidadePorNome = new Map(unidades.map((u) => [chaveNome(u.nome), u.id]));
  const idPorCodigo = new Map<string, string>();
  const noBanco = await tx.linhaDRE.findMany({ select: { id: true, codigo: true, tipo: true, grupo: true, ordem: true }, orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }] });
  for (const [novo, antiga] of renomeacoesDaDre(p, noBanco)) {
    await tx.linhaDRE.update({ where: { id: antiga.id }, data: { codigo: novo } });
  }
  for (const l of p.dre.linhas) {
    const linha = await tx.linhaDRE.upsert({ where: { codigo: l.codigo }, create: { codigo: l.codigo, ...l.dados }, update: l.dados });
    idPorCodigo.set(l.codigo, linha.id);
    await tx.linhaDREUnidade.deleteMany({ where: { linhaDREId: linha.id } });
    for (const nome of l.unidades) {
      const unidadeNegocioId = unidadePorNome.get(chaveNome(nome));
      if (unidadeNegocioId) await tx.linhaDREUnidade.create({ data: { linhaDREId: linha.id, unidadeNegocioId } });
    }
  }
  const { count: linhasRemovidas } = await tx.linhaDRE.deleteMany({ where: { codigo: { notIn: [...idPorCodigo.keys()] } } });

  let vinculadas = 0;
  for (const [reduzido, codigo] of p.vinculos) {
    const linhaDREId = codigo ? (idPorCodigo.get(codigo) ?? null) : null;
    if (linhaDREId) vinculadas++;
    // A linha da planilha vale sobre o Sem Resultado (13/11/2026); sem linha, a conta Sem Resultado continua assim.
    await tx.contaResultado.update({ where: { reduzido }, data: linhaDREId ? { linhaDREId, semResultado: false } : { linhaDREId } });
  }

  return {
    centros: p.centros.alvos.length,
    centrosRemovidos,
    contas: p.contas.alvos.length,
    linhasDRE: p.dre.linhas.length,
    linhasRemovidas,
    contasVinculadas: vinculadas,
  };
}
