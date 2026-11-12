import { limparNome, nomeDoDepartamento, TIPO_ZIP, zipDeArquivos } from "../../lib/arquivosExportados.js";
import { coluna, ESTILO, gerarXlsx, nomesDasAbas, type AbaEscrita, type Celula } from "../../lib/xlsxEscrita.js";
import { estrutura } from "../dre/dreService.js";
import { arquivoDeResultados, identificacaoLivre, type Bloco, type Formato } from "../relatorios/exportacaoRelatoriosService.js";
import { CenarioError, cenariosService, rotuloVersao } from "./cenariosService.js";
import { abaConsolidado, juntarOrigem, type OrigensDasContas } from "./consolidadoDosCentros.js";
import { maosDeObraDoGrupo } from "./encargosCenario.js";

type Usuario = NonNullable<Parameters<typeof cenariosService.obter>[1]>;

const VISOES: Array<{ visao: 0 | 1 | 2 | 3 | 4 | 5; nome: string }> = [
  { visao: 0, nome: "Consolidado" },
  { visao: 1, nome: "Matriz" },
  { visao: 2, nome: "Filial" },
  { visao: 3, nome: "Serviços" },
  { visao: 4, nome: "Despesas e Extra" },
  { visao: 5, nome: "RN" },
];
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type EscopoResultadosDoCenario = { tipo: "visao"; visao: 0 | 1 | 2 | 3 | 4 | 5 } | { tipo: "unidades" };
export type EscopoCentrosDoCenario = { tipo: "centro"; grupo: string } | { tipo: "centros" } | { tipo: "centrosArquivos" };

/** "Cenário Orgânico VER00 (2027)": o nome do cenário nos arquivos. */
const nomeDoCenario = (c: { nome: string; versao: number; ano: number }) => `${/^cen[aá]rio/i.test(c.nome) ? "" : "Cenário "}${c.nome} ${rotuloVersao(c.versao)} (${c.ano})`;

/**
 * A exportação dos cenários (14/10/2026), como a de Resultados Empresariais: a DRE do cenário (a visão na tela ou as seis,
 * uma por aba no Excel ou por página no PDF, no mesmo formato) e, nos analíticos, os centros de custo em Excel (o
 * centro na tela, todos numa planilha — um por aba, com o Consolidado na primeira (15/10/2026) — ou um arquivo por
 * centro, num ZIP, com o departamento e o centro no nome).
 */
export const exportacaoCenarioService = {
  async resultados(id: string, escopo: EscopoResultadosDoCenario, formato: Formato, usuario: Usuario) {
    const c = await cenariosService.obter(id, usuario);
    const visoes = escopo.tipo === "unidades" ? VISOES : VISOES.filter((v) => v.visao === escopo.visao);
    const bs: Bloco[] = [];
    for (const v of visoes) bs.push({ nome: v.nome, titulo: `${nomeDoCenario(c)} · ${v.nome}`, dados: await cenariosService.resultados(id, v.visao, usuario) });
    const ident = identificacaoLivre(`${nomeDoCenario(c)} · os doze meses do exercício`, usuario.nome);
    const nomeVisao = escopo.tipo === "unidades" ? "todas as unidades" : bs[0].nome;
    return arquivoDeResultados(bs, ident, formato, `${nomeDoCenario(c)} - ${nomeVisao}`, limparNome(`${nomeDoCenario(c)} - ${nomeVisao}.${formato}`));
  },

  async centros(id: string, escopo: EscopoCentrosDoCenario, usuario: Usuario) {
    const c = await cenariosService.obter(id, usuario);
    const lista = await cenariosService.centros(id, usuario);
    // Todos: os grupos com valor no cenário.
    const grupos = escopo.tipo === "centro" ? lista.grupos.filter((g) => g.grupo === escopo.grupo) : lista.grupos.filter((g) => g.total !== 0);
    if (!grupos.length) throw new CenarioError(404, escopo.tipo === "centro" ? "Grupo de centros de custo não encontrado." : "Nenhum centro de custo com valor no cenário.");
    const geracao = identificacaoLivre("", usuario.nome).geracao;
    const abas: Array<{ aba: AbaEscrita; departamento: string; grupo: string; contas: ContasDaAba }> = [];
    for (const g of grupos) {
      const dados = await cenariosService.centro(id, g.grupo, usuario);
      const departamento = nomeDoDepartamento(g.departamento);
      const contas: ContasDaAba = [];
      abas.push({ grupo: g.grupo, departamento, contas, aba: abaDoCentro(g.grupo, departamento, g.destino, nomeDoCenario(c), geracao, lista.meses, dados, contas) });
    }
    const nomeBase = nomeDoCenario(c);
    if (escopo.tipo === "centrosArquivos") {
      const conteudo = zipDeArquivos(abas.map((a) => ({ nome: `${a.departamento} - ${a.grupo} - ${nomeBase}.xlsx`, conteudo: gerarXlsx([a.aba], `${nomeBase} - ${a.grupo}`) })));
      return { nomeArquivo: limparNome(`${nomeBase} - centros de custo (um arquivo por centro).zip`), tipo: TIPO_ZIP, conteudo, visoes: abas.map((a) => a.grupo) };
    }
    const nomeVisao = escopo.tipo === "centro" ? `${abas[0].departamento} - ${abas[0].grupo}` : "todos os centros de custo";
    const planilhas = abas.map((a) => a.aba);
    if (escopo.tipo === "centros") {
      // O Consolidado na primeira aba (15/10/2026), com as fórmulas apontando para os nomes finais das abas.
      const nomes = nomesDasAbas(["Consolidado", ...planilhas.map((p) => p.nome)]);
      const origens: OrigensDasContas = new Map();
      const colunas = lista.meses.map((_, k) => coluna(2 + k));
      abas.forEach((a, i) => {
        a.aba.nome = nomes[i + 1];
        for (const x of a.contas) juntarOrigem(origens, x.codigo, { aba: a.aba.nome, linha: x.linha, colunas, valores: x.valores });
      });
      planilhas.unshift(
        abaConsolidado({
          est: await estrutura(),
          informacoes: [
            `${nomeBase} · ${geracao}`,
            "A DRE das contas dos centros de custo: cada conta é a soma dela nas abas dos centros (em fórmulas: acompanha os valores das abas); as atribuições, os grupos e o total somam as contas. Confira com a DRE do cenário (tela Resultados / Consolidado): o total bate; por conta, a parte dos rateios que vai para Serviços (Metalurgia, Armadura e Acompanhamento) está, na DRE, nas contas da CSM ou da CSC. O Quadro de Lotação e os Encargos e Benefícios (os percentuais) não entram; a conta Encargos e Benefícios, sim.",
          ],
          rotulos: lista.meses.map((m) => m.rotulo),
          total: [0, lista.meses.length - 1],
          origens,
          rodape: `${nomeBase} · Consolidado`,
        }),
      );
    }
    return { nomeArquivo: limparNome(`${nomeBase} - ${nomeVisao}.xlsx`), tipo: XLSX, conteudo: gerarXlsx(planilhas, `${nomeBase} - ${nomeVisao}`), visoes: abas.map((a) => a.grupo) };
  },
};

/** As contas de uma aba de centro, para o Consolidado: o código, a linha na aba e os doze meses. */
type ContasDaAba = Array<{ codigo: string; linha: number; valores: number[] }>;

/**
 * A aba de um grupo de centros (19/10/2026: como a tabela Premissas da tela): o Quadro de Lotação (Colaboradores CLT e PJ
 * e o Total de Colaboradores, em fórmula; no total, a média), os Encargos e Benefícios (os percentuais e os Benefícios
 * Adicionais) e as contas por atribuição, nos doze meses e no total. A conta Encargos e Benefícios vai em fórmula:
 * base × [(INSS + FGTS + Férias + Décimo Terceiro) + (INSS + FGTS) × (Férias + Décimo Terceiro)] + Benefícios Adicionais
 * (20/10/2026: com a incidência sobre as provisões; a base = Remunerações CLT + Horas Extras; os benefícios, na mão de obra
 * da atribuição do grupo); os subtotais e o total somam as contas, também em fórmula. Desde 09/11/2026 (o Quadro de Lotação
 * do cenário), o FGTS em duas linhas (Aprendiz e CLT) e, nos grupos com linhas no Quadro de Lotação, os colaboradores e as
 * remunerações vindos de lá. Desde 11/11/2026, os Colaboradores Aprendizes e Estagiários antes dos CLT (o Total soma os
 * quatro). Desde 12/11/2026 (pedido do Adão), os Salários de cada tipo (Aprendizes, Estagiários, CLT e PJ; antes, os dos
 * Aprendizes e dos Estagiários de cada mão de obra): na mão de obra principal do grupo, as Remunerações CLT são a soma dos
 * três primeiros e as PJ, os Salários PJ, em fórmula; os Encargos e Benefícios dela tiram da base os Salários dos
 * Estagiários e aplicam o FGTS Aprendiz aos Salários dos Aprendizes.
 */
function abaDoCentro(
  grupo: string,
  departamento: string,
  destino: string,
  cenario: string,
  geracao: string,
  meses: Array<{ rotulo: string }>,
  dados: Awaited<ReturnType<typeof cenariosService.centro>>,
  contasDaAba: ContasDaAba,
): AbaEscrita {
  const soma = (vs: number[]) => vs.reduce((s, v) => s + v, 0);
  const arred = (v: number) => Math.round(v * 100) / 100;
  const num = (v: number | null, destaque: boolean, formula?: string, percentual = false): Celula => ({
    valor: v === null ? null : percentual ? v : arred(v),
    estilo: percentual ? (destaque ? ESTILO.destaquePercentual : ESTILO.itemPercentual) : destaque ? ESTILO.destaqueNumero : ESTILO.itemNumero,
    formula,
  });
  const cab = (t: string) => ({ valor: t, estilo: ESTILO.cabecalhoDireita });
  const cMes = (k: number) => coluna(2 + k);
  const [cJan, cDez] = [cMes(0), cMes(11)];
  const linhas: Celula[][] = [
    [{ valor: `Centro de Custo ${grupo}`, estilo: ESTILO.titulo }],
    [{ valor: `${cenario} · ${departamento} · destino: ${destino}`, estilo: ESTILO.informacao }],
    [{ valor: `Centros: ${dados.grupo.centros.map((x) => `${x.codigo ?? "sem código"} ${x.nome}`).join("; ")}`, estilo: ESTILO.informacao }],
    [{ valor: geracao, estilo: ESTILO.informacao }],
    [],
    [{ valor: "Premissas", estilo: ESTILO.cabecalho }, { valor: "Linha", estilo: ESTILO.cabecalho }, ...meses.map((m) => cab(m.rotulo)), cab("Total")],
  ];
  const cabecalho = linhas.length;
  // A linha seguinte (1 a n, como no Excel).
  const proxima = () => linhas.length + 1;
  const secao = (titulo: string, detalhe: string | null = null) =>
    linhas.push([{ valor: titulo, estilo: ESTILO.destaque }, { valor: detalhe, estilo: ESTILO.destaque }, ...meses.map(() => ({ valor: null, estilo: ESTILO.destaque })), { valor: null, estilo: ESTILO.destaque }]);

  // O quadro de lotação: os colaboradores de cada mês; no total, a média.
  secao("Quadro de Lotação", `Entra em: ${dados.lotacao.quadro}`);
  // Com linhas no Quadro de Lotação do cenário (09/11/2026), os colaboradores vêm de lá.
  const doQuadro = dados.lotacao.linhasDoQuadro > 0 ? " (do Quadro de Lotação)" : "";
  // Os colaboradores (11/11/2026: com linhas no Quadro de Lotação, os Aprendizes e os Estagiários antes dos CLT); no total, a média.
  const series = [
    ...(dados.lotacao.aprendizes ? [["Colaboradores Aprendizes", dados.lotacao.aprendizes.valores] as const] : []),
    ...(dados.lotacao.estagiarios ? [["Colaboradores Estagiários", dados.lotacao.estagiarios.valores] as const] : []),
    ["Colaboradores CLT", dados.lotacao.clt.valores] as const,
    ["Colaboradores PJ", dados.lotacao.pj.valores] as const,
  ];
  const linhasDaLotacao: number[] = [];
  for (const [rotulo, valores] of series) {
    const r = proxima();
    linhasDaLotacao.push(r);
    linhas.push([{ valor: null, estilo: ESTILO.item }, { valor: `${rotulo}${doQuadro}`, estilo: ESTILO.item }, ...valores.map((v) => num(v, false)), num(soma(valores) / 12, false, `AVERAGE(${cJan}${r}:${cDez}${r})`)]);
  }
  const rTot = proxima();
  const totalLot = Array.from({ length: 12 }, (_, k) => soma(series.map(([, valores]) => valores[k] ?? 0)));
  linhas.push([
    { valor: null, estilo: ESTILO.destaque },
    { valor: "Total de Colaboradores", estilo: ESTILO.destaque },
    ...totalLot.map((v, k) => num(v, true, linhasDaLotacao.map((r) => `${cMes(k)}${r}`).join("+"))),
    num(soma(totalLot) / 12, true, `AVERAGE(${cJan}${rTot}:${cDez}${rTot})`),
  ]);
  // Os Salários de cada tipo de colaborador (12/11/2026; os valores do Quadro de Lotação do cenário); no total, a soma.
  const linhaDoSalario = new Map<string, number>();
  for (const s of dados.salarios) {
    const r = proxima();
    linhaDoSalario.set(s.tipo, r);
    linhas.push([{ valor: null, estilo: ESTILO.item }, { valor: `${s.rotulo}${doQuadro}`, estilo: ESTILO.item }, ...s.valores.map((v) => num(v, false)), num(soma(s.valores), false, `SUM(${cJan}${r}:${cDez}${r})`)]);
  }
  const salario = (tipo: string, k: number) => `${cMes(k)}${linhaDoSalario.get(tipo)}`;

  // Os encargos e benefícios: os percentuais (em fração, no formato %; no total, a média) e os Benefícios Adicionais (R$).
  secao(
    "Encargos e Benefícios",
    "base × [(INSS + FGTS CLT + Férias + 13º) + (INSS + FGTS CLT) × (Férias + 13º)] + (FGTS Aprendiz − FGTS CLT) × Salários dos Aprendizes × (1 + Férias + 13º) + Benefícios Adicionais; base = Remunerações CLT + Horas Extras − Salários dos Estagiários",
  );
  const linhaDoItem = new Map<string, number>();
  for (const e of dados.encargos) {
    const r = proxima();
    linhaDoItem.set(e.item, r);
    const percentual = e.und === "%";
    const valores = e.valores.map((v) => (percentual ? v / 100 : v));
    linhas.push([
      { valor: null, estilo: ESTILO.item },
      { valor: e.rotulo, estilo: ESTILO.item },
      ...valores.map((v) => num(v, false, undefined, percentual)),
      percentual ? num(soma(valores) / 12, false, `AVERAGE(${cJan}${r}:${cDez}${r})`, true) : num(soma(valores), false, `SUM(${cJan}${r}:${cDez}${r})`),
    ]);
  }
  // O fator (20/10/2026): (INSS + FGTS) + (Férias + 13º) + (INSS + FGTS) × (Férias + 13º).
  const percentuais = (k: number) => {
    const c = (item: string) => `${cMes(k)}${linhaDoItem.get(item)}`;
    const [folha, provisoes] = [`(${c("INSS")}+${c("FGTS")})`, `(${c("FERIAS")}+${c("DECIMO_TERCEIRO")})`];
    return `${folha}+${provisoes}+${folha}*${provisoes}`;
  };

  // As contas por atribuição; a Encargos e Benefícios em fórmula, das linhas da mesma atribuição.
  const atribuicoes = [...new Set(dados.contas.map((x) => x.atribuicao))];
  const total = Array<number>(12).fill(0);
  const subtotais: number[] = [];
  for (const a of atribuicoes) {
    const contas = dados.contas.filter((x) => x.atribuicao === a);
    const sub = Array.from({ length: 12 }, (_, k) => soma(contas.map((x) => x.valores[k])));
    sub.forEach((v, k) => (total[k] += v));
    const rSub = proxima();
    subtotais.push(rSub);
    const [primeira, ultima] = [rSub + 1, rSub + contas.length];
    linhas.push([
      { valor: a, estilo: ESTILO.destaque },
      { valor: null, estilo: ESTILO.destaque },
      ...sub.map((v, k) => num(v, true, `SUM(${cMes(k)}${primeira}:${cMes(k)}${ultima})`)),
      num(soma(sub), true, `SUM(${cJan}${rSub}:${cDez}${rSub})`),
    ]);
    const linhaDaConta = new Map(contas.map((x, i) => [x.codigo, primeira + i]));
    // As contas de base da Encargos e Benefícios desta atribuição (o prefixo "CPP.MOD"…).
    const prefixo = (codigo: string) => codigo.split(".").slice(0, 2).join(".");
    for (const x of contas) {
      const r = proxima();
      const rem = linhaDaConta.get(`${prefixo(x.codigo)}.REMUNERACOES_CLT`);
      const he = linhaDaConta.get(`${prefixo(x.codigo)}.HORAS_EXTRAS`);
      const comBeneficios = beneficiosNaConta(dados, x.codigo);
      // Na mão de obra principal (12/11/2026: a que recebe as remunerações do Quadro de Lotação), os salários do grupo.
      const daPrincipal = !!dados.principal && prefixo(x.codigo) === dados.principal;
      // 09/11/2026: a diferença do FGTS dos aprendizes sobre os salários deles, com a incidência nas provisões.
      const aprendizes = (k: number) => {
        if (!daPrincipal) return "";
        const c = (item: string) => `${cMes(k)}${linhaDoItem.get(item)}`;
        return `+(${c("FGTS_APRENDIZ")}-${c("FGTS")})*${salario("aprendizes", k)}*(1+${c("FERIAS")}+${c("DECIMO_TERCEIRO")})`;
      };
      // 11/11/2026: os salários dos estagiários saem da base.
      const estagiarios = (k: number) => (daPrincipal ? `-${salario("estagiarios", k)}` : "");
      // As Remunerações da mão de obra principal (12/11/2026): CLT, os Salários dos Aprendizes, dos Estagiários e CLT; PJ, os Salários PJ.
      const remuneracao = (k: number) =>
        !daPrincipal || !x.doQuadro
          ? undefined
          : x.codigo.endsWith(".REMUNERACOES_PJ")
            ? salario("pj", k)
            : ["aprendizes", "estagiarios", "clt"].map((t) => salario(t, k)).join("+");
      const formula = (k: number) =>
        x.calculada && !x.doQuadro
          ? `(${rem ? `${cMes(k)}${rem}` : "0"}+${he ? `${cMes(k)}${he}` : "0"}${estagiarios(k)})*(${percentuais(k)})${aprendizes(k)}${comBeneficios ? `+${cMes(k)}${linhaDoItem.get("BENEFICIOS")}` : ""}`
          : remuneracao(k);
      linhas.push([
        { valor: null, estilo: ESTILO.item },
        { valor: x.doQuadro ? `${x.descricao} (do Quadro de Lotação)` : x.calculada ? `${x.descricao} (calculada)` : x.descricao, estilo: ESTILO.item },
        ...x.valores.map((v, k) => num(v, false, formula(k))),
        num(soma(x.valores), false, `SUM(${cJan}${r}:${cDez}${r})`),
      ]);
      contasDaAba.push({ codigo: x.codigo, linha: r, valores: x.valores.map(arred) });
    }
  }
  const rTotal = proxima();
  linhas.push([
    { valor: "Total do Centro", estilo: ESTILO.destaque },
    { valor: null, estilo: ESTILO.destaque },
    ...total.map((v, k) => num(v, true, subtotais.length ? subtotais.map((r) => `${cMes(k)}${r}`).join("+") : undefined)),
    num(soma(total), true, `SUM(${cJan}${rTotal}:${cDez}${rTotal})`),
  ]);
  return { nome: grupo, larguras: [26, 44, ...meses.map(() => 13), 15], linhas, linhaCabecalho: cabecalho, rodape: `${cenario} · Centro de Custo ${grupo}`, paisagem: true, congelarPrimeiraColuna: true };
}

/**
 * A conta Encargos e Benefícios que leva os Benefícios Adicionais: a da mão de obra da atribuição do grupo (Direta: a MOD;
 * Indireta ou sem atribuição: a MOI; a outra, quando o grupo só tem uma), como no cálculo (encargosCenario.ts).
 */
function beneficiosNaConta(dados: Awaited<ReturnType<typeof cenariosService.centro>>, codigo: string) {
  return !!maosDeObraDoGrupo(dados.contas.map((x) => x.codigo), dados.grupo.atribuicao).find((m) => m.encargos === codigo)?.beneficios;
}
