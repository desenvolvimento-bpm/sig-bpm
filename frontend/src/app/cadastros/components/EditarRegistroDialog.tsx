"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BuscaNaLista } from "@/components/shared/BuscaNaLista";
import { atualizarCompetencia } from "@/lib/atualizarCompetencia";
import { iniciaisMaiusculas } from "@/lib/texto";

import { formatarValorDoPainel } from "@/app/relatorios/painel/PainelContent";
import { fatorDaEscalaDa, type FormatoPainel } from "@/app/relatorios/services/relatoriosService";

import {
  edicaoService,
  mensagemDeErro,
  sugestoesDoErro,
  textoDoEfeito,
  type Campo,
  type DefinicaoCadastro,
  type Registro,
  type Sugestao,
  type TesteDaFormula,
  type ValoresDaMetodologia,
} from "../services/edicaoService";
import { EditorFormula, formatarValorDoItem } from "./EditorFormula";

/** Os cadastros com a Metodologia testável (11/11/2026): os cards do Painel de Bordo e os indicadores. */
const COM_TESTE = ["painel-bordo", "estrutura-indicadores"];

/** O valor do indicador no teste: em %, 0,00%; nos demais, #.##0,00 na escala da unidade (R$ M, R$ K), com ela. */
function formatarDoIndicador(v: number | null, unidade?: string) {
  if (v === null) return "—";
  if (unidade === "%") return formatarValorDoItem(v, true);
  return `${formatarValorDoItem(v * fatorDaEscalaDa(unidade ?? ""), false)}${unidade ? ` ${unidade}` : ""}`;
}

type Props = { entidade: string; id: string | null; onFechar: () => void };

/** "A, B e C". */
const emLista = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}` : (xs[0] ?? ""));

const classeSelect = "h-9 w-full rounded-sm border border-gray-300 bg-white px-3 text-sm";

/** O valor do campo como a tela o edita. */
const paraTela = (c: Campo, v: unknown) => {
  if (c.tipo === "booleano") return v !== false;
  if (c.tipo === "multipla") return Array.isArray(v) ? v.map(String) : [];
  if (v === null || v === undefined) return "";
  // O decimal com vírgula, sem o resíduo de ponto flutuante da planilha (1298,1919999999998).
  if (c.tipo === "decimal" && c.moeda) return Number(v).toFixed(2).replace(".", ",");
  return c.tipo === "decimal" ? String(Number(Number(v).toFixed(6))).replace(".", ",") : String(v);
};

/** As opções do campo: as do valor escolhido no campo que o filtra, quando há um (11/10/2026). */
const opcoesVisiveis = (c: Campo, valores: Record<string, unknown>) =>
  c.filtradoPor ? (c.opcoes ?? []).filter((o) => !o.grupos || o.grupos.includes(String(valores[c.filtradoPor!] ?? ""))) : (c.opcoes ?? []);

function CampoForm({
  c,
  valor,
  onMuda,
  editando,
  comMovimento,
  opcoes,
  semFiltro,
  valoresDaMetodologia,
}: {
  c: Campo;
  valor: unknown;
  onMuda: (v: unknown) => void;
  editando: boolean;
  comMovimento: boolean;
  /** As opções a mostrar (já filtradas). */
  opcoes: Campo["opcoes"];
  /** O rótulo do campo que filtra a lista, ainda sem valor. */
  semFiltro?: string;
  /** Os valores acumulados dos itens da Metodologia (11/11/2026). */
  valoresDaMetodologia?: ValoresDaMetodologia;
}) {
  // Travado: calculado, só na criação, ou campo-chave de um registro com movimentos (11/10/2026).
  const travado = c.derivado || (editando && c.somenteNaCriacao) || comMovimento;
  const id = `campo-${c.nome}`;
  if (c.tipo === "booleano") {
    return (
      // Na altura de um campo (h-9) e encostada embaixo da célula: ao lado de uma lista ou de um campo com rótulo, a caixa
      // fica na meia altura dele (20/10/2026).
      <label className="flex h-9 items-center gap-2 text-sm text-gray-900">
        <input type="checkbox" checked={valor === true} disabled={travado} onChange={(e) => onMuda(e.target.checked)} className="size-4 accent-black" />
        {iniciaisMaiusculas(c.rotulo)}
      </label>
    );
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {c.rotulo}
        {c.obrigatorio && !travado ? <span className="text-red-700"> *</span> : null}
      </Label>
      {c.tipo === "formula" ? (
        <EditorFormula id={id} valor={String(valor ?? "")} onMuda={onMuda} opcoes={c.opcoes ?? []} travado={travado} valores={valoresDaMetodologia} />
      ) : c.tipo === "opcao" && c.busca && !travado ? (
        // A lista com busca (13/11/2026): digitar filtra pelos termos, sem acento e em qualquer ordem.
        <BuscaNaLista
          id={id}
          opcoes={(opcoes ?? []).map((o) => ({ id: o.valor, codigo: "", nome: o.rotulo }))}
          valor={(() => {
            const o = opcoes?.find((x) => x.valor === valor);
            return o ? { id: o.valor, codigo: "", nome: o.rotulo } : null;
          })()}
          onEscolher={(o) => onMuda(o?.id ?? "")}
          placeholder={`Digite para buscar: ${c.rotulo.toLowerCase()}`}
        />
      ) : c.tipo === "opcao" && !travado ? (
        // Com a ajuda ao lado (21/10/2026), a lista na metade da linha e a explicação na outra.
        <div className={c.ajudaAoLado ? "grid items-center gap-x-4 gap-y-1.5 sm:grid-cols-2" : undefined}>
          <select id={id} value={String(valor ?? "")} onChange={(e) => onMuda(e.target.value)} className={classeSelect}>
            <option value="">{semFiltro ? `Escolha antes: ${semFiltro}` : c.obrigatorio ? "Escolha…" : "—"}</option>
            {opcoes?.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </select>
          {c.ajudaAoLado && c.ajuda ? <p className="text-xs text-gray-500">{c.ajuda}</p> : null}
        </div>
      ) : c.tipo === "multipla" ? (
        <div className="flex flex-wrap gap-3">
          {c.opcoes?.map((o) => {
            const lista = (valor as string[]) ?? [];
            return (
              <label key={o.valor} className="flex items-center gap-1.5 text-sm text-gray-700">
                <input
                  type="checkbox"
                  disabled={travado}
                  checked={lista.includes(o.valor)}
                  onChange={(e) => onMuda(e.target.checked ? [...lista, o.valor] : lista.filter((x) => x !== o.valor))}
                  className="size-4 accent-black"
                />
                {o.rotulo}
              </label>
            );
          })}
        </div>
      ) : c.tipo === "texto" && c.multilinha ? (
        // O texto longo (06/11/2026: as Competências e as Atividades das funções).
        <textarea
          id={id}
          value={String(valor ?? "")}
          disabled={travado}
          rows={4}
          onChange={(e) => onMuda(e.target.value)}
          className="w-full rounded-sm border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-50"
        />
      ) : (
        <Input
          id={id}
          value={c.tipo === "opcao" ? (c.opcoes?.find((o) => o.valor === valor)?.rotulo ?? String(valor ?? "")) : String(valor ?? "")}
          disabled={travado}
          type={c.tipo === "data" ? "date" : "text"}
          inputMode={c.tipo === "inteiro" || c.tipo === "decimal" ? "decimal" : undefined}
          onChange={(e) => onMuda(e.target.value)}
          className="rounded-sm"
        />
      )}
      {c.ajuda && !(c.ajudaAoLado && c.tipo === "opcao" && !travado) ? <p className="text-xs text-gray-500">{c.ajuda}</p> : null}
    </div>
  );
}

function Formulario({ def, registro, entidade, onFechar }: { def: DefinicaoCadastro; registro: Registro | null; entidade: string; onFechar: () => void }) {
  const queryClient = useQueryClient();
  const [valores, setValores] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(def.campos.map((c) => [c.nome, paraTela(c, registro ? registro[c.nome] : (c.padrao ?? (c.tipo === "booleano" ? true : undefined)))])),
  );
  const [confirmaExclusao, setConfirmaExclusao] = useState(false);
  // A gravação recusada com as correções possíveis (24/10/2026: a conta que nenhuma aba de resultado lê).
  const [recusa, setRecusa] = useState<{ mensagem: string; sugestoes: Sugestao[] } | null>(null);
  const travas = registro?.__travas;
  // A Metodologia testável (11/11/2026): os valores dos itens ao lado de cada um e o Testar, com o resultado até mudar o formulário.
  const comTeste = COM_TESTE.includes(entidade);
  const valoresDaMetodologia = useQuery({
    queryKey: ["edicao", entidade, "valores-da-metodologia"],
    queryFn: () => edicaoService.valoresDaMetodologia(entidade),
    enabled: comTeste,
    staleTime: 5 * 60_000,
  });
  const [teste, setTeste] = useState<TesteDaFormula | null>(null);
  const testar = useMutation({
    mutationFn: () => edicaoService.testar(entidade, valores, registro?.id ?? null),
    onSuccess: setTeste,
    onError: (e) => {
      setTeste(null);
      toast.error(mensagemDeErro(e, "Não foi possível testar."));
    },
  });
  const aplicar = (s: Sugestao) => {
    setValores((x) => {
      const novo = { ...x };
      for (const [nome, v] of Object.entries(s.valores)) {
        const c = def.campos.find((y) => y.nome === nome);
        if (c) novo[nome] = paraTela(c, v);
      }
      return novo;
    });
    setRecusa(null);
  };
  const concluir = (msg: string, efeito?: { reclassificadas: string[]; apuradasPorReapurar: string[] }) => {
    const extra = efeito ? textoDoEfeito(efeito) : "";
    toast.success(`${msg}${extra ? ` ${extra}` : ""}`);
    atualizarCompetencia(queryClient);
    onFechar();
  };
  const salvar = useMutation({
    mutationFn: () => {
      const enviar = Object.fromEntries(
        def.campos.filter((c) => !c.derivado && c.noFormulario !== false && !registro?.__travas?.campos.includes(c.nome)).map((c) => [c.nome, valores[c.nome]]),
      );
      return registro ? edicaoService.atualizar(entidade, registro.id, enviar) : edicaoService.criar(entidade, enviar);
    },
    onSuccess: (r) => concluir(registro ? `${def.titulo} atualizado.` : `${def.titulo} criado.`, r),
    onError: (e) => {
      const sugestoes = sugestoesDoErro(e);
      if (sugestoes.length) setRecusa({ mensagem: mensagemDeErro(e, "Não foi possível gravar."), sugestoes });
      else toast.error(mensagemDeErro(e, "Não foi possível gravar."));
    },
  });
  const excluir = useMutation({
    mutationFn: () => edicaoService.excluir(entidade, registro!.id),
    onSuccess: (r) => concluir(`${def.titulo} excluído.`, r),
    onError: (e) => {
      setConfirmaExclusao(false);
      toast.error(mensagemDeErro(e, "Não foi possível excluir."));
    },
  });

  return (
    <>
      {travas?.movimentos ? (
        <div className="rounded-sm border border-l-4 border-gray-200 border-l-yellow-600 bg-white px-4 py-2.5 text-sm text-gray-700">
          <p className="font-medium text-gray-900">Registro com movimentos.</p>
          <p>
            {travas.movimentos}{" "}
            {travas.campos.length
              ? `Por isso, ${emLista(def.campos.filter((c) => travas.campos.includes(c.nome)).map((c) => c.rotulo))} ${travas.campos.length > 1 ? "não mudam" : "não muda"}${def.excluir ? " e o registro não se exclui" : ""}: ${travas.campos.length > 1 ? "essas informações ligam" : "essa informação liga"} o cadastro a outras telas.`
              : ""}
          </p>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {def.campos.filter((c) => c.noFormulario !== false && (!c.visivelSe || c.visivelSe.valores.includes(String(valores[c.visivelSe.campo] ?? "")))).map((c) => (
          <div key={c.nome} className={c.larguraInteira || c.tipo === "multipla" || c.tipo === "formula" || c.nome === "expressao" || c.nome === "definicao" ? "sm:col-span-2" : c.tipo === "booleano" ? "self-end" : ""}>
            <CampoForm
              c={c}
              valor={valores[c.nome]}
              editando={!!registro}
              comMovimento={!!travas?.campos.includes(c.nome)}
              opcoes={opcoesVisiveis(c, valores)}
              semFiltro={c.filtradoPor && !valores[c.filtradoPor] ? def.campos.find((x) => x.nome === c.filtradoPor)?.rotulo : undefined}
              valoresDaMetodologia={valoresDaMetodologia.data}
              onMuda={(v) => {
                setRecusa(null);
                setTeste(null);
                setValores((x) => {
                  const novo = { ...x, [c.nome]: v };
                  // A lista que depende deste campo perde a escolha que não é mais dele; fica a equivalente, quando a
                  // opção tem chave e o novo filtro tem uma de mesma chave (a linha da DRE ao trocar o departamento).
                  for (const d of def.campos.filter((y) => y.filtradoPor === c.nome)) {
                    if (!novo[d.nome] || opcoesVisiveis(d, novo).some((o) => o.valor === novo[d.nome])) continue;
                    const chave = d.opcoes?.find((o) => o.valor === novo[d.nome])?.chave;
                    novo[d.nome] = (chave && opcoesVisiveis(d, novo).find((o) => o.chave === chave)?.valor) || "";
                  }
                  return novo;
                });
              }}
            />
          </div>
        ))}
      </div>
      {recusa ? (
        // Rola até o aviso quando ele aparece: com o formulário longo, ficaria abaixo da área visível.
        <div ref={(el) => el?.scrollIntoView({ block: "nearest" })} className="rounded-sm border border-l-4 border-gray-200 border-l-red-700 bg-white px-4 py-2.5 text-sm text-gray-700">
          <p className="font-medium text-gray-900">A gravação foi recusada.</p>
          <p>{recusa.mensagem}</p>
          <ul className="mt-2 divide-y divide-gray-100">
            {recusa.sugestoes.map((s) => (
              <li key={s.rotulo} className="flex items-center justify-between gap-3 py-1.5">
                <span>
                  {s.rotulo}
                  {s.detalhe ? <span className="text-gray-500"> · {s.detalhe}</span> : null}
                </span>
                <Button type="button" size="sm" variant="outline" className="shrink-0 rounded-sm" onClick={() => aplicar(s)}>
                  Usar
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {teste ? (
        // O resultado do Testar (11/11/2026), num destaque; some ao mudar o formulário.
        // A margem de rolagem deixa o destaque acima do rodapé fixo do modal.
        <div ref={(el) => el?.scrollIntoView({ block: "nearest" })} className="scroll-mb-24 rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-2.5 text-sm text-gray-700">
          <p className="font-medium text-gray-900">Teste em {teste.competencia} (a competência fechada mais recente em Resultados Empresariais)</p>
          {entidade === "painel-bordo" ? (
            <p>
              Realizado (Atual): <span className="font-semibold text-gray-900">{formatarValorDoPainel(teste.realizado, (teste.formato ?? "MILHOES") as FormatoPainel)}</span>
              {teste.percentual !== null && teste.percentual !== undefined ? <> · Percentual sob o Valor: {formatarValorDoItem(teste.percentual, true)}</> : null}
            </p>
          ) : (
            <p>
              Realizado (Atual): <span className="font-semibold text-gray-900">{formatarDoIndicador(teste.realizado, teste.unidade)}</span> · Acumulado:{" "}
              <span className="font-semibold text-gray-900">{formatarDoIndicador(teste.acumulado ?? null, teste.unidade)}</span>
            </p>
          )}
          {teste.realizado === null ? <p className="text-xs text-gray-500">Sem valor: falta o dado de algum item no mês, ou há uma divisão por zero.</p> : null}
        </div>
      ) : null}
      {def.reclassifica ? (
        <p className="text-xs text-gray-500">
          Este cadastro classifica os lançamentos: ao gravar, as competências ainda não apuradas são reclassificadas; as apuradas só mudam se forem
          reapuradas.
        </p>
      ) : null}
      <DialogFooter className="sm:justify-between">
        <div>
          {registro && def.excluir && travas?.exclusao ? (
            // Com movimentos, a exclusão fica bloqueada; o motivo, na dica do botão.
            <Button type="button" variant="ghost" className="rounded-sm text-gray-400" disabled title={travas.exclusao}>
              <Trash2 className="size-4" />
              Excluir
            </Button>
          ) : registro && def.excluir ? (
            confirmaExclusao ? (
              <Button type="button" variant="destructive" className="rounded-sm" disabled={excluir.isPending} onClick={() => excluir.mutate()}>
                Confirmar exclusão
              </Button>
            ) : (
              <Button type="button" variant="ghost" className="rounded-sm text-red-700" onClick={() => setConfirmaExclusao(true)}>
                <Trash2 className="size-4" />
                Excluir
              </Button>
            )
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Cancelar
          </Button>
          {/* O Testar (11/11/2026), logo antes do Gravar: o Realizado (Atual) com a fórmula do formulário. */}
          {comTeste ? (
            <Button type="button" variant="outline" className="rounded-sm" disabled={testar.isPending} onClick={() => testar.mutate()}>
              <FlaskConical className="size-4" />
              {testar.isPending ? "Testando…" : "Testar"}
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={salvar.isPending}
            onClick={() => salvar.mutate()}
            className="bg-bpm-primary hover:bg-bpm-primary-hover rounded-sm font-bold text-black shadow-sm"
          >
            {salvar.isPending ? "Gravando…" : "Gravar"}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

/** Edição de um registro de qualquer cadastro, pelo que a definição dele declara (Passo 25). */
export function EditarRegistroDialog({ entidade, id, onFechar }: Props) {
  const def = useQuery({ queryKey: ["edicao", entidade, "definicao"], queryFn: () => edicaoService.definicao(entidade) });
  const reg = useQuery({ queryKey: ["edicao", entidade, "registro", id], queryFn: () => edicaoService.ler(entidade, id!), enabled: id !== null });
  const pronto = def.data && (id === null || reg.data);
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="max-h-[90vh] overflow-y-auto rounded-sm sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{def.data ? `${id ? "Editar" : "Novo Registro:"} ${def.data.titulo}` : "Carregando…"}</DialogTitle>
          {/* O texto do cadastro (14/10/2026: as regras de rateio) ou o de sempre. */}
          <DialogDescription>{def.data?.explicacao ?? "A alteração fica no log de auditoria, com o antes e o depois."}</DialogDescription>
        </DialogHeader>
        {def.isError || reg.isError ? <p className="text-sm text-red-700">{mensagemDeErro(def.error ?? reg.error, "Erro ao carregar o cadastro.")}</p> : null}
        {pronto ? <Formulario def={def.data!} registro={id ? reg.data! : null} entidade={entidade} onFechar={onFechar} /> : <div className="h-40 animate-pulse rounded-sm bg-gray-100" />}
      </DialogContent>
    </Dialog>
  );
}
