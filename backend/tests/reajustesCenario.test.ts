import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { aplicacaoDosReajustes, daChave, erroDosReajustes, fatoresDasContas, fatoresDoIndice, fatorNaUnidade, indicesDaLinha, usosDosIndices } from "../src/services/cenarios/reajustesCenario.js";

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

  it("dois índices na conta (19/11/2026): o 1º e depois o 2º, sobre o valor já reajustado", () => {
    const indicesDosReajustes = [
      { chave: "r1", descricao: "IPCA", observacao: null, reajustes: [{ valor: 4, mes: 1 }] },
      { chave: "r2", descricao: "Dissídio", observacao: null, reajustes: [{ valor: 10, mes: 5 }] },
    ];
    const fatores = fatoresDasContas({ indicesDosReajustes, aplicacaoDosReajustes: { "DA.GGI.ALUGUEIS": ["r1", "r2"], "DA.GGI.VIAGENS": ["r2", null] } });
    // 100 com +4% desde janeiro e +10% desde maio: 104 de janeiro a abril e 114,40 de maio em diante.
    perto(100 * fatores.get("DA.GGI.ALUGUEIS")![0], 104);
    perto(100 * fatores.get("DA.GGI.ALUGUEIS")![4], 114.4);
    assert.equal(fatores.get("DA.GGI.VIAGENS")![3], 1);
    perto(fatores.get("DA.GGI.VIAGENS")![4], 1.1);
  });

  it("lê a aplicação de antes (um índice por conta) como o 1º, e conta os usos dos dois", () => {
    const a = aplicacaoDosReajustes({ aplicacaoDosReajustes: { X: "r1", Y: ["r2", "r1"], Z: [null, "r3"], W: [] } });
    assert.deepEqual(a, { X: ["r1", null], Y: ["r2", "r1"], Z: ["r3", null] });
    assert.deepEqual(Object.fromEntries(usosDosIndices(a)), { r1: 2, r2: 1, r3: 1 });
  });

  it("os Custos de Produção por unidade (19/11/2026): a Matriz e a Filial com os seus índices", () => {
    const indicesDosReajustes = [
      { chave: "r1", descricao: "IPCA", observacao: null, reajustes: [{ valor: 4, mes: 1 }] },
      { chave: "r2", descricao: "Dissídio", observacao: null, reajustes: [{ valor: 10, mes: 1 }] },
    ];
    const conta = "CPP.MOD.REMUNERACOES_CLT";
    const fatores = fatoresDasContas({ indicesDosReajustes, aplicacaoDosReajustes: { [`1|${conta}`]: ["r1", null], [`2|${conta}`]: ["r2", null], "DA.GGI.ALUGUEIS": ["r1", null] } });
    perto(fatorNaUnidade(fatores, conta, 1)![0], 1.04);
    perto(fatorNaUnidade(fatores, conta, 2)![0], 1.1);
    perto(fatorNaUnidade(fatores, "DA.GGI.ALUGUEIS", 4)![0], 1.04);
    assert.deepEqual(daChave(`2|${conta}`), { codigo: conta, unidade: 2 });
    assert.deepEqual(daChave(conta), { codigo: conta, unidade: null });
    // A gravação de antes (a conta sem unidade) vale para as duas.
    const antiga = aplicacaoDosReajustes({ aplicacaoDosReajustes: { [conta]: "r1" } });
    assert.deepEqual(indicesDaLinha(antiga, `1|${conta}`), ["r1", null]);
    assert.deepEqual(indicesDaLinha(antiga, `2|${conta}`), ["r1", null]);
    perto(fatorNaUnidade(fatoresDasContas({ indicesDosReajustes, aplicacaoDosReajustes: { [conta]: "r1" } }), conta, 2)![0], 1.04);
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
