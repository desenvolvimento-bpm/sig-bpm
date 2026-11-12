-- Os Departamentos da DRE (12/11/2026, pedido do Adão): cada departamento ligado aos grupos da DRE (as siglas: CPP, CSM,
-- CSC, DL, DT, DC, DA…), e o Extra-Operacional como um departamento próprio da unidade Despesas e Extra, ao lado das
-- despesas (Logística, Técnico, Comercial e Administrativo).

-- AlterTable
ALTER TABLE "departamentos" ADD COLUMN "grupos_dre" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- A ligação da carga inicial (só nos departamentos ainda sem grupos).
UPDATE "departamentos" d SET "grupos_dre" = v.grupos
FROM (VALUES
    (1, 'Produção', ARRAY['CPP']),
    (2, 'Produção', ARRAY['CPP']),
    (3, 'Montagem', ARRAY['CSM']),
    (3, 'Complementares', ARRAY['CSC']),
    (4, 'Logística', ARRAY['DL']),
    (4, 'Técnico', ARRAY['DT']),
    (4, 'Comercial', ARRAY['DC']),
    (4, 'Administrativo', ARRAY['DA'])
) AS v (codigo, nome, grupos), "unidades_negocio" u
WHERE u.codigo = v.codigo AND d."unidade_negocio_id" = u.id AND d."nome" = v.nome AND d."grupos_dre" = ARRAY[]::TEXT[];

-- O Extra-Operacional, na unidade Despesas e Extra (código 4).
INSERT INTO "departamentos" ("id", "ordem", "unidade_negocio_id", "nome", "grupos_dre", "atualizado_em")
SELECT gen_random_uuid()::text, 9, u.id, 'Extra-Operacional', ARRAY['DML', 'RFC', 'RFNC', 'DFC', 'DFNC'], CURRENT_TIMESTAMP
FROM "unidades_negocio" u
WHERE u.codigo = 4
ON CONFLICT DO NOTHING;
