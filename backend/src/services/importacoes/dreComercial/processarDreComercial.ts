import { readFile } from "node:fs/promises";

import { getPrismaClient } from "../../../config/prisma.js";
import type { Prisma } from "../../../generated/prisma/client.js";
import { ArquivoInvalidoError, lerAba } from "../../../lib/xlsx.js";
import { logger } from "../../../utils/logger.js";
import { caminhoDoArquivo } from "../arquivosImportados.js";
import { garantirObras } from "../listas/obras.js";
import { escolherAba, recusarImportacao, registrarProgresso } from "../statusImportacao.js";
import {
  ABA_DRE_COMERCIAL,
  ABA_PEDIDOS,
  assinaturaDoPreco,
  interpretarDreComercial,
  nomesDasObras,
  type PrecoLido,
} from "./leiauteDreComercial.js";
import { detectarPrecos, type SubstituicaoPreco } from "../../divergencias/divergenciasService.js";
import { chaveDaLinha, linhasPorChave } from "../../../lib/linhas.js";

/**
 * Importação da DRE do Comercial, com o preço historiado, não sobrescrito
 * (SPEC, PrecoContrato): o Comercial pode atualizar a DRE de venda de uma obra
 * que já entrou em produção, e a receita de um mês já apurado não pode se mover
 * por isso. Numa reimportação, pela chave do preço:
 *  - igual: fica como está, com a vigência original;
 *  - diferente: o anterior é marcado como substituído e o novo passa a valer;
 *  - fora do arquivo: o anterior é marcado como substituído.
 *
 * Os preços valem para todas as competências; a competência da importação é
 * só onde ela fica registrada.
 */

const LOTE = 500;
const MAX_EXEMPLOS = 100;

class ArquivoRecusado extends Error {}

const texto = (d: Prisma.Decimal | null) => (d === null ? null : d.toFixed(2));

export async function processarDreComercial(importacaoId: string): Promise<void> {
  const prisma = getPrismaClient();
  try {
    const importacao = await prisma.importacao.findUniqueOrThrow({ where: { id: importacaoId } });
    const conteudo = await readFile(caminhoDoArquivo(importacao.hashArquivo));
    const aba = lerAba(conteudo, escolherAba([ABA_DRE_COMERCIAL]));
    await registrarProgresso(importacaoId, 30);

    const leitura = interpretarDreComercial(aba.linhas);
    if (!leitura.ok) throw new ArquivoRecusado(leitura.motivo);
    // Os nomes das obras, da aba Pedidos do mesmo arquivo; sem a aba, as obras novas ficam com o código, como antes.
    let nomes = new Map<string, string>();
    try {
      nomes = nomesDasObras(lerAba(conteudo, (abas) => abas.find((a) => a.trim().toLowerCase() === ABA_PEDIDOS.toLowerCase()) ?? null).linhas);
    } catch (error) {
      if (!(error instanceof ArquivoInvalidoError)) throw error;
    }
    if (leitura.precos.length === 0) throw new ArquivoRecusado(`A aba "${aba.nome}" não tem nenhuma linha de preço.`);
    await registrarProgresso(importacaoId, 50);

    const agora = new Date();
    const resultado = await prisma.$transaction(
      async (tx) => {
        const obras = new Map(leitura.precos.map((p) => [p.obra, nomes.get(p.obra) ?? null]));
        const { porCodigo, criadas, nomeadas } = await garantirObras(tx, obras);

        const linhas = await tx.linha.findMany({ where: { tipo: { in: ["PRODUTO", "OBRA"] } }, select: { id: true, tipo: true, nome: true, codigo: true } });
        // A LINHA da DRE mistura linhas de produto e de obra; produto tem precedência. Pelo Código ou pelo Nome da linha
        // (25/11/2026: o Código não muda; o Nome, sim), na forma do texto da planilha.
        const linhaPorCodigo = linhasPorChave([...linhas.filter((l) => l.tipo === "OBRA"), ...linhas.filter((l) => l.tipo === "PRODUTO")]);

        const vigentes = await tx.precoContrato.findMany({
          where: { substituidoEm: null },
          orderBy: [{ obra: { codigo: "asc" } }, { chave: "asc" }],
          select: { id: true, chave: true, atribuicao: true, unidade: true, fornecimento: true, valorUnitario: true, valorTotal: true, percentualRL: true, obra: { select: { codigo: true } }, contaResultado: true, linhaTexto: true, etapa: true },
        });
        const vigentePorChave = new Map(vigentes.map((v) => [v.chave, v]));

        const novos: PrecoLido[] = [];
        const alterados: Array<{ lido: PrecoLido; anterior: (typeof vigentes)[number] }> = [];
        let inalterados = 0;
        for (const p of leitura.precos) {
          const atual = vigentePorChave.get(p.chave);
          if (!atual) novos.push(p);
          else if (assinaturaDoPreco(atual) !== assinaturaDoPreco(p)) alterados.push({ lido: p, anterior: atual });
          else inalterados++;
        }
        const chavesLidas = new Set(leitura.precos.map((p) => p.chave));
        const removidos = vigentes.filter((v) => !chavesLidas.has(v.chave));

        const substituir = [...alterados.map((a) => a.anterior.id), ...removidos.map((r) => r.id)];
        for (let i = 0; i < substituir.length; i += LOTE) {
          await tx.precoContrato.updateMany({ where: { id: { in: substituir.slice(i, i + LOTE) } }, data: { substituidoEm: agora } });
        }
        const criar = [...novos, ...alterados.map((a) => a.lido)].map((p) => ({
          obraId: porCodigo.get(p.obra)!,
          versao: p.versao,
          chave: p.chave,
          etapa: p.etapa,
          linhaTexto: p.linhaTexto,
          linhaId: linhaPorCodigo.get(chaveDaLinha(p.linhaTexto))?.id ?? null,
          contaResultado: p.contaResultado,
          departamento: p.departamento,
          atribuicao: p.atribuicao,
          unidade: p.unidade,
          fornecimento: p.fornecimento,
          valorUnitario: p.valorUnitario,
          valorTotal: p.valorTotal,
          percentualRL: p.percentualRL,
          importacaoId,
          vigenteDesde: agora,
        }));
        for (let i = 0; i < criar.length; i += LOTE) {
          await tx.precoContrato.createMany({ data: criar.slice(i, i + LOTE) });
        }

        // Situação das obras diante do contrato: com preço vigente da versão 0,
        // OK; sem, SEM_CONTRATO — é o "X" da coluna de conferência da planilha.
        // As genéricas são valoradas por tabela e ficam como estão.
        const comContrato = (
          await tx.precoContrato.findMany({ where: { substituidoEm: null, versao: 0 }, distinct: ["obraId"], select: { obraId: true } })
        ).map((p) => p.obraId);
        await tx.obra.updateMany({ where: { generica: false, id: { in: comContrato } }, data: { situacaoCadastro: "OK" } });
        const { count: semContrato } = await tx.obra.updateMany({
          where: { generica: false, id: { notIn: comContrato } },
          data: { situacaoCadastro: "SEM_CONTRATO" },
        });

        const aditivos = [...new Set(leitura.precos.filter((p) => p.versao > 0).map((p) => p.obra))].sort();
        const resumo = {
          aba: aba.nome,
          obras: obras.size,
          obrasCriadas: criadas,
          obrasNomeadas: nomeadas,
          precos: { novos: novos.length, alterados: alterados.length, inalterados, removidos: removidos.length },
          alteracoes: alterados.slice(0, MAX_EXEMPLOS).map(({ lido, anterior }) => ({
            obra: lido.obra,
            etapa: lido.etapa,
            linha: lido.linhaTexto,
            conta: lido.contaResultado,
            departamento: lido.departamento,
            antes: { unitario: texto(anterior.valorUnitario), total: texto(anterior.valorTotal) },
            depois: { unitario: texto(lido.valorUnitario), total: texto(lido.valorTotal) },
          })),
          removidosExemplos: removidos.slice(0, MAX_EXEMPLOS).map((r) => ({ obra: r.obra.codigo, etapa: r.etapa, linha: r.linhaTexto, conta: r.contaResultado })),
          obrasComAditivo: aditivos,
          obrasRepetidas: [...leitura.obrasRepetidas].map(([obra, linhas]) => ({ obra, linhas })),
          obrasSemContrato: semContrato,
          ignoradas: leitura.ignoradas,
        };

        await tx.importacao.update({
          where: { id: importacaoId },
          data: {
            status: "CONCLUIDA",
            progresso: 100,
            linhasLidas: leitura.linhasLidas,
            linhasAceitas: leitura.precos.length,
            linhasRejeitadas: leitura.rejeicoes.length,
            linhasIgnoradas: leitura.ignoradas.vazias + leitura.ignoradas.repetidas + leitura.ignoradas.foraDoFiltro,
            relatorioErros: leitura.rejeicoes,
            resumo,
          },
        });
        // Os preços que saíram de vigência, para a detecção de divergência (Passo 24).
        const substituicoes: SubstituicaoPreco[] = [
          ...alterados.map((a) => ({ anteriorId: a.anterior.id, valorAnterior: a.anterior.valorUnitario, valorNovo: a.lido.valorUnitario })),
          ...removidos.map((r) => ({ anteriorId: r.id, valorAnterior: r.valorUnitario, valorNovo: null })),
        ];
        return { precos: resumo.precos, substituicoes };
      },
      { timeout: 120_000 },
    );
    logger("info", "DRE do Comercial importada", { importacaoId, ...resultado.precos });
    // Preço diferente do que valorou a receita de um mês apurado vira divergência;
    // o mês apurado não muda (Passo 24).
    try {
      const divergencias = await detectarPrecos(importacaoId, resultado.substituicoes);
      if (divergencias.length) {
        const atual = await prisma.importacao.findUniqueOrThrow({ where: { id: importacaoId }, select: { resumo: true } });
        await prisma.importacao.update({ where: { id: importacaoId }, data: { resumo: { ...((atual.resumo as Prisma.JsonObject | null) ?? {}), divergencias } } });
      }
    } catch (error) {
      logger("error", "Falha ao detectar divergências de preço", { importacaoId, error: error instanceof Error ? error.message : String(error) });
    }
  } catch (error) {
    if (error instanceof ArquivoRecusado || error instanceof ArquivoInvalidoError) {
      await recusarImportacao(importacaoId, error.message);
      return;
    }
    logger("error", "Falha ao processar a DRE do Comercial", {
      importacaoId,
      error: error instanceof Error ? error.message : String(error),
    });
    await recusarImportacao(
      importacaoId,
      "Erro inesperado no processamento. Nada foi gravado. Se persistir, encaminhe o arquivo ao responsável pelo sistema.",
    );
  }
}
