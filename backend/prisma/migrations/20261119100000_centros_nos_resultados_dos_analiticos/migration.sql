-- A aba Centros de Custo da tela Resultados dos cenários analíticos (19/11/2026, pedido do Adão): os perfis que leem a tela e a
-- aba Centros de Custo das Premissas (a DRE de cada grupo mostra os gastos dele, como as Premissas) recebem a leitura da aba.
INSERT INTO "perfil_permissoes_telas" ("perfil_id", "chave", "acao")
SELECT r."perfil_id", 'cenarios_analiticos_resultados.centros', 'LER'
FROM "perfil_permissoes_telas" r
WHERE r."chave" = 'cenarios_analiticos_resultados' AND r."acao" = 'LER'
  AND EXISTS (
    SELECT 1 FROM "perfil_permissoes_telas" p
    WHERE p."perfil_id" = r."perfil_id" AND p."chave" = 'cenarios_analiticos_premissas.centros' AND p."acao" = 'LER'
  )
ON CONFLICT DO NOTHING;
