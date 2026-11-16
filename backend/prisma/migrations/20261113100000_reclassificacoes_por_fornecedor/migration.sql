-- As Reclassificações por fornecedor (13/11/2026, pedido do Adão): a tela Reclassificações de Conta passa a se chamar
-- Reclassificações, com as abas Por Conta (o cadastro de antes) e Por Fornecedor (o fornecedor do balancete e o centro de
-- custo imperativo, para onde vão todos os movimentos dele).

-- CreateTable
CREATE TABLE "reclassificacoes_fornecedor" (
    "id" TEXT NOT NULL,
    "fornecedor" TEXT NOT NULL,
    "centro_custo_id" TEXT NOT NULL,
    "motivo" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reclassificacoes_fornecedor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reclassificacoes_fornecedor_fornecedor_key" ON "reclassificacoes_fornecedor"("fornecedor");

-- AddForeignKey
ALTER TABLE "reclassificacoes_fornecedor" ADD CONSTRAINT "reclassificacoes_fornecedor_centro_custo_id_fkey" FOREIGN KEY ("centro_custo_id") REFERENCES "centros_custo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- As abas da tela na matriz dos perfis: quem tinha a tela ganha as duas abas, com a mesma permissão (Ler ou Editar).
INSERT INTO "perfil_permissoes_telas" ("perfil_id", "chave", "acao")
SELECT "perfil_id", 'cadastro_reclassificacoes.por_conta', "acao" FROM "perfil_permissoes_telas" WHERE "chave" = 'cadastro_reclassificacoes'
ON CONFLICT DO NOTHING;

INSERT INTO "perfil_permissoes_telas" ("perfil_id", "chave", "acao")
SELECT "perfil_id", 'cadastro_reclassificacoes.por_fornecedor', "acao" FROM "perfil_permissoes_telas" WHERE "chave" = 'cadastro_reclassificacoes'
ON CONFLICT DO NOTHING;
