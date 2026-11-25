import { getPrismaClient } from "../../config/prisma.js";
import { auditar } from "../auditoriaService.js";
import { catalogoDeIndicadores } from "../relatorios/catalogoIndicadores.js";
import { RegraListaError } from "./listasService.js";
import { indicadoresParaReferencias, nomeDaReferencia, referenciaDoNome } from "../relatorios/referenciasDosIndicadores.js";

/**
 * As abas Comercial e Administrativo das Listas: os indicadores numerados do
 * grupo (os da aba Realizado (SIG) do INDICADORES DE RESULTADO), com o valor
 * do mês importado das abas Indicadores (Comercial) e Indicadores (Admin.) ou
 * digitado na própria aba ("Novo Registro"), que sobrepõe o importado. Uma
 * nova importação da aba volta a valer sobre o digitado.
 */
export const SETORES_INDICADORES = {
  comercial: { grupo: "Comercial", tipo: "INDICADORES_COMERCIAL" },
  administrativo: { grupo: "Administrativo", tipo: "INDICADORES_ADMIN" },
} as const;

export type SetorIndicadores = keyof typeof SETORES_INDICADORES;

export const ehSetorIndicadores = (s: string): s is SetorIndicadores => s in SETORES_INDICADORES;

const rotulo = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;

/** Os indicadores numerados do grupo, do cadastro Estrutura dos Indicadores. */
const doSetor = async (setor: SetorIndicadores) => (await catalogoDeIndicadores()).filter((i) => i.grupo === SETORES_INDICADORES[setor].grupo && i.numero !== "");

async function competencia(ano: number, mes: number) {
  const c = await getPrismaClient().competencia.findUnique({ where: { ano_mes: { ano, mes } }, select: { id: true, ano: true, mes: true, status: true } });
  if (!c) throw new RegraListaError(404, `A competência ${rotulo(ano, mes)} não existe.`);
  return c;
}

export async function indicadoresDaLista(setor: SetorIndicadores, ano: number, mes: number) {
  const prisma = getPrismaClient();
  const c = await competencia(ano, mes);
  const lista = await doSetor(setor);
  // Os valores guardam o ID do indicador (25/11/2026): a lista e as telas, o nome.
  const referencias = await indicadoresParaReferencias(prisma);
  const refs = lista.map((i) => referenciaDoNome(i.nome, referencias));
  const [importacao, digitados] = await Promise.all([
    prisma.importacao.findFirst({
      where: { competenciaId: c.id, tipo: SETORES_INDICADORES[setor].tipo, status: "CONCLUIDA", substituidaEm: null },
      orderBy: { importadoEm: "desc" },
      select: { nomeArquivo: true, importadoEm: true, indicadores: { select: { indicador: true, valor: true } } },
    }),
    prisma.indicadorDigitado.findMany({ where: { competenciaId: c.id, indicador: { in: refs } }, select: { indicador: true, valor: true } }),
  ]);
  const importados = new Map((importacao?.indicadores ?? []).map((i) => [nomeDaReferencia(i.indicador, referencias), Number(i.valor)]));
  const digitado = new Map(digitados.map((i) => [nomeDaReferencia(i.indicador, referencias), Number(i.valor)]));
  return {
    competencia: c,
    importacao: importacao ? { nomeArquivo: importacao.nomeArquivo, importadoEm: importacao.importadoEm } : null,
    indicadores: lista.map((i) => ({
      numero: i.numero,
      nome: i.nome,
      unidade: i.unidade,
      metodologia: i.metodologia,
      valor: digitado.get(i.nome) ?? importados.get(i.nome) ?? null,
      origem: digitado.has(i.nome) ? ("DIGITADA" as const) : importados.has(i.nome) ? ("IMPORTADA" as const) : null,
    })),
  };
}

/** "Novo Registro": grava o valor do mês de um indicador do setor, sobrepondo o atual (importado ou digitado). */
export async function digitarIndicador(setor: SetorIndicadores, ano: number, mes: number, nome: string, valor: number, usuarioId: string) {
  const prisma = getPrismaClient();
  const c = await competencia(ano, mes);
  if (c.status === "FECHADA") throw new RegraListaError(409, `A competência ${rotulo(ano, mes)} está fechada. Digitar nela exige reabri-la.`);
  if (!(await doSetor(setor)).some((i) => i.nome === nome)) throw new RegraListaError(400, `"${nome}" não é um indicador desta lista.`);
  const antes = await indicadoresDaLista(setor, ano, mes).then((l) => l.indicadores.find((i) => i.nome === nome));
  // Gravado pelo ID do indicador (25/11/2026).
  const indicador = referenciaDoNome(nome, await indicadoresParaReferencias(prisma));
  const gravado = await prisma.indicadorDigitado.upsert({
    where: { competenciaId_indicador: { competenciaId: c.id, indicador } },
    create: { competenciaId: c.id, indicador, valor, digitadoPor: usuarioId },
    update: { valor, digitadoPor: usuarioId, digitadoEm: new Date() },
    select: { id: true },
  });
  await auditar({
    usuarioId,
    acao: antes?.valor === null || antes === undefined ? "CRIACAO" : "ALTERACAO",
    entidade: "indicador_digitado",
    entidadeId: gravado.id,
    antes: antes && antes.valor !== null ? { nome, valor: antes.valor, origem: antes.origem } : undefined,
    depois: { nome, valor, origem: "DIGITADA" },
    metadados: { tipo: SETORES_INDICADORES[setor].tipo, competencia: rotulo(ano, mes) },
  });
}
