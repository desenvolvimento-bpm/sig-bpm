/**
 * Especificação OpenAPI 3 — mantida em TypeScript para funcionar em dev (tsx) e prod (dist).
 * Expandir conforme novos módulos forem adicionados ao SPEC.
 */
export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "BPM Template API",
    version: "1.0.0",
    description:
      "API Express de referência. Documentação interativa em `/api/docs`. " +
      "Integrações SOAP/XML (TOTVS): ver `totvsService` e libs `soap` + `xml2js`.",
  },
  servers: [
    {
      url: "http://localhost:3001",
      description: "Desenvolvimento local",
    },
  ],
  tags: [
    { name: "Health", description: "Disponibilidade da API" },
    { name: "Auth", description: "Autenticação JWT" },
    { name: "Auditoria", description: "Registro de ações de negócio" },
    {
      name: "Central de Conectividade",
      description:
        "Os dados das DREs, dos cards e dos indicadores dos Resultados Empresariais, do Realizado por Obra e dos Cenários para outros aplicativos (24/10/2026). " +
        "Fora do SIG, o endereço é o do SIG com o prefixo /api (http(s)://servidor/api/v1/…); na produção, http://sig.bpm.interno/api/v1, só na rede interna (decisão do TI). " +
        "A API só responde ligada pelo TI (a API_EXTERNA; desligada, 503); " +
        "o token vale uma hora; cada pedido exige a tela APIs da Central de Conectividade (Ler) e a leitura da tela dos dados no perfil, e fica na Auditoria.",
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
    schemas: {
      ErrorResponse: {
        type: "object",
        properties: {
          error: { type: "string", example: "Mensagem de erro" },
        },
        required: ["error"],
      },
      LoginRequest: {
        type: "object",
        properties: {
          email: { type: "string", format: "email", example: "admin@bpm.com" },
          password: { type: "string", format: "password", example: "admin123" },
        },
        required: ["email", "password"],
      },
      LoginResponse: {
        type: "object",
        properties: {
          data: {
            type: "object",
            properties: {
              token: { type: "string" },
              user: { $ref: "#/components/schemas/User" },
            },
          },
        },
      },
      User: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          nome: { type: "string" },
          email: { type: "string", format: "email" },
          permissions: {
            type: "array",
            items: { type: "string" },
            example: ["dashboard:view", "pedidos:view"],
          },
        },
      },
      HealthResponse: {
        type: "object",
        properties: {
          data: {
            type: "object",
            properties: {
              status: { type: "string", example: "ok" },
              totvs: {
                type: "object",
                properties: {
                  configured: { type: "boolean" },
                  mode: { type: "string", example: "mock" },
                  message: { type: "string" },
                },
              },
            },
          },
        },
      },
      RegistrarAcessoRequest: {
        type: "object",
        properties: {
          tela: { type: "string", example: "/dashboard" },
        },
        required: ["tela"],
      },
    },
  },
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Health check",
        description: "Verifica se a API está operacional e o status stub da integração TOTVS.",
        responses: {
          "200": {
            description: "API operacional",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HealthResponse" },
              },
            },
          },
        },
      },
    },
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Login",
        description:
          "Autentica com e-mail e senha. Em dev, usuário template: `admin@bpm.com` / `admin123`.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/LoginRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Token JWT emitido",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LoginResponse" },
              },
            },
          },
          "401": {
            description: "Credenciais inválidas",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "422": {
            description: "Payload inválido",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "429": {
            description: "Muitas tentativas de login",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/auth/me": {
      get: {
        tags: ["Auth"],
        summary: "Usuário autenticado",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": {
            description: "Dados do usuário logado",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { $ref: "#/components/schemas/User" },
                  },
                },
              },
            },
          },
          "401": {
            description: "Não autenticado",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/auditoria/acesso": {
      post: {
        tags: ["Auditoria"],
        summary: "Registrar acesso a tela",
        description:
          "Auditoria de negócio (ação ACESSO). Persiste em `audit_log` se DATABASE_URL existir; senão log no console.",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RegistrarAcessoRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "Registro aceito",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "object",
                      properties: { registrado: { type: "boolean" } },
                    },
                  },
                },
              },
            },
          },
          "401": {
            description: "Não autenticado",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/v1/token": {
      post: {
        tags: ["Central de Conectividade"],
        summary: "Pedir o token da API",
        description: "Com o e-mail e a senha do SIG. Limite: 20 tentativas erradas por e-mail e 30 por endereço a cada 15 minutos.",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["email", "senha"], properties: { email: { type: "string" }, senha: { type: "string" } } } } },
        },
        responses: {
          "200": { description: "{ data: { token, tipo: \"Bearer\", expiraEm } }" },
          "401": { description: "E-mail ou senha inválidos", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "403": { description: "Sem HTTPS, sem a tela APIs no perfil, ou o usuário ou o endereço bloqueados" },
          "422": { description: "O e-mail e a senha não vieram" },
          "429": { description: "Muitas tentativas" },
          "503": { description: "A API ainda não foi ligada pelo TI (API_DESLIGADA)" },
        },
      },
    },
    "/v1/apis": {
      get: {
        tags: ["Central de Conectividade"],
        summary: "As APIs que o usuário do token lê",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": { description: "{ data: [{ codigo, nome, origem, descricao, formatos, parametros, bloqueada }], meta: { total } }" },
          "401": { description: "Sem o token, ou o token inválido ou vencido" },
          "403": { description: "Sem HTTPS, sem a tela APIs no perfil, ou o usuário ou o endereço bloqueados" },
          "503": { description: "A API ainda não foi ligada pelo TI (API_DESLIGADA)" },
        },
      },
    },
    "/v1/apis/{codigo}": {
      get: {
        tags: ["Central de Conectividade"],
        summary: "Os dados de uma API",
        description:
          "Códigos: resultados-dre, resultados-custos-operacionais, resultados-painel, resultados-indicadores, obras, obra-dre, cenarios, cenario-dre, cenario-custos-operacionais, cenario-painel e cenario-indicadores. " +
          "?formato=dados (o padrão: { colunas, linhas }) ou visual ({ visuais: [{ titulo, largura, altura, svg }] }); os demais parâmetros, conforme a API (GET /v1/apis).",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "codigo", in: "path", required: true, schema: { type: "string" } },
          { name: "formato", in: "query", required: false, schema: { type: "string", enum: ["dados", "visual"] } },
        ],
        responses: {
          "200": { description: "{ data: { api, formato, colunas, linhas } | { api, formato, visuais }, meta }" },
          "401": { description: "Sem o token, ou o token inválido ou vencido" },
          "403": { description: "Sem HTTPS, sem a permissão de leitura dos dados, ou a API, o usuário ou o endereço bloqueados" },
          "404": { description: "API, cenário, obra, versão, linha ou card inexistente" },
          "422": { description: "Parâmetro inválido" },
          "429": { description: "Mais de 120 pedidos por minuto" },
          "503": { description: "A API ainda não foi ligada pelo TI (API_DESLIGADA)" },
        },
      },
    },
  },
} as const;
