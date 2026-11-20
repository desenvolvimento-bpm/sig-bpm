-- Cadastros por cenário, etapa 2 (20/11/2026): a exclusão de um cenário analítico apaga as cópias em cascata, sem ordem
-- garantida entre elas (os centros podem sair antes das redistribuições). O destino sai com o centro (CASCADE) e a redistribuição
-- fica com Todos os departamentos se o dela sair (SET NULL); no app, o centro e o departamento usados numa redistribuição não se
-- excluem.
ALTER TABLE "cenarios_redistribuicoes" DROP CONSTRAINT "cenarios_redistribuicoes_departamento_id_fkey";

ALTER TABLE "cenarios_redistribuicoes_destinos" DROP CONSTRAINT "cenarios_redistribuicoes_destinos_centro_custo_id_fkey";

ALTER TABLE "cenarios_redistribuicoes" ADD CONSTRAINT "cenarios_redistribuicoes_departamento_id_fkey" FOREIGN KEY ("departamento_id") REFERENCES "cenarios_departamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "cenarios_redistribuicoes_destinos" ADD CONSTRAINT "cenarios_redistribuicoes_destinos_centro_custo_id_fkey" FOREIGN KEY ("centro_custo_id") REFERENCES "cenarios_centros_custo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

