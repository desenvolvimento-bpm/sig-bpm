-- Os Benefícios Padrão dos cenários analíticos (21/11/2026, pedido do Adão): o cadastro do cenário (Configurações / Benefícios
-- Padrão) e, em cada mês das linhas do Quadro de Lotação, os benefícios aplicados (ou o valor digitado na importação).
CREATE TABLE "cenarios_beneficios_padrao" (
    "id" TEXT NOT NULL,
    "cenario_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "valor_mensal" DECIMAL(65,30) NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cenarios_beneficios_padrao_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cenarios_beneficios_padrao_cenario_id_idx" ON "cenarios_beneficios_padrao"("cenario_id");
CREATE UNIQUE INDEX "cenarios_beneficios_padrao_cenario_id_nome_key" ON "cenarios_beneficios_padrao"("cenario_id", "nome");
ALTER TABLE "cenarios_beneficios_padrao" ADD CONSTRAINT "cenarios_beneficios_padrao_cenario_id_fkey" FOREIGN KEY ("cenario_id") REFERENCES "cenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cenarios_lotacao_meses" ADD COLUMN "beneficios_padrao" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "cenarios_lotacao_meses" ADD COLUMN "beneficios" DECIMAL(65,30);

-- A aba nas permissões: os perfis com a aba Centros de Custo das Configurações dos analíticos a herdam, com a mesma ação.
INSERT INTO "perfil_permissoes_telas" ("perfil_id", "chave", "acao")
SELECT "perfil_id", 'cenarios_analiticos_configuracoes.beneficios', "acao"
FROM "perfil_permissoes_telas"
WHERE "chave" = 'cenarios_analiticos_configuracoes.centros_custo'
ON CONFLICT DO NOTHING;
