"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { CabecalhoDaTela } from "@/components/shared/CabecalhoDaTela";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";

import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";

import { Erro } from "../../../components/CenarioDialog";
import { ConfiguracoesCenario, type AbaDasConfiguracoes } from "../../../components/ConfiguracoesCenario";
import { cenariosService } from "../../../services/cenariosService";
import { useTipoDoCenario } from "../../../components/tipoDoCenario";

/** A tela Configurações de um cenário (12/10/2026; antes, a primeira aba da tela Editar, que deixou de existir). */
export function ConfiguracoesContent() {
  const { id } = useParams<{ id: string }>();
  const t = useTipoDoCenario();
  useRegistrarAcessoTela(`${t.base}/${id}/configuracoes`);
  const cenario = useQuery({ queryKey: ["cenarios", id], queryFn: () => cenariosService.obter(id) });
  // ?aba=comparativo (ou referencia) abre direto na aba: os avisos do comparativo levam para cá.
  const pedida = useSearchParams().get("aba");
  const abaInicial: AbaDasConfiguracoes = pedida === "comparativo" || pedida === "referencia" || pedida === "indices" || pedida === "reajustes" ? pedida : "cenario";
  const analitico = t.tipo === "ANALITICO";
  return (
    <div className="space-y-6">
      <CabecalhoDaTela
        titulo="Configurações"
        comoUsar={
          <ul>
            <li>Na aba Cenário, mude o nome, a descrição, a visualização (Particular ou Pública) e a Edição das Configurações (Particular: só quem criou o cenário e os Administradores alteram esta tela; Pública: todos com permissão de editar as Configurações) e clique em “Gravar Configurações”; a visualização e a Edição das Configurações só mudam por quem criou o cenário ou pelo Administrador. Depois da primeira revisão, o nome fica travado: é o mesmo em todas as versões do cenário. Com o cenário marcado ou com a versão congelada, o nome e a descrição não mudam (a visualização, sim).</li>
            <li>
              Também na aba Cenário: “Marcar Cenário” marca o cenário como Orçamento, Anterior, Vendido ou Forecast (cada
              marcação fica ativa em um cenário só: marcar este tira a do anterior), e “Excluir Cenário” o exclui (um cenário marcado não se exclui).
            </li>
            {analitico ? (
              <>
                <li>
                  Na aba Referência (opcional): carregue o resultado realizado das competências fechadas de um exercício (Média do Período ou Mês a
                  Mês) ou outro cenário analítico. O realizado traz só as Médias de Referência — das premissas, dos centros de custo, da depreciação base, do
                  extra-operacional e dos indicadores manuais —, com os meses do cenário em branco (no Mês a Mês, também
                  cada mês fechado no seu mês, menos nas premissas das unidades); use “Replicar Médias”, aqui na Referência, depois do “Realocar”, para levar as médias aos
                  meses (“Apagar Valores”, ao lado, deixa os doze meses de todas as abas das premissas em branco; os dois pedem editar todas as
                  abas das premissas e confirmam antes de gravar). Outro analítico traz as premissas, os centros, os investimentos e os indicadores dele. A média de cada conta dos centros de
                  custo divide a soma do período só pelos meses em que a conta teve movimentação. Os avisos do que não coube aparecem embaixo. Marque
                  “Manter os Valores dos Meses” para trocar só as Médias de Referência: os doze meses do cenário (digitados ou importados), os
                  investimentos e as linhas do Quadro de Lotação ficam, e o Justificar? do Exportar Premissas passa a comparar os meses com as médias
                  novas; desmarcada, a referência substitui também os meses (os valores digitados se perdem). Os colaboradores do cenário vêm só da aba Quadro de Lotação das
                  Premissas, alimentada pela Gestão de Colaboradores: no realizado, marque “Importar Quadro de Lotação Vigente” para trocar as linhas
                  dela pelas do Quadro de Lotação mais recente da Gestão de Colaboradores (os colaboradores do fim da competência mais recente, em todos
                  os meses), qualquer que seja o período (De / Até); os salários das linhas que o cenário já tinha ficam. Com os reajustes aplicados na DRE
                  (Premissas / Reajustes), a referência não se carrega nem se realoca, com o aviso na aba: use “Remover Reajustes” antes.
                </li>
                <li>A Correspondência Tarefa × Linha, que leva os custos do realizado às linhas, fica nos Cadastros Gerais / Linhas, no botão “Tarefas”.</li>
                <li>
                  Se a carga do realizado encontrar movimentações fora dos padrões das premissas (mão de obra e gastos gerais sem centro de custo, em
                  centros fora do cenário — estoque, investimento, obras — ou numa conta fora do grupo do centro), o quadro “Movimentações Fora dos
                  Padrões” aparece na aba Referência, e o “Realocar” fica depois do “Carregar Realizado”. Nele, cada conta mostra a alocação na DRE (Departamento, Atribuição e Conta de Resultado),
                  o valor do período e o centro de custo que a recebe (só os grupos com a mesma atribuição e conta; num centro de outro departamento,
                  ela entra como do departamento dele). Sem centro, a conta fica fora do cenário, e gravar assim pede confirmação. As realocações ficam
                  registradas no quadro, entram na Média de Referência dos centros do cenário (no Mês a Mês, também nos meses; a DRE se recalcula) e valem nas próximas cargas do realizado, ainda editáveis.
                </li>
                <li>
                  “Aplicar Padrão”, no pé do modal, preenche os centros pelo padrão (pela filial em que a conta mais lançou): Produção Matriz — MOD,
                  GGD e GGV em Estrutura, MOI e GGI em PCP (CRI); Produção Filial — MOD, GGD e GGV em Alveolares, MOI e GGI em PCP (FOR); Serviços —
                  MOD, GGD e GGV em Guindasteiros, MOI e GGI em Adm. de Obras; Logística em Logística; Técnico em Técnico; Comercial em Orçamentos;
                  Administrativo em Financeiro. Ele só preenche: confira e clique em “Gravar”.
                </li>
              </>
            ) : (
              <>
                <li>
                  Na aba Referência (opcional): importe um arquivo ou carregue até duas referências em Cenários e Realizados. A
                  referência substitui a DRE e os indicadores do cenário, que depois se editam na tela Resultados.
                </li>
                <li>
                  Em Cenários e Realizados, escolha em cada referência a Origem (o Resultado Realizado ou outro cenário, sintético ou analítico) e os
                  Meses do Cenário que ela preenche (De e Até). O realizado vai Mês a Mês (cada competência fechada do exercício que cai nesses meses, no
                  mês dela) ou pela Média Replicada (a média de um período, em todos esses meses); outro cenário leva a DRE e os indicadores dele, mês a
                  mês, para os mesmos meses. “Incluir Referência” abre a segunda (por exemplo, o realizado de Janeiro a Agosto e outro cenário de
                  Setembro a Dezembro): os meses das duas não podem se sobrepor, e os meses fora delas ficam vazios. Clique em “Carregar Referência” e
                  confirme.
                </li>
              </>
            )}
            {analitico ? (
              <>
                <li>
                  Na aba Cenário, o Acesso às Informações: Geral (o padrão), todos os usuários com acesso ao cenário veem todas as premissas e todo o
                  histórico; Por Recorte, quem tem recorte no perfil (Controle de Usuários / Perfis) vê só o seu recorte nas Premissas e no Histórico — o
                  Gestor (recorte por Departamento), o que é dos departamentos dele, pela regra do Exportar Premissas (Produção: Matriz, Filial, os
                  centros de produção, os rateios, a depreciação e os investimentos delas; Serviços: a aba Serviços, os centros de serviços, os rateios e
                  os seus investimentos; Logística, Técnico, Comercial e Administrativo: os centros do departamento; Extra-Operacional: a aba
                  Extra-Operacional; os investimentos de Despesas e Extra, pelo Departamento de cada um; os indicadores manuais, pelo grupo); o
                  Coordenador (recorte por Centros de Custo), só os grupos de centros com algum centro dele, no Quadro de Lotação, nos Centros de Custo e
                  nos Rateios. Quem criou o cenário e os Administradores veem tudo; Resultados e Painel de Bordo mostram sempre a DRE inteira. Só quem
                  criou o cenário ou o Administrador muda o Acesso às Informações.
                </li>
                <li>
                  Na aba Reajustes, dois quadros. Em Índices de Reajuste, cada índice tem a Descrição, a Observação e até quatro reajustes, cada um com o
                  Valor (%) e o mês em que Inicia Em, em meses crescentes; cada reajuste vale sobre os anteriores, até dezembro (4% a partir de janeiro e
                  2% a partir de abril dão +4% de janeiro a março e +4% e mais 2% sobre o reajustado, de abril em diante). Use “Incluir Índice” para uma
                  linha nova e a lixeira para excluir (um índice escolhido em contas da Aplicação dos Reajustes só se exclui depois de trocá-lo nelas: a
                  coluna Contas diz quantas o usam); “Gravar Índices” grava a lista. Em Aplicação dos Reajustes, cada conta da DRE escolhe um índice
                  (Produção e Serviços aparece, recolhida em Totais e em Atribuições como em Resultados Empresariais, só para leitura: os volumes não se
                  reajustam); o de um total ou de uma atribuição vale para as contas abaixo dele, e “Preencher Selecionados” aplica um índice às contas
                  marcadas; “Gravar Aplicação” grava os índices das contas.
                </li>
                <li>
                  Os reajustes entram na DRE pelo botão depois de “Gravar Aplicação”, que confirma num modal: “Aplicar Reajustes” multiplica cada conta
                  com índice, em cada mês, por (1 + Valor) de cada reajuste já iniciado; com eles aplicados, o botão vira “Remover Reajustes”, que faz o
                  inverso e volta aos valores das premissas — nunca duas vezes seguidas (grave a aplicação antes, se mudou). O aviso no topo da aba diz
                  se os reajustes estão aplicados. Com eles aplicados, a barra do cenário mostra a etiqueta Reajustes Aplicados, as abas das Premissas
                  (menos Indicadores Manuais) ficam bloqueadas para edição, “Importar Valores” sai da tela Premissas, a referência não se carrega,
                  gravar um quadro recalcula a DRE e o “Recalcular” da tela Resultados os mantém; o histórico registra cada aplicação e remoção (tela
                  Histórico). As premissas não mudam: o reajuste fica só na DRE.
                </li>
              </>
            ) : null}
            <li>Troque de cenário no nome dele, na barra do topo; ao lado, as telas {analitico ? "Premissas, Resultados, Painel de Bordo e Histórico" : "Resultados, Painel de Bordo e Reajustes"}.</li>
            <li>Aparecem só as abas que o seu perfil lê, e os botões de cada aba só com a permissão de editar nela (Controle de Usuários / Perfis); sem ela, a aba se lê, com um aviso.</li>
            <li>
              A Edição das Configurações vale para toda esta tela (todas as abas e ações: o cenário, Marcar e Excluir, a referência, as realocações,
              o Replicar Médias e o Apagar Valores, o comparativo, os índices e os reajustes). Particular (o padrão): só quem criou o cenário
              (ou o Administrador) altera as Configurações; num cenário público de outro usuário, as abas se leem, com um aviso que diz de quem é o
              cenário. Pública: todos os usuários com permissão de editar as Configurações as alteram.
            </li>
            <li>Na Referência, os meses fechados do exercício aparecem resumidos (por exemplo, “Fechada: de Janeiro a Agosto.”).</li>
            {analitico ? (
              <li>
                A aba Comparativo dos analíticos tem três quadros: Cenário Comparado, Índices de Referência e Variações Máximas. Em Índices de
                Referência, cadastre os índices do cenário: a Descrição, a Observação e a Variação Máxima (em %, para mais ou para menos). Use “Incluir
                Índice” para uma linha nova e a lixeira para excluir (um índice escolhido em contas das Variações Máximas só se exclui depois de
                trocá-lo nelas: a coluna Contas diz quantas o usam); “Gravar Índices” grava a lista. Em Variações Máximas, cada conta escolhe um índice
                no lugar da variação digitada.
              </li>
            ) : null}
            <li>
              {analitico
                ? "Nas Variações Máximas dos analíticos, a coluna Índice de Referência traz, em cada conta (ou num total ou numa atribuição, para as contas abaixo dele), a lista dos Índices de Referência, acima; o “Preencher Selecionados” aplica um índice às contas marcadas, e “Gravar Comparativo” grava o Cenário Comparado e as Variações Máximas. O resto funciona como abaixo. "
                : ""}
              Na aba Comparativo, escolha o cenário com que este se compara e a variação máxima (em %, para mais ou para menos) de cada conta, na
              estrutura da DRE vigente (totais, atribuições e contas, desde Produção e Serviços (PS), com os volumes; sem os totais que só somam
              outros, como CPV, MB, MC, DFO, EBITDA, EBIT, NOPAT, RF, DF e RL; a seta no rótulo da coluna escolhe até que nível mostrar — em Totais e em Atribuições, Produção e Serviços (PS) aparece
              recolhida, como em Resultados Empresariais —, e as setas das linhas abrem e fecham cada grupo). A variação digitada num total ou numa atribuição vale para todas as contas abaixo dele; com contas de
              variações diferentes, o campo dele fica em branco (“Várias”). Em branco, a conta não se verifica. Para preencher várias de uma vez, marque as
              linhas (a caixa de um total ou de uma atribuição marca as contas abaixo dele; a do rótulo, todas), digite o percentual em
              “Preencher Selecionados” e clique em “Aplicar”; “Limpar” deixa as marcadas em branco. Clique em “Gravar Comparativo”. “Nenhum” desliga o comparativo (as variações ficam guardadas). Com o cenário
              marcado ou com a versão congelada, o comparativo só se lê.
            </li>
            <li>
              Com um cenário comparado, a tela Resultados e a aba Indicadores do Painel de Bordo trazem, em preto e cinza depois do total, os totais dele (e, nos Resultados, a
              Diferença, o Atingimento e a Eficiência), e a tela {analitico ? "Histórico" : "Reajustes"} ganha a aba Justificativas, com as contas acima da variação.
            </li>
            <li>“Exportar”, o último botão do quadro (nas Variações Máximas, depois do Limpar; nos Índices de Referência, depois do Incluir Índice), leva o que está gravado em Excel ou PDF.</li>
          </ul>
        }
        sobre={
          analitico ? (
            <p>
              Os dados do cenário e a base opcional das premissas dele: o resultado realizado ou outro cenário analítico (os analíticos só importam de
              analíticos). A DRE do analítico é sempre calculada das premissas, dos centros de custo, dos investimentos e do extra-operacional. Na
              referência realizada, os custos de cada conta vão para as linhas pela Correspondência Tarefa × Linha; o que não tem tarefa vai pelo volume.
            </p>
          ) : (
            <p>
              Os dados do cenário e a base opcional da DRE dele: um arquivo importado ou até duas referências, em meses distintos, entre o resultado
              realizado e outros cenários. Sem referência, a DRE se digita inteira na tela Resultados, com os totais calculados pela Estrutura da DRE.
            </p>
          )
        }
      />
      {cenario.isError ? (
        <Erro erro={mensagemDeErro(cenario.error, "Erro ao carregar o cenário.")} />
      ) : cenario.isPending ? (
        <div className="h-64 animate-pulse rounded-sm bg-gray-100" />
      ) : (
        <ConfiguracoesCenario key={`${cenario.data.nome}|${cenario.data.descricao}|${cenario.data.visualizacao}`} cenario={cenario.data} abaInicial={abaInicial} />
      )}
    </div>
  );
}
