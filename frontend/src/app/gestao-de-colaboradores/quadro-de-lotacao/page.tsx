import { ProtectedLayout } from "@/components/layout/ProtectedLayout";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { SemLeitura } from "@/components/shared/SemLeitura";

import { AbrirQuadroDeLotacao } from "./components/SituacaoDaCompetenciaDoQuadro";

/**
 * Gestão de Colaboradores › Quadro de Lotação (06/11/2026; desde 12/11/2026, a lista das competências está no início do
 * processo, /gestao-de-colaboradores): abre a última competência aberta, ou a mais recente.
 */
export default function QuadroDeLotacaoPage() {
  return (
    <ProtectedLayout>
      <PermissionGuard permission="colaboradores_quadro:ler" fallback={<SemLeitura />}>
        <AbrirQuadroDeLotacao />
      </PermissionGuard>
    </ProtectedLayout>
  );
}
