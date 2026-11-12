import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { gerarXlsx } from "../src/lib/xlsxEscrita.js";
import type { GrupoDoCenario } from "../src/services/cenarios/centrosCenario.js";
import { encargosDaBase, encargosDoGrupo, FATOR_PADRAO, itemDosEncargos, type ItemDosEncargos } from "../src/services/cenarios/encargosCenario.js";
import { abaDoQuadroDeLotacao, formulaDoQuadro, lerArquivoDePremissas, quadroDoArquivo } from "../src/services/cenarios/planilhaPremissas.js";
import { ehAprendiz, ehEstagiario, quadroDosGrupos, type LinhaDoQuadro } from "../src/services/cenarios/quadroDoCenario.js";

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
      { vinculo: "CLT", aprendiz: true, estagiario: false, codigo: "1.01", atribuicao: null, meses: doze(2, 1_500) },
      { vinculo: "CLT", aprendiz: false, estagiario: false, codigo: "1.01", atribuicao: "DIRETA", meses: doze(3, 4_000, 400) },
      { vinculo: "PJ", aprendiz: false, estagiario: false, codigo: "1.01", atribuicao: "INDIRETA", meses: doze(1, 8_000) },
      // Um centro fora dos grupos do cenário não conta.
      { vinculo: "CLT", aprendiz: false, estagiario: false, codigo: "1.96", atribuicao: null, meses: doze(9, 9_000) },
    ];
    const q = quadroDosGrupos(linhas, grupos, () => CONTAS);
    assert.deepEqual([...q.keys()], ["Montagem de Formas"]);
    const g = q.get("Montagem de Formas")!;
    assert.equal(g.linhas, 3);
    // 11/11/2026: os aprendizes à parte dos CLT.
    assert.deepEqual([g.aprendizes[0], g.estagiarios[0], g.clt[0], g.pj[0]], [2, 0, 3, 1]);
    // O aprendiz (centro sem atribuição) vai para a mão de obra do grupo (Indireta); o Pleno, para a Direta.
    assert.deepEqual([g.maos.get("CPP.MOI")!.clt[0], g.maos.get("CPP.MOI")!.aprendizes[0], g.maos.get("CPP.MOI")!.pj[0]], [3_000, 3_000, 8_000]);
    assert.deepEqual([g.maos.get("CPP.MOD")!.clt[0], g.maos.get("CPP.MOD")!.aprendizes[0]], [13_200, 0]);
    assert.ok(ehAprendiz(" aprendiz ") && ehAprendiz("APRENDIZ") && !ehAprendiz("Júnior"));
  });

  it("Aprendizes, Estagiários, CLT e PJ (11/11/2026): a contagem pela senioridade e os estagiários fora da base dos encargos", () => {
    const grupos = [grupo("Administrativo", "2.01", "INDIRETA")];
    const linhas: LinhaDoQuadro[] = [
      { vinculo: "CLT", aprendiz: true, estagiario: false, codigo: "2.01", atribuicao: "INDIRETA", meses: doze(2, 1_500) },
      { vinculo: "CLT", aprendiz: false, estagiario: true, codigo: "2.01", atribuicao: "INDIRETA", meses: doze(3, 1_200) },
      { vinculo: "CLT", aprendiz: false, estagiario: false, codigo: "2.01", atribuicao: "INDIRETA", meses: doze(4, 5_000) },
      { vinculo: "PJ", aprendiz: false, estagiario: false, codigo: "2.01", atribuicao: "INDIRETA", meses: doze(1, 9_000) },
      // Um estagiário cadastrado como PJ conta nos Estagiários; o salário fica nas Remunerações PJ (sem encargos).
      { vinculo: "PJ", aprendiz: false, estagiario: true, codigo: "2.01", atribuicao: "INDIRETA", meses: doze(1, 1_000) },
    ];
    const g = quadroDosGrupos(linhas, grupos, () => CONTAS).get("Administrativo")!;
    assert.deepEqual([g.aprendizes[0], g.estagiarios[0], g.clt[0], g.pj[0]], [2, 4, 4, 1]);
    // O total: a soma dos quatro, as onze pessoas das linhas.
    assert.equal(g.aprendizes[0] + g.estagiarios[0] + g.clt[0] + g.pj[0], 11);
    const s = g.maos.get("CPP.MOI")!;
    assert.deepEqual([s.clt[0], s.pj[0], s.aprendizes[0], s.estagiarios[0]], [3_000 + 3_600 + 20_000, 10_000, 3_000, 3_600]);
    // Os encargos: a base sem os estagiários, com o FGTS dos aprendizes a 2%.
    const r = encargosDoGrupo(
      CONTAS,
      "INDIRETA",
      (c) => (c === "CPP.MOI.REMUNERACOES_CLT" ? s.clt[0] : 0),
      () => undefined,
      (prefixo) => (prefixo === "CPP.MOI" ? s.aprendizes[0] : 0),
      (prefixo) => (prefixo === "CPP.MOI" ? s.estagiarios[0] : 0),
    );
    const esperado = encargosDaBase(3_000 + 20_000, 3_000, padrao);
    assert.ok(Math.abs(r.get("CPP.MOI.ENCARGOS_E_BENEFICIOS")![0] - esperado) < 1e-9);
    // O mesmo que os encargos de cada um: o CLT com tudo, o aprendiz com o FGTS a 2%, o estagiário sem nada.
    const provisoes = 1 / 9 + 1 / 12;
    const cadaUm = 20_000 * FATOR_PADRAO + 3_000 * (0.29 + 0.02 + provisoes + (0.29 + 0.02) * provisoes);
    assert.ok(Math.abs(esperado - cadaUm) < 1e-9);
    assert.ok(ehEstagiario("Estagiário") && ehEstagiario("ESTAGIARIO") && !ehEstagiario("Aprendiz"));
  });

  it("a aba Quadro de Lotação da planilha: o que sai, volta igual na importação, com os departamentos do arquivo (11/11/2026: sem o Código da Linha)", () => {
    const meses = ["JAN/26", "FEV/26", "MAR/26", "ABR/26", "MAI/26", "JUN/26", "JUL/26", "AGO/26", "SET/26", "OUT/26", "NOV/26", "DEZ/26"];
    const linhas = [
      { id: "6f1c3f5e-0000-4000-8000-000000000001", unidade: "Matriz", tipo: "CLT", senioridade: "Aprendiz", funcao: "Aprendiz Administrativo", centro: "1.01 - BPM", meses: doze(2, 1_500) },
      { id: "6f1c3f5e-0000-4000-8000-000000000002", unidade: "Filial", tipo: "PJ", senioridade: "Sênior", funcao: "Analista", centro: "1.02 - OUTRO", meses: doze(1, 8_000, 250.5) },
    ];
    const aba = abaDoQuadroDeLotacao(linhas, meses, "teste", { unidades: ["Matriz", "Filial"], senioridades: ["Aprendiz", "Sênior"] }, undefined, ["Produção", "Serviços"]);
    assert.equal(aba.linhas[3][0].valor, "Departamentos do arquivo: Produção, Serviços");
    // Uma linha nova, preenchida na primeira linha em branco: só março.
    const nova = aba.linhas[5 + linhas.length];
    ["Matriz", "CLT", "Pleno", "Analista", "1.01"].forEach((v, k) => (nova[k] = { valor: v }));
    nova[5 + 2 * 4] = { valor: 1 };
    nova[5 + 2 * 4 + 1] = { valor: "4.000,00" };
    const [lido] = lerArquivoDePremissas("premissas.xlsx", gerarXlsx([aba], "teste"));
    assert.deepEqual(lido.erros, []);
    assert.deepEqual(lido.abas, ["Quadro de Lotação"]);
    assert.deepEqual(lido.substituiQuadro, ["PRODUCAO", "SERVICOS"]);
    assert.equal(lido.quadro.length, 3);
    assert.deepEqual(
      lido.quadro.slice(0, 2).map((l) => ({ ...l.campos, meses: l.meses })),
      linhas.map(({ tipo, id: _id, ...l }) => ({ ...l, tipo })),
    );
    assert.ok(lido.quadro.every((l) => l.id === null));
    assert.deepEqual(lido.quadro[2].meses[2], { colaboradores: 1, salarioBruto: 4_000, adicional: 0 });
    assert.equal(lido.quadro[2].meses[3].colaboradores, 0);
  });

  it("as linhas dos centros em fórmula sobre a aba Quadro de Lotação do arquivo (11/11/2026): os centros, o Tipo, a senioridade e o mês", () => {
    // 3 linhas do cenário (as 30 em branco depois): da linha 6 à 38; com a referência, os meses começam na coluna G.
    const q = quadroDoArquivo(3, true);
    assert.deepEqual([q.primeira, q.ultima, q.doMes(0, 0), q.doMes(0, 1), q.doMes(1, 0)], [6, 38, "G", "H", "K"]);
    const rem = formulaDoQuadro({ centros: ["1.01"], tipo: "CLT", soma: "SALARIOS" }, q, 0);
    assert.equal(
      rem,
      "SUMPRODUCT(((('Quadro de Lotação'!E$6:E$38=\"1.01\")+(LEFT('Quadro de Lotação'!E$6:E$38,7)=\"1.01 - \"))>0)*('Quadro de Lotação'!B$6:B$38=\"CLT\")*'Quadro de Lotação'!G$6:G$38*('Quadro de Lotação'!H$6:H$38+'Quadro de Lotação'!I$6:I$38))",
    );
    // Os CLT sem os aprendizes e os estagiários; os aprendizes de qualquer Tipo.
    assert.ok(formulaDoQuadro({ centros: ["1.01"], tipo: "CLT", senioridade: "OUTRAS", soma: "COLABORADORES" }, q, 0).includes("(1-('Quadro de Lotação'!C$6:C$38=\"Aprendiz\"))"));
    assert.ok(!formulaDoQuadro({ centros: ["1.01"], senioridade: "APRENDIZ", soma: "COLABORADORES" }, q, 0).includes("!B$6"));
  });

  it("a coluna da referência na aba Quadro de Lotação (11/11/2026): depois do Centro de Custo, não se importa", () => {
    const meses = ["JAN/26", "FEV/26", "MAR/26", "ABR/26", "MAI/26", "JUN/26", "JUL/26", "AGO/26", "SET/26", "OUT/26", "NOV/26", "DEZ/26"];
    const linhas = [{ id: "6f1c3f5e-0000-4000-8000-000000000001", unidade: "Matriz", tipo: "CLT", senioridade: "Pleno", funcao: "Analista", centro: "1.01 - BPM", meses: doze(2, 1_500), referencia: 3 }];
    const aba = abaDoQuadroDeLotacao(linhas, meses, "teste", { unidades: ["Matriz"], senioridades: ["Pleno"] }, { rotulo: "QL Realizado (11/2026)", explicacao: "traz o realizado" });
    assert.deepEqual([aba.linhas[4][5].valor, aba.linhas[5][5].valor, aba.linhas[4][6].valor], ["QL Realizado (11/2026)", 3, "JAN/26 · Colaboradores"]);
    const [lido] = lerArquivoDePremissas("premissas.xlsx", gerarXlsx([aba], "teste"));
    assert.deepEqual(lido.erros, []);
    assert.deepEqual(lido.quadro[0].meses, doze(2, 1_500));
  });
});
