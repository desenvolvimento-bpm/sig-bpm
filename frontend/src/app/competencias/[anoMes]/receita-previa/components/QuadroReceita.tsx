"use client";

import { Fragment } from "react";
import { Search } from "lucide-react";

import { Destaque, TabelaComDestaque } from "@/app/cenarios/components/DestaqueDaAba";

import { moeda } from "../../utils/formatacao";
import {
  ROTULO_LINHA,
  ROTULO_UNIDADE,
  type Natureza,
  type ReceitaNatureza,
  type ReceitaPrevia,
} from "../services/receitaPreviaService";

/** Naturezas de cada unidade, na ordem da aba Receitas (Prévia). */
const NATUREZAS_DA_UNIDADE: Record<number, Natureza[]> = {
  1: ["PRE_FABRICADO", "FRETE", "DEVOLUCOES_INVENTARIOS"],
  2: ["PRE_FABRICADO", "FRETE", "DEVOLUCOES_INVENTARIOS"],
  3: ["MONTAGEM", "COMPLEMENTAR"],
};

const soma = (xs: string[]) => xs.reduce((a, x) => a + Number(x), 0);

type Props = {
  unidade: number;
  receitas: ReceitaNatureza[];
  porVenda: ReceitaPrevia["porVenda"];
  impostos: ReceitaPrevia["impostos"];
  /** Abre a memória de cálculo; com variacao, só o que movimenta a variação do estoque. */
  onAbrir: (unidade: number, natureza: Natureza, variacao?: boolean) => void;
};

function Linha({
  rotulo,
  valor,
  destaque,
  detalhe,
  base,
  onClick,
}: {
  rotulo: string;
  valor: number;
  destaque?: boolean;
  /** Linha de abertura (venda global ou mercantil, imposto): mais recuada e menor. */
  detalhe?: boolean;
  base: number;
  onClick?: () => void;
}) {
  const pct = base === 0 ? null : valor / base;
  return (
    // Como na DRE: a linha que abre a memória de cálculo leva a lupa e se clica inteira.
    <tr
      className={`${destaque ? "border-t border-gray-200 bg-gray-50" : "border-t border-gray-100"} ${onClick ? "cursor-pointer hover:bg-gray-50" : ""}`}
      onClick={onClick}
      title={onClick ? "Ver a memória de cálculo" : undefined}
    >
      <td
        className={`px-3 ${detalhe ? "py-1 pl-12 text-xs text-gray-500" : "py-1.5 text-sm"} ${destaque ? "font-bold text-gray-900" : detalhe ? "" : "pl-7 text-gray-700"}`}
      >
        {onClick ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClick();
            }}
            className="inline-flex items-center gap-1 text-left"
          >
            <Search className="size-3.5 text-gray-400" />
            {rotulo}
          </button>
        ) : (
          rotulo
        )}
      </td>
      <td className={`px-3 text-right ${detalhe ? "py-1 text-xs text-gray-500" : "py-1.5 text-sm"} ${destaque ? "font-bold" : ""}`}>{moeda(valor)}</td>
      <td className={`px-3 text-right text-xs text-gray-500 ${detalhe ? "py-1" : "py-1.5"}`}>
        {pct === null ? "—" : `${(pct * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
      </td>
    </tr>
  );
}

/**
 * Um bloco da aba Receitas (Prévia): ROB, IRB e ROL da unidade, por natureza.
 * Na Matriz e na Filial, cada receita se abre em venda global e mercantil, e
 * os impostos em PIS/COFINS de cada venda, ISS e ICMS; em Obras, em PIS/COFINS
 * e ISS. As aberturas só existem aqui: a DRE continua com os totais.
 * Os três blocos ficam um embaixo do outro, com as mesmas larguras, para os
 * valores se alinharem entre eles. Desde 21/11/2026 (pedido do Adão), no padrão
 * das telas com mais de uma tabela (como os Investimentos dos Cenários
 * Analíticos): o destaque à parte, acima da tabela, que flutua sobre ela ao
 * rolar, e os rótulos das colunas presos (TabelaComDestaque).
 */
export function QuadroReceita({ unidade, receitas, porVenda, impostos, onAbrir }: Props) {
  const naturezas = NATUREZAS_DA_UNIDADE[unidade];
  const da = (n: Natureza) => receitas.find((r) => r.unidade === unidade && r.natureza === n);
  const separa = unidade !== 3;
  const vendaDe = (n: Natureza) => porVenda.find((v) => v.unidade === unidade && v.natureza === n);
  const imp = impostos.find((i) => i.unidade === unidade);
  const aberturaImpostos: Array<[string, string]> = separa
    ? [
        ["Impostos Operacionais (PIS/COFINS Global)", imp?.pisCofinsGlobal ?? "0"],
        ["Impostos Operacionais (PIS/COFINS Mercantil)", imp?.pisCofinsMercantil ?? "0"],
        ["Impostos Operacionais (ISS)", imp?.iss ?? "0"],
        ["Impostos Operacionais (ICMS)", imp?.icms ?? "0"],
      ]
    : [
        ["Impostos Operacionais (PIS/COFINS)", imp?.pisCofinsGlobal ?? "0"],
        ["Impostos Operacionais (ISS)", imp?.iss ?? "0"],
      ];
  const vendas = (n: Natureza, campo: "receitaBruta" | "receitaLiquida", rotulo: string, base: number) =>
    separa
      ? ([
          ["global", "Global"],
          ["mercantil", "Mercantil"],
        ] as const).map(([v, nome]) => (
          <Linha key={`${campo}-${n}-${v}`} rotulo={`${rotulo} (${nome})`} valor={Number(vendaDe(n)?.[v][campo] ?? 0)} base={base} detalhe />
        ))
      : null;
  const rob = soma(naturezas.map((n) => da(n)?.receitaBruta ?? "0"));
  const rol = soma(naturezas.map((n) => da(n)?.receitaLiquida ?? "0"));
  const variacao = Number(da("PRE_FABRICADO")?.variacaoEstoque ?? 0);

  return (
    <TabelaComDestaque
      destaque={
        <Destaque
          titulo={ROTULO_UNIDADE[unidade]}
          descricao={`A receita bruta, os impostos e a receita líquida${separa ? ", com a abertura em venda global e mercantil" : ""}. Clique numa linha com lupa para abrir a memória de cálculo.`}
        />
      }
      colunas={[
        { rotulo: "Linha da Receita", largura: 720 },
        { rotulo: "Valor", largura: 200, direita: true },
        { rotulo: "%", largura: 100, direita: true },
      ]}
      corpo={
        <>
          <Linha rotulo="RECEITA OPERACIONAL BRUTA (ROB)" valor={rob} base={rob} destaque />
          {naturezas.map((n) => (
            <Fragment key={`b-${n}`}>
              <Linha rotulo={ROTULO_LINHA[n].bruta} valor={Number(da(n)?.receitaBruta ?? 0)} base={rob} onClick={() => onAbrir(unidade, n)} />
              {vendas(n, "receitaBruta", ROTULO_LINHA[n].bruta, rob)}
            </Fragment>
          ))}
          <Linha rotulo="IMPOSTOS SOBRE A RECEITA BRUTA (IRB)" valor={rob - rol} base={rob} destaque />
          <Linha rotulo="Impostos Operacionais" valor={rob - rol} base={rob} />
          {aberturaImpostos.map(([rotulo, valor]) => (
            <Linha key={rotulo} rotulo={rotulo} valor={Number(valor)} base={rob} detalhe />
          ))}
          <Linha rotulo="RECEITA OPERACIONAL LÍQUIDA (ROL)" valor={rol} base={rol} destaque />
          {naturezas.map((n) => (
            <Fragment key={`l-${n}`}>
              <Linha rotulo={ROTULO_LINHA[n].liquida} valor={Number(da(n)?.receitaLiquida ?? 0)} base={rob} onClick={() => onAbrir(unidade, n)} />
              {vendas(n, "receitaLiquida", ROTULO_LINHA[n].liquida, rob)}
            </Fragment>
          ))}
          {unidade === 2 ? (
            <>
              <Linha rotulo="CUSTOS DE PRODUÇÃO: PRÉ-FABRICADOS (CPP)" valor={variacao} base={variacao} destaque />
              <Linha rotulo="Variação do Estoque" valor={variacao} base={rob - rol} onClick={() => onAbrir(2, "PRE_FABRICADO", true)} />
            </>
          ) : null}
        </>
      }
    />
  );
}
