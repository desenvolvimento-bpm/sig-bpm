"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { FileUp } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

import { botaoPrimario } from "@/app/cenarios/components/CenarioDialog";

import { classeSelect } from "@/app/cenarios/components/CenarioDialog";

import {
  arquivosGeraisService,
  MAXIMO_DO_ARQUIVO,
  mensagemDeErro,
  tamanhoLegivel,
  type ArquivoGeral,
  type ProcessoDosArquivos,
  type TelaDosArquivos,
} from "../services/arquivosGeraisService";

const MAXIMO_DA_DESCRICAO = 300;

/**
 * O modal Adicionar Arquivo (05/11/2026, pedido do Adão): o arquivo (até 500 MB, qualquer tipo), a descrição, obrigatória,
 * que aparece na lista e serve à busca, e o processo (11/11/2026: Geral ou um dos processos vigentes; a lista mostra o arquivo
 * a quem vê o processo). O envio mostra o andamento; com o arquivo escolhido ou a descrição digitada, fechar sem adicionar
 * pergunta antes.
 */
export function AdicionarArquivoDialog({
  tela,
  nomeDaTela,
  processos,
  onFechar,
  onAdicionado,
}: {
  tela: TelaDosArquivos;
  nomeDaTela: string;
  processos: ProcessoDosArquivos[];
  onFechar: () => void;
  onAdicionado: () => void;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [descricao, setDescricao] = useState("");
  const [processo, setProcesso] = useState("");
  const [andamento, setAndamento] = useState(0);
  const grande = !!arquivo && arquivo.size > MAXIMO_DO_ARQUIVO;
  const enviar = useMutation({
    mutationFn: () => arquivosGeraisService.adicionar(tela, arquivo!, descricao.trim(), processo || null, setAndamento),
    onSuccess: (a) => {
      toast.success(`Arquivo adicionado em ${nomeDaTela}: ${a.descricao}.`);
      onAdicionado();
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível adicionar o arquivo.")),
  });
  const pronto = !!arquivo && !grande && !!descricao.trim() && !enviar.isPending;
  return (
    <Dialog open onOpenChange={(o) => (!o && !enviar.isPending ? onFechar() : undefined)}>
      <DialogContent avisoAoSair className="rounded-sm sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Adicionar Arquivo</DialogTitle>
          <DialogDescription>
            Em {nomeDaTela}: escolha o arquivo (até 500 MB) e escreva a descrição, que aparece na lista e serve para buscá-lo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ag-arquivo">Arquivo</Label>
            <input
              ref={entrada}
              id="ag-arquivo"
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setArquivo(f);
                // A descrição começa pelo nome do arquivo, sem a extensão, quando ainda está vazia.
                if (f && !descricao.trim()) setDescricao(f.name.replace(/\.[^.]+$/, "").slice(0, MAXIMO_DA_DESCRICAO));
              }}
            />
            {/* O nome longo quebra a linha (em qualquer ponto, mesmo sem espaços), e o modal fica da mesma largura. */}
            <div className="flex min-w-0 items-center gap-3">
              <Button type="button" variant="outline" className="shrink-0 rounded-sm" disabled={enviar.isPending} onClick={() => entrada.current?.click()}>
                <FileUp className="size-4" />
                {arquivo ? "Trocar" : "Escolher"}
              </Button>
              <span className="min-w-0 flex-1 text-sm text-gray-700 [overflow-wrap:anywhere]">
                {arquivo ? `${arquivo.name} · ${tamanhoLegivel(arquivo.size)}` : "Nenhum arquivo escolhido"}
              </span>
            </div>
            {grande ? <p className="text-sm text-red-700">O arquivo passa de 500 MB.</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ag-descricao">Descrição</Label>
            <textarea
              id="ag-descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={MAXIMO_DA_DESCRICAO}
              rows={3}
              disabled={enviar.isPending}
              className="w-full rounded-sm border border-gray-300 px-3 py-2 text-sm"
              placeholder="Do que trata o arquivo (por exemplo: Treinamento NR-12, turma de novembro)"
            />
          </div>
          <CampoDoProcesso id="ag-processo" valor={processo} processos={processos} onMudar={setProcesso} disabled={enviar.isPending} />
          {enviar.isPending ? (
            <div className="space-y-1">
              <div className="h-2 w-full overflow-hidden rounded-sm bg-gray-100">
                <div className="h-full bg-bpm-primary transition-[width]" style={{ width: `${Math.round(andamento * 100)}%` }} />
              </div>
              <p className="text-xs text-gray-600">Enviando… {Math.round(andamento * 100)}%</p>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" disabled={enviar.isPending} onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={!pronto} onClick={() => enviar.mutate()} title={!arquivo ? "Escolha o arquivo" : !descricao.trim() ? "Escreva a descrição" : undefined}>
            {enviar.isPending ? "Enviando…" : "Adicionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** O campo Processo (11/11/2026): Geral e, depois, os processos vigentes, na ordem do menu. */
function CampoDoProcesso({ id, valor, processos, onMudar, disabled }: { id: string; valor: string; processos: ProcessoDosArquivos[]; onMudar: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Processo</Label>
      <select id={id} value={valor} onChange={(e) => onMudar(e.target.value)} disabled={disabled} className={classeSelect}>
        <option value="">Geral</option>
        {processos.map((p) => (
          <option key={p.codigo} value={p.codigo}>
            {p.nome}
          </option>
        ))}
      </select>
      <p className="text-xs text-gray-500">Geral aparece para todos com acesso a esta tela; um processo, só para quem lê ou edita alguma tela dele.</p>
    </div>
  );
}

/** O modal Editar Arquivo (11/11/2026, pedido do Adão): a descrição e o processo (o arquivo não muda). */
export function EditarArquivoDialog({
  tela,
  arquivo,
  processos,
  onFechar,
  onEditado,
}: {
  tela: TelaDosArquivos;
  arquivo: ArquivoGeral;
  processos: ProcessoDosArquivos[];
  onFechar: () => void;
  onEditado: () => void;
}) {
  const [descricao, setDescricao] = useState(arquivo.descricao);
  const [processo, setProcesso] = useState(arquivo.processo ?? "");
  const gravar = useMutation({
    mutationFn: () => arquivosGeraisService.editar(tela, arquivo.id, descricao.trim(), processo || null),
    onSuccess: (a) => {
      toast.success(`Arquivo alterado: ${a.descricao}.`);
      onEditado();
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível alterar o arquivo.")),
  });
  const mudou = descricao.trim() !== arquivo.descricao || (processo || null) !== arquivo.processo;
  return (
    <Dialog open onOpenChange={(o) => (!o && !gravar.isPending ? onFechar() : undefined)}>
      <DialogContent avisoAoSair={mudou} className="rounded-sm sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar Arquivo</DialogTitle>
          <DialogDescription render={<div />}>
            <span className="[overflow-wrap:anywhere]">
              {arquivo.nomeOriginal} · {tamanhoLegivel(arquivo.tamanho)}
            </span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ag-editar-descricao">Descrição</Label>
            <textarea
              id="ag-editar-descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={MAXIMO_DA_DESCRICAO}
              rows={3}
              disabled={gravar.isPending}
              className="w-full rounded-sm border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <CampoDoProcesso id="ag-editar-processo" valor={processo} processos={processos} onMudar={setProcesso} disabled={gravar.isPending} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-sm" disabled={gravar.isPending} onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" className={botaoPrimario} disabled={!mudou || !descricao.trim() || gravar.isPending} onClick={() => gravar.mutate()}>
            {gravar.isPending ? "Gravando…" : "Gravar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
