import https from "node:https";

import axios from "axios";

import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";

/**
 * Cliente SOAP do TOTVS RM (SOAP 1.1, autenticação Basic): o wsConsultaSQL (sentenças SQL) e o wsDataServer
 * (leitura de registros). Somente leitura — a repetição é segura.
 * Todas as chamadas passam por uma fila: uma por vez neste backend, porque cada uma ocupa uma licença do RM.
 */

const SOAP_ACTION_CONSULTA = "http://www.totvs.com/IwsConsultaSQL/RealizarConsultaSQL";
const TENTATIVAS = 3;
const ESPERA_MS = 3000;
const ESPERA_LICENCA_MS = 5000;
const ERROS_DE_CONEXAO = ["socket hang up", "ECONNRESET", "ETIMEDOUT"];
const TIMEOUT_PADRAO_MS = 60_000;

/** Licença esgotada no RM ("Não foi possível consumir a licença… Excedeu numero de licenças"). */
function ehErroDeLicenca(error: unknown): boolean {
  const mensagem = error instanceof Error ? error.message : String(error);
  return /licen[çc]a/i.test(mensagem);
}

function ehErroDeConexao(error: unknown): boolean {
  const mensagem = error instanceof Error ? error.message : String(error);
  return ERROS_DE_CONEXAO.some((trecho) => mensagem.includes(trecho));
}

const esperar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Escapa o texto que vai dentro do envelope SOAP. */
export function escaparXml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Parâmetros da sentença no formato do RM: "CHAVE=VALOR;CHAVE2=VALOR2" (sem espaços).
 * Sem parâmetros, o elemento não vai no envelope.
 */
export type ParametrosSentenca = Record<string, string | number>;

export function montarParametros(parametros: ParametrosSentenca): string {
  return Object.entries(parametros)
    .map(([chave, valor]) => `${chave}=${String(valor)}`)
    .join(";");
}

/** Monta o envelope na mesma ordem do SoapUI que roda: sentença, coligada, sistema, usuário e parâmetros. */
export function montarEnvelope(
  codSentenca: string,
  codColigada: number,
  codSistema: string,
  parametros?: ParametrosSentenca,
  codUsuario?: string,
): string {
  const usuario = codUsuario ? `<tot:codUsuario>${escaparXml(codUsuario)}</tot:codUsuario>` : "";
  const texto = parametros && Object.keys(parametros).length > 0 ? `<tot:parameters>${escaparXml(montarParametros(parametros))}</tot:parameters>` : "";
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">` +
    `<soap:Header/>` +
    `<soap:Body>` +
    `<tot:RealizarConsultaSQL>` +
    `<tot:codSentenca>${escaparXml(codSentenca)}</tot:codSentenca>` +
    `<tot:codColigada>${codColigada}</tot:codColigada>` +
    `<tot:codSistema>${escaparXml(codSistema)}</tot:codSistema>` +
    usuario +
    texto +
    `</tot:RealizarConsultaSQL>` +
    `</soap:Body>` +
    `</soap:Envelope>`
  );
}

function decodificarXml(texto: string): string {
  return texto
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Tira o XML da resposta SOAP: o conteúdo do elemento de resultado (ex.: RealizarConsultaSQLResult), que vem como
 * texto XML escapado. Uma falha SOAP (Fault) vira erro com a mensagem do RM.
 */
export function extrairResultadoSoap(xmlSoap: string, nomeResultado: string): string {
  const falha = xmlSoap.match(/<(?:\w+:)?faultstring[^>]*>([\s\S]*?)<\/(?:\w+:)?faultstring>/);
  if (falha) throw new Error(`TOTVS RM: ${decodificarXml(falha[1]).trim()}`);

  const expressao = new RegExp(`<(?:\\w+:)?${nomeResultado}[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${nomeResultado}>`);
  const resultado = xmlSoap.match(expressao);
  if (!resultado) throw new Error(`TOTVS RM: resposta sem ${nomeResultado}`);
  return decodificarXml(resultado[1]);
}

/** Tira o XML do RealizarConsultaSQLResult (NewDataSet). */
export function extrairResultado(xmlSoap: string): string {
  return extrairResultadoSoap(xmlSoap, "RealizarConsultaSQLResult");
}

export type OpcoesConsultaSql = {
  /** Módulo do RM da sentença (T, C…). Padrão: TOTVS_CODSISTEMA. */
  codSistema?: string;
  /** Parâmetros da sentença (ex.: DATA_INICIAL). */
  parametros?: ParametrosSentenca;
  /** Tempo máximo da chamada. Padrão: 60 s; consultas de mês inteiro levam mais (90 s no teste). */
  timeoutMs?: number;
};

/**
 * Keep-alive com pacotes TCP periódicos: a consulta grande fica muito tempo sem trafego, e um firewall ou balanceador
 * no caminho derrubava a conexão ociosa ("conexão interrompida", com a consulta refeita do zero).
 */
const agenteHttps = new https.Agent({ keepAlive: true, keepAliveMsecs: 30_000 });

/** A fila das chamadas ao RM: cada tarefa começa só quando a anterior terminou. */
let filaRm: Promise<unknown> = Promise.resolve();

export function naFilaRm<T>(tarefa: () => Promise<T>): Promise<T> {
  const execucao = filaRm.then(tarefa);
  filaRm = execucao.catch(() => undefined);
  return execucao;
}

/** Envia uma mensagem SOAP ao RM e devolve a resposta crua. Repete em erro de conexão e de licença. */
export async function enviarSoap(opcoes: {
  url: string;
  soapAction: string;
  envelope: string;
  timeoutMs: number;
  rotulo: string;
}): Promise<string> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      const { data, status } = await axios
        .post<string>(opcoes.url, opcoes.envelope, {
          auth: { username: env.TOTVS_USER!, password: env.TOTVS_PASSWORD! },
          headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"${opcoes.soapAction}"` },
          responseType: "text",
          timeout: opcoes.timeoutMs,
          httpsAgent: agenteHttps,
          // A falha SOAP vem em HTTP 500 com o Fault no corpo: o corpo é lido aqui, e o status só se não houver Fault.
          validateStatus: () => true,
        })
        .catch((error: unknown) => {
          // Sem o detalhe do axios (que traz o cabeçalho de autorização): só a causa, em português.
          const codigo = (error as { code?: string }).code;
          if (codigo === "ECONNABORTED" || codigo === "ETIMEDOUT") {
            throw new Error(`TOTVS RM: a consulta passou de ${Math.round(opcoes.timeoutMs / 1000)} s sem resposta`);
          }
          throw error;
        });
      if (status >= 400 && !/Fault/.test(String(data))) {
        throw new Error(`TOTVS RM: HTTP ${status} (confira usuário e senha do TOTVS_USER)`);
      }
      return String(data);
    } catch (error) {
      const erroLicenca = ehErroDeLicenca(error);
      if (tentativa >= TENTATIVAS || (!erroLicenca && !ehErroDeConexao(error))) throw error;
      if (erroLicenca) {
        // Licença esgotada: o tutorial pede 3 tentativas com 5 s de intervalo.
        logger("warn", "TOTVS RM: licença indisponível, tentando de novo", { chamada: opcoes.rotulo, tentativa });
        await esperar(ESPERA_LICENCA_MS);
        continue;
      }
      logger("warn", "TOTVS RM: conexão interrompida, tentando de novo", { chamada: opcoes.rotulo, tentativa });
      await esperar(ESPERA_MS);
    }
  }
}

/** Executa a sentença no RM, na fila, e devolve o XML do resultado (NewDataSet). */
export function realizarConsultaSql(codSentenca: string, opcoes: OpcoesConsultaSql = {}): Promise<string> {
  return naFilaRm(async () => {
    if (!env.TOTVS_CONSULTA_SQL_URL || !env.TOTVS_USER || !env.TOTVS_PASSWORD) {
      throw new Error("TOTVS RM: configure TOTVS_CONSULTA_SQL_URL, TOTVS_USER e TOTVS_PASSWORD no .env");
    }
    const envelope = montarEnvelope(codSentenca, env.TOTVS_CODCOLIGADA, opcoes.codSistema ?? env.TOTVS_CODSISTEMA, opcoes.parametros, env.TOTVS_USER);
    const bruto = await enviarSoap({
      url: env.TOTVS_CONSULTA_SQL_URL,
      soapAction: SOAP_ACTION_CONSULTA,
      envelope,
      timeoutMs: opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS,
      rotulo: codSentenca,
    });
    return extrairResultado(bruto);
  });
}
