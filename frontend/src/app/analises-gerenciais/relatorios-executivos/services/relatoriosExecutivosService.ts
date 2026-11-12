import { api } from "@/lib/api";

import type { Indicadores, MarcacaoComparavel, Painel, Resultados } from "@/app/relatorios/services/relatoriosService";
import type { MarcacaoCenario } from "@/app/cenarios/services/cenariosService";

/**
 * Os Relatórios Executivos (15/10/2026, Análises Gerenciais): um relatório por competência fechada, com sete abas (17/10/2026:
 * Introdução, Resultados, Comercial, Produção, Serviços e Administrativo; 20/10/2026: a Capa, antes da Introdução); Capa,
 * Introdução e Resultados todos os que editam a tela editam,
 * e as performances, cada gestor pelo recorte de departamentos; cada aba tem a sua situação.
 */
export type Situacao = "EM_ELABORACAO" | "FINALIZADO";
export type AbaResumida = { chave: string; nome: string; situacao: Situacao };
export type ResumoDoRelatorio = {
  id: string;
  ano: number;
  mes: number;
  rotuloMes: string;
  situacao: Situacao;
  finalizadas: number;
  total: number;
  /** As abas que o usuário edita, com a situação de cada uma. */
  minhas: AbaResumida[];
  criadoPor: string;
  criadoEm: string;
  atualizadoEm: string;
};
export type ListaDeRelatorios = {
  relatorios: ResumoDoRelatorio[];
  /** As competências fechadas ainda sem relatório. */
  livres: Array<{ ano: number; mes: number; rotulo: string }>;
  meusDepartamentos: Array<{ chave: string; nome: string }>;
};

/** Os dados dos cards antes do gráfico (12/11/2026): só o Atual ou só o Acumulado (sem o campo, os dois). */
export type PeriodosDoCard = "ATUAL" | "ACUMULADO";
/** Um bloco da grade: a posição e o tamanho (colunas e linhas) e o conteúdo. */
export type Posicao = { id: string; x: number; y: number; w: number; h: number };
export type Nota = "POSITIVO" | "NEGATIVO" | "ATENCAO";
export type Bloco = Posicao &
  (
    | {
        tipo: "PAINEL";
        aba: "resultados" | "performance";
        quadro: string;
        titulo: string;
        sigla: string;
        comGrafico: boolean;
        /** Com o gráfico, só o do acumulado (22/10/2026); sem isso, os meses e o acumulado. */
        soAcumulado?: boolean;
        /** Os dados antes do gráfico (12/11/2026): só o Atual ou só o Acumulado; sem ele, os dois. */
        periodos?: PeriodosDoCard;
        /** As opções do gráfico do card (16/10/2026), como no Configurar Gráficos do Painel; sem elas, as do navegador. */
        tipoGrafico?: "barras" | "area";
        comRotulos?: boolean;
        cores?: "padrao" | "daltonismo";
        /** O Zoom do card (30/10/2026): o conteúdo inteiro maior (1,25 a 3), no mesmo bloco; sem ele, 1. */
        zoom?: number;
        /** O card PROVA (31/10/2026): o realizado contra os cenários da Comparação PROVA do relatório (a lista de marcações é de antes dela e vale o mesmo); sem ele, o card padrão. */
        prova?: true | MarcacaoComparavel[];
      }
    /**
     * O gráfico do card do indicador (22/10/2026): os meses e o acumulado ou só o acumulado; sem ele, só os valores. As
     * opções do gráfico, como as dos cards do Painel.
     */
    | { tipo: "INDICADOR"; nome: string; grafico?: "MESES" | "ACUMULADO"; /** Os dados antes do gráfico (12/11/2026). */ periodos?: PeriodosDoCard; tipoGrafico?: "barras" | "area"; comRotulos?: boolean; /** O Zoom do card (30/10/2026). */ zoom?: number; /** O card PROVA (31/10/2026). */ prova?: true | MarcacaoComparavel[] }
    /** O título da anotação (16/10/2026); sem ele, o nome da nota. */
    | {
        tipo: "ANOTACAO";
        nota: Nota;
        texto: string;
        titulo?: string;
        /** O texto formatado (17/10/2026), em HTML; `texto` fica com o texto simples. */
        html?: string;
        /** O tamanho da fonte do título, em px (19/10/2026); sem ele, 12. */
        tamanhoTitulo?: number;
        /** A fonte do título (20/10/2026: a chave de FONTES); sem ela, a da ferramenta. */
        fonteTitulo?: string;
        /** O espaçamento entre as linhas do texto (20/10/2026: 0,5 a 2); sem ele, o de antes. */
        espacamento?: number;
      }
    /** Uma foto (16/10/2026): o arquivo, guardado no servidor, a legenda e a proporção (largura ÷ altura). */
    | { tipo: "FOTO"; arquivo: string; legenda: string; proporcao: number; /** A legenda formatada (17/10/2026), em HTML. */ legendaHtml?: string; /** A Imagem Livre (21/10/2026): só a imagem, sem o fundo, a moldura e a legenda. */ livre?: boolean; /** Os ajustes da imagem (21/10/2026). */ ajustes?: AjustesDeImagem; /** O corte (27/10/2026): a imagem cobre o quadro, que tem o tamanho escolhido, com o zoom e a posição; sem ele, o quadro tem a proporção da imagem. */ recorte?: RecorteDaImagem }
    /**
     * Um vídeo (20/10/2026): um arquivo do computador (`arquivo`, guardado no servidor, até 200 MB) ou um link do YouTube,
     * Instagram, Facebook ou LinkedIn (`url`, o endereço colado), com a legenda e a proporção; vazio, o quadro esperando o vídeo.
     */
    | { tipo: "VIDEO"; origem: "ARQUIVO" | "LINK"; arquivo: string; url: string; legenda: string; proporcao: number; legendaHtml?: string }
    /** O Texto Livre (20/10/2026): o texto formatado das anotações, sem o destaque, o título, o ícone e o fundo. */
    | { tipo: "TEXTO"; texto: string; html?: string; /** O espaçamento entre as linhas (20/10/2026). */ espacamento?: number; /** As Bordas (12/11/2026). */ borda?: BordaDoTexto }
    /**
     * O Sumário (20/10/2026): as telas marcadas (da Introdução em diante), com o número do primeiro slide de cada uma, e, em
     * "TELAS_E_SLIDES", os slides delas; a lista e os números se montam a cada vez, com os slides do relatório.
     */
    | {
        tipo: "SUMARIO";
        listar: ListarDoSumario;
        telas: string[];
        /** O sublinhado entre o nome e o número (20/10/2026); sem ele, os pontos. */
        linha?: LinhaDoSumario;
        /** A formatação das telas e dos slides (20/10/2026); sem ela, a de início (as telas em negrito, maiores). */
        estilos?: { telas?: EstiloDoSumario; slides?: EstiloDoSumario };
      }
    /**
     * A tabela de Resultados (22/10/2026), como a da tela Resultados: a visão (0 Consolidado, 1 a 5 as unidades), o nível
     * (1 Totais, 2 Atribuições, 3 Contas), as linhas escolhidas (os códigos; sem elas, todas) e os meses anteriores ao do
     * relatório recolhidos (só o mês e os totais) ou não; as colunas opcionais (30/10/2026; sem elas, todas).
     */
    | {
        tipo: "TABELA";
        visao: VisaoDaTabela;
        nivel: 1 | 2 | 3;
        linhas?: string[];
        recolhido?: boolean;
        colunas?: ColunasDaTabela;
        /** A Tabela PROVA (31/10/2026): os cenários da Comparação PROVA lado a lado, no lugar do comparado; sem ela, a Tabela Padrão. */
        prova?: true | MarcacaoComparavel[];
      }
  );
export type VisaoDaTabela = 0 | 1 | 2 | 3 | 4 | 5;
/** As colunas que a tabela mostra ou não (30/10/2026, pedido do Adão): o R$/m³ e as três da variação. */
export type ColunasDaTabela = { unitario: boolean; diferenca: boolean; atingimento: boolean; eficiencia: boolean };
/** As visões da tabela (as abas de Resultados das unidades), com o nome. */
export const VISOES_DA_TABELA: Array<{ visao: VisaoDaTabela; nome: string }> = [
  { visao: 0, nome: "Consolidado" },
  { visao: 1, nome: "Matriz" },
  { visao: 2, nome: "Filial" },
  { visao: 3, nome: "Serviços" },
  { visao: 4, nome: "Despesas e Extra" },
  { visao: 5, nome: "RN" },
];
export type ListarDoSumario = "TELAS" | "TELAS_E_SLIDES";
export type LinhaDoSumario = "PONTOS" | "TRACOS" | "LINHA" | "NENHUM";
/** A formatação de um nível do Sumário (20/10/2026): o tamanho em px, a cor (#rrggbb) e a fonte (a chave de FONTES). */
export type EstiloDoSumario = { negrito?: boolean; italico?: boolean; sublinhado?: boolean; tamanho?: number; cor?: string; fonte?: string };
/** O conteúdo de um bloco, sem a posição (um bloco novo, antes de entrar na grade). */
export type ConteudoDoBloco = Bloco extends infer B ? (B extends Bloco ? Omit<B, keyof Posicao> : never) : never;
/**
 * A Imagem de Fundo da página (20/10/2026): a foto cobre o slide inteiro, por cima do cabeçalho e atrás dos blocos. `zoom`
 * (1 a 4) a aumenta a partir do tamanho que cobre a tela; `x` e `y` (0 a 1) a posicionam (0: encostada à esquerda ou em
 * cima; 1: à direita ou embaixo).
 */
/** Os ajustes de uma imagem (21/10/2026): brilho e saturação em % (100 = como veio), matiz em graus, desfoque em px e transparência em %; sem um deles, o padrão. */
export type AjustesDeImagem = {
  brilho?: number;
  matiz?: number;
  saturacao?: number;
  desfoque?: number;
  transparencia?: number;
  /** A borda (22/10/2026; só as imagens com legenda e as livres): a espessura, em px, e a cor (#rrggbb). */
  bordaEspessura?: number;
  bordaCor?: string;
  /** O sombreamento centralizado (22/10/2026): a intensidade (0 a 100%) e o desfoque, em px. */
  sombraIntensidade?: number;
  sombraDesfoque?: number;
};
export type Fundo = { arquivo: string; proporcao: number; zoom: number; x: number; y: number; ajustes?: AjustesDeImagem };
/**
 * O corte de uma imagem (27/10/2026): como a Imagem de Fundo, a imagem cobre o quadro (`zoom` de 1 a 4, a partir do tamanho
 * que cobre; `x` e `y` de 0 a 1, a posição).
 */
export type RecorteDaImagem = { zoom: number; x: number; y: number };
/** A transição dos slides de um grupo (27/10/2026), guardada em cada página dele. */
export type Transicao = "ESMAECER" | "ROLAR_VERTICAL" | "ROLAR_HORIZONTAL";
/** Uma página da aba (16/10/2026): cada departamento tem uma ou mais, cada uma com a sua grade. */
/** As Bordas do Texto Livre (12/11/2026): as posições, o tipo, a espessura (px, de 1/4 a 60) e a cor (as dos textos). */
export type LadoDaBorda = "CIMA" | "BAIXO" | "ESQUERDA" | "DIREITA";
export type TipoDaBorda = "CONTINUA" | "TRACEJADA" | "PONTILHADA" | "DUPLA" | "SULCADA";
export type BordaDoTexto = { lados: LadoDaBorda[]; tipo: TipoDaBorda; espessura: number; cor: string };
export type Pagina = { id: string; /** O nome (16/10/2026), o do slide; sem ele, "Página N". */ nome?: string; blocos: Bloco[]; fundo?: Fundo; /** A transição do slide (27/10/2026; até 30/10/2026, a mesma em todas as páginas do grupo). */ transicao?: Transicao; /** Avançar Após (30/10/2026): na apresentação, o slide passa sozinho ao próximo depois desses segundos. */ avancarApos?: number; /** Recomeçar ao Terminar (11/11/2026, os painéis): depois do Avançar Após do último slide, a apresentação volta ao primeiro; marcado em todas as páginas do painel. */ recomecarAoTerminar?: boolean; /** Ocultar Página (12/11/2026): a página fica fora dos slides (o Apresentar pula para a próxima; fora também do PDF, do contador e do Sumário). */ oculta?: boolean };
/** A Capa (20/10/2026): a primeira aba; os slides dela não entram na contagem. */
export const CHAVE_DA_CAPA = "CAPA";
/**
 * As abas fora da contagem dos slides e do Sumário, com o layout livre: a Capa e o Encerramento (20/10/2026, a última
 * aba, geral como a Capa).
 */
export const ABAS_SEM_NUMERO = new Set<string>([CHAVE_DA_CAPA, "ENCERRAMENTO"]);
/**
 * As telas e os slides para o Sumário (20/10/2026): as abas da Introdução em diante, com os slides de cada uma e o número
 * de cada slide (a contagem a partir da Introdução, a mesma do contador do topo dos slides); a aba sem slides vem sem eles.
 */
export type TelaDoSumario = { chave: string; titulo: string; slides: Array<{ nome: string; numero: number }> };
export type AbaDoRelatorio = AbaResumida & {
  /** O título da aba (17/10/2026): Introdução, Demonstrativo de Resultados, Performance Comercial… (`nome` é o curto, o da barra). */
  titulo: string;
  /** Em elaboração, só quem a edita (e o Administrador) a vê. */
  visivel: boolean;
  /** As páginas (vazio, na aba que o usuário não vê). */
  paginas: Pagina[];
  podeEditar: boolean;
  podeReabrir: boolean;
  atualizadoPor: string | null;
  atualizadoEm: string;
  finalizadoPor: string | null;
  finalizadoEm: string | null;
};
export type Relatorio = {
  id: string;
  ano: number;
  mes: number;
  rotuloMes: string;
  situacao: Situacao;
  criadoPor: string;
  criadoEm: string;
  abas: AbaDoRelatorio[];
  podeExcluir: boolean;
  /**
   * O painel de bordo (31/10/2026; só nos painéis, que vêm como um relatório de uma aba só, a tela Painel de Bordo): o nome,
   * a visualização e se o usuário o altera (quem o criou ou o Administrador).
   */
  nome?: string;
  visualizacao?: VisualizacaoDoPainel;
  podeAlterar?: boolean;
  /** A competência automática do painel (03/11/2026): ele mostra a última fechada (a do `rotuloMes`). */
  automatica?: boolean;
};
/**
 * Os cenários dos cards PROVA (31/10/2026): os marcados que existem, na ordem do PROVA (Forecast, Orçado, Vendido e
 * Anterior), com o nome do cenário; e a marcação do cenário de comparação (a cor dos cards padrão nos slides com cards
 * PROVA; nula: um cenário sem marcação).
 */
export type ProvaDoRelatorio = { cenarios: Array<{ marcacao: MarcacaoComparavel; rotulo: string; cenario: string }>; marcacaoComparada: MarcacaoComparavel | null };
export type DadosDoRelatorio = { painel: Painel; indicadores: Indicadores; prova: ProvaDoRelatorio };
/**
 * As Configurações do relatório (22/10/2026): a Comparação Padrão — o cenário de comparação (nulo: o marcado como Orçamento
 * Empresarial, `marcado`) —, desde 31/10/2026 a Comparação PROVA (as marcações; vazia, todas), os cenários públicos com
 * marcação e se o usuário pode mudar.
 */
export type ConfiguracoesDoRelatorio = {
  ano: number;
  cenarioComparadoId: string | null;
  marcado: { id: string; nome: string; ano: number } | null;
  cenarios: Array<{ id: string; nome: string; ano: number; tipo: string; marcacao: MarcacaoCenario | null }>;
  comparacaoProva: MarcacaoComparavel[];
  podeEditar: boolean;
  /**
   * Os campos do painel de bordo (31/10/2026; só nos painéis): o nome, a visualização, a competência (`ano` e `mes`), as
   * competências fechadas para escolher e quem o criou.
   */
  nome?: string;
  visualizacao?: VisualizacaoDoPainel;
  /** O Geral do painel (01/11/2026): só quem o criou (ou o Administrador) o muda; os Comparativos, também os editores convidados (`podeEditar`). */
  podeEditarGeral?: boolean;
  mes?: number;
  /**
   * A competência automática do painel (03/11/2026): `ano` e `mes` são a última fechada, a que ele mostra; a Comparação
   * Padrão acompanha a marcação do cenário escolhido.
   */
  automatica?: boolean;
  /** A última competência fechada (a da opção Automática); nula: nenhuma. */
  ultimaFechada?: string | null;
  competencias?: Array<{ ano: number; mes: number; rotulo: string }>;
  criadoPor?: string;
};
/** A visualização de um painel de bordo (31/10/2026), como a dos cenários: Privado (só quem o criou e o Administrador) ou Público. */
export type VisualizacaoDoPainel = "PRIVADO" | "PUBLICO";
/**
 * Uma mudança das Configurações: a Comparação Padrão (`cenarioComparadoId`) ou, desde 31/10/2026, a Comparação PROVA (dois
 * ou mais cenários); nos painéis de bordo, também o nome, a visualização e a competência (uma fechada ou, desde 03/11/2026,
 * a automática).
 */
export type MudancaDasConfiguracoes =
  | { cenarioComparadoId: string | null }
  | { comparacaoProva: MarcacaoComparavel[] }
  | { nome: string }
  | { visualizacao: VisualizacaoDoPainel }
  | { ano: number; mes: number }
  | { automatica: true };

/** Os processos com slides (31/10/2026): a rota da API e a pasta dos arquivos de cada um. */
export type RotaDosSlides = "relatorios-executivos" | "paineis-de-bordo";

/**
 * As chamadas que os Relatórios Executivos e os Painéis de Bordo têm em comum (31/10/2026: os painéis, feitos a partir dos
 * relatórios, com as mesmas melhorias), na rota de cada um.
 */
export function servicoDosSlides(rota: RotaDosSlides) {
  const base = `/proxy/${rota}`;
  return {
    obter: async (id: string) => (await api.get<{ data: Relatorio }>(`${base}/${id}`)).data.data,
    dados: async (id: string) => (await api.get<{ data: DadosDoRelatorio }>(`${base}/${id}/dados`)).data.data,
    configuracoes: async (id: string) => (await api.get<{ data: ConfiguracoesDoRelatorio }>(`${base}/${id}/configuracoes`)).data.data,
    gravarConfiguracoes: async (id: string, mudanca: MudancaDasConfiguracoes) => (await api.put<{ data: ConfiguracoesDoRelatorio }>(`${base}/${id}/configuracoes`, mudanca)).data.data,
    /** A tabela de Resultados de uma visão (22/10/2026), até o mês do relatório, para os blocos de tabela. */
    resultados: async (id: string, visao: VisaoDaTabela) => (await api.get<{ data: Resultados }>(`${base}/${id}/resultados`, { params: { visao } })).data.data,
    /**
     * Grava as páginas do grupo (a aba). `versao` (23/10/2026): quando ele foi gravado da última vez no que o usuário abriu; se
     * outro gravou depois, o servidor recusa (409, codigo CONFLITO), a não ser com `forcar` (gravar por cima).
     */
    gravarAba: async (id: string, aba: string, paginas: Pagina[], opcoes: { versao?: string; forcar?: boolean } = {}) =>
      (await api.put<{ data: Relatorio }>(`${base}/${id}/abas/${aba}`, { paginas, ...opcoes })).data.data,
    /**
     * Copia as fotos e os vídeos de outro documento para este (24/10/2026: colar blocos copiados dele; desde 31/10/2026, de um
     * relatório ou de um painel, `processo`).
     */
    copiarArquivos: async (id: string, de: { id: string; processo: RotaDosSlides }, arquivos: string[]) =>
      (await api.post<{ data: { copiados: number; faltando: string[] } }>(`${base}/${id}/arquivos/copiar`, { de: de.id, processo: de.processo, arquivos })).data.data,
    enviarFoto: async (id: string, foto: Blob) => (await api.post<{ data: { arquivo: string } }>(`${base}/${id}/fotos`, foto, { headers: { "Content-Type": foto.type } })).data.data,
    /** O vídeo (20/10/2026): o arquivo cru, com o andamento do envio (0 a 1). */
    enviarVideo: async (id: string, video: File, aoEnviar?: (fracao: number) => void) =>
      (
        await api.post<{ data: { arquivo: string } }>(`${base}/${id}/videos`, video, {
          headers: { "Content-Type": video.type },
          onUploadProgress: (e) => (e.total ? aoEnviar?.(e.loaded / e.total) : undefined),
          timeout: 0,
        })
      ).data.data,
    excluir: async (id: string) => (await api.delete<{ data: { excluido: boolean } }>(`${base}/${id}`)).data.data,
    /** Finaliza ou reabre o grupo (a aba do relatório; no painel, desde 01/11/2026, a tela Painel de Bordo). */
    finalizarAba: async (id: string, aba: string) => (await api.post<{ data: Relatorio }>(`${base}/${id}/abas/${aba}/finalizar`)).data.data,
    reabrirAba: async (id: string, aba: string) => (await api.post<{ data: Relatorio }>(`${base}/${id}/abas/${aba}/reabrir`)).data.data,
  };
}
export type ServicoDosSlides = ReturnType<typeof servicoDosSlides>;

const base = "/proxy/relatorios-executivos";
export const relatoriosExecutivosService = {
  ...servicoDosSlides("relatorios-executivos"),
  listar: async () => (await api.get<{ data: ListaDeRelatorios }>(base)).data.data,
  /** Com `importarDe` (16/10/2026), as abas começam com os blocos (cards, fotos e anotações) daquele relatório. */
  // Sem `manterImagensEAnotacoes` (17/10/2026), só os cards vêm do relatório de origem.
  criar: async (ano: number, mes: number, importarDe: string | null, manterImagensEAnotacoes = true) =>
    (await api.post<{ data: { id: string; rotuloMes: string } }>(base, { ano, mes, importarDe, manterImagensEAnotacoes })).data.data,
};

/** O endereço de uma foto do documento (pelo proxy, com o login), na rota do processo (31/10/2026: o relatório ou o painel). */
export const enderecoDaFoto = (id: string, arquivo: string, rota: RotaDosSlides) => `/api/proxy/${rota}/${id}/fotos/${arquivo}`;
/** O endereço de um vídeo do documento (20/10/2026; pelo proxy, em partes). */
export const enderecoDoVideo = (id: string, arquivo: string, rota: RotaDosSlides) => `/api/proxy/${rota}/${id}/videos/${arquivo}`;
