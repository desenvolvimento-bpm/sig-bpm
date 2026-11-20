"use client";

import type { ReactNode } from "react";

import { DestaqueFlutuante, useDestaqueFlutuante } from "@/components/shared/DestaqueFlutuante";

import { TabelaLarga } from "@/app/relatorios/components/TabelaLarga";

/**
 * O padrão das abas com tabela (pedido do Adão de 20/11/2026, como nas Premissas): o destaque — um cartão à parte, acima da
 * tabela, com o título, a descrição e, à direita, as funções da tabela, com o Exportar por último — flutua sobre a tabela ao
 * rolar a tela (useDestaqueFlutuante), e os rótulos da tabela ficam presos logo abaixo do título da tela (TabelaLarga). Nas
 * Configurações dos cenários: as cópias dos cadastros, o Comparativo e os Reajustes.
 */

/** Uma coluna da tabela: o rótulo, a largura (px; as colunas se esticam até a largura da tela) e o alinhamento. */
export type ColunaDaTabela = { rotulo: ReactNode; largura: number; direita?: boolean; chave?: string };

/** As células de texto das tabelas (as das Premissas). */
export const TD = "truncate px-3 py-1.5 whitespace-nowrap";

/** O destaque da tabela. `abaixo`: a busca, os filtros e os avisos, dentro do cartão. */
export function Destaque({ titulo, descricao, children, abaixo }: { titulo: string; descricao: ReactNode; children?: ReactNode; abaixo?: ReactNode }) {
  return (
    <div className="space-y-2 rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        {/* Com muitos botões, eles descem para a linha de baixo (à direita), sem espremer o título e a descrição. */}
        <div className="min-w-72 flex-1">
          <h2 className="text-base font-bold tracking-wide text-gray-900 uppercase">{titulo}</h2>
          <div className="text-xs text-gray-600">{descricao}</div>
        </div>
        {children ? <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">{children}</div> : null}
      </div>
      {abaixo}
    </div>
  );
}

/** A linha de rótulos das colunas. */
export function cabecalhoDe(colunas: ColunaDaTabela[]) {
  return (
    <tr className="border-b border-gray-300">
      {colunas.map((c, i) => (
        <th key={c.chave ?? (typeof c.rotulo === "string" ? c.rotulo : i)} className={`px-3 py-2 text-xs font-bold ${c.direita ? "text-right" : "text-left"}`}>
          {c.rotulo}
        </th>
      ))}
    </tr>
  );
}

/**
 * A tabela com o destaque acima dela, que flutua sobre a tabela ao rolar. As colunas (`colunas`) ou, para um cabeçalho próprio
 * (duas linhas de rótulos), as larguras e o cabeçalho.
 */
export function TabelaComDestaque({
  destaque,
  colunas,
  larguras,
  cabecalho,
  corpo,
}: {
  destaque: ReactNode;
  colunas?: ColunaDaTabela[];
  larguras?: number[];
  cabecalho?: ReactNode;
  corpo: ReactNode;
}) {
  const { refOriginal, refArea, refFlutuante, flutuar, rotulos } = useDestaqueFlutuante();
  return (
    <section className="space-y-2">
      <div ref={refOriginal}>{destaque}</div>
      <div ref={refArea}>
        <DestaqueFlutuante refFlutuante={refFlutuante} flutuar={flutuar} rotulos={rotulos}>
          {destaque}
        </DestaqueFlutuante>
        <TabelaLarga larguras={larguras ?? (colunas ?? []).map((c) => c.largura)} cabecalho={cabecalho ?? cabecalhoDe(colunas ?? [])} corpo={corpo} />
      </div>
    </section>
  );
}

/** A linha da tabela vazia (ou do filtro sem resultado). */
export function LinhaVazia({ colunas, texto }: { colunas: number; texto: string }) {
  return (
    <tr>
      <td colSpan={colunas} className="px-3 py-6 text-center text-gray-500">
        {texto}
      </td>
    </tr>
  );
}
