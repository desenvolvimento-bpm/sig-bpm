-- A Demanda Diária sem Média de Referência nas linhas de Serviços por dia útil (19/11/2026, pedido do Adão): a referência
-- realizada não a grava mais (antes, 1), para os botões Replicar Médias e Replicar Referências não a levarem aos meses, que
-- recebem a demanda das vendas na unidade da linha. A que ficou gravada nos cenários analíticos sai: a Média de Referência
-- (o mês 0) igual a 1 das linhas de Serviços sem volume nas listas do realizado (todas menos a Montagem, em m³, e a linha
-- em kg, a Metálica).
DELETE FROM "cenarios_premissas" p
WHERE p."unidade" = 3
  AND p."mes" = 0
  AND p."chave" LIKE 'DEMANDA:%'
  AND p."valor" = 1
  AND NOT EXISTS (
    SELECT 1 FROM "linhas" l
    WHERE 'DEMANDA:' || l."codigo" = p."chave"
      AND (l."unidade_medida" = 'kg' OR (l."codigo" = 'MONTAGEM' AND l."unidade_medida" = 'm³'))
  );
