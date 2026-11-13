import { ProtectedLayout } from "@/components/layout/ProtectedLayout";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { SemLeitura } from "@/components/shared/SemLeitura";

import { AcessosContent } from "./AcessosContent";

/** A tela Acessos (13/11/2026, pedido do Adão), na Central de Conectividade, logo depois de APIs. */
export default function AcessosPage() {
  return (
    <ProtectedLayout>
      <PermissionGuard permission="conectividade_acessos.apis:ler" fallback={<SemLeitura />}>
        <AcessosContent />
      </PermissionGuard>
    </ProtectedLayout>
  );
}
