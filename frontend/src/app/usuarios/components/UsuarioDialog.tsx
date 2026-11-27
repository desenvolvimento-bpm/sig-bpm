"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CampoSenha } from "@/components/shared/CampoSenha";
import { useAuth } from "@/context/AuthContext";
import { Label } from "@/components/ui/label";
import type { DepartamentoAcesso } from "@/services/authService";

import { classeSelect, mensagemDeErro, usuariosService, type OpcoesUsuarios, type Usuario } from "../services/usuariosService";

const SEM_AGRUPAMENTO = "Sem Agrupamento";

type Props = { opcoes: OpcoesUsuarios; editando: Usuario | null; onFechar: () => void };

/**
 * Cadastro e edição de um usuário: perfil, situação, setores, departamentos (Gestor) e, no recorte por centro de custo
 * (Coordenador, 11/10/2026), a gestão e os centros dela que o usuário alcança.
 */
export function UsuarioDialog({ opcoes, editando, onFechar }: Props) {
  const queryClient = useQueryClient();
  const { user: eu, refresh } = useAuth();
  const souAdministrador = eu?.perfil.codigo === "ADMINISTRADOR";
  const [nome, setNome] = useState(editando?.nome ?? "");
  const [email, setEmail] = useState(editando?.email ?? "");
  const [perfilId, setPerfilId] = useState(editando?.perfil.id ?? opcoes.perfis.find((p) => p.ativo)?.id ?? "");
  const [ativo, setAtivo] = useState(editando?.ativo ?? true);
  const [setores, setSetores] = useState<string[]>(editando?.setores ?? []);
  const [departamentos, setDepartamentos] = useState<DepartamentoAcesso[]>(editando?.departamentos ?? []);
  const [gestao, setGestao] = useState<DepartamentoAcesso | "">(editando?.gestao ?? "");
  const [centros, setCentros] = useState<string[]>(editando?.centros ?? []);
  const [senha, setSenha] = useState("");
  const perfil = opcoes.perfis.find((p) => p.id === perfilId);

  const salvar = useMutation({
    mutationFn: () => {
      // Sem o recorte por centro de custo no perfil, a gestão e os centros não valem: vão vazios.
      const doCoordenador = !!perfil?.recorteCentro;
      const d = { nome, email, perfilId, ativo, setores, departamentos, gestao: doCoordenador ? gestao || null : null, centros: doCoordenador ? centros : [] };
      return editando ? usuariosService.atualizar(editando.id, d) : usuariosService.criar({ ...d, senha });
    },
    onSuccess: () => {
      toast.success(editando ? "Usuário atualizado." : "Usuário criado.");
      queryClient.invalidateQueries({ queryKey: ["usuarios"] });
      // O próprio cadastro: o nome e o e-mail do topo da tela (e os recortes) vêm de novo do servidor (12/10/2026).
      if (editando && editando.id === eu?.id) void refresh();
      onFechar();
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível salvar o usuário.")),
  });
  const alternar = <T,>(lista: T[], item: T) => (lista.includes(item) ? lista.filter((x) => x !== item) : [...lista, item]);
  const podeSalvar = nome.trim().length >= 2 && email.includes("@") && perfilId && (editando || senha.length >= 8);
  // Os centros ativos da gestão escolhida.
  const daGestao = opcoes.centros.filter((c) => c.gestao === gestao);
  const todosMarcados = daGestao.length > 0 && daGestao.every((c) => centros.includes(c.id));
  // Os centros da gestão pelo agrupamento da controladoria (o do cadastro de centros), em ordem de nome; os sem
  // agrupamento no fim (11/10/2026).
  const agrupados = [...Map.groupBy(daGestao, (c) => c.agrupamento?.trim() || SEM_AGRUPAMENTO)].sort(
    ([a], [b]) => Number(a === SEM_AGRUPAMENTO) - Number(b === SEM_AGRUPAMENTO) || a.localeCompare(b, "pt-BR"),
  );
  // Marca ou desmarca todos os centros de um agrupamento.
  const alternarAgrupamento = (doGrupo: string[], marcar: boolean) =>
    setCentros(marcar ? [...new Set([...centros, ...doGrupo])] : centros.filter((id) => !doGrupo.includes(id)));

  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="max-h-[90vh] overflow-y-auto rounded-sm sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editando ? "Editar Usuário" : "Novo Usuário"}</DialogTitle>
          <DialogDescription>O que o usuário pode fazer vem do perfil. Setores, departamentos e centros de custo só valem se o perfil recorta por eles.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="u-nome">Nome</Label>
              <Input id="u-nome" value={nome} onChange={(e) => setNome(e.target.value)} className="rounded-sm" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-email">E-mail corporativo</Label>
              <Input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="rounded-sm" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-perfil">Perfil</Label>
              <select id="u-perfil" value={perfilId} onChange={(e) => setPerfilId(e.target.value)} className={classeSelect}>
                {opcoes.perfis.map((p) => {
                  // Só um Administrador promove outro usuário a Administrador (14/10/2026).
                  const soAdministrador = p.codigo === "ADMINISTRADOR" && !souAdministrador && editando?.perfil.id !== p.id;
                  return (
                    <option key={p.id} value={p.id} disabled={!p.ativo || soAdministrador}>
                      {p.nome}
                      {!p.ativo ? " (inativo)" : soAdministrador ? " (só um Administrador promove)" : ""}
                    </option>
                  );
                })}
              </select>
            </div>
            {!editando ? (
              <div className="space-y-1.5">
                <Label htmlFor="u-senha">Senha inicial</Label>
                <CampoSenha id="u-senha" value={senha} onChange={(e) => setSenha(e.target.value)} className="rounded-sm" placeholder="ao menos 8 caracteres" />
              </div>
            ) : (
              <label className="flex items-center gap-2 self-end pb-2 text-sm text-gray-900">
                <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} className="size-4 accent-black" />
                Ativo (pode entrar no sistema)
              </label>
            )}
          </div>

          {perfil?.recorteSetor ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-gray-900">Setores<span className="font-normal text-gray-500">: listas que pode digitar e importar</span></legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {opcoes.setores.map((s) => (
                  <label key={s.tipo} className="flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={setores.includes(s.tipo)} onChange={() => setSetores(alternar(setores, s.tipo))} className="size-4 accent-black" />
                    {s.rotulo}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          {perfil?.recorteDepartamento ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-gray-900">Departamentos<span className="font-normal text-gray-500">: movimentações e centros de custo que pode consultar</span></legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {opcoes.departamentos.map((d) => (
                  <label key={d.departamento} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={departamentos.includes(d.departamento)}
                      onChange={() => setDepartamentos(alternar(departamentos, d.departamento))}
                      className="size-4 accent-black"
                    />
                    {d.rotulo}
                  </label>
                ))}
              </div>
              <p className="text-xs text-gray-500">A DRE é inteira para todos; sem departamento marcado, o usuário não vê movimentações nem centros de custo.</p>
            </fieldset>
          ) : null}
          {perfil?.recorteCentro ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-gray-900">
                Centros de Custo<span className="font-normal text-gray-500">: os que o usuário alcança, da gestão dele</span>
              </legend>
              <div className="space-y-1.5">
                <Label htmlFor="u-gestao">Gestão</Label>
                <select
                  id="u-gestao"
                  value={gestao}
                  onChange={(e) => {
                    // Trocar a gestão limpa os centros: eles são da gestão.
                    setGestao(e.target.value as DepartamentoAcesso | "");
                    setCentros([]);
                  }}
                  className={classeSelect}
                >
                  <option value="">Escolha a gestão do usuário</option>
                  {opcoes.gestoes.map((g) => (
                    <option key={g.gestao} value={g.gestao}>
                      {g.rotulo}
                    </option>
                  ))}
                </select>
              </div>
              {gestao ? (
                <div className="rounded-sm border border-gray-200">
                  <label className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-1.5 text-sm font-medium text-gray-900">
                    <input
                      type="checkbox"
                      checked={todosMarcados}
                      onChange={() => setCentros(todosMarcados ? [] : daGestao.map((c) => c.id))}
                      className="size-4 accent-black"
                    />
                    Todos os Centros da Gestão
                    <span className="ml-auto text-xs font-normal text-gray-500">
                      {centros.length} de {daGestao.length}
                    </span>
                  </label>
                  <div className="max-h-72 overflow-y-auto py-1">
                    {agrupados.map(([agrupamento, doGrupo]) => {
                      const ids = doGrupo.map((c) => c.id);
                      const marcados = ids.filter((id) => centros.includes(id)).length;
                      return (
                        <div key={agrupamento} className="py-0.5">
                          {/* O agrupamento: a caixa marca ou desmarca todos os centros dele (traço quando só alguns). */}
                          <label className="flex items-center gap-2 px-3 py-1 text-xs font-bold tracking-wide text-gray-900 uppercase">
                            <input
                              type="checkbox"
                              checked={marcados === ids.length}
                              ref={(el) => {
                                if (el) el.indeterminate = marcados > 0 && marcados < ids.length;
                              }}
                              onChange={() => alternarAgrupamento(ids, marcados < ids.length)}
                              className="size-4 shrink-0 accent-black"
                            />
                            {agrupamento}
                            <span className="ml-auto font-normal tracking-normal text-gray-500 normal-case">
                              {marcados} de {ids.length}
                            </span>
                          </label>
                          {doGrupo.map((c) => (
                            <label key={c.id} className="flex items-start gap-2 py-0.5 pr-3 pl-9 text-sm text-gray-700">
                              <input type="checkbox" checked={centros.includes(c.id)} onChange={() => setCentros(alternar(centros, c.id))} className="mt-0.5 size-4 shrink-0 accent-black" />
                              <span>{c.codigoRM ? `${c.codigoRM} · ` : ""}{c.nome}</span>
                            </label>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              <p className="text-xs text-gray-500">
                A DRE é inteira para todos; o usuário vê só os centros marcados na visão por centro de custo, com as movimentações deles. Sem centro marcado,
                não vê centros nem movimentações (salvo as da Receita Bruta, da Receita Líquida e dos Impostos, abertas a todos).
              </p>
            </fieldset>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!podeSalvar || salvar.isPending}
            onClick={() => salvar.mutate()}
            className="bg-bpm-primary hover:bg-bpm-primary-hover rounded-sm font-bold text-black shadow-sm"
          >
            {salvar.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
