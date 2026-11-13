-- As Redistribuições de Gastos (13/11/2026, pedido do Adão): Cadastros da Controladoria / Controladoria / Redistribuições de
-- Gastos. Os movimentos dos fornecedores marcados, numa conta da DRE (e num departamento, ou em todos), valem divididos entre
-- os centros de custo dos destinos, pelos percentuais, nas competências da vigência; as partes ficam em lancamentos_redistribuidos
-- (derivadas, como os campos do lançamento), e o lançamento guarda a regra aplicada (redistribuicao_id).

-- AlterTable
ALTER TABLE "lancamentos_contabeis" ADD COLUMN     "redistribuicao_id" TEXT;

-- CreateTable
CREATE TABLE "redistribuicoes_gastos" (
    "id" TEXT NOT NULL,
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

    CONSTRAINT "redistribuicoes_gastos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redistribuicoes_gastos_destinos" (
    "id" TEXT NOT NULL,
    "redistribuicao_id" TEXT NOT NULL,
    "centro_custo_id" TEXT NOT NULL,
    "percentual" DECIMAL(65,30) NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "redistribuicoes_gastos_destinos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lancamentos_redistribuidos" (
    "id" TEXT NOT NULL,
    "competencia_id" TEXT NOT NULL,
    "lancamento_contabil_id" TEXT NOT NULL,
    "redistribuicao_id" TEXT NOT NULL,
    "filial" INTEGER NOT NULL,
    "linha_dre_id" TEXT NOT NULL,
    "centro_custo_id" TEXT NOT NULL,
    "percentual" DECIMAL(65,30) NOT NULL,
    "valor_movimento" DECIMAL(65,30) NOT NULL,
    "balde" "BaldeAlocacao",
    "alocacao" "TipoAlocacao" NOT NULL,
    "etiqueta" TEXT NOT NULL,

    CONSTRAINT "lancamentos_redistribuidos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "redistribuicoes_gastos_linha_dre_id_idx" ON "redistribuicoes_gastos"("linha_dre_id");

-- CreateIndex
CREATE UNIQUE INDEX "redistribuicoes_gastos_destinos_redistribuicao_id_centro_cu_key" ON "redistribuicoes_gastos_destinos"("redistribuicao_id", "centro_custo_id");

-- CreateIndex
CREATE INDEX "lancamentos_redistribuidos_competencia_id_linha_dre_id_idx" ON "lancamentos_redistribuidos"("competencia_id", "linha_dre_id");

-- CreateIndex
CREATE INDEX "lancamentos_redistribuidos_lancamento_contabil_id_idx" ON "lancamentos_redistribuidos"("lancamento_contabil_id");

-- AddForeignKey
ALTER TABLE "lancamentos_contabeis" ADD CONSTRAINT "lancamentos_contabeis_redistribuicao_id_fkey" FOREIGN KEY ("redistribuicao_id") REFERENCES "redistribuicoes_gastos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redistribuicoes_gastos" ADD CONSTRAINT "redistribuicoes_gastos_departamento_id_fkey" FOREIGN KEY ("departamento_id") REFERENCES "departamentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redistribuicoes_gastos" ADD CONSTRAINT "redistribuicoes_gastos_linha_dre_id_fkey" FOREIGN KEY ("linha_dre_id") REFERENCES "linhas_dre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redistribuicoes_gastos_destinos" ADD CONSTRAINT "redistribuicoes_gastos_destinos_redistribuicao_id_fkey" FOREIGN KEY ("redistribuicao_id") REFERENCES "redistribuicoes_gastos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redistribuicoes_gastos_destinos" ADD CONSTRAINT "redistribuicoes_gastos_destinos_centro_custo_id_fkey" FOREIGN KEY ("centro_custo_id") REFERENCES "centros_custo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamentos_redistribuidos" ADD CONSTRAINT "lancamentos_redistribuidos_competencia_id_fkey" FOREIGN KEY ("competencia_id") REFERENCES "competencias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamentos_redistribuidos" ADD CONSTRAINT "lancamentos_redistribuidos_lancamento_contabil_id_fkey" FOREIGN KEY ("lancamento_contabil_id") REFERENCES "lancamentos_contabeis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamentos_redistribuidos" ADD CONSTRAINT "lancamentos_redistribuidos_redistribuicao_id_fkey" FOREIGN KEY ("redistribuicao_id") REFERENCES "redistribuicoes_gastos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamentos_redistribuidos" ADD CONSTRAINT "lancamentos_redistribuidos_linha_dre_id_fkey" FOREIGN KEY ("linha_dre_id") REFERENCES "linhas_dre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamentos_redistribuidos" ADD CONSTRAINT "lancamentos_redistribuidos_centro_custo_id_fkey" FOREIGN KEY ("centro_custo_id") REFERENCES "centros_custo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A aba na matriz dos perfis: quem tem a aba Regras de Rateio ganha a das Redistribuições, com a mesma permissão (Ler ou Editar).
INSERT INTO "perfil_permissoes_telas" ("perfil_id", "chave", "acao")
SELECT "perfil_id", 'cadastro_controladoria.redistribuicoes', "acao" FROM "perfil_permissoes_telas" WHERE "chave" = 'cadastro_controladoria.regras_rateio'
ON CONFLICT DO NOTHING;
