-- O Nome das Redistribuições de Gastos (25/11/2026, pedido do Adão): o primeiro campo do modal e da tabela, nos Cadastros Gerais e
-- nas cópias dos cenários analíticos. As que já existem recebem um nome a partir das contas da DRE: a descrição da primeira conta,
-- "e mais N contas" quando há outras, e o departamento entre parênteses (sem departamento, nada). As cópias dos cenários com origem
-- recebem o nome da redistribuição de origem; as incluídas só no cenário, o nome pela mesma regra. O nome muda no modal.

ALTER TABLE "redistribuicoes_gastos" ADD COLUMN "nome" TEXT;
ALTER TABLE "cenarios_redistribuicoes" ADD COLUMN "nome" TEXT;

UPDATE "redistribuicoes_gastos" r
SET "nome" = LEFT(
  COALESCE(
    (SELECT l."descricao" FROM "redistribuicoes_gastos_contas" c JOIN "linhas_dre" l ON l."id" = c."linha_dre_id"
      WHERE c."redistribuicao_id" = r."id" ORDER BY c."ordem", l."descricao" LIMIT 1),
    'Redistribuição'
  )
  || CASE (SELECT COUNT(*) FROM "redistribuicoes_gastos_contas" c WHERE c."redistribuicao_id" = r."id")
       WHEN 0 THEN '' WHEN 1 THEN '' WHEN 2 THEN ' e mais 1 conta'
       ELSE ' e mais ' || ((SELECT COUNT(*) FROM "redistribuicoes_gastos_contas" c WHERE c."redistribuicao_id" = r."id") - 1) || ' contas'
     END
  || COALESCE(' (' || (SELECT d."nome" FROM "departamentos" d WHERE d."id" = r."departamento_id") || ')', ''),
  120
);

UPDATE "cenarios_redistribuicoes" r
SET "nome" = g."nome"
FROM "redistribuicoes_gastos" g
WHERE r."origem_id" = g."id";

UPDATE "cenarios_redistribuicoes" r
SET "nome" = LEFT(
  COALESCE(
    (SELECT l."descricao" FROM "cenarios_redistribuicoes_contas" c JOIN "linhas_dre" l ON l."id" = c."linha_dre_id"
      WHERE c."redistribuicao_id" = r."id" ORDER BY c."ordem", l."descricao" LIMIT 1),
    'Redistribuição'
  )
  || CASE (SELECT COUNT(*) FROM "cenarios_redistribuicoes_contas" c WHERE c."redistribuicao_id" = r."id")
       WHEN 0 THEN '' WHEN 1 THEN '' WHEN 2 THEN ' e mais 1 conta'
       ELSE ' e mais ' || ((SELECT COUNT(*) FROM "cenarios_redistribuicoes_contas" c WHERE c."redistribuicao_id" = r."id") - 1) || ' contas'
     END
  || COALESCE(' (' || (SELECT d."nome" FROM "cenarios_departamentos" d WHERE d."id" = r."departamento_id") || ')', ''),
  120
)
WHERE r."nome" IS NULL;

ALTER TABLE "redistribuicoes_gastos" ALTER COLUMN "nome" SET NOT NULL;
ALTER TABLE "cenarios_redistribuicoes" ALTER COLUMN "nome" SET NOT NULL;
