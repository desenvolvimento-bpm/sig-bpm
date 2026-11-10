"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { CampoBusca } from "@/components/shared/Filtros";

import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";

import { cenariosService, type ContasDoCentro, type LinhaDaPremissa, type RateiosDoCenario as Rateios, type SerieDoCentro } from "../services/cenariosService";
import { Erro } from "./CenarioDialog";
import { TabelaEditavel } from "./TabelaPremissas";
import { plural } from "@/lib/texto";

const Carregando = () => <div className="h-64 animate-pulse rounded-sm bg-gray-100" />;
const reais = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

/**
 * A aba Centros de Custo das premissas de um cenário analítico (13/10/2026), como a de Resultados Empresariais: os grupos
 * da Controladoria à esquerda (com a busca e o total do exercício; sem os centros de estoque e de investimento) e, à
 * direita, a tabela Premissas do grupo (19/10/2026: uma tabela só, antes Quadro e Conta), mês a mês, para digitar: o
 * Quadro de Lotação (Colaboradores CLT e PJ e o Total de Colaboradores, de onde saem os quadros de lotação dos
 * indicadores), os Encargos e Benefícios (os percentuais e os Benefícios Adicionais) e as contas (mão de obra e gastos
 * gerais, por atribuição; a Encargos e Benefícios, calculada). O grupo com centros de baldes diferentes traz o aviso: o
 * valor vai pelo balde mais comum. O grupo com linhas na aba Quadro de Lotação (09/11/2026) tem os colaboradores, as
 * Remunerações CLT e PJ e os Salários dos Aprendizes calculados por elas, com o aviso.
 */
export function CentrosDoCenario({ id, editavel }: { id: string; editavel: boolean }) {
  const [busca, setBusca] = useState("");
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const lista = useQuery({ queryKey: ["cenarios", id, "centros"], queryFn: () => cenariosService.centros(id) });
  const grupos = [...(lista.data?.grupos ?? [])].sort((a, b) => a.grupo.localeCompare(b.grupo, "pt-BR"));
  const grupo = (escolhido && grupos.some((g) => g.grupo === escolhido) ? escolhido : grupos[0]?.grupo) ?? null;
  const contas = useQuery({ queryKey: ["cenarios", id, "centros", grupo], queryFn: () => cenariosService.centro(id, grupo!), enabled: grupo !== null });
  if (lista.isError) return <Erro erro={mensagemDeErro(lista.error, "Erro ao carregar os centros de custo.")} />;
  if (lista.isPending) return <Carregando />;
  const dados = lista.data;
  const t = busca.trim().toLowerCase();
  const filtrados = grupos.filter((g) => !t || `${g.grupo} ${g.centros.map((c) => `${c.codigo ?? ""} ${c.nome}`).join(" ")}`.toLowerCase().includes(t));
  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start">
      <div className="rounded-sm border border-gray-200 bg-white">
        <div className="border-b border-gray-200 p-2">
          <CampoBusca rotulo="Buscar centro de custo" valor={busca} onMudar={setBusca} placeholder="Centro de Custo ou código…" largura="w-full" />
        </div>
        <ul className="max-h-[70vh] overflow-y-auto py-1" aria-label="Centros de custo">
          {filtrados.map((g) => (
            <li key={g.grupo}>
              <button
                type="button"
                onClick={() => setEscolhido(g.grupo)}
                aria-current={g.grupo === grupo ? "true" : undefined}
                title={`${g.grupo} · ${g.destino}${g.baldes.length > 1 ? " · centros de baldes diferentes" : ""}`}
                className={`flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm ${g.grupo === grupo ? "bg-black text-white" : "text-gray-800 hover:bg-gray-100"}`}
              >
                <span className="min-w-0 truncate">
                  {g.grupo}
                  {g.baldes.length > 1 ? <span className={g.grupo === grupo ? "text-yellow-300" : "text-red-700"}> *</span> : null}
                </span>
                {g.total ? <span className={`shrink-0 text-xs ${g.grupo === grupo ? "text-white/80" : "text-gray-500"}`}>{reais(g.total)}</span> : null}
              </button>
            </li>
          ))}
          {filtrados.length === 0 ? <li className="px-3 py-2 text-sm text-gray-500">Nenhum centro com esse nome.</li> : null}
        </ul>
      </div>
      <div className="min-w-0 space-y-3">
        {/* 20/10/2026: sem o Exportar do grupo (repetia o Exportar Premissas, ao lado do título da tela). */}
        {contas.isError ? (
          <Erro erro={mensagemDeErro(contas.error, "Erro ao carregar o centro de custo.")} />
        ) : contas.isPending || !contas.data ? (
          <Carregando />
        ) : (
          <>
            {contas.data.grupo.baldes.length > 1 ? (
              <p className="rounded-sm border border-l-4 border-gray-200 border-l-red-600 bg-white px-4 py-2 text-sm text-gray-700">
                Os centros deste grupo têm baldes diferentes ({contas.data.grupo.baldes.join(", ")}): o valor vai pelo balde mais comum,{" "}
                {contas.data.grupo.balde ?? "—"}. Revise o agrupamento no cadastro Centros de Custo para que o grupo tenha um balde só.
              </p>
            ) : null}
            {contas.data.lotacao.linhasDoQuadro ? (
              <p className="rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-2 text-sm text-gray-700">
                Este grupo tem {contas.data.lotacao.linhasDoQuadro} {plural(contas.data.lotacao.linhasDoQuadro, "linha", "linhas")} na aba Quadro de Lotação: os
                Colaboradores CLT e PJ, as Remunerações CLT e PJ e os Salários dos Aprendizes vêm de lá e não se digitam aqui.
              </p>
            ) : null}
            <TabelaEditavel
              key={grupo ?? ""}
              titulo={contas.data.grupo.grupo}
              subtitulo={`${contas.data.grupo.centros.map((c) => c.codigo ?? c.nome).join(", ")} · Balde ${contas.data.grupo.balde ?? "—"} · Vai para: ${contas.data.grupo.destino}`}
              meses={dados.meses}
              linhas={linhasDoCentro(contas.data)}
              editavel={editavel && dados.editavel}
              item={["linha", "linhas"]}
              cabecalho="PREMISSAS"
              aoGravar={(alteracoes, origem) => cenariosService.gravarCentro(id, grupo!, alteracoes, origem)}
              mensagem={(n) => `${n} ${plural(n, "valor", "valores")} do centro ${plural(n, "gravado", "gravados")}; a DRE e os quadros de lotação do cenário foram recalculados.`}
            />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * As linhas da tabela Premissas do grupo (19/10/2026): o Quadro de Lotação (Colaboradores CLT e PJ e o Total de
 * Colaboradores, a soma), os Encargos e Benefícios e as contas por atribuição (a Encargos e Benefícios, calculada), com o
 * total do centro no fim.
 */
function linhasDoCentro(dados: ContasDoCentro): LinhaDaPremissa[] {
  const { clt, pj } = dados.lotacao;
  // Com linhas na aba Quadro de Lotação (09/11/2026), os colaboradores são calculados.
  const doQuadro = dados.lotacao.linhasDoQuadro > 0;
  const premissa = (chave: string, secao: string, rotulo: string, und: string, casas: number, x: SerieDoCentro): LinhaDaPremissa => ({
    chave,
    secao,
    grupo: null,
    rotulo,
    und,
    tipo: "PREMISSA",
    casas,
    referencia: x.referencia,
    valores: x.valores,
    gravados: x.gravados,
  });
  const lotacao: LinhaDaPremissa[] = [
    { ...premissa("LOTACAO|CLT", "QUADRO DE LOTAÇÃO", "Colaboradores CLT", "colab.", 0, clt), ...(doQuadro ? { tipo: "CALCULO" as const } : {}) },
    { ...premissa("LOTACAO|PJ", "QUADRO DE LOTAÇÃO", "Colaboradores PJ", "colab.", 0, pj), ...(doQuadro ? { tipo: "CALCULO" as const } : {}) },
    {
      chave: "LOTACAO|TOTAL",
      secao: "QUADRO DE LOTAÇÃO",
      grupo: null,
      rotulo: "Total de Colaboradores",
      und: "colab.",
      tipo: "CALCULO",
      negrito: true,
      casas: 0,
      referencia: clt.referencia === null && pj.referencia === null ? null : (clt.referencia ?? 0) + (pj.referencia ?? 0),
      valores: clt.valores.map((v, k) => v + (pj.valores[k] ?? 0)),
      gravados: clt.valores.map(() => false),
    },
    // Os Salários dos Aprendizes de cada mão de obra (a base do FGTS Aprendiz), da aba Quadro de Lotação.
    ...dados.aprendizes.map(
      (a): LinhaDaPremissa => ({
        chave: `LOTACAO|APRENDIZ|${a.prefixo}`,
        secao: "QUADRO DE LOTAÇÃO",
        grupo: null,
        rotulo: a.rotulo,
        und: "R$",
        tipo: "CALCULO",
        negrito: false,
        casas: 2,
        referencia: null,
        valores: a.valores,
        gravados: a.valores.map(() => false),
      }),
    ),
  ];
  const encargos = dados.encargos.map((e) => premissa(`ENCARGOS|${e.item}`, "ENCARGOS E BENEFÍCIOS", e.rotulo, e.und, 2, e));
  const contas = dados.contas;
  const linhas: LinhaDaPremissa[] = contas.map((c) => ({
    chave: c.codigo,
    secao: c.atribuicao.toUpperCase(),
    grupo: null,
    rotulo: c.descricao,
    und: "R$",
    // A Encargos e Benefícios é calculada (19/10/2026; 20/10/2026: com a incidência sobre as provisões; encargosCenario.ts), e as
    // Remunerações dos grupos com linhas na aba Quadro de Lotação (09/11/2026).
    tipo: c.calculada ? "CALCULO" : "PREMISSA",
    negrito: false,
    casas: 2,
    // A Média de Referência da conta (15/10/2026).
    referencia: c.referencia,
    valores: c.valores,
    gravados: c.gravados,
  }));
  const total = Array.from({ length: 12 }, (_, k) => contas.reduce((s, c) => s + (c.valores[k] ?? 0), 0));
  const totalReferencia = contas.some((c) => c.referencia !== null) ? contas.reduce((s, c) => s + (c.referencia ?? 0), 0) : null;
  return [...lotacao, ...encargos, ...linhas, { chave: "TOTAL", secao: "TOTAL DO CENTRO", grupo: null, rotulo: "Total do Centro", und: "R$", tipo: "CALCULO", casas: 2, referencia: totalReferencia, valores: total, gravados: total.map(() => false) }];
}

/**
 * O aviso dos rateios sem base (13/10/2026): os grupos de rateio com valor num mês em que a chave não tem base nas
 * premissas — todo custo e despesa deve ir para algum lugar, e esses ficam fora da DRE do cenário. Some quando não há.
 */
export function AvisoRateiosSemBase({ id }: { id: string }) {
  const consulta = useQuery({ queryKey: ["cenarios", id, "rateios"], queryFn: () => cenariosService.rateios(id) });
  const sem = consulta.data?.semBase ?? [];
  if (!sem.length) return null;
  const porChave = new Map<string, typeof sem>();
  for (const x of sem) porChave.set(x.nome, [...(porChave.get(x.nome) ?? []), x]);
  return (
    <div className="rounded-sm border border-l-4 border-gray-200 border-l-red-600 bg-white px-4 py-3 text-sm text-gray-700">
      <p className="font-medium text-gray-900">Rateio sem base nas premissas</p>
      <ul className="mt-1 list-disc pl-5">
        {[...porChave].map(([nome, xs]) => (
          <li key={nome}>
            {nome}: {xs.map((x) => `${x.rotuloMes} (${reais(x.valor)})`).join(", ")} — o valor dos centros de custo desse rateio não vai para nenhuma unidade.
            Preencha nas premissas a base da chave nesses meses (aba Rateios) ou revise o balde do grupo.
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A aba Rateios das premissas de um cenário analítico (13/10/2026): por chave e destino, a base de cada mês (das
 * premissas) e o percentual, que leva o valor dos grupos de rateio às unidades. Só leitura: muda com as premissas.
 */
export function RateiosDoCenario({ id }: { id: string }) {
  const consulta = useQuery({ queryKey: ["cenarios", id, "rateios"], queryFn: () => cenariosService.rateios(id) });
  if (consulta.isError) return <Erro erro={mensagemDeErro(consulta.error, "Erro ao carregar os rateios.")} />;
  if (consulta.isPending) return <Carregando />;
  return (
    <TabelaEditavel
      titulo="Rateios"
      subtitulo="Bases das premissas: Produção pelo m³ produzido; Projeto pelo m³ produzido da venda Global; Metalurgia e Armadura pelo kg das linhas (o volume × a Metalúrgica (Interno) Unit. ou a Armadura (Interno) Unit.); Acompanhamento pelos Acompanhamentos por Dia de Serviços. Sem base no mês, o percentual é zero."
      meses={consulta.data.meses}
      linhas={linhasDosRateios(consulta.data.rateios)}
      editavel={false}
      comReferencia={false}
      cabecalho="CHAVE E DESTINO"
    />
  );
}

/** Os rateios como linhas da tabela: por chave, o destino com a base e o percentual. */
function linhasDosRateios(rateios: Rateios["rateios"]): LinhaDaPremissa[] {
  return rateios.flatMap((r) => {
    const secao = r.rotulo.split(":")[0].toUpperCase();
    const grupo = r.rotulo.split(": ")[1] ?? r.rotulo;
    const linha = (chave: string, rotulo: string, und: string, valores: number[]): LinhaDaPremissa => ({
      chave,
      secao,
      grupo,
      rotulo,
      und,
      tipo: "CALCULO",
      casas: 2,
      referencia: null,
      valores,
      gravados: valores.map(() => false),
    });
    return [linha(`${r.chave}|${r.destino}|BASE`, "Base", r.base, r.bases), linha(`${r.chave}|${r.destino}`, "Percentual", "%", r.percentuais.map((p) => p * 100))];
  });
}
