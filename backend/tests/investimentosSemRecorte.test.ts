import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  abasDoRecorte,
  alteraOInvestimento,
  alteraTodosOsInvestimentos,
  departamentosDoInvestimento,
  foraDosSeusInvestimentos,
  recorteDoCenario,
  veAlteracao,
  veDepartamentos,
} from "../src/services/cenarios/recorteCenario.js";

/** A lista dos investimentos sem o recorte, para todos os que leem a aba (19/11/2026, pedido do Adão). */
describe("os investimentos sem o recorte (19/11/2026)", () => {
  const cenario = { tipo: "ANALITICO", acessoInformacoes: "POR_RECORTE", criadoPorId: "outro" };
  const gestor = { id: "u1", recorte: { departamentos: ["COMERCIAL" as const], centros: null } };
  const coordenador = { id: "u2", recorte: { departamentos: null, centros: ["c1"] } };

  it("a aba Investimentos aparece para todos, também para o Coordenador; a Depreciação segue o recorte", () => {
    assert.equal(abasDoRecorte(recorteDoCenario(cenario, coordenador))!.includes("investimentos"), true);
    assert.equal(abasDoRecorte(recorteDoCenario(cenario, gestor))!.includes("investimentos"), true);
    // A Depreciação: só as unidades dos departamentos do recorte.
    const r = recorteDoCenario(cenario, gestor);
    assert.equal(veDepartamentos(r, departamentosDoInvestimento({ unidade: 1, departamento: null })), false);
    assert.equal(veDepartamentos(r, departamentosDoInvestimento({ unidade: 4, departamento: "COMERCIAL" })), true);
  });

  it("no histórico, todos veem as alterações da lista; a Depreciação Base e as linhas seguem o recorte", () => {
    const r = recorteDoCenario(cenario, gestor);
    const grupos = new Map();
    const semConta = () => null;
    const novo = { tipo: "VALOR", descricao: "Investimentos · Novo: Ponte Rolante", contas: [], alcance: [{ d: ["PRODUCAO"], i: true }] };
    const antigo = { tipo: "VALOR", descricao: "Investimentos · Alterado: Ponte Rolante", contas: [], alcance: [{ d: ["PRODUCAO"] }] };
    const base = { tipo: "VALOR", descricao: "Investimentos · Depreciação Base", contas: [], alcance: [{ d: ["PRODUCAO"] }] };
    const importacao = { tipo: "IMPORTACAO", descricao: "Importar Valores", contas: [], alcance: [{ d: ["COMERCIAL"] }, { d: ["PRODUCAO"], i: true }] };
    const comLinhaDeFora = { ...importacao, alcance: [{ d: ["PRODUCAO"] }, { d: ["PRODUCAO"], i: true }] };
    assert.equal(veAlteracao(r, novo, grupos, semConta), true);
    assert.equal(veAlteracao(r, antigo, grupos, semConta), true, "as de antes, pela descrição");
    assert.equal(veAlteracao(r, base, grupos, semConta), false);
    assert.equal(veAlteracao(r, importacao, grupos, semConta), true);
    assert.equal(veAlteracao(r, comLinhaDeFora, grupos, semConta), false);
  });
});

/** Com recorte, cada um altera e exclui só os investimentos que incluiu (19/11/2026, pedido do Adão). */
describe("os investimentos de quem os incluiu (19/11/2026)", () => {
  const cenario = { criadoPorId: "dono" };
  const gestor = { id: "u1", recorte: { departamentos: ["COMERCIAL" as const], centros: null } };
  const coordenador = { id: "u2", recorte: { departamentos: null, centros: ["c1"] } };
  const contador = { id: "u3", recorte: null };
  const doGestor = { criadoPorId: "u1" };
  const deOutro = { criadoPorId: "u9" };
  const semAutor = { criadoPorId: null };

  it("com recorte, só os que incluiu", () => {
    const todos = alteraTodosOsInvestimentos(cenario, gestor);
    assert.equal(todos, false);
    assert.equal(alteraOInvestimento(todos, doGestor, gestor), true);
    assert.equal(alteraOInvestimento(todos, deOutro, gestor), false);
    assert.equal(alteraOInvestimento(todos, semAutor, gestor), false, "os de antes, sem autor, não");
    assert.equal(alteraTodosOsInvestimentos(cenario, coordenador), false);
  });

  it("o Administrador, quem criou o cenário e quem não tem recorte alteram todos", () => {
    assert.equal(alteraTodosOsInvestimentos(cenario, { id: "a", admin: true, recorte: gestor.recorte }), true);
    assert.equal(alteraTodosOsInvestimentos(cenario, { ...gestor, id: "dono" }), true);
    assert.equal(alteraTodosOsInvestimentos(cenario, contador), true);
    assert.equal(alteraOInvestimento(true, semAutor, contador), true);
  });

  it("a recusa diz quem incluiu", () => {
    assert.match(foraDosSeusInvestimentos({ nomeReferencia: "Ponte", criadoPor: { nome: "Maiko" } }), /incluído por Maiko/);
    assert.match(foraDosSeusInvestimentos({ nomeReferencia: "Ponte", criadoPor: null }), /antes do registro/);
  });
});
