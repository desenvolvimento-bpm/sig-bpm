-- A aba Variações sai da tela Resultados e vai para o Painel de Bordo (18/11/2026, pedido do Adão): os perfis com a tela
-- Painel de Bordo recebem a aba, com as mesmas ações; a chave da aba em Resultados sai.
INSERT INTO "perfil_permissoes_telas" ("perfil_id", "chave", "acao")
SELECT "perfil_id", 'relatorio_painel.variacoes', "acao" FROM "perfil_permissoes_telas" WHERE "chave" = 'relatorio_painel'
ON CONFLICT DO NOTHING;

DELETE FROM "perfil_permissoes_telas" WHERE "chave" = 'relatorio_resultados.variacoes';
