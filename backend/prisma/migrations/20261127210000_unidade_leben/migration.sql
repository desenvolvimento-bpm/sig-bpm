-- A Leben (27/11/2026, pedido do Adão): a unidade 7, depois do RN, como uma cópia dele: as mesmas contas da Estrutura da DRE, com
-- os lançamentos manuais do balde LEBEN no realizado (Fechamento Mensal e Resultados Empresariais) e a tabela Leben da aba
-- Extra-Operacional das Premissas nos cenários analíticos. Nenhum valor gravado muda: a Leben começa vazia.

-- 0. O código 7 é da Leben: uma unidade criada antes com esse código (Cadastros Gerais / Unidades) para a migração.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "unidades_negocio" WHERE "codigo" = 7 AND "nome" <> 'Leben') THEN
    RAISE EXCEPTION 'Já existe uma unidade com o código 7 que não é a Leben; a migração da Leben parou sem mudar nada.';
  END IF;
END $$;

-- 1. A unidade, na última posição (depois do RN).
INSERT INTO "unidades_negocio" ("id", "codigo", "nome", "ordem", "ativo", "criado_em", "atualizado_em")
VALUES (gen_random_uuid()::text, 7, 'Leben', (SELECT COALESCE(MAX("ordem"), 0) + 1 FROM "unidades_negocio"), true, now(), now())
ON CONFLICT ("codigo") DO NOTHING;

-- 2. A Estrutura da DRE: as contas do RN também na Leben.
INSERT INTO "linhas_dre_unidades" ("linha_dre_id", "unidade_negocio_id")
SELECT lu."linha_dre_id", (SELECT "id" FROM "unidades_negocio" WHERE "codigo" = 7)
FROM "linhas_dre_unidades" lu
WHERE lu."unidade_negocio_id" = (SELECT "id" FROM "unidades_negocio" WHERE "codigo" = 5)
ON CONFLICT DO NOTHING;

-- 3. As cópias das unidades nos cenários (Configurações / Unidades): a Leben depois do RN, nos cenários que têm a cópia dele.
INSERT INTO "cenarios_unidades" ("id", "cenario_id", "unidade_negocio_id", "nome", "ordem", "ativo", "criado_em", "atualizado_em")
SELECT gen_random_uuid()::text, cu."cenario_id", (SELECT "id" FROM "unidades_negocio" WHERE "codigo" = 7), 'Leben',
       (SELECT COALESCE(MAX(o."ordem"), 0) + 1 FROM "cenarios_unidades" o WHERE o."cenario_id" = cu."cenario_id"), true, now(), now()
FROM "cenarios_unidades" cu
WHERE cu."unidade_negocio_id" = (SELECT "id" FROM "unidades_negocio" WHERE "codigo" = 5)
ON CONFLICT ("cenario_id", "unidade_negocio_id") DO NOTHING;

-- 4. As permissões: os perfis que leem (ou editam) a aba RN das telas com as abas das unidades recebem a aba Leben com a mesma
-- ação. A Conferência com a Planilha não tem a Leben (a planilha não tem a aba dela).
INSERT INTO "perfil_permissoes_telas" ("perfil_id", "chave", "acao")
SELECT "perfil_id", split_part("chave", '.', 1) || '.leben', "acao"
FROM "perfil_permissoes_telas"
WHERE "chave" IN ('dre.rn', 'relatorio_resultados.rn', 'cenarios_resultados.rn', 'cenarios_analiticos_resultados.rn')
ON CONFLICT DO NOTHING;
