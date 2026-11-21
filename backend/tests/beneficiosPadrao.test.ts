import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { encargosDoGrupo, ITENS_DOS_ENCARGOS } from "../src/services/cenarios/encargosCenario.js";
import { beneficiosDoMes, beneficiosImportados, mesesDaLinha, quadroDosGrupos, type MesDaLinha } from "../src/services/cenarios/quadroDoCenario.js";
import { formulaDoQuadro, quadroDoArquivo } from "../src/services/cenarios/planilhaPremissas.js";

const VALORES = new Map([
  ["cesta", 150],
  ["saude", 400],
]);
const mes = (colaboradores: number, extra: Partial<MesDaLinha> = {}): MesDaLinha => ({ colaboradores, salarioBruto: 0, adicional: 0, ...extra });

describe("Benefícios Padrão (21/11/2026)", () => {
  it("os aplicados valem por colaborador; sem eles, o digitado", () => {
    assert.equal(beneficiosDoMes(mes(3, { beneficiosPadrao: ["cesta", "saude"] }), VALORES), 1650);
    // O benefício excluído vale zero; o digitado não conta com aplicados.
    assert.equal(beneficiosDoMes(mes(2, { beneficiosPadrao: ["cesta", "outro"], beneficiosDigitados: 999 }), VALORES), 300);
    assert.equal(beneficiosDoMes(mes(2, { beneficiosDigitados: 500 }), VALORES), 500);
    assert.equal(beneficiosDoMes(mes(2), VALORES), 0);
  });

  it("a importação: sem a coluna ou com o mesmo valor, ficam os aplicados; com outro, o digitado", () => {
    const atual = mes(3, { beneficiosPadrao: ["cesta"] });
    assert.deepEqual(beneficiosImportados(mes(5), atual, VALORES), { beneficiosPadrao: ["cesta"], beneficiosDigitados: null });
    assert.deepEqual(beneficiosImportados(mes(5, { beneficiosDigitados: 450 }), atual, VALORES), { beneficiosPadrao: ["cesta"], beneficiosDigitados: null });
    assert.deepEqual(beneficiosImportados(mes(5, { beneficiosDigitados: 700 }), atual, VALORES), { beneficiosPadrao: [], beneficiosDigitados: 700 });
    assert.deepEqual(beneficiosImportados(mes(5, { beneficiosDigitados: null }), atual, VALORES), { beneficiosPadrao: [], beneficiosDigitados: null });
    // A linha nova: o digitado.
    assert.deepEqual(beneficiosImportados(mes(1, { beneficiosDigitados: 80 }), undefined, VALORES), { beneficiosPadrao: [], beneficiosDigitados: 80 });
  });

  it("os meses gravados trazem os aplicados e o digitado", () => {
    const ms = mesesDaLinha([{ mes: 2, colaboradores: 4, salarioBruto: 1000, adicional: 0, beneficiosPadrao: ["saude"], beneficios: null }]);
    assert.deepEqual(ms[1], { colaboradores: 4, salarioBruto: 1000, adicional: 0, beneficiosPadrao: ["saude"], beneficiosDigitados: null });
    assert.deepEqual(ms[0].beneficiosPadrao, []);
  });

  it("o grupo soma os Benefícios das linhas, e a conta Encargos e Benefícios da mão de obra principal os leva", () => {
    const grupos = [{ grupo: "G", centros: [{ codigo: "100" }] }] as never;
    const q = quadroDosGrupos(
      [
        { vinculo: "CLT", codigo: "100", meses: Array.from({ length: 12 }, () => mes(2)), beneficios: Array<number>(12).fill(300) },
        { vinculo: "PJ", codigo: "100", meses: Array.from({ length: 12 }, () => mes(1)), beneficios: Array<number>(12).fill(150) },
      ],
      grupos,
    ).get("G")!;
    assert.equal(q.beneficios[0], 450);
    const codigos = ["CPP.MOD.REMUNERACOES_CLT", "CPP.MOD.ENCARGOS_E_BENEFICIOS", "CPP.MOI.REMUNERACOES_CLT", "CPP.MOI.ENCARGOS_E_BENEFICIOS"];
    const zero = () => 0;
    const r = encargosDoGrupo(codigos, "DIRETA", zero, () => undefined, zero, zero, (m) => q.beneficios[m - 1]);
    assert.equal(r.get("CPP.MOD.ENCARGOS_E_BENEFICIOS")![0], 450);
    assert.equal(r.get("CPP.MOI.ENCARGOS_E_BENEFICIOS")![0], 0);
    assert.ok(ITENS_DOS_ENCARGOS.find((i) => i.item === "BENEFICIOS_PADRAO")?.calculado);
  });

  it("no Excel, a soma da coluna Benefícios das linhas dos centros do grupo, de todos os tipos", () => {
    const q = quadroDoArquivo(3, false);
    // JAN: a quinta coluna do mês (depois de Unidade, Tipo, Função e Centro de Custo: E a I; os Benefícios em I).
    assert.equal(q.doMes(0, 4), "I");
    assert.equal(q.doMes(1, 0), "J");
    const f = formulaDoQuadro({ centros: ["100"], tipo: null, soma: "BENEFICIOS" }, q, 0);
    assert.match(f, /^SUMPRODUCT\(\(\(\('Quadro de Lotação'!D\$\d+:D\$\d+="100"\).*\)>0\)\*'Quadro de Lotação'!I\$\d+:I\$\d+\)$/);
    assert.doesNotMatch(f, /'Quadro de Lotação'!B/);
  });
});
