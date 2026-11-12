import { coluna, ESTILO, type AbaEscrita, type Celula } from "../../lib/xlsxEscrita.js";
import type { LinhaEstrutura } from "../dre/apuracaoUnidades.js";

/**
 * A aba Consolidado das exportações dos centros de custo um por aba (15/10/2026): a primeira aba do arquivo, com a DRE
 * das contas dos centros — cada conta é a soma dela em todas as abas dos centros, e as atribuições (Mão de Obra Direta,
 * Gastos Gerais Indiretos…), os grupos da DRE (CPP, DL, DA…) e o total somam as contas. As células são fórmulas que
 * apontam para as células das abas: ao mudar um valor numa aba, o Consolidado acompanha. Serve para conferir se o total
 * das contas bate com a DRE do cenário.
 */

/** Onde está uma conta numa aba de centro: o nome final da aba, a linha e as colunas dos valores (as do Consolidado, na ordem). */
export type OrigemDaConta = { aba: string; linha: number; colunas: string[]; valores: Array<number | null> };

/** As origens das contas, por código da conta da DRE. */
export type OrigensDasContas = Map<string, OrigemDaConta[]>;

export function juntarOrigem(origens: OrigensDasContas, conta: string, o: OrigemDaConta) {
  const lista = origens.get(conta) ?? [];
  lista.push(o);
  origens.set(conta, lista);
}

const referencia = (o: OrigemDaConta, k: number) => `'${o.aba.replace(/'/g, "''")}'!${o.colunas[k]}${o.linha}`;
const arredondar = (v: number) => Math.round(v * 100) / 100;

export function abaConsolidado(o: {
  est: LinhaEstrutura[];
  /** O título (na linha 1) e as informações (as linhas seguintes). */
  informacoes: string[];
  /** Os rótulos das colunas de valores. */
  rotulos: string[];
  /** As colunas de valores (índices em `rotulos`) que o Total soma: os doze meses. */
  total: [number, number];
  origens: OrigensDasContas;
  rodape: string;
  /** Os rótulos com a quebra de texto automática (11/11/2026: o Exportar Premissas). */
  quebra?: boolean;
}): AbaEscrita {
  const n = o.rotulos.length;
  const cab = (valor: string): Celula => ({ valor, estilo: o.quebra ? ESTILO.cabecalhoQuebra : ESTILO.cabecalho });
  const cabDireita = (valor: string): Celula => ({ valor, estilo: o.quebra ? ESTILO.cabecalhoDireitaQuebra : ESTILO.cabecalhoDireita });
  const linhas: Celula[][] = [
    [{ valor: "Consolidado", estilo: ESTILO.titulo }],
    ...o.informacoes.map((t): Celula[] => [{ valor: t, estilo: ESTILO.informacao }]),
    [],
    [cab("Conta"), ...o.rotulos.map(cabDireita), cabDireita("Total")],
  ];
  const linhaCabecalho = linhas.length;
  // Coluna A: a conta; B em diante: os valores; depois deles, o Total.
  const colValor = (k: number) => coluna(1 + k);
  const colTotal = coluna(1 + n);
  const totalDaLinha = (r: number, destaque: boolean, valores: number[]): Celula => ({
    formula: `SUM(${colValor(o.total[0])}${r}:${colValor(o.total[1])}${r})`,
    valor: arredondar(valores.slice(o.total[0], o.total[1] + 1).reduce((s, v) => s + v, 0)),
    estilo: destaque ? ESTILO.destaqueNumero : ESTILO.itemNumero,
  });

  // As contas dos centros, na ordem da DRE, com o grupo (a linha de 2 partes do código) e a atribuição (a de 3) de cada uma.
  const totais = o.est.filter((l) => l.tipo !== "ITEM");
  type Grupo = { rotulo: string; atribuicoes: Array<{ rotulo: string; contas: LinhaEstrutura[] }> };
  const grupos: Grupo[] = [];
  for (const l of o.est) {
    if (l.tipo !== "ITEM" || !o.origens.has(l.codigo)) continue;
    const partes = l.codigo.split(".");
    const rotuloGrupo = totais.find((t) => t.grupoSigla === l.grupoSigla && t.codigo.split(".").length === 2)?.descricao ?? l.grupo;
    const rotuloAtribuicao = totais.find((t) => t.codigo.startsWith(`${partes.slice(0, 2).join(".")}.`))?.descricao ?? l.atribuicao ?? "";
    let g = grupos.at(-1);
    if (!g || g.rotulo !== rotuloGrupo) grupos.push((g = { rotulo: rotuloGrupo, atribuicoes: [] }));
    let a = g.atribuicoes.at(-1);
    if (!a || a.rotulo !== rotuloAtribuicao) g.atribuicoes.push((a = { rotulo: rotuloAtribuicao, contas: [] }));
    a.contas.push(l);
  }

  // As linhas de soma (o grupo e a atribuição) recebem a fórmula depois de saber as linhas que somam.
  const somar = (r: number, filhas: Array<{ r: number; valores: number[] }>, rotulo: string, destaque: boolean) => {
    const valores = Array.from({ length: n }, (_, k) => filhas.reduce((s, f) => s + f.valores[k], 0));
    linhas[r - 1] = [
      { valor: rotulo, estilo: destaque ? ESTILO.destaque : ESTILO.padrao },
      ...valores.map((v, k): Celula => ({
        formula: filhas.length ? `SUM(${filhas.map((f) => `${colValor(k)}${f.r}`).join(",")})` : undefined,
        valor: arredondar(v),
        estilo: destaque ? ESTILO.destaqueNumero : ESTILO.itemNumero,
      })),
      totalDaLinha(r, destaque, valores),
    ];
    return { r, valores };
  };
  const reservar = () => {
    linhas.push([]);
    return linhas.length;
  };
  const doGrupo: Array<{ r: number; valores: number[] }> = [];
  for (const g of grupos) {
    const rGrupo = reservar();
    const dasAtribuicoes: Array<{ r: number; valores: number[] }> = [];
    for (const a of g.atribuicoes) {
      const rAtribuicao = reservar();
      const dasContas: Array<{ r: number; valores: number[] }> = [];
      for (const l of a.contas) {
        const origens = o.origens.get(l.codigo)!;
        const r = reservar();
        const valores = Array.from({ length: n }, (_, k) => origens.reduce((s, x) => s + (x.valores[k] ?? 0), 0));
        linhas[r - 1] = [
          { valor: l.descricao, estilo: ESTILO.item },
          ...valores.map((v, k): Celula => ({ formula: origens.map((x) => referencia(x, k)).join("+"), valor: arredondar(v), estilo: ESTILO.itemNumero })),
          totalDaLinha(r, false, valores),
        ];
        dasContas.push({ r, valores });
      }
      dasAtribuicoes.push(somar(rAtribuicao, dasContas, a.rotulo, false));
    }
    doGrupo.push(somar(rGrupo, dasAtribuicoes, g.rotulo, true));
  }
  somar(reservar(), doGrupo, "TOTAL DOS CENTROS DE CUSTO", true);

  return { nome: "Consolidado", larguras: [52, ...o.rotulos.map(() => 14), 15], linhas, linhaCabecalho, rodape: o.rodape, paisagem: true, congelarPrimeiraColuna: true };
}
