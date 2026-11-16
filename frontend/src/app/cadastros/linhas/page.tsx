import { ProtectedLayout } from "@/components/layout/ProtectedLayout";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { SemLeitura } from "@/components/shared/SemLeitura";

import { ListaCadastroContent } from "../components/ListaCadastroContent";
import { BotaoCorrespondencia } from "./CorrespondenciaDialog";

export default function LinhasPage() {
  return (
    <ProtectedLayout>
      <PermissionGuard permission="cadastro_controladoria.linhas:ler" fallback={<SemLeitura />}>
        <ListaCadastroContent
          entidade="linhas"
          rota="/cadastros/linhas"
          titulo="Linhas"
          apenasAtivas
          acoesExtras={<BotaoCorrespondencia />}
          comoUsar={
            <ul>
              <li>Use os filtros nos rótulos das colunas (por exemplo, a unidade).</li>
              <li>Use “Novo” para incluir uma linha, escolhendo a unidade; o lápis edita, e a exclusão fica dentro da edição.</li>
              <li>As linhas de produto ficam na Matriz ou na Filial, e as de obra em Serviços: uma linha não passa de produto para obra.</li>
              <li>A Und. de Medida diz em que se mede a linha (m³, m³ e pistas, kg, m, m², dia ou %); será usada nos Cenários Analíticos. Escolha na lista, no lápis.</li>
              <li>As outras telas e as importações acham a linha pelo nome (sem diferença de maiúsculas): o nome é o texto com que as listas importadas citam a linha.</li>
              <li>Marque “Apenas Ativas”, ao lado dos botões, para esconder os registros inativos.</li>
              <li>
                Uma linha inativa sai das listas de escolha e dos Cenários Analíticos, e os registros antigos ficam com ela. Se uma lista importada ainda a
                citar, o relatório da importação avisa quantos registros: corrija a linha na planilha e importe de novo.
              </li>
              <li>Com movimentos (lançamentos, valores apurados, registros das listas), o Nome e a Unidade e a exclusão ficam bloqueados: essas informações ligam o cadastro a outras telas. O motivo aparece na edição; os demais campos continuam editáveis.</li>
              <li>
                “Tarefas” abre a Correspondência Tarefa × Linha: a lista das tarefas das requisições e das notas fiscais e a linha dos custos de cada uma, numa filial
                ou em Qualquer Filial: inclua, troque a linha ou exclua e clique em “Gravar”. Vale na próxima carga do resultado realizado de um cenário
                analítico. Os rótulos da tabela ficam fixos ao rolar. Se uma linha desativada ainda tiver tarefas, um aviso vermelho as lista no topo (a linha aparece como Desativada): troque a linha delas ou exclua-as, porque os custos delas não vão para a linha.
              </li>
              <li>Mudar este cadastro com uma competência apurada e ainda não fechada pede reapurar (vale para todos os Cadastros Gerais): até lá, ela não fecha, e a tela Resultados do mês mostra o aviso. Ao gravar, a mensagem diz quais competências reapurar.</li>
            </ul>
          }
          descricao="As linhas de cada unidade: Estrutura na Matriz; Alveolares e Estacas na Filial; Montagem, Fundação, Capeamento, Metálica, Telhamento, Turn-Key, Vedação e Outros em Serviços. As Listas Operacionais gravam cada registro com a linha e a unidade, e as outras telas e as importações acham a linha pelo nome; as linhas de faturamento das medições não aparecem aqui. A Metalúrgica está inativa: ela presta serviço às outras linhas (apoio), e o centro dela vai às linhas pelos kg que cada uma consome (Alocação nas Linhas). A Correspondência Tarefa × Linha liga as tarefas das requisições e das notas fiscais às linhas: a referência realizada dos Cenários Analíticos divide os custos de cada conta entre as linhas na proporção dos documentos com a tarefa de cada uma (a correspondência da filial do documento vale antes da de Qualquer Filial), e o que não tem tarefa, ou tem uma tarefa fora da lista, vai pelo volume das linhas."
        />
      </PermissionGuard>
    </ProtectedLayout>
  );
}
