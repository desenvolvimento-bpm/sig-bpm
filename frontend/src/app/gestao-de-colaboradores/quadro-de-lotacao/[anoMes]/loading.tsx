import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";

/**
 * As abas de uma competência do Quadro de Lotação têm o mês na URL, então o Next as renderiza a cada requisição: a
 * fronteira de Suspense que o Cache Components exige, com um esqueleto enquanto a página carrega (como nas do Fechamento).
 */
export default function CarregandoCompetenciaDoQuadro() {
  return (
    <div className="p-4 md:p-6">
      <LoadingSkeleton rows={6} />
    </div>
  );
}
