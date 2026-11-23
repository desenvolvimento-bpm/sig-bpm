-- A aba Departamentos da tela Resultados dos Resultados Empresariais e dos cenários analíticos (23/11/2026, pedido do Adão), antes
-- de Centros de Custo: o Consolidado com os departamentos abertos pelos centros de custo. Os perfis que leem as abas Consolidado e
-- Centros de Custo da tela recebem a leitura dela (cada usuário vê só os centros do seu recorte).
INSERT INTO "perfil_permissoes_telas" ("perfil_id", "chave", "acao")
SELECT c."perfil_id", t."tela" || '.departamentos', 'LER'
FROM (VALUES ('relatorio_resultados'), ('cenarios_analiticos_resultados')) AS t("tela")
JOIN "perfil_permissoes_telas" c ON c."chave" = t."tela" || '.consolidado' AND c."acao" = 'LER'
WHERE EXISTS (
  SELECT 1 FROM "perfil_permissoes_telas" x
  WHERE x."perfil_id" = c."perfil_id" AND x."chave" = t."tela" || '.centros' AND x."acao" = 'LER'
)
ON CONFLICT DO NOTHING;
