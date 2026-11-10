import { env } from "../config/env.js";
import { sincronizarCentrosCusto } from "../services/totvs/centrosCustoSync.js";
import { sincronizarContasContabeis } from "../services/totvs/contaContabilSync.js";
import { sincronizarFornecedores } from "../services/totvs/fornecedoresSync.js";
import { sincronizarProdutos } from "../services/totvs/produtosSync.js";
import { sincronizarTiposMovimento } from "../services/totvs/tiposMovimentoSync.js";
import { logger } from "../utils/logger.js";

/**
 * Atualização periódica dos cadastros do TOTVS RM (fornecedores e centros de custo).
 * Um ciclo roda as tarefas ativas uma por vez (uma consulta de cada vez ao RM, por causa das licenças).
 * A próxima execução = fim do ciclo atual + intervalo: ciclos nunca se sobrepõem. Um erro numa tarefa é
 * registrado e não interrompe as demais.
 */

type Tarefa = { nome: string; ativa: boolean; executar: () => Promise<{ lidas: number; gravadas: number }> };

/** As consultas de cadastro do TOTVS RM (sentenças de consulta, somente leitura). */
const tarefas = (): Tarefa[] => [
  { nome: "fornecedores", ativa: env.FORNECEDOR_SYNC_ATIVO, executar: sincronizarFornecedores },
  { nome: "centros de custo", ativa: env.CENTRO_CUSTO_SYNC_ATIVO, executar: sincronizarCentrosCusto },
  { nome: "contas contábeis", ativa: env.CONTA_CONTABIL_SYNC_ATIVO, executar: sincronizarContasContabeis },
  { nome: "produtos", ativa: env.PRODUTO_SYNC_ATIVO, executar: sincronizarProdutos },
  { nome: "tipos de movimento", ativa: env.TIPO_MOVIMENTO_SYNC_ATIVO, executar: sincronizarTiposMovimento },
];

let rodando = false;
let timer: NodeJS.Timeout | undefined;

/** Roda um ciclo: cada tarefa ativa, na ordem. Devolve quantas rodaram com sucesso. */
export async function executarCicloSyncCadastros(): Promise<number> {
  if (rodando) return 0;
  rodando = true;
  let ok = 0;
  try {
    for (const t of tarefas().filter((x) => x.ativa)) {
      const inicio = Date.now();
      try {
        const r = await t.executar();
        logger("info", `Cadastro sincronizado: ${t.nome}`, { ...r, duracaoMs: Date.now() - inicio });
        ok++;
      } catch (error) {
        logger("error", `Falha ao sincronizar ${t.nome}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    rodando = false;
  }
  return ok;
}

function agendar(ms: number) {
  timer = setTimeout(async () => {
    await executarCicloSyncCadastros();
    agendar(env.FORNECEDOR_SYNC_INTERVAL_MS);
  }, ms);
  timer.unref();
}

/** Liga a atualização ao subir o servidor. Não liga sem o .env do TOTVS. */
export function iniciarSyncCadastros(atrasoInicialMs = 5000): void {
  if (!env.fornecedorSyncConfigurada) {
    logger("warn", "Sincronização de cadastros do TOTVS não iniciada: preencha TOTVS_CONSULTA_SQL_URL, TOTVS_USER e TOTVS_PASSWORD no .env");
    return;
  }
  const ativas = tarefas().filter((t) => t.ativa).map((t) => t.nome);
  if (ativas.length === 0) {
    logger("info", "Sincronização de cadastros do TOTVS desligada (nenhuma tarefa ativa no .env)");
    return;
  }
  logger("info", "Sincronização de cadastros do TOTVS ligada", { tarefas: ativas, intervaloMs: env.FORNECEDOR_SYNC_INTERVAL_MS });
  agendar(atrasoInicialMs);
}

export function pararSyncCadastros(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
}
