-- O Tipo do colaborador ganha o Aprendiz e o Estagiário (16/11/2026, pedido do Adão), que eram senioridades. Numa migração
-- própria: o PostgreSQL só deixa usar o valor novo do enum depois que ele é gravado (a migração seguinte converte os dados).

-- AlterEnum
ALTER TYPE "VinculoColaborador" ADD VALUE 'APRENDIZ';
ALTER TYPE "VinculoColaborador" ADD VALUE 'ESTAGIARIO';
