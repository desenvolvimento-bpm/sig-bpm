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
              <li>
                O nome muda a qualquer momento, também com movimentos: as telas, os relatórios, as exportações e as APIs do Fechamento Mensal e dos
                Resultados mostram o nome novo. A apuração, a carga da Estrutura da DRE e as outras regras acham a unidade pelo Código, que não muda. Os
                cenários ficam com os nomes deles.
              </li>
              <li>Mudar a ordem ou a situação com uma competência apurada e ainda não fechada pede reapurar (vale para todos os Cadastros Gerais; trocar o nome, não): até lá, ela não fecha, e a tela Resultados do mês mostra o aviso. Ao gravar, a mensagem diz quais competências reapurar.</li>
            </ul>
          }
          descricao="As unidades de negócio da DRE. O código é dado na inclusão (o próximo) e não muda: é por ele que a apuração, a carga da Estrutura da DRE e as outras telas acham a unidade. O nome, a ordem e a situação são editáveis a qualquer momento."
        />
      </PermissionGuard>
    </ProtectedLayout>
  );
}
