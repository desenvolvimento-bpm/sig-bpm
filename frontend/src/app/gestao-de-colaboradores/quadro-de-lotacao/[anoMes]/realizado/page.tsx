import { ProtectedLayout } from "@/components/layout/ProtectedLayout";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { SemLeitura } from "@/components/shared/SemLeitura";

import { RealizadoContent } from "../../components/RealizadoContent";

/** Quadro de Lotação › uma competência › Realizado (06/11/2026). */
export default function RealizadoDoQuadroPage() {
  return (
    <ProtectedLayout>
      <PermissionGuard permission="colaboradores_quadro.realizado:ler" fallback={<SemLeitura />}>
        <RealizadoContent />
      </PermissionGuard>
    </ProtectedLayout>
  );
}
