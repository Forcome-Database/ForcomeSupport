import { describe, expect, it } from 'vitest';
import type { AuditSnapshot } from './audit';
import {
  auditNameIds,
  describeAuditRecord,
  type AuditNames,
  type AuditRecordInput,
} from './audit-describe';

const STORE_DIRECT = '01920000-0000-7000-8000-00000000d001';
const STORE_MX = '01920000-0000-7000-8000-00000000d004';
const WANGLEI = '01920000-0000-7000-8000-0000000000b3';

const names: AuditNames = {
  stores: new Map([
    [STORE_DIRECT, 'Forcome Direct'],
    [STORE_MX, 'forcome.mx'],
  ]),
  members: new Map([[WANGLEI, '王磊']]),
};

/** S-20260909-0016（K18 ② 的示例单）：寄配件，产品成本 $2.60、运费 $6.80，三组均 FSH 100 / 工厂 0 */
const inProgress: AuditSnapshot<'aftersales.complete'> = {
  number: 'S-20260909-0016',
  status: 'in_progress',
  origin: 'manual_registration',
  storeId: STORE_DIRECT,
  site: 'US',
  sourceTicket: null,
  orderNumber: '113-4402918-7730215',
  customerName: 'Sarah Mitchell',
  registeredBy: '王磊',
  ownerId: WANGLEI,
  ownerName: '王磊',
  feeDate: '2026-09-09',
  method: 'send_parts',
  responsibility: 'logistics',
  responsibilityReason: null,
  factory: null,
  part: { sku: 'FC-V2-HF01', quantity: 1 },
  shipper: 'yicang',
  carrier: 'UPS Ground',
  shipDate: '2026-09-10',
  trackingNumber: null,
  claimTarget: 'carrier',
  claimStatus: 'not_started',
  fees: {
    productCost: { amount: '2.60', currency: 'USD', usd: '2.60', rate: null },
    freight: { amount: '6.80', currency: 'USD', usd: '6.80', rate: null },
    compensation: null,
    otherCost: {
      amount: '90.00',
      currency: 'MXN',
      usd: '5.00',
      rate: { rate: '18.000000', date: '2026-09-09', source: 'ecb' },
    },
  },
  ratios: {
    product: { fsh: 100, factory: 0 },
    freight: { fsh: 100, factory: 0 },
    other: { fsh: 100, factory: 0 },
  },
  completedAt: null,
  cancellation: null,
};
const completed = { ...inProgress, status: 'completed', completedAt: '2026-09-10T09:20:00.000Z' };

function record(overrides: Partial<AuditRecordInput>): AuditRecordInput {
  return {
    id: '01920000-0000-7000-8000-00000000a001',
    occurredAt: new Date('2026-09-10T09:20:00Z'),
    actorType: 'member',
    actorId: WANGLEI,
    actorName: '王磊',
    actorRoles: ['aftersales_owner'],
    ip: '10.20.2.18',
    action: 'aftersales.complete',
    objectType: 'aftersales',
    objectId: '01920000-0000-7000-8000-00000000c016',
    objectLabel: 'S-20260909-0016',
    storeId: STORE_DIRECT,
    before: inProgress,
    after: completed,
    ...overrides,
  };
}

const field = (entry: ReturnType<typeof describeAuditRecord>, label: string) =>
  entry.fields.find((f) => f.label === label);

describe('P27 一条审计记录的写法（PRD P27、10.2、K18）', () => {
  it('操作人写姓名与角色，系统操作写「系统」；动作写叫法，对象写编号', () => {
    const entry = describeAuditRecord(record({}), { financeVisible: true, names });
    expect(entry).toMatchObject({
      actor: { system: false, name: '王磊', roleText: '售后负责人' },
      ip: '10.20.2.18',
      objectType: 'aftersales',
      objectLabel: 'S-20260909-0016',
      action: 'aftersales.complete',
      actionLabel: '设为已完成',
      denied: false,
    });
    const system = describeAuditRecord(
      record({ actorType: 'system', actorId: null, actorName: '系统', actorRoles: [], ip: null }),
      { financeVisible: true, names },
    );
    expect(system.actor).toMatchObject({ system: true, name: '系统', roleText: '' });
  });

  it('来源 IP：IPv4 映射的 IPv6 地址写成 IPv4，其余原样', () => {
    const ipOf = (ip: string | null) =>
      describeAuditRecord(record({ ip }), { financeVisible: true, names }).ip;
    expect(ipOf('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(ipOf('10.20.1.12')).toBe('10.20.1.12');
    expect(ipOf('2001:db8::1')).toBe('2001:db8::1');
    expect(ipOf(null)).toBeNull();
  });

  it('多角色写全部角色；认不出的旧角色值原样写', () => {
    const entry = describeAuditRecord(
      record({ actorRoles: ['agent', 'aftersales_owner', '客服主管'] }),
      { financeVisible: true, names },
    );
    expect(entry.actor.roleText).toBe('坐席、售后负责人、客服主管');
  });

  it('变更摘要写第一个变化的字段「字段：前 → 后」，另有变化时写「等 N 项」的 N（变化的字段数）', () => {
    const entry = describeAuditRecord(record({}), { financeVisible: true, names });
    expect(entry.summary).toBe('状态：进行中 → 已完成');
    expect(entry.more).toBe(2);
  });

  it('展开列出前后任一侧有值的全部字段，变化的标出；两侧都空的不列', () => {
    const entry = describeAuditRecord(record({}), { financeVisible: true, names });
    expect(entry.fields.slice(0, 2)).toEqual([
      expect.objectContaining({ label: '状态', before: '进行中', after: '已完成', changed: true }),
      expect.objectContaining({
        label: '完成时间',
        before: '—',
        after: '09-10 17:20',
        changed: true,
      }),
    ]);
    expect(field(entry, '店铺')).toMatchObject({ before: 'Forcome Direct', changed: false });
    expect(field(entry, '处理方式')).toMatchObject({ before: '寄配件', after: '寄配件' });
    expect(field(entry, '责任类型')?.after).toBe('物流问题');
    expect(field(entry, '配件 × 数量')?.after).toBe('FC-V2-HF01 × 1');
    expect(field(entry, '索赔状态')?.after).toBe('待发起');
    expect(field(entry, '负责人')?.after).toBe('王磊');
    expect(field(entry, '快递单号')).toBeUndefined();
    expect(field(entry, '额外赔偿')).toBeUndefined();
    expect(field(entry, '取消原因')).toBeUndefined();
  });

  it('有财务权限：费用写美元，非美元另写原币与汇率；承担比例照台账写法', () => {
    const entry = describeAuditRecord(record({}), { financeVisible: true, names });
    expect(field(entry, '产品成本')).toMatchObject({
      after: '$2.60',
      finance: true,
      hidden: false,
    });
    expect(field(entry, '其他')?.after).toBe('$5.00（MX$90.00 · 汇率 18.00 · 09-09）');
    expect(field(entry, '承担比例')).toMatchObject({
      after: '三组均 FSH 100 / 工厂 0',
      finance: true,
    });
  });

  it('没有财务权限：成本、承担比例的前后值为「已隐藏」，其他字段照常（K18 ②、AC-P1-20）', () => {
    const entry = describeAuditRecord(record({}), { financeVisible: false, names });
    for (const label of ['产品成本', '运费', '其他', '承担比例']) {
      expect(field(entry, label)).toMatchObject({
        before: null,
        after: null,
        hidden: true,
        changed: false,
      });
    }
    expect(field(entry, '状态')).toMatchObject({ before: '进行中', after: '已完成' });
    expect(JSON.stringify(entry)).not.toContain('2.60');
    expect(JSON.stringify(entry)).not.toContain('FSH 100');
  });

  it('只改了财务字段时，没有财务权限的摘要只写字段名与「已隐藏」', () => {
    const changed = {
      ...inProgress,
      fees: {
        ...inProgress.fees,
        otherCost: {
          amount: '90.00',
          currency: 'MXN' as const,
          usd: '5.14',
          rate: { rate: '17.500000', date: '2026-09-09', source: 'manual' as const },
        },
      },
    };
    const action = 'aftersales.change_rate';
    const hidden = describeAuditRecord(record({ action, before: inProgress, after: changed }), {
      financeVisible: false,
      names,
    });
    expect(hidden.summary).toBe('其他：已隐藏');
    expect(hidden.more).toBe(0);
    const shown = describeAuditRecord(record({ action, before: inProgress, after: changed }), {
      financeVisible: true,
      names,
    });
    expect(shown.summary).toBe(
      '其他：$5.00（MX$90.00 · 汇率 18.00 · 09-09） → $5.14（MX$90.00 · 汇率 17.50 · 手工修改）',
    );
  });

  it('取消：原因、时间与保留的费用项（保留的费用项是财务字段）', () => {
    const cancelled = {
      ...inProgress,
      status: 'cancelled' as const,
      cancellation: { reason: '客户撤回', at: '2026-09-11T02:00:00.000Z', keptFees: ['freight'] },
    };
    const action = 'aftersales.cancel';
    const shown = describeAuditRecord(record({ action, after: cancelled }), {
      financeVisible: true,
      names,
    });
    expect(field(shown, '取消原因')?.after).toBe('客户撤回');
    expect(field(shown, '取消时间')?.after).toBe('09-11 10:00');
    expect(field(shown, '取消时保留的费用')?.after).toBe('运费');
    const hidden = describeAuditRecord(record({ action, after: cancelled }), {
      financeVisible: false,
      names,
    });
    expect(field(hidden, '取消时保留的费用')).toMatchObject({ hidden: true, after: null });
  });

  it('新建（没有前值）：前值都写「—」，摘要「字段：— → 后」与变化的字段数', () => {
    const entry = describeAuditRecord(
      record({ action: 'aftersales.create', before: null, after: inProgress }),
      { financeVisible: true, names },
    );
    expect(entry.summary).toBe('状态：— → 进行中');
    expect(entry.fields.every((f) => f.before === '—')).toBe(true);
    expect(entry.more).toBe(entry.fields.length);
  });

  it('店铺：抽屉的全部字段，列表写成「、」相连', () => {
    const before: AuditSnapshot<'store.update'> = {
      name: 'forcome.mx',
      platform: 'shopify',
      sites: ['MX'],
      defaultSite: 'MX',
      mailboxes: ['support@forcome.mx'],
      platformId: 'forcome-mx.myshopify.com',
      adapterMode: 'fake',
    };
    const after = { ...before, mailboxes: ['support@forcome.mx', 'hola@forcome.mx'] };
    const entry = describeAuditRecord(
      record({
        action: 'store.update',
        objectType: 'store',
        objectId: STORE_MX,
        objectLabel: 'forcome.mx',
        storeId: STORE_MX,
        before,
        after,
      }),
      { financeVisible: false, names },
    );
    expect(entry.actionLabel).toBe('编辑店铺');
    expect(entry.summary).toBe(
      '进线邮箱：support@forcome.mx → support@forcome.mx、hola@forcome.mx',
    );
    expect(entry.more).toBe(0);
    expect(entry.fields.map((f) => f.label)).toEqual([
      '平台',
      '店铺名',
      '站点',
      '默认站点',
      '进线邮箱',
      '平台标识',
      '数据来源',
    ]);
    expect(field(entry, '平台')?.after).toBe('Shopify');
    expect(field(entry, '数据来源')?.after).toBe('模拟数据');
  });

  it('台账导出：摘要写筛选与行数（原型「筛选：9 月 · 全部店铺 · 12 行」）', () => {
    const after: AuditSnapshot<'ledger.export'> = {
      fileName: '登记台账_2026-09-01_2026-09-30.xlsx',
      filters: { from: '2026-09-01', to: '2026-09-30' },
      rows: 12,
      financeFields: true,
    };
    const entry = describeAuditRecord(
      record({
        action: 'ledger.export',
        objectType: 'export',
        objectId: 'aftersales.ledger',
        objectLabel: '登记台账',
        storeId: null,
        before: null,
        after,
      }),
      { financeVisible: true, names },
    );
    expect(entry).toMatchObject({
      actionLabel: '导出 Excel',
      summary: '筛选：9 月 · 全部店铺 · 12 行',
      more: 0,
    });
    expect(field(entry, '含财务字段')?.after).toBe('是');

    const filtered = describeAuditRecord(
      record({
        action: 'ledger.export',
        objectType: 'export',
        before: null,
        after: {
          ...after,
          filters: {
            from: '2026-09-01',
            to: '2026-09-11',
            store: STORE_MX,
            method: 'send_parts',
            owner: WANGLEI,
          },
          rows: 3,
        },
      }),
      { financeVisible: true, names },
    );
    expect(filtered.summary).toBe(
      '筛选：2026-09-01 至 09-11 · forcome.mx · 寄配件 · 负责人 王磊 · 3 行',
    );
  });

  it('审计日志导出：摘要写时间、各筛选与行数', () => {
    const after: AuditSnapshot<'audit.export'> = {
      fileName: '审计日志_近7天_0905-0911.xlsx',
      filters: {
        period: 'week',
        from: '2026-09-05',
        to: '2026-09-11',
        actor: WANGLEI,
        type: 'aftersales',
        action: 'aftersales.complete',
        q: 'S-2026',
      },
      rows: 4,
    };
    const entry = describeAuditRecord(
      record({
        action: 'audit.export',
        objectType: 'export',
        objectId: 'audit.log',
        objectLabel: '审计日志',
        storeId: null,
        before: null,
        after,
      }),
      { financeVisible: false, names },
    );
    expect(entry.summary).toBe(
      '筛选：近 7 天（2026-09-05 至 09-11） · 操作人 王磊 · 售后单 · 设为已完成 · 对象编号含「S-2026」 · 4 行',
    );
  });

  it('登录：对象写登录方式，摘要「会话有效期 7 天（无操作）」（原型）', () => {
    const entry = describeAuditRecord(
      record({
        action: 'auth.login',
        objectType: 'login',
        objectId: 'session-1',
        objectLabel: '开发登录',
        storeId: null,
        before: null,
        after: { method: 'dev' },
      }),
      { financeVisible: false, names },
    );
    expect(entry).toMatchObject({
      actionLabel: '登录',
      objectLabel: '开发登录',
      summary: '会话有效期 7 天（无操作）',
      more: 0,
    });
    expect(field(entry, '登录方式')?.after).toBe('开发登录');
  });

  it('越权访问被拒（E-24）：标为越权，摘要写越权的店铺；对象没有编号时写店铺名', () => {
    const entry = describeAuditRecord(
      record({
        action: 'access.denied',
        objectType: 'store',
        objectId: STORE_MX,
        objectLabel: null,
        storeId: STORE_MX,
        before: null,
        after: {
          reason: 'store_scope',
          storeIds: [STORE_MX],
          method: 'GET',
          path: '/api/aftersales/ledger',
        },
      }),
      { financeVisible: false, names },
    );
    expect(entry).toMatchObject({
      denied: true,
      actionLabel: '越权访问被拒',
      objectLabel: 'forcome.mx',
      summary: '店铺 forcome.mx 不在授权范围内（R-ST-06）',
      more: 0,
    });
    expect(field(entry, '请求地址')?.after).toBe('/api/aftersales/ledger');
  });

  it('没登记的动作与对不上结构的前后值：不放行任何值（叫法写原样，摘要「—」，没有字段）', () => {
    const entry = describeAuditRecord(
      record({ action: 'member.update_store_scope', after: { cost: '9.99' } }),
      { financeVisible: true, names },
    );
    expect(entry).toMatchObject({ actionLabel: 'member.update_store_scope', summary: '—' });
    expect(entry.fields).toEqual([]);
    const broken = describeAuditRecord(record({ after: { status: 'completed', secret: 'x' } }), {
      financeVisible: false,
      names,
    });
    expect(JSON.stringify(broken)).not.toContain('secret');
  });

  it('跨年的时刻写全年份', () => {
    const entry = describeAuditRecord(
      record({
        occurredAt: new Date('2027-01-05T02:00:00Z'),
        after: { ...completed, completedAt: '2026-12-31T09:20:00.000Z' },
      }),
      { financeVisible: true, names },
    );
    expect(field(entry, '完成时间')?.after).toBe('2026-12-31 17:20');
  });
});

describe('成员的记录（P20，待办 06）', () => {
  const zhaoqian = { name: '赵倩', dept: 'FSH / 客服部', status: 'active' as const };
  const memberRecord = (overrides: Partial<AuditRecordInput>) =>
    record({
      actorName: '刘洋',
      actorRoles: ['admin'],
      objectType: 'member',
      objectId: '01920000-0000-7000-8000-0000000000b5',
      objectLabel: '赵倩',
      storeId: null,
      ...overrides,
    });

  it('修改店铺范围：摘要照原型 P27「店铺范围：Forcome Direct → 全部店铺」', () => {
    const entry = describeAuditRecord(
      memberRecord({
        action: 'member.change_stores',
        before: {
          ...zhaoqian,
          roles: ['knowledge_owner'],
          stores: { all: false, storeIds: [STORE_DIRECT] },
        },
        after: { ...zhaoqian, roles: ['knowledge_owner'], stores: { all: true } },
      }),
      { financeVisible: false, names },
    );
    expect(entry).toMatchObject({
      actionLabel: '修改店铺范围',
      summary: '店铺范围：Forcome Direct → 全部店铺',
      more: 0,
    });
    expect(field(entry, '角色')).toMatchObject({ before: '知识库负责人', changed: false });
  });

  it('修改角色与店铺范围：摘要写第一个变化的字段，接「等 2 项」', () => {
    const entry = describeAuditRecord(
      memberRecord({
        action: 'member.change_access',
        before: { ...zhaoqian, roles: ['knowledge_owner'], stores: { all: true } },
        after: {
          ...zhaoqian,
          roles: ['agent', 'knowledge_owner'],
          stores: { all: false, storeIds: [STORE_DIRECT, STORE_MX] },
        },
      }),
      { financeVisible: true, names },
    );
    expect(entry).toMatchObject({
      actionLabel: '修改角色与店铺范围',
      summary: '角色：知识库负责人 → 坐席、知识库负责人',
      more: 2,
    });
    expect(field(entry, '店铺范围')).toMatchObject({
      before: '全部店铺',
      after: 'Forcome Direct、forcome.mx',
      changed: true,
    });
  });

  it('添加成员：原来没有角色与店铺范围，前值写「—」', () => {
    const entry = describeAuditRecord(
      memberRecord({
        action: 'member.add',
        before: { ...zhaoqian, roles: [], stores: { all: false, storeIds: [] } },
        after: { ...zhaoqian, roles: ['agent'], stores: { all: true } },
      }),
      { financeVisible: true, names },
    );
    expect(entry).toMatchObject({
      actionLabel: '添加成员',
      summary: '角色：— → 坐席',
      more: 2,
    });
    expect(field(entry, '店铺范围')).toMatchObject({ before: '—', after: '全部店铺' });
  });

  it('钉钉同步的两种记录没有店铺范围也照常写（待办 05 的旧记录）', () => {
    const entry = describeAuditRecord(
      memberRecord({
        action: 'member.dingtalk_left',
        actorType: 'system',
        actorName: '系统',
        actorRoles: [],
        before: { ...zhaoqian, roles: ['agent'] },
        after: { ...zhaoqian, status: 'disabled', roles: ['agent'] },
      }),
      { financeVisible: true, names },
    );
    expect(entry).toMatchObject({ summary: '状态：已启用 → 已停用' });
    expect(field(entry, '店铺范围')).toBeUndefined();
  });

  it('店铺范围里的店铺也要查名字', () => {
    const ids = auditNameIds([
      memberRecord({
        action: 'member.change_stores',
        before: { ...zhaoqian, roles: ['agent'], stores: { all: false, storeIds: [STORE_MX] } },
        after: { ...zhaoqian, roles: ['agent'], stores: { all: true } },
      }),
    ]);
    expect([...ids.storeIds]).toEqual([STORE_MX]);
  });
});

describe('要查名字的 ID', () => {
  it('收集快照与筛选里的店铺、成员 ID，以及没有编号的店铺对象', () => {
    const ids = auditNameIds([
      record({}),
      record({
        action: 'ledger.export',
        objectType: 'export',
        before: null,
        after: {
          fileName: 'x.xlsx',
          filters: { store: STORE_MX, owner: WANGLEI },
          rows: 1,
          financeFields: false,
        },
      }),
      record({
        action: 'access.denied',
        objectType: 'store',
        objectId: STORE_MX,
        objectLabel: null,
        before: null,
        after: { reason: 'store_scope', storeIds: [STORE_MX], method: 'GET', path: '/' },
      }),
    ]);
    expect([...ids.storeIds].sort()).toEqual([STORE_DIRECT, STORE_MX].sort());
    expect([...ids.memberIds]).toEqual([WANGLEI]);
  });
});
