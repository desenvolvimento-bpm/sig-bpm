"use client";

import { useEffect } from "react";

/**
 * A marca do ambiente de desenvolvimento (15/10/2026): a porta 3100 (`next dev`) tem a borda vermelha em volta da tela,
 * a etiqueta "Desenvolvimento" antes do caminho e, desde 17/10/2026, o ícone da aba do navegador em vermelho, para não
 * se confundir com a produção (porta 3000, `next start`, sem a marca). O NODE_ENV entra no código na compilação:
 * "development" no next dev, "production" no build.
 *
 * O teste (21/10/2026): a versão compilada na porta 3200 (`npm run teste`), com o banco do desenvolvimento, tem a mesma
 * marca em laranja e a etiqueta "Teste" (NEXT_PUBLIC_AMBIENTE=teste, que o `npm run teste:construir` põe na compilação).
 * A base teste Pré-Contestações (16/11/2026, porta 3300, `npm run pre-contestacoes`), com a cópia da produção de antes de
 * processar as contestações, tem a marca em violeta e a etiqueta "Pré-Contestações" (NEXT_PUBLIC_AMBIENTE=pre-contestacoes).
 * A produção (o servidor da empresa) não tem marca.
 */
export const EH_DESENVOLVIMENTO = process.env.NODE_ENV === "development";
export const EH_PRE_CONTESTACOES = process.env.NEXT_PUBLIC_AMBIENTE === "pre-contestacoes";
export const EH_TESTE = process.env.NEXT_PUBLIC_AMBIENTE === "teste" || EH_PRE_CONTESTACOES;

/**
 * A cor da marca, em RGB, para o ícone: o vermelho do desenvolvimento (red-600), o laranja do teste (orange-500) ou o
 * violeta da Pré-Contestações (violet-600).
 */
const COR_DO_ICONE: [number, number, number] = EH_PRE_CONTESTACOES ? [124, 58, 237] : EH_TESTE ? [249, 115, 22] : [220, 38, 38];
const COR_DA_BORDA = EH_PRE_CONTESTACOES ? "border-violet-600" : EH_TESTE ? "border-orange-500" : "border-red-600";

/** A borda em volta da tela, por cima de tudo e sem pegar os cliques, e o ícone da aba na cor do ambiente. */
export function BordaDoDesenvolvimento() {
  if (!EH_DESENVOLVIMENTO && !EH_TESTE) return null;
  return (
    <>
      <IconeDoDesenvolvimento />
      <div aria-hidden className={`pointer-events-none fixed inset-0 z-[200] border-4 ${COR_DA_BORDA}`} />
    </>
  );
}

/**
 * O ícone da aba em vermelho (17/10/2026): o favicon de sempre, redesenhado com as partes escuras em vermelho. O endereço
 * vermelho vai em todos os `<link rel="icon">` do head — também no do Next, que, ao navegar entre as telas, voltava a ficar
 * depois do vermelho (e o navegador usa o último) — e se reaplica sempre que o head muda.
 */
function IconeDoDesenvolvimento() {
  useEffect(() => {
    let cancelado = false;
    let observador: MutationObserver | null = null;
    const imagem = new Image();
    imagem.onload = () => {
      if (cancelado) return;
      const tamanho = 64;
      const tela = document.createElement("canvas");
      tela.width = tela.height = tamanho;
      const ctx = tela.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(imagem, 0, 0, tamanho, tamanho);
      const px = ctx.getImageData(0, 0, tamanho, tamanho);
      for (let k = 0; k < px.data.length; k += 4) {
        // As partes escuras (o círculo preto) viram a cor da borda; as claras ficam.
        if (px.data[k + 3] > 0 && px.data[k] + px.data[k + 1] + px.data[k + 2] < 384) {
          [px.data[k], px.data[k + 1], px.data[k + 2]] = COR_DO_ICONE;
        }
      }
      ctx.putImageData(px, 0, 0);
      const vermelho = tela.toDataURL("image/png");
      const aplicar = () => {
        document.head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]').forEach((l) => {
          if (l.getAttribute("href") === vermelho) return;
          // Guarda o endereço original, para voltar ao desmontar.
          if (l.dataset.original === undefined) l.dataset.original = l.getAttribute("href") ?? "";
          l.type = "image/png";
          l.setAttribute("href", vermelho);
        });
      };
      aplicar();
      observador = new MutationObserver(aplicar);
      observador.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ["href", "rel"] });
    };
    imagem.src = "/favicon.ico";
    return () => {
      cancelado = true;
      observador?.disconnect();
      document.head.querySelectorAll<HTMLLinkElement>("link[data-original]").forEach((l) => {
        l.setAttribute("href", l.dataset.original ?? "");
        delete l.dataset.original;
      });
    };
  }, []);
  return null;
}

/** A etiqueta antes do caminho das telas. */
export function EtiquetaDoDesenvolvimento() {
  if (EH_PRE_CONTESTACOES) {
    return (
      <span
        title="Base teste Pré-Contestações (porta 3300): a versão compilada, com a cópia da produção de 10/11/2026, antes de processar as contestações"
        className="shrink-0 rounded-sm bg-violet-800 px-2 py-0.5 text-xs font-bold text-white"
      >
        Pré-Contestações
      </span>
    );
  }
  if (EH_TESTE) {
    return (
      <span title="Ambiente de teste (porta 3200): a versão compilada, com o banco do desenvolvimento" className="shrink-0 rounded-sm bg-orange-700 px-2 py-0.5 text-xs font-bold text-white">
        Teste
      </span>
    );
  }
  if (!EH_DESENVOLVIMENTO) return null;
  return (
    <span title="Ambiente de desenvolvimento (porta 3100), com a cópia do banco" className="shrink-0 rounded-sm bg-red-800 px-2 py-0.5 text-xs font-bold text-white">
      Desenvolvimento
    </span>
  );
}
