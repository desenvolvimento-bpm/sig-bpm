"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, Eye } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { plural } from "@/lib/texto";

import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";
import { botaoPrimario, Erro } from "@/app/cenarios/components/CenarioDialog";

import { conectividadeService, copiarTexto, enderecoDaApi, type ApiDoCatalogo, type Formato, type Previa } from "../../services/conectividadeService";

/** As opções dos parâmetros de valores fixos (os demais são campos de texto). */
const OPCOES: Record<string, Array<[string, string]>> = {
  visao: [["0", "Consolidado"], ["1", "Matriz"], ["2", "Filial"], ["3", "Serviços"], ["4", "Despesas e Extra"], ["5", "RN"]],
  nivel: [["1", "Totais"], ["2", "Atribuições"], ["3", "Contas"]],
  comparacao: [["", "Orçamento (o padrão)"], ["RESULTADOS_ANTERIORES", "Anterior"], ["RESULTADOS_VENDIDOS", "Vendido"], ["PREVISAO", "Forecast"]],
  aba: [["", "As que o perfil lê"], ["resultados", "Resultados"], ["performance", "Performance"]],
  grafico: [["sim", "Com o gráfico"], ["nao", "Sem o gráfico"]],
};
const INICIAL: Record<string, string> = { ano: String(new Date().getFullYear()), visao: "0", nivel: "1", grafico: "sim" };

const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const celula = (v: string | number | null, tipo: string) =>
  v === null ? "—" : typeof v === "number" ? (tipo === "percentual" ? `${numero.format(v * 100)}%` : numero.format(v)) : v;
/** O SVG da API como imagem (num <img>, nada dele roda na página). */
const imagem = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/**
 * A prévia de uma API (24/10/2026): os parâmetros, o formato e o resultado, com a sessão do SIG (o mesmo que o
 * aplicativo recebe com o token), e o endereço do pedido para copiar.
 */
export function PreviaDaApi({ api: a, onFechar }: { api: ApiDoCatalogo; onFechar: () => void }) {
  const [valores, setValores] = useState<Record<string, string>>(() =>
    Object.fromEntries(a.parametros.filter((p) => p.nome !== "formato").map((p) => [p.nome, INICIAL[p.nome] ?? ""])),
  );
  const [formato, setFormato] = useState<Formato>("dados");
  const precisaCenario = a.parametros.some((p) => p.nome === "cenario");
  const cenarios = useQuery({
    queryKey: ["conectividade", "cenarios"],
    queryFn: () => conectividadeService.previa("cenarios", {}),
    enabled: precisaCenario,
  });
  const listaDeCenarios = cenarios.data?.data.formato === "dados" ? cenarios.data.data.linhas : [];
  // Sem o cenário escolhido, o marcado (o Orçamento, o Forecast…) ou o primeiro da lista: a prévia já abre pronta para Ver.
  const sugerido = listaDeCenarios.find((c) => c.marcacao) ?? listaDeCenarios[0];
  const efetivos = precisaCenario && !valores.cenario && sugerido ? { ...valores, cenario: String(sugerido.id) } : valores;
  const faltando = a.parametros.filter((p) => p.obrigatorio && p.nome !== "formato" && !(efetivos[p.nome] ?? "").trim()).map((p) => p.nome);
  const params = { ...Object.fromEntries(Object.entries(efetivos).filter(([, v]) => v.trim() !== "")), ...(formato === "visual" ? { formato } : {}) };
  const endereco = `${enderecoDaApi()}/apis/${a.codigo}${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ""}`;
  const ver = useMutation({ mutationFn: () => conectividadeService.previa(a.codigo, params) });
  const r: Previa | undefined = ver.data?.data;
  const campo = "h-9 w-full rounded-sm border border-gray-300 bg-white px-2 text-sm";
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-sm sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Pré-visualizar: {a.nome}</DialogTitle>
          <DialogDescription>
            O que um aplicativo recebe da API <span className="font-mono">{a.codigo}</span> com o seu login (os dados que o seu perfil lê). Escolha os parâmetros e o formato.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          {a.parametros
            .filter((p) => p.nome !== "formato")
            .map((p) => (
              <label key={p.nome} className="grid gap-1 text-sm" title={p.descricao}>
                <span className="font-medium text-gray-800">
                  {p.nome}
                  {p.obrigatorio ? <span className="text-red-700"> *</span> : null}
                </span>
                {p.nome === "cenario" ? (
                  <select className={campo} value={efetivos.cenario} onChange={(e) => setValores((v) => ({ ...v, cenario: e.target.value }))}>
                    {listaDeCenarios.length ? null : (
                      <option value="">
                        {cenarios.isLoading ? "Carregando…" : cenarios.isError ? "Não foi possível carregar os cenários" : "Nenhum cenário que o seu perfil lê"}
                      </option>
                    )}
                    {listaDeCenarios.map((c) => (
                      <option key={String(c.id)} value={String(c.id)}>
                        {`${c.nome} (${c.ano}, ${c.tipo}${c.marcacao ? `, ${c.marcacao}` : ""})`}
                      </option>
                    ))}
                  </select>
                ) : OPCOES[p.nome] ? (
                  <select className={campo} value={valores[p.nome]} onChange={(e) => setValores((v) => ({ ...v, [p.nome]: e.target.value }))}>
                    {OPCOES[p.nome].map(([valor, rotulo]) => (
                      <option key={valor} value={valor}>
                        {rotulo}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input className={campo} value={valores[p.nome]} placeholder={p.exemplo} onChange={(e) => setValores((v) => ({ ...v, [p.nome]: e.target.value }))} />
                )}
              </label>
            ))}
          {a.formatos.length > 1 ? (
            <fieldset className="grid gap-1 text-sm">
              <legend className="mb-1 font-medium text-gray-800">formato</legend>
              <span className="flex overflow-hidden rounded-sm border border-gray-300">
                {a.formatos.map((f) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={formato === f}
                    onClick={() => setFormato(f)}
                    className={`h-9 flex-1 px-3 text-sm ${formato === f ? "bg-bpm-primary font-bold text-black" : "text-gray-700 hover:bg-gray-100"}`}
                  >
                    {f === "dados" ? "Dados" : "Visual"}
                  </button>
                ))}
              </span>
            </fieldset>
          ) : null}
        </div>
        <div className="flex items-center gap-2 rounded-sm border border-gray-200 bg-gray-50 px-2 py-1.5">
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-gray-800" title={endereco}>
            GET {endereco}
          </code>
          <button
            type="button"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-gray-600 hover:bg-gray-200 hover:text-gray-900"
            title="Copiar o endereço do pedido (o aplicativo manda o token no cabeçalho Authorization)"
            aria-label="Copiar o endereço do pedido"
            onClick={() => void copiarTexto(endereco).then(() => toast.success("Endereço copiado."))}
          >
            <Copy className="size-4" />
          </button>
        </div>
        <Erro erro={ver.isError ? mensagemDeErro(ver.error, "Não foi possível ler a API.") : null} />
        {/* min-w-0: a tabela larga rola dentro do quadro dela, sem alargar o modal (e cortar os campos). */}
        {r?.formato === "dados" ? (
          <div className="min-w-0 space-y-1">
            <p className="text-xs text-gray-600">
              {plural(r.linhas.length, "1 linha", `${r.linhas.length} linhas`)} e {plural(r.colunas.length, "1 coluna", `${r.colunas.length} colunas`)}
              {r.linhas.length > 50 ? "; aqui, as 50 primeiras" : ""}.
            </p>
            <div className="max-h-96 overflow-auto rounded-sm border border-gray-200">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0">
                  <tr className="bg-bpm-primary text-left font-bold text-black">
                    {r.colunas.map((c) => (
                      <th key={c.chave} className={`px-2 py-1.5 whitespace-nowrap ${c.tipo === "texto" ? "" : "text-right"}`} title={c.chave}>
                        {c.titulo}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {r.linhas.slice(0, 50).map((l, k) => (
                    <tr key={k} className="border-b border-gray-100">
                      {r.colunas.map((c) => (
                        <td key={c.chave} className={`max-w-72 truncate px-2 py-1 whitespace-nowrap text-gray-800 ${c.tipo === "texto" ? "" : "text-right"}`}>
                          {celula(l[c.chave] ?? null, c.tipo)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : r?.formato === "visual" ? (
          <div className="min-w-0 space-y-2">
            <p className="text-xs text-gray-600">
              {plural(r.visuais.length, "1 visual", `${r.visuais.length} visuais`)} em SVG{r.visuais.length > 12 ? "; aqui, os 12 primeiros" : ""}.
            </p>
            <div className="grid max-h-[28rem] gap-3 overflow-auto rounded-sm border border-gray-200 bg-gray-100 p-3">
              {r.visuais.slice(0, 12).map((v, k) => (
                // eslint-disable-next-line @next/next/no-img-element -- o SVG da API, como imagem (nada dele roda na página).
                <img key={k} src={imagem(v.svg)} alt={v.titulo} width={v.largura} height={v.altura} className="h-auto max-w-full rounded-sm bg-white" />
              ))}
            </div>
          </div>
        ) : null}
        <DialogFooter className="items-center">
          {faltando.length ? <p className="mr-auto text-xs text-gray-600">{`Preencha ${faltando.join(" e ")} para ver.`}</p> : null}
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Fechar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={ver.isPending || faltando.length > 0} onClick={() => ver.mutate()}>
            <Eye className="size-4" />
            {ver.isPending ? "Lendo…" : "Ver"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
