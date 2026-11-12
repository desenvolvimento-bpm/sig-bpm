-- Os Departamentos (11/11/2026, pedido do Adão): Cadastros da Controladoria / Controladoria / Departamentos, com a ordem,
-- a unidade (de negócio) e o departamento, e a carga inicial: Produção (Matriz e Filial), Serviços (Montagem e
-- Complementares) e as despesas (Logística, Técnico, Comercial e Administrativo, em Despesas e Extra).

-- CreateTable
CREATE TABLE "departamentos" (
    "id" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "unidade_negocio_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departamentos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "departamentos_unidade_negocio_id_nome_key" ON "departamentos"("unidade_negocio_id", "nome");

-- AddForeignKey
ALTER TABLE "departamentos" ADD CONSTRAINT "departamentos_unidade_negocio_id_fkey" FOREIGN KEY ("unidade_negocio_id") REFERENCES "unidades_negocio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A carga inicial, pela unidade de código 1 (Matriz), 2 (Filial), 3 (Serviços) e 4 (Despesas e Extra).
INSERT INTO "departamentos" ("id", "ordem", "unidade_negocio_id", "nome", "atualizado_em")
SELECT gen_random_uuid()::text, d.ordem, u.id, d.nome, CURRENT_TIMESTAMP
FROM (VALUES
    (1, 1, 'Produção'),
    (2, 2, 'Produção'),
    (3, 3, 'Montagem'),
    (4, 3, 'Complementares'),
    (5, 4, 'Logística'),
    (6, 4, 'Técnico'),
    (7, 4, 'Comercial'),
    (8, 4, 'Administrativo')
) AS d (ordem, codigo, nome)
JOIN "unidades_negocio" u ON u.codigo = d.codigo
ON CONFLICT DO NOTHING;
