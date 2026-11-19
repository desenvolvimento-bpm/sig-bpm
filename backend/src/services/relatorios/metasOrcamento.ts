import { acumular, type Indicador, type Parte } from "./indicadores.js";
import { atualDe, originalDe } from "./indicadoresDoSistema.js";

/**
 * O acumulado das metas do orçamento, como a coluna Y da aba Metas do SIG BPM
 * 2026 - INDICADORES DE RESULTADO (os meses depois do mês de referência ficam
 * de fora): soma os meses ou, nas razões, é a média ponderada pela meta do
 * indicador-base (SUMPRODUCT); nos de posição, a meta do último mês. As bases
 * são as das fórmulas da coluna Y:
 *
 * - CPP e eficiências da operação: a receita líquida da produção da unidade;
 *   no Total, os acumulados da Matriz e da Filial ponderados por ela;
 * - R$/m³ e eficiências da produção: o volume produzido da unidade;
 * - CSM e eficiências da operação da montagem: a receita líquida da montagem;
 * - custos e eficiências da montagem: o rendimento;
 * - DL, DT, DC, DA e eficiência da operação total: a receita líquida total;
 * - margem das vendas: a venda do tipo; mix ampliado: a venda total;
 * - turnover: o quadro de lotação total;
 * - GME 4 (11/10/2026): a demanda gerada pela venda total; a expedida pela expedição total — como o realizado.
 *
 * As regras valem pelos nomes originais dos indicadores (os de 19/11/2026, indicadoresDoSistema.ts), e as bases saem com os
 * nomes atuais: a troca do nome não muda a meta acumulada.
 */
type Peso = string | { componentes: Array<[nome: string, peso: string]> };

const RL_MATRIZ = "Receita Líquida: Produção Matriz";
const RL_FILIAL = "Receita Líquida: Produção Filial";
const UNIDADE = /(Matriz|Filial|Total)$/;

function pesoDaMeta(nome: string): Peso | null {
  if (nome === "Custos de Produção: Matriz (CPP)") return RL_MATRIZ;
  if (nome === "Custos de Produção: Filial (CPP)") return RL_FILIAL;
  if (nome === "Custos de Produção: Total (CPP)") return { componentes: [["Custos de Produção: Matriz (CPP)", RL_MATRIZ], ["Custos de Produção: Filial (CPP)", RL_FILIAL]] };
  if (/^(Mão de Obra|Matérias Primas|Gastos Gerais|Eficiência da Produção):/.test(nome)) return `Produção (Vol.): ${nome.match(UNIDADE)![1]}`;
  if (nome === "Custos de Serviços: Montagem (CSM)") return "Receita Líquida: Montagem";
  if (nome === "Mão de Obra Direta: Montagem" || nome === "Custos e Manutenção: Guindastes" || nome.startsWith("Eficiência da Montagem:")) return "Rendimento: Montagem";
  if (/^Despesas (de Logística|Técnicas|Comerciais|Administrativas)/.test(nome) || nome === "Eficiência da Operação: Total") return "Receita Líquida: Total";
  if (nome.startsWith("Margem de Contribuição: ")) return `Venda: ${nome.slice("Margem de Contribuição: ".length)}`;
  if (nome === "Repres. do Mix Ampliado nas Vendas") return "Venda: Total";
  if (nome === "Turnover") return "Quadro de Lotação Total";
  if (nome === "Média Móvel da Demanda Gerada") return "Venda: Total";
  if (nome === "Média Móvel da Demanda Expedida") return "Expedição (Vol.): Total";
  if (nome.startsWith("Eficiência da Operação: ")) {
    if (nome.endsWith("Montagem")) return "Receita Líquida: Montagem";
    if (nome.endsWith("Matriz")) return RL_MATRIZ;
    if (nome.endsWith("Filial")) return RL_FILIAL;
    const quadro = nome.replace(/ Total$/, "");
    return { componentes: [[`${quadro} Matriz`, RL_MATRIZ], [`${quadro} Filial`, RL_FILIAL]] };
  }
  return null;
}

/** O peso com os nomes atuais das bases (as regras usam os originais). */
function comNomesAtuais(peso: Peso | null): Peso | null {
  if (!peso) return null;
  if (typeof peso === "string") return atualDe(peso);
  return { componentes: peso.componentes.map(([n, p]) => [atualDe(n), atualDe(p)]) };
}

/**
 * O acumulado da meta de um indicador nos meses dados (cada mês: as metas importadas dele, por nome; null sem
 * importação). O indicador vem do cadastro; só o modo (último mês ou acumulado) importa aqui.
 */
export function acumularMeta(
  indicador: Pick<Indicador, "nome" | "acumulado"> | undefined,
  // Cada mês: as metas pelo nome (um Map, ou só o get: as metas de cada mês do item [META|nome|ACUM], 23/10/2026).
  meses: Array<Pick<Map<string, number>, "get"> | null>,
): number | null {
  if (!indicador) return null;
  const nome = indicador.nome;
  const peso = comNomesAtuais(pesoDaMeta(originalDe(nome)));
  const partes = meses.map((m): Parte | null => {
    if (!m) return null;
    if (peso && typeof peso === "object") return { valor: null, componentes: peso.componentes.map(([n, p]) => ({ valor: m.get(n) ?? null, peso: m.get(p) ?? 0 })) };
    return { valor: m.get(nome) ?? null, peso: peso ? (m.get(peso) ?? undefined) : undefined };
  });
  return acumular({ acumulado: indicador.acumulado }, partes);
}
