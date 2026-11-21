import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { gerarXlsx } from "../src/lib/xlsxEscrita.js";
import type { GrupoDoCenario } from "../src/services/cenarios/centrosCenario.js";
import { encargosDaBase, encargosDoGrupo, FATOR_PADRAO, itemDosEncargos, maosDeObraDoGrupo, type ItemDosEncargos } from "../src/services/cenarios/encargosCenario.js";
import { abaDoQuadroDeLotacao, formulaDoQuadro, lerArquivoDePremissas, quadroDoArquivo } from "../src/services/cenarios/planilhaPremissas.js";
import { quadroDosGrupos, remuneracoesDoQuadro, tipoDaLinha, type LinhaDoQuadro } from "../src/services/cenarios/quadroDoCenario.js";

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
    // Na conta do grupo, os Salários dos Aprendizes só na mão de obra principal (12/11/2026): a da atribuição do grupo.
    const r = encargosDoGrupo(CONTAS, "DIRETA", (c) => (c === "CPP.MOD.REMUNERACOES_CLT" || c === "CPP.MOI.REMUNERACOES_CLT" ? 10_000 : 0), () => undefined, () => 3_000);
    assert.ok(Math.abs(r.get("CPP.MOD.ENCARGOS_E_BENEFICIOS")![0] - encargosDaBase(10_000, 3_000, padrao)) < 1e-9);
    assert.ok(Math.abs(r.get("CPP.MOI.ENCARGOS_E_BENEFICIOS")![0] - encargosDaBase(10_000, 0, padrao)) < 1e-9);
  });

  it("os grupos com linhas: os colaboradores e os Salários de cada tipo, todos na mão de obra da atribuição do grupo (12/11/2026)", () => {
    const grupos = [grupo("Montagem de Formas", "1.01", "INDIRETA"), grupo("Sem Linhas", "1.02", "DIRETA")];
    const linhas: LinhaDoQuadro[] = [
      { vinculo: "APRENDIZ", codigo: "1.01", meses: doze(2, 1_500) },
      { vinculo: "CLT", codigo: "1.01", meses: doze(3, 4_000, 400) },
      { vinculo: "PJ", codigo: "1.01", meses: doze(1, 8_000) },
      // Um centro fora dos grupos do cenário não conta.
      { vinculo: "CLT", codigo: "1.96", meses: doze(9, 9_000) },
    ];
    const q = quadroDosGrupos(linhas, grupos);
    assert.deepEqual([...q.keys()], ["Montagem de Formas"]);
    const g = q.get("Montagem de Formas")!;
    assert.equal(g.linhas, 3);
    // 11/11/2026: os aprendizes à parte dos CLT.
    assert.deepEqual([g.aprendizes[0], g.estagiarios[0], g.clt[0], g.pj[0]], [2, 0, 3, 1]);
    // Os Salários de cada tipo: a soma do Salário Bruto + Insalubridade / Periculosidade das linhas (17/11/2026, pedido do
    // Adão: os valores da linha já são os de todos os colaboradores dela; não se multiplicam por eles).
    assert.deepEqual([g.salarios.aprendizes[0], g.salarios.estagiarios[0], g.salarios.clt[0], g.salarios.pj[0]], [1_500, 0, 4_400, 8_000]);
    // As Remunerações: CLT, os Aprendizes, os Estagiários e os CLT; PJ, os PJ — na mão de obra do grupo (Indireta: a MOI).
    assert.deepEqual(remuneracoesDoQuadro(g.salarios, 0), { clt: 5_900, pj: 8_000 });
    assert.deepEqual(maosDeObraDoGrupo(CONTAS, "INDIRETA").map((m) => [m.prefixo, m.principal]), [["CPP.MOD", false], ["CPP.MOI", true]]);
    assert.deepEqual(maosDeObraDoGrupo(CONTAS, "DIRETA").map((m) => [m.prefixo, m.principal]), [["CPP.MOD", true], ["CPP.MOI", false]]);
    assert.deepEqual((["APRENDIZ", "ESTAGIARIO", "CLT", "PJ"] as const).map((vinculo) => tipoDaLinha({ vinculo })), ["aprendizes", "estagiarios", "clt", "pj"]);
  });

  it("Aprendizes, Estagiários, CLT e PJ (16/11/2026: pelo Tipo da linha) e os estagiários fora da base dos encargos", () => {
    const grupos = [grupo("Administrativo", "2.01", "INDIRETA")];
    const linhas: LinhaDoQuadro[] = [
      { vinculo: "APRENDIZ", codigo: "2.01", meses: doze(2, 1_500) },
      { vinculo: "ESTAGIARIO", codigo: "2.01", meses: doze(3, 1_200) },
      { vinculo: "CLT", codigo: "2.01", meses: doze(4, 5_000) },
      { vinculo: "PJ", codigo: "2.01", meses: doze(1, 9_000) },
      // Os salários dos estagiários vão nas Remunerações CLT, fora da base dos encargos.
      { vinculo: "ESTAGIARIO", codigo: "2.01", meses: doze(1, 1_000) },
    ];
    const g = quadroDosGrupos(linhas, grupos).get("Administrativo")!;
    assert.deepEqual([g.aprendizes[0], g.estagiarios[0], g.clt[0], g.pj[0]], [2, 4, 4, 1]);
    // O total: a soma dos quatro, as onze pessoas das linhas.
    assert.equal(g.aprendizes[0] + g.estagiarios[0] + g.clt[0] + g.pj[0], 11);
    const s = g.salarios;
    // Os salários das linhas, sem multiplicar pelos colaboradores (17/11/2026); os dois estagiários somam as duas linhas.
    assert.deepEqual([s.aprendizes[0], s.estagiarios[0], s.clt[0], s.pj[0]], [1_500, 2_200, 5_000, 9_000]);
    const rem = remuneracoesDoQuadro(s, 0);
    assert.deepEqual(rem, { clt: 1_500 + 2_200 + 5_000, pj: 9_000 });
    // Os encargos: a base sem os estagiários, com o FGTS dos aprendizes a 2%.
    const r = encargosDoGrupo(
      CONTAS,
      "INDIRETA",
      (c) => (c === "CPP.MOI.REMUNERACOES_CLT" ? rem.clt : 0),
      () => undefined,
      () => s.aprendizes[0],
      () => s.estagiarios[0],
    );
    const esperado = encargosDaBase(1_500 + 5_000, 1_500, padrao);
    assert.ok(Math.abs(r.get("CPP.MOI.ENCARGOS_E_BENEFICIOS")![0] - esperado) < 1e-9);
    // O mesmo que os encargos de cada um: o CLT com tudo, o aprendiz com o FGTS a 2%, o estagiário sem nada.
    const provisoes = 1 / 9 + 1 / 12;
    const cadaUm = 5_000 * FATOR_PADRAO + 1_500 * (0.29 + 0.02 + provisoes + (0.29 + 0.02) * provisoes);
    assert.ok(Math.abs(esperado - cadaUm) < 1e-9);
  });

  it("a aba Quadro de Lotação da planilha: o que sai, volta igual na importação, com os departamentos do arquivo (11/11/2026: sem o Código da Linha)", () => {
    const meses = ["JAN/26", "FEV/26", "MAR/26", "ABR/26", "MAI/26", "JUN/26", "JUL/26", "AGO/26", "SET/26", "OUT/26", "NOV/26", "DEZ/26"];
    const linhas = [
      { id: "6f1c3f5e-0000-4000-8000-000000000001", unidade: "Matriz", tipo: "Aprendiz", funcao: "Jovem Aprendiz", centro: "1.01 - BPM", meses: doze(2, 1_500) },
      { id: "6f1c3f5e-0000-4000-8000-000000000002", unidade: "Filial", tipo: "PJ", funcao: "Analista", centro: "1.02 - OUTRO", meses: doze(1, 8_000, 250.5) },
    ];
    const aba = abaDoQuadroDeLotacao(linhas, meses, "teste", { unidades: ["Matriz", "Filial"] }, undefined, ["Produção", "Serviços"]);
    assert.equal(aba.linhas[3][0].valor, "Departamentos do arquivo: Produção, Serviços");
    assert.deepEqual(aba.linhas[4].slice(0, 4).map((c) => c.valor), ["Unidade", "Tipo", "Função", "Centro de Custo"]);
    assert.deepEqual(aba.validacoes?.[0].lista, ["CLT", "PJ", "Aprendiz", "Estagiário"]);
    // O Custo no Ano (17/11/2026): a soma do Salário Total dos doze meses, sem multiplicar pelos colaboradores.
    assert.equal(aba.linhas[5].at(-1)?.valor, 12 * 1_500);
    // 21/11/2026: cinco colunas por mês (com os Benefícios depois do Salário Total).
    assert.equal(aba.linhas[5].at(-1)?.formula?.startsWith("N(F6)+N(G6)+N(K6)+N(L6)"), true);
    // Uma linha nova, preenchida na primeira linha em branco: só março.
    const nova = aba.linhas[5 + linhas.length];
    ["Matriz", "CLT", "Analista", "1.01"].forEach((v, k) => (nova[k] = { valor: v }));
    nova[4 + 2 * 5] = { valor: 1 };
    nova[4 + 2 * 5 + 1] = { valor: "4.000,00" };
    const [lido] = lerArquivoDePremissas("premissas.xlsx", gerarXlsx([aba], "teste"));
    assert.deepEqual(lido.erros, []);
    assert.deepEqual(lido.abas, ["Quadro de Lotação"]);
    assert.deepEqual(lido.substituiQuadro, ["PRODUCAO", "SERVICOS"]);
    assert.equal(lido.quadro.length, 3);
    assert.deepEqual(
      lido.quadro.slice(0, 2).map((l) => ({ ...l.campos, meses: l.meses })),
      // Os Benefícios (21/11/2026): a coluna em branco volta como nenhum (null).
      linhas.map(({ tipo, id: _id, ...l }) => ({ ...l, tipo, meses: l.meses.map((m) => ({ ...m, beneficiosDigitados: null })) })),
    );
    assert.ok(lido.quadro.every((l) => l.id === null));
    assert.deepEqual(lido.quadro[2].meses[2], { colaboradores: 1, salarioBruto: 4_000, adicional: 0, beneficiosDigitados: null });
    assert.equal(lido.quadro[2].meses[3].colaboradores, 0);
  });

  it("as linhas dos centros em fórmula sobre a aba Quadro de Lotação do arquivo (11/11/2026): os centros, o Tipo e o mês", () => {
    // 3 linhas do cenário (as 30 em branco depois): da linha 6 à 38; com a referência, os meses começam na coluna F.
    const q = quadroDoArquivo(3, true);
    // 21/11/2026: cinco colunas por mês (os Benefícios em J; fevereiro começa em K).
    assert.deepEqual([q.primeira, q.ultima, q.doMes(0, 0), q.doMes(0, 1), q.doMes(0, 4), q.doMes(1, 0)], [6, 38, "F", "G", "J", "K"]);
    const rem = formulaDoQuadro({ centros: ["1.01"], tipo: "CLT", soma: "SALARIOS" }, q, 0);
    assert.equal(
      rem,
      "SUMPRODUCT(((('Quadro de Lotação'!D$6:D$38=\"1.01\")+(LEFT('Quadro de Lotação'!D$6:D$38,7)=\"1.01 - \"))>0)*('Quadro de Lotação'!B$6:B$38=\"CLT\")*('Quadro de Lotação'!G$6:G$38+'Quadro de Lotação'!H$6:H$38))",
    );
    // Os aprendizes e os estagiários pelo Tipo (o Estagiário também sem o acento).
    assert.ok(formulaDoQuadro({ centros: ["1.01"], tipo: "APRENDIZ", soma: "COLABORADORES" }, q, 0).includes("('Quadro de Lotação'!B$6:B$38=\"Aprendiz\")"));
    assert.ok(
      formulaDoQuadro({ centros: ["1.01"], tipo: "ESTAGIARIO", soma: "COLABORADORES" }, q, 0).includes(
        "(('Quadro de Lotação'!B$6:B$38=\"Estagiário\")+('Quadro de Lotação'!B$6:B$38=\"Estagiario\"))",
      ),
    );
  });

  it("o arquivo exportado com a Senioridade (até 16/11/2026): o Aprendiz e o Estagiário dela viram o Tipo da linha", () => {
    const meses = ["JAN/26", "FEV/26", "MAR/26", "ABR/26", "MAI/26", "JUN/26", "JUL/26", "AGO/26", "SET/26", "OUT/26", "NOV/26", "DEZ/26"];
    const linhas = [
      { id: "1", unidade: "Matriz", tipo: "CLT", funcao: "Jovem Aprendiz", centro: "1.01 - BPM", meses: doze(2, 1_500) },
      { id: "2", unidade: "Matriz", tipo: "CLT", funcao: "Bolsista", centro: "1.01 - BPM", meses: doze(1, 1_200) },
      { id: "3", unidade: "Matriz", tipo: "PJ", funcao: "Analista", centro: "1.01 - BPM", meses: doze(1, 8_000) },
    ];
    const aba = abaDoQuadroDeLotacao(linhas, meses, "teste", { unidades: ["Matriz"] });
    // A coluna Senioridade depois do Tipo, como nos arquivos de antes.
    const senioridades = ["Aprendiz", "Estagiário", "Pleno"];
    aba.linhas.forEach((l, k) => {
      if (k === 4) l.splice(2, 0, { valor: "Senioridade" });
      else if (k > 4) l.splice(2, 0, { valor: senioridades[k - 5] ?? null });
    });
    const [lido] = lerArquivoDePremissas("premissas.xlsx", gerarXlsx([aba], "teste"));
    assert.deepEqual(lido.erros, []);
    assert.deepEqual(
      lido.quadro.map((l) => [l.campos.funcao, l.campos.tipo]),
      [
        ["Jovem Aprendiz", "Aprendiz"],
        ["Bolsista", "Estagiário"],
        ["Analista", "PJ"],
      ],
    );
  });

  it("a coluna da referência na aba Quadro de Lotação (11/11/2026): depois do Centro de Custo, não se importa", () => {
    const meses = ["JAN/26", "FEV/26", "MAR/26", "ABR/26", "MAI/26", "JUN/26", "JUL/26", "AGO/26", "SET/26", "OUT/26", "NOV/26", "DEZ/26"];
    const linhas = [{ id: "6f1c3f5e-0000-4000-8000-000000000001", unidade: "Matriz", tipo: "CLT", funcao: "Analista", centro: "1.01 - BPM", meses: doze(2, 1_500), referencia: 3 }];
    const aba = abaDoQuadroDeLotacao(linhas, meses, "teste", { unidades: ["Matriz"] }, { rotulo: "QL Realizado (11/2026)", explicacao: "traz o realizado" });
    assert.deepEqual([aba.linhas[4][4].valor, aba.linhas[5][4].valor, aba.linhas[4][5].valor], ["QL Realizado (11/2026)", 3, "JAN/26 · Colaboradores"]);
    const [lido] = lerArquivoDePremissas("premissas.xlsx", gerarXlsx([aba], "teste"));
    assert.deepEqual(lido.erros, []);
    assert.deepEqual(lido.quadro[0].meses, doze(2, 1_500).map((m) => ({ ...m, beneficiosDigitados: null })));
  });
});
