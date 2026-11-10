import { navGrupos, permissaoDaTela } from "./navigation-config";

/**
 * As Novidades (24/10/2026, pedido do Adão): o resumo do que cada publicação trouxe, para os usuários, no modal
 * Novidades (o menu do usuário e o sino ao lado do nome). Cada registro é de uma publicação, um processo (o link do menu
 * lateral) e uma tela; o modal junta os registros por dia, processo e tela. O usuário vê só os das telas que alcança (a
 * permissão da `rota`, a mesma do menu); sem `rota`, todos. A cada publicação, os registros dela entram aqui, no alto.
 */
export type Novidade = {
  /** Quando foi publicada (a data e a hora da tag), "AAAA-MM-DDTHH:MM": a ordem e o que o usuário ainda não viu. */
  publicada: string;
  /** O processo (o link do menu lateral) ou "Todo o SIG". */
  processo: string;
  /** A tela do processo; sem ela, o processo todo. */
  tela?: string;
  /** Um endereço da tela, para a permissão (permissaoDaTela); sem ele, todos os usuários. */
  rota?: string;
  /** Só para o Administrador. */
  soAdministrador?: boolean;
  itens: string[];
};

export const TODO_O_SIG = "Todo o SIG";

const RE = "/analises-gerenciais/relatorios-executivos";
const RESULTADOS = "/relatorios/resultados";
const PAINEL = "/relatorios/painel";
const DRE = "/competencias/0000-00/dre";

export const NOVIDADES: Novidade[] = [
  // 10/11/2026, 14:43
  {
    publicada: "2026-11-10T14:43",
    processo: TODO_O_SIG,
    itens: [
      "O menu ganha o grupo Processos Administrativos, entre a Apuração dos Resultados e a Controladoria: a Gestão de Colaboradores, em uso, e o Fluxo de Caixa, a Gestão de Credores e a Gestão da Segurança, em desenvolvimento.",
      "O Registros dos Indicadores, em desenvolvimento, saiu do menu.",
    ],
  },
  {
    publicada: "2026-11-10T14:43",
    processo: "Gestão de Colaboradores",
    tela: "Cadastros",
    rota: "/gestao-de-colaboradores/cadastros/senioridades",
    itens: [
      "O processo entra em uso, com a tela Cadastros: as abas Senioridades, Funções, Movimentações (os tipos de movimentação, com a contagem Positiva, Negativa ou Nula e a aprovação Automática ou Manual), Classificações e Lançamento Inicial (o quadro de lotação do início, um colaborador por linha).",
      "Funções e Lançamento Inicial têm o Importar, com a prévia de cada linha (Nova, Alterada, Igual ou Inválida); com uma linha inválida, a importação é cancelada. O Lançamento Inicial pede a competência.",
      "No menu da coluna Ações, Editar, Inativar (ou Reativar) e Excluir, este só no registro que não está em uso.",
    ],
  },
  {
    publicada: "2026-11-10T14:43",
    processo: "Gestão de Colaboradores",
    tela: "Quadro de Lotação",
    rota: "/gestao-de-colaboradores/quadro-de-lotacao",
    itens: [
      "As competências do processo: Abrir Competência e, no menu Ações, Fechar, Reabrir e Excluir.",
      "Em cada competência, as abas Movimentações (o Novo registra admissões, reposições, desligamentos e vagas; o desligamento pode gerar a vaga em aberto), Controle (Aprovar e Reprovar as de aprovação manual) e Realizado (os indicadores do mês e a tabela por centro de custo).",
      "No Realizado, a lista Comparação, ao lado do título, compara com um cenário marcado (Previsão, Orçamento, Anterior ou Vendido): o mês e o acumulado nos cards e, com um cenário analítico que tem a aba Quadro de Lotação, as colunas Cenário e Diferença de cada centro de custo.",
      "Com recorte por departamento ou por centro de custo, as abas mostram só os seus centros.",
    ],
  },
  {
    publicada: "2026-11-10T14:43",
    processo: "Gestão de Colaboradores",
    tela: "Painel de Bordo",
    rota: "/gestao-de-colaboradores/painel/resultados",
    itens: [
      "Os indicadores Quadro de Lotação, Turnover e Abertura de Vagas x Contratações: na aba Resultados, um card por indicador (o mês, o anterior, o ano e as barras dos meses); na aba Indicadores, a tabela dos meses com o Acumulado.",
      "A lista Comparação, ao lado do título, traz o cenário marcado e a diferença nos cards e, na aba Indicadores, uma linha do cenário e outra da diferença abaixo de cada indicador.",
    ],
  },
  {
    publicada: "2026-11-10T14:43",
    processo: "Cenários Analíticos",
    tela: "Premissas",
    rota: "/cenarios/analiticos/0/premissas",
    itens: [
      "A aba Quadro de Lotação, entre Serviços e Centros de Custo: as linhas como as do Lançamento Inicial (Unidade, Tipo, Senioridade, Função e Centro de Custo) e, em cada mês, os Colaboradores e o Salário Bruto, a Insalubridade / Periculosidade e o Salário Total de cada um, com o Custo no Ano. Nova Linha, a edição dos meses na própria tabela e o Excel (Exportar Premissas e Importar Valores).",
      "Na aba Centros de Custo, o grupo com linhas no Quadro de Lotação conta por elas os Colaboradores e as Remunerações CLT e PJ, que deixam de ser digitados; o grupo sem linhas fica como está.",
      "Nos Encargos e Benefícios, o FGTS em duas linhas: Fundo de Garantia: Aprendiz (2%), sobre os salários dos aprendizes, e Fundo de Garantia: CLT (8%).",
    ],
  },
  {
    publicada: "2026-11-10T14:43",
    processo: "Cadastros da Controladoria",
    tela: "Indicadores",
    rota: "/cadastros/estrutura-indicadores",
    itens: [
      "No montador da Metodologia, entram os itens Quadro de Lotação (por Departamento, com a Atribuição Geral, Direto ou Indireto, ou por Centro de Custo), Movimentos do QL (por movimentação, ou todas as de contagem Positiva ou Negativa) e Valor Registrado (o valor registrado no mês com o nome do indicador: importado, digitado ou apurado). O item Comercial e Administrativo saiu.",
    ],
  },
  {
    publicada: "2026-11-10T14:43",
    processo: "Cadastros da Controladoria",
    tela: "Centros de Custo",
    rota: "/cadastros/centros-custo",
    itens: [
      "Um centro de custo usado na Gestão de Colaboradores (o Lançamento Inicial e as movimentações) ou na aba Quadro de Lotação de um cenário não se exclui: inative-o.",
    ],
  },
  {
    publicada: "2026-11-10T14:43",
    processo: "Fechamento Mensal",
    tela: "Importações",
    rota: "/competencias/0000-00/importar",
    itens: [
      "Nas linhas do Quadro de Lotação e dos Indicadores do Administrativo, o botão Apurar tira os valores do mês da Gestão de Colaboradores (a competência do Quadro de Lotação do mesmo mês), mostra o registrado hoje ao lado e os grava.",
      "A DRE do Comercial tem o Importar da linha, e o Saldo Inicial do Estoque aparece só na primeira competência.",
      "O balancete lê a coluna ID da aba Balancete (Lista), o ID do movimento no RM, que abre os itens da nota fiscal ou da requisição nos extratos.",
    ],
  },
  {
    publicada: "2026-11-10T14:43",
    processo: "Fechamento Mensal",
    tela: "Resultados",
    rota: DRE,
    itens: [
      "No modal Balancete do extrato, a coluna ID (o ID do movimento no RM, a coluna ID da aba Balancete (Lista)) e, na coluna Ações, o botão Itens: os itens da nota fiscal ou da requisição do movimento, com o produto, o centro de custo, a conta, a quantidade e os valores.",
      "Os Itens abrem só com os do centro de custo e da conta do movimento, que somam o valor dele; desmarcando a caixa, aparece o documento inteiro, com os do movimento em amarelo. O botão aparece nos meses cujo balancete foi importado com a coluna ID preenchida.",
      "O Exportar do extrato e do Balancete leva a coluna ID na aba Detalhes.",
    ],
  },
  {
    publicada: "2026-11-10T14:43",
    processo: "Resultados Empresariais",
    tela: "Resultados",
    rota: RESULTADOS,
    itens: [
      "No modal Balancete do extrato, a coluna ID (o ID do movimento no RM, a coluna ID da aba Balancete (Lista)) e, na coluna Ações, o botão Itens: os itens da nota fiscal ou da requisição do movimento, com o produto, o centro de custo, a conta, a quantidade e os valores.",
      "Os Itens abrem só com os do centro de custo e da conta do movimento, que somam o valor dele; desmarcando a caixa, aparece o documento inteiro, com os do movimento em amarelo. O botão aparece nos meses cujo balancete foi importado com a coluna ID preenchida.",
      "O Exportar do extrato e do Balancete leva a coluna ID na aba Detalhes.",
    ],
  },
  {
    publicada: "2026-11-10T14:43",
    processo: "Resultados Empresariais",
    tela: "Painel de Bordo",
    rota: PAINEL,
    itens: [
      "Na aba Indicadores, o valor de um mês apurado na Gestão de Colaboradores traz a lupa: as movimentações aprovadas do mês e a contagem de cada uma.",
    ],
  },
  {
    publicada: "2026-11-10T14:43",
    processo: "Contestações de Gastos",
    tela: "Contestações",
    rota: "/contestacoes-de-gastos/solicitadas",
    itens: [
      "No Ver Movimentos, a coluna ID e o botão Itens de cada movimento: os itens da nota fiscal ou da requisição dele, como no Balancete dos extratos.",
    ],
  },
  {
    publicada: "2026-11-10T14:43",
    processo: "Contestações de Gastos",
    tela: "Validações",
    rota: "/contestacoes-de-gastos/validacoes",
    itens: [
      "No Ver Movimentos, a coluna ID e o botão Itens de cada movimento; o Ver Movimentos também aparece na contestação de um movimento só, quando ele tem itens.",
    ],
  },
  // 06/11/2026, 15:50
  {
    publicada: "2026-11-06T15:50",
    processo: "Fechamento Mensal",
    tela: "Importações",
    rota: "/competencias/0000-00/importar",
    itens: [
      "O Importar (ou Reimportar) da linha de cada tipo abre o mesmo diálogo do Importar Arquivo, só com a aba daquele tipo: escolhido o arquivo, a prévia mostra, mês a mês, o que muda, e nada é importado antes de você clicar em Importar.",
      "Serve o arquivo completo (o LISTAS REALIZADO, por exemplo) ou uma planilha só com aquela aba; as outras abas do arquivo ficam de fora.",
    ],
  },
  // 06/11/2026, 12:03
  {
    publicada: "2026-11-06T12:03",
    processo: "Arquivos Gerais",
    tela: "Treinamentos",
    rota: "/arquivos-gerais/treinamentos",
    itens: [
      "O processo entra em uso, na Controladoria: os arquivos dos treinamentos (apostilas, apresentações, vídeos, listas de presença…) guardados no SIG.",
      "Adicionar, à direita do título, envia um arquivo de qualquer tipo, até 500 MB, com a descrição que aparece na lista e serve para buscá-lo.",
      "No menu da coluna Ações, Visualizar abre o arquivo numa nova aba (PDF, imagem, vídeo, áudio ou texto), Baixar o salva com o nome original e Excluir o apaga, depois da confirmação.",
    ],
  },
  {
    publicada: "2026-11-06T12:03",
    processo: "Arquivos Gerais",
    tela: "Informativos",
    rota: "/arquivos-gerais/informativos",
    itens: [
      "A tela entra em uso: os arquivos dos informativos (comunicados, boletins, orientações…) guardados no SIG, com o Adicionar, o Visualizar, o Baixar e o Excluir, como em Treinamentos.",
    ],
  },
  {
    publicada: "2026-11-06T12:03",
    processo: "Realizado por Obra",
    tela: "Resultados",
    rota: "/realizado-por-obra/resultados",
    itens: [
      "O botão de seta ao lado do menu de níveis recolhe todos os meses: a tabela mostra só o acumulado (o Realizado e o Vendido) e as variações, em todas as abas.",
      "Saiu o aviso dos Créditos de Impostos de 100% ou mais do custo da conta na unidade; a conta continua sem o ajuste naquele mês.",
    ],
  },
  {
    publicada: "2026-11-06T12:03",
    processo: TODO_O_SIG,
    tela: "Filtros das Tabelas",
    itens: [
      "No menu do filtro de cada coluna, abaixo do Limpar Filtro de, o Limpar Todos os Filtros limpa os filtros de todas as colunas da tabela.",
      "Saiu o Limpar Filtros que aparecia acima das tabelas (e no rodapé dos Lançamentos Manuais e dos Lançamentos de Contestações).",
    ],
  },
  // 05/11/2026, 08:20
  {
    publicada: "2026-11-05T08:20",
    processo: "Realizado por Obra",
    tela: "Resultados",
    rota: "/realizado-por-obra/resultados",
    itens: [
      "O processo entra em uso: a DRE de uma venda (a obra e a versão vendida, escolhidas na lista Venda, ao lado do Exportar), da receita à Margem de Contribuição, mês a mês, com o Realizado contra o Vendido da DRE do CONTROLE DAS VENDAS.",
      "O Consolidado e uma aba por linha da obra. Os custos são os da etapa Linhas: o direto nos centros da obra e a parte dela no rateio de cada linha. A receita é a faturada nos centros da obra, sem o Reconhecimento do CPV.",
      "Nos custos de Matérias Primas, de Gastos Gerais Variáveis da Produção e de Frete e Descarga, o ajuste pelos Créditos de Impostos do mês: na venda mercantil, sem o Estornado; na global, sem o Estornado e com o Creditado reaplicado.",
      "Clique num valor para ver como ele se formou (o direto, o rateio e os créditos) e, na Mão de Obra e nos Gastos Gerais, a memória do rateio.",
    ],
  },
  {
    publicada: "2026-11-05T08:20",
    processo: "Fechamento Mensal",
    tela: "Resultados",
    rota: DRE,
    itens: [
      "Nova aba Impostos (os Créditos de Impostos): em cada unidade (Matriz e Filial), o Creditado e o Estornado do mês das contas de Matérias Primas, de Gastos Gerais Variáveis da Produção e do Frete e Descarga, em R$ e em % sobre o valor da conta.",
      "No extrato de uma linha, Regras de Rateio, no canto de baixo, mostra as regras vigentes no mês: em cada chave, como o valor se divide entre as unidades, com o percentual e o volume de cada destino.",
      "Na aba Obras, a receita da obra deixa de fora as contas de Reconhecimento do CPV; a receita prévia de frete da obra vai ao Frete, e a complementar, à Complementar.",
    ],
  },
  {
    publicada: "2026-11-05T08:20",
    processo: "Fechamento Mensal",
    tela: "Importações",
    rota: "/competencias/0000-00/importar",
    itens: [
      "Novo tipo Créditos de Impostos: a aba Impostos (Lista) do LISTAS REALIZADO (RESULTADOS), com o Creditado e o Estornado do mês por unidade e conta (a Atribuição e a Conta). As linhas de contas que não são de Matérias Primas nem de Gastos Gerais Variáveis da Produção ou do Frete ficam de fora, sem erro.",
    ],
  },
  {
    publicada: "2026-11-05T08:20",
    processo: "Fechamento Mensal",
    tela: "Linhas",
    rota: "/competencias/0000-00/linhas",
    itens: [
      "A etapa também grava as obras de cada linha (a base do Realizado por Obra). Numa competência fechada sem elas, o Gravar grava só as obras.",
    ],
  },
  {
    publicada: "2026-11-05T08:20",
    processo: "Fechamento Mensal",
    tela: "Prévias",
    rota: "/competencias/0000-00/receita-previa",
    itens: [
      "Na Receita, a nota de saída vai à unidade da linha dela no cadastro (a nota da Estrutura, à Matriz).",
    ],
  },
  {
    publicada: "2026-11-05T08:20",
    processo: "Resultados Empresariais",
    tela: "Resultados",
    rota: RESULTADOS,
    itens: [
      "Nova aba Impostos (os Créditos de Impostos): em cada unidade (Matriz e Filial), o Creditado e o Estornado de cada mês fechado, em R$ e em %, com os meses anteriores recolhidos ou não.",
      "No extrato de uma linha, Regras de Rateio, no canto de baixo, mostra as regras vigentes no mês.",
      "Na aba Obras, a receita da obra deixa de fora as contas de Reconhecimento do CPV; a receita prévia de frete vai ao Frete, e a complementar, à Complementar.",
    ],
  },
  {
    publicada: "2026-11-05T08:20",
    processo: "Contestações de Gastos",
    tela: "Contestações",
    rota: "/contestacoes-de-gastos/solicitadas",
    itens: [
      "No modal Contestar, as listas do Novo Centro de Custo e da Nova Conta de Resultado mostram todas as opções, com a barra de rolagem.",
      "A lupa ao lado de cada campo abre a lista inteira — os centros de custo (o departamento, a atribuição e o balde) e as Contas de Resultado (a linha e o grupo da DRE) —, e clicar num item o escolhe.",
      "Saem da lista os centros de custo genéricos (1.01, 1.02, 1.11…), os sem código e os de código mais longo: só os de código com três níveis.",
      "No canto de baixo do modal, Regras de Rateio mostra as regras vigentes no mês do movimento.",
    ],
  },
  {
    publicada: "2026-11-05T08:20",
    processo: "Painéis e Apresentações",
    rota: "/analises-gerenciais/paineis-de-bordo",
    itens: [
      "O processo passa a se chamar Painéis e Apresentações; cada painel continua um Painel de Bordo.",
      "Na Competência, a opção Automática: o painel mostra sempre a última competência fechada, e a Comparação Padrão acompanha a marcação do cenário escolhido.",
      "Com o painel em elaboração, os editores convidados também mudam o Geral das Configurações: o nome, a competência, a visualização e o Compartilhar.",
    ],
  },
  {
    publicada: "2026-11-05T08:20",
    processo: "Cenários Sintéticos",
    rota: "/cenarios/sinteticos",
    itens: [
      "Nas Configurações, o Comparativo com o título Cenário Comparado como o da Variação Máxima, o Escolher Cenário à direita e o Exportar depois do Limpar; nos Índices, depois do Incluir Índice; na Referência, o Remover da 2ª Referência ao lado do Carregar Referência.",
    ],
  },
  {
    publicada: "2026-11-05T08:20",
    processo: "Cenários Analíticos",
    rota: "/cenarios/analiticos",
    itens: [
      "Nas Configurações, o Comparativo com o título Cenário Comparado como o da Variação Máxima, o Escolher Cenário à direita e o Exportar depois do Limpar; na Referência, o Carregar Realizado e o Realocar na altura do De e do Até.",
    ],
  },
  {
    publicada: "2026-11-05T08:20",
    processo: TODO_O_SIG,
    itens: [
      "No Sobre Esta Tela, o Exportar passa a ser um item do Como Usar Esta Tela, com o que é próprio de cada tela.",
    ],
  },
  {
    publicada: "2026-11-05T08:20",
    processo: TODO_O_SIG,
    soAdministrador: true,
    itens: [
      "Saíram do menu os processos em desenvolvimento Resultados PROVA e Custos Operacionais (Análises Gerenciais) e Balanço Patrimonial (Apuração dos Resultados).",
    ],
  },
  // 01/11/2026, 11:10
  {
    publicada: "2026-11-01T11:10",
    processo: "Painéis e Apresentações",
    rota: "/analises-gerenciais/paineis-de-bordo",
    itens: [
      "O processo entra em uso: painéis de bordo com fins variados, montados como os Relatórios Executivos — as páginas, os Cards e as Tabelas (Padrão e PROVA), as anotações, as imagens, os vídeos, a apresentação e o Exportar em PDF.",
      "Cada painel tem um nome, uma competência (pode haver vários da mesma) e a visualização: Privado (só quem o criou, os editores convidados e o Administrador o veem) ou Público (todos o veem, depois de finalizado).",
      "Novo Painel começa vazio ou como cópia de outro painel, com os dados da competência nova.",
      "Uma só tela, Painel de Bordo, com várias páginas, e o Finalizar e o Reabrir, como nos grupos dos Relatórios Executivos.",
      "As Configurações têm duas abas: Geral (o nome, a competência, a visualização, o Compartilhar e o Excluir Painel) e Comparativos (a Comparação Padrão e a Comparação PROVA).",
      "Compartilhar: quem criou o painel convida outros usuários para editá-lo junto; os convidados editam as páginas, os Comparativos e a finalização.",
      "Copiar e colar blocos entre um painel e um relatório, com as imagens e os vídeos.",
    ],
  },
  {
    publicada: "2026-11-01T11:10",
    processo: "Relatórios Executivos",
    rota: RE,
    itens: [
      "No Adicionar › Objetos, os Cards passam a se chamar Cards Padrão e a Tabela, Tabela Padrão; entram os Cards PROVA e a Tabela PROVA, que comparam o realizado com os cenários marcados (Previsão, Orçado, Vendido e Anterior), cada um na sua cor.",
      "Nos Cards PROVA, embaixo do valor do mês e do acumulado, uma linha por cenário com a variação; o gráfico tem uma série por cenário.",
      "Na Tabela PROVA, cada cenário tem o seu grupo de colunas (o valor, o % e o R$/m³), depois do mês e depois do total.",
      "As Configurações têm dois grupos: a Comparação Padrão (o cenário dos objetos padrão, entre os cenários com marcação) e a Comparação PROVA (os cenários de todos os objetos PROVA do relatório, dois ou mais).",
      "No slide com objetos PROVA, a legenda traz o Realizado e os cenários, cada um na sua cor.",
    ],
  },
  {
    publicada: "2026-11-01T11:10",
    processo: "Resultados Empresariais",
    tela: "Resultados",
    rota: RESULTADOS,
    itens: [
      "A lista Comparação vira um botão que abre o modal Comparação de Resultados Empresariais: Padrão (um cenário, como antes) ou PROVA (de dois a quatro cenários marcados). A escolha vale também no Painel de Bordo.",
      "Na PROVA, as abas com orçado mostram os cenários lado a lado, cada um na sua cor, com o mês e o acumulado de cada um.",
      "Nas abas com DRE, Produção e Serviços (PS) fica recolhido em Totais e Atribuições, e aberto em Contas; a seta dele o abre.",
    ],
  },
  {
    publicada: "2026-11-01T11:10",
    processo: "Resultados Empresariais",
    tela: "Painel de Bordo",
    rota: PAINEL,
    itens: [
      "Com a Comparação PROVA, os cards trazem uma linha e uma série do gráfico por cenário; na aba Indicadores, as colunas de cada cenário ficam no lugar das do orçado, e o gráfico do indicador tem uma série por cenário.",
    ],
  },
  {
    publicada: "2026-11-01T11:10",
    processo: "Cenários Analíticos",
    rota: "/cenarios/analiticos",
    itens: ["Nas abas com DRE dos Resultados, Produção e Serviços (PS) fica recolhido em Totais e Atribuições, e aberto em Contas; a seta dele o abre."],
  },
  {
    publicada: "2026-11-01T11:10",
    processo: "Cenários Sintéticos",
    rota: "/cenarios/sinteticos",
    itens: ["Nas abas com DRE dos Resultados, Produção e Serviços (PS) fica recolhido em Totais e Atribuições, e aberto em Contas; a seta dele o abre."],
  },
  {
    publicada: "2026-11-01T11:10",
    processo: TODO_O_SIG,
    tela: "Modais",
    itens: ["Os modais mais altos que a tela rolam por si, com o título e os botões do rodapé sempre à vista."],
  },
  {
    publicada: "2026-11-01T11:10",
    processo: "Controle de Usuários",
    tela: "Perfis",
    rota: "/perfis",
    itens: ["Na matriz do perfil, as Análises Gerenciais trazem a tela Painéis de Bordo, que começa com as mesmas permissões dos Relatórios Executivos."],
  },
  // 30/10/2026, 16:57
  {
    publicada: "2026-10-30T16:57",
    processo: TODO_O_SIG,
    tela: "Exportar",
    itens: ["O Exportar fica sempre por último na barra de ações das telas, depois dos demais botões e filtros."],
  },
  {
    publicada: "2026-10-30T16:57",
    processo: "Central de Conectividade",
    tela: "APIs",
    rota: "/central-de-conectividade/biblioteca-de-apis",
    itens: [
      "A Biblioteca de APIs passa a ser a tela APIs do processo Central de Conectividade, na Controladoria, acima dos Cadastros da Controladoria. O endereço, as APIs e as permissões continuam os mesmos.",
    ],
  },
  {
    publicada: "2026-10-30T16:57",
    processo: "Central de Conectividade",
    soAdministrador: true,
    itens: ["O processo Integrações e Consultas, em desenvolvimento, saiu do menu."],
  },
  {
    publicada: "2026-10-30T16:57",
    processo: "Controle de Usuários",
    tela: "Perfis",
    rota: "/perfis",
    itens: ["Na matriz do perfil, a Central de Conectividade fica sob a Controladoria, como no menu, com a tela APIs (antes, Biblioteca de APIs)."],
  },
  // 30/10/2026, 16:00
  {
    publicada: "2026-10-30T16:00",
    processo: "Relatórios Executivos",
    rota: RE,
    itens: [
      "O Zoom dos cards: no menu da edição, a lupa amplia o card inteiro (os textos, os valores e o gráfico) em 125%, 150%, 200%, 250% ou 300%, no mesmo bloco; o que não couber, aumente o card.",
    ],
  },
  // 30/10/2026, 15:35
  {
    publicada: "2026-10-30T15:35",
    processo: "Contestações de Gastos",
    tela: "Contestações",
    rota: "/contestacoes-de-gastos/solicitadas",
    itens: [
      "O processo entra em uso: no balancete de uma conta (o modal dos movimentos, nos Resultados do mês e nos Resultados Empresariais), “Contestar” sugere o novo centro de custo e/ou a nova conta de resultado de um movimento, com o motivo.",
      "Contestar Anteriores e Contestar Posteriores levam junto os movimentos do mesmo fornecedor, conta e centro de custo nas outras competências, com o total que muda; a contestação continua uma só.",
      "A lista das contas novas traz só as do departamento do centro novo e as do Extra-Operacional, com o balde de rateio de cada uma.",
      "Nas abas Solicitadas e Recebidas, cada contestação mostra o Fornecedor, a Filial, o De e o Para e a Situação; o menu Ações traz Motivo, Justificativa, Ver Movimentos e, na Recebidas, Acatar e Recusar (com confirmação).",
      "Respondem pelo centro todos os usuários com Editar na Recebidas, cada um no seu recorte; a Recebidas traz só as pedidas por outros usuários.",
      "O movimento que chega a uma linha pelo rateio de outra mostra a etiqueta Rateio no lugar do Contestar: ele se contesta na linha de origem.",
    ],
  },
  {
    publicada: "2026-10-30T15:35",
    processo: "Contestações de Gastos",
    tela: "Validações",
    rota: "/contestacoes-de-gastos/validacoes",
    itens: [
      "Processar corrige os movimentos das contestações acatadas: na competência aberta, no próprio balancete; na fechada, pelo Importar da aba Contestações dos Lançamentos Manuais. Alterar Status muda a situação de qualquer contestação, com a justificativa.",
    ],
  },
  {
    publicada: "2026-10-30T15:35",
    processo: "Fechamento Mensal",
    tela: "Lançamentos Manuais",
    rota: "/competencias/0000-00/lancamentos-manuais",
    itens: ["O título da tela passa a ser Lançamentos Manuais (na barra das etapas, continua Lançamentos)."],
  },
  {
    publicada: "2026-10-30T15:35",
    processo: "Fechamento Mensal",
    tela: "Lançamentos Manuais › Contestações",
    rota: "/competencias/0000-00/lancamentos-contestacoes",
    itens: [
      "A aba Contestações traz, pelo Importar, os lançamentos das contestações acatadas de competências fechadas: para cada competência do movimento, o estorno no centro e na conta de antes e o lançamento no centro e na conta novos; abaixo do número, a competência do movimento.",
      "Com rateio, os dois se dividem entre as unidades pelos percentuais da competência do movimento, como ele foi dividido.",
      "A lixeira exclui a importação de uma contestação (os lançamentos dela), e ela volta à lista do Importar.",
    ],
  },
  {
    publicada: "2026-10-30T15:35",
    processo: "Fechamento Mensal",
    tela: "Resultados",
    rota: DRE,
    itens: [
      "Na aba Obras, o grupo Produção e Serviços (PS), com os volumes da obra nas Listas Operacionais.",
      "Produção e Serviços (PS), com os volumes, aparece também nos níveis Totais e Atribuições.",
    ],
  },
  {
    publicada: "2026-10-30T15:35",
    processo: "Fechamento Mensal",
    tela: "Conferência",
    rota: "/competencias/0000-00/conferencia-planilha",
    itens: ["Produção e Serviços (PS), com os volumes, aparece também nos níveis Totais e Atribuições."],
  },
  {
    publicada: "2026-10-30T15:35",
    processo: "Resultados Empresariais",
    tela: "Resultados",
    rota: RESULTADOS,
    itens: [
      "A lista Comparação mostra só o nome da marcação: Previsão, Orçamento, Anterior ou Vendido.",
      "Na aba Obras, o grupo Produção e Serviços (PS), com os volumes da obra nas Listas Operacionais e, com eles, o R$/m³ da obra.",
      "Produção e Serviços (PS), com os volumes, aparece também nos níveis Totais e Atribuições.",
    ],
  },
  {
    publicada: "2026-10-30T15:35",
    processo: "Relatórios Executivos",
    rota: RE,
    itens: [
      "O Adicionar fica em três grupos: Objetos (Cards e Tabela), Texto (Anotação, Texto Livre e Sumário) e Imagem e Vídeo.",
      "A Imagem de Fundo fica nos ícones ao lado das páginas: o ícone de imagem a envia; com ela na página, os de ajustar e remover.",
      "O ícone Transições, ao lado dos da Imagem de Fundo, abre o modal Transições do slide: a Animação (o Tipo) e o Cronômetro (Avançar Após, em segundos: na apresentação, o slide passa sozinho ao próximo), cada um com o seu Aplicar ao Grupo.",
      "Na Tabela, o grupo Colunas escolhe se entram os Valores Unitários (R$/m³), a Diferença, o Atingimento e a Eficiência.",
    ],
  },
  {
    publicada: "2026-10-30T15:35",
    processo: "Controle de Usuários",
    tela: "Perfis",
    rota: "/perfis",
    itens: [
      "Acesso a Informações Sensíveis no perfil: sem ele, o usuário vê os valores das linhas de Mão de Obra Direta e Indireta, mas não as movimentações delas. Os perfis que já existiam continuam com o acesso.",
      "Inativar e Reativar os perfis (menos o Administrador), com a caixa Mostrar Inativados; no menu, os Perfis vêm antes dos Usuários.",
    ],
  },
  {
    publicada: "2026-10-30T15:35",
    processo: TODO_O_SIG,
    tela: "Tabelas",
    itens: [
      "O Exportar (Excel e PDF) em todas as telas com tabela, com as linhas que os filtros dos rótulos deixam.",
      "Ao recarregar a página, a aba que estava aberta continua aberta.",
    ],
  },
  {
    publicada: "2026-10-30T15:35",
    processo: TODO_O_SIG,
    tela: "Modais",
    itens: [
      "O modal aberto sobre outro escurece também o de baixo.",
      "O rodapé com os botões fica preso embaixo do modal ao rolar.",
      "As confirmações (excluir, inativar…) usam o modal do SIG, no lugar da confirmação do navegador.",
    ],
  },
  {
    publicada: "2026-10-30T15:35",
    processo: "Resultados PROVA",
    soAdministrador: true,
    itens: ["O processo Resultados ROVA, em desenvolvimento, passa a se chamar Resultados PROVA; o Indicadores VPR saiu de Análises Gerenciais."],
  },
  // 27/10/2026, 16:00
  {
    publicada: "2026-10-27T16:00",
    processo: "Contestações de Gastos",
    soAdministrador: true,
    itens: ["Novo processo em Apuração dos Resultados, logo acima do Fechamento Mensal, em desenvolvimento."],
  },
  {
    publicada: "2026-10-27T16:00",
    processo: "Registros dos Indicadores",
    soAdministrador: true,
    itens: ["Novo processo em Apuração dos Resultados, logo acima dos Cadastros da Apuração, em desenvolvimento."],
  },
  {
    publicada: "2026-10-27T16:00",
    processo: "Integrações e Consultas",
    soAdministrador: true,
    itens: ["O processo Integrações, da Central de Conectividade, passa a se chamar Integrações e Consultas."],
  },
  // 27/10/2026, 15:37
  {
    publicada: "2026-10-27T15:37",
    processo: "Demonstrativos Financeiros",
    soAdministrador: true,
    itens: ["Novo processo em Análises Gerenciais, em desenvolvimento."],
  },
  // 27/10/2026, 15:29
  {
    publicada: "2026-10-27T15:29",
    processo: "Relatórios Executivos",
    rota: RE,
    itens: ["Na barra do topo, a situação do relatório (Em Elaboração ou Finalizado) fica à direita, depois das abas."],
  },
  {
    publicada: "2026-10-27T15:29",
    processo: "Fechamento Mensal",
    tela: "Barra de Etapas",
    rota: "/competencias/0000-00/importar",
    itens: ["A situação da competência fica à direita da barra de etapas, depois de Divergências."],
  },
  {
    publicada: "2026-10-27T15:29",
    processo: "Balanço Patrimonial",
    soAdministrador: true,
    itens: ["Novo processo em Apuração dos Resultados, em desenvolvimento."],
  },
  // 27/10/2026, fim da tarde
  {
    publicada: "2026-10-27T14:51",
    processo: "Relatórios Executivos",
    rota: RE,
    itens: [
      "O slide é montado na tela padrão (1920 × 1080) e, na apresentação e no PDF, se ajusta inteiro à tela de quem abre: os blocos ficam nos mesmos lugares em qualquer resolução.",
      "Transições, antes do Adicionar: Esmaecer, Rolar Vertical ou Rolar Horizontal, para os slides do grupo aberto.",
      "Na Imagem de Fundo, Aplicar Em Todo o Grupo põe a mesma imagem, com a posição e os ajustes, em todas as páginas do grupo.",
      "A Anotação e o Texto Livre crescem sozinhos quando o texto passa da altura da caixa.",
      "Cortar e Posicionar (ao adicionar uma imagem e no menu da edição): o tamanho do bloco — na proporção da imagem, numa fração do slide ou o atual —, a posição e o tamanho da imagem no quadro e os ajustes de brilho, matiz, saturação, desfoque e transparência.",
      "Nos modais das imagens, os valores das barras também se digitam, e o Restaurar Ajustes fica no rodapé.",
      "Ao criar um relatório a partir de outro, as imagens de fundo vêm sempre, mesmo sem manter as imagens e os textos.",
      "O Excluir Relatório fica na aba Configurações. Na lista do Cenário de Comparação, sem cenário escolhido, fica em destaque o marcado como Orçamento.",
    ],
  },
  {
    publicada: "2026-10-27T14:51",
    processo: "Fechamento Mensal",
    tela: "Linhas",
    rota: "/competencias/0000-00/linhas",
    itens: ["A etapa Linhas mostra a DRE das linhas no mês, na mesma estrutura da aba Linhas dos Resultados Empresariais."],
  },
  {
    publicada: "2026-10-27T14:51",
    processo: "Resultados Empresariais",
    tela: "Resultados",
    rota: RESULTADOS,
    itens: ["A aba Rateios por Obras saiu da tela; ela volta, como Rateios das Linhas, no processo Resultados por Obra."],
  },
  {
    publicada: "2026-10-27T14:51",
    processo: "Painéis e Apresentações",
    soAdministrador: true,
    itens: ["Novo processo em Análises Gerenciais, em desenvolvimento."],
  },
  // 27/10/2026, tarde
  {
    publicada: "2026-10-27T12:35",
    processo: TODO_O_SIG,
    tela: "Sobre Esta Tela",
    itens: [
      "Os textos do Sobre e do Como Usar de cada tela trazem só o caminho e o uso atuais, com os nomes novos das telas do Fechamento Mensal.",
    ],
  },
  {
    publicada: "2026-10-27T12:35",
    processo: "Resultados Empresariais",
    tela: "Resultados",
    rota: RESULTADOS,
    itens: [
      "No Exportar, em Excel, a caixa Incluir a Aba Detalhes acrescenta no fim do arquivo os movimentos do balancete de cada aba exportada, item a item (a emissão, o cliente ou fornecedor e o histórico), com a parte que vai à aba, como no Exportar dos extratos.",
    ],
  },
  {
    publicada: "2026-10-27T12:35",
    processo: "Fechamento Mensal",
    tela: "Totais",
    rota: "/competencias/0000-00/indicadores",
    itens: [
      "A tela Totais junta os Indicadores e os Rateios do mês, cada um numa aba.",
    ],
  },
  {
    publicada: "2026-10-27T12:35",
    processo: "Fechamento Mensal",
    tela: "Prévias",
    rota: "/competencias/0000-00/receita-previa",
    itens: [
      "A tela Prévias (Prévias de Receita e Estoque) junta a Receita e o Estoque do mês, cada um numa aba.",
    ],
  },
  {
    publicada: "2026-10-27T12:35",
    processo: "Fechamento Mensal",
    tela: "Resultados",
    rota: DRE,
    itens: [
      "A tela DRE do mês passa a se chamar Resultados.",
    ],
  },
  {
    publicada: "2026-10-27T12:35",
    processo: "Controle de Usuários",
    tela: "Perfis",
    rota: "/perfis",
    itens: [
      "Na matriz do perfil, as telas Totais (abas Indicadores e Rateios) e Prévias (abas Receita e Estoque) do Fechamento Mensal, com as permissões que cada perfil já tinha; a DRE do mês aparece como Resultados.",
    ],
  },
  // 27/10/2026
  {
    publicada: "2026-10-27T08:38",
    processo: TODO_O_SIG,
    tela: "Menu Lateral",
    itens: [
      "A Central de Conectividade passa para cima da Controladoria.",
    ],
  },
  {
    publicada: "2026-10-27T08:38",
    processo: "Resultados Empresariais",
    tela: "Resultados",
    rota: RESULTADOS,
    itens: [
      "As abas Linhas e Rateios por Obras, antes de Obras: a DRE de cada linha de produto e de obra, da receita à Margem de Contribuição, e só os custos dela que não vieram dos centros de obra, com a lista das linhas por unidade.",
      "O Exportar traz a Linha Atual, Todas as Linhas e os Rateios por Obras de Todas as Linhas.",
    ],
  },
  {
    publicada: "2026-10-27T08:38",
    processo: "Fechamento Mensal",
    tela: "Linhas",
    rota: "/competencias/0000-00/linhas",
    itens: [
      "A etapa Linhas, depois da DRE: a apuração divide a DRE de cada unidade entre as linhas de produto e de obra e grava o resultado, que o fechamento trava.",
      "A conferência do mês antes de fechar: a Margem de Contribuição da DRE de cada unidade contra a soma das linhas, a margem de cada linha, de que passo veio cada valor, os documentos e os avisos.",
      "Nas competências fechadas antes da etapa, o botão Gravar grava as linhas uma vez; a competência apurada antes dela não fecha sem reapurar.",
    ],
  },
  {
    publicada: "2026-10-27T08:38",
    processo: "Fechamento Mensal",
    tela: "Importações",
    rota: "/competencias/0000-00/importar",
    itens: [
      "As Requisições e as Notas Fiscais voltaram (as abas Requisições (Lista) e Notas Fiscais (Lista) do LISTAS REALIZADO (RESULTADOS), também no Importar Arquivo): a tarefa delas leva os custos às linhas. Importá-las depois de apurar pede reapurar.",
      "As listas avisam os registros que citam uma linha inativa.",
    ],
  },
  {
    publicada: "2026-10-27T08:38",
    processo: "Cadastros da Controladoria",
    tela: "Alocação nas Linhas",
    rota: "/cadastros/alocacao-linhas",
    itens: [
      "A aba Alocação nas Linhas: as regras com que os custos sem tarefa chegam às linhas — cada centro de custo, ou o rateio dos centros sem regra própria, vai a uma linha ou se divide por uma base (volume produzido, projetos, kg da metalúrgica e da armadura, dias de acompanhamento ou receita).",
    ],
  },
  {
    publicada: "2026-10-27T08:38",
    processo: "Cadastros da Controladoria",
    tela: "Regras de Rateio",
    rota: "/cadastros/regras-rateio",
    itens: [
      "Nos rateios fixos, cada destino com percentual se divide entre as linhas da unidade dele, somando 100%: é como a parte do rateio chega às linhas na etapa Linhas.",
    ],
  },
  {
    publicada: "2026-10-27T08:38",
    processo: "Cenários Analíticos",
    rota: "/cenarios/analiticos",
    itens: [
      "As premissas trazem só as linhas ativas do cadastro (a Metalúrgica passa a ser linha de apoio, inativa).",
    ],
  },
  {
    publicada: "2026-10-27T08:38",
    processo: "Controle de Usuários",
    tela: "Perfis",
    rota: "/perfis",
    itens: [
      "Na matriz do perfil: a aba Alocação nas Linhas, a etapa Linhas do Fechamento Mensal (Editar grava as linhas dos meses fechados) e as abas Linhas e Rateios por Obras dos Resultados Empresariais.",
      "O grupo Central de Conectividade antes da Controladoria, como no menu.",
    ],
  },
  // 26/10/2026
  {
    publicada: "2026-10-26T15:47",
    processo: "Relatórios Executivos",
    tela: "Relatório Executivo",
    rota: RE,
    itens: ["O bloco movido uma só coluna ou linha, para um espaço vazio, passa a ficar no lugar novo: antes, não se salvava e voltava ao lugar ao escolher outro bloco."],
  },
  {
    publicada: "2026-10-26T09:56",
    processo: TODO_O_SIG,
    tela: "Novidades",
    itens: ["O modal Novidades, no menu do usuário: o resumo do que cada publicação trouxe às telas que você usa. O sino ao lado do nome avisa quando há novidades."],
  },
  {
    publicada: "2026-10-26T09:56",
    processo: TODO_O_SIG,
    tela: "Introdução ao SIG",
    itens: ["A Introdução ao SIG, no menu do usuário, ficou mais curta: vai direto ao layout e às partes das telas."],
  },
  {
    publicada: "2026-10-26T09:56",
    processo: "Central de Conectividade",
    tela: "APIs",
    rota: "/central-de-conectividade/biblioteca-de-apis",
    itens: [
      "A nova Central de Conectividade, com a Biblioteca de APIs: as DREs, os cards e os indicadores do Painel de Bordo dos Resultados Empresariais e dos Cenários para outros aplicativos (planilhas, o Power BI), em tabela ou em visual, com o login e a senha do SIG.",
      "Em abas: Como Conectar (os passos e os exemplos em curl e no Power Query), Resultados Empresariais e Cenários (as APIs, com Pré-visualizar) e Acesso às APIs (quem chama e de onde, com os bloqueios).",
      "As APIs ficam desligadas até o TI ligá-las no endereço com HTTPS; a biblioteca, a pré-visualização e os bloqueios já funcionam.",
    ],
  },
  {
    publicada: "2026-10-26T09:56",
    processo: "Controle de Usuários",
    tela: "Perfis",
    rota: "/perfis",
    itens: ["Na matriz do perfil, o grupo Central de Conectividade: a Biblioteca de APIs (Ler, para usar as APIs; Editar, para bloquear APIs, usuários e endereços)."],
  },
  {
    publicada: "2026-10-26T09:56",
    processo: "Controle de Usuários",
    tela: "Auditoria",
    rota: "/auditoria",
    itens: ["Os pedidos às APIs da Biblioteca entram com Incluir Acessos, como os acessos às telas."],
  },
  // 24/10/2026
  {
    publicada: "2026-10-24T14:59",
    processo: "Relatórios Executivos",
    tela: "Relatório Executivo",
    rota: RE,
    itens: [
      "A edição como no Canva: clique num bloco para escolhê-lo; os quadrados nos cantos e nos lados o redimensionam, e a borda destacada o move.",
      "Um só menu de edição, logo abaixo das abas, com as opções do bloco escolhido (as que não valem para ele ficam quase apagadas).",
      "As alterações se salvam sozinhas: no lugar do Gravar, o aviso Salvando…, Salvo às… ou Não Salvo, antes do Adicionar.",
      "Desfazer e Refazer no menu da edição (Ctrl+Z e Ctrl+Y).",
      "Copiar e colar os blocos (Ctrl+C, Ctrl+X e Ctrl+V, ou os botões do menu), também entre páginas, abas e relatórios.",
      "Colar textos e imagens de outros programas (o modal Colar no Slide) e links de vídeos do YouTube, do Instagram, do Facebook e do LinkedIn.",
      "Ao arrastar um bloco, os outros não piscam mais.",
    ],
  },
  {
    publicada: "2026-10-24T14:59",
    processo: "Controle de Usuários",
    tela: "Auditoria",
    rota: "/auditoria",
    itens: ["As gravações seguidas de um grupo dos Relatórios Executivos pela mesma pessoa ficam numa entrada só, a mais recente (com quantas foram e desde quando)."],
  },
  {
    publicada: "2026-10-24T11:40",
    processo: "Resultados Empresariais",
    tela: "Resultados",
    rota: RESULTADOS,
    itens: ["Nos modais do extrato das contas e do Balancete, o botão Exportar baixa o Excel com as Movimentações e os Detalhes, item a item."],
  },
  {
    publicada: "2026-10-24T11:40",
    processo: "Fechamento Mensal",
    tela: "DRE",
    rota: DRE,
    itens: ["Nos modais do extrato das contas e do Balancete, o botão Exportar baixa o Excel com as Movimentações e os Detalhes, item a item."],
  },
  {
    publicada: "2026-10-24T11:04",
    processo: "Resultados Empresariais",
    tela: "Resultados",
    rota: RESULTADOS,
    itens: ["Em Serviços, a linha Frete e Descarga nos Gastos Gerais Variáveis, com o frete dos complementares (o percentual sobre a Receita Líquida Complementar)."],
  },
  {
    publicada: "2026-10-24T11:04",
    processo: "Fechamento Mensal",
    tela: "DRE",
    rota: DRE,
    itens: ["Em Serviços, a linha Frete e Descarga nos Gastos Gerais Variáveis, com o frete dos complementares."],
  },
  {
    publicada: "2026-10-24T11:04",
    processo: "Cenários Sintéticos",
    rota: "/cenarios/sinteticos",
    itens: ["O Frete e Descarga dos complementares também nos cenários, na visão Serviços."],
  },
  {
    publicada: "2026-10-24T11:04",
    processo: "Cenários Analíticos",
    rota: "/cenarios/analiticos",
    itens: ["O Frete e Descarga dos complementares também nos cenários, nas premissas das linhas complementares."],
  },
  {
    publicada: "2026-10-24T09:39",
    processo: "Cadastros da Controladoria",
    tela: "Contas de Resultado",
    rota: "/cadastros/contas-resultado",
    itens: [
      "O Departamento da conta passou a ser editável.",
      "A gravação recusa a conta que nenhuma aba de Resultados lê e mostra as combinações permitidas, para escolher uma.",
      "Recarregar pela planilha também recusa essas contas, em vermelho na prévia.",
    ],
  },
  {
    publicada: "2026-10-24T09:39",
    processo: TODO_O_SIG,
    tela: "Topo da Tela",
    soAdministrador: true,
    itens: ["Para o Administrador, ao lado do nome, quantos usuários estão online (os nomes aparecem ao parar o mouse em cima)."],
  },
  // 23/10/2026
  {
    publicada: "2026-10-23T18:44",
    processo: TODO_O_SIG,
    tela: "Endereço e Banco de Dados",
    itens: ["O SIG passou para um novo banco de dados, no endereço http://192.168.0.16:3020; os dados e as telas continuam os mesmos."],
  },
  {
    publicada: "2026-10-23T18:44",
    processo: "Fechamento Mensal",
    tela: "DRE",
    rota: DRE,
    itens: ["O Apurar Competência ficou bem mais rápido (de cerca de 85 para 9 segundos)."],
  },
  {
    publicada: "2026-10-23T18:44",
    processo: "Controle de Usuários",
    tela: "Usuários",
    rota: "/usuarios",
    itens: ["Criar e alterar usuários com o perfil Administrador voltou a funcionar."],
  },
  {
    publicada: "2026-10-23T14:33",
    processo: "Resultados Empresariais",
    tela: "Painel de Bordo",
    rota: PAINEL,
    itens: [
      "Nos cards com gráfico, o acumulado na largura de um mês, num quadro cinza; a legenda ACUM. em negrito.",
      "Na aba Indicadores, as colunas do orçado com o nome da marcação (Previsão AGO/26, Previsão Acum.).",
    ],
  },
  {
    publicada: "2026-10-23T14:33",
    processo: "Resultados Empresariais",
    tela: "Resultados",
    rota: RESULTADOS,
    itens: ["A Comparação começa na primeira marcação que houver, na ordem Previsão, Orçamento, Anterior e Vendido."],
  },
  {
    publicada: "2026-10-23T14:33",
    processo: "Controle de Usuários",
    tela: "Auditoria",
    rota: "/auditoria",
    itens: ["Os Relatórios Executivos na Auditoria: a gravação, a finalização e a reabertura de cada grupo, com o mês."],
  },
  {
    publicada: "2026-10-23T14:33",
    processo: "Cadastros da Controladoria",
    tela: "Indicadores",
    rota: "/cadastros/estrutura-indicadores",
    itens: [
      "A Metodologia pode usar outros indicadores do cadastro e as metas, no mês ou no Acumulado no Ano.",
      "O Acumulado pode ter a própria fórmula (Fórmula do Acumulado); os indicadores de Cálculo do Sistema (GME 4, GME 8 e as Eficiências da Operação Totais) podem ser escritos pela Metodologia.",
    ],
  },
  {
    publicada: "2026-10-23T08:50",
    processo: "Relatórios Executivos",
    tela: "Relatório Executivo",
    rota: RE,
    itens: [
      "Sem o recorte de departamentos: quem lê a tela vê todas as abas, e quem a edita edita, finaliza e reabre todas.",
      "Finalizar (e Reabrir) vale para o grupo aberto, com todas as abas dele; o grupo finalizado ganha o check verde na barra do topo.",
      "Se outra pessoa gravou o mesmo grupo depois que você abriu o relatório, o aviso pergunta o que fazer: Recarregar ou Gravar por Cima.",
    ],
  },
  // 22/10/2026
  {
    publicada: "2026-10-22T19:48",
    processo: "Resultados Empresariais",
    tela: "Resultados",
    rota: RESULTADOS,
    itens: ["Na Comparação, os cenários marcados de qualquer exercício (o ano na opção; num de outro exercício, os mesmos meses dele)."],
  },
  {
    publicada: "2026-10-22T19:48",
    processo: "Resultados Empresariais",
    tela: "Painel de Bordo",
    rota: PAINEL,
    itens: ["Na Comparação, os cenários marcados de qualquer exercício."],
  },
  {
    publicada: "2026-10-22T19:48",
    processo: "Cenários Sintéticos",
    rota: "/cenarios/sinteticos",
    itens: ["As marcações com nomes curtos: Orçamento, Anterior, Vendido e Previsão."],
  },
  {
    publicada: "2026-10-22T19:48",
    processo: "Cenários Analíticos",
    rota: "/cenarios/analiticos",
    itens: ["As marcações com nomes curtos: Orçamento, Anterior, Vendido e Previsão."],
  },
  {
    publicada: "2026-10-22T19:48",
    processo: "Relatórios Executivos",
    tela: "Relatório Executivo",
    rota: RE,
    itens: [
      "A aba Configurações, antes da Capa, com o Cenário de Comparação dos cards e das tabelas (de início, o Orçamento; ou um dos cenários públicos).",
      "Nos cards e nas tabelas, o comparado com o nome do cenário escolhido.",
    ],
  },
  {
    publicada: "2026-10-22T16:37",
    processo: "Relatórios Executivos",
    tela: "Relatório Executivo",
    rota: RE,
    itens: ["Exportar em PDF: toda a apresentação, o grupo ou a aba atual.", "O bloco Tabela: os Resultados de uma aba, com o modo, os meses e as linhas."],
  },
  {
    publicada: "2026-10-22T16:37",
    processo: "Resultados Empresariais",
    tela: "Resultados",
    rota: RESULTADOS,
    itens: ["No Exportar, a opção Imagem: a tabela do jeito que está na tela, em PNG."],
  },
  {
    publicada: "2026-10-22T16:37",
    processo: "Cenários Sintéticos",
    rota: "/cenarios/sinteticos",
    itens: ["Nos Resultados do cenário, a opção Imagem no Exportar: a tabela do jeito que está na tela, em PNG."],
  },
  {
    publicada: "2026-10-22T16:37",
    processo: "Cenários Analíticos",
    rota: "/cenarios/analiticos",
    itens: ["Nos Resultados do cenário, a opção Imagem no Exportar: a tabela do jeito que está na tela, em PNG."],
  },
  {
    publicada: "2026-10-22T13:54",
    processo: "Resultados Empresariais",
    tela: "Painel de Bordo",
    rota: PAINEL,
    itens: ["Com a meta zero, o destaque com a cor de melhor ou pior.", "Os indicadores em reais com as unidades R$ em Milhões (M) e R$ em Milhares (K)."],
  },
  {
    publicada: "2026-10-22T13:54",
    processo: "Relatórios Executivos",
    tela: "Relatório Executivo",
    rota: RE,
    itens: [
      "Os cards de Indicadores no formato dos cards do Painel de Bordo, com o gráfico (os meses e o acumulado, só o acumulado ou nenhum), os Rótulos e o Tipo.",
      "Os blocos ficam onde se põem, em todas as páginas, sem se sobrepor; o bloco empurrado volta ao lugar quando o arrastado sai de cima dele.",
      "Na tela inteira, o rodapé com a legenda dos cards e o contador dos slides.",
    ],
  },
  {
    publicada: "2026-10-22T10:39",
    processo: "Relatórios Executivos",
    tela: "Relatório Executivo",
    rota: RE,
    itens: [
      "O slide tem a largura da tela inteira e se reduz na edição: a edição sai igual à apresentação.",
      "As fontes Roboto, Open Sans, Montserrat, Lato e Poppins, os tamanhos até 144 e as imagens PNG transparentes.",
      "Nas imagens, a borda, o sombreamento e o Trocar Imagem.",
    ],
  },
  {
    publicada: "2026-10-22T10:39",
    processo: "Fechamento Mensal",
    tela: "DRE",
    rota: DRE,
    itens: ["Sem o primeiro total da ROL, que passou a linha de resultado; os totais num tom mais forte.", "As exportações em Excel e PDF com os fundos amarelos da tela."],
  },
  {
    publicada: "2026-10-22T10:39",
    processo: "Fechamento Mensal",
    tela: "Conferência",
    rota: "/competencias/0000-00/conferencia-planilha",
    itens: ["A exportação sem o primeiro total da ROL e com os fundos amarelos da tela."],
  },
  {
    publicada: "2026-10-22T10:39",
    processo: "Resultados Empresariais",
    tela: "Resultados",
    rota: RESULTADOS,
    itens: ["As exportações em Excel e PDF sem o primeiro total da ROL e com os fundos amarelos da tela."],
  },
  {
    publicada: "2026-10-22T09:08",
    processo: "Fechamento Mensal",
    tela: "DRE",
    rota: DRE,
    itens: ["Ao fechar a competência, o aviso da Receita sem valor só aparece quando não há nem a receita calculada nem ajuste manual."],
  },
  {
    publicada: "2026-10-22T08:50",
    processo: "Fechamento Mensal",
    tela: "Importações",
    rota: "/competencias/0000-00/importar",
    itens: ["O Balancete com mais de uma tabela dinâmica na aba: o total do mês é a soma dos Total Geral (o mesmo mês em duas tabelas é recusado)."],
  },
];

/** A publicação mais recente: ao abrir as Novidades, tudo até ela fica visto. */
export const ULTIMA_PUBLICACAO = NOVIDADES.reduce((m, n) => (n.publicada > m ? n.publicada : m), "");

/** As novidades das telas que o usuário alcança (as do Administrador, só para ele). */
export function novidadesDoUsuario(pode: (permissao: string) => boolean, administrador: boolean) {
  return NOVIDADES.filter((n) => {
    if (n.soAdministrador && !administrador) return false;
    const permissao = n.rota ? permissaoDaTela(n.rota) : null;
    return !permissao || pode(permissao);
  });
}

/** A ordem dos processos no modal: Todo o SIG e, depois, a do menu lateral. */
export function ordemDoProcesso(processo: string) {
  if (processo === TODO_O_SIG) return -1;
  const i = navGrupos.flatMap((g) => g.itens).findIndex((x) => x.title === processo);
  return i < 0 ? 999 : i;
}

/** O ícone do processo no menu lateral. */
export const iconeDoProcesso = (processo: string) => navGrupos.flatMap((g) => g.itens).find((x) => x.title === processo)?.icon;

/** Até quando o usuário viu as novidades (a publicada da última vista), guardado no navegador; nunca, null. */
const CHAVE = (usuarioId: string) => `sig-bpm:novidades-vistas:${usuarioId}`;
const EVENTO = "sig-bpm:novidades-vistas";

export function vistasAte(usuarioId: string): string | null {
  try {
    return localStorage.getItem(CHAVE(usuarioId));
  } catch {
    return null;
  }
}

export function marcarVistas(usuarioId: string) {
  try {
    localStorage.setItem(CHAVE(usuarioId), ULTIMA_PUBLICACAO);
  } catch {
    // Sem o armazenamento do navegador, o sino volta na próxima vez.
  }
  window.dispatchEvent(new Event(EVENTO));
}

/** Avisa quando as vistas mudam (nesta ou em outra aba do navegador), para o useSyncExternalStore. */
export function assinarVistas(avisar: () => void) {
  window.addEventListener(EVENTO, avisar);
  window.addEventListener("storage", avisar);
  return () => {
    window.removeEventListener(EVENTO, avisar);
    window.removeEventListener("storage", avisar);
  };
}
