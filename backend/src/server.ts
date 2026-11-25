import { app } from "./app.js";
import { env } from "./config/env.js";
import { auditoriaEmSequencia } from "./services/auditoriaService.js";
import { iniciarSyncCadastros } from "./jobs/cadastrosTotvsSyncJob.js";
import { carregarNomesDasUnidades } from "./services/cadastros/nomesDasUnidades.js";
import { importacoesService } from "./services/importacoes/importacoesService.js";
import { carregarNomesDoSistema } from "./services/relatorios/indicadoresDoSistema.js";
import { logger } from "./utils/logger.js";
import { plural } from "./utils/plural.js";

// Os nomes atuais dos indicadores que o código conhece pelo ID (19/11/2026), antes de atender: sem eles, os originais.
try {
  const fora = await carregarNomesDoSistema();
  if (fora.length) logger("warn", `${fora.length} ${plural(fora.length, "indicador do sistema não está", "indicadores do sistema não estão")} nesta base pelo ID: ficam com o nome original`);
} catch (error) {
  logger("error", "Falha ao ler os nomes dos indicadores", { error: error instanceof Error ? error.message : String(error) });
}
// Os nomes das unidades (25/11/2026: mudam a qualquer momento), para as telas e os relatórios; sem eles, os de sempre.
try {
  await carregarNomesDasUnidades();
} catch (error) {
  logger("error", "Falha ao ler os nomes das unidades", { error: error instanceof Error ? error.message : String(error) });
}

const server = app.listen(env.PORT, () => {
  logger("info", `Backend BPM rodando na porta ${env.PORT}`);
  importacoesService
    .recuperarInterrompidas()
    .then((n) => {
      if (n > 0) logger("warn", `${n} ${plural(n, "importação interrompida marcada como recusada", "importações interrompidas marcadas como recusadas")}`);
    })
    .catch((error: unknown) => {
      logger("error", "Falha ao recuperar importações interrompidas", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  if (env.enableSwagger) {
    logger("info", `Swagger UI: http://localhost:${env.PORT}/api/docs`);
  }
  iniciarSyncCadastros();
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    logger("error", `Porta ${env.PORT} em uso — encerre o processo anterior ou altere PORT no .env`);
    process.exit(1);
  }
  throw error;
});

// Ao parar (24/10/2026; a publicação troca o container com um SIGTERM): as gravações em sequência que esperam na memória
// entram na Auditoria, e o processo sai (até 5 s; antes, o Docker esperava 10 s e o matava).
for (const sinal of ["SIGTERM", "SIGINT"] as const) {
  process.once(sinal, () => {
    server.close();
    setTimeout(() => process.exit(0), 5000).unref();
    void auditoriaEmSequencia.encerrar().finally(() => process.exit(0));
  });
}
