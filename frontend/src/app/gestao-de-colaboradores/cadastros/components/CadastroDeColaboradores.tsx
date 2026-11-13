"use client";

import { useMemo, useState, type ReactNode } from "react";
import { plural } from "@/lib/texto";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, EllipsisVertical, FileUp, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmacaoDialog } from "@/components/shared/ConfirmacaoDialog";
import { DataTable } from "@/components/shared/DataTable";
import { ExportarTabela } from "@/components/shared/ExportarTabela";
import { useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import { usePermissions } from "@/context/PermissionContext";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";
import type { Coluna } from "@/lib/filtrosDeTabela";
import { botaoPrimario } from "@/app/cenarios/components/CenarioDialog";
import { registroAtivo, useApenasAtivas } from "@/app/cadastros/components/ApenasAtivas";
import { CadastroShell } from "@/app/cadastros/components/CadastroShell";
import { EditarRegistroDialog } from "@/app/cadastros/components/EditarRegistroDialog";
import { colunaDoCampo, ehNumero, formatar, textoDoCampo } from "@/app/cadastros/components/ListaCadastroContent";
import { edicaoService, mensagemDeErro, type Registro } from "@/app/cadastros/services/edicaoService";

import type { TipoImportacaoColaboradores } from "../services/colaboradoresService";
import { ImportarColaboradoresDialog } from "./ImportarColaboradoresDialog";

const ACOES: Coluna<Registro> = { chave: "acoes", rotulo: "Ações", semFiltro: true, classe: "w-20" };

/** A competência e os totais do Lançamento Inicial, no destaque amarelo-ouro acima da tabela. */
function ResumoDaCarga({ lista }: { lista: Registro[] }) {
  const clt = lista.filter((r) => r.vinculo === "CLT").length;
  const pj = lista.length - clt;
  return (
    <p className="rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-2 text-sm text-gray-700">
      Quadro do início de <span className="font-medium text-gray-900">{String(lista[0].competencia ?? "")}</span>: {lista.length}{" "}
      {plural(lista.length, "colaborador", "colaboradores")} ({clt} CLT e {pj} PJ).
    </p>
  );
}

type Props = {
  /** A entidade da edição genérica (colaboradores-senioridades…). */
  entidade: string;
  /** A aba na matriz dos perfis (colaboradores_cadastros.<aba>). */
  aba: string;
  rota: string;
  titulo: string;
  descricao: string;
  comoUsar: ReactNode;
  /** O registro, com o artigo, nas confirmações: "a senioridade", "o colaborador". */
  oRegistro: string;
  /** A aba que importa planilha (Funções e Lançamento Inicial). */
  importar?: TipoImportacaoColaboradores;
  /**
   * O Lançamento Inicial: sem a caixa Apenas Ativas e sem Inativar (os registros não se inativam), com a competência e os
   * totais acima da tabela.
   */
  lancamentoInicial?: boolean;
};

/**
 * Uma aba da tela Cadastros da Gestão de Colaboradores (06/11/2026, pedido do Adão): a caixa Apenas Ativas, o Importar
 * (nas abas que importam planilha) e o Novo na altura do título; na última coluna, o menu Ações — Editar, Inativar (ou
 * Reativar) e Excluir, que só vale no registro sem uso em outras telas (o motivo aparece ao passar o mouse). Com a trava
 * do cadastro (13/11/2026: o Lançamento Inicial com competências fechadas na Gestão de Colaboradores), sem o Importar, o
 * Novo e o menu Ações, e o motivo num destaque acima da tabela.
 */
export function CadastroDeColaboradores({ entidade, aba, rota, titulo, descricao, comoUsar, oRegistro, importar, lancamentoInicial }: Props) {
  const semAtivo = lancamentoInicial;
  useRegistrarAcessoTela(rota);
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const def = useQuery({ queryKey: ["edicao", entidade, "definicao"], queryFn: () => edicaoService.definicao(entidade) });
  const trava = def.data?.trava ?? null;
  const pode = hasPermission(`colaboradores_cadastros.${aba}:editar`) && !trava;
  const lista = useQuery({ queryKey: ["edicao", entidade, "lista"], queryFn: () => edicaoService.listar(entidade) });
  // undefined: fechado; null: novo; string: o registro em edição.
  const [editando, setEditando] = useState<string | null | undefined>(undefined);
  const [importando, setImportando] = useState(false);
  const [confirmando, setConfirmando] = useState<{ registro: Registro; acao: "excluir" | "inativar" } | null>(null);

  const campos = useMemo(() => (def.data?.campos ?? []).filter((c) => c.tipo !== "multipla" && c.tipo !== "formula" && c.naTabela !== false), [def.data]);
  const colunas = useMemo(() => [...campos.map(colunaDoCampo), ...(pode ? [ACOES] : [])], [campos, pode]);
  const ativas = useApenasAtivas(lista.data, registroAtivo);
  // O nome do registro nas confirmações e no menu: o Nome; no Lançamento Inicial, a função e o centro de custo.
  const nomeDo = (r: Registro) => {
    if (typeof r.nome === "string") return r.nome;
    const texto = (nome: string) => {
      const c = def.data?.campos.find((x) => x.nome === nome);
      return c ? textoDoCampo(c, r[nome]) : null;
    };
    return [texto("funcaoId"), texto("centroCustoId")].filter(Boolean).join(" · ") || "Registro";
  };
  const tabela = useTabelaFiltravel(ativas.itens, colunas, { porPaginaInicial: 50 });

  // Outras abas mostram este cadastro nas listas (as funções nas classificações…): tudo da edição se atualiza.
  const depois = () => void queryClient.invalidateQueries({ queryKey: ["edicao"] });
  const mudar = useMutation({
    mutationFn: ({ registro, acao }: { registro: Registro; acao: "excluir" | "inativar" | "reativar" }) =>
      acao === "excluir" ? edicaoService.excluir(entidade, registro.id) : edicaoService.atualizar(entidade, registro.id, { ativo: acao === "reativar" }),
    onSuccess: (_r, { acao }) => {
      toast.success(acao === "excluir" ? "Registro excluído." : acao === "inativar" ? "Registro inativado." : "Registro reativado.");
      setConfirmando(null);
      depois();
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível gravar.")),
  });

  return (
    <CadastroShell
      titulo={titulo}
      exportar={<ExportarTabela titulo={`Gestão de Colaboradores · ${titulo}`} colunas={colunas.filter((c) => c.chave !== "acoes")} linhas={tabela.filtradas} />}
      descricao={descricao}
      comoUsar={comoUsar}
      apenasAtivas={semAtivo ? undefined : ativas.controle}
      acoes={
        pode ? (
          <div className="flex flex-wrap items-center gap-2">
            {importar ? (
              <Button type="button" className={botaoPrimario} onClick={() => setImportando(true)}>
                <FileUp className="size-4" />
                Importar
              </Button>
            ) : null}
            <Button type="button" className={botaoPrimario} onClick={() => setEditando(null)}>
              <Plus className="size-4" />
              Novo
            </Button>
          </div>
        ) : null
      }
      total={tabela.total}
      pagina={tabela.pagina}
      porPagina={tabela.porPagina}
      onPorPaginaChange={tabela.setPorPagina}
      onPaginaChange={tabela.setPagina}
      carregando={def.isPending || lista.isPending}
      aviso={
        trava || (lancamentoInicial && lista.data?.length) ? (
          <div className="space-y-2">
            {lancamentoInicial && lista.data?.length ? <ResumoDaCarga lista={lista.data} /> : null}
            {/* A trava do cadastro, no destaque padrão com a borda vermelha. */}
            {trava ? <p className="rounded-sm border border-l-4 border-gray-200 border-l-red-600 bg-white px-4 py-2 text-sm text-gray-700">{trava}</p> : null}
          </div>
        ) : null
      }
    >
      <DataTable<Registro>
        data={tabela.visiveis}
        cabecalho={tabela.cabecalho}
        filtrosAtivos={tabela.ativos}
        onLimparFiltros={tabela.limpar}
        isLoading={def.isPending || lista.isPending}
        error={def.isError || lista.isError ? "Erro ao carregar o cadastro." : null}
        emptyMessage="Nenhum registro encontrado"
        emptyHint={pode ? (importar ? "Use Novo ou Importar para incluir." : "Use Novo para incluir.") : "Ajuste os filtros para ver outros registros."}
        columns={colunas.map((c) => c.rotulo)}
        renderRow={(r) => {
          const ativo = registroAtivo(r);
          const emUso = typeof r.emUso === "string" ? r.emUso : null;
          return (
            <tr key={r.id} className={`border-b border-gray-100 hover:bg-gray-50 ${ativo ? "" : "text-gray-500"}`}>
              {campos.map((c) => (
                <td key={c.nome} className={`px-4 py-3 text-sm ${ehNumero(c) ? "text-right whitespace-nowrap" : ""} ${c.estreita ? "w-28 whitespace-nowrap" : ""}`}>
                  {formatar(c, r[c.nome])}
                </td>
              ))}
              {pode ? (
                <td className="px-4 py-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button type="button" size="icon" variant="outline" className="size-7 rounded-sm" aria-label={`Ações de ${nomeDo(r)}`} title="Ações">
                          <EllipsisVertical className="size-4" />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end" className="w-auto min-w-40">
                      <DropdownMenuItem onClick={() => setEditando(r.id)}>
                        <Pencil />
                        Editar
                      </DropdownMenuItem>
                      {semAtivo ? null : ativo ? (
                        <DropdownMenuItem onClick={() => setConfirmando({ registro: r, acao: "inativar" })}>
                          <Ban />
                          Inativar
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onClick={() => mudar.mutate({ registro: r, acao: "reativar" })}>
                          <RotateCcw />
                          Reativar
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" disabled={!!emUso} title={emUso ?? undefined} onClick={() => setConfirmando({ registro: r, acao: "excluir" })}>
                        <Trash2 />
                        Excluir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              ) : null}
            </tr>
          );
        }}
      />
      {editando !== undefined ? (
        <EditarRegistroDialog
          entidade={entidade}
          id={editando}
          onFechar={() => {
            setEditando(undefined);
            depois();
          }}
        />
      ) : null}
      {importando && importar ? <ImportarColaboradoresDialog tipo={importar} onFechar={() => setImportando(false)} /> : null}
      {confirmando ? (
        <ConfirmacaoDialog
          titulo={confirmando.acao === "excluir" ? "Excluir Registro" : "Inativar Registro"}
          descricao={
            confirmando.acao === "excluir"
              ? `Exclui ${oRegistro} do cadastro. Não é possível desfazer.`
              : `Inativa ${oRegistro}: os registros que já usam o cadastro ficam como estão, e ele sai das listas de escolha. Para voltar, use Reativar no menu Ações.`
          }
          acao={confirmando.acao === "excluir" ? "Excluir" : "Inativar"}
          acaoPendente={confirmando.acao === "excluir" ? "Excluindo…" : "Inativando…"}
          pendente={mudar.isPending}
          onConfirmar={() => mudar.mutate(confirmando)}
          onFechar={() => setConfirmando(null)}
        >
          <p className="rounded-sm border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900">{nomeDo(confirmando.registro)}</p>
        </ConfirmacaoDialog>
      ) : null}
    </CadastroShell>
  );
}
