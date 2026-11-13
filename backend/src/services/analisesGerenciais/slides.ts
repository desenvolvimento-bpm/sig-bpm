import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";

import { getPrismaClient } from "../../config/prisma.js";
import type { MarcacaoCenario } from "../../generated/prisma/enums.js";
import { diretorioUploads } from "../importacoes/arquivosImportados.js";
import { indicadoresService } from "../relatorios/indicadoresService.js";
import { painelService } from "../relatorios/painelService.js";
import { resultadosService } from "../relatorios/resultadosService.js";
import { ACESSO_TOTAL } from "../acesso/acesso.js";
import { cenarioDaComparacao, cenarioMarcado, rotuloDaComparacao, type Comparacao } from "../cenarios/indicadoresDoCenario.js";
import { orcamentoDoExercicio } from "../relatorios/orcamento.js";

/**
 * O que os Relatórios Executivos e os Painéis de Bordo têm em comum (31/10/2026, pedido do Adão: os painéis feitos a partir
 * dos relatórios, com as mesmas melhorias e correções): os blocos e as páginas dos slides, as imagens e os vídeos (cada
 * documento na pasta dele), os dados dos cards e das tabelas e as comparações das Configurações (a Padrão e a PROVA).
 */

export class SlidesError extends Error {
  constructor(
    public status: number,
    message: string,
    /** O código do erro (23/10/2026: CONFLITO, o grupo gravado por outro depois de aberto) e os detalhes para a tela. */
    public codigo?: string,
    public detalhes?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Os processos com slides (31/10/2026): o nome é também a rota da API e a pasta dos arquivos nos uploads. */
export const PROCESSOS_DOS_SLIDES = ["relatorios-executivos", "paineis-de-bordo"] as const;
export type ProcessoDosSlides = (typeof PROCESSOS_DOS_SLIDES)[number];

/** O usuário: se edita a tela, os departamentos do recorte (null: sem recorte, todos) e os processos com slides que ele lê. */
export type UsuarioDosSlides = {
  id: string;
  nome: string;
  admin: boolean;
  edita: boolean;
  departamentos: Array<string> | null;
  /** Os processos que ele lê (31/10/2026): de onde ele pode colar imagens e vídeos. */
  le: Record<ProcessoDosSlides, boolean>;
};

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
export const rotuloMes = (ano: number, mes: number) => `${MESES[mes - 1]}/${ano}`;

/** As fontes dos textos (20/10/2026: as cinco da barra de formatação; 22/10/2026, mais cinco abertas). */
export const FONTES_DO_TEXTO = ["ARIAL", "CALIBRI", "SEGOE", "VERDANA", "GEORGIA", "ROBOTO", "OPEN_SANS", "MONTSERRAT", "LATO", "POPPINS"] as const;
export type FonteDoTexto = (typeof FONTES_DO_TEXTO)[number];
/** A formatação de um nível do Sumário (20/10/2026): o tamanho em px, a cor (#rrggbb) e a fonte. */
export type EstiloDoSumario = { negrito?: boolean; italico?: boolean; sublinhado?: boolean; tamanho?: number; cor?: string; fonte?: FonteDoTexto };

/**
 * Os cenários dos cards PROVA (31/10/2026, pedido do Adão), na ordem deles: Forecast, Orçado (o Orçamento Empresarial),
 * Vendido e Anterior — o realizado contra até os quatro cenários marcados.
 */
export const MARCACOES_DO_PROVA: MarcacaoCenario[] = ["PREVISAO", "ORCAMENTO_EMPRESARIAL", "RESULTADOS_VENDIDOS", "RESULTADOS_ANTERIORES"];

/** Um bloco da grade: a posição e o tamanho (em colunas e linhas) e o conteúdo. */
export type BlocoDoRelatorio = { id: string; x: number; y: number; w: number; h: number } & (
  | { tipo: "PAINEL"; aba: "resultados" | "performance"; quadro: string; titulo: string; sigla: string; comGrafico: boolean; /** As opções do gráfico do card (16/10/2026), como no Configurar Gráficos do Painel; sem elas, as do navegador. */ tipoGrafico?: "barras" | "area"; comRotulos?: boolean; cores?: "padrao" | "daltonismo"; /** O Zoom do card (30/10/2026): de 1,25 a 3; sem ele, 1. */ zoom?: number; /** Os dados antes do gráfico (12/11/2026): só o Atual ou só o Acumulado; sem ele, os dois. */ periodos?: "ATUAL" | "ACUMULADO"; /** O card PROVA (31/10/2026): os cenários são os da Comparação PROVA do relatório (a lista de marcações é de antes dela e vale o mesmo); sem ele, o card padrão. */ prova?: true | MarcacaoCenario[] }
  | { tipo: "INDICADOR"; nome: string; grafico?: "MESES" | "ACUMULADO"; /** As opções do gráfico, como nos cards do Painel (22/10/2026). */ tipoGrafico?: "barras" | "area"; comRotulos?: boolean; /** O Zoom do card (30/10/2026). */ zoom?: number; /** O card PROVA (31/10/2026). */ prova?: true | MarcacaoCenario[] }
  | { tipo: "ANOTACAO"; nota: "POSITIVO" | "NEGATIVO" | "ATENCAO"; texto: string; /** O título (16/10/2026; sem ele, o nome da nota). */ titulo?: string; /** O texto formatado (17/10/2026), em HTML (limpo na tela, ao mostrar). */ html?: string; tamanhoTitulo?: number; /** A fonte do título e o espaçamento entre as linhas (20/10/2026). */ fonteTitulo?: FonteDoTexto; espacamento?: number }
  /** Uma foto (16/10/2026): o arquivo (na pasta do relatório; vazio, o quadro esperando a imagem), a legenda e a proporção (largura ÷ altura). */
  | { tipo: "FOTO"; arquivo: string; legenda: string; proporcao: number; /** A legenda formatada (17/10/2026), em HTML. */ legendaHtml?: string; /** A Imagem Livre (21/10/2026): só a imagem, sem o fundo, a moldura e a legenda. */ livre?: boolean; /** Os ajustes da imagem (21/10/2026). */ ajustes?: AjustesDeImagem; /** O corte (27/10/2026): a imagem cobre o quadro, que tem o tamanho escolhido, com o zoom e a posição; sem ele, o quadro tem a proporção da imagem. */ recorte?: RecorteDaImagem }
  /**
   * Um vídeo (20/10/2026): um arquivo do computador (na pasta do relatório, até 200 MB) ou um link do YouTube, Instagram,
   * Facebook ou LinkedIn (`url`, o endereço colado; a tela monta o player incorporado), com a legenda e a proporção. Vazio
   * (sem arquivo e sem link), o quadro esperando o vídeo.
   */
  | { tipo: "VIDEO"; origem: "ARQUIVO" | "LINK"; arquivo: string; url: string; legenda: string; proporcao: number; legendaHtml?: string; /** As Configurações do Vídeo (13/11/2026). */ reproducaoAutomatica?: boolean; recomecarAoTerminar?: boolean }
  /** O Texto Livre (20/10/2026): o texto formatado das anotações, sem o destaque, o título, o ícone e o fundo. */
  | { tipo: "TEXTO"; texto: string; html?: string; espacamento?: number; /** As Bordas (12/11/2026). */ borda?: { lados: string[]; tipo: string; espessura: number; cor: string } }
  /**
   * O Sumário (20/10/2026): a lista das telas (as abas, da Introdução em diante; num painel, a tela Painel de Bordo) marcadas,
   * com o número do primeiro slide de cada uma, e, em "TELAS_E_SLIDES", também os slides delas; a tela monta a lista e os
   * números a cada vez. O sublinhado entre o nome e o número e a formatação das telas e dos slides (20/10/2026).
   */
  | { tipo: "SUMARIO"; listar: "TELAS" | "TELAS_E_SLIDES"; telas: string[]; linha?: "PONTOS" | "TRACOS" | "LINHA" | "NENHUM"; estilos?: { telas?: EstiloDoSumario; slides?: EstiloDoSumario } }
  /**
   * A tabela de Resultados (22/10/2026): a visão da DRE (0 Consolidado, 1 a 5 as unidades), as linhas escolhidas (os
   * códigos; sem elas, todas), o nível (1 Totais, 2 Atribuições, 3 Contas), os meses anteriores recolhidos ou não e as
   * colunas opcionais (30/10/2026: o R$/m³, a Diferença, o Atingimento e a Eficiência; sem elas, todas).
   */
  | { tipo: "TABELA"; visao: 0 | 1 | 2 | 3 | 4 | 5; nivel: 1 | 2 | 3; linhas?: string[]; recolhido?: boolean; colunas?: { unitario: boolean; diferenca: boolean; atingimento: boolean; eficiencia: boolean }; /** A Tabela PROVA (31/10/2026): os cenários da Comparação PROVA lado a lado, no lugar do comparado; sem ela, a Tabela Padrão. */ prova?: true | MarcacaoCenario[] }
);

/** Os ajustes de uma imagem (21/10/2026): brilho e saturação em % (100 = como veio), matiz em graus, desfoque em px e transparência em %; sem um deles, o padrão. */
export type AjustesDeImagem = { brilho?: number; matiz?: number; saturacao?: number; desfoque?: number; transparencia?: number };
/**
 * A Imagem de Fundo de uma página (20/10/2026): a foto (na pasta do relatório) cobre o slide inteiro, por cima do
 * cabeçalho, atrás dos blocos. `zoom` (1 a 4) aumenta a imagem a partir do tamanho que cobre a tela, e `x` e `y` (0 a 1)
 * a posicionam (0: encostada à esquerda ou em cima; 1: à direita ou embaixo).
 */
export type FundoDaPagina = { arquivo: string; proporcao: number; zoom: number; x: number; y: number; ajustes?: AjustesDeImagem };
/** O corte de uma imagem (27/10/2026): ela cobre o quadro, com o zoom (1 a 4) e a posição (0 a 1), como a Imagem de Fundo. */
export type RecorteDaImagem = { zoom: number; x: number; y: number };
/** A transição dos slides de um grupo (27/10/2026), guardada em cada página dele. */
export type TransicaoDoGrupo = "ESMAECER" | "ROLAR_VERTICAL" | "ROLAR_HORIZONTAL";

/**
 * As páginas de uma aba (16/10/2026): cada departamento tem uma ou mais páginas, cada uma com a sua grade de blocos. Ficam
 * na coluna `blocos` da aba; a lista antiga (só os blocos, de antes das páginas) vira uma página. O nome da página
 * (16/10/2026) é o do slide na apresentação; sem ele, "Página N".
 */
export type PaginaDoRelatorio = { id: string; nome?: string; blocos: BlocoDoRelatorio[]; fundo?: FundoDaPagina; transicao?: TransicaoDoGrupo; /** Avançar Após (30/10/2026), em segundos. */ avancarApos?: number; /** Recomeçar ao Terminar (11/11/2026, os painéis). */ recomecarAoTerminar?: boolean; /** Ocultar Página (12/11/2026): fora dos slides. */ oculta?: boolean };
export function paginasDe(json: unknown): PaginaDoRelatorio[] {
  const lista = Array.isArray(json) ? json : [];
  if (!lista.length) return [{ id: "p1", blocos: [] }];
  if (lista.some((x) => x && typeof x === "object" && "tipo" in x)) return [{ id: "p1", blocos: lista as BlocoDoRelatorio[] }];
  return lista as PaginaDoRelatorio[];
}

/**
 * As páginas copiadas de outro documento (o Importar de dos relatórios, 16/10/2026; o Copiar de dos painéis, 31/10/2026).
 * Sem "Manter Imagens e Anotações" (17/10/2026), as anotações vêm em branco (o tipo da nota e o título ficam) e as fotos e
 * os vídeos, sem a imagem e sem a legenda (o quadro cinza, esperando a imagem); os cards e as Imagens de Fundo vêm iguais
 * (a Imagem de Fundo vem sempre: 27/10/2026, pedido do Adão).
 */
export function paginasCopiadas(paginas: PaginaDoRelatorio[], manter: boolean) {
  if (manter) return paginas;
  const esvaziar = (b: BlocoDoRelatorio): BlocoDoRelatorio =>
    b.tipo === "ANOTACAO"
      ? { ...b, texto: "", html: undefined }
      : b.tipo === "FOTO"
        ? { ...b, arquivo: "", legenda: "", legendaHtml: undefined }
        : // O vídeo (20/10/2026), como a foto: o quadro vazio, esperando o vídeo.
          b.tipo === "VIDEO"
          ? { ...b, arquivo: "", url: "", legenda: "", legendaHtml: undefined }
          : b;
  return paginas.map((p) => ({ ...p, blocos: p.blocos.map(esvaziar) }));
}

/** As fotos (16/10/2026): na pasta do documento, dentro dos uploads, com um nome sorteado. */
export const NOME_DA_FOTO = /^[0-9a-f-]{36}\.(jpg|png|webp|gif)$/;
const EXTENSOES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const TIPOS: Record<string, string> = Object.fromEntries(Object.entries(EXTENSOES).map(([t, e]) => [e, t]));
const MAXIMO_DA_FOTO = 10 * 1024 * 1024;

/** Os vídeos (20/10/2026): na mesma pasta das fotos, com um nome sorteado; até 200 MB. */
export const NOME_DO_VIDEO = /^[0-9a-f-]{36}\.(mp4|webm|mov|m4v|ogv)$/;
const EXTENSOES_DE_VIDEO: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/x-m4v": "m4v", "video/ogg": "ogv" };
const TIPOS_DE_VIDEO: Record<string, string> = Object.fromEntries(Object.entries(EXTENSOES_DE_VIDEO).map(([t, e]) => [e, t]));
export const MAXIMO_DO_VIDEO = 200 * 1024 * 1024;
/** Os sites dos links de vídeo (20/10/2026). */
export const SITES_DE_VIDEO = /^https:\/\/([a-z0-9-]+\.)*(youtube\.com|youtu\.be|youtube-nocookie\.com|instagram\.com|facebook\.com|fb\.watch|linkedin\.com)(\/|$)/i;

/** A pasta das fotos e dos vídeos de um documento: uploads/<processo>/<id> (os dos relatórios, uploads/relatorios-executivos/<id>). */
export const pastaDosArquivos = (processo: ProcessoDosSlides, id: string) => join(diretorioUploads(), processo, id);

/** Os arquivos de uma página: as fotos, os vídeos e a Imagem de Fundo (20/10/2026). */
export const arquivosDaPagina = (p: PaginaDoRelatorio) => [
  ...p.blocos.flatMap((b) => ((b.tipo === "FOTO" || b.tipo === "VIDEO") && b.arquivo ? [b.arquivo] : [])),
  ...(p.fundo?.arquivo ? [p.fundo.arquivo] : []),
];

/** Desde quando cada arquivo da pasta do documento está sem uso (24/10/2026), em ms. */
const SEM_USO = ".sem-uso.json";

/**
 * Apaga as fotos e os vídeos que nenhuma página usa (enviados e não gravados, ou tirados da página) com mais de um dia: os
 * mais novos podem estar numa página ainda não gravada. O dia conta do envio e (24/10/2026, o Desfazer do salvamento
 * automático) de quando o arquivo saiu da página: o excluído e logo gravado volta inteiro com o Desfazer.
 */
export async function limparArquivos(pasta: string, paginas: PaginaDoRelatorio[]) {
  const usadas = new Set(paginas.flatMap(arquivosDaPagina));
  const arquivos = await readdir(pasta).catch(() => [] as string[]);
  const agora = Date.now();
  const umDia = agora - 24 * 60 * 60 * 1000;
  const antes = await readFile(join(pasta, SEM_USO), "utf8")
    .then((t) => JSON.parse(t) as Record<string, number>)
    .catch(() => ({}) as Record<string, number>);
  const semUso: Record<string, number> = {};
  for (const arquivo of arquivos) {
    if (usadas.has(arquivo) || !(NOME_DA_FOTO.test(arquivo) || NOME_DO_VIDEO.test(arquivo))) continue;
    const desde = antes[arquivo] ?? agora;
    const info = await stat(join(pasta, arquivo)).catch(() => null);
    if (info && info.mtimeMs < umDia && desde < umDia) await rm(join(pasta, arquivo), { force: true });
    else semUso[arquivo] = desde;
  }
  if (Object.keys(semUso).length || Object.keys(antes).length) await writeFile(join(pasta, SEM_USO), JSON.stringify(semUso)).catch(() => undefined);
}

/** Os arquivos dos slides de um documento (as fotos e os vídeos), na pasta dele. */
export const arquivosDosSlides = {
  /** Guarda uma foto (até 10 MB, JPEG, PNG, WebP ou GIF) e devolve o nome do arquivo. */
  async salvarFoto(pasta: string, conteudo: Buffer, tipo: string) {
    const extensao = EXTENSOES[tipo.split(";")[0].trim().toLowerCase()];
    if (!extensao) throw new SlidesError(400, "A foto precisa ser JPEG, PNG, WebP ou GIF.");
    if (!conteudo.length) throw new SlidesError(400, "O arquivo da foto está vazio.");
    if (conteudo.length > MAXIMO_DA_FOTO) throw new SlidesError(400, "A foto passa de 10 MB.");
    const arquivo = `${randomUUID()}.${extensao}`;
    await mkdir(pasta, { recursive: true });
    await writeFile(join(pasta, arquivo), conteudo);
    return { arquivo };
  },

  /** Uma foto: o conteúdo e o tipo. */
  async lerFoto(pasta: string, arquivo: string) {
    if (!NOME_DA_FOTO.test(arquivo)) throw new SlidesError(400, "Foto inválida.");
    const conteudo = await readFile(join(pasta, arquivo)).catch(() => null);
    if (!conteudo) throw new SlidesError(404, "Foto não encontrada.");
    return { conteudo, tipo: TIPOS[arquivo.split(".").pop()!] };
  },

  /**
   * Guarda um vídeo (20/10/2026; até 200 MB, MP4, WebM, MOV, M4V ou OGG), gravado no disco enquanto chega (sem guardar o
   * arquivo inteiro na memória), e devolve o nome do arquivo.
   */
  async salvarVideo(pasta: string, corpo: Readable, tipo: string, tamanho: number | null) {
    const extensao = EXTENSOES_DE_VIDEO[tipo.split(";")[0].trim().toLowerCase()];
    if (!extensao) throw new SlidesError(400, "O vídeo precisa ser MP4, WebM, MOV, M4V ou OGG.");
    if (tamanho !== null && tamanho > MAXIMO_DO_VIDEO) throw new SlidesError(413, "O vídeo passa de 200 MB.");
    const arquivo = `${randomUUID()}.${extensao}`;
    await mkdir(pasta, { recursive: true });
    const caminho = join(pasta, arquivo);
    let recebido = 0;
    const contador = new Transform({
      transform(parte: Buffer, _codificacao, pronto) {
        recebido += parte.length;
        if (recebido > MAXIMO_DO_VIDEO) pronto(new SlidesError(413, "O vídeo passa de 200 MB."));
        else pronto(null, parte);
      },
    });
    try {
      await pipeline(corpo, contador, createWriteStream(caminho));
    } catch (error) {
      await rm(caminho, { force: true });
      if (error instanceof SlidesError) throw error;
      throw new SlidesError(400, "O envio do vídeo foi interrompido. Tente de novo.");
    }
    if (!recebido) {
      await rm(caminho, { force: true });
      throw new SlidesError(400, "O arquivo do vídeo está vazio.");
    }
    return { arquivo };
  },

  /** Um vídeo (20/10/2026): o caminho no disco, o tamanho e o tipo (o controller o envia em partes, pelo Range). */
  async lerVideo(pasta: string, arquivo: string) {
    if (!NOME_DO_VIDEO.test(arquivo)) throw new SlidesError(400, "Vídeo inválido.");
    const caminho = join(pasta, arquivo);
    const info = await stat(caminho).catch(() => null);
    if (!info) throw new SlidesError(404, "Vídeo não encontrado.");
    return { caminho, tamanho: info.size, tipo: TIPOS_DE_VIDEO[arquivo.split(".").pop()!] };
  },

  /**
   * Copia fotos e vídeos de outra pasta para esta (24/10/2026: colar blocos copiados de outro documento), com os mesmos
   * nomes; os que já estão aqui ficam. Devolve os que não se acharam na origem.
   */
  async copiar(destino: string, origem: string, arquivos: string[]) {
    const validos = [...new Set(arquivos)].filter((a) => NOME_DA_FOTO.test(a) || NOME_DO_VIDEO.test(a));
    await mkdir(destino, { recursive: true });
    const faltando: string[] = [];
    for (const a of validos) {
      const para = join(destino, a);
      if (await stat(para).catch(() => null)) continue;
      const copiou = await copyFile(join(origem, a), para).then(
        () => true,
        () => false,
      );
      if (!copiou) faltando.push(a);
    }
    return { copiados: validos.length - faltando.length, faltando };
  },
};

/**
 * A pasta de onde vêm os arquivos colados (24/10/2026; desde 31/10/2026, também de um painel para um relatório e ao
 * contrário): o documento de origem existe e o usuário o lê — o relatório, com a permissão dos Relatórios Executivos; o
 * painel, com a dos Painéis de Bordo e se ele o vê (dele, o Administrador, um editor convidado ou, desde 01/11/2026,
 * público e finalizado: a regra de vePainel, nos Painéis de Bordo).
 */
export async function pastaDaOrigem(processo: ProcessoDosSlides, id: string, usuario: UsuarioDosSlides) {
  const prisma = getPrismaClient();
  if (!usuario.le[processo]) throw new SlidesError(403, "Seu perfil não lê o documento de onde vieram os blocos.");
  const existe =
    processo === "relatorios-executivos"
      ? await prisma.relatorioExecutivo.findUnique({ where: { id }, select: { id: true } })
      : await prisma.painelDeBordo.findFirst({
          where: { id, ...(usuario.admin ? {} : { OR: [{ visualizacao: "PUBLICO", situacao: "FINALIZADO" }, { criadoPorId: usuario.id }, { editores: { some: { usuarioId: usuario.id } } }] }) },
          select: { id: true },
        });
  if (!existe) throw new SlidesError(404, "O documento de onde vieram os blocos não foi encontrado.");
  return pastaDosArquivos(processo, id);
}

/**
 * As comparações de um documento (as Configurações): o cenário da Comparação Padrão e as marcações da Comparação PROVA. No
 * painel de bordo com a competência automática (03/11/2026), a Comparação Padrão é uma marcação (`comparacaoPadrao`).
 */
export type ComparacoesDoDocumento = { ano: number; mes: number; cenarioComparadoId: string | null; comparacaoPadrao?: MarcacaoCenario | null; comparacaoProva: MarcacaoCenario[] };

/**
 * O cenário de comparação (22/10/2026; desde 31/10/2026, a Comparação Padrão): o escolhido nas Configurações; sem ele (ou
 * com ele excluído, particular ou, desde 31/10/2026, sem marcação), o Orçamento Empresarial, como a tela das Configurações
 * mostra. Pela marcação (03/11/2026, o painel automático): o cenário que a tiver; sem nenhum, o Orçamento Empresarial.
 */
export async function comparacaoDo(r: { cenarioComparadoId: string | null; comparacaoPadrao?: MarcacaoCenario | null }): Promise<Comparacao> {
  if (r.comparacaoPadrao) return (await cenarioMarcado(r.comparacaoPadrao)) ? r.comparacaoPadrao : "ORCAMENTO_EMPRESARIAL";
  if (!r.cenarioComparadoId) return "ORCAMENTO_EMPRESARIAL";
  const c = await getPrismaClient().cenario.findFirst({ where: { id: r.cenarioComparadoId, visualizacao: "PUBLICA", marcacao: { not: null } }, select: { id: true } });
  return c ? { cenarioId: c.id } : "ORCAMENTO_EMPRESARIAL";
}

/**
 * A Comparação PROVA (31/10/2026, a aba Configurações): as marcações que os objetos PROVA comparam, na ordem do PROVA; sem
 * a escolha, todas (os objetos mostram as que têm cenário marcado).
 */
export const provaDo = (r: { comparacaoProva: MarcacaoCenario[] }) => (r.comparacaoProva.length ? MARCACOES_DO_PROVA.filter((m) => r.comparacaoProva.includes(m)) : MARCACOES_DO_PROVA);

/**
 * Os dados dos cards: o Painel de Bordo e os Indicadores até o mês do documento, só das competências fechadas; com os
 * orçados dos cenários marcados (31/10/2026), para os cards PROVA.
 */
export async function dadosDosCards(r: ComparacoesDoDocumento) {
  // Comparados com o cenário das Configurações (22/10/2026).
  const c = await comparacaoDo(r);
  // Os cenários dos cards PROVA: os da Comparação PROVA (31/10/2026) que têm cenário marcado, na ordem do PROVA; buscados
  // junto com o realizado (o painel e os indicadores os esperam só no fim).
  const prova = Promise.all(provaDo(r).map(async (m) => [m, await orcamentoDoExercicio(m)] as const)).then((l) => l.filter(([, o]) => o.cenario));
  const [painel, indicadores, comparado, cenarios] = await Promise.all([
    painelService.painel(r.ano, r.mes, true, c, prova),
    indicadoresService.listar(r.ano, r.mes, true, c, prova),
    cenarioDaComparacao(c),
    prova,
  ]);
  return {
    painel,
    indicadores,
    prova: {
      cenarios: cenarios.map(([m, o]) => ({ marcacao: m, rotulo: rotuloDaComparacao(m), cenario: o.cenario!.nome })),
      // A marcação do cenário de comparação: nos slides com cards PROVA, os cards padrão ficam na cor dela (nula: sem marcação).
      marcacaoComparada: typeof c === "string" ? c : (comparado?.marcacao ?? null),
    },
  };
}

/**
 * A tabela de Resultados de uma visão (22/10/2026), para os blocos de tabela: até o mês do documento, só das competências
 * fechadas, com o orçado (o Orçamento Empresarial), como a tela Resultados; sem o recorte do usuário, como os cards. Com
 * o orçado dos cenários da Comparação PROVA (31/10/2026), para a Tabela PROVA.
 */
export async function resultadosDaTabela(r: ComparacoesDoDocumento, visao: 0 | 1 | 2 | 3 | 4 | 5) {
  return resultadosService.unidade(r.ano, visao, r.mes, ACESSO_TOTAL, true, await comparacaoDo(r), provaDo(r));
}

/**
 * As comparações das Configurações (22/10/2026): a Comparação Padrão — o cenário de comparação (nulo: o marcado como
 * Orçamento Empresarial, que vem em `marcado`) — e, desde 31/10/2026, a Comparação PROVA (as marcações; vazia, todas). As
 * opções são os cenários públicos com marcação (31/10/2026; antes, todos os públicos), de qualquer exercício, com o ano, o
 * tipo (sintético ou analítico) e a marcação; os particulares ficam de fora (os dados do comparado aparecem a todos os que
 * leem o documento).
 */
export async function comparacoesDas(r: ComparacoesDoDocumento) {
  const [cenarios, marcado] = await Promise.all([
    getPrismaClient().cenario.findMany({
      where: { visualizacao: "PUBLICA", marcacao: { not: null } },
      orderBy: [{ ano: "desc" }, { nome: "asc" }],
      select: { id: true, nome: true, ano: true, tipo: true, marcacao: true },
    }),
    cenarioMarcado("ORCAMENTO_EMPRESARIAL"),
  ]);
  // O escolhido que deixou de existir (ou ficou particular ou sem marcação) volta à marcação. Pela marcação (03/11/2026, o
  // painel automático), o cenário que a tem hoje.
  const escolhido = r.comparacaoPadrao
    ? (cenarios.find((c) => c.marcacao === r.comparacaoPadrao)?.id ?? null)
    : r.cenarioComparadoId && cenarios.some((c) => c.id === r.cenarioComparadoId)
      ? r.cenarioComparadoId
      : null;
  return { ano: r.ano, cenarioComparadoId: escolhido, marcado, cenarios, comparacaoProva: r.comparacaoProva };
}

/**
 * A mudança das comparações: a Comparação Padrão (nulo: volta ao Orçamento Empresarial; um cenário público com marcação,
 * de qualquer exercício) e a Comparação PROVA (dois ou mais cenários marcados); o que não vier fica como está.
 */
export async function mudancaDasComparacoes(dados: { cenarioComparadoId?: string | null; comparacaoProva?: MarcacaoCenario[] }) {
  const prisma = getPrismaClient();
  if (dados.cenarioComparadoId) {
    const c = await prisma.cenario.findUnique({ where: { id: dados.cenarioComparadoId }, select: { visualizacao: true, marcacao: true } });
    // Um cenário público com marcação (31/10/2026; antes, qualquer público), de qualquer exercício.
    if (c?.visualizacao !== "PUBLICA" || !c.marcacao) throw new SlidesError(400, "Escolha um dos cenários marcados da lista.");
  }
  let comparacaoProva: MarcacaoCenario[] | undefined;
  if (dados.comparacaoProva) {
    comparacaoProva = MARCACOES_DO_PROVA.filter((m) => dados.comparacaoProva!.includes(m));
    const comCenario = await prisma.cenario.count({ where: { marcacao: { in: comparacaoProva } } });
    if (comparacaoProva.length < 2 || comCenario < comparacaoProva.length) throw new SlidesError(400, "Na Comparação PROVA, marque dois ou mais dos cenários marcados da lista.");
  }
  return {
    ...(dados.cenarioComparadoId !== undefined ? { cenarioComparadoId: dados.cenarioComparadoId } : {}),
    ...(comparacaoProva ? { comparacaoProva } : {}),
  };
}

/**
 * A conferência da versão das páginas (23/10/2026): a gravação manda quando elas foram gravadas da última vez no que o
 * usuário abriu; se outro gravou depois, recusa (409 CONFLITO, com quem e quando) em vez de sobrepor — a não ser com
 * `forcar` (o usuário escolheu gravar por cima).
 */
export function conferirVersao(gravado: { em: Date; por: string | null }, opcoes: { versao?: string; forcar?: boolean }, aba: { chave: string; nome: string }, documento: string) {
  if (!opcoes.versao || opcoes.forcar || gravado.em.toISOString() === opcoes.versao) return;
  const quem = gravado.por ?? "Outro usuário";
  const quando = gravado.em.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
  throw new SlidesError(409, `${quem} gravou ${aba.nome} em ${quando}, depois que você abriu ${documento}.`, "CONFLITO", {
    aba: aba.chave,
    nome: aba.nome,
    atualizadoPor: gravado.por,
    atualizadoEm: gravado.em,
  });
}

/** As competências fechadas, a mais recente primeiro. */
export async function competenciasFechadas() {
  const fechadas = await getPrismaClient().competencia.findMany({ where: { status: "FECHADA" }, select: { ano: true, mes: true }, orderBy: [{ ano: "desc" }, { mes: "desc" }] });
  return fechadas.map((c) => ({ ano: c.ano, mes: c.mes, rotulo: rotuloMes(c.ano, c.mes) }));
}
