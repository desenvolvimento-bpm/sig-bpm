import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.join(__dirname, "..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Acesso pela rede local (11/10/2026): no modo de desenvolvimento, o Next bloqueia os arquivos da tela para quem
  // não entra por localhost — a tela de login abre, mas não funciona. Liberados os endereços das redes internas.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.16.*.*"],
  // A pasta da compilação: a .next de sempre, ou outra para a base teste Pré-Contestações (16/11/2026, o
  // scripts/teste.mjs passa NEXT_DIST_DIR=.next-pre-contestacoes), que convive com a do teste.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactCompiler: true,
  cacheComponents: true,
  // O build sem a verificação de tipos (22/10/2026, combinado com o TI): no servidor, ela levou a memória ao limite e o
  // travou. A verificação é feita no notebook antes de cada envio à master (npx tsc --noEmit no frontend).
  typescript: { ignoreBuildErrors: true },
  experimental: {
    // Com o proxy.ts ativo, o Next limita o corpo das requisições a 10 MB e
    // corta o excedente. As planilhas do SIG passam disso (o LISTAS FOLHA tem
    // 23 MB); o limite de fato é o UPLOAD_MAX_MB do backend. Os vídeos dos Relatórios Executivos (20/10/2026) vão até
    // 200 MB.
    proxyClientMaxBodySize: "210mb",
  },
  // Monorepo: dependências ficam em node_modules na raiz (npm workspaces)
  outputFileTracingRoot: monorepoRoot,
  turbopack: {
    root: monorepoRoot,
  },
  webpack: (config) => {
    const rootModules = path.join(monorepoRoot, "node_modules");

    config.resolve.modules = [rootModules, ...(config.resolve.modules ?? [])];

    // Peer deps do Recharts (monorepo — webpack não sobe a árvore a partir de node_modules/recharts)
    config.resolve.alias = {
      ...config.resolve.alias,
      "react-redux": path.join(rootModules, "react-redux"),
    };

    return config;
  },
};

export default nextConfig;
