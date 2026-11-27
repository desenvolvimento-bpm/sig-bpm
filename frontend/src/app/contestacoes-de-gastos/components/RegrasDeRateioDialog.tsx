"use client";

import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { plural } from "@/lib/texto";

import { contestacoesService, mensagemDeErro, type DestinoDoRateio, type RegrasDeRateioDoMes } from "../services/contestacoesService";
import { nomeDaUnidade } from "@/lib/nomesDasUnidades";
import { useNomesDasUnidades } from "@/hooks/useNomesDasUnidades";

/** O nome de cada balde, nas consultas do modal Contestar: as cinco chaves de rateio e os baldes diretos. */
export const ROTULO_BALDE: Record<string, string> = {
  PROJETO: "Projeto",
  PRODUCAO: "Produção",
  METALURGIA: "Metalurgia",
  ARMADURA: "Armadura",
  ACOMPANHAMENTO: "Acompanhamento",
  UNIDADE: "Unidade",
  // A Matriz e a Filial com o nome do cadastro na hora de mostrar (25/11/2026: muda a qualquer momento).
  get MATRIZ() {
    return nomeDaUnidade(1);
  },
  get FILIAL() {
    return nomeDaUnidade(2);
  },
  OBRAS: "Obras",
  COMPLEMENTAR: "Complementar",
  DESPESAS: "Despesas",
  EXTRA: "Extra",
  RN: "RN",
  LEBEN: "Leben",
};

/** Para onde vai cada balde direto, inteiro (a regra da apuração das unidades). */
const VAI_PARA: Record<string, string> = {
  get MATRIZ() {
    return nomeDaUnidade(1);
  },
  get FILIAL() {
    return nomeDaUnidade(2);
  },
  get UNIDADE() {
    return `${nomeDaUnidade(1)} ou ${nomeDaUnidade(2)}, pela filial do lançamento`;
  },
  get OBRAS() {
    return `${nomeDaUnidade(3)}: Montagem`;
  },
  get COMPLEMENTAR() {
    return `${nomeDaUnidade(3)}: Complementar`;
  },
  get DESPESAS() {
    return `${nomeDaUnidade(4)} ou ${nomeDaUnidade(6)}, pela linha da DRE; nas receitas e nos impostos, ${nomeDaUnidade(1)} ou ${nomeDaUnidade(2)}, pela filial do lançamento`;
  },
  get EXTRA() {
    return `${nomeDaUnidade(6)} ou ${nomeDaUnidade(4)}, pela linha da DRE`;
  },
  get RN() {
    return nomeDaUnidade(5);
  },
  get LEBEN() {
    return nomeDaUnidade(7);
  },
};

/** O nome de cada destino. */
const DESTINO: Record<DestinoDoRateio["destino"], string> = {
  get MATRIZ() {
    return nomeDaUnidade(1);
  },
  get FILIAL() {
    return nomeDaUnidade(2);
  },
  get MONTAGEM() {
    return `${nomeDaUnidade(3)}: Montagem`;
  },
  get COMPLEMENTAR() {
    return `${nomeDaUnidade(3)}: Complementar`;
  },
};
const MEDIDA: Record<string, string> = { "m³": "m³", kg: "kg", und: "pistas", d: "dias" };
const BASE: Record<string, string> = { M3: "m³", KG: "kg", PISTA: "pistas", DIA: "dias" };

const pct = (v: string | null, casas = 2) => (v === null ? "—" : `${(Number(v) * 100).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`);
const volume = (d: DestinoDoRateio) =>
  d.quantidade === null ? null : `${Number(d.quantidade).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${d.medida ? (MEDIDA[d.medida] ?? d.medida) : ""}`.trim();
/** "a Matriz e a Filial", "a Matriz, a Filial e os Serviços". */
const lista = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}` : (xs[0] ?? ""));

type Chave = RegrasDeRateioDoMes["chaves"][number];

/** Uma chave de rateio: como se divide, quem a usa e um card por destino, com o percentual do mês, o volume e as linhas. */
function CartaoDaChave({ c, apurado }: { c: Chave; apurado: boolean }) {
  if (!c.destinos.length)
    return (
      <section className="rounded-sm border border-gray-200 bg-white px-4 py-3">
        <h3 className="text-sm font-bold text-gray-900">{c.nome}</h3>
        <p className="mt-1 text-sm text-gray-700">Sem regra vigente no mês: os lançamentos com este balde não vão para nenhuma unidade.</p>
      </section>
    );
  const nomes = c.destinos.map((d) => DESTINO[d.destino]);
  const semVolume = apurado && !c.fixo && c.destinos.every((d) => Number(d.percentual ?? 0) === 0);
  const semPercentual = c.destinos.every((d) => d.percentual === null);
  return (
    <section className="rounded-sm border border-gray-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
        <h3 className="text-sm font-bold text-gray-900">{c.nome}</h3>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-700">
          <span className="rounded-sm border border-gray-200 bg-gray-50 px-1.5 py-0.5">{c.fixo ? "Percentuais Fixos" : `Pelo Volume (${c.baseFisica ? (BASE[c.baseFisica] ?? c.baseFisica) : "—"})`}</span>
          {c.vigencias.map((v) => (
            <span key={v} className="rounded-sm border border-gray-200 bg-gray-50 px-1.5 py-0.5">
              Vigente {v}
            </span>
          ))}
        </div>
      </header>
      <div className="space-y-3 px-4 py-3">
        <p className="text-sm text-gray-700">
          Os lançamentos com o balde {c.nome} se dividem entre {lista(nomes)}{" "}
          {c.fixo ? "por percentuais fixos." : `pelo volume de cada um no mês, em ${c.baseFisica ? (BASE[c.baseFisica] ?? c.baseFisica) : "—"}.`} Usam este balde{" "}
          {c.centros} {plural(c.centros, "centro de custo", "centros de custo")} (os lançamentos deles) e {c.contas} {plural(c.contas, "conta", "contas")} (os lançamentos sem
          centro de custo).
          {c.chave === "ACOMPANHAMENTO" ? " As receitas e as despesas financeiras com este balde não se dividem: vão inteiras ao Extra-Operacional." : ""}
        </p>
        {semVolume ? (
          <p className="rounded-sm border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-900">Sem volume no mês: os lançamentos com este balde não vão para nenhuma unidade.</p>
        ) : semPercentual ? (
          <p className="rounded-sm border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">Os percentuais saem da apuração do mês, ainda não feita.</p>
        ) : null}
        {/* Os destinos em cards de destaque, como em Fechamento Mensal › Totais › Rateios (04/11/2026, pedido do Adão): o
            percentual do mês em destaque e o volume embaixo; até quatro numa linha. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {c.destinos.map((d) => (
            <div key={d.destino} className="min-w-0 rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-3 py-2">
              <p className="truncate text-xs font-bold text-gray-600" title={d.origem}>
                {DESTINO[d.destino]}
              </p>
              <p className="text-xl font-extrabold text-gray-900">{pct(d.percentual)}</p>
              <p className="truncate text-xs text-gray-600" title={c.fixo ? "Percentual fixo da regra" : d.origem}>
                {c.fixo ? `Fixo${volume(d) ? ` · ${volume(d)}` : ""}` : (volume(d) ?? "Sem a apuração")}
              </p>
              {d.linhas.length ? (
                <p className="mt-1 flex flex-wrap gap-1">
                  {d.linhas.map((l) => (
                    <span key={l.nome} className="rounded-sm border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-700">
                      {l.nome} {pct(l.percentual, 0)}
                    </span>
                  ))}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * As Regras de Rateio (04/11/2026, pedido do Adão; o botão do extrato de uma linha e do modal Contestar): as vigentes no mês, uma
 * por chave, com a explicação de como o valor se divide, quem usa o balde (centros de custo e contas) e um card por destino,
 * com o percentual do mês (o apurado; sem a apuração, o fixo) e o volume; embaixo, os baldes diretos, que vão inteiros a uma
 * unidade.
 */
export function RegrasDeRateioDialog({ anoMes, onFechar }: { anoMes: string; onFechar: () => void }) {
  // O nome das unidades no cadastro (25/11/2026): o modal se desenha de novo quando os nomes chegam.
  useNomesDasUnidades();
  const consulta = useQuery({ queryKey: ["contestacoes", "rateios", anoMes], queryFn: () => contestacoesService.rateios(anoMes), staleTime: 5 * 60_000 });
  const d = consulta.data;
  const mes = d ? `${String(d.competencia.mes).padStart(2, "0")}/${d.competencia.ano}` : anoMes.split("-").reverse().join("/");
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent className="rounded-sm sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Regras de Rateio Vigentes</DialogTitle>
          <DialogDescription>
            As regras vigentes em {mes}. O balde do lançamento (o do centro de custo; sem centro, o da conta) decide como ele chega às unidades: nos cinco
            baldes de rateio, o valor se divide entre os destinos da regra; nos baldes diretos, vai inteiro a uma unidade.
          </DialogDescription>
        </DialogHeader>
        {consulta.isError ? (
          <p className="text-sm text-red-700">{mensagemDeErro(consulta.error, "Erro ao carregar as regras de rateio.")}</p>
        ) : !d ? (
          <div className="h-64 animate-pulse rounded-sm bg-gray-100" />
        ) : (
          <div className="space-y-3">
            {!d.apurado ? (
              <p className="rounded-sm border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                Os rateios de {mes} ainda não foram apurados: os percentuais pelo volume aparecem depois da apuração do mês.
              </p>
            ) : null}
            {d.chaves.map((c) => (
              <CartaoDaChave key={c.chave} c={c} apurado={d.apurado} />
            ))}
            <section className="rounded-sm border border-gray-200 bg-white">
              <header className="border-b border-gray-100 px-4 py-2.5">
                <h3 className="text-sm font-bold text-gray-900">Baldes Diretos</h3>
              </header>
              <div className="space-y-2 px-4 py-3">
                <p className="text-sm text-gray-700">
                  Não se dividem: o valor vai inteiro à unidade do balde. As linhas da DRE de Despesas e do Extra-Operacional recebem os lançamentos diretos delas qualquer que
                  seja o balde.
                </p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs font-bold text-gray-900">
                      <th className="py-1.5 pr-3">Balde</th>
                      <th className="py-1.5 pr-3">Vai Para</th>
                      <th className="py-1.5 pr-6 text-right whitespace-nowrap">Centros de Custo</th>
                      <th className="py-1.5 text-right whitespace-nowrap">Contas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.diretos.map((b) => (
                      <tr key={b.balde} className="border-b border-gray-100 align-top">
                        <td className="py-1.5 pr-3 font-medium text-gray-900">{ROTULO_BALDE[b.balde] ?? b.balde}</td>
                        <td className="py-1.5 pr-3 text-gray-700">{VAI_PARA[b.balde] ?? "—"}</td>
                        <td className="py-1.5 pr-6 text-right text-gray-700">{b.centros}</td>
                        <td className="py-1.5 text-right text-gray-700">{b.contas}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
