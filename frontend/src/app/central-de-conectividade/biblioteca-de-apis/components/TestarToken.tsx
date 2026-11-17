"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Zap, Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { botaoPrimario, Erro } from "@/app/cenarios/components/CenarioDialog";

import { copiarTexto, enderecoDaApi } from "../../services/conectividadeService";

/** O botão Testar, ao lado do Copiar do exemplo em curl: pede o token com um login, para ver que a API responde. */
export function BotaoTestarToken() {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-200 hover:text-gray-900"
        title="Pedir o token com um login do SIG. O login e a senha não são salvos."
        aria-label="Pedir o token com um login do SIG"
        onClick={() => setAberto(true)}
      >
        <Zap className="size-3.5" />
      </button>
      {aberto ? <TesteDoToken onFechar={() => setAberto(false)} /> : null}
    </>
  );
}

type Token = { token?: string; [chave: string]: unknown };

/**
 * O teste do token. O login vai só na chamada e fica no estado da tela: não é gravado no banco nem no navegador, e
 * some quando a janela fecha. A resposta mostra o token (o que um aplicativo recebe).
 */
function TesteDoToken({ onFechar }: { onFechar: () => void }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const teste = useMutation({
    mutationFn: async (): Promise<Token> => {
      const resposta = await fetch(`${enderecoDaApi()}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, senha }),
        cache: "no-store",
      });
      const corpo = (await resposta.json().catch(() => null)) as { data?: Token; error?: string } | null;
      if (!resposta.ok || !corpo?.data) throw new Error(corpo?.error ?? `Não foi possível pedir o token (erro ${resposta.status}).`);
      return corpo.data;
    },
    onSettled: () => setSenha(""),
  });
  const token = typeof teste.data?.token === "string" ? teste.data.token : null;
  const campo = "h-9 w-full rounded-sm border border-gray-300 bg-white px-2 text-sm";
  return (
    <Dialog open onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-sm sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Pedir o token</DialogTitle>
          <DialogDescription>
            Use um login do SIG para pedir o token da API. O login e a senha não são salvos. O token vale uma hora.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim() && senha) teste.mutate();
          }}
        >
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-gray-800">E-mail</span>
            <input className={campo} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-gray-800">Senha do SIG</span>
            <input className={campo} type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
          </label>
          <DialogFooter className="items-center">
            <Button type="button" variant="outline" className="rounded-sm" onClick={onFechar}>
              Fechar
            </Button>
            <Button type="submit" className={botaoPrimario} disabled={teste.isPending || !email.trim() || !senha}>
              <Zap className="size-4" />
              {teste.isPending ? "Pedindo…" : "Pedir o token"}
            </Button>
          </DialogFooter>
        </form>
        <Erro erro={teste.isError ? teste.error.message : null} />
        {token ? (
          <div className="grid gap-1">
            <p className="text-xs font-semibold text-gray-700">Resposta</p>
            <pre className="max-h-60 overflow-auto rounded-sm border border-gray-200 bg-gray-50 p-3 font-mono text-xs break-all whitespace-pre-wrap text-gray-800">
              {JSON.stringify(teste.data, null, 2)}
            </pre>
            {token ? (
              <button
                type="button"
                className="inline-flex w-fit items-center gap-1 text-xs font-medium text-gray-700 hover:text-gray-900"
                onClick={() => void copiarTexto(token).then(() => toast.success("Token copiado."))}
              >
                <Copy className="size-3.5" />
                Copiar o token
              </button>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
