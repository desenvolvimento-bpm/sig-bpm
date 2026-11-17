# Execução da sentença CUBO.0001 (TOTVS RM, wsConsultaSQL)

Documento breve sobre como o SIG deve executar a sentença **CUBO.0001** (antes chamada BPM.CONTR.002). Somente leitura.

## Chamada

- **Endpoint (PRD):** `https://bpmpremoldados199631.rm.cloudtotvs.com.br:8051/wsConsultaSQL/IwsConsultaSQL`
- **Operação:** `RealizarConsultaSQL`
- **SOAPAction:** `"http://www.totvs.com/IwsConsultaSQL/RealizarConsultaSQL"`
- **Autenticação:** HTTP Basic, usuário `integracao` (a senha fica no `.env` do backend, nunca em arquivo versionado nem em log).
- **Content-Type:** `text/xml; charset=utf-8`

| Campo | Valor |
|---|---|
| `codSentenca` | `CUBO.0001` |
| `codColigada` | `1` |
| `codSistema` | `C` (módulo RM Saldus) |
| `codUsuario` | `integracao` |
| `parameters` | `CODCOLIGADA=1;DATA_INICIAL=dd/mm/aaaa;DATA_FINAL=dd/mm/aaaa` |

As datas são sempre no formato **DD/MM/AAAA**. Exemplo para outubro/2026: `CODCOLIGADA=1;DATA_INICIAL=01/10/2026;DATA_FINAL=31/10/2026`.

### Envelope

```xml
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">
  <soap:Header/>
  <soap:Body>
    <tot:RealizarConsultaSQL>
      <tot:codSentenca>CUBO.0001</tot:codSentenca>
      <tot:codColigada>1</tot:codColigada>
      <tot:codSistema>C</tot:codSistema>
      <tot:codUsuario>integracao</tot:codUsuario>
      <tot:parameters>CODCOLIGADA=1;DATA_INICIAL=01/10/2026;DATA_FINAL=31/10/2026</tot:parameters>
    </tot:RealizarConsultaSQL>
  </soap:Body>
</soap:Envelope>
```

## Resposta

O resultado vem como XML escapado dentro de `RealizarConsultaSQLResult`, com um `<Resultado>` por linha:

`ID`, `COD_CLI_FORN`, `FILIAL`, `EMISSAO`, `COD_CUSTO`, `IDPRD`, `SUB_COD_CONTA_4`, `REDUZIDO_CONTA`, `VALOR`, `HISTORICO`.

Sem linhas, o `NewDataSet` vem vazio: não é erro.

## Regras de execução no SIG

1. **Um mês por vez, em três períodos:** dias 1 a 10, 11 a 20 e 21 até o último dia. Cada período é uma chamada, em sequência.
2. **Uma consulta por vez** ao RM por backend, porque cada chamada ocupa uma licença.
3. **Tempo limite de 2000 s** por chamada. A consulta de um mês leva cerca de 90 s no teste; o limite dá margem.
4. **Repetições:** em queda de conexão (`socket hang up`, `ECONNRESET`, `ETIMEDOUT`), 3 tentativas com 3 s de intervalo. Em licença esgotada ("Excedeu numero de licenças"), 3 tentativas com 5 s.
5. **Falha de sentença ou de credencial** não é repetida: aparece como erro com a mensagem do RM.
6. **Se o RM ficar sem memória** (`OutOfMemoryException`), o período é dividido ao meio e cada metade é consultada de novo, até um dia.

## Pontos a confirmar com quem administra o RM

- O filtro por `DATA_INICIAL`/`DATA_FINAL` vale por linha, pela data de emissão (`EMISSAO`), e não pela data do lançamento contábil.
- O campo `ID` da sentença é o `IDMOV` do movimento.
- A sentença de validação (versão `[OTIM]`) é a que vai para produção, com os joins de família e de TTMV reativados conforme o combinado.
