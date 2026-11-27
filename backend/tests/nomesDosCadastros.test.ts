import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { chaveDaLinha, linhasPorChave } from "../src/lib/linhas.js";
import { assinaturaParaGravar, cadastrosMudados } from "../src/services/apuracao/assinaturaCadastros.js";
import { nomeDaUnidade, nomeDaVisao, nomeDoBalde } from "../src/services/cadastros/nomesDasUnidades.js";
import { abasQueSomam } from "../src/services/dre/apuracaoUnidades.js";
import { casaComADescricao, descricaoDeOrigem, ehAConta, semOGrupo, slugDaDRE } from "../src/services/dre/descricaoDeOrigem.js";
import { manterOsCodigos } from "../src/services/cadastros/carga/aplicarCarga.js";
import type { CadastrosPreparados } from "../src/services/cadastros/carga/prepararCadastros.js";
import { comNomesDosIndicadores, comNomesNasFormulas, formulaComIds, formulaComNomes, mapasDosIndicadores, nomeDaReferencia, referenciaDoNome } from "../src/services/relatorios/referenciasDosIndicadores.js";

// Os nomes dos cadastros que mudam a qualquer momento (25/11/2026): as Linhas pelo Código, fixo desde a criação; as Unidades
// pelo código, com o nome do cadastro nas telas; e a assinatura dos cadastros sem os nomes.
describe("os nomes dos cadastros que mudam (25/11/2026)", () => {
  it("acha a linha pelo Código, que vale antes do Nome, e pelo Nome atual", () => {
    const linhas = [
      { id: "estacas", codigo: "ESTACAS", nome: "Estacas Protendidas" },
      { id: "fundacao", codigo: "FUNDAÇÃO", nome: "Fundação" },
      // Uma linha cujo Nome é o Código de outra (o cadastro recusa; aqui, para a precedência).
      { id: "outra", codigo: "OUTRA", nome: "Estacas" },
    ];
    const porChave = linhasPorChave(linhas);
    assert.equal(porChave.get(chaveDaLinha("ESTACAS"))?.id, "estacas");
    assert.equal(porChave.get(chaveDaLinha("estacas protendidas"))?.id, "estacas");
    assert.equal(porChave.get(chaveDaLinha("FUNDAÇÃO"))?.id, "fundacao");
    assert.equal(porChave.get(chaveDaLinha("TURN KEY")), undefined);
  });

  it("com o prefixo do tipo e a precedência da ordem (as de produto depois das de obra)", () => {
    const linhas = [
      { id: "obra", tipo: "OBRA", codigo: "MONTAGEM", nome: "Montagem" },
      { id: "produto", tipo: "PRODUTO", codigo: "MONTAGEM", nome: "Montagem" },
    ];
    assert.equal(linhasPorChave(linhas).get("MONTAGEM")?.id, "produto");
    const porTipo = linhasPorChave(linhas, (l) => `${l.tipo}|`);
    assert.equal(porTipo.get("OBRA|MONTAGEM")?.id, "obra");
    assert.equal(porTipo.get("PRODUTO|MONTAGEM")?.id, "produto");
  });

  it("os nomes das unidades e dos baldes, com os de sempre antes da carga do cadastro", () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6].map(nomeDaUnidade), ["Matriz", "Filial", "Serviços", "Despesas", "RN", "Extra-Operacional"]);
    assert.equal(nomeDaVisao(0), "Consolidado");
    assert.equal(nomeDaUnidade(9), "Unidade 9");
    assert.deepEqual(["MATRIZ", "FILIAL", "SERVICOS", "MONTAGEM"].map(nomeDoBalde), ["Matriz", "Filial", "Serviços", undefined]);
  });

  it("a assinatura gravada antes (com o nome) vale enquanto o nome não muda; a nova não tem a de antes", () => {
    const atual = { unidades: "novo-u", "unidades:comONome": "antigo-u", linhas: "novo-l", "linhas:comONome": "antigo-l", centros: "c" };
    // Gravada antes de 25/11/2026: as assinaturas com o nome.
    assert.deepEqual(cadastrosMudados(JSON.stringify({ unidades: "antigo-u", linhas: "antigo-l", centros: "c" }), atual), []);
    // O nome mudou depois: a de antes não bate mais, a nova também não (a apuração é anterior).
    assert.deepEqual(cadastrosMudados(JSON.stringify({ unidades: "outro-u", linhas: "antigo-l", centros: "c" }), atual), ["Unidades"]);
    // Gravada depois: a nova, sem a de antes.
    const gravada = assinaturaParaGravar(atual);
    assert.deepEqual(JSON.parse(gravada), { unidades: "novo-u", linhas: "novo-l", centros: "c" });
    assert.deepEqual(cadastrosMudados(gravada, { ...atual, "unidades:comONome": "nome-trocado" }), []);
  });

  it("as fórmulas pelo ID dos indicadores: gravadas com o ID, lidas com o nome atual (passo 2)", () => {
    const V = "11111111-1111-4111-8111-111111111111";
    const P = "22222222-2222-4222-8222-222222222222";
    const { nomePorId, idPorNome } = mapasDosIndicadores([
      { id: V, nome: "Venda: Total" },
      { id: P, nome: "Produção (Vol.): Total" },
    ]);
    const comNomes = "[INDICADOR|Venda: Total] / [META|Produção (Vol.): Total|ACUM] + [IND|Venda: Total] * [DRE|0|ROL.RLT] - [IND|Fora do Cadastro] + [REGISTRADO]";
    const comIds = formulaComIds(comNomes, idPorNome);
    assert.equal(comIds, `[INDICADOR|${V}] / [META|${P}|ACUM] + [IND|${V}] * [DRE|0|ROL.RLT] - [IND|Fora do Cadastro] + [REGISTRADO]`);
    assert.equal(formulaComNomes(comIds, nomePorId), comNomes);
    // O nome novo aparece sem mudar a fórmula gravada.
    assert.equal(formulaComNomes(`[INDICADOR|${V}]`, new Map([[V, "Vendas Totais"]])), "[INDICADOR|Vendas Totais]");
    // Um ID sem indicador fica como está (a fórmula acusa o item); a fórmula vazia, vazia.
    assert.equal(formulaComNomes("[INDICADOR|33333333-3333-4333-8333-333333333333]", nomePorId), "[INDICADOR|33333333-3333-4333-8333-333333333333]");
    assert.equal(formulaComIds(null, idPorNome), null);
    const card = comNomesNasFormulas({ formula: `[INDICADOR|${V}]`, percentual: `[INDICADOR|${P}]`, nome: "Card" }, nomePorId);
    assert.deepEqual(card, { formula: "[INDICADOR|Venda: Total]", percentual: "[INDICADOR|Produção (Vol.): Total]", nome: "Card" });
  });

  it("os valores pelo ID do indicador: gravados com o ID, lidos com o nome atual; sem indicador no cadastro, o nome (parte 2b)", () => {
    const V = "11111111-1111-4111-8111-111111111111";
    const r = mapasDosIndicadores([{ id: V, nome: "Venda: Total" }]);
    assert.equal(referenciaDoNome("Venda: Total", r), V);
    assert.equal(referenciaDoNome("Fora do Cadastro", r), "Fora do Cadastro");
    assert.equal(nomeDaReferencia(V, r), "Venda: Total");
    assert.equal(nomeDaReferencia(V, mapasDosIndicadores([{ id: V, nome: "Vendas Totais" }])), "Vendas Totais");
    assert.deepEqual(comNomesDosIndicadores([{ indicador: V, mes: 1 }, { indicador: "Fora do Cadastro", mes: 2 }], r), [
      { indicador: V, mes: 1, nome: "Venda: Total" },
      { indicador: "Fora do Cadastro", mes: 2, nome: "Fora do Cadastro" },
    ]);
  });

  it("as contas da DRE pela descrição de origem, no fim do código: a Descrição muda, as regras não (passo 3)", () => {
    assert.equal(slugDaDRE("Produção do Pré-Fabricado (m³)"), "PRODUCAO_DO_PRE_FABRICADO_M");
    assert.equal(descricaoDeOrigem("DVV.GGV.FRETE_E_DESCARGA"), "FRETE_E_DESCARGA");
    assert.equal(semOGrupo("CSM.MOD.REMUNERACOES_CLT"), "MOD.REMUNERACOES_CLT");
    const frete = { codigo: "DVV.GGV.FRETE_E_DESCARGA", descricao: "Fretes de Entrega" };
    assert.ok(ehAConta(frete, "Frete e Descarga"));
    assert.ok(casaComADescricao(frete, "FRETES DE ENTREGA") && casaComADescricao(frete, "Frete e Descarga") && !casaComADescricao(frete, "Comissões"));
    // O frete dos complementares em Serviços com outra Descrição: a mesma aba.
    const linha = { tipo: "ITEM" as const, codigo: frete.codigo, grupoSigla: "DVV", unidades: [1, 2, 3, 4] };
    assert.deepEqual(abasQueSomam(linha, { filial: 1, balde: "COMPLEMENTAR", rateio: false }), [3, 4]);
  });

  it("a Recarga dos Cadastros mantém o código da linha renomeada na planilha (nas linhas, nas fórmulas e nos vínculos)", () => {
    const dados = (descricao: string, ordem: number, expressao: string | null = null) => ({
      ordem, grupo: "DESPESAS VARIÁVEIS DE VENDA (DVV)", grupoSigla: "DVV", atribuicao: "Gastos Gerais Variáveis", atribuicaoSigla: "GGV", descricao, tipo: (expressao ? "SUBTOTAL" : "ITEM") as "ITEM" | "SUBTOTAL", expressao, definicao: null,
    });
    const p = {
      dre: {
        linhas: [
          { codigo: "DVV.GGV.FRETES_DE_ENTREGA", dados: dados("Fretes de Entrega", 1), unidades: [1] },
          { codigo: "DVV.GGV.GASTOS_GERAIS_VARIAVEIS", dados: dados("Gastos Gerais Variáveis", 2, "DVV.GGV.FRETES_DE_ENTREGA + DVV.GGV.OUTRA"), unidades: [1] },
        ],
      },
      vinculos: new Map<string, string | null>([["40001", "DVV.GGV.FRETES_DE_ENTREGA"], ["40002", null]]),
    } as unknown as CadastrosPreparados;
    const noBanco = [
      { id: "a", codigo: "DVV.GGV.FRETE_E_DESCARGA", tipo: "ITEM", grupo: "DESPESAS VARIÁVEIS DE VENDA (DVV)", ordem: 1 },
      { id: "b", codigo: "DVV.GGV.GASTOS_GERAIS_VARIAVEIS", tipo: "SUBTOTAL", grupo: "DESPESAS VARIÁVEIS DE VENDA (DVV)", ordem: 2 },
    ];
    const r = manterOsCodigos(p, noBanco);
    assert.deepEqual(r.dre.linhas.map((l) => [l.codigo, l.dados.descricao]), [["DVV.GGV.FRETE_E_DESCARGA", "Fretes de Entrega"], ["DVV.GGV.GASTOS_GERAIS_VARIAVEIS", "Gastos Gerais Variáveis"]]);
    assert.equal(r.dre.linhas[1].dados.expressao, "DVV.GGV.FRETE_E_DESCARGA + DVV.GGV.OUTRA");
    assert.deepEqual([...r.vinculos], [["40001", "DVV.GGV.FRETE_E_DESCARGA"], ["40002", null]]);
  });
});
