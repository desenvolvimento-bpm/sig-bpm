-- =============================================================================
-- Tabela sig_lancamentos_contabeis_rm (lançamentos contábeis do TOTVS RM Saldus)
-- Sentença BPM.CONTR.002, módulo C. Importada pelo botão Importar da tela de competências.
-- Cada importação substitui as linhas da competência (aaaa-mm).
--
-- NÃO aplicar automaticamente. Rodar no banco só com aprovação.
-- =============================================================================

CREATE TABLE IF NOT EXISTS sig_lancamentos_contabeis_rm (
  id                 SERIAL       PRIMARY KEY,
  competencia        CHAR(7)      NOT NULL,
  idmov              INTEGER,
  idprd              INTEGER,
  filial             INTEGER,
  cod_custo          TEXT,
  sub_cod_conta_4    TEXT,
  reduzido_conta     TEXT,
  cod_cli_forn       TEXT,
  emissao            DATE,
  historico          TEXT,
  sincronizado_em    TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS sig_lancamentos_contabeis_rm_competencia_idx ON sig_lancamentos_contabeis_rm (competencia);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sig_lancamentos_contabeis_rm TO sig_dev;
GRANT USAGE, SELECT ON SEQUENCE public.sig_lancamentos_contabeis_rm_id_seq TO sig_dev;
