import type { ReactNode } from "react";

import { iniciaisMaiusculas } from "@/lib/texto";

export type Indicador = {
  rotulo: string;
  valor: ReactNode;
  /** "atencao" pinta o valor de vermelho (pendências, diferenças). */
  tom?: "atencao";
  /** Texto do title: o detalhe que não cabe na faixa. */
  dica?: string;
  /** O rótulo antes do valor ("classificado em 01/10/2026"); o padrão é depois ("1.146 lançamentos"). */
  rotuloAntes?: boolean;
};

/**
 * Os números da tela numa faixa só (E4 do levantamento de layout), em vez de
 * um cartão grande para cada número. `titulo` (21/11/2026: o Pendente de Recálculo dos cenários) vem antes dos números, em
 * negrito e no tamanho deles; `borda` "atencao" é o destaque vermelho: as bordas cinza padrão e só a esquerda vermelha.
 */
export function FaixaIndicadores({ itens, titulo, borda }: { itens: Indicador[]; titulo?: string; borda?: "atencao" }) {
  return (
    // Destaque amarelo-ouro à esquerda, como nos quadros das tabelas (vermelho no de atenção).
    <dl
      className={`flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-sm border border-l-4 bg-white px-4 py-2.5 border-gray-200 ${borda === "atencao" ? "border-l-red-600" : "border-l-bpm-primary"}`}
    >
      {titulo ? (
        <div className="flex items-baseline">
          <dt className="text-base font-extrabold text-gray-900">{titulo}</dt>
        </div>
      ) : null}
      {itens.map((i) => (
        <div key={i.rotulo} className="flex items-baseline gap-1.5" title={i.dica}>
          <dt className={`text-xs text-gray-600 ${i.rotuloAntes ? "" : "order-2"}`}>{iniciaisMaiusculas(i.rotulo)}</dt>
          <dd className={`${i.rotuloAntes ? "" : "order-1"} text-base font-extrabold ${i.tom === "atencao" ? "text-red-700" : "text-gray-900"}`}>{i.valor}</dd>
        </div>
      ))}
    </dl>
  );
}
