"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Cog, EllipsisVertical, FileText, ListTree, MessageSquareText, PencilLine, X } from "lucide-react";
import { toast } from "sonner";

import { ExportarTabela } from "@/components/shared/ExportarTabela";
import { CabecalhoDaTela } from "@/components/shared/CabecalhoDaTela";
import { DataTable } from "@/components/shared/DataTable";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { QuadroTabela } from "@/components/shared/QuadroTabela";
import { useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { usePermissions } from "@/context/PermissionContext";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";
import type { Coluna } from "@/lib/filtrosDeTabela";
import { plural } from "@/lib/texto";

import { botaoPrimario } from "@/app/cenarios/components/CenarioDialog";
import { ItensDoMovimentoDialog } from "@/app/competencias/[anoMes]/dre/components/ItensDoMovimentoDialog";
import { moeda } from "@/app/competencias/[anoMes]/utils/formatacao";

import { contestacoesService, mensagemDeErro, quemResponde, ROTULO_SITUACAO, type Contestacao, type SituacaoContestacao } from "../services/contestacoesService";

export type AbaDasContestacoes = "solicitadas" | "recebidas" | "validacoes";

const dataCurta = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : null);
const dataHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : null);
const movimento = (c: { emissao: string | null; cliForn: string | null; historico: string | null }) => [dataCurta(c.emissao), c.cliForn, c.historico].filter(Boolean).join(" · ") || "—";
const de = (c: Contestacao) => [c.centroNovo ? c.centroAntes : null, c.contaNova ? c.contaAntes : null].filter(Boolean).join(" / ");
const para = (c: Contestacao) => [c.centroNovo, c.contaNova].filter(Boolean).join(" / ");
/** As competências da contestação: a do movimento ou, com as anteriores e posteriores, da primeira à última. */
export const periodo = (c: Contestacao) => (c.competencias.length > 1 ? `${c.competencias[0]} a ${c.competencias[c.competencias.length - 1]}` : c.competencia);
/** O período curto, no mesmo ano ("01 a 09/2026"). */
const periodoCurto = (c: Contestacao) => {
  const [p, u] = [c.competencias[0], c.competencias[c.competencias.length - 1]];
  return c.competencias.length > 1 && p.slice(3) === u.slice(3) ? `${p.slice(0, 2)} a ${u}` : periodo(c);
};
/** O valor e, com mais de um movimento, quantos ("R$ 1.200,00 em 6 movimentos"). */
const valorEMovimentos = (c: Contestacao) => `${moeda(c.valor)}${c.movimentos.length > 1 ? ` em ${c.movimentos.length} movimentos` : ""}`;
const anterioresEPosteriores = (c: Contestacao) =>
  [c.anteriores ? "anteriores" : null, c.posteriores ? "posteriores" : null].filter(Boolean).join(" e ");

const ESTILO_SITUACAO: Record<SituacaoContestacao, string> = {
  PENDENTE: "border-yellow-200 bg-yellow-50 text-yellow-800",
  ACATADA: "border-blue-200 bg-blue-50 text-blue-700",
  RECUSADA: "border-red-200 bg-red-50 text-red-700",
  VALIDADA: "border-green-200 bg-green-50 text-green-700",
};

/**
 * O detalhe da correção, pelos movimentos: no balancete, pelos lançamentos (e de que competência), os que esperam o Importar
 * — com mais de um movimento, quantos de cada.
 */
function detalheDaCorrecao(c: Contestacao, comParaLancamentos: boolean) {
  const n = c.movimentos.length;
  const { noBalancete, porLancamentos, paraLancamentos } = c.correcao;
  const quantos = (k: number) => (n > 1 ? ` (${k})` : "");
  const balancete = noBalancete ? `No balancete${quantos(noBalancete)}` : null;
  const lancamentos = porLancamentos ? `Lançamentos de ${c.lancadaEm ?? "—"}${quantos(porLancamentos)}` : null;
  if (c.situacao === "VALIDADA") return [balancete, lancamentos].filter(Boolean).join("; ") || "Sem correção pelo SIG";
  if (c.situacao !== "ACATADA") return null;
  const espera = comParaLancamentos && paraLancamentos ? `Para os Lançamentos${quantos(paraLancamentos)}` : null;
  return [balancete, lancamentos, espera].filter(Boolean).join("; ") || null;
}

/**
 * A situação, com o detalhe da validação (no balancete, pelos lançamentos ou fora do SIG); nas abas Solicitadas e
 * Recebidas, sem os movimentos que esperam o Importar (o que é da Controladoria).
 */
function Situacao({ c, comParaLancamentos = true }: { c: Contestacao; comParaLancamentos?: boolean }) {
  const detalhe = detalheDaCorrecao(c, comParaLancamentos);
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className={`inline-block w-fit rounded-sm border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${ESTILO_SITUACAO[c.situacao]}`}>{ROTULO_SITUACAO[c.situacao]}</span>
      {detalhe ? <span className="text-[11px] text-gray-500">{detalhe}</span> : null}
    </span>
  );
}

/**
 * As telas das Contestações de Gastos (27/10/2026, pedido do Adão): a aba Solicitadas (as do usuário), a Recebidas (as
 * dos centros de custo de que ele é o responsável, com Acatar e Recusar) e a tela Validações (todas, com Processar e
 * Alterar Status). A tabela tem os filtros nos rótulos das colunas, como as demais do SIG.
 */
export function ContestacoesContent({ aba }: { aba: AbaDasContestacoes }) {
  useRegistrarAcessoTela(`/contestacoes-de-gastos/${aba}`);
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const consulta = useQuery({ queryKey: ["contestacoes", aba], queryFn: () => contestacoesService.listar(aba) });
  const [acatando, setAcatando] = useState<Contestacao | null>(null);
  const [recusando, setRecusando] = useState<Contestacao | null>(null);
  const [alterando, setAlterando] = useState<Contestacao | null>(null);
  const [vendo, setVendo] = useState<Contestacao | null>(null);
  const [lendo, setLendo] = useState<{ c: Contestacao; o: "motivo" | "justificativa" } | null>(null);
  const [processando, setProcessando] = useState(false);
  // As abas Solicitadas e Recebidas (30/10/2026, pedido do Adão): a tabela enxuta, com o Motivo, a Justificativa, os
  // movimentos e a resposta no menu da coluna Ações.
  const enxuta = aba !== "validacoes";
  const podeResponder = (c: Contestacao) => aba === "recebidas" && c.situacao === "PENDENTE" && c.souResponsavel && hasPermission("contestacoes.recebidas:editar");
  const atualizar = () => queryClient.invalidateQueries({ queryKey: ["contestacoes"] });
  const responder = useMutation({
    mutationFn: (d: { id: string; acatar: boolean; justificativa: string | null }) => contestacoesService.responder(d.id, { acatar: d.acatar, justificativa: d.justificativa }),
    onSuccess: (c) => {
      toast.success(`Contestação nº ${c.numero} ${c.situacao === "ACATADA" ? "acatada" : "recusada"}.`);
      setAcatando(null);
      setRecusando(null);
      void atualizar();
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível responder a contestação.")),
  });

  const responsavel = (c: Contestacao) => (c.situacao === "PENDENTE" ? quemResponde(c) : c.respondidaPor);
  const colunas: Coluna<Contestacao>[] = enxuta
    ? (
        [
          { chave: "numero", rotulo: "Nº", tipo: "numero", valor: (c) => c.numero },
          { chave: "competencia", rotulo: "Competência", valor: (c) => c.competencias.join(", "), texto: periodo },
          { chave: "fornecedor", rotulo: "Fornecedor", valor: (c) => c.cliForn },
          { chave: "filial", rotulo: "Filial", tipo: "numero", valor: (c) => c.filial, texto: (c) => String(c.filial) },
          { chave: "valor", rotulo: "Valor", tipo: "numero", alinhamento: "direita", valor: (c) => Number(c.valor), texto: (c) => moeda(c.valor) },
          { chave: "de", rotulo: "De", valor: de },
          { chave: "para", rotulo: "Para", valor: para },
          // A mesma estrutura nas duas abas: o Solicitante (na Recebidas) no lugar do Responsável (na Solicitadas).
          aba === "recebidas" ? { chave: "solicitante", rotulo: "Solicitante", valor: (c: Contestacao) => c.solicitante } : { chave: "responsavel", rotulo: "Responsável", valor: responsavel },
          { chave: "situacao", rotulo: "Situação", valor: (c) => ROTULO_SITUACAO[c.situacao] },
          { chave: "acoes", rotulo: "Ações", semFiltro: true },
        ] as Coluna<Contestacao>[]
      ).map((c) => ({ ...c, classe: "px-2!" }))
    : [
        { chave: "numero", rotulo: "Nº", tipo: "numero", valor: (c) => c.numero },
        { chave: "competencia", rotulo: "Competência", valor: (c) => c.competencias.join(", "), texto: periodo },
        { chave: "movimento", rotulo: "Movimento", valor: movimento },
        { chave: "valor", rotulo: "Valor", tipo: "numero", alinhamento: "direita", valor: (c) => Number(c.valor), texto: (c) => moeda(c.valor) },
        { chave: "de", rotulo: "De", valor: de },
        { chave: "para", rotulo: "Para", valor: para },
        { chave: "solicitante", rotulo: "Solicitante", valor: (c) => c.solicitante },
        { chave: "motivo", rotulo: "Motivo", valor: (c) => c.motivo },
        { chave: "situacao", rotulo: "Situação", valor: (c) => ROTULO_SITUACAO[c.situacao] },
        { chave: "responsavel", rotulo: "Responsável", valor: responsavel },
        { chave: "justificativa", rotulo: "Justificativa", valor: (c) => c.justificativa },
        { chave: "acoes", rotulo: "Ações", semFiltro: true },
      ];
  const tabela = useTabelaFiltravel(consulta.data, colunas);
  const acatadas = (consulta.data ?? []).filter((c) => c.situacao === "ACATADA");
  const diretos = acatadas.reduce((s, c) => s + c.correcao.diretos, 0);
  const paraLancamentos = acatadas.reduce((s, c) => s + c.correcao.paraLancamentos, 0);

  const titulos: Record<AbaDasContestacoes, { titulo: string; sobre: string }> = {
    solicitadas: { titulo: "Contestações", sobre: "As contestações que você pediu, com a situação de cada uma." },
    recebidas: {
      titulo: "Contestações",
      sobre: "As contestações pedidas por outros usuários para os centros de custo do seu recorte (as suas ficam em Solicitadas): acate ou recuse as pendentes.",
    },
    validacoes: { titulo: "Validações", sobre: "Todas as contestações, de todos os usuários e de todas as competências: processe as acatadas e mude a situação de qualquer uma." },
  };

  return (
    <div className="space-y-6">
      <CabecalhoDaTela
        titulo={titulos[aba].titulo}
        exportar={<ExportarTabela titulo={`Contestações de Gastos · ${aba === "validacoes" ? "Validações" : aba === "solicitadas" ? "Solicitadas" : "Recebidas"}`} colunas={colunas} linhas={tabela.filtradas} />}
        sobre={<p>{titulos[aba].sobre}</p>}
        comoUsar={
          <ul>
            <li>
              Para contestar um movimento, abra o extrato de uma linha (a lupa) na tela Resultados do Fechamento Mensal ou nos Resultados Empresariais e
              clique na conta de um lançamento: no balancete da conta, “Contestar”, na coluna Ações, abre o modal para sugerir o novo centro de custo e/ou
              a nova conta de resultado (as listas buscam por código ou nome) e, se quiser, o motivo. Os centros são os de um departamento da DRE com o código de três níveis (como 1.01.00000001; sem os genéricos, como 1.01, e sem os sem código); as
              contas, as do departamento do centro (o novo; sem ele, o do movimento) e as do Extra-Operacional. A lupa ao lado de cada campo abre a lista inteira — os centros de custo (o departamento, a atribuição e o balde) e as Contas de Resultado (a linha e o grupo da DRE, o departamento, a atribuição e o balde) —, e clicar num item o escolhe. No canto de baixo do modal, “Regras de Rateio” mostra as regras vigentes no mês do movimento: como cada balde se divide entre as unidades.
            </li>
            <li>
              “Contestar Anteriores” e “Contestar Posteriores” levam junto os movimentos do mesmo fornecedor, na mesma conta e no mesmo centro de custo,
              nas competências anteriores e nas seguintes já importadas (sem os que já têm uma contestação em andamento); marcadas, o modal mostra o
              total que muda de centro e/ou de conta, competência por competência. A contestação é uma só: a coluna Competência mostra da primeira à
              última, o Valor é o total, e “Ver Movimentos”{enxuta ? ", no menu da coluna Ações," : ", na coluna Movimento,"} lista cada um (a emissão, o
              histórico e o valor), com a correção dele. Com o ID do movimento no RM (a coluna ID do Balancete (Lista)), o botão Itens abre os itens da
              requisição ou da nota fiscal dele (as abas Requisições (Lista) e Notas Fiscais (Lista) importadas)
              {enxuta ? "" : "; nesta tela, o Ver Movimentos também aparece na contestação de um movimento só, quando ele tem itens"}.
            </li>
            <li>
              A contestação vai para quem responde pelo centro de custo (o novo; sem centro novo, o do movimento): os usuários com Editar em Contestações
              › Recebidas, cada um no seu recorte (Controle de Usuários › Perfis) — com recorte por centro de custo, os centros da lista dele; por
              departamento, os centros dos departamentos dele; sem recorte (a Controladoria), todos. Qualquer um deles acata ou recusa, na aba
              Recebidas, que só traz as pedidas por outros usuários (as suas ficam em Solicitadas). Quem pede e responde pelo centro já tem a
              contestação acatada.
            </li>
            <li>
              As situações: Pendente (o responsável ainda não respondeu), Acatada (o responsável aceitou; espera a Controladoria), Recusada e Validada (a
              Controladoria corrigiu o movimento — no balancete, ou pelos lançamentos da aba Contestações dos Lançamentos).{" "}
              {enxuta
                ? "O motivo (de quem pediu) e a justificativa (da recusa ou da mudança de situação em Validações) ficam no menu da coluna Ações."
                : "O motivo e a justificativa (da recusa ou da mudança de situação) ficam nas colunas Motivo e Justificativa."}
            </li>
            {aba === "recebidas" ? (
              <li>
                No menu da coluna Ações, “Acatar” aceita a contestação pendente e “Recusar” a recusa (a justificativa é opcional), cada um depois da
                confirmação num modal (contra o clique acidental). Recusada, a contestação é cancelada, e o movimento contábil permanece como está. O
                menu fica destacado quando a contestação espera a sua resposta.
              </li>
            ) : null}
            {aba === "validacoes" ? (
              <>
                <li>
                  “Processar” corrige os movimentos das acatadas: com a competência do movimento aberta, no próprio balancete (a classificação aplica o
                  centro e a conta novos; a competência apurada pede reapuração); com ela fechada, o movimento fica para o Importar da aba Contestações
                  dos Lançamentos, para virar o estorno e o lançamento novo numa competência aberta (com rateio, divididos entre as unidades pelos
                  percentuais da competência do movimento). A contestação fica validada quando todos os movimentos dela estão corrigidos; o detalhe da
                  situação mostra onde estão.
                </li>
                <li>
                  Na coluna Ações, “Alterar Status” muda a situação de qualquer contestação, com a justificativa (obrigatória). Tirar uma validada (ou
                  uma acatada com movimentos já corrigidos) desfaz as correções (no balancete, na próxima apuração; os lançamentos manuais saem); pôr
                  como validada por aqui não corrige nada no SIG.
                </li>
              </>
            ) : null}
            <li>Use os filtros nos rótulos das colunas.</li>
          </ul>
        }
        acoes={
          aba === "validacoes" ? (
            <PermissionGuard permission="contestacoes_validacoes:editar">
              <Button type="button" className={botaoPrimario} disabled={!acatadas.length} onClick={() => setProcessando(true)} title={acatadas.length ? "Corrigir as contestações acatadas" : "Nenhuma contestação acatada"}>
                <Cog className="size-4" />
                Processar
              </Button>
            </PermissionGuard>
          ) : undefined
        }
      />
      <QuadroTabela>
        <DataTable<Contestacao>
          data={tabela.visiveis}
          cabecalho={tabela.cabecalho}
          filtrosAtivos={tabela.ativos}
          onLimparFiltros={tabela.limpar}
          isLoading={consulta.isPending}
          error={consulta.isError ? mensagemDeErro(consulta.error, "Erro ao carregar as contestações.") : null}
          emptyMessage="Nenhuma contestação"
          emptyHint={aba === "solicitadas" ? "Conteste um movimento no balancete de uma conta (o extrato das linhas, nos Resultados)." : "Nada por aqui."}
          columns={colunas.map((c) => c.rotulo)}
          renderRow={(c) =>
            enxuta ? (
              <LinhaEnxuta
                key={c.id}
                c={c}
                aba={aba}
                podeResponder={podeResponder(c)}
                respondendo={responder.isPending}
                onVerMovimentos={() => setVendo(c)}
                onLer={(o) => setLendo({ c, o })}
                onAcatar={() => setAcatando(c)}
                onRecusar={() => setRecusando(c)}
              />
            ) : (
            <tr key={c.id} className="border-b border-gray-100 align-top text-xs hover:bg-gray-50">
              <td className="px-3 py-2 font-medium">{c.numero}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                {periodo(c)}
                {c.competencias.length > 1 ? (
                  <div className="text-gray-500">
                    {c.competencias.length} {plural(c.competencias.length, "competência", "competências")}
                  </div>
                ) : null}
              </td>
              <td className="px-3 py-2">
                {movimento(c)}
                <div className="text-gray-500">
                  Filial {c.filial}
                  {c.contaBalancete ? ` · Conta do balancete ${c.contaBalancete}` : ""}
                  {!c.comItem ? " · fora do balancete reimportado" : ""}
                </div>
                {/* Com um movimento só, o Ver Movimentos também aparece quando ele tem itens (10/11/2026: o botão Itens). */}
                {c.movimentos.length > 1 || c.movimentos.some((m) => m.itens > 0) ? (
                  <div className="mt-1">
                    <button
                      type="button"
                      onClick={() => setVendo(c)}
                      className="inline-flex items-center gap-1 font-medium whitespace-nowrap text-gray-900 underline underline-offset-2"
                      title="Os movimentos da contestação, com a correção de cada um"
                    >
                      <ListTree className="size-3.5" />
                      Ver Movimentos ({c.movimentos.length})
                    </button>
                    {c.movimentos.length > 1 ? <div className="text-gray-500">com as {anterioresEPosteriores(c)}</div> : null}
                  </div>
                ) : null}
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                {moeda(c.valor)}
                {c.movimentos.length > 1 ? <div className="text-gray-500">o movimento: {moeda(c.valorDoMovimento)}</div> : null}
              </td>
              <td className="px-3 py-2">
                {c.centroNovo ? <div>{c.centroAntes ?? "—"}</div> : null}
                {c.contaNova ? <div>{c.contaAntes ?? "—"}</div> : null}
              </td>
              <td className="px-3 py-2 font-medium">
                {c.centroNovo ? <div>{c.centroNovo}</div> : null}
                {c.contaNova ? <div>{c.contaNova}</div> : null}
              </td>
              <td className="px-3 py-2">
                {c.solicitante}
                <div className="text-gray-500">{dataHora(c.solicitadaEm)}</div>
              </td>
              <td className="px-3 py-2 text-gray-700">{c.motivo ?? <span className="text-gray-400">—</span>}</td>
              <td className="px-3 py-2">
                <Situacao c={c} />
              </td>
              <td className="px-3 py-2">
                {c.situacao === "PENDENTE" ? (
                  <span className="text-gray-600">Aguarda {quemResponde(c)}</span>
                ) : c.respondidaPor ? (
                  <>
                    {c.respondidaPor}
                    <div className="text-gray-500">{dataHora(c.respondidaEm)}</div>
                  </>
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </td>
              <td className="px-3 py-2 text-gray-700">
                {c.justificativa ? (
                  <>
                    {c.justificativa}
                    <div className="text-gray-500">
                      {c.justificadaPor ?? "SIG"}
                      {c.justificadaEm ? `, ${dataHora(c.justificadaEm)}` : ""}
                    </div>
                  </>
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {hasPermission("contestacoes_validacoes:editar") ? (
                  <Button type="button" size="sm" variant="outline" className="h-7 rounded-sm px-2 text-xs" onClick={() => setAlterando(c)}>
                    <PencilLine className="size-3.5" />
                    Alterar Status
                  </Button>
                ) : null}
              </td>
            </tr>
            )
          }
        />
      </QuadroTabela>

      {vendo ? <MovimentosDialog c={vendo} aba={aba} onFechar={() => setVendo(null)} /> : null}
      {lendo ? <TextoDaContestacaoDialog c={lendo.c} o={lendo.o} onFechar={() => setLendo(null)} /> : null}
      {acatando ? <AcatarDialog c={acatando} pendente={responder.isPending} onFechar={() => setAcatando(null)} onAcatar={() => responder.mutate({ id: acatando.id, acatar: true, justificativa: null })} /> : null}
      {recusando ? <RecusarDialog c={recusando} pendente={responder.isPending} onFechar={() => setRecusando(null)} onRecusar={(j) => responder.mutate({ id: recusando.id, acatar: false, justificativa: j })} /> : null}
      {alterando ? (
        <AlterarStatusDialog
          c={alterando}
          onFechar={() => setAlterando(null)}
          onAlterada={() => {
            setAlterando(null);
            void atualizar();
          }}
        />
      ) : null}
      {processando ? (
        <ProcessarDialog
          acatadas={acatadas.length}
          diretos={diretos}
          paraLancamentos={paraLancamentos}
          onFechar={() => setProcessando(false)}
          onProcessado={() => {
            setProcessando(false);
            void atualizar();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * A linha das abas Solicitadas e Recebidas (30/10/2026, pedido do Adão): o fornecedor, a filial, o antes e o depois com
 * espaço (no máximo três quebras de linha por contestação), a situação e o menu Ações — o Motivo, a Justificativa, Ver
 * Movimentos e, na Recebidas, Acatar e Recusar.
 */
function LinhaEnxuta({
  c,
  aba,
  podeResponder,
  respondendo,
  onVerMovimentos,
  onLer,
  onAcatar,
  onRecusar,
}: {
  c: Contestacao;
  aba: AbaDasContestacoes;
  podeResponder: boolean;
  respondendo: boolean;
  onVerMovimentos: () => void;
  onLer: (o: "motivo" | "justificativa") => void;
  onAcatar: () => void;
  onRecusar: () => void;
}) {
  return (
    <tr className="border-b border-gray-100 align-top text-xs hover:bg-gray-50">
      <td className="px-2 py-2 font-medium">{c.numero}</td>
      <td className="px-2 py-2 whitespace-nowrap" title={c.competencias.join(", ")}>
        {periodoCurto(c)}
        {c.competencias.length > 1 ? (
          <div className="text-gray-500">
            {c.competencias.length} {plural(c.competencias.length, "competência", "competências")}
          </div>
        ) : null}
      </td>
      <td className="min-w-36 px-2 py-2">
        <div className="line-clamp-4" title={c.cliForn ?? undefined}>
          {c.cliForn ?? <span className="text-gray-400">—</span>}
        </div>
      </td>
      <td className="px-2 py-2">{c.filial}</td>
      <td className="px-2 py-2 text-right whitespace-nowrap" title={c.movimentos.length > 1 ? `Em ${c.movimentos.length} movimentos; o contestado: ${moeda(c.valorDoMovimento)}` : undefined}>
        {moeda(c.valor)}
      </td>
      {/* De e Para com a maior parte da largura: até quatro linhas — com o centro e a conta, duas para cada (o nome inteiro no título). */}
      <td className="min-w-52 px-2 py-2">
        {c.centroNovo ? <TextoEmLinhas texto={c.centroAntes ?? "—"} duas={!!c.contaNova} /> : null}
        {c.contaNova ? <TextoEmLinhas texto={c.contaAntes ?? "—"} duas={!!c.centroNovo} /> : null}
      </td>
      <td className="min-w-52 px-2 py-2 font-medium">
        {c.centroNovo ? <TextoEmLinhas texto={c.centroNovo} duas={!!c.contaNova} /> : null}
        {c.contaNova ? <TextoEmLinhas texto={c.contaNova} duas={!!c.centroNovo} /> : null}
      </td>
      {/* A mesma estrutura nas duas abas: na Recebidas, o Solicitante no lugar do Responsável, no mesmo formato. */}
      {aba === "recebidas" ? (
        <td className="px-2 py-2">
          <span className="whitespace-nowrap">{c.solicitante}</span>
          <div className="whitespace-nowrap text-gray-500">{dataHora(c.solicitadaEm)}</div>
        </td>
      ) : (
        <td className="px-2 py-2">
          {c.situacao === "PENDENTE" ? (
            <span className="line-clamp-4 text-gray-600" title={`Aguarda ${quemResponde(c)}`}>
              Aguarda {quemResponde(c)}
            </span>
          ) : c.respondidaPor ? (
            <>
              <span className="whitespace-nowrap">{c.respondidaPor}</span>
              <div className="whitespace-nowrap text-gray-500">{dataHora(c.respondidaEm)}</div>
            </>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </td>
      )}
      <td className="px-2 py-2">
        <Situacao c={c} comParaLancamentos={false} />
      </td>
      <td className="px-2 py-2 whitespace-nowrap">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                size="icon"
                variant="outline"
                className={`size-7 rounded-sm ${podeResponder ? "border-bpm-primary bg-bpm-primary hover:bg-bpm-primary-hover" : ""}`}
                aria-label={`Ações da contestação nº ${c.numero}`}
                title={podeResponder ? "Ações (a contestação espera a sua resposta: acate ou recuse)" : "Ações: Motivo, Justificativa e Ver Movimentos"}
              >
                <EllipsisVertical className="size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-auto min-w-44">
            <DropdownMenuItem disabled={!c.motivo} onClick={() => onLer("motivo")}>
              <MessageSquareText />
              Motivo
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!c.justificativa} onClick={() => onLer("justificativa")}>
              <FileText />
              Justificativa
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onVerMovimentos}>
              <ListTree />
              Ver Movimentos
            </DropdownMenuItem>
            {aba === "recebidas" ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={!podeResponder || respondendo} onClick={onAcatar}>
                  <Check />
                  Acatar
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" disabled={!podeResponder} onClick={onRecusar}>
                  <X />
                  Recusar
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

/** Um centro ou uma conta em até duas linhas (com o outro na célula) ou quatro, com o texto inteiro no título (o raro nome mais longo). */
function TextoEmLinhas({ texto, duas }: { texto: string; duas: boolean }) {
  return (
    <div className={duas ? "line-clamp-2" : "line-clamp-4"} title={texto}>
      {texto}
    </div>
  );
}

/** O Motivo (de quem pediu) ou a Justificativa (da recusa ou da mudança de situação) de uma contestação, num modal pequeno. */
function TextoDaContestacaoDialog({ c, o, onFechar }: { c: Contestacao; o: "motivo" | "justificativa"; onFechar: () => void }) {
  const motivo = o === "motivo";
  const autoria = motivo
    ? `${c.solicitante}, ${dataHora(c.solicitadaEm)}`
    : [c.justificadaPor ?? "SIG", dataHora(c.justificadaEm)].filter(Boolean).join(", ");
  return (
    <Dialog open onOpenChange={(x) => (!x ? onFechar() : undefined)}>
      <DialogContent className="rounded-sm sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {motivo ? "Motivo" : "Justificativa"} da Contestação nº {c.numero}
          </DialogTitle>
          <DialogDescription>
            {c.cliForn ?? "—"} · {valorEMovimentos(c)} · {ROTULO_SITUACAO[c.situacao]}
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-sm border border-gray-200 bg-gray-50 px-3 py-2 text-sm whitespace-pre-wrap text-gray-900">{(motivo ? c.motivo : c.justificativa) ?? "—"}</p>
        <p className="text-xs text-gray-500">{autoria}</p>
      </DialogContent>
    </Dialog>
  );
}

const ROTULO_CORRECAO = { NO_BALANCETE: "No balancete", LANCAMENTO_MANUAL: "Pelos lançamentos" } as const;

/**
 * Ver Movimentos: os movimentos da contestação (o contestado e os das anteriores e posteriores), com a correção de cada um e,
 * com o ID do movimento no RM (10/11/2026), o botão Itens: os itens da requisição ou da nota fiscal dele.
 */
function MovimentosDialog({ c, aba, onFechar }: { c: Contestacao; aba: AbaDasContestacoes; onFechar: () => void }) {
  const [vendoItens, setVendoItens] = useState<Contestacao["movimentos"][number] | null>(null);
  const comId = c.movimentos.some((m) => m.idMovimento);
  const correcao = (m: Contestacao["movimentos"][number]) =>
    m.formaValidacao
      ? m.formaValidacao === "LANCAMENTO_MANUAL" && c.lancadaEm
        ? `Lançamentos de ${c.lancadaEm}`
        : ROTULO_CORRECAO[m.formaValidacao]
      : c.situacao === "ACATADA"
        ? m.competenciaFechada || !m.comItem
          ? "Para os Lançamentos"
          : "Para o Processar"
        : "—";
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent className="flex max-h-[90vh] w-[min(64rem,calc(100%_-_2rem))] max-w-none flex-col overflow-hidden rounded-sm sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Movimentos da Contestação nº {c.numero}</DialogTitle>
          <DialogDescription>
            {c.cliForn ?? "—"} · {c.contaBalancete ?? "—"} · {c.centroAntes ?? "sem centro de custo"}:{" "}
            {c.movimentos.length > 1 ? `o movimento contestado e os das ${anterioresEPosteriores(c)}. Todos vão` : "o movimento contestado. Ele vai"} para{" "}
            {para(c) || "—"}.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto rounded-sm border border-gray-200">
          <table className="tabela-sig w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-600">
                <th className="px-3 py-1.5 font-medium">Competência</th>
                <th className="px-3 py-1.5 font-medium">Emissão</th>
                <th className="px-3 py-1.5 font-medium">Histórico</th>
                <th className="px-3 py-1.5 font-medium">Filial</th>
                {comId ? <th className="px-3 py-1.5 font-medium">ID</th> : null}
                <th className="px-3 py-1.5 text-right font-medium">Valor</th>
                <th className="px-3 py-1.5 font-medium">Correção</th>
                {comId ? <th className="px-3 py-1.5 font-medium">Ações</th> : null}
              </tr>
            </thead>
            <tbody>
              {c.movimentos.map((m) => (
                <tr key={m.id} className={`border-b border-gray-100 align-top ${m.principal ? "bg-yellow-50" : ""}`}>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    {m.competencia}
                    {m.principal ? <span className="ml-1 text-gray-500">(o contestado)</span> : null}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">{dataCurta(m.emissao) ?? "—"}</td>
                  <td className="px-3 py-1.5">
                    {m.historico ?? "—"}
                    {!m.comItem ? <div className="text-gray-500">fora do balancete reimportado</div> : null}
                  </td>
                  <td className="px-3 py-1.5">{m.filial}</td>
                  {comId ? (
                    <td className="px-3 py-1.5 whitespace-nowrap" title={m.idMovimento && !m.itens ? "Nenhum item com este ID nas requisições e nas notas fiscais importadas" : undefined}>
                      {m.idMovimento ?? <span className="text-gray-400">—</span>}
                    </td>
                  ) : null}
                  <td className="px-3 py-1.5 text-right whitespace-nowrap">{moeda(m.valor)}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap">{correcao(m)}</td>
                  {comId ? (
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      {m.idMovimento && m.itens > 0 ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 rounded-sm px-2 text-[11px]"
                          onClick={() => setVendoItens(m)}
                          title={`Os itens da requisição ou da nota fiscal do movimento (${m.itens} ${plural(m.itens, "item", "itens")})`}
                        >
                          <ListTree className="size-3.5" />
                          Itens
                        </Button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="shrink-0 text-right text-sm text-gray-700">
          {c.movimentos.length} {plural(c.movimentos.length, "movimento", "movimentos")} em {c.competencias.length}{" "}
          {plural(c.competencias.length, "competência", "competências")} · Total <span className="font-bold text-gray-900">{moeda(c.valor)}</span>
        </p>
        {vendoItens?.idMovimento ? (
          <ItensDoMovimentoDialog
            movimento={{ idMovimento: vendoItens.idMovimento, emissao: vendoItens.emissao, cliForn: vendoItens.cliForn, historico: vendoItens.historico, valor: vendoItens.valor, conta: c.contaBalanceteReduzido, centro: c.codigoCentroCusto }}
            queryKey={["contestacoes", aba, c.id, "itens", vendoItens.id]}
            carregar={() => contestacoesService.itensDoMovimento(aba, c.id, vendoItens.id)}
            onFechar={() => setVendoItens(null)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** O que a contestação muda, para a confirmação de Acatar e Recusar: o centro e/ou a conta de antes e os novos. */
function DeEPara({ c }: { c: Contestacao }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-sm border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
      <dt className="text-gray-500">Fornecedor</dt>
      <dd className="text-gray-900">
        {c.cliForn ?? "—"} · {valorEMovimentos(c)} · {periodo(c)}
      </dd>
      <dt className="text-gray-500">De</dt>
      <dd className="text-gray-900">{de(c) || "—"}</dd>
      <dt className="text-gray-500">Para</dt>
      <dd className="font-medium text-gray-900">{para(c) || "—"}</dd>
    </dl>
  );
}

/** Acatar (aba Recebidas): a confirmação, para evitar o clique acidental. */
function AcatarDialog({ c, pendente, onFechar, onAcatar }: { c: Contestacao; pendente: boolean; onFechar: () => void; onAcatar: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent className="rounded-sm sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Acatar a Contestação nº {c.numero}</DialogTitle>
          <DialogDescription>Confirme que a contestação procede. Acatada, ela vai para a Controladoria, que valida e corrige o movimento.</DialogDescription>
        </DialogHeader>
        <DeEPara c={c} />
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={pendente} onClick={onAcatar}>
            <Check className="size-4" />
            {pendente ? "Acatando…" : "Acatar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Recusar (aba Recebidas): a confirmação, com a justificativa (opcional), que aparece para quem pediu. */
function RecusarDialog({ c, pendente, onFechar, onRecusar }: { c: Contestacao; pendente: boolean; onFechar: () => void; onRecusar: (justificativa: string | null) => void }) {
  const [texto, setTexto] = useState("");
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="rounded-sm sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Recusar a Contestação nº {c.numero}</DialogTitle>
          <DialogDescription>
            Confirme a recusa. Recusada, a contestação é cancelada, e o movimento contábil permanece como está. A justificativa (opcional) aparece para quem
            pediu, nas Contestações e em Validações.
          </DialogDescription>
        </DialogHeader>
        <DeEPara c={c} />
        <div className="space-y-1.5">
          <Label htmlFor="rc-justificativa">Justificativa (opcional)</Label>
          <textarea id="rc-justificativa" value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={500} rows={3} className="w-full rounded-sm border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" variant="outline" className="rounded-sm border-red-300 text-red-700 hover:bg-red-50" disabled={pendente} onClick={() => onRecusar(texto.trim() || null)}>
            <X className="size-4" />
            {pendente ? "Recusando…" : "Recusar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Alterar Status (Validações): qualquer situação, com a justificativa obrigatória. */
function AlterarStatusDialog({ c, onFechar, onAlterada }: { c: Contestacao; onFechar: () => void; onAlterada: () => void }) {
  const [situacao, setSituacao] = useState<SituacaoContestacao>(c.situacao);
  const [texto, setTexto] = useState("");
  const salvar = useMutation({
    mutationFn: () => contestacoesService.alterarSituacao(c.id, { situacao, justificativa: texto.trim() }),
    onSuccess: (x) => {
      toast.success(`Contestação nº ${x.numero}: ${ROTULO_SITUACAO[x.situacao]}.`);
      onAlterada();
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível alterar a situação.")),
  });
  // Desfaz as correções: a validada (ou a acatada com movimentos corrigidos) que deixa de ser validada.
  const corrigidos = c.correcao.noBalancete + c.correcao.porLancamentos;
  const desfaz = situacao !== "VALIDADA" && corrigidos > 0;
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="rounded-sm sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Alterar Status da Contestação nº {c.numero}</DialogTitle>
          <DialogDescription>
            {movimento(c)} · {valorEMovimentos(c)} · hoje, {ROTULO_SITUACAO[c.situacao]}. A justificativa aparece nas Contestações e em Validações.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="as-situacao">Situação</Label>
            <select id="as-situacao" value={situacao} onChange={(e) => setSituacao(e.target.value as SituacaoContestacao)} className="h-9 w-full rounded-sm border border-gray-300 bg-white px-2 text-sm">
              {(Object.keys(ROTULO_SITUACAO) as SituacaoContestacao[]).map((s) => (
                <option key={s} value={s}>
                  {ROTULO_SITUACAO[s]}
                </option>
              ))}
            </select>
          </div>
          {desfaz ? (
            <p className="rounded-sm border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs text-yellow-900">
              {c.situacao === "VALIDADA" ? "A contestação deixa de ser validada" : "A contestação volta"}: a correção{" "}
              {plural(corrigidos, "do movimento corrigido sai", `dos ${corrigidos} movimentos corrigidos sai`)}
              {[
                c.correcao.noBalancete ? " do balancete na próxima apuração" : null,
                c.correcao.porLancamentos ? ` (os lançamentos de ${c.lancadaEm ?? "—"} são excluídos)` : null,
              ]
                .filter(Boolean)
                .join(" e")}
              .
            </p>
          ) : null}
          {situacao === "VALIDADA" && c.situacao !== "VALIDADA" ? (
            <p className="rounded-sm border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs text-yellow-900">
              Validada por aqui, a contestação não corrige nada no SIG (é a correção feita fora dele). Para corrigir o movimento, use “Processar”.
            </p>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="as-justificativa">Justificativa</Label>
            <textarea id="as-justificativa" value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={500} rows={3} className="w-full rounded-sm border border-gray-300 px-3 py-2 text-sm" />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={!texto.trim() || situacao === c.situacao || salvar.isPending} onClick={() => salvar.mutate()}>
            {salvar.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Processar (Validações): a confirmação, com quantos movimentos vão ao balancete e quantos aos lançamentos. */
function ProcessarDialog({
  acatadas,
  diretos,
  paraLancamentos,
  onFechar,
  onProcessado,
}: {
  acatadas: number;
  diretos: number;
  paraLancamentos: number;
  onFechar: () => void;
  onProcessado: () => void;
}) {
  const processar = useMutation({
    mutationFn: contestacoesService.processar,
    onSuccess: (r) => {
      const partes = [
        `${r.movimentos} ${plural(r.movimentos, "movimento corrigido", "movimentos corrigidos")} no balancete`,
        `${r.validadas} ${plural(r.validadas, "contestação validada", "contestações validadas")}`,
        r.paraLancamentos ? `${r.paraLancamentos} ${plural(r.paraLancamentos, "espera", "esperam")} o Importar dos Lançamentos` : null,
        r.reapurar.length ? `reapure ${r.reapurar.join(", ")}` : null,
      ].filter(Boolean);
      toast.success(`${partes.join("; ")}.`);
      onProcessado();
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível processar as contestações.")),
  });
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent className="rounded-sm sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Processar as Contestações Acatadas</DialogTitle>
          <DialogDescription>
            {acatadas} {plural(acatadas, "contestação acatada", "contestações acatadas")}: {diretos}{" "}
            {plural(diretos, "movimento com a competência aberta fica corrigido", "movimentos com a competência aberta ficam corrigidos")} no balancete (a
            classificação aplica o centro e a conta novos; a competência apurada pede reapuração), e {paraLancamentos}{" "}
            {plural(paraLancamentos, "movimento com a competência fechada fica", "movimentos com a competência fechada ficam")} para o Importar da aba
            Contestações dos Lançamentos de uma competência aberta. A contestação com todos os movimentos corrigidos fica validada.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={processar.isPending} onClick={() => processar.mutate()}>
            {processar.isPending ? "Processando…" : "Processar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
