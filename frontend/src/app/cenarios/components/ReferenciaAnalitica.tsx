"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, History } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

import { competenciasService } from "@/app/competencias/services/competenciasService";
import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";
import { plural } from "@/lib/texto";

import { cenariosService, rotuloVersao, type Cenario } from "../services/cenariosService";
import { AvisoMarcado, AvisoReajustesAplicados, estaTravado } from "./AvisoMarcado";
import { descreverFechadas } from "./descreverFechadas";
import { BotaoRealocar, QuadroDeRealocacoes } from "./RealocacoesDialog";
import { botaoPrimario, classeSelect, Erro, OpcaoEmLinha } from "./CenarioDialog";

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const abrev = (m: number) => MESES[m - 1].slice(0, 3);
const dataHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : null);

/**
 * A aba Referência de um cenário analítico (14/10/2026): outro cenário analítico (as premissas, os centros de custo, os
 * investimentos e os indicadores dele) ou o resultado realizado de um exercício — Mês a Mês ou a Média do Período —, que
 * carrega as Médias de Referência das premissas (15/10/2026: só elas; os meses ficam em branco), os grupos de centros de
 * custo, a depreciação base, o extra-operacional e os indicadores. A correspondência tarefa × linha fica nos Cadastros da
 * Controladoria / Linhas.
 */
export function ReferenciaAnalitica({ cenario, podeEditar = true, aviso }: { cenario: Cenario; podeEditar?: boolean; aviso?: string }) {
  const queryClient = useQueryClient();
  const [tipo, setTipo] = useState<"realizado" | "cenario">("realizado");
  const [confirmar, setConfirmar] = useState(false);
  const [avisos, setAvisos] = useState<string[] | null>(null);
  // O resultado realizado: o exercício, Mês a Mês ou a média de um período.
  const competencias = useQuery({ queryKey: ["competencias", "todos"], queryFn: () => competenciasService.listar() });
  const fechadas = (competencias.data?.itens ?? []).filter((c) => c.status === "FECHADA");
  const anos = [...new Set(fechadas.map((c) => c.ano))].sort((a, b) => b - a);
  const [anoEscolhido, setAno] = useState<number | null>(null);
  const ano = anoEscolhido ?? anos[0] ?? null;
  const mesesFechados = fechadas.filter((c) => c.ano === ano).map((c) => c.mes).sort((a, b) => a - b);
  const [modo, setModo] = useState<"MES_A_MES" | "MEDIA">("MEDIA");
  const [deEscolhido, setDe] = useState<number | null>(null);
  const [ateEscolhido, setAte] = useState<number | null>(null);
  const de = deEscolhido !== null && mesesFechados.includes(deEscolhido) ? deEscolhido : mesesFechados[0];
  const ate = ateEscolhido !== null && mesesFechados.includes(ateEscolhido) ? ateEscolhido : mesesFechados[mesesFechados.length - 1];
  const periodo = de && ate && de <= ate ? Array.from({ length: ate - de + 1 }, (_, k) => de + k) : [];
  const abertasNoPeriodo = periodo.filter((m) => !mesesFechados.includes(m));
  const periodoInvalido = modo === "MEDIA" && (!periodo.length || abertasNoPeriodo.length > 0);
  // Outro cenário analítico.
  const analiticos = useQuery({ queryKey: ["cenarios", "ANALITICO"], queryFn: () => cenariosService.listar("ANALITICO") });
  const outros = (analiticos.data ?? []).filter((c) => c.id !== cenario.id);
  const [origemEscolhida, setOrigem] = useState<string | null>(null);
  const origem = outros.find((c) => c.id === origemEscolhida) ?? outros[0] ?? null;
  // Manter os doze meses do cenário (11/11/2026, pedido do Adão): a referência muda só as Médias de Referência.
  const [manterMeses, setManterMeses] = useState(false);
  // O Quadro de Lotação Vigente (12/11/2026, pedido do Adão): no realizado, as linhas da aba Quadro de Lotação pelo QL Realizado
  // mais recente da Gestão de Colaboradores, qualquer que seja o período (De / Até).
  const [importarQuadro, setImportarQuadro] = useState(false);

  const aoCarregar = (msg: string, lista: string[]) => {
    queryClient.invalidateQueries({ queryKey: ["cenarios"] });
    queryClient.invalidateQueries({ queryKey: ["relatorios"] });
    toast.success(msg);
    setAvisos(lista);
    setConfirmar(false);
  };
  const carregar = useMutation({
    mutationFn: () =>
      tipo === "cenario"
        ? cenariosService.referenciaCenario(cenario.id, origem!.id, manterMeses).then(() => ({ avisos: [] as string[], vigente: "" }))
        : cenariosService
            .referenciaRealizado(cenario.id, ano!, modo === "MEDIA" ? { modo, de, ate, manterMeses, importarQuadro } : { modo, manterMeses, importarQuadro })
            .then((r) => ({
              avisos: r.avisos ?? [],
              // O Quadro de Lotação Vigente importado (12/11/2026), na mensagem.
              vigente: r.quadroVigente
                ? ` Quadro de Lotação Vigente importado: ${r.quadroVigente.colaboradores} colaboradores do fim de ${r.quadroVigente.competencia}, em ${r.quadroVigente.linhas} linhas.`
                : "",
            })),
    onSuccess: ({ avisos: lista, vigente }) =>
      aoCarregar(
        (manterMeses
          ? `Médias de Referência de ${tipo === "cenario" ? origem!.nome : `${ano} (${modo === "MEDIA" ? `${abrev(de)} a ${abrev(ate)}` : "Mês a Mês"})`} carregadas; os meses do cenário ficaram como estavam, e a DRE foi recalculada.`
          : tipo === "cenario"
            ? `${origem!.nome} carregado no cenário; a DRE foi recalculada.`
            : modo === "MEDIA"
              ? `Médias do realizado de ${ano} (${abrev(de)} a ${abrev(ate)}) carregadas: os meses do cenário ficaram em branco (use Replicar Médias, nas Premissas).`
              : `Resultado realizado de ${ano} carregado; a DRE foi recalculada.`) + vigente,
        lista,
      ),
  });
  const travado = estaTravado(cenario);
  // Com os reajustes aplicados na DRE (11/11/2026), a referência, que regrava as premissas, não se carrega nem se realoca.
  const bloqueada = travado || cenario.reajustesAplicados;
  // As ações do realizado (03/11/2026, pedido do Adão): o Carregar Realizado e, depois dele, o Realocar, na altura do De e do
  // Até (na Média do Período) ou sozinhos à direita (no Mês a Mês).
  const comCarregarRealizado = podeEditar && !bloqueada && tipo === "realizado" && anos.length > 0;
  const acoes = (
    <>
      <Button type="button" className={botaoPrimario} disabled={periodoInvalido} onClick={() => setConfirmar(true)}>
        <History className="size-4" />
        Carregar Realizado
      </Button>
      <BotaoRealocar cenario={cenario} podeEditar />
    </>
  );

  return (
    <section className="space-y-4 rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white p-5">
      <p className="text-sm text-gray-600">
        Opcional: uma base para as premissas do cenário, que depois se editam na tela Premissas. A DRE do cenário analítico é sempre calculada das
        premissas, dos centros de custo, dos investimentos e do extra-operacional. Os custos do realizado vão para as linhas pela Correspondência
        Tarefa × Linha (Cadastros da Controladoria / Linhas, botão “Tarefas”).
      </p>
      <p className="text-sm text-gray-700">
        Referência atual:{" "}
        {cenario.nomeArquivo ? (
          <span className="font-medium text-gray-900">
            {cenario.nomeArquivo}
            {cenario.importadoEm ? <span className="font-normal text-gray-500"> · em {dataHora(cenario.importadoEm)}</span> : null}
          </span>
        ) : (
          <span className="text-gray-500">nenhuma (as premissas são as digitadas na ferramenta)</span>
        )}
      </p>
      <fieldset className="space-y-2">
        <legend className="sr-only">Tipo da referência</legend>
        <OpcaoEmLinha
          nome="referencia-analitica"
          marcada={tipo === "realizado"}
          onMarcar={() => setTipo("realizado")}
          rotulo="Resultado Realizado"
          detalhe="As Médias de Referência das premissas (por linha e venda), os centros de custo, a depreciação, o extra-operacional e os indicadores das competências fechadas de um exercício."
          Icone={History}
        />
        <OpcaoEmLinha
          nome="referencia-analitica"
          marcada={tipo === "cenario"}
          onMarcar={() => setTipo("cenario")}
          rotulo="Cenário Analítico"
          detalhe="As premissas, os centros de custo, os investimentos e os indicadores de outro cenário analítico (os analíticos só importam de analíticos)."
          Icone={Copy}
        />
      </fieldset>
      {!podeEditar ? (
        <p className="rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-2 text-sm text-gray-600">{aviso ?? "Seu perfil só lê a referência."}</p>
      ) : travado ? (
        <AvisoMarcado cenario={cenario} oQue="a referência" />
      ) : cenario.reajustesAplicados ? (
        <AvisoReajustesAplicados oQue="a referência" />
      ) : (
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" className="mt-0.5 accent-black" checked={manterMeses} onChange={(e) => setManterMeses(e.target.checked)} />
          <span>
            <span className="font-medium text-gray-900">Manter os Valores dos Meses</span>
            <span className="block text-xs text-gray-600">
              {manterMeses
                ? "A referência muda só as Médias de Referência: os doze meses do cenário (digitados ou importados), os investimentos e as linhas do Quadro de Lotação ficam como estão."
                : "Desmarcada, a referência substitui também os doze meses do cenário (os valores digitados ou importados se perdem)."}
            </span>
          </span>
        </label>
      )}
      {!podeEditar || bloqueada ? null : tipo === "cenario" ? (
        outros.length === 0 ? (
          <p className="rounded-sm border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-900">Nenhum outro cenário analítico.</p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1 space-y-1.5">
              <Label htmlFor="ref-cenario">Cenário</Label>
              <select id="ref-cenario" value={origem?.id ?? ""} onChange={(e) => setOrigem(e.target.value)} className={classeSelect}>
                {outros.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome} {rotuloVersao(c.versao)} · {c.ano}
                  </option>
                ))}
              </select>
            </div>
            <Button type="button" className={botaoPrimario} onClick={() => setConfirmar(true)}>
              <Copy className="size-4" />
              Carregar Cenário
            </Button>
          </div>
        )
      ) : anos.length === 0 ? (
        <p className="rounded-sm border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-900">Nenhuma competência fechada ainda.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ref-ano">Exercício</Label>
              <select id="ref-ano" value={ano ?? ""} onChange={(e) => setAno(Number(e.target.value))} className={`${classeSelect} w-32`}>
                {anos.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <p className="min-w-0 flex-1 pb-2 text-xs text-gray-600">
              {descreverFechadas(mesesFechados)}
            </p>
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-sm leading-none font-medium">Importação</legend>
            {(
              [
                [
                  "MEDIA",
                  "Média do Período",
                  `As Médias de Referência de um período (os centros de custo, cada conta só nos meses com movimentação)${manterMeses ? "; os meses do cenário ficam como estão." : ": os meses do cenário ficam em branco, para replicar as médias (Premissas / Replicar Médias) ou digitar."}`,
                ],
                [
                  "MES_A_MES",
                  "Mês a Mês",
                  manterMeses
                    ? "As Médias de Referência de todos os meses fechados; os meses do cenário ficam como estão."
                    : "As Médias de Referência de todos os meses fechados e, nos centros de custo, na depreciação, no extra-operacional e nos indicadores, cada competência fechada no mês dela.",
                ],
              ] as const
            ).map(([v, rotulo, detalhe]) => (
              <OpcaoEmLinha key={v} nome="modo-realizado-analitico" marcada={modo === v} onMarcar={() => setModo(v)} rotulo={rotulo} detalhe={detalhe} />
            ))}
          </fieldset>
          {/* O Quadro de Lotação Vigente (12/11/2026): os colaboradores do cenário vêm só da aba Quadro de Lotação (a Gestão de Colaboradores). */}
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" className="mt-0.5 accent-black" checked={importarQuadro} onChange={(e) => setImportarQuadro(e.target.checked)} />
            <span>
              <span className="font-medium text-gray-900">Importar Quadro de Lotação Vigente</span>
              <span className="block text-xs text-gray-600">
                {importarQuadro
                  ? "As linhas da aba Quadro de Lotação (Premissas) passam a ser as do Quadro de Lotação mais recente da Gestão de Colaboradores — os colaboradores do fim da competência mais recente, em todos os meses —, qualquer que seja o período escolhido (De / Até). Os salários das linhas que o cenário já tinha ficam."
                  : "Desmarcada, as linhas da aba Quadro de Lotação ficam como estão. Os colaboradores do cenário vêm só dessa aba (a referência não os traz)."}
              </span>
            </span>
          </label>
          {modo === "MEDIA" ? (
            <div className="flex flex-wrap items-end gap-3">
              {(
                [
                  ["ref-de", "De", de, setDe],
                  ["ref-ate", "Até", ate, setAte],
                ] as const
              ).map(([idCampo, rotulo, valor, mudar]) => (
                <div key={idCampo} className="space-y-1.5">
                  <Label htmlFor={idCampo}>{rotulo}</Label>
                  <select id={idCampo} value={valor ?? ""} onChange={(e) => mudar(Number(e.target.value))} className={`${classeSelect} w-36`}>
                    {mesesFechados.map((m) => (
                      <option key={m} value={m}>
                        {MESES[m - 1]}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <p className={`min-w-0 flex-1 pb-2 text-xs ${periodoInvalido ? "text-red-700" : "text-gray-600"}`}>
                {!periodo.length
                  ? "O mês inicial vem depois do final."
                  : abertasNoPeriodo.length
                    ? `O período tem ${plural(abertasNoPeriodo.length, "um mês", "meses")} sem competência fechada: ${abertasNoPeriodo.map((m) => MESES[m - 1]).join(", ")}.`
                    : `A média de ${periodo.length} ${plural(periodo.length, "mês", "meses")}, ${de === ate ? MESES[de - 1] : `de ${MESES[de - 1]} a ${MESES[ate - 1]}`}.`}
              </p>
              {acoes}
            </div>
          ) : (
            <div className="flex flex-wrap items-end justify-end gap-3">{acoes}</div>
          )}
        </div>
      )}
      {/* O que não coube nas premissas na última carga (com o destaque vermelho dos avisos). */}
      {avisos && avisos.length ? (
        <div className="rounded-sm border border-l-4 border-gray-200 border-l-red-600 bg-white px-4 py-3 text-sm text-gray-700">
          <p className="font-medium text-gray-900">Avisos da Referência Carregada</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* As movimentações fora dos padrões da última carga do realizado e as realocações delas (14/10/2026); o Realocar fica ao lado do Carregar Realizado, quando ele está na tela. */}
      <QuadroDeRealocacoes cenario={cenario} podeEditar={podeEditar && !bloqueada} comBotao={!comCarregarRealizado} />

      {confirmar ? (
        <Dialog open onOpenChange={(o) => (!o ? setConfirmar(false) : undefined)}>
          <DialogContent className="rounded-sm sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{tipo === "cenario" ? "Carregar Cenário Analítico" : "Carregar Resultado Realizado"}</DialogTitle>
              <DialogDescription render={<div />}>
                <ul className="list-disc space-y-1.5 pl-5">
                  {manterMeses ? (
                    <>
                      <li>
                        As Médias de Referência das premissas, dos centros de custo, da depreciação base, do extra-operacional e dos indicadores passam a
                        ser {tipo === "cenario" ? `as de ${origem?.nome}` : `as do realizado de ${ano} (${modo === "MEDIA" ? `${abrev(de)} a ${abrev(ate)}` : mesesFechados.map(abrev).join(", ")})`}.
                      </li>
                      <li>
                        Os doze meses do cenário (digitados ou importados), os investimentos e as linhas do Quadro de Lotação ficam como estão; o
                        Justificar? do Exportar Premissas passa a comparar os meses com as médias novas.
                      </li>
                      <li>A DRE do cenário é recalculada.</li>
                    </>
                  ) : tipo === "cenario" ? (
                    <>
                      <li>
                        As premissas, os centros de custo, os investimentos e os indicadores do cenário são substituídos pelos de {origem?.nome}
                        {origem && origem.ano !== cenario.ano ? ` (de ${origem.ano}: os meses vão para os mesmos meses de ${cenario.ano})` : ""}.
                      </li>
                      <li>A DRE do cenário é recalculada.</li>
                    </>
                  ) : (
                    <>
                      <li>
                        As premissas são substituídas pelas Médias de Referência do realizado de {ano} (
                        {modo === "MEDIA" ? `${abrev(de)} a ${abrev(ate)}` : mesesFechados.map(abrev).join(", ")}), por linha e venda (a demanda diária é o volume médio ÷ os dias úteis), e os doze meses
                        ficam em branco. Os dias úteis e os ajustes voltam ao padrão.
                      </li>
                      <li>
                        Os centros de custo, a depreciação base e o extra-operacional são substituídos pelos do realizado
                        {modo === "MEDIA" ? ": só as Médias de Referência, com os meses em branco" : ": as Médias de Referência e cada mês fechado no seu mês"}; os indicadores manuais, do mesmo jeito.
                      </li>
                      <li>Os investimentos ficam. A DRE do cenário é recalculada.</li>
                    </>
                  )}
                  {tipo === "realizado" ? (
                    importarQuadro ? (
                      <li>
                        As linhas da aba Quadro de Lotação são trocadas pelas do Quadro de Lotação mais recente da Gestão de Colaboradores (os colaboradores do fim
                        da competência mais recente, em todos os meses; os salários das linhas que já havia ficam): os colaboradores e as Remunerações dos centros
                        de custo saem delas.
                      </li>
                    ) : (
                      <li>As linhas da aba Quadro de Lotação ficam como estão: os colaboradores e as Remunerações dos centros de custo saem delas.</li>
                    )
                  ) : null}
                  {manterMeses ? null : <li>Os valores digitados nas premissas se perdem (para mantê-los, marque “Manter os Valores dos Meses”).</li>}
                </ul>
              </DialogDescription>
            </DialogHeader>
            <Erro erro={carregar.isError ? mensagemDeErro(carregar.error, "Não foi possível carregar a referência.") : null} />
            <DialogFooter>
              <Button type="button" variant="outline" className="rounded-sm" onClick={() => setConfirmar(false)}>
                Cancelar
              </Button>
              <Button type="button" className={botaoPrimario} disabled={carregar.isPending} onClick={() => carregar.mutate()}>
                {carregar.isPending ? "Carregando…" : "Carregar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}
