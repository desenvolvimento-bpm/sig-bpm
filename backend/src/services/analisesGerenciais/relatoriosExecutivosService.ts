import { cp, rm } from "node:fs/promises";
import type { Readable } from "node:stream";

import { getPrismaClient } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { AbaRelatorioExecutivo, DepartamentoAcesso, MarcacaoCenario } from "../../generated/prisma/enums.js";
import { auditar, auditoriaEmSequencia } from "../auditoriaService.js";
import {
  arquivosDaPagina,
  arquivosDosSlides,
  comparacoesDas,
  conferirVersao,
  dadosDosCards,
  limparArquivos,
  mudancaDasComparacoes,
  paginasCopiadas,
  paginasDe,
  pastaDaOrigem,
  pastaDosArquivos,
  resultadosDaTabela,
  rotuloMes,
  SlidesError,
  type PaginaDoRelatorio,
  type ProcessoDosSlides,
  type UsuarioDosSlides,
} from "./slides.js";

/**
 * Os Relatórios Executivos (15/10/2026, Análises Gerenciais): a apresentação de cada competência fechada, que os gestores
 * montam juntos. Decisões do usuário: um relatório por competência, criado por quem edita a tela; as oito abas (17/10/2026; a Capa e o Encerramento, 20/10/2026;
 * antes, uma por departamento) — Capa, Introdução, Demonstrativo de Resultados e Encerramento, que todos os que editam a tela editam, e
 * as performances Comercial, da Produção, de Serviços e Administrativa; desde 23/10/2026, sem o recorte de departamentos:
 * quem lê a tela vê todas as abas (em elaboração ou finalizadas) e quem edita a tela edita, finaliza e reabre todas; cada
 * aba tem a sua situação, e o relatório fica finalizado quando todas as abas estão. As anotações são blocos
 * livres na grade, ao lado dos cards. Os cards trazem o Painel de Bordo e os Indicadores de Resultados Empresariais até
 * o mês do relatório, só das competências fechadas. Os blocos, os arquivos, os dados e as comparações são os dos Painéis
 * de Bordo (31/10/2026: slides.ts).
 */

/** O erro dos relatórios: o dos slides (31/10/2026), o mesmo dos Painéis de Bordo. */
export { SlidesError as RelatorioExecutivoError };

/** O usuário: se edita a tela, os departamentos do recorte (null: sem recorte, todos) e os processos com slides que ele lê. */
export type UsuarioDoRelatorio = UsuarioDosSlides;

const PROCESSO: ProcessoDosSlides = "relatorios-executivos";
const pastaDasFotos = (relatorioId: string) => pastaDosArquivos(PROCESSO, relatorioId);

/**
 * As abas (17/10/2026), na ordem: o nome curto (o da barra do topo), o título (o da tela e do slide) e o departamento do
 * recorte (nulo: geral, de todos os que editam a tela).
 */
export const ABAS: Array<{ chave: AbaRelatorioExecutivo; nome: string; titulo: string; departamento: DepartamentoAcesso | null }> = [
  // A Capa (20/10/2026), geral como a Introdução: os slides dela não entram na contagem (o contador e o Sumário começam na Introdução).
  { chave: "CAPA", nome: "Capa", titulo: "Capa", departamento: null },
  { chave: "FATOS", nome: "Introdução", titulo: "Introdução", departamento: null },
  { chave: "RESULTADOS", nome: "Resultados", titulo: "Demonstrativo de Resultados", departamento: null },
  { chave: "COMERCIAL", nome: "Comercial", titulo: "Performance Comercial", departamento: "COMERCIAL" },
  { chave: "PRODUCAO", nome: "Produção", titulo: "Performance da Produção", departamento: "PRODUCAO" },
  { chave: "SERVICOS", nome: "Serviços", titulo: "Performance de Serviços", departamento: "SERVICOS" },
  { chave: "ADMINISTRATIVO", nome: "Administrativo", titulo: "Performance Administrativa", departamento: "ADMINISTRATIVO" },
  // O Encerramento (20/10/2026), geral e no fim; como a Capa, os slides dele não entram na contagem nem no Sumário.
  { chave: "ENCERRAMENTO", nome: "Encerramento", titulo: "Encerramento", departamento: null },
];
export const CHAVES_DAS_ABAS = ABAS.map((a) => a.chave);
const DA_ABA = new Map(ABAS.map((a) => [a.chave, a]));
const nomeDaAba = (d: AbaRelatorioExecutivo) => DA_ABA.get(d)?.nome ?? d;

/** Apaga as fotos que nenhuma aba usa (veja limparArquivos, nos slides). */
async function limparFotos(relatorioId: string) {
  const abas = await getPrismaClient().relatorioExecutivoAba.findMany({ where: { relatorioId }, select: { blocos: true } });
  await limparArquivos(pastaDasFotos(relatorioId), abas.flatMap((a) => paginasDe(a.blocos)));
}

type Aba = { departamento: AbaRelatorioExecutivo; blocos: unknown; situacao: "EM_ELABORACAO" | "FINALIZADO"; atualizadoPor: string | null; atualizadoEm: Date; finalizadoPor: string | null; finalizadoEm: Date | null };

/**
 * Quem edita a aba: quem edita a tela, em todas as abas (23/10/2026; antes, nas abas de um departamento, só no recorte de
 * departamentos do usuário).
 */
const editaAba = (u: UsuarioDoRelatorio, _d: AbaRelatorioExecutivo) => u.edita;
/** Quem vê a aba: todos os que leem a tela, em elaboração ou finalizada (23/10/2026; antes, em elaboração, só quem a editava). */
const veAba = (_u: UsuarioDoRelatorio, _a: Aba) => true;

/** A situação do relatório: finalizado quando todas as abas estão. */
const situacaoGeral = (abas: Aba[]) => (abas.length && abas.every((a) => a.situacao === "FINALIZADO") ? "FINALIZADO" : "EM_ELABORACAO");

/**
 * Cria as abas que faltam num relatório (20/10/2026: a Capa, nos de antes dela), vazias. Num relatório com todas as abas
 * finalizadas, a nova já vem finalizada, para ele não voltar a Em Elaboração; quem a edita a reabre para montar. Devolve
 * se criou alguma.
 */
async function completarAbas(r: { id: string; abas: Aba[] }) {
  const faltam = CHAVES_DAS_ABAS.filter((d) => !r.abas.some((a) => a.departamento === d));
  if (!faltam.length) return false;
  const finalizado = situacaoGeral(r.abas) === "FINALIZADO";
  await getPrismaClient().relatorioExecutivoAba.createMany({
    data: faltam.map((departamento) => ({ relatorioId: r.id, departamento, blocos: paginasDe([]) as Prisma.InputJsonValue, ...(finalizado ? { situacao: "FINALIZADO" as const, finalizadoEm: new Date() } : {}) })),
  });
  return true;
}

async function doRelatorio(id: string) {
  const buscar = () => getPrismaClient().relatorioExecutivo.findUnique({ where: { id }, include: { abas: true } });
  const r = await buscar();
  if (!r) throw new SlidesError(404, "Relatório não encontrado.");
  return (await completarAbas(r)) ? (await buscar())! : r;
}

/** A aba que o usuário pode alterar: em elaboração (todas, para quem edita a tela; 23/10/2026). */
async function abaEditavel(id: string, d: AbaRelatorioExecutivo, u: UsuarioDoRelatorio) {
  const r = await doRelatorio(id);
  const aba = r.abas.find((a) => a.departamento === d);
  if (!aba) throw new SlidesError(404, "Aba não encontrada.");
  if (!editaAba(u, d)) throw new SlidesError(403, "Só quem edita os Relatórios Executivos altera as abas.");
  if (aba.situacao === "FINALIZADO") throw new SlidesError(409, `A aba ${nomeDaAba(d)} está finalizada: reabra-a para alterar.`);
  return { r, aba };
}

export const relatoriosExecutivosService = {
  /**
   * Os relatórios (a competência mais recente primeiro), com a situação, o andamento (as abas finalizadas) e as abas do
   * usuário; e as competências fechadas ainda sem relatório (o Novo Relatório).
   */
  async listar(usuario: UsuarioDoRelatorio) {
    const prisma = getPrismaClient();
    const buscar = () => prisma.relatorioExecutivo.findMany({ include: { abas: true }, orderBy: [{ ano: "desc" }, { mes: "desc" }] });
    let [relatorios, fechadas] = await Promise.all([
      buscar(),
      prisma.competencia.findMany({ where: { status: "FECHADA" }, select: { ano: true, mes: true }, orderBy: [{ ano: "desc" }, { mes: "desc" }] }),
    ]);
    // Os relatórios de antes da Capa e do Encerramento (20/10/2026) os ganham aqui, para o andamento contar as oito abas.
    let completou = false;
    for (const r of relatorios) completou = (await completarAbas(r)) || completou;
    if (completou) relatorios = await buscar();
    const comRelatorio = new Set(relatorios.map((r) => `${r.ano}|${r.mes}`));
    return {
      relatorios: relatorios.map((r) => ({
        id: r.id,
        ano: r.ano,
        mes: r.mes,
        rotuloMes: rotuloMes(r.ano, r.mes),
        situacao: situacaoGeral(r.abas),
        finalizadas: r.abas.filter((a) => a.situacao === "FINALIZADO").length,
        total: r.abas.length,
        // As abas que o usuário edita, com a situação de cada uma.
        minhas: CHAVES_DAS_ABAS.filter((d) => editaAba(usuario, d)).flatMap((d) => {
          const a = r.abas.find((x) => x.departamento === d);
          return a ? [{ chave: d, nome: nomeDaAba(d), situacao: a.situacao }] : [];
        }),
        criadoPor: r.criadoPorNome,
        criadoEm: r.criadoEm,
        atualizadoEm: r.abas.reduce((m, a) => (a.atualizadoEm > m ? a.atualizadoEm : m), r.atualizadoEm),
      })),
      livres: fechadas.filter((c) => !comRelatorio.has(`${c.ano}|${c.mes}`)).map((c) => ({ ano: c.ano, mes: c.mes, rotulo: rotuloMes(c.ano, c.mes) })),
      meusDepartamentos: CHAVES_DAS_ABAS.filter((d) => editaAba(usuario, d)).map((d) => ({ chave: d, nome: nomeDaAba(d) })),
    };
  },

  /**
   * Cria o relatório de uma competência fechada (um por competência), com as oito abas: vazias ou, com `importarDe`
   * (16/10/2026), com os blocos das abas de outro relatório — os cards (que trazem os dados do mês novo), as fotos
   * (copiadas para a pasta do relatório novo) e as anotações —, todas em elaboração.
   */
  async criar(dados: { ano: number; mes: number; importarDe?: string | null; manterImagensEAnotacoes?: boolean }, usuario: UsuarioDoRelatorio) {
    const prisma = getPrismaClient();
    const competencia = await prisma.competencia.findFirst({ where: { ano: dados.ano, mes: dados.mes } });
    if (!competencia || competencia.status !== "FECHADA") throw new SlidesError(400, `A competência ${rotuloMes(dados.ano, dados.mes)} não está fechada: os relatórios são das competências fechadas.`);
    if (await prisma.relatorioExecutivo.findUnique({ where: { ano_mes: { ano: dados.ano, mes: dados.mes } } })) {
      throw new SlidesError(409, `${rotuloMes(dados.ano, dados.mes)} já tem relatório: abra-o na lista.`);
    }
    const origem = dados.importarDe ? await doRelatorio(dados.importarDe) : null;
    // Sem "Manter Imagens e Anotações" (17/10/2026), as anotações vêm em branco e as fotos, sem a imagem (paginasCopiadas).
    const manter = dados.manterImagensEAnotacoes !== false;
    const daOrigem = new Map((origem?.abas ?? []).map((a) => [a.departamento, paginasCopiadas(paginasDe(a.blocos), manter)]));
    const r = await prisma.relatorioExecutivo.create({
      data: {
        ano: dados.ano,
        mes: dados.mes,
        criadoPorId: usuario.id,
        criadoPorNome: usuario.nome,
        // O cenário de comparação da origem (22/10/2026), no mesmo exercício.
        cenarioComparadoId: origem && origem.ano === dados.ano ? origem.cenarioComparadoId : null,
        // A Comparação PROVA da origem (31/10/2026): as marcações, de qualquer exercício.
        comparacaoProva: origem?.comparacaoProva ?? [],
        abas: { create: CHAVES_DAS_ABAS.map((departamento) => ({ departamento, blocos: (daOrigem.get(departamento) ?? paginasDe([])) as Prisma.InputJsonValue, atualizadoPor: origem ? usuario.nome : null })) },
      },
    });
    // As fotos da origem vão para a pasta do relatório novo (a origem pode ser excluída depois).
    if (origem && [...daOrigem.values()].some((ps) => ps.some((p) => arquivosDaPagina(p).length))) {
      await cp(pastaDasFotos(origem.id), pastaDasFotos(r.id), { recursive: true }).catch(() => undefined);
    }
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "CRIACAO",
      entidade: "relatorio_executivo",
      entidadeId: r.id,
      metadados: { mes: rotuloMes(r.ano, r.mes), importadoDe: origem ? rotuloMes(origem.ano, origem.mes) : null, imagensEAnotacoes: origem ? manter : null },
    });
    return { id: r.id, rotuloMes: rotuloMes(r.ano, r.mes) };
  },

  /** O relatório, com as abas: a situação de cada uma, as páginas (com os blocos) das que o usuário vê e o que ele pode fazer em cada. */
  async obter(id: string, usuario: UsuarioDoRelatorio) {
    const r = await doRelatorio(id);
    const abas = CHAVES_DAS_ABAS.flatMap((d) => {
      const a = r.abas.find((x) => x.departamento === d);
      if (!a) return [];
      const ve = veAba(usuario, a);
      return [
        {
          chave: d,
          nome: nomeDaAba(d),
          titulo: DA_ABA.get(d)?.titulo ?? d,
          situacao: a.situacao,
          visivel: ve,
          paginas: ve ? paginasDe(a.blocos) : [],
          podeEditar: editaAba(usuario, d) && a.situacao === "EM_ELABORACAO",
          podeReabrir: a.situacao === "FINALIZADO" && (editaAba(usuario, d) || usuario.admin),
          atualizadoPor: a.atualizadoPor,
          atualizadoEm: a.atualizadoEm,
          finalizadoPor: a.finalizadoPor,
          finalizadoEm: a.finalizadoEm,
        },
      ];
    });
    return {
      id: r.id,
      ano: r.ano,
      mes: r.mes,
      rotuloMes: rotuloMes(r.ano, r.mes),
      situacao: situacaoGeral(r.abas),
      criadoPor: r.criadoPorNome,
      criadoEm: r.criadoEm,
      abas,
      // O criador (ou o Administrador) exclui o relatório enquanto nenhuma aba estiver finalizada.
      podeExcluir: (r.criadoPorId === usuario.id || usuario.admin) && usuario.edita && r.abas.every((a) => a.situacao === "EM_ELABORACAO"),
    };
  },

  /** Os dados dos cards (veja dadosDosCards, nos slides), até o mês do relatório. */
  async dados(id: string) {
    return dadosDosCards(await doRelatorio(id));
  },

  /** A tabela de Resultados de uma visão (22/10/2026), para os blocos de tabela (veja resultadosDaTabela, nos slides). */
  async resultados(id: string, visao: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7) {
    return resultadosDaTabela(await doRelatorio(id), visao);
  },

  /** As Configurações do relatório (22/10/2026): a Comparação Padrão e a Comparação PROVA (veja comparacoesDas, nos slides). */
  async configuracoes(id: string, usuario: UsuarioDoRelatorio) {
    const r = await doRelatorio(id);
    return { ...(await comparacoesDas(r)), podeEditar: usuario.edita };
  },

  /**
   * Grava as Configurações (de quem edita a tela): a Comparação Padrão (nulo: volta ao Orçamento Empresarial) ou, desde
   * 31/10/2026, a Comparação PROVA (dois ou mais cenários marcados); o que não vier fica como está.
   */
  async gravarConfiguracoes(id: string, dados: { cenarioComparadoId?: string | null; comparacaoProva?: MarcacaoCenario[] }, usuario: UsuarioDoRelatorio) {
    if (!usuario.edita) throw new SlidesError(403, "Só quem edita os Relatórios Executivos muda as configurações.");
    const r = await doRelatorio(id);
    const muda = await mudancaDasComparacoes(dados);
    await getPrismaClient().relatorioExecutivo.update({ where: { id }, data: muda });
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "ALTERACAO",
      entidade: "relatorio_executivo",
      entidadeId: id,
      antes: Object.fromEntries(Object.keys(muda).map((k) => [k, r[k as keyof typeof muda]])),
      depois: muda,
      metadados: { mes: rotuloMes(r.ano, r.mes), configuracoes: true },
    });
    return this.configuracoes(id, usuario);
  },

  /**
   * Grava as páginas de uma aba (o grupo). `versao` (23/10/2026): quando ela foi gravada da última vez, no momento em que o
   * usuário a abriu; se outro gravou depois, recusa (409 CONFLITO, com quem e quando) em vez de sobrepor — a não ser com
   * `forcar` (o usuário escolheu gravar por cima).
   */
  async gravarAba(id: string, departamento: AbaRelatorioExecutivo, paginas: PaginaDoRelatorio[], usuario: UsuarioDoRelatorio, opcoes: { versao?: string; forcar?: boolean } = {}) {
    const { r, aba } = await abaEditavel(id, departamento, usuario);
    conferirVersao({ em: aba.atualizadoEm, por: aba.atualizadoPor }, opcoes, { chave: departamento, nome: nomeDaAba(departamento) }, "o relatório");
    await getPrismaClient().relatorioExecutivoAba.update({
      where: { relatorioId_departamento: { relatorioId: id, departamento } },
      data: { blocos: (paginas.length ? paginas : paginasDe([])) as Prisma.InputJsonValue, atualizadoPor: usuario.nome },
    });
    // A gravação na Auditoria (23/10/2026), com a gravação por cima de outro usuário, quando foi o caso. Em sequência
    // (24/10/2026, o salvamento automático), só a mais recente do mesmo usuário no grupo.
    auditoriaEmSequencia.registrar(`${id}|${departamento}`, {
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "GRAVACAO_RE",
      entidade: "relatorio_executivo",
      entidadeId: id,
      metadados: { mes: rotuloMes(r.ano, r.mes), aba: nomeDaAba(departamento), paginas: paginas.length, ...(opcoes.forcar ? { porCima: true } : {}) },
    });
    await limparFotos(id);
    return this.obter(id, usuario);
  },

  /** Finaliza a aba (fica visível para todos, só leitura) ou a reabre (volta a ser só de quem a edita). */
  async mudarAba(id: string, departamento: AbaRelatorioExecutivo, acao: "finalizar" | "reabrir", usuario: UsuarioDoRelatorio) {
    const prisma = getPrismaClient();
    const r = await doRelatorio(id);
    if (acao === "finalizar") await abaEditavel(id, departamento, usuario);
    else {
      const aba = r.abas.find((a) => a.departamento === departamento);
      if (!aba) throw new SlidesError(404, "Aba não encontrada.");
      if (!editaAba(usuario, departamento) && !usuario.admin) throw new SlidesError(403, "Só quem edita os Relatórios Executivos reabre as abas.");
      if (aba.situacao !== "FINALIZADO") throw new SlidesError(409, "A aba não está finalizada.");
    }
    // As gravações em sequência do relatório entram na Auditoria antes.
    await auditoriaEmSequencia.encerrar(`${id}|`);
    await prisma.relatorioExecutivoAba.update({
      where: { relatorioId_departamento: { relatorioId: id, departamento } },
      data: acao === "finalizar" ? { situacao: "FINALIZADO", finalizadoPor: usuario.nome, finalizadoEm: new Date() } : { situacao: "EM_ELABORACAO", finalizadoPor: null, finalizadoEm: null, atualizadoPor: usuario.nome },
    });
    await auditar({
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      // A ação própria (23/10/2026; antes, ALTERACAO, com a ação nos metadados).
      acao: acao === "finalizar" ? "FINALIZACAO_RE" : "REABERTURA_RE",
      entidade: "relatorio_executivo",
      entidadeId: id,
      metadados: { mes: rotuloMes(r.ano, r.mes), aba: nomeDaAba(departamento) },
    });
    return this.obter(id, usuario);
  },

  /** Guarda uma foto do relatório (quem edita a tela; até 10 MB, JPEG, PNG, WebP ou GIF) e devolve o nome do arquivo. */
  async salvarFoto(id: string, conteudo: Buffer, tipo: string, usuario: UsuarioDoRelatorio) {
    await doRelatorio(id);
    if (!usuario.edita) throw new SlidesError(403, "Seu perfil não edita os relatórios.");
    return arquivosDosSlides.salvarFoto(pastaDasFotos(id), conteudo, tipo);
  },

  /**
   * Copia fotos e vídeos de outro documento para a pasta deste (24/10/2026: colar blocos copiados de outro relatório; desde
   * 31/10/2026, também de um painel de bordo), com os mesmos nomes; os que já estão aqui ficam. Devolve os que não se acharam
   * na origem.
   */
  async copiarArquivos(id: string, origem: { processo: ProcessoDosSlides; id: string }, arquivos: string[], usuario: UsuarioDoRelatorio) {
    if (!usuario.edita) throw new SlidesError(403, "Seu perfil não edita os relatórios.");
    await doRelatorio(id);
    return arquivosDosSlides.copiar(pastaDasFotos(id), await pastaDaOrigem(origem.processo, origem.id, usuario), arquivos);
  },

  /** Uma foto do relatório: o conteúdo e o tipo. */
  async lerFoto(id: string, arquivo: string) {
    await doRelatorio(id);
    return arquivosDosSlides.lerFoto(pastaDasFotos(id), arquivo);
  },

  /**
   * Guarda um vídeo do relatório (20/10/2026; quem edita a tela; até 200 MB, MP4, WebM, MOV, M4V ou OGG), gravado no disco
   * enquanto chega, e devolve o nome do arquivo.
   */
  async salvarVideo(id: string, corpo: Readable, tipo: string, tamanho: number | null, usuario: UsuarioDoRelatorio) {
    await doRelatorio(id);
    if (!usuario.edita) throw new SlidesError(403, "Seu perfil não edita os relatórios.");
    return arquivosDosSlides.salvarVideo(pastaDasFotos(id), corpo, tipo, tamanho);
  },

  /** Um vídeo do relatório (20/10/2026): o caminho no disco, o tamanho e o tipo (o controller o envia em partes, pelo Range). */
  async lerVideo(id: string, arquivo: string) {
    await doRelatorio(id);
    return arquivosDosSlides.lerVideo(pastaDasFotos(id), arquivo);
  },

  /** Exclui o relatório (quem o criou ou o Administrador), enquanto nenhuma aba estiver finalizada. */
  async excluir(id: string, usuario: UsuarioDoRelatorio) {
    const r = await doRelatorio(id);
    if ((r.criadoPorId !== usuario.id && !usuario.admin) || !usuario.edita) throw new SlidesError(403, `Só quem criou o relatório (${r.criadoPorNome}) ou o Administrador o exclui.`);
    if (r.abas.some((a) => a.situacao === "FINALIZADO")) throw new SlidesError(409, "O relatório tem abas finalizadas: reabra-as antes de excluir.");
    await getPrismaClient().relatorioExecutivo.delete({ where: { id } });
    await rm(pastaDasFotos(id), { recursive: true, force: true });
    await auditoriaEmSequencia.encerrar(`${id}|`);
    await auditar({ usuarioId: usuario.id, usuarioNome: usuario.nome, acao: "EXCLUSAO", entidade: "relatorio_executivo", entidadeId: id, metadados: { mes: rotuloMes(r.ano, r.mes) } });
    return { excluido: true };
  },
};
