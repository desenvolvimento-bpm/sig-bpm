import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LinhaEstrutura } from "../src/services/dre/apuracaoUnidades.js";
import type { GrupoDoCenario } from "../src/services/cenarios/centrosCenario.js";
import { C } from "../src/services/cenarios/premissasCenario.js";
import { responsavelDa, textoDosMeses, verificar, type DadosDasVerificacoes, type LinhaDoQuadroVerificada } from "../src/services/cenarios/verificacoesCenario.js";

const linhaDRE = (codigo: string, descricao: string): LinhaEstrutura => ({
  id: codigo,
  codigo,
  tipo: "ITEM",
  grupo: codigo.split(".")[0],
  grupoSigla: codigo.split(".")[0],
  atribuicao: null,
  atribuicaoSigla: codigo.split(".")[1],
  descricao,
  expressao: null,
  unidades: [1, 2],
});
const EST = [linhaDRE("CPP.MOD.REMUNERACOES_CLT", "Remunerações CLT"), linhaDRE("CPP.GGD.ENERGIA", "Energia")];
const grupo = (nome: string, balde: string, centro = `c-${nome}`): GrupoDoCenario => ({
  grupo: nome,
  centros: [{ id: centro, origemId: null, codigo: "1.01", nome, balde }],
  balde,
  baldes: [balde],
  grupoDRE: "CPP",
  unidade: 1,
  destino: "Matriz",
  atribuicao: "DIRETA",
  departamento: null,
});
const doze = (f: (m: number) => { colaboradores: number; salario: number }) => Array.from({ length: 12 }, (_, k) => ({ mes: k + 1, ...f(k + 1) }));
const linhaQL = (extra: Partial<LinhaDoQuadroVerificada>): LinhaDoQuadroVerificada => ({
  id: "q1",
  vinculo: "CLT",
  funcao: "Operador",
  unidade: "Matriz",
  centroCustoId: "c-ACABAMENTO",
  centro: "1.01 - ACABAMENTO",
  nomeDoCentro: "ACABAMENTO",
  meses: doze(() => ({ colaboradores: 2, salario: 3000 })),
  ...extra,
});
const dados = (extra: Partial<DadosDasVerificacoes> = {}): DadosDasVerificacoes => ({
  ano: 2027,
  est: EST,
  linhas: [],
  premissas: [],
  grupos: [grupo("ACABAMENTO", "MATRIZ")],
  centros: [],
  percentuais: Array.from({ length: 12 }, () => new Map()),
  quadro: [],
  ...extra,
});
const tipos = (d: DadosDasVerificacoes) => verificar(d).map((v) => v.tipo);

describe("as Verificações das Premissas (20/11/2026)", () => {
  it("escreve os meses com as sequências juntas", () => {
    assert.equal(textoDosMeses([1, 2, 3, 4, 6, 7, 8, 9, 11, 12]), "Jan a Abr, Jun a Set, Nov e Dez");
    assert.equal(textoDosMeses([5]), "Mai");
    assert.equal(textoDosMeses([1, 3]), "Jan e Mar");
  });

  it("nas abas das unidades: os valores em meses sem volume e o volume sem receita", () => {
    const linhas = [{ codigo: "ESTRUTURA", nome: "Estrutura", unidade: 1 as const, medida: "m³" }];
    const rb = `RB:ESTRUTURA:${C.RBPF}`;
    const premissas = [
      ...[1, 2, 3, 4, 5, 6].map((mes) => ({ unidade: 1, venda: "GLOBAL", chave: "DEMANDA:ESTRUTURA", mes, valor: 10 })),
      ...[2, 3, 4, 5, 6, 7, 8].map((mes) => ({ unidade: 1, venda: "GLOBAL", chave: rb, mes, valor: 1000 })),
    ];
    const vs = verificar(dados({ linhas, premissas }));
    const semVolume = vs.find((v) => v.tipo === "VALORES_SEM_VOLUME")!;
    assert.deepEqual(semVolume.meses, [7, 8]);
    assert.equal(semVolume.aba, "1");
    const semReceita = vs.find((v) => v.tipo === "VOLUME_SEM_RECEITA")!;
    assert.deepEqual(semReceita.meses, [1]);
    // Corrigido (a receita de janeiro e a demanda de julho e agosto), nada fica.
    const corrigidas = [...premissas, { unidade: 1, venda: "GLOBAL", chave: rb, mes: 1, valor: 900 }, ...[7, 8].map((mes) => ({ unidade: 1, venda: "GLOBAL", chave: "DEMANDA:ESTRUTURA", mes, valor: 5 }))];
    assert.deepEqual(tipos(dados({ linhas, premissas: corrigidas })), []);
  });

  it("no Quadro de Lotação: sem salário, salário sem colaboradores, PJ sem aumento e salário que cai", () => {
    const semSalario = linhaQL({ meses: doze((m) => ({ colaboradores: 1, salario: m < 3 ? 0 : 2000 })) });
    assert.deepEqual(verificar(dados({ quadro: [semSalario] })).find((v) => v.tipo === "COLABORADORES_SEM_SALARIO")?.meses, [1, 2]);
    // Uma por centro de custo (22/11/2026), não por função: duas funções sem salário no mesmo centro, uma verificação só, com os
    // meses das duas e as duas linhas na origem; outro centro, outra.
    const outraFuncao = linhaQL({ id: "q2", funcao: "Ajudante", meses: doze((m) => ({ colaboradores: 1, salario: m === 5 ? 0 : 1800 })) });
    const outroCentro = linhaQL({ id: "q3", centroCustoId: "c-OUTRO", centro: "1.02 - OUTRO", nomeDoCentro: "OUTRO", meses: doze((m) => ({ colaboradores: 1, salario: m === 9 ? 0 : 2500 })) });
    const doCentro = verificar(dados({ quadro: [semSalario, outraFuncao, outroCentro] })).filter((v) => v.tipo === "COLABORADORES_SEM_SALARIO");
    assert.equal(doCentro.length, 2);
    // Na coluna, só o nome do centro (22/11/2026); a chave fica com o código.
    const acabamento = doCentro.find((v) => v.alvo === "ACABAMENTO")!;
    assert.deepEqual(acabamento.meses, [1, 2, 5]);
    assert.deepEqual(acabamento.origem, { tipo: "QUADRO", linhas: ["q2", "q1"] });
    assert.equal(acabamento.grupo, "ACABAMENTO");
    assert.match(acabamento.descricao, /nas 2 funções Ajudante \(CLT\); Operador \(CLT\)/);
    assert.equal(acabamento.chave, "COLABORADORES_SEM_SALARIO|1.01 - ACABAMENTO");
    assert.deepEqual(doCentro.find((v) => v.alvo === "OUTRO")?.meses, [9]);
    const semColab = linhaQL({ meses: doze((m) => ({ colaboradores: m === 12 ? 0 : 1, salario: 2000 })) });
    const salarioSemColab = verificar(dados({ quadro: [semColab] })).find((v) => v.tipo === "SALARIO_SEM_COLABORADORES")!;
    assert.deepEqual(salarioSemColab.meses, [12]);
    // Só o nome do centro na coluna; a função e o tipo no começo do texto.
    assert.equal(salarioSemColab.alvo, "ACABAMENTO");
    assert.match(salarioSemColab.descricao, /^Função Operador \(CLT\): com salário e sem colaboradores/);
    const pj = linhaQL({ vinculo: "PJ", meses: doze(() => ({ colaboradores: 1, salario: 9000 })) });
    assert.ok(tipos(dados({ quadro: [pj] })).includes("PJ_SEM_AUMENTO"));
    // Sem os valores das remunerações nos textos (23/11/2026, pedido do Adão): só a função.
    assert.equal(verificar(dados({ quadro: [pj] })).find((v) => v.tipo === "PJ_SEM_AUMENTO")?.descricao, "Função Operador (PJ): o salário não aumenta em nenhum dos 12 meses com colaboradores (Jan a Dez).");
    const pjComAumento = linhaQL({ vinculo: "PJ", meses: doze((m) => ({ colaboradores: 1, salario: m < 5 ? 9000 : 9500 })) });
    assert.ok(!tipos(dados({ quadro: [pjComAumento] })).includes("PJ_SEM_AUMENTO"));
    const cai = linhaQL({ meses: doze((m) => ({ colaboradores: 1, salario: m === 3 ? 5000 : 3000 })) });
    const queCai = verificar(dados({ quadro: [cai] })).find((v) => v.tipo === "SALARIO_QUE_CAI")!;
    assert.deepEqual(queCai.meses, [4]);
    assert.ok(!queCai.descricao.includes("R$"));
  });

  it("nos Centros de Custo: salários que não variam, Quadro sem Remunerações ou sem Gastos Gerais", () => {
    // Um colaborador novo sem salário em junho: os colaboradores mudam e os salários do grupo não.
    const quadro = [linhaQL({}), linhaQL({ id: "q2", funcao: "Ajudante", meses: doze((m) => ({ colaboradores: m >= 6 ? 1 : 0, salario: 0 })) })];
    const vs = verificar(dados({ quadro }));
    assert.deepEqual(vs.find((v) => v.tipo === "SALARIOS_SEM_VARIACAO")?.meses, [6]);
    assert.equal(vs.find((v) => v.tipo === "SALARIOS_SEM_VARIACAO")?.alvo, "ACABAMENTO");
    assert.match(vs.find((v) => v.tipo === "SALARIOS_SEM_VARIACAO")!.descricao, /\(2 → 3 colab\.\)/);
    // Os Gastos Gerais do grupo só em parte do ano.
    const centros = [1, 2, 3].map((mes) => ({ grupo: "ACABAMENTO", codigo: "CPP.GGD.ENERGIA", mes, valor: 100 }));
    assert.deepEqual(verificar(dados({ quadro, centros })).find((v) => v.tipo === "QUADRO_SEM_GASTOS_GERAIS")?.meses, [4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const semRemuneracoes = verificar(dados({ quadro: [linhaQL({ meses: doze(() => ({ colaboradores: 3, salario: 0 })) })], centros }));
    assert.equal(semRemuneracoes.find((v) => v.tipo === "QUADRO_SEM_REMUNERACOES")?.meses.length, 12);
    // A mão de obra das médias (22/11/2026): uma por grupo, com o texto pedido, no lugar do Quadro de Lotação sem Remunerações.
    const comMedias = verificar(dados({ quadro: [linhaQL({ meses: doze(() => ({ colaboradores: 3, salario: 0 })) })], centros, maoDeObraDasMedias: ["ACABAMENTO"] }));
    const dasMedias = comMedias.filter((v) => v.tipo === "MAO_DE_OBRA_DAS_MEDIAS");
    assert.equal(dasMedias.length, 1);
    assert.equal(dasMedias[0].alvo, "ACABAMENTO");
    assert.equal(dasMedias[0].descricao, "Médias das Remunerações, Encargos e Benefícios replicadas diretamente nos Centros de Custo (sem origem do Quadro de Lotação).");
    assert.ok(!comMedias.some((v) => v.tipo === "QUADRO_SEM_REMUNERACOES"));
  });

  it("os valores que o rateio do grupo não leva a nenhuma unidade (a chave sem base no mês)", () => {
    const grupos = [grupo("METALURGIA", "METALURGIA")];
    const centros = [{ grupo: "METALURGIA", codigo: "CPP.MOD.REMUNERACOES_CLT", mes: 1, valor: 500 }];
    const fora = verificar(dados({ grupos, centros })).find((v) => v.tipo === "VALORES_FORA_DA_DRE")!;
    assert.deepEqual(fora.meses, [1]);
    assert.match(fora.descricao, /Metalurgia não tem base/);
    // Só o nome do centro na coluna (22/11/2026); a conta no começo do texto.
    assert.equal(fora.alvo, "METALURGIA");
    assert.match(fora.descricao, /^Remunerações CLT: os valores de 1 mês \(Jan\) não chegam à DRE/);
    // Numa conta de gastos gerais (não de mão de obra), o valor continua no texto.
    const foraGastos = verificar(dados({ grupos, centros: [{ grupo: "METALURGIA", codigo: "CPP.GGD.ENERGIA", mes: 1, valor: 500 }] })).find((v) => v.tipo === "VALORES_FORA_DA_DRE")!;
    assert.match(foraGastos.descricao, /^Energia: R\$\s?500,00 em 1 mês/);
    // Com base no mês (a Matriz), o valor chega à DRE.
    const percentuais = Array.from({ length: 12 }, () => new Map([["METALURGIA|MATRIZ", 1]]));
    assert.ok(!tipos(dados({ grupos, centros, percentuais })).includes("VALORES_FORA_DA_DRE"));
  });

  it("o responsável: quem alterou por último os valores da verificação no Histórico", () => {
    const origem = { origem: { tipo: "PREMISSAS" as const, unidade: 1, venda: "GLOBAL", chaves: ["DEMANDA:ESTRUTURA"] } };
    const e = (nome: string, extra: object) => ({ criadoEm: new Date(), usuarioId: nome, usuarioNome: nome, tipo: "VALOR", visao: null, contas: null, alcance: null, ...extra });
    const historico = [
      e("Filial", { visao: 2, contas: [{ codigo: "DEMANDA:ESTRUTURA" }] }),
      e("Importou", { tipo: "IMPORTACAO", contas: [{ codigo: "P|1|GLOBAL|DEMANDA:ESTRUTURA" }] }),
      e("Digitou", { visao: 1, contas: [{ codigo: "DEMANDA:ESTRUTURA" }] }),
    ];
    assert.equal(responsavelDa(origem, historico)?.nome, "Importou");
    assert.equal(responsavelDa(origem, historico.slice(2))?.nome, "Digitou");
    assert.equal(responsavelDa(origem, [e("Filial", { visao: 2, contas: [{ codigo: "DEMANDA:ESTRUTURA" }] })]), null);
    // A linha do Quadro, pelo id; e os Centros, pela conta no grupo.
    assert.equal(responsavelDa({ origem: { tipo: "QUADRO", linhas: ["q1"] } }, [e("Gestor", { contas: [{ codigo: "QUADRO|q1" }] })])?.nome, "Gestor");
    const centros = { origem: { tipo: "CENTROS" as const, grupo: "ACABAMENTO", contas: ["CPP.GGD.ENERGIA"] } };
    assert.equal(responsavelDa(centros, [e("Outro", { contas: [{ codigo: "CPP.GGD.ENERGIA" }], alcance: [{ g: "OUTRO" }] })]), null);
    assert.equal(responsavelDa(centros, [e("Gestor", { contas: [{ codigo: "CPP.GGD.ENERGIA" }], alcance: [{ g: "ACABAMENTO" }] })])?.nome, "Gestor");
  });
});
