-- As Regras de Rateio por cenário analítico (21/11/2026, pedido do Adão: a aba Regras de Rateio das Configurações, depois de
-- Centros de Custo): a cópia das regras de Cadastros Gerais / Regras de Rateio, com que o cenário calcula os rateios.
CREATE TABLE "cenarios_regras_rateio" (
    "id" TEXT NOT NULL,
    "cenario_id" TEXT NOT NULL,
    "origem_id" TEXT,
    "chave" "BaldeAlocacao" NOT NULL,
    "destino" "DestinoRateio" NOT NULL,
    "unidade_destino_id" TEXT NOT NULL,
    "rotulo" TEXT NOT NULL,
    "base_fisica" "BaseFisica" NOT NULL,
    "origem_do_volume" TEXT NOT NULL,
    "vigencia_inicio" TIMESTAMP(3) NOT NULL,
    "vigencia_fim" TIMESTAMP(3),
    "percentual_fixo" DECIMAL(65,30),
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cenarios_regras_rateio_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cenarios_regras_rateio_cenario_id_idx" ON "cenarios_regras_rateio"("cenario_id");

ALTER TABLE "cenarios_regras_rateio" ADD CONSTRAINT "cenarios_regras_rateio_cenario_id_fkey" FOREIGN KEY ("cenario_id") REFERENCES "cenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cenarios_regras_rateio" ADD CONSTRAINT "cenarios_regras_rateio_origem_id_fkey" FOREIGN KEY ("origem_id") REFERENCES "regras_rateio"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cenarios_regras_rateio" ADD CONSTRAINT "cenarios_regras_rateio_unidade_destino_id_fkey" FOREIGN KEY ("unidade_destino_id") REFERENCES "unidades_negocio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A cópia dos analíticos que já existem: as regras de hoje, com a data de alteração delas (a assinatura das regras do cálculo
-- continua a mesma).
INSERT INTO "cenarios_regras_rateio" ("id", "cenario_id", "origem_id", "chave", "destino", "unidade_destino_id", "rotulo", "base_fisica", "origem_do_volume", "vigencia_inicio", "vigencia_fim", "percentual_fixo", "ordem", "criado_em", "atualizado_em")
SELECT gen_random_uuid()::text, c."id", r."id", r."chave", r."destino", r."unidade_destino_id", r."rotulo", r."base_fisica", r."origem_do_volume", r."vigencia_inicio", r."vigencia_fim", r."percentual_fixo", r."ordem", CURRENT_TIMESTAMP, r."atualizado_em"
FROM "cenarios" c CROSS JOIN "regras_rateio" r
WHERE c."tipo" = 'ANALITICO';

-- A aba nas permissões: os perfis com a aba Centros de Custo das Configurações dos analíticos a herdam, com a mesma ação.
INSERT INTO "perfil_permissoes_telas" ("perfil_id", "chave", "acao")
SELECT "perfil_id", 'cenarios_analiticos_configuracoes.regras_rateio', "acao"
FROM "perfil_permissoes_telas"
WHERE "chave" = 'cenarios_analiticos_configuracoes.centros_custo'
ON CONFLICT DO NOTHING;
