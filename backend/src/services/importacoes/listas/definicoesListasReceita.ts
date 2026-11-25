import { Prisma } from "../../../generated/prisma/client.js";
import type { TipoImportacao } from "../../../generated/prisma/enums.js";
import type { LinhaPlanilha } from "../../../lib/xlsx.js";
import {
  codigoDaLinhaDeObra,
  data,
  localizarCabecalho,
  mesmoMes,
  normalizar,
  numero,
  obraDe,
  percorrer,
  rejeitar,
  texto,
  vazia,
  type CodigoUnidade,
  type LeituraLista,
  type RegistroLista,
} from "./leituraListas.js";
import { devolucoesDoResumo, saidasDoResumo } from "./leituraResumos.js";
import { nomeDaUnidade } from "../../cadastros/nomesDasUnidades.js";

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/**
 * Leiaute das listas que alimentam só a receita prévia (Passo 12b), das abas
 * do SIG BPM 2026 - LISTAS REALIZADO (OPERAÇÃO): devoluções, saídas e medições.
 * (Obras encerradas e faturamentos só alimentavam a aba Fechamentos
 * (Faturamento), que ficou fora da ferramenta.)
 *
 * Como nas listas dos rateios, as colunas calculadas da planilha (Período,
 * Linha, Créditos, Etiqueta) são refeitas aqui a partir das colunas de origem,
 * com a regra das fórmulas. As linhas que essas fórmulas deixam de fora (sem
 * projeto, ou com linha "-") não são erro: contam como "sem efeito".
 */

export type TipoListaReceita = Extract<TipoImportacao, "DEVOLUCAO" | "SAIDA" | "MEDICAO">;

/** Total de um campo da lista, por unidade, para o resumo da importação. */
export type TotalLista = { codigo: string; rotulo: string; medida: string; quantidade: string };

export type DefinicaoListaReceita = {
  tipo: TipoListaReceita;
  rotulo: string;
  abas: string[];
  interpretar: (linhas: LinhaPlanilha[], ano: number, mes: number) => LeituraLista;
  /** Totais para conferência com as abas de resumo da planilha. */
  totalizar: (registros: RegistroLista[]) => TotalLista[];
};

const comeca = (s: string, ...prefixos: string[]) => prefixos.some((p) => s.startsWith(p));
const ehGlobal = (projeto: string | null) => normalizar(projeto).startsWith("G");
const soma = (...v: Array<Decimal | undefined>) => v.reduce<Decimal>((a, x) => a.plus(x ?? 0), new Decimal(0));

/**
 * Linha da devolução pela descrição do produto e pela filial — a coluna Linha
 * da `Devoluções (Lista)`. A ordem importa: "LUV" começa com L, mas é luva de
 * estaca; e toda peça da Filial 1 é ESTRUTURA.
 */
export function linhaDaDevolucao(descricao: string | null, filial: number | null): string | null {
  const d = normalizar(descricao);
  if (comeca(d, "LMP", "ESC") || filial === 1) return "ESTRUTURA";
  if (comeca(d, "LUV", "ESD", "ES", "E")) return "ESTACAS";
  if (comeca(d, "L", "PA", "TB")) return "ALVEOLARES";
  return null;
}

/**
 * Linha da saída — a coluna Linha da `Saídas (Lista)`: luva de estaca é
 * ESTACAS; sucata é da metalurgia (linha METALÚRGICA, na Matriz); o resto não
 * entra na receita.
 */
export function linhaDaSaida(descricao: string | null): string | null {
  const d = normalizar(descricao);
  if (d.startsWith("LUV")) return "ESTACAS";
  if (d.includes("SUCATA")) return "METALÚRGICA";
  return null;
}

/** Soma por unidade de um campo dos registros: o formato do resumo. */
function totalPorUnidade(
  registros: RegistroLista[],
  campo: (r: RegistroLista) => Decimal | null | undefined,
  rotulo: string,
  medida: string,
): TotalLista[] {
  const porUnidade = new Map<CodigoUnidade | null, Decimal>();
  for (const r of registros) porUnidade.set(r.unidade, (porUnidade.get(r.unidade) ?? new Decimal(0)).plus(campo(r) ?? 0));
  return [...porUnidade]
    .sort(([a], [b]) => (a ?? 9) - (b ?? 9))
    .map(([u, v]) => ({ codigo: `${rotulo}|${u}`, rotulo: `${rotulo} — ${u ? nomeDaUnidade(u) : "sem unidade"}`, medida, quantidade: v.toFixed(2) }));
}

const valor = (r: RegistroLista) => r.campos.valor as Decimal | null;
const creditos = (r: RegistroLista) => r.campos.creditos as Decimal | null;

// ---------------------------------------------------------------------------

const devolucoes: DefinicaoListaReceita = {
  tipo: "DEVOLUCAO",
  rotulo: "Devoluções",
  abas: ["Devoluções (Resumo)"],
  interpretar(linhas, ano, mes) {
    // Desde 09/10/2026, a aba Devoluções (Resumo); o leiaute da lista continua aceito.
    const resumo = devolucoesDoResumo(linhas, ano, mes);
    if (resumo) return resumo;
    const cab = localizarCabecalho(
      linhas,
      ["DATA EMISSÃO", "NOTA FISCAL", "PROJETO", "FILIAL", "DESCRIÇÃO", "QUANTIDADE", "VLR. TOTAL", "MOVIMENTO", "VLR. ICMS", "VLR. PIS", "VLR. COFINS"],
      ["CÓD. PRODUTO", "CLIENTE", "TIPO MOVIMENTO"],
    );
    if ("erro" in cab) return { ok: false, motivo: cab.erro };
    const k = cab.col;
    return percorrer(linhas, cab.numero, (l, c) => {
      if (vazia(c(k["DATA EMISSÃO"]))) return { tipo: "vazia" };
      const projeto = texto(c(k.PROJETO));
      // Período: sem projeto, a linha fica de fora (coluna Período vazia).
      if (!projeto) return { tipo: "semEfeito" };
      const d = data(c(k["DATA EMISSÃO"]));
      if (!d) return rejeitar(l.numero, "DATA_INVALIDA", `Data de emissão "${c(k["DATA EMISSÃO"])}" inválida.`);
      if (!mesmoMes(d, ano, mes)) return { tipo: "outroMes" };
      const filial = numero(c(k.FILIAL));
      const descricao = texto(c(k["DESCRIÇÃO"]));
      const linha = linhaDaDevolucao(descricao, filial ? filial.toNumber() : null);
      if (!linha) return { tipo: "semEfeito" };
      const [qtd, total, icms, pis, cofins] = ["QUANTIDADE", "VLR. TOTAL", "VLR. ICMS", "VLR. PIS", "VLR. COFINS"].map((n) => numero(c(k[n])));
      if (!qtd || !total || !icms || !pis || !cofins) return rejeitar(l.numero, "VALOR_INVALIDO", "Quantidade, valor ou imposto não é número.");
      return {
        tipo: "registros",
        registros: [{
          linhaArquivo: l.numero,
          obra: obraDe(projeto, null),
          unidade: linha === "ESTRUTURA" ? 1 : 2,
          linha: { tipo: "PRODUTO", codigo: linha },
          quantidade: qtd,
          campos: {
            data: d,
            notaFiscal: texto(c(k["NOTA FISCAL"])),
            filial: filial ? filial.toNumber() : null,
            codigoProduto: texto(c(k["CÓD. PRODUTO"])),
            descricao,
            movimento: texto(c(k.MOVIMENTO)),
            nomeMovimento: texto(c(k["TIPO MOVIMENTO"])),
            valor: total,
            // Créditos (R$): em obra de venda global, zero.
            creditos: ehGlobal(projeto) ? new Decimal(0) : soma(icms, pis, cofins),
            unidadeMedida: "UND",
          },
        }],
      };
    });
  },
  totalizar: (r) => [...totalPorUnidade(r, valor, "Valor", "R$"), ...totalPorUnidade(r, creditos, "Deduções", "R$")],
};

const saidas: DefinicaoListaReceita = {
  tipo: "SAIDA",
  rotulo: "Saídas",
  abas: ["Saídas (Resumo)"],
  interpretar(linhas, ano, mes) {
    // Desde 09/10/2026, a aba Saídas (Resumo); o leiaute da lista continua aceito.
    const resumo = saidasDoResumo(linhas, ano, mes);
    if (resumo) return resumo;
    const cab = localizarCabecalho(
      linhas,
      ["DATA_EMISSAO", "NF", "PROJETO", "FILIAL", "DESCRICAO_ITEM", "QTD", "VLR_TOTAL", "MOVIMENTO", "ICMS_VLR", "PIS_VLR", "COFINS_VLR"],
      ["CD_PRODUTO", "NM_TIPO_MOV"],
    );
    if ("erro" in cab) return { ok: false, motivo: cab.erro };
    const k = cab.col;
    return percorrer(linhas, cab.numero, (l, c) => {
      if (vazia(c(k.DATA_EMISSAO))) return { tipo: "vazia" };
      const projeto = texto(c(k.PROJETO));
      const descricao = texto(c(k.DESCRICAO_ITEM));
      const sucata = normalizar(descricao).includes("SUCATA");
      // Período: a sucata entra mesmo sem projeto; o resto, só com projeto.
      if (!sucata && !projeto) return { tipo: "semEfeito" };
      const d = data(c(k.DATA_EMISSAO));
      if (!d) return rejeitar(l.numero, "DATA_INVALIDA", `Data de emissão "${c(k.DATA_EMISSAO)}" inválida.`);
      if (!mesmoMes(d, ano, mes)) return { tipo: "outroMes" };
      const linha = linhaDaSaida(descricao);
      if (!linha) return { tipo: "semEfeito" };
      const [qtd, total, icms, pis, cofins] = ["QTD", "VLR_TOTAL", "ICMS_VLR", "PIS_VLR", "COFINS_VLR"].map((n) => numero(c(k[n])));
      if (!qtd || !total || !icms || !pis || !cofins) return rejeitar(l.numero, "VALOR_INVALIDO", "Quantidade, valor ou imposto não é número.");
      const filial = numero(c(k.FILIAL));
      return {
        tipo: "registros",
        registros: [{
          linhaArquivo: l.numero,
          obra: obraDe(projeto, null),
          // A sucata é da metalurgia, na Matriz; a luva de estaca, da Filial.
          unidade: linha === "METALÚRGICA" ? 1 : 2,
          linha: { tipo: "PRODUTO", codigo: linha },
          quantidade: qtd,
          campos: {
            data: d,
            notaFiscal: texto(c(k.NF)),
            filial: filial ? filial.toNumber() : null,
            codigoProduto: texto(c(k.CD_PRODUTO)),
            descricao,
            movimento: texto(c(k.MOVIMENTO)),
            nomeMovimento: texto(c(k.NM_TIPO_MOV)),
            valor: total,
            // Créditos (R$): zero em obra global e sem projeto.
            creditos: !projeto || ehGlobal(projeto) ? new Decimal(0) : soma(icms, pis, cofins),
            unidadeMedida: "UND",
          },
        }],
      };
    });
  },
  totalizar: (r) => [...totalPorUnidade(r, valor, "Valor", "R$"), ...totalPorUnidade(r, creditos, "Deduções", "R$")],
};

const medicoes: DefinicaoListaReceita = {
  tipo: "MEDICAO",
  rotulo: "Medições",
  abas: ["Medições"],
  interpretar(linhas, ano, mes) {
    const cab = localizarCabecalho(
      linhas,
      ["PERÍODO", "PROJETO", "LINHA", "TIPO DE FATURAMENTO", "FAT. BPM (R$)", "EXEC. (ANT.)", "EXEC. (ATUAL)"],
      ["CLIENTE", "OBRA", "LANÇAMENTO"],
    );
    if ("erro" in cab) return { ok: false, motivo: cab.erro };
    const k = cab.col;
    return percorrer(linhas, cab.numero, (l, c) => {
      if (vazia(c(k["PERÍODO"]))) return { tipo: "vazia" };
      const d = data(c(k["PERÍODO"]));
      if (!d) return rejeitar(l.numero, "DATA_INVALIDA", `Período "${c(k["PERÍODO"])}" inválido.`);
      if (!mesmoMes(d, ano, mes)) return { tipo: "outroMes" };
      const [fat, ant, atual] = ["FAT. BPM (R$)", "EXEC. (ANT.)", "EXEC. (ATUAL)"].map((n) => numero(c(k[n])));
      if (!fat || !ant || !atual) return rejeitar(l.numero, "VALOR_INVALIDO", "Faturamento ou percentual de execução não é número.");
      const diferenca = atual.minus(ant);
      const linha = codigoDaLinhaDeObra(c(k.LINHA));
      return {
        tipo: "registros",
        registros: [{
          linhaArquivo: l.numero,
          obra: obraDe(c(k.PROJETO), c(k.OBRA)),
          unidade: 3,
          linha: linha ? { tipo: "OBRA", codigo: linha } : null,
          // Exec. (Dif.) e, multiplicada pelo Fat. BPM, a ROB Serviços (R$).
          quantidade: diferenca,
          campos: {
            tipoLancamento: texto(c(k["LANÇAMENTO"])),
            cliente: texto(c(k.CLIENTE)),
            tipoFaturamento: texto(c(k["TIPO DE FATURAMENTO"])),
            valorFaturamento: fat,
            execucaoAnterior: ant,
            execucaoAtual: atual,
            valorMedido: diferenca.times(fat),
            unidadeMedida: "UND",
          },
        }],
      };
    });
  },
  totalizar: (r) => totalPorUnidade(r, (x) => x.campos.valorMedido as Decimal, "ROB Serviços", "R$"),
};

export const DEFINICOES_LISTAS_RECEITA: Record<TipoListaReceita, DefinicaoListaReceita> = {
  DEVOLUCAO: devolucoes,
  SAIDA: saidas,
  MEDICAO: medicoes,
};

export function ehListaReceita(tipo: TipoImportacao): tipo is TipoListaReceita {
  return tipo in DEFINICOES_LISTAS_RECEITA;
}
