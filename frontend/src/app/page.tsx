"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionContext";
import { enderecoDaTelaInicial } from "@/lib/telaInicial";

/**
 * O endereço raiz: a Tela Inicial do usuário (13/11/2026, escolhida no menu do usuário), quando ele a tem e o perfil ainda
 * alcança o processo; senão, as competências do Fechamento Mensal (sem ele, o ProtectedLayout leva à primeira tela do menu).
 */
export default function HomePage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { hasPermission } = usePermissions();
  useEffect(() => {
    if (isLoading) return;
    if (!user) return void router.replace("/auth/login");
    router.replace(enderecoDaTelaInicial(user.id, hasPermission) ?? "/competencias");
  }, [isLoading, user, hasPermission, router]);
  return null;
}
