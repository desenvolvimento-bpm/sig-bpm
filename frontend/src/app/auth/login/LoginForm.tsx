"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { BpmLogo } from "@/components/layout/BpmLogo";
import { CampoSenha } from "@/components/shared/CampoSenha";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { getSafeInternalPath } from "@/lib/navigation";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  // Os campos começam vazios, também em desenvolvimento.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await login(email, password);
      // Sem um destino pedido, a raiz, que abre a Tela Inicial do usuário (13/11/2026).
      const de = searchParams.get("from");
      router.push(de ? getSafeInternalPath(de) : "/");
      router.refresh();
    } catch {
      setError("E-mail ou senha inválidos.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-sm rounded-sm border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-6 flex flex-col items-center gap-3 text-center">
        <BpmLogo className="h-10 w-auto" priority />
        <div className="space-y-1">
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Entrar</h1>
          <p className="text-sm text-gray-600">SIG BPM · Controladoria</p>
        </div>
      </div>
      {/* Campos e botão no mesmo espaçamento (space-y-4). */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required className="rounded-sm" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Senha</Label>
          {/* Com o olho à direita, para ver a senha digitada (11/10/2026). */}
          <CampoSenha
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="rounded-sm"
          />
        </div>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <Button type="submit" disabled={isSubmitting} className="bg-bpm-primary hover:bg-bpm-primary-hover w-full rounded-sm font-bold text-black">
          {isSubmitting ? "Entrando…" : "Entrar"}
        </Button>
      </form>
    </div>
  );
}
