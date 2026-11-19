import { getPrismaClient } from "../../config/prisma.js";

/**
 * Os indicadores pelo ID (19/11/2026, pedido do Adão: os nomes dos indicadores se editam, e o código os conhece pelo ID).
 *
 * O cadastro Estrutura dos Indicadores liga os dados pelo nome — os valores importados e digitados, as metas, os cenários,
 * as fórmulas e os blocos dos relatórios —, e a troca do nome os atualiza todos de uma vez (renomearIndicador.ts). O código
 * não guarda nomes: cita o indicador pelo ID (IND) e lê o nome atual aqui. A tabela tem o nome de cada indicador em
 * 19/11/2026 (o nome original), que as regras por nome do código usam (a meta acumulada, por exemplo, pelo começo do nome),
 * e os IDs são os da produção (os mesmos do desenvolvimento e do teste).
 *
 * Os nomes atuais se leem do banco ao iniciar o servidor e depois de cada troca (carregarNomesDoSistema). Numa base com
 * outros IDs (uma instalação nova), o indicador que não se acha pelo ID fica com o nome original, como antes.
 */
export const NOMES_ORIGINAIS: Readonly<Record<string, string>> = {
  // Produção
  "2c009bd7-94cb-4cae-8539-cd6a70cf549a": "Custos de Produção: Matriz (CPP)",
  "9aaf3c97-9e43-4e49-8e4e-9f5fe8061aa6": "Custos de Produção: Filial (CPP)",
  "64ee005f-097f-4c89-8bf2-55f6ec5b8148": "Custos de Produção: Total (CPP)",
  "5f1c6a20-537d-44f0-a39a-c72a76290dc7": "Produção (Vol.): Matriz",
  "c1c77ad7-a23a-4c92-8a74-5d918c2b4e9c": "Produção (Vol.): Filial",
  "6752e1dd-5af4-44b2-b93f-5a7905a086de": "Produção (Vol.): Total",
  "c851c72c-c280-49a4-8762-c710c9047b1b": "Produção (Pistas): Filial",
  "f4953c02-3b30-4328-9450-c9e1f178cab0": "Mão de Obra: Matriz",
  "fdc19d6d-f16a-4d90-abd4-2d6c695de6e6": "Mão de Obra: Filial",
  "192b14f8-e57f-4295-909e-0a0b466d7775": "Mão de Obra: Total",
  "e74427c6-4554-4913-9c1d-1930159cb462": "Matérias Primas: Matriz",
  "0bcdc380-ab0d-4ebe-99d4-c2fc370cd3cb": "Matérias Primas: Filial",
  "158090a1-5df2-4ad8-979f-f6b0a824bd3d": "Matérias Primas: Total",
  "4fd5f638-9054-412e-8837-b08e6f8b9032": "Gastos Gerais: Matriz",
  "762fa2b0-e675-483c-948e-ac260e646afc": "Gastos Gerais: Filial",
  "77d1bd7f-9428-4030-9881-90b4bbcacba9": "Gastos Gerais: Total",
  "6bf97f89-c56c-4a7c-be04-089a64b6e4dd": "Quadro de Lotação: MO Direta Matriz",
  "20c73a9d-9d0d-4905-a3a0-8601e54ee8fa": "Quadro de Lotação: MO Direta Filial",
  "291f313d-afbe-4163-ab62-490345cd9279": "Quadro de Lotação: MO Direta Total",
  "0e5dbe88-1b58-4822-93b2-7b9b4f76d926": "Quadro de Lotação: MO Indireta Matriz",
  "f2654e05-b279-40a5-b28e-993f94141baa": "Quadro de Lotação: MO Indireta Filial",
  "4c294aa9-0933-4e18-b56a-1852ae80a9ef": "Quadro de Lotação: MO Indireta Total",
  "a296ca17-1621-4579-97e0-953baf9ccf67": "Quadro de Lotação: MO Geral Matriz",
  "7a0dcc15-8401-4c4e-9786-cc5d0e3544a3": "Quadro de Lotação: MO Geral Filial",
  "fb948998-8425-455c-ad27-bd7bad269d41": "Quadro de Lotação: MO Geral Total",
  "d937a551-cbe6-4c89-8a7a-f537bb1ea369": "Eficiência da Produção: MO Direta Matriz",
  "bf5bf115-e063-4003-9a76-8c5946d36acf": "Eficiência da Produção: MO Direta Filial",
  "fd7b595a-3b39-44a8-bf60-7a23ea4b58b9": "Eficiência da Produção: MO Direta Total",
  "3ae9468a-190a-4e37-8d46-44839d221e78": "Eficiência da Produção: MO Indireta Matriz",
  "5a4f025d-5b5e-4de4-a8fb-9b1e7664936e": "Eficiência da Produção: MO Indireta Filial",
  "d7e2a2f0-1f7f-417b-adea-42f35182f241": "Eficiência da Produção: MO Indireta Total",
  "6f79231a-ef5e-43de-b766-975e3727c8f5": "Eficiência da Produção: MO Geral Matriz",
  "a2e6f643-d90d-4487-bbb9-8035b62d25f0": "Eficiência da Produção: MO Geral Filial",
  "2ce63d58-897d-40ed-9dc9-f60eca543856": "Eficiência da Produção: MO Geral Total",
  // Serviços
  "80dd2aa9-dce8-46e3-bf1f-c550f8e78896": "Custos de Serviços: Montagem (CSM)",
  "ab898a87-384f-4d6d-b288-5d59a0e40baf": "Rendimento: Montagem",
  "2bf97756-d6e7-4cea-90f9-7cd46bfeeeb3": "Mão de Obra Direta: Montagem",
  "40a8ca9c-fd67-437b-b869-155b50b36f97": "Custos e Manutenção: Guindastes",
  "e4bfa902-c64c-453a-936a-8fed6b51a913": "Quadro de Lotação: MO Direta Montagem",
  "b5371d75-a6fa-4944-9c30-ee44c104da85": "Quadro de Lotação: MO Indireta Montagem",
  "aeee1010-c519-45de-879b-e0a279e90250": "Quadro de Lotação: MO Geral Montagem",
  "59906962-f554-4635-bc06-ecf8ec12589d": "Eficiência da Montagem: MO Direta",
  "8514cca8-712a-4804-ac57-932bfead9d98": "Eficiência da Montagem: MO Indireta",
  "44bd4398-286f-41b0-93ed-899b8e182fcb": "Eficiência da Montagem: MO Geral",
  // Logística
  "fe5c4257-e14c-4862-8e46-2fa84fe91859": "Custos de Frete: Matriz (DVV)",
  "5b5bab69-8ab3-4804-b201-87384dde17a8": "Custos de Frete: Filial (DVV)",
  "338150ba-b772-42d0-bbe2-8ca334e71003": "Custos de Frete: Total (DVV)",
  "cfaa8de1-88d0-42a1-8ad1-786ab8cb5d06": "Despesas de Logística (DL)",
  "8f73ae1b-efa9-4950-becd-7cee94179b0d": "Expedição (Vol.): Matriz",
  "9532dc01-d66d-46bd-aebe-286dfadd5803": "Expedição (Vol.): Filial",
  "2ffdad23-227f-4011-85f2-11c3f19169a0": "Expedição (Vol.): Total",
  // Técnico
  "03d3c66b-4c15-492e-80ae-5c323bef95b4": "Despesas Técnicas (DT)",
  "f1af14a7-bf94-4bc1-8d8f-7b27abc91153": "Liberação de Projetos: Matriz",
  "89497a05-3b8c-42fd-8406-fff694f699a9": "Liberação de Projetos: Filial",
  "76763048-be22-4765-a354-c60018bec159": "Liberação de Projetos: Total",
  // Comercial
  "0373eec0-5bb3-4163-882f-7d66965ce2c9": "Comissões de Representantes e 3os (DVV)",
  "f191e406-cd32-4100-bc90-cf5364d33df3": "Despesas Comerciais (DC)",
  "903cf420-e7f2-4f92-aef5-1c0b92d02983": "Venda: Global",
  "b1e551b5-7bb9-4e07-a4e1-8c96ee451719": "Venda: Mercantil",
  "377ac419-c535-4bd0-9057-ab939dba584a": "Venda: Total",
  "af8f98a9-698c-4a44-a0be-4025a1822709": "Receita Líquida Vendida: Global",
  "77d4431f-da9d-4869-b79d-1340a90920fc": "Receita Líquida Vendida: Mercantil",
  "7a96ecf4-6e5e-452c-94d1-c1deaa4d5b17": "Receita Líquida Vendida: Total",
  "8604f555-e4e3-472b-93a4-fc0ba33ecaa2": "Margem de Contribuição: Global",
  "d75aa85e-ece7-4ae0-9118-8ba41a0bd0d2": "Margem de Contribuição: Mercantil",
  "d666f93f-7f05-4154-b460-2f0b4c95a44c": "Margem de Contribuição: Total",
  "f11c18a2-42c4-4d36-9136-e3d141d32e5b": "Demanda (Vol.): Matriz",
  "2b8f3bb2-1a26-434e-a9cd-fb63a6a67c0f": "Demanda (Vol.): Filial",
  "7e88050f-d2ff-49ae-9229-9c4e1c270b81": "Demanda (Vol.): Total (Fabricação)",
  "98acd7be-2500-466d-be5c-5cce17caed10": "Demanda (Vol.): Montagem",
  "3cf3a00c-2738-40ca-9520-ee8f717fd1a2": "Demanda (Pistas.): Filial",
  // Administrativo
  "e5705701-5ef7-4976-bcec-806c8b3dd86d": "Despesas Administrativas (DA)",
  "7a57a72b-9847-4ce6-821a-623c14282646": "Fluxo de Caixa Operacional Líquido",
  "996f3e0d-da9d-4733-bf5c-bdf2b613a187": "Inadimplência",
  "4b26c813-f5dd-446c-aa52-d3a71b722d6a": "Quadro de Lotação Total",
  "c9a1ede7-f01f-4fe7-af4a-ddd314062015": "Turnover",
  "88634a45-9f68-4c28-83fa-265c861a8735": "Abertura de Vagas x Contratações",
  "c25df8d2-4385-45ee-9e52-340d0be4b267": "Acidentes c/ Afastamento",
  // Geral
  "c66af1bd-7d18-428c-a669-b59c81a0d54c": "Receita Líquida: Produção Matriz",
  "750a8ac9-01da-4137-bf6b-0fd4d044ddfd": "Receita Líquida: Produção Filial",
  "2ed2696d-49ec-4ad4-9141-99f2c6cfc596": "Receita Líquida: Frete Matriz",
  "f1d48c52-f178-4ee0-b743-78e3939baaac": "Receita Líquida: Frete Filial",
  "7fa5fc9c-43c0-4f33-a354-86b400150d79": "Receita Líquida: Devoluções e Inventários",
  "3bd9bb64-0aaf-4190-9712-10c9af1c3089": "Receita Líquida: Montagem",
  "ed541196-2f9d-4493-a8ad-fdc9f2e34e96": "Receita Líquida: Complementares",
  "3f85931c-a203-497b-b143-899a84faad1d": "Receita Líquida: Produção",
  "044cea2c-2ec5-4acc-8798-24e4d3882c7d": "Receita Líquida: Serviços",
  "224b4ed4-0493-4fb0-8207-8cc88811872a": "Receita Líquida: Total",
  "271bf1dd-1a07-4fe6-9386-391100215fe5": "Custo do Produto Vendido (CPV): Matriz",
  "161e0161-fdec-4caa-8e29-a834dfe01aa0": "Custo do Produto Vendido (CPV): Filial",
  "c7c1bb6e-9096-407f-a75f-43f5db41beeb": "Custo do Produto Vendido (CPV): Serviços",
  "0648ff7c-6886-4b35-a4ee-7df00529eaf5": "Custo do Produto Vendido (CPV): Total",
  "8b1c0630-4062-4527-818e-abecb5b3aab6": "Margem Bruta (MB): Matriz",
  "e7b3ec2b-33c0-46e8-bc42-6dff5e495520": "Margem Bruta (MB): Filial",
  "bb3cdae4-857a-4120-b504-cef23b2883e5": "Margem Bruta (MB): Serviços",
  "9f905d97-ff58-4635-a6c6-e81653cf2a5c": "Margem Bruta (MB): Total",
  "47028dd4-4f68-4b5d-9a7e-f8ac4fa1b843": "Margem de Contribuição (MC): Total",
  "9fb849b4-b0f8-420d-99c1-65a6899329e4": "Lucro Operacional (EBITDA)",
  "2548fbcf-53dd-4bf0-94b6-250fb6091f37": "Resultado Financeiro (RF)",
  "36867eb8-b233-46ca-97d6-899891177d27": "Resultado Líquido (RL)",
  "df0ef8ba-7437-4550-ab64-dc70972dacd5": "Eficiência da Operação: MO Direta Matriz",
  "5f87f185-3213-4026-9913-adc326fecf2f": "Eficiência da Operação: MO Direta Filial",
  "ff2f3d69-9dcc-4b24-8788-19f6805626f9": "Eficiência da Operação: MO Direta Total",
  "f7baf57e-cbd3-4f74-b5a1-e96705a0528a": "Eficiência da Operação: MO Indireta Matriz",
  "c34c11c1-68ef-4f58-8bc9-46a243a67aaf": "Eficiência da Operação: MO Indireta Filial",
  "78259c21-81c6-4502-a8de-cd1d59d3631d": "Eficiência da Operação: MO Indireta Total",
  "8c9ec898-f4d1-495d-a40b-9a1c4f580cec": "Eficiência da Operação: MO Geral Matriz",
  "c5404bcc-0a74-4c7e-802c-8fe86193a9bc": "Eficiência da Operação: MO Geral Filial",
  "502e520c-ac1d-4cbf-8022-25b50b18bab8": "Eficiência da Operação: MO Geral Total",
  "4e7e11ac-c29a-4259-b392-36808da9525e": "Eficiência da Operação: MO Direta Montagem",
  "ae17204d-af71-4294-9851-50cccaf40dc5": "Eficiência da Operação: MO Indireta Montagem",
  "22cacb36-d4a3-43b0-931a-4aa3188df9e2": "Eficiência da Operação: MO Geral Montagem",
  "2f3dac17-6d5b-44dd-b1ab-902ae3142232": "Eficiência da Operação: Total",
  // GME
  "a6c5f9f2-7c6b-4209-bd0a-442c5b54f1ba": "Repres. do Mix Ampliado nas Vendas",
  "24057f9d-b408-4a7b-850f-87f655dced2b": "Média Móvel da Demanda Gerada",
  "1dbff0e2-1186-4a7a-b671-54715d3088ee": "Média Móvel da Demanda Expedida",
  "0ea5fb27-2ff2-4841-8cec-d61aed350bc3": "Atingimento do FCOL Acumulado",
  "84aa093c-1541-4e9a-97b7-9ba6ef07973d": "Atingimento da MC Acumulada",
  // Serviços
  "dd7670d7-7801-4213-909a-cfb7148e4585": "Custo do Produto Vendido (CPV): Montagem",
  "20fc6226-d1b4-48a8-a320-2c9d509e6743": "Custo do Produto Vendido (CPV): Complementar",
};

/** Os indicadores que o código usa, pelo ID. */
export const IND = {
  /** Quadro de Lotação: MO Direta Matriz */
  QL_DIRETA_MATRIZ: "6bf97f89-c56c-4a7c-be04-089a64b6e4dd",
  /** Quadro de Lotação: MO Direta Filial */
  QL_DIRETA_FILIAL: "20c73a9d-9d0d-4905-a3a0-8601e54ee8fa",
  /** Quadro de Lotação: MO Direta Total */
  QL_DIRETA_TOTAL: "291f313d-afbe-4163-ab62-490345cd9279",
  /** Quadro de Lotação: MO Direta Montagem */
  QL_DIRETA_MONTAGEM: "e4bfa902-c64c-453a-936a-8fed6b51a913",
  /** Quadro de Lotação: MO Indireta Matriz */
  QL_INDIRETA_MATRIZ: "0e5dbe88-1b58-4822-93b2-7b9b4f76d926",
  /** Quadro de Lotação: MO Indireta Filial */
  QL_INDIRETA_FILIAL: "f2654e05-b279-40a5-b28e-993f94141baa",
  /** Quadro de Lotação: MO Indireta Total */
  QL_INDIRETA_TOTAL: "4c294aa9-0933-4e18-b56a-1852ae80a9ef",
  /** Quadro de Lotação: MO Indireta Montagem */
  QL_INDIRETA_MONTAGEM: "b5371d75-a6fa-4944-9c30-ee44c104da85",
  /** Quadro de Lotação: MO Geral Matriz */
  QL_GERAL_MATRIZ: "a296ca17-1621-4579-97e0-953baf9ccf67",
  /** Quadro de Lotação: MO Geral Filial */
  QL_GERAL_FILIAL: "7a0dcc15-8401-4c4e-9786-cc5d0e3544a3",
  /** Quadro de Lotação: MO Geral Total */
  QL_GERAL_TOTAL: "fb948998-8425-455c-ad27-bd7bad269d41",
  /** Quadro de Lotação: MO Geral Montagem */
  QL_GERAL_MONTAGEM: "aeee1010-c519-45de-879b-e0a279e90250",
  /** Quadro de Lotação Total */
  QUADRO_TOTAL: "4b26c813-f5dd-446c-aa52-d3a71b722d6a",
  /** Turnover */
  TURNOVER: "c9a1ede7-f01f-4fe7-af4a-ddd314062015",
  /** Abertura de Vagas x Contratações */
  CONTRATACOES: "88634a45-9f68-4c28-83fa-265c861a8735",
  /** Acidentes c/ Afastamento */
  ACIDENTES: "c25df8d2-4385-45ee-9e52-340d0be4b267",
  /** Fluxo de Caixa Operacional Líquido */
  FCOL: "7a57a72b-9847-4ce6-821a-623c14282646",
  /** Inadimplência */
  INADIMPLENCIA: "996f3e0d-da9d-4733-bf5c-bdf2b613a187",
  /** Venda: Global */
  VENDA_GLOBAL: "903cf420-e7f2-4f92-aef5-1c0b92d02983",
  /** Venda: Mercantil */
  VENDA_MERCANTIL: "b1e551b5-7bb9-4e07-a4e1-8c96ee451719",
  /** Venda: Total */
  VENDA_TOTAL: "377ac419-c535-4bd0-9057-ab939dba584a",
  /** Receita Líquida Vendida: Global */
  RLV_GLOBAL: "af8f98a9-698c-4a44-a0be-4025a1822709",
  /** Receita Líquida Vendida: Mercantil */
  RLV_MERCANTIL: "77d4431f-da9d-4869-b79d-1340a90920fc",
  /** Receita Líquida Vendida: Total */
  RLV_TOTAL: "7a96ecf4-6e5e-452c-94d1-c1deaa4d5b17",
  /** Margem de Contribuição: Global */
  MCV_GLOBAL: "8604f555-e4e3-472b-93a4-fc0ba33ecaa2",
  /** Margem de Contribuição: Mercantil */
  MCV_MERCANTIL: "d75aa85e-ece7-4ae0-9118-8ba41a0bd0d2",
  /** Margem de Contribuição: Total */
  MCV_TOTAL: "d666f93f-7f05-4154-b460-2f0b4c95a44c",
  /** Demanda (Vol.): Matriz */
  DEMANDA_MATRIZ: "f11c18a2-42c4-4d36-9136-e3d141d32e5b",
  /** Demanda (Vol.): Filial */
  DEMANDA_FILIAL: "2b8f3bb2-1a26-434e-a9cd-fb63a6a67c0f",
  /** Demanda (Vol.): Total (Fabricação) */
  DEMANDA_FABRICACAO: "7e88050f-d2ff-49ae-9229-9c4e1c270b81",
  /** Demanda (Vol.): Montagem */
  DEMANDA_MONTAGEM: "98acd7be-2500-466d-be5c-5cce17caed10",
  /** Demanda (Pistas.): Filial */
  DEMANDA_PISTAS_FILIAL: "3cf3a00c-2738-40ca-9520-ee8f717fd1a2",
  /** Repres. do Mix Ampliado nas Vendas */
  MIX_AMPLIADO: "a6c5f9f2-7c6b-4209-bd0a-442c5b54f1ba",
  /** Liberação de Projetos: Matriz */
  LIBERACAO_MATRIZ: "f1af14a7-bf94-4bc1-8d8f-7b27abc91153",
  /** Liberação de Projetos: Filial */
  LIBERACAO_FILIAL: "89497a05-3b8c-42fd-8406-fff694f699a9",
  /** Liberação de Projetos: Total */
  LIBERACAO_TOTAL: "76763048-be22-4765-a354-c60018bec159",
  /** Produção (Vol.): Total */
  PRODUCAO_TOTAL: "6752e1dd-5af4-44b2-b93f-5a7905a086de",
  /** Margem de Contribuição (MC): Total */
  MC_TOTAL: "47028dd4-4f68-4b5d-9a7e-f8ac4fa1b843",
  /** Eficiência da Operação: MO Direta Total */
  EFICIENCIA_OPERACAO_DIRETA_TOTAL: "ff2f3d69-9dcc-4b24-8788-19f6805626f9",
  /** Eficiência da Operação: MO Indireta Total */
  EFICIENCIA_OPERACAO_INDIRETA_TOTAL: "78259c21-81c6-4502-a8de-cd1d59d3631d",
  /** Eficiência da Operação: MO Geral Total */
  EFICIENCIA_OPERACAO_GERAL_TOTAL: "502e520c-ac1d-4cbf-8022-25b50b18bab8",
  /** Média Móvel da Demanda Gerada */
  MEDIA_DEMANDA_GERADA: "24057f9d-b408-4a7b-850f-87f655dced2b",
  /** Média Móvel da Demanda Expedida */
  MEDIA_DEMANDA_EXPEDIDA: "1dbff0e2-1186-4a7a-b671-54715d3088ee",
  /** Atingimento do FCOL Acumulado */
  ATINGIMENTO_FCOL: "0ea5fb27-2ff2-4841-8cec-d61aed350bc3",
  /** Atingimento da MC Acumulada */
  ATINGIMENTO_MC: "84aa093c-1541-4e9a-97b7-9ba6ef07973d",
} as const;

/** ID → nome atual (sem a leitura do banco, o original). */
const atuais = new Map<string, string>(Object.entries(NOMES_ORIGINAIS));
/** Nome atual → ID. */
let porNome = new Map<string, string>();
/** Nome original → ID. */
const porOriginal = new Map<string, string>(Object.entries(NOMES_ORIGINAIS).map(([id, nome]) => [nome, id]));

function indexar() {
  porNome = new Map([...atuais].map(([id, nome]) => [nome, id]));
}
indexar();

/** O nome atual do indicador. */
export const nomeDo = (id: string): string => atuais.get(id) ?? id;

/** O ID do indicador da tabela com este nome atual, ou nulo. */
export const idPeloNome = (nome: string): string | null => porNome.get(nome) ?? null;

/** O nome original (o de 19/11/2026) do indicador com este nome atual; fora da tabela, o próprio nome. */
export const originalDe = (nome: string): string => {
  const id = porNome.get(nome);
  return id ? NOMES_ORIGINAIS[id] : nome;
};

/** O nome atual do indicador que tinha este nome original; fora da tabela, o próprio nome. */
export const atualDe = (original: string): string => {
  const id = porOriginal.get(original);
  return id ? nomeDo(id) : original;
};

/** O ID da tabela do indicador com este nome original, ou nulo. */
export const idPeloOriginal = (original: string): string | null => porOriginal.get(original) ?? null;

/** Todos os indicadores do cadastro (ID → nome atual), da última leitura. */
let doCadastro = new Map<string, string>();
/** Os nomes antigos das trocas registradas na Auditoria (RENOMEACAO) → o ID do indicador. */
let renomeados = new Map<string, string>();

/** A ação da Auditoria da troca do nome (de um indicador ou de um card do Painel de Bordo). */
export const ACAO_RENOMEACAO = "RENOMEACAO";

/**
 * Lê os nomes atuais do banco e as trocas de nome da Auditoria. Devolve os indicadores da tabela que não estão no banco por
 * esse ID (numa base com outros IDs), que ficam com o nome original.
 */
export async function carregarNomesDoSistema(db: Pick<ReturnType<typeof getPrismaClient>, "indicadorEstrutura" | "auditLog"> = getPrismaClient()): Promise<string[]> {
  const [linhas, trocas] = await Promise.all([
    db.indicadorEstrutura.findMany({ select: { id: true, nome: true } }),
    db.auditLog.findMany({ where: { entidade: "indicador_estrutura", acao: ACAO_RENOMEACAO }, orderBy: { createdAt: "asc" }, select: { entidadeId: true, dadosAntes: true } }),
  ]);
  doCadastro = new Map(linhas.map((l) => [l.id, l.nome]));
  atuais.clear();
  for (const [id, nome] of Object.entries(NOMES_ORIGINAIS)) atuais.set(id, doCadastro.get(id) ?? nome);
  indexar();
  renomeados = new Map();
  for (const t of trocas) {
    const antes = t.dadosAntes as { nome?: unknown } | null;
    if (t.entidadeId && typeof antes?.nome === "string") renomeados.set(antes.nome, t.entidadeId);
  }
  return Object.entries(NOMES_ORIGINAIS)
    .filter(([id]) => !doCadastro.has(id))
    .map(([, nome]) => nome);
}

/**
 * Os nomes antigos dos indicadores renomeados → o nome atual (19/11/2026): os originais da tabela que mudaram e os das trocas
 * da Auditoria. As importações recusam a linha com um deles (pedido do Adão: o arquivo muda antes de importar). Um nome que
 * hoje é o de algum indicador não é antigo.
 */
export function nomesAntigos(): Map<string, string> {
  const vigentes = new Set([...doCadastro.values(), ...atuais.values()]);
  const r = new Map<string, string>();
  for (const [antigo, id] of renomeados) {
    const atual = doCadastro.get(id);
    if (atual && !vigentes.has(antigo)) r.set(antigo, atual);
  }
  for (const [id, original] of Object.entries(NOMES_ORIGINAIS)) {
    const atual = nomeDo(id);
    if (atual !== original && !vigentes.has(original)) r.set(original, atual);
  }
  return r;
}

/** Muda o nome atual de um indicador da tabela (os testes; o servidor lê do banco). */
export function definirNomeAtual(id: string, nome: string) {
  if (!(id in NOMES_ORIGINAIS)) return;
  atuais.set(id, nome);
  if (doCadastro.has(id)) doCadastro.set(id, nome);
  indexar();
}

/**
 * Um conjunto de indicadores pelos IDs que se lê pelos nomes atuais (o has e a lista acompanham as trocas de nome), no lugar
 * dos Set de nomes fixos.
 */
export class IndicadoresPeloId implements Iterable<string> {
  constructor(private readonly ids: () => readonly string[]) {}
  has(nome: string) {
    return this.ids().some((id) => nomeDo(id) === nome);
  }
  get size() {
    return this.ids().length;
  }
  [Symbol.iterator]() {
    return this.ids().map(nomeDo)[Symbol.iterator]();
  }
}
