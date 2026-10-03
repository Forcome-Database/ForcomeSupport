import { financeField, stripFinanceFields } from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { OpenAPIHono } from '@hono/zod-openapi';
import { and, asc, eq, sql } from 'drizzle-orm';
import { integer, pgSchema, text, uuid } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ServerDeps } from '../src/deps';
import {
  storeScopeCondition,
  SYSTEM_STORE_SCOPE,
  type DbExecutor,
  type StoreScope,
} from '../src/modules/core';
import { requireCapability, requireSession, type AccessVariables } from '../src/modules/org';
import { startTestHarness, TEST_CLIENT_IP, type TestHarness } from './harness';

/*
 * 访问控制的公共工具（待办 04）：店铺数据范围、越权访问审计（E-24）、能力校验、财务字段过滤。
 * 这些工具的业务使用者（工单、台账、报表、审计日志）随后续待办出现；这里用测试里定义的示范仓储与示范接口当第一个使用者，
 * 经主接缝验证它们——真实会话、真实数据库与审计。写法就是后续各模块的样板：
 * - 列表：requireSession → requireCapability → 页面的店铺筛选先 access.requireStores（越权即审计并 403）
 *   → 仓储查询带 access.stores（storeScopeCondition）→ 输出前 stripFinanceFields(结构, 值, access.financeVisible)；
 * - 详情：先按编号取出对象（只为判断归属，用 SYSTEM_STORE_SCOPE）→ access.requireStores(对象的店铺) → 输出。
 */

const stores = getDemoFixture().stores;
const storeId = (name: string) => stores.find((s) => s.name === name)!.id;
const DIRECT = storeId('Forcome Direct');
const MX = storeId('forcome.mx');

// 示范的台账表与仓储（真正的台账随 19 号待办）：店铺范围是必需参数
const demo = pgSchema('demo');
const demoLedger = demo.table('ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  no: text('no').notNull(),
  storeId: uuid('store_id').notNull(),
  customer: text('customer').notNull(),
  productCostCents: integer('product_cost_cents').notNull(),
  factoryShareCents: integer('factory_share_cents').notNull(),
});

async function listLedger(db: DbExecutor, scope: StoreScope, store?: string) {
  return db
    .select()
    .from(demoLedger)
    .where(
      and(
        storeScopeCondition(scope, demoLedger.storeId),
        store ? eq(demoLedger.storeId, store) : undefined,
      ),
    )
    .orderBy(asc(demoLedger.no));
}

async function findLedger(db: DbExecutor, scope: StoreScope, no: string) {
  const [row] = await db
    .select()
    .from(demoLedger)
    .where(and(storeScopeCondition(scope, demoLedger.storeId), eq(demoLedger.no, no)));
  return row ?? null;
}

// 示范的输出结构：成本、承担比例、承担金额是财务字段
const ratio = z.object({ fsh: z.int(), factory: z.int() });
const ledgerRowSchema = z.object({
  no: z.string(),
  storeId: z.uuid(),
  customer: z.string(),
  productCost: financeField(z.string()),
  ratios: financeField(z.object({ product: ratio, freight: ratio, other: ratio })),
  factoryShare: financeField(z.string()),
});
const ledgerSchema = z.object({ rows: z.array(ledgerRowSchema) });
const RATIOS = {
  product: { fsh: 0, factory: 100 },
  freight: { fsh: 0, factory: 100 },
  other: { fsh: 100, factory: 0 },
};
const usd = (cents: number) => (cents / 100).toFixed(2);

function toOutput(row: typeof demoLedger.$inferSelect): z.output<typeof ledgerRowSchema> {
  return {
    no: row.no,
    storeId: row.storeId,
    customer: row.customer,
    productCost: usd(row.productCostCents),
    ratios: RATIOS,
    factoryShare: usd(row.factoryShareCents),
  };
}

function demoRoutes({ runtime, config }: ServerDeps) {
  const routes = new OpenAPIHono<{ Variables: AccessVariables }>();
  routes.use('/api/test/*', requireSession(runtime, config.appEnv));

  // 示范列表：store 参数是页面上的店铺筛选（只能在授权范围内收窄）
  routes.get('/api/test/ledger', requireCapability('aftersales.view'), async (c) => {
    const access = c.get('access');
    const store = c.req.query('store');
    if (store) {
      await access.requireStores({ storeIds: [store], objectType: 'store', objectId: store });
    }
    const rows = await listLedger(runtime.db, access.stores, store);
    return c.json(
      stripFinanceFields(ledgerSchema, { rows: rows.map(toOutput) }, access.financeVisible),
    );
  });

  // 示范详情：先取出对象判断归属，范围外的记审计并 403
  routes.get('/api/test/ledger/:no', requireCapability('aftersales.view'), async (c) => {
    const access = c.get('access');
    const row = await findLedger(runtime.db, SYSTEM_STORE_SCOPE, c.req.param('no'));
    if (!row) return c.json({ error: 'not_found', message: '售后单不存在' }, 404);
    await access.requireStores({
      storeIds: [row.storeId],
      objectType: 'aftersales',
      objectId: row.id,
      objectLabel: row.no,
    });
    return c.json(stripFinanceFields(ledgerRowSchema, toOutput(row), access.financeVisible));
  });

  // 示范报表：所有能看报表的角色都能调，售后成本是财务字段
  routes.get('/api/test/report', requireCapability('report.view'), (c) =>
    c.json(
      stripFinanceFields(
        z.object({ tickets: z.int(), aftersalesCost: financeField(z.string()) }),
        { tickets: 73, aftersalesCost: '188.79' },
        c.get('access').financeVisible,
      ),
    ),
  );
  return routes;
}

let t: TestHarness;

beforeAll(async () => {
  t = await startTestHarness({ routes: demoRoutes });
  await t.runtime.db.execute(sql`
    CREATE SCHEMA demo;
    CREATE TABLE demo.ledger (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      no text NOT NULL,
      store_id uuid NOT NULL,
      customer text NOT NULL,
      product_cost_cents integer NOT NULL,
      factory_share_cents integer NOT NULL
    )`);
  await t.runtime.db.insert(demoLedger).values([
    {
      no: 'S-20260903-0012',
      storeId: DIRECT,
      customer: 'Mateo Rivas',
      productCostCents: 980,
      factoryShareCents: 2340,
    },
    {
      no: 'S-20260911-0020',
      storeId: MX,
      customer: 'Mateo Rivas',
      productCostCents: 0,
      factoryShareCents: 4939,
    },
  ]);
});

afterAll(async () => {
  await t.close();
});

async function directOnlySupervisor(): Promise<string> {
  return t.addMember({
    name: '范围受限的主管',
    dept: 'FSH / 客服部',
    roles: ['supervisor'],
    allStores: false,
    storeIds: [DIRECT],
  });
}

const deniedCount = async () => (await t.auditRecords({ action: 'access.denied' })).length;

describe('店铺数据范围与越权访问（R-ST-06、E-24）', () => {
  it('当前成员带授权店铺；列表只返回授权店铺的数据（仓储查询带范围）', async () => {
    const supervisor = await t.loginAs({ memberId: await directOnlySupervisor() });

    expect(await (await supervisor.get('/api/me')).json()).toMatchObject({
      stores: { all: false, storeIds: [DIRECT] },
    });
    const res = await supervisor.get('/api/test/ledger');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { no: string }[] };
    expect(body.rows.map((r) => r.no)).toEqual(['S-20260903-0012']);
  });

  it('带越权店铺 ID 的请求被拒绝（403），并写一条「越权访问被拒」审计', async () => {
    t.clock.set('2026-09-11T00:31:00Z');
    const supervisor = await t.loginAs({ memberId: await directOnlySupervisor() });
    const before = await deniedCount();

    const res = await supervisor.get(`/api/test/ledger?store=${MX}`);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'forbidden',
      message: '这条数据不在你的店铺范围内',
    });
    const denied = await t.auditRecords({ action: 'access.denied' });
    expect(denied).toHaveLength(before + 1);
    expect(denied.at(-1)).toMatchObject({
      occurredAt: new Date('2026-09-11T00:31:00Z'),
      actorType: 'member',
      actorName: '范围受限的主管',
      actorRoles: ['supervisor'],
      ip: TEST_CLIENT_IP,
      objectType: 'store',
      objectId: MX,
      storeId: MX,
      after: { reason: 'store_scope', storeIds: [MX], method: 'GET', path: '/api/test/ledger' },
    });
  });

  it('打开范围外店铺的单据详情：403，审计记下是哪张单', async () => {
    t.clock.set('2026-09-11T00:32:00Z');
    const supervisor = await t.loginAs({ memberId: await directOnlySupervisor() });

    expect((await supervisor.get('/api/test/ledger/S-20260903-0012')).status).toBe(200);
    const res = await supervisor.get('/api/test/ledger/S-20260911-0020');

    expect(res.status).toBe(403);
    expect((await t.auditRecords({ action: 'access.denied' })).at(-1)).toMatchObject({
      occurredAt: new Date('2026-09-11T00:32:00Z'),
      objectType: 'aftersales',
      objectLabel: 'S-20260911-0020',
      storeId: MX,
      after: { path: '/api/test/ledger/S-20260911-0020' },
    });
  });

  it('授权范围内的访问照常返回、不记审计；全部店铺的成员访问任何店铺都可以', async () => {
    const limited = await t.loginAs({ memberId: await directOnlySupervisor() });
    const everyStore = await t.loginAs('客服主管');
    const before = await deniedCount();

    expect((await limited.get(`/api/test/ledger?store=${DIRECT}`)).status).toBe(200);
    const mx = await everyStore.get(`/api/test/ledger?store=${MX}`);
    expect(mx.status).toBe(200);
    expect(((await mx.json()) as { rows: unknown[] }).rows).toHaveLength(1);
    expect((await everyStore.get('/api/test/ledger/S-20260911-0020')).status).toBe(200);
    expect(await deniedCount()).toBe(before);
  });

  it('没有这项能力的接口返回 403，不记审计（管理员看不了台账）', async () => {
    const admin = await t.loginAs('管理员');
    const before = await deniedCount();
    const res = await admin.get('/api/test/ledger');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', message: '你的角色没有这项权限' });
    expect(await deniedCount()).toBe(before);
  });
});

describe('财务字段过滤（PRD 10.3：成本、承担比例、承担金额只对客服主管、售后负责人返回）', () => {
  const FINANCE = ['productCost', 'ratios', 'factoryShare'];

  async function ledgerRows(login: Parameters<TestHarness['loginAs']>[0]) {
    const client = await t.loginAs(login);
    const { rows } = (await (await client.get('/api/test/ledger')).json()) as {
      rows: Record<string, unknown>[];
    };
    const detail = (await (await client.get('/api/test/ledger/S-20260903-0012')).json()) as Record<
      string,
      unknown
    >;
    return [...rows, detail];
  }

  it.each([
    ['客服主管', true],
    ['售后负责人', true],
    ['坐席', false],
  ])('台账列表与详情：%s 看得到财务字段：%s', async (role, visible) => {
    const rows = await ledgerRows(role);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toMatchObject({ no: expect.any(String) as string, customer: 'Mateo Rivas' });
      for (const field of FINANCE) expect(field in row).toBe(visible);
    }
  });

  it('兼任坐席的生产厂对接人也看不到（「本厂部分」只在第二期的工厂工作台给）', async () => {
    const memberId = await t.addMember({
      name: '兼岗对接人',
      dept: 'FQD / 品质部',
      roles: ['agent', 'factory_contact'],
      allStores: true,
      factoryCode: 'FQD',
    });
    for (const row of await ledgerRows({ memberId })) {
      for (const field of FINANCE) expect(field in row).toBe(false);
    }
  });

  it.each([
    ['客服主管', true],
    ['售后负责人', true],
    ['知识库负责人', false],
    ['管理员', false],
  ])('报表聚合：%s 看得到售后成本：%s', async (role, visible) => {
    const client = await t.loginAs(role);
    const body = (await (await client.get('/api/test/report')).json()) as Record<string, unknown>;
    expect(body).toEqual(visible ? { tickets: 73, aftersalesCost: '188.79' } : { tickets: 73 });
  });
});
