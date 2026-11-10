/**
 * O item "Comercial e Administrativo" ([IND|nome]) sai da Metodologia dos indicadores (06/11/2026, pedido do Adão): no cadastro
 * Estrutura dos Indicadores,
 * - o indicador cuja Metodologia é só o [IND|<o próprio nome>] (os indicadores-base: Turnover, Venda: Global…), ou que ficou
 *   sem itens na primeira versão desta conversão (06/11/2026), passa ao item Valor Registrado ([REGISTRADO], 09/11/2026): o
 *   registrado no mês com o nome dele (o mesmo valor);
 * - nos demais, na Metodologia e no Peso da Média (ou na Fórmula do Acumulado), cada [IND|X] vira [INDICADOR|X], o indicador
 *   de mesmo nome (que vale o mesmo).
 *
 * Com --gravar, confere antes e depois: os indicadores de todos os exercícios com competência (os valores de cada mês e o
 * acumulado) e os de todos os cenários (cada mês e o acumulado até dezembro). Qualquer diferença desfaz a gravação e a
 * lista. Sem --gravar, só mostra o que mudaria.
 *
 * Uso (no backend): npx tsx scripts/converterItensComercialAdministrativo.ts [--gravar]
 * O banco é o do DATABASE_URL (o .env do modo); na teste, o do .env.teste com NODE_ENV=development.
 */
import { getPrismaClient } from "../src/config/prisma.js";
import { auditar } from "../src/services/auditoriaService.js";
import { calcularCenario } from "../src/services/cenarios/indicadoresDoCenario.js";
import { indicadoresService } from "../src/services/relatorios/indicadoresService.js";

const gravar = process.argv.includes("--gravar");
const prisma = getPrismaClient();
const linhas = await prisma.indicadorEstrutura.findMany({ orderBy: { ordem: "asc" } });
const nomes = new Set(linhas.map((l) => l.nome));

/** O texto com cada [IND|X] trocado por [INDICADOR|X] (só com o indicador X no cadastro). */
const trocar = (t: string | null, avisos: string[]) =>
  t?.replace(/\[IND\|([^\]]+)\]/g, (todo, nome: string) => {
    if (nomes.has(nome)) return `[INDICADOR|${nome}]`;
    avisos.push(nome);
    return todo;
  }) ?? null;

const mudancas = linhas.flatMap((l) => {
  const avisos: string[] = [];
  const base = l.modo !== "SISTEMA" && (l.formula === `[IND|${l.nome}]` || !l.formula?.trim());
  const formula = base ? "[REGISTRADO]" : trocar(l.formula, avisos);
  const peso = trocar(l.peso, avisos);
  if (formula === l.formula && peso === l.peso) return [];
  return [{ id: l.id, nome: l.nome, antes: { formula: l.formula, peso: l.peso }, depois: { formula, peso }, avisos }];
});
const base = mudancas.filter((m) => m.depois.formula === "[REGISTRADO]");
console.log(`Banco: ${process.env.DATABASE_URL?.replace(/\/\/[^@]*@/, "//…@")}`);
console.log(`${mudancas.length} indicadores mudam: ${base.length} passam ao item Valor Registrado e ${mudancas.length - base.length} trocam o item pelo indicador.`);
for (const m of mudancas.filter((x) => !base.includes(x))) console.log(`  ${m.nome}: ${m.depois.formula}${m.depois.peso !== m.antes.peso ? ` | peso: ${m.depois.peso}` : ""}`);
for (const m of base.filter((x) => x.depois.peso !== x.antes.peso)) console.log(`  ${m.nome} (Valor Registrado) | peso: ${m.depois.peso}`);
const semIndicador = [...new Set(mudancas.flatMap((m) => m.avisos))];
if (semIndicador.length) console.log(`Ficam como estão (sem indicador de mesmo nome): ${semIndicador.join("; ")}`);
if (!gravar || !mudancas.length) {
  if (!gravar) console.log("Simulação: nada gravado. Para gravar, --gravar.");
  process.exit(0);
}

/** Todos os valores dos indicadores: os exercícios com competência e os cenários. */
async function retrato() {
  const valores = new Map<string, number | null>();
  const guardar = (chave: string, v: number | null | undefined) => valores.set(chave, v === undefined || v === null || !Number.isFinite(v) ? null : Number(v.toFixed(9)));
  const anos = [...new Set((await prisma.competencia.findMany({ select: { ano: true } })).map((c) => c.ano))];
  for (const ano of anos) {
    const r = await indicadoresService.listar(ano);
    for (const i of r.indicadores) {
      i.meses.forEach((v, k) => guardar(`${ano}|${i.nome}|${k + 1}`, v));
      guardar(`${ano}|${i.nome}|total`, i.total);
    }
  }
  for (const c of await prisma.cenario.findMany({ select: { id: true, nome: true } })) {
    const calc = await calcularCenario(c.id);
    for (const i of calc.indicadores) {
      i.partes.forEach((p, k) => guardar(`cenário ${c.nome}|${i.indicador.nome}|${k + 1}`, p?.valor));
      guardar(`cenário ${c.nome}|${i.indicador.nome}|acumulado`, calc.acumulado(i, 12));
      guardar(`cenário ${c.nome}|${i.indicador.nome}|classe`, ["CALCULADO", "IMPORTADO", "MANUAL", "RESULTADO"].indexOf(i.classe));
    }
  }
  return valores;
}

const quem = await prisma.usuario.findFirst({ where: { email: "adao.pinheiro@bpm.com.br" }, select: { id: true } });
console.log("Conferindo antes…");
const antes = await retrato();
await prisma.$transaction(async (tx) => {
  for (const m of mudancas) await tx.indicadorEstrutura.update({ where: { id: m.id }, data: m.depois });
});
console.log("Gravado. Conferindo depois…");
// Os quadros do Quadro de Lotação ficam 10 s guardados; os indicadores não os mudam aqui.
const depois = await retrato();
const diferencas = [...antes.keys()].filter((k) => antes.get(k) !== depois.get(k));
if (diferencas.length || antes.size !== depois.size) {
  await prisma.$transaction(async (tx) => {
    for (const m of mudancas) await tx.indicadorEstrutura.update({ where: { id: m.id }, data: m.antes });
  });
  console.log(`DIFERENÇAS (${diferencas.length}; valores ${antes.size} antes, ${depois.size} depois): a gravação foi desfeita.`);
  for (const k of diferencas.slice(0, 40)) console.log(`  ${k}: ${antes.get(k)} → ${depois.get(k)}`);
  process.exit(1);
}
for (const m of mudancas) {
  await auditar({
    usuarioId: quem?.id ?? null,
    acao: "ALTERACAO",
    entidade: "indicador_estrutura",
    entidadeId: m.id,
    antes: m.antes,
    depois: m.depois,
    metadados: { nome: m.nome, motivo: "O item Comercial e Administrativo saiu da Metodologia (06/11/2026)" },
  });
}
console.log(`Conferido: ${antes.size} valores iguais antes e depois (exercícios e cenários). Auditoria: ${mudancas.length} alterações.`);
process.exit(0);
