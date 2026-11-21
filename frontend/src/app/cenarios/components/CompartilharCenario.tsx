"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { ConfirmacaoDialog } from "@/components/shared/ConfirmacaoDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";

import { cenariosService, type CompartilhamentoDoCenario, type UsuarioDoCompartilhamento } from "../services/cenariosService";
import { botaoPrimario, Erro } from "./CenarioDialog";

const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
/** Sem diferença de maiúsculas e acentos, na busca. */
const normal = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const ACESSO = (soLe: boolean) => (soLe ? "Só Leitura" : "Pelo Perfil");

/**
 * O Compartilhar do cenário particular (21/11/2026, pedido do Adão: na aba Cenário das Configurações, depois da Visualização; nos
 * moldes do Compartilhar dos Painéis e Apresentações): quem criou o cenário (ou o Administrador) convida outros usuários a vê-lo.
 * Cada convidado usa as telas do cenário pelo seu perfil: o perfil só de leitura nos cenários só vê. A Edição das Configurações
 * continua valendo nesta tela. Só os usuários ativos com o acesso aos cenários do tipo podem ser convidados (os Administradores já
 * veem todos). Os demais veem a lista, só para leitura.
 */
export function CompartilharCenario({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const chave = ["cenarios", id, "compartilhamento"];
  const consulta = useQuery({ queryKey: chave, queryFn: () => cenariosService.compartilhamento(id) });
  const [convidando, setConvidando] = useState(false);
  const [removendo, setRemovendo] = useState<UsuarioDoCompartilhamento | null>(null);
  const atualizar = (c: CompartilhamentoDoCenario) => queryClient.setQueryData(chave, c);
  const remover = useMutation({
    mutationFn: (u: UsuarioDoCompartilhamento) => cenariosService.removerCompartilhamento(id, u.id),
    onSuccess: (c, u) => {
      setRemovendo(null);
      atualizar(c);
      toast.success(`${u.nome} não vê mais o cenário.`);
    },
  });
  if (consulta.isError) return <Erro erro={mensagemDeErro(consulta.error, "Erro ao carregar o compartilhamento do cenário.")} />;
  if (!consulta.data) return <div className="h-24 animate-pulse rounded-sm bg-gray-100" />;
  const c = consulta.data;
  return (
    <div className="space-y-2 rounded-sm border border-gray-200 bg-gray-50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-none font-medium text-gray-900">Compartilhar</p>
          <p className="mt-1.5 text-xs text-gray-600">
            Os usuários convidados veem este cenário particular, com {c.criadoPor ?? "quem o criou"} e os Administradores. Cada um usa as telas do cenário
            pelo seu perfil: o perfil só de leitura nos cenários só vê, sem editar.
          </p>
        </div>
        {c.podeCompartilhar ? (
          <Button
            type="button"
            className={botaoPrimario}
            disabled={!c.candidatos.length}
            title={c.candidatos.length ? undefined : "Nenhum outro usuário com acesso aos cenários para convidar"}
            onClick={() => setConvidando(true)}
          >
            <UserPlus className="size-4" />
            Convidar
          </Button>
        ) : null}
      </div>
      {c.usuarios.length ? (
        <div className="overflow-x-auto rounded-sm border border-gray-200 bg-white">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-bold tracking-wide text-gray-700 uppercase">
                <th className="px-3 py-2">Usuário</th>
                <th className="px-3 py-2">Perfil</th>
                <th className="px-3 py-2">Acesso</th>
                <th className="px-3 py-2">Convidado Por</th>
                {c.podeCompartilhar ? <th className="w-28 px-3 py-2" /> : null}
              </tr>
            </thead>
            <tbody>
              {c.usuarios.map((u) => (
                <tr key={u.id} className="border-b border-gray-100 last:border-b-0">
                  <td className="px-3 py-2">
                    <span className="font-medium text-gray-900">{u.nome}</span>
                    <div className="text-xs text-gray-500">{u.email}</div>
                    {!u.ve ? <div className="text-xs text-red-700">Inativo ou sem o acesso aos cenários: não vê o cenário.</div> : null}
                  </td>
                  <td className="px-3 py-2 text-gray-700">{u.perfil ?? "—"}</td>
                  <td className="px-3 py-2 text-gray-700" title={u.soLe ? "O perfil só lê os cenários" : "Lê e edita o que o perfil permite"}>
                    {ACESSO(u.soLe)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-700">
                    {u.convidadoPor}
                    <div className="text-xs text-gray-500">em {dataHora(u.convidadoEm)}</div>
                  </td>
                  {c.podeCompartilhar ? (
                    <td className="px-3 py-2 text-right">
                      <Button type="button" variant="outline" size="sm" className="rounded-sm border-red-300 text-red-700 hover:bg-red-50" onClick={() => setRemovendo(u)}>
                        <UserMinus className="size-4" />
                        Remover
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-gray-600">Nenhum usuário convidado: só quem criou o cenário e os Administradores o veem.</p>
      )}
      {convidando ? <ConvidarUsuariosDialog id={id} candidatos={c.candidatos} onFechar={() => setConvidando(false)} onConvidar={atualizar} /> : null}
      {removendo ? (
        <ConfirmacaoDialog
          titulo="Remover do Compartilhamento"
          descricao={`${removendo.nome} deixa de ver o cenário (enquanto ele for particular).`}
          acao="Remover"
          acaoPendente="Removendo…"
          pendente={remover.isPending}
          onConfirmar={() => remover.mutate(removendo)}
          onFechar={() => setRemovendo(null)}
        >
          <Erro erro={remover.isError ? mensagemDeErro(remover.error, "Não foi possível remover o usuário.") : null} />
        </ConfirmacaoDialog>
      ) : null}
    </div>
  );
}

/** O modal Convidar Usuários (21/11/2026): os usuários que podem ver o cenário, com a busca; os marcados passam a vê-lo. */
function ConvidarUsuariosDialog({
  id,
  candidatos,
  onFechar,
  onConvidar,
}: {
  id: string;
  candidatos: UsuarioDoCompartilhamento[];
  onFechar: () => void;
  onConvidar: (c: CompartilhamentoDoCenario) => void;
}) {
  const [busca, setBusca] = useState("");
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const visiveis = useMemo(() => {
    const b = normal(busca.trim());
    return b ? candidatos.filter((u) => normal(`${u.nome} ${u.email} ${u.perfil ?? ""}`).includes(b)) : candidatos;
  }, [busca, candidatos]);
  const convidar = useMutation({
    mutationFn: () => cenariosService.compartilhar(id, [...marcados]),
    onSuccess: (c) => {
      onConvidar(c);
      toast.success(`${marcados.size === 1 ? "1 usuário convidado" : `${marcados.size} usuários convidados`}: já veem o cenário.`);
      onFechar();
    },
  });
  const alternar = (u: string) =>
    setMarcados((s) => {
      const n = new Set(s);
      if (n.has(u)) n.delete(u);
      else n.add(u);
      return n;
    });
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="flex max-h-[85vh] flex-col rounded-sm sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Convidar Usuários para Ver o Cenário</DialogTitle>
          <DialogDescription>
            Marque os usuários que vão ver o cenário. A lista traz os usuários ativos com o acesso aos cenários (os Administradores já veem todos); cada
            um usa as telas pelo seu perfil — Só Leitura: o perfil só lê os cenários.
          </DialogDescription>
        </DialogHeader>
        <div className="relative shrink-0">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-gray-400" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pelo nome, e-mail ou perfil" aria-label="Buscar usuário" className="rounded-sm pl-8" />
        </div>
        <ul className="min-h-0 flex-1 divide-y divide-gray-100 overflow-y-auto rounded-sm border border-gray-200">
          {visiveis.map((u) => (
            <li key={u.id}>
              <label className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm ${marcados.has(u.id) ? "bg-yellow-50" : "hover:bg-gray-50"}`}>
                <input type="checkbox" className="size-4 accent-black" checked={marcados.has(u.id)} onChange={() => alternar(u.id)} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-gray-900">{u.nome}</span>
                  <span className="block truncate text-xs text-gray-500">{u.email}</span>
                </span>
                <span className="shrink-0 text-right text-xs text-gray-600">
                  {u.perfil}
                  {u.soLe ? <span className="block text-gray-500">Só Leitura</span> : null}
                </span>
              </label>
            </li>
          ))}
          {!visiveis.length ? <li className="px-3 py-3 text-sm text-gray-500">Nenhum usuário encontrado.</li> : null}
        </ul>
        <Erro erro={convidar.isError ? mensagemDeErro(convidar.error, "Não foi possível convidar os usuários.") : null} />
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={!marcados.size || convidar.isPending} onClick={() => convidar.mutate()}>
            {convidar.isPending ? "Convidando…" : marcados.size ? `Convidar (${marcados.size})` : "Convidar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
