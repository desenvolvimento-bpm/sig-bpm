import type { Request, Response } from "express";

import { cadastrosService } from "../../services/cadastros/cadastrosService.js";
import { RecargaInvalida, recargaCadastrosService } from "../../services/cadastros/recargaCadastrosService.js";
import { listarCadastroSchema, listarPrecosSchema } from "../../schemas/cadastros/listarCadastroSchema.js";

/**
 * O Express 5 expõe `req.query` como getter, então o middleware `validacao`
 * não consegue substituí-lo. Aqui o schema é aplicado sobre uma cópia, o que
 * mantém a validação com Zod sem mexer no objeto da request.
 */
function lerParametros(request: Request) {
  const resultado = listarCadastroSchema.safeParse({ ...request.query });
  return resultado;
}

export const cadastrosController = {
  async listarCentrosCusto(request: Request, response: Response) {
    const parametros = lerParametros(request);
    if (!parametros.success) {
      return response
        .status(400)
        .json({ error: "Dados inválidos", details: parametros.error.issues });
    }

    const data = await cadastrosService.listarCentrosCusto(parametros.data);
    return response.json({ data });
  },

  async listarContasResultado(request: Request, response: Response) {
    const parametros = lerParametros(request);
    if (!parametros.success) {
      return response
        .status(400)
        .json({ error: "Dados inválidos", details: parametros.error.issues });
    }

    const data = await cadastrosService.listarContasResultado(parametros.data);
    return response.json({ data });
  },

  async listarLinhasDRE(request: Request, response: Response) {
    const parametros = lerParametros(request);
    if (!parametros.success) {
      return response
        .status(400)
        .json({ error: "Dados inválidos", details: parametros.error.issues });
    }

    const data = await cadastrosService.listarLinhasDRE(parametros.data);
    return response.json({ data });
  },

  async listarReclassificacoes(request: Request, response: Response) {
    const parametros = lerParametros(request);
    if (!parametros.success) {
      return response
        .status(400)
        .json({ error: "Dados inválidos", details: parametros.error.issues });
    }

    const data = await cadastrosService.listarReclassificacoes(parametros.data);
    return response.json({ data });
  },

  async listarReclassificacoesFornecedor(request: Request, response: Response) {
    const parametros = lerParametros(request);
    if (!parametros.success) {
      return response.status(400).json({ error: "Dados inválidos", details: parametros.error.issues });
    }
    const data = await cadastrosService.listarReclassificacoesFornecedor(parametros.data);
    return response.json({ data });
  },

  async listarPrecosContrato(request: Request, response: Response) {
    const parametros = listarPrecosSchema.safeParse({ ...request.query });
    if (!parametros.success) {
      return response
        .status(400)
        .json({ error: "Dados inválidos", details: parametros.error.issues });
    }

    const data = await cadastrosService.listarPrecosContrato(parametros.data);
    return response.json({ data });
  },

  /** Recarga da planilha, 1º tempo: o arquivo vai cru no corpo; devolve o que muda. */
  async recargaPrevia(request: Request, response: Response) {
    if (!Buffer.isBuffer(request.body)) {
      return response.status(400).json({ error: "Envie a planilha no corpo da requisição." });
    }
    try {
      return response.json({ data: await recargaCadastrosService.previa(request.body) });
    } catch (error) {
      if (error instanceof RecargaInvalida) return response.status(400).json({ error: error.message });
      throw error;
    }
  },

  /** Recarga da planilha, 2º tempo: grava o arquivo da prévia, pelo hash. */
  async recargaConfirmar(request: Request, response: Response) {
    const hash = String((request.body as { hash?: unknown } | undefined)?.hash ?? "");
    if (!/^[0-9a-f]{64}$/.test(hash)) return response.status(400).json({ error: "Prévia inválida." });
    try {
      return response.json({ data: await recargaCadastrosService.confirmar(hash, request.user!.sub) });
    } catch (error) {
      if (error instanceof RecargaInvalida) return response.status(400).json({ error: error.message });
      throw error;
    }
  },

  async resumo(_request: Request, response: Response) {
    const data = await cadastrosService.resumo();
    return response.json({ data });
  },
};
