-- A Jornada do Quadro de Lotação (13/11/2026, pedido do Adão): as horas extras e as faltas de cada linha do quadro realizado.
CREATE TABLE "colaboradores_jornada" (
    "id" TEXT NOT NULL,
    "competencia_id" TEXT NOT NULL,
    "centro_custo_id" TEXT NOT NULL,
    "funcao_id" TEXT NOT NULL,
    "horas_extras_minutos" INTEGER NOT NULL DEFAULT 0,
    "faltas_dias" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "atualizado_por_nome" TEXT,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "colaboradores_jornada_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "colaboradores_jornada_competencia_id_centro_custo_id_funcao_key" ON "colaboradores_jornada"("competencia_id", "centro_custo_id", "funcao_id");

ALTER TABLE "colaboradores_jornada" ADD CONSTRAINT "colaboradores_jornada_competencia_id_fkey" FOREIGN KEY ("competencia_id") REFERENCES "colaboradores_competencias"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "colaboradores_jornada" ADD CONSTRAINT "colaboradores_jornada_centro_custo_id_fkey" FOREIGN KEY ("centro_custo_id") REFERENCES "centros_custo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "colaboradores_jornada" ADD CONSTRAINT "colaboradores_jornada_funcao_id_fkey" FOREIGN KEY ("funcao_id") REFERENCES "colaboradores_funcoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A aba na matriz dos perfis: quem tem a aba Movimentações do Quadro de Lotação ganha a Jornada, com a mesma permissão.
INSERT INTO "perfil_permissoes_telas" ("perfil_id", "chave", "acao")
SELECT "perfil_id", 'colaboradores_quadro.jornada', "acao" FROM "perfil_permissoes_telas" WHERE "chave" = 'colaboradores_quadro.movimentacoes'
ON CONFLICT DO NOTHING;
