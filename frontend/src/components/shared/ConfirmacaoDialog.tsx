"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * O modal de confirmação padrão do SIG (30/10/2026, pedido do Adão: no lugar da confirmação do navegador): o título, a
 * explicação, o detalhe (opcional, como os itens que saem), Cancelar e o botão da ação, vermelho (Excluir, Inativar). Com
 * `destrutiva={false}` (06/11/2026: Reabrir, Aprovar), o botão amarelo de sempre.
 */
export function ConfirmacaoDialog({
  titulo,
  descricao,
  children,
  acao = "Excluir",
  acaoPendente = "Excluindo…",
  pendente = false,
  destrutiva = true,
  onConfirmar,
  onFechar,
}: {
  titulo: ReactNode;
  descricao: ReactNode;
  children?: ReactNode;
  acao?: string;
  acaoPendente?: string;
  pendente?: boolean;
  destrutiva?: boolean;
  onConfirmar: () => void;
  onFechar: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent className="rounded-sm sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            type="button"
            className={destrutiva ? "rounded-sm bg-red-700 font-bold text-white hover:bg-red-800" : "bg-bpm-primary hover:bg-bpm-primary-hover rounded-sm font-bold text-black shadow-sm"}
            disabled={pendente}
            onClick={onConfirmar}
          >
            {pendente ? acaoPendente : acao}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
