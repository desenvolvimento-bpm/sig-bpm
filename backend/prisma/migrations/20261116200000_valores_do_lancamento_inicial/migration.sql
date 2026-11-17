-- Os valores de cada colaborador do Lançamento Inicial (16/11/2026, pedido do Adão), em R$: o Salário Bruto, o Adicional de
-- Periculosidade / Insalubridade, a Cesta Básica / Seguro de Vida / Vale Alimentação, o Plano de Saúde e o Vale Transporte.
-- Nulos nos colaboradores de antes (sem valor informado). O Salário Total não se grava: o SIG calcula.

-- AlterTable
ALTER TABLE "colaboradores_carga_inicial" ADD COLUMN "salario_bruto" DECIMAL(14,2),
ADD COLUMN "adicional" DECIMAL(14,2),
ADD COLUMN "cesta_basica" DECIMAL(14,2),
ADD COLUMN "plano_saude" DECIMAL(14,2),
ADD COLUMN "vale_transporte" DECIMAL(14,2);
