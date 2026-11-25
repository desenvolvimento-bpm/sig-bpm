import { getPrismaClient } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { gruposDaDRE } from "../cadastros/edicao/definicoesCadastros.js";
import { chaveDoFornecedor, filialDoDepartamento, movimentoNoDepartamento, partesDoValor, type DepartamentoDaRedistribuicao } from "../classificacao/regrasClassificacao.js";
import { plural } from "../../utils/plural.js";
import { contaEmComum, contasDaRegra, mesDe, nomeDasContas, RegraRedistribuicaoError, rotuloDaVigencia, textoDoMes, validarContasDosDestinos } from "../redistribuicoes/redistribuicoesService.js";

/**
 * Os Departamentos e as Redistribuições de Gastos de cada cenário analítico (20/11/2026, pedido do Adão: Cadastros por cenário,
 * etapa 2): as cópias dos cadastros de mesmo nome, nas abas Departamentos e Redistribuições de Gastos das Configurações. A carga
 * do realizado da referência do cenário redistribui os gastos pelas regras da cópia, no lugar das dos Cadastros Gerais
 * (`redistribuirMovimentos`, em referenciaDoRealizado): as partes que a classificação gravou saem dos centros dos destinos, o
 * movimento volta ao centro dele, e as regras do cenário o dividem entre os centros da cópia dele, cada parte na conta do destino
 * (23/11/2026). Os meses do cenário (digitados) não mudam. Aqui: a regra das cópias, a divisão dos movimentos e a validação do que
 * vem das abas.
 */

type Tx = Prisma.TransactionClient;

/** Uma redistribuição do cenário pronta para a divisão: a regra e os centros da cópia dos destinos. */
export type RegraDoCenario = {
  id: string;
  /** As contas da DRE da regra (uma ou mais). */
  linhasDRE: Set<string>;
  departamento: DepartamentoDaRedistribuicao | null;
  fornecedores: Set<string>;
  inicio: Date;
  fim: Date | null;
  /** O centro da cópia, o percentual e a Conta da DRE de cada destino (23/11/2026; nula: a conta do movimento). */
  destinos: Array<{ centro: { id: string; codigoRM: string | null; nomeRM: string }; percentual: number; linha: { codigo: string; tipo: string } | null }>;
};

/** As redistribuições ativas do cenário, na ordem (a primeira que casa vale, como na classificação). */
export async function regrasDoCenario(cenarioId: string, db: Pick<Tx, "cenarioRedistribuicao"> = getPrismaClient()): Promise<RegraDoCenario[]> {
  const rs = await db.cenarioRedistribuicao.findMany({
    where: { cenarioId, ativo: true },
    orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }],
    select: {
      id: true,
      contas: { select: { linhaDREId: true } },
      fornecedores: true,
      vigenciaInicio: true,
      vigenciaFim: true,
      departamento: { select: { gruposDRE: true, unidadeNegocio: { select: { codigo: true } } } },
      destinos: { orderBy: { ordem: "asc" }, select: { percentual: true, centroCusto: { select: { id: true, codigoRM: true, nomeRM: true } }, linhaDRE: { select: { codigo: true, tipo: true } } } },
    },
  });
  return rs.map((r) => ({
    id: r.id,
    linhasDRE: new Set(r.contas.map((c) => c.linhaDREId)),
    departamento: r.departamento ? { grupos: new Set(r.departamento.gruposDRE), filial: filialDoDepartamento(r.departamento.unidadeNegocio.codigo) } : null,
    fornecedores: new Set(r.fornecedores.map(chaveDoFornecedor)),
    inicio: r.vigenciaInicio,
    fim: r.vigenciaFim,
    destinos: r.destinos.map((d) => ({ centro: d.centroCusto, percentual: Number(d.percentual), linha: d.linhaDRE })),
  }));
}

/** O movimento que as regras do cenário dividem: a conta da DRE, o grupo dela, a filial, o fornecedor, o valor e o mês. */
export type MovimentoDaRedistribuicao = { linhaDREId: string | null; grupoSigla: string | null; filial: number; cliForn: string | null; valorMovimento: number | Prisma.Decimal };

/**
 * Divide os movimentos pelas redistribuições do cenário (puro): o movimento de uma das contas, de um fornecedor marcado e do departamento
 * da regra (ou de todos), num mês da vigência, vai para os centros dos destinos pelos percentuais (as partes somam o valor dele,
 * em centavos, como na classificação), cada parte na conta do destino (`linha`; nula: a do movimento). `mes`: o dia 1º do mês do
 * movimento (UTC).
 */
export function redistribuirMovimentos<M extends MovimentoDaRedistribuicao>(movimentos: M[], regras: RegraDoCenario[], mes: (m: M) => Date) {
  type Destino = RegraDoCenario["destinos"][number];
  const mantidos: M[] = [];
  const redistribuidos: Array<{ movimento: M; regra: RegraDoCenario; partes: Array<{ centro: Destino["centro"]; linha: Destino["linha"]; valor: number }> }> = [];
  for (const m of movimentos) {
    const regra = regraDoMovimento(m, regras, mes(m));
    if (!regra) {
      mantidos.push(m);
      continue;
    }
    const valores = partesDoValor(Number(m.valorMovimento), regra.destinos.map((d) => d.percentual));
    redistribuidos.push({ movimento: m, regra, partes: regra.destinos.map((d, i) => ({ centro: d.centro, linha: d.linha, valor: valores[i] })) });
  }
  return { mantidos, redistribuidos };
}

function regraDoMovimento(m: MovimentoDaRedistribuicao, regras: RegraDoCenario[], mes: Date) {
  const linha = m.linhaDREId;
  if (!linha || !m.cliForn) return null;
  const fornecedor = chaveDoFornecedor(m.cliForn);
  return (
    regras.find(
      (r) =>
        r.destinos.length > 0 &&
        r.linhasDRE.has(linha) &&
        r.inicio <= mes &&
        (!r.fim || mes <= r.fim) &&
        r.fornecedores.has(fornecedor) &&
        (!r.departamento || movimentoNoDepartamento(r.departamento, m.grupoSigla, m.filial)),
    ) ?? null
  );
}

// ------------------------------------------------------------------------------------------------------------------ as abas

/** O que vem do modal da redistribuição do cenário (como no cadastro; os centros são os da cópia do cenário). */
export type DadosDaRedistribuicaoDoCenario = {
  departamentoId: string | null;
  linhasDREIds: string[];
  fornecedores: string[];
  /** O centro da cópia, a Conta da DRE dele (23/11/2026) e o percentual de 0 a 100. */
  destinos: Array<{ centroCustoId: string; linhaDREId: string; percentual: number }>;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  descricao: string | null;
  ativo: boolean;
};

const DEPARTAMENTO_SEL = { id: true, nome: true, gruposDRE: true, ativo: true, unidadeNegocio: { select: { codigo: true, nome: true } } } as const;

/** Valida e normaliza a redistribuição do cenário (as regras do cadastro, com o departamento e os centros da cópia). */
export async function prepararRedistribuicao(tx: Tx, cenarioId: string, d: DadosDaRedistribuicaoDoCenario, id: string | null) {
  let departamento: Prisma.CenarioDepartamentoGetPayload<{ select: typeof DEPARTAMENTO_SEL }> | null = null;
  if (d.departamentoId) {
    departamento = await tx.cenarioDepartamento.findFirst({ where: { id: d.departamentoId, cenarioId }, select: DEPARTAMENTO_SEL });
    if (!departamento) throw new RegraRedistribuicaoError(400, "O departamento não é do cenário.");
    if (!departamento.ativo) throw new RegraRedistribuicaoError(400, `O departamento ${departamento.nome} está inativo no cenário.`);
  }
  const linhas = await contasDaRegra(d.linhasDREIds, departamento);
  const idsDasContas = linhas.map((l) => l.id);
  const porChave = new Map<string, string>();
  for (const f of d.fornecedores) {
    const nome = f.trim();
    if (nome && !porChave.has(chaveDoFornecedor(nome))) porChave.set(chaveDoFornecedor(nome), nome);
  }
  if (!porChave.size) throw new RegraRedistribuicaoError(400, "Marque ao menos um fornecedor.");
  if (!d.destinos.length) throw new RegraRedistribuicaoError(400, "Inclua ao menos um centro de custo em Redistribuir Para.");
  const ids = d.destinos.map((x) => x.centroCustoId);
  if (new Set(ids).size !== ids.length) throw new RegraRedistribuicaoError(400, "Um centro de custo aparece mais de uma vez em Redistribuir Para.");
  const centros = await tx.cenarioCentroCusto.findMany({ where: { cenarioId, id: { in: ids } }, select: { id: true, ativo: true, codigoRM: true, nomeRM: true, departamento: true, atribuicao: true } });
  if (centros.length !== ids.length) throw new RegraRedistribuicaoError(400, "Um centro de Redistribuir Para não é dos Centros de Custo do cenário.");
  const inativo = centros.find((c) => !c.ativo);
  if (inativo) throw new RegraRedistribuicaoError(400, `O centro ${inativo.codigoRM ?? ""} ${inativo.nomeRM} está inativo no cenário.`.replace(/\s+/g, " "));
  // A conta de cada centro (23/11/2026): uma Conta da DRE do departamento e da atribuição dele na cópia do cenário.
  await validarContasDosDestinos(d.destinos, new Map(centros.map((c) => [c.id, c])));
  if (d.destinos.some((x) => !Number.isFinite(x.percentual) || x.percentual <= 0 || x.percentual > 100)) throw new RegraRedistribuicaoError(400, "Cada percentual precisa ser maior que 0% e no máximo 100%.");
  const soma = d.destinos.reduce((s, x) => s + x.percentual, 0);
  if (Math.abs(soma - 100) > 0.005) throw new RegraRedistribuicaoError(400, `Os percentuais somam ${soma.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%: precisam somar 100%.`);
  const inicio = mesDe(d.vigenciaInicio, "O início da vigência");
  const fim = d.vigenciaFim ? mesDe(d.vigenciaFim, "O fim da vigência") : null;
  if (fim && fim < inicio) throw new RegraRedistribuicaoError(400, "O fim da vigência é anterior ao início.");
  // Sem sobreposição no cenário: numa conta em comum, com um fornecedor em comum, em departamentos que se cruzam e na mesma época.
  if (d.ativo) {
    const outras = await tx.cenarioRedistribuicao.findMany({
      where: { cenarioId, ativo: true, contas: { some: { linhaDREId: { in: idsDasContas } } }, ...(id ? { id: { not: id } } : {}) },
      select: { departamentoId: true, fornecedores: true, vigenciaInicio: true, vigenciaFim: true, departamento: { select: { nome: true } }, contas: { select: { linhaDREId: true } } },
    });
    const SEM_FIM = new Date(Date.UTC(9999, 0, 1));
    const conflito = outras.find(
      (o) =>
        (!o.departamentoId || !d.departamentoId || o.departamentoId === d.departamentoId) &&
        o.vigenciaInicio <= (fim ?? SEM_FIM) &&
        inicio <= (o.vigenciaFim ?? SEM_FIM) &&
        o.fornecedores.some((f) => porChave.has(chaveDoFornecedor(f))),
    );
    if (conflito) {
      const comuns = conflito.fornecedores.filter((f) => porChave.has(chaveDoFornecedor(f)));
      throw new RegraRedistribuicaoError(
        409,
        `Já há uma redistribuição ativa ${contaEmComum(linhas, conflito.contas)} no cenário (${conflito.departamento?.nome ?? "Todos os departamentos"}, vigência ${rotuloDaVigencia(conflito.vigenciaInicio, conflito.vigenciaFim)}) com ${plural(comuns.length, "o fornecedor", "os fornecedores")} ${comuns.slice(0, 3).join(", ")}${comuns.length > 3 ? "…" : ""} no mesmo período. Encerre a vigência de uma delas ou tire o fornecedor.`,
      );
    }
  }
  return {
    departamentoId: departamento?.id ?? null,
    linhasDREIds: idsDasContas,
    nomeDasContas: nomeDasContas(linhas),
    fornecedores: [...porChave.values()].sort((a, b) => a.localeCompare(b, "pt-BR")),
    destinos: d.destinos.map((x, i) => ({ centroCustoId: x.centroCustoId, linhaDREId: x.linhaDREId, percentual: new Prisma.Decimal(x.percentual).div(100), ordem: i + 1 })),
    vigenciaInicio: inicio,
    vigenciaFim: fim,
    descricao: d.descricao?.trim() || null,
    ativo: d.ativo,
  };
}

/** Os campos de uma redistribuição para a auditoria. */
export const redistribuicaoParaAuditoria = (r: {
  departamentoId: string | null;
  contas: Array<{ linhaDREId: string }>;
  fornecedores: string[];
  vigenciaInicio: Date;
  vigenciaFim: Date | null;
  descricao: string | null;
  ativo: boolean;
  destinos: Array<{ centroCustoId: string; linhaDREId: string | null; percentual: Prisma.Decimal | number }>;
}) => ({
  departamentoId: r.departamentoId,
  linhasDREIds: r.contas.map((c) => c.linhaDREId),
  fornecedores: r.fornecedores,
  destinos: r.destinos.map((d) => ({ centroCustoId: d.centroCustoId, linhaDREId: d.linhaDREId, percentual: Number(d.percentual) })),
  vigenciaInicio: textoDoMes(r.vigenciaInicio),
  vigenciaFim: textoDoMes(r.vigenciaFim),
  descricao: r.descricao,
  ativo: r.ativo,
});

/** Valida e normaliza um departamento do cenário (as regras do cadastro, entre os departamentos ativos do cenário). */
export async function prepararDepartamento(tx: Tx, cenarioId: string, v: { unidadeNegocioId: string; nome: string; gruposDRE: string[]; ordem: number | null; ativo: boolean }, id: string | null) {
  const nome = v.nome.trim();
  if (!nome) throw new RegraRedistribuicaoError(400, "Dê o nome do departamento.");
  const unidade = await tx.cenarioUnidade.findFirst({ where: { cenarioId, unidadeNegocioId: v.unidadeNegocioId }, select: { nome: true } });
  if (!unidade) throw new RegraRedistribuicaoError(400, "A unidade não é uma das unidades do cenário.");
  const outro = await tx.cenarioDepartamento.findFirst({ where: { cenarioId, unidadeNegocioId: v.unidadeNegocioId, nome: { equals: nome, mode: "insensitive" }, ...(id ? { id: { not: id } } : {}) }, select: { id: true } });
  if (outro) throw new RegraRedistribuicaoError(409, `Já existe o departamento ${nome} na unidade ${unidade.nome} do cenário.`);
  const gruposDRE = [...new Set(v.gruposDRE.map(String))];
  const grupos = await gruposDaDRE(getPrismaClient());
  for (const s of gruposDRE) {
    const g = grupos.get(s);
    if (!g) throw new RegraRedistribuicaoError(400, `O grupo ${s} não está na Estrutura da DRE.`);
    if (!g.unidades.has(v.unidadeNegocioId)) throw new RegraRedistribuicaoError(400, `O grupo ${g.nome} não tem linhas na unidade ${unidade.nome}.`);
  }
  if (v.ativo && gruposDRE.length) {
    const outros = await tx.cenarioDepartamento.findMany({ where: { cenarioId, unidadeNegocioId: v.unidadeNegocioId, ativo: true, ...(id ? { id: { not: id } } : {}) }, select: { nome: true, gruposDRE: true } });
    for (const o of outros) {
      const repetido = gruposDRE.find((s) => o.gruposDRE.includes(s));
      if (repetido) throw new RegraRedistribuicaoError(409, `O grupo ${grupos.get(repetido)!.nome} já é do departamento ${o.nome} da unidade ${unidade.nome} no cenário.`);
    }
  }
  const ordemDaDRE = [...grupos.keys()];
  gruposDRE.sort((a, b) => ordemDaDRE.indexOf(a) - ordemDaDRE.indexOf(b));
  return { unidadeNegocioId: v.unidadeNegocioId, nome, gruposDRE, ordem: v.ordem, ativo: v.ativo };
}

/** As opções dos grupos da DRE do formulário do departamento: a sigla, o nome e as unidades em que têm linhas. */
export async function gruposDaDREParaDepartamentos() {
  return [...(await gruposDaDRE(getPrismaClient())).values()].map((g) => ({ sigla: g.sigla, nome: g.nome, unidades: [...g.unidades] }));
}
