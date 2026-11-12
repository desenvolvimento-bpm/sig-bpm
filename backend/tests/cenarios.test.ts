import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LinhaPlanilha, ValorCelula } from "../src/lib/xlsx.js";
import { limiteDaLinha, mesesAcima, totaisDaDRE } from "../src/services/cenarios/comparativoCenario.js";
import { abaDaChave, abaDaPlanilha, abaDeInvestimentos, chaveDaDescricao, lerArquivoDePremissas, precisaJustificar, type LinhaDaPlanilha } from "../src/services/cenarios/planilhaPremissas.js";
import { gerarXlsx } from "../src/lib/xlsxEscrita.js";
import { classificar } from "../src/services/cenarios/indicadoresDoCenario.js";
import { acharAba, lerAbaDRE, lerAbaMetas } from "../src/services/cenarios/leituraCenario.js";
import { diasUteis, pascoa } from "../src/services/cenarios/calendario.js";
import { calcularTabela, linhasDaTabela } from "../src/services/cenarios/premissasCenario.js";
import { alocarCentros, contasDoGrupo, percentuaisDasBases, rateiosSemBase } from "../src/services/cenarios/centrosCenario.js";
import { dividirPorLinhas, linhaDaTarefa, mediaDosMeses, mediaNosMesesComOcorrencia, vendaDaObra } from "../src/services/cenarios/referenciaAnalitico.js";
import { quadroDoGrupo, quadrosDeLotacao } from "../src/services/cenarios/lotacaoCenario.js";
import { grupoDaLotacao } from "../src/services/listas/lotacaoDosCentros.js";
import { rateiosSemVolume } from "../src/services/dre/apuracaoUnidades.js";
import { calcularInvestimentosEExtra, depreciacaoMensal, depreciacaoNosMeses } from "../src/services/cenarios/investimentosCenario.js";
import { Prisma } from "../src/generated/prisma/client.js";
import { ESTRUTURA_INICIAL_INDICADORES } from "../src/services/relatorios/estruturaInicialIndicadores.js";

const planilha = (...linhas: ValorCelula[][]): LinhaPlanilha[] => linhas.map((celulas, i) => ({ numero: i + 1, celulas }));
const ESTRUTURA = [
  { id: "a", codigo: "RO", descricao: "RECEITA OPERACIONAL LÍQUIDA (ROL)" },
  { id: "b", codigo: "P.PISTAS", descricao: "Produção do Pré-Fabricado (pistas)" },
  { id: "c", codigo: "CPP.MOD", descricao: "Mão de Obra Direta" },
  { id: "d", codigo: "CSM.MOD", descricao: "Mão de Obra Direta" },
];

describe("leitura do cenário sintético", () => {
  it("acha as abas pelo nome, sem confundir com as (R) e (O)", () => {
    assert.equal(acharAba(["Consolidado (R)", "Desp. +Extra", "Extra RN"], ["Desp.+Extra"]), "Desp. +Extra");
    assert.equal(acharAba(["Consolidado (R)"], ["Consolidado"]), null);
  });

  it("liga as linhas da DRE pela descrição, na ordem, e lê os meses (a primeira coluna de cada mês)", () => {
    const aba = lerAbaDRE(
      0,
      "Consolidado",
      planilha(
        ["PROJEÇÃO: CONSOLIDADO", "JAN/26", "%", "FEV/26", "%", "FEV/26"],
        ["RECEITA OPERACIONAL LÍQUIDA (ROL)", 100, 1, 200, 1, 999],
        ["Produção do Pré-Fabricado (pst)", 5, "-", "-", "-", 0],
        ["Mão de Obra Direta", 10, 0.1, 20, 0.1, 0],
        ["Mão de Obra Direta", 30, 0.3, 40, 0.2, 0],
        ["DESPESAS + EXTRA OPERACIONAL (DEO)", 7, 0, 7, 0, 0],
        ["Linha Nova", 1, 0, 0, 0, 0],
      ),
      ESTRUTURA,
    );
    assert.ok(aba);
    assert.equal(aba.ano, 2026);
    assert.equal(aba.meses, 2);
    const v = (id: string, mes: number) => aba.valores.find((x) => x.linhaDREId === id && x.mes === mes)?.valor;
    assert.equal(v("a", 2), 200);
    assert.equal(v("b", 1), 5);
    assert.equal(v("b", 2), undefined);
    assert.equal(v("c", 1), 10);
    assert.equal(v("d", 2), 40);
    assert.deepEqual(aba.semPar, ["7: Linha Nova"]);
  });

  it("aba com o nome de uma unidade que não é DRE fica de fora", () => {
    assert.equal(lerAbaDRE(3, "Serviços", planilha(["GRUPO", "INDICADOR", "JAN/2026"], ["Serviços", "Rendimento: Montagem", 1]), ESTRUTURA), null);
  });

  it("lê as metas pelo nome do indicador, com o apelido do quadro de lotação", () => {
    const m = lerAbaMetas(
      "Metas",
      planilha(["GRUPO", "INDICADOR", "TIPO", "JAN/2026", "FEV/2026", "ACUM. (O)"], ["x", "Turnover", "↓", 0.02, 0.03, 0.05], ["x", "Quadro de Lotação", "=", 300, null, 300], ["x", "Outro", "=", 1, 1, 1]),
      ["Turnover", "Quadro de Lotação Total"],
    );
    assert.ok(m);
    assert.equal(m.ano, 2026);
    assert.deepEqual(m.valores, [
      { nome: "Turnover", mes: 1, valor: 0.02 },
      { nome: "Turnover", mes: 2, valor: 0.03 },
      { nome: "Quadro de Lotação Total", mes: 1, valor: 300 },
    ]);
    assert.deepEqual(m.ignorados, ["Outro"]);
  });

  it("classifica os indicadores: da DRE, manuais, calculados (eficiências) e importados", () => {
    const classe = new Map(ESTRUTURA_INICIAL_INDICADORES.map((i) => [i.nome, classificar(i)]));
    assert.equal(classe.get("Custos de Produção: Matriz (CPP)"), "RESULTADO");
    assert.equal(classe.get("Quadro de Lotação: MO Direta Matriz"), "MANUAL");
    assert.equal(classe.get("Venda: Total"), "MANUAL");
    assert.equal(classe.get("Eficiência da Produção: MO Direta Matriz"), "CALCULADO");
    assert.equal(classe.get("Eficiência da Operação: MO Geral Total"), "CALCULADO");
    assert.equal(classe.get("Liberação de Projetos: Total"), "IMPORTADO");
    assert.equal(classe.get("Atingimento da MC Acumulada"), "IMPORTADO");
    const contagem = [...classe.values()].reduce<Record<string, number>>((m, c) => ({ ...m, [c]: (m[c] ?? 0) + 1 }), {});
    assert.deepEqual(contagem, { RESULTADO: 53, MANUAL: 33, CALCULADO: 25, IMPORTADO: 7 });
  });

  it("a Metodologia com outros indicadores ([INDICADOR], 23/10/2026) é calculada no cenário; com Listas ou metas, importada", () => {
    const i = (formula: string) => classificar({ nome: "X", formula, peso: null, modo: "SOMA" });
    assert.equal(i("[INDICADOR|Venda: Total] * 2"), "CALCULADO");
    assert.equal(i("[INDICADOR|Venda: Total] / [DRE|0|MC.MARGEM_DE_CONTRIBUICAO_MC]"), "CALCULADO");
    assert.equal(i("[INDICADOR|Venda: Total] / [META|Venda: Total]"), "IMPORTADO");
    // A Fórmula do Acumulado (o modo FORMULA, gravada em peso) também conta.
    const f = (peso: string) => classificar({ nome: "X", formula: "[DRE|0|MC.MARGEM_DE_CONTRIBUICAO_MC]", peso, modo: "FORMULA" });
    assert.equal(f("[INDICADOR|Venda: Total|ACUM]"), "CALCULADO");
    assert.equal(f("[META|Venda: Total|ACUM]"), "IMPORTADO");
  });
});

describe("comparativo entre cenários", () => {
  const linha = (codigo: string, tipo: "SECAO" | "ITEM" | "SUBTOTAL" | "TOTAL", descricao = codigo) => ({ id: codigo, codigo, tipo, grupo: "", grupoSigla: "", atribuicao: null, descricao, expressao: null, unidades: [] });
  it("os totais são os do nível Totais; cada conta fica sob o último total; a PS entra com os volumes, e os totais que só somam outros saem (15/10/2026)", () => {
    const { totais, verificadas, linhas } = totaisDaDRE([
      linha("PS.PRODUCAO", "SECAO"),
      linha("P.PRODUCAO", "SECAO"),
      linha("P.PISTAS", "ITEM"),
      linha("RO.ROL", "TOTAL"),
      linha("ROB.ROB", "SUBTOTAL"),
      linha("ROB.RBPF", "ITEM"),
      linha("CPP.CPP", "SUBTOTAL"),
      linha("CPP.MOD.MAO", "SUBTOTAL"),
      linha("CPP.MOD.CLT", "ITEM"),
      linha("MB.MB", "TOTAL"),
    ]);
    assert.deepEqual(totais.map((t) => t.codigo), ["PS.PRODUCAO", "ROB.ROB", "CPP.CPP"]);
    assert.deepEqual(
      verificadas.map((v) => `${v.total.codigo}:${v.linha.codigo}`),
      ["PS.PRODUCAO:P.PISTAS", "ROB.ROB:ROB.RBPF", "CPP.CPP:CPP.MOD.CLT"],
    );
    // O volume fica sob a PS e a Produção (a variação de cada uma vale para ele).
    assert.deepEqual(linhas.find((l) => l.linha.codigo === "P.PISTAS")!.acima, ["PS.PRODUCAO", "P.PRODUCAO"]);
  });
  it("a planilha das premissas: Justificar? pelo total dos doze meses sobre o Total da Referência (15/10/2026), a aba de cada código e a leitura do que se exportou", () => {
    const meses = Array<number | null>(12).fill(null);
    // Total da Referência 1.200: 1.300 (8,33%) cabe nos 10%; 1.330 (10,83%) passa; um mês alto não basta mais.
    assert.equal(precisaJustificar({ limite: 10, media: 100, meses: [200, ...Array(11).fill(100)] }), false);
    assert.equal(precisaJustificar({ limite: 10, media: 100, meses: [230, ...Array(11).fill(100)] }), true);
    // Os meses em branco valem zero: só dois meses preenchidos ficam muito abaixo do total.
    assert.equal(precisaJustificar({ limite: 10, media: 100, meses: [105, 95, ...meses.slice(2)] }), true);
    // Com a referência zero, Sim quando o total não é zero.
    assert.equal(precisaJustificar({ limite: 10, media: 0, meses: [...meses] }), false);
    assert.equal(precisaJustificar({ limite: 10, media: 0, meses: [1, ...meses.slice(1)] }), true);
    assert.equal(precisaJustificar({ limite: null, media: 100, meses: [500, ...meses.slice(1)] }), false);
    assert.equal(precisaJustificar({ limite: 10, media: null, meses: [500, ...meses.slice(1)] }), false);
    assert.equal(abaDaChave("P|2|GLOBAL|DEMANDA:X"), "2");
    assert.equal(abaDaChave("C|PCP (CRI)|CPP.MOI.REMUNERACOES_CLT"), "centros");
    assert.equal(abaDaChave("L|PCP (CRI)"), "centros");
    assert.equal(abaDaChave("I|Venda: Global"), "manuais");
    assert.equal(abaDaChave("Z|x"), null);
    const linhas: LinhaDaPlanilha[] = [
      { aba: "centros", chave: "C|ESTRUTURA|CPP.MOD.REMUNERACOES_CLT", descricao: ["ESTRUTURA", "Mão de Obra Direta", "Remunerações CLT"], und: "R$", conta: "CPP.MOD.REMUNERACOES_CLT", limite: 5, media: 1000, meses: [1000, 1200, ...meses.slice(2)], justificativa: "Dissídio" },
      { aba: "centros", chave: "L|ESTRUTURA", descricao: ["ESTRUTURA", "Quadro de Lotação", "Colaboradores"], und: "colab.", conta: null, limite: null, media: 44, meses: Array(12).fill(44), justificativa: null },
    ];
    const xlsx = gerarXlsx([abaDaPlanilha("Centros de Custo", "centros", linhas, Array.from({ length: 12 }, (_, k) => `M${k + 1}`), "teste")]);
    const [lido] = lerArquivoDePremissas("p.xlsx", xlsx);
    assert.deepEqual(lido.erros, []);
    // 11/11/2026: sem a coluna Código, a linha pela aba e pelas descrições.
    assert.deepEqual(lido.linhas.map((l) => [l.chave, l.doTipo && chaveDaDescricao(l.doTipo, l.descricao), l.meses[0], l.meses[1], l.meses[2], l.justificativa]), [
      [null, "centros|ESTRUTURA › Mão de Obra Direta › Remunerações CLT", 1000, 1200, null, "Dissídio"],
      [null, "centros|ESTRUTURA › Quadro de Lotação › Colaboradores", 44, 44, 44, null],
    ]);
    // As abas das unidades (os mesmos rótulos) pelo título; os arquivos de antes, com o Código, pela chave.
    const unidade: LinhaDaPlanilha = { aba: "2", chave: "P|2|GLOBAL|DEMANDA:X", descricao: ["Global", "Produção", "Estrutura (m³)", "Demanda Diária"], und: "m³/dia", conta: null, limite: null, media: 10, meses: Array(12).fill(10), justificativa: null };
    const [daFilial] = lerArquivoDePremissas("f.xlsx", gerarXlsx([abaDaPlanilha("Filial", "2", [unidade], Array.from({ length: 12 }, (_, k) => `M${k + 1}`), "teste")]));
    assert.deepEqual([daFilial.linhas[0].doTipo, daFilial.linhas[0].chave], ["2", null]);
    const antiga = abaDaPlanilha("Filial", "2", [unidade], Array.from({ length: 12 }, (_, k) => `M${k + 1}`), "teste");
    antiga.linhas[4].unshift({ valor: "Código (não altere)" });
    antiga.linhas[5].unshift({ valor: unidade.chave });
    const [daAntiga] = lerArquivoDePremissas("a.xlsx", gerarXlsx([antiga]));
    assert.deepEqual([daAntiga.erros, daAntiga.linhas[0].chave, daAntiga.linhas[0].meses[0]], [[], "P|2|GLOBAL|DEMANDA:X", 10]);
    assert.match(lerArquivoDePremissas("x.xlsx", gerarXlsx([{ nome: "Outra", larguras: [10], linhas: [[{ valor: "a" }]] }]))[0].erros[0], /não está no padrão/);
  });
  it("os meses da referência (11/11/2026): doze colunas antes da Média de Referência, que não se importam; as fórmulas acompanham", () => {
    const meses = Array.from({ length: 12 }, (_, k) => `M${k + 1}`);
    const linhas: LinhaDaPlanilha[] = [
      { aba: "centros", chave: "C|ESTRUTURA|X", descricao: ["ESTRUTURA", "Mão de Obra Direta", "Remunerações CLT"], und: "R$", conta: "X", limite: 5, media: 1000, meses: [1000, 1200, ...Array(10).fill(null)], justificativa: "Dissídio", referencia: [900, 950, ...Array(10).fill(null)] },
    ];
    const aba = abaDaPlanilha("Centros de Custo", "centros", linhas, meses, "teste", { rotulo: "Realizado", meses: meses.map((m) => `R${m}`), descricao: "o realizado" });
    const cab = aba.linhas[4].map((c) => c.valor);
    // As três descrições (11/11/2026: sem o Código antes), a Und. e os doze da referência; depois a Média (Q).
    assert.equal(cab[4], "Realizado · RM1");
    assert.equal(cab[16], "Média de Referência");
    assert.deepEqual([aba.linhas[5][4].valor, aba.linhas[5][5].valor, aba.linhas[5][16].valor, aba.linhas[5][19].valor], [900, 950, 1000, 1000]);
    // O Total da Referência e o Justificar? apontam para as colunas deslocadas.
    assert.equal(aba.linhas[5][17].formula, "IF(Q6=\"\",\"\",Q6*12)");
    assert.ok(String(aba.linhas[5][31].formula).includes("SUM(T6:AE6)"));
    const [lido] = lerArquivoDePremissas("p.xlsx", gerarXlsx([aba]));
    assert.deepEqual(lido.erros, []);
    assert.deepEqual(lido.linhas.map((l) => [l.doTipo && chaveDaDescricao(l.doTipo, l.descricao), l.meses[0], l.meses[1], l.justificativa]), [["centros|ESTRUTURA › Mão de Obra Direta › Remunerações CLT", 1000, 1200, "Dissídio"]]);
  });
  it("a aba Investimentos (15/10/2026): a lista volta igual; o Nome de Referência obrigatório e sem repetir; a conta tem de ser a da unidade", () => {
    const inv = { id: "abc", nomeReferencia: "Notebooks 2026", unidade: 4, descricao: "Notebooks", condicaoPagamento: "Entrada + 10x", inicio: 3, valorTotal: 12000, valorPosUso: 2000, vidaUtil: 24 };
    const aba = abaDeInvestimentos([inv], "teste");
    // A linha nova (a primeira em branco), uma com a conta de outra unidade, uma sem nome e uma com o nome repetido.
    aba.linhas[6] = [{ valor: "Ponte 2026" }, { valor: "Matriz" }, { valor: null }, { valor: "Ponte rolante" }, { valor: null }, { valor: 5 }, { valor: 80000 }, { valor: null }, { valor: 120 }];
    aba.linhas[7] = [{ valor: "Caminhão" }, { valor: "Serviços" }, { valor: "Depreciação do Patrimônio" }, { valor: "Caminhão" }, { valor: null }, { valor: 1 }, { valor: 300000 }, { valor: 0 }, { valor: 60 }];
    aba.linhas[8] = [{ valor: null }, { valor: "Matriz" }, { valor: null }, { valor: "Sem nome" }, { valor: null }, { valor: 1 }, { valor: 10 }, { valor: 0 }, { valor: 6 }];
    aba.linhas[9] = [{ valor: "notebooks 2026" }, { valor: "Matriz" }, { valor: null }, { valor: "Repetido" }, { valor: null }, { valor: 1 }, { valor: 10 }, { valor: 0 }, { valor: 6 }];
    const [lido] = lerArquivoDePremissas("i.xlsx", gerarXlsx([aba]));
    assert.deepEqual(
      lido.investimentos.map(({ aba: _a, numero: _n, ...i }) => i),
      [
        { nomeReferencia: "Notebooks 2026", unidade: 4, descricao: "Notebooks", condicaoPagamento: "Entrada + 10x", inicio: 3, valorTotal: 12000, valorPosUso: 2000, vidaUtil: 24 },
        { nomeReferencia: "Ponte 2026", unidade: 1, descricao: "Ponte rolante", condicaoPagamento: null, inicio: 5, valorTotal: 80000, valorPosUso: 0, vidaUtil: 120 },
      ],
    );
    assert.equal(lido.erros.length, 3);
    assert.match(lido.erros[0], /Conta de Serviços é a Depreciação do Maquinário de Serviços/);
    assert.match(lido.erros[1], /dê um Nome de Referência/);
    assert.match(lido.erros[2], /se repete na aba/);
    // A fórmula da Depreciação Mensal, com o valor calculado (19/10/2026: sem o ROI).
    assert.equal(aba.linhas[5][9].valor, 416.67);
    assert.equal(aba.linhas[5][9].formula, 'IF(OR(G6="",I6="",I6=0),"",(G6-IF(H6="",0,H6))/I6)');
  });
  it("a média dos centros conta só os meses com movimentação de cada grupo e conta", () => {
    const r = mediaNosMesesComOcorrencia(
      [
        { grupo: "A", codigo: "X", mes: 1, valor: 100 },
        { grupo: "A", codigo: "X", mes: 3, valor: 200 },
        { grupo: "B", codigo: "X", mes: 2, valor: 60 },
        { grupo: "B", codigo: "Y", mes: 2, valor: 0 },
      ],
      (x) => `${x.grupo}|${x.codigo}`,
    );
    assert.equal(r.length, 24);
    assert.equal(r.find((x) => x.grupo === "A" && x.mes === 7)!.valor, 150);
    assert.equal(r.find((x) => x.grupo === "B" && x.mes === 12)!.valor, 60);
    assert.deepEqual(mediaDosMeses([0, 30, 0, 90, 0, 0, 0, 0, 0, 0, 0, 0]), Array(12).fill(60));
    assert.deepEqual(mediaDosMeses(Array(12).fill(0)), Array(12).fill(0));
  });
  it("a Variação Máxima na estrutura da DRE: sem a primeira ROL, com as atribuições e as contas; a variação do total vale para as contas", () => {
    const { linhas, verificadas } = totaisDaDRE([
      linha("RO.ROL", "TOTAL", "RECEITA OPERACIONAL LÍQUIDA (ROL)"),
      linha("ROB.ROB", "SUBTOTAL"),
      linha("ROB.RBPF", "ITEM"),
      linha("IRB.IRB", "TOTAL"),
      linha("IRB.IO.IMPOSTOS", "TOTAL"),
      linha("ROL.ROL", "SUBTOTAL", "RECEITA OPERACIONAL LÍQUIDA (ROL)"),
      linha("ROL.RLPF", "ITEM"),
      linha("CPP.CPP", "SUBTOTAL"),
      linha("CPP.MOD.MAO", "SUBTOTAL"),
      linha("CPP.MOD.CLT", "ITEM"),
    ]);
    assert.deepEqual(
      linhas.map((l) => `${l.linha.codigo}:${l.nivel}${l.folha ? "*" : ""}`),
      ["ROB.ROB:0", "ROB.RBPF:1*", "IRB.IRB:0", "IRB.IO.IMPOSTOS:1*", "ROL.ROL:0", "ROL.RLPF:1*", "CPP.CPP:0", "CPP.MOD.MAO:1", "CPP.MOD.CLT:2*"],
    );
    assert.deepEqual(verificadas.map((v) => `${v.total.codigo}:${v.linha.codigo}`), ["ROB.ROB:ROB.RBPF", "IRB.IRB:IRB.IO.IMPOSTOS", "ROL.ROL:ROL.RLPF", "CPP.CPP:CPP.MOD.CLT"]);
    const clt = linhas.find((l) => l.linha.codigo === "CPP.MOD.CLT")!;
    assert.deepEqual(clt.acima, ["CPP.CPP", "CPP.MOD.MAO"]);
    // A da conta; sem ela, a da atribuição; sem ela, a do total (as gravadas por total, antes de 14/10/2026).
    assert.equal(limiteDaLinha({ "CPP.CPP": 10, "CPP.MOD.MAO": 5, "CPP.MOD.CLT": 2 }, "CPP.MOD.CLT", clt.acima), 2);
    assert.equal(limiteDaLinha({ "CPP.CPP": 10, "CPP.MOD.MAO": 5 }, "CPP.MOD.CLT", clt.acima), 5);
    assert.equal(limiteDaLinha({ "CPP.CPP": 10 }, "CPP.MOD.CLT", clt.acima), 10);
    assert.equal(limiteDaLinha({}, "CPP.MOD.CLT", clt.acima), null);
  });
  it("os meses acima da variação máxima, para mais ou para menos; sem base quando o comparado é zero", () => {
    const valores = new Map([[1, 110], [2, 89], [3, 50], [4, 100]]);
    const comparados = new Map([[1, 100], [2, 100], [4, 100]]);
    assert.deepEqual(mesesAcima(valores, comparados, 10), [
      { mes: 2, valor: 89, comparado: 100, variacao: -11 },
      { mes: 3, valor: 50, comparado: 0, variacao: null },
    ]);
    // O comparado negativo (um custo): a variação é sobre o valor absoluto.
    assert.equal(mesesAcima(new Map([[1, -130]]), new Map([[1, -100]]), 10)[0].variacao, -30);
    // Igual à máxima em duas casas não entra (5% sobre centavos dá 5,0000005%); 5,01% entra.
    assert.deepEqual(mesesAcima(new Map([[1, 168056.29]]), new Map([[1, 160053.6088]]), 5), []);
    assert.equal(mesesAcima(new Map([[1, 105.01]]), new Map([[1, 100]]), 5)[0].variacao, 5.01);
  });
});

describe("premissas dos cenários analíticos (13/10/2026)", () => {
  it("dias úteis: segunda a sexta menos os feriados nacionais (Carnaval e Corpus Christi contam)", () => {
    assert.equal(pascoa(2026).toISOString().slice(0, 10), "2026-04-05");
    assert.deepEqual(
      Array.from({ length: 12 }, (_, k) => diasUteis(2026, k + 1)),
      [21, 20, 22, 20, 20, 22, 23, 21, 21, 21, 19, 22],
    );
    assert.equal(diasUteis(2027, 12), 23);
  });

  const item = (codigo: string, unidades: number[]) => ({ id: codigo, codigo, tipo: "ITEM" as const, grupo: "", grupoSigla: codigo.split(".")[0], atribuicao: null, descricao: codigo, expressao: null, unidades });
  const EST = [
    item("ROB.RBPF.RECEITA_BRUTA_DO_PRE_FABRICADO", [1, 2]),
    item("ROB.RBF.RECEITA_BRUTA_DE_FRETE", [1, 2]),
    item("ROB.RBDI.RECEITA_BRUTA_DE_DEVOLUCOES_E_INVENTARIO", [1, 2]),
    item("CPP.MP.CIMENTO", [1, 2]),
    item("CPP.MOT.PROJETOS_TERCEIRIZADOS", [1, 2]),
    item("CPP.GGV.MADEIRAS", [1, 2]),
    item("CPP.MOD.REMUNERACOES_CLT", [1, 2]),
    item("DVV.GGV.FRETE_E_DESCARGA", [1, 2]),
    item("DVV.GGV.COMISSOES_DE_REPRESENTANTES_E_TERCEIROS", [1, 2, 3]),
  ];
  const ALVEOLARES = { codigo: "ALVEOLARES", nome: "Alveolares", unidade: 2 as const, medida: "m³ e pistas" };

  it("as linhas da tabela: a demanda em pistas e m³ por pista, as receitas (com as devoluções), os impostos, as contas de MP, MOT, GGV e DVV (sem a mão de obra própria)", () => {
    const linhas = linhasDaTabela(EST, [ALVEOLARES], 2);
    const chaves = linhas.map((l) => l.chave);
    for (const c of [
      "DIAS_UTEIS",
      "DEMANDA:ALVEOLARES",
      "M3_PISTA:ALVEOLARES",
      "VOLUME:ALVEOLARES",
      "ARMADURA:ALVEOLARES",
      "METALURGIA:ALVEOLARES",
      "RB:ALVEOLARES:ROB.RBDI.RECEITA_BRUTA_DE_DEVOLUCOES_E_INVENTARIO",
      "IMPOSTOS:ALVEOLARES",
      "CUSTO:ALVEOLARES:CPP.MP.CIMENTO",
      "CUSTO:ALVEOLARES:CPP.MOT.PROJETOS_TERCEIRIZADOS",
      "CUSTO:ALVEOLARES:CPP.GGV.MADEIRAS",
      "CUSTO:ALVEOLARES:DVV.GGV.FRETE_E_DESCARGA",
    ])
      assert.ok(chaves.includes(c), c);
    assert.ok(!chaves.some((c) => c.includes("CPP.MOD")));
    // Sem os Ajustes (15/10/2026): os totais saem só das médias e das demandas.
    assert.ok(!chaves.some((c) => c.startsWith("AJUSTE_")));
    // A armadura e a metalurgia em kg por unidade da linha (o m³ nas de pistas).
    assert.equal(linhas.find((l) => l.chave === "ARMADURA:ALVEOLARES")!.und, "kg/m³");
    // Só nas linhas que levam armadura e metalurgia: a Vedação não leva.
    const ved = linhasDaTabela(EST, [{ codigo: "VEDAÇÃO", nome: "Vedação", unidade: 3, medida: "m" }], 3).map((l) => l.chave);
    assert.ok(!ved.includes("ARMADURA:VEDAÇÃO") && !ved.includes("METALURGIA:VEDAÇÃO"));
  });

  it("calcula: pistas × dias, × m³ por pista; a líquida × (1 − impostos); os ajustes gravados antes de 15/10/2026 não entram", () => {
    const p: Record<string, number> = {
      "DEMANDA:ALVEOLARES": 4,
      "M3_PISTA:ALVEOLARES": 17.5,
      "RB:ALVEOLARES:ROB.RBPF.RECEITA_BRUTA_DO_PRE_FABRICADO": 1700,
      "IMPOSTOS:ALVEOLARES": 25,
      "CUSTO:ALVEOLARES:CPP.MP.CIMENTO": 300,
      AJUSTE_CUSTOS: 10,
    };
    const ler = (chave: string, mes: number) => (chave === "AJUSTE_RECEITA" && mes === 2 ? 5 : chave === "DIAS_UTEIS" && mes === 1 ? 10 : mes === 0 ? undefined : p[chave]);
    const { valores, dre } = calcularTabela(EST, [ALVEOLARES], 2, 2026, ler);
    // Janeiro: 10 dias úteis (digitados) × 4 pistas = 40 pistas × 17,5 = 700 m³.
    assert.equal(valores.get("VOLUME_PISTAS:ALVEOLARES")![0], 40);
    assert.equal(valores.get("VOLUME:ALVEOLARES")![0], 700);
    assert.equal(dre.get("P.PRODUCAO_DO_PRE_FABRICADO_PISTAS")![0], 40);
    assert.equal(dre.get("P.PRODUCAO_DO_PRE_FABRICADO_M")![0], 700);
    assert.equal(dre.get("ROB.RBPF.RECEITA_BRUTA_DO_PRE_FABRICADO")![0], 700 * 1700);
    assert.equal(dre.get("ROL.RLPF.RECEITA_LIQUIDA_DO_PRE_FABRICADO")![0], 700 * 1700 * 0.75);
    assert.equal(Math.round(dre.get("CPP.MP.CIMENTO")![0]), 700 * 300);
    // Fevereiro: os 20 dias do calendário; o ajuste de 5% na receita, ainda gravado, não entra.
    assert.equal(valores.get("DIAS_UTEIS")![1], 20);
    assert.equal(Math.round(dre.get("ROB.RBPF.RECEITA_BRUTA_DO_PRE_FABRICADO")![1]), Math.round(4 * 20 * 17.5 * 1700));
    assert.equal(valores.get("RL:ALVEOLARES")![0], 1700 * 0.75);
  });

  it("comissões (15/10/2026): o % sobre a receita bruta antes da conta, que se calcula dele; a MOT antes da MP", () => {
    const linhas = linhasDaTabela(EST, [ALVEOLARES], 2);
    const chaves = linhas.map((l) => l.chave);
    const conta = "CUSTO:ALVEOLARES:DVV.GGV.COMISSOES_DE_REPRESENTANTES_E_TERCEIROS";
    assert.equal(chaves.indexOf("COMISSOES:ALVEOLARES") + 1, chaves.indexOf(conta));
    assert.equal(linhas.find((l) => l.chave === "COMISSOES:ALVEOLARES")!.und, "%/ROB");
    assert.equal(linhas.find((l) => l.chave === conta)!.tipo, "CALCULO");
    assert.ok(chaves.indexOf("CUSTO:ALVEOLARES:CPP.MOT.PROJETOS_TERCEIRIZADOS") < chaves.indexOf("CUSTO:ALVEOLARES:CPP.MP.CIMENTO"));
    const p: Record<string, number> = {
      "DEMANDA:ALVEOLARES": 4,
      "M3_PISTA:ALVEOLARES": 17.5,
      "RB:ALVEOLARES:ROB.RBPF.RECEITA_BRUTA_DO_PRE_FABRICADO": 1700,
      "RB:ALVEOLARES:ROB.RBF.RECEITA_BRUTA_DE_FRETE": 100,
      "RB:ALVEOLARES:ROB.RBDI.RECEITA_BRUTA_DE_DEVOLUCOES_E_INVENTARIO": -50,
      "COMISSOES:ALVEOLARES": 2,
      // A conta gravada antes (R$ por unidade) não entra mais.
      [conta]: 999,
    };
    const ler = (chave: string, mes: number) => (chave === "DIAS_UTEIS" && mes === 1 ? 10 : p[chave]);
    const { valores, referencia, dre } = calcularTabela(EST, [ALVEOLARES], 2, 2026, ler);
    // A receita bruta média (1.750, com as devoluções) × 2% = 35 por m³; × 700 m³ em janeiro.
    assert.equal(valores.get(conta)![0], 35);
    assert.equal(referencia.get(conta), 35);
    assert.equal(Math.round(dre.get("DVV.GGV.COMISSOES_DE_REPRESENTANTES_E_TERCEIROS")![0]), 700 * 35);
  });

  it("as bases dos rateios: produção e projeto (só Global) pelo m³; armadura e metalurgia pelo volume × kg por unidade; acompanhamentos por dia × dias úteis", () => {
    const MONTAGEM = { codigo: "MONTAGEM", nome: "Montagem", unidade: 3 as const, medida: "m³" };
    const FUNDACAO = { codigo: "FUNDAÇÃO", nome: "Fundação", unidade: 3 as const, medida: "m³" };
    const p: Record<string, number> = {
      "DEMANDA:ALVEOLARES": 2,
      "M3_PISTA:ALVEOLARES": 10,
      "ARMADURA:ALVEOLARES": 50,
      "METALURGIA:ALVEOLARES": 3,
      "DEMANDA:MONTAGEM": 5,
      "METALURGIA:MONTAGEM": 2,
      "ACOMPANHAMENTO:MONTAGEM": 3,
      "ACOMPANHAMENTO:FUNDAÇÃO": 1,
    };
    const ler = (chave: string, mes: number) => (mes === 0 ? undefined : chave === "DIAS_UTEIS" ? 20 : p[chave]);
    const tabela = calcularTabela(EST, [ALVEOLARES], 2, 2026, ler, "GLOBAL");
    const global = tabela.bases;
    assert.equal(global.get("PRODUCAO|FILIAL")![0], 400);
    assert.equal(global.get("PROJETO|FILIAL")![0], 400);
    // 400 m³ × 50 kg/m³ de armadura; × 3 kg/m³ de metalurgia, que também é a Produção da Metalurgia (kg) da Filial.
    assert.equal(global.get("ARMADURA|FILIAL")![0], 20_000);
    assert.equal(global.get("METALURGIA|FILIAL")![0], 1200);
    assert.equal(tabela.dre.get("P.PRODUCAO_DA_METALURGIA_KG")![0], 1200);
    assert.equal(calcularTabela(EST, [ALVEOLARES], 2, 2026, ler, "MERCANTIL").bases.get("PROJETO|FILIAL"), undefined);
    const servicos = calcularTabela(EST, [MONTAGEM, FUNDACAO], 3, 2026, ler, "GLOBAL");
    assert.equal(servicos.bases.get("ACOMPANHAMENTO|MONTAGEM")![0], 60);
    assert.equal(servicos.bases.get("ACOMPANHAMENTO|COMPLEMENTAR")![0], 20);
    assert.equal(servicos.dre.get("S.ACOMPANHAMENTO_DE_OBRA_D")![0], 80);
    // A Montagem: 5 m³/dia × 20 dias × 2 kg/m³ de metalurgia.
    assert.equal(servicos.bases.get("METALURGIA|MONTAGEM")![0], 200);
  });
});

describe("centros de custo dos cenários analíticos (13/10/2026)", () => {
  const item = (codigo: string, grupoSigla: string, atribuicao: string, descricao: string, unidades: number[]) => ({ id: codigo, codigo, tipo: "ITEM" as const, grupo: "", grupoSigla, atribuicao, descricao, expressao: null, unidades });
  const EST = [
    item("CPP.MOD.CLT", "CPP", "MOD", "Remunerações CLT", [1, 2]),
    item("CPP.MP.CIMENTO", "CPP", "MP", "Cimento", [1, 2]),
    item("CSM.MOD.CLT", "CSM", "MOD", "Remunerações CLT", [3]),
    item("CSC.MOD.CLT", "CSC", "MOD", "Remunerações CLT", [3]),
    item("DA.MOI.CLT", "DA", "MOI", "Remunerações CLT", [4]),
  ];
  const grupo = (g: string, balde: string, grupoDRE: string, unidade: 1 | 2 = 1) => ({ grupo: g, centros: [], balde, baldes: [balde], grupoDRE, unidade, destino: "" });
  const GRUPOS = [grupo("m", "MATRIZ", "CPP"), grupo("u", "UNIDADE", "CPP", 2), grupo("p", "PRODUCAO", "CPP"), grupo("met", "METALURGIA", "CPP"), grupo("a", "ACOMPANHAMENTO", "CSM"), grupo("d", "DESPESAS", "DA")];
  const mes = (v: number) => [v, ...Array<number>(11).fill(0)];
  const BASES = new Map([
    ["PRODUCAO|MATRIZ", mes(300)],
    ["PRODUCAO|FILIAL", mes(100)],
    ["METALURGIA|MATRIZ", mes(40)],
    ["METALURGIA|FILIAL", mes(10)],
    ["METALURGIA|MONTAGEM", mes(20)],
    ["METALURGIA|COMPLEMENTAR", mes(30)],
    ["ACOMPANHAMENTO|MONTAGEM", mes(7)],
    ["ACOMPANHAMENTO|COMPLEMENTAR", mes(3)],
  ]);

  it("as contas do grupo: mão de obra e gastos gerais do grupo da DRE dele, sem MP, GGV, estoque e depreciação", () => {
    assert.deepEqual(contasDoGrupo(EST, { grupoDRE: "CPP" }).map((l) => l.codigo), ["CPP.MOD.CLT"]);
    assert.deepEqual(contasDoGrupo(EST, { grupoDRE: "DA" }).map((l) => l.codigo), ["DA.MOI.CLT"]);
  });

  it("os percentuais pelas bases das premissas; sem base no mês, zero", () => {
    const p = percentuaisDasBases(BASES);
    assert.equal(p[0].get("PRODUCAO|MATRIZ"), 0.75);
    assert.equal(p[0].get("METALURGIA|COMPLEMENTAR"), 0.3);
    assert.equal(p[1].get("PRODUCAO|MATRIZ"), 0);
    assert.equal(p[0].get("ARMADURA|MATRIZ"), 0);
  });

  it("aloca pelo balde do grupo e pelos rateios, como o fechamento", () => {
    const v = (g: string, codigo: string) => ({ grupo: g, codigo, mes: 1, valor: 1000 });
    const r = alocarCentros(EST, GRUPOS, [v("m", "CPP.MOD.CLT"), v("u", "CPP.MOD.CLT"), v("p", "CPP.MOD.CLT"), v("met", "CPP.MOD.CLT"), v("a", "CSM.MOD.CLT"), v("d", "DA.MOI.CLT")], percentuaisDasBases(BASES));
    const jan = (k: string) => Math.round(r.get(k)?.[0] ?? 0);
    // Matriz: o direto (1000) + 75% da Produção + 40% da Metalurgia.
    assert.equal(jan("1|CPP.MOD.CLT"), 1000 + 750 + 400);
    // Filial: o UNIDADE da filial 2 (1000) + 25% da Produção + 10% da Metalurgia.
    assert.equal(jan("2|CPP.MOD.CLT"), 1000 + 250 + 100);
    // Serviços: Metalurgia (20% na CSM, 30% na CSC) e Acompanhamento (70% e 30%).
    assert.equal(jan("3|CSM.MOD.CLT"), 200 + 700);
    assert.equal(jan("3|CSC.MOD.CLT"), 300 + 300);
    assert.equal(jan("4|DA.MOI.CLT"), 1000);
  });

  it("avisa o valor dos grupos de rateio num mês sem base (todo custo vai para algum lugar)", () => {
    // A Armadura não tem base no mês 1: o grupo de armadura fica de fora; a Produção tem base.
    const grupos = [grupo("arm", "ARMADURA", "CPP"), grupo("p", "PRODUCAO", "CPP")];
    const sem = rateiosSemBase(grupos, [{ grupo: "arm", codigo: "CPP.MOD.CLT", mes: 1, valor: 500 }, { grupo: "p", codigo: "CPP.MOD.CLT", mes: 1, valor: 800 }], percentuaisDasBases(BASES));
    assert.deepEqual(sem, [{ chave: "ARMADURA", mes: 1, valor: 500 }]);
  });

  it("no fechamento, avisa a chave com lançamentos de rateio e sem volume no mês", () => {
    const D = (v: number) => new Prisma.Decimal(v);
    const linhas = [{ ...EST[0], id: "L1" }, { ...item("DFC.DFC.JUROS", "DFC", "DFC", "Juros", [4]), id: "L2" }];
    const r = rateiosSemVolume({
      linhas,
      lancamentos: [
        { filial: 1, linhaDREId: "L1", balde: "ARMADURA", alocacao: "RATEIO", valor: D(300) },
        { filial: 1, linhaDREId: "L1", balde: "PRODUCAO", alocacao: "RATEIO", valor: D(100) },
        { filial: 1, linhaDREId: "L2", balde: "ACOMPANHAMENTO", alocacao: "RATEIO", valor: D(50) },
      ],
      percentuais: new Map([["PRODUCAO|MATRIZ", D(1)], ["ARMADURA|MATRIZ", D(0)], ["ACOMPANHAMENTO|MONTAGEM", D(0)]]),
    });
    assert.deepEqual([...r].map(([k, v]) => [k, v.toNumber()]), [["ARMADURA", 300]]);
  });
});

describe("investimentos e extra-operacional dos cenários analíticos (13/10/2026)", () => {
  const inv = { unidade: 2, conta: "CPP.D.DEPRECIACAO_DO_MAQUINARIO", inicio: 7, valorTotal: 3_100_000, valorPosUso: 100_000, vidaUtil: 120 };

  it("a depreciação mensal = (valor total − valor pós uso) ÷ vida útil, do mês de início em diante", () => {
    assert.equal(depreciacaoMensal(inv), 25_000);
    assert.deepEqual(depreciacaoNosMeses(inv), [0, 0, 0, 0, 0, 0, 25_000, 25_000, 25_000, 25_000, 25_000, 25_000]);
    // A vida útil curta acaba antes do fim do ano.
    assert.deepEqual(depreciacaoNosMeses({ ...inv, inicio: 3, vidaUtil: 2, valorPosUso: 0, valorTotal: 1000 }), [0, 0, 500, 500, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("a depreciação base, a dos investimentos e o extra-operacional vão para as contas das unidades", () => {
    const r = calcularInvestimentosEExtra(
      [
        { unidade: 2, venda: "BASE", chave: "2|CPP.D.DEPRECIACAO_DO_MAQUINARIO", mes: 7, valor: 76_000 },
        { unidade: 4, venda: "EXTRA", chave: "4|DFC.DFC.DESPESAS_BANCARIAS", mes: 1, valor: 2_100 },
        { unidade: 2, venda: "GLOBAL", chave: "DEMANDA:ALVEOLARES", mes: 1, valor: 4 },
      ],
      [inv],
    );
    assert.equal(r.get("2|CPP.D.DEPRECIACAO_DO_MAQUINARIO")![6], 76_000 + 25_000);
    assert.equal(r.get("4|DFC.DFC.DESPESAS_BANCARIAS")![0], 2_100);
    assert.equal(r.size, 2);
  });
});

describe("referência realizada dos cenários analíticos (14/10/2026)", () => {
  const CORR = [
    { filial: 1, tarefa: "LAJE", unidade: 1, linha: "ESTRUTURA" },
    { filial: 2, tarefa: "LAJE", unidade: 2, linha: "ALVEOLARES" },
    { filial: null, tarefa: "VEDAÇÃO", unidade: 3, linha: "VEDAÇÃO" },
  ];

  it("a linha da tarefa: a correspondência da filial do documento; sem ela, a de qualquer filial", () => {
    assert.equal(linhaDaTarefa(CORR, 1, " laje "), "1|ESTRUTURA");
    assert.equal(linhaDaTarefa(CORR, 2, "LAJE"), "2|ALVEOLARES");
    assert.equal(linhaDaTarefa(CORR, 2, "Vedação"), "3|VEDAÇÃO");
    assert.equal(linhaDaTarefa(CORR, 1, "MATERIAIS"), null);
    assert.equal(linhaDaTarefa(CORR, 1, null), null);
  });

  it("divide a conta pelas linhas: a parte dos documentos com tarefa de cada uma, e a sem tarefa pelo volume", () => {
    // 1.000 na DRE; documentos: 300 da Estrutura, 100 da Metalúrgica e 100 sem tarefa, que vai 3:1 pelo m³.
    const r = dividirPorLinhas(1000, new Map([["1|ESTRUTURA", 300], ["1|METALÚRGICA", 100], ["2|ALVEOLARES", 999]]), 100, new Map([["1|ESTRUTURA", 3], ["1|METALÚRGICA", 1]]));
    assert.equal(r.get("1|ESTRUTURA"), (1000 * (300 + 75)) / 500);
    assert.equal(r.get("1|METALÚRGICA"), (1000 * (100 + 25)) / 500);
    assert.equal(r.has("2|ALVEOLARES"), false);
    // Sem documentos, pelo volume; sem volume, em partes iguais.
    assert.equal(dividirPorLinhas(800, new Map(), 0, new Map([["a", 3], ["b", 1]])).get("a"), 600);
    assert.equal(dividirPorLinhas(800, new Map(), 0, new Map([["a", 0], ["b", 0]])).get("b"), 400);
  });

  it("a venda da obra: o tipo dela; sem ele, G… é Global e o resto Mercantil", () => {
    assert.equal(vendaDaObra({ codigo: "L123", tipoVenda: "GLOBAL" }), "GLOBAL");
    assert.equal(vendaDaObra({ codigo: "G045", tipoVenda: null }), "GLOBAL");
    assert.equal(vendaDaObra({ codigo: "E010", tipoVenda: null }), "MERCANTIL");
    assert.equal(vendaDaObra(null), null);
  });

  it("a mão de obra terceirizada não é dos centros (vem das premissas)", () => {
    const est = [{ id: "x", codigo: "CSM.MOT.MONTAGEM", tipo: "ITEM" as const, grupo: "", grupoSigla: "CSM", atribuicao: "MOT", descricao: "Montagem", expressao: null, unidades: [3] }];
    assert.deepEqual(contasDoGrupo(est, { grupoDRE: "CSM" }), []);
  });
});

describe("quadro de lotação dos cenários analíticos (14/10/2026)", () => {
  const g = (grupo: string, grupoDRE: string, balde: string, atribuicao: "DIRETA" | "INDIRETA" | null, unidade: 1 | 2 = 1) => ({ grupo, grupoDRE, balde, atribuicao, unidade });
  const GRUPOS = [
    g("ESTRUTURA", "CPP", "MATRIZ", "DIRETA"),
    g("ALVEOLARES", "CPP", "FILIAL", "DIRETA"),
    g("PCP (CRI)", "CPP", "UNIDADE", "INDIRETA", 1),
    g("QUALIDADE", "CPP", "PRODUCAO", "INDIRETA", 2),
    g("GUINDASTEIROS", "CSM", "OBRAS", "DIRETA"),
    g("FINANCEIRO", "DA", "DESPESAS", "INDIRETA"),
    g("VEICULOS", "CPP", "UNIDADE", null),
  ];

  it("classifica o grupo: Direta ou Indireta pela atribuição; Matriz ou Filial pelo balde (ou pela filial dos lançamentos); Montagem na CSM", () => {
    assert.equal(quadroDoGrupo(GRUPOS[2]).local, "Matriz");
    assert.equal(quadroDoGrupo(GRUPOS[3]).local, "Filial");
    assert.equal(quadroDoGrupo(GRUPOS[4]).local, "Montagem");
    assert.equal(quadroDoGrupo(GRUPOS[5]).local, null);
    assert.equal(quadroDoGrupo(GRUPOS[6]).atribuicao, null);
  });

  it("os quadros: Direta e Indireta por local, Total = Matriz + Filial, Geral = Direta + Indireta, e o Total de todos os grupos", () => {
    const lot = new Map([
      ["ESTRUTURA", [100, ...Array<number>(11).fill(0)]],
      ["ALVEOLARES", [60, ...Array<number>(11).fill(0)]],
      ["PCP (CRI)", [10, ...Array<number>(11).fill(0)]],
      ["QUALIDADE", [5, ...Array<number>(11).fill(0)]],
      ["GUINDASTEIROS", [8, ...Array<number>(11).fill(0)]],
      ["FINANCEIRO", [12, ...Array<number>(11).fill(0)]],
      ["VEICULOS", [1, ...Array<number>(11).fill(0)]],
    ]);
    const q = quadrosDeLotacao(GRUPOS, lot);
    const jan = (n: string) => q.get(n)![0];
    assert.equal(jan("Quadro de Lotação: MO Direta Matriz"), 100);
    assert.equal(jan("Quadro de Lotação: MO Indireta Filial"), 5);
    assert.equal(jan("Quadro de Lotação: MO Direta Total"), 160);
    assert.equal(jan("Quadro de Lotação: MO Geral Matriz"), 110);
    assert.equal(jan("Quadro de Lotação: MO Geral Total"), 175);
    assert.equal(jan("Quadro de Lotação: MO Direta Montagem"), 8);
    assert.equal(jan("Quadro de Lotação: MO Indireta Montagem"), null);
    assert.equal(jan("Quadro de Lotação Total"), 196);
    assert.equal(q.get("Quadro de Lotação Total")![1], null);
    assert.equal(q.size, 13);
  });

  it("a referência acha o grupo de cada centro da aba Quadro de Lotação: sem acentos e maiúsculas, e os três apelidos", () => {
    const grupos = ["ESTACAS", "CONSOLES", "GENTE E GESTÃO", "SEGURANÇA (CRI)", "LABORATÓRIO", "LABORATÓRIO (CRI)"];
    assert.equal(grupoDaLotacao("ESTACA", grupos), "ESTACAS");
    assert.equal(grupoDaLotacao("CONSOLO (CRI)", grupos), "CONSOLES");
    assert.equal(grupoDaLotacao("GENTE E GESTÃO (CRI)", grupos), "GENTE E GESTÃO");
    assert.equal(grupoDaLotacao(" seguranca  (cri) ", grupos), "SEGURANÇA (CRI)");
    assert.equal(grupoDaLotacao("LABORATÓRIO", grupos), "LABORATÓRIO");
    assert.equal(grupoDaLotacao("TURN KEY - ADM", grupos), null);
  });
});
