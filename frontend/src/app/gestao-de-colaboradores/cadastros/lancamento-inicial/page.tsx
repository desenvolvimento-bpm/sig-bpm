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
          descricao="A carga inicial dos colaboradores: o quadro de lotação do início de uma competência, um colaborador por linha, com a unidade, o tipo (CLT ou PJ), a senioridade, a função e o centro de custo. É o saldo inicial do indicador Quadro de Lotação; as movimentações contam a partir dele."
          comoUsar={
            <ul>
              <li>
                Use Importar, à direita do título, para trazer o quadro de uma planilha (.xlsx) com as colunas Unidade, Tipo (CLT ou PJ), Senioridade, Função e
                Centro de Custo (o código ou o nome do cadastro), um colaborador por linha. Escolha no modal a competência do quadro: a planilha é o quadro do
                início desse mês.
              </li>
              <li>
                A prévia confere cada linha com os cadastros: uma unidade, senioridade, função ou centro de custo não cadastrado (ou inativo) torna a linha
                inválida e cancela a importação. A importação substitui o Lançamento Inicial inteiro.
              </li>
              <li>Use Novo para incluir um colaborador no Lançamento Inicial já importado (na mesma competência).</li>
              <li>No menu Ações de cada linha, Editar muda o colaborador e Excluir o tira do Lançamento Inicial, depois da confirmação.</li>
              <li>Acima da tabela ficam a competência do quadro e o total de colaboradores, CLT e PJ. Use os filtros nos rótulos das colunas.</li>
            </ul>
          }
        />
      </PermissionGuard>
    </ProtectedLayout>
  );
}
