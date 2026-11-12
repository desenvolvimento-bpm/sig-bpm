import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { erroDosReajustes, fatoresDasContas, fatoresDoIndice } from "../src/services/cenarios/reajustesCenario.js";

const perto = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-12, `${a} ≠ ${b}`);

describe("Reajustes das Premissas dos analíticos (11/11/2026)", () => {
  it("cada reajuste vale do mês dele em diante, sobre os anteriores (o exemplo do Adão: 4%, 2%, 5% e 1%)", () => {
    const f = fatoresDoIndice([
      { valor: 4, mes: 1 },
      { valor: 2, mes: 4 },
      { valor: 5, mes: 7 },
      { valor: 1, mes: 10 },
    ]);
    for (const m of [0, 1, 2]) perto(f[m], 1.04);
    for (const m of [3, 4, 5]) perto(f[m], 1.04 * 1.02);
    for (const m of [6, 7, 8]) perto(f[m], 1.04 * 1.02 * 1.05);
    for (const m of [9, 10, 11]) perto(f[m], 1.04 * 1.02 * 1.05 * 1.01);
    // Remover Reajustes: o valor reajustado ÷ o fator do mês volta ao original.
    const original = 1000;
    for (const x of f) perto((original * x) / x, original);
  });

  it("antes do primeiro reajuste, o fator é 1", () => {
    const f = fatoresDoIndice([{ valor: 10, mes: 6 }]);
    assert.deepEqual(f.slice(0, 5), [1, 1, 1, 1, 1]);
    for (const x of f.slice(5)) perto(x, 1.1);
  });

  it("só entram as contas com um índice que muda algum mês", () => {
    const fatores = fatoresDasContas({
      indicesDosReajustes: [
        { chave: "r1", descricao: "IPCA", observacao: null, reajustes: [{ valor: 5, mes: 3 }] },
        { chave: "r2", descricao: "Zero", observacao: null, reajustes: [{ valor: 0, mes: 1 }] },
      ],
      aplicacaoDosReajustes: { "CPP.MOD.REMUNERACOES_CLT": "r1", "CPP.MOD.HORAS_EXTRAS": "r2", "CPP.MOI.REMUNERACOES_CLT": "r9" },
    });
    assert.deepEqual([...fatores.keys()], ["CPP.MOD.REMUNERACOES_CLT"]);
    assert.equal(fatores.get("CPP.MOD.REMUNERACOES_CLT")![1], 1);
    perto(fatores.get("CPP.MOD.REMUNERACOES_CLT")![2], 1.05);
  });

  it("confere os reajustes: de 1 a 4, acima de −100% e em meses crescentes", () => {
    assert.equal(erroDosReajustes("IPCA", [{ valor: 4, mes: 1 }, { valor: -2, mes: 4 }]), null);
    assert.match(erroDosReajustes("IPCA", []) ?? "", /ao menos um reajuste/);
    assert.match(erroDosReajustes("IPCA", [{ valor: -100, mes: 1 }]) ?? "", /acima de −100/);
    assert.match(erroDosReajustes("IPCA", [{ valor: 4, mes: 13 }]) ?? "", /Inicia Em inválido/);
    assert.match(erroDosReajustes("IPCA", [{ valor: 4, mes: 4 }, { valor: 2, mes: 4 }]) ?? "", /meses crescentes/);
    assert.match(erroDosReajustes("IPCA", Array.from({ length: 5 }, (_, k) => ({ valor: 1, mes: k + 1 }))) ?? "", /mais de 4/);
  });
});
