-- A aba Centros de Custo da tela Resultados dos cenários analíticos para todos os perfis que leem a tela (19/11/2026, pedido do
-- Adão: cada usuário vê só os grupos de centros do seu recorte); a 20261119100000 a tinha dado só a quem lia também a aba
-- Centros de Custo das Premissas.
INSERT INTO "perfil_permissoes_telas" ("perfil_id", "chave", "acao")
SELECT "perfil_id", 'cenarios_analiticos_resultados.centros', 'LER'
FROM "perfil_permissoes_telas"
WHERE "chave" = 'cenarios_analiticos_resultados' AND "acao" = 'LER'
ON CONFLICT DO NOTHING;
