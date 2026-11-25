import { getPrismaClient } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { alcancaLista, type Acesso } from "../acesso/acesso.js";
import { LINHAS_TOTAIS, linhaDosTotais, type CodigoTotais, type ItemVolume } from "../volumes/totaisOperacao.js";
import { VOLUMES_DA_DRE } from "./apuracaoUnidades.js";
import { RegraDREError } from "./dreService.js";
import { chaveDaLinha } from "../../lib/linhas.js";
import { numeroDaObra } from "../resultadosLinha/alocacaoNasLinhas.js";
import { descricaoDeOrigem } from "./descricaoDeOrigem.js";

const Decimal = Prisma.Decimal;

/** Uma linha do extrato: os registros da mesma obra, linha e destino somados. */
export type LinhaVolume = {
  obra: string | null;
  obraNome: string | null;
  /** A linha da aba Totais em que os registros entram, ex.: "(P) Pré-Fabricado: Matriz". */
  destino: string;
  linha: string | null;
  quantidade: string;
  registros: number;
};

type Registro = {
  quantidade: Prisma.Decimal;
  unidadeNegocio: { codigo: number } | null;
  obra: { codigo: string; nome: string; tipoVenda: string | null } | null;
  linha?: { nome: string; codigo: string } | null;
  categoria?: string | null;
  finalidade?: string | null;
  etapa?: string | null;
};

/** Os registros das listas do mês, de cada tipo pedido. */
async function registrosDasListas(competenciaId: string, tipos: Array<ItemVolume["tipo"]>) {
  const prisma = getPrismaClient();
  const where = { competenciaId };
  const base = {
    quantidade: true,
    unidadeNegocio: { select: { codigo: true } },
    obra: { select: { codigo: true, nome: true, tipoVenda: true } },
  } as const;
  const comLinha = { ...base, linha: { select: { nome: true, codigo: true } } } as const;
  const buscar: Record<ItemVolume["tipo"], () => Promise<Registro[]>> = {
    PROJETO: () => prisma.projeto.findMany({ where, select: comLinha }),
    PRODUCAO: () => prisma.producao.findMany({ where, select: comLinha }),
    PRODUCAO_PISTA: () => prisma.producaoPista.findMany({ where, select: comLinha }),
    PRODUCAO_ARMADURA: () => prisma.producaoArmadura.findMany({ where, select: { ...comLinha, categoria: true } }),
    PRODUCAO_METALURGIA: () => prisma.producaoMetalurgia.findMany({ where, select: { ...base, finalidade: true } }),
    EXPEDICAO: () => prisma.expedicao.findMany({ where, select: comLinha }),
    MONTAGEM: () => prisma.montagem.findMany({ where, select: comLinha }),
    ACOMPANHAMENTO: () => prisma.acompanhamento.findMany({ where, select: { ...comLinha, etapa: true } }),
  };
  return Promise.all(tipos.map(async (t) => ({ tipo: t, registros: await buscar[t]() })));
}

/** A linha da aba Totais em que o registro entra (a regra da apuração). */
const destinoDoRegistro = (tipo: ItemVolume["tipo"], r: Registro) =>
  linhaDosTotais({
    tipo,
    quantidade: r.quantidade,
    unidade: r.unidadeNegocio?.codigo ?? null,
    linha: r.linha ? chaveDaLinha(r.linha.codigo) : null,
    obraGlobal: r.obra?.tipoVenda === "GLOBAL",
    categoria: r.categoria ?? null,
    finalidade: r.finalidade ?? null,
    etapa: r.etapa ?? null,
  });

/**
 * Os volumes de cada obra no mês (30/10/2026, pedido do Adão: o grupo PS na aba Obras): em cada linha de volume da DRE (P
 * e S), os registros das listas que entram nela em alguma unidade (a regra de volumesDaLinha, sem a unidade), somados pelo
 * número da obra (`numeroDaObra`: o do código da obra nas listas, o do centro de obra no balancete). Com `numero`, só os
 * dessa obra.
 */
export async function volumesDasObras(competenciaId: string, linhas: Array<{ codigo: string; tipo: string; grupoSigla: string | null; descricao: string }>, numero?: string) {
  // Cada linha da aba Totais na linha de volume da DRE com a mesma descrição de origem (25/11/2026), em todas as unidades.
  const linhaDoCodigo = new Map<CodigoTotais, string>();
  for (const l of linhas) {
    if (l.tipo !== "ITEM" || (l.grupoSigla !== "P" && l.grupoSigla !== "S")) continue;
    for (const porOrigem of Object.values(VOLUMES_DA_DRE)) for (const c of porOrigem[descricaoDeOrigem(l.codigo)] ?? []) linhaDoCodigo.set(c, l.codigo);
  }
  const tipos = [...new Set(LINHAS_TOTAIS.filter((t) => linhaDoCodigo.has(t.codigo)).map((t) => t.tipo))];
  const obras = new Map<string, Map<string, Prisma.Decimal>>();
  for (const { tipo, registros } of await registrosDasListas(competenciaId, tipos)) {
    for (const r of registros) {
      const obra = numeroDaObra(r.obra?.codigo);
      if (!obra || (numero !== undefined && obra !== numero)) continue;
      const destino = destinoDoRegistro(tipo, r);
      const codigo = destino ? linhaDoCodigo.get(destino) : undefined;
      if (!codigo) continue;
      const v = obras.get(obra) ?? new Map<string, Prisma.Decimal>();
      v.set(codigo, (v.get(codigo) ?? new Decimal(0)).plus(r.quantidade));
      obras.set(obra, v);
    }
  }
  return obras;
}

/**
 * As listas operacionais que formam uma linha de volume da DRE (Produção,
 * Pistas, Metalurgia, Expedição, Montagem, Acompanhamento), somadas por obra.
 * Os registros entram pela mesma regra da aba Totais que a apuração usa
 * (linhaDosTotais), e as linhas dos Totais de cada unidade são as da apuração
 * (VOLUMES_DA_DRE). As listas são as de hoje: se mudaram depois da apuração,
 * o total difere do valor apurado.
 */
export async function volumesDaLinha(ano: number, mes: number, codigoLinha: string, unidade: number | null, acesso: Acesso, obra?: string, obras?: string[]) {
  // Com as obras (03/11/2026: a venda do Realizado por Obra, com as obras numeradas), só os registros delas, pelo código.
  const dasObras = obras ? new Set(obras.map((o) => o.trim().toUpperCase())) : null;
  const prisma = getPrismaClient();
  const [competencia, linhaDRE] = await Promise.all([
    prisma.competencia.findUnique({ where: { ano_mes: { ano, mes } }, select: { id: true } }),
    prisma.linhaDRE.findUnique({ where: { codigo: codigoLinha }, select: { descricao: true, grupoSigla: true } }),
  ]);
  if (!competencia) throw new RegraDREError(404, "Competência não encontrada.");
  if (!linhaDRE || (linhaDRE.grupoSigla !== "P" && linhaDRE.grupoSigla !== "S")) throw new RegraDREError(400, "A linha não é de volume.");

  const unidades = unidade === null ? Object.keys(VOLUMES_DA_DRE).map(Number) : [unidade];
  const codigos = new Set<CodigoTotais>(unidades.flatMap((u) => VOLUMES_DA_DRE[u]?.[descricaoDeOrigem(codigoLinha)] ?? []));
  const totais = LINHAS_TOTAIS.filter((t) => codigos.has(t.codigo));
  const tipos = [...new Set(totais.map((t) => t.tipo))];
  for (const t of tipos) {
    if (!alcancaLista(acesso, t)) throw new RegraDREError(403, "Esta lista não é de um setor seu.");
  }

  const porTipo = await registrosDasListas(competencia.id, tipos);

  const rotulo = new Map(LINHAS_TOTAIS.map((t) => [t.codigo, t.rotulo] as const));
  const grupos = new Map<string, LinhaVolume & { soma: Prisma.Decimal }>();
  let total = new Decimal(0);
  for (const { tipo, registros } of porTipo) {
    for (const r of registros) {
      // Com a obra (30/10/2026: a linha de volume na aba Obras), só os registros dela, pelo número.
      if (obra !== undefined && numeroDaObra(r.obra?.codigo) !== numeroDaObra(obra)) continue;
      if (dasObras && !dasObras.has(r.obra?.codigo.trim().toUpperCase() ?? "")) continue;
      const destino = destinoDoRegistro(tipo, r);
      if (!destino || !codigos.has(destino)) continue;
      const chave = [r.obra?.codigo ?? "", destino, r.linha?.nome ?? ""].join("|");
      const g = grupos.get(chave) ?? {
        obra: r.obra?.codigo ?? null,
        obraNome: r.obra && r.obra.nome !== r.obra.codigo ? r.obra.nome : null,
        destino: rotulo.get(destino) ?? destino,
        linha: r.linha?.nome ?? null,
        quantidade: "0",
        registros: 0,
        soma: new Decimal(0),
      };
      g.soma = g.soma.plus(r.quantidade);
      g.registros++;
      grupos.set(chave, g);
      total = total.plus(r.quantidade);
    }
  }

  const linhas: LinhaVolume[] = [...grupos.values()]
    .map(({ soma, ...g }) => ({ ...g, quantidade: soma.toFixed(6) }))
    .sort((a, b) => (a.obra ?? "").localeCompare(b.obra ?? "") || a.destino.localeCompare(b.destino) || (a.linha ?? "").localeCompare(b.linha ?? ""));
  return {
    linha: linhaDRE.descricao,
    medida: totais[0]?.medida ?? null,
    destinos: totais.map((t) => t.rotulo),
    total: total.toFixed(6),
    linhas,
  };
}
