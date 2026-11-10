import { ProtectedLayout } from "@/components/layout/ProtectedLayout";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { SemLeitura } from "@/components/shared/SemLeitura";

import { CompetenciasDoQuadro } from "./components/CompetenciasDoQuadro";

/** Gestão de Colaboradores › Quadro de Lotação (06/11/2026): as competências próprias. */
export default function QuadroDeLotacaoPage() {
  return (
    <ProtectedLayout>
      <PermissionGuard permission="colaboradores_quadro:ler" fallback={<SemLeitura />}>
        <CompetenciasDoQuadro />
      </PermissionGuard>
    </ProtectedLayout>
  );
}
