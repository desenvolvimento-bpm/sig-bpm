"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ListTree } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ROTULO_BALDE } from "@/app/contestacoes-de-gastos/components/RegrasDeRateioDialog";
import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";
import { plural } from "@/lib/texto";

import { cenariosService } from "../services/cenariosService";

/**
 * O modal Contas do Balancete (13/11/2026, pedido do Adão): as contas do RM (Contas de Resultado, nos Cadastros da
 * Controladoria) cuja Linha do DRE é a conta clicada em Premissas / Centros de Custo ou em Resultados dos Cenários
 * Analíticos — o Reduzido, a Conta, a Descrição, o Departamento, o Rateio e a situação.
 */
function ContasDoBalanceteDialog({ id, linha, onFechar }: { id: string; linha: string; onFechar: () => void }) {
  const consulta = useQuery({ queryKey: ["cenarios", id, "contas-do-balancete", linha], queryFn: () => cenariosService.contasDoBalancete(id, linha) });
  const d = consulta.data;
  return (
    <Dialog open onOpenChange={(aberto) => (!aberto ? onFechar() : undefined)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-sm sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Contas do Balancete</DialogTitle>
          <DialogDescription>
            {d
              ? `${d.linha.grupoSigla} › ${d.linha.atribuicao ?? "—"} › ${d.linha.descricao}: ${d.contas.length} ${plural(d.contas.length, "conta do RM cai", "contas do RM caem")} nesta conta (a Linha do DRE delas, em Cadastros Gerais › Contábil › Contas de Resultado).`
              : "As contas do RM que caem nesta conta."}
          </DialogDescription>
        </DialogHeader>
        {consulta.isError ? (
          <p className="text-sm text-red-700">{mensagemDeErro(consulta.error, "Erro ao carregar as contas do balancete.")}</p>
        ) : !d ? (
          <div className="h-32 animate-pulse rounded-sm bg-gray-100" />
        ) : d.contas.length === 0 ? (
          <p className="rounded-sm border border-gray-200 bg-white p-4 text-sm text-gray-600">Nenhuma conta do RM tem esta Linha do DRE.</p>
        ) : (
          <div className="overflow-x-auto rounded-sm border border-gray-200">
            <table className="tabela-sig w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-300 text-left">
                  <th className="px-3 py-2 text-xs font-bold">Reduzido</th>
                  <th className="px-3 py-2 text-xs font-bold">Conta</th>
                  <th className="px-3 py-2 text-xs font-bold">Descrição</th>
                  <th className="px-3 py-2 text-xs font-bold">Departamento</th>
                  <th className="px-3 py-2 text-xs font-bold">Rateio</th>
                  <th className="px-3 py-2 text-xs font-bold">Situação</th>
                </tr>
              </thead>
              <tbody>
                {d.contas.map((c) => (
                  <tr key={c.reduzido} className={`border-t border-gray-100 ${c.ativo ? "text-gray-900" : "text-gray-400"}`}>
                    <td className="px-3 py-1.5 whitespace-nowrap">{c.reduzido}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{c.conta}</td>
                    <td className="px-3 py-1.5">{c.descricao}</td>
                    <td className="px-3 py-1.5">{c.departamento ?? "—"}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{c.balde ? (ROTULO_BALDE[c.balde] ?? c.balde) : "—"}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{c.ativo ? "Ativa" : "Inativa"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** O botão de uma conta (ao lado da descrição): abre as Contas do Balancete dela. Fora da imagem das tabelas. */
export function BotaoContasDoBalancete({ id, linha, descricao }: { id: string; linha: string; descricao: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button
        type="button"
        data-fora-da-imagem
        title="Contas do Balancete"
        aria-label={`Contas do Balancete de ${descricao}`}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-gray-400 hover:bg-gray-200 hover:text-gray-900"
        onClick={(e) => {
          e.stopPropagation();
          setAberto(true);
        }}
      >
        <ListTree className="size-3.5" />
      </button>
      {aberto ? <ContasDoBalanceteDialog id={id} linha={linha} onFechar={() => setAberto(false)} /> : null}
    </>
  );
}
