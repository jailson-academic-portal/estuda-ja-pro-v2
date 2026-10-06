#!/usr/bin/env node
/**
 * Aplica a migration de avaliações online com biometria no Supabase.
 *
 * O SQL Editor do dashboard resolve, mas este script existe para:
 *   - rodar em CI/CD;
 *   - ser reexecutado com segurança (a migration é idempotente);
 *   - abortar ANTES de qualquer DDL se o banco alvo não for o esperado.
 *
 * USO
 *   Requer o driver `pg`, que NÃO está no package.json:
 *     npm i --save-dev pg     (ou: bun add -d pg)
 *
 *   node scripts/apply-online-exams.mjs
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
 *                  banco correto (padrão: 20). Abaixo disso, aborta.
 *
 * SEGURANÇA
 *   - Não altera, não remove e não renomeia tabela alguma.
 *   - Snapshot das tabelas antes/depois; se alguma sumir, o script reporta.
 *   - Aplicação em transação: falha no meio => rollback completo.
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
  "20261005120000_online_exams_biometrics.sql",
);

const NEW_TABLES = ["user_biometrics", "online_exams", "exam_sessions", "exam_answers"];
const ANCHOR_TABLES = ["profiles", "disciplines", "assessments", "assessment_questions"];
const EXPECT_TABLES = Number(process.env.EXPECT_TABLES || 20);

const RED = "\x1b[31m", GRN = "\x1b[32m", YLW = "\x1b[33m", RST = "\x1b[0m";
const ok = (m) => console.log(`${GRN}${m}${RST}`);
const warn = (m) => console.log(`${YLW}${m}${RST}`);
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
    console.error('  node scripts/apply-online-exams.mjs');
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
  const { rows, error } = await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE'
      ORDER BY table_name`,
  );
  if (error) throw new Error(error.message);
  return new Set(rows.map((r) => r.table_name));
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
  ok("  preflight OK: banco correto, tabelas de ancora presentes");
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

async function verify(client, before) {
  const after = await listTables(client);
  const created = [...after].filter((t) => !before.has(t));
  const removed = [...before].filter((t) => !after.has(t));
  const missing = NEW_TABLES.filter((t) => !after.has(t));

  console.log("\n--- verificacao ---");
  console.log(`  criadas   : ${created.length ? created.join(", ") : "(nenhuma)"}`);
  if (removed.length) fail(`  REMOVIDAS : ${removed.join(", ")}`);
  else ok("  removidas : (nenhuma)");

  if (missing.length) {
    fail(`  FALTARAM  : ${missing.join(", ")}`);
    process.exit(3);
  }
  ok("  as 4 tabelas existem");

  const enums = (
    await client.query(
      `SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname='public' AND t.typtype='e'
          AND t.typname IN ('biometric_kind','online_exam_status','exam_session_status','biometric_verify_result')
        ORDER BY t.typname`,
    )
  ).rows.map((r) => r.typname);
  console.log(`  enums     : ${enums.join(", ")}`);

  for (const t of NEW_TABLES) {
    const rls = await client.query(
      `SELECT relrowsecurity FROM pg_class
        WHERE relname=$1 AND relnamespace='public'::regnamespace`, [t]);
    const pol = await client.query(
      `SELECT count(*)::int n FROM pg_policies WHERE schemaname='public' AND tablename=$1`, [t]);
    console.log(`  ${t.padEnd(16)} RLS=${rls.rows[0]?.relrowsecurity} policies=${pol.rows[0].n}`);
  }

  // Limpa o cache do PostgREST: sem isso a API continua devolvendo
  // "Could not find the table in the schema cache".
  try {
    await client.query("NOTIFY pgrst, 'reload schema'");
    ok("\ncache do PostgREST recarregado (NOTIFY pgrst)");
  } catch {
    warn("\nnao foi possivel recarregar o cache do PostgREST; faca isso no SQL Editor");
  }
}

async function main() {
  requiredEnv();
  const client = makeClient();
  await client.connect();
  console.log("conectado\n");
  const before = await preflight(client);
  await apply(client);
  await verify(client, before);
  await client.end();
  ok("\nconcluido.");
}

main().catch((e) => {
  fail(`erro inesperado: ${e.message}`);
  process.exit(1);
});