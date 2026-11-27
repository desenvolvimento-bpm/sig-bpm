-- A separação de Despesas e Extra-Operacional (27/11/2026, pedido do Adão; um teste): a unidade 4 "Despesas e Extra" passa a
-- "Despesas" (DFO, DL, DT, DC e DA) e a nova unidade 6 "Extra-Operacional" fica com as contas de DML em diante (DML, NOPAT, RFC,
-- RFNC, DFC e DFNC). A regra da apuração é por conta (os lançamentos diretos de cada conta e, nas financeiras, o rateio de
-- acompanhamento inteiro), e nenhuma fórmula de total cruza os dois lados: os valores ficam os mesmos, só mudam de unidade.

-- 1. As unidades: a 4 com o nome novo; a 6 depois dela, antes do RN.
UPDATE "unidades_negocio" SET "nome" = 'Despesas', "atualizado_em" = now() WHERE "codigo" = 4 AND "nome" = 'Despesas e Extra';
INSERT INTO "unidades_negocio" ("id", "codigo", "nome", "ordem", "ativo", "criado_em", "atualizado_em")
VALUES (gen_random_uuid()::text, 6, 'Extra-Operacional', 5, true, now(), now())
ON CONFLICT ("codigo") DO NOTHING;
UPDATE "unidades_negocio" SET "ordem" = 6, "atualizado_em" = now() WHERE "codigo" = 5 AND "ordem" = 5;

-- As contas do Extra-Operacional (os grupos da DRE de DML em diante) e as duas unidades.
CREATE TEMP TABLE "sep_linhas" AS SELECT "id" FROM "linhas_dre" WHERE "grupo_sigla" IN ('DML', 'NOPAT', 'RFC', 'RFNC', 'DFC', 'DFNC');
CREATE TEMP TABLE "sep_unidades" AS
SELECT (SELECT "id" FROM "unidades_negocio" WHERE "codigo" = 4) AS "u4", (SELECT "id" FROM "unidades_negocio" WHERE "codigo" = 6) AS "u6";

-- 2. A Estrutura da DRE: as contas do Extra-Operacional saem da 4 e vão para a 6 (o RN, 5, continua).
UPDATE "linhas_dre_unidades" lu SET "unidade_negocio_id" = s."u6"
FROM "sep_unidades" s
WHERE lu."unidade_negocio_id" = s."u4" AND lu."linha_dre_id" IN (SELECT "id" FROM "sep_linhas");

-- 3. O departamento Extra-Operacional e os centros de custo dele (no cadastro e nas cópias dos cenários).
UPDATE "departamentos" d SET "unidade_negocio_id" = s."u6", "atualizado_em" = now()
FROM "sep_unidades" s
WHERE d."unidade_negocio_id" = s."u4" AND d."grupos_dre" && ARRAY['DML', 'RFC', 'RFNC', 'DFC', 'DFNC'];
UPDATE "cenarios_departamentos" d SET "unidade_negocio_id" = s."u6", "atualizado_em" = now()
FROM "sep_unidades" s
WHERE d."unidade_negocio_id" = s."u4" AND d."grupos_dre" && ARRAY['DML', 'RFC', 'RFNC', 'DFC', 'DFNC'];
UPDATE "centros_custo" c SET "unidade_negocio_id" = s."u6", "atualizado_em" = now()
FROM "sep_unidades" s
WHERE c."unidade_negocio_id" = s."u4" AND c."departamento_sigla" IN ('DML', 'RFC', 'RFNC', 'DFC', 'DFNC');
UPDATE "cenarios_centros_custo" c SET "unidade_negocio_id" = s."u6", "atualizado_em" = now()
FROM "sep_unidades" s
WHERE c."unidade_negocio_id" = s."u4" AND c."departamento_sigla" IN ('DML', 'RFC', 'RFNC', 'DFC', 'DFNC');

-- 4. As cópias das unidades nos cenários (Configurações / Unidades): o nome novo da 4 e a 6, antes do RN.
UPDATE "cenarios_unidades" cu SET "nome" = 'Despesas', "atualizado_em" = now()
FROM "sep_unidades" s
WHERE cu."unidade_negocio_id" = s."u4" AND cu."nome" = 'Despesas e Extra';
INSERT INTO "cenarios_unidades" ("id", "cenario_id", "unidade_negocio_id", "nome", "ordem", "ativo", "criado_em", "atualizado_em")
SELECT gen_random_uuid()::text, cu."cenario_id", s."u6", 'Extra-Operacional', 5, true, now(), now()
FROM "cenarios_unidades" cu CROSS JOIN "sep_unidades" s
WHERE cu."unidade_negocio_id" = s."u4"
ON CONFLICT ("cenario_id", "unidade_negocio_id") DO NOTHING;
UPDATE "cenarios_unidades" SET "ordem" = 6, "atualizado_em" = now()
WHERE "unidade_negocio_id" = (SELECT "id" FROM "unidades_negocio" WHERE "codigo" = 5) AND "ordem" = 5;

-- 5. Os valores apurados (também os das competências fechadas, congelados): os das contas do Extra-Operacional passam da 4
-- para a 6, com o mesmo valor; no Consolidado, a composição dessas contas cita a unidade nova, e a das despesas, o nome novo.
UPDATE "resultados_apurados" r SET "unidade_negocio_id" = s."u6"
FROM "sep_unidades" s
WHERE r."unidade_negocio_id" = s."u4" AND r."linha_dre_id" IN (SELECT "id" FROM "sep_linhas");
UPDATE "resultados_apurados" r SET "composicao" = (r."composicao"::jsonb || jsonb_build_object(
  'unidades', (
    SELECT jsonb_agg(CASE
      WHEN (e->>'unidade') = '4' AND r."linha_dre_id" IN (SELECT "id" FROM "sep_linhas") THEN e || '{"unidade": 6, "nome": "Extra-Operacional"}'::jsonb
      WHEN (e->>'unidade') = '4' THEN e || '{"nome": "Despesas"}'::jsonb
      ELSE e END)
    FROM jsonb_array_elements(r."composicao"::jsonb->'unidades') e
  )
))::json
WHERE r."unidade_negocio_id" IS NULL AND r."composicao" IS NOT NULL AND json_typeof(r."composicao"->'unidades') = 'array'
  AND r."composicao"::text LIKE '%"unidade":4%';

-- 6. Os cenários: a DRE (visão 4 → 6 nas contas do Extra-Operacional), as justificativas e as premissas da tabela Extra-Operacional
-- (a chave "4|conta" → "6|conta"; a Depreciação Base do patrimônio, "4|DA.D…", fica na 4).
UPDATE "cenarios_resultados" SET "visao" = 6 WHERE "visao" = 4 AND "linha_dre_id" IN (SELECT "id" FROM "sep_linhas");
UPDATE "cenarios_justificativas" SET "visao" = 6 WHERE "visao" = 4 AND "linha_dre_id" IN (SELECT "id" FROM "sep_linhas");
UPDATE "cenarios_premissas" p SET "unidade" = 6, "chave" = '6|' || split_part(p."chave", '|', 2)
WHERE p."unidade" = 4 AND p."venda" = 'EXTRA' AND p."chave" LIKE '4|%'
  AND split_part(p."chave", '|', 2) IN (SELECT "codigo" FROM "linhas_dre" WHERE "id" IN (SELECT "id" FROM "sep_linhas"));
UPDATE "cenarios_premissas_justificativas" j SET "chave" = 'X|6|' || split_part(j."chave", '|', 3)
WHERE j."chave" LIKE 'X|4|%' AND split_part(j."chave", '|', 3) IN (SELECT "codigo" FROM "linhas_dre" WHERE "id" IN (SELECT "id" FROM "sep_linhas"));

-- 7. As permissões: os perfis que leem (ou editam) a aba Despesas e Extra das telas com as abas das unidades recebem a aba
-- Extra-Operacional com a mesma ação. A Conferência com a Planilha continua com uma aba só (a da planilha, Desp.+Extra).
INSERT INTO "perfil_permissoes_telas" ("perfil_id", "chave", "acao")
SELECT "perfil_id", split_part("chave", '.', 1) || '.extra_operacional', "acao"
FROM "perfil_permissoes_telas"
WHERE "chave" IN ('dre.despesas', 'relatorio_resultados.despesas', 'cenarios_resultados.despesas', 'cenarios_analiticos_resultados.despesas')
ON CONFLICT DO NOTHING;

DROP TABLE "sep_linhas";
DROP TABLE "sep_unidades";
