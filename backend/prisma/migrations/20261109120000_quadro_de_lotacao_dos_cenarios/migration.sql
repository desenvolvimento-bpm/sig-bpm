-- A aba Quadro de Lotação dos cenários analíticos (09/11/2026, etapa 4 da Gestão de Colaboradores).
-- CreateTable
CREATE TABLE "cenarios_lotacao" (
    "id" TEXT NOT NULL,
    "cenario_id" TEXT NOT NULL,
    "unidade_negocio_id" TEXT NOT NULL,
    "vinculo" "VinculoColaborador" NOT NULL,
    "senioridade_id" TEXT NOT NULL,
    "funcao_id" TEXT NOT NULL,
    "centro_custo_id" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cenarios_lotacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cenarios_lotacao_meses" (
    "linha_id" TEXT NOT NULL,
    "mes" INTEGER NOT NULL,
    "colaboradores" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "salario_bruto" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "adicional" DECIMAL(65,30) NOT NULL DEFAULT 0,

    CONSTRAINT "cenarios_lotacao_meses_pkey" PRIMARY KEY ("linha_id","mes")
);

-- CreateIndex
CREATE INDEX "cenarios_lotacao_cenario_id_idx" ON "cenarios_lotacao"("cenario_id");

-- AddForeignKey
ALTER TABLE "cenarios_lotacao" ADD CONSTRAINT "cenarios_lotacao_cenario_id_fkey" FOREIGN KEY ("cenario_id") REFERENCES "cenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cenarios_lotacao" ADD CONSTRAINT "cenarios_lotacao_unidade_negocio_id_fkey" FOREIGN KEY ("unidade_negocio_id") REFERENCES "unidades_negocio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cenarios_lotacao" ADD CONSTRAINT "cenarios_lotacao_senioridade_id_fkey" FOREIGN KEY ("senioridade_id") REFERENCES "colaboradores_senioridades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cenarios_lotacao" ADD CONSTRAINT "cenarios_lotacao_funcao_id_fkey" FOREIGN KEY ("funcao_id") REFERENCES "colaboradores_funcoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cenarios_lotacao" ADD CONSTRAINT "cenarios_lotacao_centro_custo_id_fkey" FOREIGN KEY ("centro_custo_id") REFERENCES "centros_custo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cenarios_lotacao_meses" ADD CONSTRAINT "cenarios_lotacao_meses_linha_id_fkey" FOREIGN KEY ("linha_id") REFERENCES "cenarios_lotacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
