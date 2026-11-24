import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { montarDepartamentos, type LinhaDaEstrutura } from "../src/services/relatorios/departamentosDaDRE.js";

// Um pedaço da estrutura da DRE: a ROL, o CPV, a CPP (Mão de Obra Indireta, Matérias Primas), a DT e o EBITDA.
const L = (codigo: string, tipo: string, descricao: string): LinhaDaEstrutura => ({
  id: codigo,
  codigo,
  tipo,
  grupo: codigo.split(".")[0],
  grupoSigla: codigo.split(".")[0],
  atribuicaoSigla: codigo.split(".").length === 3 ? codigo.split(".")[1] : null,
  descricao,
});
const ESTRUTURA = [
  L("ROL.RECEITA_OPERACIONAL_LIQUIDA_ROL", "SUBTOTAL", "RECEITA OPERACIONAL LÍQUIDA (ROL)"),
  L("CPV.CUSTO_DE_PRODUTO_VENDIDO_CPV", "TOTAL", "CUSTO DE PRODUTO VENDIDO (CPV)"),
  L("CPP.CUSTOS_DE_PRODUCAO_CPP", "SUBTOTAL", "CUSTOS DE PRODUÇÃO (CPP)"),
  L("CPP.MOI.MAO_DE_OBRA_INDIRETA", "SUBTOTAL", "Mão de Obra Indireta"),
  L("CPP.MOI.REMUNERACOES_CLT", "ITEM", "Remunerações CLT"),
  L("CPP.MOI.ENCARGOS_E_BENEFICIOS", "ITEM", "Encargos e Benefícios"),
  L("CPP.MP.MATERIAS_PRIMAS", "SUBTOTAL", "Matérias Primas"),
  L("CPP.MP.CIMENTO", "ITEM", "Cimento"),
  L("DT.DESPESAS_TECNICAS_DT", "SUBTOTAL", "DESPESAS TÉCNICAS (DT)"),
  L("DT.MOI.MAO_DE_OBRA_INDIRETA", "SUBTOTAL", "Mão de Obra Indireta"),
  L("DT.MOI.REMUNERACOES_CLT", "ITEM", "Remunerações CLT"),
  L("EBITDA.LUCRO_OPERACIONAL_EBITDA", "TOTAL", "LUCRO OPERACIONAL (EBITDA)"),
];
const mapa = (o: Record<string, number>) => new Map(Object.entries(o));
// Dois meses do Consolidado.
const CONSOLIDADO = [
  mapa({
    "ROL.RECEITA_OPERACIONAL_LIQUIDA_ROL": 1000,
    "CPV.CUSTO_DE_PRODUTO_VENDIDO_CPV": 600,
    "CPP.CUSTOS_DE_PRODUCAO_CPP": 600,
    "CPP.MOI.MAO_DE_OBRA_INDIRETA": 200,
    "CPP.MOI.REMUNERACOES_CLT": 150,
    "CPP.MOI.ENCARGOS_E_BENEFICIOS": 50,
    "CPP.MP.MATERIAS_PRIMAS": 400,
    "CPP.MP.CIMENTO": 400,
    "DT.DESPESAS_TECNICAS_DT": 80,
    "DT.MOI.MAO_DE_OBRA_INDIRETA": 80,
    "DT.MOI.REMUNERACOES_CLT": 80,
    "EBITDA.LUCRO_OPERACIONAL_EBITDA": 320,
  }),
  mapa({ "CPP.CUSTOS_DE_PRODUCAO_CPP": 100, "CPP.MP.MATERIAS_PRIMAS": 100, "CPP.MP.CIMENTO": 100 }),
];
// Os grupos de centros: ACABAMENTO só na CPP; PROJETO na DT e uma parte na CPP (o rateio); os Encargos da CPP têm 10 sem centro.
const CENTROS = new Map([
  ["ACABAMENTO", [mapa({ "CPP.MOI.REMUNERACOES_CLT": 100, "CPP.MOI.ENCARGOS_E_BENEFICIOS": 30 }), mapa({})]],
  ["PROJETO", [mapa({ "CPP.MOI.REMUNERACOES_CLT": 50, "CPP.MOI.ENCARGOS_E_BENEFICIOS": 10, "DT.MOI.REMUNERACOES_CLT": 80 }), mapa({})]],
]);

describe("montarDepartamentos (a aba Departamentos dos Resultados)", () => {
  const d = montarDepartamentos(ESTRUTURA, [{ consolidado: CONSOLIDADO, centros: CENTROS }]);
  const descricoes = d.linhas.map((l) => l.descricao);
  const valor = (codigo: string, k = 0) => d.series[0].valores[k].get(codigo);

  it("põe os grupos de centros logo depois do total de cada departamento, com o valor deles nele", () => {
    assert.deepEqual(descricoes, [
      "RECEITA OPERACIONAL LÍQUIDA (ROL)",
      "CUSTO DE PRODUTO VENDIDO (CPV)",
      "CUSTOS DE PRODUÇÃO (CPP)",
      "ACABAMENTO",
      "PROJETO",
      "DESPESAS TÉCNICAS (DT)",
      "PROJETO",
      "LUCRO OPERACIONAL (EBITDA)",
    ]);
    assert.equal(valor("CPP.CENTRO.ACABAMENTO"), 130);
    assert.equal(valor("CPP.CENTRO.PROJETO"), 60);
    assert.equal(valor("DT.CENTRO.PROJETO"), 80);
    assert.ok(d.centros.has("CPP.CENTRO.ACABAMENTO") && d.centros.has("DT.CENTRO.PROJETO"));
  });

  it("mostra só os centros nos departamentos: sem as atribuições e as contas, com o total do Consolidado", () => {
    // Nenhuma atribuição nem conta dos departamentos (Mão de Obra Indireta, Matérias Primas…), nem as dos centros.
    assert.ok(!d.linhas.some((l) => /^(CPP|DT)\.(MOI|MP)\./.test(l.codigo)));
    assert.deepEqual([...d.parciais], [...d.centros]);
    // O total da CPP é o do Consolidado (600); os centros somam 190 (o resto não vem deles).
    assert.equal(valor("CPP.CUSTOS_DE_PRODUCAO_CPP"), 600);
    assert.equal((valor("CPP.CENTRO.ACABAMENTO") ?? 0) + (valor("CPP.CENTRO.PROJETO") ?? 0), 190);
    // Fora dos departamentos, o Consolidado como está; no mês 2, os centros zerados.
    assert.equal(valor("EBITDA.LUCRO_OPERACIONAL_EBITDA"), 320);
    assert.equal(valor("CPP.CENTRO.ACABAMENTO", 1), 0);
    assert.equal(valor("CPP.CUSTOS_DE_PRODUCAO_CPP", 1), 100);
  });

  it("numa série sem centros (um sintético), deixa sem valor as linhas dos centros, e o resto com o Consolidado dela", () => {
    const comSintetico = montarDepartamentos(ESTRUTURA, [
      { consolidado: CONSOLIDADO, centros: CENTROS },
      { consolidado: [mapa({ "CPP.CUSTOS_DE_PRODUCAO_CPP": 700, "CPP.MOI.MAO_DE_OBRA_INDIRETA": 300, "CPP.MOI.ENCARGOS_E_BENEFICIOS": 300, "CPP.MP.MATERIAS_PRIMAS": 400, "CPP.MP.CIMENTO": 400 })], centros: null },
    ]);
    const sint = comSintetico.series[1];
    assert.ok(sint.semValor.has("CPP.CENTRO.ACABAMENTO") && sint.semValor.has("DT.CENTRO.PROJETO"));
    assert.equal(sint.valores[0].get("CPP.CUSTOS_DE_PRODUCAO_CPP"), 700);
  });

  it("dá códigos sem acentos e únicos a grupos de nomes parecidos", () => {
    const parecidos = new Map([
      ["MANUTENÇÃO (CRI)", [mapa({ "DT.MOI.REMUNERACOES_CLT": 40 })]],
      ["MANUTENCAO CRI", [mapa({ "DT.MOI.REMUNERACOES_CLT": 40 })]],
    ]);
    const x = montarDepartamentos(ESTRUTURA, [{ consolidado: [CONSOLIDADO[0]], centros: parecidos }]);
    assert.deepEqual([...x.centros], ["DT.CENTRO.MANUTENCAO_CRI", "DT.CENTRO.MANUTENCAO_CRI_2"]);
  });
});
