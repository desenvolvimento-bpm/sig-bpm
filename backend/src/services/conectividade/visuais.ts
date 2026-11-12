/**
 * O formato visual da Biblioteca de APIs (24/10/2026): os cards e as tabelas em SVG, desenhados no servidor como nas
 * telas do SIG. A imagem sai igual em qualquer aplicativo (uma página, o Power BI, o Office), sem depender das fontes e
 * dos estilos de quem a mostra. Sem o navegador, a largura dos textos é estimada: os nomes longos se cortam com
 * reticências. Os textos passam por `esc` (nada do que vem dos dados vira marcação).
 */

/** O sinal do desvio, como no Painel de Bordo: 1 melhor, 0 até 5%, -1 pior; null, sem sinal (cinza). */
export type Sinal = 1 | 0 | -1 | null;

export type Visual = { titulo: string; largura: number; altura: number; svg: string };

const FONTE = "Inter, 'Segoe UI', Arial, sans-serif";
/** As cores das telas (as do tema claro): o amarelo-ouro da BPM, os cinzas, os fundos dos totais e as dos sinais. */
const COR = {
  texto: "#111827",
  cinza: "#4b5563",
  cinzaClaro: "#6b7280",
  borda: "#e5e7eb",
  fundo: "#ffffff",
  destaque: "#f3f4f6",
  bpm: "#ffcc00",
  comparado: "#374151",
  total: "#fef9c3",
  resultado: "#fef08a",
  melhor: "#16a34a",
  ate5: "#eab308",
  pior: "#dc2626",
  semSinal: "#9ca3af",
};
const COR_DO_SINAL = (s: Sinal) => (s === 1 ? COR.melhor : s === 0 ? COR.ate5 : s === -1 ? COR.pior : COR.semSinal);
const ICONE_DO_SINAL = (s: Sinal) => (s === 1 ? "▲" : s === 0 ? "■" : s === -1 ? "▼" : "");

export const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
/** A largura estimada de um texto, em px: a média das letras da fonte (as do negrito, um pouco mais largas). */
const larguraDe = (t: string, px: number, negrito = false) => t.length * px * (negrito ? 0.56 : 0.5);
/** O texto que cabe em `max` px, cortado com reticências. */
export function cortar(t: string, px: number, max: number, negrito = false) {
  if (larguraDe(t, px, negrito) <= max) return t;
  let s = t;
  while (s.length > 1 && larguraDe(`${s}…`, px, negrito) > max) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}
type OpcoesDoTexto = { px?: number; cor?: string; negrito?: boolean; ancora?: "start" | "middle" | "end" };
function texto(x: number, y: number, t: string, { px = 12, cor = COR.texto, negrito = false, ancora = "start" }: OpcoesDoTexto = {}) {
  return `<text x="${x}" y="${y}" font-size="${px}" fill="${cor}"${negrito ? ' font-weight="700"' : ""}${ancora === "start" ? "" : ` text-anchor="${ancora}"`}>${esc(t)}</text>`;
}
const retangulo = (x: number, y: number, w: number, h: number, cor: string, raio = 0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${raio}" fill="${cor}"/>`;
const svg = (w: number, h: number, corpo: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONTE}">${retangulo(0, 0, w, h, COR.fundo)}${corpo}</svg>`;

/** Um valor do card (o do mês ou o acumulado), já formatado, com o comparado e o desvio. */
export type BlocoDoCard = { valor: string; comparado: string; desvio: string; sinal: Sinal };
export type CardVisual = {
  titulo: string;
  /** À direita do título: o grupo e o sentido ("Venda: Total (↑)"). */
  subtitulo: string;
  /** O mês ("SET/2026"), ao lado do subtítulo. */
  periodo: string;
  /** A unidade, no rótulo do Atual e do Acumulado ("R$ M"). */
  unidade: string;
  /** O nome do comparado ("Orçamento", "Forecast"…). */
  rotuloComparado: string;
  mes: BlocoDoCard;
  acumulado: BlocoDoCard;
  /** O gráfico (na unidade da escala): os meses e, no fim, o acumulado. Sem ele, o card sem gráfico. */
  serie?: Array<{ rotulo: string; realizado: number | null; comparado: number | null }>;
  acumuladoNoGrafico?: { realizado: number | null; comparado: number | null };
};

/** O quadro cinza do comparado, com a faixa da cor do sinal à direita (como no Painel de Bordo). */
function quadroDoComparado(x: number, y: number, w: number, b: BlocoDoCard, rotulo: string, comDesvio: boolean) {
  const h = 58;
  let corpo = retangulo(x, y, w, h, COR.destaque, 3) + retangulo(x + w - 5, y, 5, h, COR_DO_SINAL(b.sinal));
  if (comDesvio) corpo += texto(x + w - 14, y + 20, `${ICONE_DO_SINAL(b.sinal)} ${b.desvio}`.trim(), { px: 15, negrito: true, ancora: "end", cor: b.sinal === null ? COR.cinza : COR.texto });
  corpo += texto(x + w - 14, y + (comDesvio ? 36 : 26), `vs. ${cortar(rotulo, 11, w - 40)}`, { px: 11, cor: COR.cinza, ancora: "end" });
  corpo += texto(x + w - 14, y + (comDesvio ? 52 : 46), b.comparado, { px: 15, negrito: true, ancora: "end" });
  return corpo;
}

/** O gráfico do card: as barras do realizado (amarelo-ouro) e do comparado (cinza escuro) por mês, e o acumulado num quadro. */
function graficoDoCard(x: number, y: number, w: number, h: number, c: CardVisual) {
  const meses = c.serie ?? [];
  const acum = c.acumuladoNoGrafico;
  const valores = [...meses.flatMap((m) => [m.realizado, m.comparado]), acum?.realizado ?? null, acum?.comparado ?? null].filter((v): v is number => v !== null);
  if (!valores.length) return texto(x + w / 2, y + h / 2, "Sem dados para o gráfico", { px: 12, cor: COR.cinzaClaro, ancora: "middle" });
  const maximo = Math.max(0, ...valores);
  const minimo = Math.min(0, ...valores);
  const area = h - 22;
  const escala = maximo - minimo || 1;
  const zero = y + (maximo / escala) * area;
  const grupos = meses.length + (acum ? 1 : 0);
  const passo = w / Math.max(grupos, 1);
  const barra = Math.min(16, passo * 0.32);
  let corpo = `<line x1="${x}" y1="${zero}" x2="${x + w}" y2="${zero}" stroke="${COR.borda}"/>`;
  const barras = (gx: number, r: number | null, o: number | null) => {
    let b = "";
    for (const [v, cor, dx] of [[r, COR.bpm, -barra - 1], [o, COR.comparado, 1]] as const) {
      if (v === null) continue;
      const alto = (Math.abs(v) / escala) * area;
      b += retangulo(gx + dx, v >= 0 ? zero - alto : zero, barra, Math.max(alto, 0.5), cor);
    }
    return b;
  };
  meses.forEach((m, k) => {
    const cx = x + passo * k + passo / 2;
    corpo += barras(cx, m.realizado, m.comparado) + texto(cx, y + h - 4, m.rotulo, { px: 10, cor: COR.cinza, ancora: "middle" });
  });
  if (acum) {
    const cx = x + passo * meses.length + passo / 2;
    corpo = retangulo(cx - passo / 2 + 2, y, passo - 4, h, COR.destaque, 3) + corpo + barras(cx, acum.realizado, acum.comparado) + texto(cx, y + h - 4, "ACUM.", { px: 10, negrito: true, ancora: "middle" });
  }
  return corpo;
}

/** O card do Painel de Bordo (ou de um indicador): o título, o Atual e o Acumulado com o comparado e, se houver, o gráfico. */
export function cardEmSvg(c: CardVisual): Visual {
  const comGrafico = !!c.serie?.length;
  const largura = comGrafico ? 1040 : 500;
  const altura = 196;
  let corpo = `<rect x="0.5" y="0.5" width="${largura - 1}" height="${altura - 1}" rx="4" fill="${COR.fundo}" stroke="${COR.borda}"/>`;
  corpo += retangulo(0, 0, 4, altura, COR.bpm);
  corpo += texto(22, 34, cortar(c.titulo, 18, 310, true), { px: 18, negrito: true });
  corpo += texto(478, 28, cortar(c.subtitulo, 11, 130), { px: 11, cor: COR.cinza, ancora: "end" });
  corpo += texto(478, 44, c.periodo, { px: 11, cor: COR.cinzaClaro, ancora: "end" });
  // O Atual: o rótulo com a unidade, o valor e o quadro do comparado.
  corpo += texto(22, 104, `Atual (${c.unidade})`, { px: 11, cor: COR.cinza });
  corpo += texto(22, 136, cortar(c.mes.valor, 26, 112, true), { px: 26, negrito: true });
  corpo += quadroDoComparado(138, 92, 96, c.mes, c.rotuloComparado, false);
  // O Acumulado, com o desvio no quadro.
  corpo += texto(256, 104, `Acumulado (${c.unidade})`, { px: 11, cor: COR.cinza });
  corpo += texto(256, 136, cortar(c.acumulado.valor, 26, 104, true), { px: 26, negrito: true });
  corpo += quadroDoComparado(366, 92, 112, c.acumulado, c.rotuloComparado, true);
  if (comGrafico) {
    corpo += `<line x1="500" y1="16" x2="500" y2="${altura - 16}" stroke="${COR.borda}"/>`;
    corpo += graficoDoCard(516, 22, largura - 536, altura - 40, c);
  }
  return { titulo: c.titulo, largura, altura, svg: svg(largura, altura, corpo) };
}

export type ColunaVisual = { titulo: string; largura: number; alinhar: "start" | "end" };
export type LinhaVisual = { celulas: string[]; estilo: "SECAO" | "ITEM" | "SUBTOTAL" | "TOTAL"; recuo?: number };

/** A tabela (a DRE): o título, o cabeçalho em amarelo-ouro e as linhas, com os totais nos amarelos das telas. */
export function tabelaEmSvg(titulo: string, subtitulo: string, colunas: ColunaVisual[], linhas: LinhaVisual[]): Visual {
  const margem = 16;
  const largura = colunas.reduce((s, c) => s + c.largura, 0) + margem * 2;
  const topo = 58;
  const alturaDaLinha = 24;
  const altura = topo + 30 + linhas.length * alturaDaLinha + margem;
  let corpo = texto(margem, 26, titulo, { px: 16, negrito: true }) + texto(margem, 44, subtitulo, { px: 12, cor: COR.cinza });
  corpo += retangulo(margem, topo, largura - margem * 2, 30, COR.bpm);
  let x = margem;
  const posicoes = colunas.map((c) => {
    const p = x;
    x += c.largura;
    return p;
  });
  colunas.forEach((c, k) => {
    corpo += texto(c.alinhar === "end" ? posicoes[k] + c.largura - 8 : posicoes[k] + 8, topo + 20, cortar(c.titulo, 11, c.largura - 12, true), { px: 11, negrito: true, ancora: c.alinhar });
  });
  linhas.forEach((l, i) => {
    const y = topo + 30 + i * alturaDaLinha;
    if (l.estilo === "SUBTOTAL" || l.estilo === "TOTAL") corpo += retangulo(margem, y, largura - margem * 2, alturaDaLinha, l.estilo === "TOTAL" ? COR.resultado : COR.total);
    corpo += `<line x1="${margem}" y1="${y + alturaDaLinha}" x2="${largura - margem}" y2="${y + alturaDaLinha}" stroke="${COR.borda}"/>`;
    const negrito = l.estilo !== "ITEM";
    l.celulas.forEach((t, k) => {
      const c = colunas[k];
      if (!c) return;
      const recuo = k === 0 ? (l.recuo ?? 0) * 12 : 0;
      const px = l.estilo === "SECAO" && k === 0 ? 11 : 12;
      const conteudo = l.estilo === "SECAO" && k === 0 ? t.toUpperCase() : t;
      corpo += texto(c.alinhar === "end" ? posicoes[k] + c.largura - 8 : posicoes[k] + 8 + recuo, y + 16, cortar(conteudo, px, c.largura - 14 - recuo, negrito), {
        px,
        negrito,
        cor: l.estilo === "SECAO" ? COR.cinza : COR.texto,
        ancora: c.alinhar,
      });
    });
  });
  return { titulo, largura, altura, svg: svg(largura, altura, corpo) };
}
