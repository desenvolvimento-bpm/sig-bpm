"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { useAbaLembrada } from "@/hooks/useAbaLembrada";
import { Abas } from "@/components/shared/Abas";
import { CabecalhoDaTela } from "@/components/shared/CabecalhoDaTela";
import { usePermissions } from "@/context/PermissionContext";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";

import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";

import { AvisoMarcado, AvisoReajustesAplicados, estaTravado } from "../../../components/AvisoMarcado";
import { AvisoRateiosSemBase, CentrosDoCenario, RateiosDoCenario } from "../../../components/CentrosDoCenario";
import { Erro } from "../../../components/CenarioDialog";
import { ExtraDoCenario, InvestimentosDoCenario } from "../../../components/InvestimentosDoCenario";
import { IndicadoresManuais } from "../../../components/IndicadoresManuais";
import { BotaoImportarValores, ExportarPremissas } from "../../../components/PlanilhaPremissas";
import { QuadroDoCenario } from "../../../components/QuadroDoCenario";
import { TabelaPremissas } from "../../../components/TabelaPremissas";
import { cenariosService, NOME_DO_DEPARTAMENTO } from "../../../services/cenariosService";

/**
 * As abas das premissas: as unidades, o Quadro de Lotação (09/11/2026), os centros de custo, os rateios, os investimentos,
 * o extra-operacional e os indicadores manuais (os Reajustes ficam nas Configurações desde 12/11/2026).
 */
const ABAS = [
  { chave: "1", rotulo: "Matriz" },
  { chave: "2", rotulo: "Filial" },
  { chave: "3", rotulo: "Serviços" },
  { chave: "quadro", rotulo: "Quadro de Lotação" },
  { chave: "centros", rotulo: "Centros de Custo" },
  { chave: "rateios", rotulo: "Rateios" },
  { chave: "investimentos", rotulo: "Investimentos" },
  { chave: "extra", rotulo: "Extra-Operacional" },
  { chave: "manuais", rotulo: "Indicadores Manuais" },
];

/**
 * A tela Premissas de um cenário analítico (13/10/2026): as tabelas de cada unidade (Matriz e Filial, Global e
 * Mercantil; Serviços, só Global), de onde a DRE do cenário se calcula.
 */
export function PremissasContent() {
  const { id } = useParams<{ id: string }>();
  useRegistrarAcessoTela(`/cenarios/analiticos/${id}/premissas`);
  const [escolhida, setAba] = useAbaLembrada("unidade", "1");
  const { hasPermission } = usePermissions();
  // As abas que o perfil lê, e a edição de cada uma (14/10/2026).
  const abaDaChave = (c: string) => ({ 1: "matriz", 2: "filial", 3: "servicos" })[c] ?? c;
  const cenario = useQuery({ queryKey: ["cenarios", id], queryFn: () => cenariosService.obter(id) });
  // Com o Acesso às Informações Por Recorte (12/11/2026), só as abas do recorte do usuário.
  const recorte = cenario.data?.recorte ?? null;
  const abas = ABAS.filter((a) => hasPermission(`cenarios_analiticos_premissas.${abaDaChave(a.chave)}:ler`) && (!recorte || recorte.abas.includes(a.chave)));
  const aba = abas.some((a) => a.chave === escolhida) ? escolhida : (abas[0]?.chave ?? "");
  const editaAba = hasPermission(`cenarios_analiticos_premissas.${abaDaChave(aba)}:editar`);
  const quadro = aba === "quadro";
  const centros = aba === "centros";
  const rateios = aba === "rateios";
  const investimentos = aba === "investimentos";
  const extra = aba === "extra";
  const manuais = aba === "manuais";
  const deUnidade = ["1", "2", "3"].includes(aba);
  const consulta = useQuery({ queryKey: ["cenarios", id, "premissas", aba], queryFn: () => cenariosService.premissas(id, Number(aba) as 1 | 2 | 3), enabled: deUnidade });
  const travado = !!cenario.data && estaTravado(cenario.data);
  // Com os reajustes aplicados na DRE (11/11/2026, pedido do Adão), só os Indicadores Manuais se editam.
  const comReajustes = !!cenario.data?.reajustesAplicados;
  const bloqueadaPelosReajustes = comReajustes && !manuais;
  const podeEditar = editaAba && !travado && !bloqueadaPelosReajustes && (!deUnidade || !!consulta.data?.editavel);
  // Os botões da planilha (15/10/2026), na altura do título: Importar Valores (alguma aba editável; sai com os reajustes
  // aplicados) e Exportar Premissas. O Replicar Médias e o Apagar Valores ficam em Configurações / Referência (12/11/2026).
  const editaAlguma = abas.some((a) => hasPermission(`cenarios_analiticos_premissas.${abaDaChave(a.chave)}:editar`));
  const editaPlanilha = !!cenario.data && !travado && !comReajustes;
  return (
    <div className="space-y-6">
      <CabecalhoDaTela
        titulo="Premissas"
        acoes={
          abas.length ? (
            <div className="flex flex-wrap items-center gap-2">
              {editaPlanilha && editaAlguma ? <BotaoImportarValores id={id} /> : null}
              <ExportarPremissas id={id} />
            </div>
          ) : null
        }
        comoUsar={
          <ul>
            <li>Escolha a unidade nas abas: Matriz e Filial têm uma tabela para a venda Global e outra, embaixo, para a Mercantil; Serviços, só a Global. Aparecem só as abas que o seu perfil lê (Controle de Usuários / Perfis).</li>
            <li>
              Com o Acesso às Informações Por Recorte (Configurações / Cenário), quem tem recorte no perfil vê só o seu recorte: o Gestor, as abas e
              as linhas dos departamentos dele (os centros de custo, o Quadro de Lotação, os rateios, os investimentos e os indicadores manuais, só os
              deles); o Coordenador, só os grupos de centros com algum centro dele, no Quadro de Lotação, nos Centros de Custo e nos Rateios. O aviso
              acima das abas diz o recorte; o Exportar Premissas e o Importar Valores ficam no recorte.
            </li>
            <li>
              Na aba Quadro de Lotação, as linhas do quadro do cenário, como as do Lançamento Inicial da Gestão de Colaboradores: a Unidade, o Tipo
              (CLT ou PJ), a Senioridade, a Função e o Centro de Custo (dos grupos de centros do cenário) e, em cada mês, quatro colunas — os
              Colaboradores, o Salário Bruto e a Insalubridade / Periculosidade de cada colaborador e o Salário Total (a soma) —, com o Custo no Ano
              (colaboradores × Salário Total nos doze meses) e, no rodapé, os colaboradores e a folha de cada mês. No destaque acima da tabela, busque as linhas pela
              função, pelo centro, pela unidade ou pela senioridade, e mostre todos os meses ou um só.
              {podeEditar
                ? " “Nova Entrada” abre o modal com os cadastros e os colaboradores e os salários de cada um a partir do mês escolhido; na tabela, digite os valores de cada mês e clique em “Gravar” (ou “Descartar”). O menu Ações de cada linha edita os cadastros ou a exclui; para excluir várias, marque as caixas e clique em “Excluir Selecionadas”."
                : null}{" "}
              O grupo de centros com linhas conta por elas, na aba Centros de Custo, os Colaboradores Aprendizes (a senioridade Aprendiz: o Jovem
              Aprendiz), os Colaboradores Estagiários (a senioridade Estagiário: os estagiários e os bolsistas), os Colaboradores CLT e os PJ (as demais
              senioridades, pelo Tipo), os Salários de cada um dos quatro (colaboradores × Salário Total) e as Remunerações, que não se digitam ali:
              todos vão para a mão de obra da atribuição do grupo (Direta, a MOD; Indireta ou sem atribuição, a MOI), com as Remunerações CLT = Salários
              dos Aprendizes + Salários dos Estagiários + Salários CLT e as Remunerações PJ = Salários PJ; a outra mão de obra fica sem remunerações
              daqui. Nos encargos, o Aprendiz tem o Fundo de Garantia: Aprendiz (2%), e o Estagiário não tem encargos (o salário dele sai da base). Os
              colaboradores, os salários e as Remunerações CLT e PJ vêm sempre daqui, em todos os grupos (o grupo sem linhas fica com eles zerados): esta aba, alimentada pela Gestão de Colaboradores (o
              “Importar Quadro de Lotação Vigente” da Referência, nas Configurações, traz o Quadro de Lotação mais recente), é a única fonte da contagem.
            </li>
            <li>
              Na aba Centros de Custo, escolha o grupo de centros da Controladoria na lista à esquerda (com a busca e o total do exercício; os centros de
              estoque e de investimento não entram) e digite, à direita, na tabela Premissas do grupo (o Quadro de Lotação — os Colaboradores Aprendizes,
              Estagiários, CLT e PJ, o Total de Colaboradores, a soma, e os Salários dos Aprendizes, dos Estagiários, CLT e PJ — vem da aba Quadro de
              Lotação e não se digita): os Encargos e Benefícios (os percentuais de Previdência Social (INSS), Fundo de
              Garantia: Aprendiz (FGTS), Fundo de Garantia: CLT (FGTS), Férias (+1/3) e Décimo Terceiro — em cinza, o padrão, 29%, 2%, 8%, 11,11% e
              8,33%, até você digitar outro — e os Benefícios Adicionais, em R$); e os valores mensais das contas (as Remunerações CLT e PJ não: vêm
              sempre dos Salários do Quadro de Lotação, na mão de obra da atribuição do grupo — as CLT, os Salários dos Aprendizes, dos Estagiários e
              CLT; as PJ, os Salários PJ —, e na outra mão de obra e sem linhas do grupo lá ficam zeradas): mão de obra direta e indireta e gastos
              gerais diretos, indiretos e comerciais (a Mão de Obra Terceirizada, as Matérias Primas, os Gastos Gerais Variáveis e o Estoque ficam nas
              tabelas das unidades, em R$ por unidade; a depreciação, nos investimentos). A conta Encargos e Benefícios não se digita: é a base
              (Remunerações CLT + Horas Extras − Salários dos Estagiários) × [INSS + FGTS CLT + Férias + Décimo Terceiro + (INSS + FGTS CLT) × (Férias +
              Décimo Terceiro)] + (FGTS Aprendiz − FGTS CLT) × Salários dos Aprendizes × (1 + Férias + Décimo Terceiro) + os Benefícios Adicionais
              (os Salários dos Aprendizes e dos Estagiários e os Benefícios Adicionais, só na mão de obra da atribuição do grupo) — o FGTS de cada um
              sobre os seus salários; as Remunerações PJ e os estagiários não têm encargos. No destaque acima da tabela, o grupo, os centros dele, o balde e para onde vai o valor e, à direita, os valores marcados, “Marcar Todos os Meses”, “Reajustar Marcados” e “Replicar Referências”; o grupo com centros de
              baldes diferentes tem um asterisco na lista e o aviso (o valor vai pelo balde mais comum; o balde vem do cadastro Centros de Custo, nos
              Cadastros Gerais). Para baixar os centros em Excel, use “Exportar Premissas”, ao lado do título (um centro de custo por aba
              ou um arquivo por centro).
            </li>
            <li>
              Na aba Rateios, a base de cada mês (das premissas) e o percentual de cada destino: Produção pelo m³ produzido; Projeto pelo m³ produzido da venda
              Global; Metalurgia e Armadura pelo kg de cada linha (o volume × a Metalúrgica (Interno) Unit. ou a Armadura (Interno) Unit.); Acompanhamento pelos
              Acompanhamentos por Dia das linhas de Serviços (× os dias úteis). Sem base no mês, o percentual é zero, e o valor dos grupos daquela chave não entra.
            </li>
            <li>
              Na aba Investimentos, em cima, a Depreciação Base de cada unidade mês a mês (digitada: o maquinário de produção na Matriz e na Filial, o de
              serviços em Serviços e o patrimônio em Despesas e Extra), com a depreciação dos investimentos e a total; embaixo, a lista dos investimentos.
              Cada uma tem o título e a descrição num card de destaque, com as funções dela à direita (na Depreciação, os valores marcados, “Marcar Todos
              os Meses”, “Reajustar Marcados” e “Replicar Referências”; nos Investimentos, os botões da lista e “Exportar”, que leva a lista em Excel ou PDF).
              {podeEditar
                ? " Clique em “Novo Investimento” para incluir um, ou numa linha da lista para editá-lo ou excluí-lo; para excluir vários, marque as caixas da lista (a do rótulo marca todos) e clique em “Excluir Selecionados”."
                : null} Cada investimento
              tem o Nome de Referência (único no cenário; identifica o investimento na planilha), a unidade (a conta é a de depreciação dela), em Despesas e Extra o Departamento (Logística, Técnico, Comercial, Administrativo ou Extra-Operacional; sem ele, é dos cinco — com o Acesso às Informações Por Recorte, quem tem recorte o escolhe entre os seus), a descrição, a condição de pagamento (texto livre), o mês de início, o valor total, o
              valor pós uso e a vida útil em meses; a lista mostra a depreciação mensal.
            </li>
            <li>
              Na aba Extra-Operacional, como nos Lançamentos Manuais do fechamento, os valores mensais do imposto de renda e da contribuição social e das
              receitas e despesas financeiras, em Despesas e Extra e no RN, cada uma com o título num card de destaque e, à direita dele, os valores
              marcados, “Marcar Todos os Meses”, “Reajustar Marcados” e “Replicar Referências”.
            </li>
            <li>
              Na aba Indicadores Manuais, os indicadores do Comercial e do Administrativo, que não saem da DRE
              {podeEditar ? ": clique numa linha para digitar os doze meses (as células digitadas ficam em amarelo)" : ""}. Os quadros de lotação não
              se digitam: saem do Total de Colaboradores dos grupos de centros de custo.
            </li>
            <li>
              Com os reajustes aplicados (Configurações / Reajustes), as abas das Premissas (menos Indicadores Manuais) ficam bloqueadas para edição,
              com o aviso em cada uma; “Importar Valores” sai da altura do título, e a referência (Configurações / Referência) não se carrega.
              “Remover Reajustes” as deixa editáveis de novo.
            </li>
            <li>
              A base das premissas pode vir da referência (Configurações / Referência): o resultado realizado (as Médias de Referência, os centros de
              custo, a depreciação, o extra-operacional e os indicadores) ou outro cenário analítico.
            </li>
            <li>
              Todas as abas (menos Rateios) têm a coluna Média de Ref.: a média do realizado da referência. A referência realizada carrega só as médias:
              os meses do cenário ficam em branco (no Mês a Mês, os centros de custo, a depreciação, o extra-operacional e os indicadores trazem também cada mês fechado no seu mês). Mês em branco é mês sem valor (zero; nos Dias
              Úteis, os do calendário, em cinza).
            </li>
            <li>
              “Replicar Médias” e “Apagar Valores” ficam em Configurações / Referência, depois do “Realocar”: o primeiro leva a Média de
              Referência de cada linha aos doze meses, em todas as abas (as linhas sem média ficam como estão); o segundo deixa os doze meses de
              todas as abas em branco (as Médias de Referência ficam). Cada um abre o seu modal, que confirma antes de gravar; os dois pedem
              editar todas as abas.
            </li>
            <li>
              “Exportar Premissas” abre o modal: marque os departamentos e escolha o tipo (Todas as Abas, com os centros de custo numa aba; Um Centro
              de Custo por Aba; ou Um Arquivo por Centro de Custo, num ZIP com um arquivo também para as demais abas). O arquivo leva só o que é dos
              departamentos: Produção, a Matriz, a Filial, os centros de produção e a depreciação e os investimentos delas; Serviços, a aba Serviços, os
              centros de serviços e a depreciação e os investimentos de Serviços; Logística, Técnico, Comercial e Administrativo, os centros do
              departamento; Extra-Operacional, a aba Extra-Operacional — esses cinco com a depreciação e os investimentos de Despesas e Extra. Os
              indicadores manuais vão pelo grupo deles (o GME com o Comercial). Cada linha traz a descrição (as colunas antes da Und., que a identificam na importação: não as altere, nem o nome das abas; elas, a Und. e os rótulos ficam presos ao rolar a planilha — no Quadro de Lotação, os cadastros; nos Investimentos, até a Descrição), a unidade, os doze meses da
              referência do cenário (com ela: Realizado, o resultado realizado de cada mês do período; Referência, os meses do outro cenário — não se
              importam), a Média de Referência, o Total da Referência (a média × 12; nos percentuais, como os Encargos e Benefícios, a própria média), a Variação Máxima da conta (Configurações / Comparativo), os doze meses, Justificar?
              (uma fórmula: Sim quando o total dos doze meses passa da Variação Máxima em relação ao Total da Referência) e a Justificativa, em texto
              livre. Nos centros de custo, o Quadro de Lotação (os Colaboradores Aprendizes, Estagiários, CLT e PJ e os Salários dos Aprendizes, dos
              Estagiários, CLT e PJ, em fórmula sobre a aba Quadro de Lotação do arquivo — em Todas as Abas e em Um Centro de Custo por Aba —, e o
              Total de Colaboradores, a soma; as Remunerações CLT e PJ da mão de obra da atribuição do grupo, em fórmula sobre os Salários, e as da
              outra, zero: incluir ou mudar as linhas ou os salários da aba Quadro de Lotação muda os centros e os Encargos), os Encargos e Benefícios (os percentuais; o mês em branco vale a Média de
              Referência, o padrão) e as contas, com a Encargos e Benefícios em fórmula (as linhas calculadas não se importam nem se replicam). A aba
              Quadro de Lotação traz os departamentos do arquivo (a linha 4) e as linhas, com os cadastros (o Centro de Custo pelo código) e,
              em cada mês, os Colaboradores, o Salário Bruto, a Insalubridade / Periculosidade e o Salário Total (em fórmula), o Custo no Ano em fórmula
              e linhas em branco para as novas; com a referência, depois do Centro de Custo, os colaboradores da linha no QL Realizado da competência
              mais recente da Gestão de Colaboradores (referência realizada) ou no último mês do Quadro de Lotação do outro cenário (não se importam); ela leva as linhas dos centros dos departamentos marcados. A aba Investimentos traz a lista, com a Unidade e a Conta em listas suspensas, a Condição de Pagamento e a Depreciação Mensal em fórmula, e
              linhas em branco para os novos. No um centro de custo por aba, a primeira aba, Consolidado, traz a DRE das contas dos centros: cada
              conta somada em todas as abas dos centros (em fórmulas, que acompanham os valores das abas; também os meses da referência), para conferir com a DRE do cenário; o
              total bate, e a parte dos rateios que vai para Serviços está, na DRE, nas contas da CSM ou da CSC.
            </li>
            <li>
              “Importar Valores” abre a lista dos arquivos: escolha planilhas do Exportar Premissas (ou o ZIP) ou uma pasta com elas. Cada arquivo é
              conferido no padrão (as descrições, a Média de Referência, os doze meses e a Justificativa; cada linha se acha pelas descrições) e mostra quantos valores, justificativas e
              investimentos mudam. Quando um trecho (uma unidade, um centro de custo, a depreciação de uma unidade…) aparece em mais de um arquivo, o
              quadro dos repetidos pede, em cada um, Ignorar (vale o primeiro arquivo) ou Sobrescrever (vale o último). Na aba Investimentos, os com o
              Nome de Referência de um investimento do cenário são atualizados e os de nome novo entram na sequência dos que já existem. Na aba Quadro
              de Lotação, as linhas da planilha substituem as do cenário nos departamentos do arquivo: as iguais ficam, as de mesmos cadastros com
              outros valores são alteradas, as novas entram e as que não estão na planilha saem (a prévia mostra quantas; os cadastros conferidos
              como no Lançamento Inicial: uma unidade, senioridade, função ou centro de custo que não existe recusa o arquivo). “Importar” grava os
              meses (em branco apaga), as justificativas, os investimentos e as linhas do Quadro de Lotação, recalcula a DRE
              e registra no histórico (tela Histórico, aba Alterações).
            </li>
            <li>
              Cada tabela traz, mês a mês: a Jornada (os dias úteis, já calculados pelo calendário — segunda a sexta, menos os feriados nacionais), a
              Demanda Diária de cada linha (na
              unidade de medida dela; nas linhas de m³ e pistas, as pistas por dia e o volume por pista), a Armadura (Interno) Unit. e a Metalúrgica (Interno) Unit. (em kg por
              unidade da linha: kg/m³, kg/kg, kg/m²; só nas linhas que as levam), a Receita Bruta Média (na Matriz e na Filial, também a de Devoluções e
              Inventários, negativa) e os Impostos, os Custos (Mão de Obra Terceirizada, Matérias Primas, Gastos Gerais Variáveis e Estoque, por conta) e
              as Despesas Variáveis de Venda, em R$ por unidade da linha; antes da conta das comissões, as Comissões (em %/ROB, sobre a receita
              bruta).
            </li>
            <li>
              Os cálculos ficam em cinza-escuro e não se editam: o volume do mês (a demanda × os dias úteis), a armadura e a metalurgia do mês (o
              volume × o kg por unidade), a Receita Líquida Média, a conta das comissões (a soma das Receitas Brutas Médias × as Comissões) e, no fim, o
              Resultado das Premissas em R$ (o que a tabela leva para a DRE).
            </li>
            <li>
              Na aba Centros de Custo, o botão ao lado do nome de cada conta abre as Contas do Balancete: as contas do RM que caem nela (as que têm essa Linha
              da DRE em Cadastros Gerais › Contábil › Contas de Resultado), com o Reduzido, a Conta, a Descrição, o Departamento, o Rateio e a
              situação.
            </li>
            {podeEditar ? (
              <>
                <li>
                  Para editar um valor: clique nele. O modal mostra o valor atual, o reajuste (percentual ou absoluto) e o valor recalculado, que também se
                  digita direto; a chave “Replicar aos meses posteriores” copia o valor aos meses seguintes.
                </li>
                <li>
                  Para reajustar vários valores: marque as premissas (a caixa de uma seção ou de uma linha de produto marca as premissas dela) e os meses (a
                  caixa no rótulo de cada mês, ou “Marcar Todos os Meses”), e clique em “Reajustar Marcados”.
                </li>
                <li>
                  Para levar a Média de Referência aos meses: marque as premissas e os meses e clique em “Replicar Referências”, ao lado de “Reajustar
                  Marcados”. Depois da confirmação, cada premissa marcada recebe a Média de Ref. dela nos meses marcados; as sem a média ficam como estão.
                  Também nas abas Centros de Custo, Investimentos (a Depreciação) e Extra-Operacional; a aba Rateios não tem a Média de Referência.
                </li>
                <li>Os valores em cinza-claro são os padrões (os dias úteis do calendário, ou zero), ainda não gravados. Cada gravação recalcula a DRE do cenário (tela Resultados) e fica no histórico (tela Reajustes).</li>
              </>
            ) : null}
          </ul>
        }
        sobre={
          <>
            <p>
              As premissas do cenário analítico, de onde a DRE dele se calcula: em cada unidade e venda, o volume de cada linha é a demanda diária ×
              os dias úteis (nas linhas de m³ e pistas, as pistas × o volume por pista); cada conta é o volume × o valor unitário (os totais
              consideram só as médias e as demandas, sem ajustes); a receita líquida é a bruta × (1 − os impostos). As contas de Global e Mercantil somam-se na DRE da unidade, com os volumes (a produção e a
              expedição, iguais, a metalurgia consumida pelas linhas da unidade e a montagem), e os totais e o Consolidado saem da Estrutura da DRE.
            </p>
            <p>
              Em Serviços, as linhas de Montagem e Vedação levam à receita de montagem e aos custos da CSM; as demais, à receita complementar e à CSC. A
              Média de Referência é a média realizada da referência do cenário (Configurações / Referência / Resultado Realizado): o total do período ÷ o
              volume da linha — o m³ produzido, o m³ montado na Montagem e o kg na Metálica; as linhas de Serviços sem volume nas
              listas vão por dia útil (a demanda diária fica 1). A demanda diária é o volume do período ÷ os dias úteis dele, e os doze meses começam
              iguais às médias.
              A mão de obra direta e indireta, os gastos gerais diretos e indiretos e as despesas vêm dos centros de custo; a depreciação, dos investimentos; o imposto de
              renda, a contribuição social e o resultado financeiro, do extra-operacional.
            </p>
            <p>
              Os valores dos grupos de centros de custo vão para as unidades como no fechamento mensal, pelo balde do grupo: nos custos de produção, Matriz e
              Filial vão direto para a unidade, Unidade para a da filial dos centros, e Produção e Projeto se rateiam entre Matriz e Filial; Metalurgia e
              Armadura, também entre a Montagem e a Complementar de Serviços; nos custos de montagem, Obras vai para Serviços e Acompanhamento se rateia entre
              a Montagem e a Complementar; as despesas vão para Despesas e Extra. Os percentuais saem das bases das premissas (a aba Rateios). Em Serviços, os
              Acompanhamentos no Mês somam o Acompanhamento de Obra (d) da DRE.
            </p>
            <p>
              Na referência realizada, a receita de cada conta (Pré-Fabricado, Frete, Devoluções e Inventários, Montagem e Complementar) é a da DRE da unidade, dividida entre as
              linhas e as vendas pelos itens da receita prévia, e os impostos são os dos itens, ajustados aos da DRE da unidade. Os custos (Mão de Obra
              Terceirizada, Matérias Primas, Gastos Gerais Variáveis e Estoque) e as despesas variáveis de venda de cada conta e mês são os da DRE da unidade, divididos entre as
              linhas na proporção das requisições e das notas fiscais com a tarefa de cada linha (a Correspondência Tarefa × Linha, nos Cadastros Gerais / Linhas);
              o que não tem tarefa vai pelo m³ das linhas (pela receita, nas despesas variáveis de venda e em Serviços). A armadura e a metalurgia por
              unidade são as das listas de cada linha ÷ o volume dela. A Metalúrgica, na Matriz, presta serviço às outras linhas e não entra nas premissas: os custos dela ficam com a Estrutura, e a metalurgia que as linhas consomem é a Metalúrgica (Interno) Unit. delas. As Comissões são as da DRE da unidade
              em % da receita bruta, por venda (as da unidade divididas entre a Global e a Mercantil pela receita bruta de cada uma).
            </p>
            <p>
              Os quadros de lotação dos indicadores saem do Total de Colaboradores (Aprendizes + Estagiários + CLT + PJ) dos grupos de centros de custo, pela classificação de cada grupo: Direta
              ou Indireta pela atribuição mais comum dos centros dele; Matriz ou Filial pelo balde (o Unidade e os de rateio, pela filial em que os
              centros mais lançaram); Montagem nos grupos dos custos de montagem; as despesas e os grupos sem atribuição entram só no Quadro de Lotação
              Total. MO Direta Total e MO Indireta Total são Matriz + Filial, e MO Geral, Direta + Indireta; com eles se calculam as eficiências. Na
              referência realizada, os Colaboradores CLT e PJ de cada grupo vêm da lista Quadro de Lotação dos meses (Listas do mês): a soma dos centros de custo do grupo em cada mês fechado, e a Média de
              Referência é a soma nos meses com a lista ÷ o número deles. Os indicadores de quadro de lotação do realizado (os do Administrativo) não
              entram.
            </p>
            <p>
              A conta Encargos e Benefícios da mão de obra (direta e indireta) de cada grupo é calculada mês a mês, com o INSS e o FGTS também sobre
              as férias e o décimo terceiro: base × [INSS + FGTS CLT + Férias (+1/3) + Décimo Terceiro + (INSS + FGTS CLT) × (Férias + Décimo
              Terceiro)] + (FGTS Aprendiz − FGTS CLT) × Salários dos Aprendizes × (1 + Férias + Décimo Terceiro) + Benefícios Adicionais, com a base =
              Remunerações CLT + Horas Extras − Salários dos Estagiários (sem aprendizes e com o padrão, 63,64% da base): o FGTS de cada colaborador
              sobre os seus salários, os aprendizes (a senioridade Aprendiz, na aba Quadro de Lotação: o Jovem Aprendiz, com o INSS, as Férias e o
              Décimo Terceiro do CLT) a 2% e os demais a 8%. Os estagiários e os bolsistas (a senioridade Estagiário; Lei 11.788/2008) não têm INSS,
              FGTS, férias com o terço nem décimo terceiro: os salários deles nas Remunerações CLT saem da base. Os Salários dos Aprendizes e dos
              Estagiários entram só na mão de obra da atribuição do grupo, a que recebe as remunerações do Quadro de Lotação; na outra, a base é
              Remunerações CLT + Horas Extras. Os percentuais têm o mesmo padrão
              em todos os cenários (29% — a confirmar com a contabilidade —, 2%, 8%, 1/12 × 4/3 = 11,11% e 1/12 = 8,33%) e se editam por grupo e mês; os
              Benefícios Adicionais (vale-transporte, alimentação, plano de saúde…) se digitam em R$ e entram na mão de obra da atribuição do grupo.
              Na referência realizada, os Benefícios Adicionais de cada mês fechado e a Média de Referência deles são a diferença entre os encargos
              realizados do grupo e o cálculo com os percentuais padrão (negativa quando o realizado fica abaixo dele): assim, a conta calculada bate
              com o realizado. A Média de Referência da conta continua a do realizado.
            </p>
            <p>
              A depreciação de cada unidade é a base digitada mais a dos investimentos: cada investimento deprecia (valor total − valor pós uso) ÷ vida útil
              por mês, do mês de início até o fim da vida útil (ou do ano).
            </p>
          </>
        }
      />
      {/* O recorte do usuário (12/11/2026): o Acesso às Informações Por Recorte. */}
      {recorte ? (
        <p className="rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-2 text-sm text-gray-600">
          <span className="font-medium text-gray-900">Acesso Por Recorte.</span>{" "}
          {recorte.porCentro
            ? "Você vê só os grupos de centros de custo com algum centro seu: o Quadro de Lotação, os Centros de Custo e os Rateios deles."
            : `Você vê só as premissas ${recorte.departamentos.length === 1 ? "do departamento" : "dos departamentos"} ${recorte.departamentos.map((d) => NOME_DO_DEPARTAMENTO[d] ?? d).join(", ")}.`}
        </p>
      ) : null}
      <Abas rotulo="Unidade das premissas" ativa={aba} onMudar={setAba} abas={abas} />
      {abas.length ? <AvisoRateiosSemBase id={id} /> : null}
      {cenario.data && travado && editaAba ? (
        <AvisoMarcado cenario={cenario.data} oQue="as premissas" />
      ) : bloqueadaPelosReajustes && editaAba && !rateios ? (
        <AvisoReajustesAplicados oQue="as premissas desta aba" varios />
      ) : null}
      {!abas.length ? (
        <p className="rounded-sm border border-gray-200 bg-white p-6 text-sm text-gray-600">Seu perfil não tem acesso a nenhuma aba desta tela.</p>
      ) : quadro ? (
        <QuadroDoCenario id={id} editavel={podeEditar} />
      ) : centros ? (
        <CentrosDoCenario id={id} editavel={podeEditar} />
      ) : rateios ? (
        <RateiosDoCenario id={id} />
      ) : investimentos ? (
        <InvestimentosDoCenario id={id} editavel={podeEditar} />
      ) : extra ? (
        <ExtraDoCenario id={id} editavel={podeEditar} />
      ) : manuais ? (
        <IndicadoresManuais id={id} podeEditar={podeEditar} comReferencia />
      ) : consulta.isError ? (
        <Erro erro={mensagemDeErro(consulta.error, "Erro ao carregar as premissas.")} />
      ) : consulta.isPending ? (
        <div className="h-64 animate-pulse rounded-sm bg-gray-100" />
      ) : (
        <div className="space-y-8">
          {consulta.data.tabelas.map((t) => (
            <TabelaPremissas key={`${aba}-${t.venda}`} id={id} dados={consulta.data} tabela={t} editavel={podeEditar} />
          ))}
        </div>
      )}
    </div>
  );
}
