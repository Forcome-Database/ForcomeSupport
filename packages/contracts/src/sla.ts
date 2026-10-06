import { z } from 'zod';
import type { TicketChannel } from './ticket';

/*
 * SLA（PRD R-SL-01–R-SL-03、R-SL-07、R-SL-08，待办 16）：以每一封应回复来信（来源为客户）为对象，
 * 从到达邮箱（Gmail internalDate）起，到我方对它的第一封回复（回复的 internalDate）止。
 * 第一阶段：亚马逊 24 自然小时（平台考核）；Shopify 与邮件内部目标 24 小时（不计入平台考核，第一阶段固定，店铺覆盖随第二期）。
 * 这里放前后端共用的口径（截止、结果、目标种类）与 P04、P05 的「剩余 / 已超时」写法；
 * 结果按来信保存在 ticket 模块（ticket.ticket_message），每分钟扫描把过了截止仍未回复的改为未达标。
 */

/** 第一阶段的 SLA 时长（小时）：亚马逊与内部目标都是 24 小时 */
export const SLA_HOURS = 24;

/** SLA 目标的种类：亚马逊为平台 SLA；Shopify 与邮件为内部目标（显示时加「· 内部」） */
export const slaTargets = ['platform', 'internal'] as const;
export const slaTargetSchema = z.enum(slaTargets);
export type SlaTarget = z.infer<typeof slaTargetSchema>;

/**
 * 一封应回复来信的 SLA 结果（11.1 Message、R-SL-08）：达标 · 未达标 · 未到期（还没回复、也没过截止）·
 * 无需回复（被「标记无需回复」，不计入 SLA，待办 17）。达标率的分母只计已回复或已超期的（D-23）
 */
export const slaResults = ['met', 'missed', 'pending', 'not_required'] as const;
export const slaResultSchema = z.enum(slaResults);
export type SlaResult = z.infer<typeof slaResultSchema>;
export const slaResultLabels: Record<SlaResult, string> = {
  met: '达标',
  missed: '未达标',
  pending: '未到期',
  not_required: '无需回复',
};

/** 来信渠道对应的 SLA 目标（R-SL-02）：按这封来信自己的渠道（同一张工单里可能有亚马逊中转来信与直邮） */
export function slaTargetOf(channel: TicketChannel): SlaTarget {
  return channel === 'amazon' ? 'platform' : 'internal';
}

/** SLA 截止：到达时间 + 24 自然小时（含周末，R-SL-02） */
export function slaDueAt(arrivedAt: Date): Date {
  return new Date(arrivedAt.getTime() + SLA_HOURS * 3_600_000);
}

/**
 * 还没被标记无需回复的来信的 SLA 结果：有首次回复时按回复时刻与截止比（截止那一刻回复也算达标）；
 * 还没回复时，过了截止为未达标，否则未到期。工单关闭时仍未回复的另由关闭一律计未达标（R-SL-07）
 */
export function slaResultOf(input: {
  readonly dueAt: Date;
  readonly firstReplyAt: Date | null;
  readonly now: Date;
}): Exclude<SlaResult, 'not_required'> {
  const { dueAt, firstReplyAt, now } = input;
  if (firstReplyAt) return firstReplyAt.getTime() <= dueAt.getTime() ? 'met' : 'missed';
  return now.getTime() > dueAt.getTime() ? 'missed' : 'pending';
}

/** SLA 剩余的颜色（R-SL-03）：≤ 2 小时与已超时红色，≤ 6 小时黄色 */
export type SlaTone = 'danger' | 'warning' | 'normal';

const MINUTE = 60_000;
const DAY_MINUTES = 24 * 60;
const DANGER_MINUTES = 2 * 60;
const WARNING_MINUTES = 6 * 60;

function hoursMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/**
 * 「剩余 / 已超时」的写法（R-SL-03，P04 的 SLA 列、P05 的 SLA 结果）：剩余「5h 40m」（不足一分钟的秒数舍去，宁可少报剩余）；
 * 过了截止「已超时 2h 05m」（不足一分钟按一分钟），满 24 小时「已超时 1d 3h」；内部目标在数值后加「· 内部」
 */
export function slaRemainingWords(input: {
  readonly dueAt: Date;
  readonly now: Date;
  readonly target: SlaTarget;
}): { text: string; tone: SlaTone } {
  const left = input.dueAt.getTime() - input.now.getTime();
  const suffix = input.target === 'internal' ? ' · 内部' : '';
  if (left >= 0) {
    const minutes = Math.floor(left / MINUTE);
    const tone: SlaTone =
      minutes <= DANGER_MINUTES ? 'danger' : minutes <= WARNING_MINUTES ? 'warning' : 'normal';
    return { text: `${hoursMinutes(minutes)}${suffix}`, tone };
  }
  const over = Math.ceil(-left / MINUTE);
  const amount =
    over < DAY_MINUTES
      ? hoursMinutes(over)
      : `${Math.floor(over / DAY_MINUTES)}d ${Math.floor((over % DAY_MINUTES) / 60)}h`;
  return { text: `已超时 ${amount}${suffix}`, tone: 'danger' };
}
