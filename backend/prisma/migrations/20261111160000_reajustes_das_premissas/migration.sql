-- A aba Reajustes das Premissas dos cenários analíticos (11/11/2026, pedido do Adão): os Índices de Reajuste (até 4
-- reajustes por índice, cada um com o Valor (%) e o Inicia Em), a Aplicação dos Reajustes (o índice de cada conta da DRE)
-- e se os reajustes estão aplicados na DRE (o Recalcular dos Resultados: Aplicar ou Remover Reajustes).
-- AlterTable
ALTER TABLE "cenarios" ADD COLUMN     "aplicacao_dos_reajustes" JSON,
ADD COLUMN     "indices_dos_reajustes" JSON,
ADD COLUMN     "reajustes_aplicados" BOOLEAN NOT NULL DEFAULT false;

-- Os perfis com a aba Indicadores Manuais das Premissas ganham a mesma permissão (Ler, Editar) na aba nova.
INSERT INTO "perfil_permissoes_telas" ("perfil_id", "chave", "acao")
SELECT "perfil_id", 'cenarios_analiticos_premissas.reajustes', "acao"
FROM "perfil_permissoes_telas"
WHERE "chave" = 'cenarios_analiticos_premissas.manuais'
ON CONFLICT DO NOTHING;
