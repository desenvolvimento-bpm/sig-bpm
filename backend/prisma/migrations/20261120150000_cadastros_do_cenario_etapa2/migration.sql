-- Cadastros por cenário, etapa 2 (20/11/2026, pedido do Adão): as cópias de Departamentos e de Redistribuições de Gastos de cada
-- cenário analítico, nas abas Departamentos e Redistribuições de Gastos das Configurações. A carga do realizado da referência do
-- cenário passa a redistribuir os gastos pelas regras da cópia (no lugar das dos Cadastros Gerais); o resto do SIG segue os
-- Cadastros Gerais.
CREATE TABLE "cenarios_departamentos" (
    "id" TEXT NOT NULL,
    "cenario_id" TEXT NOT NULL,
    "origem_id" TEXT,
    "unidade_negocio_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "grupos_dre" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cenarios_departamentos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cenarios_redistribuicoes" (
    "id" TEXT NOT NULL,
    "cenario_id" TEXT NOT NULL,
    "origem_id" TEXT,
    "departamento_id" TEXT,
    "linha_dre_id" TEXT NOT NULL,
    "fornecedores" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "vigencia_inicio" TIMESTAMP(3) NOT NULL,
    "vigencia_fim" TIMESTAMP(3),
    "descricao" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cenarios_redistribuicoes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cenarios_redistribuicoes_destinos" (
    "id" TEXT NOT NULL,
    "redistribuicao_id" TEXT NOT NULL,
    "centro_custo_id" TEXT NOT NULL,
    "percentual" DECIMAL(65,30) NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "cenarios_redistribuicoes_destinos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cenarios_departamentos_cenario_id_idx" ON "cenarios_departamentos"("cenario_id");

CREATE UNIQUE INDEX "cenarios_departamentos_cenario_id_unidade_negocio_id_nome_key" ON "cenarios_departamentos"("cenario_id", "unidade_negocio_id", "nome");

CREATE INDEX "cenarios_redistribuicoes_cenario_id_idx" ON "cenarios_redistribuicoes"("cenario_id");

CREATE UNIQUE INDEX "cenarios_redistribuicoes_destinos_redistribuicao_id_centro__key" ON "cenarios_redistribuicoes_destinos"("redistribuicao_id", "centro_custo_id");

ALTER TABLE "cenarios_departamentos" ADD CONSTRAINT "cenarios_departamentos_cenario_id_fkey" FOREIGN KEY ("cenario_id") REFERENCES "cenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cenarios_departamentos" ADD CONSTRAINT "cenarios_departamentos_origem_id_fkey" FOREIGN KEY ("origem_id") REFERENCES "departamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "cenarios_departamentos" ADD CONSTRAINT "cenarios_departamentos_unidade_negocio_id_fkey" FOREIGN KEY ("unidade_negocio_id") REFERENCES "unidades_negocio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cenarios_redistribuicoes" ADD CONSTRAINT "cenarios_redistribuicoes_cenario_id_fkey" FOREIGN KEY ("cenario_id") REFERENCES "cenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cenarios_redistribuicoes" ADD CONSTRAINT "cenarios_redistribuicoes_origem_id_fkey" FOREIGN KEY ("origem_id") REFERENCES "redistribuicoes_gastos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "cenarios_redistribuicoes" ADD CONSTRAINT "cenarios_redistribuicoes_departamento_id_fkey" FOREIGN KEY ("departamento_id") REFERENCES "cenarios_departamentos"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "cenarios_redistribuicoes" ADD CONSTRAINT "cenarios_redistribuicoes_linha_dre_id_fkey" FOREIGN KEY ("linha_dre_id") REFERENCES "linhas_dre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cenarios_redistribuicoes_destinos" ADD CONSTRAINT "cenarios_redistribuicoes_destinos_redistribuicao_id_fkey" FOREIGN KEY ("redistribuicao_id") REFERENCES "cenarios_redistribuicoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cenarios_redistribuicoes_destinos" ADD CONSTRAINT "cenarios_redistribuicoes_destinos_centro_custo_id_fkey" FOREIGN KEY ("centro_custo_id") REFERENCES "cenarios_centros_custo"("id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- A cópia dos cenários analíticos que já existem: os departamentos dos Cadastros Gerais de hoje (os ativos e os inativos).
INSERT INTO "cenarios_departamentos" ("id", "cenario_id", "origem_id", "unidade_negocio_id", "nome", "grupos_dre", "ordem", "ativo", "criado_em", "atualizado_em")
SELECT gen_random_uuid()::text, c."id", d."id", d."unidade_negocio_id", d."nome", d."grupos_dre", d."ordem", d."ativo", now(), now()
FROM "cenarios" c CROSS JOIN "departamentos" d
WHERE c."tipo" = 'ANALITICO';

-- As redistribuições de gastos (as ativas e as inativas), com o departamento da cópia do cenário.
INSERT INTO "cenarios_redistribuicoes" (
    "id", "cenario_id", "origem_id", "departamento_id", "linha_dre_id", "fornecedores", "vigencia_inicio", "vigencia_fim", "descricao",
    "ordem", "ativo", "criado_em", "atualizado_em"
)
SELECT gen_random_uuid()::text, c."id", r."id", cd."id", r."linha_dre_id", r."fornecedores", r."vigencia_inicio", r."vigencia_fim", r."descricao",
    r."ordem", r."ativo", now(), now()
FROM "cenarios" c
CROSS JOIN "redistribuicoes_gastos" r
LEFT JOIN "cenarios_departamentos" cd ON cd."cenario_id" = c."id" AND cd."origem_id" = r."departamento_id"
WHERE c."tipo" = 'ANALITICO';

-- Os destinos: o centro da cópia do cenário (etapa 1) no lugar do centro dos Cadastros Gerais.
INSERT INTO "cenarios_redistribuicoes_destinos" ("id", "redistribuicao_id", "centro_custo_id", "percentual", "ordem")
SELECT gen_random_uuid()::text, cr."id", cc."id", d."percentual", d."ordem"
FROM "cenarios_redistribuicoes" cr
JOIN "redistribuicoes_gastos_destinos" d ON d."redistribuicao_id" = cr."origem_id"
JOIN "cenarios_centros_custo" cc ON cc."cenario_id" = cr."cenario_id" AND cc."origem_id" = d."centro_custo_id";

-- As abas Departamentos e Redistribuições de Gastos das Configurações dos analíticos: com a permissão da aba Referência de cada
-- perfil (a decisão do Adão), com a mesma ação.
INSERT INTO "perfil_permissoes_telas" ("perfil_id", "chave", "acao")
SELECT "perfil_id", 'cenarios_analiticos_configuracoes.departamentos', "acao"
FROM "perfil_permissoes_telas"
WHERE "chave" = 'cenarios_analiticos_configuracoes.referencia'
ON CONFLICT DO NOTHING;

INSERT INTO "perfil_permissoes_telas" ("perfil_id", "chave", "acao")
SELECT "perfil_id", 'cenarios_analiticos_configuracoes.redistribuicoes', "acao"
FROM "perfil_permissoes_telas"
WHERE "chave" = 'cenarios_analiticos_configuracoes.referencia'
ON CONFLICT DO NOTHING;
