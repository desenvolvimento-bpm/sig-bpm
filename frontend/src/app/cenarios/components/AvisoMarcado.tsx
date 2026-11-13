import { Lock } from "lucide-react";

import { rotuloMarcacao, rotuloVersao, type Cenario } from "../services/cenariosService";

type Travas = Pick<Cenario, "marcacao" | "versao" | "versaoSalvaEm" | "versaoSalvaPor">;

/** O cenário não muda de dados: marcado (12/10/2026) ou com a versão congelada (13/10/2026). */
export const estaTravado = (c: Travas) => !!c.marcacao || !!c.versaoSalvaEm;

const data = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");

/**
 * O aviso das travas do cenário: a versão congelada (13/10/2026: Congelar Versão; para mudar, reabre-se a versão ou
 * cria-se uma revisão) ou a marcação (12/10/2026: tira-se a marcação, ou marca-se outro cenário, em Configurações /
 * Cenário). A DRE, os indicadores manuais, a referência, o nome e a descrição, o comparativo e as justificativas não se
 * editam (os quatro últimos desde 14/10/2026).
 */
export function AvisoMarcado({ cenario: c, oQue, varios = false }: { cenario: Travas; oQue: string; varios?: boolean }) {
  // "o nome e a descrição não se editam" (14/10/2026).
  const editam = varios ? "não se editam" : "não se edita";
  return (
    <p className="flex items-start gap-2 rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-2 text-sm text-gray-700">
      <Lock className="mt-0.5 size-4 shrink-0 text-gray-500" />
      <span>
        {c.versaoSalvaEm ? (
          <>
            A {rotuloVersao(c.versao)} está congelada (em {data(c.versaoSalvaEm)}
            {c.versaoSalvaPor ? `, por ${c.versaoSalvaPor}` : ""}): {oQue} {editam}. Para editar, reabra a versão (Reabrir Versão) ou crie uma
            revisão (Criar Revisão), na tela Resultados.
          </>
        ) : (
          <>
            O cenário está marcado como {rotuloMarcacao(c.marcacao)}: {oQue} {editam}. Para editar, tire a marcação (ou marque outro cenário) em
            Configurações / Cenário (Marcar Cenário).
          </>
        )}
      </span>
    </p>
  );
}

/**
 * O aviso dos reajustes aplicados na DRE do cenário analítico (11/11/2026, pedido do Adão): as abas das Premissas (menos os
 * Indicadores Manuais) e a referência não se editam até “Remover Reajustes” (Configurações / Reajustes, 12/11/2026).
 */
export function AvisoReajustesAplicados({ oQue, varios = false }: { oQue: string; varios?: boolean }) {
  return (
    <p className="flex items-start gap-2 rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-2 text-sm text-gray-700">
      <Lock className="mt-0.5 size-4 shrink-0 text-gray-500" />
      <span>
        Os reajustes estão aplicados na DRE: {oQue} {varios ? "não se editam" : "não se edita"}. Para editar, remova os reajustes em Configurações /
        Reajustes (“Remover Reajustes”, no quadro Aplicação dos Reajustes).
      </span>
    </p>
  );
}
