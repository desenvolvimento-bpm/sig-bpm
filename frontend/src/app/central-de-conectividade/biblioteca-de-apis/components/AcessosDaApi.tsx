"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

import { type ColunaExportavel, ExportarTabela } from "@/components/shared/ExportarTabela";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { plural } from "@/lib/texto";

import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";
import { Erro } from "@/app/cenarios/components/CenarioDialog";

import { conectividadeService, type Acessos, type TipoDeBloqueio } from "../../services/conectividadeService";
import { Deslizante } from "./Deslizante";

/** Atendidos no cinza neutro; recusados no vermelho de estado (com a legenda e a dica: a cor nunca diz sozinha). */
const CONFIG = {
  atendidos: { label: "Atendidos", color: "var(--color-gray-500)" },
  recusados: { label: "Recusados", color: "var(--color-red-600)" },
} satisfies ChartConfig;

const PERIODOS = [7, 30, 90];
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
const diaCurto = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
/** O motivo da recusa, como o usuário o entende. */
const MOTIVO: Record<string, string> = {
  API_DESLIGADA: "API desligada",
  HTTPS_OBRIGATORIO: "sem HTTPS",
  SEM_BIBLIOTECA: "sem a tela APIs no perfil",
  SEM_PERMISSAO: "sem a leitura dos dados",
  USUARIO_BLOQUEADO: "usuário bloqueado",
  ENDERECO_BLOQUEADO: "endereço bloqueado",
  API_BLOQUEADA: "API bloqueada",
  PARAMETRO_INVALIDO: "parâmetro inválido",
  API_INEXISTENTE: "API inexistente",
  CENARIO_INEXISTENTE: "cenário inexistente",
  ITEM_INEXISTENTE: "card inexistente",
  FORMATO_INDISPONIVEL: "formato indisponível",
};

/** Uma barra fina, na proporção do maior, ao lado do número (a magnitude num tom só). */
function Barra({ valor, maximo }: { valor: number; maximo: number }) {
  return (
    <span className="inline-flex w-full items-center gap-2">
      <span className="h-1.5 min-w-16 flex-1 rounded-full bg-gray-100">
        <span className="block h-1.5 rounded-full bg-gray-500" style={{ width: `${maximo ? Math.max(2, (valor / maximo) * 100) : 0}%` }} />
      </span>
      <span className="w-10 text-right text-gray-800">{valor}</span>
    </span>
  );
}

/** Um destaque do período: amarelo-ouro à esquerda, como os das outras telas. */
function Indicador({ rotulo, valor, detalhe }: { rotulo: string; valor: number; detalhe?: string }) {
  return (
    <div className="rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-3">
      <p className="text-xs font-semibold tracking-wide text-gray-600 uppercase">{rotulo}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{valor.toLocaleString("pt-BR")}</p>
      {detalhe ? <p className="text-xs text-gray-500">{detalhe}</p> : null}
    </div>
  );
}

/**
 * Os acessos às APIs (24/10/2026, a Auditoria; desde 13/11/2026, a aba APIs da tela Acessos): quem edita a tela Acessos vê os de todos — os pedidos por dia, os usuários e
 * os endereços que chamam, as APIs mais pedidas e os últimos pedidos — e bloqueia ou libera um usuário ou um endereço no
 * controle deslizante; quem só lê vê os próprios.
 */
/** As colunas dos Últimos Pedidos no Exportar (30/10/2026), como na tabela. */
const COLUNAS_DOS_PEDIDOS: ColunaExportavel<Acessos["ultimos"][number]>[] = [
  { chave: "quando", rotulo: "Quando", valor: (u) => dataHora(u.quando) },
  { chave: "usuario", rotulo: "Usuário", valor: (u) => u.usuario },
  { chave: "endereco", rotulo: "Endereço", valor: (u) => u.endereco ?? "—" },
  { chave: "api", rotulo: "API", valor: (u) => `${u.api}${u.formato ? ` · ${u.formato}` : ""}` },
  {
    chave: "resultado",
    rotulo: "Resultado",
    valor: (u) => (u.status === 200 ? "Atendido" : `Recusado${u.motivo ? ` (${MOTIVO[u.motivo] ?? u.motivo})` : u.status ? ` (${u.status})` : ""}`),
  },
  { chave: "tempo", rotulo: "Tempo (ms)", tipo: "numero", valor: (u) => u.ms },
];

export function AcessosDaApi() {
  const queryClient = useQueryClient();
  const [dias, setDias] = useState(30);
  const consulta = useQuery({ queryKey: ["conectividade", "acessos", dias], queryFn: () => conectividadeService.acessos(dias) });
  const bloquear = useMutation({
    mutationFn: (b: { tipo: TipoDeBloqueio; valor: string; bloqueado: boolean; nome: string }) => conectividadeService.bloquear(b.tipo, b.valor, b.bloqueado),
    onSuccess: (r, b) => {
      toast.success(`${b.nome}: ${r.bloqueado ? "bloqueado nas APIs" : "liberado nas APIs"}.`);
      void queryClient.invalidateQueries({ queryKey: ["conectividade"] });
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível mudar o bloqueio.")),
  });
  const a: Acessos | undefined = consulta.data;
  if (consulta.isError) return <Erro erro={mensagemDeErro(consulta.error, "Erro ao carregar os acessos.")} />;
  if (!a) return <div className="h-64 animate-pulse rounded-sm bg-gray-100" />;
  // Os bloqueados sem pedido no período também aparecem (para liberar).
  const usuarios = [
    ...a.porUsuario,
    ...a.bloqueios.filter((b) => b.tipo === "USUARIO" && !a.porUsuario.some((u) => u.usuarioId === b.valor)).map((b) => ({ usuarioId: b.valor, nome: b.nome, total: 0, recusados: 0, ultimo: "", enderecos: [], bloqueado: true })),
  ];
  const enderecos = [
    ...a.porEndereco,
    ...a.bloqueios.filter((b) => b.tipo === "ENDERECO" && !a.porEndereco.some((e) => e.endereco === b.valor)).map((b) => ({ endereco: b.valor, total: 0, recusados: 0, ultimo: "", usuarios: [], bloqueado: true })),
  ];
  const maiorUsuario = Math.max(0, ...usuarios.map((u) => u.total));
  const maiorEndereco = Math.max(0, ...enderecos.map((e) => e.total));
  const maiorApi = Math.max(0, ...a.porApi.map((x) => x.total));
  const cabecalho = "bg-bpm-primary text-left text-xs font-bold text-black";
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-600">{a.todos ? "Os pedidos de todos os usuários às APIs." : "Os seus pedidos às APIs (quem edita a tela vê os de todos)."}</p>
        <span className="flex overflow-hidden rounded-sm border border-gray-300" role="radiogroup" aria-label="Período">
          {PERIODOS.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={dias === d}
              onClick={() => setDias(d)}
              className={`px-3 py-1 text-xs ${dias === d ? "bg-bpm-primary font-bold text-black" : "text-gray-700 hover:bg-gray-100"}`}
            >
              {d} dias
            </button>
          ))}
        </span>
        {/* O Exportar dos Últimos Pedidos (30/10/2026). */}
        <ExportarTabela
          titulo={`APIs · Últimos Pedidos · ${dias} dias`}
          colunas={COLUNAS_DOS_PEDIDOS}
          linhas={a.ultimos}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador rotulo="Pedidos" valor={a.totais.pedidos} detalhe={`nos últimos ${dias} dias`} />
        <Indicador rotulo="Recusados" valor={a.totais.recusados} detalhe={a.totais.pedidos ? `${Math.round((a.totais.recusados / a.totais.pedidos) * 100)}% dos pedidos` : undefined} />
        <Indicador rotulo="Usuários" valor={a.totais.usuarios} />
        <Indicador rotulo="Endereços" valor={a.totais.enderecos} detalhe="os computadores ou servidores que chamaram" />
      </div>
      <div className="rounded-sm border border-gray-200 bg-white p-4">
        <p className="mb-2 text-sm font-semibold text-gray-900">Pedidos por Dia</p>
        <ChartContainer config={CONFIG} className="aspect-auto h-56 w-full">
          <BarChart data={a.porDia} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="dia" tickFormatter={diaCurto} tickLine={false} axisLine={false} minTickGap={16} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
            <ChartTooltip content={<ChartTooltipContent labelFormatter={(d) => diaCurto(String(d))} />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="atendidos" stackId="pedidos" fill="var(--color-atendidos)" stroke="var(--background)" strokeWidth={2} maxBarSize={18} />
            <Bar dataKey="recusados" stackId="pedidos" fill="var(--color-recusados)" stroke="var(--background)" strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={18} />
          </BarChart>
        </ChartContainer>
      </div>
      <div className="overflow-x-auto rounded-sm border border-gray-200 bg-white">
        <p className="px-4 pt-3 pb-2 text-sm font-semibold text-gray-900">Pedidos por Usuário</p>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className={cabecalho}>
              <th className="px-3 py-2">Usuário</th>
              <th className="w-40 px-3 py-2 text-right">Pedidos</th>
              <th className="px-3 py-2 text-right">Recusados</th>
              <th className="px-3 py-2">Último</th>
              {a.todos ? <th className="px-3 py-2">Acesso</th> : null}
            </tr>
          </thead>
          <tbody>
            {usuarios.length ? null : (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                  Nenhum pedido no período.
                </td>
              </tr>
            )}
            {usuarios.map((u) => (
              <tr key={u.usuarioId} className="border-b border-gray-100 last:border-b-0">
                <td className="min-w-44 px-3 py-2">
                  <span className="font-medium text-gray-900">{u.nome}</span>
                  {u.enderecos.length ? <span className="block text-xs text-gray-500">{`${plural(u.enderecos.length, "1 endereço", `${u.enderecos.length} endereços`)}: ${u.enderecos.join(", ")}`}</span> : null}
                </td>
                <td className="px-3 py-2">
                  <Barra valor={u.total} maximo={maiorUsuario} />
                </td>
                <td className={`px-3 py-2 text-right ${u.recusados ? "font-semibold text-red-700" : "text-gray-500"}`}>{u.recusados}</td>
                <td className="px-3 py-2 text-xs whitespace-nowrap text-gray-600">{u.ultimo ? dataHora(u.ultimo) : "—"}</td>
                {a.todos ? (
                  <td className="px-3 py-2">
                    <Deslizante liberado={!u.bloqueado} rotulo={u.nome} desabilitado={bloquear.isPending} onMudar={(liberado) => bloquear.mutate({ tipo: "USUARIO", valor: u.usuarioId, bloqueado: !liberado, nome: u.nome })} />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto rounded-sm border border-gray-200 bg-white">
        <p className="px-4 pt-3 pb-2 text-sm font-semibold text-gray-900">Pedidos por Endereço</p>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className={cabecalho}>
              <th className="px-3 py-2">Endereço</th>
              <th className="w-40 px-3 py-2 text-right">Pedidos</th>
              <th className="px-3 py-2 text-right">Recusados</th>
              <th className="px-3 py-2">Último</th>
              {a.todos ? <th className="px-3 py-2">Acesso</th> : null}
            </tr>
          </thead>
          <tbody>
            {enderecos.length ? null : (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                  Nenhum pedido no período.
                </td>
              </tr>
            )}
            {enderecos.map((e) => (
              <tr key={e.endereco} className="border-b border-gray-100 last:border-b-0">
                <td className="min-w-44 px-3 py-2">
                  <span className="font-mono text-xs font-medium text-gray-900">{e.endereco}</span>
                  {e.usuarios.length ? <span className="block text-xs text-gray-500">{e.usuarios.join(", ")}</span> : null}
                </td>
                <td className="px-3 py-2">
                  <Barra valor={e.total} maximo={maiorEndereco} />
                </td>
                <td className={`px-3 py-2 text-right ${e.recusados ? "font-semibold text-red-700" : "text-gray-500"}`}>{e.recusados}</td>
                <td className="px-3 py-2 text-xs whitespace-nowrap text-gray-600">{e.ultimo ? dataHora(e.ultimo) : "—"}</td>
                {a.todos ? (
                  <td className="px-3 py-2">
                    <Deslizante liberado={!e.bloqueado} rotulo={e.endereco} desabilitado={bloquear.isPending} onMudar={(liberado) => bloquear.mutate({ tipo: "ENDERECO", valor: e.endereco, bloqueado: !liberado, nome: e.endereco })} />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded-sm border border-gray-200 bg-white p-4">
        <p className="mb-2 text-sm font-semibold text-gray-900">Pedidos por API</p>
        {a.porApi.length ? (
          <ul className="space-y-2 text-sm">
            {a.porApi.map((x) => (
              <li key={x.codigo}>
                <span className="flex justify-between text-gray-800">
                  <span>{x.nome}</span>
                  {x.recusados ? <span className="text-xs text-red-700">{plural(x.recusados, "1 recusado", `${x.recusados} recusados`)}</span> : null}
                </span>
                <Barra valor={x.total} maximo={maiorApi} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">Nenhum pedido no período.</p>
        )}
      </div>
      <div className="overflow-x-auto rounded-sm border border-gray-200 bg-white">
        <p className="px-4 pt-3 pb-2 text-sm font-semibold text-gray-900">Últimos Pedidos</p>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className={cabecalho}>
              <th className="px-3 py-2">Quando</th>
              <th className="px-3 py-2">Usuário</th>
              <th className="px-3 py-2">Endereço</th>
              <th className="px-3 py-2">API</th>
              <th className="px-3 py-2">Resultado</th>
              <th className="px-3 py-2 text-right">Tempo</th>
            </tr>
          </thead>
          <tbody>
            {a.ultimos.map((u, k) => (
              <tr key={k} className="border-b border-gray-100 last:border-b-0">
                <td className="px-3 py-1.5 whitespace-nowrap text-gray-600">{dataHora(u.quando)}</td>
                <td className="px-3 py-1.5 text-gray-900">{u.usuario}</td>
                <td className="px-3 py-1.5 font-mono text-gray-700">{u.endereco ?? "—"}</td>
                <td className="px-3 py-1.5 text-gray-800">
                  {u.api}
                  {u.formato ? <span className="text-gray-500"> · {u.formato}</span> : null}
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  {u.status === 200 ? (
                    <span className="text-gray-700">Atendido</span>
                  ) : (
                    <span className="font-semibold text-red-700">{`Recusado${u.motivo ? ` (${MOTIVO[u.motivo] ?? u.motivo})` : u.status ? ` (${u.status})` : ""}`}</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap text-gray-600">{u.ms === null ? "—" : `${u.ms.toLocaleString("pt-BR")} ms`}</td>
              </tr>
            ))}
            {a.ultimos.length ? null : (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-gray-500">
                  Nenhum pedido no período.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
