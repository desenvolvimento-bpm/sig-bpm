import { readFile } from "node:fs/promises";

import { getPrismaClient } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { chaveDaLinha } from "../../lib/linhas.js";
import { ArquivoInvalidoError, lerAba } from "../../lib/xlsx.js";
import { caminhoDoArquivo } from "../importacoes/arquivosImportados.js";
import { ABA_DRE_COMERCIAL, interpretarDreVendida, type LinhaVendida } from "../importacoes/dreComercial/leiauteDreComercial.js";
import { avaliarExpressao } from "../dre/expressao.js";
import type { LinhaDRE } from "../resultadosLinha/resultadosLinhaService.js";
import { ehAConta } from "../dre/descricaoDeOrigem.js";

/**
 * O Vendido do Realizado por Obra (03/11/2026, pedido do Adão): a aba DRE do CONTROLE DAS VENDAS importada na competência
 * fechada mais recente (o arquivo guardado da importação), por obra e versão. É provisório: a DRE do Comercial está
 * desatualizada (a maioria das vendas só tem a VER00) e vai sair do novo CRM, pela tela Integrações e Consultas.
 *
 * Cada linha da DRE de venda vai à linha da Estrutura da DRE do SIG pelo DEPTO. (o grupo: C e CF são as despesas variáveis
 * de venda; CPM, os custos de produção) e pela CONTA CONTÁBIL (a descrição): o item de mesmo nome; sem ele, o subtotal de
 * mesmo nome (a DRE de venda não abre a Mão de Obra Direta nem os Gastos Gerais Diretos); sem ele, o subtotal da
 * ATRIBUIÇÃO (Outros Gastos Gerais Variáveis entra em Gastos Gerais Variáveis) e, por último, o subtotal do grupo. Os totais
 * (as linhas "-") e os impostos (IRB, que o SIG calcula como ROB − ROL) ficam de fora, e um subtotal colado inteiro só vale
 * sem os itens dele. Os volumes só entram com a linha de mesmo nome.
 */

const Decimal = Prisma.Decimal;

/** A importação da DRE do Comercial que dá o Vendido: o arquivo e a competência. */
export type FonteDoVendido = { importacaoId: string; hash: string; nomeArquivo: string; importadoEm: Date; ano: number; mes: number };

/** A DRE do Comercial da competência fechada mais recente que a tem: a última importação concluída dela (a em vigor, se houver). */
export async function fonteDoVendido(): Promise<FonteDoVendido | null> {
  const imps = await getPrismaClient().importacao.findMany({
    where: { tipo: "DRE_COMERCIAL", status: "CONCLUIDA", competencia: { status: "FECHADA" } },
    orderBy: [{ competencia: { ano: "desc" } }, { competencia: { mes: "desc" } }, { importadoEm: "desc" }],
    select: { id: true, hashArquivo: true, nomeArquivo: true, importadoEm: true, substituidaEm: true, competencia: { select: { ano: true, mes: true } } },
  });
  if (!imps.length) return null;
  const doMes = imps.filter((i) => i.competencia.ano === imps[0].competencia.ano && i.competencia.mes === imps[0].competencia.mes);
  const i = doMes.find((x) => x.substituidaEm === null) ?? doMes[0];
  return { importacaoId: i.id, hash: i.hashArquivo, nomeArquivo: i.nomeArquivo, importadoEm: i.importadoEm, ano: i.competencia.ano, mes: i.competencia.mes };
}

export class VendidoIndisponivelError extends Error {}

/** As DREs lidas, pelo hash do arquivo (o arquivo de uma importação não muda): as duas últimas. */
const lidas = new Map<string, Promise<Map<string, LinhaVendida[]>>>();

/** As linhas da DRE do arquivo guardado, por obra. */
export function dreDoArquivo(hash: string): Promise<Map<string, LinhaVendida[]>> {
  let p = lidas.get(hash);
  if (!p) {
    p = (async () => {
      let conteudo: Buffer;
      try {
        conteudo = await readFile(caminhoDoArquivo(hash));
      } catch {
        throw new VendidoIndisponivelError("O arquivo da DRE do Comercial importada não está guardado no servidor.");
      }
      let leitura;
      try {
        leitura = interpretarDreVendida(lerAba(conteudo, (abas) => abas.find((a) => a.trim().toUpperCase() === ABA_DRE_COMERCIAL) ?? null).linhas);
      } catch (error) {
        if (error instanceof ArquivoInvalidoError) throw new VendidoIndisponivelError(error.message);
        throw error;
      }
      if (!leitura.ok) throw new VendidoIndisponivelError(leitura.motivo);
      const porObra = new Map<string, LinhaVendida[]>();
      for (const l of leitura.linhas) {
        const k = l.obra.trim().toUpperCase();
        porObra.set(k, [...(porObra.get(k) ?? []), l]);
      }
      return porObra;
    })();
    p.catch(() => lidas.delete(hash));
    lidas.set(hash, p);
    while (lidas.size > 2) lidas.delete(lidas.keys().next().value!);
  }
  return p;
}

const normal = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
/** Os nomes da DRE de venda que diferem dos da Estrutura da DRE. */
const SINONIMOS: Record<string, string> = {
  "PRODUCAO DO PRE-FABRICADO (PST)": "PRODUCAO DO PRE-FABRICADO (PISTAS)",
  "PRODUCAO DA METALURGICA (KG)": "PRODUCAO DA METALURGIA (KG)",
};
/** O grupo da Estrutura da DRE de cada DEPTO. da DRE de venda. */
const GRUPO_DO_DEPTO: Record<string, string> = { C: "DVV", CF: "DVV", CPM: "CPP" };
/** Os grupos que o SIG calcula (os impostos são ROB − ROL): a DRE de venda não entra neles. */
const CALCULADOS = new Set(["IRB"]);
const VOLUMES = new Set(["P", "S"]);

/** A unidade (1 Matriz, 2 Filial, 3 Serviços) da UNIDADE da DRE de venda. */
const UNIDADE: Record<string, number> = { MATRIZ: 1, FILIAL: 2, OBRAS: 3 };

/** Uma linha de produto ou de obra, para achar a da DRE de venda. */
export type LinhaParaVendido = { id: string; nome: string; codigo?: string; unidade: number };
/** A chave da linha do Vendido: o id da linha, ou a das linhas da DRE de venda sem linha no cadastro. */
export const SEM_LINHA_NO_VENDIDO = "SEM_LINHA";

/**
 * A DRE de venda de uma obra e versão na Estrutura da DRE do SIG: por linha (o id; `SEM_LINHA_NO_VENDIDO` a sem linha no
 * cadastro), os valores de cada item, subtotal e total do escopo `noEscopo`; e as contas que não acharam lugar.
 */
export function vendidoNaEstrutura(linhas: LinhaVendida[], est: LinhaDRE[], noEscopo: Set<string>, cadastro: LinhaParaVendido[]) {
  const doGrupo = (g: string) => est.filter((l) => l.grupoSigla === g);
  const naoAchadas = new Set<string>();
  const linhaDoVendido = (l: LinhaVendida) => {
    // Pelo Código da linha e, sem nenhuma, pelo Nome (25/11/2026: o Código não muda; o Nome, sim).
    const texto = chaveDaLinha(l.linhaTexto);
    const peloCodigo = cadastro.filter((c) => c.codigo !== undefined && chaveDaLinha(c.codigo) === texto);
    const candidatas = peloCodigo.length ? peloCodigo : cadastro.filter((c) => chaveDaLinha(c.nome) === texto);
    return (candidatas.find((c) => c.unidade === UNIDADE[normal(l.unidade)]) ?? candidatas[0])?.id ?? SEM_LINHA_NO_VENDIDO;
  };
  type Partes = { itens: Map<string, number>; subtotais: Map<string, number>; extras: Map<string, number> };
  const porLinha = new Map<string, Partes>();
  const somar = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  for (const l of linhas) {
    const atrib = normal(l.atribuicao);
    // As linhas de total coladas (ATRIBUIÇÃO "-").
    if (!atrib || atrib === "-") continue;
    const g = GRUPO_DO_DEPTO[l.departamento] ?? l.departamento;
    if (CALCULADOS.has(g)) continue;
    const linhasDoGrupo = doGrupo(g);
    if (!linhasDoGrupo.length) {
      if (!VOLUMES.has(g)) naoAchadas.add(`${l.departamento} · ${l.conta}`);
      continue;
    }
    const conta = SINONIMOS[normal(l.conta)] ?? normal(l.conta);
    const k = linhaDoVendido(l);
    const p = porLinha.get(k) ?? { itens: new Map(), subtotais: new Map(), extras: new Map() };
    porLinha.set(k, p);
    // Pela Descrição atual ou pela de origem (25/11/2026: os nomes da Estrutura da DRE mudam a qualquer momento).
    const casa = (x: { codigo: string; descricao: string }, texto: string) => normal(x.descricao) === texto || ehAConta(x, texto);
    const subtotalDaAtribuicao = linhasDoGrupo.find((x) => x.tipo === "SUBTOTAL" && casa(x, atrib));
    const itens = linhasDoGrupo.filter((x) => x.tipo === "ITEM" && casa(x, conta));
    const item = itens.find((x) => subtotalDaAtribuicao && x.atribuicaoSigla === subtotalDaAtribuicao.atribuicaoSigla) ?? itens[0];
    if (item) {
      somar(p.itens, item.codigo, l.valorTotal);
      continue;
    }
    if (VOLUMES.has(g)) continue;
    const subtotal = linhasDoGrupo.find((x) => x.tipo === "SUBTOTAL" && casa(x, conta));
    if (subtotal) {
      somar(p.subtotais, subtotal.codigo, l.valorTotal);
      continue;
    }
    // Sem a conta: o subtotal da atribuição ou, por último, o do grupo (o primeiro subtotal dele, sem atribuição).
    const doGrupoInteiro = linhasDoGrupo.find((x) => x.tipo === "SUBTOTAL" && !x.atribuicaoSigla);
    const destino = subtotalDaAtribuicao ?? doGrupoInteiro;
    if (destino) somar(p.extras, destino.codigo, l.valorTotal);
    else naoAchadas.add(`${l.departamento} · ${l.conta}`);
  }
  const valores = new Map<string, Map<string, number>>();
  for (const [k, p] of porLinha) valores.set(k, avaliarVendido(est, p, noEscopo));
  return { valores, naoAchadas: [...naoAchadas].sort() };
}

/**
 * Os valores da estrutura de uma linha do Vendido: os itens; cada subtotal e total pela expressão dele (ou, sem nenhum item
 * com valor embaixo, o subtotal colado inteiro), mais as contas sem item que caíram nele. Só os que têm algum valor.
 */
export function avaliarVendido(est: LinhaDRE[], p: { itens: Map<string, number>; subtotais: Map<string, number>; extras: Map<string, number> }, noEscopo: Set<string>) {
  const porCodigo = new Map(est.map((l) => [l.codigo, l]));
  const valores = new Map<string, number>();
  const feitos = new Map<string, number | undefined>();
  const avaliar = (codigo: string, pilha = new Set<string>()): number | undefined => {
    if (feitos.has(codigo)) return feitos.get(codigo);
    const l = porCodigo.get(codigo);
    if (!l || l.tipo === "SECAO" || pilha.has(codigo)) return undefined;
    let v: number | undefined;
    if (l.tipo === "ITEM") v = p.itens.get(codigo);
    else {
      pilha.add(codigo);
      let algum = false;
      const pelaExpressao = l.expressao
        ? Number(
            avaliarExpressao(l.expressao, (c) => {
              const x = avaliar(c, pilha);
              if (x !== undefined) algum = true;
              return new Decimal(x ?? 0);
            }),
          )
        : 0;
      const base = algum ? pelaExpressao : p.subtotais.get(codigo);
      const extra = p.extras.get(codigo);
      v = base === undefined && extra === undefined ? undefined : (base ?? 0) + (extra ?? 0);
    }
    feitos.set(codigo, v);
    if (v !== undefined && noEscopo.has(codigo)) valores.set(codigo, v);
    return v;
  };
  for (const l of est) if (noEscopo.has(l.codigo)) avaliar(l.codigo);
  return valores;
}

/** As versões da DRE de venda de uma obra (0 é a VER00), em ordem. */
export const versoesDaObra = (linhas: LinhaVendida[]) => [...new Set(linhas.map((l) => l.versao))].sort((a, b) => a - b);
