"use client";

import { useState } from "react";
import { Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { botaoPrimario, Erro, OpcaoEmLinha } from "@/app/cenarios/components/CenarioDialog";

import { NOME_DA_PLATAFORMA, videoDoLink } from "./videoIncorporado";

/** O maior vídeo do computador (20/10/2026): 200 MB. */
export const MAXIMO_DO_VIDEO = 200 * 1024 * 1024;
export const TIPOS_DE_VIDEO = ["video/mp4", "video/webm", "video/quicktime", "video/x-m4v", "video/ogg"];

/** O vídeo escolhido: o arquivo (com a proporção dele) ou o link (com a proporção do player da plataforma). */
export type VideoEscolhido = { origem: "ARQUIVO"; arquivo: File; proporcao: number } | { origem: "LINK"; url: string; proporcao: number };

/** A proporção (largura ÷ altura) do vídeo, lida no navegador; sem ela (o formato que o navegador não abre), 16:9. */
export function proporcaoDoArquivo(arquivo: File): Promise<number> {
  return new Promise((ok) => {
    const v = document.createElement("video");
    const endereco = URL.createObjectURL(arquivo);
    const fim = (p: number) => {
      URL.revokeObjectURL(endereco);
      ok(p);
    };
    v.preload = "metadata";
    v.onloadedmetadata = () => fim(v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 16 / 9);
    v.onerror = () => fim(16 / 9);
    v.src = endereco;
  });
}

/**
 * O vídeo de um link (o endereço ou o código "incorporar" da plataforma), com a proporção do player; null quando não é de
 * uma das plataformas aceitas. Também o Ctrl+V de um link na página (24/10/2026), que vira o bloco sem o modal.
 */
export function videoDoTexto(texto: string): VideoEscolhido | null {
  const link = texto.trim() ? videoDoLink(texto) : null;
  if (!link) return null;
  const t = texto.trim();
  return { origem: "LINK", url: t.startsWith("<") ? (/src=["']([^"']+)/.exec(t)?.[1] ?? t).replace(/&amp;/g, "&") : t, proporcao: link.proporcao };
}

const tamanho = (bytes: number) => `${(bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;

/**
 * O modal Adicionar Vídeo (20/10/2026): um arquivo do computador (MP4, WebM, MOV, M4V ou OGG; até 200 MB) ou o link de um
 * vídeo do YouTube, do Instagram, do Facebook ou do LinkedIn (o endereço ou o código "incorporar" da plataforma).
 */
export function VideoDialog({ titulo = "Adicionar Vídeo", onEscolher, onFechar }: { titulo?: string; onEscolher: (v: VideoEscolhido) => void; onFechar: () => void }) {
  const [origem, setOrigem] = useState<"ARQUIVO" | "LINK">("ARQUIVO");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [lendo, setLendo] = useState(false);
  const link = url.trim() ? videoDoLink(url) : null;
  const erroDoArquivo = !arquivo
    ? null
    : !TIPOS_DE_VIDEO.includes(arquivo.type)
      ? "O vídeo precisa ser MP4, WebM, MOV, M4V ou OGG."
      : arquivo.size > MAXIMO_DO_VIDEO
        ? `O vídeo tem ${tamanho(arquivo.size)}: o máximo é 200 MB.`
        : null;
  const erroDoLink = url.trim() && !link ? "O link não é de um vídeo do YouTube, Instagram, Facebook ou LinkedIn." : null;
  const pronto = origem === "ARQUIVO" ? !!arquivo && !erroDoArquivo : !!link;
  const escolher = async () => {
    const doLink = origem === "LINK" ? videoDoTexto(url) : null;
    if (doLink) return onEscolher(doLink);
    if (!arquivo) return;
    setLendo(true);
    const proporcao = await proporcaoDoArquivo(arquivo);
    setLendo(false);
    onEscolher({ origem: "ARQUIVO", arquivo, proporcao });
  };
  return (
    <Dialog open onOpenChange={(a) => (!a ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="rounded-sm sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>Um vídeo do computador ou o link de um vídeo do YouTube, do Instagram, do Facebook ou do LinkedIn.</DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-sm leading-none font-medium">Origem</legend>
          <OpcaoEmLinha nome="origem-do-video" marcada={origem === "ARQUIVO"} onMarcar={() => setOrigem("ARQUIVO")} rotulo="Arquivo do Computador" detalhe="MP4, WebM, MOV, M4V ou OGG, até 200 MB." />
          <OpcaoEmLinha nome="origem-do-video" marcada={origem === "LINK"} onMarcar={() => setOrigem("LINK")} rotulo="Link" detalhe="YouTube, Instagram, Facebook ou LinkedIn (o vídeo precisa ser público)." />
        </fieldset>
        {origem === "ARQUIVO" ? (
          <div className="space-y-1.5">
            <Label htmlFor="video-arquivo">Arquivo</Label>
            <label htmlFor="video-arquivo" className="flex cursor-pointer items-center gap-3 rounded-sm border border-dashed border-gray-300 bg-white px-3 py-3 text-sm text-gray-700 hover:bg-gray-50">
              <Video className="size-5 shrink-0 text-gray-500" />
              <span className="min-w-0 truncate">{arquivo ? `${arquivo.name} (${tamanho(arquivo.size)})` : "Escolher o vídeo…"}</span>
            </label>
            <input id="video-arquivo" type="file" accept={TIPOS_DE_VIDEO.join(",")} className="hidden" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
            <Erro erro={erroDoArquivo} />
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="video-link">Link do Vídeo</Label>
            <Input id="video-link" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" className="rounded-sm" />
            {link ? <p className="text-xs text-gray-600">Vídeo do {NOME_DA_PLATAFORMA[link.plataforma]}.</p> : null}
            <Erro erro={erroDoLink} />
            <p className="text-xs text-gray-500">
              No LinkedIn, se o vídeo não aparecer, use “Incorporar esta publicação” (nos três pontos da publicação) e cole aqui o código. Só o YouTube
              aceita os botões Reproduzir, Parar e Mudo da apresentação; nos outros, o vídeo toca ampliado, nos controles da plataforma.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={!pronto || lendo} onClick={() => void escolher()}>
            {lendo ? "Lendo…" : origem === "ARQUIVO" ? "Enviar" : "Adicionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * O modal Configurações do Vídeo (13/11/2026, pedido do Adão; o Configurar da barra da edição, com o vídeo escolhido): a
 * Reprodução Automática (o vídeo começa a tocar sozinho na leitura e na apresentação, quando o slide aparece; sem o clique
 * na página, o navegador pode exigir que comece sem som) e o Recomeçar ao Terminar. Valem no vídeo do computador e no do
 * YouTube; no Facebook, só a Reprodução Automática; no Instagram e no LinkedIn, o player da plataforma não aceita.
 */
export function ConfiguracoesDoVideoDialog({
  inicial,
  origem,
  url,
  onAplicar,
  onFechar,
}: {
  inicial: { reproducaoAutomatica: boolean; recomecarAoTerminar: boolean };
  origem: "ARQUIVO" | "LINK";
  url: string;
  onAplicar: (o: { reproducaoAutomatica: boolean; recomecarAoTerminar: boolean }) => void;
  onFechar: () => void;
}) {
  const [o, setO] = useState(inicial);
  const plataforma = origem === "LINK" ? videoDoLink(url)?.plataforma : null;
  const aviso =
    plataforma === "facebook"
      ? "No Facebook, só a Reprodução Automática vale: o player dele não recomeça sozinho."
      : plataforma === "instagram" || plataforma === "linkedin"
        ? `No ${NOME_DA_PLATAFORMA[plataforma]}, o player da plataforma não aceita estas opções.`
        : null;
  const caixa = (chave: keyof typeof o, rotulo: string, detalhe: string) => (
    <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-900">
      <input type="checkbox" checked={o[chave]} onChange={(e) => setO((x) => ({ ...x, [chave]: e.target.checked }))} className="mt-0.5 size-4 shrink-0 accent-black" />
      <span>
        {rotulo}
        <span className="block text-xs text-gray-500">{detalhe}</span>
      </span>
    </label>
  );
  return (
    <Dialog open onOpenChange={(a) => (!a ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="rounded-sm sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Configurações do Vídeo</DialogTitle>
          <DialogDescription>Como o vídeo toca na leitura e na apresentação.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {caixa(
            "reproducaoAutomatica",
            "Reprodução Automática",
            "Começa a tocar sozinho quando o slide aparece (na edição, não). Sem um clique na página antes, o navegador pode exigir que comece sem som.",
          )}
          {caixa("recomecarAoTerminar", "Recomeçar ao Terminar", "Ao chegar ao fim, o vídeo volta ao início e toca de novo.")}
          {aviso ? <p className="text-xs text-gray-500">{aviso}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} onClick={() => onAplicar(o)}>
            Aplicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
