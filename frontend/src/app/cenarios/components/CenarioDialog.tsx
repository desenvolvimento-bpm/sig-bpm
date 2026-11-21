"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Globe, Lock } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";

import { cenariosService, rotuloDoCenario, type Cenario, type Visualizacao } from "../services/cenariosService";
import { useTipoDoCenario } from "./tipoDoCenario";

export const botaoPrimario = "bg-bpm-primary hover:bg-bpm-primary-hover rounded-sm font-bold text-black shadow-sm";
export const classeSelect = "h-9 w-full rounded-sm border border-gray-300 bg-white px-3 text-sm";

export function Erro({ erro }: { erro: string | null }) {
  if (!erro) return null;
  return (
    <div className="flex items-center gap-2 rounded-sm border border-red-200 bg-red-50 p-3">
      <AlertCircle className="size-4 shrink-0 text-red-700" />
      <p className="text-sm text-red-700">{erro}</p>
    </div>
  );
}

/**
 * Uma opção de rádio numa linha (13/10/2026): o tipo à esquerda, numa coluna fixa, e o texto explicativo ao lado; as
 * opções ficam uma embaixo da outra (tela Configurações do cenário). Em tela estreita, o texto desce para baixo do tipo.
 */
export function OpcaoEmLinha({
  nome,
  marcada,
  onMarcar,
  rotulo,
  detalhe,
  Icone,
  desabilitada,
  dica,
}: {
  nome: string;
  marcada: boolean;
  onMarcar: () => void;
  rotulo: string;
  detalhe: string;
  Icone?: typeof Lock;
  desabilitada?: boolean;
  dica?: string;
}) {
  return (
    <label
      title={dica}
      className={`flex items-center gap-3 rounded-sm border px-3 py-2 text-sm ${marcada ? "border-gray-900 bg-gray-50" : "border-gray-200"} ${desabilitada ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-gray-50"}`}
    >
      <input type="radio" name={nome} className="accent-black" checked={marcada} disabled={desabilitada} onChange={onMarcar} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-4">
        <span className="inline-flex shrink-0 items-center gap-1.5 font-medium text-gray-900 sm:w-44">
          {Icone ? <Icone className="size-3.5" /> : null}
          {rotulo}
        </span>
        <span className="min-w-0 text-gray-600">{detalhe}</span>
      </span>
    </label>
  );
}

/**
 * A Visualização do cenário (11/10/2026): Particular (só quem criou e os Administradores, o perfil Administrador) ou Pública (todos com
 * permissão). `bloqueio` desabilita a escolha, com o motivo; `semParticular`, só a opção Particular (cenário marcado).
 * `emLinhas`: as opções uma embaixo da outra, com o texto ao lado (tela Configurações, 13/10/2026); sem ele, lado a lado (modal).
 */
export function CampoVisualizacao({
  valor,
  onMudar,
  bloqueio,
  semParticular,
  emLinhas,
}: {
  valor: Visualizacao;
  onMudar: (v: Visualizacao) => void;
  bloqueio?: string | null;
  semParticular?: string | null;
  emLinhas?: boolean;
}) {
  const { titulo } = useTipoDoCenario();
  const opcoes: Array<{ v: Visualizacao; rotulo: string; detalhe: string; Icone: typeof Lock; motivo?: string | null }> = [
    { v: "PARTICULAR", rotulo: "Particular", detalhe: "Apenas quem criou o cenário, os Administradores e os usuários convidados no Compartilhar têm acesso.", Icone: Lock, motivo: semParticular },
    { v: "PUBLICA", rotulo: "Pública", detalhe: `Todos os usuários com permissão nos ${titulo} têm acesso.`, Icone: Globe },
  ];
  return (
    <fieldset className="space-y-1.5" disabled={!!bloqueio}>
      <legend className="text-sm leading-none font-medium">Visualização</legend>
      <div className={emLinhas ? "space-y-2 pt-1.5" : "grid gap-2 pt-1.5 sm:grid-cols-2"}>
        {opcoes.map(({ v, rotulo, detalhe, Icone, motivo }) => {
          const desabilitada = !!bloqueio || (!!motivo && valor !== v);
          if (emLinhas) {
            return (
              <OpcaoEmLinha
                key={v}
                nome="visualizacao"
                marcada={valor === v}
                onMarcar={() => onMudar(v)}
                rotulo={rotulo}
                detalhe={detalhe}
                Icone={Icone}
                desabilitada={desabilitada}
                dica={bloqueio ?? (desabilitada ? motivo! : undefined)}
              />
            );
          }
          return (
            <label
              key={v}
              title={bloqueio ?? (desabilitada ? motivo! : undefined)}
              className={`flex items-start gap-2 rounded-sm border px-3 py-2 text-sm ${valor === v ? "border-gray-900 bg-gray-50" : "border-gray-200"} ${desabilitada ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-gray-50"}`}
            >
              <input type="radio" name="visualizacao" className="mt-1 accent-black" checked={valor === v} disabled={desabilitada} onChange={() => onMudar(v)} />
              <span className="min-w-0">
                <span className="inline-flex items-center gap-1.5 font-medium text-gray-900">
                  <Icone className="size-3.5" />
                  {rotulo}
                </span>
                <span className="block text-xs text-gray-600">{detalhe}</span>
              </span>
            </label>
          );
        })}
      </div>
      {bloqueio ? <p className="text-xs text-gray-500">{bloqueio}</p> : semParticular && valor === "PUBLICA" ? <p className="text-xs text-gray-500">{semParticular}</p> : null}
    </fieldset>
  );
}

/**
 * Novo cenário (vazio, num exercício, ou a cópia de outro, com a DRE e as metas dele) ou a edição do nome, da
 * descrição e da visualização de um cenário.
 */
export function CenarioDialog({ cenario, cenarios, onFechar }: { cenario: Cenario | null; cenarios: Cenario[]; onFechar: () => void }) {
  const queryClient = useQueryClient();
  const atual = new Date().getFullYear();
  const [nome, setNome] = useState(cenario?.nome ?? "");
  const [descricao, setDescricao] = useState(cenario?.descricao ?? "");
  const [ano, setAno] = useState(String(cenario?.ano ?? atual));
  const [copiarDe, setCopiarDe] = useState("");
  const [visualizacao, setVisualizacao] = useState<Visualizacao>(cenario?.visualizacao ?? "PUBLICA");
  const origem = cenarios.find((c) => c.id === copiarDe);
  // O cenário novo é do tipo da lista aberta (13/10/2026); "Copiar de" traz só os do mesmo tipo.
  const { tipo } = useTipoDoCenario();

  const salvar = useMutation({
    mutationFn: () =>
      cenario
        ? cenariosService.atualizar(cenario.id, { nome: nome.trim(), descricao: descricao.trim() || null, visualizacao })
        : cenariosService.criar({ nome: nome.trim(), ano: Number(ano), descricao: descricao.trim() || null, copiarDe: copiarDe || null, visualizacao, tipo }),
    onSuccess: (c) => {
      queryClient.invalidateQueries({ queryKey: ["cenarios"] });
      toast.success(cenario ? "Cenário alterado." : `Cenário ${c.nome} criado.`);
      onFechar();
    },
  });

  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="rounded-sm sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{cenario ? "Editar Cenário" : "Novo Cenário"}</DialogTitle>
          <DialogDescription>
            {cenario
              ? "O nome, a descrição e a visualização do cenário. A DRE e as metas mudam pela importação de um arquivo e pelos lançamentos manuais."
              : "Um cenário vazio, num exercício, ou a cópia de outro cenário, com a DRE e as metas dele. Depois, importe um arquivo no cenário ou ajuste os lançamentos manuais."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="cenario-nome">Nome</Label>
            <Input id="cenario-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} className="rounded-sm" placeholder="Ex.: Cenário Adotado (REV02)" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="cenario-descricao">Descrição (opcional)</Label>
            <Input id="cenario-descricao" value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={500} className="rounded-sm" />
          </div>
          {cenario ? null : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="cenario-copia">Copiar de (opcional)</Label>
                <select id="cenario-copia" value={copiarDe} onChange={(e) => setCopiarDe(e.target.value)} className={classeSelect}>
                  <option value="">Nenhum (cenário vazio)</option>
                  {cenarios.map((c) => (
                    <option key={c.id} value={c.id}>
                      {rotuloDoCenario(c)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cenario-ano">Exercício</Label>
                <select id="cenario-ano" value={origem ? String(origem.ano) : ano} onChange={(e) => setAno(e.target.value)} disabled={!!origem} className={classeSelect}>
                  {[atual - 1, atual, atual + 1, atual + 2].map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div className="sm:col-span-2">
            <CampoVisualizacao
              valor={visualizacao}
              onMudar={setVisualizacao}
              bloqueio={cenario && !cenario.podeMudarVisualizacao ? "Só quem criou o cenário ou um Administrador muda a visualização." : null}
              semParticular={cenario?.marcacao ? "Um cenário marcado fica público: tire a marcação antes de torná-lo particular." : null}
            />
          </div>
        </div>
        <Erro erro={salvar.isError ? mensagemDeErro(salvar.error, "Não foi possível gravar o cenário.") : null} />
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={!nome.trim() || salvar.isPending} onClick={() => salvar.mutate()}>
            {salvar.isPending ? "Gravando…" : cenario ? "Gravar" : "Criar Cenário"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A exclusão de um cenário, com a confirmação; `aoExcluir` roda antes de recarregar a lista (a tela do cenário sai dele). */
export function ExcluirCenarioDialog({ cenario, onFechar, aoExcluir }: { cenario: Cenario; onFechar: () => void; aoExcluir?: () => void }) {
  const queryClient = useQueryClient();
  const excluir = useMutation({
    mutationFn: () => cenariosService.excluir(cenario.id),
    onSuccess: () => {
      aoExcluir?.();
      queryClient.invalidateQueries({ queryKey: ["cenarios"] });
      toast.success(`Cenário ${cenario.nome} excluído.`);
      onFechar();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent className="rounded-sm sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Excluir Cenário</DialogTitle>
          <DialogDescription>
            O cenário {cenario.nome} ({cenario.ano}) sai da lista, com a DRE e as metas dele. A exclusão fica no log de auditoria e não se desfaz.
          </DialogDescription>
        </DialogHeader>
        <Erro erro={excluir.isError ? mensagemDeErro(excluir.error, "Não foi possível excluir o cenário.") : null} />
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" className="rounded-sm bg-red-700 font-bold text-white hover:bg-red-800" disabled={excluir.isPending} onClick={() => excluir.mutate()}>
            {excluir.isPending ? "Excluindo…" : "Excluir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
