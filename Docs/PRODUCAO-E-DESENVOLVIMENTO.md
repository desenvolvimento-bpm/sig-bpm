# Produção e Desenvolvimento

> **Desde 23/10/2026, a produção é http://192.168.0.16:3020 (PostgreSQL `sig_bpm`, pasta `/root/dados/sig-bpm-pg`).**
> A 3010 (SQLite) saiu do ar.
> - **Publicar:** o deploy automático acompanha a branch **`postgres`**, então publicar é enviar a `postgres` ao GitHub
>   (só com o "publique" do Adão).
> - **Back-ups:** o deploy faz um back-up do banco por `pg_dump` em `dados/backups/` antes de cada publicação. Há também
>   um back-up diário às 2h em `dados/backups/diario`, que guarda os 15 últimos.
> - **A `master` e a 3010:** não se usam por enquanto. O merge na `master` e a volta ao endereço 3010 ficam para depois,
>   feitos juntos com o TI.
>
> Abaixo, onde se lê 3010, `/root/dados/sig-bpm` ou `master`, leia 3020, `/root/dados/sig-bpm-pg` e `postgres`.

> **Desde 20/10/2026, a produção é o servidor da empresa** (`srv-docker`, http://192.168.0.16:3010), com deploy
> automático a cada envio à `master` do GitHub. **Publicar = enviar à `master`.** O notebook é só desenvolvimento: a
> produção antiga dele (portas 3000/3001, `backend/prisma/dev.db`) foi desligada e não deve voltar a ser usada como
> produção. As regras do servidor (o que pode e o que não pode, scripts de dados, back-up) estão em
> [SERVIDOR-DA-EMPRESA.md](./SERVIDOR-DA-EMPRESA.md). A tabela e os comandos de produção abaixo são histórico (15 a 20/10/2026).

## PostgreSQL (desde 23/10/2026, na branch `postgres`)

A migração do SQLite para o PostgreSQL, conduzida pelo TI (Eduardo Domingos), está em andamento. O banco fica no servidor
de banco da empresa, **192.168.0.40:5432** (PostgreSQL 15, ordenação `C`, igual à do SQLite):

| Banco | Usuário | Uso |
|---|---|---|
| `sig_bpm` | `sig_prod` | A produção, depois da virada. **Nunca usar no desenvolvimento.** |
| `sig_bpm_dev` | `sig_dev` | O desenvolvimento (porta 3100) |
| `sig_bpm_dev_sombra` | `sig_dev` | O banco-sombra do `prisma migrate dev` (descartável) |

- O código do PostgreSQL está na branch `postgres` e só vai à `master` na virada combinada com o TI (a `master` publica
  direto na produção, que segue no SQLite até lá).
- As URLs ficam no `backend/.env.development` (`DATABASE_URL` e `SHADOW_DATABASE_URL`), nunca no git; o modelo está no
  `backend/.env.example`. Para voltar a rodar a `master` (SQLite) no notebook: `DATABASE_URL=file:./prisma/desenvolvimento.db`.
- Migrações: as do SQLite ficaram em `backend/prisma/migrations-sqlite` (histórico); a inicial do PostgreSQL é a
  `backend/prisma/migrations/0_init` (o schema e, no fim, os gatilhos que deixam o `audit_log` imutável). No
  `sig_bpm_dev`, as tabelas foram criadas pelo TI e a `0_init` só foi registrada (`npx prisma migrate resolve --applied
  0_init`): não rodar `migrate deploy` nele. Para recarregar o `sig_bpm_dev` com a produção, pedir ao TI.
- O sinal da publicação (`.publicacao-em-andamento`) não vem mais da pasta do banco: vale a `PASTA_DO_SINAL` do .env ou,
  sem ela, `/dados` (a pasta do container no servidor, onde o `deploy.sh` o liga e desliga).
- `db:backup` e `db:copiar-producao` passam a usar o `pg_dump` e o `pg_restore` (versão 15 ou mais nova, no PATH ou em
  `PG_DUMP`/`PG_RESTORE`).
- O plano completo (fases, riscos e como voltar atrás) é o PLANO-MIGRACAO-POSTGRES.md do TI.

### O desenvolvimento e o teste no notebook (desde 13/11/2026)

Para trabalhar sem a VPN (pedido do Adão; o TI dispensou a criptografia do disco), o desenvolvimento e o teste usam um
PostgreSQL 15 no próprio notebook: o serviço do Windows `postgresql-x64-15` (instalador da EDB, início automático, porta
5432), com o banco `sig_bpm_dev` (esquemas `public` e `teste`) e o `sig_bpm_dev_sombra`, criados em UTF8 com a ordenação
`C`, do usuário `sig_local`. As senhas (`postgres` e `sig_local`) ficam no `backend/.env.postgres.local`, fora do git. A
carga foi um `pg_dump` do `sig_bpm_dev` do 192.168.0.40 (sem as tabelas `sig_*` da integração do RM, que não são do SIG),
conferida tabela a tabela. As linhas antigas do `DATABASE_URL` e do `SHADOW_DATABASE_URL` ficam comentadas no
`backend/.env.development` e no `backend/.env.teste`, para voltar ao servidor. Continuam precisando da rede da empresa (ou
da VPN): a cópia da produção para o teste, acompanhar o deploy e qualquer script no srv-docker. O banco do notebook não
entra nos back-ups do TI.

## Os três ambientes (desde 21/10/2026)

| | Desenvolvimento | Teste | Produção |
|---|---|---|---|
| Para quê | Fazer as alterações, com o Turbopack | Conferir as alterações já compiladas (as telas abrem em menos de 1 s) | O uso no dia a dia |
| Endereço | http://localhost:3100 | http://localhost:3200 | http://192.168.0.16:3020 |
| Backend | porta 3101 (nodemon) | porta 3201 (`backend/dist`) | o container `sig-bpm-pg-backend` |
| Banco | `sig_bpm_dev` (no notebook), esquema `public` | `sig_bpm_dev` (no notebook), esquema `teste` (uma cópia da produção) | `sig_bpm`, no servidor |
| Iniciar | `npm run dev` | `npm run teste:construir` (gera, ~1,5 min) e `npm run teste` | o deploy automático da `postgres` |
| Marca | borda e etiqueta vermelhas (Desenvolvimento) | borda e etiqueta laranja (Teste) | nenhuma |
| Cookie da sessão | `bpm_token_dev` | `bpm_token_teste` | `bpm_token` |

- O teste mostra o código do último `npm run teste:construir`: depois de uma alteração, gerar de novo (parar o teste antes) e
  iniciar.
- Por padrão (pedido do Adão, 04/11/2026), toda alteração feita no desenvolvimento vai também para o teste logo em seguida,
  sem precisar pedir. Isso vale também para as cargas de dados. A ordem: as migrações no esquema `teste`; parar o teste;
  `npm run teste:construir`; e `npm run teste`. Atualizar o teste não é publicar, nem copiar de novo os dados da produção.
- O `npm run teste:construir` confere os tipos antes de gerar (`npx tsc --noEmit` no backend e no frontend), porque o build
  das telas não os verifica. Com erro, ele para sem gerar nada, e a versão de teste de antes continua. Isso evita gerar o
  teste com um arquivo pela metade, de outra sessão editando a mesma pasta.
- O teste tem os dados da produção: o esquema `teste` do banco do desenvolvimento, com uma cópia do banco da produção
  (o back-up lógico, só de leitura), e a pasta `backend/uploads-teste`, com uma cópia dos arquivos enviados ao SIG. O que
  se grava no teste não chega à produção nem ao desenvolvimento, e a cópia não se atualiza sozinha. O login é o da
  produção (as mesmas senhas).
- O backend do teste lê o `backend/.env.teste` (fora do git): `NODE_ENV=production`, `PORT=3201`,
  `DATABASE_URL=postgresql://…/sig_bpm_dev?schema=teste` (o backend usa o esquema do parâmetro `schema`, como o
  `prisma migrate`), `UPLOAD_DIR=./uploads-teste`, `CORS_ORIGIN=http://localhost:3200`, `ENABLE_SWAGGER=false`; o segredo
  do JWT vem do `.env` comum. As migrações do esquema teste: `npx prisma migrate deploy` com esse `DATABASE_URL` no
  ambiente. As telas do teste falam com o backend 3201 (o `scripts/teste.mjs` passa o `BACKEND_URL`) e recebem a
  etiqueta pela compilação (`NEXT_PUBLIC_AMBIENTE=teste`).
- A compilação do teste fica em `frontend/.next` (a do desenvolvimento, em `frontend/.next/dev`): as duas convivem.

De 15 a 20/10/2026 a ferramenta rodou no notebook em dois ambientes separados, com bancos separados.

| | Produção | Desenvolvimento |
|---|---|---|
| Para quê | O uso no dia a dia, por todos os usuários | Conferir as alterações antes de publicar |
| Endereço | http://localhost:3000 (na rede: http://IP-do-computador:3000) | http://localhost:3100 |
| Backend | porta 3001 | porta 3101 (Swagger em http://localhost:3101/api/docs) |
| Banco | `backend/prisma/dev.db` (o banco real) | `backend/prisma/desenvolvimento.db` (cópia do real) |
| Iniciar | `npm run producao` (na pasta `sig-bpm`) | `npm run dev` (na pasta `sig-bpm`) |
| Telas | Já compiladas: abrem em menos de 1 s | Compiladas ao abrir (Turbopack): a primeira vez demora alguns segundos |
| Cookie da sessão | `bpm_token` | `bpm_token_dev` (os dois ambientes não derrubam a sessão um do outro) |

> O nome `dev.db` do banco real é histórico. Trocar o nome fica para a migração ao servidor, quando o banco mudar de
> lugar de qualquer jeito.

## Configuração

O backend lê dois arquivos: primeiro o do ambiente (`.env.development` ou `.env.production`), depois o `.env` comum. O
que vem antes vale. **Sem `NODE_ENV`, o ambiente é o de desenvolvimento**, inclusive nos comandos do Prisma: um comando
esquecido cai na cópia, nunca no banco real.

| Arquivo | Conteúdo |
|---|---|
| `backend/.env` | Comum: `JWT_SECRET`, `JWT_EXPIRES_IN`, `ENABLE_AUDIT`, `UPLOAD_DIR`, `UPLOAD_MAX_MB`, TOTVS |
| `backend/.env.development` | `PORT=3101`, `DATABASE_URL=file:./prisma/desenvolvimento.db`, `CORS_ORIGIN=http://localhost:3100`, `ENABLE_SWAGGER=true` |
| `backend/.env.production` | `NODE_ENV=production`, `PORT=3001`, `DATABASE_URL=file:./prisma/dev.db`, `CORS_ORIGIN=http://localhost:3000`, `ENABLE_SWAGGER=false` |
| `frontend/.env.development.local` | `BACKEND_URL=http://localhost:3101` |
| `frontend/.env.production.local` | `BACKEND_URL=http://localhost:3001` |

Nenhum desses arquivos vai para o git. Os modelos estão em `backend/.env.example` e `frontend/.env.example`.

## Comandos (na pasta `sig-bpm`)

| Comando | O que faz |
|---|---|
| `npm run dev` | Inicia o desenvolvimento (3100/3101) |
| `npm run producao:construir` | Gera a versão de produção: o backend em `backend/dist` (cerca de 25 s) e o frontend em `frontend/.next` (cerca de 75 s) |
| `npm run producao` | Inicia a produção (3000/3001) a partir do que foi gerado |
| `npm run db:backup -- "C:/caminho/da/pasta"` | Back-up do banco de **produção** (uma cópia consistente, mesmo com a produção no ar) |
| `npm run db:copiar-producao` | Copia o banco de produção para o de desenvolvimento (pare o desenvolvimento antes) |
| `npm run db:migrar-producao` | Aplica as migrações no banco de **produção** (faça o back-up antes) |
| `npx prisma migrate deploy` (em `backend`) | Aplica as migrações no banco de **desenvolvimento** |

## Publicar uma alteração (desde 20/10/2026)

Só com a autorização do Adão (“publique”); cada autorização vale para uma publicação.

1. Desenvolver e conferir em http://localhost:3100, com a cópia do banco. Com migração nova, aplicar primeiro no
   desenvolvimento (`npx prisma migrate deploy`, em `backend`) e conferir.
2. Etiquetar o commit (`git tag publicado-AAAA-MM-DD-…`) e enviar: `git push origin "<tag>^{commit}:refs/heads/master"` e
   `git push origin <tag>` (repositório https://github.com/desenvolvimento-bpm/sig-bpm; até 06/11/2026, github.com/AdaoBPM/sig-bpm, que redireciona). **Enviar à `master` já é publicar.**
3. Acompanhar o deploy no servidor (a cada 2 minutos o timer confere a `master`; ele faz o back-up do banco, aplica as
   migrações e troca os containers): `ssh srv-docker "cd /root/dados/sig-bpm && tail -20 deploy.log && docker compose ps"`.
4. Com script de dados: seguir as regras do servidor (simular sem `--gravar` e mostrar ao Adão, aprovação, conferir que
   não há deploy em andamento, back-up em `dados/backups/`, gravar e conferir) — em
   [SERVIDOR-DA-EMPRESA.md](./SERVIDOR-DA-EMPRESA.md), onde a alteração também fica registrada.
5. Conferir a produção em http://192.168.0.16:3010 e anotar a publicação nas NOTAS-MIGRACAO.

Nunca usar `npm run producao`, `db:migrar-producao` nem `db:backup` do notebook para publicar: eles atuam na base antiga
do notebook, não na produção.

## Migração para o servidor da empresa (feita pelo TI em 19–20/10/2026; histórico)

A produção foi separada já pensando no servidor, para que os usuários a usem com o notebook desligado. O que será preciso
lá:

- **Node.js 24** e a pasta do projeto (o repositório, sem `node_modules`; `npm install` na pasta `sig-bpm` instala e gera o
  cliente do Prisma).
- **Os arquivos de configuração** de produção (`backend/.env`, `backend/.env.production`,
  `frontend/.env.production.local`), com:
  - `DATABASE_URL` apontando para o banco no servidor;
  - `UPLOAD_DIR` para a pasta dos arquivos importados, copiada do notebook (`backend/uploads`): o banco guarda o hash de cada
    arquivo importado, e o arquivo fica nessa pasta;
  - um `JWT_SECRET` novo, com pelo menos 32 caracteres (a produção recusa um segredo fraco).
- **O banco:** copiar o banco real com `npm run db:backup` e levá-lo ao servidor. A troca para PostgreSQL é opcional e
  está descrita em `backend/prisma/PORTABILIDADE.md`.
- **Gerar e iniciar:** `npm run producao:construir` e `npm run producao`, como um serviço que inicie com o servidor (por
  exemplo, PM2 ou um serviço do Windows) e que reinicie se cair.
- **Rede:** liberar a porta 3000 no firewall do servidor. A porta 3001 (o backend) não precisa ficar aberta para a
  rede: o frontend fala com o backend no próprio servidor.
- **https (recomendado):** com um certificado (direto ou por um proxy, como IIS ou nginx, que envie
  `X-Forwarded-Proto: https`), o cookie da sessão passa a ser "seguro" sozinho. Por http na rede interna, também
  funciona.
- **Back-up periódico** do banco no servidor (`npm run db:backup`, agendado).
