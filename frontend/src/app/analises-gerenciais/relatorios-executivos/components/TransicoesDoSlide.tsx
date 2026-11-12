"use client";

import { useState } from "react";
import { Clapperboard } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import type { Transicao } from "../services/relatoriosExecutivosService";
import { useProcesso } from "./processo";

/** As transições (27/10/2026; a lista Tipo da Animação): Nenhuma tira a do slide. */
export const TRANSICOES: Array<{ valor: Transicao | undefined; rotulo: string }> = [
  { valor: undefined, rotulo: "Nenhuma" },
  { valor: "ESMAECER", rotulo: "Esmaecer" },
  { valor: "ROLAR_VERTICAL", rotulo: "Rolar Vertical" },
  { valor: "ROLAR_HORIZONTAL", rotulo: "Rolar Horizontal" },
];

/** O que as Transições mudam num slide: a transição e o avanço automático, em segundos. */
export type AjusteDoSlide = { transicao?: Transicao; avancarApos?: number };
/** Uma mudança das Transições: a transição ou o Avançar Após, no slide aberto ou em todos os do grupo. */
export type MudancaDoSlide = { campo: "transicao"; valor: Transicao | undefined } | { campo: "avancarApos"; valor: number | undefined };

/** O valor de Nenhuma na lista Tipo (a lista não aceita um valor vazio). */
const NENHUMA = "NENHUMA";

/** O maior Avançar Após, em segundos (uma hora). */
const MAXIMO_DO_AVANCO = 3600;

/**
 * As Transições do slide aberto no Relatório Executivo (27/10/2026; 30/10/2026, pedido do Adão: o ícone ao lado dos da
 * Imagem de Fundo, no lugar do botão do topo, e o modal com a Animação e o Cronômetro). Na Animação, a lista Tipo escolhe
 * a transição do slide aberto; no Cronômetro, "Avançar Após" (em segundos; em branco ou zero, sem avanço) faz a apresentação
 * passar sozinha ao próximo slide. Cada um tem a sua caixa "Aplicar ao Grupo": marcada, a mudança vale para todos os slides
 * do grupo (marcá-la já leva a transição, ou o avanço, do slide aberto a todos); ela abre marcada quando todos os slides do
 * grupo já têm o mesmo. As mudanças valem na hora (os segundos, ao sair do campo, com Enter ou ao fechar o modal).
 */
export function TransicoesDoSlide({
  ajuste,
  nomeDoSlide,
  uniformes,
  onMudar,
  className,
  disabled,
  recomecar,
}: {
  ajuste: AjusteDoSlide;
  nomeDoSlide: string;
  /** Todos os slides do grupo têm a transição e o avanço do aberto. */
  uniformes: { transicao: boolean; avancarApos: boolean };
  onMudar: (mudanca: MudancaDoSlide, aoGrupo: boolean) => void;
  /** A classe do ícone (a dos botões ao lado das páginas). */
  className: string;
  disabled?: boolean;
  /**
   * "Recomeçar ao Terminar" (11/11/2026, pedido do Adão; só nos painéis): a apresentação volta ao primeiro slide depois do
   * Avançar Após do último. Vale para o painel inteiro.
   */
  recomecar?: { marcado: boolean; onMudar: (marcado: boolean) => void };
}) {
  const { grupo } = useProcesso();
  const [aberto, setAberto] = useState(false);
  const [transicaoAoGrupo, setTransicaoAoGrupo] = useState(uniformes.transicao);
  const [avancoAoGrupo, setAvancoAoGrupo] = useState(uniformes.avancarApos);
  const [segundos, setSegundos] = useState(ajuste.avancarApos ? String(ajuste.avancarApos) : "");
  const abrir = () => {
    setTransicaoAoGrupo(uniformes.transicao);
    setAvancoAoGrupo(uniformes.avancarApos);
    setSegundos(ajuste.avancarApos ? String(ajuste.avancarApos) : "");
    setAberto(true);
  };
  const fechar = () => {
    gravarSegundos();
    setAberto(false);
  };
  // Os segundos valem ao sair do campo, com Enter e ao fechar (não a cada tecla: cada mudança grava o grupo).
  const gravarSegundos = () => {
    const n = Math.min(MAXIMO_DO_AVANCO, Math.max(0, Math.round(Number(segundos.replace(",", ".")) || 0)));
    setSegundos(n ? String(n) : "");
    if (n !== (ajuste.avancarApos ?? 0)) onMudar({ campo: "avancarApos", valor: n || undefined }, avancoAoGrupo);
  };
  const rotulo = TRANSICOES.find((t) => t.valor === ajuste.transicao)?.rotulo ?? "Nenhuma";
  const grupoDe = (marcada: boolean, aoMarcar: () => void, setMarcada: (m: boolean) => void) => (
    <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-gray-800">
      <input
        type="checkbox"
        checked={marcada}
        onChange={(e) => {
          setMarcada(e.target.checked);
          if (e.target.checked) aoMarcar();
        }}
        className="size-4 accent-black"
      />
      {/* Num painel (31/10/2026), “Aplicar ao Painel”: todas as páginas dele. */}
      Aplicar ao {grupo}
    </label>
  );
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={disabled}
        onClick={abrir}
        title={`Transições de ${nomeDoSlide}: ${rotulo}${ajuste.avancarApos ? `; avança após ${ajuste.avancarApos} s` : ""}`}
        aria-label="Transições do slide"
      >
        <Clapperboard className="size-4" />
      </button>
      <Dialog open={aberto} onOpenChange={(o) => (o ? abrir() : fechar())}>
        <DialogContent className="rounded-sm sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Transições</DialogTitle>
            <DialogDescription>{nomeDoSlide}: as mudanças valem na hora.</DialogDescription>
          </DialogHeader>
          {/* A Animação: a lista Tipo e a caixa dela. */}
          <section className="space-y-2">
            <p className="text-xs text-gray-500">Animação</p>
            <label className="flex items-center gap-2 text-sm text-gray-800">
              <span className="w-24 shrink-0">Tipo</span>
              <Select
                value={ajuste.transicao ?? NENHUMA}
                onValueChange={(v) => v !== null && onMudar({ campo: "transicao", valor: v === NENHUMA ? undefined : (v as Transicao) }, transicaoAoGrupo)}
              >
                <SelectTrigger className="h-8 w-44 rounded-sm bg-white" aria-label="Tipo da animação">
                  <SelectValue>{(v: string | null) => TRANSICOES.find((t) => (t.valor ?? NENHUMA) === v)?.rotulo ?? "Nenhuma"}</SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {TRANSICOES.map((t) => (
                    <SelectItem key={t.rotulo} value={t.valor ?? NENHUMA}>
                      {t.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {grupoDe(transicaoAoGrupo, () => onMudar({ campo: "transicao", valor: ajuste.transicao }, true), setTransicaoAoGrupo)}
          </section>
          {/* O Cronômetro: o Avançar Após e a caixa dele. */}
          <section className="space-y-2 border-t border-gray-200 pt-3">
            <p className="text-xs text-gray-500">Cronômetro</p>
            <label className="flex items-center gap-2 text-sm text-gray-800">
              <span className="w-24 shrink-0">Avançar Após</span>
              <input
                type="number"
                min={0}
                max={MAXIMO_DO_AVANCO}
                step={1}
                inputMode="numeric"
                value={segundos}
                onChange={(e) => setSegundos(e.target.value)}
                onBlur={gravarSegundos}
                onKeyDown={(e) => {
                  if (e.key === "Enter") gravarSegundos();
                }}
                aria-label="Avançar após (segundos)"
                className="h-8 w-20 rounded-sm border border-gray-300 px-2 text-right text-sm outline-none focus:border-gray-500"
              />
              <span className="text-gray-500">segundos</span>
            </label>
            {grupoDe(avancoAoGrupo, () => onMudar({ campo: "avancarApos", valor: ajuste.avancarApos }, true), setAvancoAoGrupo)}
            {recomecar ? (
              <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-gray-800" title="Depois do Avançar Após da última página, a apresentação volta à primeira">
                <input type="checkbox" checked={recomecar.marcado} onChange={(e) => recomecar.onMudar(e.target.checked)} className="size-4 accent-black" />
                Recomeçar ao Terminar
              </label>
            ) : null}
          </section>
        </DialogContent>
      </Dialog>
    </>
  );
}
