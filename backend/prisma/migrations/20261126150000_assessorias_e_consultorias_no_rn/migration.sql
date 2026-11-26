-- As Assessorias e Consultorias no RN (26/11/2026, pedido do Adão): nas tabelas da DRE do RN (Fechamentos Mensais, Resultados
-- Empresariais e Cenários Analíticos), logo antes de DEDUÇÕES DA MARGEM LÍQUIDA (DML), DESPESAS ADMINISTRATIVAS (DA) > Gastos
-- Gerais Indiretos > Assessorias e Consultorias, que estavam só em Despesas e Extra. No realizado, a conta do RN soma só os
-- lançamentos manuais do balde RN nela (regra em apuracaoUnidades.ts; o balancete da DA continua em Despesas e Extra); nos
-- cenários analíticos, os valores dela vêm da tabela RN da aba Extra-Operacional das Premissas (investimentosCenario.ts).
-- O total e o subtotal da DA no RN somam só essa conta. Idempotente.

INSERT INTO "linhas_dre_unidades" ("linha_dre_id", "unidade_negocio_id")
SELECT l."id", u."id"
FROM "linhas_dre" l, "unidades_negocio" u
WHERE l."codigo" IN ('DA.DESPESAS_ADMINISTRATIVAS_DA', 'DA.GGI.GASTOS_GERAIS_INDIRETOS', 'DA.GGI.ASSESSORIAS_E_CONSULTORIAS') AND u."codigo" = 5
ON CONFLICT DO NOTHING;
