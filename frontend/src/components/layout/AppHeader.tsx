"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { podeSair } from "@/lib/alteracoesPendentes";
import { useTema, type Tema } from "@/lib/tema";
import { useAcessibilidade, type Acessibilidade } from "@/lib/acessibilidade";
import { useZoom, ZOOMS } from "@/lib/zoom";
import { Bell, ChevronRight, Eye, GraduationCap, House, KeyRound, LogOut, Palette, Settings, ZoomIn } from "lucide-react";

import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionContext";
import { etapasDoMes, rotulosDaEtapa } from "@/lib/etapasDoMes";
import { migalhas } from "@/lib/navigation-config";
import { gravarTelaInicial, lerTelaInicial, processosAcessiveis } from "@/lib/telaInicial";
import type { Novidade } from "@/lib/novidades";

import { relatoriosExecutivosService } from "@/app/analises-gerenciais/relatorios-executivos/services/relatoriosExecutivosService";
import { paineisDeBordoService } from "@/app/analises-gerenciais/paineis-de-bordo/services/paineisDeBordoService";

import { EtiquetaDoDesenvolvimento } from "./AmbienteDeDesenvolvimento";
import { abrirIntroducao } from "./IntroducaoAoSig";
import { NovidadesDialog, SinoDasNovidades, telasCom, useNovidades } from "./Novidades";
import { TrocarSenhaDialog } from "./TrocarSenhaDialog";
import { UsuariosOnline } from "./UsuariosOnline";

function getInitials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** Os temas no menu do usuário: Padrão (o retângulo dividido, preto | branco), Claro (branco) e Escuro (preto). */
const TEMAS: Array<{ tema: Tema; rotulo: string; fundo: string }> = [
  { tema: "padrao", rotulo: "Padrão", fundo: "bg-[linear-gradient(90deg,#111111_50%,#ffffff_50%)]" },
  { tema: "claro", rotulo: "Claro", fundo: "bg-[#ffffff]" },
  { tema: "escuro", rotulo: "Escuro", fundo: "bg-[#111111]" },
];

/**
 * A acessibilidade no menu do usuário (16/10/2026): Padrão (os destaques bons em verde) ou Daltonismo (em azul). Desde 22/11/2026
 * (pedido do Adão), cada opção mostra as cores dos destaques — vermelho, amarelo e verde, ou vermelho, amarelo e azul —, as dos
 * sinais dos Painéis de Bordo.
 */
const ACESSIBILIDADES: Array<{ valor: Acessibilidade; rotulo: string; dica: string; cores: string[] }> = [
  { valor: "padrao", rotulo: "Padrão", dica: "Padrão: os destaques bons em verde", cores: ["bg-red-600", "bg-yellow-500", "bg-green-600"] },
  { valor: "daltonismo", rotulo: "Daltonismo", dica: "Daltonismo: os destaques bons em azul, no lugar do verde", cores: ["bg-red-600", "bg-yellow-500", "bg-blue-600"] },
];

/**
 * Uma linha de opções do menu do usuário (22/11/2026, pedido do Adão), da Tela Inicial ao Zoom: o ícone e o nome à esquerda e as
 * opções à direita, todas com a mesma largura, a partir da metade da largura do menu.
 */
const LINHA_DE_OPCOES = "grid grid-cols-2 items-center px-1.5 py-1 text-sm";
const ROTULO_DA_LINHA = "flex min-w-0 items-center gap-1.5 pr-2";
/** Na lista da Tela Inicial (22/11/2026, pedido do Adão), a tela escolhida em amarelo e em negrito, também com o mouse em cima. */
const escolhida = (sim: boolean) => (sim ? "bg-bpm-primary font-bold text-black focus:bg-bpm-primary focus:text-black focus:**:text-black" : undefined);

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [trocandoSenha, setTrocandoSenha] = useState(false);
  // As Novidades (24/10/2026): as das telas do usuário; ao abrir, as não vistas ganham a etiqueta Nova e ficam vistas.
  const novidades = useNovidades();
  const [vendoNovidades, setVendoNovidades] = useState<Novidade[] | null>(null);
  const abrirNovidades = () => {
    setVendoNovidades(novidades.novas);
    novidades.marcar();
  };
  const [tema, escolherTema] = useTema();
  // A Tela Inicial (13/11/2026): a escolhida (guardada no navegador) e os processos que o perfil alcança (abaixo).
  const [telaInicial, setTelaInicial] = useState<string | null>(null);
  useEffect(() => {
    if (user) setTelaInicial(lerTelaInicial(user.id));
  }, [user]);
  const [acessibilidade, escolherAcessibilidade] = useAcessibilidade();
  const [zoom, escolherZoom] = useZoom();
  const { hasPermission } = usePermissions();
  const processos = processosAcessiveis(hasPermission);
  const etapas = etapasDoMes(hasPermission, user?.acesso);
  // O mês do relatório executivo aberto (16/10/2026), no caminho: a mesma consulta da tela, que o cache já tem.
  const idDoRelatorio = pathname.match(/^\/analises-gerenciais\/relatorios-executivos\/([0-9a-f-]{36})/)?.[1] ?? null;
  const relatorio = useQuery({
    queryKey: ["relatorios-executivos", "relatorio", idDoRelatorio],
    queryFn: () => relatoriosExecutivosService.obter(idDoRelatorio!),
    enabled: !!idDoRelatorio,
  });
  // O nome do painel de bordo aberto (31/10/2026), no caminho, como o mês do relatório.
  const idDoPainel = pathname.match(/^\/analises-gerenciais\/paineis-de-bordo\/([0-9a-f-]{36})/)?.[1] ?? null;
  const painel = useQuery({
    queryKey: ["paineis-de-bordo", "relatorio", idDoPainel],
    queryFn: () => paineisDeBordoService.obter(idDoPainel!),
    enabled: !!idDoPainel,
  });
  const caminho = migalhas(pathname, (trecho) => rotulosDaEtapa(etapas, trecho), (idDoPainel ? painel.data?.nome : relatorio.data?.rotuloMes) ?? null);

  async function handleLogout() {
    if (!podeSair()) return;
    await logout();
    router.push("/auth/login");
    router.refresh();
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <EtiquetaDoDesenvolvimento />

      <Breadcrumb className="hidden sm:block">
        <BreadcrumbList>
          {caminho.map((m, i) => (
            <Fragment key={`${i}-${m.rotulo}`}>
              {i > 0 ? <BreadcrumbSeparator /> : null}
              <BreadcrumbItem>
                {i === caminho.length - 1 ? (
                  <BreadcrumbPage>{m.rotulo}</BreadcrumbPage>
                ) : m.href ? (
                  <BreadcrumbLink render={<Link href={m.href} />}>{m.rotulo}</BreadcrumbLink>
                ) : (
                  <span className="text-muted-foreground">{m.rotulo}</span>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex items-center gap-2">
        {/* Quantos usuários estão online (24/10/2026): só para o Administrador. */}
        <UsuariosOnline />
        {/* O sino das novidades ainda não vistas (24/10/2026), ao lado do nome. */}
        <SinoDasNovidades novas={novidades.novas} onAbrir={abrirNovidades} />
        {/* As iniciais ficam fora do botão (22/11/2026, pedido do Adão): o menu abre no nome e na engrenagem à direita dele. */}
        <Avatar size="sm">
          <AvatarFallback className="bg-bpm-primary text-xs font-semibold text-black">
            {getInitials(user?.nome ?? "U")}
          </AvatarFallback>
        </Avatar>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                className="-ml-1 h-9 gap-1.5 px-2"
                aria-label="Menu do usuário"
                title="Menu do usuário"
                data-tour="menu-do-usuario"
              />
            }
          >
            <span className="hidden max-w-[140px] truncate text-sm font-medium md:inline">
              {user?.nome ?? "Usuário"}
            </span>
            <Settings className="size-4 shrink-0" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{user?.nome}</span>
                  <span className="text-xs text-muted-foreground">{user?.email}</span>
                  {user?.perfil ? <span className="text-xs text-muted-foreground">Perfil: {user.perfil.nome}</span> : null}
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            {/*
              A Tela Inicial (13/11/2026, pedido do Adão), logo antes do Tema: o processo que o SIG abre ao entrar, entre os que o
              perfil alcança (por grupo, como no menu lateral); Padrão, o início de sempre.
            */}
            <DropdownMenuSub>
              {/*
                O nome da tela escolhida (22/11/2026, pedido do Adão), abreviado se não couber (inteiro na dica), num retângulo que abre a
                lista das telas, no lugar da seta do submenu.
              */}
              <DropdownMenuSubTrigger className={`${LINHA_DE_OPCOES} gap-0 [&>svg:last-child]:hidden`} title={`Tela Inicial: ${telaInicial ?? "Padrão"}`}>
                <span className={ROTULO_DA_LINHA}>
                  <House className="size-4 shrink-0" />
                  Tela Inicial
                </span>
                <span className="flex h-6 w-full min-w-0 items-center justify-end gap-0.5 rounded-sm border border-gray-300 pr-1 pl-1.5 text-xs text-gray-700">
                  <span className="min-w-0 truncate">{telaInicial ?? "Padrão"}</span>
                  <ChevronRight className="size-3.5" />
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-[70vh] w-64 overflow-y-auto">
                <DropdownMenuRadioGroup
                  value={telaInicial ?? ""}
                  onValueChange={(v) => {
                    if (!user) return;
                    const escolhido = String(v) || null;
                    gravarTelaInicial(user.id, escolhido);
                    setTelaInicial(escolhido);
                  }}
                >
                  <DropdownMenuRadioItem value="" className={escolhida(telaInicial === null)}>
                    Padrão
                  </DropdownMenuRadioItem>
                  {processos.map((g) => (
                    <DropdownMenuGroup key={g.grupo}>
                      {/* O grupo com o destaque amarelo à esquerda, em negrito e caixa alta, como no menu lateral (22/11/2026). */}
                      <DropdownMenuLabel className="flex items-center gap-2 text-xs font-bold text-gray-700 uppercase">
                        <span aria-hidden className="h-3 w-1 shrink-0 bg-bpm-primary" />
                        {g.grupo}
                      </DropdownMenuLabel>
                      {g.processos.map((p) => (
                        <DropdownMenuRadioItem key={p.titulo} value={p.titulo} className={escolhida(telaInicial === p.titulo)}>
                          {p.titulo}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuGroup>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {/* O tema (13/10/2026; 22/11/2026, retângulos no lugar dos círculos): Padrão (preto | branco), Claro (branco) e Escuro (preto). */}
            <div className={LINHA_DE_OPCOES}>
              {/* O ícone antes de Tema, como os dos demais itens do menu (13/10/2026). */}
              <span className={ROTULO_DA_LINHA}>
                <Palette className="size-4 shrink-0" />
                Tema
              </span>
              <span className="flex w-full items-center gap-1.5" role="radiogroup" aria-label="Tema">
                {TEMAS.map((t) => (
                  <button
                    key={t.tema}
                    type="button"
                    role="radio"
                    aria-checked={tema === t.tema}
                    aria-label={t.rotulo}
                    title={t.rotulo}
                    onClick={() => escolherTema(t.tema)}
                    className={`h-6 flex-1 rounded-sm border border-gray-400 outline-none focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-gray-400 ${t.fundo} ${tema === t.tema ? "ring-2 ring-bpm-primary ring-offset-1 ring-offset-[var(--popover)]" : "hover:ring-1 hover:ring-gray-400"}`}
                  />
                ))}
              </span>
            </div>
            {/*
              A Acessibilidade (16/10/2026; antes, a lista Cores do Configurar Gráficos dos painéis), logo abaixo do Tema: com
              Daltonismo, os destaques bons dos Painéis de Bordo e dos Relatórios Executivos ficam azuis no lugar do verde.
            */}
            <div className={LINHA_DE_OPCOES}>
              <span className={ROTULO_DA_LINHA}>
                <Eye className="size-4 shrink-0" />
                Acessibilidade
              </span>
              {/* Cada opção com as cores dos destaques (22/11/2026, pedido do Adão), marcada como no Tema. */}
              <span className="flex w-full items-center gap-1.5" role="radiogroup" aria-label="Acessibilidade">
                {ACESSIBILIDADES.map((a) => (
                  <button
                    key={a.valor}
                    type="button"
                    role="radio"
                    aria-checked={acessibilidade === a.valor}
                    aria-label={a.rotulo}
                    title={a.dica}
                    onClick={() => escolherAcessibilidade(a.valor)}
                    className={`flex h-6 flex-1 items-center justify-center gap-1 rounded-sm border border-gray-300 outline-none focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-gray-400 ${acessibilidade === a.valor ? "ring-2 ring-bpm-primary ring-offset-1 ring-offset-[var(--popover)]" : "hover:ring-1 hover:ring-gray-400"}`}
                  >
                    {a.cores.map((cor) => (
                      <span key={cor} className={`size-3 rounded-[2px] ${cor}`} />
                    ))}
                  </button>
                ))}
              </span>
            </div>
            {/*
              O Zoom (18/11/2026, pedido do Adão), logo abaixo da Acessibilidade: o tamanho das telas — Menor (85%), Padrão (100%) ou
              Máximo (125%), guardado neste navegador (lib/zoom.ts).
            */}
            <div className={LINHA_DE_OPCOES}>
              <span className={ROTULO_DA_LINHA}>
                <ZoomIn className="size-4 shrink-0" />
                Zoom
              </span>
              {/* A↓, A e A↑ no lugar de Menor, Padrão e Máximo (22/11/2026, pedido do Adão; os nomes ficam na dica). */}
              <span className="flex h-6 w-full overflow-hidden rounded-sm border border-gray-300" role="radiogroup" aria-label="Zoom">
                {ZOOMS.map((z) => (
                  <button
                    key={z.valor}
                    type="button"
                    role="radio"
                    aria-checked={zoom === z.valor}
                    aria-label={z.rotulo}
                    title={z.dica}
                    onClick={() => escolherZoom(z.valor)}
                    className={`flex-1 text-xs outline-none focus-visible:bg-gray-100 ${zoom === z.valor ? "bg-bpm-primary font-bold text-black" : "text-gray-700 hover:bg-gray-100"}`}
                  >
                    {z.icone}
                  </button>
                ))}
              </span>
            </div>
            <DropdownMenuSeparator />
            {/* As Novidades (24/10/2026), só com alguma das telas do usuário; o número: as telas com novidades não vistas. */}
            {novidades.lista.length ? (
              <DropdownMenuItem onClick={abrirNovidades}>
                <Bell />
                Novidades
                {novidades.novas.length ? (
                  <span className="ml-auto rounded-sm bg-bpm-primary px-1.5 text-[10px] font-bold text-black">{telasCom(novidades.novas)}</span>
                ) : null}
              </DropdownMenuItem>
            ) : null}
            {/* A Introdução ao SIG (21/10/2026): o tour sobre a tela atual (o layout o desenha). */}
            <DropdownMenuItem onClick={abrirIntroducao}>
              <GraduationCap />
              Introdução ao SIG
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTrocandoSenha(true)}>
              <KeyRound />
              Trocar senha
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void handleLogout()}>
              <LogOut />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {trocandoSenha ? <TrocarSenhaDialog onFechar={() => setTrocandoSenha(false)} /> : null}
      {vendoNovidades ? <NovidadesDialog lista={novidades.lista} novas={vendoNovidades} onFechar={() => setVendoNovidades(null)} /> : null}
    </header>
  );
}
