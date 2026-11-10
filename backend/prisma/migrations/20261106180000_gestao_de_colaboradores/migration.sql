-- A Gestão de Colaboradores (06/11/2026, pedido do Adão; grupo Processos Administrativos do menu), etapa 1: a tela Cadastros,
-- com as abas Senioridades, Funções, Movimentações (os tipos de movimentação do Quadro de Lotação), Classificações e
-- Lançamento Inicial (o quadro de lotação do início de um mês, um registro por colaborador). O recurso entra na matriz dos
-- perfis (o Administrador alcança tudo pelo código; os demais perfis, depois de liberados na tela Perfis).
-- No fim, os 5 tipos de movimentação padrão (pedido do Adão: em todas as bases).

-- CreateEnum
CREATE TYPE "ContagemMovimentacao" AS ENUM ('POSITIVA', 'NEGATIVA', 'NULA');

-- CreateEnum
CREATE TYPE "AprovacaoMovimentacao" AS ENUM ('AUTOMATICA', 'MANUAL');

-- CreateEnum
CREATE TYPE "VinculoColaborador" AS ENUM ('CLT', 'PJ');

-- AlterEnum
ALTER TYPE "RecursoSistema" ADD VALUE 'GESTAO_COLABORADORES';

-- CreateTable
CREATE TABLE "colaboradores_senioridades" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "colaboradores_senioridades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "colaboradores_funcoes" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "senioridade_id" TEXT,
    "competencias" TEXT,
    "atividades" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "colaboradores_funcoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "colaboradores_tipos_movimentacao" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "contagem" "ContagemMovimentacao" NOT NULL,
    "aprovacao" "AprovacaoMovimentacao" NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "colaboradores_tipos_movimentacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "colaboradores_classificacoes" (
    "id" TEXT NOT NULL,
    "tipo_movimentacao_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "colaboradores_classificacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "colaboradores_carga_inicial" (
    "id" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "unidade_negocio_id" TEXT NOT NULL,
    "vinculo" "VinculoColaborador" NOT NULL,
    "senioridade_id" TEXT NOT NULL,
    "funcao_id" TEXT NOT NULL,
    "centro_custo_id" TEXT NOT NULL,
    "linha_arquivo" INTEGER,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "colaboradores_carga_inicial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "colaboradores_senioridades_nome_key" ON "colaboradores_senioridades"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "colaboradores_funcoes_nome_key" ON "colaboradores_funcoes"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "colaboradores_tipos_movimentacao_nome_key" ON "colaboradores_tipos_movimentacao"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "colaboradores_classificacoes_tipo_movimentacao_id_nome_key" ON "colaboradores_classificacoes"("tipo_movimentacao_id", "nome");

-- CreateIndex
CREATE INDEX "colaboradores_carga_inicial_ano_mes_idx" ON "colaboradores_carga_inicial"("ano", "mes");

-- AddForeignKey
ALTER TABLE "colaboradores_funcoes" ADD CONSTRAINT "colaboradores_funcoes_senioridade_id_fkey" FOREIGN KEY ("senioridade_id") REFERENCES "colaboradores_senioridades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "colaboradores_classificacoes" ADD CONSTRAINT "colaboradores_classificacoes_tipo_movimentacao_id_fkey" FOREIGN KEY ("tipo_movimentacao_id") REFERENCES "colaboradores_tipos_movimentacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "colaboradores_carga_inicial" ADD CONSTRAINT "colaboradores_carga_inicial_unidade_negocio_id_fkey" FOREIGN KEY ("unidade_negocio_id") REFERENCES "unidades_negocio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "colaboradores_carga_inicial" ADD CONSTRAINT "colaboradores_carga_inicial_senioridade_id_fkey" FOREIGN KEY ("senioridade_id") REFERENCES "colaboradores_senioridades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "colaboradores_carga_inicial" ADD CONSTRAINT "colaboradores_carga_inicial_funcao_id_fkey" FOREIGN KEY ("funcao_id") REFERENCES "colaboradores_funcoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "colaboradores_carga_inicial" ADD CONSTRAINT "colaboradores_carga_inicial_centro_custo_id_fkey" FOREIGN KEY ("centro_custo_id") REFERENCES "centros_custo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Os tipos de movimentação padrão (06/11/2026).
INSERT INTO "colaboradores_tipos_movimentacao" ("id", "nome", "descricao", "contagem", "aprovacao", "ordem", "ativo", "atualizado_em") VALUES
  (gen_random_uuid()::text, 'Admissão', 'Contratação de colaborador', 'POSITIVA', 'MANUAL', 1, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Reposição', 'Reposição de colaborador', 'POSITIVA', 'AUTOMATICA', 2, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Desligamento', 'Demissão ou desligamento de colaborador', 'NEGATIVA', 'AUTOMATICA', 3, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Abertura de Vaga', 'Criação de vaga', 'NULA', 'MANUAL', 4, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Encerramento de Vaga', 'Extinção de vaga', 'NULA', 'MANUAL', 5, true, CURRENT_TIMESTAMP);
