import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { gerarXlsx, type AbaEscrita } from "../src/lib/xlsxEscrita.js";
import { CHAVES_DA_MATRIZ } from "../src/services/acesso/telas.js";
import { chaveDoNome, ImportacaoColaboradoresError, lerCompetencia, lerPlanilha } from "../src/services/colaboradores/importacaoCadastros.js";
import { ROTULO_DO_TIPO, tipoDoTexto } from "../src/services/colaboradores/tiposDoColaborador.js";
import { calcularQuadros, departamentosDoGrupo, indicadoresDoMes } from "../src/services/colaboradores/quadroService.js";
import { formulaEfetiva, montarIndicador } from "../src/services/relatorios/catalogoIndicadores.js";
import { lerItem } from "../src/services/relatorios/formulaIndicador.js";

const aba = (nome: string, linhas: Array<Array<string | number | null>>): AbaEscrita => ({
  nome,
  larguras: linhas[0]?.map(() => 12) ?? [12],
  linhas: linhas.map((l) => l.map((valor) => ({ valor }))),
});

describe("Gestão de Colaboradores (06/11/2026)", () => {
  it("a tela dos cadastros na matriz dos perfis, uma chave por aba (12/11/2026: nos Cadastros Auxiliares)", () => {
    // Os cadastros no processo Cadastros Auxiliares (12/11/2026, pedido do Adão), com as mesmas chaves.
    assert.deepEqual(CHAVES_DA_MATRIZ.filter((c) => c.recurso === "CADASTROS_AUXILIARES").map((c) => c.chave), [
      "colaboradores_cadastros",
      "colaboradores_cadastros.funcoes",
      "colaboradores_cadastros.movimentacoes",
      "colaboradores_cadastros.classificacoes",
      "colaboradores_cadastros.lancamento_inicial",
    ]);
    const doGrupo = CHAVES_DA_MATRIZ.filter((c) => c.recurso === "GESTAO_COLABORADORES").map((c) => c.chave);
    assert.deepEqual(doGrupo, [
      "colaboradores_quadro",
      "colaboradores_quadro.movimentacoes",
      "colaboradores_quadro.controle",
      "colaboradores_quadro.realizado",
      "colaboradores_quadro.jornada",
      "colaboradores_painel",
      "colaboradores_painel.resultados",
      "colaboradores_painel.indicadores",
    ]);
  });

  it("a planilha de Funções: a aba com o cabeçalho, com ou sem acento, e sem as linhas vazias", () => {
    const arquivo = gerarXlsx([
      aba("Capa", [["Funções da BPM"]]),
      aba("Funções", [
        ["Lista de funções"],
        ["FUNCAO", "Descrição", "Competências", "Atividades"],
        ["Analista Contábil", "Fecha o mês", "Contabilidade", "Conciliações"],
        [null, null, null, null],
        ["Jovem Aprendiz", null, null, null],
      ]),
    ]);
    const { aba: lida, itens } = lerPlanilha(arquivo, "funcoes");
    assert.equal(lida, "Funções");
    assert.deepEqual(
      itens.map((i) => [i.linha, i.valores.funcao, i.valores.descricao, i.valores.competencias]),
      [
        [3, "Analista Contábil", "Fecha o mês", "Contabilidade"],
        [5, "Jovem Aprendiz", "", ""],
      ],
    );
  });

  it("a planilha de Funções sem a senioridade (16/11/2026): a coluna Senioridade de uma planilha de antes não é lida", () => {
    const arquivo = gerarXlsx([aba("Funções", [["Função", "Descrição", "Senioridade", "Competências", "Atividades"], ["Analista Contábil", null, "Pleno", null, null]])]);
    assert.deepEqual(lerPlanilha(arquivo, "funcoes").itens[0].valores, { funcao: "Analista Contábil", descricao: "", competencias: "", atividades: "" });
  });

  it("o Lançamento Inicial exige as quatro colunas; a competência no formato aaaa-mm", () => {
    const semCentro = gerarXlsx([aba("QL", [["UNIDADE", "TIPO", "FUNÇÃO"], ["Matriz", "CLT", "Analista"]])]);
    assert.throws(() => lerPlanilha(semCentro, "lancamento-inicial"), (e) => e instanceof ImportacaoColaboradoresError && /CENTRO DE CUSTO/.test(e.message));
    const certo = gerarXlsx([aba("QL", [["Unidade", "Tipo", "Função", "Centro de Custo"], ["Matriz", "Aprendiz", "Jovem Aprendiz", "1.01 - CONTROLADORIA"]])]);
    assert.deepEqual(lerPlanilha(certo, "lancamento-inicial").itens[0].valores, { unidade: "Matriz", tipo: "Aprendiz", funcao: "Jovem Aprendiz", centro: "1.01 - CONTROLADORIA" });
    assert.deepEqual(lerCompetencia("2026-11"), { ano: 2026, mes: 11 });
    assert.throws(() => lerCompetencia("2026-13"), ImportacaoColaboradoresError);
    assert.throws(() => lerCompetencia(undefined), ImportacaoColaboradoresError);
  });

  it("o Lançamento Inicial sem os valores do colaborador (17/11/2026): as colunas de salário e de benefícios da planilha não se importam", () => {
    const arquivo = gerarXlsx([
      aba("QL", [
        ["Unidade", "Tipo", "Função", "Centro de Custo", "Salário Bruto (R$)", "ADICIONAL DE PERICULOSIDADE/INSALUBRIDADE", "Salário Total (R$)", "Cesta Basica / Seguro de Vida / Vale Alimentacao (R$)", "Plano de Saúde", "Vale-Transporte (R$)"],
        ["Matriz", "CLT", "Soldador", "1.11.00000001", 3200.5, 640, 9999, "450,00", "R$ 320", null],
      ]),
    ]);
    const { valores } = lerPlanilha(arquivo, "lancamento-inicial").itens[0];
    assert.deepEqual(valores, { unidade: "Matriz", tipo: "CLT", funcao: "Soldador", centro: "1.11.00000001" });
  });

  it("o quadro: o Lançamento Inicial no mês dele, só as aprovadas contam, e o final passa ao mês seguinte", () => {
    const carga = { ano: 2026, mes: 11, itens: [...Array(10)].map((_, i) => ({ centroCustoId: i < 6 ? "A" : "B", vinculo: (i < 8 ? "CLT" : "PJ") as "CLT" | "PJ" })) };
    const mov = (centroCustoId: string, contagem: "POSITIVA" | "NEGATIVA" | "NULA", status = "APROVADA", tipo = contagem === "POSITIVA" ? "Admissão" : contagem === "NEGATIVA" ? "Desligamento" : "Abertura de Vaga") => ({
      centroCustoId,
      vinculo: "CLT" as const,
      contagem,
      status,
      tipo,
    });
    const movimentos = (c: { mes: number }) =>
      c.mes === 11
        ? [mov("A", "POSITIVA"), mov("A", "POSITIVA", "PENDENTE"), mov("B", "NEGATIVA"), mov("B", "NULA"), mov("A", "POSITIVA", "REPROVADA")]
        : [mov("A", "NEGATIVA"), mov("A", "NEGATIVA")];
    const [nov, dez] = calcularQuadros([{ ano: 2026, mes: 12 }, { ano: 2026, mes: 11 }], carga, movimentos);
    assert.equal(nov.mes, 11);
    const i11 = indicadoresDoMes(nov);
    // 10 + 1 admissão − 1 desligamento; a pendente, a reprovada e a vaga não mudam o quadro.
    assert.equal(i11.quadroDeLotacao, 10);
    assert.equal(i11.contratacoes, 1);
    assert.equal(i11.turnover, (1 + 1) / 2 / 10);
    assert.deepEqual(nov.porTipo, { Admissão: 1, Desligamento: 1, "Abertura de Vaga": 1 });
    assert.equal(nov.final.get("A|CLT"), 7);
    // Dezembro parte do final de novembro.
    const i12 = indicadoresDoMes(dez);
    assert.equal(i12.quadroDeLotacao, 8);
    assert.equal(i12.contratacoes, 0);
    assert.equal(i12.turnover, 2 / 2 / 8);
  });

  it("a Metodologia: o Valor Registrado, o Quadro de Lotação por departamento ou centro e os Movimentos do QL do mês", () => {
    assert.deepEqual(lerItem("QL|TOTAL"), { tipo: "QL", chave: "DEP|TOTAL|GERAL" });
    assert.deepEqual(lerItem("QL|DEP|PRODUCAO_MATRIZ|DIRETA"), { tipo: "QL", chave: "DEP|PRODUCAO_MATRIZ|DIRETA" });
    assert.deepEqual(lerItem("QL|CC|1.01.00000001"), { tipo: "QL", chave: "CC|1.01.00000001" });
    assert.deepEqual(lerItem("MQL|#POSITIVA"), { tipo: "MQL", nome: "#POSITIVA" });
    assert.deepEqual(lerItem("REGISTRADO"), { tipo: "REGISTRADO" });
    assert.throws(() => lerItem("QL|DEP|FINANCEIRO|GERAL"));
    assert.throws(() => lerItem("QL|DEP|SERVICOS|OUTRA"));
    const dados = {
      dre: () => 0,
      volume: () => 0,
      importado: (n: string) => (n === "Turnover" ? 0.05 : null),
      quadro: (k: string) => (k === "DEP|TOTAL|GERAL" ? 40 : k === "DEP|PRODUCAO_MATRIZ|DIRETA" ? 12 : k === "CC|1.01" ? 3 : 0),
      movimentosQL: (t: string) => (t === "#POSITIVA" ? 3 : t === "#NEGATIVA" ? 1 : t === "Admissão" ? 2 : 0),
    };
    const linha = { grupo: "Administrativo", numero: "", sentido: "↓", unidade: "%", descricao: null, peso: null };
    // O Valor Registrado e a Metodologia vazia: o mesmo que o antigo [IND|Turnover].
    const registrado = montarIndicador({ ...linha, nome: "Turnover", formula: "[REGISTRADO]", modo: "SOMA" });
    const vazio = montarIndicador({ ...linha, nome: "Turnover", formula: null, modo: "SOMA" });
    const antigo = montarIndicador({ ...linha, nome: "Turnover", formula: "[IND|Turnover]", modo: "SOMA" });
    assert.equal(registrado.calculo(dados).valor, 0.05);
    assert.equal(vazio.calculo(dados).valor, 0.05);
    assert.equal(antigo.calculo(dados).valor, 0.05);
    assert.equal(formulaEfetiva({ nome: "X", formula: "  ", modo: "SISTEMA" }), null);
    // O Turnover e as contratações pelos Movimentos do QL.
    const turnover = montarIndicador({ ...linha, nome: "Turnover QL", formula: "([MQL|#POSITIVA] + [MQL|#NEGATIVA]) / 2 / [QL|DEP|TOTAL|GERAL]", modo: "ULTIMO" });
    assert.equal(turnover.calculo(dados).valor, 4 / 2 / 40);
    assert.equal(montarIndicador({ ...linha, nome: "Contratações", formula: "[MQL|#POSITIVA]", modo: "SOMA" }).calculo(dados).valor, 3);
    assert.equal(montarIndicador({ ...linha, nome: "MO Direta Matriz", formula: "[QL|DEP|PRODUCAO_MATRIZ|DIRETA]", modo: "ULTIMO" }).calculo(dados).valor, 12);
    assert.equal(montarIndicador({ ...linha, nome: "Centro", formula: "[QL|CC|1.01]", modo: "ULTIMO" }).calculo(dados).valor, 3);
  });

  it("os departamentos do Quadro de Lotação pelo grupo de centros, como nos cenários", () => {
    assert.deepEqual(departamentosDoGrupo({ grupoDRE: "CPP", balde: "FILIAL", unidade: 1 }), ["PRODUCAO_FILIAL", "PRODUCAO_GERAL"]);
    assert.deepEqual(departamentosDoGrupo({ grupoDRE: "CPP", balde: "UNIDADE", unidade: 2 }), ["PRODUCAO_FILIAL", "PRODUCAO_GERAL"]);
    assert.deepEqual(departamentosDoGrupo({ grupoDRE: "CPP", balde: "PRODUCAO", unidade: 1 }), ["PRODUCAO_MATRIZ", "PRODUCAO_GERAL"]);
    assert.deepEqual(departamentosDoGrupo({ grupoDRE: "CSM", balde: null, unidade: 1 }), ["SERVICOS"]);
    assert.deepEqual(departamentosDoGrupo({ grupoDRE: "DA", balde: null, unidade: 1 }), ["ADMINISTRATIVO"]);
  });

  it("os nomes da planilha batem com os cadastros sem diferença de acento, maiúsculas e espaços", () => {
    assert.equal(chaveDoNome("  Analista   Contábil "), chaveDoNome("ANALISTA CONTABIL"));
    assert.notEqual(chaveDoNome("Júnior"), chaveDoNome("Pleno"));
  });
});

describe("Gestão de Colaboradores: as funções e os tipos (16/11/2026: sem as senioridades)", () => {
  it("a planilha com várias abas: vale a que tem mais das colunas esperadas; as linhas só com 0 ficam de fora", () => {
    const arquivo = gerarXlsx([
      // A aba dos colaboradores tem Função e Descrição; a das funções, as quatro colunas.
      aba("QL (Corrigido)", [["Unidade", "CLT/PJ", "Função", "Descrição"], ["Filial", "CLT", "Conferente", "Conferente"], ["Filial", "CLT", "Conferente", "Conferente"]]),
      aba("Carga Inicial das Funções", [
        ["Função", "Descrição", "Competências", "Atividades"],
        ["Conferente", "Conferente", "<Descrever>", "<Descrever>"],
        ["Operador de Ponte", "Opera a ponte rolante", "<Descrever>", "<Descrever>"],
        [0, 0, 0, 0],
      ]),
    ]);
    const { aba: lida, itens } = lerPlanilha(arquivo, "funcoes");
    assert.equal(lida, "Carga Inicial das Funções");
    assert.deepEqual(
      itens.map((i) => [i.linha, i.valores.funcao]),
      [
        [2, "Conferente"],
        [3, "Operador de Ponte"],
      ],
    );
  });

  it("o Tipo pelo texto da planilha: CLT, PJ, Aprendiz e Estagiário, sem diferença de maiúsculas e acentos", () => {
    assert.equal(tipoDoTexto(" clt "), "CLT");
    assert.equal(tipoDoTexto("pj"), "PJ");
    assert.equal(tipoDoTexto("APRENDIZ"), "APRENDIZ");
    assert.equal(tipoDoTexto("Estagiário"), "ESTAGIARIO");
    assert.equal(tipoDoTexto("estagiario"), "ESTAGIARIO");
    assert.equal(tipoDoTexto("Júnior"), null);
    assert.equal(tipoDoTexto(""), null);
    assert.deepEqual(Object.values(ROTULO_DO_TIPO), ["CLT", "PJ", "Aprendiz", "Estagiário"]);
  });

  it("o quadro conta os quatro tipos em separado, no mesmo centro", () => {
    const tipos = ["CLT", "CLT", "APRENDIZ", "ESTAGIARIO", "PJ"] as const;
    const carga = { ano: 2026, mes: 11, itens: tipos.map((vinculo) => ({ centroCustoId: "A", vinculo })) };
    const [nov] = calcularQuadros([{ ano: 2026, mes: 11 }], carga, () => [{ centroCustoId: "A", vinculo: "APRENDIZ", contagem: "POSITIVA", status: "APROVADA", tipo: "Admissão" }]);
    assert.deepEqual(Object.fromEntries(nov.final), { "A|CLT": 2, "A|APRENDIZ": 2, "A|ESTAGIARIO": 1, "A|PJ": 1 });
    assert.equal(indicadoresDoMes(nov).quadroDeLotacao, 6);
  });
});
