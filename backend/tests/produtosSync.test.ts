import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizarProdutos } from "../src/services/totvs/produtosSync.js";

const XML = `<NewDataSet>
  <Resultado>
    <CODCOLPRD>1</CODCOLPRD>
    <IDPRD>11075</IDPRD>
    <NOMEFANTASIA>PARAFUSO SEXTAVADO M5 X 16 &amp; ROSCA</NOMEFANTASIA>
    <CODIGOPRD>01.02.003</CODIGOPRD>
    <INATIVO>0</INATIVO>
    <CODIGOREDUZIDO>7788</CODIGOREDUZIDO>
    <ULTIMONIVEL>1</ULTIMONIVEL>
    <TIPO>P</TIPO>
    <CODIGOAUXILIAR>AUX-1</CODIGOAUXILIAR>
    <IDCLASSIFBENSSERVICO>55</IDCLASSIFBENSSERVICO>
    <CODUNDCONTROLE>UN</CODUNDCONTROLE>
    <CODUNDCOMPRA>UN</CODUNDCOMPRA>
    <CODUNDVENDA>UN</CODUNDVENDA>
    <CODTB1FAT>T1</CODTB1FAT>
    <CODTBORCAMENTO>3.1.1</CODTBORCAMENTO>
    <CODCOLTBORCAMENTO>1</CODCOLTBORCAMENTO>
    <CODTBORCAMENTORECEITA/>
    <CODCOLTBORCAMENTORECEITA/>
    <INTEGRA_MANUTENCAO>1</INTEGRA_MANUTENCAO>
    <CODTRF>TRF-9</CODTRF>
    <VOLUME/>
    <IMAGEM/>
    <USUARIOCRIACAO>integracao</USUARIOCRIACAO>
    <DTCADASTRAMENTO>2023-05-10T14:22:11</DTCADASTRAMENTO>
    <COLUNA_NOVA>x</COLUNA_NOVA>
  </Resultado>
  <Resultado>
    <CODCOLPRD>1</CODCOLPRD>
    <IDPRD>11076</IDPRD>
    <NOMEFANTASIA/>
    <CODIGOPRD>  02.001  </CODIGOPRD>
    <INATIVO>1</INATIVO>
    <ULTIMONIVEL>1</ULTIMONIVEL>
    <INTEGRA_MANUTENCAO>0</INTEGRA_MANUTENCAO>
    <DTCADASTRAMENTO>nao-e-data</DTCADASTRAMENTO>
  </Resultado>
  <Resultado>
    <IDPRD/>
    <CODIGOPRD>SEM ID</CODIGOPRD>
  </Resultado>
  <Resultado>
    <IDPRD>11077</IDPRD>
    <CODIGOPRD/>
  </Resultado>
</NewDataSet>`;

describe("normalização dos produtos", () => {
  it("lê as colunas da sentença, ignora a extra e converte os tipos", async () => {
    const [p] = await normalizarProdutos(XML, 1);
    assert.equal(p.codcoligada, 1);
    assert.equal(p.idprd, 11075);
    assert.equal(p.codcolprd, 1);
    assert.equal(p.nomeFantasia, "PARAFUSO SEXTAVADO M5 X 16 & ROSCA");
    assert.equal(p.codigoprd, "01.02.003");
    assert.equal(p.inativo, 0);
    assert.equal(p.codigoreduzido, "7788");
    assert.equal(p.ultimonivel, 1);
    assert.equal(p.tipo, "P");
    assert.equal(p.codtborcamento, "3.1.1");
    assert.equal(p.integraManutencao, 1);
    assert.equal(p.codtrf, "TRF-9");
    assert.equal(p.volume, null);
    assert.equal(p.imagem, null);
    assert.equal(p.usuarioCriacaoTotvs, "integracao");
    assert.equal(p.dtcadastramento?.toISOString(), new Date("2023-05-10T14:22:11").toISOString());
    assert.equal(Object.keys(p).includes("coluna_nova"), false);
  });

  it("código com espaço é aparado; vazio vira nulo; data inválida vira nulo; flags ausentes viram 0", async () => {
    const [, p] = await normalizarProdutos(XML, 1);
    assert.equal(p.codigoprd, "02.001");
    assert.equal(p.nomeFantasia, null);
    assert.equal(p.inativo, 1);
    assert.equal(p.codigoreduzido, null);
    assert.equal(p.dtcadastramento, null);
    assert.equal(p.integraManutencao, 0);
    assert.equal(p.tipo, null);
  });

  it("descarta linha sem IDPRD ou sem CODIGOPRD", async () => {
    const linhas = await normalizarProdutos(XML, 1);
    assert.equal(linhas.length, 2);
  });

  it("sem linhas devolve lista vazia", async () => {
    assert.deepEqual(await normalizarProdutos("<NewDataSet/>", 1), []);
  });
});
