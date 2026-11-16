"use client";

import { useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { useAbaLembrada } from "@/hooks/useAbaLembrada";
import { CabecalhoDaTela } from "@/components/shared/CabecalhoDaTela";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/context/PermissionContext";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";

import { MESES } from "@/app/competencias/[anoMes]/utils/formatacao";
import { LegendaRealizadoOrcado, RotulosDoGrafico, SeletorRotulos, SeletorTipoGrafico, useRotulosDosValores, useTipoGrafico } from "@/app/relatorios/components/GraficoRealizadoOrcado";
import { Seletor } from "@/app/relatorios/components/SeletorPeriodo";
import { AVISO_DO_PAINEL, CorpoDoPainel, EtiquetaDoComparado, LegendaDoPainel, useCoresDoPainel } from "@/app/relatorios/painel/PainelContent";
import { ConfigurarGraficos } from "@/app/relatorios/components/ConfigurarGraficos";
import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";

import { cenariosService } from "../../../services/cenariosService";
import { IndicadoresDoCenario, useAbasDosIndicadoresDoCenario } from "../indicadores/CenarioIndicadoresContent";
import { useTipoDoCenario } from "../../../components/tipoDoCenario";

const ROTULOS = { realizado: "Cenário", orcado: "Comparado" };

/**
 * O Painel de Bordo de um cenário sintético (13/10/2026), como o de Resultados Empresariais: as abas Resultados e
 * Performance, com o cenário no lugar do realizado e o cenário comparado (Configurações / Comparativo) no lugar do
 * orçado. O mês de referência começa em dezembro (o cenário se olha nos 12 meses).
 */
export function CenarioPainelContent() {
  const { id } = useParams<{ id: string }>();
  const t = useTipoDoCenario();
  useRegistrarAcessoTela(`${t.base}/${id}/painel`);
  const { hasPermission } = usePermissions();
  const [ate, setAte] = useState(12);
  // A aba Indicadores, depois de Performance (19/10/2026; antes, a tela Indicadores), se o perfil a lê.
  const abasDosIndicadores = useAbasDosIndicadoresDoCenario();
  // A aba pedida no endereço (?aba=indicadores, o endereço antigo da tela Indicadores: a primeira delas).
  const pedida = useSearchParams().get("aba");
  const [aba, setAba] = useAbaLembrada("aba", pedida === "indicadores" ? (abasDosIndicadores[0]?.chave ?? "resultados") : (pedida ?? "resultados"));
  const analitico = t.tipo === "ANALITICO";
  const router = useRouter();
  const [tipoGrafico, setTipoGrafico] = useTipoGrafico();
  const [comRotulos, setComRotulos] = useRotulosDosValores();
  const [cores] = useCoresDoPainel();
  const consulta = useQuery({ queryKey: ["cenarios", id, "painel", ate], queryFn: () => cenariosService.painel(id, ate) });
  const dados = consulta.data;
  return (
    <div className="space-y-6">
      <CabecalhoDaTela
        titulo="Painel de Bordo"
        comoUsar={
          <ul>
            <li>
              Em “Configurar Gráficos”, à direita do título, escolha o Período (o mês de referência; o acumulado vai de janeiro até ele), os Rótulos
              (Com: os valores de cada mês escritos nos gráficos, o cenário por cima do comparado) e o Tipo dos gráficos (guardados neste navegador,
              os mesmos do Painel de Bordo de Resultados Empresariais). As legendas (as cores das séries e os sinais)
              ficam antes do botão.
            </li>
            <li>
              Troque entre as abas Resultados e Performance (os unitários) e Indicadores. Aparecem só as abas que o seu
              perfil lê (Controle de Usuários / Perfis).
            </li>
            <li>
              Na aba Indicadores, todos os indicadores do cenário mês a mês e acumulados, com a coluna Comparado Acum. (o acumulado do cenário
              comparado): os que saem da DRE do cenário e os Indicadores Manuais (os quadros de lotação e os do Comercial e do Administrativo, que
              se digitam {analitico ? "na tela Premissas, aba Indicadores Manuais" : "na tela Resultados, aba Indicadores Manuais"}), com as
              eficiências calculadas e os importados. É o orçado de Resultados Empresariais quando o cenário é o marcado como Orçamento. Clique num
              indicador para ver o gráfico dele (o cenário e o comparado), no Tipo e com os Rótulos do Configurar Gráficos daqui.
            </li>
            <li>Os itens (os cards), os quadros e a ordem deles vêm do cadastro Cadastros Gerais / Analítico / Painel de Bordo: nome, comportamento, grupo, quadro, Metodologia e formato.</li>
            <li>
              Cada card traz o nome e, à direita dele, a Metodologia (a fórmula do item) e o comportamento entre parênteses (o mês de referência
              fica ao lado do nome do grupo); embaixo, o Atual, do mês de referência, e o Acumulado, com a unidade no rótulo (Atual (R$ M)…),
              cada um com o valor em destaque e, à direita, o destaque do desvio — a
              variação, “vs. Comparado” e o valor do cenário comparado, num quadro cinza com uma faixa na cor do sinal à direita; e os gráficos dos meses e do acumulado (o cenário em amarelo-ouro, o comparado em preto).
            </li>
            <li>
              Com os Rótulos, o valor do cenário fica à esquerda do centro de cada mês (e do acumulado) e o do comparado à direita, e os gráficos
              ficam sem as linhas da escala (só a do zero). As cores dos sinais seguem a Acessibilidade, no menu do usuário: Padrão (verde,
              amarelo e vermelho) ou Daltonismo (azul no lugar do verde, para quem não distingue o verde do vermelho).
            </li>
            <li>
              O botão ao lado do nome de cada grupo copia o grupo inteiro (o nome e os cards) como imagem, para colar num e-mail ou numa
              apresentação; o botão seguinte (o mesmo ícone, com um asterisco: “Copiar o grupo como imagem (sem gráficos)”) copia
              só os valores dos cards, com a borda
              de cada um. Se o navegador não deixar copiar, a imagem é baixada.
            </li>
            <li>
              O comparado é o cenário escolhido em Configurações / Comparativo; sem ele, essa parte fica vazia (—), e o aviso traz o botão
              “Adicionar Comparativo” (para quem edita a aba Comparativo das Configurações).
            </li>
            <li>Sem os Rótulos, a escala à esquerda de cada gráfico usa marcas práticas, sem casas decimais: múltiplos de 1, 2, 5, 10, 25, 50, 100, 250, 500, 1.000… (ou 0,1, 0,2, 0,5 quando os valores são pequenos), na unidade do card (milhões, milhares, %, m³…).</li>
          </ul>
        }
        sobre={
          <>
            <p>
              O Painel de Bordo do cenário: os mesmos quadros do Painel de Bordo de Resultados Empresariais, com os indicadores do cenário (os da aba
              Indicadores: os que saem da DRE do cenário, os lançamentos manuais e os importados) no lugar do realizado, e os do cenário comparado
              no lugar do orçado.
            </p>
            <p>
              O desvio (vs. Comparado) é o valor do cenário sobre o do comparado, menos 1. A faixa à direita do destaque e o ícone ficam verdes (azuis, com a
              Acessibilidade Daltonismo), com um triângulo para cima, quando o cenário está do lado bom do comparado; vermelhos, com um triângulo para
              baixo, do lado ruim; e amarelos, com um quadrado, quando o desvio é de até 5%; o lado bom depende do sentido do
              indicador (↑ ou ↓).
            </p>
          </>
        }
        acoes={
          // As legendas e o botão Configurar Gráficos, com as listas no modal (14/10/2026).
          <div className="flex flex-wrap items-center justify-end gap-4">
            <RotulosDoGrafico.Provider value={ROTULOS}>
              {/* Nas abas dos indicadores, só as cores das séries (os sinais são dos cards). */}
              {abasDosIndicadores.some((x) => x.chave === aba) ? (
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-gray-600">
                  <LegendaRealizadoOrcado tipo={tipoGrafico} />
                  <EtiquetaDoComparado nome={dados?.comparado?.nome} />
                </div>
              ) : (
                <LegendaDoPainel tipo={tipoGrafico} cores={cores} comparado={dados?.comparado?.nome} />
              )}
            </RotulosDoGrafico.Provider>
            <ConfigurarGraficos>
              <Seletor rotulo="Período" valor={String(ate)} onMudar={(v) => setAte(Number(v))} largura="w-36" opcoes={MESES.map((m, k) => ({ valor: String(k + 1), rotulo: m }))} />
              <SeletorRotulos com={comRotulos} onMudar={setComRotulos} />
              <SeletorTipoGrafico tipo={tipoGrafico} onMudar={setTipoGrafico} />
            </ConfigurarGraficos>
          </div>
        }
      />
      {consulta.isError ? (
        <div className="rounded-sm border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{mensagemDeErro(consulta.error, "Erro ao carregar o painel do cenário.")}</p>
        </div>
      ) : !dados ? (
        <div className="h-64 animate-pulse rounded-sm bg-gray-100" />
      ) : (
        <RotulosDoGrafico.Provider value={ROTULOS}>
          <CorpoDoPainel
            dados={dados}
            aba={aba}
            onAba={setAba}
            tipo={tipoGrafico}
            cores={cores}
            comRotulos={comRotulos}
            extras={abasDosIndicadores.map((a) => ({
              chave: a.chave,
              rotulo: a.rotulo,
              conteudo: <IndicadoresDoCenario key={a.chave} id={id} aba={a.chave} tipo={tipoGrafico} comRotulos={comRotulos} />,
            }))}
            aviso={
              // Sem comparativo (13/10/2026): o quadro comum, com o destaque vermelho à esquerda e o botão Adicionar Comparativo.
              dados.comparado ? null : (
                <div className={`${AVISO_DO_PAINEL} flex flex-wrap items-center justify-between gap-3`}>
                  <span>O cenário não tem comparativo: o comparado e o desvio ficam vazios.</span>
                  {hasPermission(t.perm("configuracoes", "editar", "comparativo")) ? (
                    <Button type="button" variant="outline" className="rounded-sm" onClick={() => router.push(`${t.base}/${id}/configuracoes?aba=comparativo`)}>
                      Adicionar Comparativo
                    </Button>
                  ) : (
                    <span className="text-gray-500">Peça a quem edita a aba Comparativo para escolher um em Configurações / Comparativo.</span>
                  )}
                </div>
              )
            }
          />
        </RotulosDoGrafico.Provider>
      )}
    </div>
  );
}
