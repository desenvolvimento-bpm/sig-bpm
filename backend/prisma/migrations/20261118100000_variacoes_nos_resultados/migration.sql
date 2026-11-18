-- A aba Variações de Resultados Empresariais › Resultados (18/11/2026, pedido do Adão): os perfis com a tela Resultados
-- ganham a aba com as mesmas ações (Ler e Editar). Ela mostra só as unidades que o perfil lê, com os dados das abas delas.
INSERT INTO "perfil_permissoes_telas" ("perfil_id", "chave", "acao")
SELECT "perfil_id", 'relatorio_resultados.variacoes', "acao" FROM "perfil_permissoes_telas" WHERE "chave" = 'relatorio_resultados'
ON CONFLICT DO NOTHING;
