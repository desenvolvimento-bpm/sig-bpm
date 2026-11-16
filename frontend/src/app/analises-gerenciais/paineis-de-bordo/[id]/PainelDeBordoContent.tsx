"use client";

import { useParams } from "next/navigation";

import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";

import { DocumentoDosSlides, ItensDoComoUsar } from "@/app/analises-gerenciais/relatorios-executivos/[id]/RelatorioExecutivoContent";
import { PAINEIS_DE_BORDO, ProvedorDoProcesso } from "@/app/analises-gerenciais/relatorios-executivos/components/processo";

import { BarraDoPainel } from "../components/BarraDoPainel";
import { ConfiguracoesDoPainel } from "../components/ConfiguracoesDoPainel";

/**
 * Um painel de bordo (31/10/2026, pedido do Adão): a mesma tela dos Relatórios Executivos (o editor, a apresentação, o PDF
 * e os blocos), no processo dos painéis — a barra com o painel, as Configurações (com o nome, a visualização e a
 * competência) e uma tela só, Painel de Bordo, com as abas (as páginas); com a finalização (01/11/2026), como um grupo dos
 * relatórios; e a competência automática (03/11/2026), a última fechada, sempre.
 */
export function PainelDeBordoContent() {
  const { id } = useParams<{ id: string }>();
  useRegistrarAcessoTela("/analises-gerenciais/paineis-de-bordo");
  return (
    <ProvedorDoProcesso value={PAINEIS_DE_BORDO}>
      <DocumentoDosSlides
        id={id}
        barra={(painel, chave, onMudar) => <BarraDoPainel painel={painel} chave={chave} onMudar={onMudar} />}
        configuracoes={(painel, excluir) => <ConfiguracoesDoPainel painelId={painel.id} excluir={excluir} />}
        comoUsar={<ComoUsarDoPainel />}
        sobre={(painel) => (
          <p>
            O painel de bordo {painel.nome}, de {painel.automatica ? `${painel.rotuloMes} (a competência automática: a última fechada)` : painel.rotuloMes}: na tela Painel de Bordo, as abas (as páginas) com os cards do Painel de Bordo e dos
            Indicadores de Resultados Empresariais, as tabelas de Resultados, as anotações dos pontos positivos, negativos e de atenção, os textos, o
            sumário, as imagens, os vídeos e as imagens de fundo, que se apresentam em tela inteira e se exportam em PDF, como os Relatórios Executivos.
            Criado por {painel.criadoPor}.
          </p>
        )}
      />
    </ProvedorDoProcesso>
  );
}

/** O Como Usar do painel: a barra do topo e as Configurações dele e o que é comum aos Relatórios Executivos. */
function ComoUsarDoPainel() {
  return (
    <ul>
      <li>
        A barra do topo mostra o nome do painel e a competência (na automática, “Automática” e a última competência fechada; clique neles para ir a
        outro painel), as Configurações e a tela Painel de Bordo (com o
        check verde quando o painel está finalizado; a dica dele mostra quem o finalizou e quando) e, à direita, a situação (Em Elaboração ou
        Finalizado) e a visualização: Privado (só quem criou o painel, os editores convidados e os Administradores o veem) ou Público (todos os que leem Painéis e Apresentações o
        veem, depois de finalizado). Quem criou o painel, os editores convidados (Configurações / Geral / Compartilhar) e o Administrador o
        editam; os demais veem o público finalizado, o apresentam e o exportam, só para leitura.
      </li>
      <li>
        Configurações, antes do Painel de Bordo, é preliminar à apresentação: não tem páginas, não conta nos slides e não entra na tela inteira nem no PDF.
        Ela tem duas abas, com os grupos em destaques. Na aba Geral, que quem criou o painel, o Administrador e, com o painel em elaboração, os editores
        convidados mudam: em Painel, o Nome (o da barra
        do topo e o dos slides), a Competência (uma das fechadas: os cards e as tabelas trazem as competências fechadas até ela; vários painéis podem ser
        do mesmo mês) e a Visualização (Privado ou Público). Na Competência, “Automática” faz o painel mostrar sempre a última competência fechada:
        quando outra fechar, ela entra sozinha ao abrir ou recarregar o painel, e, se a última for reaberta, vale a anterior até ela fechar de novo.
        Atenção: as anotações e os textos livres não mudam com a competência — reveja-os quando ela mudar. Ainda no Geral, em Compartilhar, estão os usuários que editam o painel com quem o criou — “Convidar” abre a lista
        dos usuários com a permissão de editar Painéis e Apresentações (com a busca; marque os que quiser), e “Remover”, em cada um, tira o usuário dos
        editores, depois da confirmação (o editor que tira a si mesmo deixa de ver o painel em elaboração e volta à lista). Os convidados editam as
        abas, os Comparativos, o Finalizar e o Reabrir e, com o painel em elaboração, o Geral (também convidam e removem editores); eles veem o painel
        mesmo Privado ou em elaboração. Com o painel finalizado, o Geral fica com quem o criou e com o Administrador; a exclusão, sempre. No canto de baixo, à direita, do grupo Painel, “Excluir Painel” (de quem o criou ou do Administrador, com o painel em elaboração) exclui o
        painel, com as páginas, as imagens e os vídeos, depois da confirmação. Na aba Comparativos, que quem edita o painel muda: a Comparação Padrão é o orçado dos
        Cards Padrão (Painel de Bordo e Indicadores) e das Tabelas Padrão: de início, o cenário marcado como Orçamento (a etiqueta amarela; o painel
        acompanha a marcação até que se escolha um cenário); ou escolha um dos cenários da lista — os cenários com marcação, de qualquer exercício, com o
        ano, o tipo (Sintético ou Analítico) e a marcação em etiquetas — para o painel ficar com ele enquanto ele tiver a marcação (se a marcação passar
        para outro cenário, o painel volta ao marcado como Orçamento; num cenário de outro exercício, valem os mesmos meses dele). No painel com a
        competência automática, vale a marcação do cenário escolhido: se ela passar para outro cenário (por exemplo, o do exercício novo), os objetos
        padrão comparam com ele. A Comparação PROVA são os cenários dos Cards PROVA e das Tabelas PROVA: marque dois ou mais dos
        cenários marcados (Forecast, Orçado, Vendido e Anterior, cada um com o quadradinho da cor dele; de início, todos); com dois marcados, eles não se
        desmarcam antes de se marcar outro. Ela acompanha as marcações: se uma marcação passar para outro cenário, os objetos PROVA comparam com ele. As
        mudanças das duas abas se salvam na hora (“Salvo às…”), também no painel finalizado.
      </li>
      <ItensDoComoUsar />
      <li>
        “Finalizar” (de quem criou o painel, dos editores convidados ou do Administrador) salva o que falta e finaliza o painel, com todas as abas, só para leitura: a tela Painel
        de Bordo ganha o check verde na barra do topo, e a etiqueta passa a Finalizado. O painel Público só aparece para os demais depois de
        finalizado; o Privado continua só para quem o criou, os editores convidados e os Administradores. “Reabrir” o devolve à elaboração (e o Público some de novo para
        os demais); finalizado, ele não se exclui.
      </li>
    </ul>
  );
}
