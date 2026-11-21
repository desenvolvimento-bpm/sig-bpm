"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";
import { moeda } from "@/app/competencias/[anoMes]/utils/formatacao";
import { plural } from "@/lib/texto";

import { cenariosService, type Cenario, type MovimentacaoForaDoPadrao } from "../services/cenariosService";
import { botaoPrimario, classeSelect, Erro } from "./CenarioDialog";

/** O grupo escolhido de cada conta ("" = fora do cenário). */
type Escolhas = Record<string, string>;

const somaDe = (ms: MovimentacaoForaDoPadrao[]) => ms.reduce((s, m) => s + m.total, 0);

/**
 * A realocação das movimentações fora dos padrões das premissas (14/10/2026): cada conta da última carga do realizado,
 * com a alocação dela na DRE e o total do período, e o grupo de centros de custo que a recebe (os que têm a mesma
 * atribuição e conta). Sem centro, a conta fica fora do cenário — gravar assim pede confirmação. As escolhas ficam no
 * cenário e valem nas próximas cargas do realizado.
 */
export function RealocacoesDialog({ cenario, podeEditar, onFechar }: { cenario: Cenario; podeEditar: boolean; onFechar: () => void }) {
  const queryClient = useQueryClient();
  const r = cenario.realocacoes!;
  const inicial: Escolhas = Object.fromEntries(r.movimentacoes.map((m) => [m.chave, r.decisoes[m.chave] ?? ""]));
  const [escolhas, setEscolhas] = useState<Escolhas>(inicial);
  const [confirmar, setConfirmar] = useState(false);
  const [padraoAplicado, setPadraoAplicado] = useState<string | null>(null);
  // O padrão (14/10/2026): o centro do RM de cada departamento, filial e atribuição; só preenche, o Gravar grava.
  const comPadrao = r.movimentacoes.filter((m) => m.padrao);
  const temPadrao = r.movimentacoes.some((m) => m.padrao !== undefined);
  const aplicarPadrao = () => {
    setEscolhas((x) => ({ ...x, ...Object.fromEntries(comPadrao.map((m) => [m.chave, m.padrao!])) }));
    const sem = r.movimentacoes.length - comPadrao.length;
    setPadraoAplicado(
      `Padrão aplicado em ${comPadrao.length} ${plural(comPadrao.length, "conta", "contas")}${sem ? `; ${sem} sem centro padrão ${plural(sem, "ficou", "ficaram")} como ${plural(sem, "estava", "estavam")}` : ""}. Confira e clique em “Gravar”.`,
    );
  };
  const mudou = r.movimentacoes.some((m) => escolhas[m.chave] !== inicial[m.chave]);
  const semCentro = r.movimentacoes.filter((m) => !escolhas[m.chave]);
  const realocadas = r.movimentacoes.filter((m) => escolhas[m.chave]);
  const gravar = useMutation({
    mutationFn: () => cenariosService.gravarRealocacoes(cenario.id, Object.fromEntries(r.movimentacoes.map((m) => [m.chave, escolhas[m.chave] || null]))),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cenarios"] });
      toast.success("Realocações gravadas; a DRE fica pendente de recálculo (Resultados / Recalcular).");
      onFechar();
    },
  });
  const aoGravar = () => (semCentro.length ? setConfirmar(true) : gravar.mutate());

  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="max-h-[92vh] overflow-y-auto rounded-sm sm:max-w-[min(96vw,92rem)]">
        <DialogHeader>
          <DialogTitle>Realocação das Movimentações Fora dos Padrões</DialogTitle>
          <DialogDescription>
            As movimentações da última carga do realizado{r.referencia ? ` — ${r.referencia} —` : ""} que não caem num grupo de centros de custo do cenário: sem centro de
            custo, em centros fora do cenário (estoque, investimento, obras) ou numa conta fora do grupo do centro. Escolha o centro de custo que
            recebe cada conta; sem centro, ela fica fora do cenário. As escolhas valem nas próximas cargas do realizado.
          </DialogDescription>
        </DialogHeader>
        {/* A tabela rola por dentro, com os rótulos fixos. */}
        <div className="max-h-[60vh] overflow-auto rounded-sm border border-gray-200 bg-white [--topo-tabela:0px]">
          <table className="tabela-sig w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="px-3 text-left text-xs font-bold">Conta</th>
                <th className="px-3 text-left text-xs font-bold">Departamento</th>
                <th className="px-3 text-left text-xs font-bold">Atribuição</th>
                <th className="px-3 text-left text-xs font-bold">Conta de Resultado</th>
                <th className="px-3 text-right text-xs font-bold">Valor</th>
                <th className="px-3 text-left text-xs font-bold">Centro de Custo</th>
              </tr>
            </thead>
            <tbody>
              {r.movimentacoes.map((m) => {
                const escolhido = escolhas[m.chave];
                const destino = m.destinos.find((d) => d.grupo === escolhido);
                const departamentos = [...new Set(m.destinos.map((d) => d.departamento))];
                return (
                  <tr key={m.chave} className="border-t border-gray-100 align-top">
                    <td className="px-3 py-1.5">
                      <span className="text-gray-900">
                        {m.conta.reduzido} · {m.conta.descricao}
                      </span>
                      <span className="block max-w-80 truncate text-xs text-gray-500" title={m.origens.join("\n")}>
                        {m.origens.slice(0, 2).join("; ")}
                        {m.origens.length > 2 ? ` e mais ${m.origens.length - 2}` : ""}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-xs text-gray-600">{m.linha.departamento}</td>
                    <td className="px-3 py-1.5 text-gray-600">{m.linha.atribuicao}</td>
                    <td className="px-3 py-1.5 text-gray-600">{m.linha.descricao}</td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap text-gray-600">{moeda(m.total)}</td>
                    <td className="px-3 py-1.5">
                      <select
                        aria-label={`Centro de custo de ${m.conta.descricao}`}
                        value={escolhido}
                        disabled={!podeEditar}
                        onChange={(e) => setEscolhas((x) => ({ ...x, [m.chave]: e.target.value }))}
                        className={`${classeSelect} min-w-64 ${escolhido ? "" : "text-gray-500"}`}
                      >
                        <option value="">Fora do Cenário</option>
                        {departamentos.map((d) => (
                          <optgroup key={d} label={d}>
                            {m.destinos
                              .filter((x) => x.departamento === d)
                              .map((x) => (
                                <option key={x.grupo} value={x.grupo}>
                                  {x.grupo}
                                </option>
                              ))}
                          </optgroup>
                        ))}
                      </select>
                      {/* Num centro de outro departamento, a conta vai para a do departamento dele. */}
                      {destino && destino.departamento !== m.linha.departamento ? (
                        <span className="mt-0.5 block text-xs text-gray-500">Entra como {destino.departamento}</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-gray-600">
          Realocadas: {realocadas.length} {plural(realocadas.length, "conta", "contas")} ({moeda(somaDe(realocadas))}) · Fora do cenário: {semCentro.length}{" "}
          {plural(semCentro.length, "conta", "contas")} ({moeda(somaDe(semCentro))}).
        </p>
        {padraoAplicado ? <p className="text-sm text-gray-600">{padraoAplicado}</p> : null}
        <Erro erro={gravar.isError ? mensagemDeErro(gravar.error, "Não foi possível gravar as realocações.") : null} />
        {/* Sem a edição, o rodapé teria só o Fechar: sai, e o X do canto fecha (15/10/2026). */}
        {podeEditar ? (
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="rounded-sm sm:mr-auto"
              disabled={!temPadrao}
              data-altera
              title={temPadrao ? "Preenche os centros de custo pelo padrão (Produção Matriz e Filial, Serviços, Logística, Técnico, Comercial e Administrativo)" : "Recarregue o resultado realizado para usar o padrão"}
              onClick={aplicarPadrao}
            >
              Aplicar Padrão
            </Button>
            <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
              Cancelar
            </Button>
            <Button type="button" className={botaoPrimario} disabled={!mudou || gravar.isPending} onClick={aoGravar}>
              {gravar.isPending ? "Gravando…" : "Gravar"}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>

      {confirmar ? (
        <Dialog open onOpenChange={(o) => (!o ? setConfirmar(false) : undefined)}>
          <DialogContent className="rounded-sm sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Movimentações Sem Centro de Custo</DialogTitle>
              <DialogDescription>
                {semCentro.length} {plural(semCentro.length, "conta fica", "contas ficam")} sem centro de custo ({moeda(somaDe(semCentro))}): {plural(semCentro.length, "ela fica", "elas ficam")}{" "}
                fora do cenário, e a DRE dele não {plural(semCentro.length, "a", "as")} terá. Gravar assim?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" className="rounded-sm" onClick={() => setConfirmar(false)}>
                Voltar
              </Button>
              <Button
                type="button"
                className={botaoPrimario}
                disabled={gravar.isPending}
                onClick={() => {
                  setConfirmar(false);
                  gravar.mutate();
                }}
              >
                Gravar Assim
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Dialog>
  );
}

const dataHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : null);

/** O botão que abre o modal das realocações (Realocar; só lendo, Realocações), com o modal; nada sem movimentações fora dos padrões. */
export function BotaoRealocar({ cenario, podeEditar }: { cenario: Cenario; podeEditar: boolean }) {
  const [aberto, setAberto] = useState(false);
  if (!cenario.realocacoes?.movimentacoes.length) return null;
  return (
    <>
      <Button type="button" className={botaoPrimario} onClick={() => setAberto(true)}>
        {podeEditar ? "Realocar" : "Realocações"}
      </Button>
      {aberto ? <RealocacoesDialog cenario={cenario} podeEditar={podeEditar} onFechar={() => setAberto(false)} /> : null}
    </>
  );
}

/**
 * O quadro da aba Referência (14/10/2026; antes, os avisos com os totais sem centro de custo): diz que há movimentações
 * fora dos padrões das premissas, registra as realocações gravadas e abre o modal delas. `comBotao` falso: o botão fica
 * fora do quadro (03/11/2026, pedido do Adão: ao lado do Carregar Realizado).
 */
export function QuadroDeRealocacoes({ cenario, podeEditar, comBotao = true }: { cenario: Cenario; podeEditar: boolean; comBotao?: boolean }) {
  const r = cenario.realocacoes;
  if (!r?.movimentacoes.length) return null;
  const realocadas = r.movimentacoes.filter((m) => r.aplicadas[m.chave]);
  const fora = r.movimentacoes.filter((m) => !r.aplicadas[m.chave]);
  return (
    <div className="space-y-2 rounded-sm border border-l-4 border-gray-200 border-l-red-600 bg-white px-4 py-3 text-sm text-gray-700">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-gray-900">Movimentações Fora dos Padrões</p>
          <p>Foram encontradas movimentações realizadas fora dos padrões das premissas.</p>
        </div>
        {comBotao ? <BotaoRealocar cenario={cenario} podeEditar={podeEditar} /> : null}
      </div>
      {realocadas.length ? (
        <>
          <p className="text-gray-600">
            Realocações registradas
            {r.atualizadoPor ? ` (por ${r.atualizadoPor}${r.atualizadoEm ? ` em ${dataHora(r.atualizadoEm)}` : ""})` : ""}:
          </p>
          <ul className="list-disc space-y-0.5 pl-5 text-gray-600">
            {realocadas.map((m) => (
              <li key={m.chave}>
                {m.conta.reduzido} · {m.conta.descricao} ({m.linha.atribuicao}, {m.linha.descricao}): {moeda(m.total)} → {r.aplicadas[m.chave].grupo}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-gray-600">Nenhuma realocação registrada.</p>
      )}
      {fora.length ? (
        <p className="text-gray-600">
          Fora do cenário: {fora.length} {plural(fora.length, "conta", "contas")} ({moeda(somaDe(fora))}).
        </p>
      ) : null}
    </div>
  );
}
