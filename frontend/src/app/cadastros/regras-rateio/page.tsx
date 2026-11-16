import { ProtectedLayout } from "@/components/layout/ProtectedLayout";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { SemLeitura } from "@/components/shared/SemLeitura";

import { RegrasRateioContent } from "./RegrasRateioContent";

export default function RegrasRateioPage() {
  return (
    <ProtectedLayout>
      <PermissionGuard permission="cadastro_controladoria.regras_rateio:ler" fallback={<SemLeitura />}>
        <RegrasRateioContent
          comoUsar={
            <ul>
              <li>Use os filtros nos rótulos das colunas.</li>
              <li>
                Use “Novo Rateio” para incluir: o Rótulo e, ao lado, o Tipo. Paramétrico: a Chave, o Destino e a vigência (uma regra por volume). Fixo: a
                Chave, a vigência e o percentual de cada um dos quatro destinos, somando 100% (o Rótulo, opcional, é a base do rótulo de cada destino:
                “Produção: Matriz (Fixo)”). Rateios com a mesma chave não podem ter vigências sobrepostas. O lápis edita, e a exclusão fica dentro da edição.
              </li>
              <li>A chave não muda depois de criada a regra: para trocá-la, exclua e crie outra.</li>
              <li>O Destino é um dos totais destacados nas Listas Operacionais, que dá o volume da regra; a lista mostra só os da Chave escolhida (Metalurgia: Matriz, Filial, Montagem e Complementar, na chave METALURGIA…).</li>
              <li>A unidade que recebe e a base física saem do Destino: Projetos Liberados: Matriz vai para a Matriz; Metalurgia: Complementar, para a Complementar (unidade Serviços); as pistas, para a Filial.</li>
              <li>Marque “Apenas Ativas”, ao lado dos botões, para ver só as regras vigentes (sem vigência encerrada).</li>
              <li>Com movimentos (as apurações de rateio), o Destino e a exclusão ficam bloqueados: essas informações ligam o cadastro a outras telas. O motivo aparece na edição; os demais campos continuam editáveis.</li>
              <li>
                Vigências: cada regra vale do mês do início (se começa no dia 1º; senão, do mês seguinte) até o mês do fim. Para mudar uma chave a
                partir de um mês, preencha o Fim das regras atuais e crie as novas com o Início no mês seguinte. A tela recusa duas regras da mesma
                chave e do mesmo destino valendo no mesmo mês, e a mistura de regras por volume e de percentual fixo na mesma chave e período.
              </li>
              <li>
                Nos rateios fixos, os destinos são sempre os quatro — Matriz, Filial,
                Montagem e Complementar —, em qualquer chave: um rateio pode passar a valer em outra unidade (a Produção em Serviços, por exemplo); o
                destino que não deve receber fica com 0%. As regras fixas aparecem na lista com o % Fixo; o lápis delas abre os Percentuais Fixos já na
                chave e no conjunto da regra, onde se editam o Rótulo, a vigência e os percentuais, e se excluem (o conjunto já usado em apurações não se
                exclui: encerre a vigência).
              </li>
              <li>
                Os percentuais por linha (nos rateios fixos): cada destino com percentual abre, logo abaixo dele, as linhas ativas da unidade dele — a
                Matriz, a Filial ou, na Montagem e na Complementar, Serviços —, cada uma com a parte do destino que vai a ela, somando 100% no destino (a
                linha única já vem com 100%). É como a parte de rateio da chave chega às linhas na etapa Linhas da apuração, no lugar da regra da Alocação
                nas Linhas. Uma linha inativa só aparece se ainda tem percentual: passe-o a outra antes de gravar.
              </li>
              <li>O quadro vermelho acima da tabela avisa as chaves com meses sem regra (até dezembro do ano que vem): nesses meses, os lançamentos de rateio da chave não vão para nenhuma unidade. Sem regra no mês, a competência não se abre nem se fecha (Fechamento Mensal), e um cenário analítico do exercício não se abre nem se fecha. Avisa também os conjuntos fixos em vigor ainda sem os percentuais por linha: até serem editados, essa parte vai às linhas pela Alocação nas Linhas.</li>
              <li>Com um cenário analítico em aberto, editar uma regra pede o “Recalcular” na tela Resultados do cenário: os rateios dele seguem as regras de cada mês.</li>
              <li>Mudar este cadastro com uma competência apurada e ainda não fechada pede reapurar (vale para todos os Cadastros Gerais): até lá, ela não fecha, e a tela Resultados do mês mostra o aviso. Ao gravar, a mensagem diz quais competências reapurar.</li>
            </ul>
          }
          descricao="As chaves de rateio: por volume — o volume do destino sobre o da chave, nas listas do mês — ou por percentuais fixos digitados, que somam 100% na chave (com os percentuais por linha de cada destino, que levam a parte do rateio às linhas). A chave e o destino são fixos depois de criada a regra; as vigências dizem de que mês a que mês cada regra vale. O volume continua apurado também nas regras fixas (os indicadores de volume leem dele)."
        />
      </PermissionGuard>
    </ProtectedLayout>
  );
}
