"use client";

import { useQuery } from "@tanstack/react-query";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { plural } from "@/lib/texto";

type Movimento = {
  id: string;
  data: string;
  tipo: string;
  contagem: "POSITIVA" | "NEGATIVA" | "NULA";
  classificacao: string | null;
  centroCusto: string;
  vinculo: "CLT" | "PJ";
  funcao: string;
  senioridade: string;
};
const CONTAGEM: Record<Movimento["contagem"], string> = { POSITIVA: "+1", NEGATIVA: "−1", NULA: "0" };

/**
 * A lupa de um indicador apurado no Quadro de Lotação (06/11/2026): as movimentações aprovadas do mês que deram origem ao
 * valor — admissões, reposições, desligamentos, aberturas e encerramentos de vaga —, com a contagem de cada uma no quadro.
 */
export function MovimentosDoQuadroDialog({ ano, mes, indicador, onFechar }: { ano: number; mes: number; indicador: string; onFechar: () => void }) {
  const anoMes = `${ano}-${String(mes).padStart(2, "0")}`;
  const lista = useQuery({
    queryKey: ["quadro", "movimentos-aprovados", anoMes],
    queryFn: async () => (await api.get<{ data: { competencia: string; itens: Movimento[] } }>(`/proxy/gestao-de-colaboradores/quadro/competencias/${anoMes}/movimentos-aprovados`)).data.data,
  });
  const itens = lista.data?.itens ?? [];
  const soma = (c: Movimento["contagem"]) => itens.filter((m) => m.contagem === c).length;
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden rounded-sm sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Movimentos do Quadro de Lotação</DialogTitle>
          <DialogDescription>
            {indicador} em {String(mes).padStart(2, "0")}/{ano}: o valor foi apurado no Quadro de Lotação (Gestão de Colaboradores), a partir destas
            movimentações aprovadas do mês.
          </DialogDescription>
        </DialogHeader>
        {lista.isPending ? (
          <div className="h-32 animate-pulse rounded-sm bg-gray-100" />
        ) : itens.length === 0 ? (
          <p className="text-sm text-gray-600">Nenhuma movimentação aprovada no mês: o quadro é o do início do mês.</p>
        ) : (
          <>
            <p className="text-sm text-gray-700">
              {itens.length} {plural(itens.length, "movimentação", "movimentações")}: {soma("POSITIVA")} {plural(soma("POSITIVA"), "entrada", "entradas")}, {soma("NEGATIVA")}{" "}
              {plural(soma("NEGATIVA"), "saída", "saídas")} e {soma("NULA")} sem efeito no quadro (as vagas).
            </p>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-sm border border-gray-200 [--topo-tabela:0px]">
              <table className="tabela-sig w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs font-bold text-gray-900">
                    <th className="px-3 py-2">Data</th>
                    <th className="px-3 py-2">Movimentação</th>
                    <th className="px-3 py-2 text-right">Quadro</th>
                    <th className="px-3 py-2">Centro de Custo</th>
                    <th className="px-3 py-2">Tipo</th>
                    <th className="px-3 py-2">Função</th>
                    <th className="px-3 py-2">Nível</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((m) => (
                    <tr key={m.id} className="border-b border-gray-100 align-top">
                      <td className="px-3 py-1.5 whitespace-nowrap">{m.data.split("-").reverse().join("/")}</td>
                      <td className="px-3 py-1.5">
                        {m.tipo}
                        {m.classificacao ? <span className="block text-xs text-gray-500">{m.classificacao}</span> : null}
                      </td>
                      <td className="px-3 py-1.5 text-right font-medium">{CONTAGEM[m.contagem]}</td>
                      <td className="px-3 py-1.5">{m.centroCusto}</td>
                      <td className="px-3 py-1.5">{m.vinculo}</td>
                      <td className="px-3 py-1.5">{m.funcao}</td>
                      <td className="px-3 py-1.5">{m.senioridade}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
