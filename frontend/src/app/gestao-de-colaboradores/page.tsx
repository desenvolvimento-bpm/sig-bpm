import { ProtectedLayout } from "@/components/layout/ProtectedLayout";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { SemLeitura } from "@/components/shared/SemLeitura";

import { CompetenciasDoQuadro } from "./quadro-de-lotacao/components/CompetenciasDoQuadro";

/** Gestão de Colaboradores (12/11/2026, pedido do Adão: o início do processo, como no Fechamento Mensal): as competências do Quadro de Lotação. */
export default function GestaoDeColaboradoresPage() {
  return (
    <ProtectedLayout>
      <PermissionGuard permission="colaboradores_quadro:ler" fallback={<SemLeitura />}>
        <CompetenciasDoQuadro />
      </PermissionGuard>
    </ProtectedLayout>
  );
}
