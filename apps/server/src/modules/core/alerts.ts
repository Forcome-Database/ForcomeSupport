import { businessDateTime } from '@forcome/calendar';
import type { AppEnv } from './config';

/*
 * 运维告警的去重与写法（待办 28，协调者 2026-10-14 决定 Q1、Q3）：worker 每分钟自检得出「此刻异常的项」，与库里正在告警的项
 * （core.alert）比较——
 * - 新出现的项立即提醒；仍异常的项距上次提醒满 ALERT_REPEAT_HOURS 再提醒；恢复的项发「已恢复」；
 * - 同一项按键（队列名、邮箱、数据源等）判断，问题说明里的时刻变了不算新的一项；
 * - 一次自检最多发一条消息：要发时把此刻全部异常的项与刚恢复的项写进同一条（钉钉群机器人每分钟最多 20 条）。
 * 宿主机检查（deploy/lib/host-check.mjs）用同样的写法，部署脚本不依赖应用代码，在那边另写一份。
 */

/** 自检发现的一项异常 */
export interface AlertFinding {
  /** 去重的键，如 gmail:support@forcome.com、job_failed:core.sync_exchange_rates */
  readonly key: string;
  /** 异常的对象，如「Gmail support@forcome.com」「任务 core.sync_exchange_rates」 */
  readonly subject: string;
  /** 问题说明，如「超过 10 分钟没有同步成功（最近成功 10-14 10:02）」 */
  readonly problem: string;
}

/** 正在告警的一项（core.alert 的一行） */
export interface FiringAlert extends AlertFinding {
  readonly firingSince: Date;
  readonly notifiedAt: Date;
}

/** 这次要不要发、发什么 */
export interface AlertPlan {
  /** 此刻全部异常的项：新出现的 firingSince 为 now */
  readonly firing: readonly (AlertFinding & {
    readonly firingSince: Date;
    readonly isNew: boolean;
  })[];
  /** 刚恢复的项 */
  readonly resolved: readonly FiringAlert[];
  /** 要发一条消息：有新出现的、到了再提醒时间的或刚恢复的 */
  readonly send: boolean;
}

/** 比较此刻的异常与正在告警的项 */
export function planAlerts(
  findings: readonly AlertFinding[],
  current: readonly FiringAlert[],
  now: Date,
  repeatMs: number,
): AlertPlan {
  const byKey = new Map(current.map((alert) => [alert.key, alert]));
  const seen = new Set<string>();
  const firing: (AlertFinding & { firingSince: Date; isNew: boolean })[] = [];
  let due = false;
  for (const finding of findings) {
    // 同一个键在一次自检里只算一项（以先出现的为准）
    if (seen.has(finding.key)) continue;
    seen.add(finding.key);
    const before = byKey.get(finding.key);
    if (!before) {
      firing.push({ ...finding, firingSince: now, isNew: true });
      due = true;
      continue;
    }
    firing.push({ ...finding, firingSince: before.firingSince, isNew: false });
    if (now.getTime() - before.notifiedAt.getTime() >= repeatMs) due = true;
  }
  const resolved = current.filter((alert) => !seen.has(alert.key));
  return { firing, resolved, send: due || resolved.length > 0 };
}

/** 消息开头的环境名 */
const ENVIRONMENT_LABELS: Record<AppEnv, string> = {
  production: '生产',
  staging: '开发测试',
  development: '本机',
  test: '测试',
};

/** 告警消息的抬头，如「【Forcome Support · 生产】」 */
export function alertBrand(appEnv: AppEnv): string {
  return `【Forcome Support · ${ENVIRONMENT_LABELS[appEnv]}】`;
}

/** 时刻的写法：北京时间「月-日 时:分」 */
export function alertTime(instant: Date): string {
  return businessDateTime(instant).slice(5, 16);
}

/** 发给钉钉群机器人的一条消息（markdown） */
export interface AlertMessage {
  /** 会话列表里显示的标题 */
  readonly title: string;
  readonly markdown: string;
}

/**
 * 一条自检消息：标题写此刻异常几项（只有恢复时写「已恢复」）；正文每项一行，新出现的标「新」、持续中的写从什么时候起，
 * 恢复的写在「已恢复」下面；末行写检查时刻
 */
export function formatAlertMessage(plan: AlertPlan, appEnv: AppEnv, now: Date): AlertMessage {
  const brand = alertBrand(appEnv);
  const title =
    plan.firing.length > 0
      ? `${brand}自检发现 ${plan.firing.length} 项异常`
      : `${brand}已恢复 ${plan.resolved.length} 项`;
  const lines = [`#### ${title}`, ''];
  for (const item of plan.firing) {
    lines.push(
      item.isNew
        ? `- **新** ${item.subject}：${item.problem}`
        : `- ${item.subject}：${item.problem}（持续中，自 ${alertTime(item.firingSince)}）`,
    );
  }
  if (plan.resolved.length > 0) {
    if (plan.firing.length > 0) lines.push('');
    lines.push('**已恢复**', '');
    for (const item of plan.resolved) {
      lines.push(`- ${item.subject}（异常自 ${alertTime(item.firingSince)}）`);
    }
  }
  lines.push('', `检查时刻 ${alertTime(now)} · 处理见运维手册`);
  return { title, markdown: lines.join('\n') };
}

/**
 * 「告警通道已连通」的测试消息（协调者 2026-10-14 决定 Q1：第一次部署后由部署子命令 alert-test 发一条，便于 29 号核对）。
 * via 写这条消息是经哪一路发的：worker 的自检（应用里的群机器人客户端）或宿主机检查
 */
export function alertTestMessage(
  appEnv: AppEnv,
  now: Date,
  via: string,
  release: string | null,
): AlertMessage {
  const title = `${alertBrand(appEnv)}告警通道已连通`;
  const lines = [
    `#### ${title}`,
    '',
    `这是一条测试消息：${via}发现的异常会发到这个群。`,
    ...(release ? ['', `版本 ${release}`] : []),
    '',
    `发送时刻 ${alertTime(now)}`,
  ];
  return { title, markdown: lines.join('\n') };
}

/**
 * 数据源同步的问题说明（PRD 6.9 的同步延迟与连接异常；未连接与已连接不告警，返回 null）：
 * 「超过 10 分钟没有同步成功（最近成功 10-14 10:02）」「连续 3 次同步失败（自 10-14 10:05 起，最近成功 10-14 10:02）」
 */
export function syncAlertProblem(
  status: 'connected' | 'delayed' | 'error' | 'not_connected',
  health: {
    readonly lastSuccessAt: Date | null;
    readonly consecutiveFailures: number;
    readonly failingSince?: Date | null;
  },
  delayMs: number,
): string | null {
  const last = health.lastSuccessAt
    ? `最近成功 ${alertTime(health.lastSuccessAt)}`
    : '还没有成功过';
  if (status === 'error') {
    const since = health.failingSince ? `自 ${alertTime(health.failingSince)} 起，` : '';
    return `连续 ${health.consecutiveFailures} 次同步失败（${since}${last}）`;
  }
  if (status === 'delayed') return `超过 ${durationWords(delayMs)}没有同步成功（${last}）`;
  return null;
}

/** 「10 分钟」「2 小时」「1 天」 */
function durationWords(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)} 天`;
  if (minutes % 60 === 0) return `${minutes / 60} 小时`;
  return `${minutes} 分钟`;
}

/** 告警的发送方（integration 的钉钉群机器人；core 不依赖 integration，由入口注入，同工作通知） */
export interface AlertSender {
  sendAlert(message: AlertMessage): Promise<void>;
}
