"use client";

import { useMemo, useState } from "react";
import { Delete, Eraser, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { Opcao, ValoresDaMetodologia } from "../services/edicaoService";

/**
 * O montador da fórmula de um indicador (Estrutura dos Indicadores, 11/10/2026): a fórmula aparece por extenso, item a
 * item, e se monta inserindo itens (linhas da DRE por unidade, totalizadores das Listas, indicadores do Comercial e do
 * Administrativo, metas do orçamento), operadores (+ − × ÷), parênteses e números. Grava o texto da fórmula, com os
 * itens entre colchetes ([DRE|1|CPP…]). Os tipos de item são os que as opções trazem: na Metodologia do Painel de Bordo
 * (17/10/2026), só os indicadores ([INDICADOR|nome]); na dos indicadores, todos (desde 23/10/2026, também outros
 * indicadores do cadastro). Nos itens com a marca ACUMULAVEL (23/10/2026: as metas e os indicadores, na Metodologia dos
 * indicadores), o Período escolhe o valor do mês ou o acumulado de janeiro até o mês ([META|nome|ACUM]).
 */

// O "Comercial e Administrativo" ([IND]) saiu da lista em 06/11/2026 (os indicadores-base ficam sem itens: o valor registrado
// com o nome deles; os demais usam o Indicador); os itens já gravados continuam aparecendo pelo nome. O Quadro de Lotação e os
// Movimentos do QL (a Gestão de Colaboradores) entraram logo abaixo do Indicador.
const TIPOS = [
  { valor: "DRE", rotulo: "Linha da DRE" },
  { valor: "LISTA", rotulo: "Totalizador das Listas" },
  { valor: "META", rotulo: "Meta do Orçamento" },
  { valor: "INDICADOR", rotulo: "Indicador" },
  { valor: "QL", rotulo: "Quadro de Lotação" },
  { valor: "MQL", rotulo: "Movimentos do QL" },
  // O valor registrado no mês com o nome do indicador (09/11/2026): o item dos indicadores sem processo de coleta ainda.
  { valor: "REGISTRADO", rotulo: "Valor Registrado" },
];
// O Quadro de Lotação (09/11/2026): por Departamento, com a Atribuição, ou por Centro de Custo.
const NIVEIS_DO_QUADRO = [
  { valor: "QL_DEP", rotulo: "Departamento" },
  { valor: "QL_CC", rotulo: "Centro de Custo" },
];
const ATRIBUICOES = [
  { valor: "GERAL", rotulo: "Geral" },
  { valor: "DIRETA", rotulo: "Direto" },
  { valor: "INDIRETA", rotulo: "Indireto" },
];
const VISOES = [
  { valor: "0", rotulo: "Consolidado" },
  { valor: "1", rotulo: "Matriz" },
  { valor: "2", rotulo: "Filial" },
  { valor: "3", rotulo: "Serviços" },
  { valor: "4", rotulo: "Despesas e Extra" },
  { valor: "5", rotulo: "RN" },
];
const PERIODOS = [
  { valor: "MES", rotulo: "No Mês" },
  { valor: "ACUM", rotulo: "Acumulado no Ano" },
];
const OPERADORES: Array<{ valor: string; rotulo: string; dica: string }> = [
  { valor: "+", rotulo: "+", dica: "Somar" },
  { valor: "-", rotulo: "−", dica: "Subtrair" },
  { valor: "*", rotulo: "×", dica: "Multiplicar" },
  { valor: "/", rotulo: "÷", dica: "Dividir" },
  { valor: "(", rotulo: "(", dica: "Abrir parêntese" },
  { valor: ")", rotulo: ")", dica: "Fechar parêntese" },
];

const numero2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** O valor acumulado do item (11/11/2026): #.##0,00 ou, nos indicadores e metas em %, 0,00%. */
export const formatarValorDoItem = (v: number, percentual: boolean) => (percentual ? `${numero2.format(v * 100)}%` : numero2.format(v));

/** Os pedaços da fórmula: itens entre colchetes, números, operadores e parênteses. */
const pedacos = (formula: string) => formula.match(/\[[^\]]*\]|\d+(?:[.,]\d+)?|[-+*/()]/g) ?? [];

const classeSelect = "h-9 rounded-sm border border-gray-300 bg-white px-2 text-sm";

export function EditorFormula({
  valor,
  onMuda,
  opcoes,
  travado,
  id,
  valores,
}: {
  valor: string;
  onMuda: (v: string) => void;
  opcoes: Opcao[];
  travado?: boolean;
  id?: string;
  /** Os valores acumulados dos itens (11/11/2026: os cards do Painel de Bordo e os indicadores), ao lado de cada um na lista. */
  valores?: ValoresDaMetodologia;
}) {
  // Os tipos que as opções trazem, na ordem de TIPOS.
  const tipos = useMemo(() => TIPOS.filter((t) => opcoes.some((o) => o.grupos?.includes(t.valor))), [opcoes]);
  const [tipo, setTipo] = useState(() => tipos[0]?.valor ?? "DRE");
  const [visao, setVisao] = useState("0");
  const [periodo, setPeriodo] = useState("MES");
  const [nivel, setNivel] = useState("QL_DEP");
  const [atribuicao, setAtribuicao] = useState("GERAL");
  const [busca, setBusca] = useState("");
  const [item, setItem] = useState("");
  const [numero, setNumero] = useState("");
  const lista = pedacos(valor);
  const rotulos = useMemo(() => new Map(opcoes.map((o) => [o.valor, o.rotulo])), [opcoes]);
  // O tipo aceita o Acumulado no Ano (as opções dele trazem a marca ACUMULAVEL).
  const acumulavel = useMemo(() => opcoes.some((o) => o.grupos?.includes(tipo) && o.grupos.includes("ACUMULAVEL")), [opcoes, tipo]);
  const doTipo = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return opcoes.filter((o) => o.grupos?.includes(tipo) && (tipo !== "QL" || o.grupos.includes(nivel)) && (!t || o.rotulo.toLowerCase().includes(t)));
  }, [opcoes, tipo, busca, nivel]);

  /** O pedaço como a tela mostra: o item pelo nome (a linha da DRE com a visão), os operadores como × e ÷. */
  const mostrar = (p: string) => {
    if (!p.startsWith("[")) return OPERADORES.find((o) => o.valor === p)?.rotulo ?? p.replace(".", ",");
    const partes = p.slice(1, -1).split("|");
    if (partes[0] === "DRE") return `${rotulos.get(`DRE|${partes[2]}`) ?? partes[2]} (${VISOES.find((v) => v.valor === partes[1])?.rotulo ?? partes[1]})`;
    // O indicador pelo nome (a opção traz o grupo antes: "Produção › …").
    const noAno = partes[2] === "ACUM" ? " (Acumulado no Ano)" : "";
    if (partes[0] === "INDICADOR") return `${partes[1]}${noAno}`;
    // O Quadro de Lotação (o total ou um departamento) e os Movimentos do QL (06/11/2026).
    if (partes[0] === "QL") {
      // [QL|DEP|departamento|atribuição] ou [QL|CC|centro]; o [QL|TOTAL] antigo é o Total Geral.
      if (partes[1] === "DEP") {
        const departamento = rotulos.get(`QL|DEP|${partes[2]}`) ?? partes[2];
        return partes[2] === "TOTAL" && partes[3] === "GERAL"
          ? `Quadro de Lotação: ${departamento}`
          : `Quadro de Lotação: ${departamento} (${ATRIBUICOES.find((a) => a.valor === partes[3])?.rotulo ?? partes[3]})`;
      }
      if (partes[1] === "CC") return `Quadro de Lotação: Centro ${rotulos.get(`QL|CC|${partes[2]}`) ?? partes[2]}`;
      return `Quadro de Lotação: ${partes.slice(1).join(" ")}`;
    }
    if (partes[0] === "MQL") return `Movimentos do QL: ${rotulos.get(`MQL|${partes[1]}`) ?? partes[1]}`;
    if (partes[0] === "REGISTRADO") return rotulos.get("REGISTRADO|") ?? "Valor registrado no mês";
    const r = rotulos.get(`${partes[0]}|${partes[1]}`) ?? partes[1];
    return partes[0] === "META" ? `Meta: ${r}${noAno}` : partes[0] === "LISTA" ? `${r} [Listas]` : r;
  };
  // O valor acumulado da opção (11/11/2026), pela chave do item que ela insere: a linha da DRE com a unidade escolhida e o
  // departamento do Quadro de Lotação com a atribuição; o Valor Registrado é o do próprio indicador, sem valor aqui.
  const percentuais = useMemo(() => new Set(valores?.percentuais ?? []), [valores]);
  const valorDaOpcao = (o: Opcao) => {
    if (!valores?.competencia) return "";
    const [t, chave] = [o.valor.slice(0, o.valor.indexOf("|")), o.valor.slice(o.valor.indexOf("|") + 1)];
    const k = t === "DRE" ? `DRE|${visao}|${chave}` : t === "QL" && chave.startsWith("DEP|") ? `QL|${chave}|${atribuicao}` : o.valor;
    const v = valores.valores[k];
    return v === undefined || v === null ? (k in valores.valores ? " · —" : "") : ` · ${formatarValorDoItem(v, percentuais.has(k))}`;
  };
  const inserir = (p: string) => onMuda([...lista, p].join(" "));
  const inserirItem = () => {
    if (!item) return;
    const [t, chave] = [item.slice(0, item.indexOf("|")), item.slice(item.indexOf("|") + 1)];
    inserir(
      t === "DRE"
        ? `[DRE|${visao}|${chave}]`
        : t === "REGISTRADO"
          ? "[REGISTRADO]"
          : t === "QL" && chave.startsWith("DEP|")
            ? `[QL|${chave}|${atribuicao}]`
            : acumulavel && periodo === "ACUM"
              ? `[${t}|${chave}|ACUM]`
              : `[${t}|${chave}]`,
    );
    setItem("");
  };

  return (
    <div className="space-y-2" id={id}>
      {/* A fórmula por extenso, item a item. */}
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-sm border border-gray-300 bg-white px-2 py-1.5">
        {lista.length === 0 ? (
          <span className="text-sm text-gray-400">{travado ? "—" : "Monte a fórmula com os itens e os operadores abaixo."}</span>
        ) : (
          lista.map((p, k) =>
            p.startsWith("[") ? (
              <span key={k} className="rounded-sm border border-gray-200 bg-yellow-50 px-1.5 py-0.5 text-xs text-gray-900">
                {mostrar(p)}
              </span>
            ) : (
              <span key={k} className="px-0.5 text-sm font-bold text-gray-900">
                {mostrar(p)}
              </span>
            ),
          )
        )}
      </div>
      {travado ? null : (
        <>
          {/* O item a inserir: o tipo, a unidade (nas linhas da DRE), a busca e o item. */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Com um tipo só (os indicadores, no Painel de Bordo), a escolha do tipo sai. */}
            {tipos.length > 1 ? (
              <select
                aria-label="Tipo do item"
                value={tipo}
                onChange={(e) => {
                  setTipo(e.target.value);
                  setItem("");
                }}
                className={classeSelect}
              >
                {tipos.map((t) => (
                  <option key={t.valor} value={t.valor}>
                    {t.rotulo}
                  </option>
                ))}
              </select>
            ) : null}
            {tipo === "DRE" ? (
              <select aria-label="Unidade da linha da DRE" value={visao} onChange={(e) => setVisao(e.target.value)} className={classeSelect}>
                {VISOES.map((v) => (
                  <option key={v.valor} value={v.valor}>
                    {v.rotulo}
                  </option>
                ))}
              </select>
            ) : null}
            {/* O Quadro de Lotação (09/11/2026): o nível (Departamento ou Centro de Custo) e, nos departamentos, a atribuição. */}
            {tipo === "QL" ? (
              <select
                aria-label="Nível do Quadro de Lotação"
                value={nivel}
                onChange={(e) => {
                  setNivel(e.target.value);
                  setItem("");
                }}
                className={classeSelect}
              >
                {NIVEIS_DO_QUADRO.map((n) => (
                  <option key={n.valor} value={n.valor}>
                    {n.rotulo}
                  </option>
                ))}
              </select>
            ) : null}
            {tipo === "QL" && nivel === "QL_DEP" ? (
              <select aria-label="Atribuição" value={atribuicao} onChange={(e) => setAtribuicao(e.target.value)} className={classeSelect}>
                {ATRIBUICOES.map((a) => (
                  <option key={a.valor} value={a.valor}>
                    {a.rotulo}
                  </option>
                ))}
              </select>
            ) : null}
            {acumulavel ? (
              <select aria-label="Período do item" value={periodo} onChange={(e) => setPeriodo(e.target.value)} className={classeSelect}>
                {PERIODOS.map((p) => (
                  <option key={p.valor} value={p.valor}>
                    {p.rotulo}
                  </option>
                ))}
              </select>
            ) : null}
            {/* A busca ocupa o resto da linha, até a lateral do modal (20/10/2026). */}
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar item…" className="h-9 min-w-40 flex-1 rounded-sm" aria-label="Buscar item" />
          </div>
          <div className="flex items-center gap-2">
            <select aria-label="Item" value={item} onChange={(e) => setItem(e.target.value)} className={`${classeSelect} min-w-0 flex-1`}>
              <option value="">{doTipo.length ? `Escolha o item (${doTipo.length})…` : "Nenhum item com essa busca"}</option>
              {doTipo.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.rotulo}
                  {valorDaOpcao(o)}
                </option>
              ))}
            </select>
            <Button type="button" variant="outline" className="rounded-sm" disabled={!item} onClick={inserirItem}>
              <Plus className="size-4" />
              Inserir Item
            </Button>
          </div>
          {valores?.competencia ? (
            <p className="text-xs text-gray-500">
              Ao lado de cada item, o valor acumulado de janeiro até {valores.competencia} (a competência fechada mais recente em Resultados Empresariais)
              {tipo === "QL" ? "; no Quadro de Lotação, a posição do mês" : ""}.
            </p>
          ) : null}
          {/* Os operadores, os números e a correção; Apagar e Limpar na linha do Inserir (20/10/2026: nomes curtos para caberem). */}
          <div className="flex flex-wrap items-center gap-1.5">
            {OPERADORES.map((o) => (
              <Button key={o.valor} type="button" variant="outline" className="h-9 w-9 rounded-sm px-0 text-base font-bold" title={o.dica} onClick={() => inserir(o.valor)}>
                {o.rotulo}
              </Button>
            ))}
            <Input
              value={numero}
              onChange={(e) => setNumero(e.target.value.replace(/[^0-9.,]/g, ""))}
              placeholder="Número"
              inputMode="decimal"
              className="h-9 w-20 min-w-20 flex-1 rounded-sm"
              aria-label="Número"
            />
            <Button
              type="button"
              variant="outline"
              className="rounded-sm"
              disabled={!/^\d+([.,]\d+)?$/.test(numero)}
              onClick={() => {
                inserir(numero.replace(",", "."));
                setNumero("");
              }}
            >
              Inserir
            </Button>
            <Button type="button" variant="outline" className="rounded-sm" disabled={lista.length === 0} onClick={() => onMuda(lista.slice(0, -1).join(" "))} title="Apagar o último pedaço da fórmula">
              <Delete className="size-4" />
              Apagar
            </Button>
            <Button type="button" variant="outline" className="rounded-sm" disabled={lista.length === 0} onClick={() => onMuda("")} title="Apagar a fórmula inteira">
              <Eraser className="size-4" />
              Limpar
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
