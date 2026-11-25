-- Os valores ligados aos indicadores pelo ID (25/11/2026, pedido do Adão: os nomes dos cadastros mudam a qualquer momento; parte
-- 2b do passo 2 de renomear os cadastros). Só dados: as colunas continuam as mesmas (o campo `indicador` do schema é a coluna
-- "nome").
--
-- Os valores importados e digitados, as metas importadas e os valores dos cenários com o nome de um indicador do cadastro passam
-- a guardar o ID dele; as justificativas das Premissas dos Indicadores Manuais, o código I|id. Os de um nome que não é de nenhum
-- indicador do cadastro ficam com o nome.

UPDATE "indicadores_importados" AS v SET "nome" = i."id" FROM "indicadores_estrutura" AS i WHERE v."nome" = i."nome";
UPDATE "indicadores_digitados" AS v SET "nome" = i."id" FROM "indicadores_estrutura" AS i WHERE v."nome" = i."nome";
UPDATE "metas_importadas" AS v SET "nome" = i."id" FROM "indicadores_estrutura" AS i WHERE v."nome" = i."nome";
UPDATE "cenarios_indicadores" AS v SET "nome" = i."id" FROM "indicadores_estrutura" AS i WHERE v."nome" = i."nome";
UPDATE "cenarios_premissas_justificativas" AS j SET "chave" = 'I|' || i."id" FROM "indicadores_estrutura" AS i WHERE j."chave" = 'I|' || i."nome";
