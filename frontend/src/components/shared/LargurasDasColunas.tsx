"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * A largura das colunas (13/11/2026, pedido do Adão): em todas as tabelas do SIG, menos as dos modais, cada divisa entre
 * dois rótulos (marcada com um traço discreto) é uma alça: arrastá-la alarga uma coluna e estreita a vizinha, sem mudar a
 * ordem nem a largura da tabela (nenhuma das duas fica mais estreita que o rótulo); dois cliques nela voltam a tabela às
 * larguras padrão. O SIG guarda as larguras
 * neste navegador, por tela (sem o mês ou o registro do endereço) e pelos rótulos da tabela; sem preferência, a tabela
 * fica como a tela a monta.
 *
 * Funciona sobre o DOM, sem mudar cada tabela: um observador acha as tabelas com cabeçalho (o <thead> de uma linha, ou de
 * várias com o <colgroup> de uma coluna por rótulo), põe as alças e aplica as larguras guardadas. Com larguras, a tabela
 * passa a `table-layout: fixed`, com a largura de cada coluna; a sobra do quadro vai para a última. A tabela não passa da
 * largura do quadro que a mostra (o cabeçalho fixo ao rolar a página depende disso) — menos onde o quadro já rola na
 * horizontal (as Premissas dos cenários, as telas estreitas), em que a coluna cresce sozinha e a tabela com ela. A tabela
 * de cabeçalho preso com o corpo numa tabela à parte (as Premissas) leva as larguras às duas, pelo <colgroup>.
 */

const PREFIXO = "sig:larguras:";
const MINIMO = 40;
const ALCA = "alca-coluna";

/** Durante o arraste, a varredura não reaplica as larguras guardadas (era o que fazia a tela piscar). */
let arrastando = false;

type Alvo = {
  tabela: HTMLTableElement;
  /** Os rótulos das colunas (a última linha do cabeçalho). */
  rotulos: HTMLTableCellElement[];
  /** Onde a largura se aplica: as <col> (quando há uma por rótulo) ou os próprios rótulos. */
  alvos: HTMLElement[];
  /** A tabela do corpo, quando o cabeçalho fica numa tabela à parte, e as <col> dela. */
  gemea: { tabela: HTMLTableElement; cols: HTMLElement[] } | null;
  chave: string;
};

/** A rota sem os trechos que mudam (o mês, o id do registro): as larguras valem para a tela. */
function rotaDaTela(pathname: string) {
  return pathname
    .split("/")
    .map((s) => (/^\d{4}-\d{2}$|^\d+$|^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(s) ? ":" : s))
    .join("/");
}

const colsDe = (t: HTMLTableElement) => Array.from(t.querySelectorAll<HTMLElement>(":scope > colgroup > col"));
const temCorpo = (t: HTMLTableElement) => Array.from(t.tBodies).some((b) => b.rows.length > 0);

function alvoDe(tabela: HTMLTableElement, pathname: string): Alvo | null {
  if (tabela.closest('[role="dialog"], [data-sem-larguras]')) return null;
  const thead = tabela.tHead;
  if (!thead || !thead.rows.length) return null;
  const rotulos = Array.from(thead.rows[thead.rows.length - 1].cells);
  if (!rotulos.length || rotulos.some((c) => c.colSpan > 1)) return null;
  const cols = colsDe(tabela);
  const porCol = cols.length === rotulos.length;
  // Com várias linhas no cabeçalho, a largura só se aplica pelas <col>.
  if (thead.rows.length > 1 && !porCol) return null;
  let gemea: Alvo["gemea"] = null;
  if (porCol && !temCorpo(tabela)) {
    // O cabeçalho preso numa tabela à parte: o corpo é a próxima tabela, perto dela, com as mesmas <col>.
    let ancestral: HTMLElement | null = tabela.parentElement;
    for (let i = 0; i < 3 && ancestral && !gemea; i++, ancestral = ancestral.parentElement) {
      for (const t of Array.from(ancestral.querySelectorAll("table"))) {
        if (t === tabela || !(tabela.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
        const c = colsDe(t);
        if (c.length === rotulos.length && temCorpo(t)) {
          gemea = { tabela: t, cols: c };
          break;
        }
      }
    }
  }
  const assinatura = rotulos.map((c) => (c.textContent ?? "").replace(/[\d\s]+/g, "").slice(0, 24)).join("¦");
  return { tabela, rotulos, alvos: porCol ? cols : rotulos, gemea, chave: `${PREFIXO}${rotaDaTela(pathname)}|${assinatura}` };
}

function lerPreferencia(chave: string): number[] | null {
  try {
    const v = JSON.parse(window.localStorage.getItem(chave) ?? "null") as unknown;
    return Array.isArray(v) && v.every((x) => typeof x === "number" && x > 0) ? (v as number[]) : null;
  } catch {
    return null;
  }
}
function gravarPreferencia(chave: string, larguras: number[] | null) {
  try {
    if (larguras) window.localStorage.setItem(chave, JSON.stringify(larguras.map((x) => Math.round(x))));
    else window.localStorage.removeItem(chave);
  } catch {
    // Sem o armazenamento do navegador, a largura vale só até sair da tela.
  }
}

/** Os estilos originais, para os dois cliques voltarem a tabela ao padrão. */
const originais = new WeakMap<HTMLElement, { width: string; minWidth: string; tableLayout: string }>();
function guardarOriginal(el: HTMLElement) {
  if (!originais.has(el)) originais.set(el, { width: el.style.width, minWidth: el.style.minWidth, tableLayout: el.style.tableLayout });
}
function restaurar(el: HTMLElement) {
  const o = originais.get(el);
  if (!o) return;
  el.style.width = o.width;
  el.style.minWidth = o.minWidth;
  el.style.tableLayout = o.tableLayout;
  originais.delete(el);
}

/** A largura que o texto do rótulo pede (com o espaço interno e, quando há, o botão do filtro), para ele não ficar cortado. */
let regua: CanvasRenderingContext2D | null = null;
function larguraDoRotulo(th: HTMLTableCellElement) {
  const cs = getComputedStyle(th);
  regua ??= document.createElement("canvas").getContext("2d");
  if (!regua) return MINIMO;
  regua.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const texto = regua.measureText((th.textContent ?? "").trim()).width;
  return Math.ceil(texto + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + (th.querySelector("button") ? 24 : 0));
}

/** O espaço da tabela: a largura do quadro que a mostra e se ele rola (ou corta) na horizontal. */
function espacoDe(t: HTMLTableElement) {
  const pai = t.parentElement;
  if (!pai) return { largura: 0, rola: true };
  return { largura: pai.clientWidth, rola: getComputedStyle(pai).overflowX !== "visible" };
}

function aplicar(a: Alvo, larguras: number[]) {
  const n = a.rotulos.length;
  const ls = larguras.slice(0, n).map((x) => Math.max(MINIMO, x));
  const { largura, rola } = espacoDe(a.tabela);
  const soma = ls.reduce((s, x) => s + x, 0);
  if (largura > soma) {
    // A sobra do quadro vai para a última coluna (sem gravar): a tabela continua da largura dele.
    ls[n - 1] += largura - soma;
  } else if (!rola && soma > largura) {
    // Larguras guardadas numa janela mais larga: a última cede até o rótulo caber; depois, as outras, na proporção.
    let excesso = soma - largura;
    const corte = Math.min(excesso, Math.max(0, ls[n - 1] - Math.max(MINIMO, larguraDoRotulo(a.rotulos[n - 1]))));
    ls[n - 1] -= corte;
    excesso -= corte;
    if (excesso > 0) {
      const outras = ls.slice(0, n - 1).reduce((s, x) => s + x, 0);
      for (let i = 0; i < n - 1; i++) ls[i] = Math.max(MINIMO, ls[i] - (excesso * ls[i]) / outras);
    }
  }
  const total = ls.reduce((s, x) => s + x, 0);
  for (const t of [a.tabela, ...(a.gemea ? [a.gemea.tabela] : [])]) {
    guardarOriginal(t);
    t.style.tableLayout = "fixed";
    t.style.width = `${total}px`;
    t.style.minWidth = "0";
  }
  for (const [i, el] of [...a.alvos.entries(), ...(a.gemea ? a.gemea.cols.entries() : [])]) {
    guardarOriginal(el);
    el.style.width = `${ls[i]}px`;
  }
}

function voltarAoPadrao(a: Alvo) {
  for (const el of [a.tabela, ...(a.gemea ? [a.gemea.tabela] : []), ...a.alvos, ...(a.gemea ? a.gemea.cols : [])]) restaurar(el);
}

function porAlca(th: HTMLTableCellElement, indice: number, ultima: boolean, pathname: () => string) {
  const existente = th.querySelector<HTMLElement>(`:scope > .${ALCA}`);
  // A alça só nas divisas entre os rótulos: a última coluna não tem (e perde a que tinha, se as colunas mudaram).
  if (ultima) {
    existente?.remove();
    return;
  }
  if (existente) return;
  if (getComputedStyle(th).position === "static") th.style.position = "relative";
  const alca = document.createElement("span");
  alca.className = ALCA;
  alca.setAttribute("aria-hidden", "true");
  alca.title = "Arraste para ajustar a largura da coluna; dois cliques voltam às larguras padrão";
  alca.addEventListener("click", (e) => e.stopPropagation());
  alca.addEventListener("dblclick", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const tabela = th.closest("table");
    const a = tabela ? alvoDe(tabela, pathname()) : null;
    if (!a) return;
    gravarPreferencia(a.chave, null);
    voltarAoPadrao(a);
  });
  alca.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const tabela = th.closest("table");
    const a = tabela ? alvoDe(tabela, pathname()) : null;
    if (!a) return;
    // As larguras de partida: as que a tela mostra. A divisa move a largura entre a coluna e a vizinha da direita (a tabela
    // não muda de largura), sem que nenhuma fique mais estreita que o rótulo; onde o quadro rola na horizontal, só a coluna
    // muda, e a tabela cresce ou diminui com ela.
    if (indice >= a.rotulos.length - 1) return;
    const vizinha = indice + 1;
    const larguras = a.rotulos.map((c) => c.getBoundingClientRect().width);
    const { rola } = espacoDe(a.tabela);
    const piso = Math.max(MINIMO, larguraDoRotulo(a.rotulos[indice]));
    const pisoDaVizinha = Math.max(MINIMO, larguraDoRotulo(a.rotulos[vizinha]));
    const inicio = e.clientX;
    const base = larguras[indice];
    const baseDaVizinha = larguras[vizinha];
    try {
      alca.setPointerCapture(e.pointerId);
    } catch {
      // Sem a captura (um ponteiro que o navegador não conhece), os movimentos chegam só sobre a alça.
    }
    alca.dataset.arrastando = "1";
    arrastando = true;
    let quadro = 0;
    let x = inicio;
    const redesenhar = () => {
      quadro = 0;
      const dx = x - inicio;
      if (rola) larguras[indice] = Math.max(Math.min(piso, base), base + dx);
      else {
        // O quanto a divisa anda: até a coluna ou a vizinha chegar ao rótulo dela.
        const d = Math.min(Math.max(dx, Math.min(0, piso - base)), Math.max(0, baseDaVizinha - pisoDaVizinha));
        larguras[indice] = base + d;
        larguras[vizinha] = baseDaVizinha - d;
      }
      aplicar(a, larguras);
    };
    const mover = (ev: PointerEvent) => {
      x = ev.clientX;
      // Um redesenho por quadro da tela.
      if (!quadro) quadro = window.requestAnimationFrame(redesenhar);
    };
    const soltar = () => {
      alca.removeEventListener("pointermove", mover);
      alca.removeEventListener("pointerup", soltar);
      alca.removeEventListener("pointercancel", soltar);
      if (quadro) {
        window.cancelAnimationFrame(quadro);
        redesenhar();
      }
      delete alca.dataset.arrastando;
      arrastando = false;
      gravarPreferencia(a.chave, larguras);
    };
    alca.addEventListener("pointermove", mover);
    alca.addEventListener("pointerup", soltar);
    alca.addEventListener("pointercancel", soltar);
  });
  th.appendChild(alca);
}

/** Põe as alças e aplica as larguras guardadas em todas as tabelas da tela (menos as dos modais). */
function varrer(pathname: () => string) {
  if (arrastando) return;
  for (const tabela of Array.from(document.querySelectorAll("table"))) {
    const a = alvoDe(tabela, pathname());
    if (!a) continue;
    a.rotulos.forEach((th, i) => porAlca(th, i, i === a.rotulos.length - 1, pathname));
    const guardadas = lerPreferencia(a.chave);
    if (guardadas && guardadas.length === a.rotulos.length) aplicar(a, guardadas);
  }
}

/** Montado uma vez no layout das telas (ProtectedLayout). */
export function LargurasDasColunas() {
  const pathname = usePathname();
  useEffect(() => {
    const rota = () => pathname;
    let pedido = 0;
    const agendar = () => {
      if (pedido) return;
      pedido = window.requestAnimationFrame(() => {
        pedido = 0;
        varrer(rota);
      });
    };
    agendar();
    // Só as mudanças da árvore (as alças e as larguras mudam atributos, que o observador não vê: sem laço).
    const observador = new MutationObserver(agendar);
    observador.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", agendar);
    return () => {
      observador.disconnect();
      window.removeEventListener("resize", agendar);
      if (pedido) window.cancelAnimationFrame(pedido);
    };
  }, [pathname]);
  return null;
}
