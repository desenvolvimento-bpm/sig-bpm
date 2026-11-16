import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "../src/generated/prisma/client.js";
import { departamentoDaLinha } from "../src/services/acesso/recorteDepartamento.js";
import { agruparParaLancamentos, centroForaDaContestacao, contaCabeNoCentro } from "../src/services/contestacoes/contestacoesService.js";

describe("Contestações de Gastos: a conta no departamento do centro (30/10/2026)", () => {
  const conta = (grupoSigla: string, descricao = "X") => departamentoDaLinha({ grupoSigla, descricao });

  it("aceita as contas do departamento do centro e as do Extra-Operacional", () => {
    assert.equal(contaCabeNoCentro("PRODUCAO", conta("CPP")), true);
    assert.equal(contaCabeNoCentro("PRODUCAO", conta("DFC")), true);
    assert.equal(contaCabeNoCentro("PRODUCAO", conta("DML")), true);
    assert.equal(contaCabeNoCentro("SERVICOS", conta("CSC")), true);
    assert.equal(contaCabeNoCentro("LOGISTICA", conta("DVV", "FRETE E DESCARGA")), true);
  });

  it("recusa as de outro departamento e as sem departamento (receitas e impostos)", () => {
    assert.equal(contaCabeNoCentro("PRODUCAO", conta("DA")), false);
    assert.equal(contaCabeNoCentro("ADMINISTRATIVO", conta("CPP")), false);
    assert.equal(contaCabeNoCentro("COMERCIAL", conta("DVV", "FRETE E DESCARGA")), false);
    assert.equal(contaCabeNoCentro("PRODUCAO", conta("ROB")), false);
  });

  it("o centro sem departamento (o do movimento, quando só a conta muda) aceita todas", () => {
    assert.equal(contaCabeNoCentro(null, conta("DA")), true);
    assert.equal(contaCabeNoCentro(null, conta("ROB")), true);
  });

  it("o centro novo só com o código de três níveis: sem os genéricos, os sem código e os de código mais longo (04/11/2026)", () => {
    assert.equal(centroForaDaContestacao("1.01.00000001"), null);
    assert.equal(centroForaDaContestacao(" 1.98.00878202 "), null);
    assert.equal(centroForaDaContestacao("1.01"), "é genérico");
    assert.equal(centroForaDaContestacao("1.16"), "é genérico");
    assert.equal(centroForaDaContestacao(null), "não tem código no cadastro");
    assert.equal(centroForaDaContestacao("  "), "não tem código no cadastro");
    assert.match(centroForaDaContestacao("1.11.00000006.1") ?? "", /fora do padrão/);
  });
});

describe("Contestações de Gastos: os lançamentos das anteriores e posteriores (30/10/2026)", () => {
  const m = (filial: number, centro: string | null, conta: string, valor: string, ano: number, mes: number) => ({
    filial,
    centroAntesId: centro,
    contaAntesId: conta,
    valor: new Prisma.Decimal(valor),
    competencia: { id: `${ano}-${mes}`, ano, mes },
  });

  it("soma os movimentos pela competência, pela filial, pelo centro e pela conta de antes, na ordem das competências", () => {
    const grupos = agruparParaLancamentos([
      m(1, "c1", "k1", "200.20", 2026, 2),
      m(1, "c1", "k1", "100.10", 2026, 1),
      m(1, "c1", "k1", "50", 2026, 2),
      m(2, "c1", "k1", "10", 2026, 3),
      m(1, null, "k1", "5", 2026, 3),
      m(1, "c1", "k1", "1", 2025, 12),
    ]);
    assert.deepEqual(
      grupos.map((g) => [g.competencia.id, g.filial, g.centroAntesId, g.valor.toFixed(2), g.movimentos]),
      [
        ["2025-12", 1, "c1", "1.00", 1],
        ["2026-1", 1, "c1", "100.10", 1],
        ["2026-2", 1, "c1", "250.20", 2],
        ["2026-3", 2, "c1", "10.00", 1],
        ["2026-3", 1, null, "5.00", 1],
      ],
    );
  });

  it("na contestação de itens (10/11/2026), soma os itens: o valor deles e quantos (a descrição dos lançamentos)", () => {
    const grupos = agruparParaLancamentos([{ ...m(1, "c1", "k1", "7.51", 2026, 9), itens: 2 }]);
    assert.deepEqual(
      grupos.map((g) => [g.competencia.id, g.valor.toFixed(2), g.movimentos, g.itens]),
      [["2026-9", "7.51", 1, 2]],
    );
    // A do movimento inteiro: sem itens.
    assert.equal(agruparParaLancamentos([m(1, "c1", "k1", "512.82", 2026, 9)])[0].itens, 0);
  });
});
