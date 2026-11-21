-- O compartilhamento dos cenários particulares (21/11/2026, pedido do Adão): os usuários convidados a ver o cenário.
ALTER TABLE "cenarios" ADD COLUMN "compartilhamentos" JSONB;
