import type {
  AtribuicaoCusto,
  BaldeAlocacao,
  TipoConta,
  TipoLinhaDRE,
} from "../../../generated/prisma/enums.js";
import {
  AJUSTES_CONTA,
  CENTRO_CUSTO_CONTROLADORIA,
  CENTRO_CUSTO_DESCARTAR,
  CENTRO_CUSTO_RENOMEAR,
} from "./ajustesCarga.js";
import type { LinhaBrutaDRE, LinhaCentroCusto, LinhaContaResultado, PlanilhaCadastros } from "./planilhaCadastros.js";
// O slug dos códigos das linhas da DRE, o mesmo das regras pela descrição de origem (25/11/2026).
import { slugDaDRE as slug } from "../../dre/descricaoDeOrigem.js";

/**
 * Da planilha ao que vai para o banco, sem tocar no banco: é o que permite
 * mostrar ao Contábil o que muda antes de gravar. A gravação está em
 * aplicarCarga.ts.
 */

export type Aviso = { origem: string; chave: string; motivo: string };

/** "-" e vazio são ausência de valor nas planilhas. */
function texto(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = v.trim();
  return s === "" || s === "-" ? null : s;
}

function inteiro(v: string | null | undefined): number | null {
  const s = texto(v);
  if (s === null) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** A coluna RATEIO carrega chaves de rateio e baldes diretos; o enum não tem acento. */
const BALDES: Record<string, BaldeAlocacao> = {
  PROJETO: "PROJETO", PRODUÇÃO: "PRODUCAO", PRODUCAO: "PRODUCAO", METALURGIA: "METALURGIA",
  ARMADURA: "ARMADURA", ACOMPANHAMENTO: "ACOMPANHAMENTO", UNIDADE: "UNIDADE", MATRIZ: "MATRIZ",
  FILIAL: "FILIAL", OBRAS: "OBRAS", COMPLEMENTAR: "COMPLEMENTAR", DESPESAS: "DESPESAS",
  EXTRA: "EXTRA", RN: "RN", LEBEN: "LEBEN",
};

function balde(v: string | null | undefined, origem: string, chave: string, avisos: Aviso[]) {
  const s = texto(v);
  if (s === null) return null;
  const b = BALDES[s.toUpperCase()];
  if (!b) avisos.push({ origem, chave, motivo: `rateio desconhecido: "${s}"` });
  return b ?? null;
}

// -----------------------------------------------------------------------------
// Centros de custo
// -----------------------------------------------------------------------------

export type CentroAlvo = {
  codigoRM: string | null;
  dados: {
    coligada: number | null;
    nomeRM: string;
    nomeControladoria: string | null;
    departamento: string | null;
    departamentoSigla: string | null;
    atribuicao: AtribuicaoCusto | null;
    atribuicaoSigla: string | null;
    balde: BaldeAlocacao | null;
    ordem: number;
  };
};

function prepararCentros(linhas: LinhaCentroCusto[], avisos: Aviso[], usados: Set<string>) {
  const alvos: CentroAlvo[] = [];
  let ignorados = 0;
  let descartados = 0;
  for (const [i, l] of linhas.entries()) {
    let codigoRM = texto(l["CÓDIGO RM"]);
    const nomeRM = texto(l["CENTRO DE CUSTO (RM)"]);
    // Sem código e sem nome não é centro: é o fim da tabela ou uma linha só com
    // "-" (a linha 155 da aba Centros de Custo, depois do último centro, na 154).
    if (!nomeRM && !codigoRM) continue;
    if (!nomeRM) {
      ignorados++;
      avisos.push({ origem: "centros de custo", chave: codigoRM ?? `linha ${i + 2}`, motivo: "sem nome" });
      continue;
    }
    const descarte = CENTRO_CUSTO_DESCARTAR.find((d) => d.codigo === codigoRM && d.nomeRM === nomeRM);
    if (descarte) {
      usados.add(`descartar:${descarte.codigo}:${descarte.nomeRM}`);
      descartados++;
      continue;
    }
    const renomear = CENTRO_CUSTO_RENOMEAR.find((r) => r.codigo === codigoRM && r.nomeRM === nomeRM);
    if (renomear) {
      usados.add(`renomear:${renomear.codigo}:${renomear.nomeRM}`);
      codigoRM = renomear.novoCodigo;
    }
    const controladoria = CENTRO_CUSTO_CONTROLADORIA.find((c) => c.codigo === texto(l["CÓDIGO RM"]) && c.nomeRM === nomeRM);
    if (controladoria) usados.add(`controladoria:${controladoria.codigo}:${controladoria.nomeRM}`);

    const atrTexto = texto(l["ATRIBUIÇÃO"])?.toUpperCase();
    const atribuicao: AtribuicaoCusto | null = atrTexto === "DIRETA" || atrTexto === "INDIRETA" ? atrTexto : null;
    if (atrTexto && !atribuicao) {
      avisos.push({ origem: "centros de custo", chave: codigoRM ?? nomeRM, motivo: `atribuição desconhecida: "${atrTexto}"` });
    }
    alvos.push({
      codigoRM,
      dados: {
        coligada: inteiro(l.COLIGADA),
        nomeRM,
        nomeControladoria: controladoria?.nomeControladoria ?? texto(l["CENTRO DE CUSTO (CONTROLADORIA)"]),
        departamento: texto(l.DEPARTAMENTO),
        departamentoSigla: texto(l["DEP."]),
        atribuicao,
        atribuicaoSigla: texto(l["ATR."]),
        balde: balde(l.RATEIO, "centros de custo", codigoRM ?? nomeRM, avisos),
        ordem: i + 1,
      },
    });
  }
  return { alvos, lidos: linhas.length, ignorados, descartados };
}

// -----------------------------------------------------------------------------
// Contas de resultado
// -----------------------------------------------------------------------------

export type ContaAlvo = {
  reduzido: string;
  dados: {
    conta: string;
    descricao: string;
    tipoConta: TipoConta;
    departamento: string | null;
    atribuicao: string | null;
    balde: BaldeAlocacao | null;
    ordem: number;
  };
  /** A tripla (departamento, atribuição, conta DRE) que liga a conta à linha da DRE. */
  destino: string | null;
};

function prepararContas(linhas: LinhaContaResultado[], avisos: Aviso[], usados: Set<string>) {
  const alvos: ContaAlvo[] = [];
  let ignorados = 0;
  for (const [i, l] of linhas.entries()) {
    // O reduzido é TEXTO: além dos códigos do ERP, carrega as contas RN.* e .D.
    const reduzido = texto(l.CD_REDUZIDO);
    const conta = texto(l.CONTA);
    const descricao = texto(l.DESCRICAO);
    if (!reduzido || !conta || !descricao) {
      ignorados++;
      avisos.push({ origem: "contas de resultado", chave: conta ?? `linha ${i + 2}`, motivo: "sem reduzido, conta ou descrição" });
      continue;
    }
    const tipoTexto = texto(l.TIPO_CONTA)?.toUpperCase();
    const tipoConta: TipoConta = tipoTexto === "ANALITICA" ? "ANALITICA" : "SINTETICA";
    if (tipoTexto && tipoTexto !== "ANALITICA" && tipoTexto !== "SINTETICA") {
      avisos.push({ origem: "contas de resultado", chave: conta, motivo: `tipo de conta desconhecido: "${tipoTexto}" — tratado como SINTETICA` });
    }
    const ajuste = AJUSTES_CONTA.find((a) => a.reduzido === reduzido);
    if (ajuste) usados.add(`conta:${reduzido}`);
    const departamento = ajuste?.departamento ?? texto(l.DEPARTAMENTO);
    const atribuicao = ajuste?.atribuicao ?? texto(l["ATRIBUIÇÃO"]);
    const contaDRE = ajuste?.contaDRE ?? texto(l["CONTA DRE"]);
    alvos.push({
      reduzido,
      dados: { conta, descricao, tipoConta, departamento, atribuicao, balde: balde(l.RATEIO, "contas de resultado", conta, avisos), ordem: i + 1 },
      destino: contaDRE ? [departamento, atribuicao, contaDRE].map((x) => x ?? "").join("|") : null,
    });
  }
  return { alvos, lidos: linhas.length, ignorados };
}

// -----------------------------------------------------------------------------
// Estrutura da DRE
//
// A planilha não tem um código estável por linha — a identidade é a posição.
// Aqui cada linha ganha um código derivado de grupo, atribuição e descrição, e
// as expressões de subtotal passam a referenciar esses códigos:
//  1. SUM(B28:B76)/2 vira a soma dos filhos diretos — o /2 existia porque o
//     intervalo continha itens e subtotais, contando cada valor duas vezes;
//  2. as unidades de cada linha saem da própria fórmula ('Realizado (Matriz)'!B4
//     + 'Realizado (Filial)'!B4 se aplica às duas); subtotais herdam dos filhos.
// -----------------------------------------------------------------------------

export type LinhaDREAlvo = {
  codigo: string;
  dados: {
    ordem: number;
    grupo: string;
    grupoSigla: string;
    atribuicao: string | null;
    atribuicaoSigla: string | null;
    descricao: string;
    tipo: TipoLinhaDRE;
    expressao: string | null;
    definicao: string | null;
  };
  /** Os códigos das unidades (cadastro Unidades de Negócio) em que a linha aparece (25/11/2026; antes, os nomes). */
  unidades: number[];
};


/**
 * A aba Realizado (…) de cada unidade → o código da unidade no cadastro (25/11/2026: o nome da unidade muda a qualquer
 * momento; as abas da planilha, não).
 */
const ABA_PARA_UNIDADE: Record<string, number> = {
  "Realizado (Matriz)": 1,
  "Realizado (Filial)": 2,
  "Realizado (Serviços)": 3,
  "Realizado (Desp.+Extra)": 4,
  "Realizado (RN)": 5,
};
const REF_UNIDADE = /'(Realizado \([^)]*\))'!B(\d+)/g;
/**
 * Os grupos da DRE do Extra-Operacional (27/11/2026, o teste da separação): a aba Realizado (Desp.+Extra) da planilha dá a
 * unidade 4 (Despesas) às contas das despesas e a 6 (Extra-Operacional) às de DML em diante.
 */
const GRUPOS_DO_EXTRA = new Set(["DML", "NOPAT", "RFC", "RFNC", "DFC", "DFNC"]);
const SOMA_INTERVALO = /^SUM\(B(\d+):B(\d+)\)(\/2)?$/;
const REF_LOCAL = /\bB(\d+)\b/g;

type Classificada = LinhaBrutaDRE & {
  tipo: TipoLinhaDRE;
  codigo: string;
  unidades: Set<number>;
  intervalo: [number, number] | null;
  referencias: number[];
};

function prepararDre(brutas: LinhaBrutaDRE[], avisos: Aviso[]) {
  // A linha 1 é o cabeçalho da planilha, não uma linha da DRE.
  const classificadas: Classificada[] = brutas
    .filter((l) => l.linhaPlanilha > 1 && texto(l.descricao))
    .map((l) => {
      const f = l.formula?.trim() ?? null;
      const unidades = new Set<number>();
      let tipo: TipoLinhaDRE = "SECAO";
      let intervalo: [number, number] | null = null;
      const referencias: number[] = [];
      if (f) {
        const refs = [...f.matchAll(REF_UNIDADE)];
        if (refs.length > 0) {
          tipo = "ITEM";
          for (const m of refs) {
            const u = ABA_PARA_UNIDADE[m[1]];
            if (u) unidades.add(u === 4 && GRUPOS_DO_EXTRA.has(texto(l.grupoSigla) ?? "") ? 6 : u);
            // A Leben (27/11/2026): as mesmas contas do RN (a planilha não tem a aba dela).
            if (u === 5) unidades.add(7);
          }
        } else {
          const soma = f.match(SOMA_INTERVALO);
          if (soma) {
            tipo = "SUBTOTAL";
            intervalo = [Number(soma[1]), Number(soma[2])];
          } else if (/\bB\d+\b/.test(f)) {
            tipo = "TOTAL";
            for (const m of f.matchAll(REF_LOCAL)) referencias.push(Number(m[1]));
          }
        }
      }
      return { ...l, tipo, codigo: "", unidades, intervalo, referencias };
    });
  const porLinha = new Map(classificadas.map((c) => [c.linhaPlanilha, c]));

  // Códigos estáveis e únicos.
  const usados = new Set<string>();
  for (const c of classificadas) {
    const partes = [texto(c.grupoSigla), texto(c.atribuicaoSigla), texto(c.descricao)].filter((p): p is string => p !== null);
    const base = partes.map(slug).join(".") || `LINHA_${c.linhaPlanilha}`;
    let codigo = base;
    for (let n = 2; usados.has(codigo); n++) codigo = `${base}.${n}`;
    usados.add(codigo);
    c.codigo = codigo;
  }

  // Filhos diretos de um subtotal: os subtotais e os totais contidos no
  // intervalo que não estão dentro de outro (um total como "Estoque" = B74 é o
  // agrupador do item de baixo e conta como um subtotal); na ausência deles,
  // os itens.
  const filhosDiretos = (c: Classificada) => {
    if (!c.intervalo) return [];
    const [ini, fim] = c.intervalo;
    const dentro = classificadas.filter((x) => x.linhaPlanilha >= ini && x.linhaPlanilha <= fim);
    const agrupadores = dentro.filter((x) => x.tipo === "SUBTOTAL" || x.tipo === "TOTAL");
    const coberto = (x: Classificada) =>
      agrupadores.some(
        (y) =>
          y !== x &&
          ((y.intervalo && x.linhaPlanilha >= y.intervalo[0] && x.linhaPlanilha <= y.intervalo[1]) || y.referencias.includes(x.linhaPlanilha)),
      );
    const diretos = agrupadores.filter((x) => !coberto(x));
    return diretos.length > 0 ? diretos : dentro.filter((x) => x.tipo === "ITEM");
  };

  // Do fim para o começo: os filhos já estão resolvidos quando o pai é visto.
  const expressoes = new Map<number, string>();
  for (const c of [...classificadas].sort((a, b) => b.linhaPlanilha - a.linhaPlanilha)) {
    if (c.tipo === "SUBTOTAL") {
      const filhos = filhosDiretos(c);
      if (filhos.length === 0) {
        avisos.push({ origem: "estrutura da DRE", chave: c.codigo, motivo: `subtotal sem filhos no intervalo ${c.intervalo}` });
        continue;
      }
      expressoes.set(c.linhaPlanilha, filhos.map((f) => f.codigo).join(" + "));
      for (const f of filhos) for (const u of f.unidades) c.unidades.add(u);
    } else if (c.tipo === "TOTAL") {
      let expr = c.formula ?? "";
      for (const r of [...new Set(c.referencias)].sort((a, b) => b - a)) {
        const alvo = porLinha.get(r);
        if (!alvo) {
          avisos.push({ origem: "estrutura da DRE", chave: c.codigo, motivo: `referência B${r} não encontrada` });
          continue;
        }
        expr = expr.replace(new RegExp(`\\bB${r}\\b`, "g"), alvo.codigo);
        for (const u of alvo.unidades) c.unidades.add(u);
      }
      expressoes.set(c.linhaPlanilha, expr);
    }
  }

  const linhas: LinhaDREAlvo[] = classificadas.map((c, i) => ({
    codigo: c.codigo,
    dados: {
      ordem: i + 1,
      grupo: texto(c.grupo) ?? texto(c.grupoSigla) ?? "—",
      grupoSigla: texto(c.grupoSigla) ?? "—",
      atribuicao: texto(c.atribuicao),
      atribuicaoSigla: texto(c.atribuicaoSigla),
      descricao: c.descricao as string,
      tipo: c.tipo,
      expressao: expressoes.get(c.linhaPlanilha) ?? null,
      definicao: texto(c.definicao),
    },
    unidades: [...c.unidades].sort((a, b) => a - b),
  }));

  // A conta aponta para a linha pela tripla (departamento, atribuição, conta
  // DRE), a chave dos SOMASES da planilha. Itens primeiro; depois as linhas
  // calculadas — "Impostos Operacionais" é derivada no Consolidado e soma
  // lançamentos nas unidades.
  const porTripla = new Map<string, string>();
  const tripla = (c: Classificada) => [texto(c.grupo), texto(c.atribuicao), texto(c.descricao)].map((x) => x ?? "").join("|");
  for (const c of classificadas) if (c.tipo === "ITEM" && !porTripla.has(tripla(c))) porTripla.set(tripla(c), c.codigo);
  for (const c of classificadas) {
    if (c.tipo !== "ITEM" && c.tipo !== "SECAO" && !porTripla.has(tripla(c))) porTripla.set(tripla(c), c.codigo);
  }
  return { linhas, porTripla };
}

// -----------------------------------------------------------------------------

export type CadastrosPreparados = ReturnType<typeof prepararCadastros>;

export function prepararCadastros(planilha: PlanilhaCadastros) {
  const avisos: Aviso[] = [];
  const ajustesUsados = new Set<string>();
  const centros = prepararCentros(planilha.centros, avisos, ajustesUsados);
  const contas = prepararContas(planilha.contas, avisos, ajustesUsados);
  const dre = prepararDre(planilha.dre, avisos);

  // Vínculo de cada conta com a sua linha: código da linha, ou null.
  const vinculos = new Map<string, string | null>();
  const semDestino: string[] = [];
  for (const c of contas.alvos) {
    if (!c.destino) {
      vinculos.set(c.reduzido, null);
      continue;
    }
    const codigo = dre.porTripla.get(c.destino) ?? null;
    if (!codigo) semDestino.push(`${c.reduzido} → ${c.destino}`);
    vinculos.set(c.reduzido, codigo);
  }
  return { centros, contas, dre: { linhas: dre.linhas }, vinculos, semDestino, avisos, ajustesUsados };
}
