"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Calculator, Info } from "lucide-react";
import { toast } from "sonner";

import { ExportarTabela } from "@/components/shared/ExportarTabela";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { Button } from "@/components/ui/button";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";
import { CabecalhoDaTela } from "@/components/shared/CabecalhoDaTela";
import { Vazio } from "@/components/shared/Estados";
import { SemResultado, useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import { Destaque, TabelaComDestaque } from "@/app/cenarios/components/DestaqueDaAba";
import type { Coluna } from "@/lib/filtrosDeTabela";

import { AvisoCongelado } from "../../components/AvisoCongelado";
import { dataHora, lerAnoMes, moeda } from "../utils/formatacao";
import { estoqueService, mensagemDeErro, ROTULO_CRITERIO_ESTOQUE, type SaldoEstoque } from "./services/estoqueService";

const m3 = (v: string) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const ROTULO_MEDIA: Record<string, string> = { ESTRUTURA: "Estrutura", ALVEOLARES: "Alveolares", ESTACAS: "Estacas", GERAL: "Geral" };

/** Coluna de número à direita: ordena pelo valor e filtra pelo texto formatado como na célula. */
function numerica(chave: string, rotulo: string, campo: (s: SaldoEstoque) => string, formato: (v: string) => string): Coluna<SaldoEstoque> {
  return { chave, rotulo, tipo: "numero", alinhamento: "direita", valor: (s) => Number(campo(s)), texto: (s) => formato(campo(s)) };
}

const COLUNAS: Coluna<SaldoEstoque>[] = [
  { chave: "obra", rotulo: "Obra", valor: (s) => s.obra, texto: (s) => (s.nomeObra !== s.obra ? `${s.obra} ${s.nomeObra}` : s.obra) },
  { chave: "linha", rotulo: "Linha", valor: (s) => s.linha },
  numerica("movimentoVolume", "Movimento (m³)", (s) => s.movimentoVolume, m3),
  numerica("movimentoValor", "Movimento (R$)", (s) => s.movimentoValor, moeda),
  { chave: "valoracao", rotulo: "Valoração", valor: (s) => (s.criterio ? ROTULO_CRITERIO_ESTOQUE[s.criterio] ?? s.criterio : null) },
  numerica("saldoVolume", "Saldo (m³)", (s) => s.saldoVolume, m3),
  numerica("saldoValor", "Saldo (R$)", (s) => s.saldoValor, moeda),
  numerica("precoMedio", "R$/m³", (s) => s.precoMedio, moeda),
];

export function EstoqueContent() {
  const { anoMes } = useParams<{ anoMes: string }>();
  useRegistrarAcessoTela(`/competencias/${anoMes}/estoque`);
  const periodo = lerAnoMes(anoMes);
  const queryClient = useQueryClient();
  const [avisos, setAvisos] = useState<string[]>([]);

  const estoque = useQuery({
    queryKey: ["estoque", anoMes],
    queryFn: () => estoqueService.consultar(anoMes),
    enabled: periodo !== null,
  });
  const apurar = useMutation({
    mutationFn: () => estoqueService.apurar(anoMes),
    onSuccess: (r) => {
      setAvisos(r.avisos ?? []);
      toast.success("Saldo de estoque apurado.");
      queryClient.setQueryData(["estoque", anoMes], r);
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível apurar.")),
  });

  const dados = estoque.data;
  const saldos = useMemo(() => dados?.saldos ?? [], [dados]);
  // Todos os saldos; o recorte é pelos filtros dos rótulos.
  const tabela = useTabelaFiltravel(saldos, COLUNAS);

  if (!periodo) {
    return (
      <div className="rounded-sm border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-700">Competência inválida na URL: {anoMes}.</p>
      </div>
    );
  }
  const bloqueada = dados?.competencia.status === "FECHADA" || dados?.congelado;

  return (
    <div className="space-y-6">
      <CabecalhoDaTela
        titulo="Estoque Prévio"
        selo={
          dados?.congelado || dados?.competencia.status === "FECHADA" ? (
            <AvisoCongelado anoMes={anoMes} fechada={dados?.competencia.status === "FECHADA"} oQue="do saldo de estoque" />
          ) : null
        }
        comoUsar={
          <ul>
            <li>A tela Prévias (Prévias de Receita e Estoque) tem duas abas: Receita (a receita prévia do mês) e Estoque (esta, com o saldo de estoque prévio).</li>
            <li>Os cards no alto trazem o saldo de cada linha (Estrutura, Alveolares, Estacas) e o geral, em m³ e em reais, com o Preço Médio.</li>
            <li>Use os filtros nos rótulos das colunas; nas colunas de Movimento, por exemplo, para ver só as obras que se moveram no mês. A coluna Valoração diz como o saldo da obra foi valorado.</li>
            <li>A tabela dos saldos tem o destaque acima dela — o título, a descrição e o “Exportar” (Excel ou PDF, o que está filtrado) —, que flutua sobre a tabela ao rolar a tela, com os rótulos das colunas presos logo abaixo.</li>
            <li>Use “Apurar Estoque” para calcular o saldo; o mês seguinte parte dele.</li>
            <li>Depois da apuração, a aba fica congelada: o que mudar só entra ao reapurar a competência, na tela Resultados.</li>
          </ul>
        }
        sobre={
          <p>
            Saldo do mês anterior mais a produção, menos a expedição, por obra e linha. Serve para conferência e não entra no resultado. O
            primeiro mês da ferramenta parte do saldo inicial, importado da aba Estoque (2025).{" "}
            {dados?.apuradoEm ? `Apurado em ${dataHora(dados.apuradoEm)}.` : "Ainda não apurado."}
          </p>
        }
        acoes={
          !bloqueada && dados ? (
            <PermissionGuard permission="previas.estoque:editar">
              <Button
                type="button"
                onClick={() => apurar.mutate()}
                disabled={apurar.isPending}
                className="bg-bpm-primary hover:bg-bpm-primary-hover rounded-sm font-bold text-black shadow-sm"
              >
                <Calculator className="size-4" />
                {apurar.isPending ? "Apurando…" : dados.apuradoEm ? "Apurar de novo" : "Apurar estoque"}
              </Button>
            </PermissionGuard>
          ) : null
        }
      />

      {dados?.inicial ? (
        <div className="flex items-center gap-2 rounded-sm border border-gray-200 bg-gray-50 p-4">
          <Info className="size-4 shrink-0 text-gray-500" />
          <p className="text-sm text-gray-600">Primeiro mês da ferramenta: parte do saldo inicial, importado da aba Estoque (2025), em vez do saldo do mês anterior.</p>
        </div>
      ) : null}
      {avisos.length > 0 ? (
        <div className="flex items-start gap-2 rounded-sm border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <ul>{avisos.map((a) => <li key={a}>{a}</li>)}</ul>
        </div>
      ) : null}

      {estoque.isError ? (
        <div className="rounded-sm border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{mensagemDeErro(estoque.error, "Erro ao carregar o estoque.")}</p>
        </div>
      ) : estoque.isPending ? (
        <div className="h-64 animate-pulse rounded-sm bg-gray-100" />
      ) : dados && dados.saldos.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {dados.medias.map((m) => (
              <div key={m.linha} className="rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white p-4">
                <p className="text-xs font-bold text-gray-600">{ROTULO_MEDIA[m.linha] ?? m.linha}</p>
                <p className="mt-1 text-xl font-extrabold text-gray-900">{m3(m.volume)} m³</p>
                <p className="text-sm text-gray-700">{moeda(m.valor)}</p>
                <p className="mt-0.5 text-xs text-gray-500">Preço Médio {moeda(m.precoMedio)}/m³</p>
              </div>
            ))}
          </div>

          {/* Os saldos (21/11/2026, pedido do Adão: o padrão das telas com tabela, como os Investimentos dos Cenários Analíticos). */}
          <TabelaComDestaque
            destaque={
              <Destaque titulo="Saldos por Obra" descricao="O saldo do mês anterior mais a produção, menos a expedição, por obra e linha, com o movimento do mês e a valoração.">
                <ExportarTabela titulo={`Estoque Prévio · ${anoMes.slice(5)}/${anoMes.slice(0, 4)}`} colunas={COLUNAS} linhas={tabela.filtradas} />
              </Destaque>
            }
            larguras={[230, 140, 140, 160, 190, 130, 160, 130]}
            cabecalho={tabela.linhaDoCabecalho}
            corpo={
              <>
                {saldos.length > 0 && tabela.total === 0 ? <SemResultado colunas={COLUNAS.length} onLimpar={tabela.limpar} /> : null}
                {tabela.visiveis.map((s) => (
                  <tr key={`${s.obra}|${s.linha}`} className="border-t border-gray-100">
                    <td className="px-3 py-1.5">
                      <div className="font-medium text-gray-900">{s.obra}</div>
                      {s.nomeObra !== s.obra ? (
                        <div className="truncate text-xs text-gray-500" title={s.nomeObra}>
                          {s.nomeObra}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5 text-gray-700">{s.linha}</td>
                    <td className="px-3 py-1.5 text-right text-gray-700">{m3(s.movimentoVolume)}</td>
                    <td className="px-3 py-1.5 text-right text-gray-700">{moeda(s.movimentoValor)}</td>
                    <td className="px-3 py-1.5 text-xs whitespace-nowrap text-gray-600">
                      {s.criterio ? ROTULO_CRITERIO_ESTOQUE[s.criterio] ?? s.criterio : "—"}
                      {s.precoMovimento ? <div>{moeda(s.precoMovimento)}/m³</div> : null}
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-700">{m3(s.saldoVolume)}</td>
                    <td className="px-3 py-1.5 text-right text-gray-700">{moeda(s.saldoValor)}</td>
                    <td className="px-3 py-1.5 text-right text-gray-600">{moeda(s.precoMedio)}</td>
                  </tr>
                ))}
              </>
            }
          />
        </>
      ) : (
        <div className="rounded-sm border border-gray-200 bg-white p-6 text-sm text-gray-600">
          Nenhum saldo ainda. Apure o estoque: o mês anterior precisa ter saldo — ou, no primeiro mês da ferramenta, o saldo
          inicial (aba Estoque (2025)) precisa estar importado.
        </div>
      )}
    </div>
  );
}
