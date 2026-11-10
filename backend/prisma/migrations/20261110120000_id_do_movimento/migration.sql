-- AlterTable
ALTER TABLE "lancamentos_contabeis" ADD COLUMN     "id_movimento" TEXT;

-- CreateIndex
CREATE INDEX "requisicoes_itens_identificador_idx" ON "requisicoes_itens"("identificador");

-- CreateIndex
CREATE INDEX "notas_fiscais_itens_identificador_idx" ON "notas_fiscais_itens"("identificador");

