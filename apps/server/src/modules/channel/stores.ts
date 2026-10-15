import {
  normalizeStoreInput,
  qiyeMailboxMessages,
  storeInputErrors,
  storeSaveMessages,
  type AdapterMode,
  type FieldErrors,
  type MailProvider,
  type Platform,
  type Store,
  type StoreInput,
  type StoreMailboxInput,
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
import {
  deleteMailboxAuthCodes,
  savedMailboxAuthCodes,
  type CredentialVault,
} from '../integration';
import { queueAmazonSync, queueShopifySync, resetOrderSync } from '../order';
import type { StoreAccessTarget } from '../org';
import { storeConnections, type ConnectionSnapshot } from './connections';
import { storeChangedJob } from './jobs';
import { mailboxSync, store, storeMailbox } from './schema';

/*
 * 店铺的仓储与保存（P18、K8；PRD P18「校验」、AC-ST-01）。
 * 保存都在一把事务级咨询锁下进行：店铺名与进线邮箱的「不能重复」要先查后写，串行化后检查与写入之间不会被别人插入
 * （表上另有唯一约束兜底）。保存记审计（完整前后值），并在同一事务里发出「店铺已变更」（jobs.ts）。
 * 进线邮箱各选服务商（D-28，待办 35）：163 企业邮箱的客户端授权码只写不读——带了就加密保存（integration 的保管，同一事务），
 * 没带就沿用该地址已保存的（新加或从 Gmail 改来的必须带）；删掉的或改成 Gmail 的邮箱，保存时一并删掉授权码；
 * 服务商改了的邮箱同步记录从头算（同新加的邮箱：重新开始监听，不回放之前的信）。审计不记授权码，只记哪些邮箱「已重新填写」。
 */

type StoreRow = typeof store.$inferSelect;

/** 店铺的一个进线邮箱：地址、服务商；163 企业邮箱另有 IMAP 服务器与端口 */
export interface StoreMailboxRecord {
  readonly address: string;
  readonly provider: MailProvider;
  readonly imapHost: string | null;
  readonly imapPort: number | null;
}

/** 店铺与它的进线邮箱（按显示顺序） */
export interface StoreRecord extends StoreRow {
  readonly mailboxes: readonly StoreMailboxRecord[];
}

async function withMailboxes(db: DbExecutor, rows: readonly StoreRow[]): Promise<StoreRecord[]> {
  if (rows.length === 0) return [];
  const boxes = await db
    .select({
      storeId: storeMailbox.storeId,
      address: storeMailbox.address,
      provider: storeMailbox.provider,
      imapHost: storeMailbox.imapHost,
      imapPort: storeMailbox.imapPort,
    })
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
    mailboxes: boxes
      .filter((box) => box.storeId === row.id)
      .map(({ address, provider, imapHost, imapPort }) => ({
        address,
        provider,
        imapHost,
        imapPort,
      })),
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

/** 各平台的「立即同步一次订单」（加了平台而这里没跟上时编译报错） */
const QUEUE_ORDER_SYNC: Record<Platform, (tx: Tx, storeId: string) => Promise<void>> = {
  shopify: queueShopifySync,
  amazon: queueAmazonSync,
};

/** 新增或编辑店铺后立即给它排一次订单同步（不等定时；Shopify 待办 11、亚马逊待办 12） */
function queueOrderSync(
  tx: Tx,
  saved: { readonly id: string; readonly platform: Platform },
): Promise<void> {
  return QUEUE_ORDER_SYNC[saved.platform](tx, saved.id);
}

/** order 的 OrderStore 要的列 */
const orderStoreColumns = {
  id: store.id,
  name: store.name,
  platform: store.platform,
  platformId: store.platformId,
  adapterMode: store.adapterMode,
};

/**
 * 订单同步要知道的全部店铺（order 的 OrderStore：店铺名、平台、平台标识、数据来源），按建立先后。同步与连接状态是系统操作，不按范围过滤
 * （ADR 0010 修订登记的例外）：由组装根注入 order（order 不依赖 channel），全站横幅用它列出连接异常的店铺
 */
export async function listOrderStores(db: DbExecutor) {
  return db.select(orderStoreColumns).from(store).orderBy(asc(store.createdAt), asc(store.id));
}

/**
 * 店铺范围内的一个店铺，写成 order 要的样子（OrderStore）：按订单归并时把来信所在的店铺交给 order 查订单（ticket，待办 14；
 * 系统操作用 SYSTEM_STORE_SCOPE）。没有或不在范围内为 null
 */
export async function findOrderStore(db: DbExecutor, scope: StoreScope, storeId: string) {
  const [row] = await db
    .select(orderStoreColumns)
    .from(store)
    .where(and(eq(store.id, storeId), storeScopeCondition(scope, store.id)))
    .limit(1);
  return row ?? null;
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

/**
 * 选了某个店铺（P13 台账与 P04 工单的店铺筛选、新建登记或改店铺）时交给 access.requireStores 的对象：越权时审计的对象名写店铺名
 * （P27「对象」列与对象编号搜索按它；只在越权时才查店铺名）
 */
export function storeAccessTarget(db: DbExecutor, storeId: string): StoreAccessTarget {
  return {
    storeIds: [storeId],
    objectType: 'store',
    objectId: storeId,
    objectLabel: async () => (await storeNamesById(db, [storeId])).get(storeId) ?? null,
  };
}

/**
 * 店铺的接口输出（contracts 的 Store）；「状态」列按这一刻的同步记录算（connections.ts）。163 企业邮箱的客户端授权码不返回，
 * 只说有没有保存（savedAuthCodes：已保存授权码的邮箱，integration 的 savedMailboxAuthCodes）
 */
export function toStore(
  record: StoreRecord,
  connections: ConnectionSnapshot,
  savedAuthCodes: ReadonlyMap<string, Date>,
): Store {
  return {
    id: record.id,
    name: record.name,
    platform: record.platform,
    sites: [...record.sites],
    defaultSite: record.defaultSite,
    mailboxes: record.mailboxes.map((mailbox) => ({
      ...mailbox,
      authCodeSaved: mailbox.provider === 'qiye163' && savedAuthCodes.has(mailbox.address),
    })),
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

/**
 * 审计的前后值：进线邮箱的地址照旧在 mailboxes，服务商与 IMAP 服务器、端口在 mailboxServers；这次重新填写了客户端授权码的邮箱只记地址
 * （authCodeRenewed，只在后值里有），不记授权码（PRD P27、AC-P1-23）
 */
function snapshot(record: StoreContent, authCodeRenewed: readonly string[] = []) {
  return {
    name: record.name,
    platform: record.platform,
    sites: [...record.sites],
    defaultSite: record.defaultSite,
    mailboxes: record.mailboxes.map((mailbox) => mailbox.address),
    mailboxServers: record.mailboxes.map(({ address, provider, imapHost, imapPort }) => ({
      address,
      provider,
      imapHost,
      imapPort,
    })),
    ...(authCodeRenewed.length > 0 ? { authCodeRenewed: [...authCodeRenewed] } : {}),
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
      .where(
        and(
          inArray(
            storeMailbox.address,
            input.mailboxes.map((mailbox) => mailbox.address),
          ),
          notSelf,
        ),
      );
    input.mailboxes.forEach((mailbox, index) => {
      const owner = taken.find((row) => row.address === mailbox.address);
      if (owner) {
        errors[`mailboxes.${index}`] = storeSaveMessages.mailboxTaken(
          mailbox.address,
          owner.storeName,
        );
      }
    });
  }
  return errors;
}

/** 没有主密钥（生产环境没配置 CREDENTIAL_MASTER_KEY）时填了授权码：原型不画（部署问题），直接调接口或误配置时才会看到 */
const NO_MASTER_KEY = '服务器没有配置主密钥（CREDENTIAL_MASTER_KEY），不能保存客户端授权码';

/**
 * 163 企业邮箱的客户端授权码（PRD P18「校验」）：没带授权码的行要沿用已保存的——只认这个店铺里该地址原来就是 163 企业邮箱且保存过的
 * （新加、从 Gmail 改来、或授权码已被删的都必须带）；带了授权码而服务器没有主密钥时不能保存
 */
async function authCodeErrors(
  db: DbExecutor,
  input: StoreInput,
  current: StoreRecord | null,
  vault: CredentialVault | null,
): Promise<FieldErrors> {
  const errors: FieldErrors = {};
  const qiye = input.mailboxes.filter((mailbox) => mailbox.provider === 'qiye163');
  if (qiye.length === 0) return errors;
  const saved = await savedMailboxAuthCodes(
    db,
    qiye.map((mailbox) => mailbox.address),
  );
  input.mailboxes.forEach((mailbox, index) => {
    if (mailbox.provider !== 'qiye163') return;
    const key = `mailboxes.${index}.authCode`;
    if (mailbox.authCode) {
      if (!vault) errors[key] = NO_MASTER_KEY;
      return;
    }
    const before = current?.mailboxes.find((m) => m.address === mailbox.address);
    if (before?.provider !== 'qiye163' || !saved.has(mailbox.address)) {
      errors[key] = qiyeMailboxMessages.authCodeMissing;
    }
  });
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

/** 保存店铺的上下文：运行环境与操作人（接口里取访问上下文的 actor）、加密 163 企业邮箱授权码的保管（没有主密钥为 null） */
export interface StoreSaveContext {
  readonly runtime: Runtime;
  readonly appEnv: AppEnv;
  readonly actor: Actor;
  readonly vault: CredentialVault | null;
}

function actorName(actor: Actor): string | null {
  return actor.kind === 'member' ? actor.name : null;
}

/** 进线邮箱写库的样子：Gmail 没有服务器与端口（已校验过，163 企业邮箱的端口是 1–65535 的整数） */
function mailboxRecord(mailbox: StoreMailboxInput): StoreMailboxRecord {
  return mailbox.provider === 'qiye163'
    ? {
        address: mailbox.address,
        provider: 'qiye163',
        imapHost: mailbox.imapHost ?? null,
        imapPort: typeof mailbox.imapPort === 'number' ? mailbox.imapPort : null,
      }
    : { address: mailbox.address, provider: 'gmail', imapHost: null, imapPort: null };
}

async function insertMailboxes(tx: Tx, storeId: string, mailboxes: readonly StoreMailboxRecord[]) {
  if (mailboxes.length === 0) return;
  await tx.db
    .insert(storeMailbox)
    .values(
      mailboxes.map((mailbox, position) => ({ storeId, ...mailbox, position, createdAt: tx.now })),
    );
}

/**
 * 保存客户端授权码（同一事务）：带了的加密保存（替换原来的），返回这次重新填写了授权码的邮箱；原来是这个店铺的 163 企业邮箱、
 * 这次删掉了或改成 Gmail 的，一并删掉授权码
 */
async function saveAuthCodes(
  tx: Tx,
  vault: CredentialVault | null,
  input: StoreInput,
  previous: readonly StoreMailboxRecord[],
): Promise<string[]> {
  const renewed: string[] = [];
  for (const mailbox of input.mailboxes) {
    if (mailbox.provider !== 'qiye163' || !mailbox.authCode || !vault) continue;
    await vault.writeMailboxAuthCode(tx.db, mailbox.address, mailbox.authCode, tx.now);
    renewed.push(mailbox.address);
  }
  const stillQiye = new Set(
    input.mailboxes.filter((m) => m.provider === 'qiye163').map((m) => m.address),
  );
  await deleteMailboxAuthCodes(
    tx.db,
    previous
      .filter((m) => m.provider === 'qiye163' && !stillQiye.has(m.address))
      .map((m) => m.address),
  );
  return renewed;
}

/**
 * 服务商改了的邮箱（Gmail ↔ 163 企业邮箱）：同步记录从头算（同新加的邮箱，重新开始监听、不回放之前的信，连接状态先为未连接），
 * 免得 Gmail 的游标被当成已开始监听、或 163 企业邮箱的旧游标被 Gmail 接着用
 */
async function resetSwitchedMailboxes(
  tx: Tx,
  previous: readonly StoreMailboxRecord[],
  next: readonly StoreMailboxRecord[],
): Promise<void> {
  const switched = next
    .filter((mailbox) => {
      const before = previous.find((m) => m.address === mailbox.address);
      return before !== undefined && before.provider !== mailbox.provider;
    })
    .map((mailbox) => mailbox.address);
  if (switched.length === 0) return;
  await tx.db.delete(mailboxSync).where(inArray(mailboxSync.address, switched));
}

/** 新增店铺（K8）。填错时抛 FieldValidationError（一次列全全部字段的错误），不写任何数据 */
export async function createStore(ctx: StoreSaveContext, raw: StoreInput): Promise<StoreRecord> {
  const input = normalizeStoreInput(raw);
  return transaction(ctx.runtime, async (tx) => {
    await lockStoreConfig(tx);
    const adapter = resolveAdapterMode(ctx.appEnv, input.adapterMode, null);
    const errors: FieldErrors = {
      ...(await conflictErrors(tx.db, input, null)),
      ...(await authCodeErrors(tx.db, input, null, ctx.vault)),
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
    const mailboxes = input.mailboxes.map(mailboxRecord);
    await insertMailboxes(tx, row.id, mailboxes);
    const renewed = await saveAuthCodes(tx, ctx.vault, input, []);
    const created: StoreRecord = { ...row, mailboxes };
    await recordAudit(tx, ctx.actor, {
      action: 'store.create',
      objectType: 'store',
      objectId: row.id,
      objectLabel: row.name,
      storeId: row.id,
      after: snapshot(created, renewed),
    });
    await tx.enqueue(storeChangedJob, {
      storeId: row.id,
      addedMailboxes: mailboxes.map((mailbox) => mailbox.address),
    });
    // 立即同步一次订单（不等定时，新店铺随即显示已连接或异常；Shopify 待办 11、亚马逊待办 12）
    await queueOrderSync(tx, row);
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
      ...(await authCodeErrors(tx.db, input, current, ctx.vault)),
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
    const mailboxes = input.mailboxes.map(mailboxRecord);
    await insertMailboxes(tx, id, mailboxes);
    const renewed = await saveAuthCodes(tx, ctx.vault, input, current.mailboxes);
    await resetSwitchedMailboxes(tx, current.mailboxes, mailboxes);
    const updated: StoreRecord = { ...updatedRow, mailboxes };
    await recordAudit(tx, ctx.actor, {
      action: 'store.update',
      objectType: 'store',
      objectId: id,
      objectLabel: updated.name,
      storeId: id,
      before: snapshot(current),
      after: snapshot(updated, renewed),
    });
    const before = new Set(current.mailboxes.map((mailbox) => mailbox.address));
    await tx.enqueue(storeChangedJob, {
      storeId: id,
      addedMailboxes: mailboxes.map((m) => m.address).filter((address) => !before.has(address)),
    });
    // 平台、平台标识或数据来源改了：订单同步按新配置从头算（之前的同步记录不算数），店铺立即同步一次（Shopify 待办 11、亚马逊待办 12）
    if (
      current.platform !== updated.platform ||
      current.platformId !== updated.platformId ||
      current.adapterMode !== updated.adapterMode
    ) {
      await resetOrderSync(tx, id);
    }
    await queueOrderSync(tx, updated);
    return updated;
  });
}
