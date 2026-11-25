-- Os indicadores e os cards pelo ID (25/11/2026, pedido do Adão: os nomes dos cadastros mudam a qualquer momento; passo 2 de
-- renomear os cadastros). Só dados: nenhuma tabela ou coluna muda.
--
-- 1) As fórmulas dos indicadores (a Metodologia e o Peso da Média ou a Fórmula do Acumulado) e dos cards do Painel de Bordo (a
--    Metodologia e o Percentual sob o Valor) passam a citar o indicador pelo ID: [IND|id], [META|id], [META|id|ACUM],
--    [INDICADOR|id] e [INDICADOR|id|ACUM]. O item com um nome que não é de nenhum indicador do cadastro fica como está.
-- 2) Os blocos dos Relatórios Executivos e dos Painéis de Bordo (em qualquer profundidade das páginas) ganham o indicadorId (o
--    card de um indicador, pelo nome) e o cardId (o card do Painel de Bordo, pela aba, o quadro, o título e a sigla; o ativo
--    antes do inativo). O bloco sem indicador ou card no cadastro fica como está. A versão dos relatórios e dos painéis não muda.

CREATE FUNCTION pg_temp.formula_pelo_id(f text, nome text, id text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(replace(replace(replace(replace(f,
    '[IND|' || nome || ']', '[IND|' || id || ']'),
    '[META|' || nome || ']', '[META|' || id || ']'),
    '[META|' || nome || '|ACUM]', '[META|' || id || '|ACUM]'),
    '[INDICADOR|' || nome || ']', '[INDICADOR|' || id || ']'),
    '[INDICADOR|' || nome || '|ACUM]', '[INDICADOR|' || id || '|ACUM]')
$$;

DO $$
DECLARE
  i record;
BEGIN
  FOR i IN SELECT "id", "nome" FROM "indicadores_estrutura" LOOP
    UPDATE "indicadores_estrutura"
      SET "formula" = pg_temp.formula_pelo_id("formula", i."nome", i."id"), "peso" = pg_temp.formula_pelo_id("peso", i."nome", i."id")
      WHERE strpos(coalesce("formula", ''), '|' || i."nome") > 0 OR strpos(coalesce("peso", ''), '|' || i."nome") > 0;
    UPDATE "painel_itens"
      SET "formula" = pg_temp.formula_pelo_id("formula", i."nome", i."id"), "percentual" = pg_temp.formula_pelo_id("percentual", i."nome", i."id")
      WHERE strpos("formula", '|' || i."nome") > 0 OR strpos(coalesce("percentual", ''), '|' || i."nome") > 0;
  END LOOP;
END
$$;

CREATE FUNCTION pg_temp.blocos_pelo_id(j jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  r jsonb := '{}'::jsonb;
  k text;
  v jsonb;
  achado text;
BEGIN
  IF jsonb_typeof(j) = 'array' THEN
    RETURN coalesce((SELECT jsonb_agg(pg_temp.blocos_pelo_id(e) ORDER BY n) FROM jsonb_array_elements(j) WITH ORDINALITY AS t(e, n)), '[]'::jsonb);
  END IF;
  IF jsonb_typeof(j) IS DISTINCT FROM 'object' THEN
    RETURN j;
  END IF;
  FOR k, v IN SELECT * FROM jsonb_each(j) LOOP
    r := r || jsonb_build_object(k, pg_temp.blocos_pelo_id(v));
  END LOOP;
  IF r ->> 'tipo' = 'INDICADOR' AND NOT (r ? 'indicadorId') THEN
    SELECT "id" INTO achado FROM "indicadores_estrutura" WHERE "nome" = r ->> 'nome';
    IF achado IS NOT NULL THEN
      r := r || jsonb_build_object('indicadorId', achado);
    END IF;
  ELSIF r ->> 'tipo' = 'PAINEL' AND NOT (r ? 'cardId') THEN
    SELECT "id" INTO achado FROM "painel_itens"
      WHERE lower("grupo") = r ->> 'aba' AND "quadro" = r ->> 'quadro' AND "nome" = r ->> 'titulo' AND "sigla" = r ->> 'sigla'
      ORDER BY "ativo" DESC, "ordem", "criado_em"
      LIMIT 1;
    IF achado IS NOT NULL THEN
      r := r || jsonb_build_object('cardId', achado);
    END IF;
  END IF;
  RETURN r;
END
$$;

UPDATE "relatorios_executivos_abas" AS a
  SET "blocos" = x.novo::json
  FROM (SELECT "relatorio_id", "departamento", pg_temp.blocos_pelo_id("blocos"::jsonb) AS novo, "blocos"::jsonb AS antes FROM "relatorios_executivos_abas") AS x
  WHERE a."relatorio_id" = x."relatorio_id" AND a."departamento" = x."departamento" AND x.novo IS DISTINCT FROM x.antes;

UPDATE "paineis_de_bordo" AS p
  SET "paginas" = x.novo::json
  FROM (SELECT "id", pg_temp.blocos_pelo_id("paginas"::jsonb) AS novo, "paginas"::jsonb AS antes FROM "paineis_de_bordo") AS x
  WHERE p."id" = x."id" AND x.novo IS DISTINCT FROM x.antes;

DROP FUNCTION pg_temp.blocos_pelo_id(jsonb);
DROP FUNCTION pg_temp.formula_pelo_id(text, text, text);
