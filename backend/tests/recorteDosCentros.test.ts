import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { gruposDoRecorte, recorteDoCenario, recorteDoPerfil } from "../src/services/cenarios/recorteCenario.js";

/** Os grupos de centros: um da produção (CPP) e um do administrativo (DA), com os centros. */
const grupos = [
  { grupo: "ACABAMENTO", grupoDRE: "CPP", centros: [{ id: "c1", codigo: "1.01", nome: "Acabamento" }] },
  { grupo: "FINANCEIRO", grupoDRE: "DA", centros: [{ id: "c2", codigo: "1.02", nome: "Financeiro" }] },
] as unknown as Parameters<typeof gruposDoRecorte>[1];

describe("o recorte da aba Centros de Custo dos Resultados dos analíticos (19/11/2026)", () => {
  const gestor = { id: "u1", recorte: { departamentos: ["ADMINISTRATIVO" as const], centros: null } };
  const coordenador = { id: "u2", recorte: { departamentos: null, centros: ["c1"] } };
  const geral = { tipo: "ANALITICO", acessoInformacoes: "GERAL", criadoPorId: "u1" };

  it("vale o recorte do perfil, qualquer que seja o acesso do cenário (e mesmo para quem o criou)", () => {
    assert.equal(recorteDoCenario(geral, gestor), null, "nas Premissas, o cenário Geral não recorta");
    assert.deepEqual(gruposDoRecorte(recorteDoPerfil(gestor), grupos).map((g) => g.grupo), ["FINANCEIRO"]);
    assert.deepEqual(gruposDoRecorte(recorteDoPerfil(coordenador), grupos).map((g) => g.grupo), ["ACABAMENTO"]);
  });

  it("o Administrador e quem não tem recorte veem todos", () => {
    assert.equal(recorteDoPerfil({ admin: true, recorte: gestor.recorte }), null);
    assert.equal(recorteDoPerfil({ recorte: null }), null);
    assert.equal(gruposDoRecorte(recorteDoPerfil({}), grupos).length, 2);
  });
});
