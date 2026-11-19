"use client";

import { plural } from "@/lib/texto";

/** Uma linha dos quadros: a unidade e o departamento (com a ordem dos cadastros) e quantos colaboradores ela tem. */
export type ItemDosQuadros = {
  unidade: string | null;
  ordemDaUnidade: number | null;
  departamento: string | null;
  ordemDoDepartamento: number | null;
  quantidade: number;
};

const SEM = "Sem Departamento";
const SEM_UNIDADE = "Sem Unidade";
const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/** Os colaboradores somados por nome (na ordem do cadastro; os sem cadastro, por último e pelo nome). */
function somar(itens: ItemDosQuadros[], nome: (i: ItemDosQuadros) => string | null, ordem: (i: ItemDosQuadros) => number | null, vazio: string) {
  const porNome = new Map<string, { nome: string; ordem: number; quantidade: number }>();
  for (const i of itens) {
    if (!i.quantidade) continue;
    const n = nome(i) ?? vazio;
    const x = porNome.get(n) ?? { nome: n, ordem: nome(i) ? (ordem(i) ?? 9999) : 10000, quantidade: 0 };
    x.quantidade += i.quantidade;
    porNome.set(n, x);
  }
  return [...porNome.values()].sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR"));
}

/** Uma seção: o título com o total entre parênteses e um card por nome, com os colaboradores em destaque e o percentual do total. */
function Secao({ titulo, grupos, total }: { titulo: string; grupos: Array<{ nome: string; quantidade: number }>; total: number }) {
  return (
    <section>
      <h2 className="mb-1 text-sm font-bold tracking-wide text-gray-900 uppercase">
        {titulo}{" "}
        <span className="font-normal tracking-normal text-gray-500 normal-case">
          ({total.toLocaleString("pt-BR")} {plural(total, "colaborador", "colaboradores")})
        </span>
      </h2>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
        {grupos.map((g) => (
          <div key={g.nome} className="rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-2">
            <p className="truncate text-xs font-bold text-gray-600" title={g.nome}>
              {g.nome}
            </p>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xl font-extrabold text-gray-900">{g.quantidade.toLocaleString("pt-BR")}</p>
              <p className="text-sm whitespace-nowrap text-gray-700">{total ? pct(g.quantidade / total) : "—"}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Os quadros de destaque por Unidade e por Departamento (18/11/2026, pedido do Adão; como os da tela Fechamento Mensal / Totais /
 * Rateios): em cada um, os colaboradores e o percentual do total. O departamento é o do cadastro Departamentos (pelo grupo da DRE
 * do centro de custo) e a unidade, a do cadastro Unidades de Negócio, nas ordens deles. Os itens são os da tabela, com os filtros dela.
 */
export function QuadrosPorDepartamentoEUnidade({ itens }: { itens: ItemDosQuadros[] }) {
  const total = itens.reduce((s, i) => s + i.quantidade, 0);
  if (!total) return null;
  return (
    <div className="space-y-3">
      <Secao titulo="Por Unidade" grupos={somar(itens, (i) => i.unidade, (i) => i.ordemDaUnidade, SEM_UNIDADE)} total={total} />
      <Secao titulo="Por Departamento" grupos={somar(itens, (i) => i.departamento, (i) => i.ordemDoDepartamento, SEM)} total={total} />
    </div>
  );
}
