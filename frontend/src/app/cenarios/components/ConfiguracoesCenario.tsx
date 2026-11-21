"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Eye, Globe, ListFilter, Lock, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useAbaLembrada } from "@/hooks/useAbaLembrada";
import { Abas } from "@/components/shared/Abas";
import { usePermissions } from "@/context/PermissionContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { useAlteracoesPendentes } from "@/lib/alteracoesPendentes";

import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";

import { cenariosService, rotuloMarcacao, type AcessoInformacoes, type Cenario, type Visualizacao } from "../services/cenariosService";
import { useTipoDoCenario } from "./tipoDoCenario";
import { AvisoMarcado, estaTravado } from "./AvisoMarcado";
import { botaoPrimario, CampoVisualizacao, Erro, ExcluirCenarioDialog, OpcaoEmLinha } from "./CenarioDialog";
import { BeneficiosDoCenarioAba } from "./BeneficiosDoCenario";
import { CenarioComparado, ComparativoCenario } from "./ComparativoCenario";
import { CompartilharCenario } from "./CompartilharCenario";
import { IndicesDeComparacao, IndicesDeReajuste } from "./IndicesDoCenario";
import { MarcarCenarioDialog } from "./MarcarCenarioDialog";
import { ReferenciaAnalitica } from "./ReferenciaAnalitica";
import { ReferenciaSintetica } from "./ReferenciaSintetica";
import { RegrasDoCenarioAba } from "./RegrasDoCenario";
import { CentrosDoCadastroDoCenarioAba, DepartamentosDoCenarioAba, RedistribuicoesDoCenarioAba, UnidadesDoCenarioAba } from "./CadastrosDoCenario";

/**
 * As configurações do cenário, em duas abas (12/10/2026; antes, dois quadros lado a lado): Cenário (nome, descrição,
 * visualização) e Referência (nos sintéticos, um arquivo ou até duas referências de cenários e realizados; nos analíticos, o
 * resultado realizado ou outro analítico). Os quadros ocupam a largura da tela, com o
 * destaque amarelo-ouro à esquerda, e as opções ficam uma embaixo da outra, com o texto ao lado (13/10/2026).
 */
export type AbaDasConfiguracoes = "cenario" | "referencia" | "unidades" | "departamentos" | "centros_custo" | "beneficios" | "regras_rateio" | "redistribuicoes" | "indices" | "comparativo" | "reajustes";
/** As abas das cópias dos cadastros do cenário (20/11/2026) e o que cada uma edita, para os avisos. */
const DOS_CADASTROS = { unidades: "as unidades", departamentos: "os departamentos", centros_custo: "os centros de custo", beneficios: "os benefícios padrão", regras_rateio: "as regras de rateio", redistribuicoes: "as redistribuições de gastos" } as const;

export function ConfiguracoesCenario({ cenario, abaInicial = "cenario" }: { cenario: Cenario; abaInicial?: AbaDasConfiguracoes }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [escolhida, setAba] = useAbaLembrada<AbaDasConfiguracoes>("aba", abaInicial);
  // As ações do cenário (13/10/2026; antes, ícones na lista dos cenários): marcar e excluir.
  const [acao, setAcao] = useState<"marcar" | "excluir" | null>(null);
  const t = useTipoDoCenario();
  // As abas que o perfil lê e as que edita (14/10/2026).
  const { hasPermission } = usePermissions();
  const pode = (a: AbaDasConfiguracoes, acao: "ler" | "editar" = "ler") => hasPermission(t.perm("configuracoes", acao, a));
  // Quem altera as Configurações (todas as abas e ações): com a Edição das Configurações Particular (o padrão; a regra de
  // 14/10/2026), só quem criou o cenário e o Administrador; Pública (12/11/2026, pedido do Adão), todos com a permissão do
  // perfil. O servidor recusa do mesmo jeito.
  const dono = cenario.podeEditarConfiguracoes;
  const edita = (a: AbaDasConfiguracoes) => dono && pode(a, "editar");
  // O cenário travado (marcado ou com a versão congelada): o nome, a descrição e o comparativo não mudam (14/10/2026).
  const travado = estaTravado(cenario);
  const soLe = (a: AbaDasConfiguracoes, oQue: string) =>
    !pode(a, "editar")
      ? `Seu perfil só lê ${oQue}.`
      : `Este cenário é de ${cenario.criadoPor ?? "outro usuário"}, com a Edição das Configurações Particular: só quem o criou (ou o Administrador) altera ${oQue}.`;
  const analitico = t.tipo === "ANALITICO";
  // Nos analíticos (21/11/2026, pedido do Adão), a aba Comparativo e Reajustes junta o Cenário Comparado, os Índices de Comparação
  // (antes, de Referência) e os Índices de Reajuste (antes, a aba Reajustes), cada quadro com a sua permissão: a aba aparece com uma
  // das três.
  const lerIndices = analitico && pode("indices");
  const lerReajustes = analitico && pode("reajustes");
  // As cópias dos cadastros dos analíticos (20/11/2026, Cadastros por cenário, etapas 1 e 2), depois da Referência.
  // Os Benefícios Padrão e as Regras de Rateio do cenário (21/11/2026, pedidos do Adão), logo depois de Centros de Custo.
  const abas = (["cenario", "referencia", ...(analitico ? ["unidades", "departamentos", "centros_custo", "beneficios", "regras_rateio", "redistribuicoes"] : []), "comparativo"] as AbaDasConfiguracoes[]).filter(
    (a) => pode(a) || (a === "comparativo" && (lerIndices || lerReajustes)),
  );
  // As abas Índices e Reajustes lembradas (ou num endereço) abrem o Comparativo (e Reajustes).
  const pedida = escolhida === "indices" || escolhida === "reajustes" ? "comparativo" : escolhida;
  const aba: AbaDasConfiguracoes | null = abas.includes(pedida) ? pedida : (abas[0] ?? null);
  // A marcação vale para os dois tipos (uma só por vez): o diálogo de marcar olha os sintéticos e os analíticos.
  const sinteticos = useQuery({ queryKey: ["cenarios", "SINTETICO"], queryFn: () => cenariosService.listar("SINTETICO") });
  const analiticos = useQuery({ queryKey: ["cenarios", "ANALITICO"], queryFn: () => cenariosService.listar("ANALITICO"), retry: false });
  const [nome, setNome] = useState(cenario.nome);
  const [descricao, setDescricao] = useState(cenario.descricao ?? "");
  const [visualizacao, setVisualizacao] = useState<Visualizacao>(cenario.visualizacao);
  const [edicao, setEdicao] = useState<Visualizacao>(cenario.edicaoConfiguracoes);
  const [acesso, setAcesso] = useState<AcessoInformacoes>(cenario.acessoInformacoes);

  const salvar = useMutation({
    mutationFn: () =>
      cenariosService.atualizar(cenario.id, { nome: nome.trim(), descricao: descricao.trim() || null, visualizacao, edicaoConfiguracoes: edicao, ...(analitico ? { acessoInformacoes: acesso } : {}) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cenarios"] });
      toast.success("Configurações gravadas.");
    },
  });
  const mudou =
    nome.trim() !== cenario.nome ||
    (descricao.trim() || null) !== cenario.descricao ||
    visualizacao !== cenario.visualizacao ||
    edicao !== cenario.edicaoConfiguracoes ||
    (analitico && acesso !== cenario.acessoInformacoes);
  // Sair com o nome, a descrição ou a visualização mudados e não gravados pergunta antes (13/10/2026).
  useAlteracoesPendentes(mudou && !salvar.isPending);

  return (
    <div className="space-y-6">
      <Abas
        rotulo="Configurações do cenário"
        ativa={aba ?? ""}
        onMudar={(a) => setAba(a as AbaDasConfiguracoes)}
        abas={[
          { chave: "cenario", rotulo: "Cenário" },
          { chave: "referencia", rotulo: "Referência" },
          { chave: "unidades", rotulo: "Unidades" },
          { chave: "departamentos", rotulo: "Departamentos" },
          { chave: "centros_custo", rotulo: "Centros de Custo" },
          { chave: "beneficios", rotulo: "Benefícios Padrão" },
          { chave: "regras_rateio", rotulo: "Regras de Rateio" },
          { chave: "redistribuicoes", rotulo: "Redistribuições de Gastos" },
          // O comparativo com outro cenário (13/10/2026; antes, a aba Referência da tela Comparativo); nos analíticos (21/11/2026),
          // com os reajustes.
          { chave: "comparativo", rotulo: analitico ? "Comparativo e Reajustes" : "Comparativo" },
        ].filter((a) => abas.includes(a.chave as AbaDasConfiguracoes))}
      />
      {aba === null ? (
        <p className="rounded-sm border border-gray-200 bg-white p-6 text-sm text-gray-600">Seu perfil não tem acesso a nenhuma aba desta tela.</p>
      ) : aba === "cenario" ? (
        <section className="space-y-4 rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white p-5">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
            <div className="space-y-1.5">
              <Label htmlFor="cfg-nome">Nome</Label>
              <Input
                id="cfg-nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                maxLength={120}
                disabled={cenario.nomeTravado || travado || !edita("cenario")}
                className="rounded-sm disabled:bg-gray-50 disabled:text-gray-700 disabled:opacity-100"
              />
              {/* Com revisões, o nome é o mesmo em todas as versões (13/10/2026), para comparar as versões. */}
              {cenario.nomeTravado ? <p className="text-xs text-gray-500">O cenário tem revisões: o nome é o mesmo em todas as versões e não muda.</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cfg-ano">Exercício</Label>
              <Input id="cfg-ano" value={String(cenario.ano)} readOnly className="rounded-sm bg-gray-50 text-gray-700" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="cfg-descricao">Descrição (opcional)</Label>
              <Input
                id="cfg-descricao"
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                maxLength={500}
                disabled={travado || !edita("cenario")}
                className="rounded-sm disabled:bg-gray-50 disabled:text-gray-700 disabled:opacity-100"
              />
            </div>
            <div className="sm:col-span-2">
              <CampoVisualizacao
                valor={visualizacao}
                onMudar={setVisualizacao}
                bloqueio={!cenario.podeMudarVisualizacao ? "Só quem criou o cenário ou um Administrador muda a visualização." : !edita("cenario") ? "Seu perfil só lê os dados do cenário." : null}
                semParticular={cenario.marcacao ? "Um cenário marcado fica público: tire a marcação antes de torná-lo particular." : null}
                emLinhas
              />
            </div>
            {/* O Compartilhar do cenário particular (21/11/2026, pedido do Adão): os usuários convidados a vê-lo. */}
            {cenario.visualizacao === "PARTICULAR" ? (
              <div className="sm:col-span-2">
                {visualizacao === "PARTICULAR" ? (
                  <CompartilharCenario id={cenario.id} />
                ) : (
                  <p className="rounded-sm border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">Com a visualização Pública, todos com acesso aos cenários veem o cenário: o Compartilhar vale só no particular.</p>
                )}
              </div>
            ) : visualizacao === "PARTICULAR" ? (
              <p className="rounded-sm border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 sm:col-span-2">Grave as configurações com a visualização Particular para compartilhar o cenário com outros usuários.</p>
            ) : null}
            {/* A Edição das Configurações (12/11/2026, pedido do Adão): quem altera esta tela, em todas as abas e ações. */}
            <fieldset className="space-y-1.5 sm:col-span-2" disabled={!cenario.podeMudarVisualizacao || !edita("cenario")}>
              <legend className="text-sm leading-none font-medium">Edição das Configurações</legend>
              <div className="space-y-2 pt-1.5">
                {(
                  [
                    ["PARTICULAR", "Particular", "Apenas quem criou o cenário e os Administradores alteram as Configurações (todas as abas e ações).", Lock],
                    ["PUBLICA", "Pública", `Todos os usuários com permissão de editar as Configurações dos ${t.titulo} as alteram (todas as abas e ações).`, Globe],
                  ] as const
                ).map(([v, rotulo, detalhe, Icone]) => (
                  <OpcaoEmLinha
                    key={v}
                    nome="edicao-configuracoes"
                    marcada={edicao === v}
                    onMarcar={() => setEdicao(v)}
                    rotulo={rotulo}
                    detalhe={detalhe}
                    Icone={Icone}
                    desabilitada={!cenario.podeMudarVisualizacao || !edita("cenario")}
                    dica={
                      !cenario.podeMudarVisualizacao
                        ? "Só quem criou o cenário ou um Administrador muda a Edição das Configurações."
                        : !edita("cenario")
                          ? "Seu perfil só lê os dados do cenário."
                          : undefined
                    }
                  />
                ))}
              </div>
            </fieldset>
            {/* O Acesso às Informações dos analíticos (12/11/2026, pedido do Adão): o que cada usuário vê das premissas e do histórico. */}
            {analitico ? (
              <fieldset className="space-y-1.5 sm:col-span-2" disabled={!cenario.podeMudarVisualizacao || !edita("cenario")}>
                <legend className="text-sm leading-none font-medium">Acesso às Informações</legend>
                <div className="space-y-2 pt-1.5">
                  {(
                    [
                      ["GERAL", "Geral", "Todos os usuários com acesso ao cenário veem todas as premissas e todo o histórico.", Eye],
                      [
                        "POR_RECORTE",
                        "Por Recorte",
                        "Quem tem recorte no perfil (Departamento ou Centros de Custo) vê só as premissas e o histórico do seu recorte; quem criou o cenário e os Administradores veem tudo.",
                        ListFilter,
                      ],
                    ] as const
                  ).map(([v, rotulo, detalhe, Icone]) => (
                    <OpcaoEmLinha
                      key={v}
                      nome="acesso-informacoes"
                      marcada={acesso === v}
                      onMarcar={() => setAcesso(v)}
                      rotulo={rotulo}
                      detalhe={detalhe}
                      Icone={Icone}
                      desabilitada={!cenario.podeMudarVisualizacao || !edita("cenario")}
                      dica={
                        !cenario.podeMudarVisualizacao
                          ? "Só quem criou o cenário ou um Administrador muda o Acesso às Informações."
                          : !edita("cenario")
                            ? "Seu perfil só lê os dados do cenário."
                            : undefined
                      }
                    />
                  ))}
                </div>
              </fieldset>
            ) : null}
          </div>
          {travado && edita("cenario") ? <AvisoMarcado cenario={cenario} oQue="o nome e a descrição" varios /> : null}
          <Erro erro={salvar.isError ? mensagemDeErro(salvar.error, "Não foi possível gravar as configurações.") : null} />
          {!edita("cenario") ? <p className="rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-2 text-sm text-gray-600">{soLe("cenario", "os dados do cenário")}</p> : (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" className="rounded-sm" onClick={() => setAcao("marcar")}>
              <Bookmark className="size-4" />
              Marcar Cenário
            </Button>
            {/* O cenário marcado não se exclui: o botão fica apagado, com o motivo na dica. */}
            <span title={cenario.marcacao ? `Marcado como ${rotuloMarcacao(cenario.marcacao)}: tire a marcação antes de excluir` : undefined}>
              <Button
                type="button"
                variant="outline"
                className="rounded-sm border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800"
                disabled={!!cenario.marcacao}
                onClick={() => setAcao("excluir")}
              >
                <Trash2 className="size-4" />
                Excluir Cenário
              </Button>
            </span>
            <Button type="button" className={`${botaoPrimario} ml-auto`} disabled={!nome.trim() || !mudou || salvar.isPending} onClick={() => salvar.mutate()}>
              {salvar.isPending ? "Gravando…" : "Gravar Configurações"}
            </Button>
          </div>
          )}
        </section>
      ) : aba === "comparativo" && analitico ? (
        // A aba Comparativo e Reajustes dos analíticos (21/11/2026, pedido do Adão): o Cenário Comparado, os Índices de Comparação e,
        // abaixo deles, os Índices de Reajuste, cada quadro com a sua permissão e os avisos de quem só lê.
        <div className="space-y-8">
          {(
            [
              ["comparativo", "o cenário comparado"],
              ["indices", "os Índices de Comparação"],
              ["reajustes", "os Índices de Reajuste"],
            ] as const
          ).some(([a]) => pode(a) && !edita(a)) ? (
            <div className="space-y-2">
              {(
                [
                  ["comparativo", "o cenário comparado"],
                  ["indices", "os Índices de Comparação"],
                  ["reajustes", "os Índices de Reajuste"],
                ] as const
              )
                .filter(([a]) => pode(a) && !edita(a))
                .map(([a, oQue]) => (
                  <p key={a} className="rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-2 text-sm text-gray-600">
                    {soLe(a, oQue)}
                  </p>
                ))}
            </div>
          ) : null}
          {travado && (edita("comparativo") || edita("indices") || edita("reajustes")) ? <AvisoMarcado cenario={cenario} oQue="o comparativo e os índices" varios /> : null}
          {pode("comparativo") ? <CenarioComparado id={cenario.id} podeEditar={edita("comparativo") && !travado} /> : null}
          {lerIndices ? <IndicesDeComparacao id={cenario.id} podeEditar={edita("indices") && !travado} /> : null}
          {lerReajustes ? <IndicesDeReajuste id={cenario.id} podeEditar={edita("reajustes") && !travado} /> : null}
        </div>
      ) : aba === "comparativo" ? (
        <div className="space-y-4">
          {!edita("comparativo") ? (
            <p className="rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-2 text-sm text-gray-600">{soLe("comparativo", "o comparativo")}</p>
          ) : travado ? (
            <AvisoMarcado cenario={cenario} oQue="o comparativo" />
          ) : null}
          <ComparativoCenario id={cenario.id} podeEditar={edita("comparativo") && !travado} />
        </div>
      ) : aba in DOS_CADASTROS ? (
        // As cópias dos cadastros do cenário (20/11/2026, Cadastros por cenário): Unidades, Departamentos, Centros de Custo e
        // Redistribuições de Gastos.
        <div className="space-y-4">
          {!edita(aba) ? (
            <p className="rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-2 text-sm text-gray-600">
              {soLe(aba, `${DOS_CADASTROS[aba as keyof typeof DOS_CADASTROS]} do cenário`)}
            </p>
          ) : travado ? (
            <AvisoMarcado cenario={cenario} oQue={DOS_CADASTROS[aba as keyof typeof DOS_CADASTROS]} varios />
          ) : null}
          {aba === "unidades" ? (
            <UnidadesDoCenarioAba id={cenario.id} podeEditar={edita(aba) && !travado} />
          ) : aba === "departamentos" ? (
            <DepartamentosDoCenarioAba id={cenario.id} podeEditar={edita(aba) && !travado} />
          ) : aba === "centros_custo" ? (
            <CentrosDoCadastroDoCenarioAba id={cenario.id} podeEditar={edita(aba) && !travado} />
          ) : aba === "beneficios" ? (
            <BeneficiosDoCenarioAba id={cenario.id} podeEditar={edita(aba) && !travado} />
          ) : aba === "regras_rateio" ? (
            <RegrasDoCenarioAba id={cenario.id} podeEditar={edita(aba) && !travado} />
          ) : (
            <RedistribuicoesDoCenarioAba id={cenario.id} podeEditar={edita(aba) && !travado} />
          )}
        </div>
      ) : analitico ? (
        // A referência dos analíticos (14/10/2026): o realizado (com as Médias de Referência e os centros de custo) ou outro analítico.
        <ReferenciaAnalitica cenario={cenario} podeEditar={edita("referencia")} aviso={soLe("referencia", "a referência")} />
      ) : (
        <ReferenciaSintetica cenario={cenario} podeEditar={edita("referencia")} aviso={soLe("referencia", "a referência")} />
      )}

      {acao === "marcar" ? <MarcarCenarioDialog cenario={cenario} cenarios={[...(sinteticos.data ?? []), ...(analiticos.data ?? [])]} onFechar={() => setAcao(null)} /> : null}
      {acao === "excluir" ? <ExcluirCenarioDialog cenario={cenario} onFechar={() => setAcao(null)} aoExcluir={() => router.push(t.base)} /> : null}
    </div>
  );
}
