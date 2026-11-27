import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { INDICADORES_DE_CUSTO, montarCustosOperacionais, valorDoCusto, type SerieDeCustos } from "../src/services/relatorios/custosOperacionais.js";

/** Uma série com os valores por unidade e código (12 meses iguais, ou a lista de cada mês) e os meses que entram. */
function serie(valores: Record<string, number | number[]>, entra: (i: number) => boolean = () => true): SerieDeCustos {
  return {
    entra: (i) => entra(i),
    valor: (i, visao, codigo) => {
      const v = valores[`${visao}|${codigo}`];
      return Array.isArray(v) ? (v[i] ?? 0) : (v ?? 0);
    },
  };
}
const ind = (chave: string) => INDICADORES_DE_CUSTO.find((i) => i.chave === chave)!;

describe("Custos Operacionais (26/11/2026)", () => {
  it("tem os 23 indicadores do pedido, na ordem", () => {
    assert.equal(INDICADORES_DE_CUSTO.length, 23);
    assert.equal(INDICADORES_DE_CUSTO[0].descricao, "Mão de Obra Direta de Produção (Matriz) [R$/dia]");
    assert.equal(INDICADORES_DE_CUSTO[6].descricao, "Madeiras e Madeirites de Produção (Matriz) [R$/m³]");
    assert.equal(INDICADORES_DE_CUSTO[22].descricao, "Depreciação do Maquinário de Montagem [R$/dia]");
  });

  it("R$/dia: a soma dos três meses do trimestre ÷ 60; com menos meses, ÷ 20 por mês", () => {
    const s = serie({ "1|CPP.MOD.MAO_DE_OBRA_DIRETA": [600, 1200, 1800, 2400] }, (i) => i < 4);
    assert.equal(valorDoCusto(ind("mod_matriz"), s, [0, 1, 2]), 60);
    // O 2º trimestre só com abril: 2400 ÷ 20.
    assert.equal(valorDoCusto(ind("mod_matriz"), s, [3, 4, 5]), 120);
    // Nenhum mês do trimestre entra: null.
    assert.equal(valorDoCusto(ind("mod_matriz"), s, [6, 7, 8]), null);
  });

  it("R$/m³: a soma do custo ÷ a soma do volume (a média ponderada)", () => {
    const s = serie({ "1|CPP.MP.MATERIAIS_APLICADOS": [1000, 3000, 0], "1|P.PRODUCAO_DO_PRE_FABRICADO_M": [100, 100, 0] });
    assert.equal(valorDoCusto(ind("materiais_matriz"), s, [0, 1, 2]), 20);
    // Sem volume: null.
    assert.equal(valorDoCusto(ind("materiais_matriz"), serie({ "1|CPP.MP.MATERIAIS_APLICADOS": 10 }), [0]), null);
  });

  it("os Outros Gastos Gerais Variáveis ficam sem as Madeiras e Madeirites", () => {
    const s = serie({ "2|CPP.GGV.GASTOS_GERAIS_VARIAVEIS": 500, "2|CPP.GGV.MADEIRAS_E_MADEIRITES": 100, "2|P.PRODUCAO_DO_PRE_FABRICADO_M": 40 });
    assert.equal(valorDoCusto(ind("ggv_filial"), s, [0]), 10);
  });

  it("Serviços: a mão de obra soma a Montagem e a Complementar; os materiais são só os da Montagem, sobre a montagem", () => {
    const s = serie({
      "3|CSM.MOD.MAO_DE_OBRA_DIRETA": 1000,
      "3|CSC.MOD.MAO_DE_OBRA_DIRETA": 200,
      "3|CSM.MP.MATERIAIS_APLICADOS": 300,
      "3|CSC.MP.MATERIAIS_APLICADOS": 999,
      "3|S.MONTAGEM_DO_PRE_FABRICADO_M": 30,
    });
    assert.equal(valorDoCusto(ind("mod_servicos"), s, [0]), 60);
    assert.equal(valorDoCusto(ind("materiais_montagem"), s, [0]), 10);
  });

  it("monta os trimestres, a Média Mensal e a do comparado nos meses dele", () => {
    const s = serie({ "1|CPP.D.DEPRECIACAO": 2000 }, (i) => i < 9);
    const comparado = serie({ "1|CPP.D.DEPRECIACAO": 1000 });
    const r = montarCustosOperacionais(2026, 9, s, { serie: comparado, meses: [0, 1, 2, 3, 4, 5, 6, 7, 8] });
    const d = r.linhas.find((l) => l.chave === "depreciacao_matriz")!;
    assert.deepEqual(d.trimestres, [100, 100, 100, null]);
    assert.equal(d.media, 100);
    assert.equal(d.comparado, 50);
    assert.deepEqual(r.trimestres[3], { rotulo: "4º Trimestre", meses: [] });
    assert.equal(r.mesesDaMedia.length, 9);
    // Sem comparado: null.
    assert.equal(montarCustosOperacionais(2026, 9, s, null).linhas[0].comparado, null);
  });
});
