"use client";

import { type ReactNode, useRef, useState, useSyncExternalStore } from "react";
import { useQueries } from "@tanstack/react-query";
import { Search } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { type ColunaExportavel, ExportarTabela } from "@/components/shared/ExportarTabela";
import { usePermissions } from "@/context/PermissionContext";
import { useAcessibilidade, type Acessibilidade } from "@/lib/acessibilidade";
import { plural } from "@/lib/texto";

import { DetalheDialog } from "../../competencias/[anoMes]/dre/components/DetalheDialog";
import { estrutura, semPrimeiroTotalDaRol } from "../../competencias/[anoMes]/dre/components/NiveisDRE";
import { comCor, corDaMarcacao, listaDosCenarios, type CenarioDoProva } from "../components/cenariosDoProva";
import { CopiarComoImagem } from "../components/CopiarComoImagem";
import { Quadradinho } from "../components/GraficoRealizadoOrcado";
import { BotaoRecolherGrupo, useGrupoRecolhido } from "./GrupoRecolhivel";
import { formato, mensagemDeErro, relatoriosService, type Celula, type LinhaResultado, type MarcacaoComparavel, type MesRelatorio, type Resultados } from "../services/relatoriosService";

/**
 * A aba Variações do Painel de Bordo de Resultados Empresariais (18/11/2026, pedido do Adão; criada em Resultados e levada
 * para o Painel de Bordo no mesmo dia, antes de Indicadores), em cards de destaque como os cards PROVA dos Relatórios Executivos (a versão em
 * tabela está na etiqueta backup-2026-11-18-variacoes-em-tabela do git). Em cada unidade e em cada departamento dela (os
 * grupos de custos e despesas da DRE, menos as Despesas Variáveis de Venda), três cards na largura da tela, cada um com as
 * três maiores variações: Atual · mês (Vs. Realizado dos meses fechados anteriores do exercício, a média deles), Atual ·
 * mês (Vs. o comparativo da Comparação) e Acumulado · de janeiro ao mês (Vs. o comparativo). Cada variação traz, numa
 * linha, ∆1 · Conta (Atribuição), o Realizado e uma linha por comparado — a Média (com a legenda amarelo-ouro), o
 * cenário da Comparação Padrão ou cada um da PROVA, com a cor dele — com o Comparado, a Diferença (R$), o Atingimento (%) e
 * a Eficiência (p.p.), como as colunas das abas das unidades, e a faixa na cor do sinal (melhor, até 5% ou pior). O
 * Ordenar Por escolhe a medida que define as três maiores. Os dados são os das abas das unidades de Resultados (a mesma
 * consulta e as permissões delas); a lupa depois do valor realizado de cada variação abre, pelas mesmas regras delas, no
 * Atual, os lançamentos de origem do mês (o extrato, o balancete com os movimentos de cada conta e os itens) e, no
 * Acumulado, os meses da conta, e cada mês, os lançamentos dele.
 */

/** Uma unidade da aba: a visão da DRE (1 a 5) e o nome. */
export type UnidadeDasVariacoes = { visao: number; nome: string };
/** A comparação da tela: a marcação da Padrão e os cenários da PROVA (nulo: a Padrão). */
type ComparacaoDaTela = { comparaCom: MarcacaoComparavel; prova: CenarioDoProva[] | null };

/** As unidades da aba, com a aba de cada uma em Resultados (a consulta dos dados pede a permissão dela). */
const UNIDADES: Array<UnidadeDasVariacoes & { aba: string }> = [
  { visao: 1, nome: "Matriz", aba: "matriz" },
  { visao: 2, nome: "Filial", aba: "filial" },
  { visao: 3, nome: "Serviços", aba: "servicos" },
  { visao: 4, nome: "Despesas e Extra", aba: "despesas" },
  { visao: 5, nome: "RN", aba: "rn" },
];
/** As unidades que o perfil lê em Resultados (as abas delas). */
function useUnidadesDasVariacoes(): UnidadeDasVariacoes[] {
  const { hasPermission } = usePermissions();
  return UNIDADES.filter((u) => hasPermission(`relatorio_resultados.${u.aba}:ler`)).map(({ visao, nome }) => ({ visao, nome }));
}

/** Os grupos da DRE que ficam de fora: as receitas, os impostos sobre elas e as Despesas Variáveis de Venda (DVV). */
const FORA_DOS_DEPARTAMENTOS = new Set(["RO", "ROB", "IRB", "ROL", "DVV"]);
/** Os departamentos em que maior é melhor (as receitas financeiras); nos demais (custos e despesas), menor é melhor. */
const MAIOR_E_MELHOR = new Set(["RFC", "RFNC"]);
const QUANTAS = 3;

/** O que define as três maiores variações (o Ordenar Por). */
export type OrdemDasVariacoes = "diferenca" | "atingimento" | "eficiencia";
const ORDENS: Array<{ valor: OrdemDasVariacoes; rotulo: string; dica: string }> = [
  { valor: "diferenca", rotulo: "Diferença", dica: "As três contas com a maior diferença em reais (realizado − comparado), para mais ou para menos." },
  { valor: "atingimento", rotulo: "Atingimento", dica: "As três contas com o atingimento (realizado ÷ comparado) mais longe de 100%, para mais ou para menos." },
  { valor: "eficiencia", rotulo: "Eficiência", dica: "As três contas com a maior eficiência (% realizado − % comparado, em pontos percentuais), para mais ou para menos." },
];

/**
 * O Ordenar Por fica guardado neste navegador (o Exportar e os cards mudam juntos); começa na Diferença e, sem
 * armazenamento (janela privada), só não é lembrado.
 */
const CHAVE_DA_ORDEM = "sig.resultados.variacoes.ordem";
const ouvintesDaOrdem = new Set<() => void>();
let ordemNaMemoria: OrdemDasVariacoes | null = null;
function lerOrdem(): OrdemDasVariacoes {
  if (ordemNaMemoria) return ordemNaMemoria;
  try {
    const guardada = window.localStorage.getItem(CHAVE_DA_ORDEM);
    return ORDENS.some((o) => o.valor === guardada) ? (guardada as OrdemDasVariacoes) : "diferenca";
  } catch {
    return "diferenca"; // sem armazenamento
  }
}
function useOrdemDasVariacoes(): [OrdemDasVariacoes, (o: OrdemDasVariacoes) => void] {
  const ordem = useSyncExternalStore(
    (avisar) => {
      ouvintesDaOrdem.add(avisar);
      return () => ouvintesDaOrdem.delete(avisar);
    },
    lerOrdem,
    () => "diferenca" as const,
  );
  const escolher = (o: OrdemDasVariacoes) => {
    ordemNaMemoria = o;
    try {
      window.localStorage.setItem(CHAVE_DA_ORDEM, o);
    } catch {
      // sem armazenamento
    }
    ouvintesDaOrdem.forEach((avisar) => avisar());
  };
  return [ordem, escolher];
}

/** O amarelo-ouro da BPM, a cor do Realizado nas legendas dos gráficos e dos cards: na linha da Média (o realizado dos meses anteriores). */
const OURO = "var(--color-bpm-primary)";
/** Os meses abreviados do período da Média: "(Jan. a Ago.)". */
const MESES_ABREVIADOS = ["Jan.", "Fev.", "Mar.", "Abr.", "Mai.", "Jun.", "Jul.", "Ago.", "Set.", "Out.", "Nov.", "Dez."];

/** O sinal dos cards: 1 melhor que o comparado, 0 até 5% dele, −1 pior. */
type Sinal = -1 | 0 | 1;
/** As cores do sinal, as dos cards do Painel de Bordo e dos Relatórios Executivos (no Daltonismo, azul no lugar do verde). */
const CORES_DO_SINAL: Record<Acessibilidade, Record<Sinal, string>> = {
  padrao: { 1: "var(--color-green-600)", 0: "var(--color-yellow-500)", [-1]: "var(--color-red-600)" },
  daltonismo: { 1: "var(--color-blue-600)", 0: "var(--color-yellow-500)", [-1]: "var(--color-red-600)" },
};
const ROTULO_DO_SINAL: Record<Sinal, string> = { 1: "Melhor", 0: "Até 5% Var.", [-1]: "Pior" };
/** O texto do sinal: "Melhor que a Média", "Até 5% do Forecast"… */
const textoDoSinal = (s: Sinal, comparado: string) => {
  const feminino = comparado === "Média";
  return s === 1 ? `Melhor que ${feminino ? "a" : "o"} ${comparado}` : s === 0 ? `Até 5% ${feminino ? "da" : "do"} ${comparado}` : `Pior que ${feminino ? "a" : "o"} ${comparado}`;
};
/**
 * O sinal, pela regra dos cards: o desvio é o realizado sobre o comparado, menos 1 (com o sinal invertido no comparado
 * negativo); até 5%, amarelo; senão, melhor ou pior conforme o sentido do departamento. Com o comparado zero, pelo lado do
 * realizado (zero também: até 5%).
 */
function sinalDa(realizado: number, comparado: number, maiorEMelhor: boolean): Sinal {
  if (Math.abs(comparado) < 0.005) return Math.abs(realizado) < 0.005 ? 0 : (maiorEMelhor ? realizado > 0 : realizado < 0) ? 1 : -1;
  const desvio = (realizado / comparado - 1) * (comparado < 0 ? -1 : 1);
  if (Math.abs(desvio) <= 0.05) return 0;
  return (maiorEMelhor ? realizado < comparado : realizado > comparado) ? -1 : 1;
}

/** Um comparado de uma variação: o valor dele, a diferença, o atingimento, a eficiência (em p.p.) e o sinal. */
type Comparado = { base: number; diferenca: number; atingimento: number | null; eficiencia: number | null; sinal: Sinal };
/** Uma variação: a conta, o realizado (com o %) e, contra cada comparativo do card, o comparado. */
type Variacao = { linha: LinhaResultado; atribuicao: string | null; conta: string; valor: number; pct: number | null; comparados: Comparado[] };
/** Um comparativo de um card: a Média ou um cenário (na PROVA, com a cor dele). */
type Comparativo = { chave: string; rotulo: string; dica: string; cor?: string; detalhe?: string };
/** Um card: o período (Atual ou Acumulado), os comparativos (um, ou os cenários da PROVA) e as três maiores variações. */
type Card = {
  chave: string;
  periodo: "atual" | "acumulado";
  nomeDoPeriodo: string;
  rotuloDoPeriodo: string;
  titulo: string;
  dica: string;
  comparativos: Comparativo[];
  aviso?: string;
  variacoes: Variacao[];
};
type Departamento = { codigo: string; nome: string; maiorEMelhor: boolean; cards: Card[] };

const doValor = (c: Celula | undefined | null) => c?.valor ?? 0;
/** Sem o "-0" do que arredonda para zero. */
const inteiro = (v: number) => formato.inteiro(Math.round(v) || 0);
/** O texto com o sinal: + nos positivos (o − dos negativos vem do formato); o que arredonda para zero fica sem sinal. */
const comSinal = (v: number, texto: string) => (v > 0 && /[1-9]/.test(texto) ? `+${texto}` : texto);
const diferencaDo = (c: Comparado) => comSinal(c.diferenca, inteiro(c.diferenca));
/** Atingimento: o realizado sobre o comparado, em percentual (comparado zero: traço), como nas abas das unidades. */
const atingimentoDo = (c: Comparado) => (c.atingimento === null ? "—" : formato.pct(c.atingimento));
/** Eficiência: o % realizado menos o % comparado, em pontos percentuais, com o sinal (sem o %: traço). */
const eficienciaDo = (c: Comparado) => {
  if (c.eficiencia === null) return "—";
  const pp = Math.round(c.eficiencia * 10) / 10 || 0; // sem o "-0,0"
  return `${comSinal(pp, formato.umaCasa(pp))} p.p.`;
};
const nomeDa = (v: Variacao) => `${v.atribuicao ? `${v.atribuicao} / ` : ""}${v.conta}`;
/** A conta abre os lançamentos de origem como nas abas das unidades: uma conta (não um volume) que o usuário alcança. */
const detalhavel = (l: LinhaResultado) => !l.volume && l.tipo === "ITEM" && l.podeDetalhar !== false;
/** A linha tem o % (como nas abas das unidades): só nela entra a eficiência. */
const temPct = (l: LinhaResultado) => !l.volume && (l.meses.some((c) => c.pct !== null) || l.total.pct !== null);
/** O período dos meses: "JAN a AGO/26" (ou só "JAN/26", com um mês). */
const periodoDos = (meses: MesRelatorio[]) => (meses.length === 1 ? meses[0].rotulo : `${meses[0].rotulo.slice(0, 3)} a ${meses[meses.length - 1].rotulo}`);

/** A medida do Ordenar Por num comparado (a distância de 100% no atingimento); nula, sem a medida. */
const MEDIDA: Record<OrdemDasVariacoes, (c: Comparado) => number | null> = {
  diferenca: (c) => Math.abs(c.diferenca),
  atingimento: (c) => (c.atingimento === null ? null : Math.abs(c.atingimento - 1)),
  eficiencia: (c) => (c.eficiencia === null ? null : Math.abs(c.eficiencia)),
};
/** A medida de uma variação: a maior entre os comparados (na PROVA, os cenários); nula, a variação vai para o fim. */
const medidaDa = (ordem: OrdemDasVariacoes, v: Variacao) => {
  const ms = v.comparados.map(MEDIDA[ordem]).filter((m): m is number => m !== null);
  return ms.length ? Math.max(...ms) : null;
};
const maiorDiferenca = (v: Variacao) => Math.max(0, ...v.comparados.map((c) => Math.abs(c.diferenca)));
/** Da maior para a menor medida; empatadas ou sem ela, pela maior diferença. */
const ordenar = (ordem: OrdemDasVariacoes) => (a: Variacao, b: Variacao) => {
  const ma = medidaDa(ordem, a);
  const mb = medidaDa(ordem, b);
  if (ma === null || mb === null) return ma === mb ? maiorDiferenca(b) - maiorDiferenca(a) : ma === null ? 1 : -1;
  return mb - ma || maiorDiferenca(b) - maiorDiferenca(a);
};

/** Uma base de comparação: o valor e o % comparado de cada conta. */
type Base = Comparativo & { celula: (l: LinhaResultado) => { valor: number; pct: number | null } };
/** A definição de um card: o período, o realizado de cada conta e as bases (sem elas, o aviso). */
type DefinicaoDoCard = Omit<Card, "variacoes" | "comparativos"> & { realizado: (l: LinhaResultado) => Celula | undefined; bases: Base[] };

/**
 * Os departamentos de uma unidade com os cards. Atual: o mês de referência (o último) contra a média dos meses fechados
 * anteriores (a soma ÷ os meses, também os sem valor na conta; o % é a soma dos valores sobre a soma das bases, como o do
 * total) e contra o comparativo (o valor do cenário no mês). Acumulado: de janeiro ao mês, contra o acumulado do
 * comparativo. Na PROVA, o comparativo são os cenários, e as três maiores são as de maior medida contra algum deles.
 */
export function variacoesDaUnidade(dados: Resultados, comparacao: ComparacaoDaTela, ordem: OrdemDasVariacoes): { mes: MesRelatorio; acumulado: string; departamentos: Departamento[] } {
  const linhas = semPrimeiroTotalDaRol(dados.linhas);
  const { acima } = estrutura(linhas);
  const porCodigo = new Map(linhas.map((l) => [l.codigo, l]));
  const referencia = dados.meses.length - 1;
  const mes = dados.meses[referencia];
  const acumulado = periodoDos(dados.meses);
  const anteriores = dados.meses.flatMap((m, i) => (i < referencia && m.apurado ? [i] : []));
  const doMes = (l: LinhaResultado) => l.meses[referencia];
  const doTotal = (l: LinhaResultado) => l.total;
  const atual = { periodo: "atual" as const, nomeDoPeriodo: "Atual", rotuloDoPeriodo: mes.rotulo };
  const periodoDasMedias = anteriores.length ? periodoDos(anteriores.map((i) => dados.meses[i])) : "";
  const media: DefinicaoDoCard = {
    ...atual,
    chave: "atual-media",
    titulo: anteriores.length ? `Vs. Realizado de ${periodoDasMedias}` : "Vs. Realizado dos Meses Anteriores",
    dica: anteriores.length
      ? `A média dos ${plural(anteriores.length, "mês fechado", "meses fechados")} antes de ${mes.rotulo}: a soma de cada conta ÷ ${anteriores.length}, também os meses sem valor nela.`
      : "",
    realizado: doMes,
    ...(anteriores.length ? {} : { aviso: `Nenhum mês fechado antes de ${mes.rotulo} no exercício.` }),
    bases: anteriores.length
      ? [
          {
            chave: "media",
            rotulo: "Média",
            dica: `Média de ${periodoDasMedias}`,
            cor: OURO,
            detalhe: `(${[...new Set([anteriores[0], anteriores[anteriores.length - 1]])].map((i) => MESES_ABREVIADOS[dados.meses[i].mes - 1]).join(" a ")})`,
            celula: (l) => {
              const soma = anteriores.reduce((s, i) => s + doValor(l.meses[i]), 0);
              const bases = l.basePercentual ? dados.basesDoPercentual?.[l.basePercentual] : undefined;
              const somaDasBases = bases ? anteriores.reduce((s, i) => s + (bases[i] ?? 0), 0) : 0;
              return { valor: soma / anteriores.length, pct: somaDasBases ? soma / somaDasBases : null };
            },
          },
        ]
      : [],
  };
  // O comparativo: o cenário da Padrão ou os da PROVA, no mês ou no acumulado.
  const doProva = comparacao.prova ? comCor(dados.prova ?? []) : null;
  const comparativo = (periodo: "mes" | "total", p: Pick<Card, "periodo" | "nomeDoPeriodo" | "rotuloDoPeriodo">): DefinicaoDoCard => {
    const realizado = periodo === "mes" ? doMes : doTotal;
    if (doProva) {
      return {
        ...p,
        chave: `${p.periodo}-prova`,
        titulo: `Vs. ${listaDosCenarios(doProva)}`,
        dica: doProva.map((c) => `${c.rotulo}: ${c.cenario}`).join("\n"),
        realizado,
        ...(doProva.length ? {} : { aviso: "Nenhum cenário com as marcações da Comparação PROVA." }),
        bases: doProva.map((c) => ({
          chave: c.marcacao,
          rotulo: c.rotulo,
          dica: `${c.rotulo}: ${c.cenario}`,
          cor: c.cor,
          celula: (l: LinhaResultado) => {
            const x = l.prova?.[c.marcacao]?.[periodo];
            return { valor: doValor(x), pct: x?.pct ?? null };
          },
        })),
      };
    }
    const rotulo = dados.rotuloComparado ?? "Orçado";
    return {
      ...p,
      chave: `${p.periodo}-padrao`,
      titulo: `Vs. ${rotulo}`,
      dica: dados.cenarioOrcado ? `O cenário ${dados.cenarioOrcado}` : "",
      realizado,
      ...(dados.cenarioOrcado ? {} : { aviso: "Nenhum cenário com a marcação escolhida na Comparação." }),
      bases: dados.cenarioOrcado
        ? [
            {
              chave: "padrao",
              rotulo,
              dica: `O cenário ${dados.cenarioOrcado}`,
              cor: corDaMarcacao(comparacao.comparaCom),
              celula: (l: LinhaResultado) => {
                const x = l.orcado?.[periodo];
                return { valor: doValor(x), pct: x?.pct ?? null };
              },
            },
          ]
        : [],
    };
  };
  const definicoes = [media, comparativo("mes", atual), comparativo("total", { periodo: "acumulado", nomeDoPeriodo: "Acumulado", rotuloDoPeriodo: acumulado })];
  // As contas de cada departamento (o total acima delas), na ordem da DRE.
  const contas = new Map<string, LinhaResultado[]>();
  for (const l of linhas) {
    if (l.tipo !== "ITEM" || l.volume || FORA_DOS_DEPARTAMENTOS.has(l.grupoSigla)) continue;
    const total = acima.get(l.codigo)?.[0];
    if (total) contas.set(total, [...(contas.get(total) ?? []), l]);
  }
  const variacoes = (ls: LinhaResultado[], d: DefinicaoDoCard, maiorEMelhor: boolean) =>
    ls
      .map((l): Variacao => {
        const r = d.realizado(l);
        const valor = doValor(r);
        const pct = r?.pct ?? null;
        const atribuicao = acima.get(l.codigo)?.[1];
        return {
          linha: l,
          atribuicao: atribuicao ? (porCodigo.get(atribuicao)?.descricao ?? null) : null,
          conta: l.descricao,
          valor,
          pct,
          comparados: d.bases.map((b) => {
            const c = b.celula(l);
            return {
              base: c.valor,
              diferenca: valor - c.valor,
              atingimento: Math.abs(c.valor) >= 0.005 ? valor / c.valor : null,
              eficiencia: temPct(l) && pct !== null && c.pct !== null ? (pct - c.pct) * 100 : null,
              sinal: sinalDa(valor, c.valor, maiorEMelhor),
            };
          }),
        };
      })
      // Só as que mudam (em reais inteiros) contra algum comparado, da maior medida do Ordenar Por para a menor.
      .filter((v) => v.comparados.some((c) => Math.round(Math.abs(c.diferenca)) > 0))
      .sort(ordenar(ordem))
      .slice(0, QUANTAS);
  const departamentos = [...contas].map(([codigo, ls]) => {
    const maiorEMelhor = MAIOR_E_MELHOR.has(ls[0].grupoSigla);
    return {
      codigo,
      nome: porCodigo.get(codigo)?.descricao ?? codigo,
      maiorEMelhor,
      cards: definicoes.map((definicao): Card => {
        const { realizado, bases, ...d } = definicao;
        return {
          ...d,
          comparativos: bases.map((b) => ({ chave: b.chave, rotulo: b.rotulo, dica: b.dica, ...(b.cor ? { cor: b.cor } : {}), ...(b.detalhe ? { detalhe: b.detalhe } : {}) })),
          variacoes: bases.length ? variacoes(ls, { ...d, realizado, bases }, maiorEMelhor) : [],
        };
      }),
    };
  });
  return { mes, acumulado, departamentos };
}

/** As consultas das unidades: as mesmas das abas delas (a mesma chave), com a comparação da tela. */
function useUnidades(ano: number, ate: number, unidades: UnidadeDasVariacoes[], comparacao: ComparacaoDaTela) {
  const marcacoes = comparacao.prova?.map((c) => c.marcacao);
  return useQueries({
    queries: unidades.map((u) => ({
      queryKey: ["relatorios", "resultados", ano, ate, "visao", u.visao, comparacao.comparaCom, marcacoes ?? null],
      queryFn: () => relatoriosService.resultados(ano, ate, u.visao, comparacao.comparaCom, marcacoes),
    })),
  });
}

/** Uma linha do Exportar: a unidade, o departamento, o período, o comparativo e as três variações contra ele. */
type LinhaDoExportar = { unidade: string; departamento: string; periodo: string; comparacao: string; aviso: string; variacoes: Array<{ v: Variacao; c: Comparado }> };

/** O Exportar da aba (os cards de todas as unidades, na ordem escolhida, em Excel ou PDF). */
export function ExportarVariacoes({ ano, ate, comparacao }: { ano: number; ate: number; comparacao: ComparacaoDaTela }) {
  const unidades = useUnidadesDasVariacoes();
  const consultas = useUnidades(ano, ate, unidades, comparacao);
  const [ordem] = useOrdemDasVariacoes();
  if (!unidades.length || consultas.some((c) => !c.data)) return null;
  const montadas = unidades.map((u, k) => ({ unidade: u, ...variacoesDaUnidade(consultas[k].data!, comparacao, ordem) }));
  // Uma linha por comparativo de cada card (na PROVA, uma por cenário, com as mesmas três contas).
  const linhas: LinhaDoExportar[] = montadas.flatMap((u) =>
    u.departamentos.flatMap((d) =>
      d.cards.flatMap((card) => {
        const base = { unidade: u.unidade.nome, departamento: d.nome, periodo: `${card.nomeDoPeriodo} (${card.rotuloDoPeriodo})` };
        if (card.aviso || !card.comparativos.length) return [{ ...base, comparacao: card.titulo, aviso: card.aviso ?? "", variacoes: [] }];
        return card.comparativos.map((c, k) => ({
          ...base,
          comparacao: card.chave === "atual-media" ? card.titulo : `Vs. ${c.rotulo}`,
          aviso: "",
          variacoes: card.variacoes.map((v) => ({ v, c: v.comparados[k] })),
        }));
      }),
    ),
  );
  const da = (l: LinhaDoExportar, k: number) => l.variacoes[k];
  const colunas: ColunaExportavel<LinhaDoExportar>[] = [
    { chave: "unidade", rotulo: "Unidade", valor: (l) => l.unidade },
    { chave: "departamento", rotulo: "Departamento", valor: (l) => l.departamento },
    { chave: "periodo", rotulo: "Período", valor: (l) => l.periodo },
    { chave: "comparacao", rotulo: "Comparação", valor: (l) => l.comparacao },
    ...Array.from({ length: QUANTAS }).flatMap((_, k): ColunaExportavel<LinhaDoExportar>[] => [
      { chave: `conta${k}`, rotulo: `${k + 1}ª Conta`, valor: (l) => (da(l, k) ? nomeDa(da(l, k).v) : k === 0 ? l.aviso : "") },
      { chave: `valor${k}`, rotulo: `${k + 1}ª Realizado (R$)`, tipo: "numero", moeda: true, valor: (l) => da(l, k)?.v.valor, texto: (l) => (da(l, k) ? inteiro(da(l, k).v.valor) : "") },
      { chave: `base${k}`, rotulo: `${k + 1}ª Comparado (R$)`, tipo: "numero", moeda: true, valor: (l) => da(l, k)?.c.base, texto: (l) => (da(l, k) ? inteiro(da(l, k).c.base) : "") },
      { chave: `diferenca${k}`, rotulo: `${k + 1}ª Diferença (R$)`, tipo: "numero", moeda: true, valor: (l) => da(l, k)?.c.diferenca, texto: (l) => (da(l, k) ? diferencaDo(da(l, k).c) : "") },
      { chave: `atingimento${k}`, rotulo: `${k + 1}ª Atingimento (%)`, texto: (l) => (da(l, k) ? atingimentoDo(da(l, k).c) : "") },
      { chave: `eficiencia${k}`, rotulo: `${k + 1}ª Eficiência (p.p.)`, texto: (l) => (da(l, k) ? eficienciaDo(da(l, k).c) : "") },
    ]),
  ];
  const mes = montadas[0]?.mes.rotulo ?? "";
  const porOrdem = ORDENS.find((o) => o.valor === ordem)?.rotulo ?? "";
  return <ExportarTabela titulo={`Resultados ${ano} · Variações de ${mes} · Ordenadas por ${porOrdem}`} colunas={colunas} linhas={linhas} />;
}

/** Uma consulta aberta: os lançamentos do mês (o Atual) ou os meses do acumulado, cada um com os dele. */
type Consulta = { linha: LinhaResultado; visao: number; unidade: string; mes: MesRelatorio } | { linha: LinhaResultado; visao: number; unidade: string; meses: MesRelatorio[]; periodo: string };

/**
 * Os meses do acumulado de uma conta (o Acumulado): o realizado e o % de cada mês fechado; clicar num mês abre os
 * lançamentos de origem dele (o extrato com os movimentos e os itens), e fechar o extrato volta aos meses.
 */
function MesesDaConta({ ano, consulta, onFechar }: { ano: number; consulta: Extract<Consulta, { meses: MesRelatorio[] }>; onFechar: () => void }) {
  const [mes, setMes] = useState<MesRelatorio | null>(null);
  const { linha, meses } = consulta;
  if (mes) {
    return (
      <DetalheDialog
        anoMes={`${ano}-${String(mes.mes).padStart(2, "0")}`}
        linha={linha.codigo}
        visao={{ unidade: consulta.visao }}
        rotuloMes={mes.rotulo}
        onFechar={() => setMes(null)}
      />
    );
  }
  // Os meses são os da consulta da unidade (os índices das células da linha).
  const indice = (m: MesRelatorio) => meses.indexOf(m);
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-sm sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {consulta.unidade} · {linha.descricao} · {consulta.periodo}
          </DialogTitle>
          <DialogDescription>O acumulado da conta mês a mês. Clique num mês para ver os lançamentos de origem dele, com os movimentos e os itens.</DialogDescription>
        </DialogHeader>
        <table className="tabela-sig w-full border-collapse text-sm [--topo-tabela:0px]">
          <thead>
            <tr className="border-b border-gray-300">
              <th className="px-3 py-2 text-left text-xs font-bold text-gray-900">Mês</th>
              <th className="px-3 py-2 text-right text-xs font-bold text-gray-900">Realizado</th>
              <th className="px-3 py-2 text-right text-xs font-bold text-gray-900">%</th>
            </tr>
          </thead>
          <tbody>
            {meses.map((m) => {
              const c = linha.meses[indice(m)];
              const abre = m.apurado && c?.valor !== null && c?.valor !== undefined;
              return (
                <tr
                  key={m.mes}
                  className={`border-t border-gray-100 text-gray-700 ${abre ? "cursor-pointer hover:bg-gray-100" : ""}`}
                  onClick={abre ? () => setMes(m) : undefined}
                  title={abre ? `Ver os lançamentos de origem de ${m.rotulo}` : undefined}
                >
                  <td className="px-3 py-1.5">
                    <span className="flex items-center gap-1">
                      {abre ? <Search className="size-3.5 shrink-0 text-gray-400" /> : <span aria-hidden className="inline-block size-3.5 shrink-0" />}
                      {m.rotulo}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right">{abre ? inteiro(c.valor!) : "—"}</td>
                  <td className="px-3 py-1.5 text-right">{abre && c.pct !== null ? formato.pct(c.pct) : "—"}</td>
                </tr>
              );
            })}
            <tr className="border-y border-gray-300 font-bold text-gray-900">
              <td className="px-3 py-1.5">Acumulado</td>
              <td className="px-3 py-1.5 text-right">{inteiro(doValor(linha.total))}</td>
              <td className="px-3 py-1.5 text-right">{linha.total.pct !== null ? formato.pct(linha.total.pct) : "—"}</td>
            </tr>
          </tbody>
        </table>
      </DialogContent>
    </Dialog>
  );
}

/** O ícone do sinal, na cor dele: ▲ melhor, ▼ pior e ■ até 5% (o dos cards do Painel de Bordo). */
function IconeDoSinal({ s, cores, titulo }: { s: Sinal; cores: Record<Sinal, string>; titulo?: string }) {
  const fill = cores[s];
  return (
    <svg viewBox="0 0 12 12" className="inline-block size-3 shrink-0" role={titulo ? "img" : undefined} aria-label={titulo} aria-hidden={titulo ? undefined : true}>
      {titulo ? <title>{titulo}</title> : null}
      {s === 1 ? <polygon points="6,1 11.5,11 0.5,11" style={{ fill }} /> : s === -1 ? <polygon points="0.5,1 11.5,1 6,11" style={{ fill }} /> : <rect x={1.5} y={1.5} width={9} height={9} style={{ fill }} />}
    </svg>
  );
}

/**
 * As linhas dos comparados de uma variação (como as dos cards PROVA, também na Comparação Padrão e na Média): em cada uma, o
 * quadradinho da cor do cenário (na Média, o amarelo-ouro do Realizado, e os meses dela entre parênteses, “Média (Jan. a
 * Ago.)”) e o nome (cortado, se não couber; o nome inteiro na dica), o Comparado,
 * a Diferença (com o ícone do sinal), o Atingimento e a Eficiência, no cinza do destaque, com a faixa na cor do sinal à
 * direita. Os rótulos das medidas ficam em cima, uma vez; o da medida do Ordenar Por, em negrito.
 */
function LinhasDosComparados({ v, comparativos, ordem, cores }: { v: Variacao; comparativos: Comparativo[]; ordem: OrdemDasVariacoes; cores: Record<Sinal, string> }) {
  const rotulo = (texto: string, ordenada: boolean) => <span className={`text-right ${ordenada ? "font-bold text-gray-900" : ""}`}>{texto}</span>;
  return (
    <div className="mt-1.5 grid grid-cols-[minmax(1.5rem,1fr)_auto_auto_auto_auto] gap-y-0.5">
      <div className="col-span-5 grid grid-cols-subgrid gap-x-1.5 pr-[20px] pl-1.5 text-[11px] text-gray-600">
        <span />
        {rotulo("Comparado", false)}
        {rotulo("Diferença", ordem === "diferenca")}
        {rotulo("Atingimento", ordem === "atingimento")}
        {rotulo("Eficiência", ordem === "eficiencia")}
      </div>
      {comparativos.map((comparativo, k) => {
        const c = v.comparados[k];
        return (
          <div
            key={comparativo.chave}
            className="col-span-5 grid grid-cols-subgrid items-center gap-x-1.5 rounded-sm border-r-[12px] bg-gray-100 py-0.5 pr-2 pl-1.5"
            style={{ borderRightColor: cores[c.sinal] }}
            title={`${comparativo.dica}: ${textoDoSinal(c.sinal, comparativo.rotulo)}`}
          >
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-gray-600">
              {comparativo.cor ? <Quadradinho cor={comparativo.cor} /> : <span aria-hidden className="inline-block size-3 shrink-0" />}
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-1 leading-tight">
                <span className="truncate">{comparativo.rotulo}</span>
                {comparativo.detalhe ? <span className="min-w-0 truncate text-[11px] whitespace-nowrap">{comparativo.detalhe}</span> : null}
              </span>
            </span>
            <span className="text-right text-[13px] font-bold whitespace-nowrap text-gray-900">{inteiro(c.base)}</span>
            <span className="inline-flex items-center justify-end gap-1 text-[13px] font-bold whitespace-nowrap text-gray-900">
              <IconeDoSinal s={c.sinal} cores={cores} />
              {diferencaDo(c)}
            </span>
            <span className="text-right text-[13px] font-bold whitespace-nowrap text-gray-900">{atingimentoDo(c)}</span>
            <span className="text-right text-[13px] font-bold whitespace-nowrap text-gray-900">{eficienciaDo(c)}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Uma variação do card: numa linha, ∆1 · Conta (Atribuição) (a conta em negrito, inteira enquanto couber; sem espaço, a
 * atribuição se corta primeiro, e o texto inteiro fica na dica; sem link: a consulta fica só na lupa); o Realizado em destaque, com a lupa ao lado (os gastos por
 * conta e por item: no Atual, o extrato do mês; no Acumulado, os meses, e cada mês o extrato dele) e o % sobre a receita
 * líquida (/RL); e as linhas dos comparados.
 */
function BlocoDaVariacao({
  posicao,
  v,
  card,
  ordem,
  cores,
  rotuloDoMes,
  onConsultar,
}: {
  posicao: number;
  v: Variacao | undefined;
  card: Card;
  ordem: OrdemDasVariacoes;
  cores: Record<Sinal, string>;
  rotuloDoMes: string;
  onConsultar: (v: Variacao) => void;
}) {
  const separado = posicao > 0 ? "xl:border-l xl:border-gray-100 xl:pl-3" : "";
  const abre = !!v && detalhavel(v.linha);
  const doAtual = card.periodo === "atual";
  const dicaDaLupa = doAtual
    ? `Ver os gastos de ${rotuloDoMes} por conta e por item: o extrato dos lançamentos de origem, os movimentos de cada conta e os itens deles`
    : `Ver os meses de ${card.rotuloDoPeriodo} e, em cada um, os gastos por conta e por item (o extrato dos lançamentos de origem)`;
  const posicaoDaVariacao = `∆${posicao + 1}`;
  return (
    <div className={`min-w-0 xl:pr-3 ${separado}`}>
      <div className="flex min-h-7 min-w-0 items-baseline gap-1.5 whitespace-nowrap" title={v ? `${posicaoDaVariacao} · ${v.conta}${v.atribuicao ? ` (${v.atribuicao})` : ""}` : undefined}>
        <span className="shrink-0 text-xs text-gray-500">{posicaoDaVariacao} ·</span>
        {!v ? (
          <span className="text-sm text-gray-400">{posicao === 0 ? "Nenhuma variação" : "—"}</span>
        ) : (
          <>
            {/* Só o nome (a consulta fica na lupa depois do valor realizado). */}
            <span className="max-w-[calc(100%-2.25rem)] shrink-0 truncate text-base font-bold text-gray-900">{v.conta}</span>
            {v.atribuicao ? <span className="min-w-0 truncate text-xs text-gray-500">({v.atribuicao})</span> : null}
          </>
        )}
      </div>
      {v ? (
        <>
          <div className="mt-1">
            <p className="text-xs text-gray-600">Realizado</p>
            <p className="flex items-center gap-1 text-2xl leading-tight font-extrabold whitespace-nowrap text-gray-900">
              {inteiro(v.valor)}
              {/* A lupa dos gastos por conta e por item: no Atual, o extrato do mês; no Acumulado, os meses da conta. */}
              {abre ? (
                <button
                  type="button"
                  data-fora-da-imagem
                  onClick={() => onConsultar(v)}
                  title={dicaDaLupa}
                  aria-label={`${dicaDaLupa} (${nomeDa(v)})`}
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                >
                  <Search className="size-4" />
                </button>
              ) : null}
            </p>
            <p className="h-4 text-xs whitespace-nowrap text-gray-500">{v.pct !== null ? `${formato.pct(v.pct)} (/RL)` : ""}</p>
          </div>
          <LinhasDosComparados v={v} comparativos={card.comparativos} ordem={ordem} cores={cores} />
        </>
      ) : null}
    </div>
  );
}

/**
 * Um card na largura da tela: o período, com o comparativo entre parênteses (“Atual · SET/26 (Vs. Forecast)”), e as três
 * variações lado a lado (empilhadas na tela estreita).
 */
function CardDasVariacoes({ card, ordem, cores, rotuloDoMes, onConsultar }: { card: Card; ordem: OrdemDasVariacoes; cores: Record<Sinal, string>; rotuloDoMes: string; onConsultar: (v: Variacao, card: Card) => void }) {
  return (
    <article className="rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-3">
      <h4 className="text-lg font-bold text-gray-900" title={card.dica || undefined}>
        {card.nomeDoPeriodo}
        <span className="font-semibold text-gray-500">
          {" "}
          · {card.rotuloDoPeriodo} ({card.titulo})
        </span>
      </h4>
      {card.aviso ? (
        <p className="mt-2 text-sm text-gray-500">{card.aviso}</p>
      ) : (
        <div className="mt-2 grid gap-4 xl:grid-cols-3 xl:gap-0">
          {Array.from({ length: QUANTAS }).map((_, i) => (
            <BlocoDaVariacao key={i} posicao={i} v={card.variacoes[i]} card={card} ordem={ordem} cores={cores} rotuloDoMes={rotuloDoMes} onConsultar={(v) => onConsultar(v, card)} />
          ))}
        </div>
      )}
    </article>
  );
}

/**
 * Uma unidade da aba (um grupo, como os das abas Resultados e Performance): a seta que recolhe e expande os cards dela (a
 * escolha fica guardada no navegador) e o nome, com o mês em cinza.
 */
function SecaoDaUnidade({ nome, rotuloMes, children }: { nome: string; rotuloMes: string; children: ReactNode }) {
  const [recolhido, alternar] = useGrupoRecolhido(`variacoes:${nome}`);
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <BotaoRecolherGrupo recolhido={recolhido} onAlternar={alternar} nome={`Variações · ${nome}`} />
        <h2 className="text-2xl font-bold tracking-wide text-gray-900 uppercase">
          Variações · {nome}
          <span className="font-semibold text-gray-500"> · {rotuloMes}</span>
        </h2>
      </div>
      <div className={recolhido ? "hidden" : ""}>{children}</div>
    </section>
  );
}

/**
 * Um departamento de uma unidade (um subgrupo de cards): o nome e, logo depois dele, o botão Copiar como Imagem dos grupos das
 * abas Resultados e Performance (o nome e os cards, como estão na tela, sem as lupas; sem a área de transferência, baixa o
 * PNG).
 */
function SubgrupoDoDepartamento({ nome, maiorEMelhor, arquivo, children }: { nome: string; maiorEMelhor: boolean; arquivo: string; children: ReactNode }) {
  const subgrupo = useRef<HTMLDivElement>(null);
  return (
    <div ref={subgrupo}>
      <div className="mb-2 flex items-center gap-2 border-b border-gray-200 pb-1">
        <h3 className="text-base font-bold tracking-wide text-gray-700 uppercase" title={maiorEMelhor ? "Maior é melhor" : "Menor é melhor"}>
          {nome}
        </h3>
        <CopiarComoImagem alvo={subgrupo} nome={arquivo} dica="Copiar os cards como imagem" />
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

/**
 * A aba Variações: o Ordenar Por (com a legenda dos sinais) em destaque, flutuante ao rolar a tela, e, em cada unidade (que
 * recolhe e expande), os departamentos com os três cards de cada um.
 */
export function VisaoVariacoes({ ano, ate, comparacao }: { ano: number; ate: number; comparacao: ComparacaoDaTela }) {
  const unidades = useUnidadesDasVariacoes();
  const consultas = useUnidades(ano, ate, unidades, comparacao);
  const [ordem, escolherOrdem] = useOrdemDasVariacoes();
  const [acessibilidade] = useAcessibilidade();
  const cores = CORES_DO_SINAL[acessibilidade];
  const [consulta, setConsulta] = useState<Consulta | null>(null);
  if (!unidades.length) return <p className="rounded-sm border border-gray-200 bg-white p-6 text-sm text-gray-600">Seu perfil não lê nenhuma das unidades em Resultados (as abas Matriz, Filial, Serviços, Despesas e Extra e RN).</p>;
  return (
    <div className="space-y-8">
      {/* Flutuante ao rolar a tela, abaixo do título dela (como nos Cenários Analíticos). */}
      <div className="sticky top-[var(--topo-tabela,0px)] z-20 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-3 shadow-sm">
        <label htmlFor="variacoes-ordenar-por" className="text-sm font-bold text-gray-900">
          Ordenar Por
        </label>
        <select
          id="variacoes-ordenar-por"
          value={ordem}
          onChange={(e) => escolherOrdem(e.target.value as OrdemDasVariacoes)}
          className="h-9 rounded-sm border border-gray-300 bg-white px-3 text-sm"
        >
          {ORDENS.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.rotulo}
            </option>
          ))}
        </select>
        <p className="min-w-0 flex-1 text-sm text-gray-600">{ORDENS.find((o) => o.valor === ordem)?.dica}</p>
        {/* A legenda dos sinais, como a dos cards do Painel de Bordo. */}
        <p
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600"
          title="O sinal compara o realizado com o comparado: nos custos e despesas, menor é melhor; nas receitas financeiras, maior é melhor; até 5% de diferença, amarelo."
        >
          {([1, 0, -1] as Sinal[]).map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <IconeDoSinal s={s} cores={cores} />
              {ROTULO_DO_SINAL[s]}
            </span>
          ))}
        </p>
      </div>
      {unidades.map((u, k) => {
        const q = consultas[k];
        if (q.isError) return <p key={u.visao} className="rounded-sm border border-red-200 bg-red-50 p-4 text-sm text-red-700">{mensagemDeErro(q.error, `Erro ao carregar ${u.nome}.`)}</p>;
        if (!q.data) return <div key={u.visao} className="h-48 animate-pulse rounded-sm bg-gray-100" />;
        const { mes, departamentos } = variacoesDaUnidade(q.data, comparacao, ordem);
        const meses = q.data.meses;
        const consultar = (v: Variacao, card: Card) =>
          setConsulta(card.periodo === "atual" ? { linha: v.linha, visao: u.visao, unidade: u.nome, mes } : { linha: v.linha, visao: u.visao, unidade: u.nome, meses, periodo: card.rotuloDoPeriodo });
        return (
          <SecaoDaUnidade key={u.visao} nome={u.nome} rotuloMes={mes.rotulo}>
            {departamentos.length === 0 ? <p className="rounded-sm border border-gray-200 bg-white p-4 text-sm text-gray-600">Nenhuma conta de custo ou despesa com valor no período.</p> : null}
            <div className="space-y-6">
              {departamentos.map((d) => (
                <SubgrupoDoDepartamento key={d.codigo} nome={d.nome} maiorEMelhor={d.maiorEMelhor} arquivo={`Variações ${u.nome} ${mes.rotulo} - ${d.nome}`}>
                  {d.cards.map((card) => (
                    <CardDasVariacoes key={card.chave} card={card} ordem={ordem} cores={cores} rotuloDoMes={mes.rotulo} onConsultar={consultar} />
                  ))}
                </SubgrupoDoDepartamento>
              ))}
            </div>
          </SecaoDaUnidade>
        );
      })}
      {consulta && "mes" in consulta ? (
        <DetalheDialog
          anoMes={`${ano}-${String(consulta.mes.mes).padStart(2, "0")}`}
          linha={consulta.linha.codigo}
          visao={{ unidade: consulta.visao }}
          rotuloMes={consulta.mes.rotulo}
          onFechar={() => setConsulta(null)}
        />
      ) : null}
      {consulta && "meses" in consulta ? <MesesDaConta ano={ano} consulta={consulta} onFechar={() => setConsulta(null)} /> : null}
    </div>
  );
}
