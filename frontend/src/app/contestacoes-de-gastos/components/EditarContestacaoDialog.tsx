"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { toast } from "sonner";

import { BuscaNaLista, type OpcaoDaBusca } from "@/components/shared/BuscaNaLista";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

import { botaoPrimario } from "@/app/cenarios/components/CenarioDialog";
import { moeda } from "@/app/competencias/[anoMes]/utils/formatacao";

import { contaCabeNoCentro, contestacoesService, mensagemDeErro, ROTULO_DEPARTAMENTO, ROTULO_SITUACAO, type Contestacao } from "../services/contestacoesService";
import { CentrosDeCustoDialog } from "./CentrosDeCustoDialog";
import { ContasDeResultadoDialog } from "./ContasDeResultadoDialog";
import { opcaoDaConta, opcaoDoCentro } from "./ContestarDialog";

const dataCurta = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : null);

/**
 * Editar a Contestação (10/11/2026, pedido do Adão; o menu Ações da tela Validações): a Controladoria troca o centro de custo
 * e/ou a conta de resultado novos de uma contestação pendente ou acatada, sem movimento corrigido. As listas e as regras são as
 * do Contestar: os centros de um departamento da DRE; as contas do departamento do centro (o novo; sem ele, o de antes) e as do
 * Extra-Operacional; com um centro novo de outro departamento, a conta de antes não serve, e a nova conta é obrigatória. A
 * situação não muda; a Auditoria guarda o antes e o depois.
 */
export function EditarContestacaoDialog({ c, onFechar, onEditada }: { c: Contestacao; onFechar: () => void; onEditada: () => void }) {
  const opcoes = useQuery({ queryKey: ["contestacoes", "opcoes"], queryFn: contestacoesService.opcoes, staleTime: 5 * 60_000 });
  const centrosDoCadastro = opcoes.data?.centros ?? [];
  const contasDoCadastro = opcoes.data?.contas ?? [];
  const e = c.edicao;
  // De início, o centro e a conta novos de hoje (quando as opções chegam).
  const [escolha, setEscolha] = useState<{ centro: OpcaoDaBusca | null; conta: OpcaoDaBusca | null } | null>(null);
  const inicial = {
    centro: e.centroNovoId ? (centrosDoCadastro.map(opcaoDoCentro).find((o) => o.id === e.centroNovoId) ?? null) : null,
    conta: e.contaNovaId ? (contasDoCadastro.map(opcaoDaConta).find((o) => o.id === e.contaNovaId) ?? null) : null,
  };
  const { centro, conta } = escolha ?? inicial;
  const [consulta, setConsulta] = useState<"centros" | "contas" | null>(null);
  const departamentoDe = (o: OpcaoDaBusca | null) => (o ? (centrosDoCadastro.find((x) => x.id === o.id)?.departamentoDoRecorte ?? null) : e.departamentoDoCentroAntes);
  const departamentoDoCentro = departamentoDe(centro);
  const contas = contasDoCadastro.filter((x) => contaCabeNoCentro(departamentoDoCentro, x.departamentoDoRecorte)).map(opcaoDaConta);
  const escolherCentro = (o: OpcaoDaBusca | null) => {
    // A conta escolhida que não cabe no departamento do centro novo sai.
    const x = conta ? contasDoCadastro.find((y) => y.id === conta.id) : null;
    setEscolha({ centro: o, conta: x && !contaCabeNoCentro(departamentoDe(o), x.departamentoDoRecorte) ? null : conta });
  };
  const escolherConta = (o: OpcaoDaBusca | null) => setEscolha({ centro, conta: o });
  // O centro novo de outro departamento com a conta de antes: a nova conta é obrigatória.
  const faltaConta = !!centro && !conta && !contaCabeNoCentro(departamentoDoCentro, e.departamentoDaContaAntes);
  const semDestino = !centro && !conta;
  const igual = (centro?.id ?? null) === e.centroNovoId && (conta?.id ?? null) === e.contaNovaId;
  const motivoDoBotao = semDestino
    ? "Escolha o novo centro de custo e/ou a nova conta"
    : faltaConta
      ? "Escolha a nova conta: a de antes não é do departamento do novo centro de custo"
      : igual
        ? "Nada mudou"
        : undefined;
  const gravar = useMutation({
    mutationFn: () => contestacoesService.editar(c.id, { centroNovoId: centro?.id ?? null, contaNovaId: conta?.id ?? null }),
    onSuccess: (x) => {
      toast.success(`Contestação nº ${x.numero} alterada.`);
      onEditada();
    },
    onError: (err) => toast.error(mensagemDeErro(err, "Não foi possível alterar a contestação.")),
  });

  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent avisoAoSair={!igual} className="rounded-sm sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Editar a Contestação nº {c.numero}</DialogTitle>
          <DialogDescription>
            Troque o novo centro de custo e/ou a nova conta de resultado da contestação ({ROTULO_SITUACAO[c.situacao].toLowerCase()}). A situação não muda; a
            alteração fica na Auditoria.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-sm border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
          <dt className="text-gray-500">Movimento</dt>
          <dd className="text-gray-900">
            {[dataCurta(c.emissao), c.cliForn, c.historico].filter(Boolean).join(" · ") || "—"} · Filial {c.filial} · <span className="font-semibold">{moeda(c.valor)}</span>
            {c.movimentos.length > 1 ? <span className="text-gray-500"> em {c.movimentos.length} movimentos</span> : null}
          </dd>
          <dt className="text-gray-500">Centro de Custo</dt>
          <dd className="text-gray-900">{c.centroAntes ?? "—"}</dd>
          <dt className="text-gray-500">Conta</dt>
          <dd className="text-gray-900">{c.contaAntes ?? "—"}</dd>
        </dl>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ed-centro">Novo Centro de Custo</Label>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <BuscaNaLista id="ed-centro" opcoes={centrosDoCadastro.map(opcaoDoCentro)} valor={centro} onEscolher={escolherCentro} placeholder="Código ou nome do centro de custo" />
              </div>
              <Button type="button" variant="outline" size="icon" className="shrink-0 rounded-sm" disabled={!opcoes.data} onClick={() => setConsulta("centros")} aria-label="Ver todos os centros de custo e escolher um" title="Ver todos os centros de custo e escolher um">
                <Search className="size-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ed-conta">
              Nova Conta de Resultado
              {departamentoDoCentro ? <span className="ml-1 font-normal text-gray-500">({ROTULO_DEPARTAMENTO[departamentoDoCentro]} e Extra-Operacional)</span> : null}
            </Label>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <BuscaNaLista id="ed-conta" opcoes={contas} valor={conta} onEscolher={escolherConta} placeholder="Código ou nome da conta" />
              </div>
              <Button type="button" variant="outline" size="icon" className="shrink-0 rounded-sm" disabled={!opcoes.data} onClick={() => setConsulta("contas")} aria-label="Ver todas as contas de resultado e escolher uma" title="Ver todas as contas de resultado e escolher uma">
                <Search className="size-4" />
              </Button>
            </div>
            {faltaConta && departamentoDoCentro ? (
              <p className="text-xs text-red-700">
                A conta de antes ({c.contaAntes ?? "—"}) é {e.departamentoDaContaAntes ? `do departamento ${ROTULO_DEPARTAMENTO[e.departamentoDaContaAntes]}` : "de fora dos departamentos da DRE"}: com um
                centro de custo do departamento {ROTULO_DEPARTAMENTO[departamentoDoCentro]}, escolha também a nova conta de resultado.
              </p>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={!!motivoDoBotao || gravar.isPending} title={motivoDoBotao} onClick={() => gravar.mutate()}>
            {gravar.isPending ? "Gravando…" : "Gravar"}
          </Button>
        </DialogFooter>
        {consulta === "centros" ? (
          <CentrosDeCustoDialog
            centros={centrosDoCadastro}
            onEscolher={(x) => {
              escolherCentro(opcaoDoCentro(x));
              setConsulta(null);
            }}
            onFechar={() => setConsulta(null)}
          />
        ) : null}
        {consulta === "contas" ? (
          <ContasDeResultadoDialog
            contas={contasDoCadastro}
            departamentoDoCentro={departamentoDoCentro}
            onEscolher={(x) => {
              escolherConta(opcaoDaConta(x));
              setConsulta(null);
            }}
            onFechar={() => setConsulta(null)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
