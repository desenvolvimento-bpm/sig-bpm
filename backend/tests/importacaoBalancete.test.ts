import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { strToU8, zipSync } from "fflate";

import {
  conferirTotal,
  interpretarBalancete,
} from "../src/services/importacoes/balancete/leiauteBalancete.js";
import { ArquivoInvalidoError, lerAba, listarAbas, type LinhaPlanilha, type ValorCelula } from "../src/lib/xlsx.js";

// 46235 = 01/08/2026 e 46266 = 01/09/2026, como o Excel grava no cabeçalho.
const AGO = 46235;
const SET = 46266;
const CABECALHO: ValorCelula[] = [
  "FILIAL", "COD_CUSTO", "C_CUSTO", "SUB_COD_CONTA_4", "REDUZIDO_CONTA", "CONTA",
  AGO, AGO, AGO, SET, SET, SET, "Total Geral",
];

function planilha(...dados: ValorCelula[][]): LinhaPlanilha[] {
  return [CABECALHO, ...dados].map((celulas, i) => ({ numero: i + 1, celulas }));
}

/** Linha de dado: crédito, débito e movimentação de agosto. */
function linha(
  filial: ValorCelula,
  cc: string | null,
  conta: string,
  credito: number | null,
  debito: number | null,
  total: number | null,
): ValorCelula[] {
  return [filial, cc, cc ? `CENTRO ${cc}` : null, "3.02", conta, `CONTA ${conta}`, credito, debito, total];
}

describe("interpretarBalancete", () => {
  it("lê a movimentação do mês e ignora subtotais e linhas zeradas", () => {
    const r = interpretarBalancete(
      planilha(
        linha(1, "1.01.00000001", "2683", -100, null, -100),
        linha(1, "1.01.00000001", "2721", null, 40.004, 40.004),
        linha(1, "1.98.00003168", "45586", null, null, null),
        [1, "1.01.00000001", "FINANCEIRO", "3.02 Total", null, null, -100, 40, -60],
        ["Total Geral", null, null, null, null, null, -100, 40, -60],
      ),
      2026,
      8,
    );

    assert.ok(r.ok);
    assert.equal(r.lancamentos.length, 2);
    assert.equal(r.lancamentos[1].valorMovimento.toFixed(2), "40.00");
    assert.equal(r.lancamentos[0].codigoCentroCusto, "1.01.00000001");
    assert.deepEqual(r.ignoradas, { subtotais: 2, semMovimento: 1 });
    assert.equal(r.linhasLidas, 5);
    assert.equal(r.totalGeral?.toFixed(2), "-60.00");
    assert.equal(conferirTotal(r.somaArquivo, r.totalGeral), null);
  });

  it("recusa a linha cuja movimentação não é crédito + débito", () => {
    const r = interpretarBalancete(
      planilha(linha(1, "1.01", "2683", -100, 30, -60)),
      2026,
      8,
    );
    assert.ok(r.ok);
    assert.equal(r.lancamentos.length, 0);
    assert.equal(r.rejeicoes[0].codigo, "TOTAL_DIVERGENTE");
  });

  it("recusa filial inválida e linha repetida", () => {
    const r = interpretarBalancete(
      planilha(
        linha("X", "1.01", "2683", -1, null, -1),
        linha(2, "1.01", "2683", -1, null, -1),
        linha(2, "1.01", "2683", -2, null, -2),
      ),
      2026,
      8,
    );
    assert.ok(r.ok);
    assert.deepEqual(
      r.rejeicoes.map((x) => x.codigo),
      ["FILIAL_INVALIDA", "LINHA_DUPLICADA"],
    );
    assert.equal(r.lancamentos.length, 1);
  });

  it("recusa o arquivo sem a coluna do mês, dizendo quais meses ele traz", () => {
    const r = interpretarBalancete(planilha(linha(1, null, "2683", -1, null, -1)), 2026, 3);
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.motivo : "", /mar\/2026.*ago\/2026, set\/2026/);
  });

  it("recusa o arquivo sem as colunas obrigatórias", () => {
    const r = interpretarBalancete(
      [{ numero: 1, celulas: ["FILIAL", "REDUZIDO_CONTA", AGO] }],
      2026,
      8,
    );
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.motivo : "", /COD_CUSTO, C_CUSTO, CONTA/);
  });

  it("aponta quando a soma das linhas não confere com o Total Geral", () => {
    const r = interpretarBalancete(
      planilha(
        linha(1, null, "2683", -100, null, -100),
        ["Total Geral", null, null, null, null, null, -150, null, -150],
      ),
      2026,
      8,
    );
    assert.ok(r.ok);
    assert.match(conferirTotal(r.somaArquivo, r.totalGeral) ?? "", /diferença de 50.00/);
  });
});

/** Monta um .xlsx mínimo em memória, com as partes que o leitor usa. */
function xlsx(abas: Record<string, string>, textos: string[]): Uint8Array {
  const nomes = Object.keys(abas);
  const arquivos: Record<string, Uint8Array> = {
    "xl/workbook.xml": strToU8(
      `<workbook xmlns:r="r"><sheets>${nomes
        .map((n, i) => `<sheet name="${n.replace(/&/g, "&amp;")}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join("")}</sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<Relationships>${nomes
        .map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join("")}</Relationships>`,
    ),
    "xl/sharedStrings.xml": strToU8(
      `<sst>${textos.map((t) => `<si>${t}</si>`).join("")}</sst>`,
    ),
  };
  nomes.forEach((n, i) => {
    arquivos[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(
      `<worksheet><sheetData>${abas[n]}</sheetData></worksheet>`,
    );
  });
  return zipSync(arquivos);
}

describe("lerAba", () => {
  it("resolve textos compartilhados, texto em linha, entidades e colunas vazias", () => {
    const arquivo = xlsx(
      {
        "Resumo": `<row r="1"><c r="A1"><v>1</v></c></row>`,
        "P&D": [
          `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>`,
          `<row r="3"><c r="B3" t="inlineStr"><is><t>A &amp; B</t></is></c>`,
          `<c r="D3"><f>1+1</f><v>158881.51999999999</v></c><c r="E3" t="b"><v>1</v></c></row>`,
        ].join(""),
      },
      ["<t>FILIAL</t>", "<r><t>REDU</t></r><r><t>ZIDO</t></r><rPh><t>x</t></rPh>"],
    );

    assert.deepEqual(listarAbas(arquivo), ["Resumo", "P&D"]);
    const aba = lerAba(arquivo, (abas) => abas[1]);
    assert.equal(aba.nome, "P&D");
    assert.deepEqual(aba.linhas[0], { numero: 1, celulas: ["FILIAL", null, "REDUZIDO"] });
    assert.deepEqual(aba.linhas[1], {
      numero: 3,
      celulas: [null, "A & B", null, 158881.51999999999, true],
    });
  });

  it("recusa o que não é .xlsx e a escolha de aba inexistente", () => {
    assert.throws(() => listarAbas(strToU8("não sou um zip")), ArquivoInvalidoError);
    const arquivo = xlsx({ "Planilha1": "" }, []);
    assert.throws(() => lerAba(arquivo, () => null), /Abas encontradas: Planilha1/);
  });
});

describe("o balancete detalhado (15/10/2026)", () => {
  // Um mês por coluna, com CLI_FORN, EMISSAO e HISTORICO antes dos meses, como no LISTAS REALIZADO (RESULTADOS) novo.
  const cab: ValorCelula[] = ["FILIAL", "COD_CUSTO", "C_CUSTO", "SUB_COD_CONTA_4", "REDUZIDO_CONTA", "CONTA", "CLI_FORN", "EMISSAO", "HISTORICO", AGO, SET, "Total Geral"];
  const mov = (conta: string, cliForn: string | null, emissao: ValorCelula, historico: string, ago: number | null): ValorCelula[] => [1, "1.01.00000001", "CENTRO", "3.02", conta, `CONTA ${conta}`, cliForn, emissao, historico, ago, null, ago];
  const linhas = [
    cab,
    mov("2855", "FORNECEDOR A", 46240, "NF 123 FORNECEDOR A", -100),
    mov("2855", "FORNECEDOR A", 46240, "NF 123 FORNECEDOR A", -100),
    // Um histórico que termina em "Total" é movimento, não subtotal.
    mov("2855", null, 46241, "PAGAMENTO Total", -50),
    [1, "1.01.00000001", "CENTRO", "3.02", "2855", "CONTA 2855", null, "06/08/2026 00:00:00 Total", null, -250, null, -250],
    [1, "1.01.00000001", "CENTRO", "3.02", "2855", "CONTA 2855", " Total", null, null, -250, null, -250],
    ["1 Total", null, null, null, null, null, null, null, null, -250, null, -250],
    ["Total Geral", null, null, null, null, null, null, null, null, -250, null, -250],
  ].map((celulas, i) => ({ numero: i + 1, celulas }));

  it("lê cada movimento, com o detalhe, sem recusar a repetição e sem contar os subtotais", () => {
    const r = interpretarBalancete(linhas, 2026, 8);
    assert.ok(r.ok);
    assert.equal(r.rejeicoes.length, 0);
    assert.deepEqual(r.lancamentos.map((l) => l.valorMovimento.toNumber()), [-100, -100, -50]);
    assert.equal(r.lancamentos[0].cliForn, "FORNECEDOR A");
    assert.equal(r.lancamentos[0].emissao?.toISOString().slice(0, 10), "2026-08-06");
    assert.equal(r.lancamentos[2].historico, "PAGAMENTO Total");
    assert.equal(r.ignoradas.subtotais, 4);
    assert.equal(conferirTotal(r.somaArquivo, r.totalGeral), null);
  });

  // Duas tabelas dinâmicas na aba, uma embaixo da outra (22/10/2026): agosto numa, setembro noutra, cada uma com a sua Total Geral.
  const movSet = (conta: string, set: number): ValorCelula[] => [1, "1.01.00000001", "CENTRO", "3.02", conta, `CONTA ${conta}`, "FORNECEDOR B", 46270, "NF 9", null, set, set];
  const duasTabelas = [
    cab,
    mov("2855", "FORNECEDOR A", 46240, "NF 123", -100),
    ["Total Geral", null, null, null, null, null, null, null, null, -100, null, -100],
    movSet("2855", -30),
    movSet("2856", -20),
    ["Total Geral", null, null, null, null, null, null, null, null, null, -50, -50],
  ].map((celulas, i) => ({ numero: i + 1, celulas }));

  it("com duas tabelas na aba, confere cada mês com a Total Geral da tabela dele", () => {
    for (const [mes, total] of [[8, "-100.00"], [9, "-50.00"]] as const) {
      const r = interpretarBalancete(duasTabelas, 2026, mes);
      assert.ok(r.ok);
      assert.equal(r.totalGeral?.toFixed(2), total);
      assert.equal(r.tabelasDoMes, 1);
      assert.equal(conferirTotal(r.somaArquivo, r.totalGeral, r.tabelasDoMes), null);
    }
  });

  it("recusa o mesmo mês em duas tabelas da aba", () => {
    const repetido = [...duasTabelas.map((l) => l.celulas), mov("2855", "FORNECEDOR A", 46240, "NF 123", -100), ["Total Geral", null, null, null, null, null, null, null, null, -100, null, -100]].map((celulas, i) => ({ numero: i + 1, celulas }));
    const r = interpretarBalancete(repetido, 2026, 8);
    assert.ok(r.ok);
    assert.equal(r.tabelasDoMes, 2);
    assert.match(conferirTotal(r.somaArquivo, r.totalGeral, r.tabelasDoMes) ?? "", /aparece em 2 tabelas/);
  });
});

describe("a coluna ID do balancete (10/11/2026)", () => {
  // O ID do movimento no RM logo depois da FILIAL, como no LISTAS REALIZADO (RESULTADOS) de 10/11/2026.
  const cab: ValorCelula[] = ["FILIAL", "ID", "COD_CUSTO", "C_CUSTO", "SUB_COD_CONTA_4", "REDUZIDO_CONTA", "CONTA", "CLI_FORN", "EMISSAO", "HISTORICO", AGO, SET, "Total Geral"];
  const mov = (id: ValorCelula, valor: number): ValorCelula[] => [1, id, "1.01.00000001", "CENTRO", "3.02", "2855", "CONTA 2855", "FORNECEDOR A", 46240, "NF 123", valor, null, valor];
  const linhas = [
    cab,
    mov(16310, -100),
    mov("16311", -40),
    // Sem o ID (a coluna vazia, como no arquivo de 10/11/2026): o movimento entra, sem o ID.
    mov(null, -10),
    [1, null, "1.01.00000001", "CENTRO", "3.02", "2855", "CONTA 2855", "FORNECEDOR A Total", null, null, -150, null, -150],
    ["Total Geral", null, null, null, null, null, null, null, null, null, -150, null, -150],
  ].map((celulas, i) => ({ numero: i + 1, celulas }));

  it("lê o ID de cada movimento pelo nome da coluna, com as demais deslocadas", () => {
    const r = interpretarBalancete(linhas, 2026, 8);
    assert.ok(r.ok);
    assert.equal(r.rejeicoes.length, 0);
    assert.deepEqual(r.lancamentos.map((l) => l.idMovimento), ["16310", "16311", null]);
    assert.equal(r.lancamentos[0].codigoCentroCusto, "1.01.00000001");
    assert.equal(r.lancamentos[0].reduzido, "2855");
    assert.equal(r.lancamentos[0].historico, "NF 123");
    assert.equal(r.ignoradas.subtotais, 2);
    assert.equal(conferirTotal(r.somaArquivo, r.totalGeral), null);
  });

  it("sem a coluna, o ID fica vazio", () => {
    const semId = linhas.map((l) => ({ ...l, celulas: l.celulas.filter((_, i) => i !== 1) }));
    const r = interpretarBalancete(semId, 2026, 8);
    assert.ok(r.ok);
    assert.deepEqual(r.lancamentos.map((l) => l.idMovimento), [null, null, null]);
  });
});
