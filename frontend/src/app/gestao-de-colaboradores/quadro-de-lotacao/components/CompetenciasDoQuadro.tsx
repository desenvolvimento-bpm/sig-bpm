"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EllipsisVertical, Lock, LockOpen, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { CabecalhoDaTela } from "@/components/shared/CabecalhoDaTela";
import { ConfirmacaoDialog } from "@/components/shared/ConfirmacaoDialog";
import { DataTable } from "@/components/shared/DataTable";
import { ExportarTabela } from "@/components/shared/ExportarTabela";
import { QuadroTabela } from "@/components/shared/QuadroTabela";
import { useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import { usePermissions } from "@/context/PermissionContext";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";
import type { Coluna } from "@/lib/filtrosDeTabela";
import { plural } from "@/lib/texto";
import { botaoPrimario } from "@/app/cenarios/components/CenarioDialog";
import { mensagemDeErro } from "@/app/cadastros/services/edicaoService";
import { StatusCompetenciaBadge } from "@/app/competencias/components/StatusCompetenciaBadge";
import { dataHora } from "@/app/competencias/[anoMes]/utils/formatacao";

import { quadroService, type CompetenciaDoQuadro } from "../../services/quadroService";

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const classeSelect = "h-9 rounded-sm border border-gray-300 bg-white px-3 text-sm";
const rotulo = (c: { ano: number; mes: number }) => `${String(c.mes).padStart(2, "0")}/${c.ano}`;
const anoMes = (c: { ano: number; mes: number }) => `${c.ano}-${String(c.mes).padStart(2, "0")}`;
const instante = (iso: string | null) => (iso ? new Date(iso).getTime() : null);

const COLUNAS: Coluna<CompetenciaDoQuadro>[] = [
  { chave: "competencia", rotulo: "Competência", tipo: "data", valor: (c) => c.ano * 12 + c.mes, texto: rotulo },
  { chave: "estado", rotulo: "Estado", valor: (c) => (c.status === "ABERTA" ? "Aberta" : "Fechada") },
  { chave: "inicial", rotulo: "Quadro Inicial", tipo: "numero", alinhamento: "direita", valor: (c) => c.quadroInicial },
  { chave: "movimentacoes", rotulo: "Movimentações", tipo: "numero", alinhamento: "direita", valor: (c) => c.movimentacoes },
  { chave: "pendentes", rotulo: "Pendentes", tipo: "numero", alinhamento: "direita", valor: (c) => c.pendentes },
  { chave: "final", rotulo: "Quadro Final", tipo: "numero", alinhamento: "direita", valor: (c) => c.quadroFinal },
  { chave: "abertaEm", rotulo: "Aberta em", tipo: "data", valor: (c) => instante(c.abertaEm), texto: (c) => dataHora(c.abertaEm) },
  { chave: "fechadaEm", rotulo: "Fechada em", tipo: "data", valor: (c) => instante(c.fechadaEm), texto: (c) => (c.fechadaEm ? dataHora(c.fechadaEm) : null) },
];
const ACOES: Coluna<CompetenciaDoQuadro> = { chave: "acoes", rotulo: "Ações", semFiltro: true, classe: "w-20" };

/** O mês sugerido para abrir: o seguinte ao mais recente; sem nenhum, o do Lançamento Inicial, ou o atual. */
function sugestao(itens: CompetenciaDoQuadro[], lancamentoInicial: string | null) {
  const maisRecente = itens[0];
  if (maisRecente) return maisRecente.mes === 12 ? { ano: maisRecente.ano + 1, mes: 1 } : { ano: maisRecente.ano, mes: maisRecente.mes + 1 };
  if (lancamentoInicial) {
    const [m, a] = lancamentoInicial.split("/").map(Number);
    return { ano: a, mes: m };
  }
  const hoje = new Date();
  return { ano: hoje.getFullYear(), mes: hoje.getMonth() + 1 };
}

/**
 * As competências do Quadro de Lotação (06/11/2026, etapa 2): as próprias, abertas e fechadas aqui (fora do Fechamento
 * Mensal). Desde 12/11/2026 (pedido do Adão, como no Fechamento Mensal), o início da Gestão de Colaboradores
 * (/gestao-de-colaboradores): clicar numa linha abre o Quadro de Lotação da competência, nas abas Movimentações, Controle e
 * Realizado.
 */
export function CompetenciasDoQuadro() {
  useRegistrarAcessoTela("/gestao-de-colaboradores");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const pode = hasPermission("colaboradores_quadro:editar");
  const lista = useQuery({ queryKey: ["quadro", "competencias"], queryFn: quadroService.competencias });
  const itens = lista.data?.itens;
  const tabela = useTabelaFiltravel(itens, pode ? [...COLUNAS, ACOES] : COLUNAS, { porPaginaInicial: 25 });
  const [abrindo, setAbrindo] = useState<{ ano: number; mes: number } | null>(null);
  const [confirmando, setConfirmando] = useState<{ c: CompetenciaDoQuadro; acao: "fechar" | "reabrir" | "excluir" } | null>(null);

  // A primeira aba que o perfil alcança.
  const abaInicial = ["movimentacoes", "controle", "realizado"].find((a) => hasPermission(`colaboradores_quadro.${a}:ler`));
  const entrar = (c: CompetenciaDoQuadro) => (abaInicial ? router.push(`/gestao-de-colaboradores/quadro-de-lotacao/${anoMes(c)}/${abaInicial}`) : undefined);

  const depois = () => void queryClient.invalidateQueries({ queryKey: ["quadro"] });
  const abrir = useMutation({
    mutationFn: (c: { ano: number; mes: number }) => quadroService.abrir(c.ano, c.mes),
    onSuccess: (c) => {
      toast.success(`Competência ${rotulo(c)} aberta.`);
      setAbrindo(null);
      depois();
      if (abaInicial) router.push(`/gestao-de-colaboradores/quadro-de-lotacao/${anoMes(c)}/${abaInicial}`);
    },
  });
  const mudar = useMutation({
    mutationFn: ({ c, acao }: { c: CompetenciaDoQuadro; acao: "fechar" | "reabrir" | "excluir" }) =>
      acao === "fechar" ? quadroService.fechar(anoMes(c)) : acao === "reabrir" ? quadroService.reabrir(anoMes(c)) : quadroService.excluir(anoMes(c)),
    onSuccess: (_r, { c, acao }) => {
      toast.success(`Competência ${rotulo(c)} ${acao === "fechar" ? "fechada" : acao === "reabrir" ? "reaberta" : "excluída"}.`);
      setConfirmando(null);
      depois();
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível gravar.")),
  });

  const anos = (() => {
    const atual = new Date().getFullYear();
    return [...new Set([atual - 1, atual, atual + 1, abrindo?.ano ?? atual])].sort();
  })();

  return (
    <div className="space-y-4">
      <CabecalhoDaTela
        titulo="Gestão de Colaboradores"
        sobre={
          <p>
            As competências do Quadro de Lotação, próprias deste processo: abertas e fechadas aqui, sem ligação com o Fechamento Mensal. Cada competência
            guarda as movimentações do mês (admissões, desligamentos, aberturas de vaga…); o quadro do início do mês é o Lançamento Inicial (no mês dele) ou o
            quadro do fim da competência anterior, e o do fim soma as movimentações aprovadas de contagem Positiva e subtrai as de Negativa.
          </p>
        }
        comoUsar={
          <ul>
            <li>Use Abrir Competência, à direita do título, para abrir um mês; o modal sugere o seguinte ao mais recente.</li>
            <li>
              Clique numa linha para abrir o Quadro de Lotação da competência, com as abas Movimentações, Controle e Realizado. Na barra do topo, “Gestão de
              Colaboradores” volta a esta lista, e “Quadro de Lotação” abre a última competência aberta (ou a mais recente); no caminho do topo, o nome do
              processo também volta aqui.
            </li>
            <li>
              No menu Ações, Fechar trava as movimentações do mês (só fecha sem movimentações pendentes), Reabrir as libera de novo e Excluir apaga a competência
              aberta por engano, sem movimentações.
            </li>
            <li>Quadro Inicial e Quadro Final são os colaboradores do início e do fim do mês; Pendentes, as movimentações à espera de aprovação no Controle.</li>
          </ul>
        }
        acoes={
          pode && itens ? (
            <Button type="button" className={botaoPrimario} onClick={() => (abrir.reset(), setAbrindo(sugestao(itens, lista.data?.lancamentoInicial ?? null)))}>
              <Plus className="size-4" />
              Abrir Competência
            </Button>
          ) : null
        }
        exportar={<ExportarTabela titulo="Quadro de Lotação · Competências" colunas={COLUNAS} linhas={tabela.filtradas} />}
      />
      <QuadroTabela>
        <DataTable<CompetenciaDoQuadro>
          data={tabela.visiveis}
          cabecalho={tabela.cabecalho}
          filtrosAtivos={tabela.ativos}
          onLimparFiltros={tabela.limpar}
          isLoading={lista.isPending}
          error={lista.isError ? "Erro ao carregar as competências." : null}
          emptyMessage="Nenhuma competência aberta"
          emptyHint={pode ? "Use Abrir Competência para abrir o primeiro mês." : undefined}
          columns={(pode ? [...COLUNAS, ACOES] : COLUNAS).map((c) => c.rotulo)}
          renderRow={(c) => (
            <tr key={c.id} onClick={() => entrar(c)} className="cursor-pointer border-b border-gray-100 hover:bg-gray-50">
              <td className="px-4 py-3 text-sm font-medium whitespace-nowrap text-gray-900">{rotulo(c)}</td>
              <td className="px-4 py-3">
                <StatusCompetenciaBadge status={c.status} />
              </td>
              <td className="px-4 py-3 text-right text-sm">{c.quadroInicial}</td>
              <td className="px-4 py-3 text-right text-sm">{c.movimentacoes}</td>
              <td className={`px-4 py-3 text-right text-sm ${c.pendentes ? "font-medium text-yellow-800" : "text-gray-400"}`}>{c.pendentes}</td>
              <td className="px-4 py-3 text-right text-sm font-medium">{c.quadroFinal}</td>
              <td className="px-4 py-3 text-sm whitespace-nowrap text-gray-600">{dataHora(c.abertaEm)}</td>
              <td className="px-4 py-3 text-sm whitespace-nowrap text-gray-600">{c.fechadaEm ? dataHora(c.fechadaEm) : ""}</td>
              {pode ? (
                <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button type="button" size="icon" variant="outline" className="size-7 rounded-sm" aria-label={`Ações de ${rotulo(c)}`} title="Ações">
                          <EllipsisVertical className="size-4" />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end" className="w-auto min-w-40">
                      {c.status === "ABERTA" ? (
                        <DropdownMenuItem
                          disabled={c.pendentes > 0}
                          title={c.pendentes ? `${c.pendentes} ${plural(c.pendentes, "movimentação pendente", "movimentações pendentes")}: aprove ou reprove no Controle antes de fechar.` : undefined}
                          onClick={() => setConfirmando({ c, acao: "fechar" })}
                        >
                          <Lock />
                          Fechar
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onClick={() => setConfirmando({ c, acao: "reabrir" })}>
                          <LockOpen />
                          Reabrir
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={c.movimentacoes > 0}
                        title={c.movimentacoes ? `A competência tem ${c.movimentacoes} ${plural(c.movimentacoes, "movimentação", "movimentações")}: exclua-as antes.` : undefined}
                        onClick={() => setConfirmando({ c, acao: "excluir" })}
                      >
                        <Trash2 />
                        Excluir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              ) : null}
            </tr>
          )}
        />
      </QuadroTabela>

      <Dialog open={abrindo !== null} onOpenChange={(o) => (!o ? setAbrindo(null) : undefined)}>
        <DialogContent className="rounded-sm sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Abrir Competência</DialogTitle>
            <DialogDescription>A competência do Quadro de Lotação nasce aberta: as movimentações do mês são registradas e aprovadas nela até ser fechada.</DialogDescription>
          </DialogHeader>
          {abrindo ? (
            // Os rótulos acima das listas (12/11/2026, pedido do Adão: antes, ao lado delas), como no Abrir Competência do Fechamento Mensal.
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <div className="grid gap-1.5">
                <Label htmlFor="quadro-mes">Mês</Label>
                <select id="quadro-mes" value={abrindo.mes} onChange={(e) => setAbrindo({ ...abrindo, mes: Number(e.target.value) })} className={`${classeSelect} w-48`}>
                  {MESES.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {String(i + 1).padStart(2, "0")} — {m}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="quadro-ano">Ano</Label>
                <select id="quadro-ano" value={abrindo.ano} onChange={(e) => setAbrindo({ ...abrindo, ano: Number(e.target.value) })} className={`${classeSelect} w-32`}>
                  {anos.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}
          {abrir.isError ? <p className="text-sm text-red-700">{mensagemDeErro(abrir.error, "Não foi possível abrir a competência.")}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-sm" onClick={() => setAbrindo(null)}>
              Cancelar
            </Button>
            <Button type="button" className={botaoPrimario} disabled={abrir.isPending} onClick={() => abrindo && abrir.mutate(abrindo)}>
              {abrir.isPending ? "Abrindo…" : "Abrir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmando ? (
        <ConfirmacaoDialog
          titulo={confirmando.acao === "fechar" ? "Fechar Competência" : confirmando.acao === "reabrir" ? "Reabrir Competência" : "Excluir Competência"}
          descricao={
            confirmando.acao === "fechar"
              ? "As movimentações do mês ficam travadas: não se registram, excluem nem aprovam até a competência ser reaberta."
              : confirmando.acao === "reabrir"
                ? "As movimentações do mês voltam a poder ser registradas, excluídas e aprovadas."
                : "A competência, sem movimentações, sai da lista. Não é possível desfazer."
          }
          acao={confirmando.acao === "fechar" ? "Fechar" : confirmando.acao === "reabrir" ? "Reabrir" : "Excluir"}
          acaoPendente={confirmando.acao === "fechar" ? "Fechando…" : confirmando.acao === "reabrir" ? "Reabrindo…" : "Excluindo…"}
          pendente={mudar.isPending}
          destrutiva={confirmando.acao !== "reabrir"}
          onConfirmar={() => mudar.mutate(confirmando)}
          onFechar={() => setConfirmando(null)}
        >
          <p className="rounded-sm border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900">Competência {rotulo(confirmando.c)}</p>
        </ConfirmacaoDialog>
      ) : null}
    </div>
  );
}
