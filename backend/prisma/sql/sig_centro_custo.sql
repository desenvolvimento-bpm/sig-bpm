-- =============================================================================
-- Tabela sig_centro_custo (espelho dos centros de custo do TOTVS RM, com o responsável)
-- Alimentada pela sincronização (src/services/totvs/centrosCustoSync.ts).
-- Contém nome e e-mail do responsável (pessoa física): acesso restrito (LGPD).
--
-- NÃO aplicar automaticamente. Rodar no banco só com aprovação.
-- =============================================================================

CREATE TABLE IF NOT EXISTS sig_centro_custo (
  codcoligada       INTEGER      NOT NULL,
  codccusto         TEXT         NOT NULL,
  nome              TEXT,
  ativo             INTEGER      NOT NULL,
  reccreatedon      TIMESTAMP(3),
  recmodifiedon     TIMESTAMP(3),
  responsavel       TEXT,
  nome_responsavel  TEXT,
  email_responsavel TEXT,
  sincronizado_em   TIMESTAMP(3) NOT NULL,
  PRIMARY KEY (codcoligada, codccusto)
);

CREATE INDEX IF NOT EXISTS sig_centro_custo_nome_idx ON sig_centro_custo (nome);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sig_centro_custo TO sig_dev;
