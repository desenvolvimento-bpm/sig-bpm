"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChartColumn } from "lucide-react";

import { CabecalhoDaTela } from "@/components/shared/CabecalhoDaTela";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";

import { ConfigurarGraficos } from "../components/ConfigurarGraficos";
import { ExportarRelatorio } from "../components/ExportarRelatorio";
import { LegendaRealizadoOrcado, SeletorRotulos, SeletorTipoGrafico, useRotulosDosValores, useTipoGrafico } from "../components/GraficoRealizadoOrcado";
import { Seletor, useExercicios } from "../components/SeletorPeriodo";
import { MESES } from "../../competencias/[anoMes]/utils/formatacao";
import { mensagemDeErro, relatoriosService, type Indicador } from "../services/relatoriosService";
import { GraficoIndicadorDialog } from "./GraficoIndicadorDialog";
import { TabelaIndicadores, valor, valorCurto } from "./TabelaIndicadores";

/**
 * A tela Indicadores (Resultados Empresariais), com o exercício e o mês
 * escolhidos no topo; ou, com `periodoFixo`, a etapa Indicadores do
 * Fechamento Mensal: só os valores do mês da competência, que se troca na
 * barra de etapas.
 */
export function IndicadoresContent({ periodoFixo }: { periodoFixo?: { ano: number; mes: number } } = {}) {
  useRegistrarAcessoTela(
    periodoFixo ? `/competencias/${periodoFixo.ano}-${String(periodoFixo.mes).padStart(2, "0")}/indicadores` : "/relatorios/indicadores",
  );
  const exercicios = useExercicios(!periodoFixo);
  const [anoEscolhido, setAno] = useState<number | null>(null);
  const [ateEscolhido, setAte] = useState<number | null>(null);
  const ano = periodoFixo?.ano ?? anoEscolhido ?? exercicios.anos[0];
  const meses = ano ? exercicios.mesesDe(ano) : [];
  const ate = periodoFixo ? periodoFixo.mes : ateEscolhido && meses.includes(ateEscolhido) ? ateEscolhido : meses[meses.length - 1];
  const consulta = useQuery({
    queryKey: ["relatorios", "indicadores", ano, ate],
    queryFn: () => relatoriosService.indicadores(ano!, ate, !!periodoFixo),
    enabled: !!ano && !!ate,
  });
  const dados = consulta.data;
  // O indicador com o gráfico aberto (só em Resultados Empresariais; a etapa do Fechamento Mensal mostra um mês só).
  const [comGrafico, setComGrafico] = useState<Indicador | null>(null);
  const abreGrafico = !periodoFixo;
  // O tipo do gráfico do indicador (Barras ou Área), o mesmo do Painel de Bordo.
  const [tipoGrafico, setTipoGrafico] = useTipoGrafico();
  // Os rótulos dos valores no gráfico (Com ou Sem, 13/10/2026), os mesmos do Painel de Bordo.
  const [comRotulos, setComRotulos] = useRotulosDosValores();

  return (
    <div className="space-y-6">
      <CabecalhoDaTela
        titulo="Indicadores"
        comoUsar={
          <ul>
            {periodoFixo ? <li>A tela Totais tem duas abas: Indicadores (esta, com os indicadores gerenciais do mês) e Rateios (os percentuais de cada chave de rateio).</li> : null}
            <li>
              {periodoFixo
                ? "Os valores do mês desta competência; troque o mês no seletor da barra de etapas. Num mês não apurado, os indicadores da DRE ficam sem valor."
                : "Em “Configurar Gráficos”, à direita do título, escolha o Exercício e o mês até onde ver (só as competências fechadas aparecem; os meses abertos ou em conferência ficam de fora), os Rótulos e o Tipo do gráfico do indicador; cada escolha vale na hora. A legenda (Realizado e Orçado) fica antes do botão."}
            </li>
            <li>Na lista antes do rótulo Indicador (a seta), escolha Todos os Grupos ou um grupo (Produção, Serviços, Logística, Técnico, Comercial, Administrativo, Geral, Metas Estratégicas (GME)), como a lista dos níveis em Resultados.</li>
            <li>Use os filtros nos rótulos das colunas para escolher indicadores ou ordenar por um valor.</li>
            <li>Os indicadores sem numeração (os totais, como Custos de Produção: Matriz) ficam com a cor da faixa do grupo, e os de numeração par num tom mais fraco (amarelo nas colunas do realizado, cinza nas do orçado), para ajudar a seguir a linha.</li>
            {periodoFixo ? null : (
              <li>As colunas de rótulo preto trazem o orçado (o cenário marcado como Orçamento, ou o escolhido na Comparação; zero sem ele): o do último mês, depois dele, e o acumulado, depois do Acumulado.</li>
            )}
            <li>As colunas Indicador, Sent. e Und. ficam fixas à esquerda; ao rolar a página, os rótulos ficam presos logo abaixo do título, como em Resultados, e a barra de rolagem lateral fica no pé da janela.</li>
            <li>Passe o mouse sobre a seta do sentido para ver se o indicador é melhor quanto maior ou quanto menor.</li>
            {periodoFixo ? null : (
              <>
              <li>Clique num indicador para abrir o gráfico dele: os meses do exercício até o escolhido, com o realizado em amarelo-ouro e o orçado (do cenário marcado como Orçamento, ou do escolhido na Comparação) em preto, como no Painel de Bordo, e, depois do último mês, o gráfico do acumulado (ACUM.); a descrição do indicador (a metodologia, a unidade e o comportamento) fica na linha da legenda. O botão ao lado do nome copia o modal (o nome, os valores e o gráfico) como imagem, para colar num e-mail ou numa apresentação; se o navegador não deixar copiar, a imagem é baixada.</li>
              <li>No Tipo, escolha Barras (colunas do realizado e do orçado) ou Área (o realizado numa área amarela, transparente no zero e forte no máximo do período, com o contorno em amarelo-ouro, e o orçado numa linha preta). A escolha vale também para o Painel de Bordo e fica guardada neste navegador.</li>
              <li>Nos Rótulos, Com escreve os valores de cada mês no gráfico, na vertical, só com o número (o realizado à esquerda do centro do mês, o orçado à direita); Sem mostra a escala à esquerda. Como no Painel de Bordo, a escolha vale para os dois e fica guardada neste navegador.</li>
              </>
            )}
            <li>Use “Exportar” para baixar em Excel ou PDF (A4 deitada).</li>
          </ul>
        }
        sobre={
          <>
            <p>
              Os indicadores gerenciais do exercício, {periodoFixo ? "no mês da competência" : "mês a mês e acumulados"}, na ordem e com os nomes do
              cadastro. O catálogo — grupo, numeração, nome, comportamento, unidade, a fórmula de cada indicador e a forma do acumulado — fica em Cadastros Gerais / Analítico / Indicadores, onde se edita.
            </p>
            <p>
              Os valores saem da DRE apurada (congelada) de cada competência{periodoFixo ? "" : " fechada (as abertas e em conferência não entram em Resultados Empresariais)"}, dos volumes da apuração (projetos liberados) e dos indicadores
              importados no fechamento: os do Administrativo — quadro de lotação, fluxo de caixa, inadimplência, turnover, vagas e acidentes — e
              os do Comercial — vendas, receita vendida, margem, demanda e mix. O acumulado soma os meses ou, nos indicadores de razão (%, R$/m³,
              eficiências, margem das vendas, turnover), é a média ponderada. Os de posição (quadro de lotação, inadimplência, vagas) valem o último mês.
            </p>
            <p>
              Nas Metas Estratégicas (GME), a Média Móvel da Demanda Gerada e a da Demanda Expedida (GME 4) dividem a demanda e a expedição do mês
              pela capacidade de produção, que é a meta de Produção (Vol.): Total do mês; o Atingimento do FCOL e o da MC (GME 8) dividem o
              realizado de janeiro até o mês pelo orçado do mesmo período, e o acumulado é o do
              último mês.
            </p>
            <p>
              O orçado (o gráfico do indicador) vem das Metas do cenário marcado como Orçamento (Criação de
              Cenários / Cenários Sintéticos){dados?.cenarioOrcado ? ` — hoje, ${dados.cenarioOrcado}` : ""}. Sem cenário marcado no
              exercício, ou sem o valor no cenário, o orçado é zero.
            </p>
            <p>
              Os indicadores numerados do Comercial e do Administrativo também podem ser digitados nas Listas Operacionais (abas Comercial e
              Administrativo): o valor digitado substitui o importado até uma nova importação. Um indicador importado fica sem valor no
              mês em que não foi importado nem digitado.
            </p>
          </>
        }
        acoes={
          ano && ate ? (
            <div className="flex flex-wrap items-center justify-end gap-4">
              {/* A legenda e o botão Configurar Gráficos, com as listas no modal (14/10/2026; antes, as listas na linha do título). */}
              {abreGrafico ? (
                <>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-gray-600">
                    <LegendaRealizadoOrcado tipo={tipoGrafico} />
                  </div>
                  <ConfigurarGraficos>
                    <Seletor
                      rotulo="Exercício"
                      valor={String(ano)}
                      onMudar={(v) => {
                        setAno(Number(v));
                        setAte(null);
                      }}
                      largura="w-36"
                      opcoes={exercicios.anos.map((a) => ({ valor: String(a), rotulo: String(a) }))}
                    />
                    <Seletor rotulo="Até o Mês" valor={String(ate)} onMudar={(v) => setAte(Number(v))} largura="w-36" opcoes={meses.map((m) => ({ valor: String(m), rotulo: MESES[m - 1] }))} />
                    <SeletorRotulos com={comRotulos} onMudar={setComRotulos} />
                    <SeletorTipoGrafico tipo={tipoGrafico} onMudar={setTipoGrafico} />
                  </ConfigurarGraficos>
                </>
              ) : null}
              <ExportarRelatorio
                caminho="indicadores"
                padrao={periodoFixo ? `Indicadores ${ano}-${String(ate).padStart(2, "0")}` : `Indicadores ${ano}`}
                opcoes={[
                  {
                    chave: "todos",
                    excel: "Todos os Indicadores",
                    pdf: "Todos os Indicadores",
                    params: periodoFixo ? { ano, ate, escopo: "mes", etapa: 1 } : { ano, ate },
                  },
                ]}
              />
            </div>
          ) : null
        }
      />

      {!periodoFixo && exercicios.carregando ? (
        <div className="h-64 animate-pulse rounded-sm bg-gray-100" />
      ) : !ano || !ate ? (
        <p className="rounded-sm border border-gray-200 bg-white p-6 text-sm text-gray-600">{periodoFixo ? "Nenhuma competência apurada ainda." : "Nenhuma competência fechada ainda."}</p>
      ) : consulta.isError ? (
        <div className="rounded-sm border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{mensagemDeErro(consulta.error, "Erro ao carregar os indicadores.")}</p>
        </div>
      ) : !dados ? (
        <div className="h-64 animate-pulse rounded-sm bg-gray-100" />
      ) : (
        <>
          <TabelaIndicadores
            meses={dados.meses}
            indicadores={dados.indicadores}
            soUltimoMes={!!periodoFixo}
            onClicar={abreGrafico ? setComGrafico : undefined}
            dicaDoClique="Ver o gráfico do indicador"
            iconeDoClique={abreGrafico ? ChartColumn : undefined}
            comOrcado={!periodoFixo}
            rotuloDoOrcado={dados.rotuloComparado}
          />
          {comGrafico ? (
            <GraficoIndicadorDialog
              indicador={comGrafico}
              meses={dados.meses}
              formatar={(v) => valor(comGrafico, v)}
              formatarCurto={(v) => valorCurto(comGrafico, v)}
              tipo={tipoGrafico}
              comRotulos={comRotulos}
              onFechar={() => setComGrafico(null)}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
