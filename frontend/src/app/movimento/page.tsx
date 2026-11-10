"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { ProtectedLayout } from "@/components/layout/ProtectedLayout";
import { api } from "@/lib/api";

/** O cabeçalho do movimento, como o backend devolve (o TMOV do TOTVS RM, com os nomes de fornecedor e tipo). */
type MovimentoDetalhe = {
  cabecalho: {
    idmov: number;
    codfilial: number | null;
    codcfo: string | null;
    numeromov: string | null;
    codtmv: string | null;
    dataemissao: string | null;
  };
  fornecedor: { codigo: string | null; nome: string | null };
  tipoMovimento: { codigo: string | null; nome: string | null; classificacao: string | null };
  /** Os itens conferidos com a tabela de lançamentos, já na ordem do NSEQITMMOV (que não aparece). */
  itens: Array<{
    nseqitmmov: number;
    codigoprd: string | null;
    produto: string | null;
    quantidade: string | null;
    precoUnitario: string | null;
    rateios: Array<{ codccusto: string; centro: string | null; valor: string | null }>;
  }>;
};

async function buscarMovimento(idmov: number): Promise<MovimentoDetalhe> {
  const { data } = await api.get<{ data: MovimentoDetalhe }>(`/proxy/movimento/${idmov}`);
  return data.data;
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string | number | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium text-gray-500">{rotulo}</dt>
      <dd className="text-sm text-gray-900">{valor ?? "—"}</dd>
    </div>
  );
}

type Item = NonNullable<MovimentoDetalhe["itens"]>[number];

/**
 * Um item e os seus rateios por centro de custo (um item pode ter mais de um). As colunas do item ocupam todas as
 * linhas do rateio, como uma célula mesclada ao lado de cada centro.
 */
function FragmentoItem({ item }: { item: Item }) {
  const rateios = item.rateios.length > 0 ? item.rateios : [null];
  const celulasItem = (
    <>
      <td rowSpan={rateios.length} className="px-3 py-2 align-top whitespace-nowrap border-r border-gray-100 font-medium text-gray-900">
        {item.codigoprd ?? "—"}
      </td>
      <td rowSpan={rateios.length} className="px-3 py-2 align-top border-r border-gray-100 font-medium text-gray-900">
        {item.produto ?? "—"}
      </td>
      <td rowSpan={rateios.length} className="px-3 py-2 text-right align-top border-r border-gray-100 font-medium text-gray-900">
        {item.quantidade ?? "—"}
      </td>
      <td rowSpan={rateios.length} className="px-3 py-2 text-right align-top border-r border-gray-100 font-medium text-gray-900">
        {item.precoUnitario ?? "—"}
      </td>
    </>
  );
  return (
    <>
      {rateios.map((r, i) => (
        <tr key={r?.codccusto ?? "sem-rateio"} className="border-b border-gray-100">
          {i === 0 ? celulasItem : null}
          <td className="px-3 py-1.5 whitespace-nowrap text-gray-700">
            {r ? (
              <>
                {r.codccusto}
                {r.centro ? <span className="text-gray-500"> · {r.centro}</span> : null}
              </>
            ) : (
              "—"
            )}
          </td>
          <td className="px-3 py-1.5 text-right text-gray-700">{r?.valor ?? "—"}</td>
        </tr>
      ))}
    </>
  );
}

export default function MovimentoPage() {
  const [digitado, setDigitado] = useState("");
  const [idmov, setIdmov] = useState<number | null>(null);

  const consulta = useQuery({
    queryKey: ["movimento", idmov],
    queryFn: () => buscarMovimento(idmov!),
    enabled: idmov !== null,
    retry: false,
  });

  const mensagemErro = (consulta.error as { response?: { data?: { error?: string } } } | null)?.response?.data?.error;

  function buscar(e: React.FormEvent) {
    e.preventDefault();
    const numero = Number(digitado);
    if (!Number.isInteger(numero) || numero <= 0) return;
    setIdmov(numero);
  }

  const m = consulta.data;

  return (
    <ProtectedLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-gray-900">Movimento</h1>

        <form onSubmit={buscar} className="flex items-end gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            IDMOV
            <input
              type="number"
              inputMode="numeric"
              value={digitado}
              onChange={(e) => setDigitado(e.target.value)}
              className="w-48 rounded-sm border border-gray-300 px-3 py-2 text-sm"
              placeholder="ex.: 95904"
            />
          </label>
          <Button type="submit" className="rounded-sm bg-bpm-primary font-bold text-black hover:bg-bpm-primary-hover">
            Buscar
          </Button>
        </form>

        {consulta.isFetching ? <p className="text-sm text-gray-500">Consultando o TOTVS RM…</p> : null}
        {consulta.isError ? <p className="text-sm text-red-700">{mensagemErro ?? "Não foi possível consultar o movimento."}</p> : null}

        {m ? (
          <section className="rounded-sm border border-gray-200 bg-white p-6">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">Cabeçalho</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
              <Campo rotulo="IDMOV" valor={m.cabecalho.idmov} />
              <Campo rotulo="Filial" valor={m.cabecalho.codfilial} />
              <Campo rotulo="Número" valor={m.cabecalho.numeromov} />
              <Campo rotulo="Data de emissão" valor={m.cabecalho.dataemissao} />
              <Campo rotulo="Tipo de movimento" valor={m.tipoMovimento.codigo} />
              <Campo rotulo="Nome do tipo" valor={m.tipoMovimento.nome} />
              <Campo rotulo="Classificação" valor={m.tipoMovimento.classificacao} />
              <Campo rotulo="Fornecedor (código)" valor={m.fornecedor.codigo} />
              <Campo rotulo="Fornecedor (nome)" valor={m.fornecedor.nome} />
            </dl>
          </section>
        ) : null}

        {m ? (
          <section className="rounded-sm border border-gray-200 bg-white p-6">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">Itens</h2>
            {m.itens.length === 0 ? (
              <p className="text-sm text-gray-500">Nenhum item deste movimento está nos lançamentos contábeis.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                      <th className="px-3 py-2 font-medium">Código do produto</th>
                      <th className="px-3 py-2 font-medium">Produto</th>
                      <th className="px-3 py-2 text-right font-medium">Quantidade</th>
                      <th className="px-3 py-2 text-right font-medium">Preço unitário</th>
                      <th className="px-3 py-2 font-medium">Centro de custo (rateio)</th>
                      <th className="px-3 py-2 text-right font-medium">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.itens.map((item) => (
                      <FragmentoItem key={item.nseqitmmov} item={item} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : null}
      </div>
    </ProtectedLayout>
  );
}
