"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useAbaLembrada } from "@/hooks/useAbaLembrada";
import { Abas } from "@/components/shared/Abas";
import { usePermissions } from "@/context/PermissionContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { useAlteracoesPendentes } from "@/lib/alteracoesPendentes";

import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";

import { cenariosService, rotuloMarcacao, type Cenario, type Visualizacao } from "../services/cenariosService";
import { useTipoDoCenario } from "./tipoDoCenario";
import { AvisoMarcado, estaTravado } from "./AvisoMarcado";
import { botaoPrimario, CampoVisualizacao, Erro, ExcluirCenarioDialog } from "./CenarioDialog";
import { ComparativoCenario } from "./ComparativoCenario";
import { IndicesCenario } from "./IndicesCenario";
import { MarcarCenarioDialog } from "./MarcarCenarioDialog";
import { ReferenciaAnalitica } from "./ReferenciaAnalitica";
import { ReferenciaSintetica } from "./ReferenciaSintetica";
import { IndicadoresDoCenario } from "../sinteticos/[id]/indicadores/CenarioIndicadoresContent";
import { useRotulosDosValores, useTipoGrafico } from "@/app/relatorios/components/GraficoRealizadoOrcado";

/**
 * As configurações do cenário, em duas abas (12/10/2026; antes, dois quadros lado a lado): Cenário (nome, descrição,
 * visualização) e Referência (nos sintéticos, um arquivo ou até duas referências de cenários e realizados; nos analíticos, o
 * resultado realizado ou outro analítico). Os quadros ocupam a largura da tela, com o
 * destaque amarelo-ouro à esquerda, e as opções ficam uma embaixo da outra, com o texto ao lado (13/10/2026).
 */
export type AbaDasConfiguracoes = "cenario" | "referencia" | "indices" | "comparativo" | "manuais";

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
  // Só quem criou o cenário (ou o Administrador) altera as Configurações (14/10/2026): num cenário público, os demais as
  // leem. O servidor recusa do mesmo jeito.
  const dono = cenario.podeMudarVisualizacao;
  const edita = (a: AbaDasConfiguracoes) => dono && pode(a, "editar");
  // O cenário travado (marcado ou com a versão congelada): o nome, a descrição e o comparativo não mudam (14/10/2026).
  const travado = estaTravado(cenario);
  const soLe = (a: AbaDasConfiguracoes, oQue: string) =>
    !pode(a, "editar") ? `Seu perfil só lê ${oQue}.` : `Este cenário é de ${cenario.criadoPor ?? "outro usuário"}: só quem o criou (ou o Administrador) altera ${oQue}.`;
  const analitico = t.tipo === "ANALITICO";
  // Os Indicadores Manuais, só nos sintéticos (19/10/2026; antes, no Painel de Bordo; nos analíticos, ficam nas Premissas).
  // Os Índices de Referência dos analíticos (11/11/2026, pedido do Adão; antes, a aba Índices) são o quadro do meio da aba
  // Comparativo, com a permissão deles: a aba aparece com uma das duas.
  const lerIndices = analitico && pode("indices");
  const abas = (["cenario", "referencia", "comparativo", ...(analitico ? [] : ["manuais"])] as AbaDasConfiguracoes[]).filter((a) => pode(a) || (a === "comparativo" && lerIndices));
  // A aba Índices lembrada (ou num endereço) abre o Comparativo.
  const pedida = escolhida === "indices" ? "comparativo" : escolhida;
  const aba: AbaDasConfiguracoes | null = abas.includes(pedida) ? pedida : (abas[0] ?? null);
  // O Tipo e os Rótulos do gráfico do indicador, os do Painel de Bordo.
  const [tipoGrafico] = useTipoGrafico();
  const [comRotulos] = useRotulosDosValores();
  // A marcação vale para os dois tipos (uma só por vez): o diálogo de marcar olha os sintéticos e os analíticos.
  const sinteticos = useQuery({ queryKey: ["cenarios", "SINTETICO"], queryFn: () => cenariosService.listar("SINTETICO") });
  const analiticos = useQuery({ queryKey: ["cenarios", "ANALITICO"], queryFn: () => cenariosService.listar("ANALITICO"), retry: false });
  const [nome, setNome] = useState(cenario.nome);
  const [descricao, setDescricao] = useState(cenario.descricao ?? "");
  const [visualizacao, setVisualizacao] = useState<Visualizacao>(cenario.visualizacao);

  const salvar = useMutation({
    mutationFn: () => cenariosService.atualizar(cenario.id, { nome: nome.trim(), descricao: descricao.trim() || null, visualizacao }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cenarios"] });
      toast.success("Configurações gravadas.");
    },
  });
  const mudou = nome.trim() !== cenario.nome || (descricao.trim() || null) !== cenario.descricao || visualizacao !== cenario.visualizacao;
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
          // O comparativo com outro cenário (13/10/2026; antes, a aba Referência da tela Comparativo).
          { chave: "comparativo", rotulo: "Comparativo" },
          { chave: "manuais", rotulo: "Indicadores Manuais" },
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
      ) : aba === "comparativo" ? (
        <div className="space-y-4">
          {/* Os avisos de quem só lê: o comparativo e, nos analíticos, os Índices de Referência (cada um com a sua permissão). */}
          {pode("comparativo") && !edita("comparativo") ? (
            <p className="rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-2 text-sm text-gray-600">{soLe("comparativo", "o comparativo")}</p>
          ) : null}
          {lerIndices && !edita("indices") ? (
            <p className="rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-2 text-sm text-gray-600">{soLe("indices", "os Índices de Referência")}</p>
          ) : null}
          {travado && (edita("comparativo") || (lerIndices && edita("indices"))) ? <AvisoMarcado cenario={cenario} oQue={analitico ? "o comparativo e os índices" : "o comparativo"} varios={analitico} /> : null}
          {pode("comparativo") ? (
            <ComparativoCenario
              id={cenario.id}
              podeEditar={edita("comparativo") && !travado}
              // Nos analíticos (11/11/2026), os Índices de Referência entre o Cenário Comparado e as Variações Máximas.
              indices={lerIndices ? <IndicesCenario id={cenario.id} podeEditar={edita("indices") && !travado} /> : null}
            />
          ) : (
            <IndicesCenario id={cenario.id} podeEditar={edita("indices") && !travado} />
          )}
        </div>
      ) : aba === "manuais" ? (
        <IndicadoresDoCenario id={cenario.id} aba="manuais" tipo={tipoGrafico} comRotulos={comRotulos} />
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
