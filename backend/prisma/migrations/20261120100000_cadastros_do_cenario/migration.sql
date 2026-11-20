-- Cadastros por cenário, etapa 1 (20/11/2026, pedido do Adão): as cópias de Unidades e de Centros de Custo de cada cenário
-- analítico, nas abas Unidades e Centros de Custo das Configurações. O cálculo do cenário passa a agrupar e alocar pelos centros
-- da cópia; o resto do SIG segue os Cadastros Gerais.

-- A linha do Quadro de Lotação do cenário passa a apontar para o centro da cópia.
ALTER TABLE "cenarios_lotacao" DROP CONSTRAINT "cenarios_lotacao_centro_custo_id_fkey";

CREATE TABLE "cenarios_unidades" (
    "id" TEXT NOT NULL,
    "cenario_id" TEXT NOT NULL,
    "unidade_negocio_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cenarios_unidades_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cenarios_centros_custo" (
    "id" TEXT NOT NULL,
    "cenario_id" TEXT NOT NULL,
    "origem_id" TEXT,
    "coligada" INTEGER,
    "codigo_rm" TEXT,
    "nome_rm" TEXT NOT NULL,
    "nome_controladoria" TEXT,
    "departamento" TEXT,
    "departamento_sigla" TEXT,
    "atribuicao" "AtribuicaoCusto",
    "atribuicao_sigla" TEXT,
    "balde" "BaldeAlocacao",
    "unidade_negocio_id" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cenarios_centros_custo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cenarios_unidades_cenario_id_unidade_negocio_id_key" ON "cenarios_unidades"("cenario_id", "unidade_negocio_id");
CREATE INDEX "cenarios_centros_custo_cenario_id_idx" ON "cenarios_centros_custo"("cenario_id");
CREATE UNIQUE INDEX "cenarios_centros_custo_cenario_id_codigo_rm_key" ON "cenarios_centros_custo"("cenario_id", "codigo_rm");

-- A cópia dos cenários analíticos que já existem: as unidades e os centros de custo dos Cadastros Gerais de hoje (os ativos e
-- os inativos, como estão).
INSERT INTO "cenarios_unidades" ("id", "cenario_id", "unidade_negocio_id", "nome", "ordem", "ativo", "criado_em", "atualizado_em")
SELECT gen_random_uuid()::text, c."id", u."id", u."nome", u."ordem", u."ativo", now(), now()
FROM "cenarios" c CROSS JOIN "unidades_negocio" u
WHERE c."tipo" = 'ANALITICO';

INSERT INTO "cenarios_centros_custo" (
    "id", "cenario_id", "origem_id", "coligada", "codigo_rm", "nome_rm", "nome_controladoria", "departamento", "departamento_sigla",
    "atribuicao", "atribuicao_sigla", "balde", "unidade_negocio_id", "ordem", "ativo", "criado_em", "atualizado_em"
)
SELECT gen_random_uuid()::text, c."id", cc."id", cc."coligada", cc."codigo_rm", cc."nome_rm", cc."nome_controladoria", cc."departamento",
    cc."departamento_sigla", cc."atribuicao", cc."atribuicao_sigla", cc."balde", cc."unidade_negocio_id", cc."ordem", cc."ativo", now(), now()
FROM "cenarios" c CROSS JOIN "centros_custo" cc
WHERE c."tipo" = 'ANALITICO';

-- As linhas do Quadro de Lotação: do centro dos Cadastros Gerais para a cópia dele no cenário.
UPDATE "cenarios_lotacao" l
SET "centro_custo_id" = cc."id"
FROM "cenarios_centros_custo" cc
WHERE cc."cenario_id" = l."cenario_id" AND cc."origem_id" = l."centro_custo_id";

ALTER TABLE "cenarios_lotacao" ADD CONSTRAINT "cenarios_lotacao_centro_custo_id_fkey" FOREIGN KEY ("centro_custo_id") REFERENCES "cenarios_centros_custo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cenarios_unidades" ADD CONSTRAINT "cenarios_unidades_cenario_id_fkey" FOREIGN KEY ("cenario_id") REFERENCES "cenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cenarios_unidades" ADD CONSTRAINT "cenarios_unidades_unidade_negocio_id_fkey" FOREIGN KEY ("unidade_negocio_id") REFERENCES "unidades_negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cenarios_centros_custo" ADD CONSTRAINT "cenarios_centros_custo_cenario_id_fkey" FOREIGN KEY ("cenario_id") REFERENCES "cenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cenarios_centros_custo" ADD CONSTRAINT "cenarios_centros_custo_origem_id_fkey" FOREIGN KEY ("origem_id") REFERENCES "centros_custo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cenarios_centros_custo" ADD CONSTRAINT "cenarios_centros_custo_unidade_negocio_id_fkey" FOREIGN KEY ("unidade_negocio_id") REFERENCES "unidades_negocio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- As abas Unidades e Centros de Custo das Configurações dos analíticos: com a permissão da aba Referência de cada perfil (a
-- decisão do Adão), com a mesma ação.
INSERT INTO "perfil_permissoes_telas" ("perfil_id", "chave", "acao")
SELECT "perfil_id", 'cenarios_analiticos_configuracoes.unidades', "acao"
FROM "perfil_permissoes_telas"
WHERE "chave" = 'cenarios_analiticos_configuracoes.referencia'
ON CONFLICT DO NOTHING;

INSERT INTO "perfil_permissoes_telas" ("perfil_id", "chave", "acao")
SELECT "perfil_id", 'cenarios_analiticos_configuracoes.centros_custo', "acao"
FROM "perfil_permissoes_telas"
WHERE "chave" = 'cenarios_analiticos_configuracoes.referencia'
ON CONFLICT DO NOTHING;
