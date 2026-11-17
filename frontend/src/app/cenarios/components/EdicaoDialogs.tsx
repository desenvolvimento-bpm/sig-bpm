"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { botaoPrimario, Erro } from "./CenarioDialog";
import { plural } from "@/lib/texto";

/** Lê um número digitado em pt-BR: "1.234,56", "-5,5", "10" (vazio: null; inválido: undefined). */
export function lerNumero(texto: string): number | null | undefined {
  const t = texto.trim().replace(/\s/g, "");
  if (!t) return null;
  // Com vírgula, os pontos são de milhar; sem ela, um ponto seguido de três dígitos também.
  const normal = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : /^-?\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : t;
  const n = Number(normal);
  return Number.isFinite(n) ? n : undefined;
}

/** O valor para um campo: até duas casas, sem separador de milhar (fácil de editar). */
export const paraCampo = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2, useGrouping: false });
/** O valor com separador de milhar e sempre duas casas (o valor atual e o recalculado da edição de um valor). */
export const comDuasCasas = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** O valor para ler: com separador de milhar e até duas casas. */
export const paraTexto = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

export type Reajuste = "PERCENTUAL" | "ABSOLUTO";
/** O valor reajustado: percentual (+5 = 5% a mais) ou absoluto (somado), em duas casas. */
export const reajustar = (atual: number, tipo: Reajuste, x: number) => Math.round((tipo === "PERCENTUAL" ? atual * (1 + x / 100) : atual + x) * 100) / 100;

/** A escolha do tipo do reajuste: Percentual (%) ou Absoluto (R$, ou a unidade da conta). */
function TipoReajuste({ tipo, onMudar }: { tipo: Reajuste; onMudar: (t: Reajuste) => void }) {
  return (
    <div className="flex gap-2" role="radiogroup" aria-label="Tipo do reajuste">
      {(
        [
          ["PERCENTUAL", "Percentual (%)"],
          ["ABSOLUTO", "Absoluto (valor)"],
        ] as const
      ).map(([v, rotulo]) => (
        <label key={v} className={`flex flex-1 cursor-pointer items-center gap-2 rounded-sm border px-3 py-1.5 text-sm ${tipo === v ? "border-gray-900 bg-gray-50 font-medium" : "border-gray-200 hover:bg-gray-50"}`}>
          <input type="radio" name="tipo-reajuste" className="accent-black" checked={tipo === v} onChange={() => onMudar(v)} />
          {rotulo}
        </label>
      ))}
    </div>
  );
}

/**
 * O reajuste dos valores marcados (as contas e os meses com a caixa marcada): percentual ou absoluto, aplicado a
 * cada valor. Mostra quantos valores mudam e a soma antes e depois.
 */
export function ReajusteDialog({
  valores,
  rotulo,
  gravando,
  erro,
  onAplicar,
  onFechar,
}: {
  /** Os valores marcados: a conta, o mês e o valor atual. */
  valores: Array<{ linha: string; mes: number; atual: number }>;
  rotulo: string;
  gravando: boolean;
  erro: string | null;
  onAplicar: (novos: Array<{ linha: string; mes: number; valor: number }>, reajuste: { modo: Reajuste; valor: number }) => void;
  onFechar: () => void;
}) {
  const [tipo, setTipo] = useState<Reajuste>("PERCENTUAL");
  const [texto, setTexto] = useState("");
  const x = lerNumero(texto);
  const ok = typeof x === "number" && valores.length > 0;
  const novos = ok ? valores.map((v) => ({ linha: v.linha, mes: v.mes, valor: reajustar(v.atual, tipo, x) })) : [];
  const somaAtual = valores.reduce((s, v) => s + v.atual, 0);
  const somaNova = novos.reduce((s, v) => s + v.valor, 0);
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="rounded-sm sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reajustar Valores Marcados</DialogTitle>
          <DialogDescription>{rotulo}</DialogDescription>
        </DialogHeader>
        {valores.length === 0 ? (
          <p className="rounded-sm border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-900">
            Nenhum valor marcado: marque as contas (a caixa de um total marca as contas dele) e os meses (a caixa no rótulo do mês).
          </p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              <span className="font-bold text-gray-900">{valores.length}</span> {plural(valores.length, "valor marcado", "valores marcados")}, somando <span className="font-bold text-gray-900">{paraTexto(somaAtual)}</span>.
            </p>
            <TipoReajuste tipo={tipo} onMudar={setTipo} />
            <div className="space-y-1.5">
              <Label htmlFor="reajuste-valor">{tipo === "PERCENTUAL" ? "Reajuste (%)" : "Reajuste (valor somado a cada um)"}</Label>
              <Input id="reajuste-valor" autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={tipo === "PERCENTUAL" ? "Ex.: 5 ou -2,5" : "Ex.: 1.000 ou -500"} className="rounded-sm" />
              {x === undefined ? <p className="text-xs text-red-700">Número inválido.</p> : null}
            </div>
            {ok ? (
              <p className="text-sm text-gray-700">
                Soma depois do reajuste: <span className="font-bold text-gray-900">{paraTexto(somaNova)}</span> ({somaNova - somaAtual >= 0 ? "+" : ""}
                {paraTexto(somaNova - somaAtual)}).
              </p>
            ) : null}
          </div>
        )}
        <Erro erro={erro} />
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={!ok || gravando} onClick={() => onAplicar(novos, { modo: tipo, valor: x as number })}>
            {gravando ? "Aplicando…" : "Aplicar Reajuste"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type GravarValor<V> = (valor: V, replicar: boolean, reajuste: { modo: Reajuste; valor: number } | null) => void;

/**
 * A edição de um valor (uma conta num mês): o valor atual, o reajuste (percentual ou absoluto) e o valor recalculado,
 * que também se digita direto (o reajuste acompanha). A chave replica o valor recalculado aos meses seguintes. Não
 * olha as caixas marcadas. Com `permiteVazio` (16/11/2026: os Indicadores Manuais dos cenários, em que o mês em branco é
 * sem valor, e não zero), o Valor Recalculado em branco grava o mês em branco, e o `atual` nulo é o mês em branco.
 */
export function ValorDialog({
  conta,
  rotuloMes,
  mesesSeguintes,
  atual,
  gravando,
  erro,
  onGravar,
  onFechar,
  permiteVazio = false,
}: {
  conta: string;
  rotuloMes: string;
  /** Os rótulos dos meses depois deste (para a chave de replicar). */
  mesesSeguintes: string[];
  gravando: boolean;
  erro: string | null;
  onFechar: () => void;
} & (
  | {
      atual: number;
      permiteVazio?: false;
      /** O valor e, para o histórico, o reajuste informado (sem ele, o valor foi digitado direto). */
      onGravar: GravarValor<number>;
    }
  | { atual: number | null; permiteVazio: true; onGravar: GravarValor<number | null> }
)) {
  // O mês em branco reajusta a partir de zero.
  const base = atual ?? 0;
  const [tipo, setTipo] = useState<Reajuste>("PERCENTUAL");
  const [reajuste, setReajuste] = useState("");
  // O recalculado sempre com separador de milhar e duas casas (12/10/2026); ao digitar, fica como se digita e se
  // formata ao sair do campo.
  const [novo, setNovo] = useState(atual === null ? "" : comDuasCasas(atual));
  const [replicar, setReplicar] = useState(false);
  const valorNovo = lerNumero(novo);
  // O reajuste muda o valor recalculado; digitar o recalculado muda o reajuste (o percentual, só com valor atual).
  const mudarReajuste = (t: string, tp = tipo) => {
    setReajuste(t);
    const x = lerNumero(t);
    if (typeof x === "number") setNovo(comDuasCasas(reajustar(base, tp, x)));
    else if (x === null) setNovo(atual === null ? "" : comDuasCasas(atual));
  };
  const mudarNovo = (t: string) => {
    setNovo(t);
    const v = lerNumero(t);
    if (typeof v !== "number") return;
    if (tipo === "PERCENTUAL" && base !== 0) setReajuste(paraCampo(Math.round((v / base - 1) * 10000) / 100));
    else if (tipo === "ABSOLUTO") setReajuste(paraCampo(Math.round((v - base) * 100) / 100));
    else setReajuste("");
  };
  const ok = typeof valorNovo === "number" || (permiteVazio && valorNovo === null);
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="rounded-sm sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar Valor</DialogTitle>
          <DialogDescription>
            <span>{conta}</span> · {rotuloMes}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="valor-atual">Valor Atual</Label>
            <Input id="valor-atual" value={atual === null ? "" : comDuasCasas(atual)} placeholder="Em branco" readOnly className="rounded-sm bg-gray-50 text-right text-gray-700" />
          </div>
          <TipoReajuste
            tipo={tipo}
            onMudar={(t) => {
              setTipo(t);
              mudarReajuste(reajuste, t);
            }}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="valor-reajuste">{tipo === "PERCENTUAL" ? "Reajuste (%)" : "Reajuste (valor)"}</Label>
              <Input id="valor-reajuste" value={reajuste} onChange={(e) => mudarReajuste(e.target.value)} placeholder="Ex.: 5 ou -2,5" className="rounded-sm" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="valor-novo">Valor Recalculado</Label>
              <Input
                id="valor-novo"
                autoFocus
                value={novo}
                onChange={(e) => mudarNovo(e.target.value)}
                onBlur={() => typeof valorNovo === "number" && setNovo(comDuasCasas(valorNovo))}
                className="rounded-sm text-right font-bold"
              />
              {valorNovo === undefined ? <p className="text-xs text-red-700">Número inválido.</p> : permiteVazio ? <p className="text-xs text-gray-500">Em branco, o mês fica sem valor.</p> : null}
            </div>
          </div>
          {mesesSeguintes.length ? (
            <label className="flex cursor-pointer items-center gap-3 text-sm text-gray-900">
              {/* A chave: replica o valor recalculado aos meses seguintes. */}
              <button
                type="button"
                role="switch"
                aria-checked={replicar}
                onClick={() => setReplicar((r) => !r)}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${replicar ? "bg-black" : "bg-gray-300"}`}
              >
                <span className={`inline-block size-4 rounded-full bg-white shadow transition-transform ${replicar ? "translate-x-4" : "translate-x-0.5"}`} />
              </button>
              <span>
                Replicar aos meses posteriores
                <span className="block text-xs text-gray-500">
                  {mesesSeguintes.length === 1 ? mesesSeguintes[0] : `${mesesSeguintes[0]} a ${mesesSeguintes[mesesSeguintes.length - 1]}`} ficam com o valor recalculado.
                </span>
              </span>
            </label>
          ) : null}
        </div>
        <Erro erro={erro} />
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={!ok || gravando} onClick={() => {
              const r = lerNumero(reajuste);
              (onGravar as GravarValor<number | null>)(valorNovo ?? null, replicar, typeof r === "number" ? { modo: tipo, valor: r } : null);
            }}
          >
            {gravando ? "Gravando…" : "Gravar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
