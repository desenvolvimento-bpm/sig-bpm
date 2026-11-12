"use client";

import type { ReactNode } from "react";

import { CabecalhoDaTela } from "@/components/shared/CabecalhoDaTela";
import { Paginacao } from "@/components/shared/Paginacao";
import { QuadroTabela } from "@/components/shared/QuadroTabela";

import { CaixaApenasAtivas, type ControleApenasAtivas } from "./ApenasAtivas";

type CadastroShellProps = {
  titulo: string;
  descricao: string;
  /** Orientações de uso, no painel Sobre Esta Tela. */
  comoUsar?: ReactNode;
  total: number;
  pagina: number;
  porPagina: number;
  onPaginaChange: (pagina: number) => void;
  /** Sem ele, a quantidade por página é fixa. */
  onPorPaginaChange?: (porPagina: number) => void;
  carregando: boolean;
  /** Botões à direita do título, como o de recarga da planilha. */
  acoes?: ReactNode;
  /** A caixa "Apenas Ativas" (Cadastros da Controladoria), logo antes dos botões. */
  apenasAtivas?: ControleApenasAtivas;
  /** O Exportar da tabela (30/10/2026, `ExportarTabela`). */
  exportar?: ReactNode;
  /** Um aviso entre o cabeçalho e a tabela, como o resumo do Lançamento Inicial da Gestão de Colaboradores. */
  aviso?: ReactNode;
  children: ReactNode;
};

/**
 * Moldura comum das telas de cadastro: o cabeçalho único, os filtros nos rótulos
 * da tabela e a paginação no rodapé (G6, G7 e G10 do levantamento de layout).
 * Cada tela cuida só das colunas.
 */
export function CadastroShell({
  titulo,
  descricao,
  comoUsar,
  total,
  pagina,
  porPagina,
  onPaginaChange,
  onPorPaginaChange,
  carregando,
  acoes,
  apenasAtivas,
  exportar,
  aviso,
  children,
}: CadastroShellProps) {
  return (
    <div className="space-y-4">
      <CabecalhoDaTela
        titulo={titulo}
        sobre={<p>{descricao}</p>}
        comoUsar={comoUsar}
        exportar={exportar}
        acoes={
          apenasAtivas ? (
            <div className="flex flex-wrap items-center gap-4">
              <CaixaApenasAtivas {...apenasAtivas} />
              {acoes}
            </div>
          ) : (
            acoes
          )
        }
      />
      {aviso}
      <QuadroTabela
        rodape={<Paginacao total={total} pagina={pagina} porPagina={porPagina} onPagina={onPaginaChange} onPorPagina={onPorPaginaChange} carregando={carregando} />}
      >
        {children}
      </QuadroTabela>
    </div>
  );
}
