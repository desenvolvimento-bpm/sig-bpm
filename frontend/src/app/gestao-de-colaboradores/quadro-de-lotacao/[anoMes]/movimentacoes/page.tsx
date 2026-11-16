import { ProtectedLayout } from "@/components/layout/ProtectedLayout";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { SemLeitura } from "@/components/shared/SemLeitura";

import { MovimentacoesContent } from "../../components/MovimentacoesContent";

/** Quadro de Lotação › uma competência › Movimentações (06/11/2026). */
export default function MovimentacoesDoQuadroPage() {
  return (
    <ProtectedLayout>
      <PermissionGuard permission="colaboradores_quadro.movimentacoes:ler" fallback={<SemLeitura />}>
        <MovimentacoesContent />
      </PermissionGuard>
    </ProtectedLayout>
  );
}
