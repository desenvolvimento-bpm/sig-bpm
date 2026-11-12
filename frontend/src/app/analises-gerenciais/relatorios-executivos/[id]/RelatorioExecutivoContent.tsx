"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CloudAlert, CloudCheck, CloudOff, Crop, FilePlus2, FileX2, Image as Imagem, ImageOff, ImagePlus, ImageUp, LayoutGrid, LayoutList, ListOrdered, LoaderCircle, LockOpen, Pencil, Plus, Presentation, Settings, StickyNote, Table2, TableProperties, Trash2, Type, Video } from "lucide-react";
import { toast } from "sonner";

import { EtiquetasDaBarra } from "@/components/layout/EtiquetasDaBarra";
import { CabecalhoDaTela } from "@/components/shared/CabecalhoDaTela";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";
import { podeSair, useAlteracoesPendentes, useSalvamentoPendente } from "@/lib/alteracoesPendentes";
import { plural } from "@/lib/texto";

import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";
import { useCoresDoPainel } from "@/app/relatorios/painel/PainelContent";
import { RotulosDoGrafico, useTipoGrafico } from "@/app/relatorios/components/GraficoRealizadoOrcado";
import { botaoPrimario, Erro } from "@/app/cenarios/components/CenarioDialog";

import { AdicionarCardsDialog } from "../components/AdicionarCardsDialog";
import { ApresentacaoDoRelatorio, entrarEmTelaInteira, type Slide } from "../components/ApresentacaoDoRelatorio";
import { EtiquetaSituacao } from "../components/EtiquetaSituacao";
import { AjustarFundoDialog } from "../components/FundoDoSlide";
import { prepararFoto } from "../components/enviarImagem";
import { ConfigurarSumarioDialog } from "../components/SumarioDoRelatorio";
import { ConfigurarTabelaDialog } from "../components/TabelaDoRelatorio";
import { ExportarPdfDoRelatorio } from "../components/ExportarPdfDoRelatorio";
import { CONFIGURACOES, ConfiguracoesDoRelatorio } from "../components/ConfiguracoesDoRelatorio";
import { MAXIMO_DO_VIDEO, proporcaoDoArquivo, TIPOS_DE_VIDEO, VideoDialog, videoDoTexto, type VideoEscolhido } from "../components/VideoDialog";
import { BarraDeEdicao, COLUNAS, escrevendoAgora, GradeDoRelatorio, larguraDoSlide, linhasDaFoto, linhasDaPagina, linhasDoTexto, lugarLivre, tamanhoInicial } from "../components/GradeDoRelatorio";
import { ColarNoSlideDialog, type Colado, type ComoColar } from "../components/ColarNoSlideDialog";
import { TransicoesDoSlide, type MudancaDoSlide } from "../components/TransicoesDoSlide";
import { copiaDe, copiaPeloTexto, formatacaoBasica, TIPO_DA_COPIA, useCopia, type Copia } from "../components/copiarColar";
import { deTexto, limparHtml } from "../components/TextoRico";
import { useProcesso } from "../components/processo";
import { ABAS_SEM_NUMERO, relatoriosExecutivosService, type Bloco, type ConteudoDoBloco, type Fundo, type Pagina, type Relatorio, type TelaDoSumario } from "../services/relatoriosExecutivosService";

/** Um id para o bloco novo (sem o crypto.randomUUID, que o navegador só dá em https). */
const novoId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

/** O grupo que outro usuário gravou depois (23/10/2026): o 409 CONFLITO do servidor, com quem e quando; nos outros erros, null. */
type Conflito = { aba: string; nome: string; atualizadoPor: string | null; atualizadoEm: string };
function conflitoDe(e: unknown): Conflito | null {
  const r = (e as { response?: { status?: number; data?: { codigo?: string; detalhes?: Conflito } } }).response;
  return r?.status === 409 && r.data?.codigo === "CONFLITO" && r.data.detalhes ? r.data.detalhes : null;
}

/** O nome da página: o escolhido ou, sem ele, "Página N". */
const nomeDaPagina = (p: Pagina, k: number) => p.nome?.trim() || `Página ${k + 1}`;

/** A aba e a página abertas. */
type Aberta = { chave: string; pagina: string | null };

/**
 * Um Relatório Executivo (15/10/2026): o de uma competência fechada, com as sete abas (17/10/2026: Introdução, Resultados,
 * Comercial, Produção, Serviços e Administrativo; 20/10/2026: a Capa, antes da Introdução; na barra do topo, como as etapas do
 * Fechamento Mensal) e, em cada uma, as
 * páginas (16/10/2026), cada página com a grade dos blocos. Quem edita a aba (Introdução e Resultados, todos os que editam a
 * tela; as performances, o gestor do departamento, pelo recorte) inclui e exclui páginas, adiciona cards (do Painel de Bordo, com ou sem
 * gráfico, e dos Indicadores), anotações (positivas, negativas e de atenção) e fotos, move, redimensiona e exclui os
 * blocos, grava e finaliza a aba; a aba finalizada todos a leem, e quem a edita (ou o Administrador) a reabre. A aba em
 * elaboração só aparece para quem a edita. Apresentar mostra as páginas como slides, em tela inteira.
 */
export function RelatorioExecutivoContent() {
  const { id } = useParams<{ id: string }>();
  useRegistrarAcessoTela("/analises-gerenciais/relatorios-executivos");
  return (
    <DocumentoDosSlides
      id={id}
      barra={(relatorio, chave, onMudar) => <BarraDoRelatorio relatorio={relatorio} chave={chave} onMudar={onMudar} />}
      configuracoes={(relatorio, excluir) => (
        <>
          <ConfiguracoesDoRelatorio relatorioId={relatorio.id} />
          {excluir}
        </>
      )}
      comoUsar={<ComoUsarDoRelatorio />}
      sobre={(relatorio) => (
        <p>
          O relatório executivo (RE) de {relatorio.rotuloMes}: em cada aba (a Capa, a Introdução, o Demonstrativo de Resultados, as performances
          Comercial, da Produção, de Serviços e Administrativa e o Encerramento), as páginas com os cards do Painel de Bordo e dos Indicadores de Resultados
          Empresariais escolhidos pelos gestores, com as anotações dos pontos positivos, negativos e de atenção, os textos, o sumário, as fotos, os
          vídeos e as imagens de fundo. Criado por {relatorio.criadoPor}.
        </p>
      )}
    />
  );
}

/** O que muda de um processo para o outro na tela do documento (31/10/2026: os Relatórios Executivos e os Painéis de Bordo). */
export type PartesDoDocumento = {
  /** A barra do topo: o documento, a aba Configurações e os grupos (as abas do relatório; a tela do painel). */
  barra: (relatorio: Relatorio, chave: string, onMudar: (chave: string) => void) => React.ReactNode;
  /**
   * O conteúdo da aba Configurações, com o botão Excluir (nulo para quem não exclui): o relatório o põe embaixo das
   * comparações; o painel (01/11/2026), na aba Geral.
   */
  configuracoes: (relatorio: Relatorio, excluir: React.ReactNode) => React.ReactNode;
  comoUsar: React.ReactNode;
  sobre: (relatorio: Relatorio) => React.ReactNode;
};

/**
 * A tela de um documento com slides (31/10/2026: um relatório executivo ou um painel de bordo, pelo processo do contexto):
 * lê o documento e monta o editor, com as partes de cada processo.
 */
export function DocumentoDosSlides({ id, ...partes }: { id: string } & PartesDoDocumento) {
  const processo = useProcesso();
  const consulta = useQuery({ queryKey: [processo.rota, "relatorio", id], queryFn: () => processo.servico.obter(id) });
  // A aba e a página abertas ficam aqui, para não mudarem quando o editor remonta (ao finalizar, reabrir ou recarregar).
  const [aberta, setAberta] = useState<Aberta | null>(null);
  // O Recarregar do conflito (24/10/2026): o editor remonta com o relatório de agora.
  const [geracao, setGeracao] = useState(0);
  if (consulta.isError) {
    return (
      <div className="space-y-6">
        <CabecalhoDaTela titulo={processo.nome} />
        <Erro erro={mensagemDeErro(consulta.error, `Erro ao carregar o ${processo.documento}.`)} />
      </div>
    );
  }
  if (!consulta.data) return <div className="h-96 animate-pulse rounded-sm bg-gray-100" />;
  // Remonta ao finalizar ou reabrir uma aba e ao recarregar, com o que o servidor devolveu. O salvamento automático
  // (24/10/2026) não remonta: o editor continua com o bloco escolhido, o cursor no texto e o histórico do Desfazer.
  const versao = `${geracao};${consulta.data.abas.map((a) => a.situacao).join(";")}`;
  // De início, a primeira aba que o usuário edita; sem nenhuma, a primeira que ele vê.
  const abas = consulta.data.abas;
  const inicial = { chave: (abas.find((a) => a.podeEditar) ?? abas.find((a) => a.visivel) ?? abas[0])?.chave ?? "", pagina: null };
  const recarregar = async () => {
    await consulta.refetch();
    setGeracao((g) => g + 1);
  };
  return <Editor key={versao} relatorio={consulta.data} aberta={aberta ?? inicial} setAberta={setAberta} onRecarregar={recarregar} {...partes} />;
}

/** O salvamento automático: 2 s depois da última alteração, ou 10 s depois da primeira, numa edição sem pausa. */
const ESPERA = 2000;
const ESPERA_MAXIMA = 10_000;
/** O histórico do Desfazer: até 100 passos; as alterações a menos de 1 s uma da outra (a digitação) são um passo só. */
const PASSOS = 100;
const JUNTAR = 1000;

/** Um estado das páginas no histórico do Desfazer, com a aba e a página onde a alteração aconteceu. */
type Passo = { paginas: Record<string, Pagina[]>; aberta: Aberta };

function Editor({
  relatorio,
  aberta,
  setAberta,
  onRecarregar,
  barra,
  configuracoes: conteudoDasConfiguracoes,
  comoUsar,
  sobre: sobreDoDocumento,
}: { relatorio: Relatorio; aberta: Aberta; setAberta: (a: Aberta) => void; onRecarregar: () => Promise<void> } & PartesDoDocumento) {
  const queryClient = useQueryClient();
  const router = useRouter();
  // O processo (31/10/2026): o relatório executivo ou o painel de bordo — a rota da API, as consultas e os nomes.
  const processo = useProcesso();
  const { rota, servico, documento } = processo;
  const dados = useQuery({ queryKey: [rota, "dados", relatorio.id], queryFn: () => servico.dados(relatorio.id) });
  const [cores] = useCoresDoPainel();
  const [tipo] = useTipoGrafico();
  // A base de cada grupo (23/10/2026): as páginas e a versão (quando o grupo foi gravado) do que o usuário abriu ou gravou
  // por último; a gravação manda a versão, e o servidor recusa se outro gravou o grupo depois. `baseAgora` é a base do
  // salvamento em andamento (o estado só chega na tela no próximo desenho).
  const [base, setBase] = useState(() => ({
    paginas: Object.fromEntries(relatorio.abas.map((a) => [a.chave, a.paginas])) as Record<string, Pagina[]>,
    versoes: Object.fromEntries(relatorio.abas.map((a) => [a.chave, a.atualizadoEm])) as Record<string, string>,
  }));
  const baseAgora = useRef(base);
  const mudarBase = (b: typeof base) => {
    baseAgora.current = b;
    setBase(b);
  };
  const gravadas = base.paginas;
  const [paginas, setPaginas] = useState<Record<string, Pagina[]>>(() => base.paginas);
  const paginasAgora = useRef(paginas);
  useLayoutEffect(() => {
    paginasAgora.current = paginas;
  }, [paginas]);
  // O grupo que outro usuário gravou depois que este abriu o relatório (a gravação foi recusada) e se o aviso dele está
  // aberto: com o Cancelar, o grupo fica sem salvar até o usuário escolher (o "Não Salvo" reabre o aviso).
  const [conflito, setConflito] = useState<Conflito | null>(null);
  const conflitoAgora = useRef(conflito);
  useLayoutEffect(() => {
    conflitoAgora.current = conflito;
  }, [conflito]);
  const [vendoConflito, setVendoConflito] = useState(false);
  // O histórico da sessão (24/10/2026, o Desfazer e o Refazer): os estados de antes de cada alteração e os desfeitos.
  const [historico, setHistorico] = useState<{ passado: Passo[]; futuro: Passo[] }>({ passado: [], futuro: [] });
  const ultimaMudanca = useRef(0);
  // O Adicionar Cards Padrão ou, desde 31/10/2026, o Adicionar Cards PROVA.
  const [adicionando, setAdicionando] = useState<"padrao" | "prova" | null>(null);
  // O Adicionar Vídeo (20/10/2026): "novo" (um bloco novo) ou o id do quadro de vídeo vazio que recebe o vídeo.
  const [escolhendoVideo, setEscolhendoVideo] = useState<string | null>(null);
  // O andamento do envio do vídeo (0 a 1), no botão Adicionar.
  const [enviando, setEnviando] = useState<number | null>(null);
  const [apresentando, setApresentando] = useState<number | null>(null);
  // A Imagem de Fundo em ajuste (20/10/2026) e o Adicionar Sumário aberto.
  const [ajustandoFundo, setAjustandoFundo] = useState<Fundo | null>(null);
  const [adicionandoSumario, setAdicionandoSumario] = useState(false);
  // O Adicionar Tabela Padrão (22/10/2026) ou, desde 31/10/2026, o Adicionar Tabela PROVA.
  const [adicionandoTabela, setAdicionandoTabela] = useState<"padrao" | "prova" | null>(null);
  const [confirmar, setConfirmar] = useState<"finalizar" | "excluir" | "excluirPagina" | null>(null);
  // A página com o nome em edição (16/10/2026), na própria aba dela.
  const [renomeando, setRenomeando] = useState<string | null>(null);
  // A página arrastada para trocar de lugar (17/10/2026) e a aba sobre a qual ela está.
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const moverPagina = (de: string, para: string) => {
    const origem = daAba.findIndex((x) => x.id === de);
    const destino = daAba.findIndex((x) => x.id === para);
    if (origem < 0 || destino < 0 || origem === destino) return;
    const lista = [...daAba];
    const [movida] = lista.splice(origem, 1);
    lista.splice(destino, 0, movida);
    mudarPaginas(lista);
  };
  const seletorDeFoto = useRef<HTMLInputElement>(null);
  const seletorDeImagem = useRef<HTMLInputElement>(null);
  const seletorDeFundo = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const chave = aberta.chave;
  const aba = relatorio.abas.find((a) => a.chave === chave);
  const daAba = paginas[chave] ?? [];
  // A página aberta: a escolhida, se ainda existe; senão, a primeira da aba.
  const pagina = daAba.find((p) => p.id === aberta.pagina) ?? daAba[0];
  const nPagina = pagina ? daAba.indexOf(pagina) : -1;
  const mudadas = relatorio.abas.filter((a) => a.podeEditar && JSON.stringify(paginas[a.chave] ?? []) !== JSON.stringify(gravadas[a.chave] ?? []));
  const mudouAba = mudadas.some((a) => a.chave === chave);
  // Os grupos que o salvamento automático grava: os alterados, menos o em conflito (espera a escolha do usuário).
  const aSalvar = mudadas.filter((a) => a.chave !== conflito?.aba);
  const daPagina = pagina?.blocos ?? [];
  // Cada alteração entra no histórico (a anterior a menos de 1 s, como a digitação, fica no mesmo passo) e limpa os desfeitos.
  const mudarPaginas = (lista: Pagina[]) => {
    const agora = Date.now();
    const novoPasso = agora - ultimaMudanca.current > JUNTAR;
    ultimaMudanca.current = agora;
    setHistorico((h) => (novoPasso ? { passado: [...h.passado, { paginas, aberta: { chave, pagina: pagina?.id ?? null } }].slice(-PASSOS), futuro: [] } : h.futuro.length ? { ...h, futuro: [] } : h));
    setPaginas((p) => ({ ...p, [chave]: lista }));
  };
  // Desfazer e Refazer (24/10/2026): voltam as páginas ao passo do histórico e abrem a aba e a página onde a alteração
  // aconteceu; o salvamento automático grava o resultado. O texto em edição perde o foco antes, para receber o conteúdo.
  const irNoHistorico = (de: "passado" | "futuro") => {
    const passo = historico[de].at(-1);
    if (!passo) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    const para = de === "passado" ? "futuro" : "passado";
    setHistorico({ [de]: historico[de].slice(0, -1), [para]: [...historico[para], { paginas, aberta: passo.aberta }] } as typeof historico);
    ultimaMudanca.current = 0;
    setPaginas(passo.paginas);
    setAberta(passo.aberta);
  };
  const desfazer = historico.passado.length ? () => irNoHistorico("passado") : undefined;
  const refazer = historico.futuro.length ? () => irNoHistorico("futuro") : undefined;
  const mudarPagina = (blocos: Bloco[]) => mudarPaginas(daAba.map((p) => (p.id === pagina?.id ? { ...p, blocos } : p)));
  // A Imagem de Fundo da página aberta (20/10/2026); sem ela, a página fica sem fundo.
  const mudarFundo = (fundo: Fundo | undefined) => mudarPaginas(daAba.map((p) => (p.id === pagina?.id ? { ...p, fundo } : p)));
  // O bloco novo entra logo abaixo do último bloco da página; a anotação e a foto, ao lado do último bloco, se couberem na linha.
  const fim = daPagina.reduce((m, b) => Math.max(m, b.y + b.h), 0);
  const ultimo = daPagina.reduce<Bloco | null>((u, b) => (!u || b.y > u.y || (b.y === u.y && b.x > u.x) ? b : u), null);
  const posicao = (n: ConteudoDoBloco, k: number) => {
    const t = tamanhoInicial(n as Bloco);
    if (n.tipo === "ANOTACAO" && ultimo && ultimo.x + ultimo.w + t.w <= COLUNAS) return { x: ultimo.x + ultimo.w, y: ultimo.y, ...t, h: Math.max(t.h, ultimo.h) };
    return { x: 0, y: fim + k, ...t };
  };
  // O bloco adicionado (24/10/2026: também o colado) fica escolhido, com o menu da edição dele.
  const [escolher, setEscolher] = useState<{ id: string; cortar?: boolean } | undefined>(undefined);
  const incluir = (novos: ConteudoDoBloco[]) => {
    const blocos = novos.map((n, k) => ({ ...n, id: novoId(), ...posicao(n, k) }) as Bloco);
    mudarPagina([...daPagina, ...blocos]);
    if (blocos[0]) setEscolher({ id: blocos[0].id });
  };
  // A foto (16/10/2026): reduzida no navegador, enviada ao servidor e incluída como as anotações, na altura da proporção dela.
  // A Imagem Livre (21/10/2026) é a foto com `livre`: só a imagem, sem a legenda (a altura, só a da imagem).
  const foto = useMutation({
    mutationFn: async ({ arquivo }: { arquivo: File; livre: boolean }) => {
      const { foto: conteudo, proporcao } = await prepararFoto(arquivo);
      const { arquivo: nome } = await servico.enviarFoto(relatorio.id, conteudo);
      return { nome, proporcao };
    },
    onSuccess: ({ nome, proporcao }, { livre }) => {
      const t = tamanhoInicial({ tipo: "FOTO" });
      // A grade tem 24 px a mais que a área (as margens de fora dos blocos).
      const h = linhasDaFoto(t.w, proporcao, larguraDoSlide(), livre);
      const p = ultimo && ultimo.x + ultimo.w + t.w <= COLUNAS ? { x: ultimo.x + ultimo.w, y: ultimo.y } : { x: 0, y: fim };
      const id = novoId();
      mudarPagina([...daPagina, { tipo: "FOTO", arquivo: nome, legenda: "", proporcao, ...(livre ? { livre: true } : {}), id, ...p, w: t.w, h }]);
      // A imagem adicionada abre o Cortar e Posicionar (27/10/2026); o Cancelar a deixa como entrou.
      setEscolher({ id, cortar: true });
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível enviar a foto.")),
  });
  // A imagem de um quadro de foto vazio (17/10/2026: o relatório importado sem as imagens): entra no próprio bloco, que
  // fica com a altura da proporção dela.
  const imagemNoQuadro = useMutation({
    mutationFn: async ({ arquivo }: { id: string; arquivo: File }) => {
      const { foto: conteudo, proporcao } = await prepararFoto(arquivo);
      const { arquivo: nome } = await servico.enviarFoto(relatorio.id, conteudo);
      return { nome, proporcao };
    },
    onSuccess: ({ nome, proporcao }, { id }) => {
      const largura = larguraDoSlide();
      // O quadro cortado (27/10/2026) fica do tamanho dele, com a imagem centralizada; o outro, na proporção da imagem.
      mudarPagina(
        daPagina.map((b) =>
          b.id !== id || b.tipo !== "FOTO" ? b : b.recorte ? { ...b, arquivo: nome, proporcao, recorte: { zoom: 1, x: 0.5, y: 0.5 } } : { ...b, arquivo: nome, proporcao, h: linhasDaFoto(b.w, proporcao, largura, !!b.livre) },
        ),
      );
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível enviar a foto.")),
  });
  // O vídeo (20/10/2026): o arquivo vai ao servidor (com o andamento no botão); o link entra direto. O bloco novo entra como a
  // foto, ao lado do último bloco, se couber na linha, na altura da proporção dele; o quadro vazio recebe o vídeo no lugar.
  const video = useMutation({
    mutationFn: async ({ v }: { v: VideoEscolhido; quadro: string | null }) => {
      if (v.origem === "LINK") return { origem: "LINK" as const, arquivo: "", url: v.url, proporcao: v.proporcao };
      setEnviando(0);
      try {
        const { arquivo } = await servico.enviarVideo(relatorio.id, v.arquivo, setEnviando);
        return { origem: "ARQUIVO" as const, arquivo, url: "", proporcao: v.proporcao };
      } finally {
        setEnviando(null);
      }
    },
    onSuccess: (m, { quadro }) => {
      const largura = larguraDoSlide();
      if (quadro) {
        mudarPagina(daPagina.map((b) => (b.id === quadro && b.tipo === "VIDEO" ? { ...b, ...m, h: linhasDaFoto(b.w, m.proporcao, largura) } : b)));
        return;
      }
      const t = tamanhoInicial({ tipo: "VIDEO" });
      const h = linhasDaFoto(t.w, m.proporcao, largura);
      const p = ultimo && ultimo.x + ultimo.w + t.w <= COLUNAS ? { x: ultimo.x + ultimo.w, y: ultimo.y } : { x: 0, y: fim };
      const id = novoId();
      mudarPagina([...daPagina, { tipo: "VIDEO", ...m, legenda: "", id, ...p, w: t.w, h }]);
      setEscolher({ id });
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível enviar o vídeo.")),
  });
  // A Imagem de Fundo (20/10/2026): enviada como as fotos (até 2560 px) e logo ajustada no modal; só entra na página no Aplicar.
  const imagemDeFundo = useMutation({
    mutationFn: async (arquivo: File) => {
      const { foto: conteudo, proporcao } = await prepararFoto(arquivo, 2560);
      const { arquivo: nome } = await servico.enviarFoto(relatorio.id, conteudo);
      return { arquivo: nome, proporcao, zoom: 1, x: 0.5, y: 0.5 };
    },
    onSuccess: (f) => setAjustandoFundo(f),
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível enviar a imagem.")),
  });
  // Colar os blocos copiados (24/10/2026, pedido do Adão): na página aberta, cada um o mais perto do lugar de onde veio em
  // que caiba sem encobrir outro bloco. Os de outro relatório trazem antes as fotos e os vídeos para a pasta deste; os que
  // não vêm (não estão lá, ou o relatório foi excluído) ficam como o quadro vazio, com o Carregar.
  const copia = useCopia();
  const colarBlocos = async (c: Copia) => {
    let blocos = c.blocos;
    // A origem (31/10/2026): o relatório ou o painel de onde veio a cópia (sem o processo, as cópias de antes, um relatório).
    const origem = { id: c.relatorioId, processo: c.processo ?? ("relatorios-executivos" as const) };
    const outro = origem.processo === "paineis-de-bordo" ? "do outro painel" : "do outro relatório";
    const arquivos = origem.id === relatorio.id && origem.processo === rota ? [] : blocos.flatMap((b) => ((b.tipo === "FOTO" || b.tipo === "VIDEO") && b.arquivo ? [b.arquivo] : []));
    if (arquivos.length) {
      const faltando = await servico.copiarArquivos(relatorio.id, origem, arquivos).then(
        (r) => r.faltando,
        () => arquivos,
      );
      if (faltando.length) {
        toast.warning(`${plural(faltando.length, `1 imagem ou vídeo ${outro} não veio`, `${faltando.length} imagens ou vídeos ${outro} não vieram`)}: o bloco fica com o quadro vazio.`);
        blocos = blocos.map((b) => ((b.tipo === "FOTO" || b.tipo === "VIDEO") && faltando.includes(b.arquivo) ? ({ ...b, arquivo: "" } as Bloco) : b));
      }
    }
    const linhas = linhasDaPagina();
    const novos: Bloco[] = [];
    for (const b of blocos) {
      const w = Math.min(b.w, COLUNAS);
      novos.push({ ...structuredClone(b), id: novoId(), w, ...lugarLivre([...daPagina, ...novos], w, b.h, b.x, b.y, linhas) });
    }
    mudarPagina([...daPagina, ...novos]);
    setEscolher({ id: novos[0].id });
  };
  // O que veio de outro programa (24/10/2026): o texto e a imagem esperam a escolha no Colar no Slide; o vídeo entra direto.
  const [colado, setColado] = useState<Colado | null>(null);
  const colarVideo = async (arquivo: File) => {
    if (arquivo.size > MAXIMO_DO_VIDEO) return void toast.error("O vídeo colado passa de 200 MB.");
    video.mutate({ v: { origem: "ARQUIVO", arquivo, proporcao: await proporcaoDoArquivo(arquivo) }, quadro: null });
  };
  // O texto entra como Texto Livre ou Anotação (com a formatação básica, se escolhida, nos limites do servidor), no lugar
  // mais perto do alto da página em que caiba; a imagem, como a do Adicionar (com Legenda ou Livre) ou a de Fundo.
  const aplicarColado = (c: Colado, como: ComoColar) => {
    setColado(null);
    if (como.tipo === "IMAGEM") {
      if (!c.imagem) return;
      if (como.como === "FUNDO") imagemDeFundo.mutate(c.imagem);
      else foto.mutate({ arquivo: c.imagem, livre: como.como === "LIVRE" });
      return;
    }
    const texto = c.texto.trim().slice(0, 5000);
    const formatado = como.formatado && c.html ? limparHtml(formatacaoBasica(c.html)) : "";
    const html = formatado && formatado.length <= 30_000 ? formatado : deTexto(texto);
    const w = 6;
    const h = linhasDoTexto(texto, w, como.tipo === "ANOTACAO" ? 30 : 0);
    const conteudo = como.tipo === "ANOTACAO" ? { tipo: "ANOTACAO" as const, nota: como.nota, texto, html } : { tipo: "TEXTO" as const, texto, html };
    const id = novoId();
    mudarPagina([...daPagina, { ...conteudo, id, w, h, ...lugarLivre(daPagina, w, h, 0, 0, linhasDaPagina()) }]);
    setEscolher({ id });
  };
  // As páginas (16/10/2026): a nova entra depois da aberta; excluir pede confirmação quando a página tem blocos.
  // A transição e o Avançar Após de cada página (30/10/2026; antes, a transição do grupo, igual em todas): cada um na aberta
  // ou, com o "Aplicar ao Grupo" dele, em todas as do grupo. A página nova entra com os da aberta.
  const ajusteDaPagina = { ...(pagina?.transicao ? { transicao: pagina.transicao } : {}), ...(pagina?.avancarApos ? { avancarApos: pagina.avancarApos } : {}) };
  const uniformes = {
    transicao: daAba.every((p) => p.transicao === pagina?.transicao),
    avancarApos: daAba.every((p) => (p.avancarApos ?? 0) === (pagina?.avancarApos ?? 0)),
  };
  const mudarAjuste = (m: MudancaDoSlide, aoGrupo: boolean) =>
    mudarPaginas(daAba.map((p) => (aoGrupo || p.id === pagina?.id ? { ...p, [m.campo]: m.valor } : p)));
  // Recomeçar ao Terminar (11/11/2026, só nos painéis): o painel inteiro (marcado em todas as páginas).
  const recomecarAoTerminar = daAba.length > 0 && daAba.every((p) => p.recomecarAoTerminar);
  const mudarRecomecar = (marcado: boolean) => mudarPaginas(daAba.map((p) => ({ ...p, recomecarAoTerminar: marcado || undefined })));
  const novaPagina = () => {
    const nova: Pagina = { id: novoId(), blocos: [], ...ajusteDaPagina, ...(recomecarAoTerminar ? { recomecarAoTerminar: true } : {}) };
    mudarPaginas([...daAba.slice(0, nPagina + 1), nova, ...daAba.slice(nPagina + 1)]);
    setAberta({ chave, pagina: nova.id });
  };
  const excluirPagina = () => {
    const resto = daAba.filter((p) => p.id !== pagina?.id);
    mudarPaginas(resto);
    setAberta({ chave, pagina: resto[Math.max(0, nPagina - 1)]?.id ?? null });
    setConfirmar(null);
  };
  // Recuar e avançar: pelas páginas de todas as abas, na ordem (a aba que o usuário não vê conta como uma página).
  const sequencia = relatorio.abas.flatMap((a) => (a.visivel ? (paginas[a.chave] ?? []).map((p) => ({ chave: a.chave, pagina: p.id as string | null })) : [{ chave: a.chave, pagina: null }]));
  const aqui = sequencia.findIndex((s) => s.chave === chave && (s.pagina === null || s.pagina === pagina?.id));
  const ir = (d: number) => {
    const s = sequencia[aqui + d];
    if (s) setAberta(s);
  };
  // Os slides da apresentação: as páginas com algum bloco ou com a Imagem de Fundo (20/10/2026) das abas que o usuário vê
  // (o que está na tela, gravado ou não). A contagem (o contador do topo dos slides e os números do Sumário) começa na
  // Introdução: os slides da Capa e do Encerramento (20/10/2026) não contam.
  const comConteudo = relatorio.abas.flatMap((a) => {
    const ps = a.visivel ? (paginas[a.chave] ?? []) : [];
    return ps.flatMap((p, k) => (p.blocos.length || p.fundo ? [{ aba: a.chave, chave: `${a.chave}|${p.id}`, nome: a.titulo, pagina: nomeDaPagina(p, k), blocos: p.blocos, fundo: p.fundo, transicao: p.transicao, avancarApos: p.avancarApos, recomecarAoTerminar: p.recomecarAoTerminar }] : []));
  });
  const contados = comConteudo.filter((x) => !ABAS_SEM_NUMERO.has(x.aba)).length;
  let contagem = 0;
  const slides: Array<Slide & { aba: string }> = comConteudo.map((x) => ({ ...x, numero: ABAS_SEM_NUMERO.has(x.aba) ? null : ++contagem, total: contados }));
  // O Sumário (20/10/2026): as telas da Introdução às performances (sem a Capa e o Encerramento), com os slides e os números de cada uma.
  const sumario: TelaDoSumario[] = relatorio.abas
    .filter((a) => !ABAS_SEM_NUMERO.has(a.chave))
    .map((a) => ({ chave: a.chave, titulo: a.titulo, slides: slides.filter((x) => x.aba === a.chave).map((x) => ({ nome: x.pagina, numero: x.numero ?? 0 })) }));
  const apresentar = () => {
    entrarEmTelaInteira();
    setApresentando(Math.max(0, slides.findIndex((s) => s.chave === `${chave}|${pagina?.id}`)));
  };
  const atualizar = (r: Relatorio) => {
    queryClient.setQueryData([rota, "relatorio", relatorio.id], r);
    queryClient.invalidateQueries({ queryKey: [rota], exact: true });
  };
  // O salvamento automático (24/10/2026, pedido do Adão, como no Canva; antes, o Gravar): grava os grupos alterados, um a
  // um, cada um com a versão dele, depois do salvamento em andamento (um de cada vez; o que mudar durante ele se grava em
  // seguida). `forcar`: o grupo que o usuário escolheu gravar por cima. Num conflito, os já gravados ficam (a base deles
  // passa a ser o gravado) e o aviso pergunta o que fazer com o recusado.
  const emAndamento = useRef<Promise<void> | null>(null);
  // O Recarregar e o Excluir Relatório descartam o que falta salvar (o editor sai sem gravar).
  const descartar = useRef(false);
  const alteradas = () =>
    relatorio.abas.filter((a) => a.podeEditar && JSON.stringify(paginasAgora.current[a.chave] ?? []) !== JSON.stringify(baseAgora.current.paginas[a.chave] ?? []));
  const salvar = (forcar: string | null = null) => {
    const anterior = emAndamento.current;
    const vez = (async () => {
      await anterior?.catch(() => undefined);
      let r: Relatorio | null = null;
      for (const a of alteradas()) {
        if (a.chave === conflitoAgora.current?.aba && forcar !== a.chave) continue;
        const enviadas = paginasAgora.current[a.chave] ?? [];
        const gravado = await servico.gravarAba(relatorio.id, a.chave, enviadas, { versao: baseAgora.current.versoes[a.chave], forcar: forcar === a.chave });
        r = gravado;
        const versao = gravado.abas.find((x) => x.chave === a.chave)?.atualizadoEm;
        const b = baseAgora.current;
        mudarBase({ paginas: { ...b.paginas, [a.chave]: enviadas }, versoes: { ...b.versoes, [a.chave]: versao ?? b.versoes[a.chave] } });
      }
      // O relatório do cache com o gravado (para quem volta à tela), sem remontar o editor.
      if (r) queryClient.setQueryData([rota, "relatorio", relatorio.id], r);
    })();
    emAndamento.current = vez;
    vez.then(
      () => (emAndamento.current === vez ? (emAndamento.current = null) : undefined),
      () => (emAndamento.current === vez ? (emAndamento.current = null) : undefined),
    );
    return vez;
  };
  // A situação do salvamento, no lugar do Gravar: as falhas (sem conexão, a publicação) tentam de novo em 5 s, 10 s… até 30 s.
  const [salvamento, setSalvamento] = useState<{ fase: "pronto" | "salvando" | "erro"; em: Date | null; erro: string | null; falhas: number }>({ fase: "pronto", em: null, erro: null, falhas: 0 });
  const autoSalvar = async (forcar: string | null = null) => {
    setSalvamento((s) => ({ ...s, fase: "salvando" }));
    try {
      await salvar(forcar);
      setSalvamento({ fase: "pronto", em: new Date(), erro: null, falhas: 0 });
    } catch (e) {
      const c = conflitoDe(e);
      if (c) {
        setConflito(c);
        setVendoConflito(true);
        setSalvamento((s) => ({ ...s, fase: "pronto" }));
      } else setSalvamento((s) => ({ ...s, fase: "erro", erro: mensagemDeErro(e, "Não foi possível salvar."), falhas: s.falhas + 1 }));
    }
  };
  const pendenteDesde = useRef<number | null>(null);
  const haPendentes = aSalvar.length > 0;
  useEffect(() => {
    if (!haPendentes) {
      pendenteDesde.current = null;
      return;
    }
    if (salvamento.fase === "salvando") return;
    const agora = Date.now();
    pendenteDesde.current ??= agora;
    const espera = salvamento.fase === "erro" ? Math.min(30_000, 5_000 * salvamento.falhas) : Math.max(0, Math.min(ESPERA, pendenteDesde.current + ESPERA_MAXIMA - agora));
    const t = setTimeout(() => {
      pendenteDesde.current = null;
      void autoSalvar();
    }, espera);
    return () => clearTimeout(t);
    // A cada alteração (paginas), o prazo recomeça.
  }, [paginas, haPendentes, salvamento]);
  // Saindo da tela (um link, outro relatório): o que falta segue gravando em segundo plano.
  useEffect(
    () => () => {
      if (!descartar.current && alteradas().length) salvar().catch(() => undefined);
    },
    [],
  );
  // Fechar a aba do navegador antes de salvar pergunta; com a falha ou o conflito, também sair pela tela (o que falta não se grava).
  useSalvamentoPendente(haPendentes || salvamento.fase === "salvando");
  useAlteracoesPendentes(salvamento.fase === "erro" || !!conflito);
  // O que outro usuário gravou num grupo que este não alterou (o relatório lido de novo do servidor) entra na tela.
  useEffect(() => {
    const b = baseAgora.current;
    const novos = relatorio.abas.filter((a) => a.atualizadoEm !== b.versoes[a.chave] && JSON.stringify(paginasAgora.current[a.chave] ?? []) === JSON.stringify(b.paginas[a.chave] ?? []));
    if (!novos.length || emAndamento.current) return;
    mudarBase({ paginas: { ...b.paginas, ...Object.fromEntries(novos.map((a) => [a.chave, a.paginas])) }, versoes: { ...b.versoes, ...Object.fromEntries(novos.map((a) => [a.chave, a.atualizadoEm])) } });
    setPaginas((p) => ({ ...p, ...Object.fromEntries(novos.map((a) => [a.chave, a.paginas])) }));
    // O histórico tem as páginas de antes: o Desfazer não volta a elas por cima do que o outro gravou.
    setHistorico({ passado: [], futuro: [] });
  }, [relatorio]);
  const situacao = useMutation({
    mutationFn: async (acao: "finalizar" | "reabrir") => {
      // Finalizar salva antes o que falta (24/10/2026: depois do salvamento em andamento).
      if (acao === "finalizar") await salvar();
      return acao === "finalizar" ? servico.finalizarAba(relatorio.id, chave) : servico.reabrirAba(relatorio.id, chave);
    },
    onSuccess: (r, acao) => {
      setConfirmar(null);
      atualizar(r);
      // No painel (01/11/2026), o painel: o público passa a aparecer para os demais (ou some, ao reabrir).
      const publico = relatorio.visualizacao === "PUBLICO";
      if (!processo.comGrupos) toast.success(acao === "finalizar" ? `Painel finalizado, só para leitura${publico ? ": agora aparece para os demais." : "."}` : `Painel reaberto para a edição${publico ? ": não aparece mais para os demais até ser finalizado." : "."}`);
      else toast.success(acao === "finalizar" ? `${aba?.nome}: finalizado, com todas as abas (só para leitura).` : `${aba?.nome}: reaberto para a edição.`);
    },
    onError: (e) => {
      const c = conflitoDe(e);
      if (!c) return;
      setConfirmar(null);
      setConflito(c);
      setVendoConflito(true);
    },
  });
  const excluir = useMutation({
    mutationFn: () => {
      descartar.current = true;
      return servico.excluir(relatorio.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [rota] });
      toast.success(`${Documento} excluído.`);
      router.push(processo.tela);
    },
  });
  const editavel = aba?.podeEditar ?? false;
  // "Relatório" ou "Painel" (31/10/2026), no Excluir e nos avisos.
  const Documento = documento[0].toUpperCase() + documento.slice(1);
  // O Excluir Relatório só na aba Configurações (27/10/2026, pedido do Adão), embaixo do Cenário de Comparação; no painel
  // (01/11/2026), na aba Geral. Quem o põe é a parte das Configurações de cada processo.
  const botaoExcluir = relatorio.podeExcluir ? (
    <div className="flex justify-end">
      <Button type="button" variant="outline" className="rounded-sm border-red-300 text-red-700 hover:bg-red-50" onClick={() => setConfirmar("excluir")}>
        <Trash2 className="size-4" />
        Excluir {Documento}
      </Button>
    </div>
  ) : null;
  // A aba Configurações (22/10/2026), antes da Capa: só o painel dela, sem páginas.
  const configuracoes = chave === CONFIGURACOES;
  const emConfirmacao = confirmar === "finalizar" ? situacao : excluir;
  const vazia = daAba.every((p) => p.blocos.length === 0);
  const botaoIcone = "inline-flex size-8 items-center justify-center rounded-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:pointer-events-none disabled:opacity-40";
  const editaAlgum = relatorio.abas.some((a) => a.podeEditar);
  // O Colar do menu da edição (24/10/2026): o último bloco copiado no SIG (o botão não lê a área de transferência).
  const colarDoMenu = editavel && copia ? () => void colarBlocos(copia) : undefined;
  const classeDaSituacao = "inline-flex h-9 items-center gap-1.5 rounded-sm px-2 text-sm whitespace-nowrap";
  // O Ctrl+Z e o Ctrl+Y (ou Ctrl+Shift+Z) fora dos textos em edição (neles, valem os do navegador, na digitação) e dos modais.
  useEffect(() => {
    if (configuracoes || !editaAlgum) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || document.querySelector("[role=dialog]")) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      const tecla = e.key.toLowerCase();
      const acao = tecla === "z" && !e.shiftKey ? desfazer : tecla === "y" || (tecla === "z" && e.shiftKey) ? refazer : undefined;
      if (tecla !== "z" && tecla !== "y") return;
      e.preventDefault();
      acao?.();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  });
  // O Ctrl+V na página (24/10/2026): os blocos copiados no SIG entram direto, e o vídeo (o arquivo ou o link de uma das
  // plataformas) também; o texto e a imagem de outro programa abrem o Colar no Slide. Num texto em edição, vale a colagem
  // do navegador, menos para os blocos do SIG e para a imagem sem texto (que não cabem no texto).
  useEffect(() => {
    if (configuracoes || !editavel || !pagina) return;
    const aoColar = (e: ClipboardEvent) => {
      const dados = e.clipboardData;
      if (!dados || document.querySelector("[role=dialog]")) return;
      const arquivos = [...dados.files];
      const imagem = arquivos.find((a) => a.type.startsWith("image/")) ?? null;
      const arquivoDeVideo = arquivos.find((a) => TIPOS_DE_VIDEO.includes(a.type));
      const texto = dados.getData("text/plain");
      // O tipo do SIG; sem ele (a área de transferência que só guarda o texto), fora dos textos em edição, a última cópia do
      // SIG com esse texto.
      const doSig = copiaDe(dados.getData(TIPO_DA_COPIA)) ?? (arquivos.length || escrevendoAgora() ? null : copiaPeloTexto(texto));
      if (escrevendoAgora() && !doSig && !(imagem && !texto.trim())) return;
      // O link (sem espaços) ou o código "incorporar" da plataforma.
      const link = !imagem && (/^<iframe/i.test(texto.trim()) || (!!texto.trim() && !/\s/.test(texto.trim()))) ? videoDoTexto(texto) : null;
      if (!doSig && !arquivoDeVideo && !link && !imagem && !texto.trim()) return;
      e.preventDefault();
      if (doSig) void colarBlocos(doSig);
      else if (arquivoDeVideo) void colarVideo(arquivoDeVideo);
      else if (link) video.mutate({ v: link, quadro: null });
      else setColado({ imagem, texto, html: dados.getData("text/html") });
    };
    window.addEventListener("paste", aoColar);
    return () => window.removeEventListener("paste", aoColar);
  });
  return (
    // O nome do comparado (22/10/2026: o cenário das Configurações) no "vs." dos cards e na legenda, na tela, na apresentação e no PDF.
    <RotulosDoGrafico.Provider value={{ realizado: "Realizado", orcado: dados.data?.painel.rotuloComparado ?? "Orçado" }}>
    {/* A largura da área (a da grade, menos as margens de fora), para a altura da foto nova. */}
    <div ref={area} className="space-y-6">
      {barra(relatorio, chave, (c) => setAberta({ chave: c, pagina: null }))}
      <CabecalhoDaTela
        // O título da tela é o da aba aberta (17/10/2026: Introdução, Performance da Produção…); o mês fica na barra do topo.
        // No painel (31/10/2026), o nome da tela, Painel de Bordo (o título da aba, o nome do painel, fica nos slides).
        titulo={configuracoes ? "Configurações" : processo.comGrupos ? (aba?.titulo ?? `RE - ${relatorio.rotuloMes}`) : (aba?.nome ?? processo.nome)}
        acoes={
          // Na aba Configurações (22/10/2026), sem as ações: ela não tem páginas nem slides (não se apresenta nem se exporta).
          configuracoes ? undefined : (
          <div className="flex flex-wrap items-center gap-2">
            {/* A situação do salvamento automático (24/10/2026), no lugar do Gravar; antes do Adicionar. */}
            {editaAlgum ? (
              conflito ? (
                <button
                  type="button"
                  className={`${classeDaSituacao} font-semibold text-red-700 hover:bg-red-50`}
                  title={`${conflito.atualizadoPor ?? "Outro usuário"} gravou ${conflito.nome} depois que você abriu o ${documento}: clique para escolher o que fazer.`}
                  onClick={() => setVendoConflito(true)}
                >
                  <CloudAlert className="size-4" />
                  Não Salvo
                </button>
              ) : salvamento.fase === "erro" ? (
                <button type="button" className={`${classeDaSituacao} font-semibold text-red-700 hover:bg-red-50`} title={`${salvamento.erro} Tentando de novo; clique para tentar agora.`} onClick={() => void autoSalvar()}>
                  <CloudOff className="size-4" />
                  Não Salvo
                </button>
              ) : haPendentes || salvamento.fase === "salvando" ? (
                <span className={`${classeDaSituacao} text-gray-500`} role="status">
                  <LoaderCircle className="size-4 animate-spin" />
                  Salvando…
                </span>
              ) : (
                <span className={`${classeDaSituacao} text-gray-500`} role="status" title="As alterações se salvam sozinhas.">
                  <CloudCheck className="size-4" />
                  {salvamento.em ? `Salvo às ${salvamento.em.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "Salvo"}
                </span>
              )
            ) : null}
            {editavel ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button type="button" className={botaoPrimario} disabled={foto.isPending || video.isPending || imagemDeFundo.isPending}>
                      <Plus className="size-4" />
                      {enviando !== null ? `Enviando… ${Math.round(enviando * 100)}%` : foto.isPending || video.isPending || imagemDeFundo.isPending ? "Enviando…" : "Adicionar"}
                      <ChevronDown className="size-4" />
                    </Button>
                  }
                />
                {/* Na largura das opções, sem quebrar linha (22/10/2026: "Imagem com Legenda" quebrava). */}
                {/* Em três grupos (30/10/2026, pedido do Adão): Objetos, Texto e Imagem e Vídeo; a Imagem de Fundo vai para os botões das páginas. */}
                <DropdownMenuContent align="end" className="w-max min-w-44 [&_[role=menuitem]]:whitespace-nowrap">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-xs text-gray-500">Objetos</DropdownMenuLabel>
                    <DropdownMenuItem disabled={!dados.data} onClick={() => setAdicionando("padrao")}>
                      <LayoutGrid className="size-4" />
                      Cards Padrão
                    </DropdownMenuItem>
                    {/* Os Cards PROVA (31/10/2026, pedido do Adão): o realizado contra até quatro cenários marcados. */}
                    <DropdownMenuItem disabled={!dados.data} onClick={() => setAdicionando("prova")}>
                      <LayoutList className="size-4" />
                      Cards PROVA
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setAdicionandoTabela("padrao")}>
                      <Table2 className="size-4" />
                      Tabela Padrão
                    </DropdownMenuItem>
                    {/* A Tabela PROVA (31/10/2026, pedido do Adão): os cenários marcados lado a lado. */}
                    <DropdownMenuItem onClick={() => setAdicionandoTabela("prova")}>
                      <TableProperties className="size-4" />
                      Tabela PROVA
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-xs text-gray-500">Texto</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => incluir([{ tipo: "ANOTACAO", nota: "POSITIVO", texto: "" }])}>
                      <StickyNote className="size-4" />
                      Anotação
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => incluir([{ tipo: "TEXTO", texto: "" }])}>
                      <Type className="size-4" />
                      Texto Livre
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setAdicionandoSumario(true)}>
                      <ListOrdered className="size-4" />
                      Sumário
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-xs text-gray-500">Imagem e Vídeo</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => seletorDeFoto.current?.click()}>
                      <ImagePlus className="size-4" />
                      Imagem com Legenda
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => seletorDeImagem.current?.click()}>
                      <Imagem className="size-4" />
                      Imagem Livre
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setEscolhendoVideo("novo")}>
                      <Video className="size-4" />
                      Vídeo
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {/* O Finalizar do grupo (no painel, desde 01/11/2026, o do painel). */}
            {editavel ? (
              <Button type="button" className={botaoPrimario} onClick={() => (conflito?.aba === chave ? setVendoConflito(true) : setConfirmar("finalizar"))}>
                <CheckCheck className="size-4" />
                Finalizar
              </Button>
            ) : null}
            {aba?.podeReabrir ? (
              <Button type="button" className={botaoPrimario} disabled={situacao.isPending} onClick={() => situacao.mutate("reabrir")}>
                <LockOpen className="size-4" />
                Reabrir
              </Button>
            ) : null}
            <Button type="button" className={botaoPrimario} disabled={!slides.length} title={slides.length ? "Apresentar as páginas em tela inteira" : "Nenhuma página com blocos para apresentar"} onClick={apresentar}>
              <Presentation className="size-4" />
              Apresentar
            </Button>
            {/* O Exportar no fim da barra, como nas demais telas (30/10/2026). */}
            <ExportarPdfDoRelatorio
              relatorioId={relatorio.id}
              periodo={relatorio.rotuloMes}
              nome={relatorio.nome}
              slides={slides}
              grupo={{ chave, nome: aba?.nome ?? "" }}
              pagina={{ chave: `${chave}|${pagina?.id}`, nome: pagina ? nomeDaPagina(pagina, nPagina) : "" }}
              sumario={sumario}
              dados={dados.data}
              cores={cores}
              tipo={tipo}
            />
            <input
              ref={seletorDeFoto}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const arquivo = e.target.files?.[0];
                e.target.value = "";
                if (arquivo) foto.mutate({ arquivo, livre: false });
              }}
            />
            <input
              ref={seletorDeImagem}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const arquivo = e.target.files?.[0];
                e.target.value = "";
                if (arquivo) foto.mutate({ arquivo, livre: true });
              }}
            />
            <input
              ref={seletorDeFundo}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const arquivo = e.target.files?.[0];
                e.target.value = "";
                if (arquivo) imagemDeFundo.mutate(arquivo);
              }}
            />
          </div>
          )
        }
        comoUsar={comoUsar}
        sobre={sobreDoDocumento(relatorio)}
      />
      {/*
        As páginas da aba (16/10/2026), no formato das abas das telas, com o nome de cada uma (o do slide; na sua aba, dois
        cliques ou o lápis o editam) e, na altura delas, os botões só com ícones: renomear, incluir, excluir, recuar e avançar.
      */}
      {configuracoes ? conteudoDasConfiguracoes(relatorio, botaoExcluir) : null}
      {!configuracoes && aba?.visivel ? (
        <div className="flex items-end">
          <div role="tablist" aria-label={`Páginas de ${aba.nome}`} data-tour="abas" className="flex min-w-0 flex-1 gap-1 overflow-x-auto overflow-y-hidden border-b border-gray-200">
            {daAba.map((p, k) => {
              const atual = p.id === pagina?.id;
              const classe = `-mb-px inline-flex shrink-0 items-center border-b-2 px-3 py-2 text-sm whitespace-nowrap ${atual ? "border-black font-bold text-gray-900" : "border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-900"}`;
              return renomeando === p.id ? (
                <input
                  key={p.id}
                  autoFocus
                  defaultValue={p.nome ?? ""}
                  placeholder={`Página ${k + 1}`}
                  maxLength={60}
                  aria-label="Nome da página"
                  onFocus={(e) => e.target.select()}
                  onBlur={(e) => {
                    const nome = e.target.value.trim();
                    mudarPaginas(daAba.map((x) => (x.id === p.id ? { ...x, nome: nome || undefined } : x)));
                    setRenomeando(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") {
                      e.currentTarget.value = p.nome ?? "";
                      e.currentTarget.blur();
                    }
                  }}
                  className={`${classe} w-48 rounded-t-sm bg-white outline-none`}
                />
              ) : (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={atual}
                  onClick={() => setAberta({ chave, pagina: p.id })}
                  onDoubleClick={() => (editavel ? setRenomeando(p.id) : undefined)}
                  title={editavel ? "Dois cliques para mudar o nome (o do slide); arraste para trocar de lugar" : undefined}
                  // Arrastar a aba para trocar a página de lugar (17/10/2026), na aba que se edita.
                  draggable={editavel}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", p.id);
                    e.dataTransfer.effectAllowed = "move";
                    setArrastando(p.id);
                  }}
                  onDragOver={(e) => {
                    if (!arrastando || arrastando === p.id) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setSobre(p.id);
                  }}
                  onDragLeave={() => setSobre((s) => (s === p.id ? null : s))}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (arrastando) moverPagina(arrastando, p.id);
                    setArrastando(null);
                    setSobre(null);
                  }}
                  onDragEnd={() => {
                    setArrastando(null);
                    setSobre(null);
                  }}
                  className={`${classe} ${editavel ? "cursor-grab active:cursor-grabbing" : ""} ${sobre === p.id ? "rounded-t-sm bg-gray-100" : ""} ${arrastando === p.id ? "opacity-50" : ""}`}
                >
                  {nomeDaPagina(p, k)}
                </button>
              );
            })}
          </div>
          <div className="flex shrink-0 items-center gap-0.5 border-b border-gray-200 pb-0.5 pl-2">
            {editavel ? (
              <>
                <button type="button" className={botaoIcone} disabled={!pagina} onClick={() => pagina && setRenomeando(pagina.id)} title="Mudar o nome da página (o do slide)" aria-label="Mudar o nome da página">
                  <Pencil className="size-4" />
                </button>
                <button type="button" className={botaoIcone} onClick={novaPagina} title="Nova página (depois da aberta)" aria-label="Nova página">
                  <FilePlus2 className="size-4" />
                </button>
                <button
                  type="button"
                  className={`${botaoIcone} hover:text-red-700`}
                  disabled={daAba.length <= 1}
                  onClick={() => (daPagina.length ? setConfirmar("excluirPagina") : excluirPagina())}
                  title={daAba.length <= 1 ? "A única página da aba não se exclui" : "Excluir a página aberta"}
                  aria-label="Excluir a página"
                >
                  <FileX2 className="size-4" />
                </button>
                {/* A Imagem de Fundo da página (20/10/2026): sem ela, o ícone que a envia (30/10/2026, pedido do Adão; antes, no
                    Adicionar); com ela, no lugar dele, os de ajustar e remover. */}
                {pagina?.fundo ? (
                  <>
                    <button type="button" className={botaoIcone} onClick={() => setAjustandoFundo(pagina.fundo ?? null)} title="Ajustar a Imagem de Fundo da página" aria-label="Ajustar a Imagem de Fundo">
                      <Crop className="size-4" />
                    </button>
                    <button type="button" className={`${botaoIcone} hover:text-red-700`} onClick={() => mudarFundo(undefined)} title="Remover a Imagem de Fundo da página" aria-label="Remover a Imagem de Fundo">
                      <ImageOff className="size-4" />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={botaoIcone}
                    disabled={!pagina || imagemDeFundo.isPending}
                    onClick={() => seletorDeFundo.current?.click()}
                    title={imagemDeFundo.isPending ? "Enviando a Imagem de Fundo…" : "Imagem de Fundo da página"}
                    aria-label="Imagem de Fundo da página"
                  >
                    <ImageUp className="size-4" />
                  </button>
                )}
                {/* As Transições do slide (30/10/2026, pedido do Adão; antes, o botão Transições do topo): o ícone abre o modal
                    com a Animação e o Cronômetro, do slide aberto ou do grupo. */}
                {pagina ? (
                  <TransicoesDoSlide
                    key={pagina.id}
                    className={botaoIcone}
                    ajuste={ajusteDaPagina}
                    nomeDoSlide={nomeDaPagina(pagina, nPagina)}
                    uniformes={uniformes}
                    onMudar={mudarAjuste}
                    recomecar={processo.rota === "paineis-de-bordo" ? { marcado: recomecarAoTerminar, onMudar: mudarRecomecar } : undefined}
                  />
                ) : null}
                <span className="mx-1 h-5 w-px bg-gray-200" />
              </>
            ) : null}
            <button type="button" className={botaoIcone} disabled={aqui <= 0} onClick={() => ir(-1)} title="Página anterior" aria-label="Página anterior">
              <ChevronLeft className="size-4" />
            </button>
            <button type="button" className={botaoIcone} disabled={aqui < 0 || aqui >= sequencia.length - 1} onClick={() => ir(1)} title="Próxima página" aria-label="Próxima página">
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      ) : null}
      {dados.isError ? <Erro erro={mensagemDeErro(dados.error, "Erro ao carregar os dados dos cards.")} /> : null}
      {configuracoes ? null : !aba?.visivel ? (
        <p className="rounded-sm border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-600">
          A aba {aba?.nome} não está disponível.
        </p>
      ) : daPagina.length === 0 && !pagina?.fundo ? (
        <>
          {/* O menu da edição também na página vazia (o Desfazer traz de volta o último bloco excluído). */}
          {editavel ? <BarraDeEdicao desfazer={desfazer} refazer={refazer} colar={colarDoMenu} /> : null}
          <p className="rounded-sm border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-600">
            {editavel ? "A página está vazia: use “Adicionar”, na linha do título." : "Nada nesta página."}
          </p>
        </>
      ) : (
        <GradeDoRelatorio
          key={pagina?.id}
          relatorioId={relatorio.id}
          blocos={daPagina}
          sumario={sumario}
          fundo={pagina?.fundo}
          dados={dados.data}
          editavel={editavel}
          cores={cores}
          tipo={tipo}
          linhas={linhasDaPagina()}
          onCarregarImagem={(id, arquivo) => imagemNoQuadro.mutate({ id, arquivo })}
          onEscolherVideo={(id) => setEscolhendoVideo(id)}
          desfazer={desfazer}
          refazer={refazer}
          colar={colarDoMenu}
          escolher={escolher}
          onMudar={mudarPagina}
        />
      )}
      {/*
        O grupo gravado por outro usuário depois que este abriu o relatório (23/10/2026): recarregar (as alterações não
        salvas deste grupo se perdem) ou gravar por cima (as do outro, nesse grupo, se perdem). Com o Cancelar, o grupo fica
        sem salvar (24/10/2026; o "Não Salvo" reabre o aviso).
      */}
      {conflito && vendoConflito ? (
        <Dialog open onOpenChange={(o) => (!o ? setVendoConflito(false) : undefined)}>
          <DialogContent className="rounded-sm sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Gravado por Outro Usuário</DialogTitle>
              <DialogDescription>
                {conflito.atualizadoPor ?? "Outro usuário"} gravou {conflito.nome} em {dataHora(conflito.atualizadoEm)}, depois que você abriu o {documento}. As
                suas alterações deste grupo não foram salvas.
              </DialogDescription>
            </DialogHeader>
            <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
              <li>
                <strong>Recarregar</strong> traz o {documento} como está gravado agora, com as alterações de {conflito.atualizadoPor ?? "quem gravou"}; as suas
                alterações deste grupo se perdem.
              </li>
              <li>
                <strong>Gravar por Cima</strong> grava a sua versão de {conflito.nome}; as alterações de {conflito.atualizadoPor ?? "quem gravou"} nesse grupo se
                perdem.
              </li>
            </ul>
            <DialogFooter>
              <Button type="button" variant="outline" className="rounded-sm" onClick={() => setVendoConflito(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded-sm border-red-300 text-red-700 hover:bg-red-50"
                onClick={() => {
                  const c = conflito.aba;
                  setConflito(null);
                  setVendoConflito(false);
                  void autoSalvar(c);
                }}
              >
                Gravar por Cima
              </Button>
              <Button
                type="button"
                className={botaoPrimario}
                onClick={() => {
                  setVendoConflito(false);
                  // O relatório de agora: o editor remonta com ele, depois de salvar os outros grupos (as alterações do grupo em conflito saem).
                  void salvar()
                    .catch(() => undefined)
                    .then(() => {
                      descartar.current = true;
                      return onRecarregar();
                    });
                }}
              >
                Recarregar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
      {colado && pagina ? (
        <ColarNoSlideDialog colado={colado} pagina={nomeDaPagina(pagina, nPagina)} temFundo={!!pagina.fundo} onColar={(como) => aplicarColado(colado, como)} onFechar={() => setColado(null)} />
      ) : null}
      {apresentando !== null ? (
        <ApresentacaoDoRelatorio
          relatorioId={relatorio.id}
          periodo={relatorio.rotuloMes}
          slides={slides}
          sumario={sumario}
          inicial={apresentando}
          dados={dados.data}
          cores={cores}
          tipo={tipo}
          onSair={() => setApresentando(null)}
        />
      ) : null}
      {ajustandoFundo ? (
        <AjustarFundoDialog
          relatorioId={relatorio.id}
          fundo={ajustandoFundo}
          grupo={aba?.nome}
          onFechar={() => setAjustandoFundo(null)}
          onAplicar={(f, todoOGrupo) => {
            // Em todas as páginas do grupo (27/10/2026) ou só na aberta.
            if (todoOGrupo) mudarPaginas(daAba.map((p) => ({ ...p, fundo: f })));
            else mudarFundo(f);
            setAjustandoFundo(null);
          }}
        />
      ) : null}
      {adicionandoSumario ? (
        <ConfigurarSumarioDialog
          titulo="Adicionar Sumário"
          sumario={sumario}
          onFechar={() => setAdicionandoSumario(false)}
          onAplicar={(o) => {
            incluir([{ tipo: "SUMARIO", ...o }]);
            setAdicionandoSumario(false);
          }}
        />
      ) : null}
      {adicionandoTabela ? (
        <ConfigurarTabelaDialog
          relatorioId={relatorio.id}
          titulo={adicionandoTabela === "prova" ? "Adicionar Tabela PROVA" : "Adicionar Tabela Padrão"}
          prova={adicionandoTabela === "prova"}
          onFechar={() => setAdicionandoTabela(null)}
          onAplicar={(o) => {
            incluir([{ tipo: "TABELA", ...o }]);
            setAdicionandoTabela(null);
          }}
        />
      ) : null}
      {escolhendoVideo ? (
        <VideoDialog
          titulo={escolhendoVideo === "novo" ? "Adicionar Vídeo" : "Carregar Vídeo"}
          onFechar={() => setEscolhendoVideo(null)}
          onEscolher={(v) => {
            video.mutate({ v, quadro: escolhendoVideo === "novo" ? null : escolhendoVideo });
            setEscolhendoVideo(null);
          }}
        />
      ) : null}
      {adicionando && dados.data ? (
        <AdicionarCardsDialog
          dados={dados.data}
          prova={adicionando === "prova"}
          onFechar={() => setAdicionando(null)}
          onAdicionar={(novos) => {
            incluir(novos);
            setAdicionando(null);
          }}
        />
      ) : null}
      {confirmar === "excluirPagina" ? (
        <Dialog open onOpenChange={(o) => (!o ? setConfirmar(null) : undefined)}>
          <DialogContent className="rounded-sm sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Excluir a Página {pagina ? nomeDaPagina(pagina, nPagina) : ""}</DialogTitle>
              <DialogDescription>
                A página {pagina ? nomeDaPagina(pagina, nPagina) : ""} {processo.comGrupos ? `da aba ${aba?.nome}` : "do painel"} sai com os blocos dela. O Desfazer, no menu da edição, a traz de volta.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" className="rounded-sm" onClick={() => setConfirmar(null)}>
                Cancelar
              </Button>
              <Button type="button" variant="outline" className="rounded-sm border-red-300 text-red-700 hover:bg-red-50" onClick={excluirPagina}>
                Excluir
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : confirmar ? (
        <Dialog open onOpenChange={(o) => (!o ? setConfirmar(null) : undefined)}>
          <DialogContent className="rounded-sm sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{confirmar === "finalizar" ? (processo.comGrupos ? `Finalizar ${aba?.nome ?? ""}` : "Finalizar Painel") : `Excluir ${Documento}`}</DialogTitle>
              <DialogDescription>
                {confirmar === "finalizar"
                  ? processo.comGrupos
                    ? `O grupo ${aba?.nome} de ${relatorio.rotuloMes}, com todas as abas dele, fica finalizado, só para leitura.${mudouAba ? " As alterações ainda não salvas são salvas antes." : ""}${vazia ? " O grupo está vazio." : ""} Você pode reabri-lo depois.`
                    : // O painel (01/11/2026): o público só aparece para os demais depois de finalizado.
                      `O painel ${relatorio.nome}, com todas as abas, fica finalizado, só para leitura${relatorio.visualizacao === "PUBLICO" ? ", e passa a aparecer para todos os que leem os Painéis de Bordo (é Público)" : " (é Privado: continua só para você e os Administradores)"}.${mudouAba ? " As alterações ainda não salvas são salvas antes." : ""}${vazia ? " O painel está vazio." : ""} Você pode reabri-lo depois.`
                  : relatorio.nome
                    ? `O painel ${relatorio.nome}, com todas as páginas, as imagens e os vídeos, é excluído.`
                    : `O relatório de ${relatorio.rotuloMes}, com todas as abas, é excluído.`}
              </DialogDescription>
            </DialogHeader>
            <Erro erro={emConfirmacao.isError ? mensagemDeErro(emConfirmacao.error, "Não foi possível concluir.") : null} />
            <DialogFooter>
              <Button type="button" variant="outline" className="rounded-sm" onClick={() => setConfirmar(null)}>
                Cancelar
              </Button>
              {confirmar === "finalizar" ? (
                <Button type="button" className={botaoPrimario} disabled={situacao.isPending} onClick={() => situacao.mutate("finalizar")}>
                  {situacao.isPending ? "Finalizando…" : "Finalizar"}
                </Button>
              ) : (
                <Button type="button" variant="outline" className="rounded-sm border-red-300 text-red-700 hover:bg-red-50" disabled={excluir.isPending} onClick={() => excluir.mutate()}>
                  {excluir.isPending ? "Excluindo…" : "Excluir"}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
    </RotulosDoGrafico.Provider>
  );
}

/** O Como Usar do relatório executivo: a barra do topo e as Configurações, o que é comum aos painéis e o Finalizar. */
function ComoUsarDoRelatorio() {
  return (
    <ul>
      <li>
        A barra do topo mostra o mês (clique nele para ir a outro relatório), as oito abas — Capa, Introdução, Resultados (Demonstrativo de
        Resultados), Comercial (Performance Comercial), Produção (Performance da Produção), Serviços (Performance de Serviços), Administrativo
        (Performance Administrativa) e Encerramento — e, à direita, a situação do relatório. Todos os que leem a tela veem todas as
        abas, e todos os que a editam editam todas (sem o recorte de departamentos). Os slides da Capa abrem a apresentação e os do Encerramento a fecham; os dois têm os blocos onde se põem e não entram
        na contagem dos slides nem no Sumário (o contador do topo e os números do Sumário começam na Introdução). O check verde ao lado do nome (o das etapas feitas do Fechamento Mensal) diz que o grupo está finalizado (a dica dele mostra quem o
        finalizou e quando).
      </li>
      <li>
        Configurações, antes da Capa, é preliminar à apresentação: não tem páginas, não conta nos slides e não entra na tela inteira nem no PDF. Ela tem
        dois grupos. A Comparação Padrão é o orçado dos Cards Padrão (Painel de Bordo e Indicadores) e das Tabelas Padrão: de início, o cenário marcado
        como Orçamento (a etiqueta amarela; o relatório acompanha a marcação até que se escolha um cenário); ou escolha um dos cenários da lista — os
        cenários com marcação, de qualquer exercício, com o ano, o tipo (Sintético ou Analítico) e a marcação em etiquetas — para o relatório ficar com
        ele enquanto ele tiver a marcação (se a marcação passar para outro cenário, o relatório volta ao marcado como Orçamento; num cenário de outro
        exercício, valem os mesmos meses dele). A Comparação PROVA são os cenários dos
        Cards PROVA e das Tabelas PROVA: marque dois ou mais dos cenários marcados (Forecast, Orçado, Vendido e Anterior, cada um com o quadradinho da cor
        dele; de início, todos); com dois marcados, eles não se desmarcam antes de se marcar outro. Ela acompanha as marcações: se uma marcação passar para
        outro cenário, os objetos PROVA comparam com ele. Quem edita a tela escolhe, e as escolhas se salvam na hora (“Salvo às…”, embaixo das listas); os
        demais só veem. Embaixo, “Excluir Relatório” (de quem o criou ou do Administrador, enquanto nenhum grupo está finalizado) exclui o relatório, com
        todas as abas, depois da confirmação.
      </li>
      <ItensDoComoUsar />
      <li>
        “Finalizar” salva o que falta e finaliza o grupo aberto (Capa, Introdução,
        Administrativo…), com todas as abas dele, só para leitura, e o grupo ganha o check verde na barra do topo; “Reabrir” o devolve à elaboração. O relatório
        fica Finalizado quando todos os grupos estão finalizados.
      </li>
    </ul>
  );
}

/**
 * Os itens do Como Usar comuns aos Relatórios Executivos e aos Painéis de Bordo (31/10/2026: as mesmas páginas, blocos,
 * edição, apresentação, PDF e salvamento), com as frases que mudam de um processo para o outro (as abas e os grupos do
 * relatório; a tela única do painel).
 */
export function ItensDoComoUsar() {
  const p = useProcesso();
  const d = p.documento;
  // O relatório tem os grupos (as abas da barra do topo); o painel, uma tela só.
  const g = p.comGrupos;
  return (
    <>
      <li>
        {g ? (
          <>
            Cada aba tem uma ou mais páginas, logo abaixo do título. O nome da página é o do slide na apresentação (de início, “Página 1”): na sua aba,
            dois cliques nele (ou o lápis) o editam, e arrastar a aba de uma página para outra posição a troca de lugar (a ordem dos slides acompanha). Os outros botões ao lado delas incluem uma página nova (depois da aberta), excluem a página aberta (com
            blocos, pede confirmação; a única página não se exclui) e recuam ou avançam pelas páginas, passando de uma aba para a outra.
          </>
        ) : (
          <>
            A tela tem uma ou mais abas (as páginas do painel), logo abaixo do título. O nome da aba é o do slide na apresentação (de início, “Página 1”):
            dois cliques nele (ou o lápis) o editam, e arrastar uma aba para outra posição a troca de lugar (a ordem dos slides acompanha). Os outros botões
            ao lado delas incluem uma aba nova (depois da aberta), excluem a aba aberta (com blocos, pede confirmação; a única não se exclui) e recuam ou
            avançam pelas abas.
          </>
        )}{" "}
        A página tem o tamanho da tela padrão, 1920 × 1080 (o contorno tracejado): os blocos não passam dele. Na apresentação e no PDF, o slide se
        reduz ou se amplia por inteiro para caber na tela de quem abre, com a mesma aparência e os blocos nos mesmos lugares em qualquer resolução.
      </li>
      <li>
        {g ? "Na sua aba, “Adicionar”" : "“Adicionar”"} traz dez opções, em três grupos, que entram na página aberta: Objetos (Cards Padrão, Cards PROVA, Tabela Padrão e Tabela PROVA), Texto (Anotação, Texto
        Livre e Sumário) e Imagem e Vídeo (Imagem com Legenda, Imagem Livre e Vídeo). Cards Padrão abre o modal Adicionar Cards Padrão, com a lista dos cards do Painel de Bordo e
        dos Indicadores (o card de destaque, com o valor do mês e o acumulado, cada um com o orçado num quadro cinza e a faixa de melhor ou pior, como no Painel), com ou sem o gráfico (a caixa Com Gráfico): marque os que quiser; eles entram no fim da página, os do
        Painel e os dos Indicadores com os rótulos e em barras (o Configurar Gráfico do card muda); a Metodologia, à direita do nome, ocupa até metade da largura dos valores, quebrando as linhas. Os cards trazem só as competências fechadas, até o mês do {d}.
      </li>
      <li>
        Cards PROVA abre o modal Adicionar Cards PROVA: os mesmos cards, comparados com os cenários da Comparação PROVA (Configurações), que o modal
        lista; ela vale para todos os objetos PROVA do {d}. No
        card PROVA, embaixo do valor do mês e do acumulado, cada cenário vem numa linha: “vs.” e o cenário, com o quadradinho da cor dele, o orçado, a
        variação e a faixa de melhor ou pior à direita (a dica traz o nome do cenário). O gráfico traz uma série por cenário: nas barras, uma coluna para
        cada um; na área, o realizado em área e os cenários em linhas. As cores: o Forecast em cinza forte (cinza fraco no tema Escuro), o Orçado em
        preto (claro no Escuro), o Vendido em ouro forte e o Anterior em ouro fraco; o realizado continua no amarelo-ouro. Num slide com cards ou
        tabelas PROVA, os cards e as tabelas padrão ficam na cor do cenário de comparação do {d} (comparado com o Forecast, em cinza forte, como
        no PROVA).
      </li>
      <li>
        Anotação inclui um bloco de texto ao lado do último bloco, no formato dos cards do Painel: o título em cima (de início, o nome da nota; clique
        nele para mudar) e o texto no card com o destaque da cor. No menu da edição (logo abaixo das abas, com o bloco escolhido), a formatação do
        texto da anotação e da legenda da imagem: negrito, itálico, sublinhado, aumentar e diminuir a fonte, a cor (Padrão — a cor do tema —, cinza, ouro,
        verde, azul, amarelo, laranja, vermelho e branco) e os marcadores (quadrado, seta, check e erro, o “x”); o tamanho da fonte é o botão com o número (clique nele para escolher, de 10 a 144; o padrão, 14, tem asterisco). Nas anotações e no Texto Livre, também a fonte (o botão Aa: Padrão, Arial, Calibri, Segoe UI, Verdana, Georgia e as abertas Roboto, Open Sans, Montserrat, Lato e Poppins; a fonte do texto onde está o cursor fica destacada na lista, em negrito e com o fundo cinza) e o espaçamento entre as linhas (de 0,50 a 2,00, para o texto todo do bloco; 1,00 é o simples, e Padrão volta ao de antes). Ela vale para o trecho selecionado (diminuir ou voltar ao padrão vale também para parte de um trecho aumentado); sem seleção,
        para todo o texto. Com o cursor no título da anotação, o botão do tamanho muda o do título (de 12 a 32; o padrão, 18), e o da fonte, a dele. No menu da edição, escolha a nota: Positivo (verde; azul com a Acessibilidade Daltonismo, no menu do usuário),
        Negativo (vermelho) ou Atenção (laranja). A anotação pode ficar baixa a ponto de mostrar uma linha só do texto. Enquanto você escreve, ela cresce
        sozinha quando o texto passa da altura dela (até o pé da página), e os blocos de baixo descem.
      </li>
      <li>
        Texto Livre inclui um texto com a formatação das anotações, com a fonte e o espaçamento entre as linhas (no menu da edição; o tamanho até 144 e o
        branco servem aos textos sobre a Imagem de Fundo), mas sem o destaque lateral, o título, o ícone e o fundo: na edição, o contorno tracejado aparece com o mouse
        sobre ele. Como a anotação, ele cresce sozinho enquanto você escreve. Na apresentação, ele não se destaca nem se amplia.
      </li>
      <li>
        {g ? (
          <>
            Sumário abre o modal Adicionar Sumário: listar as Telas (cada uma com o número do primeiro slide dela) ou as Telas e Slides (abaixo de cada
            tela, os slides, com os números), e as telas que entram (da Introdução em diante; de início, todas). A lista se monta sozinha, com os slides de
            agora (as páginas com algum bloco ou com a Imagem de Fundo): os números são a contagem dos slides a partir da Introdução, a mesma do contador
            do topo dos slides; a tela marcada sem slides não aparece.
          </>
        ) : (
          <>
            Sumário abre o modal Adicionar Sumário: listar a Tela (o Painel de Bordo, com o número do primeiro slide) ou as Telas e Slides (abaixo da tela,
            os slides do painel, com os números). A lista se monta sozinha, com os slides de agora (as páginas com algum bloco ou com a Imagem de Fundo): os
            números são a contagem dos slides a partir do primeiro, a mesma do contador do rodapé dos slides.
          </>
        )}{" "}
        O Sublinhado (Pontos, Traços, Linha ou Nenhum) é a linha entre o nome e o número, na cor
        do texto. A engrenagem do menu da edição muda as opções. No menu, a formatação do texto (sem os marcadores e o espaçamento, quase apagados): negrito, itálico, sublinhado, o
        tamanho, a fonte e a cor, que valem para todas as telas ou para todos os slides — em Telas e Slides, o botão Telas | Slides, no fim da formatação, escolhe qual nível
        ela muda (de início, as telas em negrito, com 16, e os slides com 14).
      </li>
      <li>
        Tabela Padrão abre o modal Adicionar Tabela Padrão: a tabela de Resultados de uma aba (Consolidado, Matriz, Filial, Serviços, Despesas e Extra ou RN), até o mês do {d}, como na
        tela Resultados, com o orçado e a variação. Escolha o Modo (Totais, Atribuições ou Contas, como os níveis da tela), os Meses Anteriores (Recolhidos: só o mês do {d} e os totais;
        Expandidos: de janeiro ao mês do {d}), as Colunas (Valores Unitários, o R$/m³, que Despesas e Extra e RN não têm; Diferença; Atingimento; e Eficiência: marcadas,
        entram; de início, todas) e os Totais e Contas que entram (de início, todos; marcar um total marca as linhas dele). A tabela inteira cabe no bloco: ela
        se reduz na proporção (aumente o bloco para lê-la maior; menos linhas, como em Totais, ficam maiores). A engrenagem do menu da edição muda as opções. Na apresentação, como os
        cards, ela se destaca sob o mouse e se amplia ao clicar.
      </li>
      <li>
        Tabela PROVA abre o modal Adicionar Tabela PROVA: a mesma tabela, com os cenários da Comparação PROVA (Configurações), como nos Cards PROVA.
        Depois do mês do {d} e depois do total, cada cenário vem no seu grupo de colunas, lado a lado, no lugar
        do orçado: o valor, o % e o R$/m³. As colunas da Diferença, do Atingimento e da Eficiência não entram (das opcionais, só o R$/m³). Cada grupo
        tem o rótulo na cor do cenário (a dos Cards PROVA), e as linhas, as variações mais fracas dela (as linhas de resultado, a média; os totais, a
        mais fraca; as contas, brancas), como o cinza do orçado; o Orçado fica como o orçado da Tabela Padrão. A dica do rótulo traz o nome do cenário.
      </li>
      <li>
        Imagem com Legenda envia uma imagem (JPEG, PNG, WebP ou GIF; reduzida a até 1600 px; as partes transparentes continuam transparentes) e a inclui com a legenda embaixo, no destaque
        amarelo-ouro. Ao adicionar a imagem (e, depois, pelo botão Cortar e Posicionar do menu da edição), o modal Cortar e Posicionar escolhe o tamanho
        do bloco: Na Proporção da Imagem (a lista da largura em colunas; a altura acompanha, e a imagem fica inteira), Tamanho Pronto (a lista das
        frações do slide, de inteira a 1/4 na largura e na altura, cada uma com o desenho dela no slide) ou Tamanho Atual (ao lado, as colunas e as
        linhas do bloco). Como na Imagem de Fundo, a imagem cobre o quadro: arraste-a para posicioná-la e use o Tamanho (ou a roda do mouse) para
        aumentá-la; na proporção, aumentá-la a corta no quadro. Embaixo, o Brilho, a Matiz, a Saturação, o Desfoque e a Transparência; “Restaurar
        Ajustes”, no rodapé, volta a imagem ao centro, a 100% e sem os ajustes. Inteira, a imagem aumenta e diminui sempre na mesma proporção, pelos
        cantos; cortada, por todos os quadrados de ancoragem, e continua cobrindo o quadro. Nas imagens (com legenda, livres e de fundo), o botão de
        ajustes da barra do bloco (ou o modal da Imagem de Fundo) muda o Brilho, a Matiz, a Saturação, o Desfoque e a Transparência; nas com legenda e nas livres, também a Borda (a
        espessura e a cor) e o Sombreamento centralizado (a intensidade e o desfoque). Nas barras dos modais das imagens, o valor também se digita (a
        barra acompanha). “Restaurar Ajustes”, no canto esquerdo do rodapé, volta à imagem como veio, e “Trocar
        Imagem” põe outra imagem no lugar, com os ajustes de agora (o bloco fica na proporção da nova; na cortada, o quadro fica, e a nova o cobre).
      </li>
      <li>
        Imagem Livre envia uma imagem como a Imagem com Legenda, mas a inclui sozinha: sem a legenda e sem o fundo (um PNG transparente fica transparente sobre o
        slide). Como ela, abre o Cortar e Posicionar ao entrar; na proporção, aumenta e diminui na mesma proporção (até duas linhas de altura ou uma coluna de largura, o que vier antes) e, na apresentação, como as demais imagens, se destaca sob o mouse e se amplia ao clicar.
      </li>
      <li>
        Vídeo abre o modal Adicionar Vídeo: um arquivo do computador (MP4, WebM, MOV, M4V ou OGG, até 200 MB; o botão Adicionar mostra o andamento do
        envio) ou o link de um vídeo público do YouTube, do Instagram, do Facebook ou do LinkedIn (o endereço ou o código “incorporar” da
        plataforma). Ele entra como a Imagem com Legenda, com a legenda embaixo; o do computador e o do YouTube aumentam e diminuem na proporção do vídeo. Na edição
        e na leitura, o vídeo tem os controles do player.
      </li>
      <li>
        A Imagem de Fundo fica nos botões ao lado das páginas: o ícone de imagem envia uma (reduzida a até 2560 px) e abre o modal Imagem de Fundo,
        com a miniatura da tela inteira: arraste a imagem
        para posicioná-la e use o Tamanho (ou a roda do mouse sobre ela) para aumentá-la; “Restaurar Ajustes” a centraliza a 100% (o tamanho que
        cobre a tela) e sem os ajustes. Ela
        ocupa o fundo do slide inteiro, por cima do cabeçalho (a faixa tracejada da miniatura) e atrás dos blocos; cada página tem uma. Na página, ela
        aparece atrás da grade; com ela, o ícone de imagem dá lugar aos de ajustá-la e removê-la. Uma página só com a Imagem de Fundo já é um slide. No modal, “Aplicar
        Em Todo o {p.grupo}” põe a mesma imagem, na mesma posição e com os mesmos ajustes, em todas as páginas {g ? "do grupo aberto" : "do painel"}.
      </li>
      <li>
        O ícone Transições, nos botões ao lado das páginas (depois dos da Imagem de Fundo), abre o modal Transições do slide aberto, em que as
        mudanças valem na hora: em Animação, a lista Tipo escolhe como o slide entra na apresentação: Esmaecer (o novo aparece
        sobre o anterior), Rolar Vertical ou Rolar Horizontal (o novo empurra o anterior: ao avançar, de baixo ou da direita; ao recuar, de cima ou
        da esquerda), ou Nenhuma (a troca na hora). Em Cronômetro, “Avançar Após”, digite os segundos: na apresentação, o slide passa
        sozinho ao próximo depois desse tempo (em branco ou zero, só pelas setas). A Animação e o Cronômetro têm cada um o seu “Aplicar ao {p.grupo}”:
        marcado, a mudança vale para todos os slides do {p.grupo.toLowerCase()} (marcar a caixa já leva a transição, ou o avanço, do slide aberto a todos; ela abre
        marcada quando todos já são iguais); desmarcado, só para o slide aberto. A página nova entra com a transição e o avanço da aberta.
        {p.rota === "paineis-de-bordo"
          ? " No Cronômetro do painel, “Recomeçar ao Terminar” (vale para o painel inteiro) faz a apresentação voltar à primeira página depois do Avançar Após da última: o painel fica passando em ciclo."
          : ""}
      </li>
      <li>
        Como no Canva: clique num bloco para escolhê-lo (o contorno tracejado, com o mouse sobre um bloco, mostra qual o clique escolhe). O escolhido fica destacado
        em azul, com os quadrados de ancoragem nos cantos e no meio dos lados: arraste um quadrado para redimensionar (até um tamanho mínimo, para as
        informações não se amontoarem; a imagem e os vídeos só pelos cantos, na proporção deles). Clique e segure na borda destacada para mover o bloco.
        Ao mover ou redimensionar, a grade aparece no fundo, bem clara, e o bloco se encaixa nela; o bloco arrastado sobre outro o empurra e, se você
        continua arrastando e sai de cima dele, o empurrado volta ao lugar. Um clique fora dos blocos ou o Esc soltam o escolhido; o Delete (fora de um
        texto) o exclui. Num vídeo, o primeiro clique o escolhe; depois, o player responde. O bloco adicionado ou colado já fica escolhido.
      </li>
      <li>
        Copiar e colar: com um bloco escolhido, o Ctrl+C (ou o Copiar do menu da edição) o copia, e o Ctrl+X o recorta; o Ctrl+V (ou o Colar) o cola
        na página aberta — {g ? "desta ou de outra aba, ou de outro relatório ou painel de bordo" : "desta ou de outra aba, ou de outro painel ou relatório executivo"} (as imagens e os vídeos vêm junto) —, no lugar livre mais perto de onde ele
        estava (sem lugar na página, embaixo do último bloco). Num texto em edição, o Ctrl+C copia o trecho selecionado; sem trecho, o bloco. De outro
        programa, o Ctrl+V de um texto ou de uma imagem abre o Colar no Slide: o texto entra como Texto Livre ou como Anotação (Positivo, Negativo ou
        Atenção), com a formatação básica (negrito, itálico, sublinhado e listas; sem as fontes, os tamanhos e as cores de lá) ou só o texto; a imagem,
        como Imagem com Legenda, Imagem Livre ou Imagem de Fundo. Com o texto e a imagem juntos (a cópia do Word ou do Excel), as duas escolhas. O link
        de um vídeo do YouTube, do Instagram, do Facebook ou do LinkedIn (ou um arquivo de vídeo) entra direto como vídeo, sem o modal. Num texto em
        edição, o Ctrl+V de fora cola no próprio texto.
      </li>
      <li>
        O menu da edição, logo abaixo das abas (centralizado e preso no alto ao rolar a página), tem as opções de todos os tipos de bloco, sempre
        nos mesmos lugares; as que não valem para o bloco escolhido ficam quase apagadas (o nome do bloco aparece na dica da borda dele). Da esquerda para a
        direita: Desfazer e Refazer (Ctrl+Z e Ctrl+Y, ou Ctrl+Shift+Z: as alterações desta sessão, {g ? "em todas as abas" : "em todas as páginas"}, até 100 passos; a digitação seguida
        conta como um passo, e o Desfazer abre {g ? "a aba e a página" : "a página"} da alteração; dentro de um texto em edição, o Ctrl+Z desfaz a digitação, como no
        navegador), Copiar e Colar (o bloco; veja acima), os dados dos cards do Painel e dos Indicadores, padrão e PROVA (em ciclo: o Atual e o
        Acumulado → apenas o Atual, com o calendário no ícone → apenas o Acumulado, com o Σ; com um só, ele fica antes do gráfico, o nome em cima da
        Metodologia, e o card muda de largura na proporção), o gráfico dos cards do Painel e dos Indicadores (em
        ciclo: os meses e o acumulado → só o acumulado, com o “A” no ícone → sem gráfico; o card muda de largura na proporção), o Zoom do card (100%,
        125%, 150%, 200%, 250% ou 300%: o conteúdo inteiro — os textos, os valores e o gráfico — maior, no mesmo bloco; o que não couber, aumente o
        bloco), Configurar (as opções do
        gráfico — os rótulos e o tipo, neste card ou em todos os cards da aba; as cores seguem a Acessibilidade —, do Sumário ou da Tabela), os ajustes da
        imagem, o Cortar e Posicionar, as notas das anotações, a formatação do texto (nas anotações, no Texto Livre, nas legendas e, a do Sumário, por nível) e excluir.
      </li>
      <li>
        {g ? (
          <>
            “Apresentar” mostra as páginas com blocos como slides, em tela inteira e sem o menu lateral, a partir da página aberta, com o grupo (o título da aba:
            Introdução, Performance da Produção…), em cinza, a seta e o nome do slide (o da página), em preto, à esquerda do topo, e “Relatório Executivo”, em
            cinza, a seta, o período, em preto, e a logo da BPM à direita; embaixo, o rodapé, com o separador igual ao do cabeçalho (atrás da Imagem de Fundo, como o do cabeçalho): à esquerda, a legenda dos cards (nos slides
            com cards do Painel ou dos Indicadores; com cards PROVA, os cenários do slide, cada um na cor dele), e, à direita, o contador dos slides (“1/10”: o slide em preto e negrito e o total, contados da
            Introdução em diante; nos slides da Capa e do Encerramento, sem ele). Mova o mouse para ver os botões, no centro da base:
            o grupo anterior (a aba), recuar, avançar, o próximo grupo e sair (as setas do teclado também mudam o slide; Esc encerra).
          </>
        ) : (
          <>
            “Apresentar” mostra as páginas com blocos como slides, em tela inteira e sem o menu lateral, a partir da página aberta, com o nome do painel, em
            cinza, a seta e o nome do slide (o da página), em preto, à esquerda do topo, e “Painel de Bordo”, em cinza, a seta, a competência, em preto, e a
            logo da BPM à direita; embaixo, o rodapé, com o separador igual ao do cabeçalho (atrás da Imagem de Fundo, como o do cabeçalho): à esquerda, a
            legenda dos cards (nos slides com cards do Painel ou dos Indicadores; com cards PROVA, os cenários do slide, cada um na cor dele), e, à direita, o
            contador dos slides (“1/10”: o slide em preto e negrito e o total). Mova o mouse para ver os botões, no centro da base: recuar, avançar e sair
            (as setas do teclado também mudam o slide; Esc encerra).
          </>
        )}{" "}
        Passe o mouse num bloco para destacá-lo; clique nele para
        ampliá-lo na tela, com o fundo escurecido (um clique em qualquer lugar fecha). Num card do Painel, o clique no gráfico amplia só o gráfico, e
        na parte antes dele, só essa parte (o nome e os valores, como num card sem gráfico). Num vídeo, o mouse sobre ele mostra, no centro de baixo,
        Reproduzir (Pausar, tocando), Parar e Mudo; o clique o amplia, continuando de onde estava, com os controles do player (a barra para avançar
        e recuar, o volume e a tela cheia; um clique fora do vídeo ou o Esc fecha, e o vídeo da página fica no ponto em que parou). No Instagram, no
        Facebook e no LinkedIn, que não aceitam os botões da página, o vídeo toca ampliado, nos controles da plataforma. Na apresentação, os textos
        não se selecionam.
      </li>
      <li>
        “Exportar” baixa os slides em PDF, como na apresentação (um slide por página, na tela padrão, 1920 × 1080):{" "}
        {g
          ? "Toda a Apresentação, o Grupo Atual (a aba do relatório aberta: Capa, Introdução, Administrativo…) ou a Aba Atual (a página aberta)"
          : "Toda a Apresentação ou a Aba Atual (a página aberta)"}
        , com o número de slides de cada um. Vale o que está na tela, gravado
        ou não; o botão mostra o andamento (Gerando PDF… 3/12), e os vídeos saem como um quadro com o ícone (o player não vira imagem).
      </li>
      <li>
        As alterações se salvam sozinhas, como no Canva: 2 segundos depois da última (numa edição sem pausa, a cada 10 segundos). Na linha do título, antes
        do Adicionar, a situação: Salvando…, Salvo às 14:32 ou Não Salvo, em vermelho. Sem conexão ou durante uma publicação do SIG, o Não Salvo tenta de novo
        sozinho (clique nele para tentar na hora). Saindo da tela por um link, o que falta se salva em segundo plano; fechar ou recarregar a aba do
        navegador antes de salvar pergunta.{" "}
        {g ? (
          <>
            Se outra pessoa gravou o mesmo grupo depois que você abriu o relatório, nada desse grupo é salvo: o aviso diz
            quem gravou e quando, e você escolhe Recarregar (vê o que ela gravou; as suas alterações desse grupo se perdem) ou Gravar por Cima (a sua versão
            do grupo fica; as dela, nesse grupo, se perdem); com o Cancelar, o grupo fica sem salvar, e o Não Salvo reabre o aviso. Na Auditoria, as
            gravações seguidas de um grupo pela mesma pessoa ficam numa entrada só, a mais recente (com quantas foram e desde quando).
          </>
        ) : (
          <>
            Se o painel foi gravado em outro lugar (outra aba do navegador ou o Administrador) depois que você o abriu, nada é salvo: o aviso diz quem
            gravou e quando, e você escolhe Recarregar (vê o que foi gravado; as suas alterações se perdem) ou Gravar por Cima (a sua versão fica; a outra se
            perde); com o Cancelar, o painel fica sem salvar, e o Não Salvo reabre o aviso. Na Auditoria, as gravações seguidas do painel pela mesma pessoa
            ficam numa entrada só, a mais recente (com quantas foram e desde quando).
          </>
        )}
      </li>
    </>
  );
}

/**
 * A barra do relatório (16/10/2026), no topo da tela, no formato da barra de etapas do Fechamento Mensal: o mês em
 * amarelo-ouro (o menu dele leva aos outros relatórios), as abas (o nome curto; o título na dica), com o ícone de check
 * nos finalizados (a dica diz quem finalizou e quando), e, à direita, a situação do relatório.
 */
function BarraDoRelatorio({ relatorio, chave, onMudar }: { relatorio: Relatorio; chave: string; onMudar: (chave: string) => void }) {
  const router = useRouter();
  const lista = useQuery({ queryKey: ["relatorios-executivos"], queryFn: () => relatoriosExecutivosService.listar() });
  return (
    <nav aria-label="Abas do relatório" data-tour="barra-de-atividades" className="flex min-w-0 flex-col gap-1 rounded-sm border border-gray-200 bg-white px-2 py-1.5 xl:flex-row xl:items-center">
      <div className="flex shrink-0 items-center gap-1.5 px-1">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button type="button" className="bg-bpm-primary hover:bg-bpm-primary-hover inline-flex items-center gap-1 rounded-sm px-2.5 py-1 text-sm font-bold text-black">
                RE · {relatorio.rotuloMes}
                <ChevronDown className="size-3.5 text-black/70" />
              </button>
            }
          />
          <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-gray-500">Ir para outro relatório</DropdownMenuLabel>
              {(lista.data?.relatorios ?? []).map((r) => (
                <DropdownMenuItem
                  key={r.id}
                  onClick={() => r.id !== relatorio.id && podeSair() && router.push(`/analises-gerenciais/relatorios-executivos/${r.id}`)}
                  className={r.id === relatorio.id ? "font-bold" : ""}
                >
                  {r.rotuloMes}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {/* Quebra em duas linhas quando falta largura, sem rolar a página. */}
      <ol className="flex min-w-0 flex-wrap items-center gap-y-1 xl:ml-2">
        {/* Configurações (22/10/2026), antes da Capa: preliminar à apresentação (sem slides). */}
        <li className="flex shrink-0 items-center">
          <button
            type="button"
            aria-current={chave === CONFIGURACOES ? "page" : undefined}
            title="Configurações do relatório (o cenário de comparação)"
            onClick={() => onMudar(CONFIGURACOES)}
            className={`inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-sm whitespace-nowrap ${chave === CONFIGURACOES ? "bg-black font-bold text-white" : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"}`}
          >
            <Settings className="size-4" />
            Configurações
          </button>
        </li>
        {relatorio.abas.map((a) => {
          const ativa = a.chave === chave;
          return (
            <li key={a.chave} className="flex shrink-0 items-center">
              <button
                type="button"
                aria-current={ativa ? "page" : undefined}
                title={a.titulo}
                onClick={() => onMudar(a.chave)}
                className={`inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-sm whitespace-nowrap ${ativa ? "bg-black font-bold text-white" : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"}`}
              >
                {a.nome}
                {a.situacao === "FINALIZADO" ? (
                  // O check das etapas feitas do Fechamento Mensal (23/10/2026; antes, o check no círculo).
                  <span title={`Finalizado${a.finalizadoPor ? ` por ${a.finalizadoPor}` : ""}${a.finalizadoEm ? ` em ${dataHora(a.finalizadoEm)}` : ""}`}>
                    <Check className={`size-4 ${ativa ? "text-green-400" : "text-green-700"}`} aria-label="Finalizado" />
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
      {/* A situação do relatório à direita da barra (27/10/2026; antes, ao lado do mês). */}
      <EtiquetasDaBarra>
        <EtiquetaSituacao situacao={relatorio.situacao} />
      </EtiquetasDaBarra>
    </nav>
  );
}
