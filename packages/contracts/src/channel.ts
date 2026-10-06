import { z } from 'zod';
import { adapterModeSchema } from './integration';

/*
 * 渠道与店铺（PRD P18「第一阶段」、K8、K20，11.1 Store）：店铺的输入、字段级校验、输出结构与渠道连接状态。
 * 店铺决定来信识别（按进线邮箱）、订单匹配与数据权限；第一期没有签名与覆盖项（第二阶段起）。
 */

/** 平台 */
export const platforms = ['amazon', 'shopify'] as const;
export const platformSchema = z.enum(platforms);
export type Platform = z.infer<typeof platformSchema>;
export const platformLabels: Record<Platform, string> = { amazon: '亚马逊', shopify: 'Shopify' };

/** 站点（北美三站），按这个顺序显示 */
export const sites = ['US', 'CA', 'MX'] as const;
export const siteSchema = z.enum(sites);
export type Site = z.infer<typeof siteSchema>;

/**
 * 平台的邮件约定（R-TK-08、R-ST-02；channel 识别来信与 Fake Gmail 仿真来信共用，待办 10）：
 * - 亚马逊各站点的域：平台通知从站点域发出（amazon.com …），买家消息经中转域转到店铺绑定的邮箱（marketplace.amazon.com …）；
 * - Shopify 联系表单的通知由这个地址代发，Reply-To 是填表客户的邮箱。
 */
export const amazonDomains: Record<Site, { readonly site: string; readonly relay: string }> = {
  US: { site: 'amazon.com', relay: 'marketplace.amazon.com' },
  CA: { site: 'amazon.ca', relay: 'marketplace.amazon.ca' },
  MX: { site: 'amazon.com.mx', relay: 'marketplace.amazon.com.mx' },
};
export const SHOPIFY_CONTACT_FORM_SENDER = 'mailer@shopify.com';

/** 各平台的平台标识（亚马逊卖家 ID、Shopify 店铺域名）与进线邮箱的叫法：店铺表、抽屉与报错共用 */
export const platformTerms: Record<
  Platform,
  {
    /** 店铺表里平台标识上方的小字 */
    readonly platformId: string;
    /** 抽屉里的字段名 */
    readonly platformIdField: string;
    readonly platformIdPlaceholder: string;
    readonly platformIdMissing: string;
    /** 店铺表里进线邮箱下方的小字 */
    readonly mailbox: string;
    /** 店铺表状态列与渠道卡里订单连接的叫法 */
    readonly ordersApi: string;
  }
> = {
  amazon: {
    platformId: '卖家 ID',
    platformIdField: '平台标识 · 亚马逊卖家 ID',
    platformIdPlaceholder: '例如 A1FD7Q2M9XK3LC',
    platformIdMissing: '请填写卖家 ID',
    mailbox: '亚马逊买家消息',
    ordersApi: 'SP-API',
  },
  shopify: {
    platformId: '店铺域名',
    platformIdField: '平台标识 · Shopify 店铺域名',
    platformIdPlaceholder: '例如 forcome-mx.myshopify.com',
    platformIdMissing: '请填写店铺域名',
    mailbox: 'Shopify 客服邮箱',
    ordersApi: 'Admin API',
  },
};

/**
 * 新增或编辑店铺提交的内容（抽屉的字段）。形状宽松（平台、默认站点可以没选），
 * 是否填对由 storeInputErrors 逐项判断，这样所有字段的错误能一次列全（K8：保存后定位到第一个错误）。
 */
export const storeInputSchema = z.object({
  name: z.string(),
  platform: platformSchema.nullable(),
  /** 站点（多选） */
  sites: z.array(siteSchema),
  /** 默认站点：无订单的来信按它归站点（D-23），必须是所选站点之一 */
  defaultSite: siteSchema.nullable(),
  /** 进线邮箱：可填多个（含别名），寄到这些地址的来信归到本店铺；不能与其他店铺重复 */
  mailboxes: z.array(z.string()),
  platformId: z.string(),
  /** 数据来源（真实接口 / 模拟数据）：只在非生产环境可设；不传时新建按环境取默认，编辑保持原值 */
  adapterMode: adapterModeSchema.optional(),
});
export type StoreInput = z.infer<typeof storeInputSchema>;

/** 编辑店铺：带上打开抽屉时读到的版本号（乐观锁，冲突返回 409，G7） */
export const storeUpdateSchema = storeInputSchema.extend({ version: z.int().positive() });
export type StoreUpdate = z.infer<typeof storeUpdateSchema>;

/**
 * 字段级错误：键为字段路径（如 name、mailboxes.2），值为写在字段下方的中文说明（「哪里错 + 怎么改」）。
 * 接口在 400 invalid_request 的 fields 里返回同样的形状，前端按键把错误放到对应字段下方。
 */
export type FieldErrors = Record<string, string>;

const emailSchema = z.email();
const INVALID_EMAIL = '邮箱格式不正确，例如 info@forcome.mx';

/** 进线邮箱的规范写法：去掉首尾空白、转小写（同一地址不分大小写） */
export function normalizeMailbox(mailbox: string): string {
  return mailbox.trim().toLowerCase();
}

/** 规范化：去掉首尾空白，进线邮箱转小写，站点按 US · CA · MX 排序去重 */
export function normalizeStoreInput(input: StoreInput): StoreInput {
  return {
    ...input,
    name: input.name.trim(),
    sites: sites.filter((site) => input.sites.includes(site)),
    mailboxes: input.mailboxes.map(normalizeMailbox),
    platformId: input.platformId.trim(),
  };
}

/**
 * 单个进线邮箱的错误：格式不对，或与前面已填的重复（不分大小写）；没问题返回 null。
 * 保存时逐个检查用它，抽屉里按回车加入一个邮箱前也用它就地检查。
 */
export function mailboxError(mailbox: string, earlier: readonly string[]): string | null {
  const normalized = normalizeMailbox(mailbox);
  if (!emailSchema.safeParse(normalized).success) return INVALID_EMAIL;
  if (earlier.map(normalizeMailbox).includes(normalized)) return `${normalized} 已经填过`;
  return null;
}

/**
 * 表单本身能判断的错误（PRD P18「校验」、K8）：必填项、平台标识为空、邮箱格式、同一店铺内重复的邮箱、
 * 默认站点不在所选站点里。店铺名重复与邮箱被其他店铺占用要查库，由 channel 模块保存时补上，与这里的结果一起返回，
 * 所以抽屉点「保存」后各类错误同时报出（K8）；前端加入单个进线邮箱时用 mailboxError 就地检查。
 */
export function storeInputErrors(raw: StoreInput): FieldErrors {
  const input = normalizeStoreInput(raw);
  const errors: FieldErrors = {};
  if (!input.name) errors.name = '请填写店铺名';
  if (!input.platform) errors.platform = '请选择平台';
  if (input.sites.length === 0) errors.sites = '请选择站点';
  if (!input.defaultSite || !input.sites.includes(input.defaultSite)) {
    errors.defaultSite = '请选择默认站点';
  }
  if (input.mailboxes.length === 0) errors.mailboxes = '至少填写一个进线邮箱';
  input.mailboxes.forEach((mailbox, index) => {
    const error = mailboxError(mailbox, input.mailboxes.slice(0, index));
    if (error) errors[`mailboxes.${index}`] = error;
  });
  if (!input.platformId) {
    errors.platformId = input.platform
      ? platformTerms[input.platform].platformIdMissing
      : '请填写平台标识';
  }
  return errors;
}

/** 要查库才知道的错误与生产环境的限制（channel 模块保存时给出；前两条的文案照原型 K8 与其补充小样） */
export const storeSaveMessages = {
  duplicateName: '店铺名已存在，请换一个',
  mailboxTaken: (mailbox: string, storeName: string) => `${mailbox} 已是 ${storeName} 的进线邮箱`,
  /** 生产环境不显示「数据来源」，只有直接调接口才会收到，原型不画 */
  fakeInProduction: '生产环境不能使用模拟数据',
} as const;

/**
 * 渠道连接状态（PRD 6.9）：已连接 / 同步延迟（Gmail、订单 10 分钟，钉钉 2 小时）/ 连接异常（连续 3 次失败）/ 未连接。
 * 钉钉（05）与 Gmail（09，按邮箱）按同步记录算（syncConnectionStatus）；订单在 11、12 接上同步记录之前只由数据来源决定。
 */
export const connectionStatuses = ['connected', 'delayed', 'error', 'not_connected'] as const;
export const connectionStatusSchema = z.enum(connectionStatuses);
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;
export const connectionStatusLabels: Record<ConnectionStatus, string> = {
  connected: '已连接',
  delayed: '同步延迟',
  error: '连接异常',
  not_connected: '未连接',
};

/** 「最差」的先后：连接异常要马上处理，未连接是还没接通（收不到任何数据），同步延迟只是暂时落后 */
const SEVERITY: Record<ConnectionStatus, number> = {
  connected: 0,
  delayed: 1,
  not_connected: 2,
  error: 3,
};

/** 渠道卡显示该渠道下最差的状态（6.9）；一个连接都没有时为未连接 */
export function worstConnectionStatus(statuses: readonly ConnectionStatus[]): ConnectionStatus {
  if (statuses.length === 0) return 'not_connected';
  return statuses.reduce((worst, status) => (SEVERITY[status] > SEVERITY[worst] ? status : worst));
}

/** 同步延迟的阈值（6.9）：最近一次同步成功超过这么久为同步延迟。Gmail、订单 10 分钟，钉钉 2 小时 */
export const SYNC_DELAY_MS = {
  gmail: 10 * 60_000,
  orders: 10 * 60_000,
  dingtalk: 2 * 60 * 60_000,
} as const;

/** 连续失败这么多次为连接异常（6.9） */
export const CONNECTION_FAILURE_LIMIT = 3;

/** 一个数据源的同步记录：最近一次成功的时间与连续失败的次数 */
export interface SyncHealth {
  readonly lastSuccessAt: Date | null;
  readonly consecutiveFailures: number;
}

/**
 * 按同步记录算连接状态（6.9）：连续 3 次失败为连接异常；从没成功过为未连接；最近一次成功超过阈值为同步延迟；否则已连接
 */
export function syncConnectionStatus(
  health: SyncHealth,
  delayAfterMs: number,
  now: Date,
): ConnectionStatus {
  if (health.consecutiveFailures >= CONNECTION_FAILURE_LIMIT) return 'error';
  if (!health.lastSuccessAt) return 'not_connected';
  return now.getTime() - health.lastSuccessAt.getTime() > delayAfterMs ? 'delayed' : 'connected';
}

/** 店铺的一个连接：Gmail（收件与「已发送」）或订单（亚马逊 SP-API、Shopify Admin API） */
export const storeConnectionSchema = z.object({
  kind: z.enum(['gmail', 'orders']),
  status: connectionStatusSchema,
});
export type StoreConnection = z.infer<typeof storeConnectionSchema>;

/** 店铺（P18 店铺表与抽屉） */
export const storeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  platform: platformSchema,
  sites: z.array(siteSchema),
  defaultSite: siteSchema,
  mailboxes: z.array(z.string()),
  platformId: z.string(),
  adapterMode: adapterModeSchema,
  /** 该店铺各连接的状态（店铺表「状态」列） */
  connections: z.array(storeConnectionSchema),
  version: z.int(),
  updatedAt: z.iso.datetime({ offset: true }),
  /** 最近一次保存的人（姓名快照）；示例数据等系统写入的为 null，界面写「系统」 */
  updatedBy: z.string().nullable(),
});
export type Store = z.infer<typeof storeSchema>;

/** 渠道卡（K20）：第一期四张——亚马逊 SP-API、Shopify Admin API、Gmail、钉钉；积加与易仓是静态的「第二阶段接入」卡 */
export const channelKinds = ['amazon', 'shopify', 'gmail', 'dingtalk'] as const;
export const channelKindSchema = z.enum(channelKinds);
export type ChannelKind = z.infer<typeof channelKindSchema>;

/**
 * 渠道卡上列出的一个异常连接（6.9「列出异常的邮箱或店铺」，K7）：Gmail 为邮箱。只列同步延迟与连接异常——
 * 刚登记、还没同步过的（未连接）不算异常
 */
export const channelIssueSchema = z.object({
  /** 邮箱地址（Gmail）；订单随 11、12 为店铺名 */
  target: z.string(),
  status: z.enum(['delayed', 'error']),
  /** 最近一次同步成功的时间；从没成功过为 null */
  lastSuccessAt: z.iso.datetime({ offset: true }).nullable(),
  /** 这一串连续失败的第 1 次（K7「10:05 起连续 3 次」）；没有在失败为 null */
  failingSince: z.iso.datetime({ offset: true }).nullable(),
  /** 连续失败的次数 */
  failures: z.int().nonnegative(),
});
export type ChannelIssue = z.infer<typeof channelIssueSchema>;

export const channelCardSchema = z.object({
  kind: channelKindSchema,
  /** 该渠道下最差的状态（6.9） */
  status: connectionStatusSchema,
  /** 接的是模拟数据（Fake，只在非生产环境），卡头另标「模拟数据」 */
  simulated: z.boolean(),
  /**
   * 最近一次同步成功的时间：Gmail 取各邮箱中最旧的一次（同报表「更新于」的取法）；还没有同步记录时为 null
   * （订单随 11、12）
   */
  lastSyncAt: z.iso.datetime({ offset: true }).nullable(),
  /** 异常的邮箱（按地址排序）；钉钉卡与没有异常时为空 */
  issues: z.array(channelIssueSchema),
});
export type ChannelCard = z.infer<typeof channelCardSchema>;

/**
 * 全站横幅（G4，GET /api/channel/alerts）：连接异常的渠道（钉钉除外，6.9），所有登录成员都看得到，恢复后自动消失。
 * 第一期只有 Gmail；订单（SP-API、Shopify）随 11、12 加进 kind
 */
export const channelAlertSchema = z.object({
  kind: z.enum(['gmail']),
  /** 连接异常的邮箱（或店铺），按地址排序 */
  targets: z.array(z.string()).min(1),
  /** 最早的一串连续失败从何时起（G4「09-11 10:05 起未收取」） */
  since: z.iso.datetime({ offset: true }),
});
export type ChannelAlert = z.infer<typeof channelAlertSchema>;
export const channelAlertsSchema = z.object({ alerts: z.array(channelAlertSchema) });
export type ChannelAlerts = z.infer<typeof channelAlertsSchema>;

/**
 * 「测试连接」（K20，POST /api/channel/connection-tests/{kind}）：第一期 Gmail 与钉钉两张卡有；亚马逊、Shopify 随 11、12。
 * 测试连接不改连接状态（状态只看同步记录），Gmail 测完立即排一次各邮箱的同步（2026-10-06 用户确认）。
 * 全部可访问时 200 返回测过的对象；有访问不了的返回 502，message 写哪些访问不了（connectionTestMessages）
 */
export const connectionTestKinds = ['gmail', 'dingtalk'] as const;
export const connectionTestKindSchema = z.enum(connectionTestKinds);
export type ConnectionTestKind = z.infer<typeof connectionTestKindSchema>;
export const connectionTestResultSchema = z.object({
  kind: connectionTestKindSchema,
  /** 测过且可访问的：Gmail 为全部进线邮箱，钉钉为通讯录 */
  targets: z.array(z.string()),
});
export type ConnectionTestResult = z.infer<typeof connectionTestResultSchema>;

/** 测试连接失败时 502 的 message（失败浮层标题「测试连接失败：<它>」，2026-10-06 用户确认） */
export const connectionTestMessages = {
  unreachable: (targets: readonly string[]) => `${targets.join('、')} 无法访问`,
  dingtalkUnreachable: '钉钉通讯录无法访问',
} as const;

/** P18 渠道与店铺（GET /api/channel/settings） */
export const channelSettingsSchema = z.object({
  channels: z.array(channelCardSchema),
  stores: z.array(storeSchema),
  /** 是否显示并接受「数据来源：真实接口 / 模拟数据」（只在非生产环境） */
  dataSourceEditable: z.boolean(),
});
export type ChannelSettings = z.infer<typeof channelSettingsSchema>;

/** 店铺选项（GET /api/channel/store-options）：当前成员店铺范围内的店铺，供各页面的店铺筛选与指定店铺（P20 授权选择要列全部店铺，由 06 号待办定） */
export const storeOptionSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  platform: platformSchema,
  sites: z.array(siteSchema),
  defaultSite: siteSchema,
});
export type StoreOption = z.infer<typeof storeOptionSchema>;
export const storeOptionsSchema = z.object({ stores: z.array(storeOptionSchema) });
