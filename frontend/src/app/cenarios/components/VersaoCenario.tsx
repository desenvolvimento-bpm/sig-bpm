"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyPlus, Lock, LockOpen } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";

import { cenariosService, rotuloVersao, type Cenario } from "../services/cenariosService";
import { useTipoDoCenario } from "./tipoDoCenario";
import { botaoPrimario, Erro } from "./CenarioDialog";

const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

type Acao = "congelar" | "reabrir" | "revisao";
const TITULO: Record<Acao, string> = { congelar: "Congelar Versão", reabrir: "Reabrir Versão", revisao: "Criar Revisão" };

/**
 * O versionamento do cenário (13/10/2026), na aba Cenário das Configurações, logo depois de "Gravar Configurações" (27/11/2026,
 * pedido do Adão): Congelar Versão trava o cenário, como o fechamento de uma competência — a DRE, os indicadores manuais e a
 * referência não se editam mais; Reabrir Versão destrava a versão congelada, como a reabertura de uma competência; Criar Revisão
 * copia a versão congelada numa versão nova (VER01, VER02…), aberta para edição — um cenário novo, na lista, que abre nas
 * Configurações dele. A marcação não passa para a revisão: remarca-se à mão. A permissão é a de editar a tela Resultados.
 */
export function BotoesDeVersao({ cenario }: { cenario: Cenario }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dialogo, setDialogo] = useState<Acao | null>(null);
  const t = useTipoDoCenario();
  const lista = useQuery({ queryKey: ["cenarios", t.tipo], queryFn: () => cenariosService.listar(t.tipo) });
  const familia = cenario.familiaId ?? cenario.id;
  const proxima = Math.max(cenario.versao, ...(lista.data ?? []).filter((c) => (c.familiaId ?? c.id) === familia).map((c) => c.versao)) + 1;
  const versao = rotuloVersao(cenario.versao);
  const congelada = !!cenario.versaoSalvaEm;
  const aoTerminar = (mensagem: string) => {
    queryClient.invalidateQueries({ queryKey: ["cenarios"] });
    toast.success(mensagem);
    setDialogo(null);
  };
  const congelar = useMutation({ mutationFn: () => cenariosService.congelarVersao(cenario.id), onSuccess: () => aoTerminar(`${versao} de ${cenario.nome} congelada.`) });
  const reabrir = useMutation({ mutationFn: () => cenariosService.reabrirVersao(cenario.id), onSuccess: () => aoTerminar(`${versao} de ${cenario.nome} reaberta para edição.`) });
  const revisar = useMutation({
    mutationFn: () => cenariosService.criarRevisao(cenario.id),
    onSuccess: (nova) => {
      aoTerminar(`${rotuloVersao(nova.versao)} de ${nova.nome} criada, aberta para edição.`);
      router.push(`${t.base}/${nova.id}/configuracoes`);
    },
  });
  const mutacao = dialogo === "congelar" ? congelar : dialogo === "reabrir" ? reabrir : revisar;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Congelada, a versão se reabre; aberta, se congela (13/10/2026). */}
      {congelada ? (
        <span title={`${versao} congelada em ${dataHora(cenario.versaoSalvaEm!)}${cenario.versaoSalvaPor ? ` por ${cenario.versaoSalvaPor}` : ""}`}>
          <Button type="button" className={botaoPrimario} onClick={() => setDialogo("reabrir")}>
            <LockOpen className="size-4" />
            Reabrir Versão
          </Button>
        </span>
      ) : (
        <Button type="button" className={botaoPrimario} onClick={() => setDialogo("congelar")}>
          <Lock className="size-4" />
          Congelar Versão
        </Button>
      )}
      <span title={congelada ? undefined : `Congele a ${versao} antes de criar uma revisão`}>
        <Button type="button" className={botaoPrimario} disabled={!congelada} onClick={() => setDialogo("revisao")}>
          <CopyPlus className="size-4" />
          Criar Revisão
        </Button>
      </span>

      {dialogo ? (
        <Dialog open onOpenChange={(o) => (!o ? setDialogo(null) : undefined)}>
          <DialogContent className="rounded-sm sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{TITULO[dialogo]}</DialogTitle>
              <DialogDescription render={<div />}>
                <ul className="list-disc space-y-1.5 pl-5">
                  {dialogo === "congelar" ? (
                    <>
                      <li>
                        A {versao} de {cenario.nome} fica congelada, como uma competência fechada: a DRE, os Indicadores Manuais e a referência não se
                        editam mais.
                      </li>
                      <li>O nome, a descrição, o comparativo e as justificativas continuam editáveis.</li>
                      <li>Para mudar os valores, reabra a versão ou crie uma revisão: uma cópia ({rotuloVersao(proxima)}) aberta para edição.</li>
                    </>
                  ) : dialogo === "reabrir" ? (
                    <>
                      <li>
                        A {versao} de {cenario.nome} volta a ser editável, como a reabertura de uma competência: a DRE, os Indicadores Manuais e a
                        referência.
                      </li>
                      <li>As revisões já criadas a partir dela continuam como estão.</li>
                      {cenario.marcacao ? <li>O cenário continua marcado: para editar os dados, tire também a marcação.</li> : null}
                    </>
                  ) : (
                    <>
                      <li>
                        Cria a {rotuloVersao(proxima)} de {cenario.nome}: uma cópia da {versao} (a DRE, os indicadores, o comparativo e as justificativas),
                        aberta para edição.
                      </li>
                      <li>A revisão é um cenário novo, na lista de {t.titulo}; a {versao} continua congelada.</li>
                      {cenario.marcacao ? <li>A marcação fica na {versao}: para passá-la à revisão, remarque em Configurações / Cenário.</li> : null}
                    </>
                  )}
                </ul>
              </DialogDescription>
            </DialogHeader>
            <Erro erro={mutacao.isError ? mensagemDeErro(mutacao.error, `Não foi possível ${TITULO[dialogo].toLowerCase()}.`) : null} />
            <DialogFooter>
              <Button type="button" variant="outline" className="rounded-sm" onClick={() => setDialogo(null)}>
                Cancelar
              </Button>
              <Button type="button" className={botaoPrimario} disabled={mutacao.isPending} onClick={() => mutacao.mutate()}>
                {mutacao.isPending
                  ? "Gravando…"
                  : dialogo === "congelar"
                    ? `Congelar ${versao}`
                    : dialogo === "reabrir"
                      ? `Reabrir ${versao}`
                      : `Criar ${rotuloVersao(proxima)}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
