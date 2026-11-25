import { readFile } from "node:fs/promises";

import { getPrismaClient } from "../../../config/prisma.js";
import { ArquivoInvalidoError, lerAba } from "../../../lib/xlsx.js";
import { logger } from "../../../utils/logger.js";
import { caminhoDoArquivo } from "../arquivosImportados.js";
import { escolherAba, recusarImportacao, registrarProgresso } from "../statusImportacao.js";
import { carregarNomesDoSistema } from "../../relatorios/indicadoresDoSistema.js";
import { DEFINICOES_INDICADORES, atualizarNomesDasMetas, lerIndicadores, recusaPorNomesAntigos, type TipoIndicadores } from "./leituraIndicadores.js";
import { indicadoresParaReferencias, referenciaDoNome } from "../../relatorios/referenciasDosIndicadores.js";

class ArquivoRecusado extends Error {}

/**
 * Importa os indicadores do mês (aba Indicadores (Admin.) ou (Comercial)) ou
 * as metas do orçamento (aba Metas (Orçamento)): o valor de cada indicador na
 * coluna do mês. Substitui a importação anterior do mesmo tipo na competência.
 * Nada disso entra na apuração: importar não pede reapuração.
 */
export async function processarIndicadores(importacaoId: string): Promise<void> {
  const prisma = getPrismaClient();
  try {
    const importacao = await prisma.importacao.findUniqueOrThrow({
      where: { id: importacaoId },
      select: { tipo: true, hashArquivo: true, competenciaId: true, competencia: { select: { ano: true, mes: true } } },
    });
    const tipo = importacao.tipo as TipoIndicadores;
    const def = DEFINICOES_INDICADORES[tipo];
    const aba = lerAba(await readFile(caminhoDoArquivo(importacao.hashArquivo)), escolherAba([def.aba]));
    await registrarProgresso(importacaoId, 40);
    await atualizarNomesDasMetas();
    // Os nomes atuais e os antigos dos indicadores (19/11/2026), lidos de novo antes de cada importação.
    await carregarNomesDoSistema();
    const leitura = lerIndicadores(tipo, aba.linhas, importacao.competencia.ano, importacao.competencia.mes);
    if (!leitura.ok) throw new ArquivoRecusado(leitura.motivo);
    // A linha com o nome antigo de um indicador renomeado recusa o arquivo inteiro: o arquivo muda antes de importar.
    const antigos = recusaPorNomesAntigos(leitura.rejeicoes);
    if (antigos) throw new ArquivoRecusado(antigos);
    if (leitura.valores.length === 0) throw new ArquivoRecusado(`A aba "${aba.nome}" não tem nenhum indicador com valor no mês.`);
    // Os valores gravados pelo ID do indicador (25/11/2026); o arquivo cita o indicador pelo nome.
    const referencias = await indicadoresParaReferencias(prisma);

    await prisma.$transaction(async (tx) => {
      const competencia = await tx.competencia.findUniqueOrThrow({ where: { id: importacao.competenciaId }, select: { status: true } });
      if (competencia.status === "FECHADA") throw new ArquivoRecusado("A competência foi fechada enquanto o arquivo era processado. Nada foi gravado.");
      const anteriores = await tx.importacao.findMany({
        where: { competenciaId: importacao.competenciaId, tipo, status: "CONCLUIDA", substituidaEm: null, id: { not: importacaoId } },
        select: { id: true },
      });
      const ids = anteriores.map((a) => a.id);
      const dados = leitura.valores.map((v) => ({ competenciaId: importacao.competenciaId, importacaoId, indicador: referenciaDoNome(v.nome, referencias), valor: v.valor, linhaArquivo: v.linhaArquivo }));
      if (def.destino === "META") {
        if (ids.length > 0) await tx.metaImportada.deleteMany({ where: { importacaoId: { in: ids } } });
        await tx.metaImportada.createMany({ data: dados });
      } else {
        if (ids.length > 0) await tx.indicadorImportado.deleteMany({ where: { importacaoId: { in: ids } } });
        await tx.indicadorImportado.createMany({ data: dados });
        // A importação volta a valer sobre o que foi digitado nas Listas para os indicadores que ela traz.
        await tx.indicadorDigitado.deleteMany({ where: { competenciaId: importacao.competenciaId, indicador: { in: dados.map((d) => d.indicador) } } });
      }
      if (ids.length > 0) await tx.importacao.updateMany({ where: { id: { in: ids } }, data: { substituidaEm: new Date() } });
      await tx.importacao.update({
        where: { id: importacaoId },
        data: {
          status: "CONCLUIDA",
          progresso: 100,
          linhasLidas: leitura.lidas,
          linhasAceitas: leitura.valores.length,
          linhasRejeitadas: leitura.rejeicoes.length,
          linhasIgnoradas: leitura.vazias,
          relatorioErros: leitura.rejeicoes,
          resumo: { aba: aba.nome, indicadores: leitura.valores.map((v) => ({ nome: v.nome, valor: v.valor })) },
        },
      });
    });
    logger("info", "Indicadores importados", { importacaoId, tipo, indicadores: leitura.valores.length });
  } catch (error) {
    if (error instanceof ArquivoRecusado || error instanceof ArquivoInvalidoError) {
      await recusarImportacao(importacaoId, error.message);
      return;
    }
    logger("error", "Falha ao processar os indicadores", { importacaoId, error: error instanceof Error ? error.message : String(error) });
    await recusarImportacao(importacaoId, "Erro inesperado no processamento. Nada foi gravado. Se persistir, encaminhe o arquivo ao responsável pelo sistema.");
  }
}
