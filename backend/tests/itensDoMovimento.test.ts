import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { chaveDoMovimento, documentoDoMovimento } from "../src/services/dre/itensDoMovimento.js";

/** Os documentos de um movimento pela data (19/11/2026, pedido do Adão): o mesmo ID em outra origem não traz itens. */
describe("os itens do movimento pela data do documento (19/11/2026)", () => {
  const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  const folha = { idMovimento: "46872", emissao: dia("2026-06-30"), ano: 2026, mes: 6 };

  it("a nota de outro mês com o mesmo número não é do movimento da folha", () => {
    // A Nota Fiscal 1391 (Trust Tools), emitida em 30/01/2026 e importada em 02/2026.
    assert.equal(documentoDoMovimento(folha, [dia("2026-01-30"), null], { ano: 2026, mes: 2 }), false);
  });

  it("o documento até 10 dias da emissão do movimento é dele", () => {
    const compra = { idMovimento: "31573", emissao: dia("2026-02-03"), ano: 2026, mes: 2 };
    assert.equal(documentoDoMovimento(compra, [dia("2026-01-29")], { ano: 2026, mes: 1 }), true);
    assert.equal(documentoDoMovimento(compra, [dia("2026-02-13")], { ano: 2026, mes: 2 }), true);
    assert.equal(documentoDoMovimento(compra, [dia("2026-02-14")], { ano: 2026, mes: 2 }), false);
    // A nota com a emissão longe e a saída perto.
    assert.equal(documentoDoMovimento(compra, [dia("2025-12-01"), dia("2026-02-01")], { ano: 2026, mes: 2 }), true);
  });

  it("sem a emissão do movimento, o mês dele; sem a data do documento, o mês em que veio", () => {
    const semEmissao = { idMovimento: "1", emissao: null, ano: 2026, mes: 6 };
    assert.equal(documentoDoMovimento(semEmissao, [dia("2026-06-15")], { ano: 2026, mes: 6 }), true);
    assert.equal(documentoDoMovimento(semEmissao, [dia("2026-07-08")], { ano: 2026, mes: 7 }), true);
    assert.equal(documentoDoMovimento(semEmissao, [dia("2026-08-01")], { ano: 2026, mes: 8 }), false);
    assert.equal(documentoDoMovimento(folha, [null], { ano: 2026, mes: 6 }), true);
    assert.equal(documentoDoMovimento(folha, [null], { ano: 2026, mes: 2 }), false);
  });

  it("a chave do movimento junta o ID, a emissão e a competência", () => {
    assert.equal(chaveDoMovimento(folha), "46872|2026-06-30|2026-6");
  });
});
