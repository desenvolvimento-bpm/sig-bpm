import { createHash } from "node:crypto";

import { getPrismaClient } from "../../config/prisma.js";
import { ArquivoInvalidoError, lerAba, listarAbas } from "../../lib/xlsx.js";
import { auditar } from "../auditoriaService.js";
import { dreService } from "../dre/dreService.js";
import { ehAConta } from "../dre/descricaoDeOrigem.js";

/**
 * Relatório de conferência contra a planilha (Passo 27, RF013). Durante o
 * paralelo, o Contábil envia o SIG BPM 2026 - BASE REALIZADO (RESULTADOS), e
 * a ferramenta compara, linha a linha e por unidade, a DRE apurada com as abas
 * Resultados (Consolidado), (Matriz), (Filial), (Serviços), (Desp.+Extra) e
 * (RN), na coluna do mês.
 *
 * Cada linha da aba é ligada à da estrutura da DRE pela descrição, na ordem: a
 * próxima linha da estrutura com a mesma descrição (cada aba é um trecho da
 * estrutura do Consolidado). Uma linha que repete a descrição de outra já
 * ligada na aba é ligada à mesma. O que não se liga aparece à parte, dos dois
 * lados: só na planilha e só na ferramenta.
 */

export class ConferenciaError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

/** As abas da planilha por unidade (0 = consolidado). */
export const ABAS: Array<{ unidade: number; aba: string }> = [
  { unidade: 0, aba: "Resultados (Consolidado)" },
  { unidade: 1, aba: "Resultados (Matriz)" },
  { unidade: 2, aba: "Resultados (Filial)" },
  { unidade: 3, aba: "Resultados (Serviços)" },
  { unidade: 4, aba: "Resultados (Desp.+Extra)" },
  { unidade: 5, aba: "Resultados (RN)" },
];
/** Limite padrão de arredondamento: diferenças até ele não são destacadas. */
export const LIMITE_PADRAO = 0.05;

const MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const ROL = "RECEITA OPERACIONAL LÍQUIDA (ROL)";
const n = (s: unknown) => String(s ?? "").trim().toUpperCase();
const rotulo = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;
const mesmaAba = (a: string, b: string) => a.normalize("NFC") === b.normalize("NFC");

/**
 * Totais que só as abas da planilha mostram, para somar os gastos da unidade,
 * e que a DRE da ferramenta não tem nem precisa ter (decisão do usuário de
 * 01/10/2026). Não entram na comparação nem contam como linha sem par.
 */
const TOTAIS_SO_DA_PLANILHA: Record<string, string[]> = {
  "Resultados (Desp.+Extra)": ["DESPESAS + EXTRA OPERACIONAL (DEO)"],
  "Resultados (RN)": ["EXTRA OPERACIONAL (EO)"],
};
const soDaPlanilha = (aba: string, descricao: string) => (TOTAIS_SO_DA_PLANILHA[aba] ?? []).some((d) => n(d) === n(descricao));

/** Uma linha da aba, como fica guardada. */
type ValorPlanilha = { unidade: number; aba: string; linha: number; descricao: string; codigo: string | null; repeteLinha?: number; valor: number | null };

async function competenciaPorAnoMes(ano: number, mes: number) {
  const c = await getPrismaClient().competencia.findUnique({ where: { ano_mes: { ano, mes } } });
  if (!c) throw new ConferenciaError(404, `A competência ${rotulo(ano, mes)} não existe.`);
  return c;
}

/** Lê do arquivo os valores do mês, aba por aba, já ligados à estrutura. */
async function lerPlanilha(buffer: Uint8Array, ano: number, mes: number): Promise<ValorPlanilha[]> {
  let abas: string[];
  try {
    abas = listarAbas(buffer);
  } catch (error) {
    if (error instanceof ArquivoInvalidoError) throw new ConferenciaError(400, error.message);
    throw error;
  }
  const faltam = ABAS.filter((a) => !abas.some((x) => mesmaAba(x, a.aba))).map((a) => a.aba);
  if (faltam.length) {
    throw new ConferenciaError(400, `O arquivo não tem as abas ${faltam.join(", ")}. Envie o SIG BPM ${ano} - BASE REALIZADO (RESULTADOS).`);
  }
  const estrutura = await getPrismaClient().linhaDRE.findMany({ where: { ativo: true }, orderBy: { ordem: "asc" }, select: { codigo: true, descricao: true } });
  const coluna = `${MESES[mes - 1]}/${String(ano).slice(2)}`;
  const valores: ValorPlanilha[] = [];
  for (const { unidade, aba } of ABAS) {
    const lida = lerAba(buffer, (xs) => xs.find((x) => mesmaAba(x, aba)) ?? null);
    const col = lida.linhas[0]?.celulas.findIndex((v) => n(v) === coluna) ?? -1;
    if (col < 0) throw new ConferenciaError(400, `A aba ${aba} não tem a coluna ${coluna}.`);
    const ligadas = new Map<string, { codigo: string; linha: number }>();
    let j = 0;
    for (const l of lida.linhas.slice(1)) {
      const desc = n(l.celulas[0]);
      if (!desc) continue;
      const bruto = l.celulas[col];
      const valor = typeof bruto === "number" ? bruto : bruto !== null && bruto !== "" && !Number.isNaN(Number(bruto)) ? Number(bruto) : null;
      // Pela Descrição atual ou pela de origem (25/11/2026: a planilha com o nome de antes de uma troca).
      const k = estrutura.findIndex((e, i) => i >= j && (n(e.descricao) === desc || ehAConta(e, desc)));
      const base = { unidade, aba, linha: l.numero, descricao: String(l.celulas[0]).trim(), valor };
      if (k >= 0) {
        j = k + 1;
        ligadas.set(desc, { codigo: estrutura[k].codigo, linha: l.numero });
        valores.push({ ...base, codigo: estrutura[k].codigo });
      } else if (ligadas.has(desc)) {
        valores.push({ ...base, codigo: ligadas.get(desc)!.codigo, repeteLinha: ligadas.get(desc)!.linha });
      } else {
        valores.push({ ...base, codigo: null });
      }
    }
  }
  return valores;
}

type LinhaRelatorio = {
  linha: number;
  descricao: string;
  codigo: string;
  tipo: string;
  grupo: string;
  sistema: string | null;
  planilha: number | null;
  diferenca: number;
  destaque: boolean;
  observacao?: string;
};

export const conferenciaPlanilhaService = {
  /** Recebe o arquivo da planilha para a competência e guarda os valores do mês. */
  async receber(ano: number, mes: number, nomeArquivo: string, conteudo: Uint8Array, usuarioId: string, usuarioNome: string) {
    const c = await competenciaPorAnoMes(ano, mes);
    if (conteudo.byteLength === 0) throw new ConferenciaError(400, "O arquivo está vazio.");
    const valores = await lerPlanilha(conteudo, ano, mes);
    const hash = createHash("sha256").update(conteudo).digest("hex");
    const registro = await getPrismaClient().conferenciaPlanilha.create({
      data: { competenciaId: c.id, nomeArquivo, hashArquivo: hash, enviadoPor: usuarioId, valores },
    });
    await auditar({
      usuarioId,
      usuarioNome,
      acao: "CONFERENCIA_PLANILHA",
      entidade: "competencia",
      entidadeId: `${ano}-${String(mes).padStart(2, "0")}`,
      metadados: { arquivo: nomeArquivo, hash, linhas: valores.length },
    });
    return { id: registro.id, linhas: valores.length };
  },

  /**
   * O relatório: a última planilha enviada contra a DRE apurada agora, com o
   * limite de arredondamento pedido. Diferença = ferramenta − planilha.
   */
  async relatorio(ano: number, mes: number, limite = LIMITE_PADRAO) {
    const prisma = getPrismaClient();
    const c = await competenciaPorAnoMes(ano, mes);
    const [conferencia, envios] = await Promise.all([
      prisma.conferenciaPlanilha.findFirst({ where: { competenciaId: c.id }, orderBy: { enviadoEm: "desc" }, include: { usuario: { select: { nome: true } } } }),
      prisma.conferenciaPlanilha.count({ where: { competenciaId: c.id } }),
    ]);
    const cabecalho = {
      competencia: { ano, mes, status: c.status },
      apuradaEm: c.apuradaEm,
      limite,
      envios,
      conferencia: conferencia
        ? { nomeArquivo: conferencia.nomeArquivo, hashArquivo: conferencia.hashArquivo, enviadoEm: conferencia.enviadoEm, enviadoPor: conferencia.usuario.nome }
        : null,
    };
    if (!conferencia || !c.apuradaEm) return { ...cabecalho, resumo: null, visoes: [] };

    const valores = conferencia.valores as ValorPlanilha[];
    const unidades = await prisma.unidadeNegocio.findMany({ select: { codigo: true, nome: true } });
    const consolidado = await dreService.consultarConsolidado(ano, mes);
    // A ROL pela descrição de origem (25/11/2026), que não muda com a Descrição.
    const rolConsolidada = consolidado.linhas.find((l) => ehAConta(l, ROL)) ?? null;

    const visoes = [];
    for (const { unidade, aba } of ABAS) {
      const dre = unidade === 0 ? consolidado : await dreService.consultarUnidade(ano, mes, unidade);
      const porCodigo = new Map(dre.linhas.map((l) => [l.codigo, l]));
      const daAba = valores.filter((v) => v.unidade === unidade);
      const linhas: LinhaRelatorio[] = [];
      const soNaPlanilha: Array<{ linha: number; descricao: string; planilha: number | null }> = [];
      const totaisDaPlanilha: Array<{ linha: number; descricao: string; planilha: number | null }> = [];
      for (const v of daAba) {
        if (!v.codigo && soDaPlanilha(aba, v.descricao)) {
          totaisDaPlanilha.push({ linha: v.linha, descricao: v.descricao, planilha: v.valor });
          continue;
        }
        if (!v.codigo) {
          soNaPlanilha.push({ linha: v.linha, descricao: v.descricao, planilha: v.valor });
          continue;
        }
        let s = porCodigo.get(v.codigo) ?? null;
        const observacoes: string[] = [];
        // Nas abas de Desp.+Extra e de RN, a ROL é a consolidada: a base dos percentuais.
        if ((unidade === 4 || unidade === 5) && (v.codigo ? ehAConta({ codigo: v.codigo }, ROL) : n(v.descricao) === ROL) && rolConsolidada) {
          s = rolConsolidada;
          observacoes.push("Nesta aba, a ROL é a consolidada (base dos percentuais): comparada com a ROL do Consolidado.");
        }
        if (v.repeteLinha) observacoes.push(`Repete a linha ${v.repeteLinha} da aba.`);
        if (!s) {
          const e = await prisma.linhaDRE.findUnique({ where: { codigo: v.codigo }, select: { tipo: true, grupo: true } });
          observacoes.push("A linha não tem valor apurado nesta visão da ferramenta.");
          s = { codigo: v.codigo, tipo: e?.tipo ?? "ITEM", grupo: e?.grupo ?? "", descricao: v.descricao, valor: null } as (typeof dre.linhas)[number];
        }
        // Em centavos, como a tela mostra: o resíduo de ponto flutuante da planilha (0,0000001) não é diferença.
        const diferenca = Math.round((Number(s.valor ?? 0) - (v.valor ?? 0)) * 100) / 100;
        linhas.push({
          linha: v.linha,
          descricao: v.descricao,
          codigo: v.codigo,
          tipo: s.tipo,
          grupo: s.grupo,
          sistema: s.valor,
          planilha: v.valor,
          diferenca,
          destaque: Math.abs(diferenca) > limite,
          ...(observacoes.length ? { observacao: observacoes.join(" ") } : {}),
        });
      }
      const ligadas = new Set(daAba.map((v) => v.codigo));
      const soNoSistema = dre.linhas.filter((l) => l.tipo !== "SECAO" && !ligadas.has(l.codigo)).map((l) => ({ codigo: l.codigo, descricao: l.descricao, sistema: l.valor }));
      const destacadas = linhas.filter((l) => l.destaque);
      visoes.push({
        unidade,
        nome: unidade === 0 ? "Consolidado" : (unidades.find((u) => u.codigo === unidade)?.nome ?? `Unidade ${unidade}`),
        aba,
        comparadas: linhas.length,
        diferencas: destacadas.length,
        maiorDiferenca: linhas.reduce((m, l) => (Math.abs(l.diferenca) > Math.abs(m) ? l.diferenca : m), 0),
        linhas,
        soNaPlanilha,
        soNoSistema,
        totaisDaPlanilha,
      });
    }
    return {
      ...cabecalho,
      resumo: {
        comparadas: visoes.reduce((s, v) => s + v.comparadas, 0),
        diferencas: visoes.reduce((s, v) => s + v.diferencas, 0),
        soNaPlanilha: visoes.reduce((s, v) => s + v.soNaPlanilha.length, 0),
        soNoSistema: visoes.reduce((s, v) => s + v.soNoSistema.length, 0),
      },
      visoes,
    };
  },
};
