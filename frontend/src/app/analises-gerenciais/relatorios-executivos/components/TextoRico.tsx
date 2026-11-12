"use client";

import { useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, CaseSensitive, ChevronDown, Italic, List, Palette, Underline, UnfoldVertical } from "lucide-react";

/**
 * O texto formatado das anotações e das legendas das fotos dos Relatórios Executivos (17/10/2026): negrito, itálico,
 * sublinhado, o tamanho da fonte, a cor e os marcadores. Fica em HTML, limpo pelo DOMPurify antes de aparecer (só as
 * marcas de formatação passam: nada de scripts, links ou imagens).
 */
const PERMITIDOS = { ALLOWED_TAGS: ["b", "strong", "i", "em", "u", "span", "font", "br", "div", "p", "ul", "ol", "li"], ALLOWED_ATTR: ["style", "color", "size"] };
export const limparHtml = (html: string) => (typeof window === "undefined" ? "" : DOMPurify.sanitize(html, PERMITIDOS));

/** O texto simples de antes (sem formatação) em HTML: os caracteres escapados e as quebras de linha. */
export const deTexto = (texto: string) => texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");

/**
 * As cores da fonte, na ordem pedida. Padrão (17/10/2026; antes, Preto) tira a cor escolhida: o texto volta à cor do tema
 * (preto; branco no Escuro). No Escuro, o cinza e o vermelho ficam mais claros (globals.css, `.texto-rico`).
 */
export const COR_PADRAO = "#111827";
export const CORES_DA_FONTE = [
  { nome: "Padrão", cor: COR_PADRAO },
  { nome: "Cinza", cor: "#6b7280" },
  { nome: "Ouro", cor: "#ffcc00" },
  { nome: "Verde", cor: "#16a34a" },
  { nome: "Azul", cor: "#2563eb" },
  { nome: "Amarelo", cor: "#eab308" },
  { nome: "Laranja", cor: "#f97316" },
  { nome: "Vermelho", cor: "#dc2626" },
  // O branco (20/10/2026), para os textos sobre a Imagem de Fundo.
  { nome: "Branco", cor: "#ffffff" },
];

/**
 * As fontes (20/10/2026): as cinco mais usadas em apresentações de empresa, todas do Windows e do Office (com as
 * substitutas, onde faltarem); Padrão tira a escolhida e volta à fonte da ferramenta. Desde 22/10/2026, também cinco
 * fontes abertas (licença OFL/Apache) das mais usadas em dashboards e apresentações — Roboto, Open Sans, Montserrat,
 * Lato e Poppins —, servidas pela própria ferramenta (public/fontes, fontesDosRelatorios.css), sem depender da internet.
 */
export const FONTES = [
  { chave: "ARIAL", nome: "Arial", familia: "Arial, Helvetica, sans-serif" },
  { chave: "CALIBRI", nome: "Calibri", familia: "Calibri, Carlito, 'Segoe UI', sans-serif" },
  { chave: "SEGOE", nome: "Segoe UI", familia: "'Segoe UI', Tahoma, sans-serif" },
  { chave: "VERDANA", nome: "Verdana", familia: "Verdana, Geneva, sans-serif" },
  { chave: "GEORGIA", nome: "Georgia", familia: "Georgia, 'Times New Roman', serif" },
  { chave: "ROBOTO", nome: "Roboto", familia: "Roboto, Arial, sans-serif" },
  { chave: "OPEN_SANS", nome: "Open Sans", familia: "'Open Sans', Arial, sans-serif" },
  { chave: "MONTSERRAT", nome: "Montserrat", familia: "Montserrat, Arial, sans-serif" },
  { chave: "LATO", nome: "Lato", familia: "Lato, Arial, sans-serif" },
  { chave: "POPPINS", nome: "Poppins", familia: "Poppins, Arial, sans-serif" },
] as const;
export type ChaveDaFonte = (typeof FONTES)[number]["chave"];
export const familiaDa = (chave?: string) => FONTES.find((x) => x.chave === chave)?.familia;
/** A marca da fonte Padrão, aplicada e logo tirada (o texto volta à fonte do campo). */
const FONTE_PADRAO = "fonte-padrao";

/**
 * O espaçamento entre as linhas (20/10/2026), do texto todo do bloco: 1,00 é o simples do Office (a linha com 1,2 vez o
 * tamanho da fonte); sem ele, o de antes.
 */
export const ESPACAMENTOS = [0.5, 0.75, 1, 1.25, 1.5, 2];
export const alturaDaLinha = (espacamento?: number) => (espacamento ? espacamento * 1.2 : undefined);
export const rotuloDoEspacamento = (e: number) => e.toLocaleString("pt-BR", { minimumFractionDigits: 2 });

/**
 * O alinhamento dos parágrafos (12/11/2026, pedido do Adão; no Texto Livre): o comando do navegador grava o text-align no
 * parágrafo (com a seleção, nos parágrafos dela; sem ela, em todo o texto, como os outros botões).
 */
export const ALINHAMENTOS = [
  { chave: "left", nome: "Esquerda", comando: "justifyLeft", Icone: AlignLeft },
  { chave: "justify", nome: "Justificado", comando: "justifyFull", Icone: AlignJustify },
  { chave: "center", nome: "Centralizado", comando: "justifyCenter", Icone: AlignCenter },
  { chave: "right", nome: "Direita", comando: "justifyRight", Icone: AlignRight },
] as const;
type ChaveDoAlinhamento = (typeof ALINHAMENTOS)[number]["chave"];
/** O alinhamento do parágrafo onde está o cursor (o "start" do navegador é a Esquerda). */
function alinhamentoDaSelecao(campo: HTMLElement): ChaveDoAlinhamento {
  const sel = window.getSelection();
  let n: Node | null = sel && sel.rangeCount && campo.contains(sel.anchorNode) ? sel.anchorNode : campo;
  if (n && n.nodeType === Node.TEXT_NODE) n = n.parentNode;
  const a = getComputedStyle((n as HTMLElement) ?? campo).textAlign;
  return a === "justify" ? "justify" : a === "center" ? "center" : a === "right" || a === "end" ? "right" : "left";
}

/** A classe dos itens das listas da barra. */
export const ITEM_DA_BARRA = "flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-xs text-gray-700 hover:bg-gray-100";
/** O clique nos botões da barra não tira o foco do texto (a seleção fica). */
export const semFoco = (e: React.MouseEvent) => e.preventDefault();

/** Uma lista da barra (20/10/2026): o botão, com a seta, e a lista logo abaixo dele, sem menu (o menu levaria o foco). */
export function MenuDaBarra({
  botao,
  titulo,
  gatilho,
  aberto,
  onAlternar,
  largura = "w-40",
  desabilitado = false,
  children,
}: {
  botao: string;
  titulo: string;
  gatilho: React.ReactNode;
  aberto: boolean;
  onAlternar: () => void;
  largura?: string;
  /** No menu único da edição (24/10/2026): a opção que não vale para o bloco escolhido fica à vista, quase apagada. */
  desabilitado?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className="relative">
      <button type="button" className={`${botao} w-auto gap-0 px-0.5`} disabled={desabilitado} onMouseDown={semFoco} onClick={onAlternar} title={titulo} aria-label={titulo} aria-expanded={aberto}>
        {gatilho}
        <ChevronDown className="size-3" />
      </button>
      {aberto && !desabilitado ? <span className={`absolute top-full left-0 z-40 mt-1 grid ${largura} rounded-sm border border-gray-200 bg-white p-1 shadow-md`}>{children}</span> : null}
    </span>
  );
}

/** Os marcadores das listas: o símbolo antes de cada item. */
export const MARCADORES = [
  { nome: "Quadrado", simbolo: "■" },
  { nome: "Seta", simbolo: "➜" },
  { nome: "Check", simbolo: "✓" },
  { nome: "Erro", simbolo: "✗" },
];

/** As listas com os marcadores (o símbolo vem no estilo da lista) e o recuo delas. */
const CLASSE_DO_TEXTO = "texto-rico [&_ul]:pl-5 [&_ol]:pl-5 [&_ul]:list-disc [&_ol]:list-decimal [&_li]:pl-0.5";

/** Tira a cor Padrão do texto (os trechos voltam à cor do tema) e desfaz os spans que ficaram sem estilo. */
function tirarCorPadrao(campo: HTMLElement) {
  campo.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
    if (el.style.color !== "rgb(17, 24, 39)") return;
    el.style.removeProperty("color");
    if (!el.getAttribute("style")?.trim()) el.removeAttribute("style");
    if (el.tagName === "SPAN" && !el.attributes.length) el.replaceWith(...el.childNodes);
  });
  campo.querySelectorAll("font[color]").forEach((el) => {
    if (el.getAttribute("color")?.toLowerCase() === COR_PADRAO) el.replaceWith(...el.childNodes);
  });
}

/**
 * O texto formatado: na edição, um campo editável (o HTML vai ao `onMudar` a cada alteração, com o texto simples); na
 * leitura, o HTML limpo. Sem `html`, o texto simples de antes.
 */
export function TextoRico({
  html,
  texto,
  editavel,
  placeholder,
  rotulo,
  className,
  estilo,
  registrar,
  onMudar,
}: {
  /** O estilo do campo (20/10/2026: a altura da linha do espaçamento). */
  estilo?: React.CSSProperties;
  html?: string;
  texto: string;
  editavel: boolean;
  placeholder?: string;
  rotulo: string;
  className?: string;
  /** O campo editável, para a barra de formatação do bloco. */
  registrar?: (el: HTMLDivElement | null) => void;
  onMudar?: (html: string, texto: string) => void;
}) {
  const conteudo = html ?? deTexto(texto);
  const campo = useRef<HTMLDivElement | null>(null);
  // O campo editável recebe o HTML só quando não está em uso (senão, o cursor pularia a cada tecla).
  useEffect(() => {
    const el = campo.current;
    if (!el || !editavel || document.activeElement === el) return;
    const limpo = limparHtml(conteudo);
    if (el.innerHTML !== limpo) el.innerHTML = limpo;
  }, [conteudo, editavel]);
  if (!editavel) {
    return <div className={`${CLASSE_DO_TEXTO} ${className ?? ""}`} style={estilo} dangerouslySetInnerHTML={{ __html: limparHtml(conteudo) }} />;
  }
  return (
    <div
      ref={(el) => {
        campo.current = el;
        registrar?.(el);
      }}
      contentEditable
      suppressContentEditableWarning
      style={estilo}
      role="textbox"
      aria-multiline
      aria-label={rotulo}
      data-placeholder={placeholder}
      onInput={(e) => onMudar?.(limparHtml(e.currentTarget.innerHTML), e.currentTarget.innerText)}
      className={`${CLASSE_DO_TEXTO} outline-none empty:before:text-gray-400 empty:before:content-[attr(data-placeholder)] ${className ?? ""}`}
    />
  );
}

/** Aplica um comando à seleção do campo; sem seleção nele, a todo o texto. Depois, avisa a alteração. */
function aplicar(campo: HTMLElement | null, fazer: (sel: Selection) => void) {
  if (!campo) return;
  const sel = window.getSelection();
  if (!sel) return;
  if (!sel.rangeCount || !campo.contains(sel.anchorNode) || sel.isCollapsed) {
    campo.focus();
    const r = document.createRange();
    r.selectNodeContents(campo);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  fazer(sel);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Os tamanhos da fonte, em px (17/10/2026: numerados na barra). O texto das anotações e das legendas é de 14 (o padrão, com asterisco na lista). */
// Até 72 (20/10/2026), para os títulos da Capa no Texto Livre; 84, 108 e 144 desde 22/10/2026.
export const TAMANHOS = [10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 60, 72, 84, 108, 144];
export const TAMANHO_PADRAO = 14;
/** Os tamanhos do título das anotações (19/10/2026), em maiúsculas e negrito: o padrão é 18 (22/10/2026; antes, 12). */
export const TAMANHOS_DO_TITULO = [12, 14, 16, 18, 20, 24, 28, 32];
export const TAMANHO_DO_TITULO = 18;

/** O tamanho, em px, do texto onde está a seleção (ou do campo, sem seleção nele). */
function tamanhoDaSelecao(campo: HTMLElement) {
  const sel = window.getSelection();
  let n: Node | null = sel && sel.rangeCount && campo.contains(sel.anchorNode) ? sel.anchorNode : campo;
  if (n && n.nodeType === Node.TEXT_NODE) n = n.parentNode;
  return Math.round(parseFloat(getComputedStyle((n as HTMLElement) ?? campo).fontSize));
}

/** A fonte do texto onde está o cursor (22/10/2026), entre as da lista; nenhuma delas, a Padrão (undefined). */
function fonteDaSelecao(campo: HTMLElement): ChaveDaFonte | undefined {
  const sel = window.getSelection();
  let n: Node | null = sel && sel.rangeCount && campo.contains(sel.anchorNode) ? sel.anchorNode : campo;
  if (n && n.nodeType === Node.TEXT_NODE) n = n.parentNode;
  const limpa = (f: string) => f.replace(/["'s]/g, "").toLowerCase();
  const atual = limpa(getComputedStyle((n as HTMLElement) ?? campo).fontFamily);
  return FONTES.find((x) => limpa(x.familia) === atual)?.chave;
}

/** O trecho com tamanho mais de fora que contém o nó (dentro do campo), ou null. */
function trechoComTamanho(no: Node | null, campo: HTMLElement): HTMLElement | null {
  let achado: HTMLElement | null = null;
  for (let n = no; n && n !== campo; n = n.parentNode) if (n instanceof HTMLElement && n.tagName === "SPAN" && n.style.fontSize) achado = n;
  return achado;
}

/**
 * Tira o ponto da inserção (o range já recolhido) de dentro dos trechos com tamanho (19/10/2026): o trecho se divide ali,
 * e o texto inserido fica entre as duas partes, sem herdar o tamanho dele (antes, diminuir uma seleção que começava num
 * trecho aumentado devolvia o texto para dentro dele, e ele continuava grande).
 */
function sairDosTamanhos(r: Range, campo: HTMLElement) {
  const trecho = trechoComTamanho(r.startContainer, campo);
  if (!trecho) return;
  const depois = document.createRange();
  depois.setStart(r.startContainer, r.startOffset);
  depois.setEnd(trecho, trecho.childNodes.length);
  const resto = depois.extractContents();
  if (resto.textContent) {
    const copia = trecho.cloneNode(false) as HTMLElement;
    copia.appendChild(resto);
    trecho.after(copia);
  }
  const pai = trecho.parentNode!;
  const indice = [...pai.childNodes].indexOf(trecho);
  if (trecho.textContent) {
    r.setStart(pai, indice + 1);
  } else {
    trecho.remove();
    r.setStart(pai, indice);
  }
  r.collapse(true);
}

/** Tira os trechos com tamanho que ficaram vazios (sobras das divisões). */
function tirarVazios(campo: HTMLElement) {
  campo.querySelectorAll<HTMLElement>("span").forEach((s) => {
    if (s.style.fontSize && !s.textContent && !s.querySelector("br")) s.remove();
  });
}

/**
 * Põe a fonte da seleção no tamanho escolhido (em px). Se a seleção é todo o trecho que já tem um tamanho, muda o dele
 * (sem um span dentro do outro, que deixava a linha alta); no tamanho do campo, o trecho perde a marca. Senão, envolve a
 * seleção num span novo, tirando os tamanhos de dentro dela (o tamanho escolhido vale para todo o trecho).
 */
function definirFonte(sel: Selection, px: number, campo: HTMLElement) {
  const r = sel.getRangeAt(0);
  const base = Math.round(parseFloat(getComputedStyle(campo).fontSize));
  const selecionar = (no: Node) => {
    sel.removeAllRanges();
    const nova = document.createRange();
    nova.selectNodeContents(no);
    sel.addRange(nova);
  };
  const desfazer = (span: HTMLElement) => {
    span.style.removeProperty("font-size");
    if (span.getAttribute("style")?.trim()) return [span] as Node[];
    const filhos = [...span.childNodes];
    span.replaceWith(...filhos);
    return filhos;
  };
  let n: Node | null = r.commonAncestorContainer;
  let trecho: HTMLElement | null = null;
  while (n && n !== campo) {
    if (n instanceof HTMLElement && n.tagName === "SPAN" && n.style.fontSize) {
      trecho = n;
      break;
    }
    n = n.parentNode;
  }
  const texto = sel.toString().trim();
  if (trecho && texto && trecho.textContent?.trim() === texto) {
    trecho.querySelectorAll<HTMLElement>("span").forEach((x) => x.style.fontSize && desfazer(x));
    if (px === base) {
      const nos = desfazer(trecho);
      if (nos.length) {
        sel.removeAllRanges();
        const nova = document.createRange();
        nova.setStartBefore(nos[0]);
        nova.setEndAfter(nos[nos.length - 1]);
        sel.addRange(nova);
      }
      return;
    }
    trecho.style.fontSize = `${px}px`;
    selecionar(trecho);
    return;
  }
  const conteudo = r.extractContents();
  conteudo.querySelectorAll<HTMLElement>("span").forEach((x) => x.style.fontSize && desfazer(x));
  // O texto volta fora dos trechos com tamanho (divididos no ponto), para não herdar o tamanho deles.
  sairDosTamanhos(r, campo);
  if (px === base) {
    const marca = document.createElement("span");
    marca.appendChild(conteudo);
    r.insertNode(marca);
    const filhos = [...marca.childNodes];
    marca.replaceWith(...filhos);
    tirarVazios(campo);
    if (filhos.length) {
      sel.removeAllRanges();
      const nova = document.createRange();
      nova.setStartBefore(filhos[0]);
      nova.setEndAfter(filhos[filhos.length - 1]);
      sel.addRange(nova);
    }
    return;
  }
  const span = document.createElement("span");
  span.style.fontSize = `${px}px`;
  span.appendChild(conteudo);
  r.insertNode(span);
  tirarVazios(campo);
  selecionar(span);
}

/** Tira a marca da fonte Padrão (os trechos voltam à fonte do campo) e desfaz os spans que ficaram sem estilo. */
function tirarFontePadrao(campo: HTMLElement) {
  campo.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
    if (!el.style.fontFamily.includes(FONTE_PADRAO)) return;
    el.style.removeProperty("font-family");
    if (!el.getAttribute("style")?.trim()) el.removeAttribute("style");
    if (el.tagName === "SPAN" && !el.attributes.length) el.replaceWith(...el.childNodes);
  });
  campo.querySelectorAll("font[face]").forEach((el) => {
    if (el.getAttribute("face")?.includes(FONTE_PADRAO)) el.replaceWith(...el.childNodes);
  });
}

/** Põe (ou tira, se já tem o mesmo) a lista com o marcador na seleção. */
function marcar(sel: Selection, campo: HTMLElement, simbolo: string) {
  const lista = () => {
    let n: Node | null = sel.anchorNode;
    while (n && n !== campo) {
      if (n instanceof HTMLUListElement) return n;
      n = n.parentNode;
    }
    return null;
  };
  const tipo = `"${simbolo}  "`;
  const atual = lista();
  if (atual && atual.style.listStyleType === tipo) {
    document.execCommand("insertUnorderedList");
    return;
  }
  if (!atual) document.execCommand("insertUnorderedList");
  const ul = lista();
  if (ul) ul.style.listStyleType = tipo;
}

/**
 * Os botões da formatação (17/10/2026; desde 24/10/2026, no menu único da edição): negrito, itálico, sublinhado, aumentar e diminuir a fonte, a
 * cor e os marcadores. O clique não tira o foco do texto (a seleção fica); as listas de cores e de marcadores abrem ali
 * mesmo, sem menu (o menu levaria o foco).
 */
export function BarraDeTexto({
  campo,
  botao,
  titulo,
  fontes = false,
  espacamento,
  alinhamento = false,
  desabilitado = false,
}: {
  campo: () => HTMLElement | null;
  botao: string;
  /**
   * No menu único da edição (24/10/2026): sem um bloco com texto escolhido, os botões ficam à vista, quase apagados. A
   * fonte e o espaçamento, sem `fontes` e sem `espacamento`, também (nas legendas das fotos e dos vídeos).
   */
  desabilitado?: boolean;
  /** A fonte do trecho (20/10/2026: nas anotações e no Texto Livre; no título da anotação, a dele). */
  fontes?: boolean;
  /** O espaçamento entre as linhas do texto todo do bloco (20/10/2026: nas anotações e no Texto Livre). */
  espacamento?: { valor?: number; definir: (e: number | undefined) => void };
  /** O alinhamento dos parágrafos (12/11/2026: no Texto Livre). */
  alinhamento?: boolean;
  /**
   * O título da anotação (19/10/2026): com o cursor nele, o tamanho da fonte muda o dele (os demais botões não valem
   * para o título).
   */
  titulo?: { campo: () => HTMLInputElement | null; tamanho: number; definir: (px: number) => void; fonte?: string; definirFonte?: (chave: ChaveDaFonte | undefined) => void };
}) {
  const [aberta, setAberta] = useState<"cor" | "marcador" | "tamanho" | "fonte" | "espacamento" | "alinhamento" | null>(null);
  // Outro bloco escolhido (24/10/2026, o menu único): a lista aberta fecha.
  const [doBloco, setDoBloco] = useState({ campo, desabilitado });
  if (doBloco.campo !== campo || doBloco.desabilitado !== desabilitado) {
    setDoBloco({ campo, desabilitado });
    setAberta(null);
  }
  // O tamanho do texto onde está o cursor (o número do botão), a cada mudança da seleção; no título, o dele.
  const [tamanho, setTamanho] = useState(14);
  // A fonte do texto onde está o cursor (22/10/2026), destacada na lista das fontes; no título, a dele.
  const [fonteAtual, setFonteAtual] = useState<ChaveDaFonte | undefined>(undefined);
  // O alinhamento do parágrafo onde está o cursor (12/11/2026), o ícone do botão e o destaque da lista.
  const [alinhamentoAtual, setAlinhamentoAtual] = useState<ChaveDoAlinhamento>("left");
  // O título mais recente (para os eventos) e se o cursor está nele (para a lista dos tamanhos).
  const doTitulo = useRef(titulo);
  useEffect(() => {
    doTitulo.current = titulo;
  });
  const [focoNoTitulo, setFocoNoTitulo] = useState(false);
  const noTitulo = () => !!doTitulo.current && document.activeElement === doTitulo.current.campo();
  useEffect(() => {
    const aoSelecionar = () => {
      const el = campo();
      const sel = window.getSelection();
      if (el && sel && sel.rangeCount && el.contains(sel.anchorNode)) {
        setTamanho(tamanhoDaSelecao(el));
        setFonteAtual(fonteDaSelecao(el));
        setAlinhamentoAtual(alinhamentoDaSelecao(el));
      }
    };
    const aoFocar = () => {
      const nele = !!doTitulo.current && document.activeElement === doTitulo.current.campo();
      setFocoNoTitulo(nele);
      if (nele) setTamanho(doTitulo.current!.tamanho);
    };
    document.addEventListener("selectionchange", aoSelecionar);
    document.addEventListener("focusin", aoFocar);
    return () => {
      document.removeEventListener("selectionchange", aoSelecionar);
      document.removeEventListener("focusin", aoFocar);
    };
  }, [campo]);
  const fonte = (px: number) => {
    if (noTitulo()) {
      doTitulo.current!.definir(px);
      setTamanho(px);
      return;
    }
    const el = campo();
    if (!el) return;
    aplicar(el, (s) => definirFonte(s, px, el));
    setTamanho(px);
  };
  const exec = (cmd: string, valor?: string, comCss = false) => {
    if (noTitulo()) return;
    aplicar(campo(), () => {
      document.execCommand("styleWithCSS", false, comCss ? "true" : "false");
      document.execCommand(cmd, false, valor);
    });
  };
  const item = ITEM_DA_BARRA;
  const alternar = (m: NonNullable<typeof aberta>) => () => setAberta((a) => (a === m ? null : m));
  // A fonte (20/10/2026): no título da anotação, a dele; no texto, a do trecho (Padrão tira a escolhida).
  const escolherFonte = (chave: ChaveDaFonte | undefined) => {
    setAberta(null);
    if (noTitulo()) return doTitulo.current?.definirFonte?.(chave);
    if (chave) {
      setFonteAtual(chave);
      return exec("fontName", familiaDa(chave), true);
    }
    const el = campo();
    aplicar(el, () => {
      document.execCommand("styleWithCSS", false, "true");
      document.execCommand("fontName", false, FONTE_PADRAO);
      if (el) tirarFontePadrao(el);
    });
    setFonteAtual(undefined);
  };
  const IconeDoAlinhamento = ALINHAMENTOS.find((x) => x.chave === alinhamentoAtual)!.Icone;
  // A fonte destacada na lista: a do título, com o cursor nele; senão, a do texto.
  const fonteMarcada = titulo && focoNoTitulo ? titulo.fonte : fonteAtual;
  const marcada = (chave?: string) => (fonteMarcada === chave ? "bg-gray-100 font-bold text-gray-900" : "");
  return (
    <>
      <button type="button" className={botao} disabled={desabilitado} onMouseDown={semFoco} onClick={() => exec("bold")} title="Negrito" aria-label="Negrito">
        <Bold className="size-4" />
      </button>
      <button type="button" className={botao} disabled={desabilitado} onMouseDown={semFoco} onClick={() => exec("italic")} title="Itálico" aria-label="Itálico">
        <Italic className="size-4" />
      </button>
      <button type="button" className={botao} disabled={desabilitado} onMouseDown={semFoco} onClick={() => exec("underline")} title="Sublinhado" aria-label="Sublinhado">
        <Underline className="size-4" />
      </button>
      {/* O tamanho da fonte (17/10/2026): um botão só, com o número; a lista dos tamanhos, com o padrão marcado com asterisco. */}
      <span className="relative">
        <button
          type="button"
          className={`${botao} w-auto min-w-9 gap-0 px-1 text-xs font-semibold`}
          disabled={desabilitado}
          onMouseDown={semFoco}
          onClick={() => setAberta((a) => (a === "tamanho" ? null : "tamanho"))}
          title="Tamanho da fonte"
          aria-label={`Tamanho da fonte: ${tamanho}`}
          aria-expanded={aberta === "tamanho"}
        >
          {tamanho}
          <ChevronDown className="size-3" />
        </button>
        {aberta === "tamanho" ? (
          <span className="absolute top-full left-0 z-40 mt-1 grid w-20 rounded-sm border border-gray-200 bg-white p-1 shadow-md">
            {(titulo && focoNoTitulo ? TAMANHOS_DO_TITULO : TAMANHOS).map((t) => (
              <button
                key={t}
                type="button"
                className={`${item} justify-center ${t === tamanho ? "font-bold text-gray-900" : ""}`}
                onMouseDown={semFoco}
                onClick={() => {
                  fonte(t);
                  setAberta(null);
                }}
              >
                {t === (titulo && focoNoTitulo ? TAMANHO_DO_TITULO : TAMANHO_PADRAO) ? `${t}*` : t}
              </button>
            ))}
            <span className="border-t border-gray-100 px-1 pt-1 text-center text-[10px] text-gray-500">* padrão</span>
          </span>
        ) : null}
      </span>
      {/* A fonte, sempre à vista (24/10/2026): quase apagada nas legendas das fotos e dos vídeos, que não a têm. */}
      <MenuDaBarra botao={botao} titulo="Fonte" gatilho={<CaseSensitive className="size-4" />} aberto={aberta === "fonte"} onAlternar={alternar("fonte")} largura="w-36" desabilitado={desabilitado || !fontes}>
          {/* A fonte atual destacada (22/10/2026), em negrito e com o fundo cinza. */}
          <button type="button" className={`${item} ${marcada(undefined)}`} aria-current={fonteMarcada === undefined} onMouseDown={semFoco} onClick={() => escolherFonte(undefined)}>
            Padrão
          </button>
          {FONTES.map((x) => (
            <button
              key={x.chave}
              type="button"
              className={`${item} text-sm ${marcada(x.chave)}`}
              aria-current={fonteMarcada === x.chave}
              style={{ fontFamily: x.familia }}
              onMouseDown={semFoco}
              onClick={() => escolherFonte(x.chave)}
            >
              {x.nome}
            </button>
          ))}
      </MenuDaBarra>
      <span className="relative">
        <button type="button" className={`${botao} w-auto gap-0 px-0.5`} disabled={desabilitado} onMouseDown={semFoco} onClick={() => setAberta((a) => (a === "cor" ? null : "cor"))} title="Cor da fonte" aria-label="Cor da fonte" aria-expanded={aberta === "cor"}>
          <Palette className="size-4" />
          <ChevronDown className="size-3" />
        </button>
        {aberta === "cor" ? (
          <span className="absolute top-full left-0 z-40 mt-1 grid w-40 rounded-sm border border-gray-200 bg-white p-1 shadow-md">
            {CORES_DA_FONTE.map((c) => (
              <button
                key={c.cor}
                type="button"
                className={item}
                onMouseDown={semFoco}
                onClick={() => {
                  if (noTitulo()) return setAberta(null);
                  if (c.cor === COR_PADRAO) {
                    const el = campo();
                    aplicar(el, () => {
                      document.execCommand("styleWithCSS", false, "true");
                      document.execCommand("foreColor", false, COR_PADRAO);
                      if (el) tirarCorPadrao(el);
                    });
                  } else exec("foreColor", c.cor, true);
                  setAberta(null);
                }}
              >
                <span
                  className="size-3.5 shrink-0 rounded-[2px] border border-gray-300"
                  style={{ background: c.cor === COR_PADRAO ? "linear-gradient(135deg, #111827 50%, #ffffff 50%)" : c.cor }}
                />
                {c.nome}
              </button>
            ))}
          </span>
        ) : null}
      </span>
      <span className="relative">
        <button type="button" className={`${botao} w-auto gap-0 px-0.5`} disabled={desabilitado} onMouseDown={semFoco} onClick={() => setAberta((a) => (a === "marcador" ? null : "marcador"))} title="Marcadores" aria-label="Marcadores" aria-expanded={aberta === "marcador"}>
          <List className="size-4" />
          <ChevronDown className="size-3" />
        </button>
        {aberta === "marcador" ? (
          <span className="absolute top-full left-0 z-40 mt-1 grid w-36 rounded-sm border border-gray-200 bg-white p-1 shadow-md">
            {MARCADORES.map((m) => (
              <button
                key={m.nome}
                type="button"
                className={item}
                onMouseDown={semFoco}
                onClick={() => {
                  const el = campo();
                  if (el && !noTitulo()) aplicar(el, (s) => marcar(s, el, m.simbolo));
                  setAberta(null);
                }}
              >
                <span className="w-4 text-center text-sm">{m.simbolo}</span>
                {m.nome}
              </button>
            ))}
          </span>
        ) : null}
      </span>
      {/* O alinhamento (12/11/2026, pedido do Adão), logo antes do espaçamento: no Texto Livre; nos demais, quase apagado. */}
      <MenuDaBarra
        botao={botao}
        titulo="Alinhamento"
        gatilho={<IconeDoAlinhamento className="size-4" />}
        aberto={aberta === "alinhamento"}
        onAlternar={alternar("alinhamento")}
        largura="w-40"
        desabilitado={desabilitado || !alinhamento}
      >
        {ALINHAMENTOS.map((x) => (
          <button
            key={x.chave}
            type="button"
            className={`${item} ${x.chave === alinhamentoAtual ? "bg-gray-100 font-bold text-gray-900" : ""}`}
            aria-current={x.chave === alinhamentoAtual}
            onMouseDown={semFoco}
            onClick={() => {
              exec(x.comando, undefined, true);
              setAlinhamentoAtual(x.chave);
              setAberta(null);
            }}
          >
            <x.Icone className="size-4 shrink-0" />
            {x.nome}
          </button>
        ))}
      </MenuDaBarra>
      {/* O espaçamento, sempre à vista (24/10/2026): quase apagado nas legendas, que não o têm. */}
      <MenuDaBarra
        botao={botao}
        titulo="Espaçamento entre linhas"
        gatilho={<UnfoldVertical className="size-4" />}
        aberto={aberta === "espacamento"}
        onAlternar={alternar("espacamento")}
        largura="w-24"
        desabilitado={desabilitado || !espacamento}
      >
        {ESPACAMENTOS.map((e) => (
          <button
            key={e}
            type="button"
            className={`${item} justify-center ${e === espacamento?.valor ? "font-bold text-gray-900" : ""}`}
            onMouseDown={semFoco}
            onClick={() => {
              espacamento?.definir(e);
              setAberta(null);
            }}
          >
            {rotuloDoEspacamento(e)}
          </button>
        ))}
        <button
          type="button"
          className={`${item} justify-center border-t border-gray-100 ${espacamento?.valor === undefined ? "font-bold text-gray-900" : ""}`}
          onMouseDown={semFoco}
          onClick={() => {
            espacamento?.definir(undefined);
            setAberta(null);
          }}
        >
          Padrão
        </button>
      </MenuDaBarra>
    </>
  );
}
