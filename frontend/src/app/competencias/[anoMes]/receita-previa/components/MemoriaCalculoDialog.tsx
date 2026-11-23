"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Abas } from "@/components/shared/Abas";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Carregando } from "@/components/shared/Estados";
import { SemResultado, useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import type { Coluna } from "@/lib/filtrosDeTabela";

import { inteiro } from "../../utils/formatacao";
import { plural } from "@/lib/texto";
import {
  GRUPOS_ORIGEM,
  receitaPreviaService,
  ROTULO_CRITERIO,
  ROTULO_NATUREZA,
  ROTULO_UNIDADE,
  ROTULO_VENDA,
  type ItemReceita,
  type Natureza,
} from "../services/receitaPreviaService";

type Props = {
  anoMes: string;
  unidade: number;
  natureza: Natureza;
  /**
   * Aberto pela linha Variação do Estoque: só os itens que a movimentam (as
   * estacas produzidas e expedidas), com a variação e sem as receitas. Sem ele,
   * o extrato das receitas, sem a variação e sem os itens que só movem o estoque.
   */
  variacao?: boolean;
  /** Aberto pelo extrato de uma obra (a aba Obras, 03/11/2026): o número da obra, e só os itens dela. */
  obra?: string;
  onFechar: () => void;
};

/** O número da obra, sem a letra nem os zeros à esquerda (G887305, 1.98.00887305 → 887305), como no servidor. */
const numeroDaObra = (codigo: string | null) => (codigo ?? "").split(".").pop()!.replace(/\D/g, "").replace(/^0+/, "");

const zero = (v: string | null) => v === null || Number(v) === 0;
/**
 * O item entra no extrato aberto: o da variação só com variação; o das
 * receitas sem os que só movem o estoque e sem as devoluções de ROB zerada.
 */
const doExtrato = (i: ItemReceita, variacao: boolean) =>
  variacao
    ? !zero(i.variacaoEstoque)
    : !(zero(i.receitaBruta) && zero(i.receitaLiquida) && !zero(i.variacaoEstoque)) && !(i.origem === "DEVOLUCAO" && zero(i.receitaBruta));

/**
 * Uma linha do extrato: os itens da mesma obra somados, com a chave da aba de
 * receita do BASE PRÉVIAS de onde a origem vem.
 */
type LinhaExtrato = {
  chave: string;
  obra: string | null;
  obraNome: string | null;
  linha: string | null;
  detalhe: string | null;
  detalheDescricao: string | null;
  venda: ItemReceita["venda"];
  criterio: string;
  observacao: string | null;
  /** Preço médio, ponderado pelo volume, dos itens que têm preço. */
  precoBruto: number | null;
  precoLiquido: number | null;
  quantidade: number | null;
  receitaBruta: number;
  receitaLiquida: number;
  variacaoEstoque: number;
  registros: number;
  pesoBruto: number;
  pesoLiquido: number;
  somaBruto: number;
  somaLiquido: number;
};

/**
 * Como cada aba de receita agrupa as linhas:
 *  - Receita (Produção) e (Expedição): obra e linha, também nas estacas (a
 *    peça só separa a movimentação da variação do estoque);
 *  - Receita (Saídas) e (Devoluções): projeto, linha e movimento;
 *  - Receita (Serviços) e (Lanç. Manuais): uma linha por medição ou
 *    lançamento, como na planilha (somar medições somaria os andamentos).
 * O critério entra na chave para não somar o que foi valorado de jeitos
 * diferentes; os preços saem como média ponderada pelo volume.
 */
function agrupar(itens: ItemReceita[], origem: string): LinhaExtrato[] {
  const m = new Map<string, LinhaExtrato>();
  for (const i of itens) {
    const chave =
      origem === "LANCAMENTO" || origem === "MEDICAO"
        ? i.id
        : origem === "PRODUCAO" || origem === "EXPEDICAO"
          ? [i.obra, i.linha, i.venda, ROTULO_CRITERIO[i.criterio] ?? i.criterio, i.observacao].map((x) => x ?? "").join("|")
          : [i.obra, i.linha, i.detalhe, i.venda, i.observacao].map((x) => x ?? "").join("|");
    const l =
      m.get(chave) ??
      ({
        chave,
        obra: i.obra,
        obraNome: i.obraNome,
        linha: i.linha,
        detalhe: i.detalhe,
        detalheDescricao: i.detalheDescricao,
        venda: i.venda,
        criterio: i.criterio,
        observacao: i.observacao,
        precoBruto: null,
        precoLiquido: null,
        quantidade: null,
        receitaBruta: 0,
        receitaLiquida: 0,
        variacaoEstoque: 0,
        registros: 0,
        pesoBruto: 0,
        pesoLiquido: 0,
        somaBruto: 0,
        somaLiquido: 0,
      } satisfies LinhaExtrato);
    if (i.quantidade !== null) l.quantidade = (l.quantidade ?? 0) + Number(i.quantidade);
    l.receitaBruta += Number(i.receitaBruta);
    l.receitaLiquida += Number(i.receitaLiquida);
    l.variacaoEstoque += Number(i.variacaoEstoque);
    l.registros++;
    const q = Number(i.quantidade ?? 0);
    if (i.precoBruto !== null) {
      l.somaBruto += Number(i.precoBruto) * q;
      l.pesoBruto += q;
      l.precoBruto = l.pesoBruto ? l.somaBruto / l.pesoBruto : Number(i.precoBruto);
    }
    if (i.precoLiquido !== null) {
      l.somaLiquido += Number(i.precoLiquido) * q;
      l.pesoLiquido += q;
      l.precoLiquido = l.pesoLiquido ? l.somaLiquido / l.pesoLiquido : Number(i.precoLiquido);
    }
    m.set(chave, l);
  }
  return [...m.values()];
}

const ROTULO_DETALHE: Record<string, string> = {
  SAIDA: "Movimento",
  DEVOLUCAO: "Movimento",
  MEDICAO: "Tipo de Faturamento",
};
const ROTULO_REGISTROS: Record<string, string> = { SAIDA: "Notas", DEVOLUCAO: "Notas" };

const volume = (v: number | null) => (v === null ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const andamento = (v: number | null) => (v === null ? "—" : `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
/** Valores em reais sem o "R$": a unidade fica no rótulo da coluna, como na planilha ("ROB Prod. (R$)"). */
const reais = (v: number | null) => (v === null ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** Coluna de número à direita: ordena pelo valor e filtra pelo texto como aparece na célula. */
const numerica = (chave: string, rotulo: string, campo: (l: LinhaExtrato) => number | null, formato: (v: number | null) => string): Coluna<LinhaExtrato> => ({
  chave,
  rotulo,
  tipo: "numero",
  alinhamento: "direita",
  valor: (l) => campo(l),
  texto: (l) => (campo(l) === null ? null : formato(campo(l))),
});

/**
 * Memória de cálculo da linha da receita prévia, como as abas de receita do
 * BASE PRÉVIAS: uma aba por origem (Produção, Expedição, Saídas, Devoluções,
 * Serviços e Lanç. Manuais) e, em cada uma, os itens somados por obra, com
 * filtro e ordem nos rótulos das colunas.
 */
export function MemoriaCalculoDialog({ anoMes, unidade, natureza, variacao = false, obra, onFechar }: Props) {
  const { data, grupos } = useGruposDaMemoria(anoMes, unidade, natureza, variacao, obra);
  const registros = grupos.reduce((t, g) => t + g.linhas.reduce((n, l) => n + l.registros, 0), 0);

  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      {/*
        Posição em pixels inteiros: a 2rem do topo, com até 100rem de largura
        (1rem de folga em cada lado nas telas menores) e centralizado com a
        sobra arredondada, sem o translate(-50%) do diálogo padrão. Com altura
        de 90vh e largura ímpar, o modal caía em meio pixel, e a tabela, que
        rola em camada própria, tremia contra o topo fixo e os rótulos.
      */}
      <DialogContent className="top-8 left-[round(down,calc((100%_-_min(100rem,calc(100%_-_2rem)))_/_2),1px)] flex max-h-[calc(100vh-4rem)] w-[min(100rem,calc(100%_-_2rem))] max-w-none translate-x-0 translate-y-0 flex-col gap-3 overflow-hidden rounded-sm sm:max-w-none">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {ROTULO_UNIDADE[unidade]} · {variacao ? "Variação do Estoque" : ROTULO_NATUREZA[natureza]}
            {obra ? ` · Obra ${obra}` : ""}
          </DialogTitle>
          <DialogDescription>
            Memória de cálculo: {data ? inteiro(registros) : "…"} {plural(data ? registros : 0, "registro, somado", "registros, somados")} por obra como nas abas de receita do BASE PRÉVIAS. Os
            valores ficam como foram apurados, com o preço vigente na apuração.
          </DialogDescription>
        </DialogHeader>
        <MemoriaDaReceita anoMes={anoMes} unidade={unidade} natureza={natureza} variacao={variacao} obra={obra} />
      </DialogContent>
    </Dialog>
  );
}

/** Os itens da linha da receita prévia (a consulta, a mesma do modal e do extrato), agrupados por origem e por obra. */
function useGruposDaMemoria(anoMes: string, unidade: number, natureza: Natureza, variacao: boolean, obra?: string) {
  const consulta = useQuery({
    queryKey: ["receita-previa", anoMes, "itens", unidade, natureza],
    queryFn: () => receitaPreviaService.itens(anoMes, unidade, natureza),
  });
  const { data } = consulta;
  const grupos = useMemo(
    () =>
      GRUPOS_ORIGEM.map((g) => ({
        ...g,
        linhas: agrupar(
          (data?.itens ?? []).filter((i) => i.origem === g.origem && doExtrato(i, variacao) && (!obra || numeroDaObra(i.obra) === obra)),
          g.origem,
        ),
      })).filter((g) => g.linhas.length > 0),
    [data, variacao, obra],
  );
  return { ...consulta, grupos };
}

/**
 * O corpo da memória de cálculo: as abas das origens (Produção, Expedição, Saídas, Devoluções, Serviços e Lanç. Manuais, só as com
 * itens) e a tabela da escolhida. `embutida` (23/11/2026, pedido do Adão: no extrato das linhas de Receita Bruta e Líquida de Frete e
 * de Montagem de Resultados, no lugar do botão que abria a memória): a tabela com altura máxima e rolagem própria, e as abas só com
 * mais de uma origem.
 */
export function MemoriaDaReceita({
  anoMes,
  unidade,
  natureza,
  variacao = false,
  obra,
  embutida = false,
}: {
  anoMes: string;
  unidade: number;
  natureza: Natureza;
  variacao?: boolean;
  obra?: string;
  embutida?: boolean;
}) {
  const { isPending, isError, grupos } = useGruposDaMemoria(anoMes, unidade, natureza, variacao, obra);
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const ativo = grupos.find((g) => g.origem === escolhido) ?? grupos[0];
  if (isError) return <p className="text-sm text-red-700">Erro ao carregar a memória de cálculo.</p>;
  if (isPending) return <Carregando linhas={embutida ? 2 : 4} />;
  if (!ativo) return <p className="text-sm text-gray-600">Nenhum item nesta linha.</p>;
  return (
    <div className={embutida ? "space-y-2" : "flex min-h-0 flex-1 flex-col gap-3"}>
      {!embutida || grupos.length > 1 ? (
        <div className="shrink-0">
          <Abas rotulo="Origem dos itens" ativa={ativo.origem} onMudar={setEscolhido} abas={grupos.map((g) => ({ chave: g.origem, rotulo: g.rotulo }))} />
        </div>
      ) : null}
      <TabelaDoGrupo key={ativo.origem} linhas={ativo.linhas} origem={ativo.origem} unidade={unidade} variacao={variacao} embutida={embutida} />
    </div>
  );
}

/** A tabela de uma origem; trocar de aba remonta a tabela, e os filtros recomeçam. */
function TabelaDoGrupo({ linhas, origem, unidade, variacao, embutida = false }: { linhas: LinhaExtrato[]; origem: string; unidade: number; variacao: boolean; embutida?: boolean }) {
  const colunas = useMemo(() => {
    const algum = (f: (l: LinhaExtrato) => unknown) => linhas.some((l) => f(l) !== null && f(l) !== undefined && f(l) !== "");
    const valoradoPorPreco = origem === "PRODUCAO" || origem === "EXPEDICAO";
    const cs: Coluna<LinhaExtrato>[] = [];
    // A obra fica com a largura que sobra; as demais colunas, na largura do conteúdo.
    if (algum((l) => l.obra))
      cs.push({ chave: "obra", rotulo: "Obra", classe: "w-full min-w-48", valor: (l) => l.obra, texto: (l) => (l.obra ? [l.obra, l.obraNome].filter(Boolean).join(" · ") : null) });
    if (algum((l) => l.linha)) cs.push({ chave: "linha", rotulo: "Linha", valor: (l) => l.linha });
    if (ROTULO_DETALHE[origem] && algum((l) => l.detalhe)) cs.push({ chave: "detalhe", rotulo: ROTULO_DETALHE[origem], valor: (l) => l.detalhe });
    if (algum((l) => l.detalheDescricao)) cs.push({ chave: "detalheDescricao", rotulo: "Descrição do Movimento", classe: "min-w-80", valor: (l) => l.detalheDescricao });
    if (unidade !== 3) cs.push({ chave: "venda", rotulo: "Venda", valor: (l) => (l.venda ? ROTULO_VENDA[l.venda] : null) });
    if (valoradoPorPreco) cs.push({ chave: "criterio", rotulo: "Critério", classe: "w-px", valor: (l) => ROTULO_CRITERIO[l.criterio] ?? l.criterio });
    if (valoradoPorPreco && algum((l) => l.quantidade)) cs.push(numerica("quantidade", "Volume (m³)", (l) => l.quantidade, volume));
    if (origem === "MEDICAO") cs.push(numerica("quantidade", "Andamento", (l) => l.quantidade, andamento));
    if (valoradoPorPreco && algum((l) => l.precoBruto))
      cs.push(numerica("precoBruto", "Preço Bruto (R$/m³)", (l) => l.precoBruto, reais));
    if (valoradoPorPreco && algum((l) => l.precoLiquido))
      cs.push(numerica("precoLiquido", "Preço Líq. (R$/m³)", (l) => l.precoLiquido, reais));
    if (ROTULO_REGISTROS[origem]) cs.push(numerica("registros", ROTULO_REGISTROS[origem], (l) => l.registros, (v) => inteiro(v ?? 0)));
    if (variacao) cs.push(numerica("variacaoEstoque", "Var. Estoque (R$)", (l) => l.variacaoEstoque, reais));
    else {
      cs.push(numerica("receitaBruta", "ROB (R$)", (l) => l.receitaBruta, reais));
      cs.push(numerica("receitaLiquida", "ROL (R$)", (l) => l.receitaLiquida, reais));
    }
    if (origem !== "DEVOLUCAO" && algum((l) => l.observacao)) cs.push({ chave: "observacao", rotulo: "Observação", valor: (l) => l.observacao });
    return cs;
  }, [linhas, origem, unidade, variacao]);
  const tabela = useTabelaFiltravel(linhas, colunas);
  const primeiraSomada = colunas.findIndex((c) => c.chave === (variacao ? "variacaoEstoque" : "receitaBruta"));

  const celula = (c: Coluna<LinhaExtrato>, l: LinhaExtrato) => {
    switch (c.chave) {
      case "obra":
        return (
          <div title={l.obraNome ?? undefined}>
            <span className="font-medium text-gray-900">{l.obra ?? "—"}</span>
            {/* O nome não alarga a coluna: ocupa a largura que ela tiver e corta o resto. */}
            {l.obraNome ? (
              <div className="relative h-4">
                <div className="absolute inset-x-0 truncate text-xs text-gray-500">{l.obraNome}</div>
              </div>
            ) : null}
          </div>
        );
      case "criterio":
        return <span className="text-gray-700">{c.valor?.(l) ?? "—"}</span>;
      case "detalheDescricao":
        return <span className="text-gray-700">{l.detalheDescricao ?? "—"}</span>;
      case "linha":
      case "detalhe":
      case "venda":
        return <span className="whitespace-nowrap text-gray-700">{c.valor?.(l) ?? "—"}</span>;
      case "observacao":
        return (
          <div className="max-w-64 truncate text-xs text-yellow-800" title={l.observacao ?? undefined}>
            {l.observacao ?? ""}
          </div>
        );
      default:
        return <span className="text-gray-700">{c.texto?.(l) ?? "—"}</span>;
    }
  };
  const soma = (c: Coluna<LinhaExtrato>) => tabela.filtradas.reduce((a, l) => a + (Number(c.valor?.(l)) || 0), 0);

  return (
    // Só esta área rola; os rótulos da tabela ficam presos no topo dela. A área
    // ganha camada própria (will-change): com os rótulos fixos, sem ela o
    // navegador redesenha a tabela inteira a cada passo, e a tela pisca.
    <div className={`${embutida ? "max-h-96" : "min-h-0 flex-1"} overflow-auto will-change-transform`}>
      <table className={`tabela-sig w-full border-collapse ${embutida ? "text-xs" : "text-sm"}`}>
        {tabela.cabecalho}
        <tbody>
          {tabela.visiveis.length === 0 ? (
            <SemResultado colunas={colunas.length} onLimpar={tabela.limpar} />
          ) : (
            tabela.visiveis.map((l) => (
              <tr key={l.chave} className="border-b border-gray-100 align-top">
                {colunas.map((c) => (
                  <td key={c.chave} className={`px-3 py-2 ${c.alinhamento === "direita" ? "text-right whitespace-nowrap" : ""}`}>
                    {celula(c, l)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {tabela.visiveis.length > 1 ? (
          <tfoot>
            <tr className="border-t border-gray-300 bg-gray-50 font-bold text-gray-900">
              <td className="px-3 py-2" colSpan={primeiraSomada}>
                {tabela.total !== tabela.totalGeral ? `Total filtrado (${tabela.total} de ${tabela.totalGeral})` : "Total"}
              </td>
              {colunas.slice(primeiraSomada).map((c) => (
                <td key={c.chave} className="px-3 py-2 text-right whitespace-nowrap">
                  {c.alinhamento === "direita" ? reais(soma(c)) : ""}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
