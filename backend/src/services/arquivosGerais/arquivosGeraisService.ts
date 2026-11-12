import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { env } from "../../config/env.js";
import { getPrismaClient } from "../../config/prisma.js";
import type { CategoriaArquivoGeral } from "../../generated/prisma/enums.js";
import { CATALOGO_DE_TELAS } from "../acesso/telas.js";
import { auditar } from "../auditoriaService.js";

/**
 * Os Arquivos Gerais (05/11/2026, pedido do Adão): o processo da Controladoria com as telas Treinamentos e Informativos. Cada
 * arquivo tem a descrição (a busca da lista), o nome e o tipo como vieram, o tamanho, quem o enviou e quando. O conteúdo vai
 * ao disco enquanto chega (sem guardar o arquivo inteiro na memória), em UPLOAD_DIR/arquivos-gerais, com um UUID no nome.
 * Ler visualiza e baixa; Editar também adiciona e exclui (as rotas conferem a permissão da tela).
 */

/** As telas, pelo endereço: a categoria gravada e o código da tela no catálogo dos perfis. */
export const TELAS_DOS_ARQUIVOS = {
  treinamentos: { categoria: "TREINAMENTOS", tela: "arquivos_treinamentos", nome: "Treinamentos" },
  informativos: { categoria: "INFORMATIVOS", tela: "arquivos_informativos", nome: "Informativos" },
} as const satisfies Record<string, { categoria: CategoriaArquivoGeral; tela: string; nome: string }>;
export type TelaDosArquivos = keyof typeof TELAS_DOS_ARQUIVOS;
export const ehTelaDosArquivos = (t: string): t is TelaDosArquivos => Object.hasOwn(TELAS_DOS_ARQUIVOS, t);

export class RegraArquivosError extends Error {
  constructor(
    readonly status: 400 | 404 | 413,
    message: string,
  ) {
    super(message);
  }
}

/** O maior arquivo: 500 MB (os vídeos dos treinamentos). */
export const MAXIMO_DO_ARQUIVO = 500 * 1024 * 1024;
const MAXIMO_DA_DESCRICAO = 300;

/** O tipo pela extensão, quando o navegador não o diz (ou diz só application/octet-stream). */
const TIPO_DA_EXTENSAO: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  mp4: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  txt: "text/plain",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
};

/**
 * Os tipos que o navegador abre (o Visualizar): PDF, imagens, vídeos, áudios e texto puro. Os demais (Word, Excel,
 * PowerPoint, ZIP…) só se baixam; o HTML e o SVG também, porque podem trazer código.
 */
const VISIVEIS = /^(application\/pdf|image\/(png|jpeg|gif|webp|bmp)|video\/(mp4|webm|ogg)|audio\/(mpeg|wav|ogg|mp4|webm)|text\/plain)$/;
export const podeVisualizar = (tipo: string) => VISIVEIS.test(tipo);

/** O nome do arquivo como veio, sem o caminho e sem caracteres de controle (até 200 caracteres). */
export function nomeDoArquivo(nome: string) {
  const limpo = basename(nome.replace(/\\/g, "/"))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  return limpo.slice(0, 200);
}

/** A extensão (minúscula, só letras e números, até 10), ou "bin". */
export function extensaoDoArquivo(nome: string) {
  const e = extname(nome).slice(1).toLowerCase();
  return /^[a-z0-9]{1,10}$/.test(e) ? e : "bin";
}

/** O tipo que vale: o do navegador, sem os parâmetros; sem ele (ou genérico), o da extensão; sem os dois, octet-stream. */
export function tipoDoArquivo(tipo: string, nome: string) {
  const t = tipo.split(";")[0].trim().toLowerCase();
  if (t && t !== "application/octet-stream" && /^[a-z]+\/[a-z0-9.+-]+$/.test(t)) return t;
  return TIPO_DA_EXTENSAO[extensaoDoArquivo(nome)] ?? "application/octet-stream";
}

/**
 * Os processos dos arquivos (11/11/2026, pedido do Adão): os vigentes, os do catálogo das telas dos perfis (os em
 * desenvolvimento não estão nele), na ordem do menu — as Análises Gerenciais com um processo por tela (Relatórios
 * Executivos e Painéis e Apresentações) e os Cenários Analíticos antes dos Sintéticos. Cada um com as áreas das telas
 * dele: o usuário vê o processo quando lê ou edita alguma tela (ou aba) dele.
 */
export function processosDosArquivos(): Array<{ codigo: string; nome: string; areas: string[] }> {
  const r: Array<{ codigo: string; nome: string; areas: string[] }> = [];
  for (const g of CATALOGO_DE_TELAS) {
    if (g.recurso === "ANALISES_GERENCIAIS") {
      for (const t of g.telas) r.push({ codigo: t.codigo.toUpperCase(), nome: t.nome, areas: [t.codigo] });
      continue;
    }
    r.push({ codigo: g.recurso, nome: g.nome, areas: g.telas.map((t) => t.codigo) });
  }
  const i = r.findIndex((p) => p.codigo === "CENARIOS_SINTETICOS");
  const j = r.findIndex((p) => p.codigo === "CENARIOS_ANALITICOS");
  if (i >= 0 && j > i) [r[i], r[j]] = [r[j], r[i]];
  return r;
}
/** Os códigos dos processos que o usuário vê: alguma permissão (ler ou editar) numa tela ou numa aba deles. */
export function processosVisiveis(permissoes: string[]) {
  const areas = new Set(permissoes.map((p) => p.split(":")[0]));
  const daArea = (a: string) => [...areas].some((x) => x === a || x.startsWith(`${a}.`));
  return new Set(processosDosArquivos().filter((p) => p.areas.some(daArea)).map((p) => p.codigo));
}
/** O processo escolhido: nulo (Geral) ou um código vigente. */
function processoValido(processo: string | null | undefined) {
  const p = (processo ?? "").trim();
  if (!p) return null;
  if (!processosDosArquivos().some((x) => x.codigo === p)) throw new RegraArquivosError(400, "Escolha o processo do arquivo na lista (ou Geral).");
  return p;
}
const nomeDoProcesso = (codigo: string | null) => (codigo ? (processosDosArquivos().find((p) => p.codigo === codigo)?.nome ?? codigo) : "Geral");

const pasta = () => join(resolve(env.UPLOAD_DIR), "arquivos-gerais");
const NOME_NO_DISCO = /^[0-9a-f-]{36}\.[a-z0-9]{1,10}$/;

export const arquivosGeraisService = {
  /**
   * Os arquivos da tela, do mais recente ao mais antigo, com o Visualizar de cada um: os Gerais e os dos processos que o
   * usuário vê (11/11/2026). Com eles, os processos vigentes, para o Adicionar e o Editar.
   */
  async listar(tela: TelaDosArquivos, permissoes: string[]) {
    const visiveis = processosVisiveis(permissoes);
    const rs = await getPrismaClient().arquivoGeral.findMany({
      where: { categoria: TELAS_DOS_ARQUIVOS[tela].categoria, OR: [{ processo: null }, { processo: { in: [...visiveis] } }] },
      orderBy: { enviadoEm: "desc" },
      select: { id: true, descricao: true, nomeOriginal: true, tipo: true, tamanho: true, enviadoPorNome: true, enviadoEm: true, processo: true },
    });
    return {
      arquivos: rs.map((r) => ({ ...r, processoNome: nomeDoProcesso(r.processo), visualizavel: podeVisualizar(r.tipo) })),
      processos: processosDosArquivos().map(({ codigo, nome }) => ({ codigo, nome })),
    };
  },

  /**
   * Adiciona um arquivo: o conteúdo cru no corpo (gravado no disco enquanto chega, até 500 MB), o nome e a descrição. Um
   * envio interrompido ou grande demais não deixa nada no disco nem na lista.
   */
  async adicionar(
    tela: TelaDosArquivos,
    corpo: Readable,
    d: { nome: string; descricao: string; tipo: string; tamanho: number | null; processo?: string | null },
    usuario: { id: string; nome: string },
  ) {
    const nome = nomeDoArquivo(d.nome);
    const processo = processoValido(d.processo);
    const descricao = d.descricao.trim();
    if (!nome) throw new RegraArquivosError(400, "Falta o nome do arquivo.");
    if (!descricao) throw new RegraArquivosError(400, "Escreva a descrição do arquivo.");
    if (descricao.length > MAXIMO_DA_DESCRICAO) throw new RegraArquivosError(400, `A descrição passa de ${MAXIMO_DA_DESCRICAO} caracteres.`);
    if (d.tamanho !== null && d.tamanho > MAXIMO_DO_ARQUIVO) throw new RegraArquivosError(413, "O arquivo passa de 500 MB.");
    const arquivo = `${randomUUID()}.${extensaoDoArquivo(nome)}`;
    await mkdir(pasta(), { recursive: true });
    const caminho = join(pasta(), arquivo);
    let recebido = 0;
    const contador = new Transform({
      transform(parte: Buffer, _codificacao, pronto) {
        recebido += parte.length;
        if (recebido > MAXIMO_DO_ARQUIVO) pronto(new RegraArquivosError(413, "O arquivo passa de 500 MB."));
        else pronto(null, parte);
      },
    });
    try {
      await pipeline(corpo, contador, createWriteStream(caminho));
    } catch (error) {
      await rm(caminho, { force: true });
      if (error instanceof RegraArquivosError) throw error;
      throw new RegraArquivosError(400, "O envio do arquivo foi interrompido. Tente de novo.");
    }
    if (!recebido) {
      await rm(caminho, { force: true });
      throw new RegraArquivosError(400, "O arquivo está vazio.");
    }
    const tipo = tipoDoArquivo(d.tipo, nome);
    const r = await getPrismaClient().arquivoGeral.create({
      data: { categoria: TELAS_DOS_ARQUIVOS[tela].categoria, descricao, nomeOriginal: nome, tipo, tamanho: recebido, arquivo, enviadoPor: usuario.id, enviadoPorNome: usuario.nome, processo },
      select: { id: true, descricao: true, nomeOriginal: true, tipo: true, tamanho: true, enviadoPorNome: true, enviadoEm: true, processo: true },
    });
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "CRIACAO",
      entidade: "arquivo_geral",
      entidadeId: r.id,
      depois: { tela: TELAS_DOS_ARQUIVOS[tela].nome, descricao, nome, tipo, tamanho: recebido, processo: nomeDoProcesso(processo) },
    });
    return { ...r, processoNome: nomeDoProcesso(processo), visualizavel: podeVisualizar(tipo) };
  },

  /** Edita a descrição e o processo de um arquivo (11/11/2026, pedido do Adão), com o registro na Auditoria. */
  async editar(tela: TelaDosArquivos, id: string, d: { descricao: string; processo: string | null }, usuario: { id: string; nome: string; permissoes: string[] }) {
    const prisma = getPrismaClient();
    const r = await prisma.arquivoGeral.findFirst({ where: { id, categoria: TELAS_DOS_ARQUIVOS[tela].categoria } });
    if (!r || (r.processo && !processosVisiveis(usuario.permissoes).has(r.processo))) throw new RegraArquivosError(404, "Arquivo não encontrado.");
    const descricao = d.descricao.trim();
    if (!descricao) throw new RegraArquivosError(400, "Escreva a descrição do arquivo.");
    if (descricao.length > MAXIMO_DA_DESCRICAO) throw new RegraArquivosError(400, `A descrição passa de ${MAXIMO_DA_DESCRICAO} caracteres.`);
    const processo = processoValido(d.processo);
    const novo = await prisma.arquivoGeral.update({
      where: { id },
      data: { descricao, processo },
      select: { id: true, descricao: true, nomeOriginal: true, tipo: true, tamanho: true, enviadoPorNome: true, enviadoEm: true, processo: true },
    });
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "ALTERACAO",
      entidade: "arquivo_geral",
      entidadeId: id,
      antes: { tela: TELAS_DOS_ARQUIVOS[tela].nome, descricao: r.descricao, processo: nomeDoProcesso(r.processo) },
      depois: { tela: TELAS_DOS_ARQUIVOS[tela].nome, descricao, processo: nomeDoProcesso(processo) },
    });
    return { ...novo, processoNome: nomeDoProcesso(processo), visualizavel: podeVisualizar(novo.tipo) };
  },

  /** O arquivo para o Visualizar e o Baixar: o caminho no disco, o tamanho, o tipo e o nome. */
  async ler(tela: TelaDosArquivos, id: string, permissoes: string[]) {
    const r = await getPrismaClient().arquivoGeral.findFirst({ where: { id, categoria: TELAS_DOS_ARQUIVOS[tela].categoria }, select: { nomeOriginal: true, tipo: true, arquivo: true, processo: true } });
    // O arquivo de um processo que o usuário não vê (11/11/2026) não abre, como se não existisse.
    if (!r || !NOME_NO_DISCO.test(r.arquivo) || (r.processo && !processosVisiveis(permissoes).has(r.processo))) throw new RegraArquivosError(404, "Arquivo não encontrado.");
    const caminho = join(pasta(), r.arquivo);
    const info = await stat(caminho).catch(() => null);
    if (!info) throw new RegraArquivosError(404, "O arquivo não está mais no servidor.");
    return { caminho, tamanho: info.size, tipo: r.tipo, nome: r.nomeOriginal, visualizavel: podeVisualizar(r.tipo) };
  },

  /** Exclui o arquivo: o registro e o conteúdo no disco, com o registro na Auditoria. */
  async excluir(tela: TelaDosArquivos, id: string, usuario: { id: string; nome: string; permissoes?: string[] }) {
    const prisma = getPrismaClient();
    const r = await prisma.arquivoGeral.findFirst({ where: { id, categoria: TELAS_DOS_ARQUIVOS[tela].categoria } });
    if (!r || (r.processo && usuario.permissoes && !processosVisiveis(usuario.permissoes).has(r.processo))) throw new RegraArquivosError(404, "Arquivo não encontrado.");
    await prisma.arquivoGeral.delete({ where: { id } });
    if (NOME_NO_DISCO.test(r.arquivo)) await rm(join(pasta(), r.arquivo), { force: true });
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "EXCLUSAO",
      entidade: "arquivo_geral",
      entidadeId: id,
      antes: { tela: TELAS_DOS_ARQUIVOS[tela].nome, descricao: r.descricao, nome: r.nomeOriginal, tipo: r.tipo, tamanho: r.tamanho, enviadoPor: r.enviadoPorNome, enviadoEm: r.enviadoEm },
    });
    return { excluido: true };
  },
};
