"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmacaoDialog } from "@/components/shared/ConfirmacaoDialog";
import { ExportarTabela } from "@/components/shared/ExportarTabela";
import { SemResultado, useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Coluna } from "@/lib/filtrosDeTabela";

import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";

import { cenariosService, type ConjuntoFixoDoCenario, type RegraDoCenario, type RegrasDoCenario } from "../services/cenariosService";
import { useTrazerNovos } from "./CadastrosDoCenario";
import { botaoPrimario, classeSelect, Erro } from "./CenarioDialog";
import { Destaque, LinhaVazia, TabelaComDestaque, TD } from "./DestaqueDaAba";
import { lerNumero } from "./EdicaoDialogs";

/**
 * A aba Regras de Rateio das Configurações dos cenários analíticos (21/11/2026, pedido do Adão: a cópia funcional da tela Cadastros
 * Gerais / Regras de Rateio, logo depois de Centros de Custo): as regras com que o cenário calcula os rateios, no lugar das de
 * Cadastros Gerais. "Novo Rateio" inclui uma regra Paramétrica (a chave, o destino — a linha dos Totais das Listas — e a vigência; o
 * percentual sai das bases das premissas do cenário) ou um conjunto Fixo (os percentuais dos quatro destinos da chave, somando
 * 100%); o clique numa regra abre a paramétrica, ou o conjunto fixo dela. "Trazer Novos" inclui as regras que surgiram em
 * Cadastros Gerais. Cada mudança deixa a DRE do cenário pendente de recálculo (21/11/2026) e fica no Histórico.
 */

const dataBR = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");
const pct = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const textoDe = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 4 });

const COLUNAS: Coluna<RegraDoCenario>[] = [
  { chave: "rotulo", rotulo: "Rótulo", valor: (r) => r.rotulo },
  { chave: "chave", rotulo: "Chave", valor: (r) => r.chaveNome },
  { chave: "destino", rotulo: "Destino", valor: (r) => (r.percentualFixo === null ? r.origemDoVolumeNome : r.destinoNome) },
  { chave: "inicio", rotulo: "Início", tipo: "data", valor: (r) => r.inicio, texto: (r) => dataBR(r.inicio) },
  { chave: "fim", rotulo: "Fim", tipo: "data", valor: (r) => r.fim, texto: (r) => dataBR(r.fim) },
  { chave: "fixo", rotulo: "% Fixo", tipo: "numero", alinhamento: "direita", valor: (r) => r.percentualFixo, texto: (r) => (r.percentualFixo === null ? "" : pct(r.percentualFixo)) },
  { chave: "origem", rotulo: "Origem", valor: (r) => (r.doCenario ? "Só no cenário" : "Cadastros Gerais") },
];
const LARGURAS = [330, 160, 300, 120, 120, 110, 150];

type Aberto = { tipo: "novo" } | { tipo: "parametrica"; regra: RegraDoCenario } | { tipo: "fixo"; conjunto: ConjuntoFixoDoCenario };

export function RegrasDoCenarioAba({ id, podeEditar }: { id: string; podeEditar: boolean }) {
  const consulta = useQuery({ queryKey: ["cenarios", id, "cadastros", "regras"], queryFn: () => cenariosService.regrasDoCenario(id) });
  const [aberto, setAberto] = useState<Aberto | null>(null);
  const trazerNovos = useTrazerNovos(id);
  const tabela = useTabelaFiltravel(consulta.data?.regras, COLUNAS);
  if (consulta.isError) return <Erro erro={mensagemDeErro(consulta.error, "Erro ao carregar as regras de rateio do cenário.")} />;
  if (consulta.isPending) return <div className="h-64 animate-pulse rounded-sm bg-gray-100" />;
  const dados = consulta.data;
  const pode = podeEditar && dados.editavel;
  const abrir = (r: RegraDoCenario) => {
    if (r.percentualFixo === null) return setAberto({ tipo: "parametrica", regra: r });
    const conjunto = dados.conjuntos.find((c) => c.chave === r.chave && c.inicio === r.inicio);
    if (conjunto) setAberto({ tipo: "fixo", conjunto });
  };
  const destaque = (
    <Destaque
      titulo="Regras de Rateio"
      descricao="A cópia das regras de rateio neste cenário: o cálculo dos rateios do cenário usa estas regras, no lugar das de Cadastros Gerais. Rateios com a mesma chave não podem ter vigências sobrepostas."
      abaixo={
        dados.avisos.length ? (
          <ul className="space-y-0.5 text-xs text-red-700">
            {dados.avisos.map((a) => (
              <li key={a} className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {a}
              </li>
            ))}
          </ul>
        ) : null
      }
    >
      {pode ? (
        <>
          {trazerNovos.botao}
          <Button type="button" className={botaoPrimario} onClick={() => setAberto({ tipo: "novo" })}>
            <Plus className="size-4" />
            Novo Rateio
          </Button>
        </>
      ) : null}
      <ExportarTabela titulo="Cenário · Configurações · Regras de Rateio" colunas={COLUNAS} linhas={tabela.filtradas} />
    </Destaque>
  );
  return (
    <>
      <TabelaComDestaque
        destaque={destaque}
        larguras={LARGURAS}
        cabecalho={tabela.linhaDoCabecalho}
        corpo={
          dados.regras.length === 0 ? (
            <LinhaVazia colunas={COLUNAS.length} texto="Nenhuma regra de rateio no cenário." />
          ) : tabela.visiveis.length === 0 ? (
            <SemResultado colunas={COLUNAS.length} onLimpar={tabela.limpar} />
          ) : (
            tabela.visiveis.map((r) => (
              <tr
                key={r.id}
                className={`border-t border-gray-100 ${pode ? "cursor-pointer hover:bg-gray-100" : ""}`}
                onClick={pode ? () => abrir(r) : undefined}
                title={pode ? (r.percentualFixo === null ? "Editar a regra no cenário" : "Editar os percentuais fixos da chave neste período") : undefined}
              >
                <td className={`${TD} font-medium`} title={r.rotulo}>
                  {r.rotulo}
                </td>
                <td className={TD}>{r.chaveNome}</td>
                <td className={TD} title={r.percentualFixo === null ? r.origemDoVolumeNome : r.destinoNome}>
                  {r.percentualFixo === null ? r.origemDoVolumeNome : r.destinoNome}
                </td>
                <td className={TD}>{dataBR(r.inicio)}</td>
                <td className={TD}>{dataBR(r.fim) || "—"}</td>
                <td className={`${TD} text-right`}>{r.percentualFixo === null ? "—" : pct(r.percentualFixo)}</td>
                <td className={TD}>{r.doCenario ? "Só no cenário" : "Cadastros Gerais"}</td>
              </tr>
            ))
          )
        }
      />
      {trazerNovos.dialogo}
      {aberto ? <RegraDialog id={id} dados={dados} aberto={aberto} onFechar={() => setAberto(null)} /> : null}
    </>
  );
}

type Tipo = "PARAMETRICO" | "FIXO";

/**
 * O modal de uma regra do cenário: o Novo Rateio (o Rótulo e o Tipo — Paramétrico ou Fixo —, a Chave, o Destino ou os percentuais
 * dos destinos, e a Vigência), a regra paramétrica (o Rótulo, o Destino e a Vigência; a chave não muda) ou o conjunto fixo (os
 * percentuais, a Vigência e a base do Rótulo). "Excluir" tira a regra (ou o conjunto) do cenário, depois da confirmação.
 */
function RegraDialog({ id, dados, aberto, onFechar }: { id: string; dados: RegrasDoCenario; aberto: Aberto; onFechar: () => void }) {
  const queryClient = useQueryClient();
  const regra = aberto.tipo === "parametrica" ? aberto.regra : null;
  const conjunto = aberto.tipo === "fixo" ? aberto.conjunto : null;
  const [tipo, setTipo] = useState<Tipo>(conjunto ? "FIXO" : "PARAMETRICO");
  const [rotulo, setRotulo] = useState(regra?.rotulo ?? conjunto?.rotulo ?? "");
  const [chave, setChave] = useState(regra?.chave ?? conjunto?.chave ?? dados.opcoes.chaves[0]?.chave ?? "");
  const [destino, setDestino] = useState(regra?.origemDoVolume ?? "");
  const [inicio, setInicio] = useState(regra?.inicio ?? conjunto?.inicio ?? "");
  const [fim, setFim] = useState(regra?.fim ?? conjunto?.fim ?? "");
  const [textos, setTextos] = useState<Record<string, string>>(() => (conjunto ? Object.fromEntries(Object.entries(conjunto.percentuais).map(([d, v]) => [d, textoDe(v)])) : {}));
  const [excluindo, setExcluindo] = useState(false);
  const daChave = dados.opcoes.chaves.find((c) => c.chave === chave);
  const destinoAtual = daChave?.destinos.some((d) => d.codigo === destino) ? destino : (daChave?.destinos[0]?.codigo ?? "");
  const valores = (daChave?.fixos ?? []).map((f) => ({ ...f, valor: lerNumero(textos[f.destino] ?? "") }));
  const soma = valores.reduce((s, v) => s + (typeof v.valor === "number" ? v.valor : 0), 0);
  const percentualRuim = valores.some((v) => v.valor === undefined || (typeof v.valor === "number" && (v.valor < 0 || v.valor > 100)));
  const somaCerta = Math.abs(soma - 100) <= 0.005;
  const vigenciaOk = !!inicio && (!fim || fim >= inicio);
  const pronto = vigenciaOk && !!chave && (tipo === "PARAMETRICO" ? !!rotulo.trim() && !!destinoAtual : !percentualRuim && somaCerta);
  const concluir = (mensagem: string) => {
    // A DRE do cenário ficou pendente de recálculo: as telas do cenário (e o destaque dos Resultados) se atualizam.
    queryClient.invalidateQueries({ queryKey: ["cenarios"] });
    toast.success(mensagem);
    onFechar();
  };
  const gravar = useMutation({
    mutationFn: () =>
      tipo === "PARAMETRICO"
        ? cenariosService.gravarRegraDoCenario(id, regra?.id ?? null, { rotulo: rotulo.trim(), chave, origemDoVolume: destinoAtual, inicio, fim: fim || null })
        : cenariosService.gravarFixosDoCenario(id, {
            chave,
            inicioAnterior: conjunto?.inicio ?? null,
            inicio,
            fim: fim || null,
            percentuais: Object.fromEntries(valores.map((v) => [v.destino, typeof v.valor === "number" ? v.valor : 0])),
            rotulo: rotulo.trim() || null,
          }),
    onSuccess: () => concluir(`Rateio ${tipo === "PARAMETRICO" ? "paramétrico" : "fixo"} de ${daChave?.nome ?? ""} gravado no cenário; a DRE fica pendente de recálculo (Resultados / Recalcular).`),
  });
  const apagar = useMutation({
    mutationFn: () => (regra ? cenariosService.excluirRegraDoCenario(id, regra.id) : cenariosService.excluirFixosDoCenario(id, conjunto!.chave, conjunto!.inicio)),
    onSuccess: () => concluir("Regra excluída do cenário; a DRE fica pendente de recálculo (Resultados / Recalcular)."),
  });
  const pendente = gravar.isPending || apagar.isPending;
  const erro = gravar.isError ? mensagemDeErro(gravar.error, "Não foi possível gravar o rateio.") : apagar.isError ? mensagemDeErro(apagar.error, "Não foi possível excluir.") : null;
  const titulo = regra ? "Editar Rateio Paramétrico do Cenário" : conjunto ? `Editar Percentuais Fixos do Cenário: ${daChave?.nome ?? ""}` : "Novo Rateio do Cenário";
  return (
    <Dialog open onOpenChange={(o) => (!o && !pendente ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="max-h-[90vh] overflow-y-auto rounded-sm sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription render={<div />}>
            <p>Vale só neste cenário. Rateios com a mesma chave não podem ter vigências sobrepostas.</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>Paramétrico: o percentual dos destinos sai das bases das premissas do cenário (os volumes de cada destino).</li>
              <li>Fixo: os percentuais de Matriz, Filial, Montagem e Complementar, somando 100%.</li>
            </ul>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <div className="space-y-1.5">
              <Label htmlFor="rc-rotulo">{tipo === "PARAMETRICO" ? "Rótulo" : "Rótulo (opcional)"}</Label>
              <Input
                id="rc-rotulo"
                value={rotulo}
                onChange={(e) => setRotulo(e.target.value)}
                maxLength={120}
                placeholder={tipo === "FIXO" ? `${daChave?.nome ?? "Chave"} (cada destino: “${daChave?.nome ?? "Chave"}: Matriz (Fixo)”)` : "Ex.: (P) Pré-Fabricado: Matriz"}
                className="rounded-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rc-tipo">Tipo</Label>
              <select id="rc-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)} disabled={aberto.tipo !== "novo"} className={classeSelect}>
                <option value="PARAMETRICO">Paramétrico</option>
                <option value="FIXO">Fixo</option>
              </select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className={`space-y-1.5 ${tipo === "FIXO" ? "sm:col-span-2" : ""}`}>
              <Label htmlFor="rc-chave">Chave</Label>
              <select id="rc-chave" value={chave} onChange={(e) => setChave(e.target.value)} disabled={aberto.tipo !== "novo"} className={classeSelect}>
                {dados.opcoes.chaves.map((c) => (
                  <option key={c.chave} value={c.chave}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>
            {tipo === "PARAMETRICO" ? (
              <div className="space-y-1.5">
                <Label htmlFor="rc-destino">Destino</Label>
                <select id="rc-destino" value={destinoAtual} onChange={(e) => setDestino(e.target.value)} className={classeSelect}>
                  {(daChave?.destinos ?? []).map((d) => (
                    <option key={d.codigo} value={d.codigo}>
                      {d.rotulo}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="rc-inicio">Vigência: Início</Label>
              <Input id="rc-inicio" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="rounded-sm" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rc-fim">Vigência: Fim (opcional)</Label>
              <Input id="rc-fim" type="date" value={fim} onChange={(e) => setFim(e.target.value)} className={`rounded-sm ${fim && inicio && fim < inicio ? "border-red-400" : ""}`} />
            </div>
          </div>
          {tipo === "FIXO" ? (
            <div className="rounded-sm border border-gray-200 bg-white">
              {valores.map((v) => (
                <div key={v.destino} className="flex items-center justify-between gap-3 border-b border-gray-100 px-3 py-2 last:border-b-0">
                  <Label htmlFor={`rc-pct-${v.destino}`} className="text-sm font-medium text-gray-900">
                    {v.nome}
                  </Label>
                  <div className="flex items-center gap-1.5">
                    <Input
                      id={`rc-pct-${v.destino}`}
                      inputMode="decimal"
                      value={textos[v.destino] ?? ""}
                      placeholder="0"
                      onChange={(e) => setTextos((t) => ({ ...t, [v.destino]: e.target.value }))}
                      className={`h-8 w-28 rounded-sm text-right ${v.valor === undefined || (typeof v.valor === "number" && (v.valor < 0 || v.valor > 100)) ? "border-red-400" : ""}`}
                    />
                    <span className="text-sm text-gray-600">%</span>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between bg-gray-50 px-3 py-2 text-sm">
                <span className="font-medium text-gray-700">Soma</span>
                <span className={`font-bold ${somaCerta ? "text-gray-900" : "text-red-700"}`}>{pct(soma)}</span>
              </div>
            </div>
          ) : null}
        </div>
        <Erro erro={erro} />
        <DialogFooter>
          {aberto.tipo !== "novo" ? (
            <Button type="button" variant="outline" className="rounded-sm border-red-300 text-red-700 hover:bg-red-50 sm:mr-auto" disabled={pendente} onClick={() => setExcluindo(true)}>
              <Trash2 className="size-4" />
              Excluir
            </Button>
          ) : null}
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar} disabled={pendente}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={!pronto || pendente} onClick={() => gravar.mutate()}>
            {gravar.isPending ? "Gravando…" : "Gravar"}
          </Button>
        </DialogFooter>
        {excluindo ? (
          <ConfirmacaoDialog
            titulo={regra ? "Excluir a Regra de Rateio do Cenário" : "Excluir os Percentuais Fixos do Cenário"}
            descricao={
              regra
                ? `A regra ${regra.rotulo} sai deste cenário (em Cadastros Gerais, ela continua) e a DRE do cenário fica pendente de recálculo (Resultados / Recalcular).`
                : `Os percentuais fixos de ${daChave?.nome ?? ""} a partir de ${dataBR(conjunto?.inicio ?? null)} saem deste cenário (em Cadastros Gerais, continuam) e a DRE do cenário fica pendente de recálculo (Resultados / Recalcular).`
            }
            pendente={apagar.isPending}
            onConfirmar={() => apagar.mutate(undefined, { onSettled: () => setExcluindo(false) })}
            onFechar={() => setExcluindo(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
