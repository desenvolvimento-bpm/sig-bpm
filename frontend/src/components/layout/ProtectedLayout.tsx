"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, ShieldOff } from "lucide-react";

import { AppHeader } from "@/components/layout/AppHeader";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { AvisoDeSaida } from "@/components/layout/AvisoDeSaida";
import { BarraDeTelas } from "@/components/layout/BarraDeTelas";
import { EtapasDoMes } from "@/components/layout/EtapasDoMes";
import { FaixaDaPublicacao } from "@/components/layout/FaixaDaPublicacao";
import { IntroducaoDoLayout } from "@/components/layout/IntroducaoAoSig";
import { BarraDoCenario, lerRotaDoCenario } from "@/app/cenarios/components/BarraDoCenario";
import { SituacaoDaCompetenciaDoQuadro, competenciaDoQuadroNaRota } from "@/app/gestao-de-colaboradores/quadro-de-lotacao/components/SituacaoDaCompetenciaDoQuadro";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionContext";
import { abasDoMes, lerRotaDoMes } from "@/lib/etapasDoMes";
import { abasDaTela, grupoDaTela, permissaoDaTela, primeiraTelaPermitida } from "@/lib/navigation-config";
import { AbasDaTela } from "@/components/shared/AbasDaTela";

type ProtectedLayoutProps = {
  children: ReactNode;
};

/** A tela aberta pela URL sem a permissão dela: aviso, sem carregar nada (o backend também recusa os dados). */
function SemAcesso({ inicio }: { inicio: string | null }) {
  return (
    <div className="mx-auto mt-10 max-w-lg space-y-3 rounded-sm border border-gray-200 bg-white p-6 text-center">
      <ShieldOff className="mx-auto size-8 text-gray-400" />
      <h1 className="text-lg font-bold text-gray-900">Sem acesso a esta tela</h1>
      <p className="text-sm text-gray-600">O seu perfil de usuário não inclui esta tela. Se precisar dela, fale com o setor Contábil.</p>
      {inicio ? (
        <Link href={inicio} className="inline-block text-sm font-medium text-gray-900 underline underline-offset-2">
          Ir para uma tela do seu perfil
        </Link>
      ) : null}
    </div>
  );
}

export function ProtectedLayout({ children }: ProtectedLayoutProps) {
  const pathname = usePathname();
  const { isLoading, user } = useAuth();
  const { hasPermission } = usePermissions();
  const exigida = permissaoDaTela(pathname);
  const bloqueada = !isLoading && exigida !== null && !hasPermission(exigida);
  const router = useRouter();
  const inicio = primeiraTelaPermitida(hasPermission);
  // O início (as competências) sem o Fechamento Mensal: vai para a primeira tela do menu que o perfil alcança.
  useEffect(() => {
    if (bloqueada && pathname === "/competencias" && inicio) router.replace(inicio);
  }, [bloqueada, pathname, inicio, router]);
  // Nas telas de um mês, a barra de etapas fica no topo do conteúdo.
  const doMes = lerRotaDoMes(pathname);
  // Nas telas de um grupo (cadastros, usuários), a barra do grupo.
  const doGrupo = grupoDaTela(pathname);
  // Nas telas de um cenário sintético, a barra do cenário (Resultados e Indicadores).
  const doCenario = lerRotaDoCenario(pathname);
  // Nas telas com abas (17/10/2026: os Cadastros da Controladoria), o nome da tela e as abas que o perfil alcança.
  // Nas etapas do mês com abas (27/10/2026: Totais e Prévias), o nome da etapa e as abas dela.
  const abas = abasDaTela(pathname, hasPermission) ?? abasDoMes(pathname, hasPermission);

  return (
    <SidebarProvider>
      {/* O aviso ao sair com alterações não gravadas (13/10/2026), em todas as telas. */}
      <AvisoDeSaida />
      {/* A Introdução ao SIG (21/10/2026), aberta pelo menu do usuário: por cima do menu lateral e da tela. */}
      <IntroducaoDoLayout />
      <AppSidebar />
      {/* Fundo opaco (a mesma cor de antes), para o título fixo da tela cobrir o que passa por baixo. */}
      <SidebarInset className="min-w-0 bg-[color-mix(in_srgb,var(--muted)_30%,var(--background))]">
        <AppHeader />
        {/* O modo de publicação (21/10/2026): só consulta enquanto o servidor é atualizado. */}
        <FaixaDaPublicacao />
        {user?.divergenciasAbertas && (pathname === "/competencias" || pathname.startsWith("/competencias/")) ? (
          // O aviso de divergência aberta (Passo 24), só nas telas de competência e do mês
          // (decisão D3 do levantamento de layout); leva ao mês com divergências abertas.
          <Link
            href="/divergencias"
            title="Dado recebido depois do fechamento ou da apuração que difere do gravado"
            className="flex items-center gap-2 border-b border-yellow-200 bg-yellow-50 px-4 py-2 text-sm text-yellow-800 hover:bg-yellow-100 md:px-6"
          >
            <AlertTriangle className="size-4 shrink-0" />
            {user.divergenciasAbertas === 1 ? "1 divergência aberta" : `${user.divergenciasAbertas} divergências abertas`} · Ver divergências
          </Link>
        ) : null}
        <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
          {doMes && user ? <EtapasDoMes anoMes={doMes.anoMes} chave={doMes.chave} resto={doMes.resto} /> : null}
          {/* Na tela inicial do processo (12/11/2026: a lista das competências da Gestão de Colaboradores), sem a barra, como na do Fechamento Mensal. */}
          {doGrupo?.tela && user ? (
            <BarraDeTelas
              grupo={doGrupo.grupo}
              atual={doGrupo.tela?.title ?? ""}
              // A situação da competência do Quadro de Lotação aberta (12/11/2026), à direita da barra, como no Fechamento Mensal.
              etiquetas={competenciaDoQuadroNaRota(pathname) ? <SituacaoDaCompetenciaDoQuadro anoMes={competenciaDoQuadroNaRota(pathname)!} /> : undefined}
            />
          ) : null}
          {doCenario && user && !bloqueada ? <BarraDoCenario id={doCenario.id} tela={doCenario.tela} /> : null}
          {isLoading && exigida ? (
            <div className="h-40 animate-pulse rounded-sm bg-gray-100" />
          ) : bloqueada ? (
            <SemAcesso inicio={inicio} />
          ) : (
            <AbasDaTela.Provider value={abas}>{children}</AbasDaTela.Provider>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
