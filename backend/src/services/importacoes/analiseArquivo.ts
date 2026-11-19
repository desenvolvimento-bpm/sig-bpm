import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { getPrismaClient } from "../../config/prisma.js";
import type { StatusCompetencia, TipoImportacao } from "../../generated/prisma/enums.js";
import { ArquivoInvalidoError, lerAba, listarAbas, type LinhaPlanilha } from "../../lib/xlsx.js";
import { caminhoDoArquivo } from "./arquivosImportados.js";
import { ABA_BALANCETE, conferirTotal, interpretarBalancete } from "./balancete/leiauteBalancete.js";
import { ABA_DRE_COMERCIAL, interpretarDreComercial } from "./dreComercial/leiauteDreComercial.js";
import { DEFINICOES_LISTAS } from "./listas/definicoesListas.js";
import { DEFINICOES_LISTAS_RECEITA } from "./listas/definicoesListasReceita.js";
import { localizarCabecalho } from "./listas/leituraListas.js";
import { carregarNomesDoSistema } from "../relatorios/indicadoresDoSistema.js";
import { DEFINICOES_INDICADORES, atualizarNomesDasMetas, lerIndicadores, recusaPorNomesAntigos, type TipoIndicadores } from "./indicadores/leituraIndicadores.js";
import { ABA_LOTACAO, lerLotacao, ROTULO_LOTACAO } from "./lotacao/leituraLotacao.js";
import { escolherAba } from "./statusImportacao.js";
import { DEFINICOES_DOCUMENTOS, lerDocumentos, type TipoDocumentos } from "./documentos/leituraDocumentos.js";
import { ABA_CREDITOS, lerCreditos, ROTULO_CREDITOS } from "./impostos/leituraCreditos.js";
import { plural } from "../../utils/plural.js";

/**
 * A leitura prévia de um arquivo com várias abas (importação em lote): associa
 * cada aba ao tipo de arquivo pelo nome, confere a estrutura com as mesmas
 * regras do processamento e compara, mês a mês, o que o arquivo traz com o
 * que está importado — o mês da competência e os meses anteriores do ano. Nada
 * é gravado: o usuário vê a prévia e decide importar.
 *
 * A comparação é pelo conteúdo do mês (os registros lidos, sem o número da
 * linha na planilha), relendo o arquivo da importação em vigor: um arquivo
 * salvo de novo, com o mesmo conteúdo no mês, não é reimportado.
 */

/** O que fazer com o mês da aba. */
export type AcaoMes =
  | "IMPORTAR"
  /** Competência fechada: o balancete só é comparado com o gravado (divergências). */
  | "COMPARAR"
  | "SEM_MUDANCA"
  /** Mês anterior já fechado com dados diferentes no arquivo: não é importado, só avisado. */
  | "FECHADA"
  | "INVALIDA";
export type MesDaAba = { anoMes: string; atual: boolean; acao: AcaoMes; registros?: number; mensagem?: string; avisos: string[] };
export type AbaAnalisada = {
  aba: string;
  tipo: TipoImportacao;
  rotulo: string;
  /** IGNORADA: a aba não se importa (fora do setor, mês fechado…); o motivo vai em mensagem. */
  situacao: "ANALISADA" | "IGNORADA" | "INVALIDA";
  mensagem?: string;
  meses: MesDaAba[];
};

export type Competencia = { id: string; ano: number; mes: number; status: StatusCompetencia };
export type Leitura = { registros: number; assinatura: string; avisos: string[] } | null;
type Tipo = {
  tipo: TipoImportacao;
  rotulo: string;
  abas: string[];
  /**
   * POR_MES: o arquivo traz o ano, e cada mês vai para a sua competência;
   * GLOBAL: um conteúdo só (os preços), importado na competência do envio;
   * PRIMEIRO_MES: o saldo inicial do estoque, sempre no primeiro mês da
   * ferramenta (01/2026), de qualquer mês do envio.
   */
  alcance: "POR_MES" | "GLOBAL" | "PRIMEIRO_MES";
  /** Lê o mês; null quando não há nada dele. Lança AbaInvalida com o motivo. */
  ler: (linhas: LinhaPlanilha[], ano: number, mes: number) => Leitura;
};

class AbaInvalida extends Error {}
const anoMesDe = (c: { ano: number; mes: number }) => `${c.ano}-${String(c.mes).padStart(2, "0")}`;
const rotuloMes = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;

/** A assinatura do conteúdo: os itens sem o número da linha, em ordem estável. */
function assinar(itens: unknown[]): string {
  const textos = itens.map((i) => JSON.stringify(i, (k, v) => (k === "linhaArquivo" || k === "linha_arquivo" ? undefined : v))).sort();
  return createHash("sha256").update(textos.join("\n")).digest("hex");
}

const listas: Tipo[] = [...Object.values(DEFINICOES_LISTAS), ...Object.values(DEFINICOES_LISTAS_RECEITA)].map((def) => ({
  tipo: def.tipo as TipoImportacao,
  rotulo: def.rotulo,
  abas: def.abas,
  alcance: "POR_MES",
  ler(linhas, ano, mes) {
    const l = def.interpretar(linhas, ano, mes);
    if (!l.ok) throw new AbaInvalida(l.motivo);
    if (l.registros.length === 0 && l.rejeicoes.length === 0) return null;
    return {
      registros: l.registros.length,
      assinatura: assinar([...l.registros, ...l.rejeicoes.map((r) => ({ codigo: r.codigo, mensagem: r.mensagem }))]),
      avisos: l.rejeicoes.length ? [`${l.rejeicoes.length} ${plural(l.rejeicoes.length, "linha com erro, que não será gravada", "linhas com erro, que não serão gravadas")}.`] : [],
    };
  },
}));

/** Os indicadores do mês (abas Indicadores (Admin.) e (Comercial)): sem a coluna do mês, nada do mês. */
// As metas do orçamento (aba Metas (Orçamento)) não se importam mais no mês: ficam nos cenários (11/10/2026).
const indicadores: Tipo[] = (Object.keys(DEFINICOES_INDICADORES) as TipoIndicadores[]).filter((t) => t !== "METAS_ORCAMENTO").map((tipo) => ({
  tipo,
  rotulo: DEFINICOES_INDICADORES[tipo].rotulo,
  abas: [DEFINICOES_INDICADORES[tipo].aba],
  alcance: "POR_MES",
  ler(linhas, ano, mes) {
    const l = lerIndicadores(tipo, linhas, ano, mes);
    if (!l.ok) {
      if (l.motivo.includes("não tem a coluna")) return null;
      throw new AbaInvalida(l.motivo);
    }
    // Os nomes antigos de indicadores renomeados (19/11/2026) recusam a aba.
    const antigos = recusaPorNomesAntigos(l.rejeicoes);
    if (antigos) throw new AbaInvalida(antigos);
    if (l.valores.length === 0) return null;
    return {
      registros: l.valores.length,
      assinatura: assinar([...l.valores, ...l.rejeicoes.map((r) => ({ codigo: r.codigo, mensagem: r.mensagem }))]),
      avisos: l.rejeicoes.length ? [`${l.rejeicoes.length} ${plural(l.rejeicoes.length, "linha com erro, que não será gravada", "linhas com erro, que não serão gravadas")}.`] : [],
    };
  },
}));

/** As requisições e as notas fiscais do mês (abas Requisições (Lista) e Notas Fiscais (Lista), 11/10/2026). */
const documentos: Tipo[] = (Object.keys(DEFINICOES_DOCUMENTOS) as TipoDocumentos[]).map((tipo) => ({
  tipo,
  rotulo: DEFINICOES_DOCUMENTOS[tipo].rotulo,
  abas: [DEFINICOES_DOCUMENTOS[tipo].aba],
  alcance: "POR_MES",
  ler(linhas, ano, mes) {
    const l = tipo === "REQUISICOES" ? lerDocumentos("REQUISICOES", linhas, ano, mes) : lerDocumentos("NOTAS_FISCAIS", linhas, ano, mes);
    if (!l.ok) throw new AbaInvalida(l.motivo);
    if (l.itens.length === 0) return null;
    return {
      registros: l.itens.length,
      assinatura: assinar([...l.itens, ...l.rejeicoes.map((r) => ({ codigo: r.codigo, mensagem: r.mensagem }))]),
      avisos: l.rejeicoes.length ? [`${l.rejeicoes.length} ${plural(l.rejeicoes.length, "linha com erro, que não será gravada", "linhas com erro, que não serão gravadas")}.`] : [],
    };
  },
}));

/** Os tipos que a importação em lote reconhece, na ordem em que entram na fila. */
const TIPOS: Tipo[] = [
  {
    tipo: "BALANCETE",
    rotulo: "Balancete (TOTVS RM)",
    abas: [ABA_BALANCETE],
    alcance: "POR_MES",
    ler(linhas, ano, mes) {
      const l = interpretarBalancete(linhas, ano, mes);
      if (!l.ok) throw new AbaInvalida(l.motivo);
      if (l.lancamentos.length === 0 && l.rejeicoes.length === 0) return null;
      const total = conferirTotal(l.somaArquivo, l.totalGeral, l.tabelasDoMes);
      if (total) throw new AbaInvalida(total);
      return {
        registros: l.lancamentos.length,
        assinatura: assinar([...l.lancamentos, ...l.rejeicoes.map((r) => ({ codigo: r.codigo, mensagem: r.mensagem }))]),
        avisos: l.rejeicoes.length ? [`${l.rejeicoes.length} ${plural(l.rejeicoes.length, "linha com erro, que não será gravada", "linhas com erro, que não serão gravadas")}.`] : [],
      };
    },
  },
  ...listas,
  // Os colaboradores do mês por centro de custo (19/10/2026): a referência do quadro de lotação dos cenários analíticos.
  {
    tipo: "QUADRO_LOTACAO",
    rotulo: ROTULO_LOTACAO,
    abas: [ABA_LOTACAO],
    alcance: "POR_MES",
    ler(linhas, ano, mes) {
      const l = lerLotacao(linhas, ano, mes);
      if (!l.ok) throw new AbaInvalida(l.motivo);
      if (l.itens.length === 0 && l.rejeicoes.length === 0) return null;
      return {
        registros: l.itens.length,
        assinatura: assinar([...l.itens, ...l.rejeicoes.map((r) => ({ codigo: r.codigo, mensagem: r.mensagem }))]),
        avisos: l.rejeicoes.length ? [`${l.rejeicoes.length} ${plural(l.rejeicoes.length, "linha com erro, que não será gravada", "linhas com erro, que não serão gravadas")}.`] : [],
      };
    },
  },
  ...indicadores,
  // As abas Requisições (Lista) e Notas Fiscais (Lista) saíram do LISTAS REALIZADO (RESULTADOS) em 15/10/2026 e voltaram
  // em 26/10/2026: a tarefa dos itens leva os custos às linhas (a etapa Linhas da apuração).
  ...documentos,
  // O Creditado e o Estornado do mês por unidade e conta (04/11/2026): os Créditos de Impostos.
  {
    tipo: "CREDITOS_IMPOSTOS",
    rotulo: ROTULO_CREDITOS,
    abas: [ABA_CREDITOS],
    alcance: "POR_MES",
    ler(linhas, ano, mes) {
      const l = lerCreditos(linhas, ano, mes);
      if (!l.ok) throw new AbaInvalida(l.motivo);
      if (l.itens.length === 0 && l.rejeicoes.length === 0) return null;
      return {
        registros: l.itens.length,
        assinatura: assinar([...l.itens, ...l.rejeicoes.map((r) => ({ codigo: r.codigo, mensagem: r.mensagem }))]),
        avisos: l.rejeicoes.length ? [`${l.rejeicoes.length} ${plural(l.rejeicoes.length, "linha com erro, que não será gravada", "linhas com erro, que não serão gravadas")}.`] : [],
      };
    },
  },
  {
    tipo: "DRE_COMERCIAL",
    rotulo: "DRE do Comercial",
    abas: [ABA_DRE_COMERCIAL],
    alcance: "GLOBAL",
    ler(linhas) {
      const l = interpretarDreComercial(linhas);
      if (!l.ok) throw new AbaInvalida(l.motivo);
      if (l.precos.length === 0) throw new AbaInvalida("A aba não tem nenhuma linha de preço.");
      return { registros: l.precos.length, assinatura: assinar(l.precos), avisos: [] };
    },
  },
  {
    tipo: "ESTOQUE_INICIAL",
    rotulo: "Saldo inicial do estoque",
    abas: ["Estoque (2025)"],
    alcance: "PRIMEIRO_MES",
    ler(linhas) {
      const cab = localizarCabecalho(linhas, ["OBRA", "LINHA", "VOLUME (M³)", "TOTAL FISCAL (R$)"], ["NOME DA OBRA"]);
      if ("erro" in cab) throw new AbaInvalida(cab.erro);
      const dados = linhas.filter((l) => l.numero > cab.numero);
      if (dados.length === 0) throw new AbaInvalida("A aba não tem nenhum saldo.");
      return { registros: dados.length, assinatura: assinar(dados.map((l) => l.celulas)), avisos: [] };
    },
  },
];

const mesmaAba = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * A assinatura do que está em vigor: relê o arquivo da importação vigente do
 * tipo na competência (ou, nos preços, a última de qualquer competência).
 * null quando não há importação em vigor (ou o arquivo dela não existe mais).
 */
async function assinaturaEmVigor(t: Tipo, c: Competencia, cache: Map<string, LinhaPlanilha[] | null>): Promise<string | null> {
  const prisma = getPrismaClient();
  const vigente = await prisma.importacao.findFirst({
    where: {
      tipo: t.tipo,
      status: "CONCLUIDA",
      comparacao: false,
      substituidaEm: null,
      ...(t.alcance === "GLOBAL" ? {} : { competenciaId: c.id }),
    },
    orderBy: { importadoEm: "desc" },
    select: { hashArquivo: true, resumo: true },
  });
  if (!vigente) return null;
  // Em vigor uma importação de outra aba (a Lista, antes do Resumo de 09/10/2026): não há o que comparar, o mês se importa.
  const abaVigente = (vigente.resumo as { aba?: unknown } | null)?.aba;
  if (typeof abaVigente === "string" && !t.abas.some((a) => mesmaAba(a, abaVigente))) return null;
  const chave = `${vigente.hashArquivo}|${t.tipo}`;
  if (!cache.has(chave)) {
    try {
      cache.set(chave, lerAba(await readFile(caminhoDoArquivo(vigente.hashArquivo)), escolherAba(t.abas)).linhas);
    } catch {
      cache.set(chave, null);
    }
  }
  const linhas = cache.get(chave);
  if (!linhas) return null;
  try {
    return t.ler(linhas, c.ano, c.mes)?.assinatura ?? null;
  } catch {
    return null;
  }
}

/** De onde a análise tira as competências e o que está em vigor (o banco; nos testes, dados fixos). */
export type FontesAnalise = {
  /** As competências do ano até o mês do envio, em ordem. */
  doAno: (origem: Competencia) => Promise<Competencia[]>;
  /** O primeiro mês da ferramenta, que guarda o saldo inicial do estoque. */
  primeira: () => Promise<Competencia | null>;
  /** A assinatura do conteúdo em vigor do tipo no mês, ou null. */
  assinaturaEmVigor: (tipo: TipoImportacao, c: Competencia, ler: (linhas: LinhaPlanilha[], ano: number, mes: number) => Leitura, abas: string[], global: boolean) => Promise<string | null>;
};

const fontesDoBanco = (): FontesAnalise => {
  const cache = new Map<string, LinhaPlanilha[] | null>();
  return {
    doAno: (origem) =>
      getPrismaClient().competencia.findMany({
        where: { ano: origem.ano, mes: { lte: origem.mes } },
        select: { id: true, ano: true, mes: true, status: true },
        orderBy: { mes: "asc" },
      }),
    primeira: () => getPrismaClient().competencia.findFirst({ orderBy: [{ ano: "asc" }, { mes: "asc" }], select: { id: true, ano: true, mes: true, status: true } }),
    assinaturaEmVigor: (tipo, c, ler, abas, global) =>
      assinaturaEmVigor({ tipo, rotulo: "", abas, alcance: global ? "GLOBAL" : "POR_MES", ler }, c, cache),
  };
};

/**
 * Lê o arquivo e devolve, por aba reconhecida, o que fazer em cada mês: o da
 * competência do envio e os anteriores do mesmo ano. `alcanca` diz se o
 * usuário importa o tipo (recorte por setor).
 *
 * `soTipo` (o Importar da linha do tipo, 06/11/2026): só a aba desse tipo, sem as outras do arquivo. Como no envio de
 * um tipo (escolherAba), serve também a pasta de trabalho de uma aba só, de qualquer nome; sem a aba, o arquivo é recusado.
 */
export async function analisarArquivo(
  conteudo: Uint8Array,
  origem: Competencia,
  alcanca: (tipo: TipoImportacao) => boolean,
  fontes: FontesAnalise = fontesDoBanco(),
  soTipo?: TipoImportacao,
) {
  // Os nomes dos indicadores do cadastro, para a aba das metas.
  await atualizarNomesDasMetas();
  await carregarNomesDoSistema();
  let nomes: string[];
  try {
    nomes = listarAbas(conteudo);
  } catch (error) {
    throw new ArquivoInvalidoError(error instanceof Error ? error.message : "O arquivo não é uma planilha .xlsx válida.");
  }
  // O mês do envio e os anteriores do ano, que o arquivo também traz.
  const doAno = await fontes.doAno(origem);
  const primeira = await fontes.primeira();
  const fechada = origem.status === "FECHADA";

  const abas: AbaAnalisada[] = [];
  const reconhecidas = new Set<string>();
  for (const t of TIPOS) {
    if (soTipo && t.tipo !== soTipo) continue;
    const aba = nomes.find((n) => t.abas.some((a) => mesmaAba(n, a))) ?? (soTipo && nomes.length === 1 ? nomes[0] : undefined);
    if (!aba) {
      if (soTipo) throw new ArquivoInvalidoError(`O arquivo não tem a aba ${t.abas[0]}. Escolha o arquivo com essa aba ou uma pasta de trabalho só com ela.`);
      continue;
    }
    reconhecidas.add(aba);
    const base = { aba, tipo: t.tipo, rotulo: t.rotulo, meses: [] as MesDaAba[] };
    if (!alcanca(t.tipo)) {
      abas.push({ ...base, situacao: "IGNORADA", mensagem: "Tipo de arquivo fora dos seus setores." });
      continue;
    }
    if (fechada && t.tipo !== "BALANCETE") {
      abas.push({ ...base, situacao: "IGNORADA", mensagem: "A competência está fechada: importar exige reabri-la." });
      continue;
    }

    let linhas: LinhaPlanilha[];
    try {
      linhas = lerAba(conteudo, () => aba).linhas;
    } catch (error) {
      if (error instanceof ArquivoInvalidoError) {
        abas.push({ ...base, situacao: "INVALIDA", mensagem: error.message });
        continue;
      }
      throw error;
    }

    // Em mês fechado, só o balancete do próprio mês, para comparar.
    const alvos: Competencia[] =
      t.alcance === "POR_MES" && !fechada ? doAno : t.alcance === "PRIMEIRO_MES" && primeira ? [primeira] : [origem];
    let invalidaNoMes: string | null = null;
    for (const c of alvos) {
      const atual = c.id === origem.id;
      let leitura: Leitura;
      try {
        leitura = t.ler(linhas, c.ano, c.mes);
      } catch (error) {
        if (!(error instanceof AbaInvalida)) throw error;
        if (atual) invalidaNoMes = error.message;
        else base.meses.push({ anoMes: anoMesDe(c), atual, acao: "INVALIDA", mensagem: error.message, avisos: [] });
        continue;
      }
      if (!leitura) continue; // nada deste mês no arquivo
      const mes: MesDaAba = { anoMes: anoMesDe(c), atual, acao: "IMPORTAR", registros: leitura.registros, avisos: leitura.avisos };
      if (atual && fechada) mes.acao = "COMPARAR";
      else if ((await fontes.assinaturaEmVigor(t.tipo, c, t.ler, t.abas, t.alcance === "GLOBAL")) === leitura.assinatura) mes.acao = "SEM_MUDANCA";
      else if (c.status === "FECHADA") {
        mes.acao = "FECHADA";
        mes.mensagem =
          t.tipo === "BALANCETE"
            ? "Competência fechada: as diferenças viram divergências ao importar o balancete do mês atual."
            : "Competência fechada: os dados diferentes do arquivo não são importados.";
      }
      base.meses.push(mes);
    }
    if (invalidaNoMes && !base.meses.some((m) => m.acao === "IMPORTAR")) {
      abas.push({ ...base, situacao: "INVALIDA", mensagem: invalidaNoMes });
      continue;
    }
    abas.push({
      ...base,
      situacao: "ANALISADA",
      mensagem: base.meses.length === 0 ? `A aba não tem registros de ${rotuloMes(origem.ano, origem.mes)} nem de meses anteriores.` : undefined,
    });
  }
  return { abas, outras: soTipo ? [] : nomes.filter((n) => !reconhecidas.has(n)) };
}
