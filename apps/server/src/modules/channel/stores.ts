import {
  normalizeStoreInput,
  storeInputErrors,
  storeSaveMessages,
  type AdapterMode,
  type FieldErrors,
  type Store,
  type StoreInput,
  type StoreOption,
  type StoreUpdate,
} from '@forcome/contracts';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  advisoryLock,
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
import { queueShopifySync, resetOrderSync } from '../order';
import { storeConnections, type ConnectionSnapshot } from './connections';
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

/**
 * 全部店铺的 ID 与店铺名（P20 给成员授权店铺范围时的选项，待办 06）：授权是管理配置，不按管理员自己的数据范围过滤，
 * 同 listAllStores（ADR 0010 修订登记的例外）；只给挂了 settings.channels_team 的接口用（经 app.ts 注入 org）
 */
export async function listStoreChoices(db: DbExecutor): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: store.id, name: store.name })
    .from(store)
    .orderBy(asc(store.createdAt), asc(store.id));
}

/**
 * 订单同步要知道的全部店铺（order 的 OrderStore：店铺名、平台、平台标识、数据来源），按建立先后。同步是系统操作，不按范围过滤；
 * 由组装根注入 order（order 不依赖 channel）
 */
export async function listOrderStores(db: DbExecutor) {
  return db
    .select({
      id: store.id,
      name: store.name,
      platform: store.platform,
      platformId: store.platformId,
      adapterMode: store.adapterMode,
    })
    .from(store)
    .orderBy(asc(store.createdAt), asc(store.id));
}

/** 店铺范围内的店铺（各页面的店铺筛选、指定店铺）；新增的店铺对「全部店铺」的成员立即可见 */
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

/**
 * 店铺名（工单列表等业务页面显示「渠道与店铺」用）：调用方传入的是它已按店铺范围查出的数据里的店铺 ID，
 * 这里只把 ID 换成名字，不另做范围判断
 */
export async function storeNamesById(
  db: DbExecutor,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: store.id, name: store.name })
    .from(store)
    .where(inArray(store.id, [...new Set(ids)]));
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** 店铺的接口输出（contracts 的 Store）；「状态」列按这一刻的同步记录算（connections.ts） */
export function toStore(record: StoreRecord, connections: ConnectionSnapshot): Store {
  return {
    id: record.id,
    name: record.name,
    platform: record.platform,
    sites: [...record.sites],
    defaultSite: record.defaultSite,
    mailboxes: [...record.mailboxes],
    platformId: record.platformId,
    adapterMode: record.adapterMode,
    connections: storeConnections(record, connections),
    version: record.version,
    updatedAt: record.updatedAt.toISOString(),
    updatedBy: record.updatedByName,
  };
}

/** 抽屉里能改的全部字段（审计的前后值） */
type StoreContent = Pick<
  StoreRecord,
  'name' | 'platform' | 'sites' | 'defaultSite' | 'mailboxes' | 'platformId' | 'adapterMode'
>;

function snapshot(record: StoreContent) {
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
  await advisoryLock(tx, 'channel.store_config');
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
    if (sameName) errors.name = storeSaveMessages.duplicateName;
  }
  if (input.mailboxes.length > 0) {
    const taken = await db
      .select({ address: storeMailbox.address, storeName: store.name })
      .from(storeMailbox)
      .innerJoin(store, eq(store.id, storeMailbox.storeId))
      .where(and(inArray(storeMailbox.address, [...input.mailboxes]), notSelf));
    input.mailboxes.forEach((mailbox, index) => {
      const owner = taken.find((row) => row.address === mailbox);
      if (owner) {
        errors[`mailboxes.${index}`] = storeSaveMessages.mailboxTaken(mailbox, owner.storeName);
      }
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
    return requested === 'fake'
      ? { mode: 'real', error: storeSaveMessages.fakeInProduction }
      : { mode: 'real' };
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
    // Shopify 店铺立即同步一次订单（不等每分钟的定时，新店铺随即显示已连接或异常，待办 11）
    if (row.platform === 'shopify') await queueShopifySync(tx, row.id);
    return created;
  });
}

/**
 * 编辑店铺（K8）。店铺不存在返回 null；版本号不是最新的（别人先保存了）抛 OptimisticLockError（接口 409，G7）；
 * 填错抛 FieldValidationError（表单本身的错误与查库的重复一次列全）。进线邮箱按新的列表整体替换，
 * 新登记的地址随「店铺已变更」发出。
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

    // 表单是照旧版本填的：先报冲突（G7「查看最新」后再改），不拿别人改过的数据判断对错
    if (current.version !== version) throw new OptimisticLockError('channel.store', id);
    const adapter = resolveAdapterMode(ctx.appEnv, input.adapterMode, current.adapterMode);
    const errors: FieldErrors = {
      ...(await conflictErrors(tx.db, input, id)),
      ...storeInputErrors(input),
      ...(adapter.error ? { adapterMode: adapter.error } : {}),
    };
    if (Object.keys(errors).length > 0 || !input.platform || !input.defaultSite) {
      throw new FieldValidationError(errors);
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
    // 平台、平台标识或数据来源改了：订单同步按新配置从头算（之前的同步记录不算数），Shopify 店铺立即同步一次（待办 11）
    if (
      current.platform !== updated.platform ||
      current.platformId !== updated.platformId ||
      current.adapterMode !== updated.adapterMode
    ) {
      await resetOrderSync(tx, id);
    }
    if (updated.platform === 'shopify') await queueShopifySync(tx, id);
    return updated;
  });
}
