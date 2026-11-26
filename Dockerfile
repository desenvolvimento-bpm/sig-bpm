# SIG BPM — imagem única (backend Express + frontend Next.js), usada pelos serviços do docker-compose.yml.
# Construída pelos workflows de deploy (.github/workflows/deploy-*.yml) no runner do srv-docker.
FROM node:24-bookworm-slim

# Ferramentas para compilar o better-sqlite3 caso o binário pronto não baixe
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1) Dependências. Só o schema.prisma entra antes do npm ci (o postinstall gera o cliente do Prisma): migração nova
#    sozinha não invalida o cache das dependências.
COPY package.json package-lock.json .npmrc ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
COPY backend/prisma/schema.prisma backend/prisma/
COPY backend/prisma.config.ts backend/
RUN npm ci

# O package-lock é gerado no Windows e só traz os binários win32 do lightningcss e do tailwind oxide.
# Baixa os de Linux na mesma versão instalada.
RUN set -e; cd /tmp; \
    LCSS=$(node -p "require('/app/frontend/node_modules/lightningcss/package.json').version"); \
    OXIDE=$(node -p "require('/app/frontend/node_modules/@tailwindcss/oxide/package.json').version"); \
    npm pack lightningcss-linux-x64-gnu@$LCSS @tailwindcss/oxide-linux-x64-gnu@$OXIDE; \
    mkdir -p /app/node_modules/lightningcss-linux-x64-gnu /app/node_modules/@tailwindcss/oxide-linux-x64-gnu; \
    tar xzf lightningcss-linux-x64-gnu-$LCSS.tgz -C /app/node_modules/lightningcss-linux-x64-gnu --strip-components=1; \
    tar xzf tailwindcss-oxide-linux-x64-gnu-$OXIDE.tgz -C /app/node_modules/@tailwindcss/oxide-linux-x64-gnu --strip-components=1; \
    rm -f /tmp/*.tgz

# 2) Código e build de produção (o limite de memória evita travar o servidor durante o build do Next)
COPY . .
ARG BACKEND_URL=http://backend:3001
ENV BACKEND_URL=${BACKEND_URL}
RUN export NODE_OPTIONS=--max-old-space-size=3072 \
 && npm run db:generate -w backend \
 && npm run build \
 && rm -rf frontend/.next/cache

ENV NODE_ENV=production
