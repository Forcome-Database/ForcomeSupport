import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jobDefinitions } from '../src/jobs';
import { MIGRATIONS_FOLDER, runMigrations } from '../src/migrations';
import { auditLog } from '../src/modules/core/schema';
import { silentLogger, transaction } from '../src/modules/core';
import { REPORT_READER_ROLE, runReportQuery } from '../src/modules/report';
import {
  createTestDatabase,
  createTestRuntime,
  type TestDatabase,
  type TestRuntime,
} from './database';

/** 后端模块目录名即 schema 名（ADR 0005、0006） */
const MODULES = readdirSync(new URL('../src/modules', import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

/** 数据约定的例外，每条写明原因 */
const TABLES_WITHOUT_UUID_ID = new Set([
  // 计数器按（编号种类，计数周期）唯一，不是业务实体
  'core.business_number_counter',
]);
const NUMERIC_COLUMNS_NOT_MONEY = new Set<string>([
  // 汇率 numeric(12,6)：1 USD = 汇率 原币（R-FL-06），不是金额
  'core.exchange_rate.rate',
  'aftersales.aftersales.product_cost_rate',
  'aftersales.aftersales.freight_rate',
  'aftersales.aftersales.compensation_rate',
  'aftersales.aftersales.other_cost_rate',
]);

let database: TestDatabase;
let t: TestRuntime;

beforeAll(async () => {
  database = await createTestDatabase();
  t = await createTestRuntime(database.url);
});

afterAll(async () => {
  await t.close();
  await database.drop();
});

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await t.runtime.db.execute(query);
  return result.rows as T[];
}

describe('migrate：只向前执行 drizzle-kit 生成的迁移', () => {
  it('迁移目录只有 drizzle-kit 日志登记过的 SQL，没有回滚脚本', () => {
    const journal = JSON.parse(
      readFileSync(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: { tag: string }[] };
    const sqlFiles = readdirSync(MIGRATIONS_FOLDER).filter((f) => f.endsWith('.sql'));
    expect(sqlFiles.sort()).toEqual(journal.entries.map((e) => `${e.tag}.sql`).sort());
  });

  it('全部迁移都已执行，重复执行是空操作', async () => {
    const journal = JSON.parse(
      readFileSync(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: unknown[] };
    const count = async () =>
      (
        await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`)
      )[0]?.n;

    expect(await count()).toBe(journal.entries.length);
    await runMigrations(database.url, jobDefinitions, silentLogger);
    expect(await count()).toBe(journal.entries.length);
  });

  it('每个模块一个 schema', async () => {
    const schemas = await rows<{ name: string }>(
      sql`SELECT nspname AS name FROM pg_namespace ORDER BY nspname`,
    );
    expect(MODULES.length).toBeGreaterThanOrEqual(12);
    expect(schemas.map((s) => s.name)).toEqual(expect.arrayContaining(MODULES));
  });

  it('pg-boss 的表也由 migrate 安装', async () => {
    expect(await t.runtime.boss.isInstalled()).toBe(true);
  });
});

describe('report 只读数据库角色（ADR 0005、0006）', () => {
  it('角色已创建且不能直接登录', async () => {
    const [role] = await rows<{ canLogin: boolean }>(
      sql`SELECT rolcanlogin AS "canLogin" FROM pg_roles WHERE rolname = ${REPORT_READER_ROLE}`,
    );
    expect(role).toEqual({ canLogin: false });
  });

  it('能读所有模块 schema 的每张表，不能写；读不到 pg-boss 与迁移记录', async () => {
    const privileges = await rows<{
      schema: string;
      table: string;
      select: boolean;
      write: boolean;
    }>(sql`
      SELECT n.nspname AS schema, c.relname AS table,
             has_table_privilege(${REPORT_READER_ROLE}, c.oid, 'SELECT') AS select,
             has_table_privilege(${REPORT_READER_ROLE}, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE') AS write
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'v', 'm', 'p')
        AND n.nspname IN ('pgboss', 'drizzle', ${sql.join(
          MODULES.map((m) => sql`${m}`),
          sql`, `,
        )})
    `);
    const moduleTables = privileges.filter((p) => MODULES.includes(p.schema));
    expect(moduleTables.length).toBeGreaterThan(0);
    for (const p of moduleTables) {
      expect({ table: `${p.schema}.${p.table}`, select: p.select, write: p.write }).toEqual({
        table: `${p.schema}.${p.table}`,
        select: true,
        write: false,
      });
    }
    const internal = privileges.filter((p) => !MODULES.includes(p.schema));
    expect(internal.length).toBeGreaterThan(0);
    expect(internal.filter((p) => p.select || p.write)).toEqual([]);
  });

  it('以后迁移新建的表自动可读', async () => {
    await t.runtime.db.execute(sql`CREATE TABLE ticket.__future_table (id uuid PRIMARY KEY)`);
    const [p] = await rows<{ select: boolean }>(
      sql`SELECT has_table_privilege(${REPORT_READER_ROLE}, 'ticket.__future_table', 'SELECT') AS select`,
    );
    await t.runtime.db.execute(sql`DROP TABLE ticket.__future_table`);
    expect(p).toEqual({ select: true });
  });

  it('runReportQuery 能读别的模块的表，写入被数据库拒绝', async () => {
    await transaction(t.runtime, (tx) =>
      tx.db.insert(auditLog).values({
        occurredAt: tx.now,
        actorType: 'system',
        actorName: '系统',
        action: 'store.create',
        objectType: 'store',
        objectId: 'store-for-report',
      }),
    );

    const read = await runReportQuery(t.runtime.db, (tx) =>
      tx.select({ objectId: auditLog.objectId }).from(auditLog),
    );
    expect(read).toContainEqual({ objectId: 'store-for-report' });

    await expect(
      runReportQuery(t.runtime.db, (tx) =>
        tx.execute(sql`DELETE FROM core.audit_log WHERE object_id = 'store-for-report'`),
      ),
    ).rejects.toThrow();
  });

  it('即使不在只读事务里，切到这个角色后写入也会因权限不足失败', async () => {
    await expect(
      t.runtime.db.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET LOCAL ROLE ${REPORT_READER_ROLE}`));
        await tx.execute(sql`DELETE FROM core.audit_log`);
      }),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });
});

describe('数据约定（规格「数据约定」、ADR 0006）', () => {
  type Column = {
    schema: string;
    table: string;
    column: string;
    type: string;
    precision: number | null;
    scale: number | null;
    default: string | null;
    nullable: 'YES' | 'NO';
  };

  async function moduleColumns(): Promise<Column[]> {
    return rows<Column>(sql`
      SELECT table_schema AS schema, table_name AS table, column_name AS column, data_type AS type,
             numeric_precision AS precision, numeric_scale AS scale, column_default AS default,
             is_nullable AS nullable
      FROM information_schema.columns
      WHERE table_schema IN (${sql.join(
        MODULES.map((m) => sql`${m}`),
        sql`, `,
      )})
      ORDER BY 1, 2, ordinal_position
    `);
  }

  it('时间列一律 timestamptz，JSON 列一律 jsonb', async () => {
    const offenders = (await moduleColumns()).filter((c) =>
      ['timestamp without time zone', 'time without time zone', 'json'].includes(c.type),
    );
    expect(offenders.map((c) => `${c.schema}.${c.table}.${c.column}: ${c.type}`)).toEqual([]);
  });

  it('金额列一律 numeric(12,2)', async () => {
    const offenders = (await moduleColumns()).filter(
      (c) =>
        c.type === 'numeric' &&
        !NUMERIC_COLUMNS_NOT_MONEY.has(`${c.schema}.${c.table}.${c.column}`) &&
        (c.precision !== 12 || c.scale !== 2),
    );
    expect(offenders.map((c) => `${c.schema}.${c.table}.${c.column}`)).toEqual([]);
  });

  it('有金额列的表必须有币种列（currency 或 *_currency）', async () => {
    const columns = await moduleColumns();
    const tablesWithMoney = new Set(
      columns
        .filter(
          (c) =>
            c.type === 'numeric' &&
            c.precision === 12 &&
            c.scale === 2 &&
            !NUMERIC_COLUMNS_NOT_MONEY.has(`${c.schema}.${c.table}.${c.column}`),
        )
        .map((c) => `${c.schema}.${c.table}`),
    );
    const offenders = [...tablesWithMoney].filter(
      (table) =>
        !columns.some(
          (c) =>
            `${c.schema}.${c.table}` === table &&
            (c.column === 'currency' || c.column.endsWith('_currency')),
        ),
    );
    expect(offenders).toEqual([]);
  });

  it('乐观锁的 version 列是非空整数、从 1 开始', async () => {
    const offenders = (await moduleColumns())
      .filter((c) => c.column === 'version')
      .filter((c) => c.type !== 'integer' || c.nullable !== 'NO' || c.default !== '1');
    expect(offenders.map((c) => `${c.schema}.${c.table}.version`)).toEqual([]);
  });

  it('主键是 UUIDv7 的 id 列（登记过的例外除外）', async () => {
    const columns = await moduleColumns();
    const tables = [...new Set(columns.map((c) => `${c.schema}.${c.table}`))];
    const pkColumns = await rows<{ table: string; column: string }>(sql`
      SELECT tc.table_schema || '.' || tc.table_name AS table, kcu.column_name AS column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
    `);
    for (const table of tables) {
      if (TABLES_WITHOUT_UUID_ID.has(table)) continue;
      const pk = pkColumns.filter((p) => p.table === table).map((p) => p.column);
      const id = columns.find((c) => `${c.schema}.${c.table}` === table && c.column === 'id');
      expect({ table, pk, type: id?.type, default: id?.default }).toEqual({
        table,
        pk: ['id'],
        type: 'uuid',
        default: 'uuidv7()',
      });
    }
  });
});
