-- A função cadastrada por senioridade (11/11/2026): o nome se repete, com uma senioridade em cada; o par não se repete.

-- DropIndex
DROP INDEX "colaboradores_funcoes_nome_key";

-- CreateIndex
CREATE UNIQUE INDEX "colaboradores_funcoes_nome_senioridade_id_key" ON "colaboradores_funcoes"("nome", "senioridade_id");
