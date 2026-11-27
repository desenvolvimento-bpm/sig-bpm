-- A aba Custos Operacionais da tela Resultados (26/11/2026, pedido do Adão), logo depois das unidades, em Resultados Empresariais e
-- nos Cenários Sintéticos e Analíticos: os custos de produção (Matriz e Filial) e de serviços em R$/dia e em R$/m³, por trimestre.
-- Os perfis que leem as abas Matriz, Filial e Serviços da tela recebem a leitura dela (os valores vêm dessas três unidades).
INSERT INTO "perfil_permissoes_telas" ("perfil_id", "chave", "acao")
SELECT m."perfil_id", t."tela" || '.custos_operacionais', 'LER'
FROM (VALUES ('relatorio_resultados'), ('cenarios_resultados'), ('cenarios_analiticos_resultados')) AS t("tela")
JOIN "perfil_permissoes_telas" m ON m."chave" = t."tela" || '.matriz' AND m."acao" = 'LER'
WHERE EXISTS (
  SELECT 1 FROM "perfil_permissoes_telas" f
  WHERE f."perfil_id" = m."perfil_id" AND f."chave" = t."tela" || '.filial' AND f."acao" = 'LER'
)
AND EXISTS (
  SELECT 1 FROM "perfil_permissoes_telas" s
  WHERE s."perfil_id" = m."perfil_id" AND s."chave" = t."tela" || '.servicos' AND s."acao" = 'LER'
)
ON CONFLICT DO NOTHING;
