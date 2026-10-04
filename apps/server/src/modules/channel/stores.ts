import {
  normalizeStoreInput,
  storeInputErrors,
  type AdapterMode,
  type FieldErrors,
  type Store,
  type StoreInput,
  type StoreOption,
  type StoreUpdate,
} from '@forcome/contracts';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  FieldValidationError,
  OptimisticLockError,
  recordAudit,
  storeScopeCondition,
  transaction,
  updateWithVersion,
  type Actor,
  type AppEnv,
  type DbExecutor,
  type Runtime,
  type StoreScope,
  type Tx,
} from '../core';
import { storeConnections } from './connections';
import { storeChangedJob } from './jobs';
import { store, storeMailbox } from './schema';

/*
 * 店铺的仓储与保存（P18、K8；PRD P18「校验」、AC-ST-01）。
 * 保存都在一把事务级咨询锁下进行：店铺名与进线邮箱的「不能重复」要先查后写，串行化后检查与写入之间不会被别人插入
 * （表上另有唯一约束兜底）。保存记审计（完整前后值），并在同一事务里发出「店铺已变更」（jobs.ts）。
 */

type StoreRow = typeof store.$inferSelect;

/** 店铺与它的进线邮箱（按显示顺序） */
export interface StoreRecord extends StoreRow {
  readonly mailboxes: readonly string[];
}

const INVALID_ADAPTER_MODE = '生产环境不能使用模拟数据';
const DUPLICATE_NAME = '店铺名已存在，请换一个';

async function withMailboxes(db: DbExecutor, rows: readonly StoreRow[]): Promise<StoreRecord[]> {
  if (rows.length === 0) return [];
  const boxes = await db
    .select({ storeId: storeMailbox.storeId, address: storeMailbox.address })
    .from(storeMailbox)
    .where(
      inArray(
        storeMailbox.storeId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(storeMailbox.position));
  return rows.map((row) => ({
    ...row,
    mailboxes: boxes.filter((box) => box.storeId === row.id).map((box) => box.address),
  }));
}

/**
 * 全部店铺，按建立先后（P18 店铺表）。店铺配置是管理员的管理功能，不按数据范围过滤（ADR 0010 修订）——
 * 只给挂了 settings.channels_team 能力的接口用；业务数据的店铺筛选、选项一律用 listStoreOptions。
 */
export async function listAllStores(db: DbExecutor): Promise<StoreRecord[]> {
  const rows = await db.select().from(store).orderBy(asc(store.createdAt), asc(store.id));
  return withMailboxes(db, rows);
}

/** 店铺范围内的店铺（各页面的店铺筛选、指定店铺、授权选择）；新增的店铺对「全部店铺」的成员立即可见 */
export async function listStoreOptions(db: DbExecutor, scope: StoreScope): Promise<StoreOption[]> {
  return db
    .select({
      id: store.id,
      name: store.name,
      platform: store.platform,
      sites: store.sites,
      defaultSite: store.defaultSite,
    })
    .from(store)
    .where(storeScopeCondition(scope, store.id))
    .orderBy(asc(store.createdAt), asc(store.id));
}

/** 接口输出（contracts 的 Store） */
export function toStore(record: StoreRecord): Store {
  return {
    id: record.id,
    name: record.name,
    platform: record.platform,
    sites: [...record.sites],
    defaultSite: record.defaultSite,
    mailboxes: [...record.mailboxes],
    platformId: record.platformId,
    adapterMode: record.adapterMode,
    connections: storeConnections(record),
    version: record.version,
    updatedAt: record.updatedAt.toISOString(),
    updatedBy: record.updatedByName,
  };
}

/** 审计里的前后值：抽屉里能改的全部字段 */
function snapshot(record: {
  name: string;
  platform: StoreRow['platform'];
  sites: readonly StoreRow['sites'][number][];
  defaultSite: StoreRow['defaultSite'];
  mailboxes: readonly string[];
  platformId: string;
  adapterMode: AdapterMode;
}) {
  return {
    name: record.name,
    platform: record.platform,
    sites: [...record.sites],
    defaultSite: record.defaultSite,
    mailboxes: [...record.mailboxes],
    platformId: record.platformId,
    adapterMode: record.adapterMode,
  };
}

/** 店铺配置的保存串行化（见文件头） */
async function lockStoreConfig(tx: Tx): Promise<void> {
  await tx.db.execute(sql`SELECT pg_advisory_xact_lock(hashtext('channel.store_config'))`);
}

/** 要查库才知道的错误：店铺名被其他店铺用了、进线邮箱已登记在其他店铺 */
async function conflictErrors(
  db: DbExecutor,
  input: StoreInput,
  selfId: string | null,
): Promise<FieldErrors> {
  const errors: FieldErrors = {};
  const notSelf = selfId ? ne(store.id, selfId) : undefined;
  if (input.name) {
    const [sameName] = await db
      .select({ id: store.id })
      .from(store)
      .where(and(eq(sql`lower(${store.name})`, input.name.toLowerCase()), notSelf))
      .limit(1);
    if (sameName) errors.name = DUPLICATE_NAME;
  }
  if (input.mailboxes.length > 0) {
    const taken = await db
      .select({ address: storeMailbox.address, storeName: store.name })
      .from(storeMailbox)
      .innerJoin(store, eq(store.id, storeMailbox.storeId))
      .where(and(inArray(storeMailbox.address, [...input.mailboxes]), notSelf));
    input.mailboxes.forEach((mailbox, index) => {
      const owner = taken.find((row) => row.address === mailbox);
      if (owner) errors[`mailboxes.${index}`] = `${mailbox} 已是 ${owner.storeName} 的进线邮箱`;
    });
  }
  return errors;
}

/**
 * 数据来源：生产环境不显示也不接受模拟数据（K8），一律真实接口；非生产环境没选时新建为模拟数据
 * （开发测试环境外部客户端默认 Fake，ADR 0009 修订），编辑保持原值。
 */
function resolveAdapterMode(
  appEnv: AppEnv,
  requested: AdapterMode | undefined,
  current: AdapterMode | null,
): { mode: AdapterMode; error?: string } {
  if (appEnv === 'production') {
    return requested === 'fake' ? { mode: 'real', error: INVALID_ADAPTER_MODE } : { mode: 'real' };
  }
  return { mode: requested ?? current ?? 'fake' };
}

/** 保存店铺的上下文：运行环境与操作人（接口里取访问上下文的 actor） */
export interface StoreSaveContext {
  readonly runtime: Runtime;
  readonly appEnv: AppEnv;
  readonly actor: Actor;
}

function actorName(actor: Actor): string | null {
  return actor.kind === 'member' ? actor.name : null;
}

async function insertMailboxes(tx: Tx, storeId: string, mailboxes: readonly string[]) {
  if (mailboxes.length === 0) return;
  await tx.db
    .insert(storeMailbox)
    .values(
      mailboxes.map((address, position) => ({ storeId, address, position, createdAt: tx.now })),
    );
}

/** 新增店铺（K8）。填错时抛 FieldValidationError（一次列全全部字段的错误），不写任何数据 */
export async function createStore(ctx: StoreSaveContext, raw: StoreInput): Promise<StoreRecord> {
  const input = normalizeStoreInput(raw);
  return transaction(ctx.runtime, async (tx) => {
    await lockStoreConfig(tx);
    const adapter = resolveAdapterMode(ctx.appEnv, input.adapterMode, null);
    const errors: FieldErrors = {
      ...(await conflictErrors(tx.db, input, null)),
      ...storeInputErrors(input),
      ...(adapter.error ? { adapterMode: adapter.error } : {}),
    };
    if (Object.keys(errors).length > 0 || !input.platform || !input.defaultSite) {
      throw new FieldValidationError(errors);
    }
    const [row] = await tx.db
      .insert(store)
      .values({
        name: input.name,
        platform: input.platform,
        sites: input.sites,
        defaultSite: input.defaultSite,
        platformId: input.platformId,
        adapterMode: adapter.mode,
        createdAt: tx.now,
        updatedAt: tx.now,
        updatedByName: actorName(ctx.actor),
      })
      .returning();
    if (!row) throw new Error('店铺创建失败');
    await insertMailboxes(tx, row.id, input.mailboxes);
    const created: StoreRecord = { ...row, mailboxes: input.mailboxes };
    await recordAudit(tx, ctx.actor, {
      action: 'store.create',
      objectType: 'store',
      objectId: row.id,
      objectLabel: row.name,
      storeId: row.id,
      after: snapshot(created),
    });
    await tx.enqueue(storeChangedJob, { storeId: row.id, addedMailboxes: [...input.mailboxes] });
    return created;
  });
}

/**
 * 编辑店铺（K8）。店铺不存在返回 null；填错抛 FieldValidationError；版本号不是最新的（别人先保存了）
 * 抛 OptimisticLockError（接口 409，G7）。进线邮箱按新的列表整体替换，新登记的地址随「店铺已变更」发出。
 */
export async function updateStore(
  ctx: StoreSaveContext,
  id: string,
  raw: StoreUpdate,
): Promise<StoreRecord | null> {
  const { version, ...rest } = raw;
  const input = normalizeStoreInput(rest);
  return transaction(ctx.runtime, async (tx) => {
    await lockStoreConfig(tx);
    const [row] = await tx.db.select().from(store).where(eq(store.id, id)).limit(1);
    if (!row) return null;
    const [current] = await withMailboxes(tx.db, [row]);
    if (!current) return null;

    const adapter = resolveAdapterMode(ctx.appEnv, input.adapterMode, current.adapterMode);
    const formErrors: FieldErrors = {
      ...storeInputErrors(input),
      ...(adapter.error ? { adapterMode: adapter.error } : {}),
    };
    if (Object.keys(formErrors).length > 0) throw new FieldValidationError(formErrors);
    // 表单是照旧版本填的：先报冲突（G7「查看最新」后再改），不拿别人改过的数据判断重复
    if (current.version !== version) throw new OptimisticLockError('channel.store', id);
    const conflicts = await conflictErrors(tx.db, input, id);
    if (Object.keys(conflicts).length > 0 || !input.platform || !input.defaultSite) {
      throw new FieldValidationError(conflicts);
    }

    const updatedRow = await updateWithVersion(
      tx,
      store,
      { id, version },
      {
        name: input.name,
        platform: input.platform,
        sites: input.sites,
        defaultSite: input.defaultSite,
        platformId: input.platformId,
        adapterMode: adapter.mode,
        updatedAt: tx.now,
        updatedByName: actorName(ctx.actor),
      },
    );
    await tx.db.delete(storeMailbox).where(eq(storeMailbox.storeId, id));
    await insertMailboxes(tx, id, input.mailboxes);
    const updated: StoreRecord = { ...updatedRow, mailboxes: input.mailboxes };
    await recordAudit(tx, ctx.actor, {
      action: 'store.update',
      objectType: 'store',
      objectId: id,
      objectLabel: updated.name,
      storeId: id,
      before: snapshot(current),
      after: snapshot(updated),
    });
    await tx.enqueue(storeChangedJob, {
      storeId: id,
      addedMailboxes: input.mailboxes.filter((m) => !current.mailboxes.includes(m)),
    });
    return updated;
  });
}
