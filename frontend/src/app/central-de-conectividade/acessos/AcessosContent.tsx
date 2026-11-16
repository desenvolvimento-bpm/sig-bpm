"use client";

import { Abas } from "@/components/shared/Abas";
import { CabecalhoDaTela } from "@/components/shared/CabecalhoDaTela";
import { useAbaLembrada } from "@/hooks/useAbaLembrada";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";

import { AcessosDaApi } from "../biblioteca-de-apis/components/AcessosDaApi";

/** As abas da tela (13/11/2026): por ora, os acessos às APIs. */
const ABAS = [{ chave: "apis", rotulo: "APIs" }] as const;
type ChaveDaAba = (typeof ABAS)[number]["chave"];

/**
 * A tela Acessos (13/11/2026, pedido do Adão), na Central de Conectividade, logo depois de APIs: na aba APIs (antes, a aba
 * Acesso às APIs da tela APIs), os pedidos às APIs do período — quem edita a tela vê os de todos e bloqueia ou libera um
 * usuário ou um endereço; quem só lê vê os próprios.
 */
export function AcessosContent() {
  useRegistrarAcessoTela("/central-de-conectividade/acessos");
  const [aba, setAba] = useAbaLembrada<ChaveDaAba>("aba", "apis", ABAS.map((a) => a.chave));
  return (
    <div className="space-y-6">
      <CabecalhoDaTela
        titulo="Acessos"
        sobre={
          <p>
            Na Central de Conectividade, da Controladoria, quem acessa os dados do SIG pelas APIs (a tela APIs) e de onde: os pedidos de cada período, por dia,
            por usuário, por endereço (os computadores ou servidores que chamam as APIs) e por API, com o motivo das recusas. Cada pedido fica na Auditoria.
          </p>
        }
        comoUsar={
          <ul>
            <li>
              Na aba APIs, escolha o período (os últimos 7, 30 ou 90 dias): no alto, os destaques (os pedidos, os recusados, os usuários e os endereços) e, um
              abaixo do outro, os pedidos por dia, por usuário, por endereço e por API e os últimos pedidos, com o motivo das recusas. “Exportar”, ao lado do
              período, leva os últimos pedidos em Excel ou PDF.
            </li>
            <li>Quem só lê a tela vê os próprios acessos; quem a edita (o perfil com Editar em Acessos › APIs, na Central de Conectividade) vê os de todos.</li>
            <li>
              Quem edita bloqueia ou libera, nos controles deslizantes das tabelas, um usuário ou um endereço: o bloqueio vale na hora, para os pedidos e para o
              token, e fica na Auditoria. Os bloqueados sem pedidos no período continuam nas tabelas, para liberar. O bloqueio de uma API fica no cartão dela, na
              tela APIs.
            </li>
          </ul>
        }
      />
      <Abas rotulo="Abas de Acessos" ativa={aba} onMudar={(a) => setAba(a as ChaveDaAba)} abas={[...ABAS]} />
      {aba === "apis" ? <AcessosDaApi /> : null}
    </div>
  );
}
