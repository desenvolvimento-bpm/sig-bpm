"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmacaoDialog } from "@/components/shared/ConfirmacaoDialog";
import { ExportarTabela } from "@/components/shared/ExportarTabela";
import { SemResultado, useTabelaFiltravel } from "@/components/shared/TabelaFiltravel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Coluna } from "@/lib/filtrosDeTabela";
import { lerNumero } from "@/lib/numero";
import { plural } from "@/lib/texto";

import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";

import { cenariosService, type BeneficiosDoCenario } from "../services/cenariosService";
import { botaoPrimario, Erro } from "./CenarioDialog";
import { Destaque, LinhaVazia, TabelaComDestaque, TD } from "./DestaqueDaAba";

/**
 * A aba Benefícios Padrão das Configurações dos cenários analíticos (21/11/2026, pedido do Adão), depois de Centros de Custo: os
 * benefícios do cenário (Cesta Básica, Vale-Transporte, Seguro de Vida, Plano de Saúde…), cada um com o Valor Mensal por
 * colaborador. Na aba Quadro de Lotação das Premissas, o botão Benefícios os aplica às linhas e aos meses marcados: os Benefícios de
 * cada mês são os colaboradores da linha × a soma dos aplicados, e a linha Benefícios Padrão dos centros de custo soma os do grupo.
 */

type Beneficio = BeneficiosDoCenario["beneficios"][number];

const reais = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const emUso = (b: Beneficio) => (b.valores ? `${b.linhas} ${plural(b.linhas, "linha", "linhas")} · ${b.valores} ${plural(b.valores, "valor", "valores")}` : "—");

const COLUNAS: Coluna<Beneficio>[] = [
  { chave: "nome", rotulo: "Nome", valor: (b) => b.nome },
  { chave: "descricao", rotulo: "Descrição", valor: (b) => b.descricao ?? "" },
  { chave: "valorMensal", rotulo: "Valor Mensal (/ Colab.)", tipo: "numero", alinhamento: "direita", valor: (b) => b.valorMensal },
  { chave: "emUso", rotulo: "Em Uso no Quadro de Lotação", valor: emUso },
];
const LARGURAS = [240, 440, 190, 240];

export function BeneficiosDoCenarioAba({ id, podeEditar }: { id: string; podeEditar: boolean }) {
  const consulta = useQuery({ queryKey: ["cenarios", id, "cadastros", "beneficios"], queryFn: () => cenariosService.beneficiosDoCenario(id) });
  // undefined: fechado; null: novo; o benefício: editando.
  const [aberto, setAberto] = useState<Beneficio | null | undefined>(undefined);
  const tabela = useTabelaFiltravel(consulta.data?.beneficios, COLUNAS);
  if (consulta.isError) return <Erro erro={mensagemDeErro(consulta.error, "Erro ao carregar os benefícios padrão do cenário.")} />;
  if (consulta.isPending) return <div className="h-64 animate-pulse rounded-sm bg-gray-100" />;
  const dados = consulta.data;
  const pode = podeEditar && dados.editavel;
  const destaque = (
    <Destaque
      titulo="Benefícios Padrão"
      descricao="Os benefícios do cenário, com o valor mensal por colaborador. Na aba Quadro de Lotação das Premissas, o botão Benefícios os aplica às linhas e aos meses marcados."
    >
      {pode ? (
        <Button type="button" className={botaoPrimario} onClick={() => setAberto(null)}>
          <Plus className="size-4" />
          Novo Benefício
        </Button>
      ) : null}
      <ExportarTabela titulo="Cenário · Configurações · Benefícios Padrão" colunas={COLUNAS} linhas={tabela.filtradas} />
    </Destaque>
  );
  return (
    <>
      <TabelaComDestaque
        destaque={destaque}
        larguras={LARGURAS}
        cabecalho={tabela.linhaDoCabecalho}
        corpo={
          dados.beneficios.length === 0 ? (
            <LinhaVazia colunas={COLUNAS.length} texto="Nenhum benefício padrão no cenário." />
          ) : tabela.visiveis.length === 0 ? (
            <SemResultado colunas={COLUNAS.length} onLimpar={tabela.limpar} />
          ) : (
            tabela.visiveis.map((b) => (
              <tr
                key={b.id}
                className={`border-t border-gray-100 ${pode ? "cursor-pointer hover:bg-gray-100" : ""}`}
                onClick={pode ? () => setAberto(b) : undefined}
                title={pode ? "Editar o benefício" : undefined}
              >
                <td className={`${TD} font-medium`}>{b.nome}</td>
                <td className={TD} title={b.descricao ?? undefined}>
                  {b.descricao || "—"}
                </td>
                <td className={`${TD} text-right`}>{reais(b.valorMensal)}</td>
                <td className={TD}>{emUso(b)}</td>
              </tr>
            ))
          )
        }
      />
      {aberto !== undefined ? <BeneficioDialog id={id} beneficio={aberto} onFechar={() => setAberto(undefined)} /> : null}
    </>
  );
}

function BeneficioDialog({ id, beneficio, onFechar }: { id: string; beneficio: Beneficio | null; onFechar: () => void }) {
  const queryClient = useQueryClient();
  const [nome, setNome] = useState(beneficio?.nome ?? "");
  const [descricao, setDescricao] = useState(beneficio?.descricao ?? "");
  const [valor, setValor] = useState(beneficio ? reais(beneficio.valorMensal) : "");
  const [excluindo, setExcluindo] = useState(false);
  const lido = lerNumero(valor);
  const valorValido = lido !== null && lido >= 0;
  const concluir = (mensagem: string) => {
    // O valor de um benefício em uso muda o Quadro de Lotação, os centros de custo e a DRE do cenário.
    queryClient.invalidateQueries({ queryKey: ["cenarios"] });
    queryClient.invalidateQueries({ queryKey: ["relatorios"] });
    toast.success(mensagem);
    onFechar();
  };
  const gravar = useMutation({
    mutationFn: () => cenariosService.gravarBeneficioDoCenario(id, beneficio?.id ?? null, { nome: nome.trim(), descricao: descricao.trim() || null, valorMensal: lido ?? 0 }),
    onSuccess: () => concluir(beneficio ? "Benefício gravado." : "Benefício incluído."),
  });
  const apagar = useMutation({ mutationFn: () => cenariosService.excluirBeneficioDoCenario(id, beneficio!.id), onSuccess: () => concluir("Benefício excluído.") });
  const pendente = gravar.isPending || apagar.isPending;
  const erro = gravar.isError ? mensagemDeErro(gravar.error, "Não foi possível gravar o benefício.") : apagar.isError ? mensagemDeErro(apagar.error, "Não foi possível excluir o benefício.") : null;
  return (
    <Dialog open onOpenChange={(o) => (!o && !pendente ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="max-h-[90vh] overflow-y-auto rounded-sm sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{beneficio ? "Editar Benefício Padrão" : "Novo Benefício Padrão"}</DialogTitle>
          <DialogDescription>
            O Valor Mensal é por colaborador: nos meses em que o benefício está aplicado no Quadro de Lotação, os Benefícios da linha são os
            colaboradores dela × este valor (somado aos outros benefícios aplicados).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bp-nome">Nome</Label>
            <Input id="bp-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} placeholder="Ex.: Plano de Saúde" className="rounded-sm" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bp-descricao">Descrição</Label>
            <Input id="bp-descricao" value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={500} placeholder="Opcional" className="rounded-sm" />
          </div>
          {/* O campo do valor encostado à esquerda do modal, com o número à esquerda (nunca solto no meio do layout), e com o milhar
              e duas casas ao sair do campo: "1500" → "1.500,00". */}
          <div className="space-y-1.5 sm:w-48">
            <Label htmlFor="bp-valor">Valor Mensal (/ Colab.)</Label>
            <Input
              id="bp-valor"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              onBlur={() => (lido !== null && lido >= 0 ? setValor(reais(lido)) : undefined)}
              inputMode="decimal"
              placeholder="0,00"
              className={`rounded-sm ${valor.trim() && !valorValido ? "border-red-400" : ""}`}
            />
          </div>
          {beneficio?.valores ? (
            <p className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Em uso em {beneficio.linhas} {plural(beneficio.linhas, "linha", "linhas")} do Quadro de Lotação ({beneficio.valores}{" "}
              {plural(beneficio.valores, "valor", "valores")}, linha × mês): mudar o valor recalcula os Benefícios delas e os centros de custo, e a DRE fica pendente de recálculo (Resultados / Recalcular).
            </p>
          ) : null}
        </div>
        <Erro erro={erro} />
        <DialogFooter>
          {beneficio ? (
            <Button type="button" variant="outline" className="rounded-sm border-red-300 text-red-700 hover:bg-red-50 sm:mr-auto" disabled={pendente} onClick={() => setExcluindo(true)}>
              <Trash2 className="size-4" />
              Excluir
            </Button>
          ) : null}
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar} disabled={pendente}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={!nome.trim() || !valorValido || pendente} onClick={() => gravar.mutate()}>
            {gravar.isPending ? "Gravando…" : "Gravar"}
          </Button>
        </DialogFooter>
        {excluindo && beneficio ? (
          <ConfirmacaoDialog
            titulo="Excluir o Benefício Padrão"
            descricao={
              beneficio.valores
                ? `O benefício ${beneficio.nome} sai do cenário e de ${beneficio.valores} ${plural(beneficio.valores, "valor", "valores")} do Quadro de Lotação (${beneficio.linhas} ${plural(beneficio.linhas, "linha", "linhas")}); os centros de custo se recalculam, e a DRE fica pendente de recálculo (Resultados / Recalcular).`
                : `O benefício ${beneficio.nome} sai do cenário.`
            }
            pendente={apagar.isPending}
            onConfirmar={() => apagar.mutate(undefined, { onSettled: () => setExcluindo(false) })}
            onFechar={() => setExcluindo(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
