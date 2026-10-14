import { hostname } from 'node:os';
import { businessDate, startOfBusinessDate } from '@forcome/calendar';
import { SYNC_DELAY_MS } from '@forcome/contracts';
import { and, countDistinct, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  alertClip as clip,
  alertTime,
  formatAlertMessage,
  planAlerts,
  type AlertFinding,
  type AlertSender,
  type FiringAlert,
} from './alerts';
import type { AlertSettings, AppEnv } from './config';
import type { DbExecutor } from './db';
import { defineJob, type JobContext } from './jobs';
import { transaction, type Runtime } from './runtime';
import {
  alertState,
  backupRun,
  exchangeRateSync,
  workerHeartbeat,
  workNotification,
} from './schema';

/*
 * worker 每分钟自检（规格「运维」第 97 条、ADR 0013 修订「监控告警」，待办 28；阈值与写法见协调者 2026-10-14 决定 Q1–Q4）：
 * 1. 写心跳（core.worker_heartbeat）：宿主机检查不经 worker 读它；
 * 2. 跑各自检项：core 自己的（任务队列积压与失败、钉钉配额、汇率同步、备份与 WAL 归档），加上入口交进来的各模块的
 *    （Gmail、订单与 SQS、回补与对账、钉钉通讯录、外部调用错误率，见 apps/server/src/jobs.ts）；某一项自己出错算一项异常；
 * 3. 与正在告警的项比较（alerts.ts 的 planAlerts），要发时经钉钉群机器人发一条（AlertSender，由入口注入）。
 * 发送失败不记状态，下一分钟再试；机器人没配置（生产缺 Webhook 时照常启动）只写日志，状态照记，免得每分钟都写同一条。
 */

/** 自检项能用到的 */
export interface SelfCheckContext {
  readonly db: DbExecutor;
  /** 自检的「当前时间」（运行时的时钟；任务队列的等待与失败按数据库时间算，见下） */
  readonly now: Date;
  readonly appEnv: AppEnv;
  readonly settings: AlertSettings;
}

/** 一个自检项 */
export interface SelfCheckProbe {
  /** 名字：这一项自己出错时写进告警，如「Gmail 同步」 */
  readonly name: string;
  check(context: SelfCheckContext): Promise<readonly AlertFinding[]>;
}

export const selfCheckJob = defineJob(
  'core.self_check',
  z.object({}),
  // 同时最多一个排队、一个在跑；失败了下一分钟照常再查（不重试，过期 5 分钟）
  { policy: 'stately', retryLimit: 0, expireInSeconds: 300 },
  { cron: '* * * * *', tz: 'Asia/Shanghai', runAtStartup: true },
);

/** 一次自检的结果（任务日志与测试用） */
export interface SelfCheckReport {
  readonly findings: readonly AlertFinding[];
  /** 发了一条消息（或没配置机器人、只写了日志） */
  readonly notified: boolean;
  /** 发送失败（下一分钟再试） */
  readonly sendFailed: boolean;
}

/** 机器人没配置（生产缺 Webhook）：只写日志，照常记状态 */
function isNotConfigured(error: unknown): boolean {
  return error instanceof Error && error.name === 'ClientNotConfiguredError';
}

export async function runSelfCheck(
  runtime: Runtime,
  deps: {
    readonly probes: readonly SelfCheckProbe[];
    readonly sender: AlertSender;
    readonly appEnv: AppEnv;
    readonly settings: AlertSettings;
  },
  context: Pick<JobContext, 'logger'>,
): Promise<SelfCheckReport> {
  const now = runtime.clock.now();
  // 心跳按数据库时间写：宿主机检查拿它与数据库的 now() 比（开发测试环境的运行时时钟可以设 CLOCK_START）
  const beat = { beatAt: sql`now()`, host: hostname(), pid: process.pid };
  await runtime.db
    .insert(workerHeartbeat)
    .values({ id: 'worker', ...beat })
    .onConflictDoUpdate({ target: workerHeartbeat.id, set: beat });

  const probeContext: SelfCheckContext = {
    db: runtime.db,
    now,
    appEnv: deps.appEnv,
    settings: deps.settings,
  };
  const findings: AlertFinding[] = [];
  let probeFailed = false;
  for (const probe of deps.probes) {
    try {
      findings.push(...(await probe.check(probeContext)));
    } catch (error) {
      probeFailed = true;
      context.logger.error({ err: error, probe: probe.name }, '自检项出错');
      findings.push({
        key: `self_check:${probe.name}`,
        subject: `自检项「${probe.name}」`,
        problem: `执行出错：${clip(error instanceof Error ? error.message : String(error))}`,
      });
    }
  }

  const current: FiringAlert[] = await runtime.db.select().from(alertState);
  // 有自检项出错时，这一项原来在告警的异常这次看不到：照旧算在告警，不误报「已恢复」
  if (probeFailed) {
    const seen = new Set(findings.map((f) => f.key));
    findings.push(...current.filter((alert) => !seen.has(alert.key)));
  }
  const plan = planAlerts(findings, current, now, deps.settings.repeatMs);
  if (!plan.send) return { findings, notified: false, sendFailed: false };

  const message = formatAlertMessage(plan, deps.appEnv, now);
  context.logger.warn({ alert: message.markdown }, message.title);
  try {
    await deps.sender.sendAlert(message);
  } catch (error) {
    if (!isNotConfigured(error)) {
      context.logger.error({ err: error }, '告警发送失败，下一分钟再试');
      return { findings, notified: false, sendFailed: true };
    }
    context.logger.warn('钉钉群机器人没有配置（DINGTALK_ROBOT_WEBHOOK），告警只写日志');
  }

  await transaction(runtime, async (tx) => {
    for (const item of plan.resolved) {
      await tx.db.delete(alertState).where(eq(alertState.key, item.key));
    }
    for (const item of plan.firing) {
      const row = {
        key: item.key,
        subject: item.subject,
        problem: item.problem,
        firingSince: item.firingSince,
        notifiedAt: now,
      };
      await tx.db
        .insert(alertState)
        .values(row)
        .onConflictDoUpdate({ target: alertState.key, set: row });
    }
  });
  return { findings, notified: true, sendFailed: false };
}

// ---------------------------------------------------------------- core 自己的自检项

interface QueueWaitRow extends Record<string, unknown> {
  name: string;
  waiting: number;
  oldest_seconds: number;
}

/**
 * 任务队列积压（Q2 a）：已到点（start_after 不晚于此刻）、还没开始的任务最久等了 ALERT_QUEUE_WAIT_MINUTES 以上。
 * 任务表的时刻由 pg-boss 按数据库时间写，所以这里按数据库的 now() 算（不是运行时的时钟）
 */
const queueBacklogProbe: SelfCheckProbe = {
  name: '任务队列积压',
  async check({ db, settings }) {
    const result = await db.execute<QueueWaitRow>(sql`
      SELECT name, count(*)::int AS waiting,
             floor(extract(epoch FROM now() - min(start_after)))::int AS oldest_seconds
        FROM pgboss.job
       WHERE state IN ('created', 'retry') AND start_after <= now() AND NOT blocked
       GROUP BY name
      HAVING min(start_after) <= now() - make_interval(secs => ${settings.queueWaitMs / 1000})
       ORDER BY name`);
    return result.rows.map((row) => ({
      key: `queue_backlog:${row.name}`,
      subject: `任务队列 ${row.name}`,
      problem: `${row.waiting} 个任务等待处理，最久已等 ${minutes(row.oldest_seconds)} 分钟`,
    }));
  },
};

interface FailedJobRow extends Record<string, unknown> {
  name: string;
  failed: number;
  last_error: string | null;
}

/**
 * 失败任务（Q2 b）：近 ALERT_FAILED_JOB_WINDOW_MINUTES 内有任务重试用完进入失败（含汇率同步重试 3 次仍失败）；
 * 之后一段时间没有新的失败即为恢复。同样按数据库时间
 */
const failedJobsProbe: SelfCheckProbe = {
  name: '失败任务',
  async check({ db, settings }) {
    const result = await db.execute<FailedJobRow>(sql`
      SELECT name, count(*)::int AS failed,
             (array_agg(output->>'message' ORDER BY completed_on DESC))[1] AS last_error
        FROM pgboss.job
       WHERE state = 'failed'
         AND completed_on >= now() - make_interval(secs => ${settings.failedJobWindowMs / 1000})
       GROUP BY name
       ORDER BY name`);
    const window = minutes(settings.failedJobWindowMs / 1000);
    return result.rows.map((row) => ({
      key: `job_failed:${row.name}`,
      subject: `任务 ${row.name}`,
      problem: `近 ${window} 分钟有 ${row.failed} 个重试用完仍失败${row.last_error ? `：${clip(row.last_error)}` : ''}`,
    }));
  },
};

/** 钉钉标准版每月的 API 调用量（工作通知计入，通讯录读取与访问凭证不计；ADR 0010） */
export const DINGTALK_MONTHLY_QUOTA = 5_000;

/** 钉钉配额（Q2 d）：本月（北京时间）发出的工作通知调用（每批一个钉钉任务 ID）达到 ALERT_DINGTALK_MONTHLY_CALLS */
const dingtalkQuotaProbe: SelfCheckProbe = {
  name: '钉钉配额',
  async check({ db, now, settings }) {
    const monthStart = startOfBusinessDate(`${businessDate(now).slice(0, 7)}-01`);
    const [row] = await db
      .select({ calls: countDistinct(workNotification.taskId) })
      .from(workNotification)
      .where(and(isNotNull(workNotification.taskId), gte(workNotification.sentAt, monthStart)));
    const calls = row?.calls ?? 0;
    if (calls < settings.dingtalkMonthlyCalls) return [];
    return [
      {
        key: 'quota:dingtalk',
        subject: '钉钉调用配额',
        problem: `本月工作通知已调用 ${calls.toLocaleString('en-US')} 次（标准版每月 ${DINGTALK_MONTHLY_QUOTA.toLocaleString('en-US')} 次，告警线 ${settings.dingtalkMonthlyCalls.toLocaleString('en-US')} 次）`,
      },
    ];
  },
};

/** 汇率每天北京时间 06:00 同步一次：判断「超过 1 天」时多留 1 小时让当天的同步跑完（第一次重试在 30 分钟后） */
const EXCHANGE_RATE_GRACE_MS = 60 * 60_000;

/** 汇率（PRD 6.9：1 天）：按最近一次同步成功判断（core.exchange_rate_sync）；还没同步过时不判断（worker 启动即同步） */
const exchangeRateProbe: SelfCheckProbe = {
  name: '汇率同步',
  async check({ db, now }) {
    const [row] = await db.select().from(exchangeRateSync).limit(1);
    if (!row) return [];
    const lastError = row.lastError ? `；最近的错误：${clip(row.lastError)}` : '';
    // 从没同步成功过（例如第一次部署时代理没放行欧洲央行）：有失败就告警，不等 1 天
    if (!row.lastSuccessAt) {
      return row.consecutiveFailures > 0
        ? [
            {
              key: 'sync:exchange_rate',
              subject: '汇率',
              problem: `还没有同步成功过（连续 ${row.consecutiveFailures} 次失败${lastError}）`,
            },
          ]
        : [];
    }
    if (
      now.getTime() - row.lastSuccessAt.getTime() <=
      SYNC_DELAY_MS.exchangeRate + EXCHANGE_RATE_GRACE_MS
    ) {
      return [];
    }
    return [
      {
        key: 'sync:exchange_rate',
        subject: '汇率',
        problem: `超过 1 天没有同步成功（最近成功 ${alertTime(row.lastSuccessAt)}${lastError}）`,
      },
    ];
  },
};

interface ArchiverRow extends Record<string, unknown> {
  archive_mode: string;
  archive_timeout_seconds: number;
  last_archived_time: string | null;
  last_failed_time: string | null;
  last_failed_wal: string | null;
  postmaster_start: string;
  db_now: string;
}

/** 判断备份与 WAL 归档要用的状态（时刻都是数据库时间） */
export interface BackupState {
  /** 数据库的 now() */
  readonly now: Date;
  readonly postmasterStart: Date;
  readonly archiveTimeoutSeconds: number;
  readonly lastArchived: Date | null;
  readonly lastFailed: Date | null;
  readonly lastFailedWal: string | null;
  /** 最近一次结束的备份 */
  readonly lastFinished: {
    readonly succeeded: boolean | null;
    readonly finishedAt: Date | null;
    readonly startedAt: Date;
    readonly detail: string | null;
  } | null;
  /** 最近一次成功的备份结束的时刻 */
  readonly lastSucceededAt: Date | null;
}

/**
 * 备份与 WAL 归档的异常（Q2 g，协调者修改）：
 * - WAL：最近一次归档失败晚于最近一次成功；或超过 archive_timeout 的 2 倍（默认 5 分钟 × 2 = 10 分钟）没有归档成功——
 *   archive_timeout 保证有写入时最多这么久切一次段，worker 每分钟写心跳，库不会闲到不切段；
 * - 备份：最近一次结束的失败了；或最近一次成功超过 ALERT_BACKUP_STALE_HOURS。还没有成功的时从数据库启动起算
 */
export function backupFindings(state: BackupState, settings: AlertSettings): AlertFinding[] {
  const findings: AlertFinding[] = [];
  const { lastArchived, lastFailed } = state;
  const walStaleMs = 2 * Math.max(state.archiveTimeoutSeconds, 60) * 1000;
  const archivedWords = lastArchived ? `最近成功 ${alertTime(lastArchived)}` : '还没有成功过';
  if (lastFailed && (!lastArchived || lastFailed > lastArchived)) {
    findings.push({
      key: 'backup:wal_archive',
      subject: 'WAL 连续归档',
      problem: `归档失败（${state.lastFailedWal ?? '—'}，${alertTime(lastFailed)}；${archivedWords}）`,
    });
  } else if (state.now.getTime() - (lastArchived ?? state.postmasterStart).getTime() > walStaleMs) {
    findings.push({
      key: 'backup:wal_archive',
      subject: 'WAL 连续归档',
      problem: `超过 ${minutes(walStaleMs / 1000)} 分钟没有归档成功（${archivedWords}）`,
    });
  }

  const finished = state.lastFinished;
  if (finished && finished.succeeded === false) {
    findings.push({
      key: 'backup:failed',
      subject: '备份',
      problem: `最近一次备份失败（${alertTime(finished.finishedAt ?? finished.startedAt)}）：${clip(finished.detail ?? '没有记下原因')}`,
    });
  }
  const since = state.lastSucceededAt ?? state.postmasterStart;
  if (state.now.getTime() - since.getTime() > settings.backupStaleMs) {
    const succeededWords = state.lastSucceededAt
      ? `最近成功 ${alertTime(state.lastSucceededAt)}`
      : '还没有成功过';
    findings.push({
      key: 'backup:stale',
      subject: '每日备份',
      problem: `超过 ${hours(settings.backupStaleMs)} 小时没有成功的备份（${succeededWords}）`,
    });
  }
  return findings;
}

/**
 * 备份与 WAL 归档：只在开着 WAL 归档的库上查（部署用的 PostgreSQL 镜像，deploy/postgres/；本机开发库与测试库不归档）。
 * pg_stat_archiver 的时刻是数据库时间，与数据库的 now() 比
 */
const backupProbe: SelfCheckProbe = {
  name: '备份与 WAL 归档',
  async check({ db, settings }) {
    const archiver = (
      await db.execute<ArchiverRow>(sql`
        SELECT current_setting('archive_mode') AS archive_mode,
               extract(epoch FROM current_setting('archive_timeout')::interval)::int AS archive_timeout_seconds,
               last_archived_time, last_failed_time, last_failed_wal,
               pg_postmaster_start_time() AS postmaster_start, now() AS db_now
          FROM pg_stat_archiver`)
    ).rows[0];
    if (!archiver || archiver.archive_mode === 'off') return [];
    const [lastFinished] = await db
      .select()
      .from(backupRun)
      .where(isNotNull(backupRun.finishedAt))
      .orderBy(desc(backupRun.finishedAt))
      .limit(1);
    const [lastSucceeded] = await db
      .select({ finishedAt: backupRun.finishedAt })
      .from(backupRun)
      .where(eq(backupRun.succeeded, true))
      .orderBy(desc(backupRun.finishedAt))
      .limit(1);
    const date = (value: string | null) => (value === null ? null : new Date(value));
    return backupFindings(
      {
        now: new Date(archiver.db_now),
        postmasterStart: new Date(archiver.postmaster_start),
        archiveTimeoutSeconds: archiver.archive_timeout_seconds,
        lastArchived: date(archiver.last_archived_time),
        lastFailed: date(archiver.last_failed_time),
        lastFailedWal: archiver.last_failed_wal,
        lastFinished: lastFinished ?? null,
        lastSucceededAt: lastSucceeded?.finishedAt ?? null,
      },
      settings,
    );
  },
};

/** core 自己的自检项 */
export const coreSelfCheckProbes: readonly SelfCheckProbe[] = [
  queueBacklogProbe,
  failedJobsProbe,
  dingtalkQuotaProbe,
  exchangeRateProbe,
  backupProbe,
];

function minutes(seconds: number): number {
  return Math.round(seconds / 60);
}

function hours(ms: number): number {
  return Math.round((ms / 3_600_000) * 10) / 10;
}
