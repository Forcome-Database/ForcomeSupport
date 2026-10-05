import { readFileSync } from 'node:fs';
import {
  auditObjectTypeLabels,
  describeAuditRecord,
  type AuditNames,
  type AuditRecordInput,
  type AuditSnapshot,
} from '@forcome/contracts';
import { describe, expect, it } from 'vitest';
import { pages } from '@/lib/pages';
import { VIEW_AUDIT_LOG } from '../settings/p18-copy';
import {
  COLUMNS,
  EMPTY,
  EXPAND,
  EXPORT,
  FILTERS,
  LIST_HEAD,
  MORE,
  NO_FINANCE,
  NONE,
  OWN_ONLY,
  PAGE_DESCRIPTION,
  PAGE_TITLE,
  PAGER,
  PERIODS,
  rangeHead,
  SYSTEM,
} from './p27-copy';

/*
 * P27 的界面文案与原型逐字一致（CLAUDE.md「文案逐字照原型」，ADR 0007 修订）：直接读原型生成物——第一期参照页
 * P27_AuditLog（周敏，看全部）、状态板 StatesAdmin（K18 两张小图与补充小样、K5 导出）、P18 第一期参照页（页头「查看审计日志」）。
 * 后端按 contracts 的 describeAuditRecord 写的摘要与字段也在这里对照原型（同样的示例单经它写出来，要与 K18 一致）。
 * 原型改了文案而代码没跟上、或反过来，都会失败。原型由 design/spec 下的脚本生成（README「修改与重建」）。
 */

const read = (path: string) =>
  readFileSync(new URL(`../../../../../${path}`, import.meta.url), 'utf8');
const P27 = read('design/spec/phase1/P27_AuditLog.dc.html');
const P18 = read('design/spec/phase1/P18_Settings.dc.html');
const STATES_ADMIN = read('design/StatesAdmin.dc.html');

/** 原型里有这段文字；先确认要核对的文字不是空的（空串处处都「包含」，会让核对空过） */
function expectIn(html: string, text: string | null | undefined) {
  expect(text, '要核对的文案为空').toBeTruthy();
  expect(html.includes(text ?? ''), `原型里没有「${text}」`).toBe(true);
}

/** 原型里有这段界面文字，且是一个元素的完整文本 */
function expectText(html: string, text: string) {
  expectIn(html, `>${text}<`);
}

describe('P27 第一期参照页', () => {
  it('页头、导出与头像菜单里的入口名', () => {
    expectText(P27, PAGE_TITLE);
    expectIn(P27, PAGE_DESCRIPTION);
    expectText(P27, EXPORT.button);
    expect(pages.audit.label).toBe(PAGE_TITLE);
  });

  it('筛选行：时间三档、三个芯片与搜索框、地址栏说明', () => {
    for (const period of Object.values(PERIODS)) expectText(P27, period);
    for (const chip of [FILTERS.actor, FILTERS.type, FILTERS.action]) expectIn(P27, `${chip}：`);
    expectIn(P27, FILTERS.search);
    expectText(P27, FILTERS.urlNote);
  });

  it('表头上方：时间、计数与图例；表头各列', () => {
    expectText(
      P27,
      rangeHead({ period: 'today', from: '2026-09-11', to: '2026-09-11' }, '2026-09-11'),
    );
    expectIn(P27, LIST_HEAD.count(5, 0));
    expectText(P27, LIST_HEAD.denied);
    expectText(P27, LIST_HEAD.deniedNote);
    expectIn(P27, LIST_HEAD.finance);
    for (const column of Object.values(COLUMNS)) expectText(P27, column);
  });

  it('系统操作、等 N 项、两栏对照与说明行、无值', () => {
    expectText(P27, SYSTEM.avatar);
    expectText(P27, SYSTEM.name);
    expectIn(P27, MORE(4));
    expectText(P27, EXPAND.before);
    expectText(P27, EXPAND.after);
    expectIn(P27, EXPAND.meta('09-11 10:14', SYSTEM.name, SYSTEM.name, NONE));
    expectText(P27, NONE);
  });

  it('对象类型的叫法（筛选与「对象」列）', () => {
    for (const type of ['渠道', '成员', '导出', '登录'] as const) expectText(P27, type);
    expect(auditObjectTypeLabels.channel).toBe('渠道');
  });

  it('分页：条数、上一页、页码、下一页与禁用原因', () => {
    expectIn(P27, PAGER.summary(5));
    expectText(P27, PAGER.prev);
    expectText(P27, PAGER.next);
    expectText(P27, PAGER.position(1, 1));
    expectIn(P27, PAGER.first);
    expectIn(P27, PAGER.last);
  });
});

describe('状态板 K18（可见范围）与 K5（导出）', () => {
  it('① 只看自己的：横幅与锁定芯片的悬停说明', () => {
    expectText(STATES_ADMIN, OWN_ONLY.title);
    expectText(STATES_ADMIN, OWN_ONLY.description);
    expectIn(STATES_ADMIN, `title="${OWN_ONLY.title}"`);
  });

  it('② 没有财务权限：说明行、「已隐藏」、近 7 天的说明行与等 N 项', () => {
    expectIn(STATES_ADMIN, NO_FINANCE);
    expectIn(STATES_ADMIN, EXPAND.hidden);
    expectIn(STATES_ADMIN, EXPAND.meta('09-10 17:20', '王磊', '售后负责人', '10.20.2.18'));
    expectIn(STATES_ADMIN, MORE(2));
  });

  it('K5：生成中与完成浮层的写法', () => {
    expectIn(STATES_ADMIN, EXPORT.busy);
    expectIn(STATES_ADMIN, EXPORT.done('报表_近7天_0905-0911.xlsx'));
  });
});

describe('P18 页头的入口', () => {
  it('「查看审计日志」', () => {
    expectText(P18, VIEW_AUDIT_LOG);
  });
});

describe('表头上方的时间', () => {
  it('今天、近 7 天、自定义（同年写月-日，跨年写全）', () => {
    const today = '2026-09-11';
    expect(rangeHead({ period: 'today', from: today, to: today }, today)).toBe('09-11 今天');
    expect(rangeHead({ period: 'week', from: '2026-09-05', to: today }, today)).toBe(
      '09-05 至 09-11 近 7 天',
    );
    expect(rangeHead({ period: 'custom', from: '2026-09-01', to: '2026-09-01' }, today)).toBe(
      '09-01',
    );
    expect(rangeHead({ period: 'custom', from: '2025-12-30', to: '2026-01-05' }, today)).toBe(
      '2025-12-30 至 2026-01-05',
    );
  });
});

describe('K18 补充小样（待办 30，10-05 用户确认）', () => {
  it('表头上方的时间、计数，列表为空的标题与说明', () => {
    expectText(
      STATES_ADMIN,
      rangeHead({ period: 'week', from: '2026-09-05', to: '2026-09-11' }, '2026-09-11'),
    );
    expectText(
      STATES_ADMIN,
      rangeHead({ period: 'custom', from: '2026-09-01', to: '2026-09-11' }, '2026-09-11'),
    );
    expectIn(STATES_ADMIN, LIST_HEAD.count(5, 1));
    expectText(STATES_ADMIN, EMPTY.title);
    expectIn(
      STATES_ADMIN,
      EMPTY.description([PERIODS.week, EMPTY.actor('王磊'), auditObjectTypeLabels.store], true),
    );
    expectIn(STATES_ADMIN, `>${FILTERS.clear}<`);
  });

  it('导出：完成浮层的文件名', () => {
    expectIn(STATES_ADMIN, EXPORT.done('审计日志_今天_0911.xlsx'));
  });
});

/*
 * 后端写出的摘要与字段（contracts 的 describeAuditRecord）与原型对照：用 K18 ② 与补充小样 ① 的同一批示例数据
 * （S-20260909-0016 的设为已完成与新建、forcome.mx 编辑进线邮箱、越权访问 forcome.com、导出审计日志）。
 */
const STORE_COM = '01920000-0000-7000-8000-0000000000c3';
const STORE_MX = '01920000-0000-7000-8000-0000000000c4';
const names: AuditNames = {
  stores: new Map([
    [STORE_COM, 'forcome.com'],
    [STORE_MX, 'forcome.mx'],
  ]),
  members: new Map(),
};
const usd = (amount: string) => ({ amount, currency: 'USD' as const, usd: amount, rate: null });
const inProgress: AuditSnapshot<'aftersales.complete'> = {
  number: 'S-20260909-0016',
  status: 'in_progress',
  origin: 'manual_registration',
  storeId: STORE_COM,
  site: 'US',
  sourceTicket: 'T-20260908-0140',
  orderNumber: '#1052',
  customerName: 'David Park',
  registeredBy: '王磊',
  ownerId: '01920000-0000-7000-8000-0000000000b3',
  ownerName: '王磊',
  feeDate: '2026-09-09',
  method: 'send_parts',
  responsibility: 'customer_use',
  responsibilityReason: null,
  factory: null,
  part: { sku: 'FC-V2-HS02', quantity: 1 },
  shipper: 'yicang',
  carrier: 'UPS Ground',
  shipDate: '2026-09-09',
  trackingNumber: null,
  claimTarget: null,
  claimStatus: null,
  fees: {
    productCost: usd('2.60'),
    freight: usd('6.80'),
    compensation: usd('0.00'),
    otherCost: usd('0.00'),
  },
  ratios: {
    product: { fsh: 100, factory: 0 },
    freight: { fsh: 100, factory: 0 },
    other: { fsh: 100, factory: 0 },
  },
  completedAt: null,
  cancellation: null,
};
const record = (overrides: Partial<AuditRecordInput>): AuditRecordInput => ({
  id: '01920000-0000-7000-8000-00000000a001',
  occurredAt: new Date('2026-09-10T09:20:00Z'),
  actorType: 'member',
  actorId: null,
  actorName: '王磊',
  actorRoles: ['aftersales_owner'],
  ip: '10.20.2.18',
  action: 'aftersales.complete',
  objectType: 'aftersales',
  objectId: 'x',
  objectLabel: 'S-20260909-0016',
  storeId: STORE_COM,
  before: inProgress,
  after: { ...inProgress, status: 'completed', completedAt: '2026-09-10T09:20:00.000Z' },
  ...overrides,
});
const describeAs = (r: AuditRecordInput) =>
  describeAuditRecord(r, { financeVisible: false, names });

describe('后端写出的摘要与两栏对照与原型一致', () => {
  it('K18 ②：设为已完成的摘要与「等 2 项」，展开的全部字段名与没隐藏的值，财务字段「已隐藏」', () => {
    const entry = describeAs(record({}));
    // 原型把「等 N 项」写在摘要后的浅色 span 里
    expectIn(STATES_ADMIN, `${entry.summary}<span`);
    expectIn(STATES_ADMIN, `>${MORE(entry.more)}<`);
    for (const field of entry.fields) {
      // 财务字段名后跟钱的图标（原型 icon('money')）
      if (field.finance) expectIn(STATES_ADMIN, `>${field.label} <svg`);
      else expectText(STATES_ADMIN, field.label);
      if (field.hidden) continue;
      expectIn(STATES_ADMIN, `>${field.before}<`);
      expectIn(STATES_ADMIN, `>${field.after}<`);
    }
    expect(entry.fields.filter((field) => field.hidden).map((field) => field.label)).toEqual([
      '产品成本',
      '运费',
      '额外赔偿',
      '其他',
      '承担比例',
    ]);
  });

  it('补充小样 ①：新建、编辑店铺、越权访问、导出审计日志的摘要', () => {
    const created = describeAs(
      record({ action: 'aftersales.create', before: null, after: inProgress }),
    );
    expectIn(STATES_ADMIN, `${created.summary}<span`);
    expectIn(STATES_ADMIN, `>${MORE(created.more)}<`);

    const store: AuditSnapshot<'store.update'> = {
      name: 'forcome.mx',
      platform: 'shopify',
      sites: ['MX'],
      defaultSite: 'MX',
      mailboxes: ['support@forcome.mx'],
      platformId: 'forcome-mx.myshopify.com',
      adapterMode: 'fake',
    };
    const edited = describeAs(
      record({
        action: 'store.update',
        objectType: 'store',
        storeId: STORE_MX,
        before: store,
        after: { ...store, mailboxes: ['support@forcome.mx', 'ventas@forcome.mx'] },
      }),
    );
    expectIn(STATES_ADMIN, edited.summary);

    const denied = describeAs(
      record({
        action: 'access.denied',
        objectType: 'store',
        objectId: STORE_COM,
        objectLabel: null,
        before: null,
        after: {
          reason: 'store_scope',
          storeIds: [STORE_COM],
          method: 'GET',
          path: '/api/aftersales/ledger',
        },
      }),
    );
    expectIn(STATES_ADMIN, denied.summary);
    expectIn(STATES_ADMIN, `>${denied.objectLabel}<`);

    const exported = describeAs(
      record({
        action: 'audit.export',
        objectType: 'export',
        objectLabel: '审计日志',
        occurredAt: new Date('2026-09-11T02:21:00Z'),
        before: null,
        after: {
          fileName: '审计日志_今天_0911.xlsx',
          filters: { period: 'today', from: '2026-09-11', to: '2026-09-11' },
          rows: 12,
        },
      }),
    );
    expectIn(STATES_ADMIN, exported.summary);
    expectText(STATES_ADMIN, exported.actionLabel);
  });

  it('P27 第一期参照页：台账导出与登录的摘要', () => {
    const ledger = describeAs(
      record({
        action: 'ledger.export',
        objectType: 'export',
        objectLabel: '登记台账',
        before: null,
        after: {
          fileName: '登记台账_20260901-20260930.xlsx',
          filters: { from: '2026-09-01', to: '2026-09-30' },
          rows: 12,
          financeFields: true,
        },
      }),
    );
    expectIn(P27, ledger.summary);
    const login = describeAs(
      record({
        action: 'auth.login',
        objectType: 'login',
        objectLabel: '钉钉扫码',
        before: null,
        after: { method: 'dingtalk' },
      }),
    );
    expectIn(P27, login.summary);
    expectText(P27, login.actionLabel);
  });
});
