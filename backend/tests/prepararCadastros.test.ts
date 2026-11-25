import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { prepararCadastros } from "../src/services/cadastros/carga/prepararCadastros.js";

const dre = (linhaPlanilha: number, descricao: string, formula: string | null, grupo: string | null, grupoSigla: string | null, atribuicao: string | null = null) => ({
  linhaPlanilha, descricao, formula, grupo, grupoSigla, atribuicao, atribuicaoSigla: null, definicao: null,
});

describe("prepararCadastros", () => {
  const p = prepararCadastros({
    centros: [
      { COLIGADA: "1", "CÓDIGO RM": "1.01.00000004", "CENTRO DE CUSTO (RM)": "CONTROLADORIA", "CENTRO DE CUSTO (CONTROLADORIA)": null, DEPARTAMENTO: null, "DEP.": null, "ATRIBUIÇÃO": null, "ATR.": null, RATEIO: null },
      { COLIGADA: "1", "CÓDIGO RM": "1.15.00000004", "CENTRO DE CUSTO (RM)": "FATURAMENTO (FOR)", "CENTRO DE CUSTO (CONTROLADORIA)": "-", DEPARTAMENTO: "DESPESAS ADMINISTRATIVAS (DA)", "DEP.": "DA", "ATRIBUIÇÃO": "Indireta", "ATR.": "IND", RATEIO: "DESPESAS" },
    ],
    contas: [
      { CD_REDUZIDO: "2683", CONTA: "3.01", DESCRICAO: "FATURAMENTO", TIPO_CONTA: "ANALITICA", DEPARTAMENTO: "RECEITA OPERACIONAL BRUTA (ROB)", "DEP.": "ROB", "ATRIBUIÇÃO": "Receita Bruta de Montagem", "ATR.": "RBM", "CONTA DRE": "Receita Bruta de Montagem", RATEIO: "OBRAS" },
      { CD_REDUZIDO: "999", CONTA: "3.99", DESCRICAO: "SEM LINHA", TIPO_CONTA: "ANALITICA", DEPARTAMENTO: "X", "DEP.": "X", "ATRIBUIÇÃO": "Y", "ATR.": "Y", "CONTA DRE": "Z", RATEIO: "PRODUÇÃO" },
    ],
    dre: [
      dre(1, "REALIZADO", "UPPER(...)", "DEPARTAMENTO", "DEP."),
      dre(2, "RECEITA OPERACIONAL BRUTA (ROB)", "SUM(B3:B4)", "-", "ROB"),
      dre(3, "Receita Bruta de Montagem", "'Realizado (Serviços)'!B9", "RECEITA OPERACIONAL BRUTA (ROB)", "ROB", "Receita Bruta de Montagem"),
      dre(4, "Receita Bruta Complementar", "'Realizado (Serviços)'!B10+'Realizado (Matriz)'!B10", "RECEITA OPERACIONAL BRUTA (ROB)", "ROB", "Receita Bruta Complementar"),
      dre(5, "RESULTADO", "B2*2", "-", "RES"),
    ],
  });

  it("aplica os descartes acordados e normaliza atribuição e rateio", () => {
    assert.deepEqual(p.centros.alvos.map((c) => c.codigoRM), ["1.15.00000004"]);
    assert.equal(p.centros.descartados, 1);
    const f = p.centros.alvos[0].dados;
    assert.equal(f.atribuicao, "INDIRETA");
    assert.equal(f.balde, "DESPESAS");
    assert.equal(f.nomeControladoria, null);
    assert.equal(p.contas.alvos[1].dados.balde, "PRODUCAO");
  });

  it("classifica as linhas, resolve subtotal e total por código e herda as unidades", () => {
    const [rob, montagem, complementar, resultado] = p.dre.linhas;
    assert.equal(rob.dados.tipo, "SUBTOTAL");
    assert.equal(rob.dados.expressao, `${montagem.codigo} + ${complementar.codigo}`);
    assert.deepEqual(rob.unidades, [1, 3]);
    assert.equal(montagem.dados.tipo, "ITEM");
    assert.equal(resultado.dados.tipo, "TOTAL");
    assert.equal(resultado.dados.expressao, `${rob.codigo}*2`);
  });

  it("liga a conta à linha pela tripla departamento, atribuição e conta DRE", () => {
    assert.equal(p.vinculos.get("2683"), p.dre.linhas[1].codigo);
    assert.equal(p.vinculos.get("999"), null);
    assert.deepEqual(p.semDestino, ["999 → X|Y|Z"]);
  });
});
