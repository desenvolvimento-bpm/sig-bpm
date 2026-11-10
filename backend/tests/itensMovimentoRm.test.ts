import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cruzarItensMovimento, extrairItensMovimento } from "../src/services/totvs/movimentoRm.js";

const XML = `<MovMovimentoTBC>
  <TMOV><IDMOV>95904</IDMOV></TMOV>
  <TITMMOV>
    <CODCOLIGADA>1</CODCOLIGADA><IDMOV>95904</IDMOV><NSEQITMMOV>9</NSEQITMMOV>
    <IDPRD>500</IDPRD><CODIGOPRD>01.00000001.013.0000550</CODIGOPRD>
    <NOMEFANTASIA>PERFIL U SUPORTE</NOMEFANTASIA><QUANTIDADE>16</QUANTIDADE><PRECOUNITARIO>133</PRECOUNITARIO>
  </TITMMOV>
  <TITMMOV>
    <CODCOLIGADA>1</CODCOLIGADA><IDMOV>95904</IDMOV><NSEQITMMOV>7</NSEQITMMOV>
    <IDPRD>400</IDPRD><CODIGOPRD>01.00000002</CODIGOPRD>
    <NOMEFANTASIA>PARAFUSO</NOMEFANTASIA><QUANTIDADE>2</QUANTIDADE><PRECOUNITARIO>10</PRECOUNITARIO>
  </TITMMOV>
  <TITMMOVRATCCU>
    <CODCOLIGADA>1</CODCOLIGADA><IDMOV>95904</IDMOV><NSEQITMMOV>7</NSEQITMMOV>
    <CODCCUSTO>1.96.00000012</CODCCUSTO><NOME>INSERTOS E FERRAGENS</NOME><VALOR>1245</VALOR><IDMOVRATCCU>295492</IDMOVRATCCU>
  </TITMMOVRATCCU>
  <TITMMOVRATCCU>
    <CODCOLIGADA>1</CODCOLIGADA><IDMOV>95904</IDMOV><NSEQITMMOV>7</NSEQITMMOV>
    <CODCCUSTO>1.01.00000001</CODCCUSTO><NOME>FINANCEIRO</NOME><VALOR>55</VALOR><IDMOVRATCCU>295493</IDMOVRATCCU>
  </TITMMOVRATCCU>
  <TITMMOVRATCCU>
    <CODCOLIGADA>1</CODCOLIGADA><IDMOV>95904</IDMOV><NSEQITMMOV>9</NSEQITMMOV>
    <CODCCUSTO>1.99.00000005</CODCCUSTO><NOME>OUTRO</NOME><VALOR>2128</VALOR><IDMOVRATCCU>295494</IDMOVRATCCU>
  </TITMMOVRATCCU>
</MovMovimentoTBC>`;

describe("itens do movimento (XML)", () => {
  it("lê os itens e junta os rateios pelo NSEQITMMOV, ordenados por ele", async () => {
    const itens = await extrairItensMovimento(XML);
    assert.deepEqual(itens.map((i) => i.nseqitmmov), [7, 9]);
    assert.equal(itens[0].codigoprd, "01.00000002");
    assert.equal(itens[0].rateios.length, 2);
    assert.equal(itens[0].rateios[0].codccusto, "1.96.00000012");
    assert.equal(itens[0].rateios[0].valor, "1245");
    assert.equal(itens[1].rateios.length, 1);
  });
});

describe("cruzamento com sig_lancamentos_contabeis_rm", () => {
  it("mantém só os itens com IDPRD registrado e os rateios cujo centro está registrado", async () => {
    const itens = await extrairItensMovimento(XML);
    const lancamentos = [
      { idprd: 400, codCusto: "1.96.00000012" },
      { idprd: 400, codCusto: "1.01.00000001" },
    ];
    const produtos = new Map([[400, "PARAFUSO SEXTAVADO (cadastro)"]]);
    const centros = new Map([["1.96.00000012", "INSERTOS E FERRAGENS (cadastro)"]]);

    const cruzados = cruzarItensMovimento(itens, lancamentos, produtos, centros);
    assert.equal(cruzados.length, 1, "o item 9 (IDPRD 500) não está nos lançamentos");
    assert.equal(cruzados[0].nseqitmmov, 7);
    assert.equal(cruzados[0].produto, "PARAFUSO SEXTAVADO (cadastro)");
    assert.deepEqual(
      cruzados[0].rateios.map((r) => [r.codccusto, r.centro, r.valor]),
      [
        ["1.96.00000012", "INSERTOS E FERRAGENS (cadastro)", "1245"],
        ["1.01.00000001", "FINANCEIRO", "55"],
      ],
    );
  });

  it("sem cadastro, usa o nome que veio no RM; sem lançamentos, a lista fica vazia", async () => {
    const itens = await extrairItensMovimento(XML);
    const sem = cruzarItensMovimento(itens, [{ idprd: 400, codCusto: "1.01.00000001" }], new Map(), new Map());
    assert.equal(sem[0].produto, "PARAFUSO");
    assert.equal(sem[0].rateios[0].centro, "FINANCEIRO");
    assert.deepEqual(cruzarItensMovimento(itens, [], new Map(), new Map()), []);
  });
});
