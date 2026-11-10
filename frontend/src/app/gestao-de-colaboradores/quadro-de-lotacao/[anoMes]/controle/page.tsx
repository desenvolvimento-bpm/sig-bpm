import { ProtectedLayout } from "@/components/layout/ProtectedLayout";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { SemLeitura } from "@/components/shared/SemLeitura";

import { ControleContent } from "../../components/ControleContent";

/** Quadro de Lotação › uma competência › Controle (06/11/2026). */
export default function ControleDoQuadroPage() {
  return (
    <ProtectedLayout>
      <PermissionGuard permission="colaboradores_quadro.controle:ler" fallback={<SemLeitura />}>
        <ControleContent />
      </PermissionGuard>
    </ProtectedLayout>
  );
}
