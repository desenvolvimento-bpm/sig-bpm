"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Globe, Lock, Plus } from "lucide-react";

import { ExportarTabela } from "@/components/shared/ExportarTabela";
import { CabecalhoDaTela } from "@/components/shared/CabecalhoDaTela";
import { DataTable } from "@/components/shared/DataTable";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { QuadroTabela } from "@/components/shared/QuadroTabela";
import { useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import { Button } from "@/components/ui/button";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";
import type { Coluna } from "@/lib/filtrosDeTabela";

import { formato } from "@/app/relatorios/services/relatoriosService";

import { botaoPrimario, CenarioDialog } from "../components/CenarioDialog";
import { EtiquetaMarcacao, EtiquetaVigente } from "../components/EtiquetasCenario";
import { cenariosService, rotuloVersao, ROTULO_VISUALIZACAO, type Cenario, DO_TIPO, type TipoCenario } from "../services/cenariosService";

/** O contorno das etiquetas Vigente e da marcação, ao lado do nome (14/10/2026). */
const ETIQUETA = "rounded-sm border border-gray-300 bg-white px-1.5 py-px align-middle text-xs font-medium whitespace-nowrap text-gray-900";
const dataCurta = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : null);

/** Uma coluna dos resultados do exercício (13/10/2026): o valor em R$ e, embaixo, o %; ordena e filtra pelo valor. */
const colunaDeResultado = (chave: "rol" | "cpv" | "ebitda" | "rl", rotulo: string): Coluna<Cenario> => ({
  chave,
  rotulo,
  tipo: "numero",
  alinhamento: "direita",
  valor: (c) => c.resultados?.[chave].valor ?? null,
  texto: (c) => (c.resultados ? reaisAbreviados(c.resultados[chave].valor) : null),
  classe: "!px-3",
});

// A ordem das colunas (13/10/2026): Exercício, Cenário, Criado Por, Visualização e os resultados (ROL, CPV, EBITDA e RL). Sem
// as colunas Conteúdo, Arquivo e Marcação e sem os ícones de ações: a marcação é uma etiqueta na coluna Cenário (muda em
// Configurações / Cenário), e a importação num cenário fica na aba Referência das Configurações.
// As colunas com 12 px de cada lado (13/10/2026), para a tabela caber na largura da tela.
const COLUNAS: Coluna<Cenario>[] = [
  { chave: "ano", rotulo: "Exercício", classe: "!px-3", tipo: "numero", valor: (c) => c.ano, texto: (c) => String(c.ano) },
  // O nome com a versão, para o filtro separar as revisões.
  { chave: "nome", rotulo: "Cenário", classe: "!px-3", valor: (c) => `${c.nome} ${rotuloVersao(c.versao)}` },
  { chave: "criadoPor", rotulo: "Criado Por", classe: "!px-3", valor: (c) => c.criadoPor },
  { chave: "visualizacao", rotulo: "Visualização", classe: "!px-3", valor: (c) => ROTULO_VISUALIZACAO[c.visualizacao] },
  colunaDeResultado("rol", "ROL"),
  colunaDeResultado("cpv", "CPV"),
  colunaDeResultado("ebitda", "EBITDA"),
  colunaDeResultado("rl", "RL"),
];

type Dialogo = { tipo: "novo" } | null;

/** O valor em reais abreviado (13/10/2026): R$ 86,42M nos milhões, R$ 532,10 mil nos milhares. */
const reaisAbreviados = (v: number) => {
  const duas = (x: number) => x.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (Math.abs(v) >= 1e6) return `R$ ${duas(v / 1e6)}M`;
  if (Math.abs(v) >= 1e3) return `R$ ${duas(v / 1e3)} mil`;
  return `R$ ${duas(v)}`;
};

/** A célula de um resultado: o valor em R$ e, embaixo, o % (a ROL, 100%, sem ele), como no total da tela Resultados. */
function CelulaResultado({ c, chave }: { c: Cenario; chave: "rol" | "cpv" | "ebitda" | "rl" }) {
  if (!c.resultados) return <span className="text-gray-400">—</span>;
  const r = c.resultados[chave];
  return (
    <>
      <div className="text-gray-900">{reaisAbreviados(r.valor)}</div>
      {chave !== "rol" && r.pct !== null ? <div className="text-xs text-gray-500">{formato.pct(r.pct)}</div> : null}
    </>
  );
}

/** O que muda na lista dos analíticos (13/10/2026): o Como Usar e o Sobre. */
const COMO_USAR_ANALITICOS = (
  <ul>
    <li>Use “Novo Cenário” para um cenário analítico vazio ou a cópia de outro analítico (os sintéticos ficam na lista deles e não entram aqui).</li>
    <li>
      A coluna Resultados traz o total do exercício no Consolidado: a ROL em R$ e o CPV, o EBITDA e o RL em R$ e em %, com os reais abreviados. A
      coluna ordena e filtra pelo RL.
    </li>
    <li>
      Ao lado do nome, a versão do cenário (VER00, VER01…), com o cadeado quando congelada, a etiqueta “Vigente” (com a estrela) na versão mais
      alta de cada cenário e a da marcação (com o símbolo de marcação); as versões se congelam, se reabrem e se revisam na tela Resultados de cada
      cenário, como nos sintéticos.
    </li>
    <li>Clique na linha para abrir o cenário, com as telas Configurações, Premissas, Resultados, Painel de Bordo e Histórico (as que o seu perfil lê).</li>
    <li>
      Marcação, exclusão, nome, descrição, visualização e comparativo ficam em Configurações, como nos sintéticos. Cada marcação (Orçamento,
      Anterior, Vendido e Forecast) fica ativa em um cenário só, sintético ou analítico: marcar um tira a marcação do anterior.
    </li>
    <li>Use os filtros nos rótulos das colunas, “Apenas com Marcação” e “Apenas Vigentes” (só a versão mais alta de cada cenário).</li>
  </ul>
);
const SOBRE_ANALITICOS = (
  <>
    <p>
      Os cenários analíticos: versões mais detalhadas dos sintéticos, montadas a partir das premissas — as demandas, os centros de custo, os
      investimentos e o extra-operacional —, com os resultados (Consolidado, Matriz, Filial, Serviços, Despesas e Extra e RN) calculados a partir
      delas, pelas relações entre unidades, linhas e centros de custo e pelos rateios do fechamento mensal.
    </p>
    <p>
      Ficam separados dos sintéticos: um cenário analítico só copia, importa e compara com outro analítico. A DRE dele não se edita nem se importa
      de arquivo: muda com as premissas. As premissas e a referência realizada (com os centros de custo e as Médias de Referência) estão em
      desenvolvimento; por enquanto, o cenário novo começa vazio.
    </p>
  </>
);

/** A lista dos cenários de um tipo: a tela Cenários Sintéticos ou Cenários Analíticos (13/10/2026). */
export function CenariosContent({ tipo = "SINTETICO" }: { tipo?: TipoCenario }) {
  const t = DO_TIPO[tipo];
  const analitico = tipo === "ANALITICO";
  useRegistrarAcessoTela(t.base);
  const router = useRouter();
  const { data, isPending, isError } = useQuery({ queryKey: ["cenarios", tipo], queryFn: () => cenariosService.listar(tipo) });
  // Os filtros Apenas com Marcação e Apenas Vigentes (13/10/2026; vigente: a versão mais alta de cada cenário).
  const [soMarcados, setSoMarcados] = useState(false);
  const [soVigentes, setSoVigentes] = useState(false);
  const filtrados = data?.filter((c) => (!soMarcados || c.marcacao) && (!soVigentes || c.vigente));
  const tabela = useTabelaFiltravel(filtrados, COLUNAS);
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const abrir = (c: Cenario) => router.push(`${t.base}/${c.id}/resultados`);

  return (
    <div className="space-y-6">
      <CabecalhoDaTela
        titulo={t.titulo}
        exportar={<ExportarTabela titulo={t.titulo} colunas={COLUNAS} linhas={tabela.filtradas} />}
        comoUsar={analitico ? COMO_USAR_ANALITICOS : (
          <ul>
            <li>
              Use “Novo Cenário” para um cenário vazio ou a cópia de outro. Para partir de uma planilha, crie o cenário e importe o arquivo em
              Configurações / Referência: a ferramenta lê e confere as abas e mostra, aba por aba, o que vai entrar e o que muda no cenário antes de
              gravar.
            </li>
            <li>
              A coluna Resultados traz o total do exercício no Consolidado: a ROL em R$ e o CPV, o EBITDA e o RL em R$ e em % (os mesmos % da coluna do
              total da tela Resultados), com os reais abreviados (R$ 86,42M nos milhões, R$ 532,10 mil nos milhares). A coluna ordena e filtra pelo RL.
            </li>
            <li>
              Ao lado do nome, a versão do cenário (VER00, VER01…), com o cadeado quando congelada, e a etiqueta “Vigente” (com a estrela) na versão
              mais alta de cada cenário. As versões se congelam, se reabrem e se revisam na tela Resultados de cada cenário (Congelar Versão, Reabrir
              Versão e Criar Revisão); cada revisão é um cenário próprio na lista, com o mesmo nome e a versão seguinte.
            </li>
            <li>Clique na linha para abrir o cenário, com as telas Configurações, Resultados, Painel de Bordo e Reajustes (as que o seu perfil lê).</li>
            <li>
              Depois da etiqueta Vigente, a da marcação (com o símbolo de marcação) diz se o cenário é o Orçamento, o Anterior, o Vendido ou o Forecast. Para marcar, excluir,
              importar um arquivo no cenário ou mudar o nome, a descrição, a visualização, a referência e o comparativo, abra o cenário e vá em
              Configurações. Cada marcação fica ativa em um cenário só: marcar outro tira a marcação do anterior.
            </li>
            <li>O cenário marcado como Orçamento dá o orçado do Painel de Bordo de Resultados Empresariais, também na aba Indicadores.</li>
            <li>A DRE do cenário se edita na tela Resultados dele, sem precisar de planilha. Um cenário marcado não se exclui; marcado ou com a versão congelada, não se edita: a DRE, os indicadores manuais, a referência, o nome, a descrição, o comparativo e as justificativas (a visualização, sim). Tire a marcação (ou marque outro cenário) antes.</li>
            <li>
              Ao criar (Novo Cenário) ou editar um cenário, escolha a Visualização: Particular (só você, que criou, e os Administradores
              têm acesso; os demais não veem o cenário na lista) ou Pública (todos os usuários com permissão nos Cenários Sintéticos). A
              coluna Visualização mostra a de cada cenário. Só quem criou o cenário ou um Administrador muda a visualização, e um cenário marcado fica sempre público
              (a marcação vale para todos).
            </li>
            <li>
              Use os filtros nos rótulos das colunas. “Apenas com Marcação” mostra só os cenários marcados; “Apenas Vigentes”, só a versão mais alta
              de cada cenário (as revisões têm o mesmo nome da VER00, que não muda depois da primeira revisão).
            </li>
          </ul>
        )}
        sobre={analitico ? SOBRE_ANALITICOS : (
          <>
            <p>
              Os cenários sintéticos: cada um é uma DRE por unidade (Consolidado, Matriz, Filial, Serviços, Despesas e Extra e RN), mês a mês no
              exercício, com as metas dos indicadores.
            </p>
            <p>
              Na importação (Configurações / Referência), cada linha da DRE se liga à da Estrutura da DRE pela descrição, na ordem.
            </p>
            <p>Os cenários analíticos (montados pelas premissas) ficam em Cenários Analíticos.</p>
          </>
        )}
        acoes={
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" className="accent-black" checked={soMarcados} onChange={(e) => setSoMarcados(e.target.checked)} />
              Apenas com Marcação
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" className="accent-black" checked={soVigentes} onChange={(e) => setSoVigentes(e.target.checked)} />
              Apenas Vigentes
            </label>
            <PermissionGuard permission={t.editar}>
              <Button type="button" className={botaoPrimario} onClick={() => setDialogo({ tipo: "novo" })}>
                <Plus className="size-4" />
                Novo Cenário
              </Button>
            </PermissionGuard>
          </div>
        }
      />

      <QuadroTabela>
        <DataTable<Cenario>
          data={tabela.visiveis}
          cabecalho={tabela.cabecalho}
          filtrosAtivos={tabela.ativos}
          onLimparFiltros={tabela.limpar}
          isLoading={isPending}
          error={isError ? "Erro ao carregar os cenários." : null}
          emptyMessage="Nenhum cenário gerado"
          emptyHint="Use Novo Cenário para criar o primeiro."
          columns={COLUNAS.map((c) => c.rotulo)}
          renderRow={(c) => (
            <tr key={c.id} onClick={() => abrir(c)} className="cursor-pointer border-b border-gray-100 hover:bg-gray-50">
              <td className="px-3 text-sm">{c.ano}</td>
              <td className="min-w-48 px-3 py-2 text-sm">
                {/* O nome, a versão e a marcação numa linha só (13/10/2026). */}
                <div className="whitespace-nowrap">
                  <Link href={`${t.base}/${c.id}/resultados`} onClick={(e) => e.stopPropagation()} className="font-bold text-gray-900">
                    {c.nome}
                  </Link>
                  {/* A versão (13/10/2026), com o cadeado quando congelada. */}
                  <span
                    className="ml-2 inline-flex items-center gap-1 rounded-sm border border-gray-300 px-1.5 py-px align-middle text-xs font-medium text-gray-700"
                    title={c.versaoSalvaEm ? "Versão congelada: os dados não se editam" : "Versão aberta para edição"}
                  >
                    {c.versaoSalvaEm ? <Lock className="size-3" /> : null}
                    {rotuloVersao(c.versao)}
                  </span>
                  {/* Depois da versão, a etiqueta Vigente (14/10/2026) e a da marcação (13/10/2026; antes, embaixo da descrição). */}
                  {c.vigente ? <EtiquetaVigente classe={`ml-1.5 ${ETIQUETA}`} /> : null}
                  <EtiquetaMarcacao marcacao={c.marcacao} classe={`ml-1.5 ${ETIQUETA}`} />
                </div>
                {c.descricao ? <div className="text-xs text-gray-500">{c.descricao}</div> : null}
              </td>
              {/* Criado Por e Visualização em colunas (13/10/2026; antes, embaixo do nome). */}
              <td className="px-3 py-2 text-sm whitespace-nowrap">
                {c.criadoPor ?? <span className="text-gray-400">—</span>}
                <div className="text-xs text-gray-500">em {dataCurta(c.criadoEm)}</div>
              </td>
              <td className="px-3 text-sm whitespace-nowrap">
                <span className={`inline-flex items-center gap-1 ${c.visualizacao === "PARTICULAR" ? "font-medium text-gray-900" : "text-gray-700"}`}>
                  {c.visualizacao === "PARTICULAR" ? <Lock className="size-3.5" /> : <Globe className="size-3.5" />}
                  {ROTULO_VISUALIZACAO[c.visualizacao]}
                </span>
              </td>
              {(["rol", "cpv", "ebitda", "rl"] as const).map((k) => (
                <td key={k} className="px-3 py-2 text-right text-sm whitespace-nowrap">
                  <CelulaResultado c={c} chave={k} />
                </td>
              ))}
            </tr>
          )}
        />
      </QuadroTabela>

      {dialogo?.tipo === "novo" ? <CenarioDialog cenario={null} cenarios={data ?? []} onFechar={() => setDialogo(null)} /> : null}
    </div>
  );
}
