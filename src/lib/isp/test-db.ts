import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

export type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../migrations");

function migrationFiles() {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function toSql(run: <T>(text: string, params?: unknown[]) => Promise<T[]>): Sql {
  const sql = (async <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return run<T>(text, values);
  }) as unknown as Sql;
  sql.query = run;
  return sql;
}

async function applyMigrations(exec: (text: string) => Promise<unknown>) {
  for (const name of migrationFiles()) {
    await exec("select set_config('app.bypass_rls', 'on', false)");
    await exec(readFileSync(join(migrationsDir, name), "utf8"));
  }
}

const ROLE_SQL = `
do $$ begin
  begin
    create role gridline nologin nosuperuser nobypassrls;
  exception when duplicate_object then null;
  end;
end $$;
grant usage on schema public to gridline;
grant select, insert, update, delete on all tables in schema public to gridline;
`;

export type TestDb = {
  sql: Sql;
  bypass: () => Promise<void>;
  asRole: (tenantId: string) => Promise<void>;
  close: () => Promise<void>;
};

async function openPglite(): Promise<TestDb> {
  const pg = new PGlite();
  await pg.waitReady;
  await applyMigrations((text) => pg.exec(text));
  await pg.exec(ROLE_SQL);
  const sql = toSql(async <T>(text: string, params: unknown[] = []) => {
    const res = await pg.query<T>(text, params);
    return res.rows;
  });
  async function bypass() {
    await pg.exec("reset role");
    await pg.query("select set_config('app.bypass_rls', $1, false)", ["on"]);
    await pg.query("select set_config('app.tenant_id', $1, false)", [""]);
  }
  async function asRole(tenantId: string) {
    await pg.query("select set_config('app.bypass_rls', $1, false)", ["off"]);
    await pg.query("select set_config('app.tenant_id', $1, false)", [tenantId]);
    await pg.exec("set role gridline");
  }
  await bypass();
  return { sql, bypass, asRole, close: async () => pg.close() };
}

function databaseUrlWithName(url: string, name: string) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

async function openPostgres(url: string): Promise<TestDb> {
  const pg = await import("pg");
  const dbName = `glt_${randomBytes(4).toString("hex")}`;
  const admin = new pg.default.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();

  const client = new pg.default.Client({ connectionString: databaseUrlWithName(url, dbName) });
  await client.connect();
  await applyMigrations((text) => client.query(text));
  await client.query(ROLE_SQL);

  const sql = toSql(async <T>(text: string, params: unknown[] = []) => {
    const res = await client.query(text, params);
    return res.rows as T[];
  });
  async function bypass() {
    await client.query("reset role");
    await client.query("select set_config('app.bypass_rls', $1, false)", ["on"]);
    await client.query("select set_config('app.tenant_id', $1, false)", [""]);
  }
  async function asRole(tenantId: string) {
    await client.query("select set_config('app.bypass_rls', $1, false)", ["off"]);
    await client.query("select set_config('app.tenant_id', $1, false)", [tenantId]);
    await client.query("set role gridline");
  }
  await bypass();
  return {
    sql,
    bypass,
    asRole,
    close: async () => {
      await client.end();
      const drop = new pg.default.Client({ connectionString: url });
      await drop.connect();
      await drop.query(`drop database if exists ${dbName} with (force)`);
      await drop.end();
    },
  };
}

export async function openTestDb(): Promise<TestDb> {
  process.env.APP_SECRET ||= "test-secret-not-for-production";
  const url = process.env.DATABASE_URL?.trim();
  if (url && process.env.GRIDLINE_TEST_PG === "1") return openPostgres(url);
  return openPglite();
}
