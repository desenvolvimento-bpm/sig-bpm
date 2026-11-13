"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";

import { DataTable } from "@/components/shared/DataTable";
import { ExportarTabela } from "@/components/shared/ExportarTabela";
import { useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/context/PermissionContext";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";
import type { Coluna } from "@/lib/filtrosDeTabela";
import { plural } from "@/lib/texto";

import { CadastroShell } from "../components/CadastroShell";
import { redistribuicoesService, vigenciaTexto, type Redistribuicao } from "../services/redistribuicoesService";
import { RedistribuicaoDialog } from "./RedistribuicaoDialog";

const POR_PAGINA_INICIAL = 50;
const pct = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`;
const destinosTexto = (r: Redistribuicao) => r.destinos.map((d) => `${d.centro}: ${pct(d.percentual)}`).join("; ");

const COLUNAS: Coluna<Redistribuicao>[] = [
  { chave: "departamento", rotulo: "Departamento da DRE", valor: (r) => r.departamento ?? "Todos" },
  { chave: "conta", rotulo: "Conta da DRE", valor: (r) => r.conta.rotulo },
  { chave: "fornecedores", rotulo: "Fornecedores", valor: (r) => r.fornecedores.length, texto: (r) => r.fornecedores.join("; "), tipo: "numero", alinhamento: "direita" },
  { chave: "destinos", rotulo: "Redistribuir Para", valor: destinosTexto },
  { chave: "vigencia", rotulo: "Vigência", valor: (r) => r.vigenciaInicio, texto: vigenciaTexto },
  { chave: "competencias", rotulo: "Competências", valor: (r) => r.competencias.length, texto: (r) => r.competencias.join(", "), tipo: "numero", alinhamento: "direita" },
  { chave: "situacao", rotulo: "Situação", valor: (r) => (r.ativo ? "Ativa" : "Inativa") },
];
const EDITAR: Coluna<Redistribuicao> = { chave: "editar", rotulo: "", semFiltro: true, classe: "w-12" };

/**
 * Cadastros Gerais / Controladoria / Redistribuições de Gastos (13/11/2026, pedido do Adão): as regras que
 * dividem os movimentos de fornecedores, numa conta da DRE, entre centros de custo, pelos percentuais e na vigência.
 */
export function RedistribuicoesContent() {
  useRegistrarAcessoTela("/cadastros/redistribuicoes-gastos");
  const { hasPermission } = usePermissions();
  const pode = hasPermission("cadastro_controladoria.redistribuicoes:editar");
  // undefined: fechado; null: nova; a redistribuição: editando.
  const [aberto, setAberto] = useState<Redistribuicao | null | undefined>(undefined);

  const lista = useQuery({ queryKey: ["cadastros", "redistribuicoes", "lista"], queryFn: redistribuicoesService.listar });
  const opcoes = useQuery({ queryKey: ["cadastros", "redistribuicoes", "opcoes"], queryFn: redistribuicoesService.opcoes });
  const colunas = useMemo(() => (pode ? [...COLUNAS, EDITAR] : COLUNAS), [pode]);
  const tabela = useTabelaFiltravel(lista.data, colunas, { porPaginaInicial: POR_PAGINA_INICIAL });

  return (
    <CadastroShell
      titulo="Redistribuições de Gastos"
      exportar={<ExportarTabela titulo="Cadastros · Controladoria · Redistribuições de Gastos" colunas={colunas} linhas={tabela.filtradas} />}
      descricao="Os movimentos dos fornecedores marcados, numa conta da DRE (e num departamento, ou em todos), valem divididos entre centros de custo, pelos percentuais, nas competências da vigência."
      comoUsar={
        <ul>
          <li>Use os filtros nos rótulos das colunas.</li>
          <li>
            Use “Novo” para incluir e o lápis para editar (a exclusão fica dentro da edição). No modal Redistribuição de Gastos, escolha o
            Departamento da DRE (ou Todos) e a Conta da DRE (a lista mostra as contas do departamento; digite parte do nome ou do código). A tabela
            traz os fornecedores com movimentos nessa combinação, em competências fechadas ou abertas, com os filtros nos rótulos: marque um a um ou
            todos pela caixa do rótulo (a regra guarda só os marcados; um fornecedor que aparecer depois entra só se for incluído).
          </li>
          <li>
            Em Redistribuir Para, adicione os centros de custo e o percentual de cada um: os percentuais somam 100%, ou a gravação fica bloqueada.
            Preencha a vigência (o mês do início e, se houver, o do fim).
          </li>
          <li>
            Na classificação de cada competência da vigência, os movimentos dos fornecedores marcados, na conta e no departamento, valem divididos
            entre os centros, pelos percentuais: cada parte vai à unidade e ao rateio do centro dela, e a conta da DRE não muda. As partes não passam
            pela verificação de departamento e atribuição. A redistribuição vale por cima das reclassificações e das contestações.
          </li>
          <li>Movimentos redistribuídos não podem ser contestados: no balancete e na Pesquisa, a coluna Ações mostra a etiqueta Redistribuição, com os destinos.</li>
          <li>
            Ao gravar, as competências ainda não apuradas da vigência são reclassificadas; as apuradas só mudam se forem reapuradas, e as fechadas
            ficam como foram fechadas. Na mesma conta, duas redistribuições ativas não podem ter um fornecedor em comum no mesmo período.
          </li>
          <li>A coluna Competências diz em quantas competências a regra já valeu; uma regra usada numa competência apurada ou fechada não se exclui: encerre a vigência.</li>
        </ul>
      }
      acoes={
        pode ? (
          <Button type="button" onClick={() => setAberto(null)} disabled={!opcoes.data} className="bg-bpm-primary hover:bg-bpm-primary-hover rounded-sm font-bold text-black shadow-sm">
            <Plus className="size-4" />
            Novo
          </Button>
        ) : null
      }
      total={tabela.total}
      pagina={tabela.pagina}
      porPagina={tabela.porPagina}
      onPorPaginaChange={tabela.setPorPagina}
      onPaginaChange={tabela.setPagina}
      carregando={lista.isPending}
    >
      <DataTable<Redistribuicao>
        data={tabela.visiveis}
        cabecalho={tabela.cabecalho}
        filtrosAtivos={tabela.ativos}
        onLimparFiltros={tabela.limpar}
        isLoading={lista.isPending}
        error={lista.isError ? "Erro ao carregar as redistribuições." : null}
        emptyMessage="Nenhuma redistribuição de gastos cadastrada"
        emptyHint="Use “Novo” para cadastrar uma, ou ajuste os filtros para ver outros registros."
        columns={colunas.map((c) => c.rotulo)}
        renderRow={(r) => (
          <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
            <td className="px-4 py-3 text-sm text-gray-900">{r.departamento ?? "Todos"}</td>
            <td className="px-4 py-3 text-sm">
              <div className="max-w-64 truncate text-gray-900" title={r.conta.rotulo}>
                {r.conta.rotulo}
              </div>
              <span className="text-xs text-gray-500">{r.conta.codigo}</span>
            </td>
            <td className="px-4 py-3 text-right text-sm text-gray-700" title={r.fornecedores.join("\n")}>
              {r.fornecedores.length} {plural(r.fornecedores.length, "fornecedor", "fornecedores")}
            </td>
            <td className="px-4 py-3 text-sm text-gray-700">
              <ul className="space-y-0.5">
                {r.destinos.map((d) => (
                  <li key={d.centroCustoId} className="flex max-w-80 items-baseline justify-between gap-3">
                    <span className="truncate" title={d.centro}>
                      {d.centro}
                    </span>
                    <span className="font-medium whitespace-nowrap text-gray-900">{pct(d.percentual)}</span>
                  </li>
                ))}
              </ul>
            </td>
            <td className="px-4 py-3 text-sm whitespace-nowrap text-gray-700">{vigenciaTexto(r)}</td>
            <td className="px-4 py-3 text-right text-sm text-gray-700" title={r.competencias.join(", ") || "Ainda não valeu em nenhuma competência"}>
              {r.competencias.length}
            </td>
            <td className="px-4 py-3 text-sm text-gray-700">{r.ativo ? "Ativa" : "Inativa"}</td>
            {pode ? (
              <td className="w-12 px-2 py-3">
                <button type="button" onClick={() => setAberto(r)} disabled={!opcoes.data} title="Editar" className="rounded-sm p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-900">
                  <Pencil className="size-4" />
                </button>
              </td>
            ) : null}
          </tr>
        )}
      />
      {aberto !== undefined && opcoes.data ? <RedistribuicaoDialog registro={aberto} opcoes={opcoes.data} pode={pode} onFechar={() => setAberto(undefined)} /> : null}
    </CadastroShell>
  );
}
