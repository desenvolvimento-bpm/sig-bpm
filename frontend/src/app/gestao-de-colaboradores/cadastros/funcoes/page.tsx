import { ProtectedLayout } from "@/components/layout/ProtectedLayout";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { SemLeitura } from "@/components/shared/SemLeitura";

import { CadastroDeColaboradores } from "../components/CadastroDeColaboradores";

/** Gestão de Colaboradores › Cadastros › Funções (06/11/2026). */
export default function FuncoesPage() {
  return (
    <ProtectedLayout>
      <PermissionGuard permission="colaboradores_cadastros.funcoes:ler" fallback={<SemLeitura />}>
        <CadastroDeColaboradores
          entidade="colaboradores-funcoes"
          aba="funcoes"
          rota="/gestao-de-colaboradores/cadastros/funcoes"
          titulo="Funções"
          oRegistro="a função"
          importar="funcoes"
          descricao="As funções dos colaboradores permitidas no Quadro de Lotação, uma para cada senioridade (a mesma função pode ter várias), com a descrição, as competências e as atividades de cada uma."
          comoUsar={
            <ul>
              <li>
                Use Novo, à direita do título, para criar uma função: a função, a senioridade (da aba Senioridades), a descrição, as competências e as
                atividades. A mesma função se cadastra uma vez para cada senioridade; a função sem senioridade vale para todas.
              </li>
              <li>
                Use Importar para trazer as funções de uma planilha (.xlsx) com as colunas Função, Descrição, Senioridade, Competências e Atividades. A prévia mostra
                cada linha como Nova, Alterada (a função já cadastrada, com outro conteúdo), Igual ou Inválida; os rótulos da tabela da prévia filtram, como nas outras tabelas. Uma linha inválida (uma senioridade não cadastrada,
                a mesma função com a mesma senioridade repetida na planilha) cancela a importação. Na planilha com várias abas, vale a que tem mais
                dessas colunas. A importação substitui o cadastro inteiro: as funções que não estão na planilha são excluídas (a prévia lista quais), e as da planilha são cadastradas de novo — a já cadastrada com o mesmo nome e a mesma senioridade fica com os dados da planilha e continua ligada ao Lançamento Inicial, às movimentações e aos cenários. Se o Lançamento Inicial usa uma função excluída, ele é apagado junto (importe-o de novo em seguida); uma função excluída que está em movimentações do Quadro de Lotação ou nos cenários cancela a importação.
              </li>
              <li>No menu Ações de cada linha, Editar muda a função e Inativar a tira das listas de escolha; Reativar a devolve.</li>
              <li>Excluir só vale para a função que o Lançamento Inicial não usa; nas demais, o motivo aparece ao passar o mouse.</li>
              <li>Marque Apenas Ativas para esconder as inativas, e use os filtros nos rótulos das colunas.</li>
            </ul>
          }
        />
      </PermissionGuard>
    </ProtectedLayout>
  );
}
