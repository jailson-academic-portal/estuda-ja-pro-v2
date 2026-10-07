#!/usr/bin/env node
/**
 * Aplica a migration de criação das tabelas de Avaliações Online
 * (online_exams, exam_sessions, exam_answers) no Supabase.
 *
 * DIFERENÇA em relação ao scripts/apply-online-exams.mjs (que mira
 * a migration antiga com biometric): este mira o arquivo
 * 20261008120000_create_online_exams_tables.sql, que é a versão
 * "limpa" sem user_biometrics.
 *
 * USO
 *   Requer o driver `pg` (já está em devDependencies):
 *     bun add -d pg       (ou: npm i --save-dev pg)
 *
 *   node scripts/apply-exams-table.mjs
 *
 * VARIÁVEIS DE AMBIENTE (obrigatórias)
 *   PGHOST      ex.: db.itzhuwlngohstxbpoiqy.supabase.co
 *   PGPORT      5432 (direta) ou 6543 (pooler). padrão: 5432
 *   PGUSER      postgres   (no pooler: postgres.<PROJECT_REF>)
 *   PGPASSWORD  a senha do banco
 *   PGDATABASE  postgres (padrão)
 *
 * VARIÁVEIS OPCIONAIS
 *   EXPECT_TABLES  número mínimo de tabelas em public para considerar o
 *                  banco correto (padrão: 20).
 *   DRY_RUN        "1" para validar pré-condições sem aplicar.
 *
 * SEGURANÇA
 *   - Pré-flight: confere que está no banco de produção (mínimo de
 *     tabelas + presença de âncoras: profiles, disciplines,
 *     assessments, assessment_questions, attendance_sessions,
 *     attendance_records, discipline_students).
 *   - Confere que `online_exams` ainda NÃO existe (idempotente mas
 *     aborta se já existir para não sobrescrever dados).
 *   - Aplicação em transação: falha no meio => rollback completo.
 *   - Dispara NOTIFY pgrst, 'reload schema' ao final.
 *   - Confere no final que as 3 tabelas e os 3 enums esperados
 *     ficaram no banco.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const MIGRATION = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20261008120000_create_online_exams_tables.sql",
);

const NEW_TABLES = ["online_exams", "exam_sessions", "exam_answers"];
const ANCHOR_TABLES = [
  "profiles",
  "disciplines",
  "assessments",
  "assessment_questions",
  "discipline_students",
  "attendance_sessions",
  "attendance_records",
];
const EXPECT_TABLES = Number(process.env.EXPECT_TABLES || 20);
const DRY_RUN = process.env.DRY_RUN === "1";

const RED = "\x1b[31m",
  GRN = "\x1b[32m",
  YLW = "\x1b[33m",
  CYN = "\x1b[36m",
  RST = "\x1b[0m";
const ok = (m) => console.log(`${GRN}${m}${RST}`);
const warn = (m) => console.log(`${YLW}${m}${RST}`);
const info = (m) => console.log(`${CYN}${m}${RST}`);
const fail = (m) => console.error(`${RED}${m}${RST}`);

function requiredEnv() {
  const missing = ["PGHOST", "PGUSER", "PGPASSWORD"].filter((k) => !process.env[k]);
  if (missing.length) {
    fail(`Variaveis de ambiente ausentes: ${missing.join(", ")}`);
    console.error("\nExemplo (PowerShell):");
    console.error('  $env:PGHOST="db.itzhuwlngohstxbpoiqy.supabase.co"');
    console.error('  $env:PGPORT="5432"');
    console.error('  $env:PGUSER="postgres"');
    console.error('  $env:PGPASSWORD="sua-senha"');
    console.error("  node scripts/apply-exams-table.mjs");
    process.exit(1);
  }
}

function makeClient() {
  return new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE || "postgres",
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
}

async function listTables(client) {
  const { rows } = await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE'
      ORDER BY table_name`,
  );
  return new Set(rows.map((r) => r.table_name));
}

async function listEnums(client) {
  const { rows } = await client.query(
    `SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname='public' AND t.typtype='e'
      ORDER BY t.typname`,
  );
  return new Set(rows.map((r) => r.typname));
}

/** Prova de que o banco alvo é o projeto de produção. */
async function preflight(client) {
  const ident = await client.query(
    `SELECT current_database() db, current_user usr,
            inet_server_addr()::text addr, inet_server_port() port, version() ver`,
  );
  const i = ident.rows[0];
  console.log("--- conexao ---");
  console.log(`  host      : ${process.env.PGHOST}`);
  console.log(`  database  : ${i.db}`);
  console.log(`  user      : ${i.usr}`);
  console.log(`  servidor  : ${i.addr}:${i.port}`);
  console.log(`  versao    : ${String(i.ver).split(" ").slice(0, 2).join(" ")}`);

  const tables = await listTables(client);
  console.log(`  tabelas   : ${tables.size}`);

  if (tables.size < EXPECT_TABLES) {
    fail(`\nABORTADO: apenas ${tables.size} tabelas em public (esperado >= ${EXPECT_TABLES}).`);
    fail("Este banco nao parece o projeto de producao. Nada foi aplicado.");
    fail("Confira se PGHOST/PGPASSWORD apontam para o projeto certo.");
    process.exit(2);
  }

  const missingAnchors = ANCHOR_TABLES.filter((t) => !tables.has(t));
  if (missingAnchors.length) {
    fail(`\nABORTADO: faltam tabelas de ancora: ${missingAnchors.join(", ")}`);
    fail("A migration depende delas para as foreign keys. Nada foi aplicado.");
    process.exit(2);
  }

  // Guarda extra: o problema que estamos resolvendo e' que a tabela
  // online_exams nao existe. Se ela JA existe, abortamos para nao
  // sobrescrever dados do usuario.
  if (tables.has("online_exams")) {
    fail("\nABORTADO: a tabela public.online_exams JA existe neste banco.");
    fail("Esta migration e' para criar a tabela do zero.");
    fail("Se voce precisa ALTERAR a tabela existente, faca uma migration nova.");
    process.exit(2);
  }
  ok("  preflight OK: banco correto, tabelas de ancora presentes, online_exams ausente");
  return tables;
}

async function apply(client) {
  const sql = fs.readFileSync(MIGRATION, "utf8");
  const t = makeClient();
  await t.connect();
  try {
    await t.query("BEGIN");
    await t.query(sql);
    await t.query("COMMIT");
    ok("\nmigration aplicada com sucesso");
  } catch (err) {
    await t.query("ROLLBACK").catch(() => {});
    fail(`\nFALHOU: ${err.message}`);
    fail("rollback executado. O banco nao foi alterado.");
    await t.end();
    process.exit(1);
  }
  await t.end();
}

async function verify(client) {
  const afterTables = await listTables(client);
  const afterEnums = await listEnums(client);
  const created = NEW_TABLES.filter((t) => afterTables.has(t));
  const missing = NEW_TABLES.filter((t) => !afterTables.has(t));

  console.log("\n--- verificacao ---");
  console.log(
    `  tabelas criadas : ${created.length ? created.join(", ") : "(nenhuma)"}`,
  );
  if (missing.length) {
    fail(`  FALTARAM        : ${missing.join(", ")}`);
    process.exit(3);
  }
  ok("  as 3 tabelas existem");

  const expectedEnums = [
    "online_exam_status",
    "exam_session_status",
    "biometric_kind",
  ];
  const foundEnums = expectedEnums.filter((e) => afterEnums.has(e));
  console.log(`  enums           : ${foundEnums.join(", ")}`);
  for (const e of expectedEnums) {
    if (!afterEnums.has(e)) {
      fail(`  ENUM AUSENTE    : ${e}`);
      process.exit(3);
    }
  }
  ok("  os 3 enums estao presentes");

  for (const t of NEW_TABLES) {
    const rls = await client.query(
      `SELECT relrowsecurity FROM pg_class
        WHERE relname=$1 AND relnamespace='public'::regnamespace`,
      [t],
    );
    const pol = await client.query(
      `SELECT count(*)::int n FROM pg_policies WHERE schemaname='public' AND tablename=$1`,
      [t],
    );
    console.log(
      `  ${t.padEnd(16)} RLS=${rls.rows[0]?.relrowsecurity} policies=${pol.rows[0].n}`,
    );
  }

  // Limpa o cache do PostgREST: sem isso a API continua devolvendo
  // "Could not find the table in the schema cache".
  try {
    await client.query("NOTIFY pgrst, 'reload schema'");
    ok("\ncache do PostgREST recarregado (NOTIFY pgrst)");
  } catch {
    warn(
      "\nnao foi possivel recarregar o cache do PostgREST; faca isso no SQL Editor:",
    );
    warn('  NOTIFY pgrst, \'reload schema\';');
  }
}

async function main() {
  requiredEnv();
  if (DRY_RUN) {
    info("\nDRY_RUN=1: nenhuma alteracao sera feita. Apenas preflight.\n");
  }
  const client = makeClient();
  await client.connect();
  console.log("conectado\n");
  const before = await preflight(client);
  if (DRY_RUN) {
    info("\npreflight OK. Saindo sem aplicar (DRY_RUN=1).");
    await client.end();
    return;
  }
  await apply(client);
  await verify(client, before);
  await client.end();
  ok("\nconcluido.");
}

main().catch((e) => {
  fail(`erro inesperado: ${e.message}`);
  process.exit(1);
});
