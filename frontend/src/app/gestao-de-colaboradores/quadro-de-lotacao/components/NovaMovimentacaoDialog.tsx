"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { botaoPrimario } from "@/app/cenarios/components/CenarioDialog";
import { mensagemDeErro } from "@/app/cadastros/services/edicaoService";

import { quadroService, ROTULO_ORIGEM, type NovaMovimentacao } from "../../services/quadroService";
import { rotuloDoMes } from "./CabecalhoDoQuadro";

const classeSelect = "h-9 w-full rounded-sm border border-gray-300 bg-white px-3 text-sm";

/** A data padrão: hoje, se for do mês da competência; senão, o primeiro dia dele. */
function dataPadrao(anoMes: string) {
  const hoje = new Date();
  const local = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  return local.startsWith(anoMes) ? local : `${anoMes}-01`;
}

function Campo({ id, rotulo, obrigatorio, children, largo }: { id: string; rotulo: string; obrigatorio?: boolean; children: React.ReactNode; largo?: boolean }) {
  return (
    <div className={`space-y-1.5 ${largo ? "sm:col-span-2" : ""}`}>
      <Label htmlFor={id}>
        {rotulo}
        {obrigatorio ? <span className="text-red-700"> *</span> : null}
      </Label>
      {children}
    </div>
  );
}

/**
 * O modal Nova Movimentação (06/11/2026): a Classificação (que escolhe também a movimentação) ou a Movimentação, a data
 * (hoje, por padrão), o centro de custo, o tipo (CLT ou PJ), a função, o nível (o da função, por padrão), o motivo e, num
 * desligamento (contagem Negativa), a Origem e a caixa "Gerar Vaga em Aberto", marcada.
 */
export function NovaMovimentacaoDialog({ anoMes, onFechar }: { anoMes: string; onFechar: () => void }) {
  const queryClient = useQueryClient();
  const opcoes = useQuery({ queryKey: ["quadro", "opcoes"], queryFn: quadroService.opcoes });
  const [v, setV] = useState<NovaMovimentacao>({
    tipoMovimentacaoId: "",
    classificacaoId: null,
    data: dataPadrao(anoMes),
    centroCustoId: "",
    vinculo: "CLT",
    funcaoId: "",
    senioridadeId: "",
    motivo: null,
    origem: null,
    gerarVaga: true,
  });
  const muda = (parte: Partial<NovaMovimentacao>) => setV((x) => ({ ...x, ...parte }));
  const o = opcoes.data;
  const tipo = o?.tipos.find((t) => t.id === v.tipoMovimentacaoId);
  const desligamento = tipo?.contagem === "NEGATIVA";
  const nomeDoTipo = (id: string) => o?.tipos.find((t) => t.id === id)?.nome ?? "";
  // As classificações do tipo escolhido; sem tipo, todas, com o tipo ao lado (escolher uma escolhe o tipo).
  const classificacoes = (o?.classificacoes ?? []).filter((c) => !v.tipoMovimentacaoId || c.tipoMovimentacaoId === v.tipoMovimentacaoId);

  const registrar = useMutation({
    mutationFn: () => quadroService.registrar(anoMes, { ...v, origem: desligamento ? v.origem : null, gerarVaga: desligamento && v.gerarVaga }),
    onSuccess: () => {
      toast.success(
        tipo?.aprovacao === "MANUAL"
          ? "Movimentação registrada como Pendente: aguarda a aprovação no Controle."
          : `Movimentação registrada e aprovada${desligamento && v.gerarVaga ? ", com a vaga em aberto" : ""}.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["quadro"] });
      onFechar();
    },
  });
  const completo = v.tipoMovimentacaoId && v.data && v.centroCustoId && v.funcaoId && v.senioridadeId && (!desligamento || v.origem);

  return (
    <Dialog open onOpenChange={(aberto) => (!aberto ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="max-h-[90vh] overflow-y-auto rounded-sm sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nova Movimentação</DialogTitle>
          <DialogDescription>
            A movimentação de {rotuloDoMes(anoMes)}. Com o modelo de aprovação Manual, ela fica Pendente até ser aprovada no Controle; com o Automático, vale
            ao gravar.
          </DialogDescription>
        </DialogHeader>
        {opcoes.isPending ? (
          <div className="h-40 animate-pulse rounded-sm bg-gray-100" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id="mov-classificacao" rotulo="Classificação">
              <select
                id="mov-classificacao"
                value={v.classificacaoId ?? ""}
                onChange={(e) => {
                  const c = o?.classificacoes.find((x) => x.id === e.target.value);
                  muda({ classificacaoId: c?.id ?? null, ...(c ? { tipoMovimentacaoId: c.tipoMovimentacaoId } : {}) });
                }}
                className={classeSelect}
              >
                <option value="">—</option>
                {classificacoes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {v.tipoMovimentacaoId ? c.nome : `${c.nome} (${nomeDoTipo(c.tipoMovimentacaoId)})`}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo id="mov-tipo" rotulo="Tipo de Movimentação" obrigatorio>
              <select
                id="mov-tipo"
                value={v.tipoMovimentacaoId}
                onChange={(e) => {
                  const classificacao = o?.classificacoes.find((c) => c.id === v.classificacaoId);
                  muda({ tipoMovimentacaoId: e.target.value, classificacaoId: classificacao?.tipoMovimentacaoId === e.target.value ? v.classificacaoId : null });
                }}
                className={classeSelect}
              >
                <option value="">Escolha…</option>
                {o?.tipos.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo id="mov-data" rotulo="Data da Movimentação" obrigatorio>
              <Input id="mov-data" type="date" value={v.data} min={`${anoMes}-01`} max={`${anoMes}-31`} onChange={(e) => muda({ data: e.target.value })} className="rounded-sm" />
            </Campo>
            <Campo id="mov-vinculo" rotulo="Tipo" obrigatorio>
              <select id="mov-vinculo" value={v.vinculo} onChange={(e) => muda({ vinculo: e.target.value as "CLT" | "PJ" })} className={classeSelect}>
                <option value="CLT">CLT</option>
                <option value="PJ">PJ</option>
              </select>
            </Campo>
            <Campo id="mov-centro" rotulo="Centro de Custo" obrigatorio largo>
              <select id="mov-centro" value={v.centroCustoId} onChange={(e) => muda({ centroCustoId: e.target.value })} className={classeSelect}>
                <option value="">Escolha…</option>
                {o?.centros.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo id="mov-funcao" rotulo="Função" obrigatorio>
              <select
                id="mov-funcao"
                value={v.funcaoId}
                onChange={(e) => {
                  // O nível da função, quando ela tem um.
                  const f = o?.funcoes.find((x) => x.id === e.target.value);
                  muda({ funcaoId: e.target.value, ...(f?.senioridadeId && o?.senioridades.some((s) => s.id === f.senioridadeId) ? { senioridadeId: f.senioridadeId } : {}) });
                }}
                className={classeSelect}
              >
                <option value="">Escolha…</option>
                {o?.funcoes.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo id="mov-nivel" rotulo="Nível" obrigatorio>
              <select id="mov-nivel" value={v.senioridadeId} onChange={(e) => muda({ senioridadeId: e.target.value })} className={classeSelect}>
                <option value="">Escolha…</option>
                {o?.senioridades.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo id="mov-motivo" rotulo="Motivo da Movimentação" largo>
              <textarea
                id="mov-motivo"
                rows={3}
                value={v.motivo ?? ""}
                onChange={(e) => muda({ motivo: e.target.value })}
                className="w-full rounded-sm border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              />
            </Campo>
            {desligamento ? (
              <>
                <Campo id="mov-origem" rotulo="Origem" obrigatorio>
                  <select
                    id="mov-origem"
                    value={v.origem ?? ""}
                    onChange={(e) => muda({ origem: (e.target.value || null) as NovaMovimentacao["origem"] })}
                    className={classeSelect}
                  >
                    <option value="">Escolha…</option>
                    {Object.entries(ROTULO_ORIGEM).map(([valor, rotulo]) => (
                      <option key={valor} value={valor}>
                        {rotulo}
                      </option>
                    ))}
                  </select>
                </Campo>
                <label className="flex items-center gap-2 self-end pb-2 text-sm text-gray-900 sm:col-span-2">
                  <input type="checkbox" checked={v.gerarVaga} onChange={(e) => muda({ gerarVaga: e.target.checked })} className="size-4 accent-black" />
                  Gerar Vaga em Aberto
                  <span className="text-xs text-gray-500">(uma Abertura de Vaga com os mesmos dados, já aprovada)</span>
                </label>
              </>
            ) : null}
          </div>
        )}
        {registrar.isError ? <p className="text-sm text-red-700">{mensagemDeErro(registrar.error, "Não foi possível registrar a movimentação.")}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={!completo || registrar.isPending} onClick={() => registrar.mutate()}>
            {registrar.isPending ? "Gravando…" : "Gravar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
