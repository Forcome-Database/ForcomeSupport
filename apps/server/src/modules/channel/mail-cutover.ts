import { eq } from 'drizzle-orm';
import type { AppEnv, DbExecutor } from '../core';
import { mailCutover } from './schema';

/*
 * 上线切换的状态（规格「历史导入与切换」，待办 26；协调者 2026-10-14 决定 Q1–Q4）：
 * 顺序是订单回补 → 选定 T0（T0 前已 watch）→ 近 90 天邮件按到达时间升序单线程回放 → T0 后开启实时处理。
 * - 待切换（pending）：生产环境还没执行回放命令。worker 照常给进线邮箱 watch（游标就是「T0 前启动 watch」），但同步任务不入库、
 *   不建工单——实时工单若先于历史回放出现，回放时的归并会按时间判断错；
 * - 回放中（replaying）：回放命令写下了 T0、还没完成，实时收信照样暂停（回放期间 worker 必须停，命令检查）；
 * - 已切换（live）：回放完成，实时收信从各邮箱 watch 的游标接着收，交界处按「邮箱 + Gmail 消息 ID」去重不重复入库。
 * 非生产环境没有切换记录时视为已切换（开发与开发测试环境照常实时收示例来信）；在那里执行回放命令同样先进入回放中。
 * 待切换与回放中不算同步故障：同步任务不调 Gmail、不记成败，P18 的 Gmail 为未连接（不出同步延迟、连接异常的通知与横幅），
 * worker 自检（待办 28）读这里，不据此告警。
 */

export type MailCutoverStatus = 'pending' | 'replaying' | 'live';

/** 切换记录（整个环境一行）；还没执行过回放命令为 null */
export interface MailCutover {
  readonly t0: Date;
  readonly replayFrom: Date;
  /** 回放清单列完的时刻；还没列完为 null */
  readonly listedAt: Date | null;
  /** 回放完成、开启实时处理的时刻；还在回放为 null */
  readonly completedAt: Date | null;
  readonly createdAt: Date;
}

export async function readMailCutover(db: DbExecutor): Promise<MailCutover | null> {
  const [row] = await db
    .select({
      t0: mailCutover.t0,
      replayFrom: mailCutover.replayFrom,
      listedAt: mailCutover.listedAt,
      completedAt: mailCutover.completedAt,
      createdAt: mailCutover.createdAt,
    })
    .from(mailCutover)
    .where(eq(mailCutover.id, 1))
    .limit(1);
  return row ?? null;
}

/** 切换记录 → 状态：没有记录时生产为待切换、其余环境为已切换 */
export function cutoverStatusOf(cutover: MailCutover | null, appEnv: AppEnv): MailCutoverStatus {
  if (!cutover) return appEnv === 'production' ? 'pending' : 'live';
  return cutover.completedAt ? 'live' : 'replaying';
}

export async function mailCutoverStatus(
  db: DbExecutor,
  appEnv: AppEnv,
): Promise<MailCutoverStatus> {
  return cutoverStatusOf(await readMailCutover(db), appEnv);
}

/** 实时收信是否开着（同步任务据此决定入不入库） */
export async function liveMailOpen(db: DbExecutor, appEnv: AppEnv): Promise<boolean> {
  return (await mailCutoverStatus(db, appEnv)) === 'live';
}
