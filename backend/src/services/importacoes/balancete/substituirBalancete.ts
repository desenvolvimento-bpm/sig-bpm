import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";

import { getPrismaClient } from "../../../config/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import { lerAba } from "../../../lib/xlsx.js";
import { retratoEntradas } from "../../apuracao/apuracaoService.js";
import { auditar } from "../../auditoriaService.js";
import { contestacoesService } from "../../contestacoes/contestacoesService.js";
import { classificarLancamento, type ContaParaClassificar } from "../../classificacao/regrasClassificacao.js";
import { caminhoDoArquivo, diretorioUploads } from "../arquivosImportados.js";
import { ABA_BALANCETE, conferirTotal, interpretarBalancete } from "./leiauteBalancete.js";

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;
const CENTAVO = new Decimal("0.01");
const LOTE = 500;
const rotulo = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;

export type ResultadoDoMes = {
  competencia: string;
  situacao: "SUBSTITUIDO" | "CONFERE" | "NAO_CONFERE" | "RECUSADO";
  motivo?: string;
  linhasAntes: number;
  linhasDepois: number;
  /** A soma do mês, antes e depois (iguais quando confere). */
  somaAntes: string;
  somaDepois: string;
  /** Filial, centro e conta com soma diferente da gravada (as primeiras). */
  diferencas: Array<{ chave: string; antes: string; depois: string }>;
  /** Centro e conta que não existiam gravados (movimentos que se anulam no mês): classificados pela regra de sempre. */
  classificadosPelaRegra: number;
};

/**
 * A troca do balancete agregado pelo balancete detalhado (15/10/2026: as colunas CLI_FORN, EMISSAO e HISTORICO do
 * Balancete (Lista)), nos meses já importados — também os apurados e os fechados —, sem recalcular nada. Para cada mês:
 *
 * 1. Lê o arquivo; recusa o mês se a leitura falha, se há linha recusada, se o total não confere ou se o arquivo não
 *    é detalhado.
 * 2. Confere, para cada filial, centro e conta, a soma do arquivo com a gravada: com qualquer diferença acima de um
 *    centavo, o mês fica como está (NAO_CONFERE).
 * 3. Com `gravar`, troca os lançamentos numa transação: cada movimento herda a classificação já gravada do mesmo
 *    centro e conta (a classificação depende só deles e do cadastro, que não muda aqui). A combinação que não existia
 *    gravada (movimentos que se anulam no mês) é classificada pela regra de sempre, com o cadastro vigente.
 * 4. A importação anterior fica substituída; a nova registra o modo SUBSTITUICAO_DETALHADA. A DRE apurada, o estado da
 *    competência e as divergências não mudam; o retrato das entradas da apuração passa a ser o dos lançamentos novos
 *    (os mesmos totais), para o mês não pedir reapuração se for reaberto.
 */
export async function substituirBalanceteDetalhado(opcoes: {
  conteudo: Uint8Array;
  nomeArquivo: string;
  ano: number;
  meses: number[];
  usuario: { id: string; nome: string };
  gravar: boolean;
}): Promise<ResultadoDoMes[]> {
  const prisma = getPrismaClient();
  const aba = lerAba(opcoes.conteudo, (abas) => (abas.includes(ABA_BALANCETE) ? ABA_BALANCETE : null));
  const hash = createHash("sha256").update(opcoes.conteudo).digest("hex");
  if (opcoes.gravar) {
    await mkdir(diretorioUploads(), { recursive: true });
    const caminho = caminhoDoArquivo(hash);
    try {
      await access(caminho);
    } catch {
      await writeFile(caminho, opcoes.conteudo);
    }
  }
  const [contas, centros, reclassificacoes] = await Promise.all([
    prisma.contaResultado.findMany({
      select: { id: true, reduzido: true, tipoConta: true, departamento: true, atribuicao: true, balde: true, linhaDREId: true, semResultado: true, linhaDRE: { select: { descricao: true } } },
    }),
    prisma.centroCusto.findMany({ where: { codigoRM: { not: null } }, select: { id: true, codigoRM: true, departamento: true, atribuicao: true, balde: true } }),
    prisma.reclassificacaoConta.findMany({ where: { ativo: true }, select: { codigoCentroCusto: true, contaOrigemId: true, contaDestinoId: true } }),
  ]);
  const contaPorReduzido = new Map(contas.map((c) => [c.reduzido, c]));
  const contaPorId = new Map<string, ContaParaClassificar>(contas.map(({ linhaDRE, reduzido: _r, ...c }) => [c.id, { ...c, linhaDREDescricao: linhaDRE?.descricao ?? null }]));
  const centroPorCodigo = new Map(centros.map((c) => [c.codigoRM!, c]));
  const destinoDe = new Map(reclassificacoes.map((r) => [`${r.codigoCentroCusto}|${r.contaOrigemId}`, r.contaDestinoId]));

  const resultados: ResultadoDoMes[] = [];
  for (const mes of opcoes.meses) {
    const competencia = await prisma.competencia.findUnique({ where: { ano_mes: { ano: opcoes.ano, mes } }, select: { id: true, entradasApuradas: true } });
    const base = { competencia: rotulo(opcoes.ano, mes), linhasAntes: 0, linhasDepois: 0, somaAntes: "0.00", somaDepois: "0.00", diferencas: [], classificadosPelaRegra: 0 };
    if (!competencia) {
      resultados.push({ ...base, situacao: "RECUSADO", motivo: "A competência não existe." });
      continue;
    }
    const leitura = interpretarBalancete(aba.linhas, opcoes.ano, mes);
    if (!leitura.ok) {
      resultados.push({ ...base, situacao: "RECUSADO", motivo: leitura.motivo });
      continue;
    }
    const recusa =
      conferirTotal(leitura.somaArquivo, leitura.totalGeral, leitura.tabelasDoMes) ??
      (leitura.rejeicoes.length ? `${leitura.rejeicoes.length} linhas recusadas (a primeira: ${leitura.rejeicoes[0].mensagem}).` : null) ??
      (leitura.lancamentos.some((l) => l.reduzido && !contaPorReduzido.has(l.reduzido)) ? "Há conta fora do cadastro de contas de resultado." : null) ??
      (leitura.lancamentos.every((l) => l.cliForn === null && l.emissao === null && l.historico === null) ? "O arquivo não é o balancete detalhado (sem CLI_FORN, EMISSAO e HISTORICO)." : null);
    if (recusa) {
      resultados.push({ ...base, situacao: "RECUSADO", motivo: recusa });
      continue;
    }

    const gravados = await prisma.lancamentoContabil.findMany({
      where: { competenciaId: competencia.id },
      orderBy: [{ filial: "asc" }, { codigoCentroCusto: { sort: "asc", nulls: "first" } }, { linhaArquivo: "asc" }],
      select: {
        filial: true,
        codigoCentroCusto: true,
        valorMovimento: true,
        contaResultadoId: true,
        contaResultado: { select: { reduzido: true } },
        centroCustoId: true,
        contaAdotadaId: true,
        classificadoEm: true,
        departamento: true,
        atribuicao: true,
        linhaDREId: true,
        balde: true,
        alocacao: true,
        etiqueta: true,
        validacao: true,
      },
    });
    const chave = (filial: number, centro: string | null, conta: string) => `${filial}|${centro ?? ""}|${conta}`;
    const somaPor = new Map<string, { antes: Decimal; depois: Decimal }>();
    const em = (k: string) => somaPor.get(k) ?? somaPor.set(k, { antes: new Decimal(0), depois: new Decimal(0) }).get(k)!;
    for (const g of gravados) em(chave(g.filial, g.codigoCentroCusto, g.contaResultado.reduzido)).antes = em(chave(g.filial, g.codigoCentroCusto, g.contaResultado.reduzido)).antes.plus(g.valorMovimento);
    for (const l of leitura.lancamentos) em(chave(l.filial, l.codigoCentroCusto, l.reduzido)).depois = em(chave(l.filial, l.codigoCentroCusto, l.reduzido)).depois.plus(l.valorMovimento);
    const diferencas = [...somaPor].filter(([, s]) => s.antes.minus(s.depois).abs().greaterThan(CENTAVO));
    const somar = (xs: Decimal[]) => xs.reduce((a, x) => a.plus(x), new Decimal(0));
    const r: ResultadoDoMes = {
      ...base,
      situacao: diferencas.length ? "NAO_CONFERE" : opcoes.gravar ? "SUBSTITUIDO" : "CONFERE",
      linhasAntes: gravados.length,
      linhasDepois: leitura.lancamentos.length,
      somaAntes: somar(gravados.map((g) => g.valorMovimento)).toFixed(2),
      somaDepois: somar(leitura.lancamentos.map((l) => l.valorMovimento)).toFixed(2),
      diferencas: diferencas.slice(0, 10).map(([k, s]) => ({ chave: k, antes: s.antes.toFixed(2), depois: s.depois.toFixed(2) })),
    };
    resultados.push(r);
    if (diferencas.length || !opcoes.gravar) {
      // Na simulação, conta também as combinações que a regra classificaria.
      const existentes = new Set(gravados.map((g) => `${g.codigoCentroCusto ?? ""}|${g.contaResultadoId}`));
      r.classificadosPelaRegra = new Set(leitura.lancamentos.map((l) => `${l.codigoCentroCusto ?? ""}|${contaPorReduzido.get(l.reduzido)!.id}`).filter((k) => !existentes.has(k))).size;
      continue;
    }

    // A classificação gravada de cada centro e conta.
    const classificacaoDe = new Map(
      gravados.map((g) => [
        `${g.codigoCentroCusto ?? ""}|${g.contaResultadoId}`,
        {
          centroCustoId: g.centroCustoId,
          contaAdotadaId: g.contaAdotadaId,
          classificadoEm: g.classificadoEm,
          departamento: g.departamento,
          atribuicao: g.atribuicao,
          linhaDREId: g.linhaDREId,
          balde: g.balde,
          alocacao: g.alocacao,
          etiqueta: g.etiqueta,
          validacao: g.validacao,
        },
      ]),
    );
    const agora = new Date();
    const pelaRegra = new Set<string>();
    const novos = leitura.lancamentos.map((l) => {
      const conta = contaPorReduzido.get(l.reduzido)!;
      const k = `${l.codigoCentroCusto ?? ""}|${conta.id}`;
      let c = classificacaoDe.get(k);
      if (!c) {
        pelaRegra.add(k);
        const destino = l.codigoCentroCusto ? destinoDe.get(`${l.codigoCentroCusto}|${conta.id}`) : undefined;
        const centro = l.codigoCentroCusto ? (centroPorCodigo.get(l.codigoCentroCusto) ?? null) : null;
        c = { ...classificarLancamento(l.codigoCentroCusto, centro, contaPorId.get(destino ?? conta.id)!), classificadoEm: agora };
        classificacaoDe.set(k, c);
      }
      return {
        competenciaId: competencia.id,
        filial: l.filial,
        contaResultadoId: conta.id,
        valorMovimento: l.valorMovimento,
        codigoCentroCusto: l.codigoCentroCusto,
        nomeCentroCusto: l.nomeCentroCusto,
        linhaArquivo: l.linhaArquivo,
        cliForn: l.cliForn,
        emissao: l.emissao,
        historico: l.historico,
        idMovimento: l.idMovimento,
        ...c,
      };
    });
    r.classificadosPelaRegra = pelaRegra.size;

    await prisma.$transaction(
      async (tx) => {
        const anteriores = await tx.importacao.findMany({
          where: { competenciaId: competencia.id, tipo: "BALANCETE", status: "CONCLUIDA", substituidaEm: null, comparacao: false },
          select: { id: true },
        });
        const importacao = await tx.importacao.create({
          data: {
            competenciaId: competencia.id,
            tipo: "BALANCETE",
            nomeArquivo: opcoes.nomeArquivo,
            hashArquivo: hash,
            importadoPor: opcoes.usuario.id,
            status: "CONCLUIDA",
            progresso: 100,
            linhasLidas: leitura.linhasLidas,
            linhasAceitas: novos.length,
            linhasRejeitadas: 0,
            linhasIgnoradas: leitura.ignoradas.subtotais + leitura.ignoradas.semMovimento,
            relatorioErros: [],
            resumo: {
              aba: aba.nome,
              modo: "SUBSTITUICAO_DETALHADA",
              somaArquivo: leitura.somaArquivo.toFixed(2),
              totalGeral: leitura.totalGeral?.toFixed(2) ?? null,
              valorAceito: r.somaDepois,
              valorRejeitado: "0.00",
              ignoradas: leitura.ignoradas,
              substituiu: anteriores.map((a) => a.id),
              linhasAntes: r.linhasAntes,
              classificadosPelaRegra: r.classificadosPelaRegra,
            },
          },
          select: { id: true },
        });
        await tx.lancamentoContabil.deleteMany({ where: { competenciaId: competencia.id } });
        if (anteriores.length) await tx.importacao.updateMany({ where: { id: { in: anteriores.map((a) => a.id) } }, data: { substituidaEm: agora } });
        for (let i = 0; i < novos.length; i += LOTE) {
          await tx.lancamentoContabil.createMany({ data: novos.slice(i, i + LOTE).map((n) => ({ ...n, importacaoId: importacao.id })) });
        }
      },
      { timeout: 300_000 },
    );
    // As contestações dos itens voltam a apontar para eles (27/10/2026).
    await contestacoesService.religar(competencia.id);
    // O retrato das entradas da apuração: o dos lançamentos novos (os mesmos totais), nos meses apurados.
    if (competencia.entradasApuradas) {
      await prisma.competencia.update({ where: { id: competencia.id }, data: { entradasApuradas: (await retratoEntradas(competencia.id)) as Prisma.InputJsonValue } });
    }
    await auditar({
      usuarioId: opcoes.usuario.id,
      usuarioNome: opcoes.usuario.nome,
      acao: "IMPORTACAO",
      entidade: "competencia",
      entidadeId: `${opcoes.ano}-${String(mes).padStart(2, "0")}`,
      metadados: { balancete: "substituição pelo detalhado, sem recalcular", arquivo: opcoes.nomeArquivo, linhasAntes: r.linhasAntes, linhasDepois: r.linhasDepois, soma: r.somaDepois },
    });
  }
  return resultados;
}
