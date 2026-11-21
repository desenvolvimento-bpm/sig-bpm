import { Prisma } from "../../generated/prisma/client.js";
import type { BaldeAlocacao, BaseFisica, DestinoRateio } from "../../generated/prisma/enums.js";
import { peloTexto } from "../../lib/ordemDoSqlite.js";
import { TOTAIS_DAS_LISTAS, UNIDADE_DO_DESTINO } from "../cadastros/edicao/definicoesCadastros.js";
import { CHAVES_DE_RATEIO, NOME_DA_CHAVE } from "../volumes/rateiosService.js";
import { REGRAS_DOS_PERCENTUAIS_FIXOS } from "../volumes/regrasRateio.js";
import { avisosDosRateios, mesesDoAno, type RegraDoMes } from "../volumes/vigenciaDosRateios.js";
import { conflitoDeVigencia, descreverVigencia, type RegraComVigencia } from "../volumes/vigenciasRateio.js";

/**
 * As Regras de Rateio de cada cenário analítico (21/11/2026, pedido do Adão: a aba Regras de Rateio das Configurações, depois de
 * Centros de Custo; Cadastros por cenário): a cópia das regras de Cadastros Gerais / Regras de Rateio, com que o cenário calcula os
 * rateios (percentuaisPelasRegras) e confere os meses sem regra (Congelar, Reabrir, Criar Revisão) — no lugar das regras de
 * Cadastros Gerais, que seguem valendo no Fechamento Mensal. A aba é a cópia funcional da tela do cadastro: o Novo Rateio
 * (Paramétrico: a chave, o destino — a linha dos Totais das Listas — e a vigência; Fixo: os percentuais dos quatro destinos da
 * chave, somando 100%), o clique numa regra (a paramétrica no modal dela; a fixa, no conjunto da chave e do período) e o "Trazer
 * Novos" das regras que surgiram em Cadastros Gerais. Os percentuais por linha das regras fixas ficam de fora: só a etapa Linhas do
 * fechamento os usa.
 */

type Tx = Prisma.TransactionClient;

export class RegraDoCenarioError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

const NOME_DO_DESTINO: Record<string, string> = { MATRIZ: "Matriz", FILIAL: "Filial", MONTAGEM: "Montagem", COMPLEMENTAR: "Complementar" };
const nomeDaChave = (c: string) => NOME_DA_CHAVE[c] ?? c;
const dia = (d: Date) => d.toISOString().slice(0, 10);
/** O rótulo de cada regra de um conjunto fixo ("Produção: Matriz (Fixo)") e a base dele. */
const rotuloDaRegraFixa = (base: string, destino: string) => `${base}: ${NOME_DO_DESTINO[destino] ?? destino} (Fixo)`;
const baseDoRotulo = (rotulo: string) => rotulo.replace(/: [^:]+ \(Fixo\)$/, "");

/**
 * As regras do cenário no formato do cálculo (vigenciaDosRateios): o id da regra de origem (o da cópia, na regra só do cenário) e
 * a data de alteração — a assinatura das regras do cálculo (Recalcular) segue a mesma enquanto a cópia for igual às de origem.
 */
export async function regrasDoCenario(db: Pick<Tx, "cenarioRegraRateio">, cenarioId: string): Promise<RegraDoMes[]> {
  const rs = await db.cenarioRegraRateio.findMany({
    where: { cenarioId },
    select: { id: true, origemId: true, chave: true, destino: true, vigenciaInicio: true, vigenciaFim: true, percentualFixo: true, atualizadoEm: true },
  });
  // A ordem das de Cadastros Gerais (regrasDeRateio): o início, o id (o da origem) e a chave pelo texto.
  return rs
    .map(({ origemId, ...r }) => ({ ...r, id: origemId ?? r.id }))
    .sort((a, b) => a.vigenciaInicio.getTime() - b.vigenciaInicio.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .sort(peloTexto((r) => r.chave));
}

/** Os campos de uma regra de Cadastros Gerais na cópia de um cenário. */
const daGeral = (r: Prisma.RegraRateioGetPayload<object>, cenarioId: string) => ({
  cenarioId,
  origemId: r.id,
  chave: r.chave,
  destino: r.destino,
  unidadeDestinoId: r.unidadeDestinoId,
  rotulo: r.rotulo,
  baseFisica: r.baseFisica,
  origemDoVolume: r.origemDoVolume,
  vigenciaInicio: r.vigenciaInicio,
  vigenciaFim: r.vigenciaFim,
  percentualFixo: r.percentualFixo,
  ordem: r.ordem,
  atualizadoEm: r.atualizadoEm,
});

/**
 * Tira a cópia das regras para o cenário: as do cenário `de` (a revisão e a cópia de um cenário), quando ele tem cópia; senão, as
 * de Cadastros Gerais de hoje.
 */
export async function copiarRegras(tx: Tx, cenarioId: string, de: string | null) {
  const doCenario = de ? await tx.cenarioRegraRateio.findMany({ where: { cenarioId: de } }) : [];
  if (doCenario.length) {
    await tx.cenarioRegraRateio.createMany({ data: doCenario.map(({ id: _id, criadoEm: _c, cenarioId: _ce, ...r }) => ({ ...r, cenarioId })) });
    return;
  }
  const gerais = await tx.regraRateio.findMany();
  if (gerais.length) await tx.cenarioRegraRateio.createMany({ data: gerais.map((r) => daGeral(r, cenarioId)) });
}

/** O "Trazer Novos": as regras de Cadastros Gerais ainda sem cópia no cenário (pela origem). Devolve os rótulos. */
export async function trazerNovasRegras(tx: Tx, cenarioId: string) {
  const [gerais, minhas] = await Promise.all([tx.regraRateio.findMany(), tx.cenarioRegraRateio.findMany({ where: { cenarioId }, select: { origemId: true } })]);
  const copiadas = new Set(minhas.flatMap((r) => (r.origemId ? [r.origemId] : [])));
  const novas = gerais.filter((r) => !copiadas.has(r.id));
  if (novas.length) await tx.cenarioRegraRateio.createMany({ data: novas.map((r) => daGeral(r, cenarioId)) });
  return novas.map((r) => r.rotulo);
}

type RegraDaCopia = Prisma.CenarioRegraRateioGetPayload<object>;
const comVigencia = (r: RegraDaCopia): RegraComVigencia => ({ id: r.id, chave: r.chave, destino: r.destino, inicio: r.vigenciaInicio, fim: r.vigenciaFim, fixo: r.percentualFixo !== null });

/** A data de uma vigência ("AAAA-MM-DD"). */
function dataDe(texto: string | null | undefined, campo: string, obrigatoria: boolean): Date | null {
  if (!texto) {
    if (obrigatoria) throw new RegraDoCenarioError(400, `${campo}: informe a data.`);
    return null;
  }
  const d = new Date(`${texto.slice(0, 10)}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}/.test(texto) || Number.isNaN(d.getTime())) throw new RegraDoCenarioError(400, `${campo}: data inválida.`);
  return d;
}

/**
 * A aba Regras de Rateio de um cenário: as regras da cópia (com o percentual fixo e a origem), os conjuntos fixos, as opções do
 * Novo Rateio (as chaves, os destinos paramétricos de cada uma — as linhas dos Totais das Listas — e os quatro destinos fixos) e
 * os avisos dos meses do exercício (os sem regra e os conjuntos fixos que não somam 100%).
 */
export async function abaDasRegras(tx: Pick<Tx, "cenarioRegraRateio">, cenarioId: string, ano: number) {
  const [rs, doCalculo] = await Promise.all([
    tx.cenarioRegraRateio.findMany({ where: { cenarioId }, orderBy: [{ ordem: "asc" }, { vigenciaInicio: "asc" }, { id: "asc" }] }),
    regrasDoCenario(tx, cenarioId),
  ]);
  const regras = rs.sort(peloTexto((r) => r.chave)).sort((a, b) => a.ordem - b.ordem);
  const conjuntos = new Map<string, { chave: string; inicio: string; fim: string | null; percentuais: Record<string, number>; rotulo: string }>();
  for (const r of regras.filter((x) => x.percentualFixo !== null)) {
    const k = `${r.chave}|${dia(r.vigenciaInicio)}`;
    const c = conjuntos.get(k) ?? { chave: r.chave, inicio: dia(r.vigenciaInicio), fim: r.vigenciaFim ? dia(r.vigenciaFim) : null, percentuais: {}, rotulo: baseDoRotulo(r.rotulo) };
    c.percentuais[r.destino] = Number(r.percentualFixo) * 100;
    conjuntos.set(k, c);
  }
  const doTotal = new Map(TOTAIS_DAS_LISTAS.map((t) => [t.codigo, t.rotulo]));
  return {
    regras: regras.map((r) => ({
      id: r.id,
      rotulo: r.rotulo,
      chave: r.chave,
      chaveNome: nomeDaChave(r.chave),
      destino: r.destino,
      destinoNome: NOME_DO_DESTINO[r.destino] ?? r.destino,
      origemDoVolume: r.origemDoVolume,
      origemDoVolumeNome: doTotal.get(r.origemDoVolume) ?? r.origemDoVolume,
      inicio: dia(r.vigenciaInicio),
      fim: r.vigenciaFim ? dia(r.vigenciaFim) : null,
      percentualFixo: r.percentualFixo === null ? null : Number(r.percentualFixo) * 100,
      doCenario: !r.origemId,
    })),
    conjuntos: [...conjuntos.values()],
    opcoes: {
      chaves: CHAVES_DE_RATEIO.map((chave) => ({
        chave,
        nome: nomeDaChave(chave),
        destinos: TOTAIS_DAS_LISTAS.filter((t) => t.chaves.includes(chave)).map((t) => ({ codigo: t.codigo, rotulo: t.rotulo })),
        fixos: REGRAS_DOS_PERCENTUAIS_FIXOS.filter((r) => r.chave === chave).map((r) => ({ destino: r.destino, nome: NOME_DO_DESTINO[r.destino] ?? r.destino })),
      })),
    },
    avisos: avisosDosRateios(doCalculo, mesesDoAno(ano), "Configurações / Regras de Rateio"),
  };
}

/**
 * Grava uma regra paramétrica (nova, ou a `regraId`, que não pode ser fixa): o rótulo, a chave (só na nova), o destino (a linha
 * dos Totais das Listas da chave, que dá o destino, a unidade e a base física) e a vigência. Recusa a vigência que se sobrepõe a
 * outra regra da chave no mesmo destino, ou a uma fixa da chave. Devolve a descrição para o Histórico.
 */
export async function gravarRegraParametrica(
  tx: Tx,
  cenarioId: string,
  regraId: string | null,
  dados: { rotulo: string; chave: string; origemDoVolume: string; inicio: string; fim: string | null },
) {
  const antes = regraId ? await tx.cenarioRegraRateio.findFirst({ where: { id: regraId, cenarioId } }) : null;
  if (regraId && !antes) throw new RegraDoCenarioError(404, "Regra não encontrada no cenário.");
  if (antes && antes.percentualFixo !== null) throw new RegraDoCenarioError(409, "Esta regra é de percentual fixo: edite-a no conjunto dela, com os outros destinos da chave.");
  const chave = antes?.chave ?? dados.chave;
  if (!(CHAVES_DE_RATEIO as readonly string[]).includes(chave)) throw new RegraDoCenarioError(400, "Chave de rateio inválida.");
  const rotulo = dados.rotulo.trim();
  if (!rotulo) throw new RegraDoCenarioError(400, "Dê um rótulo à regra.");
  const total = TOTAIS_DAS_LISTAS.find((t) => t.codigo === dados.origemDoVolume);
  if (!total) throw new RegraDoCenarioError(400, "Escolha o destino na lista (os totais das Listas Operacionais).");
  if (!total.chaves.includes(chave)) throw new RegraDoCenarioError(400, `O destino ${total.rotulo} não é da chave ${nomeDaChave(chave)}.`);
  const inicio = dataDe(dados.inicio, "A vigência inicial", true)!;
  const fim = dataDe(dados.fim, "A vigência final", false);
  if (fim && fim < inicio) throw new RegraDoCenarioError(400, "A vigência final é anterior à inicial.");
  const unidade = await tx.unidadeNegocio.findUnique({ where: { codigo: UNIDADE_DO_DESTINO[total.destino] ?? -1 }, select: { id: true } });
  if (!unidade) throw new RegraDoCenarioError(400, "Destino inválido.");
  const daChave = await tx.cenarioRegraRateio.findMany({ where: { cenarioId, chave: chave as BaldeAlocacao } });
  const conflito = conflitoDeVigencia({ id: regraId ?? undefined, chave, destino: total.destino, inicio, fim, fixo: false }, daChave.map(comVigencia), nomeDaChave);
  if (conflito) throw new RegraDoCenarioError(409, conflito);
  const campos = {
    rotulo,
    destino: total.destino as DestinoRateio,
    unidadeDestinoId: unidade.id,
    baseFisica: total.base as BaseFisica,
    origemDoVolume: total.codigo,
    vigenciaInicio: inicio,
    vigenciaFim: fim,
  };
  if (antes) await tx.cenarioRegraRateio.update({ where: { id: antes.id }, data: campos });
  else await tx.cenarioRegraRateio.create({ data: { ...campos, cenarioId, chave: chave as BaldeAlocacao, origemId: null, ordem: (await tx.cenarioRegraRateio.count({ where: { cenarioId } })) + 1 } });
  return `Regras de Rateio do cenário (Configurações): ${antes ? "alterada" : "incluída"} a regra ${rotulo} (${nomeDaChave(chave)}, ${descreverVigencia({ inicio, fim })})`;
}

/** Exclui uma regra paramétrica do cenário (a fixa sai com o conjunto dela). */
export async function excluirRegraParametrica(tx: Tx, cenarioId: string, regraId: string) {
  const r = await tx.cenarioRegraRateio.findFirst({ where: { id: regraId, cenarioId } });
  if (!r) throw new RegraDoCenarioError(404, "Regra não encontrada no cenário.");
  if (r.percentualFixo !== null) throw new RegraDoCenarioError(409, "Esta regra é de percentual fixo: exclua o conjunto dela.");
  await tx.cenarioRegraRateio.delete({ where: { id: r.id } });
  return `Regras de Rateio do cenário (Configurações): excluída a regra ${r.rotulo} (${nomeDaChave(r.chave)}, ${descreverVigencia({ inicio: r.vigenciaInicio, fim: r.vigenciaFim })})`;
}

/**
 * Grava um conjunto de percentuais fixos (novo, ou o de `inicioAnterior`): o percentual de cada um dos quatro destinos da chave (em
 * %, somando 100), com a mesma vigência e a base do rótulo. Recusa a vigência que se sobrepõe a outras regras da chave.
 */
export async function gravarConjuntoFixo(
  tx: Tx,
  cenarioId: string,
  dados: { chave: string; inicioAnterior: string | null; inicio: string; fim: string | null; percentuais: Record<string, number>; rotulo: string | null },
) {
  const catalogo = REGRAS_DOS_PERCENTUAIS_FIXOS.filter((r) => r.chave === dados.chave);
  if (!catalogo.length) throw new RegraDoCenarioError(400, "Chave de rateio inválida.");
  const inicio = dataDe(dados.inicio, "A vigência inicial", true)!;
  const fim = dataDe(dados.fim, "A vigência final", false);
  if (fim && fim < inicio) throw new RegraDoCenarioError(400, "A vigência final é anterior à inicial.");
  const pcts = catalogo.map((r) => ({ regra: r, valor: Number(dados.percentuais[r.destino] ?? 0) }));
  if (pcts.some((p) => !Number.isFinite(p.valor) || p.valor < 0 || p.valor > 100)) throw new RegraDoCenarioError(400, "Cada percentual vai de 0% a 100%.");
  const soma = pcts.reduce((s, p) => s + p.valor, 0);
  if (Math.abs(soma - 100) > 0.005) throw new RegraDoCenarioError(400, `Os percentuais de ${nomeDaChave(dados.chave)} somam ${soma.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%: precisam somar 100%.`);
  const daChave = await tx.cenarioRegraRateio.findMany({ where: { cenarioId, chave: dados.chave as BaldeAlocacao } });
  const anteriores = dados.inicioAnterior ? daChave.filter((r) => r.percentualFixo !== null && dia(r.vigenciaInicio) === dados.inicioAnterior) : [];
  if (dados.inicioAnterior && !anteriores.length) throw new RegraDoCenarioError(404, "O conjunto de percentuais fixos não foi encontrado no cenário.");
  const ids = new Set(anteriores.map((r) => r.id));
  const outras = daChave.filter((r) => !ids.has(r.id)).map(comVigencia);
  for (const p of pcts) {
    const conflito = conflitoDeVigencia({ chave: dados.chave, destino: p.regra.destino, inicio, fim, fixo: true }, outras, nomeDaChave);
    if (conflito) throw new RegraDoCenarioError(409, conflito);
  }
  const base = dados.rotulo?.trim() || nomeDaChave(dados.chave);
  const unidades = new Map((await tx.unidadeNegocio.findMany({ select: { id: true, codigo: true } })).map((u) => [u.codigo, u.id]));
  const ordem = await tx.cenarioRegraRateio.count({ where: { cenarioId } });
  for (const [k, p] of pcts.entries()) {
    const anterior = anteriores.find((r) => r.destino === p.regra.destino);
    const campos = { vigenciaInicio: inicio, vigenciaFim: fim, percentualFixo: new Prisma.Decimal((p.valor / 100).toFixed(6)), rotulo: rotuloDaRegraFixa(base, p.regra.destino) };
    if (anterior) await tx.cenarioRegraRateio.update({ where: { id: anterior.id }, data: campos });
    else
      await tx.cenarioRegraRateio.create({
        data: {
          ...campos,
          cenarioId,
          origemId: null,
          chave: p.regra.chave,
          destino: p.regra.destino,
          unidadeDestinoId: unidades.get(p.regra.unidade)!,
          baseFisica: p.regra.baseFisica,
          origemDoVolume: p.regra.origem,
          ordem: ordem + k + 1,
        },
      });
  }
  const texto = pcts.map((p) => `${NOME_DO_DESTINO[p.regra.destino]} ${p.valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`).join(", ");
  return `Regras de Rateio do cenário (Configurações): ${dados.inicioAnterior ? "alterados" : "incluídos"} os percentuais fixos de ${nomeDaChave(dados.chave)} (${descreverVigencia({ inicio, fim })}: ${texto})`;
}

/** Exclui um conjunto de percentuais fixos do cenário (as regras da chave com o início dado). */
export async function excluirConjuntoFixo(tx: Tx, cenarioId: string, chave: string, inicioTexto: string) {
  const doConjunto = (await tx.cenarioRegraRateio.findMany({ where: { cenarioId, chave: chave as BaldeAlocacao } })).filter((r) => r.percentualFixo !== null && dia(r.vigenciaInicio) === inicioTexto);
  if (!doConjunto.length) throw new RegraDoCenarioError(404, "O conjunto de percentuais fixos não foi encontrado no cenário.");
  await tx.cenarioRegraRateio.deleteMany({ where: { id: { in: doConjunto.map((r) => r.id) } } });
  return `Regras de Rateio do cenário (Configurações): excluídos os percentuais fixos de ${nomeDaChave(chave)} (${descreverVigencia({ inicio: doConjunto[0].vigenciaInicio, fim: doConjunto[0].vigenciaFim })})`;
}
