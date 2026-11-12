"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudCheck, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { Quadradinho } from "@/app/relatorios/components/GraficoRealizadoOrcado";
import { mensagemDeErro, type MarcacaoComparavel } from "@/app/relatorios/services/relatoriosService";
import { Erro } from "@/app/cenarios/components/CenarioDialog";
import { rotuloMarcacao } from "@/app/cenarios/services/cenariosService";

import type { ConfiguracoesDoRelatorio as Configuracoes } from "../services/relatoriosExecutivosService";
import { CENARIOS_DO_PROVA } from "./cenariosDoProva";
import { useProcesso } from "./processo";

/** A chave da aba Configurações na barra do relatório (22/10/2026): antes da Capa, sem páginas e sem slides. */
export const CONFIGURACOES = "CONFIGURACOES";

type Mudanca = { cenarioComparadoId: string | null } | { comparacaoProva: MarcacaoComparavel[] };
type Cenario = Configuracoes["cenarios"][number];

/**
 * A aba Configurações do relatório (22/10/2026): preliminar à apresentação — não tem páginas, não conta nos slides e não
 * entra na tela inteira nem no PDF. Dois grupos (31/10/2026, pedido do Adão): a Comparação Padrão — o cenário de comparação
 * dos objetos padrão (os Cards Padrão e as Tabelas Padrão); de início, o cenário marcado como Orçamento Empresarial (a
 * marcação pode mudar de cenário: o relatório pode escolher um dos cenários marcados, de qualquer exercício, e fica com
 * ele) — e a Comparação PROVA — os cenários dos objetos PROVA (os Cards PROVA e as Tabelas PROVA), dois ou mais dos
 * marcados; de início, todos. Quem edita a tela escolhe, e a escolha se salva na hora; os demais só veem. Nos Painéis de
 * Bordo (31/10/2026), as mesmas comparações, na aba Comparativos das Configurações deles (01/11/2026), com os grupos nos
 * destaques das Configurações dos cenários (`destaque`: a faixa amarelo-ouro à esquerda). No painel com a competência
 * automática (03/11/2026), a Comparação Padrão vale pela marcação do cenário escolhido, como a PROVA.
 */
export function ConfiguracoesDoRelatorio({ relatorioId, destaque = false }: { relatorioId: string; destaque?: boolean }) {
  const secao = `space-y-4 rounded-sm border border-gray-200 bg-white p-5${destaque ? " border-l-4 border-l-bpm-primary" : ""}`;
  const queryClient = useQueryClient();
  const { rota, servico, documento, semEdicao } = useProcesso();
  const consulta = useQuery({ queryKey: [rota, "configuracoes", relatorioId], queryFn: () => servico.configuracoes(relatorioId) });
  // As escolhas em gravação; undefined: as gravadas.
  const [escolhido, setEscolhido] = useState<string | null | undefined>(undefined);
  const [prova, setProva] = useState<MarcacaoComparavel[] | undefined>(undefined);
  const [salvoEm, setSalvoEm] = useState<Date | null>(null);
  const gravar = useMutation({
    mutationFn: (m: Mudanca) => servico.gravarConfiguracoes(relatorioId, m),
    // Recusada, a escolha volta à gravada.
    onError: () => {
      setEscolhido(undefined);
      setProva(undefined);
    },
    onSuccess: (c, m) => {
      queryClient.setQueryData([rota, "configuracoes", relatorioId], c);
      // Os cards e as tabelas mudam de comparado.
      queryClient.invalidateQueries({ queryKey: [rota, "dados", relatorioId] });
      queryClient.invalidateQueries({ queryKey: [rota, "resultados", relatorioId] });
      setEscolhido(undefined);
      setProva(undefined);
      setSalvoEm(new Date());
      toast.success(
        "comparacaoProva" in m
          ? "Configurações salvas: os objetos PROVA usam os cenários marcados."
          : c.automatica
            ? "Configurações salvas: os objetos padrão acompanham a marcação do cenário escolhido."
            : "Configurações salvas: os objetos padrão usam o cenário escolhido.",
      );
    },
  });
  if (consulta.isError) return <Erro erro={mensagemDeErro(consulta.error, "Erro ao carregar as configurações.")} />;
  if (!consulta.data) return <div className="h-64 animate-pulse rounded-sm bg-gray-100" />;
  const c = consulta.data;
  const travado = !c.podeEditar || gravar.isPending;
  // Sem cenário escolhido (o relatório acompanha a marcação), o marcado como Orçamento fica em destaque na lista.
  const atual = escolhido === undefined ? (c.cenarioComparadoId ?? c.marcado?.id ?? null) : escolhido;
  const escolher = (id: string) => {
    if (travado || id === atual) return;
    setEscolhido(id);
    gravar.mutate({ cenarioComparadoId: id });
  };
  // Os cenários da Comparação PROVA, na ordem do PROVA (um por marcação); os marcados: os gravados ou, sem eles, todos.
  const daProva = CENARIOS_DO_PROVA.flatMap((p) => {
    const cenario = c.cenarios.find((x) => x.marcacao === p.marcacao);
    return cenario ? [{ ...p, cenario }] : [];
  });
  const marcadosProva = prova ?? (c.comparacaoProva.length ? c.comparacaoProva : daProva.map((p) => p.marcacao));
  const alternarProva = (m: MarcacaoComparavel) => {
    if (travado) return;
    const novos = marcadosProva.includes(m) ? marcadosProva.filter((x) => x !== m) : [...marcadosProva, m];
    // Dois ou mais: o penúltimo não se desmarca.
    if (novos.length < 2) return;
    const ordenados = CENARIOS_DO_PROVA.map((p) => p.marcacao).filter((x) => novos.includes(x));
    setProva(ordenados);
    gravar.mutate({ comparacaoProva: ordenados });
  };
  return (
    <div className="space-y-6">
      <section className={secao}>
        <div>
          <h2 className="text-base font-bold text-gray-900">Comparação Padrão</h2>
          {c.automatica ? (
            // O painel automático: a comparação pela marcação, que acompanha o cenário do exercício novo.
            <p className="mt-1 text-sm text-gray-600">
              O orçado dos Cards Padrão (Painel de Bordo e Indicadores: o destaque do desvio e os gráficos) e das Tabelas Padrão. Com a competência
              automática, vale a marcação do cenário escolhido: se ela passar para outro cenário (por exemplo, o do exercício novo), os objetos padrão
              comparam com ele. De início, a marcação Orçamento. A lista traz os cenários com marcação.
            </p>
          ) : (
            <p className="mt-1 text-sm text-gray-600">
              O orçado dos Cards Padrão (Painel de Bordo e Indicadores: o destaque do desvio e os gráficos) e das Tabelas Padrão. De início, o cenário marcado
              como Orçamento (o {documento} acompanha a marcação até que se escolha um cenário); num cenário de outro exercício, valem os mesmos meses dele. A
              lista traz os cenários com marcação.
            </p>
          )}
          {/* Sem cenário escolhido e sem o marcado na lista: o que vale hoje. */}
          {c.cenarioComparadoId === null && !c.cenarios.some((x) => x.id === c.marcado?.id) ? (
            <p className="mt-1 text-sm text-gray-600">
              {c.marcado ? `Hoje, o ${documento} compara com ${c.marcado.nome}, o cenário marcado como Orçamento.` : "Nenhum cenário está marcado como Orçamento: escolha um cenário para os cards terem o orçado."}
            </p>
          ) : null}
        </div>
        <TabelaDeCenarios
          legenda="Comparação Padrão"
          cenarios={c.cenarios}
          travado={travado}
          escolha={(x) => ({
            marcada: atual === x.id,
            onMarcar: () => escolher(x.id),
            controle: (
              <input type="radio" name="comparacao-padrao" className="size-4 accent-black" checked={atual === x.id} onChange={() => escolher(x.id)} onClick={(e) => e.stopPropagation()} aria-label="Escolher" />
            ),
          })}
        />
      </section>
      <section className={secao}>
        <div>
          <h2 className="text-base font-bold text-gray-900">Comparação PROVA</h2>
          <p className="mt-1 text-sm text-gray-600">
            Os cenários dos Cards PROVA e das Tabelas PROVA, lado a lado, cada um com a cor dele: dois ou mais dos cenários marcados (Forecast, Orçado,
            Vendido e Anterior). De início, todos. A comparação acompanha as marcações: se uma marcação passar para outro cenário, os objetos PROVA
            comparam com ele.
          </p>
          {daProva.length < 2 ? (
            <p className="mt-1 text-sm text-gray-600">
              {daProva.length ? "Só um cenário está marcado: os objetos PROVA comparam com ele." : "Nenhum cenário está marcado: os objetos PROVA ficam sem comparação."} Marque os
              cenários em Análises Gerenciais / Cenários Sintéticos.
            </p>
          ) : null}
        </div>
        <TabelaDeCenarios
          legenda="Comparação PROVA"
          cenarios={daProva.map((p) => p.cenario)}
          travado={travado || daProva.length < 2}
          prova
          escolha={(x) => {
            const m = x.marcacao as MarcacaoComparavel;
            const marcada = marcadosProva.includes(m);
            // Com dois marcados, eles não se desmarcam.
            const preso = marcada && marcadosProva.length <= 2;
            return {
              marcada,
              onMarcar: () => alternarProva(m),
              controle: (
                <input
                  type="checkbox"
                  className="size-4 accent-black"
                  checked={marcada}
                  disabled={preso}
                  title={preso ? "A Comparação PROVA tem dois ou mais cenários: marque outro antes de desmarcar este." : undefined}
                  onChange={() => alternarProva(m)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Comparar"
                />
              ),
            };
          }}
        />
      </section>
      {c.podeEditar ? (
        <p className="flex items-center justify-end gap-1.5 text-sm text-gray-500" role="status">
          {gravar.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <CloudCheck className="size-4" />}
          {gravar.isPending ? "Salvando…" : salvoEm ? `Salvo às ${salvoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "As escolhas se salvam sozinhas."}
        </p>
      ) : (
        <p className={destaque ? "rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-2 text-sm text-gray-600" : "text-xs text-gray-500"}>{semEdicao}</p>
      )}
      <Erro erro={gravar.isError ? mensagemDeErro(gravar.error, "Não foi possível salvar as configurações.") : null} />
    </div>
  );
}

/** A marcação em destaque: o amarelo-ouro da BPM. */
const ETIQUETA_DA_MARCACAO = "border-bpm-primary bg-bpm-primary text-black";
const DO_PROVA = new Map(CENARIOS_DO_PROVA.map((p) => [p.marcacao as string, p]));

function Etiqueta({ classe, children }: { classe: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap ${classe}`}>{children}</span>;
}

/**
 * A lista dos cenários das duas comparações: a escolha (o botão de opção ou a caixa), o cenário, o ano, o tipo e a
 * marcação em etiquetas; na Comparação PROVA, a marcação com o nome e o quadradinho da cor dela nos objetos PROVA.
 */
function TabelaDeCenarios({
  legenda,
  cenarios,
  travado,
  prova = false,
  escolha,
}: {
  legenda: string;
  cenarios: Cenario[];
  travado: boolean;
  prova?: boolean;
  /** A escolha de cada cenário: se está escolhido, o que o clique na linha faz e o controle (o botão de opção ou a caixa). */
  escolha: (x: Cenario) => { marcada: boolean; onMarcar: () => void; controle: React.ReactNode };
}) {
  return (
    <fieldset disabled={travado} className="overflow-x-auto rounded-sm border border-gray-200">
      <legend className="sr-only">{legenda}</legend>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-bold tracking-wide text-gray-700 uppercase">
            <th className="w-10 px-3 py-2" />
            <th className="px-3 py-2">Cenário</th>
            <th className="w-20 px-3 py-2">Ano</th>
            <th className="w-32 px-3 py-2">Tipo</th>
            <th className="px-3 py-2">Marcação</th>
          </tr>
        </thead>
        <tbody>
          {cenarios.length ? (
            cenarios.map((x) => {
              const e = escolha(x);
              const doProva = x.marcacao ? DO_PROVA.get(x.marcacao) : undefined;
              return (
                // O clique em qualquer lugar da linha a escolhe (ou marca); a escolhida, em destaque.
                <tr key={x.id} className={`cursor-pointer border-b border-gray-100 last:border-b-0 ${e.marcada ? "bg-yellow-50" : "hover:bg-gray-50"}`} onClick={travado ? undefined : e.onMarcar}>
                  <td className="px-3 py-2">{e.controle}</td>
                  <td className="px-3 py-2 font-medium text-gray-900">{x.nome}</td>
                  <td className="px-3 py-2 text-gray-700">{x.ano}</td>
                  <td className="px-3 py-2">
                    <Etiqueta classe={x.tipo === "ANALITICO" ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-gray-100 text-gray-800"}>{x.tipo === "ANALITICO" ? "Analítico" : "Sintético"}</Etiqueta>
                  </td>
                  <td className="px-3 py-2">
                    {prova && doProva ? (
                      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                        <Quadradinho cor={doProva.cor} />
                        {doProva.rotulo}
                      </span>
                    ) : x.marcacao ? (
                      <Etiqueta classe={ETIQUETA_DA_MARCACAO}>{rotuloMarcacao(x.marcacao)}</Etiqueta>
                    ) : null}
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={5} className="px-3 py-3 text-sm text-gray-500">
                Nenhum cenário marcado.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </fieldset>
  );
}

