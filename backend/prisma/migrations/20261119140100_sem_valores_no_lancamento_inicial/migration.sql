-- Sem os valores no Lançamento Inicial (19/11/2026, pedido do Adão): os salários e os benefícios saíram da tela e da
-- importação em 17/11/2026; as colunas, sem uso, saem do banco.
ALTER TABLE "colaboradores_carga_inicial" DROP COLUMN "adicional",
DROP COLUMN "cesta_basica",
DROP COLUMN "plano_saude",
DROP COLUMN "salario_bruto",
DROP COLUMN "vale_transporte";
