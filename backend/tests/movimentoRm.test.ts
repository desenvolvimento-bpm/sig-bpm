import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extrairResultadoSoap } from "../src/services/totvs/consultaSql.js";
import {
  extrairCabecalhoMovimento,
  formatarDataEmissao,
  montarEnvelopeReadRecord,
} from "../src/services/totvs/movimentoRm.js";

describe("ReadRecord do movimento", () => {
  it("monta o envelope com o DataServer, a chave CODCOLIGADA;IDMOV e o contexto", () => {
    const xml = montarEnvelopeReadRecord("MovMovimentoTBCData", "1;95904", "CODCOLIGADA=1");
    assert.match(xml, /<tot:DataServerName>MovMovimentoTBCData<\/tot:DataServerName>/);
    assert.match(xml, /<tot:PrimaryKey>1;95904<\/tot:PrimaryKey>/);
    assert.match(xml, /<tot:Contexto>CODCOLIGADA=1<\/tot:Contexto>/);
  });

  it("tira o ReadRecordResult escapado da resposta", () => {
    const resposta = `<s:Envelope><s:Body><ReadRecordResponse xmlns="http://www.totvs.com/"><ReadRecordResult>&lt;NewDataSet&gt;&lt;TMOV&gt;&lt;IDMOV&gt;95904&lt;/IDMOV&gt;&lt;/TMOV&gt;&lt;/NewDataSet&gt;</ReadRecordResult></ReadRecordResponse></s:Body></s:Envelope>`;
    assert.equal(
      extrairResultadoSoap(resposta, "ReadRecordResult"),
      "<NewDataSet><TMOV><IDMOV>95904</IDMOV></TMOV></NewDataSet>",
    );
  });

  it("uma falha SOAP vira erro com a mensagem do RM", () => {
    const falha = `<s:Envelope><s:Body><s:Fault><faultstring>Registro não encontrado</faultstring></s:Fault></s:Body></s:Envelope>`;
    assert.throws(() => extrairResultadoSoap(falha, "ReadRecordResult"), /Registro não encontrado/);
  });
});

describe("cabeçalho do movimento", () => {
  const XML = `<NewDataSet>
    <TMOV>
      <IDMOV>95904</IDMOV>
      <CODFILIAL>1</CODFILIAL>
      <CODCFO>0001873</CODCFO>
      <NUMEROMOV>000004146</NUMEROMOV>
      <CODTMV>1.2.01</CODTMV>
      <DATAEMISSAO>2026-06-01T00:00:00</DATAEMISSAO>
      <CAMPO_DOS_ITENS>ignorado</CAMPO_DOS_ITENS>
    </TMOV>
  </NewDataSet>`;

  it("lê o cabeçalho e formata a emissão em DD/MM/AAAA", async () => {
    const cabecalho = await extrairCabecalhoMovimento(XML);
    assert.deepEqual(cabecalho, {
      idmov: 95904,
      codfilial: 1,
      codcfo: "0001873",
      numeromov: "000004146",
      codtmv: "1.2.01",
      dataemissao: "01/06/2026",
    });
  });

  it("sem TMOV devolve null", async () => {
    assert.equal(await extrairCabecalhoMovimento("<NewDataSet/>"), null);
  });

  it("formata a data nos dois formatos e recusa o que não é data", () => {
    assert.equal(formatarDataEmissao("2026-06-01T00:00:00"), "01/06/2026");
    assert.equal(formatarDataEmissao("01/06/2026"), "01/06/2026");
    assert.equal(formatarDataEmissao("nao-e-data"), null);
    assert.equal(formatarDataEmissao(null), null);
  });
});
