"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";

import { Input } from "@/components/ui/input";

export type OpcaoDaBusca = { id: string; codigo: string; nome: string; detalhe?: string | null };

/** Sem código (13/11/2026: os fornecedores das Reclassificações), só o nome. */
const rotulo = (o: OpcaoDaBusca) => (o.codigo ? `${o.codigo} — ${o.nome}` : o.nome);
/** Sem acentos e sem caixa, para a busca achar "manutencao" em "MANUTENÇÃO". */
const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Uma lista com busca (27/10/2026: o modal Contestar): o código e o nome de cada opção; digitar filtra por qualquer
 * termo (todos os termos, em qualquer ordem), e o X limpa a escolha. A lista mostra todas as opções, com a barra de
 * rolagem (04/11/2026, pedido do Adão; antes, só as 15 primeiras, e as demais só digitando); clicar na barra não a fecha.
 * A escolha feita fora do campo (a lupa do modal Contestar) aparece nele; a que sai de fora (a conta que não cabe no centro
 * novo) o limpa, se ele ainda mostrava a escolha.
 */
export function BuscaNaLista({
  id,
  opcoes,
  valor,
  onEscolher,
  placeholder,
}: {
  id: string;
  opcoes: OpcaoDaBusca[];
  valor: OpcaoDaBusca | null;
  onEscolher: (o: OpcaoDaBusca | null) => void;
  placeholder: string;
}) {
  const [texto, setTexto] = useState(valor ? rotulo(valor) : "");
  const [aberta, setAberta] = useState(false);
  // A escolha que veio de fora (o valor mudou sem o campo): o texto acompanha (o ajuste durante a renderização, sem efeito).
  const [visto, setVisto] = useState(valor);
  if (valor?.id !== visto?.id) {
    setVisto(valor);
    if (valor) setTexto(rotulo(valor));
    else if (visto && texto === rotulo(visto)) setTexto("");
  }
  const termos = normal(texto).split(/\s+/).filter(Boolean);
  const sugestoes = useMemo(
    () => opcoes.filter((o) => !termos.length || termos.every((t) => normal(`${rotulo(o)} ${o.detalhe ?? ""}`).includes(t))),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- os termos saem do texto.
    [opcoes, texto],
  );
  return (
    <div className="relative">
      <Input
        id={id}
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          setAberta(true);
          if (valor) onEscolher(null);
        }}
        onFocus={() => setAberta(true)}
        onBlur={() => setTimeout(() => setAberta(false), 150)}
        placeholder={placeholder}
        className="rounded-sm border-gray-300 pr-8"
        autoComplete="off"
      />
      {texto ? (
        <button
          type="button"
          aria-label="Limpar"
          onClick={() => {
            setTexto("");
            onEscolher(null);
          }}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 text-gray-400 hover:text-gray-700"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
      {aberta && !valor && sugestoes.length > 0 ? (
        // O mousedown na lista (na barra de rolagem, inclusive) não tira o foco do campo: sem isso, a lista se fechava.
        <ul onMouseDown={(e) => e.preventDefault()} className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-sm border border-gray-200 bg-white shadow-sm">
          {sugestoes.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                data-altera
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onEscolher(o);
                  setTexto(rotulo(o));
                  setAberta(false);
                }}
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100"
              >
                {o.codigo ? <span className="font-medium">{o.codigo} </span> : null}
                {o.nome}
                {o.detalhe ? <span className="block text-xs text-gray-500">{o.detalhe}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
