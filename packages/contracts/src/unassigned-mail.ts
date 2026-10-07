import { z } from 'zod';
import { amazonDomains, sites } from './channel';
import { slaTargetSchema, type SlaTarget } from './sla';

/*
 * 未归属店铺来信队列（PRD E-13、R-ST-02、P04「第一阶段」、I17，待办 15）：收件地址没有登记在任何店铺的来信先不归并成工单，
 * 进这个队列；客服主管指定店铺（5 秒撤销窗口结束后才提交），或管理员登记新店铺、给店铺加进线邮箱后，收件地址匹配的来信自动归位。
 * 这里放前后端共用的：识别依据（收件地址取自哪个头字段）、队列与「指定店铺」的接口模式、按发件域判断的 SLA 目标与界面文案。
 */

/**
 * 收件地址取自的头字段，按识别时的先后：Delivered-To（实际投递到的地址，Gmail 写在最上面）、To、Cc。
 * 写给信落到的店铺邮箱的（To、Cc 里有它）按它的店铺，否则按其中第一个登记过的进线邮箱识别（Delivered-To 里落到的邮箱自己不算）；
 * 都没登记时，第一个地址就是 I17 的「识别依据」
 */
export const recipientHeaders = ['delivered-to', 'to', 'cc'] as const;
export const recipientHeaderSchema = z.enum(recipientHeaders);
export type RecipientHeader = z.infer<typeof recipientHeaderSchema>;

/** 头字段的写法（I17「Delivered-To」「To」） */
export const recipientHeaderLabels: Record<RecipientHeader, string> = {
  'delivered-to': 'Delivered-To',
  to: 'To',
  cc: 'Cc',
};

/** 一封来信的一个收件地址：取自哪个头字段、地址（小写） */
export const recipientSchema = z.object({
  header: recipientHeaderSchema,
  address: z.string(),
});
export type Recipient = z.infer<typeof recipientSchema>;

/** 亚马逊的域：平台的站点域与买家消息中转域（amazon.com、marketplace.amazon.com 等），都精确等于 */
const AMAZON_DOMAINS: ReadonlySet<string> = new Set(
  sites.flatMap((site) => [amazonDomains[site].site, amazonDomains[site].relay]),
);

/** 地址的域（@ 之后，小写）；不是地址时为空串 */
export function domainOf(address: string): string {
  const at = address.lastIndexOf('@');
  return at < 0
    ? ''
    : address
        .slice(at + 1)
        .trim()
        .toLowerCase();
}

/** 是不是亚马逊的域（站点域或买家消息中转域） */
export function isAmazonDomain(domain: string): boolean {
  return AMAZON_DOMAINS.has(domain.toLowerCase());
}

/**
 * 未归属来信的 SLA 目标（E-13：平台按发件域判断）：发件域是亚马逊的域按亚马逊 24 小时，其余按内部目标。
 * 来信还没有店铺，渠道识别不了；归位后按所归店铺重新识别（R-ST-02）。报表的「全部店铺」口径（24）同此
 */
export function unassignedSlaTarget(fromAddress: string): SlaTarget {
  return isAmazonDomain(domainOf(fromAddress)) ? 'platform' : 'internal';
}

/** I17 SLA 一列的第二行：按什么目标计时 */
export const unassignedSlaTargetLabels: Record<SlaTarget, string> = {
  platform: '亚马逊 24 小时',
  internal: '内部目标 24 小时',
};

/** 队列里的一封来信（I17 的一行） */
export const unassignedMailSchema = z.object({
  id: z.uuid(),
  /** 客户：客户渠道身份（亚马逊中转地址、联系表单的回复邮箱，其余为发件地址）与显示名 */
  customer: z.object({ name: z.string(), address: z.string() }),
  subject: z.string(),
  /** 识别依据：第一个收件地址与它取自的头字段（都没登记，所以「未登记」） */
  basis: recipientSchema,
  /** 发件域（From 头的域；Shopify 联系表单通知是 shopify.com） */
  fromDomain: z.string(),
  /** 到达时间（Gmail internalDate，ISO） */
  receivedAt: z.string(),
  /** SLA：按原到达时间照常计时，目标按发件域（unassignedSlaTarget） */
  sla: z.object({ target: slaTargetSchema, dueAt: z.string() }),
});
export type UnassignedMail = z.infer<typeof unassignedMailSchema>;

/** GET /api/channel/unassigned-mail：队列（按到达时间倒序）与服务端当前时刻（算 SLA 剩余） */
export const unassignedMailListSchema = z.object({
  mails: z.array(unassignedMailSchema),
  now: z.string(),
});
export type UnassignedMailList = z.infer<typeof unassignedMailListSchema>;

/** POST /api/channel/unassigned-mail/{id}/store：指定店铺 */
export const assignStoreInputSchema = z.object({ storeId: z.uuid() });
export type AssignStoreInput = z.infer<typeof assignStoreInputSchema>;

/** 指定店铺的结果：来信归入的店铺（之后由 ticket 按 R-ST-02 关联订单并归并成工单） */
export const assignStoreResultSchema = z.object({
  id: z.uuid(),
  store: z.object({ id: z.uuid(), name: z.string() }),
});
export type AssignStoreResult = z.infer<typeof assignStoreResultSchema>;

/** 「指定」后的撤销窗口（I17、D-24：窗口结束后才提交） */
export const ASSIGN_UNDO_SECONDS = 5;

/**
 * 指定店铺被拒的说明（接口错误的 message）：409 别人先指定了或已自动归位——写已归入的店铺（界面浮层的说明，
 * 协调者 2026-10-07 决定 Q8），来信已不在队列里却没有店铺（重新识别后归档）时写不在队列里；400 没有这个店铺
 */
export const assignStoreMessages = {
  placedIn: (store: string) => `已归入 ${store}`,
  notInQueue: '已不在未归属店铺队列里',
  unknownStore: '没有这个店铺',
} as const;

/** 站内通知的写法（11.4；原型 G10「未归属店铺来信」与补充小样「未归属店铺来信已自动归位」，协调者 2026-10-07 决定） */
export const unassignedNotificationCopy = {
  arrived: {
    title: '未归属店铺来信',
    /** 「Tom Harris · amz-ca2@forcome.com 未登记」 */
    body: (customer: string, address: string) => `${customer} · ${address} 未登记`,
    /** 对象：P04 的未归属店铺队列 */
    label: 'P04 · 未归属店铺',
  },
  placed: {
    title: '未归属店铺来信已自动归位',
    /** 「Tom Harris · amz-ca2@forcome.com 已归入 Forcome Direct」 */
    body: (customer: string, address: string, store: string) =>
      `${customer} · ${address} 已归入 ${store}`,
  },
} as const;
