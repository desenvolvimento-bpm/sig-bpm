"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable } from "@/components/shared/DataTable";
import { ExportarTabela } from "@/components/shared/ExportarTabela";
import { QuadroTabela } from "@/components/shared/QuadroTabela";
import { useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import { usePermissions } from "@/context/PermissionContext";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";
import type { Coluna } from "@/lib/filtrosDeTabela";
import { botaoPrimario } from "@/app/cenarios/components/CenarioDialog";
import { mensagemDeErro } from "@/app/cadastros/services/edicaoService";

import { quadroService, type LinhaDaJornada } from "../../services/quadroService";
import { CabecalhoDoQuadro, rotuloDoMes } from "./CabecalhoDoQuadro";

/** 750 minutos → "12:30". */
export const hhmm = (minutos: number) => `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
const dias = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

const COLUNAS: Coluna<LinhaDaJornada>[] = [
  { chave: "departamento", rotulo: "Departamento", valor: (l) => l.departamento },
  { chave: "centro", rotulo: "Centro de Custo", valor: (l) => l.centroCusto },
  { chave: "funcao", rotulo: "Função", valor: (l) => l.funcao },
  { chave: "horasExtras", rotulo: "Horas Extras", tipo: "numero", alinhamento: "direita", valor: (l) => l.horasExtrasMinutos, texto: (l) => hhmm(l.horasExtrasMinutos) },
  { chave: "faltas", rotulo: "Faltas (dias)", tipo: "numero", alinhamento: "direita", valor: (l) => l.faltasDias, texto: (l) => dias(l.faltasDias) },
];
const ACOES: Coluna<LinhaDaJornada> = { chave: "acoes", rotulo: "Ações", semFiltro: true, classe: "w-20" };

/** O modal Editar Jornada: as horas extras realizadas (HH:MM) e as faltas aferidas (dias) da linha. */
function EditarJornadaDialog({ anoMes, linha, onFechar }: { anoMes: string; linha: LinhaDaJornada; onFechar: () => void }) {
  const queryClient = useQueryClient();
  const [horas, setHoras] = useState(hhmm(linha.horasExtrasMinutos));
  const [faltas, setFaltas] = useState(dias(linha.faltasDias));
  const horasValidas = /^\d{1,4}:[0-5]\d$/.test(horas.trim());
  const numeroDasFaltas = Number(faltas.trim().replace(/\./g, "").replace(",", "."));
  const faltasValidas = faltas.trim() !== "" && Number.isFinite(numeroDasFaltas) && numeroDasFaltas >= 0;
  const gravar = useMutation({
    mutationFn: () => quadroService.gravarJornada(anoMes, { centroCustoId: linha.centroCustoId, funcaoId: linha.funcaoId, horasExtras: horas.trim(), faltas: numeroDasFaltas }),
    onSuccess: () => {
      toast.success("Jornada gravada.");
      void queryClient.invalidateQueries({ queryKey: ["quadro", "jornada", anoMes] });
      onFechar();
    },
  });
  return (
    <Dialog open onOpenChange={(aberto) => (!aberto ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="rounded-sm sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar Jornada</DialogTitle>
          <DialogDescription>
            {linha.centroCusto} · {linha.funcao}, em {rotuloDoMes(anoMes)}: as horas extras realizadas e as faltas aferidas.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="jornada-horas">Horas Extras (HH:MM)</Label>
            <Input id="jornada-horas" value={horas} onChange={(e) => setHoras(e.target.value)} placeholder="00:00" inputMode="numeric" className="rounded-sm" />
            {!horasValidas ? <p className="text-xs text-red-700">No formato HH:MM (por exemplo, 12:30).</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="jornada-faltas">Faltas (dias)</Label>
            <Input id="jornada-faltas" value={faltas} onChange={(e) => setFaltas(e.target.value)} placeholder="0" inputMode="decimal" className="rounded-sm" />
            {!faltasValidas ? <p className="text-xs text-red-700">Em dias, a partir de zero (meio dia: 0,5).</p> : null}
          </div>
        </div>
        {gravar.isError ? <p className="text-sm text-red-700">{mensagemDeErro(gravar.error, "Não foi possível gravar a jornada.")}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={!horasValidas || !faltasValidas || gravar.isPending} onClick={() => gravar.mutate()}>
            {gravar.isPending ? "Gravando…" : "Gravar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A aba Jornada de uma competência do Quadro de Lotação (13/11/2026, pedido do Adão): as linhas do quadro realizado do fim do
 * mês (o Departamento, o Centro de Custo e a Função, com a senioridade dela), com as Horas Extras (HH:MM) e as Faltas (dias)
 * digitadas no Editar de cada linha. Sem o recorte (só a aba Aprovações tem).
 */
export function JornadaContent() {
  const { anoMes } = useParams<{ anoMes: string }>();
  useRegistrarAcessoTela(`/gestao-de-colaboradores/quadro-de-lotacao/${anoMes}/jornada`);
  const { hasPermission } = usePermissions();
  const consulta = useQuery({ queryKey: ["quadro", "jornada", anoMes], queryFn: () => quadroService.jornada(anoMes) });
  const aberta = consulta.data?.competencia.status === "ABERTA";
  const pode = hasPermission("colaboradores_quadro.jornada:editar") && aberta;
  const colunas = pode ? [...COLUNAS, ACOES] : COLUNAS;
  const tabela = useTabelaFiltravel(consulta.data?.linhas, colunas, { porPaginaInicial: 50 });
  const [editando, setEditando] = useState<LinhaDaJornada | null>(null);
  const somaHoras = tabela.filtradas.reduce((s, l) => s + l.horasExtrasMinutos, 0);
  const somaFaltas = tabela.filtradas.reduce((s, l) => s + l.faltasDias, 0);

  return (
    <div className="space-y-4">
      <CabecalhoDoQuadro
        anoMes={anoMes}
        aba="jornada"
        sobre={
          <p>
            A jornada do mês no quadro de lotação realizado: cada linha do quadro do fim do mês (o centro de custo e a função, com a senioridade dela; CLT e
            PJ juntos), com as horas extras realizadas e as faltas aferidas. Todas as linhas aparecem, com qualquer recorte.
          </p>
        }
        comoUsar={
          <ul>
            <li>
              No Editar de cada linha (na coluna Ações), digite as Horas Extras no formato HH:MM (por exemplo, 12:30) e as Faltas em dias (meio dia: 0,5) e
              clique em Gravar. A gravação fica na Auditoria.
            </li>
            <li>Com a competência fechada, a jornada fica como está: reabra-a na lista das competências para mudar.</li>
            <li>Use os filtros nos rótulos das colunas; a linha Total soma as linhas filtradas (as horas extras em HH:MM).</li>
          </ul>
        }
        exportar={<ExportarTabela titulo={`Quadro de Lotação · Jornada · ${rotuloDoMes(anoMes)}`} colunas={COLUNAS} linhas={tabela.filtradas} />}
      />
      <QuadroTabela>
        <DataTable<LinhaDaJornada>
          data={tabela.visiveis}
          cabecalho={tabela.cabecalho}
          filtrosAtivos={tabela.ativos}
          onLimparFiltros={tabela.limpar}
          isLoading={consulta.isPending}
          error={consulta.isError ? mensagemDeErro(consulta.error, "Erro ao carregar a jornada.") : null}
          emptyMessage="Nenhuma linha no quadro realizado desta competência"
          emptyHint="O quadro começa no Lançamento Inicial (Cadastros Auxiliares) e muda com as movimentações aprovadas."
          columns={colunas.map((c) => c.rotulo)}
          renderRow={(l) => (
            <tr key={`${l.centroCustoId}|${l.funcaoId}`} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="px-4 py-2 text-sm">{l.departamento ?? <span className="text-gray-400">—</span>}</td>
              <td className="px-4 py-2 text-sm">{l.centroCusto}</td>
              <td className="px-4 py-2 text-sm">{l.funcao}</td>
              <td className="px-4 py-2 text-right text-sm">{l.horasExtrasMinutos ? hhmm(l.horasExtrasMinutos) : <span className="text-gray-400">00:00</span>}</td>
              <td className="px-4 py-2 text-right text-sm">{l.faltasDias ? dias(l.faltasDias) : <span className="text-gray-400">0</span>}</td>
              {pode ? (
                <td className="px-4 py-2">
                  <Button type="button" size="sm" variant="outline" className="h-7 rounded-sm" onClick={() => setEditando(l)} title="Editar as horas extras e as faltas">
                    <Pencil className="size-3.5" />
                    Editar
                  </Button>
                </td>
              ) : null}
            </tr>
          )}
          rodape={
            tabela.filtradas.length ? (
              <tr className="border-t border-gray-300 bg-gray-50 text-sm font-bold">
                <td className="px-4 py-2" colSpan={3}>
                  Total
                </td>
                <td className="px-4 py-2 text-right">{hhmm(somaHoras)}</td>
                <td className="px-4 py-2 text-right">{dias(somaFaltas)}</td>
                {pode ? <td /> : null}
              </tr>
            ) : null
          }
        />
      </QuadroTabela>
      {editando ? <EditarJornadaDialog anoMes={anoMes} linha={editando} onFechar={() => setEditando(null)} /> : null}
    </div>
  );
}
