import { ProtectedLayout } from "@/components/layout/ProtectedLayout";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { SemLeitura } from "@/components/shared/SemLeitura";

import { RedistribuicoesContent } from "./RedistribuicoesContent";

/** As Redistribuições de Gastos (13/11/2026, pedido do Adão; Cadastros Gerais / Controladoria). */
export default function RedistribuicoesGastosPage() {
  return (
    <ProtectedLayout>
      <PermissionGuard permission="cadastro_controladoria.redistribuicoes:ler" fallback={<SemLeitura />}>
        <RedistribuicoesContent />
      </PermissionGuard>
    </ProtectedLayout>
  );
}
