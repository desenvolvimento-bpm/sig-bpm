import { ProtectedLayout } from "@/components/layout/ProtectedLayout";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { SemLeitura } from "@/components/shared/SemLeitura";

import { ListaCadastroContent } from "../components/ListaCadastroContent";

/** O cadastro do Painel de Bordo (17/10/2026; Cadastros Gerais / Analítico): os itens das abas Resultados e Performance. */
export default function PainelBordoPage() {
  return (
    <ProtectedLayout>
      <PermissionGuard permission="cadastro_analitico.painel_bordo:ler" fallback={<SemLeitura />}>
        <ListaCadastroContent
          entidade="painel-bordo"
          rota="/cadastros/painel-bordo"
          titulo="Painel de Bordo"
          apenasAtivas
          comoUsar={
            <ul>
              <li>Cada linha é um item (um card) do Painel de Bordo. Use os filtros nos rótulos das colunas (o grupo e o quadro, por exemplo).</li>
              <li>
                O Grupo é a aba do Painel (Resultados ou Performance) e o Quadro, a seção dentro dela (Consolidado, Produção: Matriz…): os itens com o
                mesmo quadro ficam juntos. A Ordem põe os itens em sequência; os quadros seguem a ordem do primeiro item de cada um.
              </li>
              <li>
                O Nome aparece no card, com a Metodologia e o Comportamento à direita; o Comportamento diz o lado bom (↑ quanto maior, melhor; ↓ quanto menor, melhor) e define o sinal
                do desvio.
              </li>
              <li>
                A Metodologia é a fórmula do item, montada como a dos Indicadores: escolha o indicador (do cadastro Indicadores, a aba ao lado) e use “Inserir
                Item”, os operadores (+ − × ÷), os parênteses e o número digitado com “Inserir”; “Apagar” (o último pedaço) e “Limpar” corrigem. Com os valores realizados dos
                indicadores, a fórmula dá o realizado; com as metas do orçamento, o orçado; com os acumulados, o acumulado.
              </li>
              <li>
                Na lista de indicadores da Metodologia, ao lado de cada um, o valor acumulado de janeiro até a competência fechada mais recente em
                Resultados Empresariais (#.##0,00, ou 0,00% nos indicadores em %). “Testar”, antes de “Gravar”, mostra o Realizado (Atual) do card
                nessa competência, no Formato escolhido (e o Percentual sob o Valor, quando há), com a fórmula do formulário, sem gravar.
              </li>
              <li>
                O Formato diz a unidade do Atual e do Acumulado (R$ em milhões ou milhares, m³, pistas, percentual, R$/m³), que aparece no rótulo
                deles, e não nos valores; é o mesmo no Atual e no Acumulado. O Percentual sob o Valor é opcional: uma segunda fórmula, mostrada sob o realizado com o rótulo (/RL), com uma ou duas casas.
                Espaço Antes começa um novo bloco no quadro.
              </li>
              <li>Use “Novo” para incluir um item; o lápis edita, e a exclusão fica dentro da edição. Inativo, o item sai do Painel de Bordo.</li>
              <li>
                Mudar o cadastro com uma competência apurada e ainda não fechada pede reapurar (vale para todos os Cadastros Gerais): até lá,
                ela não fecha, e a tela Resultados do mês mostra o aviso. Os cards dos
                Relatórios Executivos acham o item pelo quadro, pelo nome e pela abreviação: mudá-los tira o card do relatório.
              </li>
            </ul>
          }
          descricao="Os itens do Painel de Bordo (Resultados e Performance). O Painel de Bordo de Resultados Empresariais, o dos cenários e os cards dos Relatórios Executivos usam os itens ativos daqui. Cada item tem a sua Metodologia, uma fórmula sobre os indicadores."
        />
      </PermissionGuard>
    </ProtectedLayout>
  );
}
