import { businessDateTime } from '@forcome/calendar';
import { MAIL_REPLAY_DAYS } from '@forcome/contracts';
import { sql } from 'drizzle-orm';
import { parseArgs } from 'node:util';
import type pg from 'pg';
import { z } from 'zod';
import {
  beginCutover,
  completeCutover,
  listReplayMail,
  markReplayed,
  nextReplayItems,
  readMailCutover,
  replayMail,
  replayProgress,
  watchedMailboxes,
  watchMailboxes,
  type MailCutover,
  type WatchedMailbox,
} from './modules/channel';
import {
  drainJobs,
  ManualClock,
  requeueInterruptedJobs,
  systemClock,
  toMilliseconds,
  type AnyJobHandler,
  type AppEnv,
  type FailedDrainJob,
  type Logger,
  type Runtime,
} from './modules/core';
import type { IntegrationClients } from './modules/integration';
import { nextTimeLimitAt, scanTimeLimits } from './modules/ticket';

/*
 * 「历史邮件回放与 T0 切换」命令（规格「历史导入与切换」，待办 26；协调者 2026-10-14 决定 Q1–Q4；ADR 0008「待办 26 落地」）：
 *   node dist/mail-replay.mjs [--t0 <带时区的时刻>] [--confirm]
 * 上线切换用（生产与开发测试环境都可用）。不加 --confirm 只看计划，不动任何东西；加了才执行：
 * 1. 各进线邮箱 watch（没有游标的建立游标，即「T0 前启动 watch」；已有的续订）；
 * 2. 定 T0（--t0，不给取此刻）：不能晚于现在，不能早于任何邮箱第一次 watch 的时刻（两者之间的信既不回放、也不在增量里）；
 *    写下切换记录后进入回放中，实时收信暂停（mail-cutover.ts）；
 * 3. 列回放清单：各邮箱 [T0 − 90 天, T0) 到达的收件与「已发送」；
 * 4. 按到达时间升序单线程回放：先把到这封邮件之前该到的时限扫描按实时 worker 会扫的那一分钟补上（nextTimeLimitAt），再把时钟拨到
 *    这封的到达时间入库，把它引起的任务（归并、回复识别）在回放的运行时里跑完，记下这封已回放；
 * 5. 时限扫描补到 T0，完成切换：实时收信开启，worker 起来后从 watch 的游标接着收 T0 之后的信。
 * 回放的运行时 = 同一组数据库与任务队列 + 手动时钟（邮件时间）+ replay 标记（提醒、通知、页面推送关闭）。
 * 保护：worker 在连就拒绝（回放排的任务只能在回放的运行时里跑）；同一时间只能跑一个（会话级咨询锁）；中断后再执行同一命令
 * 接着回放（T0 不能改）；已完成的再执行只报告、不回放。不删除任何数据。部署脚本子命令 mail-replay（docs/部署说明.md 第 16 节）。
 */

export const MAIL_REPLAY_USAGE =
  '用法：node dist/mail-replay.mjs [--t0 <带时区的时刻，如 2026-11-01T00:00:00+08:00>] [--confirm]（不加 --confirm 只看计划）';

export interface MailReplayCommandIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

/** 命令要的运行时：实时的运行时（系统时钟）、外部客户端、全部任务处理器（从中取回放流水线的那几个） */
export interface MailReplayRuntime {
  readonly runtime: Runtime;
  readonly clients: IntegrationClients;
  readonly handlers: readonly AnyJobHandler[];
  readonly logger: Logger;
  readonly stop: () => Promise<void>;
}

export interface MailReplayOptions {
  readonly startRuntime: () => Promise<MailReplayRuntime>;
  readonly io: MailReplayCommandIo;
  /** 回放流水线的任务（「来信已接收」「我方发信已同步」、回复重新识别）：回放里只跑这几个队列，其余留给 worker */
  readonly pipelineJobs: readonly string[];
  /** 运行环境：时限扫描在回放里不看它（回放按回放时钟算邮箱已同步到哪），签名要求 */
  readonly appEnv: AppEnv;
  /** 有没有 worker 连着这个库；默认按连接的 application_name 查（forcome-worker…，core 的 startRuntime 设的） */
  readonly workerRunning?: (runtime: Runtime) => Promise<boolean>;
  /** 等任务重试时的睡眠（测试换成不真等的） */
  readonly sleep?: (ms: number) => Promise<void>;
  /** 每次从回放清单取几封（每取完一批查一次 worker）；默认 200 */
  readonly pageSize?: number;
}

const LOCK_KEY = 'channel.mail_replay';
const PAGE_SIZE = 200;
/** 每回放多少封写一行进度 */
const PROGRESS_EVERY = 200;
const MINUTE_MS = 60_000;

const t0Schema = z.iso.datetime({ offset: true });

const at = (instant: Date) => `${businessDateTime(instant).slice(0, 16)}（北京时间）`;

/** 默认的 worker 检查：worker 进程的数据库连接与 pg-boss 连接的 application_name 都以 forcome-worker 开头 */
export async function workerConnected(runtime: Runtime): Promise<boolean> {
  const { rows } = await runtime.db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM pg_stat_activity
     WHERE datname = current_database() AND application_name LIKE 'forcome-worker%'
       AND pid <> pg_backend_pid()`);
  return (rows[0]?.n ?? 0) > 0;
}

/** 时刻向上取整到分钟：实时 worker 的时限扫描是每分钟整点一次（cron * * * * *） */
function ceilToMinute(instant: Date): Date {
  return new Date(Math.ceil(instant.getTime() / MINUTE_MS) * MINUTE_MS);
}

/** 某一时刻之后的下一个整分（正好在整分上也取下一个：那一刻的扫描可能先于这件事） */
function minuteAfter(instant: Date): Date {
  return new Date((Math.floor(instant.getTime() / MINUTE_MS) + 1) * MINUTE_MS);
}

/** 这个邮箱开始监听晚于 T0（或还没开始）：T0 到开始监听之间的信既不回放、也不在增量里 */
function watchedAfter(mailbox: WatchedMailbox, t0: Date): boolean {
  return !mailbox.watchedAt || mailbox.watchedAt.getTime() > t0.getTime();
}

/** 会话级咨询锁：拿不到返回 null（另一个回放正在跑） */
async function tryLock(runtime: Runtime): Promise<pg.PoolClient | null> {
  const client = await runtime.db.$client.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
      [LOCK_KEY],
    );
    if (rows[0]?.locked) return client;
    client.release();
    return null;
  } catch (error) {
    client.release(error instanceof Error ? error : true);
    throw error;
  }
}

async function unlock(client: pg.PoolClient): Promise<void> {
  try {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]);
    client.release();
  } catch (error) {
    client.release(error instanceof Error ? error : true);
  }
}

/** 执行命令，返回退出码 */
export async function runMailReplayCommand(
  args: readonly string[],
  options: MailReplayOptions,
): Promise<number> {
  const { io } = options;
  let values: { t0?: string; confirm?: boolean };
  try {
    values = parseArgs({
      args: [...args],
      options: { t0: { type: 'string' }, confirm: { type: 'boolean' } },
    }).values;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${MAIL_REPLAY_USAGE}\n`);
    return 2;
  }
  if (values.t0 !== undefined && !t0Schema.safeParse(values.t0).success) {
    io.stderr(`--t0 要写成带时区的时刻：${values.t0}\n${MAIL_REPLAY_USAGE}\n`);
    return 2;
  }
  const requestedT0 = values.t0 === undefined ? null : new Date(values.t0);

  const started = await options.startRuntime();
  const { runtime } = started;
  try {
    const cutover = await readMailCutover(runtime.db);
    if (cutover?.completedAt) {
      io.stdout(
        `上线切换已完成：T0 ${at(cutover.t0)}，完成于 ${at(cutover.completedAt)}；不再回放（T0 之后的邮件由 worker 实时收取）。\n`,
      );
      return 0;
    }
    if (cutover && requestedT0 && requestedT0.getTime() !== cutover.t0.getTime()) {
      io.stderr(
        `回放已经开始，T0 是 ${at(cutover.t0)}，不能改成 ${at(requestedT0)}；去掉 --t0 再执行，接着上次的回放。\n`,
      );
      return 1;
    }
    const workerRunning = await (options.workerRunning ?? workerConnected)(runtime);
    if (!values.confirm) {
      await printPlan(started, io, cutover, requestedT0, workerRunning);
      return 0;
    }
    if (workerRunning) {
      io.stderr(
        'worker 正在运行：回放期间排的任务只能由回放自己跑完，先停 worker（部署脚本的 mail-replay 子命令会先停），再执行。\n',
      );
      return 1;
    }
    const lock = await tryLock(runtime);
    if (!lock) {
      io.stderr('另一个回放正在执行（同一时间只能跑一个）。\n');
      return 1;
    }
    try {
      return await replay(started, options, cutover, requestedT0);
    } finally {
      await unlock(lock);
    }
  } finally {
    await started.stop();
  }
}

/** 不加 --confirm：只写计划（T0、回放区间、各邮箱是否已开始监听、worker 是否在运行），不动任何东西 */
async function printPlan(
  { runtime }: MailReplayRuntime,
  io: MailReplayCommandIo,
  cutover: MailCutover | null,
  requestedT0: Date | null,
  workerRunning: boolean,
): Promise<void> {
  const lines = ['计划（不加 --confirm 只看计划，不执行）：'];
  if (cutover) {
    const { total, replayed } = await replayProgress(runtime);
    lines.push(
      `回放已经开始：T0 ${at(cutover.t0)}，${
        cutover.listedAt ? `已回放 ${replayed} / ${total} 封` : '回放清单还没列完'
      }；加 --confirm 接着回放。`,
    );
  } else {
    lines.push(
      requestedT0
        ? `T0 ${at(requestedT0)}：回放 ${at(new Date(requestedT0.getTime() - toMilliseconds({ days: MAIL_REPLAY_DAYS })))} 至 T0 之前到达的邮件（近 ${MAIL_REPLAY_DAYS} 天）`
        : `T0 取执行时的此刻：回放此前 ${MAIL_REPLAY_DAYS} 天到达的邮件`,
    );
  }
  const mailboxes = await watchedMailboxes(runtime.db);
  lines.push(`进线邮箱 ${mailboxes.length} 个：`);
  for (const m of mailboxes) {
    const late = !cutover && requestedT0 && watchedAfter(m, requestedT0);
    lines.push(
      `  ${m.address}：${
        m.watchedAt ? `${at(m.watchedAt)} 开始监听` : '还没开始监听（执行时先开始监听）'
      }${late ? '——晚于 T0，执行会被拒绝' : ''}`,
    );
  }
  lines.push(
    workerRunning
      ? 'worker：正在运行，执行前要先停（部署脚本的 mail-replay 子命令会先停 worker、完成后再起）'
      : 'worker：没有运行',
    '确认无误后加 --confirm 执行。',
    '',
  );
  io.stdout(lines.join('\n'));
}

async function replay(
  started: MailReplayRuntime,
  options: MailReplayOptions,
  existing: MailCutover | null,
  requestedT0: Date | null,
): Promise<number> {
  const { runtime, clients, logger } = started;
  const { io } = options;
  const pageSize = options.pageSize ?? PAGE_SIZE;
  const pipeline = started.handlers.filter((h) => options.pipelineJobs.includes(h.job.name));

  // 1. 各进线邮箱 watch（续跑时也续订一次：Fake Gmail 在本进程里 watch 后才有信）
  let watched;
  try {
    watched = await watchMailboxes(runtime, clients, logger);
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n回放没有开始。\n`);
    return 1;
  }
  if (watched.length === 0) {
    io.stderr('还没有登记进线邮箱：先在 P18 登记店铺与进线邮箱。\n');
    return 1;
  }

  // 2. 定 T0（续跑沿用库里的）
  let cutover = existing;
  if (!cutover) {
    const now = runtime.clock.now();
    const t0 = requestedT0 ?? now;
    if (t0.getTime() > now.getTime()) {
      io.stderr(`T0 ${at(t0)} 还没到：T0 不能晚于现在（${at(now)}）。\n`);
      return 1;
    }
    const late = watched.filter((m) => watchedAfter(m, t0));
    if (late.length > 0) {
      io.stderr(
        `T0 ${at(t0)} 早于这些邮箱开始监听的时刻，T0 到开始监听之间的信既不回放、也不在增量里：\n${late
          .map((m) => `  ${m.address}：${m.watchedAt ? at(m.watchedAt) : '还没开始监听'}`)
          .join('\n')}\nT0 取不早于它们的时刻（或不给 --t0，取此刻）。\n`,
      );
      return 1;
    }
    cutover = await beginCutover(runtime, t0);
    io.stdout(
      `T0 ${at(cutover.t0)}：回放 ${at(cutover.replayFrom)} 至 T0 之前到达的邮件（近 ${MAIL_REPLAY_DAYS} 天）；回放完成前实时收信暂停。\n`,
    );
  } else {
    io.stdout(`接着上次的回放：T0 ${at(cutover.t0)}。\n`);
  }

  // 3. 回放清单
  if (!cutover.listedAt) {
    const listed = await listReplayMail(runtime, clients, cutover, logger);
    for (const [mailbox, n] of listed) io.stdout(`${mailbox}：列出 ${n} 封\n`);
  }
  const requeued = await requeueInterruptedJobs(runtime, pipeline);
  if (requeued > 0) io.stdout(`上次中断时还在处理的任务 ${requeued} 个，已交回重试。\n`);

  // 4. 按到达时间升序逐封回放
  const progress = await replayProgress(runtime);
  // 续跑时时钟从上次回放到的那一封起走（之前该扫的都已扫过）
  const clock = new ManualClock(progress.through ?? cutover.replayFrom);
  const replayRuntime: Runtime = { ...runtime, clock, replay: true };
  const counts = { inbound: 0, outbound: 0, copies: 0, skipped: 0, closed: 0, overdue: 0 };
  const failed: FailedDrainJob[] = [];
  // 扫描过、仍到点却没改动的时限（单线程下不会出现，防死循环）：之后只看它之后的
  let stuckBefore: Date | null = null;
  const drain = async () => {
    const report = await drainJobs(replayRuntime, pipeline, logger, { sleep: options.sleep });
    failed.push(...report.failed);
  };
  /**
   * 到 until 为止该到的时限扫描，放在实时 worker 会扫的那一分钟：时限在当前时钟之后的，取它向上取整的那一分钟；已经过了的
   * （一封邮件改了工单状态，让早就到点的时限生效，例如最近来信 9 天后才回复、转等客户，7 天的时限已过），取这封邮件之后的
   * 下一分钟——实时 worker 也是在处理完它之后的那次扫描里关单。时钟只往前走
   */
  const catchUp = async (until: Date) => {
    for (;;) {
      const due = await nextTimeLimitAt(runtime.db, stuckBefore);
      if (!due) return;
      const now = clock.now();
      const scanAt = due.getTime() > now.getTime() ? ceilToMinute(due) : minuteAfter(now);
      if (scanAt.getTime() > until.getTime()) return;
      clock.set(scanAt);
      const scan = await scanTimeLimits(replayRuntime, options.appEnv, scanAt, logger);
      counts.closed += scan.closed;
      counts.overdue += scan.overdue;
      await drain();
      const left = await nextTimeLimitAt(runtime.db, stuckBefore);
      if (left && left.getTime() <= scanAt.getTime()) {
        logger.warn({ due: left, scanAt }, '时限到点但扫描没有改动，之后跳过它');
        stuckBefore = scanAt;
      }
    }
  };
  let done = progress.replayed;
  for (;;) {
    const items = await nextReplayItems(runtime, pageSize);
    if (items.length === 0) break;
    for (const item of items) {
      await catchUp(item.internalDate);
      clock.set(item.internalDate);
      const outcome = await replayMail(replayRuntime, clients, item, logger);
      if (outcome.result === 'created') {
        counts[outcome.direction] += 1;
      } else if (outcome.result === 'copy') {
        counts.copies += 1;
      } else {
        counts.skipped += 1;
      }
      await drain();
      await markReplayed(runtime, item, systemClock.now());
      done += 1;
      if (done % PROGRESS_EVERY === 0) {
        io.stdout(`已回放 ${done} / ${progress.total} 封（到 ${at(item.internalDate)}）\n`);
      }
    }
    if (await (options.workerRunning ?? workerConnected)(runtime)) {
      io.stderr(
        'worker 在回放途中连上了：已停在这里（已回放的不受影响）。停掉 worker 后再执行同一命令接着回放。\n',
      );
      return 1;
    }
  }

  // 5. 时限扫描补到 T0，完成切换
  await catchUp(cutover.t0);
  const completed = await completeCutover(runtime);
  io.stdout(
    [
      `回放完成：共 ${progress.total} 封，这次回放 ${done - progress.replayed} 封——` +
        `新入库来信 ${counts.inbound} 封、我方发信 ${counts.outbound} 封、` +
        `别的邮箱已收过的副本 ${counts.copies} 封、已入库或无需入库的 ${counts.skipped} 封；` +
        `按时关闭工单 ${counts.closed} 张，SLA 到期未回复 ${counts.overdue} 封（回放期间不发任何提醒与通知）。`,
      ...(failed.length > 0
        ? [
            `有 ${failed.length} 个任务重试用完仍失败（与实时 worker 一样跳过，见日志）：${failed
              .map((f) => `${f.name}（${f.error}）`)
              .join('；')}`,
          ]
        : []),
      `上线切换完成于 ${at(completed.completedAt!)}：T0 之后的邮件由 worker 实时收取，现在启动 worker。`,
      '',
    ].join('\n'),
  );
  return 0;
}
