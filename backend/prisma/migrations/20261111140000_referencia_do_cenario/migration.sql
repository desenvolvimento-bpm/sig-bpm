-- A referência carregada no cenário analítico (11/11/2026): o realizado (o ano e os meses) ou o cenário de origem.

-- AlterTable
ALTER TABLE "cenarios" ADD COLUMN     "referencia_detalhe" JSON;
