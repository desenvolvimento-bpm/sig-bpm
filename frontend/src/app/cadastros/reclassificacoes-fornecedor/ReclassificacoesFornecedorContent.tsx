"use client";

import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";

import { ExportarTabela } from "@/components/shared/ExportarTabela";
import { DataTable } from "@/components/shared/DataTable";
import { Parametros } from "@/components/shared/Parametros";
import { useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";
import type { Coluna } from "@/lib/filtrosDeTabela";
import { plural } from "@/lib/texto";

import { CadastroShell } from "../components/CadastroShell";
import { useEdicaoCadastro } from "../components/EdicaoCadastro";
import { cadastrosService, type ReclassificacaoFornecedor } from "../services/cadastrosService";

const POR_PAGINA_INICIAL = 50;
/** O cadastro inteiro vem de uma vez: o filtro e a ordem das colunas valem para todas as reclassificações. */
const TODOS = 5000;

const centro = (r: ReclassificacaoFornecedor) => `${r.centroCusto.codigoRM ?? "sem código"} · ${r.centroCusto.nomeRM}`;
const movimentos = (n: number, onde: string) => `${n.toLocaleString("pt-BR")} ${plural(n, "movimento", "movimentos")} ${onde}`;

const COLUNAS: Coluna<ReclassificacaoFornecedor>[] = [
  { chave: "fornecedor", rotulo: "Fornecedor", valor: (r) => r.fornecedor },
  { chave: "seta", rotulo: "", semFiltro: true },
  { chave: "centro", rotulo: "Centro de Custo Imperativo", valor: centro },
  { chave: "abertas", rotulo: "Competências Abertas", valor: (r) => r.movimentos.abertas },
  { chave: "fechadas", rotulo: "Competências Fechadas", valor: (r) => r.movimentos.fechadas },
  { chave: "motivo", rotulo: "Motivo", valor: (r) => r.motivo },
  { chave: "situacao", rotulo: "Situação", valor: (r) => (r.ativo ? "Ativa" : "Inativa") },
];
const EDITAR: Coluna<ReclassificacaoFornecedor> = { chave: "editar", rotulo: "", semFiltro: true, classe: "w-12" };

/**
 * Reclassificações › Por Fornecedor (13/11/2026, pedido do Adão): o fornecedor dos movimentos importados e o centro de
 * custo imperativo, para onde a classificação leva todos os movimentos dele. A contestação validada continua por cima.
 */
export function ReclassificacoesFornecedorContent() {
  useRegistrarAcessoTela("/cadastros/reclassificacoes-fornecedor");

  const edicao = useEdicaoCadastro("reclassificacoes-fornecedor");

  const { data, isPending, isError } = useQuery({
    queryKey: ["cadastros", "reclassificacoes-fornecedor", TODOS],
    queryFn: () => cadastrosService.reclassificacoesFornecedor({ pagina: 1, porPagina: TODOS }),
    placeholderData: keepPreviousData,
  });
  const colunas = useMemo(() => (edicao.pode ? [...COLUNAS, EDITAR] : COLUNAS), [edicao.pode]);
  const tabela = useTabelaFiltravel(data?.itens, colunas, { porPaginaInicial: POR_PAGINA_INICIAL });

  return (
    <CadastroShell
      titulo="Reclassificações"
      exportar={<ExportarTabela titulo="Cadastros · Reclassificações · Por Fornecedor" colunas={colunas} linhas={tabela.filtradas} />}
      comoUsar={
        <ul>
          <li>Use os filtros nos rótulos das colunas.</li>
          <li>
            Use “Novo” para escolher o fornecedor (os dos movimentos já importados, de competências fechadas ou abertas) e o centro de custo
            imperativo; as duas listas têm busca: digite parte do nome ou do código. O lápis edita, e a exclusão fica dentro da edição.
          </li>
          <li>
            Na classificação do mês, todos os movimentos do fornecedor vão para o centro imperativo, seja qual for o centro em que o RM os lançou.
            Muda só o centro: as reclassificações da aba Por Conta continuam valendo pelo centro do balancete do RM. A contestação validada
            continua por cima das duas.
          </li>
          <li>
            Ao gravar, as competências ainda não apuradas são reclassificadas; as apuradas só mudam se forem reapuradas, e as fechadas ficam como
            foram fechadas. As colunas Competências Abertas e Competências Fechadas mostram quantos movimentos do fornecedor há em cada uma.
          </li>
          <li>Nos modais dos movimentos, o centro corrigido tem um ícone ao lado, que abre o centro original (o do balancete do RM).</li>
        </ul>
      }
      descricao="Todos os movimentos do fornecedor vão para o centro de custo imperativo. Corrige os gastos de um fornecedor lançados em centros de custo diferentes."
      acoes={edicao.botaoNovo}
      total={tabela.total}
      pagina={tabela.pagina}
      porPagina={tabela.porPagina}
      onPorPaginaChange={tabela.setPorPagina}
      onPaginaChange={tabela.setPagina}
      carregando={isPending}
    >
      <DataTable<ReclassificacaoFornecedor>
        data={tabela.visiveis}
        cabecalho={tabela.cabecalho}
        filtrosAtivos={tabela.ativos}
        onLimparFiltros={tabela.limpar}
        isLoading={isPending}
        error={isError ? "Erro ao carregar as reclassificações por fornecedor." : null}
        emptyMessage="Nenhuma reclassificação por fornecedor encontrada"
        emptyHint="Use “Novo” para cadastrar uma, ou ajuste os filtros para ver outros registros."
        columns={["Fornecedor", "", "Centro de Custo Imperativo", "Competências Abertas", "Competências Fechadas", "Motivo", "Situação", ...edicao.colunaEditar]}
        renderRow={(r) => (
          <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
            <td className="px-4 py-3 text-sm">
              <div className="max-w-72 truncate font-medium text-gray-900" title={r.fornecedor}>
                {r.fornecedor}
              </div>
            </td>
            <td className="px-2 py-3 text-gray-400">
              <ArrowRight className="size-4" />
            </td>
            <td className="px-4 py-3 text-sm">
              <div className="flex max-w-64 items-baseline gap-1.5">
                <span className="font-medium whitespace-nowrap text-gray-900">{r.centroCusto.codigoRM ?? "sem código"}</span>
                <span className="truncate text-xs text-gray-600" title={r.centroCusto.nomeRM}>
                  {r.centroCusto.nomeRM}
                </span>
              </div>
              <Parametros departamento={r.centroCusto.departamento} atribuicao={r.centroCusto.atribuicao} />
            </td>
            <td className="px-4 py-3 text-sm text-gray-700" title={movimentos(r.movimentos.abertas, "nas competências abertas")}>
              {r.movimentos.abertas.toLocaleString("pt-BR")}
            </td>
            <td className="px-4 py-3 text-sm text-gray-700" title={movimentos(r.movimentos.fechadas, "nas competências fechadas")}>
              {r.movimentos.fechadas.toLocaleString("pt-BR")}
            </td>
            <td className="px-4 py-3 text-xs text-gray-500">
              <div className="max-w-44" title={r.motivo ?? undefined}>
                {r.motivo ?? "—"}
              </div>
            </td>
            <td className="px-4 py-3 text-sm text-gray-700">{r.ativo ? "Ativa" : "Inativa"}</td>
            {edicao.pode ? <td className="w-12 px-2 py-3">{edicao.botaoEditar(r.id)}</td> : null}
          </tr>
        )}
      />
      {edicao.dialogo}
    </CadastroShell>
  );
}
