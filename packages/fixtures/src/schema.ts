import { z } from 'zod';

/*
 * 示例数据夹具的结构（产物 data/demo.json 由 scripts/fixtures/export_demo_fixture.py 从
 * design/spec/data.py 生成，不手改）。加载时按本模式校验，生成脚本与这里不一致会立即报错。
 * 业务取值（状态、渠道、处理方式、责任类型等）保留原型与 PRD 的中文写法，各模块的加载步骤自己映射到枚举。
 */

/** 带 +08:00 的 ISO 8601 时刻（原型时间都是北京时间） */
const instant = z.iso.datetime({ offset: true });
/** YYYY-MM-DD */
const day = z.iso.date();
/** 两位小数的金额字符串 */
const amount = z.string().regex(/^\d+\.\d{2}$/, '金额要写成两位小数的字符串');
const uuid = z.uuid();

export const fixtureCurrencySchema = z.enum(['USD', 'CAD', 'MXN']);

const ratioPair = z.object({ fsh: z.int().min(0).max(100), factory: z.int().min(0).max(100) });
/** 承担比例三组：产品成本 / 快递物流 / 其他费用（R-AS-08） */
const ratiosSchema = z.object({ product: ratioPair, freight: ratioPair, other: ratioPair });

/** 一个费用项：原币金额、币种、冻结的美元金额与汇率日期（美元不折算，汇率日期为 null） */
export const fixtureFeeSchema = z.object({
  amount,
  currency: fixtureCurrencySchema,
  usd: amount,
  rateDate: day.nullable(),
});

export const fixtureMemberSchema = z.object({
  id: uuid,
  key: z.string(),
  name: z.string(),
  avatar: z.string(),
  /** 原型里的角色名（中文）；加载时经 contracts 的 roleByLabel 映射到角色枚举（待办 04） */
  role: z.string(),
  dept: z.string(),
  email: z.string().nullable(),
  stores: z.string().nullable(),
  factory: z.string().nullable(),
  /** 最近登录（P20 成员表，待办 06） */
  lastLogin: instant,
});

export const fixtureStoreSchema = z.object({
  id: uuid,
  key: z.string(),
  name: z.string(),
  platform: z.enum(['亚马逊', 'Shopify']),
  sites: z.array(z.enum(['US', 'CA', 'MX'])),
  defaultSite: z.enum(['US', 'CA', 'MX']),
  mailbox: z.string(),
  /** 平台标识（亚马逊卖家 ID 或 Shopify 店铺域名），不带「卖家 ID」之类的字段名 */
  platformId: z.string(),
});

export const fixtureTicketSchema = z.object({
  no: z.string().regex(/^T-\d{8}-\d{4}$/),
  subject: z.string(),
  customer: z.string(),
  storeKey: z.string(),
  channel: z.enum(['亚马逊', 'Shopify', '邮件']),
  site: z.enum(['US', 'CA', 'MX']),
  source: z.enum(['客户', '生产厂', '其他供应商']),
  status: z.enum(['待回复', '等客户', '已解决', '已关闭']),
  closeReason: z.string().nullable(),
  lastInboundAt: instant,
  order: z.string().nullable(),
  /** 发件地址（只在原型写明时有，例如生产厂来信） */
  from: z.string().nullable(),
  /** 原型画面在演示时刻显示的 SLA（剩余或结果）；系统按来信重新计算，这里只作核对用 */
  slaDisplay: z.object({
    text: z.string(),
    level: z.enum(['danger', 'warning', 'normal', 'none']),
    internalTarget: z.boolean(),
  }),
});

export const fixtureLedgerRowSchema = z.object({
  no: z.string().regex(/^S-\d{8}-\d{4}$/),
  status: z.enum(['进行中', '已完成', '已取消']),
  storeKey: z.string(),
  site: z.enum(['US', 'CA', 'MX']),
  order: z.string().nullable(),
  customer: z.string(),
  ticket: z.string().nullable(),
  method: z.enum(['调整安装方式', '寄配件', '退款或部分补偿']),
  responsibility: z.enum(['客户使用问题', '产品质量问题', '物流问题', '其他']),
  responsibilityReason: z.string().nullable(),
  part: z.object({ sku: z.string(), qty: z.int().positive() }).nullable(),
  factory: z.string().nullable(),
  shipper: z.enum(['易仓', '生产厂']).nullable(),
  carrier: z.string().nullable(),
  shipDate: day.nullable(),
  tracking: z.string().nullable(),
  /** 索赔对象与状态（责任为物流问题时，R-AS-08 的取值） */
  claim: z
    .object({
      target: z.enum(['承运商', '易仓']),
      state: z.enum(['待发起', '索赔中', '已赔付', '已拒赔']),
    })
    .nullable(),
  fees: z.object({
    product: fixtureFeeSchema.nullable(),
    freight: fixtureFeeSchema.nullable(),
    compensation: fixtureFeeSchema.nullable(),
    other: fixtureFeeSchema.nullable(),
  }),
  ratios: ratiosSchema,
  feeDate: day,
  completedAt: instant.nullable(),
  ownerKey: z.string(),
  registeredByKey: z.string(),
  createdVia: z.enum(['手工登记', '历史导入']),
});

export const fixtureTicketTimelineSchema = z.object({
  ticket: z.string(),
  mailbox: z.string(),
  entries: z.array(
    z.object({
      at: instant,
      direction: z.enum(['inbound', 'outbound']),
      body: z.string(),
      markedNoReply: z.object({ byKey: z.string(), at: instant }).nullable(),
    }),
  ),
  statusFlow: z.array(
    z.object({ status: z.string(), at: instant, actor: z.string(), event: z.string() }),
  ),
  sla: z.array(
    z.object({ inboundAt: instant, result: z.string(), tone: z.string(), note: z.string() }),
  ),
  autoCloseAt: instant,
  closeReason: z.string(),
  orderSyncedAt: instant,
});

/** 站内通知（G10 周敏的面板，第一期的类型）：类型取值同 contracts 的 notificationTypes，加载时再按枚举校验 */
export const fixtureNotificationSchema = z.object({
  id: uuid,
  /** 接收人（成员 key） */
  recipientKey: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  object: z.object({ type: z.string(), id: z.string(), label: z.string() }),
  at: instant,
  read: z.boolean(),
});

export const demoFixtureSchema = z.object({
  meta: z.object({
    source: z.string(),
    generator: z.string(),
    /** 演示时刻 */
    now: instant,
    timeZone: z.literal('Asia/Shanghai'),
  }),
  /** Fake 汇率：以美元为基准的演示汇率 */
  exchangeRates: z.object({
    base: z.literal('USD'),
    quotes: z.object({ MXN: amount, CAD: amount }),
  }),
  members: z.array(fixtureMemberSchema),
  stores: z.array(fixtureStoreSchema),
  factories: z.array(
    z.object({
      code: z.string(),
      scope: z.string(),
      contact: z.string(),
      head: z.string(),
      mailboxes: z.array(z.string()),
    }),
  ),
  parts: z.array(
    z.object({ sku: z.string(), name: z.string(), category: z.string(), factory: z.string() }),
  ),
  /** 责任类型的默认承担比例（R-AS-02 种子数据） */
  responsibilityRatios: z.array(z.object({ responsibility: z.string(), ratios: ratiosSchema })),
  tickets: z.array(fixtureTicketSchema),
  ledger: z.array(fixtureLedgerRowSchema),
  /** 原型用过的最大售后单序号（含第一期丢弃的待确认单）；示例台账之后新发的单号接在它后面 */
  aftersalesLastSequence: z.int().positive(),
  ticketTimeline: fixtureTicketTimelineSchema,
  notifications: z.array(fixtureNotificationSchema),
});

export type DemoFixture = z.infer<typeof demoFixtureSchema>;
export type FixtureMember = z.infer<typeof fixtureMemberSchema>;
export type FixtureStore = z.infer<typeof fixtureStoreSchema>;
export type FixtureTicket = z.infer<typeof fixtureTicketSchema>;
export type FixtureLedgerRow = z.infer<typeof fixtureLedgerRowSchema>;
export type FixtureFee = z.infer<typeof fixtureFeeSchema>;
export type FixtureNotification = z.infer<typeof fixtureNotificationSchema>;
