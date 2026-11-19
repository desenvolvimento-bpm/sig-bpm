import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { DEFINICOES_INDICADORES, lerIndicadores, recusaPorNomesAntigos } from "../src/services/importacoes/indicadores/leituraIndicadores.js";
import { lerAbaMetas } from "../src/services/cenarios/leituraCenario.js";
import { classificar } from "../src/services/cenarios/indicadoresDoCenario.js";
import { LIBERACOES_DIGITADAS, liberacaoTotal } from "../src/services/cenarios/projetosCenario.js";
import { QUADROS_DE_LOTACAO } from "../src/services/cenarios/lotacaoCenario.js";
import { INDICADORES_DAS_LISTAS } from "../src/services/relatorios/catalogoIndicadores.js";
import { calculoDoSistema, type DadosDoMes } from "../src/services/relatorios/indicadores.js";
import { IND, NOMES_ORIGINAIS, atualDe, definirNomeAtual, nomeDo, nomesAntigos, originalDe } from "../src/services/relatorios/indicadoresDoSistema.js";
import { acumularMeta } from "../src/services/relatorios/metasOrcamento.js";
import { citaNaFormula, textoDoResumo, trocarNaFormula, trocarNosBlocos } from "../src/services/relatorios/renomearIndicador.js";

/** Volta os nomes originais depois de cada teste (o estado fica no módulo). */
afterEach(() => {
  for (const id of Object.values(IND)) definirNomeAtual(id, NOMES_ORIGINAIS[id]);
});

describe("os indicadores pelo ID (19/11/2026)", () => {
  it("a tabela tem os IDs que o código usa, com os nomes originais", () => {
    for (const id of Object.values(IND)) assert.ok(NOMES_ORIGINAIS[id], `sem o ID ${id} na tabela`);
    assert.equal(nomeDo(IND.VENDA_TOTAL), "Venda: Total");
    assert.equal(new Set(Object.values(NOMES_ORIGINAIS)).size, Object.keys(NOMES_ORIGINAIS).length, "nomes originais repetidos");
  });

  it("depois da troca, o código lê o nome novo: as listas, os conjuntos e os cálculos", () => {
    definirNomeAtual(IND.VENDA_TOTAL, "Vendas: Total");
    definirNomeAtual(IND.LIBERACAO_TOTAL, "Projetos Liberados: Total");
    definirNomeAtual(IND.QUADRO_TOTAL, "Lotação Total");
    assert.ok(DEFINICOES_INDICADORES.INDICADORES_COMERCIAL.nomes.includes("Vendas: Total"));
    assert.ok(!DEFINICOES_INDICADORES.INDICADORES_COMERCIAL.nomes.includes("Venda: Total"));
    assert.ok(INDICADORES_DAS_LISTAS.has("Vendas: Total"));
    assert.ok(!INDICADORES_DAS_LISTAS.has("Venda: Total"));
    assert.equal(liberacaoTotal(), "Projetos Liberados: Total");
    assert.ok(LIBERACOES_DIGITADAS.has("Liberação de Projetos: Matriz"));
    assert.ok(QUADROS_DE_LOTACAO.has("Lotação Total") && !QUADROS_DE_LOTACAO.has("Quadro de Lotação Total"));
    assert.equal(originalDe("Vendas: Total"), "Venda: Total");
    assert.equal(atualDe("Venda: Total"), "Vendas: Total");
  });

  it("o cálculo do sistema vale pelo ID e lê os outros indicadores pelos nomes atuais", () => {
    definirNomeAtual(IND.MEDIA_DEMANDA_GERADA, "Demanda Gerada (Média Móvel)");
    definirNomeAtual(IND.VENDA_TOTAL, "Vendas: Total");
    const calculo = calculoDoSistema({ nome: "Demanda Gerada (Média Móvel)" });
    assert.ok(calculo, "o renomeado continua com o cálculo do sistema");
    assert.equal(calculoDoSistema({ nome: "Média Móvel da Demanda Gerada" }), null);
    const importados: Record<string, number> = { "Demanda (Vol.): Total (Fabricação)": 900, "Vendas: Total": 50 };
    const m = { dre: () => 0, volume: () => 0, lista: () => NaN, importado: (n: string) => importados[n] ?? null, meta: (n: string) => (n === "Produção (Vol.): Total" ? 1000 : null) } as unknown as DadosDoMes;
    assert.deepEqual(calculo!.calculo(m), { valor: 0.9, peso: 50 });
    // A classe nos cenários segue o nome original (Eficiência… calcula; os outros do sistema vêm das metas).
    assert.equal(classificar({ nome: "Demanda Gerada (Média Móvel)", formula: null, peso: null, modo: "SISTEMA" }), "IMPORTADO");
    definirNomeAtual(IND.EFICIENCIA_OPERACAO_DIRETA_TOTAL, "Produtividade da MO Direta");
    assert.equal(classificar({ nome: "Produtividade da MO Direta", formula: null, peso: null, modo: "SISTEMA" }), "CALCULADO");
  });

  it("a meta acumulada segue as regras pelo nome original, com as bases nos nomes atuais", () => {
    definirNomeAtual(IND.MEDIA_DEMANDA_GERADA, "Demanda Gerada (Média Móvel)");
    definirNomeAtual(IND.VENDA_TOTAL, "Vendas: Total");
    const meses = [new Map([["Demanda Gerada (Média Móvel)", 0.5], ["Vendas: Total", 100]]), new Map([["Demanda Gerada (Média Móvel)", 1], ["Vendas: Total", 300]])];
    // Ponderada pela venda: (0,5 × 100 + 1 × 300) ÷ 400.
    assert.equal(acumularMeta({ nome: "Demanda Gerada (Média Móvel)", acumulado: "ACUM" }, meses), (0.5 * 100 + 1 * 300) / 400);
  });
});

describe("as importações recusam os nomes antigos (19/11/2026)", () => {
  const aba = (nomes: string[]) => [
    { numero: 1, celulas: ["INDICADOR", "01/08/2026"] },
    ...nomes.map((n, k) => ({ numero: k + 2, celulas: [n, 10 + k] })),
  ];

  it("a linha com o nome antigo é rejeitada, com o nome novo, e recusa o arquivo", () => {
    definirNomeAtual(IND.VENDA_TOTAL, "Vendas: Total");
    assert.equal(nomesAntigos().get("Venda: Total"), "Vendas: Total");
    const l = lerIndicadores("INDICADORES_COMERCIAL", aba(["Venda: Global", "Venda: Total"]), 2026, 8);
    assert.ok(l.ok);
    assert.deepEqual(l.valores.map((v) => v.nome), ["Venda: Global"]);
    assert.equal(l.rejeicoes[0].codigo, "NOME_ANTIGO");
    assert.match(l.rejeicoes[0].mensagem, /"Venda: Total" é o nome antigo do indicador Vendas: Total/);
    assert.match(recusaPorNomesAntigos(l.rejeicoes) ?? "", /nada foi gravado: linha 3, "Venda: Total" é o nome antigo do indicador Vendas: Total\. Mude os nomes no arquivo/);
    const nova = lerIndicadores("INDICADORES_COMERCIAL", aba(["Vendas: Total"]), 2026, 8);
    assert.ok(nova.ok);
    assert.deepEqual(nova.valores.map((v) => v.nome), ["Vendas: Total"]);
    assert.equal(recusaPorNomesAntigos(nova.rejeicoes), null);
  });

  it("sem troca, nada muda (e o apelido da aba das metas vale)", () => {
    assert.equal(nomesAntigos().size, 0);
    const l = lerIndicadores("INDICADORES_COMERCIAL", aba(["Venda: Total"]), 2026, 8);
    assert.ok(l.ok && l.valores.length === 1 && l.rejeicoes.length === 0);
    const metas = lerAbaMetas("Metas", [{ numero: 1, celulas: ["INDICADOR", "JAN/2026"] }, { numero: 2, celulas: ["Quadro de Lotação", 300] }], ["Quadro de Lotação Total"]);
    assert.deepEqual(metas?.valores, [{ nome: "Quadro de Lotação Total", mes: 1, valor: 300 }]);
    assert.deepEqual(metas?.nomesAntigos, []);
  });

  it("na aba das metas do cenário, o nome antigo e o apelido do renomeado são listados (o arquivo é recusado)", () => {
    definirNomeAtual(IND.QUADRO_TOTAL, "Lotação Total");
    const metas = lerAbaMetas(
      "Metas",
      [{ numero: 1, celulas: ["INDICADOR", "JAN/2026"] }, { numero: 2, celulas: ["Quadro de Lotação Total", 300] }, { numero: 3, celulas: ["Quadro de Lotação", 300] }, { numero: 4, celulas: ["Lotação Total", 300] }],
      ["Lotação Total"],
    );
    assert.deepEqual(metas?.valores, [{ nome: "Lotação Total", mes: 1, valor: 300 }]);
    assert.deepEqual(metas?.nomesAntigos, ["Quadro de Lotação Total → Lotação Total", "Quadro de Lotação → Lotação Total"]);
  });
});

describe("a troca do nome nos dados (19/11/2026)", () => {
  it("troca o indicador nos itens das fórmulas, com o Acumulado no Ano, e só ele", () => {
    const f = "[IND|Venda: Total] + [META|Venda: Total|ACUM] / [INDICADOR|Venda: Total] - [INDICADOR|Venda: Total (Outro)] + [MQL|Venda: Total] + [DRE|1|Venda: Total]";
    assert.equal(
      trocarNaFormula(f, "Venda: Total", "Vendas: Total"),
      "[IND|Vendas: Total] + [META|Vendas: Total|ACUM] / [INDICADOR|Vendas: Total] - [INDICADOR|Venda: Total (Outro)] + [MQL|Venda: Total] + [DRE|1|Venda: Total]",
    );
    // Os sinais das expressões regulares no nome.
    assert.equal(trocarNaFormula("[INDICADOR|Produção (Vol.): Total]", "Produção (Vol.): Total", "Volume Produzido"), "[INDICADOR|Volume Produzido]");
    assert.ok(citaNaFormula("[META|Produção (Vol.): Total|ACUM]", "Produção (Vol.): Total"));
    assert.ok(!citaNaFormula("[META|Produção (Vol.)xTotal]", "Produção (Vol.): Total"));
  });

  it("troca os blocos que casam, em qualquer profundidade das páginas, e conta", () => {
    const paginas = [
      { id: "p1", blocos: [{ id: "a", tipo: "INDICADOR", nome: "Turnover" }, { id: "b", tipo: "PAINEL", aba: "resultados", quadro: "Consolidado", titulo: "Turnover", sigla: "T" }] },
      { id: "p2", blocos: [{ id: "c", tipo: "INDICADOR", nome: "Turnover", grafico: "MESES" }, { id: "d", tipo: "TEXTO", texto: "Turnover" }] },
    ];
    const r = trocarNosBlocos(paginas, (b) => b.tipo === "INDICADOR" && b.nome === "Turnover", (b) => ({ ...b, nome: "Rotatividade" }));
    assert.equal(r.trocas, 2);
    const novos = r.json as typeof paginas;
    assert.deepEqual(novos[0].blocos[0], { id: "a", tipo: "INDICADOR", nome: "Rotatividade" });
    assert.deepEqual(novos[0].blocos[1], paginas[0].blocos[1]);
    assert.deepEqual(novos[1].blocos[0], { id: "c", tipo: "INDICADOR", nome: "Rotatividade", grafico: "MESES" });
    assert.deepEqual(novos[1].blocos[1], paginas[1].blocos[1]);
  });

  it("o resumo diz só o que mudou, no singular e no plural", () => {
    assert.equal(textoDoResumo({ importados: 12, digitados: 0, cenarios: 1, blocosDosRelatorios: 3 }), "12 valores importados, 1 valor dos cenários, 3 cards dos Relatórios Executivos");
    assert.equal(textoDoResumo({ importados: 0 }), null);
  });
});
