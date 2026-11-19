-- Quem incluiu cada investimento dos cenários analíticos (19/11/2026, pedido do Adão): quem tem recorte só altera e exclui os
-- que incluiu; o Administrador, quem criou o cenário e quem não tem recorte alteram todos.
ALTER TABLE "cenarios_investimentos" ADD COLUMN "criado_por_id" TEXT;

ALTER TABLE "cenarios_investimentos" ADD CONSTRAINT "cenarios_investimentos_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Os que já existem: o autor pelo histórico (a inclusão pelo formulário, "Investimentos · Novo: <descrição>"), só quando não há
-- dúvida (um investimento com essa descrição no cenário e um só usuário com a inclusão dela). Os demais ficam sem autor.
UPDATE "cenarios_investimentos" AS i
SET "criado_por_id" = h."usuario_id"
FROM (
  SELECT "cenario_id", substr("descricao", length('Investimentos · Novo: ') + 1) AS "descricao_do_investimento", min("usuario_id") AS "usuario_id"
  FROM "cenarios_reajustes"
  WHERE "descricao" LIKE 'Investimentos · Novo: %' AND "usuario_id" IS NOT NULL
  GROUP BY 1, 2
  HAVING count(DISTINCT "usuario_id") = 1
) AS h
WHERE h."cenario_id" = i."cenario_id"
  AND h."descricao_do_investimento" = i."descricao"
  AND (SELECT count(*) FROM "cenarios_investimentos" AS x WHERE x."cenario_id" = i."cenario_id" AND x."descricao" = i."descricao") = 1
  AND EXISTS (SELECT 1 FROM "usuarios" AS u WHERE u."id" = h."usuario_id");
