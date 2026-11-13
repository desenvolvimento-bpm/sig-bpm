"use client";

import { useState } from "react";
import { History } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** De onde veio a correção: o cadastro de reclassificações ou uma contestação validada. */
export type OrigemDaCorrecao = { tipo: "reclassificacao" } | { tipo: "contestacao"; numero: number };

/**
 * O ícone ao lado do centro de custo ou da conta corrigidos (27/10/2026, pedido do Adão): nos modais dos movimentos das
 * contas (o extrato e o balancete), o valor mostrado é o que vale; o ícone abre um pequeno modal com o original (o do
 * balancete do RM) e o corrigido — pela reclassificação do cadastro ou por uma contestação validada.
 */
export function IconeDaCorrecao({ campo, original, atual, origem }: { campo: "centro" | "conta"; original: string; atual: string; origem: OrigemDaCorrecao }) {
  const [aberto, setAberto] = useState(false);
  const nome = campo === "centro" ? "Centro de Custo" : "Conta";
  const por = origem.tipo === "contestacao" ? `Contestação nº ${origem.numero}` : "Reclassificação";
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setAberto(true);
        }}
        title={`${nome} corrigido (${por}): clique para ver o original`}
        aria-label={`Ver ${campo === "centro" ? "o centro de custo" : "a conta"} original`}
        className="ml-1 inline-flex size-4 shrink-0 items-center justify-center rounded-sm align-text-bottom text-amber-700 hover:bg-amber-50"
      >
        <History className="size-3.5" />
      </button>
      {aberto ? (
        <Dialog open onOpenChange={(o) => (!o ? setAberto(false) : undefined)}>
          <DialogContent className="rounded-sm sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{campo === "centro" ? "Centro de Custo Corrigido" : "Conta Corrigida"}</DialogTitle>
              <DialogDescription>
                {origem.tipo === "contestacao"
                  ? `Pela contestação nº ${origem.numero} (Contestações de Gastos), validada pela Controladoria.`
                  : campo === "centro"
                    ? "Pela reclassificação do cadastro (Cadastros da Apuração › Reclassificações › Por Fornecedor): o centro de custo imperativo do fornecedor."
                    : "Pela reclassificação do cadastro (Cadastros da Apuração › Reclassificações › Por Conta)."}
              </DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="font-medium text-gray-600">Original</dt>
              <dd className="text-gray-900">{original}</dd>
              <dt className="font-medium text-gray-600">{origem.tipo === "contestacao" ? "Corrigido" : "Reclassificado"}</dt>
              <dd className="font-semibold text-gray-900">{atual}</dd>
            </dl>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
