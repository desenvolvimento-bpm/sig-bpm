-- A receita de frete da Fundação (20/11/2026, pedido do Adão): a Receita Bruta de Frete e a Receita Líquida de Frete, que
-- estavam só na Matriz e na Filial, passam a aparecer também na aba Serviços. Nos cenários analíticos, a linha Fundação
-- das premissas de Serviços tem a Receita Bruta Média de Frete (a líquida sai dela pelos impostos), com o Frete e Descarga
-- dos complementares. No realizado, as duas linhas de Serviços são o frete da receita prévia de Serviços (regra em
-- apuracaoUnidades.ts), que hoje não há: o frete faturado com os serviços está na receita complementar. Idempotente.

INSERT INTO "linhas_dre_unidades" ("linha_dre_id", "unidade_negocio_id")
SELECT l."id", u."id"
FROM "linhas_dre" l, "unidades_negocio" u
WHERE l."codigo" IN ('ROB.RBF.RECEITA_BRUTA_DE_FRETE', 'ROL.RLF.RECEITA_LIQUIDA_DE_FRETE') AND u."codigo" = 3
ON CONFLICT DO NOTHING;
