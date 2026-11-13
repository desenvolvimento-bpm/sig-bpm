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
import { opcoesDeFuncao } from "../../services/funcaoPorSenioridade";
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
 * O modal Nova Movimentação (06/11/2026): o Tipo de Movimentação e a Classificação (13/11/2026, pedido do Adão: o tipo
 * primeiro, e a lista da Classificação só com as do tipo), a data (hoje, por padrão), o centro de custo, o tipo (CLT ou PJ), a
 * função (com a senioridade ao lado: a mesma função tem uma por senioridade; 13/11/2026: sem o campo Senioridade, a
 * movimentação leva a da função), o motivo e, num desligamento (contagem Negativa), a Origem e, ao lado dela, a caixa "Gerar
 * Vaga em Aberto", marcada.
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
    motivo: null,
    origem: null,
    gerarVaga: true,
  });
  const muda = (parte: Partial<NovaMovimentacao>) => setV((x) => ({ ...x, ...parte }));
  const o = opcoes.data;
  const tipo = o?.tipos.find((t) => t.id === v.tipoMovimentacaoId);
  const desligamento = tipo?.contagem === "NEGATIVA";
  // As classificações do tipo escolhido (sem o tipo, nenhuma).
  const classificacoes = (o?.classificacoes ?? []).filter((c) => !!v.tipoMovimentacaoId && c.tipoMovimentacaoId === v.tipoMovimentacaoId);

  const registrar = useMutation({
    mutationFn: () => quadroService.registrar(anoMes, { ...v, origem: desligamento ? v.origem : null, gerarVaga: desligamento && v.gerarVaga }),
    onSuccess: () => {
      toast.success(
        tipo?.aprovacao === "MANUAL"
          ? "Movimentação registrada como Pendente: aguarda a aprovação na aba Aprovações."
          : `Movimentação registrada e aprovada${desligamento && v.gerarVaga ? ", com a vaga em aberto" : ""}.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["quadro"] });
      onFechar();
    },
  });
  // A senioridade é a da função: a função sem senioridade no cadastro não serve.
  const funcao = o?.funcoes.find((f) => f.id === v.funcaoId);
  const funcaoSemSenioridade = !!funcao && !funcao.senioridadeId;
  const completo = v.tipoMovimentacaoId && v.data && v.centroCustoId && v.funcaoId && !funcaoSemSenioridade && (!desligamento || v.origem);

  return (
    <Dialog open onOpenChange={(aberto) => (!aberto ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="max-h-[90vh] overflow-y-auto rounded-sm sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nova Movimentação</DialogTitle>
          <DialogDescription>
            A movimentação de {rotuloDoMes(anoMes)}. Com o modelo de aprovação Manual, ela fica Pendente até ser aprovada na aba Aprovações; com o Automático, vale
            ao gravar.
          </DialogDescription>
        </DialogHeader>
        {opcoes.isPending ? (
          <div className="h-40 animate-pulse rounded-sm bg-gray-100" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id="mov-tipo" rotulo="Tipo de Movimentação" obrigatorio>
              <select
                id="mov-tipo"
                value={v.tipoMovimentacaoId}
                onChange={(e) => {
                  // A classificação fica só se for do tipo novo.
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
            <Campo id="mov-classificacao" rotulo="Classificação">
              <select
                id="mov-classificacao"
                value={v.classificacaoId ?? ""}
                onChange={(e) => muda({ classificacaoId: e.target.value || null })}
                disabled={!v.tipoMovimentacaoId || !classificacoes.length}
                className={`${classeSelect} disabled:bg-gray-50 disabled:text-gray-500`}
              >
                <option value="">{!v.tipoMovimentacaoId ? "Escolha o tipo antes" : classificacoes.length ? "—" : "Nenhuma para este tipo"}</option>
                {classificacoes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
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
            <Campo id="mov-funcao" rotulo="Função" obrigatorio largo>
              <select id="mov-funcao" value={v.funcaoId} onChange={(e) => muda({ funcaoId: e.target.value })} className={classeSelect}>
                <option value="">Escolha…</option>
                {/* A função com a senioridade ao lado ("Conferente · Pleno"): a movimentação leva a senioridade da função. */}
                {opcoesDeFuncao(o?.funcoes ?? [], o?.senioridades ?? [], "").map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome}
                  </option>
                ))}
              </select>
              {funcaoSemSenioridade ? (
                <p className="text-xs text-red-700">A função não tem senioridade no cadastro: cadastre-a com a senioridade em Cadastros › Funções.</p>
              ) : null}
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
                {/* Ao lado da Origem, com a explicação na linha de baixo. */}
                <label className="flex items-start gap-2 self-end text-sm text-gray-900">
                  <input type="checkbox" checked={v.gerarVaga} onChange={(e) => muda({ gerarVaga: e.target.checked })} className="mt-0.5 size-4 shrink-0 accent-black" />
                  <span>
                    Gerar Vaga em Aberto
                    <span className="block text-xs text-gray-500">Uma Abertura de Vaga com os mesmos dados, já aprovada.</span>
                  </span>
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
