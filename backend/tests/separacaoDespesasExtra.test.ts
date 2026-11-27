import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "../src/generated/prisma/client.js";
import { abasQueSomam, apurarUnidades, type LinhaEstrutura } from "../src/services/dre/apuracaoUnidades.js";
import { separarDespesasEExtra, type AbaDRELida } from "../src/services/cenarios/leituraCenario.js";

const D = (v: number) => new Prisma.Decimal(v);
const linha = (codigo: string, grupoSigla: string, descricao: string, unidades: number[], tipo: LinhaEstrutura["tipo"] = "ITEM", expressao: string | null = null): LinhaEstrutura => ({
  id: codigo, codigo, tipo, grupo: grupoSigla, grupoSigla, atribuicao: null, atribuicaoSigla: null, descricao, expressao, unidades,
});

describe("a separação de Despesas (4) e Extra-Operacional (6) (27/11/2026)", () => {
  const linhas: LinhaEstrutura[] = [
    linha("DA.GGI.LIMPEZA", "DA", "Limpeza", [4]),
    linha("DA.DESPESAS_ADMINISTRATIVAS_DA", "DA", "DESPESAS ADMINISTRATIVAS (DA)", [4], "SUBTOTAL", "DA.GGI.LIMPEZA"),
    linha("DFC.DFC.DESPESAS_BANCARIAS", "DFC", "Despesas Bancárias", [6]),
    linha("RFC.RA.RENDIMENTOS_DE_APLICACOES", "RFC", "Rendimentos de Aplicações", [6]),
    linha("NOPAT.DESPESAS_FINANCEIRAS_DF", "NOPAT", "DESPESAS FINANCEIRAS (DF)", [6], "TOTAL", "DFC.DFC.DESPESAS_BANCARIAS"),
  ];
  const base = { linhas, manuais: [], receitas: [], totais: new Map(), percentuais: new Map() };
  const v = (rs: Array<{ unidade: number; codigo: string; valor: Prisma.Decimal }>, u: number, c: string) => Number(rs.find((r) => r.unidade === u && r.codigo === c)?.valor ?? 0);

  it("cada conta na sua unidade, com a regra de antes: os diretos de qualquer balde e, nas financeiras, o rateio de acompanhamento inteiro", () => {
    const { resultados } = apurarUnidades({
      ...base,
      lancamentos: [
        { filial: 1, linhaDREId: "DA.GGI.LIMPEZA", balde: "DESPESAS", alocacao: "DIRETO", valor: D(1000) },
        { filial: 2, linhaDREId: "DFC.DFC.DESPESAS_BANCARIAS", balde: "EXTRA", alocacao: "DIRETO", valor: D(300) },
        { filial: 1, linhaDREId: "DFC.DFC.DESPESAS_BANCARIAS", balde: "ACOMPANHAMENTO", alocacao: "RATEIO", valor: D(50) },
        { filial: 1, linhaDREId: "RFC.RA.RENDIMENTOS_DE_APLICACOES", balde: "DESPESAS", alocacao: "DIRETO", valor: D(-80) },
      ],
    });
    assert.equal(v(resultados, 4, "DA.GGI.LIMPEZA"), 1000);
    assert.equal(v(resultados, 4, "DA.DESPESAS_ADMINISTRATIVAS_DA"), 1000);
    assert.equal(v(resultados, 6, "DFC.DFC.DESPESAS_BANCARIAS"), 350);
    assert.equal(v(resultados, 6, "NOPAT.DESPESAS_FINANCEIRAS_DF"), 350);
    // As receitas financeiras com o sinal trocado, como antes.
    assert.equal(v(resultados, 6, "RFC.RA.RENDIMENTOS_DE_APLICACOES"), 80);
    // Nada das contas do Extra-Operacional fica na 4, nem das despesas na 6.
    assert.equal(v(resultados, 4, "DFC.DFC.DESPESAS_BANCARIAS"), 0);
    assert.equal(v(resultados, 6, "DA.GGI.LIMPEZA"), 0);
  });

  it("o rateio de acompanhamento numa financeira só soma no Extra-Operacional", () => {
    const fin = linhas.find((l) => l.codigo === "DFC.DFC.DESPESAS_BANCARIAS")!;
    assert.deepEqual(abasQueSomam(fin, { filial: 1, balde: "ACOMPANHAMENTO", rateio: true }), [6]);
    assert.deepEqual(abasQueSomam(fin, { filial: 1, balde: "DESPESAS", rateio: false }), [6]);
  });

  it("a aba Desp.+Extra de um cenário importado se divide pelas contas da unidade 6", () => {
    const aba: AbaDRELida = {
      visao: 4,
      aba: "Desp.+Extra",
      ano: 2027,
      meses: 12,
      linhas: 2,
      valores: [
        { linhaDREId: "a", mes: 1, valor: 10 },
        { linhaDREId: "x", mes: 1, valor: 5 },
      ],
      semPar: [],
    };
    const r = separarDespesasEExtra([aba], new Set(["x"]));
    assert.deepEqual(r.find((d) => d.visao === 4)?.valores, [{ linhaDREId: "a", mes: 1, valor: 10 }]);
    assert.deepEqual(r.find((d) => d.visao === 6)?.valores, [{ linhaDREId: "x", mes: 1, valor: 5 }]);
    // Com a aba própria do Extra-Operacional no arquivo, a Desp.+Extra fica como veio.
    assert.equal(separarDespesasEExtra([aba, { ...aba, visao: 6 }], new Set(["x"])).find((d) => d.visao === 4)?.valores.length, 2);
  });
});
