"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmacaoDialog } from "@/components/shared/ConfirmacaoDialog";
import { type ColunaExportavel, ExportarTabela } from "@/components/shared/ExportarTabela";
import { SemResultado, useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Coluna } from "@/lib/filtrosDeTabela";
import { plural } from "@/lib/texto";

import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";
import { RedistribuicaoDialog, type ServicoDaRedistribuicao } from "@/app/cadastros/redistribuicoes-gastos/RedistribuicaoDialog";
import { vigenciaTexto } from "@/app/cadastros/services/redistribuicoesService";

import {
  cenariosService,
  type CentroDoCadastroDoCenario,
  type CentrosDoCadastroDoCenario,
  type DadosDoCentroDoCenario,
  type DepartamentoDoCenario,
  type DepartamentosDoCenario,
  type RedistribuicaoDoCenario,
  type TrazidosDosCadastros,
  type UnidadesDoCenario,
} from "../services/cenariosService";
import { botaoPrimario, classeSelect, Erro } from "./CenarioDialog";
import { Destaque, LinhaVazia, TabelaComDestaque, TD } from "./DestaqueDaAba";

/**
 * As abas Unidades, Departamentos, Centros de Custo e Redistribuições de Gastos das Configurações dos cenários analíticos
 * (20/11/2026, pedido do Adão: Cadastros por cenário, etapas 1 e 2): as cópias dos cadastros de Cadastros Gerais com que o cenário
 * calcula — o resto do SIG segue os originais. A cópia é tirada na criação do cenário (a revisão leva a do cenário de origem) e não
 * muda sozinha: "Trazer Novos" inclui o que surgiu depois nos Cadastros Gerais, sem mexer no que foi editado aqui.
 */

const Carregando = () => <div className="h-64 animate-pulse rounded-sm bg-gray-100" />;
/**
 * O "Trazer Novos dos Cadastros Gerais", com a confirmação (as quatro abas): o botão vai no destaque (que aparece duas vezes, no
 * lugar e flutuando) e a confirmação fica na aba, uma só.
 */
function useTrazerNovos(id: string) {
  const queryClient = useQueryClient();
  const [confirmando, setConfirmando] = useState(false);
  const trazer = useMutation({
    mutationFn: () => cenariosService.trazerNovosDosCadastrosDoCenario(id),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["cenarios"] });
      setConfirmando(false);
      const partes = textoDosTrazidos(r);
      toast.success(partes ? `Trazidos dos Cadastros Gerais: ${partes}.` : "Nada novo nos Cadastros Gerais: o cenário já tem as unidades, os departamentos, os centros de custo e as redistribuições de lá.");
    },
  });
  const botao = (
    <Button type="button" variant="outline" className="rounded-sm" onClick={() => (trazer.reset(), setConfirmando(true))}>
      <Download className="size-4" />
      Trazer Novos
    </Button>
  );
  const dialogo = confirmando ? (
    <ConfirmacaoDialog
      titulo="Trazer Novos dos Cadastros Gerais"
      descricao="Inclui no cenário as unidades, os departamentos, os centros de custo e as redistribuições de gastos dos Cadastros Gerais que surgiram depois da cópia (os que o cenário não tem). O que foi editado aqui fica como está; com centros novos, a DRE do cenário é recalculada."
      acao="Trazer Novos"
      acaoPendente="Trazendo…"
      pendente={trazer.isPending}
      destrutiva={false}
      onConfirmar={() => trazer.mutate()}
      onFechar={() => (trazer.isPending ? undefined : setConfirmando(false))}
    >
      <Erro erro={trazer.isError ? mensagemDeErro(trazer.error, "Não foi possível trazer os novos.") : null} />
    </ConfirmacaoDialog>
  ) : null;
  return { botao, dialogo };
}

/** "2 unidades, 1 departamento e 3 centros de custo": o que o Trazer Novos trouxe. */
function textoDosTrazidos(r: TrazidosDosCadastros) {
  const partes = [
    r.unidades.length ? `${r.unidades.length} ${plural(r.unidades.length, "unidade", "unidades")}` : "",
    r.departamentos.length ? `${r.departamentos.length} ${plural(r.departamentos.length, "departamento", "departamentos")}` : "",
    r.centros.length ? `${r.centros.length} ${plural(r.centros.length, "centro de custo", "centros de custo")}` : "",
    r.redistribuicoes.length ? `${r.redistribuicoes.length} ${plural(r.redistribuicoes.length, "redistribuição de gastos", "redistribuições de gastos")}` : "",
  ].filter(Boolean);
  return partes.length > 1 ? `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}` : (partes[0] ?? "");
}

// ------------------------------------------------------------------------------------------------------------------- Unidades
type UnidadeDoCenario = UnidadesDoCenario["unidades"][number];

/** As colunas das quatro abas (20/11/2026, pedido do Adão): os filtros padrão nos rótulos, como nas outras tabelas do SIG; e as larguras. */
const COLUNAS_DAS_UNIDADES: Coluna<UnidadeDoCenario>[] = [
  { chave: "codigo", rotulo: "Código", tipo: "numero", valor: (u) => u.codigo },
  { chave: "nome", rotulo: "Nome no Cenário", valor: (u) => u.nome },
  { chave: "cadastros", rotulo: "Nome nos Cadastros Gerais", valor: (u) => u.nomeNosCadastros },
  { chave: "ordem", rotulo: "Ordem", tipo: "numero", alinhamento: "direita", valor: (u) => u.ordem },
  { chave: "ativo", rotulo: "Ativa", valor: (u) => (u.ativo ? "Sim" : "Não") },
];
const LARGURAS_DAS_UNIDADES = [90, 320, 320, 90, 90];

/** A aba Unidades: a cópia das unidades do cenário (o nome, a ordem e a situação valem só nele). */
export function UnidadesDoCenarioAba({ id, podeEditar }: { id: string; podeEditar: boolean }) {
  const consulta = useQuery({ queryKey: ["cenarios", id, "cadastros", "unidades"], queryFn: () => cenariosService.unidadesDoCenario(id) });
  const [aberta, setAberta] = useState<UnidadeDoCenario | null>(null);
  const trazerNovos = useTrazerNovos(id);
  const tabela = useTabelaFiltravel(consulta.data?.unidades, COLUNAS_DAS_UNIDADES);
  if (consulta.isError) return <Erro erro={mensagemDeErro(consulta.error, "Erro ao carregar as unidades do cenário.")} />;
  if (consulta.isPending) return <Carregando />;
  const dados = consulta.data;
  const pode = podeEditar && dados.editavel;
  const destaque = (
    <Destaque titulo="Unidades" descricao="A cópia das unidades dos Cadastros Gerais neste cenário: o nome, a ordem e a situação valem só aqui.">
      {pode ? trazerNovos.botao : null}
      <ExportarTabela titulo="Cenário · Configurações · Unidades" colunas={COLUNAS_DAS_UNIDADES} linhas={tabela.filtradas} />
    </Destaque>
  );
  return (
    <>
      <TabelaComDestaque
        destaque={destaque}
        larguras={LARGURAS_DAS_UNIDADES}
        cabecalho={tabela.linhaDoCabecalho}
        corpo={tabela.visiveis.length === 0 ? <SemResultado colunas={COLUNAS_DAS_UNIDADES.length} onLimpar={tabela.limpar} /> : tabela.visiveis.map((u) => (
          <tr
            key={u.id}
            className={`border-t border-gray-100 ${pode ? "cursor-pointer hover:bg-gray-100" : ""} ${u.ativo ? "" : "text-gray-400"}`}
            onClick={pode ? () => setAberta(u) : undefined}
            title={pode ? "Editar a unidade no cenário" : undefined}
          >
            <td className={TD}>{u.codigo}</td>
            <td className={`${TD} font-medium text-gray-900`} title={u.nome}>
              {u.nome}
            </td>
            <td className={`${TD} text-gray-600`}>{u.nomeNosCadastros}</td>
            <td className={`${TD} text-right`}>{u.ordem}</td>
            <td className={TD}>{u.ativo ? "Sim" : "Não"}</td>
          </tr>
        ))}
      />
      {trazerNovos.dialogo}
      {aberta ? <UnidadeDialog id={id} unidade={aberta} onFechar={() => setAberta(null)} /> : null}
    </>
  );
}

function UnidadeDialog({ id, unidade, onFechar }: { id: string; unidade: UnidadeDoCenario; onFechar: () => void }) {
  const queryClient = useQueryClient();
  const [nome, setNome] = useState(unidade.nome);
  const [ordem, setOrdem] = useState(String(unidade.ordem));
  const [ativo, setAtivo] = useState(unidade.ativo);
  const ordemValida = /^\d{1,4}$/.test(ordem.trim());
  const gravar = useMutation({
    mutationFn: () => cenariosService.gravarUnidadeDoCenario(id, unidade.id, { nome: nome.trim(), ordem: Number(ordem.trim()), ativo }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cenarios", id] });
      toast.success("Unidade gravada no cenário.");
      onFechar();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="rounded-sm sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar Unidade do Cenário</DialogTitle>
          <DialogDescription>
            {unidade.codigo} · {unidade.nomeNosCadastros} nos Cadastros Gerais. A mudança vale só neste cenário.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="un-nome">Nome no Cenário</Label>
            <Input id="un-nome" value={nome} onChange={(e) => setNome(e.target.value)} className="rounded-sm" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="un-ordem">Ordem</Label>
            <Input id="un-ordem" value={ordem} onChange={(e) => setOrdem(e.target.value)} inputMode="numeric" className={`rounded-sm text-right ${ordemValida ? "" : "border-red-400"}`} />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" className="accent-black" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
            Ativa (a unidade aparece nas listas do Quadro de Lotação do cenário)
          </label>
        </div>
        <Erro erro={gravar.isError ? mensagemDeErro(gravar.error, "Não foi possível gravar a unidade.") : null} />
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={!nome.trim() || !ordemValida || gravar.isPending} onClick={() => gravar.mutate()}>
            {gravar.isPending ? "Gravando…" : "Gravar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------------------------ Centros de Custo
/** O grupo que fica sem centros, numa recusa de gravar ou excluir (a confirmação). */
const grupoSemCentrosDe = (erro: unknown) => (erro as { response?: { data?: { grupoSemCentros?: string } } } | null)?.response?.data?.grupoSemCentros ?? null;
const rotuloDoCentro = (c: Pick<CentroDoCadastroDoCenario, "codigoRM" | "nomeRM">) => `${c.codigoRM ? `${c.codigoRM} - ` : ""}${c.nomeRM}`;

/**
 * A aba Centros de Custo: a cópia dos centros do cenário, com o grupo de cada um (o Nome da Controladoria; os de estoque e de
 * investimento ficam fora do cenário). Incluir, alterar, excluir e renomear um grupo recalculam a DRE do cenário.
 */
export function CentrosDoCadastroDoCenarioAba({ id, podeEditar }: { id: string; podeEditar: boolean }) {
  const consulta = useQuery({ queryKey: ["cenarios", id, "cadastros", "centros"], queryFn: () => cenariosService.centrosDoCadastroDoCenario(id) });
  const [aberto, setAberto] = useState<CentroDoCadastroDoCenario | "novo" | null>(null);
  const [renomeando, setRenomeando] = useState(false);
  const trazerNovos = useTrazerNovos(id);
  // Os filtros padrão nos rótulos das colunas (20/11/2026, pedido do Adão), no lugar da busca e do Apenas Ativos.
  const tabela = useTabelaFiltravel(consulta.data?.centros, COLUNAS_DOS_CENTROS);
  if (consulta.isError) return <Erro erro={mensagemDeErro(consulta.error, "Erro ao carregar os centros de custo do cenário.")} />;
  if (consulta.isPending) return <Carregando />;
  const dados = consulta.data;
  const pode = podeEditar && dados.editavel;
  const visiveis = tabela.visiveis;
  const grupos = [...new Set(dados.centros.filter((c) => c.ativo && c.grupo).map((c) => c.grupo!))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const destaque = (
    <Destaque
      titulo="Centros de Custo"
      descricao="A cópia dos centros de custo neste cenário. Cada mudança recalcula a DRE do cenário."
      abaixo={
        <span className="text-xs text-gray-500">
          {tabela.total} de {dados.centros.length} {plural(dados.centros.length, "centro", "centros")} · {grupos.length} {plural(grupos.length, "grupo", "grupos")} no cenário
        </span>
      }
    >
      {pode ? (
        <>
          {trazerNovos.botao}
          <Button type="button" variant="outline" className="rounded-sm" disabled={!grupos.length} onClick={() => setRenomeando(true)}>
            <Pencil className="size-4" />
            Renomear Grupo
          </Button>
          <Button type="button" className={botaoPrimario} onClick={() => setAberto("novo")}>
            <Plus className="size-4" />
            Novo Centro
          </Button>
        </>
      ) : null}
      <ExportarTabela titulo="Cenário · Configurações · Centros de Custo" colunas={COLUNAS_DOS_CENTROS} linhas={tabela.filtradas} />
    </Destaque>
  );
  return (
    <>
      <TabelaComDestaque
        destaque={destaque}
        larguras={LARGURAS_DOS_CENTROS}
        cabecalho={tabela.linhaDoCabecalho}
        corpo={
          visiveis.length === 0 ? (
            dados.centros.length ? (
              <SemResultado colunas={COLUNAS_DOS_CENTROS.length} onLimpar={tabela.limpar} />
            ) : (
              <LinhaVazia colunas={COLUNAS_DOS_CENTROS.length} texto="Nenhum centro de custo no cenário." />
            )
          ) : (
            visiveis.map((c) => (
              <tr
                key={c.id}
                className={`border-t border-gray-100 ${pode ? "cursor-pointer hover:bg-gray-100" : ""} ${c.ativo ? "" : "text-gray-400"}`}
                onClick={pode ? () => setAberto(c) : undefined}
                title={pode ? "Editar o centro de custo no cenário" : undefined}
              >
                <td className={`${TD} font-medium`}>{c.codigoRM ?? <span className="text-gray-400">sem código</span>}</td>
                <td className={TD} title={c.nomeRM}>
                  {c.nomeRM}
                </td>
                <td className={TD} title={c.grupo ?? "Os centros de estoque e de investimento ficam fora do cenário"}>
                  {c.grupo ?? <span className="text-gray-400">Fora do cenário</span>}
                </td>
                <td className={TD} title={c.departamento ?? undefined}>
                  {c.departamento ?? "—"}
                </td>
                <td className={TD}>{c.atribuicao ?? "—"}</td>
                <td className={TD}>{c.balde ?? "—"}</td>
                <td className={TD} title={c.unidade ?? undefined}>
                  {c.unidade ?? "—"}
                </td>
                <td className={TD}>{c.ativo ? "Sim" : "Não"}</td>
                <td className={TD}>{c.doCenario ? "Só no cenário" : "Cadastros Gerais"}</td>
                <td className={`${TD} text-right`}>{c.linhasDoQuadro || "—"}</td>
              </tr>
            ))
          )
        }
      />
      {trazerNovos.dialogo}
      {aberto ? <CentroDialog id={id} dados={dados} centro={aberto === "novo" ? null : aberto} onFechar={() => setAberto(null)} /> : null}
      {renomeando ? <RenomearGrupoDialog id={id} grupos={grupos} onFechar={() => setRenomeando(false)} /> : null}
    </>
  );
}

// A situação (Ativo) virou coluna (20/11/2026), para o filtro dela substituir o Apenas Ativos.
const COLUNAS_DOS_CENTROS: Coluna<CentroDoCadastroDoCenario>[] = [
  { chave: "codigo", rotulo: "Código RM", valor: (c) => c.codigoRM },
  { chave: "nome", rotulo: "Nome no RM", valor: (c) => c.nomeRM },
  { chave: "grupo", rotulo: "Grupo no Cenário", valor: (c) => c.grupo ?? "Fora do cenário" },
  { chave: "departamento", rotulo: "Departamento", valor: (c) => c.departamento },
  { chave: "atribuicao", rotulo: "Atribuição", valor: (c) => c.atribuicao },
  { chave: "balde", rotulo: "Rateio", valor: (c) => c.balde },
  { chave: "unidade", rotulo: "Unidade Dedicada", valor: (c) => c.unidade },
  { chave: "ativo", rotulo: "Ativo", valor: (c) => (c.ativo ? "Sim" : "Não") },
  { chave: "origem", rotulo: "Origem", valor: (c) => (c.doCenario ? "Só no cenário" : "Cadastros Gerais") },
  { chave: "quadro", rotulo: "Linhas do Quadro", tipo: "numero", alinhamento: "direita", valor: (c) => c.linhasDoQuadro },
];
const LARGURAS_DOS_CENTROS = [130, 220, 220, 260, 110, 110, 160, 90, 140, 150];

/** O formulário de um centro da cópia (novo ou existente, com Excluir), com a confirmação do grupo que fica sem centros. */
function CentroDialog({ id, dados, centro, onFechar }: { id: string; dados: CentrosDoCadastroDoCenario; centro: CentroDoCadastroDoCenario | null; onFechar: () => void }) {
  const queryClient = useQueryClient();
  const [codigoRM, setCodigoRM] = useState(centro?.codigoRM ?? "");
  const [coligada, setColigada] = useState(centro?.coligada === null || centro?.coligada === undefined ? "" : String(centro.coligada));
  const [nomeRM, setNomeRM] = useState(centro?.nomeRM ?? "");
  const [controladoria, setControladoria] = useState(centro?.nomeControladoria ?? "");
  const [departamento, setDepartamento] = useState(centro?.departamento ?? "");
  const [atribuicao, setAtribuicao] = useState<"" | "DIRETA" | "INDIRETA">(centro?.atribuicao ?? "");
  const [balde, setBalde] = useState(centro?.balde ?? "");
  const [unidade, setUnidade] = useState(centro?.unidadeNegocioId ?? "");
  const [ativo, setAtivo] = useState(centro?.ativo ?? true);
  const [confirmar, setConfirmar] = useState<{ acao: "gravar" | "excluir"; grupo: string } | null>(null);
  const [excluir, setExcluir] = useState(false);
  const coligadaValida = coligada.trim() === "" || /^\d{1,4}$/.test(coligada.trim());
  const valores = (): DadosDoCentroDoCenario => ({
    codigoRM: codigoRM.trim() || null,
    coligada: coligada.trim() ? Number(coligada.trim()) : null,
    nomeRM: nomeRM.trim(),
    nomeControladoria: controladoria.trim() || null,
    departamento: departamento || null,
    atribuicao: atribuicao || null,
    balde: balde || null,
    unidadeNegocioId: unidade || null,
    ativo,
  });
  const concluir = (mensagem: string) => {
    queryClient.invalidateQueries({ queryKey: ["cenarios"] });
    queryClient.invalidateQueries({ queryKey: ["relatorios"] });
    toast.success(mensagem);
    onFechar();
  };
  const gravar = useMutation({
    mutationFn: (confirmado: boolean) => cenariosService.gravarCentroDoCadastroDoCenario(id, centro?.id ?? null, valores(), confirmado),
    onSuccess: () => concluir(centro ? "Centro de custo alterado no cenário; a DRE do cenário foi recalculada." : "Centro de custo incluído no cenário; a DRE do cenário foi recalculada."),
    onError: (e) => {
      const grupo = grupoSemCentrosDe(e);
      if (grupo) setConfirmar({ acao: "gravar", grupo });
    },
  });
  const apagar = useMutation({
    mutationFn: (confirmado: boolean) => cenariosService.excluirCentroDoCadastroDoCenario(id, centro!.id, confirmado),
    onSuccess: () => concluir("Centro de custo excluído do cenário; a DRE do cenário foi recalculada."),
    onError: (e) => {
      const grupo = grupoSemCentrosDe(e);
      if (grupo) setConfirmar({ acao: "excluir", grupo });
    },
  });
  const pendente = gravar.isPending || apagar.isPending;
  const erro = (m: { isError: boolean; error: unknown }, texto: string) => (m.isError && !grupoSemCentrosDe(m.error) ? mensagemDeErro(m.error, texto) : null);
  const campo = (rotulo: string, idCampo: string, valor: string, mudar: (v: string) => void, extra?: { placeholder?: string; invalido?: boolean; ajuda?: string }) => (
    <div className="space-y-1.5">
      <Label htmlFor={idCampo}>{rotulo}</Label>
      <Input id={idCampo} value={valor} onChange={(e) => mudar(e.target.value)} placeholder={extra?.placeholder} className={`rounded-sm ${extra?.invalido ? "border-red-400" : ""}`} />
      {extra?.ajuda ? <p className="text-xs text-gray-500">{extra.ajuda}</p> : null}
    </div>
  );
  return (
    <Dialog open onOpenChange={(o) => (!o && !pendente ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="max-h-[90vh] overflow-y-auto rounded-sm sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{centro ? "Editar Centro de Custo do Cenário" : "Novo Centro de Custo do Cenário"}</DialogTitle>
          <DialogDescription>
            {centro?.doCenario === false
              ? "Copiado dos Cadastros Gerais: a mudança vale só neste cenário (o realizado do centro continua chegando a ele)."
              : "O centro vale só neste cenário (sem realizado nos Cadastros Gerais)."}{" "}
            Gravar recalcula a DRE do cenário.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {campo("Código RM", "cc-codigo", codigoRM, setCodigoRM, { placeholder: "Ex.: 1.01.00000001" })}
          {campo("Coligada", "cc-coligada", coligada, setColigada, { invalido: !coligadaValida })}
          <div className="sm:col-span-2">{campo("Nome no RM", "cc-nome", nomeRM, setNomeRM, { invalido: !nomeRM.trim() && nomeRM !== "" })}</div>
          <div className="sm:col-span-2">
            {campo("Centro de Custo (Controladoria)", "cc-controladoria", controladoria, setControladoria, {
              ajuda: "O grupo do centro no cenário (sem ele, o grupo é o nome do centro). Os valores das premissas são de cada grupo.",
            })}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="cc-departamento">Departamento</Label>
            <select id="cc-departamento" value={departamento} onChange={(e) => setDepartamento(e.target.value)} className={classeSelect}>
              <option value="">—</option>
              {dados.opcoes.departamentos.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cc-atribuicao">Atribuição</Label>
            <select id="cc-atribuicao" value={atribuicao} onChange={(e) => setAtribuicao(e.target.value as "" | "DIRETA" | "INDIRETA")} className={classeSelect}>
              <option value="">—</option>
              <option value="DIRETA">DIRETA</option>
              <option value="INDIRETA">INDIRETA</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cc-balde">Rateio</Label>
            <select id="cc-balde" value={balde} onChange={(e) => setBalde(e.target.value)} className={classeSelect}>
              <option value="">—</option>
              {dados.opcoes.baldes.map((b) => (
                <option key={b.valor} value={b.valor}>
                  {b.rotulo}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cc-unidade">Unidade Dedicada</Label>
            <select id="cc-unidade" value={unidade} onChange={(e) => setUnidade(e.target.value)} className={classeSelect}>
              <option value="">—</option>
              {dados.opcoes.unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nome}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-gray-700">
            <input type="checkbox" className="accent-black" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
            Ativo no cenário
          </label>
        </div>
        <Erro erro={erro(gravar, "Não foi possível gravar o centro de custo.") ?? erro(apagar, "Não foi possível excluir o centro de custo.")} />
        <DialogFooter>
          {centro ? (
            excluir ? (
              <span className="flex items-center gap-2 text-sm text-gray-700 sm:mr-auto">
                Excluir o centro do cenário?
                <Button type="button" variant="outline" className="rounded-sm border-red-300 text-red-700 hover:bg-red-50" disabled={pendente} onClick={() => apagar.mutate(false)}>
                  Sim, Excluir
                </Button>
              </span>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="rounded-sm border-red-300 text-red-700 hover:bg-red-50 sm:mr-auto"
                disabled={centro.linhasDoQuadro > 0}
                title={centro.linhasDoQuadro > 0 ? "O centro está no Quadro de Lotação do cenário: inative-o em vez de excluir" : undefined}
                onClick={() => setExcluir(true)}
              >
                <Trash2 className="size-4" />
                Excluir
              </Button>
            )
          ) : null}
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar} disabled={pendente}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={!nomeRM.trim() || !coligadaValida || pendente} onClick={() => gravar.mutate(false)}>
            {gravar.isPending ? "Gravando…" : "Gravar"}
          </Button>
        </DialogFooter>
        {confirmar ? (
          <ConfirmacaoDialog
            titulo={`O Grupo ${confirmar.grupo} Fica Sem Centros`}
            descricao={`Com esta mudança, o grupo ${confirmar.grupo} fica sem centros de custo no cenário: os valores dele (as premissas, os encargos, os benefícios, as justificativas e as realocações) saem do cenário. Para levar os valores a outro nome, use “Renomear Grupo”.`}
            acao={confirmar.acao === "excluir" ? "Excluir Assim Mesmo" : "Gravar Assim Mesmo"}
            acaoPendente={confirmar.acao === "excluir" ? "Excluindo…" : "Gravando…"}
            pendente={pendente}
            onConfirmar={() => (confirmar.acao === "excluir" ? apagar.mutate(true) : gravar.mutate(true))}
            onFechar={() => (pendente ? undefined : setConfirmar(null))}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Renomear Grupo: o Nome da Controladoria de todos os centros do grupo, com os valores do grupo junto (a decisão do Adão). */
function RenomearGrupoDialog({ id, grupos, onFechar }: { id: string; grupos: string[]; onFechar: () => void }) {
  const queryClient = useQueryClient();
  const [de, setDe] = useState(grupos[0] ?? "");
  const [para, setPara] = useState("");
  const renomear = useMutation({
    mutationFn: () => cenariosService.renomearGrupoDoCenario(id, de, para.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cenarios"] });
      queryClient.invalidateQueries({ queryKey: ["relatorios"] });
      toast.success(`O grupo ${de} passou a ${para.trim()}, com os valores; a DRE do cenário foi recalculada.`);
      onFechar();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => (!o && !renomear.isPending ? onFechar() : undefined)}>
      <DialogContent avisoAoSair={!!para.trim()} className="rounded-sm sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Renomear Grupo do Cenário</DialogTitle>
          <DialogDescription>
            Muda o Centro de Custo (Controladoria) de todos os centros do grupo, e os valores dele (as premissas, os encargos, os benefícios, as justificativas e as
            realocações) vão junto. Só neste cenário; o nome de um grupo que já existe não vale.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rg-de">Grupo</Label>
            <select id="rg-de" value={de} onChange={(e) => setDe(e.target.value)} className={classeSelect}>
              {grupos.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rg-para">Nome Novo</Label>
            <Input id="rg-para" value={para} onChange={(e) => setPara(e.target.value)} className="rounded-sm" />
          </div>
        </div>
        <Erro erro={renomear.isError ? mensagemDeErro(renomear.error, "Não foi possível renomear o grupo.") : null} />
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar} disabled={renomear.isPending}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={!de || !para.trim() || para.trim() === de || renomear.isPending} onClick={() => renomear.mutate()}>
            {renomear.isPending ? "Renomeando…" : "Renomear"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -------------------------------------------------------------------------------------------------------------- Departamentos
/**
 * A aba Departamentos (20/11/2026, etapa 2): a cópia dos departamentos do cenário — a unidade, o nome e os grupos da DRE de cada
 * um. Vale como o departamento das Redistribuições de Gastos do cenário.
 */
export function DepartamentosDoCenarioAba({ id, podeEditar }: { id: string; podeEditar: boolean }) {
  const consulta = useQuery({ queryKey: ["cenarios", id, "cadastros", "departamentos"], queryFn: () => cenariosService.departamentosDoCenario(id) });
  const [aberto, setAberto] = useState<DepartamentoDoCenario | "novo" | null>(null);
  const trazerNovos = useTrazerNovos(id);
  const tabela = useTabelaFiltravel(consulta.data?.departamentos, COLUNAS_DOS_DEPARTAMENTOS);
  if (consulta.isError) return <Erro erro={mensagemDeErro(consulta.error, "Erro ao carregar os departamentos do cenário.")} />;
  if (consulta.isPending) return <Carregando />;
  const dados = consulta.data;
  const pode = podeEditar && dados.editavel;
  const destaque = (
    <Destaque titulo="Departamentos" descricao="A cópia dos departamentos neste cenário: valem como o departamento das Redistribuições de Gastos dele.">
      {pode ? (
        <>
          {trazerNovos.botao}
          <Button type="button" className={botaoPrimario} onClick={() => setAberto("novo")}>
            <Plus className="size-4" />
            Novo Departamento
          </Button>
        </>
      ) : null}
      <ExportarTabela titulo="Cenário · Configurações · Departamentos" colunas={COLUNAS_DOS_DEPARTAMENTOS} linhas={tabela.filtradas} />
    </Destaque>
  );
  return (
    <>
      <TabelaComDestaque
        destaque={destaque}
        larguras={LARGURAS_DOS_DEPARTAMENTOS}
        cabecalho={tabela.linhaDoCabecalho}
        corpo={
          dados.departamentos.length === 0 ? (
            <LinhaVazia colunas={COLUNAS_DOS_DEPARTAMENTOS.length} texto="Nenhum departamento no cenário." />
          ) : tabela.visiveis.length === 0 ? (
            <SemResultado colunas={COLUNAS_DOS_DEPARTAMENTOS.length} onLimpar={tabela.limpar} />
          ) : (
            tabela.visiveis.map((d) => (
              <tr
                key={d.id}
                className={`border-t border-gray-100 ${pode ? "cursor-pointer hover:bg-gray-100" : ""} ${d.ativo ? "" : "text-gray-400"}`}
                onClick={pode ? () => setAberto(d) : undefined}
                title={pode ? "Editar o departamento no cenário" : undefined}
              >
                <td className={`${TD} text-right`}>{d.ordem}</td>
                <td className={TD}>{d.unidade}</td>
                <td className={`${TD} font-medium`}>{d.nome}</td>
                <td className="px-3 py-1.5">{d.grupos.length ? d.grupos.join(", ") : "—"}</td>
                <td className={TD}>{d.ativo ? "Sim" : "Não"}</td>
                <td className={TD}>{d.doCenario ? "Só no cenário" : "Cadastros Gerais"}</td>
                <td className={`${TD} text-right`}>{d.redistribuicoes || "—"}</td>
              </tr>
            ))
          )
        }
      />
      {trazerNovos.dialogo}
      {aberto ? <DepartamentoDialog id={id} dados={dados} departamento={aberto === "novo" ? null : aberto} onFechar={() => setAberto(null)} /> : null}
    </>
  );
}

const COLUNAS_DOS_DEPARTAMENTOS: Coluna<DepartamentoDoCenario>[] = [
  { chave: "ordem", rotulo: "Ordem", tipo: "numero", alinhamento: "direita", valor: (d) => d.ordem },
  { chave: "unidade", rotulo: "Unidade", valor: (d) => d.unidade },
  { chave: "nome", rotulo: "Departamento", valor: (d) => d.nome },
  { chave: "grupos", rotulo: "Departamentos da DRE", valor: (d) => d.grupos.join(", ") },
  { chave: "ativo", rotulo: "Ativo", valor: (d) => (d.ativo ? "Sim" : "Não") },
  { chave: "origem", rotulo: "Origem", valor: (d) => (d.doCenario ? "Só no cenário" : "Cadastros Gerais") },
  { chave: "redistribuicoes", rotulo: "Redistribuições", tipo: "numero", alinhamento: "direita", valor: (d) => d.redistribuicoes },
];
const LARGURAS_DOS_DEPARTAMENTOS = [100, 150, 180, 440, 90, 140, 150];

function DepartamentoDialog({ id, dados, departamento, onFechar }: { id: string; dados: DepartamentosDoCenario; departamento: DepartamentoDoCenario | null; onFechar: () => void }) {
  const queryClient = useQueryClient();
  const [unidade, setUnidade] = useState(departamento?.unidadeNegocioId ?? dados.opcoes.unidades[0]?.id ?? "");
  const [nome, setNome] = useState(departamento?.nome ?? "");
  const [grupos, setGrupos] = useState<Set<string>>(() => new Set(departamento?.gruposDRE ?? []));
  const [ordem, setOrdem] = useState(departamento ? String(departamento.ordem) : "");
  const [ativo, setAtivo] = useState(departamento?.ativo ?? true);
  const [excluindo, setExcluindo] = useState(false);
  const ordemValida = ordem.trim() === "" || /^\d{1,4}$/.test(ordem.trim());
  // Os grupos da DRE com linhas na unidade escolhida (os marcados de outra unidade saem ao gravar).
  const daUnidade = dados.opcoes.grupos.filter((g) => g.unidades.includes(unidade));
  const marcados = daUnidade.filter((g) => grupos.has(g.sigla)).map((g) => g.sigla);
  const concluir = (mensagem: string) => {
    queryClient.invalidateQueries({ queryKey: ["cenarios", id, "cadastros"] });
    toast.success(mensagem);
    onFechar();
  };
  const gravar = useMutation({
    mutationFn: () => cenariosService.gravarDepartamentoDoCenario(id, departamento?.id ?? null, { unidadeNegocioId: unidade, nome: nome.trim(), gruposDRE: marcados, ordem: ordem.trim() ? Number(ordem.trim()) : null, ativo }),
    onSuccess: () => concluir(departamento ? "Departamento gravado no cenário." : "Departamento incluído no cenário."),
  });
  const apagar = useMutation({ mutationFn: () => cenariosService.excluirDepartamentoDoCenario(id, departamento!.id), onSuccess: () => concluir("Departamento excluído do cenário.") });
  const pendente = gravar.isPending || apagar.isPending;
  const erro = gravar.isError ? mensagemDeErro(gravar.error, "Não foi possível gravar o departamento.") : apagar.isError ? mensagemDeErro(apagar.error, "Não foi possível excluir o departamento.") : null;
  return (
    <Dialog open onOpenChange={(o) => (!o && !pendente ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="max-h-[90vh] overflow-y-auto rounded-sm sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{departamento ? "Editar Departamento do Cenário" : "Novo Departamento do Cenário"}</DialogTitle>
          <DialogDescription>Vale só neste cenário, como o departamento das Redistribuições de Gastos dele.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
            <div className="space-y-1.5">
              <Label htmlFor="dp-unidade">Unidade</Label>
              <select id="dp-unidade" value={unidade} onChange={(e) => setUnidade(e.target.value)} className={classeSelect}>
                {dados.opcoes.unidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dp-ordem">Ordem</Label>
              <Input id="dp-ordem" value={ordem} onChange={(e) => setOrdem(e.target.value)} inputMode="numeric" placeholder="Fim" className={`rounded-sm text-right ${ordemValida ? "" : "border-red-400"}`} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dp-nome">Departamento</Label>
            <Input id="dp-nome" value={nome} onChange={(e) => setNome(e.target.value)} className="rounded-sm" />
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium text-gray-900">Departamentos da DRE</legend>
            <p className="text-xs text-gray-500">Os grupos da DRE com linhas na unidade; cada grupo fica num departamento ativo só da unidade.</p>
            {daUnidade.length === 0 ? (
              <p className="text-sm text-gray-500">Nenhum grupo da DRE com linhas nesta unidade.</p>
            ) : (
              <div className="grid gap-1 sm:grid-cols-2">
                {daUnidade.map((g) => (
                  <label key={g.sigla} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      className="accent-black"
                      checked={grupos.has(g.sigla)}
                      onChange={(e) =>
                        setGrupos((xs) => {
                          const novo = new Set(xs);
                          if (e.target.checked) novo.add(g.sigla);
                          else novo.delete(g.sigla);
                          return novo;
                        })
                      }
                    />
                    {g.nome}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" className="accent-black" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
            Ativo no cenário
          </label>
        </div>
        <Erro erro={erro} />
        <DialogFooter>
          {departamento ? (
            <Button
              type="button"
              variant="outline"
              className="rounded-sm border-red-300 text-red-700 hover:bg-red-50 sm:mr-auto"
              disabled={departamento.redistribuicoes > 0 || pendente}
              title={departamento.redistribuicoes > 0 ? "O departamento está em redistribuições do cenário: troque o departamento delas antes" : undefined}
              onClick={() => setExcluindo(true)}
            >
              <Trash2 className="size-4" />
              Excluir
            </Button>
          ) : null}
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar} disabled={pendente}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={!nome.trim() || !unidade || !ordemValida || pendente} onClick={() => gravar.mutate()}>
            {gravar.isPending ? "Gravando…" : "Gravar"}
          </Button>
        </DialogFooter>
        {excluindo && departamento ? (
          <ConfirmacaoDialog
            titulo="Excluir o Departamento do Cenário"
            descricao={`O departamento ${departamento.nome} (${departamento.unidade}) sai deste cenário; nos Cadastros Gerais, ele continua.`}
            pendente={apagar.isPending}
            onConfirmar={() => apagar.mutate(undefined, { onSettled: () => setExcluindo(false) })}
            onFechar={() => setExcluindo(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// --------------------------------------------------------------------------------------------- Redistribuições de Gastos
const pctTexto = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`;

/**
 * A aba Redistribuições de Gastos (20/11/2026, etapa 2): a cópia das redistribuições do cenário, no modal do cadastro (com o
 * departamento e os centros da cópia). Valem na carga do realizado da referência do cenário, no lugar das dos Cadastros Gerais.
 */
export function RedistribuicoesDoCenarioAba({ id, podeEditar }: { id: string; podeEditar: boolean }) {
  const consulta = useQuery({ queryKey: ["cenarios", id, "cadastros", "redistribuicoes"], queryFn: () => cenariosService.redistribuicoesDoCenario(id) });
  // undefined: fechado; null: nova; a redistribuição: abrindo.
  const [aberta, setAberta] = useState<RedistribuicaoDoCenario | null | undefined>(undefined);
  const trazerNovos = useTrazerNovos(id);
  const fonte = useMemo<ServicoDaRedistribuicao>(
    () => ({
      chave: ["cenarios", id, "cadastros", "redistribuicoes", "fornecedores"],
      fornecedores: (departamentoId, linhaDREId) => cenariosService.fornecedoresDaRedistribuicaoDoCenario(id, departamentoId, linhaDREId),
      gravar: async (rid, d) => {
        await cenariosService.gravarRedistribuicaoDoCenario(id, rid, d);
        return "Vale na próxima carga do realizado (aba Referência).";
      },
      excluir: async (rid) => {
        await cenariosService.excluirRedistribuicaoDoCenario(id, rid);
        return "A próxima carga do realizado fica sem ela.";
      },
      aoConcluir: (queryClient) => queryClient.invalidateQueries({ queryKey: ["cenarios", id, "cadastros"] }),
      descricao:
        "Na carga do realizado da referência deste cenário, os movimentos dos fornecedores marcados, na Conta da DRE (e no departamento), vão divididos entre os centros de custo de Redistribuir Para (os do cenário), pelos percentuais, nos meses da vigência. Vale só aqui: o resto do SIG segue as redistribuições dos Cadastros Gerais.",
      descricaoDaExclusao: (conta) => `A redistribuição de ${conta} sai deste cenário (nos Cadastros Gerais, as redistribuições continuam); a próxima carga do realizado da referência fica sem ela.`,
    }),
    [id],
  );
  const tabela = useTabelaFiltravel(consulta.data?.redistribuicoes, COLUNAS_DAS_REDISTRIBUICOES);
  if (consulta.isError) return <Erro erro={mensagemDeErro(consulta.error, "Erro ao carregar as redistribuições do cenário.")} />;
  if (consulta.isPending) return <Carregando />;
  const dados = consulta.data;
  const pode = podeEditar && dados.editavel;
  // O arquivo leva os nomes dos fornecedores (na tela, a quantidade).
  const colunas: ColunaExportavel<RedistribuicaoDoCenario>[] = [
    { chave: "departamento", rotulo: "Departamento da DRE", valor: (r) => r.departamento ?? "Todos" },
    { chave: "conta", rotulo: "Conta da DRE", valor: (r) => r.conta.rotulo },
    { chave: "fornecedores", rotulo: "Fornecedores", valor: (r) => r.fornecedores.join("; ") },
    { chave: "destinos", rotulo: "Redistribuir Para", valor: destinosTexto },
    { chave: "vigencia", rotulo: "Vigência", valor: vigenciaTexto },
    { chave: "situacao", rotulo: "Situação", valor: (r) => (r.ativo ? "Ativa" : "Inativa") },
    { chave: "origem", rotulo: "Origem", valor: (r) => (r.doCenario ? "Só no cenário" : "Cadastros Gerais") },
  ];
  const destaque = (
    <Destaque
      titulo="Redistribuições de Gastos"
      descricao="Valem na carga do realizado da referência deste cenário, no lugar das dos Cadastros Gerais: carregue o realizado de novo para uma mudança chegar às Médias de Referência."
    >
      {pode ? (
        <>
          {trazerNovos.botao}
          <Button type="button" className={botaoPrimario} onClick={() => setAberta(null)}>
            <Plus className="size-4" />
            Nova Redistribuição
          </Button>
        </>
      ) : null}
      <ExportarTabela titulo="Cenário · Configurações · Redistribuições de Gastos" colunas={colunas} linhas={tabela.filtradas} />
    </Destaque>
  );
  return (
    <>
      <TabelaComDestaque
        destaque={destaque}
        larguras={LARGURAS_DAS_REDISTRIBUICOES}
        cabecalho={tabela.linhaDoCabecalho}
        corpo={
          dados.redistribuicoes.length === 0 ? (
            <LinhaVazia colunas={COLUNAS_DAS_REDISTRIBUICOES.length} texto={`Nenhuma redistribuição de gastos no cenário${pode ? ": use “Nova Redistribuição” para incluir uma." : "."}`} />
          ) : tabela.visiveis.length === 0 ? (
            <SemResultado colunas={COLUNAS_DAS_REDISTRIBUICOES.length} onLimpar={tabela.limpar} />
          ) : (
            tabela.visiveis.map((r) => (
              <tr
                key={r.id}
                className={`cursor-pointer border-t border-gray-100 hover:bg-gray-100 ${r.ativo ? "" : "text-gray-400"}`}
                onClick={() => setAberta(r)}
                title={pode ? "Editar a redistribuição no cenário" : "Ver a redistribuição"}
              >
                <td className={TD} title={r.departamento ?? "Todos"}>
                  {r.departamento ?? "Todos"}
                </td>
                <td className="px-3 py-1.5">
                  <div className="truncate" title={r.conta.rotulo}>
                    {r.conta.rotulo}
                  </div>
                  <span className="text-xs text-gray-500">{r.conta.codigo}</span>
                </td>
                <td className={`${TD} text-right`} title={r.fornecedores.join("\n")}>
                  {r.fornecedores.length} {plural(r.fornecedores.length, "fornecedor", "fornecedores")}
                </td>
                <td className="px-3 py-1.5">
                  <ul className="space-y-0.5">
                    {r.destinos.map((d) => (
                      <li key={d.centroCustoId} className="flex items-baseline justify-between gap-3">
                        <span className="truncate" title={d.centro}>
                          {d.centro}
                        </span>
                        <span className="font-medium whitespace-nowrap">{pctTexto(d.percentual)}</span>
                      </li>
                    ))}
                  </ul>
                </td>
                <td className={TD}>{vigenciaTexto(r)}</td>
                <td className={TD}>{r.ativo ? "Ativa" : "Inativa"}</td>
                <td className={TD}>{r.doCenario ? "Só no cenário" : "Cadastros Gerais"}</td>
              </tr>
            ))
          )
        }
      />
      {trazerNovos.dialogo}
      {aberta !== undefined ? <RedistribuicaoDialog registro={aberta} opcoes={dados.opcoes} pode={pode} fonte={fonte} onFechar={() => setAberta(undefined)} /> : null}
    </>
  );
}

const destinosTexto = (r: RedistribuicaoDoCenario) => r.destinos.map((d) => `${d.centro}: ${pctTexto(d.percentual)}`).join("; ");
const COLUNAS_DAS_REDISTRIBUICOES: Coluna<RedistribuicaoDoCenario>[] = [
  { chave: "departamento", rotulo: "Departamento da DRE", valor: (r) => r.departamento ?? "Todos" },
  { chave: "conta", rotulo: "Conta da DRE", valor: (r) => r.conta.rotulo },
  {
    chave: "fornecedores",
    rotulo: "Fornecedores",
    tipo: "numero",
    alinhamento: "direita",
    valor: (r) => r.fornecedores.length,
    texto: (r) => `${r.fornecedores.length} ${plural(r.fornecedores.length, "fornecedor", "fornecedores")}`,
  },
  { chave: "destinos", rotulo: "Redistribuir Para", valor: destinosTexto },
  { chave: "vigencia", rotulo: "Vigência", valor: vigenciaTexto },
  { chave: "situacao", rotulo: "Situação", valor: (r) => (r.ativo ? "Ativa" : "Inativa") },
  { chave: "origem", rotulo: "Origem", valor: (r) => (r.doCenario ? "Só no cenário" : "Cadastros Gerais") },
];
const LARGURAS_DAS_REDISTRIBUICOES = [200, 260, 140, 340, 140, 100, 140];
