"use client";

import { useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Save } from "lucide-react";
import { toast } from "sonner";

import { CabecalhoDaTela } from "@/components/shared/CabecalhoDaTela";
import { type ColunaExportavel, ExportarTabela } from "@/components/shared/ExportarTabela";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePermissions } from "@/context/PermissionContext";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";
import { PainelDeLinhas } from "@/app/relatorios/resultados/ResultadosContent";

import { mensagemDeErro } from "../conferencia-planilha/services/conferenciaService";
import { dataHora, inteiro, lerAnoMes, rotuloCompetencia } from "../utils/formatacao";
import { linhasService, type LinhasDoMes } from "./services/linhasService";

const botaoPrimario = "bg-bpm-primary hover:bg-bpm-primary-hover rounded-sm font-bold text-black shadow-sm";
const Carregando = () => <div className="h-64 animate-pulse rounded-sm bg-gray-100" />;
// O que arredonda para zero sai sem o sinal ("0", e não "-0").
const valor = (v: number | null) => (v === null ? "—" : inteiro(Math.round(v) || 0));

type Linha = { chave: string; rotulo: ReactNode; valores: ReactNode[]; destaque?: boolean };

/** O Exportar (30/10/2026): a conferência da Margem de Contribuição, DRE × Soma das Linhas, por unidade. */
const COLUNAS_DA_CONFERENCIA: ColunaExportavel<LinhasDoMes["unidades"][number]>[] = [
  { chave: "unidade", rotulo: "Unidade", valor: (u) => u.nome },
  { chave: "mcDaDRE", rotulo: "MC da DRE", tipo: "numero", moeda: true, valor: (u) => u.mcDaDRE, texto: (u) => valor(u.mcDaDRE) },
  { chave: "mcDasLinhas", rotulo: "Soma das Linhas", tipo: "numero", moeda: true, valor: (u) => u.mcDasLinhas, texto: (u) => valor(u.mcDasLinhas) },
  { chave: "diferenca", rotulo: "Diferença", tipo: "numero", moeda: true, valor: (u) => u.mcDasLinhas - u.mcDaDRE, texto: (u) => valor(u.mcDasLinhas - u.mcDaDRE) },
  { chave: "semLinha", rotulo: "Sem Linha", tipo: "numero", moeda: true, valor: (u) => u.semLinha, texto: (u) => valor(u.semLinha) },
];

/** Uma tabela no padrão das de Resultados: o nome dela na primeira célula do cabeçalho amarelo-ouro. */
function Tabela({ titulo, colunas, linhas, rodape }: { titulo: string; colunas: string[]; linhas: Linha[]; rodape?: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="overflow-x-auto rounded-sm border border-gray-200 bg-white">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-bpm-primary text-xs font-bold text-black uppercase">
              <th className="min-w-72 px-3 py-2 text-left text-sm tracking-wide whitespace-nowrap">{titulo}</th>
              {colunas.map((c) => (
                <th key={c} className="px-3 py-2 text-right whitespace-nowrap">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.chave} className={`border-b border-gray-100 last:border-b-0 ${l.destaque ? "font-bold" : ""}`}>
                <td className="px-3 py-1.5 whitespace-nowrap text-gray-800">{l.rotulo}</td>
                {l.valores.map((v, i) => (
                  <td key={i} className="px-3 py-1.5 text-right whitespace-nowrap text-gray-800">
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rodape}
    </section>
  );
}

const Destaque = ({ children }: { children: ReactNode }) => (
  <div className="rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-3 text-sm text-gray-700">{children}</div>
);

/** O que falta para o mês ter as linhas, ou quando foram gravadas. */
function Situacao({ dados }: { dados: LinhasDoMes }) {
  const s = dados.situacao;
  if (s.gravadaEm) {
    // As obras (o Realizado por Obra): gravadas com as linhas, ou depois, na competência fechada que já tinha as linhas.
    const obras = !s.obrasGravadasEm
      ? s.podeGravar
        ? " As obras ainda não foram gravadas: grave-as (botão Gravar), com os cadastros de hoje."
        : " As obras ainda não foram gravadas: reapure a competência (Resultados › Apurar) para gravá-las."
      : s.obrasGravadasEm.slice(0, 16) === s.gravadaEm.slice(0, 16)
        ? " As obras foram gravadas junto."
        : ` Obras gravadas em ${dataHora(s.obrasGravadasEm)}.`;
    return (
      <Destaque>
        Linhas gravadas em {dataHora(s.gravadaEm)}
        {s.status === "FECHADA" ? ", congeladas com o fechamento." : ", na última apuração."}
        {obras}
      </Destaque>
    );
  }
  return (
    <Destaque>
      {s.podeGravar
        ? "A competência foi fechada antes da etapa Linhas: grave as linhas (botão Gravar), com a Alocação nas Linhas e as tarefas de hoje."
        : s.apurada
          ? "A competência foi apurada antes da etapa Linhas: reapure-a (Resultados › Apurar) para gravar as linhas."
          : "A competência ainda não foi apurada: as linhas são gravadas na apuração (Resultados › Apurar)."}
    </Destaque>
  );
}

/**
 * A DRE de cada linha no mês (27/10/2026, pedido do Adão): a lista à esquerda, por unidade, e a DRE da escolhida, da receita
 * à Margem de Contribuição, como a aba Linhas dos Resultados Empresariais, só com o mês da competência.
 */
function DREDasLinhas({ anoMes }: { anoMes: string }) {
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const lista = useQuery({ queryKey: ["linhas-do-mes", anoMes, "lista"], queryFn: () => linhasService.lista(anoMes) });
  const linhas = lista.data?.linhas ?? [];
  const id = (escolhida && linhas.some((l) => l.id === escolhida) ? escolhida : linhas[0]?.id) ?? null;
  const linha = useQuery({ queryKey: ["linhas-do-mes", anoMes, "linha", id], queryFn: () => linhasService.linha(anoMes, id!), enabled: id !== null });
  if (lista.isError) {
    return (
      <div className="rounded-sm border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-700">{mensagemDeErro(lista.error, "Erro ao carregar as linhas.")}</p>
      </div>
    );
  }
  if (lista.isPending) return <Carregando />;
  if (linhas.length === 0) return <p className="rounded-sm border border-gray-200 bg-white p-6 text-sm text-gray-600">Nenhuma linha das unidades que o seu perfil lê.</p>;
  return <PainelDeLinhas linhas={linhas} id={id} onEscolher={setEscolhida} linha={linha} soOMes />;
}

function Conferencia({ dados }: { dados: LinhasDoMes }) {
  return (
    <div className="space-y-6">
      <Tabela
        titulo="Margem de Contribuição: DRE × Soma das Linhas"
        colunas={["MC da DRE", "Soma das Linhas", "Diferença", "Sem Linha"]}
        linhas={dados.unidades.map((u) => ({
          chave: String(u.unidade),
          rotulo: u.nome,
          valores: [valor(u.mcDaDRE), valor(u.mcDasLinhas), valor(u.mcDasLinhas - u.mcDaDRE), valor(u.semLinha)],
        }))}
        rodape={
          <p className="text-xs text-gray-500">
            A soma das linhas de cada unidade é a DRE dela, conta a conta. Sem Linha: as receitas e os custos que nenhum passo da Alocação nas Linhas levou a
            uma linha.
          </p>
        }
      />
      {dados.niveis.length ? (
        <Tabela
          titulo="Origem dos Valores"
          colunas={["Matriz", "Filial", "Serviços"]}
          linhas={dados.niveis.map((n) => ({ chave: n.nivel, rotulo: n.rotulo, valores: n.porUnidade.map(valor) }))}
          rodape={
            <p className="text-xs text-gray-500">
              De que passo veio cada valor das linhas: a Receita Prévia (as receitas) e, nos custos, a Tarefa, a Regra do Centro, a Obra, o Percentual Fixo
              (os percentuais por linha de um rateio fixo, em Regras de Rateio), a Regra do Rateio e o Volume da Unidade (Cadastros Gerais › Alocação
              nas Linhas).
            </p>
          }
        />
      ) : null}
      {dados.documentos ? (
        <Tabela
          titulo="Requisições e Notas Fiscais"
          colunas={["Itens"]}
          linhas={[
            { chave: "requisicoes", rotulo: "Requisições", valores: [inteiro(dados.documentos.requisicoes)] },
            { chave: "notas", rotulo: "Notas Fiscais", valores: [inteiro(dados.documentos.notas)] },
          ]}
          rodape={
            <p className="text-xs text-gray-500">
              Sem os documentos, os custos vão às linhas sem a tarefa (a partir da Regra do Centro). Importe-os na etapa Importações, com a competência aberta, e
              reapure.
            </p>
          }
        />
      ) : null}
      {dados.obras ? (
        <Tabela
          titulo="Obras"
          colunas={["Valor"]}
          linhas={[
            { chave: "obras", rotulo: "Obras com valor no mês", valores: [inteiro(dados.obras.obras)] },
            { chave: "semObra", rotulo: "Custos Sem Obra (R$)", valores: [valor(dados.obras.semObra)] },
          ]}
          rodape={
            <p className="text-xs text-gray-500">
              As obras de cada linha somam a linha: o direto de cada obra (a receita, os centros de obra e os volumes) e a parte dela no rateio da linha. Sem
              Obra: os custos de centros de obra sem a obra no cadastro, os da Sem Linha e o rateio das linhas sem base no mês e no exercício.
            </p>
          }
        />
      ) : null}
      {dados.avisos.length || dados.obras?.avisos.length ? (
        <div className="space-y-1 rounded-sm border border-l-4 border-gray-200 border-l-red-600 bg-white px-4 py-3 text-sm text-gray-700">
          {[...dados.avisos, ...(dados.obras?.avisos ?? [])].map((a) => (
            <p key={a}>{a}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A etapa Linhas do mês (26/10/2026, pedido do Adão; antes, a tela Resultados por Linha): a DRE de cada unidade dividida
 * entre as linhas, gravada na apuração e congelada com o fechamento. A conferência do mês, para ver as linhas antes de
 * fechar; a competência fechada antes da etapa grava as linhas aqui, uma vez.
 */
export function LinhasContent() {
  const { anoMes } = useParams<{ anoMes: string }>();
  useRegistrarAcessoTela(`/competencias/${anoMes}/linhas`);
  const periodo = lerAnoMes(anoMes);
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();
  const [confirmar, setConfirmar] = useState(false);
  const consulta = useQuery({ queryKey: ["linhas-do-mes", anoMes], queryFn: () => linhasService.doMes(anoMes), enabled: periodo !== null });
  // Com as linhas já gravadas, o Gravar grava só as obras (03/11/2026, o Realizado por Obra).
  const soObras = !!consulta.data?.situacao.gravadaEm;
  const gravar = useMutation({
    mutationFn: () => linhasService.gravar(anoMes),
    onSuccess: (dados) => {
      queryClient.setQueryData(["linhas-do-mes", anoMes], dados);
      queryClient.invalidateQueries({ queryKey: ["linhas-do-mes", anoMes, "lista"] });
      queryClient.invalidateQueries({ queryKey: ["linhas-do-mes", anoMes, "linha"] });
      // Resultados Empresariais passam a mostrar o mês na aba Linhas, e o Realizado por Obra, nas obras.
      queryClient.invalidateQueries({ queryKey: ["relatorios", "resultados"] });
      queryClient.invalidateQueries({ queryKey: ["realizado-obra"] });
      toast.success(`${soObras ? "Obras" : "Linhas e obras"} de ${rotuloCompetencia(periodo!.ano, periodo!.mes)} gravadas.`);
      setConfirmar(false);
    },
  });

  if (!periodo) {
    return (
      <div className="rounded-sm border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-700">Competência inválida na URL: {anoMes}.</p>
      </div>
    );
  }
  const rotulo = rotuloCompetencia(periodo.ano, periodo.mes);
  const dados = consulta.data;
  return (
    <div className="space-y-6">
      <CabecalhoDaTela
        titulo="Linhas"
        exportar={
          dados?.situacao.gravadaEm ? (
            <ExportarTabela titulo={`Linhas · Margem de Contribuição: DRE × Soma das Linhas · ${rotulo}`} colunas={COLUNAS_DA_CONFERENCIA} linhas={dados.unidades} />
          ) : null
        }
        comoExportar="Aqui, a tabela é a DRE × Soma das Linhas, embaixo; a DRE das linhas se exporta em Resultados Empresariais › Resultados, na aba Linhas."
        sobre={
          <>
            <p>
              A DRE de cada unidade (Matriz, Filial e Serviços) dividida entre as linhas de produto e de obra, da receita à Margem de Contribuição. A apuração
              grava as linhas na última etapa, depois da DRE, e o fechamento as congela: mudar a Alocação nas Linhas, as tarefas das linhas ou os documentos
              depois de apurar pede reapurar, como os outros cadastros e entradas.
            </p>
            <p>
              A receita vem da Receita Prévia das linhas. Os custos e as despesas variáveis de venda vêm dos lançamentos que formaram cada valor da unidade (os
              diretos e a parte de cada rateio), e cada lançamento vai às linhas por esta ordem: a tarefa das requisições e das notas fiscais (Cadastros da
              Controladoria › Linhas › Tarefas), a regra do centro de custo, a obra (os centros de obra, pela produção, pelos acompanhamentos ou pela receita da
              própria obra), os percentuais por linha do rateio fixo (na parte de rateio de uma chave com percentuais fixos no mês: Cadastros Gerais ›
              Regras de Rateio), a regra do rateio do centro (Cadastros Gerais › Alocação nas Linhas) e, por último, o volume da unidade.
            </p>
            <p>
              A etapa divide também cada linha entre as obras dela, para o Realizado por Obra: o direto de cada obra (a receita dela na Receita Prévia, os
              lançamentos dos centros de obra e os volumes dela nas listas) e a parte dela no rateio da linha — os custos que não vieram dos centros de obra,
              pelo m³ produzido (custos de produção), pelo m³ montado (custos de montagem da linha Montagem), pelos dias de acompanhamento (custos
              complementares e demais serviços) ou pela receita bruta
              (despesas variáveis de venda) da obra no mês e, sem eles, no exercício até ele. As obras genéricas ficam fora da base do rateio. O
              lançamento é de um centro de obra pelo centro de custo que vale para ele: o que uma contestação ou uma reclassificação por fornecedor levou
              a outro centro, e o redistribuído (pelos centros dos destinos), seguem o centro novo.
            </p>
          </>
        }
        comoUsar={
          <ul>
            <li>Apure a competência (Resultados › Apurar): a etapa Linhas vem por último e grava as linhas do mês.</li>
            <li>
              Escolha a linha na lista à esquerda, por unidade: a tabela mostra a DRE dela no mês, da receita à Margem de Contribuição, com o % e o R$/m³ da
              unidade dela, como a aba Linhas dos Resultados Empresariais. A lista traz as linhas das unidades (Matriz, Filial e Serviços) cujas abas o seu
              perfil lê na tela Resultados, e a linha inativa só quando tem valor no mês.
            </li>
            <li>No menu de níveis (a seta antes do título da tabela), escolha Totais, Atribuições ou Contas; a seta de cada grupo abre e fecha só ele.</li>
            <li>
              Embaixo, confira antes de fechar: a Margem de Contribuição da DRE de cada unidade contra a soma das linhas (iguais, com o que ficou Sem Linha), de
              que passo veio cada valor, os documentos do mês e os avisos.
            </li>
            <li>Para corrigir, ajuste a Alocação nas Linhas, as tarefas das linhas ou os documentos (etapa Importações) e reapure.</li>
            <li>
              Uma competência fechada antes da etapa Linhas mostra o botão Gravar: grava as linhas e as obras uma vez, com a Alocação nas Linhas e as tarefas de
              hoje; a fechada com as linhas e sem as obras grava só as obras, com as linhas como estão. Depois, só reabrindo e reapurando.
            </li>
            <li>A tabela Obras traz quantas obras têm valor no mês e o custo que ficou Sem Obra; os avisos dizem de onde ele veio.</li>
            <li>O exercício de cada linha, mês a mês, fica em Resultados Empresariais › Resultados, na aba Linhas (com as competências fechadas).</li>
          </ul>
        }
        acoes={
          dados?.situacao.podeGravar && hasPermission("linhas_mes:editar") ? (
            <Button
              type="button"
              className={botaoPrimario}
              onClick={() => {
                gravar.reset();
                setConfirmar(true);
              }}
            >
              <Save className="size-4" />
              Gravar
            </Button>
          ) : null
        }
      />
      {consulta.isError ? (
        <div className="rounded-sm border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{mensagemDeErro(consulta.error, "Erro ao carregar as linhas do mês.")}</p>
        </div>
      ) : !dados ? (
        <Carregando />
      ) : (
        <>
          <Situacao dados={dados} />
          {dados.situacao.gravadaEm ? (
            <>
              <DREDasLinhas anoMes={anoMes} />
              <Conferencia dados={dados} />
            </>
          ) : null}
        </>
      )}
      <Dialog open={confirmar} onOpenChange={(aberto) => !gravar.isPending && setConfirmar(aberto)}>
        <DialogContent className="rounded-sm sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{soObras ? `Gravar as Obras de ${rotulo}` : `Gravar as Linhas de ${rotulo}`}</DialogTitle>
            <DialogDescription>
              {soObras
                ? "As linhas da competência fechada ficam como estão. As obras de cada linha serão gravadas com a Alocação nas Linhas, as tarefas das linhas e o cadastro das obras de hoje, e ficam congeladas: para refazê-las, só reabrindo a competência e reapurando."
                : "A competência foi fechada antes da etapa Linhas. As linhas e as obras de cada uma serão gravadas com a Alocação nas Linhas, as tarefas das linhas e os documentos de hoje, e ficam congeladas: para refazê-las, só reabrindo a competência e reapurando."}
            </DialogDescription>
          </DialogHeader>
          {gravar.isError ? (
            <div className="flex items-center gap-2 rounded-sm border border-red-200 bg-red-50 p-3">
              <AlertCircle className="size-4 shrink-0 text-red-700" />
              <p className="text-sm text-red-700">{mensagemDeErro(gravar.error, "Não foi possível gravar as linhas.")}</p>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-sm" onClick={() => setConfirmar(false)} disabled={gravar.isPending}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => gravar.mutate()} disabled={gravar.isPending} className={botaoPrimario}>
              {gravar.isPending ? "Gravando…" : "Gravar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
