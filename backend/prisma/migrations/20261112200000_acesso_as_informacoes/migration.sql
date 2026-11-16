-- O Acesso às Informações dos cenários analíticos (12/11/2026): Geral (o padrão) ou Por Recorte; o departamento dos
-- investimentos de Despesas e Extra e o alcance das alterações do histórico.
CREATE TYPE "AcessoInformacoesCenario" AS ENUM ('GERAL', 'POR_RECORTE');
ALTER TABLE "cenarios" ADD COLUMN "acesso_informacoes" "AcessoInformacoesCenario" NOT NULL DEFAULT 'GERAL';
ALTER TABLE "cenarios_investimentos" ADD COLUMN "departamento" "DepartamentoAcesso";
ALTER TABLE "cenarios_reajustes" ADD COLUMN "alcance" JSON;

-- A aba Reajustes dos analíticos passa das Premissas para as Configurações: os perfis com a aba nas Premissas ganham a
-- mesma permissão (Ler, Editar) na aba das Configurações, com a leitura da tela, e a permissão antiga sai.
INSERT INTO "perfil_permissoes_telas" ("perfil_id", "chave", "acao")
SELECT "perfil_id", 'cenarios_analiticos_configuracoes.reajustes', "acao"
FROM "perfil_permissoes_telas"
WHERE "chave" = 'cenarios_analiticos_premissas.reajustes'
ON CONFLICT DO NOTHING;

INSERT INTO "perfil_permissoes_telas" ("perfil_id", "chave", "acao")
SELECT DISTINCT "perfil_id", 'cenarios_analiticos_configuracoes', 'LER'::"AcaoPermissao"
FROM "perfil_permissoes_telas"
WHERE "chave" = 'cenarios_analiticos_premissas.reajustes'
ON CONFLICT DO NOTHING;

DELETE FROM "perfil_permissoes_telas" WHERE "chave" = 'cenarios_analiticos_premissas.reajustes';
