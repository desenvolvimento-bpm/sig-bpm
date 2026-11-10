import { ProtectedLayout } from "@/components/layout/ProtectedLayout";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { SemLeitura } from "@/components/shared/SemLeitura";

import { CadastroDeColaboradores } from "../components/CadastroDeColaboradores";

/** Gestão de Colaboradores › Cadastros › Senioridades (06/11/2026). */
export default function SenioridadesPage() {
  return (
    <ProtectedLayout>
      <PermissionGuard permission="colaboradores_cadastros.senioridades:ler" fallback={<SemLeitura />}>
        <CadastroDeColaboradores
          entidade="colaboradores-senioridades"
          aba="senioridades"
          rota="/gestao-de-colaboradores/cadastros/senioridades"
          titulo="Senioridades"
          oRegistro="a senioridade"
          descricao="As senioridades (os níveis) das funções permitidas no Quadro de Lotação: Aprendiz, Júnior, Pleno, Sênior… As funções e o Lançamento Inicial usam estes nomes."
          comoUsar={
            <ul>
              <li>Use Novo, à direita do título, para criar uma senioridade, com o nome e a descrição do nível.</li>
              <li>No menu Ações de cada linha, Editar muda a senioridade e Inativar a tira das listas de escolha; Reativar a devolve.</li>
              <li>Excluir só vale para a senioridade que nenhuma função nem o Lançamento Inicial usam; nas demais, o motivo aparece ao passar o mouse.</li>
              <li>Marque Apenas Ativas para esconder as inativas, e use os filtros nos rótulos das colunas.</li>
            </ul>
          }
        />
      </PermissionGuard>
    </ProtectedLayout>
  );
}
