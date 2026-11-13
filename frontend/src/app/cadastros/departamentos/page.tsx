import { ProtectedLayout } from "@/components/layout/ProtectedLayout";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { SemLeitura } from "@/components/shared/SemLeitura";

import { ListaCadastroContent } from "../components/ListaCadastroContent";

/** Os Departamentos (11/11/2026, pedido do Adão; Cadastros Gerais / Controladoria): a ordem, a unidade e o departamento. */
export default function DepartamentosPage() {
  return (
    <ProtectedLayout>
      <PermissionGuard permission="cadastro_controladoria.departamentos:ler" fallback={<SemLeitura />}>
        <ListaCadastroContent
          entidade="departamentos"
          rota="/cadastros/departamentos"
          titulo="Departamentos"
          comoUsar={
            <ul>
              <li>Cada linha é um departamento: a Ordem (a sequência das listas), a Unidade (de negócio, do cadastro Unidades, na aba Contábil) e o nome do Departamento, que não se repete na mesma unidade.</li>
              <li>
                Os Departamentos da DRE ligam o departamento aos grupos da Estrutura da DRE (na tabela, pelas siglas: CPP, CSM, DL…). No modal, marque os
                grupos do departamento: só os que têm linhas na unidade dele, e cada grupo num departamento só da mesma unidade (a Produção da Matriz e a da
                Filial têm, cada uma, o CPP da sua unidade). O Extra-Operacional reúne os grupos fora da operação (DML, RFC, RFNC, DFC e DFNC).
              </li>
              <li>Use os filtros nos rótulos das colunas.</li>
              <li>Use “Novo” para incluir; o lápis edita, e a exclusão fica dentro da edição. Inativo, o departamento sai das listas.</li>
            </ul>
          }
          descricao="Os departamentos de cada unidade de negócio, na ordem das listas."
        />
      </PermissionGuard>
    </ProtectedLayout>
  );
}
