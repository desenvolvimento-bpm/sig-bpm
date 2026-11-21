import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  aplicacaoDosReajustes,
  daChave,
  erroDosReajustes,
  fatoresDasContas,
  fatoresDoIndice,
  fatorNaUnidade,
  fatorNaVenda,
  indicesDaLinha,
  reajustarPorVenda,
  usosDosIndices,
} from "../src/services/cenarios/reajustesCenario.js";

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
    assert.deepEqual(daChave(`2|${conta}`), { codigo: conta, unidade: 2, venda: null });
    assert.deepEqual(daChave(conta), { codigo: conta, unidade: null, venda: null });
    // A gravação de antes (a conta sem unidade) vale para as duas.
    const antiga = aplicacaoDosReajustes({ aplicacaoDosReajustes: { [conta]: "r1" } });
    assert.deepEqual(indicesDaLinha(antiga, `1|${conta}`), ["r1", null]);
    assert.deepEqual(indicesDaLinha(antiga, `2|${conta}`), ["r1", null]);
    perto(fatorNaUnidade(fatoresDasContas({ indicesDosReajustes, aplicacaoDosReajustes: { [conta]: "r1" } }), conta, 2)![0], 1.04);
  });

  it("os Custos de Produção por unidade e venda (21/11/2026): Global e Mercantil com os seus índices, herdando os da unidade", () => {
    const indicesDosReajustes = [
      { chave: "g", descricao: "Global", observacao: null, reajustes: [{ valor: 10, mes: 1 }] },
      { chave: "m", descricao: "Mercantil", observacao: null, reajustes: [{ valor: 5, mes: 7 }] },
      { chave: "u", descricao: "Unidade", observacao: null, reajustes: [{ valor: 2, mes: 1 }] },
    ];
    const conta = "CPP.MP.CIMENTO";
    assert.deepEqual(daChave(`1|GLOBAL|${conta}`), { codigo: conta, unidade: 1, venda: "GLOBAL" });
    assert.deepEqual(daChave(`2|MERCANTIL|${conta}`), { codigo: conta, unidade: 2, venda: "MERCANTIL" });
    const aplicacao = { [`1|GLOBAL|${conta}`]: ["g", null], [`1|MERCANTIL|${conta}`]: ["m", null], [`2|${conta}`]: ["u", null] };
    const fatores = fatoresDasContas({ indicesDosReajustes, aplicacaoDosReajustes: aplicacao });
    perto(fatorNaVenda(fatores, conta, 1, "GLOBAL")![0], 1.1);
    assert.equal(fatorNaVenda(fatores, conta, 1, "MERCANTIL")![0], 1);
    perto(fatorNaVenda(fatores, conta, 1, "MERCANTIL")![6], 1.05);
    // A Filial, gravada por unidade (19/11/2026), vale nas duas vendas.
    perto(fatorNaVenda(fatores, conta, 2, "GLOBAL")![0], 1.02);
    perto(fatorNaVenda(fatores, conta, 2, "MERCANTIL")![0], 1.02);
    const lidas = aplicacaoDosReajustes({ aplicacaoDosReajustes: aplicacao });
    assert.deepEqual(indicesDaLinha(lidas, `2|GLOBAL|${conta}`), ["u", null]);
    assert.deepEqual(indicesDaLinha(lidas, `1|MERCANTIL|${conta}`), ["m", null]);
  });

  it("reajusta por venda: as premissas de cada venda e o resto (centros, depreciação) pelo volume dela", () => {
    // Total 1000: Global 600 e Mercantil 100 das premissas, 300 dos centros; volume Global 75 e Mercantil 25.
    const vendas = (fg: number, fm: number) => [
      { venda: "GLOBAL", premissas: [600], volume: [75], fator: [fg] },
      { venda: "MERCANTIL", premissas: [100], volume: [25], fator: [fm] },
    ];
    // Só a Global (+10%): (600 + 300 × 0,75) × 1,1 + (100 + 300 × 0,25) = 907,5 + 175.
    perto(reajustarPorVenda([1000], vendas(1.1, 1))[0], 907.5 + 175);
    // Só a Mercantil (+20%): 825 + 175 × 1,2.
    perto(reajustarPorVenda([1000], vendas(1, 1.2))[0], 825 + 210);
    // O mesmo índice nas duas: o total × o fator, como antes.
    perto(reajustarPorVenda([1000], vendas(1.05, 1.05))[0], 1050);
    // Sem volume no mês, o resto fica na Global; sem fator, a venda não muda.
    perto(reajustarPorVenda([1000], [{ venda: "GLOBAL", premissas: [600], volume: [0], fator: [1.1] }, { venda: "MERCANTIL", premissas: [100], volume: [0], fator: undefined }])[0], 900 * 1.1 + 100);
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
