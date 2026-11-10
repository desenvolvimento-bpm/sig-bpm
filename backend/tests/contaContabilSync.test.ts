import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizarContasContabeis } from "../src/services/totvs/contaContabilSync.js";

const XML = `<NewDataSet>
  <Resultado>
    <CODCOLIGADA>1</CODCOLIGADA>
    <REDUZIDO>1001</REDUZIDO>
    <CODCONTA>3.02.01.03.01.01</CODCONTA>
    <DESCRICAO>RECEITA BRUTA &amp; SERVIÇOS</DESCRICAO>
  </Resultado>
  <Resultado>
    <CODCOLIGADA>1</CODCOLIGADA>
    <REDUZIDO/>
    <CODCONTA>  3.02.01.03.01.02  </CODCONTA>
    <DESCRICAO/>
  </Resultado>
  <Resultado>
    <CODCOLIGADA>1</CODCOLIGADA>
    <REDUZIDO>1003</REDUZIDO>
    <CODCONTA/>
    <DESCRICAO>SEM CÓDIGO</DESCRICAO>
  </Resultado>
</NewDataSet>`;

describe("normalização das contas contábeis", () => {
  it("normaliza código, reduzido e descrição; descarta a linha sem código", async () => {
    const linhas = await normalizarContasContabeis(XML, 1);
    assert.equal(linhas.length, 2);
    assert.deepEqual(linhas[0], {
      codcoligada: 1,
      codconta: "3.02.01.03.01.01",
      reduzido: "1001",
      descricao: "RECEITA BRUTA & SERVIÇOS",
    });
  });

  it("código com espaço é aparado; vazio vira nulo", async () => {
    const [, l] = await normalizarContasContabeis(XML, 1);
    assert.equal(l.codconta, "3.02.01.03.01.02");
    assert.equal(l.reduzido, null);
    assert.equal(l.descricao, null);
  });

  it("sem linhas devolve lista vazia", async () => {
    assert.deepEqual(await normalizarContasContabeis("<NewDataSet/>", 1), []);
  });
});
