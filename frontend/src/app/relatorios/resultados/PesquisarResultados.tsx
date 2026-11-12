"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ListTree, MessageSquareWarning, Search } from "lucide-react";

import { BuscaNaLista, type OpcaoDaBusca } from "@/components/shared/BuscaNaLista";
import { IconeDaCorrecao } from "@/components/shared/IconeDaCorrecao";
import { SemResultado, useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { usePermissions } from "@/context/PermissionContext";
import type { Coluna } from "@/lib/filtrosDeTabela";
import { plural } from "@/lib/texto";

import { ContestarDialog } from "@/app/contestacoes-de-gastos/components/ContestarDialog";
import { ROTULO_SITUACAO } from "@/app/contestacoes-de-gastos/services/contestacoesService";
import { ItensDoMovimentoDialog, type ItensSelecionados } from "@/app/competencias/[anoMes]/dre/components/ItensDoMovimentoDialog";
import { dreService } from "@/app/competencias/[anoMes]/dre/services/dreService";
import { moeda } from "@/app/competencias/[anoMes]/utils/formatacao";

import { mensagemDeErro, relatoriosService, type OcorrenciaDaPesquisa, type TipoDaPesquisa } from "../services/relatoriosService";

const TIPOS: Array<{ valor: TipoDaPesquisa; rotulo: string }> = [
  { valor: "fornecedor", rotulo: "Fornecedor ou Cliente" },
  { valor: "conta", rotulo: "Conta de Resultado" },
];
const classeSelect = "h-9 rounded-sm border border-gray-300 bg-white px-2 text-sm";
const mesDe = (anoMes: string) => `${anoMes.slice(5, 7)}/${anoMes.slice(0, 4)}`;
const dataCurta = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : null);
const centroTexto = (o: OcorrenciaDaPesquisa) => (o.codigoCentroCusto ? `${o.codigoCentroCusto}${o.nomeCentroCusto ? ` · ${o.nomeCentroCusto}` : ""}` : null);
const contaTexto = (c: { reduzido: string; descricao: string }) => `${c.reduzido} · ${c.descricao}`;
/** A atribuição do lançamento (a da conta na DRE: Matérias Primas, Mão de Obra Direta…), como está gravada. */
const atribuicaoTexto = (a: string | null) => a;

/**
 * O Pesquisar de Resultados Empresariais (11/11/2026, pedido do Adão), antes do Exportar: os movimentos do balancete de um
 * fornecedor ou cliente (pelo nome, em parte) ou de uma conta de resultado (a que vale na DRE), nas competências fechadas
 * do exercício até o mês escolhido, no recorte do usuário. Cada ocorrência traz o centro de custo, a atribuição, a conta do
 * DRE (a linha), a conta de resultado (na pesquisa por fornecedor) ou o fornecedor ou cliente (na pesquisa por conta) e o
 * valor; a coluna Ações, como no Balancete, tem os Itens do movimento e o Contestar (de quem edita Contestações › Solicitadas).
 */
export function PesquisarResultados({ ano, ate }: { ano: number; ate: number }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" className="rounded-sm" onClick={() => setAberto(true)}>
        <Search className="size-4" />
        Pesquisar
      </Button>
      {aberto ? <PesquisarDialog ano={ano} ate={ate} onFechar={() => setAberto(false)} /> : null}
    </>
  );
}

function PesquisarDialog({ ano, ate, onFechar }: { ano: number; ate: number; onFechar: () => void }) {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const podeContestar = hasPermission("contestacoes.solicitadas:editar");
  const [tipo, setTipo] = useState<TipoDaPesquisa>("fornecedor");
  const [texto, setTexto] = useState("");
  const [conta, setConta] = useState<OpcaoDaBusca | null>(null);
  const [pedido, setPedido] = useState<{ tipo: TipoDaPesquisa; termo: string } | null>(null);
  const [contestando, setContestando] = useState<OcorrenciaDaPesquisa | null>(null);
  const [vendoItens, setVendoItens] = useState<OcorrenciaDaPesquisa | null>(null);

  const contas = useQuery({ queryKey: ["relatorios", "pesquisa", "contas"], queryFn: relatoriosService.contasDaPesquisa, enabled: tipo === "conta", staleTime: 5 * 60_000 });
  const opcoesDeContas = useMemo<OpcaoDaBusca[]>(() => (contas.data ?? []).map((c) => ({ id: c.reduzido, codigo: c.reduzido, nome: c.descricao })), [contas.data]);
  const consulta = useQuery({
    queryKey: ["relatorios", "pesquisa", ano, ate, pedido],
    queryFn: () => relatoriosService.pesquisar(ano, ate, pedido!.tipo, pedido!.termo),
    enabled: pedido !== null,
  });
  const d = consulta.data;
  const porConta = d?.tipo === "conta";

  const termo = tipo === "conta" ? (conta?.codigo ?? "") : texto.trim();
  const pronto = tipo === "conta" ? !!conta : termo.length >= 3;
  const pesquisar = () => {
    if (pronto) setPedido({ tipo, termo });
  };

  const colunas = useMemo<Coluna<OcorrenciaDaPesquisa>[]>(
    () => [
      { chave: "mes", rotulo: "Mês", valor: (x) => x.anoMes, texto: (x) => mesDe(x.anoMes) },
      { chave: "centro", rotulo: "Centro de Custo", valor: centroTexto },
      { chave: "atribuicao", rotulo: "Atribuição", valor: (x) => atribuicaoTexto(x.atribuicao) },
      { chave: "linha", rotulo: "Conta do DRE", valor: (x) => x.linha.rotulo },
      porConta
        ? { chave: "cliForn", rotulo: "Fornecedor/Cliente", valor: (x: OcorrenciaDaPesquisa) => x.cliForn }
        : { chave: "conta", rotulo: "Conta de Resultado", valor: (x: OcorrenciaDaPesquisa) => contaTexto(x.contaNaDRE) },
      { chave: "valor", rotulo: "Valor", tipo: "numero", alinhamento: "direita", valor: (x) => Number(x.valor), texto: (x) => moeda(x.valor) },
      { chave: "acoes", rotulo: "Ações", semFiltro: true },
    ],
    [porConta],
  );
  const tabela = useTabelaFiltravel(d?.ocorrencias, colunas);

  /** O movimento para o Contestar: o centro e a conta que valem hoje. */
  const movimentoContestado = (o: OcorrenciaDaPesquisa) => ({
    id: o.id,
    filial: o.filial,
    emissao: o.emissao,
    cliForn: o.cliForn,
    historico: o.historico,
    valor: o.valor,
    centro: centroTexto(o),
    conta: contaTexto(o.contaNaDRE),
  });
  /** O recorte do Balancete do movimento (os itens se leem por ele, com a conferência do acesso). */
  const filtroDo = (o: OcorrenciaDaPesquisa) => ({
    linha: o.linha.codigo,
    conta: o.contaDoBalancete.reduzido,
    centro: o.codigoCentroCusto,
    filial: o.filial,
    ...(o.adotada ? { adotada: o.adotada } : {}),
  });
  const aoContestar = () => {
    void queryClient.invalidateQueries({ queryKey: ["relatorios", "pesquisa"] });
    void queryClient.invalidateQueries({ queryKey: ["contestacoes"] });
    void queryClient.invalidateQueries({ queryKey: ["dre"] });
  };
  /** Por que os itens não se contestam (nulo se se contestam): o movimento inteiro em contestação. */
  const bloqueioDosItens = (o: OcorrenciaDaPesquisa) => {
    const andamento = o.contestacao && !o.contestacao.deItens && (o.contestacao.situacao === "PENDENTE" || o.contestacao.situacao === "ACATADA");
    return andamento ? `O movimento inteiro está na contestação nº ${o.contestacao!.numero} (${ROTULO_SITUACAO[o.contestacao!.situacao].toLowerCase()}).` : null;
  };

  /** A coluna Ações, na parte da contestação: a situação da em andamento, os itens contestados ou o Contestar. */
  const acaoDaContestacao = (o: OcorrenciaDaPesquisa) => {
    const andamento = o.contestacao && (o.contestacao.situacao === "PENDENTE" || o.contestacao.situacao === "ACATADA");
    if (andamento) {
      return (
        <span className="inline-flex items-center gap-1 rounded-sm border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-amber-900" title="A contestação em andamento (Contestações de Gastos)">
          Nº {o.contestacao!.numero} · {o.contestacao!.deItens ? "Itens · " : ""}
          {ROTULO_SITUACAO[o.contestacao!.situacao]}
        </span>
      );
    }
    if (o.contestacao?.comItensContestados) {
      return (
        <span className="inline-flex items-center gap-1 rounded-sm border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-gray-700" title="O movimento tem itens contestados: conteste os demais itens pelo botão Itens">
          Itens Contestados
        </span>
      );
    }
    return podeContestar ? (
      <Button type="button" variant="outline" size="sm" className="h-6 rounded-sm px-2 text-[11px]" onClick={() => setContestando(o)} title="Sugerir outro centro de custo e/ou outra conta para o movimento">
        <MessageSquareWarning className="size-3.5" />
        Contestar
      </Button>
    ) : null;
  };

  const celula = (c: Coluna<OcorrenciaDaPesquisa>, o: OcorrenciaDaPesquisa) => {
    if (c.chave === "centro") {
      const t = centroTexto(o);
      if (!t) return <span className="text-gray-400">—</span>;
      return (
        <span>
          {t}
          {o.centroOriginal ? (
            <IconeDaCorrecao
              campo="centro"
              original={`${o.centroOriginal.codigoRM ?? "sem código"}${o.centroOriginal.nome ? ` · ${o.centroOriginal.nome}` : ""}`}
              atual={t}
              origem={o.contestacaoAplicada ? { tipo: "contestacao", numero: o.contestacaoAplicada.numero } : { tipo: "reclassificacao" }}
            />
          ) : null}
        </span>
      );
    }
    if (c.chave === "conta") {
      const atual = contaTexto(o.contaNaDRE);
      return (
        <span>
          {atual}
          {o.contaNaDRE.reduzido !== o.contaDoBalancete.reduzido ? (
            <IconeDaCorrecao
              campo="conta"
              original={contaTexto(o.contaDoBalancete)}
              atual={atual}
              origem={o.contestacaoAplicada?.conta ? { tipo: "contestacao", numero: o.contestacaoAplicada.numero } : { tipo: "reclassificacao" }}
            />
          ) : null}
        </span>
      );
    }
    if (c.chave === "acoes") {
      return (
        <span className="inline-flex items-center gap-1">
          {o.idMovimento && o.itens > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 rounded-sm px-2 text-[11px]"
              onClick={() => setVendoItens(o)}
              title={`Os itens da requisição ou da nota fiscal do movimento (${o.itens} ${plural(o.itens, "item", "itens")})`}
            >
              <ListTree className="size-3.5" />
              Itens
            </Button>
          ) : null}
          {acaoDaContestacao(o)}
        </span>
      );
    }
    return (c.texto ? c.texto(o) : c.valor?.(o)) ?? <span className="text-gray-400">—</span>;
  };

  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent className="flex max-h-[90vh] w-[min(84rem,calc(100%_-_2rem))] max-w-none flex-col overflow-hidden rounded-sm sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Pesquisar nos Resultados Empresariais</DialogTitle>
          <DialogDescription>
            Os movimentos do balancete de {ate > 1 ? `01/${ano} a ${String(ate).padStart(2, "0")}/${ano}` : `01/${ano}`} (as competências fechadas do exercício até o
            mês escolhido) de um fornecedor ou cliente ou de uma conta de resultado — só os que o seu perfil vê.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex shrink-0 flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            pesquisar();
          }}
        >
          <select aria-label="Pesquisar por" value={tipo} onChange={(e) => setTipo(e.target.value as TipoDaPesquisa)} className={classeSelect}>
            {TIPOS.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.rotulo}
              </option>
            ))}
          </select>
          <div className="min-w-60 flex-1">
            {tipo === "conta" ? (
              <BuscaNaLista id="pesquisa-conta" opcoes={opcoesDeContas} valor={conta} onEscolher={setConta} placeholder={contas.isLoading ? "Carregando as contas…" : "Busque a conta pelo código ou pelo nome…"} />
            ) : (
              <Input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Nome do fornecedor ou cliente (ao menos três letras)…" className="h-9 rounded-sm" aria-label="Fornecedor ou cliente" />
            )}
          </div>
          <Button type="submit" disabled={!pronto || consulta.isFetching} className="bg-bpm-primary hover:bg-bpm-primary-hover rounded-sm font-bold text-black shadow-sm">
            <Search className="size-4" />
            {consulta.isFetching ? "Pesquisando…" : "Pesquisar"}
          </Button>
        </form>

        {!pedido ? (
          <p className="rounded-sm border border-gray-200 bg-white p-4 text-sm text-gray-600">
            Escolha o tipo, digite o fornecedor ou cliente (ou escolha a conta) e clique em Pesquisar.
          </p>
        ) : consulta.isError ? (
          <p className="text-sm text-red-700">{mensagemDeErro(consulta.error, "Erro ao pesquisar.")}</p>
        ) : !d ? (
          <div className="h-40 animate-pulse rounded-sm bg-gray-100" />
        ) : d.ocorrencias.length === 0 ? (
          <p className="rounded-sm border border-gray-200 bg-white p-4 text-sm text-gray-600">
            Nenhum movimento {d.conta ? `da conta ${contaTexto(d.conta)}` : `com “${d.termo}” no fornecedor ou cliente`} no período.
          </p>
        ) : (
          <>
            <p className="shrink-0 text-sm text-gray-700">
              {d.conta ? <>Conta {contaTexto(d.conta)} · </> : null}
              {d.total.toLocaleString("pt-BR")} {plural(d.total, "ocorrência", "ocorrências")}
              {d.total > d.limite ? ` (as ${d.limite.toLocaleString("pt-BR")} primeiras na tabela: refine a pesquisa)` : ""} · Soma <span className="font-bold text-gray-900">{moeda(d.soma)}</span>
            </p>
            <div className="min-h-0 flex-1 overflow-auto rounded-sm border border-gray-200 [--topo-tabela:0px]">
              <table className="tabela-sig w-full border-collapse text-xs">
                {tabela.cabecalho}
                <tbody>
                  {tabela.visiveis.length === 0 ? (
                    <SemResultado colunas={colunas.length} onLimpar={tabela.limpar} />
                  ) : (
                    tabela.visiveis.map((o) => (
                      <tr
                        key={o.id}
                        className="border-b border-gray-100 align-top"
                        title={[dataCurta(o.emissao) ? `Emissão ${dataCurta(o.emissao)}` : null, `Filial ${o.filial}`, porConta ? null : o.cliForn, o.historico].filter(Boolean).join(" · ")}
                      >
                        {colunas.map((c) => (
                          <td key={c.chave} className={`px-3 py-1.5 ${c.alinhamento === "direita" || c.chave === "mes" || c.chave === "acoes" ? "whitespace-nowrap" : ""} ${c.alinhamento === "direita" ? "text-right" : ""}`}>
                            {celula(c, o)}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              {tabela.total !== tabela.totalGeral ? (
                <p className="px-3 py-1.5 text-right text-xs text-gray-600">
                  Total filtrado ({tabela.total} de {tabela.totalGeral}): <span className="font-bold">{moeda(tabela.filtradas.reduce((a, o) => a + Number(o.valor), 0))}</span>
                </p>
              ) : null}
            </div>
          </>
        )}

        {vendoItens?.idMovimento ? (
          <ItensDoMovimentoDialog
            movimento={{
              idMovimento: vendoItens.idMovimento,
              emissao: vendoItens.emissao,
              cliForn: vendoItens.cliForn,
              historico: vendoItens.historico,
              valor: vendoItens.valor,
              conta: vendoItens.contaDoBalancete.reduzido,
              centro: vendoItens.centroOriginal ? vendoItens.centroOriginal.codigoRM : vendoItens.codigoCentroCusto,
            }}
            queryKey={["relatorios", "pesquisa", "itens", vendoItens.id]}
            carregar={() => dreService.itensDoMovimento(vendoItens.anoMes, filtroDo(vendoItens), vendoItens.id)}
            onFechar={() => setVendoItens(null)}
            contestar={
              podeContestar
                ? {
                    bloqueio: bloqueioDosItens(vendoItens),
                    render: (sel: ItensSelecionados, fechar: () => void, concluir: () => void) => (
                      <ContestarDialog
                        movimento={movimentoContestado(vendoItens)}
                        anoMes={vendoItens.anoMes}
                        itens={sel}
                        onFechar={fechar}
                        onCriada={() => {
                          concluir();
                          aoContestar();
                        }}
                      />
                    ),
                  }
                : undefined
            }
          />
        ) : null}
        {contestando ? (
          <ContestarDialog
            movimento={movimentoContestado(contestando)}
            anoMes={contestando.anoMes}
            onFechar={() => setContestando(null)}
            onCriada={() => {
              setContestando(null);
              aoContestar();
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
