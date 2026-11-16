-- Sem Resultado nas Contas de Resultado (13/11/2026, pedido do Adão): a conta que não vai à DRE; os movimentos dela não viram
-- pendência na classificação.
ALTER TABLE "contas_resultado" ADD COLUMN "sem_resultado" BOOLEAN NOT NULL DEFAULT false;
