import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { redistribuirMovimentos, type RegraDoCenario } from "../src/services/cenarios/redistribuicoesDoCenario.js";

/**
 * Uma regra do cenário: a conta L1, o fornecedor ACME, de 03/2026 em diante, 60% no centro k1 (na conta CPP.GGD.X) e 40% no k2 (na
 * DA.GGI.X), os da cópia.
 */
const regra = (extra: Partial<RegraDoCenario> = {}): RegraDoCenario => ({
  id: "r1",
  linhasDRE: new Set(["L1"]),
  departamento: null,
  fornecedores: new Set(["ACME LTDA"]),
  inicio: new Date(Date.UTC(2026, 2, 1)),
  fim: null,
  destinos: [
    { centro: { id: "k1", codigoRM: "1.01", nomeRM: "Um" }, percentual: 0.6, linha: { codigo: "CPP.GGD.X", tipo: "ITEM" } },
    { centro: { id: "k2", codigoRM: "1.02", nomeRM: "Dois" }, percentual: 0.4, linha: { codigo: "DA.GGI.X", tipo: "ITEM" } },
  ],
  ...extra,
});
const mov = (extra: Partial<{ linhaDREId: string; grupoSigla: string; filial: number; cliForn: string | null; valorMovimento: number; mes: number }> = {}) => ({
  linhaDREId: "L1",
  grupoSigla: "CPP",
  filial: 1,
  cliForn: " acme ltda ",
  valorMovimento: 100.01,
  mes: 4,
  ...extra,
});
const doMes = (m: { mes: number }) => new Date(Date.UTC(2026, m.mes - 1, 1));

describe("as Redistribuições de Gastos do cenário na referência (20/11/2026, Cadastros por cenário, etapa 2)", () => {
  it("divide o movimento da conta e do fornecedor (sem caixa e sem espaços nas pontas) pelos percentuais, em centavos", () => {
    const { mantidos, redistribuidos } = redistribuirMovimentos([mov()], [regra()], doMes);
    assert.equal(mantidos.length, 0);
    assert.deepEqual(
      redistribuidos[0].partes.map((p) => [p.centro.id, p.valor]),
      [
        ["k1", 60.01],
        ["k2", 40],
      ],
    );
  });

  it("cada parte leva a conta da DRE do destino (23/11/2026); sem ela, a parte fica na conta do movimento", () => {
    const { redistribuidos } = redistribuirMovimentos([mov()], [regra()], doMes);
    assert.deepEqual(
      redistribuidos[0].partes.map((p) => [p.centro.id, p.linha?.codigo]),
      [
        ["k1", "CPP.GGD.X"],
        ["k2", "DA.GGI.X"],
      ],
    );
    const semConta = regra({ destinos: [{ centro: { id: "k1", codigoRM: "1.01", nomeRM: "Um" }, percentual: 1, linha: null }] });
    assert.equal(redistribuirMovimentos([mov()], [semConta], doMes).redistribuidos[0].partes[0].linha, null);
  });

  it("mantém o que não casa: outra conta, outro fornecedor, sem fornecedor ou fora da vigência", () => {
    const fora = [mov({ linhaDREId: "L2" }), mov({ cliForn: "OUTRO" }), mov({ cliForn: null }), mov({ mes: 2 })];
    const { mantidos, redistribuidos } = redistribuirMovimentos(fora, [regra({ fim: new Date(Date.UTC(2026, 9, 1)) })], doMes);
    assert.equal(redistribuidos.length, 0);
    assert.equal(mantidos.length, 4);
    assert.equal(redistribuirMovimentos([mov({ mes: 11 })], [regra({ fim: new Date(Date.UTC(2026, 9, 1)) })], doMes).mantidos.length, 1);
  });

  it("o departamento da regra: o grupo da DRE da conta e, na Produção, a filial da unidade", () => {
    const daMatriz = regra({ departamento: { grupos: new Set(["CPP"]), filial: 1 } });
    assert.equal(redistribuirMovimentos([mov({ filial: 2 })], [daMatriz], doMes).mantidos.length, 1);
    assert.equal(redistribuirMovimentos([mov({ grupoSigla: "DA" })], [daMatriz], doMes).mantidos.length, 1);
    assert.equal(redistribuirMovimentos([mov()], [daMatriz], doMes).redistribuidos.length, 1);
  });

  it("com várias contas da DRE, divide o movimento de qualquer delas (20/11/2026)", () => {
    const varias = regra({ linhasDRE: new Set(["L1", "L2"]) });
    const r = redistribuirMovimentos([mov(), mov({ linhaDREId: "L2" }), mov({ linhaDREId: "L3" })], [varias], doMes);
    assert.equal(r.redistribuidos.length, 2);
    assert.equal(r.mantidos.length, 1);
  });

  it("sem regras, nada muda", () => {
    const ms = [mov(), mov({ cliForn: "OUTRO" })];
    const r = redistribuirMovimentos(ms, [], doMes);
    assert.deepEqual(r.mantidos, ms);
    assert.equal(r.redistribuidos.length, 0);
  });
});
