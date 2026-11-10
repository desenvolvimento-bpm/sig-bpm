import cors from "cors";
import express from "express";
import helmet from "helmet";

import { env } from "./config/env.js";
import { registerSwagger } from "./config/swagger.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { auditoriaRoutes } from "./routes/auditoriaRoutes.js";
import { authRoutes } from "./routes/authRoutes.js";
import { cadastrosRoutes } from "./routes/cadastros/cadastrosRoutes.js";
import { classificacaoRoutes } from "./routes/classificacao/classificacaoRoutes.js";
import { competenciasRoutes } from "./routes/competencias/competenciasRoutes.js";
import { bloquearNaPublicacao } from "./middlewares/publicacao.js";
import { healthRoutes } from "./routes/healthRoutes.js";
import { listasDaCompetenciaRoutes, listasRoutes } from "./routes/listas/listasRoutes.js";
import {
  lancamentosDaCompetenciaRoutes,
  lancamentosManuaisRoutes,
} from "./routes/lancamentosManuais/lancamentosManuaisRoutes.js";
import { lancamentosReceitaRoutes, receitaPreviaRoutes } from "./routes/receitaPrevia/receitaPreviaRoutes.js";
import { dreRoutes } from "./routes/dre/dreRoutes.js";
import { apuracaoRoutes } from "./routes/apuracao/apuracaoRoutes.js";
import { conferenciaPlanilhaRoutes } from "./routes/conferencia/conferenciaPlanilhaRoutes.js";
import { edicaoCadastrosRoutes } from "./routes/cadastros/edicaoCadastrosRoutes.js";
import { divergenciasRoutes } from "./routes/divergencias/divergenciasRoutes.js";
import { perfisRoutes, presencaRoutes, usuariosRoutes } from "./routes/usuarios/usuariosRoutes.js";
import { contestacoesDaCompetenciaRoutes, contestacoesRoutes } from "./routes/contestacoes/contestacoesRoutes.js";
import { exportacoesRoutes } from "./routes/exportacoes/exportacoesRoutes.js";
import { estoqueRoutes } from "./routes/estoque/estoqueRoutes.js";
import { rateiosRoutes } from "./routes/rateios/rateiosRoutes.js";
import { relatoriosRoutes } from "./routes/relatorios/relatoriosRoutes.js";
import { resultadosLinhaRoutes } from "./routes/resultadosLinha/resultadosLinhaRoutes.js";
import { creditosImpostosRoutes } from "./routes/impostos/creditosImpostosRoutes.js";
import { realizadoObraRoutes } from "./routes/realizadoObra/realizadoObraRoutes.js";
import { arquivosGeraisRoutes } from "./routes/arquivosGerais/arquivosGeraisRoutes.js";
import { colaboradoresRoutes } from "./routes/colaboradores/colaboradoresRoutes.js";
import { relatoriosExecutivosRoutes } from "./routes/analisesGerenciais/relatoriosExecutivosRoutes.js";
import { paineisDeBordoRoutes } from "./routes/analisesGerenciais/paineisDeBordoRoutes.js";
import { apiExternaRoutes, conectividadeRoutes } from "./routes/conectividade/conectividadeRoutes.js";
import { cenariosRoutes } from "./routes/cenarios/cenariosRoutes.js";
import {
  importacoesDaCompetenciaRoutes,
  importacoesRoutes,
} from "./routes/importacoes/importacoesRoutes.js";

export const app = express();

app.use(
  helmet({
    contentSecurityPolicy: env.enableSwagger
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
          },
        }
      : undefined,
  }),
);
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  }),
);
// O Exportar das tabelas (30/10/2026) lê o corpo com o limite dele (a tabela inteira de uma tela), antes do comum.
app.use("/exportacoes", exportacoesRoutes);
app.use(express.json({ limit: "1mb" }));

registerSwagger(app);

app.use("/health", healthRoutes);
// O modo de publicação (21/10/2026): com o sinal ligado, só consulta (as gravações recebem 503).
app.use(bloquearNaPublicacao);
app.use("/auth", authRoutes);
app.use("/auditoria", auditoriaRoutes);
app.use("/cadastros/edicao", edicaoCadastrosRoutes);
app.use("/cadastros", cadastrosRoutes);
app.use("/competencias/:anoMes/importacoes", importacoesDaCompetenciaRoutes);
app.use("/competencias/:anoMes/classificacao", classificacaoRoutes);
app.use("/competencias/:anoMes/lancamentos-manuais", lancamentosDaCompetenciaRoutes);
app.use("/competencias/:anoMes/contestacoes", contestacoesDaCompetenciaRoutes);
app.use("/competencias/:anoMes/listas", listasDaCompetenciaRoutes);
app.use("/competencias/:anoMes/receita-previa", receitaPreviaRoutes);
app.use("/competencias/:anoMes/rateios", rateiosRoutes);
app.use("/competencias/:anoMes/estoque", estoqueRoutes);
app.use("/competencias/:anoMes/dre", dreRoutes);
// A etapa Linhas (26/10/2026): a DRE de cada unidade dividida entre as linhas, gravada na apuração.
app.use("/competencias/:anoMes/linhas", resultadosLinhaRoutes);
// Os Créditos de Impostos (03/11/2026): a tela Impostos do mês.
app.use("/competencias/:anoMes/impostos", creditosImpostosRoutes);
app.use("/competencias/:anoMes/apuracao", apuracaoRoutes);
app.use("/competencias/:anoMes/conferencia-planilha", conferenciaPlanilhaRoutes);
app.use("/competencias", competenciasRoutes);
app.use("/usuarios", usuariosRoutes);
app.use("/divergencias", divergenciasRoutes);
app.use("/perfis", perfisRoutes);
app.use("/presenca", presencaRoutes);
app.use("/importacoes", importacoesRoutes);
app.use("/lancamentos-manuais", lancamentosManuaisRoutes);
app.use("/contestacoes", contestacoesRoutes);
app.use("/listas", listasRoutes);
app.use("/lancamentos-receita", lancamentosReceitaRoutes);
app.use("/relatorios", relatoriosRoutes);
// O Realizado por Obra (03/11/2026): os Resultados de uma venda.
app.use("/realizado-por-obra", realizadoObraRoutes);
// Os Arquivos Gerais (05/11/2026): as telas Treinamentos e Informativos.
app.use("/arquivos-gerais", arquivosGeraisRoutes);
// A Gestão de Colaboradores (06/11/2026): as importações da tela Cadastros.
app.use("/gestao-de-colaboradores", colaboradoresRoutes);
// Os Relatórios Executivos (15/10/2026, Análises Gerenciais).
app.use("/relatorios-executivos", relatoriosExecutivosRoutes);
// Os Painéis de Bordo (31/10/2026, Análises Gerenciais), feitos a partir dos Relatórios Executivos.
app.use("/paineis-de-bordo", paineisDeBordoRoutes);
// A Biblioteca de APIs (24/10/2026): a API externa (pelo /api/v1 do Next) e a tela.
app.use("/v1", apiExternaRoutes);
app.use("/conectividade", conectividadeRoutes);
app.use("/cenarios", cenariosRoutes);

app.use((_request, response) => {
  response.status(404).json({ error: "Rota não encontrada" });
});

app.use(errorHandler);
