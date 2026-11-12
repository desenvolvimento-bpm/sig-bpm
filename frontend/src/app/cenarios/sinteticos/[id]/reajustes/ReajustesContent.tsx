"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { useAbaLembrada } from "@/hooks/useAbaLembrada";
import { ExportarTabela } from "@/components/shared/ExportarTabela";
import { Abas } from "@/components/shared/Abas";
import { CabecalhoDaTela } from "@/components/shared/CabecalhoDaTela";
import { DataTable } from "@/components/shared/DataTable";
import { QuadroTabela } from "@/components/shared/QuadroTabela";
import { useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePermissions } from "@/context/PermissionContext";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";
import type { Coluna } from "@/lib/filtrosDeTabela";

import { formato } from "@/app/relatorios/services/relatoriosService";

import { AvisoMarcado, estaTravado } from "../../../components/AvisoMarcado";
import { JustificativasCenario } from "../../../components/JustificativasCenario";
import { cenariosService, type ReajusteDoCenario } from "../../../services/cenariosService";
import { useTipoDoCenario } from "../../../components/tipoDoCenario";

const ABAS = ["Consolidado", "Matriz", "Filial", "Serviços", "Despesas e Extra", "RN"];
const MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
const comSinal = (v: number, texto: string) => (v > 0 ? `+${texto}` : texto);

/** O tipo: o reajuste dos marcados, a edição de um valor (replicada ou não) ou a carga de uma referência. */
const tipoDe = (r: ReajusteDoCenario) =>
  r.tipo === "MARCADOS"
    ? "Reajuste dos Marcados"
    : r.tipo === "REFERENCIA"
      ? "Referência Carregada"
      : r.tipo === "RECALCULO"
        ? "Recálculo"
        : r.tipo === "MEDIAS"
          ? "Médias Replicadas / Valores Apagados"
          : r.tipo === "IMPORTACAO"
            ? "Valores Importados"
            : r.replicado
              ? "Edição de Valor (Replicada)"
              : "Edição de Valor";
/** Os tipos que trazem a descrição no lugar das contas e sem o reajuste (15/10/2026: o recálculo, as médias e a importação). */
const comDescricao = (r: ReajusteDoCenario) => ["REFERENCIA", "RECALCULO", "MEDIAS", "IMPORTACAO"].includes(r.tipo);
/** O reajuste informado: +5,00%, +1.000 ou o valor digitado direto. */
const reajusteDe = (r: ReajusteDoCenario) => {
  if (comDescricao(r)) return null;
  if (r.modo === "DIGITADO" || r.reajuste === null) return "Valor digitado";
  return r.modo === "PERCENTUAL" ? `${comSinal(r.reajuste, formato.valor(r.reajuste))}%` : comSinal(r.reajuste, formato.valor(r.reajuste));
};
/** Os meses: JAN, ou JAN a MAR quando seguidos, ou a lista. */
const mesesDe = (ms: number[]) => {
  if (!ms.length) return null;
  const seguidos = ms.every((m, k) => k === 0 || m === ms[k - 1] + 1);
  return ms.length === 1 ? MESES[ms[0] - 1] : seguidos ? `${MESES[ms[0] - 1]} a ${MESES[ms[ms.length - 1] - 1]}` : ms.map((m) => MESES[m - 1]).join(", ");
};
const contasDe = (r: ReajusteDoCenario) =>
  comDescricao(r) ? r.descricao : r.contas.length === 1 ? r.contas[0].descricao : `${r.contas.length} contas: ${r.contas.map((c) => c.descricao).join(", ")}`;
const diferenca = (r: ReajusteDoCenario) => (r.somaAntes === null || r.somaDepois === null ? null : r.somaDepois - r.somaAntes);

// As 11 colunas cabem na tela com o espaço lateral menor (13/10/2026): o rótulo e as células com 10 px de cada lado.
const COLUNAS: Coluna<ReajusteDoCenario>[] = [
  { chave: "data", rotulo: "Data", classe: "!px-2.5", tipo: "data", valor: (r) => new Date(r.criadoEm).getTime(), texto: (r) => dataHora(r.criadoEm) },
  { chave: "usuario", rotulo: "Usuário", classe: "!px-2.5", valor: (r) => r.usuarioNome },
  { chave: "tipo", rotulo: "Tipo", classe: "!px-2.5", valor: tipoDe },
  { chave: "aba", rotulo: "Aba", classe: "!px-2.5", valor: (r) => (r.visao === null ? null : ABAS[r.visao]) },
  { chave: "reajuste", rotulo: "Reajuste", classe: "!px-2.5", valor: reajusteDe },
  { chave: "contas", rotulo: "Contas", classe: "!px-2.5", valor: contasDe },
  { chave: "meses", rotulo: "Meses", classe: "!px-2.5", valor: (r) => mesesDe(r.meses) },
  { chave: "valores", rotulo: "Valores", classe: "!px-2.5", tipo: "numero", alinhamento: "direita", valor: (r) => (r.tipo === "REFERENCIA" ? null : r.valores), texto: (r) => (r.tipo === "REFERENCIA" ? null : String(r.valores)) },
  { chave: "antes", rotulo: "Soma Antes", classe: "!px-2.5", tipo: "numero", alinhamento: "direita", valor: (r) => r.somaAntes, texto: (r) => (r.somaAntes === null ? null : formato.valor(r.somaAntes)) },
  { chave: "depois", rotulo: "Soma Depois", classe: "!px-2.5", tipo: "numero", alinhamento: "direita", valor: (r) => r.somaDepois, texto: (r) => (r.somaDepois === null ? null : formato.valor(r.somaDepois)) },
  {
    chave: "diferenca",
    rotulo: "Diferença",
    classe: "!px-2.5",
    tipo: "numero",
    alinhamento: "direita",
    valor: diferenca,
    texto: (r) => {
      const d = diferenca(r);
      return d === null ? null : comSinal(Math.round(d * 100) / 100, formato.valor(d));
    },
  },
];

/**
 * O histórico de reajustes de um cenário (12/10/2026), como um log: cada gravação de valores da DRE (o reajuste dos
 * marcados ou a edição de um valor) e cada carga de referência, do mais recente ao mais antigo.
 */
export function ReajustesContent() {
  const { id } = useParams<{ id: string }>();
  const t = useTipoDoCenario();
  useRegistrarAcessoTela(`${t.base}/${id}/reajustes`);
  const { hasPermission: pode } = usePermissions();
  const podeHistorico = pode(t.perm("reajustes", "ler", "historico"));
  const { data, isPending, isError } = useQuery({ queryKey: ["cenarios", id, "reajustes"], queryFn: () => cenariosService.reajustes(id), enabled: podeHistorico });
  const tabela = useTabelaFiltravel(data, COLUNAS);
  // O modal das contas (ou da descrição da referência) de uma linha (13/10/2026; antes, a lista na coluna Contas).
  const [aberto, setAberto] = useState<ReajusteDoCenario | null>(null);
  // As abas (13/10/2026): Histórico (o log) e, com um cenário comparado, Justificativas (antes, da tela Comparativo).
  const { hasPermission } = usePermissions();
  const cenario = useQuery({ queryKey: ["cenarios", id], queryFn: () => cenariosService.obter(id) });
  const comComparativo = !!cenario.data?.comparadoComId && hasPermission(t.perm("reajustes", "ler", "justificativas"));
  const [escolhida, setAba] = useAbaLembrada<"historico" | "justificativas">("aba", "historico", ["historico", "justificativas"]);
  // As abas que o perfil lê (14/10/2026).
  const aba = comComparativo && (escolhida === "justificativas" || !podeHistorico) ? "justificativas" : podeHistorico ? "historico" : null;
  // Nos analíticos (19/10/2026), a tela se chama Histórico e a aba do log, Alterações.
  const analitico = t.tipo === "ANALITICO";
  const doLog = analitico ? "Alterações" : "Histórico";
  return (
    <div className="space-y-6">
      <CabecalhoDaTela
        titulo={analitico ? "Histórico" : "Reajustes"}
        exportar={escolhida === "historico" ? <ExportarTabela titulo={analitico ? "Cenário · Histórico" : "Cenário · Reajustes"} colunas={COLUNAS} linhas={tabela.filtradas} /> : null}
        comoUsar={
          <ul>
            <li>
              Na aba {doLog}, cada linha é uma gravação na DRE do cenário ({analitico ? "as Premissas, os centros de custo, os investimentos, o recálculo" : "tela Resultados"}) ou a carga de
              uma referência (tela Configurações), do mais recente ao mais antigo. Aparecem só as abas que o seu perfil lê (Controle de Usuários / Perfis).
            </li>
            <li>Tipo: Reajuste dos Marcados (o reajuste aplicado às contas e meses marcados), Edição de Valor (um valor clicado; Replicada quando copiado aos meses seguintes) ou Referência Carregada (um arquivo ou o resultado realizado, que substitui a DRE).</li>
            <li>Reajuste: o percentual ou o valor informado; “Valor digitado” quando o valor recalculado foi digitado direto. As somas são as dos valores alterados, antes e depois.</li>
            <li>
              Na coluna Contas, o botão abre o modal com as contas alteradas (Departamento, Atribuição e Conta) ou, na Referência Carregada, a descrição
              da referência. Use os filtros nos rótulos das colunas.
            </li>
            <li>
              Na aba Justificativas (só com um cenário comparado, em Configurações / Comparativo): escolha a aba da DRE (Consolidado ou cada unidade); acima
              da tabela, quantas contas da aba passam da variação{analitico ? " — a variação máxima de cada conta é a do Índice de Referência escolhido para ela nas Variações Máximas (Configurações / Comparativo)" : ""}. Cada linha é uma conta com algum mês acima da variação máxima dela: os meses
              mostram a variação (passe o mouse para ver o valor do cenário e o do comparado; “sem base”: o comparado é zero no mês). Digite a
              justificativa e clique em “Gravar”; apagar o texto e gravar a apaga. “Só Sem Justificativa” esconde as já justificadas. Uma conta que
              deixa de passar da variação sai da lista (a justificativa fica guardada). Com o cenário marcado ou com a versão congelada, as
              justificativas só se leem. “Exportar”, acima da tabela, leva as contas da aba (com os meses e as justificativas) em Excel ou PDF.
            </li>
          </ul>
        }
        sobre={
          <>
            <p>O histórico dos reajustes do cenário: quem, quando, em que aba, que contas e meses, o reajuste e o efeito nas somas dos valores alterados.</p>
            <p>
              As justificativas: com um cenário comparado, as contas que variam, num mês, mais do que a variação máxima delas em relação ao
              comparado (a diferença dividida pelo valor do comparado, para mais ou para menos), também os volumes de Produção e Serviços (PS).
              Os totais que só somam outros (CPV, MB, MC, DFO, EBITDA, EBIT, NOPAT, RF, DF e RL) não se verificam.
            </p>
          </>
        }
      />
      <Abas
        rotulo={analitico ? "Histórico do cenário" : "Reajustes do cenário"}
        ativa={aba ?? ""}
        onMudar={(a) => setAba(a as "historico" | "justificativas")}
        abas={[...(podeHistorico ? [{ chave: "historico", rotulo: doLog }] : []), ...(comComparativo ? [{ chave: "justificativas", rotulo: "Justificativas" }] : [])]}
      />
      {aba === null ? (
        <p className="rounded-sm border border-gray-200 bg-white p-6 text-sm text-gray-600">Seu perfil não tem acesso a nenhuma aba desta tela.</p>
      ) : aba === "justificativas" ? (
        // O cenário travado (marcado ou com a versão congelada): as justificativas não se editam (14/10/2026).
        <div className="space-y-4">
          {cenario.data && estaTravado(cenario.data) && hasPermission(t.perm("reajustes", "editar", "justificativas")) ? (
            <AvisoMarcado cenario={cenario.data} oQue="as justificativas" varios />
          ) : null}
          <JustificativasCenario
            id={id}
            podeEditar={hasPermission(t.perm("reajustes", "editar", "justificativas")) && !!cenario.data && !estaTravado(cenario.data)}
          />
        </div>
      ) : (
        <QuadroTabela>
          <DataTable<ReajusteDoCenario>
            data={tabela.visiveis}
            cabecalho={tabela.cabecalho}
            filtrosAtivos={tabela.ativos}
            onLimparFiltros={tabela.limpar}
            isLoading={isPending}
            error={isError ? "Erro ao carregar o histórico de reajustes." : null}
            emptyMessage="Nenhum reajuste ainda"
            emptyHint="Os reajustes feitos na tela Resultados e as cargas de referência aparecem aqui."
            columns={COLUNAS.map((c) => c.rotulo)}
            renderRow={(r) => (
              <tr key={r.id} className="border-b border-gray-100 align-top">
                {COLUNAS.map((c) => {
                  const texto = c.texto ? c.texto(r) : c.valor?.(r);
                  return (
                    <td
                      key={c.chave}
                      className={`px-2.5 py-2 text-sm ${c.alinhamento === "direita" || c.chave === "data" || c.chave === "contas" ? "whitespace-nowrap" : ""} ${c.alinhamento === "direita" ? "text-right" : ""}`}
                    >
                      {c.chave === "contas" ? (
                        <button type="button" className={botaoCinza} onClick={() => setAberto(r)}>
                          {botaoDasContas(r)}
                        </button>
                      ) : (
                        (texto ?? <span className="text-gray-400">—</span>)
                      )}
                    </td>
                  );
                })}
              </tr>
            )}
          />
        </QuadroTabela>
      )}
      {aberto ? <ContasDialog reajuste={aberto} onFechar={() => setAberto(null)} /> : null}
    </div>
  );
}

/** O botão da coluna Contas: cinza-claro, como os da barra de marcação dos Resultados. */
const botaoCinza = "rounded-sm border border-gray-200 bg-gray-100 px-3 py-1 text-xs font-medium text-gray-900 hover:bg-gray-200";
const botaoDasContas = (r: ReajusteDoCenario) =>
  comDescricao(r) ? "Ver Descrição" : r.contas.length === 1 ? "Ver 1 Conta" : `Ver ${r.contas.length.toLocaleString("pt-BR")} Contas`;

/**
 * O modal de uma linha do histórico (13/10/2026): as contas alteradas, numa tabela com o Departamento e a Atribuição
 * (da linha da conta na Estrutura da DRE) e a Conta; na Referência Carregada, a descrição da referência.
 */
function ContasDialog({ reajuste: r, onFechar }: { reajuste: ReajusteDoCenario; onFechar: () => void }) {
  const referencia = comDescricao(r);
  const meses = mesesDe(r.meses);
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent className={`max-h-[85vh] overflow-y-auto rounded-sm ${referencia ? "sm:max-w-lg" : "sm:max-w-3xl"}`}>
        <DialogHeader>
          <DialogTitle>{referencia ? tipoDe(r) : r.contas.length === 1 ? "Conta Alterada" : "Contas Alteradas"}</DialogTitle>
          <DialogDescription>
            {referencia ? null : `${tipoDe(r)} · `}
            {dataHora(r.criadoEm)} · {r.usuarioNome}
            {r.visao !== null ? ` · ${ABAS[r.visao]}` : ""}
            {meses ? ` · ${meses}` : ""}
          </DialogDescription>
        </DialogHeader>
        {referencia ? (
          <p className="text-sm text-gray-700">{r.descricao ?? "Sem descrição."}</p>
        ) : (
          <div className="rounded-sm border border-gray-200">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-3 py-2 text-left text-xs font-bold text-gray-600">Departamento</th>
                  <th className="px-3 py-2 text-left text-xs font-bold text-gray-600">Atribuição</th>
                  <th className="px-3 py-2 text-left text-xs font-bold text-gray-600">Conta</th>
                </tr>
              </thead>
              <tbody>
                {r.contas.map((c) => (
                  <tr key={c.codigo} className="border-b border-gray-100 align-top last:border-b-0">
                    <td className="px-3 py-1.5 text-sm">{c.departamento ?? <span className="text-gray-400">—</span>}</td>
                    <td className="px-3 py-1.5 text-sm">{c.atribuicao ?? <span className="text-gray-400">—</span>}</td>
                    <td className="px-3 py-1.5 text-sm text-gray-900">{c.descricao}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
