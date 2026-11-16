-- A tela Acessos da Central de Conectividade (13/11/2026, pedido do Adão): a aba APIs (antes, a aba Acesso às APIs da tela
-- APIs). Quem tem a tela APIs ganha a aba, com a mesma permissão (Ler ou Editar).
INSERT INTO "perfil_permissoes_telas" ("perfil_id", "chave", "acao")
SELECT "perfil_id", 'conectividade_acessos.apis', "acao" FROM "perfil_permissoes_telas" WHERE "chave" = 'biblioteca_apis'
ON CONFLICT DO NOTHING;
