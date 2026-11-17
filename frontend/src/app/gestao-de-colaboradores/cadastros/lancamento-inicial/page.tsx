import { ProtectedLayout } from "@/components/layout/ProtectedLayout";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { SemLeitura } from "@/components/shared/SemLeitura";

import { CadastroDeColaboradores } from "../components/CadastroDeColaboradores";

/** Gestão de Colaboradores › Cadastros › Lançamento Inicial (06/11/2026): a carga inicial dos colaboradores. */
export default function LancamentoInicialPage() {
  return (
    <ProtectedLayout>
      <PermissionGuard permission="colaboradores_cadastros.lancamento_inicial:ler" fallback={<SemLeitura />}>
        <CadastroDeColaboradores
          entidade="colaboradores-lancamento-inicial"
          aba="lancamento_inicial"
          rota="/gestao-de-colaboradores/cadastros/lancamento-inicial"
          titulo="Lançamento Inicial"
          oRegistro="o colaborador do Lançamento Inicial"
          importar="lancamento-inicial"
          lancamentoInicial
          descricao="A carga inicial dos colaboradores: o quadro de lotação do início de uma competência, um colaborador por linha, com a unidade, o tipo (CLT, PJ, Aprendiz ou Estagiário), a função, o centro de custo e os valores dele (o Salário Bruto, o Salário Adicional (Peric. / Insal.), o Salário Total, a Cesta Básica / Seguro de Vida / Vale Alimentação, o Plano de Saúde e o Vale Transporte, em R$ por mês). É o saldo inicial do indicador Quadro de Lotação; as movimentações contam a partir dele."
          comoUsar={
            <ul>
              <li>
                Use Importar, à direita do título, para trazer o quadro de uma planilha (.xlsx) com as colunas Unidade, Tipo (CLT, PJ, Aprendiz ou Estagiário),
                Função e Centro de Custo (o código ou o nome do cadastro), um colaborador por linha. Escolha no modal a competência do quadro: a planilha é o quadro do
                início desse mês.
              </li>
              <li>
                A planilha pode trazer também as colunas Salário Bruto (R$), Salário Adicional (Peric. / Insal.) (R$), Cesta Básica / Seguro de Vida / Vale
                Alimentação (R$), Plano de Saúde (R$) e Vale Transporte (R$) — com ou sem acento e com ou sem “(R$)” —, em reais (5200, 5.200,00 ou R$ 5.200); em
                branco, o colaborador fica sem o valor. O Salário Total o SIG calcula (o Salário Bruto mais o Salário Adicional): a coluna Salário Total da planilha, se houver,
                não se importa.
              </li>
              <li>
                A prévia confere cada linha com os cadastros e os valores: uma unidade, função ou centro de custo não cadastrado (ou inativo), um tipo fora dos quatro,
                ou um valor que não é número (ou negativo) torna a linha inválida e cancela a importação. Ela mostra os valores em R$ e o Salário Total calculado; os
                rótulos da tabela da prévia filtram, como nas outras tabelas. A importação apaga o Lançamento Inicial anterior inteiro e grava as linhas da planilha. A importação das Funções que exclui uma função usada aqui também apaga o Lançamento Inicial: importe-o de novo em seguida.
              </li>
              <li>
                Use Novo para incluir um colaborador no Lançamento Inicial já importado (na mesma competência). No modal, além dos cadastros, o Salário Bruto e o Salário Adicional (Peric. / Insal.),
                opcionais, e o Salário Total, que o SIG calcula enquanto você digita (a soma dos dois). A tabela traz as mesmas colunas do modal (a competência fica no
                destaque acima dela). A Cesta Básica / Seguro de Vida / Vale Alimentação, o Plano de Saúde e o Vale Transporte vêm só da importação: não aparecem na
                tabela nem no modal, e a edição pelo modal não os muda.
              </li>
              <li>No menu Ações de cada linha, Editar muda o colaborador e Excluir o tira do Lançamento Inicial, depois da confirmação.</li>
              <li>
                Com alguma competência fechada no Quadro de Lotação, o Lançamento Inicial não se edita: o Importar, o Novo e o menu Ações somem, e o destaque
                vermelho diz quais competências reabrir. A importação das Funções que apagaria o Lançamento Inicial também é recusada.
              </li>
              <li>
                No destaque acima da tabela ficam a competência do quadro e o total de colaboradores, com o de cada tipo (CLT, PJ, Aprendizes e Estagiários).
                Use os filtros nos rótulos das colunas.
              </li>
            </ul>
          }
        />
      </PermissionGuard>
    </ProtectedLayout>
  );
}
