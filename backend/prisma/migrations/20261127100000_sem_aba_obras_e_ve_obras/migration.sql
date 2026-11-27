-- A aba Obras sai da tela Resultados dos Resultados Empresariais (27/11/2026, pedido do Adão): as obras ficam no Realizado por
-- Obra, que não tem recorte (quem lê a tela a vê inteira). Sai também a opção "Vê os Resultados das Obras" do usuário, que
-- liberava a aba ao perfil com recorte por centro de custo.
DELETE FROM "perfil_permissoes_telas" WHERE "chave" = 'relatorio_resultados.obras';

ALTER TABLE "usuarios" DROP COLUMN "ve_obras";
