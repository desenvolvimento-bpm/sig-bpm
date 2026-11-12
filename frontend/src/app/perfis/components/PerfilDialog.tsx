"use client";

import { Fragment, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { navGrupos } from "@/lib/navigation-config";
import { plural } from "@/lib/texto";

import { mensagemDeErro, usuariosService, type Acao, type GrupoDeTelas, type OpcoesUsuarios, type Perfil, type Permissao } from "../../usuarios/services/usuariosService";

type Props = { opcoes: OpcoesUsuarios; editando: Perfil | null; onFechar: () => void };

const ROTULO_ACAO: Record<Acao, string> = { LER: "Ler", EDITAR: "Editar" };
const NIVEL: Record<Acao, number> = { LER: 1, EDITAR: 2 };

/** As chaves de uma tela: ela e as abas dela ("tela.aba"). */
const chavesDaTela = (t: GrupoDeTelas["telas"][number]) => [t.codigo, ...t.abas.map((a) => `${t.codigo}.${a.codigo}`)];
const chavesDoGrupo = (g: GrupoDeTelas) => g.telas.flatMap(chavesDaTela);

/** Uma caixa de três estados: marcada (todas as chaves com a ação), parcial (algumas) ou vazia. */
function Caixa({ rotulo, chaves, acao, nivel, onMarcar, desabilitada }: { rotulo: string; chaves: string[]; acao: Acao; nivel: Record<string, number>; onMarcar: (marcado: boolean) => void; desabilitada: boolean }) {
  const com = chaves.filter((c) => (nivel[c] ?? 0) >= NIVEL[acao]).length;
  const todas = com === chaves.length;
  return (
    <input
      type="checkbox"
      aria-label={`${rotulo}: ${ROTULO_ACAO[acao]}`}
      checked={todas}
      ref={(el) => {
        if (el) el.indeterminate = com > 0 && !todas;
      }}
      onChange={() => onMarcar(!todas)}
      disabled={desabilitada}
      className="size-4 accent-black disabled:opacity-60"
    />
  );
}

/**
 * Tipo de usuário: nome, situação, recortes e as permissões por tela e por aba (14/10/2026; antes, por grupo de telas
 * do menu): os processos sob o título do grupo do menu (Análises Gerenciais, Criação de Cenários, Apuração dos Resultados,
 * Processos Auxiliares, Controladoria). Cada processo abre nas telas dele, e cada tela com abas nas abas; o processo com uma
 * tela só, de mesmo nome e sem abas (os Relatórios Executivos e os Painéis e Apresentações, 12/11/2026), fica numa linha.
 * A caixa do processo ou da tela marca (ou desmarca) tudo o que está abaixo; o
 * traço mostra que só parte está marcada. Marcar "Editar" marca também "Ler"; desmarcar "Ler" desmarca "Editar"; a aba
 * só vale com a tela lida (marcar a aba marca a leitura da tela) — a mesma coerência que o backend grava.
 */
export function PerfilDialog({ opcoes, editando, onFechar }: Props) {
  const queryClient = useQueryClient();
  const [codigo, setCodigo] = useState("");
  const [nome, setNome] = useState(editando?.nome ?? "");
  // O perfil Administrador (14/10/2026): acesso total e fixo; só a descrição se edita.
  const admin = editando?.codigo === "ADMINISTRADOR";
  const [descricao, setDescricao] = useState(editando?.descricao ?? "");
  const [ativo, setAtivo] = useState(editando?.ativo ?? true);
  const [recorteSetor, setRecorteSetor] = useState(editando?.recorteSetor ?? false);
  const [recorteDepartamento, setRecorteDepartamento] = useState(editando?.recorteDepartamento ?? false);
  const [recorteCentro, setRecorteCentro] = useState(editando?.recorteCentro ?? false);
  // O Acesso a Informações Sensíveis (27/10/2026): no perfil novo, desmarcado; o Administrador tem sempre.
  const [informacoesSensiveis, setInformacoesSensiveis] = useState(admin || (editando?.informacoesSensiveis ?? false));
  const [nivel, setNivel] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    for (const p of editando?.permissoes ?? []) m[p.chave] = Math.max(m[p.chave] ?? 0, NIVEL[p.acao]);
    return m;
  });
  // Os grupos e as telas abertos na matriz.
  const [abertos, setAbertos] = useState<Set<string>>(() => new Set());
  const alternar = (k: string) =>
    setAbertos((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const permissoes = (): Permissao[] =>
    Object.entries(nivel).flatMap(([chave, n]) => opcoes.acoes.filter((a) => NIVEL[a] <= n).map((acao) => ({ chave, acao })));
  const salvar = useMutation({
    mutationFn: () => {
      const d = { nome, descricao: descricao || null, ativo, recorteSetor, recorteDepartamento, recorteCentro, informacoesSensiveis, permissoes: permissoes() };
      return editando ? usuariosService.atualizarPerfil(editando.id, d) : usuariosService.criarPerfil({ ...d, codigo });
    },
    onSuccess: () => {
      toast.success(editando ? "Perfil atualizado." : "Perfil criado.");
      queryClient.invalidateQueries({ queryKey: ["perfis"] });
      queryClient.invalidateQueries({ queryKey: ["usuarios"] });
      onFechar();
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível salvar o perfil.")),
  });

  /**
   * Marca ou desmarca a ação nas chaves (a tela com as abas, o grupo inteiro…). Marcar sobe até a ação; desmarcar desce
   * abaixo dela. Uma aba marcada dá a leitura da tela; a tela sem leitura leva as abas junto.
   */
  const marcar = (chaves: string[], a: Acao, marcado: boolean) =>
    setNivel((m) => {
      const n = { ...m };
      for (const c of chaves) n[c] = marcado ? Math.max(n[c] ?? 0, NIVEL[a]) : Math.min(n[c] ?? 0, NIVEL[a] - 1);
      for (const g of opcoes.telas)
        for (const t of g.telas) {
          const abas = t.abas.map((x) => `${t.codigo}.${x.codigo}`);
          if (abas.some((c) => (n[c] ?? 0) > 0) && !(n[t.codigo] ?? 0)) {
            // A aba marcada agora marca a tela; a tela desmarcada agora tira as abas.
            if (marcado) n[t.codigo] = 1;
            else for (const c of abas) n[c] = 0;
          }
        }
      return n;
    });

  // Os processos do catálogo, sob o título do grupo do menu e com o ícone do item dele (um processo com vários itens no menu
  // aparece uma vez, com o ícone do primeiro).
  const blocos = navGrupos
    .map((s) => ({
      titulo: s.titulo,
      grupos: s.itens.flatMap((i, n) => {
        const g = opcoes.telas.find((x) => x.recurso === i.recurso);
        return g && s.itens.findIndex((o) => o.recurso === i.recurso) === n ? [{ ...g, icon: i.icon }] : [];
      }),
    }))
    .filter((b) => b.grupos.length > 0);
  const celulas = (rotulo: string, chaves: string[]) =>
    opcoes.acoes.map((a) => (
      <td key={a} className="px-3 py-1.5 text-center">
        <Caixa rotulo={rotulo} chaves={chaves} acao={a} nivel={nivel} onMarcar={(v) => marcar(chaves, a, v)} desabilitada={admin} />
      </td>
    ));
  const Seta = ({ chave, rotulo }: { chave: string; rotulo: string }) => (
    <button type="button" onClick={() => alternar(chave)} aria-label={`${abertos.has(chave) ? "Recolher" : "Expandir"} ${rotulo}`} className="rounded-sm p-0.5 text-gray-500 hover:bg-gray-100">
      {abertos.has(chave) ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
    </button>
  );
  // O processo que é uma tela só (o mesmo nome, sem abas: os Relatórios Executivos e os Painéis e Apresentações, 12/11/2026): uma linha, sem a seta.
  const umaTelaSo = (g: (typeof opcoes.telas)[number]) => g.telas.length === 1 && g.telas[0].nome === g.nome && !g.telas[0].abas.length;
  const todosAbertos = opcoes.telas.every((g) => (umaTelaSo(g) || abertos.has(g.recurso)) && g.telas.every((t) => !t.abas.length || abertos.has(t.codigo)));

  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="max-h-[90vh] overflow-y-auto rounded-sm sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{editando ? `Perfil ${editando.nome}` : "Novo Perfil"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {admin ? (
            <p className="rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-2 text-sm text-gray-700">
              O Administrador tem acesso total a todas as telas e abas, sem recortes (as telas novas entram sozinhas). Não se exclui nem se inativa, não
              fica sem usuário ativo, e só um Administrador promove outro usuário a ele. Só a descrição se edita.
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            {!editando ? (
              <div className="space-y-1.5">
                <Label htmlFor="p-codigo">Código</Label>
                <Input id="p-codigo" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="ex.: DIRETORIA" className="rounded-sm" />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="p-nome">Nome</Label>
              <Input id="p-nome" value={nome} onChange={(e) => setNome(e.target.value)} disabled={admin} className="rounded-sm" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="p-descricao">Descrição</Label>
              <Input id="p-descricao" value={descricao} onChange={(e) => setDescricao(e.target.value)} className="rounded-sm" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm text-gray-900">
              <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} disabled={admin} className="size-4 accent-black disabled:opacity-60" />
              Ativo (inativo, os usuários dele não entram)
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-900">
              <input type="checkbox" checked={recorteSetor} onChange={(e) => setRecorteSetor(e.target.checked)} disabled={admin} className="size-4 accent-black disabled:opacity-60" />
              <span>
                Recorta por Setor<span className="text-gray-500">: o usuário só alcança as listas dos setores marcados nele</span>
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-900">
              <input type="checkbox" checked={recorteDepartamento} onChange={(e) => setRecorteDepartamento(e.target.checked)} disabled={admin} className="size-4 accent-black disabled:opacity-60" />
              <span>
                Recorta por Departamento<span className="text-gray-500">: o usuário só vê as movimentações e os centros de custo dos departamentos marcados nele (Receita Bruta, Líquida e Impostos Operacionais ficam abertos para todos)</span>
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-900">
              <input type="checkbox" checked={recorteCentro} onChange={(e) => setRecorteCentro(e.target.checked)} disabled={admin} className="size-4 accent-black disabled:opacity-60" />
              <span>
                Recorta por Centro de Custo<span className="text-gray-500">: o usuário só vê as movimentações e os centros de custo marcados nele (de uma gestão)</span>
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-900">
              <input type="checkbox" checked={informacoesSensiveis} onChange={(e) => setInformacoesSensiveis(e.target.checked)} disabled={admin} className="size-4 accent-black disabled:opacity-60" />
              <span>
                Acesso a Informações Sensíveis
                <span className="text-gray-500">
                  : o usuário vê as movimentações das linhas de Mão de Obra Direta e Indireta (Remunerações CLT e PJ, Horas Extras, Multas Rescisórias,
                  Encargos e Benefícios e Pró Labore Diretoria); sem ele, vê os valores dessas linhas, mas não os extratos, os balancetes e a aba Detalhes
                  do Exportar delas
                </span>
              </span>
            </label>
          </div>
          <table className="tabela-sig w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs font-bold text-gray-900">
                <th className="px-3 py-2">
                  <span className="inline-flex items-center gap-3">
                    {/* Abre ou recolhe todos os grupos e telas (o botão no formato do de níveis da DRE). */}
                    <Button
                      type="button"
                      variant="outline"
                      aria-label={todosAbertos ? "Recolher Tudo" : "Expandir Tudo"}
                      title={todosAbertos ? "Recolher Tudo" : "Expandir Tudo"}
                      onClick={() => setAbertos(todosAbertos ? new Set() : new Set(opcoes.telas.flatMap((g) => [g.recurso, ...g.telas.filter((t) => t.abas.length).map((t) => t.codigo)])))}
                      className="size-8 shrink-0 rounded-sm border-black/30 bg-white p-0"
                    >
                      {todosAbertos ? <ChevronsDownUp className="size-4" /> : <ChevronsUpDown className="size-4" />}
                    </Button>
                    Processo, Tela e Aba
                  </span>
                </th>
                {opcoes.acoes.map((a) => (
                  <th key={a} className="w-24 px-3 py-2 text-center">
                    {ROTULO_ACAO[a]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {blocos.map((b) => (
                <Fragment key={b.titulo}>
                  <tr className="border-y border-gray-300">
                    <td colSpan={1 + opcoes.acoes.length} className="bg-yellow-50 px-3 py-1.5 text-xs font-bold tracking-wide text-gray-900 uppercase">
                      {b.titulo}
                    </td>
                  </tr>
                  {b.grupos.map((g) => (
                    <Fragment key={g.recurso}>
                      <tr className="border-b border-gray-100">
                        <td className="px-3 py-1.5 font-bold text-gray-900">
                          <span className="inline-flex items-center gap-1.5">
                            {umaTelaSo(g) ? <span className="w-5" /> : <Seta chave={g.recurso} rotulo={g.nome} />}
                            <g.icon className="size-4 text-gray-500" />
                            {g.nome}
                          </span>
                        </td>
                        {celulas(g.nome, chavesDoGrupo(g))}
                      </tr>
                      {abertos.has(g.recurso) && !umaTelaSo(g)
                        ? g.telas.map((t) => (
                            <Fragment key={t.codigo}>
                              <tr className="border-b border-gray-100">
                                <td className="py-1.5 pr-3 pl-10 text-gray-900">
                                  <span className="inline-flex items-center gap-1.5">
                                    {t.abas.length ? <Seta chave={t.codigo} rotulo={t.nome} /> : <span className="w-5" />}
                                    {t.nome}
                                    {t.abas.length ? <span className="text-xs text-gray-500">({t.abas.length} {plural(t.abas.length, "aba", "abas")})</span> : null}
                                  </span>
                                </td>
                                {celulas(t.nome, chavesDaTela(t))}
                              </tr>
                              {abertos.has(t.codigo)
                                ? t.abas.map((a) => (
                                    <tr key={a.codigo} className="border-b border-gray-100">
                                      <td className="py-1 pr-3 pl-24 text-gray-700">Aba {a.nome}</td>
                                      {celulas(`${t.nome} · ${a.nome}`, [`${t.codigo}.${a.codigo}`])}
                                    </tr>
                                  ))
                                : null}
                            </Fragment>
                          ))
                        : null}
                    </Fragment>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
          <ul className="list-disc space-y-1 pl-5 text-xs text-gray-500">
            <li>Ler: a tela aparece no menu (ou nas etapas do mês) e mostra os dados; na aba, a aba aparece.</li>
            <li>
              Editar: pode alterar (importar, apurar, fechar, editar cadastros…) — na tela, o que é comum a ela; na aba, o que se faz dentro dela. Os
              recortes valem por cima: com recorte por departamento (ou por centro de custo), o Fechamento Mensal não mostra Classificação,
              Lançamentos, Prévias › Receita, Totais › Rateios, Prévias › Estoque e Conferência, nem o Controle de Usuários mostra a Auditoria (essas telas e abas mostram lançamentos de
              todos os departamentos); com recorte por setor, o Fechamento Mensal mostra só Competências, Importações e Listas.
            </li>
          </ul>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={nome.trim().length < 2 || (!editando && codigo.trim().length < 2) || salvar.isPending}
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
