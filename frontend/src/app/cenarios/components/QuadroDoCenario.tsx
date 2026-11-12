"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EllipsisVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { CampoBusca } from "@/components/shared/Filtros";
import { ConfirmacaoDialog } from "@/components/shared/ConfirmacaoDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAlteracoesPendentes } from "@/lib/alteracoesPendentes";
import { plural } from "@/lib/texto";

import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";

import { cenariosService, type CampoDoMes, type LinhaDoQuadroDoCenario, type MesDoQuadro, type QuadroDoCenario as Dados } from "../services/cenariosService";
import { funcaoNaSenioridade, opcoesDeFuncao } from "@/app/gestao-de-colaboradores/services/funcaoPorSenioridade";
import { botaoPrimario, classeSelect, Erro } from "./CenarioDialog";
import { lerNumero } from "./EdicaoDialogs";

const Carregando = () => <div className="h-64 animate-pulse rounded-sm bg-gray-100" />;
const CAMPOS: Array<{ campo: CampoDoMes; rotulo: string; dica: string; largura: number }> = [
  { campo: "colaboradores", rotulo: "Colab.", dica: "Colaboradores", largura: 72 },
  { campo: "salarioBruto", rotulo: "Salário Bruto", dica: "Salário Bruto (R$) de cada colaborador", largura: 108 },
  { campo: "adicional", rotulo: "Insalub. / Peric.", dica: "Insalubridade / Periculosidade (R$) de cada colaborador", largura: 112 },
];
const LARGURA_TOTAL = 108;
const LARGURA_CUSTO = 156;
/** A altura da primeira linha do cabeçalho (os meses): a segunda (os campos) fica presa logo abaixo dela. */
const ALTURA_DOS_MESES = 36;
/** As colunas dos cadastros (fixas à esquerda ao correr a tabela). */
const DESCRICAO: Array<{ chave: keyof LinhaDoQuadroDoCenario; rotulo: string; largura: number }> = [
  { chave: "unidade", rotulo: "Unidade", largura: 104 },
  { chave: "vinculo", rotulo: "Tipo", largura: 52 },
  { chave: "senioridade", rotulo: "Senioridade", largura: 100 },
  { chave: "funcao", rotulo: "Função", largura: 180 },
  { chave: "centro", rotulo: "Centro de Custo", largura: 220 },
];
const numero = (v: number, casas = 2) => v.toLocaleString("pt-BR", { maximumFractionDigits: casas });
const reais = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const total = (m: MesDoQuadro) => m.salarioBruto + m.adicional;
const chaveDe = (linha: string, mes: number, campo: CampoDoMes) => `${linha}|${mes}|${campo}`;

/**
 * A aba Quadro de Lotação das premissas de um cenário analítico (09/11/2026, etapa 4 da Gestão de Colaboradores): as
 * linhas como as do Lançamento Inicial (Unidade, Tipo, Senioridade, Função e Centro de Custo) e, em cada mês, quatro
 * colunas — os Colaboradores, o Salário Bruto e a Insalubridade / Periculosidade de cada um (digitados na tabela) e o
 * Salário Total (a soma). O grupo de centros com linhas conta os colaboradores e as remunerações por elas (aba Centros de
 * Custo); os aprendizes (a senioridade Aprendiz) têm o FGTS Aprendiz.
 */
export function QuadroDoCenario({ id, editavel }: { id: string; editavel: boolean }) {
  const queryClient = useQueryClient();
  const consulta = useQuery({ queryKey: ["cenarios", id, "quadro"], queryFn: () => cenariosService.quadro(id) });
  const [busca, setBusca] = useState("");
  const [mesVisivel, setMesVisivel] = useState<number | null>(null);
  const [edicoes, setEdicoes] = useState<Record<string, string>>({});
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [dialogo, setDialogo] = useState<{ linha: LinhaDoQuadroDoCenario | null } | null>(null);
  const [excluindo, setExcluindo] = useState<LinhaDoQuadroDoCenario[] | null>(null);
  const dados = consulta.data;
  const pode = editavel && !!dados?.editavel;

  // Os valores digitados: os válidos que mudam algo viram alteração; os inválidos seguram a gravação.
  const original = (linha: string, mes: number, campo: CampoDoMes) => dados?.linhas.find((l) => l.id === linha)?.meses[mes - 1][campo] ?? 0;
  const alteracoes = Object.entries(edicoes).flatMap(([k, texto]) => {
    const [linha, mes, campo] = k.split("|") as [string, string, CampoDoMes];
    const v = lerNumero(texto);
    if (v === undefined || (v !== null && v < 0)) return [];
    return (v ?? 0) !== original(linha, Number(mes), campo) ? [{ linha, mes: Number(mes), campo, valor: v }] : [];
  });
  const invalidos = Object.values(edicoes).filter((t) => {
    const v = lerNumero(t);
    return v === undefined || (v !== null && v < 0);
  }).length;
  useAlteracoesPendentes(alteracoes.length > 0 || invalidos > 0);

  const gravar = useMutation({
    mutationFn: () => cenariosService.gravarMesesDoQuadro(id, alteracoes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cenarios"] });
      queryClient.invalidateQueries({ queryKey: ["relatorios"] });
      toast.success(`${alteracoes.length} ${plural(alteracoes.length, "valor gravado", "valores gravados")}; os centros de custo e a DRE do cenário foram recalculados.`);
      setEdicoes({});
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível gravar o Quadro de Lotação.")),
  });

  if (consulta.isError) return <Erro erro={mensagemDeErro(consulta.error, "Erro ao carregar o Quadro de Lotação.")} />;
  if (consulta.isPending || !dados) return <Carregando />;

  const efetivo = (l: LinhaDoQuadroDoCenario, k: number): MesDoQuadro => {
    const m = { ...l.meses[k] };
    for (const c of CAMPOS) {
      const texto = edicoes[chaveDe(l.id, k + 1, c.campo)];
      const v = texto === undefined ? undefined : lerNumero(texto);
      if (typeof v === "number" && v >= 0) m[c.campo] = v;
      else if (v === null) m[c.campo] = 0;
    }
    return m;
  };
  const t = busca.trim().toLowerCase();
  const linhas = dados.linhas.filter((l) => !t || [l.unidade, l.vinculo, l.senioridade, l.funcao, l.centro, l.grupo ?? ""].join(" ").toLowerCase().includes(t));
  const meses = dados.meses.filter((m) => mesVisivel === null || m.mes === mesVisivel);
  const custoNoAno = (l: LinhaDoQuadroDoCenario) => l.meses.reduce((s, _, k) => s + efetivo(l, k).colaboradores * total(efetivo(l, k)), 0);
  const foraDosGrupos = dados.linhas.filter((l) => !l.grupo).length;
  // As colunas fixas: a caixa (com edição) e as dos cadastros.
  const esquerdas: number[] = [];
  let acumulado = pode ? 36 : 0;
  for (const d of DESCRICAO) {
    esquerdas.push(acumulado);
    acumulado += d.largura;
  }
  const largura = acumulado + meses.length * (CAMPOS.reduce((s, c) => s + c.largura, 0) + LARGURA_TOTAL) + LARGURA_CUSTO + (pode ? 56 : 0);
  const todasMarcadas = linhas.length > 0 && linhas.every((l) => marcadas.has(l.id));
  const classeFixa = "sticky z-10 bg-white";
  const explicacao = `${dados.linhas.length} ${plural(dados.linhas.length, "linha", "linhas")} · os grupos de centros com linhas contam por elas os Colaboradores CLT e PJ e as Remunerações CLT e PJ (aba Centros de Custo); a senioridade Aprendiz tem o Fundo de Garantia: Aprendiz.`;

  return (
    <section className="space-y-3">
      <h2 className="text-base font-bold tracking-wide text-gray-900 uppercase">Quadro de Lotação</h2>
      {foraDosGrupos ? (
        <p className="rounded-sm border border-l-4 border-gray-200 border-l-red-600 bg-white px-4 py-2 text-sm text-gray-700">
          {foraDosGrupos} {plural(foraDosGrupos, "linha tem um centro de custo que não é", "linhas têm centros de custo que não são")} de um grupo do cenário (inativo, sem código ou de
          estoque e investimento) e não {plural(foraDosGrupos, "conta", "contam")}. Edite o centro da linha.
        </p>
      ) : null}
      {/* O destaque (11/11/2026, pedido do Adão): o texto em até duas linhas (inteiro no título) e, à direita, dentro dele, a busca, os meses e os botões. */}
      <div className="flex flex-wrap items-center gap-3 rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-2">
        <p className="line-clamp-2 min-w-72 flex-1 text-xs text-gray-700" title={explicacao}>
          {explicacao}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <CampoBusca rotulo="Buscar linha" valor={busca} onMudar={setBusca} placeholder="Função, centro, unidade, senioridade…" largura="sm:w-48" />
          <select aria-label="Meses da tabela" value={mesVisivel ?? ""} onChange={(e) => setMesVisivel(e.target.value ? Number(e.target.value) : null)} className={`${classeSelect} sm:w-40`}>
            <option value="">Todos os Meses</option>
            {dados.meses.map((m) => (
              <option key={m.mes} value={m.mes}>
                {m.rotulo}
              </option>
            ))}
          </select>
          {pode ? (
            <>
            {marcadas.size ? (
              <Button type="button" variant="outline" className="rounded-sm" onClick={() => setExcluindo(dados.linhas.filter((l) => marcadas.has(l.id)))}>
                <Trash2 className="size-4" />
                Excluir Selecionadas
              </Button>
            ) : null}
            {alteracoes.length || invalidos ? (
              <>
                <Button type="button" variant="outline" className="rounded-sm" disabled={gravar.isPending} onClick={() => setEdicoes({})}>
                  Descartar
                </Button>
                <Button type="button" className={botaoPrimario} disabled={gravar.isPending || invalidos > 0 || !alteracoes.length} onClick={() => gravar.mutate()}>
                  {gravar.isPending ? "Gravando…" : `Gravar (${alteracoes.length})`}
                </Button>
              </>
            ) : null}
            <Button type="button" className={botaoPrimario} onClick={() => setDialogo({ linha: null })}>
              <Plus className="size-4" />
              Nova Entrada
            </Button>
            </>
          ) : null}
        </div>
      </div>
      {invalidos ? <p className="text-sm text-red-700">{invalidos} {plural(invalidos, "valor digitado não é", "valores digitados não são")} um número de zero para cima: corrija antes de gravar.</p> : null}
      <div className="max-h-[70vh] overflow-auto rounded-sm border border-gray-200 bg-white">
        {/* [--topo-tabela:0px]: a rolagem é a da caixa, e os rótulos ficam no topo dela. */}
        <table className="tabela-sig table-fixed border-collapse text-sm [--topo-tabela:0px]" style={{ width: largura, minWidth: "100%" }}>
          <thead className="sticky top-0 z-20 bg-white">
            <tr className="border-b border-gray-200 text-xs font-bold text-gray-900">
              {pode ? (
                <th rowSpan={2} className={`${classeFixa} !z-30 w-9 px-2 py-2`} style={{ left: 0 }}>
                  <input
                    type="checkbox"
                    aria-label="Marcar todas as linhas"
                    className="size-3.5 cursor-pointer accent-black"
                    checked={todasMarcadas}
                    onChange={(e) => setMarcadas(e.target.checked ? new Set(linhas.map((l) => l.id)) : new Set())}
                  />
                </th>
              ) : null}
              {DESCRICAO.map((d, i) => (
                <th key={d.chave} rowSpan={2} className={`${classeFixa} !z-30 px-3 py-2 text-left`} style={{ left: esquerdas[i], width: d.largura }}>
                  {d.rotulo}
                </th>
              ))}
              {meses.map((m) => (
                <th key={m.mes} colSpan={4} className="border-l border-gray-300 px-3 !py-0 text-center whitespace-nowrap" style={{ height: ALTURA_DOS_MESES }}>
                  {m.rotulo}
                </th>
              ))}
              <th rowSpan={2} className="border-l border-gray-300 px-3 py-2 text-right" style={{ width: LARGURA_CUSTO }} title="Colaboradores × Salário Total, nos doze meses">
                Custo no Ano (R$)
              </th>
              {pode ? <th rowSpan={2} className="w-14 px-2 py-2" aria-label="Ações" /> : null}
            </tr>
            <tr className="border-b border-gray-300 text-xs font-bold text-gray-900">
              {meses.map((m) => (
                <SubCabecalhos key={m.mes} />
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id} className="border-b border-gray-100 hover:bg-gray-50">
                {pode ? (
                  <td className={`${classeFixa} px-2 py-1`} style={{ left: 0 }}>
                    <input
                      type="checkbox"
                      aria-label={`Marcar ${l.funcao} · ${l.centro}`}
                      className="size-3.5 cursor-pointer accent-black"
                      checked={marcadas.has(l.id)}
                      onChange={(e) =>
                        setMarcadas((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(l.id);
                          else n.delete(l.id);
                          return n;
                        })
                      }
                    />
                  </td>
                ) : null}
                {DESCRICAO.map((d, i) => (
                  <td key={d.chave} className={`${classeFixa} truncate px-3 py-1`} style={{ left: esquerdas[i] }} title={d.chave === "centro" ? `${l.centro}${l.grupo ? ` · grupo ${l.grupo}` : " · fora dos grupos do cenário"}` : String(l[d.chave])}>
                    {d.chave === "centro" && !l.grupo ? <span className="text-red-700">{l.centro}</span> : String(l[d.chave])}
                  </td>
                ))}
                {meses.map((m) => {
                  const e = efetivo(l, m.mes - 1);
                  return (
                    <CelulasDoMes
                      key={m.mes}
                      linha={l}
                      mes={m.mes}
                      rotuloMes={m.rotulo}
                      editavel={pode}
                      edicoes={edicoes}
                      onEditar={(campo, texto) => setEdicoes((x) => ({ ...x, [chaveDe(l.id, m.mes, campo)]: texto }))}
                      salarioTotal={total(e)}
                    />
                  );
                })}
                <td className="border-l border-gray-300 px-3 py-1 text-right whitespace-nowrap">{reais(custoNoAno(l))}</td>
                {pode ? (
                  <td className="px-2 py-1">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button type="button" size="icon" variant="outline" className="size-7 rounded-sm" aria-label={`Ações de ${l.funcao} · ${l.centro}`} title="Ações">
                            <EllipsisVertical className="size-4" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end" className="w-auto min-w-40">
                        <DropdownMenuItem onClick={() => setDialogo({ linha: l })}>
                          <Pencil />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => setExcluindo([l])}>
                          <Trash2 />
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                ) : null}
              </tr>
            ))}
            {linhas.length === 0 ? (
              <tr>
                <td colSpan={DESCRICAO.length + meses.length * 4 + 3} className="px-4 py-6 text-center text-sm text-gray-500">
                  {dados.linhas.length ? "Nenhuma linha com essa busca." : pode ? "Nenhuma linha: inclua as linhas em Nova Entrada ou importe a aba Quadro de Lotação em Importar Valores." : "Nenhuma linha no Quadro de Lotação deste cenário."}
                </td>
              </tr>
            ) : null}
          </tbody>
          {linhas.length ? (
            <tfoot>
              <tr className="border-t border-gray-300 bg-gray-50 font-bold text-gray-900">
                {pode ? <td className={`${classeFixa} bg-gray-50`} style={{ left: 0 }} /> : null}
                <td colSpan={DESCRICAO.length} className={`${classeFixa} bg-gray-50 px-3 py-2`} style={{ left: pode ? 36 : 0 }}>
                  Total
                </td>
                {meses.map((m) => {
                  const k = m.mes - 1;
                  const colaboradores = linhas.reduce((s, l) => s + efetivo(l, k).colaboradores, 0);
                  const folha = linhas.reduce((s, l) => s + efetivo(l, k).colaboradores * total(efetivo(l, k)), 0);
                  return [
                    <td key={`${m.mes}c`} className="border-l border-gray-300 px-3 py-2 text-right">
                      {numero(colaboradores)}
                    </td>,
                    <td key={`${m.mes}b`} />,
                    <td key={`${m.mes}a`} />,
                    <td key={`${m.mes}t`} className="px-3 py-2 text-right whitespace-nowrap" title="A folha do mês: colaboradores × Salário Total">
                      {reais(folha)}
                    </td>,
                  ];
                })}
                <td className="border-l border-gray-300 px-3 py-2 text-right whitespace-nowrap">{reais(linhas.reduce((s, l) => s + custoNoAno(l), 0))}</td>
                {pode ? <td /> : null}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      {dialogo ? <LinhaDoQuadroDialog id={id} dados={dados} linha={dialogo.linha} onFechar={() => setDialogo(null)} /> : null}
      {excluindo ? (
        <ExcluirLinhasDialog
          id={id}
          linhas={excluindo}
          onFechar={(excluiu) => {
            setExcluindo(null);
            if (excluiu) setMarcadas(new Set());
          }}
        />
      ) : null}
    </section>
  );
}

/** Os rótulos das quatro colunas de um mês. */
function SubCabecalhos() {
  return (
    <>
      {CAMPOS.map((c, i) => (
        <th key={c.campo} className={`px-2 py-1.5 text-right whitespace-nowrap ${i === 0 ? "border-l border-gray-300" : ""}`} style={{ width: c.largura, top: ALTURA_DOS_MESES }} title={c.dica}>
          {c.rotulo}
        </th>
      ))}
      <th className="px-2 py-1.5 text-right whitespace-nowrap" style={{ width: LARGURA_TOTAL, top: ALTURA_DOS_MESES }} title="Salário Total (R$): Salário Bruto + Insalubridade / Periculosidade, de cada colaborador">
        Salário Total
      </th>
    </>
  );
}

/** As quatro células de um mês de uma linha: os três valores (campos, na edição) e o Salário Total. */
function CelulasDoMes({
  linha,
  mes,
  rotuloMes,
  editavel,
  edicoes,
  onEditar,
  salarioTotal,
}: {
  linha: LinhaDoQuadroDoCenario;
  mes: number;
  rotuloMes: string;
  editavel: boolean;
  edicoes: Record<string, string>;
  onEditar: (campo: CampoDoMes, texto: string) => void;
  salarioTotal: number;
}) {
  return (
    <>
      {CAMPOS.map((c, i) => {
        const valor = linha.meses[mes - 1][c.campo];
        const texto = edicoes[chaveDe(linha.id, mes, c.campo)];
        const v = texto === undefined ? valor : lerNumero(texto);
        const invalido = v === undefined || (typeof v === "number" && v < 0);
        const alterado = texto !== undefined && !invalido && (v ?? 0) !== valor;
        return (
          <td key={c.campo} className={`px-1 py-0.5 text-right ${i === 0 ? "border-l border-gray-300" : ""}`}>
            {editavel ? (
              <input
                aria-label={`${c.dica} em ${rotuloMes}: ${linha.funcao} · ${linha.centro}`}
                inputMode="decimal"
                value={texto ?? (valor ? numero(valor) : "")}
                onChange={(e) => onEditar(c.campo, e.target.value)}
                className={`h-7 w-full rounded-sm border px-1.5 text-right text-sm outline-none focus:border-gray-900 ${invalido ? "border-red-500 bg-red-50" : alterado ? "border-bpm-primary bg-yellow-50" : "border-transparent hover:border-gray-300"}`}
              />
            ) : (
              <span className="px-1.5">{valor ? numero(valor) : ""}</span>
            )}
          </td>
        );
      })}
      <td className="px-2 py-1 text-right whitespace-nowrap text-gray-600">{salarioTotal ? reais(salarioTotal) : ""}</td>
    </>
  );
}

/**
 * A Nova Entrada e o Editar Linha do Quadro de Lotação: a Unidade, o Tipo, a Senioridade, a Função e o Centro de Custo (dos
 * grupos do cenário); na nova, os Colaboradores, o Salário Bruto e a Insalubridade / Periculosidade de cada um, a partir
 * do mês escolhido (os meses se editam depois na tabela).
 */
function LinhaDoQuadroDialog({ id, dados, linha, onFechar }: { id: string; dados: Dados; linha: LinhaDoQuadroDoCenario | null; onFechar: () => void }) {
  const queryClient = useQueryClient();
  const [unidade, setUnidade] = useState(linha?.unidadeNegocioId ?? dados.opcoes.unidades[0]?.id ?? "");
  const [vinculo, setVinculo] = useState<"CLT" | "PJ">(linha?.vinculo ?? "CLT");
  const [senioridade, setSenioridade] = useState(linha?.senioridadeId ?? "");
  const [funcao, setFuncao] = useState(linha?.funcaoId ?? "");
  const [centro, setCentro] = useState(linha?.centroCustoId ?? "");
  const [colaboradores, setColaboradores] = useState("1");
  const [bruto, setBruto] = useState("");
  const [adicional, setAdicional] = useState("");
  const [inicio, setInicio] = useState(1);
  const n = { colaboradores: lerNumero(colaboradores), bruto: lerNumero(bruto), adicional: lerNumero(adicional) };
  const numeroValido = (v: number | null | undefined) => v === null || (typeof v === "number" && v >= 0);
  const valido = !!unidade && !!senioridade && !!funcao && !!centro && (linha !== null || (numeroValido(n.colaboradores) && numeroValido(n.bruto) && numeroValido(n.adicional)));
  // As opções: as ativas e, na edição, a que a linha já tem (mesmo inativa).
  const comAtual = <T extends { id: string; nome: string }>(xs: T[], atualId: string | undefined, atualNome: string | undefined) =>
    atualId && !xs.some((x) => x.id === atualId) ? [...xs, { id: atualId, nome: `${atualNome} (inativo)` } as T] : xs;
  const centros = [...comAtual(dados.opcoes.centros, linha?.centroCustoId, linha?.centro)].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const gravar = useMutation({
    mutationFn: () => {
      const base = { unidadeNegocioId: unidade, vinculo, senioridadeId: senioridade, funcaoId: funcao, centroCustoId: centro };
      if (linha) return cenariosService.alterarLinhaDoQuadro(id, linha.id, base);
      const valores = { colaboradores: (n.colaboradores as number | null) ?? 0, salarioBruto: (n.bruto as number | null) ?? 0, adicional: (n.adicional as number | null) ?? 0 };
      return cenariosService.criarLinhaDoQuadro(id, { ...base, meses: dados.meses.map((m) => (m.mes >= inicio ? valores : { colaboradores: 0, salarioBruto: 0, adicional: 0 })) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cenarios"] });
      queryClient.invalidateQueries({ queryKey: ["relatorios"] });
      toast.success(linha ? "Linha alterada; os centros de custo e a DRE do cenário foram recalculados." : "Linha incluída; os centros de custo e a DRE do cenário foram recalculados.");
      onFechar();
    },
  });
  const select = (rotulo: string, idCampo: string, valor: string, mudar: (v: string) => void, opcoes: Array<{ id: string; nome: string }>, vazio = true) => (
    <div className="space-y-1.5">
      <Label htmlFor={idCampo}>{rotulo}</Label>
      <select id={idCampo} value={valor} onChange={(e) => mudar(e.target.value)} className={classeSelect}>
        {vazio ? <option value="">Escolha…</option> : null}
        {opcoes.map((o) => (
          <option key={o.id} value={o.id}>
            {o.nome}
          </option>
        ))}
      </select>
    </div>
  );
  const campo = (rotulo: string, idCampo: string, valor: string, mudar: (v: string) => void) => (
    <div className="space-y-1.5">
      <Label htmlFor={idCampo}>{rotulo}</Label>
      <Input id={idCampo} value={valor} onChange={(e) => mudar(e.target.value)} inputMode="decimal" className={`rounded-sm text-right ${numeroValido(lerNumero(valor)) ? "" : "border-red-400"}`} />
    </div>
  );
  const salarioTotal = ((n.bruto as number | null) ?? 0) + ((n.adicional as number | null) ?? 0);
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="max-h-[90vh] overflow-y-auto rounded-sm sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{linha ? "Editar Linha do Quadro de Lotação" : "Nova Entrada do Quadro de Lotação"}</DialogTitle>
          <DialogDescription>
            {linha
              ? "Os cadastros da linha; os colaboradores e os salários de cada mês se editam na tabela."
              : "Como no Lançamento Inicial: a unidade, o tipo, a senioridade, a função e o centro de custo; e os colaboradores e os salários de cada um a partir do mês escolhido (os meses se editam depois na tabela)."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {select("Unidade", "ql-unidade", unidade, setUnidade, comAtual(dados.opcoes.unidades, linha?.unidadeNegocioId, linha?.unidade), false)}
          <div className="space-y-1.5">
            <Label htmlFor="ql-tipo">Tipo</Label>
            <select id="ql-tipo" value={vinculo} onChange={(e) => setVinculo(e.target.value as "CLT" | "PJ")} className={classeSelect}>
              <option value="CLT">CLT</option>
              <option value="PJ">PJ</option>
            </select>
          </div>
          {select(
            "Senioridade",
            "ql-senioridade",
            senioridade,
            (s) => {
              setSenioridade(s);
              // A função acompanha a senioridade: a do mesmo nome na nova (ou nenhuma).
              setFuncao(funcaoNaSenioridade(dados.opcoes.funcoes, funcao, s));
            },
            comAtual(dados.opcoes.senioridades, linha?.senioridadeId, linha?.senioridade),
          )}
          {select(
            "Função",
            "ql-funcao",
            funcao,
            (f) => {
              setFuncao(f);
              // A senioridade da função (11/11/2026: a mesma função tem uma por senioridade).
              const daFuncao = dados.opcoes.funcoes.find((x) => x.id === f)?.senioridadeId;
              if (daFuncao) setSenioridade(daFuncao);
            },
            // A função com a senioridade ao lado; com a senioridade escolhida, só as dela.
            comAtual(opcoesDeFuncao(dados.opcoes.funcoes, dados.opcoes.senioridades, senioridade), linha?.funcaoId, linha?.funcao),
          )}
          <div className="sm:col-span-2">
            {select(
              "Centro de Custo",
              "ql-centro",
              centro,
              setCentro,
              centros.map((c) => ({ id: c.id, nome: "grupo" in c && c.grupo ? `${c.nome} (${c.grupo})` : c.nome })),
            )}
          </div>
          {linha ? null : (
            <>
              {campo("Colaboradores", "ql-colaboradores", colaboradores, setColaboradores)}
              <div className="space-y-1.5">
                <Label htmlFor="ql-inicio">A Partir de</Label>
                <select id="ql-inicio" value={inicio} onChange={(e) => setInicio(Number(e.target.value))} className={classeSelect}>
                  {dados.meses.map((m) => (
                    <option key={m.mes} value={m.mes}>
                      {m.rotulo}
                    </option>
                  ))}
                </select>
              </div>
              {campo("Salário Bruto (R$)", "ql-bruto", bruto, setBruto)}
              {campo("Insalubridade / Periculosidade (R$)", "ql-adicional", adicional, setAdicional)}
              <p className="text-sm text-gray-700 sm:col-span-2">
                Salário Total de cada colaborador: <span className="font-bold text-gray-900">R$ {reais(salarioTotal)}</span>
              </p>
            </>
          )}
        </div>
        <Erro erro={gravar.isError ? mensagemDeErro(gravar.error, "Não foi possível gravar a linha.") : null} />
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar} disabled={gravar.isPending}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={!valido || gravar.isPending} onClick={() => gravar.mutate()}>
            {gravar.isPending ? "Gravando…" : "Gravar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A confirmação do Excluir (uma linha ou as selecionadas): recalcula os centros e a DRE. */
function ExcluirLinhasDialog({ id, linhas, onFechar }: { id: string; linhas: LinhaDoQuadroDoCenario[]; onFechar: (excluiu: boolean) => void }) {
  const queryClient = useQueryClient();
  const excluir = useMutation({
    mutationFn: () => (linhas.length === 1 ? cenariosService.excluirLinhaDoQuadro(id, linhas[0].id) : cenariosService.excluirLinhasDoQuadro(id, linhas.map((l) => l.id))),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cenarios"] });
      queryClient.invalidateQueries({ queryKey: ["relatorios"] });
      toast.success(`${linhas.length} ${plural(linhas.length, "linha excluída", "linhas excluídas")}; os centros de custo e a DRE do cenário foram recalculados.`);
      onFechar(true);
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível excluir.")),
  });
  return (
    <ConfirmacaoDialog
      titulo={linhas.length === 1 ? "Excluir Linha do Quadro de Lotação" : "Excluir Linhas do Quadro de Lotação"}
      descricao={`${linhas.length === 1 ? "A linha sai" : `As ${linhas.length} linhas saem`} do Quadro de Lotação do cenário. Os grupos de centros sem mais nenhuma linha voltam a ter os colaboradores e as remunerações digitados na aba Centros de Custo (com os últimos valores calculados).`}
      pendente={excluir.isPending}
      onConfirmar={() => excluir.mutate()}
      onFechar={() => onFechar(false)}
    >
      <ul className="max-h-48 list-disc overflow-y-auto pl-5 text-sm text-gray-700">
        {linhas.map((l) => (
          <li key={l.id}>
            {l.funcao} · {l.centro} ({l.vinculo}, {l.senioridade})
          </li>
        ))}
      </ul>
    </ConfirmacaoDialog>
  );
}
