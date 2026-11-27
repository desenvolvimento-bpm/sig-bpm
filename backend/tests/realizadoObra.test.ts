import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { permissoesDasRotas, semRecorte } from "../src/services/acesso/acesso.js";
import { chaveValida } from "../src/services/acesso/telas.js";
import { ehContaDosCreditos } from "../src/services/impostos/creditosImpostosService.js";
import { lerCreditos } from "../src/services/importacoes/impostos/leituraCreditos.js";
import { separarPorConta } from "../src/services/importacoes/impostos/processarCreditos.js";
import { interpretarDreVendida, type LinhaVendida } from "../src/services/importacoes/dreComercial/leiauteDreComercial.js";
import { SEM_LINHA_NO_VENDIDO, vendidoNaEstrutura } from "../src/services/realizadoObra/dreVendida.js";
import { codigosDasVendas, comOsCreditos, receitasPorLinha, semAsContasAgrupadas } from "../src/services/realizadoObra/realizadoObraService.js";
import { basesDoRateio, dividirPelasObras, pesosDasObras, ratearEntreObras, SEM_OBRA, somarNaObra, type ValoresDasObras } from "../src/services/resultadosLinha/divisaoEntreObras.js";
import type { LinhaDRE } from "../src/services/resultadosLinha/resultadosLinhaService.js";
import type { LinhaPlanilha } from "../src/lib/xlsx.js";

const linhaDRE = (codigo: string, tipo: string, descricao: string, expressao: string | null = null): LinhaDRE => {
  const partes = codigo.split(".");
  return { id: codigo, codigo, tipo, grupo: partes[0], grupoSigla: partes[0], atribuicaoSigla: partes.length === 3 ? partes[1] : null, descricao, expressao, unidades: [1, 2, 3] };
};

describe("Realizado por Obra: a divisão entre as obras (03/11/2026)", () => {
  it("as bases do rateio: as da etapa Linhas", () => {
    assert.deepEqual(basesDoRateio("CPP", 1, "ESTRUTURA"), ["M3_PRODUZIDO", "KG_METALURGIA"]);
    assert.deepEqual(basesDoRateio("CSM", 3, "MONTAGEM"), ["M3_MONTAGEM", "DIAS_ACOMPANHAMENTO"]);
    // Os custos complementares, em qualquer linha, só pelos dias de acompanhamento (03/11/2026).
    assert.deepEqual(basesDoRateio("CSC", 3, "FUNDACAO"), ["DIAS_ACOMPANHAMENTO"]);
    assert.deepEqual(basesDoRateio("CSC", 3, "MONTAGEM"), ["DIAS_ACOMPANHAMENTO"]);
    assert.deepEqual(basesDoRateio("CSM", 3, "VEDACAO"), ["DIAS_ACOMPANHAMENTO", "M3_MONTAGEM"]);
    assert.deepEqual(basesDoRateio("DVV", 2, "ALVEOLARES"), ["RECEITA"]);
  });

  it("as obras genéricas e os registros sem obra ficam fora da base", () => {
    const dados = {
      volumes: [
        { total: "PREFABRICADO_MATRIZ" as const, linhaId: "L", obraId: "A", quantidade: 30 },
        { total: "PREFABRICADO_MATRIZ" as const, linhaId: "L", obraId: "G11", quantidade: 10 },
        { total: "PREFABRICADO_MATRIZ" as const, linhaId: "L", obraId: null, quantidade: 5 },
        { total: "PREFABRICADO_MATRIZ" as const, linhaId: "OUTRA", obraId: "B", quantidade: 99 },
        { total: "EXPEDICAO_MATRIZ" as const, linhaId: "L", obraId: "B", quantidade: 50 },
      ],
      receita: [
        { natureza: "PRE_FABRICADO", unidade: 1, linhaId: "L", obraCodigo: "G1", bruta: 100, liquida: 90 },
        { natureza: "DEVOLUCOES_INVENTARIOS", unidade: 1, linhaId: "L", obraCodigo: "G2", bruta: -40, liquida: -36 },
      ],
    };
    const genericas = new Set(["G11"]);
    assert.deepEqual([...pesosDasObras("M3_PRODUZIDO", "L", dados, genericas, (c) => c ?? SEM_OBRA)], [["A", 30]]);
    // Na receita, as devoluções não são base.
    assert.deepEqual([...pesosDasObras("RECEITA", "L", dados, genericas, (c) => c ?? SEM_OBRA)], [["G1", 100]]);
  });

  it("o rateio vai pelos primeiros pesos que houver; sem nenhum, Sem Obra", () => {
    assert.deepEqual(ratearEntreObras(100, [() => new Map(), () => new Map([["A", 1], ["B", 3]])]), [["A", 25], ["B", 75]]);
    assert.deepEqual(ratearEntreObras(100, [() => new Map()]), [[SEM_OBRA, 100]]);
    assert.deepEqual(dividirPelasObras(60, new Map()), [[SEM_OBRA, 60]]);
  });

  it("soma o valor e a parte direta de cada obra", () => {
    const v: ValoresDasObras = new Map();
    somarNaObra(v, "L", "A", "CPP.MP.CIMENTO", 70, true);
    somarNaObra(v, "L", "A", "CPP.MP.CIMENTO", 30, false);
    assert.deepEqual(v.get("L")?.get("A")?.get("CPP.MP.CIMENTO"), { valor: 100, direto: 70 });
  });
});

describe("Realizado por Obra: os Créditos de Impostos (04/11/2026)", () => {
  const l = (numero: number, celulas: LinhaPlanilha["celulas"]): LinhaPlanilha => ({ numero, celulas });
  const CAB = ["PERÍODO", "UNIDADE", "ATRIBUIÇÃO", "CONTA", "CREDITADO (R$)", "ESTORNADO (R$)", "% ESTORNADO"];

  it("lê a aba Impostos (Lista): o Creditado e o Estornado do mês por unidade e conta (a atribuição e o nome)", () => {
    const r = lerCreditos(
      [
        l(1, CAB),
        l(2, [46023, "Matriz", "Matérias Primas", "Cimento", 28019.48, 17609.83, 0.63]),
        l(3, [46023, "Filial", "Gastos Gerais Variáveis", "Frete e Descarga", 28249.35, null, 0]),
        l(4, [46054, "Matriz", "Matérias Primas", "Cimento", 32606.11, 22282.24, 0.68]),
        l(5, [46023, "Serviços", "Matérias Primas", "Cimento", 1, 0, 0]),
        l(6, [46023, "Matriz", "Matérias Primas", "Cimento", 5, 1, 0.2]),
        l(7, [46023, "Filial", "Matérias Primas", "Agregados", -3, 0, 0]),
        l(8, [46023, "Matriz", "Gastos Gerais Diretos", "Outros Custos/Despesas", 10, 4, 0.4]),
        l(9, [46023, "Matriz", "Gastos Gerais Indiretos", "Outros Custos/Despesas", 20, 5, 0.25]),
        l(10, [46023, "Matriz", "gastos gerais diretos", "OUTROS CUSTOS/DESPESAS", 1, 0, 0]),
        l(11, [46023, "Matriz", null, "Agregados", 1, 0, 0]),
      ],
      2026,
      1,
    );
    assert.ok(r.ok);
    assert.deepEqual(
      r.itens.map((i) => [i.unidade, i.atribuicao, i.conta, i.creditado, i.estornado]),
      [
        [1, "Matérias Primas", "Cimento", 28019.48, 17609.83],
        [2, "Gastos Gerais Variáveis", "Frete e Descarga", 28249.35, 0],
        [1, "Gastos Gerais Diretos", "Outros Custos/Despesas", 10, 4],
        [1, "Gastos Gerais Indiretos", "Outros Custos/Despesas", 20, 5],
      ],
    );
    assert.equal(r.foraDoMes, 1);
    assert.deepEqual(
      r.rejeicoes.map((x) => [x.linha, x.codigo]),
      [
        [5, "UNIDADE_INVALIDA"],
        [6, "REPETIDA"],
        [7, "VALOR_INVALIDO"],
        [10, "REPETIDA"],
        [11, "SEM_CONTA"],
      ],
    );
  });

  it("recusa a aba sem as colunas da atribuição, do Creditado e do Estornado", () => {
    assert.equal(lerCreditos([l(1, ["PERÍODO", "UNIDADE", "CONTA", "CREDITADO (R$)"])], 2026, 1).ok, false);
    assert.equal(lerCreditos([l(1, ["PERÍODO", "UNIDADE", "CONTA", "CREDITADO (R$)", "ESTORNADO (R$)"])], 2026, 1).ok, false);
  });

  it("as contas: Matérias Primas, Gastos Gerais Variáveis da Produção e o Frete e Descarga", () => {
    assert.equal(ehContaDosCreditos("CPP.MP.CIMENTO"), true);
    assert.equal(ehContaDosCreditos("CPP.GGV.EQUIPAMENTOS_LOCADOS"), true);
    assert.equal(ehContaDosCreditos("DVV.GGV.FRETE_E_DESCARGA"), true);
    assert.equal(ehContaDosCreditos("CPP.MP.MATERIAS_PRIMAS"), false);
    assert.equal(ehContaDosCreditos("CPP.GGD.OUTROS_CUSTOS_DESPESAS"), false);
    assert.equal(ehContaDosCreditos("CSM.MP.CONCRETO_E_GRAUTE"), false);
    assert.equal(ehContaDosCreditos("DVV.GGV.COMISSOES_DE_REPRESENTANTES_E_TERCEIROS"), false);
    assert.equal(ehContaDosCreditos("CSM.MP.ACO_CA_E_CP"), false);
  });

  it("a importação: as contas dos créditos pela atribuição e pelo nome; as outras da Estrutura, ignoradas; as que ela não tem, recusadas", () => {
    const item = (linhaArquivo: number, atribuicao: string, conta: string) => ({ linhaArquivo, unidade: 1 as const, atribuicao, conta, creditado: 10, estornado: 1 });
    const r = separarPorConta(
      [
        item(2, "Matérias Primas", "CIMENTO"),
        item(3, "Gastos Gerais Variáveis", "Frete e Descarga"),
        item(4, "Gastos Gerais Diretos", "Outros Custos/Despesas"),
        item(5, "Gastos Gerais Indiretos", "Outros Custos/Despesas"),
        item(6, "Matérias Primas", "Concreto e Graute"),
        item(7, "Matérias Primas", "Cimentos"),
        item(8, "Gastos Gerais Diretos", "Cimento"),
      ],
      [
        { id: "cim", atribuicao: "Matérias Primas", codigo: "CPP.MP.CIMENTO", descricao: "Cimento" },
        { id: "frete", atribuicao: "Gastos Gerais Variáveis", codigo: "DVV.GGV.FRETE_E_DESCARGA", descricao: "Frete e Descarga" },
      ],
      [
        { atribuicao: "Matérias Primas", codigo: "CPP.MP.CIMENTO", descricao: "Cimento" },
        { atribuicao: "Matérias Primas", codigo: "CPP.MP.CONCRETO_E_GRAUTE", descricao: "Concreto e Graute" },
        { atribuicao: "Gastos Gerais Variáveis", codigo: "DVV.GGV.FRETE_E_DESCARGA", descricao: "Frete e Descarga" },
        { atribuicao: "Gastos Gerais Diretos", codigo: "CPP.GGD.OUTROS_CUSTOS_DESPESAS", descricao: "Outros Custos/Despesas" },
        { atribuicao: "Gastos Gerais Indiretos", codigo: "CPP.GGI.OUTROS_CUSTOS_DESPESAS", descricao: "Outros Custos/Despesas" },
      ],
    );
    assert.deepEqual(
      r.creditos.map((c) => [c.linhaArquivo, c.linhaDREId]),
      [
        [2, "cim"],
        [3, "frete"],
      ],
    );
    assert.deepEqual(
      r.ignoradas.map((i) => i.linhaArquivo),
      [4, 5, 6],
    );
    assert.deepEqual(
      r.rejeicoes.map((x) => [x.linha, x.codigo]),
      [
        [7, "CONTA_DESCONHECIDA"],
        [8, "CONTA_DESCONHECIDA"],
      ],
    );
  });

  it("na venda mercantil, sem o Estornado; na global, sem o Estornado e com o Creditado reaplicado", () => {
    const p = { creditado: 0.2, estornado: 0.05 };
    assert.equal(Math.round(comOsCreditos(1000, "MERCANTIL", p)! * 100) / 100, 950);
    assert.equal(Math.round(comOsCreditos(1000, "GLOBAL", p)! * 100) / 100, 1187.5);
  });

  it("sem o ajuste quando um percentual chega a 100%", () => {
    assert.equal(comOsCreditos(1000, "GLOBAL", { creditado: 2.5, estornado: 0.5 }), null);
    assert.equal(comOsCreditos(1000, "MERCANTIL", { creditado: 2.5, estornado: 0.5 }), 500);
    assert.equal(comOsCreditos(1000, "MERCANTIL", { creditado: 0.2, estornado: 1 }), null);
  });
});

describe("Realizado por Obra: o Vendido (03/11/2026)", () => {
  const est: LinhaDRE[] = [
    linhaDRE("ROB.RECEITA_OPERACIONAL_BRUTA_ROB", "SUBTOTAL", "RECEITA OPERACIONAL BRUTA (ROB)", "ROB.RBPF.RECEITA_BRUTA_DO_PRE_FABRICADO"),
    linhaDRE("ROB.RBPF.RECEITA_BRUTA_DO_PRE_FABRICADO", "ITEM", "Receita Bruta do Pré-Fabricado"),
    linhaDRE("IRB.IO.IMPOSTOS_OPERACIONAIS", "TOTAL", "Impostos Operacionais", "ROB.RECEITA_OPERACIONAL_BRUTA_ROB-ROL.RECEITA_OPERACIONAL_LIQUIDA_ROL"),
    linhaDRE("ROL.RECEITA_OPERACIONAL_LIQUIDA_ROL", "SUBTOTAL", "RECEITA OPERACIONAL LÍQUIDA (ROL)", "ROL.RLPF.RECEITA_LIQUIDA_DO_PRE_FABRICADO"),
    linhaDRE("ROL.RLPF.RECEITA_LIQUIDA_DO_PRE_FABRICADO", "ITEM", "Receita Líquida do Pré-Fabricado"),
    linhaDRE("CPP.CUSTOS_DE_PRODUCAO_PRE_FABRICADOS_CPP", "SUBTOTAL", "CUSTOS DE PRODUÇÃO: PRÉ-FABRICADOS (CPP)", "CPP.MOD.MAO_DE_OBRA_DIRETA + CPP.MP.MATERIAS_PRIMAS + CPP.GGV.GASTOS_GERAIS_VARIAVEIS"),
    linhaDRE("CPP.MOD.MAO_DE_OBRA_DIRETA", "SUBTOTAL", "Mão de Obra Direta", "CPP.MOD.REMUNERACOES_CLT"),
    linhaDRE("CPP.MOD.REMUNERACOES_CLT", "ITEM", "Remunerações CLT"),
    linhaDRE("CPP.MP.MATERIAS_PRIMAS", "SUBTOTAL", "Matérias Primas", "CPP.MP.CIMENTO"),
    linhaDRE("CPP.MP.CIMENTO", "ITEM", "Cimento"),
    linhaDRE("CPP.GGV.GASTOS_GERAIS_VARIAVEIS", "SUBTOTAL", "Gastos Gerais Variáveis", "CPP.GGV.MADEIRAS_E_MADEIRITES"),
    linhaDRE("CPP.GGV.MADEIRAS_E_MADEIRITES", "ITEM", "Madeiras e Madeirites"),
    linhaDRE("DVV.DESPESAS_VARIAVEIS_DE_VENDA_DVV", "TOTAL", "DESPESAS VARIÁVEIS DE VENDA (DVV)", "DVV.GGV.GASTOS_GERAIS_VARIAVEIS"),
    linhaDRE("DVV.GGV.GASTOS_GERAIS_VARIAVEIS", "SUBTOTAL", "Gastos Gerais Variáveis", "DVV.GGV.FRETE_E_DESCARGA"),
    linhaDRE("DVV.GGV.FRETE_E_DESCARGA", "ITEM", "Frete e Descarga"),
    linhaDRE("P.PRODUCAO_DO_PRE_FABRICADO_PISTAS", "ITEM", "Produção do Pré-Fabricado (pistas)"),
  ];
  const noEscopo = new Set(est.map((l) => l.codigo));
  const venda = (departamento: string, conta: string, atribuicao: string, valorTotal: number, linhaTexto = "ESTRUTURA"): LinhaVendida => ({
    obra: "G1",
    versao: 0,
    venda: "Global",
    etapa: "PRODUÇÃO",
    unidade: "MATRIZ",
    linhaTexto,
    departamento,
    conta,
    atribuicao,
    valorTotal,
  });
  const cadastro = [{ id: "ESTRUTURA", nome: "Estrutura", unidade: 1 }];

  it("leva cada conta ao item, ao subtotal ou ao grupo, e calcula os impostos (ROB − ROL)", () => {
    const { valores, naoAchadas } = vendidoNaEstrutura(
      [
        venda("ROB", "Receita Bruta do Pré-Fabricado", "Receita Bruta do Pré-Fabricado", 1000),
        venda("ROB", "Receita Bruta da Metalúrgica", "Receita Bruta da Metalúrgica", 50),
        venda("IRB", "Impostos Operacionais", "Impostos Operacionais", 999),
        venda("ROL", "Receita Líquida do Pré-Fabricado", "Receita Líquida do Pré-Fabricado", 900),
        venda("CPP", "Mão de Obra Direta", "Mão de Obra Direta", 80),
        venda("CPP", "Cimento", "Matérias Primas", 100),
        venda("CPP", "Outros Gastos Gerais Variáveis", "Gastos Gerais Variáveis", 7),
        venda("CPP", "Madeiras e Madeirites", "Gastos Gerais Variáveis", 3),
        venda("CF", "Frete e Descarga", "Gastos Gerais Variáveis", 20),
        venda("P", "Produção do Pré-Fabricado (pst)", "Produção do Pré-Fabricado (pst)", 12),
        venda("S", "Execução da Fundação (m³)", "Execução da Fundação (m³)", 5),
        venda("CPP", "CUSTOS DE PRODUÇÃO: PRÉ-FABRICADOS (CPP)", "-", 999),
      ],
      est,
      noEscopo,
      cadastro,
    );
    const v = valores.get("ESTRUTURA")!;
    assert.equal(v.get("ROB.RECEITA_OPERACIONAL_BRUTA_ROB"), 1050);
    assert.equal(v.get("IRB.IO.IMPOSTOS_OPERACIONAIS"), 150);
    assert.equal(v.get("CPP.MOD.MAO_DE_OBRA_DIRETA"), 80);
    assert.equal(v.get("CPP.GGV.GASTOS_GERAIS_VARIAVEIS"), 10);
    assert.equal(v.get("CPP.CUSTOS_DE_PRODUCAO_PRE_FABRICADOS_CPP"), 190);
    assert.equal(v.get("DVV.DESPESAS_VARIAVEIS_DE_VENDA_DVV"), 20);
    assert.equal(v.get("P.PRODUCAO_DO_PRE_FABRICADO_PISTAS"), 12);
    assert.deepEqual(naoAchadas, []);
  });

  it("o subtotal colado inteiro só vale sem os itens dele; a linha sem cadastro vai à sem linha", () => {
    const { valores } = vendidoNaEstrutura(
      [venda("CPP", "Cimento", "Matérias Primas", 100), venda("CPP", "Matérias Primas", "Matérias Primas", 100), venda("CPP", "Cimento", "Matérias Primas", 40, "TELHAMENTO")],
      est,
      noEscopo,
      cadastro,
    );
    assert.equal(valores.get("ESTRUTURA")!.get("CPP.MP.MATERIAS_PRIMAS"), 100);
    assert.equal(valores.get(SEM_LINHA_NO_VENDIDO)!.get("CPP.MP.CIMENTO"), 40);
  });

  it("lê a aba DRE inteira e deixa de fora as linhas repetidas", () => {
    const cab = ["CÓD.", "FORNECIMENTO", "VENDA", "VERSÃO", "CONTA CONTÁBIL", "V. TOTAL", "%RL", "V. UNIT.", "ETAPA", "UNIDADE", "LINHA", "DEPTO.", "ATRIBUIÇÃO", "VERSÃO (N)"];
    const linha = (numero: number, conta: string, total: number | string, versao = 0): LinhaPlanilha => ({
      numero,
      celulas: ["G1", "Obra", "Global", `VER0${versao}`, conta, total, "-", "-", "PRODUÇÃO", "MATRIZ", "ESTRUTURA", "CPP", "Matérias Primas", versao],
    });
    const r = interpretarDreVendida([
      { numero: 1, celulas: ["DRE"] },
      { numero: 2, celulas: cab },
      linha(3, "Cimento", 100),
      linha(4, "Cimento", 100),
      linha(5, "Cimento", 120),
      linha(6, "Agregados", "-"),
      linha(7, "Cimento", 130, 1),
    ]);
    assert.ok(r.ok);
    assert.deepEqual(
      r.linhas.map((x) => [x.conta, x.versao, x.valorTotal]),
      [
        ["Cimento", 0, 100],
        ["Agregados", 0, 0],
        ["Cimento", 1, 130],
      ],
    );
    assert.equal(r.repetidas, 1);
    assert.equal(r.conflitantes, 1);
  });
});

describe("Realizado por Obra: as permissões (03/11/2026)", () => {
  it("as telas e as abas no catálogo; sem as Configurações e o Painel de Bordo, e os Impostos nos Resultados (do mês e Empresariais)", () => {
    for (const c of ["realizado_obra_resultados", "dre.impostos", "relatorio_resultados.impostos"]) {
      assert.equal(chaveValida(c), true, c);
    }
    for (const c of ["realizado_obra_configuracoes", "realizado_obra_configuracoes.geral", "realizado_obra_configuracoes.almoxarifado", "realizado_obra_painel", "relatorio_resultados.almoxarifado", "impostos_mes"]) {
      assert.equal(chaveValida(c), false, c);
    }
  });

  it("os Impostos fora do recorte por departamento; o Realizado por Obra sem recorte (27/11/2026): vale com qualquer um", () => {
    const matriz = ["realizado_obra_resultados", "dre", "dre.consolidado", "dre.impostos", "relatorio_resultados", "relatorio_resultados.impostos"].map((chave) => ({ chave, acao: "LER" as const }));
    const livre = permissoesDasRotas(matriz, { recorteSetor: false, recorteDepartamento: false });
    for (const p of ["dre.impostos:ler", "realizado_obra_resultados:ler", "relatorio_resultados.impostos:ler"]) assert.equal(livre.includes(p), true, p);
    const comRecorte = permissoesDasRotas(matriz, { recorteSetor: false, recorteDepartamento: true });
    assert.equal(comRecorte.includes("realizado_obra_resultados:ler"), true);
    assert.equal(comRecorte.includes("dre.impostos:ler"), false);
    assert.equal(comRecorte.includes("relatorio_resultados.impostos:ler"), false);
    assert.equal(comRecorte.includes("relatorio_resultados:ler"), true);
    assert.equal(comRecorte.includes("dre.consolidado:ler"), true);
    const porCentro = permissoesDasRotas(matriz, { recorteSetor: false, recorteDepartamento: false, recorteCentro: true });
    assert.equal(porCentro.includes("realizado_obra_resultados:ler"), true);
    const porSetor = permissoesDasRotas(matriz, { recorteSetor: true, recorteDepartamento: false });
    assert.equal(porSetor.includes("realizado_obra_resultados:ler"), true);
  });

  it("o acesso sem recorte do Realizado por Obra mantém só as informações sensíveis do perfil", () => {
    const coordenador = { recorteSetor: false, setores: [], recorteDepartamento: false, departamentos: [], recorteCentro: true, gestao: "PRODUCAO" as const, centros: ["c1"], informacoesSensiveis: false };
    const a = semRecorte(coordenador);
    assert.equal(a.recorteCentro, false);
    assert.equal(a.recorteDepartamento, false);
    assert.equal(a.recorteSetor, false);
    assert.deepEqual(a.centros, []);
    assert.equal(a.informacoesSensiveis, false);
    assert.equal(semRecorte({ ...coordenador, informacoesSensiveis: true }).informacoesSensiveis, true);
  });

  it("a aba Obras saiu dos Resultados Empresariais (27/11/2026)", () => {
    assert.equal(chaveValida("relatorio_resultados.obras"), false);
    assert.equal(chaveValida("dre.obras"), true);
  });
});

describe("Realizado por Obra: a venda (03/11/2026)", () => {
  it("as obras numeradas são a obra do código: o do nome (Montagem) ou o da obra com a letra (Acompanhamento)", () => {
    const c = codigosDasVendas([
      { id: "a", codigo: "16", nome: "G887305 | 3-SM ADMINISTRADORA | NOVO PAVILHÃO" },
      { id: "b", codigo: "G887305", nome: "3-SM ADMINISTRADORA | NOVO PAVILHÃO" },
      { id: "c", codigo: "887305", nome: "STRAWPLAST" },
      { id: "d", codigo: "3126", nome: "PAVILHÃO OLSEN" },
      { id: "e", codigo: "3168", nome: "ABIMAR" },
      { id: "f", codigo: "G3168", nome: "ABIMAR | AMPLIAÇÃO LOJA IÇARA" },
      { id: "g", codigo: "L3168", nome: "OUTRA" },
      { id: "h", codigo: "L866004", nome: "G1 | OUTRA" },
    ]);
    assert.deepEqual(c.get("a"), { codigo: "G887305", nome: "3-SM ADMINISTRADORA | NOVO PAVILHÃO", numerada: true });
    assert.deepEqual(c.get("b"), { codigo: "G887305", nome: "3-SM ADMINISTRADORA | NOVO PAVILHÃO", numerada: false });
    assert.deepEqual(c.get("c"), { codigo: "G887305", nome: "STRAWPLAST", numerada: true });
    // Sem a obra com a letra, ou com mais de uma com o mesmo número, fica como está.
    assert.deepEqual(c.get("d"), { codigo: "3126", nome: "PAVILHÃO OLSEN", numerada: false });
    assert.deepEqual(c.get("e"), { codigo: "3168", nome: "ABIMAR", numerada: false });
    // O código com letra não muda, mesmo com um código no nome.
    assert.equal(c.get("h")?.codigo, "L866004");
  });

  it("a Mão de Obra e os Gastos Gerais, Diretos e Indiretos, sem as contas", () => {
    const ok = (codigo: string, tipo = "ITEM") => semAsContasAgrupadas({ codigo, tipo });
    assert.equal(ok("CPP.MOD.REMUNERACOES_CLT"), false);
    assert.equal(ok("CSM.MOI.HORAS_EXTRAS"), false);
    assert.equal(ok("CPP.GGD.SEGURO_PATRIMONIAL"), false);
    assert.equal(ok("CSC.GGI.OUTROS_CUSTOS_DESPESAS"), false);
    assert.equal(ok("CPP.MOD.MAO_DE_OBRA_DIRETA", "SUBTOTAL"), true);
    assert.equal(ok("CPP.GGI.GASTOS_GERAIS_INDIRETOS", "SUBTOTAL"), true);
    // A Terceirizada, as Matérias Primas e os Gastos Gerais Variáveis ficam com as contas.
    assert.equal(ok("CPP.MOT.PROJETOS_TERCEIRIZADOS"), true);
    assert.equal(ok("CPP.MP.CIMENTO"), true);
    assert.equal(ok("CPP.GGV.MADEIRAS_E_MADEIRITES"), true);
  });
});

describe("Realizado por Obra: a receita no modelo da aba Obras (03/11/2026)", () => {
  const RBPF = "ROB.RBPF.RECEITA_BRUTA_DO_PRE_FABRICADO";
  const RBF = "ROB.RBF.RECEITA_BRUTA_DE_FRETE";
  const RBM = "ROB.RBM.RECEITA_BRUTA_DE_MONTAGEM";
  const RBC = "ROB.RBC.RECEITA_BRUTA_COMPLEMENTAR";
  const IMPOSTOS = "IRB.IO.IMPOSTOS_OPERACIONAIS";
  const valor = (r: Map<string | null, Map<string, number>>, linha: string | null, codigo: string) => Math.round((r.get(linha)?.get(codigo) ?? 0) * 100) / 100;

  it("os lançamentos vão às linhas pela receita prévia da natureza; os impostos, pela de todas", () => {
    const r = receitasPorLinha(
      new Map([
        [RBPF, 1000],
        [IMPOSTOS, 90],
      ]),
      [
        { natureza: "PRE_FABRICADO", linhaId: "estrutura", bruta: 300 },
        { natureza: "PRE_FABRICADO", linhaId: "alveolares", bruta: 100 },
        { natureza: "MONTAGEM", linhaId: "montagem", bruta: 500 },
      ],
      [],
    );
    assert.equal(valor(r, "estrutura", RBPF), 750);
    assert.equal(valor(r, "alveolares", RBPF), 250);
    assert.equal(valor(r, "estrutura", IMPOSTOS), 30);
    assert.equal(valor(r, "montagem", IMPOSTOS), 50);
  });

  it("o frete e a complementar da receita prévia saem do Pré-Fabricado e da Montagem, na linha deles", () => {
    const r = receitasPorLinha(new Map(), [
      { natureza: "FRETE", linhaId: "estrutura", bruta: 40 },
      { natureza: "COMPLEMENTAR", linhaId: "vedacao", bruta: 60 },
    ], []);
    assert.equal(valor(r, "estrutura", RBPF), -40);
    assert.equal(valor(r, "estrutura", RBF), 40);
    assert.equal(valor(r, "vedacao", RBM), -60);
    assert.equal(valor(r, "vedacao", RBC), 60);
  });

  it("sem a receita prévia no mês, a do período; sem nenhuma, sem linha", () => {
    const doPeriodo = [{ natureza: "MONTAGEM", linhaId: "montagem", bruta: 10 }];
    assert.equal(valor(receitasPorLinha(new Map([[RBM, 200]]), [], doPeriodo), "montagem", RBM), 200);
    assert.equal(valor(receitasPorLinha(new Map([[RBM, 200]]), [], []), null, RBM), 200);
    // As devoluções (negativas) não são base.
    assert.equal(valor(receitasPorLinha(new Map([[IMPOSTOS, 5]]), [{ natureza: "DEVOLUCOES_INVENTARIOS", linhaId: "estrutura", bruta: 100 }], []), null, IMPOSTOS), 5);
  });
});
