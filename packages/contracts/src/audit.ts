import { z } from 'zod';
import {
  aftersalesOriginSchema,
  aftersalesStatusSchema,
  claimStatusSchema,
  claimTargetSchema,
  feeItems,
  feesSchema,
  handlingMethodSchema,
  ratiosSchema,
  responsibilitySchema,
  shipperSchema,
} from './aftersales';
import { memberStatusSchema, storeScopeSchema } from './auth';
import { connectionStatusSchema, mailProviderSchema, platformSchema, siteSchema } from './channel';
import { financeField } from './finance';
import { adapterModeSchema } from './integration';
import { reportPeriodSchema } from './report';
import { roleSchema } from './roles';
import { ticketChannelSchema, ticketStatusSchema } from './ticket';
import { recipientHeaderSchema } from './unassigned-mail';

/**
 * 审计对象类型与中文名（PRD 11.1 AuditLog、P27 筛选「对象类型」）。
 * 第一期只出现前九种；审批单随第二期（P27「第一阶段」）。
 */
export const auditObjectTypeLabels = {
  ticket: '工单',
  message: '来信',
  aftersales: '售后单',
  store: '店铺',
  channel: '渠道',
  member: '成员',
  setting: '设置',
  export: '导出',
  login: '登录',
  approval: '审批单',
} as const;

export type AuditObjectType = keyof typeof auditObjectTypeLabels;
export const auditObjectTypeSchema = z.enum(
  Object.keys(auditObjectTypeLabels) as [AuditObjectType, ...AuditObjectType[]],
);

/** 第一期 P27「对象类型」筛选的选项（PRD P27「第一阶段」：审批单随第二阶段） */
export const phase1AuditObjectTypes = [
  'ticket',
  'message',
  'aftersales',
  'store',
  'channel',
  'member',
  'setting',
  'export',
  'login',
] as const satisfies readonly AuditObjectType[];

/** 系统操作在审计里的操作人（PRD 10.2：系统操作写「系统」） */
export const SYSTEM_ACTOR_NAME = '系统';

// ---------------------------------------------------------------- 前后值的结构（快照）

/*
 * 每种动作的前后值（完整快照）在这里声明结构：写审计时按它做类型检查（core 的 recordAudit），P27 显示时按它过滤财务字段
 * （maskFinanceFields：财务字段换成「已隐藏」，结构里没声明的键不放行，K18），再按 audit-log.ts 的字段表写成中文。
 * 新增一种审计动作：在 auditActions 登记（叫法、对象类型、快照），快照结构放这里，字段表放 audit-describe.ts。
 */

/**
 * 店铺（P18 抽屉的全部字段，K8）。进线邮箱的地址仍在 mailboxes；服务商、163 企业邮箱的 IMAP 服务器与端口在 mailboxServers
 * （D-28，待办 35 起才有）。客户端授权码不记内容：这次保存重新填写了授权码的进线邮箱只把地址记在后值的 authCodeRenewed，
 * P27 写「进线邮箱 <地址>：客户端授权码已重新填写」（PRD P27、AC-P1-23）
 */
export const storeAuditSnapshotSchema = z.object({
  name: z.string(),
  platform: platformSchema.nullable(),
  sites: z.array(siteSchema),
  defaultSite: siteSchema.nullable(),
  mailboxes: z.array(z.string()),
  mailboxServers: z
    .array(
      z.object({
        address: z.string(),
        provider: mailProviderSchema,
        imapHost: z.string().nullable(),
        imapPort: z.int().nullable(),
      }),
    )
    .optional(),
  authCodeRenewed: z.array(z.string()).optional(),
  platformId: z.string(),
  adapterMode: adapterModeSchema,
});

/**
 * 售后单（台账一张单的完整登记：抽屉能填的全部字段与系统定下的编号、状态、创建路径、登记人、完成与取消）。
 * 费用、承担比例与取消时保留的费用项是财务字段（PRD 10.1「查看成本、承担比例与结算金额（含……审计前后值）」）
 */
export const aftersalesAuditSnapshotSchema = z.object({
  number: z.string(),
  status: aftersalesStatusSchema,
  origin: aftersalesOriginSchema,
  storeId: z.string(),
  site: siteSchema.nullable(),
  sourceTicket: z.string().nullable(),
  orderNumber: z.string().nullable(),
  customerName: z.string().nullable(),
  registeredBy: z.string().nullable(),
  ownerId: z.string().nullable(),
  ownerName: z.string().nullable(),
  feeDate: z.string().nullable(),
  method: handlingMethodSchema.nullable(),
  responsibility: responsibilitySchema.nullable(),
  responsibilityReason: z.string().nullable(),
  factory: z.string().nullable(),
  part: z.object({ sku: z.string(), quantity: z.int().nullable() }).nullable(),
  shipper: shipperSchema.nullable(),
  carrier: z.string().nullable(),
  shipDate: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  claimTarget: claimTargetSchema.nullable(),
  claimStatus: claimStatusSchema.nullable(),
  fees: financeField(feesSchema),
  ratios: financeField(ratiosSchema.nullable()),
  completedAt: z.string().nullable(),
  cancellation: z
    .object({
      reason: z.string().nullable(),
      at: z.string().nullable(),
      keptFees: financeField(z.array(z.enum(feeItems))),
    })
    .nullable(),
});

/** 台账导出（S11、K5）：文件名、这次的筛选条件（含按的费用发生日起止）、行数、是否含财务字段 */
export const ledgerExportAuditSnapshotSchema = z.object({
  fileName: z.string(),
  filters: z.object({
    store: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    method: handlingMethodSchema.optional(),
    responsibility: responsibilitySchema.optional(),
    status: aftersalesStatusSchema.optional(),
    owner: z.string().optional(),
    missing: z.literal('1').optional(),
  }),
  rows: z.int(),
  financeFields: z.boolean(),
});

/**
 * 报表导出（P17、K5，待办 25）：文件名、筛选条件（期间与起止、店铺、站点）、各表的数据行数之和、是否含财务字段
 * （有财务权限时文件里有「售后成本按责任类型」，PRD P17「第一阶段」v2.35）
 */
export const reportExportAuditSnapshotSchema = z.object({
  fileName: z.string(),
  filters: z.object({
    period: reportPeriodSchema,
    from: z.string(),
    to: z.string(),
    store: z.string().optional(),
    site: siteSchema.optional(),
  }),
  rows: z.int(),
  financeFields: z.boolean(),
});

/** 审计日志导出（P27「导出」，按当前筛选）：文件名、筛选条件、行数 */
export const auditExportAuditSnapshotSchema = z.object({
  fileName: z.string(),
  filters: z.object({
    period: z.string(),
    from: z.string(),
    to: z.string(),
    actor: z.string().optional(),
    type: auditObjectTypeSchema.optional(),
    /** 「动作」筛选的键（auditActionFilterKeys） */
    action: z.string().optional(),
    q: z.string().optional(),
  }),
  rows: z.int(),
});

/** 登录方式：钉钉扫码（G11，随待办 05）、开发登录（只在非生产环境） */
export const loginMethods = ['dingtalk', 'dev'] as const;
export const loginMethodLabels: Record<(typeof loginMethods)[number], string> = {
  dingtalk: '钉钉扫码',
  dev: '开发登录',
};
export const loginAuditSnapshotSchema = z.object({ method: z.enum(loginMethods) });

/**
 * 成员（钉钉同步改变的在职状态，待办 05；P20 的角色与店铺范围，待办 06）：姓名、钉钉部门、状态、角色、店铺范围。
 * 店铺范围是待办 06 加的，之前的钉钉同步记录没有它（可选）
 */
export const memberAuditSnapshotSchema = z.object({
  name: z.string(),
  dept: z.string(),
  status: memberStatusSchema,
  roles: z.array(roleSchema),
  stores: storeScopeSchema.optional(),
});

/** 越权访问（E-24）：原因、越权的店铺、请求 */
export const accessDeniedAuditSnapshotSchema = z.object({
  reason: z.literal('store_scope'),
  storeIds: z.array(z.string()),
  method: z.string(),
  path: z.string(),
});

/**
 * 渠道连接（待办 09；PRD P27「第一阶段」的「渠道」对象、原型 AUDIT_LOG 与 AUDIT_P27_EXPAND）：某个 Gmail 邮箱、163 企业邮箱的邮箱
 * （待办 35，写法同 Gmail）、Shopify 店铺（待办 11）或亚马逊店铺（待办 12）进入连接异常与恢复连接，操作人「系统」。状态、最近同步成功的时间、恢复时补拉了多少（Gmail 为来信与到达时间的起止，
 * Shopify 与亚马逊为订单与平台更新时间的起止）与触发（前值「连续 N 次失败」、恢复的后值「第 N 次重试成功」）。
 * channel 写是哪个渠道（决定「补拉」的单位）；待办 09 写下的记录没有它，是 Gmail
 */
/** 渠道连接记录的渠道（快照的 channel） */
export const auditChannels = ['gmail', 'qiye163', 'shopify', 'amazon'] as const;
export type AuditChannel = (typeof auditChannels)[number];

export const channelAuditSnapshotSchema = z.object({
  channel: z.enum(auditChannels).optional(),
  status: connectionStatusSchema,
  lastSuccessAt: z.string().nullable(),
  backfilled: z.object({ count: z.int().positive(), from: z.string(), to: z.string() }).nullable(),
  trigger: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('failures'), count: z.int().positive() }),
      z.object({ kind: z.literal('retry_succeeded'), attempt: z.int().positive() }),
    ])
    .nullable(),
});

/**
 * 来信的店铺（待办 15；协调者 2026-10-07 决定）：未归属店铺的来信被客服主管「指定店铺」或登记新店铺后「自动归位」时记，
 * 前后值为店铺（前值为空）、按所归店铺重新识别的站点与渠道（前值为未归属时的样子：站点为空，渠道按发件域暂定）、
 * 识别依据（收件地址与它取自的头字段）与主题
 */
export const messageStoreAuditSnapshotSchema = z.object({
  storeId: z.string().nullable(),
  site: siteSchema.nullable(),
  channel: ticketChannelSchema.nullable(),
  recipient: z.string(),
  recipientHeader: recipientHeaderSchema,
  subject: z.string(),
});

/**
 * 来信的「标记无需回复」（待办 17，协调者 2026-10-07 决定 Q4，同待办 15 来信对象的写法）：坐席、客服主管在 P05 标记与 5 秒内撤销时记，
 * 对象是工单。前后值为来信（客户与到达时刻，前后相同）、无需回复（操作人与时刻；没有标记为空）与工单状态
 */
const whoAtSchema = z.object({ name: z.string(), at: z.string() });
export const ticketNoReplyAuditSnapshotSchema = z.object({
  message: whoAtSchema,
  noReply: whoAtSchema.nullable(),
  status: ticketStatusSchema,
});

/** 没有前后值的动作（如退出登录） */
export const emptyAuditSnapshotSchema = z.object({});

export const auditSnapshotSchemas = {
  store: storeAuditSnapshotSchema,
  aftersales: aftersalesAuditSnapshotSchema,
  ledgerExport: ledgerExportAuditSnapshotSchema,
  auditExport: auditExportAuditSnapshotSchema,
  reportExport: reportExportAuditSnapshotSchema,
  login: loginAuditSnapshotSchema,
  member: memberAuditSnapshotSchema,
  accessDenied: accessDeniedAuditSnapshotSchema,
  channel: channelAuditSnapshotSchema,
  messageStore: messageStoreAuditSnapshotSchema,
  ticketNoReply: ticketNoReplyAuditSnapshotSchema,
  empty: emptyAuditSnapshotSchema,
} as const;
export type AuditSnapshotKind = keyof typeof auditSnapshotSchemas;

// ---------------------------------------------------------------- 动作

interface AuditActionDefinition {
  /** P27「动作」列与筛选的叫法 */
  readonly label: string;
  /** 动作作用的对象类型；越权访问可以是任何对象（null） */
  readonly objectType: AuditObjectType | null;
  readonly snapshot: AuditSnapshotKind;
  /** 「动作」筛选里的项：叫法相同的几种动作合为一项时写同一个键（如两种「导出 Excel」都是 export）；不写即动作本身 */
  readonly filter?: string;
}

/**
 * 审计动作（`对象.动词`，ADR 0010）与叫法。写审计只能用这里登记的动作（core 的 recordAudit 按它检查动作、对象类型与前后值的
 * 类型），P27 的「动作」筛选也从这里来。新增一种动作：在这里登记，快照结构放上面，字段表与摘要写法放 audit-describe.ts。
 */
export const auditActions = {
  'store.create': { label: '新增店铺', objectType: 'store', snapshot: 'store' },
  'store.update': { label: '编辑店铺', objectType: 'store', snapshot: 'store' },
  'aftersales.create': { label: '新建登记', objectType: 'aftersales', snapshot: 'aftersales' },
  // 售后登记表导入命令（PRD 第 14 节，待办 27）：每张导入的单一条，操作人「系统」，后值为完整登记（协调者 2026-10-06 决定）
  'aftersales.import': { label: '历史导入', objectType: 'aftersales', snapshot: 'aftersales' },
  'aftersales.update': { label: '编辑登记', objectType: 'aftersales', snapshot: 'aftersales' },
  'aftersales.backfill': { label: '补登', objectType: 'aftersales', snapshot: 'aftersales' },
  'aftersales.change_rate': {
    label: '修改汇率',
    objectType: 'aftersales',
    snapshot: 'aftersales',
  },
  'aftersales.complete': { label: '设为已完成', objectType: 'aftersales', snapshot: 'aftersales' },
  'aftersales.undo_complete': {
    label: '撤销设为已完成',
    objectType: 'aftersales',
    snapshot: 'aftersales',
  },
  'aftersales.cancel': { label: '取消', objectType: 'aftersales', snapshot: 'aftersales' },
  // 改派负责人（待办 23，协调者 2026-10-14 决定 Q9）：P13 改派与管理员停用成员时在弹窗里改派（每张单一条）；
  // 钉钉离职自动停用后进入改派队列（操作人「系统」，负责人写「待分配」）
  'aftersales.reassign': { label: '改派负责人', objectType: 'aftersales', snapshot: 'aftersales' },
  'aftersales.reassign_queue': {
    label: '进入改派队列',
    objectType: 'aftersales',
    snapshot: 'aftersales',
  },
  'ledger.export': {
    label: '导出 Excel',
    objectType: 'export',
    snapshot: 'ledgerExport',
    filter: 'export',
  },
  'audit.export': {
    label: '导出 Excel',
    objectType: 'export',
    snapshot: 'auditExport',
    filter: 'export',
  },
  // P17 报表导出（待办 25）：同台账导出，按导出时选的店铺归属（10.2）
  'report.export': {
    label: '导出 Excel',
    objectType: 'export',
    snapshot: 'reportExport',
    filter: 'export',
  },
  'access.denied': { label: '越权访问被拒', objectType: null, snapshot: 'accessDenied' },
  'auth.login': { label: '登录', objectType: 'login', snapshot: 'login' },
  // 钉钉通讯录同步（待办 05）：只记影响能否进入的两种，操作人「系统」。新增成员、改名与换部门只是通讯录镜像，不记
  'member.dingtalk_left': { label: '钉钉离职停用', objectType: 'member', snapshot: 'member' },
  'member.dingtalk_rejoined': { label: '钉钉恢复在职', objectType: 'member', snapshot: 'member' },
  // P20（待办 06）：从钉钉添加（给通讯录同步进来、还没有角色的人分配角色与店铺范围）；吸底保存栏的保存按改了什么记一条
  'member.add': { label: '添加成员', objectType: 'member', snapshot: 'member' },
  'member.change_roles': { label: '修改角色', objectType: 'member', snapshot: 'member' },
  'member.change_stores': { label: '修改店铺范围', objectType: 'member', snapshot: 'member' },
  'member.change_access': {
    label: '修改角色与店铺范围',
    objectType: 'member',
    snapshot: 'member',
  },
  // P20 停用成员（待办 23）：改派与停用同一次提交，改派的单各记一条「改派负责人」
  'member.disable': { label: '停用成员', objectType: 'member', snapshot: 'member' },
  'auth.logout': { label: '退出登录', objectType: 'login', snapshot: 'empty' },
  // 渠道连接（待办 09）：某个 Gmail 邮箱连续 3 次失败进入连接异常、之后同步成功恢复连接，操作人「系统」（2026-10-06 用户确认）
  'channel.disconnected': { label: '连接异常', objectType: 'channel', snapshot: 'channel' },
  'channel.recovered': { label: '恢复连接', objectType: 'channel', snapshot: 'channel' },
  // 未归属店铺的来信（待办 15，协调者 2026-10-07 决定）：客服主管指定店铺；登记新店铺或进线邮箱后收件地址匹配的自动归位（操作人「系统」）
  'message.assign_store': { label: '指定店铺', objectType: 'message', snapshot: 'messageStore' },
  'message.auto_place': { label: '自动归位', objectType: 'message', snapshot: 'messageStore' },
  // P05 的唯一写操作（待办 17，协调者 2026-10-07 决定 Q4）：坐席、客服主管标记来信无需回复，与 5 秒内撤销
  'ticket.mark_no_reply': {
    label: '标记无需回复',
    objectType: 'ticket',
    snapshot: 'ticketNoReply',
  },
  'ticket.undo_no_reply': {
    label: '撤销标记无需回复',
    objectType: 'ticket',
    snapshot: 'ticketNoReply',
  },
} as const satisfies Record<string, AuditActionDefinition>;

export type AuditAction = keyof typeof auditActions;

/** 某个动作的前后值（写审计时的输入形状） */
export type AuditSnapshot<A extends AuditAction> = z.input<
  (typeof auditSnapshotSchemas)[(typeof auditActions)[A]['snapshot']]
>;

/** 某个动作写审计时的对象类型：登记了对象类型的只能是它，越权访问可以是任何对象 */
export type AuditActionObjectType<A extends AuditAction> =
  (typeof auditActions)[A]['objectType'] extends AuditObjectType
    ? (typeof auditActions)[A]['objectType']
    : AuditObjectType;

export function isAuditAction(value: string): value is AuditAction {
  return Object.hasOwn(auditActions, value);
}

/** 越权访问被拒（E-24）：P27 红色标出、可按动作筛选 */
export const ACCESS_DENIED_ACTION = 'access.denied' satisfies AuditAction;

const actionEntries = Object.entries(auditActions) as [AuditAction, AuditActionDefinition][];
/** 筛选键（filter 只在 auditActions 里写，类型上就是 AuditActionFilterKey 之一） */
const filterKeyOf = (action: AuditAction, definition: AuditActionDefinition) =>
  (definition.filter ?? action) as AuditActionFilterKey;

/** 「动作」筛选的一项的键：登记了 filter 的写它（如 export），否则就是动作本身 */
export type AuditActionFilterKey = {
  [A in AuditAction]: (typeof auditActions)[A] extends { readonly filter: infer F } ? F : A;
}[AuditAction];

/** 「动作」筛选的键（地址栏与接口里写它，不写叫法：改叫法不影响旧链接与导出记录） */
export const auditActionFilterKeys = [
  ...new Set(actionEntries.map(([action, definition]) => filterKeyOf(action, definition))),
] as [AuditActionFilterKey, ...AuditActionFilterKey[]];
export const auditActionFilterSchema = z.enum(auditActionFilterKeys);

/** 「动作」筛选的选项（按登记顺序）：选了对象类型时只列该类型的动作，越权访问被拒对任何对象都列 */
export function auditActionFilterOptions(
  type?: AuditObjectType,
): { readonly value: AuditActionFilterKey; readonly label: string }[] {
  const options = new Map<AuditActionFilterKey, string>();
  for (const [action, definition] of actionEntries) {
    if (type && definition.objectType !== null && definition.objectType !== type) continue;
    options.set(filterKeyOf(action, definition), definition.label);
  }
  return [...options].map(([value, label]) => ({ value, label }));
}

/** 「动作」筛选的一项对应的动作；认不出的键为空列表 */
export function auditActionsOfFilter(key: string): AuditAction[] {
  return actionEntries
    .filter(([action, definition]) => filterKeyOf(action, definition) === key)
    .map(([action]) => action);
}

/** 「动作」筛选的一项的叫法（认不出的键原样返回，例如导出记录里的旧值） */
export function auditActionFilterLabel(key: string): string {
  return (
    actionEntries.find(([action, definition]) => filterKeyOf(action, definition) === key)?.[1]
      .label ?? key
  );
}
