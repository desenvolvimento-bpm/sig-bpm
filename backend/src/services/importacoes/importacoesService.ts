import { createHash } from "node:crypto";
import { mkdir, writeFile, access, readFile } from "node:fs/promises";

import { getPrismaClient } from "../../config/prisma.js";
import type { TipoImportacao } from "../../generated/prisma/enums.js";
import { enfileirar } from "../../lib/filaProcessamento.js";
import { caminhoDoArquivo, diretorioUploads } from "./arquivosImportados.js";
import { processarBalancete } from "./balancete/processarBalancete.js";
import { processarDreComercial } from "./dreComercial/processarDreComercial.js";
import { processarEstoqueInicial } from "./estoqueInicial/processarEstoqueInicial.js";
import { DEFINICOES_INDICADORES, ehTipoIndicadores } from "./indicadores/leituraIndicadores.js";
import { processarIndicadores } from "./indicadores/processarIndicadores.js";
import { DEFINICOES_DOCUMENTOS, ehTipoDocumentos } from "./documentos/leituraDocumentos.js";
import { processarDocumentos } from "./documentos/processarDocumentos.js";
import { processarLotacao } from "./lotacao/processarLotacao.js";
import { processarCreditos } from "./impostos/processarCreditos.js";
import { DEFINICOES_LISTAS } from "./listas/definicoesListas.js";
import { DEFINICOES_LISTAS_RECEITA } from "./listas/definicoesListasReceita.js";
import { ehListaOperacional, processarLista } from "./listas/processarLista.js";
import { auditar } from "../auditoriaService.js";
import { ArquivoInvalidoError } from "../../lib/xlsx.js";
import { analisarArquivo } from "./analiseArquivo.js";

/**
 * Erro de regra da importação, com o status HTTP que o controller devolve.
 * `codigo` permite à tela reagir a um caso específico — o arquivo repetido
 * pede confirmação, os demais só mostram a mensagem.
 */
export class RegraImportacaoError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
    readonly codigo?: string,
    readonly detalhes?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/**
 * Tipos com processamento implementado: o balancete, as listas que alimentam
 * os rateios, as que alimentam só a receita prévia, a DRE do Comercial, o
 * saldo inicial do estoque e os indicadores do Administrativo e do Comercial.
 */
const TIPOS_DISPONIVEIS: TipoImportacao[] = [
  "BALANCETE",
  "DRE_COMERCIAL",
  "ESTOQUE_INICIAL",
  // As metas do orçamento (aba Metas (Orçamento)) não se importam mais no mês: ficam nos cenários (11/10/2026).
  ...(Object.keys(DEFINICOES_INDICADORES) as TipoImportacao[]).filter((t) => t !== "METAS_ORCAMENTO"),
  ...(Object.keys(DEFINICOES_LISTAS) as TipoImportacao[]),
  ...(Object.keys(DEFINICOES_LISTAS_RECEITA) as TipoImportacao[]),
  // As requisições e as notas fiscais do mês (11/10/2026): o extrato das contas na DRE.
  ...(Object.keys(DEFINICOES_DOCUMENTOS) as TipoImportacao[]),
  // Os colaboradores do mês por centro de custo (19/10/2026).
  "QUADRO_LOTACAO",
  // Os Créditos de Impostos do mês (04/11/2026).
  "CREDITOS_IMPOSTOS",
];

function rotulo(ano: number, mes: number) {
  return `${String(mes).padStart(2, "0")}/${ano}`;
}

async function competenciaPorAnoMes(ano: number, mes: number) {
  const competencia = await getPrismaClient().competencia.findUnique({
    where: { ano_mes: { ano, mes } },
    select: { id: true, ano: true, mes: true, status: true },
  });
  if (!competencia) {
    throw new RegraImportacaoError(
      404,
      `A competência ${rotulo(ano, mes)} não existe. Abra-a antes de importar.`,
    );
  }
  return competencia;
}

export type ReceberImportacaoInput = {
  ano: number;
  mes: number;
  tipo: TipoImportacao;
  nomeArquivo: string;
  conteudo: Buffer;
  usuarioId: string;
  /** Confirma a importação de um arquivo idêntico a um já importado. */
  forcar: boolean;
  /** Importação em lote: a competência (aaaa-mm) em que o arquivo foi enviado, quando é outra. */
  enviadaDe?: string;
};

const CAMPOS_RESUMO = {
  id: true,
  tipo: true,
  nomeArquivo: true,
  importadoEm: true,
  status: true,
  progresso: true,
  linhasLidas: true,
  linhasAceitas: true,
  linhasRejeitadas: true,
  linhasIgnoradas: true,
  motivoRejeicao: true,
  substituidaEm: true,
  comparacao: true,
  usuario: { select: { nome: true } },
} as const;

/** As prévias do lote, por competência e hash do arquivo, para o "Importar" não refazer a leitura. */
const previas = new Map<string, { em: number; analise: Awaited<ReturnType<typeof analisarArquivo>> }>();

export const importacoesService = {
  async receber(input: ReceberImportacaoInput) {
    const prisma = getPrismaClient();

    if (input.tipo === "METAS_ORCAMENTO") {
      throw new RegraImportacaoError(
        400,
        "As metas do orçamento não se importam mais no mês: importe a aba Metas (Orçamento) num cenário (Criação de Cenários / Cenários Sintéticos) e marque-o como Orçamento.",
      );
    }
    if (!TIPOS_DISPONIVEIS.includes(input.tipo)) {
      throw new RegraImportacaoError(
        400,
        `A importação do tipo ${input.tipo} ainda não está disponível.`,
      );
    }
    if (input.conteudo.length === 0) {
      throw new RegraImportacaoError(400, "O arquivo enviado está vazio.");
    }

    const competencia = await competenciaPorAnoMes(input.ano, input.mes);
    // Balancete de competência fechada (Passo 24): é recebido só para comparar
    // com o gravado; as diferenças viram divergências e nada é substituído.
    const comparacao = competencia.status === "FECHADA" && input.tipo === "BALANCETE";
    if (competencia.status === "FECHADA" && !comparacao) {
      throw new RegraImportacaoError(
        409,
        `A competência ${rotulo(input.ano, input.mes)} está fechada. ` +
          "Importar nela exige reabri-la.",
        "COMPETENCIA_FECHADA",
      );
    }

    const emAndamento = await prisma.importacao.findFirst({
      where: {
        competenciaId: competencia.id,
        tipo: input.tipo,
        status: "PROCESSANDO",
      },
      select: { id: true },
    });
    if (emAndamento) {
      throw new RegraImportacaoError(
        409,
        "Já há uma importação deste tipo em processamento nesta competência. " +
          "Aguarde ela terminar.",
        "IMPORTACAO_EM_ANDAMENTO",
        { importacaoId: emAndamento.id },
      );
    }

    // O hash identifica o arquivo repetido DENTRO da competência. O mesmo
    // arquivo do balancete traz o exercício inteiro e é legitimamente
    // importado em janeiro, em fevereiro e assim por diante.
    const hash = createHash("sha256").update(input.conteudo).digest("hex");
    if (!input.forcar && !comparacao) {
      const repetida = await prisma.importacao.findFirst({
        where: {
          competenciaId: competencia.id,
          tipo: input.tipo,
          hashArquivo: hash,
          status: "CONCLUIDA",
          substituidaEm: null,
        },
        select: CAMPOS_RESUMO,
      });
      if (repetida) {
        throw new RegraImportacaoError(
          409,
          `Este arquivo já foi importado nesta competência em ` +
            `${repetida.importadoEm.toLocaleString("pt-BR")}` +
            (repetida.usuario ? ` por ${repetida.usuario.nome}` : "") +
            (input.tipo === "DRE_COMERCIAL"
              ? ". Importar de novo não muda nenhum preço."
              : ". Importar de novo substitui o lote atual pelo mesmo conteúdo."),
          "ARQUIVO_JA_IMPORTADO",
          { importacao: repetida },
        );
      }
    }

    // O arquivo é guardado pelo hash: é a prova do que foi importado.
    await mkdir(diretorioUploads(), { recursive: true });
    const caminho = caminhoDoArquivo(hash);
    try {
      await access(caminho);
    } catch {
      await writeFile(caminho, input.conteudo);
    }

    const importacao = await prisma.importacao.create({
      data: {
        competenciaId: competencia.id,
        tipo: input.tipo,
        nomeArquivo: input.nomeArquivo,
        hashArquivo: hash,
        importadoPor: input.usuarioId,
        comparacao,
        enviadaDe: input.enviadaDe ?? null,
      },
      select: CAMPOS_RESUMO,
    });

    enfileirar(`importação ${importacao.id}`, async () => {
      try {
        await (ehListaOperacional(importacao.tipo)
          ? processarLista(importacao.id)
          : importacao.tipo === "DRE_COMERCIAL"
            ? processarDreComercial(importacao.id)
            : importacao.tipo === "ESTOQUE_INICIAL"
              ? processarEstoqueInicial(importacao.id)
              : ehTipoIndicadores(importacao.tipo)
                ? processarIndicadores(importacao.id)
                : ehTipoDocumentos(importacao.tipo)
                  ? processarDocumentos(importacao.id)
                  : importacao.tipo === "QUADRO_LOTACAO"
                    ? processarLotacao(importacao.id)
                    : importacao.tipo === "CREDITOS_IMPOSTOS"
                      ? processarCreditos(importacao.id)
                      : processarBalancete(importacao.id));
      } finally {
        // Auditoria (Passo 23): o arquivo, o que ele substituiu e o resultado do processamento.
        const fim = await getPrismaClient().importacao.findUnique({
          where: { id: importacao.id },
          select: { status: true, linhasLidas: true, linhasAceitas: true, linhasRejeitadas: true, linhasIgnoradas: true, motivoRejeicao: true },
        });
        const substituida = await getPrismaClient().importacao.findFirst({
          where: { competenciaId: competencia.id, tipo: input.tipo, substituidaEm: { not: null }, id: { not: importacao.id } },
          orderBy: { substituidaEm: "desc" },
          select: { id: true, nomeArquivo: true, importadoEm: true },
        });
        await auditar({
          usuarioId: input.usuarioId,
          acao: "IMPORTACAO",
          entidade: "importacao",
          entidadeId: importacao.id,
          antes: fim?.status === "CONCLUIDA" && substituida ? { substituiu: substituida } : undefined,
          depois: fim,
          metadados: { competencia: rotulo(input.ano, input.mes), tipo: input.tipo, arquivo: input.nomeArquivo, hash, forcar: !!input.forcar },
        });
      }
    });

    return importacao;
  },

  /**
   * Importação em lote, passo 1: guarda o arquivo (pelo hash) e devolve a
   * prévia — as abas reconhecidas e, em cada uma, o que fazer no mês do envio
   * e nos meses anteriores do ano (analisarArquivo). Nada é importado. Com
   * `tipo` (o Importar da linha do tipo), só a aba dele.
   */
  async analisarLote(input: { ano: number; mes: number; nomeArquivo: string; conteudo: Buffer; alcanca: (tipo: TipoImportacao) => boolean; tipo?: TipoImportacao }) {
    if (input.conteudo.length === 0) throw new RegraImportacaoError(400, "O arquivo enviado está vazio.");
    const competencia = await competenciaPorAnoMes(input.ano, input.mes);
    let analise: Awaited<ReturnType<typeof analisarArquivo>>;
    try {
      analise = await analisarArquivo(input.conteudo, competencia, input.alcanca, undefined, input.tipo);
    } catch (error) {
      if (error instanceof ArquivoInvalidoError) throw new RegraImportacaoError(400, error.message);
      throw error;
    }
    const hash = createHash("sha256").update(input.conteudo).digest("hex");
    await mkdir(diretorioUploads(), { recursive: true });
    const caminho = caminhoDoArquivo(hash);
    try {
      await access(caminho);
    } catch {
      await writeFile(caminho, input.conteudo);
    }
    previas.set(`${competencia.id}|${hash}|${input.tipo ?? ""}`, { em: Date.now(), analise });
    return { hash, nomeArquivo: input.nomeArquivo, ...analise };
  },

  /**
   * Importação em lote, passo 2 (o usuário confirmou): relê o arquivo guardado,
   * refaz a prévia e põe na fila, uma por vez, cada mês a importar (ou, em mês
   * fechado, a comparar). Os meses anteriores ficam marcados com a competência
   * do envio (enviadaDe), para a sinalização. Um mês com erro não impede os outros.
   *
   * `reimportar` (11/10/2026): o arquivo é igual ao importado, e o usuário quer importá-lo assim mesmo (por exemplo,
   * para a importação gravar algo que antes não lia, como o nome das obras da aba Pedidos). Entram também os meses
   * sem mudança do mês do envio (os anteriores ficam como estão, para não pedirem reapuração à toa).
   *
   * `tipo`: o da prévia do Importar da linha do tipo; só a aba dele entra.
   */
  async importarLote(input: {
    ano: number;
    mes: number;
    hash: string;
    nomeArquivo: string;
    usuarioId: string;
    alcanca: (tipo: TipoImportacao) => boolean;
    reimportar?: boolean;
    tipo?: TipoImportacao;
  }) {
    const origem = await competenciaPorAnoMes(input.ano, input.mes);
    let conteudo: Buffer;
    try {
      conteudo = await readFile(caminhoDoArquivo(input.hash));
    } catch {
      throw new RegraImportacaoError(404, "O arquivo analisado não foi encontrado. Escolha o arquivo de novo.");
    }
    // A prévia que o usuário acabou de ver (até 10 minutos); senão, refeita.
    const chave = `${origem.id}|${input.hash}|${input.tipo ?? ""}`;
    const guardada = previas.get(chave);
    previas.delete(chave);
    let analise: Awaited<ReturnType<typeof analisarArquivo>>;
    try {
      analise = guardada && Date.now() - guardada.em < 10 * 60_000 ? guardada.analise : await analisarArquivo(conteudo, origem, input.alcanca, undefined, input.tipo);
    } catch (error) {
      // Como na prévia: o arquivo que não se lê (ou sem a aba do tipo) vira mensagem.
      if (error instanceof ArquivoInvalidoError) throw new RegraImportacaoError(400, error.message);
      throw error;
    }
    const anoMesOrigem = `${input.ano}-${String(input.mes).padStart(2, "0")}`;
    type MesImportado = (typeof analise.abas)[number]["meses"][number] & { importacaoId?: string; erro?: string };
    const abas = [];
    for (const a of analise.abas) {
      const meses: MesImportado[] = [];
      for (const m of a.meses) {
        const reimporta = !!input.reimportar && m.acao === "SEM_MUDANCA" && m.atual;
        if (m.acao !== "IMPORTAR" && m.acao !== "COMPARAR" && !reimporta) {
          meses.push(m);
          continue;
        }
        const [ano, mes] = m.anoMes.split("-").map(Number);
        try {
          const imp = await this.receber({
            ano,
            mes,
            tipo: a.tipo,
            nomeArquivo: input.nomeArquivo,
            conteudo,
            usuarioId: input.usuarioId,
            // A prévia já decidiu pelo conteúdo do mês: o hash repetido não bloqueia.
            forcar: true,
            enviadaDe: m.atual ? undefined : anoMesOrigem,
          });
          meses.push({ ...m, acao: reimporta ? "IMPORTAR" : m.acao, importacaoId: imp.id });
        } catch (error) {
          if (!(error instanceof RegraImportacaoError)) throw error;
          meses.push({ ...m, erro: error.message });
        }
      }
      abas.push({ ...a, meses });
    }
    return { hash: input.hash, nomeArquivo: input.nomeArquivo, abas, outras: analise.outras };
  },

  async listar(ano: number, mes: number) {
    const competencia = await competenciaPorAnoMes(ano, mes);
    const itens = await getPrismaClient().importacao.findMany({
      where: { competenciaId: competencia.id },
      orderBy: { importadoEm: "desc" },
      select: CAMPOS_RESUMO,
    });
    // A primeira competência do SIG (06/11/2026): só nela a tela mostra o Saldo Inicial do Estoque.
    const primeira = await getPrismaClient().competencia.findFirst({ orderBy: [{ ano: "asc" }, { mes: "asc" }], select: { id: true } });
    return { competencia, itens, primeira: primeira?.id === competencia.id };
  },

  async detalhar(id: string) {
    const importacao = await getPrismaClient().importacao.findUnique({
      where: { id },
      select: {
        ...CAMPOS_RESUMO,
        hashArquivo: true,
        relatorioErros: true,
        resumo: true,
        competencia: { select: { ano: true, mes: true, status: true } },
      },
    });
    if (!importacao) {
      throw new RegraImportacaoError(404, "Importação não encontrada.");
    }
    return importacao;
  },

  /**
   * Ao subir o servidor: o que estava em PROCESSANDO foi interrompido pelo
   * reinício e nunca vai terminar. Marcar como recusado libera a competência
   * para uma nova importação — nada foi gravado, a gravação é transacional.
   */
  async recuperarInterrompidas() {
    const { count } = await getPrismaClient().importacao.updateMany({
      where: { status: "PROCESSANDO" },
      data: {
        status: "REJEITADA",
        progresso: 100,
        motivoRejeicao:
          "O processamento foi interrompido por um reinício do servidor. " +
          "Nada foi gravado; envie o arquivo de novo.",
      },
    });
    return count;
  },
};
