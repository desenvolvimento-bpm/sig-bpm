-- A Gestão de Colaboradores (06/11/2026), etapa 3: o Apurar das Importações grava os indicadores do Administrativo apurados no
-- Quadro de Lotação como os digitados nas Listas, com a origem APURADO (a lupa com as movimentações do mês).

-- AlterTable
ALTER TABLE "indicadores_digitados" ADD COLUMN     "origem" TEXT NOT NULL DEFAULT 'DIGITADO';

