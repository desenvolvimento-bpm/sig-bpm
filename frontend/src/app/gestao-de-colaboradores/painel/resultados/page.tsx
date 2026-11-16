import { ProtectedLayout } from "@/components/layout/ProtectedLayout";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { SemLeitura } from "@/components/shared/SemLeitura";

import { PainelDoQuadro } from "../components/PainelDoQuadro";

/** Gestão de Colaboradores › Painel de Bordo › Resultados (06/11/2026). */
export default function PainelResultadosPage() {
  return (
    <ProtectedLayout>
      <PermissionGuard permission="colaboradores_painel.resultados:ler" fallback={<SemLeitura />}>
        <PainelDoQuadro aba="resultados" />
      </PermissionGuard>
    </ProtectedLayout>
  );
}
