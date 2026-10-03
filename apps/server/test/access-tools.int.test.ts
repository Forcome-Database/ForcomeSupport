import { financeField, stripFinanceFields } from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { OpenAPIHono } from '@hono/zod-openapi';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ServerDeps } from '../src/deps';
import { isStoreInScope } from '../src/modules/core';
import { requireCapability, requireSession, type AccessVariables } from '../src/modules/org';
import { startTestHarness, TEST_CLIENT_IP, type TestHarness } from './harness';

/*
 * 访问控制的公共工具（待办 04）：店铺数据范围、越权访问审计（E-24）、能力校验、财务字段过滤。
 * 这些工具的业务使用者（工单、台账、报表、审计日志）随后续待办出现；这里用测试里定义的示范接口当第一个使用者，
 * 经主接缝验证它们——真实会话、真实数据库与审计，接口的写法就是后续各模块的样板：
 *   requireSession → requireCapability → access.requireStores（越权即审计并 403）→ 仓储查询带 access.stores
 *   → 输出前 stripFinanceFields(结构, 值, access.financeVisible)。
 */

const stores = getDemoFixture().stores;
const storeId = (name: string) => stores.find((s) => s.name === name)!.id;
const DIRECT = storeId('Forcome Direct');
const MX = storeId('forcome.mx');

// 示范的台账行：成本、承担比例、承担金额是财务字段（真正的台账结构随 19 号待办）
const ratio = z.object({ fsh: z.int(), factory: z.int() });
const demoLedgerRow = z.object({
  no: z.string(),
  storeId: z.uuid(),
  customer: z.string(),
  productCost: financeField(z.string()),
  freight: financeField(z.string()),
  ratios: financeField(z.object({ product: ratio, freight: ratio, other: ratio })),
  fshShare: financeField(z.string()),
  factoryShare: financeField(z.string()),
});
const demoLedger = z.object({ rows: z.array(demoLedgerRow) });

const RATIOS = {
  product: { fsh: 0, factory: 100 },
  freight: { fsh: 0, factory: 100 },
  other: { fsh: 100, factory: 0 },
};
const ROWS: z.output<typeof demoLedgerRow>[] = [
  {
    no: 'S-20260903-0012',
    storeId: DIRECT,
    customer: 'Mateo Rivas',
    productCost: '9.80',
    freight: '13.60',
    ratios: RATIOS,
    fshShare: '0.00',
    factoryShare: '23.40',
  },
  {
    no: 'S-20260911-0020',
    storeId: MX,
    customer: 'Mateo Rivas',
    productCost: '0.00',
    freight: '0.00',
    ratios: RATIOS,
    fshShare: '0.00',
    factoryShare: '49.39',
  },
];

function demoRoutes({ runtime, config }: ServerDeps) {
  const routes = new OpenAPIHono<{ Variables: AccessVariables }>();
  routes.use('/api/test/*', requireSession(runtime, config.appEnv));

  // 示范列表接口：store 参数是页面上的店铺筛选（只能在授权范围内收窄）
  routes.get('/api/test/ledger', requireCapability('aftersales.view'), async (c) => {
    const access = c.get('access');
    const store = c.req.query('store');
    if (store) {
      await access.requireStores({ storeIds: [store], objectType: 'store', objectId: store });
    }
    // 真正的仓储查询把 access.stores 交给 storeScopeCondition；示范数据在内存里，用同一套判断
    const rows = ROWS.filter(
      (row) => isStoreInScope(access.stores, row.storeId) && (!store || row.storeId === store),
    );
    return c.json(stripFinanceFields(demoLedger, { rows }, access.financeVisible));
  });

  // 示范报表接口：所有能看报表的角色都能调，售后成本是财务字段
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

describe('店铺数据范围与越权访问（R-ST-06、E-24）', () => {
  it('当前成员带授权店铺；列表只返回授权店铺的数据', async () => {
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
    const before = (await t.auditRecords({ action: 'access.denied' })).length;

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

  it('授权范围内的店铺筛选照常返回、不记审计；全部店铺的成员访问任何店铺都可以', async () => {
    const limited = await t.loginAs({ memberId: await directOnlySupervisor() });
    const everyStore = await t.loginAs('客服主管');
    const before = (await t.auditRecords({ action: 'access.denied' })).length;

    expect((await limited.get(`/api/test/ledger?store=${DIRECT}`)).status).toBe(200);
    const mx = await everyStore.get(`/api/test/ledger?store=${MX}`);
    expect(mx.status).toBe(200);
    expect(((await mx.json()) as { rows: unknown[] }).rows).toHaveLength(1);
    expect(await t.auditRecords({ action: 'access.denied' })).toHaveLength(before);
  });

  it('没有这项能力的接口返回 403（管理员看不了台账）', async () => {
    const admin = await t.loginAs('管理员');
    const res = await admin.get('/api/test/ledger');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', message: '你的角色没有这项权限' });
  });
});

describe('财务字段过滤（PRD 10.3：成本、承担比例、承担金额只对客服主管、售后负责人返回）', () => {
  const FINANCE = ['productCost', 'freight', 'ratios', 'fshShare', 'factoryShare'];

  it.each([
    ['客服主管', true],
    ['售后负责人', true],
    ['坐席', false],
  ])('台账：%s 看得到财务字段：%s', async (role, visible) => {
    const client = await t.loginAs(role);
    const { rows } = (await (await client.get('/api/test/ledger')).json()) as {
      rows: Record<string, unknown>[];
    };
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({ no: expect.any(String) as string, customer: 'Mateo Rivas' });
      for (const field of FINANCE) expect(field in row).toBe(visible);
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
