-- Sem as senioridades (16/11/2026, pedido do Adão): na Gestão de Colaboradores e nas premissas dos cenários analíticos, só as
-- funções contam.
-- 1. As senioridades Aprendiz e Estagiário viram o Tipo (Aprendiz, Estagiário) das linhas: no Lançamento Inicial, nas
--    movimentações do Quadro de Lotação e no Quadro de Lotação dos cenários.
-- 2. As funções de mesmo nome (uma por senioridade) viram uma: a ativa mais antiga fica, com a descrição, as competências e
--    as atividades das outras quando não tem; os registros das outras passam para ela (a Jornada soma as horas e as faltas).
-- 3. As linhas do Quadro de Lotação dos cenários que ficam iguais (a unidade, o tipo, a função e o centro) viram uma: em
--    cada mês, os colaboradores somados e o salário (o bruto e o adicional) pela média ponderada pelos colaboradores — o
--    custo das linhas não muda.
-- 4. Saem a coluna da senioridade, o cadastro das senioridades e a permissão da aba Senioridades nos perfis.

-- 1. O Tipo pela senioridade ----------------------------------------------------------------------------------------------
UPDATE "colaboradores_carga_inicial" c SET "vinculo" = 'APRENDIZ'
  FROM "colaboradores_senioridades" s WHERE s."id" = c."senioridade_id" AND lower(s."nome") = 'aprendiz';
UPDATE "colaboradores_carga_inicial" c SET "vinculo" = 'ESTAGIARIO'
  FROM "colaboradores_senioridades" s WHERE s."id" = c."senioridade_id" AND lower(s."nome") IN ('estagiário', 'estagiario');
UPDATE "colaboradores_movimentacoes" c SET "vinculo" = 'APRENDIZ'
  FROM "colaboradores_senioridades" s WHERE s."id" = c."senioridade_id" AND lower(s."nome") = 'aprendiz';
UPDATE "colaboradores_movimentacoes" c SET "vinculo" = 'ESTAGIARIO'
  FROM "colaboradores_senioridades" s WHERE s."id" = c."senioridade_id" AND lower(s."nome") IN ('estagiário', 'estagiario');
UPDATE "cenarios_lotacao" c SET "vinculo" = 'APRENDIZ'
  FROM "colaboradores_senioridades" s WHERE s."id" = c."senioridade_id" AND lower(s."nome") = 'aprendiz';
UPDATE "cenarios_lotacao" c SET "vinculo" = 'ESTAGIARIO'
  FROM "colaboradores_senioridades" s WHERE s."id" = c."senioridade_id" AND lower(s."nome") IN ('estagiário', 'estagiario');

-- 2. Uma função por nome --------------------------------------------------------------------------------------------------
CREATE TEMP TABLE "funcao_destino" AS
SELECT f."id",
       first_value(f."id") OVER (PARTITION BY lower(btrim(f."nome")) ORDER BY f."ativo" DESC, f."criado_em", f."id") AS "destino"
  FROM "colaboradores_funcoes" f;

UPDATE "colaboradores_funcoes" f SET
  "descricao" = COALESCE(f."descricao", (SELECT o."descricao" FROM "colaboradores_funcoes" o JOIN "funcao_destino" d ON d."id" = o."id"
                                         WHERE d."destino" = f."id" AND o."descricao" IS NOT NULL ORDER BY o."criado_em", o."id" LIMIT 1)),
  "competencias" = COALESCE(f."competencias", (SELECT o."competencias" FROM "colaboradores_funcoes" o JOIN "funcao_destino" d ON d."id" = o."id"
                                         WHERE d."destino" = f."id" AND o."competencias" IS NOT NULL ORDER BY o."criado_em", o."id" LIMIT 1)),
  "atividades" = COALESCE(f."atividades", (SELECT o."atividades" FROM "colaboradores_funcoes" o JOIN "funcao_destino" d ON d."id" = o."id"
                                         WHERE d."destino" = f."id" AND o."atividades" IS NOT NULL ORDER BY o."criado_em", o."id" LIMIT 1))
 WHERE f."id" IN (SELECT "destino" FROM "funcao_destino" WHERE "id" <> "destino");

UPDATE "colaboradores_carga_inicial" c SET "funcao_id" = d."destino" FROM "funcao_destino" d WHERE c."funcao_id" = d."id" AND d."id" <> d."destino";
UPDATE "colaboradores_movimentacoes" c SET "funcao_id" = d."destino" FROM "funcao_destino" d WHERE c."funcao_id" = d."id" AND d."id" <> d."destino";
UPDATE "cenarios_lotacao" c SET "funcao_id" = d."destino" FROM "funcao_destino" d WHERE c."funcao_id" = d."id" AND d."id" <> d."destino";

-- A Jornada: a linha da função que fica soma as horas extras e as faltas das outras.
INSERT INTO "colaboradores_jornada" ("id", "competencia_id", "centro_custo_id", "funcao_id", "horas_extras_minutos", "faltas_dias", "atualizado_por_nome", "atualizado_em")
SELECT gen_random_uuid()::text, j."competencia_id", j."centro_custo_id", d."destino",
       sum(j."horas_extras_minutos"), sum(j."faltas_dias"), max(j."atualizado_por_nome"), max(j."atualizado_em")
  FROM "colaboradores_jornada" j JOIN "funcao_destino" d ON d."id" = j."funcao_id"
 GROUP BY j."competencia_id", j."centro_custo_id", d."destino"
HAVING bool_or(d."id" <> d."destino")
ON CONFLICT ("competencia_id", "centro_custo_id", "funcao_id") DO UPDATE SET
  "horas_extras_minutos" = EXCLUDED."horas_extras_minutos",
  "faltas_dias" = EXCLUDED."faltas_dias",
  "atualizado_por_nome" = EXCLUDED."atualizado_por_nome",
  "atualizado_em" = EXCLUDED."atualizado_em";
DELETE FROM "colaboradores_jornada" j USING "funcao_destino" d WHERE j."funcao_id" = d."id" AND d."id" <> d."destino";

DELETE FROM "colaboradores_funcoes" f USING "funcao_destino" d WHERE f."id" = d."id" AND d."id" <> d."destino";
DROP TABLE "funcao_destino";

-- 3. Uma linha por unidade, tipo, função e centro no Quadro de Lotação dos cenários ---------------------------------------
CREATE TEMP TABLE "linha_destino" AS
SELECT l."id",
       first_value(l."id") OVER (PARTITION BY l."cenario_id", l."unidade_negocio_id", l."vinculo", l."funcao_id", l."centro_custo_id"
                                 ORDER BY l."ordem", l."criado_em", l."id") AS "destino"
  FROM "cenarios_lotacao" l;

INSERT INTO "cenarios_lotacao_meses" ("linha_id", "mes", "colaboradores", "salario_bruto", "adicional")
SELECT d."destino", m."mes",
       sum(m."colaboradores"),
       CASE WHEN sum(m."colaboradores") <> 0 THEN sum(m."colaboradores" * m."salario_bruto") / sum(m."colaboradores") ELSE max(m."salario_bruto") END,
       CASE WHEN sum(m."colaboradores") <> 0 THEN sum(m."colaboradores" * m."adicional") / sum(m."colaboradores") ELSE max(m."adicional") END
  FROM "cenarios_lotacao_meses" m JOIN "linha_destino" d ON d."id" = m."linha_id"
 WHERE d."destino" IN (SELECT "destino" FROM "linha_destino" WHERE "id" <> "destino")
 GROUP BY d."destino", m."mes"
ON CONFLICT ("linha_id", "mes") DO UPDATE SET
  "colaboradores" = EXCLUDED."colaboradores",
  "salario_bruto" = EXCLUDED."salario_bruto",
  "adicional" = EXCLUDED."adicional";

-- Os meses das linhas que saem vão junto (onDelete: Cascade).
DELETE FROM "cenarios_lotacao" l USING "linha_destino" d WHERE l."id" = d."id" AND d."id" <> d."destino";
DROP TABLE "linha_destino";

-- 4. Sem a senioridade ----------------------------------------------------------------------------------------------------
-- DropForeignKey
ALTER TABLE "cenarios_lotacao" DROP CONSTRAINT "cenarios_lotacao_senioridade_id_fkey";
ALTER TABLE "colaboradores_carga_inicial" DROP CONSTRAINT "colaboradores_carga_inicial_senioridade_id_fkey";
ALTER TABLE "colaboradores_funcoes" DROP CONSTRAINT "colaboradores_funcoes_senioridade_id_fkey";
ALTER TABLE "colaboradores_movimentacoes" DROP CONSTRAINT "colaboradores_movimentacoes_senioridade_id_fkey";

-- DropIndex
DROP INDEX "colaboradores_funcoes_nome_senioridade_id_key";

-- AlterTable
ALTER TABLE "cenarios_lotacao" DROP COLUMN "senioridade_id";
ALTER TABLE "colaboradores_carga_inicial" DROP COLUMN "senioridade_id";
ALTER TABLE "colaboradores_funcoes" DROP COLUMN "senioridade_id";
ALTER TABLE "colaboradores_movimentacoes" DROP COLUMN "senioridade_id";

-- DropTable
DROP TABLE "colaboradores_senioridades";

-- CreateIndex
CREATE UNIQUE INDEX "colaboradores_funcoes_nome_key" ON "colaboradores_funcoes"("nome");

-- A aba Senioridades sai do catálogo dos perfis (com a permissão gravada, a tela Perfis recusaria gravar o perfil).
DELETE FROM "perfil_permissoes_telas" WHERE "chave" = 'colaboradores_cadastros.senioridades';
