import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LinhaEstrutura } from "../src/services/dre/apuracaoUnidades.js";
import {
  celulasDaCombinacao,
  combinacoesDoLegado,
  errosDasCombinacoes,
  indicePorCelula,
  indicesDasLinhas,
  limiteNaVisao,
  montarUniverso,
  type Combinacao,
  type DepartamentoDoIndice,
} from "../src/services/cenarios/indicesCenario.js";
import { fatoresDasContas, fatorNaVenda, paresDaReceita, receitaLiquidaReajustada } from "../src/services/cenarios/reajustesCenario.js";

/** Uma linha da Estrutura da DRE dos testes. */
const L = (codigo: string, tipo: LinhaEstrutura["tipo"], grupoSigla: string, descricao: string, unidades: number[], atribuicao: string | null = null): LinhaEstrutura => ({
  id: codigo,
  codigo,
  tipo,
  grupo: grupoSigla,
  grupoSigla,
  atribuicao,
  atribuicaoSigla: null,
  descricao,
  expressao: null,
  unidades,
});

const EST: LinhaEstrutura[] = [
  L("PS.PRODUCAO_E_SERVICOS_PS", "SECAO", "PS", "PRODUÇÃO E SERVIÇOS (PS)", []),
  L("P.PRODUCAO_P", "SECAO", "P", "PRODUÇÃO (P)", []),
  L("P.PRODUCAO_M", "ITEM", "P", "Produção (m³)", [1, 2]),
  L("ROB.RECEITA_ROB", "SUBTOTAL", "ROB", "RECEITA OPERACIONAL BRUTA (ROB)", [1, 2, 3]),
  L("ROB.RBPF.RECEITA_PF", "ITEM", "ROB", "Receita Bruta do Pré-Fabricado", [1, 2], "Receita Bruta do Pré-Fabricado"),
  L("CPP.CUSTOS_CPP", "SUBTOTAL", "CPP", "CUSTOS DE PRODUÇÃO (CPP)", [1, 2]),
  L("CPP.MOD.MAO_DE_OBRA_DIRETA", "SUBTOTAL", "CPP", "Mão de Obra Direta", [1, 2], "Mão de Obra Direta"),
  L("CPP.MOD.REMUNERACOES_CLT", "ITEM", "CPP", "Remunerações CLT", [1, 2], "Mão de Obra Direta"),
  L("CPP.MOD.HORAS_EXTRAS", "ITEM", "CPP", "Horas Extras", [1, 2], "Mão de Obra Direta"),
  L("CPP.MP.MATERIAS_PRIMAS", "SUBTOTAL", "CPP", "Matérias Primas", [1, 2], "Matérias Primas"),
  L("CPP.MP.CIMENTO", "ITEM", "CPP", "Cimento", [1, 2], "Matérias Primas"),
  L("CSM.CUSTOS_CSM", "SUBTOTAL", "CSM", "CUSTOS DE SERVIÇOS: MONTAGEM (CSM)", [3]),
  L("CSM.MOD.MAO_DE_OBRA_DIRETA", "SUBTOTAL", "CSM", "Mão de Obra Direta", [3], "Mão de Obra Direta"),
  L("CSM.MOD.REMUNERACOES_CLT", "ITEM", "CSM", "Remunerações CLT", [3], "Mão de Obra Direta"),
  L("CSC.CUSTOS_CSC", "SUBTOTAL", "CSC", "CUSTOS DE SERVIÇOS: COMPLEMENTARES (CSC)", [3]),
  L("CSC.MOD.MAO_DE_OBRA_DIRETA", "SUBTOTAL", "CSC", "Mão de Obra Direta", [3], "Mão de Obra Direta"),
  L("CSC.MOD.REMUNERACOES_CLT", "ITEM", "CSC", "Remunerações CLT", [3], "Mão de Obra Direta"),
];

const DEPS: DepartamentoDoIndice[] = [
  { id: "prod1", unidade: 1, nome: "Produção", grupos: ["CPP"], ativo: true },
  { id: "prod2", unidade: 2, nome: "Produção", grupos: ["CPP"], ativo: true },
  { id: "mont", unidade: 3, nome: "Montagem", grupos: ["CSM"], ativo: true },
  { id: "comp", unidade: 3, nome: "Complementares", grupos: ["CSC"], ativo: true },
];
const UNIDADES = [
  { codigo: 1, nome: "Matriz" },
  { codigo: 2, nome: "Filial" },
  { codigo: 3, nome: "Serviços" },
];
const K = (unidade: number | null, departamento: string | null, atribuicao: string | null, conta: string | null, venda: Combinacao["venda"] = null): Combinacao => ({
  unidade,
  departamento,
  atribuicao,
  conta,
  venda,
});

describe("índices dos analíticos: o universo das combinações (21/11/2026)", () => {
  it("nos de comparação, as contas verificadas em cada unidade, com os volumes", () => {
    const u = montarUniverso("COMPARACAO", EST, DEPS, UNIDADES);
    assert.deepEqual(
      u.celulas.map((c) => c.chave),
      [
        "1|P.PRODUCAO_M",
        "2|P.PRODUCAO_M",
        "1|ROB.RBPF.RECEITA_PF",
        "2|ROB.RBPF.RECEITA_PF",
        "1|CPP.MOD.REMUNERACOES_CLT",
        "2|CPP.MOD.REMUNERACOES_CLT",
        "1|CPP.MOD.HORAS_EXTRAS",
        "2|CPP.MOD.HORAS_EXTRAS",
        "1|CPP.MP.CIMENTO",
        "2|CPP.MP.CIMENTO",
        "3|CSM.MOD.REMUNERACOES_CLT",
        "3|CSC.MOD.REMUNERACOES_CLT",
      ],
    );
    // As atribuições pela sigla (a mesma em todos os grupos) e, nos volumes, a seção.
    assert.deepEqual(
      u.atribuicoes.map((a) => [a.chave, a.nome]),
      [
        ["P", "Produção"],
        ["RBPF", "Receita Bruta do Pré-Fabricado"],
        ["MOD", "Mão de Obra Direta"],
        ["MP", "Matérias Primas"],
        // O departamento Receita Operacional (21/11/2026): os grupos da receita como atribuições.
        ["ROB", "Receita Operacional Bruta"],
      ],
    );
    assert.deepEqual(u.contas.map((c) => c.chave), ["PRODUCAO_M", "RBPF.RECEITA_PF", "MOD.REMUNERACOES_CLT", "MOD.HORAS_EXTRAS", "MP.CIMENTO"]);
    assert.equal(u.celulas[0].descricao, "Matriz · Produção (m³) (P)");
  });

  it("nos de reajuste, sem os volumes, com os Custos de Produção da Matriz e da Filial em cada venda", () => {
    const u = montarUniverso("REAJUSTE", EST, DEPS, UNIDADES);
    assert.equal(u.celulas.filter((c) => c.codigo.startsWith("P.")).length, 0);
    assert.deepEqual(
      u.celulas.filter((c) => c.codigo === "CPP.MP.CIMENTO").map((c) => c.chave),
      ["1|GLOBAL|CPP.MP.CIMENTO", "1|MERCANTIL|CPP.MP.CIMENTO", "2|GLOBAL|CPP.MP.CIMENTO", "2|MERCANTIL|CPP.MP.CIMENTO"],
    );
    assert.deepEqual(u.celulas.filter((c) => c.codigo.startsWith("ROB.")).map((c) => c.chave), ["1|ROB.RBPF.RECEITA_PF", "2|ROB.RBPF.RECEITA_PF"]);
    assert.equal(u.celulas.find((c) => c.chave === "1|GLOBAL|CPP.MP.CIMENTO")?.descricao, "Matriz · Global · Cimento (MP, CPP)");
  });

  it("cada combinação alcança a unidade, o departamento, a atribuição e a conta escolhidos", () => {
    const u = montarUniverso("COMPARACAO", EST, DEPS, UNIDADES);
    const chaves = (k: Combinacao) => celulasDaCombinacao(k, u).map((c) => c.chave);
    assert.equal(chaves(K(null, null, null, null)).length, 12);
    assert.deepEqual(chaves(K(3, null, "MOD", null)), ["3|CSM.MOD.REMUNERACOES_CLT", "3|CSC.MOD.REMUNERACOES_CLT"]);
    assert.deepEqual(chaves(K(3, "mont", "MOD", null)), ["3|CSM.MOD.REMUNERACOES_CLT"]);
    assert.deepEqual(chaves(K(1, "prod1", null, null)), ["1|CPP.MOD.REMUNERACOES_CLT", "1|CPP.MOD.HORAS_EXTRAS", "1|CPP.MP.CIMENTO"]);
    // Com o departamento "Todos", a mesma conta de todos os grupos e unidades.
    assert.deepEqual(chaves(K(null, null, "MOD", "MOD.REMUNERACOES_CLT")), [
      "1|CPP.MOD.REMUNERACOES_CLT",
      "2|CPP.MOD.REMUNERACOES_CLT",
      "3|CSM.MOD.REMUNERACOES_CLT",
      "3|CSC.MOD.REMUNERACOES_CLT",
    ]);
    // O departamento de outra unidade não alcança nada.
    assert.deepEqual(chaves(K(2, "prod1", null, null)), []);
  });
});

describe("índices dos analíticos: a conferência das combinações", () => {
  const u = montarUniverso("REAJUSTE", EST, DEPS, UNIDADES);
  it("aceita combinações sem contas repetidas", () => {
    assert.deepEqual(
      errosDasCombinacoes(
        [
          { chave: "a", descricao: "Dissídio", combinacoes: [K(null, null, "MOD", null)] },
          { chave: "b", descricao: "Cimento Global", combinacoes: [K(1, "prod1", "MP", "MP.CIMENTO", "GLOBAL"), K(2, "prod2", "MP", null, "GLOBAL")] },
          { chave: "c", descricao: "Cimento Mercantil", combinacoes: [K(1, "prod1", "MP", "MP.CIMENTO", "MERCANTIL")] },
        ],
        u,
      ),
      [],
    );
  });
  it("recusa a mesma conta em duas combinações do índice ou em dois índices", () => {
    const dentro = errosDasCombinacoes([{ chave: "a", descricao: "Dissídio", combinacoes: [K(1, null, null, null), K(1, "prod1", "MOD", null)] }], u);
    assert.equal(dentro.length, 1);
    assert.match(dentro[0], /Dissídio, combinação 2: alcança contas de outra combinação do índice — Matriz · Global · Remunerações CLT \(MOD, CPP\) \(combinação 1\)/);
    const entre = errosDasCombinacoes(
      [
        { chave: "a", descricao: "Dissídio", combinacoes: [K(null, null, "MOD", null)] },
        { chave: "b", descricao: "Inflação", combinacoes: [K(3, "comp", null, null)] },
      ],
      u,
    );
    assert.equal(entre.length, 1);
    assert.match(entre[0], /Inflação, combinação 1: alcança contas que já estão no índice Dissídio — Serviços · Remunerações CLT \(MOD, CSC\)/);
    // A venda Global e a Mercantil da mesma conta não se repetem; Todas e Global, sim.
    assert.equal(errosDasCombinacoes([{ chave: "a", descricao: "X", combinacoes: [K(1, "prod1", null, null), K(1, "prod1", "MP", null, "GLOBAL")] }], u).length, 1);
  });
  it("recusa a combinação vazia e o departamento de outra unidade; a venda restringe às contas dos Custos de Produção", () => {
    const erros = errosDasCombinacoes(
      [
        { chave: "a", descricao: "A", combinacoes: [K(2, "prod1", null, null)] },
        { chave: "b", descricao: "B", combinacoes: [K(3, null, null, null, "GLOBAL")] },
        { chave: "c", descricao: "C", combinacoes: [K(null, "prod1", null, null)] },
      ],
      u,
    );
    assert.ok(erros.some((e) => /^A, combinação 1: o departamento Produção não é da unidade escolhida/.test(e)));
    assert.ok(erros.some((e) => /^A, combinação 1: a combinação não alcança nenhuma conta/.test(e)));
    assert.ok(erros.some((e) => /^B, combinação 1: a combinação não alcança nenhuma conta/.test(e)));
    // A Matriz inteira na venda Global: só as contas dos Custos de Produção dela, na Global.
    assert.deepEqual(errosDasCombinacoes([{ chave: "d", descricao: "D", combinacoes: [K(1, null, null, null, "GLOBAL")] }], u), []);
    assert.deepEqual(
      celulasDaCombinacao(K(1, null, null, null, "GLOBAL"), u).map((c) => c.chave),
      ["1|GLOBAL|CPP.MOD.REMUNERACOES_CLT", "1|GLOBAL|CPP.MOD.HORAS_EXTRAS", "1|GLOBAL|CPP.MP.CIMENTO"],
    );
    assert.ok(erros.some((e) => /^C, combinação 1: o departamento Produção não é da unidade escolhida/.test(e)));
  });
  it("as combinações viram os fatores das contas, por unidade e venda", () => {
    const indices = [
      { chave: "a", descricao: "A", combinacoes: [K(1, "prod1", null, null, "GLOBAL")] },
      { chave: "b", descricao: "B", combinacoes: [K(1, "prod1", null, null, "MERCANTIL"), K(3, null, null, null)] },
    ];
    const porCelula = indicePorCelula(indices, u);
    const fatores = fatoresDasContas({
      indicesDosReajustes: [
        { chave: "a", descricao: "A", observacao: null, reajustes: [{ valor: 10, mes: 1 }] },
        { chave: "b", descricao: "B", observacao: null, reajustes: [{ valor: 5, mes: 7 }] },
      ],
      aplicacaoDosReajustes: Object.fromEntries([...porCelula].map(([k, v]) => [k, [v, null]])),
    });
    assert.equal(fatorNaVenda(fatores, "CPP.MP.CIMENTO", 1, "GLOBAL")?.[0], 1.1);
    assert.equal(fatorNaVenda(fatores, "CPP.MP.CIMENTO", 1, "MERCANTIL")?.[6], 1.05);
    assert.equal(fatorNaVenda(fatores, "CPP.MP.CIMENTO", 2, "GLOBAL"), undefined);
    assert.equal(fatores.get("3|CSC.MOD.REMUNERACOES_CLT")?.[11], 1.05);
  });
});

describe("índices dos analíticos: os gravados antes das combinações", () => {
  it("as combinações do legado alcançam exatamente as contas escolhidas", () => {
    const u = montarUniverso("COMPARACAO", EST, DEPS, UNIDADES);
    // Por conta, em todas as unidades (a escolha de antes): Remunerações CLT da Produção e dos Serviços em A, Cimento em B,
    // o volume em A; Horas Extras e a receita sem índice.
    const porCelula = new Map<string, string>();
    for (const c of u.celulas) {
      if (c.conta === "MOD.REMUNERACOES_CLT" || c.conta === "PRODUCAO_M") porCelula.set(c.chave, "A");
      if (c.conta === "MP.CIMENTO") porCelula.set(c.chave, "B");
    }
    const combinacoes = combinacoesDoLegado(porCelula, u);
    const indices = [...combinacoes].map(([chave, ks]) => ({ chave, descricao: chave, combinacoes: ks }));
    assert.deepEqual(errosDasCombinacoes(indices, u), []);
    assert.deepEqual(new Map([...indicePorCelula(indices, u)].sort()), new Map([...porCelula].sort()));
    // As mais largas: a atribuição (só com o Cimento) em todas as unidades.
    assert.deepEqual(combinacoes.get("B"), [K(null, null, "MP", null)]);
  });
  it("nos reajustes, cada venda com o seu índice", () => {
    const u = montarUniverso("REAJUSTE", EST, DEPS, UNIDADES);
    const porCelula = new Map<string, string>([
      ["1|GLOBAL|CPP.MP.CIMENTO", "G"],
      ["1|MERCANTIL|CPP.MP.CIMENTO", "M"],
      ["2|GLOBAL|CPP.MP.CIMENTO", "G"],
      ["2|MERCANTIL|CPP.MP.CIMENTO", "G"],
    ]);
    const combinacoes = combinacoesDoLegado(porCelula, u);
    const indices = [...combinacoes].map(([chave, ks]) => ({ chave, descricao: chave, combinacoes: ks }));
    assert.deepEqual(errosDasCombinacoes(indices, u), []);
    assert.deepEqual(new Map([...indicePorCelula(indices, u)].sort()), new Map([...porCelula].sort()));
  });
});

describe("índices dos analíticos: a variação e os Resultados", () => {
  it("no Consolidado, a maior variação das unidades", () => {
    const limites = new Map([
      ["1|CPP.MP.CIMENTO", 5],
      ["2|CPP.MP.CIMENTO", 8],
    ]);
    assert.equal(limiteNaVisao(limites, "CPP.MP.CIMENTO", 1), 5);
    assert.equal(limiteNaVisao(limites, "CPP.MP.CIMENTO", 0), 8);
    assert.equal(limiteNaVisao(limites, "CPP.MP.CIMENTO", null), 8);
    assert.equal(limiteNaVisao(limites, "CPP.MP.CIMENTO", 3), null);
  });
  it("as linhas dos Resultados: a conta, o total e Vários", () => {
    const u = montarUniverso("COMPARACAO", EST, DEPS, UNIDADES);
    const porCelula = indicePorCelula(
      [
        { chave: "a", descricao: "A", combinacoes: [K(1, "prod1", null, null)] },
        { chave: "b", descricao: "B", combinacoes: [K(2, "prod2", "MP", null)] },
      ],
      u,
    );
    const rotulo = (k: string) => ({ texto: k.toUpperCase(), dica: k });
    const matriz = indicesDasLinhas(EST, u, porCelula, 1, rotulo);
    assert.equal(matriz["CPP.MP.CIMENTO"]?.texto, "A");
    assert.equal(matriz["CPP.CUSTOS_CPP"]?.texto, "A");
    assert.equal(matriz["ROB.RBPF.RECEITA_PF"], undefined);
    const consolidado = indicesDasLinhas(EST, u, porCelula, 0, rotulo);
    assert.equal(consolidado["CPP.MP.CIMENTO"]?.texto, "Vários");
    assert.match(consolidado["CPP.MP.CIMENTO"]?.dica ?? "", /Matriz · Cimento \(MP, CPP\): A\nFilial · Cimento \(MP, CPP\): B/);
    assert.equal(consolidado["CPP.MOD.REMUNERACOES_CLT"]?.texto, "Vários");
  });
});

describe("índices dos analíticos: o departamento Receita Operacional (21/11/2026)", () => {
  const RECEITA: LinhaEstrutura[] = [
    L("ROB.RECEITA_ROB", "SUBTOTAL", "ROB", "RECEITA OPERACIONAL BRUTA (ROB)", [1, 2, 3]),
    L("ROB.RBPF.RECEITA_PF", "ITEM", "ROB", "Receita Bruta do Pré-Fabricado", [1, 2], "Receita Bruta do Pré-Fabricado"),
    L("ROB.RBM.RECEITA_M", "ITEM", "ROB", "Receita Bruta de Montagem", [3], "Receita Bruta de Montagem"),
    L("IRB.IMPOSTOS_IRB", "TOTAL", "IRB", "IMPOSTOS SOBRE A RECEITA BRUTA (IRB)", [1, 2, 3]),
    L("IRB.IO.IMPOSTOS_OPERACIONAIS", "TOTAL", "IRB", "Impostos Operacionais", [1, 2, 3], "Impostos Operacionais"),
    L("ROL.RECEITA_ROL", "SUBTOTAL", "ROL", "RECEITA OPERACIONAL LÍQUIDA (ROL)", [1, 2, 3]),
    L("ROL.RLPF.RECEITA_LIQUIDA_PF", "ITEM", "ROL", "Receita Líquida do Pré-Fabricado", [1, 2], "Receita Líquida do Pré-Fabricado"),
    L("ROL.RLM.RECEITA_LIQUIDA_M", "ITEM", "ROL", "Receita Líquida de Montagem", [3], "Receita Líquida de Montagem"),
    L("CPP.CUSTOS_CPP", "SUBTOTAL", "CPP", "CUSTOS DE PRODUÇÃO (CPP)", [1, 2]),
    L("CPP.MP.CIMENTO", "ITEM", "CPP", "Cimento", [1, 2], "Matérias Primas"),
  ];
  const u = montarUniverso("REAJUSTE", RECEITA, DEPS, UNIDADES);
  const k = (x: Partial<Combinacao>): Combinacao => ({ unidade: null, departamento: null, atribuicao: null, conta: null, venda: null, ...x });
  const codigos = (x: Partial<Combinacao>) => celulasDaCombinacao(k(x), u).map((c) => `${c.unidade}|${c.codigo}`).sort();

  it("em cada unidade com receita, antes dos da cópia, com os grupos como atribuições e os Impostos Operacionais como conta", () => {
    const receita = u.departamentos.filter((d) => d.porGrupo);
    assert.deepEqual(receita.map((d) => [d.id, d.unidade, d.nome]), [
      ["RECEITA_OPERACIONAL|1", 1, "Receita Operacional"],
      ["RECEITA_OPERACIONAL|2", 2, "Receita Operacional"],
      ["RECEITA_OPERACIONAL|3", 3, "Receita Operacional"],
    ]);
    assert.equal(u.departamentos[0].id, "RECEITA_OPERACIONAL|1");
    assert.deepEqual(
      u.atribuicoes.filter((a) => ["ROB", "IRB", "ROL"].includes(a.chave)).map((a) => a.nome),
      ["Receita Operacional Bruta", "Impostos Operacionais", "Receita Operacional Líquida"],
    );
    assert.ok(u.celulas.some((c) => c.codigo === "IRB.IO.IMPOSTOS_OPERACIONAIS" && c.unidade === 3));
  });

  it("alcança a receita da unidade inteira, ou só a ROB, os impostos ou a ROL", () => {
    assert.deepEqual(codigos({ unidade: 1, departamento: "RECEITA_OPERACIONAL|1" }), ["1|IRB.IO.IMPOSTOS_OPERACIONAIS", "1|ROB.RBPF.RECEITA_PF", "1|ROL.RLPF.RECEITA_LIQUIDA_PF"]);
    assert.deepEqual(codigos({ unidade: 3, departamento: "RECEITA_OPERACIONAL|3", atribuicao: "ROL" }), ["3|ROL.RLM.RECEITA_LIQUIDA_M"]);
    assert.deepEqual(codigos({ unidade: 2, departamento: "RECEITA_OPERACIONAL|2", atribuicao: "IRB" }), ["2|IRB.IO.IMPOSTOS_OPERACIONAIS"]);
    assert.deepEqual(codigos({ unidade: 1, departamento: "RECEITA_OPERACIONAL|1", atribuicao: "ROB", conta: "RBPF.RECEITA_PF" }), ["1|ROB.RBPF.RECEITA_PF"]);
  });

  it("recusa os impostos e a ROL da mesma unidade em índices diferentes; no mesmo índice, aceita", () => {
    const ok = errosDasCombinacoes([{ chave: "r1", descricao: "Preços", combinacoes: [k({ unidade: 1, departamento: "RECEITA_OPERACIONAL|1" })] }], u);
    assert.deepEqual(ok, []);
    const erros = errosDasCombinacoes(
      [
        { chave: "r1", descricao: "Impostos", combinacoes: [k({ unidade: 1, departamento: "RECEITA_OPERACIONAL|1", atribuicao: "IRB" })] },
        { chave: "r2", descricao: "Líquida", combinacoes: [k({ unidade: 1, departamento: "RECEITA_OPERACIONAL|1", atribuicao: "ROL" })] },
      ],
      u,
    );
    assert.equal(erros.length, 1);
    assert.match(erros[0], /^Matriz: os Impostos Operacionais estão no índice Impostos e .*Receita Líquida do Pré-Fabricado.* no Líquida/);
  });

  it("os impostos reajustados: a ROL = a ROB (reajustada) − os impostos × o fator", () => {
    const rob = Array<number>(12).fill(1000);
    const rol = Array<number>(12).fill(900);
    const f = Array<number>(12).fill(1.1);
    // O mesmo fator na ROB e nos impostos: a ROL × o fator.
    assert.ok(Math.abs(receitaLiquidaReajustada(rob, f, rol, f)[0] - 990) < 1e-9);
    // Só os impostos (+20%): 1.000 − 100 × 1,2.
    assert.ok(Math.abs(receitaLiquidaReajustada(rob, undefined, rol, Array<number>(12).fill(1.2))[5] - 880) < 1e-9);
    assert.deepEqual([...paresDaReceita(RECEITA)], [
      ["ROL.RLPF.RECEITA_LIQUIDA_PF", "ROB.RBPF.RECEITA_PF"],
      ["ROL.RLM.RECEITA_LIQUIDA_M", "ROB.RBM.RECEITA_M"],
    ]);
  });
});
