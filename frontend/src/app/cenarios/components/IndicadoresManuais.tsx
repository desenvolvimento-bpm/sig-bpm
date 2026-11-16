"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { TabelaIndicadores, valor } from "@/app/relatorios/indicadores/TabelaIndicadores";
import { mensagemDeErro, type MesRelatorio } from "@/app/relatorios/services/relatoriosService";

import { cenariosService, type IndicadorDoCenario } from "../services/cenariosService";
import { botaoPrimario, Erro } from "./CenarioDialog";

// Os percentuais se digitam em % (0,25 = 25%), como nas abas Comercial e Administrativo das Listas.
const emPct = (i: IndicadorDoCenario) => i.unidade === "%";
/** O valor no campo como a tabela o mostra (13/10/2026): as mesmas casas, o separador de milhar e o %; vazio sem valor. */
const paraCampo = (i: IndicadorDoCenario, v: number | null) => (v === null ? "" : valor(i, v));
/** O valor digitado, na unidade gravada: aceita o formato da tabela ("1.234,5", "25,0%") ou só o número; vazio: null; inválido: undefined. */
function lerValor(i: IndicadorDoCenario, texto: string): number | null | undefined {
  const t = texto.replace(/R\$|%|\s/g, "").replace(/\./g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  return emPct(i) ? n / 100 : n;
}

/** A escolha de Replicar aos Demais, guardada neste navegador (13/10/2026): vale nos próximos modais. */
const CHAVE_REPLICAR = "sig.cenarios.manuais.replicar";
function replicarGuardado() {
  try {
    return window.localStorage.getItem(CHAVE_REPLICAR) === "1";
  } catch {
    return false; // sem armazenamento
  }
}

/**
 * Os 12 meses de um lançamento manual (vazio apaga o mês). Os valores aparecem como na tabela (13/10/2026); o mês que
 * não se mexe fica com o valor gravado (sem o arredondamento da tela). Com "Replicar aos Demais", o valor digitado num
 * mês vai para os outros onze ao sair do campo (Tab).
 */
export function LancamentoDialog({ id, indicador, meses, onFechar }: { id: string; indicador: IndicadorDoCenario; meses: MesRelatorio[]; onFechar: () => void }) {
  const queryClient = useQueryClient();
  const [textos, setTextos] = useState(() => indicador.meses.map((v) => paraCampo(indicador, v)));
  // Os meses mexidos (digitados ou replicados): só eles se leem do campo; os outros ficam com o valor gravado.
  const [mexidos, setMexidos] = useState<Set<number>>(() => new Set());
  const [replicar, setReplicar] = useState(replicarGuardado);
  // O mês digitado desde que o campo ganhou o foco: só ele se replica (passar com Tab por um mês sem digitar não replica).
  const digitado = useRef<number | null>(null);
  const valores = indicador.meses.map((v, k) => (mexidos.has(k) ? lerValor(indicador, textos[k]) : v));
  const invalido = valores.some((v) => v === undefined);
  const aoSair = (k: number) => {
    if (digitado.current !== k) return;
    digitado.current = null;
    const v = lerValor(indicador, textos[k]);
    if (v === undefined) return;
    const texto = paraCampo(indicador, v);
    if (replicar) {
      setTextos(textos.map(() => texto));
      setMexidos(new Set(meses.map((_, j) => j)));
    } else setTextos((t) => t.map((x, j) => (j === k ? texto : x)));
  };
  const salvar = useMutation({
    mutationFn: () => cenariosService.salvarManual(id, indicador.nome, valores.map((v) => (v === undefined ? null : v))),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cenarios"] });
      // Se o cenário é o Orçamento Empresarial, o orçado de Resultados Empresariais muda.
      queryClient.invalidateQueries({ queryKey: ["relatorios"] });
      toast.success(`${indicador.nome}: lançamentos gravados.`);
      onFechar();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="max-h-[90vh] overflow-y-auto rounded-sm sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{indicador.nome}</DialogTitle>
          <DialogDescription>
            {indicador.metodologia} · {emPct(indicador) ? "em %" : `em ${indicador.unidade}`}. Os valores aparecem como na tabela; digite só o número
            (o separador de milhar e o % são opcionais). Um mês vazio fica sem valor. O valor digitado vale até uma nova importação da aba das metas no
            cenário.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {meses.map((m, k) => (
            <div key={m.mes} className="space-y-1">
              <Label htmlFor={`lanc-${k}`}>{m.rotulo}</Label>
              <Input
                id={`lanc-${k}`}
                inputMode="decimal"
                value={textos[k]}
                onChange={(e) => {
                  const texto = e.target.value;
                  digitado.current = k;
                  setTextos((t) => t.map((x, j) => (j === k ? texto : x)));
                  setMexidos((m) => (m.has(k) ? m : new Set(m).add(k)));
                }}
                onBlur={() => aoSair(k)}
                className={`rounded-sm text-right ${valores[k] === undefined ? "border-red-400" : ""}`}
              />
            </div>
          ))}
        </div>
        <Erro erro={invalido ? "Há um mês com um valor que não é número." : salvar.isError ? mensagemDeErro(salvar.error, "Não foi possível gravar.") : null} />
        <DialogFooter>
          {/* Replicar aos Demais (13/10/2026): à esquerda, na altura dos botões. */}
          <label className="inline-flex items-center gap-2 text-sm text-gray-700 sm:mr-auto" title="O valor digitado num mês vai para os outros onze ao sair do campo (Tab)">
            <input type="checkbox" className="accent-black" checked={replicar} onChange={(e) => {
                const sim = e.target.checked;
                setReplicar(sim);
                try {
                  window.localStorage.setItem(CHAVE_REPLICAR, sim ? "1" : "0");
                } catch {
                  // sem armazenamento: a escolha só não é lembrada
                }
              }}
            />
            Replicar aos Demais
          </label>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={invalido || salvar.isPending} onClick={() => salvar.mutate()}>
            {salvar.isPending ? "Gravando…" : "Gravar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


/**
 * Os Indicadores Manuais de um cenário (14/10/2026: também a aba das Premissas dos analíticos): os quadros de lotação e
 * os indicadores do Comercial e do Administrativo, que não saem da DRE. Clicar numa linha abre os doze meses para digitar.
 */
export function IndicadoresManuais({ id, podeEditar, comReferencia = false }: { id: string; podeEditar: boolean; comReferencia?: boolean }) {
  const [editando, setEditando] = useState<IndicadorDoCenario | null>(null);
  // A aba Indicadores Manuais das Premissas (12/11/2026): com o Acesso às Informações Por Recorte, só os dos grupos do recorte.
  const consulta = useQuery({ queryKey: ["cenarios", id, "indicadores", "manuais"], queryFn: () => cenariosService.indicadores(id, "manuais") });
  if (consulta.isError) return <Erro erro={mensagemDeErro(consulta.error, "Erro ao carregar os indicadores do cenário.")} />;
  if (consulta.isPending) return <div className="h-64 animate-pulse rounded-sm bg-gray-100" />;
  const dados = consulta.data;
  return (
    <>
      <TabelaIndicadores
        meses={dados.meses}
        indicadores={dados.indicadores.filter((i) => i.classe === "MANUAL")}
        comparado={dados.comparado}
        onClicar={podeEditar ? setEditando : undefined}
        dicaDoClique="Digitar os lançamentos do indicador"
        iconeDoClique={podeEditar ? Pencil : undefined}
        destacar={(i, k) => i.digitados[k]}
        dicaDoDestaque="Valor digitado"
        comReferencia={comReferencia}
      />
      {editando ? <LancamentoDialog id={id} indicador={editando} meses={dados.meses} onFechar={() => setEditando(null)} /> : null}
    </>
  );
}
