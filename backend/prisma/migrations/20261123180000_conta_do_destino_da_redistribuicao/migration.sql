-- A conta de cada centro de Redistribuir Para (23/11/2026, pedido do Adão): nos modais de Redistribuição de Gastos (Cadastros Gerais e
-- Configurações dos cenários analíticos), cada centro de custo dos destinos vai numa Conta da DRE do departamento e da atribuição dele.

-- AlterTable
ALTER TABLE "redistribuicoes_gastos_destinos" ADD COLUMN     "linha_dre_id" TEXT;

-- AlterTable
ALTER TABLE "cenarios_redistribuicoes_destinos" ADD COLUMN     "linha_dre_id" TEXT;

-- CreateIndex
CREATE INDEX "redistribuicoes_gastos_destinos_linha_dre_id_idx" ON "redistribuicoes_gastos_destinos"("linha_dre_id");

-- CreateIndex
CREATE INDEX "cenarios_redistribuicoes_destinos_linha_dre_id_idx" ON "cenarios_redistribuicoes_destinos"("linha_dre_id");

-- AddForeignKey
ALTER TABLE "redistribuicoes_gastos_destinos" ADD CONSTRAINT "redistribuicoes_gastos_destinos_linha_dre_id_fkey" FOREIGN KEY ("linha_dre_id") REFERENCES "linhas_dre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cenarios_redistribuicoes_destinos" ADD CONSTRAINT "cenarios_redistribuicoes_destinos_linha_dre_id_fkey" FOREIGN KEY ("linha_dre_id") REFERENCES "linhas_dre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Os destinos que já existem: a conta de origem da redistribuição, quando ela é do departamento e da atribuição do centro; senão, a
-- equivalente (a mesma descrição) no departamento do centro, numa atribuição que cabe na dele — a da mesma atribuição da origem e,
-- entre as outras, a que combina com o centro (Direta: os Diretos; Indireta: os Indiretos). Sem equivalente, fica nula (a parte segue
-- na conta do movimento até a próxima gravação).
UPDATE "redistribuicoes_gastos_destinos" AS d
SET "linha_dre_id" = (
  SELECT l."id"
  FROM "centros_custo" c
  JOIN "redistribuicoes_gastos_contas" x ON x."redistribuicao_id" = d."redistribuicao_id"
  JOIN "linhas_dre" o ON o."id" = x."linha_dre_id"
  JOIN "linhas_dre" l ON l."tipo" = 'ITEM' AND l."ativo"
    AND upper(trim(l."grupo")) = upper(trim(c."departamento"))
    AND upper(trim(l."descricao")) = upper(trim(o."descricao"))
    -- E a atribuição do centro (como a verificação da classificação): o direto sem MOI e GGI, o indireto sem MOD e GGD.
    AND (CASE c."atribuicao"::text
      WHEN 'DIRETA' THEN coalesce(l."atribuicao", '') NOT IN ('Mão de Obra Indireta', 'Gastos Gerais Indiretos')
      WHEN 'INDIRETA' THEN coalesce(l."atribuicao", '') NOT IN ('Mão de Obra Direta', 'Gastos Gerais Diretos')
      ELSE true END)
  WHERE c."id" = d."centro_custo_id"
  ORDER BY (l."id" = o."id") DESC,
    (l."atribuicao" IS NOT DISTINCT FROM o."atribuicao") DESC,
    (CASE c."atribuicao" WHEN 'DIRETA' THEN l."atribuicao" ILIKE '%Diret%' AND l."atribuicao" NOT ILIKE '%Indiret%' WHEN 'INDIRETA' THEN l."atribuicao" ILIKE '%Indiret%' ELSE false END) DESC,
    x."ordem", l."ordem"
  LIMIT 1
);

UPDATE "cenarios_redistribuicoes_destinos" AS d
SET "linha_dre_id" = (
  SELECT l."id"
  FROM "cenarios_centros_custo" c
  JOIN "cenarios_redistribuicoes_contas" x ON x."redistribuicao_id" = d."redistribuicao_id"
  JOIN "linhas_dre" o ON o."id" = x."linha_dre_id"
  JOIN "linhas_dre" l ON l."tipo" = 'ITEM' AND l."ativo"
    AND upper(trim(l."grupo")) = upper(trim(c."departamento"))
    AND upper(trim(l."descricao")) = upper(trim(o."descricao"))
    -- E a atribuição do centro (como a verificação da classificação): o direto sem MOI e GGI, o indireto sem MOD e GGD.
    AND (CASE c."atribuicao"::text
      WHEN 'DIRETA' THEN coalesce(l."atribuicao", '') NOT IN ('Mão de Obra Indireta', 'Gastos Gerais Indiretos')
      WHEN 'INDIRETA' THEN coalesce(l."atribuicao", '') NOT IN ('Mão de Obra Direta', 'Gastos Gerais Diretos')
      ELSE true END)
  WHERE c."id" = d."centro_custo_id"
  ORDER BY (l."id" = o."id") DESC,
    (l."atribuicao" IS NOT DISTINCT FROM o."atribuicao") DESC,
    (CASE c."atribuicao" WHEN 'DIRETA' THEN l."atribuicao" ILIKE '%Diret%' AND l."atribuicao" NOT ILIKE '%Indiret%' WHEN 'INDIRETA' THEN l."atribuicao" ILIKE '%Indiret%' ELSE false END) DESC,
    x."ordem", l."ordem"
  LIMIT 1
);
