import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { gerarXlsx } from "../src/lib/xlsxEscrita.js";
import type { GrupoDoCenario } from "../src/services/cenarios/centrosCenario.js";
import { encargosDaBase, encargosDoGrupo, FATOR_PADRAO, itemDosEncargos, type ItemDosEncargos } from "../src/services/cenarios/encargosCenario.js";
import { abaDoQuadroDeLotacao, lerArquivoDePremissas } from "../src/services/cenarios/planilhaPremissas.js";
import { ehAprendiz, quadroDosGrupos, type LinhaDoQuadro } from "../src/services/cenarios/quadroDoCenario.js";

const padrao = (item: ItemDosEncargos) => itemDosEncargos(item)!.padrao ?? 0;
const doze = (colaboradores: number, salarioBruto: number, adicional = 0) => Array.from({ length: 12 }, () => ({ colaboradores, salarioBruto, adicional }));
const CONTAS = ["MOD", "MOI"].flatMap((m) => ["REMUNERACOES_CLT", "REMUNERACOES_PJ", "HORAS_EXTRAS", "ENCARGOS_E_BENEFICIOS"].map((c) => `CPP.${m}.${c}`));
const grupo = (nome: string, codigo: string, atribuicao: GrupoDoCenario["atribuicao"]): GrupoDoCenario => ({
  grupo: nome,
  centros: [{ codigo, nome, balde: "MATRIZ" }],
  balde: "MATRIZ",
  baldes: ["MATRIZ"],
  grupoDRE: "CPP",
  unidade: 1,
  destino: "Matriz",
  atribuicao,
  departamento: null,
});

describe("O Quadro de Lotação dos cenários analíticos (09/11/2026, etapa 4)", () => {
  it("o FGTS em Aprendiz (2%) e CLT (8%): sem aprendizes, o cálculo de antes", () => {
    assert.equal(padrao("FGTS_APRENDIZ"), 0.02);
    assert.equal(padrao("FGTS"), 0.08);
    assert.equal(itemDosEncargos("FGTS")!.rotulo, "Fundo de Garantia: CLT (FGTS)");
    assert.ok(Math.abs(encargosDaBase(10_000, 0, padrao) - 10_000 * FATOR_PADRAO) < 1e-9);
    // Com R$ 3.000 de aprendizes numa base de R$ 10.000: o FGTS deles a 2% (e não 8%), também sobre as provisões.
    const provisoes = 1 / 9 + 1 / 12;
    assert.ok(Math.abs(encargosDaBase(10_000, 3_000, padrao) - (10_000 * FATOR_PADRAO - 0.06 * 3_000 * (1 + provisoes))) < 1e-9);
    // O mesmo que o FGTS de cada um sobre os seus salários.
    const semFgts = 10_000 * (0.29 + provisoes + 0.29 * provisoes);
    assert.ok(Math.abs(encargosDaBase(10_000, 3_000, padrao) - (semFgts + (0.02 * 3_000 + 0.08 * 7_000) * (1 + provisoes))) < 1e-9);
    // Na conta do grupo, os aprendizes da mão de obra.
    const r = encargosDoGrupo(CONTAS, "DIRETA", (c) => (c === "CPP.MOD.REMUNERACOES_CLT" ? 10_000 : 0), () => undefined, (prefixo) => (prefixo === "CPP.MOD" ? 3_000 : 0));
    assert.ok(Math.abs(r.get("CPP.MOD.ENCARGOS_E_BENEFICIOS")![0] - encargosDaBase(10_000, 3_000, padrao)) < 1e-9);
  });

  it("os grupos com linhas: os colaboradores CLT e PJ e as remunerações de cada mão de obra pela atribuição do centro", () => {
    const grupos = [grupo("Montagem de Formas", "1.01", "INDIRETA"), grupo("Sem Linhas", "1.02", "DIRETA")];
    const linhas: LinhaDoQuadro[] = [
      { vinculo: "CLT", aprendiz: true, codigo: "1.01", atribuicao: null, meses: doze(2, 1_500) },
      { vinculo: "CLT", aprendiz: false, codigo: "1.01", atribuicao: "DIRETA", meses: doze(3, 4_000, 400) },
      { vinculo: "PJ", aprendiz: false, codigo: "1.01", atribuicao: "INDIRETA", meses: doze(1, 8_000) },
      // Um centro fora dos grupos do cenário não conta.
      { vinculo: "CLT", aprendiz: false, codigo: "1.96", atribuicao: null, meses: doze(9, 9_000) },
    ];
    const q = quadroDosGrupos(linhas, grupos, () => CONTAS);
    assert.deepEqual([...q.keys()], ["Montagem de Formas"]);
    const g = q.get("Montagem de Formas")!;
    assert.equal(g.linhas, 3);
    assert.equal(g.clt[0], 5);
    assert.equal(g.pj[0], 1);
    // O aprendiz (centro sem atribuição) vai para a mão de obra do grupo (Indireta); o Pleno, para a Direta.
    assert.deepEqual([g.maos.get("CPP.MOI")!.clt[0], g.maos.get("CPP.MOI")!.aprendizes[0], g.maos.get("CPP.MOI")!.pj[0]], [3_000, 3_000, 8_000]);
    assert.deepEqual([g.maos.get("CPP.MOD")!.clt[0], g.maos.get("CPP.MOD")!.aprendizes[0]], [13_200, 0]);
    assert.ok(ehAprendiz(" aprendiz ") && ehAprendiz("APRENDIZ") && !ehAprendiz("Júnior"));
  });

  it("a aba Quadro de Lotação da planilha: o que sai, volta igual na importação (as linhas novas sem código)", () => {
    const meses = ["JAN/26", "FEV/26", "MAR/26", "ABR/26", "MAI/26", "JUN/26", "JUL/26", "AGO/26", "SET/26", "OUT/26", "NOV/26", "DEZ/26"];
    const linhas = [
      { id: "6f1c3f5e-0000-4000-8000-000000000001", unidade: "Matriz", tipo: "CLT", senioridade: "Aprendiz", funcao: "Aprendiz Administrativo", centro: "1.01 - BPM", meses: doze(2, 1_500) },
      { id: "6f1c3f5e-0000-4000-8000-000000000002", unidade: "Filial", tipo: "PJ", senioridade: "Sênior", funcao: "Analista", centro: "1.02 - OUTRO", meses: doze(1, 8_000, 250.5) },
    ];
    const aba = abaDoQuadroDeLotacao(linhas, meses, "teste", { unidades: ["Matriz", "Filial"], senioridades: ["Aprendiz", "Sênior"] });
    // Uma linha nova, preenchida na primeira linha em branco: só março.
    const nova = aba.linhas[5 + linhas.length];
    ["Matriz", "CLT", "Pleno", "Analista", "1.01"].forEach((v, k) => (nova[1 + k] = { valor: v }));
    nova[6 + 2 * 4] = { valor: 1 };
    nova[6 + 2 * 4 + 1] = { valor: "4.000,00" };
    const [lido] = lerArquivoDePremissas("premissas.xlsx", gerarXlsx([aba], "teste"));
    assert.deepEqual(lido.erros, []);
    assert.deepEqual(lido.abas, ["Quadro de Lotação"]);
    assert.equal(lido.quadro.length, 3);
    assert.deepEqual(
      lido.quadro.slice(0, 2).map((l) => ({ id: l.id, ...l.campos, meses: l.meses })),
      linhas.map(({ tipo, ...l }) => ({ ...l, tipo })),
    );
    assert.equal(lido.quadro[2].id, null);
    assert.deepEqual(lido.quadro[2].meses[2], { colaboradores: 1, salarioBruto: 4_000, adicional: 0 });
    assert.equal(lido.quadro[2].meses[3].colaboradores, 0);
  });
});
