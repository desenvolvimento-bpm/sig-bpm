"use client";

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { TabelaResultados } from "@/app/relatorios/resultados/ResultadosContent";
import { formato, mensagemDeErro, type LinhaResultado } from "@/app/relatorios/services/relatoriosService";
import { Abas } from "@/components/shared/Abas";
import { CabecalhoDaTela } from "@/components/shared/CabecalhoDaTela";
import { type ColunaExportavel, ExportarTabela } from "@/components/shared/ExportarTabela";
import { useAbaLembrada } from "@/hooks/useAbaLembrada";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";

import { MemoriaDoRateio, temMemoria } from "../components/MemoriaDoRateio";
import { AVISO, Carregando, Erro, MENSAGEM, SeletorVenda } from "../components/SeletorVenda";
import { realizadoObraService, rotuloDaVersao, type AbaDaObra, type ResultadosDaObra } from "../services/realizadoObraService";

/** O nome da aba de uma linha: o da linha (com a unidade entre parênteses só quando duas abas têm o mesmo nome). */
export const nomeDaAba = (a: AbaDaObra, abas: AbaDaObra[]) => (a.nomeUnidade && abas.some((b) => b !== a && b.nome === a.nome) ? `${a.nome} (${a.nomeUnidade})` : a.nome);

const reais = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);

/**
 * A nota no alto do extrato de um item (03/11/2026): a composição do valor da célula, porque o extrato traz os lançamentos
 * dos centros da obra (a aba Obras dos Resultados Empresariais), e não o rateio, os créditos nem a parte de uma linha.
 */
function notaDaConsulta(aba: AbaDaObra, l: LinhaResultado, i: number, mes: string): ReactNode {
  const valor = l.meses[i]?.valor ?? 0;
  const consolidado = aba.chave === "consolidado";
  if (l.codigo.startsWith("ROB.") || l.codigo.startsWith("IRB.")) {
    return consolidado ? (
      <>
        No Realizado, {mes}: <strong>{reais(valor)}</strong>, os lançamentos dos centros da obra e a receita prévia de frete e complementar dela, como na aba
        Obras de Resultados Empresariais › Resultados.
      </>
    ) : (
      <>
        Na linha {aba.nome}, {mes}: <strong>{reais(valor)}</strong>, a parte da linha pela Receita Prévia da obra. Abaixo, os lançamentos da obra inteira.
      </>
    );
  }
  const c = aba.composicao[l.codigo]?.[i];
  if (!c) return null;
  // As parcelas do valor (as zeradas ficam de fora, menos os lançamentos da obra, que o extrato mostra).
  const parcelas = [
    `${reais(c.direto)} dos lançamentos dos centros da obra${consolidado ? "" : " que foram à linha"}`,
    ...(Math.abs(c.rateio) >= 0.5 ? [`${reais(c.rateio)} do rateio da linha (os custos que não vieram dos centros de obra, pelas bases da etapa Linhas)`] : []),
    ...(Math.abs(c.creditos) >= 0.5 ? [`${reais(c.creditos)} dos Créditos de Impostos`] : []),
  ];
  return (
    <>
      {consolidado ? "No Realizado" : `Na linha ${aba.nome}`}, {mes}: <strong>{reais(valor)}</strong> = {parcelas.join(" + ")}. Abaixo, os lançamentos dos
      centros da obra{consolidado ? "" : ", de todas as linhas"}.
    </>
  );
}

/** Os avisos dos Resultados: os meses sem as obras gravadas, os do cálculo e os da tela (`outros`). */
export function AvisosDaObra({ dados, outros = [] }: { dados: ResultadosDaObra; outros?: string[] }) {
  const avisos = [
    ...(dados.semObras.length
      ? [`Competências fechadas sem as obras gravadas: ${dados.semObras.join(", ")}. Grave-as na etapa Linhas de cada mês (Fechamento Mensal › Linhas › Gravar).`]
      : []),
    ...dados.avisos,
    ...outros,
  ];
  return avisos.length ? (
    <div className={`${AVISO} space-y-1`}>
      {avisos.map((a) => (
        <p key={a}>{a}</p>
      ))}
    </div>
  ) : null;
}

const texto = (l: LinhaResultado, v: number | null | undefined) => (l.tipo === "SECAO" || v === null || v === undefined ? "" : l.volume ? formato.valor(v) : formato.inteiro(v));

/** As colunas do Exportar: a descrição, os meses, o realizado, o vendido e a diferença. */
function colunasDa(aba: AbaDaObra, versao: number, comVendido: boolean): ColunaExportavel<LinhaResultado>[] {
  return [
    { chave: "descricao", rotulo: "Descrição", valor: (l) => l.descricao },
    ...aba.dados.meses.map((m, i): ColunaExportavel<LinhaResultado> => ({ chave: `m${i}`, rotulo: m.rotulo, tipo: "numero", moeda: false, valor: (l) => l.meses[i]?.valor ?? undefined, texto: (l) => texto(l, l.meses[i]?.valor) })),
    { chave: "realizado", rotulo: "Realizado", tipo: "numero", moeda: false, valor: (l) => l.total.valor ?? undefined, texto: (l) => texto(l, l.total.valor) },
    ...(comVendido
      ? [
          { chave: "vendido", rotulo: `Vendido ${rotuloDaVersao(versao)}`, tipo: "numero", moeda: false, valor: (l) => l.orcado?.total.valor ?? undefined, texto: (l) => texto(l, l.orcado?.total.valor) },
          {
            chave: "diferenca",
            rotulo: "Diferença",
            tipo: "numero",
            moeda: false,
            valor: (l) => (l.total.valor === null || !l.orcado ? undefined : l.total.valor - (l.orcado.total.valor ?? 0)),
            texto: (l) => texto(l, l.total.valor === null || !l.orcado ? null : l.total.valor - (l.orcado.total.valor ?? 0)),
          },
        ] satisfies ColunaExportavel<LinhaResultado>[]
      : []),
  ];
}

/**
 * Os Resultados do Realizado por Obra (03/11/2026, pedido do Adão): a DRE da venda escolhida na lista Venda, da receita à
 * Margem de Contribuição, mês a mês nas competências fechadas, com o total realizado e o vendido da versão escolhida; o
 * Consolidado e uma aba por linha da obra.
 */
export function ResultadosDaObraContent() {
  useRegistrarAcessoTela("/realizado-por-obra/resultados");
  const consulta = useQuery({ queryKey: ["realizado-obra", "resultados"], queryFn: realizadoObraService.resultados });
  const dados = consulta.data;
  const [escolhida, setAba] = useAbaLembrada("aba", "consolidado");
  const aba = dados?.abas.find((a) => a.chave === escolhida) ?? dados?.abas[0];
  const comVendido = !!aba?.dados.comparado;
  return (
    <div className="space-y-6">
      <CabecalhoDaTela
        titulo="Resultados"
        acoes={<SeletorVenda />}
        exportar={
          dados?.obra && aba ? (
            <ExportarTabela
              titulo={`Realizado por Obra · ${dados.obra.codigo} · ${nomeDaAba(aba, dados.abas)}`}
              colunas={colunasDa(aba, dados.versao, comVendido)}
              linhas={aba.dados.linhas.filter((l) => l.tipo !== "SECAO")}
            />
          ) : null
        }
        comoExportar="Aqui, a tabela é a da aba aberta (o Consolidado ou a linha)."
        sobre={
          <>
            <p>
              A DRE da venda escolhida na lista Venda, da receita à Margem de Contribuição, mês a mês nas competências fechadas, com o total realizado e o
              vendido da versão escolhida. O Consolidado junta todas as linhas da obra; cada linha (Estrutura, Alveolares, Montagem…) tem a sua aba.
            </p>
            <p>
              A venda é a obra pelo código do CONTROLE DAS VENDAS. As obras que as listas trouxeram com outro código entram na obra do código: as numeradas
              da lista de Montagem, com o código no nome (como “16” e “G887305 | 3-SM…”), e as da lista de Acompanhamento só com o número do projeto (como
              “887305”).
            </p>
            <p>
              A receita bruta, os impostos e a receita líquida seguem a aba Obras de Resultados Empresariais › Resultados: a receita bruta é a dos
              lançamentos dos centros da obra (1.98 e 1.99), sem as contas de Reconhecimento do CPV, com a receita prévia de frete da obra levada do
              Pré-Fabricado ao Frete e a complementar levada da Montagem à Complementar; os impostos são os lançados nos centros da obra; a receita líquida é
              a receita bruta menos os impostos. Nas abas das linhas, cada receita vai às linhas pela Receita Prévia da obra na natureza dela (no mês; sem
              ela, no período), e os impostos pela de todas as naturezas; sem a Receita Prévia, ficam só no Consolidado. O % também é o da aba Obras: sobre a
              receita bruta nas receitas e nos impostos, sobre a receita líquida no resto.
            </p>
            <p>
              Os custos de cada mês são a soma do direto na obra — os lançamentos dos centros de custo dela e os volumes dela nas listas — com a parte dela no
              rateio de cada linha: os custos da linha que não vieram dos centros de obra, pelas bases da etapa Linhas (os custos de produção pelo m³
              produzido, os custos de montagem da linha Montagem pelo m³ montado, os custos complementares e os demais serviços pelos dias de
              acompanhamento e as despesas variáveis de venda pela receita bruta). As
              obras genéricas ficam fora da base do rateio. Os valores são os gravados pela etapa Linhas de cada mês e ficam congelados com o fechamento.
            </p>
            <p>
              Os lançamentos da obra são os do centro de custo que vale para cada um: o que uma contestação ou uma reclassificação por fornecedor levou a
              outro centro, e o redistribuído, saem da obra — nos custos diretos, na receita, nos impostos e no extrato.
            </p>
            <p>
              Nos custos de Matérias Primas, de Gastos Gerais Variáveis da Produção e de Frete e Descarga, o custo realizado é ajustado mês a mês pelos
              Créditos de Impostos (Fechamento Mensal › Resultados › Impostos), com os percentuais da conta na unidade do custo (Matriz ou Filial): na venda mercantil, sem
              o Estornado (custo × (1 − % Estornado)); na venda global, sem o Estornado e com o Creditado reaplicado (custo × (1 − % Estornado) ÷ (1 − %
              Creditado)). Os percentuais de cada mês estão na aba Impostos de Resultados Empresariais › Resultados; com um percentual de 100% ou mais, o custo
              fica sem o ajuste. A obra sem o tipo de venda no cadastro segue a regra da venda mercantil.
            </p>
            <p>
              A Mão de Obra e os Gastos Gerais, Diretos e Indiretos, aparecem agrupados, sem as contas, como na DRE das vendas.
            </p>
            <p>
              O vendido é a DRE da obra na aba DRE do CONTROLE DAS VENDAS importada na competência fechada mais recente, levada à Estrutura da DRE do SIG
              (as contas sem item, como Outros Gastos Gerais Variáveis, entram no subtotal delas). É provisório: vai sair do novo CRM do Comercial, pela tela
              Integrações e Consultas.
            </p>
          </>
        }
        comoUsar={
          <ul>
            <li>
              Em Venda, clique no botão, pesquise pelo código, pelo nome ou pela versão (VER00…) e escolha a venda. Cada venda aparece uma vez por versão
              vendida; embaixo, o tipo de venda e se ela tem o realizado e o vendido. A escolha fica gravada para o seu usuário.
            </li>
            <li>Troque entre o Consolidado e as linhas da obra nas abas.</li>
            <li>No menu de níveis (a seta antes do título da tabela), escolha Totais, Atribuições ou Contas; a seta de cada grupo abre e fecha só ele.</li>
            <li>
              O botão de seta ao lado do menu de níveis recolhe (seta para a esquerda) ou expande (seta para a direita) os meses. Recolhidos, a tabela mostra só
              o acumulado (o Realizado e o Vendido) e as variações, em todas as abas; a escolha fica guardada neste navegador.
            </li>
            <li>
              Clique no valor de um mês (ou na descrição, para o último mês) para consultar os movimentos, como em Resultados Empresariais: nas contas e nos
              impostos, o extrato dos lançamentos dos centros da obra, com o balancete de cada conta; nos volumes, as listas da venda. No alto do extrato, a
              composição do valor da célula: os lançamentos da obra, o rateio da linha e os Créditos de Impostos (o extrato traz só os lançamentos da obra,
              e, nas abas das linhas, os de todas as linhas).
            </li>
            <li>
              Na Mão de Obra e nos Gastos Gerais, Diretos e Indiretos, o valor de um mês abre a Memória de Cálculo: em cada linha da obra, o custo da
              linha sem os centros de obra (por exemplo, a Mão de Obra Direta da Estrutura), dividido pela base da linha nas obras vendidas (os m³
              produzidos; nos custos de montagem da linha Montagem, os m³ montados; nos custos complementares e nos demais serviços, os dias de
              acompanhamento) e multiplicado pela base da obra, mais os
              lançamentos dos centros da obra que foram à linha; embaixo, as contas de cada linha. Sem a base no mês, vale a do exercício até ele.
            </li>
            <li>
              Depois dos meses, o Realizado (a soma dos meses), o Vendido e as variações: a Diferença (o realizado menos o vendido), o Atingimento (o realizado
              sobre o vendido) e a Eficiência (o % realizado menos o % vendido, em pontos percentuais).
            </li>
          </ul>
        }
      />
      {consulta.isError ? (
        <Erro>{mensagemDeErro(consulta.error, "Erro ao carregar os resultados da obra.")}</Erro>
      ) : !dados ? (
        <Carregando />
      ) : !dados.obra ? (
        <p className={MENSAGEM}>Escolha a venda na lista Venda, no alto da tela.</p>
      ) : !aba ? (
        <>
          <AvisosDaObra dados={dados} />
          <p className={MENSAGEM}>A venda não tem valores gravados nas competências fechadas nem a DRE de venda.</p>
        </>
      ) : (
        <>
          <AvisosDaObra dados={dados} outros={aba.dados.meses.length ? [] : ["A venda não tem valores gravados nas competências fechadas: a tabela mostra só o vendido."]} />
          <Abas rotulo="Linhas da obra" ativa={aba.chave} onMudar={setAba} abas={dados.abas.map((a) => ({ chave: a.chave, rotulo: nomeDaAba(a, dados.abas) }))} />
          <TabelaResultados
            key={aba.chave}
            dados={aba.dados}
            titulo={nomeDaAba(aba, dados.abas)}
            visao={{ consolidado: true }}
            nomeVisao={`${dados.obra.codigo} · ${nomeDaAba(aba, dados.abas)}`}
            rotulosDoTotal={{ realizado: "REALIZADO", comparado: `VENDIDO ${rotuloDaVersao(dados.versao)}` }}
            recolheTodosOsMeses
            consultaDaVenda={{
              visao: (i) => (dados.centros[i] ? { obra: dados.centros[i]! } : null),
              nota: (l, i) => notaDaConsulta(aba, l, i, aba.dados.meses[i]?.rotulo ?? ""),
              obras: dados.obras,
              memoria: {
                abre: temMemoria,
                modal: (l, i, onFechar) => (
                  <MemoriaDoRateio mes={aba.dados.meses[i].mes} rotuloMes={aba.dados.meses[i].rotulo} aba={aba.chave} codigo={l.codigo} onFechar={onFechar} />
                ),
              },
            }}
          />
        </>
      )}
    </div>
  );
}
