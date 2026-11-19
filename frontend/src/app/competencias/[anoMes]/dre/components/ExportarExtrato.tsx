"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { botaoPrimario } from "@/app/cenarios/components/CenarioDialog";

import { dreService, type VisaoDetalhe } from "../services/dreService";
import { mensagemDoErro, nomeDoArquivo } from "./ExportarDRE";

/**
 * O Exportar dos modais do extrato e do Balancete (24/10/2026, pedido do Adão): um Excel com as Movimentações (os
 * lançamentos do extrato) numa aba e os Detalhes (os movimentos do balancete, item a item) em outra. No Balancete, o
 * `recorte` deixa só a conta (e o centro e a filial, com a caixa marcada).
 */
export function ExportarExtrato({
  anoMes,
  linha,
  visao,
  recorte,
}: {
  anoMes: string;
  linha: string;
  visao: VisaoDetalhe;
  recorte?: { conta: string; centro?: string | null; filial?: number | null; semCentro?: boolean };
}) {
  const [gerando, setGerando] = useState(false);
  async function baixar() {
    setGerando(true);
    try {
      const r = await dreService.exportarExtrato(anoMes, linha, visao, recorte);
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = nomeDoArquivo(r.headers["content-disposition"] as string | undefined, `Extrato ${anoMes}.xlsx`);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (error) {
      toast.error(await mensagemDoErro(error));
    } finally {
      setGerando(false);
    }
  }
  return (
    <Button type="button" className={botaoPrimario} disabled={gerando} onClick={() => void baixar()} title="Baixar em Excel: as movimentações numa aba e os detalhes, item a item, em outra">
      <Download className="size-4" />
      {gerando ? "Exportando…" : "Exportar"}
    </Button>
  );
}
