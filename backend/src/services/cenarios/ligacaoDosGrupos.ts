import { getPrismaClient } from "../../config/prisma.js";
import { grupoDoCentro } from "../dre/dreService.js";

/**
 * A ligação dos grupos de centros de custo pelo Código RM (24/11/2026, pedido do Adão: o Nome Controladoria se troca nos Cadastros
 * Gerais e nos cenários, cada um com o seu, e as telas que comparam continuam ligadas). Um grupo de um lado corresponde ao grupo do
 * outro em que estão os mesmos centros: pelo centro de origem (o ID dos Cadastros Gerais, que a cópia de cada cenário guarda) ou,
 * sem ele, pelo Código RM. Vale nas comparações do realizado com o cenário (a aba Departamentos de Resultados Empresariais) e de
 * um cenário com o comparado dele (as abas Departamentos e Centros de Custo dos Resultados dos cenários).
 *
 * Um grupo cujos centros estão todos num só grupo do outro lado se liga a ele (vários grupos que caem no mesmo somam). Sem nenhum
 * centro em comum, ou com centros espalhados por mais de um grupo do outro lado, o grupo fica com o próprio nome (e se encontra
 * pelo nome, como antes), para nenhum valor ir para o grupo errado.
 */

export type CentroDaLigacao = { origemId: string | null; codigo: string | null };
export type GrupoDaLigacao = { grupo: string; centros: CentroDaLigacao[] };

/** Para cada grupo de `de`, o nome do grupo de `para` com os mesmos centros (ou o próprio nome, sem um só correspondente). */
export function ligarGrupos(de: GrupoDaLigacao[], para: GrupoDaLigacao[]): Map<string, string> {
  const porOrigem = new Map<string, string>();
  const porCodigo = new Map<string, string>();
  for (const g of para) {
    for (const c of g.centros) {
      if (c.origemId) porOrigem.set(c.origemId, g.grupo);
      if (c.codigo) porCodigo.set(c.codigo, g.grupo);
    }
  }
  const ligacao = new Map<string, string>();
  for (const g of de) {
    const alvos = new Set<string>();
    for (const c of g.centros) {
      const alvo = (c.origemId ? porOrigem.get(c.origemId) : undefined) ?? (c.codigo ? porCodigo.get(c.codigo) : undefined);
      if (alvo) alvos.add(alvo);
    }
    ligacao.set(g.grupo, alvos.size === 1 ? [...alvos][0] : g.grupo);
  }
  return ligacao;
}

/** Os grupos de `de` que se ligam ao grupo `alvo` de `para` (pelo nome, quando nenhum se liga pelos centros). */
export function gruposQueLigam(de: GrupoDaLigacao[], para: GrupoDaLigacao[], alvo: string): string[] {
  const ligados = [...ligarGrupos(de, para)].filter(([, p]) => p === alvo).map(([d]) => d);
  return ligados.length ? ligados : [alvo];
}

/** Os valores por grupo (conta → os meses) com o nome do grupo ligado; os grupos que caem no mesmo somam mês a mês. */
export function juntarPelaLigacao(valores: Map<string, Map<string, number[]>>, ligacao: Map<string, string>): Map<string, Map<string, number[]>> {
  const r = new Map<string, Map<string, number[]>>();
  for (const [grupo, contas] of valores) {
    const nome = ligacao.get(grupo) ?? grupo;
    const destino = r.get(nome) ?? new Map<string, number[]>();
    for (const [conta, lista] of contas) {
      const soma = destino.get(conta);
      destino.set(conta, soma ? soma.map((v, k) => v + (lista[k] ?? 0)) : [...lista]);
    }
    r.set(nome, destino);
  }
  return r;
}

/** Os grupos do realizado (os de Resultados Empresariais: o Nome Controladoria de cada centro dos Cadastros Gerais, ativo ou não). */
export async function gruposDoRealizado(): Promise<GrupoDaLigacao[]> {
  const centros = await getPrismaClient().centroCusto.findMany({ select: { id: true, codigoRM: true, nomeControladoria: true } });
  const porGrupo = new Map<string, CentroDaLigacao[]>();
  for (const c of centros) {
    const g = grupoDoCentro(c);
    porGrupo.set(g, [...(porGrupo.get(g) ?? []), { origemId: c.id, codigo: c.codigoRM }]);
  }
  return [...porGrupo].map(([grupo, cs]) => ({ grupo, centros: cs }));
}
