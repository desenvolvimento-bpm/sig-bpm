import { strToU8, zipSync } from "fflate";

/**
 * Escritor mínimo de .xlsx: texto e número, com um conjunto fixo de estilos
 * para relatório. O par do leitor de `xlsx.ts`, sem dependência além do
 * fflate. Os valores são os apurados, como na tela; a célula com `formula` (15/10/2026: a aba Consolidado das
 * exportações dos centros de custo) grava a fórmula, com o valor calculado como o já mostrado, e o Excel recalcula ao abrir.
 */

/** Os estilos disponíveis. A ordem é a dos `cellXfs` de `styles.xml`. */
export const ESTILO = {
  padrao: 0,
  titulo: 1,
  informacao: 2,
  cabecalho: 3,
  item: 4,
  itemMoeda: 5,
  itemVolume: 6,
  destaque: 7,
  destaqueMoeda: 8,
  destaqueVolume: 9,
  itemDireita: 10,
  destaqueDireita: 11,
  cabecalhoDireita: 12,
  aviso: 13,
  /** Número com duas casas, sem o símbolo da moeda (relatórios largos: Resultados, Indicadores). */
  itemNumero: 14,
  destaqueNumero: 15,
  /** Participação: 0,256 sai 25,6%. */
  itemPercentual: 16,
  destaquePercentual: 17,
  /**
   * Os totais da DRE (22/10/2026), como nas telas: os totais em amarelo claro (…Total) e as linhas de resultado num
   * amarelo mais forte (…Resultado); `naCorDaDRE` escolhe pelo fundo da linha.
   */
  destaqueTotal: 18,
  destaqueMoedaTotal: 19,
  destaqueVolumeTotal: 20,
  destaqueDireitaTotal: 21,
  destaqueNumeroTotal: 22,
  destaquePercentualTotal: 23,
  destaqueResultado: 24,
  destaqueMoedaResultado: 25,
  destaqueVolumeResultado: 26,
  destaqueDireitaResultado: 27,
  destaqueNumeroResultado: 28,
  destaquePercentualResultado: 29,
  /** O cabeçalho à direita com a quebra de texto automática (11/11/2026: os rótulos dos meses da aba Quadro de Lotação). */
  cabecalhoDireitaQuebra: 30,
  /** O cabeçalho à esquerda com a quebra de texto automática (11/11/2026: os rótulos do Exportar Premissas). */
  cabecalhoQuebra: 31,
} as const;
export type Estilo = (typeof ESTILO)[keyof typeof ESTILO];

type Destaque = "destaque" | "destaqueMoeda" | "destaqueVolume" | "destaqueDireita" | "destaqueNumero" | "destaquePercentual";
/** O estilo do total na cor da linha da DRE: "total" (amarelo claro) ou "resultado" (amarelo mais forte). */
export const naCorDaDRE = (estilo: Destaque, fundo: "total" | "resultado"): Estilo => ESTILO[`${estilo}${fundo === "total" ? "Total" : "Resultado"}`];

export type Celula = { valor: string | number | null; estilo?: Estilo; /** A fórmula, sem o "=" (o `valor` é o resultado dela). */ formula?: string };
export type AbaEscrita = {
  nome: string;
  /** Largura de cada coluna, em caracteres. */
  larguras: number[];
  linhas: Celula[][];
  /** Linha (a partir de 1) que fica congelada no alto e se repete na impressão. */
  linhaCabecalho?: number;
  /** Rodapé da impressão, à esquerda; à direita vai "Página x de y". */
  rodape?: string;
  /** Impressão em paisagem (tabelas largas). */
  paisagem?: boolean;
  /** A primeira coluna fica presa ao rolar para os lados. */
  congelarPrimeiraColuna?: boolean;
  /** As primeiras colunas (quantas) presas ao rolar para os lados (11/11/2026: o Exportar Premissas); vale no lugar da de cima. */
  congelarColunas?: number;
  /**
   * As validações das células (15/10/2026: a aba Investimentos das premissas): a lista suspensa (`lista`) ou um número
   * inteiro entre `minimo` e `maximo`, no intervalo `celulas` ("B6:B205").
   */
  validacoes?: Array<{ celulas: string; lista?: string[]; inteiro?: [number, number] }>;
};

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// Caracteres de controle não são válidos em XML 1.0.
// eslint-disable-next-line no-control-regex
const escapar = (t: string) => t.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A letra da coluna (0: A, 26: AA). */
export function coluna(i: number) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Nome de aba válido no Excel: até 31 caracteres, sem []:*?/\, e único no arquivo. */
export function nomesDasAbas(nomes: string[]) {
  const usados = new Set<string>();
  return nomes.map((n) => {
    const base = n.replace(/[[\]:*?/\\]/g, " ").replace(/^'+|'+$/g, "").trim().slice(0, 31) || "Aba";
    let nome = base;
    for (let i = 2; usados.has(nome.toLowerCase()); i++) nome = `${base.slice(0, 31 - String(i).length - 1)} ${i}`;
    usados.add(nome.toLowerCase());
    return nome;
  });
}

const ESTILOS = `${XML}<styleSheet xmlns="${NS}">
<numFmts count="4"><numFmt numFmtId="164" formatCode="&quot;R$ &quot;#,##0.00;-&quot;R$ &quot;#,##0.00"/><numFmt numFmtId="165" formatCode="#,##0.000;-#,##0.000"/><numFmt numFmtId="166" formatCode="#,##0.00;-#,##0.00"/><numFmt numFmtId="167" formatCode="0.0%;-0.0%"/></numFmts>
<fonts count="5">
<font><sz val="10"/><name val="Arial"/><family val="2"/></font>
<font><b/><sz val="10"/><name val="Arial"/><family val="2"/></font>
<font><b/><sz val="14"/><name val="Arial"/><family val="2"/></font>
<font><sz val="9"/><color rgb="FF4B5563"/><name val="Arial"/><family val="2"/></font>
<font><sz val="9"/><color rgb="FF92400E"/><name val="Arial"/><family val="2"/></font>
</fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F6"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFEF9C3"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFEF08A"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF9CA3AF"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="32">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment indent="2"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="165" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="167" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="1" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="165" fontId="1" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="166" fontId="1" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="167" fontId="1" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="1" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="1" fillId="4" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="165" fontId="1" fillId="4" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="1" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="166" fontId="1" fillId="4" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="167" fontId="1" fillId="4" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function planilha(aba: AbaEscrita) {
  const linhas = aba.linhas
    .map((cs, i) => {
      const celulas = cs
        .map((c, j) => {
          const ref = `${coluna(j)}${i + 1}`;
          const s = c.estilo ? ` s="${c.estilo}"` : "";
          // A fórmula de texto (Sim/Não) leva t="str" e o texto calculado.
          if (c.formula)
            return typeof c.valor === "string"
              ? `<c r="${ref}"${s} t="str"><f>${escapar(c.formula)}</f><v>${escapar(c.valor)}</v></c>`
              : `<c r="${ref}"${s}><f>${escapar(c.formula)}</f>${typeof c.valor === "number" ? `<v>${c.valor}</v>` : ""}</c>`;
          if (c.valor === null || c.valor === "") return c.estilo ? `<c r="${ref}"${s}/>` : "";
          if (typeof c.valor === "number") return `<c r="${ref}"${s}><v>${c.valor}</v></c>`;
          return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapar(c.valor)}</t></is></c>`;
        })
        .join("");
      return `<row r="${i + 1}">${celulas}</row>`;
    })
    .join("");
  // As colunas presas: as `congelarColunas` primeiras (11/11/2026) ou só a primeira.
  const presas = aba.congelarColunas ?? (aba.congelarPrimeiraColuna ? 1 : 0);
  const canto = `${coluna(presas)}${(aba.linhaCabecalho ?? 0) + 1}`;
  const congela =
    aba.linhaCabecalho && presas > 0
      ? `<pane xSplit="${presas}" ySplit="${aba.linhaCabecalho}" topLeftCell="${canto}" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="${canto}" sqref="${canto}"/>`
      : aba.linhaCabecalho
        ? `<pane ySplit="${aba.linhaCabecalho}" topLeftCell="A${aba.linhaCabecalho + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${aba.linhaCabecalho + 1}" sqref="A${aba.linhaCabecalho + 1}"/>`
        : "";
  const cols = aba.larguras.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  const rodape = `&amp;L&amp;8${escapar(aba.rodape ?? "")}&amp;R&amp;8Página &amp;P de &amp;N`;
  return (
    `${XML}<worksheet xmlns="${NS}" xmlns:r="${NS_R}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` +
    `<sheetViews><sheetView showGridLines="0" workbookViewId="0">${congela}</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="13"/><cols>${cols}</cols><sheetData>${linhas}</sheetData>` +
    validacoes(aba) +
    `<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>` +
    `<pageSetup paperSize="9" orientation="${aba.paisagem ? "landscape" : "portrait"}" fitToWidth="1" fitToHeight="0"/>` +
    `<headerFooter><oddFooter>${rodape}</oddFooter></headerFooter></worksheet>`
  );
}

/** As validações da aba (a lista entre aspas, separada por vírgulas; até 255 caracteres, o limite do Excel). */
function validacoes(aba: AbaEscrita) {
  const vs = aba.validacoes ?? [];
  if (!vs.length) return "";
  const uma = (v: NonNullable<AbaEscrita["validacoes"]>[number]) =>
    v.lista
      ? `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${v.celulas}"><formula1>${escapar(`"${v.lista.join(",")}"`)}</formula1></dataValidation>`
      : `<dataValidation type="whole" operator="between" allowBlank="1" showErrorMessage="1" sqref="${v.celulas}"><formula1>${v.inteiro![0]}</formula1><formula2>${v.inteiro![1]}</formula2></dataValidation>`;
  return `<dataValidations count="${vs.length}">${vs.map(uma).join("")}</dataValidations>`;
}

/** O arquivo .xlsx com as abas, na ordem dada. */
export function gerarXlsx(abas: AbaEscrita[], titulo?: string): Uint8Array {
  const nomes = nomesDasAbas(abas.map((a) => a.nome));
  const arquivos: Record<string, Uint8Array> = {};
  const poe = (caminho: string, conteudo: string) => (arquivos[caminho] = strToU8(conteudo));
  const n = abas.length;

  poe(
    "[Content_Types].xml",
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
      abas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
      `</Types>`,
  );
  poe(
    "_rels/.rels",
    `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="xl/workbook.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
  );
  poe(
    "docProps/core.xml",
    `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<dc:title>${escapar(titulo ?? "")}</dc:title><dc:creator>SIG BPM</dc:creator>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</dcterms:created></cp:coreProperties>`,
  );
  const titulos = abas
    .map((a, i) => (a.linhaCabecalho ? `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${nomes[i].replace(/'/g, "''")}'!$${a.linhaCabecalho}:$${a.linhaCabecalho}</definedName>` : ""))
    .join("");
  poe(
    "xl/workbook.xml",
    `${XML}<workbook xmlns="${NS}" xmlns:r="${NS_R}"><sheets>` +
      nomes.map((nome, i) => `<sheet name="${escapar(nome)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
      `</sheets>${titulos ? `<definedNames>${titulos}</definedNames>` : ""}` +
      // Com fórmulas, o Excel recalcula tudo ao abrir.
      `${abas.some((a) => a.linhas.some((l) => l.some((c) => c.formula))) ? '<calcPr calcId="191029" fullCalcOnLoad="1"/>' : ""}</workbook>`,
  );
  poe(
    "xl/_rels/workbook.xml.rels",
    `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      abas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
      `<Relationship Id="rId${n + 1}" Type="${NS_R}/styles" Target="styles.xml"/></Relationships>`,
  );
  poe("xl/styles.xml", ESTILOS);
  abas.forEach((a, i) => poe(`xl/worksheets/sheet${i + 1}.xml`, planilha(a)));
  return zipSync(arquivos, { level: 6 });
}
