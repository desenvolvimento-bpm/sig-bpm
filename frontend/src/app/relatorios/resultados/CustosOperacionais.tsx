"use client";

import { type ColunaExportavel, ExportarTabela } from "@/components/shared/ExportarTabela";

import { TabelaLarga } from "../components/TabelaLarga";
import { formato, type CustosOperacionais } from "../services/relatoriosService";

/**
 * A aba Custos Operacionais da tela Resultados (26/11/2026, pedido do Adão), em Resultados Empresariais e nos Cenários
 * (Sintéticos e Analíticos): os custos de produção (Matriz e Filial) e de serviços em R$/dia ou em R$/m³, com a média de cada
 * trimestre e a Média Mensal e, contra a Média Mensal do comparado (que fica na dica, sem coluna própria), a Diferença e o
 * Atingimento — sem a Eficiência, porque os valores não têm %.
 */

type LinhaDeCusto = CustosOperacionais["linhas"][number];

const valor = (v: number | null) => (v === null ? "—" : formato.valor(v));
/** A Média Mensal menos a do comparado; sem um dos dois, null. */
const diferencaDe = (l: LinhaDeCusto) => (l.media === null || l.comparado === null ? null : l.media - l.comparado);
/** O texto com o sinal: + nos positivos; o que arredonda para zero fica sem sinal. */
function comSinal(v: number) {
  const t = formato.valor(v);
  if (!/[1-9]/.test(t)) return t.replace("-", "");
  return v > 0 ? `+${t}` : t;
}
const textoDaDiferenca = (l: LinhaDeCusto) => {
  const d = diferencaDe(l);
  return d === null ? "—" : comSinal(d);
};
/** O Atingimento: a Média Mensal sobre a do comparado menos 100%, com o sinal; o comparado zero (ou sem ele), traço. */
const textoDoAtingimento = (l: LinhaDeCusto) => (l.media === null || !l.comparado ? "—" : formato.atingimento(l.media / l.comparado));

/** "JAN/26, FEV/26 e MAR/26". */
const lista = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}` : (xs[0] ?? ""));
/** Os meses de um trimestre (ou da média) na dica do rótulo. */
const dicaDosMeses = (meses: string[], oQue: string) => (meses.length ? `${oQue}: ${lista(meses)}` : `${oQue}: nenhum mês`);

/** O nome do comparado nas dicas: o rótulo e, se diferente, o cenário. */
const nomeDoComparado = (c: NonNullable<CustosOperacionais["comparado"]>) => (c.nome && c.nome !== c.rotulo ? `${c.rotulo} (${c.nome})` : c.rotulo);

export function TabelaCustosOperacionais({ dados, titulo }: { dados: CustosOperacionais; titulo: string }) {
  const comparado = dados.comparado;
  const th = "px-2 py-2 text-right text-xs font-bold whitespace-nowrap text-gray-900";
  const td = "px-2 py-1.5 text-right whitespace-nowrap";
  const larguras = [420, ...dados.trimestres.map(() => 124), 120, ...(comparado ? [112, 116] : [])];
  return (
    <TabelaLarga
      larguras={larguras}
      cabecalho={
        <tr className="border-b border-gray-300">
          <th className="left-0 !z-20 px-3 py-2 text-left">
            <span className="block truncate text-sm font-bold tracking-wide whitespace-nowrap text-gray-900 uppercase" title={titulo}>
              {titulo}
            </span>
          </th>
          {dados.trimestres.map((t, k) => (
            <th key={t.rotulo} className={`${th} ${k === 0 ? "border-l border-gray-300" : ""} !whitespace-normal leading-tight`} title={dicaDosMeses(t.meses, `Os meses do ${t.rotulo}`)}>
              MÉDIA {t.rotulo.toUpperCase()}
            </th>
          ))}
          <th className={`${th} border-l border-gray-300`} title={dicaDosMeses(dados.mesesDaMedia, "Os meses da Média Mensal")}>
            MÉDIA MENSAL
          </th>
          {comparado ? (
            <>
              <th className={`${th} border-l border-gray-300`} title={`A Média Mensal menos a de ${nomeDoComparado(comparado)}`}>
                DIFERENÇA
              </th>
              <th className={th} title={`A Média Mensal sobre a de ${nomeDoComparado(comparado)}, menos 100%`}>
                ATINGIMENTO
              </th>
            </>
          ) : null}
        </tr>
      }
      corpo={dados.linhas.map((l) => {
        // A Média Mensal do comparado na dica das variações (sem coluna própria, pedido do Adão).
        const dicaDoComparado = comparado
          ? comparado.nome === null
            ? `Nenhum cenário marcado como ${comparado.rotulo}`
            : `Média Mensal de ${nomeDoComparado(comparado)}: ${valor(l.comparado)}`
          : undefined;
        return (
          <tr key={l.chave} className="border-t border-gray-100">
            <td className="sticky left-0 z-10 overflow-hidden bg-white py-1.5 pr-3 pl-4 whitespace-nowrap text-gray-700">
              <span className="block truncate" title={l.descricao}>
                {l.descricao}
              </span>
            </td>
            {l.trimestres.map((v, k) => (
              <td key={k} className={`${td} ${k === 0 ? "border-l border-gray-100" : ""} bg-white`}>
                {valor(v)}
              </td>
            ))}
            <td className={`${td} border-l border-gray-300 bg-white`}>{valor(l.media)}</td>
            {comparado ? (
              <>
                <td className={`${td} border-l border-gray-100 bg-white`} title={dicaDoComparado}>
                  {textoDaDiferenca(l)}
                </td>
                <td className={`${td} bg-white`} title={dicaDoComparado}>
                  {textoDoAtingimento(l)}
                </td>
              </>
            ) : null}
          </tr>
        );
      })}
    />
  );
}

/** O Exportar da aba (Excel ou PDF), com as colunas da tela, no lugar do Exportar dos Resultados. */
export function ExportarCustosOperacionais({ dados, titulo }: { dados: CustosOperacionais | undefined; titulo: string }) {
  if (!dados) return null;
  const colunas: ColunaExportavel<LinhaDeCusto>[] = [
    { chave: "indicador", rotulo: "Indicador", valor: (l) => l.descricao },
    ...dados.trimestres.map(
      (t, k): ColunaExportavel<LinhaDeCusto> => ({
        chave: `trimestre${k}`,
        rotulo: `Média ${t.rotulo}`,
        tipo: "numero",
        moeda: false,
        valor: (l) => l.trimestres[k] ?? undefined,
        texto: (l) => valor(l.trimestres[k]),
      }),
    ),
    { chave: "media", rotulo: "Média Mensal", tipo: "numero", moeda: false, valor: (l) => l.media ?? undefined, texto: (l) => valor(l.media) },
    ...(dados.comparado
      ? ([
          { chave: "diferenca", rotulo: "Diferença", tipo: "numero", moeda: false, valor: (l) => diferencaDe(l) ?? undefined, texto: textoDaDiferenca },
          { chave: "atingimento", rotulo: "Atingimento", texto: textoDoAtingimento },
        ] as ColunaExportavel<LinhaDeCusto>[])
      : []),
  ];
  const subtitulo = dados.comparado ? `Diferença e Atingimento contra a Média Mensal de ${nomeDoComparado(dados.comparado)}` : null;
  return <ExportarTabela titulo={titulo} subtitulo={subtitulo} colunas={colunas} linhas={dados.linhas} />;
}
