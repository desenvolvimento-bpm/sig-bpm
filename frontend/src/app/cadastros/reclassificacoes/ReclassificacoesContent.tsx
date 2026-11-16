"use client";

import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";

import { ExportarTabela } from "@/components/shared/ExportarTabela";
import { DataTable } from "@/components/shared/DataTable";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";
import { useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import type { Coluna } from "@/lib/filtrosDeTabela";

import { CadastroShell } from "../components/CadastroShell";
import { useEdicaoCadastro } from "../components/EdicaoCadastro";
import { Parametros } from "@/components/shared/Parametros";
import {
  cadastrosService,
  type Reclassificacao,
} from "../services/cadastrosService";

const POR_PAGINA_INICIAL = 50;
/** O cadastro inteiro vem de uma vez: o filtro e a ordem das colunas valem para todas as reclassificações. */
const TODOS = 5000;

const conta = (c: Reclassificacao["contaOrigem"]) => `${c.reduzido} · ${c.descricao}`;

const COLUNAS: Coluna<Reclassificacao>[] = [
  {
    chave: "centro",
    rotulo: "Centro de custo",
    valor: (r) => `${r.codigoCentroCusto} · ${r.centro?.nomeRM ?? "fora do cadastro"}`,
  },
  { chave: "origem", rotulo: "Conta de origem", valor: (r) => conta(r.contaOrigem) },
  { chave: "seta", rotulo: "", semFiltro: true },
  { chave: "destino", rotulo: "Conta adotada", valor: (r) => conta(r.contaDestino) },
  { chave: "motivo", rotulo: "Origem do registro", valor: (r) => r.motivo },
];
const EDITAR: Coluna<Reclassificacao> = { chave: "editar", rotulo: "", semFiltro: true, classe: "w-12" };

export function ReclassificacoesContent() {
  useRegistrarAcessoTela("/cadastros/reclassificacoes");

  const edicao = useEdicaoCadastro("reclassificacoes");

  const { data, isPending, isError } = useQuery({
    queryKey: ["cadastros", "reclassificacoes", TODOS],
    queryFn: () =>
      cadastrosService.reclassificacoes({
        pagina: 1,
        porPagina: TODOS,
      }),
    placeholderData: keepPreviousData,
  });
  const colunas = useMemo(() => (edicao.pode ? [...COLUNAS, EDITAR] : COLUNAS), [edicao.pode]);
  const tabela = useTabelaFiltravel(data?.itens, colunas, { porPaginaInicial: POR_PAGINA_INICIAL });

  return (
    <CadastroShell
      titulo="Reclassificações"
      exportar={<ExportarTabela titulo="Cadastros · Reclassificações · Por Conta" colunas={colunas} linhas={tabela.filtradas} />}
      comoUsar={
        <ul>
          <li>Use os filtros nos rótulos das colunas.</li>
          <li>Use “Novo” para indicar a conta de destino de uma conta de origem num centro de custo; o lápis edita, e a exclusão fica dentro da edição.</li>
          <li>
            A troca vale pelo centro do balancete do RM, também nos movimentos que vão para o centro imperativo do fornecedor (aba Por
            Fornecedor). A contestação validada continua por cima.
          </li>
          <li>Ao gravar, as competências ainda não apuradas são reclassificadas; as apuradas só mudam se forem reapuradas.</li>
        </ul>
      }
      descricao="Para o centro de custo, a conta de origem vale como a de destino. Corrige lançamentos feitos em conta de outro departamento ou atribuição."
      acoes={edicao.botaoNovo}
      total={tabela.total}
      pagina={tabela.pagina}
      porPagina={tabela.porPagina}
      onPorPaginaChange={tabela.setPorPagina}
      onPaginaChange={tabela.setPagina}
      carregando={isPending}
    >
      <DataTable<Reclassificacao>
        data={tabela.visiveis}
        cabecalho={tabela.cabecalho}
        filtrosAtivos={tabela.ativos}
        onLimparFiltros={tabela.limpar}
        isLoading={isPending}
        error={isError ? "Erro ao carregar as reclassificações." : null}
        emptyMessage="Nenhuma reclassificação encontrada"
        emptyHint="Ajuste os filtros para ver outros registros."
        columns={["Centro de custo", "Conta de origem", "", "Conta adotada", "Origem do registro", ...edicao.colunaEditar]}
        renderRow={(r) => (
          <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
            <td className="px-4 py-3 text-sm">
              <div className="flex max-w-64 items-baseline gap-1.5">
                <span className="font-medium whitespace-nowrap text-gray-900">{r.codigoCentroCusto}</span>
                <span className="truncate text-xs text-gray-600" title={r.centro?.nomeRM}>
                  {r.centro?.nomeRM ?? <span className="text-yellow-800">fora do cadastro</span>}
                </span>
              </div>
              {r.centro ? <Parametros departamento={r.centro.departamento} atribuicao={r.centro.atribuicao} /> : null}
            </td>
            <td className="px-4 py-3 text-sm">
              <div className="max-w-64 truncate text-gray-900" title={`${r.contaOrigem.reduzido} ${r.contaOrigem.descricao}`}>
                <span>{r.contaOrigem.reduzido}</span> {r.contaOrigem.descricao}
              </div>
              <Parametros
                departamento={r.contaOrigem.departamento}
                atribuicao={r.contaOrigem.atribuicao}
              />
            </td>
            <td className="px-2 py-3 text-gray-400">
              <ArrowRight className="size-4" />
            </td>
            <td className="px-4 py-3 text-sm">
              <div className="max-w-64 truncate font-medium text-gray-900" title={`${r.contaDestino.reduzido} ${r.contaDestino.descricao}`}>
                <span>{r.contaDestino.reduzido}</span> {r.contaDestino.descricao}
              </div>
              <Parametros
                departamento={r.contaDestino.departamento}
                atribuicao={r.contaDestino.atribuicao}
              />
            </td>
            <td className="px-4 py-3 text-xs text-gray-500">
              <div className="max-w-44" title={r.motivo ?? undefined}>
                {r.motivo ?? "—"}
              </div>
            </td>
            {edicao.pode ? <td className="w-12 px-2 py-3">{edicao.botaoEditar(r.id)}</td> : null}
          </tr>
        )}
      />
      {edicao.dialogo}
    </CadastroShell>
  );
}
