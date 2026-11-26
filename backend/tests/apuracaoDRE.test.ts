import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "../src/generated/prisma/client.js";
import { abasDaConta, abasQueSomam, apurarUnidades, combinacoesDaConta, type LinhaEstrutura } from "../src/services/dre/apuracaoUnidades.js";
import { apurarCentros, consolidar } from "../src/services/dre/consolidacao.js";
import { avaliarExpressao } from "../src/services/dre/expressao.js";
import { baseDoPercentual } from "../src/services/relatorios/basesResultados.js";

const D = (v: number) => new Prisma.Decimal(v);

describe("expressões da estrutura da DRE", () => {
  it("soma, subtrai, agrupa e aceita SUM(a, b)", () => {
    const v = new Map([["A", D(10)], ["B", D(3)], ["C", D(2)]]);
    const val = (c: string) => v.get(c) ?? D(0);
    assert.equal(avaliarExpressao("A + B - C", val).toString(), "11");
    assert.equal(avaliarExpressao("A-(B+C)", val).toString(), "5");
    assert.equal(avaliarExpressao("SUM(A,B)-C", val).toString(), "11");
    assert.throws(() => avaliarExpressao("A + ", val));
  });
});

describe("apuração da DRE por unidade", () => {
  const linha = (codigo: string, grupo: string, grupoSigla: string, atribuicao: string, descricao: string, unidades: number[], tipo: LinhaEstrutura["tipo"] = "ITEM", expressao: string | null = null): LinhaEstrutura => ({
    id: codigo, codigo, tipo, grupo, grupoSigla, atribuicao, descricao, expressao, unidades,
  });
  const linhas: LinhaEstrutura[] = [
    // O código como os da Estrutura da DRE (25/11/2026): a regra dos volumes acha a linha pela descrição de origem, no fim dele.
    linha("P.PRODUCAO_DO_PRE_FABRICADO_M", "PRODUÇÃO (P)", "P", "Produção do Pré-Fabricado (m³)", "Produção do Pré-Fabricado (m³)", [1, 2]),
    linha("CLT", "CUSTOS DE PRODUÇÃO (CP)", "CPP", "Mão de Obra Direta", "Remunerações CLT", [1, 2]),
    linha("DEP", "CUSTOS DE PRODUÇÃO (CP)", "CPP", "Depreciação", "Depreciação do Maquinário", [1, 2]),
    linha("D", "CUSTOS DE PRODUÇÃO (CP)", "CPP", "Depreciação", "Depreciação", [1, 2], "TOTAL", "DEP"),
    linha("CPP", "-", "CPP", "-", "CUSTOS DE PRODUÇÃO: PRÉ-FABRICADOS (CPP)", [1, 2], "SUBTOTAL", "CLT + D"),
  ];
  const base = {
    linhas,
    manuais: [],
    receitas: [],
    totais: new Map([["PREFABRICADO_MATRIZ", D(100)], ["PREFABRICADO_FILIAL", D(300)]]),
    percentuais: new Map([["PRODUCAO|MATRIZ", D(0.25)], ["PRODUCAO|FILIAL", D(0.75)]]),
  };

  it("custo da unidade: diretos do balde da unidade e do UNIDADE da filial + rateio × percentual; subtotal pela expressão", () => {
    const { resultados } = apurarUnidades({
      ...base,
      lancamentos: [
        { filial: 1, linhaDREId: "CLT", balde: "UNIDADE", alocacao: "DIRETO", valor: D(1000) },
        { filial: 2, linhaDREId: "CLT", balde: "UNIDADE", alocacao: "DIRETO", valor: D(500) },
        { filial: 1, linhaDREId: "CLT", balde: "PRODUCAO", alocacao: "RATEIO", valor: D(400) },
        { filial: 2, linhaDREId: "DEP", balde: "UNIDADE", alocacao: "DIRETO", valor: D(80) },
        // Os baldes MATRIZ e FILIAL forçam o gasto para a unidade, de qualquer filial.
        { filial: 2, linhaDREId: "CLT", balde: "MATRIZ", alocacao: "DIRETO", valor: D(50) },
        { filial: 1, linhaDREId: "CLT", balde: "FILIAL", alocacao: "DIRETO", valor: D(20) },
        // DESPESAS não entra nos custos da unidade.
        { filial: 1, linhaDREId: "CLT", balde: "DESPESAS", alocacao: "DIRETO", valor: D(7) },
      ],
    });
    const v = (u: number, c: string) => resultados.find((r) => r.unidade === u && r.codigo === c)?.valor.toString();
    assert.equal(v(1, "CLT"), "1150"); // 1.000 + 50 (MATRIZ da filial 2) + 400 × 25%
    assert.equal(v(2, "CLT"), "820"); // 500 + 20 (FILIAL da filial 1) + 400 × 75%
    assert.equal(v(2, "CPP"), "900"); // inclui a depreciação
    assert.equal(v(1, "P.PRODUCAO_DO_PRE_FABRICADO_M"), "100");
    // A composição guarda a origem que o detalhamento usa: os pares de balde e filial e o rateio na linha de base.
    const c = resultados.find((r) => r.unidade === 2 && r.codigo === "CLT")?.composicao;
    assert.deepEqual(c?.origem?.contabil, { linhaId: "CLT", pares: [{ balde: "FILIAL" }, { balde: "UNIDADE", filial: 2 }] });
    assert.deepEqual(c?.rateios?.map((r) => [r.chave, r.linhaId, r.valor]), [["PRODUCAO", "CLT", "300.00"]]);
  });

  // Sem a guarda IF(B$4=0,0,…) da planilha (13/10/2026): o mês sem produção mostra os custos que teve.
  it("sem produção na unidade, os custos dela continuam (a guarda da planilha não vale na ferramenta)", () => {
    const { resultados } = apurarUnidades({
      ...base,
      totais: new Map([["PREFABRICADO_MATRIZ", D(0)], ["PREFABRICADO_FILIAL", D(300)]]),
      lancamentos: [{ filial: 1, linhaDREId: "CLT", balde: "UNIDADE", alocacao: "DIRETO", valor: D(1000) }],
    });
    assert.equal(resultados.find((r) => r.unidade === 1 && r.codigo === "CLT")?.valor.toString(), "1000");
  });
});

describe("percentuais fixos em todos os destinos", () => {
  const linha = (codigo: string, grupo: string, grupoSigla: string, unidades: number[]): LinhaEstrutura => ({
    id: codigo, codigo, tipo: "ITEM", grupo, grupoSigla, atribuicao: "Mão de Obra Direta", descricao: "Remunerações CLT", expressao: null, unidades,
  });
  const linhas = [
    linha("CP.CLT", "CUSTOS DE PRODUÇÃO (CP)", "CPP", [1, 2]),
    linha("CSM.CLT", "CUSTOS DE SERVIÇOS: MONTAGEM (CSM)", "CSM", [3]),
    linha("CSC.CLT", "CUSTOS DE SERVIÇOS: COMPLEMENTARES (CSC)", "CSC", [3]),
  ];
  it("a Produção com percentual em Montagem e Complementar e o Acompanhamento na Matriz: nada se perde", () => {
    const { resultados } = apurarUnidades({
      linhas,
      manuais: [],
      receitas: [],
      totais: new Map(),
      percentuais: new Map([
        ["PRODUCAO|MATRIZ", D(0.5)], ["PRODUCAO|FILIAL", D(0.3)], ["PRODUCAO|MONTAGEM", D(0.15)], ["PRODUCAO|COMPLEMENTAR", D(0.05)],
        ["ACOMPANHAMENTO|MATRIZ", D(0.1)], ["ACOMPANHAMENTO|MONTAGEM", D(0.6)], ["ACOMPANHAMENTO|COMPLEMENTAR", D(0.3)],
      ]),
      lancamentos: [
        { filial: 1, linhaDREId: "CP.CLT", balde: "PRODUCAO", alocacao: "RATEIO", valor: D(1000) },
        { filial: 1, linhaDREId: "CSM.CLT", balde: "ACOMPANHAMENTO", alocacao: "RATEIO", valor: D(200) },
      ],
    });
    const v = (u: number, c: string) => Number(resultados.find((r) => r.unidade === u && r.codigo === c)?.valor ?? 0);
    assert.equal(v(1, "CP.CLT"), 520); // 1.000 × 50% + 200 × 10%
    assert.equal(v(2, "CP.CLT"), 300); // 1.000 × 30%
    assert.equal(v(3, "CSM.CLT"), 270); // 1.000 × 15% + 200 × 60%
    assert.equal(v(3, "CSC.CLT"), 110); // 1.000 × 5% + 200 × 30%
    assert.equal(v(1, "CP.CLT") + v(2, "CP.CLT") + v(3, "CSM.CLT") + v(3, "CSC.CLT"), 1200);
  });

  // Os lançamentos das contestações de competências fechadas (30/10/2026): o estorno e o novo com rateio se dividem pelos
  // percentuais da competência do movimento, numa parcela à parte.
  describe("os percentuais da competência do movimento contestado", () => {
    const base = { linhas, receitas: [], totais: new Map(), percentuais: new Map([["METALURGIA|MATRIZ", D(0.8)], ["METALURGIA|FILIAL", D(0.2)]]) };
    const setembro = new Map([["set", { rotulo: "09/2026", percentuais: new Map([["METALURGIA|MATRIZ", D(0.6)], ["METALURGIA|FILIAL", D(0.4)]]) }]]);
    const v = (r: ReturnType<typeof apurarUnidades>, u: number, c: string) => Number(r.resultados.find((x) => x.unidade === u && x.codigo === c)?.valor ?? 0);

    it("o estorno da Metalurgia sai com os percentuais de setembro, e o mês continua com os dele", () => {
      const r = apurarUnidades({
        ...base,
        percentuaisDe: setembro,
        lancamentos: [{ filial: 1, linhaDREId: "CP.CLT", balde: "METALURGIA", alocacao: "RATEIO", valor: D(5000) }],
        manuais: [
          { linhaDREId: "CP.CLT", balde: "METALURGIA", valor: D(-10000), filial: 1, rateioDe: "set" },
          { linhaDREId: "CP.CLT", balde: "MATRIZ", valor: D(10000), filial: 1, rateioDe: "set" },
        ],
      });
      assert.equal(v(r, 1, "CP.CLT"), 8000); // 5.000 × 80% − 10.000 × 60% + 10.000 direto
      assert.equal(v(r, 2, "CP.CLT"), -3000); // 5.000 × 20% − 10.000 × 40%: a Filial devolve o que recebeu em setembro
      const c = r.resultados.find((x) => x.unidade === 1 && x.codigo === "CP.CLT")?.composicao;
      assert.deepEqual(c?.rateios?.map((p) => [p.chave, p.competencia ?? null, p.competenciaId ?? null, p.valor]), [
        ["METALURGIA", null, null, "4000.00"],
        ["METALURGIA", "09/2026", "set", "-6000.00"],
      ]);
    });

    it("uma chave com percentual fixo em Serviços só na competência do movimento vai para Serviços com ele", () => {
      const r = apurarUnidades({
        ...base,
        percentuais: new Map([["PRODUCAO|MATRIZ", D(0.6)], ["PRODUCAO|FILIAL", D(0.4)]]),
        percentuaisDe: new Map([["set", { rotulo: "09/2026", percentuais: new Map([["PRODUCAO|MATRIZ", D(0.5)], ["PRODUCAO|FILIAL", D(0.3)], ["PRODUCAO|MONTAGEM", D(0.2)]]) }]]),
        lancamentos: [],
        manuais: [{ linhaDREId: "CP.CLT", balde: "PRODUCAO", valor: D(-1000), filial: 1, rateioDe: "set" }],
      });
      assert.equal(v(r, 1, "CP.CLT"), -500);
      assert.equal(v(r, 2, "CP.CLT"), -300);
      assert.equal(v(r, 3, "CSM.CLT"), -200);
    });

    it("sem volume na competência do movimento, o aviso diz qual; sem os percentuais dela, valem os do mês", () => {
      const semVolume = apurarUnidades({
        ...base,
        percentuaisDe: new Map([["set", { rotulo: "09/2026", percentuais: new Map() }]]),
        lancamentos: [],
        manuais: [{ linhaDREId: "CP.CLT", balde: "METALURGIA", valor: D(-100), filial: 1, rateioDe: "set" }],
      });
      assert.equal(v(semVolume, 1, "CP.CLT"), 0);
      assert.ok(semVolume.avisos.some((a) => a.includes("Rateio de Metalurgia sem volume em 09/2026: -100.00")));
      const semOrigem = apurarUnidades({ ...base, lancamentos: [], manuais: [{ linhaDREId: "CP.CLT", balde: "METALURGIA", valor: D(-100), filial: 1, rateioDe: "out" }] });
      assert.equal(v(semOrigem, 1, "CP.CLT"), -80);
    });
  });
});

describe("consolidação e visão por centro de custo", () => {
  const linha = (codigo: string, tipo: LinhaEstrutura["tipo"], expressao: string | null = null): LinhaEstrutura => ({
    id: `id-${codigo}`, codigo, tipo, grupo: "G", grupoSigla: "G", atribuicao: "A", descricao: codigo, expressao, unidades: [],
  });
  const linhas = [
    linha("ROB", "SUBTOTAL", "RB"),
    linha("RB", "ITEM"),
    linha("IO", "TOTAL", "ROB-ROL"),
    linha("ROL", "SUBTOTAL", "RL"),
    linha("RL", "ITEM"),
    linha("CPP", "SUBTOTAL", "CLT + DEP"),
    linha("CLT", "ITEM"),
    linha("DEP", "ITEM"),
    linha("MB", "TOTAL", "ROL-CPP"),
  ];
  const r = (unidade: number, codigo: string, v: number, tipo = "ITEM") => ({ unidade, linhaId: `id-${codigo}`, codigo, valor: D(v), composicao: tipo === "ITEM" ? { regra: "x" } : null });

  it("consolidado: itens somados entre as unidades, subtotais e impostos pela estrutura", () => {
    const c = consolidar(linhas, [r(1, "RB", 100), r(2, "RB", 50), r(1, "RL", 90), r(2, "RL", 45), r(1, "IO", 999, "TOTAL"), r(1, "CLT", 30), r(2, "CLT", 20)]);
    const v = (codigo: string) => c.find((x) => x.codigo === codigo)?.valor.toString();
    assert.equal(v("RB"), "150");
    assert.equal(v("IO"), "15"); // ROB − ROL, não a soma das unidades
    assert.equal(v("CPP"), "50");
    assert.equal(v("MB"), "85");
    assert.deepEqual(c.find((x) => x.codigo === "CLT")?.composicao?.unidades?.map((p) => p.valor), ["30.00", "20.00"]);
    assert.equal(v("DEP"), undefined); // item sem valor em nenhuma unidade não entra
  });

  it("centro de custo: lançamentos por linha e só os agregadores que somam", () => {
    const c = apurarCentros(linhas, [
      { centroCustoId: "A", linhaDREId: "id-CLT", valor: D(10) },
      { centroCustoId: "A", linhaDREId: "id-CLT", valor: D(5) },
      { centroCustoId: "A", linhaDREId: "id-DEP", valor: D(2) },
      { centroCustoId: "B", linhaDREId: "id-CLT", valor: D(7) },
      { centroCustoId: null, linhaDREId: "id-CLT", valor: D(100) },
    ]);
    const v = (centro: string, codigo: string) => c.find((x) => x.centroCustoId === centro && x.codigo === codigo)?.valor.toString();
    assert.equal(v("A", "CLT"), "15");
    assert.equal(v("A", "CPP"), "17");
    assert.equal(v("B", "CPP"), "7");
    assert.equal(v("A", "MB"), undefined); // margem (com subtração) fica de fora
    assert.equal(c.filter((x) => x.centroCustoId === null).length, 0);
  });
});

describe("lançamentos manuais em todas as abas e a Montagem do balde Complementar (21/10/2026)", () => {
  const linha = (codigo: string, grupo: string, grupoSigla: string, atribuicao: string, descricao: string, unidades: number[]): LinhaEstrutura => ({
    id: codigo, codigo, tipo: "ITEM", grupo, grupoSigla, atribuicao, descricao, expressao: null, unidades,
  });
  const linhas = [
    linha("CP.CLT", "CUSTOS DE PRODUÇÃO (CP)", "CPP", "Mão de Obra Direta", "Remunerações CLT", [1, 2]),
    linha("CSM.PJ", "CUSTOS DE SERVIÇOS: MONTAGEM (CSM)", "CSM", "Mão de Obra Indireta", "Remunerações PJ", [3]),
    linha("CSC.PJ", "CUSTOS DE SERVIÇOS: COMPLEMENTARES (CSC)", "CSC", "Mão de Obra Indireta", "Remunerações PJ", [3]),
    linha("CSM.SO", "CUSTOS DE SERVIÇOS: MONTAGEM (CSM)", "CSM", "Mão de Obra Indireta", "Só na Montagem", [3]),
    linha("RFNC", "RECEITAS FINANCERIAS NÃO CORRENTES (RFNC) (+)", "RFNC", "Receitas Financeiras Não Correntes (+)", "Receitas Financeiras Não Correntes", [4]),
    linha("IRCS", "DEDUÇÕES DA MARGEM LÍQUIDA (DML)", "DML", "Imposto de Renda e Contribuição Social", "Imposto de Renda e Contribuição Social", [4, 5]),
  ];
  const base = { linhas, receitas: [], totais: new Map(), percentuais: new Map() };
  const v = (r: ReturnType<typeof apurarUnidades>["resultados"], u: number, c: string) => Number(r.find((x) => x.unidade === u && x.codigo === c)?.valor ?? 0);

  it("o manual entra na aba do balde, no sinal da DRE: zera a receita do balancete; o do balde RN só na RN", () => {
    const { resultados, avisos } = apurarUnidades({
      ...base,
      lancamentos: [{ filial: 1, linhaDREId: "RFNC", balde: "EXTRA", alocacao: "DIRETO", valor: D(-150000) }],
      manuais: [
        { linhaDREId: "RFNC", balde: "EXTRA", valor: D(-150000), filial: 1 },
        { linhaDREId: "CP.CLT", balde: "UNIDADE", valor: D(300), filial: 2 },
        { linhaDREId: "IRCS", balde: "RN", valor: D(50), filial: 1 },
      ],
    });
    assert.ok(v(resultados, 4, "RFNC") === 0); // 150.000 do balancete − 150.000 do manual (o zero pode vir com sinal)
    assert.equal(v(resultados, 2, "CP.CLT"), 300);
    assert.equal(v(resultados, 1, "CP.CLT"), 0);
    assert.equal(v(resultados, 5, "IRCS"), 50);
    assert.equal(v(resultados, 4, "IRCS"), 0); // o do balde RN não entra em Despesas e Extra
    assert.equal(avisos.length, 0);
  });

  it("os Complementares somam a Montagem do balde COMPLEMENTAR na linha equivalente; sem ela, fica fora e o manual avisa", () => {
    const { resultados, avisos } = apurarUnidades({
      ...base,
      lancamentos: [
        { filial: 1, linhaDREId: "CSM.PJ", balde: "COMPLEMENTAR", alocacao: "DIRETO", valor: D(23664.16) },
        { filial: 1, linhaDREId: "CSM.PJ", balde: "OBRAS", alocacao: "DIRETO", valor: D(1000) },
        { filial: 1, linhaDREId: "CSC.PJ", balde: "COMPLEMENTAR", alocacao: "DIRETO", valor: D(10) },
      ],
      manuais: [{ linhaDREId: "CSM.SO", balde: "COMPLEMENTAR", valor: D(5), filial: 1 }],
    });
    assert.equal(v(resultados, 3, "CSC.PJ"), 23674.16);
    assert.equal(v(resultados, 3, "CSM.PJ"), 1000);
    const c = resultados.find((x) => x.unidade === 3 && x.codigo === "CSC.PJ")?.composicao;
    assert.deepEqual(c?.origem?.contabilPar, { linhaId: "CSM.PJ", baldes: ["COMPLEMENTAR"] });
    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /Só na Montagem/);
  });

  it("as abas que somam cada lançamento (a pendência Sem Aba de Resultado da Classificação)", () => {
    const porCodigo = new Map(linhas.map((l) => [l.codigo, l]));
    const abas = (c: string, balde: string, filial = 1, extra: { rateio?: boolean; manual?: boolean; parNaComplementar?: boolean } = {}) =>
      abasQueSomam(porCodigo.get(c)!, { filial, balde, rateio: false, ...extra });
    assert.deepEqual(abas("CSM.PJ", "COMPLEMENTAR"), []); // sem a linha equivalente informada
    assert.deepEqual(abas("CSM.PJ", "COMPLEMENTAR", 1, { parNaComplementar: true }), [3]);
    assert.deepEqual(abas("CSM.PJ", "OBRAS"), [3]);
    assert.deepEqual(abas("CP.CLT", "UNIDADE", 2), [2]);
    assert.deepEqual(abas("CP.CLT", "DESPESAS"), []);
    assert.deepEqual(abas("CP.CLT", "PRODUCAO", 1, { rateio: true }), [1, 2]);
    assert.deepEqual(abas("IRCS", "RN", 1, { manual: true }), [5]);
    assert.deepEqual(abas("IRCS", "EXTRA"), [4]);
  });

  it("a conta que nenhuma aba lê e as combinações permitidas (o cadastro da conta, 24/10/2026)", () => {
    const porCodigo = new Map(linhas.map((l) => [l.codigo, l]));
    const conta = (c: string, balde: string) => abasDaConta(porCodigo.get(c)!, balde, linhas);
    // As ferragens de 23/10/2026: uma linha da Montagem com o rateio MATRIZ — a Matriz não tem a linha, e Serviços não lê o balde.
    assert.deepEqual(conta("CSM.PJ", "MATRIZ"), [[], []]);
    assert.deepEqual(conta("CSM.PJ", "OBRAS"), [[3], [3]]);
    assert.deepEqual(conta("CSM.PJ", "COMPLEMENTAR"), [[3], [3]]); // tem a equivalente nos Complementares
    assert.deepEqual(conta("CSM.SO", "COMPLEMENTAR"), [[], []]); // não tem
    assert.deepEqual(conta("CP.CLT", "UNIDADE"), [[1], [2]]); // a aba da filial do lançamento
    assert.deepEqual(conta("CP.CLT", "PRODUCAO"), [[1, 2], [1, 2]]);
    const baldes = ["UNIDADE", "PRODUCAO", "ACOMPANHAMENTO", "MATRIZ", "FILIAL", "OBRAS", "COMPLEMENTAR", "DESPESAS"];
    const permitidas = (c: string) => combinacoesDaConta(porCodigo.get(c)!, linhas, baldes).map((x) => `${x.linha.codigo}:${x.balde}`);
    // A própria linha primeiro, depois a de mesma atribuição e descrição nos Complementares.
    assert.deepEqual(permitidas("CSM.PJ"), ["CSM.PJ:ACOMPANHAMENTO", "CSM.PJ:OBRAS", "CSM.PJ:COMPLEMENTAR", "CSC.PJ:COMPLEMENTAR"]);
    assert.deepEqual(permitidas("CP.CLT"), ["CP.CLT:UNIDADE", "CP.CLT:PRODUCAO", "CP.CLT:MATRIZ", "CP.CLT:FILIAL"]);
  });
});

describe("o frete dos complementares em Serviços (24/10/2026)", () => {
  const linha = (codigo: string, grupo: string, grupoSigla: string, descricao: string, unidades: number[]): LinhaEstrutura => ({
    id: codigo, codigo, tipo: "ITEM", grupo, grupoSigla, atribuicao: "Gastos Gerais Variáveis", descricao, expressao: null, unidades,
  });
  const frete = linha("DVV.GGV.FRETE_E_DESCARGA", "DESPESAS VARIÁVEIS DE VENDA (DVV)", "DVV", "Frete e Descarga", [1, 2, 3]);

  it("Serviços lê só o balde COMPLEMENTAR; a Matriz e a Filial, como antes", () => {
    const abas = (balde: string, filial = 1) => abasQueSomam(frete, { filial, balde, rateio: false });
    assert.deepEqual(abas("COMPLEMENTAR"), [3]);
    assert.deepEqual(abas("OBRAS"), []); // o frete da montagem não tem a linha
    assert.deepEqual(abas("MATRIZ"), [1]);
    assert.deepEqual(abas("UNIDADE", 2), [2]);
    const { resultados } = apurarUnidades({
      linhas: [frete], manuais: [], receitas: [], totais: new Map(), percentuais: new Map(),
      lancamentos: [
        { filial: 1, linhaDREId: frete.id, balde: "COMPLEMENTAR", alocacao: "DIRETO", valor: D(300) },
        { filial: 2, linhaDREId: frete.id, balde: "COMPLEMENTAR", alocacao: "DIRETO", valor: D(20) },
        { filial: 1, linhaDREId: frete.id, balde: "OBRAS", alocacao: "DIRETO", valor: D(7) },
        { filial: 1, linhaDREId: frete.id, balde: "MATRIZ", alocacao: "DIRETO", valor: D(1000) },
      ],
    });
    const v = (u: number) => resultados.find((r) => r.unidade === u && r.codigo === frete.codigo)?.valor.toString();
    assert.equal(v(3), "320");
    assert.equal(v(1), "1000");
    // O % em Serviços sobre a Receita Líquida Complementar; na Matriz, sobre a de frete.
    assert.equal(baseDoPercentual(3, frete), "ROL.RLC.RECEITA_LIQUIDA_COMPLEMENTAR");
    assert.equal(baseDoPercentual(1, frete), "ROL.RLF.RECEITA_LIQUIDA_DE_FRETE");
  });
});

describe("as Assessorias e Consultorias da DA no RN (26/11/2026)", () => {
  const linha = (codigo: string, tipo: LinhaEstrutura["tipo"], unidades: number[], expressao: string | null = null): LinhaEstrutura => ({
    id: codigo, codigo, tipo, grupo: "DESPESAS ADMINISTRATIVAS (DA)", grupoSigla: "DA", atribuicao: "Gastos Gerais Indiretos", descricao: codigo, expressao, unidades,
  });
  const DA = "DA.DESPESAS_ADMINISTRATIVAS_DA";
  const GGI = "DA.GGI.GASTOS_GERAIS_INDIRETOS";
  const ASSESSORIAS = "DA.GGI.ASSESSORIAS_E_CONSULTORIAS";
  const SEGURO = "DA.GGI.SEGURO_PATRIMONIAL";
  const linhas = [linha(DA, "SUBTOTAL", [4, 5], GGI), linha(GGI, "SUBTOTAL", [4, 5], `${ASSESSORIAS} + ${SEGURO}`), linha(ASSESSORIAS, "ITEM", [4, 5]), linha(SEGURO, "ITEM", [4])];
  const porCodigo = new Map(linhas.map((l) => [l.codigo, l]));

  it("o RN soma só os manuais do balde RN na conta; o balancete da DA continua em Despesas e Extra", () => {
    assert.deepEqual(abasQueSomam(porCodigo.get(ASSESSORIAS)!, { filial: 1, balde: "DESPESAS", rateio: false }), [4]);
    assert.deepEqual(abasQueSomam(porCodigo.get(ASSESSORIAS)!, { filial: 1, balde: "RN", rateio: false, manual: true }), [5]);
    // As outras contas da DA não estão no RN: o manual do balde RN nelas fica fora do resultado.
    assert.deepEqual(abasQueSomam(porCodigo.get(SEGURO)!, { filial: 1, balde: "RN", rateio: false, manual: true }), []);
    const { resultados } = apurarUnidades({
      linhas,
      receitas: [],
      totais: new Map(),
      percentuais: new Map(),
      lancamentos: [
        { filial: 1, linhaDREId: ASSESSORIAS, balde: "DESPESAS", alocacao: "DIRETO", valor: D(5000) },
        { filial: 1, linhaDREId: SEGURO, balde: "DESPESAS", alocacao: "DIRETO", valor: D(300) },
      ],
      manuais: [{ linhaDREId: ASSESSORIAS, balde: "RN", valor: D(900), filial: 1 }],
    });
    const v = (u: number, c: string) => resultados.find((r) => r.unidade === u && r.codigo === c)?.valor.toString();
    // No RN, o subtotal e o total da DA somam só a conta dele.
    assert.equal(v(5, ASSESSORIAS), "900");
    assert.equal(v(5, GGI), "900");
    assert.equal(v(5, DA), "900");
    assert.equal(v(4, ASSESSORIAS), "5000");
    assert.equal(v(4, DA), "5300");
    // O Consolidado soma as duas unidades.
    const c = new Map(consolidar(linhas, resultados).map((r) => [r.codigo, r.valor.toString()]));
    assert.equal(c.get(ASSESSORIAS), "5900");
    assert.equal(c.get(DA), "6200");
  });
});
