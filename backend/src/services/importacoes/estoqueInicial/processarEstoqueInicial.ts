import { readFile } from "node:fs/promises";

import { getPrismaClient } from "../../../config/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import { ArquivoInvalidoError, lerAba } from "../../../lib/xlsx.js";
import { logger } from "../../../utils/logger.js";
import { caminhoDoArquivo } from "../arquivosImportados.js";
import { localizarCabecalho, normalizar, numero, texto } from "../listas/leituraListas.js";
import { garantirObras } from "../listas/obras.js";
import { escolherAba, recusarImportacao, registrarProgresso } from "../statusImportacao.js";
import { chaveDaLinha, linhasPorChave } from "../../../lib/linhas.js";

/**
 * Saldo inicial do estoque — a aba Estoque (2025) do SIG BPM 2026 - LISTAS
 * REALIZADO (OPERAÇÃO): o saldo de cada obra e linha no fim de 2025, em m³ e
 * em valor fiscal. Importado no primeiro mês da ferramenta (01/2026): a
 * apuração do estoque daquele mês parte dele, já que não há mês anterior.
 *
 * Linhas repetidas da mesma obra e linha são somadas, como na planilha.
 */

const ABAS = ["Estoque (2025)"];
class ArquivoRecusado extends Error {}

export async function processarEstoqueInicial(importacaoId: string): Promise<void> {
  const prisma = getPrismaClient();
  try {
    const importacao = await prisma.importacao.findUniqueOrThrow({ where: { id: importacaoId } });
    const aba = lerAba(await readFile(caminhoDoArquivo(importacao.hashArquivo)), escolherAba(ABAS));
    await registrarProgresso(importacaoId, 30);

    const cab = localizarCabecalho(aba.linhas, ["OBRA", "LINHA", "VOLUME (M³)", "TOTAL FISCAL (R$)"], ["NOME DA OBRA"]);
    if ("erro" in cab) throw new ArquivoRecusado(cab.erro);
    const k = cab.col;
    const saldos = new Map<string, { obra: string; nome: string | null; linha: string; volume: Prisma.Decimal; valor: Prisma.Decimal }>();
    const rejeicoes: Array<{ linha: number; codigo: string; mensagem: string }> = [];
    let lidas = 0;
    let vazias = 0;
    for (const l of aba.linhas) {
      if (l.numero <= cab.numero) continue;
      lidas++;
      const obra = texto(l.celulas[k.OBRA]);
      if (!obra) {
        vazias++;
        continue;
      }
      const linha = normalizar(l.celulas[k.LINHA]);
      const volume = numero(l.celulas[k["VOLUME (M³)"]]);
      const valor = numero(l.celulas[k["TOTAL FISCAL (R$)"]]);
      if (!volume || !valor || !linha) {
        rejeicoes.push({ linha: l.numero, codigo: "VALOR_INVALIDO", mensagem: "Linha, volume ou valor inválido." });
        continue;
      }
      const chave = `${obra}|${linha}`;
      const s = saldos.get(chave) ?? { obra, nome: texto(l.celulas[k["NOME DA OBRA"]]), linha, volume: new Prisma.Decimal(0), valor: new Prisma.Decimal(0) };
      s.volume = s.volume.plus(volume);
      s.valor = s.valor.plus(valor);
      saldos.set(chave, s);
    }
    if (saldos.size === 0) throw new ArquivoRecusado(`A aba "${aba.nome}" não tem nenhum saldo.`);
    await registrarProgresso(importacaoId, 60);

    await prisma.$transaction(
      async (tx) => {
        const { porCodigo, criadas } = await garantirObras(tx, new Map([...saldos.values()].map((s) => [s.obra, s.nome])));
        // A linha pelo Código ou pelo Nome (25/11/2026: o Código não muda; o Nome, sim).
        const linhas = linhasPorChave(await tx.linha.findMany({ where: { tipo: "PRODUTO" }, select: { id: true, nome: true, codigo: true } }));
        // Conferido dentro da transação: o saldo inicial só entra no primeiro mês
        // da ferramenta (os outros partem do saldo do mês anterior) e não entra
        // numa competência fechada. O saldo já apurado do mês fica como está:
        // a importação nova aparece como mudança, e reapurar o recalcula.
        const competencia = await tx.competencia.findUniqueOrThrow({ where: { id: importacao.competenciaId }, select: { ano: true, mes: true, status: true } });
        if (competencia.status === "FECHADA") throw new ArquivoRecusado("A competência está fechada: o saldo inicial não pode ser importado nela.");
        const a = competencia.mes === 1 ? { ano: competencia.ano - 1, mes: 12 } : { ano: competencia.ano, mes: competencia.mes - 1 };
        if (await tx.competencia.findUnique({ where: { ano_mes: a }, select: { id: true } })) {
          const primeira = await tx.competencia.findFirstOrThrow({ orderBy: [{ ano: "asc" }, { mes: "asc" }], select: { ano: true, mes: true } });
          throw new ArquivoRecusado(
            `O saldo inicial só é importado no primeiro mês da ferramenta (${String(primeira.mes).padStart(2, "0")}/${primeira.ano}); os demais partem do saldo do mês anterior.`,
          );
        }
        await tx.estoqueSaldoInicial.deleteMany({ where: { competenciaId: importacao.competenciaId } });
        await tx.estoqueSaldoInicial.createMany({
          data: [...saldos.values()].map((s) => ({
            competenciaId: importacao.competenciaId,
            importacaoId,
            obraId: porCodigo.get(s.obra)!,
            linhaId: linhas.get(chaveDaLinha(s.linha))?.id ?? null,
            linhaTexto: s.linha,
            saldoVolume: s.volume,
            saldoValor: s.valor,
          })),
        });
        const porLinha = new Map<string, { saldos: number; volume: Prisma.Decimal; valor: Prisma.Decimal }>();
        for (const s of saldos.values()) {
          const t = porLinha.get(s.linha) ?? { saldos: 0, volume: new Prisma.Decimal(0), valor: new Prisma.Decimal(0) };
          porLinha.set(s.linha, { saldos: t.saldos + 1, volume: t.volume.plus(s.volume), valor: t.valor.plus(s.valor) });
        }
        await tx.importacao.update({
          where: { id: importacaoId },
          data: {
            status: "CONCLUIDA",
            progresso: 100,
            linhasLidas: lidas,
            linhasAceitas: lidas - vazias - rejeicoes.length,
            linhasRejeitadas: rejeicoes.length,
            linhasIgnoradas: vazias,
            relatorioErros: rejeicoes,
            resumo: {
              aba: aba.nome,
              saldos: saldos.size,
              obrasCriadas: criadas,
              porLinha: [...porLinha].map(([linha, t]) => ({ linha, saldos: t.saldos, volume: t.volume.toFixed(3), valor: t.valor.toFixed(2) })),
            },
          },
        });
      },
      { timeout: 120_000 },
    );
    logger("info", "Saldo inicial do estoque importado", { importacaoId, saldos: saldos.size });
  } catch (error) {
    if (error instanceof ArquivoRecusado || error instanceof ArquivoInvalidoError) {
      await recusarImportacao(importacaoId, error.message);
      return;
    }
    logger("error", "Falha ao processar o saldo inicial do estoque", { importacaoId, error: error instanceof Error ? error.message : String(error) });
    await recusarImportacao(importacaoId, "Erro inesperado no processamento. Nada foi gravado. Se persistir, encaminhe o arquivo ao responsável pelo sistema.");
  }
}
