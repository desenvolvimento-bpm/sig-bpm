import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "../src/generated/prisma/client.js";
import { abasQueSomam, apurarUnidades, type LinhaEstrutura } from "../src/services/dre/apuracaoUnidades.js";
import { consolidar } from "../src/services/dre/consolidacao.js";
import { contasExtra, UNIDADES_EXTRA } from "../src/services/cenarios/investimentosCenario.js";

const D = (v: number) => new Prisma.Decimal(v);
const linha = (codigo: string, grupoSigla: string, descricao: string, unidades: number[], tipo: LinhaEstrutura["tipo"] = "ITEM", expressao: string | null = null): LinhaEstrutura => ({
  id: codigo, codigo, tipo, grupo: grupoSigla, grupoSigla, atribuicao: null, atribuicaoSigla: null, descricao, expressao, unidades,
});

describe("a Leben (7), uma cópia do RN (27/11/2026)", () => {
  // As contas do RN também na Leben, como a migração deixa a Estrutura da DRE.
  const linhas: LinhaEstrutura[] = [
    linha("DA.GGI.ASSESSORIAS_E_CONSULTORIAS", "DA", "Assessorias e Consultorias", [5, 7]),
    linha("DML.IRCS.IMPOSTO_DE_RENDA_E_CONTRIBUICAO_SOCIAL", "DML", "Imposto de Renda e Contribuição Social", [5, 6, 7]),
    linha("DML.DEDUCOES_DA_MARGEM_LIQUIDA_DML", "DML", "DEDUÇÕES DA MARGEM LÍQUIDA (DML)", [5, 6, 7], "TOTAL", "DML.IRCS.IMPOSTO_DE_RENDA_E_CONTRIBUICAO_SOCIAL"),
  ];
  const v = (rs: Array<{ unidade: number; codigo: string; valor: Prisma.Decimal }>, u: number, c: string) => Number(rs.find((r) => r.unidade === u && r.codigo === c)?.valor ?? 0);

  it("os lançamentos manuais do balde LEBEN vão só para a Leben, e os do RN, só para o RN", () => {
    const { resultados, avisos } = apurarUnidades({
      linhas,
      lancamentos: [],
      receitas: [],
      totais: new Map(),
      percentuais: new Map(),
      manuais: [
        { linhaDREId: "DA.GGI.ASSESSORIAS_E_CONSULTORIAS", balde: "LEBEN", valor: D(700), filial: 1 },
        { linhaDREId: "DML.IRCS.IMPOSTO_DE_RENDA_E_CONTRIBUICAO_SOCIAL", balde: "LEBEN", valor: D(120), filial: 1 },
        { linhaDREId: "DML.IRCS.IMPOSTO_DE_RENDA_E_CONTRIBUICAO_SOCIAL", balde: "RN", valor: D(50), filial: 1 },
      ],
    });
    assert.deepEqual(avisos, []);
    assert.equal(v(resultados, 7, "DA.GGI.ASSESSORIAS_E_CONSULTORIAS"), 700);
    assert.equal(v(resultados, 7, "DML.IRCS.IMPOSTO_DE_RENDA_E_CONTRIBUICAO_SOCIAL"), 120);
    assert.equal(v(resultados, 7, "DML.DEDUCOES_DA_MARGEM_LIQUIDA_DML"), 120);
    assert.equal(v(resultados, 5, "DML.IRCS.IMPOSTO_DE_RENDA_E_CONTRIBUICAO_SOCIAL"), 50);
    assert.equal(v(resultados, 5, "DA.GGI.ASSESSORIAS_E_CONSULTORIAS"), 0);
    // O LEBEN não entra no Extra-Operacional (6), que também tem a conta do IR e CS.
    assert.equal(v(resultados, 6, "DML.IRCS.IMPOSTO_DE_RENDA_E_CONTRIBUICAO_SOCIAL"), 0);
    // O Consolidado soma a Leben, como o RN.
    const consolidado = consolidar(linhas, resultados);
    assert.equal(Number(consolidado.find((r) => r.codigo === "DML.IRCS.IMPOSTO_DE_RENDA_E_CONTRIBUICAO_SOCIAL")?.valor), 170);
  });

  it("um lançamento manual LEBEN só soma numa conta da Leben", () => {
    const [assessorias] = linhas;
    assert.deepEqual(abasQueSomam(assessorias, { filial: 1, balde: "LEBEN", rateio: false, manual: true }), [7]);
    assert.deepEqual(abasQueSomam({ ...assessorias, unidades: [4] }, { filial: 1, balde: "LEBEN", rateio: false, manual: true }), []);
  });

  it("a tabela Leben da aba Extra-Operacional das Premissas vem depois da do RN, com as mesmas contas", () => {
    assert.deepEqual(UNIDADES_EXTRA.map((u) => u.nome), ["Extra-Operacional", "RN", "Leben"]);
    assert.deepEqual(contasExtra(linhas, 7).map((l) => l.codigo), contasExtra(linhas, 5).map((l) => l.codigo));
  });
});
