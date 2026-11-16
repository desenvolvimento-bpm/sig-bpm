-- =============================================================================
-- Tabela sig_fornecedor (espelho dos fornecedores/FCFO do TOTVS RM)
-- Alimentada pela sincronização (src/services/totvs/fornecedoresSync.ts).
--
-- NÃO aplicar automaticamente. Rodar no banco só com aprovação, e antes
-- conferir se a tabela já não existe.
-- =============================================================================

CREATE TABLE IF NOT EXISTS sig_fornecedor (
  codcoligada     INTEGER      NOT NULL,
  codcfo          TEXT         NOT NULL,
  nome_fantasia   TEXT,
  pagrec          INTEGER,
  ativo           INTEGER      NOT NULL,
  idcfo           INTEGER,
  cgccfo          TEXT,
  sincronizado_em TIMESTAMP(3) NOT NULL,
  PRIMARY KEY (codcoligada, codcfo)
);

CREATE INDEX IF NOT EXISTS sig_fornecedor_nome_fantasia_idx ON sig_fornecedor (nome_fantasia);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sig_fornecedor TO sig_dev;
