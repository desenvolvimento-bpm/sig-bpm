"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { Abas } from "@/components/shared/Abas";
import { CampoBusca } from "@/components/shared/Filtros";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { plural } from "@/lib/texto";

import { botaoPrimario } from "@/app/cenarios/components/CenarioDialog";

import type { Bloco, DadosDoRelatorio } from "../services/relatoriosExecutivosService";
import { listaDosCenarios } from "./cenariosDoProva";

/** O texto para a busca: sem diferença de maiúsculas e de acentos. */
const normal = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

type Novo = Omit<Extract<Bloco, { tipo: "PAINEL" }>, "id" | "x" | "y" | "w" | "h"> | Omit<Extract<Bloco, { tipo: "INDICADOR" }>, "id" | "x" | "y" | "w" | "h">;

/**
 * O modal Adicionar Cards Padrão (15/10/2026; antes, Adicionar Cards): os cards do Painel de Bordo (as abas Resultados e Performance, por grupo), com ou
 * sem o gráfico, e os dos Indicadores (por grupo), com a busca; os marcados entram no fim da aba do relatório. Com `prova`
 * (31/10/2026, pedido do Adão), o Adicionar Cards PROVA: os mesmos cards, comparados com os cenários da Comparação PROVA
 * do relatório (a aba Configurações).
 */
export function AdicionarCardsDialog({ dados, prova = false, onAdicionar, onFechar }: { dados: DadosDoRelatorio; prova?: boolean; onAdicionar: (novos: Novo[]) => void; onFechar: () => void }) {
  const [origem, setOrigem] = useState<"painel" | "indicadores">("painel");
  const [busca, setBusca] = useState("");
  const [comGrafico, setComGrafico] = useState(true);
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set());
  const b = normal(busca.trim());
  const alternar = (k: string) =>
    setMarcados((m) => {
      const n = new Set(m);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  // As chaves: "P|aba|quadro|título|sigla" e "I|nome"; o ID do card e o do indicador (25/11/2026) vão com o bloco.
  const cardPorChave = new Map<string, string>();
  const indicadorPorChave = new Map<string, string>();
  const painel = dados.painel.abas.flatMap((a) =>
    a.quadros.map((q) => ({
      titulo: `${a.titulo} · ${q.titulo}`,
      itens: q.itens
        .filter((i) => !b || normal(`${q.titulo} ${i.titulo} ${i.sigla}`).includes(b))
        .map((i) => {
          const chave = ["P", a.chave, q.titulo, i.titulo, i.sigla].join("|");
          if (i.id) cardPorChave.set(chave, i.id);
          return { chave, rotulo: i.titulo, detalhe: i.sigla };
        }),
    })),
  );
  const grupos = [...new Set(dados.indicadores.indicadores.map((i) => i.grupo))];
  const indicadores = grupos.map((g) => ({
    titulo: g,
    itens: dados.indicadores.indicadores
      .filter((i) => i.grupo === g && (!b || normal(`${i.grupo} ${i.nome}`).includes(b)))
      .map((i) => {
        if (i.id) indicadorPorChave.set(`I|${i.nome}`, i.id);
        return { chave: `I|${i.nome}`, rotulo: i.nome, detalhe: i.unidade };
      }),
  }));
  const lista = (origem === "painel" ? painel : indicadores).filter((g) => g.itens.length);
  const adicionar = () => {
    const novos: Novo[] = [...marcados].map((k) => {
      const [t, ...p] = k.split("|");
      // Os cards do Painel entram com os rótulos e em barras (20/10/2026; os dos Indicadores também, 22/10/2026); o Configurar
      // Gráfico do card os muda.
      const comProva = prova ? { prova: true as const } : {};
      return t === "P"
        ? { tipo: "PAINEL", ...(cardPorChave.has(k) ? { cardId: cardPorChave.get(k) } : {}), aba: p[0] as "resultados" | "performance", quadro: p[1], titulo: p[2], sigla: p[3], comGrafico, comRotulos: true, tipoGrafico: "barras", ...comProva }
        : { tipo: "INDICADOR", ...(indicadorPorChave.has(k) ? { indicadorId: indicadorPorChave.get(k) } : {}), nome: p.join("|"), ...(comGrafico ? { grafico: "MESES" as const } : {}), comRotulos: true, tipoGrafico: "barras", ...comProva };
    });
    onAdicionar(novos);
  };
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent className="flex max-h-[90vh] flex-col rounded-sm sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{prova ? "Adicionar Cards PROVA" : "Adicionar Cards Padrão"}</DialogTitle>
          <DialogDescription>
            {prova
              ? `Marque os cards do Painel de Bordo ou dos Indicadores (até ${dados.painel.rotuloMes}, só das competências fechadas): cada card compara o realizado com os cenários da Comparação PROVA (Configurações)${dados.prova.cenarios.length ? `, hoje ${listaDosCenarios(dados.prova.cenarios)}` : ""}, um por linha e uma série no gráfico. Eles entram no fim da aba; depois, mova e redimensione cada um na tela.`
              : `Marque os cards do Painel de Bordo ou dos Indicadores (até ${dados.painel.rotuloMes}, só das competências fechadas). Eles entram no fim da aba; depois, mova e redimensione cada um na tela.`}
          </DialogDescription>
        </DialogHeader>
        {/* As abas e a busca na altura delas (sem encolher): só a lista rola. */}
        <div className="shrink-0">
          <Abas
            rotulo="Origem dos cards"
            ativa={origem}
            onMudar={(a) => setOrigem(a as "painel" | "indicadores")}
            abas={[
              { chave: "painel", rotulo: "Painel de Bordo" },
              { chave: "indicadores", rotulo: "Indicadores" },
            ]}
          />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-4">
          <div className="min-w-64 flex-1">
            <CampoBusca valor={busca} onMudar={setBusca} placeholder="Buscar pelo nome…" />
          </div>
          {/* Com Gráfico (22/10/2026: também nos indicadores). */}
          <label className="inline-flex items-center gap-2 text-sm text-gray-800">
            <input type="checkbox" className="accent-black" checked={comGrafico} onChange={(e) => setComGrafico(e.target.checked)} />
            Com Gráfico
          </label>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-sm border border-gray-200 p-3">
          {lista.length === 0 ? <p className="text-sm text-gray-500">Nenhum card com esse nome.</p> : null}
          {lista.map((g) => (
            <section key={g.titulo}>
              <h3 className="mb-1 text-xs font-bold tracking-wide text-gray-500 uppercase">{g.titulo}</h3>
              <div className="grid gap-1 sm:grid-cols-2">
                {g.itens.map((i) => (
                  <label key={i.chave} className="flex cursor-pointer items-start gap-2 rounded-sm px-2 py-1 text-sm hover:bg-gray-50">
                    <input type="checkbox" className="mt-0.5 accent-black" checked={marcados.has(i.chave)} onChange={() => alternar(i.chave)} />
                    <span>
                      <span className="text-gray-900">{i.rotulo}</span>
                      {i.detalhe ? <span className="ml-1.5 text-xs text-gray-500">{i.detalhe}</span> : null}
                    </span>
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>
        <DialogFooter className="items-center">
          <span className="text-xs text-gray-600 sm:mr-auto">
            {marcados.size} {plural(marcados.size, "card marcado", "cards marcados")}
          </span>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={!marcados.size || (prova && !dados.prova.cenarios.length)} onClick={adicionar}>
            <Plus className="size-4" />
            Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
