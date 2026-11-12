"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { botaoPrimario } from "@/app/cenarios/components/CenarioDialog";

import type { BordaDoTexto, LadoDaBorda, TipoDaBorda } from "../services/relatoriosExecutivosService";
import { COR_PADRAO, CORES_DA_FONTE, TAMANHOS } from "./TextoRico";

/**
 * As Bordas do Texto Livre (12/11/2026, pedido do Adão): as posições (em cima, embaixo, à esquerda e à direita, ou todas), o
 * tipo, a espessura e a cor, no bloco inteiro, na edição, na apresentação e no PDF.
 */
export const LADOS_DA_BORDA: Array<{ lado: LadoDaBorda; nome: string; css: "Top" | "Bottom" | "Left" | "Right" }> = [
  { lado: "CIMA", nome: "Em Cima", css: "Top" },
  { lado: "BAIXO", nome: "Embaixo", css: "Bottom" },
  { lado: "ESQUERDA", nome: "Esquerda", css: "Left" },
  { lado: "DIREITA", nome: "Direita", css: "Right" },
];
/** Os cinco tipos mais comuns (os do Office que o navegador desenha): contínua, tracejada, pontilhada, dupla e sulcada. */
export const TIPOS_DA_BORDA: Array<{ tipo: TipoDaBorda; nome: string; css: string }> = [
  { tipo: "CONTINUA", nome: "Contínua", css: "solid" },
  { tipo: "TRACEJADA", nome: "Tracejada", css: "dashed" },
  { tipo: "PONTILHADA", nome: "Pontilhada", css: "dotted" },
  { tipo: "DUPLA", nome: "Dupla", css: "double" },
  { tipo: "SULCADA", nome: "Sulcada", css: "groove" },
];
/** As espessuras, em px: de 1/4 a 8 e os mesmos tamanhos dos textos, de 10 a 60. */
export const ESPESSURAS_DA_BORDA = [0.25, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, ...TAMANHOS.filter((t) => t >= 10 && t <= 60)];
export const rotuloDaEspessura = (e: number) => (e === 0.25 ? "1/4" : e === 0.5 ? "1/2" : e.toLocaleString("pt-BR"));
/** O espaço entre a borda e o texto, em px, nos lados com borda. */
const RECUO = 6;

/** O estilo do bloco com as bordas (sem elas, nenhum). A cor Padrão é a do texto do tema (preto; branco no Escuro). */
export function estiloDaBorda(borda: BordaDoTexto | undefined): React.CSSProperties | undefined {
  if (!borda?.lados.length) return undefined;
  const css = TIPOS_DA_BORDA.find((t) => t.tipo === borda.tipo)?.css ?? "solid";
  const cor = borda.cor === COR_PADRAO ? "currentColor" : borda.cor;
  const s: Record<string, string> = {};
  for (const l of LADOS_DA_BORDA)
    if (borda.lados.includes(l.lado)) {
      s[`border${l.css}Style`] = css;
      s[`border${l.css}Width`] = `${borda.espessura}px`;
      s[`border${l.css}Color`] = cor;
      s[`padding${l.css}`] = `${RECUO}px`;
    }
  return s as React.CSSProperties;
}

const TODOS: LadoDaBorda[] = ["CIMA", "BAIXO", "ESQUERDA", "DIREITA"];
const NOVA: BordaDoTexto = { lados: TODOS, tipo: "CONTINUA", espessura: 1, cor: COR_PADRAO };

/** O modal Bordas: as posições, o tipo, a espessura e a cor, com a prévia; Aplicar sem posição nenhuma tira as bordas. */
export function BordasDialog({ inicial, onAplicar, onFechar }: { inicial: BordaDoTexto | undefined; onAplicar: (b: BordaDoTexto | undefined) => void; onFechar: () => void }) {
  const [b, setB] = useState<BordaDoTexto>(inicial ?? NOVA);
  const titulo = "text-xs font-bold tracking-wide text-gray-500 uppercase";
  const marcado = "border-bpm-primary bg-bpm-primary/15 font-semibold text-gray-900";
  const opcao = "rounded-sm border px-2.5 py-1.5 text-sm transition-colors";
  const desmarcado = "border-gray-300 bg-white text-gray-700 hover:bg-gray-50";
  const todas = TODOS.every((l) => b.lados.includes(l));
  const alternar = (lado: LadoDaBorda) => setB((y) => ({ ...y, lados: y.lados.includes(lado) ? y.lados.filter((x) => x !== lado) : TODOS.filter((x) => x === lado || y.lados.includes(x)) }));
  return (
    <Dialog open onOpenChange={(aberto) => (!aberto ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="rounded-sm sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Bordas</DialogTitle>
          <DialogDescription>
            As bordas do Texto Livre: as posições, o tipo, a espessura (em px, no tamanho do slide) e a cor. Sem nenhuma posição marcada, o Aplicar tira as bordas.
          </DialogDescription>
        </DialogHeader>
        {/* A prévia: um texto de exemplo com as bordas escolhidas. */}
        <div className="flex h-28 items-center justify-center rounded-sm border border-gray-200 bg-gray-50 p-4">
          <div className="text-sm text-gray-900" style={{ ...estiloDaBorda(b), padding: b.lados.length ? undefined : RECUO }}>
            Texto Livre
          </div>
        </div>
        <div className="space-y-4">
          <fieldset className="space-y-1.5">
            <legend className={titulo}>Posições</legend>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Posições das bordas">
              {LADOS_DA_BORDA.map((l) => (
                <button key={l.lado} type="button" aria-pressed={b.lados.includes(l.lado)} onClick={() => alternar(l.lado)} className={`${opcao} ${b.lados.includes(l.lado) ? marcado : desmarcado}`}>
                  {l.nome}
                </button>
              ))}
              <button type="button" aria-pressed={todas} onClick={() => setB((y) => ({ ...y, lados: TODOS.every((l) => y.lados.includes(l)) ? [] : TODOS }))} className={`${opcao} ${todas ? marcado : desmarcado}`}>
                Todas
              </button>
            </div>
          </fieldset>
          <fieldset className="space-y-1.5">
            <legend className={titulo}>Tipo</legend>
            <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Tipo da borda">
              {TIPOS_DA_BORDA.map((t) => (
                <button
                  key={t.tipo}
                  type="button"
                  role="radio"
                  aria-checked={b.tipo === t.tipo}
                  onClick={() => setB((y) => ({ ...y, tipo: t.tipo }))}
                  className={`${opcao} flex flex-col items-center gap-1.5 ${b.tipo === t.tipo ? marcado : desmarcado}`}
                >
                  <span className="block h-0 w-full" style={{ borderTop: `4px ${t.css} currentColor` }} />
                  {t.nome}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-1.5">
            <legend className={titulo}>Espessura (px)</legend>
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Espessura da borda">
              {ESPESSURAS_DA_BORDA.map((e) => (
                <button
                  key={e}
                  type="button"
                  role="radio"
                  aria-checked={b.espessura === e}
                  onClick={() => setB((y) => ({ ...y, espessura: e }))}
                  className={`min-w-10 ${opcao} px-1.5 py-1 text-center ${b.espessura === e ? marcado : desmarcado}`}
                >
                  {rotuloDaEspessura(e)}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-1.5">
            <legend className={titulo}>Cor</legend>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Cor da borda">
              {CORES_DA_FONTE.map((c) => (
                <button
                  key={c.cor}
                  type="button"
                  role="radio"
                  aria-checked={b.cor === c.cor}
                  title={c.nome === "Padrão" ? "Padrão (a cor do texto: preto; branco no Escuro)" : c.nome}
                  onClick={() => setB((y) => ({ ...y, cor: c.cor }))}
                  className={`flex items-center gap-1.5 ${opcao} py-1 ${b.cor === c.cor ? marcado : desmarcado}`}
                >
                  <span
                    className="size-3.5 shrink-0 rounded-[2px] border border-gray-300"
                    style={{ background: c.cor === COR_PADRAO ? "linear-gradient(135deg, #111827 50%, #ffffff 50%)" : c.cor }}
                  />
                  {c.nome}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        <DialogFooter className="sm:justify-between">
          <div>
            {inicial ? (
              <Button type="button" variant="outline" className="rounded-sm" onClick={() => onAplicar(undefined)} title="O Texto Livre sem bordas">
                Remover Bordas
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
              Cancelar
            </Button>
            <Button type="button" className={botaoPrimario} onClick={() => onAplicar(b.lados.length ? b : undefined)}>
              Aplicar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
