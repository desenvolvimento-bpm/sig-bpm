// O ambiente de teste (21/10/2026): a versão compilada da ferramenta (sem o Turbopack, as telas abrem em menos de 1 s)
// com o banco do desenvolvimento (o DATABASE_URL do backend/.env.teste; na branch postgres, o sig_bpm_dev). Telas na porta
// 3200, backend na 3201.
// A base teste Pré-Contestações (16/11/2026): outro teste, com a cópia da produção de 10/11/2026 22:08 (antes de processar
// as contestações) no esquema pre_contestacoes. Telas na porta 3300, backend na 3301, o backend/.env.pre-contestacoes, e a
// sua própria compilação (backend/dist-pre-contestacoes e frontend/.next-pre-contestacoes), etiqueta e cookie.
// Uso (na pasta sig-bpm):
//   npm run teste:construir   confere os tipos (backend e frontend) e gera a versão de teste do código de agora (o backend
//                             em backend/dist, as telas em frontend/.next); com erro de tipos, não gera nada
//   npm run teste             inicia o teste a partir do que foi gerado
//   npm run pre-contestacoes:construir e npm run pre-contestacoes   o mesmo, para a base teste Pré-Contestações
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const backend = join(raiz, "backend");
const frontend = join(raiz, "frontend");

/** Cada ambiente de teste: as portas, o .env do backend, as pastas da compilação e o NEXT_PUBLIC_AMBIENTE das telas. */
const AMBIENTES = {
  teste: { comando: "teste", porta: 3200, portaDoBackend: 3201, env: ".env.teste", dist: "dist", next: ".next" },
  "pre-contestacoes": {
    comando: "pre-contestacoes",
    porta: 3300,
    portaDoBackend: 3301,
    env: ".env.pre-contestacoes",
    dist: "dist-pre-contestacoes",
    next: ".next-pre-contestacoes",
  },
};
const nomeDoAmbiente = process.argv.find((a) => a.startsWith("--ambiente="))?.slice("--ambiente=".length) ?? "teste";
const A = AMBIENTES[nomeDoAmbiente];
if (!A) {
  console.error(`Ambiente desconhecido: ${nomeDoAmbiente} (os que existem: ${Object.keys(AMBIENTES).join(", ")}).`);
  process.exit(1);
}

/** Roda um comando com o prefixo do nome em cada linha; devolve o processo. */
function rodar(nome, comando, pasta, env = {}) {
  const p = spawn(comando, { cwd: pasta, shell: true, env: { ...process.env, ...env } });
  const prefixar = (saida) => (dados) => {
    for (const linha of String(dados).split(/\r?\n/)) if (linha.trim()) saida.write(`[${nome}] ${linha}\n`);
  };
  p.stdout.on("data", prefixar(process.stdout));
  p.stderr.on("data", prefixar(process.stderr));
  return p;
}
const esperar = (p) => new Promise((ok, erro) => p.on("exit", (codigo) => (codigo === 0 ? ok() : erro(new Error(`saiu com o código ${codigo}`)))));

if (process.argv.includes("construir")) {
  // A checagem de tipos antes de gerar (03/11/2026, pedido do Adão): o build das telas não verifica os tipos (o
  // ignoreBuildErrors do next.config), e um arquivo pela metade (outra sessão editando a mesma pasta) gerou um teste que
  // quebrava os painéis. Com erro, nada é gerado e o teste de antes continua como estava.
  try {
    await Promise.all([esperar(rodar("backend", "npx tsc --noEmit", backend)), esperar(rodar("frontend", "npx tsc --noEmit", frontend))]);
  } catch {
    console.error("A checagem de tipos achou erros (acima): a versão de teste não foi gerada, e a de antes continua.");
    process.exit(1);
  }
  await esperar(rodar("backend", `npx tsc --outDir ${A.dist}`, backend));
  // Com outra pasta de compilação, o next build acrescenta a pasta dela ao tsconfig.json (que está no git) e aponta o
  // next-env.d.ts para ela: os dois voltam como estavam depois de gerar.
  const guardados = A.next === ".next" ? [] : ["tsconfig.json", "next-env.d.ts"].map((f) => [join(frontend, f), existsSync(join(frontend, f)) ? readFileSync(join(frontend, f)) : null]);
  try {
    // A etiqueta e o cookie próprio entram nas telas na compilação (NEXT_PUBLIC_AMBIENTE).
    await esperar(rodar("frontend", "npx next build --turbopack", frontend, { NEXT_PUBLIC_AMBIENTE: nomeDoAmbiente, NEXT_DIST_DIR: A.next }));
  } finally {
    for (const [arquivo, conteudo] of guardados) if (conteudo !== null) writeFileSync(arquivo, conteudo);
  }
  console.log(`Versão de teste gerada. Inicie com: npm run ${A.comando} (http://localhost:${A.porta})`);
} else {
  if (!existsSync(join(backend, A.env))) {
    console.error(`Falta o backend/${A.env} (veja Docs/PRODUCAO-E-DESENVOLVIMENTO.md).`);
    process.exit(1);
  }
  // O backend lê o .env do teste (a porta e o banco do desenvolvimento) antes do .env do modo e do comum.
  const b = rodar("backend", `node --env-file=${A.env} ${A.dist}/server.js`, backend);
  // As telas falam com o backend do teste (o BACKEND_URL do ambiente vale mais que o dos arquivos .env).
  const f = rodar("frontend", `npx next start -p ${A.porta}`, frontend, { BACKEND_URL: `http://localhost:${A.portaDoBackend}`, NEXT_DIST_DIR: A.next });
  const parar = () => {
    for (const p of [b, f]) if (p.exitCode === null) p.kill();
  };
  process.on("SIGINT", parar);
  process.on("SIGTERM", parar);
  // Se um dos dois cai, o outro também para (como o concurrently -k da produção antiga).
  for (const p of [b, f]) p.on("exit", (codigo) => { parar(); process.exitCode = codigo ?? 1; });
}
