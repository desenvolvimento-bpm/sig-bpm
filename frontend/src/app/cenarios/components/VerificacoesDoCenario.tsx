"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { type ColunaExportavel, ExportarTabela } from "@/components/shared/ExportarTabela";
import { SemResultado, useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import { Button } from "@/components/ui/button";
import { useAcessibilidade } from "@/lib/acessibilidade";
import type { Coluna } from "@/lib/filtrosDeTabela";
import { plural } from "@/lib/texto";

import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";

import { cenariosService, type VerificacaoDoCenario } from "../services/cenariosService";
import { botaoPrimario, Erro } from "./CenarioDialog";
import { Destaque, LinhaVazia, TabelaComDestaque } from "./DestaqueDaAba";

const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const situacao = (v: VerificacaoDoCenario) => (v.acordo ? "De Acordo" : "Pendente");
const textoDaSituacao = (v: VerificacaoDoCenario) =>
  v.acordo
    ? `De Acordo · ${v.acordo.nome}, ${quando(v.acordo.em)}`
    : v.acordoAnterior
      ? `Pendente · os valores mudaram depois do De Acordo de ${v.acordoAnterior.nome} (${quando(v.acordoAnterior.em)})`
      : "Pendente";

const COLUNAS: Coluna<VerificacaoDoCenario>[] = [
  { chave: "marcar", rotulo: "", semFiltro: true, classe: "w-10" },
  { chave: "situacao", rotulo: "Situação", valor: situacao, texto: textoDaSituacao },
  { chave: "aba", rotulo: "Aba", valor: (v) => v.abaRotulo },
  { chave: "alvo", rotulo: "Linha / Centro de Custo", valor: (v) => v.alvo },
  { chave: "verificacao", rotulo: "Verificação", valor: (v) => v.titulo, texto: (v) => `${v.titulo}: ${v.descricao}` },
  { chave: "meses", rotulo: "Meses", valor: (v) => v.mesesTexto },
  { chave: "responsavel", rotulo: "Responsável", valor: (v) => v.responsavel?.nome ?? null },
];
const LARGURAS = [44, 120, 120, 250, 380, 130, 140];

/**
 * A aba Verificações das Premissas (20/11/2026, pedido do Adão): as inconsistências nos valores digitados ou importados, cada uma
 * com a aba (o clique abre a aba, e nos Centros de Custo o grupo), a linha ou o centro de custo, os meses, o responsável (quem
 * alterou os valores por último, pelo Histórico) e a situação. Cada uma pede a correção ou o De Acordo do responsável (ou do
 * Administrador): marque as caixas (ou “Marcar Todas”) e clique em “De Acordo” (ou “Retirar Acordo”). Com alguma pendente, a
 * versão não se congela.
 */
export function VerificacoesDoCenario({ id, podeEditar, onAbrirAba }: { id: string; podeEditar: boolean; onAbrirAba: (aba: string, grupo: string | null) => void }) {
  const queryClient = useQueryClient();
  // O De Acordo em verde (em azul, com a Acessibilidade Daltonismo).
  const [acessibilidade] = useAcessibilidade();
  const corDoAcordo = acessibilidade === "daltonismo" ? "text-blue-700" : "text-green-700";
  const consulta = useQuery({ queryKey: ["cenarios", id, "verificacoes"], queryFn: () => cenariosService.verificacoes(id) });
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const tabela = useTabelaFiltravel(consulta.data?.verificacoes, COLUNAS);
  const pode = podeEditar && !!consulta.data?.editavel;
  const marcaveis = useMemo(() => (pode ? tabela.filtradas.filter((v) => v.podeAcordar) : []), [pode, tabela.filtradas]);
  const todasMarcadas = marcaveis.length > 0 && marcaveis.every((v) => marcadas.has(v.chave));
  const lista = consulta.data?.verificacoes ?? [];
  const escolhidas = lista.filter((v) => marcadas.has(v.chave) && v.podeAcordar);
  const acordar = useMutation({
    mutationFn: (deAcordo: boolean) => cenariosService.acordarVerificacoes(id, (deAcordo ? escolhidas.filter((v) => !v.acordo) : escolhidas.filter((v) => v.acordo)).map((v) => v.chave), deAcordo),
    onSuccess: (dados, deAcordo) => {
      queryClient.setQueryData(["cenarios", id, "verificacoes"], dados);
      queryClient.invalidateQueries({ queryKey: ["cenarios", id] });
      const n = deAcordo ? escolhidas.filter((v) => !v.acordo).length : escolhidas.filter((v) => v.acordo).length;
      toast.success(deAcordo ? `De Acordo em ${n} ${plural(n, "verificação", "verificações")}.` : `De Acordo retirado de ${n} ${plural(n, "verificação", "verificações")}.`);
      setMarcadas(new Set());
    },
  });
  const alternar = (chave: string) =>
    setMarcadas((atual) => {
      const novo = new Set(atual);
      if (novo.has(chave)) novo.delete(chave);
      else novo.add(chave);
      return novo;
    });
  const marcarTodas = () =>
    setMarcadas((atual) => {
      const novo = new Set(atual);
      for (const v of marcaveis) {
        if (todasMarcadas) novo.delete(v.chave);
        else novo.add(v.chave);
      }
      return novo;
    });

  if (consulta.isError) return <Erro erro={mensagemDeErro(consulta.error, "Erro ao carregar as verificações.")} />;
  if (consulta.isPending) return <div className="h-64 animate-pulse rounded-sm bg-gray-100" />;
  const dados = consulta.data;
  const colunasDoArquivo: ColunaExportavel<VerificacaoDoCenario>[] = COLUNAS.filter((c) => c.chave !== "marcar");
  const paraAcordo = escolhidas.filter((v) => !v.acordo).length;
  const paraRetirar = escolhidas.filter((v) => v.acordo).length;
  const destaque = (
    <Destaque
      titulo="Verificações"
      descricao={
        <>
          {dados.pendentes ? `${dados.pendentes} ${plural(dados.pendentes, "pendente", "pendentes")} de ${dados.verificacoes.length}` : dados.verificacoes.length ? "Nenhuma pendente" : "Nenhuma inconsistência"}
          {dados.pendentesNoCenario > dados.pendentes ? ` (${dados.pendentesNoCenario} no cenário inteiro)` : ""}. Corrija os valores na aba de cada uma ou, se estiverem certos, dê o De Acordo
          (quem alterou os valores por último, ou o Administrador). Com alguma pendente, a versão do cenário não se congela.
        </>
      }
      abaixo={acordar.isError ? <Erro erro={mensagemDeErro(acordar.error, "Não foi possível gravar o De Acordo.")} /> : null}
    >
      {pode ? (
        <>
          <Button type="button" variant="outline" className="rounded-sm" disabled={!marcaveis.length} onClick={marcarTodas} title="Marcar ou desmarcar as verificações da tabela (com os filtros) que você pode confirmar">
            {todasMarcadas ? "Desmarcar Todas" : "Marcar Todas"}
          </Button>
          <Button type="button" variant="outline" className="rounded-sm" disabled={!paraRetirar || acordar.isPending} onClick={() => acordar.mutate(false)}>
            Retirar Acordo
          </Button>
          <Button type="button" className={botaoPrimario} disabled={!paraAcordo || acordar.isPending} onClick={() => acordar.mutate(true)}>
            {acordar.isPending ? "Gravando…" : "De Acordo"}
          </Button>
        </>
      ) : null}
      <ExportarTabela titulo="Cenário · Premissas · Verificações" colunas={colunasDoArquivo} linhas={tabela.filtradas} />
    </Destaque>
  );
  return (
    <TabelaComDestaque
      destaque={destaque}
      larguras={LARGURAS}
      cabecalho={tabela.linhaDoCabecalhoCom({
        marcar: pode ? (
          <input
            type="checkbox"
            aria-label="Marcar todas as verificações da tabela"
            title="Marcar ou desmarcar todas as verificações da tabela (com os filtros) que você pode confirmar"
            checked={todasMarcadas}
            disabled={!marcaveis.length}
            onChange={marcarTodas}
            className="size-4 accent-black"
          />
        ) : null,
      })}
      corpo={
        dados.verificacoes.length === 0 ? (
          <LinhaVazia colunas={COLUNAS.length} texto="Nenhuma inconsistência nas premissas." />
        ) : tabela.visiveis.length === 0 ? (
          <SemResultado colunas={COLUNAS.length} onLimpar={tabela.limpar} />
        ) : (
          tabela.visiveis.map((v) => (
            <tr key={v.chave} className="border-t border-gray-100 align-top hover:bg-gray-50">
              <td className="px-3 py-1.5">
                <input
                  type="checkbox"
                  aria-label={`Marcar ${v.titulo}: ${v.alvo}`}
                  checked={marcadas.has(v.chave)}
                  disabled={!pode || !v.podeAcordar}
                  title={v.podeAcordar ? undefined : `Só ${v.responsavel?.nome ?? "o responsável"} (ou o Administrador) dá ou retira o De Acordo desta verificação`}
                  onChange={() => alternar(v.chave)}
                  className="size-4 accent-black"
                />
              </td>
              <td className="px-3 py-1.5">
                <span className={`font-medium ${v.acordo ? corDoAcordo : "text-amber-700"}`}>{situacao(v)}</span>
                {v.acordo ? <div className="text-xs text-gray-500">{`${v.acordo.nome}, ${quando(v.acordo.em)}`}</div> : null}
                {!v.acordo && v.acordoAnterior ? <div className="text-xs text-gray-500">{`Os valores mudaram depois do De Acordo de ${v.acordoAnterior.nome}`}</div> : null}
              </td>
              <td className="px-3 py-1.5">
                <button type="button" onClick={() => onAbrirAba(v.aba, v.grupo)} title={`Abrir a aba ${v.abaRotulo}${v.grupo && v.aba === "centros" ? ` no grupo ${v.grupo}` : ""}`} className="text-left font-medium text-gray-900 underline decoration-gray-300 underline-offset-2 hover:decoration-gray-900">
                  {v.abaRotulo}
                </button>
              </td>
              <td className="px-3 py-1.5 text-gray-900">{v.alvo}</td>
              <td className="px-3 py-1.5">
                <div className="font-medium text-gray-900">{v.titulo}</div>
                <div className="text-xs whitespace-normal text-gray-600">{v.descricao}</div>
              </td>
              <td className="px-3 py-1.5 text-gray-700">{v.mesesTexto}</td>
              <td className="px-3 py-1.5 text-gray-700" title={v.responsavel?.em ? `Última alteração em ${quando(v.responsavel.em)}` : "Sem alteração no Histórico: quem criou o cenário"}>
                {v.responsavel?.nome ?? "—"}
              </td>
            </tr>
          ))
        )
      }
    />
  );
}
