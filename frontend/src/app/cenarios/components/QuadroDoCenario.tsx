"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EllipsisVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { CampoBusca } from "@/components/shared/Filtros";
import { ConfirmacaoDialog } from "@/components/shared/ConfirmacaoDialog";
import { DestaqueFlutuante, useDestaqueFlutuante } from "@/components/shared/DestaqueFlutuante";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { plural } from "@/lib/texto";

import { TabelaLarga } from "@/app/relatorios/components/TabelaLarga";
import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";

import { cenariosService, type CampoDoMes, type LinhaDoQuadroDoCenario, type MesDoQuadro, type OrigemDaGravacao, type QuadroDoCenario as Dados } from "../services/cenariosService";
import { ROTULO_DO_TIPO, rotuloDoTipo, TIPOS_DO_COLABORADOR, type TipoDoColaborador } from "@/app/gestao-de-colaboradores/services/tiposDoColaborador";
import { botaoPrimario, classeSelect, Erro } from "./CenarioDialog";
import { lerNumero, ValorDialog } from "./EdicaoDialogs";

const Carregando = () => <div className="h-64 animate-pulse rounded-sm bg-gray-100" />;
const CAMPOS: Array<{ campo: CampoDoMes; rotulo: string; dica: string; largura: number }> = [
  { campo: "colaboradores", rotulo: "Colab.", dica: "Colaboradores", largura: 72 },
  { campo: "salarioBruto", rotulo: "Salário Bruto", dica: "Salário Bruto (R$) da linha: o de todos os colaboradores dela", largura: 108 },
  { campo: "adicional", rotulo: "Insalub. / Peric.", dica: "Insalubridade / Periculosidade (R$) da linha: a de todos os colaboradores dela", largura: 112 },
];
const LARGURA_TOTAL = 108;
/**
 * As colunas do Total (19/11/2026, pedido do Adão; antes, o Custo no Ano): os Colaboradores (a média do ano, a soma ÷ 12, como
 * no Exportar dos centros) e a soma dos doze meses do Salário Bruto, da Insalubridade / Periculosidade e do Salário Total; as
 * da Média, as mesmas ÷ 12.
 */
const CAMPOS_DO_TOTAL: Array<{ campo: CampoDoMes | "salarioTotal"; rotulo: string; dica: string; largura: number }> = [
  { campo: "colaboradores", rotulo: "Colab.", dica: "Colaboradores: a média do ano (a soma dos meses ÷ 12)", largura: 72 },
  { campo: "salarioBruto", rotulo: "Salário Bruto", dica: "Salário Bruto (R$): a soma dos doze meses", largura: 140 },
  { campo: "adicional", rotulo: "Insalub. / Peric.", dica: "Insalubridade / Periculosidade (R$): a soma dos doze meses", largura: 124 },
  { campo: "salarioTotal", rotulo: "Salário Total", dica: "Salário Total (R$): a soma dos doze meses (o custo da linha no ano)", largura: 156 },
];
const CAMPOS_DA_MEDIA: typeof CAMPOS_DO_TOTAL = [
  { campo: "colaboradores", rotulo: "Colab.", dica: "Colaboradores: a média do ano (a soma dos meses ÷ 12)", largura: 72 },
  { campo: "salarioBruto", rotulo: "Salário Bruto", dica: "Salário Bruto (R$): a soma dos doze meses ÷ 12", largura: 108 },
  { campo: "adicional", rotulo: "Insalub. / Peric.", dica: "Insalubridade / Periculosidade (R$): a soma dos doze meses ÷ 12", largura: 112 },
  { campo: "salarioTotal", rotulo: "Salário Total", dica: "Salário Total (R$): a soma dos doze meses ÷ 12", largura: 108 },
];
/** A soma dos doze meses de cada campo de uma linha (ou do total das linhas), com o Salário Total. */
type SomaDoAno = Record<CampoDoMes | "salarioTotal", number>;
/**
 * A coluna da Referência, depois do Centro de Custo: os colaboradores da linha na referência (17/11/2026, pedido do Adão: só a
 * quantidade de colaboradores, sem os salários).
 */
const LARGURA_REFERENCIA = 100;
/** Os botões da marcação, como os das tabelas das outras abas (cinza-claro, ao lado dos amarelos). */
const botaoCinza = "rounded-sm border border-gray-200 bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-200";
/** A altura da primeira linha do cabeçalho (os meses); a segunda (os campos) vem logo abaixo dela, e as duas ficam presas juntas. */
const ALTURA_DOS_MESES = 36;
/** As colunas dos cadastros (fixas à esquerda ao correr a tabela). */
const DESCRICAO: Array<{ chave: keyof LinhaDoQuadroDoCenario; rotulo: string; largura: number }> = [
  { chave: "unidade", rotulo: "Unidade", largura: 104 },
  { chave: "vinculo", rotulo: "Tipo", largura: 84 },
  { chave: "funcao", rotulo: "Função", largura: 180 },
  { chave: "centro", rotulo: "Centro de Custo", largura: 220 },
];
const numero = (v: number, casas = 2) => v.toLocaleString("pt-BR", { maximumFractionDigits: casas });
const reais = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const total = (m: MesDoQuadro) => m.salarioBruto + m.adicional;

/**
 * A aba Quadro de Lotação das premissas de um cenário analítico (09/11/2026, etapa 4 da Gestão de Colaboradores): as
 * linhas como as do Lançamento Inicial (Unidade, Tipo, Função e Centro de Custo) e, em cada mês, quatro colunas — os
 * Colaboradores, o Salário Bruto e a Insalubridade / Periculosidade da linha (17/11/2026, pedido do Adão: os de todos os
 * colaboradores dela, sem multiplicar por eles) e o Salário Total (a soma). Clicar num valor
 * abre o modal Editar Valor (16/11/2026, pedido do Adão: o mesmo das demais abas, no lugar da digitação na tabela com
 * Gravar / Descartar), com o reajuste e a chave de replicar aos meses seguintes; cada gravação vai para o histórico. Clicar na
 * Unidade, no Tipo, na Função ou no Centro de Custo (20/11/2026) abre o modal Editar Linha do Quadro de Lotação. Como nas
 * tabelas das outras abas (16/11/2026), as caixas das linhas e dos meses marcam valores, e o Replicar Referências leva os
 * Colaboradores da referência de cada linha marcada (e, na realizada, os salários: as colunas da Referência) aos meses marcados. O grupo de centros com linhas conta os colaboradores e as remunerações por elas (aba Centros de Custo); o Tipo
 * Aprendiz tem o FGTS Aprendiz, e o Estagiário não tem encargos. Os rótulos ficam presos logo abaixo do título da tela, como
 * nas demais tabelas do SIG (16/11/2026; antes, no alto de uma caixa com rolagem própria), e o destaque flutua sobre a tabela.
 */
export function QuadroDoCenario({ id, editavel }: { id: string; editavel: boolean }) {
  const queryClient = useQueryClient();
  const consulta = useQuery({ queryKey: ["cenarios", id, "quadro"], queryFn: () => cenariosService.quadro(id) });
  const [busca, setBusca] = useState("");
  // O valor em edição no modal: a linha, o mês (1 a 12) e o campo.
  const [valor, setValor] = useState<{ linha: LinhaDoQuadroDoCenario; mes: number; campo: CampoDoMes } | null>(null);
  // A marcação (16/11/2026): as linhas e os meses (1 a 12) marcados, e a confirmação do Replicar Referências.
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [mesesMarcados, setMesesMarcados] = useState<Set<number>>(new Set());
  const [replicando, setReplicando] = useState(false);
  const [dialogo, setDialogo] = useState<{ linha: LinhaDoQuadroDoCenario | null } | null>(null);
  const [excluindo, setExcluindo] = useState<LinhaDoQuadroDoCenario[] | null>(null);
  const dados = consulta.data;
  const pode = editavel && !!dados?.editavel;

  const { refOriginal, refArea, refFlutuante, flutuar, rotulos } = useDestaqueFlutuante(!!dados);

  // A gravação do modal Editar Valor: o mês (e os seguintes, replicando) de um campo de uma linha, com a origem para o histórico.
  const gravar = useMutation({
    mutationFn: ({ alteracoes, origem }: { alteracoes: Array<{ linha: string; mes: number; campo: CampoDoMes; valor: number }>; origem: OrigemDaGravacao }) =>
      cenariosService.gravarMesesDoQuadro(id, alteracoes, origem),
    onSuccess: (_, { alteracoes }) => {
      queryClient.invalidateQueries({ queryKey: ["cenarios"] });
      queryClient.invalidateQueries({ queryKey: ["relatorios"] });
      toast.success(`${alteracoes.length} ${plural(alteracoes.length, "valor gravado", "valores gravados")}; os centros de custo e a DRE do cenário foram recalculados.`);
      setValor(null);
      setReplicando(false);
    },
  });

  if (consulta.isError) return <Erro erro={mensagemDeErro(consulta.error, "Erro ao carregar o Quadro de Lotação.")} />;
  if (consulta.isPending || !dados) return <Carregando />;

  const efetivo = (l: LinhaDoQuadroDoCenario, k: number): MesDoQuadro => l.meses[k];
  const t = busca.trim().toLowerCase();
  const linhas = dados.linhas.filter((l) => !t || [l.unidade, rotuloDoTipo(l.vinculo), l.funcao, l.centro, l.grupo ?? ""].join(" ").toLowerCase().includes(t));
  const meses = dados.meses;
  const comReferencia = !!dados.referencia;
  // Os valores marcados: as linhas marcadas (as que a busca mostra) × os meses marcados. O Replicar Referências leva os
  // Colaboradores da referência de cada uma aos meses marcados; as linhas sem a referência ficam como estão, e os salários não
  // têm referência.
  const linhasMarcadas = linhas.filter((l) => marcadas.has(l.id));
  const mesesDaMarcacao = [...mesesMarcados].sort((a, b) => a - b);
  const nMarcados = linhasMarcadas.length * mesesDaMarcacao.length;
  const dasReferencias = linhasMarcadas.flatMap((l) => {
    const r = l.referencia;
    return r === null ? [] : mesesDaMarcacao.map((mes) => ({ linha: l.id, mes, campo: "colaboradores" as const, valor: r }));
  });
  const semReferencia = linhasMarcadas.filter((l) => l.referencia === null).length;
  const todosOsMeses = mesesMarcados.size === meses.length;
  // 17/11/2026: o Salário Total já é o da linha (todos os colaboradores), sem multiplicar. A soma do ano de cada campo
  // (19/11/2026), para o Total e a Média.
  const somaDoAno = (ls: LinhaDoQuadroDoCenario[]): SomaDoAno => {
    const s: SomaDoAno = { colaboradores: 0, salarioBruto: 0, adicional: 0, salarioTotal: 0 };
    for (const l of ls)
      l.meses.forEach((_, k) => {
        const e = efetivo(l, k);
        s.colaboradores += e.colaboradores;
        s.salarioBruto += e.salarioBruto;
        s.adicional += e.adicional;
        s.salarioTotal += total(e);
      });
    return s;
  };
  const foraDosGrupos = dados.linhas.filter((l) => !l.grupo).length;
  // As colunas fixas: a caixa (com edição) e as dos cadastros.
  const esquerdas: number[] = [];
  let acumulado = pode ? 36 : 0;
  for (const d of DESCRICAO) {
    esquerdas.push(acumulado);
    acumulado += d.largura;
  }
  // As larguras das colunas: a caixa (com edição), os cadastros, as quatro de cada mês, as quatro do Total e as da Média e as
  // Ações (com edição).
  const larguras = [
    ...(pode ? [36] : []),
    ...DESCRICAO.map((d) => d.largura),
    ...(comReferencia ? [LARGURA_REFERENCIA] : []),
    ...meses.flatMap(() => [...CAMPOS.map((c) => c.largura), LARGURA_TOTAL]),
    ...CAMPOS_DO_TOTAL.map((c) => c.largura),
    ...CAMPOS_DA_MEDIA.map((c) => c.largura),
    ...(pode ? [56] : []),
  ];
  const todasMarcadas = linhas.length > 0 && linhas.every((l) => marcadas.has(l.id));
  const classeFixa = "sticky z-10 bg-white";
  // O destaque (11/11/2026; 16/11/2026, pedido do Adão: o nome da tabela dentro dele, sem o texto e sem a lista dos meses, e a
  // busca com o dobro da largura): à direita, a busca, a marcação (como nas tabelas das outras abas) e os botões, com o
  // Replicar Referências logo antes da Nova Entrada.
  const destaque = (
    <div className="flex flex-wrap items-center gap-3 rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-2">
      <h2 className="min-w-0 flex-1 text-base font-bold tracking-wide text-gray-900 uppercase">Quadro de Lotação</h2>
      {/* Em blocos que quebram juntos, alinhados à direita: a busca, a marcação e os dois botões. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <CampoBusca rotulo="Buscar linha" valor={busca} onMudar={setBusca} placeholder="Função, centro, unidade, tipo…" largura="sm:w-96" />
        {pode ? (
          <>
            <div className="flex items-center gap-2 whitespace-nowrap">
              <span className="text-sm text-gray-700">
                <span className="font-bold text-gray-900">{nMarcados}</span> {plural(nMarcados, "valor marcado", "valores marcados")} · {linhasMarcadas.length}{" "}
                {plural(linhasMarcadas.length, "linha", "linhas")} × {mesesMarcados.size} {plural(mesesMarcados.size, "mês", "meses")}
              </span>
              <button type="button" className={botaoCinza} onClick={() => setMesesMarcados(todosOsMeses ? new Set() : new Set(meses.map((m) => m.mes)))}>
                {todosOsMeses ? "Desmarcar os Meses" : "Marcar Todos os Meses"}
              </button>
              {marcadas.size || mesesMarcados.size ? (
                <button
                  type="button"
                  className={botaoCinza}
                  onClick={() => {
                    setMarcadas(new Set());
                    setMesesMarcados(new Set());
                  }}
                >
                  Limpar Seleção
                </button>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                className={botaoPrimario}
                disabled={dasReferencias.length === 0}
                title={comReferencia ? "Os Colaboradores da referência de cada linha marcada vão para os meses marcados" : "O cenário não tem referência carregada (Configurações / Referência)"}
                onClick={() => setReplicando(true)}
              >
                Replicar Referências
              </Button>
              <Button type="button" className={botaoPrimario} onClick={() => setDialogo({ linha: null })}>
                <Plus className="size-4" />
                Nova Entrada
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );


  return (
    <section className="space-y-3">
      {foraDosGrupos ? (
        <p className="rounded-sm border border-l-4 border-gray-200 border-l-red-600 bg-white px-4 py-2 text-sm text-gray-700">
          {foraDosGrupos} {plural(foraDosGrupos, "linha tem um centro de custo que não é", "linhas têm centros de custo que não são")} de um grupo do cenário (inativo, sem código ou de
          estoque e investimento) e não {plural(foraDosGrupos, "conta", "contam")}. Edite o centro da linha.
        </p>
      ) : null}
      <div ref={refOriginal}>{destaque}</div>
      {/* Os rótulos presos logo abaixo do título da tela, numa tabela à parte, e a barra de rolagem lateral no pé da janela (TabelaLarga). */}
      <div ref={refArea}>
        <DestaqueFlutuante refFlutuante={refFlutuante} flutuar={flutuar} rotulos={rotulos}>{destaque}</DestaqueFlutuante>
        <TabelaLarga
          larguras={larguras}
          cabecalho={
            <>
              <tr className="border-b border-gray-200 text-xs font-bold text-gray-900">
                {pode ? (
                  <th rowSpan={2} className={`${classeFixa} !z-30 px-2 py-2`} style={{ left: 0 }}>
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
                  <th key={d.chave} rowSpan={2} className={`${classeFixa} !z-30 px-3 py-2 text-left`} style={{ left: esquerdas[i] }}>
                    {d.rotulo}
                  </th>
                ))}
                {comReferencia ? (
                  // A Referência (16/11/2026): o grupo da coluna dela, como o de um mês, com o QL Realizado (ou o cenário) no título.
                  <th
                    className="border-l border-gray-300 px-3 !py-0 text-center whitespace-nowrap"
                    style={{ height: ALTURA_DOS_MESES }}
                    title={`A referência do cenário: ${dados.referencia!.rotulo}`}
                  >
                    Referência
                  </th>
                ) : null}
                {meses.map((m) => (
                  <th key={m.mes} colSpan={4} className="border-l border-gray-300 px-3 !py-0 text-center whitespace-nowrap" style={{ height: ALTURA_DOS_MESES }}>
                    <span className="inline-flex items-center gap-1.5">
                      {/* A caixa do mês (16/11/2026), como nas tabelas das outras abas. */}
                      {pode ? (
                        <input
                          type="checkbox"
                          aria-label={`Marcar ${m.rotulo}`}
                          className="size-3.5 cursor-pointer accent-black"
                          checked={mesesMarcados.has(m.mes)}
                          onChange={(e) =>
                            setMesesMarcados((s) => {
                              const n = new Set(s);
                              if (e.target.checked) n.add(m.mes);
                              else n.delete(m.mes);
                              return n;
                            })
                          }
                        />
                      ) : null}
                      {m.rotulo}
                    </span>
                  </th>
                ))}
                <th colSpan={4} className="border-l border-gray-300 px-3 !py-0 text-center whitespace-nowrap" style={{ height: ALTURA_DOS_MESES }} title="Os doze meses: os colaboradores, a média do ano; os valores, a soma">
                  Total
                </th>
                <th colSpan={4} className="border-l border-gray-300 px-3 !py-0 text-center whitespace-nowrap" style={{ height: ALTURA_DOS_MESES }} title="A média dos doze meses (a soma ÷ 12)">
                  Média
                </th>
                {pode ? <th rowSpan={2} className="px-2 py-2" aria-label="Ações" /> : null}
              </tr>
              <tr className="border-b border-gray-300 text-xs font-bold text-gray-900">
                {comReferencia ? (
                  <th className="border-l border-gray-300 px-2 py-1.5 text-right whitespace-nowrap" title="Colaboradores">
                    Colab.
                  </th>
                ) : null}
                {meses.map((m) => (
                  <SubCabecalhos key={m.mes} />
                ))}
                <SubCabecalhosDoAno campos={CAMPOS_DO_TOTAL} />
                <SubCabecalhosDoAno campos={CAMPOS_DA_MEDIA} />
              </tr>
            </>
          }
          corpo={
            <>
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
                  {/* Na edição (20/11/2026, pedido do Adão), clicar na Unidade, no Tipo, na Função ou no Centro de Custo abre o modal
                      Editar Linha do Quadro de Lotação, o mesmo do menu Ações. */}
                  {DESCRICAO.map((d, i) => {
                    const texto = d.chave === "vinculo" ? rotuloDoTipo(l.vinculo) : String(l[d.chave]);
                    const dica = d.chave === "centro" ? `${l.centro}${l.grupo ? ` · grupo ${l.grupo}` : " · fora dos grupos do cenário"}` : texto;
                    return (
                      <td
                        key={d.chave}
                        className={`${classeFixa} truncate px-3 py-1 ${pode ? "cursor-pointer hover:!bg-gray-100" : ""}`}
                        style={{ left: esquerdas[i] }}
                        title={pode ? `${dica} · clique para editar a linha` : dica}
                        onClick={pode ? () => setDialogo({ linha: l }) : undefined}
                      >
                        {d.chave === "centro" && !l.grupo ? <span className="text-red-700">{l.centro}</span> : texto}
                      </td>
                    );
                  })}
                  {comReferencia ? (
                    <td className="border-l border-gray-300 bg-gray-50 px-2 py-1 text-right whitespace-nowrap text-gray-700" title={l.referencia === null ? "A linha não está na referência" : undefined}>
                      {l.referencia === null ? "—" : numero(l.referencia)}
                    </td>
                  ) : null}
                  {meses.map((m) => {
                    const e = efetivo(l, m.mes - 1);
                    return (
                      <CelulasDoMes
                        key={m.mes}
                        linha={l}
                        mes={m.mes}
                        editavel={pode}
                        marcada={pode && marcadas.has(l.id) && mesesMarcados.has(m.mes)}
                        onEditar={(campo) => setValor({ linha: l, mes: m.mes, campo })}
                        salarioTotal={total(e)}
                      />
                    );
                  })}
                  <CelulasDoAno soma={somaDoAno([l])} meses={meses.length} />
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
                  <td colSpan={larguras.length} className="px-4 py-6 text-center text-sm text-gray-500">
                    {dados.linhas.length ? "Nenhuma linha com essa busca." : pode ? "Nenhuma linha: inclua as linhas em Nova Entrada ou importe a aba Quadro de Lotação em Importar Valores." : "Nenhuma linha no Quadro de Lotação deste cenário."}
                  </td>
                </tr>
              ) : (
                // O total, na última linha: os colaboradores e a folha de cada mês, do Total e da Média.
                <tr className="border-t border-gray-300 bg-gray-50 font-bold text-gray-900">
                  {pode ? <td className={`${classeFixa} bg-gray-50`} style={{ left: 0 }} /> : null}
                  <td colSpan={DESCRICAO.length} className={`${classeFixa} bg-gray-50 px-3 py-2`} style={{ left: pode ? 36 : 0 }}>
                    Total
                  </td>
                  {comReferencia ? (
                    <td className="border-l border-gray-300 bg-gray-50 px-2 py-2 text-right whitespace-nowrap">{numero(linhas.reduce((s, l) => s + (l.referencia ?? 0), 0))}</td>
                  ) : null}
                  {meses.map((m) => {
                    const k = m.mes - 1;
                    const colaboradores = linhas.reduce((s, l) => s + efetivo(l, k).colaboradores, 0);
                    const folha = linhas.reduce((s, l) => s + total(efetivo(l, k)), 0);
                    return [
                      <td key={`${m.mes}c`} className="border-l border-gray-300 px-3 py-2 text-right">
                        {numero(colaboradores)}
                      </td>,
                      <td key={`${m.mes}b`} />,
                      <td key={`${m.mes}a`} />,
                      <td key={`${m.mes}t`} className="px-3 py-2 text-right whitespace-nowrap" title="A folha do mês: a soma do Salário Total das linhas">
                        {reais(folha)}
                      </td>,
                    ];
                  })}
                  <CelulasDoAno soma={somaDoAno(linhas)} meses={meses.length} noTotal />
                  {pode ? <td /> : null}
                </tr>
              )}
            </>
          }
        />
      </div>
      {valor ? (
        // O mesmo modal Editar Valor das demais abas (16/11/2026): o Valor Atual, o reajuste, o Valor Recalculado e a chave de
        // replicar aos meses seguintes.
        <ValorDialog
          conta={`${valor.linha.funcao} · ${valor.linha.centro} (${rotuloDoTipo(valor.linha.vinculo)}, ${valor.linha.unidade}) · ${CAMPOS.find((c) => c.campo === valor.campo)!.dica}`}
          rotuloMes={meses[valor.mes - 1].rotulo}
          mesesSeguintes={meses.slice(valor.mes).map((m) => m.rotulo)}
          atual={valor.linha.meses[valor.mes - 1][valor.campo]}
          gravando={gravar.isPending}
          erro={gravar.isError ? mensagemDeErro(gravar.error, "Não foi possível gravar o Quadro de Lotação.") : null}
          onGravar={(v, replicar, r) =>
            gravar.mutate({
              alteracoes: meses.slice(valor.mes - 1, replicar ? meses.length : valor.mes).map((m) => ({ linha: valor.linha.id, mes: m.mes, campo: valor.campo, valor: v })),
              origem: { tipo: "VALOR", modo: r ? r.modo : "DIGITADO", reajuste: r ? r.valor : null, replicado: replicar },
            })
          }
          onFechar={() => {
            setValor(null);
            gravar.reset();
          }}
        />
      ) : null}
      {dialogo ? <LinhaDoQuadroDialog id={id} dados={dados} linha={dialogo.linha} onFechar={() => setDialogo(null)} /> : null}
      {excluindo ? (
        <ExcluirLinhasDialog
          id={id}
          linhas={excluindo}
          onFechar={(excluiu) => {
            // A linha excluída sai da marcação; as outras continuam marcadas.
            if (excluiu)
              setMarcadas((s) => {
                const n = new Set(s);
                for (const l of excluindo) n.delete(l.id);
                return n;
              });
            setExcluindo(null);
          }}
        />
      ) : null}
      {replicando ? (
        <ConfirmacaoDialog
          titulo="Replicar Referências"
          descricao={`Quadro de Lotação. Os Colaboradores da referência (${dados.referencia?.rotulo ?? ""}) de cada linha marcada vão para os meses marcados: ${dasReferencias.length} ${plural(dasReferencias.length, "valor", "valores")}. Os salários não têm referência e ficam como estão.`}
          acao="Replicar"
          acaoPendente="Replicando…"
          destrutiva={false}
          pendente={gravar.isPending}
          onConfirmar={() => gravar.mutate({ alteracoes: dasReferencias, origem: { tipo: "MARCADOS", modo: "REFERENCIA", reajuste: null, replicado: false } })}
          onFechar={() => {
            setReplicando(false);
            gravar.reset();
          }}
        >
          {semReferencia ? (
            <p className="text-sm text-gray-600">
              {semReferencia} {plural(semReferencia, "linha marcada não tem", "linhas marcadas não têm")} a referência e {plural(semReferencia, "fica", "ficam")} como{" "}
              {plural(semReferencia, "está", "estão")}.
            </p>
          ) : null}
          {gravar.isError ? <p className="text-sm text-red-700">{mensagemDeErro(gravar.error, "Não foi possível gravar o Quadro de Lotação.")}</p> : null}
        </ConfirmacaoDialog>
      ) : null}
    </section>
  );
}

/** Os rótulos das quatro colunas do Total ou da Média (19/11/2026). */
function SubCabecalhosDoAno({ campos }: { campos: typeof CAMPOS_DO_TOTAL }) {
  return (
    <>
      {campos.map((c, i) => (
        <th key={c.campo} className={`px-2 py-1.5 text-right whitespace-nowrap ${i === 0 ? "border-l border-gray-300" : ""}`} style={{ width: c.largura }} title={c.dica}>
          {c.rotulo}
        </th>
      ))}
    </>
  );
}

/**
 * As células do Total e da Média de uma linha (ou, `noTotal`, da linha Total: como nos meses, só os colaboradores e o Salário
 * Total): os colaboradores, a média do ano nas duas; os valores, a soma no Total e a soma ÷ 12 na Média.
 */
function CelulasDoAno({ soma, meses, noTotal = false }: { soma: SomaDoAno; meses: number; noTotal?: boolean }) {
  const colaboradores = soma.colaboradores / meses;
  const celula = (chave: string, texto: string, borda = false) => (
    <td key={chave} className={`bg-gray-50 px-2 ${noTotal ? "py-2" : "py-1"} text-right whitespace-nowrap ${borda ? "border-l border-gray-300" : ""}`}>
      {texto}
    </td>
  );
  const valor = (v: number) => (v ? reais(v) : "");
  return (
    <>
      {celula("tc", colaboradores ? numero(colaboradores, 1) : "", true)}
      {celula("tb", noTotal ? "" : valor(soma.salarioBruto))}
      {celula("ta", noTotal ? "" : valor(soma.adicional))}
      {celula("tt", valor(soma.salarioTotal))}
      {celula("mc", colaboradores ? numero(colaboradores, 1) : "", true)}
      {celula("mb", noTotal ? "" : valor(soma.salarioBruto / meses))}
      {celula("ma", noTotal ? "" : valor(soma.adicional / meses))}
      {celula("mt", valor(soma.salarioTotal / meses))}
    </>
  );
}

/** Os rótulos das quatro colunas de um mês. */
function SubCabecalhos() {
  return (
    <>
      {CAMPOS.map((c, i) => (
        <th key={c.campo} className={`px-2 py-1.5 text-right whitespace-nowrap ${i === 0 ? "border-l border-gray-300" : ""}`} style={{ width: c.largura }} title={c.dica}>
          {c.rotulo}
        </th>
      ))}
      <th className="px-2 py-1.5 text-right whitespace-nowrap" style={{ width: LARGURA_TOTAL }} title="Salário Total (R$): Salário Bruto + Insalubridade / Periculosidade da linha (todos os colaboradores dela)">
        Salário Total
      </th>
    </>
  );
}

/**
 * As quatro células de um mês de uma linha: os três valores e o Salário Total. Na edição, clicar num valor abre o modal Editar
 * Valor (como nas tabelas das outras abas); o Salário Total é calculado.
 */
function CelulasDoMes({
  linha,
  mes,
  editavel,
  marcada,
  onEditar,
  salarioTotal,
}: {
  linha: LinhaDoQuadroDoCenario;
  mes: number;
  editavel: boolean;
  /** A linha e o mês marcados: os Colaboradores (o que o Replicar Referências muda) ficam contornados. */
  marcada: boolean;
  onEditar: (campo: CampoDoMes) => void;
  salarioTotal: number;
}) {
  return (
    <>
      {CAMPOS.map((c, i) => {
        const valor = linha.meses[mes - 1][c.campo];
        return (
          <td
            key={c.campo}
            className={`px-2 py-1 text-right whitespace-nowrap ${i === 0 ? "border-l border-gray-300" : ""} ${editavel ? "cursor-pointer hover:bg-gray-100" : ""} ${marcada && i === 0 ? "outline outline-1 -outline-offset-1 outline-gray-900" : ""}`}
            title={editavel ? (valor ? "Editar o valor" : "Em branco; clique para editar") : undefined}
            onClick={editavel ? () => onEditar(c.campo) : undefined}
          >
            {valor ? numero(valor) : ""}
          </td>
        );
      })}
      <td className="px-2 py-1 text-right whitespace-nowrap text-gray-600">{salarioTotal ? reais(salarioTotal) : ""}</td>
    </>
  );
}

/**
 * A Nova Entrada e o Editar Linha do Quadro de Lotação: a Unidade, o Tipo, a Função e o Centro de Custo (dos
 * grupos do cenário); na nova, os Colaboradores, o Salário Bruto e a Insalubridade / Periculosidade da linha, a partir
 * do mês escolhido (os meses se editam depois na tabela).
 */
function LinhaDoQuadroDialog({ id, dados, linha, onFechar }: { id: string; dados: Dados; linha: LinhaDoQuadroDoCenario | null; onFechar: () => void }) {
  const queryClient = useQueryClient();
  const [unidade, setUnidade] = useState(linha?.unidadeNegocioId ?? dados.opcoes.unidades[0]?.id ?? "");
  const [vinculo, setVinculo] = useState<TipoDoColaborador>(linha?.vinculo ?? "CLT");
  const [funcao, setFuncao] = useState(linha?.funcaoId ?? "");
  const [centro, setCentro] = useState(linha?.centroCustoId ?? "");
  const [colaboradores, setColaboradores] = useState("1");
  const [bruto, setBruto] = useState("");
  const [adicional, setAdicional] = useState("");
  const [inicio, setInicio] = useState(1);
  const n = { colaboradores: lerNumero(colaboradores), bruto: lerNumero(bruto), adicional: lerNumero(adicional) };
  const numeroValido = (v: number | null | undefined) => v === null || (typeof v === "number" && v >= 0);
  const valido = !!unidade && !!funcao && !!centro && (linha !== null || (numeroValido(n.colaboradores) && numeroValido(n.bruto) && numeroValido(n.adicional)));
  // As opções: as ativas e, na edição, a que a linha já tem (mesmo inativa).
  const comAtual = <T extends { id: string; nome: string }>(xs: T[], atualId: string | undefined, atualNome: string | undefined) =>
    atualId && !xs.some((x) => x.id === atualId) ? [...xs, { id: atualId, nome: `${atualNome} (inativo)` } as T] : xs;
  const centros = [...comAtual(dados.opcoes.centros, linha?.centroCustoId, linha?.centro)].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const gravar = useMutation({
    mutationFn: () => {
      const base = { unidadeNegocioId: unidade, vinculo, funcaoId: funcao, centroCustoId: centro };
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
              : "Como no Lançamento Inicial: a unidade, o tipo, a função e o centro de custo; e os colaboradores e os salários da linha (os de todos os colaboradores dela) a partir do mês escolhido (os meses se editam depois na tabela)."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {select("Unidade", "ql-unidade", unidade, setUnidade, comAtual(dados.opcoes.unidades, linha?.unidadeNegocioId, linha?.unidade), false)}
          <div className="space-y-1.5">
            <Label htmlFor="ql-tipo">Tipo</Label>
            <select id="ql-tipo" value={vinculo} onChange={(e) => setVinculo(e.target.value as TipoDoColaborador)} className={classeSelect}>
              {TIPOS_DO_COLABORADOR.map((x) => (
                <option key={x} value={x}>
                  {ROTULO_DO_TIPO[x]}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">{select("Função", "ql-funcao", funcao, setFuncao, comAtual(dados.opcoes.funcoes, linha?.funcaoId, linha?.funcao))}</div>
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
                Salário Total da linha (todos os colaboradores): <span className="font-bold text-gray-900">R$ {reais(salarioTotal)}</span>
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
            {l.funcao} · {l.centro} ({rotuloDoTipo(l.vinculo)})
          </li>
        ))}
      </ul>
    </ConfirmacaoDialog>
  );
}
