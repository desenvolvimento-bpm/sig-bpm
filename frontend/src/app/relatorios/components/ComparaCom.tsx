"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { botaoPrimario, OpcaoEmLinha } from "@/app/cenarios/components/CenarioDialog";

import { relatoriosService, type Comparavel, type MarcacaoComparavel } from "../services/relatoriosService";
import { CENARIOS_DO_PROVA, listaDosCenarios, type CenarioDoProva } from "./cenariosDoProva";
import { Quadradinho } from "./GraficoRealizadoOrcado";

/**
 * A Comparação de Resultados Empresariais (21/10/2026; de início, "Compara Com"): o cenário comparado (as colunas pretas de Resultados e o
 * orçado do Painel de Bordo), entre os cenários marcados (de qualquer exercício, desde 22/10/2026: num de outro, valem os
 * mesmos meses dele) (Forecast, Orçamento, Anterior e Vendido). A lista mostra só o nome da marcação (30/10/2026, pedido do
 * Adão; antes, também o nome do cenário e o ano). O padrão (23/10/2026; antes, o Orçamento) é a
 * primeira marcação que houver, nessa ordem; a escolha fica guardada no navegador e vale nas duas telas — desde 11/11/2026
 * (pedido do Adão), com o botão nas duas (Resultados e Painel de Bordo), e a mudança numa vale na outra na hora, também em
 * outra janela do navegador (o evento da escolha e o storage do navegador), com os dados recarregados.
 * Desde 31/10/2026 (pedido do Adão), num modal, com dois tipos: a Padrão (esse cenário) e a PROVA (dois ou mais dos cenários
 * marcados, lado a lado, com as cores dos objetos PROVA dos Relatórios Executivos).
 */
const CHAVE = "sig.comparaCom";
const CHAVE_DO_TIPO = "sig.comparacao.tipo";
const CHAVE_DA_PROVA = "sig.comparacao.prova";
const ORDEM: MarcacaoComparavel[] = ["PREVISAO", "ORCAMENTO_EMPRESARIAL", "RESULTADOS_ANTERIORES", "RESULTADOS_VENDIDOS"];
const PADRAO = ORDEM[0];
const ORDEM_DO_PROVA = CENARIOS_DO_PROVA.map((p) => p.marcacao);

export type TipoDaComparacao = "padrao" | "prova";
/** A escolha do modal: o tipo, o cenário da Padrão e os da PROVA (os dois ficam guardados, valha qual valer). */
export type EscolhaDaComparacao = { tipo: TipoDaComparacao; comparaCom: MarcacaoComparavel; prova: MarcacaoComparavel[] };

/** Uma escolha guardada neste navegador; null: nenhuma (vale o padrão). */
function ler(chave: string) {
  try {
    return window.localStorage.getItem(chave);
  } catch {
    return null;
  }
}
function guardar(chave: string, valor: string) {
  try {
    window.localStorage.setItem(chave, valor);
  } catch {
    // Sem o armazenamento do navegador, vale só nesta tela.
  }
}
/** O aviso da escolha nova (11/11/2026): as telas abertas nesta janela leem de novo; nas outras janelas, o evento storage. */
const EVENTO = "sig:comparacao";
function lerProva(): MarcacaoComparavel[] {
  try {
    const v: unknown = JSON.parse(ler(CHAVE_DA_PROVA) ?? "[]");
    return Array.isArray(v) ? v.filter((m): m is MarcacaoComparavel => ORDEM.includes(m)) : [];
  } catch {
    return [];
  }
}

/** Os cenários marcados na ordem do PROVA, com o rótulo e a cor de cada um nos objetos PROVA. */
function cenariosDoProva(opcoes: Comparavel[]): CenarioDoProva[] {
  return CENARIOS_DO_PROVA.flatMap((p) => {
    const o = opcoes.find((x) => x.marcacao === p.marcacao);
    return o ? [{ ...p, cenario: o.cenario.nome }] : [];
  });
}

export function useComparaCom(ano: number | null) {
  const naTela = typeof window !== "undefined";
  const [escolhida, setEscolhida] = useState<MarcacaoComparavel | null>(() => (naTela ? (ler(CHAVE) as MarcacaoComparavel | null) : null));
  const [tipo, setTipo] = useState<TipoDaComparacao>(() => (naTela && ler(CHAVE_DO_TIPO) === "prova" ? "prova" : "padrao"));
  const [escolhidasProva, setEscolhidasProva] = useState<MarcacaoComparavel[]>(() => (naTela ? lerProva() : []));
  // A escolha mudada em outra tela (o Painel de Bordo e Resultados, abertos juntos) ou em outra janela (11/11/2026): lê de
  // novo; as consultas, pela chave com a comparação, recarregam sozinhas.
  useEffect(() => {
    const reler = () => {
      setEscolhida(ler(CHAVE) as MarcacaoComparavel | null);
      setTipo(ler(CHAVE_DO_TIPO) === "prova" ? "prova" : "padrao");
      setEscolhidasProva(lerProva());
    };
    const aoMudarNoNavegador = (e: StorageEvent) => {
      if (e.key === null || [CHAVE, CHAVE_DO_TIPO, CHAVE_DA_PROVA].includes(e.key)) reler();
    };
    window.addEventListener(EVENTO, reler);
    window.addEventListener("storage", aoMudarNoNavegador);
    return () => {
      window.removeEventListener(EVENTO, reler);
      window.removeEventListener("storage", aoMudarNoNavegador);
    };
  }, []);
  const consulta = useQuery({ queryKey: ["relatorios", "comparaveis", ano], queryFn: () => relatoriosService.comparaveis(ano!), enabled: ano !== null });
  const opcoes = consulta.data ?? [];
  // Sem escolha (ou a escolhida sem cenário marcado), a primeira marcação que houver na ORDEM (23/10/2026; antes, o Orçamento
  // mesmo sem cenário: o orçado zero para quem nunca tinha escolhido outra).
  const temA = (m: MarcacaoComparavel) => opcoes.some((o) => o.marcacao === m);
  const comparaCom = escolhida && temA(escolhida) ? escolhida : (ORDEM.find(temA) ?? PADRAO);
  // A PROVA: as escolhidas que têm cenário (dois ou mais; sem elas, todos os marcados). Com menos de dois cenários
  // marcados, vale a Padrão.
  const todos = cenariosDoProva(opcoes);
  const escolhidos = todos.filter((c) => escolhidasProva.includes(c.marcacao));
  const daProva = escolhidos.length >= 2 ? escolhidos : todos;
  const prova = tipo === "prova" && daProva.length >= 2 ? daProva : null;
  const mudar = (e: EscolhaDaComparacao) => {
    setEscolhida(e.comparaCom);
    setTipo(e.tipo);
    setEscolhidasProva(e.prova);
    guardar(CHAVE, e.comparaCom);
    guardar(CHAVE_DO_TIPO, e.tipo);
    guardar(CHAVE_DA_PROVA, JSON.stringify(e.prova));
    window.dispatchEvent(new Event(EVENTO));
  };
  return {
    comparaCom,
    opcoes,
    mudar,
    // `pronta`: as opções chegaram (ou falharam), para não pedir os dados com o padrão antes da escolha valer.
    pronta: consulta.isSuccess || consulta.isError,
    atual: opcoes.find((o) => o.marcacao === comparaCom) ?? null,
    /** A Comparação PROVA, quando vale: os cenários, na ordem do PROVA e com as cores; null: a Padrão. */
    prova,
    /** A escolha de hoje, para o modal. */
    escolha: { tipo: prova ? "prova" : "padrao", comparaCom, prova: daProva.map((c) => c.marcacao) } satisfies EscolhaDaComparacao,
  };
}

export type Comparacao = ReturnType<typeof useComparaCom>;

/**
 * A Comparação na linha do título de Resultados (31/10/2026; antes, uma lista): o rótulo e, no lugar da lista, um botão
 * com a escolha de hoje (a marcação da Padrão ou “PROVA”, com as cores dos cenários), que abre o modal.
 */
export function SeletorComparaCom({ comparacao }: { comparacao: Comparacao }) {
  const [aberto, setAberto] = useState(false);
  if (!comparacao.opcoes.length) return null;
  const { prova } = comparacao;
  const dica = prova ? `Comparação PROVA: ${listaDosCenarios(prova)}` : `Comparação Padrão: ${comparacao.atual?.rotulo ?? ""} (${comparacao.atual?.cenario.nome ?? ""})`;
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium whitespace-nowrap text-gray-600">Comparação</span>
        <button
          type="button"
          onClick={() => setAberto(true)}
          title={dica}
          aria-label={dica}
          className="flex h-8 w-36 items-center justify-between gap-1.5 rounded-sm border border-input bg-white py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <span className="truncate">{prova ? "PROVA" : (comparacao.atual?.rotulo ?? "")}</span>
            {prova ? (
              <span className="inline-flex items-center gap-0.5">
                {prova.map((c) => (
                  <Quadradinho key={c.marcacao} cor={c.cor} />
                ))}
              </span>
            ) : null}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </div>
      {aberto ? (
        <ComparacaoDialog
          opcoes={comparacao.opcoes}
          inicial={comparacao.escolha}
          onAplicar={(e) => {
            comparacao.mudar(e);
            setAberto(false);
          }}
          onFechar={() => setAberto(false)}
        />
      ) : null}
    </>
  );
}

/** A marcação em destaque: o amarelo-ouro da BPM, como em Configurações dos Relatórios Executivos. */
const ETIQUETA_DA_MARCACAO = "inline-flex items-center rounded-sm border border-bpm-primary bg-bpm-primary px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap text-black";

/**
 * O modal da Comparação (31/10/2026): o tipo — a Padrão (um cenário: as colunas do orçado com as variações e, nos cards, o
 * destaque do desvio) ou a PROVA (dois ou mais cenários lado a lado, sem as variações; nos cards, uma linha por cenário) —
 * e, embaixo, os cenários marcados do tipo escolhido. Vale ao Aplicar.
 */
function ComparacaoDialog({ opcoes, inicial, onAplicar, onFechar }: { opcoes: Comparavel[]; inicial: EscolhaDaComparacao; onAplicar: (e: EscolhaDaComparacao) => void; onFechar: () => void }) {
  const [tipo, setTipo] = useState(inicial.tipo);
  const [comparaCom, setComparaCom] = useState(inicial.comparaCom);
  const [prova, setProva] = useState(inicial.prova);
  const daProva = cenariosDoProva(opcoes);
  const podeProva = daProva.length >= 2;
  const alternar = (m: MarcacaoComparavel) => {
    const novos = prova.includes(m) ? prova.filter((x) => x !== m) : [...prova, m];
    // Dois ou mais: o penúltimo não se desmarca.
    if (novos.length < 2) return;
    setProva(ORDEM_DO_PROVA.filter((x) => novos.includes(x)));
  };
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="rounded-sm sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Comparação de Resultados Empresariais</DialogTitle>
          <DialogDescription>
            Com quais cenários marcados (Análises Gerenciais / Cenários Sintéticos) o realizado se compara, em Resultados e no Painel de Bordo (os cards e
            a aba Indicadores). A escolha fica guardada neste navegador.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2" role="radiogroup" aria-label="Tipo da comparação">
          <OpcaoEmLinha
            nome="tipo-da-comparacao"
            marcada={tipo === "padrao"}
            onMarcar={() => setTipo("padrao")}
            rotulo="Padrão"
            detalhe="Um cenário: as colunas do orçado, com a Diferença, o Atingimento e a Eficiência; nos cards, o destaque do desvio."
          />
          <OpcaoEmLinha
            nome="tipo-da-comparacao"
            marcada={tipo === "prova"}
            onMarcar={() => setTipo("prova")}
            rotulo="PROVA"
            detalhe="Até quatro cenários lado a lado, cada um na cor dele: o atual e o acumulado de cada um, sem as variações; nos cards, uma linha por cenário."
            desabilitada={!podeProva}
            dica={podeProva ? undefined : "A Comparação PROVA precisa de dois ou mais cenários marcados."}
          />
        </div>
        {tipo === "padrao" ? (
          <ListaDeCenarios
            titulo="Cenário da Comparação Padrão"
            linhas={opcoes.map((o) => ({
              chave: o.marcacao,
              nome: o.cenario.nome,
              ano: o.cenario.ano,
              marcacao: <span className={ETIQUETA_DA_MARCACAO}>{o.rotulo}</span>,
              marcada: comparaCom === o.marcacao,
              onMarcar: () => setComparaCom(o.marcacao),
              controle: (
                <input
                  type="radio"
                  name="cenario-da-comparacao"
                  className="size-4 accent-black"
                  checked={comparaCom === o.marcacao}
                  onChange={() => setComparaCom(o.marcacao)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Comparar com ${o.cenario.nome}`}
                />
              ),
            }))}
          />
        ) : (
          <ListaDeCenarios
            titulo="Cenários da Comparação PROVA (dois ou mais)"
            linhas={daProva.map((c) => {
              const marcada = prova.includes(c.marcacao);
              // Com dois marcados, eles não se desmarcam.
              const preso = marcada && prova.length <= 2;
              return {
                chave: c.marcacao,
                nome: c.cenario,
                ano: opcoes.find((o) => o.marcacao === c.marcacao)!.cenario.ano,
                marcacao: (
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                    <Quadradinho cor={c.cor} />
                    {c.rotulo}
                  </span>
                ),
                marcada,
                onMarcar: () => alternar(c.marcacao),
                controle: (
                  <input
                    type="checkbox"
                    className="size-4 accent-black"
                    checked={marcada}
                    disabled={preso}
                    title={preso ? "A Comparação PROVA tem dois ou mais cenários: marque outro antes de desmarcar este." : undefined}
                    onChange={() => alternar(c.marcacao)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Comparar com ${c.cenario}`}
                  />
                ),
              };
            })}
          />
        )}
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} onClick={() => onAplicar({ tipo, comparaCom, prova })}>
            Aplicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
/** A lista dos cenários de um tipo: a escolha (o botão de opção ou a caixa), o cenário, o ano e a marcação; o clique na linha escolhe. */
function ListaDeCenarios({
  titulo,
  linhas,
}: {
  titulo: string;
  linhas: Array<{ chave: string; nome: string; ano: number; marcacao: ReactNode; marcada: boolean; onMarcar: () => void; controle: ReactNode }>;
}) {
  return (
    <fieldset className="overflow-x-auto rounded-sm border border-gray-200">
      <legend className="sr-only">{titulo}</legend>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-bold tracking-wide text-gray-700 uppercase">
            <th className="w-10 px-3 py-2" />
            <th className="px-3 py-2">Cenário</th>
            <th className="w-20 px-3 py-2">Ano</th>
            <th className="w-32 px-3 py-2">Marcação</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            // data-altera: o clique na linha também conta como alteração (o aviso ao sair do modal).
            <tr key={l.chave} data-altera className={`cursor-pointer border-b border-gray-100 last:border-b-0 ${l.marcada ? "bg-yellow-50" : "hover:bg-gray-50"}`} onClick={l.onMarcar}>
              <td className="px-3 py-2">{l.controle}</td>
              <td className="px-3 py-2 font-medium text-gray-900">{l.nome}</td>
              <td className="px-3 py-2 text-gray-700">{l.ano}</td>
              <td className="px-3 py-2">{l.marcacao}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </fieldset>
  );
}
