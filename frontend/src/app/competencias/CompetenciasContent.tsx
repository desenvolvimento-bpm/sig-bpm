"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Circle } from "lucide-react";

import { ExportarTabela } from "@/components/shared/ExportarTabela";
import { DataTable } from "@/components/shared/DataTable";
import { etapasDoMes, type Etapa } from "@/lib/etapasDoMes";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionContext";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";
import { CabecalhoDaTela } from "@/components/shared/CabecalhoDaTela";
import { SinalDadosNovos } from "@/components/shared/SinalDadosNovos";
import { QuadroTabela } from "@/components/shared/QuadroTabela";
import { useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import type { Coluna } from "@/lib/filtrosDeTabela";

import { AbrirCompetenciaDialog } from "./components/AbrirCompetenciaDialog";
import { rotuloStatus, StatusCompetenciaBadge } from "./components/StatusCompetenciaBadge";
import { competenciasService, type Competencia } from "./services/competenciasService";
import { plural } from "@/lib/texto";

function dataCurta(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const anoMesDe = (c: { ano: number; mes: number }) => `${c.ano}-${String(c.mes).padStart(2, "0")}`;

/** O mês seguinte ao mais recente já aberto (o mês atual, se não houver nenhum). */
function proximoMes(itens: Competencia[]) {
  const ultimo = itens.reduce<Competencia | null>((m, c) => (!m || c.ano * 12 + c.mes > m.ano * 12 + m.mes ? c : m), null);
  if (!ultimo) {
    const hoje = new Date();
    return { ano: hoje.getFullYear(), mes: hoje.getMonth() + 1 };
  }
  return ultimo.mes === 12 ? { ano: ultimo.ano + 1, mes: 1 } : { ano: ultimo.ano, mes: ultimo.mes + 1 };
}

type Passo = { rotulo: string; estado: "feito" | "atencao" | "falta"; dica: string; etapa?: string };

/** O andamento do mês em quatro passos: importado, classificado, apurado, fechado. */
function passosDe(c: Competencia): Passo[] {
  const a = c.andamento;
  if (!a) return [];
  const pendentes = a.pendencias + a.semClassificacao;
  return [
    a.balancete
      ? { rotulo: "Importado", estado: "feito", dica: "Balancete importado.", etapa: "importar" }
      : { rotulo: "Importado", estado: "falta", dica: "O balancete ainda não foi importado.", etapa: "importar" },
    a.lancamentos === 0
      ? { rotulo: "Classificado", estado: "falta", dica: "Nenhum lançamento para classificar.", etapa: "classificacao" }
      : pendentes > 0
        ? { rotulo: `Classificado · ${pendentes}`, estado: "atencao", dica: `${pendentes} ${plural(pendentes, "lançamento", "lançamentos")} com pendência ou sem classificação.`, etapa: "classificacao" }
        : { rotulo: "Classificado", estado: "feito", dica: `${a.lancamentos.toLocaleString("pt-BR")} lançamentos classificados.`, etapa: "classificacao" },
    c.apuracoes === 0
      ? { rotulo: "Apurado", estado: "falta", dica: "Ainda não apurada.", etapa: "dre" }
      : a.desatualizada
        ? { rotulo: "Reapurar", estado: "atencao", dica: "As entradas ou os Cadastros Gerais mudaram depois da apuração: reapure.", etapa: "dre" }
        : { rotulo: "Apurado", estado: "feito", dica: `Apurada ${c.apuracoes}× · a última em ${dataCurta(c.apuradaEm)}${c.usuarioApuracao ? ` por ${c.usuarioApuracao.nome}` : ""}.`, etapa: "dre" },
    c.status === "FECHADA"
      ? { rotulo: "Fechado", estado: "feito", dica: `Fechada em ${dataCurta(c.fechadaEm)}${c.usuarioFechamento ? ` por ${c.usuarioFechamento.nome}` : ""}.`, etapa: "dre" }
      : { rotulo: "Fechado", estado: "falta", dica: "Ainda não fechada.", etapa: "dre" },
  ];
}

const ESTILO_PASSO = {
  feito: { classe: "text-green-700", Icone: Check },
  atencao: { classe: "bg-yellow-50 text-yellow-800 border-yellow-200", Icone: AlertTriangle },
  falta: { classe: "text-gray-400", Icone: Circle },
} as const;

/** O que falta no mês, em poucas palavras (o primeiro passo não feito), para filtrar a coluna Andamento. */
const A_FAZER = ["A importar", "A classificar", "A apurar", "A fechar"];

function andamentoResumido(c: Competencia) {
  const passos = passosDe(c);
  if (passos.length === 0) return null;
  const i = passos.findIndex((p) => p.estado !== "feito");
  if (i < 0) return "Fechado";
  return i === 2 && passos[i].estado === "atencao" ? "A reapurar" : A_FAZER[i];
}

/** Os rótulos do StatusCompetenciaBadge, para o filtro da coluna Estado. */
const instante = (iso: string | null) => (iso ? new Date(iso).getTime() : null);

const COLUNAS: Coluna<Competencia>[] = [
  { chave: "competencia", rotulo: "Competência", tipo: "data", valor: (c) => c.ano * 12 + c.mes, texto: (c) => `${String(c.mes).padStart(2, "0")}/${c.ano}` },
  { chave: "estado", rotulo: "Estado", valor: (c) => rotuloStatus(c.status) },
  { chave: "andamento", rotulo: "Andamento", valor: andamentoResumido },
  {
    chave: "divergencias",
    rotulo: "Divergências",
    tipo: "numero",
    valor: (c) => c._count.divergencias,
    texto: (c) => (c._count.divergencias > 0 ? `${c._count.divergencias} ${plural(c._count.divergencias, "aberta", "abertas")}` : null),
  },
  {
    chave: "apuracao",
    rotulo: "Apurada em",
    tipo: "data",
    valor: (c) => (c.apuracoes === 0 ? null : instante(c.apuradaEm)),
    texto: (c) => (c.apuracoes === 0 || !c.apuradaEm ? null : dataCurta(c.apuradaEm)),
  },
  { chave: "fechadaEm", rotulo: "Fechada em", tipo: "data", valor: (c) => instante(c.fechadaEm), texto: (c) => (c.fechadaEm ? dataCurta(c.fechadaEm) : null) },
];

function Andamento({ c, etapas }: { c: Competencia; etapas: Etapa[] }) {
  return (
    <ol className="flex items-center gap-1" aria-label="Andamento do mês">
      {passosDe(c).map((p) => {
        const { classe, Icone } = ESTILO_PASSO[p.estado];
        const etapa = etapas.find((e) => e.chave === p.etapa);
        const conteudo = (
          <>
            <Icone className={p.estado === "falta" ? "size-2.5" : "size-3.5"} strokeWidth={p.estado === "feito" ? 3 : 2} />
            {p.rotulo}
          </>
        );
        const base = `inline-flex items-center gap-1 rounded-sm border border-transparent px-1 py-0.5 text-xs whitespace-nowrap ${classe}`;
        return (
          <li key={p.rotulo} title={p.dica}>
            {etapa ? (
              <Link href={`/competencias/${anoMesDe(c)}/${etapa.caminho}`} onClick={(e) => e.stopPropagation()} className={`${base} hover:border-gray-300`}>
                {conteudo}
              </Link>
            ) : (
              <span className={base}>{conteudo}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function CompetenciasContent() {
  const router = useRouter();
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  useRegistrarAcessoTela("/competencias");

  // Todos os meses; o recorte é pelos filtros dos rótulos (o ano, pela coluna Competência).
  const { data, isPending, isError } = useQuery({
    queryKey: ["competencias", "todos", "andamento"],
    queryFn: () => competenciasService.listar(undefined, true),
  });
  // Todas as competências (a mesma consulta do menu lateral), para sugerir o próximo mês.
  const todas = useQuery({ queryKey: ["competencias", "todos"], queryFn: () => competenciasService.listar() });

  const tabela = useTabelaFiltravel(data?.itens, COLUNAS);

  // As telas de cada mês que o perfil do usuário alcança (Passo 22), na ordem do fechamento.
  const etapas = etapasDoMes(hasPermission, user?.acesso);
  const abrirMes = (c: Competencia) => {
    if (etapas[0]) router.push(`/competencias/${anoMesDe(c)}/${etapas[0].caminho}`);
  };

  return (
    <div className="space-y-6">
      <CabecalhoDaTela
        titulo="Fechamento Mensal"
        exportar={<ExportarTabela titulo="Fechamento Mensal · Competências" colunas={COLUNAS} linhas={tabela.filtradas} />}
        comoUsar={
          <ul>
            <li>Use os filtros nos rótulos das colunas (por exemplo, o ano na coluna Competência).</li>
            <li>Clique na linha para abrir o mês; dentro dele, a barra de etapas leva de Importações até a Conferência e as Divergências.</li>
            <li>Na coluna Andamento, clique num passo (importado, classificado, apurado, fechado) para ir direto à etapa.</li>
            <li>A bola verde ao lado do mês pede reapuração: as entradas ou os Cadastros Gerais mudaram depois da apuração (os cadastros só contam nos meses ainda abertos), o mês anterior foi reapurado depois dele, ou ele recebeu dados importados a partir de outro mês. Reapure os meses em ordem, na tela Resultados de cada um.</li>
            <li>Use “Abrir Competência” para começar um mês novo.</li>
            <li>
              O aviso “Rateios sem Vigência” lista as competências em andamento com alguma chave de rateio sem regra vigente no mês: cadastre a regra em
              Cadastros Gerais / Regras de Rateio. Sem ela, a competência não se abre nem se fecha.
            </li>
          </ul>
        }
        sobre={
          <p>
            Cada mês do fechamento, o estado em que ele se encontra e o andamento das etapas.
          </p>
        }
        acoes={
          todas.data ? (
            <PermissionGuard permission="competencias:editar">
              <AbrirCompetenciaDialog sugestao={proximoMes(todas.data.itens)} />
            </PermissionGuard>
          ) : null
        }
      />

      {/* Os rateios sem regra vigente nas competências em andamento (14/10/2026). */}
      {(() => {
        const semRegra = (data?.itens ?? []).filter((c) => c.rateiosSemVigencia?.length);
        return semRegra.length ? (
          <div className="rounded-sm border border-l-4 border-gray-200 border-l-red-600 bg-white px-4 py-3 text-sm text-gray-700">
            <p className="font-medium text-gray-900">Rateios sem Vigência</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {semRegra.map((c) => (
                <li key={c.id}>
                  {String(c.mes).padStart(2, "0")}/{c.ano}: {c.rateiosSemVigencia!.join(", ")} sem regra vigente no mês.
                </li>
              ))}
            </ul>
            <p className="mt-1">Cadastre as regras em Cadastros Gerais / Regras de Rateio: sem elas, a competência não se abre nem se fecha.</p>
          </div>
        ) : null;
      })()}

      <QuadroTabela>
        <DataTable<Competencia>
          data={tabela.visiveis}
          cabecalho={tabela.cabecalho}
          filtrosAtivos={tabela.ativos}
          onLimparFiltros={tabela.limpar}
          isLoading={isPending}
          error={isError ? "Erro ao carregar as competências." : null}
          emptyMessage="Nenhuma competência aberta"
          emptyHint="Use o botão Abrir Competência para abrir o primeiro mês."
          columns={["Competência", "Estado", "Andamento", "Divergências", "Apurada em", "Fechada em"]}
          renderRow={(c) => (
            <tr key={c.id} onClick={() => abrirMes(c)} className="cursor-pointer border-b border-gray-100 hover:bg-gray-50">
              <td className="px-4 text-sm whitespace-nowrap">
                {etapas[0] ? (
                  <Link href={`/competencias/${anoMesDe(c)}/${etapas[0].caminho}`} onClick={(e) => e.stopPropagation()} className="font-bold text-gray-900">
                    {String(c.mes).padStart(2, "0")}/{c.ano}
                  </Link>
                ) : (
                  <span className="font-bold text-gray-900">
                    {String(c.mes).padStart(2, "0")}/{c.ano}
                  </span>
                )}
                <span className="ml-2 text-xs text-gray-500">{c.nomeMes}</span>
                {c.dadosNovos ? (
                  <span className="ml-2 inline-flex align-middle">
                    <SinalDadosNovos />
                  </span>
                ) : null}
              </td>
              <td className="px-4">
                <StatusCompetenciaBadge status={c.status} />
              </td>
              <td className="px-4">
                <Andamento c={c} etapas={etapas} />
              </td>
              <td className="px-4 text-sm">
                {c._count.divergencias > 0 ? (
                  <span className="font-medium text-yellow-800" title="Divergências abertas">
                    {c._count.divergencias} {plural(c._count.divergencias, "aberta", "abertas")}
                  </span>
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </td>
              <td className="px-4 text-sm whitespace-nowrap text-gray-600" title={c.apuracoes ? `${c.apuracoes} ${plural(c.apuracoes, "apuração", "apurações")}${c.usuarioApuracao ? ` · a última por ${c.usuarioApuracao.nome}` : ""}` : undefined}>
                {c.apuracoes === 0 ? <span className="text-gray-400">—</span> : dataCurta(c.apuradaEm)}
              </td>
              <td className="px-4 text-sm whitespace-nowrap text-gray-600">
                {dataCurta(c.fechadaEm)}
                {c._count.historicoReaberturas > 0 ? (
                  <span className="ml-1.5 text-xs text-yellow-800" title="Vezes em que foi reaberta depois de fechada">
                    reaberta {c._count.historicoReaberturas}×
                  </span>
                ) : null}
              </td>
            </tr>
          )}
        />
      </QuadroTabela>
    </div>
  );
}
