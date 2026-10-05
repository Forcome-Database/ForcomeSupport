import {
  auditLogOptionsSchema,
  auditLogSchema,
  EXPORT_ROWS_HEADER,
  emptyRegistrationInput,
  ledgerItemSchema,
  type AuditLog,
  type AuditLogEntry,
  type LedgerItem,
  type RegistrationInput,
} from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiClient } from './api-client';
import { startTestHarness, type TestHarness } from './harness';

/*
 * P27 审计日志（待办 30；PRD P27、10.2、K18、K5、E-24、AC-P1-20）：以各角色身份调 /api/audit，
 * 核对查看范围（全部 / 只看自己、店铺范围）、财务字段「已隐藏」、越权访问被拒、筛选、分页与导出。
 * 审计记录都由真实操作写入（登录、新建登记、设为已完成、台账导出、越权访问），演示时刻 2026-09-11 10:20。
 */

const fixture = getDemoFixture();
const storeNamed = (name: string) => fixture.stores.find((s) => s.name === name)!;
const DIRECT = storeNamed('Forcome Direct');
const COM = storeNamed('forcome.com');
const memberKeyed = (key: string) => fixture.members.find((m) => m.key === key)!;
const LITING = memberKeyed('liting');
const WANG = memberKeyed('wanglei');

/** 一张寄配件单（产品成本 $3.20、运费 $6.80，三组均 FSH 0 / 工厂 100） */
function shippedParts(storeId: string, customerName: string): RegistrationInput {
  return {
    ...emptyRegistrationInput(),
    method: 'send_parts',
    storeId,
    site: 'US',
    orderNumber: '#1063',
    customerName,
    feeDate: '2026-09-11',
    ownerId: WANG.id,
    responsibility: 'product_quality',
    factory: 'FQD',
    ratios: {
      product: { fsh: 0, factory: 100 },
      freight: { fsh: 0, factory: 100 },
      other: { fsh: 0, factory: 100 },
    },
    partSku: 'FC-V2-HF01',
    partQuantity: 1,
    shipper: 'yicang',
    carrier: 'UPS Ground',
    shipDate: '2026-09-11',
    trackingNumber: '1Z4R28830358229999',
    fees: {
      productCost: { amount: '3.20', currency: 'USD' },
      freight: { amount: '6.80', currency: 'USD' },
      compensation: { amount: '0.00', currency: 'USD' },
      otherCost: { amount: '0.00', currency: 'USD' },
    },
  };
}

async function register(client: ApiClient, input: RegistrationInput): Promise<LedgerItem> {
  const res = await client.post('/api/aftersales/registrations', input);
  expect(res.status, await res.clone().text()).toBe(201);
  return ledgerItemSchema.parse(await res.json());
}

async function complete(client: ApiClient, item: LedgerItem): Promise<LedgerItem> {
  const res = await client.post(`/api/aftersales/${item.number}/complete`, {
    version: item.version,
  });
  expect(res.status, await res.clone().text()).toBe(200);
  return ledgerItemSchema.parse(await res.json());
}

async function auditLog(client: ApiClient, query = ''): Promise<AuditLog> {
  const res = await client.get(`/api/audit${query}`);
  expect(res.status, await res.clone().text()).toBe(200);
  return auditLogSchema.parse(await res.json());
}

/** 一条记录展开里某个字段 */
const fieldOf = (entry: AuditLogEntry | undefined, label: string) =>
  entry?.fields.find((field) => field.label === label);

/** 导出：返回文件名、行数头与表格（第一行是表头） */
async function exportAudit(client: ApiClient, query = '') {
  const res = await client.get(`/api/audit/export${query}`);
  expect(res.status, res.status === 200 ? '' : await res.clone().text()).toBe(200);
  const disposition = res.headers.get('content-disposition') ?? '';
  const fileName = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1] ?? '');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await res.arrayBuffer());
  const rows: unknown[][] = [];
  workbook.worksheets[0]!.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
  return { fileName, count: res.headers.get(EXPORT_ROWS_HEADER), header: rows[0], rows };
}

describe('P27 审计日志', () => {
  let t: TestHarness;
  let agent: ApiClient;
  let owner: ApiClient;
  let admin: ApiClient;
  let supervisor: ApiClient;
  /** 王磊在 forcome.com 新建并设为已完成的单 */
  let comItem: LedgerItem;
  /** 王磊在 Forcome Direct 新建的单 */
  let directItem: LedgerItem;
  /** 只授权 Forcome Direct 的客服主管 */
  let limitedSupervisor: ApiClient;
  let limitedSupervisorId: string;
  let knowledge: ApiClient;
  /** 兼任坐席的生产厂对接人 */
  let factoryAgent: ApiClient;
  let factoryAgentId: string;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    agent = await t.loginAs({ member: 'liting' }, { ip: '10.20.3.27' });
    owner = await t.loginAs({ member: 'wanglei' }, { ip: '10.20.2.18' });
    admin = await t.loginAs({ member: 'liuyang' }, { ip: '10.20.1.12' });
    supervisor = await t.loginAs({ member: 'zhoumin' }, { ip: '10.20.1.30' });
    knowledge = await t.loginAs({ member: 'zhaoqian' });
    factoryAgentId = await t.addMember({
      name: '钱工',
      dept: 'FQD / 品质部',
      roles: ['factory_contact', 'agent'],
      allStores: true,
    });
    factoryAgent = await t.loginAs({ memberId: factoryAgentId });

    t.clock.advance({ minutes: 1 });
    comItem = await register(owner, shippedParts(COM.id, 'Olivia Turner'));
    t.clock.advance({ minutes: 1 });
    comItem = await complete(owner, comItem);
    t.clock.advance({ minutes: 1 });
    directItem = await register(owner, shippedParts(DIRECT.id, 'Sarah Mitchell'));
    t.clock.advance({ minutes: 1 });
    // 坐席导出台账（跨店铺，审计的店铺为空）
    expect((await agent.get('/api/aftersales/ledger/export')).status).toBe(200);

    limitedSupervisorId = await t.addMember({
      name: '吴倩',
      dept: 'FSH / 客服部',
      roles: ['supervisor'],
      allStores: false,
      storeIds: [DIRECT.id],
    });
    t.clock.advance({ minutes: 1 });
    limitedSupervisor = await t.loginAs({ memberId: limitedSupervisorId }, { ip: '10.20.1.40' });
    // 越权（E-24）：只授权 Forcome Direct 的客服主管按 forcome.com 筛台账
    t.clock.advance({ minutes: 1 });
    expect((await limitedSupervisor.get(`/api/aftersales/ledger?store=${COM.id}`)).status).toBe(
      403,
    );
  });

  afterAll(async () => {
    await t.close();
  });

  describe('查看范围（10.2、AC-P1-20）', () => {
    it('坐席只看到自己的操作记录，操作人锁定为本人（带别人的操作人筛选也只有自己的）', async () => {
      const log = await auditLog(agent);
      expect(log.scope).toBe('own');
      expect(log.entries.length).toBeGreaterThan(0);
      expect(log.entries.every((entry) => entry.actor.id === LITING.id)).toBe(true);
      expect(log.entries.map((entry) => entry.actionLabel)).toEqual(['导出 Excel', '登录']);
      const login = log.entries.find((entry) => entry.action === 'auth.login');
      expect(login).toMatchObject({
        actor: { name: '李婷', roleText: '坐席' },
        objectType: 'login',
        objectLabel: '开发登录',
        summary: '会话有效期 7 天（无操作）',
        ip: '10.20.3.27',
      });

      const tried = await auditLog(agent, `?actor=${WANG.id}`);
      expect(tried.entries.every((entry) => entry.actor.id === LITING.id)).toBe(true);
      expect(tried.total).toBe(log.total);

      const options = auditLogOptionsSchema.parse(
        await (await agent.get('/api/audit/options')).json(),
      );
      expect(options.actors).toEqual([{ value: LITING.id, label: '李婷' }]);
    });

    it('售后负责人、知识库负责人同样只看自己的', async () => {
      const own = await auditLog(owner);
      expect(own.scope).toBe('own');
      expect(new Set(own.entries.map((entry) => entry.actor.name))).toEqual(new Set(['王磊']));
      const log = await auditLog(knowledge);
      expect(log.scope).toBe('own');
      expect(log.entries.map((entry) => entry.actor.name)).toEqual(['赵倩']);
    });

    it('管理员看到全部，售后单的成本与承担比例前后值为「已隐藏」，其他字段照常（AC-P1-20、K18 ②）', async () => {
      const log = await auditLog(admin);
      expect(log.scope).toBe('all');
      expect(log.financeVisible).toBe(false);
      expect(new Set(log.entries.map((entry) => entry.actor.name))).toEqual(
        new Set(['李婷', '王磊', '刘洋', '周敏', '赵倩', '钱工', '吴倩']),
      );
      const completed = log.entries.find(
        (entry) => entry.action === 'aftersales.complete' && entry.objectLabel === comItem.number,
      );
      expect(completed).toMatchObject({
        actor: { name: '王磊', roleText: '售后负责人' },
        objectType: 'aftersales',
        actionLabel: '设为已完成',
        summary: '状态：进行中 → 已完成',
        more: 2,
        ip: '10.20.2.18',
      });
      for (const label of ['产品成本', '运费', '额外赔偿', '其他', '承担比例']) {
        expect(fieldOf(completed, label), label).toMatchObject({
          before: null,
          after: null,
          hidden: true,
          finance: true,
        });
      }
      expect(fieldOf(completed, '状态')).toMatchObject({ before: '进行中', after: '已完成' });
      expect(fieldOf(completed, '店铺')).toMatchObject({ after: 'forcome.com' });
      expect(fieldOf(completed, '快递单号')?.after).toBe('1Z4R28830358229999');
      // 接口输出里不带任何金额与比例
      const created = log.entries.find(
        (entry) => entry.action === 'aftersales.create' && entry.objectLabel === comItem.number,
      );
      expect(JSON.stringify([completed, created])).not.toMatch(/3\.20|6\.80|工厂 100/);
    });

    it('客服主管看到全部，财务字段照常显示', async () => {
      const log = await auditLog(supervisor);
      expect(log).toMatchObject({ scope: 'all', financeVisible: true });
      const completed = log.entries.find(
        (entry) => entry.action === 'aftersales.complete' && entry.objectLabel === comItem.number,
      );
      expect(fieldOf(completed, '产品成本')).toMatchObject({
        before: '$3.20',
        after: '$3.20',
        hidden: false,
        finance: true,
      });
      expect(fieldOf(completed, '承担比例')?.after).toBe('三组均 FSH 0 / 工厂 100');
    });

    it('店铺范围受限的客服主管只看到授权店铺的对象记录与没有店铺属性的记录（10.2、D-27）', async () => {
      const log = await auditLog(limitedSupervisor);
      expect(log.scope).toBe('all');
      const labels = log.entries.map((entry) => entry.objectLabel);
      // Forcome Direct 的单看得到，forcome.com 的单看不到
      expect(labels).toContain(directItem.number);
      expect(labels).not.toContain(comItem.number);
      // 没有店铺属性的记录：别人的登录、跨店铺的台账导出
      expect(
        log.entries.some((entry) => entry.action === 'auth.login' && entry.actor.name === '李婷'),
      ).toBe(true);
      expect(log.entries.some((entry) => entry.action === 'ledger.export')).toBe(true);
      // 自己在 forcome.com 的越权记录属于 forcome.com，同样不在范围内
      expect(log.entries.some((entry) => entry.denied)).toBe(false);
    });

    it('生产厂对接人没有这项权限（只有该角色的第一期登录即被拒）；兼任坐席的按坐席只看自己的', async () => {
      const log = await auditLog(factoryAgent);
      expect(log.scope).toBe('own');
      expect(log.entries.map((entry) => entry.actor.id)).toEqual([factoryAgentId]);
    });
  });

  describe('越权访问被拒（E-24）', () => {
    it('记为「越权访问被拒」并标出，对象写店铺名；可按动作筛选，页头计数', async () => {
      const log = await auditLog(supervisor);
      expect(log.denied).toBe(1);
      const denied = log.entries.find((entry) => entry.denied);
      expect(denied).toMatchObject({
        actor: { name: '吴倩', roleText: '客服主管' },
        objectType: 'store',
        objectLabel: 'forcome.com',
        action: 'access.denied',
        actionLabel: '越权访问被拒',
        summary: '店铺 forcome.com 不在授权范围内（R-ST-06）',
        ip: '10.20.1.40',
      });
      expect(fieldOf(denied, '请求地址')?.after).toBe('/api/aftersales/ledger');

      const filtered = await auditLog(supervisor, `?action=${encodeURIComponent('越权访问被拒')}`);
      expect(filtered.total).toBe(1);
      expect(filtered.entries.map((entry) => entry.action)).toEqual(['access.denied']);
      expect(filtered.denied).toBe(1);
    });
  });

  describe('筛选与分页', () => {
    it('按操作人（成员或系统）、对象类型、动作、对象编号搜索', async () => {
      const byWang = await auditLog(supervisor, `?actor=${WANG.id}`);
      expect(new Set(byWang.entries.map((entry) => entry.actor.name))).toEqual(new Set(['王磊']));
      expect((await auditLog(supervisor, '?actor=system')).total).toBe(0);

      const aftersales = await auditLog(supervisor, '?type=aftersales');
      expect(aftersales.entries.map((entry) => entry.actionLabel)).toEqual([
        '新建登记',
        '设为已完成',
        '新建登记',
      ]);
      const logins = await auditLog(supervisor, `?type=login&action=${encodeURIComponent('登录')}`);
      expect(logins.entries.every((entry) => entry.action === 'auth.login')).toBe(true);
      expect(logins.total).toBe(7);

      const searched = await auditLog(
        supervisor,
        `?q=${encodeURIComponent(comItem.number.toLowerCase())}`,
      );
      expect(searched.entries.map((entry) => entry.actionLabel)).toEqual([
        '设为已完成',
        '新建登记',
      ]);
      // 通配符按字面匹配
      expect((await auditLog(supervisor, `?q=${encodeURIComponent('%')}`)).total).toBe(0);
    });

    it('时间：默认今天；近 7 天含今天；自定义按北京时间的日界（含两端）', async () => {
      const today = await auditLog(supervisor);
      expect(today.range).toEqual({ period: 'today', from: '2026-09-11', to: '2026-09-11' });
      const week = await auditLog(supervisor, '?period=week');
      expect(week.range).toEqual({ period: 'week', from: '2026-09-05', to: '2026-09-11' });
      expect(week.total).toBe(today.total);
      expect(
        (await auditLog(supervisor, '?period=custom&from=2026-09-01&to=2026-09-10')).total,
      ).toBe(0);

      // 次日 00:30（北京时间）：今天是空的，昨天的在近 7 天里
      t.clock.set('2026-09-11T16:30:00Z');
      try {
        const next = await auditLog(supervisor);
        expect(next.range.from).toBe('2026-09-12');
        expect(next.total).toBe(0);
        expect((await auditLog(supervisor, '?period=week')).total).toBe(today.total);
        expect(
          (await auditLog(supervisor, '?period=custom&from=2026-09-11&to=2026-09-11')).total,
        ).toBe(today.total);
      } finally {
        t.clock.set('2026-09-11T02:30:00Z');
      }
    });

    it('每页 10 条，时间倒序；页码超出时给最后一页', async () => {
      const first = await auditLog(supervisor);
      expect(first.pageSize).toBe(10);
      expect(first.total).toBeGreaterThan(10);
      expect(first.entries).toHaveLength(10);
      const times = first.entries.map((entry) => entry.at);
      expect([...times].sort().reverse()).toEqual(times);
      const second = await auditLog(supervisor, '?page=2');
      expect(second.page).toBe(2);
      expect(second.entries).toHaveLength(first.total - 10);
      expect(second.entries.map((e) => e.id)).not.toContain(first.entries[0]!.id);
      expect((await auditLog(supervisor, '?page=9')).page).toBe(2);
    });

    it('操作人选项：系统与全部成员（看全部的角色）', async () => {
      const options = auditLogOptionsSchema.parse(
        await (await supervisor.get('/api/audit/options')).json(),
      );
      expect(options.actors[0]).toEqual({ value: 'system', label: '系统' });
      expect(options.actors.map((actor) => actor.label)).toEqual(
        expect.arrayContaining(['李婷', '周敏', '王磊', '刘洋', '吴倩', '陈工']),
      );
    });

    it('筛选条件写错返回 400', async () => {
      expect((await supervisor.get('/api/audit?period=month')).status).toBe(400);
      expect((await supervisor.get('/api/audit?type=invoice')).status).toBe(400);
      expect((await supervisor.get('/api/audit?from=09-01')).status).toBe(400);
    });
  });

  describe('导出（K5）', () => {
    it('按当前筛选导出全部条数（不分页），文件名照 K5 写法；导出本身写一条审计', async () => {
      const before = (await auditLog(supervisor)).total;
      const file = await exportAudit(supervisor);
      expect(file.fileName).toBe('审计日志_今天_0911.xlsx');
      expect(file.count).toBe(String(before));
      expect(file.header).toEqual([
        '时间',
        '操作人',
        '角色',
        '对象类型',
        '对象',
        '动作',
        '变更摘要',
        '来源 IP',
        '变更前',
        '变更后',
      ]);
      expect(file.rows).toHaveLength(before + 1);
      const completedRow = file.rows.find(
        (row) => row[4] === comItem.number && row[5] === '设为已完成',
      );
      expect(completedRow?.slice(1, 8)).toEqual([
        '王磊',
        '售后负责人',
        '售后单',
        comItem.number,
        '设为已完成',
        '状态：进行中 → 已完成 等 2 项',
        '10.20.2.18',
      ]);
      expect(String(completedRow?.[9])).toContain('产品成本：$3.20');

      const log = await auditLog(supervisor);
      expect(log.total).toBe(before + 1);
      expect(log.entries[0]).toMatchObject({
        action: 'audit.export',
        actor: { name: '周敏' },
        objectType: 'export',
        objectLabel: '审计日志',
        actionLabel: '导出 Excel',
        summary: `筛选：今天（2026-09-11） · ${before} 行`,
      });
    });

    it('导出同样按查看范围与字段权限：管理员的文件里财务字段写「已隐藏」，坐席只有自己的', async () => {
      const file = await exportAudit(admin, `?q=${encodeURIComponent(comItem.number)}&period=week`);
      expect(file.fileName).toBe('审计日志_近7天_0905-0911.xlsx');
      expect(file.rows).toHaveLength(3);
      const after = file.rows.map((row) => String(row[9])).join('\n');
      expect(after).toContain('产品成本：已隐藏');
      expect(after).not.toMatch(/3\.20|工厂 100/);

      const own = await exportAudit(agent, '?period=custom&from=2026-09-01&to=2026-09-11');
      expect(own.fileName).toBe('审计日志_0901-0911.xlsx');
      expect(own.rows.slice(1).every((row) => row[1] === '李婷')).toBe(true);
      const [record] = (await t.auditRecords({ action: 'audit.export' })).filter(
        (r) => r.actorName === '李婷',
      );
      expect(record).toMatchObject({
        objectType: 'export',
        objectLabel: '审计日志',
        storeId: null,
        after: {
          fileName: '审计日志_0901-0911.xlsx',
          filters: { period: 'custom', from: '2026-09-01', to: '2026-09-11' },
          rows: own.rows.length - 1,
        },
      });
    });
  });
});
