import { ProtectedLayout } from "@/components/layout/ProtectedLayout";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { SemLeitura } from "@/components/shared/SemLeitura";

import { CadastroDeColaboradores } from "../components/CadastroDeColaboradores";

/** Gestão de Colaboradores › Cadastros › Classificações (06/11/2026): as de cada tipo de movimentação. */
export default function ClassificacoesPage() {
  return (
    <ProtectedLayout>
      <PermissionGuard permission="colaboradores_cadastros.classificacoes:ler" fallback={<SemLeitura />}>
        <CadastroDeColaboradores
          entidade="colaboradores-classificacoes"
          aba="classificacoes"
          rota="/gestao-de-colaboradores/cadastros/classificacoes"
          titulo="Classificações"
          oRegistro="a classificação"
          descricao="As classificações de cada movimentação (os motivos padronizados de uma admissão, de um desligamento…), escolhidas ao registrar uma movimentação no Quadro de Lotação."
          comoUsar={
            <ul>
              <li>Use Novo, à direita do título, para criar uma classificação: a movimentação (da aba Movimentações), a classificação e a descrição.</li>
              <li>No menu Ações de cada linha, Editar muda a classificação e Inativar a tira das listas de escolha; Reativar a devolve.</li>
              <li>Excluir tira a classificação do cadastro, depois da confirmação.</li>
              <li>Marque Apenas Ativas para esconder as inativas, e use os filtros nos rótulos das colunas.</li>
            </ul>
          }
        />
      </PermissionGuard>
    </ProtectedLayout>
  );
}
