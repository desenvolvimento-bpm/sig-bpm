import { ProtectedLayout } from "@/components/layout/ProtectedLayout";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { SemLeitura } from "@/components/shared/SemLeitura";

import { ListaCadastroContent } from "../components/ListaCadastroContent";

export default function EstruturaIndicadoresPage() {
  return (
    <ProtectedLayout>
      <PermissionGuard permission="cadastro_analitico.estrutura_indicadores:ler" fallback={<SemLeitura />}>
        <ListaCadastroContent
          entidade="estrutura-indicadores"
          rota="/cadastros/estrutura-indicadores"
          titulo="Indicadores"
          apenasAtivas
          comoUsar={
            <ul>
              <li>Use os filtros nos rótulos das colunas (o grupo, por exemplo).</li>
              <li>Use “Novo” para incluir um indicador; o lápis edita, e a exclusão fica dentro da edição.</li>
              <li>
                Na Metodologia, monte a fórmula do indicador: escolha o tipo do item (uma linha da DRE, com a unidade; um totalizador das Listas;
                um indicador do Comercial ou do Administrativo; uma meta do Orçamento, o cenário marcado; ou outro Indicador deste cadastro, com o
                valor dele no mês), busque, escolha e clique em “Inserir Item”. Nas metas e nos indicadores, o Período escolhe o valor do mês (No
                Mês) ou o de janeiro até o mês (Acumulado no Ano: o acumulado do indicador, como a coluna Acumulado, ou o orçado acumulado). Entre os
                itens, use os operadores (+ − × ÷), os parênteses e o número digitado com “Inserir” (por exemplo, ÷ 1000 para milhares). “Apagar” desfaz
                o último pedaço, e “Limpar” apaga a fórmula inteira.
              </li>
              <li>
                Unidade de Medida: R$ em Milhões (M) e R$ em Milhares (K) mostram o valor em reais em milhões ou em milhares, com uma
                casa, como nos cards do Painel de Bordo (a fórmula continua em reais, sem dividir por 1000).
              </li>
              <li>
                Acumulado: Soma dos Meses (a fórmula sobre a soma de cada item; nas razões, a soma dos numeradores sobre a dos denominadores),
                Média Ponderada (pelo Peso da Média, montado como a Metodologia), Último Mês (os de posição, como o quadro de lotação, e os
                atingimentos acumulados, como os do GME 8) ou Fórmula do Acumulado (uma segunda fórmula, montada como a Metodologia com os itens
                no Acumulado no Ano, que dá o acumulado: nas Eficiências da Operação Totais, os acumulados da Matriz e da Filial ponderados pelas
                receitas acumuladas de cada uma). O Cálculo do Sistema (a conta no código) serve só para voltar atrás: todos os indicadores têm
                Metodologia.
              </li>
              <li>
                Na lista de itens da Metodologia, ao lado de cada um, o valor acumulado de janeiro até a competência fechada mais recente em Resultados
                Empresariais (#.##0,00, ou 0,00% nos indicadores e metas em %; no Quadro de Lotação, a posição do mês). “Testar”, antes de “Gravar”,
                mostra o Realizado (Atual) do indicador nessa competência e o Acumulado, com a fórmula do formulário, sem gravar.
              </li>
              <li>A Descrição é o texto que a aba Indicadores do Painel de Bordo de Resultados Empresariais mostra sob o nome.</li>
              <li>Marque “Apenas Ativas”, ao lado dos botões, para esconder os indicadores inativos (que saem do Painel de Bordo de Resultados Empresariais, também da aba Indicadores).</li>
              <li>
                Um indicador não pode usar a si mesmo, nem por outro (A usa B, que usa A): o cadastro recusa o ciclo. Nos cenários, o indicador que usa
                outros é calculado com os valores deles no cenário (os importados, com as metas).
              </li>
              <li>O Nome de um indicador com metas em cenários, valores importados ou digitados, usado no Painel de Bordo ou na Metodologia de outro indicador, não muda, e o indicador não se exclui: inative-o.</li>
              <li>Mudar este cadastro com uma competência apurada e ainda não fechada pede reapurar (vale para todos os Cadastros Gerais): até lá, ela não fecha, e a tela Resultados do mês mostra o aviso. Ao gravar, a mensagem diz quais competências reapurar.</li>
            </ul>
          }
          descricao="Os indicadores de resultado, com a fórmula que os calcula no Painel de Bordo de Resultados Empresariais (também na aba Indicadores e no Exportar): linhas da DRE apurada por unidade, totalizadores das Listas, indicadores do Comercial e do Administrativo e metas do Orçamento (o cenário marcado) e outros indicadores do cadastro."
        />
      </PermissionGuard>
    </ProtectedLayout>
  );
}
