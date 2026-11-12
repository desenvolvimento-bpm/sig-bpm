"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { TabelaResultados } from "@/app/relatorios/resultados/ResultadosContent";
import { mensagemDeErro, type LinhaResultado, type MarcacaoComparavel } from "@/app/relatorios/services/relatoriosService";
import { botaoPrimario, OpcaoEmLinha } from "@/app/cenarios/components/CenarioDialog";
import { estrutura, linhasDaDRE, NIVEIS, RECUO, semPrimeiroTotalDaRol, type Nivel } from "@/app/competencias/[anoMes]/dre/components/NiveisDRE";

import { VISOES_DA_TABELA, type Bloco, type ColunasDaTabela, type VisaoDaTabela } from "../services/relatoriosExecutivosService";
import { comCor, ehProva, ESTILOS_NA_TABELA, listaDosCenarios } from "./cenariosDoProva";
import { useProcesso } from "./processo";

type BlocoTabela = Extract<Bloco, { tipo: "TABELA" }>;
/**
 * As opções da tabela: a visão, o nível, as linhas escolhidas (sem elas, todas), os meses anteriores recolhidos, as colunas
 * e, na Tabela PROVA (31/10/2026), os cenários.
 */
export type OpcoesDaTabela = Pick<BlocoTabela, "visao" | "nivel" | "linhas" | "recolhido" | "colunas" | "prova">;

/** As colunas opcionais (30/10/2026, pedido do Adão), na ordem do modal; de início, todas. */
const COLUNAS: Array<{ chave: keyof ColunasDaTabela; rotulo: string; detalhe: string }> = [
  { chave: "unitario", rotulo: "Valores Unitários (R$/m³)", detalhe: "O R$/m³ do mês, do total e do orçado." },
  { chave: "diferenca", rotulo: "Diferença", detalhe: "O realizado menos o orçado." },
  { chave: "atingimento", rotulo: "Atingimento", detalhe: "O realizado sobre o orçado." },
  { chave: "eficiencia", rotulo: "Eficiência", detalhe: "O % realizado menos o % orçado." },
];
const TODAS_AS_COLUNAS: ColunasDaTabela = { unitario: true, diferenca: true, atingimento: true, eficiencia: true };

/** A tabela de Resultados de uma visão do relatório ou do painel (a mesma consulta para os blocos e o modal). */
function useResultados(relatorioId: string, visao: VisaoDaTabela) {
  const { rota, servico } = useProcesso();
  return useQuery({
    queryKey: [rota, "resultados", relatorioId, visao],
    queryFn: () => servico.resultados(relatorioId, visao),
    staleTime: 5 * 60_000,
  });
}

const nomeDaVisao = (v: VisaoDaTabela) => VISOES_DA_TABELA.find((x) => x.visao === v)?.nome ?? "";

/**
 * O bloco de tabela (22/10/2026): a tabela de Resultados da visão, como a da tela Resultados (os meses até o do relatório,
 * os totais, o orçado e a variação), no nível e com as linhas escolhidas, sem os botões e a rolagem. A tabela inteira cabe
 * no bloco: se reduz (ou aumenta, na tela inteira ampliada) na proporção, até a largura ou a altura dele, centralizada.
 */
export function TabelaDoBloco({
  relatorioId,
  b,
  comparada,
}: {
  relatorioId: string;
  b: BlocoTabela;
  /** A marcação do cenário de comparação, numa Tabela Padrão de um slide com blocos PROVA (31/10/2026): o orçado na cor dele. */
  comparada?: MarcacaoComparavel | null;
}) {
  const consulta = useResultados(relatorioId, b.visao);
  const fora = useRef<HTMLDivElement>(null);
  const dentro = useRef<HTMLDivElement>(null);
  // A escala que faz a tabela caber no bloco e o deslocamento que a centraliza na largura.
  const [ajuste, setAjuste] = useState({ escala: 1, x: 0 });
  const pronta = !!consulta.data;
  useLayoutEffect(() => {
    const f = fora.current;
    const d = dentro.current;
    if (!f || !d) return;
    const medir = () => {
      if (!d.offsetWidth || !d.offsetHeight) return;
      const escala = Math.min(f.clientWidth / d.offsetWidth, f.clientHeight / d.offsetHeight);
      setAjuste({ escala, x: Math.max(0, (f.clientWidth - d.offsetWidth * escala) / 2) });
    };
    const obs = new ResizeObserver(medir);
    obs.observe(f);
    obs.observe(d);
    return () => obs.disconnect();
  }, [pronta]);
  if (consulta.isError) {
    return (
      <div className="flex h-full items-center justify-center rounded-sm border border-dashed border-gray-300 bg-white p-3 text-center text-xs text-gray-500">
        {mensagemDeErro(consulta.error, "Não foi possível carregar a tabela.")}
      </div>
    );
  }
  // data-carregando: a exportação em PDF espera a tabela antes de fotografar o slide.
  if (!consulta.data) return <div data-carregando className="h-full animate-pulse rounded-sm bg-gray-100" />;
  const nome = nomeDaVisao(b.visao);
  // A Tabela PROVA (31/10/2026): os cenários da Comparação PROVA do relatório (os que têm cenário marcado), lado a lado,
  // cada um com as cores dele.
  const cenarios = ehProva(b) ? comCor(consulta.data.prova ?? []) : null;
  if (cenarios && !cenarios.length) {
    return (
      <div className="flex h-full items-center justify-center rounded-sm border border-dashed border-gray-300 bg-white p-3 text-center text-xs text-gray-500">
        Nenhum cenário da Comparação PROVA (Configurações) está marcado (Análises Gerenciais / Cenários Sintéticos).
      </div>
    );
  }
  const comparados = cenarios?.map((c) => ({
    chave: c.marcacao,
    rotulo: c.rotulo,
    dica: `${c.rotulo}: ${c.cenario}`,
    estilo: ESTILOS_NA_TABELA[c.marcacao],
    celulas: (l: LinhaResultado) => l.prova?.[c.marcacao],
  }));
  return (
    <div ref={fora} className="relative size-full overflow-hidden">
      <div ref={dentro} className="absolute top-0 left-0 origin-top-left" style={{ transform: `translateX(${ajuste.x}px) scale(${ajuste.escala})` }}>
        <TabelaResultados
          key={b.nivel}
          dados={consulta.data}
          titulo={nome}
          visao={b.visao === 0 ? { consolidado: true } : { unidade: b.visao }}
          nomeVisao={nome}
          consultas={false}
          estatico={{ nivel: b.nivel, linhas: b.linhas, recolhido: b.recolhido ?? true, colunas: b.colunas }}
          comparados={comparados}
          estiloDoOrcado={!cenarios && comparada ? ESTILOS_NA_TABELA[comparada] : undefined}
        />
      </div>
    </div>
  );
}

/**
 * O Adicionar Tabela e o Configurar Tabela (22/10/2026): a aba (a visão de Resultados), o modo (Totais, Atribuições ou
 * Contas, como os níveis da tela Resultados), os meses anteriores ao do relatório (recolhidos ou não), as colunas opcionais
 * (30/10/2026: o R$/m³, a Diferença, o Atingimento e a Eficiência) e os totais e as contas que entram (de início, todos;
 * marcar um total marca as linhas dele). Na Tabela PROVA (31/10/2026, pedido do Adão), com os cenários da Comparação PROVA
 * do relatório (a aba Configurações), das colunas opcionais, só o R$/m³: sem a Diferença, o Atingimento e a Eficiência.
 */
export function ConfigurarTabelaDialog({
  relatorioId,
  titulo,
  inicial,
  prova = !!inicial && ehProva(inicial),
  onAplicar,
  onFechar,
}: {
  relatorioId: string;
  titulo: string;
  inicial?: OpcoesDaTabela;
  /** A Tabela PROVA (31/10/2026); sem ela, a de quem a tabela é (a Tabela Padrão). */
  prova?: boolean;
  onAplicar: (o: OpcoesDaTabela) => void;
  onFechar: () => void;
}) {
  const { documento } = useProcesso();
  const [visao, setVisao] = useState<VisaoDaTabela>(inicial?.visao ?? 0);
  const [nivel, setNivel] = useState<Nivel>(inicial?.nivel ?? 1);
  const [recolhido, setRecolhido] = useState(inicial?.recolhido ?? true);
  const [colunas, setColunas] = useState<ColunasDaTabela>(inicial?.colunas ?? TODAS_AS_COLUNAS);
  // Despesas e Extra e RN não têm o R$/m³.
  const semUnitario = visao === 4 || visao === 5;
  // As linhas marcadas; null: todas (as da visão, mesmo as que entrarem depois).
  const [marcadas, setMarcadas] = useState<Set<string> | null>(inicial?.linhas ? new Set(inicial.linhas) : null);
  const consulta = useResultados(relatorioId, visao);
  // Os cenários da Comparação PROVA (os que a consulta traz).
  const marcados = consulta.data?.prova ?? [];
  const linhas = useMemo(() => (consulta.data ? linhasDaDRE(semPrimeiroTotalDaRol(consulta.data.linhas)) : []), [consulta.data]);
  const { nivel: nivelDa, acima } = useMemo(() => estrutura(linhas), [linhas]);
  const marcada = (c: string) => marcadas === null || marcadas.has(c);
  // Marcar ou desmarcar uma linha leva junto as de baixo dela (as do grupo).
  const alternar = (codigo: string) => {
    const doGrupo = [codigo, ...linhas.filter((l) => (acima.get(l.codigo) ?? []).includes(codigo)).map((l) => l.codigo)];
    const atual = new Set(marcadas ?? linhas.map((l) => l.codigo));
    const marcar = !atual.has(codigo);
    for (const c of doGrupo) {
      if (marcar) atual.add(c);
      else atual.delete(c);
    }
    setMarcadas(atual.size === linhas.length ? null : atual);
  };
  const quantas = marcadas === null ? linhas.length : linhas.filter((l) => marcadas.has(l.codigo)).length;
  const escolherVisao = (v: VisaoDaTabela) => {
    setVisao(v);
    // Os códigos mudam de uma visão para a outra: a nova começa com todas.
    if (v !== visao) setMarcadas(null);
  };
  const aplicar = () =>
    onAplicar({
      visao,
      nivel,
      recolhido,
      linhas: marcadas === null ? undefined : linhas.map((l) => l.codigo).filter((c) => marcadas.has(c)),
      // Com todas as colunas, o campo sai do bloco.
      colunas: COLUNAS.every((c) => colunas[c.chave]) ? undefined : colunas,
      ...(prova ? { prova: true as const } : {}),
    });
  // Na Tabela PROVA, das colunas opcionais, só o R$/m³ (as da variação seriam três por cenário).
  const opcionais = prova ? COLUNAS.filter((c) => c.chave === "unitario") : COLUNAS;
  return (
    <Dialog open onOpenChange={(a) => (!a ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="flex max-h-[90vh] flex-col rounded-sm sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            {prova
              ? `A tabela de Resultados de uma aba, até o mês do ${documento}, com os cenários da Comparação PROVA (Configurações)${marcados.length ? `, hoje ${listaDosCenarios(marcados)}` : ""}, lado a lado, cada um com as cores dele (sem a Diferença, o Atingimento e a Eficiência).`
              : `A tabela de Resultados de uma aba, até o mês do ${documento}, como na tela Resultados (com o orçado e a variação).`}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <fieldset>
            <legend className="mb-1.5 text-sm leading-none font-medium">Aba</legend>
            <div className="grid grid-cols-3 gap-2">
              {VISOES_DA_TABELA.map((v) => (
                <label key={v.visao} className={`flex cursor-pointer items-center gap-2 rounded-sm border px-2.5 py-2 text-sm ${visao === v.visao ? "border-gray-900 font-semibold" : "border-gray-200 hover:bg-gray-50"}`}>
                  <input type="radio" name="aba-da-tabela" className="accent-black" checked={visao === v.visao} onChange={() => escolherVisao(v.visao)} />
                  {v.nome}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-sm leading-none font-medium">Modo</legend>
            {NIVEIS.map((n) => (
              <OpcaoEmLinha key={n.nivel} nome="modo-da-tabela" marcada={nivel === n.nivel} onMarcar={() => setNivel(n.nivel)} rotulo={n.rotulo} detalhe={`${n.dica}.`} />
            ))}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-sm leading-none font-medium">Meses Anteriores</legend>
            <OpcaoEmLinha nome="meses-da-tabela" marcada={recolhido} onMarcar={() => setRecolhido(true)} rotulo="Recolhidos" detalhe={`Só o mês do ${documento} e os totais do exercício.`} />
            <OpcaoEmLinha nome="meses-da-tabela" marcada={!recolhido} onMarcar={() => setRecolhido(false)} rotulo="Expandidos" detalhe={`Todos os meses, de janeiro ao do ${documento}, e os totais.`} />
          </fieldset>
          <fieldset>
            <legend className="mb-1.5 text-sm leading-none font-medium">Colunas</legend>
            <div className="grid grid-cols-2 gap-2">
              {opcionais.map((c) => {
                const desabilitada = c.chave === "unitario" && semUnitario;
                return (
                  <label
                    key={c.chave}
                    className={`flex items-start gap-2 rounded-sm border border-gray-200 px-2.5 py-2 text-sm ${desabilitada ? "text-gray-400" : "cursor-pointer hover:bg-gray-50"}`}
                    title={desabilitada ? "Despesas e Extra e RN não têm o R$/m³" : undefined}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 size-3.5 shrink-0 accent-black"
                      disabled={desabilitada}
                      checked={colunas[c.chave] && !desabilitada}
                      onChange={(e) => setColunas((x) => ({ ...x, [c.chave]: e.target.checked }))}
                    />
                    <span>
                      <span className="block font-medium">{c.rotulo}</span>
                      <span className="block text-xs text-gray-500">{c.detalhe}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1.5 flex w-full items-center gap-3 text-sm leading-none font-medium">
              Totais e Contas
              <span className="text-xs font-normal text-gray-500">
                {quantas} de {linhas.length}
              </span>
              <span className="ml-auto flex gap-1 text-xs font-normal">
                <button type="button" className="rounded-sm px-1.5 py-0.5 text-gray-700 underline-offset-2 hover:underline" onClick={() => setMarcadas(null)}>
                  Todas
                </button>
                <button type="button" className="rounded-sm px-1.5 py-0.5 text-gray-700 underline-offset-2 hover:underline" onClick={() => setMarcadas(new Set())}>
                  Nenhuma
                </button>
              </span>
            </legend>
            <p className="mb-2 text-xs text-gray-500">As linhas que entram na tabela (o modo mostra as do nível dele); marcar um total marca as linhas dele.</p>
            {consulta.isError ? (
              <p className="text-sm text-red-700">{mensagemDeErro(consulta.error, "Não foi possível carregar as linhas.")}</p>
            ) : !consulta.data ? (
              <div className="h-40 animate-pulse rounded-sm bg-gray-100" />
            ) : (
              <div className="max-h-72 overflow-y-auto rounded-sm border border-gray-200 py-1">
                {linhas.map((l) => (
                  <label key={l.codigo} className={`flex cursor-pointer items-center gap-2 py-0.5 pr-2 text-sm hover:bg-gray-50 ${RECUO[nivelDa.get(l.codigo) ?? 0]} ${l.tipo === "ITEM" ? "text-gray-700" : "font-semibold text-gray-900"}`}>
                    <input type="checkbox" className="size-3.5 shrink-0 accent-black" checked={marcada(l.codigo)} onChange={() => alternar(l.codigo)} />
                    <span className="min-w-0 truncate" title={l.descricao}>
                      {l.descricao}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={!consulta.data || quantas === 0 || (prova && !marcados.length)} onClick={aplicar}>
            {inicial ? "Aplicar" : "Adicionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
