/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  can,
  capabilities,
  capabilityGroups,
  CURRENT_PHASE,
  grantsFor,
  isLive,
  type Capability,
  type CapabilityDefinition,
  type Grant,
} from './capabilities';
import { roleLabels, roles, type Role } from './roles';

/*
 * 能力矩阵常量与它的两个出处逐格核对：
 * - PRD 10.1「功能权限」表（design/spec/prd_d.md）：每一行都有对应的能力，阶段与各角色的权限一致；
 * - 原型 K17「角色权限」页签（design/spec/pages/build_settings.py 的 MATRIX）：能力的文案、分组、顺序与格子逐字一致，
 *   P20 的角色权限页签（06 号待办）直接由常量渲染。
 * PRD 或原型改了而常量没跟上，这里会失败。
 */

const PRD_D = readFileSync(new URL('../../../design/spec/prd_d.md', import.meta.url), 'utf8');
const SETTINGS_PAGE = readFileSync(
  new URL('../../../design/spec/pages/build_settings.py', import.meta.url),
  'utf8',
);

interface MatrixRow {
  readonly text: string;
  readonly stage: string;
  /** 各角色的格子，顺序同 PRD 表头（坐席 … 生产厂对接人） */
  readonly cells: readonly string[];
}

function prdMatrix(): { header: string[]; rows: MatrixRow[] } {
  const start = PRD_D.indexOf('### 10.1');
  const section = PRD_D.slice(start, PRD_D.indexOf('### 10.2', start));
  const [header = [], , ...rows] = section
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
  return {
    header,
    rows: rows.map(([text = '', stage = '', ...cells]) => ({ text, stage, cells })),
  };
}

function prototypeMatrix(): { rows: MatrixRow[]; groups: { label: string; rows: number[] }[] } {
  const rows = [
    ...SETTINGS_PAGE.matchAll(/^ {4}\('([^']+)', '(一起|仅一|二起|三)', \[([^\]]*)\]\),$/gm),
  ].map(([, text = '', stage = '', cells = '']) => ({
    text,
    stage,
    cells: cells.split(',').map((cell) => cell.trim().replace(/^'|'$/g, '')),
  }));
  const groupsLine = /^MATRIX_GROUPS = \[([\s\S]+?)\]$/m.exec(SETTINGS_PAGE)?.[1] ?? '';
  const groups = [...groupsLine.matchAll(/\('([^']+)', \(([\d, ]+)\)\)/g)].map(
    ([, label = '', indexes = '']) => ({
      label,
      rows: indexes
        .split(',')
        .map((i) => i.trim())
        .filter(Boolean)
        .map(Number),
    }),
  );
  return { rows, groups };
}

/** PRD 10.1 每一行对应的能力（PRD 的行文与 K17 的文案不完全相同，K17 是缩写） */
const PRD_ROW_TO_CAPABILITY: Record<string, Capability> = {
  '查看工单（列表与详情）': 'ticket.view',
  '标记来信「无需回复」': 'ticket.mark_no_reply',
  为未归属店铺的来信指定店铺: 'ticket.assign_store',
  '回复、标签、合并工单、转人工、手工新建工单、认领未分配工单、标记解决、人工重开与关闭':
    'ticket.handle',
  合并与拆分客户身份: 'customer.merge_identity',
  '改派他人工单、强制接手、调整工单优先级': 'ticket.supervise',
  '提交审批单；含报备或寄件动作时同时创建售后单（路径 B，D-27）': 'approval.submit',
  '在工单上「转售后确认」（发起待确认售后单，D-25）': 'ticket.escalate_aftersales',
  审批含报备的审批单: 'approval.approve_filing',
  审批只含动作的审批单: 'approval.approve_actions',
  撤回审批单: 'approval.withdraw',
  '执行人工操作清单（兜底）': 'approval.execute_manual',
  '查看售后单、登记台账': 'aftersales.view',
  '新建登记（手工登记）': 'aftersales.register',
  '编辑进行中的手工登记单、设为已完成': 'aftersales.edit_open',
  '登记台账补登（已完成的单）、修改汇率': 'aftersales.backfill',
  改派售后单负责人: 'aftersales.reassign_owner',
  '取消（终止）售后单': 'aftersales.cancel',
  '手工新建售后单（P07）、确认责任与处理方式、退回继续排查': 'aftersales.process',
  '发起与录入比例协商、重开协商、退回生产厂报价、生成结算批次': 'aftersales.settle',
  '维护知识条目、素材库、审核沉淀': 'knowledge.maintain',
  查看报表: 'report.view',
  '查看成本、承担比例与结算金额（含报表、导出、下钻与审计前后值）': 'finance.view',
  '查看审计日志（P27）': 'audit.view',
  '售后规则（P23）、标签库、模板、SLA': 'settings.supervisor',
  '处理规则（P19：发送方式、风险信号、渠道内容能力、处理说明）': 'settings.processing_rules',
  '渠道与店铺（P18）、成员与角色、店铺数据范围（P20）': 'settings.channels_team',
  '动作映射（P22）、备用审批人（P20）、工厂账号（P24）、模型（P25）、系统状态（P26）':
    'settings.admin_phase2',
  '工厂工作台：本厂任务的报价、回填、答复、结算确认、留言': 'factory.portal',
};

const STAGE_LABELS: Record<CapabilityDefinition['stage'], string> = {
  p1: '一起',
  p1_only: '仅一',
  p2: '二起',
  p3: '三',
};

/** K17 格子的写法：● 有权限、○ 只能看自己发起或负责的（「○ 自己登记的」写明范围）、文字为部分能力、空为无权限 */
function prototypeCell(grant: Grant | undefined): string {
  if (!grant) return '';
  if (grant.kind === 'full') return '●';
  if (grant.kind === 'own') return grant.scope ? `○ ${grant.scope}` : '○';
  return grant.label;
}

/** PRD 的「○（自己登记的）」与 K17 的「○ 自己登记的」措辞略有不同，按种类比：○ 开头的都是「只能看自己的」 */
function prdCellKind(cell: string): string {
  return cell.startsWith('○') ? '○' : cell;
}

function capability(key: Capability): CapabilityDefinition {
  const found = capabilities.find((c) => c.key === key);
  if (!found) throw new Error(`没有能力 ${key}`);
  return found;
}

describe('能力矩阵常量（PRD 10.1，ADR 0010）', () => {
  const prd = prdMatrix();

  it('PRD 10.1 的表头就是 6 个固定角色，顺序一致', () => {
    expect(prd.header.slice(2)).toEqual(roles.map((role) => roleLabels[role]));
  });

  it('覆盖 PRD 10.1 的全部能力行，一行对应一个能力', () => {
    expect(prd.rows.map((row) => row.text).sort()).toEqual(
      Object.keys(PRD_ROW_TO_CAPABILITY).sort(),
    );
    expect(new Set(Object.values(PRD_ROW_TO_CAPABILITY)).size).toBe(prd.rows.length);
    expect(capabilities.map((c) => c.key).sort()).toEqual(
      Object.values(PRD_ROW_TO_CAPABILITY).sort(),
    );
  });

  it.each(prd.rows.map((row) => [row.text, row] as const))(
    '「%s」的上线阶段与各角色权限同 PRD',
    (_text, row) => {
      const definition = capability(PRD_ROW_TO_CAPABILITY[row.text]!);
      expect(STAGE_LABELS[definition.stage]).toBe(row.stage);
      expect(roles.map((role) => prdCellKind(prototypeCell(definition.grants[role])))).toEqual(
        row.cells.map(prdCellKind),
      );
    },
  );

  it('文案、分组、顺序与格子逐字同原型 K17（P20 角色权限页签由常量直接渲染）', () => {
    const prototype = prototypeMatrix();
    expect(prototype.rows).toHaveLength(capabilities.length);
    expect(
      capabilities.map((c) => ({
        text: c.label,
        stage: STAGE_LABELS[c.stage],
        cells: roles.map((role) => prototypeCell(c.grants[role])),
      })),
    ).toEqual(prototype.rows);
    expect(
      capabilityGroups.map((group) => ({
        label: group.label,
        rows: capabilities.flatMap((c, i) => (c.group === group.key ? [i] : [])),
      })),
    ).toEqual(prototype.groups);
  });

  it('第一期新增与第一期起的能力在第一期已上线，第二、三期的没有', () => {
    expect(CURRENT_PHASE).toBe(1);
    const live = capabilities.filter((c) => isLive(c.key)).map((c) => c.key);
    expect(live).toEqual([
      'ticket.view',
      'ticket.mark_no_reply',
      'ticket.assign_store',
      'aftersales.view',
      'aftersales.register',
      'aftersales.edit_open',
      'aftersales.backfill',
      'aftersales.reassign_owner',
      'aftersales.cancel',
      'report.view',
      'finance.view',
      'audit.view',
      'settings.channels_team',
    ]);
    // 「仅一」的新建登记到第二期下线（售后单改由 P07 手工新建）
    expect(isLive('aftersales.register', 2)).toBe(false);
    expect(isLive('ticket.handle', 2)).toBe(true);
    expect(isLive('knowledge.maintain', 2)).toBe(false);
  });
});

describe('按角色判断权限（多角色取并集）', () => {
  const cases: [Role[], Capability, boolean][] = [
    [['agent'], 'ticket.mark_no_reply', true],
    [['knowledge_owner'], 'ticket.mark_no_reply', false],
    [['agent'], 'finance.view', false],
    [['supervisor'], 'finance.view', true],
    [['aftersales_owner'], 'finance.view', true],
    [['admin'], 'finance.view', false],
    [['admin'], 'settings.channels_team', true],
    [['supervisor'], 'settings.channels_team', false],
    [['agent', 'admin'], 'settings.channels_team', true],
    [['agent', 'knowledge_owner'], 'report.view', true],
    [['factory_contact'], 'finance.view', true],
    [[], 'ticket.view', false],
  ];

  it.each(cases)('%j 有「%s」：%s', (memberRoles, key, expected) => {
    expect(can(memberRoles, key)).toBe(expected);
  });

  it('没有上线的能力谁都没有（第二期的回复、第三期的处理规则）', () => {
    expect(can(roles, 'ticket.handle')).toBe(false);
    expect(can(['supervisor'], 'settings.processing_rules')).toBe(false);
    expect(can(['agent'], 'ticket.handle', 2)).toBe(true);
  });

  it('并集保留每个角色的权限种类，供「只能看自己的」归属校验', () => {
    expect(grantsFor(['supervisor', 'aftersales_owner'], 'aftersales.edit_open')).toEqual([
      { kind: 'own', scope: '自己登记的' },
      { kind: 'own', scope: '登记或负责的' },
    ]);
    expect(grantsFor(['agent'], 'aftersales.view')).toEqual([{ kind: 'partial', label: '只读' }]);
    expect(grantsFor(['agent'], 'settings.channels_team')).toEqual([]);
  });
});
