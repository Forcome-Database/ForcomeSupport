import {
  CONNECTION_FAILURE_LIMIT,
  SYNC_DELAY_MS,
  syncConnectionStatus,
  type ConnectionStatus,
  type SyncHealth,
} from '@forcome/contracts';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  defineFeed,
  defineJob,
  handleJob,
  transaction,
  type AnyJobHandler,
  type DbExecutor,
  type Feed,
  type JobContext,
  type Runtime,
  type Tx,
} from '../core';
import {
  dingtalkDepartmentEvents,
  dingtalkUserEvents,
  type DingtalkClient,
  type DingtalkDepartment,
  type DingtalkUser,
} from '../integration';
import {
  applyDepartmentChanges,
  applyDirectory,
  applyUserChange,
  loadDepartmentTree,
  lockDirectory,
  type DepartmentTree,
  type DirectoryChanges,
} from './directory';
import { notifyMembers } from './notifications';
import { dingtalkSync } from './schema';

/*
 * 钉钉通讯录同步（规格 org「钉钉 Stream 通讯录事件 + 每小时全量对账」、PRD 6.9、E-32，待办 05）：
 * - 常驻拉取 org.dingtalk_stream（独占：多个 worker 时咨询锁选主，只有一条 Stream 长连接）：取到的事件在事务里转成
 *   任务 org.dingtalk_event 后再回执；
 * - 任务 org.dingtalk_event：按事件向钉钉取最新的成员或部门，写进成员与部门（directory.ts）；
 * - 定时任务 org.dingtalk_reconcile：每小时（worker 启动时也一次）全量取通讯录对账，兜住断线期间漏掉的事件；
 * - 同步状态：一次全量对账算一次同步。失败时保留上次的成员与部门（先取全再写，取不全就不写），登录与权限不受影响；
 *   记连续失败次数，P18 钉钉卡据此显示（超过 2 小时没成功为同步延迟、连续 3 次失败为连接异常）；
 *   只给管理员发站内提醒（11.4），不出全站横幅（6.9）：连续失败的第 1 次与第 3 次（转为连接异常）各一条。
 */

/**
 * 每个整点对账一次，worker 启动时也一次。失败不重试：每次对账算一次同步，下一个整点再试——上次成功超过 2 小时先显示
 * 「同步延迟」，连续 3 次失败（约 3 小时）才是「连接异常」（6.9、K20 的示例）；其间的变化有 Stream 事件
 */
export const dingtalkReconcileJob = defineJob(
  'org.dingtalk_reconcile',
  z.object({}),
  { policy: 'stately', retryLimit: 0 },
  { cron: '0 * * * *', tz: 'Asia/Shanghai', runAtStartup: true },
);

/** 一条通讯录事件（Stream 推来，常驻拉取转成任务）：事件类型与涉及的成员、部门 */
export const dingtalkEventJob = defineJob(
  'org.dingtalk_event',
  z.object({
    type: z.string(),
    eventId: z.string().nullable(),
    userIds: z.array(z.string()),
    departmentIds: z.array(z.string()),
  }),
  { retryLimit: 5, retryDelay: 30, retryBackoff: true },
);

/** 成员事件：取最新的成员（取不到即已离职）；部门事件：取最新的部门（取不到即已删除） */
const USER_EVENTS: ReadonlySet<string> = new Set(dingtalkUserEvents);
const DEPARTMENT_EVENTS: ReadonlySet<string> = new Set(dingtalkDepartmentEvents);

/** 同步失败给管理员的站内提醒（11.4「钉钉同步失败」；对象是 P18 钉钉卡） */
export const DINGTALK_SYNC_FAILED = {
  first: {
    title: '钉钉同步失败',
    body: '通讯录同步失败，成员与部门保持上次结果，登录与权限不受影响',
  },
  disconnected: {
    title: '钉钉连接异常',
    body: `通讯录连续 ${CONNECTION_FAILURE_LIMIT} 次同步失败，成员与部门保持上次结果，登录与权限不受影响`,
  },
  object: { type: 'channel', id: 'dingtalk', label: 'P18 · 钉钉' },
} as const;

const SYNC_ROW = 'directory';

/** 钉钉通讯录的同步记录（P18 钉钉卡）；还没同步过时为空记录 */
export async function dingtalkSyncHealth(db: DbExecutor): Promise<SyncHealth> {
  const [row] = await db.select().from(dingtalkSync).where(eq(dingtalkSync.id, SYNC_ROW)).limit(1);
  return {
    lastSuccessAt: row?.lastSuccessAt ?? null,
    consecutiveFailures: row?.consecutiveFailures ?? 0,
  };
}

/** P18 钉钉卡的连接状态与最近同步时间（6.9：超过 2 小时没成功为同步延迟，连续 3 次失败为连接异常） */
export async function dingtalkConnection(
  db: DbExecutor,
  now: Date,
): Promise<{ status: ConnectionStatus; lastSyncAt: Date | null }> {
  const health = await dingtalkSyncHealth(db);
  return {
    status: syncConnectionStatus(health, SYNC_DELAY_MS.dingtalk, now),
    lastSyncAt: health.lastSuccessAt,
  };
}

async function recordSuccess(tx: Tx): Promise<void> {
  await tx.db
    .insert(dingtalkSync)
    .values({
      id: SYNC_ROW,
      lastSuccessAt: tx.now,
      lastAttemptAt: tx.now,
      consecutiveFailures: 0,
      lastError: null,
    })
    .onConflictDoUpdate({
      target: dingtalkSync.id,
      set: {
        lastSuccessAt: tx.now,
        lastAttemptAt: tx.now,
        consecutiveFailures: 0,
        lastError: null,
      },
    });
}

/** 记一次失败；连续失败的第 1 次与第 3 次给管理员发站内提醒。返回连续失败了几次 */
async function recordFailure(runtime: Runtime, error: unknown): Promise<number> {
  const message = error instanceof Error ? error.message : String(error);
  return transaction(runtime, async (tx) => {
    const [row] = await tx.db
      .insert(dingtalkSync)
      .values({ id: SYNC_ROW, lastAttemptAt: tx.now, consecutiveFailures: 1, lastError: message })
      .onConflictDoUpdate({
        target: dingtalkSync.id,
        set: {
          lastAttemptAt: tx.now,
          consecutiveFailures: sql`${dingtalkSync.consecutiveFailures} + 1`,
          lastError: message,
        },
      })
      .returning({ failures: dingtalkSync.consecutiveFailures });
    const failures = row?.failures ?? 1;
    const notice =
      failures === 1
        ? DINGTALK_SYNC_FAILED.first
        : failures === CONNECTION_FAILURE_LIMIT
          ? DINGTALK_SYNC_FAILED.disconnected
          : null;
    if (notice) {
      await notifyMembers(tx, {
        type: 'dingtalk_sync_failed',
        title: notice.title,
        body: notice.body,
        object: { ...DINGTALK_SYNC_FAILED.object },
      });
    }
    return failures;
  });
}

/**
 * 全量对账一次：先把通讯录全部取来（取的过程中出错就什么也不写），再在一个事务里写进成员与部门并记同步成功。
 * 通讯录一个人都没有时当作失败（多半是应用的通讯录权限范围没配好），不把所有人停用。失败时记一次失败并抛出（任务记为失败）。
 */
export async function reconcileDirectory(
  runtime: Runtime,
  client: DingtalkClient,
  context: Pick<JobContext, 'logger'>,
): Promise<DirectoryChanges> {
  const startedAt = runtime.clock.now();
  try {
    const snapshot = await client.readDirectory();
    if (snapshot.users.length === 0) {
      throw new Error('钉钉通讯录里一个成员也没有，多半是应用的通讯录权限范围没配好，这次不同步');
    }
    const changes = await transaction(runtime, async (tx) => {
      await lockDirectory(tx);
      const applied = await applyDirectory(tx, snapshot, startedAt);
      await recordSuccess(tx);
      return applied;
    });
    context.logger.info(
      { ...changes, users: snapshot.users.length, departments: snapshot.departments.length },
      '钉钉通讯录已对账',
    );
    return changes;
  } catch (error) {
    const failures = await recordFailure(runtime, error);
    context.logger.warn({ err: error, failures }, '钉钉通讯录对账失败，成员与部门保持上次结果');
    throw error;
  }
}

/** 成员的主部门链上部门表里还没有的部门：向钉钉取来（新部门的事件可能还没处理到） */
async function departmentsToFetch(
  client: DingtalkClient,
  tree: DepartmentTree,
  departmentIds: readonly string[],
): Promise<DingtalkDepartment[]> {
  const fetched: DingtalkDepartment[] = [];
  const seen = new Set<string>();
  let id: string | null = departmentIds[0] ?? null;
  while (id !== null && !tree.has(id) && !seen.has(id)) {
    seen.add(id);
    const found = await client.getDepartment(id);
    if (!found) break;
    fetched.push(found);
    id = found.parentId;
  }
  return fetched;
}

/** 向钉钉取来的一位成员：本人（取不到为已离职）、部门表里还缺的上级部门，与开始取的时刻 */
export interface FetchedUser {
  readonly userId: string;
  readonly user: DingtalkUser | null;
  readonly departments: readonly DingtalkDepartment[];
  readonly fetchedAt: Date;
}

/** 向钉钉取一位成员的最新样子（在事务之外取，再交给 applyFetchedUser 在加锁的事务里写）；钉钉出错原样抛出 */
export async function fetchUser(
  runtime: Runtime,
  client: DingtalkClient,
  userId: string,
): Promise<FetchedUser> {
  const fetchedAt = runtime.clock.now();
  const user = await client.getUser(userId);
  const departments = user
    ? await departmentsToFetch(client, await loadDepartmentTree(runtime.db), user.departmentIds)
    : [];
  return { userId, user, departments, fetchedAt };
}

/** 把取来的成员写进成员与部门（加锁；取来之后这一行已被更新过的不写，见 applyUserChange） */
export function applyFetchedUser(
  runtime: Runtime,
  fetched: FetchedUser,
): Promise<DirectoryChanges> {
  return transaction(runtime, async (tx) => {
    await lockDirectory(tx);
    return applyUserChange(
      tx,
      fetched.userId,
      fetched.user,
      fetched.departments,
      fetched.fetchedAt,
    );
  });
}

/** 处理一条通讯录事件：向钉钉取最新的样子再写（事件只说「谁变了」，重推、乱序都不影响结果） */
async function handleEvent(
  runtime: Runtime,
  client: DingtalkClient,
  event: z.infer<typeof dingtalkEventJob.payload>,
  context: Pick<JobContext, 'logger'>,
): Promise<void> {
  if (USER_EVENTS.has(event.type)) {
    for (const userId of event.userIds) {
      const changes = await applyFetchedUser(runtime, await fetchUser(runtime, client, userId));
      context.logger.info({ type: event.type, userId, ...changes }, '钉钉通讯录事件已处理');
    }
    return;
  }
  if (DEPARTMENT_EVENTS.has(event.type)) {
    const fetchedAt = runtime.clock.now();
    const upserts: DingtalkDepartment[] = [];
    const removed: string[] = [];
    for (const id of event.departmentIds) {
      const found = await client.getDepartment(id);
      if (found) upserts.push(found);
      else removed.push(id);
    }
    const changed = await transaction(runtime, async (tx) => {
      await lockDirectory(tx);
      return applyDepartmentChanges(tx, upserts, removed, fetchedAt);
    });
    context.logger.info(
      { type: event.type, departments: event.departmentIds, membersChanged: changed },
      '钉钉通讯录事件已处理',
    );
    return;
  }
  context.logger.debug({ type: event.type }, '不是通讯录事件，忽略');
}

/** org 的后台任务处理器（由 apps/server/src/jobs.ts 汇总）；钉钉客户端由入口给出（测试里是 Fake） */
export function createOrgJobHandlers(deps: { dingtalk: () => DingtalkClient }): AnyJobHandler[] {
  return [
    handleJob(dingtalkReconcileJob, async (_payload, context) => {
      await reconcileDirectory(context.runtime, deps.dingtalk(), context);
    }),
    handleJob(dingtalkEventJob, (payload, context) =>
      handleEvent(context.runtime, deps.dingtalk(), payload, context),
    ),
  ];
}

/**
 * org 的常驻拉取（由 apps/server/src/jobs.ts 汇总）：钉钉 Stream 的通讯录事件。独占——多个 worker 时只有拿到持有权的那个
 * 连 Stream；事件在事务里转成任务后才回执，进程中途退出时钉钉会重推。worker 停止或失去持有权时断开长连接。
 */
export function createOrgFeeds(deps: { dingtalk: () => DingtalkClient }): Feed[] {
  return [
    defineFeed(
      'org.dingtalk_stream',
      async ({ runtime, waitSeconds, signal }) => {
        const client = deps.dingtalk();
        // worker 停止时立刻结束正在等的长轮询
        const stop = () => void client.closeEvents();
        signal.addEventListener('abort', stop, { once: true });
        try {
          const events = await client.pullEvents({ waitSeconds });
          if (events.length === 0) return 0;
          await transaction(runtime, async (tx) => {
            for (const event of events) {
              await tx.enqueue(dingtalkEventJob, {
                type: event.type,
                eventId: event.eventId,
                userIds: [...event.userIds],
                departmentIds: [...event.departmentIds],
              });
            }
          });
          await client.acknowledgeEvents(events.map((event) => event.messageId));
          return events.length;
        } finally {
          signal.removeEventListener('abort', stop);
        }
      },
      { exclusive: true, release: () => deps.dingtalk().closeEvents() },
    ),
  ];
}
