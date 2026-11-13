import { readFile } from "node:fs/promises";

import { getPrismaClient } from "../../../config/prisma.js";
import type { Prisma, PrismaClient } from "../../../generated/prisma/client.js";
import type { TipoImportacao } from "../../../generated/prisma/enums.js";
import { ArquivoInvalidoError, lerAba } from "../../../lib/xlsx.js";
import { logger } from "../../../utils/logger.js";
import { plural } from "../../../utils/plural.js";
import { somarTotais, type ItemVolume } from "../../volumes/totaisOperacao.js";
import { caminhoDoArquivo } from "../arquivosImportados.js";
import { escolherAba, recusarImportacao, registrarProgresso } from "../statusImportacao.js";
import { DEFINICOES_LISTAS, ehListaRateio, type TipoListaRateio } from "./definicoesListas.js";
import { DEFINICOES_LISTAS_RECEITA, ehListaReceita, type TipoListaReceita } from "./definicoesListasReceita.js";

/** As listas operacionais importadas por este processamento: as dos rateios e as da receita prévia. */
/**
 * O trecho do motivo da recusa do arquivo sem registros no mês (17/10/2026): o mês sem movimento daquela lista. Para o
 * fechamento, essa recusa conta como a lista entregue (apuracaoService.listasQueFaltam).
 */
export const SEM_REGISTROS_NO_MES = "não tem registros de";

export type TipoListaOperacional = TipoListaRateio | TipoListaReceita;

export function ehListaOperacional(tipo: TipoImportacao): tipo is TipoListaOperacional {
  return ehListaRateio(tipo) || ehListaReceita(tipo);
}
import type { RegistroLista } from "./leituraListas.js";
import { garantirObras } from "./obras.js";
import { chaveDaLinha } from "../../../lib/linhas.js";

export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const LOTE_GRAVACAO = 500;

/** Recusa do arquivo inteiro: nada é gravado. */
class ArquivoRecusado extends Error {}

/** Campos comuns a toda lista operacional, na forma do createMany. */
export type LinhaGravada = {
  competenciaId: string;
  /** Nulo quando o registro foi digitado. */
  importacaoId: string | null;
  unidadeNegocioId: string | null;
  obraId: string | null;
  linhaId?: string | null;
  quantidade: Prisma.Decimal;
  criadoPor: string;
  linhaArquivo: number | null;
  /** Mais os campos próprios da lista (RegistroLista.campos). */
  [campo: string]: unknown;
};

/**
 * O Prisma não tem um delegate genérico: cada lista é um modelo. As duas
 * operações que a importação faz — apagar o lote anterior e gravar o novo —
 * ficam aqui, uma por modelo.
 */
async function apagarLotes(tx: Tx, tipo: TipoListaOperacional, importacoes: string[]) {
  const where = { importacaoId: { in: importacoes } };
  switch (tipo) {
    case "PROJETO": return tx.projeto.deleteMany({ where });
    case "PRODUCAO": return tx.producao.deleteMany({ where });
    case "PRODUCAO_PISTA": return tx.producaoPista.deleteMany({ where });
    case "PRODUCAO_ARMADURA": return tx.producaoArmadura.deleteMany({ where });
    case "PRODUCAO_METALURGIA": return tx.producaoMetalurgia.deleteMany({ where });
    case "EXPEDICAO": return tx.expedicao.deleteMany({ where });
    case "MONTAGEM": return tx.montagem.deleteMany({ where });
    case "ACOMPANHAMENTO": return tx.acompanhamento.deleteMany({ where });
    case "DEVOLUCAO": return tx.devolucao.deleteMany({ where });
    case "SAIDA": return tx.saida.deleteMany({ where });
    case "MEDICAO": return tx.medicao.deleteMany({ where });
  }
}

export async function gravar(tx: Tx, tipo: TipoListaOperacional, dados: LinhaGravada[]) {
  switch (tipo) {
    case "PROJETO": return tx.projeto.createMany({ data: dados as Prisma.ProjetoCreateManyInput[] });
    case "PRODUCAO": return tx.producao.createMany({ data: dados as Prisma.ProducaoCreateManyInput[] });
    case "PRODUCAO_PISTA": return tx.producaoPista.createMany({ data: dados as Prisma.ProducaoPistaCreateManyInput[] });
    case "PRODUCAO_ARMADURA": return tx.producaoArmadura.createMany({ data: dados as Prisma.ProducaoArmaduraCreateManyInput[] });
    case "PRODUCAO_METALURGIA": return tx.producaoMetalurgia.createMany({ data: dados as Prisma.ProducaoMetalurgiaCreateManyInput[] });
    case "EXPEDICAO": return tx.expedicao.createMany({ data: dados as Prisma.ExpedicaoCreateManyInput[] });
    case "MONTAGEM": return tx.montagem.createMany({ data: dados as Prisma.MontagemCreateManyInput[] });
    case "ACOMPANHAMENTO": return tx.acompanhamento.createMany({ data: dados as Prisma.AcompanhamentoCreateManyInput[] });
    case "DEVOLUCAO": return tx.devolucao.createMany({ data: dados as Prisma.DevolucaoCreateManyInput[] });
    case "SAIDA": return tx.saida.createMany({ data: dados as Prisma.SaidaCreateManyInput[] });
    case "MEDICAO": return tx.medicao.createMany({ data: dados as Prisma.MedicaoCreateManyInput[] });
  }
}

/** Listas com tipo de movimento: o código vira o vínculo com o cadastro, quando existe. */
const COM_MOVIMENTO = new Set<TipoListaOperacional>(["DEVOLUCAO", "SAIDA"]);

/**
 * Registros lidos → linhas prontas para o createMany: resolve unidade, linha e
 * obra (cadastrando as obras novas). Serve à importação e à digitação.
 */
export async function prepararGravacao(
  tx: Tx,
  tipo: TipoListaOperacional,
  registros: RegistroLista[],
  contexto: { competenciaId: string; importacaoId: string | null; criadoPor: string },
): Promise<{ dados: LinhaGravada[]; obrasCriadas: number; linhasInativas: Array<{ nome: string; registros: number }> }> {
  const [unidades, linhas, movimentos] = await Promise.all([
    tx.unidadeNegocio.findMany({ select: { id: true, codigo: true } }),
    tx.linha.findMany({ select: { id: true, tipo: true, nome: true, ativo: true } }),
    COM_MOVIMENTO.has(tipo) ? tx.tipoMovimento.findMany({ select: { id: true, codigo: true } }) : [],
  ]);
  const movimentoPorCodigo = new Map(movimentos.map((m) => [m.codigo, m.id]));
  const unidadePorCodigo = new Map(unidades.map((u) => [u.codigo, u.id]));
  // A linha pelo Nome do cadastro (11/10/2026), na mesma forma do texto da planilha (chaveDaLinha).
  const linhaPorChave = new Map(linhas.map((l) => [`${l.tipo}|${chaveDaLinha(l.nome)}`, l.id]));
  // Todas as listas têm a linha (a metalurgia desde 09/10/2026).
  const temLinha = true;

  const obrasCitadas = new Map<string, string | null>();
  for (const r of registros) {
    // O nome da primeira linha que trouxer um (a primeira pode vir sem nome).
    if (r.obra && !obrasCitadas.get(r.obra.codigo)) obrasCitadas.set(r.obra.codigo, r.obra.nome ?? null);
  }
  const { porCodigo, criadas } = await garantirObras(tx, obrasCitadas);

  const dados = registros.map((r) => ({
    competenciaId: contexto.competenciaId,
    importacaoId: contexto.importacaoId,
    unidadeNegocioId: r.unidade ? (unidadePorCodigo.get(r.unidade) ?? null) : null,
    obraId: r.obra ? (porCodigo.get(r.obra.codigo) ?? null) : null,
    ...(temLinha
      ? { linhaId: r.linha ? (linhaPorChave.get(`${r.linha.tipo}|${chaveDaLinha(r.linha.codigo)}`) ?? null) : null }
      : {}),
    quantidade: r.quantidade,
    criadoPor: contexto.criadoPor,
    linhaArquivo: contexto.importacaoId ? r.linhaArquivo : null,
    ...r.campos,
    ...(COM_MOVIMENTO.has(tipo)
      ? { tipoMovimentoId: movimentoPorCodigo.get(String(r.campos.movimento ?? "")) ?? null }
      : {}),
  }));
  // As linhas inativas no cadastro que a lista ainda cita (26/10/2026: a Metalúrgica): o registro fica com elas, e a
  // importação avisa, para corrigir a lista.
  const inativas = new Map(linhas.filter((l) => !l.ativo).map((l) => [l.id, l.nome]));
  const citadas = new Map<string, number>();
  for (const d of dados) if (d.linhaId && inativas.has(d.linhaId)) citadas.set(d.linhaId, (citadas.get(d.linhaId) ?? 0) + 1);
  return { dados, obrasCriadas: criadas, linhasInativas: [...citadas].map(([id, registros]) => ({ nome: inativas.get(id)!, registros })) };
}

/** O que a regra dos Totais precisa de cada registro lido. */
export function itemDoRegistro(tipo: TipoListaRateio, r: RegistroLista): ItemVolume {
  return {
    tipo,
    quantidade: r.quantidade,
    unidade: r.unidade,
    linha: r.linha?.codigo ?? null,
    obraGlobal: r.obra?.codigo.toUpperCase().startsWith("G") ?? false,
    finalidade: (r.campos.finalidade as string | null | undefined) ?? null,
    categoria: (r.campos.categoria as string | null | undefined) ?? null,
    etapa: (r.campos.etapa as string | null | undefined) ?? null,
  };
}

export async function processarLista(importacaoId: string): Promise<void> {
  const prisma = getPrismaClient();

  try {
    const importacao = await prisma.importacao.findUniqueOrThrow({
      where: { id: importacaoId },
      include: { competencia: { select: { id: true, ano: true, mes: true } } },
    });
    const { competencia, tipo } = importacao;
    if (!ehListaOperacional(tipo)) throw new Error(`Tipo ${tipo} não é lista operacional`);
    const def = ehListaRateio(tipo) ? DEFINICOES_LISTAS[tipo] : DEFINICOES_LISTAS_RECEITA[tipo];
    const mesAno = `${String(competencia.mes).padStart(2, "0")}/${competencia.ano}`;

    const conteudo = await readFile(caminhoDoArquivo(importacao.hashArquivo));
    const aba = lerAba(conteudo, escolherAba(def.abas));
    await registrarProgresso(importacaoId, 30);

    const leitura = def.interpretar(aba.linhas, competencia.ano, competencia.mes);
    if (!leitura.ok) throw new ArquivoRecusado(leitura.motivo);
    const linhasIgnoradas = leitura.ignoradas.vazias + leitura.ignoradas.outrosMeses + (leitura.ignoradas.semEfeito ?? 0);
    if (leitura.registros.length === 0 && leitura.rejeicoes.length === 0) {
      await recusarImportacao(
        importacaoId,
        `A aba "${aba.nome}" ${SEM_REGISTROS_NO_MES} ${mesAno}.`,
        { linhasLidas: leitura.linhasLidas, linhasIgnoradas },
      );
      return;
    }
    await registrarProgresso(importacaoId, 50);

    // Listas dos rateios: as linhas da aba Totais que alimentam. Listas da
    // receita: os totais por unidade, para conferir com as abas de resumo.
    const totais = ehListaRateio(tipo)
      ? somarTotais(leitura.registros.map((r) => itemDoRegistro(tipo, r)), [tipo]).map((t) => ({ ...t, quantidade: t.quantidade.toFixed(3) }))
      : DEFINICOES_LISTAS_RECEITA[tipo].totalizar(leitura.registros);

    const { substituidas, obrasCriadas } = await prisma.$transaction(
      async (tx) => {
        const atual = await tx.competencia.findUniqueOrThrow({
          where: { id: competencia.id },
          select: { status: true },
        });
        if (atual.status === "FECHADA") {
          throw new ArquivoRecusado("A competência foi fechada enquanto o arquivo era processado. Nada foi gravado.");
        }

        const anteriores = await tx.importacao.findMany({
          where: { competenciaId: competencia.id, tipo, status: "CONCLUIDA", substituidaEm: null, id: { not: importacaoId } },
          select: { id: true },
        });
        const ids = anteriores.map((a) => a.id);
        if (ids.length > 0) {
          await apagarLotes(tx, tipo, ids);
          await tx.importacao.updateMany({ where: { id: { in: ids } }, data: { substituidaEm: new Date() } });
        }

        const { dados, obrasCriadas: criadas, linhasInativas } = await prepararGravacao(tx, tipo, leitura.registros, {
          competenciaId: competencia.id,
          importacaoId,
          criadoPor: importacao.importadoPor,
        });
        for (let i = 0; i < dados.length; i += LOTE_GRAVACAO) {
          await gravar(tx, tipo, dados.slice(i, i + LOTE_GRAVACAO));
        }

        await tx.importacao.update({
          where: { id: importacaoId },
          data: {
            status: "CONCLUIDA",
            progresso: 100,
            linhasLidas: leitura.linhasLidas,
            linhasAceitas: leitura.registros.length,
            linhasRejeitadas: leitura.rejeicoes.length,
            linhasIgnoradas,
            relatorioErros: leitura.rejeicoes,
            resumo: {
              aba: aba.nome,
              lista: def.rotulo,
              registros: leitura.registros.length,
              ignoradas: leitura.ignoradas,
              totais,
              receita: ehListaReceita(tipo),
              obrasCriadas: criadas,
              avisos: [
                ...leitura.avisos,
                ...linhasInativas.map(
                  (l) =>
                    `${l.registros} ${plural(l.registros, "registro cita", "registros citam")} a linha ${l.nome}, inativa em Cadastros Gerais › Linhas: corrija a linha na lista e importe de novo.`,
                ),
              ],
              substituiu: ids,
            },
          },
        });
        return { substituidas: ids.length, obrasCriadas: criadas };
      },
      { timeout: 120_000 },
    );

    logger("info", "Lista operacional importada", {
      importacaoId,
      tipo,
      competencia: mesAno,
      registros: leitura.registros.length,
      rejeitadas: leitura.rejeicoes.length,
      obrasCriadas,
      substituidas,
    });
  } catch (error) {
    if (error instanceof ArquivoRecusado || error instanceof ArquivoInvalidoError) {
      await recusarImportacao(importacaoId, error.message);
      return;
    }
    logger("error", "Falha ao processar lista operacional", {
      importacaoId,
      error: error instanceof Error ? error.message : String(error),
    });
    await recusarImportacao(
      importacaoId,
      "Erro inesperado no processamento. Nada foi gravado. Se persistir, encaminhe o arquivo ao responsável pelo sistema.",
    );
  }
}
