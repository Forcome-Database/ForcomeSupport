import {
  aftersalesActions,
  reassignCandidates,
  reassignMessages,
  reassignQueueNotificationCopy,
  type HandoverAssignment,
  type HandoverCase,
  type ReassignInput,
} from '@forcome/contracts';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { storeNamesById } from '../channel';
import {
  AccessDeniedError,
  FieldValidationError,
  OptimisticLockError,
  recordAudit,
  systemActor,
  transaction,
  updateWithVersion,
  type Actor,
  type DbExecutor,
  type Logger,
  type Runtime,
  type Tx,
} from '../core';
import {
  listAftersalesOwners,
  memberNamesById,
  notifyMembers,
  type Access,
  type MemberHandover,
} from '../org';
import { auditSnapshot, ownerNameOf } from './audit';
import { findOwnedAftersales, type AftersalesRow } from './ledger';
import { aftersales } from './schema';

/*
 * 售后单的负责人改派（待办 23，PRD P13「第一阶段」、P20「第一阶段」、K10、S15 补充小样、AC-ST-02、AC-ST-05）：
 * - P13「改派负责人」：客服主管或售后负责人改给有该店铺范围的在职售后负责人（进行中、已完成可改派，已取消只读），带版本号、记审计；
 * - P20 停用成员：org 经注入的 MemberHandover 列出他负责的进行中售后单，并在停用的事务里改派（AC-ST-02）；
 * - 「成员已停用」事件：他负责、还没改派的进行中售后单标为「待分配」进入改派队列，按店铺通知客服主管（AC-ST-05）。
 * 都不改业务状态；改了负责人（含编辑登记里改的）就出了改派队列。
 */

const m = reassignMessages;

/** 写新负责人（清掉待分配）并记审计「改派负责人」；版本对不上抛 OptimisticLockError */
async function writeOwner(
  tx: Tx,
  actor: Actor,
  found: AftersalesRow,
  owner: { readonly id: string; readonly name: string },
): Promise<AftersalesRow> {
  const updated = await updateWithVersion(
    tx,
    aftersales,
    { id: found.id, version: found.version },
    {
      ownerId: owner.id,
      reassignQueuedAt: null,
      updatedAt: tx.now,
      updatedByName: actor.kind === 'member' ? actor.name : null,
    },
  );
  await recordAudit(tx, actor, {
    action: 'aftersales.reassign',
    objectType: 'aftersales',
    objectId: found.id,
    objectLabel: found.number,
    storeId: found.storeId,
    before: auditSnapshot(found, await ownerNameOf(tx.db, found.ownerId)),
    after: auditSnapshot(updated, owner.name),
  });
  return updated;
}

/**
 * P13「改派负责人」（S15 补充小样）：先比版本号（G7，409）；已取消的单报在 status 上（400）；不是客服主管或售后负责人 403；
 * 接手人没选、不是有该店铺范围的在职售后负责人、或就是现负责人报在 ownerId 上（400）
 */
export async function reassignAftersales(
  runtime: Runtime,
  access: Access,
  number: string,
  input: ReassignInput,
): Promise<AftersalesRow | null> {
  // 越权在写事务之外判断：越权审计单独提交，不随业务事务回滚（E-24）
  const found = await findOwnedAftersales(runtime.db, access, number);
  if (!found) return null;
  if (found.version !== input.version) throw new OptimisticLockError('aftersales', found.id);
  if (found.status === 'cancelled') throw new FieldValidationError({ status: m.cancelled });
  if (!aftersalesActions(access.member, found).reassign) throw new AccessDeniedError(m.denied);

  return transaction(runtime, async (tx) => {
    const owners = await listAftersalesOwners(tx.db);
    const candidates = reassignCandidates(owners, found.storeId, found.ownerId);
    const owner = candidates.find((candidate) => candidate.id === input.ownerId);
    if (!owner) {
      const message =
        candidates.length === 0
          ? m.noCandidate
          : !input.ownerId
            ? m.ownerMissing
            : input.ownerId === found.ownerId
              ? m.sameOwner
              : m.ownerNotEligible;
      throw new FieldValidationError({ ownerId: message });
    }
    return writeOwner(tx, access.actor, found, owner);
  });
}

/** 某位成员负责的进行中售后单（按单号） */
function openCasesOf(db: DbExecutor, memberId: string) {
  return db
    .select()
    .from(aftersales)
    .where(and(eq(aftersales.ownerId, memberId), eq(aftersales.status, 'in_progress')))
    .orderBy(asc(aftersales.number));
}

/**
 * P20 停用成员时的售后单（org 的 MemberHandover，由 app.ts 注入）：列出他负责的进行中售后单；在停用的事务里按选好的接手人改派
 * （接手人已由 org 按 contracts 的 handoverError 校验过：有该单店铺范围的在职售后负责人）。列出之后被别人改过的单版本对不上，
 * 整个停用回滚（409）
 */
export const aftersalesHandover: MemberHandover = {
  async openCases(db, memberId): Promise<HandoverCase[]> {
    const rows = await openCasesOf(db, memberId);
    const stores = await storeNamesById(
      db,
      rows.map((row) => row.storeId),
    );
    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      status: row.status,
      store: { id: row.storeId, name: stores.get(row.storeId) ?? '' },
      version: row.version,
    }));
  },

  async reassign(tx, actor, cases, assignments: readonly HandoverAssignment[]) {
    const chosen = new Map(assignments.map((item) => [item.caseId, item.ownerId]));
    const names = await memberNamesById(
      tx.db,
      assignments.flatMap((item) => (item.ownerId ? [item.ownerId] : [])),
    );
    for (const item of cases) {
      const ownerId = chosen.get(item.id);
      if (!ownerId) throw new Error(`售后单 ${item.number} 没有接手人`);
      const [found] = await tx.db.select().from(aftersales).where(eq(aftersales.id, item.id));
      // 列出之后被别人改过（含刚设为已完成、改了负责人）：整个停用回滚，弹窗刷新后再选
      if (!found || found.version !== item.version) {
        throw new OptimisticLockError('aftersales', item.id);
      }
      await writeOwner(tx, actor, found, { id: ownerId, name: names.get(ownerId) ?? '' });
    }
  },
};

/**
 * 「成员已停用」→ 改派队列（AC-ST-05）：他负责、还没改派的进行中售后单标为「待分配」（记进入队列的时刻，不改状态，负责人仍是他），
 * 每张记审计「进入改派队列」（操作人「系统」）；按店铺各发一条站内通知给店铺范围包含该店铺的在职客服主管（11.4，notifyMembers）。
 * 已标过的不再标（任务重试不重复通知）；管理员停用时已在弹窗里改派，一般没有要标的单
 */
export async function queueOwnedCases(
  runtime: Runtime,
  memberId: string,
  logger: Logger,
): Promise<void> {
  const queued = await transaction(runtime, async (tx) => {
    const rows = await tx.db
      .select()
      .from(aftersales)
      .where(
        and(
          eq(aftersales.ownerId, memberId),
          eq(aftersales.status, 'in_progress'),
          isNull(aftersales.reassignQueuedAt),
        ),
      )
      .orderBy(asc(aftersales.number))
      .for('update');
    if (rows.length === 0) return 0;
    const [members, stores] = await Promise.all([
      memberNamesById(tx.db, [memberId]),
      storeNamesById(
        tx.db,
        rows.map((row) => row.storeId),
      ),
    ]);
    const name = members.get(memberId) ?? '';
    const perStore = new Map<string, number>();
    for (const row of rows) {
      const updated = await updateWithVersion(
        tx,
        aftersales,
        { id: row.id, version: row.version },
        { reassignQueuedAt: tx.now, updatedAt: tx.now, updatedByName: null },
      );
      await recordAudit(tx, systemActor, {
        action: 'aftersales.reassign_queue',
        objectType: 'aftersales',
        objectId: row.id,
        objectLabel: row.number,
        storeId: row.storeId,
        before: auditSnapshot(row, name),
        after: auditSnapshot(updated, name),
      });
      perStore.set(row.storeId, (perStore.get(row.storeId) ?? 0) + 1);
    }
    const copy = reassignQueueNotificationCopy;
    for (const [storeId, count] of perStore) {
      await notifyMembers(tx, {
        type: 'reassign_queue',
        title: copy.title,
        body: copy.body(name, stores.get(storeId) ?? '', count),
        object: { type: 'member', id: memberId, label: copy.label },
        storeId,
      });
    }
    return rows.length;
  });
  if (queued > 0) logger.info({ memberId, queued }, '成员已停用：售后单进入改派队列');
}
