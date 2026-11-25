"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Os níveis e os agrupadores das tabelas com as linhas da DRE (a DRE e a
 * Conferência com a Planilha), como o contorno do BASE REALIZADO (RESULTADOS).
 */

/** Os três níveis: totais, atribuições e contas. */
export type Nivel = 1 | 2 | 3;
export const NIVEIS: Array<{ nivel: Nivel; rotulo: string; dica: string }> = [
  { nivel: 1, rotulo: "Totais", dica: "Só os totais" },
  { nivel: 2, rotulo: "Atribuições", dica: "Os totais e as atribuições" },
  { nivel: 3, rotulo: "Contas", dica: "Todas as contas" },
];

export const nivelGuardado = (chave: string): Nivel => {
  try {
    const v = Number(window.localStorage.getItem(chave));
    return v === 1 || v === 2 || v === 3 ? v : 3;
  } catch {
    return 3;
  }
};
export const guardarNivel = (chave: string, n: Nivel) => {
  try {
    window.localStorage.setItem(chave, String(n));
  } catch {
    // Sem armazenamento (janela privada): o nível só não é lembrado.
  }
};

/** `centro` (23/11/2026, a aba Departamentos dos Resultados): a linha de um grupo de centros de custo, no lugar das atribuições. */
type Linha = { codigo: string; tipo: string; centro?: boolean };

/**
 * O nível de contorno de cada linha, como na planilha: 0 os totais, 1 as
 * atribuições (e as contas logo abaixo de um total) e 2 as contas dentro de uma
 * atribuição. Sai do código da linha: um total de duas partes ("CPP.CUSTOS_…")
 * abre o grupo; um total de três partes do mesmo grupo ("CPP.MOD.MAO_…") é
 * atribuição; a conta é nível 2 quando há atribuição com o mesmo prefixo.
 * Conferido com as seis abas Resultados em 07/10/2026: todas as linhas batem.
 */
export function estrutura(linhas: Linha[]) {
  const partes = (c: string) => c.split(".");
  const totais = new Set(linhas.filter((l) => l.tipo !== "ITEM" && partes(l.codigo).length === 2).map((l) => partes(l.codigo)[0]));
  const nivel = new Map<string, number>();
  for (const l of linhas) {
    if (l.tipo === "ITEM") continue;
    const p = partes(l.codigo);
    nivel.set(l.codigo, p.length > 2 && totais.has(p[0]) ? 1 : 0);
  }
  const atribuicoes = new Set(linhas.filter((l) => l.tipo !== "ITEM" && nivel.get(l.codigo) === 1).map((l) => partes(l.codigo).slice(0, 2).join(".")));
  for (const l of linhas) {
    if (l.tipo !== "ITEM") continue;
    const p = partes(l.codigo);
    nivel.set(l.codigo, p.length > 2 && atribuicoes.has(p.slice(0, 2).join(".")) ? 2 : 1);
  }
  // Os grupos acima de cada linha, na ordem da DRE.
  const acima = new Map<string, string[]>();
  const comFilhos = new Set<string>();
  let total: string | null = null;
  let atribuicao: string | null = null;
  for (const l of linhas) {
    const n = nivel.get(l.codigo)!;
    if (n === 0) {
      acima.set(l.codigo, []);
      total = l.codigo;
      atribuicao = null;
    } else if (n === 1) {
      acima.set(l.codigo, total ? [total] : []);
      atribuicao = l.tipo === "ITEM" ? null : l.codigo;
    } else {
      acima.set(l.codigo, [total, atribuicao].filter((x): x is string => x !== null));
    }
    for (const g of acima.get(l.codigo)!) comFilhos.add(g);
  }
  // Totais sem atribuição embaixo (só contas, como a ROB): no nível Atribuições, ficam fechados. Os com centros de custo (a aba
  // Departamentos, 23/11/2026) ficam abertos: os centros estão no lugar das atribuições.
  const comAtribuicao = new Set(linhas.filter((l) => (l.tipo !== "ITEM" && nivel.get(l.codigo) === 1) || l.centro).map((l) => acima.get(l.codigo)![0]));
  const soContas = new Set([...comFilhos].filter((c) => nivel.get(c) === 0 && !comAtribuicao.has(c)));
  return { nivel, acima, comFilhos, soContas };
}

/**
 * Os grupos fechados para mostrar a DRE até o nível escolhido. As contas (as
 * linhas sem negrito) só aparecem em Contas: em Atribuições, ficam fechados
 * também os totais que só têm contas embaixo.
 */
function fechadosAte(n: Nivel, nivel: Map<string, number>, comFilhos: Set<string>, soContas: Set<string>) {
  if (n === 3) return new Set<string>();
  if (n === 1) return new Set([...comFilhos].filter((c) => nivel.get(c) === 0));
  return new Set([...comFilhos].filter((c) => nivel.get(c) === 1 || soContas.has(c)));
}

/**
 * Os dois totais da ROL da estrutura: o primeiro (no topo) sai das tabelas quando o segundo (depois da receita bruta e
 * dos impostos) está nelas — em Resultados e nos cenários desde 21/10/2026, na DRE do Fechamento Mensal desde
 * 22/10/2026. Nas visões com um só (Despesas e Extra e RN), ele fica.
 */
const PRIMEIRO_TOTAL_DA_ROL = "RO.RECEITA_OPERACIONAL_LIQUIDA_ROL";
const TOTAL_DA_ROL = "ROL.RECEITA_OPERACIONAL_LIQUIDA_ROL";
export const semPrimeiroTotalDaRol = <L extends Linha>(linhas: L[]) =>
  linhas.some((l) => l.codigo === TOTAL_DA_ROL) ? linhas.filter((l) => l.codigo !== PRIMEIRO_TOTAL_DA_ROL) : linhas;

/**
 * As linhas de resultado da DRE (a ROL, CPV, MB, MC, DFO, EBITDA, EBIT, NOPAT, RF, DF e RL): um pouco mais escuras que
 * os demais totais, e mais claras que os rótulos (pedido de 08/10/2026), na DRE e em Resultados. A ROL é a que fica na
 * tabela: a segunda (22/10/2026), ou a primeira nas visões que só têm ela.
 */
export const LINHAS_DE_RESULTADO = new Set([
  PRIMEIRO_TOTAL_DA_ROL,
  TOTAL_DA_ROL,
  "CPV.CUSTO_DE_PRODUTO_VENDIDO_CPV",
  "MB.MARGEM_BRUTA_MB",
  "MC.MARGEM_DE_CONTRIBUICAO_MC",
  "DFO.DESPESA_FIXA_OPERACIONAL_DFO",
  "EBITDA.LUCRO_OPERACIONAL_EBITDA",
  "EBIT.MARGEM_LIQUIDA_EBIT",
  "NOPAT.LUCRO_OPERACIONAL_LIQUIDO_NOPAT",
  "NOPAT.RECEITAS_FINANCEIRAS_RF",
  "NOPAT.DESPESAS_FINANCEIRAS_DF",
  "RL.RESULTADO_LIQUIDO_RL",
]);
/**
 * O fundo da linha: os totais em yellow-100 e as linhas de resultado um tom acima (yellow-200), mais claras que os
 * rótulos (amarelo-ouro); as contas em branco (22/10/2026: um tom mais fortes; antes, yellow-50 e yellow-100).
 */
export const fundoDaLinha = (l: { codigo: string; tipo: string }) => (LINHAS_DE_RESULTADO.has(l.codigo) ? "bg-yellow-200" : l.tipo !== "ITEM" ? "bg-yellow-100" : "bg-white");

/**
 * O fundo das colunas do orçado (Resultados Empresariais, 11/10/2026): a mesma escala do amarelo, em cinza — os rótulos
 * em preto (no lugar do amarelo-ouro), as linhas de resultado num cinza mais escuro e os totais num mais claro.
 */
// A marca celula-orcado (13/10/2026): no tema Escuro, as células do orçado/comparado ficam claras, com o texto preto.
export const fundoDoOrcado = (l: { codigo: string; tipo: string }) =>
  `celula-orcado ${LINHAS_DE_RESULTADO.has(l.codigo) ? "bg-gray-300" : l.tipo !== "ITEM" ? "bg-gray-200" : "bg-white"}`;
/** O rótulo das colunas do orçado: preto, com o texto branco (no tema Escuro, claro com o texto preto; globals.css). */
export const ROTULO_DO_ORCADO = "!bg-[var(--cor-rotulo-orcado)] !text-[var(--cor-texto-rotulo-orcado)]";

/** O recuo da descrição em cada nível. */
export const RECUO = ["pl-4", "pl-9", "pl-14"];

/** As linhas que as tabelas mostram: sem as seções P e S; PRODUÇÃO E SERVIÇOS (PS) só quando há volumes. */
export function linhasDaDRE<L extends Linha>(todas: L[]) {
  const temVolume = todas.some((l) => l.tipo === "ITEM" && /^(P|S)\./.test(l.codigo));
  return todas.filter((l) => l.tipo !== "SECAO" || (l.codigo.startsWith("PS.") && temVolume));
}

/**
 * O estado dos níveis de uma tabela de linhas da DRE. As seções P e S não
 * aparecem; PRODUÇÃO E SERVIÇOS (PS) só quando há volumes, e (com eles) só em
 * Contas — ou, com `comPs` (30/10/2026, pedido do Adão), em todos os níveis (as linhas de volume são as bases dos totais):
 * "aberta" (as telas Resultados e Conferência do Fechamento Mensal) ou "recolhida" em Totais e Atribuições e aberta em
 * Contas (31/10/2026, pedido do Adão: as tabelas de Resultados Empresariais e dos Cenários); a seta dela a abre e fecha.
 * `chave` guarda o nível escolhido no navegador; com `fixo` (22/10/2026: as tabelas dos Relatórios Executivos), o nível é
 * esse, sem o do navegador.
 */
export function useNiveisDRE<L extends Linha>(todas: L[], chave: string, fixo?: Nivel, comPs?: "aberta" | "recolhida") {
  const linhas = useMemo(() => linhasDaDRE(todas), [todas]);
  const { nivel, acima, comFilhos, soContas } = useMemo(() => estrutura(linhas), [linhas]);
  const ps = linhas.find((l) => l.tipo === "SECAO")?.codigo;
  const fechadosDo = (n: Nivel) => {
    const f = fechadosAte(n, nivel, comFilhos, soContas);
    if (ps && comPs) {
      if (comPs === "recolhida" && n !== 3) f.add(ps);
      else f.delete(ps);
    }
    return f;
  };
  const [nivelGeral, setNivelGeral] = useState<Nivel>(() => fixo ?? nivelGuardado(chave));
  const [fechados, setFechados] = useState<Set<string>>(() => fechadosDo(fixo ?? nivelGuardado(chave)));
  const escolherNivel = (n: Nivel) => {
    setNivelGeral(n);
    guardarNivel(chave, n);
    setFechados(fechadosDo(n));
  };
  const alternar = (codigo: string) =>
    setFechados((f) => {
      const novo = new Set(f);
      if (novo.has(codigo)) novo.delete(codigo);
      else novo.add(codigo);
      return novo;
    });
  const visivel = (l: L) =>
    !(acima.get(l.codigo) ?? []).some((g) => fechados.has(g)) &&
    !(ps && !comPs && nivelGeral !== 3 && (l.codigo === ps || (acima.get(l.codigo) ?? []).includes(ps)));
  return {
    linhas,
    nivelGeral,
    escolherNivel,
    visivel,
    /** O recuo da descrição da linha. */
    recuo: (l: L) => RECUO[nivel.get(l.codigo) ?? 0],
    grupo: (l: L) => comFilhos.has(l.codigo),
    /** As linhas abaixo da linha (as do grupo dela, de nível inferior): a marcação de um total marca as contas dele. */
    abaixo: (l: L) => linhas.filter((x) => (acima.get(x.codigo) ?? []).includes(l.codigo)),
    fechado: (l: L) => fechados.has(l.codigo),
    alternar,
  };
}

/**
 * O botão de níveis (só a seta), na faixa amarela do título. `nome` e `legenda` (24/11/2026: a tabela Premissas da aba Centros de
 * Custo dos analíticos): o nome dos níveis na dica ("Níveis da DRE") e o texto acima deles no menu ("Mostrar a DRE até").
 */
export function SeletorNivel({ nivel, onEscolher, nome = "Níveis da DRE", legenda = "Mostrar a DRE até" }: { nivel: Nivel; onEscolher: (n: Nivel) => void; nome?: string; legenda?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            aria-label={nome}
            title={`${nome}: ${NIVEIS.find((n) => n.nivel === nivel)?.rotulo}`}
            className="size-8 shrink-0 rounded-sm border-black/30 bg-white p-0"
          >
            <ChevronDown className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-gray-500">{legenda}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={String(nivel)} onValueChange={(v) => onEscolher(Number(v) as Nivel)}>
            {NIVEIS.map((n) => (
              <DropdownMenuRadioItem key={n.nivel} value={String(n.nivel)} closeOnClick>
                <span className="flex flex-col">
                  <span>{n.rotulo}</span>
                  <span className="text-xs text-gray-500">{n.dica}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A seta que abre e fecha o grupo da linha; sem grupo, o lugar dela, para os nomes do mesmo nível ficarem alinhados. */
export function Agrupador({ grupo, fechado, onAlternar }: { grupo: boolean; fechado: boolean; onAlternar: () => void }) {
  if (!grupo) return <span aria-hidden className="-ml-1 inline-block w-[18px] shrink-0" />;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onAlternar();
      }}
      title={fechado ? "Expandir" : "Recolher"}
      aria-expanded={!fechado}
      className="-ml-1 rounded-sm p-0.5 text-gray-500 hover:bg-gray-200 hover:text-gray-900"
    >
      {fechado ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
    </button>
  );
}
