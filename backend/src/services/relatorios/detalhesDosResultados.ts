import { getPrismaClient } from "../../config/prisma.js";
import { codigoQueVale } from "../classificacao/centrosObra.js";
import { Prisma } from "../../generated/prisma/client.js";
import { ESTILO, type AbaEscrita, type Celula } from "../../lib/xlsxEscrita.js";
import { ACESSO_TOTAL, type Acesso } from "../acesso/acesso.js";
import { linhaSensivel, podeVerCentro, podeVerLinhaNaObra, podeVerLinhaNoCentro, podeVerMovimentos, podeVerSensiveis } from "../acesso/recorteDepartamento.js";
import type { Composicao, OrigemValor, ParcelaRateio } from "../dre/apuracaoUnidades.js";
import { grupoDoCentro } from "../dre/dreService.js";
import { foraDaObra, sinalDaLinha } from "../dre/obrasService.js";
import { deveriaTerCentro, grupoSemCentro, type GrupoSemCentro } from "../dre/semCentroService.js";

/**
 * A aba Detalhes da exportação dos Resultados em Excel (27/10/2026, pedido do Adão: a caixa “Incluir a Aba Detalhes” do
 * Exportar, como nos extratos): os movimentos do balancete de cada aba exportada, item a item, em cada competência
 * fechada do período, com a parte que vai à aba (Na Aba).
 * - Nas unidades, pelos filtros que a apuração gravou em cada linha (a composição: os lançamentos diretos, × o fator da
 *   regra, e os de rateio, × o percentual do destino), como o extrato de cada valor. O Consolidado junta as cinco.
 * - Nos centros de custo, nas obras e sem centro de custo, os lançamentos deles nas linhas da aba.
 * A receita prévia e os lançamentos manuais não são movimentos do balancete e ficam fora, como na aba Detalhes do extrato;
 * as linhas (a aba Linhas e, nos Resultados por Obra, os Rateios das Linhas) não abrem os lançamentos.
 */
export type AlvoDosDetalhes =
  | { tipo: "unidades"; unidades: number[] }
  | { tipo: "centro"; grupo: string }
  | { tipo: "obra"; codigo: string }
  | { tipo: "semCentro"; grupo: GrupoSemCentro };

/** Uma aba exportada: o nome (a coluna Aba), as linhas da DRE dela (os códigos, na ordem) e o que detalhar (sem: as linhas). */
export type AbaDetalhada = { nome: string; codigos: string[]; alvo: AlvoDosDetalhes | null };

const NOME_DA_UNIDADE: Record<number, string> = { 1: "Matriz", 2: "Filial", 3: "Serviços", 4: "Despesas e Extra", 5: "RN" };
const ROTULO_DO_RATEIO: Record<string, string> = {
  PROJETO: "Projetos Liberados",
  PRODUCAO: "Produção",
  METALURGIA: "Metalurgia",
  ARMADURA: "Armadura",
  ACOMPANHAMENTO: "Acompanhamento de Obra",
  MATRIZ: "Matriz",
  FILIAL: "Filial",
  MONTAGEM: "Montagem",
  COMPLEMENTAR: "Complementar",
};

const selecao = {
  linhaDREId: true,
  filial: true,
  balde: true,
  alocacao: true,
  valorMovimento: true,
  emissao: true,
  cliForn: true,
  historico: true,
  centroCustoId: true,
  codigoCentroCusto: true,
  nomeCentroCusto: true,
  centroCusto: { select: { codigoRM: true, nomeRM: true } },
  contaResultado: { select: { reduzido: true, descricao: true } },
  contaAdotada: { select: { reduzido: true, descricao: true } },
} satisfies Prisma.LancamentoContabilSelect;
type Movimento = Prisma.LancamentoContabilGetPayload<{ select: typeof selecao }>;
type LinhaDaDRE = { id: string; codigo: string; descricao: string; tipo: string; grupoSigla: string; atribuicaoSigla: string | null };

const COLUNAS: Array<[string, number, boolean?]> = [
  ["Aba", 18],
  ["Mês", 8],
  ["Linha da DRE", 40],
  ["Bloco", 40],
  ["Filial", 7],
  ["Centro de Custo", 16],
  ["Nome do Centro de Custo", 30],
  ["Conta", 10],
  ["Descrição da Conta", 34],
  ["Conta do Balancete", 12],
  ["Balde", 15],
  ["Emissão", 11],
  ["Cliente/Fornecedor", 32],
  ["Histórico", 50],
  ["Valor", 16, true],
  ["Na Aba", 16, true],
];

const texto = (v: string | number | null | undefined): Celula => ({ valor: v ?? null, estilo: ESTILO.item });
const moeda = (v: Prisma.Decimal): Celula => ({ valor: Number(v), estilo: ESTILO.itemMoeda });
const dataCurta = (d: Date | null) => (d ? d.toISOString().slice(0, 10).split("-").reverse().join("/") : null);
const naoRateio = (m: Movimento) => m.alocacao !== "RATEIO";
/** A linha pelo caminho do código, único na DRE ("CPP › GGI › Água, Energia, Gás, Telefone e Internet"): as descrições se repetem entre os grupos. */
export const rotuloDaLinha = (l: { codigo: string; descricao: string }) => [...l.codigo.split(".").slice(0, -1), l.descricao].join(" › ");

/** Os movimentos de um filtro direto da composição (os de `blocoContabil` do detalhamento). */
function doFiltro(ms: Movimento[], f: NonNullable<OrigemValor["contabil"]>) {
  return ms.filter(
    (m) =>
      naoRateio(m) &&
      (f.filial === undefined || m.filial === f.filial) &&
      (!f.baldes || (m.balde !== null && f.baldes.includes(m.balde))) &&
      (!f.excetoBaldes || m.balde === null || !f.excetoBaldes.includes(m.balde)) &&
      (!f.pares || f.pares.some((p) => m.balde === p.balde && (p.filial === undefined || m.filial === p.filial))),
  );
}

/**
 * O construtor da aba, com os movimentos de cada competência lidos uma vez (vários arquivos do mesmo pedido, como um por
 * centro de custo, usam o mesmo).
 */
export async function detalhesDosResultados(ano: number, ate: number, acesso: Acesso = ACESSO_TOTAL) {
  const prisma = getPrismaClient();
  const competencias = await prisma.competencia.findMany({ where: { ano, mes: { lte: ate }, status: "FECHADA" }, select: { id: true, mes: true }, orderBy: { mes: "asc" } });
  const linhas = await prisma.linhaDRE.findMany({ select: { id: true, codigo: true, descricao: true, tipo: true, grupoSigla: true, atribuicaoSigla: true } });
  const porId = new Map<string, LinhaDaDRE>(linhas.map((l) => [l.id, l]));
  const movimentos = new Map<string, Map<string, Movimento[]>>();
  const centros = await prisma.centroCusto.findMany({ select: { id: true, nomeControladoria: true, departamento: true } });

  async function doMes(competenciaId: string) {
    const ja = movimentos.get(competenciaId);
    if (ja) return ja;
    // Os redistribuídos (13/11/2026) pelas partes: o valor e o centro de cada destino, com o detalhe do movimento.
    const [diretos, partes] = await Promise.all([
      prisma.lancamentoContabil.findMany({ where: { competenciaId, redistribuicaoId: null }, select: selecao, orderBy: [{ linhaArquivo: "asc" }, { id: "asc" }] }),
      prisma.lancamentoRedistribuido.findMany({
        where: { competenciaId },
        select: {
          linhaDREId: true,
          filial: true,
          balde: true,
          alocacao: true,
          valorMovimento: true,
          centroCustoId: true,
          centroCusto: { select: { codigoRM: true, nomeRM: true } },
          lancamentoContabil: { select: { emissao: true, cliForn: true, historico: true, codigoCentroCusto: true, nomeCentroCusto: true, contaResultado: { select: { reduzido: true, descricao: true } }, contaAdotada: { select: { reduzido: true, descricao: true } } } },
        },
        orderBy: [{ lancamentoContabil: { linhaArquivo: "asc" } }, { id: "asc" }],
      }),
    ]);
    const ms: Movimento[] = [...diretos, ...partes.map(({ lancamentoContabil: l, ...p }) => ({ ...l, ...p }))];
    const porLinha = new Map<string, Movimento[]>();
    for (const m of ms) if (m.linhaDREId) porLinha.set(m.linhaDREId, [...(porLinha.get(m.linhaDREId) ?? []), m]);
    movimentos.set(competenciaId, porLinha);
    return porLinha;
  }

  /** A aba Detalhes das abas exportadas (`titulo`: o do arquivo). */
  async function aba(abas: AbaDetalhada[], titulo: string, notas: string[] = []): Promise<AbaEscrita> {
    const linhasDaAba: Celula[][] = [
      [{ valor: `Detalhes · ${titulo}`, estilo: ESTILO.titulo }],
      [
        {
          valor:
            "Os movimentos do balancete (aba Balancete (Lista) do LISTAS REALIZADO (RESULTADOS)) de cada aba exportada, item a item, em cada competência fechada do período, com a parte que vai à aba (Na Aba): nos rateios, × o percentual do destino. A receita prévia e os lançamentos manuais não são movimentos do balancete e ficam fora.",
          estilo: ESTILO.informacao,
        },
      ],
      ...notas.map((n) => [{ valor: n, estilo: ESTILO.informacao }]),
      [],
    ];
    // Só as linhas (sem lançamentos): a aba fica com o aviso, sem o cabeçalho das colunas.
    const comMovimentos = abas.some((a) => a.alvo);
    const cabecalho = linhasDaAba.length + 1;
    if (comMovimentos) linhasDaAba.push(COLUNAS.map(([valor, , direita]) => ({ valor, estilo: direita ? ESTILO.cabecalhoDireita : ESTILO.cabecalho })));
    let algumDetalhe = false;
    let algumMovimento = false;
    const semLancamentos: string[] = [];

    for (const a of abas) {
      if (!a.alvo) {
        semLancamentos.push(a.nome);
        continue;
      }
      const ordem = new Map(a.codigos.map((c, i) => [c, i]));
      // Sem o Acesso a Informações Sensíveis (27/10/2026), sem os movimentos da Mão de Obra Direta e Indireta.
      const naAba = (l: LinhaDaDRE | undefined): l is LinhaDaDRE => !!l && ordem.has(l.codigo) && podeVerSensiveis(acesso, l);
      let soma = new Prisma.Decimal(0);
      let somaNaAba = new Prisma.Decimal(0);
      for (const c of competencias) {
        const porLinha = await doMes(c.id);
        const rotuloMes = `${String(c.mes).padStart(2, "0")}/${ano}`;
        // As partes do mês: a linha da aba, o bloco, os movimentos e o fator de cada um.
        const partes: Array<{ linha: LinhaDaDRE; bloco: string; ms: Movimento[]; fator: (m: Movimento) => Prisma.Decimal }> = [];
        const alvo = a.alvo;
        if (alvo.tipo === "unidades") {
          const gravados = await prisma.resultadoApurado.findMany({
            where: { competenciaId: c.id, centroCustoId: null, unidadeNegocio: { codigo: { in: alvo.unidades } } },
            select: { linhaDREId: true, composicao: true, unidadeNegocio: { select: { codigo: true } } },
          });
          for (const g of gravados) {
            const linha = porId.get(g.linhaDREId);
            const comp = g.composicao as Composicao | null;
            if (!naAba(linha) || !comp || !podeVerMovimentos(acesso, linha)) continue;
            const unidade = g.unidadeNegocio!.codigo;
            const prefixo = alvo.unidades.length > 1 ? `${NOME_DA_UNIDADE[unidade] ?? unidade} · ` : "";
            const o = comp.origem ?? {};
            if (o.contabil) {
              const f = o.contabil;
              const fator = new Prisma.Decimal(f.fator ?? 1);
              partes.push({ linha, bloco: `${prefixo}Lançamentos Contábeis Diretos`, ms: doFiltro(porLinha.get(f.linhaId) ?? [], f), fator: () => fator });
            }
            if (o.contabilPar) {
              const f = o.contabilPar;
              partes.push({ linha, bloco: `${prefixo}Lançamentos Contábeis Diretos da Linha da Montagem`, ms: doFiltro(porLinha.get(f.linhaId) ?? [], f), fator: () => new Prisma.Decimal(1) });
            }
            for (const r of (comp.rateios ?? []) as ParcelaRateio[]) {
              // A parcela com os percentuais de outra competência é só de lançamentos manuais, que ficam fora.
              if (!r.linhaId || r.competenciaId) continue;
              const p = new Prisma.Decimal(r.percentual);
              const ms = (porLinha.get(r.linhaId) ?? []).filter((m) => m.alocacao === "RATEIO" && m.balde === r.chave);
              partes.push({ linha, bloco: `${prefixo}Rateio: ${ROTULO_DO_RATEIO[r.chave] ?? r.chave} → ${ROTULO_DO_RATEIO[r.destino] ?? r.destino}`, ms, fator: () => p });
            }
          }
        } else if (alvo.tipo === "centro") {
          const ids = new Set(centros.filter((x) => grupoDoCentro(x) === alvo.grupo && podeVerCentro(acesso, x)).map((x) => x.id));
          for (const [linhaId, ms] of porLinha) {
            const linha = porId.get(linhaId);
            if (!naAba(linha) || !podeVerLinhaNoCentro(acesso, linha)) continue;
            partes.push({ linha, bloco: "Lançamentos Contábeis", ms: ms.filter((m) => m.centroCustoId !== null && ids.has(m.centroCustoId)), fator: () => new Prisma.Decimal(1) });
          }
        } else if (alvo.tipo === "obra") {
          for (const [linhaId, ms] of porLinha) {
            const linha = porId.get(linhaId);
            if (!naAba(linha) || !podeVerLinhaNaObra(acesso, linha)) continue;
            // O sinal da DRE (as receitas trocadas), como na aba Obras; sem as contas de Reconhecimento do CPV nas receitas (03/11/2026).
            const fator = new Prisma.Decimal(sinalDaLinha(linha.codigo));
            // A obra pelo centro que vale (13/11/2026): sem os movimentos que saíram dela.
            const daObra = ms.filter((m) => codigoQueVale(m) === alvo.codigo && !foraDaObra(linha.codigo, m.contaAdotada ?? m.contaResultado));
            partes.push({ linha, bloco: "Lançamentos Contábeis", ms: daObra, fator: () => fator });
          }
        } else {
          for (const [linhaId, ms] of porLinha) {
            const linha = porId.get(linhaId);
            if (!naAba(linha) || !deveriaTerCentro(linha)) continue;
            partes.push({ linha, bloco: "Lançamentos Contábeis", ms: ms.filter((m) => m.centroCustoId === null && grupoSemCentro(linha.codigo, m.filial) === alvo.grupo), fator: () => new Prisma.Decimal(1) });
          }
        }
        partes.sort((x, y) => (ordem.get(x.linha.codigo) ?? 0) - (ordem.get(y.linha.codigo) ?? 0));
        for (const p of partes) {
          for (const m of p.ms) {
            const adotada = m.contaAdotada && m.contaAdotada.reduzido !== m.contaResultado.reduzido ? m.contaAdotada : null;
            const conta = adotada ?? m.contaResultado;
            // Sem arredondar (o Excel mostra 2 casas): a soma fecha com a dos blocos contábeis e de rateio dos extratos.
            const naLinha = m.valorMovimento.times(p.fator(m));
            if (m.emissao || m.cliForn || m.historico) algumDetalhe = true;
            algumMovimento = true;
            linhasDaAba.push([
              texto(a.nome),
              texto(rotuloMes),
              texto(rotuloDaLinha(p.linha)),
              texto(p.bloco),
              texto(m.filial),
              texto(m.centroCusto?.codigoRM ?? m.codigoCentroCusto),
              texto(m.centroCusto?.nomeRM ?? m.nomeCentroCusto),
              texto(conta.reduzido),
              texto(conta.descricao),
              texto(adotada ? m.contaResultado.reduzido : null),
              texto(m.balde),
              texto(dataCurta(m.emissao)),
              texto(m.cliForn),
              texto(m.historico),
              moeda(m.valorMovimento),
              moeda(naLinha),
            ]);
            soma = soma.plus(m.valorMovimento);
            somaNaAba = somaNaAba.plus(naLinha);
          }
        }
      }
      linhasDaAba.push([
        { valor: `Soma · ${a.nome}`, estilo: ESTILO.destaque },
        ...Array.from({ length: COLUNAS.length - 3 }, () => ({ valor: null, estilo: ESTILO.destaque })),
        { valor: Number(soma), estilo: ESTILO.destaqueMoeda },
        { valor: Number(somaNaAba), estilo: ESTILO.destaqueMoeda },
      ]);
    }
    // As linhas sensíveis que ficaram de fora (27/10/2026), no aviso.
    const porCodigo = new Map(linhas.map((l) => [l.codigo, l]));
    const semSensiveis = !acesso.informacoesSensiveis && abas.some((a) => a.alvo && a.codigos.some((c) => { const l = porCodigo.get(c); return !!l && linhaSensivel(l); }));
    const avisos = [
      ...(semLancamentos.length ? [`${semLancamentos.join(", ")}: as linhas não abrem os lançamentos, e ficam fora desta aba.`] : []),
      ...(semSensiveis ? ["Os movimentos das linhas de Mão de Obra Direta e Indireta são informações sensíveis, e ficam fora desta aba: o seu perfil não tem acesso a elas."] : []),
      ...(algumMovimento && !algumDetalhe ? ["O balancete do período foi importado sem o detalhe dos movimentos: cada linha é a soma da filial, do centro de custo e da conta."] : []),
    ];
    linhasDaAba.splice(2, 0, ...avisos.map((v) => [{ valor: v, estilo: ESTILO.aviso }]));
    return {
      nome: "Detalhes",
      larguras: COLUNAS.map(([, w]) => w),
      linhas: linhasDaAba,
      linhaCabecalho: comMovimentos ? cabecalho + avisos.length : undefined,
      rodape: `Detalhes · ${titulo}`,
      paisagem: true,
    };
  }

  return { aba };
}
