"use client";

import { Fragment, useState, type ReactNode, useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { BotaoMeses, useMesesRecolhidos } from "../components/MesesRecolhidos";
import { SeletorComparaCom, useComparaCom } from "../components/ComparaCom";
import { comCor, ESTILOS_NA_TABELA, type CenarioDoProva } from "../components/cenariosDoProva";

import { useAbaLembrada } from "@/hooks/useAbaLembrada";
import { Abas } from "@/components/shared/Abas";
import { CabecalhoDaTela } from "@/components/shared/CabecalhoDaTela";
import { CampoBusca } from "@/components/shared/Filtros";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionContext";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";

import { DetalheDialog } from "../../competencias/[anoMes]/dre/components/DetalheDialog";
import { InfoAgrupamento } from "../../competencias/[anoMes]/dre/components/InfoAgrupamento";
import { Agrupador, fundoDaLinha, fundoDoOrcado, ROTULO_DO_ORCADO, SeletorNivel, semPrimeiroTotalDaRol, useNiveisDRE, type Nivel } from "../../competencias/[anoMes]/dre/components/NiveisDRE";
import { VolumesDialog } from "../../competencias/[anoMes]/dre/components/VolumesDialog";
import type { VisaoDetalhe } from "../../competencias/[anoMes]/dre/services/dreService";
import { ExportarRelatorio, type OpcaoExportar } from "../components/ExportarRelatorio";
import { SeletorPeriodo, useExercicios } from "../components/SeletorPeriodo";
import { TabelaEstatica, TabelaLarga } from "../components/TabelaLarga";
import { ExportarImpostos, VisaoImpostos } from "./VisaoImpostos";
import { PesquisarResultados } from "./PesquisarResultados";
import {
  formato,
  mensagemDeErro,
  relatoriosService,
  type Celula,
  type LinhaDoNegocio,
  type LinhaResultado,
  type MesRelatorio,
  type Resultados,
  type ResultadosDaLinha,
  type MarcacaoComparavel,
} from "../services/relatoriosService";

/** As visões da DRE, como as abas Resultados (…) da planilha, e os centros de custo. */
const VISOES: Array<{ chave: string; aba: string; nome: string; foraDaTela?: boolean }> = [
  { chave: "0", aba: "consolidado", nome: "Consolidado" },
  { chave: "1", aba: "matriz", nome: "Matriz" },
  { chave: "2", aba: "filial", nome: "Filial" },
  { chave: "3", aba: "servicos", nome: "Serviços" },
  { chave: "4", aba: "despesas", nome: "Despesas e Extra" },
  { chave: "5", aba: "rn", nome: "RN" },
  { chave: "centros", aba: "centros", nome: "Centros de Custo" },
  // Os movimentos que deveriam ter centro de custo e não têm (14/10/2026).
  { chave: "sem_centros", aba: "sem_centros", nome: "Sem Centros de Custo" },
  // As linhas de produto e de obra (26/10/2026), gravadas na etapa Linhas da apuração: a DRE de cada uma e o rateado dela.
  { chave: "linhas", aba: "linhas", nome: "Linhas" },
  // Os Rateios das Linhas (antes, Rateios por Obras): os custos de cada linha que não vieram dos centros de obra, sobre os
  // volumes. Fora da tela desde 27/10/2026 (pedido do Adão), com o código guardado para o processo Resultados por Obra.
  { chave: "rateios_linhas", aba: "rateios_linhas", nome: "Rateios das Linhas", foraDaTela: true },
  // As obras (centros 1.98 e 1.99), como a aba Obras da DRE (11/10/2026).
  { chave: "obras", aba: "obras", nome: "Obras" },
  // Os Créditos de Impostos de cada mês fechado (03/11/2026, pedido do Adão; de início, Almoxarifado; antes, nas
  // Configurações do Realizado por Obra).
  { chave: "impostos", aba: "impostos", nome: "Impostos" },
];

const Carregando = () => <div className="h-64 animate-pulse rounded-sm bg-gray-100" />;
const Erro = ({ erro, padrao }: { erro: unknown; padrao: string }) => (
  <div className="rounded-sm border border-red-200 bg-red-50 p-4">
    <p className="text-sm text-red-700">{mensagemDeErro(erro, padrao)}</p>
  </div>
);

/** Os valores sem casas decimais; os volumes (m³, kg, pistas, dias) com duas. */
const valorDa = (l: LinhaResultado, c: Celula) => (l.tipo === "SECAO" ? "" : c.valor === null ? "—" : l.volume ? formato.valor(c.valor) : formato.inteiro(c.valor));
/** Sem base (linhas de volume, contas sem R$/m³): em branco; base zerada: traço. */
const fracao = (l: LinhaResultado, v: number | null, temBase: boolean) => (l.tipo === "SECAO" || l.volume || !temBase ? "" : v === null ? "—" : formato.pct(v));
const unitario = (l: LinhaResultado, v: number | null) => (l.tipo === "SECAO" || l.volume || v === null ? "" : formato.valor(v));

/**
 * As linhas que abrem a consulta, como na DRE: os itens e os impostos abrem os
 * lançamentos de origem (se o usuário alcança as movimentações da linha); as
 * linhas de volume, as listas somadas por obra (fora dos centros de custo).
 */
const detalhavel = (l: LinhaResultado) => !l.volume && (l.tipo === "ITEM" || l.descricao === "Impostos Operacionais") && l.podeDetalhar !== false;
const listavel = (l: LinhaResultado, visao: VisaoDetalhe) => l.volume && l.tipo === "ITEM" && !("grupo" in visao);

/**
 * A tabela de uma visão: a descrição presa à esquerda e os rótulos presos no
 * topo, com rolagem própria nos dois sentidos (a tabela é larga). Cada mês tem
 * o valor e o %; o mês de referência (o último), também o R$/m³; no fim, o
 * total do exercício com o % e o R$/m³. Clicar no valor de um mês abre a
 * consulta daquele mês (os lançamentos ou as listas, como na DRE); clicar na
 * descrição, a do mês de referência. Sem `consultas` (os cenários, que não têm
 * lançamentos), nada abre.
 */

/**
 * O modo de edição da tabela (os cenários, 12/10/2026): a caixa de cada linha (a de um total marca as contas dele) e
 * a de cada mês; os valores marcados são os das contas e meses marcados. Clicar numa linha abre o reajuste dos
 * marcados; clicar no valor de uma conta, a edição daquele valor.
 */
export type EdicaoDaTabela = {
  editavel: (l: LinhaResultado) => boolean;
  linhasMarcadas: Set<string>;
  mesesMarcados: Set<number>;
  onMarcarLinhas: (codigos: string[], marcar: boolean) => void;
  onMarcarMes: (i: number, marcar: boolean) => void;
  onCelula: (l: LinhaResultado, i: number) => void;
  onConta: (l: LinhaResultado) => void;
};

/** Uma caixa de marcação com o estado "alguns" (traço). */
function Caixa({ marcada, alguns, rotulo, onMudar }: { marcada: boolean; alguns?: boolean; rotulo: string; onMudar: () => void }) {
  return (
    <input
      type="checkbox"
      aria-label={rotulo}
      title={rotulo}
      checked={marcada}
      ref={(el) => {
        if (el) el.indeterminate = !!alguns && !marcada;
      }}
      onChange={onMudar}
      onClick={(e) => e.stopPropagation()}
      className="size-3.5 shrink-0 cursor-pointer accent-black"
    />
  );
}

/** O estilo das colunas de um comparado: a classe do rótulo e o fundo de cada linha. */
export type EstiloDoComparado = { rotulo: string; fundo: (l: { codigo: string; tipo: string }) => string };

export function TabelaResultados({
  dados,
  titulo,
  visao,
  nomeVisao,
  aoLadoDoTitulo,
  consultas = true,
  edicao,
  doCenario = false,
  estatico,
  soOMes = false,
  comparados,
  estiloDoOrcado,
  rotulosDoTotal,
  consultaDaVenda,
  recolheTodosOsMeses = false,
}: {
  dados: Resultados;
  titulo: string;
  visao: VisaoDetalhe;
  nomeVisao: string;
  /** Conteúdo logo depois do título (o botão de informação do centro de custo), como na DRE. */
  aoLadoDoTitulo?: ReactNode;
  consultas?: boolean;
  /** O modo de edição (os cenários). */
  edicao?: EdicaoDaTabela;
  /**
   * Os Resultados de um cenário (13/10/2026): sem o R$/m³ do último mês (dezembro; o total do exercício o tem), e
   * recolhidos, sem nenhum mês (dezembro também), só a descrição e os totais — a tabela se estica e enche a tela.
   */
  doCenario?: boolean;
  /**
   * A tabela fixa (22/10/2026: os blocos de tabela dos Relatórios Executivos): o nível, as linhas escolhidas (sem elas,
   * todas) e os meses anteriores recolhidos ou não vêm de fora; sem as consultas, os botões dos níveis e dos meses, as
   * setas dos grupos e a rolagem (a tabela inteira, na largura das colunas). `colunas` (30/10/2026): o R$/m³ e as colunas
   * da variação que entram (sem ele, todas).
   */
  estatico?: { nivel: Nivel; linhas?: string[]; recolhido: boolean; colunas?: { unitario: boolean; diferenca: boolean; atingimento: boolean; eficiencia: boolean } };
  /** Um mês só (27/10/2026: a etapa Linhas do Fechamento Mensal): sem as colunas do total do exercício, que o repetiriam. */
  soOMes?: boolean;
  /**
   * Os cenários lado a lado no lugar do orçado (31/10/2026: a Tabela PROVA dos Relatórios Executivos), cada um com o
   * rótulo, a dica, o estilo (a classe do rótulo e o fundo de cada linha) e as células dele; sem as colunas da variação.
   */
  comparados?: Array<{ chave: string; rotulo: string; dica?: string; estilo: EstiloDoComparado; celulas: (l: LinhaResultado) => { mes?: Celula; total: Celula } | null | undefined }>;
  /** O estilo do orçado (31/10/2026: o do cenário, numa Tabela Padrão de um slide com blocos PROVA); sem ele, o preto e o cinza. */
  estiloDoOrcado?: EstiloDoComparado;
  /**
   * Os rótulos das colunas do total e do comparado total (03/11/2026: o Realizado por Obra, cujos meses passam do exercício):
   * sem eles, TOTAL/AA e o do comparado.
   */
  rotulosDoTotal?: { realizado: string; comparado: string };
  /**
   * As consultas de uma venda (03/11/2026: o Realizado por Obra): em cada mês (o índice), a visão dos lançamentos (o centro
   * da obra; nula, o mês sem a consulta dos lançamentos) e a nota no alto do extrato; as obras dos volumes (sem a conferência
   * com o valor da célula: o extrato traz a venda inteira, de todas as linhas e unidades).
   */
  consultaDaVenda?: {
    visao: (mes: number) => VisaoDetalhe | null;
    nota: (l: LinhaResultado, mes: number) => ReactNode;
    obras: string[];
    /** Uma consulta própria de uma linha (a memória de cálculo dos subtotais agrupados): as linhas que a abrem e o modal. */
    memoria?: { abre: (l: LinhaResultado) => boolean; modal: (l: LinhaResultado, mes: number, onFechar: () => void) => ReactNode };
  };
  /**
   * Recolhidos, sem nenhum mês (05/11/2026: o Realizado por Obra, pedido do Adão): só a descrição, o acumulado (o realizado
   * e o comparado) e as variações.
   */
  recolheTodosOsMeses?: boolean;
}) {
  // Sem o primeiro total da ROL (21/10/2026): ele repete o segundo (depois da receita bruta e dos impostos). Nas visões
  // com um só (Despesas e Extra e RN, a ROL do Consolidado no topo), ele fica.
  const linhasDaTabela = useMemo(() => semPrimeiroTotalDaRol(dados.linhas), [dados.linhas]);
  const niveis = useNiveisDRE(linhasDaTabela, "sig.resultados.nivel", estatico?.nivel, estatico ? undefined : "recolhida");
  const linhasEscolhidas = estatico?.linhas;
  const escolhidas = useMemo(() => (linhasEscolhidas ? new Set(linhasEscolhidas) : null), [linhasEscolhidas]);
  // Sem o R$/m³ em Despesas e Extra e no RN (21/10/2026), nem na tabela fixa sem ele (30/10/2026).
  const comUnitario = !("unidade" in visao && (visao.unidade === 4 || visao.unidade === 5)) && (estatico?.colunas?.unitario ?? true);
  // Na edição, as contas da linha que a caixa dela marca: ela mesma (se se edita) e as editáveis abaixo dela.
  const contasDaLinha = (l: LinhaResultado) => (edicao ? [l, ...niveis.abaixo(l)].filter(edicao.editavel).map((x) => x.codigo) : []);
  const [consulta, setConsulta] = useState<{ linha: LinhaResultado; mes: MesRelatorio } | null>(null);
  const temPct = (l: LinhaResultado) => !l.volume && (l.meses.some((c) => c.pct !== null) || l.total.pct !== null);
  const ano = String(dados.ano).slice(2);
  const referencia = dados.meses.length - 1;
  // Recolhidos, só o mês de referência fica (com o orçado dele), antes dos totais. Na edição dos cenários também
  // (13/10/2026): os meses marcados e escondidos continuam marcados (a barra de marcação mostra quantos).
  const [recolhidoNaTela, alternarMeses] = useMesesRecolhidos();
  const recolhido = estatico ? estatico.recolhido : recolhidoNaTela;
  const mostra = (i: number) => !recolhido || (i === referencia && !doCenario && !recolheTodosOsMeses);
  // O R$/m³ do mês de referência (Resultados Empresariais); nos cenários, só no total.
  const unitarioNoMes = !doCenario && comUnitario;
  // O mês de referência da descrição: o último apurado.
  const ultimoApurado = [...dados.meses].reverse().find((m) => m.apurado) ?? null;
  const daMemoria = (l: LinhaResultado) => !!consultaDaVenda?.memoria?.abre(l);
  const abre = (l: LinhaResultado) => !estatico && consultas && (detalhavel(l) || listavel(l, visao) || daMemoria(l));
  // O orçado (só nas visões de Resultados Empresariais): depois do mês de referência e depois do total, o orçado (valor, % e
  // R$/m³, em cinza); só depois do total, a variação (em amarelo): a diferença, o atingimento e a eficiência.
  const comOrcado = !!comparados?.length || dados.linhas.some((l) => l.orcado !== undefined);
  // O rótulo preto e o fundo em cinza do orçado, ou o estilo pedido (31/10/2026: a cor do cenário).
  const doOrcado = estiloDoOrcado ?? { rotulo: ROTULO_DO_ORCADO, fundo: fundoDoOrcado };
  // Os grupos de colunas do orçado: um só ou, na Tabela PROVA, um por cenário.
  const grupos = comparados?.length ?? 1;
  // Nos cenários (13/10/2026), o cenário comparado no lugar do orçado: só depois do total (os 12 meses se olham inteiros).
  const comOrcadoNoMes = comOrcado && !dados.comparado;
  // O nome do comparado (21/10/2026): "ORÇADO" no Orçamento Empresarial; nos outros cenários do Compara Com, o nome da marcação.
  const ROTULO = (dados.rotuloComparado ?? "Orçado").toUpperCase();
  const rotuloDoOrcadoTotal = rotulosDoTotal?.comparado ?? (dados.comparado ? `COMPARADO TOTAL/${String(dados.comparado.ano).slice(2)}` : `${ROTULO} TOTAL/${ano}`);
  const orcadoDa = (l: LinhaResultado, v: number | undefined) => (l.tipo === "SECAO" || v === undefined ? "" : l.volume ? formato.valor(v) : formato.inteiro(v));
  /** O texto com o sinal: + nos positivos (o − dos negativos vem do formato); o que arredonda para zero fica sem sinal. */
  const comSinal = (v: number, texto: string) => (v > 0 && /[1-9]/.test(texto) ? `+${texto}` : texto);
  /** Diferença: o realizado menos o orçado, com o sinal. */
  const diferenca = (l: LinhaResultado, r: Celula, o: Celula | undefined) => {
    if (l.tipo === "SECAO" || !o) return "";
    if (r.valor === null || o.valor === null) return "—";
    const d = r.valor - o.valor;
    return comSinal(d, l.volume ? formato.valor(d) : formato.inteiro(d));
  };
  /** Atingimento: o realizado sobre o orçado, em percentual (orçado zero: traço). */
  const atingimento = (l: LinhaResultado, r: Celula, o: Celula | undefined) =>
    l.tipo === "SECAO" || !o ? "" : r.valor === null || !o.valor ? "—" : formato.pct(r.valor / o.valor);
  /** Eficiência: o % realizado menos o % orçado, em pontos percentuais, com o sinal (só nas linhas com %). */
  const eficiencia = (l: LinhaResultado, r: Celula, o: Celula | undefined) => {
    if (l.tipo === "SECAO" || l.volume || !o || !temPct(l)) return "";
    if (r.pct === null || o.pct === null) return "—";
    const pp = (r.pct - o.pct) * 100;
    return `${comSinal(pp, formato.umaCasa(pp))} p.p.`;
  };
  // Colunas estreitas (12/10/2026): numa tela de 1920 px, o mês de referência, o orçado dele, os totais, o orçado
  // total e as variações cabem juntos; os rótulos do orçado quebram em duas linhas (ORÇADO / MAR/26).
  const LARGURAS_DO_ORCADO = comUnitario ? [100, 52, 64] : [100, 52];
  // As colunas da variação, depois do orçado total; a tabela fixa escolhe quais entram (30/10/2026). Com os cenários lado a
  // lado (31/10/2026, a Tabela PROVA), nenhuma: seriam três por cenário.
  const variacoes = [
    { chave: "diferenca", rotulo: "DIFERENÇA", largura: 96, celula: diferenca },
    { chave: "atingimento", rotulo: "ATINGIMENTO", largura: 96, celula: atingimento },
    { chave: "eficiencia", rotulo: "EFICIÊNCIA", largura: 84, celula: eficiencia },
  ].filter((v) => !comparados && (estatico?.colunas?.[v.chave as "diferenca" | "atingimento" | "eficiencia"] ?? true));
  const LARGURAS_DA_VARIACAO = variacoes.map((v) => v.largura);
  const th = "px-1.5 py-2 text-right text-xs font-bold whitespace-nowrap text-gray-900";
  // A visão dos lançamentos da consulta aberta: a da tabela ou, numa venda, a do mês (nula: o mês sem os lançamentos).
  const visaoDaConsulta = consulta ? (consultaDaVenda ? consultaDaVenda.visao(dados.meses.indexOf(consulta.mes)) : visao) : null;
  // O mês (1 a 12) do exercício ou, no Realizado por Obra, cujos meses passam do exercício, o ano e o mês (AAAAMM).
  const anoMes = (m: MesRelatorio) => (m.mes > 12 ? `${Math.floor(m.mes / 100)}-${String(m.mes % 100).padStart(2, "0")}` : `${dados.ano}-${String(m.mes).padStart(2, "0")}`);
  // Descrição; em cada mês, o valor e o % (e o R$/m³ no de referência); o total com o % e o R$/m³.
  // A descrição sem quebra de linha, em 420 px: com os meses anteriores recolhidos, a descrição, o mês, o orçado dele,
  // os totais, o orçado total e as variações enchem uma tela de 1920 px. As poucas mais longas (RECEITAS FINANCERIAS
  // NÃO CORRENTES (RFNC) (+)) terminam em reticências, com o nome inteiro na dica.
  const larguras = [
    420,
    ...dados.meses.flatMap((_, i) =>
      !mostra(i) ? [] : i === referencia ? [96, 52, ...(unitarioNoMes ? [64] : []), ...(comOrcadoNoMes ? Array.from({ length: grupos }).flatMap(() => LARGURAS_DO_ORCADO) : [])] : [96, 52],
    ),
    ...(soOMes ? [] : [104, 52, ...(comUnitario ? [64] : [])]),
    ...(comOrcado ? [...Array.from({ length: grupos }).flatMap(() => [104, ...LARGURAS_DO_ORCADO.slice(1)]), ...LARGURAS_DA_VARIACAO] : []),
  ];
  /**
   * Os rótulos do orçado (pretos, ou na cor do cenário) e, nos totais, da variação (amarelo-ouro, como os demais). Na
   * Tabela PROVA, os grupos dos cenários se separam por uma linha.
   */
  const rotulosDoOrcado = (rotulo: string, variacao: boolean, classe = doOrcado.rotulo, dica?: string, separar = false) => (
    <>
      <th
        className={`${th} ${classe} !whitespace-normal leading-tight ${separar ? "border-l border-gray-300" : ""}`}
        title={dica ?? (dados.comparado && variacao ? `O total de ${dados.comparado.nome}` : undefined)}
      >
        {rotulo}
      </th>
      <th className={`${th} ${classe}`}>%</th>
      {comUnitario ? <th className={`${th} ${classe}`}>R$/m³</th> : null}
      {variacao
        ? variacoes.map((v, k) => (
            <th key={v.chave} className={`${th} ${k === 0 ? "border-l border-gray-300" : ""}`}>
              {v.rotulo}
            </th>
          ))
        : null}
    </>
  );
  // A tabela fixa, sem a rolagem (os Relatórios Executivos); na tela, a larga, com os rótulos presos no topo.
  const Tabela = estatico ? TabelaEstatica : TabelaLarga;
  return (
    <div>
      <Tabela
        larguras={larguras}
        cabecalho={
          <tr className="border-b border-gray-300">
            <th className="left-0 !z-20 px-3 py-2 text-left">
              <span className="flex items-center gap-3">
                {/* Os botões ficam de fora da imagem da tabela (22/10/2026) e da tabela fixa. */}
                {estatico ? null : (
                  <span data-fora-da-imagem className="flex shrink-0 items-center gap-1.5">
                    <SeletorNivel nivel={niveis.nivelGeral} onEscolher={niveis.escolherNivel} />
                    {dados.meses.length > 1 || (recolheTodosOsMeses && dados.meses.length) ? (
                      <BotaoMeses recolhido={recolhido} onAlternar={alternarMeses} todos={recolheTodosOsMeses} />
                    ) : null}
                  </span>
                )}
                <span className="truncate text-sm font-bold tracking-wide whitespace-nowrap text-gray-900 uppercase" title={titulo}>
                  {titulo}
                </span>
                {aoLadoDoTitulo}
              </span>
            </th>
            {dados.meses.map((m, i) =>
              !mostra(i) ? null : (
              <Fragment key={m.mes}>
                <th className={`${th} border-l border-gray-300`}>
                  {edicao ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Caixa
                        marcada={edicao.mesesMarcados.has(i)}
                        rotulo={`Marcar ${m.rotulo}`}
                        onMudar={() => edicao.onMarcarMes(i, !edicao.mesesMarcados.has(i))}
                      />
                      {m.rotulo}
                    </span>
                  ) : (
                    m.rotulo
                  )}
                </th>
                <th className={th}>%</th>
                {i === referencia && unitarioNoMes ? <th className={th}>R$/m³</th> : null}
                {i === referencia && comOrcadoNoMes
                  ? comparados
                    ? comparados.map((c) => <Fragment key={c.chave}>{rotulosDoOrcado(`${c.rotulo.toUpperCase()} ${m.rotulo}`, false, c.estilo.rotulo, c.dica, true)}</Fragment>)
                    : rotulosDoOrcado(`${ROTULO} ${m.rotulo}`, false)
                  : null}
              </Fragment>
              ),
            )}
            {soOMes ? null : (
              <>
                <th className={`${th} border-l border-gray-300`}>{rotulosDoTotal?.realizado ?? `TOTAL/${ano}`}</th>
                <th className={th}>%</th>
                {comUnitario ? <th className={th}>R$/m³</th> : null}
              </>
            )}
            {comOrcado
              ? comparados
                ? comparados.map((c) => <Fragment key={c.chave}>{rotulosDoOrcado(`${c.rotulo.toUpperCase()} TOTAL/${ano}`, true, c.estilo.rotulo, c.dica, true)}</Fragment>)
                : rotulosDoOrcado(rotuloDoOrcadoTotal, true)
              : null}
          </tr>
        }
        corpo={niveis.linhas.filter((l) => niveis.visivel(l) && (!escolhidas || escolhidas.has(l.codigo))).map((l) => {
            const destaque = l.tipo !== "ITEM";
            const fundo = fundoDaLinha(l);
            const td = "px-1.5 py-1.5 text-right whitespace-nowrap";
            const pct = `${td} text-xs ${destaque ? "text-gray-700" : "text-gray-500"}`;
            const clicavel = abre(l);
            const contas = contasDaLinha(l);
            const marcadas = contas.filter((c) => edicao?.linhasMarcadas.has(c)).length;
            const pctOrcado = `${td} text-xs ${destaque ? "text-gray-700" : "text-gray-500"}`;
            // O orçado (valor, % e R$/m³, no cinza, ou na escala da cor do cenário) e, nos totais, a variação contra o
            // realizado (no amarelo da linha).
            const celulasDoOrcado = (l: LinhaResultado, r: Celula, o: Celula | undefined, variacao: boolean, fundoDo = doOrcado.fundo(l), separar = false) => (
              <>
                <td className={`${td} ${fundoDo} ${separar ? "border-l border-gray-200" : ""}`}>{orcadoDa(l, o?.valor ?? undefined)}</td>
                <td className={`${pctOrcado} ${fundoDo}`}>{o ? fracao(l, o.pct, temPct(l)) : ""}</td>
                {comUnitario ? <td className={`${pctOrcado} ${fundoDo}`}>{o ? unitario(l, o.unitario) : ""}</td> : null}
                {variacao
                  ? variacoes.map((v, k) => (
                      <td key={v.chave} className={`${td} ${k === 0 ? "border-l border-gray-100" : ""} ${fundo}`}>
                        {v.celula(l, r, o)}
                      </td>
                    ))
                  : null}
              </>
            );
            const dica = (m: MesRelatorio) =>
              daMemoria(l) ? `Ver a memória de cálculo de ${m.rotulo}` : detalhavel(l) ? `Ver os lançamentos de origem de ${m.rotulo}` : `Ver as listas por obra de ${m.rotulo}`;
            return (
              <tr key={l.codigo} className={destaque ? "border-y border-gray-300 font-bold" : "border-t border-gray-100"}>
                <td
                  className={`sticky left-0 z-10 overflow-hidden py-1.5 pr-3 whitespace-nowrap ${fundo} ${niveis.recuo(l)} ${destaque ? "text-gray-900" : "text-gray-700"} ${(edicao ? contas.length > 0 : clicavel && ultimoApurado) ? "cursor-pointer hover:bg-gray-100" : ""}`}
                  onClick={
                    edicao ? (contas.length ? () => edicao.onConta(l) : undefined) : clicavel && ultimoApurado ? () => setConsulta({ linha: l, mes: ultimoApurado }) : undefined
                  }
                  title={edicao ? (contas.length ? "Reajustar os valores marcados" : undefined) : clicavel && ultimoApurado ? dica(ultimoApurado) : undefined}
                >
                  <span className="flex min-w-0 items-center gap-1">
                    {edicao ? (
                      contas.length ? (
                        <Caixa
                          marcada={marcadas === contas.length}
                          alguns={marcadas > 0}
                          rotulo={`Marcar ${l.descricao}`}
                          onMudar={() => edicao.onMarcarLinhas(contas, marcadas < contas.length)}
                        />
                      ) : (
                        <span aria-hidden className="inline-block size-3.5 shrink-0" />
                      )
                    ) : null}
                    <Agrupador grupo={!estatico && niveis.grupo(l)} fechado={niveis.fechado(l)} onAlternar={() => niveis.alternar(l.codigo)} />
                    {clicavel ? <Search data-fora-da-imagem className="size-3.5 shrink-0 text-gray-400" /> : null}
                    <span className="truncate" title={l.descricao}>
                      {l.descricao}
                    </span>
                  </span>
                </td>
                {l.meses.map((c, i) => {
                  if (!mostra(i)) return null;
                  const m = dados.meses[i];
                  const abreMes = clicavel && m.apurado && c.valor !== null && (!consultaDaVenda || !detalhavel(l) || consultaDaVenda.visao(i) !== null);
                  // Na edição, o valor de uma conta abre a edição dele; o marcado (conta e mês) fica contornado.
                  const editaMes = !!edicao && edicao.editavel(l);
                  const marcado = editaMes && edicao!.linhasMarcadas.has(l.codigo) && edicao!.mesesMarcados.has(i);
                  return (
                    <Fragment key={i}>
                      <td
                        className={`${td} border-l border-gray-100 ${fundo} ${abreMes || editaMes ? "cursor-pointer hover:bg-gray-100" : ""} ${marcado ? "shadow-[inset_0_0_0_2px_rgba(0,0,0,0.55)]" : ""}`}
                        onClick={editaMes ? () => edicao!.onCelula(l, i) : abreMes ? () => setConsulta({ linha: l, mes: m }) : undefined}
                        title={editaMes ? `Editar ${m.rotulo}` : abreMes ? dica(m) : undefined}
                      >
                        {valorDa(l, c)}
                      </td>
                      <td className={`${pct} ${fundo}`}>{fracao(l, c.pct, temPct(l))}</td>
                      {i === referencia && unitarioNoMes ? <td className={`${pct} ${fundo}`}>{unitario(l, c.unitario)}</td> : null}
                      {i === referencia && comOrcadoNoMes
                        ? comparados
                          ? comparados.map((x) => <Fragment key={x.chave}>{celulasDoOrcado(l, c, x.celulas(l)?.mes, false, x.estilo.fundo(l), true)}</Fragment>)
                          : celulasDoOrcado(l, c, l.orcado?.mes, false)
                        : null}
                    </Fragment>
                  );
                })}
                {soOMes ? null : (
                  <>
                    <td className={`${td} border-l border-gray-300 ${fundo}`}>{valorDa(l, l.total)}</td>
                    <td className={`${pct} ${fundo}`}>{fracao(l, l.total.pct, temPct(l))}</td>
                    {comUnitario ? <td className={`${pct} ${fundo}`}>{unitario(l, l.total.unitario)}</td> : null}
                  </>
                )}
                {comOrcado
                  ? comparados
                    ? comparados.map((x) => <Fragment key={x.chave}>{celulasDoOrcado(l, l.total, x.celulas(l)?.total, true, x.estilo.fundo(l), true)}</Fragment>)
                    : celulasDoOrcado(l, l.total, l.orcado?.total, true)
                  : null}
              </tr>
            );
          })}
      />
      {consulta && detalhavel(consulta.linha) && visaoDaConsulta ? (
        <DetalheDialog
          anoMes={anoMes(consulta.mes)}
          linha={consulta.linha.codigo}
          visao={visaoDaConsulta}
          rotuloMes={consulta.mes.rotulo}
          nota={consultaDaVenda?.nota(consulta.linha, dados.meses.indexOf(consulta.mes))}
          onFechar={() => setConsulta(null)}
        />
      ) : null}
      {consulta && daMemoria(consulta.linha) ? consultaDaVenda!.memoria!.modal(consulta.linha, dados.meses.indexOf(consulta.mes), () => setConsulta(null)) : null}
      {consulta && listavel(consulta.linha, visao) ? (
        <VolumesDialog
          anoMes={anoMes(consulta.mes)}
          linha={consulta.linha.codigo}
          unidade={"unidade" in visao ? visao.unidade : undefined}
          obra={"obra" in visao ? visao.obra : undefined}
          obras={consultaDaVenda?.obras}
          nomeVisao={nomeVisao}
          rotuloMes={consulta.mes.rotulo}
          valorApurado={(() => {
            if (consultaDaVenda) return null;
            const v = consulta.linha.meses[dados.meses.indexOf(consulta.mes)]?.valor;
            return v === null || v === undefined ? null : String(v);
          })()}
          onFechar={() => setConsulta(null)}
        />
      ) : null}
    </div>
  );
}

/** Os centros de custo: a lista dos agrupamentos à esquerda, como na DRE, e a tabela do escolhido. */
const chaveCentros = (ano: number, ate: number) => ["relatorios", "resultados", ano, ate, "centros"];

/** O centro escolhido vale enquanto existir no período; senão, o primeiro da lista. */
function useCentroEscolhido(ano: number, ate: number, ativo: boolean, escolhido: string | null) {
  const grupos = useQuery({ queryKey: chaveCentros(ano, ate), queryFn: () => relatoriosService.centros(ano, ate), enabled: ativo });
  const lista = grupos.data?.grupos ?? [];
  return { grupos, lista, grupo: (escolhido && lista.some((g) => g.grupo === escolhido) ? escolhido : lista[0]?.grupo) ?? null };
}

function VisaoCentros({ ano, ate, escolhido, onEscolher }: { ano: number; ate: number; escolhido: string | null; onEscolher: (g: string) => void }) {
  const [busca, setBusca] = useState("");
  const { grupos, lista, grupo } = useCentroEscolhido(ano, ate, true, escolhido);
  const centro = useQuery({
    queryKey: ["relatorios", "resultados", ano, ate, "centros", grupo],
    queryFn: () => relatoriosService.centro(ano, ate, grupo!),
    enabled: grupo !== null,
  });
  if (grupos.isError) return <Erro erro={grupos.error} padrao="Erro ao carregar os centros de custo." />;
  if (grupos.isPending) return <Carregando />;
  if (lista.length === 0) return <p className="rounded-sm border border-gray-200 bg-white p-6 text-sm text-gray-600">Nenhum centro de custo com valor no período.</p>;
  const t = busca.trim().toLowerCase();
  const filtrados = lista.filter((g) => !t || g.grupo.toLowerCase().includes(t));
  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start">
      <div className="rounded-sm border border-gray-200 bg-white">
        <div className="border-b border-gray-200 p-2">
          <CampoBusca rotulo="Buscar centro de custo" valor={busca} onMudar={setBusca} placeholder="Centro de Custo…" largura="w-full" />
        </div>
        <ul className="max-h-[60vh] overflow-y-auto py-1" aria-label="Centros de custo">
          {filtrados.map((g) => (
            <li key={g.grupo}>
              <button
                type="button"
                onClick={() => onEscolher(g.grupo)}
                aria-current={g.grupo === grupo ? "true" : undefined}
                className={`flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm ${g.grupo === grupo ? "bg-black text-white" : "text-gray-800 hover:bg-gray-100"}`}
              >
                <span className="min-w-0 truncate" title={g.grupo}>
                  {g.grupo}
                </span>
              </button>
            </li>
          ))}
          {filtrados.length === 0 ? <li className="px-3 py-2 text-sm text-gray-500">Nenhum centro com esse nome.</li> : null}
        </ul>
      </div>
      <div className="min-w-0">
        {centro.isError ? (
          <Erro erro={centro.error} padrao="Erro ao carregar o centro de custo." />
        ) : centro.isPending ? (
          <Carregando />
        ) : (
          <TabelaResultados
            key={grupo ?? ""}
            dados={centro.data}
            titulo={grupo ?? ""}
            visao={{ grupo: grupo! }}
            nomeVisao={grupo ?? ""}
            aoLadoDoTitulo={<InfoAgrupamento grupo={grupo ?? ""} centros={centro.data.centros ?? []} periodo="no período" />}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Os movimentos sem centro de custo (14/10/2026): os lançamentos das contas de mão de obra e de gastos gerais (MOD, MOI,
 * GGD, GGI e GGC) sem centro do cadastro, como na referência dos cenários analíticos, por departamento (e filial). A
 * lista à esquerda, como os centros, e a tabela do escolhido.
 */
function VisaoSemCentros({ ano, ate, escolhido, onEscolher: setEscolhido }: { ano: number; ate: number; escolhido: string | null; onEscolher: (g: string) => void }) {
  const { lista, codigo } = useSemCentroEscolhido(ano, ate, true, escolhido);
  const grupos = lista.data?.grupos ?? [];
  const nome = grupos.find((g) => g.codigo === codigo)?.nome ?? "";
  const grupo = useQuery({ queryKey: ["relatorios", "resultados", ano, ate, "sem_centros", codigo], queryFn: () => relatoriosService.semCentro(ano, ate, codigo!), enabled: codigo !== null });
  if (lista.isError) return <Erro erro={lista.error} padrao="Erro ao carregar os movimentos sem centro de custo." />;
  if (lista.isPending) return <Carregando />;
  if (grupos.length === 0) return <p className="rounded-sm border border-gray-200 bg-white p-6 text-sm text-gray-600">Nenhum movimento sem centro de custo no período.</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start">
      <div className="rounded-sm border border-gray-200 bg-white">
        <ul className="max-h-[60vh] overflow-y-auto py-1" aria-label="Grupos sem centro de custo">
          {grupos.map((g) => (
            <li key={g.codigo}>
              <button
                type="button"
                onClick={() => setEscolhido(g.codigo)}
                aria-current={g.codigo === codigo ? "true" : undefined}
                className={`flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm ${g.codigo === codigo ? "bg-black text-white" : "text-gray-800 hover:bg-gray-100"}`}
              >
                <span className="min-w-0 truncate" title={g.nome}>
                  {g.nome}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0">
        {grupo.isError ? (
          <Erro erro={grupo.error} padrao="Erro ao carregar os movimentos sem centro de custo." />
        ) : grupo.isPending ? (
          <Carregando />
        ) : (
          <TabelaResultados key={codigo ?? ""} dados={grupo.data} titulo={nome} visao={{ semCentro: codigo! }} nomeVisao={nome} />
        )}
      </div>
    </div>
  );
}

/** As obras: a lista à esquerda (nome, código e o total do exercício), como os centros de custo, e a tabela da escolhida. */
/** O grupo sem centro escolhido (o primeiro da lista, sem escolha): a lista e o código, também para o Exportar. */
function useSemCentroEscolhido(ano: number, ate: number, ativo: boolean, escolhido: string | null) {
  const lista = useQuery({ queryKey: ["relatorios", "resultados", ano, ate, "sem_centros"], queryFn: () => relatoriosService.semCentros(ano, ate), enabled: ativo });
  const grupos = lista.data?.grupos ?? [];
  const codigo = (escolhido && grupos.some((g) => g.codigo === escolhido) ? escolhido : grupos[0]?.codigo) ?? null;
  return { lista, codigo };
}

/** A obra escolhida (a primeira da lista, sem escolha): a lista e o código, também para o Exportar. */
function useObraEscolhida(ano: number, ate: number, ativo: boolean, escolhida: string | null) {
  const lista = useQuery({ queryKey: ["relatorios", "resultados", ano, ate, "obras"], queryFn: () => relatoriosService.obras(ano, ate), enabled: ativo });
  const obras = lista.data?.obras ?? [];
  const codigo = (escolhida && obras.some((o) => o.codigo === escolhida) ? escolhida : obras[0]?.codigo) ?? null;
  return { lista, codigo };
}

function VisaoObras({ ano, ate, escolhida, onEscolher: setEscolhida }: { ano: number; ate: number; escolhida: string | null; onEscolher: (o: string) => void }) {
  const [busca, setBusca] = useState("");
  const { lista, codigo } = useObraEscolhida(ano, ate, true, escolhida);
  const obras = lista.data?.obras ?? [];
  const obra = useQuery({ queryKey: ["relatorios", "resultados", ano, ate, "obras", codigo], queryFn: () => relatoriosService.obra(ano, ate, codigo!), enabled: codigo !== null });
  if (lista.isError) return <Erro erro={lista.error} padrao="Erro ao carregar as obras." />;
  if (lista.isPending) return <Carregando />;
  if (obras.length === 0) return <p className="rounded-sm border border-gray-200 bg-white p-6 text-sm text-gray-600">Nenhuma obra com lançamento no período.</p>;
  const t = busca.trim().toLowerCase();
  const filtradas = obras.filter((o) => !t || o.nome.toLowerCase().includes(t) || o.codigo.includes(t));
  const nome = obras.find((o) => o.codigo === codigo)?.nome ?? codigo ?? "";
  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start">
      <div className="rounded-sm border border-gray-200 bg-white">
        <div className="border-b border-gray-200 p-2">
          <CampoBusca rotulo="Buscar obra" valor={busca} onMudar={setBusca} placeholder="Obra ou código…" largura="w-full" />
        </div>
        <ul className="max-h-[60vh] overflow-y-auto py-1" aria-label="Obras">
          {filtradas.map((o) => (
            <li key={o.codigo}>
              <button
                type="button"
                onClick={() => setEscolhida(o.codigo)}
                aria-current={o.codigo === codigo ? "true" : undefined}
                className={`block w-full px-3 py-1.5 text-left text-sm ${o.codigo === codigo ? "bg-black text-white" : "text-gray-800 hover:bg-gray-100"}`}
              >
                <span className="block truncate" title={o.nome}>
                  {o.nome}
                </span>
                <span className={`block text-xs ${o.codigo === codigo ? "text-white/70" : "text-gray-500"}`}>{o.codigo}</span>
              </button>
            </li>
          ))}
          {filtradas.length === 0 ? <li className="px-3 py-2 text-sm text-gray-500">Nenhuma obra com esse nome.</li> : null}
        </ul>
      </div>
      <div className="min-w-0">
        {obra.isError ? (
          <Erro erro={obra.error} padrao="Erro ao carregar a obra." />
        ) : obra.isPending ? (
          <Carregando />
        ) : (
          <TabelaResultados key={codigo ?? ""} dados={obra.data} titulo={`${nome} (${codigo})`} visao={{ obra: codigo! }} nomeVisao={nome} />
        )}
      </div>
    </div>
  );
}

/** A linha escolhida (a primeira da lista, sem escolha), a mesma nas abas Linhas e Rateios das Linhas: a lista e o id, também para o Exportar. */
function useLinhaEscolhida(ano: number, ate: number, ativo: boolean, escolhida: string | null) {
  const lista = useQuery({ queryKey: ["relatorios", "resultados", ano, ate, "linhas"], queryFn: () => relatoriosService.linhas(ano, ate), enabled: ativo });
  const linhas = lista.data?.linhas ?? [];
  const id = (escolhida && linhas.some((l) => l.id === escolhida) ? escolhida : linhas[0]?.id) ?? null;
  return { lista, id };
}

/**
 * As linhas de produto e de obra (26/10/2026): a lista à esquerda, por unidade, e a DRE da escolhida, da receita à Margem
 * de Contribuição (a aba Linhas) ou só os custos dela que não vieram dos centros de obra, sobre os volumes (`rateios`: a
 * aba Rateios das Linhas). Os valores são os gravados na etapa Linhas da apuração de cada competência fechada.
 */
function VisaoLinhas({ ano, ate, escolhida, onEscolher, rateios }: { ano: number; ate: number; escolhida: string | null; onEscolher: (l: string) => void; rateios: boolean }) {
  const { lista, id } = useLinhaEscolhida(ano, ate, true, escolhida);
  const linhas = lista.data?.linhas ?? [];
  const linha = useQuery({ queryKey: ["relatorios", "resultados", ano, ate, "linhas", id, rateios], queryFn: () => relatoriosService.linha(ano, ate, id!, rateios), enabled: id !== null });
  if (lista.isError) return <Erro erro={lista.error} padrao="Erro ao carregar as linhas." />;
  if (lista.isPending) return <Carregando />;
  if (linhas.length === 0) return <p className="rounded-sm border border-gray-200 bg-white p-6 text-sm text-gray-600">Nenhuma linha das unidades que o seu perfil lê.</p>;
  const semLinhas = lista.data?.semLinhas ?? [];
  return (
    <div className="space-y-4">
      {semLinhas.length ? (
        <div className="rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-3 text-sm text-gray-700">
          {semLinhas.length === 1 ? "A competência" : "As competências"} {semLinhas.join(", ")} {semLinhas.length === 1 ? "foi fechada" : "foram fechadas"} antes da
          etapa Linhas e {semLinhas.length === 1 ? "aparece" : "aparecem"} sem valor: grave as linhas em Fechamento Mensal › competência › Linhas.
        </div>
      ) : null}
      <PainelDeLinhas linhas={linhas} id={id} onEscolher={onEscolher} linha={linha} rateios={rateios} />
    </div>
  );
}

/**
 * A lista das linhas à esquerda, por unidade, e a DRE da escolhida: a aba Linhas (e a Rateios das Linhas) dos Resultados
 * Empresariais e, com um mês só (`soOMes`, 27/10/2026), a etapa Linhas do Fechamento Mensal.
 */
export function PainelDeLinhas({
  linhas,
  id,
  onEscolher,
  linha,
  rateios = false,
  soOMes = false,
}: {
  linhas: LinhaDoNegocio[];
  id: string | null;
  onEscolher: (l: string) => void;
  linha: UseQueryResult<ResultadosDaLinha>;
  rateios?: boolean;
  soOMes?: boolean;
}) {
  const unidades = [...new Set(linhas.map((l) => l.unidade))];
  const escolhidaAgora = linhas.find((l) => l.id === id);
  return (
      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start">
        <div className="rounded-sm border border-gray-200 bg-white">
          <ul className="max-h-[60vh] overflow-y-auto py-1" aria-label="Linhas">
            {unidades.map((u) => (
              <Fragment key={u}>
                <li className="px-3 pt-2 pb-1 text-xs font-bold tracking-wide text-gray-500 uppercase">{linhas.find((l) => l.unidade === u)?.nomeUnidade}</li>
                {linhas
                  .filter((l) => l.unidade === u)
                  .map((l) => (
                    <li key={l.id}>
                      <button
                        type="button"
                        onClick={() => onEscolher(l.id)}
                        aria-current={l.id === id ? "true" : undefined}
                        className={`flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm ${l.id === id ? "bg-black text-white" : "text-gray-800 hover:bg-gray-100"}`}
                      >
                        <span className="min-w-0 truncate" title={l.nome}>
                          {l.nome}
                        </span>
                        {l.ativo ? null : <span className={`shrink-0 text-xs ${l.id === id ? "text-white/70" : "text-gray-500"}`}>Inativa</span>}
                      </button>
                    </li>
                  ))}
              </Fragment>
            ))}
          </ul>
        </div>
        <div className="min-w-0">
          {linha.isError ? (
            <Erro erro={linha.error} padrao="Erro ao carregar a linha." />
          ) : linha.isPending || !escolhidaAgora ? (
            <Carregando />
          ) : (
            <TabelaResultados
              key={`${id}-${rateios}`}
              dados={linha.data}
              titulo={rateios ? `Rateios das Linhas · ${escolhidaAgora.nome}` : `${escolhidaAgora.nome} · ${escolhidaAgora.nomeUnidade}`}
              visao={{ unidade: escolhidaAgora.unidade }}
              nomeVisao={escolhidaAgora.nome}
              consultas={false}
              soOMes={soOMes}
            />
          )}
        </div>
      </div>
  );
}

/**
 * Uma visão com o orçado (o Consolidado e as unidades). Com a Comparação PROVA (31/10/2026), os cenários dela lado a lado,
 * cada um com as cores dele, no lugar do orçado, sem as variações (a Tabela PROVA dos Relatórios Executivos).
 */
function VisaoUnidade({ ano, ate, visao, nome, comparaCom, prova }: { ano: number; ate: number; visao: number; nome: string; comparaCom: MarcacaoComparavel; prova: CenarioDoProva[] | null }) {
  const marcacoes = prova?.map((c) => c.marcacao);
  const consulta = useQuery({
    queryKey: ["relatorios", "resultados", ano, ate, "visao", visao, comparaCom, marcacoes ?? null],
    queryFn: () => relatoriosService.resultados(ano, ate, visao, comparaCom, marcacoes),
  });
  if (consulta.isError) return <Erro erro={consulta.error} padrao="Erro ao carregar os resultados." />;
  if (consulta.isPending) return <Carregando />;
  // Os cenários que o servidor achou (os marcados), na ordem do PROVA.
  const comparados = prova
    ? comCor(consulta.data.prova ?? []).map((c) => ({
        chave: c.marcacao,
        rotulo: c.rotulo,
        dica: `${c.rotulo}: ${c.cenario}`,
        estilo: ESTILOS_NA_TABELA[c.marcacao],
        celulas: (l: LinhaResultado) => l.prova?.[c.marcacao],
      }))
    : undefined;
  return <TabelaResultados key={visao} dados={consulta.data} titulo={`Resultados · ${nome}`} visao={visao === 0 ? { consolidado: true } : { unidade: visao }} nomeVisao={nome} comparados={comparados} />;
}

export function ResultadosContent() {
  useRegistrarAcessoTela("/relatorios/resultados");
  const exercicios = useExercicios();
  // O Coordenador (recorte por centro de custo) vê a aba Obras só com a opção marcada no cadastro dele.
  const { user } = useAuth();
  const comObras = !user?.acesso.recorteCentro || user.acesso.recorteDepartamento || !!user.acesso.veObras;
  // Os movimentos sem centro de custo não aparecem para o Coordenador (só os centros dele).
  const comSemCentros = !user?.acesso.recorteCentro || user.acesso.recorteDepartamento;
  // As abas que o perfil lê (14/10/2026).
  const { hasPermission } = usePermissions();
  const le = (aba: string) => hasPermission(`relatorio_resultados.${aba}:ler`);
  const visoes = VISOES.filter((v) => !v.foraDaTela && (v.chave !== "obras" || comObras) && (v.chave !== "sem_centros" || comSemCentros) && le(v.aba));
  const [anoEscolhido, setAno] = useState<number | null>(null);
  const [ateEscolhido, setAte] = useState<number | null>(null);
  const [visaoEscolhida, setVisao] = useAbaLembrada("visao", "0");
  const visao = visoes.some((v) => v.chave === visaoEscolhida) ? visaoEscolhida : (visoes[0]?.chave ?? "");
  // O centro escolhido fica aqui: o Exportar dele vai para a linha das abas, como nas demais visões.
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const ano = anoEscolhido ?? exercicios.anos[0];
  const meses = ano ? exercicios.mesesDe(ano) : [];
  // O mês escolhido vale se foi apurado no exercício; senão, o último apurado.
  const ate = ateEscolhido && meses.includes(ateEscolhido) ? ateEscolhido : meses[meses.length - 1];
  const { grupo } = useCentroEscolhido(ano ?? 0, ate ?? 0, visao === "centros" && !!ano && !!ate, escolhido);
  // A obra e o grupo sem centro escolhidos ficam aqui, como o centro: o Exportar deles vai para a linha das abas.
  const [obra, setObra] = useState<string | null>(null);
  const [semCentro, setSemCentro] = useState<string | null>(null);
  const { codigo: obraEscolhida } = useObraEscolhida(ano ?? 0, ate ?? 0, visao === "obras" && !!ano && !!ate, obra);
  const { codigo: semCentroEscolhido } = useSemCentroEscolhido(ano ?? 0, ate ?? 0, visao === "sem_centros" && !!ano && !!ate, semCentro);
  // A linha escolhida (26/10/2026): a mesma nas abas Linhas e Rateios das Linhas.
  const [linha, setLinha] = useState<string | null>(null);
  const nasLinhas = visao === "linhas" || visao === "rateios_linhas";
  const { id: linhaEscolhida } = useLinhaEscolhida(ano ?? 0, ate ?? 0, nasLinhas && !!ano && !!ate, linha);
  const periodo = { ano, ate };
  // O Exportar (14/10/2026: na altura do título, com as opções de todas as abas): o que está na tela (a visão, o centro,
  // o grupo sem centro ou a obra escolhidos) e os "todos" de cada aba que o perfil lê.
  const veObrasNaAba = comObras && le("obras");
  const veSemCentrosNaAba = comSemCentros && le("sem_centros");
  const atual: OpcaoExportar | null =
    visao === "centros"
      ? grupo
        ? { chave: "atual", excel: "Centro de Custo Atual", pdf: "Centro de Custo Atual", params: { ...periodo, grupo } }
        : null
      : visao === "obras"
        ? obraEscolhida
          ? { chave: "atual", excel: "Obra Atual", pdf: "Obra Atual", params: { ...periodo, visao: "obras", obra: obraEscolhida } }
          : null
        : visao === "sem_centros"
          ? semCentroEscolhido
            ? { chave: "atual", excel: "Sem Centro de Custo Atual", pdf: "Sem Centro de Custo Atual", params: { ...periodo, visao: "sem_centros", grupo: semCentroEscolhido } }
            : null
          : nasLinhas
            ? linhaEscolhida
              ? { chave: "atual", excel: "Linha Atual", pdf: "Linha Atual", params: { ...periodo, visao, linha: linhaEscolhida } }
              : null
          : visao && visao !== "impostos"
            ? { chave: "atual", excel: "Visão Atual", pdf: "Visão Atual", params: { ...periodo, visao } }
            : null;
  const opcoesExportar: OpcaoExportar[] = [
    ...(atual ? [atual] : []),
    // Todas as unidades pedem as seis abas; os centros, as obras e os sem centro, a deles.
    ...(VISOES.slice(0, 6).every((v) => le(v.aba)) ? [{ chave: "unidades", excel: "Todas as Unidades (uma por aba)", pdf: "Todas as Unidades (uma por página)", params: { ...periodo, escopo: "unidades" } }] : []),
    ...(le("centros")
      ? [
          { chave: "centros", excel: "Todos os Centros de Custo (um por aba)", pdf: "Todos os Centros de Custo (um por página)", params: { ...periodo, escopo: "centros" } },
          { chave: "centros_arquivos", excel: "Todos os Centros de Custo (um arquivo por centro)", pdf: null, params: { ...periodo, escopo: "centros_arquivos" } },
        ]
      : []),
    ...(veSemCentrosNaAba ? [{ chave: "sem_centros", excel: "Todas Sem Centro de Custo (uma por aba)", pdf: "Todas Sem Centro de Custo (uma por página)", params: { ...periodo, escopo: "sem_centros" } }] : []),
    ...(le("linhas") ? [{ chave: "linhas", excel: "Todas as Linhas (uma por aba)", pdf: "Todas as Linhas (uma por página)", params: { ...periodo, escopo: "linhas" } }] : []),
    // Os Rateios das Linhas, fora da tela (27/10/2026): a aba não está no catálogo dos perfis, e ninguém a lê.
    ...(le("rateios_linhas") && !VISOES.find((v) => v.chave === "rateios_linhas")?.foraDaTela
      ? [{ chave: "rateios_linhas", excel: "Rateios das Linhas de Todas as Linhas (uma por aba)", pdf: "Rateios das Linhas de Todas as Linhas (uma por página)", params: { ...periodo, escopo: "rateios_linhas" } }]
      : []),
    ...(veObrasNaAba ? [{ chave: "obras", excel: "Todas as Obras (uma por aba)", pdf: "Todas as Obras (uma por página)", params: { ...periodo, escopo: "obras" } }] : []),
  ];

  const comparacao = useComparaCom(ano ?? null);
  return (
    <div className="space-y-6">
      <CabecalhoDaTela
        titulo="Resultados"
        comoUsar={
          <ul>
            <li>Escolha o exercício e o mês até onde ver; só as competências fechadas aparecem (os meses abertos ou em conferência ficam de fora).</li>
            <li>Escolha a visão nas abas: Consolidado, cada unidade, Centros de Custo (com a lista dos centros à esquerda), Sem Centros de Custo, Linhas (com a lista das linhas à esquerda, por unidade), Obras (com a lista das obras à esquerda, com o código e a busca por nome ou código) ou Impostos (os Créditos de Impostos). Aparecem só as abas que o seu perfil lê (Controle de Usuários / Perfis).</li>
            <li>
              Em Linhas, a DRE de cada linha de produto e de obra, da receita à Margem de Contribuição, com o % e o R$/m³ da unidade dela. A lista traz só as
              linhas das unidades (Matriz, Filial e Serviços) que o seu perfil lê. Os valores são os gravados na etapa Linhas do Fechamento Mensal; uma
              competência fechada antes da etapa aparece sem valor até alguém gravar as linhas dela lá. Os valores não abrem os lançamentos, e quem tem recorte
              por departamento ou por centro de custo não vê a aba.
            </li>
            <li>
              Em Sem Centros de Custo, os lançamentos do balancete que deveriam ter um centro de custo e não têm um do cadastro, pela regra da
              referência dos cenários analíticos: os das contas de mão de obra direta e indireta e de gastos gerais diretos, indiretos e comerciais
              (os de obra, nos centros 1.98 e 1.99, também entram). A lista à esquerda traz Produção (Matriz e Filial), Despesas Variáveis de Venda
              (Matriz e Filial), Serviços, Logística, Técnico, Comercial e Administrativo — só os que têm lançamento no período —, pelo departamento
              da conta na DRE e, na Produção e na DVV, pela filial do lançamento. Clique no valor de um mês para ver os lançamentos. Os Gastos Gerais
              Variáveis ficam de fora (nos cenários, vêm das premissas). “Exportar” baixa o grupo na tela ou todos (um por aba no Excel, um por página no PDF); o Coordenador não vê a aba.
            </li>
            <li>Em Obras, cada obra mostra a DRE dos lançamentos dos centros de obra (1.98 e 1.99) mês a mês, como a aba Obras da tela Resultados do Fechamento Mensal, com o % sobre a receita da própria obra (a ROB nas receitas e nos impostos, a ROL no resto). Nas receitas, como na DRE das unidades: as contas de Reconhecimento do CPV ficam de fora (no centro da obra, elas anulam o faturamento, porque a DRE reconhece a receita na produção); a receita prévia de frete da obra sai da Receita Bruta do Pré-Fabricado e vai à de Frete; a complementar sai da de Montagem e vai à Complementar. No alto, Produção e Serviços (PS): os volumes da obra nas Listas Operacionais (Produção, Expedição, Montagem e Acompanhamento, pelo número da obra), que dão também o R$/m³ da obra. No recorte por departamento ou por centro de custo, só as linhas que o usuário alcança (o Coordenador, com a opção de ver as obras no cadastro, as da gestão dele). “Exportar” baixa a obra na tela ou todas (uma por aba no Excel, uma por página no PDF).</li>
            <li>Em Impostos (os Créditos de Impostos), uma tabela por unidade (Matriz e Filial), no padrão do Consolidado: no alto, o Total e, embaixo, cada grupo (Matérias Primas e Gastos Gerais Variáveis, com o Frete e Descarga) com as contas dele; cada mês fechado do exercício, até o mês escolhido, tem o Creditado (R$) e o Estornado (R$), cada um com o % (sobre o valor da conta na unidade); o % do Total e dos grupos é sobre a soma das contas; um traço é o mês sem os créditos importados (Fechamento Mensal › Resultados › Impostos). O menu de níveis, a seta de cada grupo e a seta dos meses anteriores funcionam como nas demais abas. Nesta aba, o “Exportar” baixa as duas tabelas em Excel ou PDF. No recorte por departamento ou por centro de custo, a aba não aparece.</li>
            <li>O botão de seta ao lado do menu de níveis recolhe (seta para a esquerda) ou expande (seta para a direita) os meses anteriores ao escolhido. Recolhidos, a tabela mostra só as contas, o mês (realizado e orçado), os totais (realizado e orçado) e as variações; a escolha fica guardada neste navegador.</li>
            <li>A barra de rolagem lateral (a do navegador, como na tabela de Indicadores) fica presa no pé da janela enquanto a tabela está na tela; também dá para rolar com Shift + roda do mouse.</li>
            <li>Expandida, role a tabela para os lados até o mês escolhido: dele em diante, o orçado do mês, os totais, o orçado total e as variações cabem na tela. As descrições mais longas terminam em reticências; passe o mouse para lê-las inteiras.</li>
            <li>No menu de níveis (a seta antes do título da tabela), escolha Totais, Atribuições ou Contas (Produção e Serviços, os volumes, aparece em todos: recolhido em Totais e Atribuições, aberto em Contas); a seta de cada total ou atribuição (e a de Produção e Serviços) abre e fecha só aquele grupo.</li>
            <li>A tabela rola para os lados: a descrição e os rótulos ficam presos. O mês de referência (o último) e o total do exercício trazem também o valor por m³.</li>
            <li>
              “Comparação”, ao lado do período, abre o modal Comparação de Resultados Empresariais, com os cenários marcados (Forecast, Orçamento,
              Anterior e Vendido, nos Cenários Sintéticos e Analíticos), de qualquer exercício (num cenário de outro exercício, valem os mesmos meses dele): escolha o
              tipo, Padrão ou PROVA, e os cenários, e clique em Aplicar. O botão mostra a escolha: o nome da marcação, na Padrão, ou PROVA, com as cores
              dos cenários. A escolha fica guardada neste navegador e vale também no Painel de Bordo (os cards e a aba Indicadores), que tem o mesmo
              botão: mudar numa tela muda a outra, que recarrega sozinha.
            </li>
            <li>
              Na Comparação Padrão (um cenário; de início, a primeira marcação que houver, nessa ordem), nas unidades e no Consolidado, as colunas de
              rótulo preto trazem o orçado (valor, % e R$/m³): depois do mês de referência, o do mês; depois do total, o acumulado de janeiro até ele.
              Depois do orçado acumulado, a variação: Diferença (realizado − orçado), Atingimento (realizado ÷ orçado) e Eficiência (% realizado − %
              orçado, em pontos percentuais). Fora do Orçamento, as colunas trazem o nome da marcação (PREVISÃO AGO/26…). Sem cenário, zero.
            </li>
            <li>
              Na Comparação PROVA (dois a quatro dos cenários marcados), os cenários ficam lado a lado no lugar do orçado: depois do mês de referência,
              o do mês de cada um (PREVISÃO AGO/26, ORÇADO AGO/26…); depois do total, o acumulado de cada um (PREVISÃO TOTAL/2026…), sem a Diferença, o
              Atingimento e a Eficiência. Cada cenário tem a cor dos objetos PROVA dos Relatórios Executivos — o Forecast em cinza, o Orçado em preto, o
              Vendido em ouro forte e o Anterior em ouro fraco —, com as linhas nos tons mais fracos dela. Passe o mouse no rótulo para ver o nome do
              cenário. Os centros de custo, as obras e as linhas não têm orçado.
            </li>
            <li>Clique no valor de um mês, numa linha com lupa, para ver os lançamentos de origem daquele mês (ou, nas linhas de volume, as listas somadas por obra); clicar na descrição abre o mês de referência.</li>
            <li>
              No extrato, clique na conta de um lançamento contábil para ver o balancete dela no mês (o modal Balancete): os movimentos do
              balancete importado no fechamento, com a emissão, o cliente ou fornecedor e o histórico de cada um. Abre no centro
              de custo e na filial do lançamento, com a soma ao lado do valor dele; desmarque a caixa para ver a conta inteira.
            </li>
            <li>
              No Balancete, a coluna ID mostra o ID do movimento no RM (a coluna ID do Balancete (Lista)), e o botão Itens, na coluna Ações, abre os itens
              da requisição ou da nota fiscal com esse ID (as abas Requisições (Lista) e Notas Fiscais (Lista) importadas): o produto, o centro de custo, a
              conta, a quantidade e os valores. Abre com os itens do centro de custo e da conta do movimento, que somam o valor dele; desmarque a caixa para
              ver o documento inteiro, com os do movimento em amarelo. Quem contesta marca os itens do movimento e clica em “Contestar Selecionados” (no
              rodapé, à direita): a contestação leva só o valor deles para o novo centro de custo e/ou a nova conta (o item já contestado mostra o número
              da contestação). “Voltar aos Movimentos” (à esquerda) volta ao Balancete.
            </li>
            <li>
              “Regras de Rateio”, no canto de baixo do extrato, mostra as regras de rateio vigentes no mês: em cada chave (Projeto, Produção,
              Metalurgia, Armadura e Acompanhamento), como o valor se divide entre as unidades, com um card por destino (o percentual do mês e o volume);
              e os baldes diretos, que não se dividem.
            </li>
            <li>
              “Exportar”, no pé do extrato, baixa um Excel com a aba Movimentações (os lançamentos do extrato, por bloco, com o valor e a parcela na
              linha) e a aba Detalhes (os movimentos do balancete de cada lançamento, item a item: a emissão, o cliente ou fornecedor e o histórico). No
              Balancete, o “Exportar” baixa só a conta: o lançamento numa aba e os movimentos que o modal mostra (no recorte da caixa) na outra.
            </li>
            <li>
              No extrato e no balancete, o centro de custo e a conta são os que valem na DRE. Os corrigidos — pela reclassificação por conta ou por fornecedor (Cadastros da
              Apuração / Reclassificações) ou por uma contestação validada (Contestações de Gastos) — têm um ícone ao lado, que abre o original (o do balancete do
              RM) e o corrigido.
            </li>
            <li>
              No balancete, a coluna Ações tem “Contestar” (de quem edita Contestações de Gastos › Contestações › Solicitadas): o modal sugere o novo centro
              de custo (os de um departamento da DRE, com o código de três níveis, como 1.01.00000001) e/ou a nova conta de resultado (as do departamento do centro e as do Extra-Operacional) do movimento
              (as listas buscam por código ou nome) e, se quiser, o motivo. Com um centro novo de outro departamento, a conta do movimento não serve, e a nova
              conta é obrigatória. “Contestar Anteriores” e “Contestar Posteriores” levam junto os movimentos do
              mesmo fornecedor, conta e centro de custo nas competências anteriores e nas seguintes, com o total que muda. O movimento com uma contestação
              em andamento mostra o número e a situação dela; o que chega à linha pelo rateio de outra (como os da Metalurgia nas linhas de Serviços)
              mostra “Rateio”: contesta-se na linha de origem. A lupa ao lado de cada campo abre a lista inteira — os centros de custo (o departamento, a atribuição e o balde) e as Contas de Resultado (a linha e o grupo da DRE, o departamento, a atribuição e o balde) —, e clicar num item o escolhe. No canto de baixo do modal, “Regras de Rateio” mostra as regras vigentes no mês do movimento: como cada balde se divide entre as unidades.
            </li>
            <li>
              “Pesquisar”, antes do “Exportar”, abre o modal Pesquisar nos Resultados Empresariais: escolha Fornecedor ou Cliente (digite ao menos três
              letras do nome) ou Conta de Resultado (a lista do plano de contas, com busca pelo código ou pelo nome; vale a conta da DRE, com a
              reclassificação e a contestação) e clique em Pesquisar. Vêm os movimentos do balancete das competências fechadas do exercício até o mês
              escolhido, só os que o seu perfil vê (os departamentos, os centros de custo e as informações sensíveis, como no Balancete): o Mês, o Centro
              de Custo, a Atribuição, a Conta do DRE (a linha), a Conta de Resultado (na pesquisa por fornecedor) ou o Fornecedor/Cliente (na pesquisa
              por conta) e o Valor, com a soma; passe o mouse na linha para ver a emissão, a filial e o histórico. Os rótulos das colunas filtram. Na
              coluna Ações, como no Balancete, “Itens” abre os itens da requisição ou da nota fiscal do movimento (com o “Contestar Selecionados”) e
              “Contestar” (de quem edita Contestações de Gastos › Contestações › Solicitadas) abre o modal Contestar; o movimento em contestação mostra
              o número e a situação dela. Mais de 2.000 ocorrências: a tabela mostra as primeiras (a soma é a de todas); refine a pesquisa.
            </li>
            <li>
              Sem o Acesso a Informações Sensíveis no perfil (Controle de Usuários / Perfis), as linhas de Mão de Obra Direta e Indireta (Remunerações
              CLT e PJ, Horas Extras, Multas Rescisórias, Encargos e Benefícios e Pró Labore Diretoria) mostram os valores, mas não abrem o extrato, e os movimentos delas ficam fora da aba Detalhes do Exportar.
            </li>
            <li>
              “Exportar”, ao lado do período, baixa em Excel (todas as colunas) ou PDF (A4 deitada: cada mês com a participação embaixo, e o total com o %
              e o R$/m³) o que está na tela (a Visão, o Centro de Custo, o Sem Centro de Custo, a Linha ou a Obra Atual) e, de qualquer aba, todas as unidades,
              todos os centros de custo, todas sem centro de custo, todas as linhas e todas as obras (uma por aba ou por
              página). Em Excel, também um arquivo por centro de
              custo, num ZIP, com o departamento e o centro no nome de cada arquivo. Ainda em Excel, marque “Incluir a Aba Detalhes” antes de
              escolher a opção: no fim do arquivo (em cada arquivo, no ZIP) vem a aba Detalhes, como no Exportar dos extratos — os movimentos do
              balancete de cada aba exportada, item a item, em cada competência fechada (a emissão, o cliente ou fornecedor e o histórico), com a
              parte que vai à aba (nos rateios, pelo percentual do destino). A receita prévia e os lançamentos manuais não são movimentos do
              balancete e ficam fora; a aba Linhas não abre os lançamentos. Em Imagem, a Tabela Atual baixa a tabela da tela num PNG, do jeito que
              está (os níveis e os grupos abertos ou fechados, os meses recolhidos ou não), mas inteira: todas as linhas e colunas, sem os botões.
            </li>
          </ul>
        }
        sobre={
          <>
            <p>
              As visões da DRE mês a mês no exercício: o valor e a participação (%) de
              cada mês e o total do exercício; o mês de referência e o total trazem também o valor unitário (R$/m³). Os valores são os apurados (congelados) de cada
              competência fechada: as abertas e em conferência não entram em Resultados Empresariais.
            </p>
            <p>
              A participação é sobre a ROB nas receitas e nos impostos; sobre a Receita Líquida do Pré-Fabricado nos custos de produção
              (também na Filial); sobre a Receita Líquida de Montagem e a Complementar nos custos de serviços; sobre a Receita Líquida de Frete
              no Frete e Descarga (em Serviços, onde ele é o frete dos complementares — só o rateio COMPLEMENTAR —, sobre a Receita Líquida
              Complementar); e sobre a ROL no resto. O valor unitário divide a receita e os custos do pré-fabricado pela produção (m³) e os
              de montagem pela montagem (m³). Em Despesas e Extra, no RN e nos centros de custo, as bases são as do Consolidado.
            </p>
            <p>Nos centros de custo, cada mês mostra o mesmo recorte da DRE: os custos e despesas de mão de obra, gastos gerais e depreciação.</p>
            <p>
              Nas linhas, a DRE de cada unidade dividida entre as linhas dela pela etapa Linhas da apuração (a Receita Prévia nas receitas; nos custos, a tarefa
              das requisições e das notas fiscais e as regras da Alocação nas Linhas), gravada e congelada com o fechamento: a soma das linhas de uma unidade é a
              DRE dela até a Margem de Contribuição.
            </p>
            <p>
              Em Impostos (os Créditos de Impostos), em cada unidade (Matriz e Filial), as contas de Matérias Primas, de Gastos Gerais Variáveis da Produção e o
              Frete e Descarga, com o Creditado e o Estornado de cada mês fechado, em R$ e em % sobre o valor da conta na unidade (Fechamento Mensal ›
              Resultados › Impostos). O Realizado por Obra usa esses percentuais nos custos dessas contas: na venda mercantil, sem o Estornado; na venda global, sem o
              Estornado e com o Creditado reaplicado.
            </p>
          </>
        }
        acoes={
          ano && ate ? (
            <div className="flex flex-wrap items-center justify-end gap-3">
            <SeletorPeriodo
              ano={ano}
              ate={ate}
              anos={exercicios.anos}
              meses={meses}
              onAno={(a) => {
                setAno(a);
                setAte(null);
              }}
              onAte={setAte}
            />
            {/* A Comparação (21/10/2026), entre os cenários marcados (de qualquer exercício, 22/10/2026); num modal, com a Padrão e a PROVA (31/10/2026). */}
            <SeletorComparaCom comparacao={comparacao} />
            {/* O Pesquisar (11/11/2026, pedido do Adão), antes do Exportar: os movimentos de um fornecedor ou de uma conta. */}
            {visoes.length ? <PesquisarResultados ano={ano} ate={ate} /> : null}
            {/* Na aba Impostos (03/11/2026), o Exportar leva a tabela dela. */}
            {visao === "impostos" ? <ExportarImpostos ano={ano} ate={ate} /> : opcoesExportar.length && visoes.length ? <ExportarRelatorio
                caminho="resultados"
                opcoes={opcoesExportar}
                padrao={`Resultados ${ano}`}
                detalhes
                imagem={{ nome: `Resultados ${ano} - ${VISOES.find((v) => v.chave === visao)?.nome ?? ""}` }}
              /> : null}
            </div>
          ) : null
        }
      />

      {exercicios.carregando ? (
        <Carregando />
      ) : !ano || !ate ? (
        <p className="rounded-sm border border-gray-200 bg-white p-6 text-sm text-gray-600">Nenhuma competência fechada ainda.</p>
      ) : (
        <>
          {!visoes.length ? (
            <p className="rounded-sm border border-gray-200 bg-white p-6 text-sm text-gray-600">Seu perfil não tem acesso a nenhuma aba desta tela.</p>
          ) : null}
          <div className="flex items-end gap-3" hidden={!visoes.length}>
            <div className="min-w-0 flex-1">
              <Abas rotulo="Visão dos resultados" ativa={visao} onMudar={setVisao} abas={visoes.map((v) => ({ chave: v.chave, rotulo: v.nome }))} />
            </div>
          </div>
          {!visao ? null : visao === "centros" ? (
            <VisaoCentros ano={ano} ate={ate} escolhido={escolhido} onEscolher={setEscolhido} />
          ) : visao === "sem_centros" ? (
            <VisaoSemCentros ano={ano} ate={ate} escolhido={semCentro} onEscolher={setSemCentro} />
          ) : visao === "obras" ? (
            <VisaoObras ano={ano} ate={ate} escolhida={obra} onEscolher={setObra} />
          ) : nasLinhas ? (
            <VisaoLinhas ano={ano} ate={ate} escolhida={linha} onEscolher={setLinha} rateios={visao === "rateios_linhas"} />
          ) : visao === "impostos" ? (
            <VisaoImpostos ano={ano} ate={ate} />
          ) : (
            <VisaoUnidade ano={ano} ate={ate} visao={Number(visao)} nome={VISOES.find((v) => v.chave === visao)!.nome} comparaCom={comparacao.comparaCom} prova={comparacao.prova} />
          )}
        </>
      )}
    </div>
  );
}
