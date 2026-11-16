-- =============================================================================
-- Lançamentos de UM centro de custo, todos os meses, com as contestações aplicadas.
-- SOMENTE LEITURA: não altera nada. Rodar com um usuário só de leitura.
--
-- Trocar o código do centro (ex.: '1.96.00000012') em :centro, na última linha do WHERE.
-- Regra usada (a mesma da classificação): a contestação ACATADA ou VALIDADA troca o
-- centro (centro_novo) e a conta (conta_nova); RECUSADA e PENDENTE não contam.
-- =============================================================================

WITH contestacao_aplicada AS (
  -- Uma contestação por lançamento: a mais recente que foi acatada ou validada.
  SELECT DISTINCT ON (c.lancamento_contabil_id)
         c.lancamento_contabil_id,
         c.centro_novo_id,
         c.conta_nova_id
  FROM contestacoes c
  WHERE c.lancamento_contabil_id IS NOT NULL
    AND c.situacao IN ('ACATADA', 'VALIDADA')
  ORDER BY c.lancamento_contabil_id, c.solicitada_em DESC
)
SELECT
  comp.ano,
  comp.mes,
  l.filial,
  COALESCE(cen_novo.codigo_rm, cen_orig.codigo_rm, l.codigo_centro_custo) AS centro_codigo,
  COALESCE(cen_novo.nome_rm, cen_orig.nome_rm, l.nome_centro_custo)       AS centro_nome,
  ca.reduzido                                                             AS conta_reduzida,
  ca.conta                                                                AS conta_codigo,
  ca.descricao                                                            AS conta_descricao,
  ld.grupo                                                                AS linha_dre_grupo,
  ld.descricao                                                            AS linha_dre_descricao,
  l.balde,
  l.valor_movimento                                                       AS valor,
  (ct.lancamento_contabil_id IS NOT NULL)                                 AS contestado,
  l.emissao,
  l.cli_forn,
  l.historico,
  l.validacao,
  l.linha_arquivo
FROM lancamentos_contabeis l
JOIN competencias comp
  ON comp.id = l.competencia_id
LEFT JOIN contestacao_aplicada ct
  ON ct.lancamento_contabil_id = l.id
LEFT JOIN centros_custo cen_orig
  ON cen_orig.id = l.centro_custo_id
LEFT JOIN centros_custo cen_novo
  ON cen_novo.id = ct.centro_novo_id
-- A conta efetiva: a da contestação, depois a conta adotada pela classificação, depois a do balancete.
JOIN contas_resultado ca
  ON ca.id = COALESCE(ct.conta_nova_id, l.conta_adotada_id, l.conta_resultado_id)
LEFT JOIN linhas_dre ld
  ON ld.id = ca.linha_dre_id
WHERE COALESCE(cen_novo.codigo_rm, cen_orig.codigo_rm, l.codigo_centro_custo) = ':centro'
  -- Para só as despesas, descomente e ajuste o grupo conforme a DRE (ex.: 'CPP', 'DESP'):
  -- AND ld.grupo_sigla IN ('CPP', 'DESP')
ORDER BY comp.ano, comp.mes, l.emissao, l.id;
