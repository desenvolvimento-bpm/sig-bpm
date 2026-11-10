-- =============================================================================
-- Tabela sig_conta_contabil (espelho do plano de contas CCONTA do TOTVS RM)
-- Alimentada pela sincronização (src/services/totvs/contaContabilSync.ts).
--
-- NÃO aplicar automaticamente. Rodar no banco só com aprovação.
-- =============================================================================

CREATE TABLE IF NOT EXISTS sig_conta_contabil (
  codcoligada     INTEGER      NOT NULL,
  codconta        TEXT         NOT NULL,
  reduzido        TEXT,
  descricao       TEXT,
  sincronizado_em TIMESTAMP(3) NOT NULL,
  PRIMARY KEY (codcoligada, codconta)
);

CREATE INDEX IF NOT EXISTS sig_conta_contabil_descricao_idx ON sig_conta_contabil (descricao);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sig_conta_contabil TO sig_dev;
