import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizarTiposMovimento } from "../src/services/totvs/tiposMovimentoSync.js";

const XML = `<NewDataSet>
  <Resultado>
    <CODTMV>1.1.04</CODTMV>
    <NOME>SOLICITAÇÃO &amp; COMPRA</NOME>
    <CLASSIFICACAO>E</CLASSIFICACAO>
    <COLUNA_NOVA>x</COLUNA_NOVA>
  </Resultado>
  <Resultado>
    <CODTMV>  1.2.18  </CODTMV>
    <NOME/>
    <CLASSIFICACAO/>
  </Resultado>
  <Resultado>
    <CODTMV/>
    <NOME>SEM CÓDIGO</NOME>
  </Resultado>
</NewDataSet>`;

describe("normalização dos tipos de movimento", () => {
  it("lê código, nome e classificação, e ignora a coluna extra", async () => {
    const [t] = await normalizarTiposMovimento(XML, 1);
    assert.deepEqual(t, { codcoligada: 1, codtmv: "1.1.04", nome: "SOLICITAÇÃO & COMPRA", classificacao: "E" });
  });

  it("código com espaço é aparado; vazio vira nulo; sem código a linha é descartada", async () => {
    const linhas = await normalizarTiposMovimento(XML, 1);
    assert.equal(linhas.length, 2);
    assert.equal(linhas[1].codtmv, "1.2.18");
    assert.equal(linhas[1].nome, null);
    assert.equal(linhas[1].classificacao, null);
  });

  it("sem linhas devolve lista vazia", async () => {
    assert.deepEqual(await normalizarTiposMovimento("<NewDataSet/>", 1), []);
  });
});
