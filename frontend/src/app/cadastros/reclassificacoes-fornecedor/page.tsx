import { ProtectedLayout } from "@/components/layout/ProtectedLayout";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { SemLeitura } from "@/components/shared/SemLeitura";

import { ReclassificacoesFornecedorContent } from "./ReclassificacoesFornecedorContent";

export default function ReclassificacoesFornecedorPage() {
  return (
    <ProtectedLayout>
      <PermissionGuard permission="cadastro_reclassificacoes.por_fornecedor:ler" fallback={<SemLeitura />}>
        <ReclassificacoesFornecedorContent />
      </PermissionGuard>
    </ProtectedLayout>
  );
}
