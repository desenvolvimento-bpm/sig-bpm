"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, Square, Video, Volume2, VolumeX } from "lucide-react";

import { enderecoDoVideo, type Bloco } from "../services/relatoriosExecutivosService";
import { useProcesso } from "./processo";
import { comandoDoYoutube, estadoDoYoutube, NOME_DA_PLATAFORMA, ouvirYoutube, videoDoLink } from "./videoIncorporado";

type BlocoDeVideo = Extract<Bloco, { tipo: "VIDEO" }>;

/**
 * Onde o vídeo aparece (20/10/2026): na edição e na leitura, com os controles do player; na apresentação, sem eles, com os
 * botões Reproduzir, Parar e Mudo no centro de baixo ao passar o mouse (o clique no vídeo o amplia); ampliado, com os
 * controles do player (a barra para avançar e recuar), a partir de onde estava.
 */
export type ModoDoVideo = "edicao" | "leitura" | "apresentacao" | "ampliado";

/** O estado do player de um bloco na tela (o vídeo ou o iframe com data-video-do-bloco): o tempo e se está tocando. */
export function estadoDoPlayer(el: Element | null): { tempo: number; tocando: boolean } {
  if (el instanceof HTMLVideoElement) return { tempo: el.currentTime, tocando: !el.paused && !el.ended };
  if (el instanceof HTMLIFrameElement) return { tempo: Number(el.dataset.tempo ?? 0), tocando: el.dataset.tocando === "1" };
  return { tempo: 0, tocando: false };
}
/** Pausa o player de um bloco (antes de ampliá-lo). */
export function pausarPlayer(el: Element | null) {
  if (el instanceof HTMLVideoElement) el.pause();
  else if (el instanceof HTMLIFrameElement) comandoDoYoutube(el, "pauseVideo");
}
/** Leva o player de um bloco a um tempo, pausado (ao fechar o ampliado). */
export function irPara(el: Element | null, tempo: number) {
  if (el instanceof HTMLVideoElement) el.currentTime = tempo;
  else if (el instanceof HTMLIFrameElement) {
    comandoDoYoutube(el, "seekTo", [tempo, true]);
    comandoDoYoutube(el, "pauseVideo");
  }
}

export function PlayerDoVideo({
  relatorioId,
  b,
  modo,
  inicio,
  tocar,
  onEscolher,
}: {
  relatorioId: string;
  b: BlocoDeVideo;
  modo: ModoDoVideo;
  /** No ampliado: o tempo (s) de onde começa e se começa tocando (o estado do vídeo na grade). */
  inicio?: number;
  tocar?: boolean;
  /** No quadro vazio, na edição: escolher o vídeo (o arquivo ou o link). */
  onEscolher?: () => void;
}) {
  const { rota } = useProcesso();
  const video = useRef<HTMLVideoElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const [tocando, setTocando] = useState(false);
  const [mudo, setMudo] = useState(false);
  const link = b.origem === "LINK" && b.url ? videoDoLink(b.url) : null;
  const youtube = link?.comandos ?? false;
  const apresentacao = modo === "apresentacao";
  // As Configurações do Vídeo (13/11/2026): a Reprodução Automática vale na leitura e na apresentação (na edição, não), e
  // o Recomeçar ao Terminar, em todos os modos.
  const automatico = !!b.reproducaoAutomatica && (modo === "leitura" || apresentacao);
  const repetir = !!b.recomecarAoTerminar;

  // A Reprodução Automática do arquivo: tenta com o som; se o navegador recusar (sem um clique na página), toca sem som.
  useEffect(() => {
    const v = video.current;
    if (!automatico || !v) return;
    v.play().catch(() => {
      v.muted = true;
      void v.play().catch(() => undefined);
    });
  }, [automatico, b.arquivo]);

  // O estado do player do YouTube (o tempo e se está tocando), que ele manda por mensagens depois do "listening".
  useEffect(() => {
    if (!youtube) return;
    const aoReceber = (e: MessageEvent) => {
      if (!iframe.current || e.source !== iframe.current.contentWindow) return;
      const estado = estadoDoYoutube(e.data);
      if (!estado) return;
      if (estado.tempo !== undefined) iframe.current.dataset.tempo = String(estado.tempo);
      if (estado.tocando !== undefined) {
        iframe.current.dataset.tocando = estado.tocando ? "1" : "0";
        setTocando(estado.tocando);
      }
      if (estado.mudo !== undefined) setMudo(estado.mudo);
    };
    window.addEventListener("message", aoReceber);
    return () => window.removeEventListener("message", aoReceber);
  }, [youtube]);

  // O quadro vazio (o relatório importado sem as imagens e os vídeos): cinza, com o botão de escolher na edição.
  if (!b.arquivo && !b.url) {
    return (
      <button
        type="button"
        disabled={!onEscolher}
        onClick={onEscolher}
        className={`flex h-full w-full flex-col items-center justify-center gap-1 rounded-sm bg-gray-200 text-gray-500 ${onEscolher ? "cursor-pointer hover:bg-gray-300 hover:text-gray-700" : "cursor-default"}`}
        title={onEscolher ? "Escolher o vídeo deste quadro" : "Sem vídeo"}
      >
        <Video className="size-8" />
        {onEscolher ? <span className="text-xs font-medium">Carregar Vídeo</span> : null}
      </button>
    );
  }
  if (b.origem === "LINK" && !link) {
    return <div className="flex h-full items-center justify-center rounded-sm border border-dashed border-gray-300 bg-white p-3 text-center text-xs text-gray-500">O link do vídeo não é do YouTube, Instagram, Facebook ou LinkedIn.</div>;
  }

  const reproduzir = () => {
    if (video.current) {
      if (video.current.paused) void video.current.play();
      else video.current.pause();
    } else comandoDoYoutube(iframe.current, tocando ? "pauseVideo" : "playVideo");
  };
  const parar = () => {
    if (video.current) {
      video.current.pause();
      video.current.currentTime = 0;
    } else {
      comandoDoYoutube(iframe.current, "stopVideo");
      setTocando(false);
    }
  };
  const silenciar = () => {
    if (video.current) video.current.muted = !video.current.muted;
    else {
      comandoDoYoutube(iframe.current, mudo ? "unMute" : "mute");
      setMudo(!mudo);
    }
  };

  const player =
    b.origem === "ARQUIVO" ? (
      <video
        ref={video}
        src={enderecoDoVideo(relatorioId, b.arquivo, rota)}
        data-video-do-bloco={b.id}
        controls={!apresentacao}
        preload="metadata"
        playsInline
        loop={repetir}
        autoPlay={modo === "ampliado" && tocar}
        onLoadedMetadata={(e) => {
          if (inicio) e.currentTarget.currentTime = inicio;
        }}
        onPlay={() => setTocando(true)}
        onPause={() => setTocando(false)}
        onEnded={() => setTocando(false)}
        onVolumeChange={(e) => setMudo(e.currentTarget.muted)}
        className="h-full w-full rounded-sm bg-black object-contain"
      />
    ) : (
      <iframe
        ref={iframe}
        // Na apresentação, o YouTube sem os controles dele (os botões são os da página); os outros, com os deles.
        src={link!.embed({ controles: !(apresentacao && youtube), inicio: modo === "ampliado" ? inicio : undefined, tocar: (modo === "ampliado" && tocar) || automatico, repetir })}
        data-video-do-bloco={b.id}
        title={`Vídeo do ${NOME_DA_PLATAFORMA[link!.plataforma]}${b.legenda ? `: ${b.legenda}` : ""}`}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write"
        allowFullScreen
        loading="lazy"
        onLoad={() => (youtube ? ouvirYoutube(iframe.current) : undefined)}
        className="h-full w-full rounded-sm border-0 bg-black"
      />
    );

  const botao = "inline-flex size-9 items-center justify-center rounded-sm text-gray-100 hover:bg-gray-700 hover:text-white";
  return (
    // No ampliado, o clique nos controles não fecha o vídeo (só fora dele).
    <div className="relative h-full w-full" onClick={modo === "ampliado" ? (e) => e.stopPropagation() : undefined}>
      {player}
      {apresentacao ? (
        <>
          {/* Na apresentação, uma camada sobre o vídeo recebe o mouse e o clique (que amplia o bloco), também sobre o iframe. */}
          <div aria-hidden className="absolute inset-0" />
          {b.origem === "ARQUIVO" || youtube ? (
            <div
              className="pointer-events-none absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-sm bg-gray-800 p-1 opacity-0 shadow-lg transition-opacity group-hover:pointer-events-auto group-hover:opacity-100"
              onClick={(e) => e.stopPropagation()}
            >
              <button type="button" className={botao} onClick={reproduzir} title={tocando ? "Pausar" : "Reproduzir"} aria-label={tocando ? "Pausar" : "Reproduzir"}>
                {tocando ? <Pause className="size-5" /> : <Play className="size-5" />}
              </button>
              <button type="button" className={botao} onClick={parar} title="Parar" aria-label="Parar">
                <Square className="size-4" />
              </button>
              <button type="button" className={botao} onClick={silenciar} title={mudo ? "Ativar o som" : "Mudo"} aria-label={mudo ? "Ativar o som" : "Mudo"}>
                {mudo ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
              </button>
            </div>
          ) : (
            // Instagram, Facebook e LinkedIn não aceitam comandos da página: o vídeo toca ampliado, nos controles do player.
            <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-sm bg-gray-800 px-3 py-1.5 text-xs whitespace-nowrap text-gray-100 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
              Clique para ampliar e reproduzir
            </span>
          )}
        </>
      ) : null}
    </div>
  );
}
