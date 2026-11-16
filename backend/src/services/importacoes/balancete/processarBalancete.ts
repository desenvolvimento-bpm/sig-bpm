import { readFile } from "node:fs/promises";

import { getPrismaClient } from "../../../config/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import { ArquivoInvalidoError, lerAba } from "../../../lib/xlsx.js";
import { logger } from "../../../utils/logger.js";
import { ehCentroDeObra } from "../../classificacao/centrosObra.js";
import { classificacaoService } from "../../classificacao/classificacaoService.js";
import { contestacoesService } from "../../contestacoes/contestacoesService.js";
import { caminhoDoArquivo } from "../arquivosImportados.js";
import { escolherAba, recusarImportacao as recusar, registrarProgresso as progresso } from "../statusImportacao.js";
import {
  ABA_BALANCETE,
  conferirTotal,
  interpretarBalancete,
  type LinhaBalancete,
  type Rejeicao,
} from "./leiauteBalancete.js";
import { compararBalancete } from "../../divergencias/divergenciasService.js";

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

const LOTE_GRAVACAO = 500;

/** Recusa do arquivo inteiro: nada é gravado. */
class ArquivoRecusado extends Error {}

type CentroSemCadastro = {
  codigo: string;
  nome: string | null;
  obra: boolean;
  linhas: number;
  valor: Decimal;
};

export async function processarBalancete(importacaoId: string): Promise<void> {
  const prisma = getPrismaClient();

  try {
    const importacao = await prisma.importacao.findUniqueOrThrow({
      where: { id: importacaoId },
      include: { competencia: { select: { id: true, ano: true, mes: true } } },
    });
    const { competencia } = importacao;

    const conteudo = await readFile(caminhoDoArquivo(importacao.hashArquivo));
    const aba = lerAba(conteudo, escolherAba([ABA_BALANCETE]));
    await progresso(importacaoId, 30);

    const leitura = interpretarBalancete(aba.linhas, competencia.ano, competencia.mes);
    if (!leitura.ok) throw new ArquivoRecusado(leitura.motivo);

    const contagemLeitura = {
      linhasLidas: leitura.linhasLidas,
      linhasIgnoradas: leitura.ignoradas.subtotais + leitura.ignoradas.semMovimento,
    };

    const divergenciaTotal = conferirTotal(leitura.somaArquivo, leitura.totalGeral, leitura.tabelasDoMes);
    if (divergenciaTotal) {
      await recusar(importacaoId, divergenciaTotal, contagemLeitura);
      return;
    }
    // Competência fechada: só a comparação com o gravado (Passo 24).
    if (importacao.comparacao) {
      const r = await compararBalancete(aba.linhas, competencia, importacaoId);
      await prisma.importacao.update({
        where: { id: importacaoId },
        data: {
          status: "CONCLUIDA",
          progresso: 100,
          substituidaEm: new Date(), // nunca é o lote ativo da competência
          linhasLidas: leitura.linhasLidas,
          linhasAceitas: leitura.lancamentos.length,
          linhasRejeitadas: leitura.rejeicoes.length,
          linhasIgnoradas: contagemLeitura.linhasIgnoradas,
          relatorioErros: leitura.rejeicoes,
          resumo: { aba: aba.nome, modo: "COMPARACAO", divergencias: r?.registradas ?? 0, diferenca: r?.diferenca ?? "0.00", somaArquivo: leitura.somaArquivo.toFixed(2) },
        },
      });
      logger("info", "Balancete comparado com competência fechada", { importacaoId, ...r });
      return;
    }
    if (leitura.lancamentos.length === 0 && leitura.rejeicoes.length === 0) {
      await recusar(
        importacaoId,
        `O arquivo não tem movimentação em ` +
          `${String(competencia.mes).padStart(2, "0")}/${competencia.ano}. ` +
          "Confira se o balancete do mês já foi exportado do RM.",
        contagemLeitura,
      );
      return;
    }
    await progresso(importacaoId, 50);

    // Resolução contra o cadastro. Conta é obrigatória: sem ela o lançamento
    // não tem natureza. Centro de custo não — fica o código de origem.
    const [contas, centros] = await Promise.all([
      prisma.contaResultado.findMany({ select: { id: true, reduzido: true } }),
      prisma.centroCusto.findMany({
        where: { codigoRM: { not: null } },
        select: { id: true, codigoRM: true },
      }),
    ]);
    const contaPorReduzido = new Map(contas.map((c) => [c.reduzido, c.id]));
    const centroPorCodigo = new Map(centros.map((c) => [c.codigoRM!, c.id]));

    const rejeicoes: Rejeicao[] = [...leitura.rejeicoes];
    const aceitos: Array<LinhaBalancete & { contaResultadoId: string; centroCustoId: string | null }> = [];
    const semCadastro = new Map<string, CentroSemCadastro>();

    for (const l of leitura.lancamentos) {
      const contaResultadoId = contaPorReduzido.get(l.reduzido);
      if (!contaResultadoId) {
        rejeicoes.push({
          linha: l.linhaArquivo,
          codigo: "CONTA_NAO_CADASTRADA",
          mensagem: `Conta ${l.reduzido}${l.descricaoConta ? ` (${l.descricaoConta})` : ""} não está no cadastro de contas de resultado.`,
          filial: String(l.filial),
          codigoCentroCusto: l.codigoCentroCusto,
          reduzido: l.reduzido,
          valor: l.valorMovimento.toFixed(2),
        });
        continue;
      }

      let centroCustoId: string | null = null;
      if (l.codigoCentroCusto) {
        centroCustoId = centroPorCodigo.get(l.codigoCentroCusto) ?? null;
        if (!centroCustoId) {
          const atual = semCadastro.get(l.codigoCentroCusto) ?? {
            codigo: l.codigoCentroCusto,
            nome: l.nomeCentroCusto,
            obra: ehCentroDeObra(l.codigoCentroCusto),
            linhas: 0,
            valor: new Decimal(0),
          };
          atual.linhas++;
          atual.valor = atual.valor.plus(l.valorMovimento);
          semCadastro.set(l.codigoCentroCusto, atual);
        }
      }

      aceitos.push({ ...l, contaResultadoId, centroCustoId });
    }
    rejeicoes.sort((a, b) => a.linha - b.linha);
    await progresso(importacaoId, 60);

    const somar = (valores: Decimal[]) =>
      valores.reduce((acc, v) => acc.plus(v), new Decimal(0));

    const porFilial = new Map<number, { linhas: number; valor: Decimal }>();
    for (const a of aceitos) {
      const f = porFilial.get(a.filial) ?? { linhas: 0, valor: new Decimal(0) };
      f.linhas++;
      f.valor = f.valor.plus(a.valorMovimento);
      porFilial.set(a.filial, f);
    }

    const centrosSemCadastro = [...semCadastro.values()].sort((a, b) =>
      a.codigo.localeCompare(b.codigo),
    );

    // Gravação: o lote anterior do mesmo tipo sai por inteiro e o novo entra,
    // na mesma transação. Ou fica o lote antigo, ou fica o novo.
    const substituidas = await prisma.$transaction(
      async (tx) => {
        const atual = await tx.competencia.findUniqueOrThrow({
          where: { id: competencia.id },
          select: { status: true },
        });
        if (atual.status === "FECHADA") {
          throw new ArquivoRecusado(
            "A competência foi fechada enquanto o arquivo era processado. Nada foi gravado.",
          );
        }

        const anteriores = await tx.importacao.findMany({
          where: {
            competenciaId: competencia.id,
            tipo: "BALANCETE",
            status: "CONCLUIDA",
            substituidaEm: null,
            id: { not: importacaoId },
          },
          select: { id: true },
        });
        const idsAnteriores = anteriores.map((a) => a.id);
        if (idsAnteriores.length > 0) {
          await tx.lancamentoContabil.deleteMany({
            where: { importacaoId: { in: idsAnteriores } },
          });
          await tx.importacao.updateMany({
            where: { id: { in: idsAnteriores } },
            data: { substituidaEm: new Date() },
          });
        }

        for (let i = 0; i < aceitos.length; i += LOTE_GRAVACAO) {
          await tx.lancamentoContabil.createMany({
            data: aceitos.slice(i, i + LOTE_GRAVACAO).map((a) => ({
              competenciaId: competencia.id,
              importacaoId,
              filial: a.filial,
              centroCustoId: a.centroCustoId,
              contaResultadoId: a.contaResultadoId,
              valorMovimento: a.valorMovimento,
              codigoCentroCusto: a.codigoCentroCusto,
              nomeCentroCusto: a.nomeCentroCusto,
              linhaArquivo: a.linhaArquivo,
              // O detalhe do movimento (15/10/2026), no balancete detalhado.
              cliForn: a.cliForn,
              emissao: a.emissao,
              historico: a.historico,
              // O ID do movimento no RM (10/11/2026).
              idMovimento: a.idMovimento,
            })),
          });
        }

        await tx.importacao.update({
          where: { id: importacaoId },
          data: {
            status: "CONCLUIDA",
            progresso: 100,
            linhasLidas: leitura.linhasLidas,
            linhasAceitas: aceitos.length,
            linhasRejeitadas: rejeicoes.length,
            linhasIgnoradas: contagemLeitura.linhasIgnoradas,
            relatorioErros: rejeicoes,
            resumo: {
              aba: aba.nome,
              somaArquivo: leitura.somaArquivo.toFixed(2),
              totalGeral: leitura.totalGeral?.toFixed(2) ?? null,
              valorAceito: somar(aceitos.map((a) => a.valorMovimento)).toFixed(2),
              valorRejeitado: somar(
                rejeicoes.map((r) => new Decimal(r.valor ?? 0)),
              ).toFixed(2),
              ignoradas: leitura.ignoradas,
              porFilial: [...porFilial.entries()]
                .sort(([a], [b]) => a - b)
                .map(([filial, f]) => ({
                  filial,
                  linhas: f.linhas,
                  valor: f.valor.toFixed(2),
                })),
              centrosSemCadastro: centrosSemCadastro.map((c) => ({
                ...c,
                valor: c.valor.toFixed(2),
              })),
              substituiu: idsAnteriores,
            },
          },
        });

        return idsAnteriores.length;
      },
      { timeout: 60_000 },
    );

    logger("info", "Balancete importado", {
      importacaoId,
      competencia: `${competencia.mes}/${competencia.ano}`,
      aceitas: aceitos.length,
      rejeitadas: rejeicoes.length,
      substituidas,
    });

    // O arquivo traz o exercício inteiro: os outros meses dele que já estão
    // fechados são comparados com o gravado (divergência retroativa, Passo 24).
    try {
      const fechadas = await prisma.competencia.findMany({
        where: { ano: competencia.ano, status: "FECHADA", id: { not: competencia.id } },
        select: { id: true, ano: true, mes: true },
        orderBy: { mes: "asc" },
      });
      const retroativas: Array<{ competencia: string; divergencias: number; diferenca: string }> = [];
      for (const f of fechadas) {
        const r = await compararBalancete(aba.linhas, f, importacaoId);
        if (r) retroativas.push({ competencia: `${String(f.mes).padStart(2, "0")}/${f.ano}`, divergencias: r.registradas, diferenca: r.diferenca });
      }
      if (retroativas.length) {
        const atual = await prisma.importacao.findUniqueOrThrow({ where: { id: importacaoId }, select: { resumo: true } });
        await prisma.importacao.update({
          where: { id: importacaoId },
          data: { resumo: { ...((atual.resumo as Prisma.JsonObject | null) ?? {}), retroativas } },
        });
      }
    } catch (error) {
      logger("error", "Falha ao comparar os meses fechados", { importacaoId, error: error instanceof Error ? error.message : String(error) });
    }

    // As contestações dos itens do balancete substituído voltam a apontar para eles (27/10/2026), antes da classificação
    // (que aplica as validadas no balancete).
    try {
      await contestacoesService.religar(competencia.id);
    } catch (error) {
      logger("error", "Falha ao religar as contestações após a importação", { importacaoId, error: error instanceof Error ? error.message : String(error) });
    }

    // A classificação corre logo depois, no mesmo trabalho da fila. Se falhar,
    // a importação continua válida: os lançamentos ficam sem classificação e a
    // tela de classificação permite recalcular.
    try {
      await classificacaoService.classificarCompetencia(competencia.id);
    } catch (error) {
      logger("error", "Falha ao classificar após a importação", {
        importacaoId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } catch (error) {
    if (error instanceof ArquivoRecusado || error instanceof ArquivoInvalidoError) {
      await recusar(importacaoId, error.message);
      return;
    }
    logger("error", "Falha ao processar balancete", {
      importacaoId,
      error: error instanceof Error ? error.message : String(error),
    });
    await recusar(
      importacaoId,
      "Erro inesperado no processamento. Nada foi gravado. Se persistir, " +
        "encaminhe o arquivo ao responsável pelo sistema.",
    );
  }
}
