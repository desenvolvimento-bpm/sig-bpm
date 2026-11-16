import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizarCentrosCusto } from "../src/services/totvs/centrosCustoSync.js";

const XML = `<NewDataSet>
  <Resultado>
    <CODCOLIGADA>1</CODCOLIGADA>
    <CODCCUSTO>01.001</CODCCUSTO>
    <NOME>ADMINISTRATIVO &amp; FINANCEIRO</NOME>
    <ATIVO>1</ATIVO>
    <RECCREATEDON>2023-05-10T14:22:11</RECCREATEDON>
    <RECMODIFIEDON>2025-01-03 09:00:00.000</RECMODIFIEDON>
    <RESPONSAVEL>123</RESPONSAVEL>
    <NOME_RESPONSAVEL>MARIA SILVA</NOME_RESPONSAVEL>
    <EMAIL>maria@bpm.com.br</EMAIL>
  </Resultado>
  <Resultado>
    <CODCOLIGADA>1</CODCOLIGADA>
    <CODCCUSTO>  02.002  </CODCCUSTO>
    <NOME/>
    <ATIVO>0</ATIVO>
    <RECCREATEDON/>
    <RECMODIFIEDON>nao-e-data</RECMODIFIEDON>
    <RESPONSAVEL/>
    <NOME_RESPONSAVEL/>
    <EMAIL/>
  </Resultado>
  <Resultado>
    <CODCCUSTO/>
    <NOME>SEM CÓDIGO</NOME>
    <ATIVO>1</ATIVO>
  </Resultado>
</NewDataSet>`;

describe("normalização dos centros de custo", () => {
  it("normaliza nome, datas, responsável e e-mail; descarta a linha sem código", async () => {
    const linhas = await normalizarCentrosCusto(XML, 1);
    assert.equal(linhas.length, 2);
    assert.equal(linhas[0].codccusto, "01.001");
    assert.equal(linhas[0].nome, "ADMINISTRATIVO & FINANCEIRO");
    assert.equal(linhas[0].ativo, 1);
    assert.equal(linhas[0].reccreatedon?.toISOString(), new Date("2023-05-10T14:22:11").toISOString());
    assert.ok(linhas[0].recmodifiedon instanceof Date);
    assert.equal(linhas[0].responsavel, "123");
    assert.equal(linhas[0].nomeResponsavel, "MARIA SILVA");
    assert.equal(linhas[0].emailResponsavel, "maria@bpm.com.br");
  });

  it("código com espaço é aparado; vazio vira nulo; data inválida vira nulo", async () => {
    const [, l] = await normalizarCentrosCusto(XML, 1);
    assert.equal(l.codccusto, "02.002");
    assert.equal(l.nome, null);
    assert.equal(l.ativo, 0);
    assert.equal(l.reccreatedon, null);
    assert.equal(l.recmodifiedon, null);
    assert.equal(l.responsavel, null);
    assert.equal(l.emailResponsavel, null);
  });

  it("sem linhas devolve lista vazia", async () => {
    assert.deepEqual(await normalizarCentrosCusto("<NewDataSet/>", 1), []);
  });
});
