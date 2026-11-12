-- A Edição das Configurações dos cenários (12/11/2026): Particular (o padrão: só quem criou e o Administrador) ou Pública.
ALTER TABLE "cenarios" ADD COLUMN "edicao_configuracoes" "VisualizacaoCenario" NOT NULL DEFAULT 'PARTICULAR';
