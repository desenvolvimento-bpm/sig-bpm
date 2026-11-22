import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { beneficiosDaDiferenca, encargosDasMedias, encargosDoGrupo, FATOR_PADRAO, fatorDosEncargos, ITENS_DOS_ENCARGOS, maosDeObraDoGrupo } from "../src/services/cenarios/encargosCenario.js";
import { assinaturaDoQuadro, gruposDasMedias } from "../src/services/cenarios/maoDeObraDasMedias.js";

const MOD = ["CPP.MOD.REMUNERACOES_CLT", "CPP.MOD.REMUNERACOES_PJ", "CPP.MOD.ENCARGOS_E_BENEFICIOS", "CPP.MOD.HORAS_EXTRAS", "CPP.MOD.MULTAS_RESCISORIAS"];
const MOI = MOD.map((c) => c.replace(".MOD.", ".MOI."));
const centavos = (v: number) => Math.round(v * 100) / 100;

describe("encargos e benefícios dos centros de custo (19/10/2026)", () => {
  it("o padrão: INSS 29%, FGTS 8%, Férias (+1/3) 1/12 × 4/3 e Décimo Terceiro 1/12; o fator, com a incidência sobre as provisões, 63,64%", () => {
    const p = Object.fromEntries(ITENS_DOS_ENCARGOS.map((i) => [i.item, i.padrao]));
    assert.equal(p.INSS, 0.29);
    assert.equal(p.FGTS, 0.08);
    assert.equal(Math.round(p.FERIAS! * 1e6) / 1e6, 0.111111);
    assert.equal(Math.round(p.DECIMO_TERCEIRO! * 1e6) / 1e6, 0.083333);
    assert.equal(p.BENEFICIOS, null);
    // (0,37 + 0,1944) + 0,37 × 0,1944 (20/10/2026: com o INSS e o FGTS sobre as férias e o 13º).
    assert.equal(Math.round(FATOR_PADRAO * 1e4) / 1e4, 0.6364);
  });

  it("como o exemplo revisado: base × (soma dos %) + (INSS + FGTS) × (Férias + 13º) × base + Benefícios; o PJ não entra", () => {
    // JAN do Exemplo de Cálculo: 25.000 + 2.000 de horas extras, 1.500 de benefícios e 5.000 de PJ.
    const contas = new Map([["CPP.MOD.REMUNERACOES_CLT", 25000], ["CPP.MOD.HORAS_EXTRAS", 2000], ["CPP.MOD.REMUNERACOES_PJ", 5000]]);
    const r = encargosDoGrupo(MOD, "DIRETA", (c, mes) => (mes === 1 ? (contas.get(c) ?? 0) : 0), (venda, mes) => (venda === "BENEFICIOS" && mes === 1 ? 1500 : undefined));
    // 27.000 × 63,64% + 1.500 = 18.682,50 (o exemplo dá 18.681,47 com as férias em 1/12 × 1,333).
    assert.equal(centavos(r.get("CPP.MOD.ENCARGOS_E_BENEFICIOS")![0]), 18682.5);
    // Com as férias do exemplo (1/12 × 1,333), o mesmo valor da planilha.
    const exemplo = fatorDosEncargos((i) => ({ INSS: 0.29, FGTS: 0.08, FERIAS: (1 / 12) * 1.333, DECIMO_TERCEIRO: 1 / 12, BENEFICIOS: 0 })[i]);
    assert.equal(centavos(27000 * exemplo + 1500), 18681.47);
    assert.equal(r.get("CPP.MOD.ENCARGOS_E_BENEFICIOS")![1], 0);
  });

  it("o percentual gravado vale no lugar do padrão; os benefícios vão para a mão de obra da atribuição do grupo", () => {
    const contas = new Map([["CPP.MOD.REMUNERACOES_CLT", 1000], ["CPP.MOI.REMUNERACOES_CLT", 2000]]);
    const gravado = (venda: string) => (venda === "ENCARGOS_INSS" ? 0.2 : venda === "BENEFICIOS" ? 100 : undefined);
    const r = encargosDoGrupo([...MOD, ...MOI], "INDIRETA", (c) => contas.get(c) ?? 0, gravado);
    const fator = 0.28 + (1 / 9 + 1 / 12) + 0.28 * (1 / 9 + 1 / 12);
    assert.equal(centavos(r.get("CPP.MOD.ENCARGOS_E_BENEFICIOS")![0]), centavos(1000 * fator));
    assert.equal(centavos(r.get("CPP.MOI.ENCARGOS_E_BENEFICIOS")![0]), centavos(2000 * fator + 100));
    // Só uma mão de obra (as despesas): os benefícios vão para ela, qualquer que seja a atribuição.
    assert.deepEqual(maosDeObraDoGrupo(MOI, "DIRETA").map((m) => m.beneficios), [true]);
    assert.deepEqual(maosDeObraDoGrupo([...MOD, ...MOI], "DIRETA").map((m) => [m.encargos, m.beneficios]), [["CPP.MOD.ENCARGOS_E_BENEFICIOS", true], ["CPP.MOI.ENCARGOS_E_BENEFICIOS", false]]);
  });

  it("na referência realizada, os Benefícios Adicionais são a diferença: o cálculo volta aos encargos realizados (20/10/2026)", () => {
    // ESTRUTURA, JAN/2026: 126.812,76 + 5.288,63 de base e encargos realizados de 120.000 (exemplo).
    const real = new Map([["CPP.MOD.REMUNERACOES_CLT", 126812.76], ["CPP.MOD.HORAS_EXTRAS", 5288.63], ["CPP.MOD.ENCARGOS_E_BENEFICIOS", 120000]]);
    const beneficios = beneficiosDaDiferenca(MOD, "DIRETA", (c) => real.get(c) ?? 0);
    assert.equal(centavos(beneficios), centavos(120000 - 132101.39 * FATOR_PADRAO));
    const r = encargosDoGrupo(MOD, "DIRETA", (c) => real.get(c) ?? 0, (venda) => (venda === "BENEFICIOS" ? beneficios : undefined));
    assert.equal(centavos(r.get("CPP.MOD.ENCARGOS_E_BENEFICIOS")![0]), 120000);
    // Abaixo do cálculo, a diferença é negativa.
    assert.ok(beneficiosDaDiferenca(MOD, "DIRETA", (c) => (c.endsWith("ENCARGOS_E_BENEFICIOS") ? 1000 : c.endsWith("REMUNERACOES_CLT") ? 10000 : 0)) < 0);
  });
});

describe("a mão de obra das médias (22/11/2026)", () => {
  it("os Encargos pela Média de Referência da conta: na que leva os Benefícios Adicionais, a média deles sai e entra o valor do mês", () => {
    const medias = new Map([["CPP.MOD.ENCARGOS_E_BENEFICIOS", 1000], ["CPP.MOI.ENCARGOS_E_BENEFICIOS", 500]]);
    // Os Benefícios Adicionais: média 200; em março, 300 digitados; nos meses sem valor, zero.
    const gravado = (venda: string, mes: number) => (venda === "BENEFICIOS" ? (mes === 0 ? 200 : mes === 3 ? 300 : mes <= 2 ? 200 : undefined) : undefined);
    const r = encargosDasMedias([...MOD, ...MOI], "DIRETA", (c) => medias.get(c), gravado);
    assert.deepEqual(r.get("CPP.MOD.ENCARGOS_E_BENEFICIOS")!.slice(0, 4), [1000, 1000, 1100, 800]);
    // A outra mão de obra fica com a média dela, sem os benefícios e sem o cálculo pelos percentuais.
    assert.deepEqual(new Set(r.get("CPP.MOI.ENCARGOS_E_BENEFICIOS")), new Set([500]));
  });

  it("o grupo volta ao Quadro de Lotação quando o quadro dele muda (a assinatura)", () => {
    const doze = (v: number) => Array<number>(12).fill(v);
    const q = { aprendizes: doze(0), estagiarios: doze(0), clt: doze(3), pj: doze(1), salarios: { aprendizes: doze(0), estagiarios: doze(0), clt: doze(0), pj: doze(0) }, beneficios: doze(0), linhas: 2 };
    const quadro = new Map([["ACABAMENTO", q]]);
    const marcadores = new Map([["ACABAMENTO", assinaturaDoQuadro(q)], ["SEM QUADRO", assinaturaDoQuadro(undefined)]]);
    assert.deepEqual(gruposDasMedias(marcadores, quadro), { validos: new Set(["ACABAMENTO", "SEM QUADRO"]), vencidos: [] });
    // Um salário digitado no quadro do grupo: o marcador vence; o grupo sem quadro que ganha uma linha também.
    const comSalario = new Map([["ACABAMENTO", { ...q, salarios: { ...q.salarios, clt: doze(9000) } }], ["SEM QUADRO", { ...q, linhas: 1 }]]);
    assert.deepEqual(gruposDasMedias(marcadores, comSalario), { validos: new Set(), vencidos: ["ACABAMENTO", "SEM QUADRO"] });
    assert.equal(assinaturaDoQuadro(undefined), 0);
    assert.notEqual(assinaturaDoQuadro(q), 0);
  });
});
