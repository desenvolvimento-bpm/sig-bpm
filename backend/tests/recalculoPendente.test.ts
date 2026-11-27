import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pendenciasDoRecalculo } from "../src/services/cenarios/premissasCenario.js";

const cenario = (extra: Partial<Parameters<typeof pendenciasDoRecalculo>[0]> = {}) => ({
  recalculoConfiguracoes: 0,
  recalculoPremissas: 0,
  recalculoReajustes: 0,
  reajustesAplicados: false,
  reajustesCalculados: false,
  ...extra,
});

describe("as alterações pendentes de recálculo (21/11/2026)", () => {
  it("somam as das telas", () => {
    assert.deepEqual(pendenciasDoRecalculo(cenario({ recalculoConfiguracoes: 2, recalculoPremissas: 5 })), { configuracoes: 2, premissas: 5, reajustes: 0, total: 7 });
  });
  it("a caixa Aplicar ao Recalcular diferente do último cálculo conta como um Reajuste; igual, não", () => {
    assert.equal(pendenciasDoRecalculo(cenario({ reajustesAplicados: true })).reajustes, 1);
    assert.equal(pendenciasDoRecalculo(cenario({ reajustesCalculados: true })).reajustes, 1);
    assert.equal(pendenciasDoRecalculo(cenario({ reajustesAplicados: true, reajustesCalculados: true })).reajustes, 0);
    assert.deepEqual(pendenciasDoRecalculo(cenario({ recalculoReajustes: 2, reajustesAplicados: true })), { configuracoes: 0, premissas: 0, reajustes: 3, total: 3 });
  });
});
