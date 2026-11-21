-- As Verificações das Premissas dos cenários analíticos (20/11/2026, pedido do Adão): os De Acordo das inconsistências (quem
-- alterou os valores por último confirma que estão certos) e a aba Verificações, que os perfis com alguma aba das Premissas
-- herdam (Ler de quem lê alguma; Editar, o De Acordo, de quem edita alguma).

-- CreateTable
CREATE TABLE "cenarios_verificacoes_acordos" (
    "cenario_id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "assinatura" TEXT NOT NULL,
    "usuario_id" TEXT,
    "usuario_nome" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cenarios_verificacoes_acordos_pkey" PRIMARY KEY ("cenario_id","chave")
);

-- AddForeignKey
ALTER TABLE "cenarios_verificacoes_acordos" ADD CONSTRAINT "cenarios_verificacoes_acordos_cenario_id_fkey" FOREIGN KEY ("cenario_id") REFERENCES "cenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A permissão da aba nova.
INSERT INTO "perfil_permissoes_telas" ("perfil_id", "chave", "acao")
SELECT DISTINCT "perfil_id", 'cenarios_analiticos_premissas.verificacoes', "acao"
FROM "perfil_permissoes_telas"
WHERE "chave" LIKE 'cenarios_analiticos_premissas.%'
ON CONFLICT DO NOTHING;
