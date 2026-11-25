import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";

import { getPrismaClient } from "../../../config/prisma.js";
import { lerAba } from "../../../lib/xlsx.js";
import { auditar } from "../../auditoriaService.js";
import { IND, nomeDo } from "../../relatorios/indicadoresDoSistema.js";
import { caminhoDoArquivo, diretorioUploads } from "../arquivosImportados.js";
import { ABA_LOTACAO, lerLotacao } from "./leituraLotacao.js";
import { gravarLotacaoDoMes, resumoDaLotacao } from "./processarLotacao.js";

const rotulo = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;

export type CargaDoMes = {
  competencia: string;
  status: string;
  situacao: "CARREGADO" | "SIMULADO" | "RECUSADO";
  motivo?: string;
  centros: number;
  clt: number;
  pj: number;
  total: number;
  /** O Quadro de Lotação Total importado da aba Indicadores (Admin.), que não muda (só para comparar). */
  indicadorTotal: number | null;
  /** A importação do quadro de lotação que a carga substituiu, quando havia. */
  substituiu: number;
};

/**
 * A carga retroativa da aba Quadro de Lotação (19/10/2026) nos meses já fechados, sem reabri-los: a importação comum
 * recusa competência fechada. Para cada mês, lê a aba e, com `gravar`, grava a lista numa transação com uma importação
 * CONCLUIDA (resumo.modo CARGA_RETROATIVA), substituindo a anterior do tipo. O estado da competência, a apuração, o
 * retrato das entradas (o tipo fica fora da apuração) e os indicadores de quadro de lotação (aba Indicadores (Admin.))
 * não mudam. O arquivo fica guardado pelo hash, como os importados: a próxima importação em lote o compara pelo conteúdo.
 */
export async function carregarLotacaoRetroativa(opcoes: {
  conteudo: Uint8Array;
  nomeArquivo: string;
  ano: number;
  meses: number[];
  usuario: { id: string; nome: string };
  gravar: boolean;
}): Promise<CargaDoMes[]> {
  const prisma = getPrismaClient();
  const aba = lerAba(opcoes.conteudo, (abas) => abas.find((a) => a.normalize("NFC").trim() === ABA_LOTACAO.normalize("NFC")) ?? null);
  const hash = createHash("sha256").update(opcoes.conteudo).digest("hex");
  if (opcoes.gravar) {
    await mkdir(diretorioUploads(), { recursive: true });
    try {
      await access(caminhoDoArquivo(hash));
    } catch {
      await writeFile(caminhoDoArquivo(hash), opcoes.conteudo);
    }
  }
  const resultados: CargaDoMes[] = [];
  for (const mes of opcoes.meses) {
    const competencia = await prisma.competencia.findUnique({ where: { ano_mes: { ano: opcoes.ano, mes } }, select: { id: true, status: true } });
    const base = { competencia: rotulo(opcoes.ano, mes), status: competencia?.status ?? "—", centros: 0, clt: 0, pj: 0, total: 0, indicadorTotal: null, substituiu: 0 };
    if (!competencia) {
      resultados.push({ ...base, situacao: "RECUSADO", motivo: "a competência não existe" });
      continue;
    }
    const leitura = lerLotacao(aba.linhas, opcoes.ano, mes);
    if (!leitura.ok) {
      resultados.push({ ...base, situacao: "RECUSADO", motivo: leitura.motivo });
      continue;
    }
    if (leitura.rejeicoes.length) {
      resultados.push({ ...base, situacao: "RECUSADO", motivo: leitura.rejeicoes.map((r) => `linha ${r.linha}: ${r.mensagem}`).join("; ") });
      continue;
    }
    if (!leitura.itens.length) {
      resultados.push({ ...base, situacao: "RECUSADO", motivo: "a aba não tem linhas do mês" });
      continue;
    }
    const resumo = resumoDaLotacao(aba.nome, leitura);
    const indicador = await prisma.indicadorImportado.findFirst({
      // Pelo ID do indicador (25/11/2026: os valores guardam o ID; o nome, numa base sem ele).
      where: { competenciaId: competencia.id, indicador: { in: [IND.QUADRO_TOTAL, nomeDo(IND.QUADRO_TOTAL)] }, importacao: { status: "CONCLUIDA", substituidaEm: null } },
      select: { valor: true },
    });
    const anteriores = await prisma.importacao.count({ where: { competenciaId: competencia.id, tipo: "QUADRO_LOTACAO", status: "CONCLUIDA", substituidaEm: null } });
    const r: CargaDoMes = {
      ...base,
      situacao: opcoes.gravar ? "CARREGADO" : "SIMULADO",
      centros: resumo.centros,
      clt: resumo.clt,
      pj: resumo.pj,
      total: resumo.total,
      indicadorTotal: indicador ? Number(indicador.valor) : null,
      substituiu: anteriores,
    };
    resultados.push(r);
    if (!opcoes.gravar) continue;

    await prisma.$transaction(
      async (tx) => {
        const importacao = await tx.importacao.create({
          data: {
            competenciaId: competencia.id,
            tipo: "QUADRO_LOTACAO",
            nomeArquivo: opcoes.nomeArquivo,
            hashArquivo: hash,
            importadoPor: opcoes.usuario.id,
            status: "CONCLUIDA",
            progresso: 100,
            linhasLidas: leitura.itens.length + leitura.zerados,
            linhasAceitas: leitura.itens.length,
            linhasRejeitadas: 0,
            linhasIgnoradas: leitura.zerados + leitura.foraDoMes,
            relatorioErros: [],
            resumo: resumoDaLotacao(aba.nome, leitura, { modo: "CARGA_RETROATIVA", statusDaCompetencia: competencia.status }),
          },
          select: { id: true },
        });
        await gravarLotacaoDoMes(tx, competencia.id, importacao.id, leitura.itens);
      },
      { timeout: 120_000 },
    );
    await auditar({
      usuarioId: opcoes.usuario.id,
      usuarioNome: opcoes.usuario.nome,
      acao: "IMPORTACAO",
      entidade: "competencia",
      entidadeId: `${opcoes.ano}-${String(mes).padStart(2, "0")}`,
      metadados: { quadroDeLotacao: "carga retroativa, sem reabrir nem recalcular", arquivo: opcoes.nomeArquivo, status: competencia.status, centros: r.centros, total: r.total },
    });
  }
  return resultados;
}
