import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Request } from "express";

import { enderecoDe, httpsDe } from "../src/controllers/conectividade/conectividadeController.js";
import { signToken, signTokenDaApi, verifyToken } from "../src/lib/jwt.js";
import { autenticacao } from "../src/middlewares/autenticacao.js";
import { abasDaObra, ApiError, apiDoCodigo, curtoDoIndicador, curtoDoPainel, nomeDaAbaDaObra, niveisDaDre, sinalDo, variacao, type AbaDaObraNaApi } from "../src/services/conectividade/catalogoApis.js";
import type { UsuarioAutenticado } from "../src/services/acesso/acesso.js";
import { exigirLigada } from "../src/services/conectividade/conectividadeService.js";
import { cardEmSvg, cortar, direcaoDo, esc, tabelaEmSvg } from "../src/services/conectividade/visuais.js";

/** Um pedido de mentira: o endereço da conexão e os cabeçalhos. */
const pedido = (remoto: string, headers: Record<string, string> = {}, secure = false) => ({ socket: { remoteAddress: remoto }, headers, secure }) as unknown as Request;

describe("Biblioteca de APIs (24/10/2026)", () => {
  it("o token da API só vale na API: o SIG o recusa, e o da sessão não tem o escopo", async () => {
    const daApi = signTokenDaApi({ sub: "u1", email: "a@bpm.com.br" });
    assert.equal(verifyToken(daApi).escopo, "api");
    assert.equal(verifyToken(signToken({ sub: "u1", email: "a@bpm.com.br" })).escopo, undefined);
    let status = 0;
    const response = { status: (s: number) => ((status = s), { json: () => undefined }) };
    await autenticacao({ headers: { authorization: `Bearer ${daApi}` } } as unknown as Request, response as never, () => assert.fail("não devia passar"));
    assert.equal(status, 401);
  });

  it("o endereço e o HTTPS só pelos cabeçalhos do proxy da rede interna", () => {
    // Do servidor do Next (rede interna): o último do X-Forwarded-For e o X-Forwarded-Proto.
    assert.equal(enderecoDe(pedido("172.18.0.3", { "x-forwarded-for": "1.2.3.4, 192.168.0.25" })), "192.168.0.25");
    assert.equal(enderecoDe(pedido("::ffff:127.0.0.1", { "x-forwarded-for": "::ffff:10.0.0.7" })), "10.0.0.7");
    assert.equal(httpsDe(pedido("127.0.0.1", { "x-forwarded-proto": "https" })), true);
    assert.equal(httpsDe(pedido("127.0.0.1", { "x-forwarded-proto": "http" })), false);
    // De fora da rede interna, os cabeçalhos não valem: o endereço da conexão e a conexão.
    assert.equal(enderecoDe(pedido("200.1.1.1", { "x-forwarded-for": "9.9.9.9" })), "200.1.1.1");
    assert.equal(httpsDe(pedido("200.1.1.1", { "x-forwarded-proto": "https" })), false);
    assert.equal(httpsDe(pedido("200.1.1.1", {}, true)), true);
  });

  it("a API desligada recusa tudo; em https, só o HTTPS; em http, tudo passa", () => {
    const recusa = (https: boolean, modo: "desligada" | "https" | "http") => {
      try {
        exigirLigada({ https }, modo);
        return null;
      } catch (e) {
        return e instanceof ApiError ? `${e.status} ${e.codigo}` : String(e);
      }
    };
    assert.equal(recusa(true, "desligada"), "503 API_DESLIGADA");
    assert.equal(recusa(false, "desligada"), "503 API_DESLIGADA");
    assert.equal(recusa(false, "https"), "403 HTTPS_OBRIGATORIO");
    assert.equal(recusa(true, "https"), null);
    assert.equal(recusa(false, "http"), null);
  });

  it("o sinal e a variação dos indicadores, com a regra do Painel", () => {
    assert.equal(variacao(110, 100)!.toFixed(2), "0.10");
    assert.equal(variacao(-90, -100)!.toFixed(2), "0.10");
    assert.equal(variacao(5, 0), null);
    assert.equal(sinalDo(104, 100, "↑"), 0);
    assert.equal(sinalDo(120, 100, "↑"), 1);
    assert.equal(sinalDo(120, 100, "↓"), -1);
    assert.equal(sinalDo(80, 100, "↓"), 1);
    assert.equal(sinalDo(120, 100, "="), null);
    // A meta zero: pelo lado do realizado.
    assert.equal(sinalDo(0, 0, "↓"), 0);
    assert.equal(sinalDo(2, 0, "↓"), -1);
  });

  it("os níveis da DRE como na tela: os totais, as atribuições e as contas", () => {
    const n = niveisDaDre([
      { codigo: "MB.MARGEM_BRUTA", tipo: "TOTAL" },
      { codigo: "CPV.CUSTO", tipo: "SUBTOTAL" },
      { codigo: "CPV.CPP.PRODUCAO", tipo: "SUBTOTAL" },
      { codigo: "CPV.CPP.PRODUCAO.MATERIAIS", tipo: "ITEM" },
      { codigo: "CPV.OUTROS", tipo: "ITEM" },
    ]);
    assert.deepEqual([...n.values()], [0, 0, 1, 2, 1]);
  });

  it("os valores dos cards sem a unidade, como nas telas", () => {
    assert.equal(curtoDoPainel(12_768_352.56, "MILHOES"), "12,8");
    assert.equal(curtoDoPainel(0.5164, "PCT_RL"), "51,6");
    assert.equal(curtoDoPainel(-381_200, "MILHARES"), "-381,2");
    assert.equal(curtoDoPainel(null, "M3"), "—");
    assert.equal(curtoDoIndicador("%", 0.831), "83,1");
    assert.equal(curtoDoIndicador("colab.", 152), "152");
  });

  it("os textos dos dados não viram marcação no SVG, e os longos se cortam", () => {
    assert.equal(esc(`<script>"a" & 'b'</script>`), "&lt;script&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/script&gt;");
    assert.ok(cortar("Uma descrição bem comprida demais para caber", 12, 80).endsWith("…"));
    // O realizado menor que o comparado: a seta para baixo, mesmo no sinal Melhor (23/11/2026, a direção do valor).
    const bloco = { valor: "1,0", comparado: "2,0", desvio: "-50,0%", sinal: 1 as const, direcao: direcaoDo(1, 2) };
    const card = cardEmSvg({ titulo: "<b>x</b>", subtitulo: "s", periodo: "AGO/2026", unidade: "R$ M", rotuloComparado: "Orçado", mes: bloco, acumulado: bloco });
    assert.ok(card.svg.startsWith("<svg") && !card.svg.includes("<b>") && card.largura === 500);
    assert.ok(card.svg.includes("▼ -50,0%") && !card.svg.includes("▲"));
    assert.equal(direcaoDo(3, 2), 1);
    assert.equal(direcaoDo(2, 2), 0);
    assert.equal(direcaoDo(null, 2), 0);
    const tabela = tabelaEmSvg("T", "S", [{ titulo: "Linha", largura: 200, alinhar: "start" }], [{ celulas: ["A & B"], estilo: "TOTAL" }]);
    assert.ok(tabela.svg.includes("A &amp; B"));
  });
});

describe("APIs do Realizado por Obra (26/11/2026)", () => {
  const aba = (chave: string, nome: string, nomeUnidade: string | null = null): AbaDaObraNaApi => ({ chave, nome, nomeUnidade, dados: { meses: [], linhas: [] } });
  const abas = [aba("consolidado", "Consolidado"), aba("l1", "Estrutura", "Matriz"), aba("l2", "Estrutura", "Filial"), aba("l3", "Montagem", "Serviços")];

  it("o nome da aba leva a unidade só quando duas linhas têm o mesmo nome, como na tela", () => {
    assert.deepEqual(
      abas.map((a) => nomeDaAbaDaObra(a, abas)),
      ["Consolidado", "Estrutura (Matriz)", "Estrutura (Filial)", "Montagem"],
    );
  });

  it("a linha: sem ela, o Consolidado; todas; pelo nome da aba, pelo nome da linha ou pelo id", () => {
    assert.deepEqual(abasDaObra(abas).map((a) => a.chave), ["consolidado"]);
    assert.deepEqual(abasDaObra(abas, "TODAS").map((a) => a.chave), ["consolidado", "l1", "l2", "l3"]);
    assert.deepEqual(abasDaObra(abas, "montagem").map((a) => a.chave), ["l3"]);
    assert.deepEqual(abasDaObra(abas, "Estrutura (Filial)").map((a) => a.chave), ["l2"]);
    assert.deepEqual(abasDaObra(abas, "estrutura").map((a) => a.chave), ["l1", "l2"]);
    assert.deepEqual(abasDaObra(abas, "l1").map((a) => a.chave), ["l1"]);
    assert.throws(
      () => abasDaObra(abas, "Alveolares"),
      (e: unknown) => e instanceof ApiError && e.status === 404 && e.codigo === "LINHA_INEXISTENTE" && e.message.includes("Estrutura (Matriz)"),
    );
  });

  it("os parâmetros errados voltam 422 antes de ler a venda", async () => {
    const u = { sub: "u1", nome: "Teste", permissions: ["realizado_obra_resultados:ler"], perfil: { codigo: "X" } } as unknown as UsuarioAutenticado;
    const dre = apiDoCodigo("obra-dre")!;
    assert.equal(apiDoCodigo("obras")?.origem, "Realizado por Obra");
    assert.equal(dre.alcanca(u), true);
    for (const q of [{}, { obra: "G887305", versao: "VERX" }, { obra: "G887305", versao: "100" }, { obra: "G887305", nivel: "4" }]) {
      await assert.rejects(() => dre.executar(q, u, "dados"), (e: unknown) => e instanceof ApiError && e.status === 422);
    }
    await assert.rejects(() => apiDoCodigo("obras")!.executar({}, u, "visual"), (e: unknown) => e instanceof ApiError && e.codigo === "FORMATO_INDISPONIVEL");
  });
});
