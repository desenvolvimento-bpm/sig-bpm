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
              Com a visualização Particular (gravada), o Compartilhar, logo abaixo dela, lista os usuários convidados a ver o cenário: quem criou
              o cenário (ou o Administrador) clica em “Convidar”, marca os usuários (os ativos com acesso aos cenários; os Administradores já veem
              todos) e confirma; “Remover” tira um deles, depois da confirmação. Cada convidado usa as telas do cenário pelo seu perfil — Só
              Leitura: o perfil só lê os cenários e só vê, sem editar —, e a Edição das Configurações continua valendo nesta tela. Com a
              visualização Pública, todos com acesso aos cenários já o veem.
            </li>
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
                  abas das premissas e confirmam antes de gravar). Outro analítico traz as premissas, os centros, os investimentos e os indicadores dele. Cada Média de Referência do realizado (as contas
                  dos centros de custo, as realocações, a depreciação base, o extra-operacional e os indicadores) é a soma do período ÷ os meses dele,
                  também quando a linha não tem valor em todos: uma conta com valor num só mês de uma referência de 9 meses fica com esse valor ÷ 9 (nas
                  premissas das unidades, o total do período ÷ o volume ou os dias úteis dele). Os avisos do que não coube aparecem embaixo. Marque
                  “Manter os Valores dos Meses” para trocar só as Médias de Referência: os doze meses do cenário (digitados ou importados), os
                  investimentos e as linhas do Quadro de Lotação ficam, e o Justificar? do Exportar Premissas passa a comparar os meses com as médias
                  novas; desmarcada, a referência substitui também os meses (os valores digitados se perdem). Os colaboradores do cenário vêm só da aba Quadro de Lotação das
                  Premissas, alimentada pela Gestão de Colaboradores: no realizado, marque “Importar Quadro de Lotação Vigente” para trocar as linhas
                  dela pelas do Quadro de Lotação mais recente da Gestão de Colaboradores (os colaboradores do fim da competência mais recente, em todos
                  os meses), qualquer que seja o período (De / Até); os salários das linhas que o cenário já tinha ficam. Com a caixa Aplicar Reajustes marcada
                  (nos Resultados), a referência não se carrega nem se realoca, com o aviso na aba: desmarque-a antes.
                </li>
                <li>A Correspondência Tarefa × Linha, que leva os custos do realizado às linhas, fica nos Cadastros Gerais / Linhas, no botão “Tarefas”.</li>
                <li>
                  Se a carga do realizado encontrar movimentações fora dos padrões das premissas (mão de obra e gastos gerais sem centro de custo, em
                  centros fora do cenário — estoque, investimento, obras — ou numa conta fora do grupo do centro), o quadro “Movimentações Fora dos
                  Padrões” aparece na aba Referência, e o “Realocar” fica depois do “Carregar Realizado”. Nele, cada conta mostra a alocação na DRE (Departamento, Atribuição e Conta de Resultado),
                  o valor do período e o centro de custo que a recebe (só os grupos com a mesma atribuição e conta; num centro de outro departamento,
                  ela entra como do departamento dele). Sem centro, a conta fica fora do cenário, e gravar assim pede confirmação. As realocações ficam
                  registradas no quadro, entram na Média de Referência dos centros do cenário (no Mês a Mês, também nos meses; a DRE fica pendente de recálculo) e valem nas próximas cargas do realizado, ainda editáveis.
                </li>
                <li>
                  “Aplicar Padrão”, no pé do modal, preenche os centros pelo padrão (pela filial em que a conta mais lançou): Produção Matriz — MOD,
                  GGD e GGV em Estrutura, MOI e GGI em PCP (CRI); Produção Filial — MOD, GGD e GGV em Alveolares, MOI e GGI em PCP (FOR); Serviços —
                  MOD, GGD e GGV em Guindasteiros, MOI e GGI em Adm. de Obras; Logística em Logística; Técnico em Técnico; Comercial em Orçamentos;
                  Administrativo em Financeiro. Ele só preenche: confira e clique em “Gravar”.
                </li>
                <li>
                  As abas Unidades, Departamentos, Centros de Custo, Regras de Rateio e Redistribuições de Gastos, depois da Referência, são as cópias dos cadastros com que
                  o cenário calcula: a cópia é tirada na criação do cenário (a revisão e a cópia de um cenário levam as do cenário de origem) e não muda
                  com os Cadastros Gerais — “Trazer Novos”, nessas abas, inclui as unidades, os departamentos, os centros e as redistribuições que
                  surgiram lá depois, sem mexer no que foi editado aqui. Nas cinco abas, os rótulos das colunas ordenam e filtram a tabela, como nas
                  outras tabelas do SIG (em Centros de Custo, a coluna Ativo filtra a situação), e o Exportar leva o que está filtrado. Em Unidades, clique
                  numa linha para mudar o Nome no Cenário, a Ordem e se está Ativa (as unidades não se incluem nem se excluem). Em Centros de Custo,
                  clique numa linha para editar o centro, ou em “Novo Centro” para um que vale só no cenário: o Centro de Custo (Controladoria) é o grupo
                  do centro (os valores das premissas são de cada grupo), e o Departamento, a Atribuição, o Rateio e a Unidade Dedicada decidem como o
                  cenário agrupa e aloca os gastos; os centros de estoque e de investimento ficam fora do cenário. “Excluir”, no modal, só vale para o
                  centro sem linhas no Quadro de Lotação do cenário (inative os outros). “Renomear Grupo” muda o nome de um grupo em todos os centros
                  dele, e os valores do grupo (as premissas, os encargos, os benefícios, as justificativas e as realocações) vão junto; levar o último
                  centro de um grupo para um grupo novo faz o mesmo. Se a mudança deixar um grupo sem centros, o SIG avisa antes de gravar: os valores
                  dele saem do cenário. Cada mudança nos centros deixa a DRE do cenário pendente de recálculo e fica no Histórico (aba Alterações); para a Média de
                  Referência seguir os grupos novos, carregue a referência de novo. O realizado dos centros dos Cadastros Gerais chega à cópia de cada
                  um; o resto do SIG segue os Cadastros Gerais.
                </li>
                <li>
                  As gravações das Configurações (a referência e as realocações, os centros de custo, os benefícios padrão, as regras de rateio) e
                  dos Índices de Reajuste não refazem a DRE: cada uma conta no destaque Pendente de Recálculo da tela Resultados (como uma
                  Configuração, ou um Reajuste, com a caixa Aplicar Reajustes marcada), cujo “Recalcular” refaz a DRE com todas. Os Índices de
                  Comparação, as unidades, os departamentos e as redistribuições não mudam a DRE.
                </li>
                <li>
                  Em Benefícios Padrão, depois de Centros de Custo, os benefícios do cenário (Cesta Básica, Vale-Transporte, Seguro de Vida, Plano de
                  Saúde, Plano Odontológico…): o Nome, a Descrição e o Valor Mensal (/ Colab.), com a coluna Em Uso no Quadro de Lotação (as linhas e os
                  valores — linha × mês — em que o benefício está aplicado). “Novo Benefício” inclui um; clique numa linha para editá-lo, com “Excluir”
                  no modal (o benefício em uso sai também do Quadro de Lotação). Na aba Quadro de Lotação das Premissas, o botão Benefícios aplica os
                  marcados às linhas e aos meses marcados: os Benefícios de cada mês da linha são os colaboradores dela × a soma do Valor Mensal dos
                  aplicados, e a linha Benefícios Padrão dos Encargos e Benefícios de cada grupo, na aba Centros de Custo, soma os dos centros dele.
                  Mudar o valor de um benefício em uso deixa a DRE do cenário pendente de recálculo; cada mudança fica no Histórico (aba Alterações). A revisão e a cópia
                  de um cenário levam os benefícios do cenário de origem, aplicados nas mesmas linhas.
                </li>
                <li>
                  Em Regras de Rateio, a cópia das regras de Cadastros Gerais / Regras de Rateio: o cálculo dos rateios do cenário (e a conferência
                  dos meses sem regra no Congelar, no Reabrir e no Criar Revisão) usa estas regras, e não as de Cadastros Gerais. “Novo Rateio”
                  inclui uma regra Paramétrica (o Rótulo, a Chave, o Destino — a linha dos Totais das Listas — e a Vigência, no calendário: o
                  percentual sai das bases das premissas do cenário) ou um conjunto Fixo (os percentuais de Matriz, Filial, Montagem e
                  Complementar, somando 100%); clique numa regra para editá-la (a fixa abre o conjunto da chave e do período), com “Excluir” no
                  modal. Rateios com a mesma chave não podem ter vigências sobrepostas. Os avisos no destaque listam os meses do exercício sem regra
                  e os conjuntos fixos que não somam 100%. Cada mudança deixa a DRE do cenário pendente de recálculo e fica no Histórico (aba Alterações).
                </li>
                <li>
                  Em Departamentos, clique numa linha para editar a unidade, o nome, os Departamentos da DRE (os grupos da DRE com linhas na unidade; cada
                  grupo num departamento ativo só da unidade), a ordem e se está ativo, ou em “Novo Departamento”; o departamento usado numa redistribuição
                  do cenário não se exclui. Em Redistribuições de Gastos, clique numa linha para abrir a redistribuição (com a permissão de editar, para
                  alterá-la ou excluí-la) ou em “Nova Redistribuição”: o modal é o do cadastro (o Departamento da DRE, a Unidade que filtra as contas,
                  as Contas da DRE pela busca ou pela lupa, uma ou mais, os fornecedores com movimentos em qualquer delas, os centros de Redistribuir Para
                  pela busca ou pela lupa, com os percentuais somando 100%, e a vigência), com os departamentos e os centros de custo do cenário. Na carga do realizado da referência (aba Referência), as redistribuições do cenário valem no lugar das dos
                  Cadastros Gerais, nas contas dos centros de custo: o movimento redistribuído pelos Cadastros Gerais volta ao centro dele, e o que casa
                  com uma redistribuição do cenário (uma das contas, um fornecedor marcado, o departamento e um mês da vigência) vai dividido entre os centros
                  dela. Mudar as redistribuições não recalcula nada: carregue o realizado de novo para a mudança chegar às Médias de Referência. Um centro
                  usado em Redistribuir Para não se exclui da aba Centros de Custo.
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
                  Na aba Comparativo e Reajustes, três quadros, um embaixo do outro: Cenário Comparado, Índices de Comparação e Índices de Reajuste
                  (cada um com a sua permissão no perfil). Em Cenário Comparado, “Escolher Cenário” abre a lista dos cenários; escolha um (ou
                  “Nenhum”, que desliga o comparativo) e clique em “Gravar”.
                </li>
                <li>
                  Os Índices de Comparação e os Índices de Reajuste ficam numa tabela cada, como os Centros de Custo: clique numa linha para abrir o
                  índice no modal, ou em “Novo Índice”; “Gravar”, no modal, grava o índice e atualiza a tabela (“Excluir”, no modal, o tira do
                  cenário). Cada índice de comparação tem a Descrição, a Observação e a Variação Máxima (em %, para mais ou para menos); cada
                  índice de reajuste, a Descrição, a Observação e até quatro reajustes, cada um com o Valor (%) e o mês em que Inicia Em, em meses
                  crescentes — cada reajuste vale sobre os anteriores, até dezembro (4% a partir de janeiro e 2% a partir de abril dão +4% de
                  janeiro a março e +4% e mais 2% sobre o reajustado, de abril em diante); a coluna Reajustes da tabela os descreve numa linha só
                  (“4,00% em JAN/27, 2,00% em ABR/27”). Para considerar percentuais cumulativos, use o cálculo “((1+R1)*(1+R2)*(1+RN...))-1”
                  antes de inserir o percentual adotado.
                </li>
                <li>
                  No modal, as Combinações dizem onde o índice vale: “Incluir Combinação” abre uma linha com a Unidade (Todas, ou uma unidade do
                  cenário), o Departamento (Todos, ou um departamento da unidade escolhida: Configurações / Departamentos), a Atribuição (Todas, ou
                  uma atribuição do departamento — com o Departamento Todos, a mesma atribuição de todos os departamentos da unidade) e a Conta
                  (Todas, ou uma conta da atribuição e do departamento). Na Matriz, na Filial e em Serviços, o Departamento Receita Operacional
                  tem como atribuições a Receita Operacional Bruta, os Impostos Operacionais e a Receita Operacional Líquida, com as contas de cada
                  uma; nos Índices de Reajuste, reajustar os Impostos Operacionais multiplica os impostos de cada produto (a ROB menos a ROL) pelo
                  fator, e a ROL passa a ser a ROB menos eles — por isso, na mesma unidade, a ROL só pode ter o mesmo índice dos impostos (ou
                  nenhum). Assim, o índice vale numa unidade inteira, num departamento de uma
                  unidade, numa atribuição de um departamento ou só numa conta, e um índice tem quantas combinações precisar; a coluna Contas de
                  cada linha diz quantas contas (cada conta numa unidade) ela alcança. No modal, só as linhas das combinações rolam: os campos do índice e os rótulos da tabela ficam fixos, e os avisos e os botões, no pé. Nos Índices de Reajuste, a Venda (Todas, Global ou
                  Mercantil): Global ou Mercantil deixa na combinação só as contas dos Custos de Produção da Matriz e da Filial, na parte daquela
                  venda — cada conta reajusta a parte de cada venda: os valores das premissas
                  da tabela dela e, nas contas dos centros de custo e na depreciação, que não têm venda, a parte do volume produzido dela no mês
                  (sem volume no mês, tudo na Global). Os volumes de Produção e Serviços recebem só Índices de Comparação: não se reajustam. A
                  mesma conta não pode estar em duas combinações do índice nem em dois índices do mesmo tipo: o aviso no rodapé do modal diz quais
                  contas se repetem, e o “Gravar” só volta com elas corrigidas. Um departamento usado numa combinação não se exclui nem muda de
                  unidade (Configurações / Departamentos).
                </li>
                <li>
                  Os reajustes entram na DRE pela caixa “Aplicar Reajustes”, na tela Resultados, antes do “Recalcular” (marcá-la confirma num
                  modal): o Recalcular multiplica cada conta com índice, em cada mês, por (1 + Valor) de cada reajuste já iniciado; desmarcada a
                  caixa, o Recalcular faz o inverso e volta aos valores das premissas. O aviso acima do quadro diz se a caixa está marcada. Marcada,
                  a barra do cenário mostra a etiqueta Reajustes Aplicados, as Configurações e as abas das Premissas (menos Indicadores Manuais)
                  ficam bloqueadas para edição, “Importar Valores” sai da tela Premissas, a referência não se carrega e gravar um Índice de Reajuste
                  deixa a DRE pendente de recálculo; o histórico registra cada aplicação e remoção no Recalcular (tela Histórico). As premissas não
                  mudam: o reajuste fica só na DRE.
                </li>
                <li>
                  Na tela Resultados, nas abas das unidades (no Consolidado, não), a coluna Índice de Reajuste, antes de Janeiro, traz o
                  índice de cada linha da DRE, e, com um cenário comparado, a coluna Índice de Comparação, antes do Comparativo, nas cores
                  dele, o de comparação. A variação máxima de cada conta, nas
                  Justificativas (tela Histórico) e no Justificar? do Exportar Premissas, é a do Índice de Comparação dela na unidade; no
                  Consolidado, a maior das unidades. Sem índice, a conta não se verifica.
                </li>
              </>
            ) : null}
            <li>Troque de cenário no nome dele, na barra do topo; ao lado, as telas {analitico ? "Premissas, Resultados, Painel de Bordo e Histórico" : "Resultados, Painel de Bordo e Reajustes"}.</li>
            <li>Aparecem só as abas que o seu perfil lê, e os botões de cada aba só com a permissão de editar nela (Controle de Usuários / Perfis); sem ela, a aba se lê, com um aviso.</li>
            <li>
              A Edição das Configurações vale para toda esta tela (todas as abas e ações: o cenário, Marcar e Excluir, a referência, as realocações,
              o Replicar Médias e o Apagar Valores, {analitico ? "as unidades, os departamentos, os centros de custo e as redistribuições de gastos do cenário, " : ""}o comparativo, os índices e os reajustes). Particular (o padrão): só quem criou o cenário
              (ou o Administrador) altera as Configurações; num cenário público de outro usuário, as abas se leem, com um aviso que diz de quem é o
              cenário. Pública: todos os usuários com permissão de editar as Configurações as alteram.
            </li>
            <li>Na Referência, os meses fechados do exercício aparecem resumidos (por exemplo, “Fechada: de Janeiro a Agosto.”).</li>
            {analitico ? null : (
              <li>
              Na aba Comparativo, escolha o cenário com que este se compara e a variação máxima (em %, para mais ou para menos) de cada conta, na
              estrutura da DRE vigente (totais, atribuições e contas, desde Produção e Serviços (PS), com os volumes; sem os totais que só somam
              outros, como CPV, MB, MC, DFO, EBITDA, EBIT, NOPAT, RF, DF e RL; a seta no rótulo da coluna escolhe até que nível mostrar — em Totais e em Atribuições, Produção e Serviços (PS) aparece
              recolhida, como em Resultados Empresariais —, e as setas das linhas abrem e fecham cada grupo). A variação digitada num total ou numa atribuição vale para todas as contas abaixo dele; com contas de
              variações diferentes, o campo dele fica em branco (“Várias”). Em branco, a conta não se verifica. Para preencher várias de uma vez, marque as
              linhas (a caixa de um total ou de uma atribuição marca as contas abaixo dele; a do rótulo, todas), digite o percentual em
              “Preencher Selecionados” e clique em “Aplicar”; “Limpar” deixa as marcadas em branco. Clique em “Gravar Comparativo”. “Nenhum” desliga o comparativo (as variações ficam guardadas). Com o cenário
              marcado ou com a versão congelada, o comparativo só se lê.
              </li>
            )}
            <li>
              Com um cenário comparado, a tela Resultados e a aba Indicadores do Painel de Bordo trazem, em preto e cinza depois do total, os totais dele (e, nos Resultados, a
              Diferença, o Atingimento e a Eficiência), e a tela {analitico ? "Histórico" : "Reajustes"} ganha a aba Justificativas, com as contas acima da variação.
            </li>
            <li>
              Nas abas com tabela ({analitico ? "as cópias dos cadastros e os índices" : "o Comparativo"}), o destaque acima de cada tabela — o título, a descrição e, à
              direita, os botões dela, como Novo, Gravar e “Exportar” — é um cartão à parte que, ao rolar a tela, flutua sobre a tabela, logo abaixo
              dos rótulos presos, com as mesmas funções (como nas Premissas). “Exportar”, o último botão do destaque, leva o que está na tabela em Excel ou PDF.
              Os rótulos das colunas têm os filtros e a ordenação padrão{analitico ? "" : " (na tabela da DRE, com um filtro ou uma ordem, aparecem as linhas que passam, de todos os níveis, e sem eles a tabela volta à árvore)"}.
            </li>
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
