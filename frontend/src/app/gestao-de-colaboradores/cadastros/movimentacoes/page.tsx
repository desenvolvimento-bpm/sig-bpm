import { ProtectedLayout } from "@/components/layout/ProtectedLayout";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { SemLeitura } from "@/components/shared/SemLeitura";

import { CadastroDeColaboradores } from "../components/CadastroDeColaboradores";

/** Gestão de Colaboradores › Cadastros › Movimentações (06/11/2026): os tipos de movimentação do Quadro de Lotação. */
export default function MovimentacoesPage() {
  return (
    <ProtectedLayout>
      <PermissionGuard permission="colaboradores_cadastros.movimentacoes:ler" fallback={<SemLeitura />}>
        <CadastroDeColaboradores
          entidade="colaboradores-movimentacoes"
          aba="movimentacoes"
          rota="/gestao-de-colaboradores/cadastros/movimentacoes"
          titulo="Movimentações"
          oRegistro="a movimentação"
          descricao="Os tipos de movimentação do Quadro de Lotação (Admissão, Reposição, Desligamento, Abertura de Vaga, Encerramento de Vaga…), com a contagem e o modelo de aprovação de cada um."
          comoUsar={
            <ul>
              <li>Use Novo, à direita do título, para criar uma movimentação: o nome, a descrição, o Tipo de Contagem e o Modelo de Aprovação.</li>
              <li>
                Tipo de Contagem: Positiva soma um colaborador ao Quadro de Lotação (Admissão, Reposição), Negativa subtrai um (Desligamento) e Nula não muda o
                quadro (Abertura e Encerramento de Vaga).
              </li>
              <li>
                Modelo de Aprovação: na Automática, a movimentação vale assim que é registrada; na Manual, fica Pendente até o gestor do centro de custo aprová-la
                ou recusá-la.
              </li>
              <li>No menu Ações de cada linha, Editar muda a movimentação e Inativar a tira das listas de escolha; Reativar a devolve.</li>
              <li>Excluir só vale para a movimentação sem classificações; nas demais, o motivo aparece ao passar o mouse.</li>
              <li>Marque Apenas Ativas para esconder as inativas, e use os filtros nos rótulos das colunas.</li>
            </ul>
          }
        />
      </PermissionGuard>
    </ProtectedLayout>
  );
}
