-- Redistribuições de Gastos com várias contas da DRE (20/11/2026, pedido do Adão), nos Cadastros Gerais e na cópia dos cenários
-- analíticos: a conta de cada redistribuição (a coluna linha_dre_id) passa para as tabelas das contas, uma linha por conta. Os
-- movimentos de qualquer das contas, dos fornecedores marcados, se redistribuem. As redistribuições de hoje ficam com a conta delas.

-- CreateTable
CREATE TABLE "redistribuicoes_gastos_contas" (
    "redistribuicao_id" TEXT NOT NULL,
    "linha_dre_id" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "redistribuicoes_gastos_contas_pkey" PRIMARY KEY ("redistribuicao_id","linha_dre_id")
);

-- CreateTable
CREATE TABLE "cenarios_redistribuicoes_contas" (
    "redistribuicao_id" TEXT NOT NULL,
    "linha_dre_id" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "cenarios_redistribuicoes_contas_pkey" PRIMARY KEY ("redistribuicao_id","linha_dre_id")
);

-- A conta de cada redistribuição de hoje, como a primeira (e única) da lista.
INSERT INTO "redistribuicoes_gastos_contas" ("redistribuicao_id", "linha_dre_id", "ordem")
SELECT "id", "linha_dre_id", 1 FROM "redistribuicoes_gastos";

INSERT INTO "cenarios_redistribuicoes_contas" ("redistribuicao_id", "linha_dre_id", "ordem")
SELECT "id", "linha_dre_id", 1 FROM "cenarios_redistribuicoes";

-- CreateIndex
CREATE INDEX "redistribuicoes_gastos_contas_linha_dre_id_idx" ON "redistribuicoes_gastos_contas"("linha_dre_id");

-- CreateIndex
CREATE INDEX "cenarios_redistribuicoes_contas_linha_dre_id_idx" ON "cenarios_redistribuicoes_contas"("linha_dre_id");

-- AddForeignKey
ALTER TABLE "redistribuicoes_gastos_contas" ADD CONSTRAINT "redistribuicoes_gastos_contas_redistribuicao_id_fkey" FOREIGN KEY ("redistribuicao_id") REFERENCES "redistribuicoes_gastos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redistribuicoes_gastos_contas" ADD CONSTRAINT "redistribuicoes_gastos_contas_linha_dre_id_fkey" FOREIGN KEY ("linha_dre_id") REFERENCES "linhas_dre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cenarios_redistribuicoes_contas" ADD CONSTRAINT "cenarios_redistribuicoes_contas_redistribuicao_id_fkey" FOREIGN KEY ("redistribuicao_id") REFERENCES "cenarios_redistribuicoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cenarios_redistribuicoes_contas" ADD CONSTRAINT "cenarios_redistribuicoes_contas_linha_dre_id_fkey" FOREIGN KEY ("linha_dre_id") REFERENCES "linhas_dre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE "redistribuicoes_gastos" DROP CONSTRAINT "redistribuicoes_gastos_linha_dre_id_fkey";

-- DropForeignKey
ALTER TABLE "cenarios_redistribuicoes" DROP CONSTRAINT "cenarios_redistribuicoes_linha_dre_id_fkey";

-- DropIndex
DROP INDEX "redistribuicoes_gastos_linha_dre_id_idx";

-- AlterTable
ALTER TABLE "redistribuicoes_gastos" DROP COLUMN "linha_dre_id";

-- AlterTable
ALTER TABLE "cenarios_redistribuicoes" DROP COLUMN "linha_dre_id";
