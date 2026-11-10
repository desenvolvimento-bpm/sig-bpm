"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Upload } from "lucide-react";

import { useAbaLembrada } from "@/hooks/useAbaLembrada";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ExportarTabela } from "@/components/shared/ExportarTabela";
import { Abas } from "@/components/shared/Abas";
import { CabecalhoDaTela } from "@/components/shared/CabecalhoDaTela";
import { Carregando, ErroCarga, Vazio } from "@/components/shared/Estados";
import { Paginacao } from "@/components/shared/Paginacao";
import { QuadroTabela } from "@/components/shared/QuadroTabela";
import { SemResultado, useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import type { Coluna } from "@/lib/filtrosDeTabela";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionContext";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";

import { ImportarLoteDialog } from "./components/ImportarLoteDialog";
import { ResultadoImportacao } from "./components/ResultadoImportacao";
import { importacoesService, type Importacao, type StatusImportacao } from "./services/importacoesService";
import { dataHora, inteiro, lerAnoMes, ROTULO_TIPO } from "../utils/formatacao";

const botaoPrimario = "bg-bpm-primary hover:bg-bpm-primary-hover rounded-sm font-bold text-black shadow-sm";

/**
 * Os arquivos de todo mês, na ordem do fechamento: todos obrigatórios para fechar a competência (17/10/2026). Depois deles,
 * sempre visíveis, os opcionais: a DRE do Comercial e o saldo inicial (antes, só apareciam quando importados no mês).
 */
const TIPOS_DO_MES = ["BALANCETE", "PROJETO", "PRODUCAO", "PRODUCAO_PISTA", "PRODUCAO_ARMADURA", "PRODUCAO_METALURGIA", "EXPEDICAO", "MONTAGEM", "ACOMPANHAMENTO", "MEDICAO", "DEVOLUCAO", "SAIDA", "QUADRO_LOTACAO", "INDICADORES_ADMIN", "INDICADORES_COMERCIAL", "REQUISICOES", "NOTAS_FISCAIS", "CREDITOS_IMPOSTOS"];
const TIPOS_EVENTUAIS = ["DRE_COMERCIAL", "ESTOQUE_INICIAL"];

const ESTILO_STATUS: Record<StatusImportacao, { classe: string; rotulo: string }> = {
  PROCESSANDO: { classe: "border-blue-200 bg-blue-50 text-blue-700", rotulo: "Processando" },
  CONCLUIDA: { classe: "border-green-200 bg-green-50 text-green-700", rotulo: "Concluída" },
  REJEITADA: { classe: "border-red-200 bg-red-50 text-red-700", rotulo: "Recusada" },
};

function Selo({ classe, children }: { classe: string; children: React.ReactNode }) {
  return <span className={`inline-block rounded-sm border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${classe}`}>{children}</span>;
}

/** O selo da importação; o rótulo também é o texto do filtro da coluna Situação. */
function estiloSituacao(imp: Importacao) {
  if (imp.comparacao && imp.status === "CONCLUIDA") return { classe: "border-yellow-200 bg-yellow-50 text-yellow-800", rotulo: "Comparação" };
  if (imp.substituidaEm) return { classe: "border-gray-200 bg-gray-50 text-gray-500", rotulo: "Substituída" };
  return ESTILO_STATUS[imp.status];
}

function StatusImportacaoBadge({ imp }: { imp: Importacao }) {
  const { classe, rotulo } = estiloSituacao(imp);
  return <Selo classe={classe}>{rotulo}</Selo>;
}

/** A importação de cada tipo que vale no mês e, se for mais recente, a última tentativa que não a substituiu (recusada ou comparação). */
/** `semRegistros` (17/10/2026): sem importação em vigor, mas com o arquivo recusado por não ter registros no mês — o mês sem movimento da lista, que conta como entregue para o fechamento. */
type Situacao = { tipo: string; vigente: Importacao | null; ultimaTentativa: Importacao | null; semRegistros: boolean };

function situacaoPorTipo(itens: Importacao[], tipos: string[]): Situacao[] {
  return tipos.map((tipo) => {
    const doTipo = itens.filter((i) => i.tipo === tipo); // a lista vem da mais recente para a mais antiga
    const vigente = doTipo.find((i) => !i.comparacao && !i.substituidaEm && i.status !== "REJEITADA") ?? null;
    const ultima = doTipo[0] ?? null;
    const semRegistros = !vigente && doTipo.some((i) => i.status === "REJEITADA" && !i.comparacao && !!i.motivoRejeicao?.includes("não tem registros de"));
    return { tipo, vigente, ultimaTentativa: ultima && ultima !== vigente ? ultima : null, semRegistros };
  });
}

const instante = (iso: string) => new Date(iso).getTime();

const COLUNAS_VIGOR: Coluna<Situacao>[] = [
  { chave: "tipo", rotulo: "Tipo", valor: (s) => ROTULO_TIPO[s.tipo] ?? s.tipo },
  { chave: "arquivo", rotulo: "Arquivo", valor: (s) => s.vigente?.nomeArquivo },
  {
    chave: "importadoEm",
    rotulo: "Importado em",
    tipo: "data",
    valor: (s) => (s.vigente ? instante(s.vigente.importadoEm) : null),
    texto: (s) => (s.vigente ? dataHora(s.vigente.importadoEm) : null),
  },
  { chave: "por", rotulo: "Por", valor: (s) => s.vigente?.usuario?.nome },
  { chave: "aceitas", rotulo: "Aceitas", tipo: "numero", alinhamento: "direita", valor: (s) => s.vigente?.linhasAceitas, texto: (s) => (s.vigente ? inteiro(s.vigente.linhasAceitas) : null) },
  {
    chave: "rejeitadas",
    rotulo: "Rejeitadas",
    tipo: "numero",
    alinhamento: "direita",
    valor: (s) => s.vigente?.linhasRejeitadas,
    texto: (s) => (s.vigente ? inteiro(s.vigente.linhasRejeitadas) : null),
  },
  { chave: "situacao", rotulo: "Situação", valor: (s) => (s.vigente ? estiloSituacao(s.vigente).rotulo : s.semRegistros ? "Sem Registros no Mês" : "Não Importado") },
  { chave: "acoes", rotulo: "", semFiltro: true },
];

const COLUNAS_HISTORICO: Coluna<Importacao>[] = [
  { chave: "quando", rotulo: "Quando", tipo: "data", valor: (i) => instante(i.importadoEm), texto: (i) => dataHora(i.importadoEm) },
  { chave: "tipo", rotulo: "Tipo", valor: (i) => ROTULO_TIPO[i.tipo] ?? i.tipo },
  { chave: "arquivo", rotulo: "Arquivo", valor: (i) => i.nomeArquivo },
  { chave: "situacao", rotulo: "Situação", valor: (i) => estiloSituacao(i).rotulo },
  { chave: "aceitas", rotulo: "Aceitas", tipo: "numero", alinhamento: "direita", valor: (i) => i.linhasAceitas, texto: (i) => inteiro(i.linhasAceitas) },
  { chave: "rejeitadas", rotulo: "Rejeitadas", tipo: "numero", alinhamento: "direita", valor: (i) => i.linhasRejeitadas, texto: (i) => inteiro(i.linhasRejeitadas) },
  { chave: "por", rotulo: "Por", valor: (i) => i.usuario?.nome },
];


export function ImportarContent() {
  const { anoMes } = useParams<{ anoMes: string }>();
  useRegistrarAcessoTela(`/competencias/${anoMes}/importar`);
  const { user } = useAuth();
  const { hasPermission } = usePermissions();

  const periodo = lerAnoMes(anoMes);
  const [aba, setAba] = useAbaLembrada<"vigor" | "historico">("aba", "vigor", ["vigor", "historico"]);
  const [aberta, setAberta] = useState<string | null>(null);
  // Importar ou Reimportar um tipo (da linha da tabela): o diálogo do Importar Arquivo, só com a aba dele. Fechado, guarda o tipo,
  // para o diálogo reabrir com o andamento (como o do Importar Arquivo); outro tipo começa do zero.
  const [doTipo, setDoTipo] = useState<{ tipo: string; titulo: string; aberto: boolean } | null>(null);
  // "Importar Arquivo": o arquivo inteiro, aba por aba.
  const [lote, setLote] = useState(false);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["importacoes", anoMes],
    queryFn: () => importacoesService.listar(anoMes),
    enabled: periodo !== null,
    // Enquanto houver importação em andamento (a fila do lote segue com o diálogo fechado), a lista se atualiza sozinha.
    refetchInterval: (q) => (q.state.data?.itens.some((i) => i.status === "PROCESSANDO") ? 2000 : false),
  });

  // Lançamentos contábeis do RM Saldus (BPM.CONTR.002): a linha própria da tabela, fora da fila de arquivos.
  const queryClient = useQueryClient();
  const lancamentosRm = useQuery({
    queryKey: ["lancamentosRm", anoMes],
    queryFn: () => importacoesService.statusLancamentosRm(anoMes),
    enabled: periodo !== null,
  });
  const importarLancamentosRm = useMutation({
    mutationFn: () => importacoesService.importarLancamentosRm(anoMes),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["lancamentosRm", anoMes] }),
  });

  // Memorizadas porque entram no filtro dos rótulos, que recalcula quando a lista muda.
  const situacoes = useMemo(() => {
    const lista = data?.itens ?? [];
    // Recorte por setor (Passo 22): o Alimentador só vê as listas dos seus setores.
    const alcanca = (t: string) => !user?.acesso.recorteSetor || user.acesso.setores.includes(t);
    const tipos = [...TIPOS_DO_MES, ...TIPOS_EVENTUAIS].filter(alcanca);
    return situacaoPorTipo(lista, tipos);
  }, [data, user]);
  const vigor = useTabelaFiltravel(situacoes, COLUNAS_VIGOR);
  const historico = useTabelaFiltravel(data?.itens, COLUNAS_HISTORICO, { porPaginaInicial: 25 });

  if (!periodo) {
    return <ErroCarga mensagem={`Competência inválida na URL: ${anoMes}. Use o formato aaaa-mm.`} />;
  }

  const itens = data?.itens ?? [];
  const fechada = data?.competencia.status === "FECHADA";
  const podeImportar = hasPermission("importacao:editar");
  const mensagemErro = (error as { response?: { data?: { error?: string } } } | null)?.response?.data?.error ?? "Erro ao carregar as importações.";

  const importados = situacoes.filter((s) => s.vigente).length;

  // Com o mês fechado, só o balancete entra, para comparar (Passo 24).
  const podeEnviar = (tipo: string) => podeImportar && (!fechada || tipo === "BALANCETE");

  return (
    <div className="space-y-6">
      <CabecalhoDaTela
        titulo="Importações"
        exportar={aba === "vigor" ? <ExportarTabela titulo={`Importações · Em Vigor · ${anoMes.slice(5)}/${anoMes.slice(0, 4)}`} colunas={COLUNAS_VIGOR} linhas={vigor.filtradas} /> : <ExportarTabela titulo={`Importações · Histórico · ${anoMes.slice(5)}/${anoMes.slice(0, 4)}`} colunas={COLUNAS_HISTORICO} linhas={historico.filtradas} />}
        selo={
          fechada ? (
            <span
              className="inline-flex items-center gap-1 rounded-sm border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-600"
              title="Competência fechada: só recebe o balancete, para comparar com o que está gravado. As diferenças viram divergências e a competência não muda. Para substituir dados, ela precisa ser reaberta."
            >
              <Lock className="size-3" />
              Fechada · só comparação do balancete
            </span>
          ) : null
        }
        comoUsar={
          <ul>
            <li>Clique em “Importar Arquivo” e escolha a planilha (.xlsx); o diálogo lista os arquivos e as abas que servem. A ferramenta reconhece as abas pelo nome, confere a estrutura de cada uma e mostra a prévia: o que muda, mês a mês. Nada é importado antes de você clicar em “Importar”; aí as abas certas entram na fila, uma por vez, e uma aba com erro é avisada, sem parar as próximas.</li>
            <li>Uma aba sem diferença em relação à importação em vigor fica “Sem mudança” e não se importa de novo, a menos que nada tenha mudado no arquivo: aí “Importar” continua valendo e reimporta o mês atual assim mesmo (os meses anteriores ficam como estão). Um arquivo com vários meses atualiza todos eles; os meses já apurados que mudarem ganham a bola verde e pedem reapuração.</li>
            <li>A lista do arquivo avisa quando a importação muda competências fechadas (o balancete do ano inteiro, os preços da DRE do Comercial); as diferenças vão para Divergências.</li>
            <li>
              Para importar só um tipo, use “Importar” (ou “Reimportar”) na linha dele: abre o mesmo diálogo, só com a aba daquele tipo. Escolha o arquivo
              completo ou uma pasta de trabalho só com essa aba; a prévia mostra só essa aba, mês a mês, e nada é importado antes de você confirmar.
            </li>
            <li>Na aba Em Vigor, clique numa linha para abrir o relatório: linhas aceitas, recusadas e avisos.</li>
            <li>
              A aba Em Vigor mostra sempre todos os tipos, também os não importados. Para fechar a competência, todos precisam estar importados, menos os
              marcados como Opcional (a DRE do Comercial e o saldo inicial do estoque); os que faltam aparecem nos motivos do Fechar Competência, na tela Resultados. O
              arquivo recusado por não ter registros do mês (o mês sem movimento daquela lista) aparece como Sem Registros no Mês e conta como entregue.
            </li>
            <li>A aba Histórico guarda todas as importações, inclusive as recusadas e as substituídas.</li>
            <li>Em mês fechado, o balancete só é comparado com o gravado; as diferenças vão para Divergências.</li>
            <li>Depois de importar o balancete, confira a Classificação.</li>
          </ul>
        }
        sobre={
          <>
            <p>
              O balancete (LISTAS REALIZADO (RESULTADOS)), as listas operacionais — as abas (Resumo), Produção (Armaduras), Produção
              (Metalúrgica) e as demais do LISTAS REALIZADO (OPERAÇÃO) —, o Quadro de Lotação por centro de custo (a referência do
              quadro de lotação dos Cenários Analíticos, fora da apuração), os Créditos de Impostos (a aba Impostos (Lista) do LISTAS REALIZADO (RESULTADOS): o
              Creditado e o Estornado de cada conta da Matriz e da Filial, para a aba Impostos de Resultados, fora da apuração), os indicadores do Administrativo e do Comercial, a DRE do Comercial
              e o saldo inicial do estoque entram por aqui (o balancete é detalhado: um movimento por linha, com o cliente ou fornecedor, a emissão e o histórico, que o extrato de uma conta na DRE abre no modal Balancete; nas abas Requisições (Lista) e Notas Fiscais (Lista), a tarefa dos itens leva os custos às linhas, na etapa Linhas da apuração) (as metas do orçamento ficam nos cenários: Criação de Cenários / Cenários Sintéticos). Reimportar um tipo substitui o
              lote anterior por inteiro.
            </p>
            <p>
              &quot;Em vigor&quot; mostra o arquivo que vale para cada tipo neste mês. O histórico guarda toda importação, inclusive as recusadas e
              as substituídas.
            </p>
          </>
        }
        acoes={
          data && podeImportar ? (
            <Button type="button" className={botaoPrimario} onClick={() => setLote(true)}>
              <Upload className="size-4" />
              {fechada ? "Comparar Balancete" : "Importar Arquivo"}
            </Button>
          ) : null
        }
      />

      {isError ? <ErroCarga mensagem={mensagemErro} /> : null}

      <Abas
        rotulo="Importações"
        ativa={aba}
        onMudar={(c) => setAba(c as "vigor" | "historico")}
        abas={[
          { chave: "vigor", rotulo: "Em vigor" },
          { chave: "historico", rotulo: "Histórico" },
        ]}
      />

      {aba === "vigor" ? (
        <QuadroTabela>
          {isPending ? (
            <Carregando linhas={6} />
          ) : (
            <table className="tabela-sig w-full border-collapse">
              {vigor.cabecalho}
              <tbody>
                {vigor.visiveis.length === 0 ? <SemResultado colunas={COLUNAS_VIGOR.length} onLimpar={vigor.limpar} /> : null}
                {vigor.visiveis.map(({ tipo, vigente, ultimaTentativa, semRegistros }) => (
                  <tr
                    key={tipo}
                    onClick={vigente ? () => setAberta(vigente.id) : undefined}
                    className={`border-b border-gray-100 ${vigente ? "cursor-pointer hover:bg-gray-50" : ""}`}
                  >
                    <td className="px-4 text-sm font-medium whitespace-nowrap text-gray-900">
                      {ROTULO_TIPO[tipo] ?? tipo}
                      {/* Os opcionais para o fechamento (17/10/2026). */}
                      {TIPOS_EVENTUAIS.includes(tipo) ? <span className="ml-1.5 text-xs font-normal text-gray-500">(Opcional)</span> : null}
                    </td>
                    {/* O nome do arquivo ocupa a largura que sobra e corta o resto, sem alargar a tabela. */}
                    <td className="w-full px-4 text-sm text-gray-900">
                      <div className="relative h-5" title={vigente?.nomeArquivo}>
                        <div className="absolute inset-x-0 truncate">{vigente ? vigente.nomeArquivo : <span className="text-gray-400">—</span>}</div>
                      </div>
                      {ultimaTentativa ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAberta(ultimaTentativa.id);
                          }}
                          className={`mt-0.5 block text-left text-xs hover:underline ${ultimaTentativa.status === "REJEITADA" ? "text-red-700" : "text-yellow-800"}`}
                        >
                          {ultimaTentativa.status === "REJEITADA"
                            ? `Recusada em ${dataHora(ultimaTentativa.importadoEm)}`
                            : ultimaTentativa.comparacao
                              ? `Comparado em ${dataHora(ultimaTentativa.importadoEm)}`
                              : `Enviado em ${dataHora(ultimaTentativa.importadoEm)}`}
                        </button>
                      ) : null}
                    </td>
                    <td className="px-4 text-sm whitespace-nowrap text-gray-600">{vigente ? dataHora(vigente.importadoEm) : ""}</td>
                    <td className="px-4 text-sm whitespace-nowrap text-gray-600">{vigente?.usuario?.nome ?? ""}</td>
                    <td className="px-4 text-right text-sm">{vigente ? inteiro(vigente.linhasAceitas) : ""}</td>
                    <td className="px-4 text-right text-sm">
                      {vigente ? vigente.linhasRejeitadas > 0 ? <span className="font-medium text-red-700">{inteiro(vigente.linhasRejeitadas)}</span> : <span className="text-gray-400">0</span> : ""}
                    </td>
                    <td className="px-4">
                      {vigente ? (
                        <StatusImportacaoBadge imp={vigente} />
                      ) : semRegistros ? (
                        <Selo classe="border-gray-300 bg-gray-50 text-gray-700">Sem Registros no Mês</Selo>
                      ) : (
                        <Selo classe="border-gray-200 bg-white text-gray-500">Não Importado</Selo>
                      )}
                    </td>
                    <td className="px-4 text-right" onClick={(e) => e.stopPropagation()}>
                      {podeEnviar(tipo) && TIPOS_DO_MES.includes(tipo) ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-sm"
                          onClick={() => setDoTipo({ tipo, titulo: `${fechada ? "Comparar" : vigente ? "Reimportar" : "Importar"} ${ROTULO_TIPO[tipo] ?? tipo}`, aberto: true })}
                        >
                          {fechada ? "Comparar" : vigente ? "Reimportar" : "Importar"}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {/* Lançamentos contábeis do RM Saldus: importação própria, não é um arquivo (BPM.CONTR.002). */}
                <tr className="border-b border-gray-100">
                  <td className="px-4 text-sm font-medium whitespace-nowrap text-gray-900">Lançamentos Contábeis (RM)</td>
                  <td className="w-full px-4 text-sm text-gray-600">
                    <div className="relative h-5" title="Sentença BPM.CONTR.002 do TOTVS RM Saldus">
                      <div className="absolute inset-x-0 truncate">BPM.CONTR.002 · TOTVS RM Saldus</div>
                    </div>
                    {importarLancamentosRm.isError ? (
                      <span className="mt-0.5 block text-xs text-red-700">
                        {(importarLancamentosRm.error as { response?: { data?: { error?: string } } } | null)?.response?.data?.error ?? "Falha ao importar do RM."}
                      </span>
                    ) : null}
                    {importarLancamentosRm.isSuccess && importarLancamentosRm.data.lidas === 0 ? (
                      <span className="mt-0.5 block text-xs text-gray-500">O RM não devolveu lançamentos neste mês; nada foi alterado.</span>
                    ) : null}
                  </td>
                  <td className="px-4 text-sm whitespace-nowrap text-gray-600">
                    {lancamentosRm.data?.sincronizadoEm ? dataHora(lancamentosRm.data.sincronizadoEm) : ""}
                  </td>
                  <td className="px-4 text-sm whitespace-nowrap text-gray-600" />
                  <td className="px-4 text-right text-sm">{lancamentosRm.data?.linhas ? inteiro(lancamentosRm.data.linhas) : ""}</td>
                  <td className="px-4 text-right text-sm" />
                  <td className="px-4">
                    {lancamentosRm.data && lancamentosRm.data.linhas > 0 ? (
                      <Selo classe="border-green-200 bg-green-50 text-green-700">Importado</Selo>
                    ) : (
                      <Selo classe="border-gray-200 bg-white text-gray-500">Não Importado</Selo>
                    )}
                  </td>
                  <td className="px-4 text-right">
                    {podeImportar && !fechada ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-sm"
                        disabled={importarLancamentosRm.isPending || lancamentosRm.isPending}
                        onClick={() => importarLancamentosRm.mutate()}
                      >
                        {importarLancamentosRm.isPending ? "Importando…" : lancamentosRm.data && lancamentosRm.data.linhas > 0 ? "Reimportar" : "Importar"}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </QuadroTabela>
      ) : (
        <QuadroTabela
          rodape={
            historico.total > 0 ? (
              <Paginacao
                total={historico.total}
                pagina={historico.pagina}
                porPagina={historico.porPagina}
                onPagina={historico.setPagina}
                onPorPagina={historico.setPorPagina}
              />
            ) : null
          }
        >
          {isPending ? (
            <Carregando linhas={6} />
          ) : itens.length === 0 ? (
            <Vazio titulo="Nenhuma importação nesta competência" dica={podeImportar ? "Use o botão Importar Arquivo." : undefined} />
          ) : (
            <table className="tabela-sig w-full border-collapse">
              {historico.cabecalho}
              <tbody>
                {historico.visiveis.length === 0 ? <SemResultado colunas={COLUNAS_HISTORICO.length} onLimpar={historico.limpar} /> : null}
                {historico.visiveis.map((imp) => (
                  <tr key={imp.id} onClick={() => setAberta(imp.id)} className={`cursor-pointer border-b border-gray-100 hover:bg-gray-50 ${imp.substituidaEm ? "text-gray-500" : ""}`}>
                    <td className="px-4 text-sm whitespace-nowrap">{dataHora(imp.importadoEm)}</td>
                    <td className="px-4 text-sm whitespace-nowrap">{ROTULO_TIPO[imp.tipo] ?? imp.tipo}</td>
                    <td className="w-full px-4 text-sm" title={imp.nomeArquivo}>
                      <div className="relative h-5">
                        <div className="absolute inset-x-0 truncate">{imp.nomeArquivo}</div>
                      </div>
                    </td>
                    <td className="px-4">
                      <StatusImportacaoBadge imp={imp} />
                    </td>
                    <td className="px-4 text-right text-sm">{inteiro(imp.linhasAceitas)}</td>
                    <td className="px-4 text-right text-sm">
                      {imp.linhasRejeitadas > 0 ? <span className="font-medium text-red-700">{inteiro(imp.linhasRejeitadas)}</span> : <span className="text-gray-400">0</span>}
                    </td>
                    <td className="px-4 text-sm whitespace-nowrap">{imp.usuario?.nome ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </QuadroTabela>
      )}

      <ImportarLoteDialog
        anoMes={anoMes}
        aberto={lote}
        fechada={fechada}
        onFechar={() => setLote(false)}
        onAbrirRelatorio={(id) => {
          setLote(false);
          setAberta(id);
        }}
      />

      {doTipo ? (
        <ImportarLoteDialog
          key={doTipo.tipo}
          anoMes={anoMes}
          aberto={doTipo.aberto}
          fechada={fechada}
          tipo={doTipo.tipo}
          titulo={doTipo.titulo}
          onFechar={() => setDoTipo({ ...doTipo, aberto: false })}
          onAbrirRelatorio={(id) => {
            setDoTipo({ ...doTipo, aberto: false });
            setAberta(id);
          }}
        />
      ) : null}

      <Sheet open={aberta !== null} onOpenChange={(o) => (!o ? setAberta(null) : undefined)}>
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-6 data-[side=right]:sm:max-w-4xl">
          <SheetTitle className="sr-only">Relatório da Importação</SheetTitle>
          {aberta ? <ResultadoImportacao key={aberta} id={aberta} anoMes={anoMes} noPainel /> : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
