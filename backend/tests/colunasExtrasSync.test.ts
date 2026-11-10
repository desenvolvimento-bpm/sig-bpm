import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizarCentrosCusto } from "../src/services/totvs/centrosCustoSync.js";
import { normalizarContasContabeis } from "../src/services/totvs/contaContabilSync.js";
import { normalizarFornecedores } from "../src/services/totvs/fornecedoresSync.js";

/** O RM pode devolver colunas a mais no resultado da sentença: elas são ignoradas e o upsert usa só as nossas. */
describe("colunas extras do resultado do RM são ignoradas", () => {
  it("fornecedores: grava só CODCFO, NOMEFANTASIA, PAGREC, ATIVO, IDCFO e CGCCFO", async () => {
    const xml = `<NewDataSet><Resultado>
      <CODCFO>000123</CODCFO><NOMEFANTASIA>ACME</NOMEFANTASIA><PAGREC>2</PAGREC><ATIVO>1</ATIVO>
      <IDCFO>77</IDCFO><CGCCFO>12345678000199</CGCCFO><COLUNA_NOVA>x</COLUNA_NOVA><TELEFONE>999</TELEFONE>
    </Resultado></NewDataSet>`;
    const [f] = await normalizarFornecedores(xml, 1);
    assert.deepEqual(Object.keys(f).sort(), ["ativo", "cgccfo", "codcfo", "codcoligada", "idcfo", "nomeFantasia", "pagrec"]);
    assert.equal(f.codcfo, "000123");
  });

  it("centros de custo: grava só os campos mapeados", async () => {
    const xml = `<NewDataSet><Resultado>
      <CODCOLIGADA>1</CODCOLIGADA><CODCCUSTO>01.001</CODCCUSTO><NOME>ADM</NOME><ATIVO>1</ATIVO>
      <RECCREATEDON/><RECMODIFIEDON/><RESPONSAVEL/><NOME_RESPONSAVEL/><EMAIL/><OUTRA>y</OUTRA>
    </Resultado></NewDataSet>`;
    const [c] = await normalizarCentrosCusto(xml, 1);
    assert.deepEqual(Object.keys(c).sort(), [
      "ativo", "codccusto", "codcoligada", "emailResponsavel", "nome", "nomeResponsavel",
      "reccreatedon", "recmodifiedon", "responsavel",
    ]);
  });

  it("contas contábeis: grava só CODCONTA, REDUZIDO e DESCRICAO", async () => {
    const xml = `<NewDataSet><Resultado>
      <CODCOLIGADA>1</CODCOLIGADA><REDUZIDO>1001</REDUZIDO><CODCONTA>3.02.01</CODCONTA>
      <DESCRICAO>RECEITA</DESCRICAO><TIPO>A</TIPO><NIVEL>4</NIVEL>
    </Resultado></NewDataSet>`;
    const [c] = await normalizarContasContabeis(xml, 1);
    assert.deepEqual(c, { codcoligada: 1, codconta: "3.02.01", reduzido: "1001", descricao: "RECEITA" });
  });
});
