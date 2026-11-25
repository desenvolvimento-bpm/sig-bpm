"use client";

import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

/** "2026-11" → "11/2026" (o mês na tela); vazio sem mês. */
export const mesAnoNaTela = (mes: string) => (/^\d{4}-\d{2}$/.test(mes) ? `${mes.slice(5)}/${mes.slice(0, 4)}` : "");

/** "11/2026" → "2026-11"; nulo quando não é um mês. */
export function mesAnoDoTexto(texto: string): string | null {
  const m = /^(\d{2})\/(\d{4})$/.exec(texto.trim());
  if (!m) return null;
  const mes = Number(m[1]);
  return mes >= 1 && mes <= 12 ? `${m[2]}-${m[1]}` : null;
}

/** Só os dígitos, com a barra depois do mês: "112026" → "11/2026". */
const comMascara = (texto: string) => {
  const d = texto.replace(/\D/g, "").slice(0, 6);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
};

/**
 * O campo de um mês (25/11/2026, pedido do Adão: as vigências das Redistribuições de Gastos em "MM/AAAA", com o calendário só
 * de anos e meses): digita-se o mês no modelo MM/AAAA (a barra entra sozinha) ou escolhe-se no calendário do botão ao lado — o
 * ano nas setas e os doze meses. `valor` e `onChange` usam "AAAA-MM" (vazio sem mês, também enquanto o texto não forma um).
 */
export function CampoMesAno({
  id,
  valor,
  onChange,
  disabled,
  invalido,
  title,
  className,
}: {
  id?: string;
  valor: string;
  onChange: (mes: string) => void;
  disabled?: boolean;
  /** A borda vermelha (o fim antes do início, por exemplo). */
  invalido?: boolean;
  title?: string;
  className?: string;
}) {
  const [texto, setTexto] = useState(mesAnoNaTela(valor));
  const [focado, setFocado] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [ano, setAno] = useState(() => Number(valor.slice(0, 4)) || new Date().getFullYear());
  // O mês que vem de fora (a edição de outro registro) volta ao texto; o texto incompleto fica.
  const [valorAnterior, setValorAnterior] = useState(valor);
  if (valor !== valorAnterior) {
    setValorAnterior(valor);
    if (valor && valor !== mesAnoDoTexto(texto)) setTexto(mesAnoNaTela(valor));
  }
  const digitar = (bruto: string) => {
    const t = comMascara(bruto);
    setTexto(t);
    onChange(mesAnoDoTexto(t) ?? "");
  };
  const escolher = (mes: number) => {
    const v = `${ano}-${String(mes).padStart(2, "0")}`;
    setTexto(mesAnoNaTela(v));
    onChange(v);
    setAberto(false);
  };
  const textoInvalido = !focado && texto !== "" && mesAnoDoTexto(texto) === null;
  return (
    <div
      className={cn(
        "flex h-9 w-full items-center rounded-sm border border-input bg-transparent shadow-xs transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        (invalido || textoInvalido) && "border-red-400",
        disabled && "opacity-50",
        className,
      )}
      title={title}
    >
      <input
        id={id}
        value={texto}
        onChange={(e) => digitar(e.target.value)}
        onFocus={() => setFocado(true)}
        onBlur={() => setFocado(false)}
        placeholder="MM/AAAA"
        inputMode="numeric"
        autoComplete="off"
        maxLength={7}
        disabled={disabled}
        className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm outline-none disabled:cursor-not-allowed"
      />
      <Popover.Root
        open={aberto}
        onOpenChange={(sim) => {
          setAberto(sim);
          if (sim) setAno(Number(valor.slice(0, 4)) || new Date().getFullYear());
        }}
      >
        <Popover.Trigger
          disabled={disabled}
          aria-label="Escolher o mês no calendário"
          title="Escolher o mês no calendário"
          className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-sm text-gray-600 outline-none hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed"
        >
          <CalendarDays className="size-4" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner sideOffset={4} align="end" className="z-50">
            <Popover.Popup className="w-64 rounded-sm border border-gray-200 bg-white p-2 text-gray-900 shadow-lg outline-none">
              <div className="mb-2 flex items-center justify-between">
                <button type="button" aria-label="Ano anterior" title="Ano anterior" onClick={() => setAno((a) => a - 1)} className="flex size-7 items-center justify-center rounded-sm hover:bg-gray-100">
                  <ChevronLeft className="size-4" />
                </button>
                <span className="text-sm font-semibold">{ano}</span>
                <button type="button" aria-label="Próximo ano" title="Próximo ano" onClick={() => setAno((a) => a + 1)} className="flex size-7 items-center justify-center rounded-sm hover:bg-gray-100">
                  <ChevronRight className="size-4" />
                </button>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {MESES.map((nome, k) => {
                  const escolhido = valor === `${ano}-${String(k + 1).padStart(2, "0")}`;
                  return (
                    <button
                      key={nome}
                      type="button"
                      onClick={() => escolher(k + 1)}
                      className={cn("rounded-sm py-1.5 text-sm", escolhido ? "bg-bpm-primary font-bold text-black" : "hover:bg-gray-100")}
                    >
                      {nome}
                    </button>
                  );
                })}
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
