"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, EllipsisVertical, Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { CabecalhoDaTela } from "@/components/shared/CabecalhoDaTela";
import { ConfirmacaoDialog } from "@/components/shared/ConfirmacaoDialog";
import { DataTable } from "@/components/shared/DataTable";
import { QuadroTabela } from "@/components/shared/QuadroTabela";
import { useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { usePermissions } from "@/context/PermissionContext";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";
import type { Coluna } from "@/lib/filtrosDeTabela";
import { botaoPrimario } from "@/app/cenarios/components/CenarioDialog";
import { dataHora } from "@/app/competencias/[anoMes]/utils/formatacao";

import { arquivosGeraisService, mensagemDeErro, tamanhoLegivel, type ArquivoGeral, type TelaDosArquivos } from "../services/arquivosGeraisService";
import { AdicionarArquivoDialog, EditarArquivoDialog } from "./AdicionarArquivoDialog";

const NOMES: Record<TelaDosArquivos, string> = { treinamentos: "Treinamentos", informativos: "Informativos" };

const SOBRE: Record<TelaDosArquivos, string> = {
  treinamentos: "Os arquivos dos treinamentos (apostilas, apresentações, vídeos, listas de presença…), guardados no SIG para consulta de todos com acesso a esta tela.",
  informativos: "Os arquivos dos informativos (comunicados, boletins, orientações…), guardados no SIG para consulta de todos com acesso a esta tela.",
};

/** A extensão do nome, em maiúsculas (PDF, XLSX); sem extensão, vazio. */
const extensao = (nome: string) => (/\.([^.]+)$/.exec(nome)?.[1] ?? "").toUpperCase();

const COLUNAS: Coluna<ArquivoGeral>[] = [
  { chave: "descricao", rotulo: "Descrição", valor: (a) => a.descricao },
  // O processo do arquivo (11/11/2026): Geral ou o nome do processo.
  { chave: "processo", rotulo: "Processo", valor: (a) => a.processoNome, classe: "w-48" },
  { chave: "tipo", rotulo: "Tipo", valor: (a) => extensao(a.nomeOriginal), classe: "w-24" },
  { chave: "tamanho", rotulo: "Tamanho", tipo: "numero", alinhamento: "direita", valor: (a) => a.tamanho, texto: (a) => tamanhoLegivel(a.tamanho), classe: "w-28" },
  { chave: "enviadoPor", rotulo: "Adicionado Por", valor: (a) => a.enviadoPorNome, classe: "w-48" },
  { chave: "enviadoEm", rotulo: "Adicionado Em", tipo: "data", valor: (a) => new Date(a.enviadoEm).getTime(), texto: (a) => dataHora(a.enviadoEm), classe: "w-40" },
  { chave: "acoes", rotulo: "Ações", semFiltro: true, classe: "w-20" },
];

/**
 * Arquivos Gerais (05/11/2026, pedido do Adão), em Controladoria: as telas Treinamentos e Informativos, cada uma com a sua
 * lista de arquivos. Quem lê a tela visualiza (os tipos que o navegador abre) e baixa; quem a edita também adiciona (com a
 * descrição, que aparece na lista e serve à busca, e o processo), edita e exclui. Desde 11/11/2026 (pedido do Adão), cada
 * arquivo tem o processo (Geral ou um dos vigentes), e a lista mostra a cada usuário os Gerais e os dos processos em que
 * ele lê ou edita alguma tela.
 */
export function ArquivosGeraisContent({ tela }: { tela: TelaDosArquivos }) {
  useRegistrarAcessoTela(`/arquivos-gerais/${tela}`);
  const { hasPermission } = usePermissions();
  const podeEditar = hasPermission(`arquivos_${tela}:editar`);
  const queryClient = useQueryClient();
  const chave = ["arquivos-gerais", tela];
  const consulta = useQuery({ queryKey: chave, queryFn: () => arquivosGeraisService.listar(tela) });
  const [adicionando, setAdicionando] = useState(false);
  const [excluindo, setExcluindo] = useState<ArquivoGeral | null>(null);
  const [editando, setEditando] = useState<ArquivoGeral | null>(null);
  const tabela = useTabelaFiltravel(consulta.data?.arquivos, COLUNAS);
  const processos = consulta.data?.processos ?? [];

  const excluir = useMutation({
    mutationFn: (a: ArquivoGeral) => arquivosGeraisService.excluir(tela, a.id),
    onSuccess: (_, a) => {
      toast.success(`Arquivo excluído: ${a.descricao}.`);
      setExcluindo(null);
      void queryClient.invalidateQueries({ queryKey: chave });
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível excluir o arquivo.")),
  });

  const visualizar = (a: ArquivoGeral) => window.open(arquivosGeraisService.endereco(tela, a.id, "ver"), "_blank", "noopener");
  const baixar = (a: ArquivoGeral) => {
    const link = document.createElement("a");
    link.href = arquivosGeraisService.endereco(tela, a.id, "baixar");
    link.download = a.nomeOriginal;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const nome = NOMES[tela];
  return (
    <div className="space-y-6">
      <CabecalhoDaTela
        titulo={nome}
        sobre={<p>{SOBRE[tela]}</p>}
        comoUsar={
          <ul>
            <li>
              Os rótulos das colunas ordenam e filtram a lista, como no Excel; para achar um arquivo pela descrição, use a pesquisa do filtro da
              coluna Descrição.
            </li>
            <li>
              No menu da coluna Ações: “Visualizar” abre o arquivo numa nova aba do navegador — PDF, imagem, vídeo, áudio ou texto; os demais tipos
              (como planilhas e apresentações) ficam só com o Baixar —, e “Baixar” salva o arquivo no computador, com o nome original.
            </li>
            {podeEditar ? (
              <>
                <li>
                  “Adicionar”, à direita do título, envia um arquivo (de qualquer tipo, até 500 MB): escolha o arquivo, escreva a descrição, que
                  aparece na lista e serve para buscá-lo (ela começa pelo nome do arquivo, sem a extensão), e escolha o Processo (Geral ou um dos
                  processos do menu).
                </li>
                <li>No menu da coluna Ações, “Editar” muda a descrição e o processo do arquivo, e “Excluir” apaga o arquivo do SIG, depois da confirmação.</li>
              </>
            ) : null}
            <li>
              Quem tem Ler nesta tela (Controle de Usuários › Perfis) visualiza e baixa os arquivos; quem tem Editar também os adiciona, edita e
              exclui. A lista mostra os arquivos Gerais e os dos processos em que o seu perfil lê ou edita alguma tela (a coluna Processo diz de qual
              é cada um).
            </li>
          </ul>
        }
        acoes={
          podeEditar ? (
            <Button type="button" className={botaoPrimario} onClick={() => setAdicionando(true)} title={`Adicionar um arquivo em ${nome}`}>
              <Plus className="size-4" />
              Adicionar
            </Button>
          ) : undefined
        }
      />
      <QuadroTabela>
        <DataTable<ArquivoGeral>
          data={tabela.visiveis}
          cabecalho={tabela.cabecalho}
          filtrosAtivos={tabela.ativos}
          onLimparFiltros={tabela.limpar}
          isLoading={consulta.isPending}
          error={consulta.isError ? mensagemDeErro(consulta.error, "Erro ao carregar os arquivos.") : null}
          emptyMessage="Nenhum arquivo"
          emptyHint={podeEditar ? "Adicione o primeiro pelo botão Adicionar, à direita do título." : "Nenhum arquivo foi adicionado nesta tela."}
          columns={COLUNAS.map((c) => c.rotulo)}
          renderRow={(a) => (
            <tr key={a.id} className="border-b border-gray-100 align-top text-sm">
              <td className="px-4 py-2">
                <div className="text-gray-900 [overflow-wrap:anywhere]">{a.descricao}</div>
                <div className="text-xs text-gray-500 [overflow-wrap:anywhere]">{a.nomeOriginal}</div>
              </td>
              <td className="px-4 py-2">{a.processoNome}</td>
              <td className="px-4 py-2 whitespace-nowrap">{extensao(a.nomeOriginal) || "—"}</td>
              <td className="px-4 py-2 text-right whitespace-nowrap">{tamanhoLegivel(a.tamanho)}</td>
              <td className="px-4 py-2">{a.enviadoPorNome ?? "—"}</td>
              <td className="px-4 py-2 whitespace-nowrap">{dataHora(a.enviadoEm)}</td>
              <td className="px-4 py-2">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button type="button" size="icon" variant="outline" className="size-7 rounded-sm" aria-label={`Ações do arquivo ${a.descricao}`} title="Ações">
                        <EllipsisVertical className="size-4" />
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end" className="w-auto min-w-40">
                    <DropdownMenuItem disabled={!a.visualizavel} onClick={() => visualizar(a)} title={a.visualizavel ? undefined : "O navegador não abre este tipo de arquivo: use Baixar"}>
                      <Eye />
                      Visualizar
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => baixar(a)}>
                      <Download />
                      Baixar
                    </DropdownMenuItem>
                    {podeEditar ? (
                      <>
                        <DropdownMenuItem onClick={() => setEditando(a)}>
                          <Pencil />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => setExcluindo(a)}>
                          <Trash2 />
                          Excluir
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </td>
            </tr>
          )}
        />
      </QuadroTabela>
      {adicionando ? (
        <AdicionarArquivoDialog
          tela={tela}
          nomeDaTela={nome}
          processos={processos}
          onFechar={() => setAdicionando(false)}
          onAdicionado={() => {
            setAdicionando(false);
            void queryClient.invalidateQueries({ queryKey: chave });
          }}
        />
      ) : null}
      {editando ? (
        <EditarArquivoDialog
          tela={tela}
          arquivo={editando}
          processos={processos}
          onFechar={() => setEditando(null)}
          onEditado={() => {
            setEditando(null);
            void queryClient.invalidateQueries({ queryKey: chave });
          }}
        />
      ) : null}
      {excluindo ? (
        <ConfirmacaoDialog
          titulo="Excluir Arquivo"
          descricao={`O arquivo sai de ${nome} e é apagado do SIG. Não é possível desfazer.`}
          pendente={excluir.isPending}
          onConfirmar={() => excluir.mutate(excluindo)}
          onFechar={() => setExcluindo(null)}
        >
          <p className="rounded-sm border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 [overflow-wrap:anywhere]">
            {excluindo.descricao}
            <span className="block text-xs text-gray-500">
              {excluindo.nomeOriginal} · {tamanhoLegivel(excluindo.tamanho)}
            </span>
          </p>
        </ConfirmacaoDialog>
      ) : null}
    </div>
  );
}
