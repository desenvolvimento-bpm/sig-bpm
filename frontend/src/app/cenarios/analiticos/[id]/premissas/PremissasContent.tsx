"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";

import { useAbaLembrada } from "@/hooks/useAbaLembrada";
import { Abas } from "@/components/shared/Abas";
import { CabecalhoDaTela } from "@/components/shared/CabecalhoDaTela";
import { SituacaoDoSalvamento } from "@/components/shared/SituacaoDoSalvamento";
import { usePermissions } from "@/context/PermissionContext";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";

import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";

import { AvisoMarcado, AvisoReajustesAplicados, estaTravado } from "../../../components/AvisoMarcado";
import { CentrosDoCenario, RateiosDoCenario } from "../../../components/CentrosDoCenario";
import { Erro } from "../../../components/CenarioDialog";
import { ExtraDoCenario, InvestimentosDoCenario } from "../../../components/InvestimentosDoCenario";
import { IndicadoresManuais } from "../../../components/IndicadoresManuais";
import { BotaoImportarValores, ExportarPremissas } from "../../../components/PlanilhaPremissas";
import { QuadroDoCenario } from "../../../components/QuadroDoCenario";
import { TabelaPremissas } from "../../../components/TabelaPremissas";
import { VerificacoesDoCenario } from "../../../components/VerificacoesDoCenario";
import { cenariosService, NOME_DO_DEPARTAMENTO } from "../../../services/cenariosService";

/**
 * As abas das premissas: as unidades, o Quadro de Lotação (09/11/2026), os centros de custo, os investimentos, o
 * extra-operacional, os indicadores manuais, os rateios (16/11/2026, pedido do Adão), que saem das demais, e, por último
 * (20/11/2026, pedido do Adão), as Verificações (os Reajustes ficam nas Configurações desde 12/11/2026).
 */
const ABAS = [
  { chave: "1", rotulo: "Matriz" },
  { chave: "2", rotulo: "Filial" },
  { chave: "3", rotulo: "Serviços" },
  { chave: "quadro", rotulo: "Quadro de Lotação" },
  { chave: "centros", rotulo: "Centros de Custo" },
  { chave: "investimentos", rotulo: "Investimentos" },
  { chave: "extra", rotulo: "Extra-Operacional" },
  { chave: "manuais", rotulo: "Indicadores Manuais" },
  { chave: "rateios", rotulo: "Rateios" },
  { chave: "verificacoes", rotulo: "Verificações" },
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
  const leVerificacoes = hasPermission("cenarios_analiticos_premissas.verificacoes:ler") && (!recorte || recorte.abas.includes("verificacoes"));
  // As Verificações pendentes (20/11/2026): o sinal nas abas delas e na aba Verificações.
  const verificacoes = useQuery({ queryKey: ["cenarios", id, "verificacoes"], queryFn: () => cenariosService.verificacoes(id), enabled: leVerificacoes });
  const pendentesDaAba = (chave: string) => (verificacoes.data?.verificacoes ?? []).filter((v) => !v.acordo && (chave === "verificacoes" || v.aba === chave)).length;
  const sinalDa = (chave: string) => {
    const n = pendentesDaAba(chave);
    return n ? (
      <span title={`${n} ${n === 1 ? "verificação pendente" : "verificações pendentes"}${chave === "verificacoes" ? "" : " nesta aba (veja a aba Verificações)"}`}>
        <TriangleAlert className="size-3.5 text-amber-600" aria-label="Verificações pendentes" />
      </span>
    ) : undefined;
  };
  const abas = ABAS.filter((a) => hasPermission(`cenarios_analiticos_premissas.${abaDaChave(a.chave)}:ler`) && (!recorte || recorte.abas.includes(a.chave))).map((a) => ({
    ...a,
    sinal: leVerificacoes ? sinalDa(a.chave) : undefined,
  }));
  // O grupo de centros que a aba Centros de Custo abre (o da verificação clicada).
  const [grupoDaVerificacao, setGrupoDaVerificacao] = useState<string | null>(null);
  const aba = abas.some((a) => a.chave === escolhida) ? escolhida : (abas[0]?.chave ?? "");
  const editaAba = hasPermission(`cenarios_analiticos_premissas.${abaDaChave(aba)}:editar`);
  const quadro = aba === "quadro";
  const centros = aba === "centros";
  const rateios = aba === "rateios";
  const investimentos = aba === "investimentos";
  const extra = aba === "extra";
  const manuais = aba === "manuais";
  const naVerificacoes = aba === "verificacoes";
  const deUnidade = ["1", "2", "3"].includes(aba);
  const consulta = useQuery({ queryKey: ["cenarios", id, "premissas", aba], queryFn: () => cenariosService.premissas(id, Number(aba) as 1 | 2 | 3), enabled: deUnidade });
  const travado = !!cenario.data && estaTravado(cenario.data);
  // Com os reajustes aplicados na DRE (11/11/2026, pedido do Adão), só os Indicadores Manuais se editam.
  const comReajustes = !!cenario.data?.reajustesAplicados;
  const bloqueadaPelosReajustes = comReajustes && !manuais && !naVerificacoes;
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
              {/* A situação do salvamento (18/11/2026, pedido do Adão), como nos Relatórios Executivos: antes dos botões. */}
              {editaAlguma && !!cenario.data && !travado ? <SituacaoDoSalvamento /> : null}
              {editaPlanilha && editaAlguma ? <BotaoImportarValores id={id} /> : null}
              <ExportarPremissas id={id} />
            </div>
          ) : null
        }
        comoUsar={
          <ul>
            <li>
              Escolha a unidade nas abas: Matriz e Filial têm uma tabela para a venda Global e outra, embaixo, para a Mercantil; Serviços, só a Global. O
              nome de cada tabela (Matriz · Global, Matriz · Mercantil…) fica no destaque acima dela. Aparecem só as abas que o seu perfil lê (Controle de
              Usuários / Perfis).
            </li>
            <li>
              À direita do título, antes dos botões, a situação do salvamento, como nos Relatórios Executivos: cada alteração (o modal de um valor, o
              Reajustar Marcados, o Replicar Referências, o Importar Valores…) se salva ao ser confirmada, e a situação mostra “Salvando…”, “Salvo às 14:32”
              ou “Não Salvo”, em vermelho, quando a última gravação falhou (passe o mouse para ver o motivo).
            </li>
            <li>
              Ao rolar a tela, os rótulos de cada tabela ficam presos logo abaixo do título da tela e, um pouco abaixo deles, o destaque da tabela continua
              à vista, flutuando sobre ela, com as mesmas funções (menos nas abas Indicadores Manuais e Rateios). Nas abas com mais de uma tabela, o
              destaque que flutua é o da tabela cujos rótulos estão presos.
            </li>
            <li>
              Depois dos doze meses, as colunas Total e Média (menos nas abas Indicadores Manuais e Rateios): nos valores e nas quantidades (R$, m³, kg,
              pistas, dias…), o Total é a soma dos doze meses e a Média, o Total ÷ 12; nos colaboradores, os dois são a média do ano (a soma ÷ 12); nas
              taxas e nos percentuais (R$/m³, kg/m³, m³/dia, %…), os dois são a média dos meses com valor. O mês em branco não conta. As duas colunas
              acompanham cada gravação e não vão para o Exportar Premissas.
            </li>
            <li>
              Com o Acesso às Informações Por Recorte (Configurações / Cenário), quem tem recorte no perfil vê só o seu recorte: o Gestor, as abas e
              as linhas dos departamentos dele (os centros de custo, o Quadro de Lotação, os rateios, a depreciação, os investimentos e os indicadores
              manuais, só os deles); o Coordenador, só os grupos de centros com algum centro dele, no Quadro de Lotação, nos Centros de Custo e nos
              Rateios. A aba Investimentos é de todos os que a leem, com qualquer recorte (o Coordenador também): a lista inteira e as alterações
              dela no histórico; quem a edita inclui investimentos de qualquer unidade e departamento e, com recorte, altera e exclui só os que
              incluiu. A Depreciação segue o recorte. O aviso acima das abas diz o recorte; o Exportar
              Premissas e o Importar Valores ficam no recorte (menos a aba Investimentos, que leva e importa a lista inteira).
            </li>
            <li>
              Na aba Quadro de Lotação, as linhas do quadro do cenário, como as do Lançamento Inicial da Gestão de Colaboradores: a Unidade, o Tipo
              (CLT, PJ, Aprendiz ou Estagiário), a Função e o Centro de Custo (dos grupos de centros do cenário) e, em cada mês, cinco colunas — os
              Colaboradores, o Salário Bruto e a Insalubridade / Periculosidade da linha (os valores de todos os colaboradores dela, não de cada um), o
              Salário Total (a soma) e os Benefícios (os Benefícios Padrão aplicados à linha × os colaboradores dela; parado sobre o valor, a dica diz
              quais são, ou que o valor foi digitado na importação) —, com o Total (os Colaboradores, a média do ano; o Salário Bruto, a Insalubridade /
              Periculosidade, o Salário Total e os Benefícios, a soma dos doze meses: o custo da linha no ano) e a Média (a soma ÷ 12) e, na última
              linha, o Total: os colaboradores, a folha e os benefícios de cada mês, do Total e da Média. Os rótulos Unidade, Tipo,
              Função e Centro de Custo ordenam e filtram as linhas, como nas demais tabelas do SIG (o Centro de Custo aparece só com o nome; o
              código fica na dica). Com a referência carregada (Configurações /
              Referência), a coluna da Referência, depois do Centro de Custo, traz os Colaboradores da linha nela: os do QL Realizado da competência
              mais recente da Gestão de Colaboradores (referência realizada) ou os do último mês do Quadro de Lotação do outro cenário (em branco, a
              linha não está na referência). Os salários não têm referência.
              {podeEditar
                ? " “Nova Entrada” abre o modal com os cadastros e os colaboradores e os salários da linha a partir do mês escolhido; na tabela, clique num valor (os Colaboradores, o Salário Bruto ou a Insalubridade / Periculosidade de um mês) para editá-lo no mesmo modal das outras abas (o Valor Atual, o reajuste e o Valor Recalculado, com a chave “Replicar aos meses posteriores”); cada gravação recalcula os centros de custo, deixa a DRE pendente de recálculo (Resultados / Recalcular) e fica no histórico. Como nas outras abas, as caixas das linhas e as dos meses (no rótulo de cada mês, ou “Marcar Todos os Meses”) marcam valores, e “Limpar Seleção” desmarca tudo; “Replicar Referências”, logo antes de “Nova Entrada”, leva os Colaboradores da referência de cada linha marcada (a coluna da Referência) aos meses marcados, depois da confirmação; os salários e as linhas sem a referência ficam como estão. “Benefícios”, logo depois de “Nova Entrada” (clicável com ao menos uma linha e um mês marcados), abre o modal Benefícios das Linhas Marcadas, com os Benefícios Padrão do cenário (Configurações / Benefícios Padrão), cada um com a caixa (já marcada no que está em todos os valores marcados): “Aplicar” faz dos marcados os benefícios das linhas e dos meses marcados, no lugar dos que havia (sem nenhum marcado, esses meses ficam sem benefícios), e recalcula os centros de custo (a DRE fica pendente de recálculo). Clicar na Unidade, no Tipo, na Função ou no Centro de Custo de uma linha abre o modal Editar Linha do Quadro de Lotação, com os cadastros dela; o menu Ações de cada linha também a edita, ou a exclui."
                : null}{" "}
              O grupo de centros com linhas conta por elas, pelo Tipo, na aba Centros de Custo, os Colaboradores Aprendizes (o Jovem Aprendiz), os
              Colaboradores Estagiários (os estagiários e os bolsistas), os Colaboradores CLT e os PJ, os Salários de cada um dos quatro (a soma do Salário Total das linhas, sem multiplicar pelos colaboradores) e as Remunerações, que não se digitam ali:
              todos vão para a mão de obra da atribuição do grupo (Direta, a MOD; Indireta ou sem atribuição, a MOI), com as Remunerações CLT = Salários
              dos Aprendizes + Salários dos Estagiários + Salários CLT e as Remunerações PJ = Salários PJ; a outra mão de obra fica sem remunerações
              daqui. Nos encargos, o Aprendiz tem o Fundo de Garantia: Aprendiz (2%), e o Estagiário não tem encargos (o salário dele sai da base). Os
              colaboradores e os salários vêm sempre daqui, em todos os grupos (o grupo sem linhas fica com eles zerados): esta aba, alimentada pela Gestão de Colaboradores (o
              “Importar Quadro de Lotação Vigente” da Referência, nas Configurações, traz o Quadro de Lotação mais recente), é a única fonte da contagem.
              As Remunerações CLT e PJ também vêm daqui (o grupo sem linhas fica com elas zeradas) e não se digitam nem se importam. A única
              exceção é o “Replicar Médias” (Configurações / Referência): ele leva as Médias de Referência das Remunerações e dos Encargos e
              Benefícios (MOD e MOI) direto aos Centros de Custo, e cada grupo assim ganha a verificação Mão de Obra das Médias (os valores
              replicados ficam até o próximo “Replicar Médias”, também com outra referência mantendo os meses); quando uma
              linha dele aqui é incluída, editada ou excluída, o grupo volta a calcular por esta aba. Os Benefícios Adicionais, as Horas Extras,
              as Multas Rescisórias e o Pró-Labore se digitam nos Centros de Custo.
              Os Benefícios das linhas, somados pelos centros de cada grupo, são a linha Benefícios Padrão dos Encargos e Benefícios do grupo, na aba
              Centros de Custo.
            </li>
            <li>
              Na aba Centros de Custo, escolha o grupo de centros da Controladoria na lista à esquerda (com a busca e o total do exercício; os centros de
              estoque e de investimento não entram; ela começa na altura dos rótulos da tabela) e digite, à direita, na tabela Premissas do grupo (o Quadro de Lotação — os Colaboradores Aprendizes,
              Estagiários, CLT e PJ, o Total de Colaboradores, a soma, e os Salários dos Aprendizes, dos Estagiários, CLT e PJ — vem da aba Quadro de
              Lotação e não se digita): os Encargos e Benefícios (os percentuais de Previdência Social (INSS), Fundo de
              Garantia: Aprendiz (FGTS), Fundo de Garantia: CLT (FGTS), Férias (+1/3) e Décimo Terceiro — em cinza, o padrão, 29%, 2%, 8%, 11,11% e
              8,33%, até você digitar outro — e os Benefícios Adicionais, em R$; a linha Benefícios Padrão, a soma dos Benefícios das linhas do Quadro de
              Lotação dos centros do grupo, não se digita); e os valores mensais das contas (as Remunerações CLT e PJ não: vêm
              sempre dos Salários do Quadro de Lotação, na mão de obra da atribuição do grupo — as CLT, os Salários dos Aprendizes, dos Estagiários e
              CLT; as PJ, os Salários PJ —, e na outra mão de obra e sem linhas do grupo lá ficam zeradas): mão de obra direta e indireta e gastos
              gerais diretos, indiretos e comerciais (a Mão de Obra Terceirizada, as Matérias Primas, os Gastos Gerais Variáveis e o Estoque ficam nas
              tabelas das unidades, em R$ por unidade; a depreciação, nos investimentos). A conta Encargos e Benefícios não se digita: é a base
              (Remunerações CLT + Horas Extras − Salários dos Estagiários) × [INSS + FGTS CLT + Férias + Décimo Terceiro + (INSS + FGTS CLT) × (Férias +
              Décimo Terceiro)] + (FGTS Aprendiz − FGTS CLT) × Salários dos Aprendizes × (1 + Férias + Décimo Terceiro) (os Salários dos
              Aprendizes e dos Estagiários, só na mão de obra da atribuição do grupo) — o FGTS de cada um sobre os seus salários; as Remunerações PJ
              e os estagiários não têm encargos. Os Benefícios Adicionais e os Benefícios Padrão ficam fora da conta: somados a ela (a da mão de obra da atribuição do
              grupo), dão o total de encargos e benefícios, que é o que vai para a DRE — também na Média de Referência —, e o Total das Premissas os soma. No destaque acima da lista e da tabela, o grupo, os centros dele, o balde e para onde vai o valor e, à direita, os valores marcados, “Marcar Todos os Meses”, “Reajustar Marcados” e “Replicar Referências”; o grupo com centros de
              baldes diferentes tem um asterisco na lista e o aviso (o valor vai pelo balde mais comum; o balde vem da aba Centros de Custo das
              Configurações, a cópia do cadastro com que o cenário calcula). Para baixar os centros em Excel, use “Exportar Premissas”, ao lado do título (um centro de custo por aba
              ou um arquivo por centro).
            </li>
            <li>
              Na tabela Premissas dos Centros de Custo, a linha do título de cada seção traz os valores dela: no Quadro de Lotação, os do Total
              de Colaboradores; nos Encargos e Benefícios, os Benefícios Adicionais + os Padrão; em cada atribuição das contas, a soma das contas
              dela (na da conta Encargos e Benefícios, com os dois benefícios); e no Total das Premissas, o total do grupo — as atribuições somam
              o Total das Premissas. A seta de cada seção recolhe e expande as linhas dela. O botão de seta antes do rótulo PREMISSAS mostra a
              tabela até os Totais (só o Quadro de Lotação e o Total das Premissas), as Atribuições (também os Encargos e Benefícios e as
              atribuições, cada um recolhido) ou as Contas (tudo aberto); o navegador guarda o nível escolhido.
            </li>
            <li>
              Na aba Investimentos, em cima, a Depreciação Base de cada unidade mês a mês (digitada: o maquinário de produção na Matriz e na Filial, o de
              serviços em Serviços e o patrimônio em Despesas e Extra), com a depreciação dos investimentos e a total; embaixo, a lista dos investimentos.
              Cada uma tem o título e a descrição num card de destaque, com as funções dela à direita (na Depreciação, os valores marcados, “Marcar Todos
              os Meses”, “Reajustar Marcados” e “Replicar Referências”; nos Investimentos, os botões da lista e “Exportar”, que leva a lista em Excel ou PDF).
              {podeEditar
                ? " Clique em “Novo Investimento” para incluir um, ou numa linha da lista para editá-lo ou excluí-lo; para excluir vários, marque as caixas da lista (a do rótulo marca todos) e clique em “Excluir Selecionados”. A coluna Incluído Por diz quem incluiu cada um: o Administrador, quem criou o cenário e quem não tem recorte no perfil alteram e excluem todos; quem tem recorte, só os que incluiu (os outros ficam sem a caixa e não abrem; os incluídos antes do registro de quem inclui, sem autor, só os primeiros alteram), também no Importar Valores."
                : null} Cada investimento
              tem o Nome de Referência (único no cenário; identifica o investimento na planilha), a unidade (a conta é a de depreciação dela), em Despesas e Extra o Departamento (Logística, Técnico, Comercial, Administrativo ou Extra-Operacional; sem ele, é dos cinco), a descrição, a condição de pagamento (texto livre), o mês de início, o valor total, o
              valor pós uso e a vida útil em meses; a lista mostra a depreciação mensal.
            </li>
            <li>
              Na aba Extra-Operacional, como nos Lançamentos Manuais do fechamento, os valores mensais do imposto de renda e da contribuição social e das
              receitas e despesas financeiras, em Despesas e Extra e no RN, cada uma com o título num card de destaque e, à direita dele, os valores
              marcados, “Marcar Todos os Meses”, “Reajustar Marcados” e “Replicar Referências”.
            </li>
            <li>
              Na aba Indicadores Manuais, os indicadores do Comercial e do Administrativo, que não saem da DRE, e a Liberação de Projetos: Matriz e a
              Liberação de Projetos: Filial (em m³; a Liberação de Projetos: Total é a soma das duas e não se digita), a base do rateio de Projeto — gravá-las
              deixa a DRE do cenário pendente de recálculo
              {podeEditar
                ? ". Clique no valor de um mês para editá-lo no mesmo modal das outras abas (o Valor Atual, o reajuste e o Valor Recalculado, com a chave “Replicar aos meses posteriores”; em branco, o mês fica sem valor); os valores digitados ficam em amarelo"
                : ""}
              . Os quadros de lotação não
              se digitam: saem do Total de Colaboradores dos grupos de centros de custo.
            </li>
            <li>
              Na aba Rateios, a última, a base de cada mês (das demais abas) e o percentual de cada destino: Produção pelo m³ produzido (abas Matriz e
              Filial); Projeto pela Liberação de Projetos: Matriz e Filial (aba Indicadores Manuais), como no Fechamento Mensal; Metalurgia e Armadura pelo kg
              de cada linha (o volume × a Metalúrgica (Interno) Unit. ou a Armadura (Interno) Unit.); Acompanhamento pelos Acompanhamentos por Dia das linhas
              de Serviços (× os dias úteis). Nas chaves com percentuais fixos nas Regras de Rateio do cenário (Configurações / Regras de Rateio), valem eles. Sem base no mês, o
              percentual é zero, e o valor dos grupos daquela chave não entra (o aviso dos meses sem base fica nos Resultados do cenário). A tabela tem
              uma linha por chave, destino e Base ou Percentual, com os filtros e a ordenação nos rótulos das colunas (Chave, Destino, Linha, Und. e
              cada mês), como nas outras tabelas do SIG.
            </li>
            <li>
              Na aba Verificações, a última, as inconsistências nos valores digitados ou importados, cada uma com a Aba (clique nela para abri-la;
              nos Centros de Custo, já no grupo), a Linha / Centro de Custo (nas do Quadro de Lotação e dos Centros de Custo, só o nome do centro; a
              função, o tipo ou a conta vêm no começo da explicação), a Verificação (com a explicação), os Meses, o Responsável e a Situação
              (Pendente ou De Acordo, em etiqueta). O Responsável é o responsável imediato pela linha ou pelo centro — o Analista cujo recorte o alcança; sem ele, o Coordenador ou o Gente e Gestão;
              sem ele, o Estratégico; sem ele, o Gestor (mais de um só quando são do mesmo nível); sem nenhum, quem alterou os valores por último,
              pelo Histórico (passe o mouse para ver quem alterou e quando). Ele (com Editar na aba Verificações) ou o Administrador dá o De Acordo. Com o Acesso às Informações Por Recorte (Configurações / Cenário), cada um vê as verificações do
              seu recorte (o Gestor, as dos seus departamentos; o recorte por centro, as do Quadro de Lotação e dos Centros de Custo dos grupos com
              um centro seu); com Geral, todos veem todas. As abas com verificações
              pendentes (e a própria Verificações) mostram o sinal de alerta ao lado do nome. As verificações: nas abas Matriz, Filial e Serviços,
              Valores sem Volume (receitas, impostos, custos ou kg em meses sem volume — na Variação do Estoque, sem Volume de Estoque —, que não geram
              resultado) e Volume sem Receita (volume sem a Receita Bruta Média); no Quadro de Lotação, Colaboradores sem Salário (uma por centro de
              custo, com as funções das linhas dele com colaboradores e sem salário em algum mês), Salário sem
              Colaboradores, PJ sem Aumento no Ano (o salário da linha PJ não aumenta em nenhum mês com colaboradores) e Salário que Cai (o salário por
              colaborador cai de um mês para o outro com os mesmos colaboradores); nos Centros de Custo, Salários que Não Variam com os Colaboradores (a
              quantidade de um tipo muda e os salários do grupo não), Quadro de Lotação sem Remunerações e Quadro de Lotação sem Gastos Gerais (o grupo
              com colaboradores e sem salários, ou sem valores nos gastos gerais diretos, indiretos ou comerciais, no mês), Valores Fora da DRE (o
              rateio do grupo não leva o valor a nenhuma unidade: a chave sem base no mês, a conta sem destino) e Mão de Obra das Médias (o grupo
              com as Remunerações e os Encargos do Replicar Médias, sem o Quadro de Lotação: some quando o Quadro de Lotação do grupo muda). Os textos não
              trazem os valores das remunerações: nas do Quadro de Lotação, só a função; em Valores Fora da DRE, nas contas de mão de obra, só os meses. Cada uma pede a correção dos valores
              (ela some da lista) ou o De Acordo: marque a caixa das verificações (ou use “Marcar Todas” / “Desmarcar Todas”, que valem para a tabela
              com os filtros) e clique em “De Acordo”; “Retirar Acordo” desfaz. Só o responsável por cada uma (ou o Administrador) a marca; nas
              outras, a caixa fica em cinza. O De Acordo vale enquanto os valores não mudam: mudou, a verificação volta a Pendente, com o aviso. Com
              alguma verificação pendente no cenário, a versão não se congela (Congelar Versão, na tela Resultados).
            </li>
            <li>
              As gravações das Premissas (os valores, o Quadro de Lotação, os investimentos, os indicadores manuais, as importações) refazem na hora
              as linhas calculadas das próprias Premissas (os colaboradores, as Remunerações e os Encargos e Benefícios dos centros), mas não a DRE:
              cada uma conta como uma Premissa no destaque Pendente de Recálculo da tela Resultados, cujo “Recalcular” refaz a DRE com todas.
            </li>
            <li>
              Com a caixa Aplicar Reajustes marcada (nos Resultados, antes do “Recalcular”), as abas das Premissas (menos Indicadores Manuais) ficam
              bloqueadas para edição, com o aviso em cada uma; “Importar Valores” sai da altura do título, e a referência (Configurações / Referência)
              não se carrega. Desmarcar a caixa as deixa editáveis de novo.
            </li>
            <li>
              A base das premissas pode vir da referência (Configurações / Referência): o resultado realizado (as Médias de Referência, os centros de
              custo, a depreciação, o extra-operacional e os indicadores) ou outro cenário analítico.
            </li>
            <li>
              Todas as abas (menos Rateios) têm a coluna Média de Ref.: a média do realizado da referência — a soma do período ÷ os meses dele, também
              os sem valor (uma conta com valor num só mês de 9 fica com esse valor ÷ 9; nas premissas das unidades, o total do período ÷ o volume ou
              os dias úteis dele). A referência realizada carrega só as médias:
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
              departamentos: Produção, a Matriz, a Filial, os centros de produção e a depreciação delas; Serviços, a aba Serviços, os centros de
              serviços e a depreciação de Serviços; Logística, Técnico, Comercial e Administrativo, os centros do departamento; Extra-Operacional, a
              aba Extra-Operacional — esses cinco com a depreciação de Despesas e Extra. Os
              indicadores manuais vão pelo grupo deles (o GME com o Comercial). Cada linha traz a descrição (as colunas antes da Und., que a identificam na importação: não as altere, nem o nome das abas; elas, a Und. e os rótulos ficam presos ao rolar a planilha — no Quadro de Lotação, os cadastros; nos Investimentos, até a Descrição), a unidade, os doze meses da
              referência do cenário (com ela: Realizado, o resultado realizado de cada mês do período; Referência, os meses do outro cenário — não se
              importam), a Média de Referência, o Total da Referência (a média × 12; nos percentuais, como os Encargos e Benefícios, a própria média), a Variação Máxima da conta (Configurações / Comparativo), os doze meses, Justificar?
              (uma fórmula: Sim quando o total dos doze meses passa da Variação Máxima em relação ao Total da Referência) e a Justificativa, em texto
              livre. Nos centros de custo, o Quadro de Lotação (os Colaboradores Aprendizes, Estagiários, CLT e PJ e os Salários dos Aprendizes, dos
              Estagiários, CLT e PJ, em fórmula sobre a aba Quadro de Lotação do arquivo — em Todas as Abas e em Um Centro de Custo por Aba —, e o
              Total de Colaboradores, a soma; as Remunerações CLT e PJ da mão de obra da atribuição do grupo, em fórmula sobre os Salários, e as da
              outra, zero: incluir ou mudar as linhas ou os salários da aba Quadro de Lotação muda os centros e os Encargos), os Encargos e Benefícios (os percentuais; o mês em branco vale a Média de
              Referência, o padrão; a linha Benefícios Padrão, em fórmula: a soma da coluna Benefícios das linhas dos centros do grupo na aba Quadro
              de Lotação) e as contas, com a Encargos e Benefícios em fórmula, sem os Benefícios Adicionais e os Benefícios Padrão (a soma das três
              linhas é a conta na DRE, também nos meses da referência; no Consolidado, a conta soma as três) — as linhas calculadas não se importam nem se replicam. A aba
              Quadro de Lotação traz os departamentos do arquivo (a linha 4) e as linhas, com os cadastros (o Centro de Custo pelo código) e,
              em cada mês, os Colaboradores, o Salário Bruto, a Insalubridade / Periculosidade (os da linha), o Salário Total (em fórmula) e os
              Benefícios (os da linha no mês, que se digitam: com outro valor, ele fica digitado no lugar dos Benefícios Padrão aplicados; igual, eles
              ficam e seguem os colaboradores), o Custo no Ano em fórmula
              e linhas em branco para as novas; com a referência, depois do Centro de Custo, os colaboradores da linha no QL Realizado da competência
              mais recente da Gestão de Colaboradores (referência realizada) ou no último mês do Quadro de Lotação do outro cenário (não se importam); ela leva as linhas dos centros dos departamentos marcados. A aba Investimentos traz todos os investimentos do cenário (qualquer departamento), com a Unidade e a Conta em listas suspensas, a Condição de
              Pagamento e a Depreciação Mensal em fórmula, e linhas em branco para os novos; no Importar Valores, ela substitui os seus investimentos (os
              que você incluiu): os seus que não estão nela saem do cenário, os outros entram ou são atualizados pelo Nome de Referência, e os de outros
              usuários ficam (com recorte, alterá-los é recusado). No um centro de custo por aba, a primeira aba, Consolidado, traz a DRE das contas dos centros: cada
              conta somada em todas as abas dos centros (em fórmulas, que acompanham os valores das abas; também os meses da referência), para conferir com a DRE do cenário; o
              total bate, e a parte dos rateios que vai para Serviços está, na DRE, nas contas da CSM ou da CSC.
            </li>
            <li>
              “Importar Valores” abre a lista dos arquivos: escolha planilhas do Exportar Premissas (ou o ZIP) ou uma pasta com elas. Cada arquivo é
              conferido no padrão (as descrições, a Média de Referência, os doze meses e a Justificativa; cada linha se acha pelas descrições) e recebe
              a Situação Válido ou Inválido (o motivo fica abaixo do nome). É Inválido também o arquivo com uma aba do Exportar (o título
              “Premissas · …”) de colunas mudadas — uma coluna apagada, por exemplo — e o que não muda nada no cenário (Nada a importar);
              uma aba que não é do Exportar fica de fora, com um aviso. A tabela mostra o que cada arquivo válido sobrescreve: em Produção e
              Serviços, as linhas (Estrutura, Alveolares, Montagem…) das abas Matriz, Filial e Serviços, uma abaixo da outra; em
              Centros de Custo, os centros de custo com valores, justificativas ou linhas do Quadro de Lotação que mudam; em Indicadores Manuais,
              os indicadores que mudam (como a Liberação de Projetos: Matriz); em Investimentos (a lista e a Depreciação Base) e Extra-Operacional,
              Sobrescrever. Cada item vem com a caixa marcada: desmarcada, ele
              fica de fora da importação. Na altura de “Escolher Arquivos” e “Escolher Pasta”, à direita, ficam a quantia de Linhas, a de Centros de Custo e a de Indicadores de todos os arquivos da lista, cada uma seguida do botão “Desmarcar Todos” (ou “Marcar Todos”), que vale para a coluna inteira. Sem nada a mudar num tipo, a coluna mostra Sem Alteração; o rodapé soma o que vai ser gravado. Quando um trecho (uma unidade, um centro de custo, a depreciação de uma unidade, o Quadro de Lotação de um departamento…) aparece em
              mais de um arquivo, o
              quadro dos repetidos pede, em cada um, Ignorar (vale o primeiro arquivo) ou Sobrescrever (vale o último); no arquivo que não vale, a
              caixa do item fica desmarcada e em cinza. A aba Investimentos substitui os
              seus investimentos (os que você incluiu): os seus que não estão nela saem do cenário (a prévia mostra quantos), os com o Nome de Referência
              de um investimento do cenário são atualizados e os de nome novo entram na sequência dos que já existem; os de outros usuários ficam. Em
              dois arquivos com a aba Investimentos, o quadro dos repetidos pede qual vale. Na aba Quadro
              de Lotação, as linhas da planilha substituem as do cenário nos departamentos do arquivo: as iguais ficam, as de mesmos cadastros com
              outros valores são alteradas, as novas entram e as que não estão na planilha saem (a prévia mostra quantas; os cadastros conferidos
              como no Lançamento Inicial: uma unidade, função ou centro de custo que não existe, ou um tipo fora de CLT, PJ, Aprendiz e Estagiário,
              recusa o arquivo). Os arquivos sem a coluna Benefícios no Quadro de Lotação ou sem a linha Benefícios Padrão nos centros de custo também
              se importam: os benefícios das linhas ficam como estão. “Importar” grava os
              meses (em branco apaga), as justificativas, os investimentos e as linhas do Quadro de Lotação, deixa a DRE
              pendente de recálculo e registra no histórico (tela Histórico, aba Alterações).
            </li>
            <li>
              Cada tabela traz, mês a mês: a Jornada (os dias úteis, já calculados pelo calendário — segunda a sexta, menos os feriados nacionais), a
              Demanda Diária de cada linha (na
              unidade de medida dela; nas linhas de m³ e pistas, as pistas por dia e o volume por pista), na Matriz e na Filial a Expedição Diária (em m³ por dia,
              separada da produção), a Armadura (Interno) Unit. e a Metalúrgica (Interno) Unit. (em kg por
              unidade da linha: kg/m³, kg/kg, kg/m²; só nas linhas que as levam), a Receita Bruta Média (na Matriz e na Filial, também a de Devoluções e
              Inventários, negativa) e os Impostos, os Custos (Mão de Obra Terceirizada, Matérias Primas, Gastos Gerais Variáveis e Estoque, por conta) e
              as Despesas Variáveis de Venda, em R$ por unidade da linha; antes da conta das comissões, as Comissões (em %/ROB, sobre a receita
              bruta).
            </li>
            <li>
              Os cálculos ficam em cinza-escuro e não se editam: o volume do mês (a demanda × os dias úteis), a Expedição no Mês (a Expedição Diária
              × os dias úteis; sem ela digitada, igual à produção) e o Volume de Estoque no Mês (a produção menos a expedição), a armadura e a metalurgia do mês (o
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
                  Também nas abas Centros de Custo, Investimentos (a Depreciação), Extra-Operacional e Quadro de Lotação (os Colaboradores, pela coluna da
                  Referência); a aba Rateios não tem a Média de Referência.
                </li>
                <li>Os valores em cinza-claro são os padrões (os dias úteis do calendário, ou zero), ainda não gravados. Cada gravação deixa a DRE do cenário pendente de recálculo (o “Recalcular” da tela Resultados) e fica no histórico (tela Histórico).</li>
              </>
            ) : null}
          </ul>
        }
        sobre={
          <>
            <p>
              As premissas do cenário analítico, de onde a DRE dele se calcula: em cada unidade e venda, o volume de cada linha é a demanda diária ×
              os dias úteis (nas linhas de m³ e pistas, as pistas × o volume por pista); cada conta é o volume × o valor unitário (os totais
              consideram só as médias e as demandas, sem ajustes); a Variação do Estoque é o Volume de Estoque (a produção menos a expedição) × o custo
              unitário dela; a receita líquida é a bruta × (1 − os impostos). As contas de Global e Mercantil somam-se na DRE da unidade, com os volumes (a produção, a
              expedição — a da Expedição Diária, ou a produção quando ela não foi digitada —, a metalurgia consumida pelas linhas da unidade e a montagem), e os totais e o Consolidado saem da Estrutura da DRE.
            </p>
            <p>
              Em Serviços, as linhas de Montagem e Vedação levam à receita de montagem e aos custos da CSM; as demais, à receita complementar (a Fundação, também à
              receita de frete) e à CSC. A
              Média de Referência é a média realizada da referência do cenário (Configurações / Referência / Resultado Realizado): o total do período ÷ o
              volume da linha — o m³ produzido, o m³ montado na Montagem e o kg na Metálica; as linhas de Serviços sem volume nas
              listas têm os valores por dia útil e a demanda diária sem Média de Referência (—), para os botões de replicar não a levarem: digite a
              demanda e os valores dos meses na mesma unidade. A demanda diária é o volume do período ÷ os dias úteis dele, e a Expedição Diária, o m³
              expedido (a lista de expedições) ÷ os mesmos dias úteis; os doze meses começam iguais às médias.
              A mão de obra direta e indireta, os gastos gerais diretos e indiretos e as despesas vêm dos centros de custo; a depreciação, dos investimentos; o imposto de
              renda, a contribuição social e o resultado financeiro, do extra-operacional.
            </p>
            <p>
              Os valores dos grupos de centros de custo vão para as unidades como no fechamento mensal, pelo balde do grupo: nos custos de produção, Matriz e
              Filial vão direto para a unidade, Unidade para a da filial dos centros, e Produção e Projeto se rateiam entre Matriz e Filial; Metalurgia e
              Armadura, também entre a Montagem e a Complementar de Serviços; nos custos de montagem, Obras vai para Serviços (a Montagem), Complementar para a conta equivalente dos Complementares (a CSC), e Acompanhamento se rateia entre
              a Montagem e a Complementar; as despesas vão para Despesas e Extra. Os percentuais saem das bases das premissas (a aba Rateios). Em Serviços, os
              Acompanhamentos no Mês somam o Acompanhamento de Obra (d) da DRE.
            </p>
            <p>
              Na referência realizada, a receita de cada conta (Pré-Fabricado, Frete, Devoluções e Inventários, Montagem e Complementar) é a da DRE da unidade, dividida entre as
              linhas e as vendas pelos itens da receita prévia, e os impostos são os dos itens, ajustados aos da DRE da unidade. Os custos (Mão de Obra
              Terceirizada, Matérias Primas, Gastos Gerais Variáveis e Estoque) e as despesas variáveis de venda de cada conta e mês são os da DRE da unidade, divididos entre as
              linhas na proporção das requisições e das notas fiscais com a tarefa de cada linha (a Correspondência Tarefa × Linha, nos Cadastros Gerais / Linhas);
              o que não tem tarefa vai pelo m³ das linhas (pela receita, nas despesas variáveis de venda e em Serviços). A Variação do Estoque vai só para as
              Estacas, as únicas que movimentam o estoque, e o custo unitário dela é a variação do período ÷ o Volume de Estoque dele (o m³ produzido menos o
              expedido). Como o estoque das Estacas caiu no realizado e a variação foi custo, o unitário fica negativo: no cenário, o mês que expede mais do
              que produz (Volume de Estoque negativo) tem custo, e o que produz mais do que expede reduz o custo. A armadura e a metalurgia por
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
              Terceiro)] + (FGTS Aprendiz − FGTS CLT) × Salários dos Aprendizes × (1 + Férias + Décimo Terceiro), com a base =
              Remunerações CLT + Horas Extras − Salários dos Estagiários (sem aprendizes e com o padrão, 63,64% da base): o FGTS de cada colaborador
              sobre os seus salários, os aprendizes (o Tipo Aprendiz, na aba Quadro de Lotação: o Jovem Aprendiz, com o INSS, as Férias e o
              Décimo Terceiro do CLT) a 2% e os demais a 8%. Os estagiários e os bolsistas (o Tipo Estagiário; Lei 11.788/2008) não têm INSS,
              FGTS, férias com o terço nem décimo terceiro: os salários deles nas Remunerações CLT saem da base. Os Salários dos Aprendizes e dos
              Estagiários entram só na mão de obra da atribuição do grupo, a que recebe as remunerações do Quadro de Lotação; na outra, a base é
              Remunerações CLT + Horas Extras. Os percentuais têm o mesmo padrão
              em todos os cenários (29% — a confirmar com a contabilidade —, 2%, 8%, 1/12 × 4/3 = 11,11% e 1/12 = 8,33%) e se editam por grupo e mês; os
              Benefícios Adicionais (vale-transporte, alimentação, plano de saúde…) se digitam em R$ e entram na mão de obra da atribuição do grupo,
              como os Benefícios Padrão (os de Configurações / Benefícios Padrão aplicados às linhas na aba Quadro de Lotação: os colaboradores × o
              Valor Mensal, somados pelos centros do grupo).
              Na referência realizada, os Benefícios Adicionais de cada mês fechado e a Média de Referência deles são a diferença entre os encargos
              realizados do grupo e o cálculo com os percentuais padrão (negativa quando o realizado fica abaixo dele). Nas Premissas, a conta
              Encargos e Benefícios aparece sem os Benefícios Adicionais e os Benefícios Padrão (só o cálculo pelos percentuais), nos meses, na Média de
              Referência e nos meses da referência do Exportar Premissas: a soma das três linhas é o total da conta, que vai para a DRE e, na referência realizada,
              é o realizado.
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
            ? "Você vê só os grupos de centros de custo com algum centro seu (o Quadro de Lotação, os Centros de Custo e os Rateios deles) e a lista inteira dos Investimentos."
            : `Você vê só as premissas ${recorte.departamentos.length === 1 ? "do departamento" : "dos departamentos"} ${recorte.departamentos.map((d) => NOME_DO_DEPARTAMENTO[d] ?? d).join(", ")} e a lista inteira dos Investimentos.`}
        </p>
      ) : null}
      <Abas
        rotulo="Unidade das premissas"
        ativa={aba}
        onMudar={(a) => {
          setGrupoDaVerificacao(null);
          setAba(a);
        }}
        abas={abas}
      />
      {cenario.data && travado && editaAba ? (
        <AvisoMarcado cenario={cenario.data} oQue="as premissas" />
      ) : bloqueadaPelosReajustes && editaAba && !rateios && !naVerificacoes ? (
        <AvisoReajustesAplicados oQue="as premissas desta aba" varios />
      ) : null}
      {!abas.length ? (
        <p className="rounded-sm border border-gray-200 bg-white p-6 text-sm text-gray-600">Seu perfil não tem acesso a nenhuma aba desta tela.</p>
      ) : quadro ? (
        <QuadroDoCenario id={id} editavel={podeEditar} />
      ) : centros ? (
        <CentrosDoCenario key={grupoDaVerificacao ?? ""} id={id} editavel={podeEditar} grupoInicial={grupoDaVerificacao} />
      ) : rateios ? (
        <RateiosDoCenario id={id} />
      ) : naVerificacoes ? (
        <VerificacoesDoCenario
          id={id}
          podeEditar={editaAba && !travado}
          onAbrirAba={(a, grupo) => {
            setGrupoDaVerificacao(a === "centros" ? grupo : null);
            setAba(a);
            window.scrollTo({ top: 0 });
          }}
        />
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
