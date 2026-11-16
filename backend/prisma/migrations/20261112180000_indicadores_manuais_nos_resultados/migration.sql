-- Os Indicadores Manuais dos cenários sintéticos passam da tela Configurações para a tela Resultados (12/11/2026): os perfis
-- com a aba nas Configurações ganham a mesma permissão (Ler, Editar) na aba da tela Resultados, com a leitura da tela, e a
-- permissão antiga sai.
INSERT INTO "perfil_permissoes_telas" ("perfil_id", "chave", "acao")
SELECT "perfil_id", 'cenarios_resultados.manuais', "acao"
FROM "perfil_permissoes_telas"
WHERE "chave" = 'cenarios_configuracoes.manuais'
ON CONFLICT DO NOTHING;

INSERT INTO "perfil_permissoes_telas" ("perfil_id", "chave", "acao")
SELECT DISTINCT "perfil_id", 'cenarios_resultados', 'LER'::"AcaoPermissao"
FROM "perfil_permissoes_telas"
WHERE "chave" = 'cenarios_configuracoes.manuais'
ON CONFLICT DO NOTHING;

DELETE FROM "perfil_permissoes_telas" WHERE "chave" = 'cenarios_configuracoes.manuais';
