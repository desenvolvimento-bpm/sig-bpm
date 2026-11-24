import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { gruposQueLigam, juntarPelaLigacao, ligarGrupos, type GrupoDaLigacao } from "../src/services/cenarios/ligacaoDosGrupos.js";
import { grupoDaLotacao } from "../src/services/listas/lotacaoDosCentros.js";

// O realizado (os Cadastros Gerais) com o Nome Controladoria novo da Segurança; o cenário com o nome antigo e um grupo que junta
// dois centros de grupos diferentes do realizado.
const REALIZADO: GrupoDaLigacao[] = [
  { grupo: "SEGURANÇA PATRIMONIAL (CRI)", centros: [{ origemId: "c1", codigo: "1.01.00000007" }] },
  { grupo: "SEGURANÇA (FOR)", centros: [{ origemId: "c2", codigo: "1.15.00000005" }] },
  { grupo: "LABORATÓRIO", centros: [{ origemId: "c3", codigo: "1.01.00000020" }, { origemId: "c4", codigo: "1.15.00000020" }] },
  { grupo: "PORTARIA", centros: [{ origemId: "c5", codigo: "1.01.00000030" }] },
];
const CENARIO: GrupoDaLigacao[] = [
  { grupo: "SEGURANÇA (CRI)", centros: [{ origemId: "c1", codigo: "1.01.00000007" }] },
  { grupo: "SEGURANÇA (FOR)", centros: [{ origemId: "c2", codigo: "1.15.00000005" }] },
  // O laboratório dividido em dois no cenário: os dois caem no mesmo grupo do realizado.
  { grupo: "LABORATÓRIO (CRI)", centros: [{ origemId: "c3", codigo: "1.01.00000020" }] },
  { grupo: "LABORATÓRIO (FOR)", centros: [{ origemId: "c4", codigo: "1.15.00000020" }] },
  // Um grupo com centros de dois grupos do realizado: fica com o próprio nome.
  { grupo: "APOIO", centros: [{ origemId: "c5", codigo: "1.01.00000030" }, { origemId: "c2", codigo: "1.15.00000005" }] },
  // Um centro só do cenário (sem origem), ligado pelo Código RM.
  { grupo: "NOVO", centros: [{ origemId: null, codigo: "1.01.00000030" }] },
  // Sem nenhum centro em comum: o próprio nome.
  { grupo: "SÓ DO CENÁRIO", centros: [{ origemId: null, codigo: "9.99" }] },
];

describe("Ligação dos grupos de centros pelo Código RM (24/11/2026)", () => {
  const ligacao = ligarGrupos(CENARIO, REALIZADO);

  it("liga o grupo pelo centro de origem, mesmo com outro nome", () => {
    assert.equal(ligacao.get("SEGURANÇA (CRI)"), "SEGURANÇA PATRIMONIAL (CRI)");
    assert.equal(ligacao.get("SEGURANÇA (FOR)"), "SEGURANÇA (FOR)");
  });

  it("liga vários grupos ao mesmo e, pelo Código RM, o centro sem origem", () => {
    assert.equal(ligacao.get("LABORATÓRIO (CRI)"), "LABORATÓRIO");
    assert.equal(ligacao.get("LABORATÓRIO (FOR)"), "LABORATÓRIO");
    assert.equal(ligacao.get("NOVO"), "PORTARIA");
  });

  it("deixa com o próprio nome o grupo espalhado por mais de um grupo e o sem centro em comum", () => {
    assert.equal(ligacao.get("APOIO"), "APOIO");
    assert.equal(ligacao.get("SÓ DO CENÁRIO"), "SÓ DO CENÁRIO");
  });

  it("acha os grupos do outro lado que se ligam a um grupo (e, sem nenhum, o mesmo nome)", () => {
    assert.deepEqual(gruposQueLigam(CENARIO, REALIZADO, "LABORATÓRIO").sort(), ["LABORATÓRIO (CRI)", "LABORATÓRIO (FOR)"]);
    assert.deepEqual(gruposQueLigam(CENARIO, REALIZADO, "SEGURANÇA PATRIMONIAL (CRI)"), ["SEGURANÇA (CRI)"]);
    assert.deepEqual(gruposQueLigam(CENARIO, REALIZADO, "SEM PAR"), ["SEM PAR"]);
  });

  it("soma mês a mês os valores dos grupos que caem no mesmo, com o nome ligado", () => {
    const valores = new Map([
      ["LABORATÓRIO (CRI)", new Map([["DA.MOI.REMUNERACOES_CLT", [100, 200]]])],
      ["LABORATÓRIO (FOR)", new Map([["DA.MOI.REMUNERACOES_CLT", [10, 20]], ["DA.MOI.HORAS_EXTRAS", [1, 2]]])],
      ["SEGURANÇA (CRI)", new Map([["DA.MOI.REMUNERACOES_CLT", [5, 5]]])],
    ]);
    const r = juntarPelaLigacao(valores, ligacao);
    assert.deepEqual([...r.keys()].sort(), ["LABORATÓRIO", "SEGURANÇA PATRIMONIAL (CRI)"]);
    assert.deepEqual(r.get("LABORATÓRIO")!.get("DA.MOI.REMUNERACOES_CLT"), [110, 220]);
    assert.deepEqual(r.get("LABORATÓRIO")!.get("DA.MOI.HORAS_EXTRAS"), [1, 2]);
    // Os valores de entrada não mudam.
    assert.deepEqual(valores.get("LABORATÓRIO (CRI)")!.get("DA.MOI.REMUNERACOES_CLT"), [100, 200]);
  });
});

describe("Lotações importadas na troca do Nome Controladoria", () => {
  it("reconhece o grupo antigo sem diferença de acentos, maiúsculas e espaços (as linhas que a troca leva ao nome novo)", () => {
    assert.equal(grupoDaLotacao("Seguranca  (CRI)", ["SEGURANÇA (CRI)"]), "SEGURANÇA (CRI)");
    assert.equal(grupoDaLotacao("SEGURANÇA (FOR)", ["SEGURANÇA (CRI)"]), null);
  });
});
