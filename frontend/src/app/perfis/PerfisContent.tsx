"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Power, PowerOff, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ExportarTabela } from "@/components/shared/ExportarTabela";
import { ConfirmacaoDialog } from "@/components/shared/ConfirmacaoDialog";
import { DataTable } from "@/components/shared/DataTable";
import { useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { Button } from "@/components/ui/button";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";
import type { Coluna } from "@/lib/filtrosDeTabela";
import { CabecalhoDaTela } from "@/components/shared/CabecalhoDaTela";
import { QuadroTabela } from "@/components/shared/QuadroTabela";

import { mensagemDeErro, usuariosService, type Perfil } from "../usuarios/services/usuariosService";
import { PerfilDialog } from "./components/PerfilDialog";
import { plural } from "@/lib/texto";

/** Quantas telas o perfil lê, e quantas edita (as abas contam dentro da tela; 14/10/2026). */
function resumoPermissoes(p: Perfil) {
  const telas = (acao: string) => new Set(p.permissoes.filter((x) => x.acao === acao && !x.chave.includes(".")).map((x) => x.chave)).size;
  const leitura = telas("LER");
  return `${leitura} ${plural(leitura, "tela", "telas")} com leitura, ${telas("EDITAR")} com edição`;
}

// Com iniciais maiúsculas (27/10/2026), como os nomes da interface.
const recorte = (p: Perfil) =>
  [p.recorteSetor ? "Por Setor" : null, p.recorteDepartamento ? "Por Departamento" : null, p.recorteCentro ? "Por Centro de Custo" : null].filter(Boolean).join(", ");
/** O Acesso a Informações Sensíveis (27/10/2026). */
const sensiveis = (p: Perfil) => (p.informacoesSensiveis ? "Com Acesso" : "Sem Acesso");
const ehAdministrador = (p: Perfil) => p.codigo === "ADMINISTRADOR";

const COLUNAS: Coluna<Perfil>[] = [
  { chave: "perfil", rotulo: "Perfil", valor: (p) => p.nome },
  { chave: "permissoes", rotulo: "Permissões", valor: resumoPermissoes },
  { chave: "recorte", rotulo: "Recorte", valor: recorte },
  { chave: "sensiveis", rotulo: "Informações Sensíveis", valor: sensiveis },
  { chave: "usuarios", rotulo: "Usuários", tipo: "numero", valor: (p) => p.usuarios, texto: (p) => String(p.usuarios) },
  { chave: "situacao", rotulo: "Situação", valor: (p) => (p.ativo ? "Ativo" : "Inativo") },
  { chave: "acoes", rotulo: "", semFiltro: true },
];

export function PerfisContent() {
  useRegistrarAcessoTela("/perfis");
  const queryClient = useQueryClient();
  const [editando, setEditando] = useState<Perfil | null | "novo">(null);
  // Os perfis inativos só com "Mostrar Inativados" (27/10/2026).
  const [mostrarInativados, setMostrarInativados] = useState(false);
  // A inativação ou a exclusão que espera a confirmação no modal padrão (30/10/2026; antes, a do navegador).
  const [confirmando, setConfirmando] = useState<{ perfil: Perfil; acao: "inativar" | "excluir" } | null>(null);
  const perfis = useQuery({ queryKey: ["perfis"], queryFn: usuariosService.perfis });
  const opcoes = useQuery({ queryKey: ["usuarios", "opcoes"], queryFn: usuariosService.opcoes });
  const excluir = useMutation({
    mutationFn: (id: string) => usuariosService.excluirPerfil(id),
    onSuccess: () => {
      toast.success("Perfil excluído.");
      setConfirmando(null);
      queryClient.invalidateQueries({ queryKey: ["perfis"] });
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível excluir o perfil.")),
  });
  // Inativar e reativar (27/10/2026), a ação da lista: como a caixa Ativo do modal.
  const situacao = useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) => usuariosService.mudarSituacaoPerfil(id, ativo),
    onSuccess: (_, v) => {
      toast.success(v.ativo ? "Perfil reativado." : "Perfil inativado.");
      setConfirmando(null);
      queryClient.invalidateQueries({ queryKey: ["perfis"] });
      queryClient.invalidateQueries({ queryKey: ["usuarios"] });
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível mudar a situação do perfil.")),
  });
  const inativos = (perfis.data ?? []).filter((p) => !p.ativo).length;
  const tabela = useTabelaFiltravel(perfis.data?.filter((p) => mostrarInativados || p.ativo), COLUNAS);

  return (
    <div className="space-y-6">
      <CabecalhoDaTela
        titulo="Perfis de Usuário"
        exportar={<ExportarTabela titulo="Perfis de Usuário" colunas={COLUNAS} linhas={tabela.filtradas} />}
        comoUsar={
          <ul>
            <li>
              Use “Novo Perfil” para criar um tipo de usuário. Na linha, o lápis edita, o botão de desligar inativa o perfil (os usuários dele deixam de
              entrar; o de ligar o reativa) e a lixeira exclui — a inativação e a exclusão, depois da confirmação num modal. A lista mostra só os perfis ativos; marque “Mostrar Inativados”, antes de “Novo Perfil”,
              para ver também os inativos (em cinza). Você não inativa o seu próprio perfil.
            </li>
            <li>
              Só os perfis criados nesta tela têm a lixeira, e só sem usuários (troque o perfil deles antes). Os que vêm
              com a ferramenta — Administrador, Contador, Coordenador e Gestor — são perfis de sistema: não se excluem, só se inativam, para a instalação
              nunca ficar sem os tipos de usuário básicos.
            </li>
            <li>
              O Administrador é um perfil de sistema com acesso total a todas as telas, sem recortes (as telas novas entram sozinhas): não se exclui
              nem se inativa, as permissões dele não mudam (só a descrição se edita), não fica sem usuário ativo, e só um Administrador promove outro
              usuário a ele.
            </li>
            <li>No perfil, os grupos de telas aparecem como no menu lateral, sob o título dele (Análises Gerenciais, Criação de Cenários, Apuração dos Resultados, Processos Auxiliares, Controladoria). Clique na seta do grupo para abrir as telas dele, e na seta de uma tela para abrir as abas dela (o botão de setas para cima e para baixo, antes de “Grupo, Tela e Aba”, abre e recolhe todos). Marque em cada tela e em cada aba o que o perfil pode: Ler (a tela aparece no menu e mostra os dados; a aba aparece) ou Editar (pode alterar; marca o Ler junto). Por exemplo: ler os Resultados Empresariais sem acesso ao Fechamento Mensal, ou ver a tela Resultados do mês só na aba Matriz.</li>
            <li>A caixa do grupo ou da tela marca (e desmarca) tudo o que está abaixo dela; o traço na caixa mostra que só parte está marcada. A aba só vale com a tela lida: marcar a aba marca a leitura da tela, e desmarcar a leitura da tela desmarca as abas.</li>
            <li>As permissões valem também no servidor: uma aba sem permissão não aparece e os dados dela não são enviados.</li>
            <li>Os recortes por setor e por departamento limitam o que os usuários do perfil alcançam, por cima dos grupos. O recorte por departamento limita as movimentações da DRE às linhas dos departamentos do usuário (as da Receita Bruta, da Receita Líquida e dos Impostos Operacionais ficam abertas a todos) e os centros de custo aos dele; o recorte por centro de custo (o Coordenador) limita a visão por centro de custo aos centros marcados no usuário (de uma gestão), com as movimentações deles, e nas unidades deixa só as movimentações abertas a todos; com recorte por departamento ou por centro de custo, o Fechamento Mensal não mostra as etapas e as abas com lançamentos de todos os departamentos (Classificação, Lançamentos, Prévias › Receita, Totais › Rateios, Prévias › Estoque, Conferência), nem o Controle de Usuários a Auditoria; com recorte por setor, o Fechamento Mensal mostra só Competências, Importações e Listas.</li>
            <li>
              “Acesso a Informações Sensíveis”, no perfil, libera as movimentações das linhas de Mão de Obra Direta e Indireta da DRE (Remunerações CLT
              e PJ, Horas Extras, Multas Rescisórias, Encargos e Benefícios e Pró Labore Diretoria). Sem ele, os usuários do perfil veem os valores
              dessas linhas, mas elas não abrem o extrato nem o balancete (em nenhuma visão: unidades, centros de custo, obras e sem centro de custo) e
              ficam fora da aba Detalhes do Exportar. O perfil novo vem sem ele; o Administrador tem sempre. A coluna Informações Sensíveis da lista
              mostra quem tem.
            </li>
          </ul>
        }
        sobre={
          <p>
            Os tipos de usuário e o que cada um pode fazer: Ler ou Editar em cada tela do menu lateral (e nas etapas do mês) e em cada aba de conteúdo
            delas (as abas que só filtram a mesma lista, as das Listas e as dos modais seguem a tela). Os perfis que vêm com a ferramenta (Contador, Coordenador e Gestor) podem ser
            editados e inativados, mas não excluídos.
          </p>
        }
        acoes={
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-700" title="Mostra também os perfis inativos, em cinza">
            <input type="checkbox" checked={mostrarInativados} onChange={(e) => setMostrarInativados(e.target.checked)} className="size-4 accent-black" />
            Mostrar Inativados{inativos ? <span className="text-gray-500">({inativos})</span> : null}
          </label>
        <PermissionGuard permission="perfis:editar">
          <Button
            type="button"
            disabled={!opcoes.data}
            onClick={() => setEditando("novo")}
            className="bg-bpm-primary hover:bg-bpm-primary-hover rounded-sm font-bold text-black shadow-sm"
          >
            <Plus className="size-4" />
            Novo Perfil
          </Button>
        </PermissionGuard>
        </div>
        }
      />

      <QuadroTabela>
        <DataTable<Perfil>
          data={tabela.visiveis}
          cabecalho={tabela.cabecalho}
          filtrosAtivos={tabela.ativos}
          onLimparFiltros={tabela.limpar}
          isLoading={perfis.isPending}
          error={perfis.isError ? mensagemDeErro(perfis.error, "Erro ao carregar os perfis.") : null}
          emptyMessage="Nenhum perfil"
          columns={["Perfil", "Permissões", "Recorte", "Informações Sensíveis", "Usuários", "Situação", ""]}
          renderRow={(p) => (
            <tr key={p.id} className={`border-b border-gray-100 hover:bg-gray-50 ${p.ativo ? "" : "text-gray-400"}`}>
              <td className="px-4 py-3 text-sm">
                <span className="font-medium">{p.nome}</span>
                {p.descricao ? <div className="text-xs text-gray-500">{p.descricao}</div> : null}
              </td>
              <td className="px-4 py-3 text-xs text-gray-600">{resumoPermissoes(p)}</td>
              <td className="px-4 py-3 text-xs text-gray-600">
                {recorte(p) || "—"}
              </td>
              <td className="px-4 py-3 text-xs text-gray-600">{sensiveis(p)}</td>
              <td className="px-4 py-3 text-sm">{p.usuarios}</td>
              <td className="px-4 py-3 text-sm">{p.ativo ? "Ativo" : "Inativo"}</td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                <PermissionGuard permission="perfis:editar">
                  <Button type="button" variant="ghost" size="icon" aria-label="Editar" disabled={!opcoes.data} onClick={() => setEditando(p)}>
                    <Pencil className="size-4" />
                  </Button>
                  {/* Inativar ou reativar (27/10/2026), em todos os perfis menos o Administrador. */}
                  {!ehAdministrador(p) ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={p.ativo ? "Inativar" : "Reativar"}
                      title={p.ativo ? "Inativar o perfil: os usuários dele deixam de entrar" : "Reativar o perfil"}
                      disabled={situacao.isPending}
                      onClick={() => (p.ativo ? setConfirmando({ perfil: p, acao: "inativar" }) : situacao.mutate({ id: p.id, ativo: true }))}
                    >
                      {p.ativo ? <PowerOff className="size-4" /> : <Power className="size-4" />}
                    </Button>
                  ) : null}
                  {!p.sistema ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Excluir"
                      disabled={excluir.isPending}
                      onClick={() => setConfirmando({ perfil: p, acao: "excluir" })}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  ) : null}
                </PermissionGuard>
              </td>
            </tr>
          )}
        />
      </QuadroTabela>

      {editando && opcoes.data ? (
        <PerfilDialog key={editando === "novo" ? "novo" : editando.id} opcoes={opcoes.data} editando={editando === "novo" ? null : editando} onFechar={() => setEditando(null)} />
      ) : null}
      {confirmando?.acao === "inativar" ? (
        <ConfirmacaoDialog
          titulo={`Inativar o Perfil ${confirmando.perfil.nome}`}
          descricao={
            confirmando.perfil.usuarios
              ? `${plural(confirmando.perfil.usuarios, "O usuário dele deixa", `Os ${confirmando.perfil.usuarios} usuários dele deixam`)} de entrar no SIG até o perfil ser reativado (o botão de ligar, com “Mostrar Inativados”).`
              : "O perfil sai da lista (aparece com “Mostrar Inativados”) e pode ser reativado depois."
          }
          acao="Inativar"
          acaoPendente="Inativando…"
          pendente={situacao.isPending}
          onConfirmar={() => situacao.mutate({ id: confirmando.perfil.id, ativo: false })}
          onFechar={() => setConfirmando(null)}
        />
      ) : null}
      {confirmando?.acao === "excluir" ? (
        <ConfirmacaoDialog
          titulo={`Excluir o Perfil ${confirmando.perfil.nome}`}
          descricao="O perfil sai do SIG, com as permissões dele. A exclusão fica no log de auditoria e não se desfaz."
          pendente={excluir.isPending}
          onConfirmar={() => excluir.mutate(confirmando.perfil.id)}
          onFechar={() => setConfirmando(null)}
        />
      ) : null}
    </div>
  );
}
