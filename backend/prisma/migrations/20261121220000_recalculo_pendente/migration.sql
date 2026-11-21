-- O Recalcular dos Resultados (21/11/2026): as alterações ainda não recalculadas de cada cenário e os reajustes do último cálculo.
ALTER TABLE "cenarios" ADD COLUMN "recalculo_configuracoes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "cenarios" ADD COLUMN "recalculo_premissas" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "cenarios" ADD COLUMN "recalculo_reajustes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "cenarios" ADD COLUMN "reajustes_calculados" BOOLEAN NOT NULL DEFAULT false;
-- Até hoje, cada gravação recalculava a DRE: o último cálculo tem os reajustes como estão.
UPDATE "cenarios" SET "reajustes_calculados" = "reajustes_aplicados";
