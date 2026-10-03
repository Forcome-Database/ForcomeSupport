import { roles, type Role } from './roles';

/*
 * 能力矩阵（PRD 10.1「功能权限」，ADR 0010）：前端据此显示入口与按钮，后端据此强制；一个成员可有多个角色，权限取并集。
 * 一项能力对应 PRD 10.1 的一行；文案、分组与顺序照原型 K17「角色权限」页签（P20 由本常量直接渲染，只显示当前阶段已上线的行）。
 * 每项能力标注上线阶段；开启新阶段时只改 CURRENT_PHASE（与个别能力的阶段），界面与强制随之变化。
 * 「○ 只能看自己发起或负责的」与「只读」之类的部分权限，能力判断只回答「有没有」，归属与只读由业务模块再校验。
 */

/** 当前上线的阶段（第一期） */
export const CURRENT_PHASE = 1;
export type Phase = 1 | 2 | 3;

/** 上线阶段（PRD 10.1「阶段」列）：一起 = 第一阶段起，仅一 = 只在第一阶段，二起 = 第二阶段起，三 = 第三阶段 */
export type CapabilityStage = 'p1' | 'p1_only' | 'p2' | 'p3';

/** 一个角色对一项能力的权限（K17 的格子；没有权限就不出现） */
export type Grant =
  /** ● 有权限 */
  | { readonly kind: 'full' }
  /** ○ 只能看自己发起或负责的；scope 写明范围（如「自己登记的」） */
  | { readonly kind: 'own'; readonly scope?: string }
  /** 文字：部分能力（如「只读」「本厂部分」） */
  | { readonly kind: 'partial'; readonly label: string };

export const capabilityGroups = [
  { key: 'ticket', label: '工单' },
  { key: 'approval', label: '审批' },
  { key: 'aftersales', label: '售后' },
  { key: 'knowledge', label: '知识' },
  { key: 'report', label: '报表' },
  { key: 'settings', label: '设置' },
  { key: 'factory', label: '工厂' },
] as const;
export type CapabilityGroup = (typeof capabilityGroups)[number]['key'];

export interface CapabilityDefinition {
  readonly key: string;
  readonly group: CapabilityGroup;
  /** K17 的能力文案 */
  readonly label: string;
  readonly stage: CapabilityStage;
  readonly grants: Readonly<Partial<Record<Role, Grant>>>;
}

const full: Grant = { kind: 'full' };
const own = (scope?: string): Grant => (scope ? { kind: 'own', scope } : { kind: 'own' });
const partial = (label: string): Grant => ({ kind: 'partial', label });

const capabilityList = [
  // 工单
  {
    key: 'ticket.view',
    group: 'ticket',
    label: '查看工单（列表与详情）',
    stage: 'p1',
    grants: {
      agent: full,
      supervisor: full,
      aftersales_owner: full,
      knowledge_owner: partial('只读'),
    },
  },
  {
    key: 'ticket.mark_no_reply',
    group: 'ticket',
    label: '标记来信「无需回复」',
    stage: 'p1',
    grants: { agent: full, supervisor: full },
  },
  {
    key: 'ticket.assign_store',
    group: 'ticket',
    label: '为未归属店铺的来信指定店铺',
    stage: 'p1',
    grants: { supervisor: full },
  },
  {
    key: 'ticket.handle',
    group: 'ticket',
    label: '回复、标签、合并、转人工、手工新建、认领、标记解决、重开与关闭',
    stage: 'p2',
    grants: { agent: full, supervisor: full, aftersales_owner: full },
  },
  {
    key: 'customer.merge_identity',
    group: 'ticket',
    label: '合并与拆分客户身份',
    stage: 'p2',
    grants: { agent: full, supervisor: full, aftersales_owner: full },
  },
  {
    key: 'ticket.supervise',
    group: 'ticket',
    label: '改派他人工单、强制接手、调整工单优先级',
    stage: 'p2',
    grants: { supervisor: full },
  },
  // 审批
  {
    key: 'approval.submit',
    group: 'approval',
    label: '提交审批单；提交时同时创建售后单（路径 B）',
    stage: 'p2',
    grants: { agent: full, supervisor: full, aftersales_owner: full },
  },
  {
    key: 'approval.approve_filing',
    group: 'approval',
    label: '审批含报备的审批单',
    stage: 'p2',
    grants: { supervisor: full },
  },
  {
    key: 'approval.approve_actions',
    group: 'approval',
    label: '审批只含动作的审批单',
    stage: 'p2',
    grants: { supervisor: full, aftersales_owner: full },
  },
  {
    key: 'approval.withdraw',
    group: 'approval',
    label: '撤回审批单',
    stage: 'p2',
    grants: { agent: own(), supervisor: own(), aftersales_owner: own() },
  },
  {
    key: 'approval.execute_manual',
    group: 'approval',
    label: '执行人工操作清单（兜底）',
    stage: 'p2',
    grants: { agent: own(), supervisor: own(), aftersales_owner: own() },
  },
  // 售后
  {
    key: 'aftersales.view',
    group: 'aftersales',
    label: '查看售后单、登记台账',
    stage: 'p1',
    grants: { agent: partial('只读'), supervisor: full, aftersales_owner: full },
  },
  {
    key: 'aftersales.register',
    group: 'aftersales',
    label: '新建登记（手工登记）',
    stage: 'p1_only',
    grants: { supervisor: full, aftersales_owner: full },
  },
  {
    key: 'aftersales.edit_open',
    group: 'aftersales',
    label: '编辑进行中的手工登记单、设为已完成',
    stage: 'p1',
    grants: { supervisor: own('自己登记的'), aftersales_owner: own('登记或负责的') },
  },
  {
    key: 'aftersales.backfill',
    group: 'aftersales',
    label: '登记台账补登（已完成的单）、修改汇率',
    stage: 'p1',
    grants: { aftersales_owner: full },
  },
  {
    key: 'aftersales.reassign_owner',
    group: 'aftersales',
    label: '改派售后单负责人',
    stage: 'p1',
    grants: { supervisor: full, aftersales_owner: full },
  },
  {
    key: 'aftersales.cancel',
    group: 'aftersales',
    label: '取消（终止）售后单',
    stage: 'p1',
    grants: { supervisor: full, aftersales_owner: full },
  },
  {
    key: 'ticket.escalate_aftersales',
    group: 'aftersales',
    label: '在工单上「转售后确认」',
    stage: 'p2',
    grants: { agent: full, supervisor: full },
  },
  {
    key: 'aftersales.process',
    group: 'aftersales',
    label: '手工新建售后单、确认责任与处理方式、退回继续排查',
    stage: 'p2',
    grants: { supervisor: full, aftersales_owner: full },
  },
  {
    key: 'aftersales.settle',
    group: 'aftersales',
    label: '发起与录入比例协商、重开协商、退回生产厂报价、生成结算批次',
    stage: 'p2',
    grants: { aftersales_owner: full },
  },
  // 知识
  {
    key: 'knowledge.maintain',
    group: 'knowledge',
    label: '维护知识条目、素材库、审核沉淀',
    stage: 'p3',
    grants: {
      agent: partial('提交候选'),
      supervisor: partial('审核政策规则'),
      aftersales_owner: partial('维护排查树'),
      knowledge_owner: full,
    },
  },
  // 报表（成本可见与审计日志都是「看数据」的能力，原型归入报表组）
  {
    key: 'report.view',
    group: 'report',
    label: '查看报表',
    stage: 'p1',
    grants: { supervisor: full, aftersales_owner: full, knowledge_owner: full, admin: full },
  },
  {
    key: 'finance.view',
    group: 'report',
    label: '查看成本、承担比例与结算金额（含报表、导出、下钻与审计前后值）',
    stage: 'p1',
    grants: { supervisor: full, aftersales_owner: full, factory_contact: partial('本厂部分') },
  },
  {
    key: 'audit.view',
    group: 'report',
    label: '查看审计日志（P27）',
    stage: 'p1',
    grants: {
      agent: own(),
      supervisor: full,
      aftersales_owner: own(),
      knowledge_owner: own(),
      admin: full,
    },
  },
  // 设置
  {
    key: 'settings.supervisor',
    group: 'settings',
    label: '售后规则（P23）、标签库、模板、SLA',
    stage: 'p2',
    grants: { supervisor: full },
  },
  {
    key: 'settings.processing_rules',
    group: 'settings',
    label: '处理规则（P19：发送方式、风险信号、渠道内容能力、处理说明）',
    stage: 'p3',
    grants: { supervisor: full },
  },
  {
    key: 'settings.channels_team',
    group: 'settings',
    label: '渠道与店铺（P18）、成员与角色、店铺数据范围（P20）',
    stage: 'p1',
    grants: { admin: full },
  },
  {
    key: 'settings.admin_phase2',
    group: 'settings',
    label: '动作映射（P22）、备用审批人（P20）、工厂账号（P24）、模型（P25）、系统状态（P26）',
    stage: 'p2',
    grants: { admin: full },
  },
  // 工厂
  {
    key: 'factory.portal',
    group: 'factory',
    label: '工厂工作台：本厂任务的报价、回填、答复、结算确认、留言',
    stage: 'p2',
    grants: { factory_contact: full },
  },
] as const satisfies readonly CapabilityDefinition[];

export type Capability = (typeof capabilityList)[number]['key'];

/** 全部能力，按 K17 的分组与顺序 */
export const capabilities: readonly (CapabilityDefinition & { readonly key: Capability })[] =
  capabilityList;

const byKey = new Map<string, CapabilityDefinition>(capabilities.map((c) => [c.key, c]));

function definitionOf(capability: Capability): CapabilityDefinition {
  const definition = byKey.get(capability);
  if (!definition) throw new Error(`未定义的能力：${capability}`);
  return definition;
}

/** 这项能力在某一阶段是否已上线（默认当前阶段） */
export function isLive(capability: Capability, phase: Phase = CURRENT_PHASE): boolean {
  switch (definitionOf(capability).stage) {
    case 'p1':
      return phase >= 1;
    case 'p1_only':
      return phase === 1;
    case 'p2':
      return phase >= 2;
    case 'p3':
      return phase >= 3;
  }
}

/**
 * 这些角色对一项能力的权限（多角色取并集，按 PRD 10.1 的角色顺序列出各角色的权限种类）；
 * 能力还没上线或都没有权限时为空。「○」的归属校验由调用方按权限种类完成。
 */
export function grantsFor(
  memberRoles: readonly Role[],
  capability: Capability,
  phase: Phase = CURRENT_PHASE,
): Grant[] {
  if (!isLive(capability, phase)) return [];
  const { grants } = definitionOf(capability);
  return roles.flatMap((role) => {
    const grant = memberRoles.includes(role) ? grants[role] : undefined;
    return grant ? [grant] : [];
  });
}

/**
 * 这些角色是否有这项能力（任一角色有即可，「○」与文字的部分权限也算有；能力未上线时谁都没有）。
 * 财务字段的可见性不要用它判断：生产厂对接人的「本厂部分」也算有 finance.view，客服系统里要用 canViewFinance。
 */
export function can(
  memberRoles: readonly Role[],
  capability: Capability,
  phase: Phase = CURRENT_PHASE,
): boolean {
  return grantsFor(memberRoles, capability, phase).length > 0;
}

/** 有这项能力的角色（当前阶段），按 PRD 10.1 的角色顺序；无权限页面 G2 用它写明「只对谁开放」 */
export function rolesWith(capability: Capability, phase: Phase = CURRENT_PHASE): Role[] {
  return roles.filter((role) => can([role], capability, phase));
}
