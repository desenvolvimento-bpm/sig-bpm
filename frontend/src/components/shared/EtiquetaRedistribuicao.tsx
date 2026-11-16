/** A redistribuição de gastos de um movimento (13/11/2026): os destinos (o centro, o percentual e o valor de cada parte). */
export type RedistribuicaoDoMovimento = {
  destinos: Array<{ centro: string; percentual: number; valor: string }>;
  /** O valor mostrado é o da parte do centro pedido (o balancete aberto pelo extrato de um centro). */
  parte?: boolean;
};

const moeda = (v: string) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

/** O texto da redistribuição (a dica da etiqueta e o bloqueio dos itens). */
export const textoDaRedistribuicao = (r: RedistribuicaoDoMovimento) =>
  `Movimento redistribuído (Cadastros Gerais / Redistribuições de Gastos), dividido entre ${r.destinos
    .map((d) => `${d.centro}: ${pct(d.percentual)} (${moeda(d.valor)})`)
    .join("; ")}. Não pode ser contestado.`;

/**
 * A etiqueta da coluna Ações no lugar do Contestar (13/11/2026): o movimento redistribuído não se contesta, como o reflexo de
 * um rateio. A dica mostra os destinos.
 */
export function EtiquetaRedistribuicao({ redistribuicao }: { redistribuicao: RedistribuicaoDoMovimento }) {
  return (
    <span
      className="inline-flex items-center rounded-sm border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-sky-800"
      title={textoDaRedistribuicao(redistribuicao)}
    >
      Redistribuição
    </span>
  );
}
