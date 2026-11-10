-- A Gestão de Colaboradores (06/11/2026, pedido do Adão), etapa 2: o Quadro de Lotação, com competências próprias (abertas
-- e fechadas fora do Fechamento Mensal), e as movimentações (admissões, desligamentos, aberturas de vaga…), com a
-- aprovação manual (Pendente → Aprovada ou Reprovada) e a vaga gerada por um desligamento.

-- CreateEnum
CREATE TYPE "StatusCompetenciaQuadro" AS ENUM ('ABERTA', 'FECHADA');

-- CreateEnum
CREATE TYPE "StatusMovimentacaoQuadro" AS ENUM ('PENDENTE', 'APROVADA', 'REPROVADA');

-- CreateEnum
CREATE TYPE "OrigemDesligamento" AS ENUM ('INICIATIVA_EMPRESA', 'PEDIDO_COLABORADOR');

-- CreateTable
CREATE TABLE "colaboradores_competencias" (
    "id" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "status" "StatusCompetenciaQuadro" NOT NULL DEFAULT 'ABERTA',
    "aberta_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aberta_por_nome" TEXT,
    "fechada_em" TIMESTAMP(3),
    "fechada_por_nome" TEXT,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "colaboradores_competencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "colaboradores_movimentacoes" (
    "id" TEXT NOT NULL,
    "competencia_id" TEXT NOT NULL,
    "tipo_movimentacao_id" TEXT NOT NULL,
    "classificacao_id" TEXT,
    "data" DATE NOT NULL,
    "centro_custo_id" TEXT NOT NULL,
    "vinculo" "VinculoColaborador" NOT NULL,
    "funcao_id" TEXT NOT NULL,
    "senioridade_id" TEXT NOT NULL,
    "motivo" TEXT,
    "origem" "OrigemDesligamento",
    "status" "StatusMovimentacaoQuadro" NOT NULL,
    "gerada_por_id" TEXT,
    "registrada_por" TEXT,
    "registrada_por_nome" TEXT,
    "registrada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidida_por_nome" TEXT,
    "decidida_em" TIMESTAMP(3),
    "justificativa" TEXT,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "colaboradores_movimentacoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "colaboradores_competencias_ano_mes_key" ON "colaboradores_competencias"("ano", "mes");

-- CreateIndex
CREATE INDEX "colaboradores_movimentacoes_competencia_id_idx" ON "colaboradores_movimentacoes"("competencia_id");

-- CreateIndex
CREATE INDEX "colaboradores_movimentacoes_status_idx" ON "colaboradores_movimentacoes"("status");

-- AddForeignKey
ALTER TABLE "colaboradores_movimentacoes" ADD CONSTRAINT "colaboradores_movimentacoes_competencia_id_fkey" FOREIGN KEY ("competencia_id") REFERENCES "colaboradores_competencias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "colaboradores_movimentacoes" ADD CONSTRAINT "colaboradores_movimentacoes_tipo_movimentacao_id_fkey" FOREIGN KEY ("tipo_movimentacao_id") REFERENCES "colaboradores_tipos_movimentacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "colaboradores_movimentacoes" ADD CONSTRAINT "colaboradores_movimentacoes_classificacao_id_fkey" FOREIGN KEY ("classificacao_id") REFERENCES "colaboradores_classificacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "colaboradores_movimentacoes" ADD CONSTRAINT "colaboradores_movimentacoes_centro_custo_id_fkey" FOREIGN KEY ("centro_custo_id") REFERENCES "centros_custo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "colaboradores_movimentacoes" ADD CONSTRAINT "colaboradores_movimentacoes_funcao_id_fkey" FOREIGN KEY ("funcao_id") REFERENCES "colaboradores_funcoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "colaboradores_movimentacoes" ADD CONSTRAINT "colaboradores_movimentacoes_senioridade_id_fkey" FOREIGN KEY ("senioridade_id") REFERENCES "colaboradores_senioridades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "colaboradores_movimentacoes" ADD CONSTRAINT "colaboradores_movimentacoes_gerada_por_id_fkey" FOREIGN KEY ("gerada_por_id") REFERENCES "colaboradores_movimentacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

