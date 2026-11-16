"use client";

import { useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { toast } from "sonner";

import { BuscaNaLista, type OpcaoDaBusca } from "@/components/shared/BuscaNaLista";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { plural } from "@/lib/texto";

import { botaoPrimario } from "@/app/cenarios/components/CenarioDialog";
import type { ItensSelecionados } from "@/app/competencias/[anoMes]/dre/components/ItensDoMovimentoDialog";
import { moeda } from "@/app/competencias/[anoMes]/utils/formatacao";

import {
  contaCabeNoCentro,
  contestacoesService,
  mensagemDeErro,
  quemResponde,
  ROTULO_DEPARTAMENTO,
  type CentroOpcao,
  type ContaOpcao,
  type ResumoDaCombinacao,
} from "../services/contestacoesService";
import { CentrosDeCustoDialog } from "./CentrosDeCustoDialog";
import { ContasDeResultadoDialog } from "./ContasDeResultadoDialog";
import { RegrasDeRateioDialog } from "./RegrasDeRateioDialog";

const dataCurta = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : null);
const somar = (...xs: string[]) => (xs.reduce((s, x) => s + Math.round(Number(x) * 100), 0) / 100).toFixed(2);
/** As opções das listas com busca: o centro com o grupo da DRE; a conta com o departamento, a atribuição e o balde. */
export const opcaoDoCentro = (c: CentroOpcao): OpcaoDaBusca => ({ id: c.id, codigo: c.codigoRM ?? "—", nome: c.nomeRM, detalhe: c.departamento });
export const opcaoDaConta = (c: ContaOpcao): OpcaoDaBusca => ({
  id: c.id,
  codigo: c.reduzido,
  nome: c.descricao,
  detalhe: [c.departamento, c.atribuicao, c.balde ? `Balde ${c.balde}` : null].filter(Boolean).join(" · ") || null,
});

/** O movimento contestado, como o balancete mostra: o centro e a conta que valem hoje. */
export type MovimentoContestado = {
  id: string;
  filial: number;
  emissao: string | null;
  cliForn: string | null;
  historico: string | null;
  valor: string;
  centro: string | null;
  conta: string;
};

/** As competências das anteriores ou das posteriores, no rótulo da caixa: "(3 competências: 01/2026 a 03/2026)". */
function competenciasDoResumo(r: ResumoDaCombinacao | undefined) {
  if (!r?.competencias.length) return "nenhuma competência";
  const cs = r.competencias.map((c) => c.competencia);
  return `${cs.length} ${plural(cs.length, "competência", "competências")}: ${cs.length > 2 ? `${cs[0]} a ${cs[cs.length - 1]}` : cs.join(" e ")}`;
}

/**
 * O modal Contestar (27/10/2026, pedido do Adão), no balancete de uma conta: o usuário sugere outro centro de custo e/ou
 * outra conta de resultado para o movimento (as listas com o código e o nome, com busca por termos) e, se quiser, o
 * motivo. Os centros são os de um departamento da DRE (só os de código com três níveis, como 1.01.00000001); as contas, as
 * do departamento do centro (o novo; sem ele, o do movimento) e as do Extra-Operacional. Contestar Anteriores e Posteriores (30/10/2026) levam junto os movimentos do mesmo
 * fornecedor, conta e centro de custo nas competências anteriores e nas seguintes (as já importadas), com o total que muda
 * de centro e/ou de conta. A contestação vai para o responsável pelo centro (o novo; sem ele, o de hoje) — ou já fica
 * acatada, quando quem pede é o responsável. Desde 04/11/2026 (pedido do Adão), a lupa ao lado de cada campo abre a lista
 * inteira (os centros de custo; as Contas de Resultado), e clicar num item o escolhe; no canto de baixo, Regras de Rateio (as
 * vigentes no mês do movimento, `anoMes`). Com um centro novo de outro departamento (10/11/2026, pedido do Adão), a conta do
 * movimento não serve: a nova conta, do departamento do centro novo ou do Extra-Operacional, passa a ser obrigatória.
 *
 * Com `itens` (10/11/2026, pedido do Adão: o Contestar Selecionados do modal dos itens), a contestação é só dos itens
 * marcados do movimento: o valor deles muda de centro e/ou de conta (sem as anteriores e as posteriores).
 */
export function ContestarDialog({
  movimento,
  anoMes,
  itens,
  onFechar,
  onCriada,
}: {
  movimento: MovimentoContestado;
  anoMes: string;
  itens?: ItensSelecionados;
  onFechar: () => void;
  onCriada: () => void;
}) {
  const opcoes = useQuery({ queryKey: ["contestacoes", "opcoes"], queryFn: contestacoesService.opcoes, staleTime: 5 * 60_000 });
  const [centro, setCentro] = useState<OpcaoDaBusca | null>(null);
  const [conta, setConta] = useState<OpcaoDaBusca | null>(null);
  const [motivo, setMotivo] = useState("");
  const [anteriores, setAnteriores] = useState(false);
  const [posteriores, setPosteriores] = useState(false);
  const [consulta, setConsulta] = useState<"centros" | "contas" | "rateios" | null>(null);
  const previa = useQuery({
    queryKey: ["contestacoes", "previa", movimento.id, centro?.id ?? null, conta?.id ?? null],
    queryFn: () => contestacoesService.previa({ lancamentoId: movimento.id, centroNovoId: centro?.id ?? null, contaNovaId: conta?.id ?? null }),
    placeholderData: keepPreviousData,
  });
  const p = previa.data;
  const centrosDoCadastro = opcoes.data?.centros ?? [];
  const contasDoCadastro = opcoes.data?.contas ?? [];
  // O departamento que vale para a conta: o do centro novo; sem ele, o do centro do movimento.
  const departamentoDoCentro = centro ? (centrosDoCadastro.find((c) => c.id === centro.id)?.departamentoDoRecorte ?? null) : (p?.departamentoDoCentro ?? null);
  const centros = centrosDoCadastro.map(opcaoDoCentro);
  const contas = contasDoCadastro.filter((c) => contaCabeNoCentro(departamentoDoCentro, c.departamentoDoRecorte)).map(opcaoDaConta);
  const escolherCentro = (o: OpcaoDaBusca | null) => {
    setCentro(o);
    // A conta escolhida que não cabe no departamento do centro novo sai.
    const d = o ? (centrosDoCadastro.find((c) => c.id === o.id)?.departamentoDoRecorte ?? null) : (p?.departamentoDoCentro ?? null);
    const c = conta ? contasDoCadastro.find((x) => x.id === conta.id) : null;
    if (c && !contaCabeNoCentro(d, c.departamentoDoRecorte)) setConta(null);
  };
  // O centro novo de outro departamento com a conta do movimento (10/11/2026): a nova conta é obrigatória.
  const contaObrigatoria = !!centro && !!p && !contaCabeNoCentro(departamentoDoCentro, p.contaDoMovimento.departamento);
  const faltaConta = contaObrigatoria && !conta;
  const ant = p?.anteriores;
  const pos = p?.posteriores;
  const comOutras = (anteriores && !!ant?.movimentos) || (posteriores && !!pos?.movimentos);
  const total = somar(movimento.valor, anteriores && ant ? ant.valor : "0", posteriores && pos ? pos.valor : "0");
  const totalDeMovimentos = 1 + (anteriores ? (ant?.movimentos ?? 0) : 0) + (posteriores ? (pos?.movimentos ?? 0) : 0);
  const totalDeCompetencias = 1 + (anteriores ? (ant?.competencias.length ?? 0) : 0) + (posteriores ? (pos?.competencias.length ?? 0) : 0);
  const enviar = useMutation({
    mutationFn: () =>
      contestacoesService.criar({
        lancamentoId: movimento.id,
        centroNovoId: centro?.id ?? null,
        contaNovaId: conta?.id ?? null,
        motivo: motivo.trim() || null,
        anteriores: !itens && anteriores && !!ant?.movimentos,
        posteriores: !itens && posteriores && !!pos?.movimentos,
        ...(itens ? { itens: itens.itens } : {}),
      }),
    onSuccess: (c) => {
      const quantos = c.itensContestados ? ` (${c.itensContestados} ${plural(c.itensContestados, "item", "itens")})` : c.movimentos.length > 1 ? ` (${c.movimentos.length} movimentos)` : "";
      toast.success(
        c.situacao === "ACATADA"
          ? `Contestação nº ${c.numero}${quantos} acatada: você é o responsável pelo centro de custo. Ela espera a validação da Controladoria.`
          : `Contestação nº ${c.numero}${quantos} enviada ${c.responsaveis.length ? `a ${quemResponde(c)}` : "à Controladoria"}.`.replace(/\.\.$/, "."),
      );
      onCriada();
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível enviar a contestação.")),
  });
  const semCombinacao = p?.semFornecedor ? "O movimento não tem fornecedor: não há anteriores nem posteriores para contestar." : null;
  const caixa = (marcada: boolean, setMarcada: (v: boolean) => void, rotulo: string, r: ResumoDaCombinacao | undefined, id: string) => {
    const vazia = !r?.movimentos;
    const titulo = semCombinacao ?? (vazia ? `Nenhum movimento do mesmo fornecedor, conta e centro de custo nas competências ${id === "ct-anteriores" ? "anteriores" : "seguintes"}.` : undefined);
    return (
      <label className={`inline-flex items-center gap-2 text-sm ${vazia ? "text-gray-400" : "text-gray-800"}`} title={titulo}>
        <input id={id} type="checkbox" className="accent-black" checked={marcada && !vazia} disabled={vazia || !p} onChange={(e) => setMarcada(e.target.checked)} />
        {rotulo}
        <span className="text-gray-500">({r ? `${r.movimentos} ${plural(r.movimentos, "movimento", "movimentos")}, ${competenciasDoResumo(r)}` : "…"})</span>
      </label>
    );
  };
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="rounded-sm sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{itens ? "Contestar os Itens do Movimento" : "Contestar o Movimento"}</DialogTitle>
          <DialogDescription>
            Sugira o novo centro de custo e/ou a nova conta de resultado {itens ? "dos itens marcados (só o valor deles muda; o resto do movimento fica)" : "do movimento"}. A contestação vai para o responsável do novo centro de custo, que a
            acata ou recusa (se em branco, fica o atual). Se acatada, a Controladoria valida e corrige o movimento. Se recusada, a contestação é cancelada, e
            o movimento contábil permanece como está.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-sm border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
          <dt className="text-gray-500">Movimento</dt>
          <dd className="text-gray-900">
            {[dataCurta(movimento.emissao), movimento.cliForn, movimento.historico].filter(Boolean).join(" · ") || "—"} · Filial {movimento.filial} ·{" "}
            <span className="font-semibold">{moeda(movimento.valor)}</span>
          </dd>
          <dt className="text-gray-500">Centro de Custo</dt>
          <dd className="text-gray-900">{movimento.centro ?? "—"}</dd>
          <dt className="text-gray-500">Conta</dt>
          <dd className="text-gray-900">{movimento.conta}</dd>
          {itens ? (
            <>
              <dt className="text-gray-500">Itens</dt>
              <dd className="text-gray-900">
                {itens.quantidade} de {itens.doMovimento} {plural(itens.doMovimento, "item", "itens")} do movimento · Valor a migrar{" "}
                <span className="font-semibold">{moeda(itens.valor)}</span>
              </dd>
            </>
          ) : null}
        </dl>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ct-centro">Novo Centro de Custo</Label>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <BuscaNaLista id="ct-centro" opcoes={centros} valor={centro} onEscolher={escolherCentro} placeholder="Código ou nome do centro de custo" />
              </div>
              <Button type="button" variant="outline" size="icon" className="shrink-0 rounded-sm" disabled={!opcoes.data} onClick={() => setConsulta("centros")} aria-label="Ver todos os centros de custo e escolher um" title="Ver todos os centros de custo e escolher um">
                <Search className="size-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ct-conta">
              Nova Conta de Resultado
              {departamentoDoCentro ? <span className="ml-1 font-normal text-gray-500">({ROTULO_DEPARTAMENTO[departamentoDoCentro]} e Extra-Operacional)</span> : null}
            </Label>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <BuscaNaLista id="ct-conta" opcoes={contas} valor={conta} onEscolher={setConta} placeholder="Código ou nome da conta" />
              </div>
              <Button type="button" variant="outline" size="icon" className="shrink-0 rounded-sm" disabled={!opcoes.data} onClick={() => setConsulta("contas")} aria-label="Ver todas as contas de resultado e escolher uma" title="Ver todas as contas de resultado e escolher uma">
                <Search className="size-4" />
              </Button>
            </div>
            {faltaConta && p && departamentoDoCentro ? (
              <p className="text-xs text-red-700">
                A conta do movimento ({p.contaDoMovimento.reduzido} · {p.contaDoMovimento.descricao}) é{" "}
                {p.contaDoMovimento.departamento ? `do departamento ${ROTULO_DEPARTAMENTO[p.contaDoMovimento.departamento]}` : "de fora dos departamentos da DRE"}: com um centro de custo do
                departamento {ROTULO_DEPARTAMENTO[departamentoDoCentro]}, escolha também a nova conta de resultado.
              </p>
            ) : null}
          </div>
          <div className={itens ? "hidden" : "space-y-1.5"}>
            {caixa(anteriores, setAnteriores, "Contestar Anteriores", ant, "ct-anteriores")}
            {caixa(posteriores, setPosteriores, "Contestar Posteriores", pos, "ct-posteriores")}
            {p && (p.emAndamento || p.foraDoAcesso) ? (
              <p className="text-xs text-gray-500">
                {[
                  p.emAndamento ? `${p.emAndamento} ${plural(p.emAndamento, "movimento já tem", "movimentos já têm")} uma contestação em andamento` : null,
                  p.foraDoAcesso ? `${p.foraDoAcesso} ${plural(p.foraDoAcesso, "está", "estão")} fora do seu acesso` : null,
                ]
                  .filter(Boolean)
                  .join("; ")}{" "}
                e {plural((p.emAndamento ?? 0) + (p.foraDoAcesso ?? 0), "fica", "ficam")} de fora.
              </p>
            ) : null}
            {comOutras ? (
              <div className="rounded-sm border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                <p>
                  {totalDeMovimentos.toLocaleString("pt-BR")} {plural(totalDeMovimentos, "movimento", "movimentos")} em {totalDeCompetencias}{" "}
                  {plural(totalDeCompetencias, "competência", "competências")} · Total a migrar <span className="font-bold text-gray-900">{moeda(total)}</span>
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-gray-500">
                  {anteriores && ant?.movimentos
                    ? ant.competencias.map((c) => (
                        <li key={c.competencia} className="flex justify-between gap-3">
                          <span>
                            {c.competencia} · {c.movimentos} {plural(c.movimentos, "movimento", "movimentos")}
                          </span>
                          <span>{moeda(c.valor)}</span>
                        </li>
                      ))
                    : null}
                  <li className="flex justify-between gap-3 font-medium text-gray-700">
                    <span>Este movimento</span>
                    <span>{moeda(movimento.valor)}</span>
                  </li>
                  {posteriores && pos?.movimentos
                    ? pos.competencias.map((c) => (
                        <li key={c.competencia} className="flex justify-between gap-3">
                          <span>
                            {c.competencia} · {c.movimentos} {plural(c.movimentos, "movimento", "movimentos")}
                          </span>
                          <span>{moeda(c.valor)}</span>
                        </li>
                      ))
                    : null}
                </ul>
              </div>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ct-motivo">Motivo (opcional)</Label>
            <textarea
              id="ct-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              maxLength={500}
              rows={3}
              className="w-full rounded-sm border border-gray-300 px-3 py-2 text-sm"
              placeholder="Por que o movimento é de outro centro ou de outra conta"
            />
          </div>
        </div>
        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="outline" className="rounded-sm" onClick={() => setConsulta("rateios")} title="As Regras de Rateio vigentes no mês do movimento">
            Regras de Rateio
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
              Cancelar
            </Button>
            <Button type="button" className={botaoPrimario} disabled={(!centro && !conta) || faltaConta || enviar.isPending}
              onClick={() => enviar.mutate()}
              title={!centro && !conta ? "Escolha o novo centro de custo e/ou a nova conta" : faltaConta ? "Escolha a nova conta: a do movimento não é do departamento do novo centro de custo" : undefined}
            >
              {enviar.isPending ? "Enviando…" : "Contestar"}
            </Button>
          </div>
        </DialogFooter>
        {consulta === "centros" ? (
          <CentrosDeCustoDialog
            centros={centrosDoCadastro}
            onEscolher={(c) => {
              escolherCentro(opcaoDoCentro(c));
              setConsulta(null);
            }}
            onFechar={() => setConsulta(null)}
          />
        ) : null}
        {consulta === "contas" ? (
          <ContasDeResultadoDialog
            contas={contasDoCadastro}
            departamentoDoCentro={departamentoDoCentro}
            onEscolher={(c) => {
              setConta(opcaoDaConta(c));
              setConsulta(null);
            }}
            onFechar={() => setConsulta(null)}
          />
        ) : null}
        {consulta === "rateios" ? <RegrasDeRateioDialog anoMes={anoMes} onFechar={() => setConsulta(null)} /> : null}
      </DialogContent>
    </Dialog>
  );
}
