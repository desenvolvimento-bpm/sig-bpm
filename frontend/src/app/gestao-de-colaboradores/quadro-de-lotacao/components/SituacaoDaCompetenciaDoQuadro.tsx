"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { StatusCompetenciaBadge } from "@/app/competencias/components/StatusCompetenciaBadge";
import { usePermissions } from "@/context/PermissionContext";

import { quadroService } from "../../services/quadroService";

/** A competência do Quadro de Lotação no endereço ("/gestao-de-colaboradores/quadro-de-lotacao/2026-10/realizado" → "2026-10"). */
export function competenciaDoQuadroNaRota(pathname: string) {
  return pathname.match(/^\/gestao-de-colaboradores\/quadro-de-lotacao\/(\d{4}-\d{2})(\/|$)/)?.[1] ?? null;
}

/**
 * A situação da competência aberta (12/11/2026, pedido do Adão; antes, ao lado do título, depois do mês), à direita da barra
 * das telas, como a do Fechamento Mensal. A mesma consulta da lista das competências (o cache dela).
 */
export function SituacaoDaCompetenciaDoQuadro({ anoMes }: { anoMes: string }) {
  const lista = useQuery({ queryKey: ["quadro", "competencias"], queryFn: quadroService.competencias });
  const c = lista.data?.itens.find((x) => `${x.ano}-${String(x.mes).padStart(2, "0")}` === anoMes);
  return c ? <StatusCompetenciaBadge status={c.status} /> : null;
}

/** A última competência aberta neste navegador (o endereço com a aba), para o Quadro de Lotação da barra voltar a ela. */
const ULTIMA = "sig-quadro-ultima-competencia";
export function guardarCompetenciaAberta(caminho: string) {
  try {
    sessionStorage.setItem(ULTIMA, caminho);
  } catch {
    // Sem o armazenamento do navegador, a barra abre a competência mais recente.
  }
}
function ultimaCompetenciaAberta() {
  try {
    return sessionStorage.getItem(ULTIMA);
  } catch {
    return null;
  }
}

/**
 * O Quadro de Lotação sem competência (12/11/2026: a tela da barra): abre a última competência aberta neste navegador (na
 * mesma aba); sem ela, a aberta mais recente ou, sem nenhuma aberta, a mais recente, na primeira aba que o perfil alcança.
 * Sem competências, volta à lista (o início da Gestão de Colaboradores).
 */
export function AbrirQuadroDeLotacao() {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const lista = useQuery({ queryKey: ["quadro", "competencias"], queryFn: quadroService.competencias });
  useEffect(() => {
    if (!lista.data && !lista.isError) return;
    const itens = lista.data?.itens ?? [];
    const anoMes = (c: { ano: number; mes: number }) => `${c.ano}-${String(c.mes).padStart(2, "0")}`;
    const ultima = ultimaCompetenciaAberta();
    const daUltima = ultima ? competenciaDoQuadroNaRota(ultima) : null;
    if (ultima && daUltima && itens.some((c) => anoMes(c) === daUltima)) return void router.replace(ultima);
    const escolhida = itens.find((c) => c.status === "ABERTA") ?? itens[0];
    const aba = ["movimentacoes", "controle", "realizado", "jornada"].find((a) => hasPermission(`colaboradores_quadro.${a}:ler`));
    router.replace(escolhida && aba ? `/gestao-de-colaboradores/quadro-de-lotacao/${anoMes(escolhida)}/${aba}` : "/gestao-de-colaboradores");
  }, [lista.data, lista.isError, hasPermission, router]);
  return <div className="h-40 animate-pulse rounded-sm bg-gray-100" />;
}
