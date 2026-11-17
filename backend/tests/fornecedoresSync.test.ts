import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extrairResultado, escaparXml, montarEnvelope } from "../src/services/totvs/consultaSql.js";
import { normalizarFornecedores } from "../src/services/totvs/fornecedoresSync.js";

const RESULTADO_RM = `<NewDataSet>
  <Resultado>
    <CODCFO>0001234</CODCFO>
    <NOMEFANTASIA>ACME &amp; FILHOS LTDA</NOMEFANTASIA>
    <PAGREC>2</PAGREC>
    <ATIVO>1</ATIVO>
    <IDCFO>123</IDCFO>
    <CGCCFO>12345678000190</CGCCFO>
  </Resultado>
  <Resultado>
    <CODCFO>  0009999  </CODCFO>
    <NOMEFANTASIA/>
    <PAGREC/>
    <ATIVO>0</ATIVO>
    <IDCFO>124</IDCFO>
    <CGCCFO/>
  </Resultado>
  <Resultado>
    <CODCFO/>
    <NOMEFANTASIA>SEM CÓDIGO</NOMEFANTASIA>
    <ATIVO>1</ATIVO>
  </Resultado>
</NewDataSet>`;

const SOAP_OK = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><RealizarConsultaSQLResponse xmlns="http://www.totvs.com/"><RealizarConsultaSQLResult>${escaparXml(RESULTADO_RM)}</RealizarConsultaSQLResult></RealizarConsultaSQLResponse></soap:Body></soap:Envelope>`;

const SOAP_FAULT = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultcode>soap:Server</faultcode><faultstring>Usuário ou Senha inválidos</faultstring></soap:Fault></soap:Body></soap:Envelope>`;

describe("envelope SOAP do wsConsultaSQL", () => {
  it("monta RealizarConsultaSQL com a sentença, a coligada e o sistema, sem parâmetros", () => {
    const xml = montarEnvelope("BPM.TI.RetCFO", 1, "T");
    assert.match(xml, /<tot:codSentenca>BPM\.TI\.RetCFO<\/tot:codSentenca>/);
    assert.match(xml, /<tot:codColigada>1<\/tot:codColigada>/);
    assert.match(xml, /<tot:codSistema>T<\/tot:codSistema>/);
    assert.doesNotMatch(xml, /parameters/);
  });

  it("escapa caracteres especiais no envelope", () => {
    assert.equal(escaparXml(`A&B <C> "D" 'E'`), "A&amp;B &lt;C&gt; &quot;D&quot; &apos;E&apos;");
  });
});

describe("resposta do wsConsultaSQL", () => {
  it("extrai o XML do resultado, já decodificado", () => {
    const xml = extrairResultado(SOAP_OK);
    assert.ok(xml.includes("<NOMEFANTASIA>ACME &amp; FILHOS LTDA</NOMEFANTASIA>"));
  });

  it("transforma uma falha SOAP em erro com a mensagem do RM", () => {
    assert.throws(() => extrairResultado(SOAP_FAULT), /Usuário ou Senha inválidos/);
  });
});

describe("normalização dos fornecedores", () => {
  it("normaliza cada linha, descarta a sem código e trata vazios como nulo", async () => {
    const linhas = await normalizarFornecedores(extrairResultado(SOAP_OK), 1);
    assert.equal(linhas.length, 2);
    assert.deepEqual(linhas[0], {
      codcoligada: 1,
      codcfo: "0001234",
      nomeFantasia: "ACME & FILHOS LTDA",
      pagrec: 2,
      ativo: 1,
      idcfo: 123,
      cgccfo: "12345678000190",
    });
    assert.deepEqual(linhas[1], {
      codcoligada: 1,
      codcfo: "0009999",
      nomeFantasia: null,
      pagrec: null,
      ativo: 0,
      idcfo: 124,
      cgccfo: null,
    });
  });

  it("ATIVO vale 1 só quando o RM manda 1", async () => {
    const xml = `<NewDataSet><Resultado><CODCFO>1</CODCFO><ATIVO>S</ATIVO></Resultado></NewDataSet>`;
    const [l] = await normalizarFornecedores(xml, 1);
    assert.equal(l.ativo, 0);
  });

  it("sem linhas no NewDataSet devolve lista vazia", async () => {
    assert.deepEqual(await normalizarFornecedores("<NewDataSet/>", 1), []);
  });

  it("uma única linha (objeto, não lista) também é lida", async () => {
    const xml = `<NewDataSet><Resultado><CODCFO>42</CODCFO><ATIVO>1</ATIVO></Resultado></NewDataSet>`;
    const linhas = await normalizarFornecedores(xml, 1);
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].codcfo, "42");
  });
});
