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
          descricao="A carga inicial dos colaboradores: o quadro de lotação do início de uma competência, um colaborador por linha, com a unidade, o tipo (CLT, PJ, Aprendiz ou Estagiário), a função e o centro de custo. É o saldo inicial do indicador Quadro de Lotação; as movimentações contam a partir dele."
          comoUsar={
            <ul>
              <li>
                Use Importar, à direita do título, para trazer o quadro de uma planilha (.xlsx) com as colunas Unidade, Tipo (CLT, PJ, Aprendiz ou Estagiário),
                Função e Centro de Custo (o código ou o nome do cadastro), um colaborador por linha. Escolha no modal a competência do quadro: a planilha é o quadro do
                início desse mês.
              </li>
              <li>
                A prévia confere cada linha com os cadastros: uma unidade, função ou centro de custo não cadastrado (ou inativo) ou um tipo fora dos quatro torna a
                linha inválida e cancela a importação. As outras colunas da planilha (como as de salário e de benefícios) não se importam. Os rótulos da tabela da
                prévia filtram, como nas outras tabelas. A importação apaga o Lançamento Inicial anterior inteiro e grava as linhas da planilha. A importação das Funções que exclui uma função usada aqui também apaga o Lançamento Inicial: importe-o de novo em seguida.
              </li>
              <li>
                Use Novo para incluir um colaborador no Lançamento Inicial já importado (na mesma competência), com a unidade, o tipo, a função e o centro de custo. A
                tabela traz as mesmas colunas do modal.
              </li>
              <li>No menu Ações de cada linha, Editar muda o colaborador e Excluir o tira do Lançamento Inicial, depois da confirmação.</li>
              <li>
                Com alguma competência fechada no Quadro de Lotação, o Lançamento Inicial não se edita: o Importar, o Novo e o menu Ações somem (para mudar o
                quadro inicial, reabra as competências fechadas no Quadro de Lotação). A importação das Funções que apagaria o Lançamento Inicial também é recusada.
              </li>
              <li>
                Acima da tabela, os quadros de destaque Por Unidade e Por Departamento: em cada card, os colaboradores e o percentual do total (no título,
                entre parênteses). A unidade é a do colaborador; o departamento, o do cadastro Departamentos (Cadastros Gerais / Controladoria) com o grupo da DRE
                do centro de custo (Produção, Montagem, Administrativo…). Os quadros seguem os filtros dos rótulos das colunas.
              </li>
            </ul>
          }
        />
      </PermissionGuard>
    </ProtectedLayout>
  );
}
