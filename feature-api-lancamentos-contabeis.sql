-- Branch: feature/api-lancamentos-contabeis
-- Banco: sig_bpm_dev

-- =============================================================================
-- PRODUÇÃO — rodar antes de subir esta branch (ordem: 1)
-- =============================================================================

-- 1) Tabela sig_fornecedor (espelho dos fornecedores/FCFO do TOTVS RM).
--    Idempotente: pode rodar mais de uma vez sem erro.
BEGIN;

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

COMMIT;

-- Conferência (deve retornar 8 linhas):
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name = 'sig_fornecedor' ORDER BY ordinal_position;

-- 2) Tabela sig_centro_custo (espelho dos centros de custo do TOTVS RM, com o responsável).
--    Contém nome e e-mail de pessoa física (LGPD): acesso restrito.
--    Idempotente: pode rodar mais de uma vez sem erro.
BEGIN;

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

COMMIT;

-- Conferência (deve retornar 10 linhas):
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name = 'sig_centro_custo' ORDER BY ordinal_position;

-- 3) Tabela sig_conta_contabil (espelho do plano de contas CCONTA do TOTVS RM).
--    Idempotente: pode rodar mais de uma vez sem erro.
BEGIN;

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

COMMIT;

-- Conferência (deve retornar 5 linhas):
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name = 'sig_conta_contabil' ORDER BY ordinal_position;

-- 4) Tabela sig_lancamentos_contabeis_rm (lançamentos do TOTVS RM Saldus, sentença BPM.CONTR.002).
--    Cada importação substitui as linhas da competência. Idempotente: pode rodar mais de uma vez sem erro.
BEGIN;

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

COMMIT;

-- Conferência (deve retornar 11 linhas):
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name = 'sig_lancamentos_contabeis_rm' ORDER BY ordinal_position;

-- 5) Tabela sig_produto (espelho dos produtos do TOTVS RM, sentença BPM.TI.RetPRD).
--    Idempotente: pode rodar mais de uma vez sem erro.
BEGIN;

CREATE TABLE IF NOT EXISTS sig_produto (
  codcoligada               INTEGER      NOT NULL,
  idprd                     INTEGER      NOT NULL,
  codcolprd                 INTEGER,
  nome_fantasia             TEXT,
  codigoprd                 TEXT         NOT NULL,
  inativo                   INTEGER      NOT NULL,
  codigoreduzido            TEXT,
  ultimonivel               INTEGER      NOT NULL,
  tipo                      CHAR(1),
  codigoauxiliar            TEXT,
  idclassifbensservico      TEXT,
  codundcontrole            TEXT,
  codundcompra              TEXT,
  codundvenda               TEXT,
  codtb1fat                 TEXT,
  codtborcamento            TEXT,
  codcoltborcamento         TEXT,
  codtborcamentoreceita     TEXT,
  codcoltborcamentoreceita  TEXT,
  integra_manutencao        INTEGER,
  codtrf                    TEXT,
  volume                    TEXT,
  imagem                    TEXT,
  usuario_criacao_totvs     TEXT,
  dtcadastramento           TIMESTAMP(3),
  sincronizado_em           TIMESTAMP(3) NOT NULL,
  PRIMARY KEY (codcoligada, idprd)
);

CREATE INDEX IF NOT EXISTS sig_produto_codigoprd_idx ON sig_produto (codcoligada, codigoprd);
CREATE INDEX IF NOT EXISTS sig_produto_codigoreduzido_idx ON sig_produto (codcoligada, codigoreduzido);
CREATE INDEX IF NOT EXISTS sig_produto_nome_idx ON sig_produto (codcoligada, nome_fantasia);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sig_produto TO sig_dev;

COMMIT;
