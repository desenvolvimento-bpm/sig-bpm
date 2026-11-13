import { ProtectedLayout } from "@/components/layout/ProtectedLayout";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { SemLeitura } from "@/components/shared/SemLeitura";

import { JornadaContent } from "../../components/JornadaContent";

/** Quadro de Lotação › uma competência › Jornada (13/11/2026). */
export default function JornadaDoQuadroPage() {
  return (
    <ProtectedLayout>
      <PermissionGuard permission="colaboradores_quadro.jornada:ler" fallback={<SemLeitura />}>
        <JornadaContent />
      </PermissionGuard>
    </ProtectedLayout>
  );
}
