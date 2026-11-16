import { ProtectedLayout } from "@/components/layout/ProtectedLayout";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { SemLeitura } from "@/components/shared/SemLeitura";

import { PainelDoQuadro } from "../components/PainelDoQuadro";

/** Gestão de Colaboradores › Painel de Bordo › Indicadores (06/11/2026). */
export default function PainelIndicadoresPage() {
  return (
    <ProtectedLayout>
      <PermissionGuard permission="colaboradores_painel.indicadores:ler" fallback={<SemLeitura />}>
        <PainelDoQuadro aba="indicadores" />
      </PermissionGuard>
    </ProtectedLayout>
  );
}
