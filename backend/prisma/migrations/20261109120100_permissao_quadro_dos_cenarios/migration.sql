-- A aba Quadro de Lotação das Premissas dos cenários analíticos (09/11/2026, etapa 4 da Gestão de Colaboradores): os
-- perfis com a aba Centros de Custo ganham a mesma permissão (Ler, Editar) na aba nova.
INSERT INTO "perfil_permissoes_telas" ("perfil_id", "chave", "acao")
SELECT "perfil_id", 'cenarios_analiticos_premissas.quadro', "acao"
FROM "perfil_permissoes_telas"
WHERE "chave" = 'cenarios_analiticos_premissas.centros'
ON CONFLICT DO NOTHING;
