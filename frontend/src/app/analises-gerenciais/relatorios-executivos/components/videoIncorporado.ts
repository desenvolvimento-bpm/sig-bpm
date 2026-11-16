/**
 * Os links de vídeo dos Relatórios Executivos (20/10/2026): o endereço colado (ou o código "incorporar" da plataforma) do
 * YouTube, do Instagram, do Facebook ou do LinkedIn vira o player incorporado da plataforma. Só o YouTube aceita comandos
 * da página (reproduzir, parar, mudo, pela API do iframe); nos outros, os controles são os do próprio player.
 */

export type Plataforma = "youtube" | "instagram" | "facebook" | "linkedin";
export const NOME_DA_PLATAFORMA: Record<Plataforma, string> = { youtube: "YouTube", instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn" };

export type VideoDoLink = {
  plataforma: Plataforma;
  /** O endereço do player: com ou sem os controles da plataforma, do início ou de um segundo, tocando ou não. */
  embed: (o: { controles: boolean; inicio?: number; tocar?: boolean; mudo?: boolean; repetir?: boolean }) => string;
  /** A proporção do player (largura ÷ altura), para o bloco começar no tamanho dele. */
  proporcao: number;
  /** A página aceita comandos do player (só o YouTube). */
  comandos: boolean;
};

/** O endereço do código "incorporar" (<iframe src="…">), ou o próprio texto. */
function enderecoDoTexto(texto: string) {
  const t = texto.trim();
  const src = /<iframe[^>]*\ssrc=["']([^"']+)["']/i.exec(t)?.[1];
  return (src ?? t).replace(/&amp;/g, "&");
}

/** Interpreta o link (ou o código incorporar); null quando não é de uma das plataformas aceitas. */
export function videoDoLink(texto: string): VideoDoLink | null {
  let u: URL;
  try {
    u = new URL(enderecoDoTexto(texto));
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^(www|m|mobile)\./, "");
  const partes = u.pathname.split("/").filter(Boolean);

  // YouTube: watch?v=, youtu.be/, shorts/, embed/, live/.
  if (host === "youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com" || host === "music.youtube.com") {
    const id =
      host === "youtu.be"
        ? partes[0]
        : u.searchParams.get("v") ?? (["shorts", "embed", "live", "v"].includes(partes[0] ?? "") ? partes[1] : undefined);
    if (!id || !/^[\w-]{6,20}$/.test(id)) return null;
    const vertical = partes[0] === "shorts";
    return {
      plataforma: "youtube",
      proporcao: vertical ? 9 / 16 : 16 / 9,
      comandos: true,
      embed: ({ controles, inicio, tocar, mudo, repetir }) => {
        const p = new URLSearchParams({ enablejsapi: "1", rel: "0", playsinline: "1", modestbranding: "1", controls: controles ? "1" : "0" });
        if (typeof window !== "undefined") p.set("origin", window.location.origin);
        if (inicio) p.set("start", String(Math.floor(inicio)));
        if (tocar) p.set("autoplay", "1");
        if (mudo) p.set("mute", "1");
        // Recomeçar ao Terminar (13/11/2026): o YouTube repete com a lista de um vídeo só.
        if (repetir) {
          p.set("loop", "1");
          p.set("playlist", id);
        }
        return `https://www.youtube.com/embed/${id}?${p}`;
      },
    };
  }

  // Instagram: /p/, /reel/, /reels/, /tv/ (as publicações públicas).
  if (host === "instagram.com") {
    const i = partes.findIndex((x) => ["p", "reel", "reels", "tv"].includes(x));
    const codigo = i >= 0 ? partes[i + 1] : undefined;
    if (!codigo || !/^[\w-]{5,40}$/.test(codigo)) return null;
    const tipo = partes[i] === "p" ? "p" : partes[i] === "tv" ? "tv" : "reel";
    return { plataforma: "instagram", proporcao: 4 / 5, comandos: false, embed: () => `https://www.instagram.com/${tipo}/${codigo}/embed/` };
  }

  // Facebook: o player de vídeos (plugins/video.php) com o endereço do vídeo público (videos/, watch/?v=, reel/, fb.watch/…).
  if (host === "facebook.com" || host === "fb.watch" || host === "web.facebook.com") {
    if (partes[0] === "plugins") {
      const href = u.searchParams.get("href");
      return href ? videoDoLink(href) : null;
    }
    const href = u.toString();
    return {
      plataforma: "facebook",
      proporcao: partes[0] === "reel" ? 9 / 16 : 16 / 9,
      comandos: false,
      embed: ({ tocar, mudo }) => `https://www.facebook.com/plugins/video.php?${new URLSearchParams({ href, show_text: "false", autoplay: tocar ? "true" : "false", mute: mudo ? "true" : "false" })}`,
    };
  }

  // LinkedIn: a publicação (o código "Incorporar esta publicação", o urn:li:… ou o link da publicação, com o activity-…).
  if (host === "linkedin.com") {
    const urn = /urn:li:(share|ugcPost|activity):(\d+)/.exec(decodeURIComponent(u.pathname))?.slice(1) ?? (/activity-(\d{10,25})/.exec(u.pathname) ? ["activity", /activity-(\d{10,25})/.exec(u.pathname)![1]] : null);
    if (!urn) return null;
    return { plataforma: "linkedin", proporcao: 4 / 5, comandos: false, embed: () => `https://www.linkedin.com/embed/feed/update/urn:li:${urn[0]}:${urn[1]}` };
  }
  return null;
}

/**
 * Os comandos do player do YouTube (a API do iframe, por mensagens): reproduzir, pausar, parar e mudo. `ouvir` pede ao
 * player o estado (o tempo e se está tocando), que chega em `mensagem`.
 */
export const comandoDoYoutube = (iframe: HTMLIFrameElement | null, func: "playVideo" | "pauseVideo" | "stopVideo" | "mute" | "unMute" | "seekTo", args: unknown[] = []) =>
  iframe?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*");
export const ouvirYoutube = (iframe: HTMLIFrameElement | null) => iframe?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*");
/** O estado que o player do YouTube manda: o tempo (s) e se está tocando (playerState 1). */
export function estadoDoYoutube(dados: unknown): { tempo?: number; tocando?: boolean; mudo?: boolean } | null {
  try {
    const m = typeof dados === "string" ? JSON.parse(dados) : dados;
    if (!m || typeof m !== "object" || !("event" in m)) return null;
    const info = (m as { info?: { currentTime?: number; playerState?: number; muted?: boolean } | number }).info;
    if ((m as { event: string }).event === "onStateChange" && typeof info === "number") return { tocando: info === 1 };
    if (info && typeof info === "object") return { tempo: info.currentTime, tocando: info.playerState === undefined ? undefined : info.playerState === 1, mudo: info.muted };
    return null;
  } catch {
    return null;
  }
}
