"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { DestaqueFlutuante, useDestaqueFlutuante } from "@/components/shared/DestaqueFlutuante";
import { Button } from "@/components/ui/button";

import { TabelaResultados } from "@/app/relatorios/resultados/ResultadosContent";
import { mensagemDeErro, type LinhaResultado } from "@/app/relatorios/services/relatoriosService";

import { cenariosService, type OrigemDaGravacao } from "../services/cenariosService";
import { botaoPrimario, Erro } from "./CenarioDialog";
import { ReajusteDialog, ValorDialog } from "./EdicaoDialogs";
import { plural } from "@/lib/texto";

const Carregando = () => <div className="h-64 animate-pulse rounded-sm bg-gray-100" />;
/** Os botões da barra de marcação (12/10/2026): cinza-claro, discretos ao lado do Reajustar Marcados. */
const botaoCinza = "rounded-sm border border-gray-200 bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-200";

/**
 * Uma aba da DRE do cenário. Nas unidades, as contas se editam: a caixa de cada linha e de cada mês marca valores, e
 * clicar numa linha reajusta os marcados; clicar num valor edita aquele valor. O Consolidado só soma as unidades. Nas
 * unidades, ao rolar (16/11/2026, pedido do Adão), o destaque da marcação flutua sobre a tabela, logo abaixo dos rótulos presos.
 */
export function EdicaoDRE({ id, visao, nome }: { id: string; visao: number; nome: string }) {
  const queryClient = useQueryClient();
  const consulta = useQuery({ queryKey: ["cenarios", id, "edicao", visao], queryFn: () => cenariosService.edicao(id, visao) });
  const [linhas, setLinhas] = useState<Set<string>>(new Set());
  const [meses, setMeses] = useState<Set<number>>(new Set());
  const [reajuste, setReajuste] = useState<string | null>(null);
  const [valor, setValor] = useState<{ l: LinhaResultado; i: number } | null>(null);
  const { refOriginal, refArea, refFlutuante, flutuar, rotulos } = useDestaqueFlutuante(!!consulta.data && visao !== 0);
  const gravar = useMutation({
    mutationFn: ({ alteracoes, origem }: { alteracoes: Array<{ linha: string; mes: number; valor: number }>; origem: OrigemDaGravacao }) =>
      cenariosService.gravarValores(id, visao, alteracoes, origem),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["cenarios", id] });
      // Se o cenário é o Orçamento Empresarial, o orçado de Resultados Empresariais muda.
      queryClient.invalidateQueries({ queryKey: ["relatorios"] });
      toast.success(`${r.alteradas} ${plural(r.alteradas, "valor gravado", "valores gravados")}; totais e Consolidado recalculados.`);
      setReajuste(null);
      setValor(null);
    },
  });
  if (consulta.isError) return <Erro erro={mensagemDeErro(consulta.error, "Erro ao carregar a DRE do cenário.")} />;
  if (consulta.isPending) return <Carregando />;
  const dados = consulta.data;
  const editaveis = new Set(dados.editaveis);
  const consolidado = visao === 0;
  const porCodigo = new Map(dados.linhas.map((l) => [l.codigo, l]));
  const marcados = [...linhas].filter((c) => editaveis.has(c) && porCodigo.has(c)).flatMap((c) =>
    [...meses].sort((a, b) => a - b).map((i) => ({ linha: c, mes: dados.meses[i].mes, atual: porCodigo.get(c)!.meses[i]?.valor ?? 0 })),
  );
  const erroGravar = gravar.isError ? mensagemDeErro(gravar.error, "Não foi possível gravar.") : null;
  const todosOsMeses = meses.size === dados.meses.length;

  // O destaque da marcação, nas unidades (o Consolidado não se edita).
  const destaque = consolidado ? null : (
    <div className="flex flex-wrap items-center gap-3 rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-2 text-sm">
      <span className="text-gray-700">
        <span className="font-bold text-gray-900">{marcados.length}</span> {plural(marcados.length, "valor marcado", "valores marcados")} · {linhas.size} {plural(linhas.size, "conta", "contas")} × {meses.size} {plural(meses.size, "mês", "meses")}
      </span>
      <button type="button" className={botaoCinza} onClick={() => setMeses(todosOsMeses ? new Set() : new Set(dados.meses.map((_, i) => i)))}>
        {todosOsMeses ? "Desmarcar os Meses" : "Marcar Todos os Meses"}
      </button>
      {linhas.size || meses.size ? (
        <button
          type="button"
          className={botaoCinza}
          onClick={() => {
            setLinhas(new Set());
            setMeses(new Set());
          }}
        >
          Limpar Seleção
        </button>
      ) : null}
      <Button type="button" className={`${botaoPrimario} ml-auto`} disabled={marcados.length === 0} onClick={() => setReajuste(nome)}>
        Reajustar Marcados
      </Button>
    </div>
  );

  return (
    <div className="space-y-3">
      {consolidado ? (
        <p className="rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-2 text-sm text-gray-600">
          O Consolidado soma as contas das unidades, e os totais saem da Estrutura da DRE: edite os valores nas abas Matriz, Filial, Serviços, Despesas +
          Extra e RN.
        </p>
      ) : (
        <div ref={refOriginal}>{destaque}</div>
      )}
      <div ref={refArea}>
        {destaque ? <DestaqueFlutuante refFlutuante={refFlutuante} flutuar={flutuar} rotulos={rotulos}>{destaque}</DestaqueFlutuante> : null}
        <TabelaResultados
          key={visao}
          dados={dados}
          titulo={`Resultados · ${nome}`}
          visao={visao === 0 ? { consolidado: true } : { unidade: visao }}
          nomeVisao={nome}
          consultas={false}
          doCenario
          edicao={
            consolidado
              ? undefined
              : {
                  editavel: (l) => editaveis.has(l.codigo),
                  linhasMarcadas: linhas,
                  mesesMarcados: meses,
                  onMarcarLinhas: (codigos, marcar) =>
                    setLinhas((s) => {
                      const n = new Set(s);
                      for (const c of codigos) if (marcar) n.add(c);
                      else n.delete(c);
                      return n;
                    }),
                  onMarcarMes: (i, marcar) =>
                    setMeses((s) => {
                      const n = new Set(s);
                      if (marcar) n.add(i);
                      else n.delete(i);
                      return n;
                    }),
                  onCelula: (l, i) => setValor({ l, i }),
                  onConta: (l) => setReajuste(`${nome} · ${l.descricao}`),
                }
          }
        />
      </div>
      {reajuste !== null ? (
        <ReajusteDialog
          valores={marcados}
          rotulo={`${reajuste}. O reajuste vale para todas as contas e meses marcados.`}
          gravando={gravar.isPending}
          erro={erroGravar}
          onAplicar={(novos, r) => gravar.mutate({ alteracoes: novos, origem: { tipo: "MARCADOS", modo: r.modo, reajuste: r.valor, replicado: false } })}
          onFechar={() => {
            setReajuste(null);
            gravar.reset();
          }}
        />
      ) : null}
      {valor ? (
        <ValorDialog
          conta={`${nome} · ${valor.l.descricao}`}
          rotuloMes={dados.meses[valor.i].rotulo}
          mesesSeguintes={dados.meses.slice(valor.i + 1).map((m) => m.rotulo)}
          atual={valor.l.meses[valor.i]?.valor ?? 0}
          gravando={gravar.isPending}
          erro={erroGravar}
          onGravar={(v, replicar, r) =>
            gravar.mutate({
              alteracoes: dados.meses.slice(valor.i, replicar ? dados.meses.length : valor.i + 1).map((m) => ({ linha: valor.l.codigo, mes: m.mes, valor: v })),
              origem: { tipo: "VALOR", modo: r ? r.modo : "DIGITADO", reajuste: r ? r.valor : null, replicado: replicar },
            })
          }
          onFechar={() => {
            setValor(null);
            gravar.reset();
          }}
        />
      ) : null}
    </div>
  );
}
