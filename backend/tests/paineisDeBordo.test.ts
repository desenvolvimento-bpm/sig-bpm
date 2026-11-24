import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { z } from "zod";

import { corpoDasPaginas } from "../src/controllers/analisesGerenciais/slides.js";
import { alteraGeral, alteraPainel, comparacoesDoPainel, competenciaEfetiva, excluiPainel, vePainel } from "../src/services/analisesGerenciais/paineisDeBordoService.js";
import { conferirVersao, paginasCopiadas, paginasDe, SlidesError, type PaginaDoRelatorio } from "../src/services/analisesGerenciais/slides.js";

const adao = { id: "adao", admin: false, edita: true };
const maiko = { id: "maiko", admin: false, edita: true };
const leitor = { id: "leitor", admin: false, edita: false };
const administrador = { id: "admin", admin: true, edita: true };

describe("os Painéis de Bordo (31/10/2026): quem vê e quem altera, como nos cenários", () => {
  it("o privado, só quem o criou e o Administrador o veem; o público, todos, depois de finalizado (01/11/2026)", () => {
    const painel = (visualizacao: "PRIVADO" | "PUBLICO", situacao: "EM_ELABORACAO" | "FINALIZADO") => ({ visualizacao, situacao, criadoPorId: "adao", editores: [] as Array<{ usuarioId: string }> });
    for (const situacao of ["EM_ELABORACAO", "FINALIZADO"] as const) {
      assert.equal(vePainel(painel("PRIVADO", situacao), adao), true);
      assert.equal(vePainel(painel("PRIVADO", situacao), maiko), false);
      assert.equal(vePainel(painel("PRIVADO", situacao), administrador), true);
      assert.equal(vePainel(painel("PUBLICO", situacao), adao), true);
      assert.equal(vePainel(painel("PUBLICO", situacao), administrador), true);
    }
    // O público em elaboração ainda não aparece para os demais.
    assert.equal(vePainel(painel("PUBLICO", "EM_ELABORACAO"), maiko), false);
    assert.equal(vePainel(painel("PUBLICO", "EM_ELABORACAO"), leitor), false);
    assert.equal(vePainel(painel("PUBLICO", "FINALIZADO"), maiko), true);
    assert.equal(vePainel(painel("PUBLICO", "FINALIZADO"), leitor), true);
  });

  it("só quem o criou (ou o Administrador), com a permissão de editar, o altera", () => {
    const painel = { criadoPorId: "adao", editores: [] };
    assert.equal(alteraPainel(painel, adao), true);
    assert.equal(alteraPainel(painel, maiko), false);
    assert.equal(alteraPainel(painel, administrador), true);
    // Quem criou, sem a permissão de editar a tela (o perfil mudou), não altera.
    assert.equal(alteraPainel(painel, { ...adao, edita: false }), false);
  });

  it("o editor convidado (01/11/2026, o Compartilhar) vê e edita o painel", () => {
    const privado = { visualizacao: "PRIVADO" as const, situacao: "EM_ELABORACAO" as const, criadoPorId: "adao", editores: [{ usuarioId: "maiko" }] };
    assert.equal(vePainel(privado, maiko), true);
    assert.equal(vePainel(privado, leitor), false);
    assert.equal(alteraPainel(privado, maiko), true);
    // Sem a permissão de editar a tela, o convidado só lê.
    assert.equal(alteraPainel(privado, { ...maiko, edita: false }), false);
  });

  it("o Geral das Configurações: o editor convidado o muda com o painel em elaboração (03/11/2026); a exclusão, só o dono", () => {
    const emElaboracao = { visualizacao: "PRIVADO" as const, situacao: "EM_ELABORACAO" as const, criadoPorId: "adao", editores: [{ usuarioId: "maiko" }] };
    const finalizado = { ...emElaboracao, situacao: "FINALIZADO" as const };
    assert.equal(alteraGeral(emElaboracao, maiko), true);
    assert.equal(alteraGeral(finalizado, maiko), false);
    // Quem criou e o Administrador, também no finalizado; quem não edita a tela, nunca.
    for (const p of [emElaboracao, finalizado]) {
      assert.equal(alteraGeral(p, adao), true);
      assert.equal(alteraGeral(p, administrador), true);
      assert.equal(alteraGeral(p, { ...maiko, edita: false }), false);
      assert.equal(alteraGeral(p, leitor), false);
    }
    assert.equal(excluiPainel(emElaboracao, maiko), false);
    assert.equal(excluiPainel(emElaboracao, adao), true);
    assert.equal(excluiPainel(emElaboracao, administrador), true);
  });
});

describe("a competência automática dos painéis (03/11/2026)", () => {
  const fechadas = [
    { ano: 2026, mes: 10 },
    { ano: 2026, mes: 9 },
  ];

  it("o automático mostra a última fechada; o fixo, a dele", () => {
    assert.deepEqual(competenciaEfetiva({ competenciaAutomatica: true, ano: 2026, mes: 8 }, fechadas), { ano: 2026, mes: 10 });
    assert.deepEqual(competenciaEfetiva({ competenciaAutomatica: false, ano: 2026, mes: 8 }, fechadas), { ano: 2026, mes: 8 });
    // Com a última reaberta (fora das fechadas), a anterior; sem nenhuma fechada, a guardada.
    assert.deepEqual(competenciaEfetiva({ competenciaAutomatica: true, ano: 2026, mes: 10 }, fechadas.slice(1)), { ano: 2026, mes: 9 });
    assert.deepEqual(competenciaEfetiva({ competenciaAutomatica: true, ano: 2026, mes: 10 }, []), { ano: 2026, mes: 10 });
  });

  it("no automático, a Comparação Padrão é a marcação; no fixo, o cenário escolhido", () => {
    const painel = { cenarioComparadoId: "previsao-2026", comparacaoPadrao: "PREVISAO" as const, comparacaoProva: [] };
    const outubro = { ano: 2026, mes: 10 };
    assert.deepEqual(comparacoesDoPainel({ ...painel, competenciaAutomatica: true }, outubro), { ...outubro, cenarioComparadoId: null, comparacaoPadrao: "PREVISAO", comparacaoProva: [] });
    assert.deepEqual(comparacoesDoPainel({ ...painel, competenciaAutomatica: false }, outubro), { ...outubro, cenarioComparadoId: "previsao-2026", comparacaoProva: [] });
  });
});

describe("os slides comuns aos relatórios e aos painéis (31/10/2026)", () => {
  const pagina = (blocos: PaginaDoRelatorio["blocos"]): PaginaDoRelatorio => ({ id: "p1", nome: "Visão Geral", blocos, fundo: { arquivo: "f.jpg", proporcao: 1.5, zoom: 1, x: 0.5, y: 0.5 } });

  it("a cópia sem Manter Imagens e Anotações esvazia as anotações, as imagens e os vídeos, e mantém os cards e a Imagem de Fundo", () => {
    const original = [
      pagina([
        { id: "a", x: 0, y: 0, w: 4, h: 3, tipo: "ANOTACAO", nota: "POSITIVO", titulo: "Destaque", texto: "Bom mês", html: "<b>Bom mês</b>" },
        { id: "f", x: 4, y: 0, w: 4, h: 3, tipo: "FOTO", arquivo: "x.jpg", legenda: "Obra", proporcao: 1 },
        { id: "v", x: 8, y: 0, w: 4, h: 3, tipo: "VIDEO", origem: "LINK", arquivo: "", url: "https://youtu.be/abc", legenda: "Vídeo", proporcao: 1.7 },
        { id: "c", x: 0, y: 3, w: 12, h: 9, tipo: "INDICADOR", nome: "Volume Produzido" },
      ]),
    ];
    assert.equal(paginasCopiadas(original, true), original);
    const [p] = paginasCopiadas(original, false);
    const [a, f, v, c] = p.blocos;
    assert.deepEqual([a.tipo === "ANOTACAO" && a.texto, a.tipo === "ANOTACAO" && a.titulo], ["", "Destaque"]);
    assert.deepEqual([f.tipo === "FOTO" && f.arquivo, f.tipo === "FOTO" && f.legenda], ["", ""]);
    assert.deepEqual([v.tipo === "VIDEO" && v.url, v.tipo === "VIDEO" && v.legenda], ["", ""]);
    assert.deepEqual(c, original[0].blocos[3]);
    assert.deepEqual(p.fundo, original[0].fundo);
  });

  it("as páginas vazias viram uma página sem blocos", () => {
    assert.deepEqual(paginasDe(null), [{ id: "p1", blocos: [] }]);
  });

  it("a versão das páginas: recusa a gravação depois da de outro, a não ser por cima", () => {
    const gravado = { em: new Date("2026-10-31T15:00:00Z"), por: "Maiko" };
    const aba = { chave: "PAINEL", nome: "Painel de Bordo" };
    assert.doesNotThrow(() => conferirVersao(gravado, { versao: gravado.em.toISOString() }, aba, "o painel"));
    assert.doesNotThrow(() => conferirVersao(gravado, { versao: "2026-10-31T14:00:00.000Z", forcar: true }, aba, "o painel"));
    assert.throws(
      () => conferirVersao(gravado, { versao: "2026-10-31T14:00:00.000Z" }, aba, "o painel"),
      (e: unknown) => e instanceof SlidesError && e.status === 409 && e.codigo === "CONFLITO" && e.message.includes("depois que você abriu o painel") && e.detalhes?.aba === "PAINEL",
    );
  });

  it("o Sumário do painel lista só a tela do painel", () => {
    const corpo = corpoDasPaginas(z.literal("PAINEL"), 1);
    const sumario = (telas: string[]) => ({ paginas: [{ id: "p1", blocos: [{ id: "s", x: 0, y: 0, w: 6, h: 6, tipo: "SUMARIO", listar: "TELAS_E_SLIDES", telas }] }] });
    assert.equal(corpo.safeParse(sumario(["PAINEL"])).success, true);
    assert.equal(corpo.safeParse(sumario(["FATOS"])).success, false);
  });

  it("guarda o tamanho do texto dos blocos de texto (23/11/2026: os novos com 20)", () => {
    const corpo = corpoDasPaginas(z.literal("PAINEL"), 1);
    const texto = (tamanho: unknown) => ({ paginas: [{ id: "p1", blocos: [{ id: "t", x: 0, y: 0, w: 6, h: 3, tipo: "TEXTO", texto: "Olá", tamanho }] }] });
    const r = corpo.safeParse(texto(20));
    assert.equal(r.success, true);
    assert.equal((r.data!.paginas[0].blocos[0] as { tamanho?: number }).tamanho, 20);
    // Sem ele (os blocos de antes), o bloco vale; fora da faixa da lista (10 a 144), não.
    assert.equal(corpo.safeParse(texto(undefined)).success, true);
    assert.equal(corpo.safeParse(texto(500)).success, false);
  });
});
