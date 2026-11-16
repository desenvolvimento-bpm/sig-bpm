-- A contestação de itens de um movimento (10/11/2026): os itens contestados e o valor do movimento inteiro.

-- CreateEnum
CREATE TYPE "OrigemItemMovimento" AS ENUM ('REQUISICAO', 'NOTA_FISCAL');

-- AlterTable
ALTER TABLE "contestacoes_movimentos" ADD COLUMN     "valor_movimento" DECIMAL(65,30);

-- CreateTable
CREATE TABLE "contestacoes_itens" (
    "id" TEXT NOT NULL,
    "contestacao_movimento_id" TEXT NOT NULL,
    "origem" "OrigemItemMovimento" NOT NULL,
    "identificador" TEXT NOT NULL,
    "codigo_produto" TEXT,
    "descricao_item" TEXT,
    "codigo_centro_custo" TEXT,
    "conta_contabil" TEXT NOT NULL,
    "quantidade" DECIMAL(65,30),
    "valor_total" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "contestacoes_itens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contestacoes_itens_contestacao_movimento_id_idx" ON "contestacoes_itens"("contestacao_movimento_id");

-- CreateIndex
CREATE INDEX "contestacoes_itens_identificador_idx" ON "contestacoes_itens"("identificador");

-- AddForeignKey
ALTER TABLE "contestacoes_itens" ADD CONSTRAINT "contestacoes_itens_contestacao_movimento_id_fkey" FOREIGN KEY ("contestacao_movimento_id") REFERENCES "contestacoes_movimentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
