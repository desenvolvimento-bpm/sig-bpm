"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { useAbaLembrada } from "@/hooks/useAbaLembrada";
import { Abas } from "@/components/shared/Abas";
import { ExportarRelatorio, type OpcaoExportar } from "@/app/relatorios/components/ExportarRelatorio";
import { CabecalhoDaTela } from "@/components/shared/CabecalhoDaTela";
import { FaixaIndicadores } from "@/components/shared/FaixaIndicadores";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/context/PermissionContext";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";
import { plural } from "@/lib/texto";

import { TabelaResultados } from "@/app/relatorios/resultados/ResultadosContent";
import { ExportarCustosOperacionais, TabelaCustosOperacionais } from "@/app/relatorios/resultados/CustosOperacionais";
import { InfoAgrupamento } from "@/app/competencias/[anoMes]/dre/components/InfoAgrupamento";
import { CampoBusca } from "@/components/shared/Filtros";
import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";
import { useRotulosDosValores, useTipoGrafico } from "@/app/relatorios/components/GraficoRealizadoOrcado";

import { AvisoMarcado, estaTravado } from "../../../components/AvisoMarcado";
import { EdicaoDRE } from "../../../components/EdicaoDRE";
import { AvisoRateiosSemBase } from "../../../components/CentrosDoCenario";
import { BotaoContasDoBalancete } from "../../../components/ContasDoBalancete";
import { cenariosService, type Cenario } from "../../../services/cenariosService";
import { botaoPrimario } from "../../../components/CenarioDialog";
import { useTipoDoCenario } from "../../../components/tipoDoCenario";
import { IndicadoresDoCenario } from "../indicadores/CenarioIndicadoresContent";
import { ehAConta } from "@/lib/contasDaDRE";

/** As visões da DRE do cenário: as de Resultados Empresariais, sem os centros de custo. */
const VISOES = [
  { chave: "0", aba: "consolidado", nome: "Consolidado" },
  { chave: "1", aba: "matriz", nome: "Matriz" },
  { chave: "2", aba: "filial", nome: "Filial" },
  { chave: "3", aba: "servicos", nome: "Serviços" },
  { chave: "4", aba: "despesas", nome: "Despesas" },
  // O Extra-Operacional (27/11/2026, o teste da separação; a unidade 6), depois de Despesas.
  { chave: "6", aba: "extra_operacional", nome: "Extra-Operacional" },
  { chave: "5", aba: "rn", nome: "RN" },
  // A Leben (27/11/2026, pedido do Adão), depois do RN.
  { chave: "7", aba: "leben", nome: "Leben" },
];

const Carregando = () => <div className="h-64 animate-pulse rounded-sm bg-gray-100" />;

function Visao({ id, visao, nome, analitico }: { id: string; visao: number; nome: string; analitico: boolean }) {
  const consulta = useQuery({ queryKey: ["cenarios", id, "resultados", visao], queryFn: () => cenariosService.resultados(id, visao) });
  if (consulta.isError) {
    return (
      <div className="rounded-sm border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-700">{mensagemDeErro(consulta.error, "Erro ao carregar os resultados do cenário.")}</p>
      </div>
    );
  }
  if (consulta.isPending) return <Carregando />;
  if (consulta.data.linhas.every((l) => l.tipo === "SECAO")) {
    return (
      <p className="rounded-sm border border-gray-200 bg-white p-6 text-sm text-gray-600">
        {analitico
          ? `O cenário ainda não tem a DRE de ${nome}: ela é calculada a partir das premissas do cenário.`
          : `O cenário não tem a DRE de ${nome}. Importe um arquivo com a aba dela em Configurações / Referência.`}
      </p>
    );
  }
  return (
    <TabelaResultados
      key={visao}
      dados={consulta.data}
      titulo={`Resultados · ${nome}`}
      visao={visao === 0 ? { consolidado: true } : { unidade: visao }}
      nomeVisao={nome}
      consultas={false}
      doCenario
      // O Consolidado sem as colunas R$/m³ (27/11/2026, pedido do Adão), como os Centros de Custo.
      semUnitario={visao === 0}
      // Nos analíticos (13/11/2026), as Contas do Balancete de cada conta (as linhas de item e os Impostos Operacionais, sem os volumes).
      acaoDaLinha={
        analitico
          ? (l) =>
              !l.volume && (l.tipo === "ITEM" || ehAConta(l, "Impostos Operacionais")) ? <BotaoContasDoBalancete id={id} linha={l.codigo} descricao={l.descricao} /> : null
          : undefined
      }
    />
  );
}

/** Os Custos Operacionais do cenário (26/11/2026): a tabela e o Exportar da aba. */
const useCustosOperacionais = (id: string) => useQuery({ queryKey: ["cenarios", id, "resultados", "custos_operacionais"], queryFn: () => cenariosService.custosOperacionais(id) });

/**
 * A aba Custos Operacionais dos Resultados de um cenário (26/11/2026, pedido do Adão; sintéticos e analíticos), como a de Resultados
 * Empresariais: os custos de produção (Matriz e Filial) e de serviços em R$/dia (÷ 20 dias por mês) e em R$/m³ (÷ a Demanda do
 * cenário), com a média de cada trimestre e a Média Mensal e, com um cenário comparado, a Diferença e o Atingimento contra a dele.
 */
function VisaoCustosOperacionais({ id, analitico }: { id: string; analitico: boolean }) {
  const consulta = useCustosOperacionais(id);
  if (consulta.isError) {
    return (
      <div className="rounded-sm border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-700">{mensagemDeErro(consulta.error, "Erro ao carregar os custos operacionais do cenário.")}</p>
      </div>
    );
  }
  if (consulta.isPending) return <Carregando />;
  if (!consulta.data.mesesDaMedia.length) {
    return (
      <p className="rounded-sm border border-gray-200 bg-white p-6 text-sm text-gray-600">
        {analitico
          ? "O cenário ainda não tem a DRE de Matriz, Filial e Serviços: ela é calculada a partir das premissas do cenário."
          : "O cenário não tem a DRE de Matriz, Filial e Serviços. Importe um arquivo com as abas delas em Configurações / Referência."}
      </p>
    );
  }
  return <TabelaCustosOperacionais dados={consulta.data} titulo="Resultados · Custos Operacionais" />;
}

/** O Exportar da aba Custos Operacionais, com os dados da tela. */
function ExportarCustosDoCenario({ id, nome }: { id: string; nome: string }) {
  const { data } = useCustosOperacionais(id);
  return <ExportarCustosOperacionais dados={data} titulo={`${nome} · Custos Operacionais`} />;
}

/**
 * A aba Centros de Custo dos Resultados de um cenário analítico (19/11/2026, pedido do Adão: como a de Resultados
 * Empresariais): a lista dos grupos de centros com valor à esquerda, com a busca, e a DRE do escolhido (as contas, as
 * atribuições e o total do grupo, mês a mês, sobre as bases do Consolidado do cenário).
 */
function VisaoCentros({ id, escolhido, onEscolher }: { id: string; escolhido: string | null; onEscolher: (g: string) => void }) {
  const [busca, setBusca] = useState("");
  const grupos = useQuery({ queryKey: ["cenarios", id, "resultados", "centros"], queryFn: () => cenariosService.centrosDosResultados(id) });
  const lista = grupos.data?.grupos ?? [];
  const grupo = (escolhido && lista.some((g) => g.grupo === escolhido) ? escolhido : lista[0]?.grupo) ?? null;
  const centro = useQuery({ queryKey: ["cenarios", id, "resultados", "centros", grupo], queryFn: () => cenariosService.resultadosDoCentro(id, grupo!), enabled: grupo !== null });
  if (grupos.isError) {
    return (
      <div className="rounded-sm border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-700">{mensagemDeErro(grupos.error, "Erro ao carregar os centros de custo do cenário.")}</p>
      </div>
    );
  }
  if (grupos.isPending) return <Carregando />;
  if (lista.length === 0) return <p className="rounded-sm border border-gray-200 bg-white p-6 text-sm text-gray-600">Nenhum centro de custo com valor no cenário.</p>;
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
          <div className="rounded-sm border border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-700">{mensagemDeErro(centro.error, "Erro ao carregar o centro de custo.")}</p>
          </div>
        ) : centro.isPending || !centro.data ? (
          <Carregando />
        ) : (
          <div className="space-y-3">
            {/* O comparado sintético (22/11/2026) não tem centros de custo: sem a Média de Referência no cenário, a aba fica sem o comparativo, com o aviso. */}
            {centro.data.comparadoSemCentros ? (
              <p className="rounded-sm border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
                O cenário comparado, {centro.data.comparadoSemCentros.nome}, é sintético e não tem centros de custo, e este cenário não tem a Média de
                Referência (Configurações / Referência): esta aba fica sem o comparativo.
              </p>
            ) : null}
            {/* Com a DRE calculada com os reajustes (22/11/2026, pedido do Adão), os valores do centro com eles, como o Consolidado. */}
            {centro.data.reajustado ? (
              <p className="rounded-sm border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
                Valores com os reajustes da DRE (Aplicar ao Recalcular), como o Consolidado. A aba Centros de Custo das Premissas mostra os valores sem eles.
              </p>
            ) : null}
            <TabelaResultados
              key={grupo ?? ""}
              dados={centro.data}
              titulo={grupo ?? ""}
              visao={{ grupo: grupo! }}
              nomeVisao={grupo ?? ""}
              consultas={false}
              doCenario
              // Sem as colunas R$/m³ (27/11/2026, pedido do Adão), como o Consolidado.
              semUnitario
              aoLadoDoTitulo={<InfoAgrupamento grupo={grupo ?? ""} centros={centro.data.centros} periodo="no cenário" />}
              acaoDaLinha={(l) => (!l.volume && l.tipo === "ITEM" ? <BotaoContasDoBalancete id={id} linha={l.codigo} descricao={l.descricao} /> : null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A aba Departamentos dos Resultados de um cenário analítico (23/11/2026, pedido do Adão), antes de Centros de Custo, como a de
 * Resultados Empresariais: a DRE do Consolidado do cenário, com os mesmos totais, mas cada departamento de CPP a DA aberto pelos
 * grupos de centros de custo (o valor de cada um no departamento, pelo rateio do cenário) e, depois deles, pelas atribuições com o que
 * não vem dos centros (as Premissas das unidades, os Investimentos…).
 */
function VisaoDepartamentos({ id }: { id: string }) {
  const consulta = useQuery({ queryKey: ["cenarios", id, "resultados", "departamentos"], queryFn: () => cenariosService.departamentosDosResultados(id) });
  if (consulta.isError) {
    return (
      <div className="rounded-sm border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-700">{mensagemDeErro(consulta.error, "Erro ao carregar os departamentos do cenário.")}</p>
      </div>
    );
  }
  if (consulta.isPending) return <Carregando />;
  if (consulta.data.linhas.every((l) => l.tipo === "SECAO")) {
    return <p className="rounded-sm border border-gray-200 bg-white p-6 text-sm text-gray-600">O cenário ainda não tem a DRE: ela é calculada a partir das premissas do cenário.</p>;
  }
  return (
    <div className="space-y-3">
      {consulta.data.comparadoSemCentros ? (
        <p className="rounded-sm border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
          O cenário comparado, {consulta.data.comparadoSemCentros.nome}, é sintético e não tem centros de custo: as linhas dos centros ficam sem o comparativo.
        </p>
      ) : null}
      {consulta.data.reajustado ? (
        <p className="rounded-sm border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
          Valores dos centros com os reajustes da DRE (Aplicar ao Recalcular), como o Consolidado.
        </p>
      ) : null}
      <TabelaResultados
        dados={consulta.data}
        titulo="Resultados · Departamentos"
        visao={{ consolidado: true }}
        nomeVisao="Departamentos"
        consultas={false}
        doCenario
        // As Contas do Balancete nas contas (não nas linhas dos centros), como no Consolidado.
        acaoDaLinha={(l) =>
          !l.volume && !l.centro && (l.tipo === "ITEM" || ehAConta(l, "Impostos Operacionais")) ? <BotaoContasDoBalancete id={id} linha={l.codigo} descricao={l.descricao} /> : null
        }
      />
    </div>
  );
}

/**
 * A tela Resultados de um cenário: as visões da DRE mês a mês no exercício, como em Resultados Empresariais. No sintético,
 * quem edita os cenários edita a DRE aqui, e a aba Indicadores Manuais (12/11/2026, pedido do Adão), depois das visões,
 * digita os indicadores que não saem da DRE; no analítico (13/10/2026), a DRE é calculada a partir das premissas e fica
 * só para leitura (os Indicadores Manuais ficam nas Premissas).
 */
export function CenarioResultadosContent() {
  const { id } = useParams<{ id: string }>();
  const t = useTipoDoCenario();
  useRegistrarAcessoTela(`${t.base}/${id}/resultados`);
  const [escolhida, setVisao] = useAbaLembrada("visao", "0");
  // O grupo de centros escolhido na aba Centros de Custo (19/11/2026).
  const [grupoEscolhido, setGrupoEscolhido] = useState<string | null>(null);
  // Quem edita os cenários edita a DRE aqui mesmo (12/10/2026; antes, na tela Editar, que deixou de existir).
  const { hasPermission } = usePermissions();
  // O cenário marcado (12/10/2026) ou com a versão congelada (13/10/2026) não se edita: a tabela fica só para leitura, com o aviso.
  const cenario = useQuery({ queryKey: ["cenarios", id], queryFn: () => cenariosService.obter(id) });
  const travado = !!cenario.data && estaTravado(cenario.data);
  const analitico = t.tipo === "ANALITICO";
  // As visões (abas) que o perfil lê, e a edição de cada uma (14/10/2026).
  const visoes = VISOES.filter((v) => hasPermission(t.perm("resultados", "ler", v.aba)));
  // A aba Indicadores Manuais dos sintéticos (12/11/2026), depois das visões, com a permissão dela.
  const leManuais = !analitico && hasPermission(t.perm("resultados", "ler", "manuais"));
  // A aba Centros de Custo dos analíticos (19/11/2026, pedido do Adão), depois das unidades, com a permissão dela.
  const leCentrosDosResultados = analitico && hasPermission(t.perm("resultados", "ler", "centros"));
  // A aba Departamentos dos analíticos (23/11/2026, pedido do Adão), antes de Centros de Custo, com a permissão dela.
  const leDepartamentos = analitico && hasPermission(t.perm("resultados", "ler", "departamentos"));
  // A aba Custos Operacionais (26/11/2026, pedido do Adão), logo depois das unidades, nos sintéticos e nos analíticos.
  const leCustos = hasPermission(t.perm("resultados", "ler", "custos_operacionais"));
  const abas = [
    ...visoes.map((v) => ({ chave: v.chave, rotulo: v.nome })),
    ...(leCustos ? [{ chave: "custos_operacionais", rotulo: "Custos Operacionais" }] : []),
    ...(leDepartamentos ? [{ chave: "departamentos", rotulo: "Departamentos" }] : []),
    ...(leCentrosDosResultados ? [{ chave: "centros", rotulo: "Centros de Custo" }] : []),
    ...(leManuais ? [{ chave: "manuais", rotulo: "Indicadores Manuais" }] : []),
  ];
  const visao = abas.some((a) => a.chave === escolhida) ? escolhida : (abas[0]?.chave ?? "");
  const naManuais = visao === "manuais";
  const nosCentros = visao === "centros";
  const nosDepartamentos = visao === "departamentos";
  const nosCustos = visao === "custos_operacionais";
  const daVisao = VISOES.find((v) => v.chave === visao);
  const podeEditar = !analitico && !!daVisao && hasPermission(t.perm("resultados", "editar", daVisao.aba)) && !!cenario.data && !travado;
  const nome = daVisao?.nome ?? "";
  // O Tipo e os Rótulos do gráfico de cada indicador manual, os do Configurar Gráficos do Painel de Bordo.
  const [tipoGrafico] = useTipoGrafico();
  const [comRotulos] = useRotulosDosValores();
  // O Exportar (14/10/2026), como o de Resultados Empresariais: a visão na tela, as seis unidades e, nos analíticos, os
  // centros de custo (em Excel).
  const leTodas = VISOES.every((v) => hasPermission(t.perm("resultados", "ler", v.aba)));
  const leCentros = analitico && hasPermission(t.perm("premissas", "ler", "centros"));
  // O Recalcular (14/10/2026; 27/11/2026: com os reajustes da caixa Aplicar ao Recalcular): nos analíticos em aberto, refaz a DRE com as
  // alterações ainda não recalculadas.
  const podeRecalcular = analitico && !!cenario.data && !travado && hasPermission(t.perm("resultados", "editar"));
  const opcoesExportar: OpcaoExportar[] = [
    ...(daVisao || nosDepartamentos ? [{ chave: "atual", excel: "Visão Atual", pdf: "Visão Atual", params: { escopo: "atual", visao } }] : []),
    ...(leTodas ? [{ chave: "unidades", excel: "Todas as Unidades (uma por aba)", pdf: "Todas as Unidades (uma por página)", params: { escopo: "unidades" } }] : []),
    ...(leCentros
      ? [
          // Na aba Centros de Custo (19/11/2026), também o centro escolhido.
          ...(nosCentros && grupoEscolhido
            ? [{ chave: "centro", excel: "Centro de Custo Atual", pdf: null, params: { escopo: "atual", grupo: grupoEscolhido }, url: `/proxy/cenarios/${id}/centros/exportar` }]
            : []),
          { chave: "centros", excel: "Todos os Centros de Custo (um por aba)", pdf: null, params: { escopo: "centros" }, url: `/proxy/cenarios/${id}/centros/exportar` },
          { chave: "arquivos", excel: "Todos os Centros de Custo (um arquivo por centro)", pdf: null, params: { escopo: "centros_arquivos" }, url: `/proxy/cenarios/${id}/centros/exportar` },
        ]
      : []),
  ];
  return (
    <div className="space-y-6">
      <CabecalhoDaTela
        titulo="Resultados"
        acoes={
          <div className="flex flex-wrap items-center gap-2">
            {podeRecalcular && cenario.data ? <ControlesDoRecalculo cenario={cenario.data} /> : null}
            {/* Na aba Custos Operacionais (26/11/2026), o Exportar leva a tabela dela. */}
            {nosCustos ? (
              <ExportarCustosDoCenario id={id} nome={cenario.data?.nome ?? "Cenário"} />
            ) : opcoesExportar.length ? <ExportarRelatorio
                endereco={`/proxy/cenarios/${id}/exportar`}
                opcoes={opcoesExportar}
                padrao={`${cenario.data?.nome ?? "Cenário"} - Resultados`}
                imagem={daVisao || nosDepartamentos ? { nome: `${cenario.data?.nome ?? "Cenário"} - Resultados - ${nosDepartamentos ? "Departamentos" : nome}` } : undefined}
              /> : null}
          </div>
        }
        comoUsar={
          <ul>
            <li>Troque de cenário no nome dele, na barra do topo; ao lado, o Painel de Bordo, com a aba Indicadores.</li>
            {analitico ? <li>No cenário analítico, a DRE é calculada a partir das premissas e não se edita aqui: os valores mudam com as premissas.</li> : null}
            {analitico ? (
              <li>
                Em todas as abas, o botão ao lado do nome de cada conta abre as Contas do Balancete: as contas do RM que caem nela (as que têm essa Linha da
                DRE em Cadastros Gerais › Contábil › Contas de Resultado), com o Reduzido, a Conta, a Descrição, o Departamento, o Rateio e a
                situação.
              </li>
            ) : null}
            <li>
              Escolha a visão nas abas: Consolidado ou cada unidade e, depois delas, Custos Operacionais{analitico ? ", Departamentos e Centros de Custo" : " e Indicadores Manuais"} (as que o seu perfil lê).
            </li>
            <li>
              Na aba Custos Operacionais, como em Resultados Empresariais: os custos de produção (Matriz e Filial) e de serviços do cenário, um por
              linha — em R$/dia, a soma do custo nos meses ÷ 20 dias por mês (o trimestre, ÷ 60); em R$/m³, a soma do custo ÷ a soma da Produção do
              Pré-Fabricado (nos de produção) ou da Montagem do Pré-Fabricado (nos de montagem) dos mesmos meses, a Demanda do cenário. As colunas
              trazem a média de cada trimestre e a Média Mensal dos 12 meses (passe o mouse no rótulo para ver os meses). Com um cenário comparado,
              a Diferença (a Média Mensal menos a do comparado) e o Atingimento (a Média Mensal ÷ a do comparado − 100%, com o sinal), contra a
              Média Mensal dos 12 meses dele; passe o mouse nelas para ver a Média Mensal do comparado. Os Outros Gastos Gerais Variáveis são os
              Gastos Gerais Variáveis sem as Madeiras e Madeirites, que têm linha própria na Matriz e na Montagem. Em Serviços, a mão de obra e os
              gastos gerais diretos e indiretos somam a Montagem e a Complementar; os materiais aplicados, as madeiras, os outros gastos gerais
              variáveis e a depreciação são só os da Montagem. Nesta aba, o “Exportar” baixa a tabela em Excel ou PDF.
            </li>
            {analitico ? (
              <li>
                Na aba Departamentos, como em Resultados Empresariais: a DRE do Consolidado do cenário, com os mesmos totais, mas, de Custo de
                Produto Vendido até Despesas Administrativas, cada departamento com centros de custo (Custos de Produção, Montagem, Complementares,
                Logística, Técnicas, Comerciais e Administrativas) mostra só os grupos de centros (os da aba Centros de Custo), cada um com o total
                dele no departamento, sem as atribuições e as contas (Mão de Obra Terceirizada, Matérias Primas, Gastos Gerais, Estoque,
                Depreciação…). O total de cada departamento é o do Consolidado: a soma dos grupos fica menor que ele pelo que não vem dos centros (as
                Premissas das unidades, a Depreciação dos Investimentos e, no seu recorte, os grupos que você não vê). O valor de cada grupo segue o
                rateio do cenário (Configurações / Regras de Rateio: a parte da produção que vai para Serviços, a Montagem dos grupos complementares
                nos Complementares…), por isso um grupo pode aparecer em mais de um departamento; com a DRE calculada com os reajustes (Aplicar
                ao Recalcular), com eles. As Despesas Variáveis de Venda, sem centros, e do Lucro Operacional em diante, as linhas são as do Consolidado.
                Com um cenário comparado analítico, o comparativo abre do mesmo jeito, cada grupo dele no grupo deste com os mesmos centros de custo
                (pelo Código RM, mesmo com outro nome); um sintético não tem centros de custo, e as linhas dos grupos ficam sem o comparativo, com o
                aviso.
              </li>
            ) : null}
            {analitico ? (
              <li>
                Na aba Centros de Custo, como em Resultados Empresariais: a lista dos grupos de centros com valor no cenário à esquerda (busque pelo nome)
                e, ao lado, a DRE do escolhido, mês a mês — as contas do grupo com valor (as da aba Centros de Custo das Premissas, com os Benefícios
                Adicionais na conta Encargos e Benefícios, como na DRE; com a DRE calculada com os reajustes, a caixa Aplicar ao Recalcular, com eles, e os
                totais batem com o Consolidado), o subtotal de cada atribuição e o total de cada grupo da DRE, com o % sobre
                as bases do Consolidado do cenário (sem o R$/m³). O ícone ao lado do nome do grupo mostra os centros dele. São os valores antes da parte dos rateios
                que vai para Serviços (na DRE, nas contas da CSM ou da CSC). A lista traz só os grupos do recorte do seu perfil: todos, os dos seus
                departamentos ou os que têm algum centro de custo seu, qualquer que seja o Acesso às Informações do cenário. Com um cenário comparado
                analítico, o grupo traz também o comparativo, como nas unidades: o total do grupo com os mesmos centros de custo no comparado (pelo
                Código RM, mesmo com outro nome; o % sobre o Consolidado dele), a Diferença, o Atingimento e a Eficiência. Um comparado sintético não tem centros de custo: no lugar dele, a
                coluna do comparado (com o rótulo da marcação dele, ou Comparado Total, e o exercício dele) traz a Média de Referência de cada conta do grupo (a média do realizado
                carregada em Configurações / Referência) × 12 — parado sobre o rótulo, a dica diz isso —, sem o % (a referência não tem as bases do Consolidado; a Eficiência fica com o traço). Sem a Média de
                Referência no cenário, a aba fica sem o comparativo, com o aviso.
              </li>
            ) : null}
            {analitico ? null : (
              <li>
                Na aba Indicadores Manuais, os quadros de lotação e os indicadores do Comercial e do Administrativo, que não saem da DRE: vêm da aba
                das metas do arquivo importado. Com a permissão de editar a aba, clique no valor de um mês para editá-lo no mesmo modal da DRE (o
                Valor Atual, o reajuste e o Valor Recalculado, com a chave “Replicar aos meses posteriores”; em branco, o mês fica sem valor): os
                valores digitados ficam em amarelo, e cada gravação vai para o histórico (tela Reajustes). Clique no indicador para ver o gráfico (no
                Tipo e com os Rótulos do Configurar Gráficos do Painel de Bordo).
                Com o cenário marcado ou com a versão congelada, os Indicadores Manuais não se editam. O Painel de Bordo, aba Indicadores, mostra
                todos os indicadores do cenário.
              </li>
            )}
            {analitico ? (
              <li>
                Nos analíticos, os rateios dos centros de custo seguem as regras de rateio do cenário (Configurações / Regras de Rateio) de cada
                mês (o percentual fixo, ou as bases das premissas entre os destinos das regras por volume). Os avisos em
                vermelho listam os meses do exercício com rateios sem regra vigente: sem regra, o cenário não se abre nem se fecha (Congelar e
                Reabrir Versão, Criar Revisão, em Configurações / Cenário).
              </li>
            ) : null}
            {analitico ? (
              <>
              <li>
                As gravações das Configurações, das Premissas e dos Índices de Reajuste não refazem a DRE: abaixo das abas, o destaque Pendente
                de Recálculo, com a borda esquerda vermelha, conta as alterações ainda fora dela, por tela (Configurações, Premissas e Reajustes; parado
                sobre o número, o que cada um conta). “Recalcular” só fica clicável com alguma alteração pendente: ele refaz a DRE com todas (as
                premissas, as regras de rateio e os cadastros do cenário), zera o destaque e fica no histórico (tela Histórico). Congelar a
                versão e marcar o cenário pedem o Recalcular antes.
              </li>
              <li>
                Os reajustes seguem a caixa “Aplicar ao Recalcular”, em Configurações / Comparativo e Reajustes (antes do “Novo Índice” dos
                Índices de Reajuste): marcada, todo “Recalcular” aplica os Índices de Reajuste sobre as premissas na DRE, e a etiqueta Reajustes
                Aplicados aparece na barra do cenário; desmarcada, o “Recalcular” leva as premissas sem os reajustes. Mudar a caixa conta como um
                Reajuste pendente. As Configurações e as Premissas continuam editáveis, marcada ou não; parado sobre o “Recalcular”, a dica diz se
                ele aplica os reajustes.
              </li>
              <li>
                Nas abas das unidades (no Consolidado, não), a coluna Índice de Reajuste, antes de Janeiro, traz o índice de cada linha (as
                combinações dos Índices de Reajuste, em Configurações / Comparativo e Reajustes): numa conta, o dela na unidade da aba; num total
                ou numa atribuição, o das contas abaixo dele. Com índices diferentes (ou contas sem índice), “Vários”: passe o mouse para ver o
                de cada conta. Com um cenário comparado, a coluna Índice de Comparação, antes do Comparativo e nas cores dele, traz do mesmo
                jeito o Índice de Comparação de cada linha, com a variação máxima dele.
              </li>
              </>
            ) : null}
            <li>
              Use “Exportar” para baixar em Excel ou PDF, como em Resultados Empresariais: a visão atual ou todas as unidades (uma por aba ou por
              página; nos analíticos, também a aba Departamentos); em Imagem, a Tabela Atual baixa a tabela da tela num PNG, do jeito que está (recolhida ou expandida), inteira.{analitico ? " Nos analíticos, também os centros de custo em Excel (os valores das premissas, sem os reajustes): na aba Centros de Custo, o centro escolhido; todos numa planilha (um por aba) ou um arquivo por centro (num ZIP, com o departamento e o centro no nome de cada arquivo)." : ""}
            </li>
            <li>
              As versões (Congelar Versão, Reabrir Versão e Criar Revisão) ficam em Configurações / Cenário, logo depois de “Gravar Configurações”,
              para quem edita a tela Resultados.
            </li>
            <li>
              Com um cenário comparado (Configurações / {analitico ? "Comparativo e Reajustes" : "Comparativo"}), depois do total do exercício vêm, em preto e cinza, o total do cenário comparado (valor, % e
              R$/m³; no Consolidado e nos Centros de Custo, sem o R$/m³) e, no amarelo, a Diferença (o cenário menos o comparado), o Atingimento (o cenário sobre o comparado menos 100%, com o sinal: 106,5% aparece como +6,5%, e 92,5%,
              como -7,5%) e a Eficiência (a diferença dos %, em pontos percentuais), como o orçado em Resultados Empresariais — sem o mês vigente, porque o cenário se olha nos 12 meses. O
              rótulo da coluna do comparado é o da marcação dele, com o exercício dele (ORÇADO TOTAL/26, FORECAST TOTAL/26, ANTERIOR TOTAL/25,
              VENDIDO TOTAL/26); sem marcação, COMPARADO TOTAL/26. O “Exportar” (Excel e PDF) leva o comparado e as três variações: no Excel, nas
              mesmas colunas da tela; no PDF, nas páginas Comparativo de cada visão, logo depois da DRE dela.
            </li>
            <li>No menu de níveis (a seta antes do título da tabela), escolha Totais, Atribuições ou Contas (Produção e Serviços, os volumes, aparece em todos: recolhido em Totais e Atribuições, aberto em Contas); a seta de cada total ou atribuição (e a de Produção e Serviços) abre e fecha só aquele grupo.</li>
            <li>O botão de seta ao lado do menu de níveis recolhe (seta para a esquerda) ou expande (seta para a direita) os meses — todos, dezembro também, deixando a descrição e os totais, que se esticam e enchem a tela; a escolha fica guardada neste navegador.</li>
            <li>A tabela rola para os lados: a descrição e os rótulos ficam presos, e a barra de rolagem fica no pé da janela, sempre à vista. Nas unidades, o total do exercício traz também o valor por m³ (os meses, não); no Consolidado e na aba Centros de Custo, não há o R$/m³.</li>
            {podeEditar ? (
              <>
                <li>Edição (para quem edita a aba): nas abas Matriz, Filial, Serviços, Despesas, Extra-Operacional, RN e Leben, só os valores mensais das contas se editam; os totais, os percentuais e os valores por m³ são calculados. O Consolidado soma as unidades e não se edita.</li>
                <li>Para reajustar vários valores: marque as contas (a caixa de um total ou de uma atribuição marca as contas dele) e os meses (a caixa no rótulo de cada mês, ou “Marcar Todos os Meses”). Os valores marcados ficam contornados. Clique numa linha (ou em “Reajustar Marcados”) e informe o reajuste, percentual ou absoluto: ele vale para todos os marcados. Ao rolar a tela, o destaque com os valores marcados e os botões continua à vista, flutuando sobre a tabela, um pouco abaixo dos rótulos presos.</li>
                <li>Para editar um valor: clique nele. O modal mostra o valor atual, o reajuste (percentual ou absoluto) e o valor recalculado, que também se digita direto. A chave “Replicar aos meses posteriores” copia o valor recalculado aos meses seguintes. Essa edição não olha as caixas marcadas.</li>
                <li>Cada gravação recalcula os totais da unidade e o Consolidado e fica no histórico (tela Reajustes, na barra do topo). “Limpar Seleção” desmarca as contas e os meses. Com os meses anteriores recolhidos, os meses marcados e escondidos continuam marcados (a barra mostra quantos). Nome, descrição, visualização e a referência (arquivo ou resultado realizado) ficam na tela Configurações, na barra do topo.</li>
              </>
            ) : null}
          </ul>
        }
        sobre={
          <>
            <p>
              A DRE do cenário mês a mês no exercício, como as abas de Resultados Empresariais{analitico ? " (nos analíticos, também a dos grupos de centros de custo)" : " (sem os centros de custo)"}: o valor e a participação (%)
              de cada mês e o total do exercício, com o valor unitário (R$/m³) no total das unidades (no Consolidado e nos centros de custo, sem ele); na aba Custos Operacionais, os custos de
              produção e de serviços por dia de trabalho (20 dias por mês) ou por m³, por trimestre e na Média Mensal. Os valores são os digitados na ferramenta ou os da
              referência do cenário (um arquivo importado, ligado às linhas da Estrutura da DRE pela descrição, ou o resultado realizado); os totais são
              calculados pela Estrutura da DRE, e o Consolidado soma as unidades.
            </p>
            <p>
              A participação e o valor unitário seguem as bases de Resultados Empresariais: a ROB nas receitas e nos impostos; a Receita Líquida do
              Pré-Fabricado nos custos de produção; a de Montagem e a Complementar nos custos de serviços; a de Frete no Frete e Descarga; a ROL no
              resto. Em Despesas, no Extra-Operacional, no RN e na Leben, as bases são as do Consolidado.
            </p>
            {analitico ? (
              <p>
                O RN vem da tabela RN da aba Extra-Operacional das Premissas: as Assessorias e Consultorias das Despesas Administrativas (DA), o
                imposto de renda e a contribuição social (DML) e as receitas e despesas financeiras; a Leben, com as mesmas contas, da tabela Leben.
                Todas as contas da tabela aparecem, com zero nos meses sem valor, como em Resultados Empresariais.
              </p>
            ) : null}
            {analitico ? null : (
              <p>
                A aba Indicadores Manuais traz os indicadores do cenário que não saem da DRE (os quadros de lotação e os do Comercial e do
                Administrativo), mês a mês e acumulados, com o comparado; com as eficiências e a DRE, eles formam os indicadores do Painel de Bordo.
              </p>
            )}
          </>
        }
      />
      <Abas rotulo="Visão dos resultados do cenário" ativa={visao} onMudar={setVisao} abas={abas} />
      {/* As alterações ainda não recalculadas (21/11/2026, pedido do Adão), como o resumo da Conferência com a Planilha. */}
      {analitico && cenario.data ? <PendenteDeRecalculo cenario={cenario.data} /> : null}
      {cenario.data && travado && hasPermission(t.perm("resultados", "editar")) && !analitico && !naManuais ? <AvisoMarcado cenario={cenario.data} oQue="a DRE" /> : null}
      {analitico && cenario.data ? <AvisosDosRateios cenario={cenario.data} /> : null}
      {/* No analítico, o aviso dos rateios sem base nas premissas (13/10/2026): esse valor não entra na DRE. */}
      {analitico ? <AvisoRateiosSemBase id={id} /> : null}
      {naManuais ? (
        <IndicadoresDoCenario id={id} aba="manuais" tipo={tipoGrafico} comRotulos={comRotulos} />
      ) : nosCustos ? (
        <VisaoCustosOperacionais id={id} analitico={analitico} />
      ) : nosDepartamentos ? (
        <VisaoDepartamentos id={id} />
      ) : nosCentros ? (
        <VisaoCentros id={id} escolhido={grupoEscolhido} onEscolher={setGrupoEscolhido} />
      ) : !daVisao ? (
        <p className="rounded-sm border border-gray-200 bg-white p-6 text-sm text-gray-600">Seu perfil não tem acesso a nenhuma aba desta tela.</p>
      ) : podeEditar ? (
        <EdicaoDRE key={visao} id={id} visao={Number(visao)} nome={nome} />
      ) : (
        <Visao id={id} visao={Number(visao)} nome={nome} analitico={analitico} />
      )}
    </div>
  );
}

/** O cenário tem alterações fora da DRE: as contadas (21/11/2026) ou as regras de rateio mudadas depois do cálculo. */
const pendente = (c: Cenario) => (c.recalculo?.total ?? 0) > 0 || !!c.rateios?.desatualizados;

/**
 * O botão Recalcular (21/11/2026, pedido do Adão): refaz a DRE com as alterações pendentes, com os reajustes se a caixa Aplicar ao
 * Recalcular (27/11/2026: em Configurações / Comparativo e Reajustes; antes, ao lado deste botão) estiver marcada. Só fica clicável
 * com alguma alteração ainda não recalculada.
 */
function ControlesDoRecalculo({ cenario }: { cenario: Cenario }) {
  const queryClient = useQueryClient();
  const recalcular = useMutation({
    mutationFn: () => cenariosService.recalcular(cenario.id),
    onSuccess: (c) => {
      queryClient.invalidateQueries({ queryKey: ["cenarios"] });
      queryClient.invalidateQueries({ queryKey: ["relatorios"] });
      toast.success(c.reajustesAplicados ? "Cenário recalculado, com os reajustes aplicados." : "Cenário recalculado.");
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível recalcular o cenário.")),
  });
  const temPendencia = pendente(cenario);
  const comReajustes = cenario.reajustesAplicados ? ", com os reajustes (Aplicar ao Recalcular marcada)" : ", sem os reajustes (Aplicar ao Recalcular desmarcada)";
  return (
    <Button
      type="button"
      className={botaoPrimario}
      disabled={!temPendencia || recalcular.isPending}
      title={temPendencia ? `Refaz a DRE com as alterações pendentes de recálculo${comReajustes}` : "Nenhuma alteração pendente de recálculo"}
      onClick={() => recalcular.mutate()}
    >
      <RefreshCw className={`size-4 ${recalcular.isPending ? "animate-spin" : ""}`} />
      {recalcular.isPending ? "Recalculando…" : "Recalcular"}
    </Button>
  );
}

/**
 * O destaque Pendente de Recálculo (21/11/2026, pedido do Adão), no formato do resumo da Conferência com a Planilha, com a borda
 * vermelha: as alterações das Configurações, das Premissas e dos Reajustes que a DRE ainda não tem (o Recalcular as leva).
 */
function PendenteDeRecalculo({ cenario }: { cenario: Cenario }) {
  const r = cenario.recalculo;
  if (!r || !pendente(cenario)) return null;
  const itens = [
    {
      rotulo: plural(r.configuracoes, "Configuração", "Configurações"),
      valor: r.configuracoes,
      dica: "Gravações nas Configurações (a referência, os centros de custo, os benefícios padrão, as regras de rateio…) ainda fora da DRE",
    },
    { rotulo: plural(r.premissas, "Premissa", "Premissas"), valor: r.premissas, dica: "Gravações nas Premissas (os valores, o Quadro de Lotação, os investimentos, as importações…) ainda fora da DRE" },
    {
      rotulo: plural(r.reajustes, "Reajuste", "Reajustes"),
      valor: r.reajustes,
      dica: "A caixa Aplicar ao Recalcular (Configurações / Comparativo e Reajustes) mudada ou os Índices de Reajuste gravados com ela marcada, ainda fora da DRE",
    },
  ].filter((i) => i.valor > 0);
  return (
    <FaixaIndicadores
      titulo="Pendente de Recálculo:"
      borda="atencao"
      itens={
        itens.length
          ? itens.map((i) => ({ ...i, tom: "atencao" as const }))
          : [{ rotulo: "Regras de Rateio Alteradas", valor: "", tom: "atencao" as const, dica: "As regras de rateio do cenário mudaram depois do último cálculo" }]
      }
    />
  );
}

/** Os avisos dos rateios de um analítico (14/10/2026): os meses sem regra (as regras mudadas ficam no Pendente de Recálculo). */
function AvisosDosRateios({ cenario }: { cenario: Cenario }) {
  const avisos = cenario.rateios?.avisos ?? [];
  if (!avisos.length) return null;
  return (
    <div className="rounded-sm border border-l-4 border-gray-200 border-l-red-600 bg-white px-4 py-3 text-sm text-gray-700">
      <p className="font-medium text-gray-900">Rateios do Cenário</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {avisos.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
    </div>
  );
}
