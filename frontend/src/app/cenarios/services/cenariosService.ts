import { api } from "@/lib/api";

import type { Indicador, MesRelatorio, Painel, Resultados } from "@/app/relatorios/services/relatoriosService";

export type MarcacaoCenario = "ORCAMENTO_EMPRESARIAL" | "RESULTADOS_ANTERIORES" | "RESULTADOS_VENDIDOS" | "PREVISAO";

export const MARCACOES: Array<{ valor: MarcacaoCenario; rotulo: string }> = [
  // Os nomes curtos (22/10/2026; antes, Orçamento Empresarial, Resultados Anteriores, Resultados Vendidos e Previsão de Resultados).
  { valor: "ORCAMENTO_EMPRESARIAL", rotulo: "Orçamento" },
  { valor: "RESULTADOS_ANTERIORES", rotulo: "Anterior" },
  { valor: "RESULTADOS_VENDIDOS", rotulo: "Vendido" },
  // 21/10/2026: escolhida no Compara Com de Resultados Empresariais.
  { valor: "PREVISAO", rotulo: "Forecast" },
];
export const rotuloMarcacao = (m: MarcacaoCenario | null) => MARCACOES.find((x) => x.valor === m)?.rotulo ?? null;
/** O rótulo da versão do cenário (13/10/2026): VER00, VER01… */
export const rotuloVersao = (v: number) => `VER${String(v).padStart(2, "0")}`;
/** O cenário nas listas de escolha (13/10/2026): "Exercício - Nome - Versão - Marcação" (a marcação, quando há). */
export const rotuloDoCenario = (c: Pick<Cenario, "ano" | "nome" | "versao" | "marcacao">) =>
  [String(c.ano), c.nome, rotuloVersao(c.versao), rotuloMarcacao(c.marcacao)].filter(Boolean).join(" - ");

/** Particular: só quem criou e os Administradores (o perfil Administrador); Pública: todos com permissão na lista do cenário (11/10/2026). */
export type Visualizacao = "PARTICULAR" | "PUBLICA";

/**
 * O tipo do cenário (13/10/2026): os sintéticos (a DRE importada ou digitada) e os analíticos (a DRE calculada a partir
 * das premissas), em listas separadas, cada uma com a sua permissão; as telas de um cenário são as mesmas nos dois.
 */
export type TipoCenario = "SINTETICO" | "ANALITICO";

/** Uma linha das premissas de um cenário analítico (13/10/2026): uma premissa (digitada) ou um cálculo. */
export type LinhaDaPremissa = {
  chave: string;
  secao: string;
  grupo: string | null;
  rotulo: string;
  und: string;
  tipo: "PREMISSA" | "CALCULO";
  /** A linha em negrito (19/10/2026); sem ele, os cálculos em R$ (os totais). */
  negrito?: boolean;
  casas: number;
  /** A Média de Referência (a média realizada da referência do cenário). */
  referencia: number | null;
  valores: Array<number | null>;
  /** Os meses com a premissa gravada; os demais valem o padrão. */
  gravados: boolean[];
};
export type TabelaDePremissas = { venda: "GLOBAL" | "MERCANTIL"; titulo: string; linhas: LinhaDaPremissa[] };
/**
 * Um grupo de centros de custo no cenário analítico (13/10/2026): o grupo da Controladoria, os centros, o balde (o mais
 * comum; `baldes` com mais de um dá o aviso), o grupo da DRE das contas, o destino do valor e o total do exercício.
 */
export type GrupoDeCentros = {
  grupo: string;
  centros: Array<{ codigo: string | null; nome: string; balde: string | null }>;
  balde: string | null;
  baldes: string[];
  grupoDRE: string;
  unidade: 1 | 2;
  destino: string;
  total: number;
};
/** Uma correspondência tarefa × linha (14/10/2026): a filial (nula: qualquer), a tarefa e o código da linha. */
/** Uma conta com movimentações do realizado fora dos padrões das premissas (14/10/2026). */
export type MovimentacaoForaDoPadrao = {
  chave: string;
  conta: { reduzido: string; descricao: string };
  /** A alocação na DRE: o departamento, a atribuição e a conta de resultado. */
  linha: { codigo: string; departamento: string; atribuicao: string; descricao: string };
  origens: string[];
  /** O total movimentado no período da carga. */
  total: number;
  valores: number[];
  /** Os grupos de centros que podem recebê-la. */
  destinos: Array<{ grupo: string; conta: string; departamento: string }>;
  /** A filial predominante dos lançamentos. */
  filial?: number;
  /** O grupo do padrão (Aplicar Padrão), quando ele pode recebê-la; ausente nas cargas antigas. */
  padrao?: string | null;
};
export type Realocacoes = {
  referencia: string | null;
  movimentacoes: MovimentacaoForaDoPadrao[];
  /** O grupo de centros escolhido para cada conta (nulo: fora do cenário); valem nas próximas cargas. */
  decisoes: Record<string, string | null>;
  aplicadas: Record<string, { grupo: string; conta: string; valores: number[] }>;
  atualizadoEm: string | null;
  atualizadoPor: string | null;
};
export type CorrespondenciaDeTarefa = { filial: number | null; tarefa: string; linha: string };
export type Correspondencias = {
  itens: CorrespondenciaDeTarefa[];
  linhas: Array<{ codigo: string; nome: string; unidade: number; nomeUnidade: string }>;
  /** As linhas desativadas que ainda têm tarefas (14/10/2026). */
  inativas: Array<{ codigo: string; nome: string; nomeUnidade: string }>;
};
export type CentrosDoCenario = { ano: number; meses: Array<{ mes: number; rotulo: string }>; editavel: boolean; grupos: GrupoDeCentros[] };
export type ContasDoCentro = {
  grupo: Omit<GrupoDeCentros, "total">;
  /**
   * O quadro de lotação do grupo (14/10/2026; 19/10/2026: Colaboradores CLT e PJ; 11/11/2026: com linhas na aba Quadro de
   * Lotação, também os Aprendizes e os Estagiários, sem eles nos CLT e nos PJ) e os quadros dos indicadores em que ele
   * entra. `referencia`: a Média de Referência (o mês 0; 15/10/2026).
   */
  lotacao: { aprendizes: SerieDoCentro | null; estagiarios: SerieDoCentro | null; clt: SerieDoCentro; pj: SerieDoCentro; quadro: string; linhasDoQuadro: number };
  /**
   * Os Salários de cada tipo de colaborador (12/11/2026: Aprendizes, Estagiários, CLT e PJ; antes, os dos Aprendizes e dos
   * Estagiários de cada mão de obra), da aba Quadro de Lotação; deles saem as Remunerações da mão de obra principal.
   */
  salarios: Array<{ tipo: "aprendizes" | "estagiarios" | "clt" | "pj"; rotulo: string; valores: number[] }>;
  /** A mão de obra principal do grupo (o prefixo "CPP.MOD"…): a da atribuição dele, que recebe as remunerações do Quadro de Lotação. */
  principal: string | null;
  /** Os Encargos e Benefícios (19/10/2026): os percentuais em %, com o padrão nos meses sem valor gravado, e os Benefícios Adicionais em R$. */
  encargos: Array<SerieDoCentro & { item: string; rotulo: string; und: "%" | "R$" }>;
  /** `calculada`: a conta Encargos e Benefícios (19/10/2026) e, com o Quadro de Lotação, as Remunerações (`doQuadro`, 09/11/2026). */
  contas: Array<SerieDoCentro & { codigo: string; descricao: string; atribuicao: string; calculada: boolean; doQuadro: boolean }>;
};

/** Um mês de uma linha do Quadro de Lotação do cenário (09/11/2026): os colaboradores e o Salário Bruto e a Insalubridade / Periculosidade de cada um. */
export type MesDoQuadro = { colaboradores: number; salarioBruto: number; adicional: number };
export type CampoDoMes = keyof MesDoQuadro;
/** Uma linha da aba Quadro de Lotação: os cadastros (como no Lançamento Inicial), o grupo do centro (null: fora dos grupos) e os doze meses. */
export type LinhaDoQuadroDoCenario = {
  id: string;
  unidadeNegocioId: string;
  unidade: string;
  vinculo: "CLT" | "PJ";
  senioridadeId: string;
  senioridade: string;
  aprendiz: boolean;
  /** A senioridade Estagiário (11/11/2026): os estagiários e os bolsistas. */
  estagiario: boolean;
  funcaoId: string;
  funcao: string;
  centroCustoId: string;
  centro: string;
  grupo: string | null;
  meses: MesDoQuadro[];
};
export type QuadroDoCenario = {
  ano: number;
  meses: Array<{ mes: number; rotulo: string }>;
  editavel: boolean;
  linhas: LinhaDoQuadroDoCenario[];
  opcoes: {
    unidades: Array<{ id: string; nome: string }>;
    senioridades: Array<{ id: string; nome: string }>;
    funcoes: Array<{ id: string; nome: string; senioridadeId: string | null }>;
    centros: Array<{ id: string; nome: string; grupo: string }>;
  };
};
/** Os dados de uma linha: os cadastros e, na nova, os doze meses. */
export type DadosDaLinhaDoQuadro = Pick<LinhaDoQuadroDoCenario, "unidadeNegocioId" | "vinculo" | "senioridadeId" | "funcaoId" | "centroCustoId"> & { meses?: MesDoQuadro[] };
export type SerieDoCentro = { referencia: number | null; valores: number[]; gravados: boolean[] };
export type RateiosDoCenario = {
  ano: number;
  meses: Array<{ mes: number; rotulo: string }>;
  rateios: Array<{ chave: string; destino: string; rotulo: string; base: string; bases: number[]; percentuais: number[] }>;
  /** Os valores dos grupos de rateio num mês em que a chave não tem base nas premissas (13/10/2026): ficam fora da DRE. */
  semBase: Array<{ chave: string; nome: string; mes: number; rotuloMes: string; valor: number }>;
};
/** Um investimento do cenário analítico (13/10/2026), com a depreciação mensal calculada (19/10/2026: sem o ROI). */
export type InvestimentoDoCenario = {
  id: string;
  /** O Nome de Referência (15/10/2026): digitado, único no cenário; identifica o investimento na planilha das premissas. */
  nomeReferencia: string;
  unidade: 1 | 2 | 3 | 4;
  conta: string;
  descricao: string;
  /** A condição de pagamento (19/10/2026), em texto livre. */
  condicaoPagamento: string | null;
  inicio: number;
  valorTotal: number;
  valorPosUso: number;
  vidaUtil: number;
  depreciacaoMensal: number;
};
export type DadosDoInvestimento = Pick<InvestimentoDoCenario, "nomeReferencia" | "unidade" | "descricao" | "condicaoPagamento" | "inicio" | "valorTotal" | "valorPosUso" | "vidaUtil">;
export type InvestimentosDoCenario = {
  ano: number;
  meses: Array<{ mes: number; rotulo: string }>;
  editavel: boolean;
  contas: Array<{ unidade: 1 | 2 | 3 | 4; nomeUnidade: string; conta: string; rotulo: string }>;
  depreciacao: LinhaDaPremissa[];
  investimentos: InvestimentoDoCenario[];
};
export type ExtraDoCenario = { ano: number; meses: Array<{ mes: number; rotulo: string }>; editavel: boolean; tabelas: Array<{ unidade: 4 | 5; nome: string; linhas: LinhaDaPremissa[] }> };
export type PremissasDaUnidade = { ano: number; unidade: 1 | 2 | 3; nome: string; meses: Array<{ mes: number; rotulo: string }>; editavel: boolean; tabelas: TabelaDePremissas[] };
/**
 * O caminho, o nome e as permissões de cada tipo (14/10/2026: por tela e por aba). `area` é o prefixo das áreas das
 * telas (cenarios_resultados, cenarios_analiticos_premissas.matriz…); `ler` é a leitura do grupo (alguma tela), e
 * `editar`, a criação de cenários (a edição da Lista de Cenários).
 */
export const DO_TIPO: Record<TipoCenario, { base: string; titulo: string; area: string; ler: string; editar: string }> = {
  SINTETICO: { base: "/cenarios/sinteticos", titulo: "Cenários Sintéticos", area: "cenarios", ler: "cenarios:ler", editar: "cenarios_lista:editar" },
  ANALITICO: { base: "/cenarios/analiticos", titulo: "Cenários Analíticos", area: "cenarios_analiticos", ler: "cenarios_analiticos:ler", editar: "cenarios_analiticos_lista:editar" },
};
/** O tipo pela rota da tela. */
export const tipoDaRota = (pathname: string): TipoCenario => (pathname.startsWith("/cenarios/analiticos") ? "ANALITICO" : "SINTETICO");
export const ROTULO_VISUALIZACAO: Record<Visualizacao, string> = { PARTICULAR: "Particular", PUBLICA: "Pública" };

/** Uma parte da referência dos sintéticos (15/10/2026): a origem e os meses do cenário (`mesDe`–`mesAte`) que ela preenche. */
export type ParteDaReferencia =
  | { tipo: "REALIZADO"; ano: number; modo: "MES_A_MES" | "MEDIA"; de?: number; ate?: number; mesDe: number; mesAte: number }
  | { tipo: "CENARIO"; origemId: string; mesDe: number; mesAte: number };

export type Cenario = {
  id: string;
  nome: string;
  ano: number;
  tipo: TipoCenario;
  descricao: string | null;
  marcacao: MarcacaoCenario | null;
  nomeArquivo: string | null;
  importadoEm: string | null;
  criadoPor: string | null;
  criadoPorId: string | null;
  visualizacao: Visualizacao;
  /** O cenário com que este se compara (o comparativo, 12/10/2026); com ele, a tela Justificativas aparece. */
  comparadoComId: string | null;
  /**
   * O versionamento (13/10/2026): a versão (0 = VER00), a família (o id da VER00; nulo nela), a versão de origem da
   * revisão e quando e por quem a versão foi congelada (versaoSalva*: o nome antigo, de quando o botão era Salvar Versão).
   */
  versao: number;
  familiaId: string | null;
  revisaoDeId: string | null;
  versaoSalvaEm: string | null;
  versaoSalvaPor: string | null;
  /** A versão mais alta da família (13/10/2026: o filtro Apenas Vigentes). */
  vigente: boolean;
  /** Com mais de uma versão na família, o nome não muda (é o mesmo em todas). */
  nomeTravado: boolean;
  /** Quem criou o cenário e os Administradores mudam a visualização. */
  podeMudarVisualizacao: boolean;
  /**
   * A Edição das Configurações (12/11/2026): Particular, só quem criou e o Administrador alteram a tela Configurações; Pública,
   * todos com a permissão do perfil. `podeEditarConfiguracoes`: se o usuário as altera por ela.
   */
  edicaoConfiguracoes: Visualizacao;
  podeEditarConfiguracoes: boolean;
  /** As movimentações fora dos padrões da última carga do realizado e as realocações delas (analíticos, 14/10/2026). */
  realocacoes: Realocacoes | null;
  /** Nos analíticos (14/10/2026): os avisos dos rateios no exercício e se as regras mudaram depois do último cálculo. */
  rateios?: { avisos: string[]; desatualizados: boolean } | null;
  /** Os Reajustes das Premissas aplicados na DRE (analíticos, 11/11/2026: Premissas / Reajustes, Aplicar ou Remover Reajustes). */
  reajustesAplicados: boolean;
  criadoEm: string;
  /** As visões da DRE com valor (0 Consolidado, 1 a 5 as unidades). */
  visoes: number[];
  /** Os indicadores com meta. */
  indicadores: number;
  /** O total do exercício no Consolidado (a coluna Resultados da lista, 13/10/2026): o valor e o % como na tela Resultados; null sem DRE. */
  resultados: Record<"rol" | "cpv" | "ebitda" | "rl", { valor: number; pct: number | null }> | null;
};

/** O que a tela fez numa gravação de valores (o histórico de reajustes). */
export type OrigemDaGravacao = { tipo: "MARCADOS" | "VALOR"; modo: "PERCENTUAL" | "ABSOLUTO" | "DIGITADO"; reajuste: number | null; replicado: boolean };
/** Uma linha do histórico de reajustes. */
export type ReajusteDoCenario = {
  id: string;
  criadoEm: string;
  usuarioNome: string;
  /** RECALCULO (14/10/2026), MEDIAS e IMPORTACAO (15/10/2026: Replicar Médias / Apagar Valores e Importar Valores). */
  tipo: "MARCADOS" | "VALOR" | "REFERENCIA" | "RECALCULO" | "MEDIAS" | "IMPORTACAO";
  modo: "PERCENTUAL" | "ABSOLUTO" | "DIGITADO" | null;
  reajuste: number | null;
  visao: number | null;
  replicado: boolean;
  /** As contas alteradas, com o departamento e a atribuição da linha delas na Estrutura da DRE. */
  contas: Array<{ codigo: string; descricao: string; departamento: string | null; atribuicao: string | null }>;
  meses: number[];
  valores: number;
  somaAntes: number | null;
  somaDepois: number | null;
  descricao: string | null;
};

/** O comparativo: o cenário comparado, os que se podem escolher e a variação máxima (%) de cada total da DRE (nula: não verifica). */
export type Comparativo = {
  comparadoCom: { id: string; nome: string; ano: number } | null;
  /** Os cenários que se podem escolher; `vigente`: a versão mais recente da família (13/10/2026). */
  /** Os cenários dos dois tipos (13/10/2026): o tipo vai numa etiqueta. */
  opcoes: Array<{ id: string; nome: string; ano: number; tipo: TipoCenario; marcacao: MarcacaoCenario | null; versao: number; vigente: boolean }>;
  /**
   * As linhas da DRE vigente (14/10/2026; antes, só os totais): totais, atribuições e contas. `verificada`: a linha sem
   * nada embaixo (a conta, ou o total e a atribuição sem contas), a que tem a variação máxima.
   */
  linhas: Array<{ codigo: string; descricao: string; tipo: string; verificada: boolean; limite: number | null; /** Nos analíticos, a chave do índice da conta. */ indice: string | null }>;
  /** Os Índices de Reajuste (19/10/2026): só nos analíticos, que escolhem um por conta; nulo nos sintéticos (a variação digitada). */
  indices: IndiceDeReajuste[] | null;
};
/** Um Índice de Reajuste do cenário analítico (19/10/2026; Configurações / Índices). */
export type IndiceDeReajuste = { chave: string; descricao: string; observacao: string | null; variacao: number };
/** Um reajuste de um Índice de Reajuste das Premissas (11/11/2026): o percentual (5 = 5%) e o mês em que começa (1 a 12). */
export type ReajusteDoIndice = { valor: number; mes: number };
/** Um Índice de Reajuste das Premissas dos analíticos (11/11/2026; Premissas / Reajustes): até quatro reajustes. */
export type IndiceDosReajustes = { chave: string; descricao: string; observacao: string | null; reajustes: ReajusteDoIndice[] };
/** A aba Reajustes das Premissas: os índices (com as contas de cada um), as linhas da Aplicação dos Reajustes e se estão aplicados. */
export type ReajustesDasPremissas = {
  ano: number;
  meses: Array<{ mes: number; rotulo: string }>;
  editavel: boolean;
  aplicados: boolean;
  /** As contas que os reajustes mudam: sem nenhuma, não há o que aplicar. */
  contasComReajuste: number;
  indices: Array<IndiceDosReajustes & { contas: number }>;
  /** As linhas da DRE (sem Produção e Serviços): `verificada`, a conta, que recebe o índice. */
  linhas: Array<{ codigo: string; descricao: string; tipo: string; verificada: boolean; indice: string | null }>;
};
/** Uma linha acima da variação máxima: os meses (o valor, o comparado e a variação em %; nula sem base) e a justificativa. */
export type ItemJustificativa = {
  codigo: string;
  descricao: string;
  total: string;
  /** O total sem contas embaixo, verificado ele mesmo. */
  ehTotal: boolean;
  limite: number;
  meses: Array<{ mes: number; valor: number; comparado: number; variacao: number | null }>;
  justificativa: { texto: string; usuarioNome: string; atualizadoEm: string } | null;
};
export type Justificativas = { comparadoCom: { id: string; nome: string; ano: number } | null; visoes: Array<{ visao: number; nome: string; itens: ItemJustificativa[] }> };

/** Quantos valores entram, mudam e saem do cenário. */
export type Mudancas = { novas: number; alteradas: number; removidas: number; semMudanca: boolean };
/** A prévia da importação: o que o arquivo traz, aba por aba, e o que muda no cenário. */
export type PreviaCenario = {
  hash: string;
  nomeArquivo: string;
  ano: number;
  cenario: { id: string; nome: string; ano: number } | null;
  /** O que impede a importação (o exercício do arquivo diferente do do cenário). */
  bloqueio: string | null;
  visoes: Array<{ visao: number; nome: string; aba: string; meses: number; linhas: number; semPar: string[]; valores: number; acao: "NOVA" | "SUBSTITUI"; mudancas: Mudancas }>;
  faltam: Array<{ nome: string; temValores: boolean }>;
  metas: { aba: string; indicadores: number; meses: number; ignorados: string[]; acao: "NOVA" | "SUBSTITUI"; mudancas: Mudancas; digitados: number } | null;
  metasAtuais: number;
  ignoradas: string[];
};

/** RESULTADO: sai da DRE do cenário; MANUAL: lançamento manual; CALCULADO: DRE e lançamentos (eficiências); IMPORTADO: da aba das metas. */
export type ClasseIndicador = "RESULTADO" | "MANUAL" | "CALCULADO" | "IMPORTADO";
export type IndicadorDoCenario = Indicador & { classe: ClasseIndicador; digitados: boolean[] };
/** `comparado`: o cenário comparado (13/10/2026), cujo acumulado vem em `totalOrcado` de cada indicador. */
export type IndicadoresDoCenario = { ano: number; ate: number; meses: MesRelatorio[]; indicadores: IndicadorDoCenario[]; comparado?: { nome: string; ano: number } | null };

/** A análise de uma planilha do Importar Valores (15/10/2026): o padrão, as abas e as mudanças (os meses e as justificativas). */
/** Um investimento lido da aba Investimentos da planilha (15/10/2026). */
export type InvestimentoDaPlanilha = DadosDoInvestimento & { numero: number };
export type AnaliseDePremissas = {
  arquivo: string;
  valido: boolean;
  erros: string[];
  avisos: string[];
  abas: string[];
  /** Os trechos do arquivo (a unidade, cada centro, a depreciação base de uma unidade…), para conferir os repetidos (15/10/2026). */
  blocos: string[];
  linhas: number;
  alteracoes: Array<{ chave: string; mes: number; valor: number | null; bloco: string }>;
  justificativas: Array<{ chave: string; texto: string | null; bloco: string }>;
  investimentos: { novos: InvestimentoDaPlanilha[]; alterados: Array<InvestimentoDaPlanilha & { id: string }> };
  /**
   * As linhas da aba Quadro de Lotação (09/11/2026): as novas e as alteradas, já com os cadastros, e (11/11/2026: a aba substitui
   * as linhas do cenário nos departamentos do arquivo) as que saem.
   */
  quadro: { novas: LinhaDoQuadroDaPlanilha[]; alteradas: Array<LinhaDoQuadroDaPlanilha & { id: string }>; excluidas: Array<{ id: string; descricao: string }> };
};
export type LinhaDoQuadroDaPlanilha = Required<DadosDaLinhaDoQuadro> & { descricao: string };
/** Os departamentos do Exportar Premissas (15/10/2026). */
export const DEPARTAMENTOS_DAS_PREMISSAS = [
  { chave: "PRODUCAO", nome: "Produção", detalhe: "Matriz, Filial, os centros de custo de produção e a depreciação e os investimentos da Matriz e da Filial" },
  { chave: "SERVICOS", nome: "Serviços", detalhe: "Serviços, os centros de custo de serviços e a depreciação e os investimentos de Serviços" },
  { chave: "LOGISTICA", nome: "Logística", detalhe: "os centros de custo de logística" },
  { chave: "TECNICO", nome: "Técnico", detalhe: "os centros de custo técnicos" },
  { chave: "COMERCIAL", nome: "Comercial", detalhe: "os centros de custo comerciais" },
  { chave: "ADMINISTRATIVO", nome: "Administrativo", detalhe: "os centros de custo administrativos" },
  { chave: "EXTRA", nome: "Extra-Operacional", detalhe: "a aba Extra-Operacional" },
] as const;
export type DepartamentoDasPremissas = (typeof DEPARTAMENTOS_DAS_PREMISSAS)[number]["chave"];

export const cenariosService = {
  /** Replicar Médias / Apagar Valores (15/10/2026), em todas as abas das premissas. */
  replicarMedias: async (id: string, acao: "replicar" | "apagar") =>
    (await api.post<{ data: { linhas: number; valores: number } }>(`/proxy/cenarios/${id}/premissas/medias`, { acao })).data.data,
  /** O Importar Valores, passo 1: confere um arquivo (um .zip vira uma análise por planilha). */
  analisarPremissas: async (id: string, arquivo: File) =>
    (
      await api.post<{ data: AnaliseDePremissas[] }>(`/proxy/cenarios/${id}/premissas/importar/analise`, arquivo, {
        params: { arquivo: arquivo.name },
        headers: { "Content-Type": "application/octet-stream" },
      })
    ).data.data,
  /** O Importar Valores, passo 2: grava as mudanças das planilhas válidas. */
  importarPremissas: async (id: string, arquivos: Array<Pick<AnaliseDePremissas, "arquivo" | "alteracoes" | "justificativas" | "investimentos" | "quadro">>) =>
    (
      await api.post<{ data: { valores: number; justificativas: number; investimentosNovos: number; investimentosAlterados: number; quadroNovas: number; quadroAlteradas: number; quadroExcluidas: number } }>(`/proxy/cenarios/${id}/premissas/importar`, {
        arquivos: arquivos.map(({ arquivo, alteracoes, justificativas, investimentos, quadro }) => ({
          arquivo,
          alteracoes: alteracoes.map(({ chave, mes, valor }) => ({ chave, mes, valor })),
          justificativas: justificativas.map(({ chave, texto }) => ({ chave, texto })),
          investimentos: {
            novos: investimentos.novos.map(({ numero: _n, ...i }) => i),
            alterados: investimentos.alterados.map(({ numero: _n, ...i }) => i),
          },
          quadro: {
            novas: quadro.novas.map(({ descricao: _d, ...l }) => l),
            alteradas: quadro.alteradas.map(({ descricao: _d, ...l }) => l),
            excluidas: quadro.excluidas.map(({ id }) => ({ id })),
          },
        })),
      })
    ).data.data,
  /** O Exportar Premissas (15/10/2026): o arquivo dos departamentos marcados, no tipo escolhido. */
  exportarPremissas: async (id: string, escopo: "todas" | "centros_abas" | "centros_arquivos", departamentos: DepartamentoDasPremissas[]) =>
    api.get<Blob>(`/proxy/cenarios/${id}/premissas/exportar`, { params: { escopo, departamentos: departamentos.join(","), formato: "xlsx" }, responseType: "blob" }),
  centros: async (id: string) => (await api.get<{ data: CentrosDoCenario }>(`/proxy/cenarios/${id}/centros`)).data.data,
  centro: async (id: string, grupo: string) => (await api.get<{ data: ContasDoCentro }>(`/proxy/cenarios/${id}/centros/contas`, { params: { grupo } })).data.data,
  gravarCentro: async (id: string, grupo: string, alteracoes: Array<{ linha: string; mes: number; valor: number | null }>, origem?: OrigemDaGravacao) =>
    (await api.put<{ data: { alteradas: number; meses: number[] } }>(`/proxy/cenarios/${id}/centros`, { grupo, alteracoes, origem })).data.data,
  /** A aba Quadro de Lotação dos analíticos (09/11/2026, etapa 4 da Gestão de Colaboradores). */
  quadro: async (id: string) => (await api.get<{ data: QuadroDoCenario }>(`/proxy/cenarios/${id}/quadro`)).data.data,
  criarLinhaDoQuadro: async (id: string, dados: DadosDaLinhaDoQuadro) => (await api.post<{ data: QuadroDoCenario }>(`/proxy/cenarios/${id}/quadro`, dados)).data.data,
  alterarLinhaDoQuadro: async (id: string, linhaId: string, dados: DadosDaLinhaDoQuadro) => (await api.put<{ data: QuadroDoCenario }>(`/proxy/cenarios/${id}/quadro/${linhaId}`, dados)).data.data,
  excluirLinhaDoQuadro: async (id: string, linhaId: string) => (await api.delete<{ data: QuadroDoCenario }>(`/proxy/cenarios/${id}/quadro/${linhaId}`)).data.data,
  excluirLinhasDoQuadro: async (id: string, ids: string[]) => (await api.post<{ data: QuadroDoCenario }>(`/proxy/cenarios/${id}/quadro/excluir`, { ids })).data.data,
  gravarMesesDoQuadro: async (id: string, alteracoes: Array<{ linha: string; mes: number; campo: CampoDoMes; valor: number | null }>) =>
    (await api.put<{ data: QuadroDoCenario }>(`/proxy/cenarios/${id}/quadro/meses`, { alteracoes })).data.data,
  investimentos: async (id: string) => (await api.get<{ data: InvestimentosDoCenario }>(`/proxy/cenarios/${id}/investimentos`)).data.data,
  criarInvestimento: async (id: string, dados: DadosDoInvestimento) => (await api.post<{ data: InvestimentosDoCenario }>(`/proxy/cenarios/${id}/investimentos`, dados)).data.data,
  alterarInvestimento: async (id: string, investimentoId: string, dados: DadosDoInvestimento) =>
    (await api.put<{ data: InvestimentosDoCenario }>(`/proxy/cenarios/${id}/investimentos/${investimentoId}`, dados)).data.data,
  /** O Excluir Selecionados dos investimentos (15/10/2026). */
  excluirInvestimentos: async (id: string, ids: string[]) => (await api.post<{ data: InvestimentosDoCenario }>(`/proxy/cenarios/${id}/investimentos/excluir`, { ids })).data.data,
  excluirInvestimento: async (id: string, investimentoId: string) => (await api.delete<{ data: InvestimentosDoCenario }>(`/proxy/cenarios/${id}/investimentos/${investimentoId}`)).data.data,
  extraOperacional: async (id: string) => (await api.get<{ data: ExtraDoCenario }>(`/proxy/cenarios/${id}/extra-operacional`)).data.data,
  gravarMensais: async (id: string, tipo: "BASE" | "EXTRA", alteracoes: Array<{ linha: string; mes: number; valor: number | null }>, origem?: OrigemDaGravacao) =>
    (await api.put<{ data: { alteradas: number; meses: number[] } }>(`/proxy/cenarios/${id}/mensais`, { tipo, alteracoes, origem })).data.data,
  rateios: async (id: string) => (await api.get<{ data: RateiosDoCenario }>(`/proxy/cenarios/${id}/rateios`)).data.data,
  premissas: async (id: string, unidade: 1 | 2 | 3) => (await api.get<{ data: PremissasDaUnidade }>(`/proxy/cenarios/${id}/premissas`, { params: { unidade } })).data.data,
  gravarPremissas: async (id: string, unidade: 1 | 2 | 3, alteracoes: Array<{ venda: "GLOBAL" | "MERCANTIL"; chave: string; mes: number; valor: number | null }>, origem?: OrigemDaGravacao) =>
    (await api.put<{ data: { alteradas: number; meses: number[] } }>(`/proxy/cenarios/${id}/premissas`, { unidade, alteracoes, origem })).data.data,
  listar: async (tipo: TipoCenario = "SINTETICO") => (await api.get<{ data: Cenario[] }>("/proxy/cenarios", { params: { tipo } })).data.data,
  obter: async (id: string) => (await api.get<{ data: Cenario }>(`/proxy/cenarios/${id}`)).data.data,
  criar: async (dados: { nome: string; ano: number; descricao: string | null; copiarDe: string | null; visualizacao: Visualizacao; tipo: TipoCenario }) => (await api.post<{ data: Cenario }>("/proxy/cenarios", dados)).data.data,
  atualizar: async (id: string, dados: { nome: string; descricao: string | null; visualizacao: Visualizacao; edicaoConfiguracoes?: Visualizacao }) => (await api.patch<{ data: Cenario }>(`/proxy/cenarios/${id}`, dados)).data.data,
  excluir: async (id: string) => {
    await api.delete(`/proxy/cenarios/${id}`);
  },
  marcar: async (id: string, marcacao: MarcacaoCenario | null) =>
    (await api.put<{ data: { desmarcado: string | null } }>(`/proxy/cenarios/${id}/marcacao`, { marcacao })).data.data,
  /** Importação, passo 1: o arquivo vai cru no corpo; devolve a prévia (nada é gravado). */
  analisar: async (arquivo: File, cenarioId: string | null, onProgresso?: (percentual: number) => void) =>
    (
      await api.post<{ data: PreviaCenario }>("/proxy/cenarios/importar/analise", arquivo, {
        params: { nomeArquivo: arquivo.name, ...(cenarioId ? { cenarioId } : {}) },
        headers: { "Content-Type": "application/octet-stream" },
        onUploadProgress: (e) => {
          if (e.total) onProgresso?.(Math.round((e.loaded / e.total) * 100));
        },
      })
    ).data.data,
  /** Importação, passo 2: grava o que a prévia mostrou, no cenário ou num cenário novo (nome e descrição). */
  importar: async (previa: PreviaCenario, destino: { cenarioId: string } | { nome: string; ano: number; descricao: string | null; visualizacao: Visualizacao }) =>
    (
      await api.post<{ data: { cenario: Cenario; previa: PreviaCenario } }>("/proxy/cenarios/importar", {
        hash: previa.hash,
        nomeArquivo: previa.nomeArquivo,
        ...destino,
      })
    ).data.data,
  /** Uma visão da DRE para a edição: todas as linhas e os doze meses; `editaveis` são as contas que se editam. */
  edicao: async (id: string, visao: number) =>
    (await api.get<{ data: Resultados & { editaveis: string[] } }>(`/proxy/cenarios/${id}/edicao`, { params: { visao } })).data.data,
  /** Grava valores mensais de contas de uma unidade (1 a 5); os totais e o Consolidado se recalculam. */
  gravarValores: async (id: string, visao: number, alteracoes: Array<{ linha: string; mes: number; valor: number }>, origem?: OrigemDaGravacao) =>
    (await api.put<{ data: { alteradas: number; meses: number[] } }>(`/proxy/cenarios/${id}/edicao/valores`, { visao, alteracoes, origem })).data.data,
  /** O histórico de reajustes do cenário, do mais recente ao mais antigo. */
  reajustes: async (id: string) => (await api.get<{ data: ReajusteDoCenario[] }>(`/proxy/cenarios/${id}/reajustes`)).data.data,
  /** A referência pelo resultado realizado: a DRE das competências fechadas do exercício substitui a do cenário. */
  /** Mês a mês (os meses fechados) ou a média de um período (de–ate) replicada nos doze meses. */
  /** No analítico (14/10/2026), com os avisos do que não coube nas premissas. */
  /** Com `manterMeses` (11/11/2026), só as Médias de Referência mudam: os doze meses do cenário ficam. */
  /** Com `importarQuadro` (12/11/2026), as linhas da aba Quadro de Lotação pelo QL Realizado mais recente da Gestão de Colaboradores. */
  referenciaRealizado: async (
    id: string,
    ano: number,
    opcoes: { modo: "MES_A_MES" | "MEDIA"; de?: number; ate?: number; manterMeses?: boolean; importarQuadro?: boolean } = { modo: "MES_A_MES" },
  ) =>
    (
      await api.post<{ data: Cenario & { avisos?: string[]; quadroVigente?: { competencia: string; colaboradores: number; linhas: number } } }>(
        `/proxy/cenarios/${id}/referencia/realizado`,
        { ano, ...opcoes },
      )
    ).data.data,
  /** A referência dos sintéticos por cenários e realizados (15/10/2026): uma ou duas partes, sem meses em comum. */
  referenciaComposta: async (id: string, partes: ParteDaReferencia[]) =>
    (await api.post<{ data: Cenario & { avisos?: string[] } }>(`/proxy/cenarios/${id}/referencia/composta`, { partes })).data.data,
  /** A referência de um analítico por outro analítico (14/10/2026). */
  referenciaCenario: async (id: string, origemId: string, manterMeses = false) =>
    (await api.post<{ data: Cenario }>(`/proxy/cenarios/${id}/referencia/cenario`, { origemId, manterMeses })).data.data,
  /** A correspondência tarefa × linha (14/10/2026), nos Cadastros da Controladoria / Linhas. */
  correspondencias: async () => (await api.get<{ data: Correspondencias }>("/proxy/cadastros/linhas/correspondencias")).data.data,
  gravarCorrespondencias: async (itens: CorrespondenciaDeTarefa[]) => (await api.put<{ data: Correspondencias }>("/proxy/cadastros/linhas/correspondencias", { itens })).data.data,
  resultados: async (id: string, visao: number) => (await api.get<{ data: Resultados }>(`/proxy/cenarios/${id}/resultados`, { params: { visao } })).data.data,
  /** O Painel de Bordo do cenário no mês `ate` (1 a 12): o cenário × o comparado. */
  painel: async (id: string, ate: number) =>
    (await api.get<{ data: Painel & { comparado: { nome: string; ano: number } | null } }>(`/proxy/cenarios/${id}/painel`, { params: { ate } })).data.data,
  indicadores: async (id: string) => (await api.get<{ data: IndicadoresDoCenario }>(`/proxy/cenarios/${id}/indicadores`)).data.data,
  /** Congelar Versão: trava o cenário. */
  /** Recalcula a DRE do analítico com as regras de rateio de hoje (14/10/2026), com os reajustes como estão (aplicados ou não). */
  recalcular: async (id: string) => (await api.post<{ data: Cenario }>(`/proxy/cenarios/${id}/recalcular`)).data.data,
  congelarVersao: async (id: string) => (await api.post<{ data: Cenario }>(`/proxy/cenarios/${id}/versao`)).data.data,
  /** Reabrir Versão: destrava a versão congelada. */
  reabrirVersao: async (id: string) => (await api.post<{ data: Cenario }>(`/proxy/cenarios/${id}/versao/reabrir`)).data.data,
  /** Criar Revisão: a cópia da versão congelada numa versão nova, aberta para edição (devolve o cenário novo). */
  criarRevisao: async (id: string) => (await api.post<{ data: Cenario }>(`/proxy/cenarios/${id}/revisao`)).data.data,
  comparativo: async (id: string) => (await api.get<{ data: Comparativo }>(`/proxy/cenarios/${id}/comparativo`)).data.data,
  /** Sintéticos: `limites` (a variação de cada conta); analíticos: `indices` (a chave do índice de cada conta). */
  gravarComparativo: async (id: string, dados: { comparadoComId: string | null; limites?: Record<string, number | null>; indices?: Record<string, string | null> }) =>
    (await api.put<{ data: Comparativo }>(`/proxy/cenarios/${id}/comparativo`, dados)).data.data,
  /** Os Índices de Reajuste do cenário analítico (19/10/2026), com quantas contas do Comparativo usam cada um. */
  indices: async (id: string) => (await api.get<{ data: { indices: Array<IndiceDeReajuste & { contas: number }> } }>(`/proxy/cenarios/${id}/indices`)).data.data,
  gravarIndices: async (id: string, indices: Array<{ chave: string | null; descricao: string; observacao: string | null; variacao: number }>) =>
    (await api.put<{ data: { indices: Array<IndiceDeReajuste & { contas: number }> } }>(`/proxy/cenarios/${id}/indices`, { indices })).data.data,
  /** A aba Reajustes das Premissas dos analíticos (11/11/2026): os Índices de Reajuste e a Aplicação dos Reajustes. */
  reajustesDasPremissas: async (id: string) => (await api.get<{ data: ReajustesDasPremissas }>(`/proxy/cenarios/${id}/premissas/reajustes`)).data.data,
  gravarIndicesDosReajustes: async (id: string, indices: Array<{ chave: string | null; descricao: string; observacao: string | null; reajustes: ReajusteDoIndice[] }>) =>
    (await api.put<{ data: ReajustesDasPremissas }>(`/proxy/cenarios/${id}/premissas/reajustes/indices`, { indices })).data.data,
  /** Aplicar (true) ou Remover (false) Reajustes na DRE: nunca duas vezes seguidas. */
  aplicarReajustes: async (id: string, aplicados: boolean) =>
    (await api.put<{ data: ReajustesDasPremissas }>(`/proxy/cenarios/${id}/premissas/reajustes/aplicados`, { aplicados })).data.data,
  /** O índice de cada conta (nulo: sem reajuste). */
  gravarAplicacaoDosReajustes: async (id: string, indices: Record<string, string | null>) =>
    (await api.put<{ data: ReajustesDasPremissas }>(`/proxy/cenarios/${id}/premissas/reajustes/aplicacao`, { indices })).data.data,
  /** Grava as realocações das movimentações fora dos padrões (o grupo de cada conta, ou nulo). */
  gravarRealocacoes: async (id: string, decisoes: Record<string, string | null>) =>
    (await api.put<{ data: Cenario }>(`/proxy/cenarios/${id}/realocacoes`, { decisoes })).data.data,
  justificativas: async (id: string) => (await api.get<{ data: Justificativas }>(`/proxy/cenarios/${id}/justificativas`)).data.data,
  /** Grava a justificativa de uma linha numa visão; o texto vazio a apaga. */
  gravarJustificativa: async (id: string, visao: number, linha: string, texto: string) => {
    await api.put(`/proxy/cenarios/${id}/justificativas`, { visao, linha, texto });
  },
  salvarManual: async (id: string, nome: string, valores: Array<number | null>) => {
    await api.put(`/proxy/cenarios/${id}/indicadores/manuais`, { nome, valores });
  },
};
