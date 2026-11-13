"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Eye, Lock, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { useAbaLembrada } from "@/hooks/useAbaLembrada";
import { Abas } from "@/components/shared/Abas";
import { CabecalhoDaTela } from "@/components/shared/CabecalhoDaTela";
import { Button } from "@/components/ui/button";
import { useRegistrarAcessoTela } from "@/hooks/useRegistrarAcessoTela";

import { mensagemDeErro } from "@/app/relatorios/services/relatoriosService";
import { botaoPrimario, Erro } from "@/app/cenarios/components/CenarioDialog";

import { conectividadeService, copiarTexto, enderecoDaApi, type ApiDoCatalogo, type Catalogo } from "../services/conectividadeService";
import { Deslizante } from "./components/Deslizante";
import { PreviaDaApi } from "./components/PreviaDaApi";

function BotaoCopiar({ texto, rotulo }: { texto: string; rotulo: string }) {
  return (
    <button
      type="button"
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-gray-600 hover:bg-gray-200 hover:text-gray-900"
      title={`Copiar ${rotulo}`}
      aria-label={`Copiar ${rotulo}`}
      onClick={() => void copiarTexto(texto).then(() => toast.success("Copiado."))}
    >
      <Copy className="size-4" />
    </button>
  );
}

/** Um exemplo de código, com o botão de copiar. */
function Codigo({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="space-y-1">
      <p className="flex items-center justify-between text-xs font-semibold text-gray-700">
        {titulo}
        <BotaoCopiar texto={texto} rotulo={`o exemplo ${titulo}`} />
      </p>
      <pre className="overflow-x-auto rounded-sm border border-gray-200 bg-gray-50 p-3 font-mono text-xs leading-relaxed text-gray-800">{texto}</pre>
    </div>
  );
}

/** O destaque da situação: amarelo-ouro à esquerda, como os das outras telas. */
function Destaque({ ligada = false, children }: { ligada?: boolean; children: ReactNode }) {
  const Icone = ligada ? ShieldCheck : ShieldAlert;
  return (
    <div className="flex gap-3 rounded-sm border border-l-4 border-gray-200 border-l-bpm-primary bg-white px-4 py-3 text-sm text-gray-700">
      <Icone className="mt-0.5 size-5 shrink-0 text-gray-700" />
      <p>{children}</p>
    </div>
  );
}

/**
 * A situação da API (o modo que o TI ligou) e o endereço desta página: desligada (o padrão da produção, até o HTTPS do
 * TI), só por HTTPS ou também por HTTP (o desenvolvimento, ou a decisão do TI).
 */
function Situacao({ c }: { c: Catalogo }) {
  const http = typeof window !== "undefined" && window.location.protocol === "http:";
  const token = `O token vale ${Math.round(c.duracaoDoToken / 60)} minutos.`;
  if (c.modo === "desligada") {
    return (
      <Destaque>
        <strong>As APIs estão desligadas neste endereço.</strong> O TI da BPM as liga depois de pôr o SIG atrás do endereço com HTTPS (regra de segurança do
        TI: o login e o token não podem passar pela rede sem criptografia). Até lá, os aplicativos recebem a recusa “API desligada”, sem a senha ser conferida.
        O catálogo, a pré-visualização e os bloqueios já funcionam aqui.
      </Destaque>
    );
  }
  if (c.modo === "https" && http) {
    return (
      <Destaque>
        <strong>As APIs só funcionam por HTTPS</strong> (regra de segurança do TI da BPM). Este endereço do SIG é HTTP: nos aplicativos, use o endereço do SIG
        com HTTPS, que o TI informa. {token}
      </Destaque>
    );
  }
  if (c.modo === "http") {
    return (
      <Destaque>
        <strong>As APIs aceitam HTTP neste ambiente</strong> (o desenvolvimento ou a decisão do TI): <span className="font-mono">{enderecoDaApi()}</span>. {token} Sem
        o HTTPS, a senha e o token passam pela rede sem criptografia, e o endereço de quem chama é o que o aplicativo informa: o bloqueio por endereço não é
        garantido (o por usuário, sim).
      </Destaque>
    );
  }
  return (
    <Destaque ligada>
      As APIs estão ligadas neste endereço, por HTTPS: <span className="font-mono">{enderecoDaApi()}</span>. {token}
    </Destaque>
  );
}

function ComoConectar() {
  const base = enderecoDaApi();
  const curl = `# 1. O token (uma hora), com o login e a senha do SIG
curl -X POST ${base}/token -H "Content-Type: application/json" \\
  -d '{"email": "seu.email@bpm.com.br", "senha": "sua senha do SIG"}'

# 2. Os dados, com o token no cabeçalho Authorization
curl "${base}/apis/resultados-dre?ano=2026&mes=9&visao=0" \\
  -H "Authorization: Bearer <o token>"`;
  const powerQuery = `let
    Base = "${base}",
    Token = Json.Document(Web.Contents(Base & "/token", [
        Headers = [#"Content-Type" = "application/json"],
        Content = Json.FromValue([email = "seu.email@bpm.com.br", senha = "sua senha do SIG"])
    ]))[data][token],
    Resposta = Json.Document(Web.Contents(Base & "/apis/resultados-dre", [
        Query = [ano = "2026", mes = "9", visao = "0"],
        Headers = [Authorization = "Bearer " & Token]
    ])),
    Tabela = Table.FromRecords(Resposta[data][linhas])
in
    Tabela`;
  return (
    <section className="space-y-3 rounded-sm border border-gray-200 bg-white p-5">
      <h2 className="text-base font-bold text-gray-900">Como Conectar</h2>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-700">
        <li>
          O aplicativo pede o token: <span className="font-mono text-xs">POST {base}/token</span>, com o e-mail e a senha do SIG. O token vale uma hora; depois,
          outro pedido.
        </li>
        <li>
          Em cada pedido, o token vai no cabeçalho <span className="font-mono text-xs">Authorization: Bearer</span> e o código da API no endereço:{" "}
          <span className="font-mono text-xs">GET {base}/apis/&#123;código&#125;?parâmetros</span>. A lista das APIs do seu login:{" "}
          <span className="font-mono text-xs">GET {base}/apis</span>.
        </li>
        <li>
          <span className="font-mono text-xs">formato=dados</span> (o padrão) traz a tabela — <span className="font-mono text-xs">colunas</span> e{" "}
          <span className="font-mono text-xs">linhas</span>, os valores para usar; <span className="font-mono text-xs">formato=visual</span> traz os cards e as tabelas em SVG,
          como nas telas.
        </li>
        <li>Cada login lê só o que lê no SIG (as mesmas permissões e os mesmos recortes). Não compartilhe a sua senha: cada aplicativo deve usar o login de quem responde por ele.</li>
      </ol>
      <div className="space-y-3">
        <Codigo titulo="curl" texto={curl} />
        <Codigo titulo="Power Query (Excel e Power BI)" texto={powerQuery} />
      </div>
    </section>
  );
}

function CartaoDaApi({ a, podeEditar, onPrevia }: { a: ApiDoCatalogo; podeEditar: boolean; onPrevia: () => void }) {
  const queryClient = useQueryClient();
  const bloquear = useMutation({
    mutationFn: (bloqueado: boolean) => conectividadeService.bloquear("API", a.codigo, bloqueado),
    onSuccess: (r) => {
      toast.success(`${a.nome}: ${r.bloqueado ? "bloqueada" : "liberada"}.`);
      void queryClient.invalidateQueries({ queryKey: ["conectividade"] });
    },
    onError: (e) => toast.error(mensagemDeErro(e, "Não foi possível mudar o bloqueio.")),
  });
  return (
    <article className={`flex flex-col gap-3 rounded-sm border bg-white p-4 ${a.bloqueio ? "border-red-300" : "border-gray-200"}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-gray-900">{a.nome}</h3>
          <p className="mt-1 flex items-center gap-1">
            <code className="rounded-sm bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-900">{a.codigo}</code>
            <BotaoCopiar texto={a.codigo} rotulo={`o código ${a.codigo}`} />
          </p>
        </div>
        {podeEditar ? (
          <Deslizante liberado={!a.bloqueio} rotulo={a.nome} desabilitado={bloquear.isPending} onMudar={(liberado) => bloquear.mutate(!liberado)} />
        ) : a.bloqueio ? (
          <span className="text-xs font-semibold text-red-700">Bloqueada</span>
        ) : null}
      </header>
      <p className="text-sm text-gray-700">{a.descricao}</p>
      <p className="text-xs text-gray-600">
        <strong className="font-semibold text-gray-800">Exige:</strong> {a.exige} · <strong className="font-semibold text-gray-800">Formatos:</strong>{" "}
        {a.formatos.map((f) => (f === "dados" ? "Dados" : "Visual")).join(" e ")}
      </p>
      {a.bloqueio ? (
        <p className="text-xs text-red-700">
          Bloqueada{a.bloqueio.bloqueadoPor ? ` por ${a.bloqueio.bloqueadoPor}` : ""} em {new Date(a.bloqueio.bloqueadoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}: os pedidos são
          recusados.
        </p>
      ) : null}
      {a.parametros.length ? (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-600">
              <th className="py-1 pr-2 font-semibold">Parâmetro</th>
              <th className="py-1 pr-2 font-semibold">Exemplo</th>
              <th className="py-1 font-semibold">O que é</th>
            </tr>
          </thead>
          <tbody>
            {a.parametros.map((p) => (
              <tr key={p.nome} className="border-b border-gray-100 align-top last:border-b-0">
                <td className="py-1 pr-2 font-mono whitespace-nowrap text-gray-900">
                  {p.nome}
                  {p.obrigatorio ? <span className="text-red-700" title="Obrigatório"> *</span> : null}
                </td>
                <td className="py-1 pr-2 font-mono whitespace-nowrap text-gray-700">{p.exemplo}</td>
                <td className="py-1 text-gray-700">{p.descricao}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        {a.alcanca ? (
          <span className="text-xs text-gray-500">O seu perfil lê estes dados.</span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-gray-600">
            <Lock className="size-3.5" />O seu perfil não lê estes dados no SIG.
          </span>
        )}
        <Button type="button" className={botaoPrimario} disabled={!a.alcanca} onClick={onPrevia}>
          <Eye className="size-4" />
          Pré-visualizar
        </Button>
      </div>
    </article>
  );
}

/** As abas da tela (24/10/2026): como conectar e as APIs de cada origem (os acessos ficam na tela Acessos, 13/11/2026). */
const ABAS = [
  { chave: "conectar", rotulo: "Como Conectar" },
  { chave: "resultados", rotulo: "Resultados Empresariais" },
  { chave: "cenarios", rotulo: "Cenários" },
] as const;
type ChaveDaAba = (typeof ABAS)[number]["chave"];
const ORIGEM_DA_ABA = { resultados: "Resultados Empresariais", cenarios: "Cenários" } as const;

/**
 * A tela APIs (24/10/2026, pedido do Adão; até 30/10/2026, o processo Biblioteca de APIs), na Central de Conectividade: o catálogo das APIs que abrem a outros
 * aplicativos os dados das DREs, dos cards e dos indicadores dos Resultados Empresariais e dos Cenários — com o código, os
 * parâmetros, os formatos (dados e visual) e a pré-visualização — e como conectar, com o controle deslizante de quem edita a
 * tela para bloquear uma API. Em abas, com os blocos um abaixo do outro (24/10/2026, pedido do Adão). Os acessos (quem e de
 * onde) ficam na tela Acessos (13/11/2026).
 */
export function BibliotecaDeApisContent() {
  useRegistrarAcessoTela("/central-de-conectividade/biblioteca-de-apis");
  const consulta = useQuery({ queryKey: ["conectividade", "catalogo"], queryFn: conectividadeService.catalogo });
  const [aba, setAba] = useAbaLembrada<ChaveDaAba>("aba", "conectar", ABAS.map((a) => a.chave));
  const [previa, setPrevia] = useState<ApiDoCatalogo | null>(null);
  const c = consulta.data;
  return (
    <div className="space-y-6">
      <CabecalhoDaTela
        titulo="APIs"
        sobre={
          <p>
            Na Central de Conectividade, da Controladoria, as APIs que abrem os dados do SIG a outros aplicativos (planilhas, o Power BI, sistemas da empresa): as DREs, os cards e os indicadores do Painel de
            Bordo dos Resultados Empresariais e dos Cenários, em tabela (os valores) ou em visual (os cards e as tabelas em SVG). O aplicativo entra com o código
            da API e o login e a senha do SIG, e lê só o que esse login lê no SIG. Segue as regras do TI da BPM para API: ligada só pelo TI, só por HTTPS, o
            token no cabeçalho, o limite de tentativas e o registro de cada pedido na Auditoria.
          </p>
        }
        comoUsar={
          <ul>
            <li>A tela tem três abas: Como Conectar, Resultados Empresariais e Cenários. Quem acessa as APIs, e de onde, fica na tela Acessos, logo abaixo desta no menu.</li>
            <li>
              Como Conectar: no alto, em destaque, a situação — na produção, as APIs ficam desligadas até o TI pôr o SIG atrás do endereço com HTTPS e ligá-las
              (regra do TI); até lá, os aplicativos recebem a recusa “API desligada”, sem a senha ser conferida; ligadas, funcionam só por HTTPS. Abaixo, os dois
              passos — o token, pedido com o e-mail e a senha do SIG (vale uma hora), e os dados, com o token no cabeçalho Authorization: Bearer e o código da API
              no endereço — e os exemplos em curl e, logo abaixo, no Power Query (Excel e Power BI), com o botão de copiar.
            </li>
            <li>
              Resultados Empresariais e Cenários: as APIs de cada origem, uma abaixo da outra — nos Resultados Empresariais, a DRE, os Cards e os Indicadores do
              Painel de Bordo; nos Cenários, a Lista de Cenários (o id que as outras pedem), a DRE, os Cards e os Indicadores de um cenário. Em cada uma: o nome,
              o código (copie com o botão), o que ela traz, a permissão que exige no perfil, os formatos (Dados: a tabela, com as colunas e as linhas; Visual: os
              cards e as tabelas em SVG, como nas telas) e os parâmetros (o asterisco marca os obrigatórios).
            </li>
            <li>
              Pré-visualizar abre o que um aplicativo receberia com o seu login: escolha os parâmetros e o formato e clique em Ver; o endereço do pedido, logo acima
              do resultado, se copia para o aplicativo. Nas APIs de um cenário, o cenário já vem escolhido (o marcado, como o Orçamento, ou o primeiro da lista);
              sem um parâmetro obrigatório, o Ver fica desabilitado. Sem a leitura dos dados no seu perfil, o botão Pré-visualizar fica desabilitado.
            </li>
            <li>
              Quem edita a tela (o perfil com Editar em APIs, na Central de Conectividade) bloqueia ou libera uma API no controle deslizante do cartão dela, nas abas
              das origens: o bloqueio vale na hora, para os pedidos e para o token, e fica na Auditoria. Os bloqueios de usuários e de endereços ficam na tela
              Acessos.
            </li>
            <li>
              Para um usuário usar as APIs, o perfil dele precisa da tela APIs (Ler, na Central de Conectividade) e da leitura das telas dos dados, na tela Perfis. Na Auditoria, os
              pedidos às APIs entram com “Incluir Acessos”, como os acessos às telas.
            </li>
          </ul>
        }
      />
      <Abas rotulo="Abas de APIs" ativa={aba} onMudar={(a) => setAba(a as ChaveDaAba)} abas={[...ABAS]} />
      {consulta.isError ? (
        <Erro erro={mensagemDeErro(consulta.error, "Erro ao carregar as APIs.")} />
      ) : !c ? (
        <div className="h-96 animate-pulse rounded-sm bg-gray-100" />
      ) : aba === "conectar" ? (
        <div className="space-y-4">
          <Situacao c={c} />
          <ComoConectar />
        </div>
      ) : (
        // As APIs da origem, uma abaixo da outra, na ordem do catálogo (a DRE, os Cards e os Indicadores).
        <div className="space-y-4">
          {c.apis
            .filter((a) => a.origem === ORIGEM_DA_ABA[aba])
            .map((a) => (
              <CartaoDaApi key={a.codigo} a={a} podeEditar={c.podeEditar} onPrevia={() => setPrevia(a)} />
            ))}
        </div>
      )}
      {previa ? <PreviaDaApi api={previa} onFechar={() => setPrevia(null)} /> : null}
    </div>
  );
}
