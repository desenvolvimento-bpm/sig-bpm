import { ProtectedLayout } from "@/components/layout/ProtectedLayout";
import { PermissionGuard } from "@/components/shared/PermissionGuard";
import { SemLeitura } from "@/components/shared/SemLeitura";

import { ListaCadastroContent } from "../components/ListaCadastroContent";

export default function UnidadesPage() {
  return (
    <ProtectedLayout>
      <PermissionGuard permission="cadastro_contabil.unidades:ler" fallback={<SemLeitura />}>
        <ListaCadastroContent
          entidade="unidades"
          rota="/cadastros/unidades"
          titulo="Unidades de Negócio"
          apenasAtivas
          comoUsar={
            <ul>
              <li>Use os filtros nos rótulos das colunas.</li>
              <li>
                Use “Novo” para incluir uma unidade: ela recebe o próximo código (sem a Ordem, vai para o fim da lista), e o nome não pode repetir o de
                outra. A apuração, os Resultados e os cenários calculam só as cinco unidades com regra própria (Matriz, Filial, Serviços, Despesas e
                Extra e RN): a unidade nova fica fora da DRE até ganhar a regra dela, e a mensagem depois de gravar lembra isso. Nos cenários analíticos,
                ela entra pelo Trazer Novos dos Cadastros Gerais.
              </li>
              <li>O lápis edita o nome, a ordem e a situação. A exclusão não existe: desmarque “Ativa” para tirar uma unidade de uso.</li>
              <li>Marque “Apenas Ativas”, ao lado dos botões, para esconder os registros inativos.</li>
              <li>Com movimentos (lançamentos, valores apurados, registros das listas), o Nome e a exclusão ficam bloqueados: essas informações ligam o cadastro a outras telas. O motivo aparece na edição; os demais campos continuam editáveis.</li>
              <li>Mudar este cadastro com uma competência apurada e ainda não fechada pede reapurar (vale para todos os Cadastros Gerais): até lá, ela não fecha, e a tela Resultados do mês mostra o aviso. Ao gravar, a mensagem diz quais competências reapurar.</li>
            </ul>
          }
          descricao="As unidades de negócio da DRE. O código é dado na inclusão (o próximo) e não muda; o nome, a ordem e a situação são editáveis. O nome identifica a unidade na carga da Estrutura da DRE: ao renomear uma unidade, a carga deixa de reconhecê-la."
        />
      </PermissionGuard>
    </ProtectedLayout>
  );
}
