"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { usePermissions } from "@/context/PermissionContext";
import { api } from "@/lib/api";

/** A visão na tela: o consolidado, uma unidade (1 a 5), um agrupamento de centros ou uma obra. */
export type VisaoExportar = "consolidado" | number | { grupo: string } | { obra: string } | { semCentro: string };

type Formato = "xlsx" | "pdf";
/** O que entra no arquivo: a visão na tela, o consolidado e todas as unidades, todos os centros de custo ou todas as obras. */
type Alcance = "atual" | "unidades" | "centros" | "centrosArquivos" | "obras" | "semCentros";
const OPCOES: Array<{ alcance: Alcance; excel: string; pdf: string | null }> = [
  { alcance: "atual", excel: "Visão Atual", pdf: "Visão Atual" },
  { alcance: "unidades", excel: "Todas as Unidades (uma por aba)", pdf: "Todas as Unidades (uma por página)" },
  { alcance: "centros", excel: "Todos os Centros de Custo (um por aba)", pdf: "Todos os Centros de Custo (um por página)" },
  // Um arquivo Excel por centro, num ZIP, com o departamento e o centro no nome (14/10/2026).
  { alcance: "centrosArquivos", excel: "Todos os Centros de Custo (um arquivo por centro)", pdf: null },
  { alcance: "obras", excel: "Todas as Obras (uma por aba)", pdf: "Todas as Obras (uma por página)" },
  // Os movimentos sem centro de custo (15/10/2026), um grupo por aba.
  { alcance: "semCentros", excel: "Todos Sem Centro de Custo (um por aba)", pdf: "Todos Sem Centro de Custo (um por página)" },
];

/** O nome do arquivo que o backend mandou (filename*, em UTF-8), ou um padrão. */
export function nomeDoArquivo(disposicao: string | undefined, padrao: string) {
  const utf8 = disposicao?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (utf8) return decodeURIComponent(utf8);
  return disposicao?.match(/filename="([^"]+)"/i)?.[1] ?? padrao;
}

/** O erro vem como blob, porque a resposta esperada era o arquivo. */
export async function mensagemDoErro(error: unknown) {
  const dados = (error as { response?: { data?: unknown } }).response?.data;
  if (dados instanceof Blob) {
    try {
      return (JSON.parse(await dados.text()) as { error?: string }).error ?? "Não foi possível exportar.";
    } catch {
      return "Não foi possível exportar.";
    }
  }
  return "Não foi possível exportar.";
}

/** Exportação da DRE apurada em Excel e PDF (Passo 26). */
export function ExportarDRE({ anoMes, visao }: { anoMes: string; visao: VisaoExportar }) {
  const [gerando, setGerando] = useState(false);
  // Cada alcance pede as abas que ele toca (14/10/2026): todas as unidades, as seis; os centros e as obras, a deles.
  const { hasPermission } = usePermissions();
  const le = (aba: string) => hasPermission(`dre.${aba}:ler`);
  const opcoes = OPCOES.filter((o) =>
    o.alcance === "unidades" ? ["consolidado", "matriz", "filial", "servicos", "despesas", "extra_operacional", "rn", "leben"].every(le) : o.alcance === "atual" ? true : le(o.alcance === "centrosArquivos" ? "centros" : o.alcance === "semCentros" ? "sem_centros" : o.alcance),
  );

  async function baixar(formato: Formato, alcance: Alcance) {
    setGerando(true);
    try {
      const params =
        alcance === "unidades"
          ? { formato, visao: "todas" }
          : alcance === "centros"
            ? { formato, visao: "centros" }
            : alcance === "centrosArquivos"
              ? { formato, visao: "centros_arquivos" }
            : alcance === "obras"
              ? { formato, visao: "obras" }
              : alcance === "semCentros"
                ? { formato, visao: "sem_centros" }
                : typeof visao === "object"
                  ? "obra" in visao
                    ? { formato, obra: visao.obra }
                    : "semCentro" in visao
                      ? { formato, semCentro: visao.semCentro }
                      : { formato, grupo: visao.grupo }
                  : { formato, visao: String(visao) };
      const r = await api.get<Blob>(`/proxy/competencias/${anoMes}/dre/exportar`, { params, responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = nomeDoArquivo(r.headers["content-disposition"] as string | undefined, `DRE ${anoMes}.${formato}`);
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
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" className="bg-bpm-primary hover:bg-bpm-primary-hover rounded-sm font-bold text-black shadow-sm" disabled={gerando}>
            <Download className="size-4" />
            {gerando ? "Gerando…" : "Exportar"}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-[25rem]">
        {(["xlsx", "pdf"] as const).map((formato, i) => (
          <DropdownMenuGroup key={formato}>
            {i > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel className="flex items-center gap-1.5 text-xs font-bold text-gray-700">
              {formato === "xlsx" ? <FileSpreadsheet className="size-3.5" /> : <FileText className="size-3.5" />}
              {formato === "xlsx" ? "Excel" : "PDF"}
            </DropdownMenuLabel>
            {opcoes.filter((o) => formato === "xlsx" || o.pdf).map((o) => (
              <DropdownMenuItem key={o.alcance} onClick={() => void baixar(formato, o.alcance)} className="pl-6">
                {formato === "xlsx" ? o.excel : o.pdf}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
